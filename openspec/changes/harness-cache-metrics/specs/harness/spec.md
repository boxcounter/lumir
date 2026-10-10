# harness 增量规格

> 起草注记（非规格正文）：本 change 把 harness 面板的缓存读数改为可解释口径（会话累计为主、单回合为辅、
> 冷启动 / 大块摊薄造成因标注），并把 `cache_write_tokens` 纳入留存与面板。与 living spec 的
> 「上下文用量显示与触顶处理」「会话本地留存」对齐。统计边界、成因判定与展示落点见
> [design.md](../../design.md)。本 change 不改请求装配、不改缓存利用方式、不加 TTL 参数
> （Alex 2026-10-10 裁决的其余 4 项不做）。

## MODIFIED Requirements

### Requirement: 上下文用量显示与触顶处理

composer 控制行 SHALL 常驻显示上下文用量读数（位于模型 chip 之后、发送钮之前）：context window 已用 %
（最近一次请求的 input tokens ÷ 模型上下文窗口）与 cache hit %。cache hit % SHALL 以**本逻辑会话累计命中率**
（`Σcached_tokens ÷ Σinput_tokens`，范围为当前逻辑会话内所有带 usage 的往返；会话建立、「新会话」重置、
自动压缩开新逻辑会话、从历史恢复各起一段，累计随之归零）作为控制行**主读数**，MUST NOT 以最近一次请求的
单回合命中率作为控制行主读数。最近一次请求的**单回合命中率**（`cached_tokens ÷ input_tokens`）SHALL 在
hover 气泡内与主读数并列呈现；该回合处于**冷启动**（`cached_tokens` 为零）或**大块摊薄**（该回合新增
tokens 超过已缓存前缀的一半）时，气泡 SHALL 附带一句成因说明，点明两种情形均非缓存失效。缓存写入 tokens
（provider usage 的 `cache_write_tokens`）SHALL 在 hover 气泡内呈现本回合与本会话累计值，字段缺失且为零时
该行 SHALL NOT 渲染。用量超过警示阈值（默认 85%，可配）时读数 SHALL 高亮，指针悬停读数 SHALL 浮出说明气泡
（向上展开、右缘对齐读数右缘）、移开即收起；SHALL NOT 常驻显示警示句，也 SHALL NOT 另挂 ⓘ 类可点入口
（2026-10-07 去感叹号改 hover 形态，读数高亮已承担警示语义）。系统 SHALL 默认自动压缩（`auto_compact = true`）：
每轮响应完成后检查，越阈值即自动把会话历史压缩为摘要、开新逻辑会话并注入摘要 + 当前编辑器上下文 + 系统
上下文；自动压缩 MUST NOT 静默——面板插入可见压缩标记（摘要可展开），压缩前历史 SHALL 完整留存在旧会话
JSONL 文件（封闭不再追加），压缩摘要 SHALL 随新会话 `session_open` 留存。API 返回上下文超限错误时 SHALL 自动
压缩后重试该轮一次。系统 MUST NOT 静默截断会话历史。

#### Scenario: 用量显示

- **WHEN** 完成一轮对话（含 mock provider 给出的 usage 数值）
- **THEN** 控制行读数显示与 usage 字段一致的 ctx% 与会话累计 cache hit%；读数位于模型 chip 与发送钮之间

#### Scenario: 会话累计读数跨回合

- **WHEN** 同一逻辑会话内先后完成多个带 usage 的回合
- **THEN** 控制行 cache 读数 SHALL 等于该会话至今的 `Σcached_tokens ÷ Σinput_tokens`（MUST NOT 只反映
  最近一回合的单回合值）；开启新逻辑会话（「新会话」重置 / 自动压缩）后累计 SHALL 重新起算

#### Scenario: 单回合低谷带成因标注

- **WHEN** 某一回合 `cached_tokens` 为零（会话首个请求的典型冷启动，或前缀缓存过期），或该回合新增
  tokens 超过已缓存前缀的一半（大块内容摊薄）
- **THEN** 控制行主读数仍显示会话累计值；hover 气泡内该回合的单回合命中率旁 SHALL 出现对应成因说明句，
  说明该情形非缓存失效

#### Scenario: 缓存写入遥测在气泡内呈现

- **WHEN** provider 的 usage 带回 `cache_write_tokens`（kimi），完成一轮对话后悬停读数
- **THEN** 气泡内显示本回合与本会话累计的缓存写入 tokens；若 provider 不提供该字段（值为零），该行
  SHALL NOT 渲染

#### Scenario: 超阈值警示收敛为悬停气泡

- **WHEN** ctx% 越过警示阈值
- **THEN** 读数高亮；指针悬停读数时浮出说明气泡、移开即收起；界面不出现常驻警示句、无 ⓘ 入口

#### Scenario: 自动压缩

- **WHEN** 一轮响应完成后 ctx% 越过警示阈值
- **THEN** 系统自动生成会话摘要并开新逻辑会话；面板出现可见的压缩标记，摘要可展开查看；后续对话在新会话上
  继续；压缩前历史完整留存在旧 JSONL 文件、摘要随新文件 `session_open` 留存

#### Scenario: 超限兜底

- **WHEN** API 返回上下文超限错误
- **THEN** 系统自动压缩并重试该轮一次；仍失败才向面板报错

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：
每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<session_id>.jsonl`），文件首行 SHALL 为
`session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位、**完整装配后 system prompt
全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）。每次发给模型的请求
（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数），
每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考回放项与展示文本 / 工具调用 / usage / 错误；usage
SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**（provider 不提供时按 0 记录）；
思考 MUST 落盘——回放项 provider 方言原样、展示文本另存）；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、
LLM 错误、循环上限）SHALL 以 sidecar 记录留存，被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` /
`assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` /
`approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。
记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能
逐字节重建任意一轮发给模型的请求。旧「按 vault 聚合的业务事件流水」形态不再续写，存量文件不做迁移（运行时 /
产品侧零读者，验收套件的 JSONL 断言随实现迁移至 wire 口径；M309 孤儿先例）。写失败不阻断对话的既有纪律不变。

#### Scenario: 留存落盘

- **WHEN** 完成一轮含工具调用的对话
- **THEN** 配置目录下 `sessions/<session_id>.jsonl` 追加完整 wire 记录（`session_open` / 成对的 `llm_request` /
  `llm_response` / sidecar 决策记录），vault 目录无任何新增或修改

#### Scenario: 缓存写入随 usage 落盘

- **WHEN** provider 的响应 usage 带回 `cache_write_tokens`，完成一轮对话
- **THEN** 对应 `llm_response` 记录的 `usage` 块含 `cache_write_tokens` 原值；provider 不提供该字段时记为 0

#### Scenario: 废弃 kind 不再记

- **WHEN** 完成一轮含工具调用与用量的对话
- **THEN** JSONL 中不出现 `user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` 等 11 类废弃
  kind；同样的信息仅由 `llm_request` / `llm_response` 承载

#### Scenario: 装配记录落盘

- **WHEN** 发起新会话（或「新会话」重置、自动压缩开新逻辑会话）
- **THEN** 新 JSONL 文件首行为 `session_open`：system prompt 全文逐字节在场；装配清单含每个来源的路径与
  存在与否（user-wide AGENTS.md 不存在时 `exists:false` 同样记录）；provider / 模型 / 思考档位在场

#### Scenario: 恢复充分性（属性级）

- **WHEN** mock provider 跑完一轮含工具循环的对话（消息含 `<quote>` 块、响应含思考文本）
- **THEN** 仅凭 JSONL 独立重建的每个请求与落盘 `llm_request` 深度相等（逐字节重建判据）；第 i 条响应的正文 /
  思考 / 工具调用与第 i+1 条请求的历史对应项逐字节一致

#### Scenario: 思考落盘与回放

- **WHEN** 一轮响应含 reasoning 文本
- **THEN** `llm_response` 记录思考——回放项（provider 方言，原样）与展示文本（给人看）分别在 `reasoning` /
  `thinking` 字段；后续请求的历史中该 reasoning 回放项逐字节在场

#### Scenario: 旧文件孤儿化

- **WHEN** 本 change 落地后进行首次对话
- **THEN** 新会话写入 `sessions/` 新文件；旧 vault 聚合文件不被续写、不被改写、不做迁移
