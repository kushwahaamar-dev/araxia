// Independent verifier for Araxia assertions and bridge evidence envelopes.
// Pure functions, no I/O, Node crypto only. The executor, the relayer and the
// CLI all import this; nothing else in the system decides what "valid" means.

import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";

export const MAX_ASSERTION_LIFETIME_S = 60;
export const MAX_ACTION_LIFETIME_S = 120;
export const ASSURANCE = ["AAL1", "AAL2", "AAL3"] as const;
export type Assurance = (typeof ASSURANCE)[number];

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

export interface SignedEnvelope {
  kid: string;
  payload: string;
  sig: string;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

// RFC 8785 for the subset we emit: no floats, keys sorted by UTF-16 code units.
export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) throw new TypeError("floats are not allowed in canonical payloads");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k] as JsonValue)}`).join(",")}}`;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function ed25519Verify(publicKeyHex: string, message: Uint8Array, signature: Uint8Array): boolean {
  if (publicKeyHex.length !== 64) return false;
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
    format: "der",
    type: "spki",
  });
  try {
    return nodeVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

export interface Verdict {
  ok: boolean;
  reason: string;
}

const ok: Verdict = { ok: true, reason: "valid" };
const fail = (reason: string): Verdict => ({ ok: false, reason });

export function actionDigest(action: CanonicalAction): string {
  return sha256Hex(canonicalize(action as unknown as JsonValue));
}

export function assertionSigningBytes(assertion: Omit<Assertion, "sig">): Uint8Array {
  return Buffer.from(canonicalize(assertion as unknown as JsonValue), "utf8");
}

export interface VerifyAssertionOptions {
  issuerPublicKeyHex: string;
  expectedKid?: string;
  expectedAud?: string;
  nowS?: number;
}

export function verifyAssertion(assertion: Assertion, opts: VerifyAssertionOptions): Verdict {
  const now = opts.nowS ?? Math.floor(Date.now() / 1000);
  const { sig, ...unsigned } = assertion;
  if (typeof sig !== "string" || sig.length === 0) return fail("missing signature");
  if (opts.expectedKid !== undefined && assertion.kid !== opts.expectedKid) return fail("unexpected kid");

  let signable: Uint8Array;
  try {
    signable = assertionSigningBytes(unsigned);
  } catch (e) {
    return fail(`not canonicalizable: ${(e as Error).message}`);
  }
  if (!ed25519Verify(opts.issuerPublicKeyHex, signable, Buffer.from(sig, "base64"))) {
    return fail("signature mismatch");
  }

  const a = assertion.action;
  if (!a || a.v !== 1) return fail("unsupported action version");
  if (!Number.isInteger(a.amount_minor) || a.amount_minor <= 0) return fail("amount_minor must be a positive integer");
  if (actionDigest(a) !== assertion.action_digest) return fail("action_digest does not match action");
  if (opts.expectedAud !== undefined && a.aud !== opts.expectedAud) return fail("audience mismatch");
  if (!ASSURANCE.includes(assertion.assurance)) return fail("unknown assurance level");

  for (const f of ["iat", "nbf", "exp", "approved_at"] as const) {
    if (!Number.isInteger(assertion[f])) return fail(`${f} must be an integer`);
  }
  if (assertion.exp - assertion.iat > MAX_ASSERTION_LIFETIME_S) return fail("assertion lifetime exceeds 60 s");
  if (assertion.nbf > assertion.iat) return fail("nbf after iat");
  if (now < assertion.nbf) return fail("assertion not yet valid");
  if (now >= assertion.exp) return fail("assertion expired");
  if (!Number.isInteger(a.exp) || a.exp - assertion.approved_at > MAX_ACTION_LIFETIME_S) return fail("action lifetime exceeds 120 s");
  if (now >= a.exp) return fail("action expired");
  if (typeof assertion.nonce !== "string" || assertion.nonce.length < 16) return fail("nonce too short");
  return ok;
}

export interface EnvelopeVerdict extends Verdict {
  payload?: Record<string, JsonValue>;
}

export function verifyEnvelope(envelope: SignedEnvelope, bridgePublicKeyHex: string): EnvelopeVerdict {
  if (typeof envelope.payload !== "string") return fail("payload must be the canonical string");
  const raw = Buffer.from(envelope.payload, "utf8");
  if (!ed25519Verify(bridgePublicKeyHex, raw, Buffer.from(envelope.sig, "base64"))) {
    return fail("signature mismatch");
  }
  let payload: Record<string, JsonValue>;
  try {
    payload = JSON.parse(envelope.payload) as Record<string, JsonValue>;
  } catch {
    return fail("payload is not JSON");
  }
  if (canonicalize(payload) !== envelope.payload) return fail("payload is not in canonical form");
  return { ok: true, reason: "valid", payload };
}
