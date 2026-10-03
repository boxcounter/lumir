---
id: "76-harness-usage"
item: 76
title: Harness ⑦ 用量显示：mock usage → 面板 ctx% / cache%（change add-harness-probe，mock provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-usage.json"
steps:
  - name: ⌘⇧A 唤起面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板出现
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 发送前用量条在零值（还没有任何一轮）
        ax: { has: "ctx 0% · cache 0%" }

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
      - label: 用量条 = mock fixture 的 usage（65536/131072 = ctx 50%，32768/65536 = cache 50%）
        ax: { has: "ctx 50% · cache 50%" }
      - label: 未越警示线（50 < 85）——没有警示条
        ax: { not: "警示线" }
      - label: JSONL 记下 usage 原值
        file: { path: "env:harness/*.jsonl", has: '"cached_tokens":32768,"input_tokens":65536,"kind":"usage"' }
      - shot: 01-用量条
---

spec 判据（harness「上下文用量显示与触顶处理 · 用量显示」）：完成一轮对话后面板显示与
usage 字段一致的 ctx% 与 cache hit%。数值口径：ctx% = input_tokens ÷ 模型上下文窗口
（mock 走 kimi 预设表，kimi-k2 = 131072）；cache% = cached_tokens ÷ input_tokens。
fixture 取 65536 / 32768 让两边都恰好 50%，避开浮点修约的歧义。50% 低于警示阈值 85%，
不触发自动压缩（auto_compact 默认开）。
