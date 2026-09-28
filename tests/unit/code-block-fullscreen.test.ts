// src/code-block-fullscreen.ts（遮罩状态机，经 src/overlay-state.ts）与
// src/preview/code-block-content.ts（整块源码 → 行 / token 计划）的纯逻辑单测
//（M277，change code-block-fullscreen 的 tasks 4.1 / 4.2）。
//
// 为什么这一部分落在本层：四条关闭路径（三条用户路径 + 一条焦点兜底）必须回到同一个收尾，
// 「关闭之后焦点归谁」只有一处判据——这类守卫用真 DOM 验就得造 DOM 替身（本层纪律不允许，
// 见 tests/unit/README.md）。DOM 只经 CodeBlockFullscreenSurface 进出，这里注入假 surface，
// 断言的是**转换本身**与**文本切分本身**。
//
// 不在这一层（DOM 行为，归 tests/visual/scenes/m277-code-block-fullscreen.spec.ts 与真机场景
// 62）：遮罩真实开合、内容几何、折行两口径的滚动几何、命中条件（caret 在块内 / 容器持焦 / code
// 模式恒假）——最后一条要 view，无 DOM 的层里写出来只会是恒真断言（REVIEW.md 第 1 条）。
//
// **阅读位置不变量（关闭交还焦点 MUST NOT 拽走视口）在本层测不到**：它是浏览器在聚焦时的视口
// 行为，chromium 结构性看不见（M274 的消融实验）。守卫分两层：视觉场景的位置断言（回归护栏）
// 与真机场景 62 的渲染行读数（判别层）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCodeBlockFullscreenState } from "../../src/code-block-fullscreen.ts";
import type { CodeBlockFullscreenSurface } from "../../src/code-block-fullscreen.ts";
import { createOverlayState } from "../../src/overlay-state.ts";
import { planCodeBlock } from "../../src/preview/code-block-content.ts";
import type { CodeBlockRender } from "../../src/preview/code-block-content.ts";
import { MAX_CODE_HIGHLIGHT_CHARS } from "../../src/preview/code.ts";
import { CODEBLOCK_FS_TRIGGER_LABEL, blockCopyLabel } from "../../src/preview/block-trigger.ts";

// 显式标类型（不用 `as const`：`CodeBlockRender.lines` 是可变的 `CodeBlockLine[]`，只读元组
// 不能赋值给它——gate 的 tsc-units 会红）。
const RENDER: CodeBlockRender = { kind: "lines", lines: [{ text: "x", head: false, tokens: [] }] };
const LABEL = "Markdown 代码块 2";

function fakeSurface() {
  const calls: string[] = [];
  const surface: CodeBlockFullscreenSurface = {
    load: (render, label) =>
      void calls.push(`load:${render.kind === "lines" ? render.lines.length : "plain"}:${label}`),
    show: () => void calls.push("show"),
    hide: () => void calls.push("hide"),
    focus: () => void calls.push("focus"),
    restoreFocus: () => void calls.push("restoreFocus"),
  };
  return { calls, surface };
}

// ---------------------------------------------------------------------------
// 遮罩状态机
// ---------------------------------------------------------------------------

test("打开：装内容 → 显示 → 持焦，状态转为打开", () => {
  const { calls, surface } = fakeSurface();
  const state = createCodeBlockFullscreenState(surface);
  assert.equal(state.isOpen(), false);

  state.open(RENDER, LABEL);
  // 持焦在显示之后：aria-modal 的语义要求「遮罩可见时焦点在遮罩上」。
  assert.deepEqual(calls, [`load:1:${LABEL}`, "show", "focus"]);
  assert.equal(state.isOpen(), true);
});

test("Esc 就地消费并关闭、交还焦点；其余 token 不消费也不关闭", () => {
  const { calls, surface } = fakeSurface();
  const state = createCodeBlockFullscreenState(surface);

  // 未打开时按 Esc：消费（避免落到 window 上的分发器）但不产生任何收尾动作。
  assert.equal(state.handleKeyToken("Escape"), true);
  assert.deepEqual(calls, []);

  state.open(RENDER, LABEL);
  calls.length = 0;
  assert.equal(state.handleKeyToken("j"), false);
  assert.deepEqual(calls, []);
  assert.equal(state.isOpen(), true);

  assert.equal(state.handleKeyToken("Escape"), true);
  assert.deepEqual(calls, ["hide", "restoreFocus"]);
  assert.equal(state.isOpen(), false);
});

test("四条关闭路径回同一个收尾：toggle / overlay 交还焦点，blur 不交还", () => {
  for (const reason of ["toggle", "overlay", "escape"] as const) {
    const { calls, surface } = fakeSurface();
    const state = createCodeBlockFullscreenState(surface);
    state.open(RENDER, LABEL);
    calls.length = 0;
    state.close(reason);
    assert.deepEqual(calls, ["hide", "restoreFocus"], `${reason} 应收尾并交还焦点`);
    assert.equal(state.isOpen(), false);
  }

  // blur 兜底：关闭但**不抢焦点**（焦点去向由触发它的一方决定）。
  const { calls, surface } = fakeSurface();
  const state = createCodeBlockFullscreenState(surface);
  state.open(RENDER, LABEL);
  calls.length = 0;
  state.close("blur");
  assert.deepEqual(calls, ["hide"]);
  assert.equal(state.isOpen(), false);
});

test("已关闭后的迟到关闭是空操作；开-关-开序列成立", () => {
  const { calls, surface } = fakeSurface();
  const state = createCodeBlockFullscreenState(surface);
  state.close("escape");
  assert.deepEqual(calls, []);

  state.open(RENDER, LABEL);
  state.close("toggle");
  calls.length = 0;
  state.close("toggle"); // 迟到的那次
  assert.deepEqual(calls, [], "关闭之后不该再走一遍收尾（否则会把焦点抢回来）");
  state.open(RENDER, LABEL);
  assert.equal(state.isOpen(), true);
});

test("状态机是共用的一份（表格全屏与代码块全屏同源）", () => {
  // 形态守卫：同一份 createOverlayState 既能驱动 HTMLElement（表格）也能驱动渲染计划
  //（代码块）——两张浮层的关闭语义因此不可能各写一套而漂移（REVIEW.md 第 8 条）。
  const seen: string[] = [];
  const state = createOverlayState<number>({
    load: (n) => void seen.push(`load:${n}`),
    show: () => void seen.push("show"),
    hide: () => void seen.push("hide"),
    focus: () => void seen.push("focus"),
    restoreFocus: () => void seen.push("restoreFocus"),
  });
  state.open(7, "L");
  assert.deepEqual(seen, ["load:7", "show", "focus"]);
});

// ---------------------------------------------------------------------------
// 内容计划：源码 → 行 / token
// ---------------------------------------------------------------------------

test("围栏块：首行是头部条、内容行带 token、围栏行不带 token", () => {
  const source = "```js\nlet a = 1;\n```";
  const code = "let a = 1;";
  const render = planCodeBlock(source, 6, code, true, "js");
  assert.equal(render.kind, "lines");
  if (render.kind !== "lines") return;
  assert.deepEqual(
    render.lines.map((l) => l.text),
    ["```js", "let a = 1;", "```"],
  );
  assert.deepEqual(
    render.lines.map((l) => l.head),
    [true, false, false],
    "只有首行（起始围栏）是头部条",
  );
  const keyword = render.lines[1].tokens.find((t) => t.cls === "cm-lp-tok-keyword");
  assert.ok(keyword, "内容行应有 keyword token");
  assert.equal(render.lines[1].text.slice(keyword.from, keyword.to), "let");
  assert.deepEqual(render.lines[0].tokens, [], "围栏行不着色");
  assert.deepEqual(render.lines[2].tokens, [], "尾围栏是普通代码行但不着色");
});

test("缩进块：没有头部条、没有 info string 因此不着色", () => {
  const source = "    indented 1\n    indented 2";
  const render = planCodeBlock(source, 0, "indented 1\nindented 2", false, "");
  assert.equal(render.kind, "lines");
  if (render.kind !== "lines") return;
  assert.deepEqual(
    render.lines.map((l) => l.head),
    [false, false],
  );
  assert.deepEqual(render.lines[0].tokens, []);
});

test("token 按行裁切，跨行的相邻区间不越界", () => {
  const source = "```js\nlet a = 1;\nlet b = 2;\n```";
  const code = "let a = 1;\nlet b = 2;";
  const render = planCodeBlock(source, 6, code, true, "js");
  assert.equal(render.kind, "lines");
  if (render.kind !== "lines") return;
  for (const line of render.lines) {
    for (const token of line.tokens) {
      assert.ok(token.from >= 0 && token.to <= line.text.length, `token 越界：${JSON.stringify(token)}`);
    }
  }
  assert.ok(render.lines[1].tokens.length > 0 && render.lines[2].tokens.length > 0, "两行内容都应有 token");
});

test("空块：一行空文本（不是零行）", () => {
  const render = planCodeBlock("```\n```", 4, "", true, "");
  assert.equal(render.kind, "lines");
  if (render.kind !== "lines") return;
  assert.equal(render.lines.length, 2);
  assert.deepEqual(render.lines.map((l) => l.text), ["```", "```"]);
});

test("超过单块着色上限：整块以单块纯文本呈现，源码逐字节一致", () => {
  // 上界取自 src/preview/code.ts 的既有阈值（MUST NOT 另立新阈值）。
  const body = "x".repeat(MAX_CODE_HIGHLIGHT_CHARS + 10);
  const source = `\`\`\`\n${body}\n\`\`\``;
  const render = planCodeBlock(source, 4, body, true, "");
  assert.equal(render.kind, "plain");
  if (render.kind !== "plain") return;
  assert.equal(render.text, source, "退化分支必须是同一份源码、逐字节一致");
});

// ---------------------------------------------------------------------------
// 文案 deck（D153 / D156）逐字钉住
// ---------------------------------------------------------------------------

test("块级触发钮的读屏名与文案 deck 逐字一致", () => {
  assert.equal(CODEBLOCK_FS_TRIGGER_LABEL(), "放大查看代码块");
  assert.equal(blockCopyLabel("table"), "复制表格");
  assert.equal(blockCopyLabel("codeblock"), "复制代码块");
});
