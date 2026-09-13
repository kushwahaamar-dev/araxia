import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { getAction } from "@/lib/actions";
import { getDb, logEvent, logSecurity, nowS } from "@/lib/db";
import { latestEvidence } from "@/lib/evidence";
import { errorResponse, HttpError, parseBody } from "@/lib/http";
import { issueAssertion } from "@/lib/issuer";
import { verifyApproval } from "@/lib/passkeys";
import { decide, POLICY_HASH } from "@/lib/policy";
import { wearerHalted } from "@/lib/wearers";

const body = z.object({
  user_id: z.string().min(1).max(128),
  action_digest: z.string().regex(/^[0-9a-f]{64}$/),
  challenge_id: z.string().min(1),
  response: z.object({ id: z.string().min(1) }).passthrough(),
});

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof body>;
  try {
    parsed = await parseBody(req, body);
  } catch (e) {
    return errorResponse(e);
  }
  const { user_id, action_digest, challenge_id, response } = parsed;

  let credId: string;
  try {
    credId = (await verifyApproval(user_id, action_digest, challenge_id, response as unknown as AuthenticationResponseJSON)).cred_id;
  } catch (e) {
    const reason = e instanceof Error ? e.message : "verification failed";
    logEvent("approve.rejected", { user_id, action_digest, challenge_id, reason });
    logSecurity("passkey.failed", { user_id, reason });
    return Response.json({ error: reason }, { status: 400 });
  }

  try {
    const stored = getAction(action_digest);
    if (!stored || stored.user_id !== user_id) throw new HttpError(404, "unknown action");
    if (stored.exp <= nowS()) throw new HttpError(410, "action expired");
    const { action } = stored;

    if (wearerHalted()) {
      const evidence = latestEvidence(user_id);
      logEvent("approve.denied", { user_id, action_digest, cred_id: credId, reason: "wearer changed" });
      return Response.json({
        decision: "DENIED",
        reason: "user has been changed; switch wearer and re-verify before approving",
        evidence,
      });
    }
    const evidence = latestEvidence(user_id);
    const d = decide({ op: action.op, amountMinor: action.amount_minor, passkeyVerified: true, evidence, nowMs: Date.now() });

    if (d.decision !== "APPROVED") {
      logEvent(d.decision === "DENIED" ? "approve.denied" : "approve.step_up", {
        user_id,
        action_digest,
        cred_id: credId,
        reason: d.reason,
      });
      return Response.json({ decision: d.decision, reason: d.reason, evidence });
    }

    // decide() only approves on fresh evidence, so it is present here.
    if (!evidence) throw new Error("approved without evidence");
    const assertion = issueAssertion({
      sub: user_id,
      action,
      passkeyCredId: credId,
      evidenceDigest: evidence.digest,
      assurance: d.assurance,
      approvedAtS: nowS(),
      policyHash: POLICY_HASH,
    });
    getDb()
      .prepare(
        "INSERT INTO assertions (nonce, action_digest, user_id, assurance, assertion_json, issued_at, exp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(assertion.nonce, action_digest, user_id, assertion.assurance, JSON.stringify(assertion), assertion.iat, assertion.exp);
    logEvent("assertion.issued", { nonce: assertion.nonce, assurance: assertion.assurance, user_id, action_digest });

    return Response.json({ decision: "APPROVED", assurance: d.assurance, assertion, evidence, reason: d.reason });
  } catch (e) {
    return errorResponse(e);
  }
}
