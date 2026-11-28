import { expect, test } from "@playwright/test";
import { expectScreenshot, expectStartupScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// change add-first-run-onboarding-nov25 的像素层（Alex 2026-11-26 批准候选后新增）：
//   1. 启动态首启模式（唯一「添加 vault」，整窗居中）：启动面在场即截图对象，走
//      `expectStartupScreenshot`（不等启动面撤下）；
//   2. 首启空工作区（tips + 默认 harness）：启动面已撤下，走 `expectScreenshot` 的撤下门与
//      chrome 就绪门；
//   3. 老用户空 vault（统一空工作区 + New note）：同走 `expectScreenshot`。
// 三主题各一张；判据面（唯一按钮、tips 文案、空工作区 / New note、命令闸门等）在
// `first-run-empty-state.spec.ts`，本文件只冻结像素。
const THEMES = ["light", "dark", "eink"] as const;

/** 首启空工作区：有文件但没有会话历史——按首启规则出 tips + 默认 harness。 */
const FIRST_RUN_VAULT: VaultFixture = {
  root: "/Users/alex/first-run-vault",
  vault_id: "first-run-vault",
  entries: [{ path: "note.md", kind: "file", size: 20, mtime_ms: 1 }],
  files: { "note.md": "# Note\n" },
  lastVault: null,
};

/** 老用户空 vault：`last_vault` 非 null（非首启），条目为空 → 统一空工作区 + New note。 */
const EMPTY_VAULT: VaultFixture = {
  root: "/Users/alex/empty-vault",
  vault_id: "empty-vault",
  entries: [],
  files: {},
};

for (const theme of THEMES) {
  test(`首启模式（${theme}）：唯一「添加 vault」，整窗居中`, async ({ page }) => {
    await stubTauri(page, null, { theme });
    await page.goto("/");
    await expect(page.locator("#startup.startup-first-run")).toBeVisible();
    await expect(page.getByRole("button", { name: "添加 vault" })).toBeVisible();
    await expect(page.locator(".startup-sidebar")).toHaveCount(0);
    await expectStartupScreenshot(page, `first-run-${theme}.png`);
  });

  test(`首启 tips（${theme}）：tips + 默认 harness`, async ({ page }) => {
    await stubTauri(page, { ...FIRST_RUN_VAULT, config: { language: "en", theme } });
    await page.goto("/");
    await expect(page.locator(".first-run-tips")).toBeVisible();
    await expect(page.locator(".lumir-harness")).toBeVisible();
    await expect(page.locator("#startup")).toHaveCount(0);
    await expectScreenshot(page, `tips-${theme}.png`);
  });

  test(`老用户空 vault（${theme}）：空工作区 + New note`, async ({ page }) => {
    await stubTauri(page, { ...EMPTY_VAULT, config: { language: "en", theme } });
    await page.goto("/");
    await expect(page.locator(".pane-empty-title")).toHaveText("No document open");
    await expect(page.getByRole("button", { name: "New note" })).toBeVisible();
    await expect(page.locator("#startup")).toHaveCount(0);
    await expectScreenshot(page, `old-user-empty-${theme}.png`);
  });
}
