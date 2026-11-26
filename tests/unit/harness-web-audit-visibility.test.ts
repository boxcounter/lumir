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
import { setLanguageRoot } from "../../src/copy.ts";
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


/** 附属单元必须紧跟工具行（或其 termwrap 单元）之后；审计正文默认关闭。 */
function assertAuditUnitAfterRow(mount: FakeEl): {
  unit: FakeEl;
  audit: FakeEl;
  toggle: FakeEl;
} {
  const block = toolsBlock(mount);
  const row = block.querySelector(".lumir-hp-tool-row");
  assert.ok(row !== null, "工具行应在场");
  const unit = block.querySelector(".lumir-hp-web-unit");
  assert.ok(unit !== null, "Web 附属单元应在场");
  const audit = unit.querySelector(".lumir-hp-web-audit");
  assert.ok(audit !== null, "Web 审计正文应在场");
  const toggle = unit.querySelector(".lumir-hp-web-detail-toggle");
  assert.ok(toggle !== null, "详情入口应在场");
  const rowUnit = block.querySelector(".lumir-hp-termwrap") ?? row;
  const rowIndex = block.childNodes.indexOf(rowUnit);
  const unitIndex = block.childNodes.indexOf(unit);
  assert.ok(rowIndex >= 0, "工具行单元必须直接挂在工具块内");
  assert.ok(unitIndex > rowIndex, `附属单元必须在工具行之后（row=${rowIndex} unit=${unitIndex}）`);
  assert.equal(audit.hidden, true, "审计正文默认关闭");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  return { unit, audit, toggle };
}

/** 结果健康摘要的在场与逐字文本（`null` = 不应出现）。 */
function assertHealth(mount: FakeEl, expected: string | null): void {
  const health = mount.querySelector(".lumir-hp-web-health");
  if (expected === null) {
    assert.equal(health, null, "不应出现结果健康摘要");
  } else {
    assert.ok(health !== null, "结果健康摘要应在场");
    assert.equal(health.textContent, expected);
  }
}

/** `assert.doesNotMatch` 在本仓钉的 @types/node 档里没有声明（运行时存在、类型面缺）——
 *  与 harness-activity-wiring.test.ts 同款本地替代，不给 tsconfig 打补丁。 */
function assertNoMatch(value: string, pattern: RegExp, message: string): void {
  assert.ok(!pattern.test(value), message);
}

function searchAudit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: "search",
    query: "synthetic query",
    url: null,
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 1,
    cost_per_1000_success_cny: 5,
    local_precheck: false,
    provider_fetch: true,
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
    code: null,
    result_count: 2,
    result_text_bytes: 1536,
    ...overrides,
  };
}

const FETCH_AUDIT = {
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
  result_count: null,
  result_text_bytes: null,
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

/** 一次 Web 调用（started → done）并收一轮终态（触发组折叠）。 */
async function mountDone(
  name: string,
  summary: string,
  web: unknown,
  doneSummary = "成功",
): Promise<FakeEl> {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({ type: "tool_call", name, status: "started", summary, call_id: "c1", vault: VAULT });
  emit({ type: "tool_call", name, status: "done", summary: doneSummary, call_id: "c1", web, vault: VAULT });
  emit({ type: "done", vault: VAULT });
  await flush();
  return mount;
}

test("ask 批准后的 done：附属单元在已决行之后，详情默认关闭、展开后完整", async () => {
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
    web: FETCH_AUDIT,
    vault: VAULT,
  });
  const { audit, toggle } = assertAuditUnitAfterRow(mount);
  assert.equal(audit.hidden, true, "批准后审计同样默认关闭");
  toggle.fire("click");
  assert.equal(audit.hidden, false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(audit.textContent, /尝试次数/);
  assert.match(audit.textContent, /2/);
  assert.match(audit.textContent, /截断字段/);
  assert.match(audit.textContent, /content/);
});

test("恢复路径的已批准行同样默认关闭，展开后可见审计", async () => {
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
    result_count: null,
    result_text_bytes: null,
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
  const { audit, toggle } = assertAuditUnitAfterRow(mount);
  toggle.fire("click");
  assert.match(audit.textContent, /尝试次数/);
  assert.match(audit.textContent, /content/);
});

test("无 running 行的乱序 done 仍保持工具行→附属单元顺序", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({
    type: "tool_call",
    name: "web_fetch",
    status: "done",
    summary: "已完成",
    call_id: "call-stray",
    web: FETCH_AUDIT,
    vault: VAULT,
  });
  assertAuditUnitAfterRow(mount);
});

test("allow_all 的 done 与 ask 批准后同形：工具行→默认关闭的附属单元", async () => {
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
    web: FETCH_AUDIT,
    vault: VAULT,
  });
  assertAuditUnitAfterRow(mount);
});

test("单次 Web 调用不出现组摘要；第二行是结果健康摘要，详情默认关闭", async () => {
  const mount = await mountDone("web_search", "synthetic query", searchAudit());
  assert.equal(
    toolsBlock(mount).querySelector(".lumir-hp-tool-summary"),
    null,
    "单次调用 MUST NOT 折叠为组摘要",
  );
  assertHealth(mount, "2 条结果 · 文本 1.5 KB");
  const { audit, toggle } = assertAuditUnitAfterRow(mount);
  toggle.fire("click");
  assert.equal(audit.hidden, false);
  assert.match(audit.textContent, /查询/);
  assert.match(audit.textContent, /synthetic query/);
  assert.match(audit.textContent, /untrusted data/);
});

test("两个真实调用 + 两个审计仍计为 2；展开组后各审计仍默认关闭", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  for (let index = 1; index <= 2; index += 1) {
    const callId = `call-${index}`;
    emit({
      type: "tool_call",
      name: "web_search",
      status: "started",
      summary: `query ${index}`,
      call_id: callId,
      vault: VAULT,
    });
    emit({
      type: "tool_call",
      name: "web_search",
      status: "done",
      summary: "成功",
      call_id: callId,
      web: searchAudit({ query: `query ${index}`, result_count: index, result_text_bytes: index * 1024 }),
      vault: VAULT,
    });
  }
  emit({ type: "done", vault: VAULT });
  await flush();
  const summary = toolsBlock(mount).querySelector(".lumir-hp-tool-summary");
  assert.ok(summary !== null, "两次真实调用必须折叠为组摘要");
  assert.equal(summary.dataset.count, "2", "计数只计真实工具调用，不含审计");
  assert.match(summary.textContent, /2 个工具调用/);
  const audits = mount.querySelectorAll(".lumir-hp-web-audit");
  const units = mount.querySelectorAll(".lumir-hp-web-unit");
  assert.equal(audits.length, 2);
  assert.equal(units.length, 2);
  assert.ok(units.every((unit) => unit.hidden), "折叠时附属单元随行隐藏");
  assert.ok(audits.every((audit) => audit.hidden), "折叠时各审计保持默认关闭");
  summary.fire("click");
  assert.ok(units.every((unit) => !unit.hidden), "展开组后附属单元可见");
  assert.ok(audits.every((audit) => audit.hidden), "展开组 MUST NOT 展开各审计");
  const toggles = mount.querySelectorAll(".lumir-hp-web-detail-toggle");
  toggles[0].fire("click");
  assert.equal(audits[0].hidden, false);
  assert.equal(audits[1].hidden, true, "打开一个审计不得连带打开另一个");
});

test("结果健康摘要：正常 / 字段截断 / 结果裁剪 / 真正空结果", async () => {
  const cases: Array<{ audit: Record<string, unknown>; text: string }> = [
    { audit: searchAudit({ result_count: 0, result_text_bytes: 0 }), text: "0 条结果 · 搜索成功" },
    {
      audit: searchAudit({
        truncated: true,
        truncated_fields: ["results[].content"],
        result_count: 2,
        result_text_bytes: 24_000,
      }),
      text: "2 条结果 · 文本 23 KB · 已截断",
    },
    {
      audit: searchAudit({
        truncated: true,
        truncated_fields: ["results"],
        result_count: 80,
        result_text_bytes: 24_000,
      }),
      text: "保留 80 条结果 · 文本 23 KB · 已截断",
    },
    { audit: searchAudit({ result_count: 1, result_text_bytes: 1024 }), text: "1 条结果 · 文本 1.0 KB" },
  ];
  for (const { audit, text } of cases) {
    const mount = await mountDone("web_search", "synthetic query", audit);
    assertHealth(mount, text);
  }
});

test("结果健康摘要随语言切到英文：单数档正确", async () => {
  setLanguageRoot(() => ({ lang: "en" }));
  try {
    const mount = await mountDone(
      "web_search",
      "synthetic query",
      searchAudit({ result_count: 1, result_text_bytes: 1024 }),
    );
    assertHealth(mount, "1 result · text 1.0 KB");
  } finally {
    setLanguageRoot(() => ({ lang: "zh-Hans" }));
  }
});

test("失败直接显示稳定 code + 人话原因，不显示条数 / 大小；审计仍可展开", async () => {
  const mount = await mountDone(
    "web_search",
    "synthetic query",
    searchAudit({
      provider: null,
      provider_id: null,
      attempts: 0,
      provider_fetch: false,
      code: "web_provider_unconfigured",
      result_count: null,
      result_text_bytes: null,
    }),
    "error · web_provider_unconfigured: 没有唯一可用的官方 DeepSeek Web provider",
  );
  assertHealth(mount, null);
  const row = mount.querySelector(".lumir-hp-tool-row");
  assert.ok(row !== null);
  assert.match(row.textContent, /web_provider_unconfigured/);
  assertNoMatch(row.textContent, /error · /, "live 与 restored 同形：不显示状态前缀");
  assertNoMatch(row.textContent, /0 条结果|0 B/, "失败行不显示条数 / 大小");
  assertAuditUnitAfterRow(mount);
});

test("旧记录缺结果读数：不显示条数与大小，详情仍可用", async () => {
  const envelope = {
    ok: true,
    operation: "search",
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 1,
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
    query: "legacy query",
    results: [],
  };
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    messages: [
      {
        role: "tool",
        name: "web_search",
        summary: "legacy query",
        status: "done",
        text: JSON.stringify(envelope),
        ts: 1_759_000_003,
      },
    ],
  };
  const { mount } = await mountPanel(() => snapshot);
  assertHealth(mount, null);
  const { audit, toggle } = assertAuditUnitAfterRow(mount);
  toggle.fire("click");
  assert.match(audit.textContent, /legacy query/);
});

test("live 与 restored 同形同默认态", async () => {
  const envelope = {
    ok: true,
    operation: "search",
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 1,
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
    query: "synthetic query",
    result_count: 2,
    result_text_bytes: 1536,
    results: [],
  };
  const live = await mountDone("web_search", "synthetic query", searchAudit());
  const restored = await mountPanel(() => ({
    ...EMPTY_SNAPSHOT,
    messages: [
      {
        role: "tool",
        name: "web_search",
        summary: "synthetic query",
        status: "done",
        text: JSON.stringify(envelope),
        ts: 1_759_000_004,
      },
    ],
  }));
  assertHealth(live, "2 条结果 · 文本 1.5 KB");
  assertHealth(restored.mount, "2 条结果 · 文本 1.5 KB");
  const liveAudit = live.querySelector(".lumir-hp-web-audit");
  const restoredAudit = restored.mount.querySelector(".lumir-hp-web-audit");
  assert.ok(liveAudit !== null && restoredAudit !== null);
  assert.equal(liveAudit.hidden, true);
  assert.equal(restoredAudit.hidden, true);
  assert.equal(
    live.querySelector(".lumir-hp-web-detail-toggle")?.getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(
    restored.mount.querySelector(".lumir-hp-web-detail-toggle")?.getAttribute("aria-expanded"),
    "false",
  );
  assert.equal(liveAudit.textContent, restoredAudit.textContent, "两条路径的审计内容同形");
});

test("running 行显示纯 query：旧 JSON 摘要不把默认参数带上屏", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({
    type: "tool_call",
    name: "web_search",
    status: "started",
    summary: '{"query":"synthetic query","count":5,"need_content":false}',
    call_id: "call-running",
    vault: VAULT,
  });
  await flush();
  const row = mount.querySelector(".lumir-hp-tool-row");
  assert.ok(row !== null);
  assert.match(row.textContent, /synthetic query/);
  assertNoMatch(row.textContent, /\{/, "running 行不显示 JSON 结构");
  assertNoMatch(row.textContent, /count/, "running 行不显示默认参数");
  assertNoMatch(row.textContent, /need_content/, "running 行不显示默认参数");
});

test("Ask 待决卡完整信息不变；决策前不建附属单元", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({
    type: "tool_call",
    name: "web_fetch",
    status: "started",
    summary: "https://example.com/a",
    call_id: "call-ask-card",
    vault: VAULT,
  });
  emit({
    type: "approval_request",
    id: "ap-card",
    tool: "web_fetch",
    web: APPROVAL_PREVIEW,
    vault: VAULT,
  });
  const card = mount.querySelector(".lumir-hp-approval-web");
  assert.ok(card !== null, "Ask 待决卡应在场");
  assert.match(card.textContent, /https:\/\/example\.com\/a/);
  assert.match(card.textContent, /https:\/\/example\.com/);
  assert.match(card.textContent, /deepseek-work/);
  assert.match(card.textContent, /HEAD \/ Range GET/);
  assert.match(card.textContent, /5 元 \/ 1000 次/);
  assert.match(card.textContent, /untrusted data/);
  assert.equal(mount.querySelector(".lumir-hp-web-unit"), null, "决策前不建附属单元");
});

test("恢复的 Web 工具行不把 provider_message / request_id / 正文里的 Key 渲染上屏", async () => {
  const canary = "lumir-stage5-canary-4f8c2d";
  const envelope = {
    ok: false,
    operation: "web_search",
    query: "canary query",
    url: null,
    provider: "deepseek",
    provider_id: "deepseek-work",
    attempts: 1,
    trust: "untrusted",
    truncated: false,
    truncated_fields: [],
    code: "web_http_error",
    message: "DeepSeek Search 返回 HTTP 400；未自动重试",
    provider_code: `invalid_${canary}`,
    provider_message: `rejected key ${canary}`,
    request_id: `req-${canary}`,
    source: { url: null, title: "", content: `page echo ${canary}` },
  };
  const snapshot = {
    ...EMPTY_SNAPSHOT,
    messages: [
      {
        role: "tool",
        name: "web_search",
        summary: "canary query",
        status: "error",
        text: JSON.stringify(envelope),
        ts: 1_759_000_002,
      },
    ],
  };
  const { mount } = await mountPanel(() => snapshot);
  assert.match(mount.textContent, /未自动重试/);
  assert.equal(
    mount.textContent.includes(canary),
    false,
    "panel DOM 不得出现 Key / provider 原始字段（含默认关闭的详情）",
  );
});

// ── 恢复失败行的参数可见性（评审 P1-1）────────────────────────────────────────
//
// 真实生产形状：快照失败记录的 summary 是 `状态 · code: message`（不是参数），完整输入由
// 面板记录随记录持久化的 `web_input` 提供；JSONL 恢复的 summary 是纯参数摘要、旧记录可能
// 没有 web_input。两条恢复路径都必须让默认行看到 query / URL，详情仍默认关闭；旧快照缺
// 输入时安全降级为空，MUST NOT 把错误摘要抄进参数格。

const SEARCH_FAILURE_ENVELOPE = {
  ok: false,
  operation: "search",
  provider: null,
  provider_id: null,
  attempts: 0,
  trust: "untrusted",
  truncated: false,
  truncated_fields: [],
  code: "web_provider_unconfigured",
  message: "没有唯一可用的官方 DeepSeek Web provider",
  result_count: null,
  result_text_bytes: null,
};

const FETCH_FAILURE_ENVELOPE = {
  ok: false,
  operation: "fetch",
  provider: null,
  provider_id: null,
  attempts: 0,
  trust: "untrusted",
  truncated: false,
  truncated_fields: [],
  code: "permission_denied",
  message: "命中 deny 规则 web_fetch(https://example.com)",
  source: {
    url: "https://example.com/a",
    title: "",
    snippet: null,
    summary: null,
    content: null,
    content_format: null,
    site: null,
    date: null,
    authority: null,
  },
  result_count: null,
  result_text_bytes: null,
};

const SEARCH_SUCCESS_ENVELOPE = {
  ok: true,
  operation: "search",
  query: "synthetic query",
  provider: "deepseek",
  provider_id: "deepseek-work",
  attempts: 1,
  trust: "untrusted",
  truncated: false,
  truncated_fields: [],
  total_results: 2,
  results: [],
  result_count: 2,
  result_text_bytes: 1536,
};

const FETCH_SUCCESS_ENVELOPE = {
  ok: true,
  operation: "fetch",
  provider: "deepseek",
  provider_id: "deepseek-work",
  attempts: 1,
  trust: "untrusted",
  truncated: false,
  truncated_fields: [],
  source: {
    url: "https://example.com/a",
    title: "",
    snippet: null,
    summary: null,
    content: "# body",
    content_format: "markdown",
    site: "example.com",
    date: null,
    authority: null,
  },
  result_count: null,
  result_text_bytes: null,
};

/** 工具行参数格的文本（`createToolText` 的 `.lumir-hp-tool-args`）。 */
function argsCell(mount: FakeEl): string {
  const row = toolsBlock(mount).querySelector(".lumir-hp-tool-row");
  assert.ok(row !== null, "工具行应在场");
  const cell = row.querySelector(".lumir-hp-tool-args");
  return cell?.textContent ?? "";
}

function restoredSnapshot(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...EMPTY_SNAPSHOT,
    messages: [{ role: "tool", ts: 1_759_000_100, ...record }],
  };
}

test("快照失败恢复：真实生产形状（错误摘要 + web_input）默认行保留 query，详情仍默认关闭", async () => {
  const { mount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_search",
      summary: "error · web_provider_unconfigured: 没有唯一可用的官方 DeepSeek Web provider",
      status: "error",
      text: JSON.stringify(SEARCH_FAILURE_ENVELOPE),
      web_input: { query: "synthetic query" },
    }),
  );
  assert.equal(argsCell(mount), "synthetic query", "默认行必须看到 query");
  const { audit, toggle } = assertAuditUnitAfterRow(mount);
  toggle.fire("click");
  assert.match(audit.textContent, /synthetic query/);
  assert.match(audit.textContent, /尝试次数/);
  assert.match(audit.textContent, /未解析/);
  assert.match(audit.textContent, /untrusted data/);
});

test("快照失败恢复：web_input 的 Fetch URL 在默认行可见，详情仍默认关闭", async () => {
  const { mount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_fetch",
      summary: "denied · permission_denied: 命中 deny 规则 web_fetch(https://example.com)",
      status: "denied",
      text: JSON.stringify(FETCH_FAILURE_ENVELOPE),
      web_input: { url: "https://example.com/a" },
    }),
  );
  assert.equal(argsCell(mount), "https://example.com/a");
  const { audit, toggle } = assertAuditUnitAfterRow(mount);
  toggle.fire("click");
  assert.match(audit.textContent, /https:\/\/example\.com\/a/);
  assert.match(audit.textContent, /尝试次数/);
});

test("JSONL 恢复失败：纯参数摘要没有 web_input 也能恢复 query / URL", async () => {
  for (const { name, summary, text } of [
    { name: "web_search", summary: "synthetic query", text: SEARCH_FAILURE_ENVELOPE },
    { name: "web_fetch", summary: "https://example.com/a", text: FETCH_FAILURE_ENVELOPE },
  ]) {
    const { mount } = await mountPanel(() =>
      restoredSnapshot({ name, summary, status: "error", text: JSON.stringify(text) }),
    );
    assert.equal(argsCell(mount), summary, `${name} 的纯参数摘要必须上屏`);
    assertAuditUnitAfterRow(mount);
  }
});

test("JSONL 恢复失败：带 web_input 的新生产形状同样显示 query / URL", async () => {
  const { mount: queryMount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_search",
      summary: "synthetic query",
      status: "error",
      text: JSON.stringify(SEARCH_FAILURE_ENVELOPE),
      web_input: { query: "synthetic query" },
    }),
  );
  assert.equal(argsCell(queryMount), "synthetic query");
  const { mount: urlMount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_fetch",
      summary: "https://example.com/a",
      status: "denied",
      text: JSON.stringify(FETCH_FAILURE_ENVELOPE),
      web_input: { url: "https://example.com/a" },
    }),
  );
  assert.equal(argsCell(urlMount), "https://example.com/a");
});

test("快照 / JSONL 成功恢复：Search query 与 Fetch URL 都保留在默认行", async () => {
  const { mount: queryMount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_search",
      summary: "synthetic query",
      status: "done",
      text: JSON.stringify(SEARCH_SUCCESS_ENVELOPE),
      web_input: { query: "synthetic query" },
    }),
  );
  assert.equal(argsCell(queryMount), "synthetic query");
  assertAuditUnitAfterRow(queryMount);
  const { mount: urlMount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_fetch",
      summary: "https://example.com/a",
      status: "done",
      text: JSON.stringify(FETCH_SUCCESS_ENVELOPE),
      web_input: { url: "https://example.com/a" },
    }),
  );
  assert.equal(argsCell(urlMount), "https://example.com/a");
  assertAuditUnitAfterRow(urlMount);
});

test("旧快照失败记录（无 web_input）：参数格安全降级，不把错误摘要当参数", async () => {
  const { mount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_search",
      summary: "error · web_provider_unconfigured: 没有唯一可用的官方 DeepSeek Web provider",
      status: "error",
      text: JSON.stringify(SEARCH_FAILURE_ENVELOPE),
    }),
  );
  assert.equal(argsCell(mount), "", "没有可信参数源时留空，不伪造");
  const row = toolsBlock(mount).querySelector(".lumir-hp-tool-row");
  assert.ok(row !== null);
  assert.match(row.textContent, /web_provider_unconfigured/);
  const { audit } = assertAuditUnitAfterRow(mount);
  assertNoMatch(audit.textContent, /synthetic/, "旧记录不伪造 query");
});

test("旧快照 Fetch 失败记录：信封里的 source.url 是可恢复的可信输入", async () => {
  const { mount } = await mountPanel(() =>
    restoredSnapshot({
      name: "web_fetch",
      summary: "denied · permission_denied: 命中 deny 规则 web_fetch(https://example.com)",
      status: "denied",
      text: JSON.stringify(FETCH_FAILURE_ENVELOPE),
    }),
  );
  assert.equal(argsCell(mount), "https://example.com/a");
  assertAuditUnitAfterRow(mount);
});

test("live 失败与快照失败同形：默认行参数格一致，详情都默认关闭", async () => {
  const live = await mountDone(
    "web_search",
    "synthetic query",
    searchAudit({
      provider: null,
      provider_id: null,
      attempts: 0,
      provider_fetch: false,
      code: "web_provider_unconfigured",
      result_count: null,
      result_text_bytes: null,
    }),
    "error · web_provider_unconfigured: 没有唯一可用的官方 DeepSeek Web provider",
  );
  const restored = await mountPanel(() =>
    restoredSnapshot({
      name: "web_search",
      summary: "error · web_provider_unconfigured: 没有唯一可用的官方 DeepSeek Web provider",
      status: "error",
      text: JSON.stringify(SEARCH_FAILURE_ENVELOPE),
      web_input: { query: "synthetic query" },
    }),
  );
  assert.equal(argsCell(live), "synthetic query");
  assert.equal(argsCell(restored.mount), "synthetic query");
  assertAuditUnitAfterRow(live);
  assertAuditUnitAfterRow(restored.mount);

  const liveFetch = await mountDone(
    "web_fetch",
    "https://example.com/a",
    {
      operation: "fetch",
      query: null,
      url: "https://example.com/a",
      provider: null,
      provider_id: null,
      attempts: 0,
      cost_per_1000_success_cny: 5,
      local_precheck: false,
      provider_fetch: false,
      trust: "untrusted",
      truncated: false,
      truncated_fields: [],
      code: "permission_denied",
      result_count: null,
      result_text_bytes: null,
    },
    "denied · permission_denied: 命中 deny 规则 web_fetch(https://example.com)",
  );
  const restoredFetch = await mountPanel(() =>
    restoredSnapshot({
      name: "web_fetch",
      summary: "denied · permission_denied: 命中 deny 规则 web_fetch(https://example.com)",
      status: "denied",
      text: JSON.stringify(FETCH_FAILURE_ENVELOPE),
      web_input: { url: "https://example.com/a" },
    }),
  );
  assert.equal(argsCell(liveFetch), "https://example.com/a");
  assert.equal(argsCell(restoredFetch.mount), "https://example.com/a");
  assertAuditUnitAfterRow(liveFetch);
  assertAuditUnitAfterRow(restoredFetch.mount);
});

test("乱序 live 失败 done 没有 started 行：用同一 done 的审计输入补 query", async () => {
  const { mount, emit } = await mountPanel(() => EMPTY_SNAPSHOT);
  emit({ type: "auto_turn_started", chain_index: 1, vault: VAULT });
  emit({
    type: "tool_call",
    name: "web_search",
    status: "done",
    summary: "error · web_provider_unconfigured: 没有唯一可用的官方 DeepSeek Web provider",
    call_id: "call-stray-web",
    web: searchAudit({
      provider: null,
      provider_id: null,
      attempts: 0,
      provider_fetch: false,
      code: "web_provider_unconfigured",
      result_count: null,
      result_text_bytes: null,
    }),
    vault: VAULT,
  });
  await flush();
  assert.equal(argsCell(mount), "synthetic query");
  assertAuditUnitAfterRow(mount);
});

test("live done 与恢复行在长 query 上同形：都取完整输入，不靠 80 字 started 摘要", async () => {
  const longQuery = `synthetic ${"q".repeat(120)}`;
  const truncated = `${longQuery.slice(0, 80)}…`;
  const live = await mountDone(
    "web_search",
    truncated,
    searchAudit({ query: longQuery, result_count: 2, result_text_bytes: 1536 }),
  );
  const restored = await mountPanel(() =>
    restoredSnapshot({
      name: "web_search",
      summary: truncated,
      status: "done",
      text: JSON.stringify({ ...SEARCH_SUCCESS_ENVELOPE, query: longQuery }),
      web_input: { query: longQuery },
    }),
  );
  assert.equal(argsCell(live), longQuery);
  assert.equal(argsCell(restored.mount), longQuery);
});
