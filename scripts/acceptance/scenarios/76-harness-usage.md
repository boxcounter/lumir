---
id: "76-harness-usage"
item: 76
title: Harness ⑦ 上下文读数：usage → 控制行 ctx% 单读数（change move-harness-to-pane-chat-frame 起）
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
        ax: { has: "ctx 0%" }
      - label: 发送前没有 ⓘ 钮（它只在读数越警示线时出现）
        ax: { not: "上下文用量说明" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["u", "s", "a", "g", "e"]
  - name: 发送
    do: key
    key: enter

  - name: 等回答与 usage 到达
    do: waitFor
    waitFor:
      has: ["用量验收回答。"]
    expect:
      - label: 控制行读数 = mock fixture 的 usage（65536/131072 = ctx 50%）
        ax: { has: "ctx 50%" }
      - label: 读数收缩为 ctx 单值——cache 列已随 M347 改形移除
        ax: { not: "cache" }
      - label: 未越警示线（50 < 85）——ⓘ 钮不在场（它是越线才出现的按需入口）
        ax: { not: "上下文用量说明" }
      - label: JSONL 记下 usage 原值
        file: { path: "env:harness/*.jsonl", has: '"cached_tokens":32768,"input_tokens":65536,"kind":"usage"' }
      - shot: 01-控制行-ctx读数
---

spec 判据（harness「上下文用量显示与触顶处理 · 用量显示」，M347 改形后）：完成一轮对话后，
composer 控制行显示与 usage 字段一致的 ctx%——**单读数**（`ctx {n}%`，cache% 列随读数迁入
控制行一并移除）；越警示阈值（`[harness].warn_ctx_pct`，缺省 85）时才出现 ⓘ 钮（读数高亮 +
按需气泡，见场景 87）。

数值口径：ctx% = input_tokens ÷ 模型上下文窗口（mock 走 kimi 预设表，kimi-k2 = 131072，
`src-tauri/src/harness/llm.rs`）。fixture 取 65536 让读数恰好 50%，避开浮点修约的歧义。
50% 低于警示阈值 85%，不触发自动压缩（auto_compact 默认开），也不会出现 ⓘ。

**发送前的读数为什么是 `ctx 0%`（不是「没有读数」）**：`harness_state` 快照里 `usage` 是
`UsageSnapshot::default()`（全零，`src-tauri/src/harness/session.rs`），面板的 `restoreSnapshot`
拿到一个数值 `ctx_pct` 就落成读数 ⇒ 面板一挂上就有 `ctx 0%`。前端只在 `lastUsage === null`
时隐藏读数件，而快照路径不给 null（M349 首跑实测：AX dump 里发送前那条就是 `AXStaticText
= "ctx 0%"`，见 `test-results/acceptance/2026-10-06/76-harness-usage/ax/`）。旧口径（M347
之前）的断言同样写 `ctx 0% · cache 0%`，即「未用前显示零读数」是沿用行为，不是本次引入。

**改形沿革（本场景为何整段重写，M349）**：M347（change move-harness-to-pane-chat-frame）把
读数从 dock 顶部迁进 composer 控制行，并收缩为 ctx 单读数、删掉 cache 列；M346 又移除了 dock
列本身。旧断言 `ctx 0% · cache 0%` / `ctx 50% · cache 50%` 与「发送前在零值」两条因此双双
失效（读数件未隐藏那会儿的形态已不存在）。
