import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// change harness-path-link-keep-position-nov23 的浏览器层判据：
//
//   1. **前台裸路径短路**：目标已是活跃 pane 的前台文档、链接不带行号时，点击 MUST NOT 改变
//      `scrollTop`、选区、正文与 dirty、MUST NOT 触发打开 / 同步链路、MUST NOT 清空撤销栈；
//      只给该标签一次 1400ms 的导航高亮（`.tab.is-flash`）。旧实现没有闪烁态，本组在旧实现上必红。
//      **「未触发打开 / 同步链路」的仪器**：① 打开跳转行浮层——`syncActiveDocument` 的第一件事
//      就是收起它（`openFile` 的 existing-foreground 分支与 `openPathAtLine` 的 `open` 都会经
//      `syncActiveDocument`）；② 在标签栏上挂 MutationObserver——`syncActiveDocument` 会经
//      `renderAllTabStrips` 全量重建标签。两条都不成立即证明短路没有走那条链路。
//      **撤销栈**：页面读不到 CM 的 history depth，因此不伪造深度读数——点击前先键入一个字符
//      造真实 dirty 与可撤销编辑，点击后真实 `Meta+z` MUST 撤掉它（重载会清空历史，这条必红）。
//   2. **带行锚保持滚动**：`路径:行号` 仍滚到目标行并给整行高亮，同时闪一次（不得误伤 L1）。
//   3. **后台标签恢复自身位置**：目标在同一 pane 的后台、离开时停在文档中部 → 点击后切过去、
//      恢复它自己的滚动位置（不是篇首），并闪一次。
//   4. **未打开不闪**：新标签本身即反馈；闪烁只用于「已打开、需要告诉你在哪」。
//   5. **焦点留在 composer**：正文与工具卡片的路径按钮各自在按钮级 `mousedown`
//      `preventDefault()`（REVIEW.md「标题栏 preventDefault」条的同族纪律：MUST NOT 挂容器级）。
//   6. **工具卡片同判定**：裸路径已在前台 → 不滚不动只闪；Read 的 `offset` → 滚到落点行、
//      **不产生 `.cm-line-highlight`**（既有禁令）、标签照常闪。
//   7. **闪烁的生命周期**：重复命中重置计时、同一时刻只有一层、全量重建不丢、1.4s 后消退。
//      `TabsHandle.dispose()` 的立即清理与计时器撤销由 `tests/unit/tabs.test.ts` 钉住
//      （含「只摘 class、留状态 / 计时器」的退化实现反证）；`disposePaneHandle` 在
//      editor destroy 前调用 dispose 是装配层接线、由代码审查确认。**本场景不声称**收 pane /
//      `pageerror` 覆盖：pane 上限二且 harness 在场时文档 pane 唯一，右 pane 标签被闪烁命中的
//      现场在现行布局不可达。
//   8. **反向矩阵**：目录链接不闪、不碰编辑器；同名不同目录各开一个标签，闪烁落在实际目标上。
//
// 判据为什么这样写：滚动 / 选区 / 正文读数取自真 CM view（`.cm-content` 的 `cmTile.root.view`，
// 与 m632 / reading-position 同一口径）。**「不重载」不拿 `EditorState` / `Text` 身份冒充**：
// 打开跳转行浮层会安装 md 行号 gutter（一次合法的 compartment 重配，同样换 `EditorState`），
// 身份比较会把合法重配误判成缺陷、又放行「同 Text 的重配」。改用可区分的副作用仪器
// （goto-line 浮层、标签栏 childList 重建）加真实 undo 行为，三者都直接对应合同条款。
// 不覆盖：AX 读不到 `scrollTop` 的真机层（归 `scripts/acceptance/scenarios/221-*` 的
// `recordEditor` + `unchangedSince`）；像素层（闪烁是瞬态，MUST NOT 拍进基线——本场景不含
// 任何截图断言；三主题用计算属性判 `.tab.is-flash` 的底色来源）。

const LONG_LINES: string[] = [];
for (let line = 1; line <= 200; line += 1) {
  if (line === 39) LONG_LINES.push("KEEP-LINE-39-TARGET");
  else if (line === 120) LONG_LINES.push("OFFSET-LINE-120-TARGET");
  else LONG_LINES.push(`long 第 ${line} 行：闪烁验收的填充内容。`);
}
const LONG_DOC = `${LONG_LINES.join("\n")}\n`;
const NOTE_DOC = "# 闪烁验收笔记\n\n给 harness 面板一个前台文档。\n";
const OFFSET_DOC = `${LONG_DOC}`;
const UNOPENED_DOC = "# 未打开的目标\n\n点裸路径时应新开标签，不闪。\n";
const DUP_DOC = "# 同名文件\n\n两个目录下各有一份，不做 alias 去重。\n";

const VAULT: VaultFixture = {
  entries: [
    { path: "harness-note.md", kind: "file", size: NOTE_DOC.length, mtime_ms: 0 },
    { path: "long-note.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
    { path: "offset-note.md", kind: "file", size: OFFSET_DOC.length, mtime_ms: 0 },
    { path: "unopened.md", kind: "file", size: UNOPENED_DOC.length, mtime_ms: 0 },
    { path: "notes", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "notes/dup.md", kind: "file", size: DUP_DOC.length, mtime_ms: 0 },
    { path: "docs", kind: "dir", size: 0, mtime_ms: 0 },
    { path: "docs/dup.md", kind: "file", size: DUP_DOC.length, mtime_ms: 0 },
  ],
  files: {
    "harness-note.md": NOTE_DOC,
    "long-note.md": LONG_DOC,
    "offset-note.md": OFFSET_DOC,
    "unopened.md": UNOPENED_DOC,
    "notes/dup.md": DUP_DOC,
    "docs/dup.md": DUP_DOC,
  },
  links: {},
};

const EMPTY_USAGE = { ctx_pct: 0, cache_pct_session: 0 };
const NOW_S = Math.floor(Date.now() / 1000);

interface PanelOptions {
  body: string;
  /** 工具卡片（`role: "tool"` 的快照记录）；单行轮次保持展开。 */
  tool?: { name: string; summary: string };
  theme?: "light" | "dark" | "eink";
}

/** harness 面板桩：一条 assistant 正文（+ 可选的单张工具卡片）承载本场景的路径形态。 */
async function stubHarness(page: Page, options: PanelOptions): Promise<void> {
  const messages: unknown[] = [
    { role: "assistant", text: options.body, ts: NOW_S - 30 },
  ];
  if (options.tool !== undefined) {
    messages.push({ role: "tool", name: options.tool.name, summary: options.tool.summary, ts: NOW_S - 20 });
  }
  const snapshot = {
    messages,
    usage: EMPTY_USAGE,
    pending_approval: null,
    warn_ctx_pct: 85,
  };
  await page.addInitScript((snap) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
      if (cmd === "harness_state") return JSON.stringify(snap);
      if (cmd === "harness_list_sessions") return [];
      return invoke(cmd, args);
    };
  }, snapshot);
}

async function openPanel(page: Page, options: PanelOptions): Promise<void> {
  await stubTauri(page, options.theme === undefined ? VAULT : { ...VAULT, config: { theme: options.theme } });
  await stubHarness(page, options);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(docContent(page)).toContainText("闪烁验收笔记");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

const docPane = () => '.editor-pane:not(:has(.lumir-harness))';
const docContent = (page: Page) => page.locator(`${docPane()} .cm-content`);

/** 面板正文 / 卡片里按精确可见文本取路径链接。 */
const linkExact = (page: Page, text: string) =>
  page.locator(".lumir-hp-pathlink").filter({ hasText: new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });

const cardLink = (page: Page, text: string) =>
  page.locator(".lumir-hp-tool-row .lumir-hp-pathlink").filter({ hasText: new RegExp(`^${text.replace(/\./g, "\\.")}$`) });

/** 树里打开**另一个**文件：⌘-点击新开标签（change improve-file-open-harness-affordance-nov26
 *  起普通点击 = 当前标签就地打开；本 spec 的用例都以「另一个标签」为前提）。 */
async function openTreeFile(page: Page, path: string): Promise<void> {
  await page.locator(`.ft-row[title="${path}"]`).click({ modifiers: ["Meta"] });
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(path.split("/").pop() as string);
}

/** 真 CM view 的读数：选区、正文、滚动位置。**不读 `EditorState` / `Text` 身份**——
 *  合法的 compartment 重配（如 goto-line 的 gutter）同样替换 state 对象，身份不能区分「重载」
 *  与「合法重配」；不重载由下面 `expectBarePathShortCircuit` 的副作用仪器 + 真实 undo 判。 */
async function editorFacts(page: Page): Promise<{
  selection: { empty: boolean; from: number; to: number; head: number };
  doc: string;
  scrollTop: number;
}> {
  return page.evaluate(() => {
    const host = document.querySelector('.editor-pane:not(:has(.lumir-harness)) .cm-content') as unknown as {
      cmTile: {
        root: {
          view: {
            state: {
              selection: { main: { empty: boolean; from: number; to: number; head: number } };
              doc: { toString(): string };
            };
            scrollDOM: { scrollTop: number };
          };
        };
      };
    };
    const view = host.cmTile.root.view;
    return {
      selection: view.state.selection.main,
      doc: view.state.doc.toString(),
      scrollTop: view.scrollDOM.scrollTop,
    };
  });
}

async function scrollDoc(page: Page, top: number): Promise<void> {
  const read = (): Promise<number> =>
    page.evaluate(() => {
      const host = document.querySelector('.editor-pane:not(:has(.lumir-harness)) .cm-content') as unknown as {
        cmTile: { root: { view: { scrollDOM: { scrollTop: number } } } };
      };
      return host.cmTile.root.view.scrollDOM.scrollTop;
    });
  await page.evaluate((value) => {
    const host = document.querySelector('.editor-pane:not(:has(.lumir-harness)) .cm-content') as unknown as {
      cmTile: { root: { view: { scrollDOM: { scrollTop: number } } } };
    };
    host.cmTile.root.view.scrollDOM.scrollTop = value;
  }, top);
  // CM 会在随后的测量周期里按滚动锚点微调 scrollTop：等到相邻两次读数一致再返回，
  // 否则「点击前」的基线可能抓在调整中途（目录链接用例在整批跑里因此抖过一次）。
  let previous = Number.NaN;
  await expect
    .poll(async () => {
      const current = await read();
      const settled = current === previous;
      previous = current;
      return settled;
    }, { timeout: 3000, intervals: [50] })
    .toBe(true);
  if (top === 0) expect(await read()).toBe(0);
  else expect(await read()).toBeGreaterThan(0);
}

const flashingTabs = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll(".tab.is-flash .tab-name")).map((el) => el.textContent ?? ""),
  );

/** 闪烁是 1.4s 的瞬态：断言「消退」用有界轮询，不固定 sleep 后一次性读。 */
async function expectFlashGone(page: Page): Promise<void> {
  await expect.poll(() => flashingTabs(page), { timeout: 4000 }).toEqual([]);
}

const targetLine = (page: Page, text: string) => page.locator(`${docPane()} .cm-line`, { hasText: text });

function highlightedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".cm-line.cm-line-highlight")).map((el) => el.textContent ?? ""),
  );
}

/** 仪器：记录标签栏的 childList 重建次数与点击前 active 标签的节点身份。
 *  `syncActiveDocument` 会经 `renderAllTabStrips` → `renderTabs` 全量 `replaceChildren`；
 *  短路的实现只改 class，节点与子列表都不该动。 */
async function installTabStripSpy(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __tabSpy?: { node: Element | null; mutations: number; observer: MutationObserver };
    };
    const strip = document.querySelector(".tabstrip");
    if (strip === null) throw new Error("tabstrip missing");
    const observer = new MutationObserver((records) => {
      const entry = w.__tabSpy;
      if (entry === undefined) return;
      for (const record of records) if (record.type === "childList") entry.mutations += 1;
    });
    w.__tabSpy = { node: document.querySelector(".tab.is-active"), mutations: 0, observer };
    observer.observe(strip, { childList: true });
  });
}

async function readTabStripSpy(
  page: Page,
): Promise<{ childListMutations: number; sameActiveTabNode: boolean }> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      __tabSpy?: { node: Element | null; mutations: number; observer: MutationObserver };
    };
    // MutationObserver 的回调在微任务里投递：等一帧再读，别把「尚未投递」当成 0。
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const entry = w.__tabSpy;
    if (entry === undefined) throw new Error("tab spy missing");
    entry.observer.disconnect();
    w.__tabSpy = undefined;
    return {
      childListMutations: entry.mutations,
      sameActiveTabNode: entry.node === document.querySelector(".tab.is-active"),
    };
  });
}

/** 点击前让滚动读数稳定（CM 的滚动锚点在测量周期里微调；goto-line 安装 gutter 也是合法重配）。 */
async function settleScroll(page: Page): Promise<void> {
  let previous = Number.NaN;
  await expect
    .poll(async () => {
      const current = (await editorFacts(page)).scrollTop;
      const settled = current === previous;
      previous = current;
      return settled;
    }, { timeout: 2000, intervals: [50] })
    .toBe(true);
}

/**
 * 前台裸路径短路的整链判据（正文与工具卡片共用同一 `openVaultPath`，两个入口各测一次）：
 *  - 制造真实 dirty + 一条可撤销编辑；
 *  - 打开跳转行浮层（`syncActiveDocument` 的第一件事就是收起它）；
 *  - 点击后仪器全成立：浮层仍在、标签栏无 childList 重建、active 标签节点身份不变；
 *  - scrollTop / 选区 / 正文 / dirty 逐项不变；
 *  - 关掉浮层后真实 `Meta+z` 撤掉点击前的键入（撤销栈未被清空；重载会让这条红）。
 */
async function expectBarePathShortCircuit(
  page: Page,
  click: () => Promise<void>,
  tabName: string,
): Promise<void> {
  const original = await editorFacts(page);

  await docContent(page).click();
  await page.keyboard.type("x");
  await expect(page.locator(".tab.is-active .tab-dirty"), "前置：键入使标签变 dirty").toBeVisible();
  await scrollDoc(page, 400);
  await page.keyboard.press("Alt+g");
  await expect(page.locator(".lumir-goto"), "前置：跳转行浮层打开").toBeVisible();
  await settleScroll(page);
  const before = await editorFacts(page);
  expect(before.scrollTop, "前置：已停在文档中部").toBeGreaterThan(0);
  await installTabStripSpy(page);

  await click();

  expect(await flashingTabs(page), "目标标签立刻闪一次").toEqual([tabName]);
  // 仪器 1：syncActiveDocument 未运行 ⇒ 它不会收起跳转行浮层。
  await expect(page.locator(".lumir-goto"), "同步链路未运行：跳转行浮层不被收起").toBeVisible();
  // 仪器 2：syncActiveDocument 未运行 ⇒ renderAllTabStrips 没有全量重建标签栏。
  const spy = await readTabStripSpy(page);
  expect(spy.childListMutations, "同步链路未运行：标签栏无 childList 重建").toBe(0);
  expect(spy.sameActiveTabNode, "同步链路未运行：active 标签节点未被替换").toBe(true);

  const after = await editorFacts(page);
  expect(after.scrollTop, "scrollTop 逐值不变").toBe(before.scrollTop);
  expect(after.selection, "选区 / caret 逐值不变").toEqual(before.selection);
  expect(after.doc, "正文逐字节不变").toBe(before.doc);
  await expect(page.locator(".tab.is-active .tab-dirty"), "dirty 不变（true→true）").toBeVisible();

  // 真实 undo：撤销栈未被清空（重载会清历史，这条会红）。
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-goto")).toBeHidden();
  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => (await editorFacts(page)).doc, { timeout: 2000 })
    .toBe(original.doc);
  await expect(page.locator(".tab.is-active .tab-dirty"), "undo 后回到 clean").toBeHidden();
}

// ---------------------------------------------------------------------------
// 1. 前台裸路径：不滚、不动选区、不重载，只闪
// ---------------------------------------------------------------------------

test("前台裸路径：不触发打开/同步链路，位置 / 选区 / 正文 / dirty 不变，撤销仍可用", async ({ page }) => {
  await openPanel(page, { body: "前台文档见 long-note.md 的中间部分，点它不该挪视口。" });
  await openTreeFile(page, "long-note.md");

  await expectBarePathShortCircuit(
    page,
    () => linkExact(page, "long-note.md").click(),
    "long-note.md",
  );

  await expectFlashGone(page);
  expect(await flashingTabs(page)).toEqual([]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("long-note.md");
});

test("前台裸路径：焦点留在 harness composer，随后的键入只进 composer", async ({ page }) => {
  await openPanel(page, { body: "前台文档见 long-note.md。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 320);
  await page.locator(".lumir-hp-composer .cm-content").click();
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();
  const before = await editorFacts(page);

  const link = linkExact(page, "long-note.md");
  await link.hover();
  await page.mouse.down();
  // 按下（尚未松开）时焦点 MUST 仍在 composer——按钮级 mousedown.preventDefault() 的判据。
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();
  await page.mouse.up();
  expect(await flashingTabs(page)).toEqual(["long-note.md"]);

  await page.keyboard.type("FOCUS-PROOF");
  await expect(page.locator(".lumir-hp-composer .cm-content")).toContainText("FOCUS-PROOF");
  const after = await editorFacts(page);
  expect(after.doc, "键入只进 composer，不落进正文").toBe(before.doc);
  expect(after.selection).toEqual(before.selection);
  expect(after.scrollTop).toBe(before.scrollTop);
});

test("路径按钮的 Enter 激活仍可用（键盘可达性不回归）", async ({ page }) => {
  await openPanel(page, { body: "前台文档见 long-note.md。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 300);
  const link = linkExact(page, "long-note.md");
  await link.evaluate((el) => (el as HTMLElement).focus());
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await flashingTabs(page)).toEqual(["long-note.md"]);
});

// ---------------------------------------------------------------------------
// 2. 带行锚：仍滚动 + 行高亮，同时闪
// ---------------------------------------------------------------------------

test("行锚链接：仍滚到目标行并高亮，标签同时闪一次", async ({ page }) => {
  await openPanel(page, { body: "定位到 long-note.md:39 看目标行。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 0);

  await linkExact(page, "long-note.md:39").click();

  await expect(targetLine(page, "KEEP-LINE-39-TARGET")).toHaveCount(1);
  await expect(targetLine(page, "KEEP-LINE-39-TARGET")).toBeInViewport();
  await expect
    .poll(() => highlightedTexts(page), { timeout: 3000 })
    .toEqual(["KEEP-LINE-39-TARGET"]);
  expect(await flashingTabs(page), "行锚点击同样闪一次").toEqual(["long-note.md"]);
  const facts = await editorFacts(page);
  expect(facts.scrollTop, "行锚保持既有滚动行为").toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 3. 后台标签：切过去并恢复自身位置，闪一次
// ---------------------------------------------------------------------------

test("后台标签：切到该标签、scrollTop 恢复到离开时的快照（不是篇首），并闪一次", async ({ page }) => {
  await openPanel(page, { body: "后台文档 long-note.md 应恢复它自己的位置。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 420);
  const saved = (await editorFacts(page)).scrollTop;
  expect(saved).toBeGreaterThan(200);

  // 切到另一个标签，让 long-note 成为后台（离开时存快照）。
  await page.locator(".tab .tab-name", { hasText: "harness-note.md" }).click();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("harness-note.md");
  const tabsBefore = await page.locator(".tab").count();

  await linkExact(page, "long-note.md").click();

  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("long-note.md");
  expect(await page.locator(".tab").count(), "标签总数不变（不重复开）").toBe(tabsBefore);
  await expect
    .poll(async () => (await editorFacts(page)).scrollTop, { timeout: 3000 })
    .toBeCloseTo(saved, -1);
  expect(await flashingTabs(page)).toEqual(["long-note.md"]);
});

// ---------------------------------------------------------------------------
// 4. 未打开：新标签打开，不闪
// ---------------------------------------------------------------------------

test("未打开的裸路径：新标签打开并成为前台，MUST NOT 闪", async ({ page }) => {
  await openPanel(page, { body: "还有一个 unopened.md 没打开过。" });
  await expect(page.locator(".tab")).toHaveCount(1);

  await linkExact(page, "unopened.md").click();

  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("unopened.md");
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(docContent(page)).toContainText("未打开的目标");
  expect(await flashingTabs(page), "新标签本身即反馈：不闪").toEqual([]);
  // 打开是异步的：等一拍再判一次，防「迟到的闪烁」。
  await page.waitForTimeout(400);
  expect(await flashingTabs(page)).toEqual([]);
});

// ---------------------------------------------------------------------------
// 5. 工具卡片：同一条判定
// ---------------------------------------------------------------------------

test("工具卡片裸路径（已在前台）：同一短路——无同步链路副作用、位置 / dirty 不变，撤销仍可用", async ({ page }) => {
  await openPanel(page, {
    body: "卡片里也有一条路径。",
    tool: { name: "vault_read", summary: '{"path":"long-note.md"}' },
  });
  await openTreeFile(page, "long-note.md");

  await expectBarePathShortCircuit(
    page,
    () => cardLink(page, "long-note.md").click(),
    "long-note.md",
  );

  await expectFlashGone(page);
});

test("工具卡片 offset：滚到落点行、标签闪、MUST NOT 产生行高亮（既有禁令）", async ({ page }) => {
  await openPanel(page, {
    body: "卡片带 offset。",
    tool: { name: "vault_read", summary: '{"path":"offset-note.md","offset":120}' },
  });
  await openTreeFile(page, "offset-note.md");
  await scrollDoc(page, 0);
  await expect(targetLine(page, "OFFSET-LINE-120-TARGET")).toHaveCount(0);

  await cardLink(page, "offset-note.md").click();

  await expect(targetLine(page, "OFFSET-LINE-120-TARGET")).toHaveCount(1);
  await expect(targetLine(page, "OFFSET-LINE-120-TARGET")).toBeInViewport();
  const facts = await editorFacts(page);
  expect(facts.scrollTop).toBeGreaterThan(0);
  expect(await highlightedTexts(page), "卡片 offset 只落行，不产生行高亮").toEqual([]);
  expect(await flashingTabs(page), "卡片路径同样闪一次").toEqual(["offset-note.md"]);
});

test("工具卡片路径按钮的 mousedown 不夺 composer 焦点；Enter 激活可用", async ({ page }) => {
  await openPanel(page, {
    body: "卡片里也有一条路径。",
    tool: { name: "vault_read", summary: '{"path":"long-note.md"}' },
  });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 300);
  await page.locator(".lumir-hp-composer .cm-content").click();
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();

  const link = cardLink(page, "long-note.md");
  await link.hover();
  await page.mouse.down();
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();
  await page.mouse.up();
  expect(await flashingTabs(page)).toEqual(["long-note.md"]);

  await link.evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Enter");
  expect(await flashingTabs(page), "Enter 激活同样触发闪烁").toEqual(["long-note.md"]);
});

test("工具卡片 offset + 未打开：新标签落行、不闪、无行高亮", async ({ page }) => {
  await openPanel(page, {
    body: "卡片指向一个还没打开的文件。",
    tool: { name: "vault_read", summary: '{"path":"offset-note.md","offset":120}' },
  });
  await expect(page.locator(".tab")).toHaveCount(1);

  await cardLink(page, "offset-note.md").click();

  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("offset-note.md");
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(targetLine(page, "OFFSET-LINE-120-TARGET")).toBeInViewport();
  expect(await highlightedTexts(page), "卡片 offset 不产生行高亮").toEqual([]);
  expect(await flashingTabs(page), "未打开的新标签本身即反馈：不闪").toEqual([]);
  await page.waitForTimeout(400);
  expect(await flashingTabs(page)).toEqual([]);
});

// ---------------------------------------------------------------------------
// 6. 闪烁的生命周期：计时重置 / 单层 / 全量重建
// ---------------------------------------------------------------------------

test("重复命中：重置消退计时、同一时刻只有一层高亮", async ({ page }) => {
  await openPanel(page, { body: "前台文档见 long-note.md。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 300);
  const link = linkExact(page, "long-note.md");

  await link.click();
  await page.waitForTimeout(1000);
  await link.click();
  // 距首次点击已 ~1.0s、距第二次 ~0：若没有重置，首次计时器会在 1.4s 附近清掉。
  await page.waitForTimeout(500);
  expect(await flashingTabs(page), "第二次命中重新起算 1.4s").toEqual(["long-note.md"]);
  await expect(page.locator(".tab.is-flash")).toHaveCount(1);
  await expectFlashGone(page);
});

test("全量重建不丢闪烁态：闪烁期间标签栏重绘，新 DOM 仍带 is-flash 并如期消退", async ({ page }) => {
  await openPanel(page, { body: "前台文档见 long-note.md。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 300);
  await linkExact(page, "long-note.md").click();
  expect(await flashingTabs(page)).toEqual(["long-note.md"]);

  // 触发一次全量重建：点正文把焦点交给编辑器、键入一个字符 → dirty 跃迁 → renderAllTabStrips。
  await docContent(page).click();
  await page.keyboard.type("x");
  await expect(docContent(page)).toContainText("x");
  expect(await flashingTabs(page), "重建后新 DOM 仍带 is-flash").toEqual(["long-note.md"]);

  await expectFlashGone(page);
});

test("闪烁不改变标签几何与标签栏滚动位置", async ({ page }) => {
  await openPanel(page, { body: "前台文档见 long-note.md。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 300);
  const tab = page.locator(".tab.is-active");
  const before = await page.evaluate(() => {
    const el = document.querySelector(".tab.is-active") as HTMLElement;
    const strip = document.querySelector(".tabstrip") as HTMLElement;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollLeft: strip.scrollLeft };
  });

  await linkExact(page, "long-note.md").click();
  expect(await flashingTabs(page)).toEqual(["long-note.md"]);

  const during = await page.evaluate(() => {
    const el = document.querySelector(".tab.is-active") as HTMLElement;
    const strip = document.querySelector(".tabstrip") as HTMLElement;
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollLeft: strip.scrollLeft };
  });
  expect(during).toEqual(before);
});

// ---------------------------------------------------------------------------
// 7. 三主题：底色取 --sel-band，文字色保持原值
// ---------------------------------------------------------------------------

for (const theme of ["light", "dark", "eink"] as const) {
  test(`主题 ${theme}：.tab.is-flash 的底色 = --sel-band 计算值，文字色不变`, async ({ page }) => {
    await openPanel(page, { body: "前台文档见 long-note.md。", theme });
    await openTreeFile(page, "long-note.md");
    await scrollDoc(page, 300);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe(theme);

    const colorBefore = await page.evaluate(() => {
      const el = document.querySelector(".tab.is-active") as HTMLElement;
      return getComputedStyle(el).color;
    });
    await linkExact(page, "long-note.md").click();
    expect(await flashingTabs(page)).toEqual(["long-note.md"]);

    const expected = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.background = "var(--sel-band)";
      document.body.append(probe);
      const value = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return value;
    });
    // `.tab` 的底色有 120ms 过渡：等它走完再判，别把起始色当成实现错误。
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const tab = document.querySelector(".tab.is-flash") as HTMLElement;
            return getComputedStyle(tab).backgroundColor;
          }),
        { timeout: 1200 },
      )
      .toBe(expected);
    const text = await page.evaluate(() => {
      const tab = document.querySelector(".tab.is-flash") as HTMLElement;
      return getComputedStyle(tab).color;
    });
    expect(text, `${theme}：闪烁不改文字色`).toBe(colorBefore);
  });
}

// ---------------------------------------------------------------------------
// 8. 反向矩阵：目录链接不闪；同名不同目录各开一个标签
// ---------------------------------------------------------------------------

test("目录链接：不闪、不碰编辑器视口与标签，左栏照旧定位", async ({ page }) => {
  await openPanel(page, { body: "目录见 notes/ 下的内容。" });
  await openTreeFile(page, "long-note.md");
  await scrollDoc(page, 300);
  const before = await editorFacts(page);
  const tabsBefore = await page.locator(".tab").count();
  const activeBefore = await page.locator(".tab.is-active .tab-name").textContent();

  await linkExact(page, "notes/").click();

  expect(await flashingTabs(page), "目录链接 MUST NOT 闪标签").toEqual([]);
  const after = await editorFacts(page);
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(after.selection).toEqual(before.selection);
  expect(after.doc).toBe(before.doc);
  expect(await page.locator(".tab").count()).toBe(tabsBefore);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(activeBefore as string);
});

test("同名不同目录：各开一个标签（不做 alias 去重），闪烁落在实际目标的标签上", async ({ page }) => {
  await openPanel(page, { body: "两份同名文件：docs/dup.md 与 notes/dup.md。" });
  await page.locator('.ft-row[title="docs"]').click();
  await openTreeFile(page, "docs/dup.md");
  // 另一个同名路径先打开（未打开 ⇒ 新标签、不闪）。
  await linkExact(page, "notes/dup.md").click();
  await expect(page.locator(".tab")).toHaveCount(3);
  expect(await page.locator(".tab-name", { hasText: "dup.md" })).toHaveCount(2);
  expect(await flashingTabs(page)).toEqual([]);

  // 再点已打开的那一条（它此刻在后台）→ 切过去并闪它。
  await linkExact(page, "docs/dup.md").click();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("dup.md");
  expect(await page.locator(".tab")).toHaveCount(3);
  expect(await flashingTabs(page)).toEqual(["dup.md"]);
  // 闪烁落在那一条的标签上：标签栏里只有一个 dup.md 在闪，且它带 data-path = docs/dup.md。
  const flashingPath = await page.evaluate(() =>
    (document.querySelector(".tab.is-flash") as HTMLElement | null)?.dataset.path,
  );
  expect(flashingPath).toBe("docs/dup.md");
});
