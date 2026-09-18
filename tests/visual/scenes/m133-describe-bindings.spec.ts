import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { COMMAND_IDS, KEY_BINDINGS } from "../../../src/keys";
import { configGets, stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M133：键位查看面板（app.describe-bindings，默认键 ⌘/）。dogfood 期的自用查看器：
// 面板列的是**生效中**的键位表（分发器真正在用的那份，即 applyKeyOverrides 的产物），
// 被配置解绑的命令仍留在视野里并标注「未绑定」。这里守三件事：
//   1. 面板内容与生效表一致（分组、键位写法、来由，以及解绑/重绑后的差异）；
//   2. 面板打开期间 editor 作用域的键不穿透到文档（焦点在遮罩上，作用域天然不命中）；
//   3. 三条关闭路径（Esc / ⌃G / 点遮罩）都关得掉，并把焦点交还编辑器。

const DOC = "# 标题\n\n内容段落。\n";

const GROUPS = ["移动与选择", "扩选", "删除", "kill-yank", "翻屏", "撤销", "widget", "标签", "全局"];

/** 装载 vault 并等配置到位（[keys] 覆盖在 config_get 之后才挂上分发器）。 */
async function openVault(page: Page, config?: { keys?: Record<string, string | null> }): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "keys.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "keys.md": DOC },
    config,
  });
  await page.goto("/");
  await page.locator('.ft-row[title="keys.md"]').click();
  await expect(page.locator(".masthead-file")).toHaveText("keys.md");
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

interface ViewHandle {
  dispatch(tr: unknown): void;
  focus(): void;
  state: { selection: { main: { head: number } } };
}

/** 把光标放到 pos 并把焦点交给编辑器（面板打开前的常态焦点）。 */
async function focusEditor(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewHandle } } })
      .cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

async function cursorHead(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewHandle } } }).cmTile.root
        .view.state.selection.main.head,
  );
}

async function openPanel(page: Page): Promise<void> {
  await page.keyboard.press("Meta+/");
  await expect(page.locator(".lumir-bindings-panel")).toBeVisible();
}

test("⌘/ 打开面板：列出生效表里全部键位并按功能族分组", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  // 分组标题与顺序（8 组覆盖全部命令，无兜底分组）
  expect(await page.locator(".lumir-bindings-group-title").allTextContents()).toEqual(GROUPS);

  // 逐行即逐绑定：默认表里每条绑定一行，每条命令都有键位指向它 → 无「未绑定」行
  await expect(page.locator(".lumir-bindings-row")).toHaveCount(KEY_BINDINGS.length);
  await expect(page.locator(".lumir-bindings-row.is-unbound")).toHaveCount(0);

  // 每条命令都在面板里出现（没有命令从视野里消失）
  for (const command of COMMAND_IDS) {
    await expect(page.locator(`.lumir-bindings-row[data-command="${command}"]`).first()).toBeVisible();
  }

  // 一行里键位写法 + 命令 id + 来由都有
  const removeChar = page.locator('.lumir-bindings-row[data-command="editor.delete-char-forward"]');
  await expect(removeChar.locator(".lumir-bindings-key")).toHaveText("Ctrl-d");
  await expect(removeChar.locator(".lumir-bindings-doc")).toContainText("Emacs C-d");

  // 面板自己的键位也在表里（⌘/ 由生效表驱动，不是面板的旁路）
  const panelRow = page.locator('.lumir-bindings-row[data-command="app.describe-bindings"]');
  await expect(panelRow.locator(".lumir-bindings-key")).toHaveText("Cmd-/");
  await expect(panelRow.locator(".lumir-bindings-doc")).toContainText("⌘/");

  await expectScreenshot(page.locator(".lumir-bindings-overlay"), "describe-bindings-panel.png");
});

test("面板显示生效表：配置重绑后按配置渲染，不是静态默认表", async ({ page }) => {
  await openVault(page, { keys: { "Ctrl-j": "editor.undo" } });
  await focusEditor(page, DOC.length);
  await openPanel(page);

  // 重绑新增一条绑定（默认表里没有 ⌃J），并且带着「用户配置重绑」的来由
  const rebind = page.locator('.lumir-bindings-row[data-command="editor.undo"]').filter({ hasText: "Ctrl-j" });
  await expect(rebind).toHaveCount(1);
  await expect(rebind.locator(".lumir-bindings-doc")).toContainText("用户配置重绑");
  // 默认的 ⌘Z 仍在（覆盖只加不删）
  await expect(
    page.locator('.lumir-bindings-row[data-command="editor.undo"]').filter({ hasText: "Cmd-z" }),
  ).toHaveCount(1);
  await expect(page.locator(".lumir-bindings-row")).toHaveCount(KEY_BINDINGS.length + 1);
});

test("解绑后命令仍在视野里：⌘S 解绑 → document.save 标注「未绑定」", async ({ page }) => {
  await openVault(page, { keys: { "Cmd-s": null } });
  await focusEditor(page, DOC.length);
  await openPanel(page);

  const unbound = page.locator('.lumir-bindings-row[data-command="document.save"]');
  await expect(unbound).toHaveCount(1);
  await expect(unbound).toHaveClass(/is-unbound/);
  await expect(unbound.locator(".lumir-bindings-key")).toHaveText("未绑定");
  await expect(unbound.locator(".lumir-bindings-doc")).toContainText("没有键位指向它");
  // 解绑只少一条绑定，其余行数不变（未绑定行补上那条命令的位置）
  await expect(page.locator(".lumir-bindings-row")).toHaveCount(KEY_BINDINGS.length);
  await expect(
    page.locator('.lumir-bindings-row[data-command="document.save"] .lumir-bindings-key'),
  ).not.toHaveText("Cmd-s");
});

test("面板打开期间 editor 作用域键不穿透到文档", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length - 1);
  const before = await cursorHead(page);

  await openPanel(page);
  // 焦点必须在遮罩内——editor 作用域不命中是这条前提的直接后果，不靠假设
  expect(
    await page.evaluate(() => document.querySelector(".lumir-bindings-panel")?.contains(document.activeElement) ?? false),
  ).toBe(true);

  // 编辑类键（删除 / kill / 行首 / 扩选）、Tab 与普通输入一律不动文档
  for (const key of ["Control+d", "Control+k", "Control+a", "Control+n", "Control+Shift+f", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
  }
  await page.keyboard.type("draft");
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(DOC);
  expect(await cursorHead(page), "面板打开期间光标不得被编辑器命令移动").toBe(before);
  // Tab 不得把焦点送出面板（焦点一旦落到编辑器，穿透保证就失效了）
  expect(
    await page.evaluate(() => document.querySelector(".lumir-bindings-panel")?.contains(document.activeElement) ?? false),
  ).toBe(true);

  // 关闭后焦点交还编辑器，编辑键恢复生效（证明前一段的「不动」来自作用域而非命令坏了）
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-bindings-panel")).toBeHidden();
  expect(
    await page.evaluate(() => document.querySelector(".cm-content")?.contains(document.activeElement) ?? false),
  ).toBe(true);
  await page.keyboard.press("Control+d");
  await expect.poll(() => readDocument(page), "关闭后 ⌃D 应恢复删字符").toBe(
    DOC.slice(0, before) + DOC.slice(before + 1),
  );
});

test("三条关闭路径：Esc / ⌃G / 点遮罩；点面板本体不关", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);

  await openPanel(page);
  await page.keyboard.press("Control+g");
  await expect(page.locator(".lumir-bindings-panel")).toBeHidden();

  await openPanel(page);
  // 点在面板本体上不关闭（面板内要能选中文本）
  await page.locator(".lumir-bindings-title").click();
  await expect(page.locator(".lumir-bindings-panel")).toBeVisible();
  // 点遮罩关闭
  await page.locator(".lumir-bindings-overlay").click({ position: { x: 8, y: 8 } });
  await expect(page.locator(".lumir-bindings-panel")).toBeHidden();

  // 打开键本身是切换：打开态再按 ⌘/ 即关
  await openPanel(page);
  await page.keyboard.press("Meta+/");
  await expect(page.locator(".lumir-bindings-panel")).toBeHidden();
});
