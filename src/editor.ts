import { Annotation, Compartment, EditorSelection, EditorState, StateEffect, Transaction, findClusterBreak } from "@codemirror/state";
import type { Extension, SelectionRange, Text } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

/** 滚动位置快照的类型（`view.scrollSnapshot()` 的产物）。CM 不导出 ScrollTarget 类型，
 *  所以取方法的返回类型而不是手写泛型参数——类型随 CM 版本走，不会漂。 */
export type ScrollSnapshot = ReturnType<EditorView["scrollSnapshot"]>;
import { history, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import type { Language } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";
import type { EditorMode } from "./bindings/EditorMode";
import { livePreview, previewRefresh, widgetCommands } from "./preview/livePreview";
import { codeBlockWrappers } from "./preview/livePreview";
import { endMarker } from "./preview/endMarker";
import type { PreviewContext, WikilinkResolver } from "./preview/livePreview";
import type { ImageLightbox } from "./lightbox";
import { detectFrontmatter } from "./preview/frontmatter";
import { findMathSpans } from "./preview/math";
import type { MathSpan } from "./preview/math";
import { findTables, tableAt } from "./preview/table";
import type { TableModel, TableRow } from "./preview/table";
import { cellClamp, cellContentEdge } from "./cell-geometry";
import type { CellClamp } from "./cell-geometry";
import { createInvokeAttachmentProvider, codeLanguage, extensionOf, fileClass } from "./preview/attachments";
import type { AttachmentProvider } from "./preview/attachments";
import { bindingHighlight } from "./code-identifiers";
import { LANGUAGES, TOKEN_GROUPS } from "./preview/code";
import type { TokenRole } from "./preview/code";
import type { CommandRunner, EditorCommandId } from "./keys";
import { DEFAULT_CODE_BLOCK_WRAP, DEFAULT_LINE_WRAP, codeBindingTheme, wrapSpec } from "./preview/theme";
import type { WrapSettings } from "./preview/theme";
import { DEFAULT_FONT_SIZE, applyTypography as writeTypography, nextFontSize } from "./typography";
import type { TextScaleDirection, TypographySettings } from "./typography";
import { lumirSearch } from "./search";
import { positionFromReadings, restoreScrollTop } from "./scroll-position";
import type { ScrollPosition } from "./scroll-position";
import { fsFileMtime } from "./ipc";

// 编辑器单内核双模式（ADR 0002 §2）：一个 CM6 内核、两种模式。
// md = 高亮 + live preview 装饰层（src/preview/）；code = 仅高亮。
// 模式差异收敛进一个 Compartment，setMode / 装载用 reconfigure 热切换，
// 不重建 EditorView、不丢文档状态。M1 只读（ADR 0003 §3 铁律），装饰层不含编辑态逻辑。
//
// M149 多标签：全应用仍然只有**一个 EditorView**，但每打开一个文档就多一份独立的
// EditorState（EditorSession）。切标签 = `view.setState(会话的 state)`——撤销史、语法树、
// 选区、搜索查询、模式配置都在 state 里跟着走，因此切回来不重新解析、不丢撤销栈。
// 会话的公共面见 EditorSession / EditorHandle；装配层（src/main.ts）负责标签栏与打开意图。

const SAMPLE = `\
---
title: Lumir live preview 演示
tags: [demo, m1]
nested:
  key: value
---

# 标题一

## 标题二

**加粗** *斜体* ~~删除线~~ \`inline code\`

- 列表项一
- 列表项二

1. 有序一
2. 有序二

> 引用块

\`\`\`rust
fn main() { println!("lumir"); }
\`\`\`

![[demo.png]]

![示例](./assets/shot.png)
`;

// 垂直光标移动交给 CM6 处理（M103）：编辑器未装 commands keymap，ArrowUp/Down 与
// macOS Emacs 风格 Ctrl-P/N 原本全走原生 contenteditable 路径——光标越出视口时
// 浏览器延迟揭示并与 CM6 视口重建叠加，实测 scrollTop 单次跳 ~388px（整屏突变）。
// CM6 moveVertically 逐视觉行移动（支持软换行与 goal column），每次 dispatch 按
// y:"nearest" 最小滚动，光标贴边时逐行顺滑跟随。

// 块级 replace widget（frontmatter / $$ 公式 / mermaid 围栏）的边界收集。
// moveVertically 跨这类原子块时会把光标一步扔到块另一侧（M110 真实桌面缺陷：
// 公式附近 Ctrl-N 落点错误），需钳制到行进方向的近端边界。数学 span 用词法
// 口径（findMathSpans，与装饰层一致）；mermaid 围栏按语法树 FencedCode+CodeInfo。
function blockWidgetBoundaries(state: EditorState, from: number, to: number): { starts: number[]; ends: number[] } {
  const starts: number[] = [];
  const ends: number[] = [];
  const fm = detectFrontmatter(state.doc);
  if (fm && fm.to > from && fm.from < to) {
    starts.push(fm.from);
    ends.push(fm.to);
  }
  const sliceFrom = Math.max(0, from - 4096);
  const sliceTo = Math.min(state.doc.length, to + 8192);
  for (const span of findMathSpans(state.doc.sliceString(sliceFrom, sliceTo))) {
    if (!span.display) continue;
    starts.push(sliceFrom + span.from);
    ends.push(sliceFrom + span.to);
  }
  syntaxTree(state).iterate({
    from,
    to,
    enter(ref) {
      if (ref.name !== "FencedCode") return;
      const info = ref.node.getChild("CodeInfo");
      if (info && state.doc.sliceString(info.from, info.to).trim() === "mermaid") {
        starts.push(ref.from);
        ends.push(ref.to);
      }
    },
  });
  return { starts, ends };
}

/** 垂直移动跨越块级原子 widget 时，把落点钳制到近端边界；未跨越返回原落点。 */
function clampAcrossBlockWidgets(state: EditorState, from: number, to: number, forward: boolean): number {
  if (from === to) return to;
  const { starts, ends } = blockWidgetBoundaries(state, Math.min(from, to), Math.max(from, to));
  if (forward) {
    let best = Infinity;
    for (const s of starts) if (s > from && s < to && s < best) best = s;
    return best === Infinity ? to : best;
  }
  let best = -1;
  for (const e of ends) if (e < from && e > to && e > best) best = e;
  return best === -1 ? to : best;
}

// grid 表格（rectangular 且未降级）内/外的垂直移动路由（M118 tower 裁决，取代
// M113 的「一次按键跳过整张表」——整表跳过矫枉过正，光标进不了表格）：
// - 从表内出发：逐 cell 行移动（goal column 保留列位）；在首/末行再按即离开表格。
// - 从表外相邻行出发（与表之间只隔空白行，即 0 高 block separator）：进入表格
//   首/末行 cell（进入方向决定首/末）。
// - 单步移动跨越整张表且不相邻：保持整表跳过（CM 单步移动实际不会走到这条，
//   作为引擎差异兜底）。
// 两方向对称。降级/非矩形表不参与（它们按原始 Markdown 逐行渲染）。
//
// 为什么向下要显式改落：CM6 moveVertically 的扫描在 posAtCoords 的 scanY 分支
// 用行块尾部坐标（coordsAt(block.to, -1)）判断落点是否在线上；grid 表格的行尾
// 是隐藏管道符 replace，该处坐标测量退化为 null，扫描不停止、继续向下逐行漏过
// 直到表外（向上取行首坐标，不受此影响）。实证：向下从表上方行/表内任意行都
// 一步跳到表下方，向上逐行正常——M113 观测到的方向不对称即源于此。

/** 坐标测量退化（null 或全零 rect）：隐藏 replace 邻接位的典型症状。 */
function coordsDegenerate(rect: { top: number; left: number; right: number; bottom: number } | null): boolean {
  return rect === null || (rect.top === 0 && rect.left === 0 && rect.right === 0 && rect.bottom === 0);
}

/**
 * 表行内落点吸附：隐藏管道符区（slot 间隙与行首尾）与空 cell 原子 widget 不可停靠。
 * 返回落点及其可见侧 assoc——caret 绘制与 scrollIntoView 都按 `range.assoc || 1`
 * 取 coordsAtPos 的 side，隐藏 replace 左缘用 side 1 测量会退化成全零 rect，
 * 滚动揭示随之把整窗内容拉偏（M118 Ctrl-E 下挫的同族机制）。
 */
function snapIntoCell(doc: Text, row: TableRow, pos: number): { pos: number; assoc: -1 | 1 } {
  const slots = row.slots;
  if (slots.length === 0) return { pos, assoc: 1 };
  const first = slots[0];
  if (pos <= first.from) return { pos: first.from, assoc: 1 }; // 行首隐藏管道符区：可见侧在前
  const last = slots[slots.length - 1];
  // 行尾隐藏管道符区（含 row.to：管道符零宽，视觉同位但两侧坐标均退化）
  if (pos >= last.to) return { pos: last.to, assoc: -1 };
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (pos < slot.from) {
      // 相邻 slot 间的隐藏管道符区：吸附到较近的 cell 边缘
      const prev = slots[i - 1];
      return pos - prev.to <= slot.from - pos ? { pos: prev.to, assoc: -1 } : { pos: slot.from, assoc: 1 };
    }
    if (pos < slot.to) {
      // 空 cell 整体是原子 widget，只能停靠其左缘（可见侧在前）
      if (doc.sliceString(slot.from, slot.to).trim() === "") return { pos: slot.from, assoc: 1 };
      return { pos, assoc: -1 };
    }
    if (pos === slot.to) return { pos, assoc: -1 }; // cell 右缘：可见侧在后
  }
  return { pos, assoc: -1 };
}

/** 改落到表格指定行：按原光标 x（goal column）取行内位置，吸附出隐藏原子区。 */
function cursorInTableRow(
  view: EditorView,
  row: TableRow,
  goalColumn: number | undefined,
): SelectionRange {
  const { doc } = view.state;
  let pos: number | null = null;
  if (goalColumn !== undefined) {
    const refPos = row.slots[0]?.from ?? row.from;
    const ref = view.coordsAtPos(refPos, 1) ?? view.coordsAtPos(row.from, 1);
    if (ref) {
      const x = view.contentDOM.getBoundingClientRect().left + goalColumn;
      pos = view.posAtCoords({ x, y: (ref.top + ref.bottom) / 2 }, false);
    }
  }
  const snapped = snapIntoCell(doc, row, Math.min(Math.max(pos ?? row.from, row.from), row.to));
  return EditorSelection.cursor(snapped.pos, snapped.assoc, undefined, goalColumn);
}

/** from 与表格在行进方向上是否相邻：之间没有非空白文本行（0 高空行不算间隔）。 */
function tableAdjacent(doc: Text, from: number, table: TableModel, forward: boolean): boolean {
  const fromLine = doc.lineAt(from).number;
  const edgeLine = doc.lineAt(forward ? table.from : table.to).number;
  const first = forward ? fromLine + 1 : edgeLine + 1;
  const last = forward ? edgeLine - 1 : fromLine - 1;
  for (let n = first; n <= last; n++) {
    if (doc.line(n).text.trim() !== "") return false;
  }
  return true;
}

function routeGridTable(
  view: EditorView,
  main: SelectionRange,
  target: SelectionRange,
  forward: boolean,
): SelectionRange {
  const { doc } = view.state;
  const from = main.head;
  const lo = Math.min(from, target.head);
  const hi = Math.max(from, target.head);
  const tree = ensureSyntaxTree(view.state, hi, 25) ?? syntaxTree(view.state);
  const tables = findTables((s, e) => doc.sliceString(s, e), doc.length, tree, lo, hi)
    .filter((t) => t.rectangular && !t.degraded);
  if (tables.length === 0) return target;
  const goalColumn = main.goalColumn ?? (() => {
    // 与 moveCaretVertically 的起点归一化同理：DOM 回读后 assoc 归 0，隐藏
    // replace 左缘按 side 1 测量退化，需回退可见侧再取 x。
    const side = main.assoc || 1;
    const rect = view.coordsAtPos(from, side);
    const good = rect && !coordsDegenerate(rect) ? rect : view.coordsAtPos(from, -side as -1 | 1);
    return good ? good.left - view.contentDOM.getBoundingClientRect().left : undefined;
  })();

  const fromTable = tableAt(tables, from);
  if (fromTable) {
    if (tableAt(tables, target.head) === fromTable) {
      // 表内自然移动（向上常态）落点同样吸附出隐藏原子区
      const targetRow = fromTable.rows.find((r) => target.head >= r.from && target.head <= r.to);
      if (!targetRow) return target; // 分隔线等边角：不干预
      const snapped = snapIntoCell(doc, targetRow, target.head);
      return EditorSelection.cursor(snapped.pos, snapped.assoc, undefined, target.goalColumn);
    }
    const rowIndex = fromTable.rows.findIndex((r) => from >= r.from && from <= r.to);
    if (rowIndex < 0) return target; // 光标在分隔线等边角：不干预
    const next = forward ? fromTable.rows[rowIndex + 1] : fromTable.rows[rowIndex - 1];
    if (!next) return target; // 已在首/末行：离开表格
    // 自然移动漏过行进方向的下一行（向下扫描在行尾坐标退化所致）、或落到起点
    // 后方（起点坐标退化导致扫描起点错位）时，改落该行
    const missed = forward ? target.head > next.to || target.head < from : target.head < next.from || target.head > from;
    return missed ? cursorInTableRow(view, next, goalColumn) : target;
  }

  if (tableAt(tables, target.head)) return target; // 自然进入首/末行（向上常态）
  // 一步跨越整张表（向下常态）：相邻行进入首/末行 cell；不相邻保持整表跳过
  const crossed = tables.find((t) => (forward ? from < t.from && target.head > t.to : from > t.to && target.head < t.from));
  if (!crossed || !tableAdjacent(doc, from, crossed, forward)) return target;
  const row = forward ? crossed.rows[0] : crossed.rows[crossed.rows.length - 1];
  return cursorInTableRow(view, row, goalColumn);
}

/** 垂直移动的落点（不含「非空选区折叠」这类调用方语义）：从 `start` 出发走一步。
 *  扩选命令与 ⌃N/⌃P 共用本函数——硬化口径只此一份（起点归一化 / 文档边界兜底 /
 *  跨原子块钳制 / 表格行路由）。 */
function verticalTarget(view: EditorView, start: SelectionRange, forward: boolean): SelectionRange {
  // 起点归一化：DOM 选区回读会把 assoc 归 0（实证：dispatch assoc=-1 的 cursor
  // 后同步读回 assoc=0）。落点停在隐藏 replace 左缘（表格管道符边界）时，CM
  // moveVertically 内部按 `start.assoc || (forward ? 1 : -1)` 取 side——空光标
  // 向下即 side 1，测量退化为全零 rect，goal column/扫描起点随之算出垃圾落点
  //（实测直接跳到文档开头）。退化则改用可见侧重建起点，CM 内部测量即恢复有效。
  let from = start;
  const startSide = (start.assoc || (forward ? 1 : -1)) as -1 | 1;
  if (coordsDegenerate(view.coordsAtPos(from.head, startSide)) && !coordsDegenerate(view.coordsAtPos(from.head, -startSide as -1 | 1))) {
    from = EditorSelection.cursor(from.head, -startSide, undefined, from.goalColumn);
  }
  const moved = view.moveVertically(from, forward);
  // 文档边界兜底（r1 review P2-2，与官方 cursorByLine 同款）：moveVertically 在
  // 末/首行原地不动时，改移行尾/行首——末行中段 ArrowDown 到行尾、首行到行首。
  let target = moved.head !== from.head ? moved : view.moveToLineBoundary(from, forward);
  if (target.head === from.head) return target;
  const clamped = clampAcrossBlockWidgets(view.state, from.head, target.head, forward);
  if (clamped !== target.head) target = EditorSelection.cursor(clamped);
  return routeGridTable(view, from, target, forward);
}

/** 折叠揭示的自愈（M222 回归 3）：0 高分隔行（.cm-lp-block-separator，M218 C1 阶梯）
 *  让 CM heightmap 的逐行估算与真实行高系统性偏离——长文档大跨度揭示时，校正环路每
 *  pass 只能学进一个视口的行高，累计误差超过 CM 测量环路的 6 次预算（"Viewport
 *  failed to stabilize"），scrollIntoView 停在半路（探针实证：caretBottom 962 vs
 *  scrollerBottom 775 卡死；分隔行还原为正常高度即收敛；直赋 scrollTop 会被 CM 的
 *  滚动锚定保持回卷）。自愈：settle 后光标仍在视口外就补发一次 scrollIntoView——
 *  heightmap 的行高学习跨轮累计，第二轮带着已学高度重算即收敛（探针实证：补发一轮
 *  caretBottom 962→770 且不回卷）。CM 的环路在一次 rAF 内跑完（含放弃分支），故
 *  rAF 后即 settle 点；CM 自己收敛时这是 no-op；选区已变（用户又敲了键）则放弃，
 *  不跟用户抢滚动。 */
function healCollapsedReveal(view: EditorView, pos: number, attempts = 3): void {
  requestAnimationFrame(() => {
    if (view.state.selection.main.head !== pos) return;
    const coords = view.coordsAtPos(pos);
    if (!coords) return;
    const rect = view.scrollDOM.getBoundingClientRect();
    if (coords.bottom <= rect.bottom + 1 && coords.top >= rect.top - 1) return;
    view.dispatch({ scrollIntoView: true });
    if (attempts > 1) healCollapsedReveal(view, pos, attempts - 1);
  });
}

function moveCaretVertically(view: EditorView, forward: boolean): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到移动方向的一端；scrollIntoView 揭示光标
    //（r1 review P2-1：否则 Cmd+A → ArrowDown 光标到文档末尾但不可见）。
    const anchor = forward ? main.to : main.from;
    view.dispatch({ selection: { anchor }, scrollIntoView: true, userEvent: "select" });
    healCollapsedReveal(view, anchor);
    return true;
  }
  const target = verticalTarget(view, main, forward);
  if (target.head === main.head) return true; // 行首 ArrowUp / 行尾 ArrowDown：已无可移，仍视为已处理
  view.dispatch({
    selection: target,
    // scrollIntoView 传 SelectionRange（而非裸 pos）：caret 绘制与滚动测量都按
    // `range.assoc || 1` 取坐标 side，原子区邻接位必须带可见侧 assoc，否则测量
    // 退化成全零 rect、揭示滚动把整窗内容拉偏（M118）。
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: forward ? "move.line.down" : "move.line.up",
  });
  return true;
}

// 键位归统一层（M131）：⌃N/⌃P 与 ArrowUp/ArrowDown 的绑定在 keys.ts 的 KEY_BINDINGS，
// 命令实现仍是上面这两个函数——迁移只换了键位来源，移动语义与硬化原语一字未动。
// 原写法用 `{ mac: "Ctrl-n" }` 做平台分支（CM keymap 的 mac 标记）；现在 ⌃ 系一律归
// Emacs（D1），不再需要平台替换。

// 水平光标移动（M110/M111 真实桌面缺陷修复）：macOS Emacs 风格 Ctrl-F/B 原本走原生
// contenteditable 路径——原生 caret 无法进入 CM 的 replace 原子范围（公式
// widget），在边界卡住后经 posAtDOM 回弹跳过，永远无法进入公式。改由 CM 派发：
// 默认沿用 CM 语义（原子/隐藏装饰整体跳过）；唯一例外是数学公式——moveByChar
// 把隐藏 span 当原子一步跳过（落点在 span 另一侧边界）时，钳制为跨入 span 一个
// 字符。选区落入 span 即触发装饰显露（math.ts 选区重叠口径），源码可见、可继续
// 逐字符编辑；不会在隐藏源码长度上逐位空走。未装饰上下文（表格单元格/代码内的
// $）不产生原子跳步，钳制条件（落点越过 span 边界）不成立，逐字符通行不受影响。
/** display span 的收尾行在 span 之外是否有可见内容（全空白 = 该行随 widget 隐藏）。 */
function closingLineVisible(state: EditorState, s: MathSpan): boolean {
  const line = state.doc.lineAt(s.to);
  const prefix = s.from >= line.from ? state.doc.sliceString(line.from, s.from) : "";
  return (prefix + state.doc.sliceString(s.to, line.to)).trim() !== "";
}

function mathSpanCrossed(state: EditorState, from: number, to: number, forward: boolean): MathSpan | null {
  const winFrom = Math.max(0, Math.min(from, to) - 4096);
  const winTo = Math.min(state.doc.length, Math.max(from, to) + 4096);
  let best: MathSpan | null = null;
  for (const span of findMathSpans(state.doc.sliceString(winFrom, winTo))) {
    const s: MathSpan = { from: winFrom + span.from, to: winFrom + span.to, display: span.display };
    if (forward) {
      // from 在 span 起点或其左（span 内部意味着已显露、正常逐字符），且落点越过起点
      if (s.from < from || s.from >= to) continue;
      if (best === null || s.from < best.from) best = s;
    } else {
      // 光标已在 span 内（已显露，正常逐字符）不关涉
      if (s.to > from) continue;
      if (s.to < to) {
        // 落点越过 span 右端：仅当 display span 的收尾行随 widget 隐藏（span 之外
        // 全是空白）才算跨越——尾巴逐字符走过全是不可见空走（M118 真实桌面缺陷：
        // `$$` 闭合行带两个尾随空格时 Ctrl+B 需 6 次才进入公式）。收尾行有可见
        // 内容（如 `$$ 注释`）时尾巴照常逐字符通行。
        if (!s.display) continue;
        if (state.doc.lineAt(s.to).number !== state.doc.lineAt(to).number) continue;
        if (closingLineVisible(state, s)) continue;
      } else if (s.to === to) {
        // 跨行落点钉在 span 右边界是「边界空走」（M113 真实桌面缺陷）：块级公式
        // 下方段落 / 行尾公式下一行行首按 Ctrl-B，光标停在不可见的边界位不进入，
        // 需再按一次（实测共 3 次）。跨行到达时直接钳入 span。同一行内的边界
        // 停靠：行内 span 保留（那是可见的可编辑位置，M111 既有行为）；display
        // span 仅当收尾行有可见内容时保留——否则边界位随 widget 隐藏，停靠即空走。
        if (state.doc.lineAt(from).number === state.doc.lineAt(to).number) {
          if (!s.display) continue;
          if (closingLineVisible(state, s)) continue;
        }
      }
      if (best === null || s.to > best.to) best = s;
    }
  }
  return best;
}

/** caret 落点的可见侧 assoc：优先按给定方向取侧，坐标测量退化（隐藏 replace 邻接位）
 *  则翻转到另一侧——退化侧的 scrollIntoView 会把整窗内容下挫（M118 缺陷族机制）。 */
function caretAssoc(view: EditorView, pos: number, preferred: -1 | 1): -1 | 1 {
  return coordsDegenerate(view.coordsAtPos(pos, preferred)) ? (preferred === 1 ? -1 : 1) : preferred;
}

/** 水平移动的落点（不含选区形态处理）：扩选命令与 ⌃F/⌃B 共用同一原子块/数学公式口径。 */
function horizontalTarget(view: EditorView, from: SelectionRange, forward: boolean): number {
  let head = view.moveByChar(from, forward).head;
  const span = mathSpanCrossed(view.state, from.head, head, forward);
  if (span !== null) {
    // findClusterBreak 接收 string；取 ±64 字符窗口避免大文档整篇 sliceString。
    const edge = forward ? span.from : span.to;
    const winFrom = Math.max(0, edge - 64);
    const win = view.state.doc.sliceString(winFrom, Math.min(view.state.doc.length, edge + 64));
    head = winFrom + findClusterBreak(win, edge - winFrom, forward);
  }
  return head;
}

function moveCaretHorizontally(view: EditorView, forward: boolean): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到移动方向的一端。
    view.dispatch({ selection: { anchor: forward ? main.to : main.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  const head = horizontalTarget(view, main, forward);
  if (head === main.head) return true;
  // 落点 assoc 取可见侧（退化则翻转），理由见 caretAssoc。
  const target = EditorSelection.cursor(head, caretAssoc(view, head, forward ? 1 : -1));
  view.dispatch({
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: forward ? "move.char.forward" : "move.char.backward",
  });
  return true;
}

// 键位归统一层（M131）：⌃F/⌃B/⌃E 的绑定在 keys.ts 的 KEY_BINDINGS，命令实现不动。

// Ctrl-E / Ctrl-A（macOS 文本系统的行尾 / 行首）改由 CM 派发（M118 真实桌面缺陷：这两个键
// 原本走原生 contenteditable 路径——原生 caret 在 grid 表格 cell 内落点失控，实测落在隐藏
// 管道符边界上，落点坐标测量退化（coordsAtPos top≈0），揭示滚动随之把整窗内容下挫；与 M103
// 垂直移动、M111 水平移动同一修复口径）。M132 的扩选变体（⌃⇧E / ⌃⇧A）与它们共用同一落点
// 计算，硬化口径只此一份。

/** 落点是否画得出 caret：前侧（assoc +1，即落点后一个字符所属的 DOM 节点）可测量
 *  才算可停靠。隐藏 replace（表格管道符、标题尾部标记）之后的位置测量退化为全零或
 *  null——那里 caret 没有位置（M168 实测：原生 caret 矩形 0×0，WKWebView 上表现为
 *  「光标串到下一行 cell」）。判据与 ⌃A 场景的「行内第一个可测量位置」同一条。 */
function dockable(view: EditorView, pos: number): boolean {
  const coords = view.coordsAtPos(pos, 1);
  return coords !== null && !coordsDegenerate(coords);
}

// cell 归属与 cell 内容区间（含 M168/M185 的 ⌃E 落点口径）在 src/cell-geometry.ts——纯位置判定，
// 单独立模块是为了让 tests/unit 那一层能直接加载并驱动它（editor.ts 的 import 图 strip-only 加载不了）。

/** 行首 / 行尾落点（含隐藏 replace 退化回退）。
 *  moveToLineBoundary 取文本行边界（硬边界，段落语义，不受软换行截断）；落点藏进隐藏
 *  replace（表格管道符、标题尾部标记）时坐标测量退化，回退到可停靠位置（dockable）——
 *  这正是 M118 未修净的那一半：当时的回退判据看的是后侧（assoc -1）、而 caret 画在前侧，
 *  隐藏管道符边界因此被判成「可停靠」，落点停在无 caret 的边界位上（M168 真实桌面缺陷：
 *  「表格 cell 里 ⌃E，光标会进入下面一行的 cell，而不是移动到当前 cell 的末尾」）。
 *
 *  表格 cell 内的行尾 = **当前 cell 的内容右缘**（不是整个表格行的行尾——那是末 cell；
 *  也不是文本行行尾——那里是隐藏管道符边界）。行首不并入本口径：行的可见行首（首 cell
 *  内容起点）本身可停靠，⌃A 的行级语义照旧（见 keymap-commands spec）。assoc 取可见侧
 *  （行尾 -1、行首 1）：退化侧的 scrollIntoView 会把整窗内容拉偏（M118，实测 ⌃A 未修前
 *  scrollTop 下挫 62px）。 */
function lineBoundaryTarget(view: EditorView, from: SelectionRange, forward: boolean): { head: number; assoc: -1 | 1 } {
  const { doc } = view.state;
  let head = view.moveToLineBoundary(from, forward, false).head;
  let limit = forward ? doc.lineAt(head).from : doc.lineAt(head).to;
  if (forward) {
    const edge = cellContentEdge(view.state, from.head);
    if (edge) {
      head = edge.to;
      limit = edge.from;
    }
  }
  if (head !== from.head) {
    while (forward ? head > limit : head < limit) {
      if (dockable(view, head)) break;
      head = forward ? prevCluster(view.state, head, limit) : nextCluster(view.state, head, limit);
    }
  }
  return { head, assoc: caretAssoc(view, head, forward ? -1 : 1) };
}

function moveCaretToLineEnd(view: EditorView): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到右端；scrollIntoView 揭示光标。
    view.dispatch({ selection: { anchor: main.to }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  const { head, assoc } = lineBoundaryTarget(view, main, true);
  if (head === main.head) return true; // 已在行尾：仍视为已处理
  const target = EditorSelection.cursor(head, assoc);
  view.dispatch({
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: "move.line.end",
  });
  return true;
}

function moveCaretToLineStart(view: EditorView): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到左端；scrollIntoView 揭示光标。
    view.dispatch({ selection: { anchor: main.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  const { head, assoc } = lineBoundaryTarget(view, main, false);
  if (head === main.head) return true; // 已在行首：仍视为已处理
  const target = EditorSelection.cursor(head, assoc);
  view.dispatch({
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: "move.line.start",
  });
  return true;
}

// ---------------------------------------------------------------------------
// M132：编辑命令（删除 / 转置 / kill-yank / 翻屏 / 重定位 / keyboard-quit）与
// shift-extend 扩选
//
// 全部建在上面的硬化原语上（先取落点、assoc 取可见侧、scrollIntoView 传 SelectionRange、
// 退化测量回退、跨原子块钳制），不换用 CM stock 命令，也不把按键留给原生 contenteditable
// 路径。另加一条 M132 硬纪律：**表格 cell 内不跨过隐藏管道符**——grid 表格的行内管道符是
// 零宽 replace，跨过去删除即破坏表格结构（M129 survey 实证），故所有编辑命令先取所在 cell
// 的可见内容区间，再在其中取步长。
// ---------------------------------------------------------------------------

/** 编辑命令的可见边界：表格 cell 内用 cell 内容区间，表格外用整篇文档。 */
function editLimits(state: EditorState, pos: number): { from: number; to: number; clamp: CellClamp | null } {
  const clamp = cellClamp(state, pos);
  return { from: clamp?.from ?? 0, to: clamp?.to ?? state.doc.length, clamp };
}

/** 词字符（Emacs 词法口径的近似）：Unicode 字母 / 数字 / 下划线。 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const isWordChar = (ch: string): boolean => WORD_CHAR.test(ch);

/** 向前扫描同类码点（码点粒度，避免拆开代理对）；到 limit 或首个异类为止。 */
function scanForward(state: EditorState, pos: number, limit: number, match: (ch: string) => boolean): number {
  let i = pos;
  while (i < limit) {
    for (const ch of state.doc.sliceString(i, Math.min(limit, i + 256))) {
      if (!match(ch)) return i;
      i += ch.length;
    }
  }
  return Math.min(i, limit);
}

/** 向后扫描同类码点；到 limit 或首个异类为止。 */
function scanBackward(state: EditorState, pos: number, limit: number, match: (ch: string) => boolean): number {
  let i = pos;
  while (i > limit) {
    const chars = [...state.doc.sliceString(Math.max(limit, i - 256), i)];
    for (let k = chars.length - 1; k >= 0; k--) {
      if (!match(chars[k])) return i;
      i -= chars[k].length;
    }
  }
  return Math.max(i, limit);
}

/** Emacs forward-word：先跳过非词字符，再走到当前词尾。 */
function forwardWordEnd(state: EditorState, pos: number, limit: number): number {
  return scanForward(state, scanForward(state, pos, limit, (ch) => !isWordChar(ch)), limit, isWordChar);
}

/** Emacs backward-word：反向跳过非词字符，再走到词首。 */
function backwardWordStart(state: EditorState, pos: number, limit: number): number {
  return scanBackward(state, scanBackward(state, pos, limit, (ch) => !isWordChar(ch)), limit, isWordChar);
}

/** 下一个字素簇；换行符也是合法步长（Emacs C-d 在行尾删掉换行、两行合并）。 */
function nextCluster(state: EditorState, pos: number, limit: number): number {
  if (pos >= limit) return limit;
  const win = state.doc.sliceString(pos, Math.min(limit, pos + 64));
  return pos + Math.min(findClusterBreak(win, 0, true), limit - pos);
}

/** 上一个字素簇。 */
function prevCluster(state: EditorState, pos: number, limit: number): number {
  if (pos <= limit) return limit;
  const from = Math.max(limit, pos - 64);
  const win = state.doc.sliceString(from, pos);
  return from + findClusterBreak(win, win.length, false);
}

/** 删除一段并把光标落在删除起点：变更与落点同一事务（可见侧 assoc + 揭示滚动）。 */
function deleteRange(view: EditorView, from: number, to: number, userEvent: string): void {
  if (from >= to) return;
  const target = EditorSelection.cursor(from, caretAssoc(view, from, -1));
  view.dispatch({
    changes: { from, to },
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent,
  });
}

/** Emacs C-d：删除光标后的一个字符；有选区则删除选区。 */
function deleteCharForward(view: EditorView): void {
  const state = view.state;
  if (state.readOnly) return;
  const main = state.selection.main;
  if (!main.empty) {
    deleteRange(view, main.from, main.to, "delete.selection");
    return;
  }
  const limits = editLimits(state, main.head);
  const start = Math.max(main.head, limits.from);
  deleteRange(view, start, nextCluster(state, start, limits.to), "delete.char.forward");
}

/** Emacs C-h（macOS 退格键位）：删除光标前的一个字符；有选区则删除选区。 */
function deleteCharBackward(view: EditorView): void {
  const state = view.state;
  if (state.readOnly) return;
  const main = state.selection.main;
  if (!main.empty) {
    deleteRange(view, main.from, main.to, "delete.selection");
    return;
  }
  const limits = editLimits(state, main.head);
  const end = Math.min(main.head, limits.to);
  deleteRange(view, prevCluster(state, end, limits.from), end, "delete.char.backward");
}

/** Emacs M-d kill-word：kill 到下一个词尾（先跳过非词字符）。 */
function deleteWordForward(view: EditorView): void {
  const state = view.state;
  if (state.readOnly) return;
  const main = state.selection.main;
  if (!main.empty) {
    killRange(view, main.from, main.to, true);
    return;
  }
  const limits = editLimits(state, main.head);
  const start = Math.max(main.head, limits.from);
  killRange(view, start, forwardWordEnd(state, start, limits.to), true);
}

/** Emacs M-DEL backward-kill-word：kill 回上一个词首。 */
function deleteWordBackward(view: EditorView): void {
  const state = view.state;
  if (state.readOnly) return;
  const main = state.selection.main;
  if (!main.empty) {
    killRange(view, main.from, main.to, false);
    return;
  }
  const limits = editLimits(state, main.head);
  const end = Math.min(main.head, limits.to);
  killRange(view, backwardWordStart(state, end, limits.from), end, false);
}

/** 单槽 kill buffer（kill ring 后续）：连续同向 kill 相接时合并，其余 kill 覆盖。 */
let killSlot: { text: string; caret: number; forward: boolean } | null = null;

/** kill 一段：并入 kill 槽后删除。相接判定用「上次 kill 结束后的光标位置 = 本次 kill
 *  的相接端」——连续同向 kill（含 C-k C-k 先杀行内容再杀换行、⌥⌫ ⌥⌫ 连续杀词）因此合并
 *  成一条，与 Emacs 一致。**不变量**：deleteRange 把光标落在 `from`，故槽里记的 `caret`
 *  恒为 `from`（后向 kill 亦然）——后向的相接端是本次的 `to`，即上一次 kill 后的光标位置。
 *  已知近似：kill 之后若在**同一位置**做别的编辑再 kill，会误判为连续 kill（kill ring
 *  是后续版本的事，此处不为此引入全局命令序号）。 */
function killRange(view: EditorView, from: number, to: number, forward: boolean): void {
  if (from >= to) return;
  const text = view.state.doc.sliceString(from, to);
  const prev = killSlot;
  const joins = prev !== null && prev.forward === forward && prev.caret === (forward ? from : to);
  killSlot = {
    text: joins ? (forward ? prev.text + text : text + prev.text) : text,
    caret: from,
    forward,
  };
  deleteRange(view, from, to, "delete.kill");
}

/** Emacs C-k：kill 到行尾；已在行尾则连带换行（合并两行）。表格 cell 内只到 cell 尾，
 *  绝不跨过隐藏管道符；落点在管道符区（cell 间隙 / 行首尾）时不动文档。 */
function killLine(view: EditorView): void {
  const state = view.state;
  if (state.readOnly) return;
  const main = state.selection.main;
  if (!main.empty) {
    killRange(view, main.from, main.to, true);
    return;
  }
  const clamp = cellClamp(state, main.head);
  if (clamp) {
    killRange(view, Math.max(main.head, clamp.from), clamp.to, true);
    return;
  }
  const line = state.doc.lineAt(main.head);
  if (main.head < line.to) {
    killRange(view, main.head, line.to, true);
    return;
  }
  if (line.number < state.doc.lines) killRange(view, line.to, line.to + 1, true);
}

/** Emacs C-y：把 kill 槽插入光标处（替换选区），光标落在插入内容之后。 */
function yank(view: EditorView): void {
  const state = view.state;
  if (state.readOnly) return;
  const text = killSlot?.text ?? "";
  if (text === "") return;
  const main = state.selection.main;
  const head = main.from + text.length;
  // assoc 只能在**插入前**的文档里测量：插入把文档延伸出去时（在文档末尾 yank，槽内容比
  // 光标之后的剩余文档还长），head 已越出当前文档长度——coordsAtPos 内部的 doc.lineAt
  // 会抛 RangeError，命令无声失败（自证阶段实测：⌥⌫ ⌥⌫ → ⌃Y 在短文档里完全不生效）。
  // 越界时退化为按插入起点取可见侧 assoc——起点必在当前文档内。
  const assoc = head <= state.doc.length ? caretAssoc(view, head, 1) : caretAssoc(view, main.from, 1);
  const target = EditorSelection.cursor(head, assoc);
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: text },
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: "input.yank",
  });
}

/** Emacs C-t：转置光标两侧字符并把光标移到两者之后；已在行尾 / cell 尾时转置前两个。
 *  有选区时不插手（v0 无 mark mode）；落点在隐藏管道符区时不动文档。 */
function transposeChars(view: EditorView): void {
  const state = view.state;
  if (state.readOnly) return;
  const main = state.selection.main;
  if (!main.empty) return;
  const limits = editLimits(state, main.head);
  if (limits.clamp && !limits.clamp.inside) return;
  const line = state.doc.lineAt(main.head);
  const from = Math.max(line.from, limits.from);
  const to = Math.min(line.to, limits.to);
  const pos = Math.min(Math.max(main.head, from), to);
  const left = prevCluster(state, pos, from);
  const next = nextCluster(state, pos, to);
  if (left < pos && next > pos) {
    const a = state.doc.sliceString(left, pos);
    const b = state.doc.sliceString(pos, next);
    const target = EditorSelection.cursor(next, caretAssoc(view, next, -1));
    view.dispatch({
      changes: { from: left, to: next, insert: b + a },
      selection: target,
      effects: EditorView.scrollIntoView(target, { y: "nearest" }),
      userEvent: "move.transpose",
    });
    return;
  }
  const prev = prevCluster(state, left, from);
  if (prev >= left) return;
  const a = state.doc.sliceString(prev, left);
  const b = state.doc.sliceString(left, pos);
  view.dispatch({ changes: { from: prev, to: pos, insert: b + a }, userEvent: "move.transpose" });
}

/** Emacs C-v / M-v：视口翻屏。只滚视口、不移动光标（阅读推进用）；光标若被滚出视口，
 *  后续移动命令自身的 scrollIntoView 会把它揭示回来。 */
function scrollPage(view: EditorView, forward: boolean): void {
  const scroller = view.scrollDOM;
  const step = Math.max(scroller.clientHeight - 2 * view.defaultLineHeight, 24);
  scroller.scrollTop += forward ? step : -step;
}

/** Emacs C-l：把光标行滚到视口居中（v0 只做居中，不做 Emacs 的居中/页首/页尾三段循环）。 */
function recenter(view: EditorView): void {
  const main = view.state.selection.main;
  const target = EditorSelection.cursor(main.head, caretAssoc(view, main.head, main.assoc || 1));
  view.dispatch({ effects: EditorView.scrollIntoView(target, { y: "center" }) });
}

/** Emacs C-g keyboard-quit：撤下进行中的选择（折叠为光标，保持点不动）。多段 chord 的
 *  pending 由分发器自身在无关按键上清空，无需命令介入。 */
function keyboardQuit(view: EditorView): void {
  const main = view.state.selection.main;
  if (main.empty) return;
  const head = main.head;
  view.dispatch({
    selection: EditorSelection.cursor(head, caretAssoc(view, head, main.assoc || 1)),
    userEvent: "select",
  });
}

/** 扩选落点：保持 anchor，只把 head 移到目标位置（goalColumn 一并保留，列位不漂）。 */
function extendSelection(view: EditorView, head: number, preferred: -1 | 1, goalColumn: number | undefined): void {
  const anchor = view.state.selection.main.anchor;
  const target = EditorSelection.cursor(head, caretAssoc(view, head, preferred), undefined, goalColumn);
  view.dispatch({
    selection: EditorSelection.create([EditorSelection.range(anchor, head, target.goalColumn)]),
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: "select",
  });
}

/** ⌃⇧F / ⌃⇧B：逐字符扩选（落点口径同 ⌃F / ⌃B，含数学公式原子跨入钳制）。 */
function extendHorizontally(view: EditorView, forward: boolean): void {
  const main = view.state.selection.main;
  const from = EditorSelection.cursor(main.head, main.assoc || (forward ? 1 : -1));
  const head = horizontalTarget(view, from, forward);
  if (head !== main.head) extendSelection(view, head, forward ? 1 : -1, main.goalColumn);
}

/** ⌃⇧N / ⌃⇧P：逐行扩选（落点口径同 ⌃N / ⌃P，含跨原子块钳制与表格行路由）。 */
function extendVertically(view: EditorView, forward: boolean): void {
  const main = view.state.selection.main;
  const from = EditorSelection.cursor(main.head, main.assoc || (forward ? 1 : -1), undefined, main.goalColumn);
  const target = verticalTarget(view, from, forward);
  if (target.head !== main.head) extendSelection(view, target.head, (target.assoc || 1) as -1 | 1, target.goalColumn ?? main.goalColumn);
}

/** ⌃⇧A / ⌃⇧E：扩选到行首 / 行尾（落点口径同 ⌃A / ⌃E）。 */
function extendToLineBoundary(view: EditorView, forward: boolean): void {
  const main = view.state.selection.main;
  const from = EditorSelection.cursor(main.head, main.assoc || 1);
  const { head, assoc } = lineBoundaryTarget(view, from, forward);
  if (head !== main.head) extendSelection(view, head, assoc, main.goalColumn);
}

/** ⌥⇧F / ⌥⇧B：按词扩选（词法口径与 ⌥D / ⌥⌫ 同一份扫描器；cell 内不跨过隐藏管道符）。 */
function extendByWord(view: EditorView, forward: boolean): void {
  const state = view.state;
  const main = state.selection.main;
  const limits = editLimits(state, main.head);
  const head = forward
    ? forwardWordEnd(state, Math.max(main.head, limits.from), limits.to)
    : backwardWordStart(state, Math.min(main.head, limits.to), limits.from);
  if (head !== main.head) extendSelection(view, head, forward ? 1 : -1, main.goalColumn);
}

export type EditorReadyPhase =
  | "source-ready"
  | "decoration-ready"
  | "frontmatter-ready"
  | "paint";

export interface EditorReadyEvent {
  phase: EditorReadyPhase;
  path: string | undefined;
  requestId?: number;
  frontmatter: "present" | "absent";
  time: number;
}

export type EditorReadyListener = (event: EditorReadyEvent) => void;

/**
 * 一个**文档会话**（M149 多标签）：一份 EditorState + 逐文档的记账。
 *
 * 架构口径：全应用只有一个 EditorView，切标签走 `view.setState(会话的 state)`——
 * 撤销史（history 是 StateField）、语法树、选区、搜索查询、模式配置都随 state 走，
 * 切回来**不重新解析、不丢撤销栈**。这与「重建 view」的区别是可观测的：重建会丢掉
 * 撤销史与语法树，`setState` 不会。
 *
 * 会话对象是**活的**：内核在激活期间每次 dispatch 后回写 `state`，切走时回写滚动位置；
 * 装配层据此渲染标签栏，不要再自己缓存一份。
 */
export interface EditorSession {
  /** 会话 id（单调递增，供标签栏做 DOM key / 断言；顺序由 sessions() 的数组序决定）。 */
  readonly id: number;
  /** 当前状态：激活期间每次 dispatch 后回写，非激活会话是上次切走时的那一份。 */
  state: EditorState;
  /** 文档的 vault 相对路径；未命名文档（空态 / 新建）为 undefined。 */
  path: string | undefined;
  /** dirty 判定基准：最近一次装载或保存时的全文。 */
  cleanDoc: string;
  /** 相对 cleanDoc 是否有改动。 */
  dirty: boolean;
  /**
   * 该会话的编辑器模式。**逐会话**存在这里而不是内核的一个单值：`changeFilter` 的
   * 非 md 拦截闭包读它，切标签时必须与 state 一起换，否则前台是 code 会话而模式变量
   * 还停在 md，拦截会错判（install 期 setMode 也可能改模式，故不能只按路径反推）。
   */
  mode: EditorMode;
  /**
   * 「可被复用」的临时会话标记（M149 预览标签）。内核**不读**这个字段——它是装配层
   * 的标签属性：单击文件树建立的会话标 true，下一次单击树文件就地替换它而不新开标签；
   * 双击或首次输入即置 false（固定）。放在会话上而不是装配层的 Map 里，是因为
   * 会话被关闭时这个标记必须随之消失，两处各存一份必然漂移（REVIEW.md 第 8 条）。
   */
  preview: boolean;
  /**
   * 离开该会话时的滚动位置快照（`view.scrollSnapshot()` 的产物）。**滚动不在 CM state 里**
   *（只存在于 scrollDOM），所以必须逐会话单独存，否则切标签会继承上一篇的滚动位置。
   *
   * 存快照而不是裸 `scrollTop`：快照记的是「某个文档位置 + 相对视口的偏移」，恢复时报给
   * CM 的 `scrollTarget` 由它自己的测量周期落地，不受两份内容高度差与排版变化的影响；
   * 直接写 `scrollDOM.scrollTop` 会被 CM 的滚动锚点维护逻辑改掉（M149 实测差 242px）。
   */
  scroll: ScrollSnapshot | undefined;
}

export interface EditorHandle {
  view: EditorView;
  /**
   * 编辑器侧命令实现（keys.ts 统一键位层的全部 editor.* 命令，由装配处注入分发器）。
   * 命令只读 view 的当前状态并自行 dispatch；命中即视为已消费，无事可做也不放行
   * 原生路径（例如 ⌘Z 在历史为空时同样吞掉默认行为，避免浏览器原生撤销插手文档）。
   */
  commands: Record<EditorCommandId, CommandRunner>;
  /**
   * 显式切换模式（配置加载 / 用户切换）：除热切换当前模式外，同时把该模式记为
   * 配置默认基线，createSession 对无文件上下文（path 缺失）文档的回落以此为锚。
   * Compartment 热切换，不重建 view。
   */
  setMode(mode: EditorMode): void;
  mode(): EditorMode;
  /**
   * 设置**应用运行期**的折行口径（M180，D1 裁决原话「应用级」）：配置加载（启动时喂初值）与
   * 两条 toggle 命令都走这一个入口，全部会话随即同步重配。只传要改的轴，未传的轴保持不变；
   * 值没变时直接返回，不做无谓的全量重配。不写文档、不进撤销栈、不碰 dirty、不落盘。
   */
  setWrap(next: Partial<WrapSettings>): void;
  /** 当前应用运行期的折行口径（只读快照：命令层据此翻转，断言据此读值）。 */
  wrapSettings(): WrapSettings;
  /** 翻转文件级折行（正文行）——应用运行期状态，全部会话同步生效。 */
  toggleLineWrap(): void;
  /** 翻转代码块折行——同左；非 md 文件没有围栏渲染，翻转对它无可观测效果。 */
  toggleCodeBlockWrap(): void;
  /**
   * 施加排版配置（change typography-and-zoom）：写 `--editor-*` token 并请求重测量（唯一写入
   * 路径，见实现处的注释）。装配层在 `config_get` 之后调用一次；启动之后只有三条步进命令改
   * 字号。返回值为配置值层面的 warning（非法字族），由装配层按既有口径记 console + 诊断日志。
   */
  applyTypography(settings: TypographySettings): readonly string[];
  /** 字号步进一档 / 回到配置字号（应用运行期口径，不落盘）。 */
  textScale(direction: TextScaleDirection): void;
  /**
   * 新建一个**空文档**会话（M149）：建立逐会话记账，但不装载内容、不激活。
   * 路径与内容由调用方随后的 reloadSession 补上（装载走事务派生，会话因此能继承
   * 搜索面板一类的 StateField 状态；新建 state 会把它们丢掉）。模式先取配置默认基线，
   * 装载时按路径裁决。
   */
  createSession(): EditorSession;
  /**
   * 用新内容改写一个既有会话（外部重载 / 放弃我的修改 / 恢复崩溃备份）。
   * 目标会话不在前台时只换它的 state，不碰 view。
   */
  reloadSession(session: EditorSession, doc: string, path: string | undefined, requestId?: number): void;
  /**
   * 激活会话：把 view 的 state 换成它那一份，并恢复该会话的滚动位置。
   * 同步调用、无异步等待——切换只换 state，不重新解析文档。
   */
  activateSession(session: EditorSession): void;
  /** 当前激活的会话。 */
  activeSession(): EditorSession;
  /** 全部会话，按创建顺序（= 标签栏的从左到右顺序）。 */
  sessions(): readonly EditorSession[];
  /** 按路径查会话；未打开返回 undefined。 */
  sessionForPath(path: string): EditorSession | undefined;
  /** 关闭会话：从列表中摘除（脏内容由调用方先行确认）。 */
  closeSession(session: EditorSession): void;
  /** 按路径标记「已与磁盘同步」：更新 cleanDoc 并清 dirty（保存成功 / 重载后）。 */
  markCleanOf(path: string, content: string): void;
  /** 监听文档装载、装饰和首个 paint 的可观测阶段。 */
  onReady(listener: EditorReadyListener): () => void;
  /**
   * 清空全部会话并复位上下文（vault 切换 / 关闭时调用）：只留一个未命名空文档会话，
   * 模式回到配置默认基线（defaultMode，与 createSession 对无文件上下文文档的回落锚
   * 一致——不继承上一个文件漂移出的模式）。
   */
  reset(): void;
  /**
   * 注入附件能力（add-vault-workspace 的 fs-io「二进制附件读取」，vault 波在装配处调用）。
   * 未注入时附件引用显示占位；默认 provider 已按裁决 A 契约编码但无 vault 索引。
   */
  setAttachmentProvider(provider: AttachmentProvider): void;
  /**
   * 注入 wikilink 解析器（add-wikilink；vault 打开后由装配处注入，关闭时置 null）。
   * 装饰层据此做三态渲染；null 时走降级渲染（不做语义判断）。
   */
  setWikilinkResolver(resolver: WikilinkResolver | null): void;
  /**
   * 注入图片放大查看的遮罩（M184）；未注入（维护性调用 / 纯桩）时图片没有双击路径。
   */
  setLightbox(lightbox: ImageLightbox | null): void;
  /** 强制重建装饰（解析缓存更新 / watch 增量后调用）。 */
  refreshPreview(): void;
  /** 滚动定位到 1-based 行号并把光标移到行首（wikilink 锚点跳转用）。 */
  revealLine(line: number): void;
  /**
   * 读当前前台视图的阅读位置（捕获侧唯一构造点；值语义见 src/scroll-position.ts）。
   * 不可读（锚处没有可量的字符盒）返回 null——调用方按「本次不记录」处理，不写半个值。
   */
  readScrollPosition(): ScrollPosition | null;
  /**
   * 按公开通道施加一个阅读位置（恢复侧唯一入口；装载复位之后调用）。
   * 位置不可读、或落点即篇首时**静默不施加**（沿用复位结果），不抛错、不提示。
   */
  applyScrollPosition(position: ScrollPosition): void;
  /** 订阅前台滚动容器的滚动信号（捕获侧的信号源）；返回退订函数。 */
  onScroll(listener: () => void): () => void;
  /** 前台会话是否相对它的 dirty 基准有改动。 */
  isDirty(): boolean;
  onDirty(listener: (dirty: boolean) => void): () => void;
  /**
   * 监听**前台会话**的内容变化（每次 docChanged）。保存链路的自动保存排期挂这里。
   * M149 之前它由 save-controller 往 view 上 appendConfig 一个 updateListener 实现；
   * appendConfig 只作用于当时那一个 state，新建会话会漏掉它——自动保存因此会静默失效，
   * 所以改成内核的正式回调（回调进所有会话，与 appendConfig 无关）。
   */
  onDocChanged(listener: () => void): () => void;
}

// code 模式的语法高亮（M120）：扩展名 → 语言名的映射是注册表（preview/attachments.ts
// 的 CODE_EXTENSIONS）的职责；语言名 → CM6 Language 的表由 preview/code.ts 单一持有
// （LANGUAGES 同时供 markdown 围栏代码块使用，编译期合同见其注释）。

/** code 模式按扩展名取语言包；无扩展名线索或该扩展无语言包返回 null（纯文本，不着色）。 */
function codeLanguageFor(path: string | undefined): Language | null {
  if (path === undefined) return null;
  const name = codeLanguage(extensionOf(path));
  return name === null ? null : LANGUAGES[name];
}

// code 模式 token 配色（change restyle-ui-tokens-v1，R2b）：色值**只**取自 tokens 文档的四个
// 语法高亮 token（--tk-k/s/n/c），与围栏侧（src/preview/theme.ts 的 .cm-lp-tok-*）逐 role 同值。
// tag 分组与「条目序即优先级」由 preview/code.ts 的 TOKEN_GROUPS 单一持有，这里只把每个 role
// 映射成色值与字重——两侧不再各写一份 tag 列表（Record<TokenRole, …> 让分组增删在此处编译报错）。
// 六个 role 落四个 token：property（json/yaml 的键）与 type 归 keyword 同色；键与字符串值恒不
// 同色（JSON/YAML 的既有 requirement 仍成立）。**已知缺口（在案）**：eink 规则②要求 keyword 在
// eink 下升到 700，本路径的色值/字重是 HighlightStyle 的运行期规则，选择器由 CM 生成、无法按
// `data-theme` 加限定（围栏侧那份在 theme.ts 里已实现）——两侧在 eink 的字重档因此有差异，
// 修法（把本路径改成 code.ts 的 class 表 + 共用一份 theme）见 docs/backlog.md。
const CODE_COLORS: Record<TokenRole, { color: string; fontWeight?: string }> = {
  comment: { color: "var(--tk-c)" },
  keyword: { color: "var(--tk-k)", fontWeight: "600" },
  string: { color: "var(--tk-s)" },
  literal: { color: "var(--tk-n)" },
  property: { color: "var(--tk-k)" },
  type: { color: "var(--tk-k)" },
};

const codeHighlight = syntaxHighlighting(
  HighlightStyle.define(TOKEN_GROUPS.map((group) => {
    const { color, fontWeight } = CODE_COLORS[group.role];
    return fontWeight === undefined ? { tag: group.tags, color } : { tag: group.tags, color, fontWeight };
  })),
  { fallback: true },
);

/** 打开文件时的模式裁决（M130 方向 A）：.md/.markdown → md；其余**一切已打开的文件**
 *  一律 code（只读）——不再回落配置默认。旧口径把 .php/.svelte/.txt 等未收录扩展交给
 *  defaultMode，出厂为 md：文件可编辑、可 dirty，却没有磁盘 revision 可保存（main.ts
 *  只为 md 登记 revision），Cmd+S 静默失败，dirty 又锁死切换与退出。无扩展名线索的
 *  文件（basename 无点如 LICENSE/Makefile）同样是「非 md」，一并只读（tower 裁决 M130
 *  评审：D4「非 md 即只读」优先于任务书「ext 缺失保持 fallback」的字面）。
 *  配置默认基线只对「没有文件上下文」的文档有意义：path 缺失（空态 / 新建 / reset）。 */
function modeForPath(path: string | undefined, fallback: EditorMode): EditorMode {
  if (path === undefined) return fallback;
  return fileClass(extensionOf(path)) === "md" ? "md" : "code";
}

/**
 * 折行相关扩展的**唯一装配点**（M180）：判定在 `preview/theme.ts` 的 `wrapSpec`，这里只把
 * 判定结果装成扩展——正文行看 `lineWrap`（CM 的 `EditorView.lineWrapping`，把 `.cm-content`
 * 改成 break-spaces），代码块行看 `codeBlockWrap`（内容级 class，样式同一模块），`mode`
 * 只决定代码块那一层有没有作用对象（非 md 不装）。
 */
function wrapExtensions(mode: EditorMode, settings: WrapSettings): Extension[] {
  const spec = wrapSpec(mode, settings.lineWrap, settings.codeBlockWrap);
  const extensions: Extension[] = spec.lineWrapping ? [EditorView.lineWrapping] : [];
  if (spec.codeBlockClass !== null) {
    extensions.push(EditorView.contentAttributes.of({ class: spec.codeBlockClass }));
  }
  // 代码块的块级横滚容器（M180）：只有「代码块不折行」时才装——折行打开时没有任何东西需要
  // 横滚，装一个空容器只会多出一个空的 `region`（spec 的「代码块折行可显式打开」明确要求
  // 那种口径下 MUST NOT 出现块内横向滚动容器）。装/卸走同一个 Compartment，翻转即生效。
  if (mode === "md" && !settings.codeBlockWrap) {
    extensions.push(EditorView.blockWrappers.of(codeBlockWrappers));
  }
  return extensions;
}

export function createEditor(parent: HTMLElement, initialMode: EditorMode = "md", markdownConfig: Parameters<typeof markdown>[0] = { base: markdownLanguage, extensions: [GFM] }): EditorHandle {
  const modeCompartment = new Compartment();
  /** 折行口径的 Compartment（M180）：正文行的 `lineWrapping` 与代码块行的内容级 class 都装在
   *  它里面，翻转走一次 reconfigure（与 modeCompartment 并列同形）。 */
  const wrapCompartment = new Compartment();
  // 前台会话模式的**投影**：changeFilter 的闭包在 state 创建时就绑好了，只能读实例变量，
  // 所以模式真源放在会话上（EditorSession.mode），这里只是把它投给创建期闭包。
  // 唯一写入点是 syncMode()，由激活 / 装载 / setMode 三处调用——不构成第二份真源。
  let currentMode = initialMode;
  // 配置默认基线：createSession 对无文件上下文（path 缺失）文档的回落锚在这里；
  // 只有 setMode（配置加载 / 用户显式切换）会移动它，装载本身不改。
  let defaultMode = initialMode;
  /**
   * 折行口径的**应用运行期真源**（M180，D1 裁决原文「应用级」，见 `setWrap`）：一份值管全部
   * 会话——翻转时遍历 session 逐个重配，新建 / 装载会话都从这里起步。这里**不是**「新标签页的
   * 起点」：配置项只在启动时喂一次初值，之后的翻转对所有会话（含新开的）立即生效。
   */
  let wrap: WrapSettings = { lineWrap: DEFAULT_LINE_WRAP, codeBlockWrap: DEFAULT_CODE_BLOCK_WRAP };
  /**
   * 排版口径的**应用运行期真源**（change typography-and-zoom）：配置只在启动时喂一次初值，
   * 之后由三条 `view.text-scale-*` 命令推进（D5 裁决「不持久化」——不落盘、不回写
   * config.json、不进撤销栈、不碰 dirty）。一份值管全部会话：真值经 documentElement 上的
   * token 表达，因此后台标签页与**随后新建**的会话天然取当前运行期值（新标签页 MUST NOT
   * 取配置默认）。
   */
  let typography: TypographySettings = {
    fontFamily: null,
    monoFontFamily: null,
    fontSize: DEFAULT_FONT_SIZE,
  };
  /** `reset` 回到的那一份字号（D4：回到**配置值**，不是出厂 16px）。 */
  let baseFontSize = DEFAULT_FONT_SIZE;
  let provider: AttachmentProvider = createInvokeAttachmentProvider();
  let wikilinkResolver: WikilinkResolver | null = null;
  /** 图片放大查看的遮罩（M184）：装配层注入，装饰层只经 PreviewContext 取用。 */
  let lightbox: ImageLightbox | null = null;
  const readyListeners = new Set<EditorReadyListener>();
  let readyPath: string | undefined;
  let readyRequestId: number | undefined;
  let readySerial = 0;
  const dirtyListeners = new Set<(dirty: boolean) => void>();
  /** 文档内容变化（docChanged）的订阅者：保存链路的自动保存排期挂在这里，取代
   *  save-controller 原先往 view 上 appendConfig 一个 updateListener 的写法
   *（那条路径由 M149 收编——扩展追加只作用于当时那一个 state，新建会话会漏掉它）。 */
  const docChangedListeners = new Set<() => void>();
  const trustedLoad = Annotation.define<boolean>();

  // ---------------------------------------------------------------------------
  // 会话（M149 多标签）：sessions 按创建顺序持有全部文档会话，active 是前台那一个
  // ---------------------------------------------------------------------------
  let sessionSerial = 0;
  const sessions: EditorSession[] = [];
  /** 前台会话。`updateDirty` / `cleanDoc` / `currentPath` 这些原本的实例级单值
   *  一律改从它读，避免「内核以为在改 A、其实 view 显示的是 B」这类静默错配。 */
  let active: EditorSession;

  /**
   * 运行时经 `StateEffect.appendConfig` 追加到 view 上的扩展（当前只有 src/toc.ts
   * 用它装大纲的 updateListener）。appendConfig 的语义是「追加到**当时那一个**
   * state 的 config」（@codemirror/state 的 Configuration 合并规则），新建会话若不
   * 显式带上，那些监听会在切标签后静默失效——大纲指示段停更是最难查的一类。
   *
   * 收集靠下面的 updateListener 读事务里的 appendConfig 效果：谁追加、追加什么，
   * 内核不需要知道，因此 toc.ts 维持零改动（它不在本 mission 的改动面内）。
   */
  const appendedExtensions: Extension[] = [];
  function collectAppendedExtensions(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (!effect.is(StateEffect.appendConfig)) continue;
        for (const extension of Array.isArray(effect.value) ? effect.value : [effect.value]) {
          if (!appendedExtensions.includes(extension)) appendedExtensions.push(extension);
        }
      }
    }
  }

  // 装载/复位事务（打开文件、外部重载、vault 切换清空）不进撤销史（M131）：
  // 它们的 addToHistory 标 false，CM history 只把这次替换累积成 mapping 并作用到已有
  // 事件上——整篇替换会把旧事件的位置映射力竭，事件被逐个丢弃（实测：装载后
  // undoDepth 归零、undo 返回 false）。这样 ⌘Z 不会把上一个文件的内容"撤"回新文档里。
  function dispatchTrusted(spec: Parameters<EditorView["dispatch"]>[0]): void {
    view.dispatch({
      ...spec,
      annotations: [trustedLoad.of(true), Transaction.addToHistory.of(false)],
    });
  }

  function updateDirty(next: boolean): void {
    if (active.dirty === next) return;
    active.dirty = next;
    dirtyListeners.forEach((listener) => listener(next));
  }

  /**
   * 改某个会话的 dirty 并广播。前台会话走这里；**后台会话同样要广播**——标签栏的
   * dirty 点是逐标签的，不广播就会一直留着旧状态（可达路径：冲突浮条还开着时切走，
   * 再点它的「强制覆盖保存」）。
   */
  function setSessionDirty(session: EditorSession, next: boolean): void {
    if (session === active) {
      updateDirty(next);
      return;
    }
    if (session.dirty === next) return;
    session.dirty = next;
    dirtyListeners.forEach((listener) => listener(next));
  }

  function emitReady(phase: EditorReadyPhase): void {
    const event: EditorReadyEvent = {
      phase,
      path: readyPath,
      requestId: readyRequestId,
      frontmatter: detectFrontmatter(view.state.doc) ? "present" : "absent",
      time: performance.now(),
    };
    readyListeners.forEach((listener) => listener(event));
  }

  function schedulePaint(serial: number): void {
    requestAnimationFrame(() => {
      if (serial !== readySerial || readyPath !== active.path) return;
      emitReady("paint");
    });
  }

  // doc-meta「修改于」的 mtime 缓存（M218 A1）：键 = vault 相对路径。装饰层构建期
  // 只读缓存（fileMtime）；未缓存时这里后台取数，到达后 previewRefresh 触发重建
  //（wikilinkResolver 的 pending 范式）。三条刷新路径：reloadSession（打开 / 外部
  // 重载 / 恢复——磁盘内容可能已变，一律重取）、activateSession（缓存命中即零成本）、
  // markCleanOf（保存落盘后 mtime 必变，废掉重取）。
  const mtimeCache = new Map<string, number | null>();
  const mtimeInflight = new Set<string>();
  function ensureMtime(path: string | undefined): void {
    if (path === undefined || mtimeCache.has(path) || mtimeInflight.has(path)) return;
    mtimeInflight.add(path);
    fsFileMtime(path).then((meta) => {
      mtimeInflight.delete(path);
      mtimeCache.set(path, meta.mtime_ms);
      // 路径仍属于某个会话才触发重建（reset / 关标签后到達的迟到响应不打扰前台）。
      if (sessions.some((s) => s.path === path)) view.dispatch({ effects: previewRefresh.of(null) });
    }).catch(() => {
      // 无 Tauri 后端（纯浏览器预览）或读取失败：不缓存，下次触发路径自然重试。
      mtimeInflight.delete(path);
    });
  }

  const previewContext: PreviewContext = {
    // 活读前台会话的路径：装饰层（wikilink / 附件相对路径解析）必须用**当前显示
    // 那一份文档**的基准，切标签时它随 active 一起换（M149 前的静默错误面就在这里）。
    // 启动早期（EditorView 的 StateField create 早于 active 赋值）读到 undefined：
    // 装饰层按「无文件上下文」降级渲染，首个会话激活后随状态重建自然补齐（M218 A1）。
    currentFilePath: () => active?.path,
    attachmentProvider: () => provider,
    wikilinkResolver: () => wikilinkResolver,
    lightbox: () => lightbox,
    fileMtime: (path) => mtimeCache.get(path),
  };

  // 编辑器失焦时 CM 不回写 DOM 选区（M110 真实桌面缺陷）：打开新文档替换整篇
  // 内容后，旧文档的原生选区被浏览器节点钳制映射进新 DOM，用户看到"意外选中
  // 一段内容"而 CM 态光标在 0。装载/清空后焦点不在编辑器时显式清空原生选区；
  // 编辑器聚焦时 CM 自行同步，不干预。
  function collapseDomSelectionIfBlurred(): void {
    if (view.hasFocus) return;
    view.dom.ownerDocument.getSelection()?.removeAllRanges();
  }

  function modeExtensions(mode: EditorMode, path?: string): Extension[] {
    // md 走 lezer markdown 解析器（高亮规则维持 M1 以来口径不动）；
    // code 按扩展名选 legacy-modes StreamLanguage（M120），未知扩展纯文本不着色。
    const highlight: Extension[] = mode === "md"
      ? [
          markdown(markdownConfig),
          syntaxHighlighting(
            HighlightStyle.define([
              { tag: tags.comment, color: "var(--text-3)" },
              { tag: [tags.keyword, tags.operator, tags.punctuation], color: "var(--text)" },
              { tag: [tags.string, tags.regexp, tags.number], color: "var(--accent)" },
              { tag: [tags.link, tags.url], color: "var(--accent)", textDecoration: "underline" },
              { tag: tags.heading, color: "inherit", fontWeight: "inherit" },
              { tag: tags.strong, fontWeight: "700" },
              { tag: tags.emphasis, fontStyle: "italic" },
              { tag: tags.strikethrough, textDecoration: "line-through" },
            ]),
            { fallback: true },
          ),
        ]
      : (() => {
          const language = codeLanguageFor(path);
          // 双击标识符高亮同一变量（M198）：只装进 code 分支，且只有 T1 的 8 门语言有落点
          //（判定在 code-identifiers 的 supportsVariableBinding，语言分层的单一来源是
          // code-structure 的 STRUCTURE_SUPPORT）。md 分支零改动——本能力不做 md 模式。
          const binding = bindingHighlight(path === undefined ? null : codeLanguage(extensionOf(path)));
          return language ? [language, codeHighlight, binding] : [codeHighlight, binding];
        })();
    // CM6 的基础层必须继承 shell 的排版基线配色（ADR 0006，单一基线）；live
    // preview 只增加 Markdown 语义装饰，避免 code 模式落回默认白底、灰 gutter 或默认选区颜色。
    //
    // 字体族取**编辑器作用域**的 token（change typography-and-zoom）：md 走 `--editor-font-family`、
    // code 走 `--editor-mono-family`，两者缺省分别引用基线的 `--font-sans` / `--font-mono`
    //（见 src/style.css 的 :root）。MUST NOT 在这里直接引用 shell 基线 token——那会让「配置只
    // 影响编辑器」从结构事实退化成「逐处记得别改」。
    // 取色一律走 token 层（change restyle-ui-tokens-v1）；族的取法见上一条注释。
    const baseTheme = EditorView.theme({
      "&": {
        color: "var(--text)",
        backgroundColor: "var(--content-bg)",
        fontFamily: mode === "md" ? "var(--editor-font-family)" : "var(--editor-mono-family)",
      },
      // 阅读栏宽（design §4 未决项 1 的落法）：中列**定值** `--layout-doc-measure`（664px，
      // tokens 文档 §布局尺寸），两侧 `minmax(24px, 1fr)` 等分剩余空间 ⇒ 正文列在视口内居中；
      // 旧口径 `--measure: 80%`（百分比）随之退役。正文自己的 32px/44px/20px 内边距在下一条
      // （`--sp-11/--sp-13/--sp-9`，tokens 文档 §间距阶梯点名的「正文 padding」高频出处），
      // 因此 664px 是**框宽**、文字实测宽 576px——与定稿图 `.doc { max-width:664px;
      // padding:32px 44px 20px }`（border-box）逐项一致。
      //
      // code 模式（design §4 未决项 1 的另一半，口径落地见 test-results/m212/）：模板不变
      // （行的左列要容下 gutter），中列同样换成定值。行为口径：`minmax(max-content, 1fr)`
      // 的 gutter 列与 `minmax(0, 1fr)` 的右列都是弹性轨道，中列的非弹性轨道先被撑满到
      // 664px 上限，剩余空间再由这两列**等分**——即 gutter 列的最终宽度 = 行号自然宽 + 剩余
      // 空间的一半，代码正文列恒为 664px。这是旧口径（80% 中列 + 同样的两侧模板）的同一形态，
      // 只是中列从 80% 变定值：代码文件视图仍是「行号贴在中列左缘、列外余白由左右两列吸收」。
      ".cm-scroller": {
        fontFamily: "inherit", lineHeight: "var(--lh-reading)",
        display: "grid !important", gridTemplateColumns: mode === "md"
          ? "minmax(24px, 1fr) minmax(0, var(--layout-doc-measure)) minmax(24px, 1fr)"
          : "minmax(max-content, 1fr) minmax(0, var(--layout-doc-measure)) minmax(0, 1fr)",
        alignItems: "start",
      },
      ".cm-content": {
        fontFamily: "inherit", fontSize: "var(--editor-font-size)",
        gridColumn: "2", gridRow: "1", minWidth: "0", width: "100%",
        marginInline: "0", paddingBlock: "var(--sp-11) var(--sp-9)", paddingInline: "var(--sp-13)",
        textAlign: "start", textIndent: "0", hangingPunctuation: "none", textAutospace: "no-autospace",
      },
      ".cm-line": { padding: "0" },
      // gutter（code 模式的只读行号）：提示档文字色 + 框体底色 + 结构档右缘（tokens 文档
      // 的 bg 层级：--frame 是「窗口框体/标题栏/侧栏/modeline」档，gutter 与它们同居框体面）。
      ".cm-gutters": {
        gridColumn: "1", gridRow: "1", justifySelf: "start", alignSelf: "stretch",
        color: "var(--text-3)",
        backgroundColor: "var(--frame)",
        borderRight: "1px solid var(--border)",
      },
      // 当前行底色取 `--hover`（交互反馈档）：它与「同一变量绑定匹配」的 `--code-bg` 底纹
      // 必须不同——同值会让刚双击那一行上的匹配隐形（M198 的原始缺陷形态，见 theme.ts 的
      // codeBindingTheme 注释）。
      ".cm-activeLine": { backgroundColor: "var(--hover)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--hover)", color: "var(--text)" },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: "var(--sel)",
      },
      // 选中前景：light/dark 不写（继承 --text）；eink 黑底反白（tokens 文档 eink 规则④），
      // `--sel-text` 也只在该档有定义。
      [`:root[data-theme="eink"] & .cm-selectionBackground, :root[data-theme="eink"] & ::selection`]: {
        backgroundColor: "var(--sel)",
        color: "var(--sel-text)",
      },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
      "&.cm-focused .cm-selectionBackground": { backgroundColor: "var(--sel)" },
    });
    // 可编辑性随模式收敛进 Compartment（M101 验收修复）：非 md 模式必须是
    // 视图层只读——editable(false) 摘掉 contenteditable，readOnly(true) 让 CM6
    // 在 DOM 输入入口（beforeinput / EditContext / drop / paste / 输入法组合）
    // 直接拒收，不依赖 changeFilter 事后回滚 DOM（真实 WKWebView 的 AX 文本注入
    // 与 IME 组合路径下回滚不可靠，文本会滞留内存并误标 dirty）。
    const editability: Extension[] = [
      EditorView.editable.of(mode === "md"),
      EditorState.readOnly.of(mode !== "md"),
      EditorView.contentAttributes.of({ tabindex: "0", "aria-readonly": String(mode !== "md") }),
    ];
    return mode === "md"
      ? [...editability, ...highlight, baseTheme, livePreview(previewContext), endMarker]
      : [...editability, ...highlight, baseTheme, codeBindingTheme, lineNumbers(), highlightActiveLine()];
  }

  /**
   * 换 mode / 换折行口径时要派发的两个 Compartment 重配（M180）——**两件事必须一起做**：
   * 模式变了，md 专属的 live preview 要跟着换；折行也要跟着重配，因为代码块内容级 class
   * 只在 md 模式有意义（`wrapSpec` 的 mode 分支），只重配模式会让 code → md 切回来的代码块
   * 丢掉那一层。折行值取自应用运行期的 `wrap`（应用级口径下所有会话取值一致，任何一次
   * state 重建都取当前值）。
   */
  function modeAndWrapEffects(mode: EditorMode, path: string | undefined): StateEffect<unknown>[] {
    return [
      modeCompartment.reconfigure(modeExtensions(mode, path)),
      wrapCompartment.reconfigure(wrapExtensions(mode, wrap)),
    ];
  }

  /**
   * 一个会话的 EditorState。**每次新建会话都重建一份**（而不是复用同一个 state
   * 对象）：撤销史 / 语法树 / 搜索查询都是 StateField，必须逐会话独立，否则标签之间
   * 会共享一个撤销栈。创建期扩展逐条有据，见下面各段注释。
   */
  function sessionState(doc: string, path: string | undefined, mode: EditorMode, settings: WrapSettings): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        // 撤销史（M131）：CM history 的线性双栈（done/undone），undo/redo 命令经统一键位层
        // 绑定（keys.ts 的 KEY_BINDINGS）。history() 自带一个 beforeinput 手柄（原生
        // historyUndo/historyRedo 输入类型直接改走 CM 的撤销栈），所以即使有别的路径触发
        // 浏览器原生撤销，落点也仍在这一个栈上，不会出现两套撤销互相打架。
        //
        // 与既有机制的相容口径（逐条对照源码）：
        // - trustedLoad 装载事务带 Transaction.addToHistory.of(false)：不进栈，并把旧事件
        //   映射力竭后丢弃（见 dispatchTrusted 注释）。
        // - changeFilter 不拦撤销：CM 的 undo/redo 事务带 filter:false 绕过变更过滤器，
        //   但命令本身在 state.readOnly 时返回 false（非 md 只读模式下撤销必然无事发生），
        //   与「非 md 文档不可变更」的既有保证一致。
        // - dirty 判定不变：仍以文本与 cleanDoc 比较为准，因此撤销回到已保存内容时
        //   dirty 自然收窄为 false（不依赖撤销栈位置，见 updateListener）。
        // - 撤销史**逐会话独立**（M149）：history 是 StateField，每个 state 自带一份栈；
        //   切标签走 view.setState，栈跟着 state 走，切回来仍能撤销。
        history(),
        // 键位分发在 window 层（keys.ts），但 CM 的 DOM 观察器只为「有插件注册 keydown」的
        // 事件挂监听，并在把事件交给手柄前 forceFlush 掉尚未读入的 DOM 变更（快速输入 /
        // 输入法 / 外部注入）。这条空手柄不处理任何键，只为让 keydown 留在观察列表里：
        // 观察列表此前由本文件自己的 ⌘A 手柄与 livePreview 的 widget 手柄维持，两者先后迁入
        // 统一键位表（M131 / M132）后，两模式都不再有别的 keydown 手柄——空手柄是唯一让
        // 「命令读到的是 flush 过的 state」不依赖别的模块恰好注册 keydown 的保证。
        EditorView.domEventHandlers({ keydown: () => false }),
        EditorView.theme({ ".cm-gutters-before": { border: "none" } }),
        // 文件内搜索（M139）：官方 search 能力 + 本项目的搜索 panel（src/search.ts）。
        // 装在**模式无关**的基础层：md 与 code 两种模式都能查（code 只读，panel 里也没有替换
        // 这类会改文档的控件）。panel 的 Compartment 之外落点也意味着模式热切换（装载时的
        // reconfigure）不会把它连带重建——面板与查询跨文件保留，与编辑器行为一致。
        lumirSearch(),
        modeCompartment.of(modeExtensions(mode, path)),
        // 兜底防线：editability 已随模式在视图层拒收输入，changeFilter 再挡住任何
        // 绕过 DOM 输入路径的程序化 dispatch（trustedLoad 标记的装载事务除外）。
        // 闭包读的是实例级 currentMode——切标签时必须同步（activateSession），否则
        // 前台是 code 会话而 currentMode 还停在 md，非 md 的拦截会错判。
        EditorState.changeFilter.of((tr) => tr.docChanged && currentMode !== "md" && !tr.annotation(trustedLoad) ? [] : true),
        EditorView.updateListener.of((update) => {
          collectAppendedExtensions(update);
          // 前台会话的 state 回写（M149）：装配层与保存链路都按会话读文档全文与选区，
          // 会话对象因此必须始终持有最新那一份（setState 不触发本监听，激活时另写）。
          active.state = update.state;
          if (update.docChanged) {
            updateDirty(update.state.doc.toString() !== active.cleanDoc);
            docChangedListeners.forEach((listener) => listener());
          }
        }),
        // 折行口径（M180）：正文行（`lineWrapping`）与代码块行（内容级 class）两层的装配点。
        // 值取应用运行期的折行状态——新会话因此从**当前应用态**起步，而不是配置默认
        //（配置只是启动时喂进来的初值）：这正是 D1「应用级」与初稿「标签页级」的关键差异。
        wrapCompartment.of(wrapExtensions(mode, settings)),
        // 运行时追加的扩展（见 appendedExtensions）：不带上的话，用 appendConfig 装的
        // 监听器（当前是 src/toc.ts 的大纲指示段）会在切到新会话后静默失效。
        ...appendedExtensions,
      ],
    });
  }

  function makeSession(doc: string, path: string | undefined, mode: EditorMode): EditorSession {
    return {
      id: ++sessionSerial,
      state: sessionState(doc, path, mode, wrap),
      path,
      mode,
      cleanDoc: doc,
      dirty: false,
      preview: false,
      scroll: undefined,
    };
  }

  // 启动时的会话：SAMPLE 演示文档（无文件上下文）。它也是标签栏不显示的那一个——
  // 「未命名」会话只承载「还没有打开任何文件」这个状态。
  const initialSession = makeSession(SAMPLE, undefined, initialMode);
  sessions.push(initialSession);
  active = initialSession;
  const view = new EditorView({ state: active.state, parent });

  /** 滚动信号的订阅者（捕获侧）：挂原生 `scroll` 而不挂 CM 的 `viewportChanged`——两者同源
   *  （CM 自己在 `.cm-scroller` 上就挂着原生 scroll 监听），取前者的理由是让捕获与 CM 的更新
   *  循环解耦：捕获只需要一个 `scrollTop` 与一次 `coordsAtPos`，不必等一次测量周期。回调是
   *  **同步派发**的，消费者自己负责防抖（见 src/reading-position.ts）。 */
  const scrollListeners = new Set<() => void>();
  view.scrollDOM.addEventListener("scroll", () => {
    for (const listener of scrollListeners) listener();
  });

  // 统一键位层（keys.ts）的编辑器侧命令实现：每条只读 view 当前状态并自行 dispatch。
  // 全部返回 void——命中即已消费，分发器统一吞掉默认行为（命中但无事可做，例如历史
  // 为空的 ⌘Z，也必须吞掉，否则原生 contenteditable 撤销会插手 CM 管理的文档）。
  const commands: Record<EditorCommandId, CommandRunner> = {
    // 轨道 D 的 widget 命令（M132）：实现在 livePreview.ts，在此与内核命令同一个记录里
    // 装配——统一表的每条绑定都必须有归属实现，分组只表达「谁提供实现」。
    ...widgetCommands(view),
    "editor.cursor-up": () => {
      moveCaretVertically(view, false);
    },
    "editor.cursor-down": () => {
      moveCaretVertically(view, true);
    },
    "editor.cursor-forward": () => {
      moveCaretHorizontally(view, true);
    },
    "editor.cursor-backward": () => {
      moveCaretHorizontally(view, false);
    },
    "editor.line-start": () => {
      moveCaretToLineStart(view);
    },
    "editor.line-end": () => {
      moveCaretToLineEnd(view);
    },
    "editor.select-all": () => {
      view.dispatch({ selection: { anchor: 0, head: view.state.doc.length }, userEvent: "select" });
    },
    "editor.undo": () => {
      undo(view);
    },
    "editor.redo": () => {
      redo(view);
    },
    // M132：Emacs 编辑键（删除 / 转置 / kill-yank / 翻屏 / 重定位 / keyboard-quit）
    "editor.delete-char-forward": () => {
      deleteCharForward(view);
    },
    "editor.delete-char-backward": () => {
      deleteCharBackward(view);
    },
    "editor.transpose-chars": () => {
      transposeChars(view);
    },
    "editor.delete-word-forward": () => {
      deleteWordForward(view);
    },
    "editor.delete-word-backward": () => {
      deleteWordBackward(view);
    },
    "editor.kill-line": () => {
      killLine(view);
    },
    "editor.yank": () => {
      yank(view);
    },
    "editor.keyboard-quit": () => {
      keyboardQuit(view);
    },
    "editor.scroll-page-down": () => {
      scrollPage(view, true);
    },
    "editor.scroll-page-up": () => {
      scrollPage(view, false);
    },
    "editor.recenter": () => {
      recenter(view);
    },
    // M132：shift-extend 扩选
    "editor.extend-char-forward": () => {
      extendHorizontally(view, true);
    },
    "editor.extend-char-backward": () => {
      extendHorizontally(view, false);
    },
    "editor.extend-line-down": () => {
      extendVertically(view, true);
    },
    "editor.extend-line-up": () => {
      extendVertically(view, false);
    },
    "editor.extend-line-start": () => {
      extendToLineBoundary(view, false);
    },
    "editor.extend-line-end": () => {
      extendToLineBoundary(view, true);
    },
    "editor.extend-word-forward": () => {
      extendByWord(view, true);
    },
    "editor.extend-word-backward": () => {
      extendByWord(view, false);
    },
  };

  // ---------------------------------------------------------------------------
  // 会话操作（M149）：切标签 = 换 state，不重建 view、不重新解析文档
  // ---------------------------------------------------------------------------

  /** 把前台会话的模式投影给创建期闭包（见 currentMode 声明处）。 */
  function syncMode(): void {
    currentMode = active.mode;
  }

  /**
   * 装载事务：整篇替换 + 复位选区，不进撤销史（口径见 dispatchTrusted 的注释）。
   *
   * 走事务派生新 state 而不是 `EditorState.create`，是为了让装载**继承原 state 的
   * 其余字段**——搜索面板的查询与开合状态是 StateField，新建 state 会把它们丢掉，
   * 而「打开新文件后面板与查询仍在」是 M139 以来的既有行为（见 src/search.ts 的
   * panel 注释）。后台会话的重载同理，只是派生完不往 view 上派发。
   */
  function loadedState(state: EditorState, doc: string, mode: EditorMode, path: string | undefined): EditorState {
    return state.update({
      changes: { from: 0, to: state.doc.length, insert: doc },
      selection: { anchor: 0 },
      // 模式与折行两个 Compartment 一起重配（M180）：装载可能把会话从 md 换成 code
      //（非 md 只读），代码块内容级 class 的有无取决于 mode，只重配模式会留下它。
      effects: modeAndWrapEffects(mode, path),
      annotations: [trustedLoad.of(true), Transaction.addToHistory.of(false)],
    }).state;
  }

  /** 激活会话本体：换 state + 恢复该会话的滚动位置 + 同步模式上下文。 */
  function activate(session: EditorSession): void {
    if (session === active) return;
    // 离开前把滚动位置记回前台会话：滚动不在 state 里（只存在于 scrollDOM），
    // 存成 CM 的 scrollSnapshot（位置锚 + 相对偏移），恢复时走同一个 scrollTarget
    // 通道——它由 CM 自己的测量周期落地，不受两份内容高度差与排版变化影响；
    // 直接写 scrollDOM.scrollTop 会被 CM 的滚动锚点维护逻辑改掉（M149 实测差 242px）。
    active.scroll = view.scrollSnapshot();
    active = session;
    syncMode();
    readyPath = session.path;
    ensureMtime(session.path);
    // 在途的 paint 事件作废：它属于刚切走的那个会话。
    ++readySerial;
    // 只换 state——撤销史 / 语法树 / 选区 / 搜索查询都在 state 里跟着走，不重新解析。
    // setState 不能在 update 进行中调用（CM 会抛），本函数只在命令层与装配层的
    // 事件回调里调用，都不在 update 内。
    view.setState(session.state);
    // 恢复该会话的滚动位置。没有快照（新建会话）时不干预：新装载的文档由
    // reloadSession 复位到篇首，未命名空文档本来就在篇首。
    if (session.scroll !== undefined) view.dispatch({ effects: session.scroll });
    collapseDomSelectionIfBlurred();
  }

  /**
   * 把折行口径重配到**全部会话**（M180 应用级口径的唯一写入路径）。
   *
   * 前台会话经 dispatch 生效（updateListener 把新 state 回写 session.state）；后台会话只换代
   * 它的 state，不碰 view——与 reloadSession 的既有分岔同形。「全部会话同步」是应用级的定义，
   * 不是可选优化：漏掉后台会话，切回去的标签页会显示旧口径。
   */
  function reconfigureWrap(): void {
    for (const session of sessions) {
      const effects = wrapCompartment.reconfigure(wrapExtensions(session.mode, wrap));
      if (session === active) view.dispatch({ effects });
      else session.state = session.state.update({ effects }).state;
    }
  }

  /**
   * 排版口径的**唯一写入路径**（change typography-and-zoom）：配置加载与三条步进命令共用。
   * 写 documentElement 上的 `--editor-*`（字体族只在配置了才写，见 src/typography.ts），随后
   * 请求一次重测量——「CSS 换了而 CM 没重测」的表现是坐标与画面错位（M103 / M110 缺陷族同
   * 形态）。实测（change 的 design §4-1）：`documentElement` 上的变量变化会唤醒 lists.ts 的既有
   * 观察者、CM 也会在一个渲染帧内跟上，但那条兜底只在「文档含列表」时存在；显式请求让这条
   * 正确性不依赖某个消费者恰好在场。后台会话各自持有 state 而没有 view——它们不需要立即测
   *（切回前台时 CM 自己会测），与 reloadSession 的既有分岔同形。
   */
  function applyTypographySettings(next: TypographySettings): readonly string[] {
    typography = { ...next };
    baseFontSize = next.fontSize;
    const result = writeTypography(typography);
    view.requestMeasure();
    keepCaretVisible();
    return result.warnings;
  }

  /**
   * 施加排版后把光标行保持在视口内（spec 的「改字号后光标仍可见」）。
   *
   * 字号变大会把光标行推到当前视口以下（实测：光标在可见区最下一行时按四档放大，行被推出
   * 视口——滚动位置由 CM 的锚点维护，不跟着光标走）。`y: "nearest"` 只滚**最小必要距离**，
   * 光标本来就在视口内时是 no-op，因此不会出现「按一下字号整屏跳走 / 跳到篇首」。
   * 传 SelectionRange 而不是裸 pos 是 M118 的既有口径（assoc 取可见侧，否则测量可能退化成
   * 全零 rect 把整窗内容拉偏）。
   */
  function keepCaretVisible(): void {
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main, { y: "nearest" }) });
  }

  /**
   * 字号步进一档（`up` / `down`）或回到配置字号（`reset`）。到界后**无变化、无提示、不报错**：
   * 值没变就直接返回（不写样式、不请求重测量——避免无意义的样式重算与重测量）。只动字号，
   * 字体族不参与步进（没有「下一档字体」这种语义）。
   */
  function textScale(direction: TextScaleDirection): void {
    const current = typography.fontSize;
    const next = direction === "reset" ? baseFontSize : nextFontSize(current, direction);
    if (next === current) return;
    typography = { ...typography, fontSize: next };
    writeTypography(typography);
    view.requestMeasure();
    keepCaretVisible();
  }

  /** 应用运行期折行口径的写入路径（M180）：配置加载与两条 toggle 命令共用，只传要改的轴。 */
  function setWrap(next: Partial<WrapSettings>): void {
    const merged: WrapSettings = {
      lineWrap: next.lineWrap ?? wrap.lineWrap,
      codeBlockWrap: next.codeBlockWrap ?? wrap.codeBlockWrap,
    };
    if (merged.lineWrap === wrap.lineWrap && merged.codeBlockWrap === wrap.codeBlockWrap) return;
    wrap = merged;
    reconfigureWrap();
  }

  return {
    view,
    commands,
    setMode(mode: EditorMode) {
      // 显式切换即新的配置默认基线；即便与当前模式相同也要锚定（当前模式
      // 可能是上一个文件经装载漂移来的）。
      defaultMode = mode;
      if (mode === active.mode) return;
      active.mode = mode;
      syncMode();
      // 模式与折行一起重配：代码块内容级 class 只在 md 模式有意义（见 modeAndWrapEffects）。
      view.dispatch({ effects: modeAndWrapEffects(mode, active.path) });
    },
    mode: () => active.mode,
    setWrap,
    wrapSettings: () => ({ ...wrap }),
    toggleLineWrap() {
      setWrap({ lineWrap: !wrap.lineWrap });
    },
    toggleCodeBlockWrap() {
      setWrap({ codeBlockWrap: !wrap.codeBlockWrap });
    },
    applyTypography: applyTypographySettings,
    textScale,
    onReady(listener: EditorReadyListener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    createSession() {
      // 空文档起步：路径与内容都由随后的 reloadSession 补上——装载走事务派生，会话因此
      // 能继承搜索面板一类的 StateField 状态（新建 state 会把它们丢掉）。
      const session = makeSession("", undefined, defaultMode);
      sessions.push(session);
      return session;
    },
    reloadSession(session: EditorSession, doc: string, path: string | undefined, requestId?: number) {
      const mode = modeForPath(path, defaultMode);
      session.path = path;
      session.mode = mode;
      session.cleanDoc = doc;
      // 装载 = 磁盘内容以这次为准（打开 / 外部重载 / 恢复备份）：mtime 缓存一律废掉重取。
      if (path !== undefined) mtimeCache.delete(path);
      ensureMtime(path);
      // 内容整篇换掉：旧的滚动快照锚在一份已经不存在的正文上，作废。
      session.scroll = undefined;
      if (session !== active) {
        // 后台会话（外部变更自动重载 / 恢复备份）：只换代它的 state，不碰 view，
        // 也不发装载阶段事件——那些事件的消费者（视觉门禁截图、诊断日志）看的是前台。
        session.state = loadedState(session.state, doc, mode, path);
        setSessionDirty(session, false);
        return;
      }
      readyPath = path;
      readyRequestId = requestId;
      const serial = ++readySerial;
      syncMode();
      dispatchTrusted({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        // 显式复位选区与滚动（M110 真实桌面缺陷排查）：替换整篇文档后 CM 会把
        // 旧选区映射进新文档、滚动位置也继承上一篇——新文件应从文档起点开始。
        // 滚动复位用直接赋值而非 scrollIntoView 效果：后者带 scrollMargin，文档
        // 溢出视口时会把 pos 0 对齐到视口顶而主动下滚，页首 padding 被顶出画。
        selection: { anchor: 0 },
        effects: modeAndWrapEffects(mode, path),
      });
      // 新装载的文档从篇首开始：这里用直接赋值而不是 scrollIntoView 效果（M110 真实
      // 桌面缺陷排查）——后者带 scrollMargin，文档溢出视口时会把 pos 0 对齐到视口顶而
      // 主动下滚，页首 padding 被顶出画。
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 0;
      updateDirty(false);
      collapseDomSelectionIfBlurred();
      emitReady("source-ready");
      emitReady("decoration-ready");
      emitReady("frontmatter-ready");
      schedulePaint(serial);
    },
    activateSession(session: EditorSession) {
      activate(session);
    },
    activeSession: () => active,
    sessions: () => sessions,
    sessionForPath(path: string) {
      return sessions.find((session) => session.path === path);
    },
    closeSession(session: EditorSession) {
      const index = sessions.indexOf(session);
      if (index < 0) return;
      sessions.splice(index, 1);
      if (session !== active) return;
      // 关掉的是前台会话：激活右邻，没有右邻则左邻（浏览器 / VS Code 同口径）。
      const neighbour = sessions[index] ?? sessions[index - 1];
      if (neighbour !== undefined) {
        activate(neighbour);
        return;
      }
      // 最后一个也关了——回到未命名空文档（标签栏随之隐藏）。
      const blank = makeSession("", undefined, defaultMode);
      sessions.push(blank);
      activate(blank);
    },
    markCleanOf(path: string, content: string) {
      const session = sessions.find((s) => s.path === path);
      if (session === undefined) return;
      // dirty 基准推到已落盘的那份内容；此后若又改了，dirty 自然重新变 true
      // （保存期间用户继续输入的情形——不把「保存时的快照」当成文档已干净）。
      session.cleanDoc = content;
      setSessionDirty(session, session.state.doc.toString() !== content);
      // 保存落盘 = mtime 已变：废掉重取，doc-meta 的「修改于」随即刷新。
      mtimeCache.delete(path);
      ensureMtime(path);
    },
    reset() {
      ++readySerial;
      readyPath = undefined;
      readyRequestId = undefined;
      // 全部会话作废，只留一个未命名空文档（vault 切换 / 关闭）。旧会话对象随 GC 回收。
      sessions.length = 0;
      // mtime 缓存按路径索引，vault 换了同 rel 路径指向别的文件——随会话一起作废。
      mtimeCache.clear();
      mtimeInflight.clear();
      const blank = makeSession("", undefined, defaultMode);
      sessions.push(blank);
      activate(blank);
      updateDirty(false);
    },
    isDirty: () => active.dirty,
    onDirty(listener) { dirtyListeners.add(listener); return () => dirtyListeners.delete(listener); },
    onDocChanged(listener) { docChangedListeners.add(listener); return () => docChangedListeners.delete(listener); },
    setAttachmentProvider(next: AttachmentProvider) {
      provider = next;
      // doc/viewport 均未变化，派发专用 effect 强制装饰层重建（只重建前台会话的；
      // 后台会话切回来时由 CM 重建 ViewPlugin 装饰，口径见 EditorSession 的说明）。
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    setWikilinkResolver(next: WikilinkResolver | null) {
      wikilinkResolver = next;
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    setLightbox(next: ImageLightbox | null) {
      lightbox = next;
      // 装饰层在构建期读这个口子（widget 的双击接线），注入后必须重建一次——否则注入前
      // 已渲染出来的图片不会获得双击路径。
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    refreshPreview() {
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    revealLine(line: number) {
      const n = Math.max(1, Math.min(line, view.state.doc.lines));
      const pos = view.state.doc.line(n).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
    },
    readScrollPosition(): ScrollPosition | null {
      const scroller = view.scrollDOM;
      // 锚取「高度等于 scrollTop 的行块起点」：公开方法、语义是「相对文档顶的高度」，且与
      // 恢复侧一样只需要一个文档位置（不碰像素）。锚比视口顶那一行低约一个 paddingBlock，
      // 这不影响判据——y 记的正是该锚相对视口的实际偏移（见 positionFromReadings 的注释）。
      const anchor = view.lineBlockAtHeight(scroller.scrollTop).from;
      const rect = view.coordsAtPos(anchor);
      // 锚处没有可量的字符盒（折行点、被替换的区间等）：本次不记录，绝不写半个值。
      if (rect === null) return null;
      const box = scroller.getBoundingClientRect();
      return {
        pos: anchor,
        ...positionFromReadings({
          charTop: rect.top,
          charLeft: rect.left,
          boxTop: box.top,
          boxLeft: box.left,
          scrollLeft: scroller.scrollLeft,
        }),
      };
    },
    applyScrollPosition(position: ScrollPosition) {
      // 越界的锚（两次会话之间文档被外部改写）夹到文档内：与 CM 自己的 clip 同口径，也让下面
      // 的篇首判定用的是真正会被使用的那个位置。
      const anchor = Math.max(0, Math.min(Math.round(position.pos), view.state.doc.length));
      // 篇首不施加（design §5）：锚落在文档原点时直接沿用装载复位的结果——「恢复到篇首」与
      // 「停在篇首」是同一件事，而带 margin 的 `scrollIntoView` 对 pos 0 有把页首的 44px
      // 内边距顶出画的历史（M110），不做比做更稳。
      if (anchor === 0) return;
      // 坐标可读时再核一次落点：算出来 ≤ 0 说明这次恢复的结果就是篇首（文档变短等），
      // 同样不施加。**注意这不构成前置门槛**——装载刚结束时存储的锚几乎总在视口之外，
      // 那时 `coordsAtPos` 返回 null（实测：锚在视口下方 ~2800px 时为 null）。若把 null 当
      // 「不可读 → 放弃恢复」，整条能力对所有深于一屏的位置都会静默失效（M194 实测现场）。
      // CM 自己的通道先按 scrollTarget 重新定位视口、渲染、测量，之后再算坐标，因此发放效果
      // 对任意深的锚都成立；锚真的不可读时 CM 的 `scrollIntoView` 自己会提前返回，视口留在
      // 装载复位处——这正是 spec 要的「静默退化到篇首」。
      const rect = view.coordsAtPos(anchor);
      if (rect !== null) {
        const box = view.scrollDOM.getBoundingClientRect();
        const target = restoreScrollTop(
          {
            charTop: rect.top,
            charLeft: rect.left,
            boxTop: box.top,
            boxLeft: box.left,
            scrollLeft: view.scrollDOM.scrollLeft,
          },
          position,
        );
        if (target <= 0) return;
      }
      view.dispatch({
        effects: EditorView.scrollIntoView(EditorSelection.cursor(anchor), {
          y: "start",
          yMargin: position.y,
          // 横向**不**交给这个效果：非快照分支会先减掉 getScrollMargins(view).left，而本仓的
          // gutter 插件正好提供它（固定列宽）——拿捕获值当 xMargin 会系统性偏一个 gutter 宽
          //（code 模式实测 34px）。这里只要求「横向别动锚的位置」，横向量在下面直接赋值。
          x: "nearest",
          xMargin: 0,
        }),
      });
      // 横向按 CM 自己的快照分支的口径恢复：直接写 scrollLeft（`dist/index.js` 的快照分支就是
      // `scrollDOM.scrollLeft = xMargin`）。CM 的滚动锚点维护只管纵向（`scrollAnchorAt` 用
      // scrollTop），因此这个赋值不会像裸写 scrollTop 那样被改掉（M149 的 242px 是纵向现场）。
      //
      // 放在下一帧：上面那个效果由 CM 在测量周期里落地，而它带 `x: "nearest"`——锚被横向移出
      // 视口时它会主动把锚拉回来（实测：先写 200、效果随后把它拉回 62），所以横向必须是**最后**
      // 一次写入。requestAnimationFrame 的回调排在 CM 同帧的测量之后。
      requestAnimationFrame(() => {
        view.scrollDOM.scrollLeft = position.x;
      });
    },
    onScroll(listener: () => void) {
      scrollListeners.add(listener);
      return () => void scrollListeners.delete(listener);
    },
  };
}
