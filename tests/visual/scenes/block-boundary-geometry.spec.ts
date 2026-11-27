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
    // change fix-empty-line-height-stability-nov27：普通正文行的纵向 padding 恒 0——旧模型让
    // 「下一行是块边界」给前行 8px 下距，空行落字 / 标题↔正文时未编辑行的高度会翻转。
    await expect(lines.nth(0)).toHaveCSS("padding-bottom", "0px");
    await expect(lines.nth(1)).toHaveCSS("padding-top", `${c.top}px`);
    await expect(lines.nth(1)).toHaveCSS("padding-bottom", `${c.bottom}px`);
    await expectScreenshot(page.locator(".cm-editor"), `block-boundary-${c.name}.png`);
  });
}

test("块边界静态几何：文档末行正文不带下距（末尾留白由 .cm-content padding 承担）", async ({ page }) => {
  await openDoc(page, "para");
  const lines = page.locator(".cm-content .cm-line");
  await expect(lines).toHaveCount(1);
  await expect(lines.nth(0)).toHaveCSS("padding-bottom", "0px");
  await expect(lines.nth(0)).toHaveCSS("padding-top", "0px");
});
