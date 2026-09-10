import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M113 交互缺陷回归（pnpm dev:app 真实桌面截图实证，四项相互独立）：
// 1) Ctrl+N/P 跨表格方向不对称——修复前 Ctrl-N 跳过整张表而 Ctrl-P 逐行穿过；
//    用户裁决两方向对称、均一次按键跳过整张表（grid 渲染的表是垂直移动原子块，
//    降级/非矩形表仍逐行穿过）。
// 2) 表头 cell 双击选中大片空白——cell slot 的对齐 padding 空白被 CM 按类选词
//    当作「词」；修复为落点在 padding 上时改选裁剪后最近的实际词。
// 3) 表格 cell 内 $...$ 行内数学不渲染——M106 的表格上下文排除把行内 math 也
//    排除了；修复为 cell 内行内公式正常渲染，点击进编辑 / Ctrl-B 交互保持兼容
//   （块级 $$ 在 cell 内仍保留原文：block replace 会拆散 grid 行）。
// 4) 公式之后 Ctrl+B 需 3 次——跨行落点钉在 span 右边界（不可见的边界位）空走
//    一次；修复为跨行到达边界时直接钳入 span（同一行内的边界停靠保留）。

function cmSelection(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return {
      anchor: main.anchor, head: main.head, empty: main.empty,
      line: view.state.doc.lineAt(main.head).number,
      text: view.state.sliceDoc(main.from, main.to),
      docLength: view.state.doc.length,
    };
  });
}

function setCursor(page: import("@playwright/test").Page, pos: number) {
  return page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

async function openDoc(page: import("@playwright/test").Page, name: string, doc: string) {
  await stubTauri(page, { entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }], files: { [name]: doc } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
}

// ---------------------------------------------------------------------------
// 缺陷 1：Ctrl+N/P 跨表格方向对称，均一次跳过整张表
// ---------------------------------------------------------------------------

const TABLE_DOC = `上文段落。

| 名称 | 状态 |
|------|------|
| 表格 | 正常 |

下文段落。
`;
// 行锚点：1=上文段落。 3-5=表格 7=下文段落。

test("Ctrl+N/P 跨表格：两方向对称，一次按键跳过整张表", async ({ page }) => {
  await openDoc(page, "t.md", TABLE_DOC);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);

  // 前进方向（修复前即如此，保持）：表上方行 → 表下方行
  await setCursor(page, 2);
  await page.keyboard.press("Control+n");
  expect((await cmSelection(page)).line).toBe(7);

  // 后退方向（修复前逐行穿过：表下方 → 数据行 → 表头行 → 上文）：
  // 一次 Ctrl-P 直接落在表上方行，与前进方向对称
  await page.keyboard.press("Control+p");
  expect((await cmSelection(page)).line).toBe(1);

  // 高表同样一次跳过（落点在表内时弹出到表外，而非停在中间行）
  const rows = Array.from({ length: 30 }, (_, i) => `| r${i} | v${i} |`).join("\n");
  const TALL = `表上一行。\n\n| h1 | h2 |\n| --- | --- |\n${rows}\n\n表下一行。\n`;
  await openDoc(page, "tall.md", TALL);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const lines = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    for (let n = view.state.doc.lines; n >= 1; n--) {
      if (view.state.doc.line(n).text === "表下一行。") return { below: n };
    }
    return { below: -1 };
  });
  expect(lines.below).toBeGreaterThan(30); // 30 行数据行之后
  await setCursor(page, 2);
  await page.keyboard.press("Control+n");
  expect((await cmSelection(page)).line).toBe(lines.below);
  await page.keyboard.press("Control+p");
  expect((await cmSelection(page)).line).toBe(1);

  // 光标在表格 cell 内：一次按键退出到表外（不逐行走完剩余行）
  await page.locator(".cm-lp-table-cell", { hasText: "r10" }).first().click();
  expect((await cmSelection(page)).empty).toBeTruthy();
  await page.keyboard.press("Control+p");
  expect((await cmSelection(page)).line).toBe(1);
  expect(await readDocument(page)).toBe(TALL);
});

// ---------------------------------------------------------------------------
// 缺陷 2：双击表头 cell 空白处不选中 padding 空白
// ---------------------------------------------------------------------------

const PADDED_TABLE = `| API              | 说明     |
| ---------------- | -------- |
| \`get\`            | 获取数据 |
`;

test("双击表头 cell 填充空白选中实际词，双击词本身保持默认", async ({ page }) => {
  await openDoc(page, "t.md", PADDED_TABLE);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
  const cell = page.locator(".cm-lp-table-cell", { hasText: "API" }).first();
  const box = await cell.boundingBox();

  // 双击 cell 右半部的 padding 空白：修复前选中 14 个空格，修复后选中实际词
  await page.mouse.click(box!.x + box!.width * 0.75, box!.y + box!.height / 2, { clickCount: 2 });
  const padded = await cmSelection(page);
  expect(padded.text).toBe("API");
  expect(padded.line).toBe(1);

  // 双击词本身：默认行为不变，仍选中该词（取 "API" 字形上的点位）
  const point = await page.evaluate(() => {
    const c = [...document.querySelectorAll(".cm-lp-table-cell")].find((el) => el.textContent?.trim() === "API")!;
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    while ((textNode = walker.nextNode())) if (textNode.textContent?.includes("API")) break;
    const range = document.createRange();
    const start = textNode!.textContent!.indexOf("API");
    range.setStart(textNode!, start + 1);
    range.setEnd(textNode!, start + 2);
    const r = range.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(point.x, point.y, { clickCount: 2 });
  expect((await cmSelection(page)).text).toBe("API");

  // 数据 cell 同样适用：双击尾随 padding 空白选中 cell 内实际词
  //（点位取在 cell 文本节点最后一个空白字符上，避免点击宽度比例的随机性）
  const dpoint = await page.evaluate(() => {
    const c = [...document.querySelectorAll(".cm-lp-table-cell")].find((el) => el.textContent?.includes("获取数据"))!;
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    while ((textNode = walker.nextNode())) if (textNode.textContent?.includes("获取数据")) break;
    const text = textNode!.textContent!;
    const range = document.createRange();
    range.setStart(textNode!, text.length - 1); // 尾随空格
    range.setEnd(textNode!, text.length);
    const r = range.getBoundingClientRect();
    return { x: r.x + Math.max(r.width - 1, 0), y: r.y + r.height / 2 };
  });
  await page.mouse.click(dpoint.x, dpoint.y, { clickCount: 2 });
  const data = await cmSelection(page);
  expect(data.text).toBe("获取数据");
  expect(await readDocument(page)).toBe(PADDED_TABLE);
});

// ---------------------------------------------------------------------------
// 缺陷 3：表格 cell 内行内数学渲染，交互兼容
// ---------------------------------------------------------------------------

const MATH_TABLE = `| 公式 | 值 |
|------|------|
| $x+1$ | 2 |
`;
// 位置锚点：行 3 起始于 27，行内公式 span = [29, 34)。

test("表格 cell 内 $...$ 渲染为公式，点击进编辑、Ctrl+B 兼容", async ({ page }) => {
  await openDoc(page, "t.md", MATH_TABLE);
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);

  // 修复前：cell 内 $...$ 保持裸露原文（0 个 math widget）
  const widget = page.locator(".cm-lp-table .cm-lp-math-inline");
  await expect(widget).toHaveCount(1);
  await expect(page.locator(".cm-lp-table .katex")).toHaveCount(1);

  // 与 M111 点击进编辑兼容：点击渲染态公式显露源码，可编辑
  await widget.click();
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);
  const sel = await cmSelection(page);
  expect(sel.head).toBeGreaterThan(29);
  expect(sel.head).toBeLessThan(34);
  await page.keyboard.type("3");
  expect(await readDocument(page)).toMatch(/\$[^$]*3[^$]*\$/);

  // 与 M111 Ctrl+B 兼容：光标移出恢复渲染后，从公式右侧一次进入
  await openDoc(page, "t.md", MATH_TABLE);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);
  await setCursor(page, 34);
  await page.keyboard.press("Control+b");
  expect((await cmSelection(page)).head).toBe(33);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);
  expect(await readDocument(page)).toBe(MATH_TABLE);
});

// ---------------------------------------------------------------------------
// 缺陷 4：公式之后 Ctrl+B 不再边界空走（块级 2 次、行内 1 次进入）
// ---------------------------------------------------------------------------

const MATH_DOC = `公式前文字 $x+1$ 公式后文字。

$$
y = a + b
$$

末尾段落。
`;
// 位置锚点：行内公式 span = [6, 11)；块级公式 span = [20, 35)；空行 36；末尾段落行首 = 37。

test("公式之后 Ctrl+B：跨行到达 span 右边界直接钳入，不再空走", async ({ page }) => {
  await openDoc(page, "m.md", MATH_DOC);
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(1);

  // 块级公式下方段落行首：修复前 37 → 36 → 35（边界空走）→ 34 共 3 次；
  // 修复后 37 → 36（空行）→ 34（进入）共 2 次
  await setCursor(page, 37);
  await page.keyboard.press("Control+b");
  expect((await cmSelection(page)).head).toBe(36);
  await page.keyboard.press("Control+b");
  expect((await cmSelection(page)).head).toBe(34);
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(0);

  // 行尾行内公式：下一行行首 Ctrl+B 修复前停在不可见边界位（第 1 次空走），
  // 修复后 1 次直接进入
  const INLINE_DOC = `前 $x+1$\n后一行。\n`;
  await openDoc(page, "i.md", INLINE_DOC);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);
  await setCursor(page, 8); // 「后一行」行首；公式 span = [2, 7)
  await page.keyboard.press("Control+b");
  expect((await cmSelection(page)).head).toBe(6);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);
  expect(await readDocument(page)).toBe(INLINE_DOC);
});
