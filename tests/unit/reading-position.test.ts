// src/reading-position.ts 的单测（M194，change remember-reading-position 的 3.x / 4.x / 5.x）：
// 防抖与「内容未变不排期」、flush 的时点与内容、按枚举清理、上限淘汰、四种降级、
// 装载途中换 vault 的让位、恢复只施加于前台文档。
//
// 这一层不 import 编辑器内核（真 EditorView 需要 DOM，见 tests/unit/README.md）：位形态的两个
// 口径是纯代数、另测（tests/unit/scroll-position.test.ts），这里用假 deps 只测「哪个键、什么时候
// 读、什么时候写」。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import type { FsEntry } from "../../src/bindings/FsEntry.ts";
import type { ReadingPositionEntry } from "../../src/bindings/ReadingPositionEntry.ts";
import type { ReadingPositions } from "../../src/bindings/ReadingPositions.ts";
import type { ScrollPosition } from "../../src/scroll-position.ts";
import {
  READING_POSITION_DEBOUNCE_MS,
  READING_POSITION_MAX_ENTRIES,
  capEntries,
  createReadingPositionStore,
  mergePending,
  pruneEntries,
  samePosition,
} from "../../src/reading-position.ts";
import type { ReadingPositionMap, ReadingPositionStore } from "../../src/reading-position.ts";

/** 让 await 链跑完（mock timers 只接管 setTimeout，setImmediate 仍是真家伙）。 */
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

function fileEntry(path: string): FsEntry {
  return { path, kind: "file", size: 0, mtime_ms: null };
}

function at(pos: number, y = 48, x = 0, time = 1_700_000_000_000): ReadingPositionEntry {
  return { pos, y, x, at: time };
}

function file(entries: Record<string, ReadingPositionEntry>): ReadingPositions {
  return { version: 1, entries };
}

function position(pos: number, y = 48, x = 0): ScrollPosition {
  return { pos, y, x };
}

interface Rig {
  store: ReadingPositionStore;
  /** 前台文档路径与假编辑器的当前视口位置。 */
  activePath: string | undefined;
  view: ScrollPosition | null;
  /** 假编辑器收到的施加记录。 */
  applied: ScrollPosition[];
  /** 后端应答：vault id → 位置表（缺省 = 无历史）。 */
  files: Record<string, ReadingPositions | null>;
  failRead: boolean;
  failWrite: boolean;
  writes: Array<{ vaultId: string; entries: ReadingPositionMap }>;
  warns: string[];
}

function createRig(): Rig {
  const rig: Rig = {
    store: undefined as unknown as ReadingPositionStore,
    activePath: undefined,
    view: null,
    applied: [],
    files: {},
    failRead: false,
    failWrite: false,
    writes: [],
    warns: [],
  };
  rig.store = createReadingPositionStore({
    activePath: () => rig.activePath,
    readPosition: () => rig.view,
    applyPosition: (p) => void rig.applied.push(p),
    getPositions: async (vaultId) => {
      if (rig.failRead) throw { code: "io", message: "位置文件读不到" };
      return rig.files[vaultId] ?? null;
    },
    putPositions: async (vaultId, entries) => {
      if (rig.failWrite) throw { code: "io", message: "磁盘只读" };
      rig.writes.push({ vaultId, entries });
    },
    warn: (text) => void rig.warns.push(text),
  });
  return rig;
}

/** 装载一个 vault 并等它的位置文件读完（镜像就绪）。 */
async function load(rig: Rig, vaultId: string, entries: FsEntry[] = [fileEntry("a.md")]) {
  await rig.store.onVaultLoaded(vaultId, entries);
  await flush();
}

// ---------------------------------------------------------------------------
// 纯逻辑：上限淘汰 / 按枚举清理 / 合并
// ---------------------------------------------------------------------------

test("capEntries：按写入时刻最旧者淘汰，同一时刻按键名定序（结果与遍历顺序无关）", () => {
  const entries: ReadingPositionMap = {};
  for (let i = 0; i <= READING_POSITION_MAX_ENTRIES; i += 1) {
    entries[`f${String(i).padStart(3, "0")}.md`] = at(i, 48, 0, i);
  }
  const capped = capEntries(entries);
  assert.equal(Object.keys(capped).length, READING_POSITION_MAX_ENTRIES);
  assert.equal(capped["f000.md"], undefined, "最旧的一条被淘汰");
  assert.notEqual(capped["f200.md"], undefined, "最新的一条留下");

  // 同一时刻（at 相同）：按键名定序，取「键最大」的那些，结果稳定
  const tie: ReadingPositionMap = { b: at(1, 48, 0, 7), a: at(2, 48, 0, 7) };
  assert.deepEqual(Object.keys(capEntries(tie, 1)), ["b"]);

  // 未超限时原样保留（内容与键都对得上）
  const few: ReadingPositionMap = { "a.md": at(10) };
  assert.deepEqual(capEntries(few), few);
});

test("pruneEntries：不在 vault 内的键即时剔除，越界形态由同一次交集一并剔除", () => {
  const entries: ReadingPositionMap = {
    "a.md": at(1),
    "docs/c.md": at(2),
    "/etc/passwd": at(3),
    "../outside.md": at(4),
    "gone.md": at(5),
  };
  const pruned = pruneEntries(entries, new Set(["a.md", "docs/c.md"]));
  assert.deepEqual(Object.keys(pruned).sort(), ["a.md", "docs/c.md"]);
  // 越界键（绝对路径 / 含 ..）不可能出现在枚举结果里，因此被同一步剔除——前端不再抄一份键
  // 校验（REVIEW.md 第 8 条），这条断言钉的正是那个口径
  assert.equal(pruned["/etc/passwd"], undefined);
  assert.equal(pruned["../outside.md"], undefined);
});

test("mergePending：待写位置并入镜像并带上本次写入时刻；空待写表不改变内容", () => {
  const mirror: ReadingPositionMap = { "a.md": at(1, 48, 0, 100) };
  const merged = mergePending(mirror, new Map([["b.md", position(200)]]), 999);
  assert.deepEqual(merged["a.md"], at(1, 48, 0, 100), "已有条目的时刻不动");
  assert.deepEqual(merged["b.md"], { pos: 200, y: 48, x: 0, at: 999 });
  assert.deepEqual(mergePending(mirror, new Map(), 999), mirror);
});

test("samePosition：逐量精确比较（含横向偏移）", () => {
  assert.equal(samePosition(position(1), position(1)), true);
  assert.equal(samePosition(position(1), position(2)), false);
  assert.equal(samePosition(position(1, 48), position(1, 49)), false);
  assert.equal(samePosition(position(1, 48, 0), position(1, 48, 12)), false);
});

// ---------------------------------------------------------------------------
// 捕获与写入
// ---------------------------------------------------------------------------

test("滚动后防抖落盘整份镜像；同一位置反复回调不重置窗口、不重复写", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.activePath = "a.md";
    await load(rig, "vault-a");

    rig.view = position(1200);
    rig.store.scrolled();
    assert.equal(rig.writes.length, 0, "防抖窗口内不写盘");
    rig.store.scrolled(); // 同一位置再回调（CM 的锚点维护会这么做）：不重置窗口
    mock.timers.tick(READING_POSITION_DEBOUNCE_MS);
    await flush();
    assert.equal(rig.writes.length, 1);
    assert.equal(rig.writes[0].vaultId, "vault-a");
    const written = rig.writes[0].entries["a.md"];
    assert.equal(written?.pos, 1200);
    assert.equal(written?.y, 48);
    assert.equal(written?.x, 0);
    assert.equal(typeof written?.at, "number");
  } finally {
    mock.timers.reset();
  }
});

test("内容未变不排期：盘上已经是这一处时不再写第二遍", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.activePath = "a.md";
    rig.files["vault-a"] = file({ "a.md": at(1200) });
    await load(rig, "vault-a");

    rig.view = position(1200); // 与镜像一致
    rig.store.scrolled();
    mock.timers.tick(READING_POSITION_DEBOUNCE_MS * 2);
    await flush();
    assert.equal(rig.writes.length, 0);

    rig.view = position(1300); // 真的动了
    rig.store.scrolled();
    mock.timers.tick(READING_POSITION_DEBOUNCE_MS);
    await flush();
    assert.equal(rig.writes.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test("flush：取消防抖并立刻落盘；没有待写内容时也写一份当前镜像；未装载 vault 时是 no-op", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    // 还没装载任何 vault：没有可写的键
    await rig.store.flush();
    assert.equal(rig.writes.length, 0);

    rig.activePath = "a.md";
    await load(rig, "vault-a");
    assert.equal(rig.writes.length, 0, "装载本身不写盘（清理在下次落盘时生效，spec 的时序）");

    await rig.store.flush();
    assert.equal(rig.writes.length, 1, "没有待写内容也写一份当前快照（退出路径上没有第二次机会）");
    assert.deepEqual(rig.writes[0].entries, {});

    rig.view = position(900);
    rig.store.scrolled();
    await rig.store.flush(); // 窗口未到就切走
    assert.equal(rig.writes.length, 2);
    assert.equal(rig.writes[1].entries["a.md"]?.pos, 900);
    mock.timers.tick(READING_POSITION_DEBOUNCE_MS * 2);
    await flush();
    assert.equal(rig.writes.length, 2, "flush 已取消防抖定时器，不会再写第二次");
  } finally {
    mock.timers.reset();
  }
});

test("换键丢弃上一个 vault 的待写内容（键已经换了，写不成旧的）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.activePath = "a.md";
    await load(rig, "vault-a");
    rig.view = position(500);
    rig.store.scrolled(); // 待写，窗口未到

    await load(rig, "vault-b");
    mock.timers.tick(READING_POSITION_DEBOUNCE_MS * 2);
    await flush();
    assert.equal(
      rig.writes.some((w) => w.vaultId === "vault-a" && w.entries["a.md"] !== undefined),
      false,
      "旧 vault 的待写内容不落到任何一次落盘里（它由切换前的 flush 负责）",
    );
  } finally {
    mock.timers.reset();
  }
});

test("前台是未命名文档（没有路径）或视口不可读时不记录", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    await load(rig, "vault-a");
    rig.activePath = undefined; // 未命名文档
    rig.view = position(700);
    rig.store.scrolled();
    rig.activePath = "a.md";
    rig.view = null; // 锚处不可读
    rig.store.scrolled();
    mock.timers.tick(READING_POSITION_DEBOUNCE_MS * 2);
    await flush();
    assert.equal(rig.writes.length, 0);
  } finally {
    mock.timers.reset();
  }
});

// ---------------------------------------------------------------------------
// 清理与上限（挂在装载那一次枚举上）
// ---------------------------------------------------------------------------

test("装载后按本次枚举清理：越界键与已移除路径不进入镜像，也不进入下一次落盘", async () => {
  const rig = createRig();
  rig.activePath = "a.md";
  rig.files["vault-a"] = file({
    "a.md": at(10),
    "docs/c.md": at(20),
    "/etc/passwd": at(30),
    "../outside.md": at(40),
    "gone.md": at(50),
  });
  await load(rig, "vault-a", [fileEntry("a.md"), fileEntry("docs/c.md")]);

  await rig.store.flush();
  assert.deepEqual(Object.keys(rig.writes[0].entries).sort(), ["a.md", "docs/c.md"]);
});

test("打不开的键只跳过不删：在枚举里就留着（权限一类的原因是临时的）", async () => {
  const rig = createRig();
  rig.activePath = "a.md";
  rig.files["vault-a"] = file({ "denied.md": at(10) });
  await load(rig, "vault-a", [fileEntry("a.md"), fileEntry("denied.md")]);
  await rig.store.flush();
  assert.notEqual(rig.writes[0].entries["denied.md"], undefined);
});

test("写入侧也守上限：201 条经一次落盘只剩 200 条且最旧的不在", async () => {
  const rig = createRig();
  rig.activePath = "a.md";
  const existing: Record<string, ReadingPositionEntry> = {};
  for (let i = 0; i <= READING_POSITION_MAX_ENTRIES; i += 1) {
    existing[`f${String(i).padStart(3, "0")}.md`] = at(i, 48, 0, i);
  }
  rig.files["vault-a"] = file(existing);
  await load(rig, "vault-a", Object.keys(existing).map((key) => fileEntry(key)));
  await rig.store.flush();
  const written = rig.writes[0].entries;
  assert.equal(Object.keys(written).length, READING_POSITION_MAX_ENTRIES);
  assert.equal(written["f000.md"], undefined);
  assert.notEqual(written["f200.md"], undefined);
});

// ---------------------------------------------------------------------------
// 恢复
// ---------------------------------------------------------------------------

test("恢复只在装载路径上施加，且只对**前台**文档施加（不是前台就不拽走读者）", async () => {
  const rig = createRig();
  rig.files["vault-a"] = file({ "a.md": at(3210, 48, 7) });
  rig.activePath = "a.md";
  await load(rig, "vault-a", [fileEntry("a.md"), fileEntry("b.md")]);

  rig.activePath = "b.md"; // 装载是异步的，期间用户可能已经切走
  rig.store.restoreFor("a.md");
  assert.deepEqual(rig.applied, [], "不是前台文档：不施加");

  rig.activePath = "a.md";
  rig.store.restoreFor("a.md");
  assert.deepEqual(rig.applied, [position(3210, 48, 7)]);

  rig.store.restoreFor("b.md"); // 没有历史
  assert.equal(rig.applied.length, 1, "没有历史：从篇首开始，不施加也不提示");
});

test("降级四种：读不到 / 无历史 / 版本不符（后端已归成 null）/ 写失败", async () => {
  const rig = createRig();
  rig.activePath = "a.md";
  // ① 读抛错 → 等价于没有历史：不恢复、不拦停装载
  rig.failRead = true;
  await load(rig, "vault-a");
  rig.store.restoreFor("a.md");
  assert.deepEqual(rig.applied, []);
  assert.deepEqual(rig.warns, [], "读不到不打扰用户（只影响「从上次位置继续」这一件事）");

  // ② 后端把损坏 / 版本不符都归成 null：同样等价于没有历史
  rig.failRead = false;
  rig.files["vault-a"] = null;
  await load(rig, "vault-a");
  rig.store.restoreFor("a.md");
  assert.deepEqual(rig.applied, []);

  // ③ 写失败只记一条 warning，不抛出、不拦停
  rig.failWrite = true;
  await rig.store.flush();
  assert.deepEqual(rig.warns, ["磁盘只读"]);
  assert.equal(rig.writes.length, 0);

  // ④ 未装载 vault 时恢复是 no-op（启动早期）
  const fresh = createRig();
  fresh.store.restoreFor("a.md");
  assert.deepEqual(fresh.applied, []);
});

test("装载途中又装载一次 vault：前一次读回的位置绝不许落到新 vault 的镜像里", async () => {
  const rig = createRig();
  rig.activePath = "a.md";
  const slow = new Promise<void>((resolve) => void setImmediate(() => resolve()));
  rig.files["vault-a"] = file({ "a.md": at(111) });
  rig.files["vault-b"] = file({ "b.md": at(222) });

  // 第一次装载的读盘还没回来就切到 vault-b
  const first = rig.store.onVaultLoaded("vault-a", [fileEntry("a.md")]);
  const second = rig.store.onVaultLoaded("vault-b", [fileEntry("b.md")]);
  await slow;
  await first;
  await second;
  await flush();

  rig.activePath = "a.md";
  rig.store.restoreFor("a.md");
  assert.deepEqual(rig.applied, [], "vault-a 的迟到结果被丢弃");
  rig.activePath = "b.md";
  rig.store.restoreFor("b.md");
  assert.deepEqual(rig.applied, [position(222)]);
});
