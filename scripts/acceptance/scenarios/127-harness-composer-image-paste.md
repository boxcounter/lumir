---
# M440（change harness-composer-image-paste）：composer 粘贴剪贴板图片的真机判据
# （design §9 的 ①②③④⑥）：
#   ① 粘贴 → harness 侧落盘 attachments/<vault 稳定 id>/（vault 零新增）+ composer 图片卡片；
#   ② 非图片粘贴逐字节回归（纯文本净化，附件目录零新增）；
#   ③ wire 形态：llm_request 的 user content 按块序 input_text/input_image 交错，
#      image_url 是 lumir-attachment:// 引用；
#   ④ JSONL 无 base64（引用进留存、展开进 wire——展开侧由 Rust 单测 expand_image_refs 钉）；
#   ⑥ 快照恢复 round-trip：重启后经会话浮层恢复，带图消息按原交错还原。
# ⑤（能力闸）与 ⑦（两 vault 分置）各自另立场景（128 / 129）——⑤ 要 launch 期配置
# （kimi + vision:false），⑦ 要第二个 vault。
id: "127-harness-composer-image-paste"
item: 127
title: composer 贴图：落 harness 侧 attachments/<vault id>/（vault 零新增）+ 图片卡片 + wire 交错引用 + JSONL 无 base64 + 重启恢复 round-trip
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-two.json"
seed:
  # 注册表 id 是场景的判据：附件目录名 = vault 稳定 id，预置 acc-img 让落点可写死断言。
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

  - name: 记 vault 根目录 mtime 基线（下面的「vault 零新增」用**贴图前后对比**取代绝对 0——
      根下可能有上一场景留下的非 `.md` 产物，绝对 0 会被它假红；见本场景末「判据为什么这样写」）
    do: record
    as: vault-root
    file: "."

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 剪贴板置纯文本（② 非图片回归的输入面）
    do: clipboardText
    text: "txtprobe-plain"

  - name: 右键 composer 唤出 WebKit 原生菜单（Paste 通道，M415 探针口径；
      composer 此刻为空，可访问名 = D328 占位「问点什么…」）
    do: click
    target: { role: AXTextArea, name: "问点什么", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 完成真实文本粘贴（非图片路径逐字节不变：净化成纯文本段落）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等文本落地并断言回归面
    do: waitFor
    waitFor:
      has: ["txtprobe-plain"]
    timeoutMs: 15000
    expect:
      - label: 文本落在 composer（纯文本净化照常工作）
        ax: { has: "txtprobe-plain" }
      - label: 文本粘贴不产生任何 harness 附件（attachments 根下零 webp）
        glob: { dir: "env:harness/attachments", pattern: "\\.webp$", exact: 0 }
      - label: vault 根目录零改动（贴图前后对比：根 mtime 未推进 ⇒ attachments 没落进 vault 的任何角落）
        file: { path: ".", mtimeUnchangedSince: vault-root }

  - name: 剪贴板置合成 png（seed 7 ⇒ 逐字节确定，AppleScript «class PNGf» 标准通道）
    do: clipboardImage
    synth: { width: 480, height: 320, seed: 7 }

  - name: 右键 composer 唤出原生菜单（图优先的输入面；composer 值 = 已贴入的文本）
    do: click
    target: { role: AXTextArea, name: "txtprobe-plain", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 完成真实图片粘贴（① 图优先：拦截落 harness 侧并插图片卡片）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等卡片出现（落盘 + 插卡 + 缩略图 load 后元信息行带宽高的状态驱动等待）
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp · 480×320/"]
    timeoutMs: 30000
    expect:
      - label: composer 出现图片卡片（元信息行从文件名开始、无 image · 前缀）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: ⑥ 元信息行补出宽高「文件名 · W×H」（M449 口径；合成图 = 480×320。判据搬到了
          **composer 卡面**——恢复路径的 transcript 卡是 `role=img` AX 叶子，维度文本不进 AX，
          见本场景末「判据为什么这样写」）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp · 480×320/" }
      - label: 纯文本段落未被图片粘贴冲掉（② 两不串台）
        ax: { has: "txtprobe-plain" }
      - label: 附件落 harness 侧 vault 目录（目录名 = 预置注册表 id acc-img，恰好一份）
        glob: { dir: "env:harness/attachments/acc-img", pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: 落盘字节是 WebP 容器，且文件名哈希 = 落盘字节 sha256 前 16 位（内容寻址）
        bytes: { path: "env:harness/attachments/acc-img/pasted-*.webp", magic: "52494646", nameHash: true }
      - label: vault 根目录依旧零改动（贴图前后对比：mtime 未推进——图片落 harness 侧，vault 零新增）
        file: { path: ".", mtimeUnchangedSince: vault-root }
      - shot: 01-贴图后-composer卡片

  - name: 焦点回 composer（值 = 卡片元信息行，可访问名随之变成它），键入图片后的问题段
    do: clickInNode
    target: { role: AXTextArea, name: "pasted-[0-9a-f]{16}\\.webp" }

  - name: 键入后段问题
    do: typeInNode
    target: { role: AXTextArea, name: "pasted-[0-9a-f]{16}|imgmark-b" }
    text: "imgmark-b"
    expect:
      - label: 后段文本落地
        ax: { has: "imgmark-b" }

  - name: 发送（composer = [txtprobe-plain 段落, 图片卡片, imgmark-b 段落]）
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
      - label: ③ wire 交错：llm_request 的 user content 按块序 input_text / input_image / input_text
        file: { path: "env:harness/sessions/acc-img/*.jsonl", has: '/^.*"kind":"llm_request".*"text":"txtprobe-plain.*"image_url":"lumir-attachment:\/\/pasted-[0-9a-f]{16}\.webp".*"text":"imgmark-b.*$/' }
      - label: ③ 会话侧记引用形态：image_url 是 lumir-attachment:// 内容寻址名（不是 data URL）
        file: { path: "env:harness/sessions/acc-img/*.jsonl", has: '/"image_url":"lumir-attachment:\/\/pasted-[0-9a-f]{16}\.webp"/' }
      - label: ④ JSONL 无 base64：留存里不得出现 data:image 串
        file: { path: "env:harness/sessions/acc-img/*.jsonl", not: "data:image" }
      - shot: 02-发送后-transcript

  - name: 收起 harness pane（面板内 Escape——重启后 pane 开/关取决于退出时会话存档的
      harness_pane 位，先显式收起把重启后的起点钉成「关」，后续打开才确定性）
    do: key
    key: escape

  - name: 等 pane 收起（状态驱动）
    do: waitFor
    waitFor:
      not: ["/AXButton \\(发送\\)/"]
    timeoutMs: 15000

  - name: 等会话存档把 harness_pane=false 落盘（布局写入有 1s 防抖；重启若杀在防抖窗里，
      存档还是 true、重启后 pane 又自动打开——留一拍固定窗 + 文件断言把重启前的起点钉死）
    do: sleep
    ms: 2500
    expect:
      - label: 存档的 harness_pane 位已是 false（重启后 pane 不会自动打开）
        file: { path: "env:vault-sessions/acc-img.json", has: '"harness_pane": false' }

  - name: 重启 app（内存会话丢弃——恢复路径只能从 JSONL + 附件还原）
    do: restart

  - name: 点标题栏「对话面板」开关重开 harness pane（pane 关时开关钮在标题栏；
      AXPress 索引路径比启动窗里的盲发 chord 稳）
    do: click
    target: { role: AXCheckBox, name: "对话面板" }

  - name: 等 pane 打开（状态驱动）
    do: waitFor
    waitFor:
      has: ["/AXButton \\(发送\\)/", "与当前文档对话"]
    timeoutMs: 30000
    expect:
      - label: 面板在位（发送钮在场）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: transcript 是空态（重启后会话真源已空，不伪造）
        ax: { has: "与当前文档对话" }

  - name: 打开会话浮层（重启后无在途会话：会话名钮读 D330「新会话」；
      带 aria-haspopup → AXPopUpButton，场景 92/106 同口径）
    do: click
    target: { role: AXPopUpButton, name: "新会话" }

  - name: 等历史会话行出现（清单现拉现建——harness_list_sessions 往返）
    do: waitFor
    waitFor:
      has: ["/删除该会话/"]
    timeoutMs: 15000

  - name: 点历史会话行——恢复续聊（M406 口径：clickInNode 坐标通道）
    do: clickInNode
    target: { name: "txtprobe-plain" }

  - name: 等恢复完成（会话名落回源会话首条用户消息）
    do: waitFor
    waitFor:
      has: ["/AXPopUpButton \\(txtprobe-plain/"]
    timeoutMs: 15000
    expect:
      - label: ⑥ 恢复后 transcript 重建出源消息的后段文本（只可能来自恢复出来的历史）
        ax: { has: "imgmark-b" }
      - label: ⑥ 图片卡片按原交错还原（卡片元信息行在 transcript 里；引用名与发送前一致）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: ⑥ 交错顺序保持：前段文本与后段文本同屏（imgmark-b 未串到图前）
        ax: { has: "txtprobe-plain" }
      - shot: 03-恢复后-带图消息

  - name: 恢复路径的宽高补记（M449）在真机 AX 面**不可观测**——如实登记，不做断言
    do: note
    text: "恢复后 transcript 图片卡是 role=img（AX 叶子），元信息行的 W×H 文本不进 AX（实测：AXImage 只暴露可访问名「图片 N：name」）。该补记的机器判据 = ① composer 卡面的 W×H（本场景贴图步已断言）② 单测 tests/unit/harness-composer.test.ts 的恢复路径补记用例。"
---

# 127-harness-composer-image-paste —— composer 贴图全链路（change harness-composer-image-paste）

## 本场景在验什么

design §9 验收面的 ①②③④⑥ 四条（⑤ 能力闸在场景 128，⑦ 两 vault 分置在场景 129——
各自的配置前提不同，拆场景是刻意的）：

1. **① 粘贴落 harness 侧 + 卡片**：合成 png 经 WebKit 原生菜单 Paste 进 composer →
   图片卡片出现在 composer（元信息行**从文件名开始**、无 `image ·` 前缀——Alex 2026-10-10
   裁决），字节落 `<隔离配置>/harness/attachments/acc-img/`（acc-img 是本场景预置的注册表
   id——附件目录名 = vault 稳定 id，M433 分层裁决），内容寻址命名（`bytes.nameHash` 钉
   「文件名哈希 = 落盘字节 sha256 前 16 位」），且 **vault 根目录零改动**（贴图前后对比：
   根 mtime 未推进）。
2. **② 非图片回归**：同一条 Paste 通道先贴纯文本——净化照常、附件目录零新增；随后贴图，
   两段互不串台（文本段未被冲掉）。
3. **③④ 投递与留存**：发送「文本 + 图 + 文本」后，JSONL 的 `llm_request` 里 user content
   **按块序交错**（一条行内正则钉三段顺序），图片是 `lumir-attachment://` **引用**；
   全文**无 `data:image`**（引用进留存、展开进 wire——wire 展开侧由 Rust 单测
   `expand_image_refs_*` 与 mock 的 `received_inputs` 钉，mock 与真 client 同一条函数）。
4. **⑥ 恢复 round-trip**：重启（内存会话真丢弃）→ 会话浮层恢复 → transcript 重建出
   带图消息：后段文本、图片卡片（引用名与发送前一致）都在场。

## 判据为什么这样写

- **Paste 通道**：同 112/116（M415 探针的 WebKit 原生上下文菜单通道）——合成剪贴板造不出
  富 paste 事件，原生菜单 Paste 是与真实用户同一条 WebKit 链路。菜单项按键名正则定位不锁索引。
- **注册表 id 写死 `acc-img`**：`reconcile_vault` 按规范化路径命中预置注册项即复用它的 id，
  附件目录名因此是场景可预期的确定值（产品自生成的 `vault-<pid>-<n>` 无从预知）。
- **③ 的交错用一条行内正则**：JSONL 一行一事件，`^…$` 行锚 + 三段按序出现，避免被文件里
  别的事件满足（套件 README「`^`/`$` 也是跨行保护」节的口径）。
- **vault 零新增用「贴图前后对比」而不是「根下 glob 绝对 0」（M489 修正）**：`resetVault`（M489
  起收口 M296 缺口）已把根下非 `.md` 产物一并清掉，但绝对 0 仍脆弱——只要隔离链有一处漏，
  上一场景的残留就会让它**假红**（实证：148 的注入泄漏往共享 vault 根丢了一个
  `pasted-<hash>.webp`，污染了本场景的「vault 零新增」断言）。改为开头 `record` 根目录 mtime、
  贴图前后比对（`mtimeUnchangedSince`）：根下**任何**新增/删除都会推进根 mtime，故这条比只看
  `pasted-*.webp` 更强，且对「基线之前就存在的残留」免疫。
- **⑥ 恢复后宽高补记的判据搬到 composer 卡面（M489 修正的 oracle 换面）**：M449 的补记发生在
  恢复路径的卡片上（元信息行首帧只显文件名，缩略图 `<img>` load 后由 `naturalWidth/Height`
  补出 `· W×H`）。但恢复后的卡片在 **transcript**、被渲染成 `role=img` 的 **AX 叶子**——其
  可访问名只有「图片 N：name」，元信息行的 W×H 文本**不进 AX**（实测 dump 只有 `AXImage (图片 1：…)`）。
  该补记因此在真机 AX 面**原理性不可观测**，本场景改在 **composer 卡面**断言「元信息行带宽高」
  （合成图 480×320，贴图步 `waitFor` + `ax.has`），恢复路径的补记语义留在单测
  `tests/unit/harness-composer.test.ts`。恢复面本身仍由「后段文本 + 引用名 + 交错顺序」三条覆盖。
- **覆盖边界（如实登记）**：⑤（能力闸的 toast / 卡片错误态 / 会话不推进）在场景 128；
  ⑦（两 vault 分置与互不可见）在场景 129；wire 展开后的 data URL 形态由 Rust 单测钉
  （mock 与真 client 同一条 `expand_image_refs`），真机 JSONL 只承载引用侧。
