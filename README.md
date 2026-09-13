<p align="center">
  <img src="logo.png" alt="Araxia" width="280" />
</p>

A presence-conditioned, action-bound authorization protocol. A passkey approves
an exact action; a Fitbit Air stream must still be `READY` when the agent
executes. The bank never sees a heartbeat.

Repo: https://github.com/kushwahaamar-dev/araxia

Claims we make, and the ones we do not: [`docs/CLAIMS.md`](docs/CLAIMS.md).
Hardware facts: [`capture/hardware_gate.md`](capture/hardware_gate.md).

## Demo (localhost)

```bash
# 1. Python bridge
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
# Google Health → Connections → Fitbit Air → Share heart rate ON (Always visible).
# First connection only: tap Get started while the Mac is connected.
python -m bridge.main run --address <BLE-UUID> --user u_amar --register

# 2. Service (other terminal)
cd web
cp .env.example .env.local   # fill NESSIE_API_KEY and account ids
npm install
npm run dev                  # http://localhost:3000
```

Register a passkey in the console, create `$45 to RENT`, Approve with Touch ID,
Execute. Attack lab: mutate amount, replay, take the band off and wait 30 s.

```bash
# Independent verifier (after you download assertion.json from the console)
npx araxia-verify assertion assertion.json --issuer <issuer public hex>
```

```bash
git clone --recurse-submodules https://github.com/kushwahaamar-dev/araxia.git
```

## Layout

| Path | What |
|---|---|
| `bridge/` | BLE collector, presence, wearer model, signed envelopes |
| `packages/verify/` | Independent assertion/envelope verifier + `araxia-verify` CLI |
| `web/` | Next.js service, passkeys, policy, Nessie executor, console |
| `docs/CLAIMS.md` | What we claim and what we do not |
| `scripts/scan_ble.py` | Scan nearby BLE; flag Fitbit-like ads |
| `scripts/dump_gatt.py` | Connect + dump GATT tree → `dump.txt` |
| `scripts/sniff_notify.py` | Subscribe to notify/indicate and log payloads |
| `scripts/wait_for_hr.py` | Block until a device advertises Heart Rate Service `0x180D` |
| `scripts/hr_stream.py` | Decode live `0x2A37` heart-rate packets to JSONL with summary stats |
| `capture/hardware_gate.md` | Measured facts: what the Air exposes, off-wrist behaviour, thresholds |
| `capture/` | Scan/GATT JSON, HR captures, Android HCI snoop notes |
| `vendor/fitness-app` | SEEMOO Fitbit Android RE (older models) |
| `vendor/BreakMi` | BLE fitness toolkit (Mi Band + some Fitbit Charge 2) |

Older vendor tools are **reference only**. Fitbit Air (2026 / GW9C8) uses a newer stack; expect encrypted sync payloads.

## Setup (macOS)

```bash
cd /Users/amar/Codes/ak/rice
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Grant **Bluetooth** permission to Terminal when macOS prompts.

## Workflow

```bash
# 1) Find the Air (put it in pairing / wake it; keep phone sync idle if possible)
python scripts/scan_ble.py --seconds 15

# 2) Dump GATT (use address/UUID from scan.json)
python scripts/dump_gatt.py <ADDRESS> --read

# 3) Live notify sniff while you move / wait for HR updates
python scripts/sniff_notify.py <ADDRESS> --seconds 45

# 4) Live heart rate. In Google Health: Connections -> Fitbit Air -> Share heart rate ON.
#    First connection only: tap "Get started" / confirm in the app while connected.
python scripts/wait_for_hr.py            # prints the address once 0x180D is advertised
python scripts/hr_stream.py <ADDRESS> --label worn --seconds 120
```

Outputs:

- `capture/scan.json`
- `capture/gatt.json`
- `dump.txt` (human-readable GATT)
- `capture/notify.log`

## Full sync packets (Android)

Phone↔tracker sync is hard to MITM from Mac alone. See `capture/android_hci_snoop.md`.

## Notes

- Only use this on hardware you own.
- If scan finds nothing: Air may be bonded only to the phone and not advertising. Unpair briefly, or capture HCI on the phone during sync.
