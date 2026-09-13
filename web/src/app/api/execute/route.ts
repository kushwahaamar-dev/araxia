import { z } from "zod";
import { executorFor } from "@/lib/executors/pick";
import { runExecution } from "@/lib/executors/run";
import { errorResponse, parseBody } from "@/lib/http";
import { assertionSchema } from "@/lib/schemas";

const bodySchema = z.object({ assertion: assertionSchema });

export async function POST(req: Request): Promise<Response> {
  let assertion;
  try {
    ({ assertion } = await parseBody(req, bodySchema));
  } catch (e) {
    return errorResponse(e);
  }
  const result = await runExecution(assertion, executorFor(assertion.action.aud), "api/execute");
  return Response.json(result, { status: result.outcome === "EXECUTED" ? 200 : 403 });
}
