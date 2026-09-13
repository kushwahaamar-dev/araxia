import { clock } from "@/app/lib-client/format";
import { FILL, TEXT, toneFor, type Tone } from "./ui";

export type Terminal = "CONFIRMED" | "FAILED" | "UNCERTAIN" | "DENIED";
export type StageName = "PROPOSED" | "APPROVED" | "ASSERTED" | "SENT";

export interface PipelineState {
  stamps: Partial<Record<StageName | Terminal, number>>;
  terminal: Terminal | null;
  providerRef: string | null;
  note: string | null;
}

const STAGES: StageName[] = ["PROPOSED", "APPROVED", "ASSERTED", "SENT"];

export function Pipeline({ state }: { state: PipelineState }) {
  const reached = STAGES.filter((s) => state.stamps[s] !== undefined);
  const current: StageName | Terminal | null = state.terminal ?? reached[reached.length - 1] ?? null;
  const slots: Array<{ name: StageName | Terminal | "OUTCOME"; at: number | undefined }> = [
    ...STAGES.map((s) => ({ name: s, at: state.stamps[s] })),
    state.terminal ? { name: state.terminal, at: state.stamps[state.terminal] } : { name: "OUTCOME", at: undefined },
  ];

  return (
    <div className="flex flex-col gap-2" aria-live="polite" aria-label="execution pipeline">
      <ol className="flex items-stretch gap-1">
        {slots.map((slot, i) => {
          const done = slot.at !== undefined;
          const isCurrent = slot.name === current;
          const tone: Tone = slot.name === "OUTCOME" ? "off" : (STAGES as string[]).includes(slot.name) ? "ok" : toneFor(slot.name);
          return (
            <li key={i} className="flex min-w-0 flex-1 flex-col gap-1" aria-current={isCurrent ? "step" : undefined}>
              <div className={`h-1 rounded-[1px] ${done ? FILL[tone] : "bg-line"}`} />
              <div
                className={`truncate font-mono text-[11px] font-semibold ${
                  done ? TEXT[tone] : "text-dim"
                } ${isCurrent ? "underline decoration-dotted underline-offset-4" : ""}`}
              >
                {slot.name}
              </div>
              <div className="font-mono text-[10px] text-dim">{done ? clock(slot.at) : "—"}</div>
            </li>
          );
        })}
      </ol>
      {(state.providerRef || state.note || state.terminal === "UNCERTAIN") && (
        <dl className="kv grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {state.providerRef && (
            <>
              <dt>provider_ref</dt>
              <dd>{state.providerRef}</dd>
            </>
          )}
          {state.note && (
            <>
              <dt>note</dt>
              <dd className="font-sans">{state.note}</dd>
            </>
          )}
          {state.terminal === "UNCERTAIN" && (
            <>
              <dt>action</dt>
              <dd className={`font-sans ${TEXT.hot}`}>no retry: reconcile manually</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
