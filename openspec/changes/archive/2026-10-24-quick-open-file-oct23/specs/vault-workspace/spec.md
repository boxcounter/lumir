# vault-workspace 增量规格

> 起草注记（非规格正文）：本 delta 两条 MODIFIED，基线是 living spec
> [openspec/specs/vault-workspace/spec.md](../../../../../specs/vault-workspace/spec.md) 的「按 vault
> 持久化标签列表」与「按 vault 持久化 pane 布局」两条——两者都写有「每一个有路径的标签 SHALL 被
> 持久化 / MUST NOT 存在例外」的硬句，外部只读标签这**同一个例外**必须在两处同时认领，否则归档后同
> 一 capability 自相矛盾。按 `openspec archive` 的整块替换语义，两块都**整条复制**现行正文后就地
> 增补（正文一句例外 + scenario），未改动的段落逐字保留。例外对应
> [quick-open](../quick-open/spec.md) 的 vault 外只读会话；`multi-tabs` 的「打开语义」同时认领
> 了它「不参与保存与监听」的其余部分。

## MODIFIED Requirements

### Requirement: 按 vault 持久化标签列表

系统 SHALL 为每个 vault 持久化「上次打开的标签列表」：有序的 vault 相对路径 + 激活项，按注册项稳定 id 键控，MUST NOT 存绝对路径（vault 重定位后相对路径仍然有效；相对路径是既有标签模型的口径）。**本文件**的持久化内容 MUST NOT 包含未保存内容、撤销史与光标位置（决策 3「只恢复标签列表」）；滚动位置不落在本文件里——它由「按 vault 持久化阅读位置」另存一份（不共用文件的理由：标签文件的写入触发点是标签集合变化，把随滚动改写的位置混进去会让每一次滚动牵动「打开哪些标签」这个关键状态）。**每一个有路径的 vault 内标签 SHALL 被持久化**：本版标签只有一种形态，「预览（临时）标签不入盘」这一分类随 change `preview-tab-removal` 退场（M254，Alex 2026-09-27 的斜体反馈）——MUST NOT 存在「有的 vault 内标签不入盘」这种例外；**唯一例外是 `quick-open` 打开的 vault 外只读标签**（它没有 vault 相对路径、不参与保存与恢复，见 `quick-open` 与 `multi-tabs` 的「打开语义」）：这类标签 MUST NOT 入盘，也 MUST NOT 出现在列表行的标签数里。除这一条例外，列表行摘要里的标签数 SHALL 等于将被恢复的标签数。系统 SHALL 在标签集合 / 顺序 / 激活项变化后落盘（可防抖），并在切换 vault 前与退出前 flush 待写内容（MUST NOT 只依赖防抖定时器）。落盘 SHALL 用临时文件 + rename 原子替换。写失败 SHALL 降级为 warning（与 `last_vault` 写失败同口径），MUST NOT 拦停用户动作，也 MUST NOT 影响 vault 打开的成功语义。会话数据 MUST NOT 与注册项存在同一个文件里（注册项解析失败会被既有读取路径当作无效项跳过，把易变的界面状态混进身份文件会扩大身份丢失面，见 design §2）。会话文件缺失或损坏 SHALL 等价于「没有标签历史」，MUST NOT 影响 vault 在列表中的存在、打开与治理。

#### Scenario: 只存路径与激活项

- **WHEN** 用户在某个 vault 里打开若干文件、滚动、编辑后未保存即切走
- **THEN** 落盘的只有有序的相对路径与激活项；未保存内容、撤销史与光标都不在盘上；滚动位置不在本文件里（见「按 vault 持久化阅读位置」）

#### Scenario: 预览标签不入盘

- **WHEN** 某 vault 里打开了三个文件（其中有从未编辑过的、也有刚打开就被编辑过的）
- **THEN** 三个标签**都**在落盘列表里，列表行摘要显示 3（M254 起标签只有一种形态——「不入盘」这一分类已随 change `preview-tab-removal` 退场；本 scenario 的名字保留自 M163，改名通道是整条 Requirement 移除 + 新增承接条，理由见该 change 的 design §三，断言因此收敛成上面这条「一个都不少」）

#### Scenario: 切换前 flush

- **WHEN** 标签刚发生变化（防抖窗口未到）时用户就切换 vault
- **THEN** 当前 vault 的标签列表在切换前落盘，切回来时恢复的是变化后的列表

#### Scenario: 写失败只降级

- **WHEN** 会话落盘失败（磁盘只读 / 空间不足等）
- **THEN** 记一条 warning，切换与打开照常完成，用户不被拦下

#### Scenario: 会话损坏等价于无历史

- **WHEN** 某 vault 的会话文件损坏或不存在
- **THEN** 该 vault 在列表里照常显示（标签数按 0 / 无历史呈现），打开它时不恢复任何标签，其余功能不受影响

#### Scenario: 外部只读标签不入盘、不计入标签数

- **WHEN** 某个 vault 里开着两个 vault 内标签与一个 vault 外只读标签，用户切换到另一个 vault
- **THEN** 落盘的标签列表只含那两个 vault 内标签（顺序不变），列表行摘要显示 2；切回来时不恢复外部
  只读标签，也 MUST NOT 因它给出「文件已删除」一类的跳过提示

### Requirement: 按 vault 持久化 pane 布局

系统 SHALL 为每个 vault 持久化「上次打开的内容区 pane 布局」，**扩展** vault-sessions 会话文件（与「按 vault 持久化标签列表」同一份 per-vault 文件，MUST NOT 另建状态文件）：

- `panes`：数组，每元素为该 pane 的 `{tabs: 有序 vault 相对路径[], active: 相对路径}`——per pane 的标签列表与激活项；v1 至多两个元素。条目的路径校验 SHALL 复用既有 `valid_entry` 口径（绝对路径 / 含 `..` / 越出 vault 一律丢弃），MUST NOT 被用来打开 vault 之外的文件。
- `harness_pane`：bool——记录 harness pane 是否在场。恢复时 `harness_pane: true` SHALL 重新装配 harness pane（面板本体为无文档状态件；**会话内容不持久化**——恢复出的是空会话，会话内存态口径不变）。无 `harness_pane` 字段的旧版会话文件 SHALL 按 `false` 解释（读取侧兼容，MUST NOT 写双份真源）。
- `pane_split_ratio`：分隔条位置（0–1），per-vault 布局数据；分隔条拖拽松手 SHALL 写入本会话文件（MUST NOT 复用全局 `ui.content_width` 的配置键——栏宽是全局偏好，分栏比例是 vault 布局，两个真源各管一层）。harness 自动分栏的默认宽度比（harness:文档 pane = **1:1**，canonical 定义见 `pane-layout` 的「harness pane」）SHALL 只在无存储值时生效。

持久化纪律 SHALL 与既有标签列表逐条同构：写入 SHALL 用临时文件 + rename 原子替换；`version` 与实现不符 SHALL 等价于「没有 pane 历史」（不报错、不提示，回落默认布局）；写失败 SHALL 降级为 warning（不拦停切换 / 退出 / 分栏动作）。无 `panes` 字段的旧版会话文件 SHALL 在读取侧按「单 pane = 既有顶层 tabs / active」解释（向后兼容只做在读取侧，MUST NOT 写双份真源）。

写入触发点 SHALL 是「pane 集合 / 某 pane 的标签集合 / 激活项 / 分隔条位置 / harness pane 在场态变化后」（可防抖），并在切换 vault 前与退出前 flush 待写内容（MUST NOT 只依赖防抖定时器）。每一个有路径的 vault 内标签（跨全部文档 pane）SHALL 被持久化，MUST NOT 存在「有的 vault 内标签不入盘」的例外；`quick-open` 的 vault 外只读标签是**唯一**例外（它没有 vault 相对路径）——这类标签 MUST NOT 入盘，口径与「按 vault 持久化标签列表」的同一例外是**同一条**（MUST NOT 在两处各写一份判据）；某 pane 的前台是外部只读标签时，该 pane 的 `active` SHALL 按「激活项不在入盘集合里即落 null」的既有口径落 `null`，恢复时退化为该 pane 的第一个可打开标签。

恢复 SHALL 在每次 vault 装载成功后执行（复用「装载后恢复标签列表」的两步口径，落到每 pane）：**第一步（pane 与标签的建立，当帧）**——按存储顺序建立全部 pane 与其标签条，`harness_pane: true` 时 harness pane 一并就位；pane 的存在、顺序、标签与激活项 SHALL 与存储一致；**第二步（内容装载）**——各文档 pane 存储的激活项文档在装载完成时装载，其余标签首次成为前台时装载；内容装载 SHALL 走既有打开链路，MUST NOT 新增装载通道。条目不可用（不在 vault 内 / 非法路径）时 SHALL 按既有口径跳过并计一次数；全部文档 pane 的条目都不可用时 SHALL 回落单 pane 空 vault 首入态；激活项不可用时 SHALL 退化为该 pane 的第一个可打开标签。单 pane 存储（`panes` 只有一个元素或无 `panes` 字段）且 `harness_pane` 为 `false` 时恢复后 MUST NOT 出现第二 pane。

#### Scenario: 双 pane 布局随 vault 往返恢复

- **WHEN** 在 vault A 里分双 pane（左 `a.md` 前台、右 `b.md` + `c.md` 前台 `c.md`，分隔条偏右），切到 vault B 再切回 A
- **THEN** 装载完成的那一帧双 pane 就位：左 pane 标签条 a、b…（存储口径），右 pane 标签条含 `c.md` 为前台，分隔条位置与存储一致；两个 pane 的激活项正文就位，其余标签首次前台时装载并回到各自阅读位置

#### Scenario: harness pane 在场态随 vault 往返恢复

- **WHEN** 在 vault A 里打开着 harness pane（有一轮进行中的对话），切到 vault B 再切回 A
- **THEN** 装载完成的那一帧 harness pane 就位（宽度比与存储一致）；恢复出的是空会话——切换前的对话内容不恢复（会话内存态口径）

#### Scenario: 单 pane 恢复不出第二 pane

- **WHEN** 某 vault 的上次布局是单 pane 且无 harness（或无 `panes` 字段的旧版会话文件）
- **THEN** 恢复后只有一个 pane，界面与从未分栏过的 vault 完全一致（无分隔条、标签条在标题栏内）

#### Scenario: 版本不符与写失败的既有口径不变

- **WHEN** 会话文件的 `version` 与实现不符；或 pane 布局落盘失败（磁盘只读 / 空间不足）
- **THEN** 前者等价于没有 pane 历史（回落默认布局，不报错不提示）；后者记一条 warning，打开、切换、退出与分栏动作照常完成，用户不被拦下

#### Scenario: 切换前 flush 与越界条目丢弃

- **WHEN** 刚分栏（防抖窗口未到）就切换 vault；且该 vault 的 `panes` 数组里含一个绝对路径条目
- **THEN** 切换前当前 vault 的 pane 布局（含新分栏）落盘；绝对路径条目按 `valid_entry` 口径丢弃、MUST NOT 被打开，其余条目照常恢复

#### Scenario: 收起 pane 后的布局入盘

- **WHEN** 双 pane 时执行 `pane.close`（标签并入另一 pane）后切换 vault 再切回
- **THEN** 恢复出的是收起后的单 pane 布局：并入 pane 的标签按序在该 pane 的标签条上，激活项为 `pane.close` 后的前台标签

#### Scenario: 无存储比例的 vault 用新默认值

- **WHEN** 某 vault 从未分栏过（会话文件里没有存储的分隔条比例），在其中执行 `harness.toggle` 自动分栏
- **THEN** 分栏按 harness:文档 = 1:1 出现（该默认值只在无存储值时生效）

#### Scenario: 已存比例的 vault 不受新默认值影响

- **WHEN** 某 vault 的会话文件里已存有分隔条比例（用户此前拖拽过），在其中执行 `harness.toggle` 自动分栏
- **THEN** 分栏按**存储的比例**出现，MUST NOT 被新默认值（1:1）覆盖

#### Scenario: 外部只读标签不改变 pane 入盘内容

- **WHEN** 双 pane 里各有一个 vault 内标签，其中一个 pane 的前台是 vault 外只读标签，用户切换 vault 再切回
- **THEN** 该 vault 的 `panes` 只含两个 vault 内标签（外部标签 MUST NOT 入盘）；外部标签所在 pane 的
  `active` 落 `null`，切回时退化为该 pane 的第一个可打开标签；外部标签本身不恢复，也不计入跳过提示
