// live preview 装饰层样式 —— 走 CM6 theme API（提案 Impact：不碰 src/style.css，vault 波持有）。
// 类名统一 cm-lp-* 前缀。

import { EditorView } from "@codemirror/view";

export const livePreviewTheme = EditorView.theme({
  ".cm-lp-h1": { fontSize: "1.6em", fontWeight: "700", lineHeight: "1.4" },
  ".cm-lp-h2": { fontSize: "1.4em", fontWeight: "700", lineHeight: "1.4" },
  ".cm-lp-h3": { fontSize: "1.25em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-lp-h4": { fontSize: "1.15em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-lp-h5": { fontSize: "1.05em", fontWeight: "600", lineHeight: "1.4" },
  ".cm-lp-h6": { fontSize: "1em", fontWeight: "600", lineHeight: "1.4", color: "#555" },

  ".cm-lp-strong": { fontWeight: "700" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },

  ".cm-lp-quote-line": {
    borderLeft: "3px solid #d5d5d5",
    paddingLeft: "10px",
    color: "#555",
  },

  ".cm-lp-codeblock-line": { backgroundColor: "#f5f5f5" },
  ".cm-lp-inline-code": {
    backgroundColor: "#f0f0f0",
    borderRadius: "3px",
    padding: "0 3px",
    fontSize: "0.92em",
  },

  ".cm-lp-bullet": { color: "#666" },

  // frontmatter properties 区块（块级 replace widget）。
  ".cm-lp-frontmatter": {
    border: "1px solid #e3e3e3",
    borderRadius: "6px",
    padding: "8px 12px",
    margin: "4px 0 12px",
    fontSize: "0.85em",
    backgroundColor: "#fafafa",
  },
  ".cm-lp-fm-table": { borderCollapse: "collapse" },
  ".cm-lp-fm-key": {
    color: "#777",
    paddingRight: "14px",
    verticalAlign: "top",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  ".cm-lp-fm-value": { padding: "1px 0", wordBreak: "break-word" },
  ".cm-lp-tag": {
    display: "inline-block",
    backgroundColor: "#e8ecf3",
    color: "#345",
    borderRadius: "10px",
    padding: "0 8px",
    margin: "1px 4px 1px 0",
    fontSize: "0.92em",
  },
  ".cm-lp-fm-error": {
    color: "#a04500",
    backgroundColor: "#fdf3e7",
    borderRadius: "4px",
    padding: "4px 8px",
    marginBottom: "6px",
  },
  ".cm-lp-fm-raw": {
    margin: "0",
    whiteSpace: "pre-wrap",
    fontFamily: "monospace",
    color: "#666",
  },
  ".cm-lp-fm-empty": { color: "#999" },

  // 附件图片与占位（内联 replace widget，根元素 span）。
  ".cm-lp-image": { display: "inline-block", margin: "6px 0" },
  ".cm-lp-image img": { maxWidth: "100%", borderRadius: "4px", display: "block" },
  ".cm-lp-image-status": { color: "#999", fontSize: "0.85em" },
  ".cm-lp-image-error, .cm-lp-embed-unsupported": {
    display: "inline-block",
    border: "1px dashed #d0a060",
    borderRadius: "4px",
    padding: "4px 10px",
    margin: "2px 0",
    color: "#8a5a00",
    backgroundColor: "#fdf8ef",
    fontSize: "0.85em",
  },
});
