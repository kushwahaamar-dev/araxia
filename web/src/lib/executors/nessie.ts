// Capital One Nessie sandbox. Nessie has no idempotency key, so anything short
// of a definitive answer is UNCERTAIN and must never be retried automatically.

import type { CanonicalAction } from "@araxia/verify";
import type { ExecOutcome, Executor } from "./types";

const DEFAULT_BASE_URL = "http://api.nessieisreal.com";
const TIMEOUT_MS = 10_000;
const NO_RETRY = "Nessie has no idempotency key; the transfer may or may not have posted, so no retry is allowed";

type FetchImpl = typeof fetch;

function redact(url: string): string {
  return url.replace(/([?&])key=[^&]*/, "$1key=REDACTED");
}

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function createdId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const created = (body as { objectCreated?: unknown }).objectCreated;
  if (typeof created !== "object" || created === null) return null;
  const id = (created as { _id?: unknown })._id;
  return typeof id === "string" ? id : null;
}

export function nessieExecutor(fetchImpl: FetchImpl = fetch): Executor {
  return {
    rail: "nessie",
    aud: "nessie-sandbox",
    async execute(action: CanonicalAction, assertionNonce: string): Promise<ExecOutcome> {
      const key = process.env.NESSIE_API_KEY;
      if (!key) {
        return { status: "FAILED", providerRef: null, response: null, note: "NESSIE_API_KEY not configured" };
      }
      const base = (process.env.NESSIE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
      const url = `${base}/accounts/${encodeURIComponent(action.src)}/transfers?key=${encodeURIComponent(key)}`;
      const body = {
        medium: "balance",
        payee_id: action.dst,
        amount: action.amount_minor / 100,
        transaction_date: utcDate(new Date()),
        status: "pending",
        description: `araxia ${assertionNonce}`,
      };

      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const kind = err.name === "TimeoutError" || err.name === "AbortError" ? "timed out" : "network error";
        return {
          status: "UNCERTAIN",
          providerRef: null,
          response: { error: kind, message: err.message ?? String(e), url: redact(url) },
          note: `provider call ${kind}; ${NO_RETRY}`,
        };
      }

      const payload = await readBody(res);
      const response = { http_status: res.status, url: redact(url), body: payload };

      if (res.status >= 200 && res.status < 300) {
        return { status: "CONFIRMED", providerRef: createdId(payload), response };
      }
      if (res.status >= 400 && res.status < 500) {
        return { status: "FAILED", providerRef: null, response, note: `provider rejected the transfer with HTTP ${res.status}` };
      }
      return {
        status: "UNCERTAIN",
        providerRef: null,
        response,
        note: `provider returned HTTP ${res.status}; ${NO_RETRY}`,
      };
    },
  };
}
