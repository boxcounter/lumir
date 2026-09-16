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
const metadataReady = StateEffect.define<null>();
interface GroupScan { item: Node | null; width: number; indent: number }

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
  /** 编辑后待重扫确认的陈旧组（key 与 groups 同步映射）；重扫登记后即移除。 */
  private stale = new Set<number>();
  private scans = new Map<number, GroupScan>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = false;
  private destroyed = false;

  constructor(private view: EditorView) {
    this.tree = syntaxTree(view.state);
    this.observer = new MutationObserver(this.measure);
    this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
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
      if (effect.is(metadataReady)) resized = true;
    }
    if (update.docChanged) {
      // 编辑不清掉已发布的组：键位经 changes 映射后旧宽度先顶着渲染，stale
      // 驱动后台重扫，只有宽度真变了才 publish 重建（见 schedule）。直接清空
      // 会让每次击键掉装饰 ≥16ms，列表文字左右抖动（桌面验收缺陷）。
      const remapped = new Map<number, Group>();
      for (const [from, group] of this.groups) remapped.set(update.changes.mapPos(from, 1), group);
      this.groups = remapped;
      this.stale = new Set(remapped.keys());
      this.scans.clear();
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.tree = tree;
    if (update.geometryChanged) this.measure();
    if (resized || update.docChanged || tree !== syntaxTree(update.startState) || update.viewportChanged) this.build(update.view);
  }

  private schedule() {
    if (this.timer !== undefined || (!this.pending && !this.scans.size) || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.destroyed) return;
      if (this.scans.size) {
        const deadline = performance.now() + 3;
        let remaining = 512;
        let published = false;
        for (const [from, scan] of this.scans) {
          while (scan.item && remaining-- > 0 && performance.now() < deadline) {
            const item = scan.item;
            const mark = item.getChild("ListMark");
            if (mark) {
              const label = this.view.state.doc.sliceString(mark.from, mark.to);
              const task = item.getChild("Task")?.getChild("TaskMarker");
              scan.width = Math.max(scan.width, (/^\d/.test(label) ? label.length : 1) + (task ? 3.5 : 0) + 1);
            }
            scan.item = item.nextSibling;
          }
          if (!scan.item) {
            const next = { width: scan.width, body: scan.indent + scan.width };
            const previous = this.groups.get(from);
            this.groups.set(from, next);
            this.scans.delete(from);
            // 重扫结果与已发布值一致不触发重建：陈旧组顶渲染期间宽度本就正确，
            // 一致时还 dispatch 会多一轮无变化的全量 build。
            if (!previous || previous.width !== next.width || previous.body !== next.body) published = true;
          }
          if (remaining <= 0 || performance.now() >= deadline) break;
        }
        if (published) this.view.dispatch({ effects: metadataReady.of(null) });
      } else {
        const target = Math.min(this.view.state.doc.length, syntaxTree(this.view.state).length + 16384);
        forceParsing(this.view, target, 5);
        this.build(this.view);
      }
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
    if (cached) {
      // 陈旧组先用旧宽度渲染（不掉装饰 = 不抖动），同时登记后台重扫；树不完整
      // 或祖先未就绪时保留 stale，下一轮 build 重试。
      if (this.stale.has(list.from) && this.complete(list, state) && this.enqueue(list, state)) this.stale.delete(list.from);
      return cached;
    }
    if (!this.complete(list, state)) { this.pending = true; return null; }
    this.pending = true;
    this.enqueue(list, state);
    return null;
  }

  /** 登记一个组的宽度扫描；祖先组未就绪或陈旧（嵌套列表）时不登记，返回 false。 */
  private enqueue(list: Node, state: EditorState): boolean {
    if (this.scans.has(list.from)) return true;
    let parent = list.parent;
    while (parent && !isList(parent)) parent = parent.parent;
    // 祖先 cached body 未确认（stale 或重扫已登记未完成）时，用它登记 indent
    // 会让子组在祖先 publish 后错位且不自愈；视为未就绪，pending 保活等下一轮
    // build 重试。两处都要查：stale 在祖先扫描登记时即摘除，而 body 要等扫描
    // 完成才更新——同一轮 build 里祖先行先于子行处理，仅查 stale 会漏。
    const ancestorReady = parent === null || (!this.stale.has(parent.from) && !this.scans.has(parent.from));
    const ancestor = parent ? this.group(parent, state) : { body: 0 };
    if (!ancestor || !ancestorReady) { this.pending = true; return false; }
    this.scans.set(list.from, { item: list.firstChild, width: 0, indent: ancestor.body + (parent ? 2 : 0) });
    this.pending = true;
    return true;
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
          let offset = line.text.search(/\S/);
          if (offset >= 0 && line.text[offset] === ">") {
            // 引用内的列表（M138）：行首是引用标记时内容位置在标记之后，扫过
            // 全部连续 `>` 与紧随的空格后按常规列表判定——引用内的列表与正文
            // 里的列表同一套标记 widget、同一套等宽序号与正文缩进。
            //
            // 此前只有 callout（M109）放开这一路径，普通引用的列表停在源码态；
            // 放开后 callout 与普通引用走同一分支（callout 本就是 blockquote），
            // 嵌套引用 `> > ` 也自然按最内层内容起点解析。
            let content = offset;
            while (line.text[content] === ">") {
              content++;
              while (content < line.text.length && line.text[content] === " ") content++;
            }
            if (content < line.text.length) offset = content;
          }
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
