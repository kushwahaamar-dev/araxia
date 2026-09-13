import { dollars, prefix } from "@/app/lib-client/format";
import type { StatusResponse } from "@/app/lib-client/types";
import { Copyable, Panel, StateBadge } from "./ui";

function accountRow(a: NonNullable<StatusResponse["nessie"]>["source"]) {
  if (!a) return null;
  return (
    <tr key={a.id}>
      <td className="border-b border-line/60 py-1.5 pr-3">{a.label}</td>
      <td className="border-b border-line/60 py-1.5 pr-3">{a.nickname ?? a.type ?? "—"}</td>
      <td className="border-b border-line/60 py-1.5 pr-3">
        <StateBadge value={a.role.toUpperCase()} tone={a.role === "source" ? "ok" : "neutral"} />
      </td>
      <td className="border-b border-line/60 py-1.5 pr-3 font-mono">
        {a.balance_minor === null ? "—" : (
          <Copyable value={String(a.balance_minor / 100)} label="copy balance">
            {dollars(a.balance_minor)}
          </Copyable>
        )}
      </td>
      <td className="border-b border-line/60 py-1.5 text-dim">
        <Copyable value={a.id} label="copy account id">
          {prefix(a.id, 8)}
        </Copyable>
      </td>
    </tr>
  );
}

export function NessieLedger({ ledger }: { ledger: StatusResponse["nessie"] | undefined }) {
  if (!ledger) {
    return (
      <Panel title="Capital One Nessie" right={<StateBadge value="SANDBOX" tone="warn" />}>
        <p className="text-[12px] text-dim">reading Capital One sandbox…</p>
      </Panel>
    );
  }
  if (!ledger.configured) {
    return (
      <Panel title="Capital One Nessie" right={<StateBadge value="SANDBOX" tone="warn" />}>
        <p className="text-[12px] text-dim">NESSIE_API_KEY is not configured.</p>
      </Panel>
    );
  }

  const accounts = [ledger.source, ...ledger.payees].filter(Boolean);
  const transfers = ledger.transfers.slice(0, 8);

  return (
    <Panel
      title="Capital One Nessie"
      right={
        <span className="flex items-center gap-2">
          <StateBadge value="SANDBOX" tone="warn" />
          <StateBadge value={ledger.reachable ? "LIVE" : "UNREACHABLE"} tone={ledger.reachable ? "ok" : "bad"} />
        </span>
      }
    >
      {ledger.error && <p className="text-[12px] text-bad">{ledger.error}</p>}
      {accounts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead className="text-[10px] tracking-wide text-dim uppercase">
              <tr>
                <th className="border-b border-line py-1 pr-3 font-medium">label</th>
                <th className="border-b border-line py-1 pr-3 font-medium">account</th>
                <th className="border-b border-line py-1 pr-3 font-medium">role</th>
                <th className="border-b border-line py-1 pr-3 font-medium">balance</th>
                <th className="border-b border-line py-1 font-medium">id</th>
              </tr>
            </thead>
            <tbody>{accounts.map((a) => accountRow(a))}</tbody>
          </table>
        </div>
      )}
      {transfers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead className="text-[10px] tracking-wide text-dim uppercase">
              <tr>
                <th className="border-b border-line py-1 pr-3 font-medium">transfer</th>
                <th className="border-b border-line py-1 pr-3 font-medium">status</th>
                <th className="border-b border-line py-1 pr-3 font-medium">amount</th>
                <th className="border-b border-line py-1 pr-3 font-medium">date</th>
                <th className="border-b border-line py-1 font-medium">description</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr key={t.id}>
                  <td className="border-b border-line/60 py-1.5 pr-3" title={t.id}>
                    {prefix(t.id, 8)}
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    <StateBadge value={t.status.toUpperCase()} />
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    {t.amount_minor === null ? "—" : dollars(t.amount_minor)}
                  </td>
                  <td className="border-b border-line/60 py-1.5 pr-3 text-dim">{t.transaction_date ?? "—"}</td>
                  <td className="border-b border-line/60 py-1.5 text-dim">{t.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-dim">
        Live Capital One sandbox. Transfers are recorded with the assertion nonce in the description. This Nessie
        revision does not move the seeded balances.
      </p>
    </Panel>
  );
}
