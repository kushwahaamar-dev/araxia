# Devpost copy — Araxia

Internal notes first. The **Paste into Devpost** section below is the
description body: Markdown + a little LaTeX in Devpost’s `\\(...\\)` /
`$$...$$` form. Every claim is backed by [`CLAIMS.md`](CLAIMS.md).

**Positioning:** Araxia is a **protocol / security layer**, not a bank app.
The console and Small One are *reference use cases* that prove the layer
works on real rails. Pitch the layer; demo the product on top.

## General info (form fields)

| Field | Value |
| --- | --- |
| **Project name** | Araxia |
| **Elevator pitch (recommended)** | A presence-conditioned, action-bound auth protocol: passkey signs one exact action; wearable liveness must hold at execute. Drop it under any agentic product. |
| **Pitch length** | 158 characters |
| **Thumbnail** | Console `READY` frame, crop 3:2 |

**Alternates** (≤200 chars):

1. Protocol, not product: WebAuthn binds one action; Fitbit presence re-checks at execution. A security layer for agentic money, ops, or access — bank never sees a heartbeat. (178)
2. Araxia is an authorization layer: approve exact actions with a passkey, enforce human presence with a wearable, verify offline. Demos on Nessie and Solana prove the rails. (171)
3. A passkey approves one exact payment. A wearable proves a human is still there when the agent sends it. The bank never sees a heartbeat. (136) — product-flavored; use only if you want finance-first.

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

Agents are starting to hold credentials for money, tools, and accounts. The default pattern is still a **session token**: authenticate once, then everything the agent does for the next hour is “you.” That is the wrong shape for high-stakes actions.

We did not set out to build another bank. We set out to build an **authorization protocol** — a layer any product can sit on — where:

1. approval is bound to **one exact action**, and
2. **human presence** is still required when that action executes,

without turning heart rate into a password or shipping physiology to the provider.

> Wearable = liveness. Passkey = identity. Downstream apps verify a signed assertion; they never see a heartbeat.

### What it does

**Araxia is a presence-conditioned, action-bound authorization protocol.**

It is meant to sit **under** agentic products — banking, payments, ops tooling, privileged access — as the security / authentication / enforcement layer. The product proposes; Araxia decides whether that exact proposal may run.

**Protocol guarantees**

1. **Action-bound approval.** A WebAuthn passkey (Touch ID) signs the digest of a canonical action (op, destination, amount, currency, nonce, expiry). The issuer wraps it in an **Ed25519** assertion over canonical JSON. Change one byte and verification fails.
2. **Presence-conditioned execution.** A wearable (Fitbit Air over BLE) feeds a local bridge that computes *presence* from **variation**, not packet arrival. Presence is checked at approval and again immediately before execute. No live human → no execution.
3. **Single-use.** The assertion nonce is claimed atomically. Replay fails.
4. **Offline verifiable.** Downstream systems (or a judge) can check an exported assertion without trusting our UI:

```bash
npx araxia-verify assertion assertion.json --issuer <hex>
```

**Presence rule (measured, not assumed).** Off-wrist the Air freezes BPM at 1 Hz instead of stopping. We mark the stream stale when the same value persists for at least eight seconds:

$$
\\mathrm{STALE} \\iff \\text{same BPM for } t \\ge 8\\,\\mathrm{s}
$$

**What a product plugs in**

| Hook | Role |
| --- | --- |
| Propose | Agent / UI builds intent; server revalidates against *its* allowlist (Gemini demo: prompt injection cannot add a payee) |
| Approve | Passkey ceremony bound to the action digest |
| Evidence | Enrolled bridge posts signed window stats (raw BPM never leaves the laptop) |
| Execute | Claim nonce → re-check `READY` → call *your* rail |
| Verify | Independent verifier package / CLI |

**Reference use cases (not the product)**

- **tty console** (`/`) — protocol control plane: presence, team handoff, attack lab.
- **Small One** (`/bank`) — fictional bank *on top of* Araxia: same assertion, two rails (**Nessie** sandbox + **Solana** devnet). Proves the layer is rail-agnostic.
- **Persona** gates passkey enrollment; teammates share one band with explicit, passkey-gated handoff.

Nessie records every transfer we post, but its sandbox leaves seeded balances frozen (verified live). The demo overlays confirmed settlements on the displayed balance and says so — honesty is part of the protocol story.

### How we built it

| Layer | Stack | Job |
| --- | --- | --- |
| Hardware | Fitbit Air + `bleak` on macOS | GATT map of Heart Rate Service `0x180D`; packets always `01 <bpm>` |
| Bridge | Python, Ed25519 | HRS decoder, presence state machine, signed window stats |
| Protocol service | Next.js 16, SQLite, WebAuthn | Digest-as-challenge, atomic nonce claim, dual presence check |
| Reference apps | Console + Small One | Show the layer under a real UX |
| Example rails | Nessie + Solana + Gemini + Persona + TigerData | Propose, enroll, settle, audit |
| Verifier | `@araxia/verify` CLI | Third party checks an assertion with no access to our service |

Presence states: `READY` · `WARMING` · `STALE` · `DISCONNECTED`.

The per-wearer BPM model can only **lower** assurance (step-up). It never grants and it never identifies.

**165 automated tests** across bridge, service, and verifier (including 12 mutation tests and a claim-once concurrency test: 8 threads \\(\\times\\) 25 attempts \\(\\rightarrow\\) exactly one execution).

Raw captures and thresholds: [`capture/hardware_gate.md`](https://github.com/kushwahaamar-dev/araxia/blob/main/capture/hardware_gate.md). Claims we make and refuse: [`CLAIMS.md`](https://github.com/kushwahaamar-dev/araxia/blob/main/docs/CLAIMS.md).

### Challenges we ran into

- **Protocol vs product temptation.** Judges see a bank UI first. We kept Small One as a *reference app* and the tty as the control plane so the layer stays legible.
- **The band lies.** Off-wrist it freezes on the last BPM. A naive “packets arriving = human present” check fails. We defined presence by variation and measured the worn plateau before picking \\(t = 8\\,\\mathrm{s}\\).
- **Nessie’s `TransferCreate` schema** has no payee field and does not move seeded balances. Destination lives in the description; displayed balances are settlement-overlaid and labeled honestly.
- **No idempotency key** on Nessie → timeout is `UNCERTAIN`, not a retry (protocol-level honesty about rail failure modes).
- **macOS CoreBluetooth** cannot bond from code; one-time “Get started” in Google Health while connected.
- **Overlapping BPM ranges** across wearers → no identity-from-BPM. Handoff is explicit: halt on break + mismatch, switch under passkey.

### Accomplishments that we're proud of

- A **protocol** with a clear trust boundary: passkey + issuer key as root; wearable as a *condition*, not a biometric password.
- A **measured** hardware finding (off-wrist freeze) that shaped the presence machine.
- **Rail-agnostic assertions:** one signed document executes on Nessie and Solana (nonce in the Solana memo).
- **Claim-once** under concurrency + mutation tests; an independent verifier so the layer is not “trust our server.”
- A [claims matrix](https://github.com/kushwahaamar-dev/araxia/blob/main/docs/CLAIMS.md) that includes what we refuse to say.

### What we learned

- **Ship a layer, demo a product.** The bank proves usefulness; the protocol is what another team would integrate.
- **Liveness ≠ identity.** Wearable answers “is a human still here?”; passkey answers “which one?”
- **Read the device.** GATT dump first: the Air has no RR intervals, no skin-contact bit, no temperature. Design around what exists.
- **Sandboxes have their own truths.** Say what the rail actually does.

### What's next

- Attestation for the bridge signer (TEE / secure element) so the collector is no longer a trusted party.
- Drop-in SDKs / policy packs so any app can propose → approve → execute without forking our console.
- Step-up policies per amount and destination, with the wearer model as one input.
- Rails with real idempotency so `UNCERTAIN` can reconcile itself.
- More reference apps (ops agents, privileged access) once the finance demo has earned trust.

---

### Flow (optional gallery caption)

```
any product ──propose──▶ Araxia protocol
wearable ──presence──▶│  passkey signs exact action
                      └── READY? ──▶ your rail (Nessie / Solana / …)
```
