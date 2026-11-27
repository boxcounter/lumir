// 撤回入口的后果口径（change clarify-harness-withdraw-scope-nov27）。
//
// 判据是**文案语义**而不是「有条目就行」：入口读屏名只说动作（撤回这一轮），悬停提示、二次确认
// 与成功 toast 必须说清「消息 + 它引发的回答 / 工具记录」，且工具副作用不回撤。造一个必须让它
// FAIL 的输入：把这些条目改回「已撤回；原文已回到输入区」或塞进「后续回答」，下列断言都会红。

import assert from "node:assert/strict";
import { test } from "node:test";
import { COPY, t } from "../../src/copy.ts";

test("入口读屏名与完整后果提示：中英双档、措辞不用「后续回答」", () => {
  assert.equal(t("D1052", undefined, "zh"), "撤回这一轮");
  assert.equal(t("D1052", undefined, "en"), "Withdraw this turn");
  assert.equal(
    t("D1089", undefined, "zh"),
    "撤回这条消息和它引发的回答、工具记录；原文回到输入框",
  );
  assert.equal(
    t("D1089", undefined, "en"),
    "Withdraw this message, the reply and tool records it triggered; the original text returns to the composer",
  );
  assert.ok(!COPY.D1089.zh.includes("后续回答"), "提示不得用「后续回答」含糊指代本轮回答");
  assert.ok(!COPY.D1089.en.includes("subsequent"), "en 同口径不得只说后续回答");
});

test("二次确认：列出工具名，并明确这些操作不会撤销", () => {
  assert.match(COPY.D1054.zh, /\{tools\}/);
  assert.match(COPY.D1054.zh, /回答/);
  assert.match(COPY.D1054.zh, /不会撤销/);
  assert.match(COPY.D1054.en, /\{tools\}/);
  assert.match(COPY.D1054.en, /reply/i);
  assert.match(COPY.D1054.en, /not be undone/i);
});

test("成功 toast：消息与回答一起撤回、原文回 composer，不暗示只删用户文字", () => {
  assert.match(COPY.D1056.zh, /回答/);
  assert.match(COPY.D1056.zh, /工具记录/);
  assert.match(COPY.D1056.zh, /原文/);
  assert.match(COPY.D1056.zh, /输入框/);
  assert.ok(!COPY.D1056.zh.includes("已撤回；"), "旧口径只提「已撤回」+ 原文，已退场");
  assert.match(COPY.D1056.en, /reply/i);
  assert.match(COPY.D1056.en, /composer/i);
});
