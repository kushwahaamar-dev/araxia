import { listExecutionsForUser } from "@/lib/executions";
import { errorResponse } from "@/lib/http";
import { requireUserParam } from "@/lib/schemas";

export async function GET(req: Request): Promise<Response> {
  try {
    return Response.json({ executions: listExecutionsForUser(requireUserParam(req), 50) });
  } catch (e) {
    return errorResponse(e);
  }
}
