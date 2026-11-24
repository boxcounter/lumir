import type { SendPhase } from "./harness-panel";

export type StageCopyKey = "D400" | "D976" | "D983" | "D381" | "D382";
export type ProgressBarKind = "indeterminate" | "frozen";

export interface ProgressTailInput {
  readonly phase: SendPhase;
  readonly pending: boolean;
  readonly stageWaiting: boolean;
  readonly midTakeover: boolean;
}

export interface ProgressTailView {
  readonly visible: boolean;
  readonly copyKey: StageCopyKey;
  readonly bar: ProgressBarKind;
}

export function stageCopyKey(
  phase: SendPhase,
  pending: boolean,
  stageWaiting: boolean,
  _midTakeover = false,
): StageCopyKey {
  if (phase === "stopping") return "D400";
  if (phase === "running" && pending) return "D976";
  if (phase === "running" && _midTakeover) return "D983";
  return stageWaiting ? "D381" : "D382";
}

export function progressTailView(input: ProgressTailInput): ProgressTailView {
  return {
    visible: input.phase !== "idle",
    copyKey: stageCopyKey(input.phase, input.pending, input.stageWaiting, input.midTakeover),
    bar: input.phase === "stopping" ? "frozen" : "indeterminate",
  };
}
