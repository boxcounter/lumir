---
id: "258-settings-provider-delete-active-oct30"
item: 258
tier: full
title: 设置面板：删除当前使用项后保存不再被删保护挡住（替代目标落盘 / 删除到空清单清 harness.provider）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  # 两个已保存条目、当前使用 = kimi-work：Alex 2026-10-30 的现场。rawProviders 原样写入条目
  # （显式声明 preset），避免具名键替条目补默认值。
  harness:
    provider: kimi-work
    rawProviders:
      kimi-work:
        preset: "kimi"
        api_key: "acceptance-dummy-kimi-1111"
        models:
          - { id: "k3-256k", effort: true, vision: false, window: 262144 }
      deepseek:
        preset: "deepseek"
        api_key: "acceptance-dummy-deepseek-2222"
        models:
          - { id: "ds-chat", effort: false, vision: false, window: 131072 }
steps:
  - name: ⌘,（与菜单「设置…」走同一条命令）
    do: keys
    keys: ["cmd+,"]
  # 面板打开是异步的（⌘, 还要经过原生菜单项的菜单跟踪，期间 AX 只读得到菜单栏）：先等可观测
  # 终态再判，否则第一次读取会拿菜单树去判面板。
  - name: 等面板落到可观测终态
    do: waitFor
    waitFor:
      has: ["模型接入与自动化 · 配置文件", "kimi-work，Kimi"]
    timeoutMs: 20000
    expect:
      - label: 面板打开在配置文件上
        ax: { has: "模型接入与自动化 · 配置文件" }
      - label: 两个条目都在列表里
        ax: { has: "deepseek，DeepSeek" }
      # 「当前」徽标是行按钮里的嵌套文本，`node` 在场性断言在这份快照上会被截断
      # （`truncated: [closed_menu]`，2026-10-30 实测：面板刚打开时行按钮不在快照里，正向判红、
      # 负向假绿）。改用表单头的动作钮判：当前项没有「设为当前使用」钮，非当前项才有
      # （与场景 250 同一判据形态）。
      - label: 默认选中的 kimi-work 是当前使用项（表单头没有「设为当前使用」钮）
        ax: { not: "AXButton (设为当前使用)" }
      - shot: 01-打开-两个条目

  # 正反两面对照：非当前项有「设为当前使用」钮，切回当前项就没有。判据落在同一个动作钮上，
  # 不依赖行内徽标的读屏形态。
  - name: 选中 deepseek（它不是当前使用项）
    do: click
    target: { role: "AXButton", name: "deepseek，DeepSeek" }
    expect:
      - label: 非当前项的右侧表单头给出「设为当前使用」钮
        ax: { has: "AXButton (设为当前使用)" }

  - name: 切回当前使用项 kimi-work
    do: click
    target: { role: "AXButton", name: "kimi-work，Kimi" }
    expect:
      - label: 当前项的表单头没有「设为当前使用」钮
        ax: { not: "AXButton (设为当前使用)" }

  - name: 记录配置文件基线（判「保存前不写盘」与后续落盘）
    do: record
    as: before-delete
    file: "env:config.json"

  - name: 打开删除确认
    do: click
    target: { role: "AXButton", name: "^删除…$" }
    expect:
      - label: 删除确认就地展开（同一屏，不是二级 modal）
        ax: { has: "删除 provider「kimi-work」？" }
      - label: 说明删除是草稿动作
        ax: { has: "删除是草稿动作" }
      - label: 当前使用项的保护块在位，并给出替代目标选择
        ax: { has: "它是当前使用的 provider。删除后切换到：" }
      # 替代目标选择器：判它的标签文案而不是控件的 AX role——role 随 WKWebView 版本漂移，
      # 文案是产品面（D779）。
      - label: 给出「新的当前项」选择器（默认替代目标）
        ax: { has: "新的当前项" }
      - label: 此刻不写盘（删除只是草稿动作）
        file: { path: "env:config.json", unchangedSince: before-delete }
      - shot: 02-删除确认-当前使用项

  - name: 确认删除（草稿动作）
    do: click
    target: { role: "AXButton", name: "^删除$" }
    expect:
      - label: 删除确认收起（确认是草稿动作，不是弹窗）
        ax: { not: "删除 provider「kimi-work」？" }
      # 徽标按草稿走：确认后「当前」已落到替代项——这正是旧实现出错的现场：界面看着已经切好，
      # 保存时却被「kimi-work 是当前使用项」挡住（delete 编辑没带替代目标）。表单头没有
      # 「设为当前使用」钮 = 右列这条（deepseek）已是草稿的当前使用项。
      - label: 草稿的当前使用已切到 deepseek
        ax: { not: "AXButton (设为当前使用)" }
      - label: 被删条目不再出现在列表里
        ax: { not: "kimi-work，Kimi" }
      - label: 确认删除仍然不写盘
        file: { path: "env:config.json", unchangedSince: before-delete }
      - shot: 03-确认删除-草稿态

  - name: 保存（同一笔把删除与替代目标落盘）
    do: click
    target: { role: "AXButton", name: "^保存$" }
    expect:
      - label: 保存成功（M811 的回归判据：旧实现这里被删保护挡下、状态是「需要修正」）
        ax: { has: /已保存/ }
      - label: 状态行不再报告需要修正
        ax: { not: /需要修正/ }
      - label: kimi-work 条目被删除
        file: { path: "env:config.json", not: '"kimi-work"' }
      - label: 当前使用项落成替代目标（不是留在被删 id 上）
        file: { path: "env:config.json", has: '"provider": "deepseek"' }
      - label: 替代目标 deepseek 条目仍在
        file: { path: "env:config.json", has: '"preset": "deepseek"' }
      - label: 文件里没有指向已删 id 的悬空引用
        file: { path: "env:config.json", not: '"kimi-work"' }
      - shot: 04-保存成功-替代目标落盘

  - name: 选中剩下的 deepseek
    do: click
    target: { role: "AXButton", name: "deepseek，DeepSeek" }
    expect:
      - label: deepseek 已是当前使用项（表单头没有「设为当前使用」钮）
        ax: { not: "AXButton (设为当前使用)" }

  - name: 打开删除确认（最后一个 provider）
    do: click
    target: { role: "AXButton", name: "^删除…$" }
    expect:
      - label: 删除确认就地展开
        ax: { has: "删除 provider「deepseek」？" }
      - label: 说明它是最后一个 provider、删后发送会被挡下
        ax: { has: "这是最后一个 provider。删除后将没有 provider，发送消息会被挡下" }
      - shot: 05-删除确认-最后一个

  - name: 确认删除并保存
    do: click
    target: { role: "AXButton", name: "^删除$" }
  - name: 保存删除到空清单
    do: click
    target: { role: "AXButton", name: "^保存$" }
    expect:
      - label: 保存成功（删到空清单不需要替代目标）
        ax: { has: /已保存/ }
      - label: 面板回到空态
        ax: { has: "还没有 provider" }
      - label: 用户条目被清空
        file: { path: "env:config.json", not: '"preset": "deepseek"' }
      - label: 当前使用键被删除（不留悬空 id）
        file: { path: "env:config.json", not: '"provider":' }
      - shot: 06-删到空清单
---

# 258-settings-provider-delete-active-oct30 —— 删除当前使用项的真实保存链

## 本场景在验什么

Alex 2026-10-30 在设置面删 provider 时遇到：列表只剩 `deepseek` 且徽标是「当前」，点保存却被顶部
错误挡住——`harness.provider provider "kimi" 是当前使用项，删除前必须选择替代 provider（可选
deepseek）`。界面显示的当前项与后端删除校验看到的当前项不一致。

根因（M811 定位）：删除确认**当场**把草稿的当前使用切到替代项（徽标按草稿走，这是对的），
但保存时 delete 编辑的替代目标按**最终草稿**判引用面——此时草稿的当前使用已经不是被删 id，于是
`active_after` 丢失。后端在同一笔里先应用 provider 删除、后应用 active 写入，删除时文件里的
`harness.provider` 仍是被删 id，删保护因此判红、整笔拒绝。

1. **删除当前使用项 → 保存成功**：删除确认给出替代目标（默认 deepseek），保存后
   `providers.kimi-work` 被删、`harness.provider` 写成 `deepseek`，没有悬空引用。旧实现这里
   保存被拒（状态「需要修正」）——本场景的第一条回归判据。
2. **删除是草稿动作**：确认删除后、保存前文件逐字节不变（`unchangedSince`）。
3. **删到空清单**：最后一个 provider 删除后保存，用户条目清空、`harness.provider` 键被删除，
   面板回到空态。

## 判据分工

- patch 形状（delete 编辑带 `active_after`、连续删除时替代目标取最终幸存项、命名引用重定向）
  归 `tests/unit/settings-panel.test.ts` 的 M811 用例与 `tests/visual/scenes/m734-settings-panel.spec.ts`
  的 patch 断言（chromium 层能读桩记录的真实请求）。
- 本场景只验真机主链：**确认删除 → 保存 → 文件事实**；不碰 API Key 输入框（password 在读屏里
  只剩圆点遮罩，见 250 的已知边界），配置由 front-matter 预置。
- 本场景不读取也不修改用户的真实配置：套件自带 `XDG_CONFIG_HOME` 与合成验收 vault。

## 判据形态备忘

- `ax.has` / `ax.not` / `file.has` / `file.not` 只收单个字符串或 `/…/` 正则；数组形态只有
  `waitFor.has` 支持。
- **「当前」徽标不直接判**：它是行按钮里的嵌套文本，首跑实测 `node` 在场性断言在这份快照上被
  截断（`truncated: [closed_menu]`，正向判红、负向假绿）。改判表单头的动作钮——当前项没有
  `AXButton (设为当前使用)`、非当前项才有；这是同一个 `draft.active` 的两个消费者，且场景 250
  已验证该判据形态。
- `node` 在场性断言与 `ax.has` 读的不是同一层快照：同一轮里 `ax.has "kimi-work，Kimi"` 为真、
  `node` 却找不到行按钮。写「某控件在不在」的负向判据前先确认它不是拿截断当「不在场」。
- 保存前不写盘同时看 `unchangedSince`（sha256）；把同一份字节重写一遍也会 PASS 的场景另加
  `mtimeUnchangedSince`（本场景的删除确认不涉及写通道，只判 sha256 足够区分）。
