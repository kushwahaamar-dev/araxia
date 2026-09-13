import { clock, dollars, prefix } from "@/app/lib-client/format";
import { looksLikeSolanaSig } from "@/app/lib-client/solscan";
import type { ExecutionRow } from "@/app/lib-client/types";
import { Panel, SolscanLink } from "./ui";

export function ExecutionsTable({
  executions,
  reachable,
}: {
  executions: ExecutionRow[];
  reachable: boolean;
}) {
  return (
    <Panel title="ls ~/exec">
      {!reachable && <p className="text-[12px] text-bad">! service unreachable</p>}
      {reachable && executions.length === 0 && <p className="comment">empty</p>}
      {executions.length > 0 && (
        <ul className="flex flex-col gap-2 font-mono text-[12px]">
          {executions.map((row) => (
            <li key={row.id} className="border-b border-line/40 pb-2">
              <p>
                {row.id}  {row.rail}  {row.status}  {dollars(row.action.amount_minor, row.action.ccy)}
              </p>
              <p className="text-dim">
                aal={row.assurance}  {clock(row.started_at)}
                {row.finished_at ? ` → ${clock(row.finished_at)}` : ""}
                {row.provider_ref ? "  " : ""}
                {row.provider_ref && (row.rail === "solana" || looksLikeSolanaSig(row.provider_ref)) ? (
                  <SolscanLink kind="tx" id={row.provider_ref}>
                    {prefix(row.provider_ref, 16)}
                  </SolscanLink>
                ) : (
                  prefix(row.provider_ref, 16)
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
