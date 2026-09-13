export function dollars(minor: number, ccy = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${ccy}`;
  }
}

export function prefix(s: string | null | undefined, n = 12): string {
  if (!s) return "—";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function secondsUntil(epochS: number, nowMs: number): number {
  return Math.max(0, Math.ceil(epochS - nowMs / 1000));
}

export function clock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return new Date(ms).toLocaleTimeString("en-US", { hour12: false });
}

export function pretty(v: unknown): string {
  if (v === undefined) return "(empty body)";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/** Deep copy for plain JSON data; keeps the original untouched for replay. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
