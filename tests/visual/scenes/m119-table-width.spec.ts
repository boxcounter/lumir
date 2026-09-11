import { expect, test } from "@playwright/test";
import { computeColumnWidths } from "../../../src/preview/table";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M119 表格宽度统一合同（docs/specs/table-reading.md §3）双向回归：
// 表框 = 内容自然宽；可见宽 = min(自然宽, 栏宽)；超宽横滚不裁切。
// 历史补丁史：M98-M110 各修一处（1fr 拉满 → 贴合内容 → 352px 封顶），
// 352px 封顶制造「cell 折行但整表窄于栏宽」的欠宽缺陷，WKWebView 下宽表
// 横滚不可达表现为裁切。本场景钉死两个方向的合同行为。
// 结构遵循 docs/process/rendering-defect-contract-first.md：纯函数 Node 单测 +
// 手写案例（用户报告的两个形状）+ 生成器矩阵属性测试三层。

async function openDoc(page: import("@playwright/test").Page, name: string, doc: string) {
  await stubTauri(page, { entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }], files: { [name]: doc } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
}

function tableGeometry(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const rect = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const scroll = document.querySelector(".cm-lp-table-scroll")!;
    return {
      contentWidth: rect(".cm-content").width,
      tableWidth: rect(".cm-lp-table").width,
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      overflowX: getComputedStyle(scroll).overflowX,
      rowHeight: document.querySelector(".cm-lp-table-row:last-child")!.getBoundingClientRect().height,
      tracks: getComputedStyle(document.querySelector(".cm-lp-table")!).gridTemplateColumns.split(" ").map((v) => parseFloat(v)),
    };
  });
}

test("欠宽方向：栏宽有富余时 cell 不折行，表格贴合内容自然宽", async ({ page }) => {
  // 回归（用户桌面报告）：34 字 CJK cell 自然宽约 500px < 栏宽 764px，旧 352px
  // 封顶把它钳成两行折行（行高 55px）且整表仅 417px——「折行却收缩」。
  const source = `| 名称 | 说明 |\n| --- | --- |\n| alpha | ${"说".repeat(34)} |\n`;
  await openDoc(page, "narrow.md", source);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const geo = await tableGeometry(page);
  expect(geo.tracks).toHaveLength(2);
  // 不折行：数据行保持单行高度（折行时约 55px，单行约 33px）
  expect(geo.rowHeight).toBeLessThan(45);
  // 贴合内容：自然宽（旧封顶口径约 417px）之上、栏宽之下
  expect(geo.tableWidth).toBeGreaterThan(460);
  expect(geo.tableWidth).toBeLessThan(geo.contentWidth);
  // 未超出栏宽：无需横向滚动
  expect(geo.scrollWidth).toBeLessThanOrEqual(geo.clientWidth + 1);
  expect(await readDocument(page)).toBe(source);

  // 短内容窄表不拉满栏宽（M103 口径保持）：贴合内容、明显窄于栏宽
  const short = `| a | b |\n| --- | --- |\n| 1 | 2 |\n`;
  await openDoc(page, "short.md", short);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const shortGeo = await tableGeometry(page);
  expect(shortGeo.tableWidth).toBeLessThan(shortGeo.contentWidth * 0.6);
  expect(await readDocument(page)).toBe(short);
});

test("超宽方向：自然宽超栏宽的表格容器横滚，不裁切、不收缩、不撑宽正文", async ({ page }) => {
  // 6 列 × 40 字符：自然宽约 2000px > 栏宽 764px（用户桌面报告的 1549 vs 766 同型）。
  const cell = "abcdefghijklmnopqrstuvwxyz0123456789ABCD";
  const source = `| c1 | c2 | c3 | c4 | c5 | c6 |\n| --- | --- | --- | --- | --- | --- |\n| ${cell} | ${cell} | ${cell} | ${cell} | ${cell} | ${cell} |\n`;
  await openDoc(page, "wide.md", source);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const geo = await tableGeometry(page);
  // 不收缩：表框保持自然宽（远超栏宽）；不裁切：滚动容器可见宽不超出正文列
  expect(geo.tableWidth).toBeGreaterThan(geo.contentWidth * 2);
  expect(geo.clientWidth).toBeLessThanOrEqual(geo.contentWidth + 1);
  // 横滚可达：scrollWidth 覆盖完整自然宽且容器可滚
  expect(geo.scrollWidth).toBeGreaterThanOrEqual(geo.tableWidth);
  expect(["auto", "scroll"]).toContain(geo.overflowX);
  // cell 不折行（折行是收缩手段，超宽表走横滚而非折行）
  expect(geo.rowHeight).toBeLessThan(45);

  // 键盘滚到末列：最后一列进入可见区域（不裁切的行为证据）
  await page.locator(".cm-lp-table-scroll").focus();
  await page.keyboard.press("End");
  const lastCellVisible = await page.evaluate(() => {
    const scroll = document.querySelector(".cm-lp-table-scroll")!;
    const cells = document.querySelectorAll(".cm-lp-table-row:last-child .cm-lp-table-cell");
    const last = cells[cells.length - 1].getBoundingClientRect();
    const box = scroll.getBoundingClientRect();
    return { lastRight: last.right, boxRight: box.right, scrollLeft: scroll.scrollLeft };
  });
  expect(lastCellVisible.scrollLeft).toBeGreaterThan(0);
  expect(lastCellVisible.lastRight).toBeLessThanOrEqual(lastCellVisible.boxRight + 1);

  // 正文列不被撑宽：.cm-content 仍为窗格的 80%
  const widths = await page.evaluate(() => {
    const pane = document.querySelector(".pane-editor")!.getBoundingClientRect();
    const content = document.querySelector(".cm-content")!.getBoundingClientRect();
    return { paneWidth: pane.width, contentWidth: content.width };
  });
  expect(Math.abs(widths.contentWidth - widths.paneWidth * 0.8)).toBeLessThan(1);
  expect(await readDocument(page)).toBe(source);
});

// ---------------------------------------------------------------------------
// 纯函数不变量（Node 侧）：computeColumnWidths 是合同的可执行表述
// ---------------------------------------------------------------------------

test("宽度纯函数 computeColumnWidths：fit / wrap / scroll 三态不变量", () => {
  // fit：Σmax ≤ 栏宽 → 各列取 max，总宽 = 自然宽（无折行 ⇒ 总宽 ≤ 自然宽）
  expect(computeColumnWidths([{ min: 50, max: 100 }, { min: 60, max: 200 }], 700)).toEqual([100, 200]);
  expect(computeColumnWidths([{ min: 10, max: 764 }], 764)).toEqual([764]);

  // wrap：Σmax > 栏宽 ≥ Σmin → 总宽恰好 = 栏宽（折行 ⇒ 总宽 = 栏宽），每列 ∈ [min, max]
  const wrapped = computeColumnWidths([{ min: 80, max: 600 }, { min: 80, max: 120 }, { min: 80, max: 300 }], 500);
  expect(wrapped.reduce((a, b) => a + b, 0)).toBeCloseTo(500, 6);
  wrapped.forEach((w, i) => {
    expect(w).toBeGreaterThanOrEqual(80);
    expect(w).toBeLessThanOrEqual([600, 120, 300][i]);
  });
  // water-filling：先到 max 的列退出分摊，富余归未封顶列
  expect(computeColumnWidths([{ min: 10, max: 12 }, { min: 10, max: 1000 }], 500)).toEqual([12, 488]);
  // 等列均摊
  const even = computeColumnWidths(Array.from({ length: 4 }, () => ({ min: 50, max: 400 })), 800);
  expect(even).toEqual([200, 200, 200, 200]);

  // scroll：Σmin > 栏宽 → 各列取 min，总宽 = Σmin > 栏宽（超宽 ⇒ 横滚承载）
  const mins = Array.from({ length: 12 }, () => ({ min: 69, max: 800 }));
  const scrolled = computeColumnWidths(mins, 765);
  expect(scrolled.reduce((a, b) => a + b, 0)).toBe(828);
  expect(scrolled.every((w) => w === 69)).toBeTruthy();
});

// ---------------------------------------------------------------------------
// 属性测试：fixture 生成器扫 列数 × 内容长度 分布，断言渲染不变量
// ---------------------------------------------------------------------------

function generatedTable(columns: number, cellChars: number, cjk: boolean): string {
  const fill = (cjk ? "说" : "x").repeat(cellChars);
  const header = Array.from({ length: columns }, (_, i) => `h${i}`).join(" | ");
  const delimiter = Array.from({ length: columns }, () => "---").join(" | ");
  const row = Array.from({ length: columns }, () => fill).join(" | ");
  return `| ${header} |\n| ${delimiter} |\n| ${row} |`;
}

// 分布：列数 {1,2,3,6,12} × 内容长度 {2, 34, 120}（CJK）+ {200}（拉丁）——
// 覆盖贴合（短内容）、欠宽边界（中长 CJK）、超宽（长内容/多列）三区。
const MATRIX: { columns: number; chars: number; cjk: boolean }[] = [];
for (const columns of [1, 2, 3, 6, 12]) {
  for (const chars of [2, 34, 120]) MATRIX.push({ columns, chars, cjk: true });
  if (columns === 2 || columns === 6) MATRIX.push({ columns, chars: 200, cjk: false });
}

test("属性测试：列数×内容长度分布上宽度不变量恒成立", async ({ page }) => {
  const doc = MATRIX.map((m) => generatedTable(m.columns, m.chars, m.cjk)).join("\n\n") + "\n";
  await page.setViewportSize({ width: 1200, height: 4000 }); // 全表同屏，免滚动增量
  await openDoc(page, "matrix.md", doc);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(MATRIX.length);

  const geometry = await page.evaluate(() => {
    return [...document.querySelectorAll<HTMLElement>(".cm-lp-table-scroll")].map((scroll) => {
      const table = scroll.querySelector(".cm-lp-table")!;
      const rows = [...table.querySelectorAll(".cm-lp-table-row")].map((r) => r.getBoundingClientRect().height);
      // 零裁切检验：滚到最右后末列右缘进入容器可见区
      scroll.scrollLeft = scroll.scrollWidth;
      const cells = table.querySelectorAll(".cm-lp-table-row:last-child .cm-lp-table-cell");
      const lastRight = cells[cells.length - 1].getBoundingClientRect().right;
      const boxRight = scroll.getBoundingClientRect().right;
      const scrollLeft = scroll.scrollLeft;
      scroll.scrollLeft = 0;
      return {
        clientWidth: scroll.clientWidth,
        scrollWidth: scroll.scrollWidth,
        tableWidth: table.getBoundingClientRect().width,
        maxRowHeight: Math.max(...rows),
        lastRight, boxRight, scrollLeft,
      };
    });
  });

  const contentWidth = await page.evaluate(() => document.querySelector(".cm-content")!.getBoundingClientRect().width);
  let fitCount = 0;
  let scrollCount = 0;
  geometry.forEach((g, i) => {
    const { columns, chars } = MATRIX[i];
    const label = `表 ${i}（${columns} 列 × ${chars} 字符）`;
    // 不变量 1：cell 无固定像素上限 ⇒ 任何表格不在栏宽以下折行（行高恒为单行量级）
    expect(g.maxRowHeight, `${label} 不应折行`).toBeLessThan(45);
    // 不变量 2：滚动区恰好容纳表框——自然宽即滚动宽，无隐藏裁切
    expect(g.scrollWidth, `${label} scrollWidth ≈ max(clientWidth, tableWidth)`)
      .toBeGreaterThanOrEqual(Math.max(g.clientWidth, g.tableWidth) - 2);
    expect(g.scrollWidth, `${label} scrollWidth 不超过 tableWidth 容差`)
      .toBeLessThanOrEqual(Math.max(g.clientWidth, g.tableWidth) + 2);
    if (g.tableWidth > g.clientWidth + 1) {
      // 不变量 3：超宽 ⇒ 横滚且零裁切（滚到最右后末列完整可见）
      scrollCount++;
      expect(g.scrollLeft, `${label} 可横向滚动`).toBeGreaterThan(0);
      expect(g.lastRight, `${label} 末列可达`).toBeLessThanOrEqual(g.boxRight + 1);
    } else {
      // 不变量 4：自然宽 ≤ 栏宽 ⇒ 无需滚动，正文列不被撑宽
      fitCount++;
      expect(g.tableWidth, `${label} 贴合内容不越栏`).toBeLessThanOrEqual(contentWidth + 1);
    }
  });
  // 矩阵有效性：两区都被真实覆盖（否则不变量空转）
  expect(fitCount).toBeGreaterThan(0);
  expect(scrollCount).toBeGreaterThan(0);
  expect(await readDocument(page)).toBe(doc);
});
