# Proposal: 修复段首 marker 后 Enter 的下一行无意义缩进

- Change ID: `fix-list-enter-indent-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（原始缺陷报告、裁决），AI agent（诊断 / 起草 / 实现）

> 评审记录
> 节点 1：Alex 报告「段首输入 `- ` 后，下一行缩进」，并要求直接处理。本 change 只修
> `Enter` 在 md 散文 / 列表续行回落里照抄行首空白这一条，不新增产品形态、不改上游续行。

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
