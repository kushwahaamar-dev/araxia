"use client";

import { useCallback, useEffect, useState } from "react";
import { api, DEMO_USER } from "@/app/lib-client/api";
import type { Assertion, Passkey, Presence, StatusResponse } from "@/app/lib-client/types";
import { useNow } from "@/app/lib-client/useNow";
import { ActionPanel } from "./ActionPanel";
import { AttackLab } from "./AttackLab";
import { ExecutionsTable } from "./ExecutionsTable";
import { PresencePanel, type PollSample } from "./PresencePanel";
import { TopBar } from "./TopBar";

const STATUS_POLL_MS = 1000;
const HISTORY_LEN = 60;

function approveBlocker(status: StatusResponse | null, reachable: boolean, hasPasskey: boolean): string | null {
  if (!reachable) return "service unreachable";
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

  const loadPasskeys = useCallback(async () => {
    const r = await api<{ passkeys: Passkey[] }>(`/api/passkeys?user=${encodeURIComponent(DEMO_USER)}`);
    if (r.status >= 200 && r.status < 300 && r.body && Array.isArray(r.body.passkeys)) setPasskeys(r.body.passkeys);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const [r, pk] = await Promise.all([
        api<StatusResponse>(`/api/status?user=${encodeURIComponent(DEMO_USER)}`),
        api<{ passkeys: Passkey[] }>(`/api/passkeys?user=${encodeURIComponent(DEMO_USER)}`),
      ]);
      if (cancelled) return;
      let presence: Presence | "NONE" | "DOWN" = "DOWN";
      if (r.status >= 200 && r.status < 300 && r.body && "evidence" in r.body) {
        setStatus(r.body);
        setReachable(true);
        presence = r.body.evidence?.presence ?? "NONE";
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
  }, []);

  const hasPasskey = passkeys.length > 0;
  const blocker = approveBlocker(status, reachable, hasPasskey);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col gap-3 p-3">
      <TopBar
        userId={DEMO_USER}
        reachable={reachable}
        issuerKid={status?.issuer.kid ?? null}
        policyHash={status?.policy_hash ?? null}
        passkeys={passkeys}
        kyc={status?.kyc}
        rails={status?.rails}
        onPasskeysChanged={loadPasskeys}
      />
      <main className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)_380px]">
        <PresencePanel status={status} reachable={reachable} history={history} now={now} />
        <ActionPanel
          userId={DEMO_USER}
          now={now}
          approveBlocker={blocker}
          onAssertion={setLastAssertion}
        />
        <AttackLab userId={DEMO_USER} lastAssertion={lastAssertion} approveBlocker={blocker} />
      </main>
      <ExecutionsTable executions={status?.executions ?? []} reachable={reachable} />
    </div>
  );
}
