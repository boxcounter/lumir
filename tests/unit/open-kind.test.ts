// 打开分类与「可链接路径集」的单测（M629，change add-image-file-preview 的 1.1 / 1.3 / 1.4）。
//
// 这一层钉的是**分类的消费结果**，不是分类表的实现（注册表本身由 registry-drift 与
// image-widget 那一族用例守）：
//   - `openKind` 的 image 档（png / svg / heic / 无扩展名 / 目录名）；
//   - `linkableVaultPaths` 的**反向**用例——图片路径 MUST NOT 变成 harness 可点路径
//     （attachment-display spec 明确要求图片在 harness 输出里保持纯文本；分类加档时
//     否定式判据 `!== "binary"` 会静默把图片划进可点集，这一条是唯一防线）；
//   - `shellPlanOf`：会话恢复对图片放行、对二进制仍然跳过。

import { test } from "node:test";
import assert from "node:assert/strict";
import { linkableVaultPaths, openKind, shellPlanOf } from "../../src/tree.ts";

test("openKind：image 单列一档（扩展名大小写不敏感，集合来自既有注册表）", () => {
  for (const path of [
    "logo.png",
    "shot.jpg",
    "photo.JPEG",
    "anim.gif",
    "a.webp",
    "diagram.svg",
    "x.avif",
    "b.bmp",
    "i.ico",
    "scan.heic",
    "nested/dir/pic.png",
  ]) {
    assert.equal(openKind(path), "image", path);
  }
  // 反向：文本三档与二进制档不被图片档吞掉
  assert.equal(openKind("note.md"), "md");
  assert.equal(openKind("main.ts"), "code");
  assert.equal(openKind("LICENSE"), "text");
  assert.equal(openKind("mystery.xyz"), "text");
  assert.equal(openKind("archive.pdf"), "binary");
  assert.equal(openKind("bundle.zip"), "binary");
});

test("openKind：无扩展名与目录形态只看 basename 的扩展名，不落进 image", () => {
  // 目录在树里由 entry.kind 判定、不过 openKind；这条钉的是「只按 basename 判」的既有口径。
  assert.equal(openKind("LICENSE"), "text");
  assert.equal(openKind("Makefile"), "text");
  assert.equal(openKind("assets"), "text");
  assert.equal(openKind("images/"), "text");
  assert.equal(openKind("img.v1/readme"), "text");
});

test("linkableVaultPaths：图片与二进制都不进可点集（反向用例：图片路径必须不可点）", () => {
  const paths = ["note.md", "main.ts", "LICENSE", "logo.png", "diagram.svg", "archive.pdf", "bundle.zip"];
  assert.deepEqual(linkableVaultPaths(paths), ["note.md", "main.ts", "LICENSE"]);
  // 判别性：把判据退回「openKind !== "binary"」的旧实现会得到 [..., "logo.png", "diagram.svg"]，
  // 上面那条 deepEqual 随即变红——这就是「图片静默变成可点」的防线。
  const linkable = linkableVaultPaths(paths);
  assert.equal(linkable.includes("logo.png"), false);
  assert.equal(linkable.includes("diagram.svg"), false);
  // 空输入不产生意外条目
  assert.deepEqual(linkableVaultPaths([]), []);
});

test("shellPlanOf：恢复时图片放行（建图片会话）、二进制仍跳过、文本建文本壳", () => {
  assert.equal(shellPlanOf("README.md"), "doc");
  assert.equal(shellPlanOf("LICENSE"), "doc");
  assert.equal(shellPlanOf("src/main.ts"), "doc");
  assert.equal(shellPlanOf("assets/logo.png"), "image");
  assert.equal(shellPlanOf("diagram.svg"), "image");
  assert.equal(shellPlanOf("archive.pdf"), "skip");
  assert.equal(shellPlanOf("bundle.zip"), "skip");
});
