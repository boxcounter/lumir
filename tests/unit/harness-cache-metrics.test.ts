// usage 载荷 → 读数映射的单测（M443，change harness-cache-metrics §5.3；M526 扩绝对值读数
// 与 ctxPopRows 气泡行纯模型层）。
//
// 这一层守的是**键名与缺省口径**：事件载荷与快照 `usage` 字段走同一个 `usageReadings`
// （REVIEW.md 第 8 条：跨层同一条语义只应有一处产出），缺键 / 非数值一律落 null——
// 「读不到」不等于「为 0」（REVIEW.md 第 2 条：不许把「读不到」当「为空」下结论）。
// M533 起气泡只剩 usage 行与命中率行（本回合值 / 成因 / 写入三组读数没有上屏面），读数映射
// 照旧完整——投影不跟着行集裁，跨层收口另立（见 src/harness-panel.ts 的读数状态注释）。
// 零 DOM 环境（tests/unit/README.md）：只调纯函数。

import { test } from "node:test";
import assert from "node:assert/strict";
import { ctxPopRows, formatTokenCount, usageReadings } from "../../src/harness-panel.ts";

test("usageReadings：完整载荷逐项映射（M526 扩至十一键）", () => {
  const readings = usageReadings({
    ctx_pct: 67.2,
    cache_pct_session: 88.5,
    cache_pct_turn: 50.1,
    cache_write_tokens: 6174,
    cache_write_tokens_session: 12044,
    cache_note: "block_dilution",
    input_tokens: 12786,
    cached_tokens: 6400,
    cached_tokens_session: 10300,
    context_window: 131072,
    has_usage: true,
  });
  assert.deepEqual(readings, {
    ctx: 67.2,
    cacheSession: 88.5,
    cacheTurn: 50.1,
    cacheNote: "block_dilution",
    cacheWrite: 6174,
    cacheWriteSession: 12044,
    inputTokens: 12786,
    cachedTokens: 6400,
    cachedTokensSession: 10300,
    contextWindow: 131072,
    hasUsage: true,
  });
});

test("usageReadings：has_usage 只认真假两值（缺键 / 非布尔落 null，不当 false）", () => {
  // false 是「从未发过请求」的真读数（读数区隐藏的门）；null 是「旧载荷没这键」——
  // 两者 MUST NOT 混（混了会让旧后端的真实读数被整体隐藏）。
  assert.equal(usageReadings({ has_usage: false }).hasUsage, false);
  assert.equal(usageReadings({ has_usage: true }).hasUsage, true);
  assert.equal(usageReadings({}).hasUsage, null);
  assert.equal(usageReadings({ has_usage: "true" }).hasUsage, null);
  assert.equal(usageReadings({ has_usage: 1 }).hasUsage, null);
});

test("usageReadings：绝对值键同样「缺键 / 非数值一律 null」", () => {
  const junk = usageReadings({
    input_tokens: "12786",
    cached_tokens: Number.NaN,
    cached_tokens_session: null,
    context_window: {},
  });
  assert.equal(junk.inputTokens, null);
  assert.equal(junk.cachedTokens, null);
  assert.equal(junk.cachedTokensSession, null);
  assert.equal(junk.contextWindow, null);
});

test("usageReadings：冷启动标注按值传入", () => {
  assert.equal(usageReadings({ cache_note: "cold_start" }).cacheNote, "cold_start");
  // 非法 / 未知值一律落 null（后端新加成因时前端不会把未知串当已知句渲染）。
  assert.equal(usageReadings({ cache_note: "ttl_expired" }).cacheNote, null);
  assert.equal(usageReadings({ cache_note: null }).cacheNote, null);
  assert.equal(usageReadings({}).cacheNote, null);
});

test("usageReadings：退役的 cache_pct 键不被复用（口径拆分的静默陷阱守卫）", () => {
  // 旧键在场也读不到——这正是「旧 cache_pct 退役、拆 cache_pct_session + cache_pct_turn」
  // 要防的事：复用旧键会让读到它的人以为还是单回合值。
  const readings = usageReadings({ ctx_pct: 50, cache_pct: 30 });
  assert.equal(readings.ctx, 50);
  assert.equal(readings.cacheSession, null);
  assert.equal(readings.cacheTurn, null);
});

test("usageReadings：缺键 / 非数值一律 null（回落单读数，不用 0 冒充实测值）", () => {
  const readings = usageReadings({ ctx_pct: 42 });
  assert.deepEqual(readings, {
    ctx: 42,
    cacheSession: null,
    cacheTurn: null,
    cacheNote: null,
    cacheWrite: null,
    cacheWriteSession: null,
    inputTokens: null,
    cachedTokens: null,
    cachedTokensSession: null,
    contextWindow: null,
    hasUsage: null,
  });
  // 字符串 / null / NaN 一类非数值不当数值读。
  const junk = usageReadings({
    ctx_pct: "42",
    cache_pct_session: null,
    cache_pct_turn: Number.NaN,
    cache_write_tokens: {},
    cache_write_tokens_session: [],
  });
  assert.equal(junk.ctx, null);
  assert.equal(junk.cacheSession, null);
  assert.equal(junk.cacheTurn, null);
  assert.equal(junk.cacheWrite, null);
  assert.equal(junk.cacheWriteSession, null);
});

test("usageReadings：非对象载荷（缺 usage / 非法 JSON 形态）全落 null", () => {
  for (const payload of [undefined, null, "x", 42, []]) {
    const readings = usageReadings(payload);
    assert.deepEqual(readings, {
      ctx: null,
      cacheSession: null,
      cacheTurn: null,
      cacheNote: null,
      cacheWrite: null,
      cacheWriteSession: null,
      inputTokens: null,
      cachedTokens: null,
      cachedTokensSession: null,
      contextWindow: null,
      hasUsage: null,
    });
  }
});

test("usageReadings：写入为 0 时照读 0（0 是「不提供 / 确实没写」的同一读数，不折叠成 null）", () => {
  // 映射层只做「读到了什么」——如实给出 0，不能因为某个消费方「0 就不展示」就把 0 折叠成
  // null（那样消费方分不出「没读到」与「读到 0」）。M533 起气泡不再渲染缓存写入行，这条口径
  // 仍然成立：投影保持载荷的完整一份，跨层收口另立（见 src/harness-panel.ts 的读数状态注释）。
  const readings = usageReadings({
    cache_write_tokens: 0,
    cache_write_tokens_session: 12044,
  });
  assert.equal(readings.cacheWrite, 0);
  assert.equal(readings.cacheWriteSession, 12044);
});

// ── formatTokenCount：气泡 tokens 数字的 k/m 单位（M532） ──────────────────────
// 规则原文（Alex 2026-10-16 原话「token 的最小单位是 k，如果超过 1000k，就升级成 m。让数字更加
// 人可读 好理解」）：≥1,000,000 走 m 档、≥1,000 走 k 档、不足 1,000 原值直出；小数位截断到
// 0.1 档（不四舍五入），末尾 `.0` 去掉。边界由本组用例钉死（mission 点名 999 / 1000 / 999999 /
// 1000000 与 m 档样本）——同一条规则另抄一份进 openspec/specs/harness 的气泡条款。

test("formatTokenCount：千位以下原值直出（0 不写「0k」、999 不写「0.9k」）", () => {
  assert.equal(formatTokenCount(0), "0");
  assert.equal(formatTokenCount(1), "1");
  assert.equal(formatTokenCount(999), "999");
});

test("formatTokenCount：1,000 起进 k 档，整 0.1 档不拖 .0", () => {
  assert.equal(formatTokenCount(1000), "1k");
  assert.equal(formatTokenCount(6000), "6k");
  assert.equal(formatTokenCount(131072), "131k");
});

test("formatTokenCount：k 档小数位截断到 0.1（不四舍五入——读数不虚高）", () => {
  assert.equal(formatTokenCount(1499), "1.4k"); // 1.499 截断；四舍五入会读成 1.5k
  assert.equal(formatTokenCount(6100), "6.1k");
  assert.equal(formatTokenCount(112722), "112.7k");
});

test("formatTokenCount：999,999 仍落 k 档（999.9k）——k 档永不出现「1000k」", () => {
  assert.equal(formatTokenCount(999999), "999.9k");
});

test("formatTokenCount：1,000,000 起升级 m 档", () => {
  assert.equal(formatTokenCount(1000000), "1m");
  assert.equal(formatTokenCount(1050000), "1m"); // 1.05 截断到 1.0 档
  assert.equal(formatTokenCount(1234567), "1.2m");
  assert.equal(formatTokenCount(2000000), "2m");
  assert.equal(formatTokenCount(12345678), "12.3m");
});

test("formatTokenCount：非读数原样透传（不编造、也不吞掉）", () => {
  // 映射层的有限数值门已经挡掉这些；走到这里说明上游有缺口，显示原值比显示「0k」更可查。
  assert.equal(formatTokenCount(-1), "-1");
  assert.equal(formatTokenCount(Number.NaN), "NaN");
  assert.equal(formatTokenCount(Number.POSITIVE_INFINITY), "Infinity");
});

// ── ctxPopRows：气泡行文本（M526 抽纯；渲染面 buildCtxPop 与单测同一处产出）
//    M533 行集精简为「usage 行 + 命中率行 + 越线警示行」——本回合命中行 / 缓存写入行 /
//    成因句退场。退场行留下的绝对读数（cachedTokens / cacheTurn / cacheNote / cacheWrite…）
//    仍喂进 `UsageReadings`（载荷投影不裁），因此下面的 readings 样本照旧带全键：行集断言
//    对新旧实现有区分度——旧实现会多出三行。 ──

const FULL_READINGS = {
  ctx: 9.8,
  cacheSession: 88.5,
  cacheTurn: 50.1,
  cacheNote: null,
  cacheWrite: 6174,
  cacheWriteSession: 12044,
  inputTokens: 12786,
  cachedTokens: 6400,
  cachedTokensSession: 10300,
  contextWindow: 131072,
  hasUsage: true,
} as const;

test("ctxPopRows：绝对值在场 ⇒ 两行（usage tokens 形态 + 命中率只百分比），数字走 k/m 单位", () => {
  const rows = ctxPopRows(FULL_READINGS, 85);
  assert.deepEqual(rows, [
    { cls: "lumir-hp-ctxpop-meaning", text: "上下文：已用 12.7k / 131k tokens（10%）" },
    // 命中率行**不带** tokens 计数（M533 的显式 supersede：读数在场也不进这一行）。
    { cls: "lumir-hp-ctxpop-cache", text: "缓存命中率（会话）：89%" },
  ]);
});

test("ctxPopRows：m 档样本（≥1,000,000 tokens 的 usage 行）", () => {
  // 现役 fixture 够不到百万级：m 档在真机与视觉场景里都不出现，这条用例是它唯一的行级判据。
  const rows = ctxPopRows(
    {
      ...FULL_READINGS,
      ctx: 60,
      inputTokens: 1234567,
      contextWindow: 2000000,
      cachedTokens: 1100000,
      cachedTokensSession: 1200000,
      cacheWrite: 1000000,
      cacheWriteSession: 1500000,
    },
    85,
  );
  assert.deepEqual(rows, [
    { cls: "lumir-hp-ctxpop-meaning", text: "上下文：已用 1.2m / 2m tokens（60%）" },
    { cls: "lumir-hp-ctxpop-cache", text: "缓存命中率（会话）：89%" },
  ]);
});

test("ctxPopRows：无上限值（context_window 为 0）⇒ 第一行降级 D464，不编造上限与百分比", () => {
  const rows = ctxPopRows({ ...FULL_READINGS, contextWindow: 0 }, 85);
  assert.equal(rows[0].text, "上下文：已用 12.7k tokens（窗口上限未知，无百分比读数）");
  // 其余行不受影响。
  assert.equal(rows.length, 2);
  assert.equal(rows[1].text, "缓存命中率（会话）：89%");
});

test("ctxPopRows：绝对值缺键（旧载荷）⇒ usage 行降级回百分比形态（D395），命中率行不变", () => {
  // 降级只针对 usage 行：命中率行本就只出百分比，与绝对值键无关（M533 起无 tokens 形态）。
  const rows = ctxPopRows(
    {
      ctx: 15.2,
      cacheSession: 20,
      cacheTurn: 20,
      cacheNote: null,
      cacheWrite: 16000,
      cacheWriteSession: 16000,
      inputTokens: null,
      cachedTokens: null,
      cachedTokensSession: null,
      contextWindow: null,
      hasUsage: null, // 旧载荷无 has_usage 键：维持旧行为（按 ctx 键呈现）
    },
    85,
  );
  assert.deepEqual(rows, [
    { cls: "lumir-hp-ctxpop-meaning", text: "上下文窗口占用：15%" },
    { cls: "lumir-hp-ctxpop-cache", text: "缓存命中率（会话）：20%" },
  ]);
});

test("ctxPopRows：has_usage=false（从未发过请求）⇒ 空行集——不假读数的第二道防线", () => {
  const rows = ctxPopRows(
    {
      ctx: 0,
      cacheSession: 0,
      cacheTurn: 0,
      cacheNote: null,
      cacheWrite: 0,
      cacheWriteSession: 0,
      inputTokens: 0,
      cachedTokens: 0,
      cachedTokensSession: 0,
      contextWindow: 0,
      hasUsage: false,
    },
    85,
  );
  assert.deepEqual(rows, []);
});

test("ctxPopRows：本回合的成因标注不再上屏（行集里没有它的落点）", () => {
  // 退场判据（区分度）：旧实现把成因句追加在「本回合缓存命中」行尾，本用例与下面那条
  // 断言整个行集里都不出现两句成因文本。
  const rows = ctxPopRows(
    { ...FULL_READINGS, cacheNote: "cold_start" as const, cacheTurn: 0, cachedTokens: 0 },
    85,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.some((row) => row.text.includes("非异常")), false);
  const diluted = ctxPopRows({ ...FULL_READINGS, cacheNote: "block_dilution" as const }, 85);
  assert.equal(diluted.some((row) => row.text.includes("摊薄")), false);
});

test("ctxPopRows：命中率行不渲染的判定不变（cacheSession 缺键），越线时警示句追加最后", () => {
  const noCache = ctxPopRows({ ...FULL_READINGS, cacheSession: null }, 85);
  assert.deepEqual(noCache, [
    { cls: "lumir-hp-ctxpop-meaning", text: "上下文：已用 12.7k / 131k tokens（10%）" },
  ]);
  // 越线：ctx 86% > 85% ⇒ D335 追加在最后（M378 起的追加行为与行序保留）。
  const over = ctxPopRows({ ...FULL_READINGS, ctx: 86 }, 85);
  assert.equal(over.length, 3);
  assert.equal(over[2].cls, "lumir-hp-ctxpop-warn");
  // M533 起警示句不再复述百分比（usage 行刚显示过同一个数）：只留阈值与后果。
  assert.equal(over[2].text, "越过 85% 警示线——下一轮对话将自动压缩");
  // 反向：未越线时没有警示行（区分度——不是恒真追加）。
  assert.equal(ctxPopRows(FULL_READINGS, 85).length, 2);
});
