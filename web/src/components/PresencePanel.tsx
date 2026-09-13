"use client";

import { useState } from "react";
import { clock, pretty, prefix } from "@/app/lib-client/format";
import type { Presence, StatusResponse } from "@/app/lib-client/types";
import { FILL, KV, Panel, StateBadge, TEXT, toneFor, type Tone } from "./ui";

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

function sampleTone(p: PollSample["presence"]): Tone {
  if (p === "DOWN") return "bad";
  if (p === "NONE") return "off";
  return toneFor(p);
}

export function PresencePanel({ status, reachable, history, now }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const ev = status?.evidence ?? null;

  const headline = !reachable ? "UNREACHABLE" : ev ? ev.presence : "NO EVIDENCE";
  const headlineTone: Tone = !reachable ? "bad" : ev ? toneFor(ev.presence) : "off";
  const ageS = ev ? Math.max(0, (now - ev.received_at) / 1000) : null;
  const frozenS = ev ? Math.floor(ev.frozen_for_ms / 1000) : 0;
  const offWrist = ev !== null && ev.frozen_for_ms >= OFF_WRIST_MS;
  const bridge = status?.bridges[0];

  const padded: Array<PollSample | null> = [
    ...Array<null>(Math.max(0, HISTORY_LEN - history.length)).fill(null),
    ...history,
  ];

  return (
    <Panel title="Presence" aria-live="polite" right={ev && <span className="font-mono text-[10px] normal-case tracking-normal">{prefix(ev.digest, 10)}</span>}>
      <div>
        <div className={`font-display text-[40px] leading-none tracking-[-0.04em] ${TEXT[headlineTone]}`}>{headline}</div>
        <div className="mt-1 text-[12px] text-muted">
          {ev ? (
            <>
              evidence age <span className={`font-mono ${ageS !== null && ageS > 3 ? TEXT.hot : TEXT.neutral}`}>{ageS?.toFixed(1)} s</span>
              <span className="text-dim"> · received {clock(ev.received_at)}</span>
            </>
          ) : reachable ? (
            "waiting for the bridge to post a window"
          ) : (
            "status poll failing; the console keeps retrying every second"
          )}
        </div>
      </div>

      {offWrist && (
        <p role="alert" className={`rounded-sm border border-warn/50 bg-warn/10 px-2 py-1 text-[12px] ${TEXT.warn}`}>
          band may be off-wrist; stale at 30 s
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <KV k="live BLE bpm">
          {status?.wearer?.last_median && status.wearer.last_median >= 30 ? `${status.wearer.last_median}` : "—"}
        </KV>
        <KV k="same value for">{ev ? `${frozenS} s` : "—"}</KV>
        <KV k="distinct values / 30 s">{ev ? ev.distinct_values_30s : "—"}</KV>
        <KV k="drift">{ev ? <StateBadge value={ev.drift} /> : "—"}</KV>
        <KV k="assurance available">
          {status?.assurance ? <StateBadge value={status.assurance} /> : <StateBadge value="none" tone="off" />}
        </KV>
        <KV k="bridge">
          <span title={bridge?.pubkey_hex}>{bridge ? bridge.bridge_id : "—"}</span>
        </KV>
        <KV k="server says fresh">{status ? (status.fresh ? "yes" : "no") : "—"}</KV>
      </dl>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-[11px] text-dim">
          <span>last {HISTORY_LEN} polls</span>
          <span>1 s / block, newest right</span>
        </div>
        <ol className="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-px" aria-label="presence history">
          {padded.map((s, i) => (
            <li
              key={i}
              className={`h-3 rounded-[1px] ${s ? FILL[sampleTone(s.presence)] : "bg-line"}`}
              title={s ? `${clock(s.t)} ${s.presence}` : "no sample"}
            >
              <span className="sr-only">{s ? s.presence : "no sample"}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-auto">
        <button
          type="button"
          className="btn w-full justify-between"
          onClick={() => setDrawerOpen((o) => !o)}
          aria-expanded={drawerOpen}
          aria-controls="evidence-drawer"
        >
          <span>Evidence drawer</span>
          <span className="font-mono text-dim">{drawerOpen ? "−" : "+"}</span>
        </button>
        {drawerOpen && (
          <div id="evidence-drawer" className="mt-2 flex flex-col gap-1">
            <p className="text-[11px] text-muted">
              Window statistics only. No raw physiology leaves the bridge.
            </p>
            <pre className="mono-block max-h-56">{ev ? pretty(ev) : "null"}</pre>
          </div>
        )}
      </div>
    </Panel>
  );
}
