---
id: "76-harness-usage"
item: 76
title: Harness ⑦ 上下文读数：usage → 控制行「ctx% · cache%」双读数（M370 起，分隔符小圆点与 modeline 同款）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-usage.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 控制行在位（发送钮在场 = 本次 AX 读取活着的正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 发送前无读数（M526：快照 `has_usage=false`（从未发过请求的会话）⇒ 读数区整体隐藏，
          不出现「0% · 0%」虚报；发送钮在场是本步的正观测）
        ax: { not: "/[0-9]+% · [0-9]+%/" }
      - label: 发送前没有警示浮层文案（它只在读数越警示线、hover 读数时才浮出）
        ax: { not: "越过 85% 警示线" }

  - name: 输入提问并 Enter 发送
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|usage" }
    text: "usage"
  - name: 发送
    do: key
    key: enter

  - name: 等回答与 usage 到达
    do: waitFor
    waitFor:
      has: ["用量验收回答。"]
    expect:
      - label: 控制行读数 = mock fixture 的 usage（65536/131072 = ctx 50%，cached 32768/65536 = 50%）
        ax: { has: "50% · 50%" }
      - label: 读数是裸数字双读数——不含「cache」字样（M370：「ctx 」前缀与 cache 列名都随原话去掉）
        ax: { not: "cache" }
      - label: 未越警示线（50 < 85）——hover 浮层无内容，警示文案不在界面上
        ax: { not: "越过 85% 警示线" }
      - label: JSONL 记下 usage 原值（wire 口径：llm_response.usage；M443 起含 cache_write_tokens，
          本 fixture 不带该字段 ⇒ 记 0 且不留缺键。**键序是字母序**——serde_json 的 Map 默认 BTreeMap，
          断言按 `cache_write_tokens` → `cached_tokens` → `input_tokens` 的序写）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '/^.*"kind":"llm_response".*"cache_write_tokens":0.*"cached_tokens":32768.*"input_tokens":65536.*$/' }
      - shot: 01-控制行-ctx读数

  - name: hover 读数——口径文本（M443 改准后气泡的命中率行点明会话口径）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡在场（本次读取真的读到了翻出的气泡；M526 起 D463 tokens 形态 + M532 起 k/m 单位）
        ax: { has: "/上下文：已用\\s*65\\.5k\\s*\\/\\s*131k\\s*tokens（50%）/" }
      - label: 命中率行 = 会话命中率**只出百分比**（M533 精简的 D465；单回合 == 累计，数值不变）
        ax: { has: "/缓存命中率\\s*（会话）\\s*：\\s*50%/" }
      - label: 本回合命中行整行不渲染（M533 退场；上面两条在场是本负向断言的正观测）
        ax: { not: "本回合缓存命中" }
      - label: 缓存写入行不渲染（M533 退场；本 fixture 本就不带 cache_write_tokens）
        ax: { not: "缓存写入" }
      - shot: 02-hover气泡
---

spec 判据（harness「上下文用量显示与触顶处理 · 用量显示」，M370 改形、M443 口径改准后）：完成一轮
对话后，composer 控制行显示与 usage 字段一致的双读数——`{ctx}% · {cache}%`（分隔符小圆点 U+00B7 与
modeline 同款，Alex 过目基线候选后的复裁决；原话写作 • 以复裁决为准。原话
「ctx: XX% 改为 XX% • YY%，其中 XX 是上下文窗口使用率，YY 是 cache hit rate」）：XX = ctx%
（input_tokens ÷ 模型上下文窗口）、YY = **本逻辑会话累计** cache hit rate（Σcached ÷ Σinput，
`cache_pct_session` 已在 usage 事件与会话快照里，纯前端消费）。两个百分比都是**裸数字**——「ctx 」
前缀与 cache 列名都随原话去掉，M347 时代的单读数形态退场。越警示阈值（`[harness].warn_ctx_pct`，
缺省 85）时读数高亮 + hover 读数浮出警示说明（场景 87 判越线面，本场景判读数面）。

数值口径：ctx% = input_tokens ÷ 模型上下文窗口（M381 config-only 后 mock 无模型维度，
`model_specs` 空 → 分母回落保守默认 `FALLBACK_CONTEXT_WINDOW` = 131072，
`src-tauri/src/config.rs`）；cache% = Σcached_tokens ÷ Σinput_tokens（本逻辑会话累计，
`src-tauri/src/harness/session.rs` 的 `record_usage`）。fixture 取 65536/32768 让两个读数恰好都 50%，
避开浮点修约的歧义。50% 低于警示阈值 85%，不触发自动压缩（auto_compact 默认开），也不会出现警示文案。

**M443 起本场景判的是「口径文本改准」这一面**：单轮会话里会话累计恒等于单回合值（唯一一个样本），
所以 `50% · 50%` 这个数**不随口径改变**——本场景的判别力落在 hover 气泡那一行上（由旧口径的
「缓存命中率：50%」改准为限定「会话累计」）。**M526 起这一行走 tokens 形态**（「缓存命中：本会话
{cached} tokens · 累计命中率 {cache}%」）、**M532 起 tokens 数字再走 k/m 单位**、**M533 起按 Alex
裁决精简回只出百分比**（「缓存命中率（会话）：50%」）——本场景的断言随之三度改写（这 3 条与
131 / 133 的 10 条同属 M526 的场景辐射面欠账，在 M532 先扫清、M533 再按新行集改准）。两个读数
分得开的判别力（累计 46% vs 单回合 92%）在场景 131；成因句与缓存写入行在 M533 一并退场（退场的
上屏面判据在 155 / 132 / 133）。

**发送前为什么「没有读数」**：`harness_state` 快照里 `usage` 是 `UsageSnapshot::default()`
（全零、`has_usage: false`，`src-tauri/src/harness/session.rs`），M526 起前端把「从未发过请求」
（`has_usage === false`）的读数区整体隐藏——六键零值是缺省不是读数，渲染即成「0% · 0%」虚报。
**M526 当时只更新了 106 / 155（新场景），本条场景里的零读数断言被漏掉了**（同族欠账之一，
M532 扫气泡行时仍未触及）：本步的判据因此从 `has: "0% · 0%"` 改成本形态（`not` + 发送钮在场的
正观测，与 155 / m347 的同名判据对齐）。旧行为（M349 首跑实测：AX dump 里发送前那条就是
`AXStaticText = "ctx 0%"`，见 `test-results/acceptance/2026-10-06/76-harness-usage/ax/`）在 M526
之后不再成立——这条注记保留，是那次实测的历史现场。

**改形沿革（本场景第五次改写）**：M347（change move-harness-to-pane-chat-frame）把读数从
dock 顶部迁进 composer 控制行，并收缩为 ctx 单读数、删掉 cache 列；M346 又移除了 dock 列本身
（旧断言 `ctx 0% · cache 0%` / `ctx 50% · cache 50%` 随之失效，M349 整段重写）。M370 读数改
双裸读数 `50% · 50%`（+cache hit rate，分隔符小圆点）、ⓘ 钮移除——本场景的 `not: "cache"` 从「cache 列已
移除」的判据转为「读数是裸数字、不含 cache 字样」的回归守卫（M370 口径）。**M443 口径改准**
（change harness-cache-metrics）：cache 侧换成 `cache_pct_session`（会话累计，主读数）+ 留
`cache_pct_turn`（单回合，气泡辅值），旧 `cache_pct` 键退役。**M533 气泡行集精简**：本场景的
hover 一步改判「命中率行只出百分比 + 本回合行 / 写入行不在」，并顺带修掉 M526 漏下的零读数断言。

