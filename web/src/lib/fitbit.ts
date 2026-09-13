// Google Health API sidecar (successor to the Fitbit Web API).
// Cloud after a phone sync — not Google Earth, not Health Connect, not a live wrist.
// BLE packets remain the only READY gate. These reads are labeled last-sync.
// https://developers.google.com/health

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { recordTigerHealth } from "./tiger";

const API = "https://health.googleapis.com";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.profile.readonly",
].join(" ");
const CACHE_MS = 60_000;
const SOURCE = "google-health-api" as const;

export interface FitbitMetric {
  key: string;
  label: string;
  available: boolean;
  value: string | null;
  note: string;
}

export interface FitbitSnapshot {
  configured: boolean;
  authorized: boolean;
  reachable: boolean;
  sandbox: false;
  source: typeof SOURCE;
  live_gate: "ble-packets";
  display_name: string | null;
  live_ble_bpm: number | null;
  cloud_resting_bpm: number | null;
  cloud_latest_intraday_bpm: number | null;
  metrics: FitbitMetric[];
  error: string | null;
  fetched_at: number;
}

type Tokens = { access_token: string; refresh_token: string; expires_at: number };

type FetchImpl = typeof fetch;

let cache: { at: number; value: FitbitSnapshot } | null = null;
const oauthStates = new Map<string, number>();

function envFirst(...names: string[]): string | null {
  for (const name of names) {
    const v = process.env[name];
    if (v && v.length > 0) return v;
  }
  return null;
}

function tokenPath(): string {
  return (
    envFirst("GOOGLE_HEALTH_TOKEN_FILE", "FITBIT_TOKEN_FILE") ??
    path.join(homedir(), ".araxia", "google-health.json")
  );
}

function clientId(): string | null {
  return envFirst("GOOGLE_HEALTH_CLIENT_ID", "FITBIT_CLIENT_ID");
}

function clientSecret(): string | null {
  return envFirst("GOOGLE_HEALTH_CLIENT_SECRET", "FITBIT_CLIENT_SECRET");
}

function redirectUri(): string {
  return `${(process.env.ARAXIA_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "")}/api/fitbit/callback`;
}

function empty(over: Partial<FitbitSnapshot> = {}): FitbitSnapshot {
  return {
    configured: clientId() !== null && clientSecret() !== null,
    authorized: false,
    reachable: false,
    sandbox: false,
    source: SOURCE,
    live_gate: "ble-packets",
    display_name: null,
    live_ble_bpm: null,
    cloud_resting_bpm: null,
    cloud_latest_intraday_bpm: null,
    metrics: [],
    error: null,
    fetched_at: Date.now(),
    ...over,
  };
}

function asRec(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
}

function num(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoSec(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function filterType(dataType: string): string {
  return dataType.replaceAll("-", "_");
}

function civilDate(d: Date): { date: { year: number; month: number; day: number } } {
  return { date: { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() } };
}

function points(raw: unknown): Record<string, unknown>[] {
  const rows = asRec(raw)?.dataPoints;
  if (!Array.isArray(rows)) return [];
  return rows.map(asRec).filter((row): row is Record<string, unknown> => row !== null);
}

function firstUnion(raw: unknown, field: string): Record<string, unknown> | null {
  for (const p of points(raw)) {
    const value = asRec(p[field]);
    if (value) return value;
  }
  return null;
}

export function parseLatestHeartRate(raw: unknown): number | null {
  let best: { t: number; bpm: number } | null = null;
  for (const p of points(raw)) {
    const hr = asRec(p.heartRate);
    const bpm = num(hr?.beatsPerMinute);
    if (bpm === null) continue;
    const t = Date.parse(str(asRec(hr?.sampleTime)?.physicalTime) ?? "") || 0;
    if (!best || t >= best.t) best = { t, bpm };
  }
  return best?.bpm ?? null;
}

export function parseDailyRestingBpm(raw: unknown): number | null {
  return num(firstUnion(raw, "dailyRestingHeartRate")?.beatsPerMinute);
}

export function parseSkinTemp(raw: unknown): string | null {
  const row = firstUnion(raw, "dailySleepTemperatureDerivations");
  if (!row) return null;
  const nightly = num(row.nightlyTemperatureCelsius);
  const baseline = num(row.baselineTemperatureCelsius);
  if (nightly === null) return null;
  if (baseline === null) return `${nightly.toFixed(2)} °C nightly mean`;
  const rel = nightly - baseline;
  return `${rel > 0 ? "+" : ""}${rel.toFixed(2)} °C vs 30d baseline`;
}

export function parseHrv(raw: unknown): string | null {
  const row = firstUnion(raw, "dailyHeartRateVariability");
  const rmssd = num(row?.averageHeartRateVariabilityMilliseconds);
  return rmssd === null ? null : `${rmssd.toFixed(1)} ms RMSSD (daily)`;
}

export function parseSpo2(raw: unknown): string | null {
  const avg = num(firstUnion(raw, "dailyOxygenSaturation")?.averagePercentage);
  return avg === null ? null : `${avg.toFixed(1)}% avg`;
}

export function parseBreathing(raw: unknown): string | null {
  const rate = num(firstUnion(raw, "dailyRespiratoryRate")?.breathsPerMinute);
  return rate === null ? null : `${rate.toFixed(1)} breaths/min (sleep)`;
}

export function parseSleep(raw: unknown): string | null {
  const mins = num(asRec(firstUnion(raw, "sleep")?.summary)?.minutesAsleep);
  if (mins === null) return null;
  return `${Math.floor(mins / 60)} h ${Math.round(mins % 60)} m asleep`;
}

export function parseStepsRollup(raw: unknown): string | null {
  const rows = asRec(raw)?.rollupDataPoints;
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    const steps = num(asRec(asRec(row)?.steps)?.countSum);
    if (steps !== null) return `${Math.round(steps)} steps`;
  }
  return null;
}

export function parseDisplayName(raw: unknown): string | null {
  return str(asRec(raw)?.legacyUserId) ?? str(asRec(raw)?.healthUserId);
}

function metric(key: string, label: string, value: string | null, emptyNote: string): FitbitMetric {
  return { key, label, available: value !== null, value, note: value ? "last Google Health sync" : emptyNote };
}

function loadTokens(): Tokens | null {
  const envAccess = envFirst("GOOGLE_HEALTH_ACCESS_TOKEN", "FITBIT_ACCESS_TOKEN");
  const envRefresh = envFirst("GOOGLE_HEALTH_REFRESH_TOKEN", "FITBIT_REFRESH_TOKEN");
  if (envAccess && envRefresh) {
    return { access_token: envAccess, refresh_token: envRefresh, expires_at: Date.now() + 50 * 60_000 };
  }
  try {
    const parsed = JSON.parse(readFileSync(tokenPath(), "utf8")) as Tokens;
    if (typeof parsed.access_token === "string" && typeof parsed.refresh_token === "string") return parsed;
  } catch {
    /* no file yet */
  }
  return null;
}

function saveTokens(tokens: Tokens): void {
  const file = tokenPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(tokens), { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

async function exchange(body: URLSearchParams, fetchImpl: FetchImpl, previousRefresh?: string): Promise<Tokens> {
  const res = await fetchImpl(TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Google Health token HTTP ${res.status}`);
  const access = str(json.access_token);
  const refresh = str(json.refresh_token) ?? previousRefresh ?? null;
  const expires = num(json.expires_in) ?? 3600;
  if (!access || !refresh) throw new Error("Google Health token response missing fields");
  const tokens = { access_token: access, refresh_token: refresh, expires_at: Date.now() + (expires - 60) * 1000 };
  saveTokens(tokens);
  return tokens;
}

async function accessToken(fetchImpl: FetchImpl): Promise<string | null> {
  const stored = loadTokens();
  if (!stored) return null;
  if (stored.expires_at > Date.now() + 5_000 && stored.access_token) return stored.access_token;
  if (!clientId() || !clientSecret()) return stored.access_token || null;
  const next = await exchange(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refresh_token,
      client_id: clientId()!,
      client_secret: clientSecret()!,
    }),
    fetchImpl,
    stored.refresh_token,
  );
  return next.access_token;
}

export function fitbitAuthorizeUrl(): string | null {
  if (!clientId() || !clientSecret()) return null;
  const state = crypto.randomUUID();
  oauthStates.set(state, Date.now() + 10 * 60_000);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: clientId()!,
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTH}?${q.toString()}`;
}

export function takeOAuthState(state: string): boolean {
  const exp = oauthStates.get(state);
  oauthStates.delete(state);
  return exp !== undefined && exp > Date.now();
}

export async function finishFitbitOAuth(code: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  await exchange(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: clientId() ?? "",
      client_secret: clientSecret() ?? "",
    }),
    fetchImpl,
  );
  cache = null;
}

async function getJson(token: string, pathName: string, fetchImpl: FetchImpl): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(`${API}${pathName}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function postJson(
  token: string,
  pathName: string,
  payload: unknown,
  fetchImpl: FetchImpl,
): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(`${API}${pathName}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function listPath(dataType: string, filter: string, pageSize: number): string {
  const q = new URLSearchParams({ filter, pageSize: String(pageSize) });
  return `/v4/users/me/dataTypes/${dataType}/dataPoints?${q.toString()}`;
}

function noteFor(status: number, empty: string): string {
  if (status === 200) return empty;
  if (status === 403) return "scope not granted";
  return `HTTP ${status}`;
}

export function invalidateFitbit(): void {
  cache = null;
}

export async function getFitbitSnapshot(
  liveBleBpm: number | null,
  fetchImpl: FetchImpl = fetch,
  now = Date.now(),
): Promise<FitbitSnapshot> {
  if (cache && now - cache.at < CACHE_MS) {
    return { ...cache.value, live_ble_bpm: liveBleBpm };
  }
  if (!clientId() || !clientSecret()) {
    const value = empty({
      error:
        "GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET are not set. Enable the Google Health API in Google Cloud and create an OAuth web client. Legacy Fitbit Web API tokens cannot be transferred.",
      live_ble_bpm: liveBleBpm,
    });
    cache = { at: now, value };
    return value;
  }

  let token: string | null;
  try {
    token = await accessToken(fetchImpl);
  } catch (e) {
    const value = empty({
      configured: true,
      error: e instanceof Error ? e.message : "token refresh failed",
      live_ble_bpm: liveBleBpm,
    });
    cache = { at: now, value };
    return value;
  }
  if (!token) {
    const value = empty({
      configured: true,
      error: "Google Health is not authorized. Use Connect Google Health in the console.",
      live_ble_bpm: liveBleBpm,
    });
    cache = { at: now, value };
    return value;
  }

  const at = new Date(now);
  const lookback = new Date(now - 36 * 3_600_000);
  const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - 1));
  const dayEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
  const daily = (dataType: string) => {
    const field = filterType(dataType);
    return `${field}.date >= "${ymd(dayStart)}" AND ${field}.date < "${ymd(dayEnd)}"`;
  };
  const sampleSince = isoSec(lookback);

  try {
    const [identity, heart, resting, temp, hrv, spo2, br, sleep, steps] = await Promise.all([
      getJson(token, "/v4/users/me/identity", fetchImpl),
      getJson(token, listPath("heart-rate", `${filterType("heart-rate")}.sample_time.physical_time >= "${sampleSince}"`, 60), fetchImpl),
      getJson(token, listPath("daily-resting-heart-rate", daily("daily-resting-heart-rate"), 7), fetchImpl),
      getJson(token, listPath("daily-sleep-temperature-derivations", daily("daily-sleep-temperature-derivations"), 7), fetchImpl),
      getJson(token, listPath("daily-heart-rate-variability", daily("daily-heart-rate-variability"), 7), fetchImpl),
      getJson(token, listPath("daily-oxygen-saturation", daily("daily-oxygen-saturation"), 7), fetchImpl),
      getJson(token, listPath("daily-respiratory-rate", daily("daily-respiratory-rate"), 7), fetchImpl),
      getJson(token, listPath("sleep", `sleep.interval.end_time >= "${sampleSince}"`, 5), fetchImpl),
      postJson(
        token,
        "/v4/users/me/dataTypes/steps/dataPoints:dailyRollUp",
        {
          range: { start: civilDate(dayStart), end: civilDate(dayEnd) },
          windowSizeDays: 1,
        },
        fetchImpl,
      ),
    ]);

    const latest = heart.status < 400 ? parseLatestHeartRate(heart.body) : null;
    const rest = resting.status < 400 ? parseDailyRestingBpm(resting.body) : null;
    const value: FitbitSnapshot = {
      configured: true,
      authorized: true,
      reachable: identity.status < 500,
      sandbox: false,
      source: SOURCE,
      live_gate: "ble-packets",
      display_name: identity.status === 200 ? parseDisplayName(identity.body) : null,
      live_ble_bpm: liveBleBpm,
      cloud_resting_bpm: rest,
      cloud_latest_intraday_bpm: latest,
      metrics: [
        metric("resting_hr", "Resting HR", rest === null ? null : `${rest} bpm`, noteFor(resting.status, "not on today's sync")),
        metric("intraday_hr", "Cloud HR", latest === null ? null : `${latest} bpm`, noteFor(heart.status, "no heart-rate samples in the last 36h")),
        metric("skin_temp", "Skin temperature", temp.status < 400 ? parseSkinTemp(temp.body) : null, "overnight derivation, not live"),
        metric("hrv", "HRV", hrv.status < 400 ? parseHrv(hrv.body) : null, "sleep-only daily RMSSD"),
        metric("spo2", "SpO2", spo2.status < 400 ? parseSpo2(spo2.body) : null, "usually overnight"),
        metric("breathing", "Breathing rate", br.status < 400 ? parseBreathing(br.body) : null, "sleep-only"),
        metric("sleep", "Sleep", sleep.status < 400 ? parseSleep(sleep.body) : null, "no sleep session in the last 36h"),
        metric("steps", "Steps", steps.status < 400 ? parseStepsRollup(steps.body) : null, "no steps rollup today"),
      ],
      error: identity.status === 401 ? "Google Health token rejected; connect again" : null,
      fetched_at: now,
    };
    cache = { at: now, value };
    if (value.authorized && value.reachable) {
      recordTigerHealth({
        fetched_at: now,
        display_name: value.display_name,
        live_ble_bpm: liveBleBpm,
        cloud_resting_bpm: rest,
        cloud_latest_bpm: latest,
        metrics: value.metrics,
      });
    }
    return value;
  } catch (e) {
    const value = empty({
      configured: true,
      authorized: true,
      error: e instanceof Error ? e.message : "Google Health network error",
      live_ble_bpm: liveBleBpm,
    });
    cache = { at: now, value };
    return value;
  }
}
