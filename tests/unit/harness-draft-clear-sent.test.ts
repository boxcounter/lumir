// 成功回执的草稿归属（reviewer 新阻断）：`editVersion()` / `clearSent(vaultId, version)` 的
// 纯 store 合同——零 DOM、按 vault 分文件（真后端按 `vault_id` 解析落点，单文件桩会把两个
// vault 混成一份）。
//
// 现场与判据：
//   - 同 vault + 发送后**没有**新编辑 ⇒ 清（沿用 `clear`：取消待写、written 归空、串行删除）；
//   - 同 vault + 发送后**已有**新编辑（回执迟到，用户继续打字 / 贴卡 / 只动 caret）⇒ 保留
//     pending / written / 盘上文件——版本判据，MUST NOT 用文本比较（可能重打相同的字）；
//   - 目标 vault 不是当前 bound（发送后切了 vault）⇒ 不动当前 store 状态，只把空值删除按
//     **显式原 vaultId** 排进同一条串行链（切回旧 vault 不复活已发送内容）；
//   - 删除失败只降级（warn），不把发送路径的 promise 变成 reject。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { createHarnessDraftStore } from "../../src/harness-draft.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";
import { serializeComposerDraft } from "../../src/quote-card.ts";

const MSG = "发送前的问题";
const MSG2 = "回执迟到期间的新输入";
const CARDS: ComposerAttachment[] = [{
  kind: "quote",
  card: { file: "synth.md", heading: "H", headingPath: "H", lines: "1-1", text: "摘录" },
}];

interface Call {
  vaultId: string | null;
  draftJson: string;
}

/** 让 await 链跑完（mock timers 只接管 setTimeout）。 */
const flushAwait = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

const keyOf = (vaultId: string | null): string => vaultId ?? "<none>";

function createRig() {
  const files = new Map<string, string>();
  const calls: Call[] = [];
  const warns: unknown[] = [];
  let failWrite = false;
  let putGate: ((vaultId: string | null, draftJson: string) => Promise<void> | undefined) | undefined;
  const rig = {
    files,
    calls,
    warns,
    get failWrite() {
      return failWrite;
    },
    set failWrite(value: boolean) {
      failWrite = value;
    },
    get putGate() {
      return putGate;
    },
    set putGate(value: typeof putGate) {
      putGate = value;
    },
  };
  const store = createHarnessDraftStore({
    getDraft: async (vaultId) => files.get(keyOf(vaultId)) ?? null,
    putDraft: async (draftJson, vaultId) => {
      const gate = putGate?.(vaultId, draftJson);
      if (gate !== undefined) await gate;
      if (failWrite) throw { code: "harness_draft_write_failed", message: "磁盘只读" };
      calls.push({ vaultId, draftJson });
      if (draftJson === "") files.delete(keyOf(vaultId));
      else files.set(keyOf(vaultId), draftJson);
    },
    warn: (e) => void warns.push(e),
    debounceMs: 1000,
  });
  return { store, rig };
}

test("editVersion：按 vault 分开计数（同内容 / 只动 caret 也递增）；装载不伪造编辑", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store } = createRig();
    const v0 = store.editVersion(); // bound = null
    store.schedule(MSG, null, CARDS);
    const v1 = store.editVersion();
    assert.ok(v1 > v0, "编辑递增版本");
    store.schedule(MSG, null, CARDS); // 序列化结果与上次相同
    assert.ok(store.editVersion() > v1, "同内容重打也算一次编辑（版本不靠文本比较）");

    await store.load("A");
    assert.equal(store.editVersion(), 0, "切到 A：A 自己的版本从 0 起（不继承 null 的计数）");
    store.schedule(MSG, 1, CARDS);
    const a1 = store.editVersion();
    assert.equal(a1, 1);

    await store.load("B");
    assert.equal(store.editVersion(), 0, "别的 vault 的编辑不推进 B 的版本");
    store.schedule(MSG2, null, CARDS);
    assert.equal(store.editVersion(), 1);

    await store.load("A");
    assert.equal(store.editVersion(), a1, "切回 A：A 的版本原样（B 的编辑不算 A 的编辑）");
  } finally {
    mock.timers.reset();
  }
});

test("clearSent：同 vault 且版本未变 ⇒ 清（取消待写、空载荷删除）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    const version = store.editVersion();
    await store.clearSent("A", version);
    assert.deepEqual(rig.calls, [{ vaultId: "A", draftJson: "" }]);
    assert.equal(rig.files.get("A"), undefined);
    await store.flush();
    assert.equal(rig.calls.length, 1, "待写被取消：flush 不再写出旧内容");
  } finally {
    mock.timers.reset();
  }
});

test("clearSent：同 vault 但版本已变 ⇒ 保留文件 / 待写，flush 仍写新内容", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush(); // 发送前的草稿在盘上
    const sent = serializeComposerDraft(MSG, null, CARDS);
    assert.equal(rig.files.get("A"), sent);

    const version = store.editVersion();
    store.schedule(MSG2, 1, CARDS); // 回执迟到期间的新编辑

    await store.clearSent("A", version);
    assert.deepEqual(rig.calls, [{ vaultId: "A", draftJson: sent }], "没有删除 / 空载荷");
    assert.equal(rig.files.get("A"), sent, "盘上那份草稿保留");

    await store.flush();
    assert.equal(rig.files.get("A"), serializeComposerDraft(MSG2, 1, CARDS), "新输入照常落盘");
  } finally {
    mock.timers.reset();
  }
});

test("clearSent：目标 vault 不是当前 bound ⇒ 按显式原 vaultId 删除，不动当前待写", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush(); // A 的草稿在盘上
    const version = store.editVersion();

    await store.load("B"); // 发送后切到 B
    store.schedule(MSG2, 1, CARDS); // B 的待写

    await store.clearSent("A", version);
    assert.deepEqual(rig.calls.at(-1), { vaultId: "A", draftJson: "" }, "删除按显式原 vaultId 落点");
    assert.equal(rig.files.get("A"), undefined);
    assert.equal(rig.files.get("B"), undefined, "B 的待写没有被顺手写盘");

    await store.flush();
    assert.equal(rig.files.get("B"), serializeComposerDraft(MSG2, 1, CARDS), "B 的待写仍可正常 flush");
  } finally {
    mock.timers.reset();
  }
});

test("clearSent：切走再切回、期间未编辑 ⇒ 同 vault 版本未变，照常清（切回不复活）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush();
    const version = store.editVersion();
    await store.load("B");
    await store.load("A"); // 切回，未编辑（load 不递增版本）
    await store.clearSent("A", version);
    assert.deepEqual(rig.calls.at(-1), { vaultId: "A", draftJson: "" });
    assert.equal(rig.files.get("A"), undefined);
  } finally {
    mock.timers.reset();
  }
});

test("跨 vault 删除与当前 vault 的写在同一条串行链上：先写后删（次序确定）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    const gate: { release: (() => void) | undefined } = { release: undefined };
    rig.putGate = (vaultId, draftJson) =>
      vaultId === "B" && draftJson !== ""
        ? new Promise<void>((resolve) => void (gate.release = resolve))
        : undefined;

    await store.load("B");
    store.schedule(MSG2, null, CARDS);
    const flushing = store.flush(); // B 的写在途
    await flushAwait();
    assert.ok(gate.release !== undefined, "B 的写确实在途");

    const clearing = store.clearSent("A", 0); // 目标不是 bound：删除入链
    await flushAwait();
    assert.deepEqual(rig.calls, [], "B 在途期间 A 的删除排在链上，尚未执行");

    gate.release!();
    await flushing;
    await clearing;
    assert.deepEqual(
      rig.calls.map((call) => [call.vaultId, call.draftJson === ""]),
      [["B", false], ["A", true]],
      "次序：当前 vault 的写在先、旧 vault 的删除在后",
    );
  } finally {
    mock.timers.reset();
  }
});

test("跨 vault 删除失败只降级：warn 一次，不 reject 发送路径", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("B");
    rig.failWrite = true;
    await store.clearSent("A", 0); // 不应抛
    assert.equal(rig.warns.length, 1);
    assert.deepEqual(rig.calls, []);
  } finally {
    mock.timers.reset();
  }
});

test("clearSent：目标 vault 在发送后有编辑（人已切走）⇒ 跨 vault 也跳过，保留那份草稿", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush(); // 发送前的草稿在盘上
    const version = store.editVersion();

    store.schedule(MSG2, 2, CARDS); // 发送后在**原 vault** 继续编辑
    await store.flush(); // 切走前的 flush：A 的新草稿落盘
    const edited = serializeComposerDraft(MSG2, 2, CARDS);
    assert.equal(rig.files.get("A"), edited);

    await store.load("C"); // 切到第三个 vault（当前 bound 不是 A）
    await store.clearSent("A", version); // A 的版本已变 ⇒ 跨越 bound 也必须跳过

    assert.equal(rig.files.get("A"), edited, "A 发送后的新编辑不被旧回执删除");
    assert.equal(
      rig.calls.filter((call) => call.vaultId === "A" && call.draftJson === "").length,
      0,
      "没有发出对 A 的空值删除",
    );
  } finally {
    mock.timers.reset();
  }
});

test("clearSent：其他 vault 的编辑不推进发送 vault 的版本（切回后仍正常清）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush();
    const version = store.editVersion();

    await store.load("B");
    store.schedule(MSG2, null, CARDS); // 只推进 B 的版本
    await store.flush();
    await store.load("A"); // 切回 A，未编辑

    await store.clearSent("A", version);
    assert.deepEqual(rig.calls.at(-1), { vaultId: "A", draftJson: "" }, "A 的已发送草稿正常清");
    assert.equal(rig.files.get("A"), undefined);
    assert.equal(rig.files.get("B"), serializeComposerDraft(MSG2, null, CARDS), "B 的草稿不受影响");
  } finally {
    mock.timers.reset();
  }
});

// ── 两阶段防护（reviewer 第四轮）：跨 bound 删除的排队 / 在途窗口 ─────────────────────
//
// 反例：A 的删除已入串行链**排队**（还没执行）→ 切回 A 重打相同内容（版本增，但序列化结果
// 等于 written ⇒ 不排期、不写）→ 旧删除照发 ⇒ 文件被删、flush 又无待写可补。只在入队前比
// 版本不够（排队期间会变），只在执行前比也不够（IPC 已发出后无法撤回）——因此：
//   ① 删除真正执行**前**再比目标 vault 版本，变了就不发送删除；
//   ② 删除 IPC 已在途时，用该 vault 的 latestDraft 在链尾补写（不看 written 的相等判定）。
test("删除排队未执行时重打相同内容：执行前复检跳过删除，文件与 flush 都不丢", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush(); // A 的已发送内容在盘上
    const sent = serializeComposerDraft(MSG, null, CARDS);
    assert.equal(rig.files.get("A"), sent);
    const version = store.editVersion();

    // 占住串行链：B 的写在途 ⇒ A 的删除只能排队（尚未执行）。
    const gate: { release: (() => void) | undefined } = { release: undefined };
    rig.putGate = (vaultId, draftJson) =>
      vaultId === "B" && draftJson !== ""
        ? new Promise<void>((resolve) => void (gate.release = resolve))
        : undefined;
    await store.load("B");
    store.schedule(MSG, 1, CARDS);
    const flushingB = store.flush();
    await flushAwait();
    assert.ok(gate.release !== undefined, "B 的写确实在途（链被占住）");

    const clearing = store.clearSent("A", version); // 入队，未执行
    await flushAwait();

    // 排队期间切回 A，重打**相同内容**：版本前进，但序列化结果等于 written ⇒ 不排期。
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    assert.ok(store.editVersion() > version, "版本已前进（重打相同内容）");

    gate.release!();
    await flushingB;
    await clearing;
    await store.flush(); // 没有待写：flush 本身不会补（修前丢字正是这个形态）

    assert.equal(
      rig.calls.filter((call) => call.vaultId === "A" && call.draftJson === "").length,
      0,
      "执行前复检：删除未发送",
    );
    assert.equal(rig.files.get("A"), sent, "盘上那份仍在");
    assert.equal(rig.files.get("B"), serializeComposerDraft(MSG, 1, CARDS));
  } finally {
    mock.timers.reset();
  }
});

test("删除 IPC 已开始并阻塞：期间编辑不同内容 ⇒ 删除落定后链尾自动补写最新内容", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush();
    const version = store.editVersion();

    await store.load("B"); // 切走
    const gate: { release: (() => void) | undefined } = { release: undefined };
    rig.putGate = (vaultId, draftJson) =>
      vaultId === "A" && draftJson === ""
        ? new Promise<void>((resolve) => void (gate.release = resolve))
        : undefined;
    const clearing = store.clearSent("A", version);
    await flushAwait();
    assert.ok(gate.release !== undefined, "删除 IPC 已开始并阻塞");

    // 删除在途期间切回 A 并编辑（不同内容 + caret）。防抖被 mock 住：没有 repair 就不会落盘。
    await store.load("A");
    store.schedule(MSG2, 2, CARDS);
    const repaired = serializeComposerDraft(MSG2, 2, CARDS);

    gate.release!();
    await clearing;

    assert.equal(rig.files.get("A"), repaired, "删除落定后链尾补写最新内容");
    assert.deepEqual(
      rig.calls.map((call) => (call.draftJson === "" ? "delete" : call.draftJson)),
      [serializeComposerDraft(MSG, null, CARDS), "delete", repaired],
      "次序：删除在前、补写在后",
    );
    // written 与盘一致：同内容重打不再排期写盘。
    store.schedule(MSG2, 2, CARDS);
    await store.flush();
    assert.equal(rig.calls.length, 3, "补写后 written 已同步，同内容重打不重复写");
  } finally {
    mock.timers.reset();
  }
});

test("删除 IPC 已开始并阻塞：期间重打相同内容（无新写）⇒ 链尾补写也必须救回", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { store, rig } = createRig();
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    await store.flush();
    const sent = serializeComposerDraft(MSG, null, CARDS);
    const version = store.editVersion();

    await store.load("B"); // 切走
    const gate: { release: (() => void) | undefined } = { release: undefined };
    rig.putGate = (vaultId, draftJson) =>
      vaultId === "A" && draftJson === ""
        ? new Promise<void>((resolve) => void (gate.release = resolve))
        : undefined;
    const clearing = store.clearSent("A", version);
    await flushAwait();
    assert.ok(gate.release !== undefined, "删除 IPC 已开始并阻塞");

    // 删除在途期间切回 A，重打相同内容：序列化结果等于 written ⇒ 不排期、没有 pending。
    await store.load("A");
    store.schedule(MSG, null, CARDS);
    assert.equal(rig.calls.length, 1, "重打相同内容没有排期写入（只有最初那份）");

    gate.release!();
    await clearing;

    assert.equal(rig.files.get("A"), sent, "相同内容也必须补写（不因 draftJson === written 跳过）");
    assert.deepEqual(
      rig.calls.map((call) => (call.draftJson === "" ? "delete" : call.draftJson)),
      [sent, "delete", sent],
      "次序：删除在前、补写在后",
    );
    store.schedule(MSG, null, CARDS);
    await store.flush();
    assert.equal(rig.calls.length, 3, "补写后 written 已同步，同内容重打不再写");
  } finally {
    mock.timers.reset();
  }
});
