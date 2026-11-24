// change add-default-note-name-nov24：新建文件的默认名（DOM / 事件序列层）。
//
// 视觉门禁只负责 chromium 近似下的行为与几何；真机 WKWebView 下的同一合同由验收场景 728 覆盖。
// 判据在 `src/tree.ts` 的 beginCreate 上：始终预填 / 全选 / 键入替换 / Enter 走既有创建链 /
// Escape 不动磁盘 / 撞名递增 / 语言切换 / 其它命名链路不受影响。Alex 2026-11-25 裁决：不设
// 配置开关，行为始终启用。
//
// 不截像素基线：本场景只做 DOM 断言。

import { expect, test, type Page } from "@playwright/test";
import { DEMO_VAULT, fsMutations, stubTauri } from "./tauri-stub";

const VAULT_ROOT = "/Users/alex/demo-vault";

const COLLISION_ENTRIES = [
  ...DEMO_VAULT.entries,
  { path: "docs/未命名笔记.md", kind: "file", size: 0, mtime_ms: 1757000000000 },
  { path: "docs/未命名笔记 2.md", kind: "file", size: 0, mtime_ms: 1757000000000 },
];
const COLLISION_FILES = {
  ...DEMO_VAULT.files,
  "docs/未命名笔记.md": "",
  "docs/未命名笔记 2.md": "",
};

async function beginCreate(page: Page, dir = "docs", item = "新建文件…"): Promise<void> {
  await page.locator(`.ft-row[title="${dir}"]`).click({ button: "right" });
  await expect(page.locator(".ft-menu")).toBeVisible();
  await page.locator(".ft-menu .ft-menu-item", { hasText: item }).click();
  await expect(page.locator(".ft-item.is-new .ft-edit")).toBeFocused();
}

async function editState(page: Page): Promise<{ value: string; start: number | null; end: number | null }> {
  return page.locator(".ft-item.is-new .ft-edit").evaluate((node) => {
    const input = node as HTMLInputElement;
    return { value: input.value, start: input.selectionStart, end: input.selectionEnd };
  });
}

test("始终预填：zh 默认名并全选，键入即整段替换，Escape 不落盘", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await beginCreate(page);
  const state = await editState(page);
  expect(state.value).toBe("未命名笔记");
  expect(state.start, "默认名整段被选中（主文件名，不含 .md）").toBe(0);
  expect(state.end).toBe("未命名笔记".length);

  // 全选的判据：键入的第一个字符必须替换整段，而不是追加到末尾。
  await page.keyboard.type("想法");
  expect(await editState(page)).toEqual({ value: "想法", start: 2, end: 2 });

  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
  const mutations = await fsMutations(page);
  expect(
    mutations.filter((row) => row.cmd === "fs_create_file" || row.cmd === "fs_create_dir"),
    "Escape 取消必须不产生创建调用",
  ).toEqual([]);
});

test("始终预填：Tab 不被接管（沿用既有的失焦取消）", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await beginCreate(page);
  await page.keyboard.press("Tab");
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
  const mutations = await fsMutations(page);
  expect(
    mutations.filter((row) => row.cmd === "fs_create_file"),
    "Tab 只移动焦点并触发既有失焦取消，不创建文件",
  ).toEqual([]);
});

test("始终预填：Enter 接受默认名，补 .md 落盘并自动打开，焦点落正文", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  await beginCreate(page);
  await page.keyboard.press("Enter");

  await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "docs/未命名笔记.md");
  await expect(page.locator(".cm-content")).toBeFocused();
  const mutations = await fsMutations(page);
  expect(mutations).toContainEqual({
    cmd: "fs_create_file",
    path: "docs/未命名笔记.md",
  });
});

test("始终预填：同级已有默认名时自动编号，既有条目不被覆盖", async ({ page }) => {
  await stubTauri(page, {
    root: VAULT_ROOT,
    entries: COLLISION_ENTRIES,
    files: COLLISION_FILES,
  });
  await page.goto("/");

  await beginCreate(page);
  expect((await editState(page)).value).toBe("未命名笔记 3");

  await page.keyboard.press("Enter");
  await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "docs/未命名笔记 3.md");
});

test("始终预填：界面语言 en 时预填 Untitled note", async ({ page }) => {
  await stubTauri(page, {
    ...DEMO_VAULT,
    root: VAULT_ROOT,
    config: { language: "en" },
  });
  await page.goto("/");

  await beginCreate(page, "docs", "New file…");
  const state = await editState(page);
  expect(state.value).toBe("Untitled note");
  expect(state.start).toBe(0);
  expect(state.end).toBe("Untitled note".length);
});

test("始终预填：新建子目录与重命名不受影响", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, root: VAULT_ROOT });
  await page.goto("/");

  // 新建子目录：仍为空 + 既有占位。
  await page.locator('.ft-row[title="docs"]').click({ button: "right" });
  await page.locator(".ft-menu .ft-menu-item", { hasText: "新建子目录…" }).click();
  const dirInput = page.locator(".ft-item.is-new .ft-edit");
  await expect(dirInput).toHaveValue("");
  await expect(dirInput).toHaveAttribute("placeholder", "未命名");
  await page.keyboard.press("Escape");

  // 重命名：预填既有条目名，不掺默认名。
  await page.locator('.ft-row[title="docs/guide.md"]').click({ button: "right" });
  await page.locator(".ft-menu .ft-menu-item", { hasText: "重命名…" }).click();
  await expect(page.locator(".ft-row.is-editing .ft-edit")).toHaveValue("guide.md");
});
