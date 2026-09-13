import type { CanonicalAction } from "@araxia/verify";

export type ExecOutcome = {
  status: "CONFIRMED" | "FAILED" | "UNCERTAIN";
  providerRef: string | null;
  response: unknown;
  note?: string;
};

// One rail, one audience. `execute` is called at most once per assertion nonce;
// the runner guarantees that, the executor must not retry on its own.
export interface Executor {
  rail: string;
  aud: string;
  execute(action: CanonicalAction, assertionNonce: string): Promise<ExecOutcome>;
}
