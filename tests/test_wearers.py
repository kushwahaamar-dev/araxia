import json

from bridge.wearers import HandoffTracker, guess


def test_guess_picks_nearest_centroid():
    roster = {
        "active_user": "u_amar",
        "people": {
            "u_amar": {"label": "Amar", "centroid": 110.0, "sd": 10.0},
            "u_laksh": {"label": "Laksh", "centroid": 93.4, "sd": 3.4},
            "u_jagriti": {"label": "Jagriti", "centroid": None, "sd": None},
        },
    }
    assert guess(115, roster) == "u_amar"
    assert guess(93, roster) == "u_laksh"
    assert guess(70, roster) == ""


def test_unknown_does_not_count_as_handoff(tmp_path, monkeypatch):
    roster = tmp_path / "wearers.json"
    roster.write_text(
        json.dumps(
            {
                "active_user": "u_amar",
                "people": {
                    "u_amar": {"label": "Amar", "centroid": 110.0, "sd": 10.0},
                    "u_laksh": {"label": "Laksh", "centroid": 93.4, "sd": 3.4},
                },
            }
        )
    )
    monkeypatch.setattr("bridge.wearers.ROSTER_PATH", roster)
    h = HandoffTracker()
    window = [(float(i), 70) for i in range(10)]
    _, g, c1, _ = h.update(window, "READY")
    _, _, c2, _ = h.update(window, "READY")
    assert g == ""
    assert c1 == 0
    assert c2 == 0


def test_overlap_while_connected_is_not_a_handoff(tmp_path, monkeypatch):
    roster = tmp_path / "wearers.json"
    roster.write_text(
        json.dumps(
            {
                "active_user": "u_amar",
                "people": {
                    "u_amar": {"label": "Amar", "centroid": 110.0, "sd": 10.0},
                    "u_laksh": {"label": "Laksh", "centroid": 93.4, "sd": 3.4},
                },
            }
        )
    )
    monkeypatch.setattr("bridge.wearers.ROSTER_PATH", roster)
    h = HandoffTracker()
    window = [(float(i), 93) for i in range(10)]
    a, g, c, m = h.update(window, "READY")
    assert g == "u_laksh"
    assert c == 0
    _, _, c2, _ = h.update(window, "READY")
    assert c2 == 0
    assert m == 93
    assert a == "u_amar"


def test_stale_then_same_wearer_is_not_a_handoff(tmp_path, monkeypatch):
    roster = tmp_path / "wearers.json"
    roster.write_text(
        json.dumps(
            {
                "active_user": "u_amar",
                "people": {
                    "u_amar": {"label": "Amar", "centroid": 110.0, "sd": 10.0},
                    "u_laksh": {"label": "Laksh", "centroid": 93.4, "sd": 3.4},
                },
            }
        )
    )
    monkeypatch.setattr("bridge.wearers.ROSTER_PATH", roster)
    h = HandoffTracker()
    worn = [(float(i), 115) for i in range(10)]
    h.update(worn, "READY")
    h.update([(0.0, 115)], "STALE")
    _, guessed, changed, _ = h.update(worn, "READY")
    assert guessed == "u_amar"
    assert changed == 0


def test_stale_then_unknown_range_is_a_new_user(tmp_path, monkeypatch):
    roster = tmp_path / "wearers.json"
    roster.write_text(
        json.dumps(
            {
                "active_user": "u_amar",
                "people": {"u_amar": {"label": "Amar", "centroid": 110.0, "sd": 10.0}},
            }
        )
    )
    monkeypatch.setattr("bridge.wearers.ROSTER_PATH", roster)
    h = HandoffTracker()
    h.update([(float(i), 110) for i in range(10)], "READY")
    h.update([(0.0, 110)], "DISCONNECTED")
    _, g, c, _ = h.update([(float(i), 65) for i in range(10)], "READY")
    assert g == ""
    assert c == 1


def test_stale_then_other_wearer_is_a_handoff(tmp_path, monkeypatch):
    roster = tmp_path / "wearers.json"
    roster.write_text(
        json.dumps(
            {
                "active_user": "u_amar",
                "people": {
                    "u_amar": {"label": "Amar", "centroid": 110.0, "sd": 10.0},
                    "u_laksh": {"label": "Laksh", "centroid": 93.4, "sd": 3.4},
                },
            }
        )
    )
    monkeypatch.setattr("bridge.wearers.ROSTER_PATH", roster)
    h = HandoffTracker()
    h.update([(float(i), 115) for i in range(10)], "READY")
    h.update([(0.0, 115)], "STALE")
    laksh = [(float(i), 93) for i in range(10)]
    _, g1, c1, _ = h.update(laksh, "READY")
    _, g2, c2, _ = h.update(laksh, "READY")
    assert g1 == "u_laksh"
    assert c1 == 1
    assert g2 == "u_laksh"
    assert c2 == 0
