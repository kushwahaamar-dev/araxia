import { NextResponse, type NextRequest } from "next/server";
import {
  applySecurityHeaders,
  bodyTooLarge,
  clientKey,
  corsOrigin,
  limitForPath,
  originAllowed,
  rateLimit,
} from "./lib/security";

function withHeaders(res: NextResponse, req: NextRequest): NextResponse {
  applySecurityHeaders(res.headers);
  const allow = corsOrigin(req);
  if (allow) {
    res.headers.set("Access-Control-Allow-Origin", allow);
    res.headers.set("Vary", "Origin");
    res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
    res.headers.set("Access-Control-Allow-Headers", "content-type");
  }
  return res;
}

export function middleware(req: NextRequest): NextResponse {
  if (req.method === "OPTIONS") {
    return withHeaders(new NextResponse(null, { status: 204 }), req);
  }

  if (bodyTooLarge(req)) {
    const res = NextResponse.json({ error: "request too large" }, { status: 413 });
    return withHeaders(res, req);
  }

  if (!originAllowed(req)) {
    const res = NextResponse.json({ error: "origin not allowed" }, { status: 403 });
    return withHeaders(res, req);
  }

  const path = req.nextUrl.pathname;
  if (path.startsWith("/api/")) {
    const key = `${clientKey(req)}:${req.method}:${path}`;
    if (!rateLimit(key, limitForPath(path, req.method))) {
      const res = NextResponse.json({ error: "rate limited" }, { status: 429 });
      return withHeaders(res, req);
    }
  }

  return withHeaders(NextResponse.next(), req);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.png|favicon-32.png|favicon.ico|icon.png|logo.png|logo-white.png).*)"],
};
