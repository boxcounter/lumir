---
id: "158-ordered-list-enter-no-duplicate-marker"
item: 158
tier: full
title: 有序列表行末 Enter 单 marker（M529）——真实列表项续行只出一个新序号、无「2. 3.」重复形态
steps:
  # 判据与覆盖边界写在 front-matter 之后的正文里（本场景在验什么 / 断言口径 / 已知边界）。
  # 两段各钉一个已报告的现场，都用自造探针文档（合成内容）：
  #   ① M753（Alex 2026-10-27 复发）：单项列表首行「1. 甲项」行末 Enter 后，新行开头
  #     出现「3. 」——钉「只续出「2. 」、不跳号」；
  #   ② M529（Alex 2026-10-15）：多项列表末项行末 Enter 后，新行出现「2. 3.」——钉
  #     「续出的新行只有一个 marker」。
  - name: 造一份单项有序列表的探针文档（M753 首行现场）
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
  - name: 落盘后核对（M753 段）
    do: sleep
    ms: 1200
    expect:
      - label: 续行成立：首项之后只续出「2. 」一个新 item
        file: { path: ordered-list-first-item-enter-probe.md, has: '/1\. 甲项\n2\. \n/' }
      - label: 不跳号——单项续行的新序号是 2，MUST NOT 出现 3（M753 现场「新行开头出现 3. 」必红）
        file: { path: ordered-list-first-item-enter-probe.md, not: '/3\. /' }
      - label: 无重复 marker——同一行不允许两个有序 marker 连用（「2. 3.」形态必红）
        file: { path: ordered-list-first-item-enter-probe.md, not: '/[0-9]+\. [0-9]+\. /' }
      - shot: 单项续行-只一个2
  - name: 造一份含真实有序列表两项的探针文档（M529 末项现场）
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
  - name: 落盘后核对（M529 段）
    do: sleep
    ms: 1200
    expect:
      - label: 续行成立：末项后只续出「3. 」一个新 item（旧行为回归钉固：真实列表项的续行来源是键位层）
        file: { path: ordered-list-enter-probe.md, has: '/2\. 乙项\n3\. /' }
      - label: 无重复 marker——同一行不允许两个有序 marker 连用（「2. 3.」「3. 4.」形态必红）
        file: { path: ordered-list-enter-probe.md, not: '/[0-9]+\. [0-9]+\. /' }
      - shot: 续行态-只一个3
---

# 158-ordered-list-enter-no-duplicate-marker —— 有序列表行末 Enter 单 marker（M529 / M753）

## 本场景在验什么

两段，各钉一个已报告的现场：

1. **M753（Alex 2026-10-27，老问题复发）**：「在第一行『1. xxxxxxx』末尾敲 Enter 后，新行（也就是
   第二行）出现『2. 3. 』」——正常续行的「2. 」之外多出一个「3. 」（tower 2026-10-27 转达 Alex 的
   更正：不是「新行只有 3. 」）。两半各管一段：键位层恒续**字面下一序号**（单测
   `tests/unit/enter-indent.test.ts` 的 4.6 组）；DOM 读回层按**结果行**拒收重复序号（单测
   `tests/unit/ordered-list-auto-mode.test.ts` 的 G 组：只要读回让该行行首多出 / 换掉一个 marker
   就吞，不认具体编码——marker 区内的插入、覆盖 marker 区的替换、夹带前排空白都算）。
   本段钉真机可达路径的终态：单项续行后新行只有一个「2. 」。
2. **M529（Alex 2026-10-15）**：「list 的最后一个 item 行末敲 Enter，会新开一行 item，但多了
   序号」——现场新行出现「2. 3.」。根因 = M461② 已登记 WebKit 原生 smart-list 缺陷的逃逸形态：重复
   序号不走 `insertOrderedList` 族 `beforeinput`（那一层 M461② 已拦），而是作为**裸 DOM 文本**插进
   contenteditable、经 CM 读回成文档变更，与 CM 自己的续行叠加。修复 = DOM 读回入口（inputHandler
   层）拒收会在这类行上造出重复序号的读回变更（判定本体 `src/enter-indent.ts`；M753 起按结果行判，
   见上一条，合同 `openspec/specs/editor-live-preview` 的「IME 组合期不重复插入列表 marker」条）。

两段都用 `vaultWrite` 自造探针文档（合成内容），钉死**真实列表项**行末 Enter 的可达路径。

## 断言口径

- **M753 段**：`has /1\. 甲项\n2\. \n/`（续出「2. 」）、`not /3\. /`（不跳号）、
  `not /[0-9]+\. [0-9]+\. /`（无重复 marker）三条成对——正向那条同时是两条负向的正观测，负向
  断言因此不是在空文档 / 未落盘上恒真（REVIEW.md 「读不到当成空」条）。
- **M529 段**：`has /2\. 乙项\n3\. /`（末项续出「3. 」）+ `not /[0-9]+\. [0-9]+\. /`，
  同一正一反成对口径。
- **落盘判据**：读的是 vault 里的文件本身（不是 AX），`⌘S` 发两次抵一次丢键（键盘注入的既存纪律）。

## 已知边界（如实登记）

- **WebKit 裸插入那一半的组合态无法合成复现**（`.local/probes/m461-probe/readings.md` §缺陷②；M529
  探针三通道实测：KimiCU `press_key`、`osascript keystroke`、切输入源都进不了组合态
  `.local/probes/m529-probe/readings.md` §结论②）。本场景覆盖的是**英文路径（Enter 走 CM 键位单次
  dispatch）下的终态**：没有第二个插入者时，读回层只是空转；它证不了「WebKit 的裸插入被吞掉」。
- **M753 的读回判据按结果行钉**（`ordered-list-auto-mode.test.ts` 的 G 组），真机等价注入（M529 探针
  的 F11 通道）待串行窗口复验。**Alex 输入法路径的最终确认留 dogfood**——不要把本场景的 PASS 读成
  「IME 组合期的重复序号已在真机验过」。
