import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

const DOC = "# 全选基线\n\n第一段用于摘录：先读结论再读论证。\n";
const QUOTED = "第一段用于摘录：先读结论再读论证。";
const VAULT: VaultFixture = {
  entries: [{ path: "harness-select.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-select.md": DOC },
  links: {},
};

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => cmd === "harness_state"
      ? JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 })
      : invoke(cmd, args);
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-select.md"]').click();
  await expect(page.locator(".cm-content")).toContainText(QUOTED);
}

async function openComposer(page: Page): Promise<void> {
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").click();
}

async function addQuote(page: Page): Promise<void> {
  await page.evaluate((quoted) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const start = view.state.doc.toString().indexOf(quoted);
    view.focus();
    view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
  }, QUOTED);
  await page.locator(".quote-gesture-btn").click();
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard")).toHaveCount(1);
}

test("⌘A 选择全部问题文本，选区端点都在 CM contentDOM 内", async ({ page }) => {
  await openDoc(page);
  await openComposer(page);
  await page.keyboard.type("alpha 第一段");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("beta 第二段");
  await page.keyboard.press("Meta+a");
  const selected = await page.evaluate(() => {
    const content = document.querySelector(".lumir-hp-composer .cm-content")!;
    const selection = window.getSelection()!;
    const contains = (node: Node | null) => node !== null && content.contains(node);
    return { text: selection.toString(), anchored: contains(selection.anchorNode) && contains(selection.focusNode) };
  });
  expect(selected.anchored).toBe(true);
  expect(selected.text).toBe("alpha 第一段\nbeta 第二段");
});

test("⌘A 后键入替换全文，undo 恢复，tray 附件逐字段不变", async ({ page }) => {
  await openDoc(page);
  await addQuote(page);
  const content = page.locator(".lumir-hp-composer .cm-content");
  const card = page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard");
  await page.keyboard.type("card-question");
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("X");
  await expect(content.locator(".cm-line")).toHaveText("X");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".lumir-hp-qc-ex")).toHaveText(QUOTED);
  const cardInsideSelection = await page.evaluate(() => {
    const selection = window.getSelection()!;
    const card = document.querySelector(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard")!;
    return selection.rangeCount > 0 && selection.getRangeAt(0).intersectsNode(card);
  });
  expect(cardInsideSelection).toBe(false);
  await page.keyboard.press("Meta+z");
  await expect(content.locator(".cm-line")).toHaveText("card-question");
  await expect(card).toHaveCount(1);
});

test("编辑器内 ⌘A 仍是整篇全选", async ({ page }) => {
  await openDoc(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  const selection = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return { from: view.state.selection.main.from, to: view.state.selection.main.to, length: view.state.doc.length };
  });
  expect(selection).toEqual({ from: 0, to: selection.length, length: selection.length });
});
