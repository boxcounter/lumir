// 折行口径的纯判定单测（M180，change line-wrap-options；M247 起正文行按模式分叉）：各组合 +
// 模式边界 + 两侧默认值对账。
//
// 为什么这一层只测判定：装配要 DOM（真 EditorView 起不来，见 harness.ts 的口径），而判定是纯
// 函数（src/preview/theme.ts 的 wrapSpec）。装配后的真实呈现由
// tests/visual/scenes/render-codeblock.spec.ts（md 侧）与 m247-code-mode-line-wrap.spec.ts
// （code 侧分叉）覆盖，真机场景见 scripts/acceptance 的既有折行场景。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODEBLOCK_NOWRAP_CLASS,
  CODEBLOCK_WRAP_CLASS,
  DEFAULT_CODE_BLOCK_WRAP,
  DEFAULT_CODE_MODE_LINE_WRAP,
  DEFAULT_LINE_WRAP,
  wrapSpec,
} from "../../src/preview/theme.ts";

/** 一次判定的输入（三项折行口径），测试里按需覆写。 */
const wrap = (over: Partial<Parameters<typeof wrapSpec>[1]> = {}) => ({
  lineWrap: DEFAULT_LINE_WRAP,
  codeBlockWrap: DEFAULT_CODE_BLOCK_WRAP,
  codeModeLineWrap: DEFAULT_CODE_MODE_LINE_WRAP,
  ...over,
});

test("md 侧四组合逐格对应 spec 的判定表", () => {
  for (const lineWrap of [true, false]) {
    for (const codeBlockWrap of [true, false]) {
      const spec = wrapSpec("md", wrap({ lineWrap, codeBlockWrap }));
      assert.deepEqual(spec, {
        lineWrapping: lineWrap,
        codeBlockClass: codeBlockWrap ? CODEBLOCK_WRAP_CLASS : CODEBLOCK_NOWRAP_CLASS,
      });
    }
  }
});

test("一元素一条规则：md 模式的正文行只看 lineWrap、代码块行只看 codeBlockWrap", () => {
  // 区分度在这里——把另一个轴翻转，本轴的结论必须不变（写反了或串了轴，下面四条必红）
  for (const codeBlockWrap of [true, false]) {
    assert.equal(wrapSpec("md", wrap({ lineWrap: false, codeBlockWrap })).lineWrapping, false, "lineWrap=false 时正文行不折行");
    assert.equal(wrapSpec("md", wrap({ lineWrap: true, codeBlockWrap })).lineWrapping, true, "lineWrap=true 时正文行折行");
  }
  for (const lineWrap of [true, false]) {
    assert.equal(
      wrapSpec("md", wrap({ lineWrap, codeBlockWrap: false })).codeBlockClass,
      CODEBLOCK_NOWRAP_CLASS,
      "codeBlockWrap=false 时代码块拿到不折行 class",
    );
    assert.equal(
      wrapSpec("md", wrap({ lineWrap, codeBlockWrap: true })).codeBlockClass,
      CODEBLOCK_WRAP_CLASS,
      "codeBlockWrap=true 时代码块拿到折行 class",
    );
  }
});

test("两模式分叉（M247）：code 模式正文行只看 codeModeLineWrap，md 侧两键对它无可观测效果", () => {
  // 正向：code 模式的正文行随 codeModeLineWrap 走。
  assert.equal(wrapSpec("code", wrap({ codeModeLineWrap: true })).lineWrapping, true, "显式打开时 code 模式折行");
  assert.equal(wrapSpec("code", wrap({ codeModeLineWrap: false })).lineWrapping, false, "出厂口径下 code 模式不折行");

  // 判别性在这里：翻转 md 那两轴，code 模式的结论必须一字不变（实现若把 code 分支写成再读
  // `lineWrap`，下面两条立刻红——REVIEW.md 第 1 条：单案例只能证明那个案例被修好）。
  for (const lineWrap of [true, false]) {
    for (const codeBlockWrap of [true, false]) {
      assert.equal(
        wrapSpec("code", wrap({ lineWrap, codeBlockWrap })).lineWrapping,
        DEFAULT_CODE_MODE_LINE_WRAP,
        `lineWrap=${lineWrap} / codeBlockWrap=${codeBlockWrap} 不得改写 code 模式的口径`,
      );
    }
  }
  // 反向：code 模式的轴对 md 模式无可观测效果。
  for (const codeModeLineWrap of [true, false]) {
    assert.equal(wrapSpec("md", wrap({ codeModeLineWrap })).lineWrapping, true, "md 模式仍只读 lineWrap");
  }
});

test("code 模式没有代码块层：不装没有消费者的内容级 class", () => {
  for (const lineWrap of [true, false]) {
    for (const codeBlockWrap of [true, false]) {
      for (const codeModeLineWrap of [true, false]) {
        const spec = wrapSpec("code", wrap({ lineWrap, codeBlockWrap, codeModeLineWrap }));
        assert.equal(spec.codeBlockClass, null, "非 md 模式 MUST NOT 装代码块内容级 class");
      }
    }
  }
});

test("出厂默认与 Rust `EditorConfig::default` 同值（两处真源对账，含 M247 的分叉）", () => {
  // Rust 侧的真源是 src-tauri/src/config.rs 的 `impl Default for EditorConfig`，
  // 那边由单测 missing_editor_wrap_fields_take_defaults /
  // missing_code_mode_line_wrap_takes_factory_false 钉住同一组值。
  assert.equal(DEFAULT_LINE_WRAP, true, "缺配置时 md 模式正文行折行");
  assert.equal(DEFAULT_CODE_BLOCK_WRAP, false, "缺配置时代码块不折行");
  assert.equal(DEFAULT_CODE_MODE_LINE_WRAP, false, "缺配置时 code 模式正文行不折行");
  // 出厂默认即「md 折 / code 不折」的分叉（spec 的「缺字段时取出厂分叉」scenario 的呈现）
  assert.equal(wrapSpec("md", wrap()).lineWrapping, true);
  assert.equal(wrapSpec("code", wrap()).lineWrapping, false);
});