"use client";

import { useEffect, useState } from "react";

export type StickMode = "READY" | "WARMING" | "STALE" | "OFF" | "WAIT" | "DOWN";

const W = 15;

function pad(line: string): string {
  return line.padEnd(W, " ").slice(0, W);
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function shift(line: string, n: number): string {
  if (n <= 0) return pad(line);
  return pad(`${" ".repeat(n)}${line.trimEnd()}`);
}

const READY: string[][] = [
  ["      o", "     /|\\", "     / \\", "    `   '"],
  ["      o", "     /|", "     / \\", "    `   \\"],
  ["      o", "      |\\", "     / \\", "    /   '"],
  ["     .o.", "     /|\\", "     / \\", "    `   '"],
  ["      o", "     \\|/", "     / \\", "    `   '"],
  ["      o", "     /|\\", "     | \\", "    |   '"],
  ["      o", "     /|\\", "     / |", "    `   |"],
  ["      o", "     /+\\", "     / \\", "    `   '"],
];

const WARMING: string[][] = [
  ["      o", "     /|¬", "     / \\", "    .   ."],
  ["      o", "     /|-", "     / \\", "    .   ."],
  ["      o", "     /|¬", "     / |", "    .   |"],
];

const STALE: string[][] = [
  ["      o", "     /|\\", "     / \\", "    :   :"],
  ["      o", "     /|:", "     / \\", "    :   :"],
  ["      0", "     /|\\", "     / \\", "    :   :"],
];

const OFF: string[][] = [
  ["", "      o", "     /|_", "    /   "],
  ["", "      o", "     /|_", "    /   "],
];

const WAIT: string[][] = [
  ["      o", "     /|¬", "     / \\", "          "],
  ["      o", "     /|-", "     / \\", "          "],
];

const DOWN: string[][] = [
  ["      x", "     /|\\", "     / \\", "    .   ."],
];

const SET: Record<StickMode, string[][]> = {
  READY,
  WARMING,
  STALE,
  OFF,
  WAIT,
  DOWN,
};

function ecg(tick: number, live: boolean): string {
  if (!live) return pad("    .......");
  const wave = "~^-_~^-_~^-_~^-_";
  const i = tick % wave.length;
  return pad(`   ${wave.slice(i)}${wave.slice(0, i)}`.slice(0, 14));
}

function compose(mode: StickMode, tick: number, bpm: number | null): string {
  const frames = SET[mode];
  const live = mode === "READY";
  const beat = live && bpm !== null && tick % Math.max(2, Math.round(8 * (80 / Math.max(bpm, 40)))) === 0;
  const idx = live ? (beat ? frames.length - 1 : tick % Math.max(frames.length - 1, 1)) : tick % frames.length;
  const body = frames.at(idx) ?? frames[0]!;
  const amp = live ? (bpm && bpm > 120 ? 2 : 1) : mode === "STALE" ? 1 : 0;
  const j = amp > 0 && hash(tick * 17 + (bpm ?? 0)) > 0.55 ? 1 + (hash(tick * 3) > 0.7 && amp > 1 ? 1 : 0) : 0;
  const lines = body.map((line) => shift(beat && line.includes("|") ? line.replace("|", "+") : line, j));
  lines.push(ecg(tick, live));
  return lines.join("\n");
}

export function StickWrist({ mode, bpm }: { mode: StickMode; bpm: number | null }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const ms = mode === "READY" && bpm ? Math.max(55, Math.round(60000 / bpm / 2.4)) : mode === "OFF" ? 400 : 140;
    const id = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [mode, bpm]);

  return (
    <pre className={`stick-wrist${mode === "READY" ? " stick-live" : ""}`} aria-hidden>
      {compose(mode, tick, bpm)}
    </pre>
  );
}

export function stickMode(code: string): StickMode {
  if (code === "READY") return "READY";
  if (code === "WARMING") return "WARMING";
  if (code === "STALE") return "STALE";
  if (code === "UNREACHABLE") return "DOWN";
  if (code === "DISCONNECTED") return "OFF";
  return "WAIT";
}
