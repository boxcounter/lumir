# vault-workspace 增量规格

> 起草注记（非规格正文）：本 delta 一条 MODIFIED，基线是 living spec
> [openspec/specs/vault-workspace/spec.md](../../../../specs/vault-workspace/spec.md) 的「按 vault
> 持久化标签列表」条。按 `openspec archive` 的整块替换语义，本块**整条复制**现行正文后就地增补
> （正文一句例外 + 一个 scenario），未改动的段落逐字保留。例外对应
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
