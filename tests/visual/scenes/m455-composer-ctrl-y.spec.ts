import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M455 回归：composer 内的 **⌃Y 必须命中统一键位表的 `editor.yank`**（`text` 作用域），
// 把编辑器侧 ⌃K 写进**跨面共用** kill 槽的内容插回来。
//
// 验收场景 145（真机）暴露的缺陷：面板自己的 keydown（挂在 composer 元素上、先于 window 分发器）
// 把 `mod+y`（⌘Y 与 ⌃Y）一律当就地 redo `preventDefault` 掉，分发器对已消费事件让路
// （`src/keys.ts:934`）⇒ composer 的 ⌃Y 永远落不到 `yankAtCaret`。修法：就地 redo 收窄到
// meta-only（⌘Y），⌃Y 冒泡给分发器。
//
// 判据：编辑器 ⌃K 杀掉整行 → composer ⌃Y → 被杀的文本出现在 composer。缺陷形态下 composer 仍空。

const DOC = "# 标题\n\nHNL-ALPHA 第一行。\n\n其他。\n";
const KILLED = "HNL-ALPHA 第一行。";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function stubHarness(page: Page): Promise<void> {
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
      if (cmd === "harness_draft_get") return null;
      if (cmd === "harness_draft_put") return null;
      if (cmd === "harness_state") return JSON.stringify(snapshot);
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
  }, EMPTY_STATE);
}

/** 落光标到编辑器并聚焦（键位分发要求事件目标在 contentDOM 内）。 */
async function setEditorCaret(page: Page, pos: number): Promise<void> {
  await page.evaluate((head) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.dispatch({ selection: { anchor: head } });
    view.focus();
  }, pos);
}

test("composer ⌃Y 命中统一键位表：插回编辑器 ⌃K 杀掉的那段文本（跨面 kill 槽）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("HNL-ALPHA");

  // 编辑器：光标落到 HNL-ALPHA 那一行行首，⌃K 杀掉整行（写入模块级 kill 槽）。
  await setEditorCaret(page, DOC.indexOf("HNL-ALPHA"));
  await page.keyboard.press("Control+k");
  await expect(page.locator(".cm-content")).not.toContainText(KILLED);

  // 打开 harness pane，点 composer 建立焦点。
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const composer = page.locator(".lumir-hp-composer");
  await composer.click();

  // ⌃Y：必须是 text 作用域的 editor.yank（跨面 kill 槽），不是面板就地 redo。
  await page.keyboard.press("Control+y");
  await expect(composer).toContainText(KILLED);
});
