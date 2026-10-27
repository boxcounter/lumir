---
# M447（change composer-emacs-nav）：扩选族——⌃⇧B 扩选时 **anchor 不动**、head 按移动族同一套
# 停靠点后退；随后的 ⌃H 删掉**整个选区**（而不是一个字符）。
id: "146-harness-composer-extend"
item: 146
tier: full
title: composer 扩选族：⌃⇧B 扩选后 ⌃H 删整段选区（anchor 不动，M447）
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

  - name: 记编辑器文档基线
    do: recordEditor
    as: doc-before-extend

  - name: 键入 abcd
    do: typeInNode
    target: { role: AXTextArea, name: "问点什么|abcd" }
    text: "abcd"
    expect:
      - label: 文本到位
        ax: { has: "abcd" }

  - name: ⌃⇧B 两次（从末尾向后扩选两个字符）
    do: keys
    keys: ["ctrl+shift+b", "ctrl+shift+b"]
    gapMs: 150

  - name: ⌃H 删掉扩选出来的选区
    do: key
    key: "ctrl+h"
    expect:
      - label: 整个选区被删（文本变成 ab）——anchor 不动的读数
        ax: { has: "ab" }
      - label: 只删一个字符的形态不在场（若 anchor 跟着 head 一起动，就没有选区可删、只剩 abc）
        ax: { not: "abc" }
      - label: 打字没有漏进编辑器文档
        editor: { unchangedSince: doc-before-extend }
      - shot: 01-扩选后删整段选区
---

# 146-harness-composer-extend —— 扩选族 anchor 不动（M447）

## 本场景在验什么

合同：扩选族 SHALL 保持 **anchor 不动**、由同一份移动纯函数驱动 head（change 的 harness 增量
「转置与扩选」段）。本场景用「扩选两格 → 删除」的后果读数判它：

1. composer 里键入 `abcd`，光标在末尾；
2. ⌃⇧B 两次 → 选区覆盖 `cd`（anchor 停在末尾，head 后退两格）；
3. ⌃H → 删掉**整个选区** ⇒ 文本变成 `ab`。

## 判据为什么这样写

- **anchor 不动的读数**：若实现让 anchor 与 head 一起移动（等价于没有选区），⌃H 只会删**一个**
  字符 ⇒ 文本是 `abc`。因此 `has: "ab"` + `not: "abc"` 两条一起对「anchor 跟着动」的缺陷形态有
  区分度（REVIEW.md 「断言等价于子串」条：先造一个必须让它失败的输入）。
- **`gapMs: 80`**：四拍键入压在一个撤销聚簇窗口内，减少丢键复跑。
- **⌥F / ⌥B（按词扩选）不在本条**：词边界口径与方向由模型层单测覆盖（`moveWordForward` /
  `moveWordBackward` 的落点断言）；真机层再判一次的价值低、且要造更长的文本。

## 已知边界（如实登记）

- 选区的**方向**（anchor 在 head 左还是右）与选区高亮观感不在机器判据面：AX 不暴露选区端点，
  高亮观感留截图人工过目。
- 有选区时键入字符「替换选区」今天走**原生路径**（本 change 不改，design §4.4 的边界登记），
  因此本场景用 ⌃H（走模型）消费选区，不用键入。
- 不发消息、不写 vault；真实 vault 与 `~/.config/lumir` 全程不读写。
