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
  const emptyCell = await page.locator(".cm-lp-table-cell-empty").evaluate((cell) => {
    const rect = cell.getBoundingClientRect();
    return { width: rect.width, height: rect.height, text: cell.textContent };
  });
  expect(emptyCell.width).toBeGreaterThan(0);
  expect(emptyCell.height).toBeGreaterThan(0);
  expect(emptyCell.text).toBe("");
  const geometry = await page.locator(".cm-lp-table-row").evaluateAll((rows) => rows.map((row) => {
    const rect = row.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  }));
  expect(geometry.every((row) => row.height > 0)).toBeTruthy();
  for (let i = 1; i < geometry.length; i++) expect(geometry[i].top).toBeGreaterThanOrEqual(geometry[i - 1].bottom - 1);
  // 行高回归：行不得被隐藏管道符留下的 widgetBuffer 占位撑高——
  // 修复前行高约 92px（单元格 33px + 2 条隐式 grid 行），修复后应与单元格同高。
  const cellHeight = await page.locator(".cm-lp-table-cell").first().evaluate((cell) => cell.getBoundingClientRect().height);
  for (const row of geometry) expect(row.height).toBeLessThan(cellHeight + 2);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveAttribute("role", "region");
  await expect(page.locator(".cm-lp-table")).toHaveAttribute("role", "table");
  await expect(page.locator(".cm-lp-table-cell[role=columnheader]")).toHaveCount(3);
  await expect(page.locator(".cm-lp-table-degraded")).toHaveCount(1);
  await expect(page.locator(".cm-lp-table-degraded")).toHaveAttribute("aria-label", "表格阅读降级：保留原始 Markdown");
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

test("超长表安全源码降级且不全量物化可见表格行", async ({ page }) => {
  const source = `| key | value |\n| --- | --- |\n${Array.from({ length: 8000 }, (_, i) => `| row-${i} | ${"x".repeat(12)} |`).join("\n")}\n`;
  await stubTauri(page, { entries: [{ path: "long.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "long.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("row-0");
  expect(await page.locator(".cm-line").count()).toBeLessThan(300);
  expect(await readDocument(page)).toBe(source);
});

interface CellRect { text: string; left: number; top: number; width: number; }

async function tableGridGeometry(page: import("@playwright/test").Page): Promise<CellRect[][]> {
  return page.locator(".cm-lp-table-row").evaluateAll((rows) => rows.map((row) =>
    [...row.querySelectorAll<HTMLElement>(".cm-lp-table-cell")].map((cell) => {
      const rect = cell.getBoundingClientRect();
      return { text: cell.textContent ?? "", left: rect.left, top: rect.top, width: rect.width };
    }),
  ));
}

function expectVerticalColumns(grid: CellRect[][], columns: number) {
  expect(grid.length).toBeGreaterThan(1);
  for (const row of grid) {
    expect(row).toHaveLength(columns);
    for (let column = 1; column < columns; column++) {
      expect(row[column].left).toBeGreaterThan(row[column - 1].left + row[column - 1].width - 1);
      expect(Math.abs(row[column].top - row[0].top)).toBeLessThan(1);
    }
  }
  for (let column = 0; column < columns; column++) {
    for (let row = 1; row < grid.length; row++) {
      expect(Math.abs(grid[row][column].left - grid[0][column].left)).toBeLessThan(1);
      expect(grid[row][column].top).toBeGreaterThan(grid[row - 1][column].top);
    }
  }
}

test("截图结构回归：中文表头居首行、各列垂直对齐、空槽与转义 pipe 不占列", async ({ page }) => {
  const source = readFileSync(new URL("../fixtures/table-header-layout/screenshot-repro.md", import.meta.url), "utf8");
  await stubTauri(page, { entries: [{ path: "repro.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "repro.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="repro.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const grid = await tableGridGeometry(page);
  expect(grid[0].map((cell) => cell.text)).toEqual([" 名称 ", " 状态 ", " 备注 "]);
  expect(grid[1][2].text).toContain("a\\|b");
  expect(grid[2][1].text).toBe("");
  expectVerticalColumns(grid, 3);
  const display = await page.locator(".cm-lp-table-row").first().evaluate((row) => getComputedStyle(row).display);
  expect(display).toBe("grid");
  await expect(page.locator(".cm-lp-table-separator")).toBeHidden();
  expect(await readDocument(page)).toBe(source);
});

test("窄窗口下列网格结构保持且容器可横向滚动", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const source = readFileSync(new URL("../fixtures/table-header-layout/screenshot-repro.md", import.meta.url), "utf8");
  await stubTauri(page, { entries: [{ path: "narrow.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "narrow.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="narrow.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const grid = await tableGridGeometry(page);
  expect(grid[0].map((cell) => cell.text)).toEqual([" 名称 ", " 状态 ", " 备注 "]);
  expectVerticalColumns(grid, 3);
  expect(await readDocument(page)).toBe(source);
});

test("代码块边界不触发表格增强", async ({ page }) => {
  const source = "```md\n| code | source |\n| --- | --- |\n| one | two |\n```\n\n| real | table |\n| --- | --- |\n| one | two |\n";
  await stubTauri(page, { entries: [{ path: "boundary.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "boundary.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="boundary.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  await expect(page.locator(".cm-content")).toContainText("| code | source |");
  expect(await readDocument(page)).toBe(source);
});

test("编辑器主内容宽度为可用区域的 80%，宽表仍可横向滚动", async ({ page }) => {
  const longCell = "x".repeat(220);
  const source = `# 宽度回归\n\n段落。\n\n| A | B | C |\n| --- | --- | --- |\n| ${longCell} | ${longCell} | ${longCell} |\n`;
  await stubTauri(page, { entries: [{ path: "width.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "width.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="width.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const sizes = await page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const pane = rect(".pane-editor");
    const content = rect(".cm-content");
    const tableScroll = document.querySelector(".cm-lp-table-scroll")!;
    return {
      paneWidth: pane.width,
      contentWidth: content.width,
      contentLeft: content.left,
      paneLeft: pane.left,
      paneRight: pane.right,
      contentRight: content.right,
      tableClientWidth: tableScroll.clientWidth,
      tableScrollWidth: tableScroll.scrollWidth,
      tableOverflowX: getComputedStyle(tableScroll).overflowX,
    };
  });
  // 主内容列 = 编辑窗格的 80%（grid 轨道 minmax(0, 80%)，两侧 1fr 居中）
  expect(Math.abs(sizes.contentWidth - sizes.paneWidth * 0.8)).toBeLessThan(1);
  // 居中：左右留白大致相等
  const leftGap = sizes.contentLeft - sizes.paneLeft;
  const rightGap = sizes.paneRight - sizes.contentRight;
  expect(Math.abs(leftGap - rightGap)).toBeLessThan(2);
  // 宽表在自身滚动容器内横向滚动：内容宽于可视宽，且允许横向滚动
  expect(sizes.tableScrollWidth).toBeGreaterThan(sizes.tableClientWidth);
  expect(["auto", "scroll"]).toContain(sizes.tableOverflowX);
  // 表格滚动容器不超出主内容列
  expect(sizes.tableClientWidth).toBeLessThanOrEqual(sizes.contentWidth + 1);
});

test("窄窗口下编辑器主内容仍为窗格的 80%", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const source = "# 窄窗口\n\n段落。\n";
  await stubTauri(page, { entries: [{ path: "narrow.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "narrow.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="narrow.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("段落");
  // 三主题（light/dark/eink）下 80% 行宽都应成立——主题只换 token，不改布局轨道
  for (const theme of ["light", "dark", "eink"]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    const sizes = await page.evaluate(() => {
      const pane = document.querySelector(".pane-editor")!.getBoundingClientRect();
      const content = document.querySelector(".cm-content")!.getBoundingClientRect();
      return { paneWidth: pane.width, contentWidth: content.width };
    });
    expect(sizes.paneWidth).toBeGreaterThan(0);
    expect(Math.abs(sizes.contentWidth - sizes.paneWidth * 0.8)).toBeLessThan(1);
  }
});
