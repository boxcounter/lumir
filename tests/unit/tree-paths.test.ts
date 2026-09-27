// 文件树条目操作的纯逻辑（M244，change file-tree-context-menu）：路径拼接、末段名校验矩阵、
// 改名后的路径 remap、以及忽略集与 Rust 侧的双表对账。
//
// 这一层只跑**无 DOM** 的判定：菜单浮层与确认框的 DOM 行为在
// tests/unit/tree-menu.test.ts（手写 DOM 替身）与 tests/visual/scenes/tree-menu.spec.ts
// （chromium 里的真 app）两处覆盖；编辑器会话的 remap 副作用（dirty / 滚动 / revision 保留）
// 由真机场景 47 覆盖——本文件只钉纯函数的那一半。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  IGNORED_NAMES,
  relativePathOf,
  remapPathAfterRename,
  validateEntryName,
  vaultAbsolutePath,
} from "../../src/tree.ts";

const FS_IO_SOURCE = readFileSync(new URL("../../src-tauri/src/fs_io.rs", import.meta.url), "utf8");

test("复制完整路径：vault 根 + 相对路径 = 绝对路径（裁决点 4）", () => {
  assert.equal(vaultAbsolutePath("/vault", "sub/a.md"), "/vault/sub/a.md");
  assert.equal(vaultAbsolutePath("/vault", "a.md"), "/vault/a.md");
  // 根自身（理论上菜单不会挂在根上，但拼接口径必须自洽）
  assert.equal(vaultAbsolutePath("/vault", ""), "/vault");
  // 根带尾斜杠时不拼出双斜杠
  assert.equal(vaultAbsolutePath("/vault/", "a.md"), "/vault/a.md");
  assert.equal(vaultAbsolutePath("/", "a.md"), "/a.md");
});

test("末段名校验矩阵：非法逐项有原因，合法逐项放行", () => {
  const siblings = new Set(["note.md", "sub"]);
  const cases: Array<[string, string | undefined, string]> = [
    ["", "名称不能为空", "空名"],
    ["   ", "名称不能为空", "只有空白（trim 后为空）"],
    ["a/b", "名称不能包含斜杠：a/b", "含斜杠"],
    ["/abs.md", "名称不能包含斜杠：/abs.md", "以斜杠开头（绝路径形态）"],
    [".", ". 不是有效的名称", "单点"],
    ["..", ".. 不是有效的名称", "双点"],
    [".git", ".git 在忽略集内，建成后不会出现在文件树里", "忽略集 .git"],
    [".DS_Store", ".DS_Store 在忽略集内，建成后不会出现在文件树里", "忽略集 .DS_Store"],
    ["node_modules", "node_modules 在忽略集内，建成后不会出现在文件树里", "忽略集 node_modules"],
    ["note.md", "已存在同名条目：note.md", "撞名（文件）"],
    ["sub", "已存在同名条目：sub", "撞名（目录）"],
    ["new.md", undefined, "正常新名"],
    ["new dir", undefined, "带空格的正常名"],
    [".gitignore", undefined, "合法点文件（不在忽略集）"],
    ["  前后有空白.md  ", undefined, "提交前 trim 后合法"],
  ];
  for (const [input, expected, why] of cases) {
    assert.equal(validateEntryName(input, siblings), expected, `case: ${why}（${JSON.stringify(input)}）`);
  }
});

test("校验矩阵的反向输入：撞名判定是真的在用 sibling 集合，不是恒假", () => {
  // 同一个名字，siblings 为空时必须放行——否则「撞名」这条断言没有区分度（REVIEW.md 第 1 条）
  assert.equal(validateEntryName("note.md", new Set()), undefined);
  assert.notEqual(validateEntryName("note.md", new Set(["note.md"])), undefined);
});

test("忽略集与 Rust 侧 IGNORED_NAMES 逐项对账（REVIEW.md 第 8 条）", () => {
  const decl = /pub const IGNORED_NAMES:\s*\[&str;\s*(\d+)\]\s*=\s*\[([^\]]*)\]/.exec(FS_IO_SOURCE);
  assert.ok(decl !== null, "fs_io.rs 里找不到 IGNORED_NAMES 的 [&str; N] 声明");
  const declared = Number(decl[1]);
  const rust = [...decl[2].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
  assert.equal(rust.length, declared, "声明长度与实际条目数不一致（解析吞掉条目即在此暴露）");
  assert.equal(IGNORED_NAMES.length, declared, "TS 侧条目数与 Rust 清单不一致");
  assert.deepEqual([...IGNORED_NAMES].sort(), [...rust].sort(), "两侧忽略集必须逐项一致");
  // 反向输入：任一侧多一项都判不等
  assert.notDeepEqual([...IGNORED_NAMES, "bogus"], [...rust].sort());
});

test("改名后的路径 remap：文件单条替换、目录前缀替换、其余不动", () => {
  // 文件改名
  assert.equal(remapPathAfterRename("sub/a.md", "sub/a.md", "sub/b.md"), "sub/b.md");
  assert.equal(remapPathAfterRename("a.md", "a.md", "b.md"), "b.md");
  // 目录改名：整棵子树前缀替换（含深层）
  assert.equal(remapPathAfterRename("sub", "sub", "sub2"), "sub2");
  assert.equal(remapPathAfterRename("sub/deep/a.md", "sub", "sub2"), "sub2/deep/a.md");
  // 不受影响：同前缀但不是子树（`subx` 不是 `sub/` 下的条目）、别处的路径
  assert.equal(remapPathAfterRename("subx/a.md", "sub", "sub2"), undefined);
  assert.equal(remapPathAfterRename("other/a.md", "sub/a.md", "sub/b.md"), undefined);
  assert.equal(remapPathAfterRename("sub/a.md.bak", "sub/a.md", "sub/b.md"), undefined);
});

test("父目录 + 末段名 = 完整相对路径（M258：展开态搬家与回响抑制共用的那一条拼接）", () => {
  assert.equal(relativePathOf("", "a.md"), "a.md");
  assert.equal(relativePathOf("sub", "a.md"), "sub/a.md");
  assert.equal(relativePathOf("sub/deep", "a.md"), "sub/deep/a.md");
  // 反向：与 remapPathAfterRename 同一套路径语义（改名后的新路径必须能被 remap 认出来）
  const to = relativePathOf("sub", "b.md");
  assert.equal(remapPathAfterRename("sub/a.md", "sub/a.md", to), "sub/b.md");
});
