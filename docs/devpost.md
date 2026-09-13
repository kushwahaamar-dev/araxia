# Devpost copy — Araxia

Paste-ready. Every sentence here is backed by `CLAIMS.md`; do not add claims
on the form that are not in that file.

## General info

**Project name:** Araxia

**Elevator pitch** (≤200 chars, pick one):

1. `A passkey approves one exact payment. A wearable proves a human is still there when the agent sends it. The bank never sees a heartbeat.` (136)
2. `Presence-conditioned, action-bound authorization for AI agents: passkey signs the exact action, Fitbit presence must be live at execution.` (138)
3. `Human vs bot, settled: agents propose, passkeys approve one exact action, and a live wearable has to be on a wrist when money moves.` (132)

**Thumbnail:** the `READY` frame from the console works. 3:2 crop.

## About the project

### Inspiration

Agents are starting to hold payment credentials. Today's answer is a session
token: log in once, and everything the agent does for the next hour is
"you". That is the wrong shape for money. We wanted an authorization that is
tied to one exact action and to a human being physically present at the
moment it executes, without turning heart rate into a password.

### What it does

Araxia issues and enforces presence-conditioned, action-bound authorizations.

- An agent (or Gemini) proposes a payment. The server rebuilds it against its
  own payee allowlist, so prompt injection cannot add a recipient.
- A WebAuthn passkey (Touch ID) signs the digest of that exact action. The
  issuer wraps it in an Ed25519 assertion over canonical JSON. Change one
  byte, verification fails.
- A Fitbit Air streams heart rate over BLE to a local bridge. The bridge
  computes *presence* from variation, not packet arrival, because the band
  keeps sending its last value forever after it comes off the wrist. Frozen
  for 8 seconds means `STALE`.
- Execution claims the nonce once, re-checks presence, then runs the rail:
  Capital One Nessie sandbox or Solana devnet (memo binds the nonce; every
  signature opens on Solscan).
- Anyone can verify an exported assertion offline with `npx araxia-verify`.

Several teammates can share one band. Persona gates passkey enrollment; the
console shows who is enrolled and lets a teammate take over the wearer
session. A stream break followed by a different-looking wearer halts
approvals until someone switches explicitly.

"Small One" (`/bank`) is a consumer-bank UI on the same protocol: choose a
rail, write a memo, approve with Touch ID, execute.

### How we built it

- **Hardware first.** We reverse-mapped the 2026 Fitbit Air's GATT surface
  with `bleak` on macOS: only Heart Rate Service `0x180D`, packets always
  `01 <bpm>`, no RR intervals, no skin-contact bit, no battery service. The
  proprietary sync channel is encrypted and untouched. All of it is in
  `capture/hardware_gate.md` with the raw captures.
- **Bridge (Python).** Strict HRS decoder, variation-based presence state
  machine (`READY` / `WARMING` / `STALE` / `DISCONNECTED`), per-wearer
  volatility model that can only *lower* assurance, Ed25519-signed window
  statistics. Raw BPM never leaves the laptop.
- **Service (Next.js 16, SQLite).** WebAuthn with the action digest as the
  challenge, Ed25519 issuer, RFC 8785 canonicalization, atomic nonce claim,
  presence check at approval and again at execution, Nessie and Solana
  executors, Gemini proposal with server-side revalidation, Persona hosted
  inquiry for enrollment, TigerData replica of the audit trail.
- **Verifier (`@araxia/verify`).** Standalone package + CLI sharing test
  vectors with the Python bridge, so a third party can check an assertion
  without our service.
- 165 automated tests across the three parts.

### Challenges we ran into

- The band lies. Off-wrist it does not stop; it freezes on the last BPM at
  1 Hz. A naive "packets arriving = human present" check is defeated by a
  band on a desk. We had to define presence by variation and measure the
  longest genuine worn plateau to pick the threshold.
- Nessie's current `TransferCreate` schema has no payee field and does not
  move seeded balances (we verified this live; `payee_id` is rejected). We
  bind the destination in the description, record every transfer, and
  overlay our confirmed settlements on the displayed balance, with the UI
  saying exactly that.
- Nessie has no idempotency key, so a timeout is `UNCERTAIN`, not a retry.
- macOS CoreBluetooth cannot initiate a bond from code; the one-time
  "Get started" confirmation has to happen in Google Health while connected.
- Multiple wearers on one band produce overlapping BPM ranges. We stopped
  guessing identity from BPM and made handoff explicit: halt on a break plus
  mismatch, switch under passkey.
- Hydration and rate-limit bugs the night before, the usual.

### Accomplishments that we're proud of

- A measured, documented hardware finding (off-wrist freeze) that changed the
  design instead of a hand-waved "biometric".
- One assertion, two rails: the same signed document executes on Nessie and
  on Solana devnet with the nonce in the memo.
- Twelve mutation tests plus a claim-once concurrency test (8 threads × 25
  attempts → exactly one execution).
- A claims matrix we can stand behind, including the column of things we
  refuse to say.

### What we learned

- Liveness and identity are different problems. The wearable answers "is a
  human still here"; the passkey answers "which one". Mixing them produces
  marketing, not security.
- Read the device before designing around it. Ten minutes with a GATT dump
  saved us from building on signals the Air does not emit.
- Sandboxes have their own truths. Say what the sandbox actually does on
  screen instead of faking the number.

### What's next

- Attestation for the bridge signer (TEE or secure element) so the collector
  is no longer a trusted party.
- Step-up policies per amount and payee, with the wearer model as one input.
- A real bank rail with idempotency keys so `UNCERTAIN` can reconcile itself.
- ElevenLabs spoken verdicts and a Backboard memory of denials, only once
  they actually run.

## Built with

`python` `bleak` `corebluetooth` `ed25519` `webauthn` `passkeys` `typescript`
`next.js` `react` `sqlite` `better-sqlite3` `zod` `vitest` `pytest`
`capital-one-nessie` `solana` `@solana/web3.js` `solscan` `gemini`
`persona` `tigerdata` `timescaledb` `google-health-api` `docker` `vultr`

Tag only what ran. Do not tag MathWorks, Presage, ElevenLabs, or Backboard.

## Links

- GitHub: https://github.com/kushwahaamar-dev/araxia
- Claims matrix: https://github.com/kushwahaamar-dev/araxia/blob/main/docs/CLAIMS.md
- Hardware findings: https://github.com/kushwahaamar-dev/araxia/blob/main/capture/hardware_gate.md
- Video: (add after upload)
