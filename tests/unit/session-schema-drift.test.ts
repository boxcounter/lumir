// 双表防漂移（REVIEW.md 第 8 条）：pane 域的四个常量在 **TS**（`src/pane-layout.ts`——运行期
// 布局的钳制区间与上限）与 **Rust**（`src-tauri/src/vault_session.rs` 的会话 schema——落盘 / 读取
// 时的 sanitize 边界）各有一份。任一侧漂移都不会有运行期症状：只会在某天「盘上存的比例与界面
// 允许的区间不一致」或「schema 放行了第 3 个 pane，界面却只肯建 2 个」。
//
// 机制仿 `registry-drift.test.ts`：读 Rust 源文本解析那四个常量，与 TS 侧逐项比对；任一方向
// 漂移都红。反向输入（把源串改一个数字）确认断言有区分度（REVIEW.md 第 1 条：断言必须能对
// 一个「必须让它 FAIL 的输入」判红）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SPLIT_RATIO,
  MAX_PANES,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
} from "../../src/pane-layout.ts";

const RUST_SOURCE = readFileSync(
  new URL("../../src-tauri/src/vault_session.rs", import.meta.url),
  "utf8",
);

/** `vault_session.rs` 里一个数值常量（`pub const NAME: usize|f64 = V;`）。 */
function rustConst(source: string, name: string): number {
  const match = new RegExp(`pub const ${name}: (?:usize|f64) = ([0-9.]+);`).exec(source);
  assert.ok(match !== null, `vault_session.rs 里找不到常量 ${name} 的声明`);
  return Number(match[1]);
}

test("对账：pane 域常量在 Rust 会话 schema 与 TS pane 模块同值", () => {
  assert.equal(rustConst(RUST_SOURCE, "MAX_PANES"), MAX_PANES);
  assert.equal(rustConst(RUST_SOURCE, "SPLIT_RATIO_MIN"), SPLIT_RATIO_MIN);
  assert.equal(rustConst(RUST_SOURCE, "SPLIT_RATIO_MAX"), SPLIT_RATIO_MAX);
  assert.equal(rustConst(RUST_SOURCE, "DEFAULT_SPLIT_RATIO"), DEFAULT_SPLIT_RATIO);
  // 区间顺序自洽（两端反了就钳不出任何比例）
  assert.ok(SPLIT_RATIO_MIN < SPLIT_RATIO_MAX);
  assert.ok(SPLIT_RATIO_MIN <= DEFAULT_SPLIT_RATIO && DEFAULT_SPLIT_RATIO <= SPLIT_RATIO_MAX);
});

test("对账的反向输入：源里任一常量被改掉都必须判不等（断言有区分度）", () => {
  assert.notEqual(
    rustConst(RUST_SOURCE.replace("MAX_PANES: usize = 2", "MAX_PANES: usize = 3"), "MAX_PANES"),
    MAX_PANES,
    "Rust 放行第 3 个 pane 时必须判不等",
  );
  assert.notEqual(
    rustConst(
      RUST_SOURCE.replace("SPLIT_RATIO_MIN: f64 = 0.2", "SPLIT_RATIO_MIN: f64 = 0.1"),
      "SPLIT_RATIO_MIN",
    ),
    SPLIT_RATIO_MIN,
    "Rust 的钳制下限漂移必须判不等",
  );
  assert.notEqual(
    rustConst(
      RUST_SOURCE.replace("DEFAULT_SPLIT_RATIO: f64 = 0.5", "DEFAULT_SPLIT_RATIO: f64 = 0.4"),
      "DEFAULT_SPLIT_RATIO",
    ),
    DEFAULT_SPLIT_RATIO,
    "缺省比例漂移必须判不等",
  );
});
