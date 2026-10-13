---
# M452（change composer-draft-persistence，design §9 ①⑥）：composer 草稿的**重启恢复**真机判据
# ——在输入区打字 + 贴一张图 → 等防抖落盘 → 重启 app → 输入区按块序与内容还原（图片卡片
# 引用名一致、缩略图仍可读回），且草稿文件里**不含 base64**。
#
# 判据口径：
# - **恢复只可能来自草稿文件**：重启会清空内存会话与 transcript（`harness.rs` 模块头、
#   场景 127/96 已钉过），composer 的内容因此只可能来自 `harness/drafts/<vault 稳定 id>.json`。
#   落盘这一侧由「草稿文件存在 + 含标记串」正观测（否则「恢复出来了」也可能来自别的通道）。
# - **草稿落配置目录、vault 零写入**：落点按 vault 稳定 id 编址，预置注册项 acc-draft 让路径
#   可写死断言（同 127/129 的口径）。
# - **图片以引用形态入草稿**：负向断言「不含 data:image / base64」——与会话留存「不内联
#   base64」同口径（正向由内容寻址名在场钉住，负向才有区分度）。
# - **防抖窗口 1s**：断言前留 2.5s 固定窗（同 127 的会话存档口径），不拿「刚打完就断言」
#   赌窗口。
id: "135-harness-draft-restore"
item: 135
title: composer 草稿：编辑 + 贴图后重启，输入区按块序还原（图片卡片引用 round-trip、草稿无 base64）
open: harness-note.md
marker: "HNL-ALPHA"
seed:
  # 注册表 id 是场景的判据：草稿 sidecar 的名字 = vault 稳定 id，预置 acc-draft 让落点可写死断言。
  registry:
    - { id: acc-draft, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-draft:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      ratio: 0.6
      # harness_pane = true：重启后按存储重新装配出 harness pane（ADR 0008 Decision 6 的位；
      # 场景 91/96 同款），本场景判的是 pane 里输入区的内容。
      harnessPane: true
steps:
  - name: 等 harness pane 按存储装配 + 输入区在位
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - shot: 01-起始态

  - name: 真实鼠标点 composer（contenteditable 的 DOM 焦点靠真实 mousedown 建立）
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入草稿文本（本场景独有的标记串）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|draftmark" }
    text: "draftmark"
    expect:
      - label: 标记落在 composer（注入落地的正观测）
        ax: { has: "draftmark" }

  - name: 剪贴板置合成 png（seed 17 ⇒ 逐字节确定）
    do: clipboardImage
    synth: { width: 360, height: 200, seed: 17 }

  - name: 右键 composer 唤出原生菜单（Paste 通道，M415 探针口径）
    do: click
    target: { role: AXTextArea, name: "draftmark", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 插入图片卡片（贴图落 harness 侧 attachments/<vault 稳定 id>/）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等图片卡片落定
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000

  - name: 等防抖窗口落盘（DRAFT_WRITE_DEBOUNCE_MS = 1000，留 2.5s 余量）
    do: sleep
    ms: 2500
    expect:
      - label: ① 草稿 sidecar 落在配置目录的 harness/drafts/<vault 稳定 id>.json
        file: { path: "env:harness/drafts/acc-draft.json", has: "draftmark" }
      - label: ⑥ 图片卡片以**内容寻址引用**入草稿（引用名在场）
        file: { path: "env:harness/drafts/acc-draft.json", has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: ⑥ 负向：草稿不内联 data URL
        file: { path: "env:harness/drafts/acc-draft.json", not: "data:image" }
      - label: ⑥ 负向：草稿不内联 base64（与会话留存同口径）
        file: { path: "env:harness/drafts/acc-draft.json", not: "base64" }
      - label: ③ 草稿不落 vault 的任何角落（MUST NOT 触碰 vault）
        glob: { dir: ".", pattern: "acc-draft\\.json$", exact: 0 }
      - label: ① 草稿是块模型 JSON（version + blocks 两个顶层键）
        file: { path: "env:harness/drafts/acc-draft.json", has: '"version":1' }
      - shot: 02-落盘后-composer

  - name: 记下草稿文件基线（重启后断言恢复不写盘）
    do: record
    as: draft-file
    file: "env:harness/drafts/acc-draft.json"

  - name: 重启 app（内存会话清空——输入区的内容只可能来自草稿）
    do: restart

  - name: 等重启后 pane 装配 + 草稿恢复进输入区
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "draftmark"]
    timeoutMs: 60000
    expect:
      - label: ① 重启后输入区恢复草稿文本（块序 / 内容一致）
        ax: { has: "draftmark" }
      - label: ⑥ 重启后图片卡片按引用名还原（卡片元信息行在场）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: 恢复后 transcript 仍是空态（内容在输入区，不是被当成已发送的消息渲染）
        ax: { has: "与当前文档对话" }
      - label: ① 恢复不写盘：草稿文件逐字节未变
        file: { path: "env:harness/drafts/acc-draft.json", unchangedSince: draft-file }
      - shot: 03-重启后恢复

  - name: 等恢复卡片的缩略图 load 完成（元信息行补出宽高 ⇒ 读回命令取到了字节）
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp[\\s\\S]{0,80}?360×200/"]
    timeoutMs: 30000
    expect:
      - label: ⑥ 缩略图经 harness_read_image 读回（同 vault 的附件目录仍可解析）
        ax: { has: "/360×200/" }
      - shot: 04-缩略图就位
---

# 135-harness-draft-restore —— 草稿的重启恢复（change composer-draft-persistence design §9①⑥）

## 本场景在验什么

spec「composer 草稿自动保存与恢复」的保存与恢复两条主干：

- **保存**：在输入区编辑（文本 + 一张图片卡片）后，内容作为**当前 vault 的草稿**落
  `<config_dir>/harness/drafts/<vault 稳定 id>.json`（tmp + rename 原子替换）；
- **恢复**：重启 app 装载同一 vault 后，输入区按相同块序还原该文本与图片卡片；
- **形态**：草稿存的是块模型 JSON（`version` + `blocks`），图片以**内容寻址引用**在场，
  **MUST NOT 内联 base64**；
- **不碰 vault**：草稿落配置目录，vault 内零新增。

## 判据为什么这样写

- **「草稿文件存在且含标记串」是恢复的来源正观测**：只断言「重启后输入区还有那段字」不足以
  证明它来自草稿文件——内存里可能还有别的通道。两条一起判才有区分度。
- **图片 round-trip 有两条读法**：引用名（AX 里的卡片元信息行，引用名 = 内容寻址名）与缩略图
  尺寸（`360×200` 只在 `harness_read_image` 取回字节、`<img>` load 后由 naturalWidth/Height
  补出——M449 口径）。前者证明「引用被还原」，后者证明「引用仍可解析」。
- **base64 负向断言**：草稿文件里不该出现 `data:image` 或 `base64` 字面量；正向（引用名在场）
  与负向成对，避免「文件根本不存在所以不含 base64」这类空过（文件存在已由上面的 `has` 钉住）。
- **`unchangedSince` 判「恢复不写盘」**：恢复只是读 + 渲染，盘上那份不该被改写（改写了说明
  恢复路径又写了一次盘，白白推进 mtime）。

## 覆盖边界（如实登记）

- **真机跑绿状态**：本场景随 change 同 PR 交付，**本轮未跑真机**（前台窗口由 tower 统一安排）。
  `--check` 静态校验通过；运行期读数待 tower 排跑的跑批给出。
- **只覆盖 harness 面板的输入区**：编辑器侧的未保存 / 崩溃备份链路由既有场景（07/08c）覆盖，
  本 change 未动它。
- **防抖窗口内的崩溃丢失**（≤1000ms 的输入）是 design §4 明示的 best-effort 边界，本场景的
  断言刻意留 2.5s 窗口，判的是「最近一次已保存草稿」，不判「最后一个字符」。

## 环境与副作用

- 合成 vault（`/tmp/lumir-m102-acceptance`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 贴图会真的往隔离配置目录的 `harness/attachments/acc-draft/` 写一份 WebP（套件每场景清）。
- 只开 pane、重启、读 AX 与文件；1420 全程不碰（端口走 `LUMIR_ACCEPTANCE_PORT`，缺省 1430）。
