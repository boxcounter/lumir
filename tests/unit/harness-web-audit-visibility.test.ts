// Web 审计可见性接线（Stage4 返修）：live ask 批准后的 done、恢复路径的已批准行、
// 以及无 running 行的乱序 done——审计块必须出现在工具行之后，且与 allow_all 同形。
//
// 为什么这一层要 DOM：判据是「已决行之后有没有审计块」与「块内顺序」，投影函数层测不到。
// 平台边界替身逐字取自 tests/unit/harness-restore-block-defaults.test.ts（各持一份是刻意的，
// 理由见 tabs.test.ts 文件头）。

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { installBackend } from "./harness.ts";
import type { FakeBackend } from "./harness.ts";
import { createHarnessPanel } from "../../src/harness-panel.ts";
import { createVaultActivityStore } from "../../src/harness-activity.ts";
import type { HarnessPanelEditor } from "../../src/harness-panel.ts";
import type { AppShell } from "../../src/shell.ts";

// ---------------------------------------------------------------------------
// 平台边界的 DOM 替身（逐字取自 tests/unit/harness-restore-block-defaults.test.ts）
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

const VAULT = "/tmp/lumir-web-audit-visibility";
const VAULT_ID = "vault-web-audit-visibility";

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

async function mountPanel(snapshotOf: () => unknown): Promise<{
  mount: FakeEl;
  backend: FakeBackend;
  emit: (event: Record<string, unknown>) => void;
}> {
  installFakeDom();
  const backend = installBackend();
  const emit = installEventBridge(backend);
  backend.handle("config_get", () => ({
    config: { harness: { provider: "mock", providers: { mock: { fixture: "f.json" } } } },
  }));
  backend.handle("harness_state", () => JSON.stringify(snapshotOf()));
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
  return { mount, backend, emit };
}

function toolsBlock(mount: FakeEl): FakeEl {
  const block = mount.querySelector(".lumir-hp-tools");
  assert.ok(block !== null, "工具块应在场");
  return block;
}

/** 审计块必须紧跟在工具行（或其 termwrap 单元）之后，不能排到行前面。 */
function assertAuditAfterRow(mount: FakeEl): FakeEl {
  const block = toolsBlock(mount);
  const row = block.querySelector(".lumir-hp-tool-row");
  assert.ok(row !== null, "工具行应在场");
  const audit = block.querySelector(".lumir-hp-web-audit");
  assert.ok(audit !== null, "Web 审计块应在场");
  const unit = block.querySelector(".lumir-hp-termwrap") ?? row;
  const unitIndex = block.childNodes.indexOf(unit);
  const auditIndex = block.childNodes.indexOf(audit);
  assert.ok(unitIndex >= 0, "工具行单元必须直接挂在工具块内");
  assert.ok(block.contains(row), "工具行必须仍在工具块内");
  assert.ok(
    auditIndex > unitIndex,
    `审计块必须在工具行之后（unit=${unitIndex} audit=${auditIndex}）`,
  );
  return audit;
}

const AUDIT = {
  operation: "fetch",
  query: null,
  url: "https://example.com/a",
  provider: "deepseek",
  provider_id: "deepseek-work",
  attempts: 2,
  cost_per_1000_success_cny: 5,
  local_precheck: true,
  provider_fetch: true,
  trust: "untrusted",
  truncated: true,
  truncated_fields: ["content"],
  code: null,
};

const APPROVAL_PREVIEW = {
  operation: "fetch",
  url: "https://example.com/a",
  origin: "https://example.com",
  provider: "deepseek",
  provider_id: "deepseek-work",
  provider_status: "ready",
  trust: "untrusted",
  local_precheck: true,
  provider_fetch: true,
  cost_per_1000_success_cny: 5,
};

test("ask 批准后的 done 在已决行之后显示完整审计（attempts / truncated）", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({
    type: "tool_call",
    name: "web_fetch",
    status: "started",
    summary: "https://example.com/a",
    call_id: "call-ask",
    vault: VAULT,
  });
  emit({
    type: "approval_request",
    id: "ap-1",
    tool: "web_fetch",
    web: APPROVAL_PREVIEW,
    vault: VAULT,
  });
  const approve = mount.querySelector("button[data-act=approve]");
  assert.ok(approve !== null, "批准卡应有采纳钮");
  approve.fire("click");
  await flush();
  emit({
    type: "tool_call",
    name: "web_fetch",
    status: "done",
    summary: "已完成",
    call_id: "call-ask",
    web: AUDIT,
    vault: VAULT,
  });
  const audit = assertAuditAfterRow(mount);
  assert.match(audit.textContent, /尝试次数/);
  assert.match(audit.textContent, /2/);
  assert.match(audit.textContent, /截断字段/);
  assert.match(audit.textContent, /content/);
});

test("恢复路径的已批准行同样显示审计块，且顺序为工具行→审计", async () => {
  const envelope = {
    ok: true,
    operation: "fetch",
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 2,
    trust: "untrusted",
    truncated: true,
    truncated_fields: ["content"],
    local_precheck: true,
    source: {
      url: "https://example.com/a",
      title: "",
      snippet: null,
      summary: null,
      content: "x",
      content_format: "markdown",
      site: "example.com",
      date: null,
      authority: null,
    },
  };
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    messages: [
      { role: "assistant", text: "抓取结果", ts: 1_759_000_000 },
      {
        role: "tool",
        name: "web_fetch",
        summary: "https://example.com/a",
        status: "done",
        decision: "approved",
        text: JSON.stringify(envelope),
        ts: 1_759_000_001,
      },
    ],
  };
  const { mount } = await mountPanel(() => snapshot);
  const audit = assertAuditAfterRow(mount);
  assert.match(audit.textContent, /尝试次数/);
  assert.match(audit.textContent, /content/);
});

test("无 running 行的乱序 done 仍保持工具行→审计顺序", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({
    type: "tool_call",
    name: "web_fetch",
    status: "done",
    summary: "已完成",
    call_id: "call-stray",
    web: AUDIT,
    vault: VAULT,
  });
  assertAuditAfterRow(mount);
});

test("allow_all 的 done 与 ask 批准后同形：工具行→审计", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({
    type: "tool_call",
    name: "web_fetch",
    status: "started",
    summary: "https://example.com/a",
    call_id: "call-allow",
    vault: VAULT,
  });
  emit({
    type: "tool_call",
    name: "web_fetch",
    status: "done",
    summary: "已完成",
    call_id: "call-allow",
    web: AUDIT,
    vault: VAULT,
  });
  assertAuditAfterRow(mount);
});
