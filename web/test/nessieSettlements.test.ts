import { describe, expect, it } from "vitest";
import { applyNessieSettlements, type NessieMovement } from "../src/lib/nessieSettlements";
import type { NessieLedger } from "../src/lib/nessie";

const SRC = "8754ece6-c20e-4e50-a52d-edfa0007b04f";
const RENT = "aa8b031c-a818-421e-b4c9-04d7fb7e17ea";

function ledger(): NessieLedger {
  return {
    configured: true,
    reachable: true,
    sandbox: true,
    base_url: "https://nessie.test",
    source: {
      id: SRC,
      label: "CHECKING",
      role: "source",
      type: "Checking",
      nickname: "Araxia checking",
      balance_minor: 500_000,
    },
    payees: [
      {
        id: RENT,
        label: "RENT",
        role: "payee",
        type: "Checking",
        nickname: "Araxia rent",
        balance_minor: 10_000,
      },
    ],
    transfers: [],
    error: null,
    fetched_at: 1,
  };
}

describe("applyNessieSettlements", () => {
  it("leaves balances alone when there are no confirmed moves", () => {
    const out = applyNessieSettlements(ledger(), []);
    expect(out.source?.balance_minor).toBe(500_000);
    expect(out.balances_settled).toBe(false);
  });

  it("debits source and credits payee for confirmed transfers", () => {
    const moves: NessieMovement[] = [
      { src: SRC, dst: RENT, amount_minor: 2000 },
      { src: SRC, dst: RENT, amount_minor: 2500 },
    ];
    const out = applyNessieSettlements(ledger(), moves);
    expect(out.source?.balance_minor).toBe(495_500);
    expect(out.payees[0]?.balance_minor).toBe(14_500);
    expect(out.balances_settled).toBe(true);
  });
});

