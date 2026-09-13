import { Annotation, Compartment, EditorSelection, EditorState, Transaction, findClusterBreak } from "@codemirror/state";
import type { Extension, SelectionRange, Text } from "@codemirror/state";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { history, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, StreamLanguage, syntaxHighlighting, syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import type { Language } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { GFM } from "@lezer/markdown";
import { javascript, json, typescript } from "@codemirror/legacy-modes/mode/javascript";
import { python } from "@codemirror/legacy-modes/mode/python";
import { go } from "@codemirror/legacy-modes/mode/go";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { c, cpp, java, kotlin } from "@codemirror/legacy-modes/mode/clike";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { css, sCSS } from "@codemirror/legacy-modes/mode/css";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import type { EditorMode } from "./bindings/EditorMode";
import { livePreview, previewRefresh } from "./preview/livePreview";
import type { PreviewContext, WikilinkResolver } from "./preview/livePreview";
import { detectFrontmatter } from "./preview/frontmatter";
import { findMathSpans } from "./preview/math";
import type { MathSpan } from "./preview/math";
import { findTables, tableAt } from "./preview/table";
import type { TableModel, TableRow } from "./preview/table";
import { createInvokeAttachmentProvider, codeLanguage, extensionOf, fileClass } from "./preview/attachments";
import type { AttachmentProvider, CodeLanguage } from "./preview/attachments";
import type { CommandRunner, EditorCommandId } from "./keys";

// 编辑器单内核双模式（ADR 0002 §2）：一个 CM6 内核、两种模式。
// md = 高亮 + live preview 装饰层（src/preview/）；code = 仅高亮。
// 模式差异收敛进一个 Compartment，setMode/openDocument 用 reconfigure 热切换，
// 不重建 EditorView、不丢文档状态。M1 只读（ADR 0003 §3 铁律），装饰层不含编辑态逻辑。

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

function moveCaretVertically(view: EditorView, forward: boolean): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到移动方向的一端；scrollIntoView 揭示光标
    //（r1 review P2-1：否则 Cmd+A → ArrowDown 光标到文档末尾但不可见）。
    view.dispatch({ selection: { anchor: forward ? main.to : main.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  // 起点归一化：DOM 选区回读会把 assoc 归 0（实证：dispatch assoc=-1 的 cursor
  // 后同步读回 assoc=0）。落点停在隐藏 replace 左缘（表格管道符边界）时，CM
  // moveVertically 内部按 `start.assoc || (forward ? 1 : -1)` 取 side——空光标
  // 向下即 side 1，测量退化为全零 rect，goal column/扫描起点随之算出垃圾落点
  //（实测直接跳到文档开头）。退化则改用可见侧重建起点，CM 内部测量即恢复有效。
  let start = main;
  const startSide = (main.assoc || (forward ? 1 : -1)) as -1 | 1;
  if (coordsDegenerate(view.coordsAtPos(main.head, startSide)) && !coordsDegenerate(view.coordsAtPos(main.head, -startSide as -1 | 1))) {
    start = EditorSelection.cursor(main.head, -startSide, undefined, main.goalColumn);
  }
  const moved = view.moveVertically(start, forward);
  // 文档边界兜底（r1 review P2-2，与官方 cursorByLine 同款）：moveVertically 在
  // 末/首行原地不动时，改移行尾/行首——末行中段 ArrowDown 到行尾、首行到行首。
  let target = moved.head !== start.head ? moved : view.moveToLineBoundary(start, forward);
  if (target.head === start.head) return true; // 行首 ArrowUp / 行尾 ArrowDown：已无可移，仍视为已处理
  const clamped = clampAcrossBlockWidgets(view.state, start.head, target.head, forward);
  if (clamped !== target.head) target = EditorSelection.cursor(clamped);
  target = routeGridTable(view, start, target, forward);
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

function moveCaretHorizontally(view: EditorView, forward: boolean): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到移动方向的一端。
    view.dispatch({ selection: { anchor: forward ? main.to : main.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  let head = view.moveByChar(main, forward).head;
  const span = mathSpanCrossed(view.state, main.head, head, forward);
  if (span !== null) {
    // findClusterBreak 接收 string；取 ±64 字符窗口避免大文档整篇 sliceString。
    const edge = forward ? span.from : span.to;
    const winFrom = Math.max(0, edge - 64);
    const win = view.state.doc.sliceString(winFrom, Math.min(view.state.doc.length, edge + 64));
    head = winFrom + findClusterBreak(win, edge - winFrom, forward);
  }
  if (head === main.head) return true;
  // assoc 决定 caret 绘制与 scrollIntoView 的测量侧（空 range 默认取 side 1）。
  // 落点紧贴隐藏 replace（表格管道符等）时某一侧测量退化为全零 rect，会让
  // scrollIntoView 把整窗内容下挫（同 Ctrl+E 缺陷机制）：优先按移动方向取侧，
  // 退化则翻转到可见侧（正常文本两侧坐标一致，仅在 bidi/隐藏边界有差）。
  let assoc: 1 | -1 = forward ? 1 : -1;
  if (coordsDegenerate(view.coordsAtPos(head, assoc))) assoc = assoc === 1 ? -1 : 1;
  const target = EditorSelection.cursor(head, assoc);
  view.dispatch({
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: forward ? "move.char.forward" : "move.char.backward",
  });
  return true;
}

// 键位归统一层（M131）：⌃F/⌃B/⌃E 的绑定在 keys.ts 的 KEY_BINDINGS，命令实现不动。

// Ctrl-E（macOS 文本系统「移到行尾」）改由 CM 派发（M118 真实桌面缺陷：该键原本
// 走原生 contenteditable 路径——原生 caret 在 grid 表格 cell 内落点失控，实测落在
// 隐藏管道符边界上，落点坐标测量退化（coordsAtPos top≈0），揭示滚动随之把整窗
// 内容下挫；与 M103 垂直移动、M111 水平移动同一修复口径）。
// moveToLineBoundary 取文本行尾（硬边界，macOS Ctrl-E 语义即段落尾，不受软换行
// 截断）；落点藏进隐藏 replace（如表格行尾管道符）时回退到行内最后可见位置——
// 表格行即末 cell 尾部，正合「挪到 cell 尾部」的预期。
function moveCaretToLineEnd(view: EditorView): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到右端；scrollIntoView 揭示光标。
    view.dispatch({ selection: { anchor: main.to }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  let head = view.moveToLineBoundary(main, true, false).head;
  if (head !== main.head) {
    // 行尾藏进隐藏 replace（表格行尾管道符、标题尾部标记等）时坐标测量退化，
    // 回退到行内最后可停靠位置（表格行即末 cell 尾部，正合「挪到 cell 尾部」）。
    const line = view.state.doc.lineAt(head);
    while (head > line.from && coordsDegenerate(view.coordsAtPos(head, -1))) head--;
  }
  if (head === main.head) return true; // 已在行尾：仍视为已处理
  // assoc -1：落点紧贴隐藏内容左侧时按可见侧测量 caret 与滚动（隐藏 replace
  // 左缘的 side 1 测量会退化成全零 rect，见 snapIntoCell 注释）。
  const target = EditorSelection.cursor(head, -1);
  view.dispatch({
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: "move.line.end",
  });
  return true;
}

// ⌃A（macOS 文本系统「移到行首」= Emacs C-a；D2 裁决把全选让给 ⌘A）：与 ⌃E 同款口径，
// 只是方向相反。moveToLineBoundary 取文本行首（硬边界，语义即段落首，不受软换行截断）；
// 行首若紧贴隐藏 replace（表格行首管道符），两侧坐标测量都退化为全零 rect（实测：表格行
// col0 两侧皆 DEGEN、col1 可见侧为 side 1），揭示滚动随之把整窗内容拉偏（M118 同族机制，
// 实测未修前 scrollTop 下挫 62px），故与 ⌃E 镜像地把落点向前挪到行内第一个可停靠位置——
// 表格行即首 cell 起点，与 ⌃E 的「末 cell 尾部」对称。
function moveCaretToLineStart(view: EditorView): boolean {
  const main = view.state.selection.main;
  if (!main.empty) {
    // 非空选区：与原生行为一致，折叠到左端；scrollIntoView 揭示光标。
    view.dispatch({ selection: { anchor: main.from }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  let head = view.moveToLineBoundary(main, false, false).head;
  if (head !== main.head) {
    const line = view.state.doc.lineAt(head);
    while (head < line.to && coordsDegenerate(view.coordsAtPos(head, 1))) head++;
  }
  if (head === main.head) return true; // 已在行首：仍视为已处理
  // assoc 1：可见内容在落点之后（与 ⌃E 的 assoc -1 镜像；探针已确认该侧测量非退化）。
  const target = EditorSelection.cursor(head, 1);
  view.dispatch({
    selection: target,
    effects: EditorView.scrollIntoView(target, { y: "nearest" }),
    userEvent: "move.line.start",
  });
  return true;
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
   * 配置默认基线，openDocument 对无文件上下文（path 缺失）文档的回落以此为锚。
   * Compartment 热切换，不重建 view。
   */
  setMode(mode: EditorMode): void;
  mode(): EditorMode;
  /**
   * 打开文档：替换内容并按文件类型选模式（spec「模式配置来源」）——
   * .md/.markdown → md；其余一切已打开的文件 → 只读 code（含未知扩展、dotfile 与
   * basename 无点的文件，M130 方向 A）；只有没有文件上下文（path 缺失）的文档才
   * 回落配置默认基线（setMode 锚定，不随上一个打开文件的模式漂移）。
   */
  openDocument(doc: string, path?: string, requestId?: number): void;
  /** 监听文档装载、装饰和首个 paint 的可观测阶段。 */
  onReady(listener: EditorReadyListener): () => void;
  /**
   * 清空文档并复位上下文（vault 切换 / 关闭时调用）：doc 清空、内部
   * currentFilePath 置空、模式回到配置默认基线（defaultMode，与 openDocument
   * 对无文件上下文文档的回落锚一致——不继承上一个文件漂移出的模式）。
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
  /** 强制重建装饰（解析缓存更新 / watch 增量后调用）。 */
  refreshPreview(): void;
  /** 滚动定位到 1-based 行号并把光标移到行首（wikilink 锚点跳转用）。 */
  revealLine(line: number): void;
  isDirty(): boolean;
  markClean(): void;
  onDirty(listener: (dirty: boolean) => void): () => void;
}

// code 模式的语法高亮（M120）：扩展名 → 语言名的映射是注册表（preview/attachments.ts
// 的 CODE_EXTENSIONS）的职责，这里只把语言名解析成 CM6 Language——legacy-modes 的
// StreamParser 经 StreamLanguage 包成 CM6 Language，同一 parser 多扩展共享实例。
// Record<CodeLanguage, Language> 是编译期合同：注册表新增语言名而此处未实现、
// 或此处多出无人引用的实现，编译都会失败。vue/svelte 无对应 legacy mode（SFC 按
// html 兜底）；php 无对应 mode，注册表标 null → 纯文本只读，不由近似 parser 冒充。
const jsLanguage = StreamLanguage.define(javascript);
const tsLanguage = StreamLanguage.define(typescript);
const cLanguage = StreamLanguage.define(c);
const cppLanguage = StreamLanguage.define(cpp);
const yamlLanguage = StreamLanguage.define(yaml);
const htmlLanguage = StreamLanguage.define(html);
const LANGUAGES: Record<CodeLanguage, Language> = {
  rust: StreamLanguage.define(rust),
  typescript: tsLanguage,
  javascript: jsLanguage,
  python: StreamLanguage.define(python),
  go: StreamLanguage.define(go),
  c: cLanguage,
  cpp: cppLanguage,
  java: StreamLanguage.define(java),
  ruby: StreamLanguage.define(ruby),
  shell: StreamLanguage.define(shell),
  json: StreamLanguage.define(json),
  toml: StreamLanguage.define(toml),
  yaml: yamlLanguage,
  css: StreamLanguage.define(css),
  scss: StreamLanguage.define(sCSS),
  html: htmlLanguage,
  xml: StreamLanguage.define(xml),
  swift: StreamLanguage.define(swift),
  kotlin: StreamLanguage.define(kotlin),
  lua: StreamLanguage.define(lua),
  sql: StreamLanguage.define(standardSQL),
};

/** code 模式按扩展名取语言包；无扩展名线索或该扩展无语言包返回 null（纯文本，不着色）。 */
function codeLanguageFor(path: string | undefined): Language | null {
  if (path === undefined) return null;
  const name = codeLanguage(extensionOf(path));
  return name === null ? null : LANGUAGES[name];
}

// code 模式 token 配色：只用单套排版基线的既有视觉 token
//（--dim/--accent/--callout-*，M55 体系）。
// legacy-modes token 经 StreamLanguage 默认 tokenTable 落到标准 tags。
const codeHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [tags.comment, tags.blockComment, tags.docComment], color: "var(--dim)" },
    { tag: [tags.keyword, tags.definitionKeyword, tags.controlKeyword, tags.operatorKeyword, tags.moduleKeyword, tags.modifier], color: "var(--accent)" },
    { tag: [tags.string, tags.docString, tags.character, tags.regexp, tags.special(tags.string)], color: "var(--callout-tip)" },
    { tag: [tags.number, tags.atom, tags.bool, tags.null], color: "var(--callout-warning)" },
    { tag: [tags.propertyName, tags.attributeName], color: "var(--callout-note)" },
    { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: "var(--callout-abstract)" },
  ]),
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

export function createEditor(parent: HTMLElement, initialMode: EditorMode = "md", markdownConfig: Parameters<typeof markdown>[0] = { base: markdownLanguage, extensions: [GFM] }): EditorHandle {
  const modeCompartment = new Compartment();
  let currentMode = initialMode;
  // 配置默认基线：openDocument 对无文件上下文（path 缺失）文档的回落锚在这里；
  // 只有 setMode（配置加载 / 用户显式切换）会移动它，openDocument 自身不改。
  let defaultMode = initialMode;
  let currentPath: string | undefined;
  let provider: AttachmentProvider = createInvokeAttachmentProvider();
  let wikilinkResolver: WikilinkResolver | null = null;
  const readyListeners = new Set<EditorReadyListener>();
  let readyPath: string | undefined;
  let readyRequestId: number | undefined;
  let readySerial = 0;
  let cleanDoc = SAMPLE;
  const dirtyListeners = new Set<(dirty: boolean) => void>();
  let dirty = false;
  const trustedLoad = Annotation.define<boolean>();

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
    if (dirty === next) return;
    dirty = next;
    dirtyListeners.forEach((listener) => listener(dirty));
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
      if (serial !== readySerial || readyPath !== currentPath) return;
      emitReady("paint");
    });
  }

  const previewContext: PreviewContext = {
    currentFilePath: () => currentPath,
    attachmentProvider: () => provider,
    wikilinkResolver: () => wikilinkResolver,
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
              { tag: tags.comment, color: "var(--dim)" },
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
          return language ? [language, codeHighlight] : [codeHighlight];
        })();
    // CM6 的基础层必须继承 shell 的排版基线配色（ADR 0006，单一基线）；live
    // preview 只增加 Markdown 语义装饰，避免 code 模式落回默认白底、灰 gutter 或默认选区颜色。
    const baseTheme = EditorView.theme({
      "&": {
        color: "var(--text)",
        backgroundColor: "var(--bg)",
        fontFamily: mode === "md" ? "var(--font-body)" : "var(--font-mono)",
      },
      ".cm-scroller": {
        fontFamily: "inherit", lineHeight: "var(--line-height, 1.75)",
        display: "grid !important", gridTemplateColumns: mode === "md"
          ? "minmax(24px, 1fr) minmax(0, var(--measure)) minmax(24px, 1fr)"
          : "minmax(max-content, 1fr) minmax(0, var(--measure)) minmax(0, 1fr)",
        alignItems: "start",
      },
      ".cm-content": {
        fontFamily: "inherit", fontSize: "16px",
        gridColumn: "2", gridRow: "1", minWidth: "0", width: "100%",
        marginInline: "0", paddingBlock: "44px",
        textAlign: "start", textIndent: "0", hangingPunctuation: "none", textAutospace: "no-autospace",
      },
      ".cm-line": { padding: "0" },
      ".cm-gutters": {
        gridColumn: "1", gridRow: "1", justifySelf: "start", alignSelf: "stretch",
        color: "var(--dim)",
        backgroundColor: "var(--bg-nav)",
        borderRight: "1px solid var(--bd-1)",
      },
      ".cm-activeLine": { backgroundColor: "var(--bg-2)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--bg-2)", color: "var(--text)" },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: "var(--sel)",
        color: "var(--selection-ink, var(--text))",
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
      ? [...editability, ...highlight, baseTheme, livePreview(previewContext)]
      : [...editability, ...highlight, baseTheme, lineNumbers(), highlightActiveLine()];
  }

  const state = EditorState.create({
    doc: SAMPLE,
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
      history(),
      // 键位分发在 window 层（keys.ts），但 CM 的 DOM 观察器只为「有插件注册 keydown」的
      // 事件挂监听，并在把事件交给手柄前 forceFlush 掉尚未读入的 DOM 变更（快速输入 /
      // 输入法 / 外部注入）。这条空手柄不处理任何键，只为让 keydown 留在观察列表里：
      // 观察列表此前由本文件自己的 ⌘A 手柄维持，迁走后 md 模式靠 livePreview 的 widget
      // 手柄、code 模式则没有任何 keydown 手柄——空手柄把两种模式的观察集拉回迁移前口径，
      // 也让「命令读到的是 flush 过的 state」不再依赖别的模块恰好注册了 keydown。
      EditorView.domEventHandlers({ keydown: () => false }),
      EditorView.theme({ ".cm-gutters-before": { border: "none" } }),
      modeCompartment.of(modeExtensions(initialMode)),
      // 兜底防线：editability 已随模式在视图层拒收输入，changeFilter 再挡住任何
      // 绕过 DOM 输入路径的程序化 dispatch（trustedLoad 标记的装载事务除外）。
      EditorState.changeFilter.of((tr) => tr.docChanged && currentMode !== "md" && !tr.annotation(trustedLoad) ? [] : true),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) updateDirty(update.state.doc.toString() !== cleanDoc);
      }),
      EditorView.lineWrapping,
    ],
  });
  const view = new EditorView({ state, parent });

  // 统一键位层（keys.ts）的编辑器侧命令实现：每条只读 view 当前状态并自行 dispatch。
  // 全部返回 void——命中即已消费，分发器统一吞掉默认行为（命中但无事可做，例如历史
  // 为空的 ⌘Z，也必须吞掉，否则原生 contenteditable 撤销会插手 CM 管理的文档）。
  const commands: Record<EditorCommandId, CommandRunner> = {
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
  };

  return {
    view,
    commands,
    setMode(mode: EditorMode) {
      // 显式切换即新的配置默认基线；即便与当前模式相同也要锚定（当前模式
      // 可能是上一个文件经 openDocument 漂移来的）。
      defaultMode = mode;
      if (mode === currentMode) return;
      currentMode = mode;
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode, currentPath)) });
    },
    mode: () => currentMode,
    onReady(listener: EditorReadyListener) {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },
    openDocument(doc: string, path?: string, requestId?: number) {
      currentPath = path;
      readyPath = path;
      readyRequestId = requestId;
      const serial = ++readySerial;
      const next = modeForPath(path, defaultMode);
      currentMode = next;
      cleanDoc = doc;
      dispatchTrusted({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        // 显式复位选区与滚动（M110 真实桌面缺陷排查）：替换整篇文档后 CM 会把
        // 旧选区映射进新文档、滚动位置也继承上一篇——新文件应从文档起点开始。
        // 滚动复位用直接赋值而非 scrollIntoView 效果：后者带 scrollMargin，文档
        // 溢出视口时会把 pos 0 对齐到视口顶而主动下滚，页首 padding 被顶出画。
        selection: { anchor: 0 },
        effects: modeCompartment.reconfigure(modeExtensions(next, path)),
      });
      view.scrollDOM.scrollTop = 0;
      view.scrollDOM.scrollLeft = 0;
      updateDirty(false);
      collapseDomSelectionIfBlurred();
      emitReady("source-ready");
      emitReady("decoration-ready");
      emitReady("frontmatter-ready");
      schedulePaint(serial);
    },
    reset() {
      ++readySerial;
      currentPath = undefined;
      readyPath = undefined;
      readyRequestId = undefined;
      currentMode = defaultMode;
      cleanDoc = "";
      dispatchTrusted({
        changes: { from: 0, to: view.state.doc.length, insert: "" },
        effects: modeCompartment.reconfigure(modeExtensions(defaultMode)),
      });
      updateDirty(false);
      collapseDomSelectionIfBlurred();
    },
    isDirty: () => dirty,
    markClean() { cleanDoc = view.state.doc.toString(); updateDirty(false); },
    onDirty(listener) { dirtyListeners.add(listener); return () => dirtyListeners.delete(listener); },
    setAttachmentProvider(next: AttachmentProvider) {
      provider = next;
      // doc/viewport 均未变化，派发专用 effect 强制装饰层重建。
      view.dispatch({ effects: previewRefresh.of(null) });
    },
    setWikilinkResolver(next: WikilinkResolver | null) {
      wikilinkResolver = next;
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
  };
}
