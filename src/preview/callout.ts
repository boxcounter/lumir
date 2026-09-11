// Callout 渲染（foundation-markdown P1，M109）：Obsidian 兼容的 [!type] 语法 ——
// blockquote 首行内容以 [!type] 开头时整块按 callout 呈现（类型色左边条 +
// 浅底色 + 图标/标题行），正文保持普通 blockquote 内容的嵌套 Markdown 装饰
//（行内样式、列表、链接、wikilink 由既有装饰层处理，本模块不重复）。
// 口径：
// - 类型表与别名对齐 Obsidian（note/abstract/info/todo/tip/success/question/
//   warning/failure/danger/bug/example/quote 及各自别名，大小写不敏感）；
// - 未知类型安全降级：渲染为中性色 callout，标题按原文类型名显示 —— 可读、
//   不伪装成已支持的类型，也不静默吞掉标记；
// - 折叠语法 [!type]- / [!type]+ 只解析不折叠（Obsidian 折叠语义延后），
//   折叠符随标记一并隐藏；
// - 装饰只改视图：文档文本不动，选择/复制经 CM copy 通道输出原始 Markdown
// （与其他 replace 装饰同口径，mermaid 已验证）。
// 类型色 token（--callout-{type}）在 style.css 单套排版基线定义，本模块只管结构。
// 本模块顶层不触 DOM，Node 端测试可直接 import。

import { Decoration, WidgetType } from "@codemirror/view";
import type { Range, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// @lezer/common 不是直接依赖（见 lists.ts 同口径），SyntaxNode 类型从 syntaxTree 推导。
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** callout 解析结果：标记替换范围、可选自定义标题范围与显示名。 */
export interface CalloutInfo {
  /** 归一化类型（未知为 "unknown"，对应 style.css 的 --callout-{canonical}）。 */
  canonical: string;
  /** 类型是否在支持表内（未知类型降级渲染时供样式/断言区分）。 */
  known: boolean;
  /** [!type]（含可选折叠符与标题前一个空格）的替换范围。 */
  markerFrom: number;
  markerTo: number;
  /** 自定义标题文本范围；无标题时为 null（widget 渲染默认名）。 */
  titleFrom: number | null;
  titleTo: number | null;
  /** 无自定义标题时的显示名：已知类型为规范名，未知类型为原文类型名。 */
  label: string;
  /** 首行/末行边界（首行加标题行样式、末行收圆角）。 */
  firstLineFrom: number;
  firstLineTo: number;
  lastLineTo: number;
}

// ---------------------------------------------------------------------------
// 类型表：规范类型 + Obsidian 别名（大小写不敏感，存储小写）。
// ---------------------------------------------------------------------------

const CALLOUT_TYPES = new Map<string, { canonical: string; label: string }>();

function register(canonical: string, label: string, aliases: string[]): void {
  for (const name of [canonical, ...aliases]) CALLOUT_TYPES.set(name, { canonical, label });
}

register("note", "Note", []);
register("abstract", "Abstract", ["summary", "tldr"]);
register("info", "Info", []);
register("todo", "Todo", []);
register("tip", "Tip", ["hint", "important"]);
register("success", "Success", ["check", "done"]);
register("question", "Question", ["help", "faq"]);
register("warning", "Warning", ["caution", "attention"]);
register("failure", "Failure", ["fail", "missing"]);
register("danger", "Danger", ["error"]);
register("bug", "Bug", []);
register("example", "Example", []);
register("quote", "Quote", ["cite"]);

// ---------------------------------------------------------------------------
// 解析：blockquote 首行第一个 QuoteMark 之后的内容须以 [!type] 开头。
// [!type] 后允许直接跟折叠符 +/-（解析但不做折叠），再跟可选标题。
// [!foo bar]、[!]、首行无标记的 blockquote 都不是 callout。
// ---------------------------------------------------------------------------

const MARKER_RE = /^( {0,3})\[!([A-Za-z0-9-]+)\]([+-])?/;

/**
 * 判定 Blockquote 节点是否为 callout。非 callout 返回 null（走普通引用样式）。
 * node.from 即 blockquote 首行起点（嵌套 blockquote 亦然：内层节点首个
 * QuoteMark 是内层 >，首行判定天然成立）。
 */
export function detectCallout(doc: Text, node: SyntaxNode): CalloutInfo | null {
  const firstLine = doc.lineAt(node.from);
  const quoteMark = node.getChild("QuoteMark");
  if (!quoteMark || quoteMark.to > firstLine.to) return null;
  const rest = doc.sliceString(quoteMark.to, firstLine.to);
  const m = MARKER_RE.exec(rest);
  if (!m) return null;

  // 首行 QuoteMark 的隐藏装饰吃掉 > 后一个空格（livePreview hideMark），
  // 标记范围从下一个字符起；> 后 2-3 个空格（MARKER_RE 的 ` {0,3}`）时多余
  // 空格并入标记范围随标记一并隐藏，不在图标前残留（M110，M109 review 边角 1）。
  const markerFrom = quoteMark.to + Math.min(m[1].length, 1);
  let markerTo = quoteMark.to + m[0].length;
  const entry = CALLOUT_TYPES.get(m[2].toLowerCase());

  // 标题：标记后空白一个并入标记范围；其余到行尾为标题文本（可为空）。
  let titleFrom: number | null = null;
  let titleTo: number | null = null;
  const after = rest.slice(m[0].length);
  const gap = /^[ \t]+/.exec(after)?.[0].length ?? 0;
  if (after.length > gap) {
    markerTo += gap;
    titleFrom = markerTo;
    titleTo = firstLine.to;
  }

  return {
    canonical: entry?.canonical ?? "unknown",
    known: entry !== undefined,
    markerFrom,
    markerTo,
    titleFrom,
    titleTo,
    label: entry?.label ?? m[2],
    firstLineFrom: firstLine.from,
    firstLineTo: firstLine.to,
    lastLineTo: doc.lineAt(node.to).to,
  };
}

/** 某一行是否属于 callout（相邻空行的块间距判定用）；非 callout 返回 null。 */
export function calloutOnLine(
  tree: ReturnType<typeof syntaxTree>,
  doc: Text,
  lineFrom: number,
): CalloutInfo | null {
  const line = doc.lineAt(lineFrom);
  const offset = line.text.search(/\S/);
  if (offset < 0 || line.text[offset] !== ">") return null;
  let node: SyntaxNode | null = tree.resolveInner(line.from + offset, 1);
  while (node && node.name !== "Blockquote") node = node.parent;
  return node ? detectCallout(doc, node) : null;
}

// ---------------------------------------------------------------------------
// 图标：每规范类型一个极简几何 SVG（stroke=currentColor，随类型色着色）；
// 装饰性内容，aria-hidden。常量字符串，无用户输入，innerHTML 注入安全。
// ---------------------------------------------------------------------------

const SVG_OPEN = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">';
const ICONS: Record<string, string> = {
  note: `${SVG_OPEN}<path d="M9.8 3.2l3 3-7.3 7.3H2.5v-3z"/><path d="M8.8 4.2l3 3"/></svg>`,
  abstract: `${SVG_OPEN}<rect x="3" y="2" width="10" height="12" rx="1"/><path d="M5.5 6h5M5.5 9h5"/></svg>`,
  info: `${SVG_OPEN}<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.3"/><path d="M8 4.7v.2"/></svg>`,
  todo: `${SVG_OPEN}<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5.5 8.2l1.8 1.8 3.2-3.7"/></svg>`,
  tip: `${SVG_OPEN}<path d="M8 2a4 4 0 0 1 4 4c0 1.6-.9 2.5-1.6 3.3-.3.4-.4.7-.4 1.2H6c0-.5-.1-.8-.4-1.2C4.9 8.5 4 7.6 4 6a4 4 0 0 1 4-4z"/><path d="M6.5 13h3"/></svg>`,
  success: `${SVG_OPEN}<circle cx="8" cy="8" r="6"/><path d="M5.3 8.3l1.8 1.8 3.6-4"/></svg>`,
  question: `${SVG_OPEN}<circle cx="8" cy="8" r="6"/><path d="M6.3 6a1.8 1.8 0 1 1 2.6 1.6c-.7.4-.9.8-.9 1.5"/><path d="M8 11v.2"/></svg>`,
  warning: `${SVG_OPEN}<path d="M8 2.3l6 10.7H2z"/><path d="M8 6.5v3"/><path d="M8 11.3v.2"/></svg>`,
  failure: `${SVG_OPEN}<circle cx="8" cy="8" r="6"/><path d="M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6"/></svg>`,
  danger: `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" stroke="none"><path d="M8.8 1.8L3.5 9h3.2l-1 5.2L11.5 7H8.2z"/></svg>`,
  bug: `${SVG_OPEN}<circle cx="8" cy="9.5" r="3.8"/><path d="M8 5.7V4M6.2 4.3L7 6M9.8 4.3L9 6M4.2 8.5h2M13.8 8.5h-2M4.8 12.5l1.6-1M11.2 12.5l-1.6-1"/></svg>`,
  example: `${SVG_OPEN}<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><path d="M2.5 4v.2M2.5 8v.2M2.5 12v.2"/></svg>`,
  quote: `<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" stroke="none"><path d="M3 11.8V8.2C3 5.7 4.4 4 6.6 3.4l.4 1C5.9 4.9 5.3 5.7 5.2 6.7H7v5.1zM8.7 11.8V8.2c0-2.5 1.4-4.2 3.6-4.8l.4 1c-1.1.5-1.7 1.3-1.8 2.3h1.8v5.1z"/></svg>`,
  unknown: `${SVG_OPEN}<path d="M4.5 2.5h7V13.5L8 11 4.5 13.5z"/></svg>`,
};

/** 图标 widget：替换 [!type] 标记；无自定义标题时附带显示名。 */
export class CalloutIconWidget extends WidgetType {
  constructor(
    readonly canonical: string,
    readonly label: string | null,
  ) {
    super();
  }

  eq(other: CalloutIconWidget): boolean {
    return other.canonical === this.canonical && other.label === this.label;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = `cm-lp-callout-icon cm-lp-callout-icon-${this.canonical}`;
    span.innerHTML = ICONS[this.canonical] ?? ICONS.unknown;
    if (this.label !== null) {
      const label = document.createElement("span");
      label.className = "cm-lp-callout-label";
      label.textContent = this.label;
      span.append(label);
    }
    return span;
  }
}

/** callout 首行装饰：标记替换 + 可选标题 mark（由 livePreview 在视口内调用）。 */
export function calloutMarkerDecorations(info: CalloutInfo): {
  marker: Range<Decoration>;
  title: Range<Decoration> | null;
} {
  return {
    marker: Decoration.replace({
      widget: new CalloutIconWidget(info.canonical, info.titleFrom === null ? info.label : null),
    }).range(info.markerFrom, info.markerTo),
    title:
      info.titleFrom !== null && info.titleTo !== null
        ? Decoration.mark({ class: "cm-lp-callout-title" }).range(info.titleFrom, info.titleTo)
        : null,
  };
}
