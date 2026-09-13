# Araxia — demo keycast

Teleprompter for the live demo and the 3–4 min video.  
**Say the bold lines out loud.** `[BRACKETS]` are stage directions — don’t read them.

**Positioning:** protocol / security layer. Small One and the tty are *reference apps*.

---

## Hard rails (don’t break character past these)

You **can** LARP: stakes, agent threat model, “talking to the agent,” what presence *feels* like, naming every sensor channel we *can see* on screen (BLE + Google Health panel), drama on STALE / halt / attack lab.

You **cannot** claim as true:

- Heartbeat-as-password / biometric unlock of the bank
- RR intervals, ECG, skin-contact bit, temperature, SpO₂ from the Air BLE stream (the GATT dump shows they are not there)
- That Nessie *moved* the seeded $5000 field (it records transfers; we overlay settlements)
- That BPM *identifies* who is wearing the band (hint → halt only)
- Persona sandbox = real government ID proof
- Solana mainnet / real money
- HIPAA, TEE attestation (future, not shipped)

**Honest one-liner if a judge presses:**  
*“Wearable is liveness. Passkey is identity. The bank never sees a heartbeat — it verifies a signed assertion.”*

---

## Pre-flight (T−2 min, mute / off-camera)

- [ ] Share HR ON in Google Health (“Always visible”)
- [ ] Bridge RUNNING → console shows **READY**, drift NOMINAL
- [ ] Active wearer **Amar**, halt **false**
- [ ] Passkey enrolled (Amar); Jagrati optional for handoff beat
- [ ] `/` and `/bank` load; Nessie payees RENT/SAVINGS resolve
- [ ] Solana panel shows lamports (optional second rail)
- [ ] Browser: localhost:3000, Touch ID ready, no DevTools overlay
- [ ] Hotspot / BLE not starving

**If DISCONNECTED:** restart bridge; wait for WARMING → READY (~20–30 s after re-wear).

---

## Short cut — video / judges (≈3:30)

### 0:00 — Hook `[on /]`

**Araxia is not a bank. It’s an authorization protocol — a layer you drop under any agentic product.**

**Agents are about to hold payment credentials. Today’s answer is a session token: log in once, and for the next hour everything the agent does is “you.” That’s the wrong shape for money.**

**We bind approval to one exact action, and we require a human body still on the wrist when that action executes. The bank never sees a heartbeat.**

### 0:25 — Sensors `[point at presence + Fitbit panel]`

**This is a Google Fitbit Air. We reverse-mapped its BLE surface. Over the air we get Heart Rate Service — packets like `01`, then a BPM integer, about once a second.**

**What we do *not* get on that pipe: no beat-to-beat RR intervals, no skin-contact flag, no temperature. We measured that. So we don’t pretend.**

**What we *do* use for the gate is variation in that BPM stream. Off-wrist, this band lies — it freezes on the last value forever. Packets keep arriving. A naive “still connected” check fails. We flip STALE after about eight seconds frozen. Measured, not marketing.**

**On the side you also see Google Health cloud context — resting rate, latest intraday, the fuller body picture. We can show it. We do not put raw physiology in the trust boundary. The bridge ships signed *window statistics* only. Raw BPM stays on this laptop.**

### 0:55 — Talk to the agent `[/ → ./gemini  OR  narrate then cut to /bank]`

**I’m going to talk to the agent like a user would.**

`[CLICK ./gemini]`  
**“Pay forty-five dollars rent.”**  
`[SUBMIT]`

**Gemini proposes. Watch — it never decides. Our server rebuilds the action against *our* payee allowlist. Prompt injection cannot invent a recipient. The model is outside the trust boundary.**

### 1:15 — Approve `[Touch ID]`

**Passkey time. The WebAuthn challenge *is* the digest of this exact action — amount, payee, rail, nonce, expiry. Touch ID.**

`[APPROVE — Face/Touch ID]`

**That becomes an Ed25519 assertion over canonical JSON. Change one byte, verification fails. Single-use nonce — claim it once or it dies.**

### 1:35 — Execute + rails

**Presence is checked again at execute — not only at approve. Still READY? Send.**

`[EXECUTE]`

**Capital One Nessie records the transfer. Honest beat: their sandbox leaves the seeded balance field frozen — we verified that live. What you see moving is Araxia’s settlement overlay on top of that seed, labeled on screen.**

`[OPTIONAL: switch rail / show Solana panel]`  
**Same assertion shape, second rail — Solana devnet. Nonce in the memo. Signature opens on Solscan. Rail-agnostic protocol.**

### 2:10 — Product on the layer `[/bank]`

**Small One is a fake consumer bank *on top of* the same protocol. Choose rail, memo, instruct, approve, execute. This is the reference app. The protocol is what you’d integrate.**

`[Instruct transaction → opens /?focus=latest if useful]`

### 2:30 — Attack lab `[/ → ./attack]`

**Mutate the amount after approval.**  
`[run amount-mutation attack]`  
**Assertion dies. Good.**

**Band off the wrist.**  
`[remove Fitbit, wait ~8 s]`  
**STALE. Approvals block. That’s the whole point — a band on the desk cannot authorize.**

`[put band back — wait READY]`

### 3:00 — Close

**Wearable equals liveness. Passkey equals identity. Presence-conditioned, action-bound authorization — a layer for agentic products, not a session token with vibes.**

**Araxia. Thank you.**

---

## Long cut — live booth (≈6–8 min, LARP expanded)

Use when judges linger. Same hard rails.

### Opening (protocol)

**Imagine an ops agent with your corporate card. Or a payments agent with ACH. Or a trading agent. One OAuth grant and it’s “you” until expiry.**

**Araxia is the enforcement layer underneath: propose → approve *this* digest → execute only if presence is still READY. Drop it under banking, under privileged access, under anything that shouldn’t run on a ghost session.**

### Sensor deep dive (LARP the atmosphere; stay factual on the pipe)

**Optical PPG on the Air — green LEDs, photodiode, a smoothed heart-rate integer on BLE notify. One hertz. Flags byte is basically always the same in our captures. That’s the live gate.**

**We also pulled Google Health — resting heart rate, intraday series, the cloud-side fitness graph. That’s the *story of the body* judges can see on the Fitbit panel. The *authorization condition* is narrower on purpose: signed window stats from the bridge, variation analysis, READY / WARMING / STALE / DISCONNECTED.**

**If we talked like a sci-fi deck we’d say HRV, stress, SpO₂, skin temp. Those are not on this BLE characteristic. We refuse to claim them. What we *do* claim is continuity of a living wrist — because a corpse of a desk-band freezes the number and we catch that.**

**Per-wearer volatility model: enrolled under passkey. If the stream goes wilder than that wearer’s bound, we *lower* assurance — step-up. It never grants. It never IDs you among a crowd. BPM ranges overlap; that’s why handoff is explicit.**

### Talk to the AI agent (voice-friendly)

**I’m not filling a form first. I’m talking to the agent.**

> “Hey — pay this month’s rent, forty-five dollars, to RENT.”

`[./gemini → submit]`

**That’s generative AI in the loop — Gemini Flash, structured JSON out. Then our code does the unsexy part: revalidate op, payee, cents, currency. Agent proposes. Protocol decides whether a human may bind it.**

### Passkey + assertion theater

**Touch ID. Feel that? You’re not unlocking a session. You’re signing *one* payment-shaped document.**

**Issuer wraps it. Ed25519. RFC 8785-style canonical JSON. Export it — anyone runs `npx araxia-verify` with our public key. Offline. No “trust our UI.”**

### Dual presence check

**Approve when READY. Execute when READY. Two moments. Steal the phone after approve, yank the band, and execute fails.**

### Nessie honesty beat (builds trust)

**Capital One Nessie — Best Financial Hack rail. Transfers return 201, we store the provider id. Seeded balances don’t decrement in their API; we overlay confirmed settlements and we *say so*. Sandboxes have truths. We don’t fake the ledger.**

### Solana beat

**Flip the rail. Same human ceremony. Devnet lamports move. Memo carries `araxia` and the nonce. Solscan link — judges can click.**

### Team / Persona (if Jagrati available)

**Persona gated enrollment — no approved inquiry, no passkey, no money. Sandbox, not TSA.**

**Jagrati has a passkey. Shared band. If the stream breaks and the range looks like someone else, we **halt**. We don’t silently reassign identity from heart rate. She switches under her passkey. Liveness hint; identity ceremony.**

### Attack lab climax

1. Mutate payee / amount → verify fails  
2. Replay assertion → claim-once kills it  
3. Band on table → STALE in ~8 s → blocked  

### Close

**Session tokens are how agents inherit humans. Araxia is how humans stay in the loop — action by action, wrist by wrist — without shipping a heartbeat to the bank.**

**Protocol layer. Reference apps on top. Thank you.**

---

## Click path cheat sheet

| Beat | Where | Click |
| --- | --- | --- |
| Presence | `/` | Top bar READY; Presence panel |
| Sensors | `/` | Fitbit panel (BLE + cloud) |
| Agent | `/` | `./gemini` → prompt → propose |
| Manual | `/` | `./edit` → create |
| Approve / Execute | `/` transfer panel | Approve → Execute |
| Bank UX | `/bank` | amount, memo, rail, Instruct / approve / execute |
| Focus handoff | `/bank` → `/` | Instruct → `/?focus=latest` |
| Attack | `/` | `./attack` open |
| Rails | `/` bottom | Nessie ledger, Solana, Tiger |
| Team | `/` | `su` Amar / Jagrati |
| Solana explorer | receipt / panel | Solscan link |

---

## Sound bites (pick 3)

1. **“The bank never sees a heartbeat.”**
2. **“The model proposes. The protocol decides.”**
3. **“The band lies off-wrist — we measured it.”**
4. **“Wearable is liveness. Passkey is identity.”**
5. **“Not a bank — a layer under agentic products.”**

---

## If something breaks mid-demo

| Failure | Line | Move |
| --- | --- | --- |
| DISCONNECTED | “Bridge lost BLE — reconnecting.” | Restart bridge; stall on architecture |
| STALE unexpected | “That’s the freeze gate doing its job.” | Re-wear; wait READY |
| halt true | “Handoff halt — wrong guessed range.” | `su` Amar + Touch ID |
| Gemini down | “Agent path is optional — manual create.” | `./edit` |
| Nessie 5xx | “Rail uncertain — we don’t retry blind.” | Show Solana or assertion verify |
| Touch ID cancel | “User declined — correct behavior.” | Retry once |

---

## Shot list alignment (video)

1. Face + band + READY  
2. GATT / sensor narration over Fitbit panel  
3. Gemini prompt typed or spoken  
4. Touch ID  
5. Execute → Nessie row / settlement note  
6. Solscan (optional)  
7. Band off → STALE  
8. Title card: *presence-conditioned · action-bound*
