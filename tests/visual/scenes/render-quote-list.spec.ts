import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 引用内的列表（M138）：blockquote 里的有序/无序/嵌套列表按常规列表渲染——同一个
// 标记 widget（等宽字体的序号）、同一套正文起点对齐。此前只有 callout 放开这条路径，
// 普通引用里的列表停在源码态（`> - 甲项` 原样显示）。
const source = readFileSync(new URL("../fixtures/render-quote-list/quote-list.md", import.meta.url), "utf8");

async function open(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "quote-list.md", kind: "file", size: source.length, mtime_ms: 0 }],
    files: { "quote-list.md": source },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="quote-list.md"]').click();
  await expect(page.locator(".cm-lp-quote-line .cm-lp-list-marker").first()).toBeVisible();
}

/** 行内正文起点 x：跳过标记 widget，取第一个可见字符的 Range 横坐标。 */
async function bodyX(page: Page, needle: string, scope = ".cm-lp-list-line"): Promise<number | null> {
  return page.locator(scope, { hasText: needle }).first().evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest(".cm-lp-list-marker")) continue;
      const text = node.textContent ?? "";
      for (let i = 0; i < text.length; i++) {
        if (/\s/.test(text[i])) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width > 0) return rect.x;
      }
    }
    return null;
  });
}

test("引用内的有序/无序/嵌套列表按常规列表渲染", async ({ page }) => {
  await open(page);

  // 标记 widget：以 `>` 开头的行只显示渲染态标记，源码 `> -` 不再出现。
  // 先等嵌套列表的组宽度就绪（组元数据未完整时该行暂不装饰，后台扫描补上）。
  await expect(page.locator(".cm-lp-quote-line.cm-lp-list-line")).toHaveCount(6);
  const lines = await page.locator(".cm-lp-quote-line.cm-lp-list-line").evaluateAll((els) => els.map((el) => el.textContent));
  expect(lines).toEqual(["•甲项", "•乙项", "1.嵌套一", "2.嵌套二", "1.有序一", "2.有序二"]);
  // 整个引用块的行文本里不再出现源码标记（QuoteMark 与列表标记都被顶掉）
  const quoteText = await page.locator(".cm-lp-quote-line").evaluateAll((els) => els.map((el) => el.textContent ?? "").join("\n"));
  expect(quoteText).not.toContain(">");
  expect(quoteText).not.toContain("- ");

  // 等宽字体序号：标记 widget 走 --font-mono，序号原样保留（不重编号）
  const markers = await page.locator(".cm-lp-quote-line .cm-lp-list-marker").evaluateAll((els) =>
    els.map((el) => ({ text: el.textContent ?? "", font: getComputedStyle(el).fontFamily, numeric: getComputedStyle(el).fontVariantNumeric })),
  );
  expect(markers.map((marker) => marker.text)).toEqual(["•", "•", "1.", "2.", "1.", "2."]);
  for (const marker of markers) {
    expect(marker.font).toContain("monospace");
    expect(marker.numeric).toContain("tabular-nums");
  }

  // 正文起点对齐：同一列表内各条共用一个正文列（有序/无序相邻两张表各自成组，
  // 与正文里的列表同规则）；嵌套项更深一层
  const bullet = (await bodyX(page, "甲项"))!;
  expect(Math.abs((await bodyX(page, "乙项"))! - bullet)).toBeLessThanOrEqual(1);
  const ordered = [(await bodyX(page, "有序一"))!, (await bodyX(page, "有序二"))!];
  expect(Math.abs(ordered[1] - ordered[0])).toBeLessThanOrEqual(1);
  const nested = [(await bodyX(page, "嵌套一"))!, (await bodyX(page, "嵌套二"))!];
  expect(Math.abs(nested[1] - nested[0])).toBeLessThanOrEqual(1);
  expect(nested[0]).toBeGreaterThan(bullet);
  // 引用内的列表相对引用正文起点右移（留出标记列），不是贴着引用左边条
  expect(bullet).toBeGreaterThan((await bodyX(page, "引用里的列表：", ".cm-lp-quote-line"))!);
  // 引用块整体比正文列表右移（引用左边条 + 内距），不把列表拉平到页边
  expect(await bodyX(page, "丙项")).toBeLessThan(bullet);

  // 渲染不写文档（源码保护）
  expect(await readDocument(page)).toBe(source);

  await expect(page).toHaveScreenshot("render-quote-list.png");
});
