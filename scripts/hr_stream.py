#!/usr/bin/env python3
"""Subscribe to Heart Rate Measurement (0x2A37) and decode every packet.

Writes one JSON object per notification to capture/hr_<label>.jsonl and prints
a summary (cadence, contact ratio, RR availability, gaps) at the end.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from bleak import BleakClient

HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"
BODY_SENSOR_LOCATION = "00002a38-0000-1000-8000-00805f9b34fb"
BATTERY_LEVEL = "00002a19-0000-1000-8000-00805f9b34fb"

CONTACT = {0: "unsupported", 1: "unsupported", 2: "no_contact", 3: "contact"}


def decode_hr(data: bytes) -> dict:
    flags = data[0]
    pos = 1
    if flags & 0x01:
        bpm = int.from_bytes(data[pos:pos + 2], "little")
        pos += 2
    else:
        bpm = data[pos]
        pos += 1
    out = {
        "flags": flags,
        "bpm": bpm,
        "contact": CONTACT[(flags >> 1) & 0x03],
    }
    if flags & 0x08:
        out["energy_kj"] = int.from_bytes(data[pos:pos + 2], "little")
        pos += 2
    if flags & 0x10:
        rr = []
        while pos + 1 < len(data):
            rr.append(round(int.from_bytes(data[pos:pos + 2], "little") / 1024.0, 4))
            pos += 2
        out["rr_s"] = rr
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
        row = {"t": round(now, 3), "ts": datetime.now(timezone.utc).isoformat(), "hex": data.hex()}
        try:
            row.update(decode_hr(bytes(data)))
        except Exception as exc:  # noqa: BLE001
            row["decode_error"] = str(exc)
        rows.append(row)
        rr = row.get("rr_s")
        rr_txt = f" rr={rr}" if rr else ""
        print(f"[{now:7.2f}s] bpm={row.get('bpm')} contact={row.get('contact')}{rr_txt} hex={row['hex']}", flush=True)

    async with BleakClient(address, timeout=timeout, disconnected_callback=on_disconnect) as client:
        for uuid, label in ((BODY_SENSOR_LOCATION, "body_sensor_location"), (BATTERY_LEVEL, "battery")):
            try:
                val = await client.read_gatt_char(uuid)
                print(f"{label}: {val.hex()} ({int(val[0]) if val else None})")
            except Exception as exc:  # noqa: BLE001
                print(f"{label}: read failed: {exc}")

        await client.start_notify(HR_MEASUREMENT, handler)
        print(f"Subscribed to 2A37 for {seconds:.0f}s. Streaming...", flush=True)
        try:
            await asyncio.wait_for(disconnected.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            pass
        if client.is_connected:
            try:
                await client.stop_notify(HR_MEASUREMENT)
            except Exception:  # noqa: BLE001
                pass

    with out.open("w") as fh:
        for row in rows:
            fh.write(json.dumps(row) + "\n")

    print(f"\nWrote {len(rows)} packet(s) to {out}")
    if len(rows) >= 2:
        gaps = [b["t"] - a["t"] for a, b in zip(rows, rows[1:])]
        bpms = [r["bpm"] for r in rows if "bpm" in r]
        contact = sum(1 for r in rows if r.get("contact") == "contact")
        with_rr = sum(1 for r in rows if r.get("rr_s"))
        rr_all = [x for r in rows for x in r.get("rr_s", [])]
        print(f"cadence: median {statistics.median(gaps):.3f}s, max gap {max(gaps):.3f}s")
        print(f"bpm: min {min(bpms)} median {statistics.median(bpms)} max {max(bpms)}")
        print(f"contact bit: {contact}/{len(rows)} packets report skin contact")
        print(f"RR intervals: {with_rr}/{len(rows)} packets carry RR, {len(rr_all)} intervals total")
        if rr_all:
            print(f"RR: min {min(rr_all):.3f}s median {statistics.median(rr_all):.3f}s max {max(rr_all):.3f}s")
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
    except Exception as exc:  # noqa: BLE001
        print(f"Stream failed: {exc}", file=sys.stderr)
        return 1
    return 0 if n else 2


if __name__ == "__main__":
    sys.exit(main())
