// Wire shapes accepted by the API routes. Validation only; semantics live in
// the verifier and the policy.

import { ASSURANCE, type Assertion, type SignedEnvelope } from "@araxia/verify";
import { z } from "zod";
import { HttpError } from "./http";

export const hex64 = z.string().regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters");

// Loose on purpose: unknown keys pass through so the verifier judges exactly
// the bytes the caller sent. A stripped-then-verified assertion would hide
// tampering that the CLI verifier reports.
export const canonicalActionSchema = z.looseObject({
  v: z.literal(1),
  op: z.string().min(1),
  aud: z.string().min(1),
  src: z.string().min(1),
  dst: z.string().min(1),
  amount_minor: z.number().int(),
  ccy: z.string().min(1),
  reason: z.string(),
  nonce: z.string().min(1),
  exp: z.number().int(),
});

export const assertionSchema = z.looseObject({
  iss: z.string().min(1),
  kid: z.string().min(1),
  sub: z.string().min(1),
  action: canonicalActionSchema,
  action_digest: z.string().min(1),
  passkey_cred_id: z.string(),
  approved_at: z.number().int(),
  evidence_digest: z.string(),
  assurance: z.enum(ASSURANCE),
  nonce: z.string().min(1),
  iat: z.number().int(),
  nbf: z.number().int(),
  exp: z.number().int(),
  policy_hash: z.string(),
  sig: z.string().min(1),
}) satisfies z.ZodType<Assertion>;

export const signedEnvelopeSchema = z.object({
  kid: z.string().min(1),
  payload: z.string().min(1),
  sig: z.string().min(1),
}) satisfies z.ZodType<SignedEnvelope>;

export function requireUserParam(req: Request): string {
  const user = new URL(req.url).searchParams.get("user");
  if (!user) throw new HttpError(400, "user query parameter required");
  return user;
}
