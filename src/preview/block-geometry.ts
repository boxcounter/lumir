import { syntaxTree } from "@codemirror/language";
import type { Extension, Line, Range, Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { compositionSettled } from "./lists";
import { frontmatterBlockField } from "./frontmatter";

export type BlockLineKind = "blank" | "code/table" | "heading" | "hr" | "quote" | "list-item" | "text";

export interface LineShape {
  readonly kind: BlockLineKind;
  readonly top: number;
  readonly bottom: number;
  readonly headingLevel?: number;
}

export interface GeometryFrontmatter {
  readonly from: number;
  readonly to: number;
}

type Tree = ReturnType<typeof syntaxTree>;
type Node = Tree["topNode"];

const HEADING_TOP = [24, 20, 16, 14, 12, 10] as const;
const HEADING_BOTTOM = [9, 6, 5, 5, 4, 4] as const;
const MARKER_RE = /^[ \t>]*(?:[-+*]|\d{1,9}[.)])(?:$|[ \t])/;
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]|$)/;

function ancestors(tree: Tree, line: Line): Node[] {
  const offset = line.text.search(/\S/);
  const result: Node[] = [];
  let node: Node | null = tree.resolveInner(line.from + Math.max(offset, 0), 1);
  while (node) {
    result.push(node);
    node = node.parent;
  }
  return result;
}

function hasNode(chain: readonly Node[], ...names: string[]): boolean {
  return chain.some((node) => names.includes(node.name));
}

function firstContentLine(doc: Text, line: Line, fm: GeometryFrontmatter | null): boolean {
  const start = fm === null ? 1 : Math.min(doc.lines, doc.lineAt(fm.to).number + 1);
  for (let n = start; n < line.number; n++) {
    if (doc.line(n).text.trim()) return false;
  }
  return true;
}

interface BoundaryShape {
  readonly kind: BlockLineKind;
  readonly headingLevel?: number;
}

function classifyBoundary(
  tree: Tree,
  line: Line,
  fm: GeometryFrontmatter | null,
): BoundaryShape | null {
  if (fm !== null && line.from >= fm.from && line.to <= fm.to) return null;
  if (!line.text.trim()) return { kind: "blank" };
  const chain = ancestors(tree, line);
  if (hasNode(chain, "FencedCode", "CodeBlock", "HTMLBlock", "Table")) {
    return { kind: "code/table" };
  }
  const heading = ATX_RE.exec(line.text);
  if (heading) return { kind: "heading", headingLevel: heading[1].length };
  if (hasNode(chain, "HorizontalRule")) return { kind: "hr" };
  const marker = MARKER_RE.test(line.text);
  if (!marker && /^[ \t>]*>/.test(line.text)) return { kind: "quote" };
  if (marker) return { kind: "list-item" };
  // Setext 下划线行与普通正文同样走 0/0：块类型只影响标题自身的台阶，不影响任何行的
  // 「块末下距」（该概念已随本 change 删除）。
  return { kind: "text" };
}

/** 行几何的唯一判定点（纯函数）。
 *
 *  **普通行局部性（合同「块边界纵向几何的源码同步稳定性」）**：顶层普通正文行与空行的纵向
 *  padding 恒为 0，MUST NOT 读取邻行类型、文档 EOF、光标 / 选区或 IME 状态——旧模型让「下一行
 *  是否块边界 / 本行是否文档末行」决定本行 8px 下距，于是空行↔有字、标题↔正文、EOF 输入都会让
 *  未编辑行的高度翻转。段落之间的纵向间隔只由空行行高与各块自身的间距承担。
 *
 *  标题各级间距与列表项首行 2px 是**块自身**的形态，不读邻居，保持不变。 */
function classifyLine(
  doc: Text,
  tree: Tree,
  line: Line,
  fm: GeometryFrontmatter | null,
): LineShape | null {
  const classified = classifyBoundary(tree, line, fm);
  if (classified === null) return null;
  if (classified.kind === "heading") {
    const level = classified.headingLevel!;
    return {
      kind: "heading",
      top: firstContentLine(doc, line, fm) ? 0 : HEADING_TOP[level - 1],
      bottom: HEADING_BOTTOM[level - 1],
      headingLevel: level,
    };
  }
  if (classified.kind === "list-item") return { kind: "list-item", top: 2, bottom: 0 };
  return { kind: classified.kind, top: 0, bottom: 0 };
}

export function lineShapes(
  doc: Text,
  tree: Tree,
  from: number,
  to: number,
  fm: GeometryFrontmatter | null,
): Map<number, LineShape> {
  const result = new Map<number, LineShape>();
  let line = doc.lineAt(from);
  while (line.from <= to) {
    const shape = classifyLine(doc, tree, line, fm);
    if (shape) result.set(line.from, shape);
    if (line.number === doc.lines) break;
    line = doc.line(line.number + 1);
  }
  return result;
}

function build(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const fm = view.state.field(frontmatterBlockField, false) ?? null;
  const decorations: Range<Decoration>[] = [];
  for (const range of view.visibleRanges) {
    for (const [from, shape] of lineShapes(doc, syntaxTree(view.state), range.from, range.to, fm)) {
      if (shape.top === 0 && shape.bottom === 0) continue;
      const styles = [];
      if (shape.top !== 0) styles.push(`padding-top:${shape.top}px`);
      if (shape.bottom !== 0) styles.push(`padding-bottom:${shape.bottom}px`);
      decorations.push(Decoration.line({ attributes: { style: styles.join(";") } }).range(from));
    }
  }
  return Decoration.set(decorations, true);
}

class BlockGeometryLayout {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = build(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged) this.decorations = this.decorations.map(update.changes);
    const settled = update.transactions.some((tr) => tr.effects.some((effect) => effect.is(compositionSettled)));
    if (update.view.compositionStarted) return;
    if (
      settled || update.docChanged || update.viewportChanged ||
      syntaxTree(update.state) !== syntaxTree(update.startState)
    ) {
      this.decorations = build(update.view);
    }
  }
}

export const blockGeometry: Extension = ViewPlugin.fromClass(BlockGeometryLayout, {
  decorations: (plugin) => plugin.decorations,
});
