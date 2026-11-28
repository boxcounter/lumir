// 标签条与「活跃 pane」的接线（M329，Alex 2026-10-05 dogfood bug 1）。
//
// 缺陷：点击**非活跃 pane** 的标签不装载文件内容，要先点一下 pane 正文把它激活才装载。
//
// 不变量（本文件钉住的条款）：**标签条上的交互（点标签 / 点关闭钮）必须先让该标签条所属的
// pane 成为活跃 pane，再跑表现层同步点**。会话内容装载挂在同步点（`syncActiveDocument` →
// `ensureActiveSessionLoaded`）上，而同步点按**活跃 pane** 的前台文档解析——pane 没先翻过去，
// 同步点解到的是另一个 pane 的会话，被点的那个标签因此永远等不到装载。
//
// 为什么这一层能测：`createTabs` 不碰真实编辑器（`editor` 是注入的句柄）也不碰真实 DOM 语义
// （只用 createElement / addEventListener 这一小撮），因此最小 DOM 替身能驱动它——与
// `tests/unit/tab-menu.test.ts` 同一手法（两处各持一份替身是刻意的，理由见那边的文件头）。
//
// 覆盖什么：点击路径与关闭路径都先调「激活所属 pane」的注入回调，且**先于**同步点；
// 已经是前台会话时（只重绘那条早退分支）同样先激活 pane。
// 不覆盖什么：真实装载（要真编辑器 + IPC，归 tests/visual 的 m320 与真机场景 79/80）。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { createTabs } from "../../src/tabs.ts";
import type { TabsDeps, TabsHandle } from "../../src/tabs.ts";
import type { EditorHandle, EditorSession } from "../../src/editor.ts";
import { NAVIGATION_HIGHLIGHT_MS } from "../../src/navigation-highlight.ts";
import { t } from "../../src/copy.ts";

interface FakeEvent {
  target?: unknown;
  key?: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  clientX?: number;
  clientY?: number;
  preventDefault?(): void;
  stopPropagation?(): void;
}

/** 元素替身：只实现标签条渲染与交互碰到的那一小撮 DOM 面。 */
class FakeEl {
  readonly tagName: string;
  children: FakeEl[] = [];
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
    toggle: (name: string, force?: boolean) =>
      void (force === false ? this.classes.delete(name) : this.classes.add(name)),
    contains: (name: string) => this.classes.has(name),
  };

  get className(): string {
    return [...this.classes].join(" ");
  }

  set className(value: string) {
    this.classes.clear();
    for (const name of value.split(/\s+/).filter(Boolean)) this.classes.add(name);
  }

  textContent = "";
  title = "";
  type = "";
  id = "";
  hidden = false;
  tabIndex = 0;
  /** 菜单浮层的定位读数（tabMenu 的 place() 会读它们并写 style.left / top）。 */
  offsetWidth = 180;
  offsetHeight = 120;
  readonly style: Record<string, string> = {};
  /** `renderTabs` 的早退门（M316：标签槽被摘除后不再重绘）；测试里恒为已连接。 */
  isConnected = true;
  scrollLeft = 0;
  clientWidth = 0;
  clientLeft = 0;
  focused = false;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  createElement(tagName: string): FakeEl {
    return new FakeEl(tagName);
  }

  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeEl[]): void {
    this.children = nodes;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((entry) => entry !== listener));
  }

  fire(type: string, event: FakeEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** `ensureActiveVisible` 的查询：本层不测滚动，恒返回 null 让它早退。 */
  querySelector(): FakeEl | null {
    return null;
  }

  /** 焦点归还的路径查询（`focusTab` → `tabOpenElement`）：本层不测焦点落点（归浏览器层），
   *  返回空表让它落空、不误报。 */
  querySelectorAll(): FakeEl[] {
    return [];
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 };
  }

  focus(): void {
    this.focused = true;
  }

  scrollIntoView(): void {}

  /** 深度优先找类名命中的后代（含自身）。 */
  find(className: string): FakeEl[] {
    const out: FakeEl[] = [];
    if (this.classes.has(className)) out.push(this);
    for (const child of this.children) out.push(...child.find(className));
    return out;
  }
}

interface FakeEnv {
  window: FakeEl;
  document: FakeEl & { hidden: boolean };
}

function installFakeDocument(existing?: FakeEnv): FakeEnv {
  const env: FakeEnv = existing ?? {
    window: new FakeEl("window"),
    document: Object.assign(new FakeEl("document"), { hidden: false }),
  };
  (globalThis as unknown as Record<string, unknown>).window = env.window;
  (globalThis as unknown as Record<string, unknown>).document = env.document;
  (globalThis as unknown as Record<string, unknown>).Node = FakeEl;
  return env;
}

/** 会话替身：标签条只读 `path` / `dirty` / `kind` 与对象身份。`kind` 缺省 `"doc"`——
 *  缺了它 `isDocSession` 会把替身当成图片会话（判据的默认回答是「不是文档」）。 */
function session(path: string | undefined, over: Partial<EditorSession> = {}): EditorSession {
  return { id: 1, kind: "doc", path, dirty: false, loaded: true, ...over } as unknown as EditorSession;
}

interface Rig {
  tabs: TabsHandle;
  mount: FakeEl;
  env: FakeEnv;
  /** 菜单挂点（标签菜单挂在这里，项元素从这里找）。 */
  overlay: FakeEl;
  /** 调用序（只记本用例关心的那几条装配回调）。 */
  order: string[];
  /** 每次 toast 的入参（「关闭全部标签」要用它答复既有确认流）。 */
  toasts: Array<{
    text: string;
    actions: Array<{ label: string; run(): void }>;
    sticky?: boolean;
    onDismiss?: () => void;
  }>;
  /** 被真正关掉的会话路径（按关闭顺序）。 */
  closed: string[];
  /** focusEditor 被调用的次数。 */
  focusEditorCalls: number;
  editor: {
    sessions: EditorSession[];
    active: EditorSession;
  };
  /** 按路径点开一个标签（触发它自己的 click 监听）。 */
  clickTab(path: string): void;
  /** 点某条的关闭钮。 */
  clickClose(path: string): void;
  /** 右键某条标签（打开菜单）。 */
  openMenu(path: string): void;
  /** 菜单项（按文案取）。 */
  menuItem(label: string): FakeEl;
}

function createRig(
  sessions: EditorSession[],
  active: EditorSession,
  options: { isActivePane?: () => boolean; env?: FakeEnv } = {},
): Rig {
  const env = installFakeDocument(options.env);
  const order: string[] = [];
  const toasts: Rig["toasts"] = [];
  const closed: string[] = [];
  const counters = { focusEditor: 0 };
  const editorState = { sessions, active };
  const fakeEditor = {
    sessions: () => editorState.sessions,
    activeSession: () => editorState.active,
    activateSession: (target: EditorSession) => {
      order.push("activateSession");
      editorState.active = target;
    },
    closeSession: (target: EditorSession) => {
      order.push("closeSession");
      closed.push(target.path as string);
      editorState.sessions = editorState.sessions.filter((entry) => entry !== target);
    },
    view: { requestMeasure: () => {} },
  } as unknown as EditorHandle;

  const mount = new FakeEl("nav");
  const overlay = new FakeEl("div");
  const strip = {
    editor: fakeEditor,
    mount: mount as unknown as HTMLElement,
    overlayMount: overlay as unknown as HTMLElement,
    toast: (
      text: string,
      actions: Array<{ label: string; run(): void }>,
      sticky?: boolean,
      onDismiss?: () => void,
    ) => {
      order.push("toast");
      toasts.push({ text, actions, sticky, onDismiss });
    },
    saveCurrent: async () => {},
    forgetBackup: () => {},
    isBackupFailed: () => false,
    invalidateResolve: () => {},
    showEditor: () => {},
    syncActiveDocument: () => order.push("syncActiveDocument"),
    focusEditor: () => {
      counters.focusEditor += 1;
      order.push("focusEditor");
    },
    revealInTree: () => {},
    activatePane: () => order.push("activatePane"),
    isActivePane: options.isActivePane ?? (() => true),
  } as unknown as TabsDeps;

  const tabs = createTabs(strip);
  tabs.renderTabs();

  const tabEl = (path: string): FakeEl => {
    const found = mount.children.find((child) => child.dataset.path === path);
    assert.ok(found, `没有找到路径为 ${path} 的标签元素`);
    return found;
  };
  return {
    tabs,
    mount,
    env,
    overlay,
    order,
    toasts,
    closed,
    get focusEditorCalls() {
      return counters.focusEditor;
    },
    editor: editorState,
    clickTab: (path) => tabEl(path).fire("click"),
    clickClose: (path) => {
      const close = tabEl(path).find("tab-close")[0];
      assert.ok(close, "标签里没有关闭钮");
      close.fire("click", { stopPropagation: () => {} });
    },
    openMenu: (path) => {
      tabEl(path).fire("contextmenu", {
        clientX: 10,
        clientY: 20,
        preventDefault: () => {},
      });
    },
    menuItem: (label) => {
      const found = overlay.find("ft-menu-item").find((item) => item.textContent === label);
      assert.ok(found, `菜单里没有「${label}」项`);
      return found;
    },
  };
}

test("点击非活跃 pane 的标签：先激活所属 pane，再跑同步点（bug 1 的不变量）", () => {
  const a = session("a.md");
  const b = session("b.md");
  // 本 rig 模拟「pane 2 的标签条」：其前台是 b，但活跃 pane（装配层的指针，这里由
  // activatePane 回调表达）还没翻到它——点 a 时必须先翻 pane。
  const rig = createRig([a, b], b);

  rig.clickTab("a.md");

  assert.equal(rig.order[0], "activatePane", "标签点击 MUST 先让所属 pane 成为活跃 pane");
  assert.deepEqual(
    rig.order,
    ["activatePane", "activateSession", "syncActiveDocument"],
    "顺序：激活 pane → 切会话 → 跑同步点（装载挂在同步点上，按活跃 pane 解析前台）",
  );
});

test("点击已在前台的标签：同样先激活所属 pane（重绘早退分支不吞掉激活）", () => {
  const a = session("a.md");
  const rig = createRig([a], a);

  rig.clickTab("a.md");

  assert.deepEqual(
    rig.order,
    ["activatePane", "syncActiveDocument"],
    "已是前台时不切会话，但仍要让所属 pane 活跃并重绘",
  );
});

test("点关闭钮：同样先激活所属 pane（点 / 关都是该 pane 标签条的交互）", () => {
  const a = session("a.md");
  const b = session("b.md");
  const rig = createRig([a, b], b);

  rig.clickClose("a.md");

  assert.equal(rig.order[0], "activatePane", "关闭钮点击 MUST 先让所属 pane 成为活跃 pane");
  assert.ok(rig.order.includes("closeSession"), "干净标签直接关掉");
  assert.ok(rig.order.includes("syncActiveDocument"), "关闭后仍跑一次同步点");
});

test("图片会话（M629）：关闭不弹保存确认、不调保存链路（即使被置脏）", () => {
  // 生产中图片会话恒 clean（结构性只读、没有落盘基准）；这里人为置脏，把「万一有 dirty 的
  // 图片会话」这条形态造出来。判据（`isDocSession`）若被删掉，resolveClose 会走
  // showCloseConfirm：先弹 sticky 确认、用户不答复就不关——下面两条断言因此都有区分度。
  const shot = session("shot.png", { kind: "image", dirty: true });
  const doc = session("a.md");
  const rig = createRig([shot, doc], shot);

  rig.clickClose("shot.png");

  assert.equal(rig.order.includes("toast"), false, "图片标签 MUST NOT 弹「有未保存修改」确认");
  assert.ok(rig.order.includes("closeSession"), "图片标签直接关掉（恒无未保存内容）");
  assert.ok(rig.order.includes("syncActiveDocument"), "关闭后仍跑一次同步点");
});

test("vault 外只读标签（M660 #7）：可见侧是 aria-hidden 的锁形图标，可见文字不再带「只读」", () => {
  // Alex 2026-10-24：「现在 TAB 上显示 read-only，但区分度不够，是否有其他图像化表达，比如
  // TAB 上能改为一个小图标」。判据三层：① 图标在场且 aria-hidden（图形只做可见标记，不进
  // 读屏树）；② 可见文字只剩文件名（旧的 D578 文字后缀退场）；③ 可访问名仍是 D579——
  // 「只读」这件事对读屏用户零损失。负向对照钉住判据是 `session.external`，不是「所有标签」。
  const ext = session("/tmp/draft.md", { external: true });
  const inner = session("a.md");
  const rig = createRig([ext, inner], ext);

  const tabOf = (path: string): FakeEl => {
    const found = rig.mount.children.find((child) => child.dataset.path === path);
    assert.ok(found, `没有找到路径为 ${path} 的标签元素`);
    return found;
  };

  const extTab = tabOf("/tmp/draft.md");
  const lock = extTab.find("tab-readonly");
  assert.equal(lock.length, 1, "只读标签 MUST 带一枚锁形图标");
  assert.equal(lock[0].getAttribute("aria-hidden"), "true", "图标不进读屏树（语义由 aria-label 承担）");
  assert.equal(extTab.find("tab-name")[0].textContent, "draft.md", "可见文字只剩文件名");
  assert.equal(
    extTab.find("tab-open")[0].getAttribute("aria-label"),
    t("D579", { name: "draft.md" }),
    "读屏名仍是 D579（{名称}（vault 外只读））",
  );
  assert.equal(tabOf("a.md").find("tab-readonly").length, 0, "vault 内标签没有这枚图标");
});

// ---------------------------------------------------------------------------
// 「关闭全部标签」（change close-all-tabs-nov21）
//
// 三条性质在这里钉住（端到端落点与真实确认浮条归 tests/visual/scenes/tab-menu.spec.ts）：
//   ① 目标 = 本 pane 全部可见标签、按打开顺序，动作先从菜单项进到 closeEach；
//   ② 脏标签走 closeTab 的同一条 sticky 确认（文本 D92、三出口齐全），用户没答复之前
//      后面的标签一个都不动；取消即停手，已关闭的不回滚；
//   ③ 全部关完之后焦点交给编辑器（没有标签可归还），中途停手时 MUST NOT 抢焦点。
// ---------------------------------------------------------------------------

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("关闭全部标签：全 clean——按打开顺序关完、焦点交给空工作区主操作", async () => {
  const a = session("a.md");
  const b = session("b.md");
  const c = session("c.md");
  const rig = createRig([a, b, c], c);

  rig.openMenu("b.md");
  rig.menuItem("Close All Tabs").fire("click");
  await flush();

  assert.deepEqual(rig.closed, ["a.md", "b.md", "c.md"], "按打开顺序逐个关，右键那一条也在内");
  assert.equal(rig.editor.sessions.length, 0);
  assert.equal(rig.focusEditorCalls, 1, "全关完之后焦点交给空工作区主操作（装配层按有没有标签解析）");
  assert.equal(rig.order[0], "activatePane", "菜单动作是这条标签条的交互 ⇒ 先让该 pane 变活跃");
  assert.equal(rig.toasts.length, 0, "全 clean 不弹任何确认");
});

test("关闭全部标签：多个 dirty——逐个弹既有确认；取消停手、已关闭的不回滚；放弃后继续到关完", async () => {
  const a = session("a.md");
  const b = session("b.md", { dirty: true });
  const c = session("c.md", { dirty: true });
  const rig = createRig([a, b, c], a);

  rig.openMenu("c.md");
  rig.menuItem("Close All Tabs").fire("click");
  await flush();

  // 第一个目标的答复落地之前，后面的标签一个都不动；脏标签的确认就是既有那条 D92。
  assert.deepEqual(rig.closed, ["a.md"], "干净的第一条先关掉（顺序处理，不等后面的确认）");
  assert.equal(rig.toasts.length, 1, "同一时刻只有一条确认浮条");
  assert.equal(rig.toasts[0].text, t("D92", { path: "b.md" }));
  assert.deepEqual(
    rig.toasts[0].actions.map((action) => action.label),
    [t("D93.1"), t("D93.2"), t("D93.3")],
    "复用 M149 的三个出口（保存并关闭 / 放弃修改并关闭 / 取消）",
  );
  assert.equal(rig.toasts[0].sticky, true);
  assert.equal(rig.focusEditorCalls, 0, "用户还没答复：批量还没收尾，MUST NOT 提前动焦点");

  // 出口三「取消」：批量停手，b 与尚未处理的 c 都留下；已关掉的 a 不回滚。
  rig.toasts[0].actions[2].run();
  await flush();
  assert.deepEqual(rig.closed, ["a.md"]);
  assert.deepEqual(rig.editor.sessions, [b, c]);
  // 停手也要归还焦点：确认按钮随浮条移除后浏览器会把焦点送回 body（review r1 P2-1）。
  // 这里只证明「收尾路径调了 focusEditor」——真实 activeElement 的判据在浏览器层
  // （tests/visual/scenes/tab-menu.spec.ts 的 expectEditorActive）。
  assert.equal(rig.focusEditorCalls, 1, "停手时焦点交给前台入口（有标签 → 正文）");

  // 再来一次并选「放弃修改并关闭」：b 关掉之后批量继续，c 也走它自己的确认。
  rig.openMenu("b.md");
  rig.menuItem("Close All Tabs").fire("click");
  await flush();
  assert.equal(rig.toasts.length, 2);
  assert.equal(rig.toasts[1].text, t("D92", { path: "b.md" }));
  rig.toasts[1].actions[1].run();
  await flush();

  // c 是脏的：批量必须再问它一次，而不是「用户已经答过一次」就静默丢弃。
  assert.deepEqual(rig.closed, ["a.md", "b.md"]);
  assert.equal(rig.toasts.length, 3);
  assert.equal(rig.toasts[2].text, t("D92", { path: "c.md" }));
  assert.equal(rig.focusEditorCalls, 1, "批量还没收尾：MUST NOT 提前再动一次焦点");

  rig.toasts[2].actions[1].run();
  await flush();
  assert.deepEqual(rig.closed, ["a.md", "b.md", "c.md"]);
  assert.equal(rig.focusEditorCalls, 2, "全关完同样收尾一次（前台是空工作区主操作）");
});

// ---------------------------------------------------------------------------
// 标签的短暂导航高亮（change harness-path-link-keep-position-nov23）
//
// 判据分三层：① 按**会话对象**记账（不是只在 DOM 上挂 class）——全量重建后同一会话的
// 新标签仍带 class；② 同一时刻至多一个标签闪烁、重复命中重置计时；③ 生命周期——会话关闭、
// 计时结束、`dispose()`、计时到点时槽已卸载，都不留 class / 计时器 / 指向已销毁节点的状态。
// 浏览器层的视觉与几何判据在 `tests/visual/scenes/harness-path-link-keep-position-nov23.spec.ts`；
// 这一层只判记账与清理（FakeEl 面够用，真实计时用 node:test 的 mock timers 推进）。
// ---------------------------------------------------------------------------

const tabOf = (rig: Rig, path: string): FakeEl => {
  const found = rig.mount.children.find((child) => child.dataset.path === path);
  assert.ok(found, `没有找到路径为 ${path} 的标签元素`);
  return found;
};

const flashingPaths = (rig: Rig): string[] =>
  rig.mount.children.filter((child) => child.classes.has("is-flash")).map((child) => child.dataset.path);

test("flash：立刻给目标标签 is-flash，NAVIGATION_HIGHLIGHT_MS 后消退；其它标签不受影响", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const a = session("a.md");
    const b = session("b.md");
    const rig = createRig([a, b], a);

    rig.tabs.flash(b);
    assert.deepEqual(flashingPaths(rig), ["b.md"], "只有被点的那一条闪");
    assert.equal(tabOf(rig, "b.md").classes.has("is-active"), false, "闪烁不是激活态");

    mock.timers.tick(NAVIGATION_HIGHLIGHT_MS - 1);
    assert.deepEqual(flashingPaths(rig), ["b.md"], "计时未到：高亮仍在");

    mock.timers.tick(1);
    assert.deepEqual(flashingPaths(rig), [], "到点后消退");
  } finally {
    mock.timers.reset();
  }
});

test("flash：同一标签再次命中重置消退计时，不叠加第二层", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const a = session("a.md");
    const b = session("b.md");
    const rig = createRig([a, b], a);

    rig.tabs.flash(b);
    mock.timers.tick(1000);
    rig.tabs.flash(b);
    mock.timers.tick(500);
    assert.deepEqual(flashingPaths(rig), ["b.md"], "距首次点击已 1.5s，但计时从第二次命中重新起算");
    mock.timers.tick(NAVIGATION_HIGHLIGHT_MS - 500);
    assert.deepEqual(flashingPaths(rig), [], "第二次命中后满 1.4s 才消退");
  } finally {
    mock.timers.reset();
  }
});

test("flash：命中另一个标签时整块换过去（同一时刻至多一个）", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const a = session("a.md");
    const b = session("b.md");
    const rig = createRig([a, b], a);

    rig.tabs.flash(a);
    rig.tabs.flash(b);
    assert.deepEqual(flashingPaths(rig), ["b.md"], "旧标签的 class 被清掉，只剩新的那一条");
    mock.timers.tick(NAVIGATION_HIGHLIGHT_MS);
    assert.deepEqual(flashingPaths(rig), [], "旧计时器不会提前 / 重复清理新状态");
  } finally {
    mock.timers.reset();
  }
});

test("flash：全量重建时按会话对象重新施加，消退计时继续有效", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const a = session("a.md");
    const b = session("b.md");
    const rig = createRig([a, b], a);

    rig.tabs.flash(b);
    mock.timers.tick(600);
    // 触发一次全量重建（生产中由 dirty 跃迁 / 同步点调用）：DOM 是新的，状态仍按会话记账。
    rig.editor.sessions = [a, b];
    rig.tabs.renderTabs();
    assert.deepEqual(flashingPaths(rig), ["b.md"], "重建后新 DOM 仍带 is-flash");

    mock.timers.tick(NAVIGATION_HIGHLIGHT_MS - 600);
    assert.deepEqual(flashingPaths(rig), [], "计时没有被重建重置 / 打断");
  } finally {
    mock.timers.reset();
  }
});

/** 计时器清理 spy：mock.timers 已接管全局计时器，这里再包一层只做**记账**——
 *  记录「本测试安排过、随后被 clearTimeout 撤销」的 id，仍把调用转给 mock.timers。
 *  用它证明关闭 / dispose 是**立即**撤销旧计时器，而不是等 1.4s 到点由回调清场。 */
function installClearSpy(): { cleared: unknown[]; restore(): void } {
  const scheduled = new Set<unknown>();
  const cleared: unknown[] = [];
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const id = originalSetTimeout(...args);
    scheduled.add(id);
    return id;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((id: unknown) => {
    if (scheduled.delete(id)) cleared.push(id);
    return (originalClearTimeout as unknown as (value: unknown) => void)(id);
  }) as typeof globalThis.clearTimeout;
  return {
    cleared,
    restore() {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    },
  };
}

test("flash：关闭被闪烁的会话立即清理计时器；关闭别的会话不动它", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const clearSpy = installClearSpy();
  try {
    const a = session("a.md");
    const b = session("b.md");
    const rig = createRig([a, b], a);

    rig.tabs.flash(b);
    rig.clickClose("a.md");
    assert.deepEqual(flashingPaths(rig), ["b.md"], "关闭其它标签不清闪烁");

    rig.clickClose("b.md");
    assert.deepEqual(flashingPaths(rig), [], "关闭被闪烁的会话：class 随 DOM 消失");
    // 关闭路径 MUST 立即撤销旧计时器——不能等 1.4s 后由它自然到点清场。
    // （class 由 clearFlash 直接摘；若只摘 class 而留计时器，这里没有 clearTimeout 记录。）
    assert.ok(
      clearSpy.cleared.length >= 1,
      "关闭被闪会话时 MUST clearTimeout（旧计时器不得留到 1.4s 后）",
    );
    mock.timers.tick(NAVIGATION_HIGHLIGHT_MS);
    rig.tabs.renderTabs();
    assert.deepEqual(flashingPaths(rig), [], "计时推进后同样不留 class");
  } finally {
    clearSpy.restore();
    mock.timers.reset();
  }
});

test("dispose：在计时推进前就清 flashed 与旧计时器（只摘 class 的退化实现必红）", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const clearSpy = installClearSpy();
  try {
    const a = session("a.md");
    const rig = createRig([a], a);

    rig.tabs.flash(a);
    assert.deepEqual(flashingPaths(rig), ["a.md"]);

    rig.tabs.dispose();
    assert.deepEqual(flashingPaths(rig), [], "dispose 后不得留 class");

    // 立即重建、且会话仍在（不是靠「会话已不在」的安全网）：若 dispose 只摘 class 而留下
    // `flashed`，renderTabs 会把 class 重新挂上——这一格就是退化实现的判红点。
    rig.tabs.renderTabs();
    assert.deepEqual(flashingPaths(rig), [], "dispose MUST 立即清 flashed（重建不得复活）");

    // 旧计时器必须已被撤销，而不是等 1.4s 到点后自行清场。
    assert.ok(
      clearSpy.cleared.length >= 1,
      "dispose MUST clearTimeout（旧计时器不得留到 1.4s 后）",
    );

    mock.timers.tick(NAVIGATION_HIGHLIGHT_MS);
    rig.tabs.renderTabs();
    assert.deepEqual(flashingPaths(rig), [], "计时推进后同样不留 class");
  } finally {
    clearSpy.restore();
    mock.timers.reset();
  }
});

test("计时到点时标签槽已卸载：先清状态再返回，之后的 renderTabs 不得重新施加", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const a = session("a.md");
    const rig = createRig([a], a);

    rig.tabs.flash(a);
    // 模拟槽被摘除（DOM 没了），但 dispose 还没跑到——计时回调必须自己把状态清干净。
    rig.mount.replaceChildren();
    mock.timers.tick(NAVIGATION_HIGHLIGHT_MS);
    rig.tabs.renderTabs();
    assert.deepEqual(flashingPaths(rig), [], "回调只 return 不清状态时，这里会把 class 重新挂上（判红）");
  } finally {
    mock.timers.reset();
  }
});


// ---------------------------------------------------------------------------
// 按住 Command 的动态序号（change add-tab-dynamic-numbering-nov27）
// ---------------------------------------------------------------------------

const commandIndexes = (rig: Rig): string[] =>
  rig.mount.find("tab-cmd-index").map((el) => el.textContent);

const metaEvent = (code: string): FakeEvent => ({ key: "Meta", code, metaKey: true });

test("Command 序号：左右 Meta 均显示 1–9，重复事件幂等，第 10 个起无号且不消费事件", () => {
  const sessions = Array.from({ length: 12 }, (_, index) => session(`tab-${index + 1}.md`));
  const rig = createRig(sessions, sessions[0]);
  let prevented = 0;
  let stopped = 0;
  const event = {
    ...metaEvent("MetaLeft"),
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  };

  assert.deepEqual(commandIndexes(rig), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.equal(rig.mount.classes.has("is-cmd-held"), false, "空闲态序号被 CSS 隐藏");
  rig.env.window.fire("keydown", event);
  rig.env.window.fire("keydown", event);
  assert.equal(rig.mount.classes.has("is-cmd-held"), true);
  assert.deepEqual(commandIndexes(rig), ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  assert.equal(rig.mount.children[9].find("tab-cmd-index").length, 0, "第 10 个标签没有直达序号");
  for (const index of rig.mount.find("tab-cmd-index")) {
    assert.equal(index.getAttribute("aria-hidden"), "true");
  }
  assert.equal(prevented, 0, "纯展示监听不得 preventDefault");
  assert.equal(stopped, 0, "纯展示监听不得 stopPropagation");

  rig.env.window.fire("keyup", { key: "Meta", code: "MetaLeft", metaKey: false });
  assert.equal(rig.mount.classes.has("is-cmd-held"), false);
  rig.env.window.fire("keydown", metaEvent("MetaRight"));
  assert.equal(rig.mount.classes.has("is-cmd-held"), true, "右侧 Meta 同样成立");
  rig.env.window.fire("keyup", { key: "Meta", code: "MetaRight", metaKey: false });
  assert.equal(rig.mount.classes.has("is-cmd-held"), false);
});

test("Command 序号：双 Meta 时抬起一侧不撤下，两侧都松开才清理", () => {
  const a = session("a.md");
  const rig = createRig([a], a);
  rig.env.window.fire("keydown", metaEvent("MetaLeft"));
  rig.env.window.fire("keydown", metaEvent("MetaRight"));
  rig.env.window.fire("keyup", { key: "Meta", code: "MetaLeft", metaKey: true });
  assert.equal(rig.mount.classes.has("is-cmd-held"), true);
  rig.env.window.fire("keyup", { key: "Meta", code: "MetaRight", metaKey: false });
  assert.equal(rig.mount.classes.has("is-cmd-held"), false);
});

test("Command 序号：blur、页面 hidden 与 dispose 都立即清理；销毁解绑后不复活", () => {
  for (const path of ["blur", "visibility", "dispose"] as const) {
    const a = session(`${path}.md`);
    const rig = createRig([a], a);
    rig.env.window.fire("keydown", metaEvent("MetaLeft"));
    assert.equal(rig.mount.classes.has("is-cmd-held"), true, `${path} 前置：序号已显示`);

    if (path === "blur") rig.env.window.fire("blur");
    else if (path === "visibility") {
      rig.env.document.hidden = true;
      rig.env.document.fire("visibilitychange");
    } else rig.tabs.dispose();

    assert.equal(rig.mount.classes.has("is-cmd-held"), false, `${path} 后立即撤下`);
    rig.env.window.fire("keydown", metaEvent("MetaRight"));
    assert.equal(
      rig.mount.classes.has("is-cmd-held"),
      path !== "dispose",
      path === "dispose" ? "销毁后的监听不得复活" : "blur/hidden 之后可开始一次新的按住",
    );
    if (path === "dispose") {
      assert.equal(rig.env.window.listeners.get("keydown")?.length ?? 0, 0);
      assert.equal(rig.env.window.listeners.get("keyup")?.length ?? 0, 0);
      assert.equal(rig.env.window.listeners.get("blur")?.length ?? 0, 0);
      assert.equal(rig.env.document.listeners.get("visibilitychange")?.length ?? 0, 0);
    }
  }
});

test("Command 序号：按住时重绘与增减标签仍按最新顺序；只读/dirty 的读屏名不含序号", () => {
  const a = session("a.md", { dirty: true });
  const b = session("/tmp/external.md", { external: true });
  const rig = createRig([a, b], a);
  const labels = rig.mount.children.map((tab) => tab.find("tab-open")[0].getAttribute("aria-label"));
  rig.env.window.fire("keydown", metaEvent("MetaLeft"));
  assert.deepEqual(commandIndexes(rig), ["1", "2"]);
  assert.deepEqual(
    rig.mount.children.map((tab) => tab.find("tab-open")[0].getAttribute("aria-label")),
    labels,
    "序号不改既有读屏名",
  );

  const c = session("c.md");
  rig.editor.sessions = [c, a, b];
  rig.tabs.renderTabs();
  assert.deepEqual(commandIndexes(rig), ["1", "2", "3"], "全量重建后从最新会话表取序");
  rig.editor.sessions = [a, b];
  rig.tabs.renderTabs();
  assert.deepEqual(commandIndexes(rig), ["1", "2"]);
});

test("Command 序号：多实例只显示活跃 pane；最后实例销毁解绑且后续 Meta 不复活", () => {
  let activePane = 1;
  const a = session("a.md");
  const b = session("b.md");
  const left = createRig([a], a, { isActivePane: () => activePane === 1 });
  const right = createRig([b], b, { isActivePane: () => activePane === 2, env: left.env });
  assert.equal(left.env.window.listeners.get("keydown")?.length, 1, "同 window 多实例只注册一套输入监听");

  left.env.window.fire("keydown", metaEvent("MetaLeft"));
  assert.equal(left.mount.classes.has("is-cmd-held"), true);
  assert.equal(right.mount.classes.has("is-cmd-held"), false, "非活跃 pane 不得出号");

  activePane = 2;
  left.tabs.renderTabs();
  right.tabs.renderTabs();
  assert.equal(left.mount.classes.has("is-cmd-held"), false);
  assert.equal(right.mount.classes.has("is-cmd-held"), true, "按住期间切换 pane 后只点亮新活跃实例");

  right.tabs.dispose();
  assert.equal(left.env.window.listeners.get("keydown")?.length, 1, "还有实例存活时保留共享输入");
  left.env.window.fire("keyup", { key: "Meta", code: "MetaLeft", metaKey: false });
  assert.equal(left.mount.classes.has("is-cmd-held"), false);
  assert.equal(right.mount.classes.has("is-cmd-held"), false);
  left.tabs.dispose();
  assert.equal(left.env.window.listeners.get("keydown")?.length, 0, "最后一个实例销毁后解绑");
  left.env.window.fire("keydown", metaEvent("MetaRight"));
  assert.equal(left.mount.classes.has("is-cmd-held"), false, "最后销毁后的 Meta 不得复活旧实例");
  assert.equal(right.mount.classes.has("is-cmd-held"), false);
  assert.equal(left.env.window.listeners.get("keydown")?.length ?? 0, 0, "销毁后的 Meta 不得重新注册监听");
});
