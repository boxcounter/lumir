// src/cell-geometry.ts — grid 表格的 cell 归属与 cell 内容区间（纯位置判定）。
//
// 为什么单独成模块：这套判定只读 EditorState（文档文本 + 解析树），不碰 view、不碰坐标测量、
// 不碰渲染层——纯到 tests/unit 那一层能直接加载并驱动真 EditorState（tests/unit/cell-geometry.test.ts）。
// 留在 editor.ts 里就没这个可能：那个模块的 import 图里有构造函数参数属性，Node 的类型剥离
//（本层跑的就是 src/*.ts 源码）直接抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。而 ⌃E 的落点口径
// 正是「坏了一眼就懂」的那类判定，值得一条秒级防线。
// view 侧只剩一半：落点是否可停靠（`dockable`，要真 DOM 才有坐标）。那一半归 chromium 场景
//（tests/visual/scenes/m118-cursor-interaction.spec.ts、m168-table-cell-line-end.spec.ts）
// 与真机套件（scripts/acceptance/scenarios/24-table-cell-ctrl-e-seq.md）。
//
// 纪律：本文件不得出现 strip-only 不支持的语法（enum、构造函数参数属性等），否则单测层加载不了。
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { findTables, tableAt } from "./preview/table";

/** 光标所在 grid 表格 cell 的可见内容区间；落点在行内但不在 cell 内容区（隐藏管道符区 /
 *  行首尾）时 `inside` 为 false，命令据此不动文档。不在 grid 表格行内返回 null——非矩形与
 *  降级表按原始 Markdown 渲染（管道符可见），不参与钳制。 */
export interface CellClamp {
  from: number;
  to: number;
  inside: boolean;
  /** 同一 row 里紧随其后的 slot（已是末 cell 时为 null）。cell 右边界位（`to`）是隐藏管道符
   *  左缘（零宽 replace，caret 在那里没有可测坐标），归属谁按调用方的方向口径定：编辑命令一律
   *  按本 cell（那是本 cell 的右缘），⌃E 另加一条前向规则，见 cellContentEdge。 */
  next: { from: number; to: number } | null;
}

export function cellClamp(state: EditorState, pos: number): CellClamp | null {
  const tree = ensureSyntaxTree(state, pos, 25) ?? syntaxTree(state);
  const tables = findTables((s, e) => state.doc.sliceString(s, e), state.doc.length, tree, pos, pos)
    .filter((t) => t.rectangular && !t.degraded);
  const table = tableAt(tables, pos);
  if (!table) return null;
  const row = table.rows.find((r) => pos >= r.from && pos <= r.to);
  if (!row || row.slots.length === 0) return null;
  let index = row.slots.findIndex((s) => pos >= s.from && pos <= s.to);
  if (index < 0) index = pos < row.slots[0].from ? 0 : row.slots.length - 1;
  const slot = row.slots[index];
  return {
    from: slot.from,
    to: slot.to,
    inside: pos >= slot.from && pos <= slot.to,
    next: row.slots[index + 1] ?? null,
  };
}

/** cell 可见内容区间（去掉两侧对齐空白）；空 cell 下界上于上界（`from > to`），
 *  调用方按「只能停靠左缘」处理。 */
export function cellContentRange(state: EditorState, cell: { from: number; to: number }): { from: number; to: number } {
  const text = state.doc.sliceString(cell.from, cell.to);
  return { from: cell.from + (text.length - text.trimStart().length), to: cell.from + text.trimEnd().length };
}

/** grid 表格 cell 内容右缘（⌃E / ⌃⇧E 的落点来源）：cell 内容区（cellClamp 给出的 slot）去掉
 *  尾部对齐空白后的位置。
 *
 *  **⌃E 的 cell 归属**（M185）。cellClamp 的闭区间查找把 cell 右边界位（slot.to，即紧随其后的
 *  隐藏管道符左缘）算作本 cell——编辑命令要的正是这个口径（那是本 cell 的右缘，命令据此不动
 *  文档）。⌃E 在此之上加一条**前向规则**：落点恰在该边界位、且**已越过本 cell 内容右缘**（本
 *  cell 有尾部对齐空白）时，归属顺延到同一 row 的下一 cell。两层理由：
 *  - 可见性事实：隐藏管道符是零宽 replace，caret 停在其左缘时原生 caret 矩形退化为 0×0——M185
 *    chromium 实测：`coordsAtPos(slot.to, ±1)` 两侧都退化、DOM 选区矩形 0×0，浏览器把 caret 画到
 *    管道符之后第一个被绘制的内容上，即下一 cell 内容的左缘。用户看到的光标在下一 cell 里
 *    （Alex 原话：「再按 CTRL+F 光标会进入下个 cell」）。
 *  - 不变量：**⌃E 的落点不得把光标跨 cell 往后退**。停在 cell i 右边界位时，本 cell 的内容右缘在
 *    起点之前（已越过它），按本 cell 解析会让 ⌃E 后退一次并跨回 cell i——M185 缺陷现场：
 *    ⌃E→⌃F→⌃E 的第二次 ⌃E 把光标送回上一个 cell 的尾部。归属顺延后落点在 cell i+1 内。
 *
 *  前向规则**不**触发的三种形态（各自保持 M168 口径，落点仍是可信赖的位置）：
 *  - 本 cell 内容紧贴管道符（无尾部对齐空白）：边界位本身就是内容右缘，⌃E 按「已到最右」原地
 *    不动（不是后退）；
 *  - 下一 cell 无内容（空 cell / 短行补空列）：它的内容右缘不存在，唯一候选位（空 cell 左缘）
 *    不可停靠（M185 实测 DOM caret 0×0）——顺延会把落点送进 M168 的缺陷现场，故归属本 cell，
 *    ⌃E 照常回到本 cell 内容右缘；
 *  - 本 cell 是 row 的末 cell：右侧是尾管道 / 行尾，本 row 里没有后续 cell 可归属（跨 row 归属
 *    是 M168 明令禁止的），同样回到本 cell 内容右缘。
 *  返回的区间是**归属 cell 的内容区间**（不是最终落点）：调用方（editor.ts 的 lineBoundaryTarget）
 *  还要在区间内做可停靠回退，回退下界就是区间的 `from`——因此落点不会跨回上一个 cell。 */
export function cellContentEdge(state: EditorState, pos: number): { from: number; to: number } | null {
  const cell = cellClamp(state, pos);
  if (!cell) return null;
  const own = cellContentRange(state, cell);
  if (pos !== cell.to || own.to >= pos) return own;
  const next = cell.next ? cellContentRange(state, cell.next) : null;
  return next && next.to > next.from ? next : own;
}
