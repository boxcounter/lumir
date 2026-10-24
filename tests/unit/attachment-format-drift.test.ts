// 可引用格式的跨层防漂移（M662，change quote-pipeline-consistency-oct24；REVIEW.md
// 「同一语义两处真源」条）。
//
// 现场：预览层认 10 种图片（`IMAGE_MIME`，渲染能力），写入口只收 png/jpeg/webp，读回侧的名字
// 形态与 MIME 映射又各写了一份（`is_attachment_name` 的 `matches!(ext, "webp" | "jpg")`、
// `mime_of_name` 的 `endsWith(".jpg")`）——枚举成功、落盘拒绝的半成功路径就是这么来的
//（survey 报告 §4.3）。
//
// M662 的收敛：三处都从 Rust 写入口的 `ATTACHMENT_TARGETS` 派生（读回侧直接读表；前端
// `QUOTABLE_IMAGE_EXTENSIONS` 镜像同一张表）。跨语言共享不了内存，能共享的是同一份清单 +
// 一条机器判据：本用例读 Rust 源文件文本、解析那张表，与前端派生的两份读数逐项比对。
// 任一侧漂移（前端加了 gif、Rust 没跟，或反之）都红。
//
// 同族先例：`tests/unit/registry-drift.test.ts`（SAVE_REJECTED_EXTENSIONS ↔ 注册表）。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ATTACHMENT_STORED_EXTENSIONS,
  QUOTABLE_IMAGE_EXTENSIONS,
  attachmentMimeOfName,
  isImageName,
  isQuotableImageName,
  mimeTypeOf,
  quotableImageMimes,
} from "../../src/preview/attachments.ts";

/** `fs_io.rs` 的 ATTACHMENT_TARGETS：逐项 `(源 MIME, 是否转码, 落盘扩展名)`。 */
interface RustTarget {
  source: string;
  transcode: boolean;
  extension: string;
}

function parseRustTargets(source: string): RustTarget[] {
  const decl = /const ATTACHMENT_TARGETS:[^=]*=\s*&\[([\s\S]*?)\];/.exec(source);
  assert.ok(decl !== null, "fs_io.rs 里找不到 ATTACHMENT_TARGETS 的表声明");
  const body = decl[1]!;
  const entries = [...body.matchAll(/\("([^"]+)",\s*(true|false),\s*"([^"]+)"\)/g)].map((match) => ({
    source: match[1]!,
    transcode: match[2] === "true",
    extension: match[3]!,
  }));
  assert.ok(entries.length > 0, "ATTACHMENT_TARGETS 解析出 0 项（表形态变了？）");
  return entries;
}

const FS_IO_SOURCE = readFileSync(new URL("../../src-tauri/src/fs_io.rs", import.meta.url), "utf8");

test("可引用格式对账：Rust 写入口的源 MIME ↔ 前端派生的可引用 MIME 集合", () => {
  const rust = parseRustTargets(FS_IO_SOURCE);
  const rustMimes = rust.map((item) => item.source).sort();
  assert.deepEqual(rustMimes, quotableImageMimes(), "两侧的可引用源格式必须逐项一致（任一侧漂移即红）");
});

test("可引用扩展名都是注册表里的图片，且 MIME 由同一张表派生", () => {
  for (const ext of QUOTABLE_IMAGE_EXTENSIONS) {
    assert.ok(isImageName(`x.${ext}`), `${ext} 必须是注册表里的图片类`);
    assert.equal(isQuotableImageName(`x.${ext}`), true);
    assert.ok(mimeTypeOf(ext) !== undefined, `${ext} 必须在 IMAGE_MIME 里（MIME 不另立表）`);
  }
  // 预览层认、可引用层不认的（svg/gif/heic…）必须仍判 false：预览能力与引用能力不是一回事。
  for (const ext of ["svg", "gif", "heic", "avif", "bmp", "ico"]) {
    assert.equal(isQuotableImageName(`x.${ext}`), false, `${ext} 目前不可引用`);
  }
});

test("读回侧（前端缩略图 MIME 与 Rust 落盘扩展名）从同一张表的落盘列派生", () => {
  const rust = parseRustTargets(FS_IO_SOURCE);
  const stored = [...new Set(rust.map((item) => item.extension))].sort();
  assert.deepEqual(stored, ["jpg", "webp"], "落盘扩展名集合变了：同步 Rust 读回侧与前端映射");
  assert.deepEqual(stored, [...ATTACHMENT_STORED_EXTENSIONS], "前端落盘扩展名集合必须与 Rust 表逐项一致");
  // 读回 MIME 与 Rust `mime_of_name` 同口径：jpg → jpeg，其余按扩展名。
  for (const ext of stored) {
    const mime = attachmentMimeOfName(`pasted-0123456789abcdef.${ext}`);
    assert.equal(mime, ext === "jpg" ? "image/jpeg" : `image/${ext}`);
  }
  // 表外扩展名（旧留存 / 坏数据；后端 is_attachment_name 本就不放行）回落落盘默认子类型。
  assert.equal(attachmentMimeOfName("pasted-0123456789abcdef.png"), "image/webp");
  assert.equal(attachmentMimeOfName("pasted-0123456789abcdef"), "image/webp");
});

test("对账的反向输入：表少一项、多一项、改一项都必须判不等（断言有区分度）", () => {
  const rust = parseRustTargets(FS_IO_SOURCE);
  const expected = quotableImageMimes();
  // 少一项（模拟「前端新增了可引用格式，Rust 没跟」）
  const missing = FS_IO_SOURCE.replace('    ("image/webp", false, "webp"),\n', "");
  assert.notEqual(missing, FS_IO_SOURCE, "反向输入的改写必须真的落到源码文本上");
  assert.notDeepEqual(
    parseRustTargets(missing)
      .map((item) => item.source)
      .sort(),
    expected,
  );
  // 多一项（模拟「Rust 扩了白名单，前端没跟」）
  const extra = FS_IO_SOURCE.replace(
    '    ("image/webp", false, "webp"),\n',
    '    ("image/webp", false, "webp"),\n    ("image/gif", false, "gif"),\n',
  );
  assert.notDeepEqual(
    parseRustTargets(extra)
      .map((item) => item.source)
      .sort(),
    expected,
  );
  // 改一项（拼写漂移）：同样必须判不等
  assert.notDeepEqual(
    parseRustTargets(FS_IO_SOURCE.replace('"image/jpeg"', '"image/jpg"'))
      .map((item) => item.source)
      .sort(),
    expected,
  );
  // 前端源扩展名比 Rust 表多（jpg / jpeg 两个扩展名共用一个源 MIME 是合法形态）：
  // 判据是 MIME 集合逐项相等，不是扩展名计数相等。
  assert.equal(rust.length, expected.length, "Rust 表项数与前端派生的 MIME 集合项数一致");
  assert.ok(
    QUOTABLE_IMAGE_EXTENSIONS.length > rust.length,
    "前端按扩展名列举、Rust 按 MIME：前者项数应更多（反向输入，防止两侧被写成同一张扩展名表）",
  );
});
