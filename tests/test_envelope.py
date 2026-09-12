import base64
import json
from pathlib import Path

import pytest
from nacl.exceptions import BadSignatureError

from bridge.envelope import BridgeSigner, EvidencePayload, canonical_bytes, payload_digest, verify

VECTORS = Path(__file__).resolve().parent / "vectors" / "envelopes.json"


def sample_payload(seq: int = 1, presence: str = "READY") -> EvidencePayload:
    return EvidencePayload(
        v=1,
        bridge_id="b_test",
        device_id="d_fitbit_air_67",
        session_id="s_0001",
        seq=seq,
        issued_at_ms=1_757_700_000_000,
        latest_age_ms=900,
        count=19,
        valid_ratio_pct=100,
        median_gap_ms=1019,
        p95_gap_ms=1040,
        max_gap_ms=1055,
        distinct_values_30s=4,
        frozen_for_ms=2000,
        contact="unsupported",
        rr_present=False,
        presence=presence,
        drift="NOMINAL",
        model_version="m1",
    )


def test_sign_and_verify_roundtrip():
    signer = BridgeSigner(bytes(range(32)))
    env = signer.sign(sample_payload())
    parsed = verify(env, signer.public_key_hex)
    assert parsed["presence"] == "READY"
    assert parsed["seq"] == 1
    assert env.kid.startswith("b_")


def test_tampered_payload_fails():
    signer = BridgeSigner(bytes(range(32)))
    env = signer.sign(sample_payload(presence="STALE"))
    forged = env.__class__(kid=env.kid, payload=env.payload.replace('"STALE"', '"READY"'), sig=env.sig)
    with pytest.raises(BadSignatureError):
        verify(forged, signer.public_key_hex)


def test_wrong_key_fails():
    signer = BridgeSigner(bytes(range(32)))
    other = BridgeSigner(bytes(range(1, 33)))
    env = signer.sign(sample_payload())
    with pytest.raises(BadSignatureError):
        verify(env, other.public_key_hex)


def test_canonical_bytes_rejects_floats():
    with pytest.raises(TypeError):
        canonical_bytes({"a": 1.5})


def test_canonical_bytes_sorted_and_compact():
    raw = canonical_bytes({"b": 1, "a": {"z": True, "y": "s"}})
    assert raw == b'{"a":{"y":"s","z":true},"b":1}'


def test_load_or_create_persists_seed(tmp_path):
    path = tmp_path / "bridge.key"
    first = BridgeSigner.load_or_create(path)
    second = BridgeSigner.load_or_create(path)
    assert first.public_key_hex == second.public_key_hex
    assert oct(path.stat().st_mode & 0o777) == "0o600"


def test_vectors_match_python_implementation():
    vectors = json.loads(VECTORS.read_text())
    assert len(vectors) == 3
    for vec in vectors:
        signer = BridgeSigner(bytes.fromhex(vec["seed_hex"]))
        assert signer.public_key_hex == vec["public_key_hex"]
        payload = EvidencePayload(**vec["payload"])
        env = signer.sign(payload)
        assert env.payload == vec["payload_canonical"]
        assert payload_digest(env.payload.encode()) == vec["payload_sha256"]
        assert env.sig == vec["sig_b64"]
        assert len(base64.b64decode(env.sig)) == 64
