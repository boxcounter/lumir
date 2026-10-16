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
      - label: 发送前读数是快照零值（`StateSnapshot` 的 usage 缺省全零，读数据此在场）
        ax: { has: "0% · 0%" }
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

  - name: hover 读数——口径文本（M443 改准后气泡第二行点明「会话累计」）
    do: hover
    target: { anchor: { role: AXPopUpButton, any: "/权限模式/" }, offsetX: 24 }
    expect:
      - label: 气泡在场（本次读取真的读到了翻出的气泡；M526 起 D463 tokens 形态 + M532 起 k/m 单位）
        ax: { has: "/上下文：已用\\s*65\\.5k\\s*\\/\\s*131k\\s*tokens（50%）/" }
      - label: 第二行 = 会话累计命中 tokens + 累计命中率（M526 起 D465；单回合 == 累计，数值不变）
        ax: { has: "/缓存命中：本会话\\s*32\\.7k\\s*tokens\\s*·\\s*累计命中率\\s*50%/" }
      - label: 第三行本回合 tokens 值也在（M526 起 D466；单回合 50%）
        ax: { has: "/本回合缓存命中：\\s*32\\.7k\\s*tokens\\s*·\\s*命中率\\s*50%/" }
      - label: 缓存写入行不渲染（fixture 不带 cache_write_tokens ⇒ 本回合值 0）
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
所以 `50% · 50%` 这个数**不随口径改变**——本场景的判别力落在 hover 气泡的两行上（第二行由旧口径的
「缓存命中率：50%」改准为限定「会话累计」，第三行是本回合值）。**M526 起这两行走 tokens 形态**
（第二行「缓存命中：本会话 {cached} tokens · 累计命中率 {cache}%」、第三 / 第一行同理），
**M532 起 tokens 数字再走 k/m 单位**——本场景的断言随之从「缓存命中率（会话累计）：50%」改成
「缓存命中：本会话 32.7k tokens · 累计命中率 50%」（这 3 条与 131 / 133 的 10 条同属 M526 的场景
辐射面欠账，在 M532 一并扫清）。两个读数分得开的判别力（累计 46% vs 单回合 92%）在场景 131；
成因句在 131 / 132；缓存写入行在 133。

**发送前的读数为什么是 `0% · 0%`（不是「没有读数」）**：`harness_state` 快照里 `usage` 是
`UsageSnapshot::default()`（全零，`src-tauri/src/harness/session.rs`），面板的 `restoreSnapshot`
拿到数值 `ctx_pct` / `cache_pct_session` 就落成读数 ⇒ 面板一挂上就有 `0% · 0%`。前端只在
`lastUsage === null` 时隐藏读数件，而快照路径不给 null（M349 首跑实测：AX dump 里发送前那条
就是 `AXStaticText = "ctx 0%"`，见 `test-results/acceptance/2026-10-06/76-harness-usage/ax/`）。
「未用前显示零读数」是沿用行为，不是本次引入。

**改形沿革（本场景第四次重写）**：M347（change move-harness-to-pane-chat-frame）把读数从
dock 顶部迁进 composer 控制行，并收缩为 ctx 单读数、删掉 cache 列；M346 又移除了 dock 列本身
（旧断言 `ctx 0% · cache 0%` / `ctx 50% · cache 50%` 随之失效，M349 整段重写）。M370 读数改
双裸读数 `50% · 50%`（+cache hit rate，分隔符小圆点）、ⓘ 钮移除——本场景的 `not: "cache"` 从「cache 列已
移除」的判据转为「读数是裸数字、不含 cache 字样」的回归守卫（M370 口径）。**M443 口径改准**
（change harness-cache-metrics）：cache 侧换成 `cache_pct_session`（会话累计，主读数）+ 留
`cache_pct_turn`（单回合，气泡辅值），旧 `cache_pct` 键退役；本场景补 hover 一步判口径文本与
零值不渲染的缓存写入行。

