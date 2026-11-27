import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configApplied, stubTauri, type VaultFixture } from "./tauri-stub";

const LONG_CODE = [
  "const short = 1;",
  "const result = computeSomething(alphaValue, bravoValue, charlieValue, deltaValue, echoValue, foxtrotValue, golfValue, hotelValue, indiaValue, julietValue, kiloValue, limaValue); // CODE-END-MARK",
  "const tail = 2;",
  "",
].join("\n");
const SHORT_CODE = "const alpha = 1;\nconst bravo = 2;\nconst charlie = 3;\n";
const MARKDOWN = `# Layout document

A paragraph in the Markdown reading column keeps its existing measure and reflow behavior.

\`\`\`ts
const embedded = computeSomething(alphaValue, bravoValue, charlieValue, deltaValue, echoValue, foxtrotValue, golfValue, hotelValue, indiaValue, julietValue); // BLOCK-END-MARK
\`\`\`

| alpha | bravo | charlie | delta | echo | foxtrot | golf | hotel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| one value | two value | three value | four value | five value | six value | seven value | eight value |
`;
const EXTERNAL_PATH = "/tmp/lumir-verify/code-pane-readonly.ts";
const FILES = {
  "long-line.ts": LONG_CODE,
  "short.ts": SHORT_CODE,
  "doc.md": MARKDOWN,
};
const ENTRIES = Object.entries(FILES).map(([file, text]) => ({ path: file, kind: "file" as const, size: text.length, mtime_ms: 0 }));

interface Geometry {
  contentLeft: number;
  contentRight: number;
  column: number;
  scrollerLeft: number;
  scrollerRight: number;
  scrollerClient: number;
  scrollerScroll: number;
  gutterLeft: number | null;
  gutterRight: number | null;
  whiteSpace: string;
  fontSize: string;
  contentEditable: string | null;
}

async function geometry(page: Page, paneIndex = 0): Promise<Geometry> {
  return page.locator(".editor-pane").nth(paneIndex).evaluate((pane) => {
    const rect = (el: Element) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    };
    const content = pane.querySelector(".cm-content");
    const scroller = pane.querySelector(".cm-scroller");
    if (!content || !scroller) throw new Error("code pane geometry is unavailable");
    const gutter = pane.querySelector(".cm-lineNumbers");
    const contentBox = rect(content);
    const scrollerBox = rect(scroller);
    const gutterBox = gutter ? rect(gutter) : null;
    return {
      contentLeft: contentBox.left,
      contentRight: contentBox.right,
      column: contentBox.width,
      scrollerLeft: scrollerBox.left,
      scrollerRight: scrollerBox.right,
      scrollerClient: (scroller as HTMLElement).clientWidth,
      scrollerScroll: (scroller as HTMLElement).scrollWidth,
      gutterLeft: gutterBox?.left ?? null,
      gutterRight: gutterBox?.right ?? null,
      whiteSpace: getComputedStyle(content).whiteSpace,
      fontSize: getComputedStyle(content).fontSize,
      contentEditable: content.getAttribute("contenteditable"),
    };
  });
}

function expectWorkspaceGeometry(reading: Geometry): void {
  expect(Math.abs(reading.contentRight - reading.scrollerRight), "code 正文右缘必须贴 pane 可用区右缘").toBeLessThanOrEqual(0.51);
  const expectedWidth = reading.scrollerClient - (reading.gutterRight === null ? 0 : reading.gutterRight - reading.scrollerLeft);
  expect(Math.abs(reading.column - expectedWidth), "code 正文占满剩余宽度").toBeLessThanOrEqual(0.51);
  const expectedLeft = reading.gutterRight ?? reading.scrollerLeft;
  expect(Math.abs(reading.contentLeft - expectedLeft), "正文贴 scroller 左缘或 gutter 右缘").toBeLessThanOrEqual(0.51);
}

async function boot(page: Page, first = "long-line.ts", config?: NonNullable<VaultFixture["config"]>): Promise<void> {
  await stubTauri(page, {
    entries: ENTRIES,
    files: FILES,
    externalFiles: { [EXTERNAL_PATH]: "export const external = true;\n" },
    config: { keys: { F2: "pane.split", "Control-j": "view.toggle-line-wrap" }, ...config },
  });
  await page.goto("/");
  await showFile(page, first);
  await configApplied(page);
  await page.waitForTimeout(80);
}

async function showFile(page: Page, name: string): Promise<void> {
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(name);
  await page.waitForTimeout(60);
}

async function widthToken(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--layout-doc-measure").trim());
}

async function uiValueWrites(page: Page): Promise<Array<{ key: string; value: unknown }>> {
  return page.evaluate(() => [...((window as never as { __uiValueWrites?: Array<{ key: string; value: unknown }> }).__uiValueWrites ?? [])]);
}

async function dragMarkdownHandle(page: Page, dx: number): Promise<void> {
  const handle = page.locator(".content-width-handle-right");
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  if (!box) throw new Error("Markdown handle has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(200, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

async function longLineEnd(page: Page, needle: string, paneIndex = 0) {
  const pane = page.locator(".editor-pane").nth(paneIndex);
  const line = pane.locator(".cm-line", { hasText: needle }).first();
  await line.scrollIntoViewIfNeeded();
  return line.evaluate((el) => {
    const scroller = el.closest(".cm-scroller") as HTMLElement;
    scroller.scrollLeft = scroller.scrollWidth;
    const range = document.createRange();
    range.selectNodeContents(el);
    return {
      left: scroller.scrollLeft,
      max: scroller.scrollWidth - scroller.clientWidth,
      textRight: range.getBoundingClientRect().right,
      scrollerRight: scroller.getBoundingClientRect().right,
    };
  });
}

function expectLongLineReachable(end: { left: number; max: number; textRight: number; scrollerRight: number }): void {
  expect(end.left).toBe(end.max);
  expect(end.textRight).toBeLessThanOrEqual(end.scrollerRight + 1);
}

interface BlockGeometry {
  column: number;
  codeClient: number;
  codeScroll: number;
  tableClient: number;
  tableScroll: number;
  mainClient: number;
  mainScroll: number;
}

function expectMarkdownBlockGeometry(reading: BlockGeometry): void {
  expect(reading.column).toBe(760);
  expect(reading.codeClient).toBe(672);
  expect(reading.tableClient).toBe(672);
  expect(reading.codeScroll).toBeGreaterThan(reading.codeClient);
  expect(reading.tableScroll).toBeGreaterThan(reading.tableClient);
  expect(reading.mainScroll).toBe(reading.mainClient);
}

async function editorState(page: Page, paneIndex = 0) {
  return page.locator(".editor-pane").nth(paneIndex).locator(".cm-content").evaluate((content) => {
    type View = { state: { doc: { toString(): string }; selection: { main: { anchor: number; head: number } }; readOnly: boolean } };
    const view = (content as HTMLElement & { cmTile?: { root: { view: View } } }).cmTile?.root.view;
    if (!view) throw new Error("CM view is unavailable");
    return {
      doc: view.state.doc.toString(),
      selection: { anchor: view.state.selection.main.anchor, head: view.state.selection.main.head },
      readOnly: view.state.readOnly,
    };
  });
}

test("code 无 gutter 时满 pane、无阅读手柄、长行可达；普通手势不改宽度或侧栏", async ({ page }) => {
  await boot(page);
  const reading = await geometry(page);
  expectWorkspaceGeometry(reading);
  expect(() => expectWorkspaceGeometry({ ...reading, contentRight: reading.contentRight - 1 })).toThrow();
  await expect(page.locator(".content-width-handles")).toBeHidden();
  expect(reading.whiteSpace).toBe("pre");
  expect(reading.contentEditable).not.toBe("false");
  expect(reading.scrollerScroll).toBeGreaterThan(reading.scrollerClient);
  const end = await longLineEnd(page, "CODE-END-MARK");
  expectLongLineReachable(end);
  expect(() => expectLongLineReachable({ ...end, textRight: end.scrollerRight + 2 })).toThrow();

  const sidebarBefore = await page.evaluate(() => document.documentElement.style.getPropertyValue("--layout-sidebar-w"));
  const windowBefore = await page.evaluate(() => window.innerWidth);
  const box = await page.locator(".cm-content").boundingBox();
  if (!box) throw new Error("code content has no bounding box");
  await page.mouse.move(box.x + 120, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 40, { steps: 4 });
  await page.mouse.up();
  expect(await uiValueWrites(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--layout-sidebar-w"))).toBe(sidebarBefore);
  expect(await page.evaluate(() => window.innerWidth)).toBe(windowBefore);
  expect((await editorState(page)).doc).toBe(LONG_CODE);

  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
  await page.keyboard.type(EXTERNAL_PATH);
  await page.keyboard.press("Enter");
  await expect(page.locator(".modeline-meta")).toContainText("vault 外 · 只读");
  const external = await geometry(page);
  expectWorkspaceGeometry(external);
  await expect(page.locator(".content-width-handles")).toBeHidden();
  expect((await editorState(page)).readOnly).toBe(true);
  expect(external.contentEditable).toBe("false");
});

test("Markdown 拖宽只改变阅读栏；既有 code 的几何、文档与选区不被拖拽改写", async ({ page }) => {
  await boot(page);
  const before = await geometry(page);
  const stateBefore = await editorState(page);
  await showFile(page, "doc.md");
  await expect(page.locator(".content-width-handles")).toBeVisible();
  await dragMarkdownHandle(page, 80);
  await expect.poll(() => widthToken(page)).toBe("920px");
  const markdown = await geometry(page);
  expect(markdown.column).toBeCloseTo(markdown.scrollerClient - 48, 1);
  expect(await uiValueWrites(page)).toEqual([{ key: "content_width", value: 920 }]);

  await showFile(page, "long-line.ts");
  expect(await geometry(page)).toEqual(before);
  const stateAfter = await editorState(page);
  expect(stateAfter).toEqual(stateBefore);
  expect(() => expect(stateAfter).toEqual({ ...stateBefore, selection: { ...stateBefore.selection, head: stateBefore.selection.head + 1 } })).toThrow();
  await expect(page.locator(".content-width-handles")).toBeHidden();
  expect(await uiValueWrites(page)).toEqual([{ key: "content_width", value: 920 }]);
});

test("Markdown 栏与代码块/宽表保持文档组件；切走切回不改变读数", async ({ page }) => {
  await boot(page, "doc.md");
  const readBlocks = async () => page.evaluate(() => {
    const content = document.querySelector(".cm-content")!;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const code = document.querySelector(".cm-lp-codeblock-scroll") as HTMLElement;
    const table = document.querySelector(".cm-lp-table-scroll") as HTMLElement;
    return {
      column: content.getBoundingClientRect().width,
      codeClient: code.clientWidth,
      codeScroll: code.scrollWidth,
      tableClient: table.clientWidth,
      tableScroll: table.scrollWidth,
      mainClient: scroller.clientWidth,
      mainScroll: scroller.scrollWidth,
    };
  });
  const before = await readBlocks();
  expectMarkdownBlockGeometry(before);
  for (const wrong of [
    { ...before, column: before.column + 1 },
    { ...before, codeClient: before.codeClient + 1 },
    { ...before, codeScroll: before.codeClient },
    { ...before, tableClient: before.tableClient + 1 },
    { ...before, tableScroll: before.tableClient },
    { ...before, mainScroll: before.mainScroll + 1 },
  ]) expect(() => expectMarkdownBlockGeometry(wrong)).toThrow();
  await expect(page.locator(".content-width-handles")).toBeVisible();

  await showFile(page, "long-line.ts");
  expectWorkspaceGeometry(await geometry(page));
  await showFile(page, "doc.md");
  expect(await readBlocks()).toEqual(before);
  expect((await editorState(page)).doc).toBe(MARKDOWN);
  await expect(page.locator(".content-width-handles")).toBeVisible();
});

test("双 pane 各按内容模式布局；活跃 pane 切换同步阅读手柄", async ({ page }) => {
  await boot(page, "doc.md");
  await page.keyboard.press("F2");
  await expect(page.locator(".editor-pane")).toHaveCount(2);
  await showFile(page, "long-line.ts");
  const right = await geometry(page, 1);
  expectWorkspaceGeometry(right);
  await expect(page.locator(".content-width-handles")).toBeHidden();

  await page.locator(".editor-pane").nth(0).locator(".cm-content").click();
  await expect(page.locator(".content-width-handles")).toBeVisible();
  const left = await geometry(page, 0);
  expect(Math.abs(left.column - Math.min(760, left.scrollerClient - 48))).toBeLessThanOrEqual(0.51);
  expectWorkspaceGeometry(await geometry(page, 1));
  await page.locator(".editor-pane").nth(1).locator(".cm-content").click();
  await expect(page.locator(".content-width-handles")).toBeHidden();

  // 反向组合：手柄 DOM 仍在 root，但 root 已是 code；活跃的右侧 Markdown 不得让
  // root code 上出现阅读手柄。只读 activeEditor().mode() 会在这里误判。
  await boot(page, "long-line.ts");
  await page.keyboard.press("F2");
  await showFile(page, "doc.md");
  await expect(page.locator(".content-width-handles")).toBeHidden();
  expectWorkspaceGeometry(await geometry(page, 0));
});

test("行号、折行、字号与窄窗组合保持工作区几何、长行可达和选区稳定", async ({ page }) => {
  await boot(page, "short.ts");
  await page.locator(".cm-content").evaluate((content) => {
    type View = { state: { doc: { line(n: number): { from: number } } }; dispatch(spec: unknown): void; focus(): void };
    const view = (content as HTMLElement & { cmTile?: { root: { view: View } } }).cmTile?.root.view;
    view?.dispatch({ selection: { anchor: view.state.doc.line(2).from + 4 } });
    view?.focus();
  });
  const stateBefore = await editorState(page);
  const off = await geometry(page);
  expectWorkspaceGeometry(off);
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const on = await geometry(page);
  expectWorkspaceGeometry(on);
  expect(on.contentRight).toBeCloseTo(off.contentRight, 1);
  expect(on.scrollerScroll).toBe(on.scrollerClient);

  await page.keyboard.press("Meta+=");
  await expect.poll(() => geometry(page).then((reading) => reading.fontSize)).toBe("17px"); // round(15 × 1.1) = 17
  const scaled = await geometry(page);
  expectWorkspaceGeometry(scaled);
  expect(scaled.contentRight).toBeCloseTo(on.contentRight, 1);
  expect(await editorState(page)).toEqual(stateBefore);

  await showFile(page, "long-line.ts");
  await page.keyboard.press("Control+j");
  await expect.poll(() => geometry(page).then((reading) => reading.whiteSpace)).toBe("break-spaces");
  const wrapped = await geometry(page);
  expectWorkspaceGeometry(wrapped);
  expect(wrapped.scrollerScroll).toBe(wrapped.scrollerClient);
  await page.keyboard.press("Control+j");
  await expect.poll(() => geometry(page).then((reading) => reading.whiteSpace)).toBe("pre");
  const end = await longLineEnd(page, "CODE-END-MARK");
  expectLongLineReachable(end);
  expect(() => expectLongLineReachable({ ...end, left: Math.max(0, end.max - 1) })).toThrow();

  await page.locator(".cm-scroller").evaluate((scroller) => { scroller.scrollLeft = 0; });
  await page.setViewportSize({ width: 820, height: 700 });
  await page.keyboard.press("Meta+Shift+N");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  const narrow = await geometry(page);
  expectWorkspaceGeometry(narrow);
  await expect(page.locator(".content-width-handles")).toBeHidden();
  expect(narrow.scrollerScroll).toBeGreaterThan(narrow.scrollerClient);
});

const REVIEW_DIR = process.env.LUMIR_CODE_PANE_REVIEW_DIR;

test("候选图矩阵：三主题 × 单/双 pane，覆盖行号、折行与窄窗", async ({ page }) => {
  const cases = [
    { theme: "light", split: false, lineNumbers: "off", wrap: false, width: 1200 },
    { theme: "light", split: true, lineNumbers: "off", wrap: false, width: 1200 },
    { theme: "dark", split: false, lineNumbers: "on", wrap: true, width: 1200 },
    { theme: "dark", split: true, lineNumbers: "on", wrap: false, width: 1200 },
    { theme: "eink", split: false, lineNumbers: "off", wrap: false, width: 820 },
    { theme: "eink", split: true, lineNumbers: "off", wrap: true, width: 1200 },
  ] as const;
  const readings: Array<unknown> = [];
  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: 800 });
    await boot(page, "doc.md", { theme: item.theme, line_numbers: item.lineNumbers, code_mode_line_wrap: item.wrap });
    if (item.split) await page.keyboard.press("F2");
    await showFile(page, "long-line.ts");
    const reading = await geometry(page, item.split ? 1 : 0);
    readings.push({ ...item, reading });
    if (REVIEW_DIR !== undefined) {
      mkdirSync(REVIEW_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(REVIEW_DIR, `${item.split ? "double" : "single"}-${item.theme}.png`),
        animations: "disabled",
      });
    }
  }
  if (REVIEW_DIR !== undefined) writeFileSync(path.join(REVIEW_DIR, "readings.json"), `${JSON.stringify(readings, null, 2)}\n`);
  for (const item of readings) {
    expectWorkspaceGeometry((item as { reading: Geometry }).reading);
  }
  await expect(page.locator(".content-width-handles")).toBeHidden();
});
