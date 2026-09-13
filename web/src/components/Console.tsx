"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
const emptySubscribe = () => () => undefined;

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

type FocusAuth = { created: CreatedAction; assertion: Assertion | null };

function readFocusAuthorization(): FocusAuth | null {
  if (new URLSearchParams(window.location.search).get("focus") !== "latest") return null;
  try {
    const value = JSON.parse(sessionStorage.getItem("araxia.latestAuthorization") ?? "null") as {
      created?: CreatedAction;
      assertion?: Assertion | null;
    } | null;
    return value?.created ? { created: value.created, assertion: value.assertion ?? null } : null;
  } catch {
    return null;
  }
}

/** false on the server and during hydration; true only after the client store snapshot applies. */
function useClientReady(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

function useFocusAuthorization(): FocusAuth | null {
  const ready = useClientReady();
  const auth = useSyncExternalStore(emptySubscribe, readFocusAuthorization, () => null);
  return ready ? auth : null;
}

function useLoginLine(): string {
  const ready = useClientReady();
  const line = useSyncExternalStore(
    emptySubscribe,
    () => `last login: ${new Date().toDateString()} from ble`,
    () => "last login: ble",
  );
  return ready ? line : "last login: ble";
}

export function Console() {
  const now = useNow(250);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [reachable, setReachable] = useState(true);
  const [history, setHistory] = useState<PollSample[]>([]);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [userId, setUserId] = useState(DEMO_USER);
  const initialAuthorization = useFocusAuthorization();
  const loginLine = useLoginLine();
  const [lastAssertion, setLastAssertion] = useState<Assertion | null>(null);

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
  const live = status?.evidence?.presence === "READY";

  return (
    <div className="relative min-h-screen overflow-x-hidden px-3 sm:px-5">
      <div className="shard-field" aria-hidden>
        <i className="shard shard-a" />
        <i className="shard shard-b" />
        <i className="shard shard-c" />
        {live && <i className="shard shard-green" />}
      </div>
      <div className="tty">
        <div className="tty-bar">
          <span className="tty-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          <span>araxia — tty.ble</span>
          <span className="ml-auto">{live ? "READY" : "idle"}</span>
        </div>
        <div className="tty-body">
          <pre className="text-[12px] leading-relaxed text-muted whitespace-pre-wrap">
            {`Araxia 16  tty.ble
# sandbox. not a bank.

${loginLine}`}
          </pre>

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

          <PresencePanel status={status} reachable={reachable} history={history} now={now} />

          <main className="grid min-w-0 grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.75fr)]">
            <ActionPanel
              userId={userId}
              now={now}
              approveBlocker={blocker}
              onAssertion={setLastAssertion}
              initialAuthorization={initialAuthorization}
            />
            <div className="flex min-w-0 flex-col gap-8">
              <details className="group">
                <summary className="cursor-pointer list-none text-[13px] text-muted marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="term-prompt">./attack</span>
                  <span className="comment ml-2 group-open:hidden">closed</span>
                </summary>
                <div className="mt-3">
                  <AttackLab userId={userId} lastAssertion={lastAssertion ?? initialAuthorization?.assertion ?? null} approveBlocker={blocker} />
                </div>
              </details>
              <ExecutionsTable executions={status?.executions ?? []} reachable={reachable} />
            </div>
          </main>

          <section aria-label="Rails" className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2">
            <NessieLedger ledger={status?.nessie} />
            <SolanaPanel solana={status?.solana} />
            <TigerPanel tiger={status?.tiger} />
            <FitbitPanel fitbit={status?.fitbit} liveBleBpm={status?.wearer?.last_median ?? status?.fitbit?.live_ble_bpm} />
          </section>

          <footer className="flex flex-col gap-2 border-t border-line pt-5 text-[12px] text-dim sm:flex-row sm:items-center sm:justify-between">
            <p className="comment">
              {YEAR} small one. demo only. type logout to leave.
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
    </div>
  );
}
