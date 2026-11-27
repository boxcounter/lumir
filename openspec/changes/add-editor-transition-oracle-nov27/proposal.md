# Proposal: 编辑状态迁移矩阵与独立对照模型

- Change ID: `add-editor-transition-oracle-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（评审 / 裁决），AI agent（起草与实现）

> 评审记录
> 节点 1：Alex 已采纳 2026-11-27 编辑器治理复盘的最小下一层防线 P0「编辑状态迁移矩阵 + 独立
> oracle」；tower 派发本 change 时记录「节点 1 已批准」。本 proposal 把该裁决落成可执行的
> 制品清单与不变量条款，不新增产品行为。

## Why

编辑器反复出现的缺陷不是同一个 bug 复发，而是**同一操作换一个上下文就漏**：跨 replace 装饰的
删除（M836）、跨渲染隐藏区的非空选区编辑（M854）、表格 cell 内的原生键入与删除（M855）、
折叠光标的字素前删（M860）分别修好了一条路径，但每次修复的判据都只覆盖「已知的那个上下文 +
那个动作」，新的上下文组合没有机器判据。复盘据此把「编辑状态迁移矩阵 + 独立对照模型」列为 P0，
理由与证据：

- 现有 `tests/unit/editing-oracle-model.ts` 已有正文 / composer 两个独立模型与随机对拍，但
  **没有状态维**：正文不建模 IME 组合 / 组合结算 / 只读，只覆盖单一的 idle 路径。
  （`tests/unit/editing-oracle.test.ts` 的正文 world 清单：plain / empty-list / bare-marker /
  mixed-list。）
- 逐帧能力已在（`tests/visual/scenes/markdown-editing-stability.spec.ts`），缺的是**输入序列 ×
  状态 × 上下文 × 动作**这一维的覆盖；静态像素守不了「同一操作换上下文」的漏。
- 生产闸门本身是「只读 `EditorState`、不识别 widget」的统一判据（`src/editor.ts` 的
  `absorbNativeEdit`），因此上下文不改变**期望值**，只改变**缺陷是否可被观察**——矩阵必须在
  动作前断言该上下文的 replace 装饰确实在场，否则该格对 DOM 回写类缺陷没有区分度。

## What Changes

- 在 `tests/unit/editing-oracle-model.ts` 追加**状态迁移模型**（不 import 生产代码）：
  `EditState`（`idle` / `composing` / `settling` / `readOnly`）× 选区形态（折叠 / 非空）×
  上下文（`plain` / `inline-replace` / `block-replace` / `list-marker` / `table-cell`）×
  动作（键入 / 删除 / Enter / 粘贴 / 指针），每格由模型算出源码、选区、撤销步数与触及行。
- 新增矩阵定义模块（`tests/unit/editor-transition-matrix.ts`）：上下文 fixture、每格的动作
  位置、高风险族清单、pairwise 生成器与覆盖读数。**高风险组合全覆盖 + 其余 pairwise，禁止
  全笛卡尔展开**；矩阵规模与覆盖读数由测试机器可读地打印，覆盖不足即 FAIL。
- 新增机器执行层（`tests/visual/scenes/editor-transition-matrix.spec.ts`）：真 `EditorView`、
  真键盘 / 合成 `beforeinput` / 合成 `CompositionEvent` 驱动四态，逐格断言五条不变量：
  源码逐字节、选区、一次 undo（+ 一次 redo）、非目标行逐字节不变、保存载荷等于
  `EditorState.doc` 且不含只在渲染层出现的字形。
- 每格动作前断言该上下文的 replace 装饰在场（`.cm-lp-wikilink` / `.cm-lp-math-block` /
  `.cm-lp-list-marker` / `.cm-lp-table-cell`）；plain 为对照组，断言目标行没有这些装饰。
- 矩阵的「判红能力」用**反向验证**证明：临时移除 `nativeEditGate`，删除 / 选区 / 表格 cell
  三类高风险格 MUST 变红；恢复后 MUST 全绿。反向验证的读数记进 tasks，不进代码。

## Non-goals

- 不新增产品行为、不修产品缺陷。矩阵发现的新缺陷只给最小复现并上报（本 change 不夹带修复）。
- 不把 `src/editor.ts` 的闸门逻辑抽成新模块：Node 类型剥离层加载不了 `editor.ts` 的 import 图
  （参数属性，既有约束见 `src/cell-geometry.ts` 文件头），本 change 不为可测性重构生产代码。
- 不覆盖原生 IME 手感、候选窗、WKWebView 特有时间序；这些仍归真机套件与 Alex 的手感裁决。
- 不替代 `tests/visual/scenes/editing-oracle.spec.ts` 的随机序列对拍与真机 witness 260。
- 不改视觉基线，不新增依赖。

## Impact

- 影响的 specs：`editor-live-preview`（新增一条 requirement）。
- 影响的代码：仅测试层（`tests/unit/**`、`tests/visual/scenes/**`）；生产代码零改动。
- 关联约束：渲染缺陷合同先行规则（不变量条款 + 属性测试）、ADR 0003 §3 不改写源文件、
  REVIEW.md「断言等价于子串」「读不到当成空」两条假绿教训。
