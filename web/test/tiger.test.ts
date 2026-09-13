import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { flushTiger, getTigerSnapshot, recordTigerEvent, tigerConfigured } from "../src/lib/tiger";

function loadLocalUrl(): void {
  if (process.env.TIGERDATA_URL) return;
  const file = new URL("../.env.local", import.meta.url);
  const path = file.pathname;
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.startsWith("TIGERDATA_URL=") && line.length > 14) {
      process.env.TIGERDATA_URL = line.slice("TIGERDATA_URL=".length).trim().replace(/^["']|["']$/g, "");
    }
  }
}

describe("TigerData replica", () => {
  it("is inert without a URL", async () => {
    const saved = process.env.TIGERDATA_URL;
    delete process.env.TIGERDATA_URL;
    expect(tigerConfigured()).toBe(false);
    const snap = await getTigerSnapshot(Date.now());
    expect(snap.configured).toBe(false);
    expect(snap.reachable).toBe(false);
    if (saved) process.env.TIGERDATA_URL = saved;
    else delete process.env.TIGERDATA_URL;
  });

  it("writes an event hypertable row when TIGERDATA_URL is set", async () => {
    loadLocalUrl();
    if (!process.env.TIGERDATA_URL) return;
    process.env.TIGER_LIVE = "1";
    recordTigerEvent("test.probe", { ok: true, at: Date.now() });
    await flushTiger();
    const snap = await getTigerSnapshot(Date.now() + 10_000);
    expect(snap.configured).toBe(true);
    expect(snap.reachable).toBe(true);
    expect(snap.events).toBeGreaterThan(0);
    expect(snap.error).toBeNull();
  });
});
