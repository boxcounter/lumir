import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 分隔线（M138）：`---` / `***` / `___` 渲染为横线，文档首部 frontmatter 的
// `---` 定界符不在此列（Obsidian 口径）。样式取中性暖发丝线 --bd-2，与表格边框
// 同一 token（设计基线「borders recede to warm hairlines」），朱红留给链接与错误态。
const hr = readFileSync(new URL("../fixtures/render-hr/hr.md", import.meta.url), "utf8");
const HAIRLINE = "rgb(207, 196, 166)"; // --bd-2 #cfc4a6

async function open(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "hr.md", kind: "file", size: hr.length, mtime_ms: 0 }],
    files: { "hr.md": hr },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="hr.md"]').click();
  await expect(page.locator(".cm-lp-hr")).toHaveCount(3);
}

test("三条分隔线渲染为横线，frontmatter 定界符排除在外", async ({ page }) => {
  await open(page);

  // frontmatter 照常渲染成 properties 区块；它的两条 `---` 围栏不变成横线，
  // 否则这里会数到 4 条以上（源文档共 5 个 `---`：2 条围栏 + 1 条分隔线）。
  await expect(page.locator(".cm-lp-frontmatter")).toHaveCount(1);
  await expect(page.locator(".cm-lp-hr-line")).toHaveCount(3);
  await expect(page.locator(".cm-content")).not.toContainText("---");

  // 几何：横线撑满栏宽、本体 0 高（高度来自 1px border），垂直落在行盒内部
  const geometry = await page.locator(".cm-lp-hr").evaluateAll((rules) =>
    rules.map((rule) => {
      const rect = rule.getBoundingClientRect();
      const line = rule.closest(".cm-line")!.getBoundingClientRect();
      return { width: rect.width, height: rect.height, top: rect.top, lineTop: line.top, lineBottom: line.bottom, lineWidth: line.width };
    }),
  );
  expect(geometry).toHaveLength(3);
  for (const rule of geometry) {
    expect(rule.height).toBeLessThanOrEqual(1);
    expect(Math.abs(rule.width - rule.lineWidth)).toBeLessThan(1);
    expect(rule.top).toBeGreaterThan(rule.lineTop);
    expect(rule.top).toBeLessThan(rule.lineBottom);
  }

  // 配色：发丝线取 --bd-2；正文段落没有被规则样式波及
  const color = await page.locator(".cm-lp-hr").first().evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(color).toBe(HAIRLINE);
  // 读屏名：源码被替换掉之后横线不能是匿名元素
  await expect(page.locator(".cm-lp-hr").first()).toHaveAttribute("aria-label", "分隔线");
  const paragraph = await page.locator(".cm-line", { hasText: "第一段落" }).evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(paragraph).not.toBe(HAIRLINE);

  // 渲染不写文档（源码保护）
  expect(await readDocument(page)).toBe(hr);

  await expectScreenshot(page, "render-hr.png");
});

test("光标落进分隔线行时显露源码", async ({ page }) => {
  await open(page);

  // 全选：三条分隔线所在的选区都非空 → 全部显露源码（`---` 可被编辑/删除）。
  // 横线本体 0 高，若这里仍藏源码，用户既看不到光标也看不到刚敲进去的字符。
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await expect(page.locator(".cm-lp-hr")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("---");
  expect(await readDocument(page)).toBe(hr);

  // 选区塌缩回单点后恢复横线渲染
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".cm-lp-hr")).toHaveCount(3);
  expect(await readDocument(page)).toBe(hr);
});
