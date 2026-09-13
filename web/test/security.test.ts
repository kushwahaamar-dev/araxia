import { afterEach, describe, expect, it } from "vitest";
import {
  bodyTooLarge,
  limitForPath,
  originAllowed,
  rateLimit,
  redactDetail,
  resetRateLimits,
  sanitizeText,
} from "../src/lib/security";

afterEach(() => {
  resetRateLimits();
});

describe("security guards", () => {
  it("allows mutating requests without Origin and rejects a foreign Origin", () => {
    expect(originAllowed(new Request("http://localhost:3000/api/execute", { method: "POST" }))).toBe(true);
    expect(
      originAllowed(
        new Request("http://localhost:3000/api/execute", { method: "POST", headers: { origin: "https://evil.example" } }),
      ),
    ).toBe(false);
    expect(
      originAllowed(
        new Request("http://localhost:3000/api/execute", { method: "POST", headers: { origin: "http://localhost:3000" } }),
      ),
    ).toBe(true);
  });

  it("rejects oversized bodies from Content-Length", () => {
    expect(bodyTooLarge(new Request("http://localhost:3000/api/propose", { headers: { "content-length": "12" } }))).toBe(false);
    expect(bodyTooLarge(new Request("http://localhost:3000/api/propose", { headers: { "content-length": "999999" } }))).toBe(true);
  });

  it("rate-limits a key and keeps status polls generous", () => {
    expect(limitForPath("/api/status", "GET")).toBe(180);
    expect(limitForPath("/api/propose", "POST")).toBe(8);
    for (let i = 0; i < 8; i++) expect(rateLimit("p", 8)).toBe(true);
    expect(rateLimit("p", 8)).toBe(false);
  });

  it("strips control characters and redacts secret-looking keys", () => {
    expect(sanitizeText("hi\u0000there", 8)).toBe("hithere");
    expect(redactDetail({ NESSIE_API_KEY: "abc", note: "ok" })).toEqual({ NESSIE_API_KEY: "REDACTED", note: "ok" });
  });
});
