# Proposal: 非空选区删除保真——跨渲染隐藏区时只删选区源码

- Change ID: `fix-selection-delete-across-widgets-nov19`
- 日期: 2026-11-19
- 角色: Alex Lee（原始需求与裁决），AI agent（起草 / 实现）

> 评审记录
> 节点 1（提案评审）：来源是 Alex 的原始要求**「主动修复同类问题，合同需覆盖整个类别而非当前案例」**
> （M854 mission 的 Context 原文），以及 M842 双引擎对抗矩阵发现的缺陷
> （finding `20261119-worker-markdown-stability-bug-dom`）。tower 在 M854 的 mission 指令中据此
> 立项并指定「非空选区删除统一走显式 CM 事务，不得按 DOM 形状猜意图或只修表格」。本 change
> 不引入新的产品行为或裁决点：修复面与合同范围由该要求与既有规格的编辑保真条款直接决定。

## Why

### 现场

M842 在 chromium + Playwright WebKit 上发现：选区任一端落在**渲染隐藏区**（表格 cell 间的
管道 / 整行被 `Decoration.replace` 覆盖的分隔行、列表 marker 的隐藏源码区间）时，按
Backspace / Delete 删除选区走浏览器原生路径，CM 的 `DOMReader` 把渲染结果回写源码：

- 表格 `| a | b |\n| --- | --- |\n| c | d |\n` 选 `[2,32)` 删除，期望 `| |\n`，两引擎得
  `| \n|\n`（表格结构被摧毁）；
- 混合列表 `- a\n- b\n\n1. c\n` 选 `[3,9)` 删除，期望 `- a1. c\n`，chromium 得
  `- a\n1.\nc\n`（多出换行）、WebKit 得 `- a1.c\n`（丢一个空格）；
- `⌘S` 把损坏结果落盘；一次 undo 可复原（损坏发生在一次事务内）。

既有规格 `editor-live-preview` 的「跨 replace 装饰的跨行删除」条声称「非空选区删除……
MUST NOT 被本接管改变——实测它们不会重建被吸收行的 DOM」，本现场是该假设的反例。

### 修复口径

M854 探针（两引擎，程序化选区）坐实：`setCaret` 落到 CM state 的选区与目标源码 range 逐值
一致、文档未被触碰；`beforeinput` 的 `inputType` 是 `deleteContentBackward`、
`defaultPrevented=false`（确实走原生路径）；原生删除结果与「删掉该源码 range」不一致，且两
引擎损坏形状不同；同一 range 的显式事务两引擎都逐字节正确。因此失真来自 DOM 回写，不在
选区测量。

## What Changes

- `src/editor.ts` 的 beforeinput 闸门从「空光标行边界」扩到**整个删除类别**：`EditorState`
  里有非空选区时，删除类 inputType（`deleteContentBackward/Forward`、词删除、行删除四个变体）
  一律 `preventDefault` + 按 `state.selection` 的源码字节 dispatch **一个**显式事务；判据只读
  state，不检测 widget、不读 DOM 文本形状、不按渲染形状猜删除粒度。
- 空光标行边界合并（M836）与 IME / 只读 / 普通单区间选区的字节结果保持不变。
- 回归：`tests/visual/scenes/markdown-editing-stability.spec.ts` 的 `test.fail` 转正，覆盖
  表格跨行（正 / 反向 / Delete）、混合列表、marker 内部端点、普通文本、undo/redo 与 `⌘S`
  精确落盘；新增真机场景 `266-selection-delete-widgets`。
- 规格：修改 `editor-live-preview` 的既有 requirement 中已被证伪的「非空选区删除不接管」句，
  并新增「跨渲染隐藏区的非空选区删除」requirement。

## 裁决点 / 边界（如实声明）

- **空光标的行内删除不在本 change 内**：WebKit 在表格 cell 端点的单字符键入 / Backspace /
  Delete 同样按 DOM 回写（finding `20261119-worker-markdown-stability-bug-webkit-cell`），但
  入口是键入与单字符删除、判据需要表格装饰层的隐藏区间，合同不同、范围更大；本次不扩。
- **多区间（多光标）**：`EditorState.allowMultipleSelections` 当前未启用；闸门仍按
  `state.selection` 逐区间生成 changes（不读 DOM），保证未来启用时合同不变。
- **不引入兼容层**：闸门命中时删除结果与原生对普通选区的语义一致（删掉选区），无旧路径需要
  保留；`文档改动默认直接切断`。
