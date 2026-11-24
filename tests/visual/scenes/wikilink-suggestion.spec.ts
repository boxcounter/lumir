import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { fileText, stubTauri, type VaultFixture } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const OVERLAY = ".lumir-link-suggest";
const ROW = ".lumir-link-suggest-item";

function fixture(doc: string, paths: readonly string[]): VaultFixture {
  const all = ["source.md", ...paths];
  return {
    entries: all.map((path) => ({ path, kind: "file", size: path === "source.md" ? doc.length : 0, mtime_ms: 0 })),
    files: Object.fromEntries(all.map((path) => [path, path === "source.md" ? doc : ""])),
  };
}

async function select(page: Page, anchor: number, head = anchor): Promise<void> {
  await page.locator(".cm-content").evaluate((content, range) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: range.anchor, head: range.head } });
    view.focus();
  }, { anchor, head });
}

async function caret(page: Page): Promise<number> {
  return page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return view.state.selection.main.head;
  });
}

async function focused(page: Page): Promise<boolean> {
  return page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return document.activeElement === view.contentDOM;
  });
}

async function openDoc(page: Page, doc: string, paths: readonly string[] = ["notes/Alpha.md", "notes/alphabet.md"]): Promise<void> {
  await stubTauri(page, fixture(doc, paths));
  await page.goto("/");
  await page.locator('.ft-row[title="source.md"]').click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect(page.locator(".modeline-path")).toHaveText("source.md");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await select(page, doc.length);
}

async function rows(page: Page): Promise<string[]> {
  return page.locator(ROW).evaluateAll((items) => items.map((item) => item.textContent ?? ""));
}

test("触发、过滤、方向键 / ⌃NP 与 Enter：完整路径、焦点和 caret 都正确", async ({ page }) => {
  const doc = "[[al";
  await openDoc(page, doc, ["notes/Alpha.md", "notes/alphabet.md", "notes/Beta.md", "notes/readme.markdown"]);
  await expect(page.locator(OVERLAY)).toBeVisible();
  expect(await rows(page)).toEqual(["notes/Alpha.md", "notes/alphabet.md"]);
  expect(await fileText(page, "source.md")).toBe(doc);

  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`${ROW}.is-active`)).toHaveText("notes/alphabet.md");
  await page.keyboard.press("Control+p");
  await expect(page.locator(`${ROW}.is-active`)).toHaveText("notes/Alpha.md");
  await page.keyboard.press("Control+n");
  await expect(page.locator(`${ROW}.is-active`)).toHaveText("notes/alphabet.md");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(`${ROW}.is-active`)).toHaveText("notes/Alpha.md");
  expect(await readDocument(page)).toBe(doc);

  await page.keyboard.press("Enter");
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await readDocument(page)).toBe("[[notes/Alpha.md]]");
  expect(await caret(page)).toBe("[[notes/Alpha.md]]".length);
  expect(await focused(page)).toBe(true);
  expect(await fileText(page, "source.md")).toBe(doc);
  await expect(page.locator(".modeline-path")).toContainText("source.md");
});

test("鼠标 mousedown 接受不抢焦点；再次打开后点击外部只关闭", async ({ page }) => {
  const doc = "[[al";
  await openDoc(page, doc);
  const second = page.locator(ROW).nth(1);
  await second.dispatchEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
  expect(await readDocument(page)).toBe("[[notes/alphabet.md]]");
  expect(await focused(page)).toBe(true);

  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("x");
  await expect(page.locator(OVERLAY)).toBeVisible();
  const beforeOutside = await readDocument(page);
  await page.locator(".modeline-path").click();
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await readDocument(page)).toBe(beforeOutside);
  expect(await fileText(page, "source.md")).toBe(doc);
});

test("Escape、失焦和退格关闭路径均零额外写入；Tab 保留列表缩进", async ({ page }) => {
  const doc = "- first\n- [[al";
  await openDoc(page, doc);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await readDocument(page)).toBe(doc);
  expect(await caret(page)).toBe(doc.length);
  await page.keyboard.type("p");
  await expect(page.locator(OVERLAY)).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await readDocument(page)).toBe("- first\n  - [[alp");
  await expect(page.locator(OVERLAY)).toBeVisible();

  await page.locator(".modeline-path").click();
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  const blurred = await readDocument(page);
  await page.locator(".cm-content").click();
  await select(page, blurred.lastIndexOf("[[") + 2);
  await page.keyboard.press("Backspace");
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await readDocument(page)).toBe("- first\n  - [alp");
});

test("无匹配只显示既有空态，Enter 委派编辑器且不创建笔记", async ({ page }) => {
  const doc = "[[missing";
  await openDoc(page, doc);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await expect(page.locator(".lumir-link-suggest-empty")).toHaveText(/没有匹配的条目|No matching items/);
  await expect(page.locator(ROW)).toHaveCount(0);
  await page.keyboard.press("Enter");
  expect(await readDocument(page)).toBe(`${doc}\n`);
  expect(await fileText(page, "source.md")).toBe(doc);
  expect(await fileText(page, "missing.md")).toBeUndefined();
});

test("接受前索引失效：零候选写入，Enter 走原逻辑", async ({ page }) => {
  const doc = "[[al";
  await openExperiment(page, doc, ["notes/Alpha.md", "notes/alphabet.md"]);
  await expect(page.locator(ROW)).toHaveCount(2);
  await page.evaluate(() => { (window as any).experiment.linkSuggest(["notes/alphabet.md"]); });
  await page.keyboard.press("Enter");
  expect(await readDocument(page)).toBe(`${doc}\n`);
});

for (const path of ["foo.md.md", "a/note.MD", "Café.md", "笔记/中文.md", "family/👩‍👩‍👧‍👦.md"]) {
  test(`特殊文件名逐字接受：${path}`, async ({ page }) => {
    await openDoc(page, "[[", ["foo.md", "foo.md.md", "a/note.md", "a/note.MD", "Café.md", "笔记/中文.md", "family/👩‍👩‍👧‍👦.md"]);
    await page.locator(`${ROW}[title="${path}"]`).dispatchEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
    expect(await readDocument(page)).toBe(`[[${path}]]`);
    expect(await caret(page)).toBe(`[[${path}]]`.length);
  });
}

test("根文件精确同名不可接受，目录项仍可接受且不会误拒 folded 变体", async ({ page }) => {
  const doc = "[[foo";
  await openDoc(page, doc, ["foo.md", "dir/foo.md", "note.md", "dir/note.MD"]);
  const root = page.locator(`${ROW}[title="foo.md"]`);
  await expect(root).toHaveAttribute("aria-disabled", "true");
  await root.dispatchEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
  expect(await readDocument(page)).toBe(doc);
  await page.locator(`${ROW}[title="dir/foo.md"]`).dispatchEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
  expect(await readDocument(page)).toBe("[[dir/foo.md]]");
});

test("组合期 Enter / 229 不接受、不移动候选、不消费事件", async ({ page }) => {
  const doc = "[[al";
  await openDoc(page, doc);
  const before = await rows(page);
  const result = await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const event = new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 229, which: 229, isComposing: true,
      bubbles: true, cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    return { prevented: event.defaultPrevented, doc: view.state.doc.toString() };
  });
  expect(result).toEqual({ prevented: false, doc });
  expect(await rows(page)).toEqual(before);
  await expect(page.locator(OVERLAY)).toBeVisible();
});

test("三主题壳完全不透明，长路径和同名可辨，边缘与 resize 后不越出视口", async ({ page }) => {
  const long = "deep/a/very/long/directory/that/must/shrink/before/the/file/name.md";
  await openDoc(page, "[[", [long, "a/same.md", "b/same.md"]);
  for (const theme of ["light", "dark", "eink"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.style.setProperty("--editor-font-size", value === "dark" ? "32px" : "16px");
    }, theme);
    await expect(page.locator(OVERLAY)).toBeVisible();
    const reading = await page.locator(OVERLAY).evaluate((overlay) => {
      const rect = overlay.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(overlay).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return { alpha: context.getImageData(0, 0, 1, 1).data[3], left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    expect(reading.alpha).toBe(255);
    expect(reading.left).toBeGreaterThanOrEqual(0);
    expect(reading.right).toBeLessThanOrEqual(reading.width);
    expect(reading.top).toBeGreaterThanOrEqual(0);
    expect(reading.bottom).toBeLessThanOrEqual(reading.height);
  }
  expect(await page.locator(ROW).allTextContents()).toEqual(["source.md", long, "a/same.md", "b/same.md"]);
  await page.setViewportSize({ width: 520, height: 600 });
  await expect.poll(async () => {
    const rect = await page.locator(OVERLAY).boundingBox();
    return rect === null ? Number.POSITIVE_INFINITY : rect.x + rect.width;
  }).toBeLessThanOrEqual(520);
  const rect = await page.locator(OVERLAY).boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(600);
});

let fixtureServer: ViteDevServer;
let fixtureOrigin: string;
test.beforeAll(async () => {
  fixtureServer = await createServer({
    configFile: fileURLToPath(new URL("../fixtures/markdown-parser/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../../../", import.meta.url)),
    server: { port: 0, strictPort: false },
  });
  await fixtureServer.listen();
  fixtureOrigin = fixtureServer.resolvedUrls!.local[0].replace(/\/$/, "");
});
test.afterAll(async () => { await fixtureServer?.close(); });

async function openExperiment(page: Page, doc: string, paths: readonly string[] = ["notes/Alpha.md"], readOnly = false): Promise<void> {
  await page.goto(`${fixtureOrigin}/tests/visual/fixtures/markdown-parser/index.html`);
  await page.waitForFunction(() => !!(window as any).experiment);
  await page.evaluate(({ doc, paths, readOnly }) => {
    const api = (window as any).experiment;
    api.open(doc);
    api.linkSuggest(paths);
    if (readOnly) api.wikilink("unresolved", false);
  }, { doc, paths, readOnly });
  await select(page, doc.length);
}

test("上下文矩阵：代码 / frontmatter / Link / Image / 完整链接 / 只读不触发不接受", async ({ page }) => {
  const docs = [
    "---\ntitle: [[alp\n---\nbody",
    "`[[alp`",
    "```md\n[[alp\n```",
    "    [[alp",
    "[see [[alp](https://example.invalid)",
    "![alt [[alp](image.png)",
    "[[note]]",
    "![[alp",
  ];
  for (const doc of docs) {
    const head = doc.includes("alp") ? doc.indexOf("alp") + 3 : doc.indexOf("note") + 2;
    await openExperiment(page, doc);
    await select(page, head);
    await expect(page.locator(OVERLAY), doc).toHaveCount(0);
    expect(await readDocument(page)).toBe(doc);
    await page.keyboard.press("Enter");
    expect(await readDocument(page)).not.toContain("[[notes/Alpha.md]]");
  }
  await openExperiment(page, "[[alp", ["notes/Alpha.md"], true);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await readDocument(page)).toBe("[[alp");
});

test("compositionend 等 pending flush：同步不刷新不 dispatch，最终 query 只刷新一次", async ({ page }) => {
  const doc = "[[";
  await openExperiment(page, doc, ["notes/Alpha.md", "notes/Beta.md"]);
  await expect(page.locator(OVERLAY)).toBeVisible();
  const before = await rows(page);
  await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const observer = view.observer;
    const dispatch = view.dispatch.bind(view);
    const probe = window.__wikilinkIme = { pending: true, dispatches: 0, mutations: 0 };
    observer.pendingRecords = () => probe.pending ? [{}] : [];
    view.dispatch = (...args: any[]) => { probe.dispatches += 1; return dispatch(...args); };
    new MutationObserver(() => { probe.mutations += 1; }).observe(document.querySelector(".lumir-link-suggest-list")!, { childList: true });
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "Alpha" }));
  });
  expect(await rows(page)).toEqual(before);
  expect(await page.evaluate(() => window.__wikilinkIme.dispatches)).toBe(0);
  const confirmingEnter = await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    return { prevented: event.defaultPrevented, doc: view.state.doc.toString() };
  });
  expect(confirmingEnter).toEqual({ prevented: false, doc });
  expect(await page.evaluate(() => window.__wikilinkIme.dispatches)).toBe(0);
  await page.waitForTimeout(32);
  expect(await rows(page)).toEqual(before);
  expect(await page.evaluate(() => window.__wikilinkIme.dispatches)).toBe(0);

  await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    window.__wikilinkIme.pending = false;
    Object.defineProperty(view, "compositionStarted", { value: false, configurable: true });
    view.dispatch({ changes: { from: 2, insert: "Alpha" }, selection: { anchor: 7 } });
    (window as any).experiment.available();
  });
  await expect(page.locator(ROW)).toHaveCount(1);
  await expect(page.locator(ROW)).toHaveText("notes/Alpha.md");
  expect(await page.evaluate(() => window.__wikilinkIme.mutations)).toBe(1);
  expect(await readDocument(page)).toBe("[[Alpha");
});

declare global {
  interface Window {
    __wikilinkIme: { pending: boolean; dispatches: number; mutations: number };
  }
}
