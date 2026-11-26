# pane-layout 增量规格

> 起草注记（非规格正文）：MODIFIED 条只给「分栏态空 pane 不接受文本输入」补**呈现**维度
> （结构性只读前台不画插入光标、点击/选中/焦点归还不改）；其余正文与全部既有 Scenario 逐字
> 保留。ADDED 条「无标签文档 pane 的空态呈现」把本 change 的 S1–S5 代裁收在一处，避免散进
> 行号 / 首启 / vault 三个 capability。根因与实现落点见 [design.md](../../design.md)。

## MODIFIED Requirements

### Requirement: 分栏态空 pane 不接受文本输入

分栏态下的**空 pane** MUST NOT 接受文本输入。该 pane 的编辑器 SHALL 处于**结构性只读**：键入、粘贴、输入法合成与拖放文本一律不落进文档。只读 MUST NOT 用「可编辑面在场、按键在 DOM 层被吞」冒充——它须由编辑器可编辑性本身拒收（MUST NOT 出现「看起来能输入、实际输入被静默丢弃」的假只读形态）。

**本条款只适用于文档 pane**；harness pane MUST NOT 被本条款判定为空 pane（它不承载标签与文档会话，其输入区是面板自身能力，见「harness pane」条款）。

只读 MUST NOT 影响可聚焦性：点击该 pane 的正文区 SHALL 仍使它成为活跃 pane（活跃 pane 与可编辑性是两个正交概念），modeline 等跟随面照常显示「无当前文件」。

**结构性只读前台 SHALL NOT 画 CM 插入光标**（change fix-no-tab-empty-state-nov27）：光标只暗示「这里能打字」，而本条款的输入拒收是结构性的；留着光标会让用户以为编辑器坏了。实现只隐藏光标层（`.cm-cursorLayer`），MUST NOT 隐藏选区层：只读内容 SHALL 仍可选中复制；`tabindex`、`aria-readonly` 与既有焦点归还路径 MUST NOT 改变。该呈现 MUST 按**逐会话的结构性只读标记**决定，MUST NOT 用 `:has()` 从 `contenteditable=false` 反推——vault 外只读会话同样是 `contenteditable=false`，但不属本条款、仍保留光标。空 pane 引导的指针 SHALL 是 `default`（不是 `text`），MUST NOT 新增创建按钮。

「空 pane」SHALL 按**同一条口径**判定（与空 pane 引导的在场判据同源，两处 MUST NOT 各写一份表达式）：分栏态，且该 pane **既没有带路径的标签、其前台也没有带未保存内容的未命名草稿**——三条同时成立。带路径的会话才算文档（未命名文档不是标签，与标签栏的可见标签口径同源）。

**带未保存内容的未命名草稿 MUST NOT 受本条款约束**：分栏前在单 pane 空态 scratch 里写下的内容，分栏后 SHALL 保持可编辑（继续键入与撤销照常可用），MUST NOT 被静默冻结；该 pane 也 MUST NOT 显示空 pane 引导（引导是「无内容可编辑」时的替代表面，不得盖住用户内容）。这一豁免不会重新打开本条款要堵的口子：空 pane 一旦被封锁，其空会话恒为 clean（输入落不进文档），所以「分栏态 + 无带路径标签 + 前台是未保存草稿」只可能来自分栏前就在编辑的那份草稿。

该 pane 出现带路径标签之后——在该 pane 打开 / 新建文件——SHALL 恢复可编辑。

单 pane 常态（未分栏）的空态 scratch MUST NOT 受本条款约束：M149 起的「单 pane 空态即未命名草稿、可直接键入」形态保持不变。

#### Scenario: 分栏得到的空 pane 不接受输入

- **WHEN** 单 pane 开着 `a.md`，执行 `pane.split` 得到双 pane、焦点落在空 pane，在该 pane 内键入字符
- **THEN** 文档内容不变、该 pane 不出现未保存修改；按 ⌘S MUST NOT 产生任何提示（尤其 MUST NOT 出现为一份不存在的文档报的「No file is open…」）；该 pane 仍可聚焦，点击其正文区仍使它成为活跃 pane

#### Scenario: 结构性只读前台不画插入光标、仍可选中复制

- **WHEN** 双 pane 中右 pane 为空（结构性只读），点击其正文区使其成为活跃 pane
- **THEN** 该 pane 不出现 CM 插入光标；`.cm-selectionLayer` 不被本条款隐藏——只读内容若在场，拖选与复制路径逐字不变；`tabindex` 仍为 `0`、`aria-readonly` 仍为 `true`；点击仍激活该 pane；打开带路径文档后光标与可编辑性同帧恢复

#### Scenario: 分栏不冻结带内容的 scratch

- **WHEN** 单 pane（未分栏）空态 scratch 里键入若干字符（未保存），随后执行 `pane.split`
- **THEN** scratch 所在 pane 保持可编辑（继续键入与 ⌘Z 撤销照常可用），MUST NOT 被静默冻结；该 pane MUST NOT 显示空 pane 引导

#### Scenario: 空 pane 打开文件后恢复可编辑

- **WHEN** 双 pane（A | B），B 为空且不接受输入；从文件树在 B 打开 `b.md`
- **THEN** B 出现 `b.md` 标签且恢复可编辑（键入落地、保存链路可用）；MUST NOT 停在只读

#### Scenario: 单 pane 空态 scratch 不受此限

- **WHEN** 单 pane（未分栏）、零标签时在正文区键入
- **THEN** 按键照常落进未命名文档（M149 既有形态），可编辑性与保存提示口径与 pane 化之前一致


## ADDED Requirements

### Requirement: 无标签文档 pane 的空态呈现

任一文档 pane 没有**带路径标签**（`hasTabs=false`，与标签条 / 空 pane 引导同一定义）时，呈现
SHALL 与「有一份文档可编辑」明确区分，MUST NOT 让用户把结构性只读误读成编辑器损坏：

- **行号**：该 pane MUST NOT 显示行号 gutter，包括 `[ui] line_numbers = "on"` 与 `⌥G` 临时档
  （判据见 `keymap-commands` 的「跳转到指定行与行号可见面」与「行号开关命令」两条；本要求不
  另写行号在场判据）。带路径标签进入后按当前档位恢复。
- **单 pane 未命名 scratch**：M149 的形态保持不变——零标签的单 pane 仍可直接键入并落字，不因本
  要求被置只读；它只是没有行号。
- **分栏空 pane 的结构性只读**：前台 MUST NOT 画 CM 插入光标（输入拒收仍由既有
  `EditorView.editable(false)` + `changeFilter` 承担，MUST NOT 用「可编辑面在场、按键被吞」
  冒充）。点击正文区 SHALL 仍使该 pane 成为活跃 pane；只读内容 SHALL 仍可选中复制；
  `tabindex` 与既有焦点归还不改；空 pane 引导的指针 SHALL 是 `default`，MUST NOT 新增创建按钮。
- **首启 tips**：tips 在场时其 doc pane 前台同属结构性只读，同样不画插入光标；tips 的 DOM、
  内容、生命周期与「只覆盖 root doc pane、不盖 harness」的既有形态不变。
- **豁免**：分栏前在单 pane scratch 里写下的未保存草稿，分栏后仍可编辑（继续键入与撤销），
  并照旧有插入光标；它只是没有行号（无带路径标签）。有带路径标签进入后，行号与可编辑光标
  SHALL 在同一同步点恢复。
- **老用户空 vault 覆盖层**：D107 覆盖层 SHALL 只覆盖**活跃 doc pane**，MUST NOT 覆盖 harness
  pane 的正文或 composer；composer 与草稿的可见 / 可输入不受影响。首启 tips 与 D107 覆盖层
  是两条独立表面，不互相替代。
- **不变项**：无 TAB 时 modeline 的口径本要求不改；不把「全部无 TAB」一刀切为只读；不改文档
  内容、dirty、撤销栈、保存链路与配置 schema。

#### Scenario: 单 pane scratch 无行号但可输入

- **WHEN** `ui.line_numbers = "on"`，打开一份文档（有 gutter），关掉最后一个标签
- **THEN** gutter 消失；正文仍可点击聚焦并键入，字符落进未命名文档；不出现结构性只读标记与
  光标隐藏；重新打开带路径文档后 gutter 按 `on` 档恢复

#### Scenario: 分栏空 pane 无行号、无光标、键入无效但可激活

- **WHEN** `ui.line_numbers = "on"`，双 pane 中一个 pane 无标签，点击该 pane 正文并键入字符
- **THEN** 该 pane 没有行号 gutter、不画插入光标、键入不改变文档；点击使它成为活跃 pane
  （modeline 显示「无当前文件」），`tabindex` / `aria-readonly` 照旧；原先打开的只读内容仍可
  选中复制；在该 pane 打开带路径文档后，gutter、可编辑与光标同帧恢复

#### Scenario: 首启 tips 与老用户空 vault 覆盖层都不盖 harness

- **WHEN** 真正首次启动的首个空 vault（tips + 默认 harness），或老用户空 vault 打开 harness
- **THEN** tips / D107 覆盖层只占 doc pane 的矩形，与 harness pane 不重叠；harness 的 composer
  可见、可聚焦、可输入；tips 时 doc pane 前台不画插入光标，且没有行号 gutter
