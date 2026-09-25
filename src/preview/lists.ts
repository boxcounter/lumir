import { forceParsing, syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { StateEffect } from "@codemirror/state";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { EDITOR_FONT_FAMILY_TOKEN } from "../typography";

type Node = ReturnType<typeof syntaxTree>["topNode"];
interface Group { width: number; body: number; depth: number; labels: ReadonlyMap<number, string> }
const isList = (node: Node) => node.name === "BulletList" || node.name === "OrderedList";

/** ol 复合多级编号（定稿 direction-c/index.html:250-270 的 counter 拼接）：L1 `1.`、
 *  L2 `1.1`、L3 `1.5.1`——只有第一层带尾点。`prefix` 是父项的复合编号（仅当父列表
 *  也是 ol；父列表是 ul 时链条断开，本项从自己起编号）。父编号深层不带尾点，
 *  拼 stem 时按有无尾点两种形态都归一到「无尾点再拼」。 */
export function orderedItemLabel(prefix: string | null, index: number): string {
  if (prefix === null) return `${index}.`;
  const stem = prefix.endsWith(".") ? prefix.slice(0, -1) : prefix;
  return `${stem}.${index}`;
}

/** ul 标记 glyph（定稿 index.html:271-277）：L1 `–`（en dash）、L2 及更深 `◦`。 */
export function bulletGlyph(depth: number): string {
  return depth <= 1 ? "–" : "◦";
}

/** 两份编号表逐键同值判定（组重扫的 publish 判据用）。 */
function labelsEqual(a: ReadonlyMap<number, string>, b: ReadonlyMap<number, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

/** 标记字号的逐级递减档（定稿：13.5 / 13 / 12.5，正文锚 15px 下的 em 比值；深度 >3 同
 *  第三档）。与 theme.ts 的 `.cm-lp-list-marker-d1/-d2/-d3` 是同一组比值的两个写值：
 *  改一处必须改另一处（canvas 测量按它量标记宽度，见下方 measure 的注释）。 */
const MARKER_FONT_RATIOS = [13.5 / 15, 13 / 15, 12.5 / 15] as const;

class ListMarker extends WidgetType {
  // 显式字段而非参数属性：tests/unit 的 Node 类型剥离（strip-only）不支持参数属性，
  // 本模块是单测的直接导入对象（content-restyle.test.ts）。
  readonly label: string;
  readonly task: string | null;
  readonly depth: number;
  constructor(label: string, task: string | null, depth: number) {
    super();
    this.label = label;
    this.task = task;
    this.depth = depth;
  }
  eq(other: ListMarker) { return this.label === other.label && this.task === other.task && this.depth === other.depth; }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-lp-list-marker cm-lp-list-marker-d${Math.min(Math.max(this.depth, 1), 3)}`;
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

const measured = StateEffect.define<readonly number[]>();
const metadataReady = StateEffect.define<null>();
interface GroupScan {
  item: Node | null;
  width: number;
  indent: number;
  /** 列表嵌套深度（1 = 顶层）：标记 glyph 与字号档按它取。 */
  depth: number;
  /** 父项的复合编号（父列表是 ol 时）；ul 断链为 null。 */
  prefix: string | null;
  /** ol 组内已扫到的项序号（1 基）。 */
  index: number;
  /** item.from → 显示编号（ol 组；ul 组恒为空表）。 */
  labels: Map<number, string>;
}

class ListLayout {
  private units: readonly number[] | null = null;
  private observer: MutationObserver;
  private measure = () => this.view.requestMeasure({
    key: this,
    read: () => {
      const style = getComputedStyle(this.view.contentDOM);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      // 字体族与**三档字号比值**都必须与标记渲染用的那一份同源（change
      // typography-and-zoom / restyle-ui-tokens-v1 / M218 C3）：
      // - 族：`.cm-lp-list-marker` 的 fontFamily 是 `var(--editor-font-family)`（sans，
      //   定稿的标记族；src/preview/theme.ts），这里读的也是它。**这是字符串取值、不是
      //   CSS 引用**：改 token 名不会带着它走，所以非默认 `font_family` 下若两处不同源，
      //   标记会按旧族算宽、与正文对不齐（REVIEW.md 第 8 条的第二种形态：一处是 CSS
      //   引用、一处是 JS 取值）。
      // - 字号比值：标记字号逐级递减 13.5 / 13 / 12.5（正文锚 15px），比值表
      //   MARKER_FONT_RATIOS 与 theme.ts 的 `.cm-lp-list-marker-d1/-d2/-d3` 是同一组
      //   比值的两个写值：改一处必须改另一处，否则测量宽度与渲染宽度分叉，悬挂缩进
      //   逐级错位。这里量的是「0」在各档**标记渲染字号**下的宽度（数字在 sans 下
      //   等宽——标记带了 tabular-nums，逐级一个单位宽）。
      // 族取值点同时受视觉场景钉住（typography.spec.ts）：口径是 canvas 拿到的族串 =
      // token **原文**（自定义属性 getPropertyValue 返回 var() 代入后的未归一字面量）；
      // 它与标记的**计算** fontFamily 不是同一形态——sans 栈经 Chromium 归一
      //（BlinkMacSystemFont → "system-ui"）后与原文分叉，mono 栈无别名时恰好相等。
      // 场景侧分别钉：canvasFonts 断言钉原文串，listMarkerFontFamily 断言钉归一形态。
      const family = style.getPropertyValue(EDITOR_FONT_FAMILY_TOKEN);
      const base = parseFloat(style.fontSize);
      return MARKER_FONT_RATIOS.map((ratio) => {
        context.font = `${base * ratio}px ${family}`;
        return context.measureText("0").width;
      });
    },
    write: (value) => queueMicrotask(() => {
      if (this.destroyed) return;
      const changed = this.units === null || value.some((v, i) => Math.abs(v - (this.units?.[i] ?? 0)) > .01);
      if (changed) this.view.dispatch({ effects: measured.of(value) });
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

  private view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
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
      if (effect.is(measured)) { this.units = effect.value; resized = true; }
      if (effect.is(metadataReady)) resized = true;
    }
    if (update.docChanged) {
      // 编辑不清掉已发布的组：键位经 changes 映射后旧宽度先顶着渲染，stale
      // 驱动后台重扫，只有宽度真变了才 publish 重建（见 schedule）。直接清空
      // 会让每次击键掉装饰 ≥16ms，列表文字左右抖动（桌面验收缺陷）。
      // labels 的键（item.from）随组键一起映射：陈旧编号先顶着（插项导致的
      // 错号最多存留一个重扫周期），重扫 publish 后归零。
      const remapped = new Map<number, Group>();
      for (const [from, group] of this.groups) {
        const labels = new Map<number, string>();
        for (const [itemFrom, label] of group.labels) labels.set(update.changes.mapPos(itemFrom, 1), label);
        remapped.set(update.changes.mapPos(from, 1), { ...group, labels });
      }
      this.groups = remapped;
      this.stale = new Set(remapped.keys());
      this.scans.clear();
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.tree = tree;
    // 注意：geometryChanged 刻意不是测量触发点。标记宽度只依赖字体族/字号
    //（documentElement 的 style/class 经 MutationObserver、字体就绪经
    // document.fonts loadingdone、初始值经构造时的 measure——typography.ts 的字体
    // token 就写在 documentElement.style 上），窗口 resize / 主题切换都不改变它们。
    // 挂 geometryChanged 的反例（M222 回归 3 探针实证）：⌘A→↓ 的滚动校正环路每个
    // pass 都 geometryChanged → 每 pass 再排一次 requestMeasure → 测量环路被洪峰
    // 打断（CM 的 "Measure loop restarted more than 5 times"），scrollTarget 的末次
    // 校正跑不完，无 fm 长文档的 ↓ 揭示不足（cursor-motion.spec.ts:84）。
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
              // 显示标记（定稿列表标记体系，M218 C3）：ol = 复合多级编号（项在组内的
              // 序号拼父项链，不是源码里的字面数字）；ul = 按深度的 glyph。宽度按**显示
              // 标记**的字符数预分配（数字在标记的 tabular-nums 下等宽）。
              let display: string;
              if (/^\d/.test(label)) {
                scan.index++;
                display = orderedItemLabel(scan.prefix, scan.index);
                scan.labels.set(item.from, display);
              } else {
                display = bulletGlyph(scan.depth);
              }
              scan.width = Math.max(scan.width, display.length + (task ? 3.5 : 0) + 1);
            }
            scan.item = item.nextSibling;
          }
          if (!scan.item) {
            const next: Group = { width: scan.width, body: scan.indent + scan.width, depth: scan.depth, labels: scan.labels };
            const previous = this.groups.get(from);
            this.groups.set(from, next);
            this.scans.delete(from);
            // 重扫结果与已发布值一致不触发重建：陈旧组顶渲染期间宽度本就正确，
            // 一致时还 dispatch 会多一轮无变化的全量 build。labels 必须参与比较：
            // 插项只改编号不改宽度时，靠它把新编号发布出去。
            if (!previous || previous.width !== next.width || previous.body !== next.body || !labelsEqual(previous.labels, next.labels)) published = true;
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
    const ancestor: Group | null = parent ? this.group(parent, state) : null;
    if ((parent !== null && ancestor === null) || !ancestorReady) { this.pending = true; return false; }
    // 深度与复合编号前缀（M218 C3）：深度 = 祖先组深度 + 1；编号链只穿过 ol 祖先
    // ——父列表是 ul 时断链（定稿的 counter 拼接只覆盖 `ol > li > ol` 直系），本项
    // 从自己起编号。祖先组此刻必已发布（上面的就绪闸），其 labels 覆盖自己的全部
    // 父项，前缀因此一定取得到（取不到按断链降级，重扫会修正）。
    const parentItem = list.parent;
    const prefix =
      parent?.name === "OrderedList" && parentItem && ancestor
        ? ancestor.labels.get(parentItem.from) ?? null
        : null;
    this.scans.set(list.from, {
      item: list.firstChild,
      width: 0,
      indent: (ancestor?.body ?? 0) + (parent ? 2 : 0),
      depth: ancestor ? ancestor.depth + 1 : 1,
      prefix,
      index: 0,
      labels: new Map(),
    });
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
                if (!group || !this.units) {
                  if (line.number === doc.lines) break;
                  line = doc.line(line.number + 1);
                  continue;
                }
                // 测量单位按组深度取档（标记字号逐级递减，见 MARKER_FONT_RATIOS）。
                const unit = this.units[Math.min(group.depth, 3) - 1];
                decorations.push(Decoration.line({
                  class: `cm-lp-list-line${first ? " cm-lp-list-first" : ""}`,
                  attributes: { style: `--lp-list-body:${group.body * unit}px;--lp-list-marker:${group.width * unit}px` },
                }).range(line.from));
                if (first && mark) {
                  const task = node.getChild("Task")?.getChild("TaskMarker");
                  let end = task?.to ?? mark.to;
                  while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
                  const label = doc.sliceString(mark.from, mark.to);
                  // 显示标记：ol 取组扫描算好的复合编号（扫描保证覆盖本项；陈旧组顶
                  // 渲染期间取不到时退回源码字面数字，重扫 publish 后归位），ul 按深度
                  // 取 glyph（`–` / `◦`）。
                  const display = /^\d/.test(label)
                    ? group.labels.get(node.from) ?? label
                    : bulletGlyph(group.depth);
                  decorations.push(Decoration.replace({ widget: new ListMarker(display, task ? doc.sliceString(task.from, task.to) : null, group.depth) }).range(line.from, end));
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
