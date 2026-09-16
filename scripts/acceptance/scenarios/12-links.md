---
id: "12-links"
item: 12
title: 外链渲染与 ⌘⏎ 打开（含 wikilink 两态）
fixtures: [links.md, links-wiki.md, links-missing.md]
open: links.md
marker: "第一条外链"
steps:
  - name: 渲染态：title↗︎ 上屏、URL 不显露、非外链保持原文
    do: settle
    expect:
      - shot: 渲染态
      - label: 外链渲染成 title + 尾部标记上屏（光标在文档首、不触发源码显露）
        editor: { has: "/第一条外链↗/" }
      - label: 渲染态下 URL 源码不显露
        editor: { not: "example.invalid/alpha" }
      - label: 第二条外链同样渲染（同段落其余文本不受影响）
        editor: { has: "/第二条外链↗/" }
      - label: 相对路径链接保持原文（不装饰、无可开外观）
        editor: { has: "[相对路径](note.md)" }
      - label: 白名单外 scheme 保持原文
        editor: { has: "[别开我](javascript:alert(1))" }
      - label: 渲染不改写文档（磁盘仍是源文件逐字节内容）
        file: { path: links.md, has: "[第一条外链](https://example.invalid/alpha)" }
  - name: 切到「首行是 wikilink」的文档
    do: open
    file: links-wiki.md
    marker: "plain"
    expect:
      - label: wikilink 文档已装载（渲染成 target 名，源码未显露）
        editor: { has: "plain" }
      - label: wikilink 渲染链路未变（源码方括号不显露）
        editor: { not: "[[plain]]" }
  - name: ⌘⏎ 跳转 wikilink（既有链路）
    do: key
    key: "cmd+return"
    expect:
      - shot: wikilink-跳转后
      - label: 跳到目标文件（plain.md 的内容上屏）
        editor: { has: "纯文本基线" }
  - name: 切到「首行是未创建 wikilink」的文档
    do: open
    file: links-missing.md
    marker: "missing-note"
    expect:
      - label: 未创建链接文档已装载
        editor: { has: "missing-note" }
  - name: ⌘⏎ 跟随未创建的 wikilink
    do: key
    key: "cmd+return"
    expect:
      - shot: 未创建链接提示
      - label: 只给提示（不是错误弹窗）
        ax: { has: "未创建的链接" }
      - label: 不自动创建文件（创建必须是作者在提示里的显式动作）
        file: { path: "missing-note.md", exists: false }
      - label: 没有跳到别处（仍在原文档）
        editor: { has: "占位段落" }
  - name: 回到外链文档并确认键盘落点
    do: open
    file: links.md
    marker: "第一条外链"
    expect:
      - label: 回到外链文档
        editor: { has: "/第一条外链↗/" }
  - name: 回前台（⌘⏎ 注入的前台纪律）
    do: focusWindow
    expect:
      - label: 编辑器仍可读（没有 modal 挡住，且窗口已在前台）
        editor: { has: "/第二条外链↗/" }
  - name: ⌘⏎ 开外链（光标在首行的外链上）
    do: key
    key: "cmd+return"
    expect:
      - shot: cmd-enter-之后
      - label: 打开链路没有报错（不在白名单外 / 系统调用失败都各有专属提示）
        ax: { not: "/打不开这类链接|打开链接失败/" }
      - label: 打开外链不改文档
        editor: { has: "/第一条外链↗/" }
      - label: 外链没有多出一条「未创建的链接」提示（外链走打开路径，不进 wikilink 路径）
        # 上一步的未创建提示可能还在（带动作的 toast 挂 8s），所以判「没有第二条」而不是
        # 「一条都没有」——跨步骤的残留是正常现象，不是回归。
        ax: { count: { pattern: "未创建的链接", max: 1 } }
---

外链（标准 Markdown 链接 `[title](url)`）渲染与打开的**行为**判定（M144）。

## 断言口径

- **渲染**：`[title](url)` 渲染为 `title` + 尾部 `↗︎`；URL 源码不显露；相对路径链接与
  白名单外 scheme 保持原文。光标停在文档首（`openDocument` 把选区复位到 0），恰好落在
  首行外链的起点上——该位置**不触发**源码显露（显露判定是选区与链接范围的严格重叠），
  所以渲染态可以直接断言。
- **wikilink 两态**：已解析 → 跳到目标文件（复用既有链路）；未解析 → 只给提示，
  vault 里不出现新文件（既有「创建并打开」入口保留，那是作者的显式动作）。
- **⌘⏎ 开外链放在最后一步**：真机上这条会**真的唤起一次系统默认浏览器**（目标是保留域
  `example.invalid/alpha`，不会加载任何页面），浏览器会抢走前台焦点。放在最后 + 前置
  `focusWindow` 步骤，避免抢焦点影响后续键盘注入。
- **⌘-Click 外链**：**本套件无法表达**。`click` 动作不支持修饰键（`lib/execute.mjs` 的
  click 只有 target/count），且 `scripts/acceptance/lib/**` 不在本 mission 的改动面内。
  该路径由视觉场景 `tests/visual/scenes/render-link.spec.ts` 覆盖（stub 记录
  `open_external_url` 的调用参数，断言开的是哪个 URL 且不真开浏览器）。
- **opener 调用本身**：真机断言本应走诊断日志（Rust 侧 `open_external_url` 落 `link_open`
  事件，字段 `scheme` / `outcome`）。场景**没有**做这条断言——日志文件名是 UTC 日期
  （`<XDG_CONFIG_HOME>/lumir/logs/<UTC 日期>.jsonl`），而验收环境的 `env/` 目录跨天复用
  （`lib/util.mjs` 的 `envHome()` 不带日期），写死日期的 `file` 断言会在后续任何一天读到
  **旧文件**而空过（该文件里本来就有上一次运行写的 `link_open`）——那是断言假绿，比没有
  断言更糟。人工/agent 核对命令（`*` 由 shell 展开，绕开写死日期）：

  ```bash
  grep link_open test-results/acceptance/env/lumir/logs/*.jsonl
  # 期望看到 "scheme":"https" + "outcome":"opened"
  ```

  要让这条也能机验，需给 `file` 断言支持 glob 路径（已投 finding）。

## 环境

隔离 `XDG_CONFIG_HOME` 与合成 vault（`/tmp/lumir-m102-acceptance`），端口
`LUMIR_ACCEPTANCE_PORT`（默认 1430）。本场景会 AXRaise Lumir 抢前台焦点（⌘⏎ 需要前台）。
