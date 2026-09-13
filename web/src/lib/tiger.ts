// TigerData (Timescale) is the durable replica. SQLite stays the claim-once
// and passkey hot path. These writes never block an approval or execution.

import type Database from "better-sqlite3";
import { Pool } from "pg";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS araxia_users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS araxia_passkeys (
  cred_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key BYTEA NOT NULL,
  counter BIGINT NOT NULL,
  transports TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS araxia_evidence (
  received_at TIMESTAMPTZ NOT NULL,
  digest TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq BIGINT NOT NULL,
  presence TEXT NOT NULL,
  drift TEXT NOT NULL,
  latest_age_ms INTEGER NOT NULL,
  frozen_for_ms INTEGER NOT NULL,
  distinct_values_30s INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS araxia_executions (
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  assertion_nonce TEXT NOT NULL,
  rail TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_ref TEXT,
  user_id TEXT,
  request_json JSONB,
  response_json JSONB
);
CREATE TABLE IF NOT EXISTS araxia_events (
  ts TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  detail_json JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS araxia_health (
  fetched_at TIMESTAMPTZ NOT NULL,
  display_name TEXT,
  live_ble_bpm INTEGER,
  cloud_resting_bpm INTEGER,
  cloud_latest_bpm INTEGER,
  metrics_json JSONB
);
CREATE TABLE IF NOT EXISTS araxia_solana (
  confirmed_at TIMESTAMPTZ NOT NULL,
  signature TEXT NOT NULL,
  nonce TEXT NOT NULL,
  dst TEXT NOT NULL,
  lamports BIGINT NOT NULL
);
`;

const HYPERTABLES: Array<[string, string]> = [
  ["araxia_evidence", "received_at"],
  ["araxia_executions", "started_at"],
  ["araxia_events", "ts"],
  ["araxia_health", "fetched_at"],
  ["araxia_solana", "confirmed_at"],
];

export interface TigerSnapshot {
  configured: boolean;
  reachable: boolean;
  source: "tigerdata";
  users: number;
  passkeys: number;
  evidence: number;
  executions: number;
  events: number;
  health: number;
  solana: number;
  recent: Array<{ ts: number; kind: string }>;
  error: string | null;
  fetched_at: number;
}

let pool: Pool | null = null;
let migrate: Promise<void> | null = null;
let restored = false;
const inflight = new Set<Promise<void>>();
let cache: { at: number; value: TigerSnapshot } | null = null;
const CACHE_MS = 8_000;

export function tigerUrl(): string | null {
  const v = process.env.TIGERDATA_URL;
  return v && v.length > 0 ? v : null;
}

export function tigerConfigured(): boolean {
  return tigerUrl() !== null;
}

function replicaEnabled(): boolean {
  if (process.env.VITEST && process.env.TIGER_LIVE !== "1") return false;
  return tigerConfigured();
}

function empty(over: Partial<TigerSnapshot> = {}): TigerSnapshot {
  return {
    configured: tigerConfigured(),
    reachable: false,
    source: "tigerdata",
    users: 0,
    passkeys: 0,
    evidence: 0,
    executions: 0,
    events: 0,
    health: 0,
    solana: 0,
    recent: [],
    error: null,
    fetched_at: Date.now(),
    ...over,
  };
}

function connectionString(raw: string): string {
  return raw
    .replace(/[?&]sslmode=[^&]*/gi, "")
    .replace(/[?&]ssl=[^&]*/gi, "")
    .replace(/\?&/, "?")
    .replace(/[?&]$/, "");
}

function getPool(): Pool | null {
  if (!replicaEnabled()) return null;
  const url = tigerUrl();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString(url),
      max: 4,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

async function migrateSchema(p: Pool): Promise<void> {
  await p.query(SCHEMA);
  try {
    await p.query("CREATE EXTENSION IF NOT EXISTS timescaledb");
  } catch {
    /* already enabled on TigerData */
  }
  for (const [table, time] of HYPERTABLES) {
    try {
      await p.query(`SELECT create_hypertable($1, $2, if_not_exists => TRUE)`, [table, time]);
    } catch {
      /* regular table is enough if hypertables are unavailable */
    }
  }
}

export function ensureTiger(): Promise<void> {
  const p = getPool();
  if (!p) return Promise.resolve();
  if (!migrate) {
    migrate = migrateSchema(p).catch((e) => {
      migrate = null;
      throw e;
    });
  }
  return migrate;
}

function fire(work: (p: Pool) => Promise<void>): void {
  const p = getPool();
  if (!p) return;
  const job = ensureTiger()
    .then(() => work(p))
    .catch(() => {
      /* replica must never fail the hot path */
    })
    .finally(() => {
      inflight.delete(job);
    });
  inflight.add(job);
}

export async function flushTiger(): Promise<void> {
  await ensureTiger().catch(() => undefined);
  await Promise.all([...inflight]);
}

export function recordTigerUser(userId: string, displayName: string, createdAtMs: number): void {
  fire(async (p) => {
    await p.query(
      `INSERT INTO araxia_users (user_id, display_name, created_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [userId, displayName, createdAtMs],
    );
  });
}

export function recordTigerPasskey(row: {
  cred_id: string;
  user_id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
  created_at: number;
}): void {
  fire(async (p) => {
    await p.query(
      `INSERT INTO araxia_passkeys (cred_id, user_id, public_key, counter, transports, created_at)
       VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))
       ON CONFLICT (cred_id) DO UPDATE SET counter = EXCLUDED.counter`,
      [row.cred_id, row.user_id, row.public_key, row.counter, row.transports, row.created_at],
    );
  });
}

export function recordTigerEvidence(row: {
  digest: string;
  user_id: string;
  session_id: string;
  seq: number;
  received_at: number;
  presence: string;
  drift: string;
  latest_age_ms: number;
  frozen_for_ms: number;
  distinct_values_30s: number;
}): void {
  fire(async (p) => {
    await p.query(
      `INSERT INTO araxia_evidence
        (received_at, digest, user_id, session_id, seq, presence, drift, latest_age_ms, frozen_for_ms, distinct_values_30s)
       VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        row.received_at,
        row.digest,
        row.user_id,
        row.session_id,
        row.seq,
        row.presence,
        row.drift,
        row.latest_age_ms,
        row.frozen_for_ms,
        row.distinct_values_30s,
      ],
    );
  });
}

export function recordTigerExecution(row: {
  started_at: number;
  finished_at: number | null;
  assertion_nonce: string;
  rail: string;
  status: string;
  provider_ref: string | null;
  user_id: string | null;
  request: unknown;
  response: unknown;
}): void {
  fire(async (p) => {
    await p.query(
      `INSERT INTO araxia_executions
        (started_at, finished_at, assertion_nonce, rail, status, provider_ref, user_id, request_json, response_json)
       VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)`,
      [
        row.started_at,
        row.finished_at === null ? null : new Date(row.finished_at).toISOString(),
        row.assertion_nonce,
        row.rail,
        row.status,
        row.provider_ref,
        row.user_id,
        JSON.stringify(row.request ?? null),
        JSON.stringify(row.response ?? null),
      ],
    );
  });
}

export function recordTigerEvent(kind: string, detail: Record<string, unknown>, ts = Date.now()): void {
  fire(async (p) => {
    await p.query(
      `INSERT INTO araxia_events (ts, kind, detail_json)
       VALUES (to_timestamp($1 / 1000.0), $2, $3::jsonb)`,
      [ts, kind, JSON.stringify(detail)],
    );
  });
}

export function recordTigerHealth(row: {
  fetched_at: number;
  display_name: string | null;
  live_ble_bpm: number | null;
  cloud_resting_bpm: number | null;
  cloud_latest_bpm: number | null;
  metrics: unknown;
}): void {
  fire(async (p) => {
    await p.query(
      `INSERT INTO araxia_health
        (fetched_at, display_name, live_ble_bpm, cloud_resting_bpm, cloud_latest_bpm, metrics_json)
       VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5, $6::jsonb)`,
      [
        row.fetched_at,
        row.display_name,
        row.live_ble_bpm,
        row.cloud_resting_bpm,
        row.cloud_latest_bpm,
        JSON.stringify(row.metrics ?? null),
      ],
    );
  });
}

export function recordTigerSolana(row: {
  signature: string;
  nonce: string;
  dst: string;
  lamports: number;
  confirmed_at?: number;
}): void {
  fire(async (p) => {
    await p.query(
      `INSERT INTO araxia_solana (confirmed_at, signature, nonce, dst, lamports)
       VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5)`,
      [row.confirmed_at ?? Date.now(), row.signature, row.nonce, row.dst, row.lamports],
    );
  });
}

export async function restoreAuthFromTiger(db: Database.Database): Promise<number> {
  if (restored) return 0;
  const p = getPool();
  if (!p) return 0;
  try {
    await ensureTiger();
    const users = await p.query<{ user_id: string; display_name: string; created_at: Date }>(
      "SELECT user_id, display_name, created_at FROM araxia_users",
    );
    for (const u of users.rows) {
      db.prepare("INSERT OR IGNORE INTO users (user_id, display_name, created_at) VALUES (?, ?, ?)").run(
        u.user_id,
        u.display_name,
        u.created_at.getTime(),
      );
    }
    const keys = await p.query<{
      cred_id: string;
      user_id: string;
      public_key: Buffer;
      counter: string;
      transports: string;
      created_at: Date;
    }>("SELECT cred_id, user_id, public_key, counter, transports, created_at FROM araxia_passkeys");
    for (const k of keys.rows) {
      db.prepare(
        "INSERT OR IGNORE INTO passkeys (cred_id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(k.cred_id, k.user_id, k.public_key, Number(k.counter), k.transports, k.created_at.getTime());
    }
    restored = true;
    return users.rows.length + keys.rows.length;
  } catch {
    return 0;
  }
}

export function pushLocalAuthToTiger(db: Database.Database): void {
  const users = db.prepare("SELECT user_id, display_name, created_at FROM users").all() as Array<{
    user_id: string;
    display_name: string;
    created_at: number;
  }>;
  for (const u of users) recordTigerUser(u.user_id, u.display_name, u.created_at);
  const keys = db
    .prepare("SELECT cred_id, user_id, public_key, counter, transports, created_at FROM passkeys")
    .all() as Array<{
    cred_id: string;
    user_id: string;
    public_key: Buffer;
    counter: number;
    transports: string;
    created_at: number;
  }>;
  for (const k of keys) recordTigerPasskey(k);
}

export async function getTigerSnapshot(now = Date.now()): Promise<TigerSnapshot> {
  if (cache && now - cache.at < CACHE_MS) return cache.value;
  if (!tigerConfigured()) {
    const value = empty({ error: "TIGERDATA_URL is not set", fetched_at: now });
    cache = { at: now, value };
    return value;
  }
  try {
    await ensureTiger();
    const p = getPool();
    if (!p) throw new Error("no pool");
    const [users, passkeys, evidence, executions, events, health, solana, recent] = await Promise.all([
      p.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM araxia_users"),
      p.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM araxia_passkeys"),
      p.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM araxia_evidence"),
      p.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM araxia_executions"),
      p.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM araxia_events"),
      p.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM araxia_health"),
      p.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM araxia_solana"),
      p.query<{ ts: Date; kind: string }>("SELECT ts, kind FROM araxia_events ORDER BY ts DESC LIMIT 8"),
    ]);
    const value: TigerSnapshot = {
      configured: true,
      reachable: true,
      source: "tigerdata",
      users: Number(users.rows[0]?.n ?? 0),
      passkeys: Number(passkeys.rows[0]?.n ?? 0),
      evidence: Number(evidence.rows[0]?.n ?? 0),
      executions: Number(executions.rows[0]?.n ?? 0),
      events: Number(events.rows[0]?.n ?? 0),
      health: Number(health.rows[0]?.n ?? 0),
      solana: Number(solana.rows[0]?.n ?? 0),
      recent: recent.rows.map((r) => ({ ts: r.ts.getTime(), kind: r.kind })),
      error: null,
      fetched_at: now,
    };
    cache = { at: now, value };
    return value;
  } catch (e) {
    const value = empty({
      configured: true,
      error: e instanceof Error ? e.message : "TigerData unreachable",
      fetched_at: now,
    });
    cache = { at: now, value };
    return value;
  }
}

export async function listTigerSolana(limit = 5): Promise<
  Array<{ signature: string; nonce: string; dst: string; lamports: number; confirmed_at: number }>
> {
  const p = getPool();
  if (!p) return [];
  try {
    await ensureTiger();
    const res = await p.query<{
      signature: string;
      nonce: string;
      dst: string;
      lamports: string;
      confirmed_at: Date;
    }>("SELECT signature, nonce, dst, lamports, confirmed_at FROM araxia_solana ORDER BY confirmed_at DESC LIMIT $1", [
      limit,
    ]);
    return res.rows.map((r) => ({
      signature: r.signature,
      nonce: r.nonce,
      dst: r.dst,
      lamports: Number(r.lamports),
      confirmed_at: r.confirmed_at.getTime(),
    }));
  } catch {
    return [];
  }
}
