// src/list-indent.ts — 列表项 TAB / SHIFT+TAB 平移的纯判定（只读 EditorState）。
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
// 列表项缩进 / 凸排（M239，change list-tab-indent）
// ---------------------------------------------------------------------------
//
// `listIndentChange` 是纯函数：只读 EditorState（文档 + 语法树），产出一组 CM changes
//（`null` = 无操作）。runner（readOnly 提前返回 + 单次 dispatch，选区交由 CM 的 change
// mapping、不显式重设）留在 `src/editor.ts` 的 commands 记录里——那一半要真的 EditorView。
// 口径与实测依据见 `openspec/changes/list-tab-indent` 的 design §2/§3；这里只记实现期才需要的
// 机械约定：
//
// - **行首结构性前缀** = 行首连续的 `>` / 空格 / tab。插入与删除都落在该前缀之后、marker
//   之前（与 `src/preview/lists.ts` 的组扫描同一落点口径），引用内列表因此天然「加在最内层
//   `>` 之后」；删除侧不越过 `>` 之后的强制分隔空白（`> - a` 已是该层顶层）。
// - **列口径**：本项 marker 列 = `ListMark.from`；上一同级项的内容列 = 它的 marker 位 +
//   marker 宽 + 其后空格数。缩进 delta = 上一同级项内容列 − 本项 marker 列；凸排目标列 =
//   最近祖先列表项的 marker 列（没有祖先项即 0，顶层项多余的行首空白顺带抹平）。两处都是
//   **绝对列**：同一列表各项的引用前缀宽度相同，绝对列比较与解析器的判定同义（实测：
//   `1. a` + `\n   2. b` 嵌套、`\n  2. b` 不嵌套；父项 marker 更宽时按内容列取值，
//   `9.` / `10.` 之下要 4 空格才嵌套）。
// - 纯空白行不写（不参与结构判定，写进去只会留下行尾空白）；行首 tab 读得动（删除时一个
//   tab 记作一个删除单位），写入侧只产空格。
// - **有序列表编号重排（Alex 裁决 D2c）**：只重排**成员或成员顺序因本次平移发生变化**的
//   两个分组——被平移项的原分组（它离开的那组）与它落入的新分组（缩进时并入 / 新建的那组），
//   组内有序项改写为「1 起递增的规范序号」，分隔符（`.` / `)`）沿用原标题；两组之外的有序项
//  （含被平移项子树内部的子分组）逐字节不变。缩进后的并入判定按 markdown 既有规则推：本项
//   落到「上一同级项内容列」上，若该同级项的**最后一个**子节点是同型列表、且该列表的起始列
//   与本项目标列相同，则追加进那个列表，否则另起一个新列表（本项即新组的唯一成员，序号 1）。
//   判定里「最后一个」与「列号相同」两条分别对应实测形态：列表被段落打断后不续接；内层列表
//   本身缩得比父内容列更深时（`1. a` / `   3. x`）缩进项会另起一列。

type ListSyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

/** 列表项缩进方向（`TAB` = indent，`SHIFT+TAB` = outdent）。 */
export type ListIndentDirection = "indent" | "outdent";

/** 一次平移的编辑面：只含行首空白区间与有序项序号区间（设计口径见上）。 */
export interface ListIndentEdit {
  changes: { from: number; to: number; insert: string }[];
}

/** 落在这些节点内的 head 一律无操作（代码块 / 表格），即便它们嵌在某个列表项里。 */
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

/** 光标所在行归属的最近 `ListItem` 及其所属列表；head 不在列表项内（段落 / 标题 / 空行 /
 *  代码块 / 表格内）返回 null（design §2 的 S3/S4）。 */
function listItemAt(state: EditorState, pos: number): { item: ListSyntaxNode; list: ListSyntaxNode } | null {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  const anchor = Math.min(line.from + linePrefixEnd(line.text), line.to);
  // 解析前沿推后 4096 字符：归属判定只需要头部，但**节点范围**（项覆盖到哪一行）需要解析器
  // 越过项尾——只给 pos 会让长项拿到截断的节点范围，子树平移会漏行。超时口径同
  // src/cell-geometry.ts（25ms），超时退化为当前树。
  const tree = ensureSyntaxTree(state, Math.min(doc.length, pos + 4096), 25) ?? syntaxTree(state);
  let node: ListSyntaxNode | null = tree.resolveInner(anchor, anchor === line.to ? -1 : 1);
  while (node && node.name !== "Document") {
    if (node.name === "ListItem") {
      const list = node.parent;
      return list && (list.name === "BulletList" || list.name === "OrderedList") ? { item: node, list } : null;
    }
    if (LIST_INDENT_CODE_BLOCK_NODES.has(node.name)) return null;
    node = node.parent;
  }
  return null;
}

/** 归属 `ListItem` 节点覆盖的行（首行到末行）。节点以空行收尾（`to` 落在下一行行首）时退一行。 */
function listItemLines(state: EditorState, item: ListSyntaxNode): Line[] {
  const doc = state.doc;
  const first = doc.lineAt(item.from);
  let last = doc.lineAt(Math.min(item.to, doc.length));
  if (last.from === item.to && last.number > first.number) last = doc.line(last.number - 1);
  const lines: Line[] = [];
  for (let number = first.number; number <= last.number; number++) lines.push(doc.line(number));
  return lines;
}

/** 列表节点的直接 `ListItem` 子节点（组内成员，按文档序）。 */
function listItemsOf(list: ListSyntaxNode): ListSyntaxNode[] {
  const items: ListSyntaxNode[] = [];
  for (let child = list.firstChild; child; child = child.nextSibling) {
    if (child.name === "ListItem") items.push(child);
  }
  return items;
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

/** 项 marker 的**列**（行内偏移：`ListMark.from` 减本行行首）。跨行比较列号的前提是「同一列表
 *  各项的引用前缀宽度相同」——同一容器内的兄弟项必然如此（跨引用层级的病态形态由可删空白区间
 *  的上界兜住，见 listIndentChange 的 outdent 分支）。 */
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

/** 缩进后本项会并入的既有子列表（design §3 的并入判定）；不并入时 null（另起一个新列表）。 */
function joinedSublist(state: EditorState, prev: ListSyntaxNode, type: string, targetColumn: number): ListSyntaxNode | null {
  const last = prev.lastChild;
  if (!last || last.name !== type) return null;
  const first = listItemsOf(last)[0];
  return first && itemMarkerColumn(state, first) === targetColumn ? last : null;
}

/** 把一组（已按新结构排好序的）有序项改写为 1 起递增的规范序号；已是规范序号的项不写。 */
function renumberOrderedItems(
  state: EditorState,
  list: ListSyntaxNode | null,
  items: readonly ListSyntaxNode[],
  into: Map<number, { to: number; insert: string }>,
): void {
  if (!list || list.name !== "OrderedList") return;
  items.forEach((item, index) => {
    const mark = item.getChild("ListMark");
    if (!mark) return;
    const text = state.doc.sliceString(mark.from, mark.to);
    const parts = /^(\d+)([.)])$/.exec(text);
    if (!parts) return;
    const next = `${index + 1}${parts[2]}`;
    if (next === text || into.has(mark.from)) return;
    into.set(mark.from, { to: mark.to, insert: next });
  });
}

/** 列表项平移（TAB / SHIFT+TAB）的纯判定：返回一次 dispatch 的 changes，无操作时 null。 */
export function listIndentChange(state: EditorState, dir: ListIndentDirection): ListIndentEdit | null {
  const found = listItemAt(state, state.selection.main.head);
  if (!found) return null;
  const { item, list } = found;
  const lines = listItemLines(state, item);
  const edits: { from: number; to: number; insert: string }[] = [];
  const renumbered = new Map<number, { to: number; insert: string }>();

  if (dir === "indent") {
    const prev = previousSiblingItem(item);
    if (!prev) return null; // S1b：没有可嵌套的父项，写入只会留下不可见空白
    const own = itemMarkerColumn(state, item);
    const target = itemContentColumn(state, prev);
    if (own === null || target === null) return null;
    const delta = target - own;
    if (delta <= 0) return null;
    const spaces = " ".repeat(delta);
    for (const line of lines) {
      const at = line.from + linePrefixEnd(line.text);
      if (at >= line.to) continue; // 纯空白行不写
      edits.push({ from: at, to: at, insert: spaces });
    }
    // D2c：原分组（本项离开的那组）与目标分组（并入的既有子列表，或本项自成一列的新列表）。
    // 组内成员的比较一律按**位置**（`from`）而不按节点对象身份：lezer 的 SyntaxNode 是按需
    // 包出来的对象，同一个节点经不同路径取到的不保证是同一个引用（实测踩过：`node !== item`
    // 恒真 ⇒ 被平移项仍按原下标参与原分组编号，兄弟项因此漏改）。
    const join = joinedSublist(state, prev, list.name, target);
    renumberOrderedItems(state, list, listItemsOf(list).filter((node) => node.from !== item.from), renumbered);
    renumberOrderedItems(state, join ?? list, join ? [...listItemsOf(join), item] : [item], renumbered);
  } else {
    const ancestor = ancestorListItem(item);
    const own = itemMarkerColumn(state, item);
    if (own === null) return null;
    // 凸排目标列：祖先项的 marker 列；无祖先项（本项已在顶层）时 0——此时只抹平多余的行首
    // 空白，分组结构不变，因此不重排编号。delta 再按本行**可删空白**的上界收一次：引用层级
    // 不同的病态形态（列表项里又开引用）下，本行能删的只有 `>` 之后的空白，收紧后其余行的
    // 平移量与本行一致，不会把续行单独拉走。
    const baseLine = lines[0];
    const baseEditable = lineEditablePrefix(baseLine.text);
    const target = ancestor ? itemMarkerColumn(state, ancestor) ?? 0 : 0;
    const delta = Math.min(own - target, baseEditable.to - baseEditable.from);
    if (delta <= 0) return null; // S2 / D3a：已在顶层且无多余空白
    for (const line of lines) {
      const editable = lineEditablePrefix(line.text);
      let remaining = delta;
      let end = editable.to;
      while (remaining > 0 && end > editable.from && (line.text[end - 1] === " " || line.text[end - 1] === "\t")) {
        end--;
        remaining--;
      }
      if (end === editable.to) continue; // 该行没有可删的空白（空行 / 已贴到前缀下界）
      edits.push({ from: line.from + end, to: line.from + editable.to, insert: "" });
    }
    if (ancestor) {
      const group = ancestor.parent;
      if (group && (group.name === "BulletList" || group.name === "OrderedList")) {
        const members = listItemsOf(group);
        // 位置比较（不按节点身份）——理由见上面 indent 分支的注释
        const at = members.findIndex((node) => node.from === ancestor.from);
        const next = at < 0 ? [item] : [...members.slice(0, at + 1), item, ...members.slice(at + 1)];
        renumberOrderedItems(state, group, next, renumbered);
      }
      renumberOrderedItems(state, list, listItemsOf(list).filter((node) => node.from !== item.from), renumbered);
    }
  }

  for (const [from, spec] of renumbered) edits.push({ from, to: spec.to, insert: spec.insert });
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.from - b.from || a.to - b.to);
  return { changes: edits };
}
