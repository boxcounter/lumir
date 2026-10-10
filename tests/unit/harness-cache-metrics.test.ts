// usage 载荷 → 读数映射的单测（M443，change harness-cache-metrics §5.3）。
//
// 这一层守的是**键名与缺省口径**：事件载荷与快照 `usage` 字段走同一个 `usageReadings`
// （REVIEW.md 第 8 条：跨层同一条语义只应有一处产出），缺键 / 非数值一律落 null——
// 「读不到」不等于「为 0」（REVIEW.md 第 2 条：不许把「读不到」当「为空」下结论）。
// 零 DOM 环境（tests/unit/README.md）：只调纯函数。

import { test } from "node:test";
import assert from "node:assert/strict";
import { usageReadings } from "../../src/harness-panel.ts";

test("usageReadings：完整载荷六项逐字映射", () => {
  const readings = usageReadings({
    ctx_pct: 67.2,
    cache_pct_session: 88.5,
    cache_pct_turn: 50.1,
    cache_write_tokens: 6174,
    cache_write_tokens_session: 12044,
    cache_note: "block_dilution",
  });
  assert.deepEqual(readings, {
    ctx: 67.2,
    cacheSession: 88.5,
    cacheTurn: 50.1,
    cacheNote: "block_dilution",
    cacheWrite: 6174,
    cacheWriteSession: 12044,
  });
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
