import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";

const PROVIDERS = standardProviders();
const DOC = "# 合成 Markdown 笔记\n\n仅用于 Harness strong 渲染验收。\n";
const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

async function stubHarness(page: Page, restoredText: string | null): Promise<void> {
  await page.addInitScript((providers) => {
    (window as unknown as Record<string, unknown>).__VISUAL_PROVIDERS = providers;
  }, PROVIDERS);
  await page.addInitScript((text) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: text === null ? [] : [{ role: "assistant", text, ts: Math.floor(Date.now() / 1000) }],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          live_subruns: [],
          subrun_runs: [],
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
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, restoredText);
}

async function openPanel(page: Page, restoredText: string | null = null): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarness(page, restoredText);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("仅用于 Harness strong");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

const fire = (page: Page, payload: unknown) =>
  page.evaluate(
    (value) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(value),
    payload,
  );

const assistantBody = (page: Page) => page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first();

test("恢复消息：列表 strong 的计算字重与同行后续文本保持既有排版", async ({ page }) => {
  const source = [
    "普通 **段落粗体**后续。",
    "",
    "1. **中文粗体**，后续",
    "2. **English bold**after",
    "3. 前**甲**中**乙**后",
    "   - **嵌套粗体**后续",
    "4. `**代码**`与\\*\\*转义\\*\\*",
  ].join("\n");
  await openPanel(page, source);

  const body = assistantBody(page);
  await expect(body.locator("strong")).toHaveText(["段落粗体", "中文粗体", "English bold", "甲", "乙", "嵌套粗体"]);
  const orderedItems = body.locator("ol").first().locator(":scope > li");
  await expect(orderedItems.nth(0)).toContainText("，后续");
  await expect(orderedItems.nth(1)).toContainText("after");
  await expect(orderedItems.nth(3)).toContainText("**代码**与**转义**");
  for (const strong of await body.locator("strong").all()) {
    expect(await strong.evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  }
});

test("流式中间态：空行后的列表缩进续段不变成代码或字面星号，终态收敛", async ({ page }) => {
  await openPanel(page);
  await page.locator(".lumir-hp-composer .cm-content").fill("合成提问");
  await page.locator(".lumir-hp-send").click();

  await fire(page, {
    type: "text_chunk",
    text: "普通 **段落粗体**后续。\n\n1. 第一项\n2. 第二项\n\n    **续段粗体**后续",
  });
  const body = assistantBody(page);
  await expect(body.locator("strong")).toHaveText(["段落粗体", "续段粗体"]);
  await expect(body.locator("ol li").nth(1).locator("strong")).toHaveText("续段粗体");
  await expect(body.locator("pre")).toHaveCount(0);
  await expect(body).not.toContainText("**");
  await expect(body).toContainText("后续");

  await fire(page, { type: "text_chunk", text: "\n\n后续 **顶层粗体**。" });
  await expect(body.locator("strong")).toHaveText(["段落粗体", "续段粗体", "顶层粗体"]);
  await expect(body.locator("pre")).toHaveCount(0);
  await expect(body).not.toContainText("**");

  await fire(page, { type: "done" });
  await expect(body.locator("strong")).toHaveText(["段落粗体", "续段粗体", "顶层粗体"]);
  await expect(body.locator("pre")).toHaveCount(0);
  await expect(body).not.toContainText("**");
});
