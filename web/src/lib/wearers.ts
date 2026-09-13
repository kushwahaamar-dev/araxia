// Team handoff. The bridge classifies a window median against enrolled
// centroids. Two mismatched windows halt money until the console switches user.
// This is range matching, not identification.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ensureUser, getDb, logEvent, nowMs } from "./db";

export const TEAM: ReadonlyArray<{ user_id: string; label: string }> = [
  { user_id: "u_amar", label: "Amar" },
  { user_id: "u_laksh", label: "Laksh" },
  { user_id: "u_jagriti", label: "Jagriti" },
];

const ROSTER = path.join(homedir(), ".araxia", "wearers.json");

export interface WearerSession {
  active_user: string;
  guessed_user: string;
  halt: boolean;
  last_median: number;
  updated_at: number;
}

function seedRoster(): Record<string, unknown> {
  return {
    active_user: "u_amar",
    people: {
      u_amar: { label: "Amar", centroid: 110, sd: 10 },
      u_laksh: { label: "Laksh", centroid: 93.4, sd: 3.4 },
      u_jagriti: { label: "Jagriti", centroid: null, sd: null },
    },
  };
}

export function writeRosterActive(userId: string): void {
  mkdirSync(path.dirname(ROSTER), { recursive: true });
  const raw = existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, "utf8")) : seedRoster();
  raw.active_user = userId;
  writeFileSync(ROSTER, JSON.stringify(raw, null, 2) + "\n");
}

export function enrollCentroid(userId: string, centroid: number, sd = 3.5): void {
  mkdirSync(path.dirname(ROSTER), { recursive: true });
  const raw = existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, "utf8")) : seedRoster();
  raw.people = raw.people ?? {};
  const label = TEAM.find((p) => p.user_id === userId)?.label ?? userId;
  raw.people[userId] = { label, centroid, sd };
  writeFileSync(ROSTER, JSON.stringify(raw, null, 2) + "\n");
}

export function ensureTeam(): void {
  for (const p of TEAM) ensureUser(p.user_id, p.label);
  const db = getDb();
  const row = db.prepare("SELECT active_user FROM wearer_session WHERE id = 1").get() as { active_user: string } | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO wearer_session (id, active_user, guessed_user, halt, last_median, streak, updated_at) VALUES (1, 'u_amar', '', 0, 0, 0, ?)",
    ).run(nowMs());
    writeRosterActive("u_amar");
  }
}

export function getWearerSession(): WearerSession {
  ensureTeam();
  const row = getDb().prepare("SELECT * FROM wearer_session WHERE id = 1").get() as {
    active_user: string;
    guessed_user: string;
    halt: number;
    last_median: number;
    updated_at: number;
  };
  return {
    active_user: row.active_user,
    guessed_user: row.guessed_user,
    halt: row.halt === 1,
    last_median: row.last_median,
    updated_at: row.updated_at,
  };
}

export function wearerHalted(): boolean {
  return getWearerSession().halt;
}

export function applyWearerHint(hint: { guessed_user?: string; wearer_changed?: number; window_median_bpm?: number }): void {
  ensureTeam();
  const guessed = typeof hint.guessed_user === "string" ? hint.guessed_user : "";
  const median = Number.isInteger(hint.window_median_bpm) ? Number(hint.window_median_bpm) : 0;
  const changed = hint.wearer_changed === 1;
  const sess = getWearerSession();
  let halt = sess.halt ? 1 : 0;
  if (changed) halt = 1;
  getDb()
    .prepare(
      "UPDATE wearer_session SET guessed_user = ?, halt = ?, last_median = ?, updated_at = ? WHERE id = 1",
    )
    .run(guessed, halt, median, nowMs());
  if (halt === 1 && !sess.halt) logEvent("wearer.changed", { from: sess.active_user, guessed, median });
  if (halt === 0 && sess.halt) logEvent("wearer.cleared", { active: sess.active_user, guessed, median });
}

export function switchWearer(userId: string, enrollFromMedian: boolean): WearerSession {
  ensureTeam();
  if (!TEAM.some((p) => p.user_id === userId)) throw new Error("unknown team member");
  const sess = getWearerSession();
  const raw = existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, "utf8")) : seedRoster();
  const hasRange = raw.people?.[userId]?.centroid != null;
  if (enrollFromMedian && !hasRange && sess.last_median >= 30) enrollCentroid(userId, sess.last_median);
  writeRosterActive(userId);
  getDb()
    .prepare("UPDATE wearer_session SET active_user = ?, guessed_user = ?, halt = 0, streak = 0, updated_at = ? WHERE id = 1")
    .run(userId, userId, nowMs());
  // evidence import is done by the route to avoid a cycle
  logEvent("wearer.switched", { user_id: userId, enrolled_median: enrollFromMedian ? sess.last_median : null });
  return getWearerSession();
}

export function labelFor(userId: string): string {
  return TEAM.find((p) => p.user_id === userId)?.label ?? userId;
}
