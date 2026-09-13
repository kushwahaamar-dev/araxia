import { describe, expect, it } from "vitest";
import type { CanonicalAction } from "@araxia/verify";
import { executorFor } from "../src/lib/executors/pick";
import { solanaExecutor } from "../src/lib/executors/solana";

const action: CanonicalAction = {
  v: 1,
  op: "solana.transfer",
  aud: "solana-devnet",
  src: "relayer",
  dst: "Cxt17a9cVjuztfPV3vcBKuBNEDj9f6J4kth9vRdfbW1S",
  amount_minor: 5000,
  ccy: "SOL",
  reason: "DEVNET",
  nonce: "n_test",
  exp: Math.floor(Date.now() / 1000) + 60,
};

describe("solana executor", () => {
  it("confirms with an explorer link when send succeeds", async () => {
    process.env.SOLANA_KEYPAIR = "/tmp/unused.json";
    const ex = solanaExecutor(async () => ({ signature: "sig111" }));
    const out = await ex.execute(action, "an_1");
    expect(out.status).toBe("CONFIRMED");
    expect(out.providerRef).toBe("sig111");
    expect(JSON.stringify(out.response)).toContain("explorer.solana.com");
  });

  it("fails closed without a keypair and never sends", async () => {
    delete process.env.SOLANA_KEYPAIR;
    let called = false;
    const ex = solanaExecutor(async () => {
      called = true;
      return { signature: "x" };
    });
    const out = await ex.execute(action, "an_1");
    expect(out.status).toBe("FAILED");
    expect(called).toBe(false);
  });

  it("routes solana-devnet to the Solana executor", () => {
    expect(executorFor("solana-devnet").rail).toBe("solana");
    expect(executorFor("nessie-sandbox").rail).toBe("nessie");
  });

  it("does not retry on send failure", async () => {
    process.env.SOLANA_KEYPAIR = "/tmp/unused.json";
    let n = 0;
    const ex = solanaExecutor(async () => {
      n += 1;
      throw new Error("insufficient lamports");
    });
    const out = await ex.execute(action, "an_1");
    expect(out.status).toBe("FAILED");
    expect(n).toBe(1);
  });
});
