import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";

const DOC = "# CDP IME\n\n用于组合测试的引用原文。\n";
const QUOTED = "用于组合测试的引用原文。";
const VAULT: VaultFixture = {
  entries: [{ path: "ime.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "ime.md": DOC },
  links: {},
};

async function setup(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript((providers) => {
    const w = window as unknown as Record<string, any>;
    w.__sentMessages = [];
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        w.__sentMessages.push(args.parts_json);
        return null;
      }
      if (cmd === "harness_state") return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
      const result = await invoke(cmd, args);
      if (cmd === "config_get" && result?.config) result.config.harness = { provider: "mock", providers, permissions: { allow: [], deny: [] }, loop_max: 8, warn_ctx_pct: 85, auto_compact: true };
      return result;
    };
  }, standardProviders());
  await page.goto("/");
  await page.locator('.ft-row[title="ime.md"]').click();
  await page.evaluate((quoted) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf(quoted);
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
  }, QUOTED);
  await page.locator(".quote-gesture-btn").click();
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("我");
}

test("Chromium CDP 真引擎组合：Backspace 不吃 committed 文本，取消/提交/Enter 与附件 history", async ({ page }) => {
  await setup(page);
  const content = page.locator(".lumir-hp-composer .cm-content");
  const tray = page.locator(".lumir-hp-composer-tray > .lumir-hp-qcard");
  const cdp = await page.context().newCDPSession(page);
  const compose = async (text: string, replacementStart: number) => {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
      replacementStart,
      replacementEnd: replacementStart,
    });
  };

  await tray.locator(".lumir-hp-qc-x").click();
  await expect(tray).toHaveCount(0);
  await page.keyboard.press("Meta+z");
  await expect(tray).toHaveCount(1);
  await expect(tray.locator(".lumir-hp-qc-ex")).toHaveText(QUOTED);
  await expect(content).toHaveText("我");

  await compose("s", 1);
  await expect(content).toHaveText("我s");
  await page.keyboard.press("Backspace");
  await expect(content).toHaveText("我");
  await expect(tray).toHaveCount(1);

  await compose("shuang", 1);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  expect((await content.textContent())?.startsWith("我")).toBe(true);
  await cdp.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
    replacementStart: 1,
    replacementEnd: 5,
  });
  await expect(content).toHaveText("我");
  await expect(tray).toHaveCount(1);

  await compose("shi", 1);
  await cdp.send("Input.insertText", { text: "是" });
  await expect(content).toHaveText("我是");
  await expect(tray).toHaveCount(1);

  await compose("ma", 2);
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (window as unknown as { __sentMessages: string[] }).__sentMessages)).toEqual([]);
  await cdp.send("Input.insertText", { text: "吗" });
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sentMessages: string[] }).__sentMessages.length)).toBe(1);
  await expect(content).toHaveText("");
});
