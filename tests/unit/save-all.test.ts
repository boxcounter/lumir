// 「保存全部」屏障与操作归属日志（change add-acceptance-installed-app-pause；K3 P1-3 / P1-4）。
//
// 这些用例覆盖的是验收通道**退出许可**的判据：任何一步失败、await 期间出现新 dirty、并发 /
// 重复触发都必须没有成功终态（日志 ok / success toast），且后端 dirty 镜像不得被 false 覆盖。
// 装配层（main.ts）只做真实依赖注入，判据本体在这里，可无 DOM / 无 Tauri 单测。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SAVE_ALL_LOG_LIMIT,
  createSaveAllBarrier,
  initialSaveAllLog,
} from "../../src/save-all.ts";
import type { SaveAllBarrierDeps, SaveAllLogState, SaveAllRecord } from "../../src/save-all.ts";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 产品日志文本 → 记录（与 `installed-app.mjs` 的解析器同一格式；跨层对账见文末用例）。 */
function recordsOf(text: string): SaveAllRecord[] {
  const prefix = "save-all-log ";
  assert.ok(text.startsWith(prefix), `不是保存全部日志：${text}`);
  return text
    .slice(prefix.length)
    .trim()
    .split(" ")
    .map((token) => {
      const match = /^s(\d+):g(\d+):(idle|running|ok|failed|busy)$/.exec(token);
      assert.ok(match, `日志记录形态不符：${token}`);
      return { seq: Number(match[1]), generation: Number(match[2]), state: match[3] as SaveAllLogState };
    });
}

interface Rig {
  deps: SaveAllBarrierDeps;
  calls: string[];
  logs: string[];
  toasts: string[];
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
    logs: [],
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
    log: (text) => {
      rig.logs.push(text);
      rig.calls.push(`log:${text}`);
    },
    toastSuccess: () => void rig.toasts.push("success"),
    toastFailure: () => void rig.toasts.push("failure"),
    toastBusy: () => void rig.toasts.push("busy"),
  };
  return rig;
}

const lastRecords = (rig: Rig) => recordsOf(rig.logs.at(-1)!);

test("初始日志是 idle 基线（验收通道的触发前基线必须可读，而不是「没有日志」）", () => {
  assert.deepEqual(recordsOf(initialSaveAllLog()), [{ seq: 0, generation: 0, state: "idle" }]);
});

test("成功：日志按序追加 running#1 → ok#1，且只有一条成功 toast", async () => {
  const rig = createRig();
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), true);
  assert.deepEqual(recordsOf(rig.logs.at(-1)!), [
    { seq: 0, generation: 0, state: "idle" },
    { seq: 1, generation: 1, state: "running" },
    { seq: 2, generation: 1, state: "ok" },
  ]);
  assert.deepEqual(
    rig.calls.filter((c) => !c.startsWith("log:")),
    [
      "saveAllDirty",
      "flushSessions",
      "flushPositions",
      "anyDirty:false",
      "syncDirty:false",
      "anyDirty:false",
    ],
  );
  assert.deepEqual(rig.toasts, ["success"]);
  assert.equal(barrier.generation(), 1);
  assert.equal(barrier.isRunning(), false);
});

test("保存失败：日志以 failed#1 结束，不发 ok / 成功 toast，后续步骤不执行", async () => {
  const rig = createRig();
  rig.setSaveAllDirty(async () => false);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.deepEqual(lastRecords(rig).at(-1), { seq: 2, generation: 1, state: "failed" });
  assert.deepEqual(rig.toasts, ["failure"]);
  assert.ok(!rig.calls.some((c) => c.startsWith("flush") || c.startsWith("syncDirty")));
});

test("标签会话真实写失败（resolved false）：failed#1，不再继续阅读位置", async () => {
  const rig = createRig();
  rig.setFlushSessions(async () => false);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.deepEqual(lastRecords(rig).at(-1), { seq: 2, generation: 1, state: "failed" });
  assert.ok(!rig.calls.includes("flushPositions"));
  assert.ok(!rig.calls.some((c) => c.startsWith("syncDirty")));
  assert.deepEqual(rig.toasts, ["failure"]);
});

test("阅读位置真实写失败：failed#1，不碰 dirty 镜像", async () => {
  const rig = createRig();
  rig.setFlushPositions(async () => false);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.ok(!rig.calls.some((c) => c.startsWith("syncDirty")));
  assert.deepEqual(rig.toasts, ["failure"]);
});

test("flush 后仍有 dirty（前置复查）：failed，镜像同步不执行", async () => {
  const rig = createRig();
  rig.setDirtySequence([true]);
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.ok(!rig.calls.some((c) => c.startsWith("syncDirty")));
  assert.deepEqual(lastRecords(rig).at(-1), { seq: 2, generation: 1, state: "failed" });
});

test("后端 dirty 镜像同步失败：failed，不发成功终态", async () => {
  const rig = createRig();
  rig.setSyncDirty(async (dirty) => {
    rig.calls.push(`syncDirty:${dirty}`);
    if (dirty === false) throw new Error("IPC 不可用");
  });
  const barrier = createSaveAllBarrier(rig.deps);
  assert.equal(await barrier.run(), false);
  assert.deepEqual(lastRecords(rig).at(-1), { seq: 2, generation: 1, state: "failed" });
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
  await new Promise((resolve) => setImmediate(resolve));
  gate.resolve();
  assert.equal(await running, false, "同步等待期间新 dirty：本次保存全部不得成功");
  assert.deepEqual(
    rig.calls.filter((c) => c.startsWith("syncDirty")),
    ["syncDirty:false", "syncDirty:true"],
    "必须把镜像恢复成 true，MUST NOT 用 false 覆盖新 dirty",
  );
  const records = lastRecords(rig);
  assert.deepEqual(records.at(-1), { seq: 2, generation: 1, state: "failed" });
  assert.ok(!records.some((record) => record.state === "ok"));
  assert.deepEqual(rig.toasts, ["failure"]);
});

test("并发 / 重复触发（K3 P1-3）：单飞不开新代次，追加 busy，不产生成功终态", async () => {
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
  const during = lastRecords(rig);
  assert.deepEqual(during.at(-1), { seq: 2, generation: 1, state: "busy" });
  assert.deepEqual(rig.toasts, ["busy"]);
  assert.equal(barrier.generation(), 1, "被拒的触发不得增加代次");

  gate.resolve(true);
  assert.equal(await running, true);
  const after = lastRecords(rig);
  assert.deepEqual(after.slice(-2), [
    { seq: 2, generation: 1, state: "busy" },
    { seq: 3, generation: 1, state: "ok" },
  ]);
  assert.deepEqual(rig.toasts, ["busy", "success"], "成功 toast 只属于第一次操作");
});

test("代次单调：每次成功触发的日志追加新代次的 running / ok（验收通道据此拒绝旧信号）", async () => {
  const rig = createRig();
  const barrier = createSaveAllBarrier(rig.deps);
  await barrier.run();
  await barrier.run();
  const records = lastRecords(rig);
  const genOfOk = records.filter((record) => record.state === "ok").map((record) => record.generation);
  assert.deepEqual(genOfOk, [1, 2]);
  assert.equal(barrier.generation(), 2);
  // seq 连续：任何一条记录都不会被后来的 ok 覆盖/复用。
  assert.deepEqual(
    records.map((record) => record.seq),
    [0, 1, 2, 3, 4],
  );
});

test("日志容量有界：真实 run() 超过 cap=12 后滚动，seq 连续且最后一组 running→ok 仍可归属", async () => {
  // K3 最新 verdict：不能只格式化手工记录——必须让屏障真实跑过 cap，验证滚动后的形状与归属。
  assert.equal(SAVE_ALL_LOG_LIMIT, 12);
  const rig = createRig();
  const barrier = createSaveAllBarrier(rig.deps);
  for (let i = 0; i < 6; i++) {
    assert.equal(await barrier.run(), true, `第 ${i + 1} 次 run 必须成功`);
  }
  assert.equal(barrier.generation(), 6);

  // 初始 idle + 6 × (running + ok) = 13 条 → 滚动掉最早一条，剩 seq 1..12。
  const records = lastRecords(rig);
  assert.equal(records.length, SAVE_ALL_LOG_LIMIT);
  assert.deepEqual(
    records.map((record) => record.seq),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    "seq 必须连续（滚动只从头部丢弃，不重编号）",
  );
  assert.deepEqual(records.slice(-2), [
    { seq: 11, generation: 6, state: "running" },
    { seq: 12, generation: 6, state: "ok" },
  ]);

  // 滚动后仍可归属：基线取最后一次 run 之前的那条记录（s10/g5 ok），
  // 新日志里的 s11 running g6 → s12 ok g6 是一次快速完成，必须被验收通道接受。
  const baseline = records[records.length - 3];
  assert.deepEqual(baseline, { seq: 10, generation: 5, state: "ok" });
  const logText = rig.logs.at(-1)!;
  const ax = `- app: X\n- pid: 1\n\`\`\`\n- [7] AXStaticText = "${logText}"\n\`\`\``;
  // @ts-expect-error 验收侧 .mjs 无类型声明；跨层运行期对账见 installed-app.test.mjs
  const { waitSaveAllCompletion } = await import("../../scripts/acceptance/lib/installed-app.mjs");
  const result = await waitSaveAllCompletion({
    pid: 1,
    readState: async () => ax,
    baselineSeq: baseline.seq,
    baselineGeneration: baseline.generation,
  });
  assert.deepEqual(result, { generation: 6, seq: 12, reads: 1 });
});
