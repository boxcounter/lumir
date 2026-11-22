// `src/image-thumb-cache.ts` 的纯单测（零 DOM）：缩略图 blob URL 有界缓存的账本与生命周期。
//
// 覆盖判据（每条都配反向输入，见 REVIEW.md「断言等价于子串」条）：
//   - 字节预算：超限时按 LRU 淘汰非活跃项并 revoke，恰好一次；
//   - LRU：`get` 命中刷新顺序（null 条目同样刷新；命中失败占位不得被当成未命中）；
//   - 活跃保护：活跃项超预算也不淘汰，活跃总字节可超上限；
//   - 超限单图：正在显示的 50MB 图不被误删；一旦不再活跃则按预算淘汰；
//   - 失败 null 条目：不占字节但占条目数，条目上限对失败项同样生效；
//   - clear / reset：全量 revoke，每个 URL 恰好一次，二次 clear 不重复释放；
//   - 替换条目：旧 URL 恰好 revoke 一次，同 URL 复用不误 revoke。
//
// 字节数用 `{ byteLength }` 替身：缓存只消费这一个读数，不为记账分配真实 50MB 缓冲。

import { test } from "node:test";
import assert from "node:assert/strict";
import { ImageThumbCache } from "../../src/image-thumb-cache.ts";

interface Probe {
  cache: ImageThumbCache;
  created: string[];
  revoked: string[];
  /** 当前活跃名（测试中直接改这个 Set，再调 prune）。 */
  active: Set<string>;
}

function createProbe(maxBytes: number, maxEntries: number): Probe {
  const created: string[] = [];
  const revoked: string[] = [];
  const active = new Set<string>();
  let seq = 0;
  const cache = new ImageThumbCache({
    maxBytes,
    maxEntries,
    activeNames: () => active,
    createUrl: () => {
      const url = `blob:unit-${(seq += 1)}`;
      created.push(url);
      return url;
    },
    revokeUrl: (url) => void revoked.push(url),
  });
  return { cache, created, revoked, active };
}

function bytesOf(byteLength: number): Uint8Array<ArrayBuffer> {
  return { byteLength } as unknown as Uint8Array<ArrayBuffer>;
}

// ── 字节预算与 LRU ────────────────────────────────────────────────────────

test("字节预算：超限时淘汰最旧的**非活跃**项，并恰好 revoke 一次", () => {
  const { cache, created, revoked } = createProbe(100, 99);
  cache.put("a.webp", bytesOf(60), "image/webp");
  cache.put("b.webp", bytesOf(60), "image/webp");
  assert.deepEqual(revoked, [created[0]], "最旧的 a 被淘汰并 revoke（120 > 100）");
  assert.equal(cache.size, 1, "只留 b");
  assert.equal(cache.totalBytes, 60, "字节账随淘汰回落");
  assert.equal(cache.get("a.webp"), undefined, "被淘汰的条目是未命中，不是失败占位");
  assert.equal(cache.get("b.webp"), created[1], "b 仍在缓存");
});

test("LRU：get 命中刷新顺序，淘汰落在最久未使用的那一项", () => {
  const { cache, created, revoked } = createProbe(100, 99);
  cache.put("a.webp", bytesOf(40), "image/webp");
  cache.put("b.webp", bytesOf(40), "image/webp");
  cache.get("a.webp"); // 刷新 a：b 变成最久未使用
  cache.put("c.webp", bytesOf(40), "image/webp"); // 120 > 100，淘汰 b
  assert.deepEqual(revoked, [created[1]], "被淘汰的是 b 而不是刚用过的 a");
  assert.equal(cache.get("a.webp"), created[0], "a 命中");
  assert.equal(cache.get("c.webp"), created[2], "c 命中");
});

test("LRU：失败 null 条目的 get 同样刷新顺序，且 null 不等于未命中", () => {
  const { cache, revoked } = createProbe(100, 2);
  cache.putFailure("a.webp");
  cache.putFailure("b.webp");
  assert.equal(cache.get("a.webp"), null, "失败的条目命中返回 null（不重读）");
  cache.putFailure("c.webp"); // 条目上限 2，最久未使用的 b 被淘汰
  assert.equal(cache.size, 2, "条目数回到上限");
  assert.equal(cache.get("b.webp"), undefined, "b 已被淘汰（未命中）");
  assert.equal(cache.get("a.webp"), null, "刚刷新过的 a 仍在");
  assert.deepEqual(revoked, [], "null 条目淘汰不产生 revoke");
});

// ── 活跃保护与超限单图 ───────────────────────────────────────────────────

test("活跃保护：活跃项超预算不淘汰，活跃总字节可超上限；撤下后按预算淘汰", () => {
  const { cache, active, revoked } = createProbe(100, 99);
  active.add("a.webp");
  active.add("b.webp");
  cache.put("a.webp", bytesOf(80), "image/webp");
  cache.put("b.webp", bytesOf(80), "image/webp");
  assert.equal(cache.size, 2, "两张都在场：160 > 100 也不淘汰");
  assert.equal(cache.totalBytes, 160, "记账如实反映超限");
  assert.deepEqual(revoked, [], "活跃项不得被 revoke");

  active.delete("b.webp");
  cache.prune();
  assert.deepEqual(revoked, ["blob:unit-2"], "撤下的 b 被淘汰");
  assert.equal(cache.size, 1, "仍在显示的 a 保留");
  assert.equal(cache.totalBytes, 80, "撤下 b 后 80B 回到预算内");
});

test("超限单图：正在显示的 50MB 图不被预算误删；不再活跃后淘汰并 revoke 一次", () => {
  const FIFTY_MB = 50 * 1024 * 1024;
  const { cache, active, revoked } = createProbe(8 * 1024 * 1024, 99);
  active.add("pasted-huge.webp");
  cache.put("pasted-huge.webp", bytesOf(FIFTY_MB), "image/webp");
  assert.equal(cache.size, 1, "活跃的单图即使超预算也保留");
  assert.equal(cache.totalBytes, FIFTY_MB, "字节账如实记 50MB");
  assert.deepEqual(revoked, [], "正在显示的图 MUST NOT 被 revoke");

  active.delete("pasted-huge.webp");
  cache.prune();
  assert.equal(cache.size, 0, "不再活跃后按预算淘汰");
  assert.deepEqual(revoked, ["blob:unit-1"], "revoke 恰好一次");
  assert.equal(cache.totalBytes, 0, "字节账归零");
});

test("活跃项同样占条目上限：全部活跃时条目数可超上限，撤下一个才回收", () => {
  const { cache, active, revoked } = createProbe(100_000, 1);
  active.add("a.webp");
  active.add("b.webp");
  cache.put("a.webp", bytesOf(10), "image/webp");
  cache.put("b.webp", bytesOf(10), "image/webp");
  assert.equal(cache.size, 2, "活跃条目不被条目上限淘汰");
  active.delete("a.webp");
  cache.prune();
  assert.deepEqual(revoked, ["blob:unit-1"], "撤下的 a 被条目上限回收");
  assert.equal(cache.size, 1, "b 保留");
});

// ── null 条目与条目上限 ──────────────────────────────────────────────────

test("失败 null 条目：不占字节，但条目上限同样生效", () => {
  const { cache, revoked } = createProbe(100_000, 2);
  cache.putFailure("a.webp");
  cache.putFailure("b.webp");
  assert.equal(cache.size, 2, "两条失败占两个条目");
  assert.equal(cache.totalBytes, 0, "null 条目不占字节");
  cache.putFailure("c.webp");
  assert.equal(cache.size, 2, "条目数有界（淘汰最旧的 a）");
  assert.equal(cache.get("a.webp"), undefined, "a 已被条目上限淘汰");
  assert.equal(cache.get("c.webp"), null, "c 命中失败占位");
  assert.deepEqual(revoked, [], "null 条目淘汰不调用 revoke");
});

test("失败覆盖成功：旧 URL 恰好 revoke 一次，条目转为 null 且字节归零", () => {
  const { cache, revoked } = createProbe(100, 99);
  cache.put("a.webp", bytesOf(60), "image/webp");
  cache.putFailure("a.webp");
  assert.deepEqual(revoked, ["blob:unit-1"], "旧 URL 释放一次");
  assert.equal(cache.size, 1, "条目仍在（失败占位）");
  assert.equal(cache.totalBytes, 0, "失败条目不占字节");
  assert.equal(cache.get("a.webp"), null, "命中返回失败占位");
  assert.deepEqual(revoked, ["blob:unit-1"], "后续 get 不重复 revoke");
});

// ── 替换与 clear ─────────────────────────────────────────────────────────

test("替换成功条目：旧 URL 恰好 revoke 一次，记账换到新字节", () => {
  const { cache, created, revoked } = createProbe(100, 99);
  cache.put("a.webp", bytesOf(40), "image/webp");
  cache.put("a.webp", bytesOf(70), "image/webp");
  assert.deepEqual(revoked, [created[0]], "旧 URL 释放一次");
  assert.equal(cache.size, 1, "同名不新增条目");
  assert.equal(cache.totalBytes, 70, "字节账换成新值");
  assert.equal(cache.get("a.webp"), created[1], "读回新 URL");
});

test("clear：全量 revoke 每个 URL 恰好一次，二次 clear 不重复释放", () => {
  const { cache, created, revoked } = createProbe(100_000, 99);
  cache.put("a.webp", bytesOf(10), "image/webp");
  cache.put("b.webp", bytesOf(10), "image/webp");
  cache.putFailure("c.webp");
  cache.clear();
  assert.deepEqual(revoked, [created[0], created[1]], "成功项各 revoke 一次，null 无需释放");
  assert.equal(cache.size, 0, "条目清空");
  assert.equal(cache.totalBytes, 0, "字节账归零");
  cache.clear();
  assert.deepEqual(revoked, [created[0], created[1]], "二次 clear 不产生重复 revoke");
});

test("预算内 prune 是空操作（不误删可复用条目）", () => {
  const { cache, created, revoked } = createProbe(100, 99);
  cache.put("a.webp", bytesOf(10), "image/webp");
  cache.prune();
  assert.deepEqual(revoked, [], "预算内不淘汰");
  assert.equal(cache.get("a.webp"), created[0], "条目仍可命中");
});

test("非活跃超限单图：put 后立即淘汰并 revoke（不在场的图不占着 URL）", () => {
  const { cache, revoked } = createProbe(100, 99);
  cache.put("offscreen.webp", bytesOf(101), "image/webp");
  assert.equal(cache.size, 0, "非活跃且超预算：写入即淘汰");
  assert.deepEqual(revoked, ["blob:unit-1"], "URL 恰好 revoke 一次");
  assert.equal(cache.totalBytes, 0, "字节账不残留");
});
