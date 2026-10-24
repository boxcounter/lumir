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

/** `fs_io.rs` 的 ATTACHMENT_TARGETS：逐项 `(源 MIME, 转换口径, 落盘扩展名)`。
 *  M666 把「是否转码」的 bool 升级成三档 `AttachmentConversion`（原样 / png→WebP / svg 栅格化），
 *  因此解析面跟着换成正则取枚举名——**表形态变了这条断言也得变**，否则它会静默解析出 0 项。
 *  转换口径本身不在前端镜像（前端只需要「能不能引用」与落盘扩展名），但 svg 那一档必须是
 *  `RasterizeSvg`：安全条款要求 MUST NOT 原样存 SVG（见下面第三条用例）。 */
interface RustTarget {
  source: string;
  conversion: string;
  extension: string;
}

function parseRustTargets(source: string): RustTarget[] {
  const decl = /const ATTACHMENT_TARGETS:[^=]*=\s*&\[([\s\S]*?)\];/.exec(source);
  assert.ok(decl !== null, "fs_io.rs 里找不到 ATTACHMENT_TARGETS 的表声明");
  const body = decl[1]!;
  const entries = [
    ...body.matchAll(/\("([^"]+)",\s*AttachmentConversion::(\w+),\s*"([^"]+)"\)/g),
  ].map((match) => ({
    source: match[1]!,
    conversion: match[2]!,
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
  // 预览层认、可引用层不认的（gif/heic…）必须仍判 false：预览能力与引用能力不是一回事。
  // M666：svg 从这份差集里移出（写入口栅格化后落盘），其余保持不可引用。
  for (const ext of ["gif", "heic", "avif", "bmp", "ico"]) {
    assert.equal(isQuotableImageName(`x.${ext}`), false, `${ext} 目前不可引用`);
  }
  // 反向输入：svg 必须判**可引用**——它回到差集里就等于 M666 被回滚（引用 svg 必然落盘拒绝）。
  assert.equal(isQuotableImageName("x.svg"), true, "svg 走栅格化后可引用");
});

test("svg 的转换口径是栅格化，MUST NOT 原样落盘（安全条款的机器判据）", () => {
  // 表里 svg 那一行必须是 `RasterizeSvg`。有人把它「简化」成 Passthrough 时这条判红——
  // 原样落盘 SVG 等于把「解析用户 vault 里任意 XML」的入口留给每一个渲染点（survey §4.5 第 1 条）。
  const rust = parseRustTargets(FS_IO_SOURCE);
  const svg = rust.find((item) => item.source === "image/svg+xml");
  assert.ok(svg !== undefined, "Rust 表里必须有 image/svg+xml 一行");
  assert.equal(svg.conversion, "RasterizeSvg", "svg 只能是栅格化档");
  assert.equal(svg.extension, "webp", "栅格化产物落盘为 webp（与位图同一条读回链路）");
  // 位图三档的口径不受 M666 影响（反向用例）。
  assert.deepEqual(
    rust.filter((item) => item.source !== "image/svg+xml").map((item) => [item.source, item.conversion]),
    [
      ["image/png", "PngToWebp"],
      ["image/jpeg", "Passthrough"],
      ["image/webp", "Passthrough"],
    ],
  );
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
  const webpRow = '    ("image/webp", AttachmentConversion::Passthrough, "webp"),\n';
  // 少一项（模拟「前端新增了可引用格式，Rust 没跟」）
  const missing = FS_IO_SOURCE.replace(webpRow, "");
  assert.notEqual(missing, FS_IO_SOURCE, "反向输入的改写必须真的落到源码文本上");
  assert.notDeepEqual(
    parseRustTargets(missing)
      .map((item) => item.source)
      .sort(),
    expected,
  );
  // 多一项（模拟「Rust 扩了白名单，前端没跟」）
  const extra = FS_IO_SOURCE.replace(
    webpRow,
    `${webpRow}    ("image/gif", AttachmentConversion::Passthrough, "gif"),\n`,
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
  // 改转换口径（不是源格式漂移，但表形态变了）：解析面必须能读出来，故断言口径集合逐项相等。
  assert.deepEqual(
    rust.map((item) => item.conversion).sort(),
    ["Passthrough", "Passthrough", "PngToWebp", "RasterizeSvg"],
  );
  // 前端源扩展名比 Rust 表多（jpg / jpeg 两个扩展名共用一个源 MIME 是合法形态）：
  // 判据是 MIME 集合逐项相等，不是扩展名计数相等。
  assert.equal(rust.length, expected.length, "Rust 表项数与前端派生的 MIME 集合项数一致");
  assert.ok(
    QUOTABLE_IMAGE_EXTENSIONS.length > rust.length,
    "前端按扩展名列举、Rust 按 MIME：前者项数应更多（反向输入，防止两侧被写成同一张扩展名表）",
  );
});
