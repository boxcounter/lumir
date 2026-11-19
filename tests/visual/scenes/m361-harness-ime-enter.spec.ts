import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { providerEntry, standardProviders } from "./provider-config";

const PROVIDERS = standardProviders();

// M361 2.3 行为不变量：IME 组合期 Enter 不触发发送。WKWebView 下「确认候选」那拍 Enter 的
// keydown.isComposing 不可靠（WebKit 先派 compositionend 再派确认 keydown），实现改用
// compositionstart/end 自跟踪状态机（src/harness-panel.ts 的 imeGate* 纯函数 + keydown
// 接线）。本场景用合成的组合/键盘事件按两种真实事件序驱动 composer，判：WebKit 序确认拍
// 不发送、Chromium 序（isComposing=true）不残留确认窗、窗口外正常 Enter 发送、⇧Enter 换行。
// 真机中文输入法的候选窗路径（TSM/Input Method Kit 层）机器驱动不可达——证据归
// test-results/m361-ime/ 真机复现记录（steps.md）。
//
// 本场景同时在 chromium 与 webkit-realua（真机同款 UA 的 WebKit 引擎）两个 project 下跑：
// 事件序行为判据在真 WebKit 引擎里有独立区分度（playwright.config 的 testMatch 登记）。

const DOC = "# IME 笔记\n\n第一段。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 桩：harness_state 零态 + harness_send 调用记录 + harness:event listen 记录（同 m347 口径）。 */
async function stubHarnessIme(page: Page): Promise<void> {
  await page.addInitScript((providers) => {
    (window as unknown as Record<string, unknown>).__VISUAL_PROVIDERS = providers;
  }, PROVIDERS);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__sentMessages = [];
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        w.__sentMessages.push({ parts_json: args.parts_json });
        return null;
      }
      if (cmd === "harness_abort") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: (window as unknown as Record<string, any>).__VISUAL_PROVIDERS,
          permissions: { allow: [], deny: [] },
          loop_max: 8,
          warn_ctx_pct: 85,
          auto_compact: true,
        };
      }
      return result;
    };
  });
}

test("IME 确认门：两种事件序不发送，窗口外 Enter 发送，⇧Enter 只换行", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessIme(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await composer.click();
  const sent = () => page.evaluate(() => (window as unknown as { __sentMessages: unknown[] }).__sentMessages);

  await composer.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await page.keyboard.insertText("你好");
  await composer.evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(await sent()).toEqual([]);
  await expect(composer).toHaveText("你好");

  await composer.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await page.keyboard.press("Enter");
  expect(await sent()).toEqual([{ parts_json: '[{"kind":"text","text":"你好"}]' }]);
  await expect(composer).toHaveText("");

  await page.keyboard.type("x");
  await page.keyboard.press("Shift+Enter");
  expect(await sent()).toHaveLength(1);
  await expect(composer).toHaveText("x\n");
  await expect(composer.locator(".cm-line")).toHaveCount(2);
});
