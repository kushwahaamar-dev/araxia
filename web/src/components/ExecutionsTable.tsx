import { clock, dollars, prefix } from "@/app/lib-client/format";
import { looksLikeSolanaSig } from "@/app/lib-client/solscan";
import type { ExecutionRow } from "@/app/lib-client/types";
import { Panel, SolscanLink, StateBadge } from "./ui";

export function ExecutionsTable({
  executions,
  reachable,
}: {
  executions: ExecutionRow[];
  reachable: boolean;
}) {
  return (
    <Panel title="Recent executions">
      {!reachable && <p className="text-[12px] text-bad">service unreachable</p>}
      {reachable && executions.length === 0 && <p className="text-[12px] text-dim">no executions yet</p>}
      {executions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead className="text-[10px] tracking-wide text-dim uppercase">
              <tr>
                <th className="border-b border-line py-1 pr-3 font-medium">id</th>
                <th className="border-b border-line py-1 pr-3 font-medium">rail</th>
                <th className="border-b border-line py-1 pr-3 font-medium">status</th>
                <th className="border-b border-line py-1 pr-3 font-medium">assurance</th>
                <th className="border-b border-line py-1 pr-3 font-medium">amount</th>
                <th className="border-b border-line py-1 pr-3 font-medium">provider_ref</th>
                <th className="border-b border-line py-1 font-medium">time</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((row) => (
                <tr key={row.id}>
                  <td className="border-b border-line/60 py-1.5 pr-3">{row.id}</td>
                  <td className="border-b border-line/60 py-1.5 pr-3">{row.rail}</td>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    <StateBadge value={row.status} />
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    <StateBadge value={row.assurance} />
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    {dollars(row.action.amount_minor, row.action.ccy)}
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3" title={row.provider_ref ?? undefined}>
                    {row.provider_ref && (row.rail === "solana" || looksLikeSolanaSig(row.provider_ref)) ? (
                      <SolscanLink kind="tx" id={row.provider_ref}>
                        {prefix(row.provider_ref, 16)}
                      </SolscanLink>
                    ) : (
                      prefix(row.provider_ref, 16)
                    )}
                  </td>
                  <td className="border-b border-line/60 py-1.5 text-dim">
                    {clock(row.started_at)}
                    {row.finished_at ? ` → ${clock(row.finished_at)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
