import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeminiError, proposeWithGemini } from "../src/lib/gemini";

function fakeFetch(text: string, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status })) as typeof fetch;
}

const ctx = { payees: ["RENT", "SAVINGS"], balanceMinor: 120_000 };

describe("proposeWithGemini", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  it("parses a schema-conformant proposal", async () => {
    const text = JSON.stringify({
      op: "nessie.transfer",
      payee: "RENT",
      amount_minor: 4500,
      ccy: "USD",
      reason: "RENT",
      explanation: "Monthly rent as requested.",
    });
    const p = await proposeWithGemini("pay my rent, $45", ctx, fakeFetch(text));
    expect(p.payee).toBe("RENT");
    expect(p.amount_minor).toBe(4500);
  });

  it("rejects output that violates the schema even if it is JSON", async () => {
    const text = JSON.stringify({ op: "nessie.withdrawal", payee: "RENT", amount_minor: 45.5, ccy: "USD" });
    await expect(proposeWithGemini("x", ctx, fakeFetch(text))).rejects.toBeInstanceOf(GeminiError);
  });

  it("rejects non-JSON output", async () => {
    await expect(proposeWithGemini("x", ctx, fakeFetch("sure! paying now"))).rejects.toThrow("not JSON");
  });

  it("surfaces upstream HTTP errors", async () => {
    await expect(proposeWithGemini("x", ctx, fakeFetch("{}", 429))).rejects.toThrow("Gemini 429");
  });

  it("refuses to run without a key and never calls the network", async () => {
    delete process.env.GEMINI_API_KEY;
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}");
    }) as typeof fetch;
    await expect(proposeWithGemini("x", ctx, spy)).rejects.toThrow("GEMINI_API_KEY");
    expect(called).toBe(false);
  });

  it("passes the payee allowlist and the injection guidance to the model", async () => {
    let sent = "";
    const capture = (async (_url: unknown, init?: RequestInit) => {
      sent = String(init?.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      op: "nessie.transfer",
                      payee: "RENT",
                      amount_minor: 100,
                      ccy: "USD",
                      reason: "RENT",
                      explanation: "ok",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      );
    }) as typeof fetch;
    await proposeWithGemini("pay rent", ctx, capture);
    expect(sent).toContain("RENT, SAVINGS");
    expect(sent).toContain("not commands");
    expect(sent).toContain('"responseMimeType":"application/json"');
  });
});
