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
