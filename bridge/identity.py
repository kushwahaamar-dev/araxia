"""Wearer identity model built from the only signal the Fitbit Air exposes: BPM.

Enrollment learns four statistics of the wearer's BPM series. Evaluation asks
whether a 20 s window is consistent with them. The model's only power is to
report DRIFTING, which forces a passkey step-up upstream. It never grants.

Features (see capture/hardware_gate.md for the measured ranges):
- level: median and MAD of BPM
- change_rate: fraction of consecutive packets whose value differs
- log_plateau: log seconds a single value persisted
- log_step: log absolute change between consecutive distinct values

Level alone is not drift (exercise moves it). The dynamics checks are
one-sided: a window is out-of-band when it is more volatile than the wearer's
99% predictive bound (values changing more often, plateaus shorter, steps
larger). Lower volatility is not judged here; the presence layer's frozen-value
rule bounds it from below. DRIFTING needs two consecutive out-of-band windows.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from enum import StrEnum
from itertools import pairwise
from pathlib import Path

MODEL_VERSION = "m1"
Z99 = 2.576
MIN_ENROLL_SECONDS = 300.0
MIN_ENROLL_PACKETS = 240
MAX_ADAPT_WEIGHT = 0.05
WINDOW_S = 20.0


class Drift(StrEnum):
    NOT_EVALUATED = "NOT_EVALUATED"
    NOMINAL = "NOMINAL"
    DRIFTING = "DRIFTING"


@dataclass
class Gaussian:
    n: float
    mean: float
    m2: float  # sum of squared deviations

    @classmethod
    def fit(cls, xs: list[float]) -> Gaussian:
        n = len(xs)
        mean = sum(xs) / n
        m2 = sum((x - mean) ** 2 for x in xs)
        return cls(n=float(n), mean=mean, m2=m2)

    @property
    def var(self) -> float:
        if self.n < 2:
            return 1.0
        return max(self.m2 / (self.n - 1), 1e-4)

    def predictive_interval(self, k: int) -> tuple[float, float]:
        """99% interval for the mean of k fresh samples, posterior-inflated by 1/n."""
        sd = math.sqrt(self.var * (1.0 / max(k, 1) + 1.0 / self.n))
        return self.mean - Z99 * sd, self.mean + Z99 * sd

    def blend(self, other: Gaussian, weight: float) -> None:
        w = min(max(weight, 0.0), MAX_ADAPT_WEIGHT)
        new_mean = (1 - w) * self.mean + w * other.mean
        self.m2 = (1 - w) * self.m2 + w * other.m2
        self.mean = new_mean
        self.n = (1 - w) * self.n + w * other.n


@dataclass
class WindowFeatures:
    n_packets: int
    level_median: float
    change_rate: float
    log_plateau_mean: float
    n_plateaus: int
    log_step_mean: float
    n_steps: int


def features(series: list[tuple[float, int]]) -> WindowFeatures | None:
    """series: (t_seconds, bpm) with plausible values only."""
    if len(series) < 4:
        return None
    bpms = sorted(b for _, b in series)
    median = bpms[len(bpms) // 2]
    changes = sum(1 for a, b in pairwise(series) if a[1] != b[1])
    change_rate = changes / (len(series) - 1)

    plateaus: list[float] = []
    steps: list[float] = []
    start_t = series[0][0]
    prev = series[0][1]
    for (t_prev, v_prev), (t, v) in pairwise(series):
        if v != v_prev:
            plateaus.append(max(t_prev - start_t + 1.0, 1.0))
            steps.append(abs(v - prev))
            start_t = t
            prev = v
    log_plateaus = [math.log(p) for p in plateaus]
    log_steps = [math.log(s) for s in steps if s > 0]
    return WindowFeatures(
        n_packets=len(series),
        level_median=float(median),
        change_rate=change_rate,
        log_plateau_mean=(sum(log_plateaus) / len(log_plateaus)) if log_plateaus else float("nan"),
        n_plateaus=len(log_plateaus),
        log_step_mean=(sum(log_steps) / len(log_steps)) if log_steps else float("nan"),
        n_steps=len(log_steps),
    )


@dataclass
class WearerModel:
    user_id: str
    model_version: str
    level: Gaussian
    change_rate: Gaussian
    log_plateau: Gaussian
    log_step: Gaussian
    enrolled_packets: int
    enrollment_snapshot: dict[str, float] = field(default_factory=dict)

    @classmethod
    def enroll(cls, user_id: str, series: list[tuple[float, int]]) -> WearerModel:
        if len(series) < MIN_ENROLL_PACKETS or series[-1][0] - series[0][0] < MIN_ENROLL_SECONDS:
            raise ValueError("enrollment needs >= 5 minutes and >= 240 plausible packets")
        windows = _split_windows(series, WINDOW_S)
        feats = [f for f in (features(w) for w in windows) if f is not None]
        if len(feats) < 8:
            raise ValueError("enrollment produced too few windows")
        level = Gaussian.fit([f.level_median for f in feats])
        change = Gaussian.fit([f.change_rate for f in feats])
        plateau = Gaussian.fit([f.log_plateau_mean for f in feats if not math.isnan(f.log_plateau_mean)])
        step = Gaussian.fit([f.log_step_mean for f in feats if not math.isnan(f.log_step_mean)])
        model = cls(
            user_id=user_id,
            model_version=MODEL_VERSION,
            level=level,
            change_rate=change,
            log_plateau=plateau,
            log_step=step,
            enrolled_packets=len(series),
        )
        model.enrollment_snapshot = model.summary()
        return model

    def summary(self) -> dict[str, float]:
        return {
            "level_mean": round(self.level.mean, 3),
            "level_sd": round(math.sqrt(self.level.var), 3),
            "change_rate_mean": round(self.change_rate.mean, 4),
            "log_plateau_mean": round(self.log_plateau.mean, 4),
            "log_step_mean": round(self.log_step.mean, 4),
        }

    def window_in_band(self, f: WindowFeatures) -> tuple[bool, list[str]]:
        out: list[str] = []
        if f.change_rate > self.change_rate.predictive_interval(1)[1]:
            out.append("change_rate")
        plateau_floor = self.log_plateau.predictive_interval(1)[0]
        if not math.isnan(f.log_plateau_mean) and f.log_plateau_mean < plateau_floor:
            out.append("log_plateau")
        if not math.isnan(f.log_step_mean) and f.log_step_mean > self.log_step.predictive_interval(1)[1]:
            out.append("log_step")
        return (not out), out

    def level_shift(self, f: WindowFeatures) -> bool:
        lo, hi = self.level.predictive_interval(1)
        return not lo <= f.level_median <= hi

    def adapt(self, series: list[tuple[float, int]], weight: float = MAX_ADAPT_WEIGHT) -> None:
        """Blend accepted, executed windows into the model. Never call after a denial."""
        feats = [f for f in (features(w) for w in _split_windows(series, WINDOW_S)) if f is not None]
        if len(feats) < 2:
            return
        self.level.blend(Gaussian.fit([f.level_median for f in feats]), weight)
        self.change_rate.blend(Gaussian.fit([f.change_rate for f in feats]), weight)
        plateau = [f.log_plateau_mean for f in feats if not math.isnan(f.log_plateau_mean)]
        step = [f.log_step_mean for f in feats if not math.isnan(f.log_step_mean)]
        if len(plateau) >= 2:
            self.log_plateau.blend(Gaussian.fit(plateau), weight)
        if len(step) >= 2:
            self.log_step.blend(Gaussian.fit(step), weight)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2) + "\n")

    @classmethod
    def load(cls, path: Path) -> WearerModel:
        raw = json.loads(path.read_text())
        return cls(
            user_id=raw["user_id"],
            model_version=raw["model_version"],
            level=Gaussian(**raw["level"]),
            change_rate=Gaussian(**raw["change_rate"]),
            log_plateau=Gaussian(**raw["log_plateau"]),
            log_step=Gaussian(**raw["log_step"]),
            enrolled_packets=raw["enrolled_packets"],
            enrollment_snapshot=raw.get("enrollment_snapshot", {}),
        )


class DriftEvaluator:
    """Feeds 20 s windows to a WearerModel and holds the two-window rule."""

    def __init__(self, model: WearerModel | None) -> None:
        self.model = model
        self._consecutive_out = 0
        self.state = Drift.NOT_EVALUATED
        self.last_reasons: list[str] = []
        self.level_shift = False

    def evaluate(self, series: list[tuple[float, int]]) -> Drift:
        if self.model is None:
            self.state = Drift.NOT_EVALUATED
            return self.state
        f = features(series)
        if f is None:
            return self.state
        in_band, reasons = self.model.window_in_band(f)
        self.level_shift = self.model.level_shift(f)
        self.last_reasons = reasons
        self._consecutive_out = 0 if in_band else self._consecutive_out + 1
        self.state = Drift.DRIFTING if self._consecutive_out >= 2 else Drift.NOMINAL
        return self.state


def _split_windows(series: list[tuple[float, int]], width: float) -> list[list[tuple[float, int]]]:
    if not series:
        return []
    windows: list[list[tuple[float, int]]] = []
    start = series[0][0]
    current: list[tuple[float, int]] = []
    for t, b in series:
        if t - start >= width:
            windows.append(current)
            current = []
            start = t
        current.append((t, b))
    if current:
        windows.append(current)
    return windows
