// Capital One Nessie sandbox. The live TransferCreate schema is
// { transaction_date, status, amount, description } — no payee field.
// Destination is bound in the description. Nessie records transfers but
// leaves seeded account.balance frozen (deposits/withdrawals/PUT balance
// likewise do not move it). Displayed balances are adjusted in
// nessieSettlements.ts from Araxia's confirmed executions.

export const NESSIE_DEFAULT_BASE = "https://api.nessieisreal.com";
const LEDGER_TTL_MS = 8_000;
const TIMEOUT_MS = 8_000;
const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NessieRole = "source" | "payee";

export interface NessieAccountView {
  id: string;
  label: string;
  role: NessieRole;
  type: string | null;
  nickname: string | null;
  balance_minor: number | null;
}

export interface NessieTransferView {
  id: string;
  status: string;
  amount_minor: number | null;
  description: string | null;
  transaction_date: string | null;
}

export interface NessieLedger {
  configured: boolean;
  reachable: boolean;
  sandbox: true;
  base_url: string;
  source: NessieAccountView | null;
  payees: NessieAccountView[];
  transfers: NessieTransferView[];
  error: string | null;
  fetched_at: number;
  /** True when displayed balances include Araxia's confirmed settlements (Nessie leaves seeded balances frozen). */
  balances_settled?: boolean;
}

type FetchImpl = typeof fetch;

let cache: { at: number; value: NessieLedger } | null = null;

export function nessieBaseUrl(): string {
  return (process.env.NESSIE_BASE_URL ?? NESSIE_DEFAULT_BASE).replace(/\/+$/, "");
}

export function nessieKey(): string | null {
  const key = process.env.NESSIE_API_KEY;
  return key && key.length > 0 ? key : null;
}

export function redactNessieUrl(url: string): string {
  return url.replace(/([?&])key=[^&]*/, "$1key=REDACTED");
}

export function nessieUtcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function sourceAccountId(): string {
  return process.env.ARAXIA_SOURCE_ACCOUNT ?? "";
}

function nessiePayees(): Array<[string, string]> {
  const raw = process.env.ARAXIA_PAYEES_JSON;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return [];
    return Object.entries(parsed as Record<string, unknown>).filter(
      (entry): entry is [string, string] => entry[0] !== "DEVNET" && typeof entry[1] === "string" && ACCOUNT_ID.test(entry[1]),
    );
  } catch {
    return [];
  }
}

export function invalidateNessieLedger(): void {
  cache = null;
}

export function transferDescription(nonce: string, dst: string): string {
  return `araxia ${nonce} dst=${dst}`;
}

function emptyLedger(over: Partial<NessieLedger> = {}): NessieLedger {
  return {
    configured: nessieKey() !== null,
    reachable: false,
    sandbox: true,
    base_url: nessieBaseUrl(),
    source: null,
    payees: [],
    transfers: [],
    error: null,
    fetched_at: Date.now(),
    ...over,
  };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function dollarsToMinor(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw * 100);
  return null;
}

export function parseNessieAccount(raw: unknown, label: string, role: NessieRole): NessieAccountView | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = str(o._id) ?? str(o.id);
  if (!id) return null;
  return {
    id,
    label,
    role,
    type: str(o.type),
    nickname: str(o.nickname),
    balance_minor: dollarsToMinor(o.balance),
  };
}

export function parseNessieTransfer(raw: unknown): NessieTransferView | null {
  const o = asRecord(raw);
  if (!o) return null;
  const id = str(o.id) ?? str(o._id);
  if (!id) return null;
  return {
    id,
    status: str(o.status) ?? "unknown",
    amount_minor: dollarsToMinor(o.amount),
    description: str(o.description),
    transaction_date: str(o.transaction_date),
  };
}

export function createdObjectId(body: unknown): string | null {
  const o = asRecord(body);
  if (!o) return null;
  const created = asRecord(o.objectCreated);
  if (!created) return null;
  return str(created._id) ?? str(created.id);
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

export async function nessieFetch(
  path: string,
  init: RequestInit,
  fetchImpl: FetchImpl = fetch,
  timeoutMs = TIMEOUT_MS,
): Promise<{ res: Response; body: unknown; url: string }> {
  const key = nessieKey();
  if (!key) throw new Error("NESSIE_API_KEY not configured");
  const url = `${nessieBaseUrl()}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, {
    ...init,
    headers: { accept: "application/json", "content-type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
  return { res, body: await readBody(res), url: redactNessieUrl(url) };
}

async function loadLedger(fetchImpl: FetchImpl): Promise<NessieLedger> {
  const source = sourceAccountId();
  if (!nessieKey()) return emptyLedger({ error: "NESSIE_API_KEY not configured" });
  if (!ACCOUNT_ID.test(source)) {
    return emptyLedger({ error: "ARAXIA_SOURCE_ACCOUNT is not a Nessie account id" });
  }

  const rows: Array<{ label: string; id: string; role: NessieRole }> = [
    { label: "CHECKING", id: source, role: "source" },
    ...nessiePayees().map(([label, id]) => ({ label, id, role: "payee" as const })),
  ];

  try {
    const [accountResults, transferResult] = await Promise.all([
      Promise.all(
        rows.map(async (row) => {
          const { res, body } = await nessieFetch(`/accounts/${encodeURIComponent(row.id)}`, { method: "GET" }, fetchImpl);
          if (!res.ok) return { row, account: null, error: `HTTP ${res.status}` };
          return { row, account: parseNessieAccount(body, row.label, row.role), error: null };
        }),
      ),
      nessieFetch(`/accounts/${encodeURIComponent(source)}/transfers`, { method: "GET" }, fetchImpl),
    ]);

    const missing = accountResults.find((r) => r.account === null);
    if (missing) {
      return emptyLedger({ error: `could not read ${missing.row.label}: ${missing.error ?? "parse failed"}` });
    }

    let transfers: NessieTransferView[] = [];
    if (transferResult.res.status === 404) {
      transfers = [];
    } else if (transferResult.res.ok && Array.isArray(transferResult.body)) {
      transfers = transferResult.body.map(parseNessieTransfer).filter((t): t is NessieTransferView => t !== null);
    } else if (!transferResult.res.ok) {
      return emptyLedger({ error: `transfers HTTP ${transferResult.res.status}` });
    }

    const sourceAccount = accountResults.find((r) => r.row.role === "source")?.account ?? null;
    const payees = accountResults.filter((r) => r.row.role === "payee").map((r) => r.account!);

    return {
      configured: true,
      reachable: true,
      sandbox: true,
      base_url: nessieBaseUrl(),
      source: sourceAccount,
      payees,
      transfers: transfers.slice().sort((a, b) => (b.transaction_date ?? "").localeCompare(a.transaction_date ?? "") || b.id.localeCompare(a.id)),
      error: null,
      fetched_at: Date.now(),
    };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    const kind = err.name === "TimeoutError" || err.name === "AbortError" ? "timed out" : "network error";
    return emptyLedger({ error: `${kind}: ${err.message ?? String(e)}` });
  }
}

export async function getNessieLedger(fetchImpl: FetchImpl = fetch, now = Date.now()): Promise<NessieLedger> {
  if (cache && now - cache.at < LEDGER_TTL_MS) return cache.value;
  const value = await loadLedger(fetchImpl);
  cache = { at: now, value };
  return value;
}
