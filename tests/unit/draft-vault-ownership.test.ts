// 草稿归属的确定性回归（M848，finding
// `20261119-worker-persistence-faults-bug-vault-scope-vault-vault`）：草稿 store 在 `load`
// 时绑定 vault 稳定 id，之后每次读 / 写 / 清除都带 id 下发——落点不再取决于「后端执行写入时
// 的当前 vault scope」。
//
// 每条用例都在**同一条时间线**上把交错摆出来：写 / 读在途 → 切 vault → 放行旧操作。判据是
// 假后端记录到的 `(vaultId, payload)` 与各 vault 盘上的最终内容——旧写只许落旧 vault、旧读
// 只许返回旧 vault 的内容、旧失败不得回填新 vault 的 pending / written 基准。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHarnessDraftStore } from "../../src/harness-draft.ts";
import { serializeComposerDraft } from "../../src/quote-card.ts";

/** 让 await 链跑完（不用 mock timers：本层全部用显式 `flush()`，少一层时序变量）。 */
const flushAwait = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

type VaultId = string | null;

interface PutCall {
  vaultId: VaultId;
  draftJson: string;
}

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 假后端：按显式 vault id 分文件（与 Rust 侧「只按传入 id 解析落点」同口径）。 */
function createRig() {
  const rig = {
    /** 每个 vault 盘上的草稿原文（null / 缺失 = 没有草稿）。 */
    files: new Map<VaultId, string | null>(),
    /** 每次实际落盘的调用（按发生次序）。 */
    writes: [] as PutCall[],
    /** 每次读盘收到的归属 id（按发生次序）。 */
    reads: [] as VaultId[],
    warns: [] as unknown[],
    failWrite: false,
    /** 一次性的在途闸：按内容挂住某次写、按 vault id 挂住某次读。 */
    holdPut: new Map<string, Gate>(),
    holdGet: new Map<VaultId, Gate>(),
  };
  const store = createHarnessDraftStore({
    getDraft: async (vaultId) => {
      rig.reads.push(vaultId);
      const held = rig.holdGet.get(vaultId);
      if (held !== undefined) {
        rig.holdGet.delete(vaultId);
        await held.promise;
      }
      return rig.files.get(vaultId) ?? null;
    },
    putDraft: async (draftJson, vaultId) => {
      const held = rig.holdPut.get(draftJson);
      if (held !== undefined) {
        rig.holdPut.delete(draftJson);
        await held.promise;
      }
      if (rig.failWrite) throw { code: "harness_draft_write_failed", message: "磁盘只读" };
      rig.writes.push({ vaultId, draftJson });
      // 与 Rust 侧同口径：null 归属静默 no-op（不落任何文件）；空载荷 = 删文件。
      if (vaultId === null) return;
      rig.files.set(vaultId, draftJson === "" ? null : draftJson);
    },
    warn: (e) => void rig.warns.push(e),
    debounceMs: 1000,
  });
  return { store, rig };
}

function holdPut(rig: ReturnType<typeof createRig>["rig"], draftJson: string): Gate {
  const g = gate();
  rig.holdPut.set(draftJson, g);
  return g;
}

function holdGet(rig: ReturnType<typeof createRig>["rig"], vaultId: VaultId): Gate {
  const g = gate();
  rig.holdGet.set(vaultId, g);
  return g;
}

const A = serializeComposerDraft("vault-a 的字", 3, []);
const A_LATE = serializeComposerDraft("vault-a 迟到的字", 5, []);
const B = serializeComposerDraft("vault-b 的字", null, []);
const B2 = serializeComposerDraft("vault-b 改过", 1, []);

test("同 vault 正常读写：读带归属 id，写带归属 id，无变更不重复写", async () => {
  const { store, rig } = createRig();
  rig.files.set("vault-a", A);

  assert.deepEqual(await store.load("vault-a"), { text: "vault-a 的字", caret: 3, cards: [] });
  assert.deepEqual(rig.reads, ["vault-a"], "读盘携带装载时绑定的 id");

  store.schedule("vault-a 的字", 3, []);
  await store.flush();
  assert.deepEqual(rig.writes, [], "读回的内容就是基准，未编辑不写");

  store.schedule("vault-b 的字", 2, []);
  await store.flush();
  assert.deepEqual(rig.writes, [{ vaultId: "vault-a", draftJson: serializeComposerDraft("vault-b 的字", 2, []) }]);
  assert.equal(rig.files.get("vault-a"), serializeComposerDraft("vault-b 的字", 2, []));
});

test("旧 vault 的写晚于切 vault：只落旧 vault，新 vault 的草稿逐字节不变", async () => {
  const { store, rig } = createRig();
  await store.load("vault-a");
  store.schedule("vault-a 的字", 3, []);
  const inFlight = holdPut(rig, A);
  const flushing = store.flush(); // 出发：vault-a
  await flushAwait();
  assert.deepEqual(rig.writes, [], "写在途（尚未落盘）");

  // 切到 vault-b：装载 b 的草稿（b 盘上已有一份）。
  rig.files.set("vault-b", B);
  assert.deepEqual(await store.load("vault-b"), { text: "vault-b 的字", caret: null, cards: [] });

  inFlight.release(); // 旧写在切换之后才执行
  await flushing;
  await flushAwait();

  assert.deepEqual(rig.writes, [{ vaultId: "vault-a", draftJson: A }], "迟到写只落出发时的 vault");
  assert.equal(rig.files.get("vault-a"), A, "旧 vault 的草稿保住");
  assert.equal(rig.files.get("vault-b"), B, "新 vault 不被旧写串台");

  // 新 vault 的后续编辑照常写 b。
  store.schedule("vault-b 改过", 1, []);
  await store.flush();
  assert.deepEqual(rig.writes[1], { vaultId: "vault-b", draftJson: B2 });
  assert.equal(rig.files.get("vault-b"), B2);
});

test("旧 vault 的读晚到：结果作废，新 vault 的 written 基准与盘上内容不受影响", async () => {
  const { store, rig } = createRig();
  rig.files.set("vault-a", A);
  const inFlight = holdGet(rig, "vault-a");
  const stale = store.load("vault-a"); // 出发：vault-a，读被挂住
  await flushAwait();

  // 切到 vault-b，b 的读先完成。
  rig.files.set("vault-b", B);
  assert.deepEqual(await store.load("vault-b"), { text: "vault-b 的字", caret: null, cards: [] });

  inFlight.release();
  assert.equal(await stale, null, "晚到的旧读整体作废（不返回内容、不覆盖新基准）");
  assert.deepEqual(rig.reads, ["vault-a", "vault-b"], "两次读各带各的归属 id");

  // b 的「无变更不写」基准是 b 的盘上内容：旧读晚到没有把它顶掉。
  store.schedule("vault-b 的字", null, []);
  await store.flush();
  assert.deepEqual(rig.writes, [], "b 未编辑，不写盘");
  assert.equal(rig.files.get("vault-b"), B);
});

test("写失败重试：重试仍打出发时的归属 id，成功后才更新该 vault", async () => {
  const { store, rig } = createRig();
  await store.load("vault-a");
  rig.failWrite = true;
  store.schedule("vault-a 的字", 3, []);
  await store.flush();
  assert.equal(rig.warns.length, 1, "失败降级为一条 warning");
  assert.deepEqual(rig.writes, [], "失败没有落盘");

  rig.failWrite = false;
  await store.flush(); // 失败内容留在待写，重试
  assert.deepEqual(rig.writes, [{ vaultId: "vault-a", draftJson: A }], "重试写同一份内容、同一个归属");
  assert.equal(rig.files.get("vault-a"), A);
});

test("旧 vault 的写晚到且失败：不得回填新 vault 的待写或污染 written 基准", async () => {
  const { store, rig } = createRig();
  await store.load("vault-a");
  store.schedule("vault-a 的字", 3, []);
  const inFlight = holdPut(rig, A);
  rig.failWrite = true;
  const flushing = store.flush(); // 出发：vault-a，在途且注定失败
  await flushAwait();

  rig.files.set("vault-b", B);
  await store.load("vault-b"); // 切换先到
  inFlight.release();
  await flushing;
  await flushAwait();
  assert.equal(rig.warns.length, 1, "旧写失败照常降级");
  assert.deepEqual(rig.writes, [], "旧写没有落盘");

  // 关键：撤掉失败注入再 flush——若旧失败把内容回填成了 b 的待写，这一拍就会真的写出 a 的字。
  rig.failWrite = false;
  await store.flush();
  assert.deepEqual(rig.writes, [], "b 没有多出一份旧内容");

  // b 的「无变更不写」基准完好：b 未编辑时 schedule 同内容不落盘。
  store.schedule("vault-b 的字", null, []);
  await store.flush();
  assert.deepEqual(rig.writes, []);
  assert.equal(rig.files.get("vault-b"), B);
});

test("切换装载直接丢弃旧 vault 的待写：不会把旧内容记到新 vault 名下", async () => {
  const { store, rig } = createRig();
  await store.load("vault-a");
  store.schedule("vault-a 的字", 3, []); // 待写尚未 flush
  rig.files.set("vault-b", B);
  await store.load("vault-b"); // 切 vault
  await store.flush();
  assert.deepEqual(rig.writes, [], "旧待写已随装载丢弃（它应由切换前的 flush 写走）");
  assert.equal(rig.files.get("vault-b"), B);
});

test("清除按归属：只删自己那份，切 vault 后清的是新 vault 的草稿", async () => {
  const { store, rig } = createRig();
  await store.load("vault-a");
  store.schedule("vault-a 的字", 3, []);
  await store.flush();
  await store.clear();
  assert.deepEqual(rig.writes[1], { vaultId: "vault-a", draftJson: "" }, "清除 = 空载荷 + 归属 id");
  assert.equal(rig.files.get("vault-a"), null, "a 的草稿被删");

  rig.files.set("vault-b", B);
  await store.load("vault-b");
  await store.clear();
  assert.deepEqual(rig.writes[2], { vaultId: "vault-b", draftJson: "" });
  assert.equal(rig.files.get("vault-b"), null);
});

test("v1 迁移写回携带归属 id（迁移也是一条写路径）", async () => {
  const { store, rig } = createRig();
  rig.files.set(
    "vault-a",
    JSON.stringify({ version: 1, blocks: [{ kind: "paragraph", text: "legacy" }], caret: { block: 0, offset: 2 } }),
  );
  assert.deepEqual(await store.load("vault-a"), { text: "legacy", caret: 2, cards: [] });
  assert.deepEqual(rig.writes, [{ vaultId: "vault-a", draftJson: serializeComposerDraft("legacy", 2, []) }]);
});

test("无 vault（null）：读写都带 null 归属，不落任何 vault 的文件", async () => {
  const { store, rig } = createRig();
  assert.equal(await store.load(null), null);
  assert.deepEqual(rig.reads, [null]);

  store.schedule("无主的字", null, []);
  await store.flush();
  assert.deepEqual(rig.writes, [{ vaultId: null, draftJson: serializeComposerDraft("无主的字", null, []) }]);
  assert.equal(rig.files.size, 0, "null 归属不产生任何 vault 的草稿文件（后端静默 no-op 的同口径）");
});
