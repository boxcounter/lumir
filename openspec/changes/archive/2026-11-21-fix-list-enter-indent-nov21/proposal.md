# Proposal: 修复段首 marker 后 Enter 的下一行无意义缩进

- Change ID: `fix-list-enter-indent-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（原始缺陷报告、裁决），AI agent（诊断 / 起草 / 实现）

> 评审记录
> 节点 1：Alex 报告「段首输入 `- ` 后，下一行缩进」，并要求直接处理；该批以「请你继续」批准
> 推进。本 change 只修 `Enter` 在 md 散文 / 列表续行回落里照抄行首空白这一条，不新增产品形态、
> 不改上游续行。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-21）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-21 通过——Alex 报告「段首输入 `- ` 后，下一行缩进」并要求
   直接处理，该批以「请你继续」批准推进（见上方「评审记录」）。实现期没有静默扩 scope：产品改动
   只有 `src/enter-indent.ts` 的 md 回落收窄与裸行空项删除起点、`src/preview/lists.ts` 的
   `markerTextAt` 前缀拆成 `quote` / `indent` 两段（仍一处真源），以及 `docs/specs/lists.md` B2
   的口径同步；r1 / r2 评审返修（P2-1…P2-4、P3-1/P3-2）都是同一条回落的边界与测试覆盖，
   未新增产品行为。proposal「Non-goals」明确不做的首项续行 / M399 / 渲染层均未动。
2. **独立 reviewer clean / merge**：独立 reviewer agent-36 判 `clean/merge`，无 P1 / P2 findings；
   评审对 Tab 行首 P2 的修复（`90e557a3`「行首归一化保留被下移代码行的原始行首空白」）同样判
   `clean/merge`。绑定 integration tip `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/editing-batch-nov21/review-final.md`。
   当前分支 tip 与该评审 tip 相同。
3. **tasks 完成**：`tasks.md` 19/19 全勾（`grep -c '^- \[x\]'` = 19，未勾项 0），无放弃项。
   2.6 的真机执行由主会话完成，读数与证据指针见下条。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/**`（`m264-enter-auto-indent.spec.ts` /
   `lists.spec.ts`），按 `scripts/gate.sh visual` 档取读数——`GATE RESULT: 15/15 PASS（SKIP 0）`，
   退出码 0。真机场景 `269-list-enter-indent` PASS（16 断言，0 FAIL；`status.txt` = `PASS`），
   证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/269-list-enter-indent/`
   （`steps.md` / `shots/` / `ax/`）。未更新视觉基线。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   13 份 delta，13 条 MODIFIED，对比 239 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`
   （退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 40
   passed, 0 failed (40 items)`（退出码 0）。归档跟踪队列有且仅有一条本 change 条目
   （`docs/backlog.md`）。delta 是 `editor-live-preview` 的 1 条 MODIFIED（「Enter 换行与自动缩进」
   整条复制后改），是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项、无影响面升级、评审结论与
tip 均无异常、证据无缺口，故不另送 Alex。

## Why

Alex 原话：「段首输入 `- ` 后，下一行缩进」。只读复现报告
（`/Users/boxcounter/Code/Boxcounter/lumir/.local/reports/list-enter-indent-nov21/README.md`）
把现场拆成三档后，唯一可确认为实现缺陷的是 **P0**：md 没有缩进规则，
`src/enter-indent.ts` 在 md 散文 / 列表续行上落回 `insertNewlineAndIndent`，而它在
`getIndentation` 返回 null 时照抄**当前行行首空白**——这份空白对散文与「段首 marker 行」
都不是结构：

- `alpha\n  + `（裸空项）按 `Enter` 后该行留 `  `（前导 2、光标列 2），随后键入的字符把空格
  当可见字符渲染；
- `alpha\n  - `（setext 下线）按 `Enter` 后新行是 `  `；
- 同一回落对 `  prose` 这类行首带空白的段落也把空白复制给新行。

报告里的第 6/8 行（`- a\n  text`、`alpha\n  * a`）与代码块 / 引用不属于这条回落：前两者由
上游 `insertNewlineContinueMarkupCommand` 接管，缩进是列表项正文列（结构的一部分）；后两者
分别是代码与引用语义。本 change 只收窄回落，这几类作为对照 MUST NOT 改变。

## What Changes

- **回落收窄**：md 模式下，只有光标在围栏代码块 / 缩进代码块内时 `Enter` 才走
  `insertNewlineAndIndent`（沿用当前行行首空白）；其余 md 散文与列表续行改为裸换行。
  `editor.auto_indent = false` 的既有回退与「md 列表 / 引用续行不受开关影响」的口径不变。
- **裸行空项退出**：`enterBareMarkerLine` 的空项分支删到**行首缩进之后**而不是 marker 起点——
  合法 `>` 引用前缀保留，纯空白缩进随 marker 一并删去；光标落在删后位置（新行行首）。
  行首缩进与引用前缀的拆分落在 `src/preview/lists.ts` 的同一份 `markerTextAt` 判定里
  （`quote` / `indent` 两段，仍是一处真源）。
- 裸行有内容续行、真列表续行、M399 空项退出、Backspace 删 marker 的既有行为逐字节不变。

## Non-goals

- **不改上游续行**：`- a\n  text`（项内段落续行，新行复用的是项正文列）与
  `alpha\n  * a`（`* a` 能打断段落，是真列表项）保持既有输出，本 change 只把它们写进对照断言。
- **不改 M399 空项退出**（删一级标记、行保留、不新增行）。
- **不做「首项续行」方案**：空项 Enter 之后是否要新增一行并落列 0（报告 P1，与 M399 裁决冲突）
  不在本 change 内，需 Alex 另行裁决。
- **不改渲染层**：段首输入 `- ` 后原有 1–3 空格续行被改判为项内的 P2 边界
  （`docs/specs/lists.md` 已知边界 2）不在本 change 内。

## Impact

- 影响的 specs：`editor-live-preview`（「Enter 换行与自动缩进」requirement，整条 MODIFIED）
- 影响的代码/系统：`src/enter-indent.ts`（回落分派）、`src/preview/lists.ts`（行首前缀拆分）、
  `tests/unit/enter-indent.test.ts`、`tests/unit/ordered-list-auto-mode.test.ts`、
  `tests/visual/scenes/{m264-enter-auto-indent,lists}.spec.ts`、验收场景与覆盖表
- 关联约束：ADR 0003 §3（装饰不改文档——本 change 只改显式编辑动作，不改渲染）；
  ADR 0004（agent 起草与实现）；`docs/specs/lists.md` 的 L1/L2/B1–B3 与「纯空白行不写」口径
