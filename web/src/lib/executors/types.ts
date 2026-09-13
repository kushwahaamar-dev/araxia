import type { Assertion, CanonicalAction } from "@araxia/verify";
import type { Commitment } from "../commitment";

export type ExecOutcome = {
  status: "CONFIRMED" | "FAILED" | "UNCERTAIN";
  providerRef: string | null;
  response: unknown;
  note?: string;
};

/** Everything the runner already verified; rails may publish commitments from it. */
export interface ExecContext {
  assertion: Assertion;
  commitment: Commitment;
  memo: string;
}

// One rail, one audience. `execute` is called at most once per assertion nonce;
// the runner guarantees that, the executor must not retry on its own.
export interface Executor {
  rail: string;
  aud: string;
  execute(action: CanonicalAction, assertionNonce: string, ctx?: ExecContext): Promise<ExecOutcome>;
}
