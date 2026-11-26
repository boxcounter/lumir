// 流式分片边界的字符守恒（change fix-harness-stream-boundary-newline-nov26）。
//
// 缺陷：`finalizedUpTo` 以 `source.split("\n")` 逐行推进 offset，源以 `\n` 结尾时 split 会
// 多产出一个空串行——该行按「空行」推入 `offset + 0 + 1 = source.length + 1`。这个值被
// `flushChunks` 写进文本段的 `renderedFinalized` 游标，下一片到达时 `slice(renderedFinalized)`
// 从源长之外起切——**下一片的首字符被吞掉**，且不报任何错。纯函数层看不出（没人约束边界
// 上界），必须同时钉住真实 segment grow/tail 拼接路径（本文件第二组用例驱动真
// `createHarnessPanel` 的 `text_chunk` → `flushChunks` → 冻结块 / 尾块路径）。
//
// 合同（与 delta `openspec/changes/fix-harness-stream-boundary-newline-nov26/specs/harness/
// spec.md` 同源）：
//   1. 任意合法流式分片边界不得超过当前 source.length；
//   2. 跨片拼接（前一版的冻结前缀 + 本片的尾块）不得丢字符 / 重排字符；
//   3. 尾换行、连续空行、CRLF、闭合围栏按既有语义（已结束块仍可定稿）；未闭合围栏与
//      仍在生长的列表边界照旧不定稿（那两条由 harness-transcript-render.test.ts 的矩阵守，
//      本文件只补「边界上界」与「字符守恒」这两面，不复制 strong 语义断言）。
//
// 平台边界替身（FakeEl / installFakeDom）逐字取自 tests/unit/harness-web-audit-visibility.test.ts
//（各持一份是刻意的，理由见 tests/unit/tabs.test.ts 文件头），仅补 `lastElementChild`
// 一个真 DOM 属性（缺失会让面板的封段判据恒真，每个 chunk 各开一段）。

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { installBackend } from "./harness.ts";
import type { FakeBackend } from "./harness.ts";
import { createHarnessPanel, finalizedUpTo, renderMarkdownInto } from "../../src/harness-panel.ts";
import { createVaultActivityStore } from "../../src/harness-activity.ts";
import type { HarnessPanelEditor } from "../../src/harness-panel.ts";
import type { AppShell } from "../../src/shell.ts";

// ---------------------------------------------------------------------------
// 平台边界的 DOM 替身（逐字取自 tests/unit/harness-web-audit-visibility.test.ts）
// ---------------------------------------------------------------------------

interface FakeEvent {
  type?: string;
  target?: unknown;
  key?: string;
  clientX?: number;
  clientY?: number;
  dataTransfer?: unknown;
  preventDefault?(): void;
  stopPropagation?(): void;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class FakeEl {
  readonly tagName: string;
  readonly nodeType: number;
  parent: FakeEl | null = null;
  private nodes: FakeEl[] = [];
  private text = "";

  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly style: Record<string, string> = {};

  hidden = false;
  title = "";
  type = "";
  value = "";
  placeholder = "";
  spellcheck = false;
  contentEditable = "";
  tabIndex = -1;
  disabled = false;
  id = "";
  name = "";
  scrollTop = 0;
  scrollHeight = 0;
  offsetParent: FakeEl | null = null;

  constructor(tagName: string, nodeType = ELEMENT_NODE) {
    this.tagName = tagName;
    this.nodeType = nodeType;
  }

  get attributes(): Array<{ name: string; value: string }> {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
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
      replace: (oldName: string, newName: string): void => {
        if (!classes.delete(oldName)) return;
        classes.add(newName);
      },
      get length(): number {
        return classes.size;
      },
      [Symbol.iterator]: (): IterableIterator<string> => classes[Symbol.iterator](),
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
    this.text = value;
    for (const node of this.nodes) node.parent = null;
    this.nodes = [];
  }

  get childNodes(): FakeEl[] {
    return this.nodes;
  }

  get children(): FakeEl[] {
    return this.nodes.filter((node) => node.nodeType === ELEMENT_NODE);
  }

  get firstChild(): FakeEl | null {
    return this.nodes[0] ?? null;
  }

  get childElementCount(): number {
    return this.children.length;
  }

  /** 真 DOM 属性，替身原稿缺（面板的 flushPendingStructures 用它判断「开段是否已被本计划
   *  早前位次的思考占了它后面的位置」；缺失时该判据恒真，每个 chunk 都会封段开新）——
   *  本文件唯一一处对替身的补充。 */
  get lastElementChild(): FakeEl | null {
    const elements = this.children;
    return elements[elements.length - 1] ?? null;
  }

  get nextSibling(): FakeEl | null {
    if (this.parent === null) return null;
    const at = this.parent.nodes.indexOf(this);
    return this.parent.nodes[at + 1] ?? null;
  }

  get parentElement(): FakeEl | null {
    return this.parent;
  }

  get parentNode(): FakeEl | null {
    return this.parent;
  }

  get ownerDocument(): unknown {
    return (globalThis as unknown as { document: unknown }).document;
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

  removeChild(node: FakeEl): FakeEl {
    node.remove();
    return node;
  }

  prepend(...incoming: Array<FakeEl | string>): void {
    const added = incoming.map((raw) => (typeof raw === "string" ? textNode(raw) : raw));
    for (const node of added) node.parent = this;
    this.nodes.unshift(...added);
  }

  insertBefore(node: FakeEl, ref: FakeEl | null): void {
    const at = ref === null ? this.nodes.length : this.nodes.indexOf(ref);
    node.parent = this;
    this.nodes.splice(at < 0 ? this.nodes.length : at, 0, node);
  }

  replaceChildren(...incoming: Array<FakeEl | string>): void {
    for (const node of this.nodes) node.parent = null;
    this.nodes = [];
    this.append(...incoming);
  }

  replaceChild(next: FakeEl, old: FakeEl): void {
    const at = this.nodes.indexOf(old);
    if (at < 0) throw new Error("replaceChild：目标不在该元素下");
    old.parent = null;
    next.parent = this;
    this.nodes[at] = next;
  }

  replaceWith(next: FakeEl): void {
    const parent = this.parent;
    if (parent === null) return;
    const at = parent.nodes.indexOf(this);
    if (at < 0) return;
    next.parent = parent;
    parent.nodes[at] = next;
    this.parent = null;
  }

  remove(): void {
    if (this.parent === null) return;
    const at = this.parent.nodes.indexOf(this);
    if (at >= 0) this.parent.nodes.splice(at, 1);
    this.parent = null;
  }

  before(node: FakeEl): void {
    const parent = this.parent;
    if (parent === null) return;
    node.parent = parent;
    parent.nodes.splice(parent.nodes.indexOf(this), 0, node);
  }

  after(node: FakeEl): void {
    const parent = this.parent;
    if (parent === null) return;
    const at = parent.nodes.indexOf(this);
    node.parent = parent;
    parent.nodes.splice(at + 1, 0, node);
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

  /** 手动派发（不走冒泡：本层只断言被点元素自己的处理）。缺省事件带俩 no-op，
   *  好让 `event.stopPropagation()` / `event.preventDefault()` 的处理器照常跑。 */
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
      const name = attr[1];
      const value = attr[2];
      const dataKey = name.startsWith("data-")
        ? name.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
        : undefined;
      const actual = this.attrs.get(name) ?? (dataKey === undefined ? null : (this.dataset[dataKey] ?? null));
      if (value === undefined || value === "") {
        if (actual === null) return false;
      } else if (actual !== value) {
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

  getBoundingClientRect(): { x: number; y: number; width: number; height: number } {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  scrollIntoView(): void {}
}

function textNode(text: string): FakeEl {
  const node = new FakeEl("#text", TEXT_NODE);
  node.textContent = text;
  return node;
}

function installFakeDom(): void {
  const host = globalThis as unknown as Record<string, unknown>;
  host.document = {
    createElement: (tag: string): FakeEl => new FakeEl(tag),
    createElementNS: (_ns: string, tag: string): FakeEl => new FakeEl(tag),
    createTextNode: (text: string): FakeEl => textNode(text),
    createDocumentFragment: (): FakeEl => new FakeEl("#fragment", 11),
    createRange: () => ({
      setStart: (): void => {},
      setEnd: (): void => {},
      setStartBefore: (): void => {},
      insertNode: (): void => {},
      getClientRects: () => [],
    }),
    addEventListener: (): void => {},
    removeEventListener: (): void => {},
    body: new FakeEl("body"),
    head: new FakeEl("head"),
    documentElement: new FakeEl("html"),
  };
  (host.document as { defaultView?: unknown }).defaultView = host;
  host.getComputedStyle = () => ({ getPropertyValue: () => "" });
  host.Node = FakeEl;
  host.getSelection = () => ({
    rangeCount: 0,
    isCollapsed: true,
    removeAllRanges: (): void => {},
    addRange: (): void => {},
    toString: (): string => "",
  });
  (host.document as { getSelection?: () => unknown }).getSelection = () => (host.getSelection as () => unknown)();
  (host.document as { hasFocus?: () => boolean }).hasFocus = () => false;
  (host.document as { activeElement?: unknown }).activeElement = null;
  host.requestAnimationFrame = (): number => 0;
  host.cancelAnimationFrame = (): void => {};
  // composer 的兜底归一化观察器：本用例不驱动 composer 变更，观察器从不回调。
  host.MutationObserver = class {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  };
  // 面板构造期注册的 transcript 视口观察器（M644）：本用例不驱动尺寸变化，观察器从不回调。
  host.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}


/** 冲掉若干拍微/宏任务，落定 invoke 的 promise 链。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  }
}

/** 面板只需 editor 的构造面（上下文组装与主题镜像）；本用例不给活动文件。 */
function editorDouble(): HarnessPanelEditor {
  return {
    activeSession: () => ({ path: undefined }),
    view: { dom: new FakeEl("div"), state: {}, viewport: {} },
  } as unknown as HarnessPanelEditor;
}

/** 挂载过的面板：文件收尾统一摘下，清掉 30s / 400ms 定时器（否则测试进程不退出）。 */
const mountedPanels: Array<ReturnType<typeof createHarnessPanel>> = [];
after(() => {
  for (const handle of mountedPanels) handle.attachTo(null);
});

const VAULT = "/tmp/lumir-stream-boundary-nov26";
const VAULT_ID = "vault-stream-boundary-nov26";

const EMPTY_SNAPSHOT = {
  vault: VAULT,
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  warn_ctx_pct: 85,
  thinking: { level: "high", supported: true },
};

/** `harness:event` 的订阅桥：Tauri 的 listen 走 transformCallback + plugin:event|listen。 */
function installEventBridge(backend: FakeBackend): (event: Record<string, unknown>) => void {
  const host = globalThis as unknown as {
    __TAURI_INTERNALS__: Record<string, unknown>;
  };
  const callbacks = new Map<number, (message: unknown) => void>();
  const listeners = new Map<string, number>();
  let nextCallback = 1;
  host.__TAURI_INTERNALS__.transformCallback = (callback: (message: unknown) => void): number => {
    const id = nextCallback;
    nextCallback += 1;
    callbacks.set(id, callback);
    return id;
  };
  backend.handle("plugin:event|listen", (args: any) => {
    listeners.set(args.event, args.handler as number);
    return 1;
  });
  return (event) => {
    const handler = listeners.get("harness:event");
    assert.notEqual(handler, undefined, "面板必须已订阅 harness:event");
    const callback = callbacks.get(handler as number);
    assert.notEqual(callback, undefined, "订阅回调必须已登记");
    callback?.({ event: "harness:event", id: handler, payload: event });
  };
}

/** 真渲染件的文本读数（假 DOM）：判字符守恒用，不另建一份渲染语义。 */
function renderText(source: string): string {
  const host = new FakeEl("div");
  renderMarkdownInto(host as unknown as HTMLElement, source);
  return host.textContent;
}

async function mountPanel(): Promise<{
  mount: FakeEl;
  emit: (event: Record<string, unknown>) => void;
  pump: () => Promise<void>;
}> {
  installFakeDom();
  // rAF 收进队列由用例显式排干：假 DOM 的默认 rAF 是空实现，等帧什么也不会发生；而直接
  // 同步跑会把挂在面板构造期的编辑器测量回调一起跑掉（CM measure 需要真 window）。
  const frames: Array<() => void> = [];
  (globalThis as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame = (
    callback,
  ) => {
    frames.push(callback);
    return frames.length;
  };
  const pump = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) {
      const batch = frames.splice(0);
      if (batch.length === 0) break;
      for (const callback of batch) callback();
      await flush();
    }
  };
  const backend = installBackend();
  const emit = installEventBridge(backend);
  backend.handle("config_get", () => ({
    config: { harness: { provider: "mock", providers: { mock: { fixture: "f.json" } } } },
  }));
  backend.handle("harness_state", () => JSON.stringify(EMPTY_SNAPSHOT));
  backend.handle("harness_draft_get", () => null);
  backend.handle("harness_draft_put", () => undefined);
  backend.handle("harness_approve", () => undefined);
  const titlebar = new FakeEl("header");
  const mount = new FakeEl("div");
  const handle = createHarnessPanel({
    shell: { titlebar } as unknown as AppShell,
    editor: editorDouble(),
    activity: createVaultActivityStore(),
    togglePane: () => {},
    toast: () => {},
    stickyToast: () => {},
    openVaultPath: () => {},
    isVaultDir: () => false,
    revealVaultDir: () => {},
    openSettings: () => {},
  });
  handle.attachTo(mount as unknown as HTMLElement);
  handle.vaultChanged(VAULT, VAULT_ID);
  await flush();
  mountedPanels.push(handle);
  // 面板 / 编辑器在构造期排的帧与本次判据无关（CM measure 依赖真 window），丢弃。
  frames.length = 0;
  return { mount, emit, pump };
}

/** 流式 assistant 消息里唯一的正文段（用户气泡也带 .lumir-hp-body，按祖先筛）。 */
function assistantBody(mount: FakeEl): FakeEl {
  const bodies = mount
    .querySelectorAll(".lumir-hp-body")
    .filter((el) => el.closest(".lumir-hp-msg-assistant") !== null);
  assert.equal(bodies.length, 1, "assistant 正文段必须在场且唯一");
  return bodies[0];
}

// ---------------------------------------------------------------------------
// 纯函数层：边界上界与跨片字符守恒
// ---------------------------------------------------------------------------

/** 覆盖三类结尾（正文 / 尾换行 / 连续空行）、CRLF、围栏、列表与空源。 */
const BOUNDARY_CORPUS = [
  "",
  "\n",
  "\n\n",
  "普通段落。",
  "普通段落。\n",
  "普通段落。\n\n",
  "第一段。\n\n第二段。",
  "第一段。\n\n第二段。\n",
  "第一段。\n\n第二段。\n\n",
  "第一段。\n\n\n",
  "第一段。\r\n\r\n",
  "第一段。\r\n\r\n第二段。\r\n",
  "```js\nconst a = 1;\n```\n\n",
  "```js\nconst a = 1;\n\n后续",
  "1. 第一项\n2. 第二项\n\n   续段\n",
  "1. 第一项\n\n",
  "- 甲\n- 乙\n\n\n",
  "> 引用\n\n正文\n",
] as const;

test("属性：任意前缀的定稿边界都落在 [0, 源长] 内（全部切点）", () => {
  for (const source of BOUNDARY_CORPUS) {
    for (let cut = 0; cut <= source.length; cut += 1) {
      const prefix = source.slice(0, cut);
      const boundary = finalizedUpTo(prefix);
      assert.equal(Number.isInteger(boundary), true, `边界必须是整数：${JSON.stringify(prefix)}`);
      assert.ok(
        boundary >= 0 && boundary <= prefix.length,
        `${JSON.stringify(prefix)} → boundary=${boundary}，源长=${prefix.length}（边界是下一片尾块的起点，越界即吞字符）`,
      );
    }
  }
});

/** 第一片以「换行结尾」、第二片紧随其后的分片对（缺陷触发类，含单换行 / 连续空行 / CRLF / 围栏）。 */
const TRAILING_NEWLINE_SPLITS = [
  { first: "普通段落。\n", next: "续段首字保留。" },
  { first: "第一段。\n\n第二段。\n", next: "后续首字保留。" },
  { first: "第一段。\n\n\n", next: "第二段首字保留。" },
  { first: "第一段。\r\n\r\n", next: "第二段首字保留。" },
  { first: "```js\nconst a = 1;\n```\n\n", next: "尾段首字保留。" },
] as const;

/** 分片点落在块边界上（空行分隔）的子集：两阶段渲染文本应与完整源逐字相同。 */
const BLOCK_BOUNDARY_SPLITS = TRAILING_NEWLINE_SPLITS.filter(({ first }) => /(\r?\n){2}$/.test(first));

test("反向验证：旧实现的越界边界（源长 + 1）确实吞掉下一片首字符", () => {
  for (const { first, next } of TRAILING_NEWLINE_SPLITS) {
    // 旧实现的形状：split("\n") 多出的空串行给出 offset + 1 = 源长 + 1。
    const buggy = first.length + 1;
    assert.equal(
      (first + next).slice(buggy),
      next.slice(1),
      `${JSON.stringify(first)} 上的越界边界必须能复现「丢首字符」，否则本文件的判据没有区分度`,
    );
    // 修复后：边界不越界，且第二片整段落在尾块（首字符在场）。
    const boundary = finalizedUpTo(first);
    assert.ok(boundary <= first.length, `边界必须夹在源长内：${boundary} > ${first.length}`);
    assert.equal(
      (first + next).slice(boundary),
      next,
      `第二片必须整段进入尾块：boundary=${boundary}`,
    );
  }
});

test("属性：两阶段分片不丢 / 不重排字符（冻结前缀 + 尾块 = 完整源）", () => {
  installFakeDom(); // renderText 走真渲染件，需要 document（本用例不驱面板）
  for (const { first, next } of TRAILING_NEWLINE_SPLITS) {
    const boundary = finalizedUpTo(first);
    // 与 flushChunks 同构：冻结部分来自第一片（slice 会被源长截断），尾块来自增长后的源。
    const frozen = first.slice(0, boundary);
    const tail = (first + next).slice(boundary);
    assert.equal(frozen + tail, first + next, `跨片拼接出现丢字 / 重排：boundary=${boundary}`);
  }
  // 块边界子集：两阶段渲染文本收敛到完整源（块语义不变）。
  for (const { first, next } of BLOCK_BOUNDARY_SPLITS) {
    const boundary = finalizedUpTo(first);
    const frozen = first.slice(0, boundary);
    const tail = (first + next).slice(boundary);
    assert.equal(
      renderText(frozen) + renderText(tail),
      renderText(first + next),
      `两阶段渲染文本必须收敛到完整源：${JSON.stringify({ first, next, boundary })}`,
    );
  }
  // 仍在生长的列表边界照旧不定稿（既有语义，不因本修复改变）：整段落在尾块，字符同样守恒。
  const listFirst = "1. 甲\n\n";
  const listNext = "   续段首字保留\n\n尾段。";
  const listBoundary = finalizedUpTo(listFirst);
  assert.equal(listBoundary, 0, "列表内部空行不是定稿边界（既有语义）");
  assert.equal(
    listFirst.slice(0, listBoundary) + (listFirst + listNext).slice(listBoundary),
    listFirst + listNext,
    "未定稿时整段留在尾块，字符守恒",
  );
});

// ---------------------------------------------------------------------------
// 真面板：text_chunk → flushChunks → 冻结块 / 尾块路径
// ---------------------------------------------------------------------------

test("真面板：第一片以换行结尾时，第二片首字符保留在尾块（grow/tail 拼接路径）", async () => {
  for (const { first, next } of TRAILING_NEWLINE_SPLITS) {
    const { mount, emit, pump } = await mountPanel();
    emit({ type: "auto_turn_started", vault: VAULT });
    await flush();

    emit({ type: "text_chunk", text: first, vault: VAULT });
    await pump();
    const body = assistantBody(mount);
    assert.equal(
      body.querySelector(".lumir-hp-md-tail")?.textContent,
      "",
      `第一片的已结束块应整段定稿：${JSON.stringify(first)}`,
    );

    emit({ type: "text_chunk", text: next, vault: VAULT });
    await pump();
    assert.equal(
      mount.querySelectorAll(".lumir-hp-body").length,
      1,
      "两片必须落在同一正文段（封段开新会把判据变成「看另一段」，掩盖同一段的游标缺陷）",
    );
    const tail = body.querySelector(".lumir-hp-md-tail");
    assert.notEqual(tail, null, "尾块容器必须在场");
    assert.equal(
      tail?.textContent,
      next,
      `尾块必须从第二片首字符起（旧实现边界 = 第一片源长 + 1，吞掉首字符）：${JSON.stringify({ first, next })}`,
    );
    assert.equal(
      body.textContent,
      renderText(first) + renderText(next),
      "冻结块 + 尾块的上屏文本 = 两片各自渲染的拼接（不丢、不重排、不重复）",
    );
  }
});
