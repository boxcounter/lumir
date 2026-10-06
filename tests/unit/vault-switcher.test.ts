// src/vault-switcher.ts 的单测（M163）：会话过滤（预览不入盘 / 越界丢弃 / 激活项退化 /
// 跳过计数）、装载后恢复的执行口径与世代让位、切换门的三动作状态机与「一次只处理一个切换」、
// 行摘要与路径派生。
//
// 这一层是 M153 的延续：本 mission 的判定（哪些条目不落盘、哪些条目不恢复、拦下后三条出口
// 各自做什么）大多与 DOM 和渲染无关，是纯状态迁移，因此不该只靠浏览器场景间接兜底。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import type { FsEntry } from "../../src/bindings/FsEntry.ts";
import type { VaultListEntry } from "../../src/bindings/VaultListEntry.ts";
import type { PaneSession } from "../../src/bindings/PaneSession.ts";
import type { VaultSession } from "../../src/bindings/VaultSession.ts";
import type { EditorSession, ScrollSnapshot } from "../../src/editor.ts";
import type { ToastAction, VaultSwitchBlock } from "../../src/save-controller.ts";
import { NO_MATCH_TEXT } from "../../src/list-filter.ts";
import {
  SESSION_WRITE_DEBOUNCE_MS,
  createGuardPromptPresenter,
  createVaultRemapPrompt,
  createVaultSessionStore,
  createVaultSwitcher,
  createVaultSwitchGate,
  relativeTime,
  restorePlan,
  samePath,
  sameSnapshot,
  sessionSnapshot,
  shortPath,
  skippedText,
  summaryText,
  vaultGuardText,
} from "../../src/vault-switcher.ts";
import type { StoredPane } from "../../src/vault-switcher.ts";

/** 让 await 链跑完（mock timers 只接管 setTimeout，setImmediate 仍是真家伙）。 */
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

/** 会话条目只需 path 一个字段（sessionSnapshot 的读点）。 */
function tab(path: string): EditorSession {
  return { path } as unknown as EditorSession;
}

function fileEntry(path: string, lazy = false): FsEntry {
  return { path, kind: "file", size: 0, mtime_ms: null, lazy };
}

function listRow(over: Partial<VaultListEntry> & { id: string }): VaultListEntry {
  return {
    path: `/vaults/${over.id}`,
    name: over.id,
    available: true,
    last_opened_at: null,
    tab_count: 0,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 会话过滤：全部有路径的标签入盘 / 顺序保留 / 激活项落空
// ---------------------------------------------------------------------------

test("sessionSnapshot：全部标签入盘、顺序按打开顺序、激活项不在集合里时落 null（逐 pane）", () => {
  const sessions = [tab("a.md"), tab("b.md"), tab("c.md")];
  assert.deepEqual(sessionSnapshot([{ sessions, activePath: "c.md" }], 0.5, false), {
    panes: [{ tabs: ["a.md", "b.md", "c.md"], active: "c.md" }],
    ratio: 0.5,
    harnessPane: false,
  });
  // M254 之前这里还有一层「预览标签不入盘」的过滤：预览机制退场后标签只有一种形态，
  // 每个有路径的标签都是正式标签、都该被记住（下面这条断言就是那层过滤的回归点）。
  assert.deepEqual(sessionSnapshot([{ sessions, activePath: "b.md" }], 0.5, false), {
    panes: [{ tabs: ["a.md", "b.md", "c.md"], active: "b.md" }],
    ratio: 0.5,
    harnessPane: false,
  });
  // 没有前台（未命名文档）：激活项落 null（恢复侧退化到第一个可打开的）
  assert.deepEqual(sessionSnapshot([{ sessions, activePath: undefined }], 0.5, false), {
    panes: [{ tabs: ["a.md", "b.md", "c.md"], active: null }],
    ratio: 0.5,
    harnessPane: false,
  });
  assert.deepEqual(sessionSnapshot([{ sessions: [], activePath: undefined }], 0.5, false), {
    panes: [{ tabs: [], active: null }],
    ratio: 0.5,
    harnessPane: false,
  });
});

test("sessionSnapshot：双 pane 逐 pane 入盘，比例是快照的一项（分隔条松手改的就是它）", () => {
  assert.deepEqual(
    sessionSnapshot(
      [
        { sessions: [tab("a.md"), tab("b.md")], activePath: "b.md" },
        { sessions: [tab("c.md")], activePath: "c.md" },
      ],
      0.35,
      false,
    ),
    {
      panes: [
        { tabs: ["a.md", "b.md"], active: "b.md" },
        { tabs: ["c.md"], active: "c.md" },
      ],
      ratio: 0.35,
      harnessPane: false,
    },
  );
});

test("sessionSnapshot：**壳态标签一样入盘**（M283 的 3.1：纯惰性案会把会话写成 1 条）", () => {
  // 壳 = 有路径、内容未装载（`loaded === false`）。入盘判据只看 `path`，与装载状态无关——
  // 这正是「先建壳」能让会话快照保持完整的原因（design §3.1：纯惰性案在恢复后 1 秒内把
  // 40 条会话写成 1 条，用户的标签列表被这一次切换永久删掉）。
  const shell = { path: "a.md", loaded: false } as unknown as EditorSession;
  assert.deepEqual(sessionSnapshot([{ sessions: [shell], activePath: "a.md" }], 0.5, false), {
    panes: [{ tabs: ["a.md"], active: "a.md" }],
    ratio: 0.5,
    harnessPane: false,
  });
  // 未命名文档（无路径）仍不入盘
  const blank = { path: undefined, loaded: true } as unknown as EditorSession;
  assert.deepEqual(sessionSnapshot([{ sessions: [blank, shell], activePath: undefined }], 0.5, false), {
    panes: [{ tabs: ["a.md"], active: null }],
    ratio: 0.5,
    harnessPane: false,
  });
});

test("sameSnapshot：逐项比较（顺序 / pane 数 / 比例也算），用于决定要不要排期写盘", () => {
  const a = { panes: [{ tabs: ["a.md", "b.md"], active: "b.md" }], ratio: 0.5, harnessPane: false };
  assert.equal(
    sameSnapshot(a, { panes: [{ tabs: ["a.md", "b.md"], active: "b.md" }], ratio: 0.5, harnessPane: false }),
    true,
  );
  assert.equal(
    sameSnapshot(a, { panes: [{ tabs: ["b.md", "a.md"], active: "b.md" }], ratio: 0.5, harnessPane: false }),
    false,
  );
  assert.equal(sameSnapshot(a, { panes: [{ tabs: ["a.md"], active: "b.md" }], ratio: 0.5, harnessPane: false }), false);
  assert.equal(
    sameSnapshot(a, { panes: [{ tabs: ["a.md", "b.md"], active: null }], ratio: 0.5, harnessPane: false }),
    false,
  );
  // 比例变了也是变了（分隔条松手写盘的那条路径）
  assert.equal(
    sameSnapshot(a, { panes: [{ tabs: ["a.md", "b.md"], active: "b.md" }], ratio: 0.7, harnessPane: false }),
    false,
  );
  // pane 数变了
  assert.equal(
    sameSnapshot(a, {
      panes: [
        { tabs: ["a.md", "b.md"], active: "b.md" },
        { tabs: [], active: null },
      ],
      ratio: 0.5,
      harnessPane: false,
    }),
    false,
  );
  // harness 在场位也是快照的一项（HP1：开合 harness pane 触发写盘）
  assert.equal(
    sameSnapshot(a, { panes: [{ tabs: ["a.md", "b.md"], active: "b.md" }], ratio: 0.5, harnessPane: true }),
    false,
  );
  // 第二个 pane 的标签也要逐项一致
  const two = {
    panes: [
      { tabs: ["a.md"], active: "a.md" },
      { tabs: ["b.md"], active: "b.md" },
    ],
    ratio: 0.5,
    harnessPane: false,
  };
  assert.equal(
    sameSnapshot(two, {
      panes: [
        { tabs: ["a.md"], active: "a.md" },
        { tabs: ["c.md"], active: "b.md" },
      ],
      ratio: 0.5,
      harnessPane: false,
    }),
    false,
  );
});

test("sessionSnapshot：harnessPane 是快照的一项（harness pane 不入 panes 数组）", () => {
  // HP1（change move-harness-to-pane-chat-frame）：harness pane 恒零标签，入盘的 panes 数组
  // 只装 doc pane；在场与否由 harnessPane 表达（ADR 0008 Decision 1/6）。
  const snap = sessionSnapshot([{ sessions: [tab("a.md")], activePath: "a.md" }], 2 / 3, true);
  assert.deepEqual(snap, {
    panes: [{ tabs: ["a.md"], active: "a.md" }],
    ratio: 2 / 3,
    harnessPane: true,
  });
});

// ---------------------------------------------------------------------------
// 恢复计划：越界/缺失丢弃、跳过计数、激活项退化
// ---------------------------------------------------------------------------

/** 存储里的一个 pane（`restorePlan` 的输入形状 = `PaneSession`）。 */
const paneOf = (tabs: string[], active: string | null): PaneSession => ({ tabs, active });

/** 一份单 pane 的存储会话（多数用例只关心单 pane）。 */
const sessionOf = (tabs: string[], active: string | null, ratio = 0.5): VaultSession => ({
  version: 2,
  panes: [paneOf(tabs, active)],
  harness_pane: false,
  pane_split_ratio: ratio,
  updated_at: 0,
});

test("restorePlan：不在 vault 集合里的条目（删除 / 越界 / 绝对路径）被丢弃并计入跳过", () => {
  const available = new Set(["a.md", "docs/c.md"]);
  const plan = restorePlan(
    paneOf(["a.md", "/etc/passwd", "../../outside.md", "docs/c.md"], "docs/c.md"),
    available,
  );
  assert.deepEqual(plan.open, ["a.md", "docs/c.md"]);
  assert.equal(plan.skipped, 2);
  assert.equal(plan.active, "docs/c.md");
});

test("restorePlan：激活项不可用退化为第一个可打开的；没有历史或全丢时为空", () => {
  const available = new Set(["a.md", "c.md"]);
  // 激活项不在恢复出来的集合里（文件缺失）
  assert.deepEqual(restorePlan(paneOf(["a.md", "c.md"], "gone.md"), available), {
    open: ["a.md", "c.md"],
    skipped: 0,
    active: "a.md",
  });
  // 激活项是 null（上次前台是没有路径的空文档——会话里存不下这种前台）
  assert.equal(restorePlan(paneOf(["a.md"], null), available).active, "a.md");
  // 没有历史（会话缺失 / 损坏都走这条路）
  assert.deepEqual(restorePlan(null, available), { open: [], skipped: 0, active: null });
  // 全部条目都不在 vault 里
  assert.deepEqual(restorePlan(paneOf(["x.md", "y.md"], "x.md"), available), {
    open: [],
    skipped: 2,
    active: null,
  });
});

// ---------------------------------------------------------------------------
// 摘要与路径派生（D99–D101）
// ---------------------------------------------------------------------------

test("summaryText：当前项说「现在打开」，无历史说没有打开过，老注册项只给数字", () => {
  const now = 1_700_000_000_000;
  assert.equal(summaryText(0, null, now, false), "还没有打开过文件");
  assert.equal(summaryText(3, now - 5_000, now, true), "3 个标签 · 现在打开");
  // 相对时间档走 `Intl.RelativeTimeFormat`（design §6.2）：zh 下不再有数字与量词之间的空格
  // （`5 分钟前` → `5分钟前`）——这是本 change 唯一一处 zh 可见文案的措辞变化，由 `Intl` 产出。
  assert.equal(summaryText(2, now - 5 * 60_000, now, false), "2 个标签 · 5分钟前");
  assert.equal(summaryText(1, null, now, false), "1 个标签");
});

test("relativeTime：分钟 / 小时 / 昨天 / 天 / 绝对日期六档，时钟回拨落进「刚刚」", () => {
  const now = 1_700_000_000_000;
  const at = (ms: number) => relativeTime(now - ms, now);
  assert.equal(at(-60_000), "刚刚"); // 时钟回拨（记录时间在将来）不产出负数
  assert.equal(at(30_000), "刚刚");
  assert.equal(at(5 * 60_000), "5分钟前");
  assert.equal(at(90 * 60_000), "1小时前");
  assert.equal(at(30 * 60 * 60_000), "昨天");
  assert.equal(at(3 * 24 * 60 * 60_000), "3天前");
  const absolute = relativeTime(now - 30 * 24 * 60 * 60_000, now);
  assert.match(absolute, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(relativeTime(null, now), "");
});

test("shortPath：路径尾部三段；不足三段原样；samePath 只归一去尾斜杠", () => {
  // 口径与 demo/multi-vault.html 的 shortPath 逐字一致：「…/」是省略号的占位，其后保留三段
  assert.equal(shortPath("/Users/alex/Documents/notes-2026"), "…/alex/Documents/notes-2026");
  assert.equal(shortPath("/Users/alex"), "/Users/alex");
  assert.equal(shortPath("a/b/c/d/e", 2), "…/d/e");
  assert.equal(samePath("/Users/alex/notes/", "/Users/alex/notes"), true);
  assert.equal(samePath("/Users/alex/notes", "/Users/alex/notes-2026"), false);
});

// ---------------------------------------------------------------------------
// 会话存储：防抖写 / flush / 装载后恢复
// ---------------------------------------------------------------------------

/** 一条建壳记录：路径 + 落进第几个 pane（0 = root / 左，1 = 动态 / 右）。 */
interface StoredShell {
  path: string;
  pane: number;
}

/** 一个 pane 的布局输入（store deps 的 `layout()` 元素）。 */
interface LayoutPane {
  sessions: EditorSession[];
  activePath: string | undefined;
}

interface StoreRig {
  store: ReturnType<typeof createVaultSessionStore>;
  /** 单 pane 便利口：设 root pane 的会话（多数用例只关心单 pane）。 */
  setSessions(...sessions: EditorSession[]): void;
  /** 设 root pane 的前台路径。 */
  setActivePath(path: string | undefined): void;
  /** 整份布局（多 pane 用例 + 分隔比例）。 */
  setLayout(panes: LayoutPane[], ratio?: number): void;
  writes: Array<{ vaultId: string; panes: StoredPane[]; ratio: number }>;
  warns: string[];
  toasts: string[];
  /** 内容被装载出来的条目（`openPinned` 成功的那几次）。 */
  opened: string[];
  /** 每个条目**最终落进**的 pane（M321）：`openPinned` 的落点参数 + 装配层 open 落点语义
   *  （显式落点用给定 pane，缺省用活跃 pane）共同决定的产物——恢复后「归位原 pane」的判据。 */
  placed: Map<string, number>;
  /** 建了壳的条目（M283：恢复的第一步，当帧、按存储顺序、按 pane 落位）。 */
  shells: StoredShell[];
  /** 建壳与装载内容落在**同一条**调用时间线上（`shell:a.md@0` / `open:a.md`）——判据是
   *  「壳先齐、内容只装激活项」，只看两个集合分不出先后。`panes:N` 是布局施加那一拍。 */
  calls: string[];
  activated: string[];
  emptyVaults: number;
  /** `applyPaneCount` 的调用记录（恢复时把布局摆成什么形状，含比例）。 */
  paneCounts: Array<{ count: number; ratio: number }>;
  /** 会话读取口：默认 null（没有历史）。 */
  setGetSession(fn: (vaultId: string) => Promise<VaultSession | null>): void;
  /** 打不开的条目（在 vault 里但读失败）。 */
  failOpen: Set<string>;
  /** 建不成壳的条目（不可打开的文件类：`createShell` 交回 false）。 */
  failShell: Set<string>;
  /** 批量存在探测的假实现（默认「都不在 vault 内」= 只看枚举集合的旧口径）。 */
  pathsExistImpl: (paths: string[]) => Promise<string[]>;
  /** 探测调用记录：断言「一次批量、MUST NOT 逐条发起」用。 */
  probes: string[][];
  setWritesFail(fail: boolean): void;
  /** 让内容装载慢一拍（一次 setImmediate）：用于构造「装载在途时又切了一次 vault」的现场。 */
  setOpenSlow(next: boolean): void;
}

function createStoreRig(): StoreRig {
  let panes: LayoutPane[] = [{ sessions: [], activePath: undefined }];
  let ratio = 0.5;
  let getSession: (vaultId: string) => Promise<VaultSession | null> = async () => null;
  let writesFail = false;
  let openSlow = false;
  // 装配层的活跃 pane 模型（M321）：`applyPaneCount` 建 pane 时新 pane 成为活跃——分栏后
  // 活跃恒是**后建的右 pane**（真实装配层同口径，也正是本缺陷的触发条件）。
  let activePane = 0;
  const rig: StoreRig = {
    store: undefined as unknown as ReturnType<typeof createVaultSessionStore>,
    setSessions: (...next) => {
      panes = [{ sessions: next, activePath: panes[0]?.activePath }];
    },
    setActivePath: (path) => {
      panes[0] = { sessions: panes[0]?.sessions ?? [], activePath: path };
    },
    setLayout: (next, nextRatio) => {
      panes = next;
      if (nextRatio !== undefined) ratio = nextRatio;
    },
    writes: [],
    warns: [],
    toasts: [],
    opened: [],
    placed: new Map<string, number>(),
    shells: [],
    calls: [],
    activated: [],
    emptyVaults: 0,
    paneCounts: [],
    setGetSession: (fn) => void (getSession = fn),
    failOpen: new Set<string>(),
    failShell: new Set<string>(),
    pathsExistImpl: async () => [],
    probes: [],
    setWritesFail: (fail) => void (writesFail = fail),
    setOpenSlow: (next) => void (openSlow = next),
  };
  rig.store = createVaultSessionStore({
    layout: () => ({
      panes: panes.map((pane) => ({ sessions: pane.sessions, activePath: pane.activePath })),
      ratio,
      harnessPane: false,
    }),
    getSession: (vaultId) => getSession(vaultId),
    putSession: async (vaultId, nextPanes, nextRatio, nextHarness) => {
      if (writesFail) throw new Error("磁盘只读");
      rig.writes.push({ vaultId, panes: nextPanes, ratio: nextRatio });
    },
    pathsExist: (paths) => {
      rig.probes.push([...paths]);
      return rig.pathsExistImpl(paths);
    },
    // 布局（建 pane 与标签条）与建壳都是同步的（恢复的前两步），内容装载是异步的——它们与
    // 「刷标签栏」那一拍落在同一条时间线上（`shellsBuilt` 是标签栏渲染的触发点）。
    applyPaneCount: (count, nextRatio) => {
      rig.paneCounts.push({ count, ratio: nextRatio });
      rig.calls.push(`panes:${count}`);
      // 与真实 applyPaneCount 同口径：分栏后活跃 pane 是后建的那个（右 pane），单 pane 恒 root。
      activePane = count > 1 ? count - 1 : 0;
    },
    createShell: (path, pane) => {
      rig.calls.push(`shell:${path}@${pane}`);
      if (rig.failShell.has(path)) return false;
      rig.shells.push({ path, pane });
      return true;
    },
    shellsBuilt: () => void rig.calls.push("shellsBuilt"),
    openPinned: async (path, pane) => {
      rig.calls.push(`open:${path}`);
      if (openSlow) await new Promise((resolve) => setImmediate(resolve));
      if (rig.failOpen.has(path)) return false;
      rig.opened.push(path);
      // 装配层打开落点语义的模型（M321）：给了专用落点就装进它；旧口径（无落点）按**活跃
      // pane**——恢复期活跃是后建的右 pane，于是左 pane 的激活项被「打开即移动」抢走。
      rig.placed.set(path, pane ?? activePane);
      return true;
    },
    activate: (path) => void rig.activated.push(path),
    onEmptyVault: () => void (rig.emptyVaults += 1),
    toast: (text) => void rig.toasts.push(text),
    warn: (text) => void rig.warns.push(text),
  });
  return rig;
}

test("会话存储：变化后防抖写盘，同内容不重复排期", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createStoreRig();
    rig.setSessions(tab("a.md"), tab("b.md"));
    rig.setActivePath("a.md");
    await rig.store.onVaultLoaded("vault-a", []);

    rig.store.sessionChanged();
    assert.equal(rig.writes.length, 0, "防抖窗口内不写盘");
    rig.store.sessionChanged(); // 同内容再回调一次：不重置窗口、不重复排期
    mock.timers.tick(SESSION_WRITE_DEBOUNCE_MS);
    await flush();
    assert.deepEqual(rig.writes, [
      { vaultId: "vault-a", panes: [{ tabs: ["a.md", "b.md"], active: "a.md" }], ratio: 0.5 },
    ]);
  } finally {
    mock.timers.reset();
  }
});

test("会话存储：分隔条比例变化也触发写盘（比例是快照的一项，键仍是 per-vault）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createStoreRig();
    rig.setLayout([{ sessions: [tab("a.md")], activePath: "a.md" }], 0.5);
    await rig.store.onVaultLoaded("vault-a", []);
    // 标签完全没变，只有分隔条松手改了比例——这也要落盘（per-vault 布局即数据，tasks 5.4）。
    rig.setLayout([{ sessions: [tab("a.md")], activePath: "a.md" }], 0.75);
    rig.store.sessionChanged();
    assert.equal(rig.writes.length, 0, "防抖窗口内不写盘");
    mock.timers.tick(SESSION_WRITE_DEBOUNCE_MS);
    await flush();
    assert.deepEqual(rig.writes, [
      {
        vaultId: "vault-a",
        panes: [{ tabs: ["a.md"], active: "a.md" }],
        ratio: 0.75,
      },
    ]);
  } finally {
    mock.timers.reset();
  }
});

test("会话存储：双 pane 时逐 pane 入盘（含每个 pane 的前台与比例）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createStoreRig();
    rig.setLayout(
      [
        { sessions: [tab("a.md"), tab("b.md")], activePath: "b.md" },
        { sessions: [tab("c.md")], activePath: "c.md" },
      ],
      0.35,
    );
    await rig.store.onVaultLoaded("vault-a", []);
    rig.store.sessionChanged();
    mock.timers.tick(SESSION_WRITE_DEBOUNCE_MS);
    await flush();
    assert.deepEqual(rig.writes.at(-1), {
      vaultId: "vault-a",
      panes: [
        { tabs: ["a.md", "b.md"], active: "b.md" },
        { tabs: ["c.md"], active: "c.md" },
      ],
      ratio: 0.35,
    });
  } finally {
    mock.timers.reset();
  }
});

test("会话存储：flush 写最新快照并取消防抖（切换前 / 退出前 MUST NOT 只依赖定时器）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createStoreRig();
    rig.setSessions(tab("a.md"));
    rig.setActivePath("a.md");
    await rig.store.onVaultLoaded("vault-a", []);

    rig.store.sessionChanged();
    rig.setSessions(tab("a.md"), tab("c.md"));
    rig.setActivePath("c.md");
    rig.store.sessionChanged(); // 窗口内的第二次变化
    await rig.store.flush();
    assert.deepEqual(rig.writes.at(-1), {
      vaultId: "vault-a",
      panes: [{ tabs: ["a.md", "c.md"], active: "c.md" }],
      ratio: 0.5,
    });
    mock.timers.tick(SESSION_WRITE_DEBOUNCE_MS * 2);
    await flush();
    assert.equal(rig.writes.length, 1, "flush 已取消防抖定时器，不会再写第二次");
  } finally {
    mock.timers.reset();
  }
});

test("会话存储：写失败只降级（一条 warning，不抛出、不拦停）", async () => {
  const rig = createStoreRig();
  rig.setSessions(tab("a.md"));
  rig.setActivePath("a.md");
  await rig.store.onVaultLoaded("vault-a", []);
  rig.setWritesFail(true);
  await rig.store.flush();
  assert.deepEqual(rig.warns, ["磁盘只读"]);
  assert.equal(rig.writes.length, 0);
});

// ---------------------------------------------------------------------------
// 装载后恢复（M283 的新结构）：当帧建壳 → 只装载激活项 → 其余按需
// ---------------------------------------------------------------------------

test("装载后恢复：当帧按存储顺序建壳，内容只装载存储的激活项，跳过计数只报一次", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () =>
    sessionOf(["a.md", "/etc/passwd", "docs/c.md"], "docs/c.md"),
  );
  await rig.store.onVaultLoaded("vault-a", [
    fileEntry("a.md"),
    fileEntry("docs/c.md"),
    { path: "docs", kind: "dir", size: 0, mtime_ms: null, lazy: false },
  ]);
  // 壳：按存储顺序、越界条目（/etc/passwd）与不在 vault 的条目都不在其中，落进 root pane
  assert.deepEqual(
    rig.shells,
    [
      { path: "a.md", pane: 0 },
      { path: "docs/c.md", pane: 0 },
    ],
    "壳按存储顺序建齐（标签的存在与顺序在此刻就位）",
  );
  // 单 pane 存储恢复不出第二 pane：布局只施加一次、count 为 1
  assert.deepEqual(rig.paneCounts, [{ count: 1, ratio: 0.5 }]);
  // 内容：只装激活项，其余的文档内容留到它们首次成为前台
  assert.deepEqual(rig.opened, ["docs/c.md"], "非激活标签在装载期 MUST NOT 装载内容");
  assert.deepEqual(rig.activated, ["docs/c.md"], "单 pane 下不再补一次激活（无第二个 pane 可回）");
  assert.deepEqual(rig.toasts, [skippedText(1)]);
  assert.equal(rig.emptyVaults, 0);
  // 时序：布局先就位 → 两个壳都先于任何内容装载（「等待与标签数脱钩」这条契约的机械形态）
  assert.deepEqual(rig.calls, [
    "panes:1",
    "shell:a.md@0",
    "shell:docs/c.md@0",
    "shellsBuilt",
    "open:docs/c.md",
  ]);
});

test("装载后恢复：存储的激活项不在 vault 里 → 装载落点是恢复计划给出的第一个条目", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () => sessionOf(["a.md", "gone.md", "c.md"], "gone.md"));
  await rig.store.onVaultLoaded("vault-a", [
    fileEntry("a.md"),
    fileEntry("c.md"),
  ]);
  assert.deepEqual(
    rig.shells,
    [
      { path: "a.md", pane: 0 },
      { path: "c.md", pane: 0 },
    ],
    "不在 vault 的条目不成壳",
  );
  assert.deepEqual(rig.opened, ["a.md"], "退化到第一个条目：只有它的内容在装载期装载");
  assert.deepEqual(rig.activated, ["a.md"]);
  assert.deepEqual(rig.toasts, [skippedText(1)]); // 缺失 1（不逐个报错）
});

test("装载后恢复：激活项的内容读失败 → 退化为下一个能读的标签，跳过计数含失败的尝试", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () => sessionOf(["a.md", "c.md"], "c.md"));
  rig.failOpen.add("c.md"); // 在 vault 里但读失败
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md"), fileEntry("c.md")]);
  assert.deepEqual(rig.opened, ["a.md"], "读失败的激活项没有把内容装进来");
  assert.deepEqual(rig.activated, ["a.md"], "退化到下一个能读的标签（两个标签都建了壳）");
  assert.deepEqual(rig.calls, [
    "panes:1",
    "shell:a.md@0",
    "shell:c.md@0",
    "shellsBuilt",
    "open:c.md",
    "open:a.md",
  ]);
  assert.deepEqual(rig.toasts, [skippedText(1)], "一次计数：读失败的那个");
});

// ---------------------------------------------------------------------------
// 按 pane 恢复（M318 tasks 5.3）：双 pane / 单 pane / 全部不可用三分支
// ---------------------------------------------------------------------------

test("装载后恢复：双 pane 存储按 pane 建壳与装载，活跃 pane 定格 root", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () => ({
    version: 2,
    panes: [paneOf(["a.md"], "a.md"), paneOf(["b.md"], "b.md")],
    harness_pane: false,
    pane_split_ratio: 0.7,
    updated_at: 0,
  }));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md"), fileEntry("b.md")]);
  assert.deepEqual(rig.paneCounts, [{ count: 2, ratio: 0.7 }], "布局摆成两 pane，比例带过去");
  assert.deepEqual(
    rig.shells,
    [
      { path: "a.md", pane: 0 },
      { path: "b.md", pane: 1 },
    ],
    "壳落进各自所属的 pane",
  );
  assert.deepEqual(rig.opened, ["a.md", "b.md"], "逐 pane 装载激活项的内容");
  // 逐 pane 装载会把活跃指针留到最后装载的那个 pane；schema 无「哪个 pane 活跃」位，
  // 收口时把 root 加载成功的那条激活一次（见 store 的 restore 注释）。
  assert.deepEqual(rig.activated, ["a.md"]);
  assert.deepEqual(rig.calls, [
    "panes:2",
    "shell:a.md@0",
    "shell:b.md@1",
    "shellsBuilt",
    "open:a.md",
    "open:b.md",
  ]);
  assert.deepEqual(rig.toasts, []);
});

test("装载后恢复：双 pane 各一标签恢复后两标签归位原 pane（M321 回归）", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () => ({
    version: 2,
    panes: [paneOf(["alpha.md"], "alpha.md"), paneOf(["beta.md"], "beta.md")],
    harness_pane: false,
    pane_split_ratio: 0.5,
    updated_at: 0,
  }));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("alpha.md"), fileEntry("beta.md")]);
  assert.deepEqual(
    rig.shells,
    [
      { path: "alpha.md", pane: 0 },
      { path: "beta.md", pane: 1 },
    ],
    "壳先按存储落进各自 pane",
  );
  // 缺陷现场（M320 finding）：恢复期活跃 pane 是后建的右 pane（pane1），装载若仍按活跃 pane
  // 判定「打开即移动」（M317 4.2），pane0 的激活项 alpha 会被抢到 pane1——真机会话回写因此
  // 变成 panes:[[],[beta.md,alpha.md]]。恢复装载必须用条目**自己所属的 pane** 当落点。
  assert.equal(rig.placed.get("alpha.md"), 0, "pane0 的激活项装回 pane0（不被活跃 pane 抢走）");
  assert.equal(rig.placed.get("beta.md"), 1, "pane1 的激活项装回 pane1");
  assert.deepEqual(rig.opened, ["alpha.md", "beta.md"]);
  assert.deepEqual(rig.activated, ["alpha.md"], "收口把活跃 pane 带回 root");
});

test("装载后恢复：双 pane 存储、第二个 pane 的条目全没了 → 仍按存储建 2 pane（design §7）", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () => ({
    version: 2,
    panes: [paneOf(["a.md"], "a.md"), paneOf(["gone.md"], "gone.md")],
    harness_pane: false,
    pane_split_ratio: 0.5,
    updated_at: 0,
  }));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  assert.deepEqual(
    rig.paneCounts,
    [{ count: 2, ratio: 0.5 }],
    "「先建全部 pane 与其标签条」按 tasks/design 原文执行",
  );
  assert.deepEqual(
    rig.shells,
    [{ path: "a.md", pane: 0 }],
    "pane 2 无可用条目不建壳（空 pane 是合法在场状态）",
  );
  // 只有 pane 0 有内容可装：活跃 pane 落在 pane 0，收口不再补激活（rootLoaded 命中 i===0）
  assert.deepEqual(rig.activated, ["a.md"]);
  assert.deepEqual(rig.toasts, [skippedText(1)], "pane 2 缺失的那 1 条计入跳过");
});

test("装载后恢复：双 pane 存储但全部条目都不可用 → 回落单 pane 空态", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () => ({
    version: 2,
    panes: [paneOf(["x.md"], "x.md"), paneOf(["y.md"], "y.md")],
    harness_pane: false,
    pane_split_ratio: 0.5,
    updated_at: 0,
  }));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  assert.equal(rig.emptyVaults, 1);
  assert.deepEqual(rig.paneCounts, [{ count: 1, ratio: 0.5 }], "一个条目都恢复不出来时不 split");
  assert.deepEqual(rig.shells, []);
  assert.deepEqual(rig.toasts, [skippedText(2)]);
});

test("装载后恢复：条目都在 vault 里但一个壳都建不成 → 回落单 pane 空态（不可打开的文件类）", async () => {
  const rig = createStoreRig();
  rig.failShell.add("bin.pdf");
  rig.failShell.add("a.md");
  rig.setGetSession(async () => ({
    version: 2,
    panes: [paneOf(["bin.pdf"], "bin.pdf"), paneOf(["a.md"], "a.md")],
    harness_pane: false,
    pane_split_ratio: 0.5,
    updated_at: 0,
  }));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("bin.pdf"), fileEntry("a.md")]);
  // 布局先按存储摆成两 pane，壳全建不成后再收拢回单 pane
  assert.deepEqual(
    rig.paneCounts,
    [
      { count: 2, ratio: 0.5 },
      { count: 1, ratio: 0.5 },
    ],
    "先按存储建 pane，全部建不成壳时回落单 pane",
  );
  assert.equal(rig.emptyVaults, 1);
  assert.deepEqual(rig.opened, []);
  assert.deepEqual(rig.toasts, [skippedText(2)], "两条都建不成壳，计入跳过");
});

test("装载后恢复：不在枚举集里但探测存在的条目照常恢复（惰性文件不被判成已删除）", async () => {
  const rig = createStoreRig();
  // 探测的假后端：`.local/tutorial.md` 在磁盘上（被 vault 自己的 .gitignore 挡住、未进枚举），
  // `gone.md` 确实不在了。
  rig.pathsExistImpl = async (paths) => paths.filter((path) => path === ".local/tutorial.md");
  rig.setGetSession(async () => sessionOf([".local/tutorial.md", "gone.md"], ".local/tutorial.md"));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);

  assert.deepEqual(
    rig.probes,
    [[".local/tutorial.md", "gone.md"]],
    "一次批量探测：入参是那批「不在枚举条目集里」的路径，MUST NOT 逐条发起",
  );
  assert.deepEqual(
    rig.shells,
    [{ path: ".local/tutorial.md", pane: 0 }],
    "探测存在的条目照常建壳（标签回来）",
  );
  assert.deepEqual(rig.opened, [".local/tutorial.md"], "存储的激活项就是它：内容照常装载");
  assert.deepEqual(rig.toasts, [skippedText(1)], "只有探测失败的条目计入跳过");
});

test("装载后恢复：条目全在枚举集里时一次探测都不发（零新增 IPC）", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async () => sessionOf(["a.md"], "a.md"));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  assert.deepEqual(rig.probes, []);
  assert.deepEqual(rig.shells, [{ path: "a.md", pane: 0 }]);
});

test("装载后恢复：探测失败等价于「不在 vault 内」（与只看枚举集合的旧行为一致）", async () => {
  const rig = createStoreRig();
  rig.pathsExistImpl = async () => {
    throw { code: "io", message: "后端不可用" };
  };
  rig.setGetSession(async () => sessionOf(["a.md", "gone.md"], "a.md"));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  assert.deepEqual(rig.shells, [{ path: "a.md", pane: 0 }]);
  assert.deepEqual(rig.toasts, [skippedText(1)]);
});

test("装载后恢复：没有历史或全部不可用 → 空 vault 首入态（不建任何壳）", async () => {
  const rig = createStoreRig();
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  assert.equal(rig.emptyVaults, 1, "没有历史（会话缺失）也要给空态引导");
  assert.deepEqual(rig.opened, []);
  assert.deepEqual(rig.shells, []);
  assert.deepEqual(rig.toasts, [], "本来就没有历史，不报「跳过 N 个」");

  rig.setGetSession(async () => sessionOf(["x.md"], "x.md"));
  await rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  assert.equal(rig.emptyVaults, 2);
  assert.deepEqual(rig.shells, [], "全部条目都不在 vault 里 ⇒ 一个壳都不建（标签栏隐藏）");
  assert.deepEqual(rig.toasts, [skippedText(1)]);
});

test("装载后恢复：装载期间又装载一次 vault，前一次的恢复整体作废", async () => {
  const rig = createStoreRig();
  // vault-a 的会话读取慢一拍（模拟用户在第一份恢复途中就切走了）
  rig.setGetSession(async (vaultId) => {
    if (vaultId !== "vault-a") return null;
    await new Promise((resolve) => setImmediate(resolve));
    return sessionOf(["a.md"], "a.md");
  });

  const first = rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  await rig.store.onVaultLoaded("vault-b", [fileEntry("b.md")]); // 用户已抢到别的 vault
  await first;
  assert.deepEqual(rig.opened, [], "被让位的那次恢复不许往新 vault 里放旧标签");
  assert.deepEqual(rig.shells, [], "被让位的那次连壳都不许建（壳在装载后的同一拍里，没有可交错的 await）");
  assert.equal(rig.emptyVaults, 1, "让位后按 vault-b 的会话走：没有历史 → 空态");
});

test("装载后恢复：内容装载途中又装载一次 vault，前一批不许激活（世代在收口处比对）", async () => {
  const rig = createStoreRig();
  rig.setGetSession(async (vaultId) => (vaultId === "vault-a" ? sessionOf(["a.md"], "a.md") : null));
  rig.setOpenSlow(true); // 内容装载慢一拍：壳已经建好、装载还在途
  const first = rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  // 让第一次走到内容装载（壳已经建好、`openPinned` 在途），此时用户又切了一次
  await new Promise((resolve) => setImmediate(resolve));
  rig.setOpenSlow(false);
  const second = rig.store.onVaultLoaded("vault-b", [fileEntry("b.md")]);
  await Promise.all([first, second]);
  assert.deepEqual(
    rig.shells,
    [{ path: "a.md", pane: 0 }],
    "壳只在第一次装载的当帧建过一次（第二次没有会话历史）",
  );
  assert.deepEqual(rig.activated, [], "被让位的那一批不许激活任何标签");
  assert.equal(rig.emptyVaults, 1, "最后落的是 vault-b 的空态");
});

// ---------------------------------------------------------------------------
// 切换门与闸：三动作状态机 + 一次只处理一个切换
// ---------------------------------------------------------------------------

interface GateRig {
  gate: ReturnType<typeof createVaultSwitchGate>;
  notices: Array<{ text: string; actions: ToastAction[] }>;
  failures: string[];
  proceeded: number;
  saveAllCalls: number;
  /** 门内动作的调用次序（`begin` / `saveAll` / `end` / `proceed`）——指示窗口的时序断言
   *  用它与写盘、继续这两步排在**同一条时间线**上（M283 的 2.2）。 */
  calls: string[];
  setBlock(block: VaultSwitchBlock | null): void;
  setSaveAll(result: boolean): void;
  setSaveAllThrow(next: boolean): void;
}

function createGateRig(): GateRig {
  let block: VaultSwitchBlock | null = null;
  let saveAllResult = true;
  let saveAllThrows = false;
  const rig: GateRig = {
    gate: undefined as unknown as ReturnType<typeof createVaultSwitchGate>,
    notices: [],
    failures: [],
    proceeded: 0,
    saveAllCalls: 0,
    calls: [],
    setBlock: (next) => void (block = next),
    setSaveAll: (result) => void (saveAllResult = result),
    setSaveAllThrow: (next) => void (saveAllThrows = next),
  };
  rig.gate = createVaultSwitchGate({
    block: () => block,
    saveAll: async () => {
      rig.saveAllCalls += 1;
      rig.calls.push("saveAll");
      if (saveAllThrows) throw new Error("写盘失败");
      return saveAllResult;
    },
    // 指示的假句柄：只记开合（真句柄是装配层的引用计数转圈，见 vault-switcher 的工厂）。
    saveAllWindow: {
      begin: () => void rig.calls.push("begin"),
      end: () => void rig.calls.push("end"),
    },
    currentName: () => "vault-a",
    notify: (text, actions) => void rig.notices.push({ text, actions }),
    fail: (message) => void rig.failures.push(message),
  });
  return rig;
}

const proceed = (rig: GateRig) => () => {
  rig.calls.push("proceed");
  rig.proceeded += 1;
};

test("切换门：干净放行；dirty 拦下给三动作，保存未闭环不继续，保存闭环才继续", async () => {
  const rig = createGateRig();
  assert.equal(rig.gate.request(proceed(rig)), true);
  await flush();
  assert.equal(rig.proceeded, 1);

  rig.setBlock({ dirtyCount: 2, hasUnsaveable: false });
  assert.equal(rig.gate.request(proceed(rig)), false);
  assert.equal(rig.proceeded, 1, "拦下时必须不发起切换");
  assert.equal(rig.notices.length, 1);
  assert.equal(rig.notices[0].text, vaultGuardText("vault-a", 2));
  assert.deepEqual(
    rig.notices[0].actions.map((action) => action.label),
    ["保存并切换", "放弃修改并切换", "取消"],
  );

  // 保存未闭环（冲突 / 写失败 / 无基准）：MUST NOT 继续切换
  rig.setSaveAll(false);
  rig.notices[0].actions[0].run();
  await flush();
  assert.equal(rig.proceeded, 1);
  assert.equal(rig.saveAllCalls, 1);

  rig.setSaveAll(true);
  rig.notices[0].actions[0].run();
  await flush();
  assert.equal(rig.proceeded, 2);
  assert.equal(rig.saveAllCalls, 2);

  // 取消：什么都不做（不保存、不切换）
  rig.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  rig.gate.request(proceed(rig));
  rig.notices.at(-1)!.actions[2].run();
  await flush();
  assert.equal(rig.proceeded, 2);
  assert.equal(rig.saveAllCalls, 2);
});

test("切换门：放弃修改并切换直接继续，不走保存", async () => {
  const rig = createGateRig();
  rig.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  rig.gate.request(proceed(rig));
  rig.notices[0].actions[1].run();
  await flush();
  assert.equal(rig.proceeded, 1);
  assert.equal(rig.saveAllCalls, 0);
});

// ---------------------------------------------------------------------------
// 「保存并切换」的写盘段指示窗口（M283 的 2.1 / 2.2）：三种出口的开关时序逐条断言
//
// 判据是**次序**：写盘段的 begin 必须早于 saveAll、end 必须紧随其后，且中间没有别的动作
// ——「指示在写盘开始前就出现」这条 spec 文本因此落在断言上，而不是靠实现自觉。
// 反向验证（M283 的 2.4）：把 begin/end 挪回 proceed 内的装载壳（即删掉这里的成对收口），
// 第一条用例会当场红（calls 变成 ["saveAll","proceed"]）。
// ---------------------------------------------------------------------------

test("指示窗口：保存并切换的写盘段包住 saveAll，紧接装载（指示不在装载完才起）", async () => {
  const rig = createGateRig();
  rig.setBlock({ dirtyCount: 2, hasUnsaveable: false });
  rig.gate.request(proceed(rig));
  rig.notices[0].actions[0].run();
  await flush();
  assert.deepEqual(rig.calls, ["begin", "saveAll", "end", "proceed"]);
});

test("指示窗口：干净路径不经过写盘段（指示由装载壳自己起）", async () => {
  const rig = createGateRig();
  assert.equal(rig.gate.request(proceed(rig)), true);
  await flush();
  assert.deepEqual(rig.calls, ["proceed"]);
});

test("指示窗口：写盘未闭环 ⇒ 指示撤下且不切换", async () => {
  const rig = createGateRig();
  rig.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  rig.setSaveAll(false);
  rig.gate.request(proceed(rig));
  rig.notices[0].actions[0].run();
  await flush();
  assert.deepEqual(rig.calls, ["begin", "saveAll", "end"]);
  assert.equal(rig.proceeded, 0);
});

test("指示窗口：写盘抛错 ⇒ 指示仍撤下，只留一条失败提示", async () => {
  const rig = createGateRig();
  rig.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  rig.setSaveAllThrow(true);
  rig.gate.request(proceed(rig));
  rig.notices[0].actions[0].run();
  await flush();
  assert.deepEqual(rig.calls, ["begin", "saveAll", "end"]);
  assert.deepEqual(rig.failures, ["写盘失败"]);
});

test("指示窗口：取消不开指示；放弃修改并切换也不开（它不写盘）", async () => {
  const rig = createGateRig();
  rig.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  rig.gate.request(proceed(rig));
  rig.notices[0].actions[2].run(); // 取消
  await flush();
  assert.deepEqual(rig.calls, [], "取消 ⇒ 没有任何工作在进行，MUST NOT 出现指示");

  rig.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  rig.gate.request(proceed(rig));
  rig.notices.at(-1)!.actions[1].run(); // 放弃修改并切换
  await flush();
  assert.deepEqual(rig.calls, ["proceed"], "不写盘 ⇒ 门不开指示（由装载壳起）");
});

test("切换门：不可保存的脏标签不给「保存并切换」（那是一条走不通的建议）", async () => {
  const rig = createGateRig();
  rig.setBlock({ dirtyCount: 1, hasUnsaveable: true });
  rig.gate.request(proceed(rig));
  assert.deepEqual(
    rig.notices[0].actions.map((action) => action.label),
    ["放弃修改并切换", "取消"],
  );
});

test("切换门：切换进行中忽略新的请求；继续一步抛错时只给一条失败提示", async () => {
  const rig = createGateRig();
  const slow = () => new Promise<void>((resolve) => void setImmediate(() => resolve()));
  assert.equal(rig.gate.request(slow), true);
  assert.equal(rig.gate.request(proceed(rig)), false, "在途期间第二次请求被忽略");
  await flush();
  assert.equal(rig.proceeded, 0, "被忽略的请求从未执行");
  assert.equal(rig.failures.length, 0);

  // 打开失败：保留当前上下文，只给一条提示
  assert.equal(rig.gate.request(() => Promise.reject(new Error("目录不可读"))), true);
  await flush();
  assert.deepEqual(rig.failures, ["目录不可读"]);
});

// ---------------------------------------------------------------------------
// remap 浮条的两个出口（M163 r1 P1-1）：动作时点的 dirty 门
// ---------------------------------------------------------------------------

interface RemapRig {
  prompt: ReturnType<typeof createVaultRemapPrompt>;
  calls: string[];
  notices: Array<{ text: string; actions: ToastAction[] }>;
  openPaths: string[];
  remapped: Array<{ id: string; path: string }>;
  failures: string[];
  setBlock(block: VaultSwitchBlock | null): void;
  setSaveAll(result: boolean): void;
}

function createRemapRig(): RemapRig {
  let block: VaultSwitchBlock | null = null;
  let saveAllResult = true;
  const rig: RemapRig = {
    prompt: undefined as unknown as ReturnType<typeof createVaultRemapPrompt>,
    calls: [],
    notices: [],
    openPaths: [],
    remapped: [],
    failures: [],
    setBlock: (next) => void (block = next),
    setSaveAll: (result) => void (saveAllResult = result),
  };
  // 门用真品（createVaultSwitchGate），这样「拦下 → 三条出口 → 继续」整条链都被测到。
  const gate = createVaultSwitchGate({
    block: () => block,
    saveAll: async () => saveAllResult,
    // 指示的假句柄（本组用例不验指示时序，只要求门拿得到那个口子）。
    saveAllWindow: { begin: () => {}, end: () => {} },
    currentName: () => "vault-a",
    notify: (text, actions) => {
      rig.calls.push("guard-notify");
      rig.notices.push({ text, actions });
    },
    fail: (message) => void rig.failures.push(message),
  });
  rig.prompt = createVaultRemapPrompt({
    guard: (proceed) => {
      rig.calls.push("guard");
      return gate.request(proceed);
    },
    notify: (text, actions) => void rig.notices.push({ text, actions }),
    displayName: (path) => path.slice(path.lastIndexOf("/") + 1),
    openPath: async (path) => {
      rig.calls.push("openPath");
      rig.openPaths.push(path);
    },
    remap: async (id, path) => {
      rig.calls.push("remap");
      rig.remapped.push({ id, path });
    },
    fail: (message) => void rig.failures.push(message),
  });
  return rig;
}

const REMAP_INFO = {
  root: "/Users/alex/notes-moved",
  remap_candidates: [{ id: "notes", path: "/Users/alex/notes" }],
};

test("remap 浮条：干净时两个出口都摆出来，动作直接打开（门在打开之前）", async () => {
  const rig = createRemapRig();
  rig.prompt.present(REMAP_INFO);
  assert.equal(rig.notices.length, 1);
  assert.equal(
    rig.notices[0].text,
    "「notes-moved」尚未注册为 vault；发现可能已移动的 vault：/Users/alex/notes",
  );
  assert.deepEqual(
    rig.notices[0].actions.map((action) => action.label),
    ["作为新 vault 打开", "确认映射到此路径"],
  );

  rig.notices[0].actions[0].run();
  await flush();
  assert.deepEqual(rig.openPaths, ["/Users/alex/notes-moved"]);
  assert.deepEqual(rig.calls, ["guard", "openPath"], "门必须在打开之前（判据顺序）");

  // 「确认映射到此路径」：先 remap 再打开
  const mapped = createRemapRig();
  mapped.prompt.present(REMAP_INFO);
  mapped.notices[0].actions[1].run();
  await flush();
  assert.deepEqual(mapped.remapped, [{ id: "notes", path: "/Users/alex/notes-moved" }]);
  assert.deepEqual(mapped.openPaths, ["/Users/alex/notes-moved"]);
  assert.deepEqual(mapped.calls, ["remap", "guard", "openPath"]);
});

test("remap 浮条：dirty 时按出口处置才继续（保存并切换 / 放弃修改并切换）", async () => {
  // 先在干净时摆浮条，拿到两个出口（这是用户手上那份浮条）
  const rig = createRemapRig();
  rig.prompt.present(REMAP_INFO);
  const exits = rig.notices[0].actions;

  // 浮条存活期间产生 dirty
  rig.setBlock({ dirtyCount: 2, hasUnsaveable: false });
  rig.calls.length = 0;
  exits[0].run(); // 「作为新 vault 打开」
  await flush();
  assert.deepEqual(rig.openPaths, [], "被拦下时 MUST NOT 打开（否则 editor.reset 静默丢弃修改）");
  assert.deepEqual(rig.calls, ["guard", "guard-notify"], "门先跑，拦下即给三出口");

  // 「保存并切换」：保存未闭环就不继续
  const guardNotice = rig.notices.at(-1)!;
  assert.deepEqual(
    guardNotice.actions.map((action) => action.label),
    ["保存并切换", "放弃修改并切换", "取消"],
  );
  rig.setSaveAll(false);
  guardNotice.actions[0].run();
  await flush();
  assert.deepEqual(rig.openPaths, [], "保存未闭环不继续切换");

  rig.setSaveAll(true);
  guardNotice.actions[0].run();
  await flush();
  assert.deepEqual(rig.openPaths, ["/Users/alex/notes-moved"]);

  // 「放弃修改并切换」：不经保存直接继续
  const second = createRemapRig();
  second.prompt.present(REMAP_INFO);
  second.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  second.notices[0].actions[0].run();
  await flush();
  assert.deepEqual(second.openPaths, []);
  second.notices.at(-1)!.actions[1].run();
  await flush();
  assert.deepEqual(second.openPaths, ["/Users/alex/notes-moved"]);

  // 「确认映射到此路径」：remap 先落（注册表修正不丢内容），门拦的是重开
  const mapped = createRemapRig();
  mapped.prompt.present(REMAP_INFO);
  mapped.setBlock({ dirtyCount: 1, hasUnsaveable: false });
  mapped.notices[0].actions[1].run();
  await flush();
  assert.deepEqual(mapped.remapped, [{ id: "notes", path: "/Users/alex/notes-moved" }]);
  assert.deepEqual(mapped.openPaths, [], "门拦的是重开：dirty 时 remap 已落但不开");
  assert.deepEqual(mapped.calls, ["remap", "guard", "guard-notify"]);
});

// ---------------------------------------------------------------------------
// 守卫提示的呈现（M163 r1 P2-1）：同文案的第二次请求必须换新浮条
// ---------------------------------------------------------------------------

test("守卫提示呈现：先撤下既有浮条，同文案的第二次请求不会复用旧动作（P2-1）", () => {
  const live = new Map<string, { text: string; actions: ToastAction[] }>();
  /** 复刻装配层 toast 的 sticky 去重：按文案命中即复用旧元素（新 actions 被丢弃）。 */
  const toast = (text: string, actions: ToastAction[], sticky: boolean) => {
    const existing = sticky ? live.get(text) : undefined;
    if (existing !== undefined) return existing;
    const el = { text, actions };
    if (sticky) live.set(text, el);
    return el;
  };
  const present = createGuardPromptPresenter({
    clearPrevious: () => live.clear(),
    toast: (text, actions, sticky) => void toast(text, actions, sticky),
  });
  const toB: ToastAction = { label: "放弃修改并切换", run: () => {} };
  const toC: ToastAction = { label: "放弃修改并切换", run: () => {} };

  present("同一句提示", [toB]);
  assert.equal(live.get("同一句提示")?.actions[0], toB);
  // 不处置就再点另一个 vault：文案逐字相同（只点名当前 vault + 计数），去重会命中
  present("同一句提示", [toC]);
  assert.equal(
    live.get("同一句提示")?.actions[0],
    toC,
    "第二次请求的动作必须换新——否则用户点「放弃修改并切换」会切到上一个目标",
  );
});

// ---------------------------------------------------------------------------
// 会话存储补充（M163 r1 P2-2）：「集合变化必须沿同一条防抖写盘」这一条覆盖在下面
// 「变化后防抖写盘」两个用例里。M254 之前这里还有一个专门的用例讲「预览标签被提升为
// 固定后要再报一次集合变化」——预览机制退场后没有「提升」这个动作，用例随之删除
//（那条链路的回归防线由上面两个用例承担：写盘集合就是全部有路径的标签）。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 浮层：渲染与交互（最小假 DOM——浮层那一层是唯一有 DOM 的代码，这里用替身把它的行为
// 拉进可复现的断言：渲染哪些行、点击落到哪个请求、键盘游标怎么走、关闭后状态怎么回。
// 真实渲染的观感仍归视觉门禁与真机手感，不在这一层。）
// ---------------------------------------------------------------------------

interface FakeEvent {
  key?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  code?: string;
  target?: unknown;
  /** focusout 的落点（浮层的「焦点离开浮层才收起」判据读它）。 */
  relatedTarget?: unknown;
  /** input 事件的组合期标记（筛选的组合期不刷新判据读它）。 */
  isComposing?: boolean;
  defaultPrevented?: boolean;
  preventDefault?(): void;
}

/** 元素替身：只实现被浮层代码碰到的那一小撮 DOM 面。 */
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
    contains: (name: string) => this.classes.has(name),
  };
  /** 浮层代码两种写法都用（`className = "x"` 与 `classList.add("x")`），替身两种都认。 */
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
  offsetWidth = 0;
  focused = false;
  /** 输入框面（筛选行是 change list-filter 起的第一个可编辑宿主，代码读 value、写 placeholder）。 */
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

  /** 手动派发（测试驱动用；不走事件冒泡——本层只断言浮层自己的处理）。 */
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
    return { left: 0, top: 0, right: 320, bottom: 20, width: 320, height: 20 };
  }

  /** 深度优先找类名命中的后代（含自身）。 */
  find(className: string): FakeEl[] {
    const out: FakeEl[] = [];
    if (this.classes.has(className)) out.push(this);
    for (const child of this.children) out.push(...child.find(className));
    return out;
  }
}

interface FakeDocument {
  /** 手动派发挂在 document 上的监听（浮层的「点浮层外收起」走这条）。 */
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
  // 浮层的判定用 `target instanceof Node`（与 .lumir-toc 同款）：最小替身里让 Node 由 FakeEl
  // 顶替，判定的语义（「这个目标是不是元素」）保持不变。
  (globalThis as unknown as Record<string, unknown>).Node = FakeEl;
  return {
    fire: (type, event) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

interface SwitcherRig {
  switcher: ReturnType<typeof createVaultSwitcher>;
  doc: FakeDocument;
  mounts: FakeEl;
  entries: FakeEl[];
  popover(): FakeEl;
  /** 筛选输入行（浮层容器的第一个子项；持焦点、承载查询）。 */
  input(): FakeEl;
  list(): FakeEl;
  switched: VaultListEntry[];
  relocated: Array<{ row: VaultListEntry; siblings: readonly VaultListEntry[] }>;
  added: number;
  expandedFlags: boolean[];
  focusedEditor: number;
  warns: string[];
  /** `list()` 被调用的次数（筛选 MUST NOT 触发第二次拉取，tasks 3.4）。 */
  listCalls: number;
  /** 当前选中行的 vault id（无选中行时 undefined）。 */
  activeRowId(): string | undefined;
  /** 编辑器替身：阅读位置（滚动值语义）+ 光标位置 + 三条 dep 的调用次序。 */
  editor: {
    /** 当前阅读位置。 */
    scrollTop: number;
    /** 光标在阅读面上的位置：环境替身在聚焦时把视口揭示到这里。 */
    caretTop: number;
    calls: string[];
  };
  setScrollTop(value: number): void;
  setCaretTop(value: number): void;
}

function createSwitcherRig(rows: VaultListEntry[]): SwitcherRig {
  const doc = installFakeDocument();
  const mounts = new FakeEl("div");
  const entry = new FakeEl("button");
  let notify: ((rows: VaultListEntry[]) => void) | null = null;
  const editor = { scrollTop: 0, caretTop: 0, calls: [] as string[] };
  const rig: SwitcherRig = {
    switcher: undefined as unknown as ReturnType<typeof createVaultSwitcher>,
    doc,
    mounts,
    entries: [entry],
    popover: () => mounts.children[0],
    // 子项顺序 = 构造顺序：输入行、列表、无命中提示、分隔线、新增入口（change list-filter）。
    input: () => mounts.children[0].children[0],
    list: () => mounts.children[0].children[1],
    switched: [],
    relocated: [],
    added: 0,
    expandedFlags: [],
    focusedEditor: 0,
    warns: [],
    listCalls: 0,
    activeRowId: () =>
      mounts.children[0]
        .find("vault-row")
        .find((row) => row.classes.has("is-active"))?.dataset.vault,
    editor,
    setScrollTop: (value) => void (editor.scrollTop = value),
    setCaretTop: (value) => void (editor.caretTop = value),
  };
  rig.switcher = createVaultSwitcher({
    mount: mounts as unknown as HTMLElement,
    entry: () => entry as unknown as HTMLElement,
    toast: () => {},
    layout: () => ({ panes: [{ sessions: [], activePath: undefined }], ratio: 0.5, harnessPane: false }),
    list: () => {
      rig.listCalls += 1;
      notify?.(rows);
      return Promise.resolve(rows);
    },
    requestSwitch: (row) => void rig.switched.push(row),
    requestAdd: () => void (rig.added += 1),
    requestRelocate: (row, siblings) => void rig.relocated.push({ row, siblings }),
    expanded: (value) => void rig.expandedFlags.push(value),
    readingPosition: () => {
      editor.calls.push("readingPosition");
      return { at: editor.scrollTop } as unknown as ScrollSnapshot;
    },
    restoreReadingPosition: (snapshot) => {
      editor.calls.push("restoreReadingPosition");
      editor.scrollTop = (snapshot as unknown as { at: number }).at;
    },
    // 环境替身：聚焦会把视口揭示到光标处（浏览器在聚焦可编辑元素时保证光标可见）。M186 真机
    // 没复现出这条路径（见场景 25 的「覆盖边界」），替身按它的**可能**行为演出来——产品代码
    // 必须在聚焦前后守住位置，而不是假定它不会发生。
    focusEditor: () => {
      editor.calls.push("focusEditor");
      rig.focusedEditor += 1;
      editor.scrollTop = editor.caretTop;
    },
    getSession: async () => null,
    putSession: async () => {},
    // 本组用例不碰存在探测：默认「都不在 vault 内」（= 只看枚举集合的旧口径）。
    pathsExist: async () => [],
    openPinned: async () => true,
    // M283 的两个新口子 + M318 的 applyPaneCount：本组用例（浮层 DOM 与阅读位置）不碰会话恢复，
    // 给最小替身。
    applyPaneCount: () => {},
    createShell: () => true,
    shellsBuilt: () => {},
    activate: () => {},
    onEmptyVault: () => {},
    warn: (text) => void rig.warns.push(text),
  });
  notify = () => {};
  return rig;
}

const keydownEvent = (key: string, over: FakeEvent = {}): FakeEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  preventDefault: () => {},
  ...over,
});

test("浮层：打开后渲染全部行（含当前项与失效行）与底部新增入口；未装载时无操作", async () => {
  const rig = createSwitcherRig([
    listRow({ id: "notes", path: "/Users/alex/notes", tab_count: 2, last_opened_at: Date.now() }),
    listRow({ id: "archive", path: "/Volumes/gone", available: false, name: "archive" }),
  ]);
  await rig.switcher.onVaultLoaded("notes", []); // 当前项 = notes
  rig.switcher.toggle();
  await flush();

  const popover = rig.popover();
  assert.equal(popover.hidden, false);
  assert.deepEqual(rig.expandedFlags, [true], "展开态要同步到入口（aria-expanded）");
  assert.equal(rig.list().getAttribute("role"), "listbox");
  assert.equal(rig.list().getAttribute("aria-label"), "vault");

  const rows = rig.popover().find("vault-row");
  assert.equal(rows.length, 2);
  // 可用行：名字 + 摘要（当前项说「现在打开」）；路径行已裁（M217 S12）
  assert.deepEqual(rows[0].find("vault-row-name").map((el) => el.textContent), ["notes"]);
  assert.deepEqual(rows[0].find("vault-row-flag").map((el) => el.textContent), ["当前"]);
  assert.ok(rows[0].find("vault-row-sub").some((el) => el.textContent === "2 个标签 · 现在打开"));
  assert.equal(rows[0].getAttribute("role"), "option");
  // 失效行：成因 + 「重新定位…」，语义标记为不可选中
  assert.equal(rows[1].getAttribute("aria-disabled"), "true");
  assert.ok(rows[1].find("vault-row-sub").some((el) => el.textContent.startsWith("路径不可用")));
  assert.deepEqual(rows[1].find("vault-row-act").map((el) => el.textContent), ["重新定位…"]);
  // 底部新增入口（浮层内唯一入口）
  assert.equal(rig.popover().find("vault-add").length, 1);

  // 收起后：浮层隐藏、展开态回落
  rig.switcher.toggle();
  assert.equal(popover.hidden, true);
  assert.deepEqual(rig.expandedFlags, [true, false]);
});

test("浮层：未装载 vault（入口不存在）时打开是无操作", () => {
  const rig = createSwitcherRig([]);
  const mounts = new FakeEl("div");
  installFakeDocument();
  const switcher = createVaultSwitcher({
    mount: mounts as unknown as HTMLElement,
    entry: () => undefined, // 空态：树头部没有入口
    toast: () => {},
    layout: () => ({ panes: [{ sessions: [], activePath: undefined }], ratio: 0.5, harnessPane: false }),
    list: () => Promise.resolve([]),
    requestSwitch: () => {},
    requestAdd: () => {},
    requestRelocate: () => {},
    expanded: () => {},
    readingPosition: () => ({ at: 0 }) as unknown as ScrollSnapshot,
    restoreReadingPosition: () => {},
    focusEditor: () => {},
    getSession: async () => null,
    putSession: async () => {},
    pathsExist: async () => [],
    openPinned: async () => true,
    applyPaneCount: () => {},
    createShell: () => true,
    shellsBuilt: () => {},
    activate: () => {},
    onEmptyVault: () => {},
    warn: () => {},
  });
  switcher.toggle();
  assert.equal(mounts.children[0].hidden, true);
  assert.equal(rig.added, 0);
});

test("浮层：点击可用行发起切换，点击失效行只发起重定位（不发起打开）", async () => {
  const rows = [
    listRow({ id: "notes", path: "/Users/alex/notes" }),
    listRow({ id: "archive", path: "/Volumes/gone", available: false, name: "archive" }),
  ];
  const rig = createSwitcherRig(rows);
  await rig.switcher.onVaultLoaded("notes", []);
  rig.switcher.toggle();
  await flush();

  rig.popover().find("vault-row")[0].fire("click");
  assert.deepEqual(rig.switched.map((row) => row.id), ["notes"]);
  assert.equal(rig.relocated.length, 0);

  rig.switcher.toggle();
  await flush();
  rig.popover().find("vault-row")[1].fire("click");
  assert.equal(rig.switched.length, 1, "失效行不发起打开");
  assert.deepEqual(rig.relocated.map((item) => item.row.id), ["archive"]);
  assert.deepEqual(rig.relocated[0].siblings.map((row) => row.id), ["notes", "archive"]);

  rig.switcher.toggle();
  await flush();
  rig.popover().find("vault-add")[0].fire("click");
  assert.equal(rig.added, 1);
});

test("浮层：↑↓ / ⌃N⌃P 只走可选中行，Enter 切换，当前项上 Enter 只关闭，Esc 关闭交还焦点", async () => {
  const rows = [
    listRow({ id: "notes", path: "/Users/alex/notes" }),
    listRow({ id: "archive", path: "/Volumes/gone", available: false, name: "archive" }),
    listRow({ id: "work", path: "/Users/alex/work" }),
  ];
  const rig = createSwitcherRig(rows);
  await rig.switcher.onVaultLoaded("notes", []);
  rig.switcher.toggle();
  await flush();

  const active = (): FakeEl => {
    const el = rig.list().find("vault-row").find((row) => row.classes.has("is-active"));
    assert.ok(el !== undefined, "没有选中的行");
    return el;
  };
  assert.equal(active().dataset.vault, "notes", "默认游标落在当前项");

  // ↓ 跳过失效行，落到下一个可切换的行
  rig.popover().fire("keydown", keydownEvent("ArrowDown"));
  assert.equal(active().dataset.vault, "work");
  // 末项再按不动（钳制，不回卷）
  rig.popover().fire("keydown", keydownEvent("ArrowDown"));
  assert.equal(active().dataset.vault, "work");
  // ⌃P 与 ↑ 等价
  rig.popover().fire("keydown", keydownEvent("p", { ctrlKey: true }));
  assert.equal(active().dataset.vault, "notes");
  rig.popover().fire("keydown", keydownEvent("p", { ctrlKey: true }));
  assert.equal(active().dataset.vault, "notes", "首项钳制");

  // Enter 切换当前游标行
  rig.popover().fire("keydown", keydownEvent("ArrowDown"));
  rig.popover().fire("keydown", keydownEvent("Enter"));
  assert.deepEqual(rig.switched.map((row) => row.id), ["work"]);
  assert.equal(rig.popover().hidden, true, "发起切换后浮层收起");

  // 当前项上按 Enter：只关闭，不做一次无谓的重载
  rig.switcher.toggle();
  await flush();
  rig.popover().fire("keydown", keydownEvent("Enter"));
  assert.deepEqual(rig.switched.map((row) => row.id), ["work"]);
  assert.equal(rig.popover().hidden, true);
  assert.equal(rig.focusedEditor, 1, "键盘关闭要把焦点交还编辑器");

  // Esc：关闭并交还焦点
  rig.switcher.toggle();
  await flush();
  rig.popover().fire("keydown", keydownEvent("Escape"));
  assert.equal(rig.popover().hidden, true);
  assert.equal(rig.focusedEditor, 2);
  // 列表读取失败：只给一条人话提示，不弹空浮层
  assert.deepEqual(rig.warns, []);
});

// ---------------------------------------------------------------------------
// 阅读位置不变量（M186）：收起浮层交还焦点 MUST NOT 改变正文阅读位置
// ---------------------------------------------------------------------------
//
// 缺陷现场（Alex 原话）：「打开 vault 列表然后 ESC 收起列表，右栏文档内容区域会自动回到顶部。
// 期望是不改阅读位置，应该保持在刚才阅读的位置」。位置是**读者**的位置，不是焦点的一部分：
// 用户用触控板/⌃V 滚着读时光标留在原处（常常还在篇首），而把焦点放进编辑器是浏览器接管的
// 视口动作（聚焦时保证光标可见），那一刻视口就可能被打回光标处。
//
// 这里断的是不变量本身（任意阅读位置 × 任意关闭路径），不是现场那一个案例：环境替身
//（rig 的 `focusEditor`）按该行为的**可能**形态把视口揭示到光标处——产品代码必须在聚焦前后
// 守住位置，不依赖它是否真的发生。光标位置也参与扫：光标停在阅读位置之内时揭示本来就是无
// 副作用的，那种输入下不变量同样必须成立（它不该只在「光标在别处」时才成立）。

/** 收起浮层的三条路径（都走 close(restoreFocus=true)）。 */
type ClosePath = "escape" | "enter-current" | "toggle";

async function closeVia(rig: SwitcherRig, path: ClosePath): Promise<void> {
  if (path === "toggle") {
    rig.switcher.toggle();
    return;
  }
  rig.popover().fire("keydown", keydownEvent(path === "escape" ? "Escape" : "Enter"));
}

/** 打开浮层并等列表渲染完成。 */
async function openSwitcher(rig: SwitcherRig): Promise<void> {
  rig.switcher.toggle();
  await flush();
}

test("浮层收起：交还焦点前后阅读位置不变（任意阅读位置 × 光标位置 × 关闭路径）", async () => {
  const readingPositions = [0, 1, 137, 2400, 5000];
  const caretPositions = [0, 137, 5000]; // 光标在篇首 / 文中 / 文末
  const paths: ClosePath[] = ["escape", "enter-current", "toggle"];

  for (const scrollTop of readingPositions) {
    for (const caretTop of caretPositions) {
      for (const path of paths) {
        const rig = createSwitcherRig([listRow({ id: "notes", path: "/Users/alex/notes" })]);
        await rig.switcher.onVaultLoaded("notes", []); // 当前项 = notes
        await openSwitcher(rig);
        rig.setScrollTop(scrollTop);
        rig.setCaretTop(caretTop);

        await closeVia(rig, path);

        const where = `${path}(阅读位置 ${scrollTop} / 光标 ${caretTop})`;
        assert.equal(rig.popover().hidden, true, `${where}：浮层应已收起`);
        assert.equal(rig.focusedEditor, 1, `${where}：焦点应交还编辑器`);
        assert.equal(rig.editor.scrollTop, scrollTop, `${where}：阅读位置不得被改变`);
        // 次序即口径：快照 MUST 在聚焦之前取——聚焦后取到的是被揭示改过的值，写回等于白写。
        assert.deepEqual(
          rig.editor.calls,
          ["readingPosition", "focusEditor", "restoreReadingPosition"],
          `${where}：取快照 → 聚焦 → 写回，顺序不得颠倒`,
        );
      }
    }
  }
});

test("浮层收起：不接管焦点的收起路径（blur / 点浮层外）不碰阅读位置", async () => {
  // 这两条路上焦点归用户点的那个东西，不由浮层接管——拿旧位置把视口拽回去反而是越权。
  for (const close of [
    // 焦点离开浮层（tab 出去 / 点到别处）：挂点在**容器**上（change list-filter 的外移），
    // relatedTarget 在浮层之外即收起。
    (rig: SwitcherRig) => rig.popover().fire("focusout", { relatedTarget: new FakeEl("div") }),
    (rig: SwitcherRig) => rig.doc.fire("mousedown", { target: new FakeEl("div") }),
  ]) {
    const rig = createSwitcherRig([listRow({ id: "notes", path: "/Users/alex/notes" })]);
    await rig.switcher.onVaultLoaded("notes", []);
    await openSwitcher(rig);
    rig.setScrollTop(1400);
    rig.setCaretTop(0);

    close(rig);

    assert.equal(rig.popover().hidden, true, "浮层应已收起");
    assert.equal(rig.focusedEditor, 0, "不接管焦点的路径 MUST NOT 抢焦点");
    assert.deepEqual(rig.editor.calls, [], "这些路径 MUST NOT 读写阅读位置");
    assert.equal(rig.editor.scrollTop, 1400);
  }
});

test("浮层：点入口不收起（closer 排除入口），点浮层外收起（P2-5）", async () => {
  const rig = createSwitcherRig([listRow({ id: "notes", path: "/Users/alex/notes" })]);
  await rig.switcher.onVaultLoaded("notes", []);
  rig.switcher.toggle();
  await flush();
  assert.equal(rig.popover().hidden, false);

  // 入口是「开 → 关」的切换点：点它不该先收起再重开（那会闪一下 + 假翻 aria-expanded）
  rig.doc.fire("mousedown", { target: rig.entries[0] });
  assert.equal(rig.popover().hidden, false, "点入口不收起");

  // 点浮层与入口之外：收起
  rig.doc.fire("mousedown", { target: new FakeEl("div") });
  assert.equal(rig.popover().hidden, true);
});

test("listRow helper：摘要与列表行字段同源（tab_count / last_opened_at 直接来自契约）", () => {
  const now = 1_700_000_000_000;
  const row = listRow({ id: "notes", tab_count: 2, last_opened_at: now - 3 * 60_000 });
  assert.equal(summaryText(row.tab_count, row.last_opened_at, now, false), "2 个标签 · 3分钟前");
  assert.equal(row.available, true);
});

// ---------------------------------------------------------------------------
// 输入筛选（change list-filter，M199）
// ---------------------------------------------------------------------------
//
// 本层判的是 vault 侧的作用面（匹配哪个字段、谁参与筛选、谁不受影响、结果集与下标的映射），
// 匹配语义与查询状态本身在 tests/unit/list-filter.test.ts（两处共用的那一份实现）。

/** 输入一个查询（真实路径：写 value 再派发 input 事件，与浏览器一致）。 */
function typeQuery(rig: SwitcherRig, query: string): void {
  rig.input().value = query;
  rig.input().fire("input", {});
}

const FILTER_ROWS = (): VaultListEntry[] => [
  listRow({ id: "notes", path: "/Users/alex/notes", name: "notes" }),
  listRow({ id: "gone-vault", path: "/Volumes/ext/gone", name: "gone-vault", available: false }),
  listRow({ id: "sandbox", path: "/Users/alex/sandbox", name: "sandbox" }),
];

test("浮层筛选：显示名子串命中（非前缀）、失效行参与、输入不触发第二次拉取", async () => {
  const rig = createSwitcherRig(FILTER_ROWS());
  await rig.switcher.onVaultLoaded("notes", []); // 当前项 = notes
  rig.switcher.toggle();
  await flush();
  assert.equal(rig.listCalls, 1, "打开只拉一次");
  assert.equal(rig.popover().find("vault-row").length, 3);

  // 输入 "s"：中段/末段含 s 的行都命中（notes 的 s 在末尾、sandbox 的首字母也是 s），
  // 不含 s 的失效行 gone-vault 被筛掉 —— 子串而非前缀的区分点正在这里。
  typeQuery(rig, "s");
  assert.deepEqual(
    rig.popover().find("vault-row").map((row) => row.dataset.vault),
    ["notes", "sandbox"],
    "结果集顺序与后端给出的顺序一致（前端不重排）",
  );
  assert.equal(rig.activeRowId(), "notes", "游标落在首条可选中命中");

  // 摘要与路径不参与匹配：输入「没有打开过文件」（D101 的摘要文案）不命中任何行
  typeQuery(rig, "还没有打开过文件");
  assert.equal(rig.popover().find("vault-row").length, 0);

  // 失效行参与筛选（它是「重新定位…」的唯一入口，MUST NOT 被筛掉）
  typeQuery(rig, "gone");
  assert.deepEqual(rig.popover().find("vault-row").map((row) => row.dataset.vault), ["gone-vault"]);
  assert.equal(rig.activeRowId(), undefined, "失效行不在键盘游标空间里（与筛选前同一口径）");

  // 多次输入只过滤本地数组：list() 仍只调过一次
  typeQuery(rig, "note");
  assert.equal(rig.listCalls, 1, "筛选 MUST NOT 触发第二次拉取");
});

test("浮层筛选：无命中保持浮层 + 一行提示，新增入口照常可用", async () => {
  const rig = createSwitcherRig(FILTER_ROWS());
  await rig.switcher.onVaultLoaded("notes", []);
  rig.switcher.toggle();
  await flush();

  typeQuery(rig, "zzz");
  assert.equal(rig.popover().hidden, false, "无命中 MUST NOT 收起浮层");
  assert.equal(rig.list().hidden, true, "列表让位给提示行");
  const empty = rig.popover().find("vault-empty")[0];
  assert.equal(empty.hidden, false);
  assert.equal(empty.textContent, NO_MATCH_TEXT(), "文案与 list-filter 的常量同源（deck D117）");
  // 分隔线与「新增 vault…」不受筛选影响：摆脱空结果的唯一入口必须还在
  assert.equal(rig.popover().find("vault-sep")[0].hidden, false);
  assert.equal(rig.popover().find("vault-add")[0].hidden, false);
  // 点击路径仍是既有链路（close(false) + requestAdd）
  rig.popover().find("vault-add")[0].fire("click");
  assert.equal(rig.added, 1);

  // 重开（空查询）→ 输入再清空：回全量，游标回到全量态起点（当前项）
  rig.switcher.toggle();
  await flush();
  typeQuery(rig, "zzz");
  assert.equal(rig.popover().find("vault-row").length, 0);
  typeQuery(rig, "");
  assert.deepEqual(
    rig.popover().find("vault-row").map((row) => row.dataset.vault),
    ["notes", "gone-vault", "sandbox"],
  );
  assert.equal(rig.list().hidden, false);
  assert.equal(rig.popover().find("vault-empty")[0].hidden, true);
  assert.equal(rig.activeRowId(), "notes", "查询变回空时游标回到全量态起点（当前项）");
});

test("浮层筛选：当前项被筛掉不改当前 vault，关闭丢弃查询", async () => {
  const rig = createSwitcherRig(FILTER_ROWS());
  await rig.switcher.onVaultLoaded("notes", []);
  rig.switcher.toggle();
  await flush();

  typeQuery(rig, "sandbox");
  assert.equal(rig.popover().find("is-current").length, 0, "当前项被筛掉时结果集里没有当前项标记");
  assert.deepEqual(rig.switched, [], "被筛掉 MUST NOT 触发任何切换");
  assert.equal(rig.activeRowId(), "sandbox", "无当前项在结果集里时游标落首条命中");

  // Esc 一步关闭：查询随之丢弃（重开是空查询 + 全量）
  rig.popover().fire("keydown", keydownEvent("Escape"));
  assert.equal(rig.popover().hidden, true);
  assert.equal(rig.input().value, "", "关闭丢弃查询（输入框与匹配状态一起清）");
  rig.switcher.toggle();
  await flush();
  assert.equal(rig.input().value, "");
  assert.equal(rig.popover().find("vault-row").length, 3, "重开从全量开始");
  assert.equal(rig.activeRowId(), "notes", "重开的游标回到全量态起点（当前项）");
  assert.equal(rig.popover().find("is-current").length, 1, "当前项标记回来");
});

test("浮层筛选：重定位的占用判定仍看完整列表（siblings MUST NOT 变成结果集）", async () => {
  const rig = createSwitcherRig(FILTER_ROWS());
  await rig.switcher.onVaultLoaded("notes", []);
  rig.switcher.toggle();
  await flush();

  // 只筛出失效行，点击它发起重定位：siblings 必须是本次拉取的**完整列表**
  typeQuery(rig, "gone");
  rig.popover().find("vault-row")[0].fire("click");
  assert.deepEqual(rig.relocated.map((item) => item.row.id), ["gone-vault"]);
  assert.deepEqual(
    rig.relocated[0].siblings.map((row) => row.id),
    ["notes", "gone-vault", "sandbox"],
    "被筛掉的 vault 仍参与占用判定（收窄成结果集会让两个身份静默落到同一路径）",
  );
});

test("浮层筛选：组合期不刷新结果集（拼音串零命中的闪烁不发生）", async () => {
  const rig = createSwitcherRig(FILTER_ROWS());
  await rig.switcher.onVaultLoaded("notes", []);
  rig.switcher.toggle();
  await flush();

  rig.input().fire("compositionstart", {});
  rig.input().value = "an";
  rig.input().fire("input", { isComposing: true }); // 组合期的中间串
  assert.equal(rig.popover().find("vault-row").length, 3, "组合期不重算结果集");
  rig.input().value = "安装";
  rig.input().fire("compositionend", {});
  assert.equal(rig.popover().find("vault-row").length, 0, "组合结束后刷一次（此处零命中）");
  assert.equal(rig.popover().hidden, false, "零命中同样保持浮层打开");
});
