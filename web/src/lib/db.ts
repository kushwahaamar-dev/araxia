// Authoritative store. One SQLite file, WAL, every claim inside a transaction.

import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
function replica(): Promise<typeof import("./tiger")> {
  return import("./tiger");
}

export type ExecutionStatus = "SENT" | "CONFIRMED" | "FAILED" | "UNCERTAIN";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS passkeys (
  cred_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('register','approve')),
  action_digest TEXT,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE TABLE IF NOT EXISTS bridges (
  bridge_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  pubkey_hex TEXT NOT NULL,
  current_session TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bridge_sessions (
  session_id TEXT PRIMARY KEY,
  bridge_id TEXT NOT NULL REFERENCES bridges(bridge_id),
  last_seq INTEGER NOT NULL,
  started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  presence TEXT NOT NULL,
  drift TEXT NOT NULL,
  latest_age_ms INTEGER NOT NULL,
  frozen_for_ms INTEGER NOT NULL,
  distinct_values_30s INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_user_time ON evidence(user_id, received_at DESC);
CREATE TABLE IF NOT EXISTS actions (
  digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  canonical_json TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS assertions (
  nonce TEXT PRIMARY KEY,
  action_digest TEXT NOT NULL REFERENCES actions(digest),
  user_id TEXT NOT NULL,
  assurance TEXT NOT NULL,
  assertion_json TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  exp INTEGER NOT NULL,
  claimed_at INTEGER,
  claimed_by TEXT
);
CREATE TABLE IF NOT EXISTS executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assertion_nonce TEXT NOT NULL UNIQUE REFERENCES assertions(nonce),
  rail TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SENT','CONFIRMED','FAILED','UNCERTAIN')),
  provider_ref TEXT,
  request_json TEXT NOT NULL,
  response_json TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS operational_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kyc (
  user_id TEXT PRIMARY KEY,
  inquiry_id TEXT,
  status TEXT NOT NULL DEFAULT 'none',
  hosted_url TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS wearer_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_user TEXT NOT NULL,
  guessed_user TEXT NOT NULL DEFAULT '',
  halt INTEGER NOT NULL DEFAULT 0,
  last_median INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const file = process.env.ARAXIA_DB ?? path.join(process.cwd(), "data", "araxia.db");
  mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  try {
    chmodSync(file, 0o600);
  } catch {
    /* tmpfs / test files may not allow chmod */
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

export function resetDbForTests(file: string): void {
  db?.close();
  db = null;
  process.env.ARAXIA_DB = file;
}

export const nowMs = (): number => Date.now();
export const nowS = (): number => Math.floor(Date.now() / 1000);

export function logEvent(kind: string, detail: Record<string, unknown>): void {
  const ts = nowMs();
  getDb()
    .prepare("INSERT INTO operational_events (ts, kind, detail_json) VALUES (?, ?, ?)")
    .run(ts, kind, JSON.stringify(detail));
  void replica()
    .then((t) => t.recordTigerEvent(kind, detail, ts))
    .catch(() => undefined);
}

const SECRET = /(key|token|secret|password|authorization|cookie|seed|keypair)/i;

export function logSecurity(kind: string, detail: Record<string, unknown>): void {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRET.test(k)) safe[k] = "REDACTED";
    else if (typeof v === "string" && v.length > 400) safe[k] = `${v.slice(0, 400)}…`;
    else safe[k] = v;
  }
  logEvent(`security.${kind}`, safe);
}

export function ensureUser(userId: string, displayName: string): void {
  const created = nowMs();
  getDb()
    .prepare("INSERT OR IGNORE INTO users (user_id, display_name, created_at) VALUES (?, ?, ?)")
    .run(userId, displayName, created);
  void replica()
    .then((t) => t.recordTigerUser(userId, displayName, created))
    .catch(() => undefined);
}

// Exactly one caller wins. Everyone else sees false and must stop.
export function claimAssertion(nonce: string, claimedBy: string): boolean {
  const res = getDb()
    .prepare(
      "UPDATE assertions SET claimed_at = ?, claimed_by = ? WHERE nonce = ? AND claimed_at IS NULL AND exp > ?",
    )
    .run(nowMs(), claimedBy, nonce, nowS());
  return res.changes === 1;
}

export interface ExecutionRow {
  id: number;
  assertion_nonce: string;
  rail: string;
  status: ExecutionStatus;
  provider_ref: string | null;
  request_json: string;
  response_json: string | null;
  started_at: number;
  finished_at: number | null;
}

export function insertExecution(nonce: string, rail: string, requestJson: string): number {
  const res = getDb()
    .prepare(
      "INSERT INTO executions (assertion_nonce, rail, status, request_json, started_at) VALUES (?, ?, 'SENT', ?, ?)",
    )
    .run(nonce, rail, requestJson, nowMs());
  return Number(res.lastInsertRowid);
}

export function finishExecution(
  id: number,
  status: Exclude<ExecutionStatus, "SENT">,
  providerRef: string | null,
  responseJson: string,
): void {
  const finished = nowMs();
  getDb()
    .prepare("UPDATE executions SET status = ?, provider_ref = ?, response_json = ?, finished_at = ? WHERE id = ?")
    .run(status, providerRef, responseJson, finished, id);
  const row = getDb()
    .prepare(
      `SELECT e.assertion_nonce, e.rail, e.request_json, e.started_at, a.user_id
       FROM executions e LEFT JOIN assertions a ON a.nonce = e.assertion_nonce
       WHERE e.id = ?`,
    )
    .get(id) as
    | { assertion_nonce: string; rail: string; request_json: string; started_at: number; user_id: string | null }
    | undefined;
  if (row) {
    let request: unknown = row.request_json;
    let response: unknown = responseJson;
    try {
      request = JSON.parse(row.request_json);
    } catch {
      /* keep raw */
    }
    try {
      response = JSON.parse(responseJson);
    } catch {
      /* keep raw */
    }
    void replica()
      .then((t) =>
        t.recordTigerExecution({
          started_at: row.started_at,
          finished_at: finished,
          assertion_nonce: row.assertion_nonce,
          rail: row.rail,
          status,
          provider_ref: providerRef,
          user_id: row.user_id,
          request,
          response,
        }),
      )
      .catch(() => undefined);
  }
}

export function getExecutionByNonce(nonce: string): ExecutionRow | undefined {
  return getDb().prepare("SELECT * FROM executions WHERE assertion_nonce = ?").get(nonce) as ExecutionRow | undefined;
}
