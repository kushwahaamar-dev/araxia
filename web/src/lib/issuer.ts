// The only component that holds the assertion signing key.

import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, sign as nodeSign, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  actionDigest,
  assertionSigningBytes,
  MAX_ASSERTION_LIFETIME_S,
  type Assertion,
  type Assurance,
  type CanonicalAction,
} from "@araxia/verify";

const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export const ISSUER_ID = "araxia-local";

interface Issuer {
  key: KeyObject;
  kid: string;
  publicKeyHex: string;
  /** Derived from the seed; keys the on-chain commitments so user ids cannot be brute-forced from a memo. */
  commitKey: Buffer;
}

let issuer: Issuer | null = null;

function loadSeed(): Buffer {
  const env = process.env.ARAXIA_ISSUER_SEED_HEX;
  if (env) return Buffer.from(env, "hex");
  const file = path.join(process.cwd(), "data", "issuer.key");
  if (existsSync(file)) return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
  const seed = randomBytes(32);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, seed.toString("hex") + "\n", { mode: 0o600 });
  return seed;
}

export function getIssuer(): Issuer {
  if (issuer) return issuer;
  const seed = loadSeed();
  if (seed.length !== 32) throw new Error("issuer seed must be 32 bytes");
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
  const jwk = createPublicKey(key).export({ format: "jwk" }) as { x: string };
  const publicKeyHex = Buffer.from(jwk.x, "base64url").toString("hex");
  const kid = "k_" + createHash("sha256").update(publicKeyHex, "hex").digest("hex").slice(0, 16);
  const commitKey = createHash("sha256").update(Buffer.concat([seed, Buffer.from("araxia/commit")])).digest();
  issuer = { key, kid, publicKeyHex, commitKey };
  return issuer;
}

/** Keyed commitment: HMAC-SHA256(commitKey, kind|data). Public memos carry these, never the plaintext. */
export function commitHex(kind: string, data: string, bytes = 8): string {
  return createHmac("sha256", getIssuer().commitKey).update(`${kind}|${data}`).digest("hex").slice(0, bytes * 2);
}

export interface IssueInput {
  sub: string;
  action: CanonicalAction;
  passkeyCredId: string;
  evidenceDigest: string;
  assurance: Assurance;
  approvedAtS: number;
  policyHash: string;
  lifetimeS?: number;
}

export function issueAssertion(input: IssueInput): Assertion {
  const { key, kid } = getIssuer();
  const iat = Math.floor(Date.now() / 1000);
  const lifetime = Math.min(input.lifetimeS ?? MAX_ASSERTION_LIFETIME_S, MAX_ASSERTION_LIFETIME_S);
  const unsigned: Omit<Assertion, "sig"> = {
    iss: ISSUER_ID,
    kid,
    sub: input.sub,
    action: input.action,
    action_digest: actionDigest(input.action),
    passkey_cred_id: input.passkeyCredId,
    approved_at: input.approvedAtS,
    evidence_digest: input.evidenceDigest,
    assurance: input.assurance,
    nonce: "an_" + randomBytes(24).toString("base64url"),
    iat,
    nbf: iat,
    exp: iat + lifetime,
    policy_hash: input.policyHash,
  };
  const sig = nodeSign(null, assertionSigningBytes(unsigned), key).toString("base64");
  return { ...unsigned, sig };
}
