import type { Executor } from "./types";
import { nessieExecutor } from "./nessie";
import { solanaExecutor } from "./solana";

export function executorFor(aud: string): Executor {
  if (aud === "solana-devnet") return solanaExecutor();
  return nessieExecutor();
}
