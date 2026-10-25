// 引用卡片插入后的**焦点移交**（M671）：三条引用入口——文本摘录（`insertQuoteCard`）、消息
// 摘录（transcript 选区 → 浮动钮 → `insertMessageQuoteCard`）、图片引用（`insertQuoteWithImages`
// 的图片卡路径）——插入卡片后焦点 MUST 落在 composer 输入区。现场（Alex 2026-10-24）：
// 「quote 完想直接打字，字会落进编辑器而不是 composer」。
//
// 判据是 **DOM 焦点**（`document.activeElement`），不是 AX 的 focused 标记：编辑器正文与
// composer 在 AX 里同为 AXTextArea，标记分不出是哪一侧（M500/M502 实证：标记在 composer、
// 盲注仍落进编辑器）。真机层的对应判据在场景 163b（卡片插入后直接键入 + 编辑器逐字节守卫）。
//
// 两态覆盖（装配层的两条真实路径）：
//   - **面板原本关着**：入口经 `deps.togglePane()` 让装配层现场开 pane，面板挂载在
//     `createPaneHandle` 里**同步**完成（本文件的 togglePane 替身照此同步 attach）。
//   - **面板原本开着**：焦点本来在编辑器里（`activeElement` 先指到编辑器替身），插入路径必须
//     把它搬到 composer——这条是本文件里唯一有区分度的那一态。
//
// 反向验证（REVIEW.md「断言等价于子串 / 覆盖声明超出真实验证」条）：把 `integrity` 里的
// `focusComposerAfterInsert(...)` 调用删掉（回到「插入后不聚焦」），本文件 MUST 全红。
//
// 这一层是零 DOM 环境（tests/unit/README.md）：本文件自带平台边界 DOM 替身（手法同
// tests/unit/harness-ime-enter.test.ts），驱动的是仓里那份真 createHarnessPanel。

import { test } from "node:test";
import assert from "node:assert/strict";
import { installBackend } from "./harness.ts";
import { createHarnessPanel } from "../../src/harness-panel.ts";
import type { HarnessPanelEditor } from "../../src/harness-panel.ts";
import type { MessageQuoteCard, QuoteCard } from "../../src/quote-card.ts";
import type { AppShell } from "../../src/shell.ts";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

interface FakeEvent {
  type?: string;
  target?: unknown;
  key?: string;
  preventDefault?(): void;
  stopPropagation?(): void;
}

/** DOM 替身（只覆盖构造面板 + 三条插入路径用到的面；语义与 harness-ime-enter.test.ts 同一份
 *  手法，另加两样这一层要判的东西：**焦点跟踪**与 `document.createElement` 的产出登记
 * （消息摘录的浮动钮由手势工厂现建、定位前不在 DOM 里，测试按登记拿到它直接派 click）。 */
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
  readonly style: Record<string, string> & { setProperty(name: string, value: string): void };

  hidden = false;
  title = "";
  id = "";
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 0;
  clientHeight = 0;
  clientWidth = 0;
  offsetWidth = 0;
  offsetHeight = 0;

  static readonly TEXT_NODE = TEXT_NODE;
  static readonly ELEMENT_NODE = ELEMENT_NODE;

  constructor(tagName: string, nodeType = ELEMENT_NODE) {
    this.tagName = tagName;
    this.nodeType = nodeType;
    this.style = Object.assign(Object.create(null) as Record<string, string>, {
      setProperty(name: string, value: string): void {
        (this as unknown as Record<string, string>)[name] = value;
      },
      removeProperty(name: string): void {
        delete (this as unknown as Record<string, string>)[name];
      },
    });
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

  get lastElementChild(): FakeEl | null {
    const els = this.children;
    return els[els.length - 1] ?? null;
  }

  get previousElementSibling(): FakeEl | null {
    if (this.parent === null) return null;
    const at = this.parent.nodes.indexOf(this);
    for (let i = at - 1; i >= 0; i -= 1) {
      if (this.parent.nodes[i].nodeType === ELEMENT_NODE) return this.parent.nodes[i];
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

  append(...incoming: Array<FakeEl | string>): void {
    for (const raw of incoming) {
      const node = typeof raw === "string" ? textNode(raw) : raw;
      node.parent = this;
      this.nodes.push(node);
    }
  }

  appendChild(node: FakeEl): FakeEl {
    this.append(node);
    return node;
  }

  insertBefore(node: FakeEl, ref: FakeEl | null): void {
    const at = ref === null ? this.nodes.length : this.nodes.indexOf(ref);
    node.parent = this;
    this.nodes.splice(at < 0 ? this.nodes.length : at, 0, node);
  }

  after(node: FakeEl): void {
    const parent = this.parent;
    if (parent === null) return;
    parent.insertBefore(node, parent.nodes[parent.nodes.indexOf(this) + 1] ?? null);
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

  /** 焦点跟踪（这一层唯一的被测读数）：focus 把 activeElement 指到自己。 */
  focus(): void {
    docState.activeElement = this;
  }

  blur(): void {
    if (docState.activeElement === this) docState.activeElement = null;
  }

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
    if (!(node instanceof FakeEl)) return false;
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
  collapsed: boolean;
  setStart(node: FakeEl, offset: number): void;
  setEnd(node: FakeEl, offset: number): void;
  setStartBefore(node: FakeEl): void;
  insertNode(node: FakeEl): void;
  collapse(toStart?: boolean): void;
  selectNodeContents(node: FakeEl): void;
  getClientRects(): unknown[];
  getBoundingClientRect(): ReturnType<FakeEl["getBoundingClientRect"]>;
}

/** document 级状态：焦点（被测读数）、选中区、createElement 登记（找手势浮动钮）。 */
const docState = {
  activeElement: null as FakeEl | null,
  created: [] as FakeEl[],
  listeners: new Map<string, Array<(event: FakeEvent) => void>>(),
  selectionText: "",
};

const selectionState = {
  rangeCount: 0,
  anchorNode: null as FakeEl | null,
  anchorOffset: 0,
  focusNode: null as FakeEl | null,
  focusOffset: 0,
  get isCollapsed(): boolean {
    return this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset;
  },
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
  },
  setBaseAndExtent(aNode: FakeEl, aOffset: number, fNode: FakeEl, fOffset: number): void {
    this.rangeCount = 1;
    this.anchorNode = aNode;
    this.anchorOffset = aOffset;
    this.focusNode = fNode;
    this.focusOffset = fOffset;
  },
  getRangeAt(): FakeRange {
    const range = fakeRange();
    range.setStart(this.anchorNode ?? new FakeEl("div"), this.anchorOffset);
    return range;
  },
  toString(): string {
    return docState.selectionText;
  },
};

function fakeRange(): FakeRange {
  return {
    startNode: null,
    startOffset: 0,
    collapsed: false,
    setStart(node: FakeEl, offset: number): void {
      this.startNode = node;
      this.startOffset = offset;
    },
    setEnd(): void {},
    setStartBefore(): void {},
    insertNode(): void {},
    collapse(): void {
      this.collapsed = true;
    },
    selectNodeContents(): void {},
    getClientRects: () => [],
    getBoundingClientRect: () => ({
      x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0,
    }),
  };
}

/** 把选区落到某个节点的末尾（消息摘录手势的 capture() 读它：非折叠 + 文本非空）。 */
function selectIn(node: FakeEl, text: string): void {
  selectionState.anchorNode = node;
  selectionState.anchorOffset = 0;
  selectionState.focusNode = node;
  selectionState.focusOffset = text.length;
  selectionState.rangeCount = 1;
  docState.selectionText = text;
}

function installFakeDom(): void {
  const host = globalThis as unknown as Record<string, unknown>;
  docState.created.length = 0;
  docState.listeners.clear();
  docState.activeElement = null;
  docState.selectionText = "";
  selectionState.removeAllRanges();
  host.document = {
    createElement: (tag: string): FakeEl => {
      const el = new FakeEl(tag);
      docState.created.push(el);
      return el;
    },
    createElementNS: (_ns: string, tag: string): FakeEl => new FakeEl(tag),
    createTextNode: (text: string): FakeEl => textNode(text),
    createDocumentFragment: (): FakeEl => new FakeEl("#fragment", 11),
    createRange: (): FakeRange => fakeRange(),
    addEventListener: (type: string, listener: (event: FakeEvent) => void): void => {
      const list = docState.listeners.get(type) ?? [];
      list.push(listener);
      docState.listeners.set(type, list);
    },
    removeEventListener: (type: string, listener: (event: FakeEvent) => void): void => {
      const list = docState.listeners.get(type);
      if (list === undefined) return;
      docState.listeners.set(
        type,
        list.filter((entry) => entry !== listener),
      );
    },
    get activeElement(): FakeEl | null {
      return docState.activeElement;
    },
    getSelection: () => selectionState,
    body: new FakeEl("body"),
    documentElement: new FakeEl("html"),
    execCommand: (): boolean => true,
  };
  host.Node = FakeEl;
  host.HTMLElement = FakeEl;
  host.Element = FakeEl;
  host.getSelection = () => selectionState;
  host.requestAnimationFrame = (cb: (t: number) => void): number =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  host.MutationObserver = class {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  };
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

/** 面板只需 editor 的构造面（refreshChip 的 assembleHarnessContext 读到空壳即退）。 */
function editorDouble(): HarnessPanelEditor {
  return {
    activeSession: () => ({ path: undefined }),
    view: { dom: new FakeEl("div"), state: {}, viewport: {} },
  } as unknown as HarnessPanelEditor;
}

const quoteCard: QuoteCard = {
  file: "harness-quote.md",
  heading: "摘录卡片验收",
  headingPath: "摘录卡片验收",
  lines: "3-3",
  text: "QALPHA 甲段：把可执行动作捞出来过一遍。",
};

const messageCard: MessageQuoteCard = {
  role: "assistant",
  at: null,
  text: "验回答：引用问题已收到。",
};

interface Mounted {
  handle: ReturnType<typeof createHarnessPanel>;
  mount: FakeEl;
  /** composer 输入区：面板原本关着时它随面板一起挂进来，因此按需现取（不在挂载前断言在场）。 */
  composer(): FakeEl;
  /** 编辑器替身：插入前焦点在它身上（面板已开的那一态）。 */
  editorFocus: FakeEl;
}

/** 挂面板：`paneOpen` 决定初态——装配层的 togglePane 替身照 `createPaneHandle` 的口径**同步**
 *  把面板挂进 mount（面板原本关着时，三条入口都经它先开面板再插入）。 */
async function mountPanel(paneOpen: boolean): Promise<Mounted> {
  installFakeDom();
  const backend = installBackend();
  backend.handle("harness_draft_get", () => null);
  backend.handle("harness_draft_put", () => undefined);
  const mount = new FakeEl("div");
  let handle: ReturnType<typeof createHarnessPanel> | null = null;
  const openPane = (): void => handle?.attachTo(mount as unknown as HTMLElement);
  handle = createHarnessPanel({
    shell: { titlebar: new FakeEl("header") } as unknown as AppShell,
    editor: editorDouble(),
    togglePane: () => openPane(),
    toast: () => {},
    openVaultPath: () => {},
    isVaultDir: () => false,
    revealVaultDir: () => {},
    openSettings: () => {},
  });
  if (paneOpen) openPane();
  await flush();
  const composer = (): FakeEl => {
    const el = mount.querySelector(".lumir-hp-composer");
    assert.notEqual(el, null, "composer 必须在面板里（面板已挂载）");
    return el as FakeEl;
  };
  // 「焦点本来在别处」：编辑器 pane 的正文。
  const editorFocus = new FakeEl("div");
  editorFocus.className = "cm-content";
  docState.activeElement = editorFocus;
  return { handle, mount, composer, editorFocus };
}

/** 手势工厂现建的浮动钮（定位前不在 DOM 里，按 createElement 登记取）。 */
function gestureButtons(): FakeEl[] {
  return docState.created.filter((el) => el.classes.has("quote-gesture-btn"));
}

/** transcript 里造一条 assistant 消息（消息摘录手势的 capture() 的读取面：.lumir-hp-msg >
 *  .lumir-hp-who[data-role] + .lumir-hp-body）。transcript 是面板的长驻子元素——面板原本关着
 *  时它不在 mount 下但在同一个 detached 树里，因此按 createElement 登记取（不依赖挂载）。 */
function appendTranscriptMessage(text: string): FakeEl {
  const transcript = docState.created.find((el) => el.classes.has("lumir-hp-transcript"));
  assert.notEqual(transcript, undefined, "transcript 必须在面板里（构造期建好、长驻）");
  const message = new FakeEl("div");
  message.className = "lumir-hp-msg";
  const who = new FakeEl("div");
  who.className = "lumir-hp-who";
  who.dataset.role = "assistant";
  const body = new FakeEl("div");
  body.className = "lumir-hp-body";
  body.textContent = text;
  message.append(who, body);
  transcript!.append(message);
  return body;
}

const hasCard = (composer: FakeEl): boolean => composer.querySelector(".lumir-hp-qcard") !== null;

// ── 入口 ①：文本摘录（insertQuoteCard）────────────────────────────────────────

test("文本摘录 · 面板原本关着：入口先开面板，卡片插入后焦点落在 composer", async () => {
  const { handle, composer, editorFocus } = await mountPanel(false);
  try {
    assert.equal(docState.activeElement, editorFocus, "前置：焦点在编辑器里");
    handle.insertQuoteCard(quoteCard);
    assert.equal(hasCard(composer()), true, "卡片确实进了 composer（不是没插入的空转）");
    assert.equal(docState.activeElement, composer(), "插入后 DOM 焦点 MUST 在 composer 输入区");
  } finally {
    handle.attachTo(null);
  }
});

test("文本摘录 · 面板原本开着：焦点从编辑器搬进 composer", async () => {
  const { handle, composer, editorFocus } = await mountPanel(true);
  try {
    assert.equal(docState.activeElement, editorFocus, "前置：面板开着、焦点仍在编辑器里");
    handle.insertQuoteCard(quoteCard);
    assert.equal(hasCard(composer()), true, "卡片进了 composer");
    assert.equal(docState.activeElement, composer(), "插入后焦点 MUST 搬进 composer");
  } finally {
    handle.attachTo(null);
  }
});

// ── 入口 ②：消息摘录（transcript 选区 → 浮动钮 → insertMessageQuoteCard）──────

for (const paneOpen of [false, true]) {
  test(`消息摘录 · 面板原本${paneOpen ? "开着" : "关着"}：浮动钮插入后焦点落在 composer`, async () => {
    const { handle, composer, editorFocus } = await mountPanel(paneOpen);
    try {
      assert.equal(docState.activeElement, editorFocus, "前置：焦点在编辑器里");
      const body = appendTranscriptMessage(messageCard.text);
      selectIn(body, messageCard.text);
      const buttons = gestureButtons();
      assert.equal(buttons.length, 1, "消息摘录手势的浮动钮只有一个（面板内唯一的手势工厂）");
      buttons[0].fire("click");
      assert.equal(hasCard(composer()), true, "消息摘录卡片进了 composer");
      assert.equal(docState.activeElement, composer(), "插入后 DOM 焦点 MUST 在 composer 输入区");
    } finally {
      handle.attachTo(null);
    }
  });
}

// ── 入口 ③：图片引用卡（insertQuoteWithImages 的图片块路径）────────────────────

const imageCard = {
  name: "pasted-0123456789abcdef.webp",
  sourceMime: "image/png",
  width: 640,
  height: 360,
};

for (const paneOpen of [false, true]) {
  test(`图片引用卡 · 面板原本${paneOpen ? "开着" : "关着"}：图片卡插入后焦点落在 composer`, async () => {
    const { handle, composer, editorFocus } = await mountPanel(paneOpen);
    try {
      assert.equal(docState.activeElement, editorFocus, "前置：焦点在编辑器里");
      handle.insertQuoteWithImages(null, [{ ok: true, image: { card: imageCard, source: "/vault/x.png" } }]);
      assert.equal(hasCard(composer()), true, "图片卡片进了 composer");
      assert.equal(docState.activeElement, composer(), "插入后 DOM 焦点 MUST 在 composer 输入区");
    } finally {
      handle.attachTo(null);
    }
  });
}

// 空插入（选区的图片全部引用失败、也没有文本卡片）不是一次引用：不搬焦点——它在输入区
// 留失败读数（D586），但用户此刻还在文档里，抢焦点会打断他。
test("图片引用全部失败（无卡片可插）：不搬焦点，只在输入区留失败读数", async () => {
  const { handle, mount, editorFocus } = await mountPanel(true);
  try {
    const before = docState.activeElement;
    assert.equal(before, editorFocus);
    handle.insertQuoteWithImages(null, [
      {
        ok: false,
        failure: { source: { path: "x.gif", rawRef: "x.gif" }, text: "暂不支持引用该格式（image/gif）" },
      },
    ]);
    assert.equal(docState.activeElement, editorFocus, "没有插入动作时不偷焦点");
    assert.equal(
      mount.querySelector(".lumir-hp-quote-note")?.hidden,
      false,
      "失败读数落在输入区状态行（D586，持久可见）",
    );
  } finally {
    handle.attachTo(null);
  }
});
