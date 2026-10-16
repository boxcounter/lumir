// 拖拽落点的接线层单测（M538，vault 根落点）：**接了 DOM 的那一半**。
//
// 为什么单独一条线：几何判据本身是纯函数（`rootDropBandHit`，边界扫在 tests/unit/tree-rows.test.ts），
// 但「哪一处指针位置算列表之外 → 高亮落在哪一行 → 上抛的 to 是什么」这串接线只在 DOM 里成立，
// 而且它有三个只在这里才成立的口径：
//   ① **vault 根是落点**：指针不在任何一行上、落在列表头部之上或尾部之下时，落点是 vault 根
//      （目标目录 = `""`，`to` = 末段名本身）；
//   ② **高亮统一反馈到 vault 名行**：那两处没有**行**可高亮，class（`is-drop-target`）落在树
//      头部的入口钮上——与目录行落点同一份语义；
//   ③ **守卫是同一份 canMoveEntry**：已经在根下的条目拖回根是 no-op（`moveTargetPath` 得到源
//      路径本身），必须禁放（不 preventDefault、无高亮、不上抛）——「拖回根」不能变成一条
//      「拖了等于没拖」的假成功。
//
// 覆盖边界（不在本层，别把它读成已验）：真实 WKWebView 下的指针几何与那条真实拖拽通道归
// scripts/acceptance 的场景 159（本层合成布局，行带是造的，不是浏览器量出来的）；`.filetree`
// 拉满 pane 高度（`min-height: 100%`，让列表尾部之下那片空白属于容器的命中面）也只在那里成立。
//
// 假 DOM 与此前几个树测试文件同形（tests/unit/tree-rename.test.ts / tree-increment.test.ts /
// tree-menu.test.ts 各自带一份最小替身）：本层没有 DOM 运行时，只补文件树真正碰到的那一撮面，
// 外加一个**合成布局**（`.ft-row` 按 DOM 序自上而下排、行高 24、首行 top 48，容器顶部那段
// 就是树头部）——几何判据要吃行带，没有布局这一层就什么都验不了。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FsEntry } from "../../src/bindings/FsEntry.ts";
import type { FsEntryKind } from "../../src/bindings/FsEntryKind.ts";
import { createFileTree } from "../../src/tree.ts";
import { DROP_TARGET_CLASS } from "../../src/tree.ts";
import type { FileTreeCallbacks, InlineEditRequest } from "../../src/tree.ts";

/** 合成布局的参数：首行 top（= 树头部那一段的高度）、行高、行带左右缘。 */
const HEADER_H = 48;
const ROW_H = 24;
const ROW_LEFT = 15;
const ROW_RIGHT = 218;

interface FakeEvent {
  preventDefault?(): void;
  dataTransfer?: unknown;
  clientX?: number;
  clientY?: number;
  target?: unknown;
  relatedTarget?: unknown;
}

/** 懒创建的 ctx：`document` 要先装到全局、再建 mount，而 FakeEl 的尺寸要查 mount 下的行序。 */
interface LayoutCtx {
  mount: FakeEl | null;
}

class FakeEl {
  readonly tagName: string;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
  readonly ctx: LayoutCtx;
  readonly classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
    toggle: (name: string, force?: boolean) => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };

  constructor(tagName: string, ctx: LayoutCtx) {
    this.tagName = tagName;
    this.ctx = ctx;
  }

  get className(): string {
    return [...this.classes].join(" ");
  }

  set className(value: string) {
    this.classes.clear();
    for (const name of value.split(/\s+/).filter(Boolean)) this.classes.add(name);
  }

  textContent = "";
  innerHTML = "";
  title = "";
  type = "";
  hidden = false;
  draggable = false;
  value = "";
  placeholder = "";
  autocomplete = "";
  spellcheck = false;

  /** 合成布局（唯一的几何来源）：只给 `.ft-row` 一条有意义的行带——按它在 mount 里的 DOM 序
   *  自上而下排（DOM 序 = 纵向序，嵌套 ul 紧跟父行，与真实树同构）。非行元素给空盒。 */
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number } {
    const rows = this.ctx.mount?.querySelectorAll(".ft-row") ?? [];
    const index = rows.indexOf(this);
    if (index < 0) return { left: 0, right: 0, top: 0, bottom: 0 };
    const top = HEADER_H + ROW_H * index;
    return { left: ROW_LEFT, right: ROW_RIGHT, top, bottom: top + ROW_H };
  }

  get firstChild(): FakeEl | null {
    return this.children[0] ?? null;
  }

  append(...nodes: FakeEl[]): void {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeEl[]): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }

  insertBefore(node: FakeEl, ref: FakeEl | null): void {
    const at = ref === null ? this.children.length : this.children.indexOf(ref);
    node.parent = this;
    this.children.splice(at < 0 ? this.children.length : at, 0, node);
  }

  replaceChild(next: FakeEl, old: FakeEl): void {
    const at = this.children.indexOf(old);
    if (at < 0) throw new Error("replaceChild：目标不在该元素下");
    old.parent = null;
    next.parent = this;
    this.children[at] = next;
  }

  remove(): void {
    if (this.parent === null) return;
    const at = this.parent.children.indexOf(this);
    if (at >= 0) this.parent.children.splice(at, 1);
    this.parent = null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  /** 手动派发（不走冒泡：本层只断言树自己的处理）。 */
  fire(type: string, event: FakeEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {}

  /** 类选择器（本层只用到 `.filetree` / `.ft-row` / `.ft-item` / `.ft-vault` 这类简单形态）。 */
  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeEl[] {
    const name = selector.replace(/^\./, "");
    const out: FakeEl[] = [];
    const walk = (node: FakeEl): void => {
      if (node.classes.has(name)) out.push(node);
      for (const child of node.children) walk(child);
    };
    for (const child of this.children) walk(child);
    return out;
  }

  closest(selector: string): FakeEl | null {
    const name = selector.replace(/^\./, "");
    let node: FakeEl | null = this;
    while (node !== null) {
      if (node.classes.has(name)) return node;
      node = node.parent;
    }
    return null;
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }
}

// ---------------------------------------------------------------------------
// 夹具与 rig
// ---------------------------------------------------------------------------

function entry(path: string, kind: FsEntryKind): FsEntry {
  return { path, kind, size: 0, mtime_ms: null, lazy: false };
}

/** 树形（`sub` 展开后）：other / root.md / sub / sub-inner 4 行 + root.md、sub 的孩子。
 *  根下一份文件、一个目录各一：既够判「拖到根的合法档」，也够判「已经在根上」的禁放档。 */
const ENTRIES: FsEntry[] = [
  entry("other", "dir"),
  entry("other/deep", "dir"),
  entry("root.md", "file"),
  entry("sub", "dir"),
  entry("sub/inner", "dir"),
  entry("sub/a.md", "file"),
  entry("sub/b.md", "file"),
];

interface Rig {
  moves: Array<{ from: string; to: string }>;
  /** 树头部（vault 名行）那一处：`y` 缺省给一个落在头部里的点。 */
  dragOverHeader: (y?: number) => boolean;
  dropHeader: (y?: number) => boolean;
  /** 列表尾部之下的空白：`y` 缺省给「最后一行之下 40px」。 */
  dragOverBlank: (y?: number) => boolean;
  dropBlank: (y?: number) => boolean;
  /** 行元素上 fire dragover / drop（普通行落点那一档的回归）。 */
  dragOverRow: (path: string) => boolean;
  dragStart: (path: string) => void;
  dragEnd: (path: string) => void;
  /** vault 名行（树头部入口钮）是否带落点高亮。 */
  vaultHighlighted: () => boolean;
  /** 某一行是否带落点高亮。 */
  rowHighlighted: (path: string) => boolean;
  click: (path: string) => void;
  /** 树头部的 vault 名行（入口钮）是否在场。 */
  hasVaultRow: () => boolean;
  /** 切到未装载 vault 的空态（`showEmpty`）。 */
  showEmpty: () => void;
}

function rig(): Rig {
  const ctx: LayoutCtx = { mount: null };
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { createElement: (tag: string) => new FakeEl(tag, ctx) };
  // 落点判定走 `target instanceof Element`：测试环境没有 DOM 全局，用 FakeEl 顶上。
  g.Element = FakeEl;
  g.Node = FakeEl;
  const mount = new FakeEl("div", ctx);
  ctx.mount = mount;

  const moves: Array<{ from: string; to: string }> = [];
  const cb: FileTreeCallbacks = {
    onOpenFile: () => {},
    onOpenVault: () => {},
    onOpenVaultSwitcher: () => {},
    onContextMenu: () => {},
    onInlineEditSubmit: (_request: InlineEditRequest) => {},
    onMoveEntry: (from, to) => void moves.push({ from, to }),
    onExpandLazyDir: () => Promise.resolve([]),
  };
  const tree = createFileTree(mount as unknown as HTMLElement, cb);
  tree.setVault("/vault", ENTRIES);

  const rootEl = (): FakeEl => {
    const el = mount.querySelector(".filetree");
    assert.ok(el !== null, "树的容器必须在 mount 里");
    return el;
  };
  const vaultRow = (): FakeEl => {
    const el = mount.querySelector(".ft-vault");
    assert.ok(el !== null, "vault 名行（树头部入口钮）必须在");
    return el;
  };
  const rowOf = (path: string): FakeEl => {
    const item = mount.querySelectorAll(".ft-item").find((n) => n.dataset.path === path);
    assert.ok(item !== undefined, `行 ${path} 必须在 DOM 里（父目录先展开）`);
    const row = item.querySelector(".ft-row");
    assert.ok(row !== null, `行 ${path} 的行元素必须在`);
    return row;
  };
  /** 最后一行行带的下缘（合成布局里 = 头部高 + 行数 × 行高）。 */
  const lastRowBottom = (): number => HEADER_H + ROW_H * mount.querySelectorAll(".ft-row").length;

  const fire = (type: string, target: FakeEl, x: number, y: number): boolean => {
    let prevented = false;
    rootEl().fire(type, {
      target,
      clientX: x,
      clientY: y,
      dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" },
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  };

  return {
    moves,
    dragOverHeader: (y = 20) => fire("dragover", vaultRow(), 100, y),
    dropHeader: (y = 20) => fire("drop", vaultRow(), 100, y),
    dragOverBlank: (y = lastRowBottom() + 40) => fire("dragover", rootEl(), 100, y),
    dropBlank: (y = lastRowBottom() + 40) => fire("drop", rootEl(), 100, y),
    dragOverRow: (path) => fire("dragover", rowOf(path), 100, 0),
    dragStart: (path) => {
      rowOf(path).fire("dragstart", {
        dataTransfer: { setData: () => {}, effectAllowed: "", dropEffect: "" },
      });
    },
    dragEnd: (path) => rowOf(path).fire("dragend"),
    vaultHighlighted: () => vaultRow().classes.has(DROP_TARGET_CLASS),
    rowHighlighted: (path) => rowOf(path).classes.has(DROP_TARGET_CLASS),
    click: (path) => rowOf(path).fire("click"),
    hasVaultRow: () => mount.querySelector(".ft-vault") !== null,
    showEmpty: () => tree.showEmpty(null),
  };
}

/** 展开一个目录（点它那一行）：嵌套行的落点要它先展开才在 DOM 里。 */
function expand(r: Rig, path: string): void {
  r.click(path);
}

// ---------------------------------------------------------------------------
// ① vault 根是落点：树头部（vault 名行那一带）
// ---------------------------------------------------------------------------

test("拖子目录里的文件到树头部：dragover 允许并高亮 vault 名行，drop 上抛「移到根」", () => {
  const r = rig();
  expand(r, "sub");

  r.dragStart("sub/a.md");
  assert.equal(r.dragOverHeader(), true, "树头部是落点：dragover 被 preventDefault");
  assert.equal(r.vaultHighlighted(), true, "高亮反馈落在 vault 名行上（那两处没有行可高亮）");
  assert.equal(r.rowHighlighted("sub"), false, "不是目录行落点：别的行 MUST NOT 被标成落点行");

  assert.equal(r.dropHeader(), true, "drop 被接受");
  assert.deepEqual(r.moves, [{ from: "sub/a.md", to: "a.md" }], "目标目录 = 根 ⇒ to 是末段名本身");
  assert.equal(r.vaultHighlighted(), false, "松手即清高亮");
});

test("拖到列表尾部之下的空白：与树头部同一条落点（同一个 to）", () => {
  const r = rig();
  expand(r, "sub");

  r.dragStart("sub/b.md");
  assert.equal(r.dragOverBlank(), true, "列表尾部之下的空白也是落点");
  assert.equal(r.vaultHighlighted(), true, "两处的高亮统一到 vault 名行");
  assert.equal(r.dropBlank(), true);
  assert.deepEqual(r.moves, [{ from: "sub/b.md", to: "b.md" }]);
  assert.equal(r.vaultHighlighted(), false, "松手即清高亮");
});

test("拖子目录到根部：目录也是合法源，to 是目录名本身", () => {
  const r = rig();
  expand(r, "sub");

  r.dragStart("sub/inner");
  assert.equal(r.dragOverHeader(), true);
  assert.equal(r.dropHeader(), true);
  assert.deepEqual(r.moves, [{ from: "sub/inner", to: "inner" }], "目录拖回根 = 移到根直下");
});

// ---------------------------------------------------------------------------
// ② 守卫（与目录行落点同一份 canMoveEntry）
// ---------------------------------------------------------------------------

test("已经在根下的条目拖回根：禁放（no-op 不能被当成一次成功）", () => {
  const r = rig();
  expand(r, "sub");

  // 根级文件与根级目录各一条：两者的 to 都等于源路径本身（moveTargetPath 的结果），
  // 在窗口里「拖回根」是一次什么都没发生的动作——光标、高亮、上抛三者一起答「这里不行」。
  for (const path of ["root.md", "other"]) {
    r.dragStart(path);
    assert.equal(r.dragOverHeader(), false, `${path} 已在根下：dragover 不 preventDefault`);
    assert.equal(r.vaultHighlighted(), false, `${path} 已在根下：不给落点高亮`);
    assert.equal(r.dropHeader(), false, `${path} 已在根下：drop 不接受`);
    r.dropBlank();
    assert.deepEqual(r.moves, [], `${path} 拖回根 MUST NOT 上抛（no-op 不是成功）`);
  }
});

test("普通行不受影响：文件行仍不是落点，目录行仍照旧可放（同一条通道的正控制）", () => {
  const r = rig();
  expand(r, "sub");

  // 文件行：M530 的既有口径不变（禁放、无高亮）
  r.dragStart("sub/a.md");
  assert.equal(r.dragOverRow("sub/b.md"), false, "文件行不是落点");
  assert.equal(r.rowHighlighted("sub/b.md"), false, "文件行没有落点高亮");
  // 目录行：同一次拖拽里换到目录行上就该可放——它是本文件的「正控制」：没有这一条，
  // 上面那些「禁放」断言在通道整体失灵时照样绿（REVIEW.md 第 1 条：判据要有区分度）。
  assert.equal(r.dragOverRow("other"), true, "目录行落点照旧可放");
  assert.equal(r.rowHighlighted("other"), true, "高亮落在目录行上");
  assert.equal(r.vaultHighlighted(), false, "目录行落点 MUST NOT 顺带点亮 vault 名行");
});

test("dragend 兜底：拖到头部后拖出窗口（无 drop）不残留高亮", () => {
  const r = rig();
  expand(r, "sub");

  r.dragStart("sub/a.md");
  r.dragOverHeader();
  assert.equal(r.vaultHighlighted(), true);
  r.dragEnd("sub/a.md");
  assert.equal(r.vaultHighlighted(), false, "dragend 清掉高亮与拖拽态");
  assert.deepEqual(r.moves, [], "没有 drop 就没有移动");
});

test("高亮不残留：从头部挪到禁放处（文件行 / 已在根下的条目）即清", () => {
  const r = rig();
  expand(r, "sub");

  r.dragStart("sub/a.md");
  r.dragOverHeader();
  assert.equal(r.vaultHighlighted(), true);
  assert.equal(r.dragOverRow("sub/b.md"), false, "挪到文件行上：禁放");
  assert.equal(r.vaultHighlighted(), false, "禁放处 MUST NOT 留着上一处的高亮");

  r.dragOverHeader();
  assert.equal(r.vaultHighlighted(), true);
  r.dragEnd("sub/a.md"); // 一次拖拽结束（无 drop），换一个已经在根下的源再起拖
  r.dragStart("root.md"); // 同一个指针位置上的源从「可放」变「禁放」
  assert.equal(r.dragOverHeader(), false, "已在根下的源在头部是禁放");
  assert.equal(r.vaultHighlighted(), false, "禁放即清高亮");
  assert.deepEqual(r.moves, [], "全程没有 drop，没有移动");
});

test("未装载 vault（空态）：没有 vault 名行可高亮，根落点不成立", () => {
  const r = rig();
  expand(r, "sub");
  r.dragStart("sub/a.md");
  r.showEmpty();
  assert.equal(r.hasVaultRow(), false, "空态里树头部整块消失（入口钮不在）");
  assert.deepEqual(r.moves, [], "空态里没有落点：拖拽态随 DOM 一起作废");
});
