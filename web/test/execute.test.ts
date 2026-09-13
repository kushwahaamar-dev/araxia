process.env.ARAXIA_ISSUER_SEED_HEX = "7f".repeat(32);
process.env.NESSIE_API_KEY = "test-nessie-key";

import { generateKeyPairSync, randomBytes, sign as nodeSign, type KeyObject } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalize, type Assertion, type CanonicalAction, type JsonValue } from "@araxia/verify";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { POST as executePost } from "../src/app/api/execute/route";
import { GET as statusGet } from "../src/app/api/status/route";
import { POST as verifyPost } from "../src/app/api/verify/route";
import { storeAction } from "../src/lib/actions";
import { ensureUser, getDb, getExecutionByNonce, nowS, resetDbForTests } from "../src/lib/db";
import { ingestEnvelope, registerBridge } from "../src/lib/evidence";
import { nessieExecutor } from "../src/lib/executors/nessie";
import { runExecution } from "../src/lib/executors/run";
import type { Executor } from "../src/lib/executors/types";
import { issueAssertion } from "../src/lib/issuer";
import { POLICY_HASH } from "../src/lib/policy";

const DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "araxia-exec-")), "test.db");

type Over = Record<string, JsonValue>;

// Each test gets its own user and bridge so "latest evidence" is whatever
// that test ingested last, not something a neighbour left behind.
function fixture() {
  const userId = "u_" + randomBytes(4).toString("hex");
  const bridgeId = "b_" + userId;
  ensureUser(userId, userId);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  registerBridge(bridgeId, userId, Buffer.from(jwk.x, "base64url").toString("hex"));
  let seq = 0;

  function ingest(over: Over = {}, receivedAt = Date.now()) {
    seq += 1;
    const payload: Over = {
      v: 1,
      bridge_id: bridgeId,
      device_id: "d_test",
      session_id: "s_" + userId,
      seq,
      issued_at_ms: receivedAt,
      latest_age_ms: 900,
      count: 19,
      valid_ratio_pct: 100,
      median_gap_ms: 1019,
      p95_gap_ms: 1040,
      max_gap_ms: 1055,
      distinct_values_30s: 4,
      frozen_for_ms: 0,
      contact: "unsupported",
      rr_present: false,
      presence: "READY",
      drift: "NOMINAL",
      model_version: "m1",
      ...over,
    };
    const canonical = canonicalize(payload);
    const sig = nodeSign(null, Buffer.from(canonical), privateKey as KeyObject).toString("base64");
    const r = ingestEnvelope({ kid: bridgeId, payload: canonical, sig }, receivedAt);
    if (!r.ok) throw new Error(`ingest failed: ${r.reason}`);
    return r.view;
  }

  function mint(evidenceDigest: string, over: Partial<CanonicalAction> = {}): Assertion {
    const action: CanonicalAction = {
      v: 1,
      op: "nessie.transfer",
      aud: "nessie-sandbox",
      src: "acct_checking",
      dst: "acct_rent",
      amount_minor: 4500,
      ccy: "USD",
      reason: "rent",
      nonce: "n_" + randomBytes(16).toString("base64url"),
      exp: nowS() + 100,
      ...over,
    };
    const stored = storeAction(userId, action, "test");
    const assertion = issueAssertion({
      sub: userId,
      action,
      passkeyCredId: "pk_test",
      evidenceDigest,
      assurance: "AAL3",
      approvedAtS: nowS(),
      policyHash: POLICY_HASH,
    });
    getDb()
      .prepare(
        "INSERT INTO assertions (nonce, action_digest, user_id, assurance, assertion_json, issued_at, exp) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(assertion.nonce, stored.action_digest, userId, assertion.assurance, JSON.stringify(assertion), assertion.iat, assertion.exp);
    return assertion;
  }

  return { userId, ingest, mint };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(impl: () => Promise<Response>) {
  return vi.fn<typeof fetch>(impl);
}

beforeAll(() => {
  resetDbForTests(DB_FILE);
});

describe("runExecution", () => {
  it("verifies, re-checks presence, claims once and confirms on 2xx", async () => {
    const f = fixture();
    const ev = f.ingest();
    const assertion = f.mint(ev.digest);
    const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(201, { objectCreated: { _id: "t_1" } })));

    const r = await runExecution(assertion, nessieExecutor(fetchMock), "test");
    expect(r).toMatchObject({ outcome: "EXECUTED", status: "CONFIRMED", providerRef: "t_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.nessieisreal.com/accounts/acct_checking/transfers?key=test-nessie-key");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      amount: 45,
      status: "completed",
      description: `araxia ${assertion.nonce} dst=acct_rent`,
    });
    expect(body).not.toHaveProperty("medium");
    expect(body).not.toHaveProperty("payee_id");
    expect(body.transaction_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const row = getExecutionByNonce(assertion.nonce);
    expect(row).toMatchObject({ status: "CONFIRMED", provider_ref: "t_1", rail: "nessie" });
    expect(row?.finished_at).not.toBeNull();
    expect(row?.response_json).not.toContain("test-nessie-key");
  });

  it("denies a replayed assertion at the claim step without calling the provider again", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(201, { objectCreated: { _id: "t_2" } })));
    const exec = nessieExecutor(fetchMock);

    const first = await runExecution(assertion, exec, "test");
    expect(first.outcome).toBe("EXECUTED");
    const second = await runExecution(assertion, exec, "test");
    expect(second).toMatchObject({ outcome: "DENIED", step: "claim" });
    expect(second.outcome === "DENIED" && second.reason).toMatch(/nonce already claimed \(execution \d+, CONFIRMED\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("denies a mutated amount at the verify step", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(201, {})));
    const tampered: Assertion = { ...assertion, action: { ...assertion.action, amount_minor: 450_000 } };

    const r = await runExecution(tampered, nessieExecutor(fetchMock), "test");
    expect(r).toEqual({ outcome: "DENIED", step: "verify", reason: "signature mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getExecutionByNonce(assertion.nonce)).toBeUndefined();
  });

  it("denies STALE presence at execution and leaves the nonce unclaimed", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    f.ingest({ presence: "STALE", frozen_for_ms: 6000 });
    const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(201, { objectCreated: { _id: "t_3" } })));
    const exec = nessieExecutor(fetchMock);

    const denied = await runExecution(assertion, exec, "test");
    expect(denied).toEqual({ outcome: "DENIED", step: "presence", reason: "presence STALE at execution" });
    expect(fetchMock).not.toHaveBeenCalled();

    f.ingest({ presence: "READY" });
    const ok = await runExecution(assertion, exec, "test");
    expect(ok).toMatchObject({ outcome: "EXECUTED", status: "CONFIRMED", providerRef: "t_3" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("denies when the newest evidence is older than 3 s", async () => {
    const f = fixture();
    const ev = f.ingest({}, Date.now() - 4000);
    const assertion = f.mint(ev.digest);
    const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(201, {})));

    const r = await runExecution(assertion, nessieExecutor(fetchMock), "test");
    expect(r).toEqual({ outcome: "DENIED", step: "presence", reason: "presence evidence older than 3 s at execution" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies when there is no evidence at all", async () => {
    const f = fixture();
    const assertion = f.mint("e_none");
    const r = await runExecution(assertion, nessieExecutor(fakeFetch(() => Promise.resolve(jsonResponse(201, {})))), "test");
    expect(r).toEqual({ outcome: "DENIED", step: "presence", reason: "no fresh presence evidence" });
  });

  it("records UNCERTAIN on timeout and never retries", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    const fetchMock = fakeFetch(() => Promise.reject(new DOMException("The operation was aborted", "AbortError")));
    const exec = nessieExecutor(fetchMock);

    const r = await runExecution(assertion, exec, "test");
    expect(r).toMatchObject({ outcome: "EXECUTED", status: "UNCERTAIN", providerRef: null });
    expect(r.outcome === "EXECUTED" && r.note).toMatch(/timed out.*no retry is allowed/);
    expect(getExecutionByNonce(assertion.nonce)?.status).toBe("UNCERTAIN");

    const again = await runExecution(assertion, exec, "test");
    expect(again).toMatchObject({ outcome: "DENIED", step: "claim" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records UNCERTAIN on a network error and on 5xx", async () => {
    const f = fixture();
    const a1 = f.mint(f.ingest().digest);
    const r1 = await runExecution(a1, nessieExecutor(fakeFetch(() => Promise.reject(new TypeError("fetch failed")))), "test");
    expect(r1).toMatchObject({ outcome: "EXECUTED", status: "UNCERTAIN" });
    expect(r1.outcome === "EXECUTED" && r1.note).toMatch(/network error/);

    const a2 = f.mint(f.ingest().digest);
    const r2 = await runExecution(a2, nessieExecutor(fakeFetch(() => Promise.resolve(jsonResponse(503, "upstream down")))), "test");
    expect(r2).toMatchObject({ outcome: "EXECUTED", status: "UNCERTAIN" });
    expect(r2.outcome === "EXECUTED" && r2.note).toMatch(/HTTP 503/);
  });

  it("records FAILED on a 4xx from the provider", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(400, { code: 400, message: "bad payee" })));

    const r = await runExecution(assertion, nessieExecutor(fetchMock), "test");
    expect(r).toMatchObject({ outcome: "EXECUTED", status: "FAILED", providerRef: null });
    expect(getExecutionByNonce(assertion.nonce)?.status).toBe("FAILED");
  });

  it("fails without a network call when NESSIE_API_KEY is missing", async () => {
    const saved = process.env.NESSIE_API_KEY;
    delete process.env.NESSIE_API_KEY;
    try {
      const f = fixture();
      const assertion = f.mint(f.ingest().digest);
      const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(201, {})));
      const r = await runExecution(assertion, nessieExecutor(fetchMock), "test");
      expect(r).toMatchObject({ outcome: "EXECUTED", status: "FAILED", note: "NESSIE_API_KEY not configured" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.NESSIE_API_KEY = saved;
    }
  });

  it("denies an assertion presented to an executor with a different audience", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    const fetchMock = fakeFetch(() => Promise.resolve(jsonResponse(201, {})));
    const solana: Executor = { ...nessieExecutor(fetchMock), aud: "solana-devnet" };

    const r = await runExecution(assertion, solana, "test");
    expect(r).toEqual({ outcome: "DENIED", step: "verify", reason: "audience mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("routes", () => {
  const post = (body: unknown) =>
    new Request("http://araxia.test/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("POST /api/execute returns 400 on a malformed body and 403 on a denied assertion", async () => {
    expect((await executePost(post({ assertion: { nonce: "x" } }))).status).toBe(400);
    expect((await executePost(new Request("http://araxia.test/api/x", { method: "POST", body: "{" }))).status).toBe(400);

    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    const tampered = { ...assertion, sub: "someone_else" };
    const res = await executePost(post({ assertion: tampered }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ outcome: "DENIED", step: "verify", reason: "signature mismatch" });
    expect(getExecutionByNonce(assertion.nonce)).toBeUndefined();
  });

  it("POST /api/verify reports a verdict without claiming", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    const good = await (await verifyPost(post({ assertion, aud: "nessie-sandbox" }))).json();
    expect(good).toMatchObject({ ok: true, reason: "valid", kid: assertion.kid });
    expect(typeof good.checked_at).toBe("number");

    const wrongAud = await (await verifyPost(post({ assertion, aud: "solana-devnet" }))).json();
    expect(wrongAud).toMatchObject({ ok: false, reason: "audience mismatch" });

    const extraField = await (await verifyPost(post({ assertion: { ...assertion, memo: "smuggled" } }))).json();
    expect(extraField).toMatchObject({ ok: false, reason: "signature mismatch" });

    const claimed = getDb().prepare("SELECT claimed_at FROM assertions WHERE nonce = ?").get(assertion.nonce) as { claimed_at: number | null };
    expect(claimed.claimed_at).toBeNull();
  });

  it("GET /api/status returns evidence, assurance and the execution history", async () => {
    const f = fixture();
    const assertion = f.mint(f.ingest().digest);
    await runExecution(assertion, nessieExecutor(fakeFetch(() => Promise.resolve(jsonResponse(201, { objectCreated: { _id: "t_s" } })))), "test");

    const res = await statusGet(new Request(`http://araxia.test/api/status?user=${f.userId}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      user: f.userId,
      fresh: true,
      assurance: "AAL3",
      policy_hash: POLICY_HASH,
      issuer: { kid: assertion.kid },
    });
    expect(body.evidence.presence).toBe("READY");
    expect(body.bridges).toHaveLength(1);
    expect(body.executions).toHaveLength(1);
    expect(body.executions[0]).toMatchObject({
      assertion_nonce: assertion.nonce,
      rail: "nessie",
      status: "CONFIRMED",
      provider_ref: "t_s",
      assurance: "AAL3",
      action: assertion.action,
    });

    expect((await statusGet(new Request("http://araxia.test/api/status"))).status).toBe(400);
  });
});
