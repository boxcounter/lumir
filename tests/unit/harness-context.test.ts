// 上下文组装（M343，change add-harness-quote-cards 的「上下文注入与可见性」修订；
// M412 视口原文移除同据该 spec 条款）：
// spec 口径——路径 SHALL 始终注入；视口注入只在**消息未携带引用卡片**时发生（携带时跳过：
// 用户已显式策展），且只注入**行号**、不注入该范围原文（M412）；选区 SHALL NOT 自动注入
// （由摘录卡片手势承接，assemble 里已无选区分支，本层用例钉住新形状的输入输出）。
//
// 零 DOM 环境（tests/unit/README.md）：EditorState 用真的（pane-layout.test.ts 同款），
// 句柄是结构替身（HarnessContextSource 窄接口的意义就在此）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import {
  assembleHarnessContext,
  collapseMiddleDirs,
  serializeHarnessContext,
} from "../../src/harness-context.ts";
import type { HarnessContextSource } from "../../src/harness-context.ts";

function source(doc: string, viewport: { from: number; to: number }, path?: string): HarnessContextSource {
  return {
    activeSession: () => ({ path }),
    view: { state: EditorState.create({ doc }), viewport },
  };
}

test("assemble：无卡片时注入路径 + 视口行号（对齐整行、不带原文）", () => {
  const doc = "第一行\n第二行\n第三行\n第四行";
  // 视口落在第二行中段 → 第三行末：对齐整行后应取第 2–3 行（只给行号）。
  const block = assembleHarnessContext(source(doc, { from: 6, to: 10 }, "notes/a.md"));
  assert.deepEqual(block, {
    path: "notes/a.md",
    viewport_range: { from_line: 2, to_line: 3 },
  });
  // 序列化形状（context_json 契约）：viewport_range 只有行号，**无 text 键**——原文不进
  // 注入（M412）；用 JSON 层断言而非仅对象形状，因为它就是 Rust 侧 parse_context 读的那串。
  const json = JSON.parse(serializeHarnessContext(block!));
  assert.deepEqual(json.viewport_range, { from_line: 2, to_line: 3 });
  assert.equal("text" in json.viewport_range, false);
  assert.equal(serializeHarnessContext(block!).includes("第二行"), false);
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
  // 选区非空也不产生 selection 块：注入物是路径 + 视口（整条文档的行号，无原文）。
  assert.deepEqual(block, {
    path: "notes/a.md",
    viewport_range: { from_line: 1, to_line: 3 },
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

// ── 上下文 chip 的路径折叠（M606，Alex 2026-10-19 裁决：文件名永远完整显示，中间目录
//    折叠成省略号，hover 出全路径）─────────────────────────────────────────────────────
// 折叠的判据是「有没有中间目录」：根目录文件与一层目录都没有中间目录，原样显示；两层及以上
// 目录才有中间可省，折叠成「…/文件名」。文件名一律取末段、恒完整——它是文件身份的主体。

test("collapseMiddleDirs：两层及以上目录折叠为 …/文件名（文件名恒完整）", () => {
  assert.equal(
    collapseMiddleDirs("projects/2026/archive/weekly.md"),
    "…/weekly.md",
  );
  // 恰好两层目录也折叠：省略号表达的是「中间目录」，两层时首层就是中间目录。
  assert.equal(collapseMiddleDirs("notes/archive/weekly.md"), "…/weekly.md");
  // 折叠保留末段原文（含空格 / 中文 / 点号，不做任何改写）。
  assert.equal(collapseMiddleDirs("a/b/会议 记录.v2.md"), "…/会议 记录.v2.md");
});

test("collapseMiddleDirs：浅层路径原样——根目录文件与一层目录都不折", () => {
  assert.equal(collapseMiddleDirs("weekly.md"), "weekly.md");
  assert.equal(collapseMiddleDirs("notes/weekly.md"), "notes/weekly.md");
  // 区分度对照：同一条路径多一层目录即折叠，浅层的两条都不动。
  assert.equal(collapseMiddleDirs("notes/2026/weekly.md"), "…/weekly.md");
});

test("collapseMiddleDirs：边界输入不产出伪造读数", () => {
  // 空串（调用方本不该传，但纯函数不抛）与仅分隔符：原样返回，不编造「…/」。
  assert.equal(collapseMiddleDirs(""), "");
  assert.equal(collapseMiddleDirs("/"), "/");
  // 重复分隔符不虚增目录层数：两层空段滤掉后只剩一层 → 不折。
  assert.equal(collapseMiddleDirs("notes//weekly.md"), "notes//weekly.md");
  // 末段为空（尾斜杠）时没有文件名可作身份主体，原样返回而不是折成「…/」。
  assert.equal(collapseMiddleDirs("notes/archive/"), "notes/archive/");
  assert.equal(collapseMiddleDirs("notes/archive/deep/"), "notes/archive/deep/");
});
