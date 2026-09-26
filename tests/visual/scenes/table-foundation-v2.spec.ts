import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";
import { degradationNotice } from "../../../src/preview/table";
import type { TableModel, TableRow } from "../../../src/preview/table";

const fixture = readFileSync(new URL("../fixtures/table-foundation-v2/representative.md", import.meta.url), "utf8");

// 降级归因文案的三条分支（M138）。oversize 与多列由页面场景覆盖（fixture 第 28 行
// 三格数据行 + 超长表 regex）；兜底分支在真实解析路径上不可达——lezer 的 GFM parser
// 只在 delimiter 行与表头列数一致时才产出 Table（实测 `| a | b | c |` + `| --- | --- |`
// 根本不出 Table 节点），所以那条是防御性默认值。这里按 Node 侧直接断言，避免
// 「兜底文案无人验」的静默分支。
//
// 短行不再出现在这条分支上（M142 收窄合同）：findTables 先把 cell 数少于表头的行
// 尾部补成零宽空 slot，只有「多列」与「槽位一个都没恢复出来」的行才走到这里。
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
  const excess = table({ reason: "non-rectangular", rows: [row(0, 3, true), row(20, 3), row(40, 4)] });
  expect(degradationNotice(excess, (pos) => (pos === 40 ? 27 : 21))).toBe(
    "表格阅读降级：第 27 行单元格数与表头不符（应为 3 列）——保留原始 Markdown",
  );

  // 兜底：非 oversize 且各行与表头等宽（结构不可识别）也不静默留白
  const unknown = table({ reason: "non-rectangular", rows: [row(0, 3, true), row(20, 3)] });
  expect(degradationNotice(unknown, () => 1)).toBe("表格阅读降级：无法识别表格结构——保留原始 Markdown");
});

test("表格可见行、短行补空列、多列降级、AX、滚动和源码复制", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubTauri(page, { entries: [{ path: "table.md", kind: "file", size: fixture.length, mtime_ms: 0 }], files: { "table.md": fixture } });
  await page.goto("/");
  await page.locator('.ft-row[title="table.md"]').click();
  // fixture 三张矩形表按 grid 渲染（第 5/18/32 行），第 26 行的多列表整块降级
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(3);
  await expect(page.locator(".cm-lp-table")).toHaveCount(3);
  await expect(page.locator(".cm-lp-table-cell", { hasText: "alpha" })).toHaveCount(1);
  // 空 cell 4 个：表一 `| alpha | | centered |` 1 个 + 第 18 行短行补出的 1 个 + 6 列表补出的 2 个
  await expect(page.locator(".cm-lp-table-cell-empty")).toHaveCount(4);
  const emptyCell = await page.locator(".cm-lp-table-cell-empty").first().evaluate((cell) => {
    const rect = cell.getBoundingClientRect();
    return { width: rect.width, height: rect.height, text: cell.textContent };
  });
  expect(emptyCell.width).toBeGreaterThan(0);
  expect(emptyCell.height).toBeGreaterThan(0);
  // 补出的空 cell 与空格空槽同形：无占位符、无缺列标记，就是空格子
  expect(emptyCell.text).toBe("");

  // 逐表几何：每张表内各行 cell 数一致（矩形），行序不重叠，行高与**本行最高的 cell**同高。
  // 行高回归：行不得被隐藏管道符留下的 widgetBuffer 占位撑高——修复前行高约
  // 92px（单元格 33px + 2 条隐式 grid 行），修复后应与单元格同高。
  // 比对本行的 cell 而不是「全表第一个 cell」：表头走标签档字号（11.5px）比数据 cell（13.5px）
  // 矮，跨行比对会把数据行判成「比单元格高」（restyle 后实测到的形态）。
  const tables = await page.locator(".cm-lp-table").evaluateAll((els) => els.map((table) =>
    [...table.querySelectorAll<HTMLElement>(".cm-lp-table-row")].map((row) => {
      const rect = row.getBoundingClientRect();
      const cells = [...row.querySelectorAll<HTMLElement>(".cm-lp-table-cell")];
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        cells: cells.length,
        cellHeight: Math.max(...cells.map((cell) => cell.getBoundingClientRect().height)),
      };
    })));
  expect(tables.map((rows) => rows.length)).toEqual([3, 2, 3]);
  for (const rows of tables) {
    const columns = rows[0].cells;
    for (const row of rows) expect(row.cells).toBe(columns);
    for (let i = 1; i < rows.length; i++) expect(rows[i].top).toBeGreaterThanOrEqual(rows[i - 1].bottom - 1);
  }
  for (const rows of tables) {
    for (const row of rows) {
      expect(row.cellHeight).toBeGreaterThan(0);
      expect(row.height, `行高 ${row.height} vs 本行 cell 高 ${row.cellHeight}`).toBeLessThan(row.cellHeight + 2);
    }
  }

  await expect(page.locator(".cm-lp-table-scroll").first()).toHaveAttribute("role", "region");
  await expect(page.locator(".cm-lp-table").first()).toHaveAttribute("role", "table");
  await expect(page.locator(".cm-lp-table").first()).toHaveAttribute("aria-colcount", "3");
  await expect(page.locator(".cm-lp-table").nth(0).locator("[role=columnheader]")).toHaveCount(3);
  await expect(page.locator(".cm-lp-table").nth(1).locator("[role=columnheader]")).toHaveCount(2);
  await expect(page.locator(".cm-lp-table").nth(2).locator("[role=columnheader]")).toHaveCount(6);

  // 多列表整块降级：源码可见，归因文案带上出错行号（M138）。fixture 第 28 行
  // `| one | two | three |` 有 3 格而表头声明 2 列——行号是**文档行号**，用户照着
  // 就能定位到源文件那一行。
  await expect(page.locator(".cm-content")).toContainText("| one | two | three |");
  await expect(page.locator(".cm-lp-table-degraded")).toHaveCount(1);
  const notice = "表格阅读降级：第 28 行单元格数与表头不符（应为 2 列）——保留原始 Markdown";
  await expect(page.locator(".cm-lp-table-degraded")).toHaveAttribute("aria-label", notice);
  // 上屏的文案与 aria-label 同源（CSS ::after 经 data 属性取用，不在样式表里另写一份）
  const painted = await page.locator(".cm-lp-table-degraded").evaluate((el) =>
    getComputedStyle(el, "::after").content.replace(/^"|"$/g, ""),
  );
  expect(painted).toBe(notice);

  expect(await readDocument(page)).toBe(fixture);
  await page.locator(".cm-lp-table-scroll").first().focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Escape");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fixture);
  expect(await readDocument(page)).toBe(fixture);
});

test("短行尾部补空列：outline.md 同款 6 列表头 + 5 cell 行按矩形渲染", async ({ page }) => {
  // M137 现场（~/Downloads/Everything-copy/outline.md:106-109）四行各缺最后一列，
  // 旧合同整块回退源码；M142 收窄为尾部补空列（GFM §4.10）。这里钉住渲染口径：
  // 空 cell 就是空 cell，列几何与表头对齐。
  await stubTauri(page, { entries: [{ path: "table.md", kind: "file", size: fixture.length, mtime_ms: 0 }], files: { "table.md": fixture } });
  await page.goto("/");
  await page.locator('.ft-row[title="table.md"]').click();
  const short = page.locator(".cm-lp-table").nth(2);
  await expect(short).toHaveCount(1);
  await expect(short).toHaveAttribute("aria-colcount", "6");
  await expect(short).toHaveAttribute("style", /--cm-lp-table-columns:\s*6/);
  const grid = await tableGridGeometry(page, 2);
  expect(grid).toHaveLength(3);
  for (const rowCells of grid) expect(rowCells).toHaveLength(6);
  // 补出的第 6 列是空格子：没有占位符文案，也没有「此处缺列」标记
  expect(grid[1][5].text).toBe("");
  expect(grid[2][5].text).toBe("");
  // 原有最后一格留在第 5 列，位置不因补列而左移或右移
  expect(grid[1][4].text).toContain("z");
  expect(grid[2][4].text).toContain("z");
  // 列几何：补出的第 6 列与表头第 6 列左缘对齐，且位于第 5 列右侧
  for (const rowCells of grid) {
    expect(Math.abs(rowCells[5].left - grid[0][5].left)).toBeLessThan(1);
    expect(rowCells[5].left).toBeGreaterThan(rowCells[4].left + rowCells[4].width - 1);
  }
  // 短行不再整块回退：屏幕上的降级提示只有多列表那一条
  await expect(page.locator(".cm-lp-table-degraded")).toHaveCount(1);
  // 该行按 grid 行渲染，且源码（含管道符）不再作为文本上屏——只有 cell 内容可见
  expect(await short.locator(".cm-lp-table-row").first().evaluate((row) => getComputedStyle(row).display)).toBe("grid");
  expect(await page.locator(".cm-content").textContent()).not.toContain("| H2 |");
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

async function tableGridGeometry(page: import("@playwright/test").Page, tableIndex?: number): Promise<CellRect[][]> {
  const rows = tableIndex === undefined
    ? page.locator(".cm-lp-table-row")
    : page.locator(".cm-lp-table").nth(tableIndex).locator(".cm-lp-table-row");
  return rows.evaluateAll((list) => list.map((row) =>
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

test("编辑器主内容宽度为定值栏宽（760px）且居中，宽表仍可横向滚动", async ({ page }) => {
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
  // 主内容列 = 定值栏宽（restyle 前的 80% 口径已退役：`--layout-doc-measure` = 760px，
  // 两侧 `minmax(24px, 1fr)` 等分剩余空间 ⇒ 居中；见 src/editor.ts 的 `.cm-scroller` 注释）
  expect(sizes.contentWidth).toBe(760);
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

test("窄窗口下编辑器主内容被两侧 24px 轨道钳住（定值栏宽的上限不生效）", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  const source = "# 窄窗口\n\n段落。\n";
  await stubTauri(page, { entries: [{ path: "narrow.md", kind: "file", size: source.length, mtime_ms: 0 }], files: { "narrow.md": source } });
  await page.goto("/");
  await page.locator('.ft-row[title="narrow.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("段落");
  const sizes = await page.evaluate(() => {
    const pane = document.querySelector(".pane-editor")!.getBoundingClientRect();
    const content = document.querySelector(".cm-content")!.getBoundingClientRect();
    const scroller = getComputedStyle(document.querySelector(".cm-scroller")!);
    return {
      paneWidth: pane.width,
      contentWidth: content.width,
      tracks: scroller.gridTemplateColumns.split(" ").map((v) => Number.parseFloat(v)),
    };
  });
  expect(sizes.paneWidth).toBeGreaterThan(0);
  expect(sizes.contentWidth).toBeLessThan(760);
  // 中列吃满「窗格宽 − 两侧 24px 最小轨道」；窄窗口行为是**已声明的已知边界**
  // （tasks §11.2「窄窗口行为未定」），这里钉住的是现状而不是某个设计值。
  expect(Math.abs(sizes.contentWidth - (sizes.paneWidth - 48))).toBeLessThanOrEqual(1);
  expect(sizes.tracks).toEqual([24, sizes.contentWidth, 24]);
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
