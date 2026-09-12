"""Bluetooth SIG Heart Rate Measurement (0x2A37) decoder.

Strict: any payload shorter than its flags promise raises DecodeError so the
caller fails closed instead of inventing a reading.
"""

from __future__ import annotations

from dataclasses import dataclass, field

DECODE_VERSION = "hrs-1"

FLAG_16BIT = 0x01
FLAG_CONTACT_SUPPORTED = 0x04
FLAG_CONTACT_DETECTED = 0x02
FLAG_ENERGY = 0x08
FLAG_RR = 0x10


class DecodeError(ValueError):
    pass


@dataclass(frozen=True)
class HeartRateMeasurement:
    bpm: int
    contact_supported: bool
    contact_detected: bool | None
    energy_kj: int | None
    rr_ms: tuple[int, ...] = field(default_factory=tuple)
    flags: int = 0
    decode_version: str = DECODE_VERSION


def decode(payload: bytes) -> HeartRateMeasurement:
    if len(payload) < 2:
        raise DecodeError(f"payload too short: {len(payload)} bytes")
    flags = payload[0]
    pos = 1

    if flags & FLAG_16BIT:
        if len(payload) < 3:
            raise DecodeError("16-bit bpm flag set but payload has 1 value byte")
        bpm = int.from_bytes(payload[1:3], "little")
        pos = 3
    else:
        bpm = payload[1]
        pos = 2

    contact_supported = bool(flags & FLAG_CONTACT_SUPPORTED)
    contact_detected = bool(flags & FLAG_CONTACT_DETECTED) if contact_supported else None

    energy_kj = None
    if flags & FLAG_ENERGY:
        if len(payload) < pos + 2:
            raise DecodeError("energy flag set but field missing")
        energy_kj = int.from_bytes(payload[pos:pos + 2], "little")
        pos += 2

    rr: list[int] = []
    if flags & FLAG_RR:
        rest = payload[pos:]
        if not rest or len(rest) % 2:
            raise DecodeError(f"rr flag set but {len(rest)} trailing bytes")
        for i in range(0, len(rest), 2):
            raw = int.from_bytes(rest[i:i + 2], "little")
            rr.append(round(raw * 1000 / 1024))
    elif len(payload) != pos:
        raise DecodeError(f"{len(payload) - pos} unexpected trailing bytes")

    return HeartRateMeasurement(
        bpm=bpm,
        contact_supported=contact_supported,
        contact_detected=contact_detected,
        energy_kj=energy_kj,
        rr_ms=tuple(rr),
        flags=flags,
    )
