import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createdObjectId,
  getNessieLedger,
  invalidateNessieLedger,
  parseNessieAccount,
  parseNessieTransfer,
  transferDescription,
} from "../src/lib/nessie";
import { nessieExecutor } from "../src/lib/executors/nessie";
import type { CanonicalAction } from "@araxia/verify";

const SRC = "8754ece6-c20e-4e50-a52d-edfa0007b04f";
const RENT = "aa8b031c-a818-421e-b4c9-04d7fb7e17ea";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const action: CanonicalAction = {
  v: 1,
  op: "nessie.transfer",
  aud: "nessie-sandbox",
  src: SRC,
  dst: RENT,
  amount_minor: 4500,
  ccy: "USD",
  reason: "RENT",
  nonce: "n_test",
  exp: 1,
};

describe("nessie parsers", () => {
  it("parses an account and converts dollars to cents", () => {
    const a = parseNessieAccount(
      { _id: SRC, type: "Checking", nickname: "Araxia checking", balance: 5000 },
      "CHECKING",
      "source",
    );
    expect(a).toEqual({
      id: SRC,
      label: "CHECKING",
      role: "source",
      type: "Checking",
      nickname: "Araxia checking",
      balance_minor: 500_000,
    });
  });

  it("parses a transfer that uses id instead of _id", () => {
    expect(parseNessieTransfer({ id: "t1", status: "completed", amount: 45, description: "x", transaction_date: "2026-09-13" })).toEqual({
      id: "t1",
      status: "completed",
      amount_minor: 4500,
      description: "x",
      transaction_date: "2026-09-13",
    });
  });

  it("reads objectCreated._id from a create response", () => {
    expect(createdObjectId({ code: 201, objectCreated: { _id: "t_new", amount: 45 } })).toBe("t_new");
  });

  it("binds the destination in the transfer description", () => {
    expect(transferDescription("n_abc", RENT)).toBe(`araxia n_abc dst=${RENT}`);
  });
});

describe("getNessieLedger", () => {
  beforeEach(() => {
    invalidateNessieLedger();
    process.env.NESSIE_API_KEY = "test-key";
    process.env.NESSIE_BASE_URL = "https://nessie.test";
    process.env.ARAXIA_SOURCE_ACCOUNT = SRC;
    process.env.ARAXIA_PAYEES_JSON = JSON.stringify({ RENT, SAVINGS: "0f5e4f3d-0c6f-4362-92b4-c4fab405b06e" });
  });

  afterEach(() => {
    invalidateNessieLedger();
    delete process.env.NESSIE_API_KEY;
    delete process.env.NESSIE_BASE_URL;
    delete process.env.ARAXIA_SOURCE_ACCOUNT;
    delete process.env.ARAXIA_PAYEES_JSON;
  });

  it("loads source, payees and transfers over HTTPS without sending the key in the cached view", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const u = String(url);
      expect(u).toContain("key=test-key");
      if (u.includes(`/accounts/${SRC}/transfers`)) {
        return jsonResponse(200, [{ id: "t1", status: "completed", amount: 45, description: "araxia n dst=" + RENT, transaction_date: "2026-09-13" }]);
      }
      if (u.includes(`/accounts/${SRC}`)) {
        return jsonResponse(200, { _id: SRC, type: "Checking", nickname: "Araxia checking", balance: 5000 });
      }
      if (u.includes(`/accounts/${RENT}`)) {
        return jsonResponse(200, { _id: RENT, type: "Checking", nickname: "Araxia rent", balance: 100 });
      }
      return jsonResponse(200, { _id: "0f5e4f3d-0c6f-4362-92b4-c4fab405b06e", type: "Savings", nickname: "Araxia savings", balance: 250 });
    });

    const ledger = await getNessieLedger(fetchMock);
    expect(ledger.reachable).toBe(true);
    expect(ledger.sandbox).toBe(true);
    expect(ledger.source?.balance_minor).toBe(500_000);
    expect(ledger.payees.map((p) => p.label).sort()).toEqual(["RENT", "SAVINGS"]);
    expect(ledger.transfers).toHaveLength(1);
    expect(ledger.transfers[0]?.amount_minor).toBe(4500);
    expect(JSON.stringify(ledger)).not.toContain("test-key");
    expect(fetchMock).toHaveBeenCalled();

    const cached = await getNessieLedger(fetchMock);
    expect(cached.transfers[0]?.id).toBe("t1");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(fetchMock.mock.calls.length).toBeLessThan(8);
  });

  it("treats an empty transfer collection (HTTP 404) as no transfers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/transfers")) return jsonResponse(404, { message: "not found" });
      return jsonResponse(200, { _id: SRC, type: "Checking", nickname: "Araxia checking", balance: 5000 });
    });
    process.env.ARAXIA_PAYEES_JSON = "{}";
    const ledger = await getNessieLedger(fetchMock);
    expect(ledger.reachable).toBe(true);
    expect(ledger.transfers).toEqual([]);
  });

  it("does not call the network when the source account is not a Nessie id", async () => {
    process.env.ARAXIA_SOURCE_ACCOUNT = "demo_checking";
    const fetchMock = vi.fn<typeof fetch>();
    const ledger = await getNessieLedger(fetchMock);
    expect(ledger.reachable).toBe(false);
    expect(ledger.error).toMatch(/not a Nessie account id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("nessieExecutor live schema", () => {
  beforeEach(() => {
    process.env.NESSIE_API_KEY = "test-key";
    process.env.NESSIE_BASE_URL = "https://nessie.test";
  });

  afterEach(() => {
    delete process.env.NESSIE_API_KEY;
    delete process.env.NESSIE_BASE_URL;
  });

  it("POSTs only the live TransferCreate fields", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(201, { code: 201, objectCreated: { _id: "t_live", status: "completed", amount: 45 } }),
    );
    const r = await nessieExecutor(fetchMock).execute(action, "n_live");
    expect(r.status).toBe("CONFIRMED");
    expect(r.providerRef).toBe("t_live");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`https://nessie.test/accounts/${SRC}/transfers?key=test-key`);
    expect(JSON.parse(String(init?.body))).toEqual({
      transaction_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      status: "completed",
      amount: 45,
      description: `araxia n_live dst=${RENT}`,
    });
  });
});
