"use client";

import { useState, type FormEvent } from "react";
import { api, errorText, isApiError } from "@/app/lib-client/api";
import { createAction, runApproval } from "@/app/lib-client/flows";
import { dollars, secondsUntil } from "@/app/lib-client/format";
import { looksLikeSolanaAddress } from "@/app/lib-client/solscan";
import type {
  Assertion,
  CreatedAction,
  Decision,
  ExecuteDenied,
  ExecuteOk,
  ProposeResponse,
} from "@/app/lib-client/types";
import { AssertionPanel } from "./AssertionPanel";
import { Pipeline, type PipelineState } from "./Pipeline";
import { JsonBlock, KV, Notice, Panel, SolscanLink, StateBadge, TEXT, toneFor } from "./ui";

function chainField(aud: string, value: string) {
  if (aud === "solana-devnet" && looksLikeSolanaAddress(value)) {
    return <SolscanLink kind="account" id={value}>{value}</SolscanLink>;
  }
  return value;
}

interface Props {
  userId: string;
  now: number;
  approveBlocker: string | null;
  onAssertion: (a: Assertion) => void;
}

type Tab = "manual" | "gemini";
type Busy = "propose" | "create" | "approve" | "execute" | null;

const OPS = ["nessie.transfer", "solana.transfer"] as const;
const EMPTY_PIPELINE: PipelineState = { stamps: {}, terminal: null, providerRef: null, note: null };

function parseDollars(input: string): number | null {
  const s = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const minor = Math.round(Number(s) * 100);
  return minor > 0 ? minor : null;
}

function parseLamports(input: string): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

export function ActionPanel({ userId, now, approveBlocker, onAssertion }: Props) {
  const [tab, setTab] = useState<Tab>("manual");
  const [op, setOp] = useState<string>(OPS[0]);
  const [payee, setPayee] = useState("RENT");
  const [amount, setAmount] = useState("45.00");
  const [reason, setReason] = useState("RENT");
  const [prompt, setPrompt] = useState("Pay this month's rent of $45 to RENT.");
  const [explanation, setExplanation] = useState<string | null>(null);

  const [created, setCreated] = useState<CreatedAction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [assertion, setAssertion] = useState<Assertion | null>(null);
  const [exec, setExec] = useState<{ status: number; body: unknown } | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState>(EMPTY_PIPELINE);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  const startFlow = (c: CreatedAction, note: string | null) => {
    setCreated(c);
    setExplanation(note);
    setDecision(null);
    setAssertion(null);
    setExec(null);
    setPipeline({ ...EMPTY_PIPELINE, stamps: { PROPOSED: Date.now() } });
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    const minor = op === "solana.transfer" ? parseLamports(amount) : parseDollars(amount);
    if (minor === null) {
      setError(
        op === "solana.transfer"
          ? "amount must be a positive integer of lamports"
          : "amount must be a positive dollar value with at most two decimals",
      );
      return;
    }
    setBusy("create");
    setError(null);
    const r = await createAction(userId, "manual", {
      op,
      dst: payee.trim(),
      amount_minor: minor,
      ccy: op === "solana.transfer" ? "SOL" : "USD",
      reason: reason.trim(),
    });
    setBusy(null);
    if (r.status >= 200 && r.status < 300 && r.body && !isApiError(r.body)) startFlow(r.body, null);
    else setError(errorText(r, "could not create action"));
  };

  const onPropose = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("propose");
    setError(null);
    const r = await api<ProposeResponse>("/api/propose", { body: { user_id: userId, prompt } });
    setBusy(null);
    if (r.status === 404) {
      setError("Gemini proposal not available");
      return;
    }
    if (r.status >= 200 && r.status < 300 && r.body && !isApiError(r.body)) {
      startFlow({ action: r.body.action, action_digest: r.body.action_digest }, r.body.explanation);
    } else {
      setError(errorText(r, "proposal failed"));
    }
  };

  const onApprove = async () => {
    if (!created) return;
    setBusy("approve");
    setError(null);
    const r = await runApproval(userId, created.action_digest);
    setBusy(null);
    if (!r.decision) {
      setError(r.error ?? "approval failed");
      return;
    }
    setDecision(r.decision);
    if (r.decision.decision === "APPROVED") {
      const t = Date.now();
      setAssertion(r.decision.assertion);
      onAssertion(r.decision.assertion);
      setPipeline((p) => ({ ...p, stamps: { ...p.stamps, APPROVED: t, ASSERTED: t } }));
    }
  };

  const onExecute = async () => {
    if (!assertion) return;
    setBusy("execute");
    setError(null);
    setPipeline((p) => ({ ...p, stamps: { ...p.stamps, SENT: Date.now() } }));
    const r = await api<ExecuteOk | ExecuteDenied>("/api/execute", { body: { assertion } });
    setBusy(null);
    setExec({ status: r.status, body: r.body });
    const t = Date.now();
    const body = r.body;
    if (r.status === 200 && body && "outcome" in body && body.outcome === "EXECUTED") {
      setPipeline((p) => ({
        stamps: { ...p.stamps, [body.status]: t },
        terminal: body.status,
        providerRef: body.providerRef,
        note: body.note ?? null,
      }));
    } else if (body && "outcome" in body && body.outcome === "DENIED") {
      setPipeline((p) => ({
        stamps: { ...p.stamps, DENIED: t },
        terminal: "DENIED",
        providerRef: null,
        note: `${body.reason} (step: ${body.step})`,
      }));
    } else {
      setPipeline((p) => ({
        stamps: { ...p.stamps, UNCERTAIN: t },
        terminal: "UNCERTAIN",
        providerRef: null,
        note: r.status === 0 ? "no response from the service; the transfer may or may not have been sent" : errorText(r, "unexpected response"),
      }));
    }
  };

  const actionExpired = created !== null && secondsUntil(created.action.exp, now) === 0;
  const approveDisabled: string | null = !created
    ? "create an action first"
    : decision?.decision === "APPROVED"
      ? "already approved; create a new action to approve again"
      : actionExpired
        ? "action expired; create a new one"
        : approveBlocker;

  const tabClass = (t: Tab) =>
    `px-3 py-1 text-[12px] font-medium border-b-2 ${tab === t ? "border-accent text-white" : "border-transparent text-muted hover:text-fg"}`;

  return (
    <Panel title="Action" right={created && <StateBadge value={explanation ? "GEMINI" : "MANUAL"} tone="neutral" />}>
      <div role="tablist" aria-label="action source" className="flex border-b border-line">
        <button role="tab" type="button" id="tab-manual" aria-selected={tab === "manual"} aria-controls="tabpanel-manual" className={tabClass("manual")} onClick={() => setTab("manual")}>
          Manual
        </button>
        <button role="tab" type="button" id="tab-gemini" aria-selected={tab === "gemini"} aria-controls="tabpanel-gemini" className={tabClass("gemini")} onClick={() => setTab("gemini")}>
          Gemini
        </button>
      </div>

      {tab === "manual" ? (
        <form id="tabpanel-manual" role="tabpanel" aria-labelledby="tab-manual" className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_1fr_1fr_auto]" onSubmit={onCreate}>
          <label className="flex flex-col gap-px text-[11px] text-dim">
            op
            <select
              className="field"
              value={op}
              onChange={(e) => {
                const next = e.target.value;
                setOp(next);
                if (next === "solana.transfer") {
                  setPayee("DEVNET");
                  setAmount("5000");
                  setReason("DEVNET");
                } else {
                  setPayee("RENT");
                  setAmount("45.00");
                  setReason("RENT");
                }
              }}
            >
              {OPS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-px text-[11px] text-dim">
            payee
            <input className="field font-mono" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="RENT or SAVINGS" required />
          </label>
          <label className="flex flex-col gap-px text-[11px] text-dim">
            {op === "solana.transfer" ? "lamports" : "amount (USD)"}
            <input className="field font-mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="45.00" required />
          </label>
          <label className="flex flex-col gap-px text-[11px] text-dim">
            reason
            <input className="field font-mono" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="September rent" required maxLength={64} />
          </label>
          <button type="submit" className="btn btn-primary self-end" disabled={busy !== null}>
            {busy === "create" ? "Creating…" : "Create action"}
          </button>
        </form>
      ) : (
        <form id="tabpanel-gemini" role="tabpanel" aria-labelledby="tab-gemini" className="flex flex-col gap-2" onSubmit={onPropose}>
          <label className="flex flex-col gap-px text-[11px] text-dim">
            Ask the agent
            <textarea
              className="field min-h-16 resize-y"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Pay this month's rent of $45 to RENT."
              required
            />
          </label>
          <div className="flex items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy !== null}>
              {busy === "propose" ? "Proposing…" : "Propose"}
            </button>
            <span className="text-[11px] text-dim">The agent only proposes. Nothing moves without the ceremony below.</span>
          </div>
        </form>
      )}

      {error && (
        <Notice tone="bad">
          <span role="alert">{error}</span>
        </Notice>
      )}

      {created && (
        <div className="flex flex-col gap-2 rounded-sm border border-line-2 bg-panel-2 p-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Signed fields</span>
            <span className={`font-mono text-[11px] ${actionExpired ? TEXT.bad : TEXT.neutral}`}>
              {actionExpired ? "action expired" : `exp in ${secondsUntil(created.action.exp, now)} s`}
            </span>
          </div>
          {explanation && <p className="text-[12px] text-muted">{explanation}</p>}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
            <KV k="op">{created.action.op}</KV>
            <KV k="aud">{created.action.aud}</KV>
            <KV k="src">{chainField(created.action.aud, created.action.src)}</KV>
            <KV k="dst">{chainField(created.action.aud, created.action.dst)}</KV>
            <KV k="amount_minor">{created.action.amount_minor}</KV>
            <KV k="amount">{dollars(created.action.amount_minor, created.action.ccy)}</KV>
            <KV k="ccy">{created.action.ccy}</KV>
            <KV k="reason">{created.action.reason}</KV>
            <div className="col-span-2 md:col-span-4">
              <KV k="nonce">{created.action.nonce}</KV>
            </div>
            <div className="col-span-2 md:col-span-4">
              <KV k="action_digest">{created.action_digest}</KV>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" onClick={onApprove} disabled={approveDisabled !== null || busy !== null}>
              {busy === "approve" ? "Touch the authenticator…" : "Approve with passkey"}
            </button>
            {approveDisabled && <span className="text-[12px] text-muted">disabled: {approveDisabled}</span>}
          </div>
        </div>
      )}

      {decision && (
        <div className="flex flex-col gap-1" aria-live="polite">
          <div className="flex items-center gap-3">
            <span className={`font-mono text-[26px] leading-none font-bold ${TEXT[toneFor(decision.decision)]}`}>{decision.decision}</span>
            {decision.decision === "APPROVED" && <StateBadge value={decision.assurance} />}
          </div>
          <p className="text-[12px] text-muted">{decision.reason}</p>
        </div>
      )}

      {assertion && (
        <>
          <AssertionPanel assertion={assertion} now={now} />
          <div className="flex items-center gap-3">
            <button type="button" className="btn btn-primary" onClick={onExecute} disabled={busy !== null || exec !== null}>
              {busy === "execute" ? "Executing…" : "Execute (agent)"}
            </button>
            <span className="text-[11px] text-dim">The executor re-verifies the assertion and claims the nonce exactly once.</span>
          </div>
        </>
      )}

      {pipeline.stamps.PROPOSED !== undefined && created && <Pipeline state={pipeline} />}
      {exec && <JsonBlock value={exec.body} status={exec.status} />}
    </Panel>
  );
}
