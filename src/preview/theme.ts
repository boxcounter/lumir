// live preview 装饰层样式 —— 走 CM6 theme API（提案 Impact：不碰 src/style.css，vault 波持有）。
// 类名统一 cm-lp-* 前缀。
//
// 字体族引用一律走**编辑器作用域**的 token（change typography-and-zoom）：
// `--editor-font-family` / `--editor-mono-family`（声明在 src/style.css 的 :root，缺省分别引用
// 新 token 层的 --font-sans / --font-mono）。标题族随 `--font-display` 删除改 sans——标题不再是
// 另一个族，而是同族的**字重阶梯**（650）；shell（侧栏 / 标题栏 / modeline / 浮层）的规则仍引用
// shell 基线 token，「配置只影响编辑器」因此仍由 token 分层结构性保证。
//
// 取色一律走 token 层（值的唯一权威文本：docs/specs/design-tokens-v1.md）：旧 editorial token
//（--bg / --bg-2 / --bg-3 / --bg-nav / --bd-* / --dim / --callout-* / --selection-ink / --radius）
// 全部退役、不留别名。eink 的组件级覆盖（frontmatter 区白底黑框、wikilink 下划线降级、
// keyword 700）用 `:root[data-theme="eink"] & …` 形式的键表达——CM6 的 buildTheme 把键里的 `&`
// 替换成编辑器主题 class（`@codemirror/view` 的 buildTheme），因此这类选择器能穿透主题作用域。
//
// 字号一律用「阶梯值 ÷ 正文锚」的 em 比值：tokens 文档的字号阶梯（24/21/18/16/15/14/13.5/13/
// 12.5/12/11.5/11/10.5/10，heading-hierarchy-ramp 起 14 档）是**默认 15px 正文锚**下的绝对值。
// 两种写法：无对应 `--fs-*` token 的档位写 `calc(Nem / 15)`；标题六级（h1–h6 有独立 token）写
// `calc(1em * var(--fs-hN) / var(--editor-font-size))`（typed arithmetic，token 单一来源）。
// 两者都既随 `--editor-font-size` 缩放（排版能力放大正文时编辑器内一切字号跟随），又在默认锚下
// **逐像素等于**阶梯值（写成 `0.8667em` 会落到 13.0005px，门禁断言只能退化成区间，那是把精度误差
// 留在制品里）。
// 子元素上的字号（frontmatter 的 chip 在 13px 的值列里）按它自己的父级写 `calc(Nem / 父级px)`。
// 唯一例外是末尾标记——它挂在 `.cm-scroller` 上、不继承正文锚，故显式写
// `calc(var(--editor-font-size) * 0.8)`（backlog #31 的修复，见下）。

import { EditorView } from "@codemirror/view";
import { BINDING_MATCH_CLASS } from "../code-identifiers";
import type { EditorMode } from "../bindings/EditorMode";
import { END_MARKER_VISIBLE_CLASS } from "./endMarker";
import { DOC_TITLE_TOP_CLASS } from "./doc-title";
import { FRONTMATTER_HAS_TITLE_CLASS } from "./frontmatter";

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
 * 又被点亮」糊在一起。取色只用 token 层的既有档位（零新增色值）。
 *
 * 为什么是 `--code-bg`（restyle R2b 的迁移决定）：底纹必须与同屏可能同时出现的三者计算样式都
 * 不同——原生选区（`--sel`）、搜索命中（`.cm-searchMatch` 的 `--accent-tint`）与**当前行底色**
 *（code 模式装了 `highlightActiveLine()`，本 change 起取 `--hover`；旧 token 层是 `--bg-2`）。
 * 旧 `--bg-3`（「比当前行底色再深一档的表面色」）在新 token 层没有第三个灰阶可对应：`--sel`
 * 与原生选区逐字同值（会直接违反「高亮呈现与生命周期」的三层可区分断言）、`--hover` 与当前行
 * 底色同值（M198 的原始缺陷形态）。`--code-bg` 是 code 模式里没有别的消费者的浅灰表面色，
 * 可见且与三者都不撞色。观感归 Alex 手感项。
 */
export const codeBindingTheme = EditorView.theme({
  [`.${BINDING_MATCH_CLASS}`]: { backgroundColor: "var(--code-bg)", borderRadius: "var(--r4)" },
});

export const livePreviewTheme = EditorView.theme({
  ".cm-editor": { color: "var(--text)", backgroundColor: "var(--content-bg)", fontFamily: "var(--editor-font-family)" },
  ".cm-line.cm-lp-block-separator": { fontSize: "0", lineHeight: "0", height: "0", minHeight: "0" },
  // 选中前景：light/dark 不写（继承 --text）；eink 是黑底反白（tokens 文档 eink 规则④）。
  // `--sel-text` 只在 eink 档有定义（见 src/style.css 的 token 区注释），因此它只出现在
  // 下面的 eink 覆盖里。
  ".cm-selectionBackground, ::selection": { backgroundColor: "var(--sel)" },
  [`:root[data-theme="eink"] & .cm-selectionBackground, :root[data-theme="eink"] & ::selection`]: {
    backgroundColor: "var(--sel)",
    color: "var(--sel-text)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
  // 标题层级阶梯（change heading-hierarchy-ramp，稿 A 裁决 2026-09-25）：H1–H6 六级纯字号阶梯
  // 21/18/16/15/14/13，字重全档 650（字重不承担层级），零装饰（H6 的 italic 与 --text-2 退场——
  // italic 对 CJK 是伪斜体，颜色承担层级在 eink 下不成立）。字号经 token 取值：
  // `calc(1em * var(--fs-hN) / var(--editor-font-size))` = 阶梯值 ÷ 当前内容字号 × 1em，
  // 字号步进 / 配置字号变化时六级按同一比值随动（typed arithmetic，双引擎探针实证：
  // webkit + chromium 的 CSS.supports 与计算值都成立）。680 只许出现在 ≥21px 的字号上——
  // H1 21px 取 650 不触这条许可规则。负字距随字号递减（tokens 文档 §字距）：
  // -0.009/-0.007/-0.005/-0.004/-0.002/0em。
  // 标题行高：h1–h3 随正文 1.7（--lh-reading，定稿未给标题单设行高）；h4–h6 保持 --lh-ui
  //（阶梯修订只动字号/字重/字距与装饰退场，行高不在裁决面内）。
  ".cm-lp-h1": { fontSize: "calc(1em * var(--fs-h1) / var(--editor-font-size))", fontWeight: "650", lineHeight: "var(--lh-reading)", letterSpacing: "-0.009em" },
  ".cm-lp-h2": { fontSize: "calc(1em * var(--fs-h2) / var(--editor-font-size))", fontWeight: "650", lineHeight: "var(--lh-reading)", letterSpacing: "-0.007em" },
  ".cm-lp-h3": { fontSize: "calc(1em * var(--fs-h3) / var(--editor-font-size))", fontWeight: "650", lineHeight: "var(--lh-reading)", letterSpacing: "-0.005em" },
  ".cm-lp-h4": { fontSize: "calc(1em * var(--fs-h4) / var(--editor-font-size))", fontWeight: "650", lineHeight: "var(--lh-ui)", letterSpacing: "-0.004em" },
  ".cm-lp-h5": { fontSize: "calc(1em * var(--fs-h5) / var(--editor-font-size))", fontWeight: "650", lineHeight: "var(--lh-ui)", letterSpacing: "-0.002em" },
  ".cm-lp-h6": { fontSize: "calc(1em * var(--fs-h6) / var(--editor-font-size))", fontWeight: "650", lineHeight: "var(--lh-ui)" },

  // 段落左对齐（M216 gap 表 §2.3 #9：定稿是 ragged right，justify + hyphens 是反向偏差）。
  // 段落间距走末行 padding（CM 无 margin 折叠模型：间距阶梯的「段落 8」落在段末行，
  // 类名由 livePreview 按「段落最后一行」加）。
  ".cm-line.cm-lp-paragraph-end": { paddingBottom: "var(--sp-4)" },
  // frontmatter widget 被选区覆盖时的反白（显露态）：底色取 --sel；前景 light/dark 不写，
  // eink 取 --sel-text（同选中态的降级口径）。
  ".cm-lp-frontmatter.cm-lp-frontmatter-selected": { backgroundColor: "var(--sel)" },
  ".cm-lp-frontmatter.cm-lp-frontmatter-selected *": { backgroundColor: "transparent" },
  [`:root[data-theme="eink"] & .cm-lp-frontmatter.cm-lp-frontmatter-selected,
    :root[data-theme="eink"] & .cm-lp-frontmatter.cm-lp-frontmatter-selected *`]: { color: "var(--sel-text)" },
  // 正文强调取 UA 的 700：定稿原型对 .doc-body 内的 <strong> 没有覆盖规则（仍是 UA 的粗体），
  // 故保持 700——650 是标题档、550/600 是「强调不粗」与「半粗」档，都不对应正文强调。
  ".cm-lp-strong": { fontWeight: "700" },
  ".cm-lp-em": { fontStyle: "italic" },
  ".cm-lp-strike": { textDecoration: "line-through" },

  // 引用块（tokens 文档：引用 = 2px 竖线 + text-2；竖线取结构档 --border）。
  // 选择器必须双类 `.cm-line.cm-lp-quote-line`（0,2,0）：CM baseTheme 的
  // `.cm-line { padding: 0 }` 与单类选择器同特异性且注入更晚，会把 paddingLeft
  // 压回 0（backlog:385 登记的实踩；定稿出处 index.html:293-296 的
  // `padding: 2px 0 2px 14px`）。
  ".cm-line.cm-lp-quote-line": {
    borderLeft: "2px solid var(--border)",
    paddingLeft: "var(--sp-7)",
    color: "var(--text-2)",
  },

  // callout（Obsidian [!type]，M109；13 类 → 五族语义色，restyle R2b 的 D2 收敛）：
  // 族归属的单一来源是 callout.ts 的 CALLOUT_TYPES，行装饰按族带 `cm-lp-callout-fam-<族>`
  // 类（livePreview），族 → 色条 / 底色 / 类型标签色的映射只在本块——底色直接取族 tint token，
  // 没有运行期混色（旧口径的混色表达式随 callout 收敛一并退场）。
  // 形态取自定稿（design/prototypes/direction-c 屏 6）：2px 左色条 + 族 tint 底色 +
  // 标题行（类型标签 12.5px/650 族色 + 自定义标题 13px/550 正文色），右侧圆角 r6，
  // 首/末行各补一侧内边距。**不引入图标**（v1.2）：同族类型只靠标题行文字区分。
  // eink：语义色全 #000、tint 全 transparent（规则①）——底色自然落回 `--content-bg` = 白；
  // 灰族的色条取的是 `--text-3`（eink 下是灰），按「色条全黑」的口径在 eink 覆盖块里改黑。
  ".cm-line.cm-lp-callout-line": {
    borderLeft: "2px solid var(--text-3)",
    // 定稿 co padding `6px 12px 7px`（index.html:652）：左右各 12，上下由首/末行补。
    paddingLeft: "var(--sp-6)",
    paddingRight: "var(--sp-6)",
    // co-body 13px（index.html:656）：callout 正文比正文面小一档，行内子元素的字号
    // 按父级 13px 折算（见下方 .cm-lp-inline-code 的补偿与本文件的折算约定）。
    fontSize: "calc(13em / 15)",
    // 嵌套 callout（引用内嵌 callout）的行同时带外层 quote-line 的
    // color:var(--text-2)；callout 正文必须是正文色（M110，M109 review 边角 2）。
    color: "var(--text)",
  },
  ".cm-line.cm-lp-callout-fam-info": { borderLeftColor: "var(--accent)", backgroundColor: "var(--accent-tint)" },
  ".cm-line.cm-lp-callout-fam-ok": { borderLeftColor: "var(--ok)", backgroundColor: "var(--ok-tint)" },
  ".cm-line.cm-lp-callout-fam-pending": { borderLeftColor: "var(--pending)", backgroundColor: "var(--pending-tint)" },
  ".cm-line.cm-lp-callout-fam-danger": { borderLeftColor: "var(--danger)", backgroundColor: "var(--danger-tint)" },
  ".cm-line.cm-lp-callout-fam-neutral": { borderLeftColor: "var(--text-3)", backgroundColor: "var(--agent-bg)" },
  ".cm-lp-callout-fam-info .cm-lp-callout-type": { color: "var(--accent)" },
  ".cm-lp-callout-fam-ok .cm-lp-callout-type": { color: "var(--ok)" },
  ".cm-lp-callout-fam-pending .cm-lp-callout-type": { color: "var(--pending)" },
  ".cm-lp-callout-fam-danger .cm-lp-callout-type": { color: "var(--danger)" },
  ".cm-lp-callout-fam-neutral .cm-lp-callout-type": { color: "var(--text-3)" },
  [`:root[data-theme="eink"] & .cm-line.cm-lp-callout-line`]: { borderLeftColor: "#000", backgroundColor: "#fff" },
  [`:root[data-theme="eink"] & .cm-lp-callout-type`]: { color: "#000" },
  ".cm-line.cm-lp-callout-first": { borderRadius: "0 var(--r6) 0 0", paddingTop: "var(--sp-3)" },
  // 定稿 co padding 下侧 7px（index.html:652，sp 阶梯无 7px 档，写字面值）。
  ".cm-line.cm-lp-callout-last": { borderRadius: "0 0 var(--r6) 0", paddingBottom: "7px" },
  // 类型标签（callout.ts 的 CalloutLabelWidget）：**双段恒在场**（M216 gap 表 §2.3 #7，
  // 定稿 index.html:927-943 实例 + tokens:335-337）——中文类型标签（12.5px/650 族色，
  // .co-type）+ 英文类型名（13px/550 正文色，.co-title），eink 下五族合一后这是唯一的
  // 类型区分手段。父行是 13px 档，两段按父级折算。
  ".cm-lp-callout-type": {
    display: "inline-flex",
    alignItems: "baseline",
    gap: "var(--sp-4)",
    marginRight: "var(--sp-4)",
    userSelect: "none",
  },
  ".cm-lp-callout-type-zh": { fontSize: "calc(12.5em / 13)", fontWeight: "650" },
  ".cm-lp-callout-type-en": { fontSize: "1em", fontWeight: "550", color: "var(--text)" },
  // 自定义标题：13px/550 正文色（父行 13px → 1em），与英文类型名同档同行。
  ".cm-lp-callout-title": { fontSize: "1em", fontWeight: "550", color: "var(--text)" },
  // 行内 code 在 callout 正文里按父级 13px 折算回阶梯的 13px（折算约定见文件头注释）。
  ".cm-line.cm-lp-callout-line .cm-lp-inline-code": { fontSize: "calc(13em / 13)" },
  // 相邻 callout 之间的空行保留块间距（覆盖 0 高分隔，选择器更具体优先）：定稿的
  // callout 外距 4px × 上下两块 = 8px（--sp-4）。
  ".cm-line.cm-lp-block-separator.cm-lp-callout-gap": { height: "var(--sp-4)", minHeight: "var(--sp-4)" },
  // 代码块邻接分隔（M218 C1 阶梯补值，tower 裁决 2026-09-25 的 C6 margin 转换）：容器外距
  // 上 4（--sp-2）/ 下 12（--sp-6）由相邻分隔行高度承担——.cm-lp-codeblock-scroll 是
  // BlockWrapper，CSS margin 对 heightmap 不可见（M110 同族）。与 callout-gap 共存时取
  // 较大值（callout 底色间隔 8 不能被代码块上缘 4 吃掉；代码块下缘 12 > 8 自然胜出）。
  ".cm-line.cm-lp-block-separator.cm-lp-codeblock-gap-before": { height: "var(--sp-2)", minHeight: "var(--sp-2)" },
  ".cm-line.cm-lp-block-separator.cm-lp-codeblock-gap-after": { height: "var(--sp-6)", minHeight: "var(--sp-6)" },
  ".cm-line.cm-lp-block-separator.cm-lp-callout-gap.cm-lp-codeblock-gap-before": { height: "var(--sp-4)", minHeight: "var(--sp-4)" },
  ".cm-line.cm-lp-block-separator.cm-lp-codeblock-gap-before.cm-lp-codeblock-gap-after": {
    height: "calc(var(--sp-2) + var(--sp-6))",
    minHeight: "calc(var(--sp-2) + var(--sp-6))",
  },

  // 代码块（tokens 文档 §字号阶梯「12（doc-meta·代码块·文件路径）」+ §行高「1.55」）：
  // 代码文字 mono 12px/1.55（em 比值 12 ÷ 正文锚 15 = .8），底板 --code-bg。eink 的白底黑框
  // 在横滚容器那一半（src/style.css 的 .cm-lp-codeblock-scroll），此处只管行。
  ".cm-line.cm-lp-codeblock-line": {
    backgroundColor: "var(--code-bg)",
    fontFamily: "var(--editor-mono-family)",
    fontSize: ".8em",
    lineHeight: "var(--lh-code)",
  },
  // 头部条（定稿原型屏 4 的 `.cb-head`）：块的**首行围栏**当头部条排——10.5px（零号档）、
  // 提示档文字色、正字距（tokens 文档 §字距：正字距给大写小标签档，头部条的语言标记同档）。
  // 围栏行是源码：spec 要求「围栏代码块的分隔行与源码保持可选中的原文」，因此这里只改排版
  // 档位、不隐藏任何字符——把语言标记（```js）提到头部条位置读，而不是另造一个 DOM 元素
  // （另造会把同一信息说两遍，且要动块级 widget 的测量路径）。缩进代码块没有围栏行，
  // 也就没有头部条；类名由 livePreview 按「块的首行」加。
  ".cm-line.cm-lp-codeblock-head": {
    fontSize: ".7em",
    letterSpacing: ".03em",
    color: "var(--text-3)",
    paddingBottom: "var(--sp-1)",
  },
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
  // 代码块 token 着色（M138，类名由 preview/code.ts 出）：色值**只**取自 tokens 文档的四个
  // 语法高亮 token（--tk-k/s/n/c），与 editor.ts 的 code 模式 CODE_COLORS 逐 role 同值——
  // 同一段代码在围栏里和整文件打开时读起来是同一门语言（REVIEW.md 第 8 条：两边是同一张
  // role 表（preview/code.ts 的 TOKEN_GROUPS）的两个渲染出口，改一处必须改另一处）。
  // 六个 role 落四个 token：property（json/yaml 的键）与 type 归 keyword 同一色——键的语义是
  // 属性名，与「命名 / 关键字」同族，新体系没有第 5 个色相可用。
  // 键与字符串值必须分色（JSON/YAML 的既有 requirement）：property 取 --tk-k、string 取
  // --tk-s，二者恒不同色；property 不带 keyword 的 600 字重，键与关键字因此仍可辨。
  // eink（规则②）：keyword 字重升到 700，string / number / keyword 同为纯黑——对比由字重与
  // 明度承担；comment 是 --tk-c 的灰（eink 值 #6e6e6e），与代码的明度差照旧成立。
  ".cm-lp-tok-comment": { color: "var(--tk-c)" },
  ".cm-lp-tok-keyword": { color: "var(--tk-k)", fontWeight: "600" },
  ".cm-lp-tok-string": { color: "var(--tk-s)" },
  ".cm-lp-tok-literal": { color: "var(--tk-n)" },
  ".cm-lp-tok-property": { color: "var(--tk-k)" },
  ".cm-lp-tok-type": { color: "var(--tk-k)" },
  [`:root[data-theme="eink"] & .cm-lp-tok-keyword`]: { fontWeight: "700" },
  // 分隔线（M138）：源码被 replace widget 顶掉，横线本体是 0 高 inline-block，
  // 垂直位置靠 vertical-align 定，纵向留白走行 padding（CM 测量的行高不含 margin）。
  // 发丝线取**层次档** --border-soft（tokens 文档 §border 两档：hr / td 底线 / 区块内部分隔
  // 归层次档，结构档留给窗口分区与引用块竖线）；定稿的 hr 外距 20px（--sp-9，
  // index.html:247 `margin: 20px 0`），由上下各 --sp-9 的行 padding 承载。
  ".cm-line.cm-lp-hr-line": { paddingBlock: "var(--sp-9)" },
  ".cm-lp-hr": {
    display: "inline-block",
    inlineSize: "100%",
    blockSize: "0",
    margin: "0",
    border: "0",
    borderTop: "1px solid var(--border-soft)",
    verticalAlign: "middle",
  },
  ".cm-lp-inline-code": {
    backgroundColor: "var(--code-bg)",
    fontFamily: "var(--editor-mono-family)",
    borderRadius: "var(--r5)",
    // 行内补偿（tokens 文档 §收敛规则 3 点名的「wl padding 1px 5px」同组数值）：与 wikilink
    // 药丸同一组内边距，对齐 CJK 行腹，不进间距阶梯。
    padding: "1.5px 5px",
    fontSize: "calc(13em / 15)",
  },

  // 列表（标记测量机制不动，换族与逐级递减的字号档）：标记在正文字族（sans）下右对齐到
  // 正文起点，悬挂缩进由 lists.ts 测量的 `--lp-list-*` 像素值驱动。定稿列表标记体系
  //（index.html:249-277）：ul L1 `–` / L2+ `◦`、ol 复合多级编号（`1.` / `1.1` / `1.5.1`，
  // 生成逻辑在 lists.ts）、标记族 sans（原型 ::before 继承 .doc-body 的正文族）、
  // 字号逐级递减 13.5 / 13 / 12.5（深度 >3 同第三档）。族与三档字号比值与 lists.ts 的
  // canvas 测量是同一组写值的两个落点：改一处必须改另一处（那边注释里互相指向）。
  // 列表项间距「li 2」（定稿 `li { margin: 2px 0 }`，index.html:249）：CM 无 margin
  // 折叠，项间 2px 由每个首行的 padding-top 承载（项间与列表上缘都落在 2px）。
  ".cm-line.cm-lp-list-line": { paddingInlineStart: "var(--lp-list-body)", textIndent: "0" },
  ".cm-line.cm-lp-list-first": { textIndent: "calc(-1 * var(--lp-list-marker))", paddingTop: "2px" },
  ".cm-lp-list-marker": { display: "inline-flex", inlineSize: "var(--lp-list-marker)", boxSizing: "border-box", paddingInlineEnd: "1ch", justifyContent: "flex-end", gap: ".5ch", textIndent: "0", whiteSpace: "pre", color: "var(--text-3)", fontFamily: "var(--editor-font-family)", fontVariantNumeric: "tabular-nums" },
  ".cm-lp-list-marker-d1": { fontSize: "calc(13.5em / 15)" },
  ".cm-lp-list-marker-d2": { fontSize: "calc(13em / 15)" },
  ".cm-lp-list-marker-d3": { fontSize: "calc(12.5em / 15)" },
  ".cm-lp-task-marker": { fontFamily: "var(--editor-mono-family)" },

  // doc-title / doc-meta 块（M218 A1，定稿全 12 张内容屏都含此块，M216 gap 表 §2.2 缺失项）：
  // 24px/680/1.28/-0.012em 标题 + 12px text-3 meta 行（路径 · 行数 · 修改时间，
  // tabular-nums），位置 = fm 区之后正文之前（原型 index.html:238-239 CSS +
  // :871-877 实例 + NOTES.md:45；tokens 锚点 docs/specs/design-tokens-v1.md:124-141）。
  // 两种挂载机制（M222，见 doc-title.ts 文件头）：有 fm 折叠进 fm widget 的 outer、
  // 无 fm 是 scroller 级节点。纵向间距全走 padding（CM 测 widget 高度不含 margin，
  // 同 frontmatter 的 M110 教训）：meta 行与正文之间的 20px 是定稿
  // `.doc-body { margin-top: 20px }`（index.html:241）。
  ".cm-lp-doc-title-outer": { paddingBottom: "var(--sp-9)" },
  ".cm-lp-doc-title": {
    fontSize: "calc(24em / 15)",
    fontWeight: "680",
    lineHeight: "var(--lh-title)",
    letterSpacing: "-0.012em",
  },
  ".cm-lp-doc-meta": {
    display: "flex",
    alignItems: "center",
    gap: "var(--sp-3)",
    marginTop: "7px",
    fontSize: "calc(12em / 15)",
    color: "var(--text-3)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-lp-doc-meta-sep": { color: "var(--border)" },

  // document-top 落点（无 fm，M222 劈叉修复）：doc-title 是 `.cm-scroller` 的首个子元素
  //（grid 第 2 列第 1 行），正文行下移到第 2 行、末尾标记再到第 3 行。机制与不变量见
  // doc-title.ts 文件头——这里只承载几何：
  // - 行尺寸：title 行 max-content、正文行 minmax(0, 1fr)。短文档正文盒填满剩余高度——
  //   「点正文下方空白仍落在 .cm-content 内」的既有行为（endMarker 段注释点名的那条）不变；
  //   末尾标记在场时（长文档）两行都改 max-content，否则正文行被压到可用高度、标记会叠在
  //   溢出正文上（endMarker 段那条隐式行尺寸教训的另一半形态）。
  // - 正文的 32px 上内边距（--sp-11）与横向 44px（--sp-13）转由 title 节点承担，正文
  //   paddingTop 归零——视觉几何与 widget 形态逐项一致：32 / title / 20（--sp-9，上方既有
  //   规则的 paddingBottom）/ 首个内容块。
  // - 字号基准同 endMarker 的 backlog #31 教训：节点不继承 .cm-content 的字号声明，显式落
  //   --editor-font-size，内层的 calc(Nem/15) 才按正文锚解析。
  [`.cm-scroller.${DOC_TITLE_TOP_CLASS}`]: { gridTemplateRows: "max-content minmax(0, 1fr)" },
  [`.cm-scroller.${DOC_TITLE_TOP_CLASS}.${END_MARKER_VISIBLE_CLASS}`]: { gridTemplateRows: "max-content max-content" },
  [`.cm-scroller.${DOC_TITLE_TOP_CLASS} .cm-content`]: { gridRow: "2", paddingTop: "0" },
  [`.cm-scroller.${DOC_TITLE_TOP_CLASS} > .cm-lp-doc-title-outer`]: {
    gridColumn: "2",
    gridRow: "1",
    boxSizing: "border-box",
    minWidth: "0",
    fontSize: "var(--editor-font-size)",
    paddingTop: "var(--sp-11)",
    paddingInline: "var(--sp-13)",
  },
  [`.cm-scroller.${DOC_TITLE_TOP_CLASS}.${END_MARKER_VISIBLE_CLASS} .cm-lp-end-marker`]: { gridRow: "3" },

  // frontmatter properties 区块（块级 replace widget）→ 定稿的 `.fm` 属性区形态
  //（design/prototypes/direction-c 屏 4）：agent-bg 浅底 + r8 圆角 + `8px 14px 9px` 内边距
  //（tokens 文档 §间距阶梯点名的「fm 区 padding」高频出处），置于文档最顶部（widget 只对
  // 文档首部的 --- 区块渲染，位置天然成立）。
  // 纵向间距在 -outer 上用 padding 而非 widget 本体 margin：CM6 测量的 widget
  // 高度是 border-box（不含 margin），margin 对 heightmap 不可见会导致其下
  // 内容 posAtCoords 行映射累计错位（M110 缺陷 1）；外层透明 padding 视觉
  // 等价且计入测量。
  // 块后间距 20px（定稿 `.fm { margin-bottom: 20px }`，index.html:392；M216 gap 表
  // §2.3 #13：旧值 12+4 偏紧）。
  ".cm-lp-frontmatter-outer": { padding: "var(--sp-2) 0 var(--sp-9)" },
  // fm widget 携带 doc-title 时（M222 回归 2 修复，折叠形态）：fm 盒下的 20px 从
  // -outer 的 paddingBottom 挪给 title 的 paddingTop——间距阶梯逐项不变
  //（sp-2 / fm 盒 / 20 / title / 20 / 正文），只是把第二段 20 的承载者换成 title，
  // 这样 title 与 fm 盒之间、title 与正文之间各有 20px，与折叠前完全一致。
  [`.cm-lp-frontmatter-outer.${FRONTMATTER_HAS_TITLE_CLASS}`]: { paddingBottom: "0" },
  ".cm-lp-frontmatter-outer > .cm-lp-doc-title-outer": { paddingTop: "var(--sp-9)" },
  ".cm-lp-frontmatter": {
    borderRadius: "var(--r8)",
    padding: "var(--sp-4) var(--sp-7) 9px",
    margin: "0",
    backgroundColor: "var(--agent-bg)",
  },
  // eink 规则⑤：浅底区块翻转为白底黑框（代码块那一半在 src/style.css 的
  // .cm-lp-codeblock-scroll，同一条规则的两个落点）。
  [`:root[data-theme="eink"] & .cm-lp-frontmatter`]: { backgroundColor: "#fff", border: "1px solid #000" },
  ".cm-lp-fm-table": { borderCollapse: "collapse", width: "100%" },
  // 字段名列：mono 11px（--fs-label 档）+ 提示档灰 + 定宽 `--layout-fm-key-w`（104px，
  // tokens 文档 §布局尺寸）；值列 13px（--fs-ui 档）正文色。两列字号都是绝对值 ÷ 15 的 em，
  // 随 `--editor-font-size` 缩放（原口径是整块 0.85em 相对缩放，故此处逐列显式声明）。
  ".cm-lp-fm-key": {
    width: "var(--layout-fm-key-w)",
    fontFamily: "var(--editor-mono-family)",
    fontSize: "calc(11em / 15)",
    color: "var(--text-3)",
    paddingRight: "var(--sp-7)",
    verticalAlign: "top",
    whiteSpace: "nowrap",
    userSelect: "none",
  },
  // 行内纵向 2.5px（定稿 `.fm-row { padding: 2.5px 0 }`，index.html:394；gap 表 §2.3 #13）。
  ".cm-lp-fm-value": { fontSize: "calc(13em / 15)", color: "var(--text)", padding: "2.5px 0", wordBreak: "break-word" },
  // status 的值不渲染裸字符串，渲染成语义 chip（定稿屏 4：resolved = 绿，与队列「已批准」
  // 同一语义色）。取值 → 语义档的映射表在 CSS 侧（frontmatter.ts 只把原值写进
  // `data-fm-status`，不判语义）：三态 + 中性兜底，取值按真实 vault 抽样
  //（resolved 66 / open 17 / superseded 8 / active 3 / draft 2 / done 2 / brainstorm 2 /
  // spec 1 / proposed 1 / closed 1 …）与队列 chip 的四态对齐；未登记的取值（含中文值）
  // 落中性档，不猜语义。
  ".cm-lp-fm-status": {
    display: "inline-flex",
    alignItems: "center",
    gap: "var(--sp-1)",
    fontSize: "calc(10em / 13)",
    fontWeight: "600",
    borderRadius: "var(--r-pill)",
    padding: "2.5px 8px",
    color: "var(--text-3)",
    backgroundColor: "var(--hover)",
  },
  ".cm-lp-fm-status::before": { content: '""', inlineSize: "5px", blockSize: "5px", borderRadius: "50%", backgroundColor: "currentColor" },
  '.cm-lp-fm-status[data-fm-status="resolved"], .cm-lp-fm-status[data-fm-status="done"], .cm-lp-fm-status[data-fm-status="closed"]': { color: "var(--ok)", backgroundColor: "var(--ok-tint)" },
  '.cm-lp-fm-status[data-fm-status="open"], .cm-lp-fm-status[data-fm-status="active"], .cm-lp-fm-status[data-fm-status="proposed"], .cm-lp-fm-status[data-fm-status="draft"]': { color: "var(--pending)", backgroundColor: "var(--pending-tint)" },
  '.cm-lp-fm-status[data-fm-status="superseded"], .cm-lp-fm-status[data-fm-status="blocked"], .cm-lp-fm-status[data-fm-status="failed"], .cm-lp-fm-status[data-fm-status="rejected"]': { color: "var(--danger)", backgroundColor: "var(--danger-tint)" },
  // eink 规则⑥：chip 描边化（底色退场——tint 在 eink 本就是 transparent；状态语义改由文案 +
  // 圆点承担，颜色档由 token 层的语义色全黑自然给出）。
  [`:root[data-theme="eink"] & .cm-lp-fm-status`]: { backgroundColor: "transparent", border: "1px solid #000" },
  // tags 的 tag 形态：同一套中性 chip 配方（提示档灰 + hover 底 + pill + 10px/600，
  // tokens 文档 §chip 与 §字号阶梯「10（fm 内 chip）」）。
  ".cm-lp-tag": {
    display: "inline-block",
    backgroundColor: "var(--hover)",
    color: "var(--text-3)",
    borderRadius: "var(--r-pill)",
    padding: "2.5px 8px",
    margin: "1px var(--sp-2) 1px 0",
    fontSize: "calc(10em / 13)",
    fontWeight: "600",
  },
  // eink 规则⑥的外推（M216 gap 表 §2.3 #12）：规则口径是「**全部** chip 1px 黑框、
  // 底色退场」，与 fm status chip 同一配方的 tags chip 同规处理。
  [`:root[data-theme="eink"] & .cm-lp-tag`]: { backgroundColor: "transparent", border: "1px solid #000" },
  // 解析失败提示：否定语义取 --danger 文字（tokens 文档 §语义色：danger 是「驳回文字，
  // 不填充」），底用 hover 档；原文照旧完整保留在 .cm-lp-fm-raw（mono / 次级色）。
  ".cm-lp-fm-error": {
    color: "var(--danger)",
    backgroundColor: "var(--hover)",
    borderRadius: "var(--r6)",
    padding: "var(--sp-2) var(--sp-4)",
    marginBottom: "var(--sp-3)",
    fontSize: "calc(12.5em / 15)",
  },
  ".cm-lp-fm-raw": {
    margin: "0",
    whiteSpace: "pre-wrap",
    fontFamily: "var(--editor-mono-family)",
    fontSize: "calc(13em / 15)",
    color: "var(--text-2)",
  },
  ".cm-lp-fm-empty": { fontSize: "calc(13em / 15)", color: "var(--text-3)" },

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
  // 上方 --sp-9（在 .cm-content 自己的 --sp-9 下内边距之后再补一档），下方 --sp-13。
  //
  // **字号基准（backlog #31 的修复）**：标记是 `.cm-scroller` 的子元素，而 `.cm-scroller` 没有
  // 自己的字号声明、只继承 `.cm-editor` 写死的 14px——所以 `0.82em` 量的是 14px 而不是正文锚，
  // 排版能力（change typography-and-zoom）放大正文时标记不跟随（基准分叉）。这里改为显式取
  // `--editor-font-size`（编辑器内容字号的单一来源）乘比值：0.8 = 字号阶梯的 12px「doc-meta」
  // 档，标记与 4em 线段因此都随正文缩放。族不再写（宋体族随 `--font-display` 删除，继承
  // `.cm-editor` 的 --font-sans）；字距收到 tokens 文档 §字距的口径（正字距只给大写小标签档，
  // 取 +0.06em）——旧口径的 0.34em 大字距属已被删除的 editorial 装饰。
  ".cm-lp-end-marker": {
    gridColumn: "2",
    gridRow: "2",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1em",
    paddingBlock: "var(--sp-9) var(--sp-13)",
    fontSize: "calc(var(--editor-font-size) * 0.8)",
    letterSpacing: ".06em",
    color: "var(--text-3)",
    userSelect: "none",
  },
  // 线段：短横线本体 0 高（高度来自 1px border），取色与分隔线同一发丝线 token
  //（层次档 --border-soft；长度 4em 随上面那个字号基准缩放，仍远短于阅读栏宽的一半）。
  // 与 .cm-lp-hr 的结构差别是**双重**的——定宽短线段（不是 inlineSize:100% 的通栏线）+ 夹着文字；
  // 只靠「更短」不够：用户分不清「这条是作者写的分隔」与「这条是应用说完了」。
  ".cm-lp-end-marker-line": { inlineSize: "4em", blockSize: "0", borderTop: "1px solid var(--border-soft)" },
  // 文字：弱化色（提示档）+ 上面的字距——一眼是装饰，不是正文。
  ".cm-lp-end-marker-text": { lineHeight: "1.4" },

  ".cm-lp-image": { display: "inline-block", width: "100%", margin: "var(--sp-3) 0" },
  ".cm-lp-image img": { maxWidth: "100%", borderRadius: "var(--r4)", display: "block" },
  ".cm-lp-image-status": { color: "var(--text-3)", fontSize: "calc(12.5em / 15)" },
  // 失败 / 不支持态：否定语义取 --danger 文字（旧 token 层的 --accent 在旧色板里同时兼任
  // 「链接」与「错误态」，新色板把两者拆开——accent 只留给链接），底取 code 表面档。
  ".cm-lp-image-error, .cm-lp-embed-unsupported": {
    display: "inline-block",
    border: "1px dashed var(--border-soft)",
    borderRadius: "var(--r4)",
    padding: "var(--sp-2) var(--sp-5)",
    margin: "var(--sp-1) 0",
    color: "var(--danger)",
    backgroundColor: "var(--code-bg)",
    fontSize: "calc(12.5em / 15)",
  },

  // wikilink 三态（spec §4.1）：resolved 正常链接 / ambiguous 加歧义标识 /
  // unresolved 未创建样式（虚线下划线 + 正文色，与正常链接视觉可区分，不是错误色）。
  // 形态取自定稿：resolved = accent **药丸**（浅底 tint + r5 + `1px 5px` 行内补偿——tokens
  // 文档 §收敛规则 3 点名的「wl padding」，与行内代码同一组数值），hover 转下划线；
  // **eink 降级为下划线**（规则⑨：浅底药丸在黑白下不成立 → underline + 3px offset，
  // 药丸底与左右补偿一并退场）。
  ".cm-lp-wikilink": {
    color: "var(--accent)",
    backgroundColor: "var(--accent-tint)",
    borderRadius: "var(--r5)",
    padding: "1px 5px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  ".cm-lp-wikilink:hover": { textDecoration: "underline", textUnderlineOffset: "3px" },
  [`:root[data-theme="eink"] & .cm-lp-wikilink`]: {
    backgroundColor: "transparent",
    padding: "0 var(--sp-1)",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
  },
  ".cm-lp-wikilink-pending": { fontStyle: "italic", borderBottom: "1px dotted var(--border-soft)" },
  ".cm-lp-wikilink-unresolved": {
    color: "var(--text)",
    backgroundColor: "transparent",
    textDecoration: "underline dashed",
    textUnderlineOffset: "3px",
  },
  // eink 下未创建态保住虚线（eink 的 wikilink 统一下划线的覆盖不能吃掉歧义 / 未创建这两个
  // 状态标记——它们在黑白下正是靠线型区分的）。
  [`:root[data-theme="eink"] & .cm-lp-wikilink-unresolved`]: { textDecoration: "underline dashed" },
  ".cm-lp-wikilink-badge": {
    fontSize: "calc(10em / 15)",
    color: "var(--accent)",
    border: "1px solid var(--border-soft)",
    borderRadius: "var(--r4)",
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
  // 随 shell 基线配色适配——design §4-3：公式 / mermaid / 图片附件在本版按「继承 currentColor
  // 与底色 token 迁移」处理，不为三主题单独调校）；此处只补块级容器与失败降级
  //（可读源码 + 明确失败态：失败态取否定语义 --danger，底取 code 表面档）。
  ".cm-lp-math-block": { padding: "var(--sp-2) 0", overflowX: "auto" },
  ".cm-lp-math-fallback": {
    fontFamily: "var(--editor-mono-family)",
    backgroundColor: "var(--code-bg)",
    color: "var(--danger)",
    borderRadius: "var(--r5)",
    padding: "0 var(--sp-2)",
    fontSize: "calc(13em / 15)",
  },
  ".cm-lp-math-block.cm-lp-math-fallback": { padding: "var(--sp-3) var(--sp-5)", margin: "0" },
  // 降级块纵向间距走外层透明 padding（heightmap 不可测 margin，同 frontmatter）。
  ".cm-lp-math-fallback-outer": { padding: "var(--sp-2) 0" },
  ".cm-lp-math-error": {
    fontFamily: "var(--editor-font-family)",
    color: "var(--danger)",
    fontSize: "calc(12.5em / 15)",
    marginBottom: "var(--sp-2)",
  },
  ".cm-lp-math-raw": { margin: "0", whiteSpace: "pre-wrap", color: "var(--text-2)" },

  // mermaid：SVG 居中容器 + 占位与失败降级（口径同 math 降级块）。图表配色由
  // mermaid.ts 在 initialize 时读当前主题的 token 计算值（theme: "base" +
  // themeVariables，三主题随色，M219），此处只管容器。
  ".cm-lp-mermaid": { padding: "var(--sp-2) 0", overflowX: "auto", textAlign: "center" },
  ".cm-lp-mermaid svg": { maxWidth: "100%" },
  ".cm-lp-mermaid-pending": { textAlign: "start", color: "var(--text-3)", fontSize: "calc(12.5em / 15)", padding: "var(--sp-3) 0" },
  ".cm-lp-mermaid-fallback": {
    textAlign: "start",
    backgroundColor: "var(--code-bg)",
    borderRadius: "var(--r5)",
    padding: "var(--sp-3) var(--sp-5)",
    margin: "0",
  },
  // 降级块纵向间距走外层透明 padding（heightmap 不可测 margin，同 frontmatter）。
  ".cm-lp-mermaid-fallback-outer": { padding: "var(--sp-2) 0" },
  ".cm-lp-mermaid-error": {
    fontFamily: "var(--editor-font-family)",
    color: "var(--danger)",
    fontSize: "calc(12.5em / 15)",
    marginBottom: "var(--sp-2)",
  },
  ".cm-lp-mermaid-raw": {
    margin: "0",
    whiteSpace: "pre-wrap",
    fontFamily: "var(--editor-mono-family)",
    color: "var(--text-2)",
    fontSize: "calc(13em / 15)",
  },
});
