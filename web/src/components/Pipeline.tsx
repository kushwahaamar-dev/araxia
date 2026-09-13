import { clock } from "@/app/lib-client/format";
import { looksLikeSolanaSig } from "@/app/lib-client/solscan";
import { SolscanLink, TEXT, toneFor, type Tone } from "./ui";

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
    <div className="flex flex-col gap-1" aria-live="polite" aria-label="execution pipeline">
      <p className="term-prompt text-[12px]">pipeline</p>
      <ol className="flex flex-col gap-px font-mono text-[12px]">
        {slots.map((slot, i) => {
          const done = slot.at !== undefined;
          const isCurrent = slot.name === current;
          const tone: Tone = slot.name === "OUTCOME" ? "off" : (STAGES as string[]).includes(slot.name) ? "ok" : toneFor(slot.name);
          return (
            <li
              key={i}
              aria-current={isCurrent ? "step" : undefined}
              className={`${done ? TEXT[tone] : "text-dim"} ${isCurrent ? "text-white" : ""}`}
            >
              {done ? "*" : " "} {slot.name.padEnd(10, " ")}  {done ? clock(slot.at) : "—"}
            </li>
          );
        })}
      </ol>
      {(state.providerRef || state.note || state.terminal === "UNCERTAIN") && (
        <dl className="dump mt-2">
          {state.providerRef && (
            <>
              <dt>ref</dt>
              <dd>
                {looksLikeSolanaSig(state.providerRef) ? (
                  <SolscanLink kind="tx" id={state.providerRef}>
                    {state.providerRef}
                  </SolscanLink>
                ) : (
                  state.providerRef
                )}
              </dd>
            </>
          )}
          {state.note && (
            <>
              <dt>note</dt>
              <dd>{state.note}</dd>
            </>
          )}
          {state.terminal === "UNCERTAIN" && (
            <>
              <dt>action</dt>
              <dd className={TEXT.hot}>no retry: reconcile manually</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
