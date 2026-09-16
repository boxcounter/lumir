import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";
import { degradationNotice } from "../../../src/preview/table";
import type { TableModel, TableRow } from "../../../src/preview/table";

const fixture = readFileSync(new URL("../fixtures/table-foundation-v2/representative.md", import.meta.url), "utf8");

// 降级归因文案的三条分支（M138）。oversize 与非矩形由页面场景覆盖（第 20 行短行案例 +
// 超长表 regex）；兜底分支在真实解析路径上不可达——lezer 的 GFM parser 只在 delimiter
// 行与表头列数一致时才产出 Table（实测 `| a | b | c |` + `| --- | --- |` 根本不出 Table 节点），
// 所以那条是防御性默认值。这里按 Node 侧直接断言，避免「兜底文案无人验」的静默分支。
function row(from: number, cells: number, header = false): TableRow {
  return { from, to: from + 1, header, slots: Array.from({ length: cells }, (_, index) => ({ from: from + index, to: from + index + 1 })) };
}

function table(overrides: Partial<TableModel>): TableModel {
  return {
    from: 0,
    to: 40,
    sourceBytes: 0,
    columns: 3,
    rows: [row(0, 3, true), row(20, 3)],
    separator: { from: 8, to: 9 },
    align: ["left", "left", "left"],
    rectangular: false,
    degraded: true,
    ...overrides,
  };
}

test("降级归因文案：oversize / 行数不符 / 兜底三分支", () => {
  const oversize = table({ reason: "oversize", sourceBytes: 2 * 1024 * 1024 });
  expect(degradationNotice(oversize, () => 1)).toBe(
    "表格阅读降级：表格约 2048 KiB，超过 64 KiB 阅读上限——保留原始 Markdown",
  );
  // sourceBytes 在超 64KiB 时按 0 记（findTables 的取值口径），此时退回按字符数估算
  expect(degradationNotice(table({ reason: "oversize", sourceBytes: 0, to: 1536 * 1024 }), () => 1)).toBe(
    "表格阅读降级：表格约 1536 KiB，超过 64 KiB 阅读上限——保留原始 Markdown",
  );

  // 首个与表头列数不符的行 → 取该行的文档行号（1 基，由调用方传入的行号解析器给出）
  const ragged = table({ reason: "non-rectangular", rows: [row(0, 3, true), row(20, 3), row(40, 2)] });
  expect(degradationNotice(ragged, (pos) => (pos === 40 ? 27 : 21))).toBe(
    "表格阅读降级：第 27 行单元格数与表头不符（应为 3 列）——保留原始 Markdown",
  );

  // 兜底：非 oversize 且各行与表头等宽（结构不可识别）也不静默留白
  const unknown = table({ reason: "non-rectangular", rows: [row(0, 3, true), row(20, 3)] });
  expect(degradationNotice(unknown, () => 1)).toBe("表格阅读降级：无法识别表格结构——保留原始 Markdown");
});

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
  // 降级文案带原因与出错行号（M138）：fixture 里第 20 行 `| one |` 只有 1 格，
  // 表头声明 2 列。行号是**文档行号**，用户照着就能定位到源文件那一行。
  const notice = "表格阅读降级：第 20 行单元格数与表头不符（应为 2 列）——保留原始 Markdown";
  await expect(page.locator(".cm-lp-table-degraded")).toHaveAttribute("aria-label", notice);
  // 上屏的文案与 aria-label 同源（CSS ::after 经 data 属性取用，不在样式表里另写一份）
  const painted = await page.locator(".cm-lp-table-degraded").evaluate((el) =>
    getComputedStyle(el, "::after").content.replace(/^"|"$/g, ""),
  );
  expect(painted).toBe(notice);
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
  // 超长表走 oversize 分支：文案给出体积与上限，而不是复用「列数不符」（M138）
  await expect(page.locator(".cm-lp-table-degraded")).toHaveAttribute(
    "aria-label",
    /^表格阅读降级：表格约 \d+ KiB，超过 64 KiB 阅读上限——保留原始 Markdown$/,
  );
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
  const sizes = await page.evaluate(() => {
    const pane = document.querySelector(".pane-editor")!.getBoundingClientRect();
    const content = document.querySelector(".cm-content")!.getBoundingClientRect();
    return { paneWidth: pane.width, contentWidth: content.width };
  });
  expect(sizes.paneWidth).toBeGreaterThan(0);
  expect(Math.abs(sizes.contentWidth - sizes.paneWidth * 0.8)).toBeLessThan(1);
});

test("列宽贴合内容：短内容表不拉满主栏，长内容表保持自然宽并横向滚动", async ({ page }) => {
  // 回归（M103）：修复前轨道为 minmax(max-content, 1fr)，块级 grid 默认填满
  // 80% 主栏后 1fr 把剩余空间平分给每列——短内容表的列被拉得过宽。
  const shortSource = `| 名称 | 状态 | 备注 |\n| --- | --- | --- |\n| alpha | 上线 | 短备注 |\n| beta | 开发中 | 正常备注 |\n`;
  await stubTauri(page, { entries: [{ path: "short.md", kind: "file", size: shortSource.length, mtime_ms: 0 }], files: { "short.md": shortSource } });
  await page.goto("/");
  await page.locator('.ft-row[title="short.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const short = await page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const tracks = getComputedStyle(document.querySelector(".cm-lp-table")!).gridTemplateColumns.split(" ").map((v) => parseFloat(v));
    return { tableWidth: rect(".cm-lp-table").width, contentWidth: rect(".cm-content").width, tracks };
  });
  expect(short.tracks).toHaveLength(3);
  // 贴合内容：表格明显窄于主内容列，不被 1fr 拉满
  expect(short.tableWidth).toBeLessThan(short.contentWidth * 0.6);
  // 每列贴合自身内容：列宽互不相等（等宽是 1fr 平分的特征）
  expect(Math.abs(short.tracks[0] - short.tracks[2])).toBeGreaterThan(1);

  // 长内容表（M119 合同）：无单列像素封顶，列保持内容自然宽；总宽超过栏宽时
  // 由滚动容器横向滚动承载，cell 不折行、内容不裁切（Obsidian live preview 同款）
  const longSource = `| 名称 | 状态 | 备注 |\n| --- | --- | --- |\n| alpha | 上线 | ${"长".repeat(120)} |\n`;
  await stubTauri(page, { entries: [{ path: "long.md", kind: "file", size: longSource.length, mtime_ms: 0 }], files: { "long.md": longSource } });
  await page.goto("/");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const long = await page.evaluate(() => {
    const tracks = getComputedStyle(document.querySelector(".cm-lp-table")!).gridTemplateColumns.split(" ").map((v) => parseFloat(v));
    const heights = [...document.querySelectorAll(".cm-lp-table-row:last-child .cm-lp-table-cell")].map((c) => c.getBoundingClientRect().height);
    const scroll = document.querySelector(".cm-lp-table-scroll")!;
    return { tracks, heights, tableWidth: document.querySelector(".cm-lp-table")!.getBoundingClientRect().width, contentWidth: document.querySelector(".cm-content")!.getBoundingClientRect().width, scrollWidth: scroll.scrollWidth, clientWidth: scroll.clientWidth };
  });
  expect(long.tracks).toHaveLength(3);
  // 无单列封顶：长内容列轨道 = 内容自然宽，可超过栏宽
  expect(long.tracks[2]).toBeGreaterThan(long.contentWidth);
  // 不折行：长 cell 保持单行高度（约 33px），而非折行变高
  expect(Math.max(...long.heights)).toBeLessThan(40);
  // 表宽 = 自然宽 > 栏宽，超出部分由滚动容器横滚承载而非裁切
  expect(long.tableWidth).toBeGreaterThan(long.contentWidth);
  expect(long.scrollWidth).toBeGreaterThan(long.clientWidth);
});

test("表格 cell 内 inline code 与强调渲染 live preview 样式", async ({ page }) => {
  // 回归（M103）：修复前 collectSyntaxDecorations 对表格子树整棵剪枝，
  // cell 里的 `code` / **粗体** 没有任何装饰。
  const source = `| 名称 | 说明 |\n| --- | --- |\n| alpha | 使用 \`npm run build\` 构建，**必须** 成功 |\n`;
  await stubTauri(page, { entries: [{ path: "inline.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "inline.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="inline.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const code = page.locator(".cm-lp-table-cell .cm-lp-inline-code");
  await expect(code).toHaveCount(1);
  // 反引号保留在源码与渲染中（与表外 inline code 行为一致：只加样式不隐藏标记）
  await expect(code).toHaveText("`npm run build`");
  const codeStyle = await code.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontFamily: cs.fontFamily, background: cs.backgroundColor };
  });
  expect(codeStyle.fontFamily).toContain("mono");
  expect(codeStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  // 强调：加粗装饰生效且 ** 标记被隐藏
  const strong = page.locator(".cm-lp-table-cell .cm-lp-strong");
  await expect(strong).toHaveCount(1);
  await expect(strong).toHaveText("必须");
  expect(await page.locator(".cm-lp-table-cell").last().textContent()).not.toContain("**");
  expect(await readDocument(page)).toBe(source);
});
