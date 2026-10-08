# Proposal: harness 会话留存重塑为 wire/input 形态完整会话记录

- Change ID: reshape-harness-session-recording
- 日期: 2026-10-08
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 在审视现行会话 JSONL 留存时提出三个问题（2026-10-08，原话）：

1. 「为什么我们的 JSONL 里没有？我们的 JSONL 里是完整的会话吗？」
2. 「这个方案对我们后续做多会话管理、包括从老会话里恢复并继续对话有帮助吗？」
3. 「确认这个方向，但为什么你说可能要双写一段过渡期？」——方向已确认：**按 wire/input 形态做完整会话记录，分析与远期恢复共用一份事实**；双写已否（理由见下）。

survey 已查明的事实（可直接引用）：

- 现行留存是**业务事件流水**：15 类 `kind`（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `approval` 族 / `compact` 等），写入口 `JsonlWriter::record`（`src-tauri/src/harness/jsonl.rs:51`）。
- 系统上下文经 `assemble_system`（`src-tauri/src/harness/context.rs:49-75`）装配——固定身份段 + 双层 AGENTS.md（user-wide `~/.agents/AGENTS.md` + vault 根，现状路径口径如此，本提案不夹带 spec 变更）+ 双根 Skill 索引——但**装配结果从不落盘**：JSONL 里看不到 system prompt 全文，也看不到每个来源当时是否存在。
- **思考文本不落盘**（reasoning 只进事件流，留存只有正文）；**模型 / provider 身份不落盘**。
- **运行时与产品侧零读者**；唯一的现存读者是自家验收套件——`scripts/acceptance/scenarios/` 下 15 个场景以 `env:harness/*.jsonl` 断言留存内容（含 `user_message` / `tool_call` / `tool_result` / `usage` / `tool_denied` 等本提案要废弃的 kind，见裁决点 4）。套件是**断言读者**：随实现同 PR 迁移至 wire 口径，不在「双写过渡期」的保护面内。

由此产生的结构性缺口：从 JSONL 无法回答「模型当时到底看到了什么」——装配结果、思考过程、模型身份都不在场；事件流水要还原成请求，必须重写一层「事件→input」翻译逻辑，这是**第二事实源**，与真实发出的请求漂移无人会发现。这正是 Alex 问题 1 的实质。

业界参照：Claude Code / Kimi Code 的 session `wire.jsonl`——按发给模型的形态直接记录会话，分析与恢复共用同一份事实。本提案把 harness 留存从「业务事件流水」重塑为同一形态。

**关于双写（回答 Alex 问题 3）**：双写过渡期的唯一目的是保护旧格式的消费者。运行时与产品侧零读者，没有消费者要保护——唯一的现存读者是自家验收套件（15 个场景断言 JSONL 内容与事件 kind），它是断言读者，应随实现同 PR 迁移至 wire 口径，而非被一段过渡期供养；且双写意味着两种活格式长期并存、同步演进，恰恰是本提案要消灭的第二事实源。旧 vault 聚合文件按 **M309 孤儿先例**处理（`src-tauri/src/harness/jsonl.rs:107-108`：编码替换后旧文件不再续写、不做迁移，当时的理由与本条相同）——**不双写、不留过渡期**。

对 Alex 问题 2：本提案把「多会话管理 / 从老会话恢复续聊」的地基（会话身份与文件边界）现在定死——这是改起来最便宜的时刻；恢复命令与管理 UI 明确不做（探针期边界，见 Non-goals）。

## What Changes

每条对应 `specs/harness/spec.md` 增量中的一个 requirement：

1. **会话本地留存**（harness，MODIFIED「会话本地留存」）：留存定位从业务事件流水重塑为 wire/input 形态——每会话一个 append-only JSONL（`<config_dir>/harness/sessions/<session_id>.jsonl`），首行 `session_open` 落完整装配记录（system prompt 全文 + 每个来源的路径与存在与否 + provider / 模型 / 思考档位）；每次发给模型的请求（含工具循环每次迭代）落 `llm_request`（完整请求体），响应落 `llm_response`（正文 / 思考 / 工具调用 / usage）；批准 / 拒绝 / 中断 / 错误等非 wire 可推导的决策落 sidecar 记录。验收口径 = **恢复充分性**：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求。
2. **会话身份与边界**（harness，MODIFIED「会话边界」）：每个逻辑会话有稳定 session id（落文件名与 `session_open`）；会话建立、「新会话」重置、自动压缩开新逻辑会话，三者各开一个新 JSONL 文件，旧文件封闭不再追加。内存态语义不变（绑 vault、重启清空）；探针期不提供多会话管理与历史回看的边界不变。
3. **压缩留存的文件边界**（harness，MODIFIED「上下文用量显示与触顶处理」的 JSONL 条款）：压缩前历史完整留存在旧会话文件（封闭），压缩摘要随新会话 `session_open` 留存；面板可见压缩标记等行为口径不变。
4. **引用消息留存的 wire 口径**（harness，MODIFIED「引用消息序列化协议」的末句）：「JSONL 记录序列化后的完整消息」改为 wire 口径——序列化消息（含 `<quote>` 块）在 `llm_request` 的 messages 数组中逐字节在场，经请求体重建即得。

## Alex 裁决点

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | 思考文本落盘 | A. 落盘（进 `llm_response` 与后续请求历史）；B. 不落盘（维持现状） | **倾向 A**——Alex 已表态倾向落，此处列为显式裁决点供否决；落盘使「模型当时看到了什么」完整可答，且思考在多轮历史中对模型行为有因果作用，缺它则恢复充分性不完整 |
| 2 | 请求记录粒度 | A. 每次 LLM 调用落完整请求体（含工具循环每次迭代）；B. 增量记录（每轮只记新增消息，恢复时重放拼接） | **倾向 A**——恢复 = 读最后一条 + 续写，零重建代码；B 的恢复要重放器，是翻译层风险的回潮；代价是同轮多次迭代的请求体重复（历史随迭代线性重复），探针期可接受，压缩给增长封顶 |
| 3 | 会话边界落法 | A. 每会话一个文件（sessions/<id>.jsonl）；B. 单文件 + 会话标记记录 | **倾向 A**——「读最后一份文件 + 续写」即恢复入口，天然适配未来多会话枚举；B 恢复要找最后一个标记并截其后内容，枚举与裁剪都更绕 |
| 4 | sidecar 记录范围 | 保留批准 / 拒绝 / 中断 / 错误 / 循环上限（决策类，wire 不可推导）；废弃被 wire 覆盖或失去意义的 11 类事件 kind（含 `tool_denied`） | **倾向按左列**——ADR 0007 双向记录机制的分析侧需要决策留痕；被请求 / 响应覆盖的事件（user_message / assistant_text / tool_call / tool_result / usage 等）再记一份就是双写 |
| 5 | 存量 vault 聚合文件 | 已裁：**孤儿处理**——不双写、不留过渡期、不迁移（M309 先例；运行时 / 产品侧零读者，验收套件断言随实现迁移） | 已裁 |

## Non-goals

- **多会话管理 UI 与历史回看**：探针期既有边界（`openspec/specs/harness/spec.md`「会话边界」末句）**不动**——本提案只把恢复地基（session id + 文件边界）定死，不提供任何读取者。
- **恢复 / 续聊命令**：留存的消费者（恢复命令、多会话枚举）不在本期；本期验收用独立测试 harness 重建请求，不落地产品功能。
- **会话索引文件**：不做（无读者）；会话枚举未来从 `sessions/` 目录直接读 `session_open`。
- **旧格式迁移工具**：存量文件按孤儿先例不迁移。
- **压缩调用自身的逐请求留存例外说明**：压缩调用是内部 LLM 调用，其请求 / 响应同样落 `llm_request` / `llm_response`（摘要的产出过程也是「模型当时看到了什么」的一部分）——这是口径而非 Non-goal，列出防实现期争议。
- **ADR 0007 的远端一侧**：本提案只动本地 JSONL 侧。
- **面板 UI 任何变化**：无。

## Impact

- 影响的 specs：`harness`（MODIFIED ×4：会话本地留存 / 会话边界 / 上下文用量显示与触顶处理 / 引用消息序列化协议）
- 影响的代码/系统：src-tauri（`harness/jsonl.rs` 写入口与文件布局、`harness/context.rs` 装配清单结构化、`harness/turn.rs` / `harness/harness.rs` / `harness/session.rs` 记录点改造、恢复充分性属性测试）；scripts/acceptance（新增 wire 留存验收场景）；tests（mock provider 集成断言）
- 关联约束：ADR 0007（双向记录机制的本地一侧，记录侧失败不阻断对话的既有纪律不变）；ADR 0004（两个 Alex 评审节点是硬门禁）；仓库信息卫生（验收 fixture 合成，不落真实 vault 内容）；M309 孤儿先例（存量文件处置依据）
