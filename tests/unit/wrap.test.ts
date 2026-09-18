// 折行口径的纯判定单测（M180，change line-wrap-options）：四组合 + 模式边界 + 两侧默认值对账。
//
// 为什么这一层只测判定：装配要 DOM（真 EditorView 起不来，见 harness.ts 的口径），而判定是纯
// 函数（src/preview/theme.ts 的 wrapSpec）。装配后的真实呈现由
// tests/visual/scenes/render-codeblock.spec.ts 与真机套件（scripts/acceptance）覆盖。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODEBLOCK_NOWRAP_CLASS,
  CODEBLOCK_WRAP_CLASS,
  DEFAULT_CODE_BLOCK_WRAP,
  DEFAULT_LINE_WRAP,
  wrapSpec,
} from "../../src/preview/theme.ts";

test("折行四组合逐格对应 spec 的判定表", () => {
  assert.deepEqual(wrapSpec("md", true, false), {
    lineWrapping: true,
    codeBlockClass: CODEBLOCK_NOWRAP_CLASS,
  });
  assert.deepEqual(wrapSpec("md", true, true), {
    lineWrapping: true,
    codeBlockClass: CODEBLOCK_WRAP_CLASS,
  });
  assert.deepEqual(wrapSpec("md", false, false), {
    lineWrapping: false,
    codeBlockClass: CODEBLOCK_NOWRAP_CLASS,
  });
  assert.deepEqual(wrapSpec("md", false, true), {
    lineWrapping: false,
    codeBlockClass: CODEBLOCK_WRAP_CLASS,
  });
});

test("一元素一条规则：正文行只看 lineWrap、代码块行只看 codeBlockWrap", () => {
  // 区分度在这里——把另一个轴翻转，本轴的结论必须不变（写反了或串了轴，下面四条必红）
  for (const codeBlockWrap of [true, false]) {
    assert.equal(wrapSpec("md", false, codeBlockWrap).lineWrapping, false, "lineWrap=false 时正文行不折行");
    assert.equal(wrapSpec("md", true, codeBlockWrap).lineWrapping, true, "lineWrap=true 时正文行折行");
  }
  for (const lineWrap of [true, false]) {
    assert.equal(
      wrapSpec("md", lineWrap, false).codeBlockClass,
      CODEBLOCK_NOWRAP_CLASS,
      "codeBlockWrap=false 时代码块拿到不折行 class",
    );
    assert.equal(
      wrapSpec("md", lineWrap, true).codeBlockClass,
      CODEBLOCK_WRAP_CLASS,
      "codeBlockWrap=true 时代码块拿到折行 class",
    );
  }
});

test("code 模式没有代码块层：不装没有消费者的内容级 class", () => {
  for (const lineWrap of [true, false]) {
    for (const codeBlockWrap of [true, false]) {
      const spec = wrapSpec("code", lineWrap, codeBlockWrap);
      assert.equal(spec.codeBlockClass, null, "非 md 模式 MUST NOT 装代码块内容级 class");
      assert.equal(spec.lineWrapping, lineWrap, "只读 code 模式的正文行走文件级口径");
    }
  }
});

test("出厂默认与 Rust `EditorConfig::default` 同值（两处真源对账）", () => {
  // Rust 侧的真源是 src-tauri/src/config.rs 的 `impl Default for EditorConfig`，
  // 那边由单测 missing_editor_wrap_fields_take_defaults 钉住同一对值。
  assert.equal(DEFAULT_LINE_WRAP, true, "缺配置时正文行折行");
  assert.equal(DEFAULT_CODE_BLOCK_WRAP, false, "缺配置时代码块不折行");
  // 出厂默认即 spec「缺字段时取默认」那条 scenario 的呈现
  assert.deepEqual(wrapSpec("md", DEFAULT_LINE_WRAP, DEFAULT_CODE_BLOCK_WRAP), {
    lineWrapping: true,
    codeBlockClass: CODEBLOCK_NOWRAP_CLASS,
  });
});
