# Proposal: Skill 显式选择与模型自主调用的混合方案

- Change ID: `add-harness-skill-slash-invocation-nov23`
- 日期: 2026-11-24（r3.2，按 r2 评审把拒绝判据限定到各自被拒入口）
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> **节点状态（先读这一段）**
>
> - **节点 1（提案评审）尚未通过。**本文件是 r3 待裁稿，唯一裁决点 H1 为「是否批准混合方案」；
>   未获 Alex 裁决前本 change **不进入实现**。
> - r2 把「显式选择 + 后端确定性加载」与「模型自主 `skill_load`」写成二选一。r3 删除这个错误前提：
>   两条入口并存，默认每个 Skill 都可被用户显式选择，也可由模型按索引自主加载。
> - 本 change 只到提案层：living spec 的改动以 delta 形式留在本 change 目录内，归档时并入，
>   **不提前改写 living spec**。

## Why

### 现场与问题

Skill 今天已有自动入口：模型读取系统提示里的 Skill 索引，按任务相关性调用 `skill_load(name)` 取得全文。
缺少的是用户确定点名后「一定加载」的入口。r2 为补上确定性，把自动入口降为备选，既削弱现有能力，
也不符合主流工具已经采用的混合模型。

用户显式选择还需要一个无歧义载体。手打 `/tmp` 是绝对路径，不应因为存在同前缀 Skill 就变成调用；
因此显式入口的语义仍是「从候选中选择」，不是「文本里出现 `/名字`」。

### 官方实践与本方案取舍

| 工具 | 已核对的官方行为 | 对本方案的启发 |
|---|---|---|
| Claude Code | 支持 `/skill-name` 显式调用，也支持模型在相关时自动调用；`disable-model-invocation` 与 `user-invocable` 分别控制两个入口（[Skills 官方文档](https://docs.anthropic.com/en/docs/claude-code/skills)） | 用户与模型两个维度应独立配置，不能用单一开关互相替代 |
| Codex | 支持显式调用与按 `description` 隐式调用；`allow_implicit_invocation: false` 可禁隐式调用；显式入口随产品面使用 `@` 或 `$`，不是统一 slash（[Build skills 官方文档](https://developers.openai.com/codex/build-skills)） | 显式入口不必绑定某个字符；确定性来自选择动作，不来自 token 字形 |

Lumir 采用混合模型，但显式入口沿用本 change 已设计的「候选选择 + 元数据」，不把手打 `/名字`、
`@名字` 或 `$名字` 当调用。这样保留 `/tmp` 等普通路径的语义，也不依赖模型自觉执行用户点名。

### 已核实的现状

| 事实 | 位置 |
|---|---|
| 双根发现 `~/.agents/skills` + `<vault>/.agents/skills`，vault 同名覆盖 user；名字即目录名，没有字符 grammar 限制 | `src-tauri/src/harness/context.rs:331-371` |
| `SkillEntry { name, description, dir }`；`discover_skills` 当前会对每个 Skill 执行 `fs::read_to_string(SKILL.md)`，把整份文件读入内存后只提取 description | `context.rs:320-326`、`:354-356`、`:373-399` |
| Skill 索引在会话建立 / 新会话 / 压缩时装配一次，是会话快照；发现期读取发生在调用权限判定之前 | `context.rs:15-20`、`:258-276` |
| `skill_load` 在调用执行期按名读取，支持 Skill 目录内文件；有根内校验与 200KB 上限 | `src-tauri/src/harness/tools.rs:1211-1291` |
| 回合开始时重新发现 Skill，供工具执行使用 | `src-tauri/src/harness/turn.rs:602-614` |
| `skill_load` 属读类，三档默认放行；用户 deny 仍优先 | `src-tauri/src/harness/permissions.rs:107-113` |
| 发送契约只有 `parts_json` + `context_json`；用户消息 text part 是 composer 原文 | `src-tauri/src/harness.rs:1631-1645`；`src/harness-composer.ts:185-196` |
| 本地字段 `lumir_label` 只活在留存 / 装配面，wire 前剥离，面板投影忽略 | `attachments.rs:300-340`、`:409-433` |
| 重试回放 `input`；恢复灌回最后一条 `llm_request.messages`；压缩以摘要开新逻辑会话 | `harness.rs:388-437`、`:658-729`；`harness/session.rs:1123` |

## 读取阶段的统一口径

本提案严格区分两个阶段，所有「不读」保证只约束第二阶段：

1. **发现期元数据读取**：`discover_skills` 为装配索引与解析策略，当前可能把整份 SKILL.md 读入内存，
   但只把文本用于元数据解析（description 保持现有 frontmatter / 无 frontmatter 首行兜底，另加本 change
   的两个策略字段），不把正文作为调用结果投递。它发生在权限与入口策略判定之前，是现有索引行为的一部分；
   不得虚称零 IO，也不得把 200KB 执行期上限倒推成发现期上限。
2. **调用执行期正文加载**：显式注入或模型 `skill_load` 在权限与入口策略放行后，调用共享正文加载器，
   把正文投递到用户消息 part 或工具结果。**某一入口被拒绝时，只断言该入口的执行期正文加载器未被调用、
   该入口对应输出面无正文**；不得把负向断言扩大到仍放行的另一入口，也不是追溯否认发现期已经发生的
   文件读取。

| 条件 | 被拒入口与负向判据 | 另一入口的正向对照 |
|---|---|---|
| 权限 deny | 显式与自动均被拒；显式 `input` / `llm_request.messages` / provider wire 与自动工具结果均无正文 marker | 无；两入口都不调用加载器 |
| 禁自动 | 仅自动入口不调用加载器，工具结果无 marker | 显式入口仍调用加载器，`input` / `llm_request.messages` / provider wire 均有 marker |
| 禁手动 | 仅显式入口不调用加载器，显式留存与 wire 无 marker | 自动 `skill_load` 仍调用加载器，工具结果有 marker |
| 非法元数据 | 两入口 fail closed，均不调用加载器，两个输出面均无 marker | 无 |

发现期只读取 frontmatter、避免整文件读入可作为后续优化，但必须单独保持索引与错误行为兼容；本 change
不暗中承诺或夹带这项优化。

## What Changes

### 1. 两条调用入口并存

- **用户显式选择**：候选中选中 Skill 后，前端随当前消息提交选择元数据；后端在存在、可读、允许用户
  调用且权限放行时，确定性读取 SKILL.md 全文并注入该用户消息。手打完整 `/名字` 但没有选择引用时，
  不产生显式注入。
- **模型自主调用**：保留现有「索引（name + description）→ 模型判断相关性 → `skill_load` → 全文」
  链路。默认 Skill 的索引可见性、工具暴露、按需加载与工具结果回送不因本 change 改变。
- 两条入口是并列能力，不互相改写：显式选择不会要求模型再调一次 `skill_load`；模型自主调用也不需要
  用户先生成选择引用。

### 2. 每个 Skill 默认双入口开放，策略分控

SKILL.md frontmatter 采用两个独立字段，缺省时 `disable-model-invocation: false`、
`user-invocable: true`：

```yaml
---
name: deploy-production
description: 部署生产环境
disable-model-invocation: true
---
```

```yaml
---
name: domain-background
description: 领域背景知识
user-invocable: false
---
```

| 配置 | 用户显式选择 | 模型自主 `skill_load` | 典型用途 |
|---|---|---|---|
| 两字段均缺省 | 允许 | 允许 | 普通 Skill，保持现状 |
| `disable-model-invocation: true` | 允许 | 禁止 | 部署等只能由用户明确点名的流程 |
| `user-invocable: false` | 禁止 | 允许 | 只供模型按相关性取得的背景知识 |
| 两者分别设为上述禁用值 | 禁止 | 禁止 | 完整关闭两个入口的显式组合 |

- 字段只接受不带引号的布尔字面量 `true` / `false`。字段缺失才使用默认值；非法值是 Skill 元数据错误，
  两个入口均 fail closed（不调用执行期正文加载器），以 `skill_invocation_invalid` 明确报告，不得默默按默认放开。
- 索引继续列出所有已发现 Skill；非默认策略或非法元数据在索引项上标注。候选只列允许用户调用的条目。
- 模型对禁自动条目调用 `skill_load` 时返回 `skill_model_invocation_disabled`，不调用执行期正文加载器，
  工具结果无正文；用户显式选择不受这个模型入口策略影响。
- 已选引用在发送时遇到 `user-invocable: false`，不调用执行期正文加载器、不注入，给出
  `skill_user_invocation_disabled` 的非阻断提示；模型自主入口不受影响。

**字段主口径只有以上两个。**它们借用 Claude Code 的拼写，但在 Lumir 中按本条定义实现；本提案不声称
它们是 Agent Skills 标准字段。Lumir 不再并行支持 Codex 的 `allow_implicit_invocation`、布尔反义别名、
嵌套配置或第二套拼写，未知 frontmatter 字段仍按现状忽略。

### 3. 显式选择仍是无歧义元数据，不是文本推断

- 候选由 `/` + 合法边界 + 前缀匹配触发，初始被动、无高亮；被动态不消费 Enter / Tab。
- 只有方向键 / 指针进入选择态后 Enter / Tab，或鼠标点击，才创建选择引用（名字 + 文本范围）。
- 引用随编辑映射并逐字节校验 `/名字`；失效就不调用。chip 只从引用派生，不从文本扫描。
- 普通 `/tmp`、`/usr/local`、手打 `/名字`、历史消息中的同形文本都不是显式调用依据。
- 不支持 `/` grammar 的名字仍可按现状进索引和被模型自主 `skill_load`，不得为做候选而收紧发现面。

### 4. 显式路径确定性全文加载

- `harness_send` 增加必填 `skills_json`，只携带当前消息的引用，按位置排序、同名去重。
- 后端在当回合 `discover_skills` 后解析名字，以 `skill_load` + 名字 +
  `{"name": <name>}` 调现行权限判定，再检查用户入口策略；只有权限 `Allow` 且入口允许才调用执行期
  正文加载器。此前的发现期元数据读取按既有索引路径照常发生。
- 执行期加载复用 `skill_load` 的根内校验、200KB 上限与错误语义，不复制第二套正文读取逻辑。
- 正文以 `[已加载 Skill：<名字>]` 开头，作为带 `lumir_skill` 本地标记的独立 `input_text` part 追加到
  用户消息。provider wire 前剥离本地标记、保留正文；面板与自动命名素材跳过该 part。
- 未知、超限、读取失败、不合 grammar 的名字跳过且不阻断；结构非法的 `skills_json` 是内部契约错误，
  拒绝发送。策略禁用与权限 deny 必须明确区分于未知名字。

### 5. 自动路径保持现有能力

- 未配置策略的 Skill，系统提示索引与 `skill_load` 行为保持原样；索引快照与每回合工具快照的既有边界不变。
- 模型自主加载仍走工具循环，全文作为工具结果回送并进入既有请求 / 响应留存；不改成用户消息 part，
  不在发送前预读全部 Skill。
- `disable-model-invocation` 只增加模型入口的策略闸，不删除 `skill_load` 工具、不隐藏其他 Skill 的索引，
  不改变用户显式加载的权限判断。

### 6. 权限与调用方式正交

- 用户显式与模型自主两条路径在允许调用后，都以相同工具名、名字和参数经过现行权限判定；同一 deny
  规则对两者同效，非 `Allow` 均不调用执行期正文加载器、不注入或回送正文。发现期元数据读取不属于
  这次正文加载，不受该断言追溯否认。
- 显式选择不是授权动作，不改变权限档、不跳过批准闸、不预批准 Skill 内容引发的 `cli_run`。
- 两个 invocation 字段是入口策略，不是 allow / deny 权限规则，也不替代权限判定。部署 Skill 即便只能
  显式调用，其后续危险命令仍按现行规则处理。

### 7. 对 `skill_load` 与会话历史的影响

| 场景 | 显式选择路径 | 模型自主路径 |
|---|---|---|
| 首次加载 | SKILL.md 正文进入用户消息的 `input` 与 `llm_request.messages` | 维持工具调用与工具结果，不新增预加载 part |
| 后续回合 | 已有正文作为历史上下文发送，不重新执行显式注入 | 已有工具结果作为历史保留；是否再次调用由模型按当前索引决定 |
| 重试 | 原样回放该轮 `input`，不重新执行显式注入 | 沿用现有重试与工具循环，不额外保证重新调用 |
| 历史恢复 | 原样灌回 `llm_request.messages`，不重新装配或重新显式注入 | 原样恢复历史工具结果，不按当前策略重写旧请求 |
| 自动压缩 | 正文作为普通历史参与摘要，不承诺逐字节保留 | 工具结果同样按现有压缩机制处理 |
| 策略后来变更 | 只影响新的显式发送；草稿引用不保存策略快照 | 只影响新的模型调用；旧 JSONL 中已加载内容不回删、不回写 |

因此，禁止某入口不等于从模型已经可见的历史中擦除内容。本 change 不引入历史清洗、双写或兼容重放层。

## 需求满足度

| 需求 | 混合方案如何满足 |
|---|---|
| 用户点名后确定加载 | 显式选择元数据驱动后端读取与注入，不依赖模型自觉 |
| 保留现有自动能力 | 默认索引 + `skill_load` 完全保留；只有显式配置禁自动的条目增加策略闸 |
| 部署等禁止模型自动 | `disable-model-invocation: true`，同时仍允许用户显式调用 |
| 背景知识禁止用户手动 | `user-invocable: false`，同时仍允许模型自动调用 |
| 普通路径不误判 | 没有显式选择引用就没有显式注入；`/tmp` 仍是普通文本 |
| 权限一致 | 两入口复用同一权限判定与执行期正文加载器，deny 时加载器未调用、不注入 / 不回送；发现期元数据读取照常 |
| 历史可重试、可恢复 | 显式正文活在既有留存；自动工具结果沿用既有留存；均不另建第二事实源 |

## 裁决点（节点 1）

| # | 裁决点 | 推荐 | 裁决结果 |
|---|---|---|---|
| **H1** | 是否批准 r3 混合方案：显式选择确定性全文加载 + 保留模型索引 / `skill_load` 自动调用；默认双入口开放，以 `disable-model-invocation` / `user-invocable` 分控；权限不变，并接受显式正文进入既有会话留存 | **批准**。它同时满足确定性、现有能力不削弱与两类入口治理；无需再在 r2 的 A2 / A2b 之间选择 | **待 Alex 批准** |

r2 的 A1–A6 不再分别送裁：候选、refs、200KB、deny 不注入、普通路径不误判、重试 / 恢复 / 压缩等
均作为 H1 的技术组成保留；不再提供「退回模型自觉加载」或「文本 token 即调用」的备选分支。

## Non-goals

- 不做文本 token 即调用，不新增 `@` / `$` 等第二套显式语法，不做技能卡片 / 原子块。
- 不承诺发现期零 IO，不在本 change 把发现期读取改成只读 frontmatter；该优化如后续立项，必须单独证明
  索引内容与错误行为不变。
- 不支持 `allow_implicit_invocation` 或两个主字段的别名、嵌套写法、兼容映射。
- 不把两个 frontmatter 字段宣称为 Agent Skills 标准字段，不引入完整 YAML 解析器。
- 不削弱默认 Skill 的索引注入与模型自主 `skill_load`，不增加发送前全量 Skill 预读。
- 不做技能管理 UI、技能市场、模糊 / 拼音 / 描述搜索，不做发送前未知名字阻断。
- 不改权限档、不加批准闸、不把显式选择变成授权动作。
- 不清洗或改写既有会话历史；不承诺压缩后 Skill 正文逐字节保留。
- 不把 mock 场景或真实模型 dogfood 观察包装成「模型必定遵守」的机器证明。

## Impact

- 影响的 specs：`harness` 一个 capability。
  - `ADDED`「Skill 的混合调用与入口策略」。
  - `MODIFIED`「Skill 支持」：增加显式入口、双入口策略与清单 / 索引边界；默认自动能力不变。
  - `MODIFIED`「composer 草稿 v2 与一次性 v1 转换」：升 v3，保存选择引用。
- 影响的代码 / 系统（仅提案说明，本次不改产品代码）：
  - Rust：Skill 元数据解析、`SkillSummary` / `harness_skills_list`、模型入口策略闸、`skills_json`、
    显式正文注入与本地标记剥离、面板 / 命名投影、提示装配。
  - 前端：候选与 refs、catalog 的用户可调用过滤、chip 的缺失 / 禁手动状态、草稿 v3、IPC 与文案。
  - 测试：策略矩阵、自动路径回归、显式注入 / 留存 / 权限、前端交互、草稿与真机场景。
- 关联约束：键入路径零 IO；清单异步；fixture 只用合成 Skill；节点 1 未过不得施工。

## 风险与失败模式

| 风险 | 处置 |
|---|---|
| 混合方案被实现成自动能力回退 | 默认 Skill 的索引 / `skill_load` 回归测试；既有场景 77 逐条保留；策略只拦被显式禁用的入口 |
| 两个字段被做成权限旁路 | 两入口共享权限判定与读取函数；三档 × tool / 名字 deny × 两入口测试 |
| 禁自动只改提示，模型仍能读到全文 | 模型 `skill_load` 执行层强制返回策略错误，自动加载器未调用且工具结果无正文；显式入口另有正文 marker 正向对照，不只依赖提示约束 |
| 禁手动只藏候选，旧 ref 仍能注入 | 后端发送时重新检查 `user-invocable`，旧 ref 与伪造元数据都不能调用显式加载器或注入；自动工具结果另有正文 marker 正向对照 |
| 字段写错后意外开放部署 Skill | 非 `true` / `false` 一律元数据错误并 fail closed，不套用缺省开放值，不调用正文加载器 |
| 用文件系统零读取证明 deny，掩盖发现期已读 | 反例先断言发现期已取得 description / 策略，再断言正文加载器未调用及各输出面无正文；不统计或声称全路径零 IO |
| 路径 / 历史 token 被误当显式调用 | 后端只消费当前消息 refs 生成的 `skills_json`，不扫描文本 |
| 留存膨胀 / 上下文预算 | 沿用每 Skill 200KB 上限与既有压缩；正文随历史重复的 token 成本明确接受，不承诺任意规模可用 |
| 策略变更被误认为擦除历史 | 规格明确只约束新调用，恢复与旧 JSONL 原样保留 |
