// 上下文组装（M343，change add-harness-quote-cards 的「上下文注入与可见性」修订）：
// spec 口径——路径 SHALL 始终注入；视口注入只在**消息未携带引用卡片**时发生（携带时
// 跳过：用户已显式策展）；选区 SHALL NOT 自动注入（由摘录卡片手势承接，assemble 里
// 已无选区分支，本层用例钉住新形状的输入输出）。
//
// 零 DOM 环境（tests/unit/README.md）：EditorState 用真的（pane-layout.test.ts 同款），
// 句柄是结构替身（HarnessContextSource 窄接口的意义就在此）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  assembleHarnessContext,
  serializeHarnessContext,
} from "../../src/harness-context.ts";
import type { HarnessContextSource } from "../../src/harness-context.ts";

function source(doc: string, viewport: { from: number; to: number }, path?: string): HarnessContextSource {
  return {
    activeSession: () => ({ path }),
    view: { state: EditorState.create({ doc }), viewport },
  };
}

test("assemble：无卡片时注入路径 + 视口（对齐整行）", () => {
  const doc = "第一行\n第二行\n第三行\n第四行";
  // 视口落在第二行中段 → 第三行末：对齐整行后应取第 2–3 行的整行文本。
  const block = assembleHarnessContext(source(doc, { from: 6, to: 10 }, "notes/a.md"));
  assert.deepEqual(block, {
    path: "notes/a.md",
    viewport_range: { from_line: 2, to_line: 3, text: "第二行\n第三行" },
  });
});

test("assemble：携带卡片（skipViewport）→ 只注入路径，无 viewport_range", () => {
  const doc = "第一行\n第二行";
  const block = assembleHarnessContext(
    source(doc, { from: 0, to: 3 }, "notes/a.md"),
    { skipViewport: true },
  );
  assert.deepEqual(block, { path: "notes/a.md" });
  // 序列化形状：path 在场、无 selection / viewport_range 键（Rust parse_context 宽容口径）。
  const json = JSON.parse(serializeHarnessContext(block!));
  assert.equal(json.path, "notes/a.md");
  assert.equal("viewport_range" in json, false);
  assert.equal("selection" in json, false);
});

test("assemble：选区存在但不改变结果——选区不再进自动上下文（卡片手势承接）", () => {
  const doc = "第一行\n第二行\n第三行";
  const withSelection: HarnessContextSource = {
    activeSession: () => ({ path: "notes/a.md" }),
    view: {
      state: EditorState.create({
        doc,
        selection: { anchor: 1, head: 4 },
      }),
      viewport: { from: 0, to: doc.length },
    },
  };
  const block = assembleHarnessContext(withSelection);
  // 选区非空也不产生 selection 块：注入物是路径 + 视口（整条文档）。
  assert.deepEqual(block, {
    path: "notes/a.md",
    viewport_range: { from_line: 1, to_line: 3, text: doc },
  });
});

test("assemble：无活动文件路径 → null（chip 显示「无」，不伪造路径）", () => {
  assert.equal(assembleHarnessContext(source("abc", { from: 0, to: 3 }, undefined)), null);
  assert.equal(
    assembleHarnessContext(source("abc", { from: 0, to: 3 }, undefined), { skipViewport: true }),
    null,
  );
});

test("assemble：skipViewport 缺省视为 false（旧调用形态不变）", () => {
  const block = assembleHarnessContext(source("abc", { from: 0, to: 3 }, "a.md"));
  assert.equal(block?.viewport_range?.from_line, 1);
});
