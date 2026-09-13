// What Araxia commits on-chain. Never plaintext identity or physiology:
// keyed hashes of the wearer, their enrolled BPM range, the presence evidence
// that was fresh at execution, and the signed assertion itself. The memo sits
// in the same Solana transaction as the transfer, so the explorer shows the
// money and the commitments together.

import { actionDigest, canonicalize, sha256Hex, type Assertion, type JsonValue } from "@araxia/verify";
import type { EvidenceView } from "./policy";
import { commitHex, getIssuer } from "./issuer";

export const COMMITMENT_VERSION = "araxia/1";
export const MEMO_MAX = 500;

export interface WearerRange {
  centroid: number | null;
  sd: number | null;
}

export interface Commitment {
  v: string;
  /** assertion nonce; claimed once in SQLite */
  n: string;
  /** sha256 of the canonical action the passkey signed (first 16 bytes) */
  a: string;
  /** sha256 of the full signed assertion (first 16 bytes) */
  s: string;
  /** keyed commitment to the wearer's user id */
  u: string;
  /** keyed commitment to the wearer's enrolled BPM range (centroid, sd); "none" if unenrolled */
  w: string;
  /** sha256 of the signed presence envelope that was fresh at execute (first 16 bytes) */
  e: string;
  /** presence state / assurance level at execute */
  p: string;
  /** issuer key id */
  k: string;
  /** human memo from the action */
  m: string;
}

export function userCommitment(userId: string): string {
  return commitHex("user", userId);
}

export function rangeCommitment(userId: string, range: WearerRange): string {
  if (range.centroid === null || range.sd === null) return "none";
  return commitHex("range", `${userId}|${range.centroid}|${range.sd}`);
}

export function assertionDigest(assertion: Assertion): string {
  return sha256Hex(canonicalize(assertion as unknown as JsonValue));
}

export function buildCommitment(assertion: Assertion, evidence: EvidenceView, range: WearerRange): Commitment {
  return {
    v: COMMITMENT_VERSION,
    n: assertion.nonce,
    a: actionDigest(assertion.action).slice(0, 32),
    s: assertionDigest(assertion).slice(0, 32),
    u: userCommitment(assertion.sub),
    w: rangeCommitment(assertion.sub, range),
    e: evidence.digest.slice(0, 32),
    p: `${evidence.presence}/${assertion.assurance}`,
    k: getIssuer().kid,
    m: assertion.action.reason,
  };
}

const ORDER: Array<keyof Commitment> = ["n", "a", "s", "u", "w", "e", "p", "k", "m"];

export function encodeMemo(c: Commitment): string {
  const head = `${c.v} ` + ORDER.filter((k) => k !== "m").map((k) => `${k}=${c[k]}`).join(" ");
  const room = MEMO_MAX - head.length - " m=".length;
  const memo = c.m.replace(/\s+/g, " ").trim().slice(0, Math.max(0, room));
  return memo ? `${head} m=${memo}` : head;
}

export function decodeMemo(memo: string): Commitment | null {
  const [v, ...rest] = memo.split(" ");
  if (v !== COMMITMENT_VERSION) return null;
  const out: Partial<Commitment> = { v, m: "" };
  for (let i = 0; i < rest.length; i++) {
    const kv = rest[i]!;
    const eq = kv.indexOf("=");
    if (eq < 1) return null;
    const key = kv.slice(0, eq) as keyof Commitment;
    if (key === "m") {
      out.m = [kv.slice(eq + 1), ...rest.slice(i + 1)].join(" ");
      break;
    }
    if (!ORDER.includes(key)) return null;
    out[key] = kv.slice(eq + 1);
  }
  for (const k of ORDER) if (k !== "m" && typeof out[k] !== "string") return null;
  return out as Commitment;
}
