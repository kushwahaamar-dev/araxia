#!/usr/bin/env python3
"""Subscribe to BLE notifications/indications and log packet payloads."""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

from bleak import BleakClient


async def sniff(address: str, uuids: list[str], timeout: float, seconds: float, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []

    def handler(sender, data: bytearray):
        ts = datetime.now(timezone.utc).isoformat()
        line = f"{ts}  handle={sender}  hex={data.hex()}  len={len(data)}"
        print(line, flush=True)
        lines.append(line)

    async with BleakClient(address, timeout=timeout) as client:
        targets = uuids
        if not targets:
            targets = []
            for service in client.services:
                for char in service.characteristics:
                    props = set(char.properties or [])
                    if "notify" in props or "indicate" in props:
                        targets.append(str(char.uuid))

        if not targets:
            print("No notify/indicate characteristics found.", file=sys.stderr)
            return

        print(f"Subscribing to {len(targets)} characteristic(s) for {seconds}s...")
        for uuid in targets:
            try:
                await client.start_notify(uuid, handler)
                print(f"  notify ON  {uuid}")
            except Exception as exc:  # noqa: BLE001
                print(f"  notify FAIL {uuid}: {exc}", file=sys.stderr)

        await asyncio.sleep(seconds)

        for uuid in targets:
            try:
                await client.stop_notify(uuid)
            except Exception:
                pass

    out.write_text("\n".join(lines) + ("\n" if lines else ""))
    print(f"Wrote {len(lines)} packet(s) to {out}")


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", help="BLE address of your Fitbit Air")
    parser.add_argument("--uuid", action="append", default=[], help="Characteristic UUID (repeatable)")
    parser.add_argument("--timeout", type=float, default=20.0)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--out", type=Path, default=root / "capture" / "notify.log")
    args = parser.parse_args()

    try:
        asyncio.run(sniff(args.address, args.uuid, args.timeout, args.seconds, args.out))
    except Exception as exc:  # noqa: BLE001
        print(f"Sniff failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
