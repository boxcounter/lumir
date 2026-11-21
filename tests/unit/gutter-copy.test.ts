// 行号 gutter 右键复制的纯取值层（change gutter-copy-path-line-nov21）：
// `pathLineText` 是 `{path}:{line}` 的唯一拼法。DOM 接线（右键 → 端口）归
// tests/visual/scenes/gutter-copy-path-line.spec.ts，剪贴板失败面也归那一层（真浏览器权限 / API 拒绝）。
import assert from "node:assert/strict";
import { test } from "node:test";
import { pathLineText } from "../../src/gutter-copy.ts";

test("pathLineText：vault 相对路径 + 1 基行号，精确 `{path}:{line}`", () => {
  assert.equal(pathLineText("notes/plan.md", 1), "notes/plan.md:1");
  assert.equal(pathLineText("notes/plan.md", 42), "notes/plan.md:42");
});

test("pathLineText：路径里的空格与中文逐字保留", () => {
  assert.equal(pathLineText("笔记/日本 旅行.md", 12), "笔记/日本 旅行.md:12");
});

test("pathLineText：vault 外绝对路径逐字保留（不改成相对路径）", () => {
  assert.equal(pathLineText("/tmp/lumir-gutter-copy/外部 笔记.md", 1), "/tmp/lumir-gutter-copy/外部 笔记.md:1");
});

test("pathLineText：首行 / 末行都是 1 基，且输出没有字面花括号", () => {
  const first = pathLineText("a.md", 1);
  const last = pathLineText("a.md", 9999);
  assert.equal(first, "a.md:1");
  assert.equal(last, "a.md:9999");
  assert.ok(!first.includes("{") && !first.includes("}"));
  assert.ok(!last.includes("{") && !last.includes("}"));
});
