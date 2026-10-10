import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

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
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__sentMessages = [];
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        w.__sentMessages.push({ message: args.message });
        return null;
      }
      if (cmd === "harness_abort") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct: 0 },
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
          providers: { kimi: { model: "k2" }, deepseek: { model: "d" }, mock: { fixture: "f.json" } },
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

test("IME 组合期 Enter：WebKit 序确认拍不发送 / Chromium 序不残留窗口 / 正常 Enter 发送 / ⇧Enter 换行", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await stubHarnessIme(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  const composer = page.locator(".lumir-hp-composer");
  const sent = () =>
    page.evaluate(() => (window as unknown as { __sentMessages: unknown[] }).__sentMessages);

  // ── WebKit 序（WKWebView 实测口径）：compositionend 先于确认 keydown，且
  //    keydown.isComposing 已是 false——这正是把「选候选」误当发送的缺陷现场。 ──
  await composer.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    const para = el.querySelector(".lumir-hp-qpara");
    if (para !== null) para.textContent = "你好"; // 候选已落字（insertFromComposition 的产物）
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(await sent(), "确认拍不得发送").toEqual([]);
  await expect(composer, "候选文字留在 composer").toContainText("你好");
  await expect(composer.locator(".lumir-hp-qpara"), "确认拍不留新段落").toHaveCount(1);

  // ── Chromium 序：确认拍 keydown 带 isComposing=true 落在组合期内；其后 compositionend
  //    不得开确认窗（否则下一拍真发送被误吞）。 ──
  await composer.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }),
    );
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  expect(await sent()).toEqual([]);

  // ── 下一拍 Enter = 真发送（两条事件序都不许残留确认窗）。 ──
  await composer.evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(await sent()).toEqual([{ message: "你好" }]);
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await expect(composer, "发送后 composer 归零").not.toContainText("你好");

  // ── ⇧Enter = 换行不发送（模型层软换行，合同 docs/specs/harness-composer.md 的 HC1：光标在
  //    段末时为「新起一行」落一个**新的空段落块**——不是往原段落里追加尾随 \n，尾随换行不产生
  //    行盒）。M419（change harness-composer-newline-fixes）改的就是这条落法，本用例的旧期望
  //    （单 qpara 文本 "x\n"）随之作废。 ──
  await composer.fill("x");
  await composer.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }),
    );
  });
  expect(await sent(), "⇧Enter 不发送").toEqual([{ message: "你好" }]);
  const paras = composer.locator(".lumir-hp-qpara");
  await expect(paras, "⇧Enter 在段末落一个新空段落块（HC1）").toHaveCount(2);
  expect(await paras.nth(0).evaluate((el) => el.textContent), "原段落内容不动").toBe("x");
  expect(await paras.nth(1).evaluate((el) => el.textContent), "新段落为空（供光标承接）").toBe("");
});
