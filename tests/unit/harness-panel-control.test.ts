// composer 控制行纯模型层的单测（M347，composer 控制行 + 复制 + 进度）：
//   - 发送钮两态状态机（reduceSendPhase：sent / stop-clicked / finished 的全转移表，
//     连点幂等、忙时重复发送挡在门外）；
//   - 模型 chip 的 provider 提取（providerSelection：闭集合过滤、缺 harness 段、
//     current 不在闭集合时的照实显示）；
//   - ctx% 读数高亮判据（usageOverWarn：≥ 阈值即高亮，边界取高亮侧）。
// 合同：mission M347 任务 1 / 3 / 7 与 src/harness-panel.ts 控制行段的注释判词。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_IDS,
  providerSelection,
  reduceSendPhase,
  usageOverWarn,
} from "../../src/harness-panel.ts";

// ── 发送钮两态状态机（M347 任务 3：两态 + stopping 幂等挡连点） ──

test("reduceSendPhase：idle + sent → running（可发送 → 处理中/停止态）", () => {
  assert.equal(reduceSendPhase("idle", { type: "sent" }), "running");
});

test("reduceSendPhase：running + finished → idle（done 与 error 共用终态）", () => {
  assert.equal(reduceSendPhase("running", { type: "finished" }), "idle");
});

test("reduceSendPhase：running + stop-clicked → stopping（停止请求受理）", () => {
  assert.equal(reduceSendPhase("running", { type: "stop-clicked" }), "stopping");
});

test("reduceSendPhase：stopping 挡连点（第二次 stop-clicked 不重复发停止钩子）", () => {
  assert.equal(reduceSendPhase("stopping", { type: "stop-clicked" }), "stopping");
});

test("reduceSendPhase：stopping + finished → idle（后端终态收口，钮回「发送」）", () => {
  assert.equal(reduceSendPhase("stopping", { type: "finished" }), "idle");
});

test("reduceSendPhase：忙时重复 sent 不前移（busy 协议，发送闸门的第一道闸）", () => {
  assert.equal(reduceSendPhase("running", { type: "sent" }), "running");
  assert.equal(reduceSendPhase("stopping", { type: "sent" }), "stopping");
});

test("reduceSendPhase：空闲点停止是无操作（没有可停的一轮）", () => {
  assert.equal(reduceSendPhase("idle", { type: "stop-clicked" }), "idle");
});

test("reduceSendPhase：finished 恒回 idle（终态之后再来终态不残留 stopping）", () => {
  assert.equal(reduceSendPhase("idle", { type: "finished" }), "idle");
});

// ── 模型 chip 的 provider 提取（M347 任务 1：闭集合 kimi/deepseek/mock） ──

test("providerSelection：三档全配置 → options 按闭集合序、current 照实返回", () => {
  const harness = { provider: "deepseek", providers: { mock: {}, deepseek: {}, kimi: {} } };
  assert.deepEqual(providerSelection(harness), { current: "deepseek", options: ["kimi", "deepseek", "mock"] });
});

test("providerSelection：配置只配了 mock → options 只列已配置档（chip 列出的是已配置集合）", () => {
  const harness = { provider: "mock", providers: { mock: { fixture: "f.json" } } };
  assert.deepEqual(providerSelection(harness), { current: "mock", options: ["mock"] });
});

test("providerSelection：混入闭集合外的键被过滤（不上屏）", () => {
  const harness = { provider: "kimi", providers: { kimi: {}, other: {}, deepseek: {} } };
  assert.deepEqual(providerSelection(harness), { current: "kimi", options: ["kimi", "deepseek"] });
});

test("providerSelection：current 不在闭集合 → 照实显示读数，options 仍只列闭集合档", () => {
  const harness = { provider: "legacy", providers: { kimi: {}, deepseek: {}, mock: {} } };
  assert.deepEqual(providerSelection(harness), { current: "legacy", options: ["kimi", "deepseek", "mock"] });
});

test("providerSelection：harness 段缺失（桩环境 / 旧配置）→ null（chip 隐藏，不伪造读数）", () => {
  assert.equal(providerSelection(undefined), null);
  assert.equal(providerSelection(null), null);
  assert.equal(providerSelection({}), null);
  assert.equal(providerSelection({ provider: "mock" }), null);
  assert.equal(providerSelection({ providers: "nope" }), null);
});

test("PROVIDER_IDS：闭集合即 src/bindings/HarnessProvider.ts 的同值域", () => {
  assert.deepEqual([...PROVIDER_IDS], ["kimi", "deepseek", "mock"]);
});

// ── ctx% 读数高亮判据（M347 任务 2：超阈值（默认 85%）读数高亮 + ⓘ 钮） ──

test("usageOverWarn：越阈值即高亮（86/85 高亮，84/85 不高亮）", () => {
  assert.equal(usageOverWarn(86, 85), true);
  assert.equal(usageOverWarn(84, 85), false);
});

test("usageOverWarn：边界取高亮侧（85/85 高亮——下一轮就触发压缩，按已越线呈现）", () => {
  assert.equal(usageOverWarn(85, 85), true);
});

test("usageOverWarn：阈值随快照配置（自定义 warn_ctx_pct 生效）", () => {
  assert.equal(usageOverWarn(72, 70), true);
  assert.equal(usageOverWarn(69, 70), false);
});
