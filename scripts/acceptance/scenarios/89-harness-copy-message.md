---
id: "89-harness-copy-message"
item: 89
title: 复制消息：消息 hover 钮复制该消息 Markdown 源文本（剪贴板逐字断言）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-copy.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: 面板在位（发送钮）
        ax: { has: "/AXButton \\(发送\\)/" }

  - name: 输入提问并 Enter 发送（提问串全小写，与回答的大写标记互不互为子串）
    do: keys
    keys: ["c", "o", "p", "y"]
  - name: 发送
    do: key
    key: enter

  - name: 等回答到达（此刻 transcript 里两条消息各挂一个 hover 复制钮）
    do: waitFor
    waitFor:
      has: ["COPY-PROBE 这段正文应当原样进入剪贴板。"]
    expect:
      - label: 回答已渲染
        ax: { has: "COPY-PROBE 这段正文应当原样进入剪贴板。" }
      - label: 复制钮在场（D379 读屏名，用户消息一个、回答消息一个）
        ax: { count: { pattern: "/AXButton \\(复制消息\\)/", min: 2 } }
      - shot: 01-两条消息

  - name: 点回答消息的复制钮（DOM 序：用户在前、回答在后 ⇒ nth 1）
    do: click
    target: { role: AXButton, name: "复制消息", nth: 1 }

  - name: 等剪贴板写入（clipboard.writeText 是异步 promise）
    do: sleep
    ms: 800
    expect:
      - shot: 02-复制后
      - label: 剪贴板 = 该消息的 Markdown 源文本（模型原始输出，逐字）
        clipboard: { has: "COPY-PROBE 这段正文应当原样进入剪贴板。" }
      - label: 复制的是回答消息，不是用户消息（提问串不在剪贴板里）
        clipboard: { not: "copy" }
---

# 89-harness-copy-message —— 消息复制（change move-harness-to-pane-chat-frame tasks 4.2）

## 本场景在验什么

消息 hover 浮现复制钮（键盘 focus 也显形），点击把**该消息的 Markdown 源文本**写进系统剪贴板：
agent 消息的源 = 模型原始输出，用户消息的源 = 发送前原始输入（序列化文本），**不是渲染后
HTML**（`src/harness-panel.ts` 的 `copySources` 单挂，复制只从那里取）。

## 断言口径

- **复制源是 Markdown 源**：剪贴板断言逐字（`clipboard.has`）——回答的原始文本里没有任何
  Markdown 结构（纯段落），因此「渲染后 HTML」与「源文本」的分歧在本 fixture 上不可直接判；
  这条判的是「复制出的就是该消息的源串」。含结构消息（加粗 / 列表）的源 vs 渲染判别在视觉层
  （`tests/visual/scenes/m347-harness-composer.spec.ts`）。
- **点的是哪一条**：用户消息与回答消息各挂一个复制钮（都读作 `复制消息`，D379）。DOM 序里用户
  消息在前、回答在后 ⇒ `nth: 1` 取回答的。负向断言 `clipboard.not "copy"`（用户提问的全小写
  串）钉住「点的确实是回答那条」——**不是**用剪贴板残留蒙混（`clipboard.has` 单独会被上一次
  的残留骗过，因此配一条互斥的负向）。
- **剪贴板是唯一可断言通道**：复制结果既不在 AX 也不在磁盘，只有系统剪贴板读得到（与场景 61
  同一口径；读数走套件的固定 `osascript` 通道）。

## 已知边界（如实登记）

- **复制成功的就地反馈（`✓ 已复制`，D380）不可断言**：钮的 aria-label 只在创建时设一次、
  复制成功后不更新，可访问名恒为 `复制消息`；`✓ 已复制` 只是按钮内文本的替换，不保证被
  AX 暴露为独立静态文本节点。反馈的 1.5s 消退与 `.is-copied` 配色归视觉层。
  本场景因此**只断言剪贴板内容**（复制真的发生了及其内容），不判钮面反馈。
- **hover 才算 `opacity:1`**：复制钮平时 `opacity:0`，但 opacity 不进 AX 的「不可见」判定，
  节点仍在树里、AXPress 仍可触发。真机实录若不成立（节点缺席），会在 `count` 那条断言上
  显形为 FAIL——那是通道问题，不是产品缺陷，按套件侧处置。
- **富文本来源**：本场景只有纯文本段落。带摘录卡片的用户消息复制的是序列化文本（卡片标记 +
  问题段落），其形态在场景 85（transcript 同构）与 quote-card 视觉场景里覆盖。

## 环境与副作用

- **会写系统剪贴板**（这就是被测行为）；不写 vault 文件。真实 vault 只读。
- 合成 vault `/tmp/lumir-m102-acceptance` + 隔离 `XDG_CONFIG_HOME`；1420 全程不碰。
