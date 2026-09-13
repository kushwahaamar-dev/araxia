import { z } from "zod";
import { copyLatestEvidenceTo } from "@/lib/evidence";
import { errorResponse, HttpError, parseBody } from "@/lib/http";
import { listPasskeys } from "@/lib/passkeys";
import { getKyc, isPersonaApproved } from "@/lib/persona";
import { addTeamMember, getWearerSession, isTeamMember, labelFor, switchWearer, team } from "@/lib/wearers";

const body = z
  .object({
    user_id: z.string().min(1).max(64).optional(),
    label: z.string().min(1).max(40).optional(),
    enroll: z.boolean().optional(),
  })
  .refine((b) => Boolean(b.user_id) !== Boolean(b.label), { message: "send user_id to switch or label to add" });

function teamView() {
  return team().map((p) => ({
    ...p,
    kyc: getKyc(p.user_id)?.status ?? "none",
    ready: isPersonaApproved(p.user_id),
    passkeys: listPasskeys(p.user_id).length,
  }));
}

export async function GET(): Promise<Response> {
  return Response.json({ session: getWearerSession(), team: teamView() });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id, label, enroll } = await parseBody(req, body);
    if (label) {
      const member = addTeamMember(label);
      return Response.json({ member, session: getWearerSession(), team: teamView() }, { status: 201 });
    }
    if (!user_id || !isTeamMember(user_id)) throw new HttpError(404, "unknown team member");
    if (!isPersonaApproved(user_id)) {
      throw new HttpError(403, `complete Persona verification for ${labelFor(user_id)} before switching`);
    }
    const session = switchWearer(user_id, enroll === true);
    copyLatestEvidenceTo(user_id);
    return Response.json({ session, team: teamView() });
  } catch (e) {
    return errorResponse(e);
  }
}
