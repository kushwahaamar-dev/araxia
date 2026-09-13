"use client";

import { useState } from "react";
import { api } from "@/app/lib-client/api";
import { createAction, runApproval } from "@/app/lib-client/flows";
import { clone } from "@/app/lib-client/format";
import type { Assertion, ExecuteDenied, ExecuteOk, Verdict } from "@/app/lib-client/types";
import { JsonBlock, Panel, TEXT } from "./ui";

interface Props {
  userId: string;
  lastAssertion: Assertion | null;
  approveBlocker: string | null;
}

interface LabEntry {
  id: number;
  label: string;
  hops: Array<{ label: string; status: number; body: unknown }>;
}

export function AttackLab({ userId, lastAssertion, approveBlocker }: Props) {
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LabEntry[]>([]);

  const source = (): Assertion | null => {
    if (paste.trim()) {
      try {
        return JSON.parse(paste) as Assertion;
      } catch {
        return null;
      }
    }
    return lastAssertion;
  };

  const push = (label: string, hops: LabEntry["hops"]) => {
    setLog((prev) => [{ id: Date.now(), label, hops }, ...prev].slice(0, 20));
  };

  const verifyAndExecute = async (label: string, assertion: Assertion) => {
    setBusy(label);
    const v = await api<Verdict>("/api/verify", { body: { assertion } });
    const e = await api<ExecuteOk | ExecuteDenied>("/api/execute", { body: { assertion } });
    push(label, [
      { label: "POST /api/verify", status: v.status, body: v.body },
      { label: "POST /api/execute", status: e.status, body: e.body },
    ]);
    setBusy(null);
  };

  const mutateAmount = async () => {
    const a = source();
    if (!a) return;
    const next = clone(a);
    next.action.amount_minor = a.action.amount_minor * 10;
    await verifyAndExecute("mutate amount ×10", next);
  };

  const mutatePayee = async () => {
    const a = source();
    if (!a) return;
    const next = clone(a);
    next.action.dst = "acct_attacker";
    await verifyAndExecute("change payee", next);
  };

  const replay = async () => {
    const a = source();
    if (!a) return;
    setBusy("replay");
    const e = await api<ExecuteOk | ExecuteDenied>("/api/execute", { body: { assertion: a } });
    push("replay original", [{ label: "POST /api/execute", status: e.status, body: e.body }]);
    setBusy(null);
  };

  const verifyPasted = async () => {
    const a = source();
    if (!a) return;
    setBusy("verify");
    const v = await api<Verdict>("/api/verify", { body: { assertion: a } });
    push("verify pasted", [{ label: "POST /api/verify", status: v.status, body: v.body }]);
    setBusy(null);
  };

  const staleAttempt = async () => {
    setBusy("stale");
    const created = await createAction(userId, "manual", {
      op: "nessie.transfer",
      dst: "RENT",
      amount_minor: 4500,
      ccy: "USD",
      reason: "STALE-TEST",
    });
    const hops: LabEntry["hops"] = [{ label: "POST /api/actions", status: created.status, body: created.body }];
    if (created.status < 200 || created.status >= 300 || !created.body || !("action_digest" in created.body)) {
      push("new action while stale", hops);
      setBusy(null);
      return;
    }
    if (approveBlocker) {
      hops.push({
        label: "approval skipped",
        status: 0,
        body: { reason: `disabled: ${approveBlocker}` },
      });
      push("new action while stale", hops);
      setBusy(null);
      return;
    }
    const approval = await runApproval(userId, created.body.action_digest);
    hops.push(...approval.steps);
    if (approval.error) hops.push({ label: "ceremony", status: 0, body: { error: approval.error } });
    push("new action while stale", hops);
    setBusy(null);
  };

  const hasSource = source() !== null;
  const pasteInvalid = paste.trim().length > 0 && source() === null;

  return (
    <Panel title="Attack lab" className="min-h-0">
      <p className="text-[12px] text-muted">
        Operates on the last issued assertion, or a pasted one. Every hop is the real endpoint.
      </p>
      <label className="flex flex-col gap-px text-[11px] text-dim">
        Paste assertion JSON
        <textarea
          className="field min-h-20 resize-y font-mono"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={lastAssertion ? "leave empty to use the last issued assertion" : "paste an assertion.json"}
        />
      </label>
      {pasteInvalid && <p className={`text-[12px] ${TEXT.bad}`}>pasted JSON is not an assertion</p>}
      <div className="grid grid-cols-1 gap-1.5">
        <button type="button" className="btn btn-danger" disabled={!hasSource || busy !== null} onClick={mutateAmount}>
          {busy === "mutate amount ×10" ? "…" : "Mutate amount ×10 and execute"}
        </button>
        <button type="button" className="btn btn-danger" disabled={!hasSource || busy !== null} onClick={mutatePayee}>
          {busy === "change payee" ? "…" : "Change payee and execute"}
        </button>
        <button type="button" className="btn btn-danger" disabled={!hasSource || busy !== null} onClick={replay}>
          {busy === "replay" ? "…" : "Replay original"}
        </button>
        <button type="button" className="btn" disabled={busy !== null} onClick={staleAttempt}>
          {busy === "stale" ? "…" : "Request new action while stale"}
        </button>
        <button type="button" className="btn" disabled={!hasSource || busy !== null} onClick={verifyPasted}>
          {busy === "verify" ? "…" : "Verify pasted assertion"}
        </button>
      </div>
      <div className="flex flex-col gap-2 overflow-auto">
        {log.length === 0 && <p className="text-[12px] text-dim">no attacks yet</p>}
        {log.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-1 rounded-sm border border-line-2 p-2">
            <div className="font-mono text-[11px] font-semibold tracking-wide uppercase">{entry.label}</div>
            {entry.hops.map((hop, i) => (
              <JsonBlock key={i} value={{ hop: hop.label, body: hop.body }} status={hop.status} />
            ))}
          </div>
        ))}
      </div>
    </Panel>
  );
}
