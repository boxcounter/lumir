import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M110 交互缺陷回归（真实桌面用户截图实证）：
// 2) 光标在 latex 公式附近 Ctrl-N 落到错误位置——moveVertically 跨块级 replace
//    widget（$$ 公式/frontmatter/mermaid 围栏）时一步扔到块另一侧；修复为钳制到
//    行进方向近端边界。
// 3) Ctrl-F（forward char）无法进入 latex 公式区域——原生 contenteditable caret
//    进不了 CM replace 原子范围，在边界卡住后回弹跳过；修复为 CM 派发水平移动，
//    公式 span 作为唯一可进入原子范围逐字符放行（进入即显露源码，可编辑）。
// 4) 光标放入 callout 不显示源码、无法编辑——修复为光标/选区严格落入的行显露
//    > 与 [!type] 原文（与 math/mermaid 的选区显露同口径），其余行保持渲染态。

function cmSelection(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { anchor: main.anchor, head: main.head, empty: main.empty, docLength: view.state.doc.length };
  });
}

function setCursor(page: import("@playwright/test").Page, pos: number) {
  return page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

const MATH_DOC = `公式前文字 $x+1$ 公式后文字。

$$
y = a + b
$$

末尾段落。
`;
// 位置锚点：行内公式 span = [6, 11)；块级公式 span = [20, 35)；末尾段落行首 = 37。

test("Ctrl-F 逐字符进入行内公式并显露源码，Ctrl-B 从右侧对称进入", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "m.md", kind: "file", size: MATH_DOC.length, mtime_ms: 0 }], files: { "m.md": MATH_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="m.md"]').click();
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);

  // 从行首前进：到边界 6 时公式仍渲染；再走一步进入 span，源码显露
  await setCursor(page, 0);
  for (let i = 0; i < 6; i++) await page.keyboard.press("Control+f");
  expect((await cmSelection(page)).head).toBe(6);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);
  await page.keyboard.press("Control+f");
  expect((await cmSelection(page)).head).toBe(7);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);
  await expect(page.locator(".cm-line").first()).toHaveText("公式前文字 $x+1$ 公式后文字。");
  // 继续逐字符穿越源码（修复前：在边界卡住两次后整体跳过到 11，永不进入）
  await page.keyboard.press("Control+f");
  expect((await cmSelection(page)).head).toBe(8);
  // 走出右边界后恢复渲染
  for (let i = 0; i < 3; i++) await page.keyboard.press("Control+f");
  expect((await cmSelection(page)).head).toBe(11);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);

  // 对称方向：从公式右边界 Ctrl-B 进入
  await setCursor(page, 11);
  await page.keyboard.press("Control+b");
  expect((await cmSelection(page)).head).toBe(10);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);

  expect(await readDocument(page)).toBe(MATH_DOC);
});

test("Ctrl-F 进入块级公式后源码显露可编辑", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "m.md", kind: "file", size: MATH_DOC.length, mtime_ms: 0 }], files: { "m.md": MATH_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="m.md"]').click();
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(1);
  // 光标放到 $$ 行首（span.from = 20），Ctrl-F 进入块内 → 块级装饰显露源码
  await setCursor(page, 20);
  await page.keyboard.press("Control+f");
  expect((await cmSelection(page)).head).toBe(21);
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(0);
  expect(await readDocument(page)).toBe(MATH_DOC);
});

test("Ctrl-N 跨块级公式落在近端边界而非一次跳过", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "m.md", kind: "file", size: MATH_DOC.length, mtime_ms: 0 }], files: { "m.md": MATH_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="m.md"]').click();
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(1);
  await setCursor(page, 0);
  // 修复前：一次 Ctrl-N 从 0 直接落到 37（块另一侧），跨过整个公式
  await page.keyboard.press("Control+n");
  expect((await cmSelection(page)).head).toBe(20); // 钳制到块起始边界
  await page.keyboard.press("Control+n");
  expect((await cmSelection(page)).head).toBe(37); // 再按才越过块
  // 对称方向：从块下方 Ctrl-P 钳制到块结束边界
  await page.keyboard.press("Control+p");
  expect((await cmSelection(page)).head).toBe(35);
  expect(await readDocument(page)).toBe(MATH_DOC);
});

const CALLOUT_DOC = `> [!note] 标题
> 第一行正文。
> 第二行正文。

普通段落。
`;

test("callout 光标所在行显露源码可编辑，其余行保持渲染态", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "c.md", kind: "file", size: CALLOUT_DOC.length, mtime_ms: 0 }], files: { "c.md": CALLOUT_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="c.md"]').click();
  await expect(page.locator(".cm-lp-callout-icon")).toHaveCount(1);
  const lines = page.locator(".cm-lp-callout-line");
  await expect(lines).toHaveCount(3);
  // 渲染态：所有行不显示 >
  for (let i = 0; i < 3; i++) expect(await lines.nth(i).textContent()).not.toContain(">");

  // 光标进入第二行：该行显露 > 源码，其余行保持渲染
  await lines.nth(1).click({ position: { x: 60, y: 8 } });
  expect((await cmSelection(page)).empty).toBeTruthy();
  expect(await lines.nth(1).textContent()).toContain("> 第一行正文。");
  expect(await lines.nth(0).textContent()).not.toContain(">");
  expect(await lines.nth(2).textContent()).not.toContain(">");
  await expect(page.locator(".cm-lp-callout-icon")).toHaveCount(1);

  // 光标进入首行：[!note] 标记源码显露（图标消失），类型可编辑
  await lines.nth(0).click({ position: { x: 40, y: 8 } });
  await expect(page.locator(".cm-lp-callout-icon")).toHaveCount(0);
  expect(await lines.nth(0).textContent()).toContain("> [!note] 标题");

  // 在正文行输入：编辑生效且只动光标行源码
  await lines.nth(1).click({ position: { x: 60, y: 8 } });
  await page.keyboard.type("X");
  expect(await readDocument(page)).toContain("第一行X正文。");

  // 光标移出 callout：恢复渲染态
  await page.locator(".cm-line", { hasText: "普通段落" }).click({ position: { x: 20, y: 8 } });
  await expect(page.locator(".cm-lp-callout-icon")).toHaveCount(1);
  expect(await lines.nth(1).textContent()).not.toContain(">");
});

// 缺陷 1/5/6 回归：真实世界宽表（单元格带对齐填充空格、长内容折行）。
// 5/6 的根因是 cell max-inline-size 用 ch——表头粗体的 ch 更宽（WebKit 实测
// 394.7px vs 正文 362.5px），轨道按表头贡献撑宽后正文 cell 被自身上限钳住，
// 表头/数据行边界错位 32px、列边线错乱；修复为固定 352px（style.css）。
// 缺陷 1（双击表头落到第二行）未能在任一引擎复现，以双击断言看守几何修复后的行为。
const PADDED_TABLE = `| API              | 说明                                                                                                | 备注     |
| ---------------- | --------------------------------------------------------------------------------------------------- | -------- |
| \`get\`            | 获取数据：枚举 \`extension_save\` / \`share_sheet\` / \`web_button\` / \`import\` / \`api\` / \`cli\`（扩展页内保存弹层） | 无       |
| \`post\`           | 提交数据                                                                                              | 需要鉴权 |
`;

test("宽表：表头与数据行各列边界一致，双击表头选中表头词", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "t.md", kind: "file", size: PADDED_TABLE.length, mtime_ms: 0 }], files: { "t.md": PADDED_TABLE } });
  await page.goto("/");
  await page.locator('.ft-row[title="t.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  // 几何不变量（缺陷 5/6）：每列的表头/数据 cell 左右边缘一致
  const grid = await page.locator(".cm-lp-table-row").evaluateAll((rows) =>
    rows.map((row) => [...row.querySelectorAll<HTMLElement>(".cm-lp-table-cell")].map((c) => {
      const b = c.getBoundingClientRect();
      return { left: b.left, right: b.right };
    })));
  expect(grid.length).toBe(3);
  for (let col = 0; col < 3; col++) {
    for (let row = 1; row < 3; row++) {
      expect(Math.abs(grid[row][col].left - grid[0][col].left), `列 ${col} 左边缘错位`).toBeLessThan(1);
      expect(Math.abs(grid[row][col].right - grid[0][col].right), `列 ${col} 右边缘错位`).toBeLessThan(1);
    }
  }
  // 缺陷 1：双击表头 "API" 选中表头词（第 1 行），不是第二行
  await page.locator(".cm-lp-table-row").first().locator(".cm-lp-table-cell", { hasText: "API" }).dblclick({ position: { x: 16, y: 16 } });
  const sel = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { text: view.state.sliceDoc(main.from, main.to), line: view.state.doc.lineAt(main.head).number };
  });
  expect(sel.text).toBe("API");
  expect(sel.line).toBe(1);
  expect(await readDocument(page)).toBe(PADDED_TABLE);
});

const LONG_A = Array.from({ length: 200 }, (_, i) => `文件 A 第 ${i + 1} 行内容。`).join("\n\n");
const DOC_B = `---
title: 测试文档
---

# 标题 B

第一段正文内容。
`;

test("打开文件后选区与滚动复位，点击落点即光标", async ({ page }) => {
  await stubTauri(page, {
    entries: [
      { path: "a.md", kind: "file", size: LONG_A.length, mtime_ms: 0 },
      { path: "b.md", kind: "file", size: DOC_B.length, mtime_ms: 0 },
    ],
    files: { "a.md": LONG_A, "b.md": DOC_B },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a.md"]').click();
  await page.locator(".cm-line", { hasText: "文件 A 第 1 行" }).waitFor();
  // 在旧文档制造非顶部滚动与选区
  await page.locator(".cm-line", { hasText: "文件 A 第 1 行" }).click({ position: { x: 40, y: 8 } });
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.up("Shift");
  for (let i = 0; i < 10; i++) await page.keyboard.press("PageDown");
  // 打开新文件：选区必须干净归 0、滚动回顶部（缺陷 7：不得有残留选区/错误落点）
  await page.locator('.ft-row[title="b.md"]').click();
  await page.locator(".cm-lp-frontmatter").waitFor();
  const state = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return {
      anchor: main.anchor, head: main.head, empty: main.empty,
      scrollTop: (document.querySelector(".cm-scroller") as HTMLElement).scrollTop,
      native: window.getSelection()?.toString() ?? "",
    };
  });
  expect(state.empty).toBeTruthy();
  expect(state.head).toBe(0);
  expect(state.scrollTop).toBe(0);
  expect(state.native).toBe("");
  // 点击标题行：光标落在点击处，为空选区
  await page.locator(".cm-line", { hasText: "标题 B" }).click({ position: { x: 30, y: 10 } });
  const after = await cmSelection(page);
  expect(after.empty).toBeTruthy();
  expect(after.head).toBeGreaterThan(0);
  expect(await readDocument(page)).toBe(DOC_B);
});
