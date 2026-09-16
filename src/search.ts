// 文件内搜索（M139）——编辑器侧的搜索能力与搜索 panel。
//
// 能力底座取 @codemirror/search 的官方扩展：搜索状态（`search()` 装的 searchState）、
// 全匹配高亮（官方 searchHighlighter，`cm-searchMatch` / `cm-searchMatch-selected`）、
// 上一个 / 下一个（`findNext` / `findPrevious`）、大小写与整词口径（`SearchQuery`）全部由
// 官方实现承担，本模块只做三件事：
//   1. 经官方扩展点 `SearchConfig.createPanel` 重制 panel UI（editorial 语言，样式在
//      src/search-panel.css）：官方 panel 没有**匹配计数**——官方的 DOM 是一排「输入框 +
//      按钮 + 复选框」平铺，既拿不到计数也没法按排版基线排版。能力留官方，界面归我们。
//   2. 把 ⌘F 交给 keys.ts 的统一键位层（`app.search-open`，global 作用域），
//      命令实现在装配层 main.ts。
//   3. 关闭时把焦点交还编辑器（`closeSearch`）。
//
// 本版能力集（Alex 裁决）：查找 / 全匹配高亮 / 上一个 / 下一个 / 大小写切换 / 匹配计数。
// **替换**不在其中，故 panel 不放替换字段；官方 replace* 实现仍在包里，只是没有入口。
//
// 键位口径：⌘F 走统一键位层（keys.ts 的 KEY_BINDINGS，M139 条目）。panel 自己的关闭键
// （Escape / ⌃G）与输入框内的 Enter / ⇧Enter 由本模块的 DOM 监听就地消费，**不进键位表**——
// 理由与 M133 键位面板同一套：统一表里一个 token 只能有一条绑定，而 Escape 已被
// editor.widget-escape（带 when 条件）占用。两条路径不会互相遮蔽：panel 打开时焦点在 panel 里，
// 而 editor 作用域的判定是「事件目标在 contentDOM 内」，那条绑定因此不命中；本模块的监听挂在
// panel 根上，靠 DOM 事件顺序先于 window 上的分发器消费（分发器对 defaultPrevented 让路）。
//
// 已知边界（如实记录，不在本 mission 修）：
// - 高亮只看视口：官方 searchHighlighter 按 `view.visibleRanges` 出装饰，视口外的匹配不画
//   （计数仍是全文档的）。
// - live preview 下匹配落在被 widget 替换掉的源码上时不会有可见高亮（替换装饰盖住了 mark），
//   `findNext` 仍会把选区移过去；具体行为见 completion report。

import type { EditorState, Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Panel, ViewUpdate } from "@codemirror/view";
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchPanelOpen,
  setSearchQuery,
} from "@codemirror/search";
import { keyToken } from "./keys";

/** 计数上限：与官方 selectMatches / 高亮器同一量级（1000）。超过就只报下界（显示 1000+），
 *  不为一篇超大文档的精确计数拖住每次按键。 */
const MATCH_COUNT_LIMIT = 1000;

/** panel 自己的关闭键（token 口径与 keys.ts 同源，不另写一套匹配规则）。 */
const PANEL_CLOSE_TOKENS = new Set(["Escape", "Ctrl-G"]);

interface MatchTally {
  /** 当前选区落在第几个匹配上（0 起）；选区不在任何匹配上时 -1。 */
  index: number;
  total: number;
  /** 达到 MATCH_COUNT_LIMIT：total 是下界。 */
  capped: boolean;
}

const EMPTY_TALLY: MatchTally = { index: -1, total: 0, capped: false };

/** 全文档匹配计数 + 当前匹配序号。查询非法（空 / 正则写错）时返回空计数。 */
function tallyMatches(state: EditorState, query: SearchQuery): MatchTally {
  if (!query.valid) return EMPTY_TALLY;
  const selection = state.selection.main;
  const cursor = query.getCursor(state.doc);
  let index = -1;
  let total = 0;
  for (let step = cursor.next(); !step.done; step = cursor.next()) {
    if (index < 0 && step.value.from === selection.from && step.value.to === selection.to) index = total;
    total += 1;
    if (total >= MATCH_COUNT_LIMIT) return { index, total, capped: true };
  }
  return { index, total, capped: false };
}

/** 面板里的计数文案：`当前/总数`；未选中任何匹配时「0/总数」；超过上限报下界。 */
function tallyLabel(tally: MatchTally): string {
  if (tally.capped) return `${tally.total}+`;
  return `${tally.index < 0 ? 0 : tally.index + 1}/${tally.total}`;
}

/**
 * 搜索 panel（editorial 语言）：一行 bar，左侧「查找」+ 输入框，右侧计数 + 上一个/下一个 +
 * 大小写开关 + 关闭。官方 `openSearchPanel` / `closeSearchPanel` 靠 `[main-field]` 属性找主
 * 输入框（打开态再按 ⌘F 会把焦点与选区移回它），故该属性是面板与官方流程的接口，不可省。
 */
class LumirSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  private readonly view: EditorView;
  private readonly input: HTMLInputElement;
  private readonly count: HTMLElement;
  private readonly stepPrev: HTMLButtonElement;
  private readonly stepNext: HTMLButtonElement;
  private readonly caseToggle: HTMLButtonElement;
  /** 上一次同步过的 state：panel 的 update 在每次视图更新都会来，用 state 同一性挡掉
   *  与查询/文档/选区无关的更新（纯视口变化），省掉一次全文档扫描。 */
  private lastState: EditorState | null = null;

  constructor(view: EditorView) {
    this.view = view;
    this.dom = document.createElement("div");
    this.dom.className = "lumir-search";

    const label = document.createElement("span");
    label.className = "lumir-search-label";
    label.textContent = "查找";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "lumir-search-input";
    input.setAttribute("main-field", "true");
    input.setAttribute("aria-label", "查找");
    input.spellcheck = false;
    input.autocomplete = "off";
    this.input = input;

    const count = document.createElement("span");
    count.className = "lumir-search-count";
    // 计数是随查询变化的活信息，读屏应播报（视觉上是 bar 右侧的数字）。
    count.setAttribute("aria-live", "polite");
    this.count = count;

    this.stepPrev = this.makeButton("上一个", "lumir-search-button", () => findPrevious(this.view));
    this.stepNext = this.makeButton("下一个", "lumir-search-button", () => findNext(this.view));
    this.caseToggle = this.makeButton("Aa", "lumir-search-button lumir-search-case", () => this.toggleCase());
    this.caseToggle.setAttribute("aria-label", "区分大小写");
    const close = this.makeButton("×", "lumir-search-button lumir-search-close", () => closeSearch(this.view));
    close.setAttribute("aria-label", "关闭");

    this.dom.append(label, input, count, this.stepPrev, this.stepNext, this.caseToggle, close);

    input.addEventListener("input", () => this.commit());
    // 关闭键与 Enter 就地消费，不进键位表（理由见文件头）。preventDefault 让 window 上的
    // 分发器让路；不 stopPropagation——那会变成第二条键位路径的雏形。
    this.dom.addEventListener("keydown", (event) => this.onKeydown(event));

    this.sync(view.state);
  }

  /** 面板内的按钮：统一「按下不动焦点」——鼠标点击不该把焦点从输入框带走（键盘流不断），
   *  键盘 Tab 到按钮时仍走原生激活路径（mousedown 不拦）。 */
  private makeButton(text: string, className: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", run);
    return button;
  }

  mount(): void {
    this.input.focus();
    this.input.select();
  }

  update(update: ViewUpdate): void {
    if (update.state === this.lastState) return;
    this.sync(update.state);
  }

  /** 把 DOM 与 state 对齐（state 是唯一事实源：外部 setSearchQuery 也能改口径）。 */
  private sync(state: EditorState): void {
    this.lastState = state;
    const query = getSearchQuery(state);
    // 只在真的不同才赋值：写入 value 会把光标推到末尾（输入中会跳）。
    if (this.input.value !== query.search) this.input.value = query.search;
    const tally = tallyMatches(state, query);
    const label = tallyLabel(tally);
    if (this.count.textContent !== label) this.count.textContent = label;
    this.count.classList.toggle("is-empty", query.valid && tally.total === 0);
    const empty = tally.total === 0;
    this.stepPrev.disabled = empty;
    this.stepNext.disabled = empty;
    this.caseToggle.classList.toggle("is-on", query.caseSensitive);
    this.caseToggle.setAttribute("aria-pressed", String(query.caseSensitive));
  }

  /** 输入框内容 → 搜索查询（与官方 panel 同一时机：input 事件即提交，不等回车）。 */
  private commit(): void {
    const current = getSearchQuery(this.view.state);
    const next = new SearchQuery({
      search: this.input.value,
      caseSensitive: current.caseSensitive,
      literal: current.literal,
      regexp: current.regexp,
      replace: current.replace,
      wholeWord: current.wholeWord,
      test: current.test,
    });
    if (next.eq(current)) return;
    this.view.dispatch({ effects: setSearchQuery.of(next) });
  }

  private toggleCase(): void {
    const current = getSearchQuery(this.view.state);
    this.view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: current.search,
        caseSensitive: !current.caseSensitive,
        literal: current.literal,
        regexp: current.regexp,
        replace: current.replace,
        wholeWord: current.wholeWord,
        test: current.test,
      })),
    });
  }

  private onKeydown(event: KeyboardEvent): void {
    const token = keyToken(event);
    if (token === null) return;
    if (PANEL_CLOSE_TOKENS.has(token)) {
      event.preventDefault();
      closeSearch(this.view);
      return;
    }
    // Enter / ⇧Enter 只在主输入框里当「下一个 / 上一个」（按钮聚焦时让原生激活生效）。
    if (event.target !== this.input) return;
    if (token === "Enter") {
      event.preventDefault();
      findNext(this.view);
    } else if (token === "Shift-Enter") {
      event.preventDefault();
      findPrevious(this.view);
    }
  }
}

/** 编辑器扩展：装官方搜索能力 + 我们的 panel（top 位置，样式见 src/search-panel.css）。 */
export function lumirSearch(): Extension {
  return search({ top: true, createPanel: (view) => new LumirSearchPanel(view) });
}

/** ⌘F 入口（keys.ts 的 app.search-open）：打开 panel，已打开则把焦点与选区移回输入框。 */
export function openSearch(view: EditorView): void {
  openSearchPanel(view);
}

/** 关闭 panel 并把焦点交还编辑器（Esc / ⌃G / × 的落点）。 */
function closeSearch(view: EditorView): void {
  if (!searchPanelOpen(view.state)) return;
  // 先交焦点再关：官方 closeSearchPanel 只在「焦点在 panel 内」时才还原焦点，这里显式
  // 还原，把「Esc 之后手不离键盘继续编辑」变成不依赖时序的保证。
  view.focus();
  closeSearchPanel(view);
}
