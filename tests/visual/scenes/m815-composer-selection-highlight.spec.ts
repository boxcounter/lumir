import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { ComposerBlock } from "../../../src/quote-card";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { changedPixels, decodePng, type PixelRect } from "./selection-pixel";

const DOC = "# 合成选区文档\n\n只用于打开 harness，不进入 composer 数据。\n";
const VAULT: VaultFixture = {
  entries: [{ path: "selection-fixture.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "selection-fixture.md": DOC },
  links: {},
};

const quote = (text: string): ComposerBlock => ({
  kind: "quote",
  card: { file: "synthetic.md", heading: "合成", headingPath: "合成", lines: "1-1", text },
});
const message = (text: string): ComposerBlock => ({
  kind: "msgquote",
  card: { role: "assistant", at: 1700000000000, text },
});
const image: ComposerBlock = {
  kind: "image",
  card: { name: "pasted-0123456789abcdef.png", sourceMime: "image/png", width: 2, height: 2 },
};
const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });

const CASES: Array<{ name: string; blocks: ComposerBlock[]; blur?: boolean }> = [
  { name: "卡片首位", blocks: [quote("首位引用"), para("卡片后问题")], blur: true },
  { name: "卡片中间", blocks: [para("前段"), message("中间消息摘录"), para("后段")] },
  { name: "卡片末位", blocks: [para("末位卡片前文本"), image] },
  {
    name: "多类卡片交错",
    blocks: [quote("引用一"), para("第一段"), message("消息二"), para("第二段")],
  },
  { name: "纯文本多段落", blocks: [para("alpha"), para("beta\ngamma")] },
  { name: "软断行与卡片", blocks: [para("alpha\nbeta"), quote("断行间引用"), para("gamma\ndelta")] },
];

async function openFixture(page: Page, blocks: ComposerBlock[]): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript((draft) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_draft_get") return JSON.stringify(draft);
      if (cmd === "harness_draft_put") return null;
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "harness_read_image") {
        return "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
      }
      return invoke(cmd, args);
    };
  }, { version: 1, blocks, caret: null });
  await page.goto("/");
  await page.locator('.ft-row[title="selection-fixture.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("合成选区文档");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-composer > *")).toHaveCount(blocks.length);
  await page.addStyleTag({
    content: "* { transition: none !important; animation: none !important; } .lumir-hp-composer { caret-color: transparent !important; }",
  });
  await collapseAtEnd(page);
}

async function collapseAtEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const composer = document.querySelector(".lumir-hp-composer") as HTMLElement;
    composer.focus();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

async function geometry(page: Page): Promise<{ composer: PixelRect; blocks: PixelRect[] }> {
  return page.evaluate(() => {
    const composer = document.querySelector(".lumir-hp-composer") as HTMLElement;
    const box = (el: Element): PixelRect => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return { composer: box(composer), blocks: [...composer.children].map(box) };
  });
}

async function selectionShape(page: Page): Promise<{ anchor: number; focus: number; count: number; covers: boolean }> {
  return page.evaluate(() => {
    const composer = document.querySelector(".lumir-hp-composer") as HTMLElement;
    const selection = window.getSelection()!;
    const range = selection.rangeCount === 0 ? null : selection.getRangeAt(0);
    return {
      anchor: selection.anchorNode === composer ? selection.anchorOffset : -1,
      focus: selection.focusNode === composer ? selection.focusOffset : -1,
      count: composer.children.length,
      covers: range !== null && [...composer.children].every((child) => range.intersectsNode(child)),
    };
  });
}

async function shot(page: Page, info: TestInfo, name: string): Promise<Buffer> {
  const buffer = await page.screenshot({ animations: "disabled" });
  await info.attach(name, { body: buffer, contentType: "image/png" });
  return buffer;
}

for (const fixture of CASES) {
  test(`HC6 可见性：${fixture.name}`, async ({ page }, testInfo) => {
    await openFixture(page, fixture.blocks);
    const beforeGeometry = await geometry(page);
    const before = decodePng(await shot(page, testInfo, "01-collapsed.png"));

    await page.keyboard.press("Meta+a");
    await expect.poll(async () => (await selectionShape(page)).covers).toBe(true);
    expect(await selectionShape(page)).toEqual({ anchor: 0, focus: fixture.blocks.length, count: fixture.blocks.length, covers: true });
    expect(await geometry(page)).toEqual(beforeGeometry);
    const selected = decodePng(await shot(page, testInfo, "02-selected.png"));

    const perBlock = beforeGeometry.blocks.map((rect, index) => ({
      index,
      changed: changedPixels(before, selected, rect),
    }));
    testInfo.annotations.push({ type: "selected-block-pixels", description: JSON.stringify(perBlock) });
    for (const reading of perBlock) {
      expect(reading.changed, `块 ${reading.index} 必须出现可见高亮`).toBeGreaterThan(0);
    }
    expect(changedPixels(before, selected, undefined, beforeGeometry.composer), "composer 外不得出现选区高亮").toBe(0);

    await collapseAtEnd(page);
    await expect.poll(async () => {
      const collapsed = decodePng(await page.screenshot({ animations: "disabled" }));
      return beforeGeometry.blocks.reduce((sum, rect) => sum + changedPixels(before, collapsed, rect), 0);
    }, { message: "折叠后所有自绘高亮必须消失" }).toBe(0);
    await shot(page, testInfo, "03-collapsed-again.png");

    if (fixture.blur === true) {
      await page.keyboard.press("Meta+a");
      await page.locator(".cm-content").click({ position: { x: 20, y: 20 } });
      await expect.poll(async () => {
        const blurred = decodePng(await page.screenshot({ animations: "disabled" }));
        return beforeGeometry.blocks.reduce((sum, rect) => sum + changedPixels(before, blurred, rect), 0);
      }, { message: "失焦后自绘高亮不得残留" }).toBe(0);
      await shot(page, testInfo, "04-blurred.png");
      await page.locator(".lumir-hp-composer > .lumir-hp-qpara").last().click();
    }

    await page.keyboard.press("Meta+a");
    await page.keyboard.press("Backspace");
    const composer = page.locator(".lumir-hp-composer");
    await expect(composer.locator(":scope > .lumir-hp-qcard")).toHaveCount(0);
    await expect(composer.locator(":scope > .lumir-hp-qpara")).toHaveCount(1);
    expect((await composer.textContent())?.trim() ?? "").toBe("");
    await shot(page, testInfo, "05-after-backspace.png");
  });
}
