// 键位面板分组的不变量（M240 顺手收 M239 的漏登记，change table-fullscreen-view 之外的一处
// 既存红）：`src/bindings-panel.ts` 的 `BINDING_GROUPS` 必须覆盖 `COMMAND_IDS` 的每一条。
//
// 为什么要有这一条：面板的 `render()` 对「未列入任何分组」的 id 求差集，落进末尾的兜底
// 「其他」组——那是 M133 的有意设计（新命令忘记归组时不会从面板里消失），但代价是漏归组
// **本身不报错**：只有断言分组标题的场景会红。M239（list-tab-indent）把
// `editor.list-indent` / `editor.list-outdent` 加进 EDITOR_CORE_COMMAND_IDS 时忘了归组，
// 于是 master 的视觉门禁在 m133 上红（M240 现场实测归因，见 docs/backlog.md 的门禁条），
// 跨了一个 mission 才发现。对账放进这一层之后，漏归组在引入它的那次改动里就红。
//
// 三条对账各自挡一种写错法：
//   ① 每条 COMMAND_IDS 都有组 → 零兜底组（新增命令忘了归组）；
//   ② 组里没有 COMMAND_IDS 之外的幻影 id（归组行打错 id，或命令被删后残留）；
//   ③ 分组互斥（同一命令出现在两组 → 面板同一命令渲染两行，「每条命令一行」的口径被破坏）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { BINDING_GROUPS } from "../../src/bindings-panel.ts";
import { COMMAND_IDS } from "../../src/keys.ts";

test("键位面板分组：COMMAND_IDS 每条都有组（零兜底「其他」）", () => {
  const assigned = new Set<string>();
  for (const group of BINDING_GROUPS) for (const command of group.commands) assigned.add(command);
  const missing = COMMAND_IDS.filter((command) => !assigned.has(command));
  assert.deepEqual(
    missing,
    [],
    `未归组的命令会落进面板末尾的兜底「其他」组（并在断言分组标题的场景里红）：${missing.join(", ")}`,
  );
});

test("键位面板分组：没有 COMMAND_IDS 之外的幻影 id", () => {
  const known = new Set<string>(COMMAND_IDS);
  const phantom: string[] = [];
  for (const group of BINDING_GROUPS) for (const command of group.commands) if (!known.has(command)) phantom.push(command);
  // 打错一个 id 的表现是「面板里那一行消失」而不是报错——这条把它挡在提交前。
  assert.deepEqual(phantom, [], `这些 id 不在 COMMAND_IDS 里：${phantom.join(", ")}`);
});

test("键位面板分组：分组互斥（同一命令不得出现在两个组）", () => {
  const seen = new Set<string>();
  const duplicated: string[] = [];
  let total = 0;
  for (const group of BINDING_GROUPS) {
    for (const command of group.commands) {
      total += 1;
      if (seen.has(command)) duplicated.push(`${command}（${group.title}）`);
      seen.add(command);
    }
  }
  assert.deepEqual(duplicated, [], `同一命令被两个组各渲染一行 ⇒ 面板行数翻倍：${duplicated.join(", ")}`);
  assert.equal(seen.size, total);
  assert.equal(total, COMMAND_IDS.length, "分组条目总数 = 命令总数（与第一条互为反向核验）");
});
