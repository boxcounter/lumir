---
# M440（change harness-composer-image-paste）design §9 ⑦：按 vault 分置——在 vault A 与
# vault B 各贴一张图并发送，字节分别落 attachments/<A 的稳定 id>/ 与 attachments/<B 的稳定 id>/，
# 两处各自可读回（缩略图/卡片可见），跨 vault 不串台。id 是场景预置的注册表 id（acc-va / acc-vb），
# 附件目录名因此可写死断言。
id: "129-harness-image-per-vault"
item: 129
tier: full
title: 贴图附件按 vault 分置：两 vault 各贴各落（attachments/<各自稳定 id>/），互不可见、留存互不污染
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-two.json"
seed:
  registry:
    - { id: acc-va, path: $vault, lastOpenedAt: 1757000002000 }
    - { id: acc-vb, path: $vault2, lastOpenedAt: 1757000001000 }
steps:
  - name: ⌘⇧A 打开 harness pane（当前 vault = A / acc-va）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 剪贴板置合成 png（seed 11，A 侧的图）
    do: clipboardImage
    synth: { width: 320, height: 200, seed: 11 }

  - name: 右键 composer 唤出原生菜单并点 Paste 贴图
    do: click
    target: { role: AXTextArea, name: "问点什么", button: right }
    expect:
      - label: 原生菜单 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等 A 侧卡片出现
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000

  - name: 焦点回 composer（值 = 卡片元信息行，可访问名随之变成它），键入 A 侧提问
    do: clickInNode
    target: { role: AXTextArea, name: "pasted-[0-9a-f]{16}\\.webp" }

  - name: 键入 A 侧标记
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|vaulta-img|pasted-[0-9a-f]{16}\\.webp" }
    text: "vaulta-img"

  - name: 发送 A 的含图消息
    do: key
    key: enter

  - name: 等 A 回合收口
    do: waitFor
    waitFor:
      has: ["验收回答：图片已收到。"]
    timeoutMs: 30000
    expect:
      - label: A 的回答渲染（回合真实完成）
        ax: { has: "验收回答：图片已收到。" }
      - label: ⑦ A 的附件落在 attachments/acc-va/（恰好一份，WebP 内容寻址）
        glob: { dir: "env:harness/attachments/acc-va", pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: ⑦ A 的落盘字节哈希自洽
        bytes: { path: "env:harness/attachments/acc-va/pasted-*.webp", magic: "52494646", nameHash: true }
      - label: ⑦ B 的附件目录此刻零文件（另一 vault 不被写入）
        glob: { dir: "env:harness/attachments/acc-vb", pattern: "\\.webp$", exact: 0 }
      - label: A 的会话留存带 A 的标记
        file: { path: "env:harness/sessions/acc-va/*.jsonl", has: "vaulta-img" }
      - shot: 01-A-贴图完成

  - name: 记下 A 的附件文件基线（切到 B 后断言它原样不动）
    do: record
    as: a-attachment
    file: "env:harness/attachments/acc-va/pasted-*.webp"

  - name: ⌘O 打开 vault 列表
    do: key
    key: "cmd+o"
    expect:
      - label: 浮层打开且 B 的行在位
        ax: { has: "/lumir-m102-acceptance-b/" }

  - name: 点 B 行（切到第二个 vault）
    do: click
    target: { role: AXStaticText, any: "/lumir-m102-acceptance-b/" }

  - name: 等切到 B 的装载跑完（状态驱动）
    do: waitFor
    waitFor:
      has: ["vault：lumir-m102-acceptance-b（点击查看全部 vault）"]
      not: ["AXProgressIndicator"]
    timeoutMs: 60000

  - name: 在 B 里打开一个文档（有打开文档才有上下文 chip；同 124 口径）
    do: open
    file: beta.md
    marker: "第二个 vault 的笔记"
    expect:
      - label: B 的文档打开渲染（正观测）
        ax: { has: "第二个 vault 的笔记" }

  - name: ⌘⇧A 在 B 里打开面板
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: 面板在位（正观测）
        ax: { has: "/AXButton \\(发送\\)/" }
      - label: B 的 transcript 是空态（A 的内容没串过来）
        ax: { has: "与当前文档对话" }
      - label: A 的提问不在 B 的任何界面里
        ax: { not: "vaulta-img" }

  - name: 真实鼠标点 B 的 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 剪贴板置合成 png（seed 12，B 侧的图——与 A 逐字节不同 ⇒ 内容寻址名必不同）
    do: clipboardImage
    synth: { width: 320, height: 200, seed: 12 }

  - name: 右键 composer 唤出原生菜单并点 Paste 贴图
    do: click
    target: { role: AXTextArea, name: "问点什么", button: right }
    expect:
      - label: 原生菜单 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等 B 侧卡片出现（B 的缩略图可读回 = 本 vault 目录内的读回通道通）
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000

  - name: 焦点回 composer（同 A 侧口径），键入 B 侧提问
    do: clickInNode
    target: { role: AXTextArea, name: "pasted-[0-9a-f]{16}\\.webp" }

  - name: 键入 B 侧标记
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|vaultb-img|pasted-[0-9a-f]{16}\\.webp" }
    text: "vaultb-img"

  - name: 发送 B 的含图消息
    do: key
    key: enter

  - name: 等 B 回合收口
    do: waitFor
    waitFor:
      has: ["验收回答：图片已收到。"]
    timeoutMs: 30000
    expect:
      - label: B 的回答渲染（回合真实完成）
        ax: { has: "验收回答：图片已收到。" }
      - label: ⑦ B 的附件落在 attachments/acc-vb/（恰好一份）
        glob: { dir: "env:harness/attachments/acc-vb", pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - label: ⑦ B 的落盘字节哈希自洽
        bytes: { path: "env:harness/attachments/acc-vb/pasted-*.webp", magic: "52494646", nameHash: true }
      - label: ⑦ A 的附件原样不动（分置不是搬运：A 目录仍恰一份、字节未变）
        glob: { dir: "env:harness/attachments/acc-va", pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
        # 字节级同一性由上一条 record 的 changedSince 承担（下方单独一条）。
      - label: A 的附件字节与 B 发送前逐字节一致
        file: { path: "env:harness/attachments/acc-va/pasted-*.webp", unchangedSince: a-attachment }
      - label: B 的会话留存带 B 的标记
        file: { path: "env:harness/sessions/acc-vb/*.jsonl", has: "vaultb-img" }
      - label: A 的留存里没有 B 的提问（两 vault 的留存互不污染）
        file: { path: "env:harness/sessions/acc-va/*.jsonl", not: "vaultb-img" }
      - label: B 的留存里没有 A 的提问（反方向）
        file: { path: "env:harness/sessions/acc-vb/*.jsonl", not: "vaulta-img" }
      - label: A 的提问不在 B 的界面里（跨 vault 不串台）
        ax: { not: "vaulta-img" }
      - label: 两个 vault 目录各有恰好一份附件
        glob: { dir: "env:harness/attachments", pattern: "\\.webp$", exact: 2 }
      - shot: 02-B-贴图完成
---

# 129-harness-image-per-vault —— 贴图附件按 vault 分置（change harness-composer-image-paste §9⑦）

## 本场景在验什么

harness 附件按 **vault 稳定 id 分层**（M433 分层裁决的实现面）：A（acc-va）与 B（acc-vb）各贴
一张不同的合成图并各发一条消息——字节分别落在 `attachments/acc-va/` 与 `attachments/acc-vb/`，
各恰一份、内容寻址哈希自洽；A 的附件在 B 的整轮里**原样不动**（`record` + `unchangedSince`
钉字节级同一性）；两 vault 的会话留存互不含对方的标记；B 的界面里看不到 A 的提问。

## 判据为什么这样写

- **注册表 id 写死 `acc-va` / `acc-vb`**（同 124 的口径）：目录名 = 注册表 id，场景可预期。
- **两张图 seed 不同（11 / 12）**：合成图逐字节确定 ⇒ 内容寻址名必不同，两目录各恰一份的
  断言因此有区分度（同图去重口径不会让两目录撞名——分层布局下同名也各存一份，design §5.2）。
- **「互不可见」的可机判部分**：跨 vault 读回在结构上是按当前 vault id 解析（Rust 单测
  `read_image_*` / `expand_image_refs_*` 钉落点与逃逸拒绝）——真机层钉的是它的**可观测后果**
  （B 侧只渲染 B 的卡片、A 的留存/界面不进 B），不重复测结构本身。
- **A 的附件字节不动用 `record` + `unchangedSince`**（sha256 比对）：比「目录里仍有一份」
  强——B 的整轮若误重写/搬动 A 的字节必红。

## 覆盖边界（如实登记）

- **不判「B 里读 A 的文件名必失败」**：读命令不接受任意路径的跨 vault 探针（场景 DSL 没有
  这条通道），且该判据的结构面已由 Rust 单测覆盖（`harness_image_name_invalid` / 落点逃逸拒绝 /
  `expand_image_refs` 按 vault id 解析）。
- **不判缩略图像素**：同场景 127 的口径（结构面在真机，像素面在 Rust 单测与视觉基线）。
- **不切回 A 看会话**：同 124 的已知边界（M312 双拼写 = 两会话），本场景只判附件与留存的
  分置，不判会话可见性。
