---
# change add-harness-turn-retry-nov23 A11：含图失败后切到未声明 vision 的模型，再点重试——
# 前置闸按当前 provider / model 重新判定，拒绝为 harness_image_unsupported：人话错误行
# （重试语境，指向「切换到支持图片的模型」）、失败状态保留、动作仍在、零 provider 请求。
id: "720-harness-retry-image-nonvision"
item: 720
tier: full
title: 含图失败切非 vision 模型：重试被前置闸拒绝（零请求、动作仍在）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-image.json"
    # 供 chip 切过去的非 vision provider（kimi 要求非空 Key，套件在声明清单时补合成 Key；
    # 重试在 vision 前置闸处被拒，不会触发任何真实网络请求）。
    kimiModels:
      - { id: "probe-novision", effort: false, window: 131072, vision: false }
steps:
  - name: ⌘⇧A 打开 harness pane（mock provider，能力恒放行）
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 输入提问
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|imageretry" }
    text: "imageretry"
  - name: 剪贴板置合成 png
    do: clipboardImage
    synth: { width: 320, height: 240, seed: 23 }
  - name: ⌘V 贴入图片卡片
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500
  - name: 等图片卡片
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
  - name: 发送（mock 不挡图；fixture 首条是网络失败）
    do: key
    key: enter
  - name: 等失败动作
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
  - name: 点模型 chip 展开
    do: click
    target: { name: "^模型：" }
  - name: 选 kimi（probe-novision，vision:false）
    do: click
    target: { name: "^kimi$" }
  - name: 等 chip 读数翻到 kimi 档
    do: waitFor
    waitFor:
      has: ["模型：probe-novision"]
    timeoutMs: 15000
  - name: 点重试（应被 vision 前置闸拒绝）
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等拒绝错误行
    do: waitFor
    waitFor:
      has: ["切换到支持图片的模型后重试"]
    timeoutMs: 20000
    expect:
      - label: 重试语境的人话错误行（不照抄发送路径的「移除图片卡片」）
        ax: { has: "切换到支持图片的模型后重试" }
      - label: 不出现「移除图片卡片」句
        ax: { not: "移除图片卡片" }
      - label: 失败状态保留、动作仍在（快照 retry 重建）
        ax: { has: "/AXButton \\(重试\\)/", count: { pattern: "/AXButton \\(重试\\)/", exact: 1 } }
      - label: 零 provider 请求：JSONL 里只有失败轮的 1 条 llm_request
        file: { path: "env:harness/sessions/*/*.jsonl", count: { pattern: '"kind":"llm_request"', exact: 1 } }
      - shot: 01-能力闸拒绝
---

# 720-harness-retry-image-nonvision —— 含图重试的 vision 前置闸

## 覆盖边界（如实登记）

- 「切回支持 vision 的模型后可重试成功」**本层未覆盖**：mock 档能力恒真、跨回 mock 需要真实
  可用的 provider 请求（验收套件不出网）。该分支由 R16（`begin_retry_guards_and_vision_preflight`）
  钉住：切回 vision 模型后 `begin_retry` 放行，桌面侧只验拒绝面。
- 零 provider 请求由 JSONL 的 `llm_request` 计数判（前置闸在消费 `failed` 之前、零请求）。
