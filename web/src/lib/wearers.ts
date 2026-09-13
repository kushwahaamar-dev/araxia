// Team handoff. The bridge classifies a window median against enrolled
// centroids. A continuity break (STALE/DISCONNECTED) followed by a different
// or unknown guess halts money until the console names the wearer.
// This is range matching, not identification. The roster file is the one
// source of truth for who is on the team; the bridge reads the same file.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ensureUser, getDb, logEvent, nowMs } from "./db";

export interface TeamMember {
  user_id: string;
  label: string;
}

interface Person {
  label: string;
  centroid: number | null;
  sd: number | null;
}

interface Roster {
  active_user: string;
  people: Record<string, Person>;
}

export interface WearerSession {
  active_user: string;
  guessed_user: string;
  halt: boolean;
  last_median: number;
  updated_at: number;
}

const FIRST_USER = "u_amar";

function rosterPath(): string {
  return process.env.ARAXIA_ROSTER ?? path.join(homedir(), ".araxia", "wearers.json");
}

function seedRoster(): Roster {
  return {
    active_user: FIRST_USER,
    people: {
      u_amar: { label: "Amar", centroid: 110, sd: 10 },
    },
  };
}

function readRoster(): Roster {
  const file = rosterPath();
  if (!existsSync(file)) return seedRoster();
  const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Roster>;
  return {
    active_user: typeof raw.active_user === "string" ? raw.active_user : FIRST_USER,
    people: raw.people ?? {},
  };
}

function writeRoster(roster: Roster): void {
  const file = rosterPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(roster, null, 2) + "\n");
}

export function team(): TeamMember[] {
  return Object.entries(readRoster().people).map(([user_id, p]) => ({ user_id, label: p.label || user_id }));
}

export function isTeamMember(userId: string): boolean {
  return userId in readRoster().people;
}

export function labelFor(userId: string): string {
  return readRoster().people[userId]?.label ?? userId;
}

/** Enrolled BPM range for on-chain commitment; nulls when the wearer has no stamped range yet. */
export function wearerRange(userId: string): { centroid: number | null; sd: number | null } {
  const p = readRoster().people[userId];
  return { centroid: p?.centroid ?? null, sd: p?.sd ?? null };
}

function slugFor(label: string, people: Record<string, Person>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  if (!base) throw new Error("name needs at least one letter or digit");
  let id = `u_${base}`;
  for (let n = 2; id in people; n++) id = `u_${base}${n}`;
  return id;
}

/** New human on the team. No range yet; the first switch stamps one. */
export function addTeamMember(label: string): TeamMember {
  const clean = label.trim().replace(/\s+/g, " ").slice(0, 40);
  if (clean.length < 1) throw new Error("name required");
  const roster = readRoster();
  const user_id = slugFor(clean, roster.people);
  roster.people[user_id] = { label: clean, centroid: null, sd: null };
  writeRoster(roster);
  ensureUser(user_id, clean);
  logEvent("wearer.added", { user_id, label: clean });
  return { user_id, label: clean };
}

export function writeRosterActive(userId: string): void {
  const roster = readRoster();
  roster.active_user = userId;
  writeRoster(roster);
}

export function enrollCentroid(userId: string, centroid: number, sd = 8): void {
  const roster = readRoster();
  const label = roster.people[userId]?.label ?? userId;
  roster.people[userId] = { label, centroid, sd };
  writeRoster(roster);
}

export function ensureTeam(): void {
  for (const p of team()) ensureUser(p.user_id, p.label);
  const db = getDb();
  const row = db.prepare("SELECT active_user FROM wearer_session WHERE id = 1").get() as { active_user: string } | undefined;
  if (!row) {
    const active = readRoster().active_user;
    db.prepare(
      "INSERT INTO wearer_session (id, active_user, guessed_user, halt, last_median, streak, updated_at) VALUES (1, ?, '', 0, 0, 0, ?)",
    ).run(active, nowMs());
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
  // The bridge only sets changed after a continuity break. A different or
  // unknown wearer after that break stops money; the same wearer clears it.
  if (changed && guessed !== sess.active_user) halt = 1;
  if (guessed === sess.active_user) halt = 0;
  getDb()
    .prepare("UPDATE wearer_session SET guessed_user = ?, halt = ?, last_median = ?, updated_at = ? WHERE id = 1")
    .run(guessed, halt, median, nowMs());
  if (halt === 1 && !sess.halt) logEvent("wearer.changed", { from: sess.active_user, guessed: guessed || "unknown", median });
  if (halt === 0 && sess.halt) logEvent("wearer.cleared", { active: sess.active_user, guessed, median });
}

export function switchWearer(userId: string, enrollFromMedian: boolean): WearerSession {
  ensureTeam();
  const roster = readRoster();
  if (!(userId in roster.people)) throw new Error("unknown team member");
  const sess = getWearerSession();
  const hasRange = roster.people[userId]?.centroid != null;
  if (enrollFromMedian && !hasRange && sess.last_median >= 30) enrollCentroid(userId, sess.last_median);
  writeRosterActive(userId);
  getDb()
    .prepare("UPDATE wearer_session SET active_user = ?, guessed_user = ?, halt = 0, streak = 0, updated_at = ? WHERE id = 1")
    .run(userId, userId, nowMs());
  // evidence import is done by the route to avoid a cycle
  logEvent("wearer.switched", { user_id: userId, enrolled_median: enrollFromMedian ? sess.last_median : null });
  return getWearerSession();
}
