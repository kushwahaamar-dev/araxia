"""Signed evidence envelopes: bridge -> service.

The payload is canonicalized once here (sorted keys, no whitespace, integers
only) and signed with Ed25519. The wire format carries the exact payload
string plus the signature, so the verifier checks the bytes it received and
never re-serializes.
"""

from __future__ import annotations

import base64
import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from nacl.signing import SigningKey, VerifyKey

ENVELOPE_VERSION = 1


@dataclass(frozen=True)
class EvidencePayload:
    v: int
    bridge_id: str
    device_id: str
    session_id: str
    seq: int
    issued_at_ms: int
    latest_age_ms: int
    count: int
    valid_ratio_pct: int
    median_gap_ms: int
    p95_gap_ms: int
    max_gap_ms: int
    distinct_values_30s: int
    frozen_for_ms: int
    contact: str
    rr_present: bool
    presence: str
    drift: str
    model_version: str


@dataclass(frozen=True)
class SignedEnvelope:
    kid: str
    payload: str
    sig: str

    def to_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))


def canonical_bytes(obj: dict[str, Any]) -> bytes:
    for k, val in obj.items():
        if isinstance(val, float):
            raise TypeError(f"float in canonical payload: {k}")
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def payload_digest(payload_bytes: bytes) -> str:
    return hashlib.sha256(payload_bytes).hexdigest()


class BridgeSigner:
    def __init__(self, seed: bytes) -> None:
        if len(seed) != 32:
            raise ValueError("ed25519 seed must be 32 bytes")
        self._key = SigningKey(seed)
        self.kid = "b_" + hashlib.sha256(bytes(self._key.verify_key)).hexdigest()[:16]

    @classmethod
    def load_or_create(cls, path: Path) -> BridgeSigner:
        if path.exists():
            return cls(bytes.fromhex(path.read_text().strip()))
        seed = SigningKey.generate().encode()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(bytes(seed).hex() + "\n")
        path.chmod(0o600)
        return cls(bytes(seed))

    @property
    def public_key_hex(self) -> str:
        return bytes(self._key.verify_key).hex()

    def sign(self, payload: EvidencePayload) -> SignedEnvelope:
        raw = canonical_bytes(asdict(payload))
        sig = self._key.sign(raw).signature
        return SignedEnvelope(kid=self.kid, payload=raw.decode("utf-8"), sig=base64.b64encode(sig).decode())


def verify(envelope: SignedEnvelope, public_key_hex: str) -> dict[str, Any]:
    """Verify the signature over the received payload bytes; return the parsed payload."""
    raw = envelope.payload.encode("utf-8")
    VerifyKey(bytes.fromhex(public_key_hex)).verify(raw, base64.b64decode(envelope.sig))
    parsed: dict[str, Any] = json.loads(raw)
    return parsed
