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
---

说明：三件套的可断言面不同，这里如实分开——

- **分隔线**：`---` 被 replace widget 顶掉（故 `editor.not` 成立），横线本体是装饰，
  AX 面能读到的是它的读屏名「分隔线」。
- **代码块着色**：AX 不暴露颜色（KimiCU 只给文本层），因此这里只钉「源码逐字保留 +
  未收录语言保持纯文本」，配色由 chromium 视觉门禁
  （`tests/visual/scenes/render-codeblock.spec.ts` 的计算色断言）守，本场景留截图证据。
- **引用内列表**：`> ` 与 `- ` 都被替换，渲染文本里只剩标记 widget 与正文。

「手感/审美」（横线的粗细与留白、代码配色的观感）归 Alex，本场景不下沉。
