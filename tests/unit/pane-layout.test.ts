// pane 容器纯逻辑单测（M315，change pane-system-split-view 的 tasks.md 1.1 / 设计来源 design.md
// §4 装配形状、§6 会话所有权）。
//
// 为什么这一层能测：容器不碰 DOM、不碰 EditorView，标签与句柄都是调用方注入的不透明对象
//（这里用**真 `EditorState`** 承载标签内容，句柄用替身——真 `EditorHandle` 需要 DOM，
// 同 tests/unit/README.md 的替身口径）。断言的三个不变量：pane 数 ≤2、同一路径至多一个 pane、
// 移动不重建标签对象（EditorState 原样随行）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { MAX_PANES, createPaneLayout } from "../../src/pane-layout.ts";
import type { Pane, PaneLayout } from "../../src/pane-layout.ts";

/** 标签：`path` 是账本的判重键，`state` 承载「会话随移动原样迁移」的证据。 */
interface Tab {
  readonly path: string | undefined;
  readonly state: EditorState;
}

/** 编辑器句柄替身：只记自己属于哪个 pane、有没有被归还（容器不解释句柄）。 */
interface Handle {
  readonly paneId: number;
  disposed: boolean;
}

interface Rig {
  layout: PaneLayout<Tab, Handle>;
  handles: Handle[];
  disposed: Handle[];
  /** 建标签（真 EditorState）；`doc` 缺省取 path。 */
  makeTab(path: string | undefined, doc?: string): Tab;
  /** 「打开」一个文件；返回登记进账本的标签。 */
  open(path: string | undefined, doc?: string, target?: number): Tab;
  /** 每次 `create` 真的被调用时 +1（判重不该新建时保持 0）。 */
  created: { count: number };
}

function createRig(): Rig {
  const handles: Handle[] = [];
  const disposed: Handle[] = [];
  const created = { count: 0 };
  const layout = createPaneLayout<Tab, Handle>({
    createHandle: (paneId) => {
      const handle: Handle = { paneId, disposed: false };
      handles.push(handle);
      return handle;
    },
    disposeHandle: (handle) => {
      handle.disposed = true;
      disposed.push(handle);
    },
  });
  const makeTab = (path: string | undefined, doc?: string): Tab => ({
    path,
    state: EditorState.create({ doc: doc ?? path ?? "" }),
  });
  return {
    layout,
    handles,
    disposed,
    created,
    makeTab,
    open: (path, doc, target) =>
      layout.openTab(
        path,
        () => {
          created.count += 1;
          return makeTab(path, doc);
        },
        target,
      ),
  };
}

/** 全容器扫描：同一路径出现在两个 pane 即为违规（返回重复的路径）。不变量 2 的直接判据。 */
function duplicatePaths(layout: PaneLayout<Tab, Handle>): string[] {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const pane of layout.panes()) {
    for (const tab of pane.tabs) {
      if (tab.path === undefined) continue;
      if (seen.has(tab.path)) dup.push(tab.path);
      else seen.add(tab.path);
    }
  }
  return dup;
}

function pathsOf(pane: Pane<Tab, Handle>): Array<string | undefined> {
  return pane.tabs.map((tab) => tab.path);
}

// ---------------------------------------------------------------------------
// 构造与上限
// ---------------------------------------------------------------------------

test("构造即单 pane 常态：root pane 在场、为空、为活跃，句柄一套", () => {
  const rig = createRig();
  const { layout } = rig;
  assert.equal(MAX_PANES, 2);
  assert.equal(layout.panes().length, 1);
  assert.equal(layout.isSplit(), false);
  assert.equal(layout.active().id, 1);
  assert.deepEqual(pathsOf(layout.active()), [], "root pane 空态合法");
  assert.equal(layout.active().foreground, -1);
  assert.equal(layout.activeTab(), undefined);
  assert.equal(rig.handles.length, 1, "root pane 的句柄由 deps 产出一次");
  assert.equal(layout.activeHandle(), layout.active().handle, "活跃句柄 = 活跃 pane 的句柄");
  assert.equal(layout.activeHandle(), rig.handles[0]);
});

test("split：空 pane 出现在活跃 pane 右侧并成为活跃；上限二——第三次 split 无操作", () => {
  const rig = createRig();
  const { layout } = rig;
  const first = rig.open("a.md");
  assert.equal(layout.active().foreground, 0);

  const second = layout.split();
  assert.notEqual(second, null);
  assert.equal(layout.panes().length, 2);
  assert.equal(layout.isSplit(), true);
  assert.deepEqual(
    layout.panes().map((pane) => pane.id),
    [1, 2],
    "新 pane 恒在活跃 pane 右侧（列表末位）",
  );
  assert.equal(layout.active().id, 2, "新 pane 成为活跃 pane");
  assert.deepEqual(pathsOf(layout.active()), [], "新 pane 是空态");
  assert.equal(layout.panes()[0].tabs[0], first, "原 pane 的标签不动");
  assert.equal(rig.handles.length, 2);
  assert.notEqual(rig.handles[0], rig.handles[1], "两个 pane 的句柄互不相同");

  const third = layout.split();
  assert.equal(third, null, "已达上限：返回 null，无操作、无报错");
  assert.equal(layout.panes().length, 2);
  assert.equal(layout.active().id, 2, "无操作不移动活跃指针");
  assert.equal(rig.handles.length, 2, "被拒的 split 不泄漏句柄");
});

// ---------------------------------------------------------------------------
// close 并入语义与活跃落点
// ---------------------------------------------------------------------------

test("close：单 pane 时无操作", () => {
  const rig = createRig();
  rig.open("a.md");
  assert.equal(rig.layout.close(), null);
  assert.equal(rig.layout.panes().length, 1);
  assert.deepEqual(pathsOf(rig.layout.active()), ["a.md"]);
});

test("close：被收起 pane 的标签按序并入，其前台标签成为目标前台，目标成为活跃", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  const b = rig.open("b.md"); // pane 1: [a, b]，前台 b
  layout.split(); // → pane 2 活跃
  const c = rig.open("c.md");
  const d = rig.open("d.md"); // pane 2: [c, d]，前台 d

  const closed = layout.close();
  assert.notEqual(closed, null);
  assert.equal(closed?.id, 2);
  assert.equal(layout.panes().length, 1, "回到单 pane 常态");
  assert.equal(layout.active().id, 1, "存活 pane 成为活跃 pane");
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md", "b.md", "c.md", "d.md"], "按序并入、不丢标签");
  assert.equal(layout.panes()[0].tabs[2], c, "并入的是**同一个标签对象**（不重建）");
  assert.equal(layout.panes()[0].tabs[3], d);
  assert.equal(layout.activeTab(), d, "被收起 pane 的前台标签成为目标前台");
  assert.equal(layout.activeTab()?.state, d.state, "随标签带走的是同一份 EditorState");
  assert.equal(closed?.tabs.length, 0, "已收起的 pane 不再持有标签");
  assert.equal(closed?.foreground, -1);
  assert.deepEqual(duplicatePaths(layout), [], "并入不产生重复归属");
  assert.equal(rig.disposed.length, 1, "被收起 pane 的句柄恰好归还一次");
  assert.equal(rig.disposed[0], rig.handles[1]);
  assert.equal(rig.handles[1].disposed, true);
  assert.equal(a.state.doc.toString(), "a.md");
  assert.equal(b.state.doc.toString(), "b.md");
});

test("close：被收起 pane 为空时不并入，存活 pane 的前台不动", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  layout.split(); // pane 2 活跃且为空

  const closed = layout.close();
  assert.equal(closed?.id, 2);
  assert.equal(layout.active().id, 1);
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md"]);
  assert.equal(layout.activeTab(), a, "存活 pane 的前台不受空 pane 收起影响");
  assert.equal(layout.panes()[0].foreground, 0);
});

test("close：前台不在末尾也按「并入后该标签仍是前台」落点", () => {
  const rig = createRig();
  const { layout } = rig;
  rig.open("a.md");
  rig.open("b.md");
  layout.split();
  rig.open("c.md");
  rig.open("d.md"); // pane 2: [c, d]
  const c = layout.panes()[1].tabs[0];
  assert.equal(layout.activateTab(2, c), true); // 前台切到 c

  layout.close();
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md", "b.md", "c.md", "d.md"]);
  assert.equal(layout.activeTab(), c, "被收起 pane 的前台（c）成为目标前台，不是末尾的 d");
  assert.equal(layout.panes()[0].foreground, 2);
});

test("全流程（spec 场景「分栏、切换、收起全流程」）：split → other 往返 → 目标 pane 打开 → close 并入，零标签丢失", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  assert.equal(layout.split()?.id, 2);
  assert.equal(layout.activateOther(), true);
  assert.equal(layout.active().id, 1, "pane.other → 左");
  assert.equal(layout.activateOther(), true);
  assert.equal(layout.active().id, 2, "pane.other 再切 → 右");

  let createdIn: number | undefined;
  const b = layout.openTab("b.md", (owner) => {
    createdIn = owner.id;
    return rig.makeTab("b.md");
  });
  assert.equal(createdIn, 2, "打开意图落在活跃 pane");
  assert.equal(layout.paneOf(b)?.id, 2);

  assert.notEqual(layout.close(), null);
  assert.equal(layout.panes().length, 1, "回到单 pane 常态");
  assert.equal(layout.active().id, 1);
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md", "b.md"], "两个标签一个不丢、按序");
  assert.equal(layout.panes()[0].tabs[0], a);
  assert.equal(layout.panes()[0].tabs[1], b);
  assert.equal(layout.activeTab(), b, "被收起 pane 的前台（b）成为目标前台");
});

// ---------------------------------------------------------------------------
// 会话所有权：移动标签，非复制
// ---------------------------------------------------------------------------

test("moveTab：归属唯一、总数不变、EditorState 原样随行", () => {
  const rig = createRig();
  const { layout } = rig;
  const x = rig.open("x.md", "# 改动过的内容");
  const state = x.state;
  const handleA = layout.panes()[0].handle;
  layout.split(); // pane 2 活跃

  assert.equal(layout.moveTab(x), true, "目标缺省活跃 pane");
  assert.equal(layout.paneOf(x)?.id, 2);
  assert.deepEqual(pathsOf(layout.panes()[0]), [], "源 pane 失去该标签");
  assert.deepEqual(pathsOf(layout.panes()[1]), ["x.md"]);
  assert.equal(layout.panes()[1].tabs[0], x, "移动的是同一个标签对象，不是副本");
  assert.equal(layout.panes()[1].tabs[0].state, state, "EditorState 未被重建");
  assert.equal(layout.active().id, 2, "目标 pane 成为活跃 pane");
  assert.equal(layout.activeTab(), x, "移动后目标 pane 前台 = 该标签");
  assert.equal(layout.activeHandle(), layout.panes()[1].handle);
  assert.notEqual(layout.activeHandle(), handleA);
  assert.deepEqual(duplicatePaths(layout), [], "同一路径不跨 pane 出现两份");

  // 空 pane 合法在场、不自动收起（spec「移动标签致空 pane 不自动收起」）。
  assert.equal(layout.panes().length, 2);
  assert.equal(layout.panes()[0].foreground, -1);
});

test("moveTab：移回原 pane / 落在本 pane 时只置前台，不复制", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  const b = rig.open("b.md"); // pane 1: [a, b]，前台 b

  assert.equal(layout.moveTab(a), true, "目标缺省活跃 pane = 本 pane");
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md", "b.md"], "顺序不变");
  assert.equal(layout.activeTab(), a, "只把前台切到 a");
  assert.equal(layout.panes()[0].tabs.length, 2);

  layout.split();
  assert.equal(layout.moveTab(a, 2), true, "显式指定目标 pane");
  assert.equal(layout.moveTab(a, 2), true, "已在目标 pane 再移一次是幂等的前台操作");
  assert.deepEqual(pathsOf(layout.panes()[1]), ["a.md"]);
  assert.deepEqual(pathsOf(layout.panes()[0]), ["b.md"]);
  assert.equal(layout.paneOf(b)?.id, 1);
});

test("moveTab：未知标签返回 false，布局一字不动", () => {
  const rig = createRig();
  const { layout } = rig;
  rig.open("a.md");
  layout.split();
  const stranger = rig.makeTab("stranger.md");

  const before = layout.panes().map((pane) => pathsOf(pane));
  assert.equal(layout.moveTab(stranger), false);
  assert.equal(layout.paneOf(stranger), undefined);
  assert.deepEqual(
    layout.panes().map((pane) => pathsOf(pane)),
    before,
  );
  assert.deepEqual(duplicatePaths(layout), []);
});

test("moveTab：移走前台标签后源 pane 前台落右邻，没有右邻落左邻", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  const b = rig.open("b.md");
  rig.open("c.md"); // pane 1: [a, b, c]
  layout.split();
  const bTab = layout.panes()[0].tabs[1] as Tab;
  assert.equal(layout.activateTab(1, bTab), true); // 前台 = b

  layout.moveTab(bTab, 2);
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md", "c.md"]);
  assert.equal(layout.activeTab(), bTab, "目标前台 = 被移走的标签");
  assert.equal(layout.panes()[0].foreground, 1, "源 pane 前台落到右邻 c");
  assert.equal(layout.foregroundTab(layout.panes()[0])?.path, "c.md");
  assert.equal(layout.panes()[0].tabs[0], a, "其余标签顺序不动");
  assert.equal(layout.paneOf(b)?.id, 2);
});

// ---------------------------------------------------------------------------
// openTab：打开落点与判重
// ---------------------------------------------------------------------------

test("openTab 判重：打开他 pane 已开的文件是移动，不是复制，也不新建会话", () => {
  const rig = createRig();
  const { layout } = rig;
  const x = rig.open("x.md", "正文");
  const state = x.state;
  layout.split(); // pane 2 活跃
  const createdBefore = rig.created.count;

  const opened = layout.openTab("x.md", () => {
    rig.created.count += 1;
    return rig.makeTab("x.md");
  });
  assert.equal(opened, x, "返回的是既有标签");
  assert.equal(rig.created.count, createdBefore, "命中已开文件时 create 根本不被调用");
  assert.equal(opened.state, state, "既有的 EditorState 随移动原样到场");
  assert.equal(layout.paneOf(x)?.id, 2);
  assert.deepEqual(pathsOf(layout.panes()[0]), []);
  assert.deepEqual(duplicatePaths(layout), [], "全容器同一路径至多一份");
});

test("openTab 落点：缺省活跃 pane，显式 target 落到指定 pane，均把目标置为活跃", () => {
  const rig = createRig();
  const { layout } = rig;
  layout.split(); // pane 2 活跃
  const inB = rig.open("b.md");
  assert.equal(layout.paneOf(inB)?.id, 2);

  const inA = rig.open("a.md", undefined, 1); // 显式落到左 pane
  assert.equal(layout.paneOf(inA)?.id, 1);
  assert.equal(layout.active().id, 1, "目标 pane 成为活跃 pane");

  const inB2 = rig.open("b2.md", undefined, 2);
  assert.equal(layout.paneOf(inB2)?.id, 2);
  assert.equal(layout.panes()[1].foreground, 1, "新标签追加到目标 pane 末尾并成为前台");
});

test("openTab：已在本目标 pane 打开时只置前台，不追加第二份", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  rig.open("b.md");
  const createdBefore = rig.created.count;

  const again = rig.open("a.md");
  assert.equal(again, a);
  assert.equal(rig.created.count, createdBefore);
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md", "b.md"]);
  assert.equal(layout.activeTab(), a);
});

test("openTab：未命名文档（path undefined）不判重，可同时存在多份", () => {
  const rig = createRig();
  const t1 = rig.open(undefined, "第一份");
  const t2 = rig.open(undefined, "第二份");
  assert.notEqual(t1, t2);
  assert.deepEqual(pathsOf(rig.layout.panes()[0]), [undefined, undefined]);
  assert.equal(rig.layout.panes()[0].foreground, 1);
});

test("openTab：create 交回的标签路径与打开目标不符时抛错（判重失效的后门就地封死）", () => {
  const rig = createRig();
  assert.throws(
    () => rig.layout.openTab("a.md", () => rig.makeTab("b.md")),
    /create 交回的标签 path=b\.md 与目标 path=a\.md 不一致/,
  );
  assert.deepEqual(pathsOf(rig.layout.active()), [], "抛错时不落账");
});

test("openTab：反向后门也封死——openTab(undefined, …) 交回带 path 的标签同样抛错", () => {
  const rig = createRig();
  const b = rig.open("b.md");
  const before = rig.layout.panes().map((pane) => pathsOf(pane));

  // 指名「打开未命名文档」却交回一个带 path 的标签：若不校验，这个 path 已开时就会静默落第二份。
  assert.throws(
    () => rig.layout.openTab(undefined, () => rig.makeTab("b.md")),
    /create 交回的标签 path=b\.md 与目标 path=undefined 不一致/,
  );
  assert.deepEqual(duplicatePaths(rig.layout), [], "抛错后容器里没有第二份 b.md");
  assert.deepEqual(
    rig.layout.panes().map((pane) => pathsOf(pane)),
    before,
    "抛错时不落账、布局一字不动",
  );
  assert.equal(rig.layout.paneOf(b)?.id, 1);

  // 无条件比对：目标未命名而交回带 path 的标签一律拒绝——即便该 path 尚未打开，也不放行
  //（放行会造出「账本以为它在别处」的错位；真正的登记路径是 create 交回 path=undefined 的空会话）。
  assert.throws(
    () => rig.layout.openTab(undefined, () => rig.makeTab("never-opened.md")),
    /path=never-opened\.md 与目标 path=undefined 不一致/,
  );
  assert.equal(rig.layout.tabForPath("never-opened.md"), undefined);
});

// ---------------------------------------------------------------------------
// 活跃指针迁移路径
// ---------------------------------------------------------------------------

test("活跃指针：split / activate / activateOther / activateTab / moveTab / close 的落点", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  layout.split();
  assert.equal(layout.active().id, 2, "split → 新 pane 活跃");

  layout.activate(1);
  assert.equal(layout.active().id, 1, "activation（焦点进入）→ 该 pane 活跃");

  assert.equal(layout.activateOther(), true);
  assert.equal(layout.active().id, 2, "pane.other → 另一个 pane");
  assert.equal(layout.activateOther(), true);
  assert.equal(layout.active().id, 1, "pane.other 往返");

  const b = rig.open("b.md", undefined, 2);
  assert.equal(layout.active().id, 2);
  assert.equal(layout.activateTab(1, a), true);
  assert.equal(layout.active().id, 1, "激活某 pane 的标签 → 该 pane 活跃");

  assert.equal(layout.moveTab(b, 1), true);
  assert.equal(layout.active().id, 1, "moveTab → 目标 pane 活跃");

  layout.close();
  assert.equal(layout.active().id, 2, "null 之外的 close → 存活 pane 活跃");
});

test("活跃指针：单 pane 时 other 无操作；activate 未知 id 抛错", () => {
  const rig = createRig();
  const a = rig.open("a.md");
  assert.equal(rig.layout.activateOther(), false);
  assert.equal(rig.layout.active().id, 1);
  assert.throws(() => rig.layout.activate(99), /没有 id 为 99 的 pane/);
  assert.throws(() => rig.layout.moveTab(a, 99), /没有 id 为 99 的 pane/);
  assert.throws(() => rig.layout.openTab("z.md", () => rig.makeTab("z.md"), 99), /没有 id 为 99 的 pane/);
});

test("moveTab：未知标签在解析目标之前就返回 false（不因坏 target 抛错）", () => {
  const rig = createRig();
  assert.equal(rig.layout.moveTab(rig.makeTab("z.md"), 99), false);
});

// ---------------------------------------------------------------------------
// 空 pane 与 closeTab
// ---------------------------------------------------------------------------

test("空 pane 不自动收起：关掉某 pane 最后一个标签后该 pane 仍在场，活跃指针不漂移", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  layout.split();
  layout.activate(1);

  assert.equal(layout.closeTab(a), true);
  assert.equal(layout.panes().length, 2, "空 pane 合法在场");
  assert.equal(layout.active().id, 1, "关标签不改变活跃 pane");
  assert.deepEqual(pathsOf(layout.panes()[0]), []);
  assert.equal(layout.panes()[0].foreground, -1);
  assert.equal(layout.activeTab(), undefined);
});

test("closeTab：前台邻居口径（右邻优先，无右邻落左邻；前台之前被摘则左移一位）", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  const b = rig.open("b.md");
  const c = rig.open("c.md"); // pane 1: [a, b, c]，前台 c

  assert.equal(layout.closeTab(b), true, "摘台前之前的标签");
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md", "c.md"]);
  assert.equal(layout.activeTab(), c, "前台仍是 c（下标左移一位）");

  assert.equal(layout.closeTab(a), true, "摘台前之前的第一项");
  assert.deepEqual(pathsOf(layout.panes()[0]), ["c.md"]);
  assert.equal(layout.activeTab(), c);

  assert.equal(layout.closeTab(rig.makeTab("nope.md")), false, "未知标签返回 false");
  assert.deepEqual(pathsOf(layout.panes()[0]), ["c.md"]);
});

test("closeTab：摘掉前台时落右邻，无右邻落左邻", () => {
  const rig = createRig();
  const { layout } = rig;
  const a = rig.open("a.md");
  const b = rig.open("b.md");
  const c = rig.open("c.md");

  assert.equal(layout.activateTab(1, b), true);
  assert.equal(layout.closeTab(b), true);
  assert.equal(layout.activeTab(), c, "右邻顶上");

  assert.equal(layout.activateTab(1, c), true); // 前台 = 末尾
  assert.equal(layout.closeTab(c), true);
  assert.equal(layout.activeTab(), a, "无右邻落左邻");
  assert.deepEqual(pathsOf(layout.panes()[0]), ["a.md"]);
});
