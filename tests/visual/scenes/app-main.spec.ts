import { expect, test } from "@playwright/test";

// 基线场景：空壳 app 启动后的主界面。
// 截图目标见 README.md 的选型说明——这是 webview 内容截图，不含原生窗口装饰。
test("空壳 app 启动后主界面", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".cm-editor")).toBeVisible();
  await expect(page).toHaveScreenshot("app-main.png");
});
