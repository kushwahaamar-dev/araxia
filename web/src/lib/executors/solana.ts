// Solana devnet relayer. Same Araxia assertion, different rail. The nonce is
// written into a memo instruction so the explorer shows the binding. No custom
// on-chain program; that is future work and is described as such.

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
import type { ExecOutcome, Executor } from "./types";

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

export function solanaExecutor(send: SolanaSend = defaultSend): Executor {
  return {
    rail: "solana",
    aud: "solana-devnet",
    async execute(action: CanonicalAction, assertionNonce: string): Promise<ExecOutcome> {
      if (!process.env.SOLANA_KEYPAIR) {
        return { status: "FAILED", providerRef: null, response: null, note: "SOLANA_KEYPAIR not configured" };
      }
      try {
        const { signature } = await Promise.race([
          send({ to: action.dst, lamports: action.amount_minor, memo: `araxia ${assertionNonce}` }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), TIMEOUT_MS);
          }),
        ]);
        return {
          status: "CONFIRMED",
          providerRef: signature,
          response: { signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` },
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
