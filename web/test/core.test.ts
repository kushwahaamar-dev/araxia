import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { canonicalize, type JsonValue } from "@araxia/verify";
import { beforeAll, describe, expect, it } from "vitest";
import { claimAssertion, ensureUser, getDb, resetDbForTests } from "../src/lib/db";
import { ingestEnvelope, latestEvidence, registerBridge } from "../src/lib/evidence";
import { decide, type EvidenceView } from "../src/lib/policy";

const DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "araxia-")), "test.db");

function bridgeKey(): { priv: KeyObject; pubHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { priv: privateKey, pubHex: Buffer.from(jwk.x, "base64url").toString("hex") };
}

function envelope(priv: KeyObject, kid: string, over: Record<string, JsonValue>, issuedAt: number) {
  const payload: Record<string, JsonValue> = {
    v: 1,
    bridge_id: kid,
    device_id: "d_test",
    session_id: "s_1",
    seq: 1,
    issued_at_ms: issuedAt,
    latest_age_ms: 900,
    count: 19,
    valid_ratio_pct: 100,
    median_gap_ms: 1019,
    p95_gap_ms: 1040,
    max_gap_ms: 1055,
    distinct_values_30s: 4,
    frozen_for_ms: 2000,
    contact: "unsupported",
    rr_present: false,
    presence: "READY",
    drift: "NOMINAL",
    model_version: "m1",
    ...over,
  };
  const canonical = canonicalize(payload);
  return { kid, payload: canonical, sig: nodeSign(null, Buffer.from(canonical), priv).toString("base64") };
}

beforeAll(() => {
  resetDbForTests(DB_FILE);
  ensureUser("u_test", "Test");
});

describe("evidence ingest", () => {
  const { priv, pubHex } = bridgeKey();
  const kid = "b_test1";
  const t0 = 1_800_000_000_000;

  it("rejects unknown bridges before doing anything else", () => {
    const r = ingestEnvelope(envelope(priv, "b_unknown", {}, t0), t0);
    expect(r).toMatchObject({ ok: false, status: 401, reason: "unknown bridge" });
  });

  it("accepts a fresh envelope from a registered bridge", () => {
    registerBridge(kid, "u_test", pubHex);
    const r = ingestEnvelope(envelope(priv, kid, {}, t0), t0);
    expect(r.ok).toBe(true);
    expect(latestEvidence("u_test")?.presence).toBe("READY");
  });

  it("rejects replayed and out-of-order seq", () => {
    expect(ingestEnvelope(envelope(priv, kid, { seq: 1 }, t0 + 1000), t0 + 1000)).toMatchObject({
      ok: false,
      reason: "replayed or out-of-order seq",
    });
    expect(ingestEnvelope(envelope(priv, kid, { seq: 3 }, t0 + 2000), t0 + 2000).ok).toBe(true);
    expect(ingestEnvelope(envelope(priv, kid, { seq: 2 }, t0 + 3000), t0 + 3000).ok).toBe(false);
  });

  it("rejects clock skew beyond 5 s", () => {
    const r = ingestEnvelope(envelope(priv, kid, { seq: 10 }, t0), t0 + 6000);
    expect(r).toMatchObject({ ok: false, reason: "clock skew" });
  });

  it("rejects a superseded session once a newer one starts", () => {
    expect(ingestEnvelope(envelope(priv, kid, { session_id: "s_2", seq: 1 }, t0 + 4000), t0 + 4000).ok).toBe(true);
    const old = ingestEnvelope(envelope(priv, kid, { session_id: "s_1", seq: 50 }, t0 + 5000), t0 + 5000);
    expect(old).toMatchObject({ ok: false, reason: "superseded session" });
  });

  it("rejects a bad signature and a mismatched kid", () => {
    const other = bridgeKey();
    expect(ingestEnvelope(envelope(other.priv, kid, { session_id: "s_2", seq: 2 }, t0 + 6000), t0 + 6000)).toMatchObject({
      ok: false,
      reason: "signature mismatch",
    });
    const wrongInner = envelope(priv, kid, { session_id: "s_2", seq: 2, bridge_id: "b_other" }, t0 + 6000);
    expect(ingestEnvelope(wrongInner, t0 + 6000)).toMatchObject({ ok: false, reason: "bridge_id does not match kid" });
  });

  it("rejects unknown presence states", () => {
    const r = ingestEnvelope(envelope(priv, kid, { session_id: "s_2", seq: 3, presence: "PRESENT" }, t0 + 7000), t0 + 7000);
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe("policy", () => {
  const now = 1_800_000_000_000;
  const ev = (over: Partial<EvidenceView> = {}): EvidenceView => ({
    digest: "e1",
    presence: "READY",
    drift: "NOMINAL",
    received_at: now - 500,
    latest_age_ms: 900,
    frozen_for_ms: 1000,
    distinct_values_30s: 4,
    ...over,
  });
  const base = { op: "nessie.transfer", amountMinor: 4500, passkeyVerified: true, nowMs: now };

  it("approves at AAL3 with READY + NOMINAL", () => {
    expect(decide({ ...base, evidence: ev() })).toMatchObject({ decision: "APPROVED", assurance: "AAL3" });
  });
  it("approves at AAL2 when drift is not evaluated", () => {
    expect(decide({ ...base, evidence: ev({ drift: "NOT_EVALUATED" }) })).toMatchObject({ decision: "APPROVED", assurance: "AAL2" });
  });
  it("denies without passkey regardless of evidence", () => {
    expect(decide({ ...base, passkeyVerified: false, evidence: ev() }).decision).toBe("DENIED");
  });
  it("denies STALE, WARMING, DISCONNECTED", () => {
    for (const presence of ["STALE", "WARMING", "DISCONNECTED"] as const) {
      expect(decide({ ...base, evidence: ev({ presence }) })).toMatchObject({ decision: "DENIED", reason: `presence ${presence}` });
    }
  });
  it("denies evidence older than 3 s even if READY", () => {
    expect(decide({ ...base, evidence: ev({ received_at: now - 3001 }) }).decision).toBe("DENIED");
  });
  it("steps up on DRIFTING and never approves", () => {
    expect(decide({ ...base, evidence: ev({ drift: "DRIFTING" }) }).decision).toBe("STEP_UP_REQUIRED");
  });
  it("denies unknown ops and amounts over cap", () => {
    expect(decide({ ...base, op: "nessie.withdrawal", evidence: ev() }).decision).toBe("DENIED");
    expect(decide({ ...base, amountMinor: 100_001, evidence: ev() }).decision).toBe("DENIED");
  });
});

describe("claim-once", () => {
  function seedAssertion(nonce: string) {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT OR IGNORE INTO actions (digest, user_id, canonical_json, source, created_at, exp) VALUES (?, ?, ?, ?, ?, ?)").run(
      "ad_" + nonce,
      "u_test",
      "{}",
      "test",
      Date.now(),
      now + 100,
    );
    db.prepare(
      "INSERT INTO assertions (nonce, action_digest, user_id, assurance, assertion_json, issued_at, exp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(nonce, "ad_" + nonce, "u_test", "AAL2", "{}", now, now + 60);
  }

  it("claims exactly once sequentially", () => {
    seedAssertion("n_seq");
    const wins = Array.from({ length: 50 }, (_, i) => claimAssertion("n_seq", `c${i}`)).filter(Boolean).length;
    expect(wins).toBe(1);
  });

  it("claims exactly once across 8 worker threads x 25 attempts", async () => {
    seedAssertion("n_par");
    const workers = Array.from({ length: 8 }, (_, workerId) => {
      return new Promise<number>((resolve, reject) => {
        const w = new Worker(new URL("./claim-worker.mts", import.meta.url), {
          workerData: { nonce: "n_par", attempts: 25, workerId },
          env: { ...process.env, ARAXIA_DB: DB_FILE },
        });
        w.once("message", resolve);
        w.once("error", reject);
      });
    });
    const wins = (await Promise.all(workers)).reduce((a, b) => a + b, 0);
    expect(wins).toBe(1);
  });

  it("never claims an expired assertion", () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT OR IGNORE INTO actions (digest, user_id, canonical_json, source, created_at, exp) VALUES (?, ?, ?, ?, ?, ?)").run(
      "ad_exp",
      "u_test",
      "{}",
      "test",
      Date.now(),
      now + 100,
    );
    db.prepare(
      "INSERT INTO assertions (nonce, action_digest, user_id, assurance, assertion_json, issued_at, exp) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run("n_exp", "ad_exp", "u_test", "AAL2", "{}", now - 120, now - 60);
    expect(claimAssertion("n_exp", "late")).toBe(false);
  });
});
