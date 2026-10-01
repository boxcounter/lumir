---
id: "37-heading-hierarchy"
item: 37
title: 标题六级阶梯（稿 A）真机呈现：H1–H6 全部渲染、编辑器源码不动、文档零写盘
fixtures: [headings-ramp.md]
open: headings-ramp.md
marker: "一级标题 Ramp"
steps:
  - name: 记录源文件基线（本场景全程只读，基线点只需在断言之前）
    do: record
    as: 场景文件
    file: headings-ramp.md
    expect:
      - label: 基线文件存在且可读（读不到一律 FAIL，不允许在空值上比较）
        file: { path: headings-ramp.md, exists: true }

  - name: 记录编辑器文本基线（渲染态不该改动文档）
    do: recordEditor
    as: 编辑器基线

  - name: 六级标题全部在真机 WKWebView 渲染出来（live preview 的替换渲染在场）
    do: settle
    expect:
      - label: H1–H6 的标题文字逐条暴露进 AX（渲染成 heading 文本而非源码行）
        ax: { has: "一级标题 Ramp" }
      - label: H2 在场
        ax: { has: "二级标题 Ramp" }
      - label: H3 在场
        ax: { has: "三级标题 Ramp" }
      - label: H4 在场
        ax: { has: "四级标题 Ramp" }
      - label: H5 在场
        ax: { has: "五级标题 Ramp" }
      - label: H6 在场
        ax: { has: "六级标题 Ramp" }
      - label: 编辑器装载正常（live preview 不动文档文本）
        editor: { unchangedSince: 编辑器基线 }
      - shot: 六级标题阶梯

  - name: 光标在标题行上时显露 # 定界符（M297；打开即光标落于首行行首）
    do: settle
    expect:
      - label: 首行标题的 # 与空格显露为原文（光标落在该行行首那一位——行级含端点相接）
        editor: { has: "# 一级标题 Ramp" }
      - label: 未被触及的第二个标题保持渲染态（判据是行级，不是「文档里有标题就显露」）
        editor: { not: "## 二级标题 Ramp" }
      - shot: 首行标题显露

  - name: 点进编辑器建立渲染层焦点（光标仍在首行标题上）
    do: clickEditor
    dx: 40
    dy: 6
    expect:
      - label: 点进编辑器未改变显露判定（光标仍在标题行上，# 仍在）
        editor: { has: "# 一级标题 Ramp" }

  - name: 移到前台（键盘注入的前台纪律）
    do: focusWindow

  - name: 连续下行离开标题行
    do: keys
    keys: ["Down", "Down", "Down"]
    expect:
      - label: 离开标题行后 # 收回、恢复渲染态
        editor: { not: "# 一级标题 Ramp" }
      - label: 标题文本仍在（收回的只是定界符，内容没被破坏）
        editor: { has: "一级标题 Ramp" }

  - name: 连续上行回到标题行，再次显露
    do: keys
    keys: ["Up", "Up", "Up"]
    expect:
      - label: 回到标题行后 # 重新显露
        editor: { has: "# 一级标题 Ramp" }

  - name: 反向：源码标记串不进入渲染文本流（## 这类标记被替换，不是透显）
    do: settle
    expect:
      - label: 文档 sha256 与 mtime 全程未动（纯渲染场景 MUST NOT 写盘）
        file: { path: headings-ramp.md, unchangedSince: 场景文件, mtimeUnchangedSince: 场景文件 }
teardown:
  - label: 场景结束文档仍是基线（渲染全过程零副作用）
    file: { path: headings-ramp.md, unchangedSince: 场景文件, mtimeUnchangedSince: 场景文件 }
---

## 已知边界

- **字号 / 字重 / 字距 / 块距的逐档读数不在本场景**：计算属性断言归 chromium 结构层
  （`tests/visual/scenes/typography.spec.ts` 的「标题六级阶梯」一条，21/18/16/15/14/13px、
  字重 650、字距 -0.009..0em、块距 24/9…10/4 逐档钉住）。真机套件只证「六级都真的渲染了、
  文档没被渲染过程改写」；观感（阶梯的区分度够不够）归 Alex 看截图。
- **`#` 显露判据的精确口径归 chromium**（M297）：行首 / 行内 / 行尾都显露、相邻行不外溢、
  显露态保留 h1 层级样式——逐位断言在 `tests/visual/scenes/m297-heading-caret-source.spec.ts`。
  真机这侧按「被测功能自己产出的可观测串」判：显露态 `AXTextArea.value` 里出现 `# 一级标题 Ramp`，
  渲染态只有 `一级标题 Ramp`（KimiCU 的 AX 不暴露光标 / 选区，见 README 的「光标/选区不可断言」条）。
- **光标移动那两步依赖键盘注入**：`Down` / `Up` 走 KimiCU 的逐键通道，而该通道间歇整批丢键
  （REVIEW.md 第 11 条）——这两步红了先按丢键复跑一次再判产品缺陷。**不需要任何注入的那一步
  （打开即光标落于文档首、首行标题显露出 `#`）是本场景里最稳的判据**，它与 12-links 的
  「光标停在文档首」同一取向后者的注意：M297 之前该位置的判据是严格重叠、判不中，现在含端点相接，
  所以标题在文档首也会显露——这正是 Alex 报告的那条缺陷。
