// 排版口径的纯逻辑单测（M195，change typography-and-zoom）：档位计算 + 出厂默认对账 +
// 施加计划的字族判定与后备栈。
//
// 为什么这一层只测纯函数：`applyTypography`（写 DOM）与 CM 重测量需要真浏览器，归视觉场景
//（tests/visual/scenes/typography.spec.ts）与真机套件；判定与计算在这里，改动一处的表现是
// 「按一下字号不动 / 跳到边界外 / 非法字族把观感打回浏览器默认字体」——都是可复现的断言。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TEXT_SCALE_FACTOR,
  clampFontSize,
  nextFontSize,
  planTypography,
} from "../../src/typography.ts";
import type { TypographySettings } from "../../src/typography.ts";

const BASELINES = {
  body: '-apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
};
const acceptAll = () => true;
const settings = (over: Partial<TypographySettings> = {}): TypographySettings => ({
  fontFamily: null,
  monoFontFamily: null,
  fontSize: DEFAULT_FONT_SIZE,
  ...over,
});

test("出厂默认与 Rust `EditorConfig::default` 同值（两处真源对账）", () => {
  // Rust 侧的真源是 src-tauri/src/config.rs 的 `DEFAULT_FONT_SIZE`（= EditorConfig::default()
  // 的 font_size），那边由单测 missing_editor_typography_fields_take_defaults 钉住同一组值。
  // 第三处写值是 src/style.css 的 `--editor-font-size` 默认值（CSS 里没法被本层断言，由视觉
  // 场景的默认口径计算属性断言钉住）。D1 裁决（2026-09-24）：三处同为 **15**。
  assert.equal(DEFAULT_FONT_SIZE, 15, "缺配置时内容字号为 15px");
  assert.equal(FONT_SIZE_MIN, 12);
  assert.equal(FONT_SIZE_MAX, 32);
  assert.equal(TEXT_SCALE_FACTOR, 1.1);
  // 出厂默认即 spec「默认口径就是 change 之前的观感」那条 scenario 的起点
  assert.equal(clampFontSize(DEFAULT_FONT_SIZE), 15);
});

test("向上七档、向下七档：从 15 到 31 再回 15（反复乘除不漂移）", () => {
  // 取整口径（round）与「向下用除法而不是乘倒数」的理由：档位表是 spec 的一部分；用乘法做
  // 向下会把 15 走成另几条路径。D1 把基准从 16 挪到 15 后整张表随之平移（档位数不变）。
  const up: number[] = [];
  let size = DEFAULT_FONT_SIZE;
  for (let i = 0; i < 7; i++) {
    size = nextFontSize(size, "up");
    up.push(size);
  }
  assert.deepEqual(up, [17, 19, 21, 23, 25, 28, 31], "向上七档");
  // 第 8 档触顶（31 × 1.1 = 34.1 → 钳到 32）
  assert.equal(nextFontSize(size, "up"), FONT_SIZE_MAX, "再上一档触顶");
  const down: number[] = [];
  for (let i = 0; i < 7; i++) {
    size = nextFontSize(size, "down");
    down.push(size);
  }
  assert.deepEqual(down, [28, 25, 23, 21, 19, 17, 15], "向下七档回到 15（不漂移）");
});

test("向下四档从 15 到底：14 → 13 → 12 → 12（第 4 档已在界上，返回原值）", () => {
  let size = DEFAULT_FONT_SIZE;
  const down: number[] = [];
  for (let i = 0; i < 4; i++) {
    size = nextFontSize(size, "down");
    down.push(size);
  }
  assert.deepEqual(down, [14, 13, 12, 12]);
});

test("上下限钳制：到界后继续按返回原值（调用方据此「无变化、无提示、不报错」）", () => {
  assert.equal(nextFontSize(FONT_SIZE_MAX, "up"), FONT_SIZE_MAX, "已在 32 再按放大 = 不变");
  assert.equal(nextFontSize(FONT_SIZE_MIN, "down"), FONT_SIZE_MIN, "已在 12 再按缩小 = 不变");
  // 边界两侧各一格（防止把钳制写成「跳过端点」或「越界一格才钳」）
  assert.equal(nextFontSize(31, "up"), FONT_SIZE_MAX);
  assert.equal(nextFontSize(13, "down"), FONT_SIZE_MIN);
  for (const size of [11, 0, -5]) {
    assert.equal(nextFontSize(size, "down"), FONT_SIZE_MIN, "越界输入向下钳到下限");
  }
  for (const size of [33, 100]) {
    assert.equal(nextFontSize(size, "up"), FONT_SIZE_MAX, "越界输入向上钳到上限");
  }
});

test("档位断言有区分度：把倍率写成 1.2，档位表不匹配（必须 FAIL 的输入）", () => {
  // REVIEW.md 第 1 条：先造一个必须让它 FAIL 的输入，确认断言真的在判东西。
  // 下面这组是「倍率 1.2」的档位（Emacs 的默认步幅）：本仓取 1.1，两条路径从 15 出发就走了
  // 不同的值，因此上一条断言不可能在倍率被改回 1.2 时照样通过。
  const wrongFactor = (current: number, direction: "up" | "down") =>
    direction === "up" ? Math.round(current * 1.2) : Math.round(current / 1.2);
  const wrong: number[] = [];
  let size = DEFAULT_FONT_SIZE;
  for (let i = 0; i < 3; i++) {
    size = wrongFactor(size, "up");
    wrong.push(size);
  }
  assert.deepEqual(wrong, [18, 22, 26], "1.2 倍率的档位");
  assert.notEqual(wrong.join(","), "17,19,21", "与 1.1 的档位不同——区分度成立");
});

test("applyTypography 计划：未配置字体族 = 不写（沿用 CSS 默认），字号照写", () => {
  const plan = planTypography(settings({ fontSize: 20 }), BASELINES, acceptAll);
  assert.equal(plan.fontFamily, null, "未配置时不写字体族（:root 的默认值就是基线）");
  assert.equal(plan.monoFontFamily, null);
  assert.equal(plan.fontSize, 20);
  assert.deepEqual(plan.warnings, []);
});

test("applyTypography 计划：配置的族值拼上基线后备栈（未安装字体的退化路径）", () => {
  const plan = planTypography(
    settings({ fontFamily: '"LXGW WenKai"', monoFontFamily: '"JetBrains Mono", monospace' }),
    BASELINES,
    acceptAll,
  );
  assert.equal(plan.fontFamily, `"LXGW WenKai", ${BASELINES.body}`);
  assert.equal(plan.monoFontFamily, `"JetBrains Mono", monospace, ${BASELINES.mono}`);
  assert.deepEqual(plan.warnings, []);
});

test("applyTypography 计划：非法字族值 → warning + 不写（观感保持基线）", () => {
  const seen: string[] = [];
  const plan = planTypography(
    settings({ fontFamily: "12px", monoFontFamily: "Inter" }),
    BASELINES,
    (value) => {
      seen.push(value);
      return !value.startsWith("12px");
    },
  );
  assert.equal(plan.fontFamily, null, "非法值不写进 token（否则会回落浏览器默认字体）");
  assert.equal(plan.monoFontFamily, `Inter, ${BASELINES.mono}`, "同一批次里的合法项照常生效");
  assert.equal(plan.warnings.length, 1);
  assert.ok(plan.warnings[0].includes("font_family"), plan.warnings[0]);
  assert.ok(plan.warnings[0].includes("12px"), plan.warnings[0]);
  // 判定是拿**拼好的完整值**做的（只判用户值会漏掉「基线栈本身不合法」这一类）
  assert.ok(seen.includes(`12px, ${BASELINES.body}`));
});

test("applyTypography 计划：空串 / 纯空白归一为「沿用基线」，不产生 warning", () => {
  // Rust 侧已把空串 / 纯空白回落成 None（那边会记 warning），TS 侧再挡一次是防「配置面之外
  // 的调用者」（例如将来的设置 UI）传进来——口径一致：空 = 基线，不是错误。
  for (const value of ["", "   ", "\t"]) {
    const plan = planTypography(settings({ fontFamily: value, monoFontFamily: value }), BASELINES, acceptAll);
    assert.equal(plan.fontFamily, null, `"${value}" 应归一为「沿用基线」`);
    assert.equal(plan.monoFontFamily, null);
    assert.deepEqual(plan.warnings, []);
  }
});

test("applyTypography 计划：字号越界时钳进区间（配置面的区间校验在 Rust 侧）", () => {
  assert.equal(planTypography(settings({ fontSize: 100 }), BASELINES, acceptAll).fontSize, FONT_SIZE_MAX);
  assert.equal(planTypography(settings({ fontSize: 2 }), BASELINES, acceptAll).fontSize, FONT_SIZE_MIN);
});
