import { z } from "zod";
import { nessieExecutor } from "@/lib/executors/nessie";
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
  const result = await runExecution(assertion, nessieExecutor(), "api/execute");
  return Response.json(result, { status: result.outcome === "EXECUTED" ? 200 : 403 });
}
