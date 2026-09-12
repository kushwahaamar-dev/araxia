#!/usr/bin/env python3
"""Subscribe to Heart Rate Measurement (0x2A37) and decode every packet.

Writes one JSON object per notification to capture/hr_<label>.jsonl and prints
a summary (cadence, contact ratio, RR availability, gaps) at the end.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import itertools
import json
import statistics
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from bleak import BleakClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bridge.hrs import DecodeError, decode

HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"
BODY_SENSOR_LOCATION = "00002a38-0000-1000-8000-00805f9b34fb"
BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"


def decode_row(data: bytes) -> dict:
    m = decode(data)
    contact = {None: "unsupported", True: "contact", False: "no_contact"}[m.contact_detected]
    out: dict = {"flags": m.flags, "bpm": m.bpm, "contact": contact}
    if m.energy_kj is not None:
        out["energy_kj"] = m.energy_kj
    if m.rr_ms:
        out["rr_ms"] = list(m.rr_ms)
    return out


async def stream(address: str, seconds: float, timeout: float, out: Path) -> int:
    out.parent.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    t0 = time.monotonic()
    disconnected = asyncio.Event()

    def on_disconnect(_client):
        print(f"[{time.monotonic() - t0:7.2f}s] DISCONNECTED", flush=True)
        disconnected.set()

    def handler(_sender, data: bytearray):
        now = time.monotonic() - t0
        row = {"t": round(now, 3), "ts": datetime.now(UTC).isoformat(), "hex": data.hex()}
        try:
            row.update(decode_row(bytes(data)))
        except DecodeError as exc:
            row["decode_error"] = str(exc)
        rows.append(row)
        rr = row.get("rr_ms")
        rr_txt = f" rr_ms={rr}" if rr else ""
        line = f"[{now:7.2f}s] bpm={row.get('bpm')} contact={row.get('contact')}{rr_txt} hex={row['hex']}"
        print(line, flush=True)

    async with BleakClient(address, timeout=timeout, disconnected_callback=on_disconnect) as client:
        for uuid, label in ((BODY_SENSOR_LOCATION, "body_sensor_location"), (BATTERY_LEVEL, "battery")):
            try:
                val = await client.read_gatt_char(uuid)
                print(f"{label}: {val.hex()} ({int(val[0]) if val else None})")
            except Exception as exc:
                print(f"{label}: read failed: {exc}")

        await client.start_notify(HR_MEASUREMENT, handler)
        print(f"Subscribed to 2A37 for {seconds:.0f}s. Streaming...", flush=True)
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(disconnected.wait(), timeout=seconds)
        if client.is_connected:
            with contextlib.suppress(Exception):
                await client.stop_notify(HR_MEASUREMENT)

    with out.open("w") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")

    print(f"\nWrote {len(rows)} packet(s) to {out}")
    if len(rows) >= 2:
        gaps = [b["t"] - a["t"] for a, b in itertools.pairwise(rows)]
        bpms = [r["bpm"] for r in rows if "bpm" in r]
        contact = sum(1 for r in rows if r.get("contact") == "contact")
        with_rr = sum(1 for r in rows if r.get("rr_ms"))
        rr_all = [x for r in rows for x in r.get("rr_ms", [])]
        print(f"cadence: median {statistics.median(gaps):.3f}s, max gap {max(gaps):.3f}s")
        print(f"bpm: min {min(bpms)} median {statistics.median(bpms)} max {max(bpms)}")
        print(f"contact bit: {contact}/{len(rows)} packets report skin contact")
        print(f"RR intervals: {with_rr}/{len(rows)} packets carry RR, {len(rr_all)} intervals total")
        if rr_all:
            print(f"RR ms: min {min(rr_all)} median {statistics.median(rr_all)} max {max(rr_all)}")
        flag_set = sorted({r.get("flags") for r in rows if "flags" in r})
        print(f"flag bytes seen: {[hex(f) for f in flag_set]}")
    return len(rows)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address")
    parser.add_argument("--label", default="run")
    parser.add_argument("--seconds", type=float, default=120.0)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()
    out = root / "capture" / f"hr_{args.label}.jsonl"
    try:
        n = asyncio.run(stream(args.address, args.seconds, args.timeout, out))
    except Exception as exc:
        print(f"Stream failed: {exc}", file=sys.stderr)
        return 1
    return 0 if n else 2


if __name__ == "__main__":
    sys.exit(main())
