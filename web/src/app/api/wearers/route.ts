import { z } from "zod";
import { copyLatestEvidenceTo } from "@/lib/evidence";
import { errorResponse, HttpError, parseBody } from "@/lib/http";
import { getKyc, isPersonaApproved } from "@/lib/persona";
import { getWearerSession, labelFor, switchWearer, TEAM } from "@/lib/wearers";

const body = z.object({
  user_id: z.enum(["u_amar", "u_laksh", "u_jagriti"]),
  enroll: z.boolean().optional(),
});

export async function GET(): Promise<Response> {
  const session = getWearerSession();
  return Response.json({
    session,
    team: TEAM.map((p) => ({
      ...p,
      kyc: getKyc(p.user_id)?.status ?? "none",
      ready: isPersonaApproved(p.user_id),
    })),
  });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id, enroll } = await parseBody(req, body);
    if (!isPersonaApproved(user_id)) {
      throw new HttpError(403, `complete Persona verification for ${labelFor(user_id)} before switching`);
    }
    const session = switchWearer(user_id, enroll === true);
    copyLatestEvidenceTo(user_id);
    return Response.json({ session, team: TEAM });
  } catch (e) {
    return errorResponse(e);
  }
}
