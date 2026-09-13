import { NextResponse } from "next/server";
import { finishFitbitOAuth, takeOAuthState } from "@/lib/fitbit";
import { logSecurity } from "@/lib/db";

function cookieState(req: Request): string | null {
  const raw = req.headers.get("cookie") ?? "";
  const m = raw.match(/(?:^|; )fitbit_oauth=([^;]+)/);
  return m?.[1] ?? null;
}

function home(origin: string, flag: string): NextResponse {
  const res = NextResponse.redirect(`${origin}/?fitbit=${flag}`);
  res.cookies.set("fitbit_oauth", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const origin = process.env.ARAXIA_ORIGIN ?? "http://localhost:3000";
  const cookie = cookieState(req);

  if (err) {
    logSecurity("fitbit.oauth.denied", { error: err });
    return home(origin, "denied");
  }
  const ok = Boolean(code && state && (takeOAuthState(state) || (cookie && cookie === state)));
  if (!ok || !code) {
    logSecurity("fitbit.oauth.invalid", { has_code: Boolean(code) });
    return home(origin, "invalid");
  }
  try {
    await finishFitbitOAuth(code);
    logSecurity("fitbit.oauth.ok", {});
    return home(origin, "connected");
  } catch {
    logSecurity("fitbit.oauth.failed", {});
    return home(origin, "failed");
  }
}
