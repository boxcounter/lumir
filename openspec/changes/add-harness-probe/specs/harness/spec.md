# harness 增量规格

> 起草注记（非规格正文）：新 capability，基线无 living spec。能力边界以 ADR 0007 Decision 2 为准；
> 运行时选型（自研薄工具循环）、权限机制、Skill/AGENTS.md 装配见 [design.md](../../design.md)。

## ADDED Requirements

### Requirement: 对话面板

系统 SHALL 提供对话面板，位于应用骨架右栏 dock 列（接入 ui-design-system 的骨架预留列），可唤起与收起。面板 SHALL 支持多轮对话并以流式增量呈现模型输出；模型输出 SHALL 按 Markdown 渲染（GFM 基本面含代码块高亮），一切模型输出 MUST 经转义后注入（零 HTML 直插）。全部可见文案 SHALL 走文案表（zh/en 双档），样式 SHALL 只消费 token 层取值。流式渲染与网络处理 MUST NOT 进入编辑器 keypress-to-paint 路径（ADR 0002 §6）。

#### Scenario: 唤起与流式对话

- **WHEN** 面板经命令唤起并发送一条提问
- **THEN** 面板出现在右栏 dock 列；模型输出以增量方式逐段呈现并按 Markdown 渲染；期间编辑器键入响应不受影响

#### Scenario: 文案与 token 纪律

- **WHEN** 界面语言切换（zh ↔ en）
- **THEN** 面板全部长驻文案经 `onRelabel` 重绘为对应语言；面板样式全部取值自 token 层

### Requirement: 上下文注入与可见性

唤起对话时，系统 SHALL 自动组装当前编辑器上下文随对话注入：当前 TAB 的 vault 相对路径 SHALL 始终注入；存在选区时 SHALL 注入选区内容；无选区时 SHALL 注入视口行范围内容。待注入的上下文 SHALL 在面板输入区上方以可核对的形式呈现（文件路径 + 选区 / 视口摘要），Alex 发送前可见。

#### Scenario: 选区注入

- **WHEN** 在编辑器中选中一段文字后唤起面板并提问
- **THEN** 输入区上方显示当前文件路径与选区摘要；模型收到的消息包含该文件路径与选区原文

#### Scenario: 无选区时注入视口

- **WHEN** 无选区唤起面板
- **THEN** 注入内容退化为当前视口行范围的文本，且 chip 标明注入的是视口而非选区

### Requirement: AGENTS.md 自动加载

会话建立时，系统 SHALL 自动装配系统上下文，包含 user-wide（`~/.agents/AGENTS.md`）与 vault-wide（vault 根 `AGENTS.md`）两层文件内容；文件不存在 SHALL 静默跳过。嵌套子目录级 AGENTS.md 不在本期。

#### Scenario: 双层注入

- **WHEN** 两处 AGENTS.md 均存在并发起新会话
- **THEN** 系统上下文包含两份文件的内容；仅一处存在时注入存在的一份，不报错

### Requirement: Skill 支持

系统 SHALL 自动发现 user-wide（`~/.agents/skills/`）与 vault-wide（`<vault>/.agents/skills/`）两处的 Skill（SKILL.md 约定），vault-wide 同名覆盖 user-wide。Skill 索引（name + description）SHALL 注入系统上下文；`skill_load(name)` 工具 SHALL 按名加载 SKILL.md 全文，路径解析 MUST 限定在两个 Skill 根内（只读、防逃逸）。外部能力（如 Tavily）SHALL 以「Skill + 对应 CLI」形态接入，系统 SHALL NOT 为特定外部服务内置专用工具。

#### Scenario: 索引注入与按需加载

- **WHEN** Skill 根下存在 tavily 技能且 Alex 提问需要联网搜索
- **THEN** 模型可见技能索引中的 tavily 条目，经 `skill_load` 取得用法后经 `cli_run` 调用对应 CLI

#### Scenario: 路径逃逸拒绝

- **WHEN** `skill_load` 收到指向 Skill 根外的路径或名称
- **THEN** 拒绝并回送错误，不读取任何根外文件

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 8，`[harness].loop_max` 可调）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 恰好为：`vault_read`、`vault_search`、`vault_patch`、`vault_create`、`skill_load`、`cli_run`——清单外能力扩张须经 Alex 裁决（ADR 0007）。

#### Scenario: 多轮工具往返

- **WHEN** 模型的回答需要先读文件（返回 `vault_read` 调用）
- **THEN** 系统执行读取、把内容回送模型、继续生成最终回答；面板可见「调用了什么工具」

#### Scenario: 循环上限

- **WHEN** 模型连续调用工具达到 `loop_max`
- **THEN** 循环终止，面板显示达到上限的提示，不产生进一步工具执行

### Requirement: 权限机制

系统 SHALL 实现三层权限规则：allow / ask / deny，判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）。默认分层 SHALL 为：读类工具（`vault_read` / `vault_search` / `skill_load`）allow；写类工具（`vault_patch` / `vault_create`）与 `cli_run` ask。deny 命中 SHALL 直接拒绝并回送模型；ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送模型；未决批准项 MUST NOT 自动超时通过。

#### Scenario: 默认分层生效

- **WHEN** 模型先调用 `vault_read` 再调用 `vault_patch`（均无规则命中）
- **THEN** `vault_read` 直接执行；`vault_patch` 挂起等待面板批准

#### Scenario: deny 优先

- **WHEN** 一条 `cli_run` 同时匹配 allow 与 deny 规则
- **THEN** 该调用被拒绝并把原因回送模型，不进入批准闸

#### Scenario: 采纳与拒绝

- **WHEN** 面板收到 patch 的 diff 预览，Alex 点击采纳（或拒绝）
- **THEN** 采纳则 patch 按 fs-io「局部 patch 写入」口径落盘；拒绝则磁盘逐字节不变，模型收到对应结果

### Requirement: 上下文用量显示与触顶处理

面板 SHALL 常驻显示上下文用量：context window 已用 %（最近一次请求的 input tokens ÷ 模型上下文窗口）与 cache hit %（Responses 形态下两 provider 统一走 `usage.input_tokens_details.cached_tokens`；映射表留在 provider 预设内防字段方言）。用量超过警示阈值（默认 85%，可配）SHALL 显示警示。系统 SHALL 默认自动压缩（`auto_compact = true`）：每轮响应完成后检查，越阈值即自动把会话历史压缩为摘要、开新逻辑会话并注入摘要 + 当前编辑器上下文 + 系统上下文；自动压缩 MUST NOT 静默——面板插入可见压缩标记（摘要可展开），JSONL 完整留存压缩前历史。API 返回上下文超限错误时 SHALL 自动压缩后重试该轮一次。系统 MUST NOT 静默截断会话历史。

#### Scenario: 用量显示

- **WHEN** 完成一轮对话（含 mock provider 给出的 usage 数值）
- **THEN** 面板显示与 usage 字段一致的 ctx% 与 cache hit%

#### Scenario: 自动压缩

- **WHEN** 一轮响应完成后 ctx% 越过警示阈值
- **THEN** 系统自动生成会话摘要并开新逻辑会话；面板出现可见的压缩标记，摘要可展开查看；后续对话在新会话上继续

#### Scenario: 超限兜底

- **WHEN** API 返回上下文超限错误
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（闭集合 `kimi` / `deepseek` / `mock`）、`providers` 表（各 provider 的 `api_key` / `model` / 可选 `base_url`；mock 为 `fixture` 路径）、`permissions`（`allow` / `deny` 规则表）、`loop_max`、`warn_ctx_pct`。校验 SHALL 沿用既有模板：缺字段回落默认不告警；闭集合取值非法回落默认 + 人话 warning；类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key, value)`，`ui` 表既有行为不变。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为闭集合外的值
- **THEN** 启动不失败，provider 回落默认并产生一条人话 warning

### Requirement: 会话边界

会话 SHALL 绑定 vault：一个 vault 一个会话（内存态）。切 vault SHALL 切到该 vault 的会话，切回时恢复；关闭 vault 丢弃其会话；app 重启清空全部会话。面板 SHALL 提供「新会话」动作：清空当前 vault 会话的消息历史并重新装配系统上下文（AGENTS.md / Skill 索引不变），JSONL 留存不受影响。探针期 SHALL NOT 提供多会话管理与历史回看。

#### Scenario: 切 vault 切会话

- **WHEN** 在 vault A 有进行中的会话，切到 vault B 再切回
- **THEN** B 呈现其自身会话（或空会话），工具与上下文注入均解析到 B；切回 A 时 A 的会话原样恢复

#### Scenario: 新会话重置

- **WHEN** 在一段关于旧话题的对话后点击「新会话」
- **THEN** 消息历史清空、系统上下文重新装配，随后提问不受旧话题影响；配置目录 JSONL 中旧会话记录完整保留

### Requirement: 会话本地留存

会话（提问、回答、工具调用与结果、采纳 / 拒绝决策、usage 数值）SHALL 以 append-only JSONL 落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧。

#### Scenario: 留存落盘

- **WHEN** 完成一轮含工具调用的对话
- **THEN** 配置目录下 JSONL 追加完整记录，vault 目录无任何新增或修改

### Requirement: mock provider

`provider = "mock"` 时 SHALL 从配置指向的 fixture 文件读取脚本化响应（含工具调用序列与 usage 数值），确定性驱动工具循环——真机验收 MUST NOT 依赖真实外部 API。

#### Scenario: 确定性验收

- **WHEN** 验收场景以 mock provider 配置启动 app 并发送提问
- **THEN** 工具循环严格按 fixture 脚本推进，断言可复现
