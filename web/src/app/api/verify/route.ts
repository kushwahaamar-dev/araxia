// Read-only verifier endpoint for the attack lab. Reports a verdict and
// nothing else: no claim, no execution, no state change.

import { verifyAssertion } from "@araxia/verify";
import { z } from "zod";
import { nowS } from "@/lib/db";
import { errorResponse, parseBody } from "@/lib/http";
import { getIssuer } from "@/lib/issuer";
import { assertionSchema } from "@/lib/schemas";

const bodySchema = z.object({ assertion: assertionSchema, aud: z.string().min(1).optional() });

export async function POST(req: Request): Promise<Response> {
  let body;
  try {
    body = await parseBody(req, bodySchema);
  } catch (e) {
    return errorResponse(e);
  }
  const issuer = getIssuer();
  const checkedAt = nowS();
  const verdict = verifyAssertion(body.assertion, {
    issuerPublicKeyHex: issuer.publicKeyHex,
    expectedKid: issuer.kid,
    expectedAud: body.aud,
    nowS: checkedAt,
  });
  return Response.json({ ok: verdict.ok, reason: verdict.reason, kid: issuer.kid, checked_at: checkedAt });
}
