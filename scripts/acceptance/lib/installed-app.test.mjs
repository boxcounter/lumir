// 安装版显式暂停通道的自测（change add-acceptance-installed-app-pause）。
//
// 这一层的判据全部是**机器可判的**：目标发现 / 身份复核 / 锁与登记 / 菜单触发 / 完成信号 /
// 正常 ⌘Q 的顺序与负向口径。平台副作用全部注入假实现——本文件不起 app、不碰
// `/Applications/Lumir.app`、不读用户配置。
//
// 重点钉住的三条「不安全的成功」形态（REVIEW.md「断言等价于子串」「读不到当成空」条）：
//   1. **保存前绝不 ⌘Q**：屏障失败 / 超时 / AX 空树时，quit 一次都不能被调用；
//   2. **缺完成信号不是成功**：全树子串命中（正文里写着同一句话）不算，必须节点级精确相等；
//   3. **锁/登记只释放自己的 session**：别人的活锁不删、别人的登记不删。
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  activateByPid,
  acquirePauseLock,
  appPathOfInstance,
  assertNoActivePause,
  assertPauseExclusive,
  canonicalAppPath,
  discoverInstalledApp,
  listActiveRunners,
  pauseClosingNote,
  PauseFailed,
  PauseRefused,
  pauseFailureExitCode,
  quitInstalledByCmdQ,
  registerActiveRunner,
  releasePauseLock,
  runInstalledPause,
  runPauseThenPreflight,
  SAVE_ALL_FAILURE_TEXTS,
  SAVE_ALL_SUCCESS_TEXTS,
  triggerSaveAllMenuItem,
  unregisterActiveRunner,
  verifyInstalledTarget,
  waitSaveAllSignal,
} from "./installed-app.mjs";

const APP = "/Applications/Lumir.app";
const PRODUCT_ID = "com.lumir.app";
const PID = 4242;
const STARTED = 1_700_000_000_000;

const canonicalInstance = (over = {}) => ({
  pid: PID,
  cmd: `${APP}/Contents/MacOS/lumir`,
  kind: "bundle",
  startedAt: STARTED,
  ...over,
});

const readId = () => PRODUCT_ID;

// ---------------------------------------------------------------------------
// 目标发现：只认唯一、canonical、产品 bundle id、pid/startedAt 可读的安装版
// ---------------------------------------------------------------------------

test("发现：没有安装版在跑 → running:false（不是错误，收尾不得凭空拉起）", () => {
  const decision = discoverInstalledApp({ instances: [], productId: PRODUCT_ID, readBundleId: readId });
  assert.equal(decision.running, false);
  assert.equal(decision.refused, false);
  assert.equal(decision.reason, "not-running");
});

test("发现：唯一 canonical 安装版 + 产品 bundle id → 目标成立", () => {
  const decision = discoverInstalledApp({
    instances: [canonicalInstance()],
    productId: PRODUCT_ID,
    readBundleId: readId,
  });
  assert.equal(decision.refused, false);
  assert.equal(decision.running, true);
  assert.deepEqual(
    { pid: decision.target.pid, appPath: APP, bundleId: PRODUCT_ID, startedAt: STARTED },
    { pid: PID, appPath: APP, bundleId: PRODUCT_ID, startedAt: STARTED },
  );
});

test("发现：dev 实例在场 → 拒绝（暂停通道只处理安装版，零副作用）", () => {
  const decision = discoverInstalledApp({
    instances: [{ pid: 77, cmd: "/tmp/wt/src-tauri/target/debug/lumir", kind: "dev", startedAt: STARTED }],
    productId: PRODUCT_ID,
    readBundleId: readId,
  });
  assert.equal(decision.refused, true);
  assert.equal(decision.reason, "foreign-instance");
});

test("发现：验收 bundle（另一个 .app）在场 → 拒绝（同机第二个实例会污染前台 / AX 归属）", () => {
  const decision = discoverInstalledApp({
    instances: [
      canonicalInstance(),
      {
        pid: 78,
        cmd: "/tmp/wt/src-tauri/target/debug/bundle/macos/Lumir.app/Contents/MacOS/lumir",
        kind: "bundle",
        startedAt: STARTED,
      },
    ],
    productId: PRODUCT_ID,
    readBundleId: readId,
  });
  assert.equal(decision.refused, true);
  assert.equal(decision.reason, "foreign-instance");
});

test("发现：canonical 安装版有两个实例 → 拒绝（归属不明，不挑一个）", () => {
  const decision = discoverInstalledApp({
    instances: [canonicalInstance(), canonicalInstance({ pid: PID + 1 })],
    productId: PRODUCT_ID,
    readBundleId: readId,
  });
  assert.equal(decision.refused, true);
  assert.equal(decision.reason, "multiple-instances");
});

test("发现：pid / startedAt 读不到 → 拒绝（不猜）", () => {
  for (const over of [{ startedAt: null }, { pid: 0 }]) {
    const decision = discoverInstalledApp({
      instances: [canonicalInstance(over)],
      productId: PRODUCT_ID,
      readBundleId: readId,
    });
    assert.equal(decision.refused, true);
    assert.equal(decision.reason, "identity-unreadable");
  }
});

test("发现：bundle id 不等于产品 id / 读不到 → 拒绝", () => {
  const mismatch = discoverInstalledApp({
    instances: [canonicalInstance()],
    productId: PRODUCT_ID,
    readBundleId: () => "com.lumir.app.acceptance",
  });
  assert.equal(mismatch.refused, true);
  assert.equal(mismatch.reason, "bundle-id-mismatch");

  const unreadable = discoverInstalledApp({
    instances: [canonicalInstance()],
    productId: PRODUCT_ID,
    readBundleId: () => {
      throw new Error("plist 读不到");
    },
  });
  assert.equal(unreadable.refused, true);
  assert.equal(unreadable.reason, "bundle-id-unreadable");
});

test("发现：realpath 归一（/private/tmp 与 /tmp）后仍认作同一个 .app", () => {
  const decision = discoverInstalledApp({
    instances: [
      {
        pid: PID,
        cmd: "/private/tmp/Lumir.app/Contents/MacOS/lumir",
        kind: "bundle",
        startedAt: STARTED,
      },
    ],
    appPath: "/tmp/Lumir.app",
    productId: PRODUCT_ID,
    readBundleId: readId,
    realpath: (p) => String(p).replace(/^\/private\/tmp/, "/tmp"),
  });
  assert.equal(decision.running, true);
  assert.equal(decision.target.appPath, "/tmp/Lumir.app");
});

test("appPathOfInstance：从 Contents/MacOS/ 截 .app 根；不含该段的命令回 null", () => {
  assert.equal(appPathOfInstance(`${APP}/Contents/MacOS/lumir`), APP);
  assert.equal(appPathOfInstance(`${APP}/Contents/MacOS/lumir-bin`), APP);
  assert.equal(appPathOfInstance("/usr/bin/ps"), null);
  assert.equal(canonicalAppPath(APP, { realpath: (p) => p }), APP);
  // 「命令行里**提到**这个路径的 shell 不算实例」是 listLumirInstances 的 comm 判据（M478），
  // 不在本 helper 的面内——这里只负责从**已确认是实例**的 command 里截 .app 根。
});

// ---------------------------------------------------------------------------
// 身份复核：保存前 / ⌘Q 前必须是同一个进程
// ---------------------------------------------------------------------------

test("复核：pid / startedAt / bundle id 任一变化都拒绝（pid 复用不得被当成同一实例）", () => {
  const target = { pid: PID, appPath: APP, bundleId: PRODUCT_ID, startedAt: STARTED };
  const base = { productId: PRODUCT_ID, readBundleId: readId };

  assert.doesNotThrow(() =>
    verifyInstalledTarget(target, { ...base, instances: [canonicalInstance({ startedAt: STARTED + 1_000 })] }),
  );
  assert.throws(
    () => verifyInstalledTarget(target, { ...base, instances: [canonicalInstance({ pid: PID + 1 })] }),
    /pid 已从/,
  );
  assert.throws(
    () => verifyInstalledTarget(target, { ...base, instances: [canonicalInstance({ startedAt: STARTED + 10_000 })] }),
    /启动时刻/,
  );
  assert.throws(
    () =>
      verifyInstalledTarget(target, {
        ...base,
        instances: [canonicalInstance()],
        readBundleId: () => "other",
      }),
    /身份复核失败/,
  );
  assert.throws(
    () => verifyInstalledTarget(target, { ...base, instances: [] }),
    /消失/,
  );
});

// ---------------------------------------------------------------------------
// 编排顺序：先保存屏障、后 ⌘Q；失败 / 超时 / AX 不可读一律不 ⌘Q
// ---------------------------------------------------------------------------

function pauseHarness({ waitError = null, verifyErrorAt = null } = {}) {
  const calls = [];
  let verifyCount = 0;
  const deps = {
    requested: true,
    listInstances: () => {
      calls.push("list");
      return [canonicalInstance()];
    },
    productId: PRODUCT_ID,
    readBundleId: readId,
    verifyTarget: (target) => {
      verifyCount += 1;
      calls.push(`verify-${verifyCount}`);
      if (verifyErrorAt === verifyCount) throw new PauseFailed(`复核失败（${verifyCount}）`);
      return target;
    },
    activate: async (pid) => void calls.push(`activate-${pid}`),
    triggerSaveAll: async (pid) => void calls.push(`trigger-${pid}`),
    waitSaveAll: async (pid) => {
      calls.push(`wait-${pid}`);
      if (waitError) throw waitError;
      return { reads: 3 };
    },
    quit: async (pid) => {
      calls.push(`quit-${pid}`);
      return { ms: 7 };
    },
    evidence: async (line) => void calls.push(`evidence:${line.split(" ")[1]}`),
  };
  return { calls, deps };
}

test("编排：顺序 = 复核 → 激活 → 菜单屏障 → 完成信号 → 复核 → ⌘Q；状态 closed", async () => {
  const { calls, deps } = pauseHarness();
  const state = await runInstalledPause({ ...deps, state: {} });
  const sequence = calls.filter((c) => !c.startsWith("evidence:"));
  // 每次复核都会先取一次实例清单（复核的输入必须是**保存前 / ⌘Q 前**的现场，不是旧快照）。
  assert.deepEqual(sequence, [
    "list",
    "list",
    "verify-1",
    `activate-${PID}`,
    `trigger-${PID}`,
    `wait-${PID}`,
    "list",
    "verify-2",
    `quit-${PID}`,
  ]);
  assert.equal(state.state, "closed");
  assert.equal(state.touched, true);
  assert.match(pauseClosingNote(state), /安装版已按请求保持关闭，需时由用户自行启动/);
});

test("编排：保存屏障失败 / 超时 → ⌘Q 一次都不调用（保存前 ⌘Q = 0），现场保留", async () => {
  for (const message of ["保存屏障报告失败", "等保存屏障完成信号超时", "安装版 AX 树为空"]) {
    const { calls, deps } = pauseHarness({ waitError: new PauseFailed(message) });
    const state = {};
    await assert.rejects(() => runInstalledPause({ ...deps, state }), new RegExp(message));
    assert.equal(calls.filter((c) => c.startsWith("quit-")).length, 0, `${message}：MUST NOT ⌘Q`);
    assert.equal(calls.filter((c) => c.startsWith("trigger-")).length, 1);
    assert.equal(state.touched, true, "已经激活过安装版 = 碰过它");
    assert.equal(state.state, "skipped");
    assert.match(pauseClosingNote(state), /不会自动重开或恢复/);
  }
});

test("编排：保存前的身份复核失败 → 不激活、不点菜单、不 ⌘Q", async () => {
  const { calls, deps } = pauseHarness({ verifyErrorAt: 1 });
  await assert.rejects(() => runInstalledPause({ ...deps, state: {} }), /复核失败/);
  assert.deepEqual(calls.filter((c) => !c.startsWith("evidence:")), ["list", "list", "verify-1"]);
});

test("编排：⌘Q 前的身份复核失败 → 不 ⌘Q（换了进程就不是那个安装版）", async () => {
  const { calls, deps } = pauseHarness({ verifyErrorAt: 2 });
  await assert.rejects(() => runInstalledPause({ ...deps, state: {} }), /复核失败/);
  assert.equal(calls.filter((c) => c.startsWith("quit-")).length, 0);
});

test("编排：安装版未运行 → 不激活、不点菜单、不 ⌘Q，也不拉起（state=not-running）", async () => {
  const calls = [];
  const state = await runInstalledPause({
    requested: true,
    state: {},
    listInstances: () => [],
    productId: PRODUCT_ID,
    readBundleId: readId,
    verifyTarget: () => assert.fail("未运行不应复核"),
    activate: async () => void calls.push("activate"),
    triggerSaveAll: async () => void calls.push("trigger"),
    waitSaveAll: async () => void calls.push("wait"),
    quit: async () => void calls.push("quit"),
    evidence: async () => {},
  });
  assert.deepEqual(calls, []);
  assert.equal(state.state, "not-running");
  assert.match(pauseClosingNote(state), /未运行，本次未拉起/);
});

test("编排：没有 --pause-installed（requested:false）→ 一个副作用都不发生", async () => {
  const calls = [];
  const state = await runInstalledPause({
    requested: false,
    state: {},
    listInstances: () => {
      calls.push("list");
      return [canonicalInstance()];
    },
    activate: async () => void calls.push("activate"),
    triggerSaveAll: async () => void calls.push("trigger"),
    waitSaveAll: async () => void calls.push("wait"),
    quit: async () => void calls.push("quit"),
  });
  assert.deepEqual(calls, []);
  assert.equal(state.state, "skipped");
  assert.equal(pauseClosingNote(state), null);
});

test("第二次调用：安装版已关闭 → not-running，零副作用（不 ⌘Q、不重开）", async () => {
  const { calls, deps } = pauseHarness();
  const first = await runInstalledPause({ ...deps, state: {} });
  assert.equal(first.state, "closed");
  const before = calls.filter((c) => !c.startsWith("list") && !c.startsWith("evidence:")).length;
  const secondState = await runInstalledPause({
    ...deps,
    state: {},
    listInstances: () => [],
  });
  assert.equal(secondState.state, "not-running");
  assert.equal(
    calls.filter((c) => !c.startsWith("list") && !c.startsWith("evidence:")).length,
    before,
    "第二次调用不产生任何激活 / 菜单 / ⌘Q",
  );
});

// ---------------------------------------------------------------------------
// 完成信号：节点级精确相等；空树 / 读失败 / 缺信号都不是成功
// ---------------------------------------------------------------------------

const axWith = (line) => `- app: X\n- pid: ${PID}\n\`\`\`\n${line}\n\`\`\``;

test("完成信号：AXStaticText 精确等于成功文案 → 成立", async () => {
  const result = await waitSaveAllSignal({
    pid: PID,
    readState: async () => axWith('- [3] AXStaticText = "已保存全部更改"'),
  });
  assert.equal(result.reads, 1);
  assert.equal(result.text, "已保存全部更改");
});

test("完成信号：英文界面同样成立（安装版用用户自己的语言配置）", async () => {
  const result = await waitSaveAllSignal({
    pid: PID,
    readState: async () => axWith('- [3] AXStaticText = "All changes saved"'),
  });
  assert.equal(result.text, "All changes saved");
});

test("完成信号：失败终态出现 → 立即失败（不 ⌘Q、不跑批）", async () => {
  await assert.rejects(
    () =>
      waitSaveAllSignal({
        pid: PID,
        readState: async () => axWith('- [3] AXStaticText = "未能保存全部更改，请按提示处理后重试"'),
      }),
    /保存屏障报告失败/,
  );
});

test("完成信号：空 AX 树 → PauseFailed（不可读 ≠ 成功）", async () => {
  await assert.rejects(
    () => waitSaveAllSignal({ pid: PID, readState: async () => "" }),
    /AX 树为空/,
  );
});

test("完成信号：AX 读失败 → PauseFailed（不把通道故障当成功）", async () => {
  await assert.rejects(
    () =>
      waitSaveAllSignal({
        pid: PID,
        readState: async () => {
          throw new Error("MCP 超时");
        },
      }),
    /读安装版 AX 失败/,
  );
});

test("完成信号：同样的字只出现在正文（AXTextArea）里 → 必须超时失败，不得冒充完成", async () => {
  await assert.rejects(
    () =>
      waitSaveAllSignal({
        pid: PID,
        timeoutMs: 30,
        everyMs: 5,
        readState: async () => axWith('- [5] AXTextArea = "已保存全部更改"'),
      }),
    /等保存屏障完成信号超时/,
  );
});

// ---------------------------------------------------------------------------
// 菜单触发：File → Save All 两步 AXPress
// ---------------------------------------------------------------------------

test("菜单触发：先点 AXMenuBarItem File，再点 AXMenuItem Save All", async () => {
  const reads = [
    axWith("- [10] AXMenuBarItem (File) @0,0 30×20 actions=[AXPress]"),
    axWith("- [20] AXMenuItem (Save All) @12,40 80×20 actions=[AXPress]"),
  ];
  const clicks = [];
  const result = await triggerSaveAllMenuItem({
    pid: PID,
    readState: async () => reads[Math.min(clicks.length, reads.length - 1)],
    click: async (pid, index) => void clicks.push({ pid, index }),
  });
  assert.deepEqual(clicks, [
    { pid: PID, index: 10 },
    { pid: PID, index: 20 },
  ]);
  assert.ok(result.reads >= 2);
});

test("菜单触发：菜单栏里没有 File → PauseFailed（不退回快捷键，也不伪造已保存）", async () => {
  await assert.rejects(
    () =>
      triggerSaveAllMenuItem({
        pid: PID,
        timeoutMs: 20,
        everyMs: 5,
        readState: async () => axWith("- [1] AXStaticText = hello"),
        click: async () => assert.fail("不得点击"),
      }),
    /等不到 AXMenuBarItem/,
  );
});

// ---------------------------------------------------------------------------
// ⌘Q：只走真实按键 + 等**原 pid** 消失；超时即失败，不补刀
// ---------------------------------------------------------------------------

test("⌘Q：按 pid 激活后发 cmd+q，等原 pid 消失", async () => {
  let polls = 0;
  const pressed = [];
  const activated = [];
  const info = await quitInstalledByCmdQ({
    pid: PID,
    activate: async (targetPid) => void activated.push(targetPid),
    pressKey: async (targetPid, keys) => void pressed.push({ targetPid, keys }),
    findInstances: () => {
      polls += 1;
      return polls >= 3 ? [] : [{ pid: PID }];
    },
    everyMs: 1,
    timeoutMs: 1000,
  });
  assert.deepEqual(activated, [PID]);
  assert.deepEqual(pressed, [{ targetPid: PID, keys: "cmd+q" }]);
  assert.ok(info.ms >= 0);
});

test("⌘Q：等的是**原 pid**——仍有别的 Lumir 实例不满足判据（直到超时）", async () => {
  await assert.rejects(
    () =>
      quitInstalledByCmdQ({
        pid: PID,
        activate: async () => {},
        pressKey: async () => {},
        // 原 pid 一直在场，靶子里另有别的实例：不得把「有实例在跑」当成「原实例还在」的反向。
        findInstances: () => [{ pid: PID }, { pid: PID + 1 }],
        everyMs: 1,
        timeoutMs: 30,
      }),
    /不升级为 SIGTERM \/ SIGKILL/,
  );
});

test("激活：只按 pid（System Events 的 unix id），脚本里没有按名字的 Apple Event", async () => {
  const invocations = [];
  const result = await activateByPid({
    pid: PID,
    exec: (cmd, args) => {
      invocations.push({ cmd, args });
      return "true\n";
    },
  });
  assert.equal(result.attempts, 1);
  const script = invocations[0].args.join("\n");
  assert.match(script, new RegExp(`unix id is ${PID}`));
  assert.ok(!script.includes('application "Lumir"'), "MUST NOT 用按名字的 Apple Event");
  assert.ok(!script.includes("quit"), "MUST NOT 用 Apple Event quit");
});

test("激活：frontmost 读不到 true → 失败（不静默继续）", async () => {
  await assert.rejects(
    () =>
      activateByPid({
        pid: PID,
        attempts: 2,
        everyMs: 1,
        exec: () => "false\n",
      }),
    /按 pid 激活安装版失败/,
  );
});

// ---------------------------------------------------------------------------
// 锁与活动 runner 登记：全机独占、只释放自己的 session
// ---------------------------------------------------------------------------

function memFs() {
  const files = new Map();
  const dirs = new Set();
  return {
    files,
    dirs,
    mkdirSync(p) {
      if (dirs.has(p)) throw Object.assign(new Error(`EEXIST: ${p}`), { code: "EEXIST" });
      dirs.add(p);
    },
    writeFileSync(p, data) {
      files.set(p, String(data));
    },
    readFileSync(p) {
      if (!files.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return files.get(p);
    },
    readdirSync(p) {
      if (!dirs.has(p)) throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      return [...files.keys()]
        .filter((file) => file.startsWith(`${p}/`))
        .map((file) => file.slice(p.length + 1));
    },
    rmSync(p) {
      files.delete(p);
      dirs.delete(p);
      for (const key of [...files.keys()]) if (key.startsWith(`${p}/`)) files.delete(key);
      for (const key of [...dirs]) if (key.startsWith(`${p}/`)) dirs.delete(key);
    },
  };
}

const alive = () => true;
const dead = () => {
  const e = new Error("ESRCH");
  e.code = "ESRCH";
  throw e;
};

test("暂停锁：活着的人持有 → PauseRefused；锁只释放自己的 session", async () => {
  const fs = memFs();
  const lock = "/lock";
  await acquirePauseLock({ dir: lock, pid: 111, mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, fs });
  assert.equal(releasePauseLock({ dir: lock, pid: 222, fs }), false, "别人的锁不删");
  assert.equal(fs.files.get(`${lock}/pid`).trim(), "111");
  await assert.rejects(
    () => acquirePauseLock({ dir: lock, pid: 333, mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, kill: alive }),
    PauseRefused,
  );
  assert.equal(releasePauseLock({ dir: lock, pid: 111, fs }), true, "自己的锁才释放");
  assert.equal(fs.dirs.has(lock), false);
});

test("暂停锁：持有人已死是崩溃残留——回收后照常拿锁", async () => {
  const fs = memFs();
  const lock = "/lock";
  fs.mkdirSync(lock);
  fs.writeFileSync(`${lock}/pid`, "999999\n");
  const held = await acquirePauseLock({
    dir: lock,
    pid: 111,
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    kill: dead,
    readFileSync: fs.readFileSync,
    rmSync: fs.rmSync,
  });
  assert.equal(held.pid, 111);
  assert.equal(fs.files.get(`${lock}/pid`).trim(), "111");
});

test("活动 runner 登记：只列活进程；崩溃残留不删也不当成「有人在跑」", () => {
  const fs = memFs();
  const dir = "/runners";
  registerActiveRunner({ dir, pid: 111, mode: "run", mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync });
  fs.writeFileSync(`${dir}/222.json`, JSON.stringify({ pid: 222, mode: "run" }));
  const onlyAlive = (pid) => {
    if (pid === 111) return;
    const e = new Error("ESRCH");
    e.code = "ESRCH";
    throw e;
  };
  const live = listActiveRunners({ dir, fs, kill: onlyAlive });
  assert.deepEqual(live.entries.map((e) => e.pid), [111]);
  assert.equal(listActiveRunners({ dir, fs, kill: dead }).entries.length, 0);
  // 文件内容里的 pid 与文件名 / 本次 pid 不符（被篡改 / 归属不明）→ 不删
  fs.writeFileSync(`${dir}/333.json`, JSON.stringify({ pid: 999 }));
  assert.equal(unregisterActiveRunner({ dir, pid: 333, fs }), false, "内容不符的登记不删");
  assert.equal(fs.files.has(`${dir}/333.json`), true);
  assert.equal(unregisterActiveRunner({ dir, pid: 111, fs }), true, "自己的登记才删");
  assert.equal(fs.files.has(`${dir}/111.json`), false);
});

test("暂停排他：有别的活动 runner / 读不出的登记 → 拒绝（专属暂停）", () => {
  const fs = memFs();
  const registry = "/runners";
  const lock = "/lock";
  fs.mkdirSync(registry);
  fs.mkdirSync(lock);
  fs.writeFileSync(`${lock}/pid`, "111\n");

  // 自己的条目：排除后放行
  fs.writeFileSync(`${registry}/111.json`, JSON.stringify({ pid: 111, mode: "run-with-pause" }));
  assert.doesNotThrow(() => assertPauseExclusive({ pauseLockDir: lock, registryDir: registry, ownPid: 111, fs, kill: alive }));

  // 别人的活动条目：拒绝（普通跑批与暂停并发）
  fs.writeFileSync(`${registry}/222.json`, JSON.stringify({ pid: 222, mode: "run" }));
  assert.throws(
    () => assertPauseExclusive({ pauseLockDir: lock, registryDir: registry, ownPid: 111, fs, kill: alive }),
    /别的验收跑批在跑/,
  );

  // 读不出 pid 的登记：归属不明 → 拒绝
  fs.files.delete(`${registry}/222.json`);
  fs.writeFileSync(`${registry}/broken.json`, "{oops");
  assert.throws(
    () => assertPauseExclusive({ pauseLockDir: lock, registryDir: registry, ownPid: 111, fs, kill: alive }),
    /读不出 pid/,
  );

  // 暂停锁被别人持有：拒绝第二次暂停
  fs.files.delete(`${registry}/broken.json`);
  fs.writeFileSync(`${lock}/pid`, "333\n");
  assert.throws(
    () => assertPauseExclusive({ pauseLockDir: lock, registryDir: registry, ownPid: 111, fs, kill: alive }),
    /拒绝第二次暂停/,
  );
});

test("普通跑批：暂停进行中拒绝启动；已死的暂停锁回收后放行", () => {
  const fs = memFs();
  const lock = "/lock";
  fs.mkdirSync(lock);
  fs.writeFileSync(`${lock}/pid`, "333\n");
  assert.throws(() => assertNoActivePause({ pauseLockDir: lock, fs, kill: alive }), /暂停正在进行/);

  const reclaimed = assertNoActivePause({ pauseLockDir: lock, fs, kill: dead });
  assert.equal(reclaimed.reclaimed, true);
  assert.equal(fs.dirs.has(lock), false);

  assert.deepEqual(assertNoActivePause({ pauseLockDir: "/absent", fs, kill: alive }), { reclaimed: false });
});

test("暂停锁：目录在但读不到 pid → 普通跑批拒绝（不贸然接管）", () => {
  const fs = memFs();
  const lock = "/lock";
  fs.mkdirSync(lock);
  assert.throws(() => assertNoActivePause({ pauseLockDir: lock, fs, kill: alive }), /读不到 pid/);
});

test("默认依赖：不注入 fs 时 registerActiveRunner / acquirePauseLock 真能落盘（run.mjs 的调用形态）", async () => {
  // run.mjs 按「不注入」形态调用这两个函数。单测若只注入假 fs，默认实现缺失（例如忘 import
  // mkdirSync）会在真机第一步就炸——这里用真实 fs + 临时目录钉住这条接线。
  const dir = mkdtempSync(path.join(os.tmpdir(), "lumir-pause-wiring-"));
  try {
    const entry = registerActiveRunner({ dir });
    assert.equal(existsSync(entry), true);
    assert.equal(unregisterActiveRunner({ dir }), true);
    assert.equal(existsSync(entry), false);

    const lock = path.join(dir, "pause.lock");
    const held = await acquirePauseLock({ dir: lock });
    assert.equal(held.pid, process.pid);
    assert.equal(releasePauseLock({ dir: lock }), true);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("顺序外壳：暂停成功后才跑 preflight；暂停失败 / 未请求时的分支各自正确", async () => {
  const calls = [];
  const preflight = async () => void calls.push("preflight");

  await runPauseThenPreflight({
    requested: true,
    pause: async () => void calls.push("pause"),
    preflight,
  });
  assert.deepEqual(calls, ["pause", "preflight"], "暂停成功 → preflight 原样执行（不跳过）");

  calls.length = 0;
  await assert.rejects(() =>
    runPauseThenPreflight({
      requested: true,
      pause: async () => {
        calls.push("pause");
        throw new PauseFailed("保存屏障失败");
      },
      preflight,
    }),
  );
  assert.deepEqual(calls, ["pause"], "暂停失败 → MUST NOT 跑批（preflight 不执行）");

  calls.length = 0;
  await runPauseThenPreflight({
    requested: false,
    pause: async () => void calls.push("pause"),
    preflight,
  });
  assert.deepEqual(calls, ["preflight"], "没有 --pause-installed → 不触达安装版，preflight 照旧");
});

test("退出码：暂停拒绝 / 失败都映射为 2（本次读数不算数），其它错误留给 runner 兜底", () => {
  assert.equal(pauseFailureExitCode(new PauseRefused("拒绝")), 2);
  assert.equal(pauseFailureExitCode(new PauseFailed("失败")), 2);
  assert.equal(pauseFailureExitCode(new Error("其它")), null);
  // 不是 1：暂停失败 MUST NOT 被记成产品判红（那会让复盘把它当缺陷追）。
  assert.notEqual(pauseFailureExitCode(new PauseFailed("失败")), 1);
});

// ---------------------------------------------------------------------------
// 文案与产品文案表的对账（避免第二份真源漂移）
// ---------------------------------------------------------------------------

test("完成 / 失败信号文案与 src/copy-data.ts 的 D1035 / D1036 逐字一致", () => {
  const source = readFileSync(new URL("../../../src/copy-data.ts", import.meta.url), "utf8");
  const fieldOf = (key, field) => {
    const at = source.indexOf(`${key}:`);
    assert.ok(at >= 0, `copy-data.ts 里找不到 ${key}`);
    const window = source.slice(at, at + 500);
    const match = new RegExp(`${field}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(window);
    assert.ok(match, `${key} 缺 ${field}`);
    return match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  };
  assert.deepEqual(SAVE_ALL_SUCCESS_TEXTS, [fieldOf("D1035", "zh"), fieldOf("D1035", "en")]);
  assert.deepEqual(SAVE_ALL_FAILURE_TEXTS, [fieldOf("D1036", "zh"), fieldOf("D1036", "en")]);
});
