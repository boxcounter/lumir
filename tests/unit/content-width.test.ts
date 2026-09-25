// 内容区域宽度的纯逻辑单测（M228，change content-width-drag）：钳制端点 + 对称拖拽换算 +
// 出厂默认对账 + 文案常量（D120 / D121）逐字断言。
//
// 为什么这一层只测纯函数与常量：拖拽控制器（指针捕获 / rAF 合并 / 列缘定位）需要真浏览器，
// 归视觉场景（tests/visual/scenes/content-width.spec.ts）与真机验收场景 38；判定与计算在
// 这里，改动一处的表现是「拖不动 / 拖出边界 / 默认值漂移」——都是可复现的断言。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTENT_WIDTH_MAX,
  CONTENT_WIDTH_MIN,
  CONTENT_WIDTH_TOKEN,
  DEFAULT_CONTENT_WIDTH,
  WIDTH_HANDLE_LABEL,
  WIDTH_SAVE_FAILED_TEXT,
  clampContentWidth,
  nextContentWidth,
} from "../../src/content-width.ts";

test("出厂默认与 Rust `UiConfig` 同值（两处真源对账）", () => {
  // Rust 侧的真源是 src-tauri/src/config.rs 的 `DEFAULT_CONTENT_WIDTH` / `CONTENT_WIDTH_MIN` /
  // `CONTENT_WIDTH_MAX`（D1/D2 裁决 2026-09-25：默认 680、区间 [680, 1200]，**默认值即下限**），
  // 那边由单测 missing_ui_fields_take_defaults / content_width_out_of_range_falls_back 钉住
  // 同一组值。第三处写值是 src/style.css 的 `--layout-doc-measure` 默认值（CSS 里没法被本层
  // 断言，由视觉场景的默认口径计算属性断言钉住）。REVIEW.md 第 8 条：三处同值。
  assert.equal(DEFAULT_CONTENT_WIDTH, 680, "缺配置时栏宽为 680px");
  assert.equal(CONTENT_WIDTH_MIN, 680);
  assert.equal(CONTENT_WIDTH_MAX, 1200);
  assert.equal(CONTENT_WIDTH_TOKEN, "--layout-doc-measure");
  assert.equal(clampContentWidth(DEFAULT_CONTENT_WIDTH), 680, "出厂默认在合法区间内");
});

test("clamp：区间内原值通过，越界收端点", () => {
  assert.equal(clampContentWidth(680), 680);
  assert.equal(clampContentWidth(1200), 1200);
  assert.equal(clampContentWidth(900), 900);
  assert.equal(clampContentWidth(400), 680, "低于下限收 680");
  assert.equal(clampContentWidth(5000), 1200, "高于上限收 1200");
});

test("对称换算：右缘向右拖 +Δx 放宽 2Δx；左缘向左拖（已带方向的 Δx 为正）同效", () => {
  // deltaX 是调用方已带方向的位移（左缘手柄传 -(x - x0)，见控制器注释），纯函数只管
  // 「栏宽变化 = 2 × 位移」这一条对称律——两侧把手各自只拖自己那一侧，另一侧镜像跟进。
  assert.equal(nextContentWidth(680, 80), 840, "向右/向外 80px → +160px");
  assert.equal(nextContentWidth(840, -80), 680, "反向拖回");
  // 左右手柄对称：同一 |位移|、同一方向语义（向外为正）给出同一结果
  assert.equal(nextContentWidth(680, 50), nextContentWidth(680, 50));
});

test("取整：小数位移落到整数 px（读数可逐值比对）", () => {
  assert.equal(nextContentWidth(680, 0.2), 680, "0.4px 舍去");
  assert.equal(nextContentWidth(680, 0.25), 681, "0.5px 入（round 半进）");
  assert.equal(nextContentWidth(681, 0.24), 681, "0.48px 舍去");
});

test("拖拽钳制：从默认只能往宽调，触顶后停在 1200", () => {
  assert.equal(nextContentWidth(680, -100), 680, "默认值即下限，往窄拖不动");
  assert.equal(nextContentWidth(680, 1000), 1200, "超出上限钳到 1200");
  assert.equal(nextContentWidth(1200, 10), 1200, "触顶后继续拖不动");
});

test("文案常量与 deck 表格行逐字一致（D120 / D121）", () => {
  assert.equal(WIDTH_HANDLE_LABEL, "调整内容宽度");
  assert.equal(
    WIDTH_SAVE_FAILED_TEXT("磁盘只读"),
    "内容宽度没能存进配置：磁盘只读（本次调整仍生效，重启后恢复）",
  );
});
