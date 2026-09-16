import { expect, test, type Page } from "@playwright/test";
import { applyKeyOverrides, KEY_BINDINGS, Keymap, normalizeKey } from "../../../src/keys";
import { configGets, fireMenuCommand, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M132：[keys] 配置层的解析与应用、键位表不变量、以及两条「收编」的落点——
// 菜单事件通道（原 main.ts 直连 listen → ipc.onMenuCommand）与 ⌘/⌃ 的鼠标拆分。
//
// 表不变量与 applyKeyOverrides 是纯函数，直接断言源码导出（同 m131-keymap-table 的
// 做法）；配置应用与事件通道走真实页面。

async function setSelection(page: Page, anchor: number, head = anchor): Promise<void> {
  await page.evaluate(({ anchor: a, head: h }) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.dispatch({ selection: { anchor: a, head: h } });
    view.focus();
  }, { anchor, head });
}

/** 装载 vault 并等「配置已加载」（[keys] 覆盖在 config_get 之后才挂上分发器）。 */
async function openWithConfig(
  page: Page,
  files: Record<string, string>,
  name: string,
  config: VaultFixture["config"],
): Promise<void> {
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
    config,
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".masthead-file")).toHaveText(name);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

test("键位表不变量：M132 新键各归其命令，widget 键一律带 when 限定", () => {
  const commandOf = (key: string) => KEY_BINDINGS.find((b) => normalizeKey(b.key) === normalizeKey(key))?.command;

  expect(commandOf("Ctrl-v")).toBe("editor.scroll-page-down");
  expect(commandOf("Alt-KeyV")).toBe("editor.scroll-page-up");
  expect(commandOf("Ctrl-l")).toBe("editor.recenter");
  expect(commandOf("Ctrl-d")).toBe("editor.delete-char-forward");
  expect(commandOf("Ctrl-h")).toBe("editor.delete-char-backward");
  expect(commandOf("Ctrl-t")).toBe("editor.transpose-chars");
  expect(commandOf("Alt-KeyD")).toBe("editor.delete-word-forward");
  expect(commandOf("Alt-Backspace")).toBe("editor.delete-word-backward");
  expect(commandOf("Ctrl-k")).toBe("editor.kill-line");
  expect(commandOf("Ctrl-y")).toBe("editor.yank");
  expect(commandOf("Ctrl-g")).toBe("editor.keyboard-quit");

  expect(commandOf("Ctrl-Shift-f")).toBe("editor.extend-char-forward");
  expect(commandOf("Ctrl-Shift-b")).toBe("editor.extend-char-backward");
  expect(commandOf("Ctrl-Shift-n")).toBe("editor.extend-line-down");
  expect(commandOf("Ctrl-Shift-p")).toBe("editor.extend-line-up");
  expect(commandOf("Ctrl-Shift-a")).toBe("editor.extend-line-start");
  expect(commandOf("Ctrl-Shift-e")).toBe("editor.extend-line-end");
  expect(commandOf("Alt-KeyF")).toBe("editor.extend-word-forward");
  expect(commandOf("Alt-KeyB")).toBe("editor.extend-word-backward");

  // 既有键位未被新键挤掉（每条新键都必须自己占位，不悄悄改写别人的绑定）
  expect(commandOf("Ctrl-a")).toBe("editor.line-start");
  expect(commandOf("Cmd-a")).toBe("editor.select-all");
  expect(commandOf("Cmd-s")).toBe("document.save");
  expect(commandOf("Ctrl-s")).toBeUndefined();
  expect(commandOf("Ctrl-f")).toBe("editor.cursor-forward");
  expect(commandOf("Ctrl-e")).toBe("editor.line-end");

  // widget 键：文本里同为常用键，必须靠 when 限定事件目标在表格滚动容器内，
  // 否则会把原生 caret / Home / End 从文本编辑里吞掉
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End", "Escape"]) {
    const binding = KEY_BINDINGS.find((b) => normalizeKey(b.key) === normalizeKey(key));
    expect(binding, `${key} 应有绑定`).toBeDefined();
    expect(typeof binding!.when, `${key} 必须带 when 限定`).toBe("function");
    expect(binding!.scope).toBe("editor");
  }

  // 表仍可建（无重复键、每条绑定都有归属实现位）
  expect(() => new Keymap()).not.toThrow();
});

test("applyKeyOverrides：重绑 / 解绑 / 未知命令与 chord 的 warning 口径", () => {
  const rebind = applyKeyOverrides({ "Ctrl-j": "editor.undo" });
  expect(rebind.warnings).toEqual([]);
  const ctrlJ = rebind.bindings.find((b) => normalizeKey(b.key) === "Ctrl-J");
  expect(ctrlJ?.command).toBe("editor.undo");
  expect(ctrlJ?.scope, "作用域随命令归属（editor 组 → editor）").toBe("editor");
  // 其余绑定一字未动
  expect(rebind.bindings.find((b) => normalizeKey(b.key) === "Ctrl-A")?.command).toBe("editor.line-start");
  expect(rebind.bindings).toHaveLength(KEY_BINDINGS.length + 1);
  expect(() => new Keymap(rebind.bindings)).not.toThrow();

  // 全局命令重绑到新键 → scope 为 global
  const globalRebind = applyKeyOverrides({ "Ctrl-j": "document.save" });
  expect(globalRebind.bindings.find((b) => normalizeKey(b.key) === "Ctrl-J")?.scope).toBe("global");

  // 解绑：该键从表里消失，其余绑定不动
  const unbind = applyKeyOverrides({ "Cmd-s": null });
  expect(unbind.bindings.some((b) => normalizeKey(b.key) === "Cmd-S")).toBe(false);
  expect(unbind.bindings).toHaveLength(KEY_BINDINGS.length - 1);

  // 未知命令：warning + 忽略该条（保留默认表）
  const unknown = applyKeyOverrides({ "Ctrl-j": "editor.nope" });
  expect(unknown.warnings).toHaveLength(1);
  expect(unknown.warnings[0]).toContain("editor.nope");
  expect(unknown.bindings.some((b) => normalizeKey(b.key) === "Ctrl-J")).toBe(false);
  expect(unknown.bindings).toHaveLength(KEY_BINDINGS.length);

  // 多段 chord（含空白）：本版不支持，按非法项丢弃
  const chord = applyKeyOverrides({ "Ctrl-x u": "editor.undo" });
  expect(chord.warnings).toHaveLength(1);
  expect(chord.warnings[0]).toContain("chord");
  expect(chord.bindings).toHaveLength(KEY_BINDINGS.length);

  // 解绑一个本来就没有默认绑定的键：warning，不影响其余
  const noop = applyKeyOverrides({ "Ctrl-j": null });
  expect(noop.warnings).toHaveLength(1);
  expect(noop.bindings).toHaveLength(KEY_BINDINGS.length);
});

test("[keys] 重绑：配置的键执行配置的命令", async ({ page }) => {
  const doc = "# 标题\n\n内容。\n";
  await openWithConfig(page, { "k.md": doc }, "k.md", { keys: { "Ctrl-j": "editor.undo" } });

  await setSelection(page, doc.length);
  await page.keyboard.type("draft");
  await expect.poll(() => readDocument(page)).toBe(`${doc}draft`);
  await page.keyboard.press("Control+j");
  await expect.poll(() => readDocument(page), "⌃J 应走配置指定的 editor.undo").toBe(doc);
});

test("[keys] 重绑：⌃S 接上保存（D3 预留位由配置启用）", async ({ page }) => {
  const doc = "# 标题\n";
  await openWithConfig(page, { "s.md": doc }, "s.md", { keys: { "Ctrl-s": "document.save" } });

  await setSelection(page, doc.length);
  await page.keyboard.type("x");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".lumir-toast", { hasText: /^已保存$/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __fileText(p: string): string | undefined }).__fileText("s.md")))
    .toBe(`${doc}x`);
});

test("[keys] 解绑：⌘S 不再保存（键位让回原生路径）", async ({ page }) => {
  const doc = "# 标题\n";
  await openWithConfig(page, { "u.md": doc }, "u.md", { keys: { "Cmd-s": null } });

  await setSelection(page, doc.length);
  await page.keyboard.type("x");
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(400); // 远小于 2s 自动保存 debounce
  expect(
    await page.evaluate(() => (window as unknown as { __fileText(p: string): string | undefined }).__fileText("u.md")),
    "解绑后 ⌘S 不得再触发保存",
  ).toBe(doc);
  await expect(page.locator(".lumir-toast", { hasText: /^已保存$/ })).toHaveCount(0);
  await expect(page.locator(".masthead-file")).toContainText("（未保存）");
});

test("[keys] 未知命令：warning 不崩，默认表照常分发", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning") warnings.push(msg.text());
  });
  const doc = "# 标题\n";
  await openWithConfig(page, { "w.md": doc }, "w.md", { keys: { "Ctrl-j": "editor.nope" } });

  await expect.poll(() => warnings.some((w) => w.includes("editor.nope")), "未知命令应给出 warning").toBe(true);

  // 未知命令的条目被忽略：⌃J 不执行任何命令（默认表里本就没有 ⌃J）
  await setSelection(page, doc.length);
  await page.keyboard.press("Control+j");
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(doc);

  // 默认表照常工作：编辑器可输入、⌘S 仍保存
  await page.keyboard.type("x");
  await expect.poll(() => readDocument(page)).toBe(`${doc}x`);
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: /^已保存$/ })).toBeVisible();
});

test("菜单事件通道（ipc.onMenuCommand）：undo 落到同一命令层", async ({ page }) => {
  const doc = "# 标题\n\n内容。\n";
  await stubTauri(page, {
    entries: [{ path: "menu.md", kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { "menu.md": doc },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="menu.md"]').click();
  await expect(page.locator(".masthead-file")).toHaveText("menu.md");

  await setSelection(page, doc.length);
  await page.keyboard.type("draft");
  await expect.poll(() => readDocument(page)).toBe(`${doc}draft`);
  // 原生菜单项点击经 app:menu_command 回到前端 —— 与 ⌘Z 同一个命令实现
  await fireMenuCommand(page, "undo");
  await expect.poll(() => readDocument(page)).toBe(doc);
});

test("⌘-Click 跟随 wikilink；⌃-Click 让位系统次级点击", async ({ page }) => {
  const files: Record<string, string> = { "a.md": "链接：[[target]]\n", "target.md": "# 目标\n\n目标内容。\n" };
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
    links: {
      "[[target]]": {
        status: "resolved",
        path: "target.md",
        candidates: [],
        embed_target: null,
        anchor: { status: "found", heading: "目标", line: 1 },
      },
    },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a.md"]').click();
  const link = page.locator(".cm-lp-wikilink-resolved", { hasText: "target" });
  await link.waitFor();

  // ⌃-Click：不再被当作链接激活（macOS 的次级点击手势），留在 a.md、无提示
  await link.click({ modifiers: ["Control"] });
  await expect(page.locator(".masthead-file")).toHaveText("a.md");
  await expect(page.locator(".lumir-toast")).toHaveCount(0);

  // ⌘-Click：跟随链接并定位到标题行
  await link.click({ modifiers: ["Meta"] });
  await expect(page.locator(".masthead-file")).toHaveText("target.md");
  await expect(page.locator(".cm-content")).toContainText("目标内容");
});
