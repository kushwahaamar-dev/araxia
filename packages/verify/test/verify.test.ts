import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  actionDigest,
  assertionSigningBytes,
  canonicalize,
  sha256Hex,
  verifyAssertion,
  verifyEnvelope,
  type Assertion,
  type CanonicalAction,
} from "../src/index.ts";

const VECTORS = new URL("../../../tests/vectors/envelopes.json", import.meta.url);

interface Vector {
  public_key_hex: string;
  payload_canonical: string;
  payload_sha256: string;
  sig_b64: string;
  kid: string;
}

function issuer(): { priv: KeyObject; pubHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { priv: privateKey, pubHex: Buffer.from(jwk.x, "base64url").toString("hex") };
}

const NOW = 1_757_700_000;

function action(over: Partial<CanonicalAction> = {}): CanonicalAction {
  return {
    v: 1,
    op: "nessie.transfer",
    aud: "nessie-sandbox",
    src: "acct_src",
    dst: "acct_rent",
    amount_minor: 4500,
    ccy: "USD",
    reason: "RENT",
    nonce: "n_0123456789abcdef0123456789abcdef",
    exp: NOW + 100,
    ...over,
  };
}

function signed(priv: KeyObject, over: Partial<Omit<Assertion, "sig">> = {}): Assertion {
  const a = over.action ?? action();
  const unsigned: Omit<Assertion, "sig"> = {
    iss: "araxia-local",
    kid: "k_issuer_1",
    sub: "u_amar",
    action: a,
    action_digest: actionDigest(a),
    passkey_cred_id: "cred_abc",
    approved_at: NOW - 5,
    evidence_digest: sha256Hex("evidence"),
    assurance: "AAL2",
    nonce: "an_0123456789abcdef0123456789abcdef",
    iat: NOW - 5,
    nbf: NOW - 5,
    exp: NOW + 50,
    policy_hash: sha256Hex("policy-v1"),
    ...over,
  };
  const sig = nodeSign(null, assertionSigningBytes(unsigned), priv).toString("base64");
  return { ...unsigned, sig };
}

describe("canonicalize", () => {
  it("sorts keys and strips whitespace", () => {
    expect(canonicalize({ b: 1, a: { z: true, y: "s" } })).toBe('{"a":{"y":"s","z":true},"b":1}');
  });
  it("rejects floats", () => {
    expect(() => canonicalize({ a: 1.5 })).toThrow();
  });
  it("matches Python canonical bytes and digests from the shared vectors", () => {
    const vectors = JSON.parse(readFileSync(VECTORS, "utf8")) as (Vector & { payload: Record<string, never> })[];
    expect(vectors).toHaveLength(3);
    for (const v of vectors) {
      expect(canonicalize(v.payload)).toBe(v.payload_canonical);
      expect(sha256Hex(v.payload_canonical)).toBe(v.payload_sha256);
    }
  });
});

describe("verifyEnvelope", () => {
  const vectors = JSON.parse(readFileSync(VECTORS, "utf8")) as Vector[];
  it("accepts every Python-signed vector", () => {
    for (const v of vectors) {
      const verdict = verifyEnvelope({ kid: v.kid, payload: v.payload_canonical, sig: v.sig_b64 }, v.public_key_hex);
      expect(verdict.ok, verdict.reason).toBe(true);
      expect(verdict.payload?.presence).toBeDefined();
    }
  });
  it("rejects a flipped presence field", () => {
    const v = vectors[1]!;
    const forged = v.payload_canonical.replace('"STALE"', '"READY"');
    expect(verifyEnvelope({ kid: v.kid, payload: forged, sig: v.sig_b64 }, v.public_key_hex).ok).toBe(false);
  });
  it("rejects the wrong bridge key", () => {
    const v = vectors[0]!;
    expect(verifyEnvelope({ kid: v.kid, payload: v.payload_canonical, sig: v.sig_b64 }, vectors[1]!.public_key_hex).ok).toBe(false);
  });
  it("rejects a non-canonical but validly signed payload shape", () => {
    const { priv, pubHex } = issuer();
    const payload = '{"b":1, "a":2}';
    const sig = nodeSign(null, Buffer.from(payload), priv).toString("base64");
    expect(verifyEnvelope({ kid: "x", payload, sig }, pubHex).reason).toBe("payload is not in canonical form");
  });
});

describe("verifyAssertion", () => {
  const { priv, pubHex } = issuer();
  const base = () => signed(priv);
  const opts = { issuerPublicKeyHex: pubHex, expectedAud: "nessie-sandbox", expectedKid: "k_issuer_1", nowS: NOW };

  it("accepts a well-formed assertion", () => {
    expect(verifyAssertion(base(), opts)).toEqual({ ok: true, reason: "valid" });
  });

  const mutations: Array<[string, (a: Assertion) => Assertion]> = [
    ["amount", (a) => ({ ...a, action: { ...a.action, amount_minor: 45000 } })],
    ["destination", (a) => ({ ...a, action: { ...a.action, dst: "acct_attacker" } })],
    ["source", (a) => ({ ...a, action: { ...a.action, src: "acct_other" } })],
    ["currency", (a) => ({ ...a, action: { ...a.action, ccy: "EUR" } })],
    ["op", (a) => ({ ...a, action: { ...a.action, op: "nessie.withdrawal" } })],
    ["action nonce", (a) => ({ ...a, action: { ...a.action, nonce: "n_ffffffffffffffffffffffffffffffff" } })],
    ["assertion nonce", (a) => ({ ...a, nonce: "an_ffffffffffffffffffffffffffffffff" })],
    ["subject", (a) => ({ ...a, sub: "u_mallory" })],
    ["assurance", (a) => ({ ...a, assurance: "AAL3" })],
    ["evidence digest", (a) => ({ ...a, evidence_digest: sha256Hex("other") })],
    ["passkey credential", (a) => ({ ...a, passkey_cred_id: "cred_other" })],
    ["expiry extended", (a) => ({ ...a, exp: a.exp + 1 })],
  ];
  for (const [name, mutate] of mutations) {
    it(`rejects mutated ${name}`, () => {
      const verdict = verifyAssertion(mutate(base()), opts);
      expect(verdict.ok).toBe(false);
      expect(verdict.reason).toBe("signature mismatch");
    });
  }

  it("rejects a re-signed assertion whose digest does not match its action", () => {
    const a = signed(priv, { action_digest: sha256Hex("wrong") });
    expect(verifyAssertion(a, opts).reason).toBe("action_digest does not match action");
  });
  it("rejects wrong audience", () => {
    expect(verifyAssertion(base(), { ...opts, expectedAud: "solana-devnet" }).reason).toBe("audience mismatch");
  });
  it("rejects wrong kid", () => {
    expect(verifyAssertion(base(), { ...opts, expectedKid: "k_other" }).reason).toBe("unexpected kid");
  });
  it("rejects expired", () => {
    expect(verifyAssertion(base(), { ...opts, nowS: NOW + 51 }).reason).toBe("assertion expired");
  });
  it("rejects not yet valid", () => {
    expect(verifyAssertion(base(), { ...opts, nowS: NOW - 10 }).reason).toBe("assertion not yet valid");
  });
  it("rejects lifetimes over 60 s even when correctly signed", () => {
    const a = signed(priv, { exp: NOW + 100 });
    expect(verifyAssertion(a, opts).reason).toBe("assertion lifetime exceeds 60 s");
  });
  it("rejects expired action even inside assertion window", () => {
    const a = signed(priv, { action: action({ exp: NOW - 1 }) });
    expect(verifyAssertion(a, opts).reason).toBe("action expired");
  });
  it("rejects non-integer or non-positive amounts", () => {
    const a = signed(priv, { action: action({ amount_minor: 0 }) });
    expect(verifyAssertion(a, opts).reason).toBe("amount_minor must be a positive integer");
  });
  it("rejects a different issuer key", () => {
    const other = issuer();
    expect(verifyAssertion(base(), { ...opts, issuerPublicKeyHex: other.pubHex }).reason).toBe("signature mismatch");
  });
  it("rejects a single flipped byte in the signature", () => {
    const a = base();
    const buf = Buffer.from(a.sig, "base64");
    buf[10] = buf[10]! ^ 0x01;
    expect(verifyAssertion({ ...a, sig: buf.toString("base64") }, opts).reason).toBe("signature mismatch");
  });
});
