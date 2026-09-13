import { z } from "zod";
import { ensureUser } from "@/lib/db";
import { errorResponse, parseBody } from "@/lib/http";
import { getKyc, personaConfigured, refreshInquiry, startInquiry } from "@/lib/persona";
import { requireUserParam } from "@/lib/schemas";

const body = z.object({ user_id: z.string().min(1) });

export async function GET(req: Request): Promise<Response> {
  try {
    const user = requireUserParam(req);
    return Response.json({ configured: personaConfigured(), kyc: getKyc(user) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id } = await parseBody(req, body);
    ensureUser(user_id, user_id);
    const kyc = await startInquiry(user_id);
    return Response.json({ configured: true, kyc }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request): Promise<Response> {
  try {
    const { user_id } = await parseBody(req, body);
    const kyc = await refreshInquiry(user_id);
    return Response.json({ configured: true, kyc });
  } catch (e) {
    return errorResponse(e);
  }
}
