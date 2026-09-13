import { z } from "zod";
import { ActionError, ALLOWED_PAYEES, buildAction, storeAction } from "@/lib/actions";
import { ensureUser, logEvent } from "@/lib/db";
import { GeminiError, proposeWithGemini } from "@/lib/gemini";
import { getNessieLedger } from "@/lib/nessie";
import { sanitizeText } from "@/lib/security";

const Body = z.object({ user_id: z.string().min(1), prompt: z.string().min(1).max(2000) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const user_id = sanitizeText(parsed.data.user_id, 128);
  const prompt = sanitizeText(parsed.data.prompt, 2000);
  ensureUser(user_id, user_id);

  const ledger = await getNessieLedger();
  let proposal;
  try {
    proposal = await proposeWithGemini(prompt, {
      payees: Object.keys(ALLOWED_PAYEES).filter((label) => label !== "DEVNET"),
      balanceMinor: ledger.source?.balance_minor ?? null,
    });
  } catch (e) {
    const message = e instanceof GeminiError ? e.message : "proposal failed";
    logEvent("propose.failed", { user_id, message });
    return Response.json({ error: message }, { status: 502 });
  }

  // The model's word is not enough. Payee, op, amount and currency are
  // re-checked against server-owned rules; a bad proposal never becomes an action.
  try {
    const action = buildAction({
      op: proposal.op,
      dst: proposal.payee,
      amount_minor: proposal.amount_minor,
      ccy: proposal.ccy,
      reason: proposal.reason,
    });
    const stored = storeAction(user_id, action, "gemini");
    logEvent("propose.accepted", { user_id, action_digest: stored.action_digest });
    return Response.json({ ...stored, explanation: proposal.explanation }, { status: 201 });
  } catch (e) {
    const message = e instanceof ActionError ? e.message : "proposal rejected";
    logEvent("propose.rejected", { user_id, message, payee: proposal.payee });
    return Response.json({ error: `proposal rejected by policy: ${message}`, proposal }, { status: 422 });
  }
}
