// IME 组合期 Enter 拦截门的状态机单测（M361 任务 4，合同 = 任务 3）：WKWebView 下「确认
// 候选」那拍 Enter 的 keydown.isComposing 不可靠（WebKit 先派 compositionend 再派确认
// keydown），改用 compositionstart/end 自跟踪 + compositionend 后紧邻窗口的确认拍防线。
// 必须成立的行为：组合期 Enter 不发送；两种事件序的确认拍都被吞；窗口外 Enter 照常放行
// （正常发送与 ⇧Enter 换行不被破坏）；确认拍消费后不残留窗口误吞下一次 Enter。
//
// HC5 追加（M527，合同 docs/specs/harness-composer.md）：IME 组合期结构冻结的 DOM 替身
// 用例——组合窗内 normalize 不得折段/改写选区、withModel 不得整面重渲、compositionend
// 后补账归一。复现现场（Alex 2026-10-16）：第一行有文字 → ⇧Enter 新起第二行 → 第二行
// 中文组合 → 选中候选后组合文本跳回第一行、第二行消失（根因 = 组合期 childList 变化触发
// composerObserver → normalize 把含元素子节点的组合块折进前段）。
//
// 这一层是零 DOM 环境（tests/unit/README.md）：假时钟外注 now，逐事件序驱动纯函数状态机。
// HC5 小节自带平台边界 DOM 替身（手法同 tests/unit/harness-thinking-reset.test.ts），
// 驱动的是仓里那份真 createHarnessPanel。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  IME_CONFIRM_WINDOW_MS,
  imeGateCompositionEnd,
  imeGateCompositionStart,
  imeGateKeydown,
  imeKeyGate,
} from "../../src/harness-panel.ts";

const T0 = 1_000_000;

function seq(gate: ReturnType<typeof imeKeyGate>, ...events: Array<[string, number]>) {
  let g = gate;
  const out: boolean[] = [];
  for (const [key, now] of events) {
    const d = imeGateKeydown(g, key, now);
    g = d.gate;
    out.push(d.swallow);
  }
  return { gate: g, swallows: out };
}

// ── 无组合：Enter 一律放行（正常发送 / ⇧Enter 换行路径开门） ─────────────────

test("空闲态：Enter 放行（发送路径）", () => {
  const { gate, swallows } = seq(imeKeyGate(), ["Enter", T0]);
  assert.deepEqual(swallows, [false]);
  assert.deepEqual(gate, { composing: false, confirmUntil: 0, endDisarmed: false });
});

// ── Chromium 序：确认 Enter 在组合期内到达 ───────────────────────────────────

test("组合期内 Enter 吞（候选确认），随后 compositionend 不开窗——连拍第二发 Enter 放行", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  const d1 = imeGateKeydown(g, "Enter", T0); // 确认拍：isComposing 浏览器自报路径之外的自跟踪命中
  assert.equal(d1.swallow, true);
  assert.equal(d1.gate.endDisarmed, true);
  g = imeGateCompositionEnd(d1.gate, T0 + 10); // 不开窗（endDisarmed）
  assert.equal(g.confirmUntil, 0);
  const d2 = imeGateKeydown(g, "Enter", T0 + 20); // 用户想发送的 Enter：放行
  assert.equal(d2.swallow, false);
});

test("组合期内非 Enter 键不吞、组合期状态保留（编辑键走 IME 原生路径）", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  const d = imeGateKeydown(g, "a", T0);
  assert.equal(d.swallow, false);
  assert.equal(d.gate.composing, true);
});

// ── WebKit 序：compositionend 先到达，确认 Enter 以普通 keydown 随后 ─────────

test("compositionend 后窗口内 Enter 吞（确认拍），消费后关窗——下一拍 Enter 放行", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0); // WebKit：end 先于确认 keydown → 开窗
  assert.equal(g.confirmUntil, T0 + IME_CONFIRM_WINDOW_MS);
  const d1 = imeGateKeydown(g, "Enter", T0 + 10);
  assert.equal(d1.swallow, true);
  assert.equal(d1.gate.confirmUntil, 0); // 已消费
  const d2 = imeGateKeydown(d1.gate, "Enter", T0 + 20);
  assert.equal(d2.swallow, false); // 真发送
});

test("compositionend 后先敲普通字符再 Enter：窗口被真实输入关掉，Enter 放行", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0);
  const d1 = imeGateKeydown(g, "a", T0 + 10);
  assert.equal(d1.swallow, false);
  assert.equal(d1.gate.confirmUntil, 0);
  const d2 = imeGateKeydown(d1.gate, "Enter", T0 + 20);
  assert.equal(d2.swallow, false);
});

test("compositionend 后窗口超时再 Enter：放行（不是确认拍）", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0);
  const d = imeGateKeydown(g, "Enter", T0 + IME_CONFIRM_WINDOW_MS + 1);
  assert.equal(d.swallow, false);
});

test("确认窗未消费时新的 compositionstart 直接关窗", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0); // 开了窗（鼠标点选候选，无确认 Enter 跟随）
  g = imeGateCompositionStart(g); // 用户马上开始新一段组音
  assert.equal(g.composing, true);
  assert.equal(g.confirmUntil, 0);
  const d = imeGateKeydown(g, "Enter", T0 + 30);
  assert.equal(d.swallow, true); // 组合期内：仍是确认拍
});

// ── 组合区正常闭环：start → 若干键 → end → 窗口外 Enter 发送 ─────────────────

test("完整组音闭环后的 Enter 照常放行（不破坏正常发送）", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateKeydown(g, "n", T0).gate;
  g = imeGateKeydown(g, "i", T0 + 5).gate;
  g = imeGateCompositionEnd(g, T0 + 10);
  g = imeGateKeydown(g, "Enter", T0 + 500).gate; // 窗口外
  const d = imeGateKeydown(g, "Enter", T0 + 510);
  assert.equal(d.swallow, false);
  assert.deepEqual(d.gate, { composing: false, confirmUntil: 0, endDisarmed: false });
});

// ────────────────────────────────────────────────────────────────────────────
// HC5（M527）：IME 组合期结构冻结——DOM 替身驱动真面板
//
// 为什么这层能测：缺陷的判据是「组合窗内 normalize / withModel 不改写 composer DOM」，是
// 接线层行为（纯函数层驱动不到 composerObserver / withModel 的闸门）。故本小节自带平台
// 边界 DOM 替身（手法同 tests/unit/harness-thinking-reset.test.ts：只替 DOM，跑的是仓里
// 那份真 createHarnessPanel），按 Alex 现场的事件序列逐步驱动：
//   键入第一行 → ⇧Enter 拆段 → compositionstart → 模拟 WebKit 组合期 DOM
//   （组合文本节点 + 空块维持的 <br>——qpara 出现元素子节点，normalize 的缺陷触发器）
//   → 手动触发 MutationObserver → 断言两块结构 / 组合文本落段 / 选区不改写；
//   组合期粘贴断言 withModel 不整面重渲；compositionend 后越过确认窗断言补账归一。
// 反向验证（REVIEW.md「断言等价于子串 / 覆盖声明超出真实验证」条）：把 normalize / withModel 的组合窗闸门临时改回直通，
// 本小节 MUST 全红（组合文本折进第一行、第二块消失）——无区分度的断言不算覆盖。
// ────────────────────────────────────────────────────────────────────────────

import { installBackend } from "./harness.ts";
import { createHarnessPanel } from "../../src/harness-panel.ts";
import type { HarnessPanelEditor } from "../../src/harness-panel.ts";
import type { AppShell } from "../../src/shell.ts";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

interface FakeEvent {
  type?: string;
  target?: unknown;
  key?: string;
  data?: string;
  inputType?: string;
  isComposing?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  clipboardData?: { items: unknown[]; getData: (type: string) => string };
  preventDefault?(): void;
  stopPropagation?(): void;
}

/** DOM 替身（只覆盖 composer 事件序列用到的面；语义与 harness-thinking-reset.test.ts 同一份
 *  手法）。textContent setter 把文本落成**子文本节点**——paraTextOf 走 childNodes 读文本，
 *  真 DOM 也是这个形态。 */
class FakeEl {
  readonly tagName: string;
  readonly nodeType: number;
  parent: FakeEl | null = null;
  nodes: FakeEl[] = [];
  text = "";

  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();

  hidden = false;
  title = "";
  id = "";
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 0;

  static readonly TEXT_NODE = TEXT_NODE;
  static readonly ELEMENT_NODE = ELEMENT_NODE;

  constructor(tagName: string, nodeType = ELEMENT_NODE) {
    this.tagName = tagName;
    this.nodeType = nodeType;
  }

  get nodeName(): string {
    return this.tagName.toUpperCase();
  }

  get classList() {
    const classes = this.classes;
    return {
      add: (name: string): void => void classes.add(name),
      remove: (name: string): void => void classes.delete(name),
      contains: (name: string): boolean => classes.has(name),
      toggle: (name: string, force?: boolean): boolean => {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    };
  }

  get className(): string {
    return [...this.classes].join(" ");
  }

  set className(value: string) {
    this.classes.clear();
    for (const name of value.split(/\s+/).filter(Boolean)) this.classes.add(name);
  }

  get textContent(): string {
    return this.text + this.nodes.map((node) => node.textContent).join("");
  }

  set textContent(value: string) {
    for (const node of this.nodes) node.parent = null;
    this.nodes = [];
    this.text = "";
    if (this.nodeType === TEXT_NODE) {
      this.text = value;
    } else if (value !== "") {
      this.append(textNode(value));
    }
  }

  get childNodes(): FakeEl[] {
    return this.nodes;
  }

  get children(): FakeEl[] {
    return this.nodes.filter((node) => node.nodeType === ELEMENT_NODE);
  }

  get childElementCount(): number {
    return this.children.length;
  }

  get previousElementSibling(): FakeEl | null {
    if (this.parent === null) return null;
    const sibs = this.parent.nodes;
    const at = sibs.indexOf(this);
    for (let i = at - 1; i >= 0; i -= 1) {
      if (sibs[i].nodeType === ELEMENT_NODE) return sibs[i];
    }
    return null;
  }

  get nextSibling(): FakeEl | null {
    if (this.parent === null) return null;
    const at = this.parent.nodes.indexOf(this);
    return this.parent.nodes[at + 1] ?? null;
  }

  get parentElement(): FakeEl | null {
    return this.parent;
  }

  get lastElementChild(): FakeEl | null {
    const els = this.children;
    return els[els.length - 1] ?? null;
  }

  append(...incoming: Array<FakeEl | string>): void {
    for (const raw of incoming) {
      const node = typeof raw === "string" ? textNode(raw) : raw;
      node.parent = this;
      this.nodes.push(node);
    }
  }

  insertBefore(node: FakeEl, ref: FakeEl | null): void {
    const at = ref === null ? this.nodes.length : this.nodes.indexOf(ref);
    node.parent = this;
    this.nodes.splice(at < 0 ? this.nodes.length : at, 0, node);
  }

  replaceChildren(...incoming: Array<FakeEl | string>): void {
    for (const node of this.nodes) node.parent = null;
    this.nodes = [];
    this.text = "";
    this.append(...incoming);
  }

  remove(): void {
    if (this.parent === null) return;
    const at = this.parent.nodes.indexOf(this);
    if (at >= 0) this.parent.nodes.splice(at, 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  toggleAttribute(name: string, force?: boolean): boolean {
    const on = force ?? !this.attrs.has(name);
    if (on) this.attrs.set(name, "");
    else this.attrs.delete(name);
    return on;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type);
    if (list === undefined) return;
    this.listeners.set(
      type,
      list.filter((entry) => entry !== listener),
    );
  }

  fire(type: string, event: FakeEvent = {}): void {
    const full: FakeEvent = {
      type,
      target: this,
      preventDefault: () => {},
      stopPropagation: () => {},
      ...event,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(full);
  }

  focus(): void {}
  blur(): void {}

  closest(selector: string): FakeEl | null {
    let node: FakeEl | null = this;
    while (node !== null) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.nodes.some((child) => child.contains(node));
  }

  matches(selector: string): boolean {
    if (this.nodeType !== ELEMENT_NODE) return false;
    const attr = selector.match(/\[([^=\]]+)(?:=["']?([^\]"']*)["']?)?\]/);
    const base = selector.replace(/\[[^\]]*\]/g, "");
    if (base.startsWith(".")) {
      if (!this.classes.has(base.slice(1))) return false;
    } else if (base !== "" && this.tagName.toLowerCase() !== base.toLowerCase()) {
      return false;
    }
    if (attr !== null) {
      const actual = this.attrs.get(attr[1]);
      if (attr[2] === undefined || attr[2] === "") {
        if (actual === undefined) return false;
      } else if (actual !== attr[2]) {
        return false;
      }
    }
    return true;
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (node: FakeEl): void => {
      for (const child of node.nodes) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  getBoundingClientRect(): {
    x: number; y: number; top: number; right: number; bottom: number; left: number;
    width: number; height: number;
  } {
    return { x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
  }

  scrollIntoView(): void {}
}

function textNode(text: string): FakeEl {
  const node = new FakeEl("#text", TEXT_NODE);
  node.textContent = text;
  return node;
}

interface FakeRange {
  startNode: FakeEl | null;
  startOffset: number;
  setStart(node: FakeEl, offset: number): void;
  setEnd(node: FakeEl, offset: number): void;
  setStartBefore(node: FakeEl): void;
  insertNode(node: FakeEl): void;
  collapse(): void;
  getClientRects(): unknown[];
  getBoundingClientRect(): ReturnType<FakeEl["getBoundingClientRect"]>;
}

/** 观察器替身：真浏览器在微任务里投递变更记录，这里由用例手动 trigger（= 浏览器「已交付
 *  待处理记录」的那一拍）。 */
let observerCallback: (() => void) | null = null;

function triggerObserver(): void {
  assert.notEqual(observerCallback, null, "面板必须注册 composerObserver");
  observerCallback?.();
}

const selectionState = {
  rangeCount: 0,
  anchorNode: null as FakeEl | null,
  anchorOffset: 0,
  focusNode: null as FakeEl | null,
  focusOffset: 0,
  /** 程序化写选区的计数（setDomCaret / setDomSelection 走 addRange）——HC5「选区不被改写」
   *  的判据。 */
  addCount: 0,
  removeAllRanges(): void {
    this.rangeCount = 0;
    this.anchorNode = null;
    this.focusNode = null;
  },
  addRange(range: FakeRange): void {
    this.rangeCount = 1;
    this.anchorNode = range.startNode;
    this.anchorOffset = range.startOffset;
    this.focusNode = range.startNode;
    this.focusOffset = range.startOffset;
    this.addCount += 1;
  },
  setBaseAndExtent(aNode: FakeEl, aOffset: number, fNode: FakeEl, fOffset: number): void {
    this.rangeCount = 1;
    this.anchorNode = aNode;
    this.anchorOffset = aOffset;
    this.focusNode = fNode;
    this.focusOffset = fOffset;
    this.addCount += 1;
  },
  toString(): string {
    return "";
  },
};

function installFakeDom(): void {
  const host = globalThis as unknown as Record<string, unknown>;
  host.document = {
    createElement: (tag: string): FakeEl => new FakeEl(tag),
    createElementNS: (_ns: string, tag: string): FakeEl => new FakeEl(tag),
    createTextNode: (text: string): FakeEl => textNode(text),
    createDocumentFragment: (): FakeEl => new FakeEl("#fragment", 11),
    createRange: (): FakeRange => ({
      startNode: null,
      startOffset: 0,
      setStart(node: FakeEl, offset: number): void {
        this.startNode = node;
        this.startOffset = offset;
      },
      setEnd(): void {},
      setStartBefore(): void {},
      insertNode(): void {},
      collapse(): void {},
      getClientRects: () => [],
      getBoundingClientRect: () => ({
        x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0,
      }),
    }),
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    body: new FakeEl("body"),
    documentElement: new FakeEl("html"),
    activeElement: null,
  };
  host.Node = FakeEl;
  host.HTMLElement = FakeEl;
  host.getSelection = () => selectionState;
  host.requestAnimationFrame = (cb: (t: number) => void): number =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  host.MutationObserver = class {
    constructor(cb: () => void) {
      observerCallback = cb;
    }
    observe(): void {}
    disconnect(): void {
      observerCallback = null;
    }
    takeRecords(): unknown[] {
      return [];
    }
  };
  // 面板构造期注册的 transcript 视口观察器（M644）：本文件不驱动尺寸变化，观察器从不回调。
  host.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

/** 冲掉若干拍微任务，落定 invoke 的 promise 链。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 面板只需 editor 的构造面（refreshChip 的 assembleHarnessContext 读到空壳即退）。 */
function editorDouble(): HarnessPanelEditor {
  return {
    activeSession: () => ({ path: undefined }),
    view: { dom: new FakeEl("div"), state: {}, viewport: {} },
  } as unknown as HarnessPanelEditor;
}

/** 挂载面板 + 假后端，返回 composer 替身。 Draft 读写挂桩（防抖 1s 后会真的写盘一次）。 */
async function mountComposer(): Promise<{
  mount: FakeEl;
  composer: FakeEl;
  handle: ReturnType<typeof createHarnessPanel>;
}> {
  installFakeDom();
  const backend = installBackend();
  backend.handle("harness_draft_get", () => null);
  backend.handle("harness_draft_put", () => undefined);
  const handle = createHarnessPanel({
    shell: { titlebar: new FakeEl("header") } as unknown as AppShell,
    editor: editorDouble(),
    togglePane: () => {},
    toast: () => {},
    openVaultPath: () => {}, // 这些用例不点路径：桩空实现
    isVaultDir: () => false, // 路径链接的目录判定（change harness-dir-link）：本文件不涉路径
    revealVaultDir: () => {},
  });
  const mount = new FakeEl("div");
  handle.attachTo(mount as unknown as HTMLElement);
  await flush();
  const composer = mount.querySelector(".lumir-hp-composer");
  assert.notEqual(composer, null, "composer 必须在面板里");
  return { mount, composer: composer as FakeEl, handle };
}

/** 把 DOM 选区落到块的末尾（逐键键入后引擎交出的常态位）。 */
function placeCaretAtEnd(el: FakeEl): void {
  const textChild = el.childNodes.find((node) => node.nodeType === TEXT_NODE) ?? el;
  const offset = textChild === el ? 0 : textChild.textContent.length;
  const range = (globalThis as unknown as { document: { createRange: () => FakeRange } }).document.createRange();
  range.setStart(textChild, offset);
  range.collapse();
  selectionState.removeAllRanges();
  selectionState.addRange(range);
}

/** 引擎式键入：keydown → 字符落块 → 选区跟到行末 → beforeinput（压栈）→ input。 */
function typeText(composer: FakeEl, text: string): void {
  for (const ch of text) {
    composer.fire("keydown", { key: ch });
    const para = composer.children[composer.children.length - 1];
    para.textContent = para.textContent + ch;
    placeCaretAtEnd(para);
    composer.fire("beforeinput", { inputType: "insertText", data: ch });
    composer.fire("input", {});
  }
}

/** Alex 现场的公共前缀：键入第一行 + ⇧Enter 拆段，返回两块段落。 */
function setupTwoLines(composer: FakeEl): { first: FakeEl; second: FakeEl } {
  typeText(composer, "第一行");
  composer.fire("keydown", { key: "Enter", shiftKey: true });
  const [first, second] = composer.children;
  assert.notEqual(first, undefined);
  assert.notEqual(second, undefined);
  assert.equal(first.textContent, "第一行");
  assert.equal(second.textContent, "", "⇧Enter 落的第二块是空段落");
  return { first: first as FakeEl, second: second as FakeEl };
}

test("HC5：组合窗内 normalize 冻结——组合文本不折进第一行、第二块不消失、选区不改写", async () => {
  const { composer, handle } = await mountComposer();
  try {
    const { first, second } = setupTwoLines(composer);
    const addCountBeforeComposition = selectionState.addCount;
    assert.equal(selectionState.anchorNode, second, "⇧Enter 后光标落在第二块（写回位）");

    composer.fire("compositionstart");
    // 模拟 WebKit 组合期的块内形态：组合文本节点 + 空块维持的 <br>——qpara 因此含元素
    // 子节点（normalize 第一循环的缺陷触发器：含元素子节点的 qpara 被折进前段）。
    second.append(textNode("hanyu"));
    const br = new FakeEl("br");
    second.append(br);
    triggerObserver(); // = 浏览器把待处理的 childList 记录交付给 composerObserver 那一拍

    assert.equal(composer.children.length, 2, "组合窗内 normalize MUST NOT 折段：两块结构保持");
    assert.equal(first.textContent, "第一行", "组合文本 MUST NOT 折进第一行");
    assert.equal(second.textContent, "hanyu", "组合文本留在第二块（缺陷形态：整块折进第一行、第二块消失）");
    assert.equal(
      selectionState.addCount,
      addCountBeforeComposition,
      "组合窗内 normalize MUST NOT 改写 DOM 选区（setDomCaret 不得运行）",
    );
    assert.equal(selectionState.anchorNode, second, "选区锚点不被挪走");
  } finally {
    handle.attachTo(null);
  }
});

test("HC5：组合期内 withModel 冻结——组合期粘贴不整面重渲、组合文本不丢", async () => {
  const { composer, handle } = await mountComposer();
  try {
    const { first, second } = setupTwoLines(composer);
    composer.fire("compositionstart");
    second.append(textNode("hanyu"));
    second.append(new FakeEl("br"));

    composer.fire("paste", {
      clipboardData: { items: [], getData: (type: string) => (type === "text/plain" ? "PASTE" : "") },
    });

    assert.equal(composer.children.length, 2, "组合期整面重渲冻结：粘贴不得触发 replaceChildren");
    assert.equal(first.textContent, "第一行");
    assert.equal(second.textContent, "hanyu", "组合文本不因粘贴路径丢失");
    assert.ok(!composer.textContent.includes("PASTE"), "被冻结的粘贴不得半途落入 DOM");
  } finally {
    handle.attachTo(null);
  }
});

test("HC5：compositionend 补账——确认窗过期后归一把裸节点折回，净段落两块结构不动", async () => {
  const { composer, handle } = await mountComposer();
  try {
    const { first, second } = setupTwoLines(composer);
    composer.fire("compositionstart");
    second.append(textNode("hanyu"));
    second.append(new FakeEl("br"));
    triggerObserver();

    composer.fire("compositionend");
    // WKWebView 落定：提交文本替换组合文本、空块维持的 <br> 随内容落定撤掉（落定态 = 净文本节点）。
    second.textContent = "汉语";
    // 落定还常带一个顶层游离文本节点（WebKit 自造结构）——补账归一的正面判据。
    composer.append(textNode("tail"));

    await sleep(IME_CONFIRM_WINDOW_MS + 120); // 越过确认窗，compositionend 排期的补账归一落定

    assert.equal(composer.children.length, 2, "补账归一不得破坏两块结构（折叠规则只对裸节点）");
    assert.equal(first.textContent, "第一行");
    assert.equal(second.textContent, "汉语tail", "补账把游离文本折进末段、候选文本留在第二行");
  } finally {
    handle.attachTo(null);
  }
});

test("HC5：补账定时器早于窗尾到期时续排——游离文本不得因静默丢弃而永不归一（M560）", async () => {
  // 生产现场（M555 间歇红 '汉语' !== '汉语tail'）：定时器与墙钟不同源，补账定时器可能在窗尾
  // **之前**到期（负载实测：Node 的 setTimeout(250) 有 1/178 次在 Date.now() 只走 249ms 时就
  // 到期）。旧实现是一次性定时器，到期重判 imeWindowActive() 仍真就静默丢弃、不重排——丢掉的
  // 补账没有第二次，tail 永久不折。这里用假墙钟 + mock timers 把「到期早于窗尾」这一拍确定性地
  // 造出来：定时器按 250ms 到期，墙钟停在原地。
  const realNow = Date.now;
  let fakeNow = 4_000_000;
  Date.now = () => fakeNow;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { composer, handle } = await mountComposer();
    try {
      const { first, second } = setupTwoLines(composer);
      composer.fire("compositionstart");
      second.append(textNode("hanyu"));
      second.append(new FakeEl("br"));
      triggerObserver();

      composer.fire("compositionend"); // 补账截止 = fakeNow + IME_CONFIRM_WINDOW_MS
      second.textContent = "汉语";
      composer.append(textNode("tail"));

      // 定时器到期，墙钟仍停在窗内：这一拍 MUST NOT 提前归一（冻结口径不变），MUST NOT 丢掉补账。
      mock.timers.tick(IME_CONFIRM_WINDOW_MS);
      assert.equal(second.textContent, "汉语", "确认窗未过期：补账不得提前归一");

      fakeNow += IME_CONFIRM_WINDOW_MS + 1; // 墙钟越过窗尾
      mock.timers.tick(IME_CONFIRM_WINDOW_MS + 1); // 续排的补账在此到期
      assert.equal(composer.children.length, 2, "补账归一不得破坏两块结构（折叠规则只对裸节点）");
      assert.equal(first.textContent, "第一行");
      assert.equal(
        second.textContent,
        "汉语tail",
        "窗尾续排的补账 MUST 把游离文本折回（旧实现此处静默丢弃、永不归一）",
      );
    } finally {
      handle.attachTo(null);
    }
  } finally {
    mock.timers.reset();
    Date.now = realNow;
  }
});
