# Design: harness-cache-metrics

技术设计说明。节点 1 评审以 proposal.md 为准；本文记录实现期的技术选型与行为合同细节，供实现 worker 与
归档评审对账。

**术语**（本 change 自造词，就地定义）：**逻辑会话** = 一段连续的对话上下文，边界沿用既有口径——
会话建立、「新会话」重置、自动压缩开新逻辑会话、从历史会话恢复，四者各起一段（`openspec/specs/harness/spec.md`
「会话边界」）；**会话累计命中率**（本 change 自造）= 本逻辑会话内所有带 usage 的 LLM 往返的
`Σcached_tokens ÷ Σinput_tokens`；**单回合命中率** = 最近一次 LLM 往返的 `cached_tokens ÷ input_tokens`
（今日的 `cache_pct`）；**缓存写入** = provider usage 的 `cache_write_tokens`（kimi K3 缓存写单独计费的那部分）。

## 1. 调研结论（现状事实锚点）

全部经只读核实（worktree wt-439 @ 002d794）：

- **单回合口径是唯一口径**：`usage_snapshot(usage, window)`（`src-tauri/src/harness/llm.rs:231-244`）
  ——`ctx_pct = input ÷ 窗口`、`cache_pct = cached ÷ input`，都是**单回合**。无累计、无窗口、无成因。
- **快照就地覆盖、不留历史**：`UsageSnapshot { ctx_pct, cache_pct }`（`harness/session.rs:66-73`，
  `Serialize` + `Default`、**无 ts-rs 导出**）由 `Session::set_usage`（`session.rs:296-300`）整体覆盖，
  只存在最近一次的副本，没有累计状态可读。
- **两条同源消费路径**：① 事件 `events::usage(ctx_pct, cache_pct)`
  （`harness/events.rs:146-157`，`round1` 保留一位小数）；② `harness_state` 快照的 `usage` 字段。
  两处在 turn 完成时同点发出：`s.set_usage(snapshot)` + `sink.emit(events::usage(...))`
  （`harness/turn.rs:392-398`）。快照在 webview 重载后经 `restoreSnapshot` 重灌
  （`src/harness-panel.ts:4532-4540`）。
- **前端消费面**：状态 `lastUsage` / `lastCache`（`src/harness-panel.ts:1980-1984`）；
  控制行读数 `{ctx}% · {cache}%`（D334，`copy-data.ts:732`，`applyUsage` `harness-panel.ts:3123-3140`）；
  hover 气泡 `buildCtxPop`（`harness-panel.ts:3145-3154`）第一行 D395（上下文窗口占用，`copy-data.ts:1035`）、
  第二行 D401（缓存命中率，`copy-data.ts:1041`）、越线第三行 D335（`copy-data.ts:741`）；
  事件入口 `case "usage"`（`harness-panel.ts:4283-4290`）。
- **cache_write_tokens 到而不用**：`collect_final_response`（`llm.rs:698-727`）只解析
  `input_tokens_details.cached_tokens`（`llm.rs:710-714`）；`Usage`（`llm.rs:143-147`）无该字段；
  `llm_response` 留存 payload 的 usage 块（`harness/turn.rs:645-651`）只记 input / cached / output。
  `llm.rs:202` 注释自陈「usage 含 `cache_write_tokens`（暂不展示）」。
- **mock 侧的 usage 通道**：fixture 反序列化结构 `FixtureUsage`（`llm.rs:781-789`，字段全 `#[serde(default)]`），
  mock 构造 `Usage` 在 `llm.rs:923-927`。验收场景 76 用 `$fixtures/harness-mock-usage.json`
  （`65536` input / `32768` cached，见 `scripts/acceptance/scenarios/76-harness-usage.md:37`）。
- **回归面（实现期须一并改准）**：验收场景 76（`76-harness-usage.md:37-44`）断言控制行文本
  `50% · 50%` 与留存 `cached_tokens:32768 / input_tokens:65536`；`src-tauri/tests/harness_runtime.rs:360-363`
  断言 `snapshot.usage.cache_pct == 1000×100÷1400`（单回合）。
- **字段路径未核实（如实声明）**：kimi Responses API 的 `cache_write_tokens` 具体嵌套路径**本仓无实测样本**
  ——官方 schema 与既有注释只说 usage 含该字段（`llm.rs:202`、archived `add-harness-probe/design.md:119`）。
  故本 change 把它列为实现期的真机核实项（§6），解析按「同层 `input_tokens_details.cache_write_tokens`
  优先、顶层 `usage.cache_write_tokens` 回退」两路都试，`deepseek` 无该字段 → 恒 0。

## 2. 设计合同与输入

- 设计合同：本 change 的 `specs/harness/spec.md` 增量（MODIFIED ×2 及其验收场景）。
- 行为基准：living spec 的「上下文用量显示与触顶处理」（`openspec/specs/harness/spec.md:176`）与
  「会话本地留存」（`:258`）。
- **一致性原则**（Alex 2026-10-06，全文适用）：面板读数必须能被对照核实——主读数（累计）与辅读数（单回合）
  是同一批计数器的两个投影，MUST NOT 各算各的；成因标注 SHALL 由判定算法产出（后端），
  前端 MUST NOT 自行猜成因。
- NOT 清单：请求装配 / 缓存利用方式 / TTL / 工具输出抑制 / system prompt 精简 / effort 提示 /
  ctx% 与自动压缩口径（proposal §Non-goals）。

## 3. 数据模型与统计口径

### 3.1 `Usage` 增字段（`llm.rs:143-147`）

```rust
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: u64,
    pub cached_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64, // 新增：kimi 缓存写入；provider 不提供时 0
}
```

- 解析点：`collect_final_response`（`llm.rs:705-724`）——在既有 `cached_tokens` 解析旁增读
  `cache_write_tokens`（路径见 §6，未核实先双路试、必 `#[serde]`/`.unwrap_or(0)` 兜底）。
- mock 通道：`FixtureUsage`（`llm.rs:781-789`）增 `#[serde(default)] cache_write_tokens: u64`；
  mock 构造 `Usage`（`llm.rs:923-927`）带上它。→ 验收可脚本化该字段（无需真 API）。
- **字段命名沿用 provider 原词**（`cached_tokens` → `cache_write_tokens`），与既有「映射表收在预设里防
  字段方言」的口径一致；本字段就一个来源（kimi），不另设预设项。

### 3.2 会话累计状态（`session.rs`）

新增一个只增不减的累计器，挂在 `Session` 上（与 `usage: UsageSnapshot` 并列）：

```rust
/// 本逻辑会话的缓存计数累计器（自会话建立 / 重置 / 压缩 / 恢复起）。
#[derive(Debug, Clone, Copy, Default)]
struct CacheTotals {
    input: u64,          // Σ input_tokens
    cached: u64,         // Σ cached_tokens
    writes: u64,         // Σ cache_write_tokens
    samples: u64,        // 带 usage 的往返计数
}
```

- **入口替换 `set_usage`**：`Session::set_usage(snapshot)`（`session.rs:296-300`）改/增为
  `Session::record_usage(&Usage, window) -> UsageSnapshot`——先把本次 `Usage` 累加进 `CacheTotals`，
  再由此算全部读数并**返回**快照（turn 侧据此发事件）。`set_usage` 保留给「整体重置」语义
  （新会话 / 压缩开新逻辑会话时清空累计器）。`Session::usage()`（`session.rs:300`）语义不变（读最近快照）。
- **累计清零时机**：会话建立（`Session::new` / `empty`）、「新会话」重置、自动压缩开新逻辑会话、
  从历史恢复开新会话——四处都已是「新建 Session / 换命名空间」的既有节点，累计器随新 `Session`
  从零开始。**MUST NOT** 跨逻辑会话累积（裁决点 1 的 A 案）。
- **恢复路径**：`harness_state` 快照把读数值灌回前端的既有链路不变；累计值活在 Rust 侧 `Session`
  （webview 重载不丢）。MUST NOT 让前端自行累加（前端累加会在重载 / 恢复时对不上真源）。

### 3.3 `UsageSnapshot` 形状（`session.rs:66-73`）

口径改准、表达补齐（裁决点 4 的 A 案——显式命名，旧 `cache_pct` 退役）：

```rust
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct UsageSnapshot {
    pub ctx_pct: f64,                     // 不变：最近一次 input ÷ 窗口
    pub cache_pct_session: f64,           // 【口径改】会话累计命中率（主显示）
    pub cache_pct_turn: f64,              // 新增：最近一次单回合命中率（辅显示）
    pub cache_write_tokens: u64,          // 新增：最近一次缓存写入 tokens
    pub cache_write_tokens_session: u64,  // 新增：本逻辑会话累计缓存写入 tokens
    pub cache_note: Option<CacheNote>,    // 新增：本回合成因标注（无则 null）
}
```

`CacheNote`（序列化为字符串，前端按值匹配文案）：

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CacheNote {
    ColdStart,      // 本回合 cached_tokens == 0
    BlockDilution,  // 本回合新增 tokens > 已缓存前缀的一半
}
```

**计数值**（全部一位小数由前端或 `round1` 承担，见 §5）：

- `cache_pct_session = Σcached ÷ Σinput × 100`（`Σinput == 0` → `0.0`）。
- `cache_pct_turn = cached ÷ input × 100`（`input == 0` → `0.0`；即今日 `cache_pct`）。
- `cache_write_tokens` / `_session`：直接取 `Usage.cache_write_tokens` 与累计。

### 3.4 成因判定（`cache_note`，仅针对**最近一次**往返）

判定顺序（后端一处产出，前端 MIGHT NOT 重算）：

1. `cached_tokens == 0`（且 `input_tokens > 0`）→ `ColdStart`。
   - 会话首个请求的典型冷启动；**中途前缀缓存过期**导致的中途零命中落同一句（裁决点 3 的 A 案）——
     用户的问题都是「为什么没命中」，成因句对两者给同一解释。
2. 否则若 `cached_tokens > 0` 且 `(input_tokens − cached_tokens) > cached_tokens ÷ 2`（等价于单回合
   命中率 < 66.7%）→ `BlockDilution`——本回合新增大块内容把命中率算术摊薄，**非缓存失效**。
3. 否则 `None`。

阈值取「新增 > 已缓存前缀的一半」是任务给定的口径，落在 M438 实测的摊薄现场（
`input 12786 / cached 6400`：新增 6386 > 3200 → `BlockDilution`）能命中，稳态（新增仅最后不完整块）
不会误报。MUST NOT 用「比上一回合低多少」一类相对判据（无基线、易抖动）。

## 4. 事件与留存

### 4.1 usage 事件（`events.rs:146-157`）

载荷扩为（`cache_pct` 键**彻底退役**，与快照 `UsageSnapshot` 同名字段同名同义，防旧语义误读）：

```json
{"type":"usage","ctx_pct":67.2,"cache_pct_session":88.5,"cache_pct_turn":50.1,
 "cache_write_tokens":6174,"cache_write_tokens_session":12044,"cache_note":"block_dilution"}
```

- `cache_pct_session` = **会话累计**（与快照 `UsageSnapshot::cache_pct_session` 同名同值，同一 `UsageSnapshot`
  一处算法喂两边）；相对旧事件载荷新增
  `cache_pct_turn` / `cache_write_tokens` / `cache_write_tokens_session` / `cache_note`
  （`Option<CacheNote>` → 无标注时 `null`）。
- 函数签名相应加参（或改收 `&UsageSnapshot`）；**MUST NOT** 让事件与快照出现两套算法
  （同一 `UsageSnapshot` 直接喂两边）。

### 4.2 `llm_response` 留存（`turn.rs:645-651`）

usage 块加一个字段（wire 口径，恢复 / 诊断可回溯）：

```json
"usage": {"input_tokens":12786,"cached_tokens":6400,"output_tokens":210,"cache_write_tokens":6174}
```

- provider 不提供时记 `0`（与解析兜底一致，不留缺键，避免消费侧再判 null）。
- **留存结构其余部分逐字节不变**：`session_open` / `llm_request` 记录、恢复充分性判据不动
  （本字段只进 usage 块，不影响请求重建）。
- `turn.rs:363-368` 的单回合 `usage_snapshot` 调用改为 `Session::record_usage(...)`；
  `turn.rs:392-398` 的 `set_usage` + `emit` 两处一并改（累计入口与事件同点、同源）。

## 5. 面板展示（具体推荐，不推回裁决）

### 5.1 控制行读数（D334，`copy-data.ts:732`）

**形态不变** `{ctx}% · {cache}%`，但 `{cache}` 的**口径改为会话累计命中率**（`cache_pct_session`）。

- 这就是消除误判的根本：一次大块新增只会压低**单回合**值（进气泡），不会让控制行主读数跳崖。
- `ctx%` 高亮 / 警示阈值逻辑（`usageOverWarn` `harness-panel.ts:890`）MUST NOT 变。
- 读数缺失回落单读数「{ctx}%」的既有口径不变（`lastCache === null` → 单读数）。

### 5.2 hover 气泡（`buildCtxPop`，`harness-panel.ts:3145-3154`）

自上而下（条件行不满足即不渲染）：

| 序 | 行 | 内容 | 变化 |
|---|---|---|---|
| 1 | D395 | 上下文窗口占用：{ctx}% | 不变 |
| 2 | D401 | 缓存命中率（会话累计）：{cache}% | **改形**（补「（会话累计）」限定词） |
| 3 | 新 D-code | 本回合缓存命中：{turn}% · {成因句} | **新增**；成因句按 `cache_note` 取值，`None` 时只出前半句 |
| 4 | 新 D-code | 缓存写入：本回合 {w} tokens · 本会话累计 {ws} tokens | **新增**；判定键 `cache_write_tokens` 为 0（provider 不提供该字段时按 0）时整行不渲染（与 D401 缺失回落同口径——deepseek 无该字段） |
| 5 | D335 | 越线警示句 | 不变（条件追加） |

成因句（zh/en 双档，措辞可在实现批次微调，语义以此为准）：

- `ColdStart`：本回合未命中缓存（会话首个请求，或前缀缓存已过期）——非异常。
- `BlockDilution`：本回合新增内容已超过已缓存前缀的一半，命中率被摊薄——非缓存失效。

- **落点理由**（裁决点 2 的 A 案）：控制行空间紧（约 346px，`copy-data.ts:879`），且写入量 / 单回合值
  是诊断数、不是常看数；气泡是既有的诊断面（D395/D401/D335 已在用）。
- **控制行不加成因标记**：主读数（累计）已稳定，不加角标 / 变色，避免制造新的「读数异常」错觉。
  标记与否留 dogfood 手感后另裁（Non-goal）。

### 5.3 前端状态与恢复（`harness-panel.ts`）

- 状态位：`lastCache`（= `cache_pct_session` 会话累计，语义改准）、新增 `lastCacheTurn` / `lastCacheNote` /
  `lastCacheWrite` / `lastCacheWriteSession`。
- 事件入口（`harness-panel.ts:4283-4290`）：读新键；`cache_pct_session` 缺键 → `lastCache = null`（回落单读数），
  新键缺省 → 对应气泡行不渲染——与既有「不伪造 cache 值」口径一致。
- 快照恢复（`harness-panel.ts:4532-4540`）：从 `state.usage` 读 `cache_pct_session` 等新键；旧快照
  （缺新键）回落单读数、气泡缺行，MUST NOT 伪造。
- 文案：`copy-data.ts` 的 D334 注释改准（cache = 会话累计）；D401 改形；新增两个 D-code（成因句 /
  缓存写入行），同步 `文案-Copy.md` 与 copy drift 测试。

## 6. 未核实项与实现期真机核实（任务 §5）

- **`cache_write_tokens` 的 usage 嵌套路径**：本仓无实测样本。按 `llm.rs` 既有先例
  （`src-tauri/tests/harness_real_deepseek.rs`：`#[ignore]`、从 `~/.config/lumir/config.json` 原地读 key、
  无 key 自动 SKIP、key 绝不打印）写一条真 provider 冒烟，打印（脱敏）一条真响应的 usage 键形状，
  据此钉死解析路径并写进本文档与代码注释。**未核实前**：双路解析 + 0 兜底，MUST NOT 因字段猜错而报错。
- **若 kimi 该字段在 `input_tokens_details` 之外**：以实测为准修正解析；mock fixture 用同一形状脚本化。
- **若 deepseek 也返回该字段**（与官方「无缓存写入计费」不符的可能）：照常记录，不特判 provider。

## 7. 明确不改什么（与 proposal §Non-goals 对齐）

- **请求装配**：`llm.rs:408-421` 的请求体逐字节不变——不加任何缓存 / TTL 字段。
- **缓存利用方式**：仍是自动前缀缓存，无 `cache_control` / `prompt_cache_key` / 显式 cache id。
- **TTL**：不加 `prompt_cache_options` / TTL 档位（第 4 项，Alex 已裁决不做）。
- **工具输出 / system prompt / effort 提示**：第 1 / 3 / 6 项，一律不碰。
- **ctx% 口径、警示阈值、自动压缩**：不动。
- **留存结构**：除 `llm_response.usage` 加 `cache_write_tokens` 外，JSONL 形态与恢复充分性判据不变。
- **不新建图表 / 控件**：只改既有读数与气泡的口径。

## 8. 验收面（机器判定锚点）

- **单元 / 属性测试**（`src-tauri`，纯数值）：
  - 累计口径：多回合 `Σcached ÷ Σinput`；（累计边界）新逻辑会话后清零重算；
  - 成因判定真值表：`cached==0` → `ColdStart`；`新增 > 已缓存/2` → `BlockDilution`；
    稳态（新增为最后不完整块）→ `None`；`input==0` 边界；
  - `Usage` 解析：带 / 不带 `cache_write_tokens`（缺键 → 0）、两种嵌套路径；
  - `UsageSnapshot` 序列化键集合（新字段在场、旧 `cache_pct` 键退场）。
- **Rust 集成测试**（`src-tauri/tests/harness_runtime.rs`）：多轮 fixture 后
  `snapshot.usage.cache_pct_session` = 累计值、`cache_pct_turn` = 单回合值（既有 `:360-363` 断言按新字段改准）。
- **真机验收**（`scripts/acceptance`，mock provider，fixture 全合成）：
  - 更新 `76-harness-usage`：控制行仍 `50% · 50%`（单回合 == 累计，数值不变）但口径文本改准；
  - 新增场景：两轮 fixture（首轮 `cached==0` + 次轮高命中）→ 控制行显示**累计**值、气泡里
    本回合值与 `ColdStart` 成因句可见；
  - 新增大块摊薄场景：单回合新增超过已缓存一半 → 控制行仍是累计值、气泡出现 `BlockDilution` 句；
  - 新增缓存写入呈现：fixture 带 `cache_write_tokens` → 气泡第 4 行出现该值，留存 `llm_response.usage`
    含该字段；字段缺失的 fixture → 该行不渲染；
  - 快照恢复：webview 重载后控制行累计读数仍在（真源在 Rust 侧）。
- **视觉**：气泡新增两行（成因句 / 缓存写入）在既有 `m3xx` harness 场景里的基线核对；动过
  `tests/visual/scenes/**` 后按纪律跑 `gate.sh visual`，基线 `--update` 前 Alex 过目。
- **门禁**：`scripts/gate.sh quick` 全绿；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。

## 9. 后续项（本 change 不做，登记 backlog）

- **面板成因标记的手感**：控制行是否加轻量标记提示「本回合有成因」，留 dogfood 后另裁。
- **缓存消费趋势**：跨会话 / 跨天的命中率与写入量趋势（图表），本 change 范围外。
- **TTL 过期成因的显式标注**：本 change 把中途零命中并入 `ColdStart` 一句；若 dogfood 显示需要区分
  「首请求」与「TTL 过期」，另立小项（需要 TTL 剩余 / 时间间隔信息，属观测扩面）。
- **第 1 / 3 / 4 / 6 项**（工具输出抑制 / system prompt 精简 / TTL 1h / effort 提示）：Alex 已裁决不做，
  不进本 change。
