---
# M633（change add-image-quote-to-chat）：图片摘录到对话的真机判据 ①②③。
#   ① 悬停已渲染图片 → 引用钮（D370）→ 点击 → 图片卡片入 composer（编号 1、@ 引用钮）→
#      发送 → 留存里图片 part 带 `lumir_label":"Image 1"`、是 harness 附件引用而非 data URL、
#      消息正文不含 vault 源路径（来源只在人侧 hover title）。
#   ② 跨文字与图片的选区 → 引用卡片 + 图片块两张卡片（一个 ⌘Z 全撤）。
#   ③ 一次 ⌘Z 撤掉整次引用（结构编辑步 = 撤销步）。
# 判据的可读面：composer 图片卡片的编号徽标是裸数字（AX 无稳定形态），因此编号读数落在
# transcript 的 `图片 1：<name>`（D447 含编号形态）与留存的 `lumir_label` 上（同源派生）。
# ④（M666，change svg-image-quote-oct24）：svg 引用走**栅格化成功路径**——写入口把 SVG 渲成
#    位图后走既有 png→WebP 链路，卡片拿到的是 `pasted-<hash16>.webp`（M662 那条 D585 失败面
#    只留给真正不支持的类型，如 gif）。M662 时代本段断言的是「svg 引用失败 + D586 留痕」，
#    M666 把 svg 移进可引用表后该断言与产品行为相反，故整段改写。
id: "222-image-quote-to-chat"
item: 222
title: 图片摘录到对话：悬停引用钮 / 跨图选区 / 一次 ⌘Z / svg 栅格化引用
fixtures: [image-quote-note.md, lightbox-bitmap.png, image-quote-logo.svg]
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
  - name: 抢前台并让窗口成为 key window（hover 的前台是硬前提；key 状态见下）
    do: focusWindow
    retries: 4
    click: true

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

  # ④ svg 引用成功（M666）：栅格化 → 位图落盘 → 卡片入 composer（不再是 M662 的失败面）
  - name: 回到编辑器，光标移到文档末段（第 11 行是 svg 图片——图片须进视口才 hover 得到）
    do: clickEditor
  - name: ⌃N 逐行下移十次到第 11 行（第 1 行起，编辑器随光标滚动把图片带进视口）
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n", "ctrl+n"]
  - name: 让窗口成为 key window（hover 的真实鼠标事件落在 key window 上；M669 的 222 首跑实证）
    do: focusWindow
    retries: 4
    click: true
  - name: 悬停 svg 图片——引用钮应浮现（与位图那张同一份文案）
    do: hover
    target: { role: AXImage, any: "image-quote-logo.svg" }
    retries: 4
    expect:
      - label: 悬停后出现「摘录到对话」钮（与位图那张同一份文案）
        ax: { has: "/AXButton \\(摘录到对话\\)/" }
      - shot: 07-悬停svg引用钮
  - name: 点引用钮 → 栅格化后按位图落盘 → 图片卡片入 composer
    do: click
    target: { role: AXButton, name: "摘录到对话" }
    expect:
      - label: composer 出现图片卡片，名字是内容寻址的 webp（栅格化产物——MUST NOT 是 svg 名）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: 图片卡片带 @ 插入引用钮（与位图引用同一形态）
        ax: { has: "/AXButton \\(插入图片引用\\)/" }
      - label: 成功路径不产失败留痕（D586 状态行不出现——它是持久的，缺席是稳态读数）
        ax: { not: "张图片未能引用" }
      - label: 不出现「暂不支持引用该格式」（D585 只留给真正不支持的类型）
        ax: { not: "暂不支持引用该格式" }
      - shot: 08-svg引用成功
---

# 222-image-quote-to-chat —— 图片摘录到对话

## 本场景在验什么

change add-image-quote-to-chat 的两条入口与一条结构性承诺；M662 加失败面；M666 把 svg 从
失败面移进成功路径：

1. **悬停引用钮（单图）**：文档里已渲染的图片悬停浮现「摘录到对话」（D370，与文本选区钮
   同一份文案、同一形态家族）；点击把该图作为图片卡片插入 composer（与粘贴图片同一协议：
   编号、`@` 引用、投递标签、transcript 同构）。发送后留存里图片 part 带
   `lumir_label":"Image 1"`，正文无 base64、无 vault 源路径——来源只在人侧 hover title。
2. **跨图选区**：选区跨文字与图片时，一次手势产出「引用卡片 + 图片块」，出处行照旧
   （文档名 · 最近一级标题）。
3. **一个撤销步**：整次引用是**一次**结构编辑（⌘Z 一次撤掉卡片与图片块）。
4. **svg 栅格化引用（M666）**：引用一张 svg 时，写入口把 SVG 渲成位图再走既有 png→WebP
   链路——卡片拿到的是 `pasted-<hash16>.webp`，与位图引用同一个形态；不产失败留痕、不出现
   「暂不支持引用该格式」。方向裁决见 Alex 2026-10-24「好，采纳 A」，安全条款（不读外部引用 /
   最长边夹 4096 / MUST NOT 原样存 SVG）落在 `src-tauri/src/svg_raster.rs` 的模块文档与 Rust
   单测里，本场景只判人侧可见面（卡片 + @ 钮 + 无失败留痕）。
   > M662 时代本段断言的是「svg 引用失败 + D585/D586 留痕」；M666 把 svg 移进可引用表后那段
   > 断言与产品行为相反，故改写。D585/D586 本身仍在（gif 这类真不支持的格式照旧走那条路），
   > 其视觉面判据见 `tests/visual/scenes/m633-image-quote.spec.ts`。

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
