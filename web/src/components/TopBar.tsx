"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { api, errorText } from "@/app/lib-client/api";
import { registerPasskey } from "@/app/lib-client/flows";
import { dollars, prefix } from "@/app/lib-client/format";
import type { Passkey, StatusResponse } from "@/app/lib-client/types";
import { Copyable, SolscanLink } from "./ui";

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

function personaPassed(status: string | undefined): boolean {
  return status === "approved" || status === "completed";
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
  const [busy, setBusy] = useState<"register" | "kyc" | "switch" | "add" | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const passkey = passkeys[0];
  const personaOn = kyc?.configured === true;
  const me = wearer?.team.find((p) => p.user_id === userId);
  const personaOk = me ? me.ready : personaPassed(kyc?.status);

  const register = async (forUser: string, label: string) => {
    setBusy("register");
    setBusyUser(forUser);
    setError(null);
    const r = await registerPasskey(forUser, label);
    if ("error" in r) {
      setError(r.error);
      setBusy(null);
      setBusyUser(null);
      return false;
    }
    if (forUser !== userId) await onUserSwitched(forUser);
    else await onPasskeysChanged();
    setBusy(null);
    setBusyUser(null);
    return true;
  };

  const verifyHuman = async (forUser: string): Promise<boolean> => {
    setBusy("kyc");
    setBusyUser(forUser);
    setError(null);
    const started = await api<{ kyc: { hosted_url?: string | null; status?: string } }>("/api/kyc", {
      body: { user_id: forUser },
    });
    if (started.status >= 400 || !started.body || !("kyc" in started.body)) {
      setError(errorText(started, "Persona start failed"));
      setBusy(null);
      setBusyUser(null);
      return false;
    }
    if (personaPassed(started.body.kyc.status)) {
      setBusy(null);
      setBusyUser(null);
      return true;
    }
    const url = started.body.kyc.hosted_url;
    if (url) window.open(url, "persona", "width=480,height=720");
    let status = started.body.kyc.status;
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const refreshed = await api<{ kyc: { status?: string } }>("/api/kyc", {
        method: "PUT",
        body: { user_id: forUser },
      });
      if (refreshed.status === 429) continue;
      status = refreshed.body && "kyc" in refreshed.body ? refreshed.body.kyc.status : undefined;
      if (personaPassed(status) || status === "declined" || status === "failed") break;
    }
    const ok = personaPassed(status);
    if (!ok) {
      setError(
        status === "declined" || status === "failed"
          ? `Persona ${status} for ${forUser}`
          : `Persona still ${status ?? "pending"} — finish the popup, then click again`,
      );
    }
    setBusy(null);
    setBusyUser(null);
    return ok;
  };

  const switchActive = async (next: string) => {
    setBusy("switch");
    setBusyUser(next);
    const r = await api("/api/wearers", { body: { user_id: next, enroll: true } });
    if (r.status >= 400) {
      setError(errorText(r, "could not switch wearer"));
      setBusy(null);
      setBusyUser(null);
      return false;
    }
    await onUserSwitched(next);
    setBusy(null);
    setBusyUser(null);
    return true;
  };

  const enrollOrSwitch = async (p: { user_id: string; label: string; ready: boolean; passkeys?: number }) => {
    setError(null);
    if (personaOn && !p.ready && !(await verifyHuman(p.user_id))) return;
    if ((p.user_id !== userId || wearer?.halt) && !(await switchActive(p.user_id))) return;
    if ((p.passkeys ?? 0) === 0 && !(await register(p.user_id, p.label))) return;
  };

  // New human: name -> roster -> Persona -> switch (stamps their range) -> Touch ID.
  const addNewUser = async (e: FormEvent) => {
    e.preventDefault();
    const label = newName.trim();
    if (!label) return;
    setBusy("add");
    setBusyUser(null);
    setError(null);
    const r = await api<{ member: { user_id: string; label: string } }>("/api/wearers", { body: { label } });
    setBusy(null);
    if (r.status >= 400 || !r.body || !("member" in r.body)) {
      setError(errorText(r, "could not add user"));
      return;
    }
    setNewName("");
    setAdding(false);
    await enrollOrSwitch({ ...r.body.member, ready: false, passkeys: 0 });
  };

  // Members the console shows: verified humans or anyone holding a passkey.
  // Everyone else is reached through "new user".
  const shown = wearer?.team.filter((p) => p.ready || p.passkeys > 0 || p.user_id === wearer.active_user) ?? [];
  const unknownWearer = wearer !== undefined && wearer.guessed_user === "" && wearer.last_median >= 30;

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Link href="/" className="flex items-center" aria-label="Araxia home">
          <Image src="/logo-white.png" alt="Araxia" width={240} height={64} className="h-5 w-auto opacity-90" priority />
        </Link>
        <p className="text-[13px] text-fg">
          araxia@<span className="text-white">{userId}</span>:~$
          <span className="cursor-block" aria-hidden />
        </p>
        <Link href="/bank" className="text-[12px] text-dim hover:text-white">
          cd /bank
        </Link>
        {!reachable && <p className="text-[13px] text-bad">! service unreachable</p>}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]">
        {passkey ? (
          <Copyable value={passkey.cred_id} label="copy passkey id">
            <span className="text-dim">passkey=</span>
            {prefix(passkey.cred_id, 8)}
          </Copyable>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void register(userId, me?.label ?? userId)}
            disabled={busy !== null || !reachable || (personaOn && !personaOk)}
          >
            {busy === "register" && busyUser === userId ? "touchid…" : "./register"}
          </button>
        )}
        {personaOn && !personaOk && (
          <button
            type="button"
            className="btn"
            onClick={() => void enrollOrSwitch(me ?? { user_id: userId, label: userId, ready: false, passkeys: 0 })}
            disabled={busy !== null || !reachable}
          >
            {busy === "kyc" && busyUser === userId ? "persona…" : "./verify"}
          </button>
        )}
      </div>

      {wearer && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12px]">
          {wearer.halt && (
            <span className="text-white">
              {unknownWearer ? "! new user detected — ./register or su" : "! halt: user changed — su first"}
            </span>
          )}
          {!wearer.halt && unknownWearer && <span className="text-dim">? range unknown — new user?</span>}
          <span className="text-dim">su</span>
          {shown.map((p) => {
            const active = p.user_id === wearer.active_user;
            const needsKyc = personaOn && !p.ready;
            const needsKey = (p.user_id === userId ? passkeys.length : (p.passkeys ?? 0)) === 0;
            const idle = active && !wearer.halt && !needsKyc && !needsKey;
            const verb = needsKyc ? `verify ${p.label}` : needsKey ? `${p.label} ./register` : p.label;
            const spin =
              busyUser === p.user_id
                ? busy === "kyc"
                  ? "persona…"
                  : busy === "register"
                    ? "touchid…"
                    : busy === "switch"
                      ? "su…"
                      : verb
                : verb;
            return (
              <button
                key={p.user_id}
                type="button"
                className={active ? "text-fg" : "text-dim hover:text-fg"}
                disabled={busy !== null || !reachable || idle}
                onClick={() => void enrollOrSwitch(p)}
              >
                {spin}
                {active ? "*" : ""}
              </button>
            );
          })}
          {adding ? (
            <form className="flex items-baseline gap-2" onSubmit={(e) => void addNewUser(e)}>
              <label htmlFor="new-user-name" className="text-dim">
                --name
              </label>
              <input
                id="new-user-name"
                className="field w-36"
                autoFocus
                value={newName}
                placeholder="full name"
                maxLength={40}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAdding(false);
                }}
                disabled={busy !== null}
              />
              <button type="submit" className="btn" disabled={busy !== null || !newName.trim()}>
                {busy === "add" ? "adding…" : "enter"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className={unknownWearer ? "btn btn-primary" : "text-dim hover:text-fg"}
              disabled={busy !== null || !reachable}
              onClick={() => setAdding(true)}
            >
              {unknownWearer ? "new user ./register" : "+ new user"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-bad">
          ! {error}
        </p>
      )}

      <details className="text-[12px] text-dim">
        <summary className="cursor-pointer hover:text-white">
          <span className="term-prompt">cat internals</span>
        </summary>
        <dl className="dump mt-2">
          <dt>user</dt>
          <dd>{userId}</dd>
          {nessie?.source?.balance_minor != null && (
            <>
              <dt>checking</dt>
              <dd>{dollars(nessie.source.balance_minor)}</dd>
            </>
          )}
          {rails?.solana && (
            <>
              <dt>solana</dt>
              <dd>
                <SolscanLink kind="account" id={rails.solana}>
                  {prefix(rails.solana, 8)}
                </SolscanLink>
              </dd>
            </>
          )}
          <dt>issuer</dt>
          <dd>{issuerKid ?? "—"}</dd>
          {policyHash && (
            <>
              <dt>policy</dt>
              <dd>
                <Copyable value={policyHash} label="copy policy hash">
                  {prefix(policyHash, 12)}
                </Copyable>
              </dd>
            </>
          )}
        </dl>
      </details>
    </header>
  );
}
