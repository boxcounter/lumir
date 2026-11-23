---
# change add-harness-turn-retry-nov23 A4：失败后切到 vault B 再切回 A——失败状态按 vault 保留，
# 回到 A 时由 `harness_state.retry` 在 transcript 尾部重建重试动作，点击可用。
id: "713-harness-retry-vault-switch"
item: 713
tier: full
title: 切 vault 回来仍可重试（快照 retry 重建动作，其他 vault 不受影响）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-retry-network.json"
seed:
  registry:
    - { id: acc-retry-a, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-retry-b, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: ⌘⇧A 打开 harness pane
    do: keys
    keys: ["cmd+shift+a"]
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 发送并等失败
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|vswitch" }
    text: "vswitch"
  - name: Enter
    do: key
    key: enter
  - name: 等失败动作
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
  - name: 打开 vault 切换器
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 切到 B
    do: click
    target: { role: AXStaticText, any: "lumir-m102-acceptance-b" }
  - name: 等 B 装载
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b"]
    timeoutMs: 30000
    expect:
      - label: B 不显示 A 的失败动作
        node: { role: AXButton, name: "^重试$", present: false }
  - name: 切回 A
    do: click
    target: { any: "点击查看全部 vault" }
  - name: 点 A（列表按 lastOpenedAt 倒序，A 在 B 之前；取第一行）
    do: click
    target: { role: AXStaticText, any: "lumir-m102-acceptance", nth: 0 }
  - name: 等 A 回来
    do: waitFor
    waitFor:
      has: ["/AXButton \\(重试\\)/"]
    timeoutMs: 30000
    expect:
      - label: 尾部按快照 retry 重建恰好一条动作
        ax: { has: "/AXButton \\(重试\\)/", count: { pattern: "/AXButton \\(重试\\)/", exact: 1 } }
      - shot: 01-切回后动作在场
  - name: 点重试
    do: click
    target: { role: AXButton, name: "^重试$" }
  - name: 等成功
    do: waitFor
    waitFor:
      has: ["RETRY-OK"]
    timeoutMs: 30000
    expect:
      - ax: { has: "RETRY-OK" }
      - shot: 02-切回后重试成功
---

# 713-harness-retry-vault-switch —— 跨 vault 存活

失败事实是内存态、按 vault 键控；切走时旧视图的动作不作用于新 vault，切回时 `harness_state`
的 `retry` 让前端在重放后重建恰好一条尾部动作（`content` / `enter` 两档同一口径，见 F4/F10）。
重载（webview reload）走同一条快照路径，本场景不重复构造。
