// usage 载荷 → 读数映射的单测（M443，change harness-cache-metrics §5.3；M526 扩绝对值读数
// 与 ctxPopRows 气泡行纯模型层）。
//
// 这一层守的是**键名与缺省口径**：事件载荷与快照 `usage` 字段走同一个 `usageReadings`
// （REVIEW.md 第 8 条：跨层同一条语义只应有一处产出），缺键 / 非数值一律落 null——
// 「读不到」不等于「为 0」（REVIEW.md 第 2 条：不许把「读不到」当「为空」下结论）。
// 零 DOM 环境（tests/unit/README.md）：只调纯函数。

import { test } from "node:test";
import assert from "node:assert/strict";
import { ctxPopRows, usageReadings } from "../../src/harness-panel.ts";

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

test("usageReadings：写入为 0 时照读 0（0 是「不提供 / 确实没写」的同一读数，渲染判定在消费方）", () => {
  // 判定「整行不渲染」的键是本回合值 == 0（design §5.2 第 4 行）——映射层必须如实给出 0，
  // 不能因为「0 即不展示」就把 0 折叠成 null（那样消费方分不出「没读到」与「读到 0」）。
  const readings = usageReadings({
    cache_write_tokens: 0,
    cache_write_tokens_session: 12044,
  });
  assert.equal(readings.cacheWrite, 0);
  assert.equal(readings.cacheWriteSession, 12044);
});

// ── ctxPopRows：气泡行文本（M526 抽纯；渲染面 buildCtxPop 与单测同一处产出） ──

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

test("ctxPopRows：绝对值在场 ⇒ 四行全 tokens 形态（D463 / D465 / D466 / D455）", () => {
  const rows = ctxPopRows(FULL_READINGS, 85);
  assert.deepEqual(rows, [
    { cls: "lumir-hp-ctxpop-meaning", text: "上下文：已用 12786 / 131072 tokens（10%）" },
    { cls: "lumir-hp-ctxpop-cache", text: "缓存命中：本会话 10300 tokens · 累计命中率 89%" },
    { cls: "lumir-hp-ctxpop-cache-turn", text: "本回合缓存命中：6400 tokens · 命中率 50%" },
    { cls: "lumir-hp-ctxpop-cache-write", text: "缓存写入：本回合 6174 tokens · 本会话累计 12044 tokens" },
  ]);
});

test("ctxPopRows：无上限值（context_window 为 0）⇒ 第一行降级 D464，不编造上限与百分比", () => {
  const rows = ctxPopRows({ ...FULL_READINGS, contextWindow: 0 }, 85);
  assert.equal(rows[0].text, "上下文：已用 12786 tokens（窗口上限未知，无百分比读数）");
  // 其余行不受影响。
  assert.equal(rows.length, 4);
  assert.match(rows[1].text, /10300 tokens/);
});

test("ctxPopRows：绝对值缺键（旧载荷）⇒ 各行降级回百分比形态（D395 / D401 / D452）", () => {
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
    { cls: "lumir-hp-ctxpop-cache", text: "缓存命中率（会话累计）：20%" },
    { cls: "lumir-hp-ctxpop-cache-turn", text: "本回合缓存命中：20%" },
    { cls: "lumir-hp-ctxpop-cache-write", text: "缓存写入：本回合 16000 tokens · 本会话累计 16000 tokens" },
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

test("ctxPopRows：成因句照旧追加在第三行（tokens 形态后半句），越线时警示句追加最后", () => {
  const noted = ctxPopRows(
    { ...FULL_READINGS, cacheNote: "cold_start" as const, cacheTurn: 0, cachedTokens: 0 },
    85,
  );
  assert.match(
    noted[2].text,
    /^本回合缓存命中：0 tokens · 命中率 0% · /,
  );
  assert.ok(noted[2].text.includes("非异常"));
  // 越线：ctx 86% > 85% ⇒ D335 追加在最后（M443 追加行为保留）。
  const over = ctxPopRows({ ...FULL_READINGS, ctx: 86 }, 85);
  assert.equal(over.length, 5);
  assert.match(over[4].text, /^上下文已用 86%，越过 85% 警示线/);
  // 反向：未越线时没有警示行（区分度——不是恒真追加）。
  assert.equal(ctxPopRows(FULL_READINGS, 85).length, 4);
});

test("ctxPopRows：本回合写入为 0 ⇒ 写入行不渲染（判定键是本回合值）", () => {
  const rows = ctxPopRows({ ...FULL_READINGS, cacheWrite: 0 }, 85);
  assert.equal(rows.some((row) => row.cls === "lumir-hp-ctxpop-cache-write"), false);
  assert.equal(rows.length, 3);
});
