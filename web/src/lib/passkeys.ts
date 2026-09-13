// WebAuthn ceremonies. Every approval challenge is bound to one action digest
// at issue time; verifyApproval refuses to consume it for anything else.

import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getDb, nowMs } from "./db";
import { recordTigerPasskey } from "./tiger";

export const RP_ID = process.env.ARAXIA_RP_ID ?? "localhost";
export const ORIGIN = process.env.ARAXIA_ORIGIN ?? "http://localhost:3000";
export const RP_NAME = "Araxia";

const REGISTER_TTL_MS = 120_000;
const APPROVE_TTL_MS = 60_000;

interface PasskeyRow {
  cred_id: string;
  user_id: string;
  public_key: Buffer;
  counter: number;
  transports: string;
  created_at: number;
}

interface ChallengeRow {
  id: string;
  user_id: string;
  kind: "register" | "approve";
  action_digest: string | null;
  challenge: string;
  expires_at: number;
  used_at: number | null;
}

function passkeysFor(userId: string): PasskeyRow[] {
  return getDb().prepare("SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at").all(userId) as PasskeyRow[];
}

function parseTransports(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function newChallengeId(): string {
  return "ch_" + randomBytes(16).toString("base64url");
}

export async function registrationOptions(userId: string, displayName: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: userId,
    userDisplayName: displayName,
    userID: Buffer.from(userId, "utf8"),
    timeout: REGISTER_TTL_MS,
    attestationType: "none",
    excludeCredentials: passkeysFor(userId).map((p) => ({ id: p.cred_id, transports: parseTransports(p.transports) })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
  });
  getDb()
    .prepare("INSERT INTO challenges (id, user_id, kind, challenge, expires_at) VALUES (?, ?, 'register', ?, ?)")
    .run(newChallengeId(), userId, options.challenge, nowMs() + REGISTER_TTL_MS);
  return options;
}

export async function verifyRegistration(userId: string, response: RegistrationResponseJSON): Promise<{ cred_id: string }> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM challenges
       WHERE user_id = ? AND kind = 'register' AND used_at IS NULL AND expires_at > ?
       ORDER BY expires_at DESC LIMIT 1`,
    )
    .get(userId, nowMs()) as ChallengeRow | undefined;
  if (!row) throw new Error("no pending registration challenge");

  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: row.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    requireUserVerification: true,
  });
  if (!result.verified) throw new Error("verification failed");
  const { credential } = result.registrationInfo;

  db.transaction(() => {
    const used = db.prepare("UPDATE challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").run(nowMs(), row.id);
    if (used.changes !== 1) throw new Error("challenge already used");
    const created = nowMs();
    const publicKey = Buffer.from(credential.publicKey);
    const transports = JSON.stringify(credential.transports ?? []);
    db.prepare(
      "INSERT INTO passkeys (cred_id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(credential.id, userId, publicKey, credential.counter, transports, created);
    recordTigerPasskey({
      cred_id: credential.id,
      user_id: userId,
      public_key: publicKey,
      counter: credential.counter,
      transports,
      created_at: created,
    });
  })();

  return { cred_id: credential.id };
}

export async function approvalOptions(
  userId: string,
  actionDigest: string,
): Promise<{ challenge_id: string; options: PublicKeyCredentialRequestOptionsJSON }> {
  const passkeys = passkeysFor(userId);
  if (passkeys.length === 0) throw new Error("no passkey registered for this user");

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    timeout: APPROVE_TTL_MS,
    userVerification: "required",
    allowCredentials: passkeys.map((p) => ({ id: p.cred_id, transports: parseTransports(p.transports) })),
  });
  const challengeId = newChallengeId();
  getDb()
    .prepare("INSERT INTO challenges (id, user_id, kind, action_digest, challenge, expires_at) VALUES (?, ?, 'approve', ?, ?, ?)")
    .run(challengeId, userId, actionDigest, options.challenge, nowMs() + APPROVE_TTL_MS);
  return { challenge_id: challengeId, options };
}

export async function verifyApproval(
  userId: string,
  actionDigest: string,
  challengeId: string,
  response: AuthenticationResponseJSON,
): Promise<{ cred_id: string }> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM challenges WHERE id = ?").get(challengeId) as ChallengeRow | undefined;
  if (!row || row.kind !== "approve" || row.user_id !== userId) throw new Error("unknown challenge");
  if (row.used_at !== null) throw new Error("challenge already used");
  if (row.expires_at <= nowMs()) throw new Error("challenge expired");
  if (row.action_digest !== actionDigest) throw new Error("challenge bound to a different action");

  const passkey = db.prepare("SELECT * FROM passkeys WHERE cred_id = ? AND user_id = ?").get(response.id, userId) as
    | PasskeyRow
    | undefined;
  if (!passkey) throw new Error("unknown credential");

  let newCounter: number;
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: row.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      credential: {
        id: passkey.cred_id,
        publicKey: new Uint8Array(passkey.public_key),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports),
      },
    });
    if (!result.verified) throw new Error("verification failed");
    newCounter = result.authenticationInfo.newCounter;
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(detail === "verification failed" ? detail : `verification failed: ${detail}`);
  }

  db.transaction(() => {
    const used = db.prepare("UPDATE challenges SET used_at = ? WHERE id = ? AND used_at IS NULL").run(nowMs(), row.id);
    if (used.changes !== 1) throw new Error("challenge already used");
    db.prepare("UPDATE passkeys SET counter = ? WHERE cred_id = ?").run(newCounter, passkey.cred_id);
  })();

  return { cred_id: passkey.cred_id };
}

export function listPasskeys(userId: string): Array<{ cred_id: string; created_at: number }> {
  return getDb()
    .prepare("SELECT cred_id, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at")
    .all(userId) as Array<{ cred_id: string; created_at: number }>;
}
