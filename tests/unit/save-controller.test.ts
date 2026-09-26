// src/save-controller.ts 的状态机单测：dirty 守卫、保存链路（成功 / 冲突 / 目标被删）、
// 自动保存 debounce 与崩溃备份、外部修改分流、另存为逃生口、世代号与诊断埋点。
//
// 这些判定此前只能靠浏览器场景间接兜底（228 个用例里只有少数几条覆盖保存链路），
// 而它们大多与 DOM / 渲染无关——是纯状态迁移（M153）。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { AUTOSAVE_DEBOUNCE_MS, SAVE_GUARD_TOAST_CLASS, recoveryCopyPath } from "../../src/save-controller.ts";
import { commandError, createRig } from "./harness.ts";
import type { Rig } from "./harness.ts";

/** 让 await 链跑完：mock timers 只接管 setTimeout，setImmediate 仍是真家伙。 */
const flush = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

/** 收尾：清掉自动保存排期的定时器（否则测试结束后它还会跑一次真的 reconcile）。 */
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

test("saveAllDirty：逐个保存全部可保存的脏标签，未闭环返回 false", async () => {
  const rig = createRig();
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
  assert.equal(rig.backend.countOf("recovery_discard"), 1, "保存成功即作废崩溃备份");
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

test("save：冲突给 sticky 恢复提示（放弃 / 强覆），内容留在内存并暂停自动保存", async () => {
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
  assert.ok(
    rig.backend.logEvents.some(
      (record) => record.event === "autosave_paused" && record.fields.reason === "conflict",
    ),
  );
  stopTimers(rig);
});

test("自动保存：停止输入满 debounce 才落盘", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.backend.handle("document_save", () => "rev-2");
    rig.editor.open("a.md", "# A");
    rig.controller.noteOpened("a.md", "rev-1");
    rig.editor.edit("a.md", "# A 1");
    rig.editor.edit("a.md", "# A 2");

    mock.timers.tick(AUTOSAVE_DEBOUNCE_MS - 1);
    assert.equal(rig.backend.countOf("document_save"), 0, "连续输入期间不落盘");
    mock.timers.tick(1);
    await flush();

    assert.equal(rig.backend.countOf("document_save"), 1);
    assert.equal(rig.backend.argsOf("document_save")[0].content, "# A 2");
    assert.equal(rig.editor.handle.sessionForPath("a.md")!.dirty, false);
    assert.ok(rig.toasts.texts().includes("已自动保存"));
    stopTimers(rig);
  } finally {
    mock.timers.reset();
  }
});

test("自动保存：冲突暂停期间只写崩溃备份，不硬冲 CAS", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const rig = createRig();
    rig.backend.handle("document_save", () => {
      throw commandError("document_conflict", "磁盘上的版本更新");
    });
    rig.editor.open("a.md", "# A");
    rig.controller.noteOpened("a.md", "rev-1");
    rig.editor.edit("a.md", "# A 改");
    await rig.controller.save(); // 制造冲突 → 暂停自动保存
    rig.backend.reset();

    rig.editor.edit("a.md", "# A 改 2");
    mock.timers.tick(AUTOSAVE_DEBOUNCE_MS);
    await flush();

    assert.equal(rig.backend.countOf("document_save"), 0, "暂停期间不得硬冲 CAS");
    const backup = rig.backend.argsOf("recovery_backup")[0];
    assert.equal(backup.path, "a.md");
    assert.equal(backup.content, "# A 改 2");
    assert.equal(backup.base_revision, "rev-1", "备份基准取编辑器已知的磁盘 revision");
    stopTimers(rig);
  } finally {
    mock.timers.reset();
  }
});

test("handleExternalChange：clean 自动重载、dirty 交给用户、删除只提示", async () => {
  const rig = createRig();
  rig.backend.handle("fs_read_snapshot", () => ({ revision: "rev-2", content: "# 磁盘版" }));
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");

  // clean：自动重载并提示
  rig.controller.handleExternalChange("a.md", "modified");
  await flush();
  assert.deepEqual(rig.editor.reloads, [{ path: "a.md", content: "# 磁盘版" }]);
  assert.ok(rig.toasts.texts().some((text) => text.includes("已自动重载")));
  assert.equal(rig.deps.invalidateResolveCalls, 1, "内容已换，wikilink 解析缓存要整批失效");

  // dirty：把选择权交给用户（sticky 浮条，不打断打字），不自动覆盖
  rig.editor.edit("a.md", "# 我的修改");
  rig.controller.handleExternalChange("a.md", "modified");
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

test("诊断埋点：暂停只在跃迁时记一条，重新载入后记 resumed", async () => {
  const rig = createRig();
  rig.backend.handle("document_save", () => {
    throw commandError("document_conflict", "磁盘上的版本更新");
  });
  rig.editor.open("a.md", "# A");
  rig.controller.noteOpened("a.md", "rev-1");
  rig.editor.edit("a.md", "# A 1");
  await rig.controller.save();
  rig.editor.edit("a.md", "# A 2");
  await rig.controller.save();

  const paused = rig.backend.logEvents.filter((record) => record.event === "autosave_paused");
  assert.equal(paused.length, 1, "连续两次冲突只该记一条暂停（跃迁才记）");

  rig.backend.handle("fs_read_snapshot", () => ({ revision: "rev-9", content: "# 磁盘版" }));
  rig.toasts.live().at(-1)!.actions[0].run();
  await flush();
  assert.ok(
    rig.backend.logEvents.some(
      (record) => record.event === "autosave_resumed" && record.fields.reason === "reloaded",
    ),
    "重新载入后要记 resumed",
  );
  stopTimers(rig);
});
