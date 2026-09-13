import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Assertion } from "@araxia/verify";
import {
  assertionDigest,
  buildCommitment,
  COMMITMENT_VERSION,
  decodeMemo,
  encodeMemo,
  MEMO_MAX,
  rangeCommitment,
  userCommitment,
} from "../src/lib/commitment";
import type { EvidenceView } from "../src/lib/policy";

const SEED = "11".repeat(32);

const assertion: Assertion = {
  iss: "araxia-local",
  kid: "k_test",
  sub: "u_amar",
  action: {
    v: 1,
    op: "solana.transfer",
    aud: "solana-devnet",
    src: "relayer",
    dst: "Cxt17a9cVjuztfPV3vcBKuBNEDj9f6J4kth9vRdfbW1S",
    amount_minor: 5000,
    ccy: "SOL",
    reason: "HackRice presence pay",
    nonce: "n_abc",
    exp: 999,
  },
  action_digest: "d".repeat(64),
  passkey_cred_id: "cred",
  approved_at: 1,
  evidence_digest: "e".repeat(64),
  assurance: "AAL3",
  nonce: "an_xyz",
  iat: 1,
  nbf: 1,
  exp: 61,
  policy_hash: "p".repeat(64),
  sig: "s".repeat(128),
};

const evidence: EvidenceView = {
  digest: "ab".repeat(32),
  presence: "READY",
  drift: "NOMINAL",
  received_at: 1,
  latest_age_ms: 80,
  frozen_for_ms: 0,
  distinct_values_30s: 9,
};

describe("on-chain commitment", () => {
  beforeEach(() => {
    process.env.ARAXIA_ISSUER_SEED_HEX = SEED;
  });
  afterEach(() => {
    delete process.env.ARAXIA_ISSUER_SEED_HEX;
  });

  it("commits hashes only; no user id, name, or BPM value in the memo", () => {
    const c = buildCommitment(assertion, evidence, { centroid: 110, sd: 10 });
    const memo = encodeMemo(c);
    expect(memo.startsWith(COMMITMENT_VERSION)).toBe(true);
    expect(memo).not.toContain("u_amar");
    expect(memo).not.toContain("Amar");
    expect(memo).not.toContain("110");
    expect(memo).toContain("n=an_xyz");
    expect(memo).toContain("p=READY/AAL3");
    expect(memo.length).toBeLessThanOrEqual(MEMO_MAX);
  });

  it("round-trips through the memo string", () => {
    const c = buildCommitment(assertion, evidence, { centroid: 110, sd: 10 });
    expect(decodeMemo(encodeMemo(c))).toEqual(c);
  });

  it("keyed commitments are deterministic and differ per user and range", () => {
    expect(userCommitment("u_amar")).toBe(userCommitment("u_amar"));
    expect(userCommitment("u_amar")).not.toBe(userCommitment("u_jagrati"));
    expect(rangeCommitment("u_amar", { centroid: 110, sd: 10 })).not.toBe(rangeCommitment("u_amar", { centroid: 124, sd: 8 }));
    expect(rangeCommitment("u_laksh", { centroid: null, sd: null })).toBe("none");
  });

  it("binds the exact signed assertion", () => {
    const tampered = { ...assertion, action: { ...assertion.action, amount_minor: 6000 } } as Assertion;
    expect(assertionDigest(tampered)).not.toBe(assertionDigest(assertion));
    expect(buildCommitment(tampered, evidence, { centroid: null, sd: null }).a).not.toBe(
      buildCommitment(assertion, evidence, { centroid: null, sd: null }).a,
    );
  });

  it("truncates a long human memo instead of overflowing the instruction", () => {
    const long = { ...assertion, action: { ...assertion.action, reason: "x".repeat(2000) } } as Assertion;
    const memo = encodeMemo(buildCommitment(long, evidence, { centroid: null, sd: null }));
    expect(memo.length).toBeLessThanOrEqual(MEMO_MAX);
    expect(decodeMemo(memo)?.n).toBe("an_xyz");
  });

  it("rejects memos from another version or with missing fields", () => {
    expect(decodeMemo("araxia an_1 rent")).toBeNull();
    expect(decodeMemo(`${COMMITMENT_VERSION} n=an_1`)).toBeNull();
  });
});
