import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { logEvent } from "@/lib/db";
import { errorResponse, parseBody } from "@/lib/http";
import { verifyRegistration } from "@/lib/passkeys";

// Shape check only; the library does the cryptographic validation.
const body = z.object({
  user_id: z.string().min(1).max(128),
  response: z.object({ id: z.string().min(1) }).passthrough(),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const { user_id, response } = await parseBody(req, body);
    const { cred_id } = await verifyRegistration(user_id, response as unknown as RegistrationResponseJSON);
    logEvent("passkey.registered", { user_id, cred_id });
    return Response.json({ ok: true, cred_id });
  } catch (e) {
    return errorResponse(e);
  }
}
