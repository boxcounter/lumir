// src/list-filter.ts 的单测（M199，change list-filter 的 tasks 1.3 / 5.1）：匹配判定（子串 /
// 大小写折叠 / 多字节安全 / 行内标记边界）、结果集的下标空间与顺序、查询状态的三条转移
//（置空回全量 / 首条命中为起点 / 关闭丢弃），以及两处浮层共用的三条文案常量。
//
// 这一层判的是**纯逻辑**：匹配与查询状态零 DOM、零 CodeMirror，因此「查询没命中时游标在哪」
// 「清空后回到哪一条」这类判定能直接断言，不必靠浏览器场景间接兜底。DOM 与焦点迁移
//（输入框、ARIA 归属、焦点离开浮层即收起）归 tests/visual/scenes/list-filter.spec.ts。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FILTER_LABEL,
  FILTER_PLACEHOLDER,
  NO_MATCH_TEXT,
  createListFilter,
  filterIndices,
  foldCase,
  isMatch,
} from "../../src/list-filter.ts";

/** 大纲侧那类文本：中文长标题（前缀匹配对它们几乎不可用，这正是子串口径的理由）。 */
const TITLES = ["第一部分", "甲小节", "甲小节细节", "乙小节", "乙小节细节"];

test("匹配：子串包含（不是前缀），大小写折叠，顺序不重排", () => {
  // 中段命中（用户例子的「s 开头」是举例不是定义：前缀匹配对中文长标题几乎不可用）
  assert.equal(isMatch("甲小节", "小节"), true);
  assert.equal(isMatch("甲小节细节", "小节"), true);
  assert.equal(isMatch("甲小节", "小"), true, "命中位置在串首同样成立（子串包含前缀）");
  assert.equal(isMatch("第一部分", "小节"), false);

  // 大小写折叠：两侧各折一次后判包含
  assert.equal(foldCase("Notes"), "notes");
  assert.equal(isMatch("Notes", "n"), true);
  assert.equal(isMatch("Notes", "NOTES"), true);
  assert.equal(isMatch("Notes", "es"), true);
  assert.equal(isMatch("Notes", "x"), false);

  // 结果集是**源下标**且升序 = 源顺序（MUST NOT 重排）
  assert.deepEqual(filterIndices(TITLES, "小节"), [1, 2, 3, 4]);
  assert.deepEqual(filterIndices(["b", "A", "a"], "a"), [1, 2]);
  assert.deepEqual(filterIndices(TITLES, "第1章"), []);
});

test("匹配：空查询等于全量（不特判调用方）", () => {
  assert.equal(isMatch("任何文本", ""), true);
  assert.deepEqual(filterIndices(TITLES, ""), [0, 1, 2, 3, 4]);
  assert.deepEqual(filterIndices([], ""), []);
});

test("匹配：多字节安全（CJK 与代理对都按字符串包含语义判）", () => {
  // CJK：查询串是标题的中段
  assert.deepEqual(filterIndices(["安装说明", "卸载说明"], "安装"), [0]);
  // 代理对（U+20000 起的名：UTF-16 两个码元）与 BMP 混排：不能按字节切
  assert.equal(isMatch("𠀀甲小节", "小节"), true);
  assert.equal(isMatch("𠀀甲小节", "𠀀"), true);
  assert.equal(isMatch("甲𠀀小节", "𠀀小"), true);
  // 大小写折叠只对存在大小写的字符生效：CJK 原样
  assert.equal(isMatch("安装说明", "安装说明"), true);
  assert.equal(isMatch("安装说明", "ANZHUANG"), false);
});

test("匹配：行内标记不剥离（已知边界，如实如此）", () => {
  const texts = ["**粗**标题"];
  assert.deepEqual(filterIndices(texts, "粗标题"), [], "跨标记的连续串不存在，搜不到");
  assert.deepEqual(filterIndices(texts, "粗"), [0]);
});

test("查询状态：置空回全量、首条命中为起点、关闭丢弃查询", () => {
  const filter = createListFilter();
  // 打开时：空查询 = 全量（结果集 = 源下标全序）
  assert.deepEqual(filter.setQuery("", TITLES), [0, 1, 2, 3, 4]);
  assert.equal(filter.query, "");
  // 全量态起点由调用方给（大纲 = 当前段，vault = 当前项）；传 -1（没有当前段）落第一条
  assert.equal(filter.cursorStart(3), 3, "空查询下结果集与源同序同长，两个空间逐项对应");
  assert.equal(filter.cursorStart(-1), 0);

  // 输入：结果集收窄，游标 = 首条命中（MUST NOT 做「尽量保持原游标」的锚定）
  assert.deepEqual(filter.setQuery("乙", TITLES), [3, 4]);
  assert.equal(filter.cursorStart(1), 0, "查询非空时游标落在首条命中，与 fullStart 无关");

  // 继续变化（变长）：仍然首条命中
  assert.deepEqual(filter.setQuery("乙小节细", TITLES), [4]);
  assert.equal(filter.cursorStart(3), 0);

  // 无命中：结果集空，游标为 -1（调用方据此得到「没有游标」，Enter 无操作）
  assert.deepEqual(filter.setQuery("没有这一条", TITLES), []);
  assert.equal(filter.cursorStart(3), -1);

  // 清空：回到全量，游标回到全量态起点
  assert.deepEqual(filter.setQuery("", TITLES), [0, 1, 2, 3, 4]);
  assert.equal(filter.cursorStart(2), 2);

  // 关闭浮层：丢弃查询与结果集（下次打开从空查询与全量态起点开始）
  filter.setQuery("小节", TITLES);
  filter.reset();
  assert.equal(filter.query, "");
  assert.deepEqual(filter.visible, []);
  // 重开路径：先 reset 再置入空查询 → 全量
  assert.deepEqual(filter.setQuery("", TITLES), [0, 1, 2, 3, 4]);
  assert.equal(filter.cursorStart(-1), 0);
});

test("两处浮层共用的文案常量（文案-Copy.md D117–D119 逐字）", () => {
  assert.equal(NO_MATCH_TEXT, "没有匹配的条目");
  assert.equal(FILTER_PLACEHOLDER, "输入以筛选");
  assert.equal(FILTER_LABEL, "筛选");
});
