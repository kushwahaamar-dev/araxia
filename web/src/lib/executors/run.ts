// The executor's checklist: verify, re-check presence, claim the nonce once,
// call the provider once, record what happened. Every step fails closed and
// nothing here ever issues a second provider call.

import { verifyAssertion, type Assertion } from "@araxia/verify";
import { claimAssertion, finishExecution, getExecutionByNonce, insertExecution, logEvent, logSecurity } from "../db";
import { latestEvidence } from "../evidence";
import { getIssuer } from "../issuer";
import { evidenceIsFresh } from "../policy";
import { wearerHalted } from "../wearers";
import type { ExecOutcome, Executor } from "./types";

export type ExecResult =
  | { outcome: "DENIED"; reason: string; step: "verify" | "presence" | "claim" }
  | {
      outcome: "EXECUTED";
      status: ExecOutcome["status"];
      providerRef: string | null;
      executionId: number;
      response: unknown;
      note?: string;
    };

const denied = (step: "verify" | "presence" | "claim", reason: string): ExecResult => ({ outcome: "DENIED", step, reason });

export async function runExecution(assertion: Assertion, executor: Executor, claimedBy: string): Promise<ExecResult> {
  const issuer = getIssuer();
  const verdict = verifyAssertion(assertion, {
    issuerPublicKeyHex: issuer.publicKeyHex,
    expectedKid: issuer.kid,
    expectedAud: executor.aud,
  });
  if (!verdict.ok) {
    logEvent("execution.denied", { nonce: assertion.nonce, step: "verify", reason: verdict.reason });
    logSecurity("execution.denied", { nonce: assertion.nonce, step: "verify", reason: verdict.reason });
    return denied("verify", verdict.reason);
  }

  if (wearerHalted()) {
    logEvent("execution.denied", { nonce: assertion.nonce, step: "presence", reason: "wearer changed" });
    logSecurity("execution.denied", { nonce: assertion.nonce, step: "presence", reason: "wearer changed" });
    return denied("presence", "user has been changed; switch wearer before executing");
  }

  const ev = latestEvidence(assertion.sub);
  if (!evidenceIsFresh(ev, Date.now())) {
    const reason = ev ? "presence evidence older than 3 s at execution" : "no fresh presence evidence";
    logEvent("execution.denied", { nonce: assertion.nonce, step: "presence", reason });
    logSecurity("execution.denied", { nonce: assertion.nonce, step: "presence", reason });
    return denied("presence", reason);
  }
  if (ev.presence !== "READY") {
    const reason = `presence ${ev.presence} at execution`;
    logEvent("execution.denied", { nonce: assertion.nonce, step: "presence", reason });
    logSecurity("execution.denied", { nonce: assertion.nonce, step: "presence", reason });
    return denied("presence", reason);
  }

  if (!claimAssertion(assertion.nonce, claimedBy)) {
    const prior = getExecutionByNonce(assertion.nonce);
    const reason = prior ? `nonce already claimed (execution ${prior.id}, ${prior.status})` : "nonce already claimed";
    logEvent("execution.denied", { nonce: assertion.nonce, step: "claim", reason });
    logSecurity("execution.denied", { nonce: assertion.nonce, step: "claim", reason });
    return denied("claim", reason);
  }

  const executionId = insertExecution(
    assertion.nonce,
    executor.rail,
    JSON.stringify({ action: assertion.action, nonce: assertion.nonce }),
  );
  const outcome = await executor.execute(assertion.action, assertion.nonce);
  finishExecution(executionId, outcome.status, outcome.providerRef, JSON.stringify(outcome.response ?? null));
  logEvent("execution.finished", { nonce: assertion.nonce, status: outcome.status, execution_id: executionId });

  return {
    outcome: "EXECUTED",
    status: outcome.status,
    providerRef: outcome.providerRef,
    executionId,
    response: outcome.response,
    ...(outcome.note !== undefined ? { note: outcome.note } : {}),
  };
}
