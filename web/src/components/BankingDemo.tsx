"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, DEMO_USER, errorText, isApiError } from "@/app/lib-client/api";
import { createAction, runApproval } from "@/app/lib-client/flows";
import { dollars, secondsUntil } from "@/app/lib-client/format";
import { useNow } from "@/app/lib-client/useNow";
import type { Assertion, CreatedAction, Decision, ExecuteDenied, ExecuteOk, Passkey, StatusResponse } from "@/app/lib-client/types";
import { StateBadge, toneFor } from "./ui";

type Stage = "entry" | "review" | "authorize" | "receipt";
type Result = ExecuteOk | ExecuteDenied;

const AUTH_STORAGE_KEY = "araxia.latestAuthorization";

function statusCopy(status: StatusResponse | null, reachable: boolean): { title: string; detail: string; tone: "ok" | "warn" | "bad" | "off" } {
  if (!reachable) return { title: "The authorization service is unavailable", detail: "Try again when the local service is running.", tone: "bad" };
  if (!status?.evidence) return { title: "Waiting for wearable presence", detail: "Keep the Fitbit Air connected while you prepare the transfer.", tone: "off" };
  if (status.evidence.presence !== "READY") {
    return {
      title: status.evidence.presence === "WARMING" ? "Wearable presence is warming up" : `Wearable presence is ${status.evidence.presence.toLowerCase()}`,
      detail: status.evidence.presence === "WARMING" ? "A few more changing readings are needed before authorization is available." : "Authorization requires a current, changing heart-rate stream.",
      tone: status.evidence.presence === "WARMING" ? "warn" : "bad",
    };
  }
  if (!status.fresh) return { title: "Presence evidence needs to refresh", detail: "The latest evidence is outside the authorization window.", tone: "warn" };
  return { title: "Ready to authorize", detail: "Current wearable presence and wearer continuity checks are available.", tone: "ok" };
}

function money(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";
}

export function BankingDemo() {
  const now = useNow(250);
  const [stage, setStage] = useState<Stage>("entry");
  const [source] = useState("Everyday Checking ···· 4821");
  const [recipient, setRecipient] = useState("RENT");
  const [amount, setAmount] = useState("45.00");
  const [description, setDescription] = useState("September rent");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [reachable, setReachable] = useState(true);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [created, setCreated] = useState<CreatedAction | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [assertion, setAssertion] = useState<Assertion | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<"create" | "approve" | "execute" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const [s, p] = await Promise.all([
        api<StatusResponse>(`/api/status?user=${encodeURIComponent(DEMO_USER)}`),
        api<{ passkeys: Passkey[] }>(`/api/passkeys?user=${encodeURIComponent(DEMO_USER)}`),
      ]);
      if (cancelled) return;
      if (s.status >= 200 && s.status < 300 && s.body) { setStatus(s.body); setReachable(true); } else setReachable(false);
      if (p.status >= 200 && p.status < 300 && p.body && Array.isArray(p.body.passkeys)) setPasskeys(p.body.passkeys);
      timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const readiness = statusCopy(status, reachable);
  const kycBlocked = status?.kyc?.configured === true && !["approved", "completed"].includes(status.kyc.status ?? "");
  const actionExpired = created ? secondsUntil(created.action.exp, now) === 0 : false;
  const amountError = !/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 ? "Enter a positive amount with up to two decimal places." : null;
  const recipientName = recipient === "RENT" ? "RENT · Monthly rent" : "Savings · Internal transfer";
  const receiptStatus = result && result.outcome === "EXECUTED" ? result.status : undefined;
  const receiptMessage = result?.outcome === "DENIED" ? result.reason : result?.outcome === "EXECUTED" ? (result.status === "CONFIRMED" ? "Small One accepted your transfer request." : result.note ?? "The transfer was not confirmed.") : "The transfer was not confirmed.";
  const canApprove = Boolean(created && !actionExpired && reachable && passkeys.length > 0 && status?.evidence?.presence === "READY" && status.fresh && !kycBlocked);

  const startReview = (e: FormEvent) => {
    e.preventDefault(); setError(null);
    if (amountError) { setError(amountError); return; }
    setStage("review");
  };

  const create = async () => {
    setBusy("create"); setError(null);
    const r = await createAction(DEMO_USER, "manual", { op: "nessie.transfer", dst: recipient, amount_minor: Math.round(Number(amount) * 100), ccy: "USD", reason: description.trim() });
    setBusy(null);
    if (r.status >= 200 && r.status < 300 && r.body && !isApiError(r.body)) { setCreated(r.body); setStage("authorize"); }
    else setError(errorText(r, "We could not prepare this transfer"));
  };

  const approve = async () => {
    if (!created) return;
    setBusy("approve"); setError(null);
    const r = await runApproval(DEMO_USER, created.action_digest);
    setBusy(null);
    if (!r.decision) { setError(r.error ?? "Passkey approval failed"); return; }
    setDecision(r.decision);
    if (r.decision.decision === "APPROVED") {
      setAssertion(r.decision.assertion);
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ created, assertion: r.decision.assertion }));
    } else setError(r.decision.reason);
  };

  const execute = async () => {
    if (!assertion) return;
    setBusy("execute"); setError(null);
    const r = await api<Result>("/api/execute", { body: { assertion } });
    setBusy(null);
    if (r.body) setResult(r.body); else setResult({ outcome: "DENIED", reason: errorText(r, "The executor did not respond"), step: "service" });
    setStage("receipt");
    if (r.status === 0) setError("The transfer result is uncertain. Do not retry; check the ledger before taking action.");
  };

  const blocker = useMemo(() => {
    if (!reachable) return "Service unavailable";
    if (kycBlocked) return "Complete Persona verification in the Protocol Console first";
    if (!passkeys.length) return "Register a passkey in the Protocol Console first";
    if (!status?.evidence) return "Waiting for wearable evidence";
    if (status.evidence.presence !== "READY") return `Presence is ${status.evidence.presence.toLowerCase()}`;
    if (!status.fresh) return "Evidence is older than 3 seconds";
    return null;
  }, [kycBlocked, passkeys.length, reachable, status]);

  const reset = () => { setStage("entry"); setCreated(null); setDecision(null); setAssertion(null); setResult(null); setError(null); setDetailsOpen(false); };
  const inspectHref = "/console?focus=latest";

  return (
    <div className="banking-shell">
      <header className="banking-header">
        <div className="banking-header-inner">
          <Link href="/" className="brand-lockup" aria-label="Small One home"><span className="brand-mark" aria-hidden="true" /> <span className="brand-wordmark"><span className="brand-small">small</span> <span className="brand-one">One</span></span></Link>
          <div className="header-meta"><span className="header-user">Amar K. <span className="avatar">AK</span></span></div>
        </div>
      </header>

      <main className="banking-main">
        <div className="banking-topline"><div><p className="eyebrow">Good morning, Amar</p><h1>Move money</h1></div><a className="protocol-link" href={inspectHref}>Protocol Console <span aria-hidden="true">↗</span></a></div>

        <section className="account-card" aria-label="Everyday Checking account">
          <div><p className="eyebrow light">YOUR ACCOUNT</p><h2>Everyday Checking</h2><p className="account-number">...4821</p></div>
          <div className="balance"><span>Available balance</span><strong>$2,840.16</strong><small>As of today</small></div>
        </section>

        <div className="banking-grid">
          <section className="transfer-card" aria-label="Transfer workflow">
            <div className="stepper" aria-label="Transfer progress"><span className={stage !== "entry" ? "complete" : "active"}>1 <b>Transfer details</b></span><i /><span className={stage === "review" ? "active" : stage === "entry" ? "" : "complete"}>2 <b>Review</b></span><i /><span className={stage === "authorize" ? "active" : stage === "receipt" ? "complete" : ""}>3 <b>Authorize</b></span><i /><span className={stage === "receipt" ? "active" : ""}>4 <b>Done</b></span></div>

            {stage === "entry" && <form onSubmit={startReview} className="transfer-form">
              <div><p className="section-kicker">Transfer money</p><h2>Send a transfer</h2><p className="muted">Move money from your checking account to a saved recipient.</p></div>
              <label>From account<select value={source} disabled><option>{source}</option></select></label>
              <label>Recipient<select value={recipient} onChange={(e) => setRecipient(e.target.value)}><option value="RENT">RENT · Monthly rent</option><option value="SAVINGS">Savings · Internal transfer</option></select></label>
              <div className="form-row"><label>Amount<input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-describedby="amount-help" /><span id="amount-help" className="field-hint">USD</span></label><label>Description<input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={64} /></label></div>
              {error && <p className="inline-error" role="alert">{error}</p>}
              <div className="form-actions"><button className="bank-button" type="submit">Continue</button><span className="secure-note">Secure transfer · presence-bound</span></div>
            </form>}

            {stage === "review" && <div className="flow-panel"><p className="section-kicker">Review transfer</p><h2>Check the details before continuing</h2><p className="muted">Nothing has moved yet. You&apos;ll authorize this exact transfer with your passkey.</p><dl className="review-list"><div><dt>From</dt><dd>{source}</dd></div><div><dt>To</dt><dd>{recipientName}</dd></div><div><dt>Amount</dt><dd className="review-amount">{money(amount)}</dd></div><div><dt>Description</dt><dd>{description || "—"}</dd></div><div><dt>Execution network</dt><dd>Small One</dd></div></dl><div className="form-actions"><button className="bank-button" onClick={() => void create()} disabled={busy !== null}>{busy === "create" ? "Preparing…" : "Continue to authorization"}</button><button className="text-button" onClick={() => setStage("entry")}>Edit transfer</button></div>{error && <p className="inline-error" role="alert">{error}</p>}</div>}

            {stage === "authorize" && <div className="flow-panel"><div className="authorization-heading"><div><p className="section-kicker">Araxia authorization</p><h2>Confirm it&apos;s really you</h2></div><StateBadge value={decision?.decision === "APPROVED" ? "APPROVED" : "SECURE CHECK"} tone={decision?.decision === "APPROVED" ? "ok" : "neutral"} /></div><p className="muted">Your passkey approves the exact transfer below. Wearable presence must still be current when the transfer executes.</p><div className="locked-transfer"><span className="lock-icon" aria-hidden="true">⌑</span><div><strong>{money(amount)} to {recipientName}</strong><span>{description || "No description"}</span></div><span className="locked-word">LOCKED</span></div><div className="auth-checks"><div><span className="check-icon">✓</span><div><strong>Wearable presence</strong><span>{status?.evidence?.presence ?? "Waiting"}</span></div></div><div><span className="check-icon">✓</span><div><strong>Wearer continuity</strong><span>{status?.evidence?.drift === "DRIFTING" ? "Needs attention" : status?.evidence?.drift === "NOMINAL" ? "Consistent" : "Not evaluated"}</span></div></div><div><span className="check-icon">✓</span><div><strong>Evidence freshness</strong><span>{status?.evidence ? `${(status.evidence.latest_age_ms / 1000).toFixed(1)} seconds old` : "Waiting for evidence"}</span></div></div><div><span className="check-icon">{decision?.decision === "APPROVED" ? "✓" : "·"}</span><div><strong>Passkey approval</strong><span>{decision?.decision === "APPROVED" ? "Approved" : "Not approved yet"}</span></div></div></div>{error && <p className="inline-error" role="alert">{error}</p>}<div className="form-actions"><button className="bank-button" onClick={() => void approve()} disabled={!canApprove || busy !== null || decision?.decision === "APPROVED"}>{busy === "approve" ? "Waiting for Touch ID…" : decision?.decision === "APPROVED" ? "Transfer approved" : "Approve with passkey"}</button>{blocker && <span className="disabled-reason">{blocker}</span>}</div><div className="authorization-expiry">Authorization expires in {created ? secondsUntil(created.action.exp, now) : "—"} seconds</div><button className="details-toggle" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen}>{detailsOpen ? "Hide" : "Show"} technical details</button>{detailsOpen && <dl className="technical-details"><div><dt>Action digest</dt><dd>{created?.action_digest}</dd></div><div><dt>Assurance</dt><dd>{decision && "assurance" in decision ? decision.assurance : "—"}</dd></div><div><dt>Policy</dt><dd>Exact action · replay protected</dd></div></dl>}{assertion && <div className="form-actions"><button className="bank-button" onClick={() => void execute()} disabled={busy !== null}>{busy === "execute" ? "Executing transfer…" : "Execute transfer"}</button><span className="secure-note">The service checks presence again immediately before execution.</span></div>}</div>}

            {stage === "receipt" && <div className="flow-panel receipt-panel"><div className={receiptStatus === "CONFIRMED" ? "receipt-icon confirmed" : "receipt-icon"} aria-hidden="true">{receiptStatus === "CONFIRMED" ? "✓" : "!"}</div><p className="section-kicker">{receiptStatus === "CONFIRMED" ? "Transfer complete" : receiptStatus === "UNCERTAIN" ? "Transfer status uncertain" : "Transfer not completed"}</p><h2>{receiptStatus === "CONFIRMED" ? "Your transfer is on its way" : receiptStatus === "UNCERTAIN" ? "Check the ledger before retrying" : "We couldn&apos;t complete that transfer"}</h2><p className="muted">{receiptMessage}</p><dl className="receipt-details"><div><dt>Amount</dt><dd>{created ? dollars(created.action.amount_minor, created.action.ccy) : money(amount)}</dd></div><div><dt>Recipient</dt><dd>{recipientName}</dd></div><div><dt>Date and time</dt><dd>{new Date().toLocaleString()}</dd></div>{result && result.outcome === "EXECUTED" && result.providerRef && <div><dt>Transfer reference</dt><dd>{result.providerRef}</dd></div>}</dl><div className="form-actions"><a className="bank-button button-link" href={inspectHref}>Inspect authorization</a><button className="text-button" onClick={reset}>Make another transfer</button></div></div>}
          </section>

          <aside className="side-column"><section className="status-card"><div className="status-card-top"><span className={`status-dot ${readiness.tone}`} /><span className="section-kicker">Araxia status</span></div><h2>{readiness.title}</h2><p>{readiness.detail}</p><div className="status-line"><span>Wearable stream</span><StateBadge value={status?.evidence?.presence ?? "WAITING"} tone={status?.evidence ? toneFor(status.evidence.presence) : "off"} /></div><div className="status-line"><span>Passkey</span><span className="status-value">{passkeys.length ? "Registered" : "Not registered"}</span></div><div className="status-line"><span>Settlement rail</span><span className="status-value">{status?.rails?.nessie ? "Available" : "Unavailable"}</span></div>{!status?.rails?.nessie && <p className="executor-note">Settlement rail is unavailable until the server can reach Nessie.</p>}<a href={inspectHref} className="side-link">View security details <span aria-hidden="true">→</span></a></section><section className="activity-card"><div className="activity-heading"><h2>Recent activity</h2><a href={inspectHref}>See all</a></div>{status?.executions.length ? status.executions.slice(0, 3).map((item) => <div className="activity-row" key={item.id}><span className="activity-icon">↗</span><div><strong>{dollars(item.action.amount_minor, item.action.ccy)} to {item.action.dst === "demo_rent" ? "RENT" : "recipient"}</strong><small>{new Date(item.started_at).toLocaleDateString()} · {item.status.toLowerCase()}</small></div></div>) : <p className="empty-activity">No transfers yet. Your completed transfers will appear here.</p>}</section><div className="disclaimer"><strong>Demo account</strong><p>Small One is a fictional bank. Transfers settle on Capital One Nessie. No real money is moved.</p></div></aside>
        </div>
      </main>
    </div>
  );
}
