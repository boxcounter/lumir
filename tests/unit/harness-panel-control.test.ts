// composer 控制行纯模型层的单测（M347，composer 控制行 + 复制 + 进度）：
//   - 发送钮两态状态机（reduceSendPhase：sent / stop-clicked / finished 的全转移表，
//     连点幂等、忙时重复发送挡在门外）；
//   - 合并选择器的提取（harnessSelection：闭集合过滤、mock 在可选列表层隐藏、
//     model 维度逐项宽容提取、缺 harness 段；chipModelReading：model 读数回落链）；
//   - ctx% 读数高亮判据（usageOverWarn：≥ 阈值即高亮，边界取高亮侧；M370 起警示说明走
//     hover 浮层，呈现面在 DOM 层，判词不变）；
//   - 消息 when 的相对时间分档（relativeWhen，M351：<10s 刚刚 / N 秒前 / N 分钟前 /
//     N 小时前 / 昨天，未来戳 clamp，zh/en 双档）。
// 合同：mission M347 任务 1 / 3 / 7 与 src/harness-panel.ts 控制行段的注释判词。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROVIDER_IDS,
  chipModelReading,
  harnessSelection,
  reduceSendPhase,
  relativeWhen,
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

// ── 合并选择器的提取（M373 任务 1/5：闭集合 provider + model 维度 + mock 隐藏） ──

test("harnessSelection：三档全配置 → providerOptions 按闭集合序、mock 被过滤（UI 隐藏）", () => {
  const harness = {
    provider: "deepseek",
    providers: { mock: {}, deepseek: {}, kimi: {} },
  };
  const sel = harnessSelection(harness);
  assert.deepEqual(sel?.providerOptions, ["kimi", "deepseek"]);
  assert.equal(sel?.provider, "deepseek");
});

test("harnessSelection：model 维度逐项提取（id/effort/window），坏项丢弃", () => {
  const harness = {
    provider: "kimi",
    providers: {
      kimi: {
        model: "k3-256k",
        models: [
          { id: "kimi-k3", effort: true, window: 1048576 },
          { id: "kimi-k2.6", effort: false, window: 262144 },
          "not-an-object",
          { id: "", effort: true, window: 1 },
          { effort: true, window: 1 },
          { id: "no-window", effort: true },
        ],
      },
      deepseek: { model: "deepseek-flash" }, // 无 models 键 → 空清单（旧配置形态）
    },
  };
  const sel = harnessSelection(harness);
  assert.deepEqual(sel?.models.kimi, {
    current: "k3-256k",
    options: [
      { id: "kimi-k3", effort: true, window: 1048576 },
      { id: "kimi-k2.6", effort: false, window: 262144 },
      { id: "no-window", effort: true, window: 0 },
    ],
  });
  assert.deepEqual(sel?.models.deepseek, { current: "deepseek-flash", options: [] });
  // mock 无模型维度，不出现。
  assert.equal(sel?.models.mock, undefined);
});

test("harnessSelection：current 不在闭集合 → 照实显示读数，providerOptions 仍只列已配置档", () => {
  const harness = { provider: "legacy", providers: { kimi: {}, deepseek: {} } };
  const sel = harnessSelection(harness);
  assert.equal(sel?.provider, "legacy");
  assert.deepEqual(sel?.providerOptions, ["kimi", "deepseek"]);
});

test("harnessSelection：harness 段缺失（桩环境 / 旧配置）→ null（chip 隐藏，不伪造读数）", () => {
  assert.equal(harnessSelection(undefined), null);
  assert.equal(harnessSelection(null), null);
  assert.equal(harnessSelection({}), null);
  assert.equal(harnessSelection({ provider: "mock" }), null);
  assert.equal(harnessSelection({ providers: "nope" }), null);
});

test("chipModelReading：有 model 维度 → 当前 model 配置值（不在 options 里也照实显示）", () => {
  const base = {
    provider: "kimi",
    providerOptions: ["kimi"] as const,
    models: {
      kimi: {
        current: "k3-256k",
        options: [{ id: "kimi-k3", effort: true, window: 1 }],
      },
    },
  };
  assert.equal(chipModelReading(base as never), "k3-256k");
  // current 不在 options（用户自填未知模型）→ 照实显示，不回落首项。
  assert.equal(
    chipModelReading({
      ...base,
      models: { kimi: { current: "my-model", options: base.models.kimi.options } },
    } as never),
    "my-model",
  );
});

test("chipModelReading：回落链——model 为空回落首选项 id（配置声明），无维度（mock）回落 provider id", () => {
  assert.equal(
    chipModelReading({
      provider: "kimi",
      providerOptions: ["kimi"],
      models: { kimi: { current: "", options: [{ id: "kimi-k3", effort: true, window: 1 }] } },
    } as never),
    "kimi-k3",
  );
  // mock：无模型维度 → provider id 本身上 chip（验收专用档，形态不变形）。
  assert.equal(
    chipModelReading({ provider: "mock", providerOptions: [], models: {} } as never),
    "mock",
  );
});

test("chipModelReading：M381 config-only 空清单态 → 空串（不伪造读数，调用方收起 model 名走 D403）", () => {
  // 有维度但声明清单为空：model 读数为空串——MUST NOT 回落 provider id（那是伪造）。
  assert.equal(
    chipModelReading({
      provider: "kimi",
      providerOptions: ["kimi"],
      models: { kimi: { current: "", options: [] } },
    } as never),
    "",
  );
  // current 有值但 options 空（model 键显式声明、models 清单缺失）→ 照实显示配置值。
  assert.equal(
    chipModelReading({
      provider: "kimi",
      providerOptions: ["kimi"],
      models: { kimi: { current: "stray-model", options: [] } },
    } as never),
    "stray-model",
  );
});

test("PROVIDER_IDS：闭集合即 src/bindings/HarnessProvider.ts 的同值域", () => {
  assert.deepEqual([...PROVIDER_IDS], ["kimi", "deepseek", "mock"]);
});

// ── ctx% 读数高亮判据（M347 任务 2：超阈值（默认 85%）读数高亮；M370 起警示说明为
//   hover 读数浮层——呈现面在 DOM 层，本层判词不变） ──

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

// ── 消息 when 的相对时间分档（M351，change harness-pane-visual-fidelity design §4）──
// 分档：「<10s 刚刚（复用 D100.1）/ <60s N 秒前 / <60min N 分钟前 / <24h N 小时前 /
// 否则昨天」；时钟回拨（打戳在将来）clamp 进「刚刚」。走 Intl narrow 式：zh 无空格
// （「10秒前」，对齐原型「12 秒前」），en「10s ago」。

const WHEN_NOW = 1_800_000_000_000; // 固定基准戳（值任意，用例全部传显式 now/lang）

test("relativeWhen：<10s = 刚刚（zh/en 复用 D100.1 同一真源）", () => {
  assert.equal(relativeWhen(WHEN_NOW - 9_000, WHEN_NOW, "zh"), "刚刚");
  assert.equal(relativeWhen(WHEN_NOW - 9_000, WHEN_NOW, "en"), "just now");
  assert.equal(relativeWhen(WHEN_NOW, WHEN_NOW, "zh"), "刚刚"); // 0s 同档
});

test("relativeWhen：未来戳 clamp 进「刚刚」（时钟回拨不产出负数档）", () => {
  assert.equal(relativeWhen(WHEN_NOW + 30_000, WHEN_NOW, "zh"), "刚刚");
  assert.equal(relativeWhen(WHEN_NOW + 30_000, WHEN_NOW, "en"), "just now");
});

test("relativeWhen：秒档边界（10s 起 N 秒前，59s 仍在秒档）", () => {
  assert.equal(relativeWhen(WHEN_NOW - 10_000, WHEN_NOW, "zh"), "10秒前");
  assert.equal(relativeWhen(WHEN_NOW - 10_000, WHEN_NOW, "en"), "10s ago");
  assert.equal(relativeWhen(WHEN_NOW - 59_000, WHEN_NOW, "zh"), "59秒前");
});

test("relativeWhen：分钟档边界（60s 入分钟档，59min 仍在分钟档）", () => {
  assert.equal(relativeWhen(WHEN_NOW - 60_000, WHEN_NOW, "zh"), "1分钟前");
  assert.equal(relativeWhen(WHEN_NOW - 60_000, WHEN_NOW, "en"), "1m ago");
  assert.equal(relativeWhen(WHEN_NOW - 59 * 60_000, WHEN_NOW, "zh"), "59分钟前");
});

test("relativeWhen：小时档边界（60min 入小时档，23h 仍在小时档）", () => {
  assert.equal(relativeWhen(WHEN_NOW - 60 * 60_000, WHEN_NOW, "zh"), "1小时前");
  assert.equal(relativeWhen(WHEN_NOW - 23 * 3_600_000, WHEN_NOW, "en"), "23h ago");
});

test("relativeWhen：≥24h 兜底「昨天」（会话是内存态，更老的值实际不出现）", () => {
  assert.equal(relativeWhen(WHEN_NOW - 24 * 3_600_000, WHEN_NOW, "zh"), "昨天");
  assert.equal(relativeWhen(WHEN_NOW - 24 * 3_600_000, WHEN_NOW, "en"), "yesterday");
  assert.equal(relativeWhen(WHEN_NOW - 96 * 3_600_000, WHEN_NOW, "zh"), "昨天");
});
