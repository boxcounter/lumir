// 语法包裹（syntax envelope）：构造的**节点源码范围**与**渲染态可见区间**的唯一出处（M687，
// change semantic-selection-markdown-oct23 / design §3）。
//
// 这个模块回答两个问题，且只回答一遍：
//   1. 装饰层要隐藏哪几段源码（`hidden`）——livePreview 的标题 / 强调 / 链接 / 角括号分支
//      从这里取隐藏 span，不再各写一份「`#` 后跟一个空格」类字面规则
//      （REVIEW.md「同一语义两处真源」条）；
//   2. 指针选区的语法包裹外扩要扩到哪（`from` / `to`）——只在选区**完整覆盖**该构造的全部
//      渲染文本（`visibleFrom`..`visibleTo`，首尾空白不计）且尚未包含完整节点时才扩。
//
// 边界（与既有判据的分工，改这里前先读）：
//   - 显露判据（M297 标题行级 / M168 强调含端点 / M145 链接严格重叠）只回答「什么时候撤下
//     装饰」，**不是**外扩目标。标题的显露判据是整行，但撤下装饰后上屏的只有标题节点的字符
//     ——按整行外扩会把引用块前缀 `> ` 一起吞进选区（design §3.1 末段）。
//   - M259 按压窗口：外扩只在指针手势结束那一拍发生（接线见 livePreview 的 mouseup），
//     MUST NOT 做成 transactionFilter——拖拽期间每次 mousemove 都会过 filter，与 CM 的鼠标
//     选区状态机打架（design §3.3）。
//   - M539 隐藏尾标修正：只消费空光标；本模块只消费非空选区，两条判据互不调用、互不合并。
//   - M285 选区可见范围 = 编辑器选区范围：外扩后上屏的定界符必须带选中底色，这由「同一事务
//     提交选区与按压窗口关闭」保证（装饰只重建一次），本模块不碰绘制。
//
// 封闭集合（D4）：ATX 标题、强调系（`**` / `*` / `_` / `~~`，含嵌套）、标准链接与角括号字面
// 链接。行内代码（反引号本就可见）、列表标记 / wikilink（widget 整体替换、无显露判据）、引用
// 前缀与 callout 标记、图片 / 公式 / mermaid / frontmatter / 分隔线 MUST NOT 被外扩覆盖。

import { EditorSelection } from "@codemirror/state";
import type { EditorState, SelectionRange, Text } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { classifyLinkTarget, standardLinkParts } from "./links";

// @lezer/common 不是直接依赖（与 livePreview / callout 同口径），节点类型从 syntaxTree 推导。
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** 一个可外扩构造的几何：节点范围、渲染文本区间、被隐藏的源码段。 */
export interface SyntaxEnvelope {
  /** 节点源码范围 `[from, to)`——外扩的目标。 */
  from: number;
  /** 节点源码范围右端（不含）。 */
  to: number;
  /** 渲染态可见的源码区间 `[visibleFrom, visibleTo)`（该构造自身的定界符已扣除）。 */
  visibleFrom: number;
  /** 渲染态可见区间右端（不含）。 */
  visibleTo: number;
  /** 渲染态被 replace 隐藏的源码段——装饰层的隐藏 span 与本模块的 visible 逐值同源。 */
  hidden: readonly { from: number; to: number }[];
}

/** 由「节点范围 + 可见区间」构造 envelope；可见区间必须在节点内、顺序合法。 */
function envelope(
  from: number,
  to: number,
  visibleFrom: number,
  visibleTo: number,
): SyntaxEnvelope | null {
  if (from > visibleFrom || visibleTo > to || visibleFrom > visibleTo) return null;
  const hidden: { from: number; to: number }[] = [];
  if (from < visibleFrom) hidden.push({ from, to: visibleFrom });
  if (visibleTo < to) hidden.push({ from: visibleTo, to });
  return { from, to, visibleFrom, visibleTo, hidden };
}

function directChildren(node: SyntaxNode, accept: (child: SyntaxNode) => boolean): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (accept(child)) out.push(child);
  }
  return out;
}

/**
 * ATX 标题：首尾 `HeaderMark` 串（首个吃掉后随空格、其余吃前导空格——与装饰层逐值一致）。
 * 可见区间不含行首缩进（节点起点就在 `#` 上）与引用块前缀（不属于标题节点）。
 */
export function headingEnvelope(node: SyntaxNode, doc: Text): SyntaxEnvelope | null {
  const marks = directChildren(node, (child) => child.name === "HeaderMark");
  if (marks.length === 0) return null;
  const first = marks[0];
  const last = marks[marks.length - 1];
  const eatAfter = doc.sliceString(first.to, first.to + 1) === " " ? 1 : 0;
  const eatBefore =
    last === first || last.from <= first.to
      ? 0
      : doc.sliceString(last.from - 1, last.from) === " "
        ? 1
        : 0;
  return envelope(
    node.from,
    node.to,
    first.to + eatAfter,
    last === first ? node.to : last.from - eatBefore,
  );
}

/** 强调系（粗体 / 斜体 / 删除线）：首个与末个 `*Mark` 之间是渲染文本。 */
export function emphasisEnvelope(node: SyntaxNode): SyntaxEnvelope | null {
  const marks = directChildren(node, (child) => child.name.endsWith("Mark"));
  if (marks.length < 2) return null;
  return envelope(node.from, node.to, marks[0].to, marks[marks.length - 1].from);
}

/** 标准链接：`[label](target)` 的 label 是渲染文本；blocked / 引用式（无 URL 子节点）不处理。 */
export function standardLinkEnvelope(node: SyntaxNode, doc: Text): SyntaxEnvelope | null {
  const parts = standardLinkParts(node, doc);
  if (parts === null) return null;
  if (classifyLinkTarget(parts.target).kind === "blocked") return null;
  return envelope(node.from, node.to, parts.labelFrom, parts.labelTo);
}

/** 角括号字面链接 `<url>`：URL 原文是渲染文本，两个尖括号是隐藏的定界符。 */
export function autolinkEnvelope(node: SyntaxNode, doc: Text): SyntaxEnvelope | null {
  const url = node.getChild("URL");
  if (url === null) return null;
  if (classifyLinkTarget(doc.sliceString(url.from, url.to)).kind !== "external") return null;
  return envelope(node.from, node.to, url.from, url.to);
}

/** 节点 → envelope；不在封闭集合内返回 null（调用方据此跳过）。 */
export function envelopeOf(node: SyntaxNode, doc: Text): SyntaxEnvelope | null {
  const name = node.name;
  if (/^ATXHeading[1-6]$/.test(name)) return headingEnvelope(node, doc);
  if (name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough") {
    return emphasisEnvelope(node);
  }
  if (name === "Link") return standardLinkEnvelope(node, doc);
  if (name === "Autolink") return autolinkEnvelope(node, doc);
  return null;
}

/** 覆盖判据用的可见区间：首尾空白不参与「完整覆盖」的判定（design §3.1 的空白口径）。 */
function trimmedVisible(state: EditorState, env: SyntaxEnvelope): { from: number; to: number } {
  const text = state.doc.sliceString(env.visibleFrom, env.visibleTo);
  const lead = text.length - text.trimStart().length;
  const trail = text.length - text.trimEnd().length;
  return { from: env.visibleFrom + lead, to: env.visibleTo - trail };
}

/** 语法树快照没覆盖到选区右端时，同步推进一次（25ms 上限；键入手势不在本路径上）。 */
function treeCovering(state: EditorState, to: number) {
  const tree = syntaxTree(state);
  if (tree.length >= to) return tree;
  return ensureSyntaxTree(state, Math.min(to, state.doc.length), 25) ?? tree;
}

/** 迭代上限：嵌套节点深度受文档约束，8 轮覆盖 `***…***` 这类已知层序（参照 M539 filter 的写法）。 */
const MAX_ROUNDS = 8;

/** 单个 range 的外扩：反复扫描直到不动点（嵌套构造由内向外逐层扩）。 */
function expandRange(state: EditorState, range: SelectionRange): SelectionRange {
  if (range.empty) return range;
  const tree = treeCovering(state, range.to);
  let from = range.from;
  let to = range.to;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let nextFrom = from;
    let nextTo = to;
    tree.iterate({
      from: Math.max(0, from),
      to: Math.min(state.doc.length, to),
      enter(ref) {
        const env = envelopeOf(ref.node, state.doc);
        if (env === null) return;
        const visible = trimmedVisible(state, env);
        if (visible.from >= visible.to) return;
        // 完整覆盖该构造的全部渲染文本，且还没有把它整个包含进来。
        if (from <= visible.from && to >= visible.to && !(from <= env.from && to >= env.to)) {
          nextFrom = Math.min(nextFrom, env.from);
          nextTo = Math.max(nextTo, env.to);
        }
      },
    });
    if (nextFrom === from && nextTo === to) break;
    from = nextFrom;
    to = nextTo;
  }
  if (from === range.from && to === range.to) return range;
  // 方向保留（design §3.1）：反向选区（anchor 在右）外扩后 anchor 仍在右、head 仍在左。
  const forward = range.anchor <= range.head;
  return EditorSelection.range(
    forward ? from : to,
    forward ? to : from,
    undefined,
    undefined,
    range.assoc === 0 ? undefined : range.assoc,
  );
}

/**
 * 指针手势结束时调用：把每个非空 range 外扩到被完整覆盖的构造的节点范围。
 *
 * 只做判定，不做门控——「只在指针松开时调用」由接线处保证（livePreview 的 mouseup）；
 * 键盘 / 程序化选区 MUST NOT 经过本函数（delta 的「只适用于指针产生的选区」）。
 * 无变化时返回**同一个** EditorSelection，调用方据此决定要不要 dispatch。
 */
export function expandSelectionToSyntax(
  state: EditorState,
  selection: EditorSelection,
): EditorSelection {
  let changed = false;
  const ranges = selection.ranges.map((range) => {
    const expanded = expandRange(state, range);
    if (expanded !== range) changed = true;
    return expanded;
  });
  if (!changed) return selection;
  return EditorSelection.create(ranges, selection.mainIndex);
}
