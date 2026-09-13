import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../src/lib/db";
import { applyWearerHint, getWearerSession, switchWearer, wearerHalted } from "../src/lib/wearers";

beforeEach(() => {
  resetDbForTests(path.join(mkdtempSync(path.join(tmpdir(), "araxia-wear-")), "t.db"));
});

describe("wearer handoff", () => {
  it("halts after a changed hint and clears on switch", () => {
    expect(wearerHalted()).toBe(false);
    applyWearerHint({ guessed_user: "u_laksh", wearer_changed: 1, window_median_bpm: 93 });
    expect(wearerHalted()).toBe(true);
    expect(getWearerSession().guessed_user).toBe("u_laksh");
    const next = switchWearer("u_laksh", false);
    expect(next.active_user).toBe("u_laksh");
    expect(next.halt).toBe(false);
    expect(wearerHalted()).toBe(false);
  });

  it("clears halt when the stream matches the active wearer again", () => {
    applyWearerHint({ guessed_user: "u_laksh", wearer_changed: 1, window_median_bpm: 93 });
    expect(wearerHalted()).toBe(true);
    applyWearerHint({ guessed_user: "u_amar", wearer_changed: 0, window_median_bpm: 115 });
    expect(wearerHalted()).toBe(false);
  });

  it("does not halt when a continuity break reports the same wearer", () => {
    applyWearerHint({ guessed_user: "u_amar", wearer_changed: 1, window_median_bpm: 115 });
    expect(wearerHalted()).toBe(false);
  });
});

