---
id: "158-ordered-list-enter-no-duplicate-marker"
item: 158
tier: full
title: 有序列表行末 Enter——单项与末项都只产生一个字面下一序号
steps:
  # 两段分别覆盖单项列表与多项列表末项，都用自造探针文档（合成内容）。
  - name: 造一份单项有序列表的探针文档
    do: vaultWrite
    file: ordered-list-first-item-enter-probe.md
    content: "单项首行续行探针。\n\n1. 甲项\n"
  - name: 打开单项探针文档
    do: open
    file: ordered-list-first-item-enter-probe.md
    marker: "单项首行续行探针"
  - name: 建立焦点
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 光标移到首项行尾——⌃N 走两行（正文行、空行）到「1. 甲项」，再 ⌃E
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+e"]
  - name: 首项行尾按 Enter 续行
    do: key
    key: "return"
  - name: 落盘（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对单项续行
    do: sleep
    ms: 1200
    expect:
      - label: 续行成立：首项之后只续出「2. 」一个新 item
        file: { path: ordered-list-first-item-enter-probe.md, has: '/1\. 甲项\n2\. \n/' }
      - label: 不跳号——单项续行的新序号是 2，MUST NOT 出现 3
        file: { path: ordered-list-first-item-enter-probe.md, not: '/3\. /' }
      - label: 无重复 marker——同一行不允许两个有序 marker 连用
        file: { path: ordered-list-first-item-enter-probe.md, not: '/[0-9]+\. [0-9]+\. /' }
      - shot: 单项续行-只一个2
  - name: 造一份含真实有序列表两项的探针文档
    do: vaultWrite
    file: ordered-list-enter-probe.md
    content: "列表续行探针。\n\n1. 甲项\n2. 乙项\n"
  - name: 打开探针文档
    do: open
    file: ordered-list-enter-probe.md
    marker: "列表续行探针"
  - name: 建立焦点
    do: clickEditor
    expect:
      - label: 焦点落在编辑器正文里
        ax: { focused: "AXTextArea" }
  - name: 光标移到末项（第二项）行尾——⌃N 走三行（空段落行、「1. 甲项」、「2. 乙项」）再 ⌃E
    do: keys
    keys: ["ctrl+n", "ctrl+n", "ctrl+n", "ctrl+e"]
  - name: 末项行尾按 Enter 续行
    do: key
    key: "return"
  - name: 落盘（⌘S 发两次换一次丢键的容错）
    do: keys
    keys: ["cmd+s", "cmd+s"]
  - name: 落盘后核对末项续行
    do: sleep
    ms: 1200
    expect:
      - label: 续行成立：末项后只续出「3. 」一个新 item
        file: { path: ordered-list-enter-probe.md, has: '/2\. 乙项\n3\. /' }
      - label: 无重复 marker——同一行不允许两个有序 marker 连用
        file: { path: ordered-list-enter-probe.md, not: '/[0-9]+\. [0-9]+\. /' }
      - shot: 续行态-只一个3
---

# 158-ordered-list-enter-no-duplicate-marker —— 有序列表行末 Enter 续行

## 本场景在验什么

两段分别钉住真实有序列表的正常续行：

1. 单项「1. 甲项」行末 Enter 后，新行只有字面下一序号「2. 」，不跳号、不重复。
2. 多项末项「2. 乙项」行末 Enter 后，新行只有字面下一序号「3. 」，不重复。

两段都用 `vaultWrite` 自造探针文档（合成内容），通过落盘文件验证编辑器命令产生的文档终态。

## 断言口径

- **单项段**：`has /1\. 甲项\n2\. \n/`、`not /3\. /`、`not /[0-9]+\. [0-9]+\. /`。
  正向断言同时是两条负向断言的正观测，避免在空文档 / 未落盘上恒真（REVIEW.md「读不到当成空」条）。
- **末项段**：`has /2\. 乙项\n3\. /` 与 `not /[0-9]+\. [0-9]+\. /`，同一正一反成对口径。
- **落盘判据**：读的是 vault 里的文件本身（不是 AX），`⌘S` 发两次抵一次丢键（键盘注入的既存纪律）。
