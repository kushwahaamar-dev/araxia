// Capital One Nessie sandbox. Nessie has no idempotency key, so anything short
// of a definitive answer is UNCERTAIN and must never be retried automatically.
// Live TransferCreate accepts only transaction_date, status, amount, description.

import type { CanonicalAction } from "@araxia/verify";
import { createdObjectId, invalidateNessieLedger, nessieFetch, nessieKey, nessieUtcDate, transferDescription } from "../nessie";
import type { ExecOutcome, Executor } from "./types";

const TIMEOUT_MS = 10_000;
const NO_RETRY = "Nessie has no idempotency key; the transfer may or may not have posted, so no retry is allowed";

type FetchImpl = typeof fetch;

export function nessieExecutor(fetchImpl: FetchImpl = fetch): Executor {
  return {
    rail: "nessie",
    aud: "nessie-sandbox",
    async execute(action: CanonicalAction, assertionNonce: string): Promise<ExecOutcome> {
      if (!nessieKey()) {
        return { status: "FAILED", providerRef: null, response: null, note: "NESSIE_API_KEY not configured" };
      }

      const payload = {
        transaction_date: nessieUtcDate(),
        status: "completed",
        amount: action.amount_minor / 100,
        description: transferDescription(assertionNonce, action.dst),
      };

      let posted: { res: Response; body: unknown; url: string };
      try {
        posted = await nessieFetch(
          `/accounts/${encodeURIComponent(action.src)}/transfers`,
          { method: "POST", body: JSON.stringify(payload) },
          fetchImpl,
          TIMEOUT_MS,
        );
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const kind = err.name === "TimeoutError" || err.name === "AbortError" ? "timed out" : "network error";
        return {
          status: "UNCERTAIN",
          providerRef: null,
          response: { error: kind, message: err.message ?? String(e) },
          note: `provider call ${kind}; ${NO_RETRY}`,
        };
      }

      const response = { http_status: posted.res.status, url: posted.url, body: posted.body };
      if (posted.res.status >= 200 && posted.res.status < 300) {
        invalidateNessieLedger();
        return { status: "CONFIRMED", providerRef: createdObjectId(posted.body), response };
      }
      if (posted.res.status >= 400 && posted.res.status < 500) {
        return { status: "FAILED", providerRef: null, response, note: `provider rejected the transfer with HTTP ${posted.res.status}` };
      }
      return {
        status: "UNCERTAIN",
        providerRef: null,
        response,
        note: `provider returned HTTP ${posted.res.status}; ${NO_RETRY}`,
      };
    },
  };
}
