import { expect, test, type Page } from "@playwright/test";
import type { ComposerAttachment } from "../../../src/quote-card";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 合成选区文档\n\n只用于打开 harness，不进入 composer 数据。\n";
const VAULT: VaultFixture = {
  entries: [{ path: "selection-fixture.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "selection-fixture.md": DOC },
  links: {},
};
const quote: ComposerAttachment = {
  kind: "quote",
  card: { file: "synthetic.md", heading: "合成", headingPath: "合成", lines: "1-1", text: "首位引用" },
};
const message: ComposerAttachment = {
  kind: "msgquote",
  card: { role: "assistant", at: 1700000000000, text: "中间消息摘录" },
};
const image: ComposerAttachment = {
  kind: "image",
  card: { name: "pasted-0123456789abcdef.png", sourceMime: "image/png", width: 2, height: 2 },
};

async function openFixture(page: Page, text: string, cards: ComposerAttachment[]): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript((draft) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_draft_get") return JSON.stringify(draft);
      if (cmd === "harness_draft_put") return null;
      if (cmd === "harness_state") return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
      if (cmd === "harness_read_image") return "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
      return invoke(cmd, args);
    };
  }, { version: 3, text, caret: text.length, cards: cards.map((card) => ({ card, at: 0 })) });
  await page.goto("/");
  await page.locator('.ft-row[title="selection-fixture.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  const readDoc = () => page.locator(".lumir-hp-composer .cm-content").evaluate((el) =>
    (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } })
      .cmTile.root.view.state.doc.toString());
  await expect.poll(readDoc).toBe(text);
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard")).toHaveCount(cards.length);
}

for (const fixture of [
  { name: "纯文本多行", text: "alpha\nbeta\ngamma", cards: [] },
  { name: "三类附件", text: "完整问题\n第二行", cards: [quote, message, image] },
]) {
  test(`CM 原生选区：${fixture.name}，全选删除只改文本`, async ({ page }) => {
    await openFixture(page, fixture.text, fixture.cards);
    const content = page.locator(".lumir-hp-composer .cm-content");
    await content.locator(".cm-line").first().click();
    await page.keyboard.press("Meta+a");
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(fixture.text);
    await expect(page.locator(".is-composer-selection-band")).toHaveCount(0);
    await page.keyboard.press("Backspace");
    await expect.poll(() => content.evaluate((el) =>
      (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } })
        .cmTile.root.view.state.doc.toString())).toBe("");
    await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard")).toHaveCount(fixture.cards.length);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => content.evaluate((el) =>
      (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string } } } } } })
        .cmTile.root.view.state.doc.toString())).toBe(fixture.text);
    await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard")).toHaveCount(fixture.cards.length);
  });
}
