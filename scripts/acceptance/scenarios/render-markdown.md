---
id: "render-markdown"
item: 10
title: Markdown 渲染三件套：分隔线 / 代码块着色 / 引用内列表（M138）
fixtures: [render-markdown.md]
open: render-markdown.md
marker: "渲染场景"
steps:
  - name: 分隔线渲染态
    expect:
      - label: 源 `---` 不再以文本形态出现（frontmatter 围栏与分隔线都被替换）
        editor: { not: "---" }
      - label: 分隔线渲染为横线元素（读屏名「分隔线」）
        ax: { has: "分隔线" }
      - shot: 分隔线渲染态
  - name: 代码块着色态
    expect:
      - label: 代码块源码逐字保留（着色不改写文档）
        editor: { has: "fn main() -> i32 { return 42; }" }
      - label: 未收录语言的围栏保持纯文本
        editor: { has: "plain text stays plain" }
      - shot: 代码块着色
  - name: 引用内列表渲染态
    expect:
      - label: 引用内列表标记按常规列表渲染（`- ` 不再显露）
        editor: { not: "- 甲项" }
      - label: 列表项正文在渲染态可见
        editor: { has: "甲项" }
      - label: 嵌套项按层级渲染
        editor: { has: "嵌套一" }
      - shot: 引用内列表
  - name: 写入 toml / yaml 围栏场景文件
    do: vaultWrite
    file: render-toml-yaml.md
    content: |
      # toml / yaml 围栏着色

      ```toml
      [package]
      name = 'lumir'
      enabled = true

      [[hooks]]
      event = 'PreToolUse'
      ```

      ```yaml
      dimensions:
        - name: Goal
          key: goal
          values:
            - Slax Reader
      ```
    expect:
      - label: 场景文件已落到验收 vault
        file: { path: render-toml-yaml.md, has: "[[hooks]]" }
  - name: toml / yaml 围栏着色态
    do: open
    file: render-toml-yaml.md
    marker: "围栏着色"
    expect:
      - label: toml 围栏源码逐字保留（着色不改写文档）
        editor: { has: "event = 'PreToolUse'" }
      - label: yaml 围栏的键与值都在渲染态可读
        editor: { has: "key: goal" }
      - shot: toml / yaml 围栏着色
---

说明：三件套的可断言面不同，这里如实分开——

- **分隔线**：`---` 被 replace widget 顶掉（故 `editor.not` 成立），横线本体是装饰，
  AX 面能读到的是它的读屏名「分隔线」。
- **代码块着色**：AX 不暴露颜色（KimiCU 只给文本层），因此这里只钉「源码逐字保留 +
  未收录语言保持纯文本」，配色由 chromium 视觉门禁
  （`tests/visual/scenes/render-codeblock.spec.ts` 的计算色断言）守，本场景留截图证据。
  toml / yaml / yml 围栏是 M179 补进这套门禁的：本场景把含这两种围栏的短文档写进验收 vault、
  打开并留一张 `shot`，**同样不写颜色断言**——颜色在 AX 树里不存在，写真就等于写恒真断言
  （REVIEW.md 第 1、2 条）。截图归 Alex 过目，配色口径以视觉门禁的计算色断言为准。
  文档内容刻意只用单引号（`lib/ax.mjs` 按引号奇偶判多行 value 的边界，正文里的 `"` 会截断
  AX 文本，见套件 README「已知边界」）。
- **引用内列表**：`> ` 与 `- ` 都被替换，渲染文本里只剩标记 widget 与正文。

「手感/审美」（横线的粗细与留白、代码配色的观感）归 Alex，本场景不下沉。
