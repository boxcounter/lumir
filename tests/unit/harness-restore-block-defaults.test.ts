// 「恢复渲染 = 默认渲染」的展开态不变量单测（M542，Alex 2026-10-16 dogfood 反馈）。
//
// 缺陷：pane 里选一个旧会话、重建 transcript 后，thinking 块**默认展开**（恢复路径显式
// `is-open` + `body.hidden = false`），而默认渲染里它是折叠的。Alex 原话：「我希望重建后的
// 会话在 harness pane 的默认显示保持一致 —— 默认展开的内容（比如 AI 回复的正文）在重建后
// 也展开，而默认不展开的内容（比如 thinking 过程）在重建后也不展开。」
//
// 为什么这层能测：展开态是**渲染面的事实**（`.lumir-hp-think` 的 is-open / body.hidden /
// head[aria-expanded]），纯函数层（tests/unit/harness-restore.test.ts 的 restoredAssistantText /
// restoredReasoningText）驱动不到。故本文件自带一份**平台边界的 DOM 替身**（只替 DOM，跑的是
// 仓里那份真 createHarnessPanel；做法与 tests/unit/harness-thinking-reset.test.ts、
// harness-ime-enter.test.ts 同款——各持一份替身是刻意的，理由见 tabs.test.ts 文件头）。
//
// 覆盖两条恢复入口（快照恢复与会话恢复**共用** `appendSnapshotMessage` 这一份项映射，见
// src/harness-panel.ts 的 `renderSnapshotMessages` 注释）：
//   1. 会话恢复（Alex 报的那条路径）：会话浮层选旧会话 → harness_resume_session → 重放；
//   2. 快照恢复（webview 重载 / 切 vault 回来）：harness_state 带 messages → 重放。
// 逐类块的默认态对照：正文（展开）、thinking（折叠，且**无时长读数**）、工具清单（≥2 行折叠、
// 单行展开）——与 live 路径同一套渲染件、同一套默认。
//
// 断言口径（REVIEW.md 「断言等价于子串」条）：用**精确相等**判读数（折叠行文本整串、aria-expanded 字面值），
// 不用「包含」式子串。**区分度反向验证**（M542 实施期实测两轮，不在本文件里当用例跑）：① 把
// `createRestoredThinking` 还原成修复前的展开形态 ⇒ 4 条用例里 3 条判红（工具清单那条保持绿，
// 正是它要证明的「口径不是恢复就一律折叠」）；② 只去掉 `relabelThinkingViews` 的恢复分支 ⇒
// 语言切换那条独红，其余照绿。

import { test } from "node:test";
import assert from "node:assert/strict";
import { runRelabels, setLanguageRoot, t } from "../../src/copy.ts";
import { installBackend } from "./harness.ts";
import type { FakeBackend } from "./harness.ts";
import { createHarnessPanel } from "../../src/harness-panel.ts";
import type { HarnessBlockFullscreenPort, HarnessPanelEditor } from "../../src/harness-panel.ts";
import type { AppShell } from "../../src/shell.ts";

// ---------------------------------------------------------------------------
// 平台边界的 DOM 替身（逐字取自 tests/unit/harness-thinking-reset.test.ts；见文件头的取舍）
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


// ---------------------------------------------------------------------------
// 用例装置：挂载真面板（假后端 + 假 DOM）+ 两条恢复入口的驱动
// ---------------------------------------------------------------------------

const VAULT = "/tmp/lumir-m542-restore-defaults";

/** 恢复重建的面板记录（`SessionResumeInfo.messages` 与快照 `messages` 同形；快照恢复与会话
 *  恢复共用同一份项映射）：user 提问 + 带 reasoning 的 assistant 回复 + 两条工具记录。 */
const RESTORED_MESSAGES = [
  { role: "user", text: "恢复路径的提问", ts: 1_759_000_000 },
  { role: "assistant", text: "恢复路径的回复正文。", reasoning: "恢复路径的思考原文。", ts: 1_759_000_005 },
  { role: "tool", name: "vault_read", summary: "harness-note.md", status: "done", ts: 1_759_000_006 },
  { role: "tool", name: "vault_search", summary: "旧的搜索词", status: "done", ts: 1_759_000_007 },
];

/** 空会话快照（挂载期的第一份 `harness_state`）。 */
const EMPTY_SNAPSHOT = {
  vault: VAULT,
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  warn_ctx_pct: 85,
  thinking: { level: "high", supported: true },
};

/** 挂载面板并装载 vault（假后端 + 假 DOM；`harness_state` 的应答由 snapshotOf 现取）。 */
async function mountPanel(
  snapshotOf: () => unknown,
  blocks?: HarnessBlockFullscreenPort,
): Promise<{
  mount: FakeEl;
  titlebar: FakeEl;
  backend: FakeBackend;
  handle: ReturnType<typeof createHarnessPanel>;
}> {
  installFakeDom();
  const backend = installBackend();
  backend.handle("config_get", () => ({
    config: { harness: { provider: "mock", providers: { mock: { fixture: "f.json" } } } },
  }));
  backend.handle("harness_state", () => JSON.stringify(snapshotOf()));
  backend.handle("harness_draft_get", () => null);
  backend.handle("harness_draft_put", () => undefined);

  const titlebar = new FakeEl("header");
  const mount = new FakeEl("div");
  const handle = createHarnessPanel({
    shell: { titlebar } as unknown as AppShell,
    editor: editorDouble(),
    blocks,
    togglePane: () => {},
    toast: () => {},
    openVaultPath: () => {}, // 这些用例不点路径：桩空实现
    isVaultDir: () => false, // 路径链接的目录判定（change harness-dir-link）：本文件不涉路径
    revealVaultDir: () => {},
  });
  handle.attachTo(mount as unknown as HTMLElement);
  handle.vaultChanged(VAULT);
  await flush();
  return { mount, titlebar, backend, handle };
}

/** 会话浮层里选一条历史会话恢复（Alex 报的路径：pane → 选旧会话 → 重建 transcript）。 */
async function resumeViaSessionPicker(
  titlebar: FakeEl,
  backend: FakeBackend,
  messages: readonly unknown[],
): Promise<void> {
  backend.handle("harness_list_sessions", () => [
    { session_id: "s1759000000-alpha", first_user_text: "恢复路径的提问", ts: 1_759_000_000 },
  ]);
  backend.handle("harness_resume_session", () => ({
    session_id: "s1759009000-beta",
    restored_items: messages.length,
    messages,
  }));
  const button = titlebar.querySelector(".lumir-hp-session");
  assert.ok(button !== null, "标题栏 harness 段应在场（会话名钮）");
  button.fire("click");
  await flush();
  const row = titlebar.querySelector(".lumir-hp-sesspop-history");
  assert.ok(row !== null, "会话浮层应列出历史会话行（harness_list_sessions 往返）");
  row.fire("click");
  await flush();
}

/** transcript 里唯一的思考块。 */
function thinkBlock(mount: FakeEl): FakeEl {
  const blocks = mount.querySelectorAll(".lumir-hp-think");
  assert.equal(blocks.length, 1, "恢复路径应恰有一个思考块（带 reasoning 明文才建块）");
  return blocks[0];
}

/** 折叠行的可见文本（整串判读，不做子串包含——REVIEW.md 「断言等价于子串」条）。 */
function thinkHeadText(mount: FakeEl): string {
  return thinkBlock(mount).querySelector(".lumir-hp-think-text")?.textContent ?? "";
}

/** 在给定语言下跑一段断言，结束后恢复语言读取口（register.mjs 把它钉在 zh）。 */
function inLanguage(lang: "zh" | "en", run: () => void): void {
  setLanguageRoot(() => ({ lang }));
  try {
    runRelabels(); // 语言切换的重绘施加点是 applyLanguage（装配层）；单测直接跑重绘表。
    run();
  } finally {
    setLanguageRoot(() => ({ lang: "zh-Hans" }));
    runRelabels();
  }
}

// ---------------------------------------------------------------------------
// 用例 A：会话恢复（Alex 报的路径）——逐类块的默认展开态与默认渲染一致
// ---------------------------------------------------------------------------

test("会话恢复：thinking 默认收起（点折叠行可展开）、正文默认展开、≥2 行工具清单默认收起", async () => {
  const { mount, titlebar, backend, handle } = await mountPanel(() => EMPTY_SNAPSHOT);
  try {
    await resumeViaSessionPicker(titlebar, backend, RESTORED_MESSAGES);

    // 恢复发生了（正观测：transcript 非空、上屏的是留存里的文本）。
    // 假 DOM 的 selector 只支持单类名 / 标签（不支持后代组合），故按类取到后自己判祖先。
    // 用户气泡的正文也带 .lumir-hp-body，这里筛 assistant 消息里的那一段。
    const assistantBodies = mount
      .querySelectorAll(".lumir-hp-body")
      .filter((el) => el.closest(".lumir-hp-msg-assistant") !== null);
    assert.equal(assistantBodies.length, 1, "assistant 正文段在位（默认展开的内容在恢复后同样展开）");
    assert.equal(assistantBodies[0].textContent, "恢复路径的回复正文。");
    assert.equal(assistantBodies[0].hidden, false, "assistant 正文默认可见（不变量另一半）");

    // thinking：默认收起——body 隐藏、无 is-open、aria-expanded=false；原文在 DOM 里但不显示。
    const think = thinkBlock(mount);
    const head = think.querySelector(".lumir-hp-think-head");
    assert.ok(head !== null, "思考块必须有折叠行（收起态要能点开）");
    const body = think.querySelector(".lumir-hp-think-body");
    assert.ok(body !== null, "思考块必须有正文容器");
    assert.equal(think.classes.has("is-open"), false, "恢复的思考块 MUST NOT 默认展开（is-open）");
    assert.equal(body.hidden, true, "恢复的思考块正文 MUST NOT 默认可见");
    assert.equal(head.getAttribute("aria-expanded"), "false", "折叠行 aria-expanded 默认 false");
    assert.equal(body.textContent, "恢复路径的思考原文。", "原文仍在（收起只是不显示，不是丢内容）");

    // 折叠行文案 = D468（无时长读数）：与带 {sec} 的 D388 区分开，且串里不含任何数字
    // （时长读数 wire 里没有——写一个数字就是把「未知」变成「思考了 0 秒」的伪造读数）。
    assert.equal(thinkHeadText(mount), t("D468"), "恢复路径折叠行取无时长变体 D468");
    assert.ok(!/\d/.test(thinkHeadText(mount)), "折叠行不带时长数字");
    assert.notEqual(
      thinkHeadText(mount),
      t("D388", { sec: 0 }),
      "重渲若走 D388，缺读数会渲染成这条（区分判据：两条串本就不同）",
    );

    // 工具清单：2 行 → 默认折叠为一行摘要（与默认渲染同口径），行本身隐藏。
    const summary = mount.querySelector(".lumir-hp-tool-summary");
    assert.ok(summary !== null, "≥2 行工具清单在恢复路径也要折叠成摘要行");
    assert.equal(summary.getAttribute("aria-expanded"), "false", "摘要行默认收起");
    for (const row of mount.querySelectorAll(".lumir-hp-tool-row")) {
      assert.equal(row.hidden, true, "折叠态下工具行不显示");
    }

    // 点折叠行展开原文（收起不是封死；与默认渲染同一个开关）。
    head.fire("click");
    assert.equal(body.hidden, false, "点折叠行后思考原文可见");
    assert.equal(think.classes.has("is-open"), true, "展开态加 is-open");
    assert.equal(head.getAttribute("aria-expanded"), "true", "aria-expanded 翻真");
    head.fire("click");
    assert.equal(body.hidden, true, "再点回到收起");
    assert.equal(head.getAttribute("aria-expanded"), "false", "aria-expanded 翻回 false");
  } finally {
    handle.attachTo(null); // 清挂载期的定时器，不留悬挂句柄
  }
});

test("语言切换重绘：恢复的折叠行重取无时长串，MUST NOT 把「时长未知」写成「思考了 0 秒」", async () => {
  const { mount, titlebar, backend, handle } = await mountPanel(() => EMPTY_SNAPSHOT);
  try {
    await resumeViaSessionPicker(titlebar, backend, RESTORED_MESSAGES);
    assert.equal(thinkHeadText(mount), "思考过程");

    inLanguage("en", () => {
      // 整串相等：D388 的 en 形态是「Thinking · {sec}s」，缺读数时只能填 0 ⇒ 出现数字即伪造读数。
      assert.equal(thinkHeadText(mount), t("D468", undefined, "en"));
      assert.ok(!/\d/.test(thinkHeadText(mount)), "en 面的折叠行同样不带时长数字");
    });
    // 恢复默认语言后随重绘回到中文串（重绘不是单向改写）。
    assert.equal(thinkHeadText(mount), "思考过程");
  } finally {
    handle.attachTo(null);
  }
});

// ---------------------------------------------------------------------------
// 用例 B：快照恢复（webview 重载 / 切 vault 回来）——同一份项映射，同一套默认
// ---------------------------------------------------------------------------

test("快照恢复：thinking 同样默认收起（快照与会话恢复共用一份项映射与渲染件）", async () => {
  const { mount, handle } = await mountPanel(() => ({ ...EMPTY_SNAPSHOT, messages: RESTORED_MESSAGES }));
  try {
    const think = thinkBlock(mount);
    assert.equal(think.classes.has("is-open"), false, "快照恢复的思考块 MUST NOT 默认展开");
    assert.equal(think.querySelector(".lumir-hp-think-body")?.hidden, true, "快照恢复的思考块正文默认隐藏");
    assert.equal(thinkHeadText(mount), "思考过程", "折叠行取无时长变体 D468");
  } finally {
    handle.attachTo(null);
  }
});

// ---------------------------------------------------------------------------
// 用例 C：区分度对照——单行工具清单在恢复路径保持展开（默认口径不是「恢复就一律折叠」）
// ---------------------------------------------------------------------------

test("恢复路径的单行工具清单保持展开：折叠是「≥2 行」的口径，不是「恢复态一律折叠」", async () => {
  const { mount, handle } = await mountPanel(() => ({
    ...EMPTY_SNAPSHOT,
    messages: [
      { role: "user", text: "只要一个工具调用的一轮", ts: 1_759_000_000 },
      { role: "assistant", text: "读完就答。", ts: 1_759_000_005 },
      { role: "tool", name: "vault_read", summary: "harness-note.md", status: "done", ts: 1_759_000_006 },
    ],
  }));
  try {
    assert.equal(mount.querySelectorAll(".lumir-hp-tool-summary").length, 0, "单行清单不出现摘要行");
    const rows = mount.querySelectorAll(".lumir-hp-tool-row");
    assert.equal(rows.length, 1, "恰一行工具行");
    assert.equal(rows[0].hidden, false, "单行清单保持展开（唯一一行本身就是信息）");
  } finally {
    handle.attachTo(null);
  }
});

// ---------------------------------------------------------------------------
// 用例 D：内容换代关闭面板来源的全屏遮罩（M634，change add-harness-block-fullscreen §5）
//
// 面板里的代码块 / 表格全屏是**打开那一刻的快照**：会话切换 / 面板重载 / 切 vault 之后那条
// 消息已不存在，遮罩必须显式退出（否则停在一份已删除的内容上）。关闭入口是端口注入的
// `close`（装配层落到既有两个遮罩的 `document` 径），本用例判的是**调用点**：四条换代路径
// 都经 `resetView`，同一 vault 的重复装载不是换代（不关）。
// ---------------------------------------------------------------------------

test("内容换代（切 vault / 重载会话）关闭面板来源的全屏遮罩；同 vault 重复装载不关", async () => {
  let closed = 0;
  const { handle } = await mountPanel(() => EMPTY_SNAPSHOT, {
    openTable: () => {},
    openCodeBlock: () => {},
    close: () => void (closed += 1),
  });
  try {
    const afterMount = closed;
    // 同一 vault 的重复装载（重定位 / 重开）不是换代：面板不动渲染面，遮罩也不该退场。
    handle.vaultChanged(VAULT);
    assert.equal(closed, afterMount, "同一 vault 重复装载不关遮罩");
    // 切 vault = 内容换代。
    handle.vaultChanged("/tmp/lumir-m634-other-vault");
    assert.equal(closed, afterMount + 1, "切 vault 必须显式关闭面板来源的遮罩");
    // 重载会话（快照重取，如 cron 回滚）= 内容换代。
    handle.reloadSession();
    assert.equal(closed, afterMount + 2, "重载会话必须显式关闭面板来源的遮罩");
  } finally {
    handle.attachTo(null);
  }
});
