// Devnet Solscan is the public proof. Every address and signature we show
// should open a page a judge can inspect without our UI.

const CLUSTER = "devnet";

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${encodeURIComponent(address)}?cluster=${CLUSTER}`;
}

export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${encodeURIComponent(signature)}?cluster=${CLUSTER}`;
}

export function looksLikeSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function looksLikeSolanaSig(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{80,88}$/.test(value);
}
