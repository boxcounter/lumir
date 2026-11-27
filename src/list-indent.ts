// src/list-indent.ts — 列表 TAB / SHIFT+TAB 的纯判定（只读 EditorState）。
//
// 为什么单独成模块：这套判定只读文档与解析树（不碰 view、不碰坐标测量、不碰渲染层），
// 因此能在 tests/unit 那一层用**真 EditorState + 真 markdown 解析器**直接驱动
//（tests/unit/list-indent.test.ts）。留在 editor.ts 里就没这个可能——那个模块的 import 图里
// 有构造函数参数属性（src/preview/livePreview.ts、src/preview/math.ts），而单测层跑的是
// Node 的类型剥离（strip-only）模式，直接抛 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX（与
// src/cell-geometry.ts 的存在理由同源，见其文件头）。
//
// 纪律（与 cell-geometry.ts 同）：本文件不得出现 strip-only 不支持的语法（enum、
// 构造函数参数属性等），且只 import @codemirror 的 state / language 与 @lezer 类型推导。
import { EditorState } from "@codemirror/state";
import type { Line } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";

// ---------------------------------------------------------------------------
// 行模型（change rework-list-tab-line-model-nov27）
// ---------------------------------------------------------------------------
//
// **操作对象是行，不是列表项 / 子树**（Alex 2026-11-27 裁决）。`listIndentChange` 是纯函数：
// 只读 EditorState（文档 + 语法树 + 选区），产出一组 CM changes（`null` = 无操作）。runner
//（readOnly 提前返回 + 单次 dispatch，选区交由 CM 的 change mapping、不显式重设）留在
// `src/editor.ts` 的 commands 记录里——那一半要真的 EditorView。
//
// 机械约定（口径全文与裁决点见 `openspec/changes/rework-list-tab-line-model-nov27` 的 design）：
//
// - **行集** = 选区（全部 range）触及的行。空选区取 head 行；非空选区取与选区相交的行，其中
//   起始位置恰等于选区终点的行（尾落行首）不计——与 CM `changeBySelectedLine` 的选择口径一致。
//   多 range 取并集、按文档序去重。命令 MUST NOT 以 `main.head` 所在项代替选区。
// - **逐行归属**：行首结构性前缀（连续的 `>` / 空格 / tab）之后 `resolveInner` 向上归最近的
//   `ListItem`；先命中 `FencedCode` / `CodeBlock` / `Table` / `HTMLBlock` 的行不写；不属于任何
//   列表项的行（段落 / 标题 / 引用正文）不写。纯空白行不写（不留下行尾空白）。
// - **步长**：项首行用结构目标——TAB 的目标列 = 上一同级项的内容列（marker 位 + marker 宽 +
//   其后空格），SHIFT+TAB 的目标列 = 最近祖先列表项的 marker 列（无祖先项即 0）；续行用所属项
//   的内容列宽（marker 宽 + 其后空格）。列都是**绝对列**：同一列表各项的引用前缀宽度相同，
//   绝对列比较与解析器的判定同义（实测：`1. a` + `\n   2. b` 嵌套、`\n  2. b` 不嵌套；父项
//   marker 更宽时按内容列取值，`9.` / `10.` 之下要 4 空格才嵌套）。
// - **删除**：`min(结构步长, 本行可删空白)`；不越过 `>` 之后的分隔空白（`> - a` 已是该层顶
//   层），不碰 marker / 正文。行首 tab 读得动（一个 tab 记一个删除单位），写入侧只产空格。
// - **首项 TAB 无操作**：没有上一同级项可嵌套，写入只会留下渲染态看不见的空白 diff（M239 的
//   S1b 理由在行模型下仍成立）。首项的续行照常按内容列宽处理；首项 SHIFT+TAB 照常按祖先层凸排。
// - **不改写编号**（切断 M239 的 D2c）：行模型下重排会改动未选中的兄弟项；只排选中行又会制造
//   重复 / 跳号。有序列表的显示编号由 `src/preview/lists.ts` 按组序计算、不读源码字面数字。

type ListSyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** 缩进方向（`TAB` = indent，`SHIFT+TAB` = outdent）。 */
export type ListIndentDirection = "indent" | "outdent";

/** 一次按键的编辑面：只含行首空白区间（设计口径见上）。 */
export interface ListIndentEdit {
  changes: { from: number; to: number; insert: string }[];
}

/** 落在这些节点内的行一律不写（代码块 / 表格），即便它们嵌在某个列表项里。 */
const LIST_INDENT_CODE_BLOCK_NODES = new Set(["FencedCode", "CodeBlock", "Table", "HTMLBlock"]);

/** 行首结构性前缀（连续 `>` / 空格 / tab）的结束位置＝该行的 marker / 内容起始位。 */
function linePrefixEnd(text: string): number {
  let i = 0;
  while (i < text.length && (text[i] === ">" || text[i] === " " || text[i] === "\t")) i++;
  return i;
}

/** 一行里可被缩进 / 凸排改写的空白区间（行内偏移，`[from, to)` 的空格 / tab 串）。
 *  `to` = 行首结构性前缀结束位；`from` 不越过 `>` 之后的强制分隔空白（tab 与空格同为
 *  一个删除单位——宽容读取、严格写入）。 */
function lineEditablePrefix(text: string): { from: number; to: number } {
  const to = linePrefixEnd(text);
  const lastQuote = text.lastIndexOf(">", to - 1);
  return { from: lastQuote < 0 ? 0 : Math.min(to, lastQuote + 2), to };
}

/** 选区（全部 range）触及的行：空 range 取 head 行，非空 range 取与它相交的行
 *（起始位置恰等于终点的行不计），多 range 并集去重、按文档序。 */
function touchedLines(state: EditorState): Line[] {
  const doc = state.doc;
  const seen = new Set<number>();
  const lines: Line[] = [];
  const add = (line: Line): void => {
    if (seen.has(line.from)) return;
    seen.add(line.from);
    lines.push(line);
  };
  for (const range of state.selection.ranges) {
    if (range.empty) {
      add(doc.lineAt(range.head));
      continue;
    }
    let line = doc.lineAt(range.from);
    add(line);
    while (line.number < doc.lines) {
      const next = doc.line(line.number + 1);
      if (range.to <= next.from) break; // 尾落行首 / 选区终点不在下一行内
      line = next;
      add(line);
    }
  }
  lines.sort((a, b) => a.from - b.from);
  return lines;
}

/** 一行归属的最近 `ListItem`；不在列表项内（段落 / 标题 / 引用正文）或先命中代码块 / 表格
 *  / HTML 块时返回 null。 */
function listItemForLine(state: EditorState, tree: ReturnType<typeof syntaxTree>, line: Line): ListSyntaxNode | null {
  const anchor = Math.min(line.from + linePrefixEnd(line.text), line.to);
  let node: ListSyntaxNode | null = tree.resolveInner(anchor, anchor === line.to ? -1 : 1);
  while (node && node.name !== "Document") {
    if (node.name === "ListItem") {
      const list = node.parent;
      return list && (list.name === "BulletList" || list.name === "OrderedList") ? node : null;
    }
    if (LIST_INDENT_CODE_BLOCK_NODES.has(node.name)) return null;
    node = node.parent;
  }
  return null;
}

/** 项的上一同级项（同组里的前一项）；没有（本项是该组第一项）返回 null。 */
function previousSiblingItem(item: ListSyntaxNode): ListSyntaxNode | null {
  for (let node = item.prevSibling; node; node = node.prevSibling) {
    if (node.name === "ListItem") return node;
  }
  return null;
}

/** 最近的祖先列表项（本项嵌在它里面）；没有（本项在顶层）返回 null。 */
function ancestorListItem(item: ListSyntaxNode): ListSyntaxNode | null {
  for (let node = item.parent?.parent ?? null; node; node = node.parent) {
    if (node.name === "ListItem") return node;
  }
  return null;
}

/** 项 marker 的**列**（行内偏移：`ListMark.from` 减本行行首）。 */
function itemMarkerColumn(state: EditorState, item: ListSyntaxNode): number | null {
  const mark = item.getChild("ListMark");
  return mark ? mark.from - state.doc.lineAt(mark.from).from : null;
}

/** 项 marker 之后第一个内容字符的列（marker 宽 + 其后空格，行内偏移）。 */
function itemContentColumn(state: EditorState, item: ListSyntaxNode): number | null {
  const mark = item.getChild("ListMark");
  if (!mark) return null;
  const line = state.doc.lineAt(mark.from);
  let column = mark.to - line.from;
  while (column < line.text.length && line.text[column] === " ") column++;
  return column;
}

/** 一行的步长：项首行用结构目标（上一同级项内容列 / 祖先项 marker 列），续行用所属项的
 *  内容列宽。返回 null = 该行没有可写的缩进 / 凸排目标。 */
function lineDelta(
  state: EditorState,
  item: ListSyntaxNode,
  first: boolean,
  dir: ListIndentDirection,
): number | null {
  const own = itemMarkerColumn(state, item);
  if (own === null) return null;
  if (first) {
    if (dir === "indent") {
      const prev = previousSiblingItem(item);
      if (!prev) return null; // 首项：没有可嵌套的父项
      const target = itemContentColumn(state, prev);
      return target === null ? null : target - own;
    }
    const ancestor = ancestorListItem(item);
    const target = ancestor ? itemMarkerColumn(state, ancestor) ?? 0 : 0;
    return own - target;
  }
  const content = itemContentColumn(state, item);
  return content === null ? null : content - own;
}

/** 单行的编辑：TAB 在行首结构前缀之后插空格；SHIFT+TAB 删该前缀末尾不超过步长的空白。 */
function lineEdit(
  state: EditorState,
  tree: ReturnType<typeof syntaxTree>,
  line: Line,
  dir: ListIndentDirection,
): { from: number; to: number; insert: string } | null {
  if (/^\s*$/.test(line.text)) return null; // 纯空白行不写
  const item = listItemForLine(state, tree, line);
  if (!item) return null;
  const mark = item.getChild("ListMark");
  if (!mark) return null;
  const first = state.doc.lineAt(mark.from).from === line.from;
  const delta = lineDelta(state, item, first, dir);
  if (delta === null || delta <= 0) return null;

  if (dir === "indent") {
    const at = line.from + linePrefixEnd(line.text);
    return { from: at, to: at, insert: " ".repeat(delta) };
  }

  const editable = lineEditablePrefix(line.text);
  const available = editable.to - editable.from;
  if (available <= 0) return null;
  const from = editable.to - Math.min(delta, available);
  return { from: line.from + from, to: line.from + editable.to, insert: "" };
}

/** 列表行缩进（TAB / SHIFT+TAB）的纯判定：返回一次 dispatch 的 changes，无操作时 null。 */
export function listIndentChange(state: EditorState, dir: ListIndentDirection): ListIndentEdit | null {
  const lines = touchedLines(state);
  if (lines.length === 0) return null;
  // 解析前沿推到最后一条触及行之后 4096 字符：归属判定只需要行首，但一次按键可能跨多行，
  // 按最远一行推进可避免逐行重推。超时口径同 src/cell-geometry.ts（25ms）。
  const last = lines[lines.length - 1];
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, last.to + 4096), 25) ?? syntaxTree(state);
  const edits: { from: number; to: number; insert: string }[] = [];
  for (const line of lines) {
    const edit = lineEdit(state, tree, line, dir);
    if (edit) edits.push(edit);
  }
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.from - b.from || a.to - b.to);
  return { changes: edits };
}
