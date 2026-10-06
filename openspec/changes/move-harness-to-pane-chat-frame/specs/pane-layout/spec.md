# pane-layout Specification Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
