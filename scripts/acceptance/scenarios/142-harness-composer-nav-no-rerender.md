---
# M447（change composer-emacs-nav）：导航**不是编辑**——导航（⌃F/⌃B/⌃N/⌃P）不改文本、不成撤销步。
# 判据：键入一段文本 → 导航若干次 → 文本逐字不变；随后一次 ⌘Z 收回的是**最后一次编辑**
#（导航之前那次键入），不是「导航」——导航若被当成一个撤销步，这次 ⌘Z 会空推一步、文本仍旧。
id: "142-harness-composer-nav-no-rerender"
item: 142
title: composer 导航不是编辑：文本不变、不成撤销步（M447）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入一段文本 abcde（typeInNode 整串一次粘贴 = 一个撤销步）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|abcde" }
    text: "abcde"
    expect:
      - label: 文本到位（abcde）
        ax: { has: "abcde" }

  - name: 连续导航（⌃F/⌃B/⌃B/⌃F/⌃N/⌃P，只移动、不输入）
    do: keys
    keys: ["ctrl+f", "ctrl+b", "ctrl+b", "ctrl+f", "ctrl+n", "ctrl+p"]
    gapMs: 120

  - name: 等一拍后读文本
    do: settle
    expect:
      - label: 导航后文本逐字不变（导航不是编辑）
        ax: { has: "abcde" }
      - label: 导航没有凭空插入任何字符（composer 节点值逐字仍为 abcde）
        ax: { has: '/AXTextArea = "abcde" @/' }
      - shot: 01-导航后文本不变

  - name: 一次 ⌘Z（面板自管的撤销栈）
    do: key
    key: "cmd+z"
    expect:
      - label: 收回到导航之前的那次编辑（文本整段收回）——导航若成步，这条会红（文本仍是 abcde）
        ax: { not: "abcde" }
---

# 142-harness-composer-nav-no-rerender —— 导航不是编辑（M447）

## 本场景在验什么

合同条款：仅移动光标 MUST NOT 改变块序列、MUST NOT 产生撤销步、MUST NOT 触发整面重渲
（change 的 design §6 与 specs/harness 增量的「导航不是编辑」段）。本场景覆盖其中两条**行为层**判据：

1. **不改文本**：连续导航后作曲家文本逐字不变（导航只写选区与滚动位）；
2. **不成撤销步**：随后一次 ⌘Z 收回的是**导航之前**的最后一次编辑（那段键入的文本），而不是
   空推一步「导航」。

## 判据为什么这样写

- **第 2 条是区分度所在**：实现把导航误做成一个撤销步的形态下，第一次 ⌘Z 弹回的是「导航前的
  状态」（文本与导航前一致 = `abcde`），文本**看不出变化**；断言「一次 ⌘Z 后 `abcde` 不在场」
  因此对「导航成步」的缺陷有区分度（REVIEW.md 第 1 条：先造一个必须让它失败的输入）。
- **「导航没有凭空插入任何字符」按节点值逐字判**（M455）：原先写的是 `ax: { not: "z" }`，
  但本场景**从头到尾没有键入过探针字符**（那是 140/141 的形态），单字符负向断言因此对着整份
  AX 文本匹配，命中了无关的界面文案（语言钮 `语言：zh`、窗口按钮 help `…action to zoom…`）
  ——静默假红（REVIEW.md 第 1 条：判据要有区分度）。改为钉 composer 节点的值：正则
  `/AXTextArea = "abcde" @/` 只在**值恰为 `abcde`** 时命中，导航若插入任何字符即失配。
  负向探针字符的写法只在**确实键入过该字符**的场景里成立（140/141）。
- **`gapMs: 80`**：五拍键入压在同一撤销聚簇窗口（1000ms）内，`abcde` 合成一个撤销步——这样
  「一次 ⌘Z 收回整段」才是稳定的期望（否则一个字一步，一次 ⌘Z 只收回 `e`）。
- **`do: settle`**：注入链路与 DOM 落地之间有时序，先等 GUI 稳定再读文本。

## 已知边界（如实登记）

- **「整面重渲」这一条（design §5.3 第 3 条的 MutationObserver 计数 = 0）本套件判不了**：
  runner 只有 KimiCU 的 AX / 截图 / 输入通道，**没有 JS 求值通道**（`lib/cu.mjs` 的 RPC 面里
  没有 evaluate 一类工具），挂不上 MutationObserver。本场景用它的**可观测后果**代替：
  导航后文本不变 + 导航不成撤销步（重渲会重建 DOM 子树；配合 `setDomCaret` 虽仍能保持光标，
  但「重渲」这个动作本身在 AX 层不可观测）。**已登记为未覆盖项**，见 change 的 tasks §7
  与 mission 报告的「未完成项」——低成本的补法是在 `scripts/acceptance` 增一条 JS 求值通道
  （新 verb）或在 `tests/visual` 加一条 chromium 结构断言，两者都超出本 mission 的写入面。
- 光标几何（可见性）无机器判据，留截图人工过目。
- 不发消息、不写 vault；真实 vault 与 `~/.config/lumir` 全程不读写。
