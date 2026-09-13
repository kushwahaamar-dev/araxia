import { dollars, prefix } from "@/app/lib-client/format";
import type { StatusResponse } from "@/app/lib-client/types";
import { Copyable, Panel, StateBadge } from "./ui";

function accountLine(a: NonNullable<StatusResponse["nessie"]>["source"]) {
  if (!a) return null;
  return (
    <li key={a.id} className="font-mono text-[12px]">
      <span className="text-fg">{a.label}</span>
      <span className="text-dim">  {a.nickname ?? a.type ?? "—"}  {a.role}  </span>
      {a.balance_minor === null ? (
        "—"
      ) : (
        <Copyable value={String(a.balance_minor / 100)} label="copy balance">
          {dollars(a.balance_minor)}
        </Copyable>
      )}
      <span className="text-dim">  </span>
      <Copyable value={a.id} label="copy account id">
        {prefix(a.id, 8)}
      </Copyable>
    </li>
  );
}

export function NessieLedger({ ledger }: { ledger: StatusResponse["nessie"] | undefined }) {
  if (!ledger) {
    return (
      <Panel title="cat rails/smallone" right={<StateBadge value="demo" tone="warn" />}>
        <p className="comment">reading…</p>
      </Panel>
    );
  }
  if (!ledger.configured) {
    return (
      <Panel title="cat rails/smallone" right={<StateBadge value="demo" tone="warn" />}>
        <p className="comment">NESSIE_API_KEY is not configured.</p>
      </Panel>
    );
  }

  const accounts = [ledger.source, ...ledger.payees].filter(Boolean);
  const transfers = ledger.transfers.slice(0, 3);

  return (
    <Panel
      title="cat rails/smallone"
      right={<StateBadge value={ledger.reachable ? "live" : "down"} tone={ledger.reachable ? "ok" : "bad"} />}
    >
      {ledger.error && <p className="text-[12px] text-bad">! {ledger.error}</p>}
      {accounts.length > 0 && <ul className="flex flex-col gap-1">{accounts.map((a) => accountLine(a))}</ul>}
      {transfers.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 font-mono text-[12px] text-dim">
          {transfers.map((t) => (
            <li key={t.id}>
              {prefix(t.id, 8)}  {t.status}  {t.amount_minor === null ? "—" : dollars(t.amount_minor)}  {t.transaction_date ?? "—"}
              {t.description ? `  ${t.description}` : ""}
            </li>
          ))}
        </ul>
      )}
      <p className="comment mt-2">
        {ledger.balances_settled
          ? "seeded nessie balance is frozen; display applies araxia's confirmed settlements."
          : "small one settles on nessie. seeded balances stay put until a confirmed settlement lands."}
      </p>
    </Panel>
  );
}
