#!/usr/bin/env python3
"""Poll BLE adverts until a device advertises the Heart Rate Service, then print it.

Fitbit Air only advertises 0x180D while "Share heart rate" is on. Under Extended
Pairing it may also surface under a new address, so we match on the service,
not the known address.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time

from bleak import BleakScanner

HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"


async def wait(max_seconds: float) -> int:
    found: dict[str, tuple[str | None, int]] = {}
    t0 = time.monotonic()

    def cb(device, adv):
        uuids = [u.lower() for u in (adv.service_uuids or [])]
        if HR_SERVICE in uuids:
            found[device.address] = (device.name or adv.local_name, adv.rssi)

    scanner = BleakScanner(detection_callback=cb)
    await scanner.start()
    last_tick = 0
    try:
        while time.monotonic() - t0 < max_seconds:
            if found:
                break
            await asyncio.sleep(0.5)
            elapsed = int(time.monotonic() - t0)
            if elapsed // 15 != last_tick:
                last_tick = elapsed // 15
                print(f"  ...{elapsed}s, no 180D advert yet", flush=True)
    finally:
        await scanner.stop()

    if not found:
        print("No device advertised 0x180D.", file=sys.stderr)
        return 1
    for addr, (name, rssi) in found.items():
        print(f"HR ADVERT  {rssi:>4}  {addr}  {name or '(no name)'}")
    print(next(iter(found)))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-seconds", type=float, default=900.0)
    args = parser.parse_args()
    return asyncio.run(wait(args.max_seconds))


if __name__ == "__main__":
    sys.exit(main())
