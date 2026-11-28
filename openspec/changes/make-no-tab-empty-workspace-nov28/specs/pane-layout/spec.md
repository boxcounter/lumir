# pane-layout 增量规格

> 起草注记（非规格正文）：本 change 把「无 Tab」收敛为空工作区。旧的「分栏态空 pane 不接受文本
> 输入」与「无标签文档 pane 的空态呈现」两条整条移除（改名 / 合并通道 = REMOVED + ADDED，先例见
> change `rework-list-tab-line-model-nov27`），由下面一条统一 requirement 承接。根因、状态模型与
> 焦点落点见 [design.md](../../design.md)。

## REMOVED Requirements

### Requirement: 分栏态空 pane 不接受文本输入

整条移除，由下面的「无标签文档 pane 的空工作区」承接：本 change 后无路径会话恒为结构性只读
（单 pane 与分栏同一条规则），「dirty 草稿豁免」「单 pane 空态 scratch 不受此限」等分叉全部
失去对象；空工作区也没有可选中复制的正文，原条款的选区例外随之退场。

### Requirement: 无标签文档 pane 的空态呈现

整条移除并合入同一条新 requirement：行号、结构性只读、首启 tips、老用户空 vault 覆盖层不再是
四条并列的呈现条款，而是同一个空工作区的四个面。

## ADDED Requirements

### Requirement: 无标签文档 pane 的空工作区

任一文档 pane 没有**带路径标签**（`hasTabs=false`，与标签条 `visibleTabsOf` 同一定义）时，该 pane
SHALL 呈**空工作区**，MUST NOT 呈一份可编辑文档：

- **无隐式文档**：空工作区 MUST NOT 有可编辑正文，MUST NOT 接受键入、粘贴、输入法合成与拖放文本，
  MUST NOT 产生未保存修改或保存落点。无路径会话只作为「没有打开文档」的内部占位（打开文件时就地
  复用，MUST NOT 让空会话堆积），SHALL 结构性只读：`editable=false`（视图层与 changeFilter 双层
  拒收）且不画 CM 插入光标。
- **呈现**：空工作区 SHALL 显示「没有打开的文档」，并提供两个动作：「打开笔记…」唤起 `quick-open`
  的既有浮层；「新建笔记」复用 `file-tree` 的内联命名创建链路（默认名预填、提交合法名字才创建并
  打开）。MUST NOT 提供第三种动作，MUST NOT 自动创建、自动命名或自动写盘。
- **行号**：空工作区 MUST NOT 显示行号 gutter，包括 `[ui] line_numbers = "on"` 与 `⌥G` 临时档
  （判据见 `keymap-commands` 的「跳转到指定行与行号可见面」）。
- **焦点**：空工作区的正文 MUST NOT 成为焦点落点。该 pane 需要交还焦点时（关闭最后一个标签、
  Close All 收尾、分栏 / 切 pane、浮层取消或关闭）SHALL 交给「打开笔记…」；有带路径标签时仍按
  既有口径交给正文。
- **pane 归属**：非活跃空 pane 的动作 SHALL 先使所属 pane 成为活跃 pane，再进入对应链路；双 pane
  时 MUST NOT 把动作、打开落点或焦点串到另一个 pane。取消 / 关闭「打开笔记…」浮层 SHALL 把焦点
  交还该 pane 的主操作；成功打开文档后才按既有打开语义把焦点交给正文。
- **首启 tips**：`first-run-onboarding` 的 tips 在场时，tips 是该 doc pane 的空态表面，空工作区
  的标题与两个动作 SHALL 隐藏；tips 的 DOM、内容、生命周期与「只覆盖 root doc pane」不变。
- **不变项**：有带路径标签进入后，正文可编辑性、光标、行号与焦点归还按既有口径在同一同步点恢复；
  harness pane 不受本条约束（composer 是合法输入落点）；有路径 dirty 的保护、vault 外只读会话的
  行为不变。

#### Scenario: 关闭最后一个标签回到空工作区

- **WHEN** 单 pane 打开着一份文档，执行 `⌘W`（或点该标签的关闭钮），且它没有未保存修改
- **THEN** 标签区隐藏、modeline 显示「无当前文件」；该 pane 显示「没有打开的文档」与两个动作，
  没有行号 gutter、没有插入光标；焦点落在「打开笔记…」而不是正文或 `body`；按任意字符键与
  `⌘S` 都不产生内容、dirty 或提示（空工作区没有保存目标）

#### Scenario: 分栏空 pane 与单 pane 同一条只读规则

- **WHEN** `ui.line_numbers = "on"`，单 pane 开着 `a.md`，执行 `pane.split` 得到空的右 pane
- **THEN** 右 pane 显示空工作区（无 gutter、无插入光标、`contenteditable=false`），正文不接受
  键入；点击右 pane 的动作使它成为活跃 pane（焦点不落正文），在该 pane 打开 `b.md` 后正文恢复
  可编辑与光标

#### Scenario: 非活跃空 pane 的动作先激活所属 pane

- **WHEN** 双 pane：左 pane 开着 `a.md`，右 pane 为空工作区；直接点右 pane 的「打开笔记…」
- **THEN** 右 pane 成为活跃 pane 后才打开快速打开浮层；取消后焦点回到右 pane 的「打开笔记…」；
  左 pane 的前台文档、焦点与阅读位置都不变

#### Scenario: 新建笔记走既有命名链路

- **WHEN** 在空工作区点「新建笔记」
- **THEN** 文件树出现内联命名输入框（预填默认名、整段选中），此时磁盘 MUST NOT 出现新文件；
  提交合法名字后才创建文件并自动打开，空工作区随标签出现而离场；取消不创建任何文件

#### Scenario: 首启 tips 在场时空工作区动作让位

- **WHEN** 真正首次启动的首个空 vault 装载完成
- **THEN** 该 doc pane 显示 tips，空工作区的标题与两个动作 MUST NOT 出现；tips 只占 root doc
  pane 的矩形，harness pane 的 composer 可见、可聚焦、可输入

#### Scenario: 打开文档后同一同步点恢复

- **WHEN** 空工作区在场时从文件树打开 `a.md`
- **THEN** 空工作区离场，标签出现，`a.md` 的正文可编辑、光标可见，行号按当前 `line_numbers` 档
  恢复；焦点落在正文
