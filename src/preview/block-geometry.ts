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
type ClassifiedShape = LineShape & { readonly boundary: boolean };

const HEADING_TOP = [24, 20, 16, 14, 12, 10] as const;
const HEADING_BOTTOM = [9, 6, 5, 5, 4, 4] as const;
const MARKER_RE = /^[ \t>]*(?:[-+*]|\d{1,9}[.)])(?:$|[ \t])/;
const SETEXT_RE = /^[ \t>]*(?:=+|-+)[ \t]*$/;
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

function classifyLine(
  doc: Text,
  tree: Tree,
  line: Line,
  fm: GeometryFrontmatter | null,
): ClassifiedShape | null {
  if (fm !== null && line.from >= fm.from && line.to <= fm.to) return null;
  if (!line.text.trim()) return { kind: "blank", top: 0, bottom: 0, boundary: true };
  const chain = ancestors(tree, line);
  if (hasNode(chain, "FencedCode", "CodeBlock", "HTMLBlock", "Table")) {
    return { kind: "code/table", top: 0, bottom: 0, boundary: true };
  }
  const heading = ATX_RE.exec(line.text);
  if (heading) {
    const level = heading[1].length;
    return {
      kind: "heading",
      top: firstContentLine(doc, line, fm) ? 0 : HEADING_TOP[level - 1],
      bottom: HEADING_BOTTOM[level - 1],
      headingLevel: level,
      boundary: true,
    };
  }
  if (hasNode(chain, "HorizontalRule")) return { kind: "hr", top: 0, bottom: 0, boundary: true };
  const marker = MARKER_RE.test(line.text);
  if (!marker && /^[ \t>]*>/.test(line.text)) return { kind: "quote", top: 0, bottom: 0, boundary: true };
  if (marker) return { kind: "list-item", top: 2, bottom: 0, boundary: true };
  if (SETEXT_RE.test(line.text) && line.number > 1 && doc.line(line.number - 1).text.trim()) {
    return { kind: "text", top: 0, bottom: 0, boundary: true };
  }
  const nested = hasNode(chain, "ListItem", "Blockquote");
  let bottom = 0;
  if (!nested) {
    if (line.number === doc.lines) bottom = 8;
    else {
      const next = classifyLine(doc, tree, doc.line(line.number + 1), fm);
      if (next?.boundary) bottom = 8;
    }
  }
  return { kind: "text", top: 0, bottom, boundary: false };
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
    const classified = classifyLine(doc, tree, line, fm);
    if (classified) {
      const { boundary: _boundary, ...shape } = classified;
      result.set(line.from, shape);
    }
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
