// 右键菜单浮层与删除确认框的 DOM 行为（M244，change file-tree-context-menu）。
//
// 这一层用最小 DOM 替身跑真代码（与 tests/unit/vault-switcher.test.ts 同一手法、同一形状的
// 替身——两处各持一份是刻意的：替身只实现各自被碰到的那些 DOM 面，抽公共基类会把两边的
// 测试耦合到同一份「什么都被实现了一点」的假实现上）。
//
// 覆盖什么（对照 tasks §3.1 / §3.4）：
//   - 项集按条目类型分流（文件 / 目录两版；破坏性项固定尾部、以分隔线隔开）；
//   - ↑↓ / ⌃N⌃P 导航（等价、钳制）、Enter 触发、Esc 关闭、外部点击关闭；
//   - 关闭后焦点归还触发它的那一行；外部点击路径不抢焦点；
//   - 确认框：初始焦点在「取消」（破坏性动作的安全默认）、Tab 陷阱、Esc / 遮罩取消、
//     确认路径先收起再发请求。
// 不覆盖什么：真实渲染与像素（tests/visual/scenes/tree-menu.spec.ts）、行内联编辑的
// 交互（要真 DOM 的 querySelector / closest——由视觉场景与真机场景 47 覆盖）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_LABEL,
  createConfirmDialog,
  createRenameEchoGuard,
  createTreeContextMenu,
  menuActionsFor,
  menuItemsFor,
} from "../../src/tree-menu.ts";

interface FakeEvent {
  target?: unknown;
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  relatedTarget?: unknown;
  clientX?: number;
  clientY?: number;
  defaultPrevented?: boolean;
  preventDefault?(): void;
}

/** 元素替身：只实现被菜单 / 确认框代码碰到的那一小撮 DOM 面。 */
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
  offsetHeight = 140;
  focused = false;
  value = "";
  placeholder = "";
  autocomplete = "";
  spellcheck = false;

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

/** 触发菜单的条目替身：`value` 是交给菜单的条目、`anchor` 是那一行的行元素替身
 *（替身顶替 HTMLElement，同 vault-switcher 测试的惯例——焦点断言读替身自己的标记）。 */
function target(kind: "file" | "dir", path = "sub/a.md") {
  const anchor = new FakeEl("button");
  const value = {
    path,
    kind,
    name: path.split("/").pop() as string,
    anchor: anchor as unknown as HTMLElement,
  };
  return { value, anchor };
}

function menuRig() {
  const doc = installFakeDocument();
  const mount = new FakeEl("div");
  const selected: Array<{ action: string; path: string }> = [];
  const menu = createTreeContextMenu({
    mount: mount as unknown as HTMLElement,
    onSelect: (action, t) => selected.push({ action, path: t.path }),
  });
  return { doc, mount, menu, selected, element: menu.element() as unknown as FakeEl };
}

// ---------------------------------------------------------------------------
// 项集分流（spec：文件行 / 目录行两套项集）
// ---------------------------------------------------------------------------

test("项集按条目类型分流：文件 4 项、目录 6 项，破坏性项固定尾部", () => {
  assert.deepEqual(menuActionsFor("file"), ["rename", "copy-path", "reveal", "trash"]);
  assert.deepEqual(menuActionsFor("dir"), [
    "new-file",
    "new-dir",
    "rename",
    "copy-path",
    "reveal",
    "trash",
  ]);
  // 分隔线位置：文件 = 通用项 | 破坏性项；目录 = 新建两项 | 通用三项 | 破坏性项。
  const file = menuItemsFor("file");
  assert.equal(file.filter((row) => row === "separator").length, 1);
  assert.equal(file[file.length - 2], "separator", "破坏性项前必须有分隔线");
  const dir = menuItemsFor("dir");
  assert.equal(dir.filter((row) => row === "separator").length, 2);
  // 反向输入（REVIEW.md 第 1 条：断言要有区分度）：目录项集里 MUST NOT 出现文件项集的
  // 全部内容，否则「分流」这条断言等价于恒真。
  assert.notDeepEqual(menuActionsFor("file"), menuActionsFor("dir"));
});

test("打开菜单：渲染对应项集、无新建项（文件）、持焦点、首项为键盘游标", () => {
  const rig = menuRig();
  rig.menu.open(target("file", "note.md").value, { x: 40, y: 60 });
  assert.equal(rig.menu.isOpen(), true);
  assert.equal(rig.element.hidden, false);
  assert.equal(rig.element.getAttribute("role"), "menu");
  assert.equal(rig.element.getAttribute("aria-label"), MENU_LABEL());
  assert.equal(rig.element.focused, true, "打开即持焦点");
  const labels = rig.element.texts();
  assert.ok(labels.includes("重命名…") && labels.includes("移到废纸篓…"), labels.join("|"));
  assert.ok(!labels.includes("新建文件…"), "文件行菜单不得含新建项");
  const items = rig.element.find("ft-menu-item");
  assert.equal(items.length, 4);
  assert.equal(items[0].classList.contains("is-active"), true, "打开即把游标放在首项");
  assert.equal(items[3].classList.contains("is-danger"), true, "破坏性项带 danger 样式");
  assert.equal(rig.element.getAttribute("aria-activedescendant"), items[0].id);
  rig.menu.close();
});

test("目录行打开时有新建项与两条分隔线", () => {
  const rig = menuRig();
  rig.menu.open(target("dir", "sub").value, { x: 10, y: 10 });
  assert.equal(rig.element.find("ft-menu-item").length, 6);
  assert.equal(rig.element.find("ft-menu-sep").length, 2);
  const labels = rig.element.texts();
  assert.ok(labels.includes("新建文件…") && labels.includes("新建子目录…"));
  rig.menu.close();
});

// ---------------------------------------------------------------------------
// 键盘与关闭路径
// ---------------------------------------------------------------------------

test("↑↓ 与 ⌃N⌃P 等价导航并钳制在两端", () => {
  const rig = menuRig();
  rig.menu.open(target("file").value, { x: 0, y: 0 });
  const items = rig.element.find("ft-menu-item");
  const active = () => items.findIndex((item) => item.classList.contains("is-active"));

  rig.element.fire("keydown", keydown("ArrowDown"));
  assert.equal(active(), 1);
  rig.element.fire("keydown", keydown("ArrowDown", { ctrlKey: true, key: "n" }));
  assert.equal(active(), 2, "⌃N 与 ↓ 等价");
  rig.element.fire("keydown", keydown("p", { ctrlKey: true }));
  assert.equal(active(), 1, "⌃P 与 ↑ 等价");
  rig.element.fire("keydown", keydown("ArrowUp"));
  assert.equal(active(), 0);
  rig.element.fire("keydown", keydown("ArrowUp"));
  assert.equal(active(), 0, "顶端钳制");
  for (let i = 0; i < 8; i++) rig.element.fire("keydown", keydown("ArrowDown"));
  assert.equal(active(), items.length - 1, "底端钳制（破坏性项可达）");
  assert.equal(rig.element.getAttribute("aria-activedescendant"), items[items.length - 1].id);
  rig.menu.close();
});

test("Enter 触发当前项：请求带上动作与条目、菜单收起、焦点归还锚点行", () => {
  const rig = menuRig();
  const t = target("file", "sub/a.md");
  rig.menu.open(t.value, { x: 5, y: 5 });
  rig.element.fire("keydown", keydown("ArrowDown"));
  rig.element.fire("keydown", keydown("Enter"));
  assert.deepEqual(rig.selected, [{ action: "copy-path", path: "sub/a.md" }]);
  assert.equal(rig.menu.isOpen(), false);
  assert.equal(rig.element.hidden, true);
  assert.equal(t.anchor.focused, true, "关闭后焦点归还文件树的那一行");
});

test("Esc 关闭且不触发任何动作，焦点同样归还", () => {
  const rig = menuRig();
  const t = target("dir", "sub");
  rig.menu.open(t.value, { x: 5, y: 5 });
  rig.element.fire("keydown", keydown("Escape"));
  assert.deepEqual(rig.selected, []);
  assert.equal(rig.menu.isOpen(), false);
  assert.equal(t.anchor.focused, true);
});

test("点击项触发动作；外部 mousedown 收起但不抢焦点", () => {
  const rig = menuRig();
  const t = target("dir", "sub");
  rig.menu.open(t.value, { x: 5, y: 5 });
  const items = rig.element.find("ft-menu-item");
  items[5].fire("click"); // trash（目录项集的最后一项）
  assert.deepEqual(rig.selected, [{ action: "trash", path: "sub" }]);
  assert.equal(t.anchor.focused, true);

  // 外部点击：焦点归用户点的那个东西，不由我们接管（与 vault 浮层的 close(false) 同口径）
  const t2 = target("file", "b.md");
  rig.menu.open(t2.value, { x: 5, y: 5 });
  rig.doc.fire("mousedown", { target: new FakeEl("div") });
  assert.equal(rig.menu.isOpen(), false);
  assert.equal(t2.anchor.focused, false, "外部点击路径不把焦点拽回树");
});

test("菜单内的 mousedown 不会收起（点击路径必须活到 click）", () => {
  const rig = menuRig();
  rig.menu.open(target("file").value, { x: 5, y: 5 });
  const item = rig.element.find("ft-menu-item")[0];
  rig.doc.fire("mousedown", { target: item });
  assert.equal(rig.menu.isOpen(), true);
  rig.menu.close();
});

// ---------------------------------------------------------------------------
// 删除确认框
// ---------------------------------------------------------------------------

function dialogRig() {
  installFakeDocument();
  const mount = new FakeEl("div");
  const calls: string[] = [];
  let openWhenConfirmed: boolean | undefined;
  const dialog = createConfirmDialog({
    mount: mount as unknown as HTMLElement,
    onConfirm: () => {
      openWhenConfirmed = dialog.isOpen();
      calls.push("confirm");
    },
    restoreFocus: () => calls.push("restore"),
  });
  return {
    dialog,
    calls,
    openWhenConfirmed: () => openWhenConfirmed,
    element: dialog.element() as unknown as FakeEl,
    overlay: mount.children[0],
  };
}

test("确认框：初始焦点在取消（破坏性动作的安全默认），文案按期写入", () => {
  const rig = dialogRig();
  rig.dialog.open({ title: "移到废纸篓？", body: "sub 会连同其中全部内容一起…", confirmLabel: "移到废纸篓", cancelLabel: "取消" });
  assert.equal(rig.dialog.isOpen(), true);
  const texts = rig.element.texts();
  assert.deepEqual(texts, ["移到废纸篓？", "sub 会连同其中全部内容一起…", "取消", "移到废纸篓"]);
  assert.equal(rig.element.getAttribute("role"), "dialog");
  assert.equal(rig.element.getAttribute("aria-modal"), "true");
  assert.equal(rig.element.find("ft-confirm-cancel")[0].focused, true);
  rig.dialog.close();
});

test("确认框：Esc 取消、Tab 陷阱（焦点不跑出模态）", () => {
  const rig = dialogRig();
  rig.dialog.open({ title: "t", body: "b", confirmLabel: "ok", cancelLabel: "cancel" });
  const tab = keydown("Tab");
  let escaped = false;
  tab.preventDefault = () => {
    escaped = true;
  };
  (rig.overlay as unknown as FakeEl).fire("keydown", tab);
  assert.equal(escaped, true, "Tab 必须被 preventDefault（陷阱）");
  assert.equal(rig.dialog.isOpen(), true, "陷阱不得顺手关掉对话框");

  let escDefault = false;
  const esc = keydown("Escape");
  esc.preventDefault = () => {
    escDefault = true;
  };
  (rig.overlay as unknown as FakeEl).fire("keydown", esc);
  assert.equal(escDefault, true);
  assert.equal(rig.dialog.isOpen(), false);
  assert.deepEqual(rig.calls, ["restore"], "取消路径要归还焦点");
});

test("确认框：确认时先收起再发请求（模态不挡在失败提示前面）", () => {
  const rig = dialogRig();
  rig.dialog.open({ title: "t", body: "b", confirmLabel: "ok", cancelLabel: "cancel" });
  rig.element.find("ft-confirm-ok")[0].fire("click");
  assert.deepEqual(rig.calls, ["restore", "confirm"]);
  assert.equal(rig.openWhenConfirmed(), false);
});

test("确认框：点遮罩取消，点面板本身不关", () => {
  const rig = dialogRig();
  rig.dialog.open({ title: "t", body: "b", confirmLabel: "ok", cancelLabel: "cancel" });
  const overlay = rig.overlay as unknown as FakeEl;
  overlay.fire("mousedown", { target: rig.element });
  assert.equal(rig.dialog.isOpen(), true, "点在面板上不关（面板内要能选中文本）");
  overlay.fire("mousedown", { target: overlay });
  assert.equal(rig.dialog.isOpen(), false);
  assert.deepEqual(rig.calls, ["restore"]);
});

// ---------------------------------------------------------------------------
// 改名回响抑制（design §3.2）
// ---------------------------------------------------------------------------

test("抑制对：两个方向与子树都吞，其余路径一律不吞", () => {
  const guard = createRenameEchoGuard();
  guard.register("sub/a.md", "sub/b.md");
  const skipped = guard.consume(["sub/a.md", "sub/b.md", "sub/other.md", "note.md"]);
  assert.deepEqual([...skipped].sort(), ["sub/a.md", "sub/b.md"]);
  guard.settle();
  assert.equal(guard.pending(), 0, "两个方向都到齐 → 本批 settle 后即清");

  // 目录改名：整棵子树的前后两侧
  guard.register("sub", "sub2");
  const dirSkipped = guard.consume(["sub", "sub/deep/a.md", "sub2", "sub2/deep/a.md", "subx/a.md"]);
  assert.deepEqual([...dirSkipped].sort(), ["sub", "sub/deep/a.md", "sub2", "sub2/deep/a.md"]);
  guard.settle();
  assert.equal(guard.pending(), 0);
});

test("抑制对：invoke 失败即撤（撤销后事件照常归因）", () => {
  const guard = createRenameEchoGuard();
  const cancel = guard.register("a.md", "b.md");
  cancel();
  assert.equal(guard.pending(), 0);
  assert.deepEqual([...guard.consume(["a.md", "b.md"])], [], "撤登记后 MUST NOT 再吞");
});

test("抑制对：只到一半（跨批）时留到下一批，超时即清、MUST NOT 常驻", () => {
  let now = 1000;
  const guard = createRenameEchoGuard({ timeoutMs: 1000, now: () => now });
  guard.register("a.md", "b.md");
  // 第一批只来了 created:new（FSEvents 把改名拆成两个事件，落两批是常态）
  assert.deepEqual([...guard.consume(["b.md"])], ["b.md"]);
  guard.settle();
  assert.equal(guard.pending(), 1, "只到一半不得清（下一批的另一半还要吞）");
  // 第二批来了 deleted:old → 两向到齐，本批后可清
  assert.deepEqual([...guard.consume(["a.md"])], ["a.md"]);
  guard.settle();
  assert.equal(guard.pending(), 0);

  // 超时：另一条登记对只来一半，1s 后（下一批的 consume 时）不再吞
  guard.register("c.md", "d.md");
  assert.deepEqual([...guard.consume(["d.md"])], ["d.md"]);
  now += 1001;
  assert.deepEqual([...guard.consume(["c.md", "d.md"])], [], "超时后 MUST NOT 常驻吞事件");
  assert.equal(guard.pending(), 0);
});

test("抑制对的反向输入：没有登记时一条都不吞（断言有区分度）", () => {
  const guard = createRenameEchoGuard();
  assert.deepEqual([...guard.consume(["a.md", "b.md", "sub/a.md"])], []);
  assert.equal(guard.pending(), 0);
});
