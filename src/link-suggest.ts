import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { StateEffect, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { cancelCompositionSettle, scheduleCompositionSettle } from "./composition-settle";
import { onRelabel } from "./copy";
import { registerEscapeLayer, unregisterEscapeLayer } from "./escape-router";
import { FILTER_LABEL, NO_MATCH_TEXT, foldCase, isFoldedMatch } from "./list-filter";
import {
  applyOverlayPlacement,
  overlayFontSize,
  placeOverlay,
  type OverlayPlacement,
} from "./overlay-placement";
import { isInsideCodeContext } from "./preview/code-context";
import { detectFrontmatter } from "./preview/frontmatter";
import { findWikilinkSpans } from "./preview/wikilinks";
import { isFullyVisibleWithin, revealElementWithin } from "./selector-reveal";

export interface LinkSuggestTrigger {
  readonly openerFrom: number;
  readonly queryFrom: number;
  readonly head: number;
  readonly query: string;
}

export interface LinkSuggestOptions {
  readonly focused: boolean;
  readonly composing?: boolean;
  readonly allowUnavailableSyntax?: boolean;
}

function insideStandardLink(state: EditorState, pos: number): boolean {
  let node: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 0);
  while (node !== null) {
    if (node.name === "Link" || node.name === "Image") return true;
    node = node.parent;
  }
  return false;
}

function insideInlineCode(prefix: string): boolean {
  let delimiter = 0;
  for (let index = 0; index < prefix.length;) {
    if (prefix[index] !== "`") {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (prefix[end] === "`") end += 1;
    const run = end - index;
    if (delimiter === 0) delimiter = run;
    else if (delimiter === run) delimiter = 0;
    index = end;
  }
  return delimiter !== 0;
}

function insideUnclosedLabel(prefix: string): boolean {
  let depth = 0;
  for (let index = 0; index < prefix.length; index += 1) {
    if (prefix[index] === "[") {
      if (prefix[index + 1] === "[") index += 1;
      else depth += 1;
    } else if (prefix[index] === "]" && prefix[index + 1] !== "]" && depth > 0) {
      depth -= 1;
    }
  }
  return depth > 0;
}

export function findLinkSuggestTrigger(state: EditorState, options: LinkSuggestOptions): LinkSuggestTrigger | null {
  if (!options.focused || options.composing === true || state.readOnly) return null;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
  const head = state.selection.main.head;
  if (options.allowUnavailableSyntax !== true && !syntaxTreeAvailable(state, head)) return null;
  const line = state.doc.lineAt(head);
  const prefix = line.text.slice(0, head - line.from);
  const opener = prefix.lastIndexOf("[[");
  if (opener < 0 || (opener > 0 && prefix[opener - 1] === "!")) return null;
  const query = prefix.slice(opener + 2);
  if (/[|#[\]]/.test(query)) return null;
  if (/^(?: {4}|\t)/.test(line.text)) return null;
  if (insideInlineCode(prefix.slice(0, opener)) || insideUnclosedLabel(prefix.slice(0, opener))) return null;
  const openerFrom = line.from + opener;
  const localHead = head - line.from;
  for (const span of findWikilinkSpans(line.text)) {
    if (!span.embed && localHead > span.from && localHead < span.to) return null;
  }
  const frontmatter = detectFrontmatter(state.doc);
  if (frontmatter !== null && head >= frontmatter.from && head <= frontmatter.to) return null;
  const tree = syntaxTree(state);
  if (isInsideCodeContext(tree, Math.min(head, openerFrom + 1)) || isInsideCodeContext(tree, head)) return null;
  if (insideStandardLink(state, openerFrom) || insideStandardLink(state, head)) return null;
  return { openerFrom, queryFrom: openerFrom + 2, head, query };
}

export interface LinkSuggestion {
  readonly path: string;
  /** 完整 vault 相对路径；根文件精确同名歧义或索引已失效时为 null。 */
  readonly target: string | null;
}

function isMarkdown(path: string): boolean {
  return foldCase(path).endsWith(".md");
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function representable(path: string): boolean {
  if (path === "" || path.trim() !== path || /[|#[\]\r\n]/.test(path)) return false;
  let segmentFrom = 0;
  for (let index = 0; index <= path.length; index += 1) {
    if (index !== path.length && path[index] !== "/") continue;
    const length = index - segmentFrom;
    if (length === 0 || (length === 1 && path[segmentFrom] === ".") || (length === 2 && path[segmentFrom] === "." && path[segmentFrom + 1] === ".")) return false;
    segmentFrom = index + 1;
  }
  return true;
}

export function acceptTargetForPath(paths: readonly string[], selected: string): string | null {
  if (!isMarkdown(selected) || !representable(selected) || !paths.includes(selected)) return null;
  if (selected.includes("/")) return selected;
  for (const path of paths) {
    if (path !== selected && isMarkdown(path) && fileName(path) === selected) return null;
  }
  return selected;
}

interface IndexedLinkPath {
  readonly path: string;
  readonly foldedPath: string;
}

export function buildLinkSuggestions(paths: readonly string[], query: string): LinkSuggestion[] {
  const unique: IndexedLinkPath[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    const foldedPath = foldCase(path);
    if (foldedPath.endsWith(".md") && representable(path)) unique.push({ path, foldedPath });
  }
  const foldedQuery = foldCase(query);
  const buckets: number[][] = [[], [], [], []];
  for (let index = 0; index < unique.length; index += 1) {
    const item = unique[index] as IndexedLinkPath;
    if (query === "") buckets[0].push(index);
    else if (!isFoldedMatch(item.foldedPath, foldedQuery)) continue;
    else {
      const stem = fileName(item.path).slice(0, -3);
      const foldedStem = foldCase(stem);
      if (stem === query) buckets[0].push(index);
      else if (foldedStem === foldedQuery) buckets[1].push(index);
      else if (foldedStem.startsWith(foldedQuery)) buckets[2].push(index);
      else buckets[3].push(index);
    }
  }
  let rootFileNames: Map<string, number> | null = null;
  return buckets.flat().slice(0, 100).map((index) => {
    const path = (unique[index] as IndexedLinkPath).path;
    if (path.includes("/")) return { path, target: path };
    if (rootFileNames === null) {
      rootFileNames = new Map<string, number>();
      for (const candidate of seen) {
        if (!isMarkdown(candidate)) continue;
        const name = fileName(candidate);
        rootFileNames.set(name, (rootFileNames.get(name) ?? 0) + 1);
      }
    }
    return { path, target: rootFileNames.get(path) === 1 ? path : null };
  });
}

export const linkSuggestRefresh = StateEffect.define<null>();

interface OpenState {
  readonly trigger: LinkSuggestTrigger;
  readonly items: readonly LinkSuggestion[];
  readonly active: number;
}

interface PlaceMeasurement {
  readonly placement: OverlayPlacement;
  readonly available: number;
  readonly top: number;
  readonly baseLeft: number;
}

/** 揭示时机（docs/specs/selector-contract.md C3）：
 *  - `cursor`：游标刚变，越界才滚、带内不动；
 *  - `if-clipped`：游标没变。只有重排前完整可见的活动行被新几何挤出带时才揭示——用户手动滚开
 *    是在读别处，同状态刷新 / resize / 滚动 MUST NOT 把它拉回活动行。 */
type RevealMode = "cursor" | "if-clipped";

function sameOpenState(left: OpenState, right: OpenState): boolean {
  return left.active === right.active &&
    left.trigger.openerFrom === right.trigger.openerFrom &&
    left.trigger.queryFrom === right.trigger.queryFrom &&
    left.trigger.head === right.trigger.head &&
    left.trigger.query === right.trigger.query &&
    left.items.length === right.items.length &&
    left.items.every((item, index) => item.path === right.items[index]?.path && item.target === right.items[index]?.target);
}

class LinkSuggestView {
  readonly view: EditorView;
  private readonly files: () => readonly string[];
  private readonly enabled: () => boolean;
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly id: string;
  private state: OpenState | null = null;
  private composing = false;
  private settling = false;
  private destroyed = false;
  /** 已排队的几何重排（read/write 跨拍）。见 `schedulePlace`：清样式的瞬时塌缩不得回灌成用户滚动。 */
  private placementPending = false;

  constructor(view: EditorView, files: () => readonly string[], enabled: () => boolean, id: string) {
    this.view = view;
    this.files = files;
    this.enabled = enabled;
    this.id = id;
    this.root = view.dom.ownerDocument.createElement("div");
    this.root.className = "lumir-link-suggest";
    this.list = view.dom.ownerDocument.createElement("div");
    this.list.className = "lumir-link-suggest-list";
    this.list.setAttribute("role", "listbox");
    this.empty = view.dom.ownerDocument.createElement("div");
    this.empty.className = "lumir-link-suggest-empty";
    this.root.append(this.list, this.empty);
    this.relabel();
    onRelabel(() => {
      if (!this.destroyed) this.relabel();
    });
    view.contentDOM.addEventListener("keydown", this.onKeyDown, true);
    view.contentDOM.addEventListener("compositionstart", this.onCompositionStart);
    view.contentDOM.addEventListener("compositionend", this.onCompositionEnd);
    view.contentDOM.addEventListener("blur", this.onBlur);
    view.contentDOM.addEventListener("focus", this.onFocus);
    view.dom.ownerDocument.addEventListener("mousedown", this.onOutsideMouseDown);
    view.dom.ownerDocument.defaultView?.addEventListener("resize", this.onGeometryChange);
    view.dom.ownerDocument.addEventListener("scroll", this.onGeometryChange, true);
    this.refresh();
  }

  update(update: ViewUpdate): void {
    if (update.view.compositionStarted) {
      this.composing = true;
      return;
    }
    if (this.settling) return;
    if (
      update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged ||
      update.focusChanged || syntaxTree(update.state) !== syntaxTree(update.startState) ||
      update.transactions.some((tr) => tr.effects.some((effect) => effect.is(linkSuggestRefresh)))
    ) this.refresh();
  }

  destroy(): void {
    this.destroyed = true;
    cancelCompositionSettle(this.view, "link-suggest");
    this.close();
    this.view.contentDOM.removeEventListener("keydown", this.onKeyDown, true);
    this.view.contentDOM.removeEventListener("compositionstart", this.onCompositionStart);
    this.view.contentDOM.removeEventListener("compositionend", this.onCompositionEnd);
    this.view.contentDOM.removeEventListener("blur", this.onBlur);
    this.view.contentDOM.removeEventListener("focus", this.onFocus);
    this.view.dom.ownerDocument.removeEventListener("mousedown", this.onOutsideMouseDown);
    this.view.dom.ownerDocument.defaultView?.removeEventListener("resize", this.onGeometryChange);
    this.view.dom.ownerDocument.removeEventListener("scroll", this.onGeometryChange, true);
  }

  compositionStart(): void {
    this.composing = true;
    cancelCompositionSettle(this.view, "link-suggest");
    this.settling = false;
  }

  compositionEnd(): void {
    this.composing = false;
    this.settling = true;
    scheduleCompositionSettle(this.view, "link-suggest", () => {
      if (this.destroyed) return;
      this.settling = false;
      this.refresh();
    });
  }

  isOpen(): boolean {
    return this.state !== null;
  }

  isSettling(): boolean {
    return this.composing || this.settling || this.view.compositionStarted;
  }

  accept(event?: KeyboardEvent): boolean {
    if (event !== undefined && (event.isComposing || event.keyCode === 229)) return false;
    const state = this.state;
    if (state === null || state.active < 0 || this.composing || this.settling || this.view.compositionStarted) return false;
    const selected = state.items[state.active];
    if (selected === undefined) return false;
    const trigger = findLinkSuggestTrigger(this.view.state, {
      focused: this.view.hasFocus,
      composing: this.view.compositionStarted,
      allowUnavailableSyntax: this.state !== null,
    });
    if (trigger === null || trigger.queryFrom !== state.trigger.queryFrom) {
      this.refresh();
      return false;
    }
    const target = acceptTargetForPath(this.files(), selected.path);
    if (target === null) return false;
    const caret = trigger.queryFrom + target.length + 2;
    this.view.dispatch({
      changes: { from: trigger.queryFrom, to: trigger.head, insert: `${target}]]` },
      selection: { anchor: caret },
      scrollIntoView: true,
      userEvent: "input.type",
    });
    this.close();
    this.view.focus();
    return true;
  }

  move(direction: 1 | -1, event?: KeyboardEvent): boolean {
    if (event !== undefined && (event.isComposing || event.keyCode === 229)) return false;
    const state = this.state;
    if (state === null || this.composing || this.settling) return false;
    const enabled = state.items.map((item, index) => item.target === null ? -1 : index).filter((index) => index >= 0);
    if (enabled.length === 0) return false;
    const current = enabled.indexOf(state.active);
    const next = current < 0 ? 0 : Math.min(enabled.length - 1, Math.max(0, current + direction));
    this.state = { ...state, active: enabled[next] as number };
    this.render();
    return true;
  }

  close(): void {
    this.state = null;
    this.root.remove();
    unregisterEscapeLayer("link-suggest");
    this.view.contentDOM.removeAttribute("aria-activedescendant");
  }

  refresh(): void {
    if (!this.enabled()) {
      this.close();
      return;
    }
    if (this.destroyed || this.composing || this.settling || this.view.compositionStarted) return;
    const trigger = findLinkSuggestTrigger(this.view.state, {
      focused: this.view.hasFocus,
      composing: this.view.compositionStarted,
      allowUnavailableSyntax: this.state !== null,
    });
    if (trigger === null) {
      this.close();
      return;
    }
    const items = buildLinkSuggestions(this.files(), trigger.query);
    const previousPath = this.state?.items[this.state.active]?.path;
    let active = previousPath === undefined ? -1 : items.findIndex((item) => item.path === previousPath && item.target !== null);
    if (active < 0) active = items.findIndex((item) => item.target !== null);
    const next = { trigger, items, active };
    const previous = this.state;
    this.state = next;
    if (previous !== null && sameOpenState(previous, next)) {
      this.schedulePlace("if-clipped");
      return;
    }
    this.render();
  }

  private schedulePlace(reveal: RevealMode): void {
    // 清样式会把列表从「可滚」打成「内容高」，scrollTop 同步归零——先记下来，写回定高后再恢复。
    // 「重排前是否完整可见」也必须在清样式之前判：清完列表已展开，旧几何不存在了。
    const preservedScrollTop = this.list.scrollTop;
    const wasFullyVisible = reveal === "if-clipped" && this.activeFullyVisible();
    // 跨拍重排的塌缩拍里，scroll 事件读到的是被钳成 0 的 scrollTop：那不是用户滚动，不许回灌
    // 成 place() 的新位置（否则写回 0 会把刚记下的阅读位置抹掉）。write 之后再恢复监听。
    this.placementPending = true;
    this.clearPlaceStyles();
    this.view.requestMeasure({
      read: () => this.measurePlace(),
      write: (measured) => {
        this.placementPending = false;
        this.writePlace(measured, preservedScrollTop, reveal, wasFullyVisible);
      },
      key: this,
    });
  }

  /** 当前已渲染几何下活动行是否完整落在真实可见带内（与 `revealElementWithin` 同一套几何）。
   *  重排前完整可见、重排后被挤出带 ⇒ 这次揭示由几何变化造成，该揭示；
   *  重排前就不可见 ⇒ 用户自己滚开了，同状态重排 MUST NOT 把它拉回。 */
  private activeFullyVisible(): boolean {
    const state = this.state;
    if (state === null || state.active < 0) return false;
    const active = this.list.children[state.active] as HTMLElement | undefined;
    const win = this.view.dom.ownerDocument.defaultView;
    if (active === undefined || win === null) return false;
    return isFullyVisibleWithin(this.list, active, { top: 0, bottom: win.innerHeight });
  }

  private clearPlaceStyles(): void {
    this.root.style.width = "";
    this.root.style.minWidth = "";
    this.root.style.maxHeight = "";
  }

  private relabel(): void {
    this.list.setAttribute("aria-label", FILTER_LABEL());
    this.empty.textContent = NO_MATCH_TEXT();
  }

  private render(): void {
    const state = this.state;
    if (state === null) return;
    if (!this.root.isConnected) this.view.dom.ownerDocument.body.append(this.root);
    registerEscapeLayer("link-suggest", () => this.close());
    this.relabel();
    this.list.replaceChildren();
    this.empty.hidden = state.items.length !== 0;
    this.list.hidden = state.items.length === 0;
    state.items.forEach((item, index) => {
      const row = this.view.dom.ownerDocument.createElement("div");
      row.className = "lumir-link-suggest-item";
      row.id = `${this.id}-${index}`;
      row.title = item.path;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === state.active));
      if (item.target === null) row.setAttribute("aria-disabled", "true");
      if (index === state.active) row.classList.add("is-active");
      const slash = item.path.lastIndexOf("/");
      const dirs = this.view.dom.ownerDocument.createElement("span");
      dirs.className = "lumir-link-suggest-dirs";
      dirs.textContent = slash < 0 ? "" : item.path.slice(0, slash + 1);
      const name = this.view.dom.ownerDocument.createElement("span");
      name.className = "lumir-link-suggest-name";
      name.textContent = item.path.slice(slash + 1);
      row.append(dirs, name);
      row.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (item.target === null) return;
        this.state = state.active === index ? state : { ...state, active: index };
        this.accept();
      });
      this.list.append(row);
    });
    if (state.active >= 0) this.view.contentDOM.setAttribute("aria-activedescendant", `${this.id}-${state.active}`);
    else this.view.contentDOM.removeAttribute("aria-activedescendant");
    // 揭示归 writePlace：这里只重建行。曾经的 scrollIntoView 会被紧随其后的 schedulePlace
    // 清掉 max-height 而把 scrollTop 归零，长列表的滚动位置永远累积不起来。
    this.schedulePlace("cursor");
  }

  private place(): void {
    // resize / 编辑器或列表滚动：没有游标变化，只为「原本可见却被新几何挤出」补揭示。
    const preservedScrollTop = this.list.scrollTop;
    const wasFullyVisible = this.activeFullyVisible();
    this.clearPlaceStyles();
    this.writePlace(this.measurePlace(), preservedScrollTop, "if-clipped", wasFullyVisible);
  }

  private measurePlace(): PlaceMeasurement | null {
    const state = this.state;
    if (state === null) return null;
    const caret = this.view.coordsAtPos(state.trigger.head);
    const win = this.view.dom.ownerDocument.defaultView;
    if (caret === null || win === null || caret.bottom < 0 || caret.top > win.innerHeight) return null;
    const placement = placeOverlay({
      tier: "list",
      natural: this.root.getBoundingClientRect().width,
      host: win.innerWidth,
      hostLeft: 0,
      fontSize: overlayFontSize(this.root),
      anchor: { left: caret.left, right: caret.right },
      preferred: "left",
    });
    const below = win.innerHeight - caret.bottom - 12;
    const above = caret.top - 12;
    const direction = below >= 80 || below >= above ? "below" : "above";
    const available = Math.max(0, Math.min(272, direction === "below" ? below : above));
    if (available < 26) return null;
    const height = Math.min(this.root.getBoundingClientRect().height, available);
    const top = direction === "below" ? caret.bottom + 4 : caret.top - height - 4;
    const offsetParent = this.root.offsetParent as HTMLElement | null;
    const baseLeft = offsetParent?.getBoundingClientRect().left ?? 0;
    return {
      placement,
      available,
      top: Math.min(win.innerHeight - height - 8, Math.max(8, top)),
      baseLeft,
    };
  }

  private writePlace(
    measured: PlaceMeasurement | null,
    preservedScrollTop: number,
    reveal: RevealMode,
    wasFullyVisible: boolean,
  ): void {
    if (measured === null) {
      this.close();
      return;
    }
    applyOverlayPlacement(this.root, measured.placement, measured.baseLeft);
    this.root.style.maxHeight = `${measured.available}px`;
    this.root.style.top = `${measured.top}px`;
    // 定高之后再恢复滚动位置（先设 scrollTop 会被不可滚的列表钳成 0），最后按真实可见带揭示活动行。
    this.list.scrollTop = preservedScrollTop;
    // 游标没变且重排前就不完整可见 ⇒ 用户自己滚开了，不得借重排把阅读位置拉回活动行。
    if (reveal === "if-clipped" && !wasFullyVisible) return;
    const state = this.state;
    if (state === null || state.active < 0) return;
    const active = this.list.children[state.active] as HTMLElement | undefined;
    if (active === undefined) return;
    const viewportHeight = this.view.dom.ownerDocument.defaultView?.innerHeight ?? 0;
    revealElementWithin(this.list, active, { top: 0, bottom: viewportHeight });
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    keyboardEvents.set(this.view, event);
  };

  private onCompositionStart = (): void => this.compositionStart();
  private onCompositionEnd = (): void => this.compositionEnd();
  private onBlur = (): void => this.close();
  private onFocus = (): void => this.refresh();

  private onOutsideMouseDown = (event: MouseEvent): void => {
    if (this.state === null || !(event.target instanceof Node)) return;
    if (!this.root.contains(event.target)) this.close();
  };

  private onGeometryChange = (): void => {
    // 排队的重排自己会在 write 拍重新读几何并放盒；它清样式的瞬时塌缩触发的 scroll 事件
    // 不是用户滚动，跳过以免把钳成 0 的瞬时值当成新位置。
    if (this.placementPending) return;
    if (this.state !== null && !this.composing && !this.settling) this.place();
  };
}

const controllers = new WeakMap<EditorView, LinkSuggestView>();
const keyboardEvents = new WeakMap<EditorView, KeyboardEvent>();
let viewSerial = 0;

export function linkSuggestKeyboardEvent(view: EditorView): KeyboardEvent | undefined {
  return keyboardEvents.get(view);
}

export function linkSuggestExtension(files: () => readonly string[], enabled: () => boolean): Extension {
  return ViewPlugin.fromClass(class {
    private readonly controller: LinkSuggestView;
    constructor(view: EditorView) {
      this.controller = controllers.get(view) ?? new LinkSuggestView(view, files, enabled, `lumir-link-suggest-${++viewSerial}`);
      controllers.set(view, this.controller);
      this.controller.refresh();
    }
    update(update: ViewUpdate) {
      this.controller.update(update);
    }
    destroy() {
      queueMicrotask(() => {
        if (!this.controller.view.dom.isConnected) {
          this.controller.destroy();
          controllers.delete(this.controller.view);
        }
      });
    }
  });
}

export function acceptLinkSuggestion(view: EditorView, event?: KeyboardEvent): boolean {
  return controllers.get(view)?.accept(event) ?? false;
}

export function moveLinkSuggestion(view: EditorView, direction: 1 | -1, event?: KeyboardEvent): boolean {
  return controllers.get(view)?.move(direction, event) ?? false;
}

export function closeLinkSuggestion(view: EditorView): void {
  controllers.get(view)?.close();
}

export function linkSuggestionIsOpen(view: EditorView): boolean {
  return controllers.get(view)?.isOpen() ?? false;
}

export function linkSuggestionIsSettling(view: EditorView): boolean {
  return controllers.get(view)?.isSettling() ?? false;
}
