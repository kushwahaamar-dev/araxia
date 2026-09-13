import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "../src/lib/db";
import {
  addTeamMember,
  applyWearerHint,
  getWearerSession,
  isTeamMember,
  labelFor,
  switchWearer,
  team,
  wearerHalted,
} from "../src/lib/wearers";

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "araxia-wear-"));
  resetDbForTests(path.join(dir, "t.db"));
  process.env.ARAXIA_ROSTER = path.join(dir, "wearers.json");
  writeFileSync(
    process.env.ARAXIA_ROSTER,
    JSON.stringify({
      active_user: "u_amar",
      people: {
        u_amar: { label: "Amar", centroid: 110, sd: 10 },
        u_laksh: { label: "Laksh", centroid: 93.4, sd: 3.4 },
      },
    }),
  );
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

  it("halts on an unknown range after a break: new user detected", () => {
    applyWearerHint({ guessed_user: "", wearer_changed: 1, window_median_bpm: 65 });
    expect(wearerHalted()).toBe(true);
    expect(getWearerSession().guessed_user).toBe("");
  });

  it("does not halt on an unknown range without a break", () => {
    applyWearerHint({ guessed_user: "", wearer_changed: 0, window_median_bpm: 65 });
    expect(wearerHalted()).toBe(false);
  });
});

describe("team roster", () => {
  it("reads members from the roster file", () => {
    expect(team().map((p) => p.user_id)).toEqual(["u_amar", "u_laksh"]);
    expect(labelFor("u_laksh")).toBe("Laksh");
    expect(isTeamMember("u_nobody")).toBe(false);
  });

  it("adds a new member with no range and stamps one on first switch", () => {
    const m = addTeamMember("Priya Sharma");
    expect(m.user_id).toBe("u_priyasharma");
    expect(isTeamMember(m.user_id)).toBe(true);
    applyWearerHint({ guessed_user: "", wearer_changed: 1, window_median_bpm: 72 });
    const s = switchWearer(m.user_id, true);
    expect(s.active_user).toBe(m.user_id);
    expect(s.halt).toBe(false);
    const roster = JSON.parse(readFileSync(process.env.ARAXIA_ROSTER!, "utf8")) as { people: Record<string, { centroid: number }> };
    expect(roster.people.u_priyasharma?.centroid).toBe(72);
  });

  it("refuses to add a member from an empty or duplicate name", () => {
    expect(() => addTeamMember("   ")).toThrow();
    const a = addTeamMember("Sam");
    const b = addTeamMember("sam");
    expect(a.user_id).toBe("u_sam");
    expect(b.user_id).toBe("u_sam2");
  });
});
