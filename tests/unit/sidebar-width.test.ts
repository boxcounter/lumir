// 左栏宽度的纯逻辑单测（M631，change add-sidebar-resize-hide-and-root-create）：
// 两层钳制（静态区间 + 窗口四成）、三处出厂默认值的对账、token 名与文案常量逐字断言。
//
// 为什么这一层只测纯函数与常量：拖拽控制器（指针捕获 / rAF 合并）与骨架几何需要真浏览器，
// 归视觉场景（tests/visual/scenes/m631-sidebar.spec.ts）与真机验收场景 220；判定与计算在这里，
// 改动一处的表现是「拖不动 / 拖出边界 / 默认值漂移」——都是可复现的断言。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COPY } from "../../src/copy-data.ts";
import {
  DEFAULT_SIDEBAR_WIDTH,
  SIDEBAR_DIVIDER_LABEL,
  SIDEBAR_HIDDEN_CLASS,
  SIDEBAR_SAVE_FAILED_TEXT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_TOKEN,
  clampSidebarWidth,
  clampSidebarWidthForViewport,
  sidebarWidthLimit,
} from "../../src/sidebar-width.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("出厂默认与 Rust / CSS 三处同值（REVIEW.md「同一语义两处真源」条）", () => {
  // Rust 侧真源：src-tauri/src/config.rs 的 DEFAULT_SIDEBAR_WIDTH / SIDEBAR_WIDTH_MIN / MAX
  // （那边由 explicit_ui_sidebar_width_is_loaded / out_of_range_ui_sidebar_width_falls_back_with_warning
  // 钉住同一组值）。第三处写值是 src/style.css 的 `--layout-sidebar-w` 默认值。
  // 三处都要逐值对上：只对 TS 常量相等是**恒真**断言（同一个字面量自己比自己）。
  assert.equal(DEFAULT_SIDEBAR_WIDTH, 236, "缺配置时侧栏宽为 236px（D1 裁决）");
  assert.equal(SIDEBAR_WIDTH_MIN, 180);
  assert.equal(SIDEBAR_WIDTH_MAX, 480);
  assert.equal(SIDEBAR_WIDTH_TOKEN, "--layout-sidebar-w");

  const rust = readFileSync(path.join(root, "src-tauri/src/config.rs"), "utf8");
  const rustConst = (name: string): number => {
    const hit = new RegExp(`pub const ${name}: f64 = ([0-9.]+);`).exec(rust);
    assert.ok(hit !== null, `src-tauri/src/config.rs 里找不到 ${name}`);
    return Number(hit[1]);
  };
  assert.equal(rustConst("DEFAULT_SIDEBAR_WIDTH"), DEFAULT_SIDEBAR_WIDTH, "Rust 默认值必须同值");
  assert.equal(rustConst("SIDEBAR_WIDTH_MIN"), SIDEBAR_WIDTH_MIN, "Rust 下限必须同值");
  assert.equal(rustConst("SIDEBAR_WIDTH_MAX"), SIDEBAR_WIDTH_MAX, "Rust 上限必须同值");

  const css = readFileSync(path.join(root, "src/style.css"), "utf8");
  const cssHit = new RegExp(`--layout-sidebar-w:\\s*([0-9.]+)px;`).exec(css);
  assert.ok(cssHit !== null, "src/style.css 里找不到 --layout-sidebar-w 默认值");
  assert.equal(Number(cssHit[1]), DEFAULT_SIDEBAR_WIDTH, "CSS 默认值必须同值");
});

test("clampSidebarWidth：区间内原值通过，越界收端点，取整到整数 px", () => {
  assert.equal(clampSidebarWidth(236), 236);
  assert.equal(clampSidebarWidth(180), 180, "下限含端点");
  assert.equal(clampSidebarWidth(480), 480, "上限含端点");
  assert.equal(clampSidebarWidth(100), 180, "低于下限收 180");
  assert.equal(clampSidebarWidth(900), 480, "高于上限收 480");
  assert.equal(clampSidebarWidth(236.4), 236, "0.4px 舍去");
  assert.equal(clampSidebarWidth(236.5), 237, "0.5px 入（round 半进）");
});

test("clampSidebarWidth：NaN / Infinity 回落默认值（不让一次坏读数把侧栏压到 0）", () => {
  assert.equal(clampSidebarWidth(Number.NaN), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(Number.POSITIVE_INFINITY), DEFAULT_SIDEBAR_WIDTH);
  assert.equal(clampSidebarWidth(Number.NEGATIVE_INFINITY), DEFAULT_SIDEBAR_WIDTH);
});

test("sidebarWidthLimit：窗口四成与静态上限取小", () => {
  assert.equal(sidebarWidthLimit(1200), 480, "宽屏：静态上限 480 生效");
  assert.equal(sidebarWidthLimit(1000), 400, "1000 × 0.4 = 400");
  assert.equal(sidebarWidthLimit(500), 200, "500 × 0.4 = 200");
  assert.equal(sidebarWidthLimit(750.5), 300, "小数向下取整（floor）");
  assert.equal(sidebarWidthLimit(0), SIDEBAR_WIDTH_MAX, "读不到窗口宽时不压侧栏");
  assert.equal(sidebarWidthLimit(Number.NaN), SIDEBAR_WIDTH_MAX);
});

test("clampSidebarWidthForViewport：显示值 = 意图值再被窗口四成钳一次", () => {
  assert.equal(clampSidebarWidthForViewport(236, 1200), 236, "常态窗口内原值通过");
  assert.equal(clampSidebarWidthForViewport(480, 1200), 480, "静态上限在宽窗口里可达");
  assert.equal(clampSidebarWidthForViewport(480, 700), 280, "窄窗口按四成钳（700 × 0.4 = 280）");
  assert.equal(clampSidebarWidthForViewport(236, 500), 200, "窄窗口把常态值也钳下去");
  // 窗口窄到四成 < 下限（design §8.1 的如实登记边界）：下限跟着放宽，区间不空。
  assert.equal(clampSidebarWidthForViewport(236, 400), 160, "400 × 0.4 = 160 < 180，显示 160");
  assert.equal(clampSidebarWidthForViewport(180, 400), 160, "下限同样被窗口钳住");
  // 非有限意图值回落默认后再钳（与 clampSidebarWidth 同口径）。
  assert.equal(clampSidebarWidthForViewport(Number.NaN, 1200), DEFAULT_SIDEBAR_WIDTH);
});

test("收起态的 class 名只在这里定义一次（装配层与 CSS 共用同一份字面量）", () => {
  assert.equal(SIDEBAR_HIDDEN_CLASS, "is-sidebar-hidden");
  const css = readFileSync(path.join(root, "src/style.css"), "utf8");
  assert.ok(
    css.includes(`.app-shell.${SIDEBAR_HIDDEN_CLASS}`),
    "src/style.css 里没有对应的收起态规则（class 名漂了就是两处不一致）",
  );
});

test("文案常量与 deck 表格行逐字一致（D549 / D550）", () => {
  assert.equal(SIDEBAR_DIVIDER_LABEL(), "调整左栏宽度");
  assert.equal(SIDEBAR_DIVIDER_LABEL(), COPY.D549.zh, "常量与文案表同源");
  assert.equal(
    SIDEBAR_SAVE_FAILED_TEXT("磁盘只读"),
    "左栏宽度没能存进配置：磁盘只读（本次调整仍生效，重启后恢复）",
  );
  assert.equal(COPY.D549.en, "Adjust sidebar width", "英文列逐字（en 面抽查）");
});
