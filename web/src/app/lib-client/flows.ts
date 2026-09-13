import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api, errorText, isApiError, type ApiResult } from "./api";
import type { ApproveOptionsResponse, CreatedAction, Decision } from "./types";

export interface Step {
  label: string;
  status: number;
  body: unknown;
}

export interface ActionForm {
  op: string;
  dst: string;
  amount_minor: number;
  ccy: string;
  reason: string;
}

export function createAction(userId: string, source: string, form: ActionForm): Promise<ApiResult<CreatedAction>> {
  return api<CreatedAction>("/api/actions", { body: { user_id: userId, source, ...form } });
}

export interface ApprovalResult {
  steps: Step[];
  decision: Decision | null;
  error: string | null;
}

function webauthnMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return "passkey ceremony failed";
}

/** options -> local authenticator -> verify. Every HTTP hop is recorded so the lab can show it raw. */
export async function runApproval(userId: string, actionDigest: string): Promise<ApprovalResult> {
  const steps: Step[] = [];
  const opts = await api<ApproveOptionsResponse>("/api/approve/options", {
    body: { user_id: userId, action_digest: actionDigest },
  });
  steps.push({ label: "POST /api/approve/options", status: opts.status, body: opts.body });
  if (opts.status < 200 || opts.status >= 300 || !opts.body || isApiError(opts.body)) {
    return { steps, decision: null, error: errorText(opts, "approve options failed") };
  }

  let response;
  try {
    response = await startAuthentication({
      optionsJSON: opts.body.options as PublicKeyCredentialRequestOptionsJSON,
    });
  } catch (err) {
    return { steps, decision: null, error: webauthnMessage(err) };
  }

  const verify = await api<Decision>("/api/approve/verify", {
    body: { user_id: userId, action_digest: actionDigest, challenge_id: opts.body.challenge_id, response },
  });
  steps.push({ label: "POST /api/approve/verify", status: verify.status, body: verify.body });
  if (verify.status === 0 || !verify.body || isApiError(verify.body) || !("decision" in verify.body)) {
    return { steps, decision: null, error: errorText(verify, "approve verify failed") };
  }
  return { steps, decision: verify.body, error: null };
}

export async function registerPasskey(
  userId: string,
  displayName = userId,
): Promise<{ cred_id: string } | { error: string }> {
  const opts = await api<PublicKeyCredentialCreationOptionsJSON>("/api/passkeys/register/options", {
    body: { user_id: userId, display_name: displayName },
  });
  if (opts.status < 200 || opts.status >= 300 || !opts.body || isApiError(opts.body)) {
    return { error: errorText(opts, "registration options failed") };
  }
  let response;
  try {
    response = await startRegistration({ optionsJSON: opts.body });
  } catch (err) {
    return { error: webauthnMessage(err) };
  }
  const verify = await api<{ ok: boolean; cred_id: string }>("/api/passkeys/register/verify", {
    body: { user_id: userId, response },
  });
  if (verify.status < 200 || verify.status >= 300 || !verify.body || isApiError(verify.body) || !verify.body.ok) {
    return { error: errorText(verify, "registration verify failed") };
  }
  return { cred_id: verify.body.cred_id };
}
