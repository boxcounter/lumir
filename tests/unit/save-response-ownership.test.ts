// src/save-controller.ts 的**保存应答归属**回归（M847）。
//
// 缺陷现场（M844 的确定性交错，finding `20261119-worker-persistence-faults-bug-vault-cas`）：
// 保存应答晚于「放弃修改并切换 vault + 在新 vault 打开同名相对路径」时，旧 vault 的 revision
// 被写进 `revisions[path]`，覆盖新文档打开时登记的 CAS 基准——下一次 ⌘S 变成假冲突；迟到的
// 失败提示（冲突 / 已被外部删除）同样会挂到新文档上。同族路径还有同路径重新打开与 app 内改名。
//
// 判据（与 `openspec/changes/fix-save-response-ownership-nov19` 的 delta 逐条对应）：
//   I1 保存应答只对发起时的**装载世代**生效：vault 复位 / noteOpened / noteRenamed 之后，
//      旧应答整体丢弃——不写 revision、不清 dirty、不弹提示。
//   I2 旧应答的 finally 只撤自己的在途 token，不撤同一路径上新保存的标记。
//   I3 正常保存不倒退：没有失效事件时成功 / 冲突 / 强制覆盖的行为与文案不变。
//   I4 失效是**路径级**的：开一个新标签不让其他标签的在途保存作废（MUST NOT 用全局世代号）。
//
// 交错全部用可控 deferred 应答构造（Node 层，无真机、无真实磁盘）。每个失败判据都配了
// 「旧实现下必须判红 / 新实现下判绿」的观察点：旧 revision 若写进基准，会在下一次保存的
// `expected_revision` 上露出来；旧 finally 若误删 token，会在「再按一次 ⌘S 是否发起第三次
// 写入」上露出来。

import { test } from "node:test";
import assert from "node:assert/strict";
import { commandError, createRig } from "./harness.ts";
import type { Rig } from "./harness.ts";

/** 让 await 链跑完（与 save-controller.test.ts 同口径，多留两轮给链路里的多次 await）。 */
const flush = async (rounds = 4) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** 收尾：清掉崩溃备份排期的定时器（否则测试结束后它还会跑一次真的备份写入）。 */
const stopTimers = (rig: Rig) => rig.controller.noteVaultReset();

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 把 `document_save` 换成「调用即入队、应答由测试逐个放行」的通道；返回每次调用的闸门。 */
function deferredSaves(rig: Rig): Array<Deferred<string>> {
  const gates: Array<Deferred<string>> = [];
  rig.backend.handle("document_save", () => {
    const gate = deferred<string>();
    gates.push(gate);
    return gate.promise;
  });
  return gates;
}

/** 打开一份已登记 CAS 基准的 dirty 文档。 */
function openDirty(rig: Rig, path: string, content: string, revision: string): void {
  rig.editor.open(path, content);
  rig.controller.noteOpened(path, revision);
  rig.editor.edit(path, `${content} 改`);
}

/** 放弃修改并切换 vault 后，在新 vault 打开同名路径（M844 的缺陷交错的第二步）。 */
function reopenInFreshVault(rig: Rig, path: string, content: string, revision: string): void {
  rig.controller.noteVaultReset();
  rig.editor.close(path);
  rig.editor.open(path, content);
  rig.controller.noteOpened(path, revision);
  rig.editor.edit(path, `${content} 改`);
}

test("同名跨 vault：迟到的成功应答不覆盖新文档的 CAS 基准（旧 revision 不写进新键）", async () => {
  const rig = createRig();
  const gates = deferredSaves(rig);
  openDirty(rig, "README.md", "# A", "rev-a0");

  const stale = rig.controller.save();
  assert.equal(rig.backend.countOf("document_save"), 1);
  assert.equal(rig.backend.argsOf("document_save")[0].expected_revision, "rev-a0");

  // 应答在途期间：放弃修改并切换 vault，新 vault 打开同名文档。
  reopenInFreshVault(rig, "README.md", "# B", "rev-b0");
  rig.backend.reset();

  gates[0].resolve("rev-a-saved");
  await stale;
  await flush();

  assert.equal(rig.toasts.live().length, 0, "旧应答不得弹任何提示（既不是成功也不是失败）");
  assert.equal(rig.editor.handle.sessionForPath("README.md")!.dirty, true, "新文档的 dirty 不得被旧应答清掉");
  assert.equal(rig.backend.countOf("recovery_discard"), 0, "旧应答不得清新文档的崩溃备份");

  // 旧 revision 若被写进基准，会在这里以 `expected_revision` 的形态露出来。
  rig.backend.handle("document_save", () => "rev-b1");
  await rig.controller.save();
  const fresh = rig.backend.argsOf("document_save").at(-1)!;
  assert.equal(fresh.expected_revision, "rev-b0", "下一次保存必须用新 vault 登记的基准");
  assert.equal(rig.editor.handle.sessionForPath("README.md")!.dirty, false, "新文档自己的保存照常闭环");
  assert.ok(rig.toasts.texts().includes("已保存"));
  stopTimers(rig);
});

test("同名跨 vault：迟到的冲突提示不串到新文档上", async () => {
  const rig = createRig();
  const gates = deferredSaves(rig);
  openDirty(rig, "README.md", "# A", "rev-a0");

  const stale = rig.controller.save();
  reopenInFreshVault(rig, "README.md", "# B", "rev-b0");
  rig.backend.reset();

  gates[0].reject(commandError("document_conflict", "旧 vault 的磁盘版本更新"));
  await stale;
  await flush();

  assert.equal(rig.toasts.live().length, 0, "迟到的冲突提示不得挂到新文档上（sticky 提示会锁住去留）");
  assert.equal(rig.editor.handle.sessionForPath("README.md")!.dirty, true);

  // 新文档自己的冲突处置不受影响（判据没有把合法失败一并吞掉）。
  rig.backend.handle("document_save", () => {
    throw commandError("document_conflict", "新文档也冲突");
  });
  await rig.controller.save();
  const prompt = rig.toasts.live().at(-1)!;
  assert.equal(prompt.sticky, true);
  assert.deepEqual(prompt.actions.map((action) => action.label), ["重新载入（放弃我的修改）", "强制覆盖保存"]);
  assert.match(prompt.text, /保存冲突/);
  stopTimers(rig);
});

test("同路径重开（不换 vault）：noteOpened 之后旧成功应答整体丢弃", async () => {
  const rig = createRig();
  const gates = deferredSaves(rig);
  openDirty(rig, "a.md", "# A", "rev-1");

  const stale = rig.controller.save();
  // 用户重新打开同一路径：读快照成功并登记新基准（vault 未变，只是同一路径的文档换代）。
  rig.controller.noteOpened("a.md", "rev-reopened");
  rig.backend.reset();

  gates[0].resolve("rev-old-saved");
  await stale;
  await flush();

  assert.equal(rig.toasts.live().length, 0, "旧应答不得弹提示");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true);

  rig.backend.handle("document_save", () => "rev-2");
  await rig.controller.save();
  assert.equal(
    rig.backend.argsOf("document_save").at(-1)!.expected_revision,
    "rev-reopened",
    "旧 revision 不得覆盖重新登记后的基准",
  );
  stopTimers(rig);
});

test("app 内改名：旧成功应答不得写到旧路径的新文档，新键仍用迁移过来的基准", async () => {
  const rig = createRig();
  const gates = deferredSaves(rig);
  openDirty(rig, "a.md", "# A", "rev-1");

  const stale = rig.controller.save();
  rig.editor.rename("a.md", "b.md");
  rig.controller.noteRenamed("a.md", "b.md");
  // 改名之后旧路径又被一份**新**文档占用（同名路径复用）：旧应答若只按路径命中会话，
  // 就会把 rev-a-saved 写进这份新文档的基准并清掉它的 dirty。
  rig.editor.open("a.md", "# 新的 A");
  rig.controller.noteOpened("a.md", "rev-new-a");
  rig.editor.edit("a.md", "# 新的 A 改");
  rig.backend.reset();

  gates[0].resolve("rev-a-saved");
  await stale;
  await flush();

  assert.equal(rig.toasts.live().length, 0, "旧应答不得弹提示");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true, "旧路径新文档的 dirty 不得被旧应答清掉");
  assert.equal(rig.editor.handle.sessionForPath("b.md")!.dirty, true, "改名后的文档 dirty 不得被旧应答清掉");

  rig.backend.handle("document_save", () => "rev-new-a-2");
  await rig.controller.save();
  assert.equal(rig.backend.argsOf("document_save").at(-1)!.path, "a.md");
  assert.equal(
    rig.backend.argsOf("document_save").at(-1)!.expected_revision,
    "rev-new-a",
    "旧路径新文档必须用自己登记的基准（旧应答不得污染）",
  );

  // 改名后的文档仍可用迁移过来的基准保存。
  rig.editor.activate("b.md");
  await rig.controller.save();
  const renamed = rig.backend.argsOf("document_save").at(-1)!;
  assert.equal(renamed.path, "b.md");
  assert.equal(renamed.expected_revision, "rev-1", "CAS 基准仍是改名前那一个");
  stopTimers(rig);
});

test("app 内改名：迟到的失败提示不跟到新键（不弹「另存为新文件」）", async () => {
  const rig = createRig();
  const gates = deferredSaves(rig);
  openDirty(rig, "dir/a.md", "# A", "rev-1");

  const stale = rig.controller.save();
  rig.editor.rename("dir/a.md", "dir/b.md");
  rig.controller.noteRenamed("dir/a.md", "dir/b.md");
  rig.backend.reset();

  gates[0].reject(commandError("fs_not_found", "旧路径已改名"));
  await stale;
  await flush();

  assert.equal(rig.toasts.live().length, 0, "旧路径的「已被外部删除」提示不得挂到改名后的文档上");
  assert.equal(rig.editor.handle.sessionForPath("dir/b.md")!.dirty, true);
  stopTimers(rig);
});

test("finally 绑定 token：旧保存收尾不撤新保存的在途标记", async () => {
  const rig = createRig();
  const gates = deferredSaves(rig);
  openDirty(rig, "README.md", "# A", "rev-a0");

  const stale = rig.controller.save(); // 租约 A（旧 vault）
  reopenInFreshVault(rig, "README.md", "# B", "rev-b0");
  const fresh = rig.controller.save(); // 租约 B（新 vault，同一路径）
  assert.equal(rig.backend.countOf("document_save"), 2);

  // 旧保存先收尾：它的 finally 若按路径整键删除，会把新保存的在途标记一并撤掉。
  gates[0].resolve("rev-a-saved");
  await stale;
  await flush();

  // 新保存仍在途：再按 ⌘S 不得发起第三次写入（在途标记还在）。
  await rig.controller.save();
  assert.equal(rig.backend.countOf("document_save"), 2, "旧 finally 不得撤掉新保存的租约");

  gates[1].resolve("rev-b-saved");
  await fresh;
  await flush();
  assert.equal(rig.editor.handle.sessionForPath("README.md")!.dirty, false);
  assert.ok(rig.toasts.texts().includes("已保存"));
  stopTimers(rig);
});

test("路径级失效：开新标签不让其他标签的在途保存作废（MUST NOT 用全局世代号）", async () => {
  const rig = createRig();
  const gates = deferredSaves(rig);
  openDirty(rig, "a.md", "# A", "rev-a0");

  const pending = rig.controller.save();
  // 新开一个标签：真实装配层会经 `beginSwitch` + 读快照 + `noteOpened`。
  rig.controller.beginSwitch();
  rig.editor.open("b.md", "# B");
  rig.controller.noteOpened("b.md", "rev-b0");

  gates[0].resolve("rev-a1");
  await pending;
  await flush();

  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false, "其他标签的在途保存必须照常闭环");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.cleanDoc, "# A 改");
  assert.ok(rig.toasts.texts().includes("已保存"));

  rig.editor.edit("b.md", "# B 改");
  rig.backend.handle("document_save", () => "rev-b1");
  await rig.controller.save();
  assert.equal(rig.backend.argsOf("document_save").at(-1)!.expected_revision, "rev-b0");
  stopTimers(rig);
});

test("正常保存不倒退：无失效事件时成功推进基准、冲突照常给出口", async () => {
  const rig = createRig();
  openDirty(rig, "a.md", "# A", "rev-1");

  rig.backend.handle("document_save", () => "rev-2");
  await rig.controller.save();
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false);
  assert.ok(rig.toasts.texts().includes("已保存"));

  rig.editor.edit("a.md", "# A 再改");
  await rig.controller.save();
  assert.equal(rig.backend.argsOf("document_save").at(-1)!.expected_revision, "rev-2", "成功应答照常推进基准");

  rig.backend.handle("document_save", () => {
    throw commandError("document_conflict", "磁盘上的版本更新");
  });
  rig.editor.edit("a.md", "# A 又改");
  await rig.controller.save();
  const prompt = rig.toasts.live().at(-1)!;
  assert.equal(prompt.sticky, true, "合法冲突的 sticky 提示不得被归属判据吞掉");
  assert.match(prompt.text, /保存冲突/);
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true);
  stopTimers(rig);
});

/** 走到「强制覆盖保存」的二次确认，返回确认提示（不复用冲突提示的动作标签猜测）。 */
async function armForceSave(rig: Rig): Promise<{ run(): void }> {
  rig.backend.handle("document_save", () => {
    throw commandError("document_conflict", "先制造一次冲突");
  });
  await rig.controller.save();
  const conflict = rig.toasts.live().at(-1)!;
  conflict.actions[1].run(); // 「强制覆盖保存」→ 二次确认
  const confirm = rig.toasts.live().at(-1)!;
  return confirm.actions[0]; // 「覆盖」→ forceSaveCurrentFile
}

test("强制覆盖：读基准在途期间失效 → 不再发起写入，旧 revision 不落到新文档", async () => {
  const rig = createRig();
  openDirty(rig, "README.md", "# A", "rev-a0");
  const overwrite = await armForceSave(rig);

  const snapshotGate = deferred<{ revision: string; content: string }>();
  rig.backend.handle("fs_read_snapshot", () => snapshotGate.promise);
  rig.backend.handle("document_save", () => "should-not-be-written");
  overwrite.run();
  assert.equal(rig.backend.countOf("fs_read_snapshot"), 1, "前提：覆盖链已经读到基准");

  reopenInFreshVault(rig, "README.md", "# B", "rev-b0");
  rig.backend.reset();
  snapshotGate.resolve({ revision: "disk-rev", content: "" });
  await flush(6);

  assert.equal(rig.backend.countOf("document_save"), 0, "归属已失效：覆盖链 MUST NOT 继续写入");
  assert.equal(rig.editor.handle.sessionForPath("README.md")!.dirty, true);
  stopTimers(rig);
});

test("强制覆盖：写入在途期间失效 → 应答整体丢弃，不写基准也不弹提示", async () => {
  const rig = createRig();
  openDirty(rig, "README.md", "# A", "rev-a0");
  const overwrite = await armForceSave(rig);

  const saveGate = deferred<string>();
  rig.backend.handle("fs_read_snapshot", () => ({ revision: "disk-rev", content: "" }));
  rig.backend.handle("document_save", () => saveGate.promise);
  overwrite.run();
  await flush();
  assert.equal(rig.backend.argsOf("document_save").at(-1)!.expected_revision, "disk-rev", "前提：覆盖写入已发出");

  reopenInFreshVault(rig, "README.md", "# B", "rev-b0");
  const toastsBefore = rig.toasts.live().length;
  rig.backend.reset();
  saveGate.resolve("rev-force-saved");
  await flush(6);

  assert.equal(rig.toasts.live().length, toastsBefore, "旧应答不得弹成功提示");
  assert.equal(rig.editor.handle.sessionForPath("README.md")!.dirty, true);

  rig.backend.handle("document_save", () => "rev-b1");
  await rig.controller.save();
  assert.equal(
    rig.backend.argsOf("document_save").at(-1)!.expected_revision,
    "rev-b0",
    "旧覆盖应答的 revision 不得写进新文档的 CAS 基准",
  );
  stopTimers(rig);
});
