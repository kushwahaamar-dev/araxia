// Persona sandbox: enrollment is a hosted inquiry. A passkey cannot be
// registered until that inquiry is approved. This is the "access depends on a
// verified human" gate. Sandbox only; no real ID is ever required.

import { getDb, logEvent, nowMs } from "./db";
import { HttpError } from "./http";

const API = "https://api.withpersona.com/api/v1";
const VERSION = "2023-01-05";
const HOSTED = "https://inquiry.withpersona.com/verify";

export const PERSONA_PASS = new Set(["approved", "completed"]);

export interface KycRow {
  user_id: string;
  inquiry_id: string | null;
  status: string;
  hosted_url: string | null;
  updated_at: number;
}

function headers(): HeadersInit {
  const key = process.env.PERSONA_API_KEY;
  if (!key) throw new HttpError(503, "PERSONA_API_KEY not configured");
  return {
    authorization: `Bearer ${key}`,
    "Persona-Version": VERSION,
    accept: "application/json",
    "content-type": "application/json",
  };
}

export function personaConfigured(): boolean {
  return Boolean(process.env.PERSONA_API_KEY && process.env.PERSONA_TEMPLATE_ID);
}

export function getKyc(userId: string): KycRow | null {
  return (getDb().prepare("SELECT * FROM kyc WHERE user_id = ?").get(userId) as KycRow | undefined) ?? null;
}

export function isPersonaApproved(userId: string): boolean {
  if (!personaConfigured()) return true;
  const row = getKyc(userId);
  return row !== null && PERSONA_PASS.has(row.status);
}

export function requirePersonaApproved(userId: string): void {
  if (!personaConfigured()) return;
  if (!isPersonaApproved(userId)) {
    throw new HttpError(403, "complete Persona verification before registering a passkey");
  }
}

function hostedUrl(inquiryId: string): string {
  const env = process.env.PERSONA_ENVIRONMENT_ID;
  const q = new URLSearchParams({ "inquiry-id": inquiryId });
  if (env) q.set("environment-id", env);
  return `${HOSTED}?${q.toString()}`;
}

function upsert(userId: string, inquiryId: string, status: string, url: string): KycRow {
  const row: KycRow = {
    user_id: userId,
    inquiry_id: inquiryId,
    status,
    hosted_url: url,
    updated_at: nowMs(),
  };
  getDb()
    .prepare(
      `INSERT INTO kyc (user_id, inquiry_id, status, hosted_url, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET inquiry_id=excluded.inquiry_id, status=excluded.status,
         hosted_url=excluded.hosted_url, updated_at=excluded.updated_at`,
    )
    .run(row.user_id, row.inquiry_id, row.status, row.hosted_url, row.updated_at);
  return row;
}

export async function startInquiry(userId: string, fetchImpl: typeof fetch = fetch): Promise<KycRow> {
  const template = process.env.PERSONA_TEMPLATE_ID;
  if (!template) throw new HttpError(503, "PERSONA_TEMPLATE_ID not configured");
  const existing = getKyc(userId);
  if (existing?.inquiry_id && existing.status !== "expired" && existing.status !== "declined" && existing.status !== "failed") {
    return refreshInquiry(userId, fetchImpl);
  }
  const res = await fetchImpl(`${API}/inquiries`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      data: { attributes: { "inquiry-template-id": template, "reference-id": userId } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { data?: { id?: string; attributes?: { status?: string } }; errors?: unknown };
  if (!res.ok || !body.data?.id) {
    throw new HttpError(502, `Persona create failed (${res.status})`);
  }
  const row = upsert(userId, body.data.id, body.data.attributes?.status ?? "created", hostedUrl(body.data.id));
  logEvent("kyc.started", { user_id: userId, inquiry_id: row.inquiry_id, status: row.status });
  return row;
}

export async function refreshInquiry(userId: string, fetchImpl: typeof fetch = fetch): Promise<KycRow> {
  const existing = getKyc(userId);
  if (!existing?.inquiry_id) throw new HttpError(404, "no Persona inquiry for this user");
  const res = await fetchImpl(`${API}/inquiries/${existing.inquiry_id}`, {
    headers: headers(),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { data?: { attributes?: { status?: string } } };
  if (!res.ok) throw new HttpError(502, `Persona poll failed (${res.status})`);
  const status = body.data?.attributes?.status ?? existing.status;
  const row = upsert(userId, existing.inquiry_id, status, existing.hosted_url ?? hostedUrl(existing.inquiry_id));
  logEvent("kyc.refreshed", { user_id: userId, inquiry_id: row.inquiry_id, status });
  return row;
}
