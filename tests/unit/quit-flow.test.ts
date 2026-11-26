// 退出弹框的纯逻辑层（change add-quit-save-all-dialog-nov27）。
//
// 这些用例守的是「保存与退出之间没有任何一条路能绕过」：保存失败 / 新 dirty / 代次失效 /
// 重复触发 / 退出被拒都不得发出退出请求，也不得把失败洗成成功。视图层（焦点、Escape、inert）
// 在 `tests/visual/scenes/quit-save-all-dialog-nov27.spec.ts` 判；后端复核在 Rust 单测判。
import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuitFlow } from "../../src/quit-flow.ts";
import type { QuitFailure, QuitFlowState } from "../../src/quit-flow.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Rig {
  states: QuitFlowState[];
  failures: Array<QuitFailure | undefined>;
  saveCalls: number;
  quitCalls: number;
  dirtyChecks: number;
  flow: ReturnType<typeof createQuitFlow>;
  setSaveAll(fn: () => Promise<boolean>): void;
  setAnyDirty(fn: () => boolean): void;
  setQuit(fn: () => Promise<void>): void;
}

function createRig(): Rig {
  const rig: Rig = {
    states: [],
    failures: [],
    saveCalls: 0,
    quitCalls: 0,
    dirtyChecks: 0,
    flow: undefined as unknown as ReturnType<typeof createQuitFlow>,
    setSaveAll: (fn) => {
      rig.flow = createQuitFlow({ ...deps, saveAll: fn });
    },
    setAnyDirty: (fn) => {
      rig.flow = createQuitFlow({ ...deps, anyDirty: fn });
    },
    setQuit: (fn) => {
      rig.flow = createQuitFlow({ ...deps, quit: fn });
    },
  };
  const deps = {
    saveAll: async () => {
      rig.saveCalls += 1;
      return true;
    },
    anyDirty: () => {
      rig.dirtyChecks += 1;
      return false;
    },
    quit: async () => {
      rig.quitCalls += 1;
    },
    onState: (state: QuitFlowState, failure?: QuitFailure) => {
      rig.states.push(state);
      rig.failures.push(failure);
    },
  };
  rig.flow = createQuitFlow(deps);
  return rig;
}

test("保存成功且无新 dirty：请求退出，状态 saving → quitting", async () => {
  const rig = createRig();
  const ok = await rig.flow.saveAndQuit();
  assert.equal(ok, true);
  assert.equal(rig.saveCalls, 1);
  assert.equal(rig.dirtyChecks, 1);
  assert.equal(rig.quitCalls, 1);
  assert.deepEqual(rig.states, ["saving", "quitting"]);
  assert.equal(rig.flow.state(), "quitting");
});

test("保存未闭环：不发退出请求，状态 failed(save)", async () => {
  const rig = createRig();
  rig.setSaveAll(async () => {
    rig.saveCalls += 1;
    return false;
  });
  const ok = await rig.flow.saveAndQuit();
  assert.equal(ok, false);
  assert.equal(rig.quitCalls, 0);
  assert.equal(rig.flow.state(), "failed");
  assert.equal(rig.flow.failure(), "save");
  assert.deepEqual(rig.states, ["saving", "failed"]);
  assert.deepEqual(rig.failures, [undefined, "save"]);
});

test("保存抛错按失败处理，不退出", async () => {
  const rig = createRig();
  rig.setSaveAll(async () => {
    rig.saveCalls += 1;
    throw new Error("boom");
  });
  assert.equal(await rig.flow.saveAndQuit(), false);
  assert.equal(rig.quitCalls, 0);
  assert.equal(rig.flow.failure(), "save");
});

test("保存成功但本地复查仍有新 dirty：不退出（失败原因 dirty）", async () => {
  const rig = createRig();
  rig.setAnyDirty(() => {
    rig.dirtyChecks += 1;
    return true;
  });
  assert.equal(await rig.flow.saveAndQuit(), false);
  assert.equal(rig.quitCalls, 0);
  assert.equal(rig.flow.state(), "failed");
  assert.equal(rig.flow.failure(), "dirty");
});

test("保存期间的重复触发单飞：第二次不发起保存、不产生第二个退出", async () => {
  const rig = createRig();
  const saving = deferred<boolean>();
  rig.setSaveAll(() => {
    rig.saveCalls += 1;
    return saving.promise;
  });
  const first = rig.flow.saveAndQuit();
  const second = rig.flow.saveAndQuit();
  assert.equal(await second, false);
  assert.equal(rig.saveCalls, 1);
  saving.resolve(true);
  assert.equal(await first, true);
  assert.equal(rig.quitCalls, 1);
});

test("弹框关闭（reset）后保存才完成：代次失效，不补发退出", async () => {
  const rig = createRig();
  const saving = deferred<boolean>();
  rig.setSaveAll(() => {
    rig.saveCalls += 1;
    return saving.promise;
  });
  const inFlight = rig.flow.saveAndQuit();
  rig.flow.reset();
  saving.resolve(true);
  assert.equal(await inFlight, false);
  assert.equal(rig.quitCalls, 0);
  assert.equal(rig.flow.state(), "idle");
});

test("退出请求被后端拒绝：状态 failed(quit)，不自动重试", async () => {
  const rig = createRig();
  rig.setQuit(async () => {
    rig.quitCalls += 1;
    throw { code: "quit_blocked_dirty", message: "仍有未保存的修改" };
  });
  assert.equal(await rig.flow.saveAndQuit(), false);
  assert.equal(rig.quitCalls, 1);
  assert.equal(rig.flow.state(), "failed");
  assert.equal(rig.flow.failure(), "quit");
  // 没有定时器 / 循环：等待一拍后仍是同一次调用，不产生第二次保存或退出。
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(rig.quitCalls, 1);
  assert.equal(rig.saveCalls, 1);
});

test("失败后用户手动重试：重新走保存屏障并可成功", async () => {
  const rig = createRig();
  let attempt = 0;
  rig.setSaveAll(async () => {
    rig.saveCalls += 1;
    attempt += 1;
    return attempt > 1;
  });
  assert.equal(await rig.flow.saveAndQuit(), false);
  assert.equal(rig.flow.failure(), "save");
  assert.equal(await rig.flow.saveAndQuit(), true);
  assert.equal(rig.saveCalls, 2);
  assert.equal(rig.quitCalls, 1);
  assert.deepEqual(rig.states, ["saving", "failed", "saving", "quitting"]);
});

test("退出在途时后端又拦下一次：回到 failed(quit)，可手动重试且不被在途结果覆盖", async () => {
  const rig = createRig();
  const quitting = deferred<void>();
  rig.setQuit(() => {
    rig.quitCalls += 1;
    return quitting.promise;
  });
  const inFlight = rig.flow.saveAndQuit();
  // 让 saveAll / anyDirty 走完、进入 quitting（微任务两拍足够：saveAll 是已 resolve 的 promise）。
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(rig.flow.state(), "quitting");
  rig.flow.noteQuitBlocked();
  assert.equal(rig.flow.state(), "failed");
  assert.equal(rig.flow.failure(), "quit");
  // 在途 quit 的旧代次结果不得把状态改回去、也不得报成功。
  quitting.resolve();
  assert.equal(await inFlight, false);
  assert.equal(rig.flow.state(), "failed");
  // 用户手动重试：重新走保存与退出（第二次 quit 调用）。
  const second = rig.flow.saveAndQuit();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(rig.flow.state(), "quitting");
  assert.equal(rig.quitCalls, 2);
  await second;
});

test("reset 清掉失败状态与原因（下次打开从 idle 开始）", async () => {
  const rig = createRig();
  rig.setSaveAll(async () => {
    rig.saveCalls += 1;
    return false;
  });
  await rig.flow.saveAndQuit();
  assert.equal(rig.flow.failure(), "save");
  rig.flow.reset();
  assert.equal(rig.flow.state(), "idle");
  assert.equal(rig.flow.failure(), null);
});

test("退出命令受理后即使提前 resolve 也保持 quitting（不回退、不重试）", async () => {
  const rig = createRig();
  assert.equal(await rig.flow.saveAndQuit(), true);
  assert.equal(rig.flow.state(), "quitting");
  assert.equal(rig.quitCalls, 1);
  assert.equal(rig.saveCalls, 1);
});
