import { z } from "zod";
import { getAction } from "@/lib/actions";
import { nowS } from "@/lib/db";
import { errorResponse, HttpError, parseBody } from "@/lib/http";
import { approvalOptions } from "@/lib/passkeys";

const body = z.object({
  user_id: z.string().min(1).max(128),
  action_digest: z.string().regex(/^[0-9a-f]{64}$/),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id, action_digest } = await parseBody(req, body);
    const stored = getAction(action_digest);
    if (!stored || stored.user_id !== user_id) throw new HttpError(404, "unknown action");
    if (stored.exp <= nowS()) throw new HttpError(410, "action expired");
    return Response.json(await approvalOptions(user_id, action_digest));
  } catch (e) {
    return errorResponse(e);
  }
}
