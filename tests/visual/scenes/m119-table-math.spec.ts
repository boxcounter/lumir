import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M119：表格 cell 内同行 $$...$$ 渲染为公式（真实桌面缺陷：M113 只放开了单美元
// 行内数学，cell 内 $$y$$ 裸露原文）。口径：完全落在单个 slot 内的同行 $$ 按
// 行内公式渲染（inline 显示样式——display 的 .katex-display 是 block+居中+margin，
// 与 cell 文本流/grid 行冲突）；跨 slot 边界保护（M113 r1 review P2-1）对 $$
// 同样生效；表外同行/跨行 $$ 仍走 mathBlockSet 块级路径。

async function openDoc(page: import("@playwright/test").Page, name: string, doc: string) {
  await stubTauri(page, { entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }], files: { [name]: doc } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
}

const CELL_MATH = `| 公式 | 值 |
| --- | --- |
| $$y$$ | z |
`;

test("cell 内同行 $$ 渲染为行内公式，点击进编辑，离开恢复", async ({ page }) => {
  await openDoc(page, "t.md", CELL_MATH);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);

  // 渲染态：cell 内出现行内公式 widget，源码 $$y$$ 不再裸露
  const widget = page.locator(".cm-lp-table-cell .cm-lp-math-inline");
  await expect(widget).toHaveCount(1);
  await expect(page.locator(".cm-lp-table-cell .katex")).toHaveCount(1);
  await expect(page.locator(".cm-lp-table-cell").nth(2)).not.toContainText("$$");
  // inline 显示样式：不产生 display 模式的 .katex-display / 块级 widget
  await expect(page.locator(".cm-lp-table .katex-display")).toHaveCount(0);
  await expect(page.locator(".cm-lp-table .cm-lp-math-block")).toHaveCount(0);

  // 点击渲染态公式进入编辑态：显露完整源码（含 $$ 定界符），文档不变
  await widget.click();
  await expect(page.locator(".cm-lp-table-cell .cm-lp-math-inline")).toHaveCount(0);
  await expect(page.locator(".cm-lp-table-cell").nth(2)).toContainText("$$y$$");
  expect(await readDocument(page)).toBe(CELL_MATH);

  // 光标移出 cell：恢复渲染
  await page.locator(".cm-lp-table-cell", { hasText: "z" }).click();
  await expect(page.locator(".cm-lp-table-cell .cm-lp-math-inline")).toHaveCount(1);
  expect(await readDocument(page)).toBe(CELL_MATH);
});

test("跨 slot 词法配对的 $$ 不吞并 cell（M113 r1 保护对双美元同样生效）", async ({ page }) => {
  // 表头行 `| $$a | b$$ |`：$$a ... b$$ 词法配成一条 display span，横跨被隐藏的
  // pipe——若渲染会吞并两个 cell（幻影公式）。跳过并保持原文；同一表格内完全
  // 落在单个 slot 的公式（数据行 $x+1$ 与 $$z$$）不受影响。
  const CROSS_PIPE = `| $$a | b$$ |
| --- | --- |
| $x+1$ | $$z$$ |
`;
  await openDoc(page, "t.md", CROSS_PIPE);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);

  const header = page.locator(".cm-lp-table-row").first();
  await expect(header.locator(".cm-lp-table-cell")).toHaveCount(2);
  await expect(header.locator(".cm-lp-table-cell").nth(0)).toContainText("$$a");
  await expect(header.locator(".cm-lp-table-cell").nth(1)).toContainText("b$$");
  await expect(header.locator(".cm-lp-math-inline")).toHaveCount(0);
  await expect(header.locator(".katex")).toHaveCount(0);

  // 窄口径：数据行单 slot 内的 $ 与 $$ 公式照常渲染（各 1 个）
  const dataRow = page.locator(".cm-lp-table-row").nth(1);
  await expect(dataRow.locator(".cm-lp-math-inline")).toHaveCount(2);
  await expect(dataRow.locator(".katex")).toHaveCount(2);
  expect(await readDocument(page)).toBe(CROSS_PIPE);
});

test("表外同行/跨行 $$ 仍走块级路径，不受 cell 内渲染影响", async ({ page }) => {
  const MIXED = `# 混合

$$E=mc^2$$

| 公式 | 值 |
| --- | --- |
| $$y$$ | z |
`;
  await openDoc(page, "m.md", MIXED);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  // 表外独行 $$ → 块级 widget（display 模式）；cell 内 $$ → 行内 widget
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(1);
  await expect(page.locator(".cm-lp-math-block .katex-display")).toHaveCount(1);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);
  await expect(page.locator(".cm-lp-math-inline .katex-display")).toHaveCount(0);
  expect(await readDocument(page)).toBe(MIXED);
});
