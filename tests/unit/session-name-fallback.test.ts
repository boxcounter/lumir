// 会话名回落口径的跨层 fixture 前端侧（M662，change quote-pipeline-consistency-oct24）。
//
// 现场：quote 会话的历史浮层行显示 `<quote file="…`（Alex 2026-10-24 反馈 #2）。后端
// `first_user_text` 取的是 wire 原文（卡片元素 + XML 实体原样进名字），而前端活态路径
// `firstUserTextOf` 取的是段落原文——同一语义两处真源，两侧对不上时标题事件到达后浮层里
// 「当前会话」那一行也改不了名（`retitleOpenSessRows` 按上屏名匹配）。
//
// 本用例把两件事钉在同一份素材上：
//   1. `projectDelivery(blocks)` 与 fixture 的 `parts` 逐项相等——fixture 是序列化器的
//      输出，不是手抄的字符串（否则 fixture 与真实 wire 会各说各话）；
//   2. `firstUserTextOf(blocks)` 与 fixture 的 `expected` 相等。
// 后端 `src-tauri/src/harness.rs` 的单测读同一份文件、拿同一个 `expected`（两边各读一遍，
// 任一侧漂移自己那条就红）。
//
// 允许拼接的两层读法不必自己算：fixture 的 `content` 承载旧留存形态（单串 content），
// 前端没有对应块序列，只做「跳过」——那一条归 Rust 侧断言。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { projectDelivery } from "../../src/quote-card.ts";
import type { ComposerBlock } from "../../src/quote-card.ts";
import { firstUserTextOf } from "../../src/harness-panel.ts";

interface FixtureCase {
  name: string;
  blocks?: ComposerBlock[];
  parts?: Array<{ kind: "text"; text: string } | { kind: "image"; name: string; label: string }>;
  content?: unknown;
  expected: string | null;
}

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/session-name-fallback.json", import.meta.url), "utf8"),
) as { cases: FixtureCase[] };

test("fixture 有内容（反向输入：空 fixture 不许静默通过）", () => {
  assert.ok(fixture.cases.length >= 8, "fixture 用例数不足");
  assert.ok(
    fixture.cases.some((item) => item.content !== undefined),
    "至少一条旧留存的单串 content 用例",
  );
});

for (const item of fixture.cases) {
  if (item.blocks === undefined) continue; // 旧留存形态：前端没有块序列，归后端单测
  const blocks = item.blocks;
  test(`前端活态口径：${item.name}`, () => {
    assert.deepEqual(
      projectDelivery(blocks).parts,
      item.parts,
      "fixture 的 parts 必须就是序列化器的输出（wire 形态的唯一真源）",
    );
    assert.equal(firstUserTextOf(blocks), item.expected, "首条用户消息的取法必须与 fixture 一致");
  });
}
