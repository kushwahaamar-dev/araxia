#!/usr/bin/env python3
"""Connect to a BLE device and dump GATT services/characteristics."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from bleak import BleakClient

# Properties bit flags (Bleak exposes a set of strings; keep both forms).
PROP_ORDER = (
    "broadcast",
    "read",
    "write-without-response",
    "write",
    "notify",
    "indicate",
    "authenticated-signed-writes",
    "extended-properties",
)


def props_list(char) -> list[str]:
    props = getattr(char, "properties", None) or []
    if isinstance(props, (set, frozenset)):
        return [p for p in PROP_ORDER if p in props] + sorted(p for p in props if p not in PROP_ORDER)
    return list(props)


async def dump(address: str, timeout: float, read_values: bool) -> dict:
    async with BleakClient(address, timeout=timeout) as client:
        services = []
        for service in client.services:
            svc = {
                "uuid": str(service.uuid),
                "description": service.description,
                "handle": service.handle,
                "characteristics": [],
            }
            for char in service.characteristics:
                entry = {
                    "uuid": str(char.uuid),
                    "description": char.description,
                    "handle": char.handle,
                    "properties": props_list(char),
                    "descriptors": [
                        {
                            "uuid": str(d.uuid),
                            "handle": d.handle,
                            "description": getattr(d, "description", None),
                        }
                        for d in char.descriptors
                    ],
                }
                if read_values and "read" in entry["properties"]:
                    try:
                        raw = await client.read_gatt_char(char)
                        entry["value_hex"] = raw.hex()
                        with contextlib.suppress(UnicodeDecodeError):
                            entry["value_utf8"] = raw.decode("utf-8")
                    except Exception as exc:
                        entry["read_error"] = str(exc)
                svc["characteristics"].append(entry)
            services.append(svc)

        return {
            "dumped_at": datetime.now(UTC).isoformat(),
            "address": address,
            "mtu": getattr(client, "mtu_size", None),
            "services": services,
        }


def render_text(dump_data: dict) -> str:
    lines = [
        f"# GATT dump {dump_data['dumped_at']}",
        f"# address={dump_data['address']} mtu={dump_data.get('mtu')}",
        "",
    ]
    for svc in dump_data["services"]:
        lines.append(f"SERVICE  {svc['uuid']}  {svc.get('description') or ''}")
        for char in svc["characteristics"]:
            props = ",".join(char["properties"])
            lines.append(f"  CHAR   {char['uuid']}  [{props}]  {char.get('description') or ''}")
            if "value_hex" in char:
                lines.append(f"         value_hex={char['value_hex']}")
            if "value_utf8" in char:
                lines.append(f"         value_utf8={char['value_utf8']!r}")
            if "read_error" in char:
                lines.append(f"         read_error={char['read_error']}")
            for d in char["descriptors"]:
                lines.append(f"    DESC {d['uuid']}  handle={d['handle']}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", help="BLE MAC / UUID of the target device")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--read", action="store_true", help="Attempt to read readable characteristics")
    parser.add_argument(
        "--json-out",
        type=Path,
        default=root / "capture" / "gatt.json",
    )
    parser.add_argument(
        "--text-out",
        type=Path,
        default=root / "dump.txt",
    )
    args = parser.parse_args()

    try:
        data = asyncio.run(dump(args.address, args.timeout, args.read))
    except Exception as exc:
        print(f"Connect/dump failed: {exc}", file=sys.stderr)
        return 1

    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.write_text(json.dumps(data, indent=2) + "\n")
    text = render_text(data)
    args.text_out.write_text(text + "\n")
    print(text)
    print(f"Wrote {args.json_out} and {args.text_out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
