import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { fileText, stubTauri, type VaultFixture } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const OVERLAY = ".lumir-link-suggest";
const LIST = ".lumir-link-suggest-list";
const ROW = ".lumir-link-suggest-item";

function fixture(doc: string, paths: readonly string[]): VaultFixture {
  const all = ["source.md", ...paths];
  const directories = new Set<string>();
  for (const path of all) {
    for (let index = 1; index < path.length; index += 1) {
      if (path[index] === "/") directories.add(path.slice(0, index));
    }
  }
  return {
    entries: [
      ...[...directories].map((path) => ({ path, kind: "dir", size: 0, mtime_ms: 0 })),
      ...all.map((path) => ({ path, kind: "file", size: path === "source.md" ? doc.length : 0, mtime_ms: 0 })),
    ],
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

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** 候选的真实可见带与滚动读数：clip = `listRect ∩ viewport` 再扣掉列表自身的边框与 padding，
 *  与 `src/selector-reveal.ts` 的 `revealBand` / `isFullyVisibleWithin` 同一几何。 */
async function suggestGeometry(page: Page) {
  return page.locator(OVERLAY).evaluate((root) => {
    const list = root.querySelector<HTMLElement>(".lumir-link-suggest-list");
    const active = root.querySelector<HTMLElement>(".lumir-link-suggest-item.is-active");
    if (list === null || active === null) throw new Error("候选或活动行不在场");
    const listRect = list.getBoundingClientRect();
    const style = getComputedStyle(list);
    const padTop = Number.parseFloat(style.paddingTop) || 0;
    const padBottom = Number.parseFloat(style.paddingBottom) || 0;
    const scrollportTop = listRect.top + list.clientTop;
    const activeRect = active.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return {
      scrollTop: list.scrollTop,
      maxScroll: list.scrollHeight - list.clientHeight,
      overflowing: list.scrollHeight > list.clientHeight,
      clipTop: Math.max(scrollportTop + padTop, 0),
      clipBottom: Math.min(scrollportTop + list.clientHeight - padBottom, innerHeight),
      activeTop: activeRect.top,
      activeBottom: activeRect.bottom,
      activeText: active.textContent ?? "",
      rootTop: rootRect.top,
      rootBottom: rootRect.bottom,
      viewport: innerHeight,
    };
  });
}

async function scrollSuggestTo(page: Page, top: number) {
  await page.locator(LIST).evaluate((list, value) => { list.scrollTop = value; }, top);
  await settleFrames(page);
  return suggestGeometry(page);
}

/** 重排的机器化边界：只许重写几何样式，不许重建行或改动游标。`styleWrites` 证明重排真的跑过。 */
async function installSuggestProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-link-suggest")!;
    const list = root.querySelector<HTMLElement>(".lumir-link-suggest-list")!;
    const w = window as unknown as Record<string, any>;
    w.__suggestRows = Array.from(list.children);
    w.__suggestChildMutations = 0;
    w.__suggestStyleWrites = 0;
    w.__suggestA11y = {
      activeText: list.querySelector<HTMLElement>(".lumir-link-suggest-item.is-active")?.textContent ?? null,
      activeDescendant: document.querySelector(".cm-content")?.getAttribute("aria-activedescendant") ?? null,
      rowCount: list.children.length,
    };
    w.__suggestObserver = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "childList") w.__suggestChildMutations += 1;
        if (record.type === "attributes" && record.attributeName === "style") w.__suggestStyleWrites += 1;
      }
    });
    w.__suggestObserver.observe(root, { childList: true, attributes: true, attributeFilter: ["style"] });
  });
}

async function readSuggestProbe(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>(".lumir-link-suggest")!;
    const list = root.querySelector<HTMLElement>(".lumir-link-suggest-list")!;
    const w = window as unknown as Record<string, any>;
    const result = {
      childMutations: w.__suggestChildMutations as number,
      styleWrites: w.__suggestStyleWrites as number,
      sameRows: Array.from(list.children).every((node, index) => node === w.__suggestRows[index]),
      a11yBefore: w.__suggestA11y as { activeText: string | null; activeDescendant: string | null; rowCount: number },
      a11y: {
        activeText: list.querySelector<HTMLElement>(".lumir-link-suggest-item.is-active")?.textContent ?? null,
        activeDescendant: document.querySelector(".cm-content")?.getAttribute("aria-activedescendant") ?? null,
        rowCount: list.children.length,
      },
    };
    w.__suggestObserver.disconnect();
    return result;
  });
}

const suggestStyleWrites = (page: Page) =>
  page.evaluate(() => (window as unknown as Record<string, any>).__suggestStyleWrites as number);

test("触发、过滤、方向键 / ⌃NP 与 Enter：完整路径、焦点和 caret 都正确", async ({ page }) => {
  const doc = "[[al";
  await openDoc(page, doc, ["notes/Alpha.md", "notes/alphabet.md", "notes/Beta.md", "notes/readme.markdown"]);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await expect(page.locator(`${OVERLAY}-list`)).toHaveAttribute("aria-label", "筛选");
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
  await select(page, 3);
  await second.dispatchEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
  expect(await readDocument(page)).toBe("[[notes/alphabet.md]]l");
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
  await expect(page.locator(".lumir-link-suggest-empty")).toHaveText("没有匹配的条目");
  await expect(page.locator(ROW)).toHaveCount(0);
  await page.keyboard.press("Enter");
  expect(await readDocument(page)).toBe(`${doc}\n`);
  expect(await fileText(page, "source.md")).toBe(doc);
  expect(await fileText(page, "missing.md")).toBeUndefined();
});

for (const { shape, doc } of [
  { shape: "有候选", doc: "[[al" },
  { shape: "空态", doc: "[[missing" },
] as const) {
  test(`${shape}已打开时 zh → en → zh 即时 relabel，候选状态与磁盘不变`, async ({ page }) => {
    await openDoc(page, doc);
    const list = page.locator(`${OVERLAY}-list`);
    const empty = page.locator(".lumir-link-suggest-empty");
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(list).toHaveAttribute("aria-label", "筛选");

    for (const target of [
      { lang: "en", label: "Filter", noMatch: "No matching items" },
      { lang: "zh-Hans", label: "筛选", noMatch: "没有匹配的条目" },
    ] as const) {
      const before = {
        doc: await readDocument(page),
        disk: await fileText(page, "source.md"),
        caret: await caret(page),
        focused: await focused(page),
        rows: await rows(page),
        active: await page.locator(`${ROW}.is-active`).allTextContents(),
      };
      await page.keyboard.press("Meta+Shift+L");
      await expect(page.locator("html")).toHaveAttribute("lang", target.lang);
      await expect(list).toHaveAttribute("aria-label", target.label);
      await expect(empty).toHaveText(target.noMatch);
      await expect(page.locator(OVERLAY)).toBeVisible();
      expect(await readDocument(page)).toBe(before.doc);
      expect(await fileText(page, "source.md")).toBe(before.disk);
      expect(await caret(page)).toBe(before.caret);
      expect(await focused(page)).toBe(before.focused);
      expect(await rows(page)).toEqual(before.rows);
      expect(await page.locator(`${ROW}.is-active`).allTextContents()).toEqual(before.active);
    }
  });
}

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

for (const signal of [
  { name: "isComposing=true / keyCode=13", isComposing: true, keyCode: 13 },
  { name: "isComposing=false / keyCode=229", isComposing: false, keyCode: 229 },
] as const) {
  for (const key of [
    { key: "Enter", code: "Enter", ctrlKey: false },
    { key: "ArrowDown", code: "ArrowDown", ctrlKey: false },
    { key: "ArrowUp", code: "ArrowUp", ctrlKey: false },
    { key: "n", code: "KeyN", ctrlKey: true },
    { key: "p", code: "KeyP", ctrlKey: true },
  ] as const) {
    test(`组合期 ${signal.name}：${key.key} 不接受、不导航、不消费`, async ({ page }) => {
      const doc = "[[al";
      await openDoc(page, doc);
      const active = page.locator(`${ROW}.is-active`);
      await expect(active).toHaveText("notes/Alpha.md");
      const result = await page.locator(".cm-content").evaluate((content, input) => {
        const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
        const event = new KeyboardEvent("keydown", {
          key: input.key,
          code: input.code,
          keyCode: input.keyCode,
          which: input.keyCode,
          isComposing: input.isComposing,
          ctrlKey: input.ctrlKey,
          bubbles: true,
          cancelable: true,
        });
        view.contentDOM.dispatchEvent(event);
        return {
          prevented: event.defaultPrevented,
          doc: view.state.doc.toString(),
          active: document.querySelector(".lumir-link-suggest-item.is-active")?.textContent ?? null,
        };
      }, { ...key, ...signal });
      expect(result).toEqual({ prevented: false, doc, active: "notes/Alpha.md" });
      expect(await readDocument(page)).toBe(doc);
      await expect(active).toHaveText("notes/Alpha.md");
      await expect(page.locator(OVERLAY)).toBeVisible();
    });
  }
}

test("切标签关闭候选，源文档与磁盘均不变", async ({ page }) => {
  const doc = "[[al";
  await openDoc(page, doc, ["notes/Alpha.md", "notes/alphabet.md"]);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await page.locator('.ft-row[title="notes"]').click();
  await page.locator('.ft-row[title="notes/Alpha.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText(/notes\s*\/\s*Alpha\.md/);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await fileText(page, "source.md")).toBe(doc);
});

test("切 vault 关闭候选，不携带旧查询或浮层", async ({ page }) => {
  const doc = "[[al";
  const initial = fixture(doc, ["notes/Alpha.md", "notes/alphabet.md"]);
  initial.vaults = [
    { id: "first", path: "/Users/alex/demo-vault", name: "first-vault", available: true, last_opened_at: 2, tab_count: 1 },
    { id: "second", path: "/tmp/second-vault", name: "second-vault", available: true, last_opened_at: 1, tab_count: 0 },
  ];
  initial.switchTo = { root: "/tmp/second-vault", ...fixture("other.md", ["other.md"]) };
  await stubTauri(page, initial);
  await page.goto("/");
  await page.locator('.ft-row[title="source.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("source.md");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await select(page, doc.length);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await page.locator(".ft-vault").click();
  const row = page.locator(".vault-row").filter({ has: page.locator(".vault-row-name", { hasText: /^second-vault$/ }) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".ft-vault-name")).toHaveText("second-vault", { timeout: 15_000 });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator('.ft-row[title="other.md"]')).toBeVisible();
});

test("锚点滚出视口关闭候选，文档不变", async ({ page }) => {
  const doc = `[[al\n${" filler\n".repeat(200)}`;
  await openDoc(page, doc);
  await select(page, 4);
  await expect(page.locator(OVERLAY)).toBeVisible();
  await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
  });
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await readDocument(page)).toBe(doc);
  expect(await fileText(page, "source.md")).toBe(doc);
});

test("光标位于视口下缘时浮层向上翻转且不越界", async ({ page }) => {
  const doc = `${" filler\n".repeat(200)}[[al`;
  await openDoc(page, doc);
  await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const head = view.state.selection.main.head;
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    const caret = view.coordsAtPos(head)!;
    view.scrollDOM.scrollTop += caret.bottom - (view.scrollDOM.clientHeight - 24);
    view.scrollDOM.dispatchEvent(new Event("scroll"));
  });
  await expect(page.locator(OVERLAY)).toBeVisible();
  const geometry = await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const caret = view.coordsAtPos(view.state.selection.main.head)!;
    const overlay = document.querySelector(".lumir-link-suggest")!.getBoundingClientRect();
    return { caretTop: caret.top, overlayTop: overlay.top, overlayBottom: overlay.bottom, viewport: innerHeight };
  });
  expect(geometry.overlayBottom).toBeLessThanOrEqual(geometry.caretTop);
  expect(geometry.overlayTop).toBeGreaterThanOrEqual(0);
  expect(geometry.overlayBottom).toBeLessThanOrEqual(geometry.viewport);
  expect(await readDocument(page)).toBe(doc);
});

test("长列表逐项导航：活动行在真实可见带内，滚动位置不被重建归零，编辑器与页面不滚", async ({ page }) => {
  const paths = Array.from({ length: 30 }, (_, index) => `notes/item-${String(index).padStart(2, "0")}.md`);
  await openDoc(page, "[[", paths);
  // fixture 恒带 source.md 自身，故 30 个合成文件 + 1 = 31 条候选
  await expect(page.locator(ROW)).toHaveCount(31);
  const readState = () => page.locator(OVERLAY).evaluate((root) => {
    const list = root.querySelector<HTMLElement>(".lumir-link-suggest-list");
    const active = root.querySelector<HTMLElement>(".lumir-link-suggest-item.is-active");
    if (list === null || active === null) throw new Error("候选或活动行不在场");
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const scroller = document.querySelector<HTMLElement>(".cm-scroller");
    return {
      listScrollTop: list.scrollTop,
      overflowing: list.scrollHeight > list.clientHeight,
      clipTop: Math.max(0, listRect.top),
      clipBottom: Math.min(window.innerHeight, listRect.bottom),
      activeTop: activeRect.top,
      activeBottom: activeRect.bottom,
      editorScrollTop: scroller?.scrollTop ?? 0,
      pageScrollTop: document.scrollingElement?.scrollTop ?? 0,
      activeText: active.textContent ?? "",
    };
  });
  const initial = await readState();
  expect(initial.overflowing, "长列表必须先证明真的溢出，滚动断言才不是空测量").toBe(true);
  expect(initial.activeText).toBe("source.md");
  expect(initial.listScrollTop).toBe(0);
  const editorScroll = initial.editorScrollTop;

  let previousScroll = initial.listScrollTop;
  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press("ArrowDown");
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const state = await readState();
    const detail = JSON.stringify(state);
    expect(state.activeTop, `第 ${step} 步活动行上缘越过真实可见带：${detail}`).toBeGreaterThanOrEqual(state.clipTop - 0.5);
    expect(state.activeBottom, `第 ${step} 步活动行下缘越过真实可见带：${detail}`).toBeLessThanOrEqual(state.clipBottom + 0.5);
    expect(state.listScrollTop, `第 ${step} 步向下的滚动位置不得回退（旧实现被清 max-height 归零）`).toBeGreaterThanOrEqual(previousScroll - 0.5);
    expect(state.editorScrollTop, "候选揭示不得滚动编辑器").toBe(editorScroll);
    expect(state.pageScrollTop, "候选揭示不得滚动页面").toBe(0);
    previousScroll = state.listScrollTop;
  }
  expect(previousScroll, "二十步导航必须真实产生滚动").toBeGreaterThan(0);
  const atBottom = await readState();
  expect(atBottom.activeText).toBe("notes/item-19.md");

  for (let step = 0; step < 20; step += 1) {
    await page.keyboard.press("ArrowUp");
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const state = await readState();
    expect(state.activeTop).toBeGreaterThanOrEqual(state.clipTop - 0.5);
    expect(state.activeBottom).toBeLessThanOrEqual(state.clipBottom + 0.5);
    expect(state.listScrollTop, "向上的滚动位置不得回退").toBeLessThanOrEqual(previousScroll + 0.5);
    previousScroll = state.listScrollTop;
  }
  const back = await readState();
  expect(back.activeText).toBe("source.md");
  expect(back.listScrollTop).toBe(0);
  expect(back.editorScrollTop).toBe(editorScroll);
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
    const readGeometry = () => page.locator(OVERLAY).evaluate((overlay) => {
      const rect = overlay.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.fillStyle = getComputedStyle(overlay).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return { alpha: context.getImageData(0, 0, 1, 1).data[3], left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    await expect.poll(async () => (await readGeometry()).bottom).toBeLessThanOrEqual(800);
    const reading = await readGeometry();
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

// ── 几何重排与「主动揭示」分开（selector-contract C2 / C3，与 Skill 候选同一合同）──
// 没有游标变化的重排只许动几何：揭示只在游标改变、或重排前完整可见的活动行被新几何挤出带时发生。
// 用户手动滚开是在读别处，同状态刷新 / 窗口缩放 MUST NOT 把它拉回活动行（旧实现实测弹回 0）。
const MANY_PATHS = Array.from({ length: 30 }, (_, index) => `notes/item-${String(index).padStart(2, "0")}.md`);

async function scrollWikiListAway(page: Page, top: number, fullyAway = true) {
  const away = await scrollSuggestTo(page, top);
  const detail = JSON.stringify(away);
  expect(away.overflowing, `前提：长列表必须真实溢出，滚动断言才不是空测量：${detail}`).toBe(true);
  expect(away.maxScroll, `前提：滚动余量必须容得下手动位置：${detail}`).toBeGreaterThan(top);
  expect(away.scrollTop, `前提：手动滚动必须真的生效（被重排拉回 = 缺陷现场）：${detail}`).toBeCloseTo(top, 0);
  if (fullyAway) expect(away.activeBottom, `前提：活动行必须被滚出可见带：${detail}`).toBeLessThan(away.clipTop);
  return away;
}

test("手动滚开后同状态刷新只重排几何：候选不得弹回高亮项", async ({ page }) => {
  await openDoc(page, "[[", MANY_PATHS);
  await expect(page.locator(ROW)).toHaveCount(31);
  const away = await scrollWikiListAway(page, 140);
  await installSuggestProbe(page);
  // 在 caret 之后插入正文：trigger / 游标 / items 均不变 → 走同状态去重路径，只重排几何。
  const doc = await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x" }, selection: { anchor: head } });
    return view.state.doc.toString();
  });
  expect(doc, "同状态前提：caret 之前的 trigger 文本不得被这次写入改写").toBe("[[x");
  await expect.poll(() => suggestStyleWrites(page), {
    timeout: 3000,
    message: "同状态刷新必须仍重排几何（样式未被重写 = 没重排）",
  }).toBeGreaterThan(0);
  await settleFrames(page);
  const after = await suggestGeometry(page);
  const probe = await readSuggestProbe(page);
  const detail = `${JSON.stringify(away)} => ${JSON.stringify(after)}`;
  expect(Math.abs(after.scrollTop - away.scrollTop),
    `同状态刷新不得改动用户手动滚动的 scrollTop（${detail}）`).toBeLessThanOrEqual(0.5);
  expect(after.activeBottom, `同状态刷新不得把活动行拉回可见带（${detail}）`).toBeLessThan(after.clipTop);
  expect(probe.childMutations, "同状态刷新不得重建候选行").toBe(0);
  expect(probe.sameRows, "同状态刷新必须复用同一批行节点").toBe(true);
  expect(probe.a11y, "同状态重排不得改动游标 / aria-activedescendant").toEqual(probe.a11yBefore);
  expect(probe.a11y.rowCount).toBe(31);
});

test("窗口缩放不得把手动滚开的候选弹回高亮项", async ({ page }) => {
  await openDoc(page, "[[", MANY_PATHS);
  await expect(page.locator(ROW)).toHaveCount(31);
  const away = await scrollWikiListAway(page, 140);
  await installSuggestProbe(page);
  // 只缩宽度：垂直可用空间与 max-height 不变，scrollTop 的合法余量也不变——
  // 这个重排若动 scrollTop，只可能是「顺手揭示」，不是浏览器钳制。
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(() => suggestStyleWrites(page), {
    timeout: 3000,
    message: "窗口缩放后必须重排几何（样式未被重写 = 没重排）",
  }).toBeGreaterThan(0);
  await settleFrames(page);
  const after = await suggestGeometry(page);
  const probe = await readSuggestProbe(page);
  const detail = `${JSON.stringify(away)} => ${JSON.stringify(after)}`;
  expect(after.overflowing, `前提：缩放后列表仍须溢出：${detail}`).toBe(true);
  expect(Math.abs(after.scrollTop - away.scrollTop),
    `窗口缩放不得改动用户手动滚动的 scrollTop（${detail}）`).toBeLessThanOrEqual(0.5);
  expect(after.activeBottom, `窗口缩放不得把活动行拉回可见带（${detail}）`).toBeLessThan(after.clipTop);
  expect(after.rootTop, `缩放后候选盒仍须在视口内：${detail}`).toBeGreaterThanOrEqual(0);
  expect(after.rootBottom, `缩放后候选盒仍须在视口内：${detail}`).toBeLessThanOrEqual(after.viewport);
  expect(probe.childMutations, "缩放重排不得重建候选行").toBe(0);
  expect(probe.sameRows, "缩放重排必须复用同一批行节点").toBe(true);
  expect(probe.a11y, "缩放重排不得改动游标 / aria-activedescendant").toEqual(probe.a11yBefore);
});

test("手动滚开后高亮变化仍按 C3 揭示新活动行", async ({ page }) => {
  await openDoc(page, "[[", MANY_PATHS);
  await expect(page.locator(ROW)).toHaveCount(31);
  const away = await scrollWikiListAway(page, 140);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`${ROW}.is-active`)).toHaveText("notes/item-00.md");
  await settleFrames(page);
  const after = await suggestGeometry(page);
  const detail = `${JSON.stringify(away)} => ${JSON.stringify(after)}`;
  expect(after.activeTop, `游标刚变必须按 C3 揭示（上缘越界）：${detail}`).toBeGreaterThanOrEqual(after.clipTop - 0.5);
  expect(after.activeBottom, `游标刚变必须按 C3 揭示（下缘越界）：${detail}`).toBeLessThanOrEqual(after.clipBottom + 0.5);
  expect(after.scrollTop, `揭示必须朝新活动行移动，而不是留在手动位置：${detail}`).toBeLessThan(away.scrollTop);
});

test("极端 clip 边界：活动行只被裁掉 1px 也属于「原本不可见」，重排不得拉回", async ({ page }) => {
  await openDoc(page, "[[", MANY_PATHS);
  await expect(page.locator(ROW)).toHaveCount(31);
  const away = await scrollWikiListAway(page, 1, false);
  expect(away.activeTop, `前提：活动行上缘须被裁 1px（部分可见 ≠ 完整可见）：${JSON.stringify(away)}`)
    .toBeLessThan(away.clipTop - 0.5);
  expect(away.activeBottom, `前提：活动行仍须部分可见：${JSON.stringify(away)}`).toBeGreaterThan(away.clipTop);
  // 同状态刷新 + 缩放都不许把 1px 的差值「顺手对齐」成 0。
  await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x" }, selection: { anchor: head } });
  });
  await settleFrames(page);
  const refreshed = await suggestGeometry(page);
  expect(refreshed.scrollTop, `1px 部分可见不得被同状态刷新对齐回 0：${JSON.stringify(refreshed)}`).toBeCloseTo(1, 0);
  await page.setViewportSize({ width: 1000, height: 800 });
  await settleFrames(page);
  const resized = await suggestGeometry(page);
  expect(resized.scrollTop, `1px 部分可见不得被缩放对齐回 0：${JSON.stringify(resized)}`).toBeCloseTo(1, 0);
  expect(resized.activeTop).toBeLessThan(resized.clipTop - 0.5);
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

test("原生输入事务矩阵：opener 即开、query 逐拍同步、opener 不完整即关且插件不崩溃", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const paths = ["Alpha.md", "Beta.md", "sigma.md", "source.md"];
  const cases = [
    { name: "普通正文", prefix: "" },
    { name: "列表正文", prefix: "- " },
    { name: "CJK 前缀", prefix: "笔记 " },
    { name: "多行第二行", prefix: "first\n" },
  ];
  for (const { name, prefix } of cases) {
    await openExperiment(page, prefix, paths);
    await page.keyboard.type("[[");
    await expect(page.locator(OVERLAY), `${name}：完整 opener 后打开`).toBeVisible();
    await expect.poll(() => rows(page), { message: `${name}：空 query 使用当前未过滤候选` }).toEqual(paths);

    await page.keyboard.type("s");
    await expect.poll(() => rows(page), { message: `${name}：query=s 不得展示上一代 items` }).toEqual(["sigma.md", "source.md"]);
    await page.keyboard.type("i");
    await expect.poll(() => rows(page), { message: `${name}：query=si 同步收窄` }).toEqual(["sigma.md"]);

    await page.keyboard.press("Backspace");
    await expect.poll(() => rows(page), { message: `${name}：删除 i 后恢复 query=s` }).toEqual(["sigma.md", "source.md"]);
    await page.keyboard.press("Backspace");
    await expect.poll(() => rows(page), { message: `${name}：删除 s 后恢复空 query` }).toEqual(paths);
    await page.keyboard.press("Backspace");
    await expect(page.locator(OVERLAY), `${name}：opener 不完整后关闭`).toHaveCount(0);
    expect(await readDocument(page)).toBe(`${prefix}[`);
  }
  expect(consoleErrors).toEqual([]);
});

test("requestMeasure 读阶段不写候选 DOM，写阶段完成定位", async ({ page }) => {
  await openExperiment(page, "", ["notes/Alpha.md"]);
  await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const probe = window.__wikilinkMeasure = { reads: 0, writes: 0, readMutations: 0 };
    const requestMeasure = view.requestMeasure.bind(view);
    view.requestMeasure = (request: any) => {
      if (request?.read === undefined) return requestMeasure(request);
      return requestMeasure({
        ...request,
        read: (current: any) => {
          const observer = new MutationObserver(() => {});
          observer.observe(document.body, { attributes: true, childList: true, characterData: true, subtree: true });
          const result = request.read(current);
          probe.readMutations += observer.takeRecords().filter((record) => {
            if (record.target === view.contentDOM) return true;
            if (record.target instanceof Element && record.target.closest(".lumir-link-suggest") !== null) return true;
            return [...record.addedNodes, ...record.removedNodes].some((node) =>
              node instanceof Element && (node.matches(".lumir-link-suggest") || node.querySelector(".lumir-link-suggest") !== null));
          }).length;
          observer.disconnect();
          probe.reads += 1;
          return result;
        },
        write: request.write === undefined ? undefined : (...args: any[]) => {
          probe.writes += 1;
          return request.write(...args);
        },
      });
    };
    view.dispatch({ changes: { from: 0, insert: "[[al" }, selection: { anchor: 4 } });
  });
  await expect(page.locator(OVERLAY)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__wikilinkMeasure.reads)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__wikilinkMeasure.readMutations)).toBe(0);
  expect(await page.evaluate(() => window.__wikilinkMeasure.writes)).toBeGreaterThan(0);
  expect(await rows(page)).toEqual(["notes/Alpha.md"]);
});

test("compositionend：DOM 已是最终候选而 state 仍旧，pending flush 前零刷新，flush 后仅刷新一次", async ({ page }) => {
  const doc = "[[";
  await openExperiment(page, doc, ["notes/Alpha.md", "notes/Beta.md"]);
  await expect(page.locator(OVERLAY)).toBeVisible();
  const before = await rows(page);
  const atEnd = await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const observer = view.observer;
    const flush = observer.flush.bind(observer);
    const dispatch = view.dispatch.bind(view);
    const list = document.querySelector(".lumir-link-suggest-list") as HTMLElement;
    const replaceChildren = list.replaceChildren;
    const probe = window.__wikilinkIme = { pending: true, dispatches: 0, refreshes: 0 };
    observer.pendingRecords = () => probe.pending ? [{}] : [];
    observer.flush = () => {
      if (!probe.pending) return flush();
    };
    view.dispatch = (...args: any[]) => {
      probe.dispatches += 1;
      if (!probe.pending) return dispatch(...args);
    };
    list.replaceChildren = (...nodes: Array<Node | string>) => {
      probe.refreshes += 1;
      return replaceChildren.apply(list, nodes);
    };
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    view.contentDOM.textContent = "[[Alpha";
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "Alpha" }));
    return { state: view.state.doc.toString(), dom: view.contentDOM.textContent };
  });
  expect(atEnd).toEqual({ state: doc, dom: "[[Alpha" });
  expect(await rows(page)).toEqual(before);
  expect(await page.evaluate(() => window.__wikilinkIme.dispatches)).toBe(0);
  expect(await page.evaluate(() => window.__wikilinkIme.refreshes)).toBe(0);
  const confirmingEnter = await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true });
    view.contentDOM.dispatchEvent(event);
    return { prevented: event.defaultPrevented, doc: view.state.doc.toString() };
  });
  expect(confirmingEnter).toEqual({ prevented: false, doc });
  await page.waitForTimeout(32);
  expect(await rows(page)).toEqual(before);
  expect(await page.evaluate(() => window.__wikilinkIme.dispatches)).toBe(0);
  expect(await page.evaluate(() => window.__wikilinkIme.refreshes)).toBe(0);

  const flushDispatches = await page.locator(".cm-content").evaluate((content) => {
    const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    window.__wikilinkIme.pending = false;
    Object.defineProperty(view, "compositionStarted", { value: false, configurable: true });
    view.dispatch({ changes: { from: 2, insert: "Alpha" }, selection: { anchor: 7 } });
    return window.__wikilinkIme.dispatches;
  });
  expect(flushDispatches).toBe(1);
  await page.evaluate(() => { (window as any).experiment.available(); });
  await expect(page.locator(ROW)).toHaveCount(1);
  await expect(page.locator(ROW)).toHaveText("notes/Alpha.md");
  expect(await page.evaluate(() => window.__wikilinkIme.refreshes)).toBe(1);
  expect(await readDocument(page)).toBe("[[Alpha");
});

declare global {
  interface Window {
    __wikilinkIme: { pending: boolean; dispatches: number; refreshes: number };
    __wikilinkMeasure: { reads: number; writes: number; readMutations: number };
  }
}
