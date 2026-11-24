// change add-default-note-name-nov24：新建文件的默认名（纯逻辑层；Alex 2026-11-25 裁决
// 改为始终启用，不设设置项）。
//
// 这一层只钉两件可脱离 DOM 判定的东西：
//   1. `uniqueNewNoteName` 的撞名递增——判据必须落在**最终落盘名**（补 `.md` 之后）上，
//      与 `withDefaultFileExtension` 同源；
//   2. 默认名的两档文案（zh `未命名笔记` / en `Untitled note`）来自 copy 表，不在代码里写第二份。
//
// DOM 面（预填后是否全选、Esc / Enter 的行为）归 `tests/visual/scenes/default-note-name-nov24.spec.ts`
// 与真机场景 728；本层不造 DOM 替身去模拟 selection。

import { test } from "node:test";
import assert from "node:assert/strict";
import { uniqueNewNoteName, withDefaultFileExtension } from "../../src/tree.ts";
import { t } from "../../src/copy.ts";

test("uniqueNewNoteName：无撞名时原样返回基础名（不含 .md）", () => {
  assert.equal(uniqueNewNoteName("未命名笔记", new Set()), "未命名笔记");
  assert.equal(uniqueNewNoteName("Untitled note", new Set()), "Untitled note");
});

test("uniqueNewNoteName：对最终落盘名判撞（既有 未命名笔记.md 让位）", () => {
  const siblings = new Set(["未命名笔记.md"]);
  assert.equal(uniqueNewNoteName("未命名笔记", siblings), "未命名笔记 2");
});

test("uniqueNewNoteName：连续撞号取第一个空位，不跳过缺口", () => {
  assert.equal(
    uniqueNewNoteName("未命名笔记", new Set(["未命名笔记.md", "未命名笔记 2.md"])),
    "未命名笔记 3",
  );
  assert.equal(
    uniqueNewNoteName(
      "未命名笔记",
      new Set(["未命名笔记.md", "未命名笔记 3.md"]),
    ),
    "未命名笔记 2",
  );
});

test("uniqueNewNoteName：目录同名不误判（目录 未命名笔记 与文件 未命名笔记.md 不同名）", () => {
  assert.equal(uniqueNewNoteName("未命名笔记", new Set(["未命名笔记"])), "未命名笔记");
});

test("uniqueNewNoteName：英文基础名同样递增", () => {
  assert.equal(
    uniqueNewNoteName("Untitled note", new Set(["Untitled note.md", "Untitled note 2.md"])),
    "Untitled note 3",
  );
});

test("uniqueNewNoteName：Unicode / CJK 与带空格的基础名原样保留", () => {
  const base = "未命名笔记 · 草稿";
  assert.equal(uniqueNewNoteName(base, new Set([`${base}.md`])), `${base} 2`);
});

test("uniqueNewNoteName：返回的是主文件名，补 .md 交给 withDefaultFileExtension", () => {
  const name = uniqueNewNoteName("未命名笔记", new Set(["未命名笔记.md"]));
  assert.equal(withDefaultFileExtension(name), "未命名笔记 2.md");
  assert.equal(name.includes(".md"), false);
});

test("默认名文案：zh / en 两列", () => {
  assert.equal(t("D984", undefined, "zh"), "未命名笔记");
  assert.equal(t("D984", undefined, "en"), "Untitled note");
});
