// live preview 装饰层样式 —— 走 CM6 theme API（提案 Impact：不碰 src/style.css，vault 波持有）。
// 类名统一 cm-lp-* 前缀。
//
// 字体族引用一律走**编辑器作用域**的 token（change typography-and-zoom）：
// `--editor-font-family` / `--editor-mono-family`（声明在 src/style.css 的 :root，缺省分别引用
// 基线的 --font-body / --font-mono）。`--font-display`（标题 / 装饰族）**不在此列**——D3 裁决下
// 标题审美不归本能力，它保持引用 shell 基线 token。shell（左栏 / masthead / 浮层）的规则同样
// 保持引用基线 token，「配置只影响编辑器」因此由 token 分层结构性保证。

import { EditorView } from "@codemirror/view";
import { BINDING_MATCH_CLASS } from "../code-identifiers";
import type { EditorMode } from "../bindings/EditorMode";
import { END_MARKER_VISIBLE_CLASS } from "./endMarker";

/** 代码块折行口径的内容级 class（M180，单一来源）：由 `src/editor.ts` 的 `wrapExtensions` 经
 *  `contentAttributes` 加到 `.cm-content` 上，本文件的样式按它们选择。两个 class 互斥，
 *  按 `editor.code_block_wrap` 取其中一个；它们与 CM 自己的 `cm-lineWrapping` 并列共存
 *  （contentAttributes 的 class 是拼接的），因此选择器带 `.cm-content` 前缀把
 *  `.cm-line.cm-lp-codeblock-line` 的口径从「继承 content」改为「按块类型覆盖」。 */
export const CODEBLOCK_NOWRAP_CLASS = "cm-lp-codeblock-nowrap";

/** 代码块折行为「开」时的内容级 class：`line_wrap = false` 时 `.cm-content` 是 `white-space: pre`，
 *  代码块要折行就得自己把它覆盖回来（否则「文件不折 / 代码块折」这条组合没有落点）。 */
export const CODEBLOCK_WRAP_CLASS = "cm-lp-codeblock-wrap";

/** 折行口径的出厂默认（M180）：与 Rust `EditorConfig::default()` 的 `line_wrap` /
 *  `code_block_wrap` 是同一语义的两份写值（`src-tauri/src/config.rs` 的
 *  `impl Default for EditorConfig` 是那边的真源）。配置到达前（启动早期）按这里的值跑；
 *  两侧各有单测钉住各自的默认值，改一处必须同步另一处（REVIEW.md 第 8 条）。 */
export const DEFAULT_LINE_WRAP = true;
export const DEFAULT_CODE_BLOCK_WRAP = false;

/** 折行口径（M180，D1 裁决 = 应用运行级）：一份值管全部会话。 */
export interface WrapSettings {
  readonly lineWrap: boolean;
  readonly codeBlockWrap: boolean;
}

/** 折行口径的判定结果：两个正交轴各自的结论。 */
export interface WrapSpec {
  /** 正文行：是否装 CM 的 `EditorView.lineWrapping`（把 `.cm-content` 改成 break-spaces）。 */
  readonly lineWrapping: boolean;
  /** 代码块行：要装的内容级 class；`null` = 不装。 */
  readonly codeBlockClass: string | null;
}

/**
 * 「一元素一条规则」的唯一判定点（M180）：代码块行由 `codeBlockWrap` 裁决、其余所有行由
 * `lineWrap` 裁决，两个轴互不改写。判定与装配分开，是为了让四组合能被单测直接断言
 * （装配扩展要 DOM，判定不要）；`src/editor.ts` 的 `wrapExtensions` 据此装扩展。
 *
 * code 模式恒为 `null`：围栏 / 缩进代码块只在 md live preview 里渲染，code 模式没有可作用的
 * 元素——装一个没有消费者的 class 就是假声明（REVIEW.md 第 9 条）。
 */
export function wrapSpec(mode: EditorMode, lineWrap: boolean, codeBlockWrap: boolean): WrapSpec {
  return {
    lineWrapping: lineWrap,
    codeBlockClass: mode !== "md" ? null : codeBlockWrap ? CODEBLOCK_WRAP_CLASS : CODEBLOCK_NOWRAP_CLASS,
  };
}

/**
 * code 模式的「同一变量绑定匹配」底纹（M198，change code-variable-highlight）。
 *
 * 为什么是独立一份 theme 而不是塞进 `livePreviewTheme`：后者**只装在 md 分支**
 *（`src/editor.ts` 的 `modeExtensions`），而本能力按裁决点 4 只做 code 模式——塞进那边的规则
 * 在 code 模式下根本不落地（实现期实测：底纹计算样式读到 `rgba(0, 0, 0, 0)`）。
 *
 * 只加底纹、**不改字色**：code 模式的字色已被 token 着色占满，再改字色会让「这个字既是关键字
 * 又被点亮」糊在一起。取色只用既有 token（零新增色值）。
 *
 * 为什么是 `--bg-3` 而不是 design §5.1 推荐的 `--bg-2`：code 模式的**当前行底色就是 `--bg-2`**
 *（`src/editor.ts` 的 `.cm-activeLine`，code 分支装了 `highlightActiveLine()`），因此 `--bg-2`
 * 的底纹在用户刚双击的那一行上**完全隐形**——同一行上的第二处匹配也一起看不见。`--bg-3`
 *（`src/style.css:6` 的既有 token，此前只被 `.tab-close:hover` 用）在当前行与普通行上都可见，
 * 且与原生选区（`--sel`）／搜索命中（accent 淡底）的计算样式互不相同。观感归 Alex 手感项。
 */
export const codeBindingTheme = EditorView.theme({
  [`.${BINDING_MATCH_CLASS}`]: { backgroundColor: "var(--bg-3)", borderRadius: "2px" },
});

export const livePreviewTheme = EditorView.theme({
  ".cm-editor": { color: "var(--text)", backgroundColor: "var(--bg)", fontFamily: "var(--editor-font-family)" },
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

  ".cm-line.cm-lp-codeblock-line": { backgroundColor: "var(--bg-2)", fontFamily: "var(--editor-mono-family)" },
  // 代码块折行口径（M180，一元素一条规则）：围栏 / 缩进代码块行由 editor.code_block_wrap
  // 裁决、与 editor.line_wrap 无关，故两个内容级 class 由 editor.ts 的 wrapExtensions 经
  // contentAttributes 加到 .cm-content 上（与 CM 自己的 cm-lineWrapping 并列共存）。
  // 选择器带 .cm-content 前缀（0,3,0）压过基础主题的 .cm-lineWrapping（0,2,0）——
  // 「不折行」要把继承下来的 break-spaces / overflow-wrap:anywhere 一起压回 pre / normal，
  // 只改 white-space 不够（overflow-wrap 是继承属性，会把 pre 的长行再切碎）。
  [`.cm-content.${CODEBLOCK_NOWRAP_CLASS} .cm-line.cm-lp-codeblock-line`]: {
    whiteSpace: "pre",
    wordBreak: "normal",
    overflowWrap: "normal",
  },
  // 「文件不折行 + 代码块折行」这条组合的落点：.cm-content 落回 white-space: pre 时，
  // 代码块要自己把折行口径覆盖回来。
  [`.cm-content.${CODEBLOCK_WRAP_CLASS} .cm-line.cm-lp-codeblock-line`]: {
    whiteSpace: "break-spaces",
    wordBreak: "break-word",
    overflowWrap: "anywhere",
  },
  // 代码块 token 着色（M138，类名由 preview/code.ts 出）：色值与 editor.ts 的
  // code 模式 codeHighlight 同一套 editorial token——同一段代码在围栏里和整文件
  // 打开时读起来是同一门语言。
  ".cm-lp-tok-comment": { color: "var(--dim)" },
  ".cm-lp-tok-keyword": { color: "var(--accent)" },
  ".cm-lp-tok-string": { color: "var(--callout-tip)" },
  ".cm-lp-tok-literal": { color: "var(--callout-warning)" },
  ".cm-lp-tok-property": { color: "var(--callout-note)" },
  ".cm-lp-tok-type": { color: "var(--callout-abstract)" },
  // 分隔线（M138）：源码被 replace widget 顶掉，横线本体是 0 高 inline-block，
  // 垂直位置靠 vertical-align 定，纵向留白走行 padding（CM 测量的行高不含 margin）。
  // 中性色暖发丝线——与表格边框同一 token，符合「borders recede to warm hairlines」
  // 的设计基线；朱红留给链接与错误态。
  ".cm-line.cm-lp-hr-line": { paddingBlock: "0.62em" },
  ".cm-lp-hr": {
    display: "inline-block",
    inlineSize: "100%",
    blockSize: "0",
    margin: "0",
    border: "0",
    borderTop: "1px solid var(--bd-2)",
    verticalAlign: "middle",
  },
  ".cm-lp-inline-code": {
    backgroundColor: "var(--bg-2)",
    fontFamily: "var(--editor-mono-family)",
    borderRadius: "3px",
    padding: "0 3px",
    fontSize: "0.92em",
  },

  ".cm-line.cm-lp-list-line": { paddingInlineStart: "var(--lp-list-body)", textIndent: "0" },
  ".cm-line.cm-lp-list-first": { textIndent: "calc(-1 * var(--lp-list-marker))" },
  ".cm-lp-list-marker": { display: "inline-flex", inlineSize: "var(--lp-list-marker)", boxSizing: "border-box", paddingInlineEnd: "1ch", justifyContent: "flex-end", gap: ".5ch", textIndent: "0", whiteSpace: "pre", color: "var(--dim)", fontFamily: "var(--editor-mono-family)", fontSize: ".85em", fontVariantNumeric: "tabular-nums" },
  ".cm-lp-task-marker": { fontFamily: "var(--editor-mono-family)" },

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
    fontFamily: "var(--editor-mono-family)",
    color: "var(--dim)",
  },
  ".cm-lp-fm-empty": { color: "var(--dim)" },

  // 附件图片与占位（内联 replace widget，根元素 span）。
  // `width: 100%` 是图片显示宽度不变量（M182）的机制落点，不是观感调参：包装盒是 img 的
  // 包含块，img 的 `max-width: 100%` 与「固有比例图按包含块填充」两条都相对它解析。包装盒
  // 若是 shrink-to-fit（`width: auto`），它的宽度就由**在场内容**决定——加载中状态块的文本
  // 宽度会先把包装盒钉死（≈ 半栏宽），图片字节到达后填充这个宽度并被 `settle` 判为可见，
  // 终态就停在状态块宽度上；缓存命中的重开走同步 settle（首帧布局里没有状态块），包装盒
  // 按图片自己算，于是收敛到栏宽。两个终态由「布局时状态块在不在场」决定 —— 正是本不变量
  // 禁止的时序依赖。给包装盒一个与在场内容无关的确定宽度（栏宽）后，两条路径的包含块相同，
  // 终态必然一致；图片本身仍按固有宽度 + `max-width: 100%` 渲染，小图不拉伸。
  // 正文末尾的「到底了」标记（document-end-marker）：与正文同列、紧随内容之下的 chrome。
  // 元素挂在 .cm-scroller 上（与 .cm-content 同级，装配见 src/preview/endMarker.ts），
  // 因此不进 CM 的 DOM 观察子树 / heightmap / 按视口增量构建的装饰层；显隐是**在场与否**，
  // 由 endMarker.ts 的判据决定（一屏装得下时元素不在 DOM 里）。
  //
  // 滚动容器的隐式行尺寸：`.cm-content` 带 `min-height: 100%`（CM 基础主题），在滚动容器
  // 只有一行时它的隐式行会被压到可用高度（行贡献算成 0）——正文其实溢出在行外，于是任何
  // 「正文之下的行」都会叠在正文上而不是排在它后面。标记在场时把行尺寸改成 max-content，
  // 第 2 行才真的落在正文内容盒之后。这条口径**只在标记在场时生效**：一屏装得下的文档与
  // code 模式不加这个 class，行尺寸与视觉都保持原样（那里「点正文下方空白仍落在 .cm-content
  // 内」这类既有行为不能变）。
  [`.cm-scroller.${END_MARKER_VISIBLE_CLASS}`]: { gridAutoRows: "max-content" },
  // 纵向间距一律走 padding（CM 测量的高度不含 margin，见下方 frontmatter 段的 M110 教训）：
  // 标记上方那段呼吸来自 .cm-content 自己的 44px 下内边距，下方补对称的 44px。
  ".cm-lp-end-marker": {
    gridColumn: "2",
    gridRow: "2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1em",
    paddingBlock: "0 44px",
    fontFamily: "var(--font-display)",
    fontSize: "0.82em",
    letterSpacing: ".34em",
    color: "var(--dim)",
    userSelect: "none",
  },
  // 线段：短横线本体 0 高（高度来自 1px border），取色与分隔线同一发丝线 token。
  // 与 .cm-lp-hr 的结构差别是**双重**的——定宽短线段（不是 inlineSize:100% 的通栏线）+ 夹着文字；
  // 只靠「更短」不够：用户分不清「这条是作者写的分隔」与「这条是应用说完了」。
  ".cm-lp-end-marker-line": { inlineSize: "4em", blockSize: "0", borderTop: "1px solid var(--bd-2)" },
  // 文字：弱化色 + 宋体族（与标题同族，--font-display）+ 上面的字距——一眼是装饰，不是正文。
  ".cm-lp-end-marker-text": { lineHeight: "1.4" },

  ".cm-lp-image": { display: "inline-block", width: "100%", margin: "6px 0" },
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

  // 标准链接（M144 外链、M145 全形态）：`[title](target)` 渲染为 title + 尾部标记
  //（↗︎ 会离开本应用 / → 应用内跳转），括号与目标源码被 replace 隐藏（装饰不改文档，
  // ADR 0003 §3）。链接色沿用 wikilink 的 accent——设计基线是「朱红留给链接与错误态」。
  ".cm-lp-link": { color: "var(--accent)", cursor: "pointer" },
  ".cm-lp-link-mark": {
    color: "var(--accent)",
    fontSize: "0.8em",
    marginLeft: "2px",
    verticalAlign: "super",
    userSelect: "none",
  },

  // math（KaTeX）：公式本体样式走本地打包的 katex.min.css（继承 currentColor，
  // 随 shell 基线配色适配）；此处只补块级容器与失败降级（可读源码 + 明确失败态）。
  ".cm-lp-math-block": { padding: "4px 0", overflowX: "auto" },
  ".cm-lp-math-fallback": {
    fontFamily: "var(--editor-mono-family)",
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
    fontFamily: "var(--editor-font-family)",
    color: "var(--accent)",
    fontSize: "0.85em",
    marginBottom: "4px",
  },
  ".cm-lp-math-raw": { margin: "0", whiteSpace: "pre-wrap", color: "var(--dim)" },

  // mermaid：SVG 居中容器 + 占位与失败降级（口径同 math 降级块）。图表配色
  // 由 mermaid.ts 固定渲染（default 主题 + 透明背景），此处只管容器。
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
    fontFamily: "var(--editor-font-family)",
    color: "var(--accent)",
    fontSize: "0.85em",
    marginBottom: "4px",
  },
  ".cm-lp-mermaid-raw": {
    margin: "0",
    whiteSpace: "pre-wrap",
    fontFamily: "var(--editor-mono-family)",
    color: "var(--dim)",
    fontSize: "0.92em",
  },
});
