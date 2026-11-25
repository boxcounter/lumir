import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { fileURLToPath } from "node:url";
import { fileText, stubTauri, type VaultFixture } from "./tauri-stub";
import { readDocument } from "./parity-checks";

const OVERLAY = ".lumir-link-suggest";
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
