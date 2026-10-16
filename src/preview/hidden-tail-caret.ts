// 隐藏尾标后的指针落点修正（M539，Alex 2026-10-16：点击粗体渲染内容的最后一个
// 字形之后（含行末档），光标应落在闭合 `**` 之后，而不是之前）。
//
// 机理：强调系与标准链接在渲染态隐藏收尾标记（`**` / `](url)`），隐藏段零占宽，
// 于是「最后一个可见字形之后」的点击坐标在几何上同时对应「收尾标记之前」与
// 「收尾标记之后」两个文档位置（零宽段两侧坐标相同）。WebKit 的 caretRangeFromPoint
// 只返回可见文本内的位置——落点稳定地落在收尾标记**之前**。随后 M168 的含端点相接口径
// 让该范围显露源码，用户就看到光标停在闭合 `**` 之前：想续写会写进粗体尾、想离开
// 要再按一次方向键。修正把这类落点推到整个行内构造的收尾标记之后。
//
// 判据与装饰层逐字同源（REVIEW.md 第 8 条）：强调系用 `rangeRevealsSource`（含端点，
// M168）、链接用 `touchesSource`（严格重叠，M145）加 `standardLinkParts` /
// `classifyLinkTarget`（blocked 形态不装饰、保持原文，落点不当链接尾标处理）——
// 装饰层在渲染态隐藏什么，这里才修什么；显露态的落点是合法精确位，一律不动。
// 显露判定走的 `revealSelection` 带 M259 按压快照：过滤器的执行时机在按下之后、
// 抬起之前（插件 mousedown 先于 CM 内建鼠标选区，快照已就位），因此「隐藏与否」
// 回答的是用户**瞄准的那一帧**布局，与 M259 的落点判定不跨布局同一条前提。
//
// 范围（M539 评估结论）：行内 code 的反引号渲染态可见（livePreview.ts 的
// InlineCode 分支不隐藏标记），行内公式整体换成有宽度的 widget——两者都没有
// 零宽隐藏尾标，不存在本形态问题。链接与强调系同根（同一零宽隐藏尾标映射歧义），
// 一并修。

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Extension, Transaction, TransactionSpec } from "@codemirror/state";
import { classifyLinkTarget, standardLinkParts } from "./links";
import { rangeRevealsSource, touchesSource } from "./reveal-gate";

// @lezer/common 不是直接依赖（livePreview.ts 同口径），SyntaxNode 类型从 syntaxTree 推导。
type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** 强调系节点的收尾标记 run 起点：最后一个 `*Mark` 子节点的 from；无标记子节点返回 -1。 */
function emphasisTailStart(node: SyntaxNode): number {
  let tail = -1;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name.endsWith("Mark")) tail = child.from;
  }
  return tail;
}

/** `pos` 是否落在该强调节点（渲染态）的收尾隐藏 run 内：run 起点 <= pos < 节点尾。 */
function inEmphasisTail(node: SyntaxNode, pos: number): boolean {
  const tail = emphasisTailStart(node);
  return tail >= 0 && pos >= tail && pos < node.to;
}

/** `pos` 是否落在该链接（渲染态）的收尾隐藏 run 内：label 尾 <= pos < 节点尾（`](url)`）。 */
function inLinkTail(node: SyntaxNode, doc: EditorState["doc"], pos: number): boolean {
  const parts = standardLinkParts(node, doc);
  if (!parts) return false; // 引用式 / 未闭合形态：装饰层保持原文，无隐藏尾标
  if (classifyLinkTarget(parts.target).kind === "blocked") return false; // 同上（blocked 保持原文）
  return pos >= parts.labelTo && pos < node.to;
}

/**
 * 把「渲染内容末字之后」的指针落点修正到隐藏尾标之后。
 *
 * 返回修正后的文档位置；落点不在任何渲染态行内构造的隐藏尾标内时原样返回。
 * 强调系按嵌套链逐轮外推（`***粗体***` 的落点在 `**` 之前时，先推过 `**`、
 * 再推过外层的 `*`，直至稳定）；链接只在没有任何强调修正发生时才参与——
 * 标签内粗体的落点归粗体自己的收尾标记管（光标落在闭合 `**` 之后、仍在标签内）。
 */
export function adjustHiddenInlineTailCaret(state: EditorState, pos: number): number {
  const tree = syntaxTree(state);
  const { doc } = state;
  let target = pos;
  let emphasisMoved = false;
  // 强调嵌套链逐轮外推（`***粗体***` 的落点在 `**` 之前时，先推过 `**`、再推过外层的
  // `*`，直至稳定）：每轮至少把 target 前移过一段隐藏 run，轮数受文档长度约束，不会空转。
  for (let guard = 0; guard < 8; guard++) {
    let moved = false;
    tree.iterate({
      from: target,
      to: target,
      enter(ref) {
        if (ref.name !== "StrongEmphasis" && ref.name !== "Emphasis" && ref.name !== "Strikethrough") {
          return undefined;
        }
        // 显露态：标记可见，该落点是合法精确位（与装饰层的隐藏判据逐字同源）。
        if (rangeRevealsSource(state, ref.from, ref.to)) return undefined;
        if (inEmphasisTail(ref.node, target)) {
          target = ref.to;
          moved = true;
          return false; // 最外层命中即定案，本轮不再深入
        }
        return undefined;
      },
    });
    if (!moved) break;
    emphasisMoved = true;
  }
  // 链接只在没有任何强调修正发生时才参与：标签内粗体的落点归粗体自己的收尾标记管
  // （光标落在闭合 `**` 之后、仍在标签内），越过 `**` 后再跳链接尾是错的。
  if (!emphasisMoved) {
    tree.iterate({
      from: target,
      to: target,
      enter(ref) {
        if (ref.name !== "Link") return undefined;
        if (touchesSource(state, ref.from, ref.to)) return undefined;
        if (inLinkTail(ref.node, doc, target)) {
          target = ref.to;
        }
        return false; // 只取最外层链接（命中与否都不再深入——链接内没有链接）
      },
    });
  }
  return target;
}

/**
 * 指针点击的 transactionFilter：仅消费「指针产生的空光标落点」（userEvent
 * `select.pointer` 且选区为空——拖拽 / 双击 / 三击的非空选区一律不碰），落在渲染态
 * 隐藏尾标内时把光标推到尾标之后。键盘移动（`select.keyboard` 等）不经此过滤器，
 * 光标可以正常停在 `**` 前后任意位——否则方向键会在尾标边界被顶死。
 *
 * 修正在 transactionFilter 内做（而不是 mousedown 拦截）是为了不动 CM 自己的
 * 鼠标选区状态机：拖拽起点、双击选词、三击选行全部保持内建行为，只有最终落下的
 * 空光标被平移。
 */
function adjustPointerCaret(tr: Transaction): readonly TransactionSpec[] | Transaction {
  if (!tr.isUserEvent("select.pointer")) return tr;
  const sel = tr.newSelection;
  if (!sel.main.empty) return tr;
  const adjusted = adjustHiddenInlineTailCaret(tr.startState, sel.main.head);
  if (adjusted === sel.main.head) return tr;
  return [tr, { selection: EditorSelection.single(adjusted) }];
}

/** 装配进 live preview 扩展组（仅 md 模式；无需运行期上下文，模块级单例）。 */
export const hiddenInlineTailCaretFilter: Extension = EditorState.transactionFilter.of(adjustPointerCaret);
