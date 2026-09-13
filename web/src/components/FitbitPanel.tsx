import type { StatusResponse } from "@/app/lib-client/types";
import { clock } from "@/app/lib-client/format";
import { Panel, StateBadge } from "./ui";

export function FitbitPanel({
  fitbit,
  liveBleBpm,
}: {
  fitbit: StatusResponse["fitbit"] | undefined;
  liveBleBpm: number | null | undefined;
}) {
  if (!fitbit) {
    return (
      <Panel title="cat rails/health" right={<StateBadge value="cloud" tone="warn" />}>
        <p className="comment">reading…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="cat rails/health"
      right={
        <StateBadge
          value={fitbit.authorized ? (fitbit.reachable ? "synced" : "down") : "need auth"}
          tone={fitbit.authorized && fitbit.reachable ? "ok" : "warn"}
        />
      }
    >
      <p className="comment">cloud after phone sync. not the approval gate.</p>
      <dl className="dump mt-2">
        <dt>ble</dt>
        <dd>{liveBleBpm && liveBleBpm >= 30 ? liveBleBpm : "—"}</dd>
        <dt>cloud</dt>
        <dd>{fitbit.cloud_latest_intraday_bpm ?? "—"}</dd>
        <dt>resting</dt>
        <dd>{fitbit.cloud_resting_bpm ?? "—"}</dd>
        <dt>acct</dt>
        <dd>
          {fitbit.display_name ?? "—"} <span className="text-dim">{clock(fitbit.fetched_at)}</span>
        </dd>
      </dl>
      {fitbit.error && <p className="text-[12px] text-bad">! {fitbit.error}</p>}
      {!fitbit.authorized && (
        <a className="btn btn-primary mt-2 self-start" href="/api/fitbit/connect">
          ./connect
        </a>
      )}
      {fitbit.metrics.length > 0 && (
        <details className="mt-2 text-[12px] text-dim">
          <summary className="cursor-pointer hover:text-accent">
            <span className="term-prompt">cat signals</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-px">
            {fitbit.metrics.map((m) => (
              <li key={m.key}>
                {m.label}  {m.available ? m.value : "—"}  <span className="text-dim">{m.note}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
