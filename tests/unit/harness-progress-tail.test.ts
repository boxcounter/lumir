import assert from "node:assert/strict";
import { test } from "node:test";
import {
  progressTailView,
  type ProgressTailInput,
  type StageCopyKey,
} from "../../src/harness-progress-tail.ts";
import type { SendPhase } from "../../src/harness-panel.ts";

const PHASES: readonly SendPhase[] = ["idle", "running", "stopping"];

function expectedCopy(input: ProgressTailInput): StageCopyKey {
  if (input.phase === "stopping") return "D400";
  if (input.phase === "running" && input.pending) return "D976";
  if (input.phase === "running" && input.midTakeover) return "D983";
  return input.stageWaiting ? "D381" : "D382";
}

test("进度尾行纯模型：相位 × 待批 × 等待 × 接管完整矩阵", () => {
  let count = 0;
  for (const phase of PHASES) {
    for (const pending of [false, true]) {
      for (const stageWaiting of [false, true]) {
        for (const midTakeover of [false, true]) {
          const input = { phase, pending, stageWaiting, midTakeover };
          const actual = progressTailView(input);
          const label = JSON.stringify(input);
          assert.equal(actual.copyKey, expectedCopy(input), `${label} 文案优先级`);
          assert.equal(actual.visible, phase !== "idle", `${label} 可见性`);
          assert.equal(actual.bar, phase === "stopping" ? "frozen" : "indeterminate", `${label} 条形`);
          count += 1;
        }
      }
    }
  }
  assert.equal(count, 24, "矩阵必须真的覆盖 3×2×2×2，不得空转");
});

test("进度尾行纯模型：待批压过接管，工具循环不新增第三档", () => {
  assert.equal(
    progressTailView({ phase: "running", pending: true, stageWaiting: false, midTakeover: true }).copyKey,
    "D976",
  );
  assert.equal(
    progressTailView({ phase: "running", pending: false, stageWaiting: false, midTakeover: false }).copyKey,
    "D382",
  );
});
