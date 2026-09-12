"""Presence state from a stream of BPM observations.

Thresholds come from capture/hardware_gate.md. The Fitbit Air keeps sending
its last value when taken off, so presence is defined by variation within a
window, not by packets arriving.
"""

from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass
from enum import StrEnum
from itertools import pairwise


class Presence(StrEnum):
    WARMING = "WARMING"
    READY = "READY"
    STALE = "STALE"
    DISCONNECTED = "DISCONNECTED"


@dataclass(frozen=True)
class Thresholds:
    pause_after_s: float = 3.0
    disconnect_after_s: float = 10.0
    frozen_stale_s: float = 30.0
    ready_window_s: float = 30.0
    min_distinct_values: int = 2
    bpm_min: int = 30
    bpm_max: int = 220
    stats_window_s: float = 20.0


@dataclass(frozen=True)
class Observation:
    t: float
    bpm: int
    valid: bool


@dataclass(frozen=True)
class WindowStats:
    presence: Presence
    count: int
    valid_ratio: float
    median_gap_ms: int
    p95_gap_ms: int
    max_gap_ms: int
    latest_age_ms: int
    distinct_values_30s: int
    frozen_for_ms: int


class PresenceTracker:
    def __init__(self, thresholds: Thresholds | None = None) -> None:
        self.th = thresholds or Thresholds()
        keep = max(self.th.ready_window_s, self.th.stats_window_s) + 5.0
        self._keep_s = keep
        self._obs: deque[Observation] = deque()
        self._last_value: int | None = None
        self._last_change_t: float | None = None
        self._connected = False

    def connected(self) -> None:
        self._connected = True

    def disconnected(self) -> None:
        self._connected = False
        self._obs.clear()
        self._last_value = None
        self._last_change_t = None

    def observe(self, bpm: int, t: float) -> None:
        self._connected = True
        valid = self.th.bpm_min <= bpm <= self.th.bpm_max
        self._obs.append(Observation(t=t, bpm=bpm, valid=valid))
        if valid and bpm != self._last_value:
            self._last_value = bpm
            self._last_change_t = t
        cutoff = t - self._keep_s
        while self._obs and self._obs[0].t < cutoff:
            self._obs.popleft()

    def presence(self, now: float) -> Presence:
        if not self._connected or not self._obs:
            return Presence.DISCONNECTED
        age = now - self._obs[-1].t
        if age >= self.th.disconnect_after_s:
            return Presence.DISCONNECTED
        if age >= self.th.pause_after_s:
            return Presence.STALE
        if self._frozen_for(now) >= self.th.frozen_stale_s:
            return Presence.STALE
        if self._distinct_recent(now) >= self.th.min_distinct_values:
            return Presence.READY
        return Presence.WARMING

    def stats(self, now: float) -> WindowStats:
        recent = [o for o in self._obs if o.t >= now - self.th.stats_window_s]
        gaps = [int((b.t - a.t) * 1000) for a, b in pairwise(recent)]
        if gaps:
            gaps_sorted = sorted(gaps)
            median = int(statistics.median(gaps_sorted))
            p95 = gaps_sorted[min(len(gaps_sorted) - 1, int(0.95 * len(gaps_sorted)))]
            max_gap = gaps_sorted[-1]
        else:
            median = p95 = max_gap = 0
        latest_age = int((now - self._obs[-1].t) * 1000) if self._obs else -1
        valid_ratio = (sum(o.valid for o in recent) / len(recent)) if recent else 0.0
        return WindowStats(
            presence=self.presence(now),
            count=len(recent),
            valid_ratio=round(valid_ratio, 3),
            median_gap_ms=median,
            p95_gap_ms=p95,
            max_gap_ms=max_gap,
            latest_age_ms=latest_age,
            distinct_values_30s=self._distinct_recent(now),
            frozen_for_ms=int(self._frozen_for(now) * 1000),
        )

    def _distinct_recent(self, now: float) -> int:
        cutoff = now - self.th.ready_window_s
        return len({o.bpm for o in self._obs if o.valid and o.t >= cutoff})

    def _frozen_for(self, now: float) -> float:
        if self._last_change_t is None:
            return 0.0
        return now - self._last_change_t
