import { expect, test } from "@playwright/test";
import { DEMO_VAULT, fireQuitBlocked, stubTauri, type VaultFixture } from "./tauri-stub";

// 退出确认弹框的焦点 / Escape 最小回归（change add-quit-save-all-dialog-nov27 的行为面）。
//
// 为什么单独一个 spec 并挂进 webkit-realua：真机 239 在 r1 用 Escape 关闭成功、r4/r5 连续
// 两下都不关；同一份产品代码、同一棵 AX 树（主按钮已 focused、取消按钮可点）。本 spec 把
// 「打开后主按钮持焦 → Escape 关闭」放到 Chromium 与真 WebKit 引擎各跑一次，用来区分
// 「产品 DOM/焦点/Escape 层栈缺陷」与「WKWebView 原生键盘焦点 / KimiCU 按键通道」。
// 无像素断言。

const DOC = "# 退出焦点\n\nQESC-ALPHA 合成文档。\n";
const VAULT: VaultFixture = {
  ...DEMO_VAULT,
  entries: [{ path: "quit-escape.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "quit-escape.md": DOC },
};

async function openDirty(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="quit-escape.md"]').click();
  const content = page.locator(".cm-content");
  await expect(content).toContainText("QESC-ALPHA");
  await content.click();
  await page.keyboard.type("QESC-DIRTY");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
}

test("退出确认：打开后主按钮持焦，Escape 关闭弹框且应用不退（Chromium / WebKit 同判）", async ({ page }, info) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openDirty(page);
  await fireQuitBlocked(page);

  const overlay = page.locator(".lumir-quit-overlay");
  const primary = page.locator(".lumir-quit-btn-primary");
  await expect(overlay).toBeVisible();
  await expect(primary).toBeFocused();

  const focusState = await page.evaluate(() => ({
    hasFocus: document.hasFocus(),
    active: document.activeElement instanceof HTMLElement ? document.activeElement.className : null,
    inert: document.getElementById("app")?.inert ?? null,
  }));
  console.log(`[${info.project.name}] quit-dialog focus=${JSON.stringify(focusState)}`);
  expect(focusState.hasFocus, "弹框打开后 webview 必须持焦").toBe(true);

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("QESC-DIRTY");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  expect(focusState.inert).toBe(true);
});

test("退出确认：连续 quit_blocked 单弹框；Escape 后再次拦截仍能打开并关闭（不叠弹）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openDirty(page);

  await fireQuitBlocked(page);
  await fireQuitBlocked(page);
  await fireQuitBlocked(page);
  await expect(page.locator(".lumir-quit-card")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-quit-overlay")).toBeHidden();

  await fireQuitBlocked(page);
  await expect(page.locator(".lumir-quit-overlay")).toBeVisible();
  await expect(page.locator(".lumir-quit-btn-primary")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-quit-overlay")).toBeHidden();
});
