// Nessie's current TransferCreate schema records transfers but never mutates
// account.balance (verified live: completed transfers, deposits, and withdrawals
// leave the seeded balance untouched; payee_id is rejected as an extra field).
// We overlay Araxia's confirmed nessie executions so the UI reflects settlement.

import type { CanonicalAction } from "@araxia/verify";
import { getDb } from "./db";
import type { NessieAccountView, NessieLedger } from "./nessie";

export interface NessieMovement {
  src: string;
  dst: string;
  amount_minor: number;
}

function parseAction(json: string): CanonicalAction | null {
  try {
    const parsed = JSON.parse(json) as { action?: CanonicalAction };
    return parsed.action ?? null;
  } catch {
    return null;
  }
}

/** All confirmed Nessie transfers across users (sandbox source account is shared). */
export function listConfirmedNessieMovements(): NessieMovement[] {
  try {
    const rows = getDb()
      .prepare(
        `SELECT a.assertion_json
         FROM executions e JOIN assertions a ON a.nonce = e.assertion_nonce
         WHERE e.rail = 'nessie' AND e.status = 'CONFIRMED'`,
      )
      .all() as Array<{ assertion_json: string }>;

    const out: NessieMovement[] = [];
    for (const row of rows) {
      const action = parseAction(row.assertion_json);
      if (!action || action.op !== "nessie.transfer") continue;
      if (!Number.isInteger(action.amount_minor) || action.amount_minor <= 0) continue;
      out.push({ src: action.src, dst: action.dst, amount_minor: action.amount_minor });
    }
    return out;
  } catch {
    return [];
  }
}

function adjust(account: NessieAccountView | null, deltaMinor: number): NessieAccountView | null {
  if (!account || account.balance_minor === null) return account;
  return { ...account, balance_minor: account.balance_minor + deltaMinor };
}

export function applyNessieSettlements(
  ledger: NessieLedger,
  movements: NessieMovement[] = listConfirmedNessieMovements(),
): NessieLedger {
  if (!ledger.source || movements.length === 0) {
    return { ...ledger, balances_settled: false };
  }

  const byId = new Map<string, number>();
  for (const m of movements) {
    byId.set(m.src, (byId.get(m.src) ?? 0) - m.amount_minor);
    byId.set(m.dst, (byId.get(m.dst) ?? 0) + m.amount_minor);
  }

  return {
    ...ledger,
    source: adjust(ledger.source, byId.get(ledger.source.id) ?? 0),
    payees: ledger.payees.map((p) => adjust(p, byId.get(p.id) ?? 0)!),
    balances_settled: true,
  };
}
