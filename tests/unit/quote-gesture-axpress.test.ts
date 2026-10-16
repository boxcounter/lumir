// tests/unit/quote-gesture-axpress.test.ts — 浮动摘录钮「辅助功能 press 可按下」契约（M550）。
//
// 背景（真机探针钉死的机制，finding 20261017-worker-diag122-bug-m541-transcript-axpress）：
// WebKit 对钮做 AXPress 时**先**把 DOM 选区坍缩掉（press 的 mousedown 到达时 collapsed 已是
// true，事件本身 trusted、target 就是钮），press 序列随后才走 mousedown/mouseup/click。M541 的
// document 级时机门把这个「选区坍缩」读成「拖拽结束、选区无效」⇒ hideButton() 把钮从 DOM
// 摘掉（旧实现）⇒ press 的 click 永远落不到处理器 ⇒ 钮经辅助功能不可按下（真实指针正常）。
//
// 本文件驱动两个 DOM 手势工厂（transcript 消息侧 + 编辑器侧），用最小 DOM 替身复现这条
// 合成序列，钉三条判据：
//   ① AXPress 形态（选区先坍缩、trusted 事件落在钮上）下 click 处理器仍产出卡片；
//   ② 藏钮不摘节点（press 中途钮留在 DOM）；
//   ③ M541 时机门语义不变：真实拖拽（mousedown 在正文）中钮立即消失，mouseup 后选区仍有效
//      则重现。
// 反向验证（REVIEW.md 第 1 条）：把 src 两处退回 M541 后本文件必红（旧实现清 last +
// remove()），改回即绿——判据有区分度，不是空转。
//
// 不覆盖什么：AXPress 的 WebKit 内部时序（合成事件是否到达 DOM 属真机层，场景 122 末步
// `do: click` 判定）、M531 落点钳制（纯函数层另有单测）、时机门纯状态机（另有单测）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { createQuoteGesture } from "../../src/quote-gesture.ts";
import { createMessageQuoteGesture } from "../../src/message-quote-gesture.ts";
import type { MessageQuoteCard } from "../../src/quote-card.ts";
import type { QuoteCard } from "../../src/quote-card.ts";

// ---------------------------------------------------------------------------
// 最小 DOM 替身（各持一份是 tests/unit 的既有手法；只覆盖手势工厂触到的那一小撮面）
// ---------------------------------------------------------------------------

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

interface FakeEvent {
  target?: unknown;
  isTrusted?: boolean;
  preventDefault?: () => void;
}

class FakeEl {
  readonly tagName: string;
  readonly nodeType: number;
  parentElement: FakeEl | null = null;
  readonly children: FakeEl[] = [];
  private readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  private readonly classes = new Set<string>();
  private attrs = new Map<string, string>();
  private text = "";
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  hidden = false;
  /** 测试可写：量尺寸用的矩形与占位尺寸。 */
  rect: { left: number; top: number; width: number; height: number } = {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  offsetWidth = 0;
  offsetHeight = 0;
  clientWidth = 1000;
  clientHeight = 800;
  scrollLeft = 0;
  scrollTop = 0;

  constructor(tagName: string, className = "", nodeType = ELEMENT_NODE) {
    this.tagName = tagName;
    this.nodeType = nodeType;
    this.setClass(className);
  }

  private setClass(name: string): void {
    this.classes.clear();
    for (const part of name.split(/\s+/)) if (part !== "") this.classes.add(part);
  }

  get className(): string {
    return [...this.classes].join(" ");
  }

  set className(name: string) {
    this.setClass(name);
  }

  get classList(): { contains: (name: string) => boolean } {
    return { contains: (name) => this.classes.has(name) };
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.text = value;
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  append(child: FakeEl): void {
    child.parentElement?.children.splice(child.parentElement.children.indexOf(child), 1);
    child.parentElement = this;
    this.children.push(child);
  }

  remove(): void {
    if (this.parentElement !== null) {
      const siblings = this.parentElement.children;
      const index = siblings.indexOf(this);
      if (index >= 0) siblings.splice(index, 1);
      this.parentElement = null;
    }
  }

  /** DOM contains 口径：自身命中也算。 */
  contains(node: FakeEl | null): boolean {
    let el: FakeEl | null = node;
    while (el !== null) {
      if (el === this) return true;
      el = el.parentElement;
    }
    return false;
  }

  closest(selector: string): FakeEl | null {
    const want = selector.startsWith(".") ? selector.slice(1) : selector;
    let el: FakeEl | null = this;
    while (el !== null) {
      if (el.classes.has(want)) return el;
      el = el.parentElement;
    }
    return null;
  }

  querySelector(selector: string): FakeEl | null {
    const want = selector.startsWith(".") ? selector.slice(1) : selector;
    const walk = (el: FakeEl): FakeEl | null => {
      for (const child of el.children) {
        if (child.classes.has(want)) return child;
        const hit = walk(child);
        if (hit !== null) return hit;
      }
      return null;
    };
    return walk(this);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatch(type: string, event: FakeEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ preventDefault: () => {}, ...event });
    }
  }

  focus(): void {
    doc.activeElement = this;
  }
}

/** 假选区：range/toString/矩形都可由测试改写，复现「AXPress 前置坍缩」只需翻 isCollapsed。 */
interface FakeSelection {
  isCollapsed: boolean;
  anchorNode: FakeEl | null;
  anchorOffset: number;
  focusNode: FakeEl | null;
  focusOffset: number;
  rangeCount: number;
  toString: () => string;
  getRangeAt: (index: number) => {
    cloneRange: () => { collapse: () => void; getBoundingClientRect: () => object };
    getBoundingClientRect: () => { left: number; right: number; top: number; bottom: number; width: number; height: number };
  };
}

function fakeRange() {
  // 折叠矩形退化（宽 0 高 0）⇒ caretRectOf 退回整段矩形——正是真机的 caret 量法。
  return {
    cloneRange: () => ({
      collapse: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    }),
    getBoundingClientRect: () => ({
      left: 100,
      right: 100,
      top: 50,
      bottom: 62,
      width: 0,
      height: 12,
    }),
  };
}

const docListeners = new Map<string, Array<(event: FakeEvent) => void>>();
const winListeners = new Map<string, Array<(event: FakeEvent) => void>>();

const doc = {
  activeElement: null as FakeEl | null,
  body: new FakeEl("body"),
  createElement: (tag: string) => new FakeEl(tag),
  addEventListener: (type: string, listener: (event: FakeEvent) => void) => {
    const list = docListeners.get(type) ?? [];
    list.push(listener);
    docListeners.set(type, list);
  },
  removeEventListener: (type: string, listener: (event: FakeEvent) => void) => {
    const list = docListeners.get(type);
    if (list !== undefined) {
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    }
  },
  getSelection: (): FakeSelection | null => selection,
};

const win = {
  addEventListener: (type: string, listener: (event: FakeEvent) => void) => {
    const list = winListeners.get(type) ?? [];
    list.push(listener);
    winListeners.set(type, list);
  },
  removeEventListener: (type: string, listener: (event: FakeEvent) => void) => {
    const list = winListeners.get(type);
    if (list !== undefined) {
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    }
  },
};

function docDispatch(type: string, event: FakeEvent = {}): void {
  for (const listener of docListeners.get(type) ?? []) {
    listener({ preventDefault: () => {}, ...event });
  }
}

let selection: FakeSelection | null = null;

function setSelection(partial: Partial<FakeSelection> & { text?: string }): void {
  selection = {
    isCollapsed: false,
    anchorNode: null,
    anchorOffset: 0,
    focusNode: null,
    focusOffset: 0,
    rangeCount: 1,
    toString: () => partial.text ?? "摘录原文第一片",
    getRangeAt: () => fakeRange(),
    ...partial,
  };
}

const globals = globalThis as Record<string, unknown>;
globals.document = doc;
globals.window = win;
globals.Node = { ELEMENT_NODE, TEXT_NODE };

// ---------------------------------------------------------------------------
// transcript 消息侧（createMessageQuoteGesture）
// ---------------------------------------------------------------------------

/** transcript fixture：一条用户消息（who + body + 正文 span）， containment / meta 全通。 */
function transcriptFixture() {
  const transcript = new FakeEl("div", "lumir-hp-transcript");
  const msg = new FakeEl("div", "lumir-hp-msg");
  const who = new FakeEl("div", "lumir-hp-who");
  who.dataset.role = "user";
  const body = new FakeEl("div", "lumir-hp-body");
  const text = new FakeEl("span", "", TEXT_NODE);
  text.textContent = "摘录原文第一片";
  body.append(text);
  msg.append(who);
  msg.append(body);
  transcript.append(msg);
  return { transcript, msg, who, body, text };
}

/** 驱动真实用户路径：有效选区 + mousedown（正文目标）→ selectionchange（拖拽中）→ mouseup
 *  ⇒ 钮浮现。selectionchange 不可省：状态机的 selectionValid 由它置真（时序同真实拖拽）。 */
function dragReveal(fx: ReturnType<typeof transcriptFixture>): FakeEl {
  setSelection({ anchorNode: fx.text, focusNode: fx.text, text: "摘录原文第一片" });
  docDispatch("mousedown", { target: fx.body, isTrusted: true });
  docDispatch("selectionchange");
  docDispatch("mouseup", { target: fx.body, isTrusted: true });
  const button = fx.transcript.children.find((child) => child.tagName.toUpperCase() === "BUTTON");
  assert.notEqual(button, undefined, "拖选抬起后钮应已挂载");
  return button!;
}

test("消息钮：AXPress 形态（选区先坍缩、事件落在钮上）下 click 仍产出卡片", () => {
  const fx = transcriptFixture();
  const inserted: MessageQuoteCard[] = [];
  const gesture = createMessageQuoteGesture({
    transcript: fx.transcript as unknown as HTMLElement,
    insert: (card) => inserted.push(card),
  });

  const button = dragReveal(fx);
  assert.equal(button.hidden, false);

  // AXPress 前置副作用：选区坍缩，时机门随之走「选区无效 ⇒ 藏钮」收口。
  setSelection({ isCollapsed: true, anchorNode: null, focusNode: null, rangeCount: 0 });
  docDispatch("selectionchange");
  assert.equal(button.hidden, true, "选区坍缩后钮应藏");
  assert.notEqual(button.parentElement, null, "M550：藏钮不摘节点（旧实现此处 remove）");

  // press 序列：mousedown/mouseup 目标是钮自己（trusted），最后 click 落地。
  docDispatch("mousedown", { target: button, isTrusted: true });
  docDispatch("mouseup", { target: button, isTrusted: true });
  button.dispatch("click", { target: button, isTrusted: true });

  assert.equal(inserted.length, 1, "AXPress 的 click 必须产出卡片（旧实现清 last 后此处为空）");
  assert.equal(inserted[0]!.role, "user");
  assert.equal(inserted[0]!.text, "摘录原文第一片");
  gesture.dispose();
  assert.equal(button.parentElement, null, "dispose 负责最终摘除");
});

test("消息钮：真实拖拽中立即消失、抬起后选区仍有效则重现（M541 时机门语义不变）", () => {
  const fx = transcriptFixture();
  const gesture = createMessageQuoteGesture({
    transcript: fx.transcript as unknown as HTMLElement,
    insert: () => {},
  });
  const button = dragReveal(fx);
  assert.equal(button.hidden, false);

  // 重新在正文按下（开始新拖拽）：钮立即消失，不等到抬起。
  docDispatch("mousedown", { target: fx.body, isTrusted: true });
  assert.equal(button.hidden, true, "拖拽进行中钮 MUST NOT 出现");
  // 抬起时选区仍有效 ⇒ 立刻重现。
  docDispatch("mouseup", { target: fx.body, isTrusted: true });
  assert.equal(button.hidden, false);
  gesture.dispose();
});

// ---------------------------------------------------------------------------
// 编辑器侧（createQuoteGesture）—— 同构同病（tower 补充），同一契约
// ---------------------------------------------------------------------------

function editorDeps() {
  const cmDoc = EditorState.create({ doc: "# 标题\nalpha beta gamma" }).doc;
  const contentDOM = new FakeEl("div", "cm-content");
  const textNode = new FakeEl("span", "", TEXT_NODE);
  textNode.textContent = "alpha beta gamma";
  contentDOM.append(textNode);
  const mount = new FakeEl("div", "editor-pane");
  const view = {
    contentDOM,
    state: { selection: { main: { anchor: 0, head: 0 } }, doc: cmDoc },
    posAtDOM: (_node: unknown, offset: number) => offset,
    focus: () => {
      doc.activeElement = mount;
    },
    dispatch(tr: { selection?: { anchor: number; head: number } }) {
      if (tr.selection !== undefined) this.state.selection.main = { ...tr.selection };
    },
  };
  const inserted: QuoteCard[] = [];
  const session = { loaded: true };
  const gesture = createQuoteGesture({
    activeView: () => view as never,
    activeMount: () => mount as unknown as HTMLElement,
    activePath: () => "/note.md",
    sessionForPath: (path: string) => (path === "/note.md" ? (session as never) : undefined),
    viewOfSession: () => view as never,
    activateSession: () => {},
    openFile: async () => false,
    extractHeadings: () => [],
    insertQuoteCard: (card: QuoteCard) => inserted.push(card),
    toast: () => {},
  });
  return { gesture, mount, view, inserted, textNode };
}

test("编辑器钮：AXPress 形态下 click 仍产出卡片，且 press 全程钮留 DOM", () => {
  const { gesture, mount, view, inserted, textNode } = editorDeps();
  const from = "# 标题\n".length;
  const to = from + "alpha beta".length;

  setSelection({ anchorNode: textNode, anchorOffset: from, focusNode: textNode, focusOffset: to });
  docDispatch("mousedown", { target: textNode, isTrusted: true });
  docDispatch("selectionchange");
  docDispatch("mouseup", { target: textNode, isTrusted: true });
  const button = mount.children.find((child) => child.tagName.toUpperCase() === "BUTTON");
  assert.notEqual(button, undefined, "拖选抬起后钮应已挂载");
  assert.equal(button!.hidden, false);

  // AXPress 前置坍缩选区。
  setSelection({ isCollapsed: true, anchorNode: null, focusNode: null, rangeCount: 0 });
  docDispatch("selectionchange");
  assert.notEqual(button!.parentElement, null, "M550：藏钮不摘节点（旧实现此处 remove）");

  docDispatch("mousedown", { target: button, isTrusted: true });
  docDispatch("mouseup", { target: button, isTrusted: true });
  button!.dispatch("click", { target: button, isTrusted: true });

  assert.equal(inserted.length, 1, "AXPress 的 click 必须产出卡片");
  assert.equal(inserted[0]!.file, "/note.md");
  assert.equal(inserted[0]!.text, "alpha beta");
  assert.deepEqual(view.state.selection.main, { anchor: from, head: to }, "点击时恢复最后选区");
  gesture.dispose();
  assert.equal(button!.parentElement, null);
});
