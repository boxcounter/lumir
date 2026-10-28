// 活动在场状态机的纯模型回归（change add-harness-activity-presence tasks 5.1 / 5.2a / 5.2b）。
//
// 判据一律落在 `reduceActivity` 的返回值上——零 DOM，因此 `createHarnessPanel` 不需要替身
// （与 `tests/unit/harness-panel-control.test.ts` 对 `reduceSendPhase` 的分层相同）。
//
// 三条设计约束由断言直接钉住（design §3 / r1–r3 评审）：
//   1. **相位逐条委托**既有 `reduceSendPhase`——第 5 组的等值断言在「新模块自算相位」时分叉必红；
//   2. **没有终态记忆**、**没有「拒绝 ⇒ running」**——矩阵第 1 / 2 / 3 / 10 / 11 行是它们的反例；
//   3. 对账快照（内容档位）**不进**本模型——矩阵第 8 行断言模型里没有这条输入，接线层由
//      `harness-activity-wiring.test.ts` 的源码对账守卫。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  enterSnapshotApplies,
  INITIAL_ACTIVITY,
  reduceActivity,
} from "../../src/harness-activity.ts";
import type { ActivityEvent, ActivityState } from "../../src/harness-activity.ts";
import { reduceSendPhase } from "../../src/harness-panel.ts";

/** 进入快照的便捷构造：`epoch` 一致（真实现场里「请求与响应同代」的常态）。 */
function enter(inFlight: boolean, epoch = 0): ActivityEvent {
  return { type: "enter_snapshot", inFlight, epochAtRequest: epoch, epoch };
}

function terminal(kind: "done" | "error" | "aborted", mounted: boolean): ActivityEvent {
  return { type: "terminal", kind, mounted };
}

/** 依序喂事件（每步断言只关心终态，中间态由调用方自行断言）。 */
function run(state: ActivityState, events: readonly ActivityEvent[]): ActivityState {
  return events.reduce(reduceActivity, state);
}

// ── 1. 发送 / 自动回合：相位入 running，未读不动 ─────────────────────────────

test("sent：idle → running（新轮开始），未读不动", () => {
  assert.deepEqual(reduceActivity(INITIAL_ACTIVITY, { type: "sent" }), {
    phase: "running",
    unread: null,
  });
  const unread = { phase: "idle" as const, unread: "reply" as const };
  assert.deepEqual(reduceActivity(unread, { type: "sent" }), {
    phase: "running",
    unread: "reply",
  });
});

test("auto_turn_started：与 sent 同一条转移（自动回合在有没有新内容上等价）", () => {
  assert.deepEqual(
    reduceActivity(INITIAL_ACTIVITY, { type: "auto_turn_started" }),
    reduceActivity(INITIAL_ACTIVITY, { type: "sent" }),
  );
  assert.equal(
    reduceActivity({ phase: "running", unread: null }, { type: "auto_turn_started" }).phase,
    "running",
  );
});

// ── 2. 终态：收口回 idle + 未读按（种类 × 是否在屏幕上）分档 ────────────────

test("terminal(done, mounted=false)：棋盘收起期间正常结束 ⇒ 未读 = 回复", () => {
  const state = reduceActivity({ phase: "running", unread: null }, terminal("done", false));
  assert.deepEqual(state, { phase: "idle", unread: "reply" });
});

test("terminal(error, mounted=false)：收起期间错误终态 ⇒ 未读 = 失败（D2 分档）", () => {
  const state = reduceActivity({ phase: "running", unread: null }, terminal("error", false));
  assert.deepEqual(state, { phase: "idle", unread: "failure" });
});

test("terminal(aborted, mounted=false)：用户主动停止不产生未读（D2）", () => {
  const state = reduceActivity({ phase: "running", unread: null }, terminal("aborted", false));
  assert.deepEqual(state, { phase: "idle", unread: null });
});

test("terminal(任意, mounted=true)：结果就在屏幕上 ⇒ 未读清空", () => {
  for (const kind of ["done", "error", "aborted"] as const) {
    assert.deepEqual(
      reduceActivity({ phase: "running", unread: "reply" }, terminal(kind, true)),
      { phase: "idle", unread: null },
      `mounted 时 ${kind} 必须清未读`,
    );
  }
});

test("terminal(aborted, mounted=false)：此前已有的未读不被 aborted 清掉（只由 opened 清）", () => {
  assert.deepEqual(
    reduceActivity({ phase: "running", unread: "failure" }, terminal("aborted", false)),
    { phase: "idle", unread: "failure" },
  );
});

test("未读不累计：同一会话的第二个终态仍只有一枚标记（取最新档位）", () => {
  let state = run(INITIAL_ACTIVITY, [
    { type: "sent" },
    terminal("done", false),
    { type: "auto_turn_started" },
    terminal("error", false),
  ]);
  assert.deepEqual(state, { phase: "idle", unread: "failure" }, "两轮终态只留一枚标记，且是最新档");
  state = run(state, [{ type: "sent" }, terminal("done", false)]);
  assert.deepEqual(state, { phase: "idle", unread: "reply" });
});

// ── 3. opened / vault_changed：两条不同的清算口径 ──────────────────────────

test("opened：清未读、相位不动（打开面板 = 已读）", () => {
  assert.deepEqual(
    reduceActivity({ phase: "idle", unread: "reply" }, { type: "opened" }),
    { phase: "idle", unread: null },
  );
  // 仍在途时打开面板：相位保持 running（该轮若仍在跑则呈在途），只是未读被清算。
  assert.deepEqual(
    reduceActivity({ phase: "running", unread: "failure" }, { type: "opened" }),
    { phase: "running", unread: null },
  );
});

test("vault_changed：视图复位——相位收口回 idle、未读清空（跨 vault 未读不做，D3）", () => {
  assert.deepEqual(
    reduceActivity({ phase: "running", unread: "reply" }, { type: "vault_changed" }),
    { phase: "idle", unread: null },
  );
  assert.deepEqual(
    reduceActivity({ phase: "stopping", unread: null }, { type: "vault_changed" }),
    { phase: "idle", unread: null },
  );
});

// ── 4. 进入快照：只按后端呈现读回填，且受世代 / stopping 两道闸约束 ────────

test("enter_snapshot(inFlight=true)：相位回填 running（切回仍在跑的轮次）", () => {
  assert.deepEqual(reduceActivity({ phase: "idle", unread: null }, enter(true)), {
    phase: "running",
    unread: null,
  });
});

test("enter_snapshot(inFlight=false)：相位收口 idle（离开期间终态被过滤的收口路径）", () => {
  assert.deepEqual(reduceActivity({ phase: "running", unread: null }, enter(false)), {
    phase: "idle",
    unread: null,
  });
});

test("enter_snapshot：epoch 不一致 ⇒ 模型不应用该事件（相位不动，响应来自发送之前）", () => {
  // 纯模型只管相位 / 未读：这里断言的是「不应用」；接线层的过期处置按档位分开——进入档只丢相位
  // （消息 / 读数照旧应用），只内容档整条丢弃（见 design §4 与 `restoreSnapshot` 的注释）。
  const stale: ActivityEvent = { type: "enter_snapshot", inFlight: false, epochAtRequest: 1, epoch: 2 };
  const state = { phase: "running" as const, unread: null };
  assert.equal(reduceActivity(state, stale), state, "旧世代快照不得把刚起的 running 打回 idle");
  assert.equal(enterSnapshotApplies(state, stale as never), false);
  assert.equal(enterSnapshotApplies(state, enter(true, 2) as never), true);
});

test("enter_snapshot：stopping 中两种 in_flight 都保持 stopping（由终态收口）", () => {
  const stopping = { phase: "stopping" as const, unread: null };
  assert.deepEqual(reduceActivity(stopping, enter(true)), stopping);
  assert.deepEqual(reduceActivity(stopping, enter(false)), stopping);
  assert.equal(enterSnapshotApplies(stopping, enter(true) as never), false);
});

test("enter_snapshot：不动未读（未读只由终态产生、由 opened / vault_changed 清）", () => {
  assert.deepEqual(reduceActivity({ phase: "idle", unread: "failure" }, enter(false)), {
    phase: "idle",
    unread: "failure",
  });
});

// ── 5. 委托而非重写：每个相位输出都与 reduceSendPhase 的同事件输出相等 ──────

test("相位委托：sent / auto_turn_started / stop_clicked / terminal / local_finish 与 reduceSendPhase 等值", () => {
  const phases = ["idle", "running", "stopping"] as const;
  const cases: Array<{ event: ActivityEvent; send: "sent" | "stop-clicked" | "finished" }> = [
    { event: { type: "sent" }, send: "sent" },
    { event: { type: "auto_turn_started" }, send: "sent" },
    { event: { type: "stop_clicked" }, send: "stop-clicked" },
    { event: terminal("done", true), send: "finished" },
    { event: terminal("error", false), send: "finished" },
    { event: terminal("aborted", false), send: "finished" },
    { event: { type: "local_finish" }, send: "finished" },
  ];
  for (const phase of phases) {
    for (const item of cases) {
      assert.equal(
        reduceActivity({ phase, unread: null }, item.event).phase,
        reduceSendPhase(phase, { type: item.send } as never),
        `${item.event.type} 在 ${phase} 上的相位必须等于 reduceSendPhase 的同事件输出`,
      );
    }
  }
});

// ── 6. 停止全表（r1 P2-2 确定性回归，保持不变）─────────────────────────────

test("stop_clicked 全表：idle 无操作 / running → stopping / stopping 幂等", () => {
  assert.equal(reduceActivity({ phase: "idle", unread: null }, { type: "stop_clicked" }).phase, "idle");
  assert.equal(
    reduceActivity({ phase: "running", unread: null }, { type: "stop_clicked" }).phase,
    "stopping",
  );
  assert.equal(
    reduceActivity({ phase: "stopping", unread: null }, { type: "stop_clicked" }).phase,
    "stopping",
  );
});

test("stopping + terminal(done) ⇒ idle；stopping + enter_snapshot ⇒ 保持 stopping", () => {
  assert.deepEqual(reduceActivity({ phase: "stopping", unread: null }, terminal("done", true)), {
    phase: "idle",
    unread: null,
  });
  const stopping = { phase: "stopping" as const, unread: null };
  assert.deepEqual(reduceActivity(stopping, enter(true)), stopping);
  assert.deepEqual(reduceActivity(stopping, enter(false)), stopping);
});

// ── 7. 新轮 / 旧轮交错矩阵（design §10 的 11 行，逐行一条断言）──────────────
//
// 每条断言都写明「实现改成直接改相位 / 靠本地终态记忆 / 保留 busy_rejected 时它必红」——
// 这是 r2 / r3 两次 P2-1 的现场口径：旧轮与「终态已发、尚未释放」的窗口靠本模型分不出来。

test("矩阵 1：旧轮 done（已观察）→ 进入快照 in_flight:false ⇒ idle + 未读保持 reply", () => {
  const state = run(INITIAL_ACTIVITY, [{ type: "sent" }, terminal("done", false), enter(false)]);
  assert.deepEqual(state, { phase: "idle", unread: "reply" });
  // 靠本地终态记忆来「抑制复活」的实现会在这里清掉未读或重开 running。
});

test("矩阵 2：旧轮 done（已观察）→ harness_busy 拒绝 ⇒ 不复活（模型里没有这条转移）", () => {
  const afterDone = run(INITIAL_ACTIVITY, [{ type: "sent" }, terminal("done", false)]);
  // 拒绝在本模型里**没有**对应事件：唯一合法的处置是重取快照（矩阵 1 的 enter 路径）。
  // 若有人加回 `busy_rejected ⇒ running`，下面这条断言不会红，但接线层的源码断言会
  // （tests/unit/harness-activity-wiring.test.ts 的「拒绝不改相位」条）。
  assert.deepEqual(afterDone, { phase: "idle", unread: "reply" });
  // 用户随后重试成功：sent 正常推进（窗口结束后可发送）。
  assert.deepEqual(reduceActivity(afterDone, { type: "sent" }), {
    phase: "running",
    unread: "reply",
  });
});

test("矩阵 3：离开期间终态被过滤 → 切回进入快照 in_flight:false ⇒ idle，不伪造未读", () => {
  const state = run(INITIAL_ACTIVITY, [{ type: "sent" }, enter(false)]);
  assert.deepEqual(state, { phase: "idle", unread: null }, "未观察到的终态不得伪造档位");
});

test("矩阵 4：旧轮已结束 → 新轮已在途 → 进入快照 in_flight:true ⇒ running", () => {
  const state = run(INITIAL_ACTIVITY, [{ type: "sent" }, terminal("done", true), enter(true)]);
  assert.deepEqual(state, { phase: "running", unread: null });
  // Finishing 窗口已被 in_flight 排除，因此这条不是「复活」。
});

test("矩阵 5：旧轮仍在途 → 进入快照 in_flight:true ⇒ running（后续增量继续上屏）", () => {
  assert.equal(
    run(INITIAL_ACTIVITY, [{ type: "sent" }, enter(true)]).phase,
    "running",
  );
});

test("矩阵 6：新轮已 sent（本地 running）→ 旧世代快照 ⇒ 丢弃相位，保持 running", () => {
  const state = { phase: "running" as const, unread: null };
  const stale: ActivityEvent = { type: "enter_snapshot", inFlight: false, epochAtRequest: 0, epoch: 1 };
  assert.equal(reduceActivity(state, stale), state);
});

test("矩阵 7：stopping 中收到进入快照（两种 in_flight）⇒ 保持 stopping", () => {
  const stopping = { phase: "stopping" as const, unread: null };
  assert.deepEqual(reduceActivity(stopping, enter(true)), stopping);
  assert.deepEqual(reduceActivity(stopping, enter(false)), stopping);
});

test("矩阵 8：终态对账（内容档位）不进本模型 ⇒ 相位 / 未读一律不动", () => {
  // 模型层的形式化表达：唯一能让终态「再动一次」的输入是 enter_snapshot，而对账路径
  // MUST NOT 把快照喂进来。这里断言「同一份终态重复喂入是幂等的」，接线层另由源码断言钉住。
  const afterTerminal = run(INITIAL_ACTIVITY, [{ type: "sent" }, terminal("done", false)]);
  assert.deepEqual(afterTerminal, { phase: "idle", unread: "reply" });
  assert.deepEqual(
    reduceActivity(afterTerminal, { type: "local_finish" }),
    { phase: "idle", unread: "reply" },
    "收口类输入不得改未读",
  );
});

test("矩阵 9：两轮连续终态（第二个是自动回合）⇒ 未读仍只一枚标记", () => {
  const state = run(INITIAL_ACTIVITY, [
    { type: "sent" },
    terminal("done", false),
    { type: "auto_turn_started" },
    terminal("done", false),
  ]);
  assert.deepEqual(state, { phase: "idle", unread: "reply" });
});

test("矩阵 10：终态 → 心跳式重复进入快照（同 vault 重复装载）⇒ 幂等 idle", () => {
  const once = run(INITIAL_ACTIVITY, [{ type: "sent" }, terminal("done", true), enter(false)]);
  const twice = run(once, [enter(false), enter(false), enter(false)]);
  assert.deepEqual(twice, { phase: "idle", unread: null });
  assert.deepEqual(twice, once);
});

test("矩阵 11：自动回合在配置错误 / panic 上结束（释放前）→ 进入快照 ⇒ idle", () => {
  // 自动回合先把相位置 running（`auto_turn_started`），失败终态未观察（事件被过滤）时
  // 只能靠后端的 in_flight 收口——MUST NOT 停在处理中。
  const state = run(INITIAL_ACTIVITY, [{ type: "auto_turn_started" }, enter(false)]);
  assert.deepEqual(state, { phase: "idle", unread: null });
});

// ── 8. 本地收口：这一轮没有起来（发送未受理 / 停止请求被拒）────────────────

test("local_finish：相位回 idle、未读不动（不是一轮内容的结束）", () => {
  assert.deepEqual(reduceActivity({ phase: "running", unread: "reply" }, { type: "local_finish" }), {
    phase: "idle",
    unread: "reply",
  });
  assert.deepEqual(reduceActivity({ phase: "stopping", unread: null }, { type: "local_finish" }), {
    phase: "idle",
    unread: null,
  });
});
