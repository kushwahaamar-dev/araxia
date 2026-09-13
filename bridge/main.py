"""Araxia bridge: Fitbit Air -> presence + identity -> signed evidence envelopes.

    python -m bridge.main run --address <BLE addr> --user u_amar [--service http://localhost:3000]
    python -m bridge.main enroll --address <BLE addr> --user u_amar --seconds 300
    python -m bridge.main run --replay capture/hr_worn_4.jsonl --user u_amar --dry-run

Raw BPM never leaves this process except in `enroll`, which stores the model
locally under ~/.araxia/models. Envelopes carry window statistics only.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import secrets
import sys
import time
import urllib.error
import urllib.request
from collections.abc import AsyncIterator
from pathlib import Path

from bleak import BleakClient, BleakScanner

from bridge.envelope import ENVELOPE_VERSION, BridgeSigner, EvidencePayload
from bridge.hrs import DecodeError, decode
from bridge.identity import WINDOW_S, DriftEvaluator, WearerModel
from bridge.presence import PresenceTracker

HR_SERVICE = "0000180d-0000-1000-8000-00805f9b34fb"
HR_MEASUREMENT = "00002a37-0000-1000-8000-00805f9b34fb"
STATE_DIR = Path.home() / ".araxia"


class Sample:
    __slots__ = ("bpm", "t")

    def __init__(self, t: float, bpm: int) -> None:
        self.t = t
        self.bpm = bpm


async def _one_connection(device: object, connect_timeout: float) -> AsyncIterator[Sample]:
    queue: asyncio.Queue[Sample | None] = asyncio.Queue()

    def on_data(_sender: object, data: bytearray) -> None:
        try:
            m = decode(bytes(data))
        except DecodeError as exc:
            print(f"bridge: decode error {exc} hex={data.hex()}", flush=True)
            return
        queue.put_nowait(Sample(time.monotonic(), m.bpm))

    def on_disconnect(_client: BleakClient) -> None:
        queue.put_nowait(None)

    client = BleakClient(device, timeout=connect_timeout, disconnected_callback=on_disconnect)  # type: ignore[arg-type]
    async with client:
        await client.start_notify(HR_MEASUREMENT, on_data)
        print("bridge: connected", flush=True)
        while True:
            item = await queue.get()
            if item is None:
                return
            yield item


async def ble_samples(address: str, connect_timeout: float) -> AsyncIterator[Sample | None]:
    """Yield samples from the band; yield None on each disconnect. Reconnects forever."""
    while True:
        device = await BleakScanner.find_device_by_address(address, timeout=connect_timeout)
        if device is None:
            print("bridge: band not advertising (is it worn? is Share heart rate on?)", flush=True)
            yield None
            await asyncio.sleep(2.0)
            continue
        try:
            async for sample in _one_connection(device, connect_timeout):
                yield sample
        except Exception as exc:  # BLE stacks raise many types; we always retry
            print(f"bridge: connection error: {exc}", flush=True)
        print("bridge: disconnected", flush=True)
        yield None
        await asyncio.sleep(1.0)


async def replay_samples(path: Path, speed: float) -> AsyncIterator[Sample | None]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    t0 = time.monotonic()
    base = rows[0]["t"]
    for row in rows:
        target = t0 + (row["t"] - base) / speed
        await asyncio.sleep(max(0.0, target - time.monotonic()))
        yield Sample(time.monotonic(), row["bpm"])
    yield None


def post_envelope(url: str, body: str) -> str:
    req = urllib.request.Request(url, data=body.encode(), headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            return f"{resp.status}"
    except urllib.error.HTTPError as exc:
        return f"{exc.code} {exc.read()[:80]!r}"
    except (urllib.error.URLError, TimeoutError) as exc:
        return f"unreachable ({exc})"


async def run(args: argparse.Namespace) -> int:
    signer = BridgeSigner.load_or_create(STATE_DIR / "bridge.key")
    model_path = STATE_DIR / "models" / f"{args.user}.json"
    model = WearerModel.load(model_path) if model_path.exists() else None
    if model is None:
        print("bridge: no enrolled model for this user; drift will report NOT_EVALUATED", flush=True)

    tracker = PresenceTracker()
    drift = DriftEvaluator(model)
    session_id = "s_" + secrets.token_hex(6)
    device_id = "REPLAY" if args.replay else "d_" + hashlib.sha256(args.address.encode()).hexdigest()[:12]
    print(f"bridge: kid={signer.kid} pubkey={signer.public_key_hex} session={session_id}", flush=True)

    source = replay_samples(Path(args.replay), args.speed) if args.replay else ble_samples(args.address, 15.0)
    window: list[tuple[float, int]] = []
    window_start = time.monotonic()
    seq = 0
    next_tick = time.monotonic()
    stream_done = False

    async def consume() -> None:
        nonlocal stream_done, window_start
        async for sample in source:
            if sample is None:
                tracker.disconnected()
                window.clear()
                window_start = time.monotonic()
                if args.replay:
                    stream_done = True
                    return
                continue
            tracker.observe(sample.bpm, sample.t)
            if 30 <= sample.bpm <= 220:
                window.append((sample.t, sample.bpm))

    consumer = asyncio.create_task(consume())
    try:
        while not stream_done:
            now = time.monotonic()
            if now - window_start >= WINDOW_S:
                drift.evaluate(window)
                window.clear()
                window_start = now
            stats = tracker.stats(now)
            seq += 1
            payload = EvidencePayload(
                v=ENVELOPE_VERSION,
                bridge_id=signer.kid,
                device_id=device_id,
                session_id=session_id,
                seq=seq,
                issued_at_ms=int(time.time() * 1000),
                latest_age_ms=stats.latest_age_ms,
                count=stats.count,
                valid_ratio_pct=round(stats.valid_ratio * 100),
                median_gap_ms=stats.median_gap_ms,
                p95_gap_ms=stats.p95_gap_ms,
                max_gap_ms=stats.max_gap_ms,
                distinct_values_30s=stats.distinct_values_30s,
                frozen_for_ms=stats.frozen_for_ms,
                contact="unsupported",
                rr_present=False,
                presence=stats.presence.value,
                drift=drift.state.value,
                model_version=model.model_version if model else "none",
            )
            env = signer.sign(payload)
            if args.dry_run:
                status = "dry-run"
            else:
                status = await asyncio.to_thread(post_envelope, args.service + "/api/evidence", env.to_json())
            line = (
                f"[{seq:5d}] {stats.presence.value:<12} drift={drift.state.value:<13} "
                f"age={stats.latest_age_ms}ms distinct30={stats.distinct_values_30s} "
                f"frozen={stats.frozen_for_ms // 1000}s -> {status}"
            )
            print(line, flush=True)
            next_tick += 1.0
            await asyncio.sleep(max(0.0, next_tick - time.monotonic()))
    finally:
        consumer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await consumer
    return 0


async def enroll(args: argparse.Namespace) -> int:
    series: list[tuple[float, int]] = []
    tracker = PresenceTracker()
    t_end = time.monotonic() + args.seconds
    print(f"bridge: enrolling {args.user} for {args.seconds:.0f}s; keep the band on, stay seated", flush=True)
    async with contextlib.aclosing(ble_samples(args.address, 15.0)) as samples:
        async for sample in samples:
            if time.monotonic() >= t_end:
                break
            if sample is None:
                continue
            tracker.observe(sample.bpm, sample.t)
            if tracker.presence(sample.t).value == "READY" and 30 <= sample.bpm <= 220:
                series.append((sample.t, sample.bpm))
            if len(series) % 30 == 0 and series:
                left = t_end - time.monotonic()
                print(f"bridge: {len(series)} accepted packets, {left:.0f}s left", flush=True)
    try:
        model = WearerModel.enroll(args.user, series)
    except ValueError as exc:
        print(f"bridge: enrollment failed: {exc}", file=sys.stderr)
        return 1
    path = STATE_DIR / "models" / f"{args.user}.json"
    model.save(path)
    print(f"bridge: saved {path}\n{json.dumps(model.summary(), indent=2)}", flush=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run")
    p_run.add_argument("--address", default="")
    p_run.add_argument("--user", required=True)
    p_run.add_argument("--service", default="http://localhost:3000")
    p_run.add_argument("--replay", default="", help="JSONL capture to replay instead of the band")
    p_run.add_argument("--speed", type=float, default=1.0)
    p_run.add_argument("--dry-run", action="store_true", help="print envelopes, do not POST")

    p_enroll = sub.add_parser("enroll")
    p_enroll.add_argument("--address", required=True)
    p_enroll.add_argument("--user", required=True)
    p_enroll.add_argument("--seconds", type=float, default=300.0)

    args = parser.parse_args()
    if args.cmd == "run" and not args.address and not args.replay:
        parser.error("run needs --address or --replay")
    try:
        return asyncio.run(run(args) if args.cmd == "run" else enroll(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
