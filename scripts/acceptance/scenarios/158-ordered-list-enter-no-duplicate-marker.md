---
id: "158-ordered-list-enter-no-duplicate-marker"
item: 158
title: 有序列表行末 Enter 单 marker（M529）——真实列表项续行只出一个新序号、无「2. 3.」重复形态
steps:
  # 判据与覆盖边界写在 front-matter 之后的正文里（本场景在验什么 / 断言口径 / 已知边界）。
  # M529（Alex 2026-10-15 dogfood）的修复对象是「行末 Enter 续出重复序号」；本场景钉真实列表项
  # 行末 Enter 的可达路径（自造探针文档，合成内容），只续出一个新 item、无重复 marker。
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
  - name: 落盘后核对
    do: sleep
    ms: 1200
    expect:
      - label: 续行成立：末项后只续出「3. 」一个新 item（旧行为回归钉固：真实列表项的续行来源是键位层）
        file: { path: ordered-list-enter-probe.md, has: '/2\. 乙项\n3\. /' }
      - label: 无重复 marker——同一行不允许两个有序 marker 连用（「2. 3.」「3. 4.」形态必红）
        file: { path: ordered-list-enter-probe.md, not: '/[0-9]+\. [0-9]+\. /' }
      - shot: 续行态-只一个3
---

# 158-ordered-list-enter-no-duplicate-marker —— 有序列表行末 Enter 单 marker（M529）

## 本场景在验什么

Alex 2026-10-15 dogfood：「当我在 list 的最后一个 item 行末敲 Enter 键时，会新开一行 item，但多了
序号」——现场新行出现「2. 3.」。根因 = M461② 已登记 WebKit 原生 smart-list 缺陷的逃逸形态：重复序号
不走 `insertOrderedList` 族 `beforeinput`（那一层 M461② 已拦），而是作为**裸 DOM 文本**插进
contenteditable、经 CM 读回成文档变更，与 CM 自己的续行叠加。修复 = DOM 读回入口（inputHandler 层）
拒收「空项 marker 之后插入裸 marker」的读回变更（判定本体 `src/enter-indent.ts`，合同
`openspec/specs/editor-live-preview` 的「IME 组合期不重复插入列表 marker」M529② 节）。

本场景用 `vaultWrite` 自造探针文档（合成内容），钉死**真实列表项**行末 Enter 的可达路径：只续出一个
新 item、无重复 marker。

## 断言口径

- **续行成立**：`/2\. 乙项\n3\. /`——末项之后恰好续出 `3. ` 这一个新 item 的 marker，且它是紧接
  「2. 乙项」之后的位置（旧行为回归钉固：真实列表项的续行来源是键位层）。
- **无重复 marker**：`not /[0-9]+\. [0-9]+\. /`——同一行不允许两个有序 marker 连用，「2. 3.」
  「3. 4.」形态必红。**一正一反成对**：正向那条（`3. ` 在场）同时是负向那条的正观测，负向断言因此
  不是在空文档/未落盘上恒真（REVIEW.md 「读不到当成空」条）。
- **落盘判据**：读的是 vault 里的文件本身（不是 AX），`⌘S` 发两次抵一次丢键（键盘注入的既存纪律）。

## 已知边界（如实登记）

- **WebKit 裸插入那一半的组合态无法合成复现**（`.local/probes/m461-probe/readings.md` §缺陷②；M529 探针
  三通道实测：KimiCU `press_key`、`osascript keystroke`、切输入源都进不了组合态
  `.local/probes/m529-probe/readings.md` §结论②）。裸 marker 插入的落点形状由 M529 探针的等价注入复验
  （同文件 §结论③：`range.insertNode` 绕开 `beforeinput` 直接改 contenteditable，读回形态与
  Alex 现场「2. 3.」逐结构同形）；本场景覆盖的是**英文路径（CM 键位单次 dispatch）无重复**
  （同文件 §结论①：Enter 全程零 `beforeinput`、DOM 一次性得到「2. 」）。**Alex 输入法路径的最终
  确认留 dogfood**——不要把本场景的 PASS 读成「IME 组合期的重复序号已在真机验过」。
