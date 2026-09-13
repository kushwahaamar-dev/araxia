import { clock } from "@/app/lib-client/format";
import type { StatusResponse } from "@/app/lib-client/types";
import { Panel, StateBadge } from "./ui";

export function TigerPanel({ tiger }: { tiger: StatusResponse["tiger"] | undefined }) {
  if (!tiger) {
    return (
      <Panel title="TigerData" right={<StateBadge value="TIMESCALE" tone="warn" />}>
        <p className="text-[12px] text-dim">connecting to TigerData…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="TigerData"
      right={
        <span className="flex items-center gap-2">
          <StateBadge value="REPLICA" tone="warn" />
          <StateBadge
            value={tiger.configured ? (tiger.reachable ? "LIVE" : "DOWN") : "NEED URL"}
            tone={tiger.configured && tiger.reachable ? "ok" : "warn"}
          />
        </span>
      }
    >
      <p className="text-[12px] text-muted">
        Timescale hypertables hold users, passkeys, evidence, executions, health snapshots, and
        Solana memos. SQLite still claims nonces. Restarting this machine restores auth from here.
      </p>
      {tiger.error && <p className="text-[12px] text-bad">{tiger.error}</p>}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Users</dt>
          <dd className="font-display text-2xl">{tiger.users}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Passkeys</dt>
          <dd className="font-display text-2xl">{tiger.passkeys}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Evidence</dt>
          <dd className="font-display text-2xl">{tiger.evidence}</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Events</dt>
          <dd className="font-display text-2xl">{tiger.events}</dd>
          <dd className="text-[11px] text-dim">{clock(tiger.fetched_at)}</dd>
        </div>
      </dl>
      {tiger.recent.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead className="text-[10px] tracking-wide text-dim uppercase">
              <tr>
                <th className="border-b border-line py-1 pr-3 font-medium">when</th>
                <th className="border-b border-line py-1 font-medium">kind</th>
              </tr>
            </thead>
            <tbody>
              {tiger.recent.map((r, i) => (
                <tr key={`${r.ts}-${i}`}>
                  <td className="border-b border-line/60 py-1.5 pr-3 text-dim">{clock(r.ts)}</td>
                  <td className="border-b border-line/60 py-1.5">{r.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
