"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { api, errorText } from "@/app/lib-client/api";
import { registerPasskey } from "@/app/lib-client/flows";
import { dollars, prefix } from "@/app/lib-client/format";
import type { Passkey, StatusResponse } from "@/app/lib-client/types";
import { Copyable, SolscanLink, StateBadge } from "./ui";

interface Props {
  userId: string;
  reachable: boolean;
  issuerKid: string | null;
  policyHash: string | null;
  passkeys: Passkey[];
  kyc: StatusResponse["kyc"] | undefined;
  rails: StatusResponse["rails"] | undefined;
  nessie: StatusResponse["nessie"] | undefined;
  wearer: StatusResponse["wearer"] | undefined;
  onPasskeysChanged: () => Promise<void>;
  onUserSwitched: (userId: string) => Promise<void>;
}

export function TopBar({
  userId,
  reachable,
  issuerKid,
  policyHash,
  passkeys,
  kyc,
  rails,
  nessie,
  wearer,
  onPasskeysChanged,
  onUserSwitched,
}: Props) {
  const [busy, setBusy] = useState<"register" | "kyc" | "switch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const verifyHuman = async (forUser = userId) => {
    setBusy("kyc");
    setError(null);
    const started = await api<{ kyc: { hosted_url?: string | null; status?: string } }>("/api/kyc", {
      body: { user_id: forUser },
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
        body: { user_id: forUser },
      });
      const status = refreshed.body && "kyc" in refreshed.body ? refreshed.body.kyc.status : undefined;
      if (status === "approved" || status === "completed" || status === "declined" || status === "failed") break;
    }
    setBusy(null);
  };

  const switchTo = async (next: string, ready: boolean) => {
    setError(null);
    if (!ready) {
      await verifyHuman(next);
      return;
    }
    setBusy("switch");
    const r = await api("/api/wearers", { body: { user_id: next, enroll: true } });
    setBusy(null);
    if (r.status >= 400) {
      setError(errorText(r, "could not switch wearer"));
      return;
    }
    await onUserSwitched(next);
    setMenuOpen(false);
  };

  const wearerButtons = wearer ? (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      {wearer.halt && <StateBadge value="USER HAS BEEN CHANGED" tone="bad" />}
      {wearer.team.map((p) => (
        <button
          key={p.user_id}
          type="button"
          className={`btn ${p.user_id === wearer.active_user ? "btn-primary" : ""}`}
          disabled={busy !== null || !reachable || (p.user_id === wearer.active_user && !wearer.halt)}
          onClick={() => void switchTo(p.user_id, p.ready)}
        >
          {p.ready ? `Switch to ${p.label}` : `Verify ${p.label}`}
        </button>
      ))}
    </div>
  ) : null;

  const authBlock = (
    <div className="flex flex-col gap-3 text-[12px] lg:flex-row lg:flex-wrap lg:items-center">
      {personaOn && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-dim">human</span>
          <StateBadge value={(kyc?.status ?? "none").toUpperCase()} tone={personaOk ? "ok" : "warn"} />
          {!personaOk && (
            <button type="button" className="btn btn-primary" onClick={() => void verifyHuman()} disabled={busy !== null || !reachable}>
              {busy === "kyc" ? "Waiting on Persona…" : "Verify human"}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-dim">passkey</span>
        {passkey ? (
          <Copyable value={passkey.cred_id} label="copy passkey id">
            {prefix(passkey.cred_id, 14)}
            {passkeys.length > 1 ? ` +${passkeys.length - 1}` : ""}
          </Copyable>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void register()}
            disabled={busy !== null || !reachable || (personaOn && !personaOk)}
          >
            {busy === "register" ? "Waiting for authenticator…" : "Register passkey"}
          </button>
        )}
        {personaOn && !personaOk && !passkey && <span className="text-[11px] text-dim">disabled: Persona first</span>}
      </div>
      {error && (
        <span role="alert" className="text-bad">
          {error}
        </span>
      )}
    </div>
  );

  const meta = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
      {nessie?.configured && (
        <div className="flex items-center gap-2">
          <span className="text-dim">nessie</span>
          <StateBadge value={nessie.reachable ? "LIVE" : "DOWN"} tone={nessie.reachable ? "ok" : "bad"} />
          {nessie.source?.balance_minor !== null && nessie.source?.balance_minor !== undefined && (
            <Copyable value={String(nessie.source.balance_minor / 100)} label="copy checking balance">
              {dollars(nessie.source.balance_minor)}
            </Copyable>
          )}
        </div>
      )}
      {rails?.solana && (
        <div className="flex items-center gap-2">
          <span className="text-dim">solana</span>
          <SolscanLink kind="account" id={rails.solana}>
            {prefix(rails.solana, 8)}
          </SolscanLink>
          <Copyable value={rails.solana} label="copy solana address">
            copy
          </Copyable>
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-dim">issuer</span>
        <span className="font-mono">{issuerKid ?? "—"}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-dim">policy</span>
        <Copyable value={policyHash ?? ""} label="copy policy hash">
          {prefix(policyHash, 12)}
        </Copyable>
      </div>
    </div>
  );

  return (
    <header className="panel sticky top-2 z-30 px-3 py-2.5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Link href="/" className="group flex min-w-0 items-center gap-3" aria-label="Araxia home">
          <Image
            src="/logo-white.png"
            alt="Araxia"
            width={240}
            height={64}
            className="h-7 w-auto sm:h-8"
            priority
          />
          <span className="hidden font-mono text-[10px] tracking-[0.18em] text-dim uppercase lg:block">
            permission console
          </span>
        </Link>
        <StateBadge value="SANDBOX" tone="warn" />
        {!reachable && <StateBadge value="SERVICE UNREACHABLE" tone="bad" />}
        <span className="hidden font-mono text-[12px] text-muted md:inline">{userId}</span>
        <button
          type="button"
          className="btn ml-auto lg:hidden"
          aria-expanded={menuOpen}
          aria-controls="console-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      <div className="mt-2 hidden min-w-0 items-center gap-3 lg:flex">
        {wearerButtons}
        {authBlock}
        <div className="ml-auto flex items-center gap-3"><Link href="/" className="btn btn-primary" aria-label="Back to Banking Demo">← Banking Demo</Link>{meta}</div>
      </div>

      {menuOpen && (
        <div id="console-menu" className="mt-3 flex flex-col gap-3 border-t border-line pt-3 lg:hidden">
          <div className="font-mono text-[12px] text-muted">{userId}</div>
          {wearerButtons}
          {wearer?.guessed_user && wearer.guessed_user !== wearer.active_user && (
            <p className="text-[12px] text-dim">
              stream looks like {wearer.team.find((p) => p.user_id === wearer.guessed_user)?.label ?? wearer.guessed_user}
            </p>
          )}
          {authBlock}
          {meta}
        </div>
      )}
    </header>
  );
}
