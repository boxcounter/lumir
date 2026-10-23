// 会话档判据的单测（M629，change add-image-file-preview §1.2）。
//
// `isDocSession` 是「这个会话是不是文本文档」的**单一判据**，保存链路三入口、搜索面板、
// 大纲、阅读位置、modeline 右段全部经它把关（各入口的判别性用例见 save-controller.test.ts
// 与 tabs.test.ts）。这一层只钉判据本身与它的**反例形态**。

import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocSession } from "../../src/session-kind.ts";

test("isDocSession：只有 kind === 'doc' 算文本文档", () => {
  assert.equal(isDocSession({ kind: "doc" }), true);
  assert.equal(isDocSession({ kind: "image" }), false);
});

test("isDocSession：缺字段 / 脏值一律**不**算文档（宁可不保存，也不写错文件）", () => {
  // 判别方向是有意的：判据的默认回答是「不是文档」——一个形状不完整的会话若被当成文档，
  // ⌘S 就会把它的内存内容写回它 path 指向的那个文件（design §1.2 的红线）。
  assert.equal(isDocSession({} as { kind: "doc" }), false);
  assert.equal(isDocSession({ kind: undefined } as unknown as { kind: "doc" }), false);
});
