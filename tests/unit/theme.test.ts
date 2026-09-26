// 主题域（M237，change live-theme-switch）：三档循环序、当前主题读取、两条可见文案。
//
// 这一层跑的是 src/theme.ts 的纯逻辑（不触 DOM）：`currentTheme` 只读根元素对象的
// `dataset.theme` 字段，测试传结构替身即可，不需要真 DOM。

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  THEME_CYCLE,
  THEME_INDICATOR_LABEL,
  THEME_SAVE_FAILED_TEXT,
  currentTheme,
  nextTheme,
} from "../../src/theme.ts";

/** 根元素的最小结构替身（只带 currentTheme 读的那一个字段）。 */
const root = (theme?: string) => ({ dataset: theme === undefined ? {} : { theme } });

test("循环序 = light → dark → eink → light（D1 裁决）", () => {
  const walk: string[] = [];
  let current: ReturnType<typeof nextTheme> | null = null;
  for (let i = 0; i < 3; i++) {
    current = nextTheme(current);
    walk.push(current);
  }
  assert.deepEqual(walk, ["dark", "eink", "light"], "三档一周、顺序固定");
  // 反向判据（REVIEW.md 第 1 条）：循环不是「恒返回同一档」的空转——三档互不相同
  assert.equal(new Set(THEME_CYCLE).size, 3, "三档互不相同");
  assert.equal(THEME_CYCLE.length, 3);
});

test("nextTheme：从每一档出发都落到它的下一档，eink 回卷到 light", () => {
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "eink");
  assert.equal(nextTheme("eink"), "light");
  // null（data-theme 尚未施加）按界面的出厂档 light 继续：第一次按键落到 dark，
  // 与屏幕上的可见变化一致（而不是把 light 重复施加一次、看着像没反应）
  assert.equal(nextTheme(null), "dark");
  assert.notEqual(nextTheme(null), "light", "未施加时 MUST NOT 空转回 light");
});

test("currentTheme：三档都读得出来，未知值 / 缺字段 / 空串一律 null", () => {
  for (const theme of THEME_CYCLE) assert.equal(currentTheme(root(theme)), theme);
  // 「读不到」与「读到非法值」都表达为 null，调用方按出厂档继续——MUST NOT 原样透传
  // 一个可能非法的字符串（那会让 dataset 的写入者出现第二条判定路径）
  assert.equal(currentTheme(root("solarized")), null);
  assert.equal(currentTheme(root("")), null);
  assert.equal(currentTheme(root()), null);
  assert.equal(currentTheme({ dataset: { theme: undefined } }), null);
});

test("文案 D122：指示钮的悬停提示 / 读屏名逐字等于 deck 模板", () => {
  // 与 文案-Copy.md 的 D122 行逐字对齐（两边漂移即红，与 image-widget / content-width 同口径）
  assert.equal(THEME_INDICATOR_LABEL("light"), "主题：light（点击切换）");
  assert.equal(THEME_INDICATOR_LABEL("dark"), "主题：dark（点击切换）");
  assert.equal(THEME_INDICATOR_LABEL("eink"), "主题：eink（点击切换）");
  // 提示里带的是**主题名本身**（与配置文件逐字同形），不是中文译名
  assert.ok(THEME_INDICATOR_LABEL("eink").includes("eink"));
});

test("文案 D123：写盘失败 toast 逐字等于 deck 模板，且不点名具体主题", () => {
  const text = THEME_SAVE_FAILED_TEXT("无法写入配置 /tmp/config.json：Permission denied");
  assert.equal(
    text,
    "主题已切换，但写入配置失败，重启后将回到配置文件里的主题（无法写入配置 /tmp/config.json：Permission denied）",
  );
  // 三件事都在：已生效 / 没存进配置 / 重启后回落
  assert.ok(text.includes("已切换"));
  assert.ok(text.includes("写入配置失败"));
  assert.ok(text.includes("重启后"));
  // 反向判据：MUST NOT 点名某一档具体主题——写失败时运行期态与文件态分叉，
  // 前端说不出文件里是哪一档，点名就是伪造读数
  for (const theme of THEME_CYCLE) {
    assert.ok(!text.includes(theme), `写盘失败提示 MUST NOT 点名具体主题（含 ${theme}）`);
  }
});
