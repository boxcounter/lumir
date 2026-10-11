---
# M454（change composer-image-mention）design §10 的真机判据 ①②③④：
#   ① 贴两张图 + 用 `@` 在光标处插引用 + 发送 → 编号一致（卡片可访问名 = 投递标签同源）；
#   ② 该轮 llm_request 留存：user 项文本面不含 `Image N` 标签行、图片 part 带 `lumir_label`、无 base64；
#   ③ 恢复会话后各图片卡片编号与发送时一致、正文不出现多余标签行；
#   ④ 移除一张图后余图徽标即时位序重编。
# ⑤（引用卡片 / 消息摘录卡片零编号回归）另立场景 149（要摘录卡片手势，配置与流程不同）。
# 编号面（卡片徽标 = lumir_label）的可断读数：**transcript** 图片卡是 role=img，可访问名
# `图片 {n}：{name}`（D447 含编号形态）——真机 AX 直接读到；composer 态的序号徽标是图上的裸读数、
# AX 无稳定形态，故 composer 侧只断言 `@` 钮在场（读屏名 D457）与 `@` 插入的引用文本。
# **wire 展开后**的 `input_text "Image N"`（图片前标签行）不在磁盘上（只活在 mock 的 in-memory
# received_inputs），由 Rust 单测 `expand_image_refs_from` 钉（mock 与真 client 同一条函数）；
# 留存的**引用形态**逐字节落 JSONL，本场景断言它（`lumir_label` 在场、文本面无标签行、无 base64）。
id: "148-harness-image-mention"
item: 148
title: composer 图片编号与 @ 引用：卡片编号 = 投递标签同源 + 留存文本面无标签 + 恢复后编号一致 + 移除位序重编
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-two.json"
seed:
  # 注册表 id 写死 acc-img：附件目录名 = vault 稳定 id，落点可写死断言（同场景 127）。
  registry:
    - { id: acc-img, path: $vault, lastOpenedAt: 1757000002000 }
steps:
  - name: ⌘⇧A 打开 harness pane（当前 vault = 预置注册项 acc-img）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入会话名素材（本逻辑会话首条用户消息定名——恢复步按它定位会话行）
    do: type
    text: "qrefmark"

  - name: 剪贴板置合成 png A（seed 7）
    do: clipboardImage
    synth: { width: 480, height: 320, seed: 7 }

  - name: 右键 composer 唤出 WebKit 原生菜单（图 A 的输入面）
    do: click
    target: { role: AXTextArea, name: "qrefmark", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 贴入图 A（光标处插图片卡片）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等图 A 卡片出现（落盘 + 插卡的状态驱动等待）
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
    expect:
      - label: composer 图片卡片带 `@` 插入引用钮（D457 读屏名，恒显）
        ax: { has: "/AXButton \\(插入图片引用\\)/" }

  - name: 剪贴板置合成 png B（seed 8——与 A 不同字节、不同内容寻址名）
    do: clipboardImage
    synth: { width: 300, height: 300, seed: 8 }

  - name: 右键 composer 唤出原生菜单（图 B 的输入面）
    do: click
    target: { role: AXTextArea, name: "pasted-[0-9a-f]{16}\\.webp", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 贴入图 B
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等图 B 卡片出现（两张图片卡片，各带一个 `@` 钮）
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
    expect:
      - label: 两张图片卡片各自带 `@` 钮（恰好两个）
        ax: { has: "/AXButton \\(插入图片引用\\)/", count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 2 } }

  - name: 点 composer 把光标落到末尾空段落、键入引用前缀（避免出现「整段恰是 Image N」的文本，
      让 ② 的「文本面无标签行」判据有区分度：标签行是**独立** text part）
    do: clickInNode
    target: { role: AXTextArea, name: "pasted-[0-9a-f]{16}\\.webp" }
  - name: 键入前缀
    do: type
    text: "note-"

  - name: ① 点图 A 的 `@` 钮（第 1 个）→ 光标处插入 `Image 1`
    do: click
    target: { role: AXButton, name: "插入图片引用", nth: 0 }
  - name: 等引用文本落进 composer
    do: waitFor
    waitFor:
      has: ["note-Image 1"]
    timeoutMs: 10000
    expect:
      - label: ① `@` 在光标处插入 `Image 1`（与图 A 的编号一致）
        ax: { has: "note-Image 1" }

  - name: ① 点图 B 的 `@` 钮（第 2 个）→ 光标处插入 `Image 2`
    do: click
    target: { role: AXButton, name: "插入图片引用", nth: 1 }
  - name: 等第二条引用文本落地
    do: waitFor
    waitFor:
      has: ["Image 2"]
    timeoutMs: 10000
    expect:
      - label: ① `@` 在光标处插入 `Image 2`（与图 B 的编号一致）
        ax: { has: "Image 2" }
      - label: 悬浮/恒显两钮都在（@ 与既有 ×；× 读屏名 D371 未变）
        ax: { has: "/AXButton \\(移除摘录\\)/" }
      - shot: 01-composer-两图带编号与@钮

  - name: 发送（composer = [段落 qrefmark, 图 A, 段 note-Image 1Image 2, 图 B, 空段]）
    do: key
    key: enter

  - name: 等回合收口（mock 弹一条响应）
    do: waitFor
    waitFor:
      has: ["验收回答：图片已收到。"]
    timeoutMs: 30000
    expect:
      - label: 回答渲染（含图消息真实发出、回合完成）
        ax: { has: "验收回答：图片已收到。" }
      - label: ① transcript 图 A 的可访问名含编号 1（编号 = 卡片徽标）
        ax: { has: "/图片 1：pasted-[0-9a-f]{16}\\.webp/" }
      - label: ① transcript 图 B 的可访问名含编号 2（与投递标签同源，一处真源）
        ax: { has: "/图片 2：pasted-[0-9a-f]{16}\\.webp/" }
      - label: ② 留存图片 part 带结构化标签字段 `lumir_label` = Image 1
        file: { path: "env:harness/sessions/acc-img/*.jsonl", has: '"lumir_label":"Image 1"' }
      - label: ② 留存图片 part 带结构化标签字段 `lumir_label` = Image 2
        file: { path: "env:harness/sessions/acc-img/*.jsonl", has: '"lumir_label":"Image 2"' }
      - label: ② 留存图片 part 仍是 lumir-attachment:// 引用（不是 data URL）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", has: '/"image_url":"lumir-attachment:\/\/pasted-[0-9a-f]{16}\.webp"/' }
      - label: ② 留存文本面 MUST NOT 出现标签行（独立的 `Image N` text part）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", not: '"text":"Image ' }
      - label: ② 留存无 base64（引用形态进留存、展开只在 wire）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", not: "data:image" }
      - shot: 02-发送后-transcript编号

  - name: 收起 harness pane（面板内 Escape——重启后 pane 开/关取决于会话存档，先显式钉「关」）
    do: key
    key: escape
  - name: 等 pane 收起（状态驱动）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(发送\\)/"]
    timeoutMs: 15000
  - name: 等会话存档落盘（布局写入有防抖，留一拍固定窗）
    do: sleep
    ms: 2500
    expect:
      - label: 存档的 harness_pane 位已是 false（重启后 pane 不会自动打开）
        file: { path: "env:vault-sessions/acc-img.json", has: '"harness_pane": false' }

  - name: 重启 app（内存会话丢弃——恢复只能从 JSONL + 附件还原）
    do: restart
  - name: 点标题栏「对话面板」开关重开 harness pane
    do: click
    target: { role: AXCheckBox, name: "对话面板" }
  - name: 等 pane 打开
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/"]
    timeoutMs: 30000

  - name: 打开会话浮层（重启后无在途会话：会话名钮读 D330「新会话」）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }
  - name: 等历史会话行出现
    do: waitFor
    waitFor:
      has: ["/删除该会话/"]
    timeoutMs: 15000
  - name: 点历史会话行——恢复续聊
    do: clickInNode
    target: { name: "qrefmark" }
  - name: 等恢复完成（会话名落回源会话首条用户消息 qrefmark）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(qrefmark/"]
    timeoutMs: 15000
    expect:
      - label: ③ 恢复后图 A 卡片编号仍为 1（与发送时一致，位序规则重建）
        ax: { has: "/图片 1：pasted-[0-9a-f]{16}\\.webp/" }
      - label: ③ 恢复后图 B 卡片编号仍为 2
        ax: { has: "/图片 2：pasted-[0-9a-f]{16}\\.webp/" }
      - label: ③ 恢复出的正文不出现多余标签行（正文里的 `Image N` 只来自用户 @ 插入的原话）
        ax: { not: "/AXStaticText = \"Image 1\"/" }
      - shot: 03-恢复后编号

  - name: ④ 回 composer 新起一条消息：贴两张图后移除第一张，余图位序重编为 1
      （`@` 钮重启后在 composer 态；composer 此刻为空）
    do: clickInNode
    target: { role: AXTextArea, name: "/问点什么|pasted-/" }
  - name: 剪贴板置合成 png C（seed 9）
    do: clipboardImage
    synth: { width: 260, height: 260, seed: 9 }
  - name: 右键 composer → Paste（图 C）
    do: click
    target: { role: AXTextArea, name: "问点什么", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }
  - name: 贴图 C
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }
  - name: 等图 C 卡片
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
  - name: 剪贴板置合成 png D（seed 10）
    do: clipboardImage
    synth: { width: 240, height: 240, seed: 10 }
  - name: 右键 composer → Paste（图 D）
    do: click
    target: { role: AXTextArea, name: "pasted-[0-9a-f]{16}\\.webp", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }
  - name: 贴图 D
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }
  - name: 等两张卡片
    do: waitFor
    waitFor:
      has: ["/AXButton \\(插入图片引用\\)/"]
    timeoutMs: 30000
    expect:
      - label: 两张图片卡片（两个 `@` 钮）
        ax: { count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 2 } }

  - name: ④ 移除第一张图（点第 1 个「移除摘录」钮——D371 是图片卡与引用卡共用的读屏名）
    do: click
    target: { role: AXButton, name: "移除摘录", nth: 0 }
  - name: 等只剩一个 `@` 钮（移除生效）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(插入图片引用\\)/"]
    timeoutMs: 10000
    expect:
      - label: ④ 移除后只剩一张图片卡片（一个 `@` 钮）
        ax: { count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 1 } }

  - name: ④ 点余图的 `@` 钮——它的编号应即时重编为 1（无空号）
    do: clickInNode
    target: { role: AXTextArea, name: "/问点什么|pasted-/" }
  - name: 点唯一的 `@` 钮
    do: click
    target: { role: AXButton, name: "插入图片引用" }
  - name: 等引用文本落地
    do: waitFor
    waitFor:
      has: ["Image 1"]
    timeoutMs: 10000
    expect:
      - label: ④ 余图重编为位序 1（`@` 插入的是 `Image 1`，无空号）
        ax: { has: "Image 1" }
      - shot: 04-移除后位序重编
---

# 148-harness-image-mention —— composer 图片编号与 `@` 引用（change composer-image-mention）

## 本场景在验什么

design §10 的真机验收面 ①②③④（⑤ 引用卡片 / 消息摘录卡片零编号回归在场景 149）：

1. **① 编号与 `@` 引用**：贴两张图 → composer 每张图片卡片带一个 `@`「插入引用」钮（D457，
   恒显）；点某张的 `@` → 在**当前光标处**插入该图编号的引用文本 `Image N`（N 与该卡当前编号一致）。
   发送后 transcript 图片卡的可访问名是 `图片 {n}：{name}`（D447 含编号形态）——真机可读的编号读数。
2. **② 投递同源 + 留存形态**：该轮 `llm_request` 留存里图片 part 带结构化字段 `lumir_label`
   （= `Image N`），**文本面不含标签行**（标签是结构化字段，不是正文），且**无 base64**
   （引用进留存、展开只在 wire）。留存的 `lumir_label` 与 transcript 的 `图片 {n}：` 同源
   （都来自 `imageOrdinals` 的同一份计算）。
3. **③ 恢复一致**：重启（内存会话真丢弃）→ 会话浮层恢复 → 各图片卡片编号与发送时一致
   （位序规则确定性重建，无编号字段持久化），恢复出的正文不出现多余标签行。
4. **④ 位序重编**：移除一张图后，同一消息内其余图片的编号即时重编为 1..n（无空号）——
   用余图 `@` 插入的是 `Image 1` 当观测读数。

## 判据为什么这样写

- **Paste 通道**：同 127（M415 探针的 WebKit 原生上下文菜单通道）——合成剪贴板造不出富 paste 事件，
  原生菜单 Paste 是与真实用户同一条 WebKit 链路。菜单项按键名正则定位不锁索引。
- **编号读数的两面（如实登记）**：transcript 图片卡 `role="img"` 的可访问名 `图片 {n}：{name}`
  是 AX 稳定形态，用来钉「卡片编号」；composer 态的序号徽标（缩略图角上的裸数字）是图上的视觉读数、
  AX 无稳定形态，**不进机器判据**（归视觉场景 `tests/visual/scenes/m454-...` 与 Alex 手感）。
- **② 的文本面无标签行判据**：断言留存里不存在**独立**的 `"text":"Image ` part。前缀素材
  `note-` 刻意让用户 `@` 插入的引用落在更长段落里（`note-Image 1Image 2`），与「系统标签行」
  （独立 text part）在 JSON 形态上可区分——否则一条恰为 `Image N` 的用户段落会让该负向断言误红。
- **wire 展开的边界**：发给 provider 的请求体里，图片 part 之前有一个 `{"type":"input_text",
  "text":"Image N"}` 标签行、且 `lumir_label` 被剥掉——这一形态**不在磁盘上**（只活在 mock 的
  in-memory `received_inputs`），由 Rust 单测 `expand_image_refs_from` 钉（mock 与真 client 同一条
  函数）。本场景只断言磁盘可读的留存侧（引用形态 + `lumir_label`）。
- **覆盖边界（如实登记）**：⑤（引用卡片 / 消息摘录卡片零编号回归）在场景 149；
  composer 态徽标的确切视觉形态归视觉场景与 Alex 过目。
