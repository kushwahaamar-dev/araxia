// Read model for the UI: executions joined back to the assertion that
// authorized them. Polled every second, so one indexed query and no extras.

import type { Assurance, CanonicalAction } from "@araxia/verify";
import { getDb, type ExecutionStatus } from "./db";

export interface ExecutionSummary {
  id: number;
  assertion_nonce: string;
  rail: string;
  status: ExecutionStatus;
  provider_ref: string | null;
  started_at: number;
  finished_at: number | null;
  assurance: Assurance;
  action: CanonicalAction | null;
}

interface JoinedRow extends Omit<ExecutionSummary, "action"> {
  assertion_json: string;
}

function parseAction(json: string): CanonicalAction | null {
  try {
    const parsed = JSON.parse(json) as { action?: CanonicalAction };
    return parsed.action ?? null;
  } catch {
    return null;
  }
}

export function listExecutionsForUser(userId: string, limit: number): ExecutionSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT e.id, e.assertion_nonce, e.rail, e.status, e.provider_ref, e.started_at, e.finished_at,
              a.assurance, a.assertion_json
       FROM executions e JOIN assertions a ON a.nonce = e.assertion_nonce
       WHERE a.user_id = ? ORDER BY e.id DESC LIMIT ?`,
    )
    .all(userId, limit) as JoinedRow[];
  return rows.map(({ assertion_json, ...rest }) => ({ ...rest, action: parseAction(assertion_json) }));
}
