import { getDb } from "@/lib/db";
import { latestEvidence, listBridges } from "@/lib/evidence";
import { listExecutionsForUser } from "@/lib/executions";
import { getSolanaSnapshot, solanaAddress } from "@/lib/executors/solana";
import { getTigerSnapshot, pushLocalAuthToTiger, restoreAuthFromTiger } from "@/lib/tiger";
import { errorResponse } from "@/lib/http";
import { getIssuer } from "@/lib/issuer";
import { getFitbitSnapshot } from "@/lib/fitbit";
import { getNessieLedger } from "@/lib/nessie";
import { applyNessieSettlements } from "@/lib/nessieSettlements";
import { listPasskeys } from "@/lib/passkeys";
import { getKyc, isPersonaApproved, personaConfigured } from "@/lib/persona";
import { assuranceFor, evidenceIsFresh, POLICY_HASH } from "@/lib/policy";
import { requireUserParam } from "@/lib/schemas";
import { getWearerSession, team } from "@/lib/wearers";

export async function GET(req: Request): Promise<Response> {
  try {
    const user = requireUserParam(req);
    const now = Date.now();
    const evidence = latestEvidence(user);
    const issuer = getIssuer();
    const nessie = applyNessieSettlements(await getNessieLedger());
    const wearer = getWearerSession();
    if (!process.env.VITEST) {
      const sqlite = getDb();
      await restoreAuthFromTiger(sqlite).catch(() => 0);
      pushLocalAuthToTiger(sqlite);
    }
    const [fitbit, tiger, solana] = await Promise.all([
      getFitbitSnapshot(wearer.last_median >= 30 ? wearer.last_median : null),
      getTigerSnapshot(),
      getSolanaSnapshot(),
    ]);
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
        nessie: nessie.configured,
        solana: solanaAddress(),
      },
      nessie,
      fitbit,
      tiger,
      solana,
      wearer: {
        ...wearer,
        team: team().map((p) => ({
          ...p,
          kyc: getKyc(p.user_id)?.status ?? "none",
          ready: isPersonaApproved(p.user_id),
          passkeys: listPasskeys(p.user_id).length,
        })),
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
