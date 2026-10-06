# pane-layout Specification

## Purpose

定义内容区 pane 容器（split view）的落地口径：内容区泛化为 pane 容器（v1 上限两个横向 pane，
每个 pane 承载一组文档标签、各带标签条）；活跃编辑器 pane 与焦点解耦（Emacs selected-window
语义）；会话所有权为「移动标签非复制」（一份文件同一时刻至多在一个 pane 打开，`killSlot` 保持
全局单例）；pane 命令族（`pane.split` / `pane.close` / `pane.other`）。能力边界以
[ADR 0008](../../../docs/adr/0008-pane-system-split-view-and-harness.md) 的 Phase 1 为准——
harness 归位 pane 属 Phase 2，不在本 capability。由 change `pane-system-split-view` 归档并入
（2026-10-05，实现 M315–M322）。

## Requirements

### Requirement: pane 容器模型

系统 SHALL 将内容区泛化为 **pane 容器**：v1 上限**两个**横向 pane，每个 pane 承载「一组文档标签（各带标签条）」**或「harness 面板」**之一（ADR 0008 Decision 1；harness pane 的行为见「harness pane」条款）。不做 Emacs 式任意递归分窗，MUST NOT 提供三 pane 及以上，MUST NOT 提供纵向分栏。界面的内容层布局上限因此恒为：树 | pane | pane——harness 在场时文档 pane 至多一个。

pane 的分栏与收起 SHALL 只经 `pane.split` / `pane.close` / `harness.toggle` 命令与标签的跨 pane 移动（见「会话所有权」）发生；MUST NOT 存在第二条分栏 / 收起通道。常态（未分栏、无 harness）时界面 SHALL 与 pane 化之前逐像素一致：骨架几何、标签条位置、正文呈现均不变。

空 pane（无标签）是合法状态：移动标签使某文档 pane 变空时该 pane SHALL 保持在场，MUST NOT 自动收起。

#### Scenario: 分栏后出现两个文档 pane

- **WHEN** 已打开一个文档，执行 `pane.split`
- **THEN** 内容区出现两个横向 pane：原 pane 保持其标签与前台文档，新 pane 为空态（标签条在场、正文区为空 pane 引导）；新 pane 成为活跃 pane

#### Scenario: 单 pane 常态与现状一致

- **WHEN** 未分栏（全程单 pane、无 harness）时打开、编辑、切换文档
- **THEN** 骨架几何、标签条位置与正文呈现与 pane 化之前逐像素一致；不出现任何 pane 相关的新视觉元素（无分隔条、无第二标签条）

#### Scenario: 上限二——再分栏无操作

- **WHEN** 已是双 pane（含 harness pane 在场）时再执行 `pane.split`
- **THEN** 无操作：布局不变、无报错、无提示（v1 上限二是有意约束，不是待填能力）

#### Scenario: 移动标签致空 pane 不自动收起

- **WHEN** 双 pane 中 pane B 只有一个标签，把它移到 pane A
- **THEN** pane B 变空但保持在场（空态引导），MUST NOT 自动收起；执行 `pane.close` 才收起

### Requirement: 分栏态空 pane 不接受文本输入

分栏态下的**空 pane** MUST NOT 接受文本输入。该 pane 的编辑器 SHALL 处于**结构性只读**：键入、粘贴、输入法合成与拖放文本一律不落进文档。只读 MUST NOT 用「可编辑面在场、按键在 DOM 层被吞」冒充——它须由编辑器可编辑性本身拒收（MUST NOT 出现「看起来能输入、实际输入被静默丢弃」的假只读形态）。

**本条款只适用于文档 pane**；harness pane MUST NOT 被本条款判定为空 pane（它不承载标签与文档会话，其输入区是面板自身能力，见「harness pane」条款）。

只读 MUST NOT 影响可聚焦性：点击该 pane 的正文区 SHALL 仍使它成为活跃 pane（活跃 pane 与可编辑性是两个正交概念），modeline 等跟随面照常显示「无当前文件」。

「空 pane」SHALL 按**同一条口径**判定（与空 pane 引导的在场判据同源，两处 MUST NOT 各写一份表达式）：分栏态，且该 pane **既没有带路径的标签、其前台也没有带未保存内容的未命名草稿**——三条同时成立。带路径的会话才算文档（未命名文档不是标签，与标签栏的可见标签口径同源）。

**带未保存内容的未命名草稿 MUST NOT 受本条款约束**：分栏前在单 pane 空态 scratch 里写下的内容，分栏后 SHALL 保持可编辑（继续键入与撤销照常可用），MUST NOT 被静默冻结；该 pane 也 MUST NOT 显示空 pane 引导（引导是「无内容可编辑」时的替代表面，不得盖住用户内容）。这一豁免不会重新打开本条款要堵的口子：空 pane 一旦被封锁，其空会话恒为 clean（输入落不进文档），所以「分栏态 + 无带路径标签 + 前台是未保存草稿」只可能来自分栏前就在编辑的那份草稿。

该 pane 出现带路径标签之后——在该 pane 打开 / 新建文件——SHALL 恢复可编辑。

单 pane 常态（未分栏）的空态 scratch MUST NOT 受本条款约束：M149 起的「单 pane 空态即未命名草稿、可直接键入」形态保持不变。

#### Scenario: 分栏得到的空 pane 不接受输入

- **WHEN** 单 pane 开着 `a.md`，执行 `pane.split` 得到双 pane、焦点落在空 pane，在该 pane 内键入字符
- **THEN** 文档内容不变、该 pane 不出现未保存修改；按 ⌘S MUST NOT 产生任何提示（尤其 MUST NOT 出现为一份不存在的文档报的「No file is open…」）；该 pane 仍可聚焦，点击其正文区仍使它成为活跃 pane

#### Scenario: 分栏不冻结带内容的 scratch

- **WHEN** 单 pane（未分栏）空态 scratch 里键入若干字符（未保存），随后执行 `pane.split`
- **THEN** scratch 所在 pane 保持可编辑（继续键入与 ⌘Z 撤销照常可用），MUST NOT 被静默冻结；该 pane MUST NOT 显示空 pane 引导

#### Scenario: 空 pane 打开文件后恢复可编辑

- **WHEN** 双 pane（A | B），B 为空且不接受输入；从文件树在 B 打开 `b.md`
- **THEN** B 出现 `b.md` 标签且恢复可编辑（键入落地、保存链路可用）；MUST NOT 停在只读

#### Scenario: 单 pane 空态 scratch 不受此限

- **WHEN** 单 pane（未分栏）、零标签时在正文区键入
- **THEN** 按键照常落进未命名文档（M149 既有形态），可编辑性与保存提示口径与 pane 化之前一致

### Requirement: 活跃编辑器 pane 与焦点解耦

系统 SHALL 维护**活跃编辑器 pane** 概念，与「焦点所在」解耦（Emacs selected-window 语义）：
焦点进入某 pane 的 contentDOM SHALL 使该 pane 成为活跃 pane；焦点移出内容区到 chrome
（文件树、modeline、浮层、搜索框、键位面板、harness 面板输入框）MUST NOT 改变活跃 pane。
只有一个 pane 时活跃 pane SHALL 恒为该 pane。

编辑器命令、modeline（当前文件 / 位置 / 行数）、文件树高亮、toc 浮层内容源的跟随对象
SHALL 一律是活跃 pane 的前台标签；活跃 pane 切换后这些跟随面 SHALL 在同一帧内换源。

#### Scenario: 焦点在 pane B 时命令打到 B

- **WHEN** 双 pane（A | B），焦点在 B 的 contentDOM 里，按 ⌃A（行首）
- **THEN** 光标折叠到 B 前台文档所在行的行首；A 的文档与选区不受影响

#### Scenario: 焦点移到 chrome 后活跃 pane 不变

- **WHEN** 焦点在 pane B 的 contentDOM，随后点进文件树或打开大纲浮层（焦点离开内容区），
  再按经 `[keys]` 绑定到某编辑动作的键
- **THEN** 活跃 pane 仍是 B：modeline 仍显示 B 的前台文档、树高亮仍跟随 B、toc 内容源仍是
  B 的文档；MUST NOT 因为焦点在 chrome 而把跟随面漂到 pane A

#### Scenario: 活跃 pane 切换后跟随面同帧换源

- **WHEN** 双 pane，焦点在 A，随后点击 B 的 contentDOM
- **THEN** B 成为活跃 pane；modeline、文件树高亮、toc 内容源在同一帧内切到 B 的前台标签，
  A 的文档状态（选区 / 滚动 / 撤销史）原样保留

### Requirement: 标签条交互的活跃 pane 落点

用户与某 pane 标签条的交互——点击标签（切换前台）与点击关闭钮（关标签）——SHALL 先使**该标签
条所属 pane** 成为活跃 pane，再跑表现层同步点（`syncActiveDocument`）。落点对象是被交互标签条
所属的 pane，与交互时哪个 pane 活跃无关。

该次序 MUST NOT 颠倒：会话内容的按需装载挂在同步点上、按活跃 pane 的前台文档解析；pane 未先
翻过去时，同步点解到的是另一个 pane 的会话，被操作标签的文档因此不会被装载（表现为「点了标签
但正文不加载、要先点一下正文区把它激活才加载」）。

窗口级命令（⌘W / ⌃⇥ / ⌘1–9）作用于活跃 pane 的标签条，其落点由「活跃 pane」唯一确定，本条款
对它们不产生额外约束。

#### Scenario: 点非活跃 pane 的标签立即装载其文档

- **WHEN** 双 pane（A | B），活跃 pane 是 A；B 的标签条上有一条内容尚未装载的标签，点击它
- **THEN** B 成为活跃 pane 且该标签成为 B 的前台，其文档随即装载并呈现在 B 的正文区；
  MUST NOT 出现「标签已选中但正文为空、需再点一次正文区才装载」的形态

#### Scenario: 点非活跃 pane 的关闭钮，该 pane 成为活跃 pane

- **WHEN** 双 pane（A | B），活跃 pane 是 A；点击 B 标签条上某条标签的关闭钮
- **THEN** B 先成为活跃 pane，再按既有关闭口径关闭该标签（脏标签先经关标签确认，MUST NOT
  跳过确认）；关闭后跟随面（modeline / 文件树高亮 / toc 内容源）显示 B 的前台标签，B 变空时
  显示「无当前文件」

### Requirement: 会话所有权——移动标签，非复制

系统 SHALL 保证一份文件同一时刻至多在**一个** pane 打开：在 pane B 里「打开」已在 pane A
打开的文件时，SHALL 执行**移动标签**（标签带其 `EditorState`——撤销史、语法树、选区——与
滚动位置整体迁到 pane B 并成为其前台），MUST NOT 在 B 里复制第二个标签，MUST NOT 为该文件
创建第二个 `EditorState`。移动 MUST NOT 重建 `EditorState`、MUST NOT 重新解析文档、MUST NOT
制造撤销事件（装载事务 `addToHistory(false)` 口径随移动复用）。

「打开」意图落在**活跃 pane**：一切打开动作（文件树单击 / 双击 / ⌘-点击、文档内链接跟随、
序号直达）的目标 pane SHALL 是活跃 pane；命中他 pane 已开的同文件时按移动处理。

`killSlot`（kill 槽）SHALL 保持全局单例：`⌃K` 在 pane A 杀的槽，活跃 pane 切到 B 后 `⌃Y`
SHALL 插入 B 的文档（kill ring 在 Emacs 本就是全局的）。本版 MUST NOT 提供同文件双 pane
对照（共享 buffer 的「单 `EditorState` 双 `EditorView`」不在 v1）。

#### Scenario: 跨 pane 打开已开文件是移动不是复制

- **WHEN** 双 pane，A 开着 `x.md`（已编辑、有撤销史、滚到中部），焦点在 B，从文件树打开 `x.md`
- **THEN** `x.md` 的标签从 A 移到 B 并成为 B 的前台：标签总数不变，A 不再有 `x.md`；
  移动后 `x.md` 的撤销史、选区、滚动位置原样保留，MUST NOT 停在篇首，MUST NOT 出现第二个
  `x.md` 标签

#### Scenario: 移动不制造撤销事件

- **WHEN** 在 A 的 `x.md` 里输入若干字符（未保存），把 `x.md` 移到 B，在 B 里按 ⌘Z
- **THEN** 撤回的是刚才输入的字符（撤销栈随标签迁移）；MUST NOT 出现「移动」本身成为一次
  可撤销操作的形态

#### Scenario: kill-yank 跨 pane 同槽

- **WHEN** 焦点在 A，按 ⌃K 杀掉一行；随后点击 B 的 contentDOM 把活跃 pane 切到 B，按 ⌃Y
- **THEN** B 的文档插入 A 杀掉的行（全局单槽生效）；A 的文档不含被插回的内容

### Requirement: pane 命令族——分栏 / 收起 / 切换活跃

系统 SHALL 提供 pane 命令族，命令 id SHALL 为 `pane.split`、`pane.close`、`pane.other`，
作用域一律 SHALL 为 `global`（pane 是窗口级对象，焦点在 chrome 上时同样要能操作，与
`tab.*` 同族理由），实现 SHALL 落在装配层（`src/main.ts`），能力 SHALL 在 pane 容器模块。

默认键位 SHALL 取单段 ⌥ 系（v1 不引入 `C-x` 前缀；⌥G 代 `M-g M-g` 的既有先例）：起草倾向
⌥S → `pane.split`、⌥O → `pane.other`、⌥W → `pane.close`（裁决点，具体值以节点 1 落槌为准；
无论落槌何值，绑定 SHALL 是单段、无空白，`[keys]` 可重绑 / 解绑，键位占用按三条独立来源
——表内 / 原生菜单 accelerator / 系统级——核对零冲突并写入绑定 `doc`）。三条命令 SHALL 进
`KEY_BINDINGS` 与 `GLOBAL_COMMAND_IDS`，`app.describe-bindings` 面板 SHALL 自动列出它们，
`COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者对账的不变量 SHALL 逐条保持。

语义：`pane.split` SHALL 在活跃 pane 旁侧新开空 pane（已达上限二时为无操作）；
`pane.close` SHALL 收起活跃 pane 并将其全部标签按序并入另一 pane（各带状态，该 pane 的原
前台标签成为目标 pane 前台）——收起 MUST NOT 丢标签、MUST NOT 触发关标签确认（移动不丢
内容）；`pane.other` SHALL 把活跃 pane 切到另一个 pane（单 pane 时为无操作）。

#### Scenario: 分栏、切换、收起全流程

- **WHEN** 单 pane 开着 `a.md`，执行 `pane.split`；随后执行 `pane.other` 两次；随后在活跃 pane
  打开 `b.md`，再执行 `pane.close`
- **THEN** 第一次 split 后出现双栏且新 pane 活跃；两次 `pane.other` 在 A、B 间往返切活跃；
  `b.md` 落在当时的活跃 pane；最后 `pane.close` 收起活跃 pane，其全部标签并入另一 pane，
  回到单 pane 常态且无任何标签丢失

#### Scenario: 单 pane 时 other 无操作、close 无操作

- **WHEN** 单 pane 时执行 `pane.other` 或 `pane.close`
- **THEN** 无操作：布局、活跃 pane、标签全部不变，无报错、无提示

#### Scenario: 表的不变量与键位核对留痕

- **WHEN** 装配应用并对账 `COMMAND_IDS` / `KEY_BINDINGS` / `KEYLESS_COMMAND_IDS` 三者；
  查阅 pane 命令绑定的 `doc` 字段
- **THEN** 三条新命令都有默认绑定、不在默认不绑键清单里、表内无重复绑定、无孤儿命令；
  每条绑定的 `doc` 写明默认键位的来由（⌥ 系单段先例）与三条来源的零冲突核对结论

### Requirement: harness pane

harness 对话面板 SHALL 作为 pane 容器的一种内容件存在：一个 pane 要么承载一组文档标签，要么是 harness pane，二者必居其一。harness pane SHALL NOT 承载标签条与文档会话；「分栏态空 pane 不接受文本输入」条款 SHALL NOT 适用于 harness pane（它不是空 pane，其可编辑性是面板自身的输入区）。pane 命令族对 harness pane 的语义：`pane.close` 于 harness pane SHALL 等价于关闭 harness（同 `harness.toggle` 收起路径）；`pane.other` SHALL 可在文档 pane 与 harness pane 之间切换活跃；harness 在场时 `pane.split` SHALL 为无操作（上限二）。harness pane 的打开 SHALL 由 `harness.toggle` 承担：无第二 pane 时自动分栏（默认宽度比 harness:文档 pane = 1:2），已有第二 pane 时该 pane 的文档标签并入另一 pane 后换位为 harness（沿用「移动标签非复制」口径，MUST NOT 丢标签）。

#### Scenario: 无第二 pane 时自动分栏打开

- **WHEN** 单 pane 开着文档，执行 `harness.toggle`
- **THEN** 自动分栏：文档 pane 与 harness pane 按 2:1 宽度出现；文档标签与活跃 pane 归属不受影响

#### Scenario: 已有双文档 pane 时换位打开

- **WHEN** 已是双文档 pane（A | B），执行 `harness.toggle`
- **THEN** 其中一个 pane 换位为 harness pane，其文档标签按移动口径并入另一 pane——标签总数不变、无标签丢失、不触发关标签确认

#### Scenario: pane.close 于 harness pane

- **WHEN** harness pane 活跃时执行 `pane.close`
- **THEN** harness 收起（等价 `harness.toggle`），回到单文档 pane；无确认、无报错
