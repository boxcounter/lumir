import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const fixture = readFileSync(new URL("../fixtures/table-foundation-v2/representative.md", import.meta.url), "utf8");

test("表格可见行、降级边界、AX、滚动和源码复制", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubTauri(page, { entries: [{ path: "table.md", kind: "file", size: fixture.length, mtime_ms: 0 }], files: { "table.md": fixture } });
  await page.goto("/");
  await page.locator('.ft-row[title="table.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  await expect(page.locator(".cm-lp-table-cell")).toContainText(["Name", "alpha"]);
  await expect(page.locator(".cm-lp-table-cell-empty")).toHaveCount(1);
  const geometry = await page.locator(".cm-lp-table-row").evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  }));
  expect(geometry.every((row) => row.height > 0)).toBeTruthy();
  for (let i = 1; i < geometry.length; i++) expect(geometry[i].top).toBeGreaterThanOrEqual(geometry[i - 1].bottom - 1);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveAttribute("role", "region");
  await expect(page.locator(".cm-lp-table")).toHaveAttribute("role", "table");
  await expect(page.locator(".cm-lp-table-cell[role=columnheader]")).toHaveCount(3);
  await expect(page.locator(".cm-lp-table-degraded")).toHaveCount(1);
  await expect(page.locator(".cm-lp-table-degraded")).toContainText("表格阅读降级：保留原始 Markdown");
  expect(await readDocument(page)).toBe(fixture);
  await page.locator(".cm-lp-table-scroll").focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fixture);
  expect(await readDocument(page)).toBe(fixture);
});

test("超长表不全量物化可见表格行", async ({ page }) => {
  const source = `| key | value |\n| --- | --- |\n${Array.from({ length: 8000 }, (_, i) => `| row-${i} | ${"x".repeat(12)} |`).join("\n")}\n`;
  await stubTauri(page, { entries: [{ path: "long.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "long.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("row-0");
  expect(await readDocument(page)).toBe(source);
});
