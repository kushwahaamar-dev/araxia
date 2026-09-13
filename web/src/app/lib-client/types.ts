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
