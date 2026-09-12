// araxia-verify: check an assertion or envelope file against a public key.
//
//   araxia-verify assertion <file.json> --issuer <hex> [--aud <aud>] [--kid <kid>] [--now <unix s>]
//   araxia-verify envelope  <file.json> --bridge <hex>
//
// Exit 0 when valid, 1 when invalid, 2 on usage error. Output is one JSON line.

import { readFileSync } from "node:fs";
import { verifyAssertion, verifyEnvelope, type Assertion, type SignedEnvelope } from "./index.ts";

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: string[]): number {
  const [kind, file] = argv;
  if (!kind || !file) {
    process.stderr.write("usage: araxia-verify assertion <file> --issuer <hex> | envelope <file> --bridge <hex>\n");
    return 2;
  }
  const doc = JSON.parse(readFileSync(file, "utf8")) as unknown;

  if (kind === "assertion") {
    const issuer = flag(argv, "--issuer");
    if (!issuer) {
      process.stderr.write("--issuer <hex public key> is required\n");
      return 2;
    }
    const nowFlag = flag(argv, "--now");
    const kid = flag(argv, "--kid");
    const aud = flag(argv, "--aud");
    const verdict = verifyAssertion(doc as Assertion, {
      issuerPublicKeyHex: issuer,
      ...(kid !== undefined ? { expectedKid: kid } : {}),
      ...(aud !== undefined ? { expectedAud: aud } : {}),
      ...(nowFlag !== undefined ? { nowS: Number(nowFlag) } : {}),
    });
    process.stdout.write(JSON.stringify({ kind, file, ...verdict }) + "\n");
    return verdict.ok ? 0 : 1;
  }

  if (kind === "envelope") {
    const bridge = flag(argv, "--bridge");
    if (!bridge) {
      process.stderr.write("--bridge <hex public key> is required\n");
      return 2;
    }
    const verdict = verifyEnvelope(doc as SignedEnvelope, bridge);
    process.stdout.write(JSON.stringify({ kind, file, ok: verdict.ok, reason: verdict.reason }) + "\n");
    return verdict.ok ? 0 : 1;
  }

  process.stderr.write(`unknown kind: ${kind}\n`);
  return 2;
}
