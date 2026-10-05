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

系统 SHALL 将内容区泛化为 **pane 容器**：v1 上限**两个**横向 pane，每个 pane 承载一组文档
标签（各带标签条）。不做 Emacs 式任意递归分窗，MUST NOT 提供三 pane 及以上，MUST NOT 提供
纵向分栏。界面的内容层布局上限因此恒为：树 | pane | pane。

pane 的分栏与收起 SHALL 只经 `pane.split` / `pane.close` 命令与标签的跨 pane 移动（见
「会话所有权」）发生；MUST NOT 存在第二条分栏 / 收起通道。常态（未分栏）时界面 SHALL 与
pane 化之前逐像素一致：骨架几何、标签条位置、正文呈现均不变。

空 pane（无标签）是合法状态：移动标签使某 pane 变空时该 pane SHALL 保持在场，MUST NOT
自动收起。

#### Scenario: 分栏后出现两个文档 pane

- **WHEN** 已打开一个文档，执行 `pane.split`
- **THEN** 内容区出现两个横向 pane：原 pane 保持其标签与前台文档，新 pane 为空态（标签条在场、
  正文区为空 pane 引导）；新 pane 成为活跃 pane

#### Scenario: 单 pane 常态与现状一致

- **WHEN** 未分栏（全程单 pane）时打开、编辑、切换文档
- **THEN** 骨架几何、标签条位置与正文呈现与 pane 化之前逐像素一致；不出现任何 pane 相关的新
  视觉元素（无分隔条、无第二标签条）

#### Scenario: 上限二——再分栏无操作

- **WHEN** 已是双 pane 时再执行 `pane.split`
- **THEN** 无操作：布局不变、无报错、无提示（v1 上限二是有意约束，不是待填能力）

#### Scenario: 移动标签致空 pane 不自动收起

- **WHEN** 双 pane 中 pane B 只有一个标签，把它移到 pane A
- **THEN** pane B 变空但保持在场（空态引导），MUST NOT 自动收起；执行 `pane.close` 才收起

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
