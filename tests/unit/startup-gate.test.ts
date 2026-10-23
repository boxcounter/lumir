// 启动态撤下判据（change app-splash-screen，design §2.2 / tasks 5.3）：四种结局各一例，
// 外加「都不成立时继续」、安全阀边界与优先级。
//
// 这一层跑的是 src/startup-gate.ts 的纯函数（不触 DOM）：DOM 与撤下时序归
// src/startup-surface.ts，接线（两个信号挂在哪两处既有收口）归 src/main.ts，
// 呈现与真机链路分别由视觉场景与验收场景 225 判。

import assert from "node:assert/strict";
import { test } from "node:test";
import { STARTUP_TIMEOUT_MS, startupDismissReason } from "../../src/startup-gate.ts";
import type { StartupDismissState } from "../../src/startup-gate.ts";

/** 无任何信号、计时起点：判据必须返回「继续」。 */
const BASE: StartupDismissState = {
  treeReady: false,
  noVaultTerminal: false,
  degraded: false,
  elapsedMs: 0,
};

test("没有任何信号时继续在场", () => {
  assert.equal(startupDismissReason(BASE), null);
  // 对照：任一条判据在场都必须改变结果——否则上面那条是恒真空转
  assert.notEqual(startupDismissReason({ ...BASE, treeReady: true }), null);
});

test("树装载完成 → tree_ready（终点 1）", () => {
  assert.equal(startupDismissReason({ ...BASE, treeReady: true }), "tree_ready");
});

test("未打开终态 → no_vault（终点 2）", () => {
  assert.equal(startupDismissReason({ ...BASE, noVaultTerminal: true }), "no_vault");
});

test("安全阀：到点即 timeout，差一毫秒仍继续（终点 3）", () => {
  assert.equal(startupDismissReason({ ...BASE, elapsedMs: STARTUP_TIMEOUT_MS - 1 }), null);
  assert.equal(startupDismissReason({ ...BASE, elapsedMs: STARTUP_TIMEOUT_MS }), "timeout");
});

test("安全阀时长不超过 spec 的 10s 上界", () => {
  assert.ok(STARTUP_TIMEOUT_MS <= 10_000, `实现值 ${STARTUP_TIMEOUT_MS}ms 超过 spec 上界`);
});

test("降级 → degraded，且优先于其余信号（自身坏了最先让路）", () => {
  assert.equal(startupDismissReason({ ...BASE, degraded: true }), "degraded");
  assert.equal(
    startupDismissReason({ ...BASE, degraded: true, treeReady: true, noVaultTerminal: true, elapsedMs: STARTUP_TIMEOUT_MS }),
    "degraded",
  );
});

test("树就绪优先于未打开终态与超时（同时到达时的确定性）", () => {
  assert.equal(
    startupDismissReason({ ...BASE, treeReady: true, noVaultTerminal: true, elapsedMs: STARTUP_TIMEOUT_MS }),
    "tree_ready",
  );
  assert.equal(
    startupDismissReason({ ...BASE, noVaultTerminal: true, elapsedMs: STARTUP_TIMEOUT_MS }),
    "no_vault",
  );
});
