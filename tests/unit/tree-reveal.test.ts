// tests/unit/tree-reveal.test.ts — 文件树的「定位路径」能力（M300，change tab-reveal-in-tree）。
//
// 现场与需求：标签栏能回答「我开着哪些文件」，但回答不了「这个文件在 vault 的哪个位置」——
// 用户看标签上的 `deep.md` 时拿不到它属于哪个目录、旁边还有什么。左栏此前也没有任何一条通道
// 能把某个路径显现出来（`setCurrentPath` 只切 is-current / aria-current，既不展开也不滚动）。
// 本文件钉住新能力（`FileTree.revealPath`）的不变量，不是某一个案例：
//
//   ① **可达才动手**：路径在模型里可达 ⇒ 祖先逐级展开 + 目标行成为当前行 + 只对目标行请求滚动；
//      不可达（文件已被外部删除 / 惰性取数失败）⇒ 空动作，**一点现场都不留**；
//   ② **惰性祖先**：本会话从没展开过的惰性目录下的深标签（会话恢复出来的那一种）也要能定位，
//      取数是「一层一层按需」的，且取数本身不等于展开（确认段对用户不可见）；
//   ③ **取数失败可重试**：`onExpandLazyDir` 同步抛错时不留下「已结束」的取数登记，下次定位/展开
//      重发（M300 把取数登记从 Set 换成 Map<string, Promise<void>>，这条是那一步的回归锚点）。
//
// 这一层用最小 DOM 替身跑真代码（与 tests/unit/tree-increment.test.ts / tree-rename.test.ts 同一
// 手法、同一形状的替身；三者各持一份是刻意的：替身只实现各自被碰到的那些 DOM 面）。
//
// 不覆盖什么：真实的滚动几何（`block: "nearest"` 在真浏览器里「已在视口内就不动」的那一半）归
// 视觉场景 tests/visual/scenes/tab-menu.spec.ts；真实 WKWebView + 真实右键通道归真机场景 69。

import { test } from "node:test";
import assert from "node:assert/strict";
import type { FsEntry } from "../../src/bindings/FsEntry.ts";
import type { FsEntryKind } from "../../src/bindings/FsEntryKind.ts";
import { createFileTree } from "../../src/tree.ts";
import type { FileTree, FileTreeCallbacks } from "../../src/tree.ts";

// ---------------------------------------------------------------------------
// 假 DOM：只实现文件树碰到的那一撮面（append / replaceChildren / insertBefore / replaceChild /
// 类选择器查询 / closest / classList / dataset / hidden / 滚动记录）。
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
  /** 每一次 `scrollIntoView` 的实参（定位的唯一滚动出口，断言按它读）。 */
  readonly scrollCalls: Array<ScrollIntoViewOptions | undefined> = [];
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

  /** 手动派发（不走冒泡：本层只断言树自己的处理）。 */
  fire(type: string, event: FakeEvent = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  focus(): void {}

  scrollIntoView(options?: ScrollIntoViewOptions): void {
    this.scrollCalls.push(options);
  }

  /** 类选择器（本层只用到 `.ft-row` / `.ft-item` / `.ft-children` / `.ft-root-list` 这类简单形态）。 */
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

interface Rig {
  tree: FileTree;
  /** 当前**可见**的行路径（按渲染顺序；折叠目录的子孙不在里面——折叠时不渲染子行）。 */
  visible: () => string[];
  /** 带当前行标记（`is-current`）的行路径。 */
  current: () => string[];
  /** 被请求过 `scrollIntoView` 的行路径 → 每次调用的实参。 */
  scrolled: () => Array<{ path: string; options: ScrollIntoViewOptions | undefined }>;
  /** 某个路径的行元素（不在场即抛错，避免「读不到当成没有」）。 */
  rowOf: (path: string) => FakeEl;
}

function rig(entries: FsEntry[], overrides: Partial<FileTreeCallbacks> = {}): Rig {
  installFakeDocument();
  const mount = new FakeEl("div");
  const callbacks: FileTreeCallbacks = {
    onOpenFile: () => {},
    onOpenVault: () => {},
    onOpenVaultSwitcher: () => {},
    onContextMenu: () => {},
    onInlineEditSubmit: () => {},
    onExpandLazyDir: () => Promise.resolve([]),
    ...overrides,
  };
  const tree = createFileTree(mount as unknown as HTMLElement, callbacks);
  tree.setVault("/vault", entries);
  const rootList = mount.querySelector(".ft-root-list");
  assert.ok(rootList !== null, "根列（.ft-root-list）必须挂上了");

  const walkUl = (ul: FakeEl, out: string[]): void => {
    for (const li of ul.children) {
      if (!li.classes.has("ft-item")) continue;
      out.push(li.dataset.path ?? "");
      const children = li.children.find((child) => child.classes.has("ft-children"));
      // 折叠 = ul[hidden]；子行**根本没有**渲染的情况也走这条（renderRow 只为展开态挂子行）。
      if (children !== undefined && !children.hidden) walkUl(children, out);
    }
  };
  const liOf = (path: string): FakeEl => {
    const li = mount.querySelectorAll(".ft-item").find((node) => node.dataset.path === path);
    assert.ok(li !== undefined, `树里应有 ${path} 这一行（渲染出来的行）`);
    return li;
  };
  return {
    tree,
    visible: () => {
      const out: string[] = [];
      walkUl(rootList as FakeEl, out);
      return out;
    },
    current: () => {
      const out: string[] = [];
      for (const row of mount.querySelectorAll(".ft-row")) {
        if (!row.classes.has("is-current")) continue;
        out.push(row.closest(".ft-item")?.dataset.path ?? "");
      }
      return out;
    },
    scrolled: () => {
      const out: Array<{ path: string; options: ScrollIntoViewOptions | undefined }> = [];
      for (const row of mount.querySelectorAll(".ft-row")) {
        for (const options of row.scrollCalls) {
          out.push({ path: row.closest(".ft-item")?.dataset.path ?? "", options });
        }
      }
      return out;
    },
    rowOf: (path) => {
      const row = liOf(path).querySelector(".ft-row");
      assert.ok(row !== null, `${path} 的 li 里应有行元素`);
      return row;
    },
  };
}

// ---------------------------------------------------------------------------
// ① 可达：展开祖先 + 当前行 + 只滚目标行
// ---------------------------------------------------------------------------

test("定位两级嵌套文件：祖先逐级展开、目标行成为当前行、只对它请求滚动", async () => {
  const r = rig([
    entry("a", "dir"),
    entry("a/b", "dir"),
    entry("a/b/c.md", "file"),
    entry("a/other.md", "file"),
    entry("z.md", "file"),
  ]);
  // 起点：全折叠，树里只有根层两行（目录在前）
  assert.deepEqual(r.visible(), ["a", "z.md"]);
  assert.deepEqual(r.current(), []);
  assert.deepEqual(r.scrolled(), []);

  r.tree.revealPath("a/b/c.md");
  await flush(); // 定位是异步的（惰性祖先要等取数），无惰性祖先时也只让出一拍

  // 祖先逐级展开，同一层的兄弟文件也按排序在位（展开是「把这一层渲染出来」，不是只挑目标）
  assert.deepEqual(r.visible(), ["a", "a/b", "a/b/c.md", "a/other.md", "z.md"]);
  assert.deepEqual(r.current(), ["a/b/c.md"]);
  assert.equal(r.rowOf("a/b/c.md").getAttribute("aria-current"), "true");
  // 只对目标行请求滚动，且是 nearest 语义（已在视口内时一个像素都不动）
  assert.deepEqual(r.scrolled(), [{ path: "a/b/c.md", options: { block: "nearest" } }]);
});

test("重复定位同一路径：幂等（行不重复、当前行不变、兄弟目录不被顺带展开）", async () => {
  const r = rig([
    entry("a", "dir"),
    entry("a/b", "dir"),
    entry("a/b/c.md", "file"),
    entry("a/sibling", "dir"),
    entry("a/sibling/x.md", "file"),
  ]);
  r.tree.revealPath("a/b/c.md");
  await flush();
  const first = r.visible();
  r.tree.revealPath("a/b/c.md");
  await flush();

  assert.deepEqual(r.visible(), first, "同一路径再定位一次不改变树的形状");
  assert.deepEqual(r.current(), ["a/b/c.md"]);
  // 兄弟目录 `a/sibling` 仍是折叠的（定位只展开**目标路径上**的祖先）
  assert.equal(r.visible().includes("a/sibling/x.md"), false);
  assert.equal(r.scrolled().filter((call) => call.path === "a/b/c.md").length, 2);
});

// ---------------------------------------------------------------------------
// ② 不可达：空动作（一点现场都不留），且负向断言配正向对照
// ---------------------------------------------------------------------------

test("路径不在模型里：不展开、不改当前行、不滚动；同一棵树里可达的路径照常能定位", async () => {
  const r = rig([
    entry("a", "dir"),
    entry("a/b", "dir"),
    entry("a/b/x.md", "file"),
    entry("top.md", "file"),
  ]);
  // 先让当前行落在别处：定位失败 MUST NOT 把它带走
  r.tree.setCurrentPath("top.md");
  assert.deepEqual(r.current(), ["top.md"]);

  r.tree.revealPath("a/b/gone.md");
  await flush();

  assert.deepEqual(r.visible(), ["a", "top.md"], "祖先一个都不展开（半截现场比空动作更糟）");
  assert.deepEqual(r.current(), ["top.md"], "当前行不动");
  assert.deepEqual(r.scrolled(), [], "没有任何滚动请求");

  // 正向对照（REVIEW.md 第 1 条）：同一棵树上可达的路径必须给出**不同**的结果——
  // 否则上面三条负向断言可能只是因为「这个替身根本读不到行」而恒真。
  r.tree.revealPath("a/b/x.md");
  await flush();
  assert.deepEqual(r.visible(), ["a", "a/b", "a/b/x.md", "top.md"]);
  assert.deepEqual(r.current(), ["a/b/x.md"]);
  assert.deepEqual(r.scrolled(), [{ path: "a/b/x.md", options: { block: "nearest" } }]);
});

// ---------------------------------------------------------------------------
// ③ 惰性祖先：会话恢复出来的深标签（本会话从没展开过）也要能定位
// ---------------------------------------------------------------------------

test("惰性祖先：逐层按需取回，取数本身不展开（确认段对用户不可见）", async () => {
  const scanned: string[] = [];
  const r = rig([entry("a", "dir", true)], {
    onExpandLazyDir: async (path) => {
      scanned.push(path);
      if (path === "a") return [entry("a/b", "dir", true)];
      if (path === "a/b") return [entry("a/b/c.md", "file")];
      return [];
    },
  });
  assert.deepEqual(r.visible(), ["a"], "起点：惰性目录只有自己一行（子孙不在枚举结果里）");

  r.tree.revealPath("a/b/c.md");
  // 确认段是异步的（每一级都要等取数），断言前先放行微任务
  assert.deepEqual(scanned, ["a"]);
  assert.deepEqual(r.visible(), ["a"], "取数落地之前不渲染、也不假装展开");
  await flush();

  assert.deepEqual(scanned, ["a", "a/b"], "逐层取回，一层一次（同一层不重复发命令）");
  assert.deepEqual(r.visible(), ["a", "a/b", "a/b/c.md"], "取回后逐级展开，目标行在场");
  assert.deepEqual(r.current(), ["a/b/c.md"]);
  assert.deepEqual(r.scrolled(), [{ path: "a/b/c.md", options: { block: "nearest" } }]);
});

test("惰性取数失败：定位是空动作；同一目录下次重试（取数登记不滞留「已结束」）", async () => {
  let calls = 0;
  const r = rig([entry("a", "dir", true)], {
    onExpandLazyDir: (path) => {
      calls += 1;
      // 第一次同步抛错（最苛刻的实现形态），第二次如实返回一层
      if (calls === 1) throw new Error("scan failed");
      assert.equal(path, "a");
      return Promise.resolve([entry("a/x.md", "file")]);
    },
  });

  r.tree.revealPath("a/x.md");
  await flush();
  assert.deepEqual(r.visible(), ["a"], "取数失败：不展开、不假装定位成功");
  assert.deepEqual(r.current(), []);
  assert.deepEqual(r.scrolled(), []);

  r.tree.revealPath("a/x.md");
  await flush();
  assert.deepEqual(r.visible(), ["a", "a/x.md"], "下次定位重发命令并成功（失败不入「已取回」）");
  assert.deepEqual(r.current(), ["a/x.md"]);
});

test("惰性取数失败后按展开路径重试同样成立（同一条通道、同一份登记）", async () => {
  let calls = 0;
  const r = rig([entry("a", "dir", true)], {
    onExpandLazyDir: () => {
      calls += 1;
      if (calls === 1) throw new Error("scan failed");
      return Promise.resolve([entry("a/x.md", "file")]);
    },
  });
  const row = r.rowOf("a");

  row.fire("click"); // 第一次展开：取数失败，子列表留空（MUST NOT 渲染成「空目录」以外的假象）
  await flush();
  assert.deepEqual(r.visible(), ["a"]);
  row.fire("click"); // 收起
  row.fire("click"); // 再展开：重发命令并成功
  await flush();

  assert.deepEqual(r.visible(), ["a", "a/x.md"]);
});
