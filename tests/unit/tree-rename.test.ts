// tests/unit/tree-rename.test.ts — 目录改名后的展开态不变量（M258）。
//
// 现场（Alex 2026-09-27，fieldnotes vault）：把 `.local` 下的 `openspec-tutorial` 改名为
// `openspec-tutorials` 之后，该目录在树里再也展不开；改回原名也展不开。根因分两层：
//
//   ① **后端**（`src-tauri/src/fs_io.rs` 的 `expand_new_dir_subtrees`）：FSEvents 对目录改名
//      只报目录本身一个路径，子孙一个都不进事件流。真机探针实测批次逐字为
//      `[Deleted tutorial, Created tutorials(dir)]` —— 前端因此根本补不出子树。
//   ② **前端**（`src/tree.ts` 的 `applyChanges`）：展开态是按路径存的集合（`expanded`），
//      改名后旧前缀被 `deleted` 的级联清理 `pruneExpanded` 一起删掉 ⇒ 即便子树回来了，目录
//      也掉成折叠态。
//
// 本文件钉住①②合起来的那条不变量（**不是某一个案例**）：树自己发起的目录改名，回响批次
// 应用之后，**模型与 DOM 必须与「同一时刻的全量枚举 + 展开态按前缀迁移」逐条一致**——
// 每一个原展开的目录在新路径下展开并列出其全部子条目，没展开的保持折叠，且树里不留任何旧
// 路径。生成器扫「目录树形状 × 展开子集」两个维度（下面的属性测试），用户现场的单一案例
// 另有一条（不得只有它）。
//
// 与 tree-increment.test.ts 的假 DOM 是同形状的两份（与 tree-menu.test.ts 同情形：每个树测试
// 文件自带最小替身，不为共享替身新开一个不在本 mission scope 内的模块）。
//
// 不覆盖：真实 WKWebView 下的帧时序与像素（真机场景 47 / 视觉门禁）、后端那一半（Rust 侧
// `fs_io.rs` 的 `watch_dir_rename_delivers_full_subtree` 与下面的纯函数测试）。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FsChange } from "../../src/bindings/FsChange.ts";
import type { FsChangeKind } from "../../src/bindings/FsChangeKind.ts";
import type { FsEntry } from "../../src/bindings/FsEntry.ts";
import type { FsEntryKind } from "../../src/bindings/FsEntryKind.ts";
import { createFileTree } from "../../src/tree.ts";
import type { FileTree, FileTreeCallbacks, InlineEditRequest } from "../../src/tree.ts";

// ---------------------------------------------------------------------------
// 假 DOM：只实现文件树碰到的那一撮面（append / replaceChildren / insertBefore /
// replaceChild / 类选择器查询 / closest / classList / dataset / hidden / input.value）。
// ---------------------------------------------------------------------------

interface FakeEvent {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  preventDefault?(): void;
  /** 拖拽事件（M530）：dataTransfer 替身 / 指针坐标 / 事件目标 / dragleave 的 relatedTarget。 */
  dataTransfer?: unknown;
  clientX?: number;
  clientY?: number;
  target?: unknown;
  relatedTarget?: unknown;
}

class FakeEl {
  readonly tagName: string;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Array<(event: FakeEvent) => void>>();
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
  value = "";
  placeholder = "";
  autocomplete = "";
  spellcheck = false;

  constructor(tagName: string) {
    this.tagName = tagName;
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

  /** 类选择器（本层只用到 `.ft-row` / `.ft-item` / `.ft-edit` / `.ft-caret` 这类简单形态）。 */
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

function installFakeDocument(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { createElement: (tag: string) => new FakeEl(tag) };
  // 拖拽落点判定（M530）走 rowLiAt 的 `target instanceof Element`，dragleave 用
  // `relatedTarget instanceof Node`：测试环境没有 DOM 全局，用 FakeEl 顶上。
  g.Element = FakeEl;
  g.Node = FakeEl;
}

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function entry(path: string, kind: FsEntryKind, lazy = false): FsEntry {
  return { path, kind, size: 0, mtime_ms: null, lazy };
}

function change(
  kind: FsChangeKind,
  path: string,
  entryKind: FsEntryKind | null,
  lazy = false,
): FsChange {
  return { kind, path, entry_kind: entryKind, lazy };
}

function keydown(key: string): FakeEvent {
  return { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: () => {} };
}

/** 一条路径的严格祖先目录链（`a/b/c.md` → `["a", "a/b"]`）。 */
function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join("/"));
  return out;
}

/** 展开态下**应当渲染出来**的路径集合：每个严格祖先目录都在展开集里（根恒展开）。 */
function visiblePaths(all: readonly string[], expanded: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const path of all) {
    if (ancestorsOf(path).every((a) => expanded.has(a))) out.add(path);
  }
  return out;
}

interface Rig {
  tree: FileTree;
  submitted: InlineEditRequest[];
  /** 拖拽移动（M530）上抛给装配层的 from → to 请求。 */
  moves: Array<{ from: string; to: string }>;
  /** 整棵树的 DOM 里已渲染的行路径（读 `.ft-item` 的 dataset.path）。 */
  renderedPaths: () => Set<string>;
  caretOpen: (path: string) => boolean | undefined;
  /** 该行的行名文本（`.ft-name`）；行不在（或不是叶子行形态）时为 undefined。 */
  rowName: (path: string) => string | undefined;
  rowTitle: (path: string) => string | undefined;
  /** 整棵树 DOM 里内联输入框的个数（编辑态是否残留的读数口）。 */
  editInputCount: () => number;
  click: (path: string) => void;
  beginRename: (path: string, newName: string) => void;
  /** 行上 fire dragstart（登记拖拽源）。 */
  dragStart: (path: string) => void;
  /** 目标行上 fire dragover；返回值 = preventDefault 是否被调用（true = 可放）。 */
  dragOver: (path: string) => boolean;
  /** 目标行上 fire drop；返回值同上。 */
  drop: (path: string) => boolean;
  /** 源行上 fire dragend（拖出窗口 / Esc 取消的兜底清理路径）。 */
  dragEnd: (path: string) => void;
  /** 该行的落点高亮（is-drop-target）是否在场。 */
  dropTargetRow: (path: string) => boolean;
}

function rig(entries: FsEntry[]): Rig {
  installFakeDocument();
  const mount = new FakeEl("div");
  const submitted: InlineEditRequest[] = [];
  const moves: Array<{ from: string; to: string }> = [];
  const cb: FileTreeCallbacks = {
    onOpenFile: () => {},
    onOpenVault: () => {},
    onOpenVaultSwitcher: () => {},
    onContextMenu: () => {},
    onInlineEditSubmit: (request) => void submitted.push(request),
    onMoveEntry: (from, to) => void moves.push({ from, to }),
    onExpandLazyDir: () => Promise.resolve([]),
  };
  const tree = createFileTree(mount as unknown as HTMLElement, cb);
  tree.setVault("/vault", entries);

  const items = (): FakeEl[] => mount.querySelectorAll(".ft-item");
  const itemOf = (path: string): FakeEl | undefined =>
    items().find((n) => n.dataset.path === path);
  const rowOf = (path: string): FakeEl | undefined => itemOf(path)?.querySelector(".ft-row") ?? undefined;
  const rootEl = (): FakeEl => {
    const el = mount.querySelector(".filetree");
    assert.ok(el !== null, "树的容器必须在 mount 里");
    return el;
  };
  const fakeDataTransfer = (): unknown => ({ setData: () => {}, effectAllowed: "", dropEffect: "" });
  const rowMust = (path: string): FakeEl => {
    const row = rowOf(path);
    assert.ok(row !== undefined, `行 ${path} 必须在 DOM 里（父目录先展开）`);
    return row;
  };

  return {
    tree,
    submitted,
    moves,
    renderedPaths: () => new Set(items().map((n) => n.dataset.path)),

    caretOpen: (path) => rowOf(path)?.querySelector(".ft-caret")?.classes.has("is-open"),
    rowName: (path) => rowOf(path)?.querySelector(".ft-name")?.textContent,
    rowTitle: (path) => rowOf(path)?.title,
    editInputCount: () => mount.querySelectorAll(".ft-edit").length,

    click: (path) => {
      const row = rowOf(path);
      assert.ok(row !== undefined, `要点击的行 ${path} 必须在 DOM 里`);
      row.fire("click");
    },

    /** 树内重命名：右键菜单动作最终落到的就是这两步（beginRename + 输入框提交）。 */
    beginRename: (path, newName) => {
      tree.beginRename(path);
      const input = itemOf(path)?.querySelector(".ft-edit") ?? undefined;
      assert.ok(input !== undefined, `内联输入框必须在 ${path} 那一行里`);
      input.value = newName;
      input.fire("keydown", keydown("Enter"));
    },

    dragStart: (path) => {
      rowMust(path).fire("dragstart", { dataTransfer: fakeDataTransfer() });
    },
    dragOver: (path) => {
      let prevented = false;
      rootEl().fire("dragover", {
        target: rowMust(path),
        clientX: 0,
        clientY: 0,
        dataTransfer: fakeDataTransfer(),
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
    drop: (path) => {
      let prevented = false;
      rootEl().fire("drop", {
        target: rowMust(path),
        clientX: 0,
        clientY: 0,
        dataTransfer: fakeDataTransfer(),
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    },
    dragEnd: (path) => {
      rowMust(path).fire("dragend");
    },
    dropTargetRow: (path) => rowMust(path).classes.has("is-drop-target"),
  };
}

/** 提交一次树内重命名并回报成功（装配层 invoke 成功那条路径）。 */
function renameViaTree(r: Rig, path: string, newName: string): InlineEditRequest {
  r.beginRename(path, newName);
  const request = r.submitted.at(-1);
  assert.ok(request !== undefined, "提交必须经 onInlineEditSubmit 报到装配层");
  r.tree.endInlineEdit(true);
  return request;
}

/**
 * 后端（M258 修复后）对一次目录改名送出的批次，逐字同形：旧路径报删除、新路径报目录、
 * 新路径下每个条目各一条（`expand_new_dir_subtrees` 补出来的那些）。
 */
function dirRenameBatch(
  from: string,
  to: string,
  subtree: ReadonlyArray<{ path: string; kind: FsEntryKind }>,
): FsChange[] {
  const out: FsChange[] = [change("deleted", from, null), change("created", to, "dir")];
  for (const node of subtree) {
    if (node.path === from) continue;
    out.push(change("created", to + node.path.slice(from.length), node.kind));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 用户现场的单一案例（不得单独存在——下面还有属性测试）
// ---------------------------------------------------------------------------

test("树内重命名目录：改名后目录仍展开、子树行全在（Alex 现场）", () => {
  const r = rig([
    entry("tutorial", "dir"),
    entry("tutorial/a.md", "file"),
    entry("tutorial/deep", "dir"),
    entry("tutorial/deep/b.txt", "file"),
    entry("other.md", "file"),
  ]);
  r.click("tutorial");
  r.click("tutorial/deep");
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["other.md", "tutorial", "tutorial/a.md", "tutorial/deep", "tutorial/deep/b.txt"],
    "起点：两层都展开了，五行都在",
  );

  const request = renameViaTree(r, "tutorial", "tutorials");
  assert.deepEqual(request, { mode: "rename", path: "tutorial", parentRel: "", name: "tutorials" });

  r.tree.applyChanges(
    dirRenameBatch("tutorial", "tutorials", [
      { path: "tutorial", kind: "dir" },
      { path: "tutorial/a.md", kind: "file" },
      { path: "tutorial/deep", kind: "dir" },
      { path: "tutorial/deep/b.txt", kind: "file" },
    ]),
  );

  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["other.md", "tutorials", "tutorials/a.md", "tutorials/deep", "tutorials/deep/b.txt"],
    "改名后：新路径下整棵子树在场、旧路径一条不留（展开态随目录搬过去）",
  );
  assert.equal(r.caretOpen("tutorials"), true, "改名后的目录保持展开");
  assert.equal(r.rowTitle("tutorials"), "tutorials", "行的 path 类属性不得留着旧路径");
  assert.equal(r.rowName("tutorials"), "tutorials", "行名是新名");

  // 改回原名（用户报告的第二半）：同一套机制，两个方向都要成立
  renameViaTree(r, "tutorials", "tutorial");
  r.tree.applyChanges(
    dirRenameBatch("tutorials", "tutorial", [
      { path: "tutorials", kind: "dir" },
      { path: "tutorials/a.md", kind: "file" },
      { path: "tutorials/deep", kind: "dir" },
      { path: "tutorials/deep/b.txt", kind: "file" },
    ]),
  );
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["other.md", "tutorial", "tutorial/a.md", "tutorial/deep", "tutorial/deep/b.txt"],
    "改回原名后同样展开着、子树齐全",
  );
});

// ---------------------------------------------------------------------------
// 属性测试：目录树形状 × 展开子集
// ---------------------------------------------------------------------------

/** 确定性 PRNG（同一次失败的形状可复现；不用随机源以免红一次再也复现不出来）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface GeneratedTree {
  dirs: string[];
  files: string[];
  /** 自洽的展开子集：展开的目录其祖先目录都展开（否则它的行根本渲染不出来）。 */
  expanded: Set<string>;
}

/** 生成一棵深度 ≤4、每个目录 ≤2 个子目录 / ≤2 个文件的目录树，外加一个自洽展开子集。 */
function generateTree(seed: number): GeneratedTree {
  const rnd = mulberry32(seed);
  const pick = (n: number) => Math.floor(rnd() * n);
  const dirs: string[] = [];
  const files: string[] = [];
  const frontier: Array<{ path: string; depth: number }> = [{ path: "", depth: 0 }];
  let seq = 0;
  while (frontier.length > 0 && dirs.length < 9) {
    const parent = frontier.shift() as { path: string; depth: number };
    if (parent.depth >= 4) continue;
    const dirCount = parent.depth === 0 ? 1 + pick(2) : pick(3);
    for (let k = 0; k < dirCount && dirs.length < 9; k += 1) {
      const name = `d${seq}`;
      seq += 1;
      const path = parent.path === "" ? name : `${parent.path}/${name}`;
      dirs.push(path);
      for (let f = 0; f < pick(3); f += 1) files.push(`${path}/f${f}.md`);
      frontier.push({ path, depth: parent.depth + 1 });
    }
  }
  // 自洽展开子集：按 BFS 序（父先于子）逐个掷骰，父未展开则子也不展开
  const expanded = new Set<string>();
  for (const dir of dirs) {
    const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
    if ((parent === "" || expanded.has(parent)) && rnd() < 0.65) expanded.add(dir);
  }
  return { dirs, files, expanded };
}

test("属性：任意目录树 × 任意展开子集，树内改名后展开态与 DOM 逐条一致", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const gen = generateTree(seed);
    const all = [...gen.dirs, ...gen.files];
    const entries: FsEntry[] = [
      ...gen.dirs.map((p) => entry(p, "dir")),
      ...gen.files.map((p) => entry(p, "file")),
    ];
    const r = rig(entries);
    // 按 BFS 序点击展开（父先于子，父没展开时子的行还没渲染）
    for (const dir of gen.dirs) {
      if (gen.expanded.has(dir)) r.click(dir);
    }
    assert.deepEqual(
      [...r.renderedPaths()].sort(),
      [...visiblePaths(all, gen.expanded)].sort(),
      `seed ${seed}：起点的渲染集合必须等于展开模型（这条不成立说明属性测试自己的前提错了）`,
    );

    // 改名的对象：任一**行真的渲染出来了**的目录（含嵌套），新名不会与既有同缀条目撞
    const candidates = gen.dirs.filter((dir) =>
      ancestorsOf(dir).every((a) => gen.expanded.has(a)),
    );
    assert.ok(candidates.length > 0, `seed ${seed}：至少要有一个可点到的目录`);
    const subject = candidates[Math.floor(mulberry32(seed * 7919)() * candidates.length)];
    const newName = `${subject.slice(subject.lastIndexOf("/") + 1)}s`;
    const to = subject.includes("/")
      ? `${subject.slice(0, subject.lastIndexOf("/"))}/${newName}`
      : newName;
    assert.equal(gen.expanded.has(to), false, `seed ${seed}：新路径不该已经在展开集里`);

    const subtree = all
      .filter((p) => p === subject || p.startsWith(`${subject}/`))
      .sort((a, b) => a.split("/").length - b.split("/").length)
      .map((p) => ({ path: p, kind: (gen.dirs.includes(p) ? "dir" : "file") as FsEntryKind }));

    renameViaTree(r, subject, newName);
    r.tree.applyChanges(dirRenameBatch(subject, to, subtree));

    // 期望：新路径下的模型/展开态 = 旧路径下的展开态按前缀迁移
    const expectedExpanded = new Set(
      [...gen.expanded].map((p) =>
        p === subject || p.startsWith(`${subject}/`) ? to + p.slice(subject.length) : p,
      ),
    );
    const expectedAll = all.map((p) =>
      p === subject || p.startsWith(`${subject}/`) ? to + p.slice(subject.length) : p,
    );
    assert.deepEqual(
      [...r.renderedPaths()].sort(),
      [...visiblePaths(expectedAll, expectedExpanded)].sort(),
      `seed ${seed}：${subject} → ${to} 之后渲染集合必须等于「展开态随目录搬家」的预期`,
    );
    // 旧路径一条不留（DOM 里不留幽灵行）；新路径下的目录行 caret 与展开态一一对应
    for (const path of r.renderedPaths()) {
      assert.equal(
        path === subject || path.startsWith(`${subject}/`),
        false,
        `seed ${seed}：树里不得留着旧路径 ${path}`,
      );
    }
    for (const dir of expectedExpanded) {
      assert.equal(r.caretOpen(dir), true, `seed ${seed}：展开过的目录 ${dir} 改名后必须仍展开`);
    }
    for (const dir of gen.dirs.map((p) =>
      p === subject || p.startsWith(`${subject}/`) ? to + p.slice(subject.length) : p,
    )) {
      if (expectedExpanded.has(dir)) continue;
      // 未展开的目录（可见的那些）caret 必须仍是合的——展开态不得被顺手放大
      if (r.renderedPaths().has(dir)) {
        assert.equal(r.caretOpen(dir), false, `seed ${seed}：没展开过的目录 ${dir} 不得变成展开`);
      }
    }
    // 树里不留旧路径的书写痕迹（行名 / title 都走新路径）
    for (const node of subtree) {
      const mapped = to + node.path.slice(subject.length);
      if (r.renderedPaths().has(mapped) && node.kind === "dir") {
        assert.equal(r.rowTitle(mapped), mapped, `seed ${seed}：${mapped} 的行 title 必须是新路径`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// 边界与反向对照
// ---------------------------------------------------------------------------

test("反向对照：没有本树发起的登记（外部改名）时展开态不搬——子树照常建全但目录是折叠的", () => {
  const r = rig([
    entry("tutorial", "dir"),
    entry("tutorial/a.md", "file"),
    entry("tutorial/deep", "dir"),
    entry("tutorial/deep/b.txt", "file"),
  ]);
  r.click("tutorial");
  r.click("tutorial/deep");

  // 不经 beginRename：外部进程（Finder / 别的编辑器）改的名
  r.tree.applyChanges(
    dirRenameBatch("tutorial", "tutorials", [
      { path: "tutorial", kind: "dir" },
      { path: "tutorial/a.md", kind: "file" },
      { path: "tutorial/deep", kind: "dir" },
      { path: "tutorial/deep/b.txt", kind: "file" },
    ]),
  );

  assert.deepEqual([...r.renderedPaths()], ["tutorials"], "目录行在场，子树按折叠态不渲染");
  assert.equal(r.caretOpen("tutorials"), false, "外部改名不迁移展开态（判据只认自己发起的登记）");
  // 但必须**可展开**：点开就看到全部子条目（不变量的一半——模型里有子树）
  r.click("tutorials");
  r.click("tutorials/deep");
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["tutorials", "tutorials/a.md", "tutorials/deep", "tutorials/deep/b.txt"],
    "外部改名后目录照样能展开列出文件（M258 现场的那个「展不开」不得复发）",
  );
});

// ---------------------------------------------------------------------------
// 反向输入：修复前的批次形态（证明上一条的判据有区分度，也钉住后端补子孙是承重的）
// ---------------------------------------------------------------------------

test("反向输入：只有 deleted:old + created:new（修复前的批次）时改名后的目录展不开", () => {
  // FSEvents 对目录改名实际只报这两条（M258 真机探针逐字实测）。此时前端把旧子树级联清掉、
  // 只能建出一个空目录节点——点开什么都没有，正是 Alex 报的死态。这条不是「期望的行为」，
  // 而是**修复面本身**：后端不补子孙（`fs_io.rs` 的 expand_new_dir_subtrees）时，前端无论怎么
  // 改都补不出磁盘上存在、事件流里没提过的条目。上一条（新路径下子树在场）因此只在
  // 「后端补了整棵子树」的前提下成立。**若将来前端能从别处恢复子树，本条会翻红——那时的正确
  // 处置是删掉本条**（它记录的是修复面，不是产品期望）。
  const r = rig([
    entry("tutorial", "dir"),
    entry("tutorial/a.md", "file"),
    entry("other.md", "file"),
  ]);
  r.click("tutorial");

  renameViaTree(r, "tutorial", "tutorials");
  r.tree.applyChanges([
    change("deleted", "tutorial", null),
    change("created", "tutorials", "dir"),
  ]);

  assert.deepEqual([...r.renderedPaths()].sort(), ["other.md", "tutorials"], "目录行在场、旧行已摘");
  r.click("tutorials"); // 点开也换不出子行——模型里根本没有
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["other.md", "tutorials"],
    "空目录节点展不开（修复前的死态：子条目不在模型里）",
  );
});

test("改名失败即撤登记：失败之后到达的 deleted:from 不再被认成那次改名", () => {
  const r = rig([
    entry("tutorial", "dir"),
    entry("tutorial/a.md", "file"),
  ]);
  r.click("tutorial");

  r.beginRename("tutorial", "tutorials");
  r.tree.endInlineEdit(false, "已存在同名条目：tutorials"); // 后端拒绝

  // 拒绝之后磁盘上并没有新目录；真实发生的是别处的一次删除 + 同一窗口内的一次新建
  r.tree.applyChanges([
    change("deleted", "tutorial", null),
    change("created", "unrelated", "dir"),
  ]);
  assert.deepEqual([...r.renderedPaths()].sort(), ["unrelated"], "旧目录按删除收敛，新目录是折叠的");
  assert.equal(r.caretOpen("unrelated"), false, "登记已撤：展开态不得搬到无关的新目录上");
});

test("回响先于提交回执到达：编辑态不残留、新路径下子树照常建全", () => {
  // invoke 的返回与 watcher 事件走两条通道，事件可能先到（那一行的 DOM 已随旧 li 消失）。
  // 这时编辑态必须随行作废，且随后到达的 endInlineEdit(true) 是空动作——不得抛错、不得把行改回去。
  const r = rig([
    entry("tutorial", "dir"),
    entry("tutorial/a.md", "file"),
  ]);
  r.click("tutorial");

  r.beginRename("tutorial", "tutorials"); // 提交（登记已就位），尚未 endInlineEdit
  assert.equal(r.editInputCount(), 1, "提交后仍在编辑态（等装配层的回执）");

  r.tree.applyChanges(
    dirRenameBatch("tutorial", "tutorials", [
      { path: "tutorial", kind: "dir" },
      { path: "tutorial/a.md", kind: "file" },
    ]),
  );
  assert.equal(r.tree.editingPath(), undefined, "编辑行随旧 li 消失，编辑态必须一起作废");
  assert.equal(r.editInputCount(), 0, "DOM 里不得留孤立的输入框");
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["tutorials", "tutorials/a.md"],
    "回响先到时展开态照样搬过去、子树照常建全",
  );

  // 装配层随后回报成功：编辑态已经不在，这次是空动作（不抛错、不重画）
  r.tree.endInlineEdit(true);
  assert.deepEqual([...r.renderedPaths()].sort(), ["tutorials", "tutorials/a.md"]);
});


// ---------------------------------------------------------------------------
// 拖拽移动（M530）：dragover 高亮、drop 上抛、禁放面、回响收敛与失败撤销。
// 目标路径与落点判定的纯函数矩阵在 tests/unit/tree-paths.test.ts；这里钉 DOM 接线与
// 「移动后 watcher 回响收敛」这条与改名共用机制的不变量。真机行为在场景 159。
// ---------------------------------------------------------------------------

test("拖拽文件入目录：dragover 高亮目标目录行并允许 drop，drop 上抛 from → to", () => {
  const r = rig([
    entry("a.md", "file"),
    entry("sub", "dir"),
    entry("sub/inner.md", "file"),
  ]);
  r.dragStart("a.md");
  assert.equal(r.dragOver("sub"), true, "目录行可放：dragover 被 preventDefault");
  assert.equal(r.dropTargetRow("sub"), true, "目标目录行带落点高亮（is-drop-target）");
  assert.equal(r.drop("sub"), true, "drop 落在目录行上被接受");
  assert.deepEqual(r.moves, [{ from: "a.md", to: "sub/a.md" }], "上抛装配层的移动请求只有一个公式");
  assert.equal(r.dropTargetRow("sub"), false, "drop 后高亮即清");
  // 拖拽态已随 drop 清掉：再无 dragstart 的 dragover 是禁放、drop 不上抛
  assert.equal(r.dragOver("sub"), false, "没有拖拽源时 dragover 不 preventDefault");
  r.drop("sub");
  assert.deepEqual(r.moves.length, 1, "没有拖拽源时 drop 不上抛");
});

test("禁放面：文件行、拖回原位、目录自身与自身子树都不给落点（无高亮、drop 不上抛）", () => {
  const r = rig([
    entry("inbox", "dir"),
    entry("inbox/a.md", "file"),
    entry("inbox/deep", "dir"),
    entry("notes", "dir"),
    entry("notes/a.md", "file"),
  ]);
  r.click("inbox");
  r.click("notes");

  // 文件行不可落
  r.dragStart("notes/a.md");
  assert.equal(r.dragOver("inbox/a.md"), false, "文件行不是落点");
  assert.equal(r.dropTargetRow("inbox/a.md"), false, "文件行没有高亮");
  r.drop("inbox/a.md");
  assert.deepEqual(r.moves, [], "落在文件行上的 drop 不上抛");

  // 拖回原位：inbox/a.md 的直接父目录就是 inbox，移过去 = 同名 no-op
  r.dragStart("inbox/a.md");
  assert.equal(r.dragOver("inbox"), false, "拖回自己的直接父目录（目标 == 源）不可放");

  // 目录拖到它自己那一行、拖入自己的子目录
  r.dragStart("inbox");
  assert.equal(r.dragOver("inbox"), false, "目录拖到它自己那一行不可放");
  assert.equal(r.dragOver("inbox/deep"), false, "目录拖入自己的子目录不可放（canMoveEntry 前缀拒）");
  r.drop("inbox/deep");
  assert.deepEqual(r.moves, [], "禁放面的 drop 一律不上抛");
});

test("dragend 兜底清理：拖出窗口（无 drop）后高亮与拖拽态都不残留", () => {
  const r = rig([
    entry("a.md", "file"),
    entry("sub", "dir"),
  ]);
  r.dragStart("a.md");
  assert.equal(r.dragOver("sub"), true);
  assert.equal(r.dropTargetRow("sub"), true);
  r.dragEnd("a.md");
  assert.equal(r.dropTargetRow("sub"), false, "dragend 清高亮");
  assert.equal(r.dragOver("sub"), false, "dragend 清拖拽源：随后的 dragover 是禁放");
  r.drop("sub");
  assert.deepEqual(r.moves, [], "dragend 之后的 drop 不上抛");
});

test("拖拽目录入目录：drop 后树一字不动（不自绘补丁），watcher 回响后子树在新路径下且展开态随迁", () => {
  const r = rig([
    entry("inbox", "dir"),
    entry("inbox/a.md", "file"),
    entry("inbox/deep", "dir"),
    entry("inbox/deep/b.txt", "file"),
    entry("notes", "dir"),
  ]);
  r.click("inbox");
  r.click("inbox/deep");
  r.click("notes");

  r.dragStart("inbox");
  assert.equal(r.drop("notes"), true);
  assert.deepEqual(r.moves, [{ from: "inbox", to: "notes/inbox" }]);
  // drop 之后、回响之前：树保持原样——唯一收敛通道是 watcher 回响（与改名同纪律）
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["inbox", "inbox/a.md", "inbox/deep", "inbox/deep/b.txt", "notes"],
    "提交后不自绘补丁：旧行原样在场，等回响收敛",
  );

  r.tree.applyChanges(
    dirRenameBatch("inbox", "notes/inbox", [
      { path: "inbox", kind: "dir" },
      { path: "inbox/a.md", kind: "file" },
      { path: "inbox/deep", kind: "dir" },
      { path: "inbox/deep/b.txt", kind: "file" },
    ]),
  );
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["notes", "notes/inbox", "notes/inbox/a.md", "notes/inbox/deep", "notes/inbox/deep/b.txt"],
    "回响后整棵子树在新路径下、两层展开态都随目录搬过去",
  );
  assert.equal(r.caretOpen("notes/inbox"), true, "移动过的目录保持展开");
  assert.equal(r.caretOpen("notes/inbox/deep"), true, "子孙目录的展开态按前缀随迁");
  for (const path of r.renderedPaths()) {
    assert.equal(
      path === "inbox" || path.startsWith("inbox/"),
      false,
      `旧路径 ${path} 不得残留`,
    );
  }
});

test("移动失败即撤登记：endMoveEntry(false) 之后到达的同名批次不再迁移展开态", () => {
  const r = rig([
    entry("inbox", "dir"),
    entry("inbox/a.md", "file"),
    entry("notes", "dir"),
  ]);
  r.click("inbox");
  r.click("notes");

  r.dragStart("inbox");
  r.drop("notes");
  assert.deepEqual(r.moves, [{ from: "inbox", to: "notes/inbox" }]);
  r.tree.endMoveEntry(false); // 后端拒绝（如撞名）：磁盘上什么都没发生

  // 同一窗口内真实发生的只是「删 inbox + 别处新建」——登记已撤，批次按外部删+建收敛
  r.tree.applyChanges(
    dirRenameBatch("inbox", "notes/inbox", [
      { path: "inbox", kind: "dir" },
      { path: "inbox/a.md", kind: "file" },
    ]),
  );
  assert.deepEqual(
    [...r.renderedPaths()].sort(),
    ["notes", "notes/inbox"],
    "目录行在场、子树按折叠态不渲染（外部删除+新建的形态）",
  );
  assert.equal(r.caretOpen("notes/inbox"), false, "登记已撤：展开态不得迁移");
});
