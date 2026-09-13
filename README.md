<p align="center">
  <img src="logo.png" alt="Araxia" width="280" />
</p>

<p align="center"><b>A passkey approves one exact action. A wearable has to still be on a human when the agent executes it.</b></p>

Araxia is a presence-conditioned, action-bound authorization protocol built at
HackRice 16 (Finance track). An AI agent can propose a payment, but nothing
moves unless (1) a WebAuthn passkey signs the digest of that exact action and
(2) a Fitbit Air heart-rate stream is still `READY` at the moment of execution.
The bank never sees a heartbeat; it sees a signed assertion it can verify offline.

Repo: https://github.com/kushwahaamar-dev/araxia

- What we claim, and what we refuse to claim: [`docs/CLAIMS.md`](docs/CLAIMS.md)
- Measured hardware facts (GATT surface, off-wrist behaviour, thresholds): [`capture/hardware_gate.md`](capture/hardware_gate.md)
- Prize/challenge mapping: [`docs/challenges.md`](docs/challenges.md)
- Devpost copy: [`docs/devpost.md`](docs/devpost.md)

## How it works

```
Fitbit Air ──BLE 0x180D──▶ bridge (Python) ──signed window stats──▶ Araxia service (Next.js)
                                                                        │
      agent / Gemini proposes ─▶ server revalidates ─▶ action digest ───┤
      passkey (Touch ID) signs the digest ─▶ Ed25519 assertion ─────────┤
                                                                        ▼
                                          presence READY? ──▶ executor ──▶ Nessie / Solana devnet
```

1. **Presence.** The bridge subscribes to the band's Heart Rate Service and
   computes presence from *variation*, not packet arrival. The Air keeps
   sending its last BPM forever after it comes off the wrist, so a frozen value
   for 8 s flips the state to `STALE`. Raw BPM never leaves the machine; the
   service receives Ed25519-signed window statistics.
2. **Action.** Manual form or Gemini proposal. The server rebuilds the
   canonical action (op, payee, amount, currency, nonce, expiry) against its
   own allowlist. Prompt injection cannot add a payee.
3. **Approval.** The WebAuthn challenge *is* the action digest. Touch ID signs
   it; the issuer wraps the result in an Ed25519 assertion over RFC 8785
   canonical JSON. Change one byte and verification fails.
4. **Execution.** The assertion is single-use (nonce claimed atomically) and
   presence is re-checked immediately before the executor runs. Rails:
   Capital One Nessie sandbox and Solana devnet (memo binds the nonce; every
   signature opens on Solscan).
5. **Verification.** `npx araxia-verify assertion assertion.json --issuer <hex>`
   checks any exported assertion with no access to our service.

### Team handoff

Several people can share one band. Persona (sandbox) gates passkey enrollment;
the console shows who has a passkey and lets a teammate verify, enrol, and
take over the wearer session. When the stream breaks and resumes on a
different-looking wearer, approvals halt until someone switches explicitly.

### Small One (`/bank`)

A fictional consumer bank UI on the same protocol: pick a rail, write a memo,
approve with Touch ID, execute. Nessie records every transfer, but its sandbox
leaves seeded balances frozen (verified live; `payee_id` is rejected by the
current `TransferCreate` schema). The displayed balance overlays Araxia's
confirmed settlements on the seeded figure and says so on screen.

## Run it (localhost, macOS)

```bash
git clone --recurse-submodules https://github.com/kushwahaamar-dev/araxia.git
cd araxia

# 1. Bridge
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
# Google Health app → Connections → Fitbit Air → Share heart rate ON, "Always visible" ON.
# First connection only: tap "Get started" in the app while the Mac is connected.
python -m bridge.main run --address <BLE-UUID> --user u_amar --register

# 2. Service (second terminal)
cd web
cp .env.example .env.local        # fill NESSIE_API_KEY, account ids, and any optional rails
npm install
npm run dev                       # http://localhost:3000  (console)  ·  /bank (Small One)
```

Grant Bluetooth permission to Terminal when macOS asks. `scripts/scan_ble.py`
prints the band's CoreBluetooth UUID once heart-rate sharing is on.

In the console: register a passkey, create `$45 to RENT`, Approve with Touch
ID, Execute. Open `./attack` to mutate the amount, replay the assertion, or
take the band off and watch the approval blocker appear within ~8 s.

### Tests

```bash
npm test                 # @araxia/verify (30) + web (90)
python -m pytest         # bridge (45)
```

## Layout

| Path | What |
|---|---|
| `bridge/` | BLE collector, HRS decoder, variation-based presence, wearer/handoff model, signed envelopes |
| `packages/verify/` | Independent assertion/envelope verifier and the `araxia-verify` CLI (shared test vectors with the bridge) |
| `web/` | Next.js service: passkeys, policy, Ed25519 issuer, Nessie + Solana executors, Gemini propose, Persona KYC, TigerData replica, console and Small One UI |
| `docs/` | Claims matrix, challenge mapping, Devpost copy, Notability shot list |
| `capture/` | Scan/GATT JSON, heart-rate captures, `hardware_gate.md`, Android HCI notes |
| `scripts/` | BLE research tooling (below) |
| `Dockerfile` | Builds the web service (`next build`), used for the Vultr evidence image |
| `vendor/` | Reference-only RE material for older Fitbit / Mi Band stacks |

## Trust boundary, plainly

- Root of trust: the passkey and the issuer's Ed25519 key.
- Condition: fresh `READY` evidence from an enrolled bridge key, checked at approval and again at execution.
- The bridge is a trusted collector. Envelope signatures stop replay and tampering on the wire; they do not prove the sensor.
- The per-wearer BPM model only lowers assurance (step-up). It never grants and it never identifies.
- Wearable = liveness. Passkey = identity. Heart rate is not a password.

## Hardware research tooling

Everything under `scripts/` was used to characterise the 2026 Fitbit Air
(model 67). Results are in `capture/hardware_gate.md`.

```bash
python scripts/scan_ble.py --seconds 15          # find the band, flag Fitbit-like adverts
python scripts/dump_gatt.py <ADDRESS> --read     # GATT tree → capture/gatt.json, dump.txt
python scripts/sniff_notify.py <ADDRESS> --seconds 45
python scripts/wait_for_hr.py                    # block until 0x180D is advertised
python scripts/hr_stream.py <ADDRESS> --label worn --seconds 120   # decode 0x2A37 → JSONL
```

Findings that shaped the design: the Air exposes only a smoothed BPM integer
at ~0.5 Hz effective rate (no RR intervals, no skin-contact bit, no
temperature, no motion), and it freezes on the last value when removed
instead of stopping. Phone↔tracker sync is encrypted; see
`capture/android_hci_snoop.md`. Only use these tools on hardware you own.
