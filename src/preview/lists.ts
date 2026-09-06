import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";

type Node = ReturnType<typeof syntaxTree>["topNode"];
interface Group { width: number; body: number }
const isList = (node: Node) => node.name === "BulletList" || node.name === "OrderedList";

class ListMarker extends WidgetType {
  constructor(readonly label: string, readonly task: string | null) { super(); }
  eq(other: ListMarker) { return this.label === other.label && this.task === other.task; }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-list-marker";
    const mark = document.createElement("span");
    mark.textContent = this.label;
    span.append(mark);
    if (this.task !== null) {
      const task = document.createElement("span");
      task.className = "cm-lp-task-marker";
      task.textContent = this.task;
      task.setAttribute("aria-label", this.task.toLowerCase() === "[x]" ? "已完成" : "未完成");
      span.append(task);
    }
    return span;
  }
}

class ListLayout {
  decorations: DecorationSet = Decoration.none;
  private tree: ReturnType<typeof syntaxTree>;
  private groups = new Map<number, Group>();

  constructor(view: EditorView) {
    this.tree = syntaxTree(view.state);
    this.build(view);
  }

  update(update: ViewUpdate) {
    const tree = syntaxTree(update.state);
    if (update.docChanged) this.groups.clear();
    this.tree = tree;
    if (update.docChanged || tree !== syntaxTree(update.startState) || update.viewportChanged) this.build(update.view);
  }

  private group(list: Node, state: EditorState): Group {
    const cached = this.groups.get(list.from);
    if (cached) return cached;
    const incomplete = this.tree.length < state.doc.length && list.to >= this.tree.length;
    let width = incomplete ? (list.name === "OrderedList" ? 14.75 : 5.75) : 2;
    for (let item = incomplete ? null : list.firstChild; item; item = item.nextSibling) {
      const mark = item.getChild("ListMark");
      if (!mark) continue;
      const label = state.doc.sliceString(mark.from, mark.to);
      const task = item.getChild("Task")?.getChild("TaskMarker");
      width = Math.max(width, (/^\d/.test(label) ? label.length : 1) + (task ? 4 : 0) + .75);
    }
    let parent = list.parent;
    while (parent && !isList(parent)) parent = parent.parent;
    const body = (parent ? this.group(parent, state).body + 1 : 0) + width;
    const result = { width, body };
    this.groups.set(list.from, result);
    return result;
  }

  private build(view: EditorView) {
    const decorations: Range<Decoration>[] = [];
    const seen = new Set<number>();
    const { doc } = view.state;
    for (const range of view.visibleRanges) {
      let line = doc.lineAt(range.from);
      while (line.from <= range.to) {
        if (!seen.has(line.from)) {
          seen.add(line.from);
          const offset = line.text.search(/\S/);
          if (offset >= 0) {
            let node: Node | null = this.tree.resolveInner(line.from + offset, 1);
            let body = false;
            while (node && node.name !== "ListItem") {
              if (["FencedCode", "CodeBlock", "HTMLBlock", "Table", "Blockquote"].includes(node.name)) break;
              if (node.name === "Paragraph" || node.name === "Task") body = true;
              node = node.parent;
            }
            if (node?.name === "ListItem" && node.parent && isList(node.parent)) {
              const mark = node.getChild("ListMark");
              const first = mark !== null && doc.lineAt(mark.from).from === line.from;
              if (first || body) {
                const group = this.group(node.parent, view.state);
                decorations.push(Decoration.line({
                  class: `cm-lp-list-line${first ? " cm-lp-list-first" : ""}`,
                  attributes: { style: `--lp-list-body:${group.body}em;--lp-list-marker:${group.width}em` },
                }).range(line.from));
                if (first && mark) {
                  const task = node.getChild("Task")?.getChild("TaskMarker");
                  let end = task?.to ?? mark.to;
                  while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
                  const label = doc.sliceString(mark.from, mark.to);
                  decorations.push(Decoration.replace({ widget: new ListMarker(/^\d/.test(label) ? label : "•", task ? doc.sliceString(task.from, task.to) : null) }).range(line.from, end));
                } else if (offset > 0) {
                  decorations.push(Decoration.replace({}).range(line.from, line.from + offset));
                }
              }
            }
          }
        }
        if (line.number === doc.lines) break;
        line = doc.line(line.number + 1);
      }
    }
    this.decorations = Decoration.set(decorations, true);
  }
}

export const listDecorations = ViewPlugin.fromClass(ListLayout, { decorations: plugin => plugin.decorations });
