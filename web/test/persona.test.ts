import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureUser, resetDbForTests } from "../src/lib/db";
import { isPersonaApproved, requirePersonaApproved, startInquiry } from "../src/lib/persona";
import { HttpError } from "../src/lib/http";

const DB = path.join(mkdtempSync(path.join(tmpdir(), "araxia-kyc-")), "t.db");

beforeEach(() => {
  resetDbForTests(DB);
  ensureUser("u_test", "Test");
  process.env.PERSONA_API_KEY = "persona_sandbox_test";
  process.env.PERSONA_TEMPLATE_ID = "itmpl_test";
});

afterEach(() => {
  delete process.env.PERSONA_API_KEY;
  delete process.env.PERSONA_TEMPLATE_ID;
});

function fakeFetch(status: string, http = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ data: { id: "inq_1", attributes: { status } } }), { status: http })) as typeof fetch;
}

describe("Persona gate", () => {
  it("blocks passkey registration until approved", async () => {
    expect(isPersonaApproved("u_test")).toBe(false);
    expect(() => requirePersonaApproved("u_test")).toThrow(HttpError);
    await startInquiry("u_test", fakeFetch("pending"));
    expect(isPersonaApproved("u_test")).toBe(false);
    await startInquiry("u_test", fakeFetch("approved"));
    expect(isPersonaApproved("u_test")).toBe(true);
    expect(() => requirePersonaApproved("u_test")).not.toThrow();
    const again = await startInquiry("u_test", fakeFetch("pending"));
    expect(again.status).toBe("approved");
  });

  it("is a no-op when Persona is not configured", () => {
    delete process.env.PERSONA_API_KEY;
    expect(isPersonaApproved("u_test")).toBe(true);
    expect(() => requirePersonaApproved("u_test")).not.toThrow();
  });
});
