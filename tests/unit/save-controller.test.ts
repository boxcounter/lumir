// src/save-controller.ts 的状态机单测：dirty 守卫、保存链路（成功 / 冲突 / 目标被删）、
// 崩溃备份的触发与生命周期、自身写盘回声判据、外部修改分流、另存为逃生口、世代号与诊断埋点。
//
// 这些判定此前只能靠浏览器场景间接兜底（228 个用例里只有少数几条覆盖保存链路），
// 而它们大多与 DOM / 渲染无关——是纯状态迁移（M153）。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { RECOVERY_DEBOUNCE_MS, SAVE_GUARD_TOAST_CLASS, recoveryCopyPath } from "../../src/save-controller.ts";
import { commandError, createRig } from "./harness.ts";
import type { Rig } from "./harness.ts";

/** 让 await 链跑完：mock timers 只接管 setTimeout，setImmediate 仍是真家伙。 */
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

/** 收尾：清掉崩溃备份排期的定时器（否则测试结束后它还会跑一次真的备份写入）。 */
const stopTimers = (rig: Rig) => rig.controller.noteVaultReset();

test("guard：无路径 / 不可编辑文件类 / 未登记基准 / 有基准，各给出口，clean 直接放行", () => {
  const rig = createRig();

  // 未命名文档：内容只活在内存里，出口是撤销而不是保存
  rig.editor.open(undefined, "草稿");
  rig.editor.edit(undefined, "草稿改");
  assert.equal(rig.controller.displayedPath(), undefined);
  assert.equal(rig.controller.guard("打开文件"), false);
  assert.match(rig.toasts.live()[0].text, /无法打开文件/);
  assert.match(rig.toasts.live()[0].text, /Cmd\+Z/);
  assert.ok(rig.toasts.live()[0].classes.has(SAVE_GUARD_TOAST_CLASS));

  // 不可编辑文件类（image/binary 形态）：同样不能建议「请先保存」
  rig.editor.open("pic.png", "binary", { editable: false });
  rig.editor.edit("pic.png", "binary 改");
  assert.equal(rig.controller.guard("打开文件"), false);
  assert.match(rig.toasts.live()[1].text, /Cmd\+Z/);

  // 可编辑文本类但**未登记磁盘 revision**（M130 兜底口径保留的防再犯分支）
  rig.editor.open("notes.txt", "纯文本", { mode: "code" });
  rig.editor.edit("notes.txt", "纯文本改");
  assert.equal(rig.editor.handle.sessionForPath("notes.txt")!.editable, true, "文本类会话可编辑");
  assert.equal(rig.controller.guard("打开文件"), false);
  assert.match(rig.toasts.live()[2].text, /无法打开文件/);

  // 非 md 文本类登记了基准后同样是「请先保存」（editable-non-md-files 的核心翻转）
  rig.editor.open("notes2.txt", "纯文本", { mode: "code" });
  rig.controller.noteOpened("notes2.txt", "rev-1");
  rig.editor.edit("notes2.txt", "纯文本改");
  assert.equal(rig.controller.guard("打开文件"), false);
  assert.match(rig.toasts.live()[3].text, /请先保存（Cmd\+S）/);

  // 可编辑 + 有基准：正常出口是 ⌘S
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 改");
  assert.equal(rig.controller.guard("打开文件"), false);
  assert.match(rig.toasts.live()[4].text, /请先保存（Cmd\+S）/);

  // clean：放行（判据是前台会话，此处前台是 a.md）
  rig.editor.handle.markCleanOf("a.md", "# A 改");
  assert.equal(rig.controller.guard("打开文件"), true);

  // 守卫提示是整批撤下的（dirty 清除时不留残影）
  rig.controller.clearGuardToasts();
  assert.equal(rig.toasts.live().length, 0);
  stopTimers(rig);
});

test("vaultSwitchBlock：任一标签有未保存修改就给判据，无脏标签返回 null（判据不弹提示）", () => {
  const rig = createRig();
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.open("b.md", "# B");
  rig.controller.noteOpened("b.md", "rev-1");
  assert.equal(rig.controller.vaultSwitchBlock(), null);

  // 后台标签脏也照样计入（切 vault 会把全部标签一起作废，判据是全体）
  rig.editor.edit("a.md", "# A 改");
  assert.deepEqual(rig.controller.vaultSwitchBlock(), { dirtyCount: 1, hasUnsaveable: false });
  // 判据只给信息：提示与三条出口摆在拦下它的地方（装配层），这里零 toast
  assert.equal(rig.toasts.live().length, 0);

  // 无落盘基准的脏标签（可编辑文本类但未登记 revision / 不可编辑文件类）标出来：
  // 「保存并切换」那条出口给不出来
  rig.editor.open("notes.txt", "纯文本", { mode: "code" });
  rig.editor.edit("notes.txt", "纯文本改");
  assert.deepEqual(rig.controller.vaultSwitchBlock(), { dirtyCount: 2, hasUnsaveable: true });

  // 登记基准后它变成可保存（editable-non-md-files：非 md 文本类进保存链路）
  rig.controller.noteOpened("notes.txt", "rev-1");
  assert.deepEqual(rig.controller.vaultSwitchBlock(), { dirtyCount: 2, hasUnsaveable: false });
  stopTimers(rig);
});

test("未装载标签（壳态）不拦切换 / 退出，也不进「保存全部脏标签」（M283 的 3.4）", async () => {
  const rig = createRig();
  rig.backend.handle("document_save", (args) => `rev-2-${args.path}`);
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  // 壳态标签：有路径、内容未装载、没有任何落盘基准（vault 会话恢复的第一步的产物）
  const shell = rig.editor.openShell("b.md");

  assert.equal(shell.loaded, false);
  assert.equal(rig.controller.vaultSwitchBlock(), null, "壳不是 dirty ⇒ 切换 / 退出不被拦下");

  rig.editor.edit("a.md", "# A 改");
  assert.deepEqual(
    rig.controller.vaultSwitchBlock(),
    { dirtyCount: 1, hasUnsaveable: false },
    "只有真的脏标签计入；壳态 MUST NOT 因为「没有落盘基准」被算进来",
  );

  assert.equal(await rig.controller.saveAllDirty(), true);
  assert.deepEqual(
    rig.backend.argsOf("document_save").map((args) => args.path),
    ["a.md"],
    "保存全部脏标签跳过壳态（它的内容还没进内存，没有可写的缓冲）",
  );
  assert.equal(rig.editor.handle.sessionForPath("b.md")!.loaded, false, "壳态保持未装载");
  stopTimers(rig);
});

test("saveAllDirty：逐个保存全部可保存的脏标签，未闭环返回 false", async () => {  const rig = createRig();
  rig.backend.handle("document_save", (args) => `rev-2-${args.path}`);
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.open("b.md", "# B");
  rig.controller.noteOpened("b.md", "rev-1");
  rig.editor.edit("a.md", "# A 改");
  rig.editor.edit("b.md", "# B 改");

  assert.equal(await rig.controller.saveAllDirty(), true);
  assert.deepEqual(rig.backend.argsOf("document_save").map((args) => args.path), ["a.md", "b.md"]);
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false);
  assert.equal(rig.editor.handle.sessionForPath("b.md")!.dirty, false);

  // 非 md 文本类登记基准后走**同一条**保存链路（editable-non-md-files 裁决 D3）
  rig.editor.open("notes.txt", "纯文本", { mode: "code" });
  rig.controller.noteOpened("notes.txt", "rev-1");
  rig.editor.edit("notes.txt", "纯文本改");
  assert.equal(await rig.controller.saveAllDirty(), true);
  assert.ok(
    rig.backend.argsOf("document_save").some((args) => args.path === "notes.txt"),
    "非 md 文本的保存必须真的发出 document_save",
  );
  assert.equal(rig.editor.handle.sessionForPath("notes.txt")!.dirty, false);

  // 不可保存的脏标签（未登记基准）：给不出保存路径 → 仍然算未闭环（调用方据此不切换）
  rig.editor.open("draft.txt", "纯文本", { mode: "code" });
  rig.editor.edit("draft.txt", "纯文本改");
  assert.equal(await rig.controller.saveAllDirty(), false);

  // 冲突：未闭环，且提示与出口由保存链路给出（不在切换流程里另造一套）
  rig.editor.handle.markCleanOf("draft.txt", "纯文本改");
  rig.backend.handle("document_save", () => {
    throw commandError("document_conflict", "磁盘上的版本更新");
  });
  rig.editor.edit("a.md", "# A 又改");
  assert.equal(await rig.controller.saveAllDirty(), false);
  assert.match(rig.toasts.live().at(-1)!.text, /保存冲突/);
  stopTimers(rig);
});

test("save：成功后 revision 前进、dirty 清除、崩溃备份作废", async () => {
  const rig = createRig();
  rig.backend.handle("document_save", (args) => {
    assert.equal(args.expected_revision, "rev-1");
    return "rev-2";
  });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 改");

  await rig.controller.save();
  assert.equal(rig.backend.countOf("document_save"), 1);
  const session = rig.editor.handle.sessionForPath("a.md")!;
  assert.equal(session.dirty, false);
  assert.equal(session.cleanDoc, "# A 改");
  assert.deepEqual(
    [...new Set(rig.backend.argsOf("recovery_discard").map((args) => args.path))],
    ["a.md"],
    "保存成功即作废崩溃备份（动作处显式清除 + dirty 转 clean 的订阅各清一次，幂等）",
  );
  assert.ok(rig.toasts.texts().includes("已保存"));

  // 已 clean：再按 ⌘S 不发写入
  await rig.controller.save();
  assert.equal(rig.backend.countOf("document_save"), 1);

  // 下一次保存以新 revision 为 CAS 基准
  rig.editor.edit("a.md", "# A 再改");
  await rig.controller.save();
  assert.equal(rig.backend.argsOf("document_save")[1].expected_revision, "rev-2");
  stopTimers(rig);
});

test("save：不可保存的 dirty 文档按 ⌘S 必须给人话反馈，不静默", async () => {
  const rig = createRig();
  // 非 md 文本类：登记了基准就真的落盘（editable-non-md-files 的核心翻转）
  rig.backend.handle("document_save", (args) => `rev-2-${args.path}`);
  rig.editor.open("notes.txt", "纯文本", { mode: "code" });
  rig.controller.noteOpened("notes.txt", "rev-1");
  rig.editor.edit("notes.txt", "纯文本改");
  await rig.controller.save();
  assert.deepEqual(
    rig.backend.argsOf("document_save").map((args) => args.path),
    ["notes.txt"],
    "Cmd+S 必须走真实保存链路",
  );
  assert.equal(rig.editor.handle.sessionForPath("notes.txt")!.dirty, false);

  // 可编辑但未登记磁盘 revision：不可保存，必须给可见反馈（M130 兜底口径保留）
  rig.editor.open("other.txt", "纯文本", { mode: "code" });
  rig.editor.edit("other.txt", "纯文本改");
  await rig.controller.save();
  assert.equal(rig.backend.countOf("document_save"), 1, "无基准不得发起写入");
  assert.match(rig.toasts.live().at(-1)!.text, /尚未可保存/);

  rig.editor.open(undefined, "草稿");
  rig.editor.edit(undefined, "草稿改");
  await rig.controller.save();
  assert.match(rig.toasts.live().at(-1)!.text, /没有打开的文件/);
  stopTimers(rig);
});

test("save：冲突给 sticky 恢复提示（放弃 / 强覆），内容留在内存且不落盘", async () => {
  const rig = createRig();
  rig.backend.handle("document_save", () => {
    throw commandError("document_conflict", "磁盘上的版本更新");
  });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 改");
  await rig.controller.save();

  const prompt = rig.toasts.live().at(-1)!;
  assert.equal(prompt.sticky, true, "冲突在用户处置前不得自动消隐");
  assert.deepEqual(
    prompt.actions.map((action) => action.label),
    ["重新载入（放弃我的修改）", "强制覆盖保存"],
  );
  assert.match(prompt.text, /保存冲突/);
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true, "失败不得丢内容");
  assert.equal(rig.backend.argsOf("document_save").at(-1)!.expected_revision, "rev-1");
  stopTimers(rig);
});

test("崩溃备份：停止输入满 debounce 才写，连续输入期间不写（无任何自动落盘）", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.editor.open("a.md", "# A");
    rig.controller.noteOpened("a.md", "rev-1");
    rig.editor.edit("a.md", "# A 1");

    mock.timers.tick(RECOVERY_DEBOUNCE_MS - 1);
    assert.equal(rig.backend.countOf("recovery_backup"), 0, "窗口未到不得写备份");
    rig.editor.edit("a.md", "# A 2"); // 每次内容变化重置窗口
    mock.timers.tick(RECOVERY_DEBOUNCE_MS - 1);
    assert.equal(rig.backend.countOf("recovery_backup"), 0, "连续输入期间不得写备份");
    mock.timers.tick(1);
    await flush();

    const backup = rig.backend.argsOf("recovery_backup")[0];
    assert.equal(backup.path, "a.md");
    assert.equal(backup.content, "# A 2");
    assert.equal(backup.base_revision, "rev-1", "备份基准取编辑器已知的磁盘 revision");
    assert.equal(rig.backend.countOf("document_save"), 0, "备份不得被当作落盘（备份≠保存）");
    assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true, "备份不清 dirty");
    stopTimers(rig);
  } finally {
    mock.timers.reset();
  }
});

test("崩溃备份：冲突之后也不自动重试写盘，dirty 内容只剩备份这一条定时写入", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.backend.handle("document_save", () => {
      throw commandError("document_conflict", "磁盘上的版本更新");
    });
    rig.editor.open("a.md", "# A");
    rig.controller.noteOpened("a.md", "rev-1");
    rig.editor.edit("a.md", "# A 改");
    await rig.controller.save(); // 制造冲突（CAS 已变，重试必败）
    rig.backend.reset();

    rig.editor.edit("a.md", "# A 改 2");
    mock.timers.tick(RECOVERY_DEBOUNCE_MS);
    await flush();

    assert.equal(rig.backend.countOf("document_save"), 0, "不得硬冲 CAS");
    assert.equal(rig.backend.argsOf("recovery_backup")[0].content, "# A 改 2");
    stopTimers(rig);
  } finally {
    mock.timers.reset();
  }
});

test("备份生命周期：内容回到磁盘基线（撤销 / 重做）即清除该路径的备份", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.editor.open("a.md", "# A");
    rig.controller.noteOpened("a.md", "rev-1");
    rig.editor.edit("a.md", "# A 改");
    mock.timers.tick(RECOVERY_DEBOUNCE_MS);
    await flush();
    assert.equal(rig.backend.countOf("recovery_backup"), 1, "前提：备份已落盘");

    rig.backend.reset();
    rig.editor.edit("a.md", "# A"); // 撤销回到已保存基线：dirty 转 false
    await flush();

    assert.deepEqual(
      rig.backend.argsOf("recovery_discard").map((args) => args.path),
      ["a.md"],
      "回到基线即作废备份（否则下次启动会追问要不要恢复用户已撤销的内容）",
    );
    stopTimers(rig);
  } finally {
    mock.timers.reset();
  }
});

test("备份生命周期：切换 vault（放弃修改）清除被放弃标签的备份", async () => {
  const rig = createRig();
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.open("b.md", "# B");
  rig.controller.noteOpened("b.md", "rev-1");
  rig.editor.edit("a.md", "# A 改"); // 只有 a 被放弃
  rig.backend.reset();

  rig.controller.noteVaultReset();

  assert.deepEqual(
    rig.backend.argsOf("recovery_discard").map((args) => args.path),
    ["a.md"],
    "切 vault 会作废全部标签：被放弃的 dirty 内容连备份一起清，干净的标签不必清",
  );
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, true);
});

test("handleExternalChange：clean 自动重载、dirty 交给用户、删除只提示", async () => {
  const rig = createRig();
  // 磁盘 revision 可变：回声判据（D2）读的就是它，反复返回同一个值会被正确判成回声。
  let disk = { revision: "rev-2", content: "# 磁盘版" };
  rig.backend.handle("fs_read_snapshot", () => disk);
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");

  // clean：自动重载并提示
  rig.controller.handleExternalChange("a.md", "modified");
  await flush();
  assert.deepEqual(rig.editor.reloads, [{ path: "a.md", content: "# 磁盘版" }]);
  assert.ok(rig.toasts.texts().some((text) => text.includes("已自动重载")));
  assert.equal(rig.deps.invalidateResolveCalls, 1, "内容已换，wikilink 解析缓存要整批失效");

  // dirty：把选择权交给用户（sticky 浮条，不打断打字），不自动覆盖
  disk = { revision: "rev-3", content: "# 磁盘又改" }; // 磁盘确实又变了
  rig.editor.edit("a.md", "# 我的修改");
  rig.controller.handleExternalChange("a.md", "modified");
  await flush();
  const prompt = rig.toasts.live().at(-1)!;
  assert.equal(prompt.sticky, true);
  assert.deepEqual(
    prompt.actions.map((action) => action.label),
    ["重载（放弃我的修改）", "保留我的版本"],
  );
  assert.equal(rig.editor.reloads.length, 1, "dirty 时不得自动重载");
  assert.ok(
    rig.backend.logEvents.some(
      (record) => record.event === "save_external_change" && record.fields.change === "modified",
    ),
  );

  // deleted：无法重载，只如实提示内容未丢失
  rig.controller.handleExternalChange("a.md", "deleted");
  assert.match(rig.toasts.live().at(-1)!.text, /已被外部删除/);
  assert.equal(rig.editor.reloads.length, 1);
  stopTimers(rig);
});

test("保存目标被外部删除：另存为新文件走建文件 → 写入 → 就地替换前台标签", async () => {
  const rig = createRig();
  rig.backend.handle("document_save", () => {
    throw commandError("fs_not_found", "文件不见了");
  });
  rig.editor.open("dir/a.md", "# A");
  rig.controller.noteOpened("dir/a.md", "rev-1");
  rig.editor.edit("dir/a.md", "# A 改");
  await rig.controller.save();

  const prompt = rig.toasts.live().at(-1)!;
  assert.equal(prompt.sticky, true);
  assert.deepEqual(prompt.actions.map((action) => action.label), ["另存为新文件"]);

  rig.backend.handle("wikilink_create", () => ({ created: "dir/a-恢复.md" }));
  rig.backend.handle("fs_read_snapshot", () => ({ revision: "rev-new", content: "" }));
  rig.backend.handle("document_save", (args) => {
    if (args.path === "dir/a-恢复.md") return "rev-new-2";
    throw commandError("fs_not_found", "文件不见了");
  });

  prompt.actions[0].run();
  await flush();

  const written = rig.backend.argsOf("document_save").at(-1)!;
  assert.equal(written.path, "dir/a-恢复.md");
  assert.equal(written.content, "# A 改");
  assert.equal(written.expected_revision, "rev-new", "空文件 revision 作新文件的 CAS 基准");
  assert.deepEqual(rig.deps.opened, [{ path: "dir/a-恢复.md", intent: "current" }]);
  assert.ok(rig.toasts.texts().some((text) => text.includes("已另存为")));
  stopTimers(rig);
});

test("保存目标被外部删除：非 md 文本另存走 create_file 且保留原扩展名", async () => {
  const rig = createRig();
  rig.backend.handle("document_save", () => {
    throw commandError("fs_not_found", "文件不见了");
  });
  rig.editor.open("dir/config.yaml", "a: 1", { mode: "code" });
  rig.controller.noteOpened("dir/config.yaml", "rev-1");
  rig.editor.edit("dir/config.yaml", "a: 2");
  await rig.controller.save();
  const prompt = rig.toasts.live().at(-1)!;
  assert.deepEqual(prompt.actions.map((action) => action.label), ["另存为新文件"]);

  // 候选名逐级推进：第一次撞名（create_file_exists），第二次成功
  rig.backend.handle("create_file", (args) => {
    if (args.path === "dir/config-恢复.yaml") throw commandError("create_file_exists", "已存在");
    return args.path;
  });
  rig.backend.handle("fs_read_snapshot", () => ({ revision: "rev-new", content: "" }));
  rig.backend.handle("document_save", (args) => (args.path === "dir/config-恢复-2.yaml" ? "rev-new-2" : "rev-x"));

  prompt.actions[0].run();
  await flush();

  assert.deepEqual(
    rig.backend.argsOf("create_file").map((args) => args.path),
    ["dir/config-恢复.yaml", "dir/config-恢复-2.yaml"],
    "非 md 的恢复副本必须走 create_file（wikilink_create 会强拼 .md），且撞名逐级重试",
  );
  assert.equal(rig.backend.countOf("wikilink_create"), 0, "非 md 不得走 wikilink 建笔记链路");
  const written = rig.backend.argsOf("document_save").at(-1)!;
  assert.equal(written.path, "dir/config-恢复-2.yaml");
  assert.equal(written.content, "a: 2");
  assert.deepEqual(rig.deps.opened, [{ path: "dir/config-恢复-2.yaml", intent: "current" }]);
  stopTimers(rig);
});

test("恢复副本命名：保留原扩展名，无扩展名与 dotfile 不被误加扩展名", () => {
  assert.equal(recoveryCopyPath("note.txt", ""), "note-恢复.txt");
  assert.equal(recoveryCopyPath("dir/config.yaml", "-2"), "dir/config-恢复-2.yaml");
  assert.equal(recoveryCopyPath("LICENSE", ""), "LICENSE-恢复");
  assert.equal(recoveryCopyPath("dir/Makefile", "-5"), "dir/Makefile-恢复-5");
  assert.equal(recoveryCopyPath(".gitignore", ""), ".gitignore-恢复");
  assert.equal(recoveryCopyPath("a.md", ""), "a-恢复.md");
});

test("beginSwitch / isCurrent：世代号单调，换 vault 后旧世代一律作废", () => {
  const rig = createRig();
  const first = rig.controller.beginSwitch();
  assert.equal(rig.controller.isCurrent(first), true);
  const second = rig.controller.beginSwitch();
  assert.equal(rig.controller.isCurrent(first), false);
  assert.equal(rig.controller.isCurrent(second), true);
  rig.controller.noteVaultReset();
  assert.equal(rig.controller.isCurrent(second), false);
});

test("自身写盘回声（D2）：保存后立刻再键入，回声到达时不误报外部修改", async () => {
  const rig = createRig();
  rig.backend.handle("document_save", () => "rev-2");
  rig.backend.handle("fs_read_snapshot", () => ({ revision: "rev-2", content: "# A 改" }));
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 改");
  await rig.controller.save();
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false);
  rig.backend.reset();

  // 回声到达前继续键入（M266 实测的 177ms 窗口）：缓冲区重新 dirty
  rig.editor.edit("a.md", "# A 改 2");
  const before = rig.toasts.live().length; // 已有的是保存成功那条 toast
  rig.controller.handleExternalChange("a.md", "modified");
  await flush();

  assert.equal(rig.toasts.live().length, before, "回声不得产生任何用户可见处置");
  assert.equal(rig.editor.reloads.length, 0, "回声不得重载，缓冲与选区不动");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.state.doc.toString(), "# A 改 2");
  assert.equal(rig.backend.logEvents.length, 0, "回声不是外部修改，不记 save_external_change");
  stopTimers(rig);
});

test("自身写盘回声（D2）：读在途期间完成的那次保存也算进来（基准取在读取之后）", async () => {
  // r1 评审 P2-1：基准若在 `await fsReadSnapshot` **之前**取样，读在途期间的保存 #2 推进的
  // 基准就进不了比对——「R2 === R1」不成立 ⇒ 判成外部修改 ⇒ dirty 分支弹 sticky 提示，
  // 而磁盘上根本没有第三方写入。本用例把那段交错钉出来。
  const rig = createRig();
  rig.backend.handle("document_save", () => "rev-2");
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 改");
  await rig.controller.save(); // 保存 #1（基准 → rev-2）
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false);

  // 回声（保存 #1 产生的 modified 事件）到达并进入读取；读在途期间用户又按了 ⌘S（保存 #2
  // 完成、基准推进到 rev-3）并继续键入。
  rig.backend.handle("fs_read_snapshot", async () => {
    rig.backend.handle("document_save", () => "rev-3");
    rig.editor.edit("a.md", "# A 改 2");
    await rig.controller.save(); // 保存 #2（`save()` 的返回是 void，判据取会话状态）
    assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false, "保存 #2 在读在途期间完成");
    rig.editor.edit("a.md", "# A 改 3"); // 用户继续键入 ⇒ 缓冲区重新 dirty
    return { revision: "rev-3", content: "# A 改 3" };
  });

  rig.controller.handleExternalChange("a.md", "modified");
  await flush();

  // 判据按**文本**取而不是按 toast 计数：交错里的那次保存自己也会留一条「已保存」。
  assert.equal(
    rig.toasts.live().filter((t) => t.text.includes("检测到外部修改")).length,
    0,
    "读之后取的基准把保存 #2 算进来了 ⇒ 是回声，不弹提示",
  );
  assert.equal(rig.editor.reloads.length, 0, "回声不得重载");
  assert.equal(rig.editor.handle.sessionForPath("a.md")!.state.doc.toString(), "# A 改 3");
  stopTimers(rig);
});

test("改名迁移（P2-2）：旧键备份作废、基准随键迁移、dirty 会话按新键立即补一份", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.editor.open("a.md", "# A");
    rig.controller.noteOpened("a.md", "rev-1");
    rig.editor.edit("a.md", "# A 改");
    rig.backend.reset();

    rig.editor.rename("a.md", "b.md"); // 真内核 remapSessionPaths 的替身（只换路径）
    rig.controller.noteRenamed("a.md", "b.md");
    await flush();

    assert.deepEqual(
      rig.backend.argsOf("recovery_discard").map((args) => args.path),
      ["a.md"],
      "旧路径的备份随改名作废（否则下次启动弹一个指向已改名文件的恢复提示）",
    );
    const backup = rig.backend.argsOf("recovery_backup")[0];
    assert.equal(backup.path, "b.md", "dirty 内容按新路径立即补一份");
    assert.equal(backup.content, "# A 改");
    assert.equal(backup.base_revision, "rev-1", "CAS 基准随键迁移（改名不改字节）");

    // 旧键那条待写定时器随键作废：跨过一个窗口后不得再冒出第二份写入。
    mock.timers.tick(RECOVERY_DEBOUNCE_MS);
    await flush();
    assert.equal(rig.backend.countOf("recovery_backup"), 1, "旧键的定时器不得再写一份");
    assert.deepEqual(
      rig.backend.argsOf("recovery_backup").map((args) => args.path),
      ["b.md"],
    );

    // 基准迁移的直接后果：改名后 ⌘S 仍能保存（不迁则新路径落进「未登记磁盘版本」的不可保存态）。
    rig.backend.handle("document_save", () => "rev-2");
    await rig.controller.save();
    const written = rig.backend.argsOf("document_save").at(-1)!;
    assert.equal(written.path, "b.md");
    assert.equal(written.expected_revision, "rev-1", "CAS 基准确实是改名前那一个");
    assert.equal(rig.editor.handle.sessionForPath("b.md")!.dirty, false);
    stopTimers(rig);
  } finally {
    mock.timers.reset();
  }
});

test("改名迁移：clean 会话只清旧备份、不补新备份；目录改名逐会话同口径（批量）", async () => {
  const rig = createRig();
  rig.editor.open("sub/a.md", "# A");
  rig.controller.noteOpened("sub/a.md", "rev-1");
  rig.editor.open("sub/deep/b.md", "# B");
  rig.controller.noteOpened("sub/deep/b.md", "rev-2");
  rig.editor.edit("sub/a.md", "# A 改");
  rig.editor.edit("sub/deep/b.md", "# B 改");
  // 先让 a.md 回到基线（clean）——它不该再补备份，但旧键仍要清。
  rig.editor.handle.markCleanOf("sub/a.md", "# A 改");
  rig.backend.reset();

  // 目录改名：装配层把 remapSessionPaths 返回的路径对逐条喂进来。
  for (const [from, to] of [
    ["sub/a.md", "sub2/a.md"],
    ["sub/deep/b.md", "sub2/deep/b.md"],
  ]) {
    rig.editor.rename(from, to);
    rig.controller.noteRenamed(from, to);
  }
  await flush();

  assert.deepEqual(
    rig.backend.argsOf("recovery_discard").map((args) => args.path),
    ["sub/a.md", "sub/deep/b.md"],
    "每个受影响会话的旧键都要清（含已 clean 的那一份残留）",
  );
  assert.deepEqual(
    rig.backend.argsOf("recovery_backup").map((args) => args.path),
    ["sub2/deep/b.md"],
    "只有仍 dirty 的那个按新键补一份",
  );
  assert.equal(rig.backend.argsOf("recovery_backup")[0].base_revision, "rev-2");
  stopTimers(rig);
});

test("自身写盘回声：磁盘读取失败按「不是回声」降级（宁可多提示一次）", async () => {
  const rig = createRig();
  rig.backend.handle("fs_read_snapshot", () => {
    throw commandError("fs_read_failed", "读不到");
  });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 改");

  rig.controller.handleExternalChange("a.md", "modified");
  await flush();

  assert.match(rig.toasts.live().at(-1)!.text, /检测到外部修改/, "读失败不得静默忽略真实的外部修改");
  stopTimers(rig);
});

test("诊断埋点：外部修改命中打开中文件记一条 save_external_change；回声不记", async () => {
  const rig = createRig();
  rig.backend.handle("fs_read_snapshot", () => ({ revision: "rev-9", content: "# 磁盘版" }));
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 1");
  rig.controller.handleExternalChange("a.md", "modified");
  await flush();

  assert.equal(
    rig.backend.logEvents.filter((record) => record.event === "save_external_change").length,
    1,
  );

  rig.backend.reset();
  rig.backend.handle("fs_read_snapshot", () => ({ revision: "rev-1", content: "# A 1" }));
  rig.controller.handleExternalChange("a.md", "modified");
  await flush();
  assert.equal(rig.backend.logEvents.length, 0, "revision 一致即自身的写入回声，不记事件");
  stopTimers(rig);
});
