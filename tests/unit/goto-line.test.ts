// src/goto-line.ts 的单测（M281，change goto-line-command 的 tasks 4.1 / 3.2）：纯逻辑层的
// 输入矩阵与文案常量。
//
// 这一层判的是**纯逻辑**：`resolveGotoLine` 零 DOM、零 CodeMirror，因此「越界钳到哪一行」
// 「空输入算什么」这类口径能直接断言，不必靠浏览器场景间接兜底。输入的**字符过滤**（只收数字、
// ⌥G 就地消费、Enter / Escape / ⌃G）与浮层形态（预填全选、focusout 收起、切会话收起）归
// `tests/visual/scenes/m281-goto-line.spec.ts`（真 DOM）与真机场景 56。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOTO_LINE_LABEL,
  GOTO_LINE_PLACEHOLDER,
  gotoLineTotalText,
  resolveGotoLine,
} from "../../src/goto-line.ts";

test("resolveGotoLine：范围内的数字原样落点（1-based）", () => {
  assert.equal(resolveGotoLine("1", 5, 40), 1);
  assert.equal(resolveGotoLine("37", 5, 40), 37);
  assert.equal(resolveGotoLine("40", 5, 40), 40, "边界行（总行数）本身合法");
});

test("resolveGotoLine：越界与零值钳到文档边界（D3 的静默钳制）", () => {
  assert.equal(resolveGotoLine("0", 5, 40), 1, "0 与负值同路：钳到第 1 行");
  assert.equal(resolveGotoLine("41", 5, 40), 40);
  assert.equal(resolveGotoLine("9999", 5, 40), 40, "远大于总行数：停在末行，不报错");
  assert.equal(resolveGotoLine("0041", 5, 40), 40, "前导零不影响解析");
});

test("resolveGotoLine：前导零 / 纯零串按数值解释", () => {
  assert.equal(resolveGotoLine("007", 5, 40), 7);
  assert.equal(resolveGotoLine("000", 5, 40), 1, "全是零 ⇒ 0 ⇒ 钳到 1");
});

test("resolveGotoLine：空串与非数字按预填值（打开时的当前行号）解释", () => {
  assert.equal(resolveGotoLine("", 12, 40), 12, "空输入 + Enter = 停在当前行（Emacs 的 RET 用默认值）");
  assert.equal(resolveGotoLine("   ", 12, 40), 12, "空白同样解析不出数字");
  // 输入层（src/goto-line.ts 的 createGotoLinePrompt）已挡住非数字，纯函数层仍给出**完整定义**：
  // 非数字字符一律忽略；忽略后无数字可解则落回预填值。
  assert.equal(resolveGotoLine("abc", 12, 40), 12, "解析不出数字 ⇒ 落回预填值");
  // 非数字被忽略后剩下的数字**连读**（"1a2" → 12）：输入层不会产生这种串（见上面的分层说明），
  // 纯函数层只保证对任意字符串都返回一个合法行号、且口径可预期。
  assert.equal(resolveGotoLine("1a2", 5, 40), 12);
  assert.equal(resolveGotoLine("3 7", 5, 40), 37);
  assert.equal(resolveGotoLine("第 37 行", 5, 40), 37);
});

test("resolveGotoLine：超长数字串溢出也停在末行（不产生 NaN / 不放行越界）", () => {
  const huge = "9".repeat(400);
  assert.equal(resolveGotoLine(huge, 5, 40), 40);
  assert.equal(resolveGotoLine("9".repeat(20), 5, 40), 40);
});

test("resolveGotoLine：预填值本身也走同一条钳制（调用方不必先判界）", () => {
  assert.equal(resolveGotoLine("", 0, 40), 1, "预填 0（异常输入）钳到 1，而不是返回 0");
  assert.equal(resolveGotoLine("", 99, 40), 40);
  assert.equal(resolveGotoLine("7", 99, 1), 1, "单行文档：任何输入都落在第 1 行");
});

test("resolveGotoLine：总行数非正数时按 1 行处理（不返回 0 或负数）", () => {
  assert.equal(resolveGotoLine("5", 1, 0), 1);
  assert.equal(resolveGotoLine("5", 1, -3), 1);
});

test("文案常量（文案-Copy.md D152 / D157 / D158 逐字）", () => {
  assert.equal(GOTO_LINE_LABEL, "跳转到行");
  assert.equal(GOTO_LINE_PLACEHOLDER, "行号");
  assert.equal(gotoLineTotalText(1), "共 1 行");
  assert.equal(gotoLineTotalText(40), "共 40 行");
  assert.equal(gotoLineTotalText(1234), "共 1234 行");
});
