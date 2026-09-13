import { z } from "zod";
import { buildAction, storeAction } from "@/lib/actions";
import { ensureUser, logEvent } from "@/lib/db";
import { errorResponse, parseBody } from "@/lib/http";

const body = z.object({
  user_id: z.string().min(1).max(128),
  source: z.enum(["manual", "gemini"]),
  op: z.string(),
  dst: z.string(),
  amount_minor: z.number(),
  ccy: z.string(),
  reason: z.string(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id, source, ...input } = await parseBody(req, body);
    ensureUser(user_id, user_id);
    const stored = storeAction(user_id, buildAction(input), source);
    logEvent("action.created", { user_id, source, action_digest: stored.action_digest, op: stored.action.op });
    return Response.json(stored, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
