import { NextResponse } from "next/server";
import { fitbitAuthorizeUrl } from "@/lib/fitbit";

export async function GET(): Promise<Response> {
  const url = fitbitAuthorizeUrl();
  if (!url) {
    return NextResponse.json(
      {
        error:
          "GOOGLE_HEALTH_CLIENT_ID and GOOGLE_HEALTH_CLIENT_SECRET are not set. Enable the Google Health API in Google Cloud Console and create an OAuth web client. Legacy Fitbit tokens cannot be transferred.",
      },
      { status: 503 },
    );
  }
  const state = new URL(url).searchParams.get("state") ?? "";
  const res = NextResponse.redirect(url);
  res.cookies.set("fitbit_oauth", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
