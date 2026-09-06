// live preview 装饰层样式 —— 走 CM6 theme API（提案 Impact：不碰 src/style.css，vault 波持有）。
// 类名统一 cm-lp-* 前缀。

import { EditorView } from "@codemirror/view";

export const livePreviewTheme = EditorView.theme({
  ".cm-lp-h1": { fontSize: "1.6em", fontWeight: "700", lineHeight: "1.4" },
  ".cm-lp-h2": { fontSize: "1.4em", fontWeight: "700", lineHeight: "1.4" },
  ".cm-lp-h3": { fontSize: "1.25em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-lp-h4": { fontSize: "1.15em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-lp-h5": { fontSize: "1.05em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-lp-h6": { fontSize: "1em", fontWeight: "600", lineHeight: "1.4", color: "var(--dim)" },

  ".cm-lp-strong": { fontWeight: "700" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },

  ".cm-lp-quote-line": {
    borderLeft: "3px solid var(--bd-2)",
    paddingLeft: "10px",
    color: "var(--dim)",
  },

  ".cm-lp-codeblock-line": { backgroundColor: "var(--bg-2)" },
  ".cm-lp-inline-code": {
    backgroundColor: "var(--bg-2)",
    borderRadius: "3px",
    padding: "0 3px",
    fontSize: "0.92em",
  },

  ".cm-lp-bullet": { color: "var(--dim)" },

  // frontmatter properties 区块（块级 replace widget）。
  ".cm-lp-frontmatter": {
    border: "1px solid var(--bd-1)",
    borderRadius: "6px",
    padding: "8px 12px",
    margin: "4px 0 12px",
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
    fontFamily: "monospace",
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
  ".cm-lp-wikilink-pending": { opacity: "0.6" },
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
});
