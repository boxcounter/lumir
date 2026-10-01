// 标签右键菜单（M254，change tab-strip-context-menu；M300 增定位项）：四条菜单项的**选择逻辑**
// 与菜单 DOM 行为。
//
// 这一层用最小 DOM 替身跑真代码（与 tests/unit/tree-menu.test.ts 同一手法、同一形状的替身——
// 两处各持一份是刻意的：替身只实现各自被碰到的那些 DOM 面，抽公共基类会把两边的测试耦合到
// 同一份「什么都被实现了一点」的假实现上；那条理由逐字见 tree-menu.test.ts 的文件头）。
//
// 覆盖什么：
//   - 项集文案与顺序（对照文案 deck D148–D151 与 D322，逐字）；
//   - 菜单 DOM 行为：打开持焦点与首项游标、↑↓ / ⌃N⌃P 等价导航与钳制、Enter 触发、Esc 与
//     外部点击关闭、关闭后焦点归还（归还的是**会话本体**，由装配层现查那一条标签）；
//   - 三条路径的目标选择（纯函数）：关闭其他 / 关闭右侧的集合与顺序、边界（目标不在列表里）；
//   - 批量关闭的顺序与停手（closeEach）：前一个没答复就不动下一个，false 之后不再调。
// 不覆盖什么：四条项的端到端落点（定位项落在树上、关闭路径落在标签栏上）、脏标签的确认流
// （要真实 toast 与标签栏 DOM）——归 tests/visual/scenes/tab-menu.spec.ts 与真机场景 50，定位
// 项另有 tests/unit/tree-reveal.test.ts（树那一侧的展开 / 滚动 / 当前行）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAB_MENU_LABEL,
  TAB_MENU_REVEAL,
  closeEach,
  closeOtherTargets,
  closeRightTargets,
  createTabContextMenu,
  tabMenuItems,
} from "../../src/tabs.ts";
import type { EditorSession } from "../../src/editor.ts";

interface FakeEvent {
  target?: unknown;
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  clientX?: number;
  clientY?: number;
  defaultPrevented?: boolean;
  preventDefault?(): void;
}

/** 元素替身：只实现被标签菜单代码碰到的那一小撮 DOM 面。 */
class FakeEl {
  readonly tagName: string;
  children: FakeEl[] = [];
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
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
  offsetWidth = 180;
  offsetHeight = 120;
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

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  focus(): void {
    this.focused = true;
  }

  scrollIntoView(): void {}

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 };
  }

  /** 深度优先找类名命中的后代（含自身）。 */
  find(className: string): FakeEl[] {
    const out: FakeEl[] = [];
    if (this.classes.has(className)) out.push(this);
    for (const child of this.children) out.push(...child.find(className));
    return out;
  }

  texts(): string[] {
    const out = this.textContent === "" ? [] : [this.textContent];
    for (const child of this.children) out.push(...child.texts());
    return out;
  }
}

interface FakeDocument {
  fire(type: string, event: FakeEvent): void;
}

function installFakeDocument(): FakeDocument {
  const listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeEl(tag),
    addEventListener: (type: string, listener: (event: FakeEvent) => void) => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
  };
  (globalThis as unknown as Record<string, unknown>).Node = FakeEl;
  return {
    fire: (type, event) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

const keydown = (key: string, over: FakeEvent = {}): FakeEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  preventDefault: () => {},
  ...over,
});

/** 会话替身：菜单只读 `path`（可见性判据）与对象身份，其余字段不参与。 */
function session(path: string | undefined, over: Partial<EditorSession> = {}): EditorSession {
  return { path, dirty: false, ...over } as unknown as EditorSession;
}

function menuRig() {
  const doc = installFakeDocument();
  const mount = new FakeEl("div");
  const selected: Array<{ action: string; session: EditorSession }> = [];
  const focused: EditorSession[] = [];
  const menu = createTabContextMenu({
    mount: mount as unknown as HTMLElement,
    onSelect: (action, target) => selected.push({ action, session: target }),
    restoreFocus: (target) => focused.push(target),
  });
  return { doc, mount, menu, selected, focused, element: menu.element() as unknown as FakeEl };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// 项集与文案（deck D148–D151 + D322）
// ---------------------------------------------------------------------------

test("项集：四项、顺序固定、文案逐字（deck D322 + D148–D151）", () => {
  assert.equal(TAB_MENU_LABEL(), "标签操作");
  // 定位项在首位（M300）：单测环境的界面语言钉在 zh，因此它是中文列；三条关闭项是上屏列
  // 锁定条目（M257 裁决），无论界面语言都取 English 列。
  assert.equal(TAB_MENU_REVEAL(), "在左栏中定位到此文件");
  assert.deepEqual(tabMenuItems(), [
    { action: "reveal-in-tree", label: "在左栏中定位到此文件" },
    { action: "close", label: "Close" },
    { action: "close-others", label: "Close Other Tabs" },
    { action: "close-right", label: "Close Tabs to the Right" },
  ]);
});

// ---------------------------------------------------------------------------
// 菜单 DOM 行为
// ---------------------------------------------------------------------------

test("打开菜单：四项在场、持焦点、游标落首项、皮肤类两处共用", () => {
  const rig = menuRig();
  const target = session("a.md");
  rig.menu.open(target, { x: 40, y: 60 });

  assert.equal(rig.menu.isOpen(), true);
  assert.equal(rig.element.hidden, false);
  assert.equal(rig.element.getAttribute("role"), "menu");
  assert.equal(rig.element.getAttribute("aria-label"), TAB_MENU_LABEL());
  assert.equal(rig.element.focused, true, "打开即持焦点");
  // 只有语义类 `.tab-menu`：皮肤来自 style.css 的 `.ft-menu, .tab-menu` 选择器对，带上
  // `ft-menu` 会让两份菜单同时命中那个选择器（树菜单的断言随即变成 strict violation——实测）。
  assert.equal(rig.element.classList.contains("tab-menu"), true);
  assert.equal(rig.element.classList.contains("ft-menu"), false, "MUST NOT 带树菜单的类名");
  const labels = rig.element.texts();
  assert.deepEqual(labels, [
    "在左栏中定位到此文件",
    "Close",
    "Close Other Tabs",
    "Close Tabs to the Right",
  ]);
  const items = rig.element.find("ft-menu-item");
  assert.equal(items.length, 4);
  assert.equal(items[0].classList.contains("is-active"), true, "打开即把游标放在首项");
  assert.equal(rig.element.getAttribute("aria-activedescendant"), items[0].id);
  // 菜单里 MUST NOT 出现分隔线（标签菜单没有分组）
  assert.equal(rig.element.find("ft-menu-sep").length, 0);
  rig.menu.close();
});

test("键盘：↓ / ⌃N 等价前进、↑ / ⌃P 等价回退且钳制，Enter 触发游标那一项", () => {
  const rig = menuRig();
  const target = session("a.md");
  rig.menu.open(target, { x: 0, y: 0 });

  rig.element.fire("keydown", keydown("ArrowDown"));
  rig.element.fire("keydown", keydown("ArrowUp"));
  // 回退到首项后再 ↑ 仍是首项（钳制，不回卷）
  rig.element.fire("keydown", keydown("ArrowUp"));
  const items = rig.element.find("ft-menu-item");
  assert.equal(items[0].classList.contains("is-active"), true);
  assert.equal(rig.element.getAttribute("aria-activedescendant"), items[0].id);

  // ⌃N 与 ↓ 落点相同：一次 ⌃N 到第二项
  rig.element.fire("keydown", keydown("n", { ctrlKey: true }));
  assert.equal(items[1].classList.contains("is-active"), true);
  // 越界钳制在末项（M300 起共四项，末项仍是 Close Tabs to the Right）
  rig.element.fire("keydown", keydown("n", { ctrlKey: true }));
  rig.element.fire("keydown", keydown("n", { ctrlKey: true }));
  rig.element.fire("keydown", keydown("n", { ctrlKey: true }));
  assert.equal(items[3].classList.contains("is-active"), true, "末项不再前进");

  rig.element.fire("keydown", keydown("Enter"));
  assert.deepEqual(
    rig.selected.map((entry) => entry.action),
    ["close-right"],
  );
  // 触发即收起，且请求带的是会话本体（装配层据此现查那一条标签）
  assert.equal(rig.selected[0].session, target);
  assert.equal(rig.menu.isOpen(), false);
});

test("定位项：打开即落首项，回车直接派发 reveal-in-tree（带右键那一条会话）", () => {
  const rig = menuRig();
  // 用嵌套路径：定位的落点在树上（同一层只关心「派发的是哪一条会话、什么动作」）
  const target = session("a/b/c.md");
  rig.menu.open(target, { x: 0, y: 0 });

  const items = rig.element.find("ft-menu-item");
  assert.equal(items[0].textContent, TAB_MENU_REVEAL(), "首项即定位项");
  assert.equal(items[0].classList.contains("is-active"), true);
  rig.element.fire("keydown", keydown("Enter"));

  assert.deepEqual(
    rig.selected.map((entry) => entry.action),
    ["reveal-in-tree"],
  );
  assert.equal(rig.selected[0].session, target);
  assert.equal(rig.menu.isOpen(), false, "触发即收起");
  assert.deepEqual(rig.focused, [target], "关闭后焦点仍归还触发它的那一条标签");
});

test("Esc 关闭并归还焦点；外部点击关闭但不抢焦点", () => {
  const rig = menuRig();
  const target = session("a.md");

  rig.menu.open(target, { x: 0, y: 0 });
  rig.element.fire("keydown", keydown("Escape"));
  assert.equal(rig.menu.isOpen(), false);
  assert.equal(rig.element.hidden, true);
  assert.deepEqual(rig.focused, [target], "Esc 关闭要让焦点回到触发它的标签");

  // 外部点击：焦点不归还（用户点去别处了，抢回来是错的）
  rig.menu.open(session("b.md"), { x: 0, y: 0 });
  rig.doc.fire("mousedown", { target: new FakeEl("div") });
  assert.equal(rig.menu.isOpen(), false);
  assert.equal(rig.focused.length, 1, "外部点击路径 MUST NOT 再归还一次焦点");
});

test("关闭后菜单清空：再次 Enter 不产生第二次请求", () => {
  const rig = menuRig();
  rig.menu.open(session("a.md"), { x: 0, y: 0 });
  rig.element.fire("keydown", keydown("Enter"));
  assert.equal(rig.selected.length, 1);
  rig.element.fire("keydown", keydown("Enter"));
  assert.equal(rig.selected.length, 1, "收起后 items 已清空，Enter 是空动作");
  assert.equal(rig.element.children.length, 0);
});

// ---------------------------------------------------------------------------
// 三条路径的目标选择（纯函数）
// ---------------------------------------------------------------------------

test("关闭其他标签：除目标以外的全部可见标签，按打开顺序", () => {
  const a = session("a.md");
  const b = session("b.md");
  const c = session("c.md");
  const blank = session(undefined); // 没有路径的会话不是标签（空态）
  assert.deepEqual(closeOtherTargets([blank, a, b, c], b), [a, c]);
  assert.deepEqual(closeOtherTargets([a], a), []);
  // 目标不在列表里（已被别处关掉）时同样是「关掉其余全部」——不做特殊分支
  assert.deepEqual(closeOtherTargets([a, b], c), [a, b]);
});

test("关闭右侧标签：严格右侧、按打开顺序、目标缺席即空集", () => {
  const a = session("a.md");
  const b = session("b.md");
  const c = session("c.md");
  const blank = session(undefined);
  assert.deepEqual(closeRightTargets([a, blank, b, c], b), [c]);
  assert.deepEqual(closeRightTargets([a, b, c], a), [b, c]);
  assert.deepEqual(closeRightTargets([a, b, c], c), [], "最右一条没有右侧");
  assert.deepEqual(closeRightTargets([a, b], session("z.md")), []);
});

// ---------------------------------------------------------------------------
// 批量关闭的顺序与停手
// ---------------------------------------------------------------------------

test("closeEach：顺序等待——前一个没答复就不动下一个", async () => {
  const calls: string[] = [];
  const gates: Array<(closed: boolean) => void> = [];
  const targets = [session("a.md"), session("b.md"), session("c.md")];

  const running = closeEach(targets, (target) => {
    calls.push(target.path as string);
    return new Promise<boolean>((resolve) => gates.push(resolve));
  });

  assert.deepEqual(calls, ["a.md"], "第二个必须等第一个的答复");
  gates[0](true);
  await flush();
  assert.deepEqual(calls, ["a.md", "b.md"]);
  gates[1](false);
  await running;
  assert.deepEqual(calls, ["a.md", "b.md"], "停手之后 MUST NOT 再调第三个");
  assert.equal(gates.length, 2);
});

test("closeEach：空目标集是空动作（关右侧没有标签时不报错）", async () => {
  let called = 0;
  await closeEach([], async () => {
    called += 1;
    return true;
  });
  assert.equal(called, 0);
});
