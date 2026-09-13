import type { ReactNode } from "react";
import { pretty } from "@/app/lib-client/format";

export type Tone = "ok" | "warn" | "hot" | "bad" | "off" | "neutral";

const TONE_BY_STATE: Record<string, Tone> = {
  READY: "ok",
  WARMING: "warn",
  STALE: "hot",
  DISCONNECTED: "bad",
  NOMINAL: "ok",
  NOT_EVALUATED: "off",
  DRIFTING: "warn",
  APPROVED: "ok",
  STEP_UP_REQUIRED: "warn",
  DENIED: "bad",
  CONFIRMED: "ok",
  EXECUTED: "ok",
  FAILED: "bad",
  UNCERTAIN: "hot",
  SENT: "warn",
  AAL3: "ok",
  AAL2: "ok",
  AAL1: "warn",
};

export function toneFor(state: string | null | undefined): Tone {
  if (!state) return "off";
  return TONE_BY_STATE[state] ?? "neutral";
}

// Literal class strings so Tailwind can see them.
const BADGE: Record<Tone, string> = {
  ok: "border-ok/50 bg-ok/10 text-ok",
  warn: "border-warn/50 bg-warn/10 text-warn",
  hot: "border-hot/50 bg-hot/10 text-hot",
  bad: "border-bad/50 bg-bad/10 text-bad",
  off: "border-off/50 bg-off/10 text-off",
  neutral: "border-line-2 bg-panel-2 text-fg",
};

export const TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  hot: "text-hot",
  bad: "text-bad",
  off: "text-off",
  neutral: "text-fg",
};

export const FILL: Record<Tone, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  hot: "bg-hot",
  bad: "bg-bad",
  off: "bg-off",
  neutral: "bg-line-2",
};

export function StateBadge({ value, tone, className = "" }: { value: string; tone?: Tone; className?: string }) {
  const t = tone ?? toneFor(value);
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-[11px] font-semibold tracking-wide ${BADGE[t]} ${className}`}
    >
      {value}
    </span>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
  ...rest
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  "aria-live"?: "polite" | "off";
}) {
  return (
    <section className={`panel flex flex-col ${className}`} aria-label={title} {...rest}>
      <header className="panel-title">
        <span>{title}</span>
        {right}
      </header>
      <div className="flex flex-1 flex-col gap-3 p-3">{children}</div>
    </section>
  );
}

export function JsonBlock({ value, status, className = "" }: { value: unknown; status?: number; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {status !== undefined && (
        <span className="absolute top-1 right-1 rounded-sm border border-line-2 bg-panel-2 px-1 font-mono text-[10px] text-muted">
          {status === 0 ? "HTTP —" : `HTTP ${status}`}
        </span>
      )}
      <pre className="mono-block max-h-64">{pretty(value)}</pre>
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <p className={`rounded-sm border border-line px-2 py-1 text-[12px] ${TEXT[tone]}`}>{children}</p>;
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv flex flex-col gap-px">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
