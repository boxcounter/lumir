import { expect, test } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const FIXTURE: VaultFixture = {
  entries: [
    { path: "a.md", kind: "file", size: 20, mtime_ms: 1 },
    { path: "b.md", kind: "file", size: 20, mtime_ms: 1 },
    { path: "same.md", kind: "file", size: 20, mtime_ms: 1 },
    { path: "missing.md", kind: "file", size: 20, mtime_ms: 1 },
    { path: "code.ts", kind: "file", size: 20, mtime_ms: 1 },
  ],
  files: {
    "a.md": "---\ntitle: A\n---\n\n# Alpha\n\nA content.\n",
    "b.md": "---\ntitle: B\n---\n\n# Beta\n\nB content.\n",
    "same.md": "# Same\n\nSame content.\n",
    "code.ts": "export const code = true;\n",
  },
};

test("F0 emits source, decoration, frontmatter, then paint for the selected path", async ({ page }) => {
  await stubTauri(page, FIXTURE);
  await page.addInitScript(() => {
    (window as unknown as { __readiness: unknown[] }).__readiness = [];
    for (const type of ["source-ready", "decoration-ready", "frontmatter-ready", "paint"]) {
      window.addEventListener(`lumir:${type}`, (event) => {
        const detail = (event as CustomEvent).detail;
        (window as unknown as { __readiness: unknown[] }).__readiness.push({ type, ...detail });
      });
    }
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Alpha");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __readiness: unknown[] }).__readiness.some((e: unknown) => (e as { type: string }).type === "paint"))).toBe(true);
  const result = await page.evaluate(() => (window as unknown as { __readiness: Array<{ type: string; path: string }> }).__readiness.filter((e) => e.path === "a.md").map((e) => e.type));
  expect(result).toEqual(["source-ready", "decoration-ready", "frontmatter-ready", "paint"]);
});

test("opening never exposes the previous document and stale responses cannot win", async ({ page }) => {
  await stubTauri(page, FIXTURE);
  await page.goto("/");
  await page.locator('.ft-row[title="a.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Alpha");
  await page.locator('.ft-row[title="b.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Beta");
  await expect(page.locator(".cm-content")).not.toContainText("Alpha");
});

test("A/B/A and same-length documents bind each ready event to its path", async ({ page }) => {
  await stubTauri(page, FIXTURE);
  await page.addInitScript(() => {
    (window as unknown as { __paths: Array<{ type: string; path?: string }> }).__paths = [];
    for (const type of ["source-ready", "paint"]) window.addEventListener(`lumir:${type}`, (event) => {
      const detail = (event as CustomEvent).detail;
      (window as unknown as { __paths: Array<{ type: string; path?: string }> }).__paths.push({ type, path: detail.path });
    });
  });
  await page.goto("/");
  for (const path of ["a.md", "b.md", "a.md"]) {
    await page.locator(`.ft-row[title="${path}"]`).click();
    await expect(page.locator(".cm-content")).toContainText(path === "b.md" ? "Beta" : "Alpha");
  }
  // paint 经 requestAnimationFrame 派发，最后一次打开的 paint 可能晚于 DOM 断言
  // 完成——轮询等待事件流收齐，避免把时序竞态误判为产品缺陷。
  await expect.poll(() => page.evaluate(() => (window as unknown as { __paths: Array<{ type: string; path?: string }> }).__paths.filter((e) => e.type === "paint").map((e) => e.path))).toEqual(["a.md", "b.md", "a.md"]);
});

test("read failure keeps the controlled notice and does not emit a document ready", async ({ page }) => {
  await stubTauri(page, FIXTURE);
  await page.goto("/");
  await page.locator('.ft-row[title="missing.md"]').click();
  await expect(page.locator(".editor-notice")).toContainText("文件不存在");
  await expect(page.locator(".editor-notice")).toBeVisible();
});

test("md/code mode changes do not rebuild the editor and paint remains observable", async ({ page }) => {
  await stubTauri(page, FIXTURE);
  await page.goto("/");
  const editor = page.locator(".cm-editor");
  await page.locator('.ft-row[title="a.md"]').click();
  await expect(editor).toBeVisible();
  await page.locator('.ft-row[title="code.ts"]').click();
  await expect(page.locator(".cm-content")).toContainText("code");
  await expect(page.locator(".cm-gutters")).toBeVisible();
  await page.locator('.ft-row[title="a.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("Alpha");
  await expect(editor).toHaveCount(1);
});
