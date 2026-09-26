// 双表防漂移（REVIEW.md 第 8 条）：同一语义两处真源，改动只落到一处是这类改动的典型失手。
//
// 现场：保存守卫的拒绝清单在 **Rust**（`src-tauri/src/fs_io.rs` 的 SAVE_REJECTED_EXTENSIONS，
// 后端防线：前端 bug 不得把内容写进图片/二进制路径），而扩展名分类的事实源在 **TS**
//（`src/preview/attachments.ts` 的 REGISTRY，M130 收敛的唯一表）。两边任一漂移（注册表加了
// 一个图片扩展名而 Rust 没跟，或反之）都不会有任何运行期症状——只会在某天有人保存一个
// `.avif` 时静默写进去。
//
// 机制：本用例读 Rust 源文件文本、解析那张表，与注册表按类过滤出的集合逐项比对。
// 任一方向漂移都红：改注册表不改 Rust → 本用例红；改 Rust 不改注册表 → 本用例红。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nonTextExtensions } from "../../src/preview/attachments.ts";

/** `fs_io.rs` 的 SAVE_REJECTED_EXTENSIONS：声明长度 + 条目（升序）。 */
interface RustRejectList {
  declared: number;
  entries: string[];
}

function parseRustRejectList(source: string): RustRejectList {
  const decl = /const SAVE_REJECTED_EXTENSIONS:\s*\[&str;\s*(\d+)\]\s*=\s*\[([\s\S]*?)\];/.exec(source);
  assert.ok(decl !== null, "fs_io.rs 里找不到 SAVE_REJECTED_EXTENSIONS 的 [&str; N] 数组声明");
  const [, size, body] = decl;
  return {
    declared: Number(size),
    entries: [...body.matchAll(/"([^"]*)"/g)].map((match) => match[1]).sort(),
  };
}

const FS_IO_SOURCE = readFileSync(new URL("../../src-tauri/src/fs_io.rs", import.meta.url), "utf8");

test("双表对账：Rust 拒绝清单与 TS 注册表的 image/binary 类逐项一致", () => {
  const rust = parseRustRejectList(FS_IO_SOURCE);
  const registry = nonTextExtensions();

  // 先钉声明长度：Rust 的 [&str; N] 是编译期常量，条目数与它不一致时 Rust 自己就编译不过；
  // 这一条让「TS 侧看到的长度」与那个 N 对上，避免解析吞掉条目却照样判等。
  assert.equal(rust.entries.length, rust.declared, "声明长度与实际条目数不一致");
  assert.equal(registry.length, rust.declared, "注册表的 image/binary 类条目数与 Rust 清单不一致");
  assert.deepEqual(rust.entries, registry, "两侧清单必须逐项一致（任一侧漂移即红）");
});

test("对账的反向输入：清单少一项、多一项、错一项都必须判不等（断言有区分度）", () => {
  const registry = nonTextExtensions();
  // 去掉一项（模拟「注册表新增了图片扩展名，Rust 没跟」）
  assert.notDeepEqual(parseRustRejectList(FS_IO_SOURCE.replace('"pdf", ', "")).entries, registry);
  // 多一项（模拟「Rust 手写多了一个扩展名，注册表没有」）
  const extra = FS_IO_SOURCE.replace("];\n\n/// 路径的扩展名", '"bogus",\n];\n\n/// 路径的扩展名');
  assert.notEqual(extra, FS_IO_SOURCE, "反向输入的改写必须真的落到源码文本上");
  assert.notDeepEqual(parseRustRejectList(extra).entries, registry);
  // 错一项（大小写 / 拼写）：同样必须判不等
  assert.notDeepEqual(parseRustRejectList(FS_IO_SOURCE.replace('"sqlite", ', '"sqlLite", ')).entries, registry);
});
