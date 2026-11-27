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
tier: full
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
  # 编辑器基线先记：此时只有编辑器一棵 AX 树（pane 未开、无动画），长值读数不会被残读污染。
  # M864 真机 run7：pane 打开过程中记录的基线连读 6 次都带 U+FFFD（残读在动画窗口里持续），
  # 两次守卫因此拿残读基线判红；挪到 pane 之前，判据不变。
  - name: 记编辑器文档基线（素材注入 MUST NOT 漏进文档——注入落错面的通用防线，场景 140 同口径）
    do: recordEditor
    as: doc-before-composer

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
      （M498 起 typeInNode 注入 composer；旧 `keys` 逐键注入丢键（'e' 确定性丢失）、
      `type` 动作会落到第一个 `AXTextArea` = 编辑器，素材漏面）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|qrefmark" }
    text: "qrefmark"
    expect:
      - label: 素材落在 composer（会话名来源）
        ax: { has: "qrefmark" }
      - label: 素材没有漏进编辑器文档（焦点确在 composer，编辑器逐字节未变）
        editor: { unchangedSince: doc-before-composer }

  - name: 剪贴板置合成 png A（seed 7）
    do: clipboardImage
    synth: { width: 480, height: 320, seed: 7 }

  # 粘贴通道（M864）：⌘V 走 cgevent 真键盘事件（M859 真机实测）；原生上下文菜单 Paste 的
  # AXPress 会静默 no-op（菜单不收起、paste 不触发），不再使用——见 112 的同段注释。
  # composer 焦点由上面的 clickInNode 建立；贴图判据落在卡片/`@` 钮与后续留存上。
  - name: ⌘V 贴入图 A（cgevent 真键盘事件；光标处插图片卡片）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

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

  # 第二张图：同一 cgevent ⌘V 通道。旧菜单通道要挑「末尾空段落带」的右键落点（dy 0.94，
  # 中心点会落在图 A 卡片上开出图片菜单）——cgevent 不需要右键，落点由模型 caret 决定：
  # 产品在第一张卡后补了承接空段落，第二次粘贴因此接在图 A 之后（下方「两张卡片」判据钉住）。
  - name: ⌘V 贴入图 B（cgevent 真键盘事件）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500

  - name: 等图 B 卡片出现（两张图片卡片，各带一个 `@` 钮）
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
    expect:
      - label: 两张图片卡片各自带 `@` 钮（恰好两个）
        ax: { has: "/AXButton \\(插入图片引用\\)/", count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 2 } }

  # M864 真机首跑（2026-11-20）：这里原先用「点末尾空行」重建 DOM 焦点 + 把光标钉到承接空段落
  # （M456 的菜单粘贴后 window 失焦）。贴图迁到 cgevent 后粘贴不夺焦点、产品在第二张卡后已把
  # caret 放在承接空段落（真机 dump：composer 仍是 focused 节点）——本步删除。首跑还发现
  # composer 的 AX 可访问名此时是**文本**（qrefmark）而非卡片名，旧 `pasted-…` 选择器解析不到
  # 节点；删除本步一并绕开该脆选择器，`tag-` 的落点判据（下一条）不变。
  # M864 通道变更后的状态（注释改准，动作与断言不动）：
  #   上面的贴图步已从「原生菜单 Paste」迁到 cgevent ⌘V，本步因此**不再是 post-menu 态**——
  #   M456 那条「菜单 Paste 之后 CGEvent 逐键注入死亡」的前提消失。本步仍留 `do: keys`
  #   （可打印逐键，素材串刻意无 'e'——press_key 确定性丢 'e'，M497/M498）；它是否随通道变更
  #   转绿（模型 caret 是否跟到末尾空段落、@ 引用是否插成 `tag-Image N`）以真机复跑读数为准，
  #   断言保持原样、不放宽。
  #   历史（M454–M498，三通道全试过的记录）：菜单 Paste 后 do:keys 注入死亡；typeInNode 的
  #   AX 注入不进 composer 模型（@ 按模型 caret 插入 ⇒「Image 1note-」）；剪贴板+菜单 Paste
  #   文本在两张卡片时右键落点命中卡片链接区。这些边界只属于菜单通道，M864 起在役场景不再经过。
  - name: 键入引用前缀 tag-（`keys` 动作走 composer 的键盘注入；`type` 动作会落到第一个
      `AXTextArea` = 编辑器；素材串刻意无 'e'，见上注）
    do: keys
    keys: ["t", "a", "g", "-"]
    gapMs: 100
    expect:
      - label: 前缀落在 composer（与 `@` 插入的引用拼成 tag-Image N）
        ax: { has: "tag-" }
      - label: 前缀没有漏进编辑器文档（焦点确在 composer，编辑器逐字节未变）
        editor: { unchangedSince: doc-before-composer }

  - name: 把图 A 滚入 composer 可视区（AX 会给被裁卡完整 bbox；窗口级定位不知道嵌套滚动容器）
    do: scroll
    target: { role: AXTextArea, name: ".*", nth: 1 }
    dy: 6
    wheel: true

  - name: ① @ / × 的真实几何均为 28×28（change improve-harness-action-targets-nov27）
    do: settle
    expect:
      - geom: { target: { role: AXButton, name: "插入图片引用", nth: 0 }, minWidth: 28, minHeight: 28 }
      - geom: { target: { role: AXButton, name: "移除摘录", nth: 0 }, minWidth: 28, minHeight: 28 }
      - shot: 01a-图A边缘点击前

  - name: ① 真实指针点图 A @ 的左缘透明区（CGEvent mode=1，非 AXPress）→ 光标处插入 `Image 1`
    do: doubleClick
    target: { role: AXButton, name: "插入图片引用", nth: 0 }
    mode: 1
    dx: 0.04
    dy: 0.5
  - name: 等引用文本落进 composer
    do: waitFor
    waitFor:
      has: ["tag-Image 1"]
    timeoutMs: 10000
    expect:
      - label: ① `@` 在光标处插入 `Image 1`（与图 A 的编号一致）
        ax: { has: "tag-Image 1" }

  - name: 把图 B 滚入 composer 可视区（与图 A 同一嵌套容器前置）
    do: scroll
    target: { role: AXTextArea, name: ".*", nth: 1 }
    dy: -6
    wheel: true

  - name: ① 真实指针点图 B @ 的中心（CGEvent mode=1）→ 光标处插入 `Image 2`
    do: doubleClick
    target: { role: AXButton, name: "插入图片引用", nth: 1 }
    mode: 1
    dx: 0.5
    dy: 0.5
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

  - name: 发送（composer = [段落 qrefmark, 图 A, 段 tag-Image 1Image 2, 图 B, 空段]）
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
      # M523 收紧：旧口径 `not: '"text":"Image '` 是**子串**判据，用户自己段落恰以 `Image ` 开头
      # （M864 前的实际值 = `Image 2Image 1tag-`，见 ① 的通道边界）就被它判红——负断言过宽
      # 造成的假红，且顺带把「标签行」与「用户段落」区分不开（REVIEW.md 「断言等价于子串」条同族）。新口径只否
      # **恰为 `Image N` 的 text part**（`"text":"Image \d+"` 的闭合引号要求值到数字为止）。
      - label: ② 留存文本面 MUST NOT 出现标签行（恰为 `Image N` 的 text part）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", not: "/\"text\":\"Image \\d+\"/" }
      - label: ② 留存无 base64（引用形态进留存、展开只在 wire）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", not: "data:image" }
      - shot: 02-发送后-transcript编号

  # 收起通道（M523 换键）：本步原用「面板内 Escape」。M523 真机探针把它的边界钉死了——Escape 的
  # 收起处理器挂在 **panel 元素**上（`src/harness-panel.ts:6835-6853`，靠 keydown 从面板内的焦点
  # 冒泡上来），焦点一旦移出面板这条通道**整体失效**：探针跑「clickEditor 移焦后再 Escape」
  # （证据 `.local/acceptance/2026-10-15-m523-probe/148-harness-image-mention/steps.md:55-58`）
  # 里 pane 照旧开着（「等 pane 收起」15s 超时、存档位停在 `true`）。⇒「先移焦再 Escape」不是可用
  # 通道，改用 `⌘⇧A`（`harness.toggle`，`src/keys.ts:700`，全局绑定、与焦点无关；「pane 开着 + 焦点
  # 在 composer」这一同款现场由场景 86 的「⌘⇧A 再按——收起 harness pane」步守着）。
  # **覆盖损失如实登记**：「面板内 Escape 收 pane」这一条从本场景撤出（仍由场景 127 守）；边界口径
  # 写进 `scripts/acceptance/README.md` 的已知边界（与 127 的前置条件一起）。
  - name: 收起 harness pane（⌘⇧A——重启后 pane 开/关取决于会话存档，先显式钉「关」；
      M498 原记「面板内 Escape 不稳定」，M523 定性为「Escape 依赖面板内焦点」并换通道，见上注）
    do: key
    key: "cmd+shift+a"
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
  - name: 点标题栏「Harness 面板」开关重开 harness pane
    do: click
    target: { role: AXCheckBox, name: "Harness 面板" }
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
    target: { role: AXTextArea, name: "问点什么|qrefmark|pasted-" }
  - name: 剪贴板置合成 png C（seed 9）
    do: clipboardImage
    synth: { width: 260, height: 260, seed: 9 }
  - name: ⌘V 贴入图 C（cgevent 真键盘事件；同一粘贴通道）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500
  - name: 等图 C 卡片
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
  - name: 剪贴板置合成 png D（seed 10）
    do: clipboardImage
    synth: { width: 240, height: 240, seed: 10 }
  - name: ⌘V 贴入图 D（cgevent 真键盘事件；第二张接在图 C 之后，同上面图 B 的承接空段落口径）
    do: key
    key: "cmd+v"
    channel: cgevent
    gapMs: 500
  - name: 等两张卡片
    do: waitFor
    waitFor:
      has: ["/AXButton \\(插入图片引用\\)/"]
    timeoutMs: 30000
    expect:
      - label: 两张图片卡片（两个 `@` 钮）
        ax: { count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 2 } }

  - name: ④ 把第一张图滚入 composer 可视区（再验嵌套容器裁切前提）
    do: scroll
    target: { role: AXTextArea, name: ".*", nth: 1 }
    dy: 6
    wheel: true
  - name: ④ 真实指针点第一张图 × 的左缘透明区（CGEvent mode=1；D371 是图片卡与引用卡共用读屏名）
    do: doubleClick
    target: { role: AXButton, name: "移除摘录", nth: 0 }
    mode: 1
    dx: 0.04
    dy: 0.5
  - name: 等只剩一个 `@` 钮（移除生效）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(插入图片引用\\)/"]
    timeoutMs: 10000
    expect:
      - label: ④ 移除后只剩一张图片卡片（一个 `@` 钮）
        ax: { count: { pattern: "/AXButton \\(插入图片引用\\)/", exact: 1 } }

  - name: ④ 点余图的 `@` 钮——它的编号应即时重编为 1（无空号）
      （dy 0.94 落文本区，中心点会落在卡片上）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么|qrefmark|pasted-" }
    dy: 0.94
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

- **Paste 通道**：`do: key { key: "cmd+v", channel: cgevent }`（M864）——真键盘事件投递真实
  WebKit paste 事件，M859 真机实测；旧的原生上下文菜单 Paste 通道已弃用（AXPress 到 AXMenuItem
  会静默 no-op、菜单不收起，且间歇复现；finding
  `20261120-worker-html-only-paste-improve-cgevent-v-paste-axpress.md`）。贴图判据落在卡片
  `@` 钮、transcript 编号与留存形态上。
- **composer 注入用 `do: typeInNode`（M498 迁移；M489 时代是 `do: keys`）**：`do: type` 走
  `typeInEditor`（`lib/drive.mjs`），取 AX 树里**第一个** `AXTextArea`——那是**编辑器**，不是 composer
  （本场景 dump 里编辑器节点在 composer 之前）。素材因此曾漏进文档（M489 前）：`qrefmark` 落进编辑器后，
  下一步右键 `name:"qrefmark"` 被编辑器抢先命中，贴图进了编辑器 ⇒ composer 从没有图片卡片、`@` 钮自然
  不在 AX。M489 起改用「`clickInNode(composer)` + composer 向键盘注入」，M498 起首步（会话名
  素材）注入动作是 `typeInNode`（type_text 无 index 整串追加——`do: keys` 的 press_key
  逐键通道对 composer 丢键：'e' 本机确定性丢失，M497 归因）；贴图后的 tag- 步留在 `do: keys`、
  素材串刻意无 'e'（M864 起不再处于 post-menu 态，见该步注释；是否转绿以真机复跑为准）。
  全程配 `recordEditor` + `editor.unchangedSince` 守卫，把「素材落在 composer、编辑器逐字节未变」
  钉成断言。
- **编号读数的两面（如实登记）**：transcript 图片卡 `role="img"` 的可访问名 `图片 {n}：{name}`
  是 AX 稳定形态，用来钉「卡片编号」；composer 态的序号徽标（缩略图角上的裸数字）是图上的视觉读数、
  AX 无稳定形态，**不进机器判据**（归视觉场景 `tests/visual/scenes/m454-...` 与 Alex 手感）。
- **② 的文本面无标签行判据（M523 收紧）**：断言留存里不存在**恰为 `Image N` 的 text part**
  （`not: /"text":"Image \d+"/`）。旧口径是子串 `not: '"text":"Image '`——它把用户自己那条以
  `Image ` 开头的段落（本轮真实值 = `Image 2Image 1tag-`）一起否掉，于是恒红（假红，非产品偏差），
  同时「标签行 vs 用户段落」也分不开（REVIEW.md 「断言等价于子串」条同族：断言看着有覆盖、实际不判形态）。
  新口径的闭合引号要求值到数字为止：独立标签行 `{"type":"input_text","text":"Image 1"}` 命中、
  `"text":"Image 2Image 1tag-"` 不命中。前缀素材 `tag-`（M498 起；原 `note-` 含 'e'，press_key
  确定性丢键必红——素材改无 'e' 判法，同场景 137 的 "draftclear"）保留：它仍是 ①「引用插在
  光标处」的读数（`tag-Image 1`），收紧后的 ② 不再依赖它给负断言做区分。
- **收起 pane 用 `⌘⇧A`、不用「面板内 Escape」（M523 换键；覆盖损失如实登记）**：Escape 的收起
  处理器挂在 **panel 元素**上（`src/harness-panel.ts:6835-6853`），靠 keydown 从**面板内的焦点**
  冒泡上来——焦点移到面板外（点编辑器）这条通道整体失效。M523 真机探针实测「clickEditor 移焦后
  再 Escape」→ pane 照旧开着（`.local/acceptance/2026-10-15-m523-probe/148-harness-image-mention/`
  的 `等 pane 收起` 15s 超时 + 存档位停在 `true`）。`⌘⇧A`（`harness.toggle`，`src/keys.ts:700`）是
  全局绑定、与焦点无关，且「pane 开着 + 焦点在 composer」这一同款现场由场景 86 守着。
  **代价**：「面板内 Escape 收 pane」这一条覆盖从本场景撤出（仍由场景 127 覆盖，其前置是焦点留在
  composer）；M498 记的「Escape 被 composer 消费」在这一读法下不成立——composer 的 keydown 没有
  Escape 分支（`src/harness-panel.ts:6364-6460`），keydown 从 composer 冒泡到 panel 照常命中收起。
- **wire 展开的边界**：发给 provider 的请求体里，图片 part 之前有一个 `{"type":"input_text",
  "text":"Image N"}` 标签行、且 `lumir_label` 被剥掉——这一形态**不在磁盘上**（只活在 mock 的
  in-memory `received_inputs`），由 Rust 单测 `expand_image_refs_from` 钉（mock 与真 client 同一条
  函数）。本场景只断言磁盘可读的留存侧（引用形态 + `lumir_label`）。
- **覆盖边界（如实登记）**：① 的「引用插在**光标处**」这一面在 M864 前的读数是红的（post-menu
  素材注入只到 DOM、不进 composer 模型，`@` 按钮按模型 caret 插入 → 段落头 `Image 1tag-`；
  M456/M498 边界）。M864 把贴图步迁到 cgevent ⌘V 后本步不再处于 post-menu 态，这一面**待真机
  复跑重读**，断言未放宽；⑤（引用卡片 / 消息摘录卡片零编号回归）在场景 149；
  composer 态徽标的确切视觉形态归视觉场景与 Alex 过目。
