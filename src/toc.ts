// 轻量大纲（TOC）——M148。
//
// 入口形态（Alex 裁决）：masthead 在文件名后显示**当前标题路径**（兼作位置指示），点击这段或
// 按 ⌘⇧O（keys.ts 的 `toc.toggle`）展开浮层大纲。目标是「视觉与交互都比较轻」：不加右栏、不加
// 常驻面板、不占文档区任何空间（浮层绝对定位，颜色/边框/圆角全部取 M55 的既有 token）。
//
// 数据只有一份来源：CM syntaxTree 的 ATXHeading 节点（遍历先例见 src/preview/livePreview.ts，
// 但本模块不 import preview 内部物，也不引入第二次 Markdown 解析）。两个消费者共用同一套提取：
//   - masthead 指示段：光标所在段（光标滚出视口时退化为视口顶部所在段）的标题链，节流刷新；
//   - 浮层条目表：全文档标题，H1–H6 按层级缩进，当前段高亮。
//
// 标题文本取该行的文档原文去掉 `#` 标记（首尾的结尾标记一并去掉），行内标记（`**` 等）不剥离：
// v1 只做「显示作者写下的那一行」，不做二次渲染，也不猜测作者意图。
//
// 三个已解析树口径（性能合同：键击路径不得整篇解析）：
//   - 指示段随每次光标/滚动变化重算，只用**已解析**的树（syntaxTree(state)），永不强制解析；
//   - 浮层打开是用户主动动作、不在键入路径上，这一次才补一次全量解析（25ms 预算，超时回落
//     已解析部分），保证条目表尽可能是全文。
//
// 浮层自己的导航键（↑↓ / Enter / Esc）由浮层就地消费，**不进** keys.ts 的统一表：表的不变量是
// 「一个 token 一条绑定」，而 ↑↓ 已归 editor.cursor-*、Esc 已归 editor.widget-escape（带 when
// 条件）。浮层打开期间持有焦点，editor 作用域因「事件目标不在 contentDOM 内」不命中，就地消费
// 后 preventDefault，window 上的分发器对已消费事件让路——与 M133 键位面板、M139 搜索 panel
// 同一套口径，不构成同一物理键的第二条分发映射。
//
// 已知边界（如实记录，见 change add-toc-outline 的 spec）：
//   - 只认 ATX 标题（`#` 起首）；Setext 标题（`===` / `---` 下划线形态）v1 不识别；
//   - 标题文本保留行内标记原文（`## **粗**标题` 显示为 `**粗**标题`）；
//   - 缩进按「文档里出现的最浅层标题」归一（只有 H2/H3 的文档不浪费一层空缩进）；
//   - 光标落在首个标题之前（前言 / frontmatter 里）时没有「当前标题」，指示段不显示。

import { StateEffect } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { keyToken } from "./keys";
// frontmatter 范围的唯一真源（tower 批准 M148 的只读复用，2026-09-17）：lezer 的 markdown
// 解析器不认识 YAML frontmatter，首部 `---` 块里一行 `# x`（YAML 注释）会被解析成
// ATXHeading1——不排除它就会在大纲里多出一条幽灵条目。语义只有这一份实现（editor.ts 与
// livePreview 同样用它），因此这里 import 而不是自写一份判定。约束：对该文件零改动。
import { detectFrontmatter } from "./preview/frontmatter";

export interface TocHeading {
  /** 标题层级 1–6（ATXHeadingN 的 N）。 */
  level: number;
  /** 行原文去掉 `#` 标记（行内标记保留）。 */
  text: string;
  /** 1 基行号。 */
  line: number;
  /** 行首 / 行尾的文档偏移：跳转把光标放在行尾。 */
  from: number;
  to: number;
}

export interface TocOptions {
  view: EditorView;
  /** masthead 的当前位置指示段（点击展开浮层）。 */
  indicator: HTMLButtonElement;
  /** 浮层挂点（.masthead：浮层的定位块）。 */
  mount: HTMLElement;
  /** 是否有当前文件：空态（未打开 vault / 无当前文件）不显示指示段。 */
  hasFile(): boolean;
  /** 无标题文档被激活时的提示出口（装配层注入；文案见 文案-Copy.md D84）。 */
  toast(text: string): void;
}

export interface TocHandle {
  /** ⌘⇧O 与点击指示段共用的入口：关→开，开→关；无标题时只给提示。 */
  toggle(): void;
}

/** ATX 标题节点名（H1–H6）。 */
const ATX_HEADING = /^ATXHeading([1-6])$/;
/** 行首的 `#` 标记串与紧随其后的空白。 */
const LEADING_MARKS = /^\s*#{1,6}[ \t]*/;
/** 结尾标记：`#` 前必须有空白才算（CommonMark 口径，`## 标题##` 的 `##` 属正文）。 */
const TRAILING_MARKS = /[ \t]+#+[ \t]*$/;

/** 节流窗口（ms）：光标/滚动后的重算合并到这一档，避免每次按键都遍历语法树。 */
const SYNC_THROTTLE_MS = 120;
/** 浮层打开路径的全量解析预算（ms）；超时回落已解析部分。 */
const FULL_PARSE_BUDGET_MS = 25;
/** 浮层条目的 id 前缀（aria-activedescendant 用；同页唯一即可）。 */
const ITEM_ID_PREFIX = "lumir-toc-opt-";

/** 文案（单一来源 文案-Copy.md D84–D87）。 */
const NO_HEADINGS_TEXT = "这份文档还没有标题，大纲为空";
const POPOVER_LABEL = "大纲";
const POPOVER_HINT = "↑↓ 选择 · Enter 跳转 · Esc 关闭";
const INDICATOR_TITLE = "点击展开大纲";
/** 标题链的分隔符（纯排版分隔，不承载语义）。 */
const PATH_SEPARATOR = " › ";

/** 标题行原文 → 条目文本：去掉行首 `#` 标记串与结尾标记。 */
function headingText(rawLine: string): string {
  return rawLine.replace(LEADING_MARKS, "").replace(TRAILING_MARKS, "").trim();
}

/**
 * 提取全文标题（文档顺序）。`full` 为真时先补一次全量解析（浮层路径，见文件头）；
 * 为假时只用已解析的树（指示段路径，不做额外解析工作）。
 *
 * frontmatter 块内的 ATXHeading 节点一律排除：那是 YAML 注释行，不是作者的标题。
 */
export function extractHeadings(state: EditorState, full = false): TocHeading[] {
  const tree = full
    ? ensureSyntaxTree(state, state.doc.length, FULL_PARSE_BUDGET_MS) ?? syntaxTree(state)
    : syntaxTree(state);
  const frontmatter = detectFrontmatter(state.doc);
  const headings: TocHeading[] = [];
  tree.iterate({
    enter(ref) {
      const level = ATX_HEADING.exec(ref.node.name)?.[1];
      if (level === undefined) return;
      const line = state.doc.lineAt(ref.from);
      if (frontmatter !== null && line.from <= frontmatter.to) return;
      headings.push({
        level: Number(level),
        text: headingText(line.text),
        line: line.number,
        from: line.from,
        to: line.to,
      });
    },
  });
  return headings;
}

/**
 * 当前位置锚点：光标在可见范围内时取光标，否则取视口顶部。
 * 位置指示与浮层的「当前段」都以它为准——「随光标移动/滚动更新」这条口径的落点就在这里。
 */
export function anchorPos(state: EditorState, view: EditorView): number {
  const head = state.selection.main.head;
  for (const range of view.visibleRanges) {
    if (head >= range.from && head <= range.to) return head;
  }
  return view.visibleRanges[0]?.from ?? head;
}

/** 包含 pos 的标题下标（最后一个 `from <= pos` 的标题）；pos 在首个标题之前时返回 -1。 */
export function headingIndexAt(headings: readonly TocHeading[], pos: number): number {
  let index = -1;
  for (let i = 0; i < headings.length; i++) {
    if (headings[i].from > pos) break;
    index = i;
  }
  return index;
}

/** 该标题的祖先链（含自身）：同级或更浅的同族标题各自另起一段，链上只留祖先。 */
export function headingPath(headings: readonly TocHeading[], index: number): TocHeading[] {
  if (index < 0) return [];
  const path: TocHeading[] = [];
  for (let i = 0; i <= index; i++) {
    while (path.length > 0 && path[path.length - 1].level >= headings[i].level) path.pop();
    path.push(headings[i]);
  }
  return path;
}

class Toc implements TocHandle {
  private readonly view: EditorView;
  private readonly indicator: HTMLButtonElement;
  private readonly popover: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly hasFile: () => boolean;
  private readonly toast: (text: string) => void;
  /** 浮层的定位块（.masthead）：浮层 left 与指示段 offsetLeft 同基准。 */
  private readonly container: HTMLElement;

  /** 浮层里的条目表快照（打开那一刻取全量解析结果，打开期间不重建）。 */
  private entries: TocHeading[] = [];
  private items: HTMLElement[] = [];
  /** 浮层打开态与键盘游标（entries 的下标）。 */
  private open = false;
  private activeIndex = -1;
  /** 节流状态。 */
  private timer: number | null = null;
  private lastRun = 0;

  constructor(options: TocOptions) {
    this.view = options.view;
    this.indicator = options.indicator;
    this.hasFile = options.hasFile;
    this.toast = options.toast;
    this.container = options.mount;

    const popover = document.createElement("div");
    popover.className = "lumir-toc";
    popover.hidden = true;
    const list = document.createElement("div");
    list.className = "lumir-toc-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", POPOVER_LABEL);
    list.tabIndex = -1;
    const hint = document.createElement("p");
    hint.className = "lumir-toc-hint";
    hint.textContent = POPOVER_HINT;
    popover.append(list, hint);
    options.mount.append(popover);
    this.popover = popover;
    this.list = list;

    this.indicator.title = INDICATOR_TITLE;
    // mousedown 不夺焦点：焦点留在编辑器（或浮层）时，点击只是「切换」，不会先触发浮层的
    // blur 关闭再重新打开（那会让开→关→开连成一串）。
    this.indicator.addEventListener("mousedown", (event) => event.preventDefault());
    this.indicator.addEventListener("click", () => this.toggle());

    list.addEventListener("keydown", (event) => this.onKeydown(event));
    // 焦点离开浮层即收起（Tab 出去、点到别处、窗口失活都走这条）——这条路径不抢焦点。
    list.addEventListener("blur", () => this.close(false));
    // 点击浮层与指示段之外的地方收起（编辑器、文件树、toast…）。
    document.addEventListener("mousedown", (event) => {
      if (!this.open) return;
      const target = event.target;
      if (target instanceof Node && (popover.contains(target) || this.indicator.contains(target))) return;
      this.close();
    });

    this.attach();
  }

  toggle(): void {
    if (this.open) {
      this.close();
      return;
    }
    const entries = extractHeadings(this.view.state, true);
    if (entries.length === 0) {
      this.toast(NO_HEADINGS_TEXT);
      return;
    }
    this.entries = entries;
    this.render(headingIndexAt(entries, anchorPos(this.view.state, this.view)));
    this.open = true;
    this.popover.hidden = false;
    this.place();
    this.list.focus();
    // 可见之后再滚一次：display:none 时 scrollIntoView 不动（当前段可能落在浮层可视区之外）。
    this.setActive(this.activeIndex);
  }

  /** 订阅视图更新（节流）：光标移动、滚动（视口变化）、换文件都经这一条路径。 */
  private attach(): void {
    this.view.dispatch({
      effects: StateEffect.appendConfig.of(EditorView.updateListener.of(() => this.schedule())),
    });
    this.sync();
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const delay = Math.max(0, SYNC_THROTTLE_MS - (performance.now() - this.lastRun));
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.lastRun = performance.now();
      this.sync();
    }, delay);
  }

  /** 指示段与状态对齐：标题链 + 是否有当前文件；没有标题或没有当前文件时不显示。 */
  private sync(): void {
    const headings = extractHeadings(this.view.state);
    const path = headingPath(headings, headingIndexAt(headings, anchorPos(this.view.state, this.view)));
    const text = path.map((heading) => heading.text).join(PATH_SEPARATOR);
    if (this.indicator.textContent !== text) this.indicator.textContent = text;
    this.indicator.hidden = !this.hasFile() || path.length === 0;
  }

  /** 构建条目表；current 为当前段下标（-1 = 光标在首个标题之前，没有当前段）。 */
  private render(current: number): void {
    const shallowest = this.entries.reduce((min, heading) => Math.min(min, heading.level), 6);
    // 上一轮条目整体作废：清空游标与其 DOM，避免跨轮清理指到新数组的同名下标上。
    this.list.replaceChildren();
    this.items = [];
    this.activeIndex = -1;
    this.items = this.entries.map((heading, i) => {
      const item = document.createElement("div");
      item.className = "lumir-toc-item";
      item.id = `${ITEM_ID_PREFIX}${i}`;
      item.setAttribute("role", "option");
      item.dataset.level = String(heading.level);
      item.dataset.line = String(heading.line);
      // 缩进归一（见文件头）：只用 H2/H3 的文档不浪费一层空缩进。
      item.style.setProperty("--toc-depth", String(heading.level - shallowest));
      item.textContent = heading.text;
      if (i === current) item.classList.add("is-current");
      // 点击路径与键盘路径共用同一个落点（jumpTo），不产生第二套跳转。
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => this.jumpTo(i));
      this.list.append(item);
      return item;
    });
    this.setActive(current >= 0 ? current : 0);
  }

  private setActive(index: number): void {
    const previous = this.items[this.activeIndex];
    if (previous) {
      previous.classList.remove("is-active");
      previous.setAttribute("aria-selected", "false");
    }
    this.activeIndex = index;
    const item = this.items[index];
    if (!item) {
      this.list.removeAttribute("aria-activedescendant");
      return;
    }
    item.classList.add("is-active");
    item.setAttribute("aria-selected", "true");
    this.list.setAttribute("aria-activedescendant", item.id);
    item.scrollIntoView({ block: "nearest" });
  }

  /** 把浮层对到指示段下方（右端不越出 masthead 的可视区）。 */
  private place(): void {
    // 与 .masthead 的左右内边距同值（style.css 的 padding 简写）。
    const padding = 48;
    // 两个 left 同基准才可比：浮层的 CSS left 相对包含块（.masthead）的内边距盒，故这里
    // 用两者的视口坐标相减，而不是 offsetLeft（相对基准易漂）。
    const offset = this.indicator.getBoundingClientRect().left - this.container.getBoundingClientRect().left;
    const max = Math.max(0, this.container.clientWidth - this.popover.offsetWidth - padding);
    this.popover.style.left = `${Math.min(Math.max(offset, 0), max)}px`;
  }

  /**
   * 收起浮层。`restoreFocus` 为假时不抢焦点——焦点本来就去了别处（Tab 到别的控件、点了别的
   * 窗口）时把焦点拽回编辑器是无礼的；Esc / Enter / 再按一次 ⌘⇧O 这些「在浮层里做的关闭」
   * 才需要交还焦点。
   */
  private close(restoreFocus = true): void {
    if (!this.open) return;
    this.open = false;
    this.popover.hidden = true;
    if (restoreFocus) this.view.focus();
  }

  /** 跳转：光标落到标题行尾 + 把该行滚到视口居中（与 editor.revealLine 同一落点口径）。 */
  private jumpTo(index: number): void {
    const heading = this.entries[index];
    if (!heading) return;
    this.close();
    const pos = Math.min(heading.to, this.view.state.doc.length);
    this.view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
    // 指示段立即跟上本次跳转（不等节流窗口），否则跳转后的路径要过一拍才更新。
    this.sync();
  }

  private move(delta: number): void {
    if (this.items.length === 0) return;
    const next = Math.min(this.items.length - 1, Math.max(0, this.activeIndex + delta));
    if (next !== this.activeIndex) this.setActive(next);
  }

  private onKeydown(event: KeyboardEvent): void {
    const token = keyToken(event);
    if (token === null) return;
    switch (token) {
      case "ArrowDown":
        this.move(1);
        break;
      case "ArrowUp":
        this.move(-1);
        break;
      case "Enter":
        this.jumpTo(this.activeIndex);
        break;
      case "Escape":
        this.close();
        break;
      default:
        return; // 其余键不消费：浮层不是模态，Tab 等照常走原生焦点路径
    }
    event.preventDefault();
  }
}

/** 装配大纲（浮层 + masthead 指示段）；返回命令层要的入口。 */
export function createToc(options: TocOptions): TocHandle {
  return new Toc(options);
}
