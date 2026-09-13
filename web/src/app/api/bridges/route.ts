import { z } from "zod";
import { ensureUser } from "@/lib/db";
import { listBridges, registerBridge } from "@/lib/evidence";
import { errorResponse, parseBody } from "@/lib/http";
import { hex64, requireUserParam } from "@/lib/schemas";

const registerSchema = z.object({
  user_id: z.string().min(1),
  bridge_id: z.string().min(1),
  pubkey_hex: hex64,
});

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id, bridge_id, pubkey_hex } = await parseBody(req, registerSchema);
    ensureUser(user_id, user_id);
    registerBridge(bridge_id, user_id, pubkey_hex.toLowerCase());
    return Response.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    return Response.json({ bridges: listBridges(requireUserParam(req)) });
  } catch (e) {
    return errorResponse(e);
  }
}
