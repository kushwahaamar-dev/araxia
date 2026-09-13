"use client";

import { useState } from "react";
import { api, errorText } from "@/app/lib-client/api";
import { registerPasskey } from "@/app/lib-client/flows";
import { prefix } from "@/app/lib-client/format";
import type { Passkey, StatusResponse } from "@/app/lib-client/types";
import { StateBadge } from "./ui";

interface Props {
  userId: string;
  reachable: boolean;
  issuerKid: string | null;
  policyHash: string | null;
  passkeys: Passkey[];
  kyc: StatusResponse["kyc"] | undefined;
  rails: StatusResponse["rails"] | undefined;
  onPasskeysChanged: () => Promise<void>;
}

export function TopBar({
  userId,
  reachable,
  issuerKid,
  policyHash,
  passkeys,
  kyc,
  rails,
  onPasskeysChanged,
}: Props) {
  const [busy, setBusy] = useState<"register" | "kyc" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passkey = passkeys[0];
  const personaOn = kyc?.configured === true;
  const personaOk = kyc?.status === "approved" || kyc?.status === "completed";

  const register = async () => {
    setBusy("register");
    setError(null);
    const r = await registerPasskey(userId);
    if ("error" in r) setError(r.error);
    else await onPasskeysChanged();
    setBusy(null);
  };

  const verifyHuman = async () => {
    setBusy("kyc");
    setError(null);
    const started = await api<{ kyc: { hosted_url?: string | null; status?: string } }>("/api/kyc", {
      body: { user_id: userId },
    });
    if (started.status >= 400 || !started.body || !("kyc" in started.body)) {
      setError(errorText(started, "Persona start failed"));
      setBusy(null);
      return;
    }
    const url = started.body.kyc.hosted_url;
    if (url) window.open(url, "persona", "width=480,height=720");
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const refreshed = await api<{ kyc: { status?: string } }>("/api/kyc", {
        method: "PUT",
        body: { user_id: userId },
      });
      const status = refreshed.body && "kyc" in refreshed.body ? refreshed.body.kyc.status : undefined;
      if (status === "approved" || status === "completed" || status === "declined" || status === "failed") break;
    }
    setBusy(null);
  };

  return (
    <header className="panel flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[15px] font-semibold tracking-[0.18em] uppercase">Araxia</span>
        <StateBadge value="SANDBOX" tone="warn" />
        {!reachable && <StateBadge value="SERVICE UNREACHABLE" tone="bad" />}
      </div>

      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-dim">user</span>
        <span className="font-mono">{userId}</span>
      </div>

      {personaOn && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-dim">human</span>
          <StateBadge value={(kyc?.status ?? "none").toUpperCase()} tone={personaOk ? "ok" : "warn"} />
          {!personaOk && (
            <button type="button" className="btn btn-primary" onClick={verifyHuman} disabled={busy !== null || !reachable}>
              {busy === "kyc" ? "Waiting on Persona…" : "Verify human"}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-dim">passkey</span>
        {passkey ? (
          <span className="font-mono" title={passkey.cred_id}>
            {prefix(passkey.cred_id, 14)}
            {passkeys.length > 1 && <span className="text-dim"> +{passkeys.length - 1}</span>}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={register}
            disabled={busy !== null || !reachable || (personaOn && !personaOk)}
          >
            {busy === "register" ? "Waiting for authenticator…" : "Register passkey"}
          </button>
        )}
        {personaOn && !personaOk && !passkey && (
          <span className="text-[11px] text-dim">disabled: Persona first</span>
        )}
        {error && (
          <span role="alert" className="text-bad">
            {error}
          </span>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-4 text-[12px]">
        {rails?.solana && (
          <div className="flex items-center gap-2">
            <span className="text-dim">solana</span>
            <span className="font-mono" title={rails.solana}>
              {prefix(rails.solana, 8)}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-dim">issuer kid</span>
          <span className="font-mono">{issuerKid ?? "—"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-dim">policy</span>
          <span className="font-mono" title={policyHash ?? undefined}>
            {prefix(policyHash, 16)}
          </span>
        </div>
      </div>
    </header>
  );
}
