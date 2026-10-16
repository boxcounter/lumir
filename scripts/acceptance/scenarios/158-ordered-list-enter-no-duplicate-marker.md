---
id: "158-ordered-list-enter-no-duplicate-marker"
item: 158
title: 有序列表行末 Enter 单 marker（M529）——真实列表项续行只出一个新序号、无「2. 3.」重复形态
---

steps:
  # M529（Alex 2026-10-15 dogfood）：「当我在 list 的最后一个 item 行末敲 Enter 键时，
  # 会新开一行 item，但多了序号」——现场新行出现「2. 3.」。根因 = M461② 已登记
  # WebKit 原生 smart-list 缺陷的逃逸形态：重复序号不走 insertOrderedList 族
  # beforeinput（那一层 M461② 已拦），而是作为**裸 DOM 文本**插进 contenteditable、
  # 经 CM 读回成文档变更，与 CM 自己的续行叠加。修复 = DOM 读回入口（inputHandler 层）
  # 拒收「空项 marker 之后插入裸 marker」的读回变更（判定本体 src/enter-indent.ts，
  # 合同 openspec/specs/editor-live-preview「IME 组合期不重复插入列表 marker」M529② 节）。
  # 本场景用 vaultWrite 自造探针文档（合成内容），钉死**真实列表项**行末 Enter 的
  # 可达路径：只续出一个新 item、无重复 marker。WebKit 裸插入那一半的组合态无法
  # 合成复现（test-results/m461-probe/readings.md §缺陷②），由 M529 探针的等价注入
  # 真机复验（test-results/m529-probe/readings.md）+ 本场景的英文路径对照共同覆盖，
  # Alex 输入法路径的最终确认留 dogfood。
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
