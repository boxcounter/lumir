import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { fileText, stubTauri, type VaultFixture } from "./tauri-stub";

type Status = "resolved" | "ambiguous" | "unresolved";
const STATUSES: Status[] = ["resolved", "ambiguous", "unresolved"];
const ANCHOR_NONE = { status: "none", heading: null, line: null };

interface Reading {
  doc: string;
  anchor: number;
  head: number;
  focused: boolean;
  widgets: number;
  text: string;
  readOnly: boolean;
  structuralReadOnly: boolean;
}

async function reading(page: Page): Promise<Reading> {
  return page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return {
      doc: view.state.doc.toString(),
      anchor: main.anchor,
      head: main.head,
      focused: document.activeElement === view.contentDOM,
      widgets: content.querySelectorAll(".cm-lp-wikilink-resolved, .cm-lp-wikilink-ambiguous, .cm-lp-wikilink-unresolved").length,
      text: content.textContent ?? "",
      readOnly: view.state.readOnly === true,
      structuralReadOnly: view.dom.classList.contains("lumir-structural-readonly"),
    };
  });
}

async function select(page: Page, anchor: number, head = anchor, focus = true): Promise<void> {
  await page.locator(".cm-content").evaluate((content, range) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: range.anchor, head: range.head } });
    if (range.focus) view.focus();
  }, { anchor, head, focus });
}

async function modifiedClick(page: Page, point: { x: number; y: number }, modifier: "Meta" | "Control" | "Shift" | "Alt"): Promise<void> {
  await page.keyboard.down(modifier);
  try {
    await page.mouse.click(point.x, point.y);
  } finally {
    await page.keyboard.up(modifier);
  }
}

async function sourcePoint(page: Page, pos: number): Promise<{ x: number; y: number }> {
  return page.locator(".cm-content").evaluate((content, at) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const rect = view.coordsAtPos(at);
    if (!rect) throw new Error(`源码位置 ${at} 没有可见坐标`);
    return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  }, pos);
}

async function widgetPoint(page: Page, status: Status, ratio: number): Promise<{ x: number; y: number }> {
  return page.locator(`.cm-lp-wikilink-${status}`).first().evaluate((widget, at) => {
    const node = widget.firstChild;
    if (!(node instanceof Text) || !node.textContent) throw new Error("wikilink widget 没有可测文本");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, node.textContent.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width * at, y: rect.top + rect.height / 2 };
  }, ratio);
}

function result(status: Status): Record<string, unknown> {
  return {
    status,
    path: status === "resolved" ? "target.md" : status === "ambiguous" ? "ambiguous.md" : null,
    candidates: status === "ambiguous" ? ["ambiguous.md", "other.md"] : [],
    embed_target: null,
    anchor: ANCHOR_NONE,
  };
}

async function openDoc(
  page: Page,
  raw: string,
  status: Status,
  options: { doc?: string; delayMs?: number } = {},
): Promise<string> {
  const doc = options.doc ?? `AA ${raw} ZZ\n`;
  const vault: VaultFixture = {
    entries: [
      { path: "source.md", kind: "file", size: doc.length, mtime_ms: 0 },
      { path: "target.md", kind: "file", size: 13, mtime_ms: 0 },
      { path: "ambiguous.md", kind: "file", size: 15, mtime_ms: 0 },
      { path: "other.md", kind: "file", size: 0, mtime_ms: 0 },
    ],
    files: {
      "source.md": doc,
      "target.md": "TARGET-OPENED",
      "ambiguous.md": "AMBIGUOUS-OPENED",
      "other.md": "",
    },
    links: { [raw]: result(status) },
    linkGraphDelayMs: options.delayMs,
  };
  await stubTauri(page, vault);
  await page.goto("/");
  await page.locator('.ft-row[title="source.md"]').click();
  if ((options.delayMs ?? 0) > 0) {
    await expect(page.locator(".cm-lp-wikilink-pending")).toBeVisible();
  } else {
    await expect(page.locator(`.cm-lp-wikilink-${status}`)).toBeVisible();
  }
  return doc;
}

async function expectRevealed(page: Page, doc: string, raw: string): Promise<void> {
  const state = await reading(page);
  expect(state.doc).toBe(doc);
  expect(state.widgets).toBe(0);
  expect(state.text).toContain(raw);
}

for (const status of STATUSES) {
  for (const [key, backward] of [["ArrowRight", false], ["Control+f", false], ["ArrowLeft", true], ["Control+b", true]] as const) {
    test(`${status}：${key} 首个内部落点显露，之后逐字符`, async ({ page }) => {
      const raw = status === "ambiguous" ? "[[target|alias]]" : "[[target]]";
      const doc = await openDoc(page, raw, status);
      const from = doc.indexOf(raw);
      const to = from + raw.length;
      await select(page, backward ? to : from);
      await page.keyboard.press(key);
      expect((await reading(page)).head).toBe(backward ? to - 1 : from + 1);
      await expectRevealed(page, doc, raw);
      await page.keyboard.press(key);
      expect((await reading(page)).head).toBe(backward ? to - 2 : from + 2);
      await expectRevealed(page, doc, raw);
    });
  }

  test(`${status}：Shift 扩选触及 span 即显露且不改文档`, async ({ page }) => {
    const raw = "[[target|alias]]";
    const doc = await openDoc(page, raw, status);
    const from = doc.indexOf(raw);
    const to = from + raw.length;
    await select(page, from);
    await page.keyboard.press("ArrowRight");
    await expectRevealed(page, doc, raw);
    await page.keyboard.press("Control+Shift+f");
    expect(await reading(page).then((s) => ({ anchor: s.anchor, head: s.head }))).toEqual({ anchor: from + 1, head: from + 2 });
    await expectRevealed(page, doc, raw);
    await select(page, to);
    await page.keyboard.press("ArrowLeft");
    await expectRevealed(page, doc, raw);
    await page.keyboard.press("Control+Shift+b");
    expect(await reading(page).then((s) => ({ anchor: s.anchor, head: s.head }))).toEqual({ anchor: to - 1, head: to - 2 });
    await expectRevealed(page, doc, raw);
  });

  for (const ratio of [0.1, 0.5, 0.9]) {
    test(`${status}：无修饰点击 widget ${ratio} 只进入源码`, async ({ page }) => {
      const raw = "[[target|alias]]";
      const doc = await openDoc(page, raw, status);
      const from = doc.indexOf(raw);
      const point = await widgetPoint(page, status, ratio);
      await page.mouse.click(point.x, point.y);
      const state = await reading(page);
      expect(state.head).toBeGreaterThanOrEqual(from + 2);
      expect(state.head).toBeLessThanOrEqual(from + raw.length - 2);
      expect(state.anchor).toBe(state.head);
      expect(state.focused).toBe(true);
      await expectRevealed(page, doc, raw);
      expect(await fileText(page, "source.md")).toBe(doc);
    });
  }
}

const FORMS = [
  "[[target]]",
  "[[target|alias]]",
  "[[target#heading]]",
  "[[中文|别名]]",
  "[[é|alias]]",
  "[[👩‍👩‍👧‍👦|alias]]",
];

for (const [index, raw] of FORMS.entries()) {
  test(`span 形态逐字素：${raw}`, async ({ page }) => {
    const doc = await openDoc(page, raw, STATUSES[index % STATUSES.length]);
    const from = doc.indexOf(raw);
    const target = raw.slice(2).split("|")[0].split("#")[0];
    const first = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(target)[Symbol.iterator]().next().value;
    expect(first).toBeDefined();
    await select(page, from + 2);
    await page.keyboard.press("ArrowRight");
    expect((await reading(page)).head).toBe(from + 2 + first!.segment.length);
    await expectRevealed(page, doc, raw);
  });
}

for (const status of STATUSES) {
  test(`pending → ${status}：选区仍在 span 内时不遮回，随后可逐字符编辑`, async ({ page }) => {
    const raw = "[[target|alias]]";
    const doc = await openDoc(page, raw, status, { delayMs: 350 });
    const caret = doc.indexOf(raw) + 5;
    await select(page, caret);
    await page.waitForTimeout(500);
    await expectRevealed(page, doc, raw);
    await page.keyboard.type("X");
    const edited = `${doc.slice(0, caret)}X${doc.slice(caret)}`;
    await expect.poll(async () => (await reading(page)).doc).toBe(edited);
    expect((await reading(page)).head).toBe(caret + 1);
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await reading(page)).doc).toBe(doc);
  });
}

test("首次 drag 只进入源码并保持空光标；点击他处后恢复 widget", async ({ page }) => {
  const raw = "[[target|alias]]";
  const doc = await openDoc(page, raw, "resolved");
  const from = doc.indexOf(raw);
  const start = await widgetPoint(page, "resolved", 0.15);
  const end = await widgetPoint(page, "resolved", 0.85);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  const entered = await reading(page);
  expect(entered.anchor).toBe(entered.head);
  expect(entered.head).toBeGreaterThanOrEqual(from + 2);
  expect(entered.head).toBeLessThanOrEqual(from + raw.length - 2);
  await expectRevealed(page, doc, raw);
  await select(page, doc.length);
  await expect(page.locator(".cm-lp-wikilink-resolved")).toHaveCount(1);
  expect((await reading(page)).doc).toBe(doc);
});

test("切换标签后返回按当前选区重新判定", async ({ page }) => {
  const raw = "[[target|alias]]";
  const doc = await openDoc(page, raw, "resolved");
  const point = await widgetPoint(page, "resolved", 0.5);
  await page.mouse.click(point.x, point.y);
  await expectRevealed(page, doc, raw);
  await select(page, doc.length);
  await expect(page.locator(".cm-lp-wikilink-resolved")).toHaveCount(1);
  await page.locator('.ft-row[title="target.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("target.md");
  await page.locator('.ft-row[title="source.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("source.md");
  await expect(page.locator(".cm-lp-wikilink-resolved")).toHaveCount(1);
  expect((await reading(page)).doc).toBe(doc);
});

const DRAG_CASES = [
  { name: "部分 alias 正向", from: "alias", fromOffset: 1, to: "alias", toOffset: 4 },
  { name: "完整 alias 反向", from: "alias", fromOffset: 5, to: "alias", toOffset: 0 },
  { name: "target-only 正向", from: "target", fromOffset: 0, to: "target", toOffset: 6 },
  { name: "target-only 反向", from: "target", fromOffset: 6, to: "target", toOffset: 0 },
];

for (const c of DRAG_CASES) {
  test(`第二次真实拖选：${c.name}，不外扩定界符`, async ({ page }) => {
    const raw = "[[target|alias]]";
    const doc = await openDoc(page, raw, "resolved");
    const rawFrom = doc.indexOf(raw);
    const point = await widgetPoint(page, "resolved", 0.5);
    await page.mouse.click(point.x, point.y);
    await expectRevealed(page, doc, raw);
    const anchor = doc.indexOf(c.from, rawFrom) + c.fromOffset;
    const head = doc.indexOf(c.to, rawFrom) + c.toOffset;
    const start = await sourcePoint(page, anchor);
    const end = await sourcePoint(page, head);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 16 });
    await page.mouse.up();
    const state = await reading(page);
    expect({ anchor: state.anchor, head: state.head }).toEqual({ anchor, head });
    expect(state.doc.slice(Math.min(anchor, head), Math.max(anchor, head))).not.toContain("[[");
    expect(state.doc.slice(Math.min(anchor, head), Math.max(anchor, head))).not.toContain("]]");
    await expectRevealed(page, doc, raw);
  });
}

async function recordModifierMouse(page: Page): Promise<void> {
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } };
    const view = content.cmTile.root.view;
    const w = window as any;
    w.__wikiModifierMouse = [];
    const record = (event: MouseEvent, phase: string): void => {
      const main = view.state.selection.main;
      w.__wikiModifierMouse.push({
        phase,
        defaultPrevented: event.defaultPrevented,
        anchor: main.anchor,
        head: main.head,
        widgets: view.contentDOM.querySelectorAll(".cm-lp-wikilink-resolved, .cm-lp-wikilink-ambiguous, .cm-lp-wikilink-unresolved").length,
        focused: document.activeElement === view.contentDOM,
      });
    };
    const widget = view.contentDOM.querySelector(".cm-lp-wikilink");
    widget.addEventListener("mousedown", (event: MouseEvent) => record(event, "widget"));
    window.addEventListener("mousedown", (event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".cm-lp-wikilink")) return;
      record(event, "window");
      if (event.ctrlKey && !event.metaKey) setTimeout(() => record(event, "settled"), 50);
    });
  });
}

async function modifierEvents(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as any).__wikiModifierMouse ?? []);
}

for (const status of STATUSES) {
  test(`${status}：Meta 不先进入编辑，沿用原跳转或提示`, async ({ page }) => {
    const raw = "[[target|alias]]";
    const doc = await openDoc(page, raw, status);
    await select(page, 0, 2);
    await recordModifierMouse(page);
    const point = await widgetPoint(page, status, 0.5);
    await modifiedClick(page, point, "Meta");
    if (status === "resolved") await expect(page.locator(".modeline-path")).toHaveText("target.md");
    else if (status === "ambiguous") await expect(page.locator(".modeline-path")).toHaveText("ambiguous.md");
    else await expect(page.locator(".lumir-toast")).toContainText("未创建的链接");
    const events = await modifierEvents(page);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ phase: "widget", defaultPrevented: false, anchor: 0, head: 2, widgets: 1, focused: true });
    expect(events[1]).toMatchObject({ phase: "window", defaultPrevented: true });
    if (status === "unresolved") {
      expect((await reading(page)).doc).toBe(doc);
      expect((await reading(page)).widgets).toBe(1);
    }
  });

  test(`${status}：Ctrl 不进入编辑也不激活链接`, async ({ page }) => {
    const raw = "[[target|alias]]";
    const doc = await openDoc(page, raw, status);
    await select(page, 0, 2);
    await recordModifierMouse(page);
    const point = await widgetPoint(page, status, 0.5);
    await modifiedClick(page, point, "Control");
    await expect.poll(async () => (await modifierEvents(page)).length).toBe(3);
    const events = await modifierEvents(page);
    expect(events[0]).toMatchObject({ phase: "widget", defaultPrevented: false, anchor: 0, head: 2, widgets: 1 });
    expect(events[1]).toMatchObject({ phase: "window", defaultPrevented: false, widgets: 1 });
    expect(events[2]).toMatchObject({ phase: "settled", defaultPrevented: false, widgets: 1 });
    await expect.poll(async () => {
      const state = await reading(page);
      return { anchor: state.anchor, head: state.head };
    }).toEqual({ anchor: events[2].anchor, head: events[2].head });
    const state = await reading(page);
    expect(state.doc).toBe(doc);
    expect(state.widgets).toBe(1);
    await expect(page.locator(".modeline-path")).toHaveText("source.md");
    await expect(page.locator(".lumir-toast")).toHaveCount(0);
  });

  for (const modifier of ["Shift", "Alt"] as const) {
    for (const backward of [false, true]) {
      test(`${status}：${modifier} ${backward ? "反向" : "正向"}既有选区不 collapse、不显露`, async ({ page }) => {
        const raw = "[[target|alias]]";
        const doc = await openDoc(page, raw, status);
        const anchor = backward ? 2 : 0;
        const head = backward ? 0 : 2;
        await select(page, anchor, head);
        await recordModifierMouse(page);
        const point = await widgetPoint(page, status, 0.5);
        await modifiedClick(page, point, modifier);
        const state = await reading(page);
        expect({ anchor: state.anchor, head: state.head }).toEqual({ anchor, head });
        expect(state.doc).toBe(doc);
        expect(state.widgets).toBe(1);
        expect(state.focused).toBe(true);
        const events = await modifierEvents(page);
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ phase: "widget", defaultPrevented: false, anchor, head, widgets: 1, focused: true });
        expect(events[1]).toMatchObject({ phase: "window", defaultPrevented: false });
        await expect(page.locator(".modeline-path")).toHaveText("source.md");
        await expect(page.locator(".lumir-toast")).toHaveCount(0);
      });
    }
  }
}

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

for (const status of STATUSES) {
  test(`${status}：真实 EditorState.readOnly 会话不进入、不改选区或焦点`, async ({ page }) => {
    await page.goto(`${fixtureOrigin}/tests/visual/fixtures/markdown-parser/index.html`);
    await page.waitForFunction(() => !!(window as any).experiment);
    const raw = "[[target|alias]]";
    const doc = `AA ${raw} ZZ\n`;
    await page.evaluate(({ doc, status }) => {
      const api = (window as any).experiment;
      api.open(doc);
      api.wikilink(status, false);
    }, { doc, status });
    await expect(page.locator(`.cm-lp-wikilink-${status}`)).toBeVisible();
    await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
    await select(page, 0, 2, false);
    const before = await reading(page);
    expect(before.readOnly).toBe(true);
    expect(before.structuralReadOnly, "普通只读文档 MUST NOT 被无 TAB 结构只读的呈现标记误伤").toBe(false);
    expect(before.focused).toBe(false);
    await recordModifierMouse(page);
    const point = await widgetPoint(page, status, 0.5);
    await page.mouse.click(point.x, point.y);
    const after = await reading(page);
    expect({ anchor: after.anchor, head: after.head }).toEqual({ anchor: before.anchor, head: before.head });
    expect(after.focused).toBe(before.focused);
    expect(after.doc).toBe(doc);
    expect(after.widgets).toBe(1);
    const events = await modifierEvents(page);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ phase: "widget", defaultPrevented: false, widgets: 1, focused: before.focused });
    expect(events[1]).toMatchObject({ phase: "window", defaultPrevented: false });
  });
}
