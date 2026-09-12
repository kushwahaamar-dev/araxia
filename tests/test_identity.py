import json
import math
from pathlib import Path

import pytest

from bridge.identity import Drift, DriftEvaluator, WearerModel, features

CAPTURE = Path(__file__).resolve().parents[1] / "capture"


def load(name: str) -> list[tuple[float, int]]:
    rows = [json.loads(line) for line in (CAPTURE / name).read_text().splitlines() if line]
    return [(r["t"], r["bpm"]) for r in rows]


def tiled_worn(copies: int = 2) -> list[tuple[float, int]]:
    """The 192 s worn capture tiled to satisfy the 5-minute enrollment minimum."""
    base = load("hr_worn_4.jsonl")
    span = base[-1][0] - base[0][0] + 1.0
    out: list[tuple[float, int]] = []
    for i in range(copies):
        out.extend((t + i * span, b) for t, b in base)
    return out


def windows(series: list[tuple[float, int]], width: float = 20.0) -> list[list[tuple[float, int]]]:
    out, cur, start = [], [], series[0][0]
    for t, b in series:
        if t - start >= width:
            out.append(cur)
            cur, start = [], t
        cur.append((t, b))
    if cur:
        out.append(cur)
    return out


@pytest.fixture
def model() -> WearerModel:
    return WearerModel.enroll("u_test", tiled_worn())


def test_enrollment_requires_five_minutes():
    with pytest.raises(ValueError):
        WearerModel.enroll("u_test", load("hr_worn_4.jsonl"))


def test_enrollment_summary_matches_measured_device_behaviour(model):
    s = model.summary()
    assert 100 <= s["level_mean"] <= 120
    assert 0.3 <= s["change_rate_mean"] <= 0.7  # value refreshes every ~2 s at 1 Hz
    assert 0.0 <= s["log_plateau_mean"] <= math.log(8.0)


def test_worn_stream_is_nominal(model):
    ev = DriftEvaluator(model)
    states = [ev.evaluate(w) for w in windows(load("hr_rewear.jsonl"))[1:]]
    assert Drift.DRIFTING not in states


def test_frozen_offwrist_stream_is_left_to_presence(model):
    ev = DriftEvaluator(model)
    states = [ev.evaluate(w) for w in windows(load("hr_offwrist.jsonl"))]
    assert Drift.DRIFTING not in states


def test_synthetic_jittery_feed_drifts(model):
    series = [(float(i), 110 + (7 if i % 2 else -7)) for i in range(60)]
    ev = DriftEvaluator(model)
    states = [ev.evaluate(w) for w in windows(series)]
    assert states[-1] is Drift.DRIFTING
    assert {"change_rate", "log_step"} <= set(ev.last_reasons)


def test_other_source_with_natural_variation_drifts(model):
    series = [(float(i), 72 + (i * 7 % 5)) for i in range(60)]
    ev = DriftEvaluator(model)
    states = [ev.evaluate(w) for w in windows(series)]
    assert states[-1] is Drift.DRIFTING


def test_single_out_of_band_window_is_not_drift(model):
    ev = DriftEvaluator(model)
    worn = windows(load("hr_worn_4.jsonl"))
    jitter = [(float(i), 110 + (7 if i % 2 else -7)) for i in range(20)]
    assert ev.evaluate(worn[1]) is Drift.NOMINAL
    assert ev.evaluate(jitter) is Drift.NOMINAL
    assert ev.last_reasons
    assert ev.evaluate(worn[2]) is Drift.NOMINAL


def test_level_shift_alone_is_not_drift(model):
    shifted = [(t, b + 40) for t, b in load("hr_worn_4.jsonl")]
    ev = DriftEvaluator(model)
    states = [ev.evaluate(w) for w in windows(shifted)]
    assert Drift.DRIFTING not in states
    assert ev.level_shift is True


def test_no_model_means_not_evaluated():
    ev = DriftEvaluator(None)
    assert ev.evaluate(windows(load("hr_worn_4.jsonl"))[0]) is Drift.NOT_EVALUATED


def test_adapt_is_capped_and_snapshot_immutable(model):
    before = dict(model.enrollment_snapshot)
    level_before = model.level.mean
    model.adapt([(t, b + 40) for t, b in load("hr_worn_4.jsonl")], weight=0.9)
    assert model.enrollment_snapshot == before
    assert abs(model.level.mean - level_before) <= 40 * 0.05 + 0.1


def test_save_and_load_roundtrip(model, tmp_path):
    path = tmp_path / "u_test.json"
    model.save(path)
    loaded = WearerModel.load(path)
    assert loaded.summary() == model.summary()


def test_features_on_short_window_is_none():
    assert features([(0.0, 70), (1.0, 71)]) is None
