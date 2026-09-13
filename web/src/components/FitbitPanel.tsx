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
      <Panel title="Google Health (synced)" right={<StateBadge value="CLOUD" tone="warn" />}>
        <p className="text-[12px] text-dim">reading Google Health API…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Google Health (synced)"
      right={
        <span className="flex items-center gap-2">
          <StateBadge value="NOT LIVE" tone="warn" />
          <StateBadge
            value={fitbit.authorized ? (fitbit.reachable ? "SYNCED" : "DOWN") : "NEED AUTH"}
            tone={fitbit.authorized && fitbit.reachable ? "ok" : "warn"}
          />
        </span>
      }
    >
      <p className="text-[12px] text-muted">
        Live BPM is the BLE packet stream. Everything below is Google Health API after the phone
        syncs — not the legacy Fitbit Web API, not Google Earth, not a live wrist, and not the approval gate.
      </p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">BLE live</dt>
          <dd className="font-display text-2xl">{liveBleBpm && liveBleBpm >= 30 ? `${liveBleBpm}` : "—"}</dd>
          <dd className="text-[11px] text-dim">from packets</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Cloud latest</dt>
          <dd className="font-display text-2xl">
            {fitbit.cloud_latest_intraday_bpm ?? "—"}
          </dd>
          <dd className="text-[11px] text-dim">heart-rate samples</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Resting</dt>
          <dd className="font-display text-2xl">{fitbit.cloud_resting_bpm ?? "—"}</dd>
          <dd className="text-[11px] text-dim">daily summary</dd>
        </div>
        <div>
          <dt className="text-[11px] tracking-wide text-dim uppercase">Account</dt>
          <dd className="font-mono text-[12px]">{fitbit.display_name ?? "—"}</dd>
          <dd className="text-[11px] text-dim">{clock(fitbit.fetched_at)}</dd>
        </div>
      </dl>
      {fitbit.error && <p className="text-[12px] text-bad">{fitbit.error}</p>}
      {!fitbit.authorized && (
        <a className="btn btn-primary self-start" href="/api/fitbit/connect">
          Connect Google Health
        </a>
      )}
      {fitbit.metrics.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left font-mono text-[11px]">
            <thead className="text-[10px] tracking-wide text-dim uppercase">
              <tr>
                <th className="border-b border-line py-1 pr-3 font-medium">signal</th>
                <th className="border-b border-line py-1 pr-3 font-medium">value</th>
                <th className="border-b border-line py-1 font-medium">note</th>
              </tr>
            </thead>
            <tbody>
              {fitbit.metrics.map((m) => (
                <tr key={m.key}>
                  <td className="border-b border-line/60 py-1.5 pr-3">{m.label}</td>
                  <td className="border-b border-line/60 py-1.5 pr-3">
                    {m.available ? m.value : <span className="text-dim">—</span>}
                  </td>
                  <td className="border-b border-line/60 py-1.5 text-dim">{m.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
