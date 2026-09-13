export const DEMO_USER = "u_amar";

export interface ApiResult<T> {
  status: number;
  body: T | null;
  /** Set when the request never reached the service or the body was not JSON. */
  transport?: string;
}

export function isApiError(body: unknown): body is { error: string } {
  return typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string";
}

export async function api<T = unknown>(
  path: string,
  init?: { method?: "GET" | "POST" | "PUT"; body?: unknown; signal?: AbortSignal },
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init?.signal,
      cache: "no-store",
    });
  } catch (err) {
    return { status: 0, body: null, transport: err instanceof Error ? err.message : "service unreachable" };
  }
  const text = await res.text();
  if (text.length === 0) return { status: res.status, body: null };
  try {
    return { status: res.status, body: JSON.parse(text) as T };
  } catch {
    return { status: res.status, body: null, transport: "non-JSON response" };
  }
}

export function errorText<T>(r: ApiResult<T>, fallback: string): string {
  if (r.status === 0) return "service unreachable";
  if (isApiError(r.body)) return r.body.error;
  if (r.transport) return r.transport;
  return `${fallback} (HTTP ${r.status})`;
}
