# vault-workspace 增量规格

> 起草注记（非规格正文）：一条 ADDED，改动面 = ADR 0008 Decision 6 的 pane 布局持久化。
> 纪律全部沿用「按 vault 持久化标签列表」的既有口径（tmp+rename、版本不符=无历史、写失败
> 降级、路径校验复用 `valid_entry`），本条只写 pane 维度的增量与恢复路径。`harness_pane`
> 字段是 ADR 0008 Decision 6 登记的 Phase 2 契约位（Phase 1 恒 false），非孤立开关。

## ADDED Requirements

### Requirement: 按 vault 持久化 pane 布局

系统 SHALL 为每个 vault 持久化「上次打开的内容区 pane 布局」，**扩展** vault-sessions 会话
文件（与「按 vault 持久化标签列表」同一份 per-vault 文件，MUST NOT 另建状态文件）：

- `panes`：数组，每元素为该 pane 的 `{tabs: 有序 vault 相对路径[], active: 相对路径}`——
  per pane 的标签列表与激活项；v1 至多两个元素。条目的路径校验 SHALL 复用既有
  `valid_entry` 口径（绝对路径 / 含 `..` / 越出 vault 一律丢弃），MUST NOT 被用来打开
  vault 之外的文件。
- `harness_pane`：bool——Phase 1 恒为 `false`（harness 仍在 dock 列），字段随 schema 一并
  落盘；Phase 2 harness 归位 pane 后消费。
- `pane_split_ratio`：分隔条位置（0–1），per-vault 布局数据；分隔条拖拽松手 SHALL 写入本会话
  文件（MUST NOT 复用全局 `ui.content_width` 的配置键——栏宽是全局偏好，分栏比例是 vault
  布局，两个真源各管一层）。

持久化纪律 SHALL 与既有标签列表逐条同构：写入 SHALL 用临时文件 + rename 原子替换；`version`
与实现不符 SHALL 等价于「没有 pane 历史」（不报错、不提示，回落默认布局）；写失败 SHALL 降级
为 warning（不拦停切换 / 退出 / 分栏动作）。无 `panes` 字段的旧版会话文件 SHALL 在读取侧按
「单 pane = 既有顶层 tabs / active」解释（向后兼容只做在读取侧，MUST NOT 写双份真源）。

写入触发点 SHALL 是「pane 集合 / 某 pane 的标签集合 / 激活项 / 分隔条位置变化后」（可防抖），
并在切换 vault 前与退出前 flush 待写内容（MUST NOT 只依赖防抖定时器）。每一个有路径的标签
（跨全部 pane）SHALL 被持久化，MUST NOT 存在「有的标签不入盘」的例外。

恢复 SHALL 在每次 vault 装载成功后执行（复用「装载后恢复标签列表」的两步口径，落到每 pane）：
**第一步（pane 与标签的建立，当帧）**——按存储顺序建立全部 pane 与其标签条，pane 的存在、
顺序、标签与激活项 SHALL 与存储一致；**第二步（内容装载）**——各 pane 存储的激活项文档在
装载完成时装载，其余标签首次成为前台时装载；内容装载 SHALL 走既有打开链路，MUST NOT 新增
装载通道。条目不可用（不在 vault 内 / 非法路径）时 SHALL 按既有口径跳过并计一次数；
全部 pane 的条目都不可用时 SHALL 回落单 pane 空 vault 首入态；激活项不可用时 SHALL 退化为
该 pane 的第一个可打开标签。单 pane 存储（`panes` 只有一个元素或无 `panes` 字段）恢复后
MUST NOT 出现第二 pane。

#### Scenario: 双 pane 布局随 vault 往返恢复

- **WHEN** 在 vault A 里分双 pane（左 `a.md` 前台、右 `b.md` + `c.md` 前台 `c.md`，
  分隔条偏右），切到 vault B 再切回 A
- **THEN** 装载完成的那一帧双 pane 就位：左 pane 标签条 a、b…（存储口径），右 pane 标签条
  含 `c.md` 为前台，分隔条位置与存储一致；两个 pane 的激活项正文就位，其余标签首次前台时
  装载并回到各自阅读位置

#### Scenario: 单 pane 恢复不出第二 pane

- **WHEN** 某 vault 的上次布局是单 pane（或无 `panes` 字段的旧版会话文件）
- **THEN** 恢复后只有一个 pane，界面与从未分栏过的 vault 完全一致（无分隔条、标签条在标题栏内）

#### Scenario: 版本不符与写失败的既有口径不变

- **WHEN** 会话文件的 `version` 与实现不符；或 pane 布局落盘失败（磁盘只读 / 空间不足）
- **THEN** 前者等价于没有 pane 历史（回落默认布局，不报错不提示）；后者记一条 warning，
  打开、切换、退出与分栏动作照常完成，用户不被拦下

#### Scenario: 切换前 flush 与越界条目丢弃

- **WHEN** 刚分栏（防抖窗口未到）就切换 vault；且该 vault 的 `panes` 数组里含一个绝对路径条目
- **THEN** 切换前当前 vault 的 pane 布局（含新分栏）落盘；绝对路径条目按 `valid_entry` 口径
  丢弃、MUST NOT 被打开，其余条目照常恢复

#### Scenario: 收起 pane 后的布局入盘

- **WHEN** 双 pane 时执行 `pane.close`（标签并入另一 pane）后切换 vault 再切回
- **THEN** 恢复出的是收起后的单 pane 布局：并入 pane 的标签按序在该 pane 的标签条上，激活项
  为 `pane.close` 后的前台标签
