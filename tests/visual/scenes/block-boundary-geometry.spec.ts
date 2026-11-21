import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { expectScreenshot } from "./expect-screenshot";

async function openDoc(page: Page, doc: string): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "boundary.md", kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { "boundary.md": doc },
    links: {},
  });
  await page.goto("/");
  await page.locator('.ft-row[title="boundary.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("boundary.md");
}

const CASES = [
  { name: "dash-space", doc: "para\n- ", top: 2, bottom: 0 },
  { name: "plus-space", doc: "para\n+ ", top: 2, bottom: 0 },
  { name: "setext-dash", doc: "para\n---", top: 0, bottom: 0 },
  { name: "setext-equals", doc: "para\n===", top: 0, bottom: 0 },
] as const;

for (const c of CASES) {
  test(`块边界静态几何：${c.name}`, async ({ page }) => {
    await openDoc(page, c.doc);
    const lines = page.locator(".cm-content .cm-line");
    await expect(lines).toHaveCount(2);
    await expect(lines.nth(0)).toHaveCSS("padding-bottom", "8px");
    await expect(lines.nth(1)).toHaveCSS("padding-top", `${c.top}px`);
    await expect(lines.nth(1)).toHaveCSS("padding-bottom", `${c.bottom}px`);
    await expectScreenshot(page.locator(".cm-editor"), `block-boundary-${c.name}.png`);
  });
}
