// tests/unit/tree-lazy-fetch.test.ts — 惰性目录取数的「世代守卫」（M555，finding：换 vault 时在途
// 取数把旧条目并进新模型）。
//
// 现场：`fetchLazyChildren` 的续段在 `await` 之后直接 `mergeEntry` + 写 `lazyFetched`。取数期间
// 用户切了 vault（`setVault` 清空 nodes / 展开态 / 两张取数登记表并整树重绘），迟到的结果落地时
// 会：① 把旧 vault 的条目写进全局 `nodes`（新树里出现旧条目，`hasDir` 看见孤儿目录）；② 把旧
// vault 的路径记成「已取回」，新 vault 里同名目录于是永不取数；③ 在失败支删掉新 vault 在途的
// 同路径登记（去重失效，重发命令）。
//
// 本文件钉住的不变量：
//   ① 换代后落地的**成功**结果整段作废：不合并、不标记已取回、不动登记表；
//   ② 换代后落地的**失败**同样不动登记表——新 vault 的同一路径取数不受牵连；
//   ③ 同 vault 的正常路径不回归：取回即渲染、同一目录不重复发命令、失败仍可重试。
//
// 这一层用最小 DOM 替身跑真代码（与 tree-reveal / tree-increment / tree-rename 同一手法；替身
// 各自持一份是刻意的，只实现各自被碰到的那些 DOM 面）。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FsEntry } from "../../src/bindings/FsEntry.ts";
import type { FsEntryKind } from "../../src/bindings/FsEntryKind.ts";
import { createFileTree } from "../../src/tree.ts";
import type { FileTree, FileTreeCallbacks } from "../../src/tree.ts";

// ---------------------------------------------------------------------------
// 假 DOM：只实现文件树碰到的那一撮面（append / replaceChildren / insertBefore / 类选择器查询 /
// closest / classList / dataset / hidden）。与 tree-reveal.test.ts 同形。
// ---------------------------------------------------------------------------

interface FakeEvent {
  key?: string;
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
  id = "";
  hidden = false;
  tabIndex = 0;
  value = "";

  constructor(tagName: string) {
    this.tagName = tagName;
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

  focus(): void {}
  select(): void {}
  scrollIntoView(): void {}

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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Gate<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** 手动放行的取数闸门：把「在途」这件事变成测试能精确控制的时刻。 */
function gate<T>(): Gate<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Rig {
  tree: FileTree;
  mount: FakeEl;
  /** 每一次 `onExpandLazyDir` 的路径（按发生顺序）。 */
  calls: () => string[];
  /** 当前**可见**的行路径（按渲染顺序；折叠目录的子孙不在里面）。 */
  visible: () => string[];
  /** 某个路径的行元素（不在场即抛错，避免「读不到当成没有」）。 */
  rowOf: (path: string) => FakeEl;
}

function rig(
  entries: FsEntry[],
  gates: Array<Gate<FsEntry[]>>,
  overrides: Partial<FileTreeCallbacks> = {},
): Rig {
  installFakeDocument();
  const mount = new FakeEl("div");
  const scanned: string[] = [];
  const callbacks: FileTreeCallbacks = {
    onOpenFile: () => {},
    onOpenVault: () => {},
    onOpenVaultSwitcher: () => {},
    onContextMenu: () => {},
    onInlineEditSubmit: () => {},
    onMoveEntry: () => {},
    onExpandLazyDir: (path) => {
      scanned.push(path);
      const next = gate<FsEntry[]>();
      gates.push(next);
      return next.promise;
    },
    ...overrides,
  };
  const tree = createFileTree(mount as unknown as HTMLElement, callbacks);
  tree.setVault("/vault", entries);

  const walkUl = (ul: FakeEl, out: string[]): void => {
    for (const li of ul.children) {
      if (!li.classes.has("ft-item")) continue;
      out.push(li.dataset.path ?? "");
      const children = li.children.find((child) => child.classes.has("ft-children"));
      if (children !== undefined && !children.hidden) walkUl(children, out);
    }
  };
  return {
    tree,
    mount,
    calls: () => [...scanned],
    visible: () => {
      const out: string[] = [];
      const rootList = mount.querySelector(".ft-root-list");
      assert.ok(rootList !== null, "根列（.ft-root-list）必须挂上了");
      walkUl(rootList, out);
      return out;
    },
    rowOf: (path) => {
      const li = mount.querySelectorAll(".ft-item").find((node) => node.dataset.path === path);
      assert.ok(li !== undefined, `树里应有 ${path} 这一行（渲染出来的行）`);
      const row = li.querySelector(".ft-row");
      assert.ok(row !== null, `${path} 的 li 里应有行元素`);
      return row;
    },
  };
}

// ---------------------------------------------------------------------------
// ① 换代后的成功结果整段作废
// ---------------------------------------------------------------------------

test("换 vault 后在途取数落地：旧条目不并进新模型（hasDir 看不到孤儿目录）", async () => {
  const gates: Array<Gate<FsEntry[]>> = [];
  const r = rig([entry("a", "dir", true)], gates);

  r.rowOf("a").fire("click"); // 展开惰性目录 → 取数在途
  assert.deepEqual(r.calls(), ["a"]);

  // 用户切了 vault：新 vault 里根本没有 a 这个目录
  r.tree.setVault("/other-vault", [entry("other", "dir"), entry("other/x.md", "file")]);
  assert.deepEqual(r.visible(), ["other"]);

  // 旧 vault 的取数迟到了：这一层属于旧模型，必须整段丢弃
  gates[0].resolve([entry("a/legacy", "dir"), entry("a/legacy/n.md", "file")]);
  await flush();

  assert.equal(r.tree.hasDir("a/legacy"), false, "旧条目不许写进新模型（hasDir 的孤儿目录现场）");
  assert.equal(r.tree.hasDir("a"), false, "旧 vault 的目录本身也不该回来");
  assert.deepEqual(r.visible(), ["other"], "新树的行不受旧结果影响");
  assert.equal(
    r.mount.querySelectorAll(".ft-item").some((li) => (li.dataset.path ?? "").startsWith("a/")),
    false,
    "DOM 里不出现旧条目",
  );

  // 正向对照（REVIEW.md「断言等价于子串」条）：同一个新模型里真实存在的目录必须判 true，
  // 否则上面两条 false 可能只是因为 hasDir 在这个替身上恒假。
  assert.equal(r.tree.hasDir("other"), true, "新 vault 自己的目录照常可判定");
});

test("换 vault 后旧结果不把同路径记成「已取回」：新 vault 展开照旧发命令并渲染", async () => {
  const gates: Array<Gate<FsEntry[]>> = [];
  const r = rig([entry("a", "dir", true)], gates);

  r.rowOf("a").fire("click");
  assert.deepEqual(r.calls(), ["a"]);

  // 新 vault 里有一个同名惰性目录
  r.tree.setVault("/other-vault", [entry("a", "dir", true)]);
  // 旧结果先一步落地（此时新 vault 的同名目录还没展开）
  gates[0].resolve([entry("a/old-dir", "dir")]);
  await flush();
  assert.equal(r.tree.hasDir("a/old-dir"), false, "旧结果不合并");

  // 新 vault 的同名目录必须还能取数：旧结果不许替它写下「已取回」
  r.rowOf("a").fire("click");
  assert.deepEqual(r.calls(), ["a", "a"], "新 vault 的展开照旧发命令（取数登记未被旧结果污染）");
  assert.deepEqual(r.visible(), ["a"], "取数在途：不渲染成空目录，也不出现旧条目");

  gates[1].resolve([entry("a/new.md", "file")]);
  await flush();
  assert.deepEqual(r.visible(), ["a", "a/new.md"], "新 vault 自己的结果照常渲染");
  assert.equal(r.tree.hasDir("a/old-dir"), false, "旧条目始终不出现");
});

// ---------------------------------------------------------------------------
// ② 换代后的失败不动新 vault 的登记表
// ---------------------------------------------------------------------------

test("换 vault 后旧取数失败：不撤掉新 vault 在途的同一路径登记（去重仍生效）", async () => {
  const gates: Array<Gate<FsEntry[]>> = [];
  const r = rig([entry("a", "dir", true)], gates);

  r.rowOf("a").fire("click"); // 旧 vault 的取数在途
  r.tree.setVault("/other-vault", [entry("a", "dir", true)]);
  r.rowOf("a").fire("click"); // 新 vault 的同名目录展开 → 第二次取数在途
  assert.deepEqual(r.calls(), ["a", "a"]);

  gates[0].reject(new Error("scan failed")); // 旧 vault 的那一次失败
  await flush();

  // 收起再展开：若旧失败把新 vault 的登记删了，这里会发第三次命令
  r.rowOf("a").fire("click");
  r.rowOf("a").fire("click");
  assert.deepEqual(r.calls(), ["a", "a"], "旧失败不触碰新 vault 的取数登记（同一目录仍只发一次）");

  gates[1].resolve([entry("a/x.md", "file")]);
  await flush();
  assert.deepEqual(r.visible(), ["a", "a/x.md"]);
});

// ---------------------------------------------------------------------------
// ③ 空态（树同样被换掉）走同一道守卫
// ---------------------------------------------------------------------------

test("切空态后在途取数落地：不合并进已撤下的模型", async () => {
  const gates: Array<Gate<FsEntry[]>> = [];
  const r = rig([entry("a", "dir", true)], gates);

  r.rowOf("a").fire("click");
  r.tree.showEmpty("正在恢复上次打开的 vault……");

  gates[0].resolve([entry("a/child", "dir")]);
  await flush();

  assert.equal(r.tree.hasDir("a/child"), false, "空态下迟到的结果不写进模型");
});

// ---------------------------------------------------------------------------
// ④ 同 vault 正常路径不回归
// ---------------------------------------------------------------------------

test("同 vault：取回即渲染、同一目录不重复发命令、失败仍可重试", async () => {
  const gates: Array<Gate<FsEntry[]>> = [];
  const r = rig([entry("a", "dir", true)], gates);

  r.rowOf("a").fire("click");
  assert.deepEqual(r.visible(), ["a"], "取数在途：不渲染成空目录");
  gates[0].resolve([entry("a/b", "dir", true), entry("a/top.md", "file")]);
  await flush();
  assert.deepEqual(r.visible(), ["a", "a/b", "a/top.md"], "取回后按排序渲染（目录在前）");

  // 收起再展开：已取回的目录不再发命令
  r.rowOf("a").fire("click");
  r.rowOf("a").fire("click");
  assert.deepEqual(r.calls(), ["a"], "同一目录只发一次命令（lazyFetched 生效）");

  // 子孙里的惰性目录等它自己被展开时才取下一层（点开哪一层付哪一层）
  r.rowOf("a/b").fire("click");
  assert.deepEqual(r.calls(), ["a", "a/b"], "下一层惰性目录按需另发一次");
  gates[1].reject(new Error("scan failed"));
  await flush();
  assert.deepEqual(r.visible(), ["a", "a/b", "a/top.md"], "失败不渲染成空目录");

  // 失败不入「已取回」：再展开重发
  r.rowOf("a/b").fire("click");
  r.rowOf("a/b").fire("click");
  assert.deepEqual(r.calls(), ["a", "a/b", "a/b"], "失败后重试重发命令");
  gates[2].resolve([entry("a/b/deep.md", "file")]);
  await flush();
  assert.deepEqual(r.visible(), ["a", "a/b", "a/b/deep.md", "a/top.md"]);
});
