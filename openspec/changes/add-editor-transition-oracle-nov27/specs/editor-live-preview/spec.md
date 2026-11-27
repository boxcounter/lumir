# Delta: editor-live-preview

## ADDED Requirements

### Requirement: 编辑状态迁移矩阵与独立对照模型

正文编辑行为 SHALL 由一个**独立对照模型**（不 import 生产代码，期望值全部由模型算出）按
「状态 × 选区形态 × 上下文 × 动作」四维给出期望值，并由机器在真实 `EditorView` 上跑同一矩阵。
状态维 MUST 至少含 `idle`、`composing`（`compositionstart` 到 `compositionend`，含尚未产生
组合改动的窗口）、`settling`（`compositionend` 之后、组合结算回调之前）、`readOnly`；选区维
MUST 含折叠光标与非空选区；上下文维 MUST 至少含纯文本、行内 replace 装饰（wikilink / 行内公式 /
强调隐藏标记）、块级 replace 装饰（块级公式 / mermaid 图表）、列表 marker、表格 cell；动作维
MUST 至少含键入、删除（前删 / 后删）、Enter、粘贴、指针。

矩阵的每一格 SHALL 统一断言五条不变量，缺一不可：

1. **源码**：动作后的 `EditorState.doc` 逐字节等于模型期望；
2. **选区**：`state.selection.main` 的 anchor / head 等于模型期望；
3. **一次撤销**：一次 undo 恢复动作前的源码与选区，一次 redo 恢复动作后的状态。组合期的撤销语义归 IME
   提交事件（CodeMirror 把 `input.type.compose` 并入上一笔 changes），合成通道无法忠实复现该粒度；
   模型对该状态给 `steps: null`（不判），矩阵 MUST 在 N/A 口径里写明理由，MUST NOT 记为通过；
4. **非目标行不变**：动作未触及的源码行逐字节不变——删除与键入只改其目标源码区间；
5. **渲染字形不落盘**：`⌘S` 的保存载荷逐字节等于当前 `EditorState.doc`，且源码 MUST NOT 出现
   只存在于渲染层的字形（列表 marker glyph `–` / `◦`、链接尾标 `→`）。

**区分度前提**：每格在动作前 SHALL 断言该上下文的 replace 装饰确实在场；装饰缺席即 FAIL——
没有装饰的格对 DOM 回写类缺陷没有区分度，MUST NOT 以「无事发生」记为通过。纯文本格作为对照组，
SHALL 断言目标行不含上述任何 replace 装饰。

覆盖策略 SHALL 是「高风险组合全覆盖 + 其余 pairwise」：高风险族——① 非空选区跨渲染隐藏区的
删除与键入替换；② 折叠光标在 replace 装饰边界上的跨行合并；③ 表格 cell 内的原生键入与单字符
删除；④ 组合中的删除与提交；⑤ 组合结算窗口内的编辑；⑥ 只读会话的全部编辑动作——MUST 逐个取
值展开；其余组合 MUST 用 pairwise 覆盖全部**可行**取值对。矩阵 MUST NOT 全笛卡尔展开，规模与
可行性 MUST 由测试机器判定：每个取值对都至少出现在一格中，出现不可行组合（无合同条款 /
无法在真实引擎上驱动）MUST 在矩阵定义里写明理由，MUST NOT 静默丢弃。

接管判据 MUST 只读 `EditorState` 与输入事件类型，MUST NOT 按 widget 类型、DOM 或 AX 的文本
形状分支；因此上下文不改变期望值，只改变缺陷是否可观察。矩阵 MUST NOT 从生产常量或生产判定
反推期望值，MUST NOT 用生产代码计算「期望」。

#### Scenario: 只读会话的全部编辑动作空转

- **GIVEN** vault 外只读会话（`state.readOnly` 为真、`contenteditable=false`），文档含列表
  marker / 表格 / wikilink
- **WHEN** 依次键入、Backspace、Delete、Enter、粘贴
- **THEN** 每一拍后 `EditorState.doc` 与选区逐字节不变，撤销栈不新增事件，保存载荷不变

#### Scenario: 组合中的删除只吃 marked 区

- **GIVEN** 列表内容起点上的 IME 组合（`view.compositionStarted` 为真），marked 文本非空
- **WHEN** 组合中按一次 Backspace
- **THEN** 只删 marked 区的最后一个字素簇，已提交文本与 marker 源码逐字节保留；marked 区已空时
  起点处再按 Backspace MUST NOT 改动文档

#### Scenario: 非空选区跨渲染隐藏区

- **GIVEN** 文档含 wikilink / 块级公式 / 表格 grid / 有序列表，选区端点落在隐藏源码区间内部
- **WHEN** 键入替换 / 删除 / 粘贴
- **THEN** 文档恰好等于选区源码字节被替换后的结果，MUST NOT 出现重建的表格行、被吞的 marker
  或被写进源码的渲染字形；一次 undo 恢复原文与选区

#### Scenario: 组合结算窗口内的编辑按同一判据落点

- **GIVEN** 真实 `compositionend` 之后、列表异步结算回调之前
- **WHEN** 在同一同步拍内执行删除或键入
- **THEN** 源码结果与 `idle` 态同一格逐字节相等；结算回调完成后源码与选区 MUST NOT 再变化

#### Scenario: 矩阵规模与覆盖机器可判

- **WHEN** 跑矩阵覆盖契约测试
- **THEN** 打印状态 / 选区 / 上下文 / 动作四维的取值数、矩阵格数、可行取值对总数与覆盖数；
  任一可行取值对未被覆盖、任一高风险族缺格、任一格缺预期值或缺 case 即 FAIL
- **AND** 格数 MUST 小于全笛卡尔积（含不可行组合的四维乘积），证明没有退化成暴力穷举
