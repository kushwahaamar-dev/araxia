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
      <Panel title="Solana devnet" right={<StateBadge value="ON-CHAIN" tone="warn" />}>
        <p className="text-[12px] text-dim">reading relayer…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Solana devnet"
      right={
        <span className="flex items-center gap-2">
          <StateBadge value="SOLSCAN" tone="warn" />
          <StateBadge
            value={solana.configured ? (solana.reachable ? "LIVE" : "DOWN") : "NEED KEY"}
            tone={solana.configured && solana.reachable ? "ok" : "warn"}
          />
        </span>
      }
    >
      <p className="text-[12px] text-muted">
        Same assertion, second rail. Memo is public text <span className="font-mono">araxia &lt;nonce&gt;</span>, then a
        SystemProgram transfer. Every address and signature opens Solscan.
      </p>
      {solana.error && <p className="text-[12px] text-bad">{solana.error}</p>}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Relayer</dt>
          <dd className="font-mono text-[12px]">{solana.address ? <AccountRef id={solana.address} /> : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Balance</dt>
          <dd className="font-display text-2xl">
            {solana.lamports === null ? "—" : sol(solana.lamports)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Payee</dt>
          <dd className="font-mono text-[12px]">{solana.payee ? <AccountRef id={solana.payee} /> : "DEVNET"}</dd>
          <dd className="text-[11px] text-dim">SOLANA_PAYEE</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Solscan</dt>
          <dd className="font-mono text-[12px]">
            {solana.explorer ? (
              <a className="underline decoration-dotted underline-offset-2 hover:text-accent" href={solana.explorer} rel="noreferrer" target="_blank">
                relayer account
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dd className="text-[11px] text-dim">{clock(solana.fetched_at)}</dd>
        </div>
      </dl>
      {solana.airdrop && (
        <p className="text-[11px] text-dim">
          faucet:{" "}
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
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead className="text-[10px] tracking-wide text-dim uppercase">
              <tr>
                <th className="border-b border-line py-1 pr-3 font-medium">solscan</th>
                <th className="border-b border-line py-1 pr-3 font-medium">nonce</th>
                <th className="border-b border-line py-1 pr-3 font-medium">dst</th>
                <th className="border-b border-line py-1 pr-3 font-medium">lamports</th>
                <th className="border-b border-line py-1 font-medium">when</th>
              </tr>
            </thead>
            <tbody>
              {solana.last_txs.map((tx) => (
                <tr key={tx.signature}>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    <SolscanLink kind="tx" id={tx.signature}>
                      {prefix(tx.signature, 10)}
                    </SolscanLink>
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3 text-dim">{tx.nonce || "—"}</td>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    {tx.dst ? (
                      <SolscanLink kind="account" id={tx.dst}>
                        {prefix(tx.dst, 8)}
                      </SolscanLink>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3">{tx.lamports || "—"}</td>
                  <td className="border-b border-line/60 py-1.5 text-dim">{tx.confirmed_at ? clock(tx.confirmed_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[12px] text-dim">
          No confirmed signatures yet. After a <span className="font-mono">solana.transfer</span>, the tx appears here and
          on Solscan.
        </p>
      )}
    </Panel>
  );
}
