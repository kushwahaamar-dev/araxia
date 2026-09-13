"use client";

import { useState } from "react";
import { registerPasskey } from "@/app/lib-client/flows";
import { prefix } from "@/app/lib-client/format";
import type { Passkey } from "@/app/lib-client/types";
import { StateBadge } from "./ui";

interface Props {
  userId: string;
  reachable: boolean;
  issuerKid: string | null;
  policyHash: string | null;
  passkeys: Passkey[];
  onPasskeysChanged: () => Promise<void>;
}

export function TopBar({ userId, reachable, issuerKid, policyHash, passkeys, onPasskeysChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passkey = passkeys[0];

  const register = async () => {
    setBusy(true);
    setError(null);
    const r = await registerPasskey(userId);
    if ("error" in r) setError(r.error);
    else await onPasskeysChanged();
    setBusy(false);
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

      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-dim">passkey</span>
        {passkey ? (
          <span className="font-mono" title={passkey.cred_id}>
            {prefix(passkey.cred_id, 14)}
            {passkeys.length > 1 && <span className="text-dim"> +{passkeys.length - 1}</span>}
          </span>
        ) : (
          <button type="button" className="btn btn-primary" onClick={register} disabled={busy || !reachable}>
            {busy ? "Waiting for authenticator…" : "Register passkey"}
          </button>
        )}
        {error && (
          <span role="alert" className="text-bad">
            {error}
          </span>
        )}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-4 text-[12px]">
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
