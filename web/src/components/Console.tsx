"use client";

import { useCallback, useEffect, useState } from "react";
import { api, DEMO_USER } from "@/app/lib-client/api";
import type { Assertion, CreatedAction, Passkey, Presence, StatusResponse } from "@/app/lib-client/types";
import { useNow } from "@/app/lib-client/useNow";
import { ActionPanel } from "./ActionPanel";
import { AttackLab } from "./AttackLab";
import { ExecutionsTable } from "./ExecutionsTable";
import { FitbitPanel } from "./FitbitPanel";
import { NessieLedger } from "./NessieLedger";
import { SolanaPanel } from "./SolanaPanel";
import { TigerPanel } from "./TigerPanel";
import { PresencePanel, type PollSample } from "./PresencePanel";
import { TopBar } from "./TopBar";

const STATUS_POLL_MS = 1000;
const HISTORY_LEN = 60;
const YEAR = new Date().getFullYear();

function approveBlocker(status: StatusResponse | null, reachable: boolean, hasPasskey: boolean): string | null {
  if (!reachable) return "service unreachable";
  if (status?.wearer?.halt) return "user has been changed; switch wearer first";
  if (!hasPasskey) return "no passkey registered for this user";
  const ev = status?.evidence ?? null;
  if (!ev) return "no wearable evidence yet";
  if (ev.presence !== "READY") return `presence is ${ev.presence}; policy requires READY`;
  if (!status?.fresh) return "evidence is older than the policy allows";
  return null;
}

export function Console() {
  const now = useNow(250);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [reachable, setReachable] = useState(true);
  const [history, setHistory] = useState<PollSample[]>([]);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [lastAssertion, setLastAssertion] = useState<Assertion | null>(null);
  const [userId, setUserId] = useState(DEMO_USER);
  const [initialAuthorization] = useState<{ created: CreatedAction; assertion: Assertion | null } | null>(() => {
    if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("focus") !== "latest") return null;
    try {
      const value = JSON.parse(sessionStorage.getItem("araxia.latestAuthorization") ?? "null") as { created?: CreatedAction; assertion?: Assertion | null } | null;
      return value?.created ? { created: value.created, assertion: value.assertion ?? null } : null;
    } catch {
      return null;
    }
  });

  const loadPasskeys = useCallback(async (user: string) => {
    const r = await api<{ passkeys: Passkey[] }>(`/api/passkeys?user=${encodeURIComponent(user)}`);
    if (r.status >= 200 && r.status < 300 && r.body && Array.isArray(r.body.passkeys)) setPasskeys(r.body.passkeys);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const [r, pk] = await Promise.all([
        api<StatusResponse>(`/api/status?user=${encodeURIComponent(userId)}`),
        api<{ passkeys: Passkey[] }>(`/api/passkeys?user=${encodeURIComponent(userId)}`),
      ]);
      if (cancelled) return;
      let presence: Presence | "NONE" | "DOWN" = "DOWN";
      if (r.status >= 200 && r.status < 300 && r.body && "evidence" in r.body) {
        setStatus(r.body);
        setReachable(true);
        presence = r.body.evidence?.presence ?? "NONE";
        if (r.body.wearer?.active_user && r.body.wearer.active_user !== userId && !r.body.wearer.halt) {
          setUserId(r.body.wearer.active_user);
        }
      } else {
        setReachable(false);
      }
      if (pk.status >= 200 && pk.status < 300 && pk.body && Array.isArray(pk.body.passkeys)) {
        setPasskeys(pk.body.passkeys);
      }
      setHistory((h) => [...h, { t: Date.now(), presence }].slice(-HISTORY_LEN));
      timer = setTimeout(tick, STATUS_POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId]);

  const hasPasskey = passkeys.length > 0;
  const blocker = approveBlocker(status, reachable, hasPasskey);

  return (
    <div className="araxia-noise relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:88px_88px] opacity-30" />
      <div className="araxia-orb pointer-events-none fixed -top-80 -left-72 size-[46rem] rounded-full bg-[radial-gradient(circle,rgba(216,185,138,0.11),transparent_62%)] blur-3xl" />
      <div className="araxia-orb-alt pointer-events-none fixed -right-72 -bottom-80 size-[42rem] rounded-full bg-[radial-gradient(circle,rgba(159,183,154,0.09),transparent_64%)] blur-3xl" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full min-w-0 max-w-[1440px] flex-col gap-3 p-3 pb-8">
        <TopBar
          userId={userId}
          reachable={reachable}
          issuerKid={status?.issuer.kid ?? null}
          policyHash={status?.policy_hash ?? null}
          passkeys={passkeys}
          kyc={status?.kyc}
          rails={status?.rails}
          nessie={status?.nessie}
          wearer={status?.wearer}
          onPasskeysChanged={() => loadPasskeys(userId)}
          onUserSwitched={async (next) => {
            setUserId(next);
            await loadPasskeys(next);
          }}
        />
        <main className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,380px)]">
          <PresencePanel status={status} reachable={reachable} history={history} now={now} />
          <ActionPanel userId={userId} now={now} approveBlocker={blocker} onAssertion={setLastAssertion} initialAuthorization={initialAuthorization} />
          <AttackLab userId={userId} lastAssertion={lastAssertion} approveBlocker={blocker} />
        </main>
        <FitbitPanel fitbit={status?.fitbit} liveBleBpm={status?.wearer?.last_median ?? status?.fitbit?.live_ble_bpm} />
        <NessieLedger ledger={status?.nessie} />
        <SolanaPanel solana={status?.solana} />
        <TigerPanel tiger={status?.tiger} />
        <ExecutionsTable executions={status?.executions ?? []} reachable={reachable} />

        <footer className="flex flex-col gap-2 border-t border-line px-1 pt-4 text-[11px] text-dim sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <img src="/logo-white.png" alt="" className="h-3.5 w-auto opacity-70" />
            <span>© {YEAR}. Small One — demo only, not advice.</span>
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a className="hover:text-accent" href="mailto:amkushwa@ttu.edu">
              amkushwa@ttu.edu
            </a>
            <a className="hover:text-accent" href="https://github.com/kushwahaamar-dev/araxia" rel="noreferrer">
              source
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
