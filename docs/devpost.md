# Devpost copy — Araxia

Internal notes first. The **Paste into Devpost** section below is the
description body: Markdown + a little LaTeX in Devpost’s `\\(...\\)` /
`$$...$$` form. Every claim is backed by [`CLAIMS.md`](CLAIMS.md).

## General info (form fields)

| Field | Value |
| --- | --- |
| **Project name** | Araxia |
| **Elevator pitch (recommended)** | A passkey approves one exact payment. A wearable proves a human is still there when the agent sends it. The bank never sees a heartbeat. |
| **Pitch length** | 136 characters |
| **Thumbnail** | Console `READY` frame, crop 3:2 |

**Alternates** (≤200 chars):

1. Presence-conditioned, action-bound authorization for AI agents: passkey signs the exact action, Fitbit presence must be live at execution. (138)
2. Human vs bot, settled: agents propose, passkeys approve one exact action, and a live wearable has to be on a wrist when money moves. (132)

**Tag only what ran:** python, bleak, ed25519, webauthn, passkeys, typescript, next.js, react, sqlite, capital-one-nessie, solana, gemini, persona, tigerdata, google-health-api, docker, vultr.

**Do not tag:** MathWorks, Presage, ElevenLabs, Backboard.

**Links**

- [GitHub](https://github.com/kushwahaamar-dev/araxia)
- [Claims matrix](https://github.com/kushwahaamar-dev/araxia/blob/main/docs/CLAIMS.md)
- [Hardware findings](https://github.com/kushwahaamar-dev/araxia/blob/main/capture/hardware_gate.md)
- Video: *(add after upload)*

---

## Paste into Devpost

Copy each block into the matching Devpost field. Or paste everything under
“Inspiration” onward into a single description if the form is one box.

### Inspiration

Agents are starting to hold payment credentials. Today’s answer is a **session token**: log in once, and everything the agent does for the next hour is “you.” That is the wrong shape for money.

We wanted an authorization that is tied to **one exact action** and to a **human being physically present** at the moment it executes — without turning heart rate into a password.

> Wearable = liveness. Passkey = identity. The bank never sees a heartbeat.

### What it does

**Araxia** issues and enforces *presence-conditioned, action-bound* authorizations.

1. An agent (or **Gemini**) proposes a payment. The server rebuilds it against its own payee allowlist, so prompt injection cannot add a recipient.
2. A **WebAuthn passkey** (Touch ID) signs the digest of that exact action. The issuer wraps it in an **Ed25519** assertion over canonical JSON. Change one byte and verification fails.
3. A **Fitbit Air** streams heart rate over BLE to a local bridge. The bridge computes *presence* from **variation**, not packet arrival — because the band keeps sending its last value forever after it comes off the wrist.
4. Execution **claims the nonce once**, re-checks presence, then runs the rail: **Capital One Nessie** sandbox or **Solana** devnet (memo binds the nonce; every signature opens on Solscan).
5. Anyone can verify an exported assertion offline:

```bash
npx araxia-verify assertion assertion.json --issuer <hex>
```

**Presence rule (measured, not assumed).** Off-wrist the Air freezes BPM at 1 Hz instead of stopping. We mark the stream stale when the same value persists for at least eight seconds:

$$
\\mathrm{STALE} \\iff \\text{same BPM for } t \\ge 8\\,\\mathrm{s}
$$

Several teammates can share one band. **Persona** gates passkey enrollment; the console shows who is enrolled and lets a teammate take over the wearer session. A stream break followed by a different-looking wearer **halts** approvals until someone switches explicitly.

**Small One** (`/bank`) is a consumer-bank UI on the same protocol: choose a rail, write a memo, approve with Touch ID, execute.

Nessie records every transfer we post, but its sandbox leaves seeded balances frozen (verified live; `payee_id` is rejected). The displayed balance overlays Araxia’s confirmed settlements — and the UI says so.

### How we built it

| Layer | Stack | Job |
| --- | --- | --- |
| Hardware | Fitbit Air + `bleak` on macOS | GATT map of Heart Rate Service `0x180D`; packets always `01 <bpm>` |
| Bridge | Python, Ed25519 | HRS decoder, presence state machine, signed window stats (raw BPM never leaves the laptop) |
| Service | Next.js 16, SQLite, WebAuthn | Action digest as challenge, atomic nonce claim, presence check at approval *and* execution |
| Rails | Nessie + Solana + Gemini + Persona + TigerData | Propose, enroll, settle, audit |
| Verifier | `@araxia/verify` CLI | Third party checks an assertion with no access to our service |

Presence states: `READY` · `WARMING` · `STALE` · `DISCONNECTED`.

The per-wearer BPM model can only **lower** assurance (step-up). It never grants and it never identifies.

**165 automated tests** across bridge, service, and verifier (including 12 mutation tests and a claim-once concurrency test: 8 threads \\(\\times\\) 25 attempts \\(\\rightarrow\\) exactly one execution).

Raw captures and thresholds live in [`capture/hardware_gate.md`](https://github.com/kushwahaamar-dev/araxia/blob/main/capture/hardware_gate.md).

### Challenges we ran into

- **The band lies.** Off-wrist it does not stop; it freezes on the last BPM. A naive “packets arriving = human present” check is defeated by a band on a desk. We defined presence by variation and measured the longest genuine worn plateau before picking \\(t = 8\\,\\mathrm{s}\\).
- **Nessie’s `TransferCreate` schema** has no payee field and does not move seeded balances. We bind the destination in the description, record every transfer, and overlay confirmed settlements on the displayed balance.
- **No idempotency key** on Nessie → a timeout is `UNCERTAIN`, not a retry.
- **macOS CoreBluetooth** cannot initiate a bond from code; the one-time “Get started” confirm has to happen in Google Health while connected.
- **Overlapping BPM ranges** across wearers. We stopped guessing identity from BPM and made handoff explicit: halt on break + mismatch, switch under passkey.
- Hydration and rate-limit bugs the night before — the usual.

### Accomplishments that we're proud of

- A **measured** hardware finding (off-wrist freeze) that changed the design, not a hand-waved “biometric.”
- **One assertion, two rails:** the same signed document executes on Nessie and on Solana with the nonce in the memo.
- **Claim-once** under concurrency plus mutation tests that break if any assertion field changes.
- A [claims matrix](https://github.com/kushwahaamar-dev/araxia/blob/main/docs/CLAIMS.md) we can stand behind — including the column of things we refuse to say.

### What we learned

- **Liveness and identity are different problems.** The wearable answers “is a human still here?”; the passkey answers “which one?” Mixing them produces marketing, not security.
- **Read the device before designing around it.** Ten minutes with a GATT dump saved us from building on signals the Air does not emit (no RR intervals, no skin-contact bit, no temperature).
- **Sandboxes have their own truths.** Say what the sandbox actually does on screen instead of faking the number.

### What's next

- Attestation for the bridge signer (TEE / secure element) so the collector is no longer a trusted party.
- Step-up policies per amount and payee, with the wearer model as one input.
- A real bank rail with idempotency keys so `UNCERTAIN` can reconcile itself.
- Spoken verdicts / denial memory — only once those integrations actually run.

---

### Flow (optional gallery caption)

```
Fitbit Air ──BLE──▶ bridge ──signed stats──▶ Araxia
agent proposes ─▶ passkey signs digest ─▶ presence READY? ─▶ Nessie / Solana
```
