---
# M447（change composer-emacs-nav）：⌥⌫ 在 composer 内是**词级 kill**（经统一键位表），不是普通
# 退格——今天它被面板的就地退格分支当普通逐字符退格消费。判据：删掉整个词、被杀文本进 kill 槽
#（⌃Y 能整段插回）、裸 Backspace 仍是逐字符退格。
id: "144-harness-composer-alt-backspace"
item: 144
tier: full
title: composer ⌥⌫ 是词级删除（面板让位生效）、裸 Backspace 不变（M447）
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

  - name: 记编辑器文档基线（打字不得漏进文档）
    do: recordEditor
    as: doc-before-alt-bs

  - name: 键入 alpha beta gamma
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|alpha beta gamma" }
    text: "alpha beta gamma"
    expect:
      - label: 文本到位
        ax: { has: "alpha beta gamma" }

  - name: ⌥⌫（行尾词级 kill）后键入探针 z
    do: keys
    keys: ["alt+backspace", "z"]
    gapMs: 150
    expect:
      - label: 整个词 beta 之后的 gamma 被删掉、光标落在接缝处（键入 z ⇒ alpha beta z）
        ax: { has: "/alpha beta z/" }
      - label: 未退化为逐字符退格（残留 gamma 的形态不在场）
        ax: { not: "/alpha beta gam/" }
      - label: 打字没有漏进编辑器文档
        editor: { unchangedSince: doc-before-alt-bs }
      - shot: 01-段尾alt-backspace删整词

  - name: ⌃Y 把被杀文本插回（被杀内容进 kill 槽）
    do: key
    key: "ctrl+y"
    expect:
      - label: 被杀文本整段插回（z 之后接 gamma）
        ax: { has: "/zgamma/" }

  - name: 裸 Backspace（逐字符退格，本能力 MUST NOT 改变它）
    do: key
    key: "backspace"
    expect:
      - label: 只退掉一个字符（末字符 a 消失 ⇒ zgamm）
        ax: { has: "/alpha beta zgamm/" }
      - shot: 02-裸backspace逐字符
---

# 144-harness-composer-alt-backspace —— ⌥⌫ 是词级删除（M447）

## 本场景在验什么

合同：`⌥⌫` 与 `⌥Delete` SHALL 由本能力接管（经统一键位表），MUST NOT 被输入区既有的就地退格 /
前删路径吞掉——它们今天在 composer 内被当作**普通逐字符退格**消费（引擎原生词删除从未生效），
接管后 MUST 表现为词级 kill（change 的 harness 增量「删除族」段）。

现场与读数（mock provider，不发消息、零外部 API）：

1. 键入 `alpha beta gamma`，光标在行尾；
2. 按 ⌥⌫ → 删掉整个词 `gamma`（不是单个字符）；再键入探针 `z` → 文本是 `alpha beta z`
   —— 这条把「面板先消费、分发器让路」的陷阱变成红灯判据：陷阱形态下 ⌥⌫ 退化为逐字符退格，
   文本会是 `alpha beta gamm` + `z`；
3. 按 ⌃Y → 被杀文本 `gamma` **整段**插回（进的是 kill 槽，不是丢弃）；
4. 按裸 Backspace → 只退一个字符（`zgamm`）——本能力 MUST NOT 改变裸 Backspace。

## 判据为什么这样写

- **两条互补判据**：正向（`alpha beta z` 在场）+ 负向（`alpha beta gam` 不在场）。正向单条不够
  ——若只删一个字符并键入 z，文本是 `alpha beta gammz`，正向子串 `alpha beta z` **不命中**，
  但把两条写在一起能把「删了整词」与「删了一个字符」分开（REVIEW.md 「断言等价于子串」条：判据要有区分度）。
- **⌃Y 那一步是 kill 槽的读数**：词级删与「删除并丢弃」的区别只能从 ⌃Y 插回看出。
- **裸 Backspace 条**守住「本能力 MUST NOT 改变裸 Backspace」（合同明写的那一句）。
- **`gapMs: 80`**：长探针串的注入窗口压小，减少丢键复跑。

## 已知边界（如实登记）

- ⌥Delete（前删词）本场景不单独判，但**它在表内**：`Alt-Delete` → `editor.delete-word-forward`
  （与 ⌥D 同命令），与 ⌥⌫ 的 `Alt-Backspace` → `editor.delete-word-backward` 对称——两者走同一份
  词边界口径与同一键位层分派，方向由命令 id 决定；模型层单测覆盖 `killWordForward` /
  `killWordBackward` 两个方向。
- 「⌥⌫ 在段落段首不删前一张卡」的判据在场景 143。
- 不发消息、不写 vault；真实 vault 与 `~/.config/lumir` 全程不读写。
