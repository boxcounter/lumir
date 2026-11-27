import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  addCompositeCards,
  addImageCard,
  addQuoteCard,
  COPY_SOURCE,
  fireHarnessEvent,
  horizontalGap,
  imageCard,
  lastUserMessage,
  openActionPanel,
  quoteCard,
  readComposerState,
  readCopied,
  readHits,
  readMessageTextRects,
  readRect,
  readWithdrawCalls,
  rectsOverlap,
  type RectReading,
} from "./harness-action-targets-nov27.fixture";

function expectTarget28(reading: { rect: RectReading; misses: unknown[] }): void {
  expect(reading.rect.width).toBeCloseTo(28, 1);
  expect(reading.rect.height).toBeCloseTo(28, 1);
  expect(reading.misses).toEqual([]);
}

async function clickAt(locator: Locator, point: "center" | "left-edge"): Promise<void> {
  const r = await readRect(locator);
  await locator.page().mouse.click(point === "center" ? r.x + r.width / 2 : r.x + 1, r.y + r.height / 2);
}

async function watchParentClicks(card: Locator): Promise<void> {
  await card.evaluate((el) => {
    const w = window as unknown as { __actionParentClicks: number };
    w.__actionParentClicks = 0;
    el.addEventListener("click", () => {
      w.__actionParentClicks += 1;
    });
  });
}

async function parentClicks(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __actionParentClicks: number }).__actionParentClicks);
}

const VIEWPORTS = [
  { name: "默认 light", opts: {} },
  { name: "dark", opts: { theme: "dark" as const } },
  { name: "eink", opts: { theme: "eink" as const } },
  { name: "英文", opts: { language: "en" as const } },
  { name: "放大字号", opts: { fontSize: 32 } },
];

for (const viewport of VIEWPORTS) {
  test(`动作命中区：消息与 composer 的真实 28px 几何 / 边缘命中（${viewport.name}）`, async ({ page }) => {
    await openActionPanel(page, viewport.opts);
    await addCompositeCards(page);
    if (viewport.name === "默认 light") {
      await page.setViewportSize({ width: 760, height: 800 });
      await expect.poll(async () => (await readRect(page.locator(".lumir-harness"))).width).toBeLessThan(300);
    }

    const user = lastUserMessage(page);
    await user.hover();
    const copy = user.locator(".lumir-hp-copy");
    const withdraw = user.locator(".lumir-hp-withdraw");
    const messageReadings = { copy: await readHits(copy), withdraw: await readHits(withdraw) };
    console.log("ACTION_TARGET_MESSAGE " + JSON.stringify({ viewport: viewport.name, ...messageReadings }));
    expectTarget28(messageReadings.copy);
    expectTarget28(messageReadings.withdraw);
    expect(horizontalGap(messageReadings.copy.rect, messageReadings.withdraw.rect)).toBeGreaterThanOrEqual(2);
    const textRects = await readMessageTextRects(user);
    for (const target of [messageReadings.copy.rect, messageReadings.withdraw.rect]) {
      for (const text of textRects) expect(rectsOverlap(target, text)).toBe(false);
    }

    for (const card of [quoteCard(page), imageCard(page)]) {
      await card.scrollIntoViewIfNeeded();
      if (viewport.name === "默认 light") {
        console.log("ACTION_TARGET_NARROW " + JSON.stringify(await card.evaluate((el) => {
          const box = (node: Element | null) => {
            if (node === null) return null;
            const r = node.getBoundingClientRect();
            return { class: node.getAttribute("class"), x: r.x, width: r.width, right: r.right, scrollWidth: (node as HTMLElement).scrollWidth, clientWidth: (node as HTMLElement).clientWidth };
          };
          return {
            card: box(el),
            widget: box(el.parentElement),
            content: box(el.closest(".cm-content")),
            scroller: box(el.closest(".cm-scroller")),
            panel: box(el.closest(".lumir-harness")),
            actions: Array.from(el.querySelectorAll(".lumir-hp-qc-x, .lumir-hp-qc-at")).map(box),
          };
        })));
      }
      const targets = card.locator(".lumir-hp-qc-x, .lumir-hp-qc-at");
      for (const target of await targets.all()) expectTarget28(await readHits(target));
    }
    const at = await readHits(imageCard(page).locator(".lumir-hp-qc-at"));
    const remove = await readHits(imageCard(page).locator(".lumir-hp-qc-x"));
    console.log("ACTION_TARGET_COMPOSER " + JSON.stringify({ viewport: viewport.name, at, remove }));
    expect(horizontalGap(at.rect, remove.rect)).toBeGreaterThanOrEqual(2);
  });
}

test("动作命中区：小图标 / 可见底板 / 可访问名保持分层", async ({ page }) => {
  await openActionPanel(page);
  await addCompositeCards(page);
  const user = lastUserMessage(page);
  await user.hover();
  const copy = user.locator(".lumir-hp-copy");
  const withdraw = user.locator(".lumir-hp-withdraw");
  const visuals = await page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return [r.width, r.height];
    };
    const plate = (selector: string) => {
      const style = getComputedStyle(document.querySelector(selector)!, "::before");
      return [parseFloat(style.width), parseFloat(style.height)];
    };
    return {
      copyIcon: rect(document.querySelector(".lumir-hp-msg-user .lumir-hp-copy svg")!),
      withdrawIcon: rect(document.querySelector(".lumir-hp-withdraw svg")!),
      copyPlate: plate(".lumir-hp-msg-user .lumir-hp-copy"),
      withdrawPlate: plate(".lumir-hp-withdraw"),
      copyName: document.querySelector(".lumir-hp-msg-user .lumir-hp-copy")!.getAttribute("aria-label"),
      withdrawName: document.querySelector(".lumir-hp-withdraw")!.getAttribute("aria-label"),
      copySvgHidden: document.querySelector(".lumir-hp-msg-user .lumir-hp-copy svg")!.getAttribute("aria-hidden"),
      withdrawSvgHidden: document.querySelector(".lumir-hp-withdraw svg")!.getAttribute("aria-hidden"),
    };
  });
  expect(visuals).toEqual({
    copyIcon: [14, 14],
    withdrawIcon: [12, 12],
    copyPlate: [24, 20],
    withdrawPlate: [20, 20],
    copyName: "复制消息",
    withdrawName: "撤回这一轮",
    copySvgHidden: "true",
    withdrawSvgHidden: "true",
  });

  const quote = quoteCard(page);
  await quote.scrollIntoViewIfNeeded();
  const quoteRemove = quote.locator(".lumir-hp-qc-x");
  const at = imageCard(page).locator(".lumir-hp-qc-at");
  const imageRemove = imageCard(page).locator(".lumir-hp-qc-x");
  await expect(quoteRemove).toHaveAttribute("aria-label", "移除摘录");
  await expect(quoteRemove).toHaveAttribute("tabindex", "-1");
  await expect(at).toHaveAttribute("aria-label", "插入图片引用");
  await expect(at).toHaveAttribute("tabindex", "-1");
  await expect(imageRemove).toHaveAttribute("tabindex", "-1");
  expect(await quoteRemove.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(14, 1);
  expect(await quoteRemove.evaluate((el) => getComputedStyle(el, "::before").pointerEvents)).toBe("none");
});

test("动作命中区：复制 success 时撤回让位，反馈恢复与消息布局稳定", async ({ page }) => {
  await openActionPanel(page);
  const user = lastUserMessage(page);
  const copy = user.locator(".lumir-hp-copy");
  const withdraw = user.locator(".lumir-hp-withdraw");
  const layout = async () => ({
    root: await readRect(user),
    who: await readRect(user.locator(".lumir-hp-who")),
    body: await readRect(user.locator(".lumir-hp-body")),
    next: await readRect(page.locator(".lumir-hp-msg-assistant").last()),
    text: await readMessageTextRects(user),
  });
  const before = await layout();
  await user.hover();
  await copy.click();
  await expect(copy).toHaveText("✓ 已复制");
  expect(await readCopied(page)).toEqual([COPY_SOURCE]);
  const successCopy = await readHits(copy);
  const successWithdraw = await readHits(withdraw);
  console.log("ACTION_TARGET_SUCCESS " + JSON.stringify({ copy: successCopy, withdraw: successWithdraw }));
  expect(successCopy.rect.width).toBeGreaterThan(28);
  expect(successCopy.rect.height).toBeCloseTo(28, 1);
  expect(successCopy.misses).toEqual([]);
  expect(successWithdraw.misses).toEqual([]);
  expect(horizontalGap(successCopy.rect, successWithdraw.rect)).toBeGreaterThanOrEqual(2);
  for (const target of [successCopy.rect, successWithdraw.rect]) {
    for (const text of await readMessageTextRects(user)) expect(rectsOverlap(target, text)).toBe(false);
  }
  expect(await layout()).toEqual(before);

  await expect(copy).not.toHaveClass(/is-copied/, { timeout: 3000 });
  expect(await readRect(copy)).toMatchObject({ width: 28, height: 28 });
  expect(horizontalGap(await readRect(copy), await readRect(withdraw))).toBeGreaterThanOrEqual(2);
  expect(await layout()).toEqual(before);
});

test("动作命中区：focus 与 disabled 保留撤回预览 / 零副作用语义", async ({ page }) => {
  await openActionPanel(page);
  const user = lastUserMessage(page);
  const withdraw = user.locator(".lumir-hp-withdraw");
  await user.locator(".lumir-hp-copy").focus();
  await page.keyboard.press("Tab");
  await expect(withdraw).toBeFocused();
  expect(await withdraw.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  await expect.poll(() => withdraw.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await expect(user).toHaveClass(/is-withdraw-preview/);
  expect(await readHits(withdraw)).toMatchObject({ misses: [] });

  await fireHarnessEvent(page, { type: "auto_turn_started" });
  await expect(withdraw).toBeDisabled();
  await expect(withdraw).toHaveAttribute("title", "先停止本轮，再撤回");
  await expect(user).not.toHaveClass(/is-withdraw-preview/);
  await user.hover();
  await clickAt(withdraw, "left-edge");
  expect(await readWithdrawCalls(page)).toEqual([]);
});

test("动作命中区：动作槽不覆盖可见卡片内容，hover 不改 composer 状态", async ({ page }) => {
  await openActionPanel(page);
  await addCompositeCards(page);
  const before = await readComposerState(page);
  for (const card of [quoteCard(page), imageCard(page)]) {
    await card.scrollIntoViewIfNeeded();
    const targets = await card.locator(".lumir-hp-qc-x, .lumir-hp-qc-at").all();
    const content = await card.locator(".lumir-hp-qc-main, .lumir-hp-qc-ex, .lumir-hp-qc-src, .lumir-hp-qc-thumb").all();
    const targetRects = await Promise.all(targets.map(readRect));
    const contentRects = await Promise.all(content.map(readRect));
    for (const target of targetRects) {
      for (const rect of contentRects) expect(rectsOverlap(target, rect)).toBe(false);
    }
    await card.hover();
  }
  expect(await readComposerState(page)).toEqual(before);
});

for (const point of ["center", "left-edge"] as const) {
  test(`动作命中区：引用 × ${point} 真实点击只移除，父卡区域外仍跳转`, async ({ page }) => {
    await openActionPanel(page);
    await addQuoteCard(page);
    const card = quoteCard(page);
    await card.scrollIntoViewIfNeeded();
    await watchParentClicks(card);
    const before = await readComposerState(page);
    await clickAt(card.locator(".lumir-hp-qc-x"), point);
    await expect(card).toHaveCount(0);
    expect(await parentClicks(page)).toBe(0);
    const after = await readComposerState(page);
    expect(after).toMatchObject({ doc: (before as { doc: string }).doc, cards: 0 });

    await addQuoteCard(page);
    const restored = quoteCard(page);
    await watchParentClicks(restored);
    const r = await readRect(restored);
    await page.mouse.click(r.x + 2, r.y + r.height / 2);
    expect(await parentClicks(page)).toBe(1);
  });
}

test("动作命中区：图片 @ 中心与透明边缘各只插入一次，× 不串发", async ({ page }) => {
  await openActionPanel(page);
  await addImageCard(page);
  const card = imageCard(page);
  const at = card.locator(".lumir-hp-qc-at");
  await clickAt(at, "center");
  expect((await readComposerState(page) as { doc: string }).doc.match(/Image 1/g)).toHaveLength(1);
  await expect(card).toHaveCount(1);
  await clickAt(at, "left-edge");
  expect((await readComposerState(page) as { doc: string }).doc.match(/Image 1/g)).toHaveLength(2);
  await expect(card).toHaveCount(1);
});

for (const point of ["center", "left-edge"] as const) {
  test(`动作命中区：图片 × ${point} 只移除，文档与选区不变`, async ({ page }) => {
    await openActionPanel(page);
    await addImageCard(page);
    const before = await readComposerState(page);
    await clickAt(imageCard(page).locator(".lumir-hp-qc-x"), point);
    await expect(imageCard(page)).toHaveCount(0);
    expect(await readComposerState(page)).toMatchObject({
      doc: (before as { doc: string }).doc,
      selection: (before as { selection: unknown }).selection,
      cards: 0,
    });
  });
}
