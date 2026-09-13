# Araxia service (`web/`)

Next.js 16 app that issues and enforces presence-conditioned, action-bound
authorizations. Runs on `localhost` with SQLite; it is not meant for Vercel
(`better-sqlite3`).

## Routes

| Path | What |
|---|---|
| `/` | tty-style console: presence, team/passkeys, transfer flow, attack lab, rails |
| `/bank` | "Small One" consumer bank UI on the same protocol |
| `/api/status` | Evidence, freshness, assurance, executions, rails, wearer session |
| `/api/actions` | Build + store a canonical action (server-side payee allowlist) |
| `/api/propose` | Gemini proposal, revalidated before an action exists |
| `/api/approve/*` | WebAuthn challenge bound to the action digest → Ed25519 assertion |
| `/api/execute` | Claim the nonce once, re-check presence, run the rail executor |
| `/api/evidence`, `/api/bridges` | Signed window statistics from enrolled bridges |
| `/api/passkeys`, `/api/kyc`, `/api/wearers` | Enrollment, Persona inquiry, wearer handoff |
| `/api/verify` | Verify an exported assertion (same code as `araxia-verify`) |

## Setup

```bash
cp .env.example .env.local   # names only in the example; never commit values
npm install
npm run dev                  # :3000
```

Required: `NESSIE_API_KEY`, `ARAXIA_SOURCE_ACCOUNT`, `ARAXIA_PAYEES_JSON`.
Optional rails light up when their keys are present: Gemini, Persona, Solana
devnet (`SOLANA_KEYPAIR`, `SOLANA_PAYEE`), TigerData, Google Health.

If you export `ARAXIA_*` variables in your shell they shadow `.env.local`;
unset them before `npm run dev` if payees stop resolving.

## Nessie note

The current sandbox `TransferCreate` schema is
`{ transaction_date, status, amount, description }`. Transfers are recorded
but seeded account balances never change (`payee_id`/`medium` are rejected).
`lib/nessieSettlements.ts` overlays Araxia's confirmed executions on the
seeded balance for display, and the UI says so.

## Scripts

```bash
npm run typecheck
npm run lint
npm test          # vitest, 90 tests
```

Layout: `src/lib` (policy, issuer, passkeys, executors, rails), `src/app/api`
(routes), `src/components` (console + bank UI), `test/`.
