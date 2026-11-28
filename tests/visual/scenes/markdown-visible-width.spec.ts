import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configApplied, readingPositionPuts, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

const END = "VISIBLE-WIDTH-END";
const LONG_LINE = "Visible window probe: " + "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima. ".repeat(10) + END;
const DOC = ["# Visible width probe", "", LONG_LINE, "", "short anchor", "", ...Array.from({ length: 80 }, (_, i) => `filler ${i}`), ""].join("\n");
const BLOCK_DOC = [
  "# Block probe", "", "short paragraph", "", "```ts", `const embedded = "${"block".repeat(80)}"; // BLOCK-END`, "```", "",
  "| alpha | bravo | charlie | delta | echo | foxtrot |", "| --- | --- | --- | --- | --- | --- |",
  "| one long value | two long value | three long value | four long value | five long value | six long value |", "",
].join("\n");
const CODE_DOC = `const result = "${"code".repeat(150)}"; // CODE-END\n`;
const VERTICAL_DOC = [
  "# Vertical probe", "", LONG_LINE, "", "", "", "short anchor", "", "```ts", `const embedded = "${"block".repeat(40)}"; // VERTICAL-BLOCK-END`, "```", "",
  "| alpha | bravo | charlie |", "| --- | --- | --- |", "| one long value | two long value | three long value |", "", "",
].join("\n");
const FILES = { "visible.md": DOC, "other-long.md": DOC, "other.md": "Other document\n", "origin.md": LONG_LINE, "blocks.md": BLOCK_DOC, "vertical.md": VERTICAL_DOC, "code.ts": CODE_DOC };
const ENTRIES = Object.entries(FILES).map(([file, text]) => ({ path: file, kind: "file", size: text.length, mtime_ms: 0 }));
const MUTATION = process.env.LUMIR_VISIBLE_WIDTH_MUTATION;
const REVIEW_DIR = process.env.LUMIR_VISIBLE_WIDTH_REVIEW_DIR;
const PHASE = process.env.LUMIR_VISIBLE_WIDTH_PHASE ?? "candidate";

interface Options {
  wrap: boolean;
  lineNumbers: boolean;
  theme: "light" | "dark" | "eink";
  split: boolean;
  narrow: boolean;
}

interface WindowReading {
  left: number;
  right: number;
  textLeft: number;
  textRight: number;
  clipPath: string;
  layerClipPath: string;
  paddingLeft: string;
  paddingRight: string;
  rawLeft: number;
  rawRight: number;
  visibleLeft: number;
  visibleRight: number;
  endLeft: number;
  endRight: number;
  innerX: number;
  innerMax: number;
  outerX: number;
  outerMax: number;
  overflowX: string;
  scrollport: boolean;
  whiteSpace: string;
  titleLeft: number | null;
  titleRight: number | null;
  endMarkerLeft: number | null;
  endMarkerRight: number | null;
  gutterLeft: number | null;
  gutterRight: number | null;
  handleRight: number | null;
  scrollTop: number;
}

async function showFile(page: Page, file: string): Promise<void> {
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(file);
  await page.waitForTimeout(60);
}

async function boot(page: Page, options: Partial<Options> = {}, file = "visible.md", positions?: VaultFixture["positions"]): Promise<void> {
  await page.setViewportSize(options.narrow ? { width: 820, height: 700 } : { width: 1200, height: 800 });
  await stubTauri(page, {
    entries: ENTRIES,
    files: FILES,
    vault_id: "visible-width-vault",
    positions,
    config: {
      line_wrap: options.wrap ?? false,
      line_numbers: options.lineNumbers ? "on" : "off",
      theme: options.theme ?? "light",
      keys: { F2: "pane.split", "Control-j": "view.toggle-line-wrap" },
    },
  });
  await page.goto("/");
  await showFile(page, file);
  await configApplied(page);
  await page.waitForTimeout(100);
  if (options.split) {
    await page.keyboard.press("F2");
    await expect(page.locator(".editor-pane")).toHaveCount(2);
    await showFile(page, "other-long.md");
  }
  if (MUTATION === "wrap" && (options.wrap ?? false)) {
    await page.addStyleTag({ content: ".cm-content { overflow-x: auto; }" });
  }
}

async function setHorizontal(page: Page, fraction: number, paneIndex = 0, legacy = false): Promise<void> {
  await page.locator(".editor-pane").nth(paneIndex).evaluate((pane, args) => {
    const content = pane.querySelector(".cm-content") as HTMLElement;
    const scroller = pane.querySelector(".cm-scroller") as HTMLElement;
    const inner = content.classList.contains("cm-lp-reading-scrollport");
    const target = inner && !args.legacy ? content : scroller;
    const value = Math.max(0, target.scrollWidth - target.clientWidth) * args.fraction;
    if (args.mutation === "inner-x") {
      (inner ? scroller : content).scrollLeft = value;
    } else {
      target.scrollLeft = value;
    }
  }, { fraction, legacy, mutation: MUTATION });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function readWindow(page: Page, paneIndex = 0): Promise<WindowReading> {
  return page.locator(".editor-pane").nth(paneIndex).evaluate((pane, args) => {
    const content = pane.querySelector(".cm-content") as HTMLElement;
    const scroller = pane.querySelector(".cm-scroller") as HTMLElement;
    const line = [...content.querySelectorAll(".cm-line")].find(el => el.textContent?.includes(args.end));
    if (!line) throw new Error("long line is not rendered");
    const box = (el: Element | null) => el ? el.getBoundingClientRect() : null;
    const contentBox = content.getBoundingClientRect();
    const contentStyle = getComputedStyle(content);
    const inset = contentStyle.clipPath === "none" ? 0 : Number.parseFloat(contentStyle.paddingLeft);
    const textLeft = contentBox.left + inset;
    const textRight = contentBox.right - inset;
    const clip = (rect: DOMRect, start: Element): { left: number; right: number } => {
      let left = rect.left, right = rect.right;
      let current: Element | null = start;
      while (current && current !== pane) {
        const overflow = getComputedStyle(current).overflowX;
        if (/^(auto|scroll|hidden|clip)$/.test(overflow)) {
          const ancestor = current.getBoundingClientRect();
          left = Math.max(left, ancestor.left);
          right = Math.min(right, ancestor.right);
        }
        if (current === content && contentStyle.clipPath !== "none") {
          left = Math.max(left, textLeft);
          right = Math.min(right, textRight);
        }
        current = current.parentElement;
      }
      return { left, right };
    };
    const raw: DOMRect[] = [];
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      raw.push(...range.getClientRects());
    }
    if (raw.length === 0) throw new Error("long line has no text glyph rects");
    const visible = raw.map(rect => clip(rect, line));
    const textNode = [...line.querySelectorAll("*"), line]
      .flatMap(el => [...el.childNodes])
      .find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.includes(args.end));
    if (!textNode) throw new Error("line-end text node is unavailable");
    const endRange = document.createRange();
    endRange.setStart(textNode, textNode.textContent!.indexOf(args.end));
    endRange.setEnd(textNode, textNode.textContent!.indexOf(args.end) + args.end.length);
    const endBox = endRange.getBoundingClientRect();
    const title = box(pane.querySelector(".cm-lp-doc-title-outer"));
    const endMarker = box(pane.querySelector(".cm-lp-end-marker"));
    const gutter = box(pane.querySelector(".cm-gutters"));
    const handle = box(pane.querySelector(".content-width-handle-right"));
    const layer = pane.querySelector(".cm-layer");
    const result = {
      left: contentBox.left, right: contentBox.right, textLeft, textRight,
      clipPath: contentStyle.clipPath,
      layerClipPath: layer ? getComputedStyle(layer).clipPath : "none",
      paddingLeft: contentStyle.paddingLeft, paddingRight: contentStyle.paddingRight,
      rawLeft: Math.min(...raw.map(r => r.left)), rawRight: Math.max(...raw.map(r => r.right)),
      visibleLeft: Math.min(...visible.map(r => r.left)), visibleRight: Math.max(...visible.map(r => r.right)),
      endLeft: endBox.left, endRight: endBox.right,
      innerX: content.scrollLeft, innerMax: content.scrollWidth - content.clientWidth,
      outerX: scroller.scrollLeft, outerMax: scroller.scrollWidth - scroller.clientWidth,
      overflowX: getComputedStyle(content).overflowX,
      scrollport: content.classList.contains("cm-lp-reading-scrollport"),
      whiteSpace: getComputedStyle(content).whiteSpace,
      titleLeft: title?.left ?? null, titleRight: title?.right ?? null,
      endMarkerLeft: endMarker?.left ?? null, endMarkerRight: endMarker?.right ?? null,
      gutterLeft: gutter?.left ?? null, gutterRight: gutter?.right ?? null,
      handleRight: handle ? handle.left + handle.width / 2 : null,
      scrollTop: scroller.scrollTop,
    };
    if (args.mutation === "glyph") result.visibleRight = result.right + 2;
    if (args.mutation === "inset-left") result.visibleLeft = result.textLeft - 1;
    if (args.mutation === "inset-right") result.visibleRight = result.textRight + 1;
    if (args.mutation === "end") result.endRight = result.textRight + 2;
    if (args.mutation === "chrome" && result.titleLeft !== null) result.titleLeft += 2;
    return result;
  }, { mutation: MUTATION, end: END });
}

function expectVisibleWindow(reading: WindowReading, wrap: boolean): void {
  const where = JSON.stringify(reading);
  expect(reading.visibleLeft, `glyph 左缘越出文字窗口：${where}`).toBeGreaterThanOrEqual(reading.textLeft - 0.51);
  expect(reading.visibleRight, `glyph 右缘越出文字窗口：${where}`).toBeLessThanOrEqual(reading.textRight + 0.51);
  expect(reading.outerX, `外层不应承接正文横滚：${where}`).toBe(0);
  expect(reading.scrollport).toBe(!wrap);
  expect(reading.overflowX).toBe(wrap ? "visible" : "auto");
  if (!wrap) {
    expect(reading.textLeft, `左侧 44px 留白必须始终存在：${where}`).toBe(reading.left + 44);
    expect(reading.textRight, `右侧 44px 留白必须始终存在：${where}`).toBe(reading.right - 44);
    expect(reading.clipPath, `文字层必须按双侧留白裁切：${where}`).not.toBe("none");
    expect(reading.layerClipPath, `caret/selection 层必须共用内缩裁切：${where}`).toContain("44px");
    expect(reading.innerMax, `自然长行应在 inner 产生横滚：${where}`).toBeGreaterThan(0);
    expect(reading.outerMax, `自然长行不应再撑大 outer：${where}`).toBe(0);
  }
  if (reading.titleLeft !== null) {
    expect(Math.abs(reading.titleLeft - reading.left)).toBeLessThanOrEqual(0.51);
    expect(Math.abs((reading.titleRight ?? 0) - reading.right)).toBeLessThanOrEqual(0.51);
  }
  if (reading.endMarkerLeft !== null) {
    expect(Math.abs(reading.endMarkerLeft - reading.left)).toBeLessThanOrEqual(0.51);
    expect(Math.abs((reading.endMarkerRight ?? 0) - reading.right)).toBeLessThanOrEqual(0.51);
  }
  if (reading.handleRight !== null) expect(Math.abs(reading.handleRight - reading.right)).toBeLessThanOrEqual(0.51);
}

function expectEndReachable(reading: WindowReading): void {
  expect(reading.innerX).toBe(reading.innerMax);
  expect(reading.endLeft).toBeGreaterThanOrEqual(reading.textLeft - 0.51);
  expect(reading.endRight).toBeLessThanOrEqual(reading.textRight + 0.51);
}

test("行为矩阵：wrap/nowrap × 三横滚位 × 行号 × 单双 pane × 宽窄窗 × 三主题", async ({ page }) => {
  test.setTimeout(240_000);
  const readings: Array<unknown> = [];
  for (const wrap of [false, true]) {
    for (const theme of ["light", "dark", "eink"] as const) {
      for (const lineNumbers of [false, true]) {
        for (const split of [false, true]) {
          for (const narrow of [false, true]) {
            const options = { wrap, theme, lineNumbers, split, narrow };
            await boot(page, options);
            for (const pane of split ? [0, 1] : [0]) {
              const gutter = await readWindow(page, pane);
              for (const [label, fraction] of [["start", 0], ["middle", 0.5], ["end", 1]] as const) {
                await setHorizontal(page, fraction, pane);
                const reading = await readWindow(page, pane);
                expectVisibleWindow(reading, wrap);
                if (!wrap && label === "end") expectEndReachable(reading);
                if (wrap) expect(reading.innerX).toBe(0);
                expect(reading.gutterLeft).toEqual(gutter.gutterLeft);
                readings.push({ ...options, pane, label, reading });
              }
            }
          }
        }
      }
    }
  }
  console.log(`VISIBLE-WIDTH-MATRIX ${JSON.stringify(readings)}`);
  expect(readings).toHaveLength(216);
});

test("caret、键入、undo、粘贴、选区与全选复制都使用 inner scrollport", async ({ page }) => {
  await boot(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const state = () => page.locator(".cm-content").evaluate(content => {
    const view = (content as HTMLElement & { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { doc: view.state.doc.toString() as string, anchor: main.anchor as number, head: main.head as number, x: view.contentDOM.scrollLeft as number, top: view.scrollDOM.scrollTop as number };
  });
  const setCaret = async (pos: number) => {
    await page.locator(".cm-content").evaluate((content, at) => {
      const view = (content as HTMLElement & { cmTile: { root: { view: any } } }).cmTile.root.view;
      view.dispatch({ selection: { anchor: at }, scrollIntoView: true });
      view.focus();
    }, pos);
    await page.waitForTimeout(100);
  };
  const endPos = DOC.indexOf(END) + END.length;
  await setCaret(0);
  expect((await state()).x).toBe(0);
  await setCaret(endPos);
  if (MUTATION === "reveal") await page.locator(".cm-content").evaluate(el => { el.scrollLeft = 0; });
  const atEnd = await state();
  expect(atEnd.x).toBeGreaterThan(0);
  expect(atEnd.doc).toBe(DOC);
  expect(atEnd.top).toBe(0);
  const cursor = await page.locator(".cm-cursor").boundingBox();
  const text = await readWindow(page);
  if (!cursor) throw new Error("caret geometry is unavailable");
  expect(cursor.x).toBeGreaterThanOrEqual(text.textLeft - 1);
  expect(cursor.x + cursor.width).toBeLessThanOrEqual(text.textRight + 1);

  await page.keyboard.type("-EDIT");
  expect((await state()).doc).toBe(`${DOC.slice(0, endPos)}-EDIT${DOC.slice(endPos)}`);
  await page.keyboard.press("Meta+z");
  expect((await state()).doc).toBe(DOC);
  if (MUTATION === "doc") await page.keyboard.type("X");

  await setCaret(endPos);
  await page.locator(".cm-content").evaluate(content => {
    const transfer = new DataTransfer(); transfer.setData("text/plain", "-PASTE");
    content.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  expect((await state()).doc).toBe(`${DOC.slice(0, endPos)}-PASTE${DOC.slice(endPos)}`);
  await page.keyboard.press("Meta+z");
  expect((await state()).doc).toBe(DOC);

  await page.locator(".cm-content").evaluate((content, args) => {
    const view = (content as HTMLElement & { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: args.at - args.length, head: args.at }, scrollIntoView: true });
    view.focus();
  }, { at: endPos, length: END.length });
  await page.waitForTimeout(100);
  const selection = await page.locator(".cm-selectionBackground").evaluateAll(elements => elements.map(el => {
    const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width };
  }).filter(r => r.width > 0));
  expect(selection.length).toBeGreaterThan(0);
  if (MUTATION === "selection") selection[0].right = text.textRight + 2;
  for (const rect of selection) {
    expect(rect.left).toBeGreaterThanOrEqual(text.textLeft - 1);
    expect(rect.right).toBeLessThanOrEqual(text.textRight + 1);
  }
  expect((await state()).doc).toBe(DOC);

  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(DOC);
  expect(copied).not.toContain("Visible window probe\n\nVisible window probe");
  expect((await state()).doc).toBe(DOC);
});

test("搜索行尾匹配后 query 不变、匹配进入 X", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Meta+f");
  const input = page.locator(".lumir-search-input");
  await expect(input).toBeFocused();
  await input.fill(END);
  await page.getByRole("button", { name: "下一个" }).click();
  await expect(page.locator(".cm-searchMatch-selected")).toHaveCount(1);
  await page.waitForTimeout(100);
  if (MUTATION === "search") await page.locator(".cm-content").evaluate(el => { el.scrollLeft = 0; });
  const match = await page.locator(".cm-searchMatch-selected").boundingBox();
  const text = await readWindow(page);
  if (!match) throw new Error("search match geometry is unavailable");
  expect(match.x + match.width).toBeLessThanOrEqual(text.textRight + 1);
  expect(match.x).toBeGreaterThanOrEqual(text.textLeft - 1);
  await expect(input).toHaveValue(END);
  expect((await readWindow(page)).innerX).toBeGreaterThan(0);
});

test("content scroll 触发捕获；切标签恢复 inner x；装载恢复纵向与横向", async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(1200);
  const before = (await readingPositionPuts(page)).length;
  await setHorizontal(page, 0.5);
  const expectedX = (await readWindow(page)).innerX;
  expect(expectedX).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  const puts = await readingPositionPuts(page);
  expect(puts.length).toBeGreaterThan(before);
  const captured = puts.at(-1)?.entries?.["visible.md"];
  expect(captured?.x).toBe(expectedX);
  if (MUTATION === "capture") expect(captured?.x).toBe(0);
  await page.locator('.ft-row[title="other.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".modeline-path")).toHaveText("other.md");
  await showFile(page, "visible.md");
  await expect.poll(() => readWindow(page).then(reading => reading.innerX)).toBe(expectedX);
  if (MUTATION === "restore") expect((await readWindow(page)).innerX).toBe(0);

  const pos = DOC.indexOf("filler 40");
  await boot(page, {}, "visible.md", { "visible-width-vault": { "visible.md": { pos, y: 48, x: 500, at: 1_700_000_000_000 } } });
  const restored = await readWindow(page);
  expect(restored.innerX).toBe(500);
  expect(restored.scrollTop).toBeGreaterThan(0);
  expectVisibleWindow(restored, false);
});

test("code 满 pane 与 Markdown 块级横滚不被 inner scrollport 接管", async ({ page }) => {
  await boot(page, {}, "blocks.md");
  const outerMax = () => page.locator(".cm-scroller").evaluate(el => el.scrollWidth - el.clientWidth);
  expect(await outerMax()).toBe(0);
  const blocks = await page.evaluate(() => [".cm-lp-codeblock-scroll", ".cm-lp-table-scroll"].map(selector => {
    const el = document.querySelector(selector) as HTMLElement;
    return { selector, client: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right };
  }));
  for (const block of blocks) {
    expect(block.scroll).toBeGreaterThan(block.client);
    await page.locator(block.selector).evaluate(el => { el.scrollLeft = el.scrollWidth; });
    if (MUTATION === "block") await page.locator(block.selector).evaluate(el => { el.scrollLeft = 0; });
    expect(await page.locator(block.selector).evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  }
  expect(await page.locator(".cm-content").evaluate(el => el.scrollLeft)).toBe(0);
  expect(await outerMax()).toBe(0);
  await showFile(page, "code.ts");
  const code = await page.locator(".cm-content").evaluate(content => {
    const scroller = content.closest(".cm-scroller") as HTMLElement;
    scroller.scrollLeft = scroller.scrollWidth;
    return { innerClass: content.classList.contains("cm-lp-reading-scrollport"), outerX: scroller.scrollLeft, outerMax: scroller.scrollWidth - scroller.clientWidth };
  });
  if (MUTATION === "code") code.innerClass = true;
  expect(code.innerClass).toBe(false);
  expect(code.outerMax).toBeGreaterThan(0);
  expect(code.outerX).toBe(code.outerMax);
});

test("横滚补偿不改变空/非空行高度、初始锚点或块级尺寸", async ({ page }) => {
  for (const options of [{}, { split: true }, { narrow: true }]) {
    await boot(page, options, "vertical.md");
    const measure = () => page.locator(".editor-pane").evaluateAll(panes => panes.map(pane => {
      const scroller = pane.querySelector(".cm-scroller") as HTMLElement;
      return {
        top: scroller.scrollTop,
        lines: [...pane.querySelectorAll(".cm-line")].map(line => ({ text: line.textContent ?? "", height: line.getBoundingClientRect().height })),
        blocks: [".cm-lp-codeblock-scroll", ".cm-lp-table-scroll"].map(selector => {
          const el = pane.querySelector(selector) as HTMLElement | null;
          if (!el) return { selector, width: 0, height: 0, scrollWidth: 0, clientWidth: 0 };
          const box = el.getBoundingClientRect();
          return { selector, width: box.width, height: box.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
        }),
      };
    }));
    const before = await measure();
    expect(before.length).toBe(options.split ? 2 : 1);
    for (const pane of before) {
      expect(pane.top).toBe(0);
      expect(pane.lines.filter(line => line.text === "").length).toBeGreaterThanOrEqual(4);
      expect(pane.lines.some(line => line.text !== "")).toBe(true);
      expect(pane.blocks.every(block => block.width === 0 || block.height > 0)).toBe(true);
    }
    expect(before[0].blocks.some(block => block.width > 0)).toBe(true);
    if (MUTATION === "vertical") {
      await page.addStyleTag({ content: ".cm-content.cm-lp-reading-scrollport .cm-line::after { content: '' !important; display: inline-block !important; inline-size: 44px !important; }" });
    }
    await page.keyboard.press("Control+j");
    await page.waitForTimeout(80);
    await page.keyboard.press("Control+j");
    await page.waitForTimeout(80);
    expect(await measure()).toEqual(before);
    await setHorizontal(page, 1);
    const scrolled = await measure();
    expect(scrolled.map(pane => pane.top)).toEqual(before.map(pane => pane.top));
    expect(scrolled.map(pane => pane.lines)).toEqual(before.map(pane => pane.lines));
    expect(scrolled.map(pane => pane.blocks)).toEqual(before.map(pane => pane.blocks));
    for (let pane = 0; pane < before.length; pane++) {
      await setHorizontal(page, 1, pane);
      expectEndReachable(await readWindow(page, pane));
    }
    await setHorizontal(page, 0);
  }
});

async function setSelectionRange(page: Page, anchor: number, head: number, explicitRange: boolean): Promise<void> {
  await page.locator(".cm-content").evaluate((content, args) => {
    const view = (content as HTMLElement & { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: args.anchor, head: args.head }, scrollIntoView: true });
    if (args.explicitRange) {
      view.dispatch({ effects: view.constructor.scrollIntoView(view.state.selection.main, { y: "nearest" }) });
    }
  }, { anchor, head, explicitRange });
  await page.waitForTimeout(120);
}

async function activeHead(page: Page) {
  return page.locator(".cm-content").evaluate(content => {
    const view = (content as HTMLElement & { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    const at = view.domAtPos(main.head, main.assoc || 1);
    const range = content.ownerDocument.createRange();
    range.setStart(at.node, at.offset); range.collapse(true);
    const head = range.getBoundingClientRect();
    const box = content.getBoundingClientRect();
    const style = getComputedStyle(content);
    const inset = style.clipPath === "none" ? 0 : Number.parseFloat(style.paddingLeft);
    return { anchor: main.anchor, head: main.head, x: content.scrollLeft, max: content.scrollWidth - content.clientWidth, left: box.left, right: box.right, textLeft: box.left + inset, textRight: box.right - inset, headLeft: head.left, headRight: head.right, fontSize: style.fontSize };
  });
}

function expectActiveHeadVisible(reading: Awaited<ReturnType<typeof activeHead>>): void {
  expect(reading.headLeft).toBeGreaterThanOrEqual(reading.textLeft - 1);
  expect(reading.headRight).toBeLessThanOrEqual(reading.textRight + 1);
}

test("宽正向选区按 active head 保右端；字号调整沿用同一真实消费者", async ({ page }) => {
  await boot(page);
  const lineStart = DOC.indexOf("Visible window probe");
  const lineEnd = DOC.indexOf(END) + END.length;
  await setSelectionRange(page, lineEnd, lineEnd, false);
  const before = await activeHead(page);
  expect(before.x).toBe(before.max);
  await setSelectionRange(page, lineStart, lineEnd, true);
  const after = await activeHead(page);
  expectActiveHeadVisible(after);
  expect(after.x).toBe(before.x);
  await page.keyboard.press("Meta+=");
  await page.waitForTimeout(120);
  const scaled = await activeHead(page);
  expect(scaled.fontSize).toBe("17px");
  expectActiveHeadVisible(scaled);
});

test("宽反向选区按 active head 保左端并保留起点留白", async ({ page }) => {
  await boot(page);
  const lineStart = DOC.indexOf("Visible window probe");
  const lineEnd = DOC.indexOf(END) + END.length;
  await setSelectionRange(page, lineStart, lineStart, false);
  const before = await activeHead(page);
  expect(before.x).toBe(0);
  await setSelectionRange(page, lineEnd, lineStart, true);
  const after = await activeHead(page);
  expectActiveHeadVisible(after);
  expect(after.headLeft).toBeCloseTo(after.textLeft, 1);
  expect(after.x, "横滚起点不能为制造 xMargin 而变成负数").toBe(0);
});

test("真实原点捕获 → 装载恢复：纵向早退不吞 inner x，交还焦点同样保留", async ({ page }) => {
  await boot(page, {}, "origin.md");
  await page.waitForTimeout(1200);
  await setHorizontal(page, 0.25);
  await page.waitForTimeout(1500);
  const captured = (await readingPositionPuts(page)).at(-1)?.entries?.["origin.md"];
  expect(captured?.pos).toBe(0);
  expect(captured?.x).toBeGreaterThan(0);
  const position = { pos: captured!.pos, y: captured!.y, x: captured!.x };
  await boot(page, {}, "origin.md", { "visible-width-vault": { "origin.md": { ...position, at: captured!.at } } });
  const restored = await activeHead(page);
  if (MUTATION === "restore") await page.locator(".cm-content").evaluate(el => { el.scrollLeft = 0; });
  expect(restored.head).toBe(0);
  expect((await activeHead(page)).x).toBe(position.x);
  const target = await page.locator(".cm-content").evaluate((content, y) => {
    const view = (content as HTMLElement & { cmTile: { root: { view: any } } }).cmTile.root.view;
    const rect = view.coordsAtPos(0);
    if (!rect) throw new Error("origin caret is unreadable");
    return rect.top - view.scrollDOM.getBoundingClientRect().top - y;
  }, position.y);
  expect(target).toBeLessThanOrEqual(0);
  await page.keyboard.press("Meta+f");
  await expect(page.locator(".lumir-search-input")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect.poll(() => activeHead(page).then(reading => reading.x)).toBe(position.x);
});

test("现状与候选图：三主题 × 单双 pane × 横滚位置，另含窄窗", async ({ page }) => {
  test.setTimeout(120_000);
  const readings: Array<unknown> = [];
  for (const theme of ["light", "dark", "eink"] as const) {
    for (const split of [false, true]) {
      for (const [label, fraction] of [["start", 0], ["middle", 0.5], ["end", 1]] as const) {
        const options = { wrap: false, theme, lineNumbers: label === "middle", split, narrow: false };
        await boot(page, options);
        if (PHASE === "current") await page.addStyleTag({ content: ".cm-content.cm-lp-reading-scrollport { overflow-x: visible !important; }" });
        await setHorizontal(page, fraction, 0, PHASE === "current");
        const reading = await readWindow(page);
        if (PHASE === "candidate") {
          expectVisibleWindow(reading, false);
          if (label === "end") expectEndReachable(reading);
        }
        readings.push({ phase: PHASE, ...options, label, reading });
        if (REVIEW_DIR) {
          const dir = path.join(REVIEW_DIR, PHASE);
          mkdirSync(dir, { recursive: true });
          await page.screenshot({ path: path.join(dir, `${theme}-${split ? "double" : "single"}-${label}.png`), animations: "disabled" });
        }
      }
    }
  }
  for (const [label, fraction] of [["start", 0], ["middle", 0.5], ["end", 1]] as const) {
    const options = { wrap: false, theme: "light" as const, lineNumbers: false, split: false, narrow: true };
    await boot(page, options);
    if (PHASE === "current") await page.addStyleTag({ content: ".cm-content.cm-lp-reading-scrollport { overflow-x: visible !important; }" });
    await setHorizontal(page, fraction, 0, PHASE === "current");
    const reading = await readWindow(page);
    if (PHASE === "candidate") {
      expectVisibleWindow(reading, false);
      if (label === "end") expectEndReachable(reading);
    }
    readings.push({ phase: PHASE, ...options, label, reading });
    if (REVIEW_DIR) {
      const dir = path.join(REVIEW_DIR, PHASE);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `narrow-${label}.png`), animations: "disabled" });
    }
  }
  if (REVIEW_DIR) writeFileSync(path.join(REVIEW_DIR, `${PHASE}-readings.json`), `${JSON.stringify(readings, null, 2)}\n`);
  if (PHASE === "current") expect(readings.some(item => (item as { reading: WindowReading }).reading.visibleRight > (item as { reading: WindowReading }).reading.right + 1)).toBe(true);
});
