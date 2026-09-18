---
id: "20-image-fallback"
item: 20
title: 图片引用的可见回退（svg 正常显示 / 中招形状兜底 / 不可见即占位 / 脚本不执行）
fixtures: [image-fallback.md, image-fallback-normal.svg, image-fallback-percent.svg, image-fallback-empty.png, image-fallback-script.svg]
open: image-fallback.md
marker: "图片引用场景"
steps:
  - name: 渲染态（截图 + 编辑器基线）
    do: recordEditor
    as: doc
    expect:
      - shot: 渲染态
  - name: 磁盘基线
    do: record
    as: diskBase
    file: image-fallback.md
    expect:
      - label: 打开后磁盘文件未被触碰
        file: { path: image-fallback.md, unchangedSince: diskBase }
  - name: 可渲染的两种 svg 真的画出来了
    expect:
      - label: 带 width/height 的 svg 渲染，且该位置保留原始引用串
        ax: { has: "![normal svg](image-fallback-normal.svg)" }
      - label: 该 svg 的内部文本进入 AX 树
        ax: { has: "normal fixture" }
      - label: 中招形状（width=100% + 仅 viewBox）经尺寸兜底后**渲染出成比例的高度**
        ax: { count: { pattern: "/AXImage \\(!\\[percent svg\\]\\(image-fallback-percent\\.svg\\)\\) @[0-9,-]+ [0-9]+×([5-9][0-9]|[1-9][0-9]{2,})/", exact: 1 } }
      - label: 该位置保留原始引用串
        ax: { has: "![percent svg](image-fallback-percent.svg)" }
      - label: 图片行的源码仍被 replace 装饰藏起（节点 1 裁决 A = 维持现状）
        editor: { not: "![percent svg](image-fallback-percent.svg)" }
  - name: 不可见的两处落地可见占位（含原始引用串）
    expect:
      - label: 空位图（读取成功但无可解码内容）给占位，成因中立
        editor: { has: "图片无法显示：![empty bitmap](image-fallback-empty.png)" }
      - label: 目标缺失给占位，成因是读取失败（后端给得出原因）
        editor: { has: "图片读取失败：![missing svg](image-fallback-missing.svg)" }
      - label: 两条占位都不是零高度空白——占位文本本身在 AX 树里各是一个节点
        ax: { has: 'AXStaticText = "图片无法显示：![empty bitmap](image-fallback-empty.png)"' }
      - shot: 占位态
  - name: 安全腿：脚本未执行（与「终态可见」成对，缺一条即退化成负向空转）
    expect:
      - label: 该位置终态可见——含脚本的 svg 内部文本进入 AX 树
        ax: { has: "script fixture" }
      - label: 该位置的原始引用串仍在（配对的正观测）
        ax: { has: "![script svg](image-fallback-script.svg)" }
      - label: 脚本副作用标记未出现（窗口标题未被改写）
        ax: { not: "LUMIR-SVG-SCRIPT-RAN" }
      - label: onload 副作用标记未出现
        ax: { not: "LUMIR-SVG-ONLOAD-RAN" }
  - name: 收尾：文档逐字节不变
    expect:
      - label: 编辑器文本与基线逐字节一致（装饰层不改写文档，ADR 0003 §3）
        editor: { unchangedSince: doc }
      - label: 磁盘文件未被改写
        file: { path: image-fallback.md, unchangedSince: diskBase }
---

说明：本场景覆盖 image-svg-and-fallback 的两条腿——可见回退（正常渲染 / 零尺寸兜底 / 不可见占位）
与 SVG 安全腿里真机可观测的那一半。

- **「不发起外部请求」不在本层判**：套件断言词汇只有 AX 文本 / 编辑器文档 / 磁盘文件 / 诊断日志
  四类，没有网络探针——写在这里只能得到恒真的空转断言。请求腿归 chromium 层
  （`tests/visual/scenes/markdown-combo.spec.ts` 的「SVG 安全腿」，带临时内联实验的反向验证）。
- **「该位置可见」怎么判（这条是本场景最容易写错的地方）**：`<img>` 的 `alt` 与 svg 内部的
  `<text>` 都会进入 AX 树，**而且与渲染尺寸无关**——实测把实现回退成「渲染成 0×0 空白」的那一版，
  `AXGroup (![percent svg](…))` 与 `AXStaticText = "percent fixture"` **照样读得到**（截图里那一段
  是空的，AX 里却有文本）。所以「AX 里有这段文本」**不能**当可见性判据（这正是 REVIEW.md 第 1 条
  的假绿形态）。本场景改用**几何读数**：不带 `<text>` 的 svg 在 AX 树上是一个 `AXImage` 节点，
  节点行里带 `@x,y w×h`——中招形状的断言因此写成「该 AXImage 的 bbox 宽高都非零」，回退成 0×0 时
  该行要么不存在、要么是 `0×0`，断言如实 FAIL（反向验证现场见 PR 说明）。带 `<text>` 的 svg 在 AX
  上是没有 bbox 的 `AXGroup`，因此**不要**用文本节点当尺寸判据。
- **脚本腿的判据是 `document.title`**：fixture 里的脚本与 onload 都试图把标题改成
  `LUMIR-SVG-SCRIPT-RAN` / `LUMIR-SVG-ONLOAD-RAN`；`<img>` 载入上下文按规范关闭脚本执行
  （依据见 `openspec/changes/image-svg-and-fallback/design.md` §4），所以标题应保持 `Lumir`。
  两条负向断言与同一步骤里的两条正观测配对。
- **手感/审美不下沉**：svg 在栏宽内的大小与留白观感归 Alex，本场景只留截图证据。
