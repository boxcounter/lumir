import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M112 交互缺陷回归（真实桌面用户实证，与 M111 公式点击同族）：
// 1) 点击渲染后的 Mermaid 图表不进入源码编辑——replace widget 整体隐藏源码，CM 对
//    widget 内事件默认 ignoreEvent 不放置光标；修复为三态 widget（pending / ok /
//    fallback）都挂 mousedown，复用 M111 enterMathSource 模式（math.ts 抽出共用
//    enterReplacedSource），点击即显露源码、光标钳入围栏块内部。
// 2) 异步渲染的布局位移期点击落点偏 0——settle 重建替换 widget DOM 时，浏览器原生
//    caret 若进入 widget 节点，selectionchange 异步读取时节点已游离，CM 的
//    posFromDOM 把游离锚点映射为 0（光标跳文档起点）；修复口径是 preventDefault
//    挡住原生落点进入 widget DOM，从源头掐断该路径。

function cmSelection(page: Page) {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { anchor: main.anchor, head: main.head, empty: main.empty, docLength: view.state.doc.length };
  });
}

function setCursor(page: Page, pos: number) {
  return page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

const MERMAID_CLICK_DOC = `\
# 图表

\`\`\`mermaid
graph TD
  A[开始] --> B[结束]
\`\`\`

图表后段落。

\`\`\`mermaid
graph TD
  A[未闭合
\`\`\`
`;

const VAULT = {
  entries: [{ path: "click.md", kind: "file", size: MERMAID_CLICK_DOC.length, mtime_ms: 0 }],
  files: { "click.md": MERMAID_CLICK_DOC },
};

/** 第 index 个（0-based）```mermaid 围栏块的文档范围。 */
function fenceRange(doc: string, index: number): { from: number; to: number } {
  let from = -1;
  for (let i = 0; i <= index; i++) from = doc.indexOf("```mermaid", from + 1);
  const closeStart = doc.indexOf("```", from + "```mermaid".length);
  return { from, to: closeStart + 3 };
}

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="click.md"]').click();
}

test("点击渲染成功的图表进入源码编辑，光标落在块内且可编辑", async ({ page }) => {
  await openDoc(page);
  const widget = page.locator(".cm-lp-mermaid").filter({ has: page.locator("svg") });
  await expect(widget).toHaveCount(1);

  await widget.click();
  // 修复前：点击无落点，图表保持渲染态、源码不可编辑
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(0);
  const doc = await readDocument(page);
  const block = fenceRange(doc, 0);
  const sel = await cmSelection(page);
  expect(sel.empty).toBeTruthy();
  expect(sel.head).toBeGreaterThan(block.from);
  expect(sel.head).toBeLessThan(block.to);
  // 围栏源码行可见
  await expect(page.locator(".cm-content")).toContainText("A[开始]");

  // 光标移出后恢复渲染（未编辑，缓存命中）
  await setCursor(page, 0);
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(1);

  // 再次点击进入：输入字符落入块内源码
  await widget.click();
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(0);
  await page.keyboard.type("X");
  const edited = await readDocument(page);
  expect(edited).not.toBe(MERMAID_CLICK_DOC);
  const editedBlock = fenceRange(edited, 0);
  expect(edited.slice(editedBlock.from, editedBlock.to)).toContain("X");
});

test("点击失败降级块进入源码编辑", async ({ page }) => {
  await openDoc(page);
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(1);
  const fallback = page.locator(".cm-lp-mermaid-fallback");
  await expect(fallback).toHaveCount(1);

  await fallback.click();
  await expect(page.locator(".cm-lp-mermaid-fallback")).toHaveCount(0);
  const doc = await readDocument(page);
  const block = fenceRange(doc, 1);
  const sel = await cmSelection(page);
  expect(sel.empty).toBeTruthy();
  expect(sel.head).toBeGreaterThan(block.from);
  expect(sel.head).toBeLessThan(block.to);
  await expect(page.locator(".cm-content")).toContainText("A[未闭合");
  await page.keyboard.type("Y");
  expect(await readDocument(page)).not.toBe(MERMAID_CLICK_DOC);
});

test("布局位移期点击占位：进入源码编辑且落点不偏 0，settle 后不回弹渲染态", async ({ page }) => {
  let release!: () => void;
  let served = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/mermaid.core-*.js", async (route) => {
    await gate;
    served = true;
    await route.continue();
  });
  await openDoc(page);
  const pending = page.locator(".cm-lp-mermaid-pending");
  await expect(pending.first()).toBeVisible();

  // 渲染未 settle 时点击占位：修复前 CM ignoreEvent 后光标无处落点（滞留 0），
  // 原生 caret 进 widget DOM 还会在 settle 替换节点后被映射为 0
  await pending.first().click();
  await expect(page.locator(".cm-lp-mermaid-pending")).toHaveCount(1); // 第二个图仍 pending
  const doc = await readDocument(page);
  const block = fenceRange(doc, 0);
  const sel = await cmSelection(page);
  expect(sel.head).toBeGreaterThan(block.from);
  expect(sel.head).toBeLessThan(block.to);
  await expect(page.locator(".cm-content")).toContainText("A[开始]");

  // 释放 chunk：后台渲染 settle。选区仍重叠块范围，装饰保持显露、不回弹渲染态
  release();
  await expect.poll(() => served, { timeout: 10000 }).toBe(true);
  await page.waitForTimeout(400); // 渲染队列 settle 窗口
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("A[开始]");
  expect((await cmSelection(page)).head).toBe(sel.head);
  expect(await readDocument(page)).toBe(MERMAID_CLICK_DOC);

  // settle 已发生且源码未回弹的证据：光标移出后图表按需渲染出现
  await setCursor(page, 0);
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(1);
});

test("高度变化期间点击图表下方段落，落点在段落内不偏 0", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/mermaid.core-*.js", async (route) => {
    await gate;
    await route.continue();
  });
  await openDoc(page);
  await expect(page.locator(".cm-lp-mermaid-pending").first()).toBeVisible();

  const doc = await readDocument(page);
  const paraFrom = doc.indexOf("图表后段落");
  const paraTo = paraFrom + "图表后段落。".length;

  // 位移前：占位矮，段落在初始位置，点击落点必须精确落入段落
  const line = page.locator(".cm-line", { hasText: "图表后段落" });
  await line.click();
  let sel = await cmSelection(page);
  expect(sel.head).toBeGreaterThanOrEqual(paraFrom);
  expect(sel.head).toBeLessThanOrEqual(paraTo);

  // 释放渲染：SVG 远比占位高，段落被向下推；位移后再点击仍须落同一段落
  release();
  await expect(page.locator(".cm-lp-mermaid svg")).toHaveCount(1);
  await line.click();
  sel = await cmSelection(page);
  expect(sel.head).toBeGreaterThanOrEqual(paraFrom);
  expect(sel.head).toBeLessThanOrEqual(paraTo);
  expect(await readDocument(page)).toBe(MERMAID_CLICK_DOC);
});
