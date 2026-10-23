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

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTabs } from "../../src/tabs.ts";
import type { TabsDeps, TabsHandle } from "../../src/tabs.ts";
import type { EditorHandle, EditorSession } from "../../src/editor.ts";
import { t } from "../../src/copy.ts";

interface FakeEvent {
  target?: unknown;
  key?: string;
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
  /** `renderTabs` 的早退门（M316：标签槽被摘除后不再重绘）；测试里恒为已连接。 */
  isConnected = true;
  scrollLeft = 0;
  clientWidth = 0;
  clientLeft = 0;
  focused = false;

  constructor(tagName: string) {
    this.tagName = tagName;
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

  fire(type: string, event: FakeEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** `ensureActiveVisible` 的查询：本层不测滚动，恒返回 null 让它早退。 */
  querySelector(): FakeEl | null {
    return null;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 };
  }

  focus(): void {
    this.focused = true;
  }

  /** 深度优先找类名命中的后代（含自身）。 */
  find(className: string): FakeEl[] {
    const out: FakeEl[] = [];
    if (this.classes.has(className)) out.push(this);
    for (const child of this.children) out.push(...child.find(className));
    return out;
  }
}

function installFakeDocument(): void {
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeEl(tag),
    addEventListener: () => {},
  };
  (globalThis as unknown as Record<string, unknown>).Node = FakeEl;
}

/** 会话替身：标签条只读 `path` / `dirty` / `kind` 与对象身份。`kind` 缺省 `"doc"`——
 *  缺了它 `isDocSession` 会把替身当成图片会话（判据的默认回答是「不是文档」）。 */
function session(path: string | undefined, over: Partial<EditorSession> = {}): EditorSession {
  return { id: 1, kind: "doc", path, dirty: false, loaded: true, ...over } as unknown as EditorSession;
}

interface Rig {
  tabs: TabsHandle;
  mount: FakeEl;
  /** 调用序（只记本用例关心的那几条装配回调）。 */
  order: string[];
  editor: {
    sessions: EditorSession[];
    active: EditorSession;
  };
  /** 按路径点开一个标签（触发它自己的 click 监听）。 */
  clickTab(path: string): void;
  /** 点某条的关闭钮。 */
  clickClose(path: string): void;
}

function createRig(sessions: EditorSession[], active: EditorSession): Rig {
  installFakeDocument();
  const order: string[] = [];
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
      editorState.sessions = editorState.sessions.filter((entry) => entry !== target);
    },
    view: { requestMeasure: () => {} },
  } as unknown as EditorHandle;

  const mount = new FakeEl("nav");
  const strip = {
    editor: fakeEditor,
    mount: mount as unknown as HTMLElement,
    overlayMount: new FakeEl("div") as unknown as HTMLElement,
    toast: () => void order.push("toast"),
    saveCurrent: async () => {},
    forgetBackup: () => {},
    invalidateResolve: () => {},
    showEditor: () => {},
    syncActiveDocument: () => order.push("syncActiveDocument"),
    revealInTree: () => {},
    activatePane: () => order.push("activatePane"),
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
    order,
    editor: editorState,
    clickTab: (path) => tabEl(path).fire("click"),
    clickClose: (path) => {
      const close = tabEl(path).find("tab-close")[0];
      assert.ok(close, "标签里没有关闭钮");
      close.fire("click", { stopPropagation: () => {} });
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
