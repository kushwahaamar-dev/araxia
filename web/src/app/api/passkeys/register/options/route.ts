import { z } from "zod";
import { ensureUser } from "@/lib/db";
import { errorResponse, parseBody } from "@/lib/http";
import { registrationOptions } from "@/lib/passkeys";

const body = z.object({
  user_id: z.string().min(1).max(128),
  display_name: z.string().min(1).max(128),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id, display_name } = await parseBody(req, body);
    ensureUser(user_id, display_name);
    return Response.json(await registrationOptions(user_id, display_name));
  } catch (e) {
    return errorResponse(e);
  }
}
