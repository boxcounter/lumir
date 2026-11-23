// 行号开关域（change global-line-numbers-toggle-nov23）：当前值读取、取反、两条可见文案。
//
// 这一层跑的是 src/line-numbers.ts 的纯逻辑（不触 DOM）：`currentLineNumbers` 只读根元素对象的
// `dataset.lineNumbers` 字段，测试传结构替身即可（与 tests/unit/theme.test.ts 同款分层）。

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LINE_NUMBERS_INDICATOR_LABEL,
  LINE_NUMBERS_SAVE_FAILED_TEXT,
  currentLineNumbers,
  nextLineNumbers,
} from "../../src/line-numbers.ts";

/** 根元素的最小结构替身（只带 currentLineNumbers 读的那一个字段）。 */
const root = (lineNumbers?: string) => ({
  dataset: lineNumbers === undefined ? {} : { lineNumbers },
});

test("currentLineNumbers：两档都读得出来，未知值 / 缺字段 / 空串一律 null", () => {
  assert.equal(currentLineNumbers(root("on")), "on");
  assert.equal(currentLineNumbers(root("off")), "off");
  // 「还没施加」与「读到非法值」都表达为 null：调用方（取反）按默认 off 继续，
  // MUST NOT 原样透传一个可能非法的字符串（那会让 dataset 出现第二条判定路径）。
  assert.equal(currentLineNumbers(root("toggle")), null);
  assert.equal(currentLineNumbers(root("")), null);
  assert.equal(currentLineNumbers(root()), null);
  assert.equal(currentLineNumbers({ dataset: { lineNumbers: undefined } }), null);
});

test("nextLineNumbers：两档互转；null（未施加）按默认 off 取反落到 on", () => {
  assert.equal(nextLineNumbers("on"), "off");
  assert.equal(nextLineNumbers("off"), "on");
  // 反向判据（REVIEW.md「断言等价于子串」条）：未施加时第一次按键必须产生可见变化，
  // 不能空转回 off（否则用户按 ⌘⇧N 看着像没反应）。
  assert.equal(nextLineNumbers(null), "on");
  assert.notEqual(nextLineNumbers(null), "off", "未施加时 MUST NOT 空转回 off");
  // 连续两次取反回到原点——开关是二元的，没有第三档。
  assert.equal(nextLineNumbers(nextLineNumbers("on")), "on");
});

test("文案 D974：指示钮的悬停提示 / 读屏名逐字等于 deck 模板，读数不译文", () => {
  // 与 文案-Copy.md 的 D974 行逐字对齐（两边漂移即红，与 D122 同口径）。
  assert.equal(LINE_NUMBERS_INDICATOR_LABEL("on"), "行号：on（点击切换）");
  assert.equal(LINE_NUMBERS_INDICATOR_LABEL("off"), "行号：off（点击切换）");
  // `{state}` 是 on / off 读数本身，MUST NOT 被译成中文
  assert.ok(LINE_NUMBERS_INDICATOR_LABEL("on").includes("on"));
  assert.ok(LINE_NUMBERS_INDICATOR_LABEL("off").includes("off"));
});

test("文案 D975：写失败 toast 同时交代已生效 / 未写入 / 重启回落，且不点名档位", () => {
  const text = LINE_NUMBERS_SAVE_FAILED_TEXT("磁盘只读");
  // 三件事都在：已切换、写入失败、重启后回到配置文件里的值。
  assert.ok(text.includes("已切换"), "未交代「已生效」：{text}");
  assert.ok(text.includes("写入配置失败"), "未交代「未写入」：{text}");
  assert.ok(text.includes("重启后"), "未交代「重启回落」：{text}");
  assert.ok(text.includes("磁盘只读"), "原因占位没有插值");
  // MUST NOT 点名具体档位（写失败时前端说不出文件里是哪一档）。
  assert.ok(!text.includes("on") && !text.includes("off"), "点名了档位：{text}");
});
