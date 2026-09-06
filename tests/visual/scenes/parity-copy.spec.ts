import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

const plain = "# 标题\n\n读一篇长文，这是首段。\n\n第二段正文。\n";
const frontmatter = "---\ntitle: 测试属性\ntags: [one, two]\n---\n\n# 正文标题\n\n完整正文不能丢失。\n";
for (const sequential of [false, true]) {
  test(`真实键盘复制 frontmatter sequential=${sequential}`, async ({ page, context }, info) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await stubTauri(page, {
      entries: ["plain.md", "frontmatter.md"].map(path => ({ path, kind: "file", size: 128, mtime_ms: 0 })),
      files: { "plain.md": plain, "frontmatter.md": frontmatter },
    });
    await page.goto("/");
    if (sequential) await page.locator('.ft-row[title="plain.md"]').click();
    await page.locator('.ft-row[title="frontmatter.md"]').click();
    await expect(page.locator(".cm-content")).toContainText("完整正文不能丢失");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Meta+c");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    await info.attach("copied", { body: JSON.stringify({ expected: frontmatter, copied }), contentType: "application/json" });
    expect(copied).toBe(frontmatter);
  });
}

test("短段与code切换不改源文", async ({ page }) => {
  await stubTauri(page, {
    entries: ["short.md", "source.ts"].map(path => ({ path, kind: "file", size: 128, mtime_ms: 0 })),
    files: { "short.md": "# 标题\n\n短段。\n\n下一段。", "source.ts": "const value = 42;" },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="short.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("短段。");
  await page.locator('.ft-row[title="source.ts"]').click();
  await expect(page.locator(".cm-content")).toHaveText("const value = 42;");
  await page.locator('.ft-row[title="short.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("下一段。");
});
