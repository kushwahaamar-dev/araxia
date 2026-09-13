"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, DEMO_USER, errorText, isApiError } from "@/app/lib-client/api";
import { createAction, runApproval } from "@/app/lib-client/flows";
import { dollars, prefix, secondsUntil } from "@/app/lib-client/format";
import { looksLikeSolanaSig } from "@/app/lib-client/solscan";
import { useNow } from "@/app/lib-client/useNow";
import type { Assertion, CreatedAction, Decision, ExecuteDenied, ExecuteOk, Passkey, StatusResponse } from "@/app/lib-client/types";
import { SolscanLink, StateBadge, toneFor } from "./ui";

type Stage = "entry" | "review" | "authorize" | "receipt";
type Rail = "nessie" | "solana";
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

function moneyUsd(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";
}

function formatSol(lamports: number): string {
  return `${(lamports / 1_000_000_000).toFixed(4)} SOL`;
}

function recipientLabel(dst: string, payees: Array<{ id: string; label: string; nickname: string | null }>): string {
  const hit = payees.find((p) => p.id === dst);
  if (hit) return hit.nickname ?? hit.label;
  if (dst === "demo_rent" || dst === "RENT") return "RENT";
  if (dst === "demo_savings" || dst === "SAVINGS") return "Savings";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(dst)) return prefix(dst, 8);
  return dst.length > 12 ? `${dst.slice(0, 8)}…` : dst;
}

function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function amountToMinor(rail: Rail, amount: string): number | null {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (rail === "solana") {
    const lamports = Math.round(n * 1_000_000_000);
    return lamports >= 1 ? lamports : null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  return Math.round(n * 100);
}

export function BankingDemo() {
  const now = useNow(250);
  const [stage, setStage] = useState<Stage>("entry");
  const [userId, setUserId] = useState(DEMO_USER);
  const [rail, setRail] = useState<Rail>("solana");
  const [recipient, setRecipient] = useState("RENT");
  const [amount, setAmount] = useState("0.001");
  const [memo, setMemo] = useState("HackRice presence pay");
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
        api<StatusResponse>(`/api/status?user=${encodeURIComponent(userId)}`),
        api<{ passkeys: Passkey[] }>(`/api/passkeys?user=${encodeURIComponent(userId)}`),
      ]);
      if (cancelled) return;
      if (s.status >= 200 && s.status < 300 && s.body && "evidence" in s.body) {
        setStatus(s.body);
        setReachable(true);
        const active = s.body.wearer?.active_user;
        if (active && active !== userId && !s.body.wearer?.halt) setUserId(active);
      } else setReachable(false);
      if (p.status >= 200 && p.status < 300 && p.body && Array.isArray(p.body.passkeys)) setPasskeys(p.body.passkeys);
      timer = setTimeout(poll, 1000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [userId]);

  const readiness = statusCopy(status, reachable);
  const kycBlocked = status?.kyc?.configured === true && !["approved", "completed"].includes(status.kyc.status ?? "");
  const halted = status?.wearer?.halt === true;
  const actionExpired = created ? secondsUntil(created.action.exp, now) === 0 : false;
  const minor = amountToMinor(rail, amount);
  const amountError =
    minor === null
      ? rail === "solana"
        ? "Enter a positive SOL amount (e.g. 0.001)."
        : "Enter a positive amount with up to two decimal places."
      : null;
  const memoClean = memo.trim().slice(0, 64);
  const solPayee = status?.solana?.payee ?? status?.rails?.solana ?? null;
  const recipientName =
    rail === "solana"
      ? solPayee
        ? `DEVNET · ${prefix(solPayee, 8)}`
        : "DEVNET payee"
      : recipient === "RENT"
        ? "RENT · Monthly rent"
        : "Savings · Internal transfer";
  const amountLabel = rail === "solana" ? (minor !== null ? formatSol(minor) : `${amount} SOL`) : moneyUsd(amount);
  const networkLabel = rail === "solana" ? "Solana devnet (on-chain)" : "Small One · Nessie";
  const receiptStatus = result && result.outcome === "EXECUTED" ? result.status : undefined;
  const receiptMessage =
    result?.outcome === "DENIED"
      ? result.reason
      : result?.outcome === "EXECUTED"
        ? result.status === "CONFIRMED"
          ? rail === "solana"
            ? "Confirmed on Solana devnet. Open the signature on Solscan."
            : "Small One accepted your transfer request."
          : (result.note ?? "The transfer was not confirmed.")
        : "The transfer was not confirmed.";
  const canApprove = Boolean(
    created && !actionExpired && reachable && passkeys.length > 0 && status?.evidence?.presence === "READY" && status.fresh && !kycBlocked && !halted,
  );

  const fallbackName = userId.replace(/^u_/, "").replace(/^./, (c) => c.toUpperCase());
  const holder = status?.wearer?.team.find((p) => p.user_id === userId)?.label ?? fallbackName;
  const firstName = holder.split(/\s+/)[0] ?? holder;
  const account = status?.nessie?.source ?? null;
  const accountName = account?.nickname ?? account?.label ?? "Checking";
  const accountTail = account ? `...${account.id.slice(-4)}` : "";
  const source = accountTail ? `${accountName} ${accountTail}` : accountName;
  const nessieBalance = account?.balance_minor != null ? dollars(account.balance_minor, "USD") : "—";
  const solLamports = status?.solana?.lamports ?? null;
  const solAddress = status?.solana?.address ?? status?.rails?.solana ?? null;
  const presenceOk = status?.evidence?.presence === "READY";
  const continuityOk = !halted && status?.evidence?.drift !== "DRIFTING";
  const freshOk = status?.fresh === true;
  const txRef = result && result.outcome === "EXECUTED" ? result.providerRef : null;
  const onChain = Boolean(txRef && looksLikeSolanaSig(txRef));

  const pickRail = (next: Rail) => {
    setRail(next);
    setError(null);
    if (next === "solana") {
      setAmount((a) => (/^\d+(\.\d{1,2})?$/.test(a) && Number(a) >= 1 ? "0.001" : a));
      if (!memoClean) setMemo("HackRice presence pay");
    } else {
      setAmount((a) => (Number(a) < 1 ? "45.00" : a));
    }
  };

  const startReview = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (amountError) {
      setError(amountError);
      return;
    }
    if (!memoClean) {
      setError("Write a short memo for this transfer.");
      return;
    }
    if (rail === "solana" && !solPayee) {
      setError("Solana payee is not configured on the server.");
      return;
    }
    setStage("review");
  };

  const create = async () => {
    if (minor === null || !memoClean) return;
    setBusy("create");
    setError(null);
    const r = await createAction(userId, "manual", {
      op: rail === "solana" ? "solana.transfer" : "nessie.transfer",
      dst: rail === "solana" ? "DEVNET" : recipient,
      amount_minor: minor,
      ccy: rail === "solana" ? "SOL" : "USD",
      reason: memoClean,
    });
    setBusy(null);
    if (r.status >= 200 && r.status < 300 && r.body && !isApiError(r.body)) {
      setCreated(r.body);
      setStage("authorize");
    } else setError(errorText(r, "We could not prepare this transfer"));
  };

  const approve = async () => {
    if (!created) return;
    setBusy("approve");
    setError(null);
    const r = await runApproval(userId, created.action_digest);
    setBusy(null);
    if (!r.decision) {
      setError(r.error ?? "Passkey approval failed");
      return;
    }
    setDecision(r.decision);
    if (r.decision.decision === "APPROVED") {
      setAssertion(r.decision.assertion);
      sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ created, assertion: r.decision.assertion }));
    } else setError(r.decision.reason);
  };

  const execute = async () => {
    if (!assertion) return;
    setBusy("execute");
    setError(null);
    const r = await api<Result>("/api/execute", { body: { assertion } });
    setBusy(null);
    if (r.body) setResult(r.body);
    else setResult({ outcome: "DENIED", reason: errorText(r, "The executor did not respond"), step: "service" });
    setStage("receipt");
    if (r.status === 0) setError("The transfer result is uncertain. Do not retry; check the ledger before taking action.");
  };

  const blocker = useMemo(() => {
    if (!reachable) return "Service unavailable";
    if (actionExpired) return "This authorization expired. Start over.";
    if (halted) return "The wearer changed. Confirm who is wearing the band in the Protocol Console.";
    if (kycBlocked) return "Complete Persona verification in the Protocol Console first";
    if (!passkeys.length) return "Register a passkey in the Protocol Console first";
    if (!status?.evidence) return "Waiting for wearable evidence";
    if (status.evidence.presence !== "READY") return `Presence is ${status.evidence.presence.toLowerCase()}`;
    if (!status.fresh) return "Evidence is older than 3 seconds";
    if (rail === "solana" && !status.rails?.solana) return "Solana relayer is not configured";
    if (rail === "nessie" && !status.rails?.nessie) return "Nessie settlement rail is unavailable";
    return null;
  }, [actionExpired, halted, kycBlocked, passkeys.length, rail, reachable, status]);

  const reset = () => {
    setStage("entry");
    setCreated(null);
    setDecision(null);
    setAssertion(null);
    setResult(null);
    setError(null);
    setDetailsOpen(false);
  };
  const inspectHref = "/?focus=latest";

  return (
    <div className="banking-shell">
      <header className="banking-header">
        <div className="banking-header-inner">
          <Link href="/bank" className="brand-lockup" aria-label="Small One home">
            <span className="brand-mark" aria-hidden="true" />{" "}
            <span className="brand-wordmark">
              <span className="brand-small">small</span> <span className="brand-one">One</span>
            </span>
          </Link>
          <div className="header-meta">
            <span className="header-user">
              {holder} <span className="avatar">{initials(holder)}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="banking-main">
        <div className="banking-topline">
          <div>
            <p className="eyebrow">Welcome back, {firstName}</p>
            <h1>Move money</h1>
          </div>
          <a className="protocol-link" href={inspectHref}>
            Protocol Console <span aria-hidden="true">↗</span>
          </a>
        </div>

        <section className="account-card" aria-label={`${accountName} account`}>
          <div>
            <p className="eyebrow light">YOUR ACCOUNT</p>
            <h2>{accountName}</h2>
            <p className="account-number">{accountTail || "Sandbox"}</p>
            {solAddress && (
              <p className="account-number" style={{ marginTop: 10, opacity: 0.85 }}>
                Solana ·{" "}
                <SolscanLink kind="account" id={solAddress}>
                  {prefix(solAddress, 8)}
                </SolscanLink>
              </p>
            )}
          </div>
          <div className="balance">
            <span>Nessie balance</span>
            <strong>{nessieBalance}</strong>
            <small>
              {status?.nessie?.balances_settled
                ? "Seeded Nessie balance is frozen · display applies confirmed Araxia settlements"
                : "Sandbox ledger · seeded balances stay put until a confirmed settlement lands"}
            </small>
            <span style={{ marginTop: 14 }}>Solana balance</span>
            <strong style={{ fontSize: 22 }}>{solLamports == null ? "—" : formatSol(solLamports)}</strong>
            <small>Devnet · updates after each on-chain send</small>
          </div>
        </section>

        <div className="banking-grid">
          <section className="transfer-card" aria-label="Transfer workflow">
            <div className="stepper" aria-label="Transfer progress">
              <span className={stage !== "entry" ? "complete" : "active"}>
                1 <b>Transfer details</b>
              </span>
              <i />
              <span className={stage === "review" ? "active" : stage === "entry" ? "" : "complete"}>
                2 <b>Review</b>
              </span>
              <i />
              <span className={stage === "authorize" ? "active" : stage === "receipt" ? "complete" : ""}>
                3 <b>Authorize</b>
              </span>
              <i />
              <span className={stage === "receipt" ? "active" : ""}>
                4 <b>Done</b>
              </span>
            </div>

            {stage === "entry" && (
              <form onSubmit={startReview} className="transfer-form">
                <div>
                  <p className="section-kicker">Transfer money</p>
                  <h2>Send a transfer</h2>
                  <p className="muted">Pick an amount and memo. Solana settles on-chain with a Solscan signature; Nessie records a sandbox ledger entry.</p>
                </div>
                <label>
                  Settlement rail
                  <select
                    value={rail}
                    onChange={(e) => pickRail(e.target.value as Rail)}
                  >
                    <option value="solana">Solana · on-chain + Solscan</option>
                    <option value="nessie">Small One · Nessie sandbox</option>
                  </select>
                </label>
                <label>
                  From account
                  <select value={rail === "solana" ? solAddress ?? "relayer" : source} disabled>
                    <option>{rail === "solana" ? (solAddress ? `Relayer ${prefix(solAddress, 8)}` : "Solana relayer") : source}</option>
                  </select>
                </label>
                {rail === "nessie" ? (
                  <label>
                    Recipient
                    <select value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                      <option value="RENT">RENT · Monthly rent</option>
                      <option value="SAVINGS">Savings · Internal transfer</option>
                    </select>
                  </label>
                ) : (
                  <label>
                    Recipient
                    <select value="DEVNET" disabled>
                      <option value="DEVNET">{recipientName}</option>
                    </select>
                  </label>
                )}
                <div className="form-row">
                  <label>
                    Amount
                    <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-describedby="amount-help" />
                    <span id="amount-help" className="field-hint">
                      {rail === "solana" ? "SOL" : "USD"}
                    </span>
                  </label>
                  <label>
                    Memo
                    <input
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      maxLength={64}
                      placeholder="what this payment is for"
                      required
                    />
                  </label>
                </div>
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="form-actions">
                  <button className="bank-button" type="submit">
                    Continue
                  </button>
                  <span className="secure-note">Secure transfer · presence-bound</span>
                </div>
              </form>
            )}

            {stage === "review" && (
              <div className="flow-panel">
                <p className="section-kicker">Review transfer</p>
                <h2>Check the details before continuing</h2>
                <p className="muted">Nothing has moved yet. You&apos;ll authorize this exact transfer with your passkey.</p>
                <dl className="review-list">
                  <div>
                    <dt>From</dt>
                    <dd>{rail === "solana" ? (solAddress ? prefix(solAddress, 12) : "relayer") : source}</dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd>{recipientName}</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd className="review-amount">{amountLabel}</dd>
                  </div>
                  <div>
                    <dt>Memo</dt>
                    <dd>{memoClean}</dd>
                  </div>
                  <div>
                    <dt>Execution network</dt>
                    <dd>{networkLabel}</dd>
                  </div>
                </dl>
                <div className="form-actions">
                  <button className="bank-button" onClick={() => void create()} disabled={busy !== null}>
                    {busy === "create" ? "Preparing…" : "Continue to authorization"}
                  </button>
                  <button className="text-button" onClick={() => setStage("entry")}>
                    Edit transfer
                  </button>
                </div>
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            )}

            {stage === "authorize" && (
              <div className="flow-panel">
                <div className="authorization-heading">
                  <div>
                    <p className="section-kicker">Araxia authorization</p>
                    <h2>Confirm it&apos;s really you</h2>
                  </div>
                  <StateBadge value={decision?.decision === "APPROVED" ? "APPROVED" : "SECURE CHECK"} tone={decision?.decision === "APPROVED" ? "ok" : "neutral"} />
                </div>
                <p className="muted">Your passkey approves the exact transfer below. Wearable presence must still be current when the transfer executes.</p>
                <div className="locked-transfer">
                  <span className="lock-icon" aria-hidden="true">
                    ⌑
                  </span>
                  <div>
                    <strong>
                      {amountLabel} to {recipientName}
                    </strong>
                    <span>{memoClean}</span>
                  </div>
                  <span className="locked-word">LOCKED</span>
                </div>
                <div className="auth-checks">
                  <div>
                    <span className="check-icon">{presenceOk ? "✓" : "·"}</span>
                    <div>
                      <strong>Wearable presence</strong>
                      <span>{status?.evidence?.presence ?? "Waiting"}</span>
                    </div>
                  </div>
                  <div>
                    <span className="check-icon">{continuityOk ? "✓" : "!"}</span>
                    <div>
                      <strong>Wearer continuity</strong>
                      <span>
                        {halted
                          ? "Wearer changed"
                          : status?.evidence?.drift === "DRIFTING"
                            ? "Needs attention"
                            : status?.evidence?.drift === "NOMINAL"
                              ? "Consistent"
                              : "Not evaluated"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="check-icon">{freshOk ? "✓" : "·"}</span>
                    <div>
                      <strong>Evidence freshness</strong>
                      <span>{status?.evidence ? `${(status.evidence.latest_age_ms / 1000).toFixed(1)} seconds old` : "Waiting for evidence"}</span>
                    </div>
                  </div>
                  <div>
                    <span className="check-icon">{decision?.decision === "APPROVED" ? "✓" : "·"}</span>
                    <div>
                      <strong>Passkey approval</strong>
                      <span>{decision?.decision === "APPROVED" ? "Approved" : "Not approved yet"}</span>
                    </div>
                  </div>
                </div>
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="form-actions">
                  <button className="bank-button" onClick={() => void approve()} disabled={!canApprove || busy !== null || decision?.decision === "APPROVED"}>
                    {busy === "approve" ? "Waiting for Touch ID…" : decision?.decision === "APPROVED" ? "Transfer approved" : "Approve with passkey"}
                  </button>
                  {blocker && !assertion && <span className="disabled-reason">{blocker}</span>}
                  {!assertion && (
                    <button className="text-button" onClick={reset} disabled={busy !== null}>
                      Start over
                    </button>
                  )}
                </div>
                <div className="authorization-expiry">
                  {actionExpired ? "This authorization has expired." : `Authorization expires in ${created ? secondsUntil(created.action.exp, now) : "—"} seconds`}
                </div>
                <button className="details-toggle" onClick={() => setDetailsOpen((v) => !v)} aria-expanded={detailsOpen}>
                  {detailsOpen ? "Hide" : "Show"} technical details
                </button>
                {detailsOpen && (
                  <dl className="technical-details">
                    <div>
                      <dt>Action digest</dt>
                      <dd>{created?.action_digest}</dd>
                    </div>
                    <div>
                      <dt>Assurance</dt>
                      <dd>{decision && "assurance" in decision ? decision.assurance : "—"}</dd>
                    </div>
                    <div>
                      <dt>Policy</dt>
                      <dd>Exact action · replay protected</dd>
                    </div>
                  </dl>
                )}
                {assertion && (
                  <div className="form-actions">
                    <button className="bank-button" onClick={() => void execute()} disabled={busy !== null}>
                      {busy === "execute" ? "Executing transfer…" : "Execute transfer"}
                    </button>
                    <span className="secure-note">The service checks presence again immediately before execution.</span>
                  </div>
                )}
              </div>
            )}

            {stage === "receipt" && (
              <div className="flow-panel receipt-panel">
                <div className={receiptStatus === "CONFIRMED" ? "receipt-icon confirmed" : "receipt-icon"} aria-hidden="true">
                  {receiptStatus === "CONFIRMED" ? "✓" : "!"}
                </div>
                <p className="section-kicker">
                  {receiptStatus === "CONFIRMED" ? "Transfer complete" : receiptStatus === "UNCERTAIN" ? "Transfer status uncertain" : "Transfer not completed"}
                </p>
                <h2>
                  {receiptStatus === "CONFIRMED"
                    ? "Your transfer is on its way"
                    : receiptStatus === "UNCERTAIN"
                      ? "Check the ledger before retrying"
                      : "We couldn't complete that transfer"}
                </h2>
                <p className="muted">{receiptMessage}</p>
                <dl className="receipt-details">
                  <div>
                    <dt>Amount</dt>
                    <dd>{created ? (created.action.ccy === "SOL" ? formatSol(created.action.amount_minor) : dollars(created.action.amount_minor, created.action.ccy)) : amountLabel}</dd>
                  </div>
                  <div>
                    <dt>Recipient</dt>
                    <dd>{recipientName}</dd>
                  </div>
                  <div>
                    <dt>Memo</dt>
                    <dd>{created?.action.reason ?? memoClean}</dd>
                  </div>
                  <div>
                    <dt>Date and time</dt>
                    <dd>{new Date().toLocaleString()}</dd>
                  </div>
                  {txRef && (
                    <div>
                      <dt>{onChain ? "Solana signature" : "Transfer reference"}</dt>
                      <dd>
                        {onChain ? (
                          <SolscanLink kind="tx" id={txRef}>
                            {prefix(txRef, 16)} ↗
                          </SolscanLink>
                        ) : (
                          txRef
                        )}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="form-actions">
                  {onChain && txRef && (
                    <a className="bank-button button-link" href={`https://solscan.io/tx/${encodeURIComponent(txRef)}?cluster=devnet`} rel="noreferrer" target="_blank">
                      Open on Solscan
                    </a>
                  )}
                  <a className="bank-button button-link" href={inspectHref}>
                    Inspect authorization
                  </a>
                  <button className="text-button" onClick={reset}>
                    Make another transfer
                  </button>
                </div>
              </div>
            )}
          </section>

          <aside className="side-column">
            <section className="status-card">
              <div className="status-card-top">
                <span className={`status-dot ${readiness.tone}`} />
                <span className="section-kicker">Araxia status</span>
              </div>
              <h2>{readiness.title}</h2>
              <p>{readiness.detail}</p>
              <div className="status-line">
                <span>Wearable stream</span>
                <StateBadge value={status?.evidence?.presence ?? "WAITING"} tone={status?.evidence ? toneFor(status.evidence.presence) : "off"} />
              </div>
              <div className="status-line">
                <span>Passkey</span>
                <span className="status-value">{passkeys.length ? "Registered" : "Not registered"}</span>
              </div>
              <div className="status-line">
                <span>Nessie</span>
                <span className="status-value">{status?.rails?.nessie ? "Available" : "Unavailable"}</span>
              </div>
              <div className="status-line">
                <span>Solana</span>
                <span className="status-value">{status?.rails?.solana ? "Available" : "Unavailable"}</span>
              </div>
              <a href={inspectHref} className="side-link">
                View security details <span aria-hidden="true">→</span>
              </a>
            </section>
            <section className="activity-card">
              <div className="activity-heading">
                <h2>Recent activity</h2>
                <a href={inspectHref}>See all</a>
              </div>
              {status?.executions.length ? (
                status.executions.slice(0, 3).map((item) => (
                  <div className="activity-row" key={item.id}>
                    <span className="activity-icon">↗</span>
                    <div>
                      <strong>
                        {item.action.ccy === "SOL" ? formatSol(item.action.amount_minor) : dollars(item.action.amount_minor, item.action.ccy)} to{" "}
                        {recipientLabel(item.action.dst, status?.nessie?.payees ?? [])}
                      </strong>
                      <small>
                        {new Date(item.started_at).toLocaleDateString()} · {item.rail} · {item.status.toLowerCase()}
                        {item.provider_ref && looksLikeSolanaSig(item.provider_ref) ? (
                          <>
                            {" · "}
                            <SolscanLink kind="tx" id={item.provider_ref}>
                              solscan
                            </SolscanLink>
                          </>
                        ) : null}
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <p className="empty-activity">No transfers yet. Your completed transfers will appear here.</p>
              )}
            </section>
            <div className="disclaimer">
              <strong>Demo account</strong>
              <p>
                Small One is fictional. Nessie records transfers but leaves seeded balances frozen; Araxia adjusts the displayed balance from confirmed settlements. Solana sends real devnet lamports; every signature opens on Solscan.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
