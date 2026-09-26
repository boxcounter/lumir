// 可编辑性的裁决矩阵（editable-non-md-files，裁决 D1「注册表全量文本类」）。
//
// 判据只有一处：`src/preview/attachments.ts` 的 `isEditableFileClass` / `isEditablePath`。
// 编辑器会话的 `editable` 标志、`modeExtensions` 的视图层 editability、`changeFilter` 的放行、
// main.ts 的磁盘 revision 登记门、save-controller 的 `saveBaseline` 闸——五处消费的都是这一份
//（前者同源调用，后两者读会话标志，而会话标志也由 `isEditablePath` 算出）。所以本文件覆盖的
// 矩阵就是那五处的矩阵：这里红 = 那条链路对不上。
//
// 本层还兼两条「改动真的落到了」的断言（不依赖运行时导入 main.ts / fs_io.rs）：
// 旧口径的判据与文案（md 白名单 / 「只保存 Markdown」）不得在改动面里残留。

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileClass, isEditableFileClass, isEditablePath, nonTextExtensions } from "../../src/preview/attachments.ts";

test("矩阵：md / 代码扩展 / 未收录扩展 / dotfile / 无扩展名 一律可编辑", () => {
  for (const path of [
    "note.md",
    "note.markdown",
    "note.MD", // 扩展名大小写不敏感
    "main.rs",
    "config.yaml",
    "page.php", // 收录但无语言包：仍是 code 类 → 可编辑（纯文本显示）
    "app.log", // 未收录扩展 → text
    "mystery.xyz", // 同上
    ".gitignore", // dotfile：扩展名解析为 "gitignore"（未收录）→ text
    "LICENSE", // basename 无点 → text
    "Makefile",
    "dir/sub/notes.txt", // 嵌套目录里的 basename 才是判据来源
  ]) {
    assert.equal(isEditablePath(path), true, `${path} 应可编辑`);
  }
});

test("矩阵：image / binary 不可编辑；无文件上下文按现状可编辑", () => {
  for (const path of ["pic.png", "photo.JPEG", "icon.svg", "doc.pdf", "bundle.zip", "song.mp3", "font.woff2"]) {
    assert.equal(isEditablePath(path), false, `${path} 不应进编辑器`);
  }
  // 无文件上下文（空态 / 新建 / reset）按现状可编辑，模式由配置 editor.mode 决定
  assert.equal(isEditablePath(undefined), true);
});

test("矩阵与注册表分类一一对应：可编辑 ⇔ md/code/text 三类", () => {
  // 反过来的方向：nonTextExtensions 是「不可编辑」那两类的全部扩展名，两者必须互补。
  for (const ext of nonTextExtensions()) {
    assert.equal(isEditableFileClass(fileClass(ext)), false, `${ext} 被列为拒绝清单却判为可编辑`);
  }
  assert.equal(isEditableFileClass("md"), true);
  assert.equal(isEditableFileClass("code"), true);
  assert.equal(isEditableFileClass("text"), true);
  assert.equal(isEditableFileClass("image"), false);
  assert.equal(isEditableFileClass("binary"), false);
});

test("矩阵只看 basename：目录名里的点不参与扩展名判定", () => {
  // 目录叫 `a.png` 而文件无扩展名 → 文件是 text 类（可编辑）
  assert.equal(isEditablePath("a.png/notes"), true);
  // 目录叫 `a.txt` 而文件是图片 → 图片类（不可编辑）
  assert.equal(isEditablePath("a.txt/pic.png"), false);
});

// ---------------------------------------------------------------------------
// 「旧口径真的退场」的两条断言（反向输入有区分度：把旧判据/旧文案放回去就红）
// ---------------------------------------------------------------------------

const SAVE_CONTROLLER_SOURCE = readFileSync(new URL("../../src/save-controller.ts", import.meta.url), "utf8");
const FS_IO_SOURCE = readFileSync(new URL("../../src-tauri/src/fs_io.rs", import.meta.url), "utf8");

test("旧判据退场：保存基准闸不再按模式判、后端不再按 .md 白名单判", () => {
  // saveBaseline 的闸改为按会话 editable 标志（判据同源）
  assert.equal(SAVE_CONTROLLER_SOURCE.includes('session.mode !== "md"'), false);
  assert.ok(SAVE_CONTROLLER_SOURCE.includes("!session.editable"), "saveBaseline 的闸必须按 editable 标志");
  // 后端守卫改为拒绝清单：md 白名单的 ends_with 判据不得残留
  assert.equal(FS_IO_SOURCE.includes('ends_with(".md")'), false);
  assert.ok(FS_IO_SOURCE.includes("SAVE_REJECTED_EXTENSIONS.contains"), "守卫必须消费拒绝清单");
});

test("旧文案退场：向用户可见的「只保存 Markdown」不得在改动面残留", () => {
  // 判据只看**字符串字面量**（用户可见面）：注释里提旧措辞（如 save-controller 里说明它已废止）
  // 是允许的，把它放回 toast 文案则必须红。
  const visibleOldCopy = /["`][^"`\n]*只保存 Markdown[^"`\n]*["`]/;
  for (const [name, source] of [
    ["src/save-controller.ts", SAVE_CONTROLLER_SOURCE],
    ["src-tauri/src/fs_io.rs", FS_IO_SOURCE],
  ] as const) {
    assert.equal(visibleOldCopy.test(source), false, `${name} 的字符串字面量里仍残留旧文案`);
  }
  // 反向输入：把旧文案塞回一个字面量，判据必须红（断言有区分度）
  assert.equal(visibleOldCopy.test('toast("当前文件不支持保存：Lumir 只保存 Markdown 文件")'), true);
});
