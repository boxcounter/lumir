---
id: "83-quote-card-serialization"
item: 83
title: 摘录卡片 ③ 引用消息序列化结构（file/heading/lines 三属性、转义、协议无编号）
open: harness-quote-escape.md
marker: "QESC"
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
  - name: 光标下移到 QESC 那一行
    do: keys
    keys: ["ctrl+n"]
  - name: ⌃⇧N 扩选（选中含 XML 保留字符的摘录）
    do: keys
    keys: ["ctrl+shift+n"]
  - name: 点浮动钮把摘录做成卡片
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: 卡片出处行（文档名 · 标题，标题里的 & 原样显示）
        ax: { has: "harness-quote-escape.md · A & B 标题" }
      - shot: 01-卡片
  - name: 记录编辑器基线（守卫：素材注入不得漏进编辑器）
    do: recordEditor
    as: 编辑器基线-首问
  - name: 点 composer 确立焦点（AXPress 插卡后渲染层焦点可能仍在编辑器——M501/M500 归因；
      点底部空段落把焦点与 caret 都交给 composer，供随后的素材注入与 Enter 发送）
    do: clickInNode
    target: { role: AXTextArea, name: "A & B 标题" }
    dy: 0.9
    expect:
      - label: 焦点落在 composer（focused 标记在 AXTextArea 上）
        ax: { focused: "AXTextArea" }

  # M502 回退（tower 裁决，M500 归因）：卡片语境（AXPress 插卡后）三通道边界——
  #   type_text 无 index：真实投递与 AX (focused) 标记背离（标记在 composer、盲注落进编辑器）；
  #   type_text 带 index：AX 注入不进 composer 模型（后续读模型状态的步骤穿帮）；
  #   本步 press_key：该语境可靠（85 于 2026-10-13 03:39Z pre-M498 整场景 PASS 的对照）⇒ 回退 do:keys。
  # 素材串刻意无 'e'（press_key 确定性丢 'e'，M497 finding）——本族素材（alpha/q/tpmsg）均不含 'e'。
  # 保留：composer 焦点确立步（clickInNode）与 editor.unchangedSince 守卫。M501 的 typeInNode
  #   attempt-1 焦点校验防不住本族（真机复跑实证漏注入编辑器），守卫断言才是终防线。
  - name: 在卡片后的问题段落写一个字（证明携带卡片的消息照常投递）
    do: keys
    keys: ["q"]
    gapMs: 100
    expect:
      - label: 注入没有漏进编辑器（逐字节比对基线）
        editor: { unchangedSince: 编辑器基线-首问 }
  - name: 发送
    do: key
    key: enter
  - name: 等 mock 回答到达（发送闭环）
    do: waitFor
    waitFor:
      has: ["验收回答：上下文已收到。"]
    expect:
      - label: 序列化逐字节正确——<quote> 三属性（file/heading/lines）+ 属性值与文本双重转义
        file:
          path: "env:harness/sessions/*/*.jsonl"
          has: '<quote file=\"harness-quote-escape.md\" heading=\"A &amp; B 标题\" lines=\"3-4\">QESC 原文含 &lt;尖括号&gt; 与 &amp; 符号。\n</quote>'
      - label: 协议无编号（一致性原则：属性集合恒为 file/heading/lines，无 index 或任何序号）
        file: { path: "env:harness/sessions/*/*.jsonl", not: "index=" }
      - label: 问题文字按交错顺序排在标签之后（卡片阅读顺序 = 序列化顺序）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '</quote>\nq' }
      - label: 携带卡片的消息跳过视口注入，路径注入恒在（chip 与 JSONL 同源）
        file: { path: "env:harness/sessions/*/*.jsonl", has: '当前编辑器上下文：\n文件：harness-quote-escape.md' }
      - shot: 02-序列化
---

# 摘录卡片 ③ 引用消息序列化结构

spec 判据（change add-harness-quote-cards 的「引用消息序列化协议」）：发送时混排内容序列化为
XML——每段摘录 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`，问题文字按交错顺序
排布在标签之间；属性值与文本 XML 转义；**协议与 UI 均无编号**（一致性原则）。

## 判据为什么这样写

- **逐字节断言替代结构解析**：序列化产物落在 JSONL 留存里（`env:harness/sessions/*/*.jsonl` 的
  `llm_request.request.messages` 里那条 user 消息），断言直接写期望的那一行 XML。属性顺序、取值、转义形态任意一处漂移都
  会红——比「解析后再比对字段」更严，也不需要场景里再实现一个 XML 解析器。
- **插卡后有点 composer 确立焦点一步**（M501，M500 归因）：与场景 82/85 同构——卡片钮是 AXPress，
  之后渲染层焦点可能仍在编辑器；这步点击是 `editor.unchangedSince` 守卫的前置，也让 `do: keys`
  的回读目标落在 composer。
- **素材注入走 `do: keys` 而非 `typeInNode`**（M502 回退，tower 裁决）：卡片语境（AXPress 插卡后）
  里 `type_text` 无 index 的真实投递与 AX `(focused)` 标记背离、带 index 的注入不进 composer 模型，
  而 press_key 在此语境可靠（85 于 2026-10-13 03:39Z pre-M498 整场景 PASS 的对照）；素材串
  `q` 刻意无 'e'（press_key 确定性丢 'e'，M497 finding）。
- 转义覆盖两条路径：**属性值**（heading 含 `&` → `&amp;`）与**文本节点**（摘录原文含 `<`、
  `>`、`&` → `&lt;` / `&gt;` / `&amp;`）。fixture `harness-quote-escape.md` 就是为这两条造的。
- 「无编号」是**一致性原则**（Alex 2026-10-06）的机器判据：`not: "index="` 挡任何序号属性复活。
- 交互顺序：`</quote>\nq` 断言问题文字排在标签之后（卡片阅读顺序 = 序列化顺序）。
- 摘录原文以选区实际捕获为准：键盘扩选把行尾换行也纳入选区，因此原文末尾带一个 `\n`
  （`</quote>` 因此落在下一行）——这是**捕获口径**的如实产物，不是序列化改写原文。
