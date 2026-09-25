// Callout 渲染（foundation-markdown P1，M109）：Obsidian 兼容的 [!type] 语法 ——
// blockquote 首行内容以 [!type] 开头时整块按 callout 呈现（语义族色条 + 族 tint 底色 +
// 标题行文字），正文保持普通 blockquote 内容的嵌套 Markdown 装饰
//（行内样式、列表、链接、wikilink 由既有装饰层处理，本模块不重复）。
// 口径：
// - 类型表与别名对齐 Obsidian（note/abstract/info/todo/tip/success/question/
//   warning/failure/danger/bug/example/quote 及各自别名，大小写不敏感）；
// - 13 类按**语义族**收敛（change restyle-ui-tokens-v1 的 D2 裁决，映射表 =
//   docs/specs/design-tokens-v1.md §callout 语义收敛 v1.2）：蓝 4（note/abstract/info/
//   todo）/ 绿 2（tip/success）/ 琥珀 2（question/warning）/ 红 3（failure/danger/bug）/
//   灰 2（example/quote）。族在这里登记（`CALLOUT_TYPES` 是本映射的单一来源），色值在
//   theme.ts 的 `.cm-lp-callout-fam-*`（浅色档）与 `:root[data-theme="eink"]` 覆盖块；
// - **无图标**（v1.2 的刻意取舍）：同族类型只靠标题行文字区分——色条与底色只表达语义族，
//   标题行文字是唯一的族内区分手段，因此标签**恒在场**：M218 起为**双段**（中文类型标签
//   650 + 英文类型名 550，定稿 direction-c/index.html:927-943），有自定义标题时再随其后。
//   图标会假扮成「黑白下仍成立的区分手段」，与 eink 的降级口径冲突（tokens 文档 §callout
//   规则 2）；
// - 未知类型安全降级：渲染为中性族 callout，标题按原文类型名显示 —— 可读、
//   不伪装成已支持的类型，也不静默吞掉标记；
// - 折叠语法 [!type]- / [!type]+ 只解析不折叠（Obsidian 折叠语义延后），
//   折叠符随标记一并隐藏；
// - 装饰只改视图：文档文本不动，选择/复制经 CM copy 通道输出原始 Markdown
// （与其他 replace 装饰同口径，mermaid 已验证）。
// 本模块顶层不触 DOM，Node 端测试可直接 import。

import { Decoration, WidgetType } from "@codemirror/view";
import type { Range, Text } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// @lezer/common 不是直接依赖（见 lists.ts 同口径），SyntaxNode 类型从 syntaxTree 推导。
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/**
 * 语义族：与 docs/specs/design-tokens-v1.md §callout 语义收敛（v1.2）的五族一一对应，
 * 取值即 theme.ts 里 `.cm-lp-callout-fam-<family>` 类名的后缀（族 → 色条的映射只在那边）。
 * `neutral` 同时是未知类型的降级族（灰族）。
 */
export type CalloutFamily = "info" | "ok" | "pending" | "danger" | "neutral";

/** callout 解析结果：标记替换范围、可选自定义标题范围与显示名。 */
export interface CalloutInfo {
  /** 归一化类型（未知为 "unknown"）。 */
  canonical: string;
  /** 语义族（色条 / 底色的取值族；同族内只靠标题行文字区分）。 */
  family: CalloutFamily;
  /** 类型是否在支持表内（未知类型降级渲染时供样式/断言区分）。 */
  known: boolean;
  /** [!type]（含可选折叠符与标题前一个空格）的替换范围。 */
  markerFrom: number;
  markerTo: number;
  /** 自定义标题文本范围；无标题时为 null（widget 渲染默认名）。 */
  titleFrom: number | null;
  titleTo: number | null;
  /** 首行/末行边界（首行加标题行样式、末行收圆角）。 */
  firstLineFrom: number;
  firstLineTo: number;
  lastLineTo: number;
  /** 中文类型标签（双段标签的前段，恒在场）：已知类型为 13 类映射表值，未知类型为原文类型名。 */
  zhLabel: string;
  /** 英文类型名（双段标签的后段）：已知类型为归一化小写名；未知类型为 null（只渲染前段）。 */
  enLabel: string | null;
}

// ---------------------------------------------------------------------------
// 类型表：规范类型 + Obsidian 别名（大小写不敏感，存储小写）。
// ---------------------------------------------------------------------------

const CALLOUT_TYPES = new Map<string, { canonical: string; zh: string; family: CalloutFamily }>();

function register(canonical: string, zh: string, family: CalloutFamily, aliases: string[]): void {
  for (const name of [canonical, ...aliases]) CALLOUT_TYPES.set(name, { canonical, zh, family });
}

// 族归属与理由逐类见 tokens 文档 §callout 语义收敛的映射表：abstract / todo 是映射里
// 争议最大的两类（teal 无对应色相 / todo 是常态清单而非紧迫警示），此处按 v1.2 的裁决落。
// 中文类型标签逐类对照定稿原型的 13 类实例（direction-c/index.html:927-943，M216 gap 表
// §2.3 #7 的判据出处）：笔记/摘要/信息/待办/提示/成功/疑问/警告/失败/危险/缺陷/示例/引用。
register("note", "笔记", "info", []);
register("abstract", "摘要", "info", ["summary", "tldr"]);
register("info", "信息", "info", []);
register("todo", "待办", "info", []);
register("tip", "提示", "ok", ["hint", "important"]);
register("success", "成功", "ok", ["check", "done"]);
register("question", "疑问", "pending", ["help", "faq"]);
register("warning", "警告", "pending", ["caution", "attention"]);
register("failure", "失败", "danger", ["fail", "missing"]);
register("danger", "危险", "danger", ["error"]);
register("bug", "缺陷", "danger", []);
register("example", "示例", "neutral", []);
register("quote", "引用", "neutral", ["cite"]);

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
  // 空格并入标记范围随标记一并隐藏，不在类型标签前残留（M110，M109 review 边角 1）。
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
    family: entry?.family ?? "neutral",
    known: entry !== undefined,
    markerFrom,
    markerTo,
    titleFrom,
    titleTo,
    zhLabel: entry?.zh ?? m[2],
    enLabel: entry?.canonical ?? null,
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
// 类型标签 widget：替换 [!type] 标记（含可选折叠符）。
// ---------------------------------------------------------------------------

/**
 * 标签 widget：替换 `[!type]` 源码，渲染**双段类型标签**（M218 C7，定稿
 * direction-c/index.html:927-943 + tokens:335-337）——中文类型标签（650 族色）+
 * 英文类型名（550 正文色），**两段恒在场**：eink 下五族合一后，类型区分完全由
 * 标题行文字承担（同族的 failure/danger/bug 三个红块只能靠文字分辨）。
 * 未知类型降级：只渲染前段、内容为原文类型名——可读、不伪装成已支持的类型。
 */
export class CalloutLabelWidget extends WidgetType {
  // 显式字段而非参数属性：tests/unit 的 Node 类型剥离（strip-only）不支持参数属性，
  // 本模块是单测的直接导入对象（content-restyle.test.ts）。
  readonly zhLabel: string;
  readonly enLabel: string | null;

  constructor(zhLabel: string, enLabel: string | null) {
    super();
    this.zhLabel = zhLabel;
    this.enLabel = enLabel;
  }

  eq(other: CalloutLabelWidget): boolean {
    return other.zhLabel === this.zhLabel && other.enLabel === this.enLabel;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-lp-callout-type";
    const zh = document.createElement("span");
    zh.className = "cm-lp-callout-type-zh";
    zh.textContent = this.zhLabel;
    span.append(zh);
    if (this.enLabel !== null) {
      const en = document.createElement("span");
      en.className = "cm-lp-callout-type-en";
      en.textContent = this.enLabel;
      span.append(en);
    }
    return span;
  }
}

/** callout 首行装饰：标记替换为类型标签 + 可选标题 mark（由 livePreview 在视口内调用）。 */
export function calloutMarkerDecorations(info: CalloutInfo): {
  marker: Range<Decoration>;
  title: Range<Decoration> | null;
} {
  return {
    marker: Decoration.replace({ widget: new CalloutLabelWidget(info.zhLabel, info.enLabel) }).range(info.markerFrom, info.markerTo),
    title:
      info.titleFrom !== null && info.titleTo !== null
        ? Decoration.mark({ class: "cm-lp-callout-title" }).range(info.titleFrom, info.titleTo)
        : null,
  };
}
