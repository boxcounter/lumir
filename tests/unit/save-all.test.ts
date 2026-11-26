// 「保存全部」屏障与代次（change add-acceptance-installed-app-pause；K3 verdict P1-3 / P1-4）。
//
// 这些用例覆盖的是验收通道**退出许可**的判据：任何一步失败、await 期间出现新 dirty、并发 /
// 重复触发都必须没有成功终态（marker ok / success toast），且后端 dirty 镜像不得被 false 覆盖。
// 装配层（main.ts）只做真实依赖注入，判据本体在这里，可无 DOM / 无 Tauri 单测。
import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaveAllBarrier } from "../../src/save-all.ts";
import type { SaveAllBarrierDeps, SaveAllMarkerState } from "../../src/save-all.ts";

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
  deps: SaveAllBarrierDeps;
  calls: string[];
  markers: Array<{ state: SaveAllMarkerState; generation: number }>;
  toasts: string[];
  /** 每次 anyDirty 的返回值序列（耗尽后沿用最后一个）。 */
  setDirtySequence(values: boolean[]): void;
  setSaveAllDirty(fn: () => Promise<boolean>): void;
  setFlushSessions(fn: () => Promise<boolean>): void;
  setFlushPositions(fn: () => Promise<boolean>): void;
  setSyncDirty(fn: (dirty: boolean) => Promise<void>): void;
}

function createRig(): Rig {
  let dirtySequence = [false];
  let dirtyIndex = 0;
  const rig: Rig = {
    calls: [],
    markers: [],
    toasts: [],
    deps: undefined as unknown as SaveAllBarrierDeps,
    setDirtySequence: (values) => {
      dirtySequence = values.length > 0 ? values : [false];
      dirtyIndex = 0;
    },
    setSaveAllDirty: (fn) => {
      rig.deps.saveAllDirty = fn;
    },
    setFlushSessions: (fn) => {
      rig.deps.flushSessions = fn;
    },
    setFlushPositions: (fn) => {
      rig.deps.flushPositions = fn;
    },
    setSyncDirty: (fn) => {
      rig.deps.syncDirty = fn;
    },
  };
  rig.deps = {
    saveAllDirty: async () => {
      rig.calls.push("saveAllDirty");
      return true;
    },
    flushSessions: async () => {
      rig.calls.push("flushSessions");
      return true;
    },
    flushPositions: async () => {
      rig.calls.push("flushPositions");
      return true;
    },
    anyDirty: () => {
      const value = dirtySequence[Math.min(dirtyIndex, dirtySequence.length - 1)];
      dirtyIndex += 1;
      rig.calls.push(`anyDirty:${value}`);
      return value;
    },
    syncDirty: async (dirty) => {
      rig.calls.push(`syncDirty:${dirty}`);
    },
    marker: (state, generation) => {
      rig.markers.push({ state, generation });
      rig.calls.push(`marker:${state}#${generation}`);
    },
    toastSuccess: () => void rig.toasts.push("success"),
    toastFailure: () => void rig.toasts.push("failure"),
    toastBusy: () => void rig.toasts.push("busy"),
  };
  return rig;
}

const lastMarker = (rig: Rig) => rig.markers.at(-1);

test("成功：按序执行五步，marker 由 running#1 走到 ok#1，且只有一条成功 toast", async () => {
  const rig = createRig();
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), true);
  assert.deepEqual(rig.calls, [
    "marker:running#1",
    "saveAllDirty",
    "flushSessions",
    "flushPositions",
    "anyDirty:false",
    "syncDirty:false",
    "anyDirty:false",
    "marker:ok#1",
  ]);
  assert.deepEqual(rig.toasts, ["success"]);
  assert.equal(barrier.generation(), 1);
  assert.equal(barrier.isRunning(), false);
});

test("保存失败：不发 ok / 成功 toast，后续 flush 与镜像同步都不执行", async () => {
  const rig = createRig();
  rig.setSaveAllDirty(async () => false);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.deepEqual(lastMarker(rig), { state: "failed", generation: 1 });
  assert.deepEqual(rig.toasts, ["failure"]);
  assert.ok(!rig.calls.some((c) => c.startsWith("flush") || c.startsWith("syncDirty")));
});

test("标签会话真实写失败（resolved false）：屏障失败，不再继续阅读位置", async () => {
  const rig = createRig();
  rig.setFlushSessions(async () => false);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.deepEqual(lastMarker(rig), { state: "failed", generation: 1 });
  assert.ok(!rig.calls.includes("flushPositions"));
  assert.ok(!rig.calls.some((c) => c.startsWith("syncDirty")));
  assert.deepEqual(rig.toasts, ["failure"]);
});

test("阅读位置真实写失败：屏障失败，不碰 dirty 镜像", async () => {
  const rig = createRig();
  rig.setFlushPositions(async () => false);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.ok(!rig.calls.some((c) => c.startsWith("syncDirty")));
  assert.deepEqual(rig.toasts, ["failure"]);
});

test("flush 后仍有 dirty（前置复查）：失败，镜像同步不执行", async () => {
  const rig = createRig();
  rig.setDirtySequence([true]);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.ok(!rig.calls.some((c) => c.startsWith("syncDirty")));
  assert.deepEqual(lastMarker(rig), { state: "failed", generation: 1 });
});

test("后端 dirty 镜像同步失败：屏障失败，不发成功终态", async () => {
  const rig = createRig();
  rig.setSyncDirty(async (dirty) => {
    rig.calls.push(`syncDirty:${dirty}`);
    if (dirty === false) throw new Error("IPC 不可用");
  });
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.deepEqual(lastMarker(rig), { state: "failed", generation: 1 });
  assert.deepEqual(rig.toasts, ["failure"]);
});

test("竞态（K3 P1-4）：await 镜像同步期间出现新 dirty → 不得发成功，且镜像恢复为 true", async () => {
  const rig = createRig();
  const gate = deferred();
  let dirty = false;
  rig.setDirtySequence([false]); // 前置复查那一刻还是干净的
  rig.setSyncDirty(async (value) => {
    rig.calls.push(`syncDirty:${value}`);
    if (value === false) {
      await gate.promise;
      // 同步在途时用户继续编辑：前端 dirty 变成 true
      dirty = true;
    }
  });
  rig.deps.anyDirty = () => {
    rig.calls.push(`anyDirty:${dirty}`);
    return dirty;
  };
  const barrier = createSaveAllBarrier(rig.deps);

  const running = barrier.run();
  // 让屏障走到「等待镜像同步回包」那一拍
  await new Promise((resolve) => setImmediate(resolve));
  gate.resolve();
  assert.equal(await running, false, "同步等待期间新 dirty：本次保存全部不得成功");
  assert.deepEqual(
    rig.calls.filter((c) => c.startsWith("syncDirty")),
    ["syncDirty:false", "syncDirty:true"],
    "必须把镜像恢复成 true，MUST NOT 用 false 覆盖新 dirty",
  );
  assert.deepEqual(lastMarker(rig), { state: "failed", generation: 1 });
  assert.ok(!rig.markers.some((m) => m.state === "ok"));
  assert.deepEqual(rig.toasts, ["failure"]);
});

test("并发 / 重复触发（K3 P1-3）：单飞不开新代次，第二次只标 busy，不产生成功终态", async () => {
  const rig = createRig();
  const gate = deferred<boolean>();
  let first = true;
  rig.setSaveAllDirty(async () => {
    rig.calls.push("saveAllDirty");
    if (first) {
      first = false;
      return gate.promise;
    }
    return true;
  });
  const barrier = createSaveAllBarrier(rig.deps);

  const running = barrier.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await barrier.run(), false, "第一次还在跑：第二次必须被拒（单飞）");
  assert.deepEqual(lastMarker(rig), { state: "busy", generation: 1 });
  assert.deepEqual(rig.toasts, ["busy"]);
  assert.equal(barrier.generation(), 1, "被拒的触发不得增加代次");

  gate.resolve(true);
  assert.equal(await running, true);
  assert.deepEqual(lastMarker(rig), { state: "ok", generation: 1 });
  assert.deepEqual(rig.toasts, ["busy", "success"], "成功 toast 只属于第一次操作");
});

test("代次单调：每次成功触发的 marker 代次加一（验收通道据此拒绝旧信号）", async () => {
  const rig = createRig();
  const barrier = createSaveAllBarrier(rig.deps);
  await barrier.run();
  await barrier.run();
  const okMarkers = rig.markers.filter((m) => m.state === "ok");
  assert.deepEqual(
    okMarkers.map((m) => m.generation),
    [1, 2],
  );
  assert.equal(barrier.generation(), 2);
});
