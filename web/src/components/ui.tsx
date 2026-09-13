"use client";

import { useState, type ReactNode } from "react";
import { pretty, prefix } from "@/app/lib-client/format";
import { solscanAccount, solscanTx } from "@/app/lib-client/solscan";

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
  COMPLETED: "ok",
  PENDING: "warn",
  LIVE: "ok",
  DOWN: "bad",
  UNREACHABLE: "bad",
  SOURCE: "ok",
  PAYEE: "neutral",
  AAL3: "ok",
  AAL2: "ok",
  AAL1: "warn",
};

export function toneFor(state: string | null | undefined): Tone {
  if (!state) return "off";
  return TONE_BY_STATE[state] ?? "neutral";
}

export const TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  hot: "text-hot",
  bad: "text-bad",
  off: "text-off",
  neutral: "text-fg",
};

export function StateBadge({ value, tone, className = "" }: { value: string; tone?: Tone; className?: string }) {
  const t = tone ?? toneFor(value);
  return (
    <span className={`badge ${TEXT[t]} ${className}`}>
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
      <div className="flex flex-1 flex-col gap-3 pt-1">{children}</div>
    </section>
  );
}

export function JsonBlock({ value, status, className = "" }: { value: unknown; status?: number; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {status !== undefined && (
        <p className="comment mb-1">{status === 0 ? "http —" : `http ${status}`}</p>
      )}
      <pre className="mono-block max-h-64">{pretty(value)}</pre>
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <p className={`text-[12px] ${TEXT[tone]}`}>! {children}</p>;
}

export function Copyable({
  value,
  children,
  label,
}: {
  value: string;
  children: ReactNode;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex min-w-0 items-center gap-1 font-mono text-inherit hover:text-accent"
      title={copied ? "copied" : label ?? "copy"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          setCopied(false);
        }
      }}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span className="text-[10px] text-dim">{copied ? "copied" : ""}</span>
    </button>
  );
}

export function SolscanLink({
  kind,
  id,
  children,
}: {
  kind: "tx" | "account";
  id: string;
  children?: ReactNode;
}) {
  return (
    <a
      className="inline-flex items-center underline decoration-dotted underline-offset-2 hover:text-accent"
      href={kind === "tx" ? solscanTx(id) : solscanAccount(id)}
      rel="noreferrer"
      target="_blank"
    >
      {children ?? prefix(id, 8)}
    </a>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv flex flex-col gap-px">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}
