# Delta: harness

## ADDED Requirements

### Requirement: 显式 Skill 加载痕迹

用户显式选择的每个 Skill SHALL 在 harness 面板留下**恰好一条**与工具调用同形的痕迹记录（工具行），
加载成功与失败同等留痕。痕迹 MUST 显示 Skill 名称与终态：成功 SHALL 呈「已加载」终态；失败 SHALL 呈
失败终态并给出具体原因——至少覆盖名字不合 grammar、当前回合发现结果里不存在、SKILL.md 缺失 /
不可读 / 超限、加载结果无正文、调用元数据非法、`user-invocable: false` 与权限拒绝，MUST NOT 静默跳过。

痕迹 MUST 只含名称、终态、错误码 / 人话原因与时刻，MUST NOT 含 SKILL.md 正文或 Skill 目录内其他文件
的内容；面板文本与辅助技术树 MUST NOT 因该痕迹出现任何正文。痕迹行的工具名 SHALL 为 `explicit_skill`
（与模型自主调用的 `skill_load` 区分），MUST NOT 被描述或呈现为模型自主调用；行的折叠、图标、参数格、
失败尾注与时间读数 SHALL 复用既有工具行视觉体系，MUST NOT 新造一套渲染形态。既有 requirement 里对
未知 / 超限 / 读取失败 / 不合 grammar 的「跳过」SHALL 仅指不注入正文、不阻断发送；本条要求这些名字
留下失败痕迹，MUST NOT 改变其正文注入面。

痕迹行的工具名只用于面板呈现，MUST NOT 向模型注册成第二件工具；权限判定仍以 `skill_load` + 技能名 +
`{"name": <name>}` 进行，与既有显式入口逐字一致。

痕迹 SHALL 可恢复：痕迹项 SHALL 随该条用户消息进入会话 `input` 与 `llm_request.messages` 的本地字段
`lumir_skill_trace`（数组，元素含 `name` / `status`，失败时含 `code` / `message`，及 `ts`），该字段 MUST
在发送给 provider 的 wire 展开时被剥离；恢复会话 / 切换历史后 SHALL 从该字段重建同一批工具行（名称、
终态、原因与时刻一致），MUST NOT 重新执行正文加载。live 路径与恢复路径 MUST 共用同一份「痕迹项 → 面板
消息」映射，MUST NOT 各算一套；两条路径 MUST NOT 重复留痕。重试 SHALL 原样回放该轮输入，MUST NOT 重算
痕迹或追加痕迹行。

同名选择 SHALL 只加载并留痕一次（按发送顺序先到先得）。显式痕迹 MUST NOT 改变权限判定、执行期正文
加载器、正文注入 part、面板正文投影、自动命名素材与自动 `skill_load` 的工具行 / 结果回送：权限与策略
失败沿用既有错误码，自动入口的既有表现逐字不变。

#### Scenario: 成功加载留一行

- **WHEN** 用户显式选择一个可加载 Skill 并发送消息
- **THEN** 该用户消息之后出现一条工具名 `explicit_skill` 的痕迹行，参数格为该 Skill 名称，终态为已加载；
  SKILL.md 正文仍只进入该用户消息的模型可见 part，面板文本与 AX 不含正文字符串

#### Scenario: 多 Skill 一次发送

- **WHEN** 一条消息显式选择两个不同 Skill，且元数据里重复出现其中一个名字
- **THEN** 每个不同名字各得一条痕迹行（同名的重复项不产生第二行），行的顺序与发送元数据里各名字首次出现
  的顺序一致

#### Scenario: 失败留痕与具体原因

- **WHEN** 用户显式选择的名字分别命中 grammar 不合、不存在、元数据非法、禁手动、权限 deny、SKILL.md
  缺失与 SKILL.md 超限
- **THEN** 每个名字各得一条失败终态的痕迹行，尾注含对应错误码与人话原因（权限拒绝带命中的规则原文，
  口径同既有 deny 回送）；用户消息照常发送；失败原因 MUST NOT 以任何正文 part 形式进入该消息

#### Scenario: 恢复后痕迹仍在且不重复

- **WHEN** 含显式痕迹（成功与失败各至少一条）的会话被切走后再恢复
- **THEN** 面板重建出同样的痕迹行（名称、终态、原因与时刻一致），MUST NOT 重新执行正文加载；
  每条名字仍然只有一行，用户消息不重复、正文不上屏

#### Scenario: 重试不重复留痕

- **WHEN** 显式回合的 provider 往返失败后用户触发重试
- **THEN** 该轮输入原样回放，不重新加载 Skill、不新增痕迹行；之后恢复该会话，每个名字仍只有一行

#### Scenario: 自动入口不回归

- **WHEN** 模型自主调用 `skill_load`
- **THEN** 仍走既有的工具行与工具结果回送，不产生 `explicit_skill` 痕迹行；其重试、恢复与压缩行为不变

#### Scenario: 正文与失败码不进入 provider wire

- **WHEN** 一次显式发送同时含成功加载与失败选择
- **THEN** 留存里的该用户消息带 `lumir_skill` 正文 part 与 `lumir_skill_trace` 数组，但实际发送给 provider 的
  wire MUST NOT 含 `lumir_skill`、`lumir_skill_trace` 标记，也 MUST NOT 出现失败错误码；正文仍按既有语义
  进入 wire
