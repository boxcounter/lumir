---
# M452（change composer-draft-persistence，design §9 ⑤）：**发送被拒时草稿原样保留**。
#
# 现场构造沿用场景 128 的能力闸：当前生效模型未声明 vision ⇒ 含图片卡片的消息在
# `harness_send` 的闸处被挡下（不建会话、不入队）。本场景在它的基础上加**草稿面**的判据：
# 被拒前盘上的草稿内容，被拒后**逐字节不变**（MUST NOT 出现「草稿先被清空再回滚」的丢字窗口）。
#
# 为什么用 kimi + vision:false 而不是 mock：mock 档能力恒真，构造不出拒绝路径（128 的取向一致）；
# vision:false 在发送闸处即被拒（`acquire_turn` 之前），dummy api_key 不触发任何网络请求。
id: "138-harness-draft-send-reject"
item: 138
title: composer 草稿：发送被拒（模型不支持图片）时草稿原样保留（无丢字窗口）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: kimi
    kimiModel: "probe-novision"
    kimiModels:
      - { id: "probe-novision", effort: false, window: 131072, vision: false }
seed:
  registry:
    - { id: acc-gate, path: $vault, lastOpenedAt: 1757000002000 }
  sessions:
    acc-gate:
      panes:
        - { tabs: [harness-note.md], active: harness-note.md }
      harnessPane: true
steps:
  - name: 等 A 装载 + harness pane 按存储装配（kimi provider，生效模型 probe-novision vision:false）
    do: waitFor
    waitFor:
      has: ["分隔条", "/AXButton \\(发送\\)/", "问点什么"]
    timeoutMs: 40000
    expect:
      - shot: 01-起始态

  - name: 点 composer 聚焦并键入内容
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }
  - name: 键入标记串
    do: keys
    keys: ["d", "r", "a", "f", "t", "g", "a", "t", "e"]
    expect:
      - label: 标记落在 composer（注入落地的正观测）
        ax: { has: "draftgate" }

  - name: 剪贴板置合成 png（贴图本身不受能力声明限制——允许贴入，发送时才挡）
    do: clipboardImage
    synth: { width: 320, height: 240, seed: 23 }

  - name: 右键 composer 唤出原生菜单
    do: click
    target: { role: AXTextArea, name: "draftgate", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste——图片卡片入 composer
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等图片卡片落定
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000

  - name: 等防抖落盘（1s 窗口 + 2.5s 余量）
    do: sleep
    ms: 2500
    expect:
      - label: ⑤ 前置：被拒前的草稿文件在位（含文本与图片引用）
        file: { path: "env:harness/drafts/acc-gate.json", has: "draftgate" }
      - label: ⑤ 前置：草稿以引用形态含图片（内容寻址名在场）
        file: { path: "env:harness/drafts/acc-gate.json", has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - shot: 02-发送前-草稿在位

  - name: 记下草稿文件基线（被拒后须逐字节不变）
    do: record
    as: draft-gate
    file: "env:harness/drafts/acc-gate.json"

  - name: 发送（含图消息 → 闸应挡下）
    do: key
    key: enter

  - name: 等拒绝（toast = harness_image_unsupported 的人话出口）
    do: waitFor
    waitFor:
      has: ["不支持图片输入"]
    timeoutMs: 15000
    expect:
      - label: ⑤ 拒绝 toast（D445，带模型名）
        ax: { has: "/不支持图片输入/" }
      - label: ⑤ 输入区原样保留：提问文本还在
        ax: { has: "draftgate" }
      - label: ⑤ 图片卡片仍在输入区
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: ⑤ 会话不推进：会话名钮仍是「新会话」
        ax: { has: "/AXPopUpButton \\(新会话\\)/" }
      - label: ⑤ **草稿逐字节未变**（MUST NOT 先清空再回滚）
        file: { path: "env:harness/drafts/acc-gate.json", unchangedSince: draft-gate }
      - shot: 03-被拒后-草稿保留

  - name: 等一拍（回滚重渲触发的自动保存若会写什么，这一拍足够它落地）
    do: sleep
    ms: 1500
    expect:
      - label: ⑤ 回滚后草稿仍与输入区一致（内容相同 ⇒ 不写盘、也不写成空）
        file: { path: "env:harness/drafts/acc-gate.json", unchangedSince: draft-gate }
      - label: ⑤ 回滚没把草稿写成空壳
        file: { path: "env:harness/drafts/acc-gate.json", has: "draftgate" }
      - shot: 04-拍后-草稿仍在
---

# 138-harness-draft-send-reject —— 发送被拒时草稿原样保留（design §9⑤）

## 本场景在验什么

spec「composer 草稿自动保存与恢复」的交互条款：**发送被拒 / 失败时草稿 SHALL 与输入区内容
一并原样保留**，MUST NOT 出现「发送被拒即丢字」的空草稿窗口。

## 判据为什么这样写

- **`unchangedSince` 是主判据，不是「文件还在」**：「文件还在」允许它被写成别的内容（例如
  回滚路径把空内容落盘、再被别的编辑覆盖）。逐字节比对才钉住「原样保留」。
- **输入区面与草稿面成对**：被拒后输入区仍有文本 + 图片卡片（128 已钉过的行为面）**且**
  草稿文件未变——两面一致才是「内容没丢」。只判一面的话，「草稿被清空但输入区还在」这种
  半丢形态会漏（那是重启后才暴露的丢字）。
- **「拍后仍不变」覆盖回滚触发的自动保存**：回滚会整面重渲输入区，重渲后内容与盘上那份相同
  ⇒ 按「无变更不写」应零写入。这一步的时间盒是给「万一路径上多写了一次」留的观测窗。
- **正向对照（贴图后的两种负向）**：`草稿含图片引用名` 是正向在场判据；
  **不内联 base64** 的负向断言在场景 135，本场景只判「内容没被改」，避免重复。

## 覆盖边界（如实登记）

- **真机跑绿状态**：本场景随 change 同 PR 交付，**本轮未跑真机**（前台窗口由 tower 统一安排）。
- **正向重发（移除图片卡片后发送成功）不在这里**：kimi + dummy api_key 真发只会得到网络层
  错误，验不了「闸放行后清除草稿」；那条路径由场景 137（mock 档成功发送后清除）覆盖。
- **卡片错误态是 CSS class**（`.is-error`），AX 看不见——像素/观感归截图证据与视觉场景
  （`tests/visual/scenes/m440-harness-image-card.spec.ts`），本层钉行为面（同 128 的口径）。

## 环境与副作用

- 合成 vault（`/tmp/lumir-m102-acceptance`）+ 隔离 `XDG_CONFIG_HOME`；真实 vault 只读。
- 贴图会真的往隔离配置目录的 `harness/attachments/acc-gate/` 写一份 WebP（套件每场景清）。
- vision:false 的拒绝发生在发送闸处（不进网络）；1420 全程不碰（端口走 `LUMIR_ACCEPTANCE_PORT`，缺省 1430）。
