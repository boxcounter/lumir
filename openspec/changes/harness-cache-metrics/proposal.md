# Proposal: harness 缓存指标可解释化（cache% 口径 + cache_write_tokens 遥测）

- Change ID: harness-cache-metrics
- 日期: 2026-10-10
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 裁决（2026-10-10）：「可观测性小项做。其余 4 项不做。」——立项范围 = M438 cache hit 调查报告
改进清单的第 2 项（面板 cache% 改为可解释口径）与第 5 项（把 `cache_write_tokens` 纳入留存与面板）；
其余 4 项（抑制工具输出体积、缩减 system prompt、显式 TTL 1h、effort 切换提示）明确不立项。

**诊断背景（M438 调查报告的结论，全部有本机实测凭证）**：面板的 `cache%` 是**最近一次请求的单回合值**
（`cached_tokens ÷ input_tokens`，`src-tauri/src/harness/llm.rs:231-244`），每轮覆盖写入面板
（`turn.rs:392-398`）。Alex 看到的 50% 实测为「前缀 6612 全命中 + 新增 6174 工具输出 = input 12786，
其中 6400 命中」的**算术摊薄**，不是缓存失效——相邻两次请求的前缀实测逐字节稳定在 96.8%–99.8%。
**误判的直接来源就是口径**：单回合值不区分「冷启动 0% / 大块新增摊薄 / TTL 过期」三种成因，
一次大块新增就把读数打到低位、下一回合又回升，看起来像缓存时好时坏。

**现状锚点**（以下事实对着本 worktree 源码核实）：

- **cache% 是单回合值、无累计概念**：`usage_snapshot(usage, window)`（`llm.rs:231-244`）只算
  `cached ÷ input`；`UsageSnapshot { ctx_pct, cache_pct }`（`src-tauri/src/harness/session.rs:66-73`）
  由 `Session::set_usage` 整体覆盖（`session.rs:296-300`），只留最近一次。
- **面板消费点**：`events::usage(ctx_pct, cache_pct)` 事件（`src-tauri/src/harness/events.rs:146-157`）
  与 `harness_state` 快照两条同源，前端落 `lastCache`（`src/harness-panel.ts:1982-1984`），
  控制行读数 `{ctx}% · {cache}%`（D334，`copy-data.ts:732`）、hover 泡第二行「缓存命中率：{cache}%」
  （D401，`copy-data.ts:1041`）。两者都不带成因，也没有单回合 / 累计的区分。
- **`cache_write_tokens` 已到但被丢弃**：kimi 的 usage 带该字段（`llm.rs:202` 注释自陈「暂不展示」），
  但解析层只读 `input_tokens_details.cached_tokens`（`llm.rs:710-714`），`Usage` 结构
  （`llm.rs:143-147`）无该字段，`llm_response` 留存 payload 的 usage 块
  （`turn.rs:645-651`）也不记它。官方口径下 K3 的缓存写入**单独计费**（
  [platform.moonshot.cn/docs/pricing](https://platform.moonshot.cn/docs/pricing)），
  一个 50% 的单回合读数里，未命中部分有一部分是**必要的缓存写入成本**而非浪费——这个数今天人对它是盲的。

**为什么这两项一起做**：它们是同一个认知缺口的表里两面——第 2 项修「读数口径说不清」，
第 5 项补「成本说不清」。二者共用同一条数据链（`Usage` → `UsageSnapshot` → usage 事件 / 快照 →
面板），拆成两个 change 会让同一条链改两遍（REVIEW.md 第 8 条：一次真源）。

## What Changes

逐条对应 `specs/harness/spec.md` 增量里的一个 requirement：

1. **面板缓存读数改为可解释口径**（harness，MODIFIED：上下文用量显示与触顶处理）：控制行的 cache 读数
   SHALL 改以**会话累计命中率**（本逻辑会话内所有带 usage 的请求的 `Σcached ÷ Σinput`）为主值，
   单回合命中率降为 hover 气泡里的辅值；气泡在**冷启动**（本回合 `cached_tokens` 为零）或
   **大块摊薄**（本回合新增 tokens 超过已缓存前缀的一半）时 SHALL 标注成因句，点破「非缓存失效」。
   `ctx%` 口径、警示阈值与 hover 行为（越线高亮、气泡形态）MUST NOT 改变。
2. **`cache_write_tokens` 入留存与面板**（harness，MODIFIED：会话本地留存 + 上条同款面板口径）：
   `Usage` SHALL 增 `cache_write_tokens` 字段并从 provider usage 解析（provider 不提供时按 0）；
   `llm_response` 留存的 usage 块 SHALL 记该字段（wire 口径，恢复 / 诊断可回溯）；
   面板 hover 气泡 SHALL 呈现本回合与本会话累计的缓存写入 tokens（字段缺失时该行不渲染）。

两条一起把「这次缓存到底省没省、花在了哪」变成面板上可解释、可回溯的数字。

## Alex 裁决点

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | 会话累计的**统计边界** | A. 当前逻辑会话内累计，压缩 / 恢复开新逻辑会话即清零重算；B. 跨逻辑会话累计（整个 vault 会话历史）；C. 滚动窗口（如最近 N 次请求） | **倾向 A**——「会话累计」的语义就是当前这段对话；压缩与恢复本就开新逻辑会话（既有口径），累计随之归零与「会话」边界自洽；B 会把跨上下文混合成一个不可解释的数，C 需要额外定义窗口长度、徒增口径 |
| 2 | cache_write_tokens 的**面板落点** | A. 只进 hover 气泡（诊断细节），控制行主读数不动；B. 进控制行读数（`{ctx}% · {cache}% · {write}`） | **倾向 A**——控制行空间紧（原型实测约 346px，`copy-data.ts:879`），写入量是诊断数、不是常看数；气泡是既有的诊断面 |
| 3 | 单回合成因标注的**触发条件** | A. `cold_start` 取「本回合 `cached_tokens == 0`」（会话首个请求是典型，中途 TTL 过期导致的中途零命中落同一句）；B. 严格取「会话首个请求」 | **倾向 A**——用户看到 0% 的问题是同一个「为什么没命中」，TTL 过期与首请求对他是同一回事；B 会让中途 0% 无解释 |
| 4 | 主读数口径字段的**命名** | A. 显式两字段 `cache_pct_session` / `cache_pct_turn`（旧 `cache_pct` 在**事件与快照两条通道一并退役**）；B. 保留 `cache_pct` 键、就地改语义为累计 | **倾向 A**——「口径可解释化」本身就是让名字承载语义；复用旧键会留一个「读到 cache_pct 的人以为还是单回合」的静默陷阱（REVIEW.md 第 8 条：一处真源、防第二事实源）。旧键在两条通道都退役，避免事件与快照同值不同名 |

## Non-goals

- **不改请求装配**：wire 请求体逐字节不变——MUST NOT 新增 `cache_control` / `prompt_cache_key` /
  缓存 TTL 参数 / `store` 相关字段（本 change 是**观测**，不是缓存策略）。
- **不动缓存利用方式**：仍是 Moonshot / DeepSeek 的**自动前缀缓存**，MUST NOT 引入显式缓存机制。
- **不做 TTL 1h**（M438 清单第 4 项，Alex 已裁决不做）：请求体不加缓存 TTL 档位参数。
- **不做工具输出体积抑制**（第 1 项）：不改 `tools.rs` / `summarize_result`，不设单次输出上限。
- **不精简 system prompt**（第 3 项）：不改 `context.rs` 的 IDENTITY / QUOTE_REFERENCE / skill 索引。
- **不做 effort 切换的缓存代价提示**（第 6 项，未实测坐实）：不改档位切换交互。
- **不改 `ctx%` 口径、警示阈值、自动压缩逻辑**：本 change 只碰 cache 侧的读数与遥测。
- **不改留存的结构与口径**：除 `llm_response.usage` 加 `cache_write_tokens` 一个字段外，JSONL 的
  wire 形态、`session_open` / `llm_request` 记录、恢复充分性判据逐字节不变。
- **不新建面板控件 / 不做缓存消费趋势图**：只修既有读数与气泡的口径，不引入图表。

## Impact

- **影响的 specs**：`harness`（MODIFIED ×2：上下文用量显示与触顶处理 / 会话本地留存）
- **影响的代码/系统**：
  - src-tauri：`harness/llm.rs`（`Usage` 增字段与解析、单回合 `usage_snapshot` 拆分）、
    `harness/session.rs`（会话累计状态与 `UsageSnapshot` 扩展）、`harness/events.rs`（usage 事件载荷加字段）、
    `harness/turn.rs`（留存 payload 加字段、累计入口与事件发出）；
  - src：`harness-panel.ts`（读数 / 气泡 / 快照恢复消费新字段）、`copy-data.ts` + `文案-Copy.md`
    （成因句与缓存写入行的文案，新增 D-code）；
  - scripts/acceptance：更新既有场景 `76-harness-usage`（口径改准 + 多回合累计断言）、
    新增冷启动 / 大块摊薄成因标注与 cache_write_tokens 呈现的断言；mock fixture 增 `cache_write_tokens`；
  - tests/unit、`src-tauri/tests/harness_runtime.rs`：累计口径与成因判定的判定测试、字段解析测试。
- **关联约束**：M438 调查报告（`.tower/comms/inbox/20261010-worker-m438-tower-survey-summary-…md`，
  本 change 的事实基础）；ADR 0007 双向记录（留存新字段仍满足恢复充分性）；ADR 0002 §6 性能合同
  （纯数值累计，不进 keypress-to-paint 路径）；仓库信息卫生（fixture 数值全合成，不搬真实留存）。
- **不影响的既有行为**：wire 请求体、前缀稳定性、ctx% 与自动压缩、留存 JSONL 结构、
  缓存的实际命中方式——全部逐字节不变。

## 观测闸三问（低成本口径）

本 change 本身就是可观测性改进，三问即「改了之后怎么知道它对」：

- **怎么知道用户用了它**：读数常驻在控制行，dogfood 时 Alex 肉眼可见即可；无埋点（沿用产品零埋点口径）。
- **怎么知道它有效**：主判 Alex 下次看到低读数时是否不再误判为「缓存坏了」——判据是「50% 类单回合低谷
  不再出现在控制行主读数里、而是落在气泡辅值并带成因句」；辅判留存里 `cache_write_tokens` 有值可回溯。
- **出问题怎么发现**：机器面兜底——累计 / 单回合 / 成因判定的单元与属性测试、验收场景断言
  （多回合累计、冷启动标注、摊薄标注、缓存写入行）、字段解析测试；快照恢复路径（webview 重载后累计读数
  仍在）纳入断言。
