import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { actionDigest } from "@araxia/verify";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { beforeAll, describe, expect, it } from "vitest";
import { ActionError, ALLOWED_PAYEES, AUD_FOR_OP, buildAction, getAction, SOURCE_ACCOUNT, storeAction } from "../src/lib/actions";
import { ensureUser, getDb, resetDbForTests } from "../src/lib/db";
import { approvalOptions, listPasskeys, verifyApproval } from "../src/lib/passkeys";

const DB_FILE = path.join(mkdtempSync(path.join(tmpdir(), "araxia-approval-")), "test.db");
const USER = "u_approve";

const valid = { op: "nessie.transfer", dst: "RENT", amount_minor: 4500, ccy: "USD", reason: "September rent" };

// Never reaches the authenticator in these tests; every rejection happens before it.
const fakeResponse: AuthenticationResponseJSON = {
  id: "cred_fake",
  rawId: "cred_fake",
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "", authenticatorData: "", signature: "" },
};

function insertChallenge(id: string, over: Partial<{ user_id: string; kind: string; action_digest: string | null; expires_at: number; used_at: number | null }> = {}) {
  const row = {
    user_id: USER,
    kind: "approve",
    action_digest: "a".repeat(64),
    expires_at: Date.now() + 60_000,
    used_at: null,
    ...over,
  };
  getDb()
    .prepare("INSERT INTO challenges (id, user_id, kind, action_digest, challenge, expires_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, row.user_id, row.kind, row.action_digest, "c_" + id, row.expires_at, row.used_at);
}

beforeAll(() => {
  resetDbForTests(DB_FILE);
  ensureUser(USER, "Approver");
});

describe("buildAction", () => {
  it("resolves a payee label to its account id and fills the envelope", () => {
    const a = buildAction(valid);
    expect(a.v).toBe(1);
    expect(a.dst).toBe(ALLOWED_PAYEES.RENT);
    expect(a.src).toBe(SOURCE_ACCOUNT);
    expect(a.aud).toBe(AUD_FOR_OP["nessie.transfer"]);
    expect(a.nonce.startsWith("n_")).toBe(true);
    expect(a.exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(110);
    expect(a.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(120);
  });

  it("accepts a payee account id directly", () => {
    expect(buildAction({ ...valid, dst: ALLOWED_PAYEES.SAVINGS! }).dst).toBe(ALLOWED_PAYEES.SAVINGS);
  });

  it("rejects an unknown payee", () => {
    expect(() => buildAction({ ...valid, dst: "MALLORY" })).toThrow(ActionError);
    expect(() => buildAction({ ...valid, dst: "MALLORY" })).toThrow("payee not allowed");
  });

  it("rejects non-integer and non-positive amounts", () => {
    expect(() => buildAction({ ...valid, amount_minor: 12.5 })).toThrow(ActionError);
    expect(() => buildAction({ ...valid, amount_minor: 0 })).toThrow(ActionError);
    expect(() => buildAction({ ...valid, amount_minor: -1 })).toThrow(ActionError);
  });

  it("rejects an unknown op", () => {
    expect(() => buildAction({ ...valid, op: "nessie.withdrawal" })).toThrow(ActionError);
  });

  it("rejects malformed ccy and reason", () => {
    expect(() => buildAction({ ...valid, ccy: "usd" })).toThrow(ActionError);
    expect(() => buildAction({ ...valid, ccy: "USDC" })).toThrow(ActionError);
    expect(() => buildAction({ ...valid, reason: "" })).toThrow(ActionError);
    expect(() => buildAction({ ...valid, reason: "x".repeat(65) })).toThrow(ActionError);
  });
});

describe("storeAction / getAction", () => {
  it("round-trips and the stored digest is the canonical digest", () => {
    const action = buildAction(valid);
    const stored = storeAction(USER, action, "manual");
    expect(stored.action_digest).toBe(actionDigest(action));
    const loaded = getAction(stored.action_digest);
    expect(loaded).not.toBeNull();
    expect(loaded!.user_id).toBe(USER);
    expect(loaded!.exp).toBe(action.exp);
    expect(loaded!.action).toEqual(action);
    expect(actionDigest(loaded!.action)).toBe(stored.action_digest);
  });

  it("returns null for an unknown digest", () => {
    expect(getAction("0".repeat(64))).toBeNull();
  });
});

describe("verifyApproval challenge binding", () => {
  const digest = "a".repeat(64);
  const other = "b".repeat(64);

  it("refuses a challenge issued for a different action digest", async () => {
    insertChallenge("ch_bound");
    await expect(verifyApproval(USER, other, "ch_bound", fakeResponse)).rejects.toThrow("challenge bound to a different action");
    // Rejection must not consume the challenge.
    const row = getDb().prepare("SELECT used_at FROM challenges WHERE id = ?").get("ch_bound") as { used_at: number | null };
    expect(row.used_at).toBeNull();
  });

  it("refuses a used challenge", async () => {
    insertChallenge("ch_used", { used_at: Date.now() - 1000 });
    await expect(verifyApproval(USER, digest, "ch_used", fakeResponse)).rejects.toThrow("challenge already used");
  });

  it("refuses an expired challenge", async () => {
    insertChallenge("ch_expired", { expires_at: Date.now() - 1 });
    await expect(verifyApproval(USER, digest, "ch_expired", fakeResponse)).rejects.toThrow("challenge expired");
  });

  it("refuses a challenge that belongs to another user or is not an approval", async () => {
    insertChallenge("ch_other_user", { user_id: "u_someone_else" });
    await expect(verifyApproval(USER, digest, "ch_other_user", fakeResponse)).rejects.toThrow("unknown challenge");
    insertChallenge("ch_register", { kind: "register", action_digest: null });
    await expect(verifyApproval(USER, digest, "ch_register", fakeResponse)).rejects.toThrow("unknown challenge");
    await expect(verifyApproval(USER, digest, "ch_missing", fakeResponse)).rejects.toThrow("unknown challenge");
  });

  it("refuses an unknown credential once the challenge checks pass", async () => {
    insertChallenge("ch_nocred");
    await expect(verifyApproval(USER, digest, "ch_nocred", fakeResponse)).rejects.toThrow("unknown credential");
  });
});

describe("approvalOptions", () => {
  it("requires a registered passkey", async () => {
    expect(listPasskeys(USER)).toEqual([]);
    await expect(approvalOptions(USER, "a".repeat(64))).rejects.toThrow("no passkey registered");
  });
});
