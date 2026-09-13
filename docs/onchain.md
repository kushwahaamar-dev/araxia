# What Araxia puts on-chain

Every Solana execution is one devnet transaction with two instructions:

1. **Memo** (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`) carrying the
   commitment record below.
2. **SystemProgram.transfer** of the approved lamports from the relayer to the
   approved destination.

Both land in the same signature, so Solscan shows the money and the
commitments side by side. Code: `web/src/lib/commitment.ts`,
`web/src/lib/executors/solana.ts`, runner in `web/src/lib/executors/run.ts`.

## Memo format

```
araxia/1 n=<nonce> a=<hex32> s=<hex32> u=<hex16> w=<hex16|none> e=<hex32> p=<PRESENCE>/<AAL> k=<kid> m=<memo>
```

| Key | What it is | How it is derived | Plaintext? |
|---|---|---|---|
| `n` | Assertion nonce | Issued at approval; claimed exactly once in SQLite before execute | yes (random id) |
| `a` | Action digest | `sha256(canonical action)` — the bytes the passkey signed. First 16 bytes. | hash |
| `s` | Signed-assertion digest | `sha256(canonical full assertion incl. Ed25519 sig)`. First 16 bytes. | hash |
| `u` | Wearer identity | `HMAC-SHA256(commitKey, "user\|<user_id>")`, 8 bytes | keyed hash |
| `w` | Enrolled BPM range | `HMAC-SHA256(commitKey, "range\|<user_id>\|<centroid>\|<sd>")`, 8 bytes; `none` if the wearer has no stamped range | keyed hash |
| `e` | Presence evidence | `sha256` of the bridge's signed window-stats envelope that was fresh at execute. First 16 bytes. | hash |
| `p` | Presence / assurance | e.g. `READY/AAL3` at the moment of execution | yes (state, no numbers) |
| `k` | Issuer key id | `k_` + sha256(issuer pubkey)[:16] | yes |
| `m` | Human memo | `action.reason`, truncated to fit 500 bytes | yes (user-typed) |

`commitKey = sha256(issuerSeed || "araxia/commit")`. It never leaves the
issuer. That is what stops anyone from brute-forcing `u_amar` out of `u`.

## What is deliberately *not* on-chain

- User ids, names, Persona inquiry ids
- Any BPM value, centroid, or standard deviation in the clear
- The raw signed assertion (exportable from the console; verify with `araxia-verify`)
- Passkey credential ids or WebAuthn material
- Nessie account ids or transfer ids (separate rail; not on Solana)

## How a judge checks it

1. `/bank` → Solana rail → approve → execute. The receipt shows the same
   fields under **Written on-chain**.
2. Click **Open on Solscan** (devnet). Instructions tab: Memo with the
   `araxia/1 …` string, then the transfer.
3. In the console (`/?focus=latest`) the assertion panel shows `nonce`, the
   action digest, and `evidence_digest`. Compare `n`, `a[:32]`, `e[:32]`.
4. Export the assertion and run
   `npx araxia-verify assertion assertion.json --issuer <hex>`; recompute
   `sha256` over the canonical action to match `a`.
5. `u` and `w` can only be reproduced by the issuer. Ask us to recompute
   them live for `u_amar` and the enrolled range — that proves linkage
   without revealing the plaintext to the chain.

## Why keyed hashes instead of plain sha256 for `u` / `w`

The user-id space is tiny (three teammates). A plain hash is a lookup table.
A keyed commitment is still deterministic (same wearer → same `u` across all
their transactions, so an auditor can group them) but is unlinkable to a
name without the issuer's key.

## Honest boundaries

- Devnet only. No token value, no custody.
- No custom Solana program yet; this is a memo commitment. An on-chain
  verifier program that checks the assertion signature is documented future
  work.
- The chain proves *what was bound at execute*. It does not prove the
  sensor was honest; that is the bridge's trust boundary (see `CLAIMS.md`).
