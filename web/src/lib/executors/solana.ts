// Solana devnet relayer. Same Araxia assertion, different rail. The memo
// instruction carries the commitment record (nonce, action + assertion
// digests, keyed wearer and BPM-range commitments, presence evidence digest)
// so the explorer shows the binding next to the transfer. No custom on-chain
// program; that is future work and is described as such.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { CanonicalAction } from "@araxia/verify";
import { solscanAccount, solscanTx } from "@/app/lib-client/solscan";
import { listTigerSolana, recordTigerSolana } from "../tiger";
import type { ExecContext, ExecOutcome, Executor } from "./types";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const TIMEOUT_MS = 15_000;

export type SolanaSend = (args: {
  to: string;
  lamports: number;
  memo: string;
}) => Promise<{ signature: string }>;

function expandHome(file: string): string {
  return file.startsWith("~/") ? path.join(homedir(), file.slice(2)) : file;
}

function loadKeypair(file: string): Keypair {
  const raw = JSON.parse(readFileSync(expandHome(file), "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function solanaAddress(): string | null {
  const file = process.env.SOLANA_KEYPAIR;
  if (!file || !existsSync(expandHome(file))) return null;
  try {
    return loadKeypair(file).publicKey.toBase58();
  } catch {
    return null;
  }
}

async function defaultSend(args: { to: string; lamports: number; memo: string }): Promise<{ signature: string }> {
  const file = process.env.SOLANA_KEYPAIR;
  if (!file || !existsSync(expandHome(file))) throw new Error("SOLANA_KEYPAIR not configured");
  const from = loadKeypair(file);
  const rpc = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const to = new PublicKey(args.to);
  const tx = new Transaction().add(
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM,
      data: Buffer.from(args.memo, "utf8"),
    }),
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: args.lamports }),
  );
  const signature = await sendAndConfirmTransaction(connection, tx, [from], {
    commitment: "confirmed",
  });
  return { signature };
}

export interface SolanaSnapshot {
  configured: boolean;
  reachable: boolean;
  address: string | null;
  lamports: number | null;
  airdrop: string | null;
  explorer: string | null;
  payee: string | null;
  last_txs: Array<{ signature: string; nonce: string; dst: string; lamports: number; confirmed_at: number }>;
  error: string | null;
  fetched_at: number;
}

function payeeAddress(): string | null {
  const v = process.env.SOLANA_PAYEE;
  return v && v.length > 0 ? v : null;
}

async function listVisibleTxs(
  connection: Connection,
  address: string,
): Promise<SolanaSnapshot["last_txs"]> {
  const known = new Map((await listTigerSolana(50)).map((row) => [row.signature, row]));
  try {
    const sigs = await connection.getSignaturesForAddress(new PublicKey(address), { limit: 20 });
    const seen = new Set<string>();
    const rows: SolanaSnapshot["last_txs"] = [];
    for (const s of sigs) {
      seen.add(s.signature);
      const hit = known.get(s.signature);
      rows.push({
        signature: s.signature,
        nonce: hit?.nonce ?? "",
        dst: hit?.dst ?? "",
        lamports: hit?.lamports ?? 0,
        confirmed_at: s.blockTime ? s.blockTime * 1000 : (hit?.confirmed_at ?? 0),
      });
    }
    for (const row of known.values()) {
      if (!seen.has(row.signature)) rows.push(row);
    }
    return rows;
  } catch {
    return [...known.values()];
  }
}

let solCache: { at: number; value: SolanaSnapshot } | null = null;
let airdropAttempted = false;
const SOL_CACHE_MS = 12_000;

export async function getSolanaSnapshot(now = Date.now()): Promise<SolanaSnapshot> {
  if (solCache && now - solCache.at < SOL_CACHE_MS) return solCache.value;
  if (process.env.VITEST && process.env.SOLANA_LIVE !== "1") {
    const value: SolanaSnapshot = {
      configured: Boolean(process.env.SOLANA_KEYPAIR),
      reachable: false,
      address: null,
      lamports: null,
      airdrop: null,
      explorer: null,
      payee: payeeAddress(),
      last_txs: [],
      error: "skipped in unit tests",
      fetched_at: now,
    };
    solCache = { at: now, value };
    return value;
  }
  const address = solanaAddress();
  const file = process.env.SOLANA_KEYPAIR;
  if (!file || !address) {
    const value: SolanaSnapshot = {
      configured: false,
      reachable: false,
      address: null,
      lamports: null,
      airdrop: null,
      explorer: null,
      payee: payeeAddress(),
      last_txs: [],
      error: "SOLANA_KEYPAIR is not set or the file is missing",
      fetched_at: now,
    };
    solCache = { at: now, value };
    return value;
  }
  const rpc = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";
  try {
    const connection = new Connection(rpc, "confirmed");
    const pubkey = new PublicKey(address);
    let lamports = await connection.getBalance(pubkey, "confirmed");
    let airdrop: string | null = null;
    if (!airdropAttempted && lamports < 50_000_000) {
      airdropAttempted = true;
      try {
        const sig = await connection.requestAirdrop(pubkey, 1_000_000_000);
        await connection.confirmTransaction(sig, "confirmed");
        lamports = await connection.getBalance(pubkey, "confirmed");
        airdrop = sig;
      } catch (e) {
        airdrop = e instanceof Error ? e.message : "airdrop failed";
      }
    }
    const value: SolanaSnapshot = {
      configured: true,
      reachable: true,
      address,
      lamports,
      airdrop,
      payee: payeeAddress(),
      explorer: solscanAccount(address),
      last_txs: await listVisibleTxs(connection, address),
      error: null,
      fetched_at: now,
    };
    solCache = { at: now, value };
    return value;
  } catch (e) {
    const value: SolanaSnapshot = {
      configured: true,
      reachable: false,
      address,
      lamports: null,
      airdrop: null,
      payee: payeeAddress(),
      explorer: solscanAccount(address),
      last_txs: await listTigerSolana(20),
      error: e instanceof Error ? e.message : "solana rpc error",
      fetched_at: now,
    };
    solCache = { at: now, value };
    return value;
  }
}

export function solanaExecutor(send: SolanaSend = defaultSend): Executor {
  return {
    rail: "solana",
    aud: "solana-devnet",
    async execute(action: CanonicalAction, assertionNonce: string, ctx?: ExecContext): Promise<ExecOutcome> {
      if (!process.env.SOLANA_KEYPAIR) {
        return { status: "FAILED", providerRef: null, response: null, note: "SOLANA_KEYPAIR not configured" };
      }
      try {
        // Full commitment memo when the runner supplies one; bare nonce+reason otherwise.
        const memo = (ctx?.memo ?? `araxia ${assertionNonce} ${action.reason}`).slice(0, 500);
        const { signature } = await Promise.race([
          send({ to: action.dst, lamports: action.amount_minor, memo }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), TIMEOUT_MS);
          }),
        ]);
        recordTigerSolana({
          signature,
          nonce: assertionNonce,
          dst: action.dst,
          lamports: action.amount_minor,
        });
        solCache = null;
        return {
          status: "CONFIRMED",
          providerRef: signature,
          response: { signature, explorer: solscanTx(signature), memo, commitment: ctx?.commitment ?? null },
        };
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const kind = err.name === "TimeoutError" || err.name === "AbortError" ? "timed out" : "send failed";
        const uncertain = kind === "timed out";
        return {
          status: uncertain ? "UNCERTAIN" : "FAILED",
          providerRef: null,
          response: { error: kind, message: err.message ?? String(e) },
          note: uncertain
            ? "devnet send timed out; the nonce is already claimed so no retry is allowed"
            : err.message ?? "solana send failed",
        };
      }
    },
  };
}
