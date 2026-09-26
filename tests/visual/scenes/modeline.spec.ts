import { expect, test } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri } from "./tauri-stub";

// modeline 条带的元素级像素基线（M246，「为小元素补元素级基线」Alex 裁决 2026-09-26）。
//
// 为什么整条 modeline 要单独一张元素 crop：它是 1200×25 的常驻 chrome，出现在每一张整页
// 基线里，但它的**局部**变化全部 < 整页 0.001 容差的 960px 预算——M214 实测删右段只有
// 199px（§8.4 假绿防线），M237 实测主题指示钮整钮 821px²（test-results/m237/chip-area-probe.log），
// 两处都被整页对比吞掉（REVIEW.md 第 3 条同族）。元素 crop 的像素预算 = 条带面积的
// 0.001 ≈ 30px，删任何一段必红。
//
// 段文本先逐字断言再拍：文本断言锁「拍的是对的那个状态」，截图锁形态（REVIEW.md 第 1 条）。
// 行为合同（窄窗退让、主题切换、大纲指示段交互）归 titlebar-identity / theme-live-switch /
// toc-outline 各自场景，本场景只钉视觉形态。

const DOC = "# Alpha\n\n正文一段。\n\n## Beta\n\n正文二段。";

test("modeline 条带：四段文本逐字钉住 + 元素级基线", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "doc.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "doc.md": DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="doc.md"]').click();

  // 左段：路径 + 大纲指示段（光标落在首个标题上 → 指示段 = 该标题）
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");
  await expect(page.locator(".modeline-section")).toHaveText("Alpha");
  // 右段：语法 · 行数 · 编码（读取链路落盘文本带结尾换行，CM doc = 7 行）+ 主题指示钮（M237 的常驻归因出口）
  await expect(page.locator(".modeline-meta")).toHaveText("Markdown · 7 行 · UTF-8");
  await expect(page.locator(".modeline-theme")).toHaveText("light");

  await expectScreenshot(page.locator(".modeline"), "modeline-bar.png");
});
