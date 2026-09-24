import { expect, test, type Page } from "@playwright/test";
import { configGets, documentWrites, stubTauri, type VaultFixture } from "./tauri-stub";

// 可编辑宿主守卫（change list-filter，M199 r1 P1-1）的 chromium 断言。
//
// 被测行为来自 approved delta 的 scenario「用户单字符绑定在浮层打开期间让位」：用户把 `s` 绑成
// `document.save`（scope 由命令派生为 **global**）后，① 在浮层/搜索框的输入框里打 `s` SHALL 只作为
// 普通字符落入输入框、那条命令 MUST NOT 触发；② 浮层外（编辑器里）打 `s` SHALL 照常触发保存。
//
// 判据为什么落在这里（而不是真机）：本断言要读**命令是否执行**，而「执行了但没写盘」与「压根没执行」
// 在界面上难以区分——用桩的 `document_save` 调用记录（`documentWrites`）当判据是确定路径。真机侧同类
// 现象（字符进不进输入框）由 `scripts/acceptance/scenarios/32-list-filter.md` 的 AXValue 断言覆盖。
//
// 修前的现场（reviewer 走查 + 本场景可复现）：单字符 token 在表里合法且归一成大写，
// `defaultPrevented=false` 的 `s` 冒泡到 window 分发器 → trie 命中 → global 作用域不做编辑器检查 →
// `preventDefault()` + 保存：**字符进不了输入框，保存反而触发**，与 scenario 的 THEN 恰好相反。

const DOC = "# 第一部分\n正文一。\n\n## 甲小节\n正文二。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "guard.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "guard.md": DOC },
  links: {},
  config: { keys: { s: "document.save" } },
};

/** 打开文档、改一笔让它 dirty（`x` 没被绑定，照常落进文档），并等 [keys] 覆盖挂上分发器。 */
async function openDirty(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="guard.md"]').click();
  await expect(page.locator(".masthead-file")).toHaveText("guard.md");
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+ArrowDown"); // 光标到文档末尾（原生路径，不经本层绑定）
  await page.keyboard.type("x");
  await expect(page.locator(".cm-content")).toContainText("x");
}

test("单字符 [keys] 绑定在大纲筛选输入框里让位：字符落入输入框、命令不触发", async ({ page }) => {
  await openDirty(page);
  const writesBefore = (await documentWrites(page)).length;

  // 打开浮层：焦点随打开落到筛选输入框（`role=combobox`）
  await page.keyboard.press("Meta+Shift+o");
  const input = page.locator(".lumir-toc-input");
  await expect(input).toBeVisible();

  // ① 输入框里打 `s`：字符落进去（值 = "s"），且**保存没有触发**（无写盘、无「已保存」浮条）
  await page.keyboard.type("s");
  await expect(input).toHaveValue("s");
  // 顺带钉住「输入事件照常生效」：查询 `s` 在本文档零命中 → 无匹配提示出现
  await expect(page.locator(".lumir-toc-empty")).toBeVisible();
  expect((await documentWrites(page)).length, "输入框里的 `s` MUST NOT 触发保存").toBe(writesBefore);
  await expect(page.locator(".lumir-toast", { hasText: /^已保存$/ })).toHaveCount(0);

  // ② 浮层外（焦点交还编辑器）打 `s`：照常触发保存
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-toc")).toBeHidden();
  await page.keyboard.press("s");
  await expect(page.locator(".lumir-toast", { hasText: /^已保存$/ })).toBeVisible();
  await expect.poll(async () => (await documentWrites(page)).length).toBe(writesBefore + 1);
  expect((await documentWrites(page)).at(-1)?.content).toContain("x");
});

test("同一守卫覆盖搜索 panel：输入框里打 `s` 不触发保存、字符落进查询框", async ({ page }) => {
  await openDirty(page);
  const writesBefore = (await documentWrites(page)).length;

  await page.keyboard.press("Meta+f");
  const query = page.locator(".lumir-search-input");
  await expect(query).toBeVisible();
  await query.fill("");

  await page.keyboard.type("s");
  await expect(query).toHaveValue("s");
  expect((await documentWrites(page)).length, "搜索框里的 `s` MUST NOT 触发保存").toBe(writesBefore);
  await expect(page.locator(".lumir-toast", { hasText: /^已保存$/ })).toHaveCount(0);

  // 关闭 panel 后焦点回编辑器：`s` 恢复执行保存
  await page.keyboard.press("Escape");
  await expect(query).toHaveCount(0);
  await page.keyboard.press("s");
  await expect(page.locator(".lumir-toast", { hasText: /^已保存$/ })).toBeVisible();
  await expect.poll(async () => (await documentWrites(page)).length).toBe(writesBefore + 1);
});
