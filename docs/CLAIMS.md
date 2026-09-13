# Araxia claims matrix

Everything we say on stage, in the video, and on Devpost must appear in the
left column. Anything in the right column is out of bounds even if a judge
invites it.

| We claim | Evidence | We do not claim |
|---|---|---|
| Every action is approved individually with a WebAuthn passkey (user verification required) and the challenge is bound to the exact action digest. | `web/src/lib/passkeys.ts`, `web/test/approval.test.ts` | Proof of humanity. |
| The assertion is an Ed25519 signature over a canonical (RFC 8785 style) JSON document; any field change breaks it. | `packages/verify`, `araxia-verify` CLI, 12 mutation tests | That the signature proves anything about physiology. |
| Assertions are single-use: the nonce is claimed atomically; 8 worker threads x 25 attempts yield exactly one execution. | `web/test/core.test.ts` claim-once | Idempotency at the provider; Nessie has none, so an UNCERTAIN result blocks retry until reconciled. |
| Presence is checked twice: at approval and again when the agent executes. | `web/src/lib/executors/run.ts` step 'presence' | That presence identifies who is wearing the band. |
| The Fitbit Air keeps streaming its last value after removal; Araxia detects this by variation analysis and flips STALE after 8 s frozen. Measured, not assumed. | `capture/hardware_gate.md`, `capture/hr_offwrist.jsonl`, `tests/test_presence.py` | Skin-contact sensing (the device reports it unsupported). |
| The bridge sends signed window statistics only; raw BPM never leaves the machine the band is paired to. | `bridge/envelope.py` payload fields, `web/src/lib/evidence.ts` | HIPAA compliance or any regulatory status. |
| A per-wearer volatility model, enrolled under passkey, can force step-up when the stream is more volatile than the enrolled wearer's 99% bound. | `bridge/identity.py`, `tests/test_identity.py` | Identification of a person among many from heart rate; HRV; RR intervals (the Air sends none); any FAR/FRR figure. |
| Gemini proposes; the server revalidates op, payee, amount and currency against its own allowlist before an action exists. Prompt injection cannot add a payee. | `web/src/lib/gemini.ts`, `web/src/app/api/propose/route.ts` | That the model is part of the trust boundary. |
| The demo runs fully locally on `localhost` over a phone hotspot. | runbook in `README.md` | Cloud deployment as part of the security model. |
| We reverse-mapped the GATT surface of a 2026 device and documented the sharing gate and off-wrist behaviour. | `capture/gatt_sharing_on.json`, `capture/hardware_gate.md` | Access to Fitbit's proprietary encrypted sync channel. |
| Nessie records every transfer we post (HTTP 201, `objectCreated._id` stored as the provider ref). Its sandbox leaves seeded balances frozen; the displayed balance overlays Araxia's confirmed executions and the UI says so. | `web/src/lib/executors/nessie.ts`, `web/src/lib/nessieSettlements.ts`, `web/test/nessieSettlements.test.ts`, live probe 2026-09-13 | That Nessie moved money between accounts. |
| The same assertion executes on Solana devnet. The memo instruction carries a commitment record: assertion nonce, sha256 of the signed action and of the full assertion, keyed HMAC commitments to the wearer id and enrolled BPM range, sha256 of the fresh presence envelope, presence/assurance state, issuer kid. Every signature links to Solscan. | `web/src/lib/commitment.ts`, `web/src/lib/executors/solana.ts`, `web/test/commitment.test.ts`, `docs/onchain.md` | Mainnet, custody, token value, or that any name, user id, or BPM value is readable on-chain. |
| Passkey enrollment is gated on a Persona hosted inquiry (sandbox). No approved inquiry, no passkey, no money. | `web/src/lib/persona.ts`, `web/src/app/api/kyc/route.ts` | Real identity verification of the person; sandbox "Pass verification" is used in the demo. |
| Several wearers can share one band: handoff is explicit and passkey-gated; a stream break followed by a different-looking wearer halts approvals until someone switches. | `bridge/wearers.py`, `tests/test_wearers.py`, `web/src/lib/wearers.ts` | That BPM tells us who is wearing the band. It is a hint that can only halt. |

## Trust boundary, stated plainly
- Root of trust: the passkey and the issuer's Ed25519 key.
- Condition: fresh READY evidence from an enrolled bridge key.
- The bridge is a trusted collector. A compromised bridge can fabricate statistics. Envelope signatures stop network replay and tampering; they do not prove the sensor.
- The wearer model only lowers assurance (step-up). It never grants.
- No TEE. Isolated signer today; attestation is documented future work.
