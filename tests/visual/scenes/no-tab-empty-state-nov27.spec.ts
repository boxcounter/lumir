import { expect, test, type Page } from "@playwright/test";
import { configApplied, stubTauri, type VaultFixture } from "./tauri-stub";

// change fix-no-tab-empty-state-nov27：无 TAB 空态的呈现修正（chromium 结构层）。
//
// 覆盖矩阵（S1–S5，判据都要有区分度：同一用例里先观测“有文档”的对照面，再观测“无 TAB”：
//   - S5 单 pane scratch：`line_numbers=on` 时打开文档有 gutter；关掉最后标签后**无 gutter**，
//     但 scratch 仍可输入、光标层可见——证明压掉的是行号而不是整个可编辑面。
//   - S4 分栏空 pane：on 档左 pane 有 gutter、右空 pane 无 gutter；右 pane 结构只读
//     （`.lumir-structural-readonly` + 光标层 `visibility:hidden` + contenteditable=false），
//     点击仍激活 pane，键入不落字；打开文档后同帧恢复 gutter / 光标 / 可编辑。
//   - S3 首启 tips：无 gutter、结构只读无光标；tips 与 harness 不同 pane、不盖住 harness。
//   - S2 老用户空 vault：D107 覆盖层收窄在 doc pane，harness 与 composer 可见可输入。
//
// 像素层由主会话按 `scripts/gate.sh visual` 统一跑；本场景只写结构 / 计算样式断言，不新增
// 整页基线（等 Alex 过目后再决定是否入基线）。

const DOC = "# Alpha\n\nAlpha 正文。\n";
const BETA = "# Beta\n\nBeta 正文。\n";

const EMPTY_VAULT: VaultFixture = {
  root: "/Users/alex/empty-vault",
  vault_id: "empty-vault",
  entries: [],
  files: {},
  config: { language: "en" },
};

const FIRST_RUN_VAULT: VaultFixture = {
  root: "/Users/alex/first-run-vault",
  vault_id: "first-run-vault",
  entries: [{ path: "note.md", kind: "file", size: DOC.length, mtime_ms: 1 }],
  files: { "note.md": DOC },
  lastVault: null,
  config: { language: "en", line_numbers: "on" },
};

/** 打开 vault、开好一份文档、等 `[keys]` 覆盖生效（与 m320 同口径）。 */
async function bootDoc(page: Page, path: string, extra: Partial<VaultFixture> = {}): Promise<void> {
  await stubTauri(page, {
    entries: [
      { path: "a.md", kind: "file", size: DOC.length, mtime_ms: 0 },
      { path: "b.md", kind: "file", size: BETA.length, mtime_ms: 0 },
    ],
    files: { "a.md": DOC, "b.md": BETA },
    ...extra,
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(path);
  await configApplied(page);
  await page.waitForTimeout(80);
}

/** 每个 doc pane 的行号 gutter 数量（与 m281 的读数同形，per-pane 判定）。 */
function gutterCountsPerPane(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".editor-pane")].map(
      (pane) => pane.querySelectorAll(".cm-lineNumbers").length,
    ),
  );
}

/** 某个 pane 的结构只读呈现读数：类、光标层计算样式、contenteditable / tabindex。 */
function readOnlyPresentation(page: Page, paneIndex: number): Promise<{
  structural: boolean;
  cursorLayerVisibility: string;
  contenteditable: string | null;
  tabindex: string | null;
  ariaReadonly: string | null;
}> {
  return page.evaluate((index) => {
    const pane = document.querySelectorAll<HTMLElement>(".editor-pane")[index];
    if (pane === undefined) throw new Error(`没有第 ${index} 个 editor-pane`);
    const editor = pane.querySelector<HTMLElement>(".cm-editor");
    const layer = pane.querySelector<HTMLElement>(".cm-cursorLayer");
    const content = pane.querySelector<HTMLElement>(".cm-content");
    return {
      structural: editor?.classList.contains("lumir-structural-readonly") ?? false,
      cursorLayerVisibility: layer === null ? "absent" : getComputedStyle(layer).visibility,
      contenteditable: content?.getAttribute("contenteditable") ?? null,
      tabindex: content?.getAttribute("tabindex") ?? null,
      ariaReadonly: content?.getAttribute("aria-readonly") ?? null,
    };
  }, paneIndex);
}

test("S5 单 pane scratch：on 档关掉最后标签后无 gutter，但 scratch 可输入、光标可见；重开文档恢复", async ({
  page,
}) => {
  await bootDoc(page, "a.md", { config: { line_numbers: "on" } });
  // 对照面：有带路径标签 ⇒ gutter 在场（证明 on 档本身有效）。
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1]);

  await page.locator(".tab-close").click();
  await expect(page.locator(".tab-open")).toHaveCount(0);
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");
  // 核心格：无标签后 on 档也不能出行号。
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([0]);

  // scratch 仍是 M149 的可编辑形态：无结构只读类、光标层可见、键入落字。
  const presentation = await readOnlyPresentation(page, 0);
  expect(presentation.structural, "单 pane scratch MUST NOT 进入结构性只读").toBe(false);
  expect(presentation.cursorLayerVisibility).toBe("visible");
  expect(presentation.contenteditable).not.toBe("false");

  const content = page.locator(".editor-pane .cm-content");
  await content.click();
  await page.keyboard.type("scratch stays editable");
  await expect(content).toContainText("scratch stays editable");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([0]);
  // 撤销回 clean：未命名 dirty 草稿会触发打开守卫（D209），先回到空态再验「有文档恢复」。
  await page.keyboard.press("Meta+z");
  await expect(content).toHaveText("");

  // 有文档恢复：重新打开带路径文件后 gutter 同帧回来。
  await page.locator('.ft-row[title="a.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("a.md");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1]);
});

test("S4 分栏空 pane：无 gutter / 无光标 / 键入无效，但点击可激活；打开文档后同帧恢复", async ({ page }) => {
  await bootDoc(page, "a.md", {
    config: { line_numbers: "on", keys: { F2: "pane.split" } },
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press("F2");
  await expect(page.locator(".editor-pane")).toHaveCount(2);

  const rightPane = page.locator(".editor-pane").nth(1);
  const rightContent = rightPane.locator(".cm-content");
  // 左 pane 有文档 ⇒ gutter；右 pane 空 ⇒ 同一条 on 档判据下也没有 gutter。
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 0]);
  await expect(rightPane.locator(".pane-empty-guide")).toBeVisible();

  const presentation = await readOnlyPresentation(page, 1);
  expect(presentation.structural, "空 pane 前台应带结构只读标记").toBe(true);
  expect(presentation.cursorLayerVisibility, "结构只读前台 MUST NOT 画插入光标").toBe("hidden");
  // 只读必须由可编辑性本身承担；tabindex / aria 照旧（点击可聚焦、读屏可读）。
  expect(presentation.contenteditable).toBe("false");
  expect(presentation.tabindex).toBe("0");
  expect(presentation.ariaReadonly).toBe("true");

  // 点击引导水印 = 点击空 pane 正文：pane 变为活跃，但键入不落字。
  await rightPane.locator(".pane-empty-guide").click();
  await expect(rightContent).toBeFocused();
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");
  await page.keyboard.type("must not land");
  await expect(rightContent).toHaveText("");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 0]);

  // 切回左 pane（有文档、可编辑），再点右 pane，证明活跃切换双向成立。
  await page.locator(".editor-pane").nth(0).locator(".cm-content").click();
  await expect(page.locator(".modeline-path")).toHaveText("a.md");
  await rightPane.locator(".pane-empty-guide").click();
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");

  // 打开带路径文档后：gutter 回来、结构只读标记与光标隐藏同帧撤下、键入落地。
  await page.locator('.ft-row[title="b.md"]').click();
  await expect(rightContent).toContainText("Beta 正文");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 1]);
  const restored = await readOnlyPresentation(page, 1);
  expect(restored.structural).toBe(false);
  expect(restored.cursorLayerVisibility).toBe("visible");
  expect(restored.contenteditable).not.toBe("false");
  await rightContent.click();
  await page.keyboard.type(" recovered");
  await expect(rightContent).toContainText("recovered");
});

test("S3 首启 tips：无 gutter / 无光标；tips 只覆盖 doc pane，不盖 harness", async ({ page }) => {
  await stubTauri(page, FIRST_RUN_VAULT);
  await page.goto("/");

  const tips = page.locator(".first-run-tips");
  await expect(tips).toBeVisible();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 首启 tips 在 root doc pane，harness 是另一个 pane；几何上不重叠。
  const structure = await page.evaluate(() => {
    const tipsEl = document.querySelector<HTMLElement>(".first-run-tips");
    const harness = document.querySelector<HTMLElement>(".lumir-harness");
    const tipsPane = tipsEl?.closest<HTMLElement>(".editor-pane");
    const harnessPane = harness?.closest<HTMLElement>(".editor-pane");
    if (tipsEl === null || harness === null || tipsPane == null || harnessPane == null) {
      throw new Error("tips / harness / pane 缺元素");
    }
    const t = tipsEl.getBoundingClientRect();
    const h = harness.getBoundingClientRect();
    return {
      samePane: tipsPane === harnessPane,
      tipsRight: t.right,
      harnessLeft: h.left,
      docPaneIndex: [...document.querySelectorAll(".editor-pane")].indexOf(tipsPane),
    };
  });
  expect(structure.samePane).toBe(false);
  expect(structure.docPaneIndex).toBe(0);
  expect(structure.tipsRight).toBeLessThanOrEqual(structure.harnessLeft + 1);

  // 无标签 ⇒ on 档也不出行号；tips 前台是结构只读 ⇒ 无光标。
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([0, 0]);
  const presentation = await readOnlyPresentation(page, 0);
  expect(presentation.structural, "首启 tips 前台应带结构只读标记").toBe(true);
  expect(presentation.cursorLayerVisibility).toBe("hidden");
  expect(presentation.contenteditable).toBe("false");
  expect(presentation.tabindex).toBe("0");
});

test("S2 老用户空 vault：D107 覆盖层收窄在 doc pane，harness 与 composer 可见可输入", async ({ page }) => {
  await stubTauri(page, EMPTY_VAULT);
  await page.goto("/");
  const notice = page.locator(".editor-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("No files opened in this vault yet. Create a note to start.");

  // 打开 harness：默认分栏，doc pane 在左、harness 在右。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".pane-divider")).toHaveCount(1);

  const structure = await page.evaluate(() => {
    const noticeEl = document.querySelector<HTMLElement>(".editor-notice");
    const harness = document.querySelector<HTMLElement>(".lumir-harness");
    const noticePane = noticeEl?.closest<HTMLElement>(".editor-pane");
    const harnessPane = harness?.closest<HTMLElement>(".editor-pane");
    if (noticeEl === null || harness === null || noticePane == null || harnessPane == null) {
      throw new Error("notice / harness / pane 缺元素");
    }
    const n = noticeEl.getBoundingClientRect();
    const h = harness.getBoundingClientRect();
    return {
      samePane: noticePane === harnessPane,
      noticeRight: n.right,
      harnessLeft: h.left,
      docPaneIndex: [...document.querySelectorAll(".editor-pane")].indexOf(noticePane),
    };
  });
  expect(structure.samePane, "D107 覆盖层 MUST NOT 挂在 harness pane 上").toBe(false);
  expect(structure.docPaneIndex).toBe(0);
  expect(structure.noticeRight, "覆盖层不得盖住 harness").toBeLessThanOrEqual(structure.harnessLeft + 1);

  // composer 可见、可聚焦、可输入（覆盖层收窄的判据不是「看不见」而是「仍然能用」）。
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await expect(composer).toBeVisible();
  await composer.click();
  await expect(composer).toBeFocused();
  await page.keyboard.type("COMPOSER-STILL-TYPABLE");
  await expect(page.locator(".lumir-hp-composer")).toContainText("COMPOSER-STILL-TYPABLE");
  // 覆盖层仍在（没被输入或分栏误撤），doc pane 的空态引导也仍在。
  await expect(notice).toBeVisible();
});
