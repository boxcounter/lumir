---
id: "84-quote-card-anchor-loss"
item: 84
title: 摘录卡片 ④ 失锚降级三层（行号命中 / 漂移后全文搜索 / 失锚 toast）
open: harness-quote-anchor.md
marker: "QANCHOR"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: 把光标放进编辑器第 1 行
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台
    do: focusWindow
    retries: 4
  - name: 光标下移到 QANCHOR 那一行
    do: keys
    keys: ["ctrl+n"]
  - name: ⌃⇧N 扩选
    do: keys
    keys: ["ctrl+shift+n"]
  - name: 点浮动钮把摘录做成卡片
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片入 composer（出处行在场）
        ax: { has: "harness-quote-anchor.md · 失锚验收" }
      - shot: 01-卡片

  - name: 第一层——行号命中：点卡片跳回，选区落在摘录行范围
    do: click
    target: { role: AXGroup, help: "—— 失锚验收" }
    expect:
      - label: 没走第三层（行号命中不应弹失锚 toast）
        ax: { not: "该摘录已失锚" }
  - name: 用一次性输入读出跳回落点（AX 读不到选区，落点是派生判据）
    do: keys
    keys: ["r"]
    expect:
      - label: 行号命中把整段行范围设为选区：跳回后键入替换掉摘录那两行
        editor: { has: "r" }
      - label: 被替换的是摘录行范围（QANCHOR 与下一行都被吃掉）
        editor: { not: "QANCHOR" }
      - shot: 02-行号命中

  - name: 撤销，恢复文档（下一层要用同一张卡片）
    do: keys
    keys: ["cmd+z"]
    expect:
      - label: 文档已恢复
        editor: { has: "QANCHOR 这一段用于行号定位。" }

  - name: 造漂移：在 QANCHOR 行首插入一个字符
    do: clickEditor
  - name: 抢前台
    do: focusWindow
    retries: 4
    expect:
      - label: (定位前的稳定) 焦点在编辑器
        ax: { focused: "AXTextArea" }
  - name: 光标下移到 QANCHOR 行首
    do: keys
    keys: ["ctrl+n", "ctrl+a"]
  - name: 行首插入 x（行号不变、前缀失配 ⇒ 第一层应失败、落到第二层）
    do: keys
    keys: ["x"]
    expect:
      - label: 漂移已落地（行首多了 x）
        editor: { has: "xQANCHOR 这一段用于行号定位。" }

  - name: 第二层——漂移后全文搜索命中：跳回落在摘录字符串处（x 前缀被保留）
    do: click
    target: { role: AXGroup, help: "—— 失锚验收" }
    expect:
      - label: 仍没走第三层
        ax: { not: "该摘录已失锚" }
  - name: 用一次性输入读出跳回落点
    do: keys
    keys: ["w"]
    expect:
      - label: 搜索命中只替换摘录字符串本身（x 前缀仍在 ⇒ 不是整行替换）
        editor: { has: "xwQSECOND 第二段，不动。" }
      - label: 摘录原文已从文档消失（第三层的现场就绪）
        editor: { not: "QANCHOR" }
      - shot: 03-搜索命中

  - name: 第三层——原文已失锚：点卡片应弹 toast（不静默跳别处）
    do: click
    target: { role: AXGroup, help: "—— 失锚验收" }
  - name: 等失锚告知出现
    do: waitFor
    waitFor:
      has: ["该摘录已失锚"]
    expect:
      - label: 失锚 toast 文案在场（D372）
        ax: { has: "该摘录已失锚：原文已不在文档中" }
      - label: 失锚时不改动文档（没有静默跳到错误位置）
        editor: { has: "xwQSECOND 第二段，不动。" }
      - shot: 04-失锚toast
---

# 摘录卡片 ④ 失锚降级三层

spec 判据（change add-harness-quote-cards 的「摘录失锚降级链」）：点击卡片跳回时三层降级——
① 按 lines 行号定位并校验原文前缀；② 失配则文档内搜索摘录原文字符串；③ 仍找不到则 toast 告知
失锚，不静默跳到别处。

## 判据为什么这样写（AX 读不到选区，落点用派生判据）

- 套件的「光标/选区不可断言」边界：KimiCU 不暴露选区范围。于是每一层都用**跳回后键入一个
  一次性字符**读出落点——落点由跳回设置，字符由该落点产生，别的路径产不出来：
  - **第一层**：整行范围被设为选区，键入 `r` 替换掉 QANCHOR 那一行**与它的下一行**
    （`resolveQuoteAnchor` 的行范围口径 = `line(start).from .. line(end).to`）⇒ 断言 `r` 在场、
    `QANCHOR` 消失。
  - **第二层**：文档被行首插入 `x` 漂移（行号还在、前缀已失配）⇒ 第一层失败、全文搜索命中
    摘录字符串本身。键入 `w` 只替换那串字符串 ⇒ **`x` 前缀被保留**（`xwQSECOND…`）。
    这正是区分第一/二层的判据：若第一层命中，替换的是整行，`x` 不会留下。
  - **第三层**：第二层已把摘录原文从文档移除 ⇒ 再点卡片两层都落空 ⇒ toast D372。
- 每层都先断言**没弹失锚 toast**（或第三层断言弹了）——把「层与层」的分界钉在可见文案上。
- 撤销一步是为了让第二层用同一张卡片：`edit` 的落点判据与卡片数据无关，撤销后卡片仍指向
  原始 lines / 原文。
