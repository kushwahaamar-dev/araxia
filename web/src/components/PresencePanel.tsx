"use client";

import { useState } from "react";
import { clock, pretty, prefix } from "@/app/lib-client/format";
import type { Presence, StatusResponse } from "@/app/lib-client/types";
import { StickWrist, stickMode } from "./StickWrist";

export interface PollSample {
  t: number;
  presence: Presence | "NONE" | "DOWN";
}

interface Props {
  status: StatusResponse | null;
  reachable: boolean;
  history: PollSample[];
  now: number;
}

const OFF_WRIST_MS = 15_000;
const HISTORY_LEN = 60;

const WORD: Record<string, string> = {
  READY: "READY",
  WARMING: "WARMING",
  STALE: "STALE",
  DISCONNECTED: "OFF",
  UNREACHABLE: "DOWN",
  "NO EVIDENCE": "WAIT",
};

function tickClass(p: PollSample["presence"]): string {
  if (p === "READY") return "text-white";
  if (p === "STALE" || p === "DOWN" || p === "DISCONNECTED") return "text-white/30";
  return "text-white/55";
}

export function PresencePanel({ status, reachable, history, now }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const ev = status?.evidence ?? null;
  const code = !reachable ? "UNREACHABLE" : ev ? ev.presence : "NO EVIDENCE";
  const headline = WORD[code] ?? code;
  const ageS = ev ? Math.max(0, (now - ev.received_at) / 1000) : null;
  const frozenS = ev ? Math.floor(ev.frozen_for_ms / 1000) : 0;
  const offWrist = ev !== null && ev.frozen_for_ms >= OFF_WRIST_MS;
  const bpm = status?.wearer?.last_median && status.wearer.last_median >= 30 ? status.wearer.last_median : null;
  const wearerName =
    status?.wearer?.team.find((p) => p.user_id === status.wearer?.active_user)?.label ?? status?.wearer?.active_user;
  const live = ev?.presence === "READY";

  const padded: Array<PollSample | null> = [
    ...Array<null>(Math.max(0, HISTORY_LEN - history.length)).fill(null),
    ...history,
  ];

  return (
    <section aria-label="Presence" aria-live="polite" className="relative overflow-hidden">
      {live && <div className="ready-wash" aria-hidden />}
      <div className="crack absolute top-6 left-[18%]" aria-hidden />
      <p className="term-prompt relative text-[12px]">watch --wrist</p>
      <div className="relative mt-1 flex flex-wrap items-end gap-8">
        <h1
          className={`font-display text-[clamp(3.8rem,12vw,7.2rem)] leading-[0.78] font-normal text-white ${live ? "headline-ready" : ""}`}
        >
          {headline}
          {live && <span className="cursor-block ml-2 align-middle" aria-hidden />}
        </h1>
        <StickWrist mode={stickMode(code)} bpm={bpm} />
      </div>
      <p className="comment relative mt-4 max-w-xl text-[12px]">
        {ev
          ? `${wearerName ?? "someone"} may approve an exact action. the bank never sees a heartbeat.`
          : reachable
            ? "waiting for the bridge to post a window."
            : "the service is not answering."}
      </p>
      {offWrist && (
        <p role="alert" className="relative mt-2 text-[13px] text-white">
          ! band may be off-wrist. frozen value goes stale at 30s.
        </p>
      )}

      <dl className="dump relative mt-5">
        <dt>bpm</dt>
        <dd className="font-display text-[2.6rem] leading-none text-white">{bpm ?? "—"}</dd>
        <dt>age</dt>
        <dd>{ageS !== null ? `${ageS.toFixed(1)}s` : "no packet"}</dd>
        <dt>frozen</dt>
        <dd>{ev ? `${frozenS}s` : "—"}</dd>
        <dt>n/30s</dt>
        <dd>{ev ? ev.distinct_values_30s : "—"}</dd>
        <dt>fresh</dt>
        <dd>{status?.fresh ? "yes" : "no"}</dd>
        <dt>aal</dt>
        <dd>{status?.assurance ?? "none"}</dd>
        {ev && (
          <>
            <dt>digest</dt>
            <dd>{prefix(ev.digest, 10)}</dd>
          </>
        )}
      </dl>

      <ol className="relative mt-5 flex flex-wrap gap-px font-mono text-[13px] leading-none" aria-label="presence history">
        {padded.map((s, i) => (
          <li key={i} title={s ? `${clock(s.t)} ${s.presence}` : "no sample"} className={s ? tickClass(s.presence) : "text-white/20"}>
            {s?.presence === "READY" ? "#" : s ? "." : "·"}
          </li>
        ))}
      </ol>

      <div className="relative mt-3">
        <button type="button" className="text-[12px] text-dim hover:text-white" onClick={() => setDrawerOpen((o) => !o)} aria-expanded={drawerOpen}>
          {drawerOpen ? "$ less window" : "$ cat window"}
        </button>
      </div>
      {drawerOpen && <pre className="mono-block relative mt-2 max-h-56">{ev ? pretty(ev) : "null"}</pre>}
    </section>
  );
}
