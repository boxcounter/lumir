import { forceParsing, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { StateEffect } from "@codemirror/state";
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

const measured = StateEffect.define<number>();

class ListLayout {
  private unit = 0;
  private observer: MutationObserver;
  private measure = () => this.view.requestMeasure({
    key: this,
    read: () => {
      const style = getComputedStyle(this.view.contentDOM);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      context.font = `${parseFloat(style.fontSize) * .85}px ${style.getPropertyValue("--font-mono")}`;
      return context.measureText("0").width;
    },
    write: value => queueMicrotask(() => {
      if (!this.destroyed && Math.abs(value - this.unit) > .01) this.view.dispatch({ effects: measured.of(value) });
    }),
  });
  decorations: DecorationSet = Decoration.none;
  private tree: ReturnType<typeof syntaxTree>;
  private groups = new Map<number, Group>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private destroyed = false;

  constructor(private view: EditorView) {
    this.tree = syntaxTree(view.state);
    this.observer = new MutationObserver(this.measure);
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    document.fonts.addEventListener("loadingdone", this.measure);
    this.measure();
    this.build(view);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.timer);
    this.observer.disconnect();
    document.fonts.removeEventListener("loadingdone", this.measure);
  }

  update(update: ViewUpdate) {
    const tree = syntaxTree(update.state);
    let resized = false;
    for (const tr of update.transactions) for (const effect of tr.effects) {
      if (effect.is(measured)) { this.unit = effect.value; resized = true; }
    }
    if (update.docChanged || tree !== this.tree) this.groups.clear();
    this.tree = tree;
    if (update.geometryChanged) this.measure();
    if (resized || update.docChanged || tree !== syntaxTree(update.startState) || update.viewportChanged) this.build(update.view);
  }

  private schedule() {
    if (this.timer !== undefined || !this.pending || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.destroyed) return;
      const target = Math.min(this.view.state.doc.length, syntaxTree(this.view.state).length + 16384);
      forceParsing(this.view, target, 5);
      this.build(this.view);
      this.schedule();
    }, 16);
  }

  private complete(list: Node, state: EditorState) {
    if (syntaxTreeAvailable(state, state.doc.length)) return true;
    for (let node: Node | null = list; node; node = node.parent) {
      if (node.nextSibling && syntaxTreeAvailable(state, node.nextSibling.to)) return true;
    }
    return false;
  }

  private group(list: Node, state: EditorState): Group | null {
    const cached = this.groups.get(list.from);
    if (cached) return cached;
    if (!this.complete(list, state)) { this.pending = true; return null; }
    let parent = list.parent;
    while (parent && !isList(parent)) parent = parent.parent;
    const ancestor = parent ? this.group(parent, state) : { body: 0 };
    if (!ancestor) return null;
    let width = 0;
    for (let item = list.firstChild; item; item = item.nextSibling) {
      const mark = item.getChild("ListMark");
      if (!mark) continue;
      const label = state.doc.sliceString(mark.from, mark.to);
      const task = item.getChild("Task")?.getChild("TaskMarker");
      width = Math.max(width, (/^\d/.test(label) ? label.length : 1) + (task ? 3.5 : 0) + 1);
    }
    const body = ancestor.body + (parent ? 2 : 0) + width;
    const result = { width, body };
    this.groups.set(list.from, result);
    return result;
  }

  private build(view: EditorView) {
    this.pending = false;
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
                if (!group || !this.unit) {
                  if (line.number === doc.lines) break;
                  line = doc.line(line.number + 1);
                  continue;
                }
                decorations.push(Decoration.line({
                  class: `cm-lp-list-line${first ? " cm-lp-list-first" : ""}`,
                  attributes: { style: `--lp-list-body:${group.body * this.unit}px;--lp-list-marker:${group.width * this.unit}px` },
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
    this.schedule();
  }
}

export const listDecorations = ViewPlugin.fromClass(ListLayout, { decorations: plugin => plugin.decorations });
