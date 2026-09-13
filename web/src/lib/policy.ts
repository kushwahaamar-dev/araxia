// Decides whether an exact action, approved by a verified passkey, may be
// asserted right now. Presence can deny. Drift can only step up. Nothing here
// ever raises assurance above what the evidence supports.

import { sha256Hex, type Assurance } from "@araxia/verify";

export const POLICY = {
  version: "policy-1",
  evidence_max_age_ms: 3000,
  required_presence: "READY",
  drift_step_up: "DRIFTING",
  op_min_assurance: {
    "nessie.transfer": "AAL2",
    "solana.transfer": "AAL2",
  } as Record<string, Assurance>,
  amount_minor_max: {
    "nessie.transfer": 100_000,
    "solana.transfer": 1_000_000_000,
  } as Record<string, number>,
} as const;

export const POLICY_HASH = sha256Hex(JSON.stringify(POLICY));

export type Presence = "WARMING" | "READY" | "STALE" | "DISCONNECTED";
export type Drift = "NOT_EVALUATED" | "NOMINAL" | "DRIFTING";

export interface EvidenceView {
  digest: string;
  presence: Presence;
  drift: Drift;
  received_at: number;
  latest_age_ms: number;
  frozen_for_ms: number;
  distinct_values_30s: number;
}

export type Decision =
  | { decision: "APPROVED"; assurance: Assurance; reason: string }
  | { decision: "STEP_UP_REQUIRED"; reason: string }
  | { decision: "DENIED"; reason: string };

export function evidenceIsFresh(ev: EvidenceView | null, nowMs: number): ev is EvidenceView {
  return ev !== null && nowMs - ev.received_at <= POLICY.evidence_max_age_ms;
}

export function assuranceFor(ev: EvidenceView | null, nowMs: number): Assurance | null {
  if (!evidenceIsFresh(ev, nowMs)) return null;
  if (ev.presence !== POLICY.required_presence) return null;
  if (ev.drift === "NOMINAL") return "AAL3";
  return "AAL2";
}

export interface DecideInput {
  op: string;
  amountMinor: number;
  passkeyVerified: boolean;
  evidence: EvidenceView | null;
  nowMs: number;
}

const RANK: Record<Assurance, number> = { AAL1: 1, AAL2: 2, AAL3: 3 };

export function decide(input: DecideInput): Decision {
  if (!input.passkeyVerified) return { decision: "DENIED", reason: "passkey not verified for this action" };
  const required = POLICY.op_min_assurance[input.op];
  if (!required) return { decision: "DENIED", reason: `operation not permitted: ${input.op}` };
  const cap = POLICY.amount_minor_max[input.op] ?? 0;
  if (input.amountMinor > cap) return { decision: "DENIED", reason: `amount exceeds policy cap of ${cap} minor units` };

  const ev = input.evidence;
  if (!evidenceIsFresh(ev, input.nowMs)) {
    return { decision: "DENIED", reason: ev ? "presence evidence is older than 3 s" : "no presence evidence" };
  }
  if (ev.presence !== "READY") return { decision: "DENIED", reason: `presence ${ev.presence}` };
  if (ev.drift === POLICY.drift_step_up) {
    return { decision: "STEP_UP_REQUIRED", reason: "wearer stream drifted from enrolled baseline; re-enroll or re-verify" };
  }
  const assurance = assuranceFor(ev, input.nowMs);
  if (assurance === null || RANK[assurance] < RANK[required]) {
    return { decision: "DENIED", reason: `assurance below ${required}` };
  }
  return { decision: "APPROVED", assurance, reason: `presence READY, drift ${ev.drift}` };
}
