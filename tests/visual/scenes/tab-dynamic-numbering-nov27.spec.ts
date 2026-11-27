import { expect, test, type Page } from "@playwright/test";
import { readDocument } from "./parity-checks";
import { configApplied, stubTauri, type VaultFixture } from "./tauri-stub";

const LONG_NAME = "a-very-long-tab-name-that-must-stay-clear-of-the-command-number.md";
const NAMES = [LONG_NAME, ...Array.from({ length: 11 }, (_, index) => `chapter-${String(index + 1).padStart(2, "0")}-probe.md`)];
const FILES = Object.fromEntries(NAMES.map((name, index) => [name, `# Tab ${index + 1}\n\n合成正文 ${index + 1}。\n`]));
const VAULT: VaultFixture = {
  entries: NAMES.map((path) => ({ path, kind: "file", size: FILES[path].length, mtime_ms: 0 })),
  files: FILES,
  links: {},
  config: { keys: { "Cmd-F2": "pane.split", "Cmd-F3": "pane.close" } },
};

async function boot(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await configApplied(page);
}

async function openTabs(page: Page, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.locator(`.ft-row[title="${NAMES[index]}"]`).click(index === 0 ? {} : { modifiers: ["Meta"] });
    await expect(page.locator(".tab")).toHaveCount(index + 1);
  }
}

async function layoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const strip = document.querySelector<HTMLElement>(".tabstrip");
    const editor = document.querySelector<HTMLElement>(".editor-pane");
    if (!strip || !editor) return null;
    return {
      tabs: [...strip.querySelectorAll<HTMLElement>(".tab")].map((tab) => {
        const rect = tab.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width, top: rect.top, height: rect.height };
      }),
      scrollLeft: strip.scrollLeft,
      scrollWidth: strip.scrollWidth,
      stripWidth: strip.getBoundingClientRect().width,
      editor: editor.getBoundingClientRect().toJSON(),
      labels: [...strip.querySelectorAll<HTMLElement>(".tab-open")].map((tab) => tab.getAttribute("aria-label")),
      activeElement: (document.activeElement as HTMLElement | null)?.className ?? "",
    };
  });
}

async function expectIndexInLeftGutter(page: Page): Promise<void> {
  const geometries = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".tab")]
      .filter((tab) => tab.querySelector(".tab-cmd-index") !== null)
      .map((tab) => {
      const index = tab.querySelector<HTMLElement>(".tab-cmd-index");
      const open = tab.querySelector<HTMLElement>(".tab-open");
      const close = tab.querySelector<HTMLElement>(".tab-close");
      if (!index || !open || !close) return null;
      return {
        index: index.getBoundingClientRect().toJSON(),
        open: open.getBoundingClientRect().toJSON(),
        close: close.getBoundingClientRect().toJSON(),
        pointerEvents: getComputedStyle(index).pointerEvents,
        ariaHidden: index.getAttribute("aria-hidden"),
      };
    }),
  );
  expect(geometries.length).toBeGreaterThan(0);
  for (const geometry of geometries) {
    expect(geometry, "序号/标签按钮读不到，判 FAIL 而非跳过").not.toBeNull();
    expect(geometry!.index.left).toBeGreaterThanOrEqual(geometry!.open.left - 14);
    expect(geometry!.index.right).toBeLessThanOrEqual(geometry!.open.left);
    expect(geometry!.index.right).toBeLessThan(geometry!.close.left);
    expect(geometry!.pointerEvents).toBe("none");
    expect(geometry!.ariaHidden).toBe("true");
  }
}

test("Command 动态序号：单标签与长名称不遮内容；松开/blur/hidden 清理且几何、文档、焦点不变", async ({ page }) => {
  await boot(page);
  await openTabs(page, 1);
  await page.locator(".cm-content").click();
  const before = await layoutSnapshot(page);
  const documentBefore = await readDocument(page);
  expect(before).not.toBeNull();

  await page.keyboard.down("Meta");
  await expect(page.locator(".tabstrip")).toHaveClass(/is-cmd-held/);
  await expect(page.locator(".tab-cmd-index")).toHaveText(["1"]);
  await expect(page.locator(".tab-cmd-index")).toBeVisible();
  await expectIndexInLeftGutter(page);
  expect(await layoutSnapshot(page)).toEqual(before);
  expect(await readDocument(page)).toBe(documentBefore);

  await page.keyboard.up("Meta");
  await expect(page.locator(".tab-cmd-index")).toBeHidden();
  await expect(page.locator(".tabstrip")).not.toHaveClass(/is-cmd-held/);
  expect(await layoutSnapshot(page)).toEqual(before);

  await page.keyboard.down("Meta");
  await expect(page.locator(".tab-cmd-index")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".tab-cmd-index")).toBeHidden();

  await page.keyboard.down("Meta");
  await expect(page.locator(".tab-cmd-index")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".tab-cmd-index")).toBeHidden();
  await page.keyboard.up("Meta");
  expect(await readDocument(page)).toBe(documentBefore);
  expect(await layoutSnapshot(page)).toEqual(before);
});

test("Command 动态序号：溢出时只有 1–9，显示不改宽度/滚动；⌘0 无标签动作，⌘1 仍直达", async ({ page }) => {
  await boot(page);
  await openTabs(page, 12);
  await page.locator(".cm-content").click();
  await page.locator(".tabstrip").evaluate((strip: HTMLElement) => {
    strip.scrollLeft = 37;
  });
  const before = await layoutSnapshot(page);
  const documentBefore = await readDocument(page);
  expect(before).not.toBeNull();
  expect(before!.scrollWidth).toBeGreaterThan(before!.stripWidth);
  expect(before!.scrollLeft).toBe(37);

  await page.keyboard.down("Meta");
  await expect(page.locator(".tab-cmd-index:visible")).toHaveText(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  await expect(page.locator(".tab").nth(9).locator(".tab-cmd-index")).toHaveCount(0);
  await expectIndexInLeftGutter(page);
  expect(await layoutSnapshot(page)).toEqual(before);

  await page.keyboard.press("0");
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(NAMES[11]);
  expect(await readDocument(page)).toBe(documentBefore);
  await page.keyboard.press("1");
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(LONG_NAME);
  await expect(page.locator(".cm-content")).toContainText("合成正文 1。");
  await expect(page.locator(".tab-cmd-index:visible")).toHaveCount(9);
  await page.keyboard.up("Meta");
  await expect(page.locator(".tab-cmd-index:visible")).toHaveCount(0);
  expect(await readDocument(page)).not.toBe(documentBefore);
});

test("Command 动态序号：按住时开关/切换 pane，只有当前 pane 出号；收拢后销毁实例不粘住", async ({ page }) => {
  await boot(page);
  await openTabs(page, 1);
  await page.keyboard.down("Meta");
  await expect(page.locator(".tab-cmd-index:visible")).toHaveText(["1"]);

  await page.keyboard.press("F2");
  await expect(page.locator(".tabstrip")).toHaveCount(2);
  await expect(page.locator(".tab-cmd-index:visible")).toHaveCount(0);
  await page.keyboard.press("F3");
  await expect(page.locator(".tabstrip")).toHaveCount(1);
  await expect(page.locator(".tab-cmd-index:visible")).toHaveText(["1"]);

  await page.keyboard.press("F2");
  await page.locator('.ft-row[title="chapter-01-probe.md"]').click();
  const strips = page.locator(".tabstrip");
  await expect(strips).toHaveCount(2);
  await expect(strips.nth(1).locator(".tab-name")).toHaveText(["chapter-01-probe.md"]);
  await expect(strips.nth(0).locator(".tab-cmd-index:visible")).toHaveCount(0);
  await expect(strips.nth(1).locator(".tab-cmd-index:visible")).toHaveText(["1"]);

  await strips.nth(0).locator(".tab-open").click();
  await expect(strips.nth(0).locator(".tab-cmd-index:visible")).toHaveText(["1"]);
  await expect(strips.nth(1).locator(".tab-cmd-index:visible")).toHaveCount(0);
  await page.keyboard.press("F3");
  await expect(page.locator(".tabstrip")).toHaveCount(1);
  await expect(page.locator(".tab-cmd-index:visible")).toHaveText(["1", "2"]);

  await page.keyboard.up("Meta");
  await expect(page.locator(".tab-cmd-index:visible")).toHaveCount(0);
  await page.keyboard.down("Meta");
  await expect(page.locator(".tab-cmd-index:visible")).toHaveText(["1", "2"]);
  await page.keyboard.up("Meta");
});
