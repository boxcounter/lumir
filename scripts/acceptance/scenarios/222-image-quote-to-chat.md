---
# M633（change add-image-quote-to-chat）：图片摘录到对话的真机判据 ①②③。
#   ① 悬停已渲染图片 → 引用钮（D370）→ 点击 → 图片卡片入 composer（编号 1、@ 引用钮）→
#      发送 → 留存里图片 part 带 `lumir_label":"Image 1"`、是 harness 附件引用而非 data URL、
#      消息正文不含 vault 源路径（来源只在人侧 hover title）。
#   ② 跨文字与图片的选区 → 引用卡片 + 图片块两张卡片（一个 ⌘Z 全撤）。
#   ③ 一次 ⌘Z 撤掉整次引用（结构编辑步 = 撤销步）。
# 判据的可读面：composer 图片卡片的编号徽标是裸数字（AX 无稳定形态），因此编号读数落在
# transcript 的 `图片 1：<name>`（D447 含编号形态）与留存的 `lumir_label` 上（同源派生）。
id: "222-image-quote-to-chat"
item: 222
title: 图片摘录到对话：悬停引用钮 / 跨图选区 / 一次 ⌘Z
fixtures: [image-quote-note.md, lightbox-bitmap.png]
open: image-quote-note.md
marker: "QALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-two.json"
seed:
  # 注册表 id 写死 acc-img-quote：harness 附件落点 = vault 稳定 id，留存路径因此可写死断言（同 127/148）。
  registry:
    - { id: acc-img-quote, path: $vault, lastOpenedAt: 1757000003000 }
steps:
  - name: 把光标放进编辑器第 1 行（键盘注入的前置）
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 抢前台（hover 与后台注入的 chord 都要前台——README「hover 的前台是硬前提」）
    do: focusWindow
    retries: 4

  # ① 悬停引用钮 → 图片卡片 → 发送
  - name: 悬停文档里的已渲染图片——引用钮应浮现（钮贴图片右下角内侧）
    do: hover
    target: { role: AXImage, any: "lightbox-bitmap.png" }
    expect:
      - label: 悬停图片后出现「摘录到对话」钮（D370 文案，与文本选区钮同一份）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 01-悬停引用钮
  - name: 点引用钮 → harness pane 未开先开、图片卡片入 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: harness pane 自动分栏打开（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 出现图片卡片（内容寻址名 + 元信息行）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: 图片卡片带 @ 插入引用钮（与粘贴图片同一形态，D457）
        ax: { has: "/AXButton \\(插入图片引用\\)/" }
      - shot: 02-图片卡入composer
  - name: 键入问题（typeInNode：composer 素材注入通道）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|pasted-" }
    text: "qimgmark"
    expect:
      - label: 问题落在 composer
        ax: { has: "qimgmark" }
  - name: 发送（Enter）
    do: key
    key: enter
  - name: 等 mock 回答（图片消息真实发出、回合完成）
    do: waitFor
    waitFor:
      has: ["验收回答：图片已收到。"]
    timeoutMs: 30000
    expect:
      - label: transcript 图片卡的可访问名含编号 1（卡片徽标与投递标签同源）
        ax: { has: "/图片 1：pasted-[0-9a-f]{16}\\.webp/" }
      - label: 留存图片 part 带结构化标签 `lumir_label` = Image 1
        file: { path: "env:harness/sessions/acc-img-quote/*.jsonl", has: '"lumir_label":"Image 1"' }
      - label: 留存图片 part 是 harness 附件引用（不是 data URL）
        file: { path: "env:harness/sessions/acc-img-quote/*.jsonl", has: '/"image_url":"lumir-attachment:\/\/pasted-[0-9a-f]{16}\.webp"/' }
      - label: 留存无 base64（引用进留存、展开只在 wire）
        file: { path: "env:harness/sessions/acc-img-quote/*.jsonl", not: "data:image" }
      - label: 悬停引用的消息正文 MUST NOT 出现 vault 源路径（来源只在人侧 hover title）
        file: { path: "env:harness/sessions/acc-img-quote/*.jsonl", not: "lightbox-bitmap.png" }
      - shot: 03-发送后-图片卡编号

  # ② 跨文字与图片的选区 → 卡片 + 图片块
  - name: 回到编辑器（新建下一条消息；第 3 行是 QALPHA 段，第 5 行是图片）
    do: clickEditor
  - name: 光标下移到第 3 行
    do: keys
    keys: ["ctrl+n", "ctrl+n"]
  - name: ⌃⇧N 扩选两行——选区跨过文字、空行与图片源码
    do: keys
    keys: ["ctrl+shift+n", "ctrl+shift+n"]
    expect:
      - label: 浮动摘录钮浮现（选区有效）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 04-跨图选区
  - name: 点摘录钮 → 引用卡片 + 图片块一起进入 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: composer 出现两张卡片（引用卡片 + 图片块，各带 × 移除钮 = D371 同文案）
        ax: { count: { pattern: "/AXButton \\(移除摘录\\)/", exact: 2 } }
      - label: 引用卡片带出处行（文档名 · 最近一级标题）
        ax: { has: "image-quote-note.md · 图片摘录验收" }
      - label: 图片块紧接卡片之后（图片卡片带 @ 引用钮，恰一个）
        ax: { count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 1 } }
      - shot: 05-卡片与图片块

  # ③ 一次 ⌘Z 撤掉整次引用（一个结构编辑步）
  - name: 一次 ⌘Z（composer 焦点在插入后已落回输入区）
    do: keys
    keys: ["cmd+z"]
    expect:
      - label: 两张卡片同时撤掉（卡片 + 图片块是一个撤销步）
        ax: { count: { pattern: "/AXButton \\(移除摘录\\)/", exact: 0 } }
      - label: 图片块的 @ 钮一并消失（图片块随整次引用撤掉）
        ax: { count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 0 } }
      - shot: 06-一次撤销后
---

# 222-image-quote-to-chat —— 图片摘录到对话

## 本场景在验什么

change add-image-quote-to-chat 的两条入口与一条结构性承诺：

1. **悬停引用钮（单图）**：文档里已渲染的图片悬停浮现「摘录到对话」（D370，与文本选区钮
   同一份文案、同一形态家族）；点击把该图作为图片卡片插入 composer（与粘贴图片同一协议：
   编号、`@` 引用、投递标签、transcript 同构）。发送后留存里图片 part 带
   `lumir_label":"Image 1"`，正文无 base64、无 vault 源路径——来源只在人侧 hover title。
2. **跨图选区**：选区跨文字与图片时，一次手势产出「引用卡片 + 图片块」，出处行照旧
   （文档名 · 最近一级标题）。
3. **一个撤销步**：整次引用是**一次**结构编辑（⌘Z 一次撤掉卡片与图片块）。

## 判据为什么这样写

- **hover 的前台前提**：`do: hover` 走真实鼠标事件，落点必须在前台窗口上——`focusWindow`
  是硬前置（README 的 hover 条：拿不到前台时动作抛 InfraError、整场 INVALID）。
- **编号读数落在两处**：composer 的序号徽标是图上的裸数字（AX 无稳定形态，归视觉场景
  `m633-image-quote.spec.ts` 与 Alex 手感）；可判的编号读数 = transcript 卡片的
  `图片 1：<name>`（D447）与留存的 `lumir_label`——两者同源（`imageOrdinals` 的派生读数）。
- **「无 vault 源路径」只对悬停引用这条判**：跨图选区的引用正文**刻意保留**图片源码
  （`![[…]]` 是失锚前缀校验的逐字依据，design §5），那条消息里出现文件名是诚实上下文，
  不是本能力的来源字段泄漏。
- **一次 ⌘Z 的判据**：两张卡片的 × 钮计数从 2 → 0。卡片按原子块整体撤销，插入编排走
  一次 `withModel`（单快照），因此一次撤销必然同时撤掉两件。
- **覆盖边界（如实登记）**：引用钮的浮现手感、图片卡片观感归 Alex dogfood；本场景只判
  「可见 / 进入 composer / 编号与标签同源 / 一次撤销」这些机器可读面。本场景首版**只过
  静态校验**（`node scripts/acceptance/run.mjs --check`），真机跑批归 dogfood 批次。
