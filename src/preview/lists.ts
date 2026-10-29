import { forceParsing, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { StateEffect } from "@codemirror/state";
import type { EditorState, Line, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { EDITOR_FONT_FAMILY_TOKEN } from "../typography";
import { pointerPressFrame, revealSelection } from "./reveal-gate";
import { t } from "../copy";

type Node = ReturnType<typeof syntaxTree>["topNode"];
type Tree = ReturnType<typeof syntaxTree>;
interface Group { width: number; body: number; depth: number; labels: ReadonlyMap<number, string> }
const isList = (node: Node) => node.name === "BulletList" || node.name === "OrderedList";

/** 单行的列表归属分析：行首内容列（引用前缀之后）与语法树归属。
 *
 *  `ListLayout.build()` 与本模块的单测（tests/unit/list-lazy-continuation.test.ts）共用这一份
 *  判定——同语义不得两处写值（REVIEW.md 「同一语义两处真源」条）。纯函数：只读解析树与行文本，不碰 view /
 *  坐标 / 装饰，判定因此与光标位置无关（合同 docs/specs/lists.md 的 L3）。 */
export interface ListLineInfo {
  /** 行首内容列（跳过全部连续 `>` 与紧随空格后的首个非空白）；全空白行 -1。 */
  readonly offset: number;
  /** 语法树归属的 ListItem（行内容解析进列表项时）；否则 null。 */
  readonly item: Node | null;
  /** 本行携带该 ListItem 的 marker（marker 与内容同行）。 */
  readonly first: boolean;
  /** 本行是否按列表项行渲染（加 `cm-lp-list-line` / 吞掉行首源码空白）。
   *
   *  非首行 + 行首无源码空白（文档第 1 列即非空白，`offset === 0`）+ 解析进项内段落
   *  = CommonMark 的 **lazy continuation**：按顶层段落渲染在行首（MUST NOT 继承
   *  `--lp-list-body`），与 Obsidian live preview 编辑层一致（合同 L1）；带源码缩进的
   *  真续行与项首行渲染不变（L2）。 */
  readonly rendered: boolean;
}

export function listLineInfo(tree: Tree, doc: Text, line: Line): ListLineInfo {
  let offset = line.text.search(/\S/);
  if (offset >= 0 && line.text[offset] === ">") {
    // 引用内的列表（M138）：行首是引用标记时内容位置在标记之后，扫过全部连续 `>` 与紧随
    // 的空格后按常规列表判定——引用内的列表与正文里的列表同一套标记 widget、同一套等宽
    // 序号与正文缩进。此前只有 callout（M109）放开这一路径，普通引用的列表停在源码态；
    // 放开后 callout 与普通引用走同一分支（callout 本就是 blockquote），嵌套引用
    // `> > ` 也自然按最内层内容起点解析。
    let content = offset;
    while (line.text[content] === ">") {
      content++;
      while (content < line.text.length && line.text[content] === " ") content++;
    }
    if (content < line.text.length) offset = content;
  }
  if (offset < 0) return { offset, item: null, first: false, rendered: false };
  let node: Node | null = tree.resolveInner(line.from + offset, 1);
  let body = false;
  while (node && node.name !== "ListItem") {
    if (["FencedCode", "CodeBlock", "HTMLBlock", "Table", "Blockquote"].includes(node.name)) break;
    if (node.name === "Paragraph" || node.name === "Task") body = true;
    node = node.parent;
  }
  if (node?.name !== "ListItem" || !node.parent || !isList(node.parent)) {
    return { offset, item: null, first: false, rendered: false };
  }
  const mark = node.getChild("ListMark");
  const first = mark !== null && doc.lineAt(mark.from).from === line.from;
  return { offset, item: node, first, rendered: first || (body && offset > 0) };
}

/** 行首列表 marker 的文本级解析结果。
 *
 *  裸 marker 行是合法列表标记位于行首、标记后只有空白到行尾（空项）或带内容但语法树不接管
 * （lazy continuation），且语法树未把它认作列表项首行的形态。典型形态 `para\n1. `：空列表项
 *  按 CommonMark 不能打断段落，行被解析进段落，既有渲染与 Enter 续行都不认它；Alex
 *  2026-10-12 dogfood 裁决：该行在光标驻留时按列表项渲染、Enter 按列表语义分派（实现见
 *  src/enter-indent.ts 与 ListLayout.build 的裸行分支）。`bareListMarkerLine` 在这一份之上
 *  加树侧排除：判定是 `listLineInfo` 的**补集**而非替代，语法树已认作项首行（真列表，含
 *  空行后的 `1. `、`- `、引用内 `> 1. `、列表自身的空续项）一律不看——那些形态既有渲染与
 *  M399 退出行为已覆盖，同语义不得两处抢（REVIEW.md「同一语义两处真源」条）。排除面：
 *  setext 标题下线（`para\n- ` 的 `- `，与 Obsidian 同口径交给标题语义）、围栏 / 缩进代码块、
 *  HTMLBlock、表格——那些上下文里 marker 形文本不是列表。 */
export interface ListMarkerText {
  /** marker 起点（绝对位，= 行首 + 前缀宽）。 */
  readonly markerFrom: number;
  /** marker 终点（绝对位，`.` / `)` 之后）。 */
  readonly markerTo: number;
  /** 内容起点（marker 后空白之后；空项时 = 行尾）。 */
  readonly contentFrom: number;
  /** marker 字面文本（`1.` / `2)` / `-` / `+` / `*`）。 */
  readonly marker: string;
  readonly ordered: boolean;
  /** 有序：数字部分；无序：null。 */
  readonly number: number | null;
  /** 有序：分隔符 `.` / `)`；无序：空串。 */
  readonly delimiter: string;
  /** 引用前缀 + 行首缩进的原文（续行时原样复用）。 */
  readonly prefix: string;
}

const BARE_MARKER_RE = /^((?:>[ \t]*)*)([ \t]*)((\d{1,9})([.)])|([-+*]))([ \t]+)(.*)$/;

/** 从任意文本起点解析「行首列表 marker」：可选引用前缀 + 行首缩进 + 一个合法列表标记 +
 *  其后空白。`from` 是文本在文档里的起点（行首时 = `line.from`）。纯文本形态级：不读语法树，
 *  围栏 / 表格 / 标题等上下文由调用方各自排除。 */
export function markerTextAt(text: string, from = 0): ListMarkerText | null {
  const m = BARE_MARKER_RE.exec(text);
  if (!m) return null;
  const prefix = m[1] + m[2];
  const markerFrom = from + prefix.length;
  const markerTo = markerFrom + m[3].length;
  const ordered = m[4] !== undefined;
  return {
    markerFrom,
    markerTo,
    // 内容起点钳到文本末尾：空项行（`2. `）的 contentFrom = 文本末位。
    contentFrom: Math.min(markerTo + m[7].length, from + text.length),
    marker: m[3],
    ordered,
    number: ordered ? Number(m[4]) : null,
    delimiter: ordered ? m[5] : "",
    prefix,
  };
}

/** 裸 marker 行判定：null = 不是（含语法树已接管的全部形态）。纯函数，只读树与行文本。 */
export function bareListMarkerLine(tree: Tree, doc: Text, line: Line): ListMarkerText | null {
  // 文本级形态（marker 字面 / 位置 / 前缀）取 markerTextAt 这一份，本函数只加树侧排除。
  const marker = markerTextAt(line.text, line.from);
  if (marker === null) return null;
  // resolve 取 marker 内的位置（markerFrom 的右邻 = marker 首字符），向上排除非列表上下文。
  let node: Node | null = tree.resolveInner(marker.markerFrom, 1);
  for (; node; node = node.parent) {
    const name = node.name;
    if (
      name === "FencedCode" || name === "CodeBlock" || name === "HTMLBlock" ||
      name === "Table" || name.startsWith("SetextHeading") || name.startsWith("ATXHeading") ||
      name === "HeaderMark"
    ) {
      return null;
    }
    if (name === "Document") break;
  }
  // 真源唯一：语法树已把本行认作列表项首行时，既有路径（渲染 + M399 退出）接管。
  const info = listLineInfo(tree, doc, line);
  if (info.item !== null && info.first) return null;
  return marker;
}

/** 一行的列表渲染判定，以及随之被 replace 掉的源码区间。
 *
 *  `ListLayout.build()` 与水平移动（`src/editor.ts` 的 `horizontalTarget` 经
 *  `listHiddenRangeAt`）、几何（`ListMarker.coordsAt`）共用这一份判定：藏了哪段源码、
 *  为什么藏，只有这里写一次（REVIEW.md 「同一语义两处真源」条）。纯函数，只读树与行文本。
 *
 *  `editing` 只对裸 marker 行有意义（合同 docs/specs/lists.md 的 B1：判据选区与该行相接
 *  才按列表项首行渲染）；真列表项（`info.rendered && info.item`）恒按列表行渲染，不看它。 */
export interface ListLineRender {
  /** 按真实列表项渲染的那一份判定；null = 不是项首行 / 真续行。 */
  readonly info: ListLineInfo | null;
  /** 裸 marker 行的编辑态判定（M461）；null = 不是裸行、或不在编辑态。 */
  readonly bare: ListMarkerText | null;
  /** 被 replace 掉的源码区间（marker + 尾随空白、或续行行首缩进）；null = 本行不隐藏源码。 */
  readonly hidden: { readonly from: number; readonly to: number } | null;
}

export function listLineRender(tree: Tree, doc: Text, line: Line, editing: boolean): ListLineRender {
  const info = listLineInfo(tree, doc, line);
  if (info.rendered && info.item) {
    const mark = info.item.getChild("ListMark");
    if (info.first && mark) {
      const task = info.item.getChild("Task")?.getChild("TaskMarker");
      let end = task?.to ?? mark.to;
      while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
      return { info, bare: null, hidden: { from: line.from, to: end } };
    }
    if (info.offset > 0) return { info, bare: null, hidden: { from: line.from, to: line.from + info.offset } };
    return { info, bare: null, hidden: null };
  }
  if (editing) {
    const bare = bareListMarkerLine(tree, doc, line);
    if (bare) return { info: null, bare, hidden: { from: line.from, to: bare.contentFrom } };
  }
  return { info: null, bare: null, hidden: null };
}

/** 判据选区是否与行范围相接（含端点）——裸 marker 行的编辑态门控（B1）。
 *  `ListLayout.build()` 与水平移动的原子步判定共用这一份（与 `revealSelection` 同一选区口径，
 *  按压窗口内取快照：M259 / M461）。 */
export function lineTouchesSelection(state: EditorState, line: Line): boolean {
  return revealSelection(state).ranges.some((r) => r.from <= line.to && r.to >= line.from);
}

/** 水平移动落在列表隐藏区间内部时的钳制落点（合同 docs/specs/editor-caret.md 的 C6：
 *  隐藏源码区间是一个原子步）。`pos` 严格落在区间内部才钳制——与 CM `atomicRanges` 的
 *  `skipAtomicRanges` 同口径（`from < pos < to`）：边界位本身是可见的停靠点，不移动。
 *  返回 null = 不在任何隐藏区间内，调用方保留原落点。 */
export function listHiddenRangeAt(state: EditorState, pos: number, forward: boolean): number | null {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  const hidden = listLineRender(syntaxTree(state), doc, line, lineTouchesSelection(state, line)).hidden;
  if (!hidden || pos <= hidden.from || pos >= hidden.to) return null;
  return forward ? hidden.to : hidden.from;
}

/** ol 复合多级编号（定稿 direction-c/index.html:250-270 的 counter 拼接）：L1 `1.`、
 *  L2 `1.1`、L3 `1.5.1`——只有第一层带尾点。`prefix` 是父项的复合编号（仅当父列表
 *  也是 ol；父列表是 ul 时链条断开，本项从自己起编号）。父编号深层不带尾点，
 *  拼 stem 时按有无尾点两种形态都归一到「无尾点再拼」。 */
export function orderedItemLabel(prefix: string | null, index: number): string {
  if (prefix === null) return `${index}.`;
  const stem = prefix.endsWith(".") ? prefix.slice(0, -1) : prefix;
  return `${stem}.${index}`;
}

/** ul 标记 glyph（定稿 index.html:271-277）：L1 `–`（en dash）、L2 及更深 `◦`。 */
export function bulletGlyph(depth: number): string {
  return depth <= 1 ? "–" : "◦";
}

/** 两份编号表逐键同值判定（组重扫的 publish 判据用）。 */
function labelsEqual(a: ReadonlyMap<number, string>, b: ReadonlyMap<number, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/** 标记字号的逐级递减档（定稿：13.5 / 13 / 12.5，正文锚 15px 下的 em 比值；深度 >3 同
 *  第三档）。与 theme.ts 的 `.cm-lp-list-marker-d1/-d2/-d3` 是同一组比值的两个写值：
 *  改一处必须改另一处（canvas 测量按它量标记宽度，见下方 measure 的注释）。 */
const MARKER_FONT_RATIOS = [13.5 / 15, 13 / 15, 12.5 / 15] as const;

class ListMarker extends WidgetType {
  // 显式字段而非参数属性：tests/unit 的 Node 类型剥离（strip-only）不支持参数属性，
  // 本模块是单测的直接导入对象（content-restyle.test.ts）。
  readonly label: string;
  readonly task: string | null;
  readonly depth: number;
  constructor(label: string, task: string | null, depth: number) {
    super();
    this.label = label;
    this.task = task;
    this.depth = depth;
  }
  eq(other: ListMarker) { return this.label === other.label && this.task === other.task && this.depth === other.depth; }
  /** 光标矩形（合同 docs/specs/editor-caret.md 的 C1）：纵向 MUST 等于同一行**正文文本**的
   *  行盒，MUST NOT 取 marker 自己的盒子。
   *
   *  为什么需要覆盖：marker 是 13.5px 的 inline-flex widget，它的 `getClientRects()` 高度
   *  是自身字号 × 行高（15px 正文下 22.94px），而正文位置的光标取的是文本盒（18px）——
   *  同一行里「序号前 vs 正文处」光标一高一矮（Alex 2026-10-29 报告）。CM 的
   *  `coordsInWidget` 会优先采用 widget 自己给的矩形，所以几何只能在这里对齐到行盒。
   *  横向仍取 marker 的边：`pos > 0` 取右缘（源码终点），否则取左缘（可见行首）。 */
  coordsAt(dom: HTMLElement, pos: number, side: number) {
    const rect = dom.getBoundingClientRect();
    const box = bodyTextBox(dom);
    if (box === null) return null;
    const x = pos > 0 ? rect.right : rect.left;
    return { left: x, right: x, top: box.top, bottom: box.bottom };
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-lp-list-marker cm-lp-list-marker-d${Math.min(Math.max(this.depth, 1), 3)}`;
    const mark = document.createElement("span");
    mark.textContent = this.label;
    span.append(mark);
    if (this.task !== null) {
      const task = document.createElement("span");
      task.className = "cm-lp-task-marker";
      task.textContent = this.task;
      task.setAttribute("aria-label", this.task.toLowerCase() === "[x]" ? t("D227") : t("D228"));
      span.append(task);
    }
    return span;
  }
}

/** DOM 文本节点的结构形态。本文件的 `Node` 已被 CM 语法树节点类型占用（模块头部的
 *  `type Node = ...`），DOM 全局同名类型被遮蔽——这里只按用到的字段做结构判别，
 *  避免与树节点类型纠缠。 */
interface DomTextNode {
  readonly data: string;
}

/** 文本节点在行盒里的纵向范围（C1 的「行盒」口径：文本 Range 的 rect，不含行 padding）。
 *  与 tests/visual/scenes/m647-caret-geometry.spec.ts 的读数同一口径——场景侧量文本 Range，
 *  这里量同一个东西，断言才有区分度。 */
function textBoxOf(node: DomTextNode): { top: number; bottom: number } | null {
  const range = document.createRange();
  range.selectNodeContents(node as unknown as HTMLElement);
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.height > 0) return { top: rect.top, bottom: rect.bottom };
  }
  return null;
}

/** marker 所在行里正文文本的行盒：优先取 marker **之后**的第一段非空文本（光标从 marker 边界
 *  移到正文起点时高度必须一致），本行没有正文时（空项 `1. ` / 任务项）退到相邻行测**高度**，
 *  再按本行的内容盒居中——同一字体度量下两行行盒等高，垂直位置取本行的。 */
function bodyTextBox(dom: HTMLElement): { top: number; bottom: number } | null {
  const line = dom.closest(".cm-line");
  if (!line) return null;
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let fallback: { top: number; bottom: number } | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as unknown as DomTextNode;
    if (!text.data.trim()) continue;
    // marker widget 自己的文本（`1.` / `–`）在 dom 内部：它的字号是 13.5px，量它会得到
    // marker 的盒高，正是本条要避开的那个值。
    if (dom.contains(text as unknown as HTMLElement)) continue;
    const box = textBoxOf(text);
    if (box === null) continue;
    if (dom.compareDocumentPosition(text as unknown as HTMLElement) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) return box;
    fallback ??= box;
  }
  if (fallback !== null) return fallback;
  // 空项：本行没有正文文本。行盒高度优先借相邻可见行的**正文**文本盒（同一字体度量下两行
  // 等高）；20 行搜索半径内也没有正文时（整篇只有一行空列表项），退到用本行自己的排版
  // 量一个真实文本盒——C1 对任意 md 文档成立，MUST NOT 以 marker 盒高回退（M795 r1 P1-1）。
  const height = siblingTextBoxHeight(line) ?? measuredTextBoxHeight(line);
  if (height === null) return null;
  const rect = line.getBoundingClientRect();
  const style = getComputedStyle(line);
  const padTop = parseFloat(style.paddingTop || "0");
  const padBottom = parseFloat(style.paddingBottom || "0");
  const top = rect.top + padTop;
  const content = rect.height - padTop - padBottom;
  return { top: top + (content - height) / 2, bottom: top + (content + height) / 2 };
}

/** 正文文本盒高度的**排版兜底**：用本行的 computed 字体（族 / 字号 / 字重 / 字形）在离屏容器里
 *  量一个真实文本盒。
 *
 *  为什么不用字体度量常量或 Canvas：文本盒高度是字体与字号共同决定的（15px 正文字体实测 18px，
 *  32px 档按比例放大），写死系数会在换字体 / 改字号时与真实行盒分叉；这里量的东西与
 *  `textBoxOf`（文本 Range 的 rect）是同一种几何，区别只是把文字挪到离屏容器——同一份排版
 *  取值（`.cm-line` 的 computed style），不引入第二真源。
 *
 *  离屏容器挂在 `document.body`（不进编辑器 DOM，CM 的 DOMObserver 看不见），按字体签名缓存：
 *  主题 / 字号切换产生新签名，旧键留在缓存里也无副作用（条目数以「用户改过几档字号/字体」为界）。 */
let measureHost: HTMLElement | null = null;
const textBoxHeightCache = new Map<string, number>();

function measuredTextBoxHeight(line: Element): number | null {
  const style = getComputedStyle(line);
  const key = [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle].join("|");
  const cached = textBoxHeightCache.get(key);
  if (cached !== undefined) return cached;
  if (measureHost === null) {
    measureHost = document.createElement("div");
    measureHost.setAttribute("aria-hidden", "true");
    // visibility:hidden 保留布局（display:none 会量不到矩形），同时不参与命中与读屏。
    measureHost.style.cssText =
      "position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:pre;";
    document.body.append(measureHost);
  }
  const probe = document.createElement("span");
  probe.style.fontFamily = style.fontFamily;
  probe.style.fontSize = style.fontSize;
  probe.style.fontWeight = style.fontWeight;
  probe.style.fontStyle = style.fontStyle;
  // 代表串只用拉丁字符：`src/**` 的 CJK 串字面量门禁（tests/unit/copy.test.ts）不豁免；
  // 文本盒高度取字体度量，与具体字形无关。
  probe.textContent = "Ag";
  measureHost.replaceChildren(probe);
  const range = document.createRange();
  range.selectNodeContents(probe);
  const rect = Array.from(range.getClientRects()).find((r) => r.height > 0);
  probe.remove();
  if (rect === undefined) return null;
  textBoxHeightCache.set(key, rect.height);
  return rect.height;
}

/** 相邻行（同字体度量）文本盒的高度；找不到时 null。
 *  空项行两侧常常也是空行（`- ` 前后各一个空行），所以向两侧**逐行外扩**找到第一段正文——
 *  同一字体度量下行盒等高，取最近的那一行就是本行的行盒高度。 */
function siblingTextBoxHeight(line: Element): number | null {
  let before: Element | null = line.previousElementSibling;
  let after: Element | null = line.nextElementSibling;
  for (let step = 0; step < 20 && (before !== null || after !== null); step++) {
    for (const sibling of [before, after]) {
      if (!(sibling instanceof HTMLElement) || !sibling.classList.contains("cm-line")) continue;
      const walker = document.createTreeWalker(sibling, NodeFilter.SHOW_TEXT);
      const marker = sibling.querySelector(".cm-lp-list-marker");
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as unknown as DomTextNode;
        if (!text.data.trim()) continue;
        // marker 自己的文本按逐级递减的标记字号（12.5–13.5px）排，量它会得到标记的盒高
        // ——正是本条要避开的那个值。取相邻行的**正文**文本。
        if (marker !== null && marker.contains(node)) continue;
        const box = textBoxOf(text);
        if (box !== null) return box.bottom - box.top;
      }
    }
    before = before?.previousElementSibling ?? null;
    after = after?.nextElementSibling ?? null;
  }
  return null;
}


const measured = StateEffect.define<readonly number[]>();
const metadataReady = StateEffect.define<null>();
interface GroupScan {
  item: Node | null;
  width: number;
  indent: number;
  /** 列表嵌套深度（1 = 顶层）：标记 glyph 与字号档按它取。 */
  depth: number;
  /** 父项的复合编号（父列表是 ol 时）；ul 断链为 null。 */
  prefix: string | null;
  /** ol 组内已扫到的项序号（1 基）。 */
  index: number;
  /** item.from → 显示编号（ol 组；ul 组恒为空表）。 */
  labels: Map<number, string>;
}

class ListLayout {
  private units: readonly number[] | null = null;
  private observer: MutationObserver;
  private measure = () => this.view.requestMeasure({
    key: this,
    read: () => {
      const style = getComputedStyle(this.view.contentDOM);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      // 字体族与**三档字号比值**都必须与标记渲染用的那一份同源（change
      // typography-and-zoom / restyle-ui-tokens-v1 / M218 C3）：
      // - 族：`.cm-lp-list-marker` 的 fontFamily 是 `var(--editor-font-family)`（sans，
      //   定稿的标记族；src/preview/theme.ts），这里读的也是它。**这是字符串取值、不是
      //   CSS 引用**：改 token 名不会带着它走，所以非默认 `font_family` 下若两处不同源，
      //   标记会按旧族算宽、与正文对不齐（REVIEW.md 「同一语义两处真源」条的第二种形态：一处是 CSS
      //   引用、一处是 JS 取值）。
      // - 字号比值：标记字号逐级递减 13.5 / 13 / 12.5（正文锚 15px），比值表
      //   MARKER_FONT_RATIOS 与 theme.ts 的 `.cm-lp-list-marker-d1/-d2/-d3` 是同一组
      //   比值的两个写值：改一处必须改另一处，否则测量宽度与渲染宽度分叉，悬挂缩进
      //   逐级错位。这里量的是「0」在各档**标记渲染字号**下的宽度（数字在 sans 下
      //   等宽——标记带了 tabular-nums，逐级一个单位宽）。
      // 族取值点同时受视觉场景钉住（typography.spec.ts）：口径是 canvas 拿到的族串 =
      // token **原文**（自定义属性 getPropertyValue 返回 var() 代入后的未归一字面量）；
      // 它与标记的**计算** fontFamily 不是同一形态——sans 栈经 Chromium 归一
      //（BlinkMacSystemFont → "system-ui"）后与原文分叉，mono 栈无别名时恰好相等。
      // 场景侧分别钉：canvasFonts 断言钉原文串，listMarkerFontFamily 断言钉归一形态。
      const family = style.getPropertyValue(EDITOR_FONT_FAMILY_TOKEN);
      const base = parseFloat(style.fontSize);
      return MARKER_FONT_RATIOS.map((ratio) => {
        context.font = `${base * ratio}px ${family}`;
        return context.measureText("0").width;
      });
    },
    write: (value) => queueMicrotask(() => {
      if (this.destroyed) return;
      const changed = this.units === null || value.some((v, i) => Math.abs(v - (this.units?.[i] ?? 0)) > .01);
      if (changed) this.view.dispatch({ effects: measured.of(value) });
    }),
  });
  decorations: DecorationSet = Decoration.none;
  private tree: ReturnType<typeof syntaxTree>;
  private groups = new Map<number, Group>();
  /** 编辑后待重扫确认的陈旧组（key 与 groups 同步映射）；重扫登记后即移除。 */
  private stale = new Set<number>();
  private scans = new Map<number, GroupScan>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private destroyed = false;

  private view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.tree = syntaxTree(view.state);
    this.observer = new MutationObserver(this.measure);
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
    document.fonts.addEventListener("loadingdone", this.measure);
    this.measure();
    this.build(view);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.observer.disconnect();
    document.fonts.removeEventListener("loadingdone", this.measure);
  }

  update(update: ViewUpdate) {
    const tree = syntaxTree(update.state);
    let resized = false;
    // 裸 marker 行的渲染门控是「判据选区」（reveal-gate，M259 按压快照）——按压窗口
    // 开 / 关本身不改选区，不触发重建会让冻结那一帧的门控判错（M461）。
    let pointerMoved = false;
    for (const tr of update.transactions) for (const effect of tr.effects) {
      if (effect.is(measured)) { this.units = effect.value; resized = true; }
      if (effect.is(metadataReady)) resized = true;
      if (effect.is(pointerPressFrame)) pointerMoved = true;
    }
    if (update.docChanged) {
      // 编辑不清掉已发布的组：键位经 changes 映射后旧宽度先顶着渲染，stale
      // 驱动后台重扫，只有宽度真变了才 publish 重建（见 schedule）。直接清空
      // 会让每次击键掉装饰 ≥16ms，列表文字左右抖动（桌面验收缺陷）。
      // labels 的键（item.from）随组键一起映射：陈旧编号先顶着（插项导致的
      // 错号最多存留一个重扫周期），重扫 publish 后归零。
      const remapped = new Map<number, Group>();
      for (const [from, group] of this.groups) {
        const labels = new Map<number, string>();
        for (const [itemFrom, label] of group.labels) labels.set(update.changes.mapPos(itemFrom, 1), label);
        remapped.set(update.changes.mapPos(from, 1), { ...group, labels });
      }
      this.groups = remapped;
      this.stale = new Set(remapped.keys());
      this.scans.clear();
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.tree = tree;
    // 注意：geometryChanged 刻意不是测量触发点。标记宽度只依赖字体族/字号
    //（documentElement 的 style/class 经 MutationObserver、字体就绪经
    // document.fonts loadingdone、初始值经构造时的 measure——typography.ts 的字体
    // token 就写在 documentElement.style 上），窗口 resize / 主题切换都不改变它们。
    // 挂 geometryChanged 的反例（M222 回归 3 探针实证）：⌘A→↓ 的滚动校正环路每个
    // pass 都 geometryChanged → 每 pass 再排一次 requestMeasure → 测量环路被洪峰
    // 打断（CM 的 "Measure loop restarted more than 5 times"），scrollTarget 的末次
    // 校正跑不完，无 fm 长文档的 ↓ 揭示不足（cursor-motion.spec.ts:84）。
    if (resized || update.docChanged || tree !== syntaxTree(update.startState) || update.viewportChanged || update.selectionSet || pointerMoved) this.build(update.view);
  }

  private schedule() {
    if (this.timer !== undefined || (!this.pending && !this.scans.size) || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.destroyed) return;
      if (this.scans.size) {
        const deadline = performance.now() + 3;
        let remaining = 512;
        let published = false;
        for (const [from, scan] of this.scans) {
          while (scan.item && remaining-- > 0 && performance.now() < deadline) {
            const item = scan.item;
            const mark = item.getChild("ListMark");
            if (mark) {
              const label = this.view.state.doc.sliceString(mark.from, mark.to);
              const task = item.getChild("Task")?.getChild("TaskMarker");
              // 显示标记（定稿列表标记体系，M218 C3）：ol = 复合多级编号（项在组内的
              // 序号拼父项链，不是源码里的字面数字）；ul = 按深度的 glyph。宽度按**显示
              // 标记**的字符数预分配（数字在标记的 tabular-nums 下等宽）。
              let display: string;
              if (/^\d/.test(label)) {
                scan.index++;
                display = orderedItemLabel(scan.prefix, scan.index);
                scan.labels.set(item.from, display);
              } else {
                display = bulletGlyph(scan.depth);
              }
              scan.width = Math.max(scan.width, display.length + (task ? 3.5 : 0) + 1);
            }
            scan.item = item.nextSibling;
          }
          if (!scan.item) {
            const next: Group = { width: scan.width, body: scan.indent + scan.width, depth: scan.depth, labels: scan.labels };
            const previous = this.groups.get(from);
            this.groups.set(from, next);
            this.scans.delete(from);
            // 重扫结果与已发布值一致不触发重建：陈旧组顶渲染期间宽度本就正确，
            // 一致时还 dispatch 会多一轮无变化的全量 build。labels 必须参与比较：
            // 插项只改编号不改宽度时，靠它把新编号发布出去。
            if (!previous || previous.width !== next.width || previous.body !== next.body || !labelsEqual(previous.labels, next.labels)) published = true;
          }
          if (remaining <= 0 || performance.now() >= deadline) break;
        }
        if (published) this.view.dispatch({ effects: metadataReady.of(null) });
      } else {
        const target = Math.min(this.view.state.doc.length, syntaxTree(this.view.state).length + 16384);
        forceParsing(this.view, target, 5);
        this.build(this.view);
      }
      this.schedule();
    }, 16);
  }

  private complete(list: Node, state: EditorState) {
    if (syntaxTreeAvailable(state, state.doc.length)) return true;
    for (let node: Node | null = list; node; node = node.parent) {
      if (node.nextSibling && syntaxTreeAvailable(state, node.nextSibling.to)) return true;
    }
    return false;
  }

  private group(list: Node, state: EditorState): Group | null {
    const cached = this.groups.get(list.from);
    if (cached) {
      // 陈旧组先用旧宽度渲染（不掉装饰 = 不抖动），同时登记后台重扫；树不完整
      // 或祖先未就绪时保留 stale，下一轮 build 重试。
      if (this.stale.has(list.from) && this.complete(list, state) && this.enqueue(list, state)) this.stale.delete(list.from);
      return cached;
    }
    if (!this.complete(list, state)) { this.pending = true; return null; }
    this.pending = true;
    this.enqueue(list, state);
    return null;
  }

  /** 登记一个组的宽度扫描；祖先组未就绪或陈旧（嵌套列表）时不登记，返回 false。 */
  private enqueue(list: Node, state: EditorState): boolean {
    if (this.scans.has(list.from)) return true;
    let parent = list.parent;
    while (parent && !isList(parent)) parent = parent.parent;
    // 祖先 cached body 未确认（stale 或重扫已登记未完成）时，用它登记 indent
    // 会让子组在祖先 publish 后错位且不自愈；视为未就绪，pending 保活等下一轮
    // build 重试。两处都要查：stale 在祖先扫描登记时即摘除，而 body 要等扫描
    // 完成才更新——同一轮 build 里祖先行先于子行处理，仅查 stale 会漏。
    const ancestorReady = parent === null || (!this.stale.has(parent.from) && !this.scans.has(parent.from));
    const ancestor: Group | null = parent ? this.group(parent, state) : null;
    if ((parent !== null && ancestor === null) || !ancestorReady) { this.pending = true; return false; }
    // 深度与复合编号前缀（M218 C3）：深度 = 祖先组深度 + 1；编号链只穿过 ol 祖先
    // ——父列表是 ul 时断链（定稿的 counter 拼接只覆盖 `ol > li > ol` 直系），本项
    // 从自己起编号。祖先组此刻必已发布（上面的就绪闸），其 labels 覆盖自己的全部
    // 父项，前缀因此一定取得到（取不到按断链降级，重扫会修正）。
    const parentItem = list.parent;
    const prefix =
      parent?.name === "OrderedList" && parentItem && ancestor
        ? ancestor.labels.get(parentItem.from) ?? null
        : null;
    this.scans.set(list.from, {
      item: list.firstChild,
      width: 0,
      indent: (ancestor?.body ?? 0) + (parent ? 2 : 0),
      depth: ancestor ? ancestor.depth + 1 : 1,
      prefix,
      index: 0,
      labels: new Map(),
    });
    this.pending = true;
    return true;
  }

  private build(view: EditorView) {
    this.pending = false;
    const decorations: Range<Decoration>[] = [];
    const seen = new Set<number>();
    const { doc } = view.state;
    // 裸 marker 行的列表编辑态门控（M461）：判据选区（reveal-gate 的按压快照，M259）
    // 与行范围**相接即算**（含端点）——光标在行首（marker 之前）也算驻留：与 M110
    // 行级显露同取向，空 caret 落在行首时该行必须已进入编辑态，否则作者看不到
    // 自己刚敲入的标记被如何接管。光标在上一行行尾（= 本行行首 - 1）不满足
    // `r.to >= line.from`，不会误触发。判定本体在 lineTouchesSelection（与水平移动
    // 的原子步共用一份）。
    const cursorOnLine = (line: Line): boolean => lineTouchesSelection(view.state, line);
    for (const range of view.visibleRanges) {
      let line = doc.lineAt(range.from);
      while (line.from <= range.to) {
        if (!seen.has(line.from)) {
          seen.add(line.from);
          const render = listLineRender(this.tree, doc, line, this.units !== null && cursorOnLine(line));
          const info = render.info;
          // lazy continuation 行（`info.rendered === false` 的项内段落行）按顶层段落渲染：
          // 不加 `cm-lp-list-line`、不施加 `--lp-list-body`，字符与光标落在行首
          // （合同 docs/specs/lists.md 的 L1；判定与光标位置无关，L3）。
          if (info && info.item) {
            const mark = info.item.getChild("ListMark");
            const group = this.group(info.item.parent!, view.state);
            if (!group || !this.units) {
              if (line.number === doc.lines) break;
              line = doc.line(line.number + 1);
              continue;
            }
            // 测量单位按组深度取档（标记字号逐级递减，见 MARKER_FONT_RATIOS）。
            const unit = this.units[Math.min(group.depth, 3) - 1];
            decorations.push(Decoration.line({
              class: `cm-lp-list-line${info.first ? " cm-lp-list-first" : ""}`,
              attributes: { style: `--lp-list-body:${group.body * unit}px;--lp-list-marker:${group.width * unit}px` },
            }).range(line.from));
            if (render.hidden && info.first && mark) {
              const task = info.item.getChild("Task")?.getChild("TaskMarker");
              const label = doc.sliceString(mark.from, mark.to);
              // 显示标记：ol 取组扫描算好的复合编号（扫描保证覆盖本项；陈旧组顶
              // 渲染期间取不到时退回源码字面数字，重扫 publish 后归位），ul 按深度
              // 取 glyph（`–` / `◦`）。
              const display = /^\d/.test(label)
                ? group.labels.get(info.item.from) ?? label
                : bulletGlyph(group.depth);
              decorations.push(Decoration.replace({ widget: new ListMarker(display, task ? doc.sliceString(task.from, task.to) : null, group.depth) }).range(render.hidden.from, render.hidden.to));
            } else if (render.hidden) {
              // 真续行：吞掉行首源码空白，文本落到项正文起点（L2）。
              decorations.push(Decoration.replace({}).range(render.hidden.from, render.hidden.to));
            }
          } else if (render.bare && this.units) {
            // 裸 marker 行的列表编辑态（M461，合同 docs/specs/lists.md 的 B1/B2）：
            // 光标驻留时按列表项首行渲染——藏源码标记（含引用前缀，与真实引用内
            // 列表的 replace 落点同口径）、上 widget、悬挂缩进按字面标记宽 + 前缀列
            // 算；光标离开即回到字面文本（门控是渲染层事件，不改文档，L4 照旧）。
            const bare = render.bare;
            const unit = this.units[0];
            const label = bare.ordered ? bare.marker : bulletGlyph(1);
            const width = label.length + 1;
            const body = (bare.markerFrom - line.from) + width;
            decorations.push(Decoration.line({
              class: "cm-lp-list-line cm-lp-list-first cm-lp-bare",
              attributes: { style: `--lp-list-body:${body * unit}px;--lp-list-marker:${width * unit}px` },
            }).range(line.from));
            decorations.push(Decoration.replace({ widget: new ListMarker(label, null, 1) }).range(line.from, bare.contentFrom));
          }
        }
        if (line.number === doc.lines) break;
        line = doc.line(line.number + 1);
      }
    }
    this.decorations = Decoration.set(decorations, true);
    this.schedule();
  }
}

export const listDecorations = ViewPlugin.fromClass(ListLayout, { decorations: plugin => plugin.decorations });
