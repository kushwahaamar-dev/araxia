// Edge-safe request guards. No sqlite, no node:fs.

export const MAX_BODY_BYTES = 64_000;
export const ALLOWED_ORIGINS = (process.env.ARAXIA_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const windows = new Map<string, { resetAt: number; n: number }>();

export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-DNS-Prefetch-Control": "off",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://api.nessieisreal.com https://api.devnet.solana.com https://generativelanguage.googleapis.com https://health.googleapis.com https://oauth2.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

export function applySecurityHeaders(headers: Headers): void {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
}

export function corsOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

export function originAllowed(req: Request): boolean {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

export function bodyTooLarge(req: Request): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > MAX_BODY_BYTES;
}

export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export function rateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const cur = windows.get(key);
  if (!cur || now >= cur.resetAt) {
    windows.set(key, { resetAt: now + windowMs, n: 1 });
    return true;
  }
  if (cur.n >= limit) return false;
  cur.n += 1;
  return true;
}

export function resetRateLimits(): void {
  windows.clear();
}

export function limitForPath(pathname: string, method = "GET"): number {
  if (method === "GET" && (pathname.startsWith("/api/status") || pathname.startsWith("/api/passkeys"))) return 180;
  if (pathname.startsWith("/api/propose")) return 8;
  if (pathname.startsWith("/api/execute")) return 12;
  if (pathname.startsWith("/api/evidence")) return 240;
  if (pathname.startsWith("/api/kyc") && method === "PUT") return 180;
  if (pathname.startsWith("/api/kyc") || pathname.startsWith("/api/passkeys") || pathname.startsWith("/api/approve")) return 10;
  if (pathname.startsWith("/api/")) return 60;
  return 240;
}

export function sanitizeText(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max);
}

const SECRET = /(key|token|secret|password|authorization|cookie|seed|keypair)/i;

export function redactDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SECRET.test(k)) out[k] = "REDACTED";
    else if (typeof v === "string" && v.length > 400) out[k] = `${v.slice(0, 400)}…`;
    else out[k] = v;
  }
  return out;
}
