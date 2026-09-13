import { clock } from "@/app/lib-client/format";
import type { StatusResponse } from "@/app/lib-client/types";
import { Panel, StateBadge } from "./ui";

export function TigerPanel({ tiger }: { tiger: StatusResponse["tiger"] | undefined }) {
  if (!tiger) {
    return (
      <Panel title="cat rails/tiger" right={<StateBadge value="timescale" tone="warn" />}>
        <p className="comment">connecting…</p>
      </Panel>
    );
  }

  return (
    <Panel
      title="cat rails/tiger"
      right={
        <StateBadge
          value={tiger.configured ? (tiger.reachable ? "live" : "down") : "need url"}
          tone={tiger.configured && tiger.reachable ? "ok" : "warn"}
        />
      }
    >
      <p className="comment">replica. sqlite still claims nonces.</p>
      {tiger.error && <p className="text-[12px] text-bad">! {tiger.error}</p>}
      <dl className="dump mt-2">
        <dt>users</dt>
        <dd>{tiger.users}</dd>
        <dt>passkeys</dt>
        <dd>{tiger.passkeys}</dd>
        <dt>evidence</dt>
        <dd>{tiger.evidence}</dd>
        <dt>events</dt>
        <dd>
          {tiger.events} <span className="text-dim">{clock(tiger.fetched_at)}</span>
        </dd>
      </dl>
      {tiger.recent.length > 0 && (
        <ul className="mt-2 flex flex-col gap-px font-mono text-[12px] text-dim">
          {tiger.recent.map((r, i) => (
            <li key={`${r.ts}-${i}`}>
              {clock(r.ts)}  {r.kind}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
