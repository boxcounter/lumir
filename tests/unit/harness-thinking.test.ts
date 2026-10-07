// 思考块 + 思考程度的纯模型层单测（M363，change add-harness-thinking-display-and-effort
// 的面板半边；档位 / reasoning_chunk 事件 / thinking 快照字段的契约 = M362 的 core 半边）：
//   - 思考块四态：零思考不产块（零噪声）/ 首分片开块（折叠态源数据）/ 流式流入
//     （同块合并、多块按序号序、时长随末分片前进）/ 轮次结束定格（时长不再变）；
//   - 时长格式：thinkingDurationSec 的取整 / 不为负，thinkingHeadText 的 zh/en 两串模板
//     （D388，与 deck 逐字对账由 tests/unit/copy.test.ts 的漂移门禁守）；
//   - 思考 chip 状态：thinkingStateOf 的宽容提取（缺键 / 非法档 / supported 严格 true）；
//   - 档位名上屏形态：effortLabel 小写原词 → 首字母大写（zh/en 均英文原文的专有名词）。
// 合同：mission M363 任务 1–4 与 src/harness-panel.ts 思考块段的注释判词。
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数；
// 展开/折叠的 DOM 面与 chip/浮层的接线由视觉场景 tests/visual/scenes/m363-harness-thinking.spec.ts
// 的结构断言守（全部结构断言，零像素基线）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THINKING_EFFORTS,
  accumulateThinkingBlock,
  effortLabel,
  thinkingDurationSec,
  thinkingHeadText,
  thinkingStateOf,
  type ThinkingBlock,
} from "../../src/harness-panel.ts";

// ── 思考块四态（任务 1/2/3：零噪声 / 折叠默认 / 流式流入 / 定格） ──

test("零思考不产块：空序列原样返回（无 reasoning_chunk → 零渲染面）", () => {
  assert.deepEqual(accumulateThinkingBlock([], 0, "", 1000).blocks, [
    { index: 0, text: "", startedAt: 1000, lastAt: 1000 },
  ]);
  // 上一行是「首个分片即建块」；真正的零噪声判据是：没有事件就没有调用——块序列只属于
  // 事件累加面，渲染端（flushThinkingViews）遍历空序列即零写入。
  const untouched: ThinkingBlock[] = [];
  assert.deepEqual(untouched, []);
});

test("首分片开块：startedAt 与 lastAt 同为到达时刻，时长 0（折叠行的初始读数）", () => {
  const { blocks, block } = accumulateThinkingBlock([], 0, "先读 a.md。", 5000);
  assert.equal(blocks.length, 1);
  assert.deepEqual(block, { index: 0, text: "先读 a.md。", startedAt: 5000, lastAt: 5000 });
  assert.equal(thinkingDurationSec(block), 0);
});

test("同块多分片按到达序拼接、lastAt 前进（流式期间时长实时流入）", () => {
  let acc = accumulateThinkingBlock([], 0, "第一段", 1000);
  acc = accumulateThinkingBlock(acc.blocks, 0, "第二段", 4000);
  acc = accumulateThinkingBlock(acc.blocks, 0, "第三段", 9000);
  assert.equal(acc.blocks.length, 1);
  assert.equal(acc.block.text, "第一段第二段第三段");
  assert.equal(acc.block.startedAt, 1000, "首分片时刻是时长起点，不被后续分片改写");
  assert.equal(acc.block.lastAt, 9000);
  assert.equal(thinkingDurationSec(acc.block), 8);
});

test("多块按块序号序排列：乱序到达也在序列里归位（渲染序 = 块序号序）", () => {
  let acc = accumulateThinkingBlock([], 1, "第二轮的思考", 2000);
  acc = accumulateThinkingBlock(acc.blocks, 0, "第一轮的思考", 1000);
  acc = accumulateThinkingBlock(acc.blocks, 2, "第三轮的思考", 3000);
  assert.deepEqual(
    acc.blocks.map((b) => b.index),
    [0, 1, 2],
  );
  assert.deepEqual(
    acc.blocks.map((b) => b.text),
    ["第一轮的思考", "第二轮的思考", "第三轮的思考"],
  );
});

test("轮次结束定格：末分片之后时长不再前进（不再进分片 = 数据冻结）", () => {
  let acc = accumulateThinkingBlock([], 0, "a", 1000);
  acc = accumulateThinkingBlock(acc.blocks, 0, "b", 12400);
  const frozen = thinkingDurationSec(acc.block);
  assert.equal(frozen, 11);
  // 墙钟再走多久都不影响读数——时长只由块首/末分片的到达时刻决定（前端计时，core 无计时状态）。
  assert.equal(thinkingDurationSec(acc.block), 11);
  assert.equal(acc.block.lastAt, 12400);
});

// ── 时长格式（任务 3 + 任务 6：取整、不为负、zh/en 两串模板） ──

test("thinkingDurationSec：四舍五入到秒、负差 clamp 到 0", () => {
  const at = (ms: number): ThinkingBlock => ({ index: 0, text: "", startedAt: 0, lastAt: ms });
  assert.equal(thinkingDurationSec(at(0)), 0);
  assert.equal(thinkingDurationSec(at(400)), 0, "0.4s → 0 秒（不满一秒如实显示）");
  assert.equal(thinkingDurationSec(at(500)), 1, "0.5s → 1 秒（四舍五入）");
  assert.equal(thinkingDurationSec(at(12_400)), 12);
  assert.equal(thinkingDurationSec(at(12_500)), 13);
  assert.equal(thinkingDurationSec(at(-800)), 0, "时钟回拨不为负");
});

test("thinkingHeadText：zh「思考过程 · N 秒」/ en「Thinking · Ns」（D388 两串模板）", () => {
  const block: ThinkingBlock = { index: 0, text: "", startedAt: 0, lastAt: 12_400 };
  assert.equal(thinkingHeadText(block, "zh"), "思考过程 · 12 秒");
  assert.equal(thinkingHeadText(block, "en"), "Thinking · 12s");
  const zero: ThinkingBlock = { index: 0, text: "", startedAt: 0, lastAt: 0 };
  assert.equal(thinkingHeadText(zero, "zh"), "思考过程 · 0 秒");
  assert.equal(thinkingHeadText(zero, "en"), "Thinking · 0s");
});

// ── 思考 chip 状态（任务 4：快照宽容提取 + supported 置灰判据） ──

test("thinkingStateOf：正常快照原样提取 level 与 supported", () => {
  assert.deepEqual(thinkingStateOf({ thinking: { level: "high", supported: true } }), {
    level: "high",
    supported: true,
  });
  assert.deepEqual(thinkingStateOf({ thinking: { level: "max", supported: false } }), {
    level: "max",
    supported: false,
  });
});

test("thinkingStateOf：缺 thinking / 形状不对 → null（chip 隐藏，不伪造读数）", () => {
  assert.equal(thinkingStateOf({}), null);
  assert.equal(thinkingStateOf({ thinking: null }), null);
  assert.equal(thinkingStateOf({ thinking: "high" }), null);
  assert.equal(thinkingStateOf(null), null);
  assert.equal(thinkingStateOf("snapshot"), null);
  // 旧后端 / 桩的快照没有 thinking 字段 → null：与模型 chip「缺 harness 段即隐藏」同纪律。
  assert.equal(thinkingStateOf({ messages: [], usage: { ctx_pct: 62 } }), null);
});

test("thinkingStateOf：level 非法档 → null（闭集合纪律，前端不猜档位）", () => {
  assert.equal(thinkingStateOf({ thinking: { level: "medium", supported: true } }), null);
  assert.equal(thinkingStateOf({ thinking: { level: "HIGH", supported: true } }), null);
  assert.equal(thinkingStateOf({ thinking: { level: 2, supported: true } }), null);
});

test("thinkingStateOf：supported 严格取 true（缺键 = 不支持——置灰是安全侧）", () => {
  assert.deepEqual(thinkingStateOf({ thinking: { level: "low" } }), { level: "low", supported: false });
  assert.deepEqual(thinkingStateOf({ thinking: { level: "low", supported: 1 } }), {
    level: "low",
    supported: false,
  });
});

test("THINKING_EFFORTS 闭集合 = 绑定值域（low/high/max，浮层与解析同一份表）", () => {
  assert.deepEqual(THINKING_EFFORTS, ["low", "high", "max"]);
});

// ── 档位名上屏形态（任务 4：zh/en 均英文原文，首字母大写） ──

test("effortLabel：小写原词 → 首字母大写；空串原样", () => {
  assert.equal(effortLabel("low"), "Low");
  assert.equal(effortLabel("high"), "High");
  assert.equal(effortLabel("max"), "Max");
  assert.equal(effortLabel(""), "");
});
