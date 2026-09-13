import { latestEvidence, listBridges } from "@/lib/evidence";
import { listExecutionsForUser } from "@/lib/executions";
import { solanaAddress } from "@/lib/executors/solana";
import { errorResponse } from "@/lib/http";
import { getIssuer } from "@/lib/issuer";
import { getKyc, personaConfigured } from "@/lib/persona";
import { assuranceFor, evidenceIsFresh, POLICY_HASH } from "@/lib/policy";
import { requireUserParam } from "@/lib/schemas";

export async function GET(req: Request): Promise<Response> {
  try {
    const user = requireUserParam(req);
    const now = Date.now();
    const evidence = latestEvidence(user);
    const issuer = getIssuer();
    return Response.json({
      user,
      evidence,
      fresh: evidenceIsFresh(evidence, now),
      assurance: assuranceFor(evidence, now),
      issuer: { kid: issuer.kid, public_key_hex: issuer.publicKeyHex },
      policy_hash: POLICY_HASH,
      bridges: listBridges(user),
      executions: listExecutionsForUser(user, 10),
      kyc: { configured: personaConfigured(), ...((getKyc(user) ?? { status: "none" }) as object) },
      rails: {
        nessie: Boolean(process.env.NESSIE_API_KEY),
        solana: solanaAddress(),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
