// 按 vault 键控的活动 store（change extend-harness-activity-across-vaults-nov23 tasks 1.1 /
// design §3.1 / §14.2）的纯模型回归。
//
// 判据一律落在 `createVaultActivityStore()` 的读与通知上——零 DOM；`createHarnessPanel` 在
// 本层跑不起（见 tests/unit/README.md），接线层由 `harness-activity-wiring.test.ts` 的结构
// 对账 + `tests/visual/scenes/harness-vault-activity*.spec.ts` 的 deferred 行为竞态守卫。
//
// 这一层要钉住的不变量（design §2.2）：
//   1. **单一生产者**：未读只由终态产生；`aborted` 不清既有未读；
//   2. **单一状态机**：每条相位跃迁都与 `reduceSendPhase` 的输出逐条相等；
//   3. **无第二真源**：`of` 未知键不分配；没有通用 `retain` / 按注册表路径的清理 API；
//   4. **版本门**：`rollbackSend` 只撤销自己的乐观起点，不用陈旧快照覆盖真实转移。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INITIAL_ACTIVITY,
  activityDisplayed,
  activityKind,
  activityStatusKey,
  createVaultActivityStore,
  reduceActivity,
} from "../../src/harness-activity.ts";
import type { ActivityState, VaultActivityEvent } from "../../src/harness-activity.ts";
import { reduceSendPhase } from "../../src/harness-panel.ts";

const A = "/tmp/lumir-activity-a";
const B = "/tmp/lumir-activity-b";
const C = "/tmp/lumir-activity-c";

/** 无注释源码（断言「某机制已删除」时不能把文档里的点名当成实现）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ACTIVITY_CODE = stripComments(
  readFileSync(new URL("../../src/harness-activity.ts", import.meta.url), "utf8"),
);

function terminal(
  kind: "done" | "error" | "aborted",
  displayed: boolean,
): Extract<VaultActivityEvent, { type: "terminal" }> {
  return { type: "terminal", kind, displayed };
}

/** 计数订阅触发面：返回 (读数, 是否又在跃迁)。 */
function counter() {
  const store = createVaultActivityStore();
  let fired = 0;
  store.subscribe(() => {
    fired += 1;
  });
  return { store, fired: () => fired };
}

// ── 1. 按 vault 隔离：B 的终态不动 A 的记录 ────────────────────────────────

test("按 vault 隔离：B 的终态不改 A 的相位 / 未读", () => {
  const { store } = counter();
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(B, { type: "turn_started" });
  store.dispatch(A, terminal("done", false));
  assert.deepEqual(store.of(A), { phase: "idle", unread: "reply" });
  assert.deepEqual(store.of(B), { phase: "running", unread: null }, "B 仍在途，未被 A 的终态影响");

  store.dispatch(B, terminal("error", false));
  assert.deepEqual(store.of(A), { phase: "idle", unread: "reply" }, "A 的未读不因 B 的失败改档");
  assert.deepEqual(store.of(B), { phase: "idle", unread: "failure" });
});

// ── 2. 显示门：只有「该 vault 当前 + pane 在场」才清未读 ────────────────────

test("显示门：非当前 vault 的终态必置未读；当前但门假也置未读", () => {
  const { store } = counter();
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("done", false));
  assert.deepEqual(store.of(A), { phase: "idle", unread: "reply" });

  store.dispatch(B, { type: "turn_started" });
  store.dispatch(B, terminal("done", false));
  assert.equal(store.of(B).unread, "reply", "当前 vault 但 pane 不在场（门假）同样记未读");
});

test("显示门：displayed 只清该 vault 的未读、不动相位", () => {
  const { store } = counter();
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("done", false));
  store.dispatch(B, { type: "turn_started" });
  store.dispatch(B, terminal("done", false));
  store.dispatch(B, { type: "displayed" });
  assert.deepEqual(store.of(B), { phase: "idle", unread: null });
  assert.deepEqual(store.of(A), { phase: "idle", unread: "reply" }, "清 B 不得顺带清 A");
});

test("activityDisplayed：判据只有「是当前 vault 且 pane 在场」", () => {
  assert.equal(activityDisplayed(A, A, true), true);
  assert.equal(activityDisplayed(A, A, false), false);
  assert.equal(activityDisplayed(A, B, true), false);
  assert.equal(activityDisplayed(A, null, true), false);
});

// ── 3. aborted 不置未读、也不清既有未读 ─────────────────────────────────────

test("aborted：不产生未读；既有未读保持原档（不是清空、也不是改成失败）", () => {
  const { store } = counter();
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("aborted", false));
  assert.deepEqual(store.of(A), { phase: "idle", unread: null });

  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("done", false));
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("aborted", false));
  assert.deepEqual(store.of(A), { phase: "idle", unread: "reply" }, "停止不清既有未读");
});

// ── 4. done / error 分档 + 重复终态幂等 ────────────────────────────────────

test("done / error 分档；重复终态只留一枚标记（不计数、取最新档）", () => {
  const { store } = counter();
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("done", false));
  store.dispatch(A, terminal("done", false));
  assert.deepEqual(store.of(A), { phase: "idle", unread: "reply" });
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("error", false));
  store.dispatch(A, terminal("error", false));
  assert.deepEqual(store.of(A), { phase: "idle", unread: "failure" });
});

// ── 5. reset_view / drop / 未知键 ──────────────────────────────────────────

test("reset_view：只清目标 vault（其它 vault 的未读与相位原样）", () => {
  const { store } = counter();
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, terminal("done", false));
  store.dispatch(B, { type: "turn_started" });
  store.reset(A);
  assert.deepEqual(store.of(A), { phase: "idle", unread: null });
  assert.deepEqual(store.of(B), { phase: "running", unread: null }, "B 的在途不得被 A 的复位清掉");
});

test("drop：记录丢弃、读回初始；其它 vault 不受影响", () => {
  const { store } = counter();
  store.dispatch(A, terminal("done", false));
  store.dispatch(B, terminal("error", false));
  store.drop(A);
  assert.deepEqual(store.of(A), INITIAL_ACTIVITY);
  assert.deepEqual(store.of(B), { phase: "idle", unread: "failure" });
});

test("未知键：of 返回初始且不分配（事件风暴之外的读不会写表）", () => {
  const { store, fired } = counter();
  for (let i = 0; i < 20; i += 1) assert.deepEqual(store.of(`${C}-${i}`), INITIAL_ACTIVITY);
  assert.equal(fired(), 0, "只读不得触发通知");
  // 反向：真正发生跃迁时才建条目并通知。
  store.dispatch(C, { type: "turn_started" });
  assert.equal(store.of(C).phase, "running");
  assert.equal(fired(), 1);
});

test("没有通用 retain / 按注册表路径的周期性清理 API（design §9 明令禁止）", () => {
  assert.ok(!/retain/.test(ACTIVITY_CODE), "store 不得提供 retain：按 vault_list 的原值清理会误删当前标题状态");
  // 反向说明：源码里连 `path` 这个键名都不该出现——键是后端根路径串，不是注册表字段。
  assert.ok(!/\bpath\b/.test(ACTIVITY_CODE), "store 只认 vault 键，不读注册表 path 字段");
});

// ── 6. 相位逐条与 reduceSendPhase 等值（单一状态机）────────────────────────

test("相位委托：turn_started / stop_clicked / terminal / reset_view 逐条等于 reduceSendPhase", () => {
  const cases: Array<{ event: VaultActivityEvent; send: "sent" | "stop-clicked" | "finished" }> = [
    { event: { type: "turn_started" }, send: "sent" },
    { event: { type: "stop_clicked" }, send: "stop-clicked" },
    { event: terminal("done", true), send: "finished" },
    { event: terminal("error", false), send: "finished" },
    { event: terminal("aborted", false), send: "finished" },
    { event: { type: "reset_view" }, send: "finished" },
  ];
  for (const phase of ["idle", "running", "stopping"] as const) {
    for (const item of cases) {
      const { store } = counter();
      // 预热到目标相位：idle 不动；running 用 turn_started；stopping 用 stop_clicked。
      if (phase !== "idle") store.dispatch(A, { type: "turn_started" });
      if (phase === "stopping") store.dispatch(A, { type: "stop_clicked" });
      assert.equal(store.of(A).phase, phase);
      store.dispatch(A, item.event);
      assert.equal(
        store.of(A).phase,
        reduceSendPhase(phase, { type: item.send } as never),
        `${item.event.type} 在 ${phase} 上的相位必须等于 reduceSendPhase 的同事件输出`,
      );
    }
  }
});

test("enter_snapshot：只在 epoch 一致且不在 stopping 时回填（判据与模型同源）", () => {
  const { store } = counter();
  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, { type: "enter_snapshot", inFlight: false, epochAtRequest: 0, epoch: 1 });
  assert.equal(store.of(A).phase, "running", "旧世代快照不得把刚起的 running 打回 idle");
  store.dispatch(A, { type: "enter_snapshot", inFlight: false, epochAtRequest: 1, epoch: 1 });
  assert.deepEqual(store.of(A), { phase: "idle", unread: null });

  store.dispatch(A, { type: "turn_started" });
  store.dispatch(A, { type: "stop_clicked" });
  store.dispatch(A, { type: "enter_snapshot", inFlight: true, epochAtRequest: 2, epoch: 2 });
  assert.equal(store.of(A).phase, "stopping", "stopping 由终态收口，快照不得改回 running");
});

// ── 7. rollbackSend：版本门 ────────────────────────────────────────────────

test("rollbackSend：版本未变 ⇒ 恢复发送前状态（idle / running 两种起点），不产生未读", () => {
  const { store } = counter();
  const idleToken = store.beginSend(A);
  assert.deepEqual(store.of(A), { phase: "running", unread: null });
  assert.equal(store.rollbackSend(A, idleToken), true);
  assert.deepEqual(store.of(A), { phase: "idle", unread: null });

  store.dispatch(B, { type: "turn_started" });
  const runningToken = store.beginSend(B); // 忙时重复 sent 不前移
  assert.deepEqual(store.of(B), { phase: "running", unread: null });
  assert.equal(store.rollbackSend(B, runningToken), true);
  assert.deepEqual(store.of(B), { phase: "running", unread: null }, "起点就是 running 时原样恢复");
});

test("rollbackSend：版本已变 ⇒ no-op（不用陈旧的 before 覆盖真实转移）", () => {
  const { store } = counter();
  const token = store.beginSend(A);
  // 发送之后、拒绝到达之前，真实事件推进了 A 的记录。
  store.dispatch(A, terminal("done", false));
  assert.equal(store.rollbackSend(A, token), false);
  assert.deepEqual(store.of(A), { phase: "idle", unread: "reply" }, "拒绝 MUST NOT 吃掉真实未读");

  const token2 = store.beginSend(B);
  store.dispatch(B, { type: "stop_clicked" }); // stopping 是真实转移
  assert.equal(store.rollbackSend(B, token2), false);
  assert.equal(store.of(B).phase, "stopping", "拒绝 MUST NOT 把真实 stopping 改回 idle");
});

test("rollbackSend：同相位的真实输入（auto_turn_started）同样挡下回滚", () => {
  const { store } = counter();
  const token = store.beginSend(A);
  // 乐观 sent 已把相位拉到 running；后端的 auto_turn_started 不改变状态，但它是「这一轮
  // 确实起来了」的证据——版本因此推进，迟到的拒绝 MUST NOT 把它撤销成空闲。
  store.dispatch(A, { type: "turn_started" });
  assert.equal(store.rollbackSend(A, token), false);
  assert.equal(store.of(A).phase, "running");
});

test("rollbackSend：换 vault 后仍只作用于发送时那个 vault", () => {
  const { store } = counter();
  const token = store.beginSend(A);
  store.dispatch(B, { type: "turn_started" });
  assert.equal(store.rollbackSend(A, token), true);
  assert.deepEqual(store.of(A), { phase: "idle", unread: null });
  assert.deepEqual(store.of(B), { phase: "running", unread: null }, "B 的记录不受 A 的回滚影响");
});

// ── 8. finishIfStopping：只在 stopping 收口 ────────────────────────────────

test("finishIfStopping：stopping ⇒ idle；idle / running 一律 no-op", () => {
  const { store } = counter();
  assert.equal(store.finishIfStopping(A), false, "未知键（idle）不收口");
  assert.deepEqual(store.of(A), INITIAL_ACTIVITY);

  store.dispatch(A, { type: "turn_started" });
  assert.equal(store.finishIfStopping(A), false, "running（新轮）不得被旧停止请求改回 idle");
  assert.equal(store.of(A).phase, "running");

  store.dispatch(A, { type: "stop_clicked" });
  assert.equal(store.finishIfStopping(A), true);
  assert.deepEqual(store.of(A), { phase: "idle", unread: null });

  assert.equal(store.finishIfStopping(A), false, "已 idle 时幂等 no-op");
});

// ── 9. subscribe：只在跃迁时触发 ───────────────────────────────────────────

test("subscribe：跃迁触发、重复终态 / displayed 幂等不触发、退订后不再触发", () => {
  const store = createVaultActivityStore();
  let fired = 0;
  const unsubscribe = store.subscribe(() => {
    fired += 1;
  });
  store.dispatch(A, { type: "turn_started" });
  assert.equal(fired, 1);
  store.dispatch(A, terminal("done", false));
  assert.equal(fired, 2);
  store.dispatch(A, terminal("done", false)); // 同档重复终态：无跃迁
  assert.equal(fired, 2, "重复终态幂等不触发重绘");
  store.dispatch(A, { type: "displayed" });
  assert.equal(fired, 3);
  store.dispatch(A, { type: "displayed" }); // 已是 null
  assert.equal(fired, 3, "已读幂等不触发重绘");
  unsubscribe();
  store.dispatch(A, { type: "turn_started" });
  assert.equal(fired, 3, "退订后不得再回调");
});

test("subscribe：displayed 不让未知键分配条目（也不通知）", () => {
  const { store, fired } = counter();
  store.dispatch(C, { type: "displayed" });
  assert.equal(fired(), 0);
  assert.deepEqual(store.of(C), INITIAL_ACTIVITY);
});

// ── 10. 三态取值：钮与行共用同一份映射 ──────────────────────────────────────

test("activityKind / activityStatusKey：相位优先、未读分两档、空闲零条目", () => {
  const states: Array<[ActivityState, string, string | null]> = [
    [INITIAL_ACTIVITY, "idle", null],
    [{ phase: "running", unread: "reply" }, "inflight", "D870"],
    [{ phase: "stopping", unread: null }, "inflight", "D870"],
    [{ phase: "idle", unread: "reply" }, "reply", "D871"],
    [{ phase: "idle", unread: "failure" }, "failure", "D872"],
  ];
  for (const [state, kind, key] of states) {
    assert.equal(activityKind(state), kind);
    assert.equal(activityStatusKey(state), key);
  }
});

test("reduceActivity 的既有语义保持不变（store 不复制转移规则）", () => {
  assert.deepEqual(reduceActivity(INITIAL_ACTIVITY, { type: "sent" }), {
    phase: "running",
    unread: null,
  });
});
