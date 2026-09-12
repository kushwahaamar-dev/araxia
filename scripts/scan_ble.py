#!/usr/bin/env python3
"""Scan for nearby BLE devices, highlighting Fitbit / Google Health candidates."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from bleak import BleakScanner

FITBIT_HINTS = re.compile(
    r"fitbit|google.?health|charge|versa|inspire|sense|luxe|ace|aria|\bair\b",
    re.I,
)

# Common Fitbit / Google company IDs seen in manufacturer data (best-effort).
FITBIT_COMPANY_IDS = {
    0x0183,  # Fitbit (Bluetooth SIG assigned)
}


def looks_like_fitbit(name: str | None, manufacturer_data: dict) -> bool:
    if name and FITBIT_HINTS.search(name):
        return True
    return any(cid in FITBIT_COMPANY_IDS for cid in manufacturer_data)


def device_row(device, advertisement_data) -> dict:
    mfg = {
        f"0x{cid:04X}": list(payload)
        for cid, payload in (advertisement_data.manufacturer_data or {}).items()
    }
    name = device.name or advertisement_data.local_name
    return {
        "address": device.address,
        "name": name,
        "rssi": advertisement_data.rssi,
        "fitbit_candidate": looks_like_fitbit(name, advertisement_data.manufacturer_data or {}),
        "service_uuids": list(advertisement_data.service_uuids or []),
        "manufacturer_data": mfg,
        "tx_power": advertisement_data.tx_power,
    }


async def scan(duration: float) -> list[dict]:
    found: dict[str, dict] = {}

    def callback(device, advertisement_data):
        row = device_row(device, advertisement_data)
        prev = found.get(device.address)
        if prev is None or (row["rssi"] or -999) > (prev.get("rssi") or -999):
            found[device.address] = row

    scanner = BleakScanner(detection_callback=callback)
    await scanner.start()
    await asyncio.sleep(duration)
    await scanner.stop()
    return sorted(
        found.values(),
        key=lambda d: (not d["fitbit_candidate"], -(d.get("rssi") or -999), d["address"]),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=12.0, help="Scan duration")
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "capture" / "scan.json",
        help="JSON output path",
    )
    parser.add_argument("--fitbit-only", action="store_true", help="Only print Fitbit candidates")
    args = parser.parse_args()

    devices = asyncio.run(scan(args.seconds))
    if args.fitbit_only:
        devices = [d for d in devices if d["fitbit_candidate"]]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": args.seconds,
        "count": len(devices),
        "devices": devices,
    }
    args.out.write_text(json.dumps(payload, indent=2) + "\n")

    print(f"Found {len(devices)} device(s). Wrote {args.out}")
    for d in devices:
        tag = " [FITBIT?]" if d["fitbit_candidate"] else ""
        svcs = ",".join(u[4:8] if u.endswith("-0000-1000-8000-00805f9b34fb") else u for u in d["service_uuids"])
        svc_txt = f"  svc={svcs}" if svcs else ""
        print(f"  {d['rssi']:>4}  {d['address']}  {d['name'] or '(no name)'}{tag}{svc_txt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
