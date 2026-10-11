---
# M447（change composer-emacs-nav）：族外键在 composer 内**不回退**——⌥G / ⌃V / Tab 的本层路径
# 与不动本能力之前一致：⌥G 不弹跳转输入条、三者都不改编辑器文档、composer 不被列表缩进改写。
id: "147-harness-composer-family-outside"
item: 147
title: composer 族外键（⌥G / ⌃V / Tab）不回退（M447）
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

  - name: 记编辑器文档基线（族外键 MUST NOT 动到编辑器）
    do: recordEditor
    as: doc-before-outside

  - name: 键入 abc（composer 里有一段已知文本）
    do: keys
    keys: ["a", "b", "c"]
    gapMs: 80
    expect:
      - label: 文本到位
        ax: { has: "abc" }

  - name: ⌥G（editor 作用域，composer 内不命中）
    do: key
    key: "alt+g"
    expect:
      - label: 跳转到行输入条**没有**出现（本层不接管，也不越界到 composer）
        ax: { not: "/共 \\d+ 行/" }
      - label: 编辑器文档逐字节不变
        editor: { unchangedSince: doc-before-outside }
      - shot: 01-alt-g不弹输入条

  - name: ⌃V（翻屏族，composer 内不命中）
    do: key
    key: "ctrl+v"
    expect:
      - label: 编辑器文档逐字不变（⌃V 不在 composer 内生效）
        editor: { unchangedSince: doc-before-outside }

  - name: Tab（列表缩进族，composer 内不命中）
    do: key
    key: "tab"
    expect:
      - label: composer 文本未被列表缩进改写（仍是 abc）
        ax: { has: "abc" }
      - label: 编辑器文档逐字节不变
        editor: { unchangedSince: doc-before-outside }
      - shot: 02-tab与ctrl-v不回退
---

# 147-harness-composer-family-outside —— 族外键在 composer 内不回退（M447）

## 本场景在验什么

合同：族外的键位（⌃G、⌥G、翻屏族 ⌃V / ⌥V / ⌃L、`Tab` / `⇧Tab`、撤销族）MUST NOT 被本能力
改变——它们在 composer 内照旧走各自既有路径（change 的 harness 增量「族外键」条 + keymap-commands
增量的「editor 作用域不越界」scenario）。

现场：焦点在 composer 内，依次按 ⌥G、⌃V、`Tab`：

- ⌥G（`editor.goto-line`，作用域仍是 `editor`）→ **不**弹跳转输入条（输入条的签名是
  `AXTextField = "<行号>"` + `共 M 行`）；
- ⌃V（`editor.scroll-page-down`，作用域 `editor`）→ 编辑器文档不动；
- `Tab`（`editor.list-indent`，作用域 `editor`）→ composer 文本不被列表缩进改写、编辑器文档不动。

## 判据为什么这样写

- **越界防线**：`text` 作用域只放宽本能力接管的那一族；族外 editor 命令在 composer 内 MUST NOT
  命中（否则在 composer 里按 ⌥G 会去动编辑器光标 / 弹浮层）。三条一起覆盖「作用域不放宽」。
- **⌥G 的判据用输入条签名而不是「什么都没发生」**：macOS 的 ⌥G 会经文本输入系统产出 `©`，
  native 路径本来就会让 composer 里多一个字符——那是既有行为、不是本层动作；真正要守的是
  **本层不接管、不越界**（输入条不出现）。
- **编辑器文档逐字节不变的判据**（`unchangedSince`）是三条共同的兜底：任何一条被错误地路由到
  编辑器侧实现，都会在编辑器文档上留下痕迹（MUST NOT 使用「不可读 = 没变」的口径，见
  `scripts/acceptance/README.md` 的历史教训）。

## 已知边界（如实登记）

- ⌃V 在 composer 内的**原生**副作用（引擎自己的滚动）不判：本场景只判「本层没接管」。
- `Tab` 的原生行为是焦点遍历（焦点可能离开 composer）——本场景把它放在最后一步，后续断言不依赖
  composer 的焦点。
- 不发消息、不写 vault；真实 vault 与 `~/.config/lumir` 全程不读写。
