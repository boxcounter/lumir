// src/tree.ts 的增量打补丁行为（M245，backlog 32 / finding
// `20260925-worker-fix-closeout-bug-watch`）：外部新建目录（含其中文件）后，watch 增量批次
// 必须在树里**从无到有**长出目录行——这是那条 finding 的前端回归锚点。
//
// 这一层用最小 DOM 替身跑真代码（与 tests/unit/tree-menu.test.ts、vault-switcher.test.ts 同一
// 手法、同一形状：替身只实现各自被碰到的那些 DOM 面）。真实渲染与像素、真机 WKWebView 下的
// 时序归视觉门禁与真机场景 36（tests/unit/README.md 的分层口径）。
//
// 覆盖什么：created/modified 的 upsert（目录行与文件行）、父缺失时的丢弃、同批内父先于子的
// 排序不变式、重放不产生重复行、deleted 级联移除目录行。
// 不覆盖什么：内联编辑的行 DOM（beginRename / beginCreate 要真 DOM 的 replaceChild 语义，
// 由真机场景 47 覆盖）、展开态的视觉表现（视觉门禁）。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FsChange } from "../../src/bindings/FsChange.ts";
import type { FsChangeKind } from "../../src/bindings/FsChangeKind.ts";
import type { FsEntry } from "../../src/bindings/FsEntry.ts";
import type { FsEntryKind } from "../../src/bindings/FsEntryKind.ts";
import { createFileTree, patchAttachmentPaths } from "../../src/tree.ts";
import type { FileTree, FileTreeCallbacks } from "../../src/tree.ts";

// ---------------------------------------------------------------------------
// 假 DOM：只实现文件树碰到的那一撮面（append / replaceChildren / insertBefore /
// 类选择器查询 / closest / classList / dataset / hidden）。
// ---------------------------------------------------------------------------

interface FakeEvent {
  metaKey?: boolean;
  clientX?: number;
  clientY?: number;
  preventDefault?(): void;
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

  /** 类选择器（本层只用到 `.ft-row` / `.ft-item` / `.ft-root-list` 这类简单形态）。 */
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
  (globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeEl(tag),
  };
}

// ---------------------------------------------------------------------------
// 夹具与读数口
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

function noopCallbacks(): FileTreeCallbacks {
  return {
    onOpenFile: () => {},
    onOpenVault: () => {},
    onOpenVaultSwitcher: () => {},
    onContextMenu: () => {},
    onInlineEditSubmit: () => {},
    onExpandLazyDir: () => Promise.resolve([]),
  };
}

/** 脚手架：装假 DOM、建树、返回「根列行名」等读数口。 */
function rig(entries: FsEntry[]): {
  tree: FileTree;
  rootRows: () => FakeEl[];
  rootNames: () => string[];
  rowOf: (path: string) => FakeEl;
  childPaths: (path: string) => string[];
} {
  installFakeDocument();
  const mount = new FakeEl("div");
  const tree = createFileTree(mount as unknown as HTMLElement, noopCallbacks());
  tree.setVault("/vault", entries);
  const rootList = mount.querySelector(".ft-root-list");
  assert.ok(rootList !== null, "根列（.ft-root-list）必须挂上了");
  const rootRows = () =>
    (rootList as FakeEl).children.map((li) => li.querySelector(".ft-row") as FakeEl);
  const rootNames = () =>
    rootRows().map((row) => row.querySelector(".ft-name")?.textContent ?? "");
  const liOf = (path: string) => {
    const li = (rootList as FakeEl)
      .querySelectorAll(".ft-item")
      .find((n) => n.dataset.path === path);
    assert.ok(li !== undefined, `根列里应有 ${path} 这一行`);
    return li;
  };
  const rowOf = (path: string) => liOf(path).querySelector(".ft-row") as FakeEl;
  // 该行 DOM 里已渲染出来的孙行路径（读 .ft-item 的 dataset.path）
  const childPaths = (path: string) =>
    liOf(path)
      .querySelectorAll(".ft-item")
      .map((n) => n.dataset.path);
  return { tree, rootRows, rootNames, rowOf, childPaths };
}

// ---------------------------------------------------------------------------
// 外部新建目录（finding 的那条现场）
// ---------------------------------------------------------------------------

test("外部新建目录（含其中文件）：目录行从无到有，按「目录在前」落位", () => {
  const r = rig([entry("a.md", "file"), entry("z.md", "file")]);
  assert.deepEqual(r.rootNames(), ["a.md", "z.md"], "起点只有两个文件行");

  // 与后端实测批次逐字同形（M245 真机日志：Created dir + Created 目录内文件）
  r.tree.applyChanges([
    change("created", "restyle-dir", "dir"),
    change("created", "restyle-dir/note-in-dir.md", "file"),
  ]);

  assert.deepEqual(r.rootNames(), ["restyle-dir", "a.md", "z.md"], "目录行必须出现且排在最前");
  const dirRow = r.rowOf("restyle-dir");
  assert.ok(dirRow.classes.has("ft-dir"), "新行必须是目录行（ft-dir），不是文件行");
  assert.ok(dirRow.querySelector(".ft-caret") !== null, "目录行带 caret");
  assert.equal(dirRow.title, "restyle-dir");
});

test("新建的目录行可展开：展开后目录内文件行从无到有", () => {
  const r = rig([entry("a.md", "file")]);
  r.tree.applyChanges([
    change("created", "restyle-dir", "dir"),
    change("created", "restyle-dir/note-in-dir.md", "file"),
  ]);

  // 目录默认折叠：子行不在 DOM 里（挂载等展开时从模型渲染）
  assert.deepEqual(r.childPaths("restyle-dir"), []);

  r.rowOf("restyle-dir").fire("click");
  assert.deepEqual(r.childPaths("restyle-dir"), ["restyle-dir/note-in-dir.md"], "展开后子文件行出现");
});

test("同批内子事件先于父事件到达时仍按深度排序（FSEvents 不保证顺序）", () => {
  const r = rig([entry("a.md", "file")]);
  r.tree.applyChanges([
    change("created", "restyle-dir/note-in-dir.md", "file"),
    change("created", "restyle-dir", "dir"),
  ]);
  assert.deepEqual(r.rootNames(), ["restyle-dir", "a.md"], "父先落模型，子才挂得住");
});

test("反向对照：父缺失的 created 被丢弃（上一条断言真有区分度）", () => {
  const r = rig([entry("a.md", "file")]);
  // 没有 restyle-dir 这一条时，子条目无处可挂——这正是「目录行不进来」时的失败形态
  r.tree.applyChanges([change("created", "ghost/x.md", "file")]);
  assert.deepEqual(r.rootNames(), ["a.md"], "父不在模型里就不该凭空长出子树");
});

test("重放同一批增量不产生重复行（created / modified 都是 upsert）", () => {
  const r = rig([entry("a.md", "file")]);
  const batch = [
    change("created", "restyle-dir", "dir"),
    change("created", "restyle-dir/note-in-dir.md", "file"),
  ];
  r.tree.applyChanges(batch);
  r.tree.applyChanges([change("modified", "restyle-dir", "dir")]);
  assert.deepEqual(r.rootNames(), ["restyle-dir", "a.md"], "重放不叠行");
});

test("外部删除目录：目录行连同其中条目一起从树上消失", () => {
  const r = rig([entry("a.md", "file")]);
  r.tree.applyChanges([
    change("created", "restyle-dir", "dir"),
    change("created", "restyle-dir/note-in-dir.md", "file"),
  ]);
  r.rowOf("restyle-dir").fire("click"); // 展开，让子行真的挂在 DOM 上
  assert.deepEqual(r.childPaths("restyle-dir"), ["restyle-dir/note-in-dir.md"]);
  r.tree.applyChanges([change("deleted", "restyle-dir", null)]);
  assert.deepEqual(r.rootNames(), ["a.md"]);
  assert.equal(
    r.rootRows().some((row) => row.querySelectorAll(".ft-item").length > 0),
    false,
    "被删目录的子树不得留下孤儿行",
  );
});

// ---------------------------------------------------------------------------
// 惰性条目（change vault-open-ignore-set §4.3）：被 vault 自己的忽略声明挡住的目录
// **行可见**、子孙按需取回一层。这一组钉住展开通道的三条口径：取数走命令、取数在途
// 不渲染成「空目录」也不重复发命令、失败不标记已取回（下次展开重试）。
// ---------------------------------------------------------------------------

/** 惰性目录专用的脚手架：能记录按需取数的调用，并能手动放行 / 让它失败。 */
function lazyRig(initial: FsEntry[]): {
  tree: FileTree;
  requested: string[];
  /** 让下一次取数返回这些条目（放行在途的那一次）。 */
  resolveWith: (entries: FsEntry[]) => void;
  failNext: () => void;
  childrenOf: (path: string) => string[];
  rowOf: (path: string) => FakeEl;
  click: (path: string) => void;
} {
  installFakeDocument();
  const mount = new FakeEl("div");
  const requested: string[] = [];
  let pending: { resolve: (entries: FsEntry[]) => void; reject: (e: unknown) => void } | null = null;
  const callbacks: FileTreeCallbacks = {
    ...noopCallbacks(),
    onExpandLazyDir: (path) => {
      requested.push(path);
      return new Promise<FsEntry[]>((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
  };
  const tree = createFileTree(mount as unknown as HTMLElement, callbacks);
  tree.setVault("/vault", initial);
  const liOf = (path: string) => mount.querySelectorAll(".ft-item").find((n) => n.dataset.path === path);
  const rowOf = (path: string) => {
    const row = liOf(path)?.querySelector(".ft-row");
    assert.ok(row !== null && row !== undefined, `要点的行 ${path} 必须在 DOM 里`);
    return row;
  };
  return {
    tree,
    requested,
    resolveWith: (entries) => pending?.resolve(entries),
    failNext: () => pending?.reject(new Error("fs_scan_failed")),
    childrenOf: (path) =>
      (liOf(path)?.querySelector(".ft-children")?.children ?? []).map((li) => li.dataset.path),
    rowOf,
    click: (path) => rowOf(path).fire("click"),
  };
}

/** 让微任务链跑完（取数回调是 promise 链，不是同步的）。 */
const flushMicrotasks = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

test("惰性目录展开：发一次按需取数，子行按排序并入，取数在途不渲染成空目录", async () => {
  const r = lazyRig([
    { path: ".local", kind: "dir", size: 0, mtime_ms: null, lazy: true },
    entry("notes.md", "file"),
  ]);
  r.click(".local");
  assert.deepEqual(r.requested, [".local"], "展开惰性目录必须发一次按需取数命令");
  assert.deepEqual(
    r.childrenOf(".local"),
    [],
    "取数在途：子列表为空（子孙本来就不在装载结果里）——它不是「已取回的空目录」",
  );
  assert.equal(r.rowOf(".local").querySelector(".ft-caret")?.classes.has("is-open"), true);

  // 在途收起再展开：MUST NOT 重复发命令（同一次取数回来即可）
  r.click(".local");
  r.click(".local");
  assert.deepEqual(r.requested, [".local"], "取数在途重复展开不重复发命令");

  r.resolveWith([
    entry(".local/tutorial.md", "file", true),
    { path: ".local/deep", kind: "dir", size: 0, mtime_ms: null, lazy: true },
  ]);
  await flushMicrotasks();
  assert.deepEqual(
    r.childrenOf(".local"),
    [".local/deep", ".local/tutorial.md"],
    "取回后子行按既有排序并入（目录在前）",
  );
  // 已取回：再收起 / 展开不再发命令
  r.click(".local");
  r.click(".local");
  assert.deepEqual(r.requested, [".local"], "已取回的惰性目录不再发命令");
  assert.deepEqual(r.childrenOf(".local"), [".local/deep", ".local/tutorial.md"]);
});

test("惰性目录取数失败：不标记已取回、不渲染成空目录，下次展开重试", async () => {
  const r = lazyRig([{ path: ".local", kind: "dir", size: 0, mtime_ms: null, lazy: true }]);
  r.click(".local");
  r.failNext();
  await flushMicrotasks();
  assert.deepEqual(r.childrenOf(".local"), [], "失败后这一层仍是空的（不伪造条目）");
  r.click(".local"); // 收起
  r.click(".local"); // 再展开 → 重试
  assert.deepEqual(r.requested, [".local", ".local"], "失败过的目录下次展开必须重试");
  r.resolveWith([entry(".local/tutorial.md", "file", true)]);
  await flushMicrotasks();
  assert.deepEqual(r.childrenOf(".local"), [".local/tutorial.md"]);
});

test("增量插入的惰性目录仍是未取回态：展开走按需取数；非惰性目录不发命令", () => {
  const r = lazyRig([entry("a.md", "file")]);
  r.tree.applyChanges([change("created", ".local", "dir", true)]);
  r.tree.applyChanges([change("created", "plain", "dir")]);
  r.click(".local");
  assert.deepEqual(r.requested, [".local"], "created 事件带回 lazy⇒true 时，展开仍走按需取数");
  r.click("plain");
  assert.deepEqual(r.requested, [".local"], "非惰性目录的子孙已在装载/补全结果里，不发命令");
});

test("换 vault 后惰性目录的「已取回」登记作废：新 vault 的展开重新取数", async () => {
  const r = lazyRig([{ path: ".local", kind: "dir", size: 0, mtime_ms: null, lazy: true }]);
  r.click(".local");
  r.resolveWith([entry(".local/tutorial.md", "file", true)]);
  await flushMicrotasks();
  assert.deepEqual(r.childrenOf(".local"), [".local/tutorial.md"]);

  r.tree.setVault("/vault", [
    { path: ".local", kind: "dir", size: 0, mtime_ms: null, lazy: true },
  ]);
  r.click(".local");
  assert.deepEqual(r.requested, [".local", ".local"], "换 vault 后重新取数");
});

// ---------------------------------------------------------------------------
// 附件索引的增量口径（change vault-open-ignore-set §4.6 的前端一半）
//
// 反例（本 change 之前必然发生）：`HANDOFF.md` 被 `.gitignore` 声明，外部改写它 ⇒ 事件投递
// ⇒ 它一度进附件索引 ⇒ 重开后又不在——索引从「磁盘 + 规则的纯函数」退化成「事件历史的函数」。
// ---------------------------------------------------------------------------

test("附件索引增量：惰性条目的 created 与 modified 都不进索引，deleted 无条件移除", () => {
  // created 与 modified **同路**（r3 评审 P2-1 的漏词：既有分支就是一个 else 支）
  for (const kind of ["created", "modified"] as const) {
    const paths = ["a.md"];
    assert.deepEqual(
      patchAttachmentPaths(paths, change(kind, "HANDOFF.md", "file", true)),
      ["a.md"],
      `${kind} 的惰性文件 MUST NOT 进附件索引`,
    );
  }
  // 非惰性的照旧进索引（幂等）
  assert.deepEqual(patchAttachmentPaths(["a.md"], change("created", "b.md", "file")), ["a.md", "b.md"]);
  assert.deepEqual(patchAttachmentPaths(["a.md"], change("modified", "a.md", "file")), ["a.md"]);
  // 目录条目不进索引
  assert.deepEqual(patchAttachmentPaths(["a.md"], change("created", "docs", "dir")), ["a.md"]);
  // deleted：无条件移除（含子孙级联），且**不消费 lazy**——惰性文件本来就不在索引里，
  // 删除方向仍是空操作；真正在索引里的条目被删时必须摘掉。
  assert.deepEqual(
    patchAttachmentPaths(["docs/c.md", "docs", "a.md"], change("deleted", "docs", null)),
    ["a.md"],
    "目录删除连同子孙一起出索引（与树 applyChanges 的级联删除同口径）",
  );
  const gone = patchAttachmentPaths(["HANDOFF.md"], change("deleted", "HANDOFF.md", null, true));
  assert.deepEqual(gone, [], "deleted 不消费 lazy：索引里有就一定要摘掉（幂等）");
});
