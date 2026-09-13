export type Presence = "WARMING" | "READY" | "STALE" | "DISCONNECTED";
export type Drift = "NOT_EVALUATED" | "NOMINAL" | "DRIFTING";
export type Assurance = "AAL1" | "AAL2" | "AAL3";
export type ExecStatus = "SENT" | "CONFIRMED" | "FAILED" | "UNCERTAIN";

export interface EvidenceView {
  digest: string;
  presence: Presence;
  drift: Drift;
  received_at: number;
  latest_age_ms: number;
  frozen_for_ms: number;
  distinct_values_30s: number;
}

export interface CanonicalAction {
  v: 1;
  op: string;
  aud: string;
  src: string;
  dst: string;
  amount_minor: number;
  ccy: string;
  reason: string;
  nonce: string;
  exp: number;
}

export interface Assertion {
  iss: string;
  kid: string;
  sub: string;
  action: CanonicalAction;
  action_digest: string;
  passkey_cred_id: string;
  approved_at: number;
  evidence_digest: string;
  assurance: Assurance;
  nonce: string;
  iat: number;
  nbf: number;
  exp: number;
  policy_hash: string;
  sig: string;
}

export interface ExecutionRow {
  id: number;
  assertion_nonce: string;
  rail: string;
  status: ExecStatus;
  provider_ref: string | null;
  started_at: number;
  finished_at: number | null;
  assurance: Assurance;
  action: CanonicalAction;
}

export interface StatusResponse {
  user: string;
  evidence: EvidenceView | null;
  fresh: boolean;
  assurance: Assurance | null;
  issuer: { kid: string; public_key_hex: string };
  policy_hash: string;
  bridges: Array<{ bridge_id: string; pubkey_hex: string }>;
  executions: ExecutionRow[];
  kyc?: {
    configured: boolean;
    user_id?: string;
    inquiry_id?: string | null;
    status?: string;
    hosted_url?: string | null;
  };
  rails?: { nessie: boolean; solana: string | null };
  nessie?: {
    configured: boolean;
    reachable: boolean;
    sandbox: true;
    base_url: string;
    source: {
      id: string;
      label: string;
      role: "source" | "payee";
      type: string | null;
      nickname: string | null;
      balance_minor: number | null;
    } | null;
    payees: Array<{
      id: string;
      label: string;
      role: "source" | "payee";
      type: string | null;
      nickname: string | null;
      balance_minor: number | null;
    }>;
    transfers: Array<{
      id: string;
      status: string;
      amount_minor: number | null;
      description: string | null;
      transaction_date: string | null;
    }>;
    error: string | null;
    fetched_at: number;
    balances_settled?: boolean;
  };
  fitbit?: {
    configured: boolean;
    authorized: boolean;
    reachable: boolean;
    source: "google-health-api";
    live_gate: "ble-packets";
    display_name: string | null;
    live_ble_bpm: number | null;
    cloud_resting_bpm: number | null;
    cloud_latest_intraday_bpm: number | null;
    metrics: Array<{ key: string; label: string; available: boolean; value: string | null; note: string }>;
    error: string | null;
    fetched_at: number;
  };
  tiger?: {
    configured: boolean;
    reachable: boolean;
    source: "tigerdata";
    users: number;
    passkeys: number;
    evidence: number;
    executions: number;
    events: number;
    health: number;
    solana: number;
    recent: Array<{ ts: number; kind: string }>;
    error: string | null;
    fetched_at: number;
  };
  solana?: {
    configured: boolean;
    reachable: boolean;
    address: string | null;
    lamports: number | null;
    airdrop: string | null;
    explorer: string | null;
    payee: string | null;
    last_txs: Array<{ signature: string; nonce: string; dst: string; lamports: number; confirmed_at: number }>;
    error: string | null;
    fetched_at: number;
  };
  wearer?: {
    active_user: string;
    guessed_user: string;
    halt: boolean;
    last_median: number;
    team: Array<{ user_id: string; label: string; kyc: string; ready: boolean; passkeys: number }>;
  };
}

export interface Passkey {
  cred_id: string;
  created_at: number;
}

export interface CreatedAction {
  action: CanonicalAction;
  action_digest: string;
}

export interface ProposeResponse extends CreatedAction {
  explanation: string;
}

export interface ApproveOptionsResponse {
  challenge_id: string;
  options: unknown;
}

export type Decision =
  | {
      decision: "APPROVED";
      assurance: Assurance;
      assertion: Assertion;
      evidence: EvidenceView | null;
      reason: string;
    }
  | {
      decision: "STEP_UP_REQUIRED" | "DENIED";
      reason: string;
      evidence: EvidenceView | null;
    };

export interface ExecuteOk {
  outcome: "EXECUTED";
  status: "CONFIRMED" | "FAILED" | "UNCERTAIN";
  providerRef: string | null;
  executionId: number;
  response: unknown;
  note?: string;
}

/** Mirror of web/src/lib/commitment.ts; what the Solana memo carries. */
export interface OnChainCommitment {
  v: string;
  n: string;
  a: string;
  s: string;
  u: string;
  w: string;
  e: string;
  p: string;
  k: string;
  m: string;
}

export function commitmentOf(response: unknown): OnChainCommitment | null {
  if (typeof response !== "object" || response === null) return null;
  const c = (response as { commitment?: unknown }).commitment;
  if (typeof c !== "object" || c === null) return null;
  const o = c as Record<string, unknown>;
  return typeof o.v === "string" && typeof o.n === "string" && typeof o.u === "string" ? (o as unknown as OnChainCommitment) : null;
}

export interface ExecuteDenied {
  outcome: "DENIED";
  reason: string;
  step: string;
}

export interface Verdict {
  ok: boolean;
  reason: string;
}

export interface ApiError {
  error: string;
}
