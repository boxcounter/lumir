import { expect, test } from "@playwright/test";
import {
  COMMAND_IDS,
  EDITOR_COMMAND_IDS,
  GLOBAL_COMMAND_IDS,
  KEYLESS_COMMAND_IDS,
  KEY_BINDINGS,
  Keymap,
  keyToken,
  normalizeKey,
} from "../../../src/keys";

// M131 统一键位层：表本身的不变量（无需页面，直接断言源码导出）。
// 目的不是复述实现，而是守住三件容易静默退化的事：
//   1. 表能建起来（无重复键、每条绑定都有归属命令）；
//   2. ⌘ 与 ⌃ 真的拆开了（不存在合并口径，⌃A / ⌘A / ⌃S / ⌘S 各自归位）；
//   3. 表里的写法真能被运行期事件命中（token 归一化的往返），否则绑定是死的。

/** 从表内 token 反推一次真实按键事件（用于验证「表里写的能被事件命中」）。
 *  键名同时喂给 key 与 code：表内含 Alt 的组合按物理键（code）判定，非 Alt 组合只看 key。 */
function eventOf(token: string) {
  const parts = token.split("-");
  const mods = new Set<string>();
  let index = 0;
  while (index < parts.length && ["Cmd", "Ctrl", "Alt", "Shift"].includes(parts[index])) {
    mods.add(parts[index]);
    index++;
  }
  const name = parts.slice(index).join("-");
  return {
    key: name,
    code: name,
    metaKey: mods.has("Cmd"),
    ctrlKey: mods.has("Ctrl"),
    altKey: mods.has("Alt"),
    shiftKey: mods.has("Shift"),
  };
}

test("键位表不变量：无重复键、每绑定有归属命令、命令无孤儿", () => {
  // 构造函数按归一化后的 token 判重（重复即抛），能建起来就说明没有重复绑定
  expect(() => new Keymap()).not.toThrow();

  const tokens = KEY_BINDINGS.map((binding) => normalizeKey(binding.key));
  expect(new Set(tokens).size).toBe(KEY_BINDINGS.length);

  for (const binding of KEY_BINDINGS) {
    expect(binding.doc.trim(), `${binding.key} 缺少归属说明`).not.toBe("");
    expect(COMMAND_IDS, `${binding.key} 的 ${binding.command} 不在命令清单里`).toContain(binding.command);
    expect(["global", "editor"]).toContain(binding.scope);
  }

  // 无孤儿命令（M180 起是三项对账）：每条命令要么有绑定、要么登记在默认不绑键清单里。
  // 两个方向都要查——「有实现但没人绑」与「清单写着不绑键、绑定表里却有一条」都是错。
  for (const command of COMMAND_IDS) {
    expect(
      KEY_BINDINGS.some((binding) => binding.command === command) || KEYLESS_COMMAND_IDS.includes(command),
      `命令 ${command} 既没有任何绑定，也不在默认不绑键清单里`,
    ).toBe(true);
  }
  for (const command of KEYLESS_COMMAND_IDS) {
    expect(COMMAND_IDS, `默认不绑键清单里的 ${command} 不在命令清单里（幻影 id）`).toContain(command);
    expect(
      KEY_BINDINGS.some((binding) => binding.command === command),
      `${command} 既登记为默认不绑键、又带着默认绑定——清单在说谎`,
    ).toBe(false);
  }
  for (const binding of KEY_BINDINGS) {
    const owner = binding.scope === "editor" ? EDITOR_COMMAND_IDS : GLOBAL_COMMAND_IDS;
    expect(owner, `${binding.key} 的命令 ${binding.command} 与作用域 ${binding.scope} 不匹配`).toContain(binding.command);
  }
  // 编辑器命令全部带上，避免「命令实现了但没人绑」（折行命令不在 editor 组，不受这条约束）
  for (const command of EDITOR_COMMAND_IDS) {
    expect(KEY_BINDINGS.filter((binding) => binding.command === command).length).toBeGreaterThan(0);
  }
});

test("⌘ 与 ⌃ 已拆开：⌃A 行首 / ⌘A 全选 / ⌃S 解绑 / ⌘S 唯一保存", () => {
  // 合并口径（"Mod"）不得残留：它是 D1 裁决要拆掉的东西
  expect(KEY_BINDINGS.some((binding) => /(^|-)Mod(-|$)/.test(binding.key))).toBe(false);

  const commandOf = (key: string) => KEY_BINDINGS.find((binding) => normalizeKey(binding.key) === normalizeKey(key))?.command;
  expect(commandOf("Ctrl-a")).toBe("editor.line-start"); // D2：⌃A = 行首（Emacs C-a）
  expect(commandOf("Cmd-a")).toBe("editor.select-all"); // D2：全选归 ⌘A
  expect(commandOf("Cmd-s")).toBe("document.save"); // D3：⌘S 唯一保存键
  expect(commandOf("Ctrl-s")).toBeUndefined(); // ⌃S 解绑，预留给 isearch

  // 既有 6 键仍指向硬化原语对应的命令（迁移零语义变化）
  expect(commandOf("ArrowUp")).toBe("editor.cursor-up");
  expect(commandOf("ArrowDown")).toBe("editor.cursor-down");
  expect(commandOf("Ctrl-p")).toBe("editor.cursor-up");
  expect(commandOf("Ctrl-n")).toBe("editor.cursor-down");
  expect(commandOf("Ctrl-b")).toBe("editor.cursor-backward");
  expect(commandOf("Ctrl-f")).toBe("editor.cursor-forward");
  expect(commandOf("Ctrl-e")).toBe("editor.line-end");

  // 撤销 / 重做：mac 惯例 + Emacs 规范绑定与别名
  expect(commandOf("Cmd-z")).toBe("editor.undo");
  expect(commandOf("Cmd-Shift-z")).toBe("editor.redo");
  expect(commandOf("Ctrl-/")).toBe("editor.undo");
  expect(commandOf("Ctrl-_")).toBe("editor.undo");
  // ⌃⌥_ 在 mac 键盘上物理为 ⌃⌥⇧-：Alt 层替换字符，表内按物理键 Minus 写
  expect(commandOf("Ctrl-Alt-Minus")).toBe("editor.redo");
});

test("token 口径：表内写法与运行期事件同源（往返一致）", () => {
  // 每条绑定都必须能被一次真实按键命中，否则是死绑定
  for (const binding of KEY_BINDINGS) {
    const token = normalizeKey(binding.key);
    expect(keyToken(eventOf(token)), `${binding.key} 无法被事件命中`).toBe(token);
  }

  // ⌘/⌃ 判别 + 单字符大写 + 修饰前缀顺序无关
  expect(keyToken({ key: "a", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl-A");
  expect(keyToken({ key: "z", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe("Cmd-Shift-Z");
  expect(normalizeKey("shift-cmd-z")).toBe("Cmd-Shift-Z");
  expect(normalizeKey("meta-A")).toBe("Cmd-A");

  // ⌃_ 在 mac 键盘上物理是 ⌃⇧-：Shift 已隐含在字符里，两种事件形状归一到同一 token
  expect(keyToken({ key: "_", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Ctrl-_");
  expect(keyToken({ key: "_", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl-_");
  expect(keyToken({ key: "/", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl-/");
  expect(keyToken({ key: "ArrowDown", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe("ArrowDown");

  // 含 Alt 的组合按物理键判定：macOS 的 Alt 层把字符换掉，e.key 判别不了（⌃⌥_ 的真机形状）
  expect(
    keyToken({ key: "—", code: "Minus", ctrlKey: true, altKey: true, shiftKey: true, metaKey: false }),
  ).toBe("Ctrl-Alt-Minus");
  expect(
    keyToken({ key: "å", code: "KeyA", ctrlKey: false, altKey: true, shiftKey: false, metaKey: false }),
  ).toBe("Alt-KeyA");
  // 缺 code 的合成事件回落 e.key（测试便利路径，真机事件必有 code）
  expect(keyToken({ key: "_", ctrlKey: true, altKey: true, shiftKey: true, metaKey: false })).toBe("Ctrl-Alt-_");

  // 纯修饰键不参与键位判定（不改变 chord 状态）
  for (const key of ["Control", "Shift", "Alt", "Meta"]) {
    expect(keyToken({ key, ctrlKey: true, metaKey: true, altKey: true, shiftKey: true })).toBeNull();
  }
});
