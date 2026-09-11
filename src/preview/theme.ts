// live preview 装饰层样式 —— 走 CM6 theme API（提案 Impact：不碰 src/style.css，vault 波持有）。
// 类名统一 cm-lp-* 前缀。

import { EditorView } from "@codemirror/view";

export const livePreviewTheme = EditorView.theme({
  ".cm-editor": { color: "var(--text)", backgroundColor: "var(--bg)", fontFamily: "var(--font-body)" },
  ".cm-line.cm-lp-block-separator": { fontSize: "0", lineHeight: "0", height: "0", minHeight: "0" },
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--sel)", color: "var(--selection-ink)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  ".cm-lp-h1": { fontFamily: "var(--font-display)", fontSize: "1.78em", fontWeight: "700", lineHeight: "1.38", letterSpacing: ".01em" },
  ".cm-lp-h2": { fontFamily: "var(--font-display)", fontSize: "1.12em", fontWeight: "700", lineHeight: "1.75", letterSpacing: ".06em" },
  ".cm-lp-h3": { fontFamily: "var(--font-display)", fontSize: "1.08em", fontWeight: "700", lineHeight: "1.5" },
  ".cm-lp-h4": { fontFamily: "var(--font-display)", fontSize: "1.04em", fontWeight: "600", lineHeight: "1.5" },
  ".cm-lp-h5": { fontFamily: "var(--font-display)", fontSize: "1em", fontWeight: "600", lineHeight: "1.5" },
  ".cm-lp-h6": { fontFamily: "var(--font-display)", fontSize: "1em", fontWeight: "600", fontStyle: "italic", lineHeight: "1.5", color: "var(--dim)" },

  ".cm-lp-paragraph": { textAlign: "justify", textJustify: "inter-ideograph", textAutospace: "normal", hyphens: "auto" },
  ".cm-lp-opening": { minHeight: "1.75em" },
  ".cm-lp-opening-end::after": { content: '""', display: "block", clear: "both" },
  ".cm-lp-opening::first-letter": { fontFamily: "var(--font-display)", fontWeight: "700", float: "left", fontSize: "4.35em", lineHeight: ".78", padding: ".09em .14em .14em 0", color: "var(--text)" },
  ".cm-lp-dropcap-selected::first-letter": { backgroundColor: "var(--sel)", color: "var(--selection-ink)" },
  ".cm-lp-frontmatter.cm-lp-frontmatter-selected": { backgroundColor: "var(--sel)", color: "var(--selection-ink)" },
  ".cm-lp-frontmatter.cm-lp-frontmatter-selected *": { backgroundColor: "transparent", color: "var(--selection-ink)" },
  ".cm-lp-strong": { fontWeight: "700" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },

  ".cm-lp-quote-line": {
    borderLeft: "3px solid var(--bd-2)",
    paddingLeft: "10px",
    color: "var(--dim)",
  },

  // callout（Obsidian [!type]，M109）：类型色 token --callout-{type} 在
  // style.css 单套排版基线定义，行装饰经 --callout-c 变量接线；行级浅底色 +
  // 类型色左边条构成整块观感（.cm-line 块级无缝），首/末行补圆角与块内边距。
  // 标题与图标着类型色，正文保持正文色。
  ".cm-line.cm-lp-callout-line": {
    backgroundColor: "color-mix(in srgb, var(--callout-c) var(--callout-tint), var(--bg))",
    borderLeft: "3px solid var(--callout-c)",
    paddingLeft: "10px",
    // 嵌套 callout（引用内嵌 callout）的行同时带外层 quote-line 的
    // color:var(--dim)；callout 正文必须是正文色（M110，M109 review 边角 2）。
    color: "var(--text)",
  },
  ".cm-line.cm-lp-callout-first": { borderRadius: "var(--radius) var(--radius) 0 0", paddingTop: "3px" },
  ".cm-line.cm-lp-callout-last": { borderRadius: "0 0 var(--radius) var(--radius)", paddingBottom: "3px" },
  ".cm-lp-callout-icon": {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    marginRight: "6px",
    color: "var(--callout-c)",
    fontWeight: "600",
    userSelect: "none",
  },
  ".cm-lp-callout-icon svg": { width: "1em", height: "1em", flex: "none" },
  ".cm-lp-callout-title": { fontWeight: "600", color: "var(--callout-c)" },
  // 相邻 callout 之间的空行保留块间距（覆盖 0 高分隔，选择器更具体优先）。
  ".cm-line.cm-lp-block-separator.cm-lp-callout-gap": { height: "10px", minHeight: "10px" },

  ".cm-line.cm-lp-codeblock-line": { backgroundColor: "var(--bg-2)", fontFamily: "var(--font-mono)" },
  ".cm-lp-inline-code": {
    backgroundColor: "var(--bg-2)",
    fontFamily: "var(--font-mono)",
    borderRadius: "3px",
    padding: "0 3px",
    fontSize: "0.92em",
  },

  ".cm-line.cm-lp-list-line": { paddingInlineStart: "var(--lp-list-body)", textIndent: "0" },
  ".cm-line.cm-lp-list-first": { textIndent: "calc(-1 * var(--lp-list-marker))" },
  ".cm-lp-list-marker": { display: "inline-flex", inlineSize: "var(--lp-list-marker)", boxSizing: "border-box", paddingInlineEnd: "1ch", justifyContent: "flex-end", gap: ".5ch", textIndent: "0", whiteSpace: "pre", color: "var(--dim)", fontFamily: "var(--font-mono)", fontSize: ".85em", fontVariantNumeric: "tabular-nums" },
  ".cm-lp-task-marker": { fontFamily: "var(--font-mono)" },

  // frontmatter properties 区块（块级 replace widget）。
  // 纵向间距在 -outer 上用 padding 而非 widget 本体 margin：CM6 测量的 widget
  // 高度是 border-box（不含 margin），margin 对 heightmap 不可见会导致其下
  // 内容 posAtCoords 行映射累计错位（M110 缺陷 1）；外层透明 padding 视觉
  // 等价且计入测量。
  ".cm-lp-frontmatter-outer": { padding: "4px 0 12px" },
  ".cm-lp-frontmatter": {
    border: "1px solid var(--bd-1)",
    borderRadius: "6px",
    padding: "8px 12px",
    margin: "0",
    fontSize: "0.85em",
    backgroundColor: "var(--bg-nav)",
  },
  ".cm-lp-fm-table": { borderCollapse: "collapse" },
  ".cm-lp-fm-key": {
    color: "var(--dim)",
    paddingRight: "14px",
    verticalAlign: "top",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  ".cm-lp-fm-value": { padding: "1px 0", wordBreak: "break-word" },
  ".cm-lp-tag": {
    display: "inline-block",
    backgroundColor: "var(--bg-2)",
    color: "var(--text)",
    borderRadius: "10px",
    padding: "0 8px",
    margin: "1px 4px 1px 0",
    fontSize: "0.92em",
  },
  ".cm-lp-fm-error": {
    color: "var(--accent)",
    backgroundColor: "var(--bg-2)",
    borderRadius: "4px",
    padding: "4px 8px",
    marginBottom: "6px",
  },
  ".cm-lp-fm-raw": {
    margin: "0",
    whiteSpace: "pre-wrap",
    fontFamily: "var(--font-mono)",
    color: "var(--dim)",
  },
  ".cm-lp-fm-empty": { color: "var(--dim)" },

  // 附件图片与占位（内联 replace widget，根元素 span）。
  ".cm-lp-image": { display: "inline-block", margin: "6px 0" },
  ".cm-lp-image img": { maxWidth: "100%", borderRadius: "4px", display: "block" },
  ".cm-lp-image-status": { color: "var(--dim)", fontSize: "0.85em" },
  ".cm-lp-image-error, .cm-lp-embed-unsupported": {
    display: "inline-block",
    border: "1px dashed var(--bd-2)",
    borderRadius: "4px",
    padding: "4px 10px",
    margin: "2px 0",
    color: "var(--accent)",
    backgroundColor: "var(--bg-2)",
    fontSize: "0.85em",
  },

  // wikilink 三态（spec §4.1）：resolved 正常链接 / ambiguous 加歧义标识 /
  // unresolved 未创建样式（虚线下划线 + 暗色，与正常链接视觉可区分，不是错误色）。
  ".cm-lp-wikilink": {
    color: "var(--accent)",
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-lp-wikilink-pending": { fontStyle: "italic", borderBottom: "1px dotted var(--bd-2)" },
  ".cm-lp-wikilink-unresolved": {
    color: "var(--text)",
    textDecoration: "underline dashed",
    textUnderlineOffset: "2px",
  },
  ".cm-lp-wikilink-badge": {
    fontSize: "0.65em",
    color: "var(--accent)",
    border: "1px solid var(--bd-2)",
    borderRadius: "3px",
    padding: "0 3px",
    marginLeft: "3px",
    verticalAlign: "super",
  },

  // math（KaTeX）：公式本体样式走本地打包的 katex.min.css（继承 currentColor，
  // 三套主题自动适配）；此处只补块级容器与失败降级（可读源码 + 明确失败态）。
  ".cm-lp-math-block": { padding: "4px 0", overflowX: "auto" },
  ".cm-lp-math-fallback": {
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--bg-2)",
    color: "var(--accent)",
    borderRadius: "4px",
    padding: "0 4px",
    fontSize: "0.92em",
  },
  ".cm-lp-math-block.cm-lp-math-fallback": { padding: "6px 10px", margin: "0" },
  // 降级块纵向间距走外层透明 padding（heightmap 不可测 margin，同 frontmatter）。
  ".cm-lp-math-fallback-outer": { padding: "4px 0" },
  ".cm-lp-math-error": {
    fontFamily: "var(--font-body)",
    color: "var(--accent)",
    fontSize: "0.85em",
    marginBottom: "4px",
  },
  ".cm-lp-math-raw": { margin: "0", whiteSpace: "pre-wrap", color: "var(--dim)" },

  // mermaid：SVG 居中容器 + 占位与失败降级（口径同 math 降级块）。图表配色
  // 由 mermaid 按主题渲染（见 mermaid.ts themeConfig），此处只管容器。
  ".cm-lp-mermaid": { padding: "4px 0", overflowX: "auto", textAlign: "center" },
  ".cm-lp-mermaid svg": { maxWidth: "100%" },
  ".cm-lp-mermaid-pending": { textAlign: "start", color: "var(--dim)", fontSize: "0.85em", padding: "6px 0" },
  ".cm-lp-mermaid-fallback": {
    textAlign: "start",
    backgroundColor: "var(--bg-2)",
    borderRadius: "4px",
    padding: "6px 10px",
    margin: "0",
  },
  // 降级块纵向间距走外层透明 padding（heightmap 不可测 margin，同 frontmatter）。
  ".cm-lp-mermaid-fallback-outer": { padding: "4px 0" },
  ".cm-lp-mermaid-error": {
    fontFamily: "var(--font-body)",
    color: "var(--accent)",
    fontSize: "0.85em",
    marginBottom: "4px",
  },
  ".cm-lp-mermaid-raw": {
    margin: "0",
    whiteSpace: "pre-wrap",
    fontFamily: "var(--font-mono)",
    color: "var(--dim)",
    fontSize: "0.92em",
  },
});
