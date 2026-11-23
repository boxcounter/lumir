import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 新建文件打开成功后的焦点落点（change focus-created-document-nov23）的**事件序列**回归。
//
// 为什么判据是「事件序列」而不是最终 `activeElement`：
//   1. 所有文档共享同一个 `EditorView/contentDOM`（单 view 模型）。旧实现在会话**激活阶段**
//      默认 `syncActiveDocument` 的 `close()`（`restoreFocus = true`）里把焦点交给「当前前台
//      文档」，随后 `reloadSession` 把同一个 contentDOM 换成新文档——`activeElement` 最终照样
//      是 contentDOM，只断言它会**假绿**。
//   2. 也不能拿「旧文档标记消失 / 空文档文本」当装载完成的分界：会话激活阶段就会清掉旧文档。
//      唯一可信的分界是**目标路径**的 `lumir:source-ready`（`detail.path === 创建路径`，由
//      `reloadSession` 的装载事务与 `normalizeInitialCaret()` 之后发出）。
//
// 因此本场景从提交起同时记录：
//   - 每条 `focusin` 的时间 / 目标 / 当时 `.tab.is-active` 的前台 path / 当时正文是否仍是旧文档
//     （`OLD-UNIQUE-MARKER` 是旧文档**独有**的标记，可区分「同一 contentDOM 里装的是哪份文档」）；
//   - `lumir:source-ready` 的时间与 `detail.path`。
// 判据：分界之前 MUST NOT 有任何 `.cm-content` 获焦；分界之后创建链路给出唯一那次最终聚焦。
// 最终 `activeElement` 与光标 / 几何只作补充判据。
//
// 「装载在途」由 `tauri-stub.ts` 的 `snapshotDelayMs`（`fs_read_snapshot` 按路径延时）造出来，
// 照 `urlTitleDelayMs` 的先例。先造一个必须让它 FAIL 的输入（旧实现 / 只保留 afterLoad
// passive 的临时实现）实测过红，见 `.local/missions/focus-created-document-nov23/`。

const VAULT_ROOT = "/Users/alex/focus-created-document-vault";
const OLD_MARKER = "OLD-UNIQUE-MARKER";
const OLD_DOC = `# 旧文档\n\n${OLD_MARKER}\n`;
const SECOND_DOC = "# 第二篇\n\nSECOND-UNIQUE-MARKER\n";
/** 装载在途窗口：够场景在延迟里打开浮层 / 点树行，又不必把整场拖长。取 3s 而不是贴着
 *  「一次按键要多久」的下限——全量视觉套件跑批时机器上常有别的构建在抢 CPU，贴着下限会在
 *  「浮层还没打开、装载已经完成」时假红。 */
const LOAD_DELAY_MS = 3000;

/** 合成 vault：一篇既有文档（旧文档唯一标记）、一个只用于点选的目录、一个用于负例的目录。 */
const VAULT: VaultFixture = {
  root: VAULT_ROOT,
  entries: [
    { path: "docs", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "docs/old.md", kind: "file", size: OLD_DOC.length, mtime_ms: 0 },
    { path: "docs/second.md", kind: "file", size: SECOND_DOC.length, mtime_ms: 0 },
    { path: "src", kind: "dir", size: 0, mtime_ms: 0 },
  ],
  files: { "docs/old.md": OLD_DOC, "docs/second.md": SECOND_DOC },
  snapshotDelayMs: {
    "docs/note.md": LOAD_DELAY_MS,
    "root-note.md": LOAD_DELAY_MS,
    "note.md": LOAD_DELAY_MS,
  },
};

/** 合成空 vault（M851 的 D107 空态 + 可见「新建笔记」入口）。 */
const EMPTY_VAULT: VaultFixture = {
  root: "/Users/alex/focus-empty-vault",
  vault_id: "focus-empty-vault",
  entries: [],
  files: {},
  snapshotDelayMs: { "note.md": LOAD_DELAY_MS },
};

type FocusRecord = {
  t: number;
  target: string;
  inContent: boolean;
  tabPath: string | null;
  docOld: boolean;
  /** 这次获焦是否紧跟用户手势（mousedown / keydown，窗口 200ms）。 */
  gesture: boolean;
};

/**
 * 装焦点 / 就绪记录器（`addInitScript`，必须在 `goto` 之前调用）。记录器只读 DOM 与
 * CustomEvent，不碰产品状态；`docOld` 读的是同一个 contentDOM 当时的正文，用来区分
 * 「获焦时这一格里装的还是旧文档」。
 *
 * `gesture` 判据的存在理由：go-to-line 的键位作用域是 `editor`（`src/keys.ts`），用户要在
 * 装载期间打开它**必须先自己点进编辑器**——那次获焦是用户手势，不是文档切换抢的。判据因
 * 此是「分界之前没有**非手势**的编辑器获焦」；用户手势那一条同时被单独断言（正向对照，
 * 证明 gesture 标记真的在工作，而不是把一切都吞掉）。
 */
async function installRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    w.__focusLog = [] as unknown[];
    w.__readyLog = [] as unknown[];
    let lastGesture = -Infinity;
    const noteGesture = (): void => {
      lastGesture = performance.now();
    };
    document.addEventListener("mousedown", noteGesture, true);
    document.addEventListener("pointerdown", noteGesture, true);
    document.addEventListener("keydown", noteGesture, true);
    const describe = (el: Element | null): string => {
      if (el === null) return "null";
      const cls = typeof (el as { className?: unknown }).className === "string" ? (el as { className: string }).className : "";
      const tidy = cls.trim().split(/\s+/).filter(Boolean).join(".");
      return `${el.tagName.toLowerCase()}${tidy === "" ? "" : `.${tidy}`}`;
    };
    const snapshot = () => {
      const content = document.querySelector(".cm-content") as
        | (Element & { cmTile?: { root?: { view?: { state?: { doc?: { toString(): string } } } } } })
        | null;
      const doc = content?.cmTile?.root?.view?.state?.doc?.toString() ?? "";
      const active = document.activeElement;
      const now = performance.now();
      (w.__focusLog as unknown[]).push({
        t: now,
        target: describe(active),
        inContent: active instanceof Element && content !== null && content.contains(active),
        tabPath: document.querySelector(".tab.is-active")?.getAttribute("data-path") ?? null,
        docOld: doc.includes("OLD-UNIQUE-MARKER"),
        gesture: now - lastGesture < 200,
      } satisfies FocusRecord);
    };
    document.addEventListener("focusin", snapshot, true);
    window.addEventListener("lumir:source-ready", (event) => {
      const detail = (event as CustomEvent).detail as { path?: string; time?: number } | undefined;
      (w.__readyLog as unknown[]).push({
        t: detail?.time ?? performance.now(),
        path: detail?.path ?? null,
      });
    });
  });
}

function focusLog(page: Page): Promise<FocusRecord[]> {
  return page.evaluate(() => (window as unknown as { __focusLog?: FocusRecord[] }).__focusLog ?? []);
}

function readyTime(page: Page, path: string): Promise<number | null> {
  return page.evaluate((target) => {
    const log = (window as unknown as { __readyLog?: Array<{ t: number; path: string | null }> }).__readyLog ?? [];
    const hit = log.find((row) => row.path === target);
    return hit === undefined ? null : hit.t;
  }, path);
}

/**
 * 装载期间把焦点放进编辑器，模拟「用户自己点进正文」这一次手势（go-to-line 的键位作用域是
 * `editor`，打开它必须先有编辑器焦点）。
 *
 * 为什么不是真实点击：装载期间 `showNotice` 的「正在打开」覆盖层（`.editor-notice`，
 * `inset: 0` + 不透明底色）盖住整个正文区，Playwright 的可操作性等待会一直等到装载完成——
 * 那样就造不出「装载在途打开 goto-line」的现场。合成 mousedown 让记录器按与真实点击同一
 * 判据把随后的获焦标记为手势；应用自己的抢焦不经过 mousedown，仍会被 `gesture: false` 抓住。
 */
async function userClickIntoEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const content = document.querySelector(".cm-content") as HTMLElement;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    content.focus();
  });
}

type EditorState = {
  head: number;
  doc: string;
  scrollTop: number;
  hasFocus: boolean;
  activeInContent: boolean;
};

function editorState(page: Page): Promise<EditorState> {
  return page.evaluate(() => {
    const content = document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: any } };
    };
    const view = content.cmTile.root.view;
    return {
      head: view.state.selection.main.head as number,
      doc: view.state.doc.toString() as string,
      scrollTop: Math.round(view.scrollDOM.scrollTop as number),
      hasFocus: view.hasFocus as boolean,
      activeInContent:
        document.activeElement instanceof Element &&
        (document.querySelector(".cm-content")?.contains(document.activeElement) ?? false),
    };
  });
}

/** 编辑器外框（几何判据 tasks 3.6）：聚焦不得把标签栏 / 编辑器矩形挪动一个像素。 */
function editorRect(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const rect = (document.querySelector(".cm-editor") as HTMLElement).getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
}

/** 让指定路径的 `fs_read_snapshot` 恒定失败（`openFile` 返回 false 的现场）。包在桩的 invoke
 *  外层，只拦这一条路径——与 tree-menu.spec 的 `stubRecovery` 同一手法。 */
async function failSnapshotFor(page: Page, brokenPath: string): Promise<void> {
  await page.addInitScript((broken) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: any) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "fs_read_snapshot" && args.path === broken) {
        throw { code: "fs_not_found", message: `文件不存在：${broken}` };
      }
      return invoke(cmd, args);
    };
  }, brokenPath);
}

async function openOldDoc(page: Page): Promise<void> {
  await page.locator('.ft-row[title="docs"]').click();
  await page.locator('.ft-row[title="docs/old.md"]').click();
  await expect(page.locator(".cm-content")).toContainText(OLD_MARKER);
  await expect(page.locator(".tab.is-active")).toHaveAttribute("data-path", "docs/old.md");
  // 树点击不聚焦编辑器（本 change 的既有语义，也是下面「提交前焦点不在正文」的基线）
  expect((await editorState(page)).activeInContent).toBe(false);
}

async function openRowMenu(page: Page, row: string, item: string): Promise<void> {
  await page.locator(`.ft-row[title="${row}"]`).click({ button: "right" });
  await expect(page.locator(".ft-menu")).toBeVisible();
  await page.locator(".ft-menu .ft-menu-item", { hasText: item }).click();
}

async function beginCreate(page: Page, dir: string): Promise<void> {
  await openRowMenu(page, dir, "新建文件…");
  await expect(page.locator(".ft-item.is-new .ft-edit")).toBeFocused();
}

async function submitInlineCreate(page: Page, name: string): Promise<void> {
  await page.locator(".ft-item.is-new .ft-edit").fill(name);
  await page.keyboard.press("Enter");
}

/**
 * 分界判据：目标路径的 `source-ready` 之前没有任何**非手势**的编辑器获焦，之后才有创建链路
 * 的最终聚焦；每次获焦时正文 MUST NOT 还是旧文档（`docOld === false`）。
 *
 * `gesture` 排除项只对「用户自己点进 / 键入编辑器」成立（go-to-line 的前置动作）；它不是
 * 放宽判据——用户手势那条由各场景单独正向断言（见 goto-line 用例），而**文档切换抢焦**
 * 一定不带手势（`close()` 的 `restoreFocus` 在事件处理器之外同步调用）。
 */
async function expectFocusOnlyAfterSourceReady(
  page: Page,
  createdPath: string,
): Promise<{ contentFocus: FocusRecord[] }> {
  const ready = await readyTime(page, createdPath);
  expect(ready, `目标路径 ${createdPath} 的 lumir:source-ready 必须发生`).not.toBeNull();
  const log = await focusLog(page);
  const inContent = log.filter((row) => row.inContent);
  const appFocus = inContent.filter((row) => !row.gesture);
  const beforeBoundary = appFocus.filter((row) => row.t <= (ready as number));
  expect(
    beforeBoundary,
    `分界（${createdPath} 的 source-ready）之前不得有任何编辑器获焦，实得：${JSON.stringify(beforeBoundary)}`,
  ).toEqual([]);
  expect(appFocus.length, "创建链路最终必须把焦点交给新文档").toBeGreaterThan(0);
  // 补充判据：应用自己给的焦点必须发生在正文已换成新文档之后（`docOld` 是旧文档的**独有**
  // 标记）。用户手势那次不在此列——装载期间用户自己点进旧文档是允许的。
  for (const row of appFocus) {
    expect(
      row.docOld,
      `获焦时正文仍是旧文档（t=${row.t} target=${row.target} tab=${row.tabPath}）`,
    ).toBe(false);
  }
  return { contentFocus: inContent };
}

// ---------------------------------------------------------------------------
// 1）正常路径：新建 → 装载完成 → 焦点落正文首行
// ---------------------------------------------------------------------------

test("目录下新建文件：装载完成后焦点落正文首行，装载期间无编辑器获焦", async ({ page }) => {
  await stubTauri(page, VAULT);
  await installRecorder(page);
  await page.goto("/");
  await openOldDoc(page);
  const rectBefore = await editorRect(page);

  await beginCreate(page, "docs");
  await submitInlineCreate(page, "note.md");

  // 装载在途：新标签还没建出来（读盘在途），焦点先落回 body（内联输入框被撤掉）
  await expect(page.locator('.tab[data-path="docs/note.md"]')).toHaveCount(0);

  await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "docs/note.md");
  await expect.poll(async () => (await editorState(page)).activeInContent).toBe(true);

  const state = await editorState(page);
  expect(state.doc, "新文档是空文件（新建口径）").toBe("");
  expect(state.head, "空文件的正文首行 = 文档起点").toBe(0);
  expect(state.scrollTop, "聚焦不得把视口滚走").toBe(0);
  // 几何判据（tasks 3.6）：聚焦前后编辑器外框逐值不变（标签栏出现 / 撤下以外的布局不动）
  expect(await editorRect(page), "聚焦不得挪动编辑器外框").toEqual(rectBefore);

  // 键入落点（tasks 3.3）：后续按键进入该文档，不落在树 / body
  await page.keyboard.type("FOCUS-MARKER");
  await expect(page.locator(".cm-content")).toContainText("FOCUS-MARKER");

  await expectFocusOnlyAfterSourceReady(page, "docs/note.md");
});

// ---------------------------------------------------------------------------
// 2）装载在途的浮层：被动关闭、分界前无编辑器获焦
// ---------------------------------------------------------------------------

/** 浮层负例在两档主题各跑一次（tasks 3.7）：配色不影响焦点判定，但浮动层的可见性 / 隐藏
 *  路径在深色档下曾出现引擎差异，事件序列因此两支同判。 */
const THEMES = ["light", "dark"] as const;

for (const theme of THEMES) {
  test(`装载中打开 quick-open（${theme}）：浮层被动关闭，分界前无编辑器获焦，最终焦点落新文档`, async ({
    page,
  }) => {
    await stubTauri(page, { ...VAULT, config: { theme } });
    await installRecorder(page);
    await page.goto("/");
    await openOldDoc(page);

    await beginCreate(page, "docs");
    await submitInlineCreate(page, "note.md");
    await expect(page.locator('.tab[data-path="docs/note.md"]')).toHaveCount(0);

    await page.keyboard.press("Meta+p");
    await expect(page.locator(".lumir-qo")).toBeVisible();
    await expect(page.locator(".lumir-qo-input")).toBeFocused();
    await page.keyboard.type("o");

    // 浮层由装载激活阶段的同步点被动关闭；随后创建链路把焦点交给新文档
    await expect(page.locator(".lumir-qo")).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "docs/note.md");
    await expect.poll(async () => (await editorState(page)).activeInContent).toBe(true);
    const state = await editorState(page);
    expect(state.doc).toBe("");
    expect(state.head).toBe(0);
    expect(state.scrollTop).toBe(0);

    await expectFocusOnlyAfterSourceReady(page, "docs/note.md");
  });

  test(`装载中打开 goto-line（${theme}）：被动关闭、分界前无编辑器获焦，最终焦点落新文档`, async ({
    page,
  }) => {
    await stubTauri(page, { ...VAULT, config: { theme } });
    await installRecorder(page);
    await page.goto("/");
    await openOldDoc(page);

    await beginCreate(page, "docs");
    await submitInlineCreate(page, "note.md");
    await expect(page.locator('.tab[data-path="docs/note.md"]')).toHaveCount(0);

    // go-to-line 的键位作用域是 `editor`：用户要打开它得先把焦点放进编辑器（这一次获焦是
    // 用户手势，不是文档切换抢的——分界判据按 gesture 区分，见 `expectFocusOnlyAfterSourceReady`）。
    // 覆盖层挡住真实点击，见 `userClickIntoEditor`。
    await userClickIntoEditor(page);
    await expect.poll(async () => (await editorState(page)).activeInContent).toBe(true);
    await page.keyboard.press("Alt+g");
    await expect(page.locator(".lumir-goto")).toBeVisible();
    await expect(page.locator(".lumir-goto-input")).toBeFocused();

    await expect(page.locator(".lumir-goto")).toBeHidden({ timeout: 10_000 });
    await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "docs/note.md");
    await expect.poll(async () => (await editorState(page)).activeInContent).toBe(true);

    const { contentFocus } = await expectFocusOnlyAfterSourceReady(page, "docs/note.md");
    // 正向对照：用户点进编辑器那一次手势获焦必须在记录里（证明 gesture 标记没有把一切都吞掉）
    expect(
      contentFocus.filter((row) => row.gesture),
      `装载期间用户自己点进编辑器的那次获焦必须被记为手势：${JSON.stringify(contentFocus)}`,
    ).toHaveLength(1);
  });
}

// ---------------------------------------------------------------------------
// 3）仍在场的焦点不被抢（负例）
// ---------------------------------------------------------------------------

test("装载中焦点移到仍在场的树行：装载完成后不拽回新文档", async ({ page }) => {
  await stubTauri(page, VAULT);
  await installRecorder(page);
  await page.goto("/");
  await openOldDoc(page);

  await beginCreate(page, "docs");
  await submitInlineCreate(page, "note.md");

  // 装载在途：把焦点移到仍在场的树行（目录行点击只展开，不打开文档）
  const srcRow = page.locator('.ft-row[title="src"]');
  await srcRow.click();
  await expect(srcRow).toBeFocused();

  await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "docs/note.md");
  await expect(page.locator(".cm-content")).not.toContainText(OLD_MARKER);
  // 判定的那一拍之后仍是树行持焦，编辑器从未获焦
  await page.waitForTimeout(100);
  const state = await editorState(page);
  expect(state.activeInContent, "用户已把焦点移到仍在场的树行，MUST NOT 拽回").toBe(false);
  expect(state.hasFocus, "编辑器不得在装载链路里被聚焦").toBe(false);
  expect(state.head).toBe(0);
  expect(state.scrollTop).toBe(0);
  const inContent = (await focusLog(page)).filter((row) => row.inContent);
  expect(inContent, `编辑器 MUST NOT 在装载链路里获焦，实得：${JSON.stringify(inContent)}`).toEqual([]);
});

test("打开失败（装载读盘报错）：不聚焦、旧文档仍是前台", async ({ page }) => {
  await stubTauri(page, VAULT);
  await failSnapshotFor(page, "docs/broken.md");
  await installRecorder(page);
  await page.goto("/");
  await openOldDoc(page);

  await beginCreate(page, "docs");
  await submitInlineCreate(page, "broken.md");

  // openFile 返回 false：不建标签、失败提示上屏、焦点不进编辑器（旧文档仍是前台）
  await expect(page.locator(".editor-notice")).toBeVisible();
  await expect(page.locator('.tab[data-path="docs/broken.md"]')).toHaveCount(0);
  await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "docs/old.md");
  const state = await editorState(page);
  expect(state.doc, "旧文档内容原样留在前台").toContain(OLD_MARKER);
  expect(state.activeInContent, "打开失败时 MUST NOT 聚焦").toBe(false);
  const inContent = (await focusLog(page)).filter((row) => row.inContent);
  expect(inContent, `打开失败路径不得有任何编辑器获焦：${JSON.stringify(inContent)}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// 4）默认路径不回归：快速打开仍交还编辑器；树点击既有文件不聚焦
// ---------------------------------------------------------------------------

test("快速打开既有文件：浮层关闭后仍把焦点交还编辑器（默认路径回归）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="docs"]').click();
  await expect(page.locator('.ft-row[title="docs/old.md"]')).toBeVisible();

  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
  await page.keyboard.type("second");
  await page.keyboard.press("Enter");

  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("SECOND-UNIQUE-MARKER");
  await expect.poll(async () => (await editorState(page)).activeInContent).toBe(true);
});

test("文件树点击既有文件：焦点不进入编辑器（反向判据）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="docs"]').click();
  await page.locator('.ft-row[title="docs/old.md"]').click();

  await expect(page.locator(".cm-content")).toContainText(OLD_MARKER);
  const state = await editorState(page);
  expect(state.activeInContent, "树点击打开的既有文件 MUST NOT 聚焦编辑器").toBe(false);
});

// ---------------------------------------------------------------------------
// 5）入口覆盖：根级菜单与空 vault 的「新建笔记」走同一条链路
// ---------------------------------------------------------------------------

test("vault 根级菜单新建文件：打开成功后焦点同样落正文首行", async ({ page }) => {
  await stubTauri(page, VAULT);
  await installRecorder(page);
  await page.goto("/");
  await expect(page.locator(".ft-vault-name")).toBeVisible();

  await page.locator(".ft-vault").click({ button: "right" });
  await expect(page.locator(".ft-menu")).toBeVisible();
  await page.locator(".ft-menu .ft-menu-item", { hasText: "新建文件…" }).click();
  await expect(page.locator(".ft-item.is-new .ft-edit")).toBeFocused();
  await submitInlineCreate(page, "root-note.md");

  await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "root-note.md");
  await expect.poll(async () => (await editorState(page)).activeInContent).toBe(true);
  const state = await editorState(page);
  expect(state.head).toBe(0);
  expect(state.scrollTop).toBe(0);
  await expectFocusOnlyAfterSourceReady(page, "root-note.md");
});

test("空 vault「新建笔记」：打开成功后焦点同样落正文首行", async ({ page }) => {
  await stubTauri(page, EMPTY_VAULT);
  await installRecorder(page);
  await page.goto("/");

  const newNote = page.getByRole("button", { name: "新建笔记" });
  await expect(newNote).toBeVisible();
  await newNote.click();
  await expect(page.locator(".ft-item.is-new .ft-edit")).toBeFocused();
  // 无扩展名输入 → 实际落盘名是 note.md（与 M851 的既有口径一致）
  await submitInlineCreate(page, "note");

  await expect(page.locator('.tab.is-active')).toHaveAttribute("data-path", "note.md");
  await expect.poll(async () => (await editorState(page)).activeInContent).toBe(true);
  const state = await editorState(page);
  expect(state.head).toBe(0);
  expect(state.scrollTop).toBe(0);
  await expectFocusOnlyAfterSourceReady(page, "note.md");
});
