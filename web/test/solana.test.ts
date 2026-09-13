import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalAction } from "@araxia/verify";
import { executorFor } from "../src/lib/executors/pick";
import { solscanAccount, solscanTx } from "../src/app/lib-client/solscan";
import { getSolanaSnapshot, solanaExecutor } from "../src/lib/executors/solana";

function loadLocalSolana(): void {
  const file = new URL("../.env.local", import.meta.url);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^(SOLANA_KEYPAIR|SOLANA_RPC|SOLANA_PAYEE)=(.*)$/.exec(line);
    if (!m?.[1] || !m[2] || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

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
  it("points every address and signature at Solscan devnet", () => {
    expect(solscanAccount("Cxt17a9cVjuztfPV3vcBKuBNEDj9f6J4kth9vRdfbW1S")).toBe(
      "https://solscan.io/account/Cxt17a9cVjuztfPV3vcBKuBNEDj9f6J4kth9vRdfbW1S?cluster=devnet",
    );
    expect(solscanTx("sig111")).toBe("https://solscan.io/tx/sig111?cluster=devnet");
  });

  it("binds the assertion nonce and user memo into the send", async () => {
    process.env.SOLANA_KEYPAIR = "/tmp/unused.json";
    let memo = "";
    const ex = solanaExecutor(async (args) => {
      memo = args.memo;
      return { signature: "sig111" };
    });
    await ex.execute(action, "an_1");
    expect(memo).toContain("an_1");
    expect(memo).toContain("DEVNET");
  });

  it("confirms with an explorer link when send succeeds", async () => {
    process.env.SOLANA_KEYPAIR = "/tmp/unused.json";
    const ex = solanaExecutor(async () => ({ signature: "sig111" }));
    const out = await ex.execute(action, "an_1");
    expect(out.status).toBe("CONFIRMED");
    expect(out.providerRef).toBe("sig111");
    expect(JSON.stringify(out.response)).toContain("solscan.io/tx/sig111");
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

  it("reads a live devnet balance when a keypair is configured", async () => {
    delete process.env.SOLANA_KEYPAIR;
    loadLocalSolana();
    if (!process.env.SOLANA_KEYPAIR) return;
    process.env.SOLANA_LIVE = "1";
    const snap = await getSolanaSnapshot(Date.now() + 20_000);
    expect(snap.configured).toBe(true);
    expect(snap.reachable).toBe(true);
    expect(snap.address).toBeTruthy();
    expect(snap.lamports).toBeGreaterThanOrEqual(0);
    expect(snap.error).toBeNull();
  }, 30_000);
});
