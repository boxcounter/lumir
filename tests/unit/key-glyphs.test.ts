// 键位字形矩阵（change improve-keybindings-lookup-oct24，design §2.3 / spec「字形矩阵」）。
//
// 判据两半：① 给定 token 的精确字形（含 SHIFT_IMPLIED 反解与 Apple 顺序）；
// ② 全部默认绑定 token 的转换结果不含 `Cmd-` / `Ctrl-` / `Alt-` / `Shift-` / `Key` / `Digit`
// 字面——防 token 泄漏给人。第二条必须对真实表跑，不能只验手写样例。

import { test } from "node:test";
import assert from "node:assert/strict";
import { glyphOfToken } from "../../src/key-glyphs.ts";
import { KEY_BINDINGS } from "../../src/keys.ts";

test("字形矩阵：修饰键顺序 / SHIFT_IMPLIED 反解 / 具名键", () => {
  const matrix: ReadonlyArray<readonly [string, string]> = [
    ["Ctrl-Alt-KeyS", "⌃⌥S"],
    ["Shift-Cmd-o", "⇧⌘O"],
    ["Cmd-}", "⇧⌘]"],
    ["Cmd-{", "⇧⌘["],
    ["Cmd->", "⇧⌘."],
    ["Cmd-<", "⇧⌘,"],
    ["Ctrl-_", "⌃⇧-"],
    ["Cmd-+", "⇧⌘="],
    ["Cmd-=", "⌘="],
    ["Alt-Backspace", "⌥⌫"],
    ["Ctrl-Shift-Tab", "⌃⇧⇥"],
    ["Cmd--", "⌘-"],
    ["Cmd-Shift-T", "⇧⌘T"],
    ["Alt-KeyG", "⌥G"],
    ["Ctrl-Tab", "⌃⇥"],
    ["Shift-Tab", "⇧⇥"],
    ["Escape", "Esc"],
    ["PageDown", "PgDn"],
    ["Digit1", "1"],
    ["KeyS", "S"],
  ];
  for (const [token, expected] of matrix) {
    assert.equal(glyphOfToken(token), expected, `${token} 的字形`);
  }
});

test("字形矩阵：全部默认绑定 token 不泄漏 token 字面", () => {
  const leak = /(?:Cmd-|Ctrl-|Alt-|Shift-|Key[A-Z]|Digit[0-9])/;
  for (const binding of KEY_BINDINGS) {
    const glyph = glyphOfToken(binding.key);
    assert.ok(glyph.trim() !== "", `${binding.key} 的字形为空`);
    assert.ok(!leak.test(glyph), `${binding.key} → ${glyph} 泄漏了 token 字面`);
  }
});

test("字形：未知键名原样显示，非法 token 不抛错", () => {
  assert.equal(glyphOfToken("F13"), "F13");
  assert.equal(glyphOfToken("Home"), "Home");
  assert.equal(glyphOfToken(""), "");
});
