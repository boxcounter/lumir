---
id: "87-harness-ctx-warn"
item: 87
title: ctx% 越警示阈值：读数高亮 + ⓘ 钮按需气泡（常驻警示句已移除）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-ctx-warn.json"
    # auto_compact 关掉：本场景只验**读数与警示的呈现**，不断言自动压缩——开着的话 ctx 90%
    # 会触发一轮 compact（再向 mock 要一次响应、fixture 弹尽），把判据搅浑。
    autoCompact: false
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 控制行在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: 还没有读数——ⓘ 钮不在场
        ax: { not: "上下文用量说明" }

  - name: 输入提问并 Enter 发送
    do: keys
    keys: ["o", "v", "e", "r"]
  - name: 发送
    do: key
    key: enter

  - name: 等回答到达（usage 118000/131072 ≈ ctx 90%，越默认线 85）
    do: waitFor
    waitFor:
      has: ["用量越线回答。"]
    expect:
      - label: 控制行读数 = ctx 90%（118000/131072 四舍五入）
        ax: { has: "ctx 90%" }
      - label: 越线时 ⓘ 钮出现（D377 读屏名；未越线时它不存在，见场景 76）
        ax: { has: "上下文用量说明" }
      - label: 气泡默认收起——常驻警示句已移除，提示只在点开 ⓘ 后出现
        ax: { not: "越过 85% 警示线" }
      - shot: 01-读数越线-ⓘ在场

  - name: 点 ⓘ 展开气泡
    do: click
    target: { role: AXButton, name: "上下文用量说明" }
    expect:
      - shot: 02-气泡展开
      - label: 气泡如实说明后果（越线 → 自动压缩续聊）
        ax: { has: "上下文已用 90%，越过 85% 警示线——继续对话将自动压缩续聊" }
---

spec 判据（harness「上下文用量显示与触顶处理」，M347 改形后）：读数越过警示阈值
（`[harness].warn_ctx_pct`，缺省 85）时读数高亮，且出现 ⓘ 钮；警示说明收敛为**点击 ⓘ 展开的
气泡**，不再常驻（Alex 2026-10-06 裁决「一直显示在那里很抢注意力」）。

- 本场景用默认阈值 85：mock 的 usage 取 118000/131072 ≈ 90.03% ⇒ 读数 90%，确定越线。
  `auto_compact` 关掉（见 front-matter 注释）——本场景判的是**读数与警示的呈现**，压缩行为
  本身在别的通道判（`session.rs` 单测与 mock 的 overflow 响应）。
- 「气泡默认收起」用 `not: "越过 85% 警示线"` 判——该串只在气泡文案里出现；关掉时气泡元素
  `hidden`（display:none）不进 AX 树。这是「不再常驻」的判据（修复前那句是常驻警示条）。
- 「ⓘ 钮是越线才出现的按需入口」由本场景的正观测 + 场景 76 的负观测（未越线时
  `not: "上下文用量说明"`）合起来判。

## 已知边界

- **高亮本身是配色**：`is-warn` 类改的是读数颜色，AX 读不到色值；读数的存在与 ⓘ 在场是可判的
  部分，配色观感归视觉层（`tests/visual/scenes/m347-harness-composer.spec.ts` 的计算属性断言）。
- **ⓘ 钮的可见字符是 `ⓘ`**：可访问名取 aria-label（D377），因此按读屏名找它，不按字形。
