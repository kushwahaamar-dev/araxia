import { ingestEnvelope } from "@/lib/evidence";
import { errorResponse, parseBody } from "@/lib/http";
import { signedEnvelopeSchema } from "@/lib/schemas";

export async function POST(req: Request): Promise<Response> {
  try {
    const envelope = await parseBody(req, signedEnvelopeSchema);
    const result = ingestEnvelope(envelope);
    if (!result.ok) return Response.json({ ok: false, reason: result.reason }, { status: result.status });
    return Response.json({ ok: true, presence: result.view.presence, drift: result.view.drift });
  } catch (e) {
    return errorResponse(e);
  }
}
