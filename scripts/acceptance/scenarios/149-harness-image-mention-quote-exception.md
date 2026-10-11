---
# M454（change composer-image-mention）design §10 ⑤ + MODIFIED「引用消息序列化协议」的
# 「图片块的编号例外」：一条消息同时含**引用卡片**与**图片卡片**时——
#   - `<quote>` 元素**零编号**（无序号属性，沿用既有口径）；
#   - 图片块**带** `Image N` 标签（`lumir_label`），N 与卡片编号同源。
# 这是本 change 收窄「零编号」禁令边界后，唯一被正面修订的形态；51「图片消息投递协议」那句
# 「文本 part 的序列化 MUST NOT 包含卡片编号」已同口径收窄为「引用卡片与消息摘录卡片」
# （见 openspec/specs/harness/spec.md 与本 change 的 MODIFIED 增量）。
id: "149-harness-image-mention-quote-exception"
item: 149
title: 编号禁令边界：引用卡片零编号、图片块带 Image N 标签（同消息并存的例外口径）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-two.json"
seed:
  registry:
    - { id: acc-img, path: $vault, lastOpenedAt: 1757000002000 }
steps:
  - name: 光标进编辑器第 1 行（键盘注入前置）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台（后台注入的 chord 被抢前台时会丢键——REVIEW.md 第 11 条）
    do: focusWindow
    retries: 4
  - name: 光标下移到第 3 行
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
  - name: ⌃⇧N 选中第 3 行——浮动「摘录到对话」钮浮现
    do: keys
    keys: ["ctrl+shift+n"]
    expect:
      - label: 浮动「摘录到对话」钮在场
        ax: { has: "摘录到对话" }
  - name: 点浮动钮 → harness pane 自动分栏、引用卡片入 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: harness pane 自动分栏打开（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 内的引用卡片带出处行（文档名 · 最近一级标题，无编号）
        ax: { has: "harness-note.md · Harness 验收笔记" }

  - name: 真实鼠标点 composer（图卡片的输入面）
    do: clickInNode
    target: { role: AXTextArea, name: "/harness-note\\.md/" }
  - name: 剪贴板置合成 png（seed 11）
    do: clipboardImage
    synth: { width: 320, height: 200, seed: 11 }
  - name: 右键 composer 唤原生菜单（引用卡片 + 待贴图）
    do: click
    target: { role: AXTextArea, name: "harness-note.md", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }
  - name: 点 Paste 贴入图片卡片
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }
  - name: 等图片卡片出现（引用卡 + 图片卡并存于 composer）
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
    expect:
      - label: 图片卡片带 `@` 插入引用钮（图片块有编号面）
        ax: { has: "/AXButton \\(插入图片引用\\)/" }
      - label: 引用卡片的 × 移除钮仍在（两卡片各自的动作钮）
        ax: { has: "/AXButton \\(移除摘录\\)/" }
  - name: 键入问题段（让文本 part 非空，消息更接近真实形态）
    do: type
    text: "xqmark"

  - name: 发送（composer = [引用卡, 图片卡, 段落 xqmark]）
    do: key
    key: enter
  - name: 等回合收口
    do: waitFor
    waitFor:
      has: ["验收回答：图片已收到。"]
    timeoutMs: 30000
    expect:
      - label: 回答渲染（回合完成）
        ax: { has: "验收回答：图片已收到。" }
      - label: ⑤ 引用卡片零编号：`<quote>` 元素在留存里，形态是 file/heading/lines（无序号属性）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", has: '<quote file=' }
      - label: ⑤ 序列化结构不含任何序号属性（`index` / `seq` / `#N`）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", not: '"index":' }
      - label: ⑤ 图片块是该禁令的唯一例外：图片 part 带 `lumir_label` = Image 1
        file: { path: "env:harness/sessions/acc-img/*.jsonl", has: '"lumir_label":"Image 1"' }
      - label: ⑤ 留存无 base64（引用形态）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", not: "data:image" }
      - shot: 01-引用卡与图片卡并存-零编号例外
---

# 149-harness-image-mention-quote-exception —— 编号禁令的边界（change composer-image-mention）

## 本场景在验什么

design §10 ⑤ 与 MODIFIED「引用消息序列化协议」的「图片块的编号例外」：一条消息**同时**含引用
卡片与图片卡片时——

- `<quote file="…" heading="…" lines="…">` 元素**零编号**（无 `index` / 序号属性，2026-10-06
  一致性原则对**有文本身份的引用卡片**依然成立）；
- **图片块是唯一例外**：图片 part 带结构化标签 `lumir_label` = `Image N`（`input_image` part
  在 wire 上没有文本身份，编号是模型指代单张图的唯一把手）。

本 change 把「序列化结构 SHALL NOT 包含任何编号」的**作用面收窄**为引用卡片 / 消息摘录卡片，
并同口径修订了 living spec 的「图片消息投递协议」里「文本 part 的序列化 MUST NOT 包含卡片编号」
一句（`openspec/specs/harness/spec.md`）——本场景钉的就是收窄后的两侧并存形态。

## 判据为什么这样写

- **手势**：选区在 AX 层不可断言，用 ⌃⇧N 键盘扩选建立选区（同场景 81）；浮动钮「摘录到对话」
  是 D370。
- **并存形态**：引用卡片用「出处行」正观测（只由卡片渲染产出）；图片卡片用 `@` 钮（D457）正观测；
  两者各自的动作钮（× D371）都在场，证明两张卡片真的并存于 composer。
- **序列化判据落磁盘事实**：`llm_request` 留存的引用形态逐字节落 JSONL——`<quote file=` 在场
  （引用卡零编号）+ `"lumir_label":"Image 1"` 在场（图片块有标签）+ `not: '"index":'`（结构无序号）
  + 无 base64。wire 展开后的 `input_text "Image N"` 标签行不在磁盘上，由 Rust 单测
  `expand_image_refs_from` 钉（同场景 148 的边界说明）。
- **覆盖边界（如实登记）**：编号一致性 / `@` 插入 / 恢复 / 移除重编在场景 148；
  卡片徽标与两钮的确切视觉形态归视觉场景与 Alex 过目。
