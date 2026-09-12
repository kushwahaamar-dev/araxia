import json
from pathlib import Path

from bridge.presence import Presence, PresenceTracker

CAPTURE = Path(__file__).resolve().parents[1] / "capture"


def load(name: str) -> list[tuple[float, int]]:
    rows = [json.loads(line) for line in (CAPTURE / name).read_text().splitlines() if line]
    return [(r["t"], r["bpm"]) for r in rows]


def replay(name: str) -> list[tuple[float, Presence]]:
    tracker = PresenceTracker()
    tracker.connected()
    states = []
    for t, bpm in load(name):
        tracker.observe(bpm, t)
        states.append((t, tracker.presence(t)))
    return states


def test_worn_capture_reaches_ready_and_stays_there():
    states = replay("hr_worn_4.jsonl")
    first_ready = next(t for t, s in states if s is Presence.READY)
    first_t = states[0][0]
    assert first_ready - first_t <= 5.0
    after = [s for t, s in states if t >= first_ready]
    assert all(s is Presence.READY for s in after)


def test_offwrist_capture_goes_stale_and_never_recovers():
    states = replay("hr_offwrist.jsonl")
    first_stale = next(t for t, s in states if s is Presence.STALE)
    assert 48.5 <= first_stale <= 50.0  # last value change at 18.7 s; frozen rule fires 30 s later
    assert all(s is Presence.STALE for t, s in states if t >= first_stale)


def test_rewear_capture_warms_then_becomes_ready():
    states = replay("hr_rewear.jsonl")
    assert states[0][1] is Presence.WARMING
    first_ready = next(t for t, s in states if s is Presence.READY)
    assert first_ready < 30.0
    assert not any(s is Presence.STALE for _, s in states)


def test_packet_gap_becomes_stale_then_disconnected():
    tracker = PresenceTracker()
    for i, bpm in enumerate([70, 71, 70, 72]):
        tracker.observe(bpm, float(i))
    assert tracker.presence(3.5) is Presence.READY
    assert tracker.presence(6.5) is Presence.STALE
    assert tracker.presence(13.5) is Presence.DISCONNECTED


def test_explicit_disconnect_clears_state():
    tracker = PresenceTracker()
    tracker.observe(70, 0.0)
    tracker.observe(71, 1.0)
    tracker.disconnected()
    assert tracker.presence(1.5) is Presence.DISCONNECTED
    tracker.observe(72, 2.0)
    assert tracker.presence(2.5) is Presence.WARMING


def test_implausible_values_do_not_count_as_variation():
    tracker = PresenceTracker()
    for i in range(10):
        tracker.observe(70 if i % 2 == 0 else 300, float(i))
    assert tracker.presence(9.5) is Presence.WARMING
    assert tracker.stats(9.5).valid_ratio == 0.5


def test_stats_shape_on_worn_capture():
    tracker = PresenceTracker()
    rows = load("hr_worn_4.jsonl")
    for t, bpm in rows:
        tracker.observe(bpm, t)
    s = tracker.stats(rows[-1][0] + 0.5)
    assert s.presence is Presence.READY
    assert 950 <= s.median_gap_ms <= 1100
    assert s.max_gap_ms < 1500
    assert s.distinct_values_30s >= 2
    assert s.frozen_for_ms < 30_000
