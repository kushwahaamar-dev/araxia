// Builds and stores canonical actions. The digest of what is stored here is
// the only thing a passkey ever approves.

import { randomBytes } from "node:crypto";
import { actionDigest, MAX_ACTION_LIFETIME_S, type CanonicalAction } from "@araxia/verify";
import { z } from "zod";
import { getDb, nowMs, nowS } from "./db";

export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

function loadPayees(): Record<string, string> {
  const raw = process.env.ARAXIA_PAYEES_JSON;
  if (!raw) return { RENT: "demo_rent", SAVINGS: "demo_savings" };
  const parsed = z.record(z.string().min(1), z.string().min(1)).safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error("ARAXIA_PAYEES_JSON must be a JSON object of label -> account id");
  return parsed.data;
}

export const ALLOWED_PAYEES: Readonly<Record<string, string>> = loadPayees();
export const SOURCE_ACCOUNT: string = process.env.ARAXIA_SOURCE_ACCOUNT ?? "demo_checking";

export const AUD_FOR_OP = {
  "nessie.transfer": "nessie-sandbox",
  "solana.transfer": "solana-devnet",
} as const;

export type Op = keyof typeof AUD_FOR_OP;

const OPS = Object.keys(AUD_FOR_OP) as [Op, ...Op[]];

export const actionInputSchema = z.object({
  op: z.enum(OPS),
  dst: z.string().min(1),
  amount_minor: z.number().int().positive(),
  ccy: z.string().regex(/^[A-Z]{3}$/, "ccy must be 3 uppercase letters"),
  reason: z.string().min(1).max(64),
});

// Raw caller shape; validated inside buildAction so bad values throw ActionError.
export interface ActionInput {
  op: string;
  dst: string;
  amount_minor: number;
  ccy: string;
  reason: string;
}

// Accepts a payee label or its account id; always emits the account id.
function resolvePayee(dst: string): string {
  const byLabel = ALLOWED_PAYEES[dst];
  if (byLabel !== undefined) return byLabel;
  if (Object.values(ALLOWED_PAYEES).includes(dst)) return dst;
  throw new ActionError("payee not allowed");
}

export function buildAction(input: ActionInput): CanonicalAction {
  const parsed = actionInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ActionError(issue ? `${issue.path.join(".") || "input"}: ${issue.message}` : "invalid action");
  }
  const { op, dst, amount_minor, ccy, reason } = parsed.data;
  return {
    v: 1,
    op,
    aud: AUD_FOR_OP[op],
    src: SOURCE_ACCOUNT,
    dst: resolvePayee(dst),
    amount_minor,
    ccy,
    reason,
    nonce: "n_" + randomBytes(32).toString("base64url"),
    exp: nowS() + MAX_ACTION_LIFETIME_S,
  };
}

export interface StoredAction {
  action: CanonicalAction;
  action_digest: string;
}

export function storeAction(userId: string, action: CanonicalAction, source: string): StoredAction {
  const digest = actionDigest(action);
  getDb()
    .prepare("INSERT INTO actions (digest, user_id, canonical_json, source, created_at, exp) VALUES (?, ?, ?, ?, ?, ?)")
    .run(digest, userId, JSON.stringify(action), source, nowMs(), action.exp);
  return { action, action_digest: digest };
}

export interface ActionRow {
  user_id: string;
  action: CanonicalAction;
  exp: number;
}

export function getAction(digest: string): ActionRow | null {
  const row = getDb().prepare("SELECT user_id, canonical_json, exp FROM actions WHERE digest = ?").get(digest) as
    | { user_id: string; canonical_json: string; exp: number }
    | undefined;
  if (!row) return null;
  return { user_id: row.user_id, action: JSON.parse(row.canonical_json) as CanonicalAction, exp: row.exp };
}
