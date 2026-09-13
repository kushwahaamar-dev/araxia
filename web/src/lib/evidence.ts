// Bridge evidence ingest: verify, enforce session/seq/skew, keep the latest
// window per user. Raw physiology never arrives here; the bridge sends stats.

import { sha256Hex, verifyEnvelope, type SignedEnvelope } from "@araxia/verify";
import { getDb, logEvent, nowMs } from "./db";
import type { Drift, EvidenceView, Presence } from "./policy";

export const MAX_SKEW_MS = 5000;

interface BridgeRow {
  bridge_id: string;
  user_id: string;
  pubkey_hex: string;
  current_session: string | null;
}

export function registerBridge(bridgeId: string, userId: string, pubkeyHex: string): void {
  getDb()
    .prepare(
      `INSERT INTO bridges (bridge_id, user_id, pubkey_hex, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(bridge_id) DO UPDATE SET pubkey_hex = excluded.pubkey_hex, user_id = excluded.user_id`,
    )
    .run(bridgeId, userId, pubkeyHex, nowMs());
}

export function listBridges(userId: string): Array<{ bridge_id: string; pubkey_hex: string }> {
  return getDb()
    .prepare("SELECT bridge_id, pubkey_hex FROM bridges WHERE user_id = ?")
    .all(userId) as Array<{ bridge_id: string; pubkey_hex: string }>;
}

export type IngestResult = { ok: true; userId: string; view: EvidenceView } | { ok: false; status: number; reason: string };

const PRESENCE = new Set<Presence>(["WARMING", "READY", "STALE", "DISCONNECTED"]);
const DRIFT = new Set<Drift>(["NOT_EVALUATED", "NOMINAL", "DRIFTING"]);

export function ingestEnvelope(envelope: SignedEnvelope, receivedAt = nowMs()): IngestResult {
  const db = getDb();
  const bridge = db.prepare("SELECT * FROM bridges WHERE bridge_id = ?").get(envelope.kid) as BridgeRow | undefined;
  if (!bridge) return { ok: false, status: 401, reason: "unknown bridge" };

  const verdict = verifyEnvelope(envelope, bridge.pubkey_hex);
  if (!verdict.ok || !verdict.payload) return { ok: false, status: 401, reason: verdict.reason };
  const p = verdict.payload as Record<string, unknown>;

  if (p.bridge_id !== envelope.kid) return { ok: false, status: 401, reason: "bridge_id does not match kid" };
  const sessionId = p.session_id;
  const seq = p.seq;
  const issuedAt = p.issued_at_ms;
  if (typeof sessionId !== "string" || typeof seq !== "number" || typeof issuedAt !== "number") {
    return { ok: false, status: 400, reason: "malformed payload" };
  }
  if (Math.abs(receivedAt - issuedAt) > MAX_SKEW_MS) return { ok: false, status: 401, reason: "clock skew" };
  if (!PRESENCE.has(p.presence as Presence) || !DRIFT.has(p.drift as Drift)) {
    return { ok: false, status: 400, reason: "unknown presence or drift state" };
  }

  const accept = db.transaction((): IngestResult => {
    const session = db.prepare("SELECT last_seq FROM bridge_sessions WHERE session_id = ?").get(sessionId) as
      | { last_seq: number }
      | undefined;
    if (session) {
      if (bridge.current_session !== sessionId) return { ok: false, status: 401, reason: "superseded session" };
      if (seq <= session.last_seq) return { ok: false, status: 401, reason: "replayed or out-of-order seq" };
      db.prepare("UPDATE bridge_sessions SET last_seq = ? WHERE session_id = ?").run(seq, sessionId);
    } else {
      db.prepare("INSERT INTO bridge_sessions (session_id, bridge_id, last_seq, started_at) VALUES (?, ?, ?, ?)").run(
        sessionId,
        bridge.bridge_id,
        seq,
        receivedAt,
      );
      db.prepare("UPDATE bridges SET current_session = ? WHERE bridge_id = ?").run(sessionId, bridge.bridge_id);
    }
    const digest = sha256Hex(envelope.payload);
    const view: EvidenceView = {
      digest,
      presence: p.presence as Presence,
      drift: p.drift as Drift,
      received_at: receivedAt,
      latest_age_ms: Number(p.latest_age_ms ?? -1),
      frozen_for_ms: Number(p.frozen_for_ms ?? 0),
      distinct_values_30s: Number(p.distinct_values_30s ?? 0),
    };
    db.prepare(
      `INSERT OR IGNORE INTO evidence
        (digest, user_id, session_id, seq, received_at, presence, drift, latest_age_ms, frozen_for_ms, distinct_values_30s)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      digest,
      bridge.user_id,
      sessionId,
      seq,
      receivedAt,
      view.presence,
      view.drift,
      view.latest_age_ms,
      view.frozen_for_ms,
      view.distinct_values_30s,
    );
    return { ok: true, userId: bridge.user_id, view };
  });

  const result = accept();
  if (!result.ok) logEvent("evidence.rejected", { kid: envelope.kid, reason: result.reason });
  return result;
}

export function latestEvidence(userId: string): EvidenceView | null {
  const row = getDb()
    .prepare(
      `SELECT digest, presence, drift, received_at, latest_age_ms, frozen_for_ms, distinct_values_30s
       FROM evidence WHERE user_id = ? ORDER BY received_at DESC, seq DESC LIMIT 1`,
    )
    .get(userId) as EvidenceView | undefined;
  return row ?? null;
}

export function evidenceByDigest(digest: string): EvidenceView | null {
  const row = getDb()
    .prepare(
      `SELECT digest, presence, drift, received_at, latest_age_ms, frozen_for_ms, distinct_values_30s
       FROM evidence WHERE digest = ?`,
    )
    .get(digest) as EvidenceView | undefined;
  return row ?? null;
}
