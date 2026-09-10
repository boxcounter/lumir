import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M111 缺陷 3 回归（真实桌面大文档实证，WebKit 引擎复现）：大文档表格
// 首屏/滚动进入视口时渲染为裸露源码（管道符原文），滚动一段距离后才恢复 grid。
// 根因有二：后台解析在 WKWebView 无 requestIdleCallback、走 500ms setTimeout 兜底，
// 视口进入未解析区域时找不到 Table 节点；且 syntaxTree(state) 是事务快照，后台
// 解析推进后、setState 落地前为旧树（实证 isDone 为真时快照仍缺 Table 节点）。
// 修复（livePreview.parseCoveredTree）：装饰构建一律取 ensureSyntaxTree 的 live
// 最新树，未覆盖时同步推进至多 25ms；不完整结果不进 tableMetadataCache。
// 本场景钉死合同：任何滚动落点，视口内不得出现未渲染的表格源码行。

function makeDoc(sections: number): string {
  const parts: string[] = [`# 大文档表格\n\n引言段落。\n`];
  for (let i = 1; i <= sections; i++) {
    parts.push(`\n## 第 ${i} 节\n\n第 ${i} 节说明文字，补充若干背景描述内容，让每节占据足够的字节数以拉开表格间距。\n\n| 时间 | 事件 | 地点 | 影响 |\n| --- | --- | --- | --- |\n| ${1900 + i} 年 | 事件甲-${i} | 地点甲 | 影响说明文字若干 |\n| ${1901 + i} 年 | 事件乙-${i} | 地点乙 | 更长的说明文字内容，占据更多空间位置 |\n| ${1902 + i} 年 | 事件丙-${i} | 地点丙 | 影响说明 |\n`);
  }
  return parts.join("");
}

// ~270KB，远超 CM 后台解析的视口前看上限（视口 + 100K 字符）
const BIG_DOC = makeDoc(1200);

async function openBigDoc(page: import("@playwright/test").Page): Promise<void> {
  await stubTauri(page, { entries: [{ path: "big.md", kind: "file", size: BIG_DOC.length, mtime_ms: 0 }], files: { "big.md": BIG_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="big.md"]').click();
  await page.locator(".cm-lp-table").first().waitFor();
}

/** 视口内裸露的表格源码行数（含管道符且不在 grid 内的 .cm-line）。 */
function countBareTableLines(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const sr = scroller.getBoundingClientRect();
    return [...document.querySelectorAll(".cm-line")].filter((el) => {
      if (!el.textContent?.includes("|") || el.closest(".cm-lp-table")) return false;
      const r = el.getBoundingClientRect();
      return r.bottom > sr.top && r.top < sr.bottom;
    }).length;
  });
}

test("大文档：首屏表格即正确渲染", async ({ page }) => {
  await openBigDoc(page);
  expect(await countBareTableLines(page)).toBe(0);
  // 首屏表格有 grid 结构与单元格
  const first = page.locator(".cm-lp-table").first();
  await expect(first.locator(".cm-lp-table-row").first()).toBeVisible();
  expect(await first.locator(".cm-lp-table-cell").count()).toBeGreaterThan(0);
  expect(await readDocument(page)).toBe(BIG_DOC);
});

test("大文档：跳转/滚动落点的表格进入视口即正确渲染，无裸露源码窗口", async ({ page }) => {
  await openBigDoc(page);
  const scroller = page.locator(".cm-scroller");
  const max = await scroller.evaluate((el) => el.scrollHeight - el.clientHeight);

  for (const ratio of [0.3, 0.6, 0.95]) {
    await scroller.evaluate((el, y) => { el.scrollTop = y; }, max * ratio);
    // 落点立即采样 + 随后 ~1s 内的恢复窗口都不允许出现裸露源码行
    for (let i = 0; i < 8; i++) {
      expect(await countBareTableLines(page), `ratio=${ratio} 采样 ${i}`).toBe(0);
      await page.waitForTimeout(120);
    }
    // 视口内有表格且为 grid 渲染态
    expect(await page.locator(".cm-lp-table").count()).toBeGreaterThan(0);
  }
  expect(await readDocument(page)).toBe(BIG_DOC);
});
