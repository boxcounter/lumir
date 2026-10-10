// 新会话后思考 chip 回落默认档的**接线**单测（M366）。
//
// 缺陷（finding 20261007-worker-tha1）：`startNewSession()` → `resetView()` 只清渲染面，
// 既不重取 `harness_state` 也不重渲思考 chip ⇒ 新建会话后 chip 停在上一段会话的档位，
// 而 core 会话已被丢弃、下一轮按默认 High 构造请求——人侧读数与请求参数分叉，
// 破 spec add-harness-thinking-display-and-effort 的 Scenario「新会话重置默认」。
//
// 为什么这层能测：chip 读数是**渲染面**的事实，纯函数层（tests/unit/harness-thinking.test.ts）
// 驱动不到「新会话路径有没有重取快照」这条接线。故本文件自带一份**平台边界的 DOM 替身**
// （术语与做法同 tests/unit 其他 DOM 件的 FakeEl：只替 DOM，跑的是仓里那份真 harness-panel），
// 覆盖「面板构造 → 新会话点击」这条路径。
//
// 断言口径（REVIEW.md 第 1 条）：用精确相等（chip 读屏名整串 D393 / effort 读数整串）判档位，
// 不用「包含 High」式的子串包含——子串断言在「chip 停在 Max」与「chip 回落 High」之间
// 只有子串重叠、没有区分度。反向用例见文件末尾：本测试必须能对「chip 停在旧档」判红。
// M373 起思考 chip 并入合并选择器（.lumir-hp-model · effort 读数 + 三维浮层），
// 本用例同步改断言合并 chip 形态。

import { test } from "node:test";
import assert from "node:assert/strict";
import { installBackend } from "./harness.ts";
import { createHarnessPanel } from "../../src/harness-panel.ts";
import type { HarnessPanelEditor } from "../../src/harness-panel.ts";
import type { AppShell } from "../../src/shell.ts";

// ---------------------------------------------------------------------------
// 平台边界的 DOM 替身（只求覆盖面板构造 + 新会话点击路径；真伪由「真面板跑过去」自证）
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

  constructor(tagName: string, nodeType = ELEMENT_NODE) {
    this.tagName = tagName;
    this.nodeType = nodeType;
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

  append(...incoming: Array<FakeEl | string>): void {
    for (const raw of incoming) {
      const node = typeof raw === "string" ? textNode(raw) : raw;
      node.parent = this;
      this.nodes.push(node);
    }
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
      const actual = this.attrs.get(name);
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
    documentElement: new FakeEl("html"),
  };
  host.Node = FakeEl;
  host.getSelection = () => ({
    rangeCount: 0,
    isCollapsed: true,
    removeAllRanges: (): void => {},
    addRange: (): void => {},
    toString: (): string => "",
  });
  host.requestAnimationFrame = (cb: (t: number) => void): number =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  // composer 的兜底归一化观察器：本用例不驱动 composer 变更，观察器从不回调。
  host.MutationObserver = class {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
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

const VAULT = "/tmp/lumir-m366-thinking-reset";

// ---------------------------------------------------------------------------
// 用例：新会话 ⇒ chip 回落默认 High（面文本 + 读屏名 + 浮层勾选三处同步）
// ---------------------------------------------------------------------------

test("新会话：chip 从会话档位（Max）回落默认 High，读屏名与浮层勾选同步（M366）", async () => {
  installFakeDom();
  const backend = installBackend();
  // 合并 chip 的数据源：harness 段带 kimi/deepseek（mock 在可选列表层隐藏，M373）——
  // model 维度照 schema 形态给（id/effort/window）。
  backend.handle("config_get", () => ({
    config: {
      harness: {
        provider: "kimi",
        providers: {
          kimi: {
            model: "kimi-k3",
            models: [{ id: "kimi-k3", effort: true, window: 1048576 }],
          },
          deepseek: { model: "deepseek-flash", models: [] },
          mock: { fixture: "f.json" },
        },
      },
    },
  }));
  // 后端会话态：一轮里用户选过 Max；「新会话」丢弃会话 ⇒ 下一份快照回默认（无会话空态）。
  let sessionLevel = "max";
  backend.handle("harness_state", () =>
    JSON.stringify({
      vault: VAULT,
      messages: [],
      usage: { ctx_pct: 0, cache_pct: 0 },
      warn_ctx_pct: 85,
      thinking: { level: sessionLevel, supported: true },
    }),
  );
  backend.handle("harness_new_session", () => {
    sessionLevel = "high";
  });

  const titlebar = new FakeEl("header");
  const mount = new FakeEl("div");
  const handle = createHarnessPanel({
    shell: { titlebar } as unknown as AppShell,
    editor: editorDouble(),
    togglePane: () => {},
    toast: () => {},
  });

  try {
    handle.attachTo(mount as unknown as HTMLElement);
    handle.vaultChanged(VAULT);
    await flush();

    const effort = (): string =>
      mount.querySelector(".lumir-hp-eff-reading")?.textContent ?? "";
    const chip = (): FakeEl => {
      const el = mount.querySelector(".lumir-hp-model");
      assert.ok(el !== null, "合并选择器 chip 必须在场（config harness 段 + 快照 thinking）");
      return el;
    };

    // 前态：chip 显示当前会话档位 Max（effort 读数整串相等，不是子串包含）；
    // 读屏名 = D393 支持态「模型：{model} · 思考程度：{level}（点击切换）」。
    assert.equal(effort(), "Max");
    assert.equal(
      chip().title,
      "模型：kimi-k3 · 思考程度：Max（点击切换）",
    );

    // 点「＋新会话」——会话被后端丢弃，chip 必须回落默认 High。
    const newBtn = titlebar.querySelector(".lumir-hp-seg-new");
    assert.ok(newBtn !== null, "「＋新会话」钮必须在标题栏 harness 段里");
    newBtn.fire("click");
    await flush();

    assert.equal(effort(), "High", "新会话后 chip 读数回落默认 High，不停在旧档 Max");
    assert.equal(
      chip().title,
      "模型：kimi-k3 · 思考程度：High（点击切换）",
      "读屏名随读数同步回落",
    );

    // 浮层勾选同步：点开合并浮层，effort 段（第三段）的当前项必须是 High。
    chip().fire("click");
    const secs = mount.querySelectorAll(".lumir-hp-selpop-sec");
    assert.equal(secs.length, 3, "三维分段：Provider / 模型 / 思考程度");
    const effItems = secs[2].querySelectorAll(".lumir-hp-selpop-item");
    assert.equal(effItems.length, 3, "effort 段三裸档 Low/High/Max");
    const current = effItems.filter((item) => item.classes.has("is-current"));
    assert.equal(current.length, 1, "effort 段恰有一项标为当前档");
    assert.equal(current[0].querySelector(".lumir-hp-selpop-name")?.textContent, "High");
  } finally {
    handle.attachTo(null); // 清挂载期的 30s when 刷新定时器，不留悬挂句柄
  }
});
