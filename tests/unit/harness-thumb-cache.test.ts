// Harness 缩略图 blob URL 生命周期（内部资源治理，2026-11-23）：
// 面板每次整面重渲都按 `data-thumb-name` 取缩略图；缓存有界后，**非活跃项**在超出预算时
// 被淘汰并 revokeObjectURL。本文件用浏览器桩（假 DOM + 假 `URL.createObjectURL` /
// `revokeObjectURL` 计数）驱动真 `createHarnessPanel`，覆盖四条用户路径：
//   1. 同图重贴 / tray 整面重渲 → 命中缓存，不重复读回、不重复建 URL；
//   2. 卡片移除 → 清 DOM 后 prune，超预算时释放非活跃项（正在显示的另一张图不动）；
//   3. 切 vault → `resetComposer` 后 clear 全量 revoke，重新贴图必须重读；
//   4. 失败条目（null）不占字节但占条目数——纯缓存层覆盖，见 image-thumb-cache.test.ts。
//
// 断言口径（REVIEW.md「断言等价于子串」条）：计数与 URL 集合逐项精确断言，不用「包含」；
// 反向验证（修前红）见 `.local/missions/harness-thumb-cache/` 的修前日志：旧实现
// `Map<string,string|null>` 从不 revoke，卡片移除 / 切 vault 后 revoke 计数恒为 0。

import { test } from "node:test";
import assert from "node:assert/strict";
import { installBackend } from "./harness.ts";
import type { FakeBackend } from "./harness.ts";
import { createHarnessPanel } from "../../src/harness-panel.ts";
import { createVaultActivityStore } from "../../src/harness-activity.ts";
import type { HarnessPanelDeps, HarnessPanelEditor } from "../../src/harness-panel.ts";
import type { AppShell } from "../../src/shell.ts";
import type { QuoteImageOutcome } from "../../src/quote-image.ts";

// ---------------------------------------------------------------------------
// 平台边界的 DOM 替身（与 tests/unit/harness-thinking-reset.test.ts 同款；各持一份是
// 刻意取舍，见 tabs.test.ts 文件头）。`dataset` 走 Proxy 同步到 data-* 属性：生产代码的
// active 名单按 `[data-thumb-name]` 查询，替身必须让这个选择器真的命中。
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

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

class FakeEl {
  readonly tagName: string;
  readonly nodeType: number;
  parent: FakeEl | null = null;
  private nodes: FakeEl[] = [];
  private text = "";

  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
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

  /** DOMStringMap：生产侧只按 camelCase 读写，替身把它映射到 `data-*` 属性，选择器因此可见。 */
  get dataset(): Record<string, string> {
    const attrs = this.attrs;
    return new Proxy({} as Record<string, string>, {
      get: (_target, key: string): string | undefined => attrs.get(`data-${kebabCase(key)}`),
      set: (_target, key: string, value: string): boolean => {
        attrs.set(`data-${kebabCase(key)}`, String(value));
        return true;
      },
      deleteProperty: (_target, key: string): boolean => attrs.delete(`data-${kebabCase(key)}`),
      has: (_target, key: string): boolean => attrs.has(`data-${kebabCase(key)}`),
    });
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
      const name = attr[1];
      const value = attr[2];
      const actual = this.attrs.get(name);
      if (value === undefined || value === "") {
        if (actual === undefined) return false;
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

/** 冲掉若干拍微/宏任务，落定 invoke 的 promise 链。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  }
}

function editorDouble(): HarnessPanelEditor {
  return {
    activeSession: () => ({ path: undefined }),
    view: { dom: new FakeEl("div"), state: {}, viewport: {} },
  } as unknown as HarnessPanelEditor;
}

// ---------------------------------------------------------------------------
// 浏览器桩：blob URL 工厂的 create / revoke 计数
// ---------------------------------------------------------------------------

interface UrlProbe {
  created: string[];
  revoked: string[];
  restore(): void;
}

function installUrlProbe(): UrlProbe {
  const created: string[] = [];
  const revoked: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let seq = 0;
  URL.createObjectURL = (): string => {
    const url = `blob:lumir-thumb-${(seq += 1)}`;
    created.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string): void => {
    revoked.push(url);
  };
  return {
    created,
    revoked,
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    },
  };
}

// ---------------------------------------------------------------------------
// 面板装置
// ---------------------------------------------------------------------------

const VAULT = "/tmp/lumir-thumb-cache-a";
const VAULT_ID = "vault-thumb-cache-a";

const EMPTY_SNAPSHOT = {
  vault: VAULT,
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  warn_ctx_pct: 85,
  thinking: { level: "high", supported: true },
};

/** 600 字节的合成图片字节（base64）：两张合计 1200 B，测试预算 1000 B 才能驱动淘汰。 */
const IMAGE_B64 = btoa("x".repeat(600));

function imageOutcome(name: string): QuoteImageOutcome {
  return {
    ok: true,
    image: { card: { name, sourceMime: "image/webp" }, source: `${name}.png` },
  };
}

interface PanelFixture {
  mount: FakeEl;
  backend: FakeBackend;
  handle: ReturnType<typeof createHarnessPanel>;
  reads: string[];
  toasts: string[];
}

async function mountPanel(limits: { maxBytes: number; maxEntries: number }): Promise<PanelFixture> {
  installFakeDom();
  const backend = installBackend();
  const reads: string[] = [];
  const toasts: string[] = [];
  backend.handle("config_get", () => ({
    config: { harness: { provider: "mock", providers: { mock: { fixture: "f.json" } } } },
  }));
  backend.handle("harness_state", () => JSON.stringify(EMPTY_SNAPSHOT));
  backend.handle("harness_draft_get", () => null);
  backend.handle("harness_draft_put", () => undefined);
  backend.handle("harness_read_image", (args: { name: string }) => {
    reads.push(args.name);
    return IMAGE_B64;
  });

  const titlebar = new FakeEl("header");
  const mount = new FakeEl("div");
  const deps = {
    shell: { titlebar } as unknown as AppShell,
    editor: editorDouble(),
    activity: createVaultActivityStore(),
    togglePane: () => {},
    toast: (text: string) => void toasts.push(text),
    openVaultPath: () => {},
    isVaultDir: () => false,
    revealVaultDir: () => {},
    openSettings: () => {},
    imageThumbCacheLimits: limits,
  } as unknown as HarnessPanelDeps;
  const handle = createHarnessPanel(deps);
  handle.attachTo(mount as unknown as HTMLElement);
  handle.vaultChanged(VAULT, VAULT_ID);
  await flush();
  return { mount, backend, handle, reads, toasts };
}

/** composer tray 里当前在场的图片卡（按 DOM 序）。 */
function trayImageCards(mount: FakeEl): FakeEl[] {
  const tray = mount.querySelector(".lumir-hp-composer-tray");
  return tray === null ? [] : tray.querySelectorAll(".lumir-hp-imgcard");
}

/** transcript 里当前在场的图片卡（排除 composer tray 那一份）。 */
function transcriptImageCards(mount: FakeEl): FakeEl[] {
  return mount
    .querySelectorAll(".lumir-hp-imgcard")
    .filter((card) => card.closest(".lumir-hp-composer-tray") === null);
}

/** 图片卡上的缩略图 URL（成功路径经 `img.src` 写属性；失败卡没有 `<img>`，返回空串）。 */
function cardUrls(cards: FakeEl[]): string[] {
  return cards.map((card) => {
    const img = card.querySelector(".lumir-hp-qc-thumb")?.querySelector("img");
    return (img as unknown as { src?: string } | null)?.src ?? "";
  });
}

function thumbUrls(mount: FakeEl): string[] {
  return cardUrls(trayImageCards(mount));
}

/** 移除第 index 张图片卡（点它的 `×` 钮；索引取卡片 data-attachment-index 的同一读数）。 */
function removeCard(mount: FakeEl, index: number): void {
  const cards = trayImageCards(mount);
  assert.ok(index < cards.length, `图片卡 ${index} 应在场（当前 ${cards.length} 张）`);
  const card = cards[index];
  assert.equal(card.dataset.attachmentIndex, String(index), "卡片索引与 DOM 序同源");
  const remove = card.querySelector(".lumir-hp-qc-x");
  assert.ok(remove !== null, "图片卡应带移除钮");
  remove.fire("click");
}

// ---------------------------------------------------------------------------
// 用例 1：同图重贴 / tray 整面重渲命中缓存（不重复读回、不重复建 URL）
// ---------------------------------------------------------------------------

test("同图重贴与 tray 重渲：缓存命中，读回与 createObjectURL 都不重复", async () => {
  const probe = installUrlProbe();
  const { mount, handle, reads } = await mountPanel({ maxBytes: 10_000, maxEntries: 16 });
  try {
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-aaaa.webp")], handle.viewToken());
    await flush();
    assert.deepEqual(reads, ["pasted-aaaa.webp"], "首贴读回一次");
    assert.equal(probe.created.length, 1, "首贴建一个 blob URL");
    assert.equal(probe.revoked.length, 0, "在场图不得被 revoke");
    const firstUrl = thumbUrls(mount)[0];
    assert.equal(firstUrl, probe.created[0], "缩略图 <img> 用缓存里的 URL");

    // 同图再贴一次：tray 整面重渲（两张卡都重建），全部命中缓存。
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-aaaa.webp")], handle.viewToken());
    await flush();
    assert.deepEqual(reads, ["pasted-aaaa.webp"], "同图重贴不得再读回");
    assert.equal(probe.created.length, 1, "同图重贴不得再建 URL");
    assert.equal(probe.revoked.length, 0, "重渲替换 <img> 不算非活跃");
    assert.deepEqual(thumbUrls(mount), [firstUrl, firstUrl], "两张卡共用同一个 URL");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});

// ---------------------------------------------------------------------------
// 用例 2：并发同图读回——读两次（不做 pending 去重），但只建一个 URL、不 revoke 在场 URL
// ---------------------------------------------------------------------------

test("并发同图读回：两张卡各读一次，先落地的 URL 被复用、不被后到的结果 revoke", async () => {
  const probe = installUrlProbe();
  const { mount, backend, handle, reads } = await mountPanel({ maxBytes: 10_000, maxEntries: 16 });
  try {
    const pending: Array<(value: string) => void> = [];
    backend.handle("harness_read_image", (args: { name: string }) => {
      reads.push(args.name);
      return new Promise<string>((resolve) => pending.push(resolve));
    });
    // 一次插入两张同名卡：两张卡在同一帧里各自发现缓存未命中 → 两次读回都在途。
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-race.webp"), imageOutcome("pasted-race.webp")], handle.viewToken());
    await flush();
    assert.equal(reads.length, 2, "两张卡各发一次读回（不做 pending 请求去重）");
    assert.equal(pending.length, 2, "两次读回都在途");
    assert.equal(probe.created.length, 0, "未落地前不建 URL");

    pending[0](IMAGE_B64);
    await flush();
    assert.equal(probe.created.length, 1, "先落地建一个 URL");
    const firstUrl = probe.created[0];
    assert.deepEqual(thumbUrls(mount), [firstUrl, ""], "先落地的卡挂上 URL，另一张仍在加载");

    pending[1](IMAGE_B64);
    await flush();
    assert.equal(probe.created.length, 1, "后落地复用已有 URL，不重建");
    assert.deepEqual(probe.revoked, [], "不 revoke 另一张卡正在显示的 URL");
    assert.deepEqual(thumbUrls(mount), [firstUrl, firstUrl], "两张卡共用同一个 URL");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});

// ---------------------------------------------------------------------------
// 用例 3：卡片移除 → 清 DOM 后 prune；超预算时释放非活跃项，正在显示的另一张不动
// ---------------------------------------------------------------------------

test("卡片移除：非活跃项超预算被淘汰并 revoke，在场图保留；再贴必须重读", async () => {
  const probe = installUrlProbe();
  const { mount, handle, reads } = await mountPanel({ maxBytes: 1_000, maxEntries: 16 });
  try {
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-aaaa.webp")], handle.viewToken());
    await flush();
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-bbbb.webp")], handle.viewToken());
    await flush();
    assert.deepEqual(probe.created, ["blob:lumir-thumb-1", "blob:lumir-thumb-2"], "两张图各建一个 URL");
    assert.equal(probe.revoked.length, 0, "两张都在场：活跃总字节可超预算（1200 > 1000），不淘汰");
    const [urlA, urlB] = thumbUrls(mount);

    // 移除 A（DOM 序第 0 张）：A 不再活跃，预算只容得下 B → A 被淘汰并恰好 revoke 一次。
    removeCard(mount, 0);
    await flush();
    assert.deepEqual(probe.revoked, [urlA], "只 revoke 被移除的那张（非活跃、超预算）");
    assert.deepEqual(thumbUrls(mount), [urlB], "仍在场的 B 保留原 URL（未被误删）");
    assert.deepEqual(reads, ["pasted-aaaa.webp", "pasted-bbbb.webp"], "移除卡片不触发读回");

    // 再贴 A：缓存条目已不在 → 必要重读，并建新 URL。
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-aaaa.webp")], handle.viewToken());
    await flush();
    assert.deepEqual(reads, ["pasted-aaaa.webp", "pasted-bbbb.webp", "pasted-aaaa.webp"], "重贴走重读");
    assert.equal(probe.created.length, 3, "重贴建了新 URL");
    assert.equal(probe.revoked.length, 1, "建新 URL 前没有旧 URL 可替（A 已被淘汰）");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});

// ---------------------------------------------------------------------------
// 用例 3：切 vault → resetComposer 后 clear，全量 revoke；新 vault 重贴必须重读
// ---------------------------------------------------------------------------

test("切 vault：全量 revoke；旧 vault 的图在新 vault 重贴走重读", async () => {
  const probe = installUrlProbe();
  const { mount, handle, reads } = await mountPanel({ maxBytes: 10_000, maxEntries: 16 });
  try {
    handle.insertQuoteWithImages(null, [
      imageOutcome("pasted-aaaa.webp"),
      imageOutcome("pasted-bbbb.webp"),
    ], handle.viewToken());
    await flush();
    assert.equal(probe.created.length, 2, "两张图各建一个 URL");
    const [urlA, urlB] = probe.created;

    handle.vaultChanged("/tmp/lumir-thumb-cache-b", "vault-thumb-cache-b");
    await flush();
    assert.deepEqual(probe.revoked, [urlA, urlB], "切 vault 后旧 vault 的 URL 全部 revoke（各一次）");
    assert.deepEqual(trayImageCards(mount), [], "composer 已换成新 vault 的草稿（空）");

    // 新 vault 贴同一张图：条目已随 clear 消失 → 必须重读、重建设 URL。
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-aaaa.webp")], handle.viewToken());
    await flush();
    assert.equal(reads.length, 3, "新 vault 重贴走重读");
    assert.equal(probe.created.length, 3, "重贴建了新 URL");
    assert.notEqual(thumbUrls(mount)[0], urlA, "新 URL 不是旧 vault 那个");
    assert.equal(probe.revoked.length, 2, "旧 URL 各 revoke 一次，无重复");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});

// ---------------------------------------------------------------------------
// 用例 3.5：切 vault 时在途旧读回（成功 / 失败）——按世代整条作废
//   旧代不得 createObjectURL / put / apply / toast；新 vault 里同一张图必须重新读回。
// ---------------------------------------------------------------------------

interface DeferredRead {
  resolve(value: string): void;
  reject(reason: unknown): void;
}

/** 把 `harness_read_image` 换成手动落定的 promise（每次调用一条，读回计数照记）。 */
function deferImageReads(backend: FakeBackend, reads: string[]): DeferredRead[] {
  const pending: DeferredRead[] = [];
  backend.handle("harness_read_image", (args: { name: string }) => {
    reads.push(args.name);
    return new Promise<string>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  });
  return pending;
}

test("切 vault 后旧读回成功落地：旧代整条作废（不建 URL / 不写缓存 / 不 apply），重贴走重读", async () => {
  const probe = installUrlProbe();
  const { mount, backend, handle, reads, toasts } = await mountPanel({ maxBytes: 10_000, maxEntries: 16 });
  try {
    const pending = deferImageReads(backend, reads);
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-old-vault.webp")], handle.viewToken());
    await flush();
    assert.equal(pending.length, 1, "旧 vault 的读回在途");
    assert.equal(probe.created.length, 0, "在途期间没有 blob URL");

    handle.vaultChanged("/tmp/lumir-thumb-cache-b", "vault-thumb-cache-b");
    await flush();
    assert.deepEqual(trayImageCards(mount), [], "新 vault 的 composer 为空");

    pending[0].resolve(IMAGE_B64);
    await flush();
    assert.equal(probe.created.length, 0, "旧代落地 MUST NOT createObjectURL");
    assert.equal(probe.revoked.length, 0, "旧代没有 URL 可 revoke");
    assert.deepEqual(toasts, [], "成功路径不 toast");
    assert.deepEqual(transcriptImageCards(mount), [], "旧代不得 apply 到新 vault 的渲染面");

    // 新 vault 重贴同一张图：旧代结果没进缓存 → 必须重新读回、重新建 URL。
    backend.handle("harness_read_image", (args: { name: string }) => {
      reads.push(args.name);
      return IMAGE_B64;
    });
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-old-vault.webp")], handle.viewToken());
    await flush();
    assert.equal(reads.length, 2, "重贴走重读（旧代未污染 B 的缓存）");
    assert.equal(probe.created.length, 1, "重读后建新 URL");
    assert.deepEqual(thumbUrls(mount), [probe.created[0]], "新卡挂新 URL");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});

test("切 vault 后旧读回失败落地：旧代不得写失败条目 / toast，重贴仍会重新读回", async () => {
  const probe = installUrlProbe();
  const { mount, backend, handle, reads, toasts } = await mountPanel({ maxBytes: 10_000, maxEntries: 16 });
  try {
    const pending = deferImageReads(backend, reads);
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-old-vault.webp")], handle.viewToken());
    await flush();
    assert.equal(pending.length, 1, "旧 vault 的读回在途");

    handle.vaultChanged("/tmp/lumir-thumb-cache-b", "vault-thumb-cache-b");
    await flush();
    pending[0].reject({ code: "fs_read_failed", message: "旧 vault 读失败" });
    await flush();
    assert.deepEqual(toasts, [], "旧代失败 MUST NOT toast");
    assert.equal(probe.created.length, 0, "失败路径不建 URL");
    assert.equal(probe.revoked.length, 0, "没有 URL 可 revoke");

    // 旧代若把 null 写进缓存，重贴会命中失败占位而不再读回——用读回次数证明缓存是干净的。
    backend.handle("harness_read_image", (args: { name: string }) => {
      reads.push(args.name);
      return IMAGE_B64;
    });
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-old-vault.webp")], handle.viewToken());
    await flush();
    assert.equal(reads.length, 2, "重贴走重读（旧代未写失败条目）");
    assert.equal(probe.created.length, 1, "重读成功后建 URL");
    assert.deepEqual(toasts, [], "成功路径不 toast");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});

// ---------------------------------------------------------------------------
// 用例 4：会话切换（resetView）先清 transcript 再 prune——composer 仍活跃的图保留
// ---------------------------------------------------------------------------

test("会话切换：transcript 图淘汰，composer 仍活跃的图保留（先清 DOM 再 prune）", async () => {
  const probe = installUrlProbe();
  const { mount, backend, handle, reads } = await mountPanel({ maxBytes: 1_000, maxEntries: 16 });
  try {
    // 快照带一条含图用户消息 → 会话渲染面里有一张 transcript 缩略图。
    backend.handle("harness_state", () =>
      JSON.stringify({
        ...EMPTY_SNAPSHOT,
        messages: [
          {
            role: "user",
            text: `会话里的图\n<image ref="pasted-session.webp" type="image/webp"/>`,
            ts: 1_759_000_000,
          },
        ],
      }),
    );
    handle.reloadSession({ targetVault: VAULT, viewToken: handle.viewToken() });
    await flush();
    assert.deepEqual(reads, ["pasted-session.webp"], "transcript 图读回一次");
    const transcriptUrl = cardUrls(transcriptImageCards(mount))[0];
    assert.equal(transcriptUrl, probe.created[0], "transcript 缩略图用缓存 URL");

    // composer 再放一张 600B 的图：两张都在场，1200 > 1000 也不淘汰。
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-composer.webp")], handle.viewToken());
    await flush();
    const composerUrl = thumbUrls(mount)[0];
    assert.equal(probe.created.length, 2, "两张图各建一个 URL");
    assert.equal(probe.revoked.length, 0, "两张都在场：活跃总字节可超预算");

    // 会话切换（resetView）：transcript 先清空再 prune → 会话图淘汰；composer 图仍活跃、保留。
    // change extend-harness-activity-across-vaults-nov23：返回值是发起视图的世代令牌
    // （null = 忙时未切屏）；「是否切了屏」的判据变成非 null。编号本身无含义。
    assert.notEqual(handle.beginCronRun("切换后的提问"), null, "空闲态可切屏");
    await flush();
    assert.deepEqual(probe.revoked, [transcriptUrl], "只淘汰已离场的会话图");
    assert.deepEqual(transcriptImageCards(mount), [], "transcript 已清空");
    assert.deepEqual(thumbUrls(mount), [composerUrl], "composer 仍活跃的图保留原 URL");
    assert.deepEqual(reads, ["pasted-session.webp", "pasted-composer.webp"], "切换不触发读回");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});

// ---------------------------------------------------------------------------
// 用例 5：失败条目共享条目上限（null 无字节，但占条目数）
// ---------------------------------------------------------------------------

test("失败条目：null 不占字节，但条目数有界——非活跃的旧失败条目会被淘汰", async () => {
  const probe = installUrlProbe();
  const { mount, backend, handle, reads } = await mountPanel({ maxBytes: 100_000, maxEntries: 2 });
  try {
    backend.handle("harness_read_image", (args: { name: string }) => {
      reads.push(args.name);
      throw { code: "fs_read_failed", message: "读不到" };
    });
    handle.insertQuoteWithImages(null, [
      imageOutcome("pasted-fail-1.webp"),
      imageOutcome("pasted-fail-2.webp"),
    ], handle.viewToken());
    await flush();
    assert.deepEqual(reads, ["pasted-fail-1.webp", "pasted-fail-2.webp"], "两条失败各读一次");
    assert.equal(probe.created.length, 0, "失败路径不建 blob URL");
    assert.equal(probe.revoked.length, 0, "无 URL 可 revoke");

    // 两张失败卡都撤掉（条目仍有 2 条，但已非活跃），再进第三条失败：
    // maxEntries=2 → 最旧的 fail-1 被淘汰（null 条目淘汰不产生 revoke）。
    removeCard(mount, 0);
    removeCard(mount, 0);
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-fail-3.webp")], handle.viewToken());
    await flush();
    assert.deepEqual(
      reads,
      ["pasted-fail-1.webp", "pasted-fail-2.webp", "pasted-fail-3.webp"],
      "第三条失败读一次",
    );

    // 重贴 fail-1：它已被条目上限淘汰 → 必须重读（缓存若仍命中就不会有第 4 次读）。
    handle.insertQuoteWithImages(null, [imageOutcome("pasted-fail-1.webp")], handle.viewToken());
    await flush();
    assert.deepEqual(
      reads,
      [
        "pasted-fail-1.webp",
        "pasted-fail-2.webp",
        "pasted-fail-3.webp",
        "pasted-fail-1.webp",
      ],
      "被条目上限淘汰的失败条目重贴走重读",
    );
    assert.equal(probe.created.length, 0, "失败路径始终不建 URL");
    assert.equal(probe.revoked.length, 0, "null 条目淘汰不调用 revoke");
  } finally {
    handle.attachTo(null);
    probe.restore();
  }
});
