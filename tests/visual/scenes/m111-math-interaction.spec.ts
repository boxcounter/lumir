import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M111 交互缺陷回归（真实桌面用户实证）：
// 1) 点击渲染后的数学公式不进入源码编辑——replace widget 整体隐藏源码，CM 对
//    widget 内事件默认 ignoreEvent 不放置光标；修复为 mousedown 先把光标送入
//    span 触发显露（选区重叠口径），源码上屏后按点击点位 posAtCoords 精确定位，
//    与 callout/表格的点击落点同口径。
// 2) Ctrl+B 需要按隐藏源码长度那么多次才进入公式——moveByChar 把隐藏 span 当
//    原子整体跳过（或在隐藏字符上逐位空走）；修复为移动越过 span 边界时钳制为
//    跨入 span 一个字符，一步进入编辑态。

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

test("点击行内公式进入源码编辑，光标落在点击处附近且可编辑", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "m.md", kind: "file", size: MATH_DOC.length, mtime_ms: 0 }], files: { "m.md": MATH_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="m.md"]').click();
  const widget = page.locator(".cm-lp-math-inline");
  await expect(widget).toHaveCount(1);

  // 物理点击（locator.click 的 hit-test 对本场景误报 cm-line 拦截；elementFromPoint
  // 实测落在 KaTeX 子节点上，见调试记录）
  const box = await widget.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  // 修复前：点击无落点，公式保持渲染态、源码不可编辑
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);
  const sel = await cmSelection(page);
  expect(sel.empty).toBeTruthy();
  expect(sel.head).toBeGreaterThan(6);
  expect(sel.head).toBeLessThan(11);
  // 编辑生效：输入字符落入公式源码
  await page.keyboard.type("2");
  expect(await readDocument(page)).toContain("$");
  const edited = await readDocument(page);
  expect(edited).not.toBe(MATH_DOC);
  expect(edited).toMatch(/\$[^$]*2[^$]*\$/);

  // 光标移出后恢复渲染
  await setCursor(page, 0);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);
});

test("点击块级公式进入源码编辑", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "m.md", kind: "file", size: MATH_DOC.length, mtime_ms: 0 }], files: { "m.md": MATH_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="m.md"]').click();
  const widget = page.locator(".cm-lp-math-block");
  await expect(widget).toHaveCount(1);

  await widget.click();
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(0);
  const sel = await cmSelection(page);
  expect(sel.empty).toBeTruthy();
  expect(sel.head).toBeGreaterThan(20);
  expect(sel.head).toBeLessThan(35);
  // 源码行可见且可编辑
  await expect(page.locator(".cm-content")).toContainText("y = a + b");
  await page.keyboard.type("z");
  expect(await readDocument(page)).not.toBe(MATH_DOC);
});

test("Ctrl+B 从公式右侧一次进入（不在隐藏源码上逐位空走）", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "m.md", kind: "file", size: MATH_DOC.length, mtime_ms: 0 }], files: { "m.md": MATH_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="m.md"]').click();
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);

  // 光标紧贴行内公式右边界：1 次 Ctrl+B 必须进入并显露源码（修复前实测需按满
  // 隐藏源码长度那么多次）
  await setCursor(page, 11);
  await page.keyboard.press("Control+b");
  expect((await cmSelection(page)).head).toBe(10);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);

  // 块级公式对称：光标在右边界（35），1 次 Ctrl+B 进入
  await setCursor(page, 35);
  await page.keyboard.press("Control+b");
  expect((await cmSelection(page)).head).toBe(34);
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(0);

  expect(await readDocument(page)).toBe(MATH_DOC);
});

test("Ctrl+F/B 跨入即停：从边界一步进入，从内部逐字符穿出后恢复渲染", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "m.md", kind: "file", size: MATH_DOC.length, mtime_ms: 0 }], files: { "m.md": MATH_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="m.md"]').click();
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);

  // 左边界（6）：Ctrl+F 一步跨入 7 并显露
  await setCursor(page, 6);
  await page.keyboard.press("Control+f");
  expect((await cmSelection(page)).head).toBe(7);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(0);

  // 显露后逐字符通行源码，穿出右边界（11）恢复渲染
  for (let i = 0; i < 4; i++) await page.keyboard.press("Control+f");
  expect((await cmSelection(page)).head).toBe(11);
  await expect(page.locator(".cm-lp-math-inline")).toHaveCount(1);

  expect(await readDocument(page)).toBe(MATH_DOC);
});
