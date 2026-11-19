// harness 异步事件 / 任务生命周期的对抗测试（M845）：零 DOM，只驱动 src 导出的纯函数与
// 草稿持久化控制器（与 tests/unit/README.md 的分层口径一致）。
//
// 归属 oracle（生产既有不变量，不为测试放宽）：
//   - **vault 归属**：`inCurrentVault` 逐字节比较、fail-closed；载荷不带 vault 按「归属未知」
//     放行，当前 vault 未知而载荷带标识一律丢弃。
//   - **轮次归属**：`reduceSendPhase` / `reduceActivity` 的相位机——忙时重复 sent 不前移、
//     停止只从 running 进入 stopping、终态幂等收口；快照只在不陈旧且不在 stopping 时回填。
//   - **任务归属**：`reduceSubruns` 的未知 run 一律忽略（迟到的 finished / progress 不得凭空
//     造行）；终态后迟到的批准不得把行翻回 waiting；重复终态不得把读数累加两遍。
//   - **草稿归属**：发送成功后的 clear 必须排在在途写之后（删除不能被 rename 压过、已发送
//     内容不得复活成草稿）；写失败不得谎报已保存。
//
// 反向验证（REVIEW.md「断言等价于子串」条）：每个归属判据都配一条 **mutant 反证**——用
// 「去掉防线」的朴素实现跑同一输入，断言它产出非法状态，而生产实现不产出。mutant 在测试内
// 就地定义（不复制生产代码，只表达被去掉的那一条防线），因此反证与生产断言共用同一输入。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachRunApproval,
  detachRunApproval,
  inCurrentVault,
  isLiveSubrun,
  reduceSendPhase,
  reduceSubruns,
} from "../../src/harness-panel.ts";
import type { SubrunView } from "../../src/harness-panel.ts";
import {
  enterSnapshotApplies,
  INITIAL_ACTIVITY,
  reduceActivity,
} from "../../src/harness-activity.ts";
import type { ActivityState } from "../../src/harness-activity.ts";
import { parseHarnessEvent } from "../../src/ipc.ts";
import { createHarnessDraftStore } from "../../src/harness-draft.ts";

// ---------------------------------------------------------------------------
// vault 归属
// ---------------------------------------------------------------------------

test("inCurrentVault：逐字节比较 + fail-closed（未知当前 vault 丢弃带标识载荷）", () => {
  const vaultA = "/tmp/lumir-vault-a";
  const vaultB = "/tmp/lumir-vault-b";
  assert.equal(inCurrentVault(vaultA, vaultA), true);
  assert.equal(inCurrentVault(vaultA, vaultB), false);
  // 缺标识 = 归属未知：放行（桩环境与早期载荷形态）。
  assert.equal(inCurrentVault(undefined, vaultA), true);
  assert.equal(inCurrentVault(undefined, null), true);
  // 当前 vault 未知 + 载荷带标识：宁可不显示也不错显（误显示 = 在 B 提问却看到 A 的回答）。
  assert.equal(inCurrentVault(vaultA, null), false);
  // 非字符串标识按「未知」放行，不得当成匹配。
  assert.equal(inCurrentVault(42, vaultA), true);
});

test("mutant 反证：把 fail-closed 换成 fail-open，未知 vault 就会串台", () => {
  const failOpen = (payloadVault: unknown, current: string | null): boolean =>
    typeof payloadVault !== "string" || current === null || payloadVault === current;
  const current = null;
  assert.equal(failOpen("/tmp/vault-a", current), true, "mutant 放行了未知 vault 的载荷");
  assert.equal(inCurrentVault("/tmp/vault-a", current), false, "生产实现必须丢弃");
});

// ---------------------------------------------------------------------------
// 事件准入（白名单 / 宽容解析）
// ---------------------------------------------------------------------------

test("parseHarnessEvent：未知 type / 坏 JSON / 非对象一律丢弃，信封字段原样保留", () => {
  assert.equal(parseHarnessEvent({ type: "not_a_harness_event" }), null);
  assert.equal(parseHarnessEvent("{not json"), null);
  assert.equal(parseHarnessEvent(null), null);
  assert.equal(parseHarnessEvent(42), null);
  // 字符串载荷（旧通道）经 JSON.parse 后照常准入。
  const fromString = parseHarnessEvent('{"type":"done","vault":"/tmp/vault-a"}');
  assert.equal(fromString?.type, "done");
  // vault 是逐字节比较的归属字段：解析不得改写 / 归一化。
  const event = parseHarnessEvent({
    type: "text_chunk",
    text: "增量",
    vault: "/tmp/vault-a/",
  });
  assert.equal((event as { vault?: string } | null)?.vault, "/tmp/vault-a/");
});

// ---------------------------------------------------------------------------
// 发送相位：非法转移不产生非法状态
// ---------------------------------------------------------------------------

test("reduceSendPhase：忙时重复 sent 不前移、停止只从 running 进入、终态幂等", () => {
  assert.equal(reduceSendPhase("idle", { type: "sent" }), "running");
  assert.equal(reduceSendPhase("running", { type: "sent" }), "running", "重复发送不前移");
  assert.equal(reduceSendPhase("stopping", { type: "sent" }), "stopping");
  assert.equal(reduceSendPhase("idle", { type: "stop-clicked" }), "idle", "空闲时停止是空操作");
  assert.equal(reduceSendPhase("running", { type: "stop-clicked" }), "stopping");
  assert.equal(reduceSendPhase("stopping", { type: "stop-clicked" }), "stopping", "连点幂等");
  assert.equal(reduceSendPhase("stopping", { type: "finished" }), "idle");
  assert.equal(reduceSendPhase("idle", { type: "finished" }), "idle", "重复终态幂等");
});

test("mutant 反证：去掉 stopping 的连点闸，第二次停止会把相位再推进一次", () => {
  const mutant = (phase: string, event: { type: string }): string => {
    if (event.type === "sent") return "running";
    if (event.type === "stop-clicked") return "stopping";
    return "idle";
  };
  // mutant 对 sent 无条件置 running：stopping 中被重复发送打回在途（生产实现不前移）。
  assert.equal(mutant("stopping", { type: "sent" }), "running");
  assert.equal(reduceSendPhase("stopping", { type: "sent" }), "stopping");
});

// ---------------------------------------------------------------------------
// 活动 / 未读：终态与快照的时序对抗
// ---------------------------------------------------------------------------

const running = (): ActivityState => ({ phase: "running", unread: null });

test("reduceActivity：终态只由一轮产生一次，重复终态不改变结果", () => {
  const stopped = reduceActivity(running(), { type: "stop_clicked" });
  assert.equal(stopped.phase, "stopping");
  const once = reduceActivity(stopped, { type: "terminal", kind: "aborted", mounted: true });
  assert.equal(once.phase, "idle");
  assert.equal(once.unread, null, "aborted 是用户自己按的，不点未读");
  const twice = reduceActivity(once, { type: "terminal", kind: "done", mounted: false });
  assert.equal(twice.phase, "idle", "重复终态不得把相位翻回在途");
  assert.equal(twice.unread, "reply", "未读按当次终态分档，不累计");
});

test("reduceActivity：面板不在屏幕上时 done/error 点亮未读，mounted 时清空；aborted 不产生未读", () => {
  const hiddenDone = reduceActivity(running(), { type: "terminal", kind: "done", mounted: false });
  assert.equal(hiddenDone.unread, "reply");
  const hiddenError = reduceActivity(running(), { type: "terminal", kind: "error", mounted: false });
  assert.equal(hiddenError.unread, "failure");
  const hiddenAborted = reduceActivity(
    { phase: "stopping", unread: null },
    { type: "terminal", kind: "aborted", mounted: false },
  );
  assert.equal(hiddenAborted.unread, null);
  const shown = reduceActivity({ phase: "running", unread: "reply" }, {
    type: "terminal",
    kind: "done",
    mounted: true,
  });
  assert.equal(shown.unread, null, "面板在场 = 已读");
  // 挂载是已读清算的唯一入口。
  assert.equal(reduceActivity({ phase: "idle", unread: "failure" }, { type: "opened" }).unread, null);
  // 切会话 / 切 vault 的视图复位：相位收口、未读清空（旧 vault 那一轮的终态可能永远不会到）。
  assert.deepEqual(
    reduceActivity({ phase: "stopping", unread: "failure" }, { type: "vault_changed" }),
    { phase: "idle", unread: null },
  );
});

test("enterSnapshotApplies：陈旧世代与 stopping 中的快照都不得回填相位", () => {
  const fresh = { type: "enter_snapshot" as const, inFlight: false, epochAtRequest: 3, epoch: 3 };
  assert.equal(enterSnapshotApplies({ phase: "running", unread: null }, fresh), true);
  assert.equal(
    enterSnapshotApplies({ phase: "running", unread: null }, { ...fresh, epochAtRequest: 2 }),
    false,
    "世代不一致 = 请求途中相位已变，回填会复活旧状态",
  );
  assert.equal(
    enterSnapshotApplies({ phase: "stopping", unread: null }, fresh),
    false,
    "stopping 只由终态收口，快照不得改回 running 也不得提前收口",
  );
  // 被丢弃的快照不碰未读，也不改变相位。
  const kept = reduceActivity(
    { phase: "stopping", unread: "reply" },
    { ...fresh, epochAtRequest: 1 },
  );
  assert.deepEqual(kept, { phase: "stopping", unread: "reply" });
});

test("mutant 反证：去掉 stopping 守卫，快照会把已请求停止的相位翻回运行中", () => {
  const mutantEnter = (state: ActivityState, inFlight: boolean): ActivityState => ({
    phase: inFlight ? "running" : "idle",
    unread: state.unread,
  });
  assert.equal(mutantEnter({ phase: "stopping", unread: null }, true).phase, "running");
  assert.equal(
    enterSnapshotApplies({ phase: "stopping", unread: null }, {
      type: "enter_snapshot",
      inFlight: true,
      epochAtRequest: 0,
      epoch: 0,
    }),
    false,
  );
});

// ---------------------------------------------------------------------------
// 子任务归约：未知 run / 乱序 / 重复终态
// ---------------------------------------------------------------------------

function started(runId: string, segment = 1): SubrunView[] {
  return reduceSubruns([], {
    type: "subagent_started",
    run_id: runId,
    segment,
    agent: "research",
    description: "梳理变更",
    model: "mock-fast",
    background: false,
    call_id: `call-${runId}`,
  } as Parameters<typeof reduceSubruns>[1]);
}

const finished = (runId: string, rounds = 2, input = 100, output = 10) =>
  ({
    type: "subagent_finished",
    run_id: runId,
    segment: 1,
    agent: "research",
    status: "completed",
    rounds,
    model: "mock-fast",
    input_tokens: input,
    cached_tokens: 0,
    output_tokens: output,
    denied_calls: 0,
    duration_ms: 900,
    summary_chars: 8,
    summary: "已完成",
  }) as Parameters<typeof reduceSubruns>[1];

test("reduceSubruns：未知 run 的 finished / progress / step 一律忽略（不凭空造行）", () => {
  assert.deepEqual(reduceSubruns([], finished("ghost")), []);
  assert.deepEqual(
    reduceSubruns([], {
      type: "subagent_progress",
      run_id: "ghost",
      segment: 1,
      rounds: 5,
      tool_calls: 2,
      last_tool: "vault_read",
      elapsed_ms: 1000,
    } as Parameters<typeof reduceSubruns>[1]),
    [],
  );
  assert.deepEqual(
    reduceSubruns([], {
      type: "subagent_step",
      run_id: "ghost",
      segment: 1,
      tool: "vault_read",
      summary: "读文件",
    } as Parameters<typeof reduceSubruns>[1]),
    [],
  );
});

test("mutant 反证：去掉未知 run 丢弃，迟到的 finished 会建出一行幽灵终态", () => {
  const mutant = (runs: SubrunView[], event: { type: string; run_id: string }): SubrunView[] =>
    event.type === "subagent_finished"
      ? [
          ...runs,
          {
            ...started(event.run_id)[0]!,
            status: "done",
          },
        ]
      : runs;
  assert.equal(mutant([], { type: "subagent_finished", run_id: "ghost" }).length, 1);
  assert.equal(reduceSubruns([], finished("ghost")).length, 0);
});

test("reduceSubruns：重复终态按「段基线 + 本段读数」重算，不把读数累加两遍", () => {
  let runs = started("r1");
  runs = reduceSubruns(runs, finished("r1", 2, 100, 10));
  assert.equal(runs[0]?.status, "done");
  assert.equal(runs[0]?.rounds, 2);
  const again = reduceSubruns(runs, finished("r1", 2, 100, 10));
  assert.equal(again[0]?.rounds, 2, "同一终态重复到达不得累加成 4");
  assert.equal(again[0]?.inputTokens, 100, "token 读数同样不得翻倍");
});

test("mutant 反证：把终态读数写成 run.rounds + event.rounds，重复事件就翻倍", () => {
  const mutant = (run: SubrunView, event: { rounds: number }): SubrunView => ({
    ...run,
    rounds: run.rounds + event.rounds,
  });
  const run = reduceSubruns(started("r1"), finished("r1", 2))[0]!;
  assert.equal(mutant(mutant(run, { rounds: 2 }), { rounds: 2 }).rounds, 6);
  assert.equal(
    reduceSubruns(reduceSubruns(started("r1"), finished("r1", 2)), finished("r1", 2))[0]?.rounds,
    2,
  );
});

test("乱序：终态之后到达的批准不得把行翻回 waiting，收回不存在的批准是空操作", () => {
  const done = reduceSubruns(started("r1"), finished("r1"));
  assert.equal(isLiveSubrun(done[0]!), false);
  const stuck = attachRunApproval(done, "r1", "ap-old");
  assert.equal(stuck[0]?.status, "done", "已收尾的 run 不得被迟到批准复活成等待");
  assert.deepEqual(stuck[0]?.approvalIds, []);

  const live = attachRunApproval(started("r2"), "r2", "ap-1");
  assert.equal(live[0]?.status, "waiting");
  // 同一批准重复到达不重复关联 id。
  const dup = attachRunApproval(live, "r2", "ap-1");
  assert.deepEqual(dup[0]?.approvalIds, ["ap-1"]);
  // 收回：最后一个待批项消失 → 回到运行中；未知 id 不动行。
  assert.equal(detachRunApproval(dup, "ap-1")[0]?.status, "running");
  assert.deepEqual(detachRunApproval(dup, "ap-unknown"), dup);
});

test("乱序：同 run 的第二段 started 是 resume（保留累计读数、段数 +1），不是第二行", () => {
  let runs = reduceSubruns(started("r1"), finished("r1", 2, 100, 10));
  runs = reduceSubruns(runs, {
    type: "subagent_started",
    run_id: "r1",
    segment: 2,
    agent: "research",
    description: "继续",
    model: "mock-fast",
    background: true,
    call_id: "call-r1-b",
  } as Parameters<typeof reduceSubruns>[1]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.segments, 2);
  assert.equal(runs[0]?.status, "running");
  assert.equal(runs[0]?.segmentBase?.rounds, 2, "上一段读数进段基线，不丢");
  assert.equal(runs[0]?.stoppedBy, null, "上一段的触顶原因不得延续到新段");
});

// ---------------------------------------------------------------------------
// 草稿：clear 与在途写的次序（已发送内容不得复活）
// ---------------------------------------------------------------------------

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (e: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("草稿：发送成功后的 clear 排在在途写之后，删除后不再回写已发送内容", async () => {
  const writes: string[] = [];
  const firstWrite = deferred<void>();
  let calls = 0;
  const store = createHarnessDraftStore({
    getDraft: async () => null,
    putDraft: (json) => {
      calls += 1;
      writes.push(json);
      return calls === 1 ? firstWrite.promise : Promise.resolve();
    },
    warn: () => {},
    debounceMs: 5,
  });

  store.schedule("已发送的内容", null, []);
  const flushing = store.flush();
  // 在途写还没落定就发生了「发送成功」：clear 必须排在这条写之后（先 rename 后 remove 会把
  // 已发送内容复活成草稿）。
  const clearing = store.clear();
  firstWrite.resolve();
  await flushing;
  await clearing;

  assert.equal(writes.length, 2, `应恰有「写一次 + 删一次」两条 mutation：${JSON.stringify(writes)}`);
  assert.notEqual(writes[0], "", "第一条是在途写");
  assert.equal(writes[1], "", "最后一条 mutation 必须是删除");
  // 删除之后再无回写：等过防抖窗口，写入次数不变。
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(writes.length, 2, "清除之后不得再回写已发送内容");
});

test("草稿：写失败不谎报已保存——待写留在槽里，下一次 flush 重写同一份内容", async () => {
  const writes: string[] = [];
  let fail = true;
  const warnings: unknown[] = [];
  const store = createHarnessDraftStore({
    getDraft: async () => null,
    putDraft: (json) => {
      writes.push(json);
      if (fail) return Promise.reject(new Error("disk full"));
      return Promise.resolve();
    },
    warn: (error) => void warnings.push(error),
    debounceMs: 5,
  });

  store.schedule("未落盘的字", null, []);
  await store.flush();
  assert.equal(writes.length, 1);
  assert.equal(warnings.length, 1, "写失败要降级提示");
  fail = false;
  await store.flush();
  assert.equal(writes.length, 2, "失败的内容必须仍在待写槽，下一次 flush 重试");
  assert.equal(writes[1], writes[0], "重写的是同一份内容，不丢字");
});

test("草稿：切 vault 的 discard 丢弃待写，旧 vault 的内容不会写进新 vault", async () => {
  const writes: string[] = [];
  const store = createHarnessDraftStore({
    getDraft: async () => null,
    putDraft: (json) => {
      writes.push(json);
      return Promise.resolve();
    },
    warn: () => {},
    debounceMs: 5,
  });
  store.schedule("旧 vault 的待写", null, []);
  store.discard();
  await store.flush();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(writes, [], "discard 之后不得把旧 vault 的待写落盘");
});
