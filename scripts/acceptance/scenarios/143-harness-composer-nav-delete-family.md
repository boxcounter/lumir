---
# M447（change composer-emacs-nav）：删除族在 composer 内按**整块**作用——⌃H 在段首遇卡片删整卡、
# ⌃D 在卡片前缘删整卡（与 Backspace / Delete 键同一份模型语义）。
id: "143-harness-composer-nav-delete-family"
item: 143
title: composer 删除族按整卡：⌃H / ⌃D 删掉整张卡片（M447）
open: harness-note.md
marker: "HNL-ALPHA"
config:
  harness:
    provider: mock
    fixture: "$fixtures/harness-mock-basic.json"
steps:
  - name: ⌘⇧A 打开 harness pane（旁侧分栏）
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

  - name: 剪贴板置合成 png（360×200，seed 71）
    do: clipboardImage
    synth: { width: 360, height: 200, seed: 71 }

  - name: 右键 composer 唤出 WebKit 原生菜单（Paste 通道）
    do: click
    target: { role: AXTextArea, name: "问点什么", button: right }
    expect:
      - label: 原生菜单出现且 Paste 项在场
        ax: { has: "/AXMenuItem[^\n]*(Paste|粘贴)/" }

  - name: 点 Paste 贴图（空 composer ⇒ [图片, 空段落]，光标落末尾段落段首）
    do: click
    target: { role: AXMenuItem, any: "/(Paste|粘贴)/" }

  - name: 等卡片落定
    do: waitFor
    waitFor:
      has: ["/pasted-[0-9a-f]{16}\\.webp[\\s\\S]{0,80}?360×200/"]
    timeoutMs: 30000
    expect:
      - label: 卡片与元信息行在位
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp[\\s\\S]{0,80}?360×200/" }

  - name: ⌥⌫（光标在段落段首——词级 kill MUST NOT 跨块、不删前一张卡）
    do: key
    key: "alt+backspace"
    expect:
      - label: 卡片未被删（词级 kill 到段边界即停、段边界处无动作）
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp[\\s\\S]{0,80}?360×200/" }

  - name: ⌃H（光标在段落段首、其前一块是卡片 ⇒ 删整卡）
    do: key
    key: "ctrl+h"
    expect:
      - label: 整张卡片被删掉（元信息行不在场）
        ax: { not: "360×200" }
      - shot: 01-段首ctrl-h删整卡

  - name: 一次 ⌘Z（撤销口径与退格键同一份模型语义）
    do: key
    key: "cmd+z"
    expect:
      - label: 卡片随撤销复原
        ax: { has: "/pasted-[0-9a-f]{16}\\.webp[\\s\\S]{0,80}?360×200/" }

  - name: ⌃B 退到卡片前缘，再 ⌃D（光标在卡片前缘 ⇒ 删整卡）
    do: keys
    keys: ["ctrl+b", "ctrl+d"]
    gapMs: 150
    expect:
      - label: ⌃D 同样删掉整张卡片
        ax: { not: "360×200" }
      - shot: 02-卡片前缘ctrl-d删整卡
---

# 143-harness-composer-nav-delete-family —— 删除族按整卡（M447）

## 本场景在验什么

合同：⌃D / ⌃H 与 Delete / Backspace **走同一份模型语义**（后删 / 前删一字符；光标在卡片前缘 /
段首遇卡片时对整块作用）——MUST NOT 存在第二份删除判定（change 的 harness 增量「删除族」段）。

现场：一张合成图片卡片 + 其后的空段落（贴图后的默认形态）。

1. 光标在段落段首、其前一块是卡片，按 ⌃H → **整张卡片**被删掉（不是删掉段落的空字）；
2. ⌘Z 复原；
3. ⌃B 退到卡片前缘，按 ⌃D → 同样删掉整张卡片。

## 判据为什么这样写

- **卡片在场的读数用元信息行**：图片卡片的元信息行带真实像素尺寸（`· 360×200`），是卡片在场
  唯一稳定的文本读数；文件名是内容寻址哈希，不能写死。
- **两条路径分开判**：⌃H 走 `backspaceAtCaret`、⌃D 走 `deleteForwardAtCaret`——两条都必须在
  卡片档按整块作用。两条一起覆盖，避免「一条对了一条没接上」的静默半覆盖。
- **⌘Z 复原条**顺带守住「删卡是一个撤销步」（与退格键同口径）。

## 已知边界（如实登记）

- AX 不暴露光标位：本场景不直接读「删除后光标落在哪」，只读「卡片在不在」。（M473 把 ⌃D 删卡后的
  落点对齐到「贴被删块的前一段落末缘」——本场景**仍不读**它，判据形态不变；模型层判据在
  `tests/unit/harness-composer.test.ts` 的「M473 ⌃D / Delete 在卡片前缘」用例。）
- 补一刀「⌥⌫ 在段首**不**删卡」的判据在场景 144（词级 kill 不跨块）。
- 本场景不发消息；贴图落在隔离配置目录的 `harness/attachments/<vault id>/` 下。
- 真实 vault 与 `~/.config/lumir` 全程不读写；真机段走 `LUMIR_ACCEPTANCE_PORT`（1430）。
