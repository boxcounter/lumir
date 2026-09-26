import { expect, test } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri } from "./tauri-stub";

// 文件内搜索面板（⌘F）的元素级像素基线（M246）：搜索面板 / lightbox / toast 三个周边表面
// 在既有基线里零覆盖（docs/backlog.md M214 登记项），本场景是搜索面板的真基线化。
// M214 的证据层补拍（test-results/m214/peripheral/search-panel-*.png）只作表面清单参考，
// 基线以当前代码实际渲染重拍。
//
// 部件先逐字断言再拍：面板是七件套（标签 / 输入框 / 计数 / 上一个 / 下一个 / 大小写 / 关闭），
// 文本断言锁「拍的是对的那个状态」，截图锁形态（REVIEW.md 第 1 条）。命中与零命中两态各一张：
// 零命中态的计数有专属的 is-empty 弱化样式（src/search.ts 的 sync），是独立可回归的视觉面。
// 搜索行为本身（跳转、大小写切换、Esc 关闭）归各行为场景，本场景只钉视觉形态。

const DOC = "# 搜索场景\n\n公式一与公式二。\n\n普通一行。";

test("搜索面板：命中态与零命中态的元素级基线", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "doc.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "doc.md": DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="doc.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("doc.md");

  await page.keyboard.press("Meta+f");
  const panel = page.locator(".lumir-search");
  await expect(panel).toBeVisible();
  await expect(page.locator(".lumir-search-label")).toHaveText("查找");
  await expect(page.locator(".lumir-search-input")).toBeFocused();
  await expect(panel.getByRole("button", { name: "上一个" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "下一个" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "区分大小写" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "关闭" })).toBeVisible();

  // 命中态：两处命中；尚未 stepping 时无当前命中（index < 0 → 计数 0/2，src/search.ts 的 tallyLabel）
  await page.locator(".lumir-search-input").fill("公式");
  await expect(page.locator(".lumir-search-count")).toHaveText("0/2");
  await expectScreenshot(panel, "search-panel-hit.png");

  // 零命中态：计数弱化（is-empty），输入框保留查询文本
  await page.locator(".lumir-search-input").fill("zzzz");
  await expect(page.locator(".lumir-search-count")).toHaveText("0/0");
  await expect(page.locator(".lumir-search-count")).toHaveClass(/is-empty/);
  await expectScreenshot(panel, "search-panel-nomatch.png");
});
