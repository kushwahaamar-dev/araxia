import { clock, prefix } from "@/app/lib-client/format";
import { looksLikeSolanaSig } from "@/app/lib-client/solscan";
import type { StatusResponse } from "@/app/lib-client/types";
import { Copyable, Panel, SolscanLink, StateBadge } from "./ui";

function sol(lamports: number): string {
  return `${(lamports / 1_000_000_000).toFixed(4)} SOL`;
}

function AccountRef({ id }: { id: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <SolscanLink kind="account" id={id}>
        {prefix(id, 8)}
      </SolscanLink>
      <Copyable value={id} label="copy address">
        copy
      </Copyable>
    </span>
  );
}

export function SolanaPanel({ solana }: { solana: StatusResponse["solana"] | undefined }) {
  if (!solana) {
    return (
      <Panel title="cat rails/solana" right={<StateBadge value="on-chain" tone="warn" />}>
        <p className="comment">reading relayer…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="cat rails/solana"
      right={
        <StateBadge
          value={solana.configured ? (solana.reachable ? "live" : "down") : "need key"}
          tone={solana.configured && solana.reachable ? "ok" : "warn"}
        />
      }
    >
      <p className="comment">memo + transfer. addresses open solscan.</p>
      {solana.error && <p className="text-[12px] text-bad">! {solana.error}</p>}
      <dl className="dump mt-2">
        <dt>relayer</dt>
        <dd>{solana.address ? <AccountRef id={solana.address} /> : "—"}</dd>
        <dt>balance</dt>
        <dd>{solana.lamports === null ? "—" : sol(solana.lamports)}</dd>
        <dt>payee</dt>
        <dd>{solana.payee ? <AccountRef id={solana.payee} /> : "DEVNET"}</dd>
        <dt>solscan</dt>
        <dd>
          {solana.explorer ? (
            <a className="underline decoration-dotted underline-offset-2 hover:text-accent" href={solana.explorer} rel="noreferrer" target="_blank">
              relayer
            </a>
          ) : (
            "—"
          )}
          <span className="text-dim">  {clock(solana.fetched_at)}</span>
        </dd>
      </dl>
      {solana.airdrop && (
        <p className="mt-2 text-[12px] text-dim">
          faucet={" "}
          {looksLikeSolanaSig(solana.airdrop) ? (
            <SolscanLink kind="tx" id={solana.airdrop}>
              {prefix(solana.airdrop, 10)}
            </SolscanLink>
          ) : solana.airdrop.length > 80 ? (
            `${solana.airdrop.slice(0, 80)}…`
          ) : (
            solana.airdrop
          )}
        </p>
      )}
      {solana.last_txs.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1 font-mono text-[12px]">
          {solana.last_txs.map((tx) => (
            <li key={tx.signature}>
              <SolscanLink kind="tx" id={tx.signature}>
                {prefix(tx.signature, 10)}
              </SolscanLink>
              <span className="text-dim">
                {"  "}
                {tx.nonce || "—"}  {tx.lamports || "—"}  {tx.confirmed_at ? clock(tx.confirmed_at) : "—"}
              </span>
              {tx.dst ? (
                <>
                  {"  "}
                  <SolscanLink kind="account" id={tx.dst}>
                    {prefix(tx.dst, 8)}
                  </SolscanLink>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="comment mt-2">no confirmed signatures yet.</p>
      )}
    </Panel>
  );
}
