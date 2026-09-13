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

## Trust boundary, stated plainly
- Root of trust: the passkey and the issuer's Ed25519 key.
- Condition: fresh READY evidence from an enrolled bridge key.
- The bridge is a trusted collector. A compromised bridge can fabricate statistics. Envelope signatures stop network replay and tampering; they do not prove the sensor.
- The wearer model only lowers assurance (step-up). It never grants.
- No TEE. Isolated signer today; attestation is documented future work.
