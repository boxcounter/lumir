---
# M440（change harness-composer-image-paste）design §9 ⑤：能力闸——当前生效模型未声明
# vision 能力时，含图片卡的消息在**发送时**被挡下：人话 toast + 该消息图片卡片标错误态 +
# 输入区内容保留 + 会话不推进。能力判据只有后端一处（harness_send → harness_image_unsupported），
# 前端只认这一个 code。
# 配置前提（launch 期）：provider = kimi + 声明清单里 probe-novision 的 vision = false——
# mock 档能力恒真，验不了拒绝路径；kimi + vision:false 在发送闸处即被拒（acquire_turn 之前），
# _dummy api_key 不会触发任何网络请求。
id: "128-harness-image-gate"
item: 128
tier: full
title: 图片能力闸：模型未声明 vision 时含图消息发送被挡（toast + 卡片标出 + 输入区保留 + 会话不推进）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: kimi
    kimiModel: "probe-novision"
    kimiModels:
      - { id: "probe-novision", effort: false, window: 131072, vision: false }
steps:
  - name: ⌘⇧A 打开 harness pane（kimi provider，生效模型 probe-novision vision:false）
    do: keys
    keys: ["cmd+shift+a"]
    expect:
      - label: harness 以旁侧 pane 出现（D368 分隔条在位）
        ax: { has: "分隔条" }
      - label: composer 在位（空输入态 = D328 占位读屏名）
        ax: { has: "问点什么" }

  - name: 真实鼠标点 composer
    do: clickInNode
    target: { role: AXTextArea, name: "问点什么" }

  - name: 键入提问（本场景独有的标记串）
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|gateprobe" }
    text: "gateprobe"
    expect:
      - label: 标记落地
        ax: { has: "gateprobe" }

  - name: 剪贴板置合成 png（贴图本身不受能力声明限制——允许贴入，发送时才挡）
    do: clipboardImage
    synth: { width: 320, height: 240, seed: 21 }

  - name: 右键 composer 唤出原生菜单
    do: click
    target: { role: AXTextArea, name: "gateprobe", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste——图片卡片入 composer（贴入动作成功）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等卡片出现
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 30000
    expect:
      - label: 图片卡片在 composer（允许贴入）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }

  - name: 发送（含图消息 → 闸应挡下）
    do: key
    key: enter

  - name: 等拒绝 toast（harness_image_unsupported 的人话出口）
    do: waitFor
    waitFor:
      has: ["不支持图片输入"]
    timeoutMs: 15000
    expect:
      - label: ⑤ toast 人话错误（D445，带模型名）
        ax: { has: "/不支持图片输入/" }
      - label: ⑤ 会话不推进：会话名钮仍是「新会话」（消息未被接受、会话未命名）
        ax: { has: "/AXPopUpButton \\(新会话\\)/" }
      - label: ⑤ 输入区内容原样保留：提问文本还在 composer
        ax: { has: "gateprobe" }
      - label: ⑤ 图片卡片仍在 composer（卡内保留、可移除后重发）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: 附件已落 harness 侧（贴入阶段成功，闸只挡发送）
        glob: { dir: "env:harness/attachments", pattern: "pasted-[0-9a-f]{16}\\.webp$", exact: 1 }
      - shot: 01-闸拒绝-toast与错误态

  - name: 移除图片卡片（× 钮，D371「移除摘录」）
    do: click
    target: { role: AXButton, name: "移除摘录" }

  - name: 等卡片移除、composer 只剩文本
    do: waitFor
    waitFor:
      not: ["/pasted-[0-9a-f]{16}\\.webp/"]
    timeoutMs: 15000
    expect:
      - label: 图片卡片已移除
        ax: { not: "/pasted-[0-9a-f]{16}\\.webp/" }
      - label: 提问文本保留（移除卡片不连带清文本）
        ax: { has: "gateprobe" }
      - shot: 02-移除卡片后
---

# 128-harness-image-gate —— 图片能力闸（change harness-composer-image-paste design §6/§9⑤）

## 本场景在验什么

spec「模型图片能力声明」的场景「不支持时挡住并标出图片卡片」：

- 贴入图片**成功**（允许贴入是裁决点 1 的 A 案：贴入动作不受能力声明限制）；
- 发送被挡：`harness_send` 的闸（能力判据的唯一产出点）在 `acquire_turn` **之前**返回
  `harness_image_unsupported`——不建会话、不入队、无任何网络请求（dummy api_key 也发不出去）；
- 界面出口：toast（D445 人话 + 模型名）+ 图片卡片标错误态（`.is-error`，截图证据）+
  **输入区内容原样保留**（裁决：用户可移除卡片后重发）+ 会话不推进（会话名钮仍「新会话」）；
- 移除卡片后 composer 只剩文本（重发路径的前半段；**正向重发**走 mock 档由场景 127 的发送面
  覆盖——kimi + dummy key 真发会走网络失败分支，不是本场景的判据）。

## 判据为什么这样写

- **配置是 launch 期的**（front-matter `config:`）：`configWrite` 不支持改 harness 节，且
  闸的判据在发送链路上、与「换 provider」这种运行期变更无关——拆独立场景是刻意。
- **toast 文本是「拒绝出口发生」的主判据**：「不支持图片输入」只可能来自 D445（harness 文案
  表），其余拒绝形态（network_failed 等）说不出这句。
- **「会话不推进」判会话名钮（「新会话」）**：消息被接受时会话会按首条用户消息命名——
  名字没变 = 会话没推进，这是有区分度的正观测。transcript 里本就没有别的消息，「没有用户
  气泡」类负向断言没有输入（且 composer 的文本在 AX 里可能落成 static text 行，负向断言
  会对着 composer 判红），不采用。
- **卡片错误态是 CSS class**（`.is-error`），AX 看不见——像素/观感归截图证据与视觉场景
  （`tests/visual/scenes/m440-harness-image-card.spec.ts` 的 error 态元素基线），本层钉
  「卡片仍在 + toast + 会话不推进」的行为面。

## 覆盖边界（如实登记）

- **正向重发（移除卡片后发送成功）未在本场景走通**：kimi provider + dummy api_key 真发只会
  得到网络层错误，验不了「闸放行」。该行为面由视觉场景的 error 态用例（stub 掉 invoke）
  钉到「移除后 composer 只剩文本」；全链路正向由场景 127（mock 档 vision 恒真）覆盖。
- **前端不另立能力判定**（spec 条款）：前端只认后端 `harness_image_unsupported` 一个 code——
  本条由代码结构保证（`src/harness-panel.ts` 的 send 拒绝分支只匹配这个 code），无第二判据可断言。
