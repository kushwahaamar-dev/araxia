"""Handoff detector: nearest enrolled BPM centroid after a continuity break.

This does not identify a person; resting ranges overlap. It answers a smaller
question: since the stream last broke, does the range still look like the
active wearer? Unknown (far from every centroid) after a break is a new-user
prompt. Passkey and Persona name the human; this only decides when to ask.
"""

from __future__ import annotations

import json
import statistics
from dataclasses import dataclass
from pathlib import Path

ROSTER_PATH = Path.home() / ".araxia" / "wearers.json"
Z_UNKNOWN = 2.0


@dataclass(frozen=True)
class Person:
    user_id: str
    label: str
    centroid: float | None
    sd: float | None


def default_roster() -> dict:
    return {
        "active_user": "u_amar",
        "people": {
            "u_amar": {"label": "Amar", "centroid": 110.0, "sd": 10.0},
            "u_laksh": {"label": "Laksh", "centroid": 93.4, "sd": 3.4},
            "u_jagrati": {"label": "Jagrati", "centroid": None, "sd": None},
        },
    }


def load_roster(path: Path | None = None) -> dict:
    roster = path or ROSTER_PATH
    if not roster.exists():
        roster.parent.mkdir(parents=True, exist_ok=True)
        roster.write_text(json.dumps(default_roster(), indent=2) + "\n")
    return json.loads(roster.read_text())


def people(roster: dict) -> list[Person]:
    out: list[Person] = []
    for user_id, raw in roster.get("people", {}).items():
        out.append(
            Person(
                user_id=user_id,
                label=str(raw.get("label") or user_id),
                centroid=raw.get("centroid"),
                sd=raw.get("sd"),
            )
        )
    return out


def guess(median: float, roster: dict) -> str:
    best_id = ""
    best_z = 1e9
    for p in people(roster):
        if p.centroid is None:
            continue
        sd = max(float(p.sd or 0), 2.0)
        z = abs(median - float(p.centroid)) / sd
        if z < best_z:
            best_z = z
            best_id = p.user_id
    if best_z > Z_UNKNOWN:
        return ""
    return best_id


class HandoffTracker:
    def __init__(self) -> None:
        self._last_guess = ""
        self._broken = False

    def update(self, window: list[tuple[float, int]], presence: str) -> tuple[str, str, int, int]:
        roster = load_roster()
        active = str(roster.get("active_user") or "u_amar")
        bpms = [b for _, b in window if 30 <= b <= 220]
        median = int(round(statistics.median(bpms))) if bpms else 0
        if presence in ("STALE", "DISCONNECTED"):
            self._broken = True
            return active, self._last_guess, 0, median
        if len(bpms) < 5 or presence != "READY":
            return active, self._last_guess, 0, median
        guessed = guess(float(median), roster)
        self._last_guess = guessed
        # A band cannot change wrists without the stream breaking first, so a
        # break is the only honest handoff signal. After one, a different or
        # unknown range means "someone else may be wearing this". Overlapping
        # HR while the stream never dropped is not a handoff.
        changed = 0
        if self._broken:
            self._broken = False
            if guessed != active:
                changed = 1
        return active, guessed, changed, median
