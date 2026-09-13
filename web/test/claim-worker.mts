// Worker used by core.test.ts: every worker hammers the same nonce.
import { parentPort, workerData } from "node:worker_threads";
import { claimAssertion } from "../src/lib/db.ts";

const { nonce, attempts, workerId } = workerData as { nonce: string; attempts: number; workerId: number };
let wins = 0;
for (let i = 0; i < attempts; i++) {
  if (claimAssertion(nonce, `w${workerId}-${i}`)) wins++;
}
parentPort?.postMessage(wins);
