// IME 组合期 Enter 拦截门的状态机单测（M361 任务 4，合同 = 任务 3）：WKWebView 下「确认
// 候选」那拍 Enter 的 keydown.isComposing 不可靠（WebKit 先派 compositionend 再派确认
// keydown），改用 compositionstart/end 自跟踪 + compositionend 后紧邻窗口的确认拍防线。
// 必须成立的行为：组合期 Enter 不发送；两种事件序的确认拍都被吞；窗口外 Enter 照常放行
// （正常发送与 ⇧Enter 换行不被破坏）；确认拍消费后不残留窗口误吞下一次 Enter。
//
// 这一层是零 DOM 环境（tests/unit/README.md）：假时钟外注 now，逐事件序驱动纯函数状态机。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IME_CONFIRM_WINDOW_MS,
  imeGateCompositionEnd,
  imeGateCompositionStart,
  imeGateKeydown,
  imeKeyGate,
} from "../../src/harness-panel.ts";

const T0 = 1_000_000;

function seq(gate: ReturnType<typeof imeKeyGate>, ...events: Array<[string, number]>) {
  let g = gate;
  const out: boolean[] = [];
  for (const [key, now] of events) {
    const d = imeGateKeydown(g, key, now);
    g = d.gate;
    out.push(d.swallow);
  }
  return { gate: g, swallows: out };
}

// ── 无组合：Enter 一律放行（正常发送 / ⇧Enter 换行路径开门） ─────────────────

test("空闲态：Enter 放行（发送路径）", () => {
  const { gate, swallows } = seq(imeKeyGate(), ["Enter", T0]);
  assert.deepEqual(swallows, [false]);
  assert.deepEqual(gate, { composing: false, confirmUntil: 0, endDisarmed: false });
});

// ── Chromium 序：确认 Enter 在组合期内到达 ───────────────────────────────────

test("组合期内 Enter 吞（候选确认），随后 compositionend 不开窗——连拍第二发 Enter 放行", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  const d1 = imeGateKeydown(g, "Enter", T0); // 确认拍：isComposing 浏览器自报路径之外的自跟踪命中
  assert.equal(d1.swallow, true);
  assert.equal(d1.gate.endDisarmed, true);
  g = imeGateCompositionEnd(d1.gate, T0 + 10); // 不开窗（endDisarmed）
  assert.equal(g.confirmUntil, 0);
  const d2 = imeGateKeydown(g, "Enter", T0 + 20); // 用户想发送的 Enter：放行
  assert.equal(d2.swallow, false);
});

test("组合期内非 Enter 键不吞、组合期状态保留（编辑键走 IME 原生路径）", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  const d = imeGateKeydown(g, "a", T0);
  assert.equal(d.swallow, false);
  assert.equal(d.gate.composing, true);
});

// ── WebKit 序：compositionend 先到达，确认 Enter 以普通 keydown 随后 ─────────

test("compositionend 后窗口内 Enter 吞（确认拍），消费后关窗——下一拍 Enter 放行", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0); // WebKit：end 先于确认 keydown → 开窗
  assert.equal(g.confirmUntil, T0 + IME_CONFIRM_WINDOW_MS);
  const d1 = imeGateKeydown(g, "Enter", T0 + 10);
  assert.equal(d1.swallow, true);
  assert.equal(d1.gate.confirmUntil, 0); // 已消费
  const d2 = imeGateKeydown(d1.gate, "Enter", T0 + 20);
  assert.equal(d2.swallow, false); // 真发送
});

test("compositionend 后先敲普通字符再 Enter：窗口被真实输入关掉，Enter 放行", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0);
  const d1 = imeGateKeydown(g, "a", T0 + 10);
  assert.equal(d1.swallow, false);
  assert.equal(d1.gate.confirmUntil, 0);
  const d2 = imeGateKeydown(d1.gate, "Enter", T0 + 20);
  assert.equal(d2.swallow, false);
});

test("compositionend 后窗口超时再 Enter：放行（不是确认拍）", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0);
  const d = imeGateKeydown(g, "Enter", T0 + IME_CONFIRM_WINDOW_MS + 1);
  assert.equal(d.swallow, false);
});

test("确认窗未消费时新的 compositionstart 直接关窗", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateCompositionEnd(g, T0); // 开了窗（鼠标点选候选，无确认 Enter 跟随）
  g = imeGateCompositionStart(g); // 用户马上开始新一段组音
  assert.equal(g.composing, true);
  assert.equal(g.confirmUntil, 0);
  const d = imeGateKeydown(g, "Enter", T0 + 30);
  assert.equal(d.swallow, true); // 组合期内：仍是确认拍
});

// ── 组合区正常闭环：start → 若干键 → end → 窗口外 Enter 发送 ─────────────────

test("完整组音闭环后的 Enter 照常放行（不破坏正常发送）", () => {
  let g = imeKeyGate();
  g = imeGateCompositionStart(g);
  g = imeGateKeydown(g, "n", T0).gate;
  g = imeGateKeydown(g, "i", T0 + 5).gate;
  g = imeGateCompositionEnd(g, T0 + 10);
  g = imeGateKeydown(g, "Enter", T0 + 500).gate; // 窗口外
  const d = imeGateKeydown(g, "Enter", T0 + 510);
  assert.equal(d.swallow, false);
  assert.deepEqual(d.gate, { composing: false, confirmUntil: 0, endDisarmed: false });
});
