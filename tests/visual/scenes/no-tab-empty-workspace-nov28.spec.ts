import { expect, test, type Locator, type Page } from "@playwright/test";
import { configApplied, documentWrites, fsMutations, stubTauri, type VaultFixture } from "./tauri-stub";

// change make-no-tab-empty-workspace-nov28 / Alex 2026-11-28 空态重设计合同（chromium 结构层）。
//
// 同一组四条 Lumir 特有 tips 同时服务首启、普通无 Tab、空 vault 与双 pane；布局可按 pane 容量
// 退让，但内容 / 顺序 / 语义不变。空态没有 Open / New 按钮、通用快捷键或右键新建提示，也没有
// 正文焦点 / 输入。焦点由静态 region（tabindex=-1）承接；被覆盖的 cm-editor 必须 inert，既不进
// Tab 序，也不能被程序聚焦或进入读屏树。候选截图只落 .local/reviews，不在这里新增像素基线。

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

const FEATURES = {
  en: [
    ["outline", "Outline", "Jump between headings in the current document."],
    ["quote", "Quote to chat", "Send selected text to a conversation, with its source attached."],
    ["wikilink", "Knowledge links", "Connect related notes without leaving the editor."],
    ["harness", "Harness pane", "Keep an AI working session beside your notes."],
  ],
  zh: [
    ["outline", "大纲", "按标题浏览并跳转到当前文档的章节。"],
    ["quote", "摘录到对话", "选中文本，连同来源一起送入对话。"],
    ["wikilink", "知识链接", "在编辑器里连接相关笔记，让上下文彼此可达。"],
    ["harness", "Harness 面板", "在笔记旁运行 AI 工作会话。"],
  ],
} as const;

const GENERIC_COPY = [
  "Quick open a file",
  "Find in the current file",
  "Switch or add a vault",
  "Settings",
  "press ⌘/ for all shortcuts",
  "Right-click the vault name",
  "快速打开文件",
  "文件内查找",
  "切换或新增 vault",
  "设置",
  "默认键位",
  "查看全部",
  "右键左栏 vault 名",
  "⌘P",
  "⌘F",
  "⌘,",
];

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

function gutterCountsPerPane(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".editor-pane")].map(
      (pane) => pane.querySelectorAll(".cm-lineNumbers").length,
    ),
  );
}

async function expectEditorIsolated(pane: Locator): Promise<void> {
  const editor = pane.locator(".cm-editor");
  const content = pane.locator(".cm-content");
  await expect(editor).toHaveJSProperty("inert", true);
  await expect(content).toHaveAttribute("contenteditable", "false");
  await expect(content).toHaveAttribute("aria-readonly", "true");
  await expect(pane.locator(".cm-cursorLayer")).toHaveCSS("visibility", "hidden");
  await content.evaluate((el) => el.focus());
  await expect(content).not.toBeFocused();
}

async function expectWorkspaceTips(surface: Locator, language: "en" | "zh" = "en"): Promise<void> {
  const regionName = language === "en" ? "Get started" : "开始使用";
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute("role", "region");
  await expect(surface).toHaveAttribute("tabindex", "-1");
  await expect(surface).toHaveAccessibleName(regionName);
  await expect(surface.locator("h2")).toHaveText(language === "en" ? "Get started" : "开始使用");
  const items = surface.locator(".workspace-tips-item");
  await expect(items).toHaveCount(4);
  const identities = await items.evaluateAll((rows) =>
    rows.map((row) => (row as HTMLElement).dataset.tip ?? null),
  );
  expect(identities).toEqual(FEATURES[language].map(([id]) => id));
  for (const [index, [, title, description]] of FEATURES[language].entries()) {
    const item = items.nth(index);
    await expect(item.locator(".workspace-tips-label")).toHaveText(title);
    await expect(item.locator(".workspace-tips-description")).toHaveText(description);
  }
  await expect(surface.locator("button, input, textarea, [contenteditable='true']")).toHaveCount(0);
  for (const forbidden of GENERIC_COPY) {
    await expect(surface, `通用提示不得回流：${forbidden}`).not.toContainText(forbidden);
  }
  await expect(surface.getByRole("button", { name: /Open note|New note|打开笔记|新建笔记/ })).toHaveCount(0);

  const semantics = await surface.ariaSnapshot();
  expect(semantics).toContain(`region "${regionName}"`);
  expect(semantics).toContain("list");
  expect(semantics.match(/listitem/g) ?? []).toHaveLength(4);
}

async function expectNoHorizontalOverflow(surface: Locator): Promise<void> {
  const geometry = await surface.evaluate((el) => {
    const root = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll<HTMLElement>(".workspace-tips-item")].map((row) => {
      const box = row.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    });
    return {
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      root: { left: root.left, right: root.right, top: root.top, bottom: root.bottom },
      rows,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.rows).toHaveLength(4);
  for (const row of geometry.rows) {
    expect(row.left).toBeGreaterThanOrEqual(geometry.root.left - 1);
    expect(row.right).toBeLessThanOrEqual(geometry.root.right + 1);
    expect(row.top).toBeGreaterThanOrEqual(geometry.root.top - 1);
    expect(row.bottom).toBeLessThanOrEqual(geometry.root.bottom + 1);
  }
}

test("单 pane：关闭最后标签后只显示共享 tips；无按钮、无通用提示、无正文焦点或输入", async ({ page }) => {
  await bootDoc(page, "a.md", { config: { language: "en", line_numbers: "on" } });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await page.locator(".tab-close").click();
  await expect(page.locator(".tab-open")).toHaveCount(0);

  const pane = page.locator(".editor-pane").first();
  const surface = pane.locator(".pane-empty-workspace");
  await expectWorkspaceTips(surface);
  await expect(surface).toBeFocused();
  await expect(page.locator(".modeline-path")).toHaveText("No file open");
  await expect(page.locator(".editor-notice")).toBeHidden();
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([0]);
  await expectEditorIsolated(pane);

  await page.keyboard.type("MUST-NOT-LAND");
  await expect(pane.locator(".cm-content")).toHaveText("");
  await expect(page.locator(".tab-dirty:not([hidden])")).toHaveCount(0);
  await page.keyboard.press("Meta+s");
  await expect.poll(async () => documentWrites(page)).toEqual([]);
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
  await page.keyboard.press("Alt+g");
  await expect(page.locator(".lumir-goto")).toBeHidden();
  await expect(surface).toBeFocused();

  await page.locator('.ft-row[title="a.md"]').click();
  await expect(surface).toBeHidden();
  await expect(pane.locator(".cm-editor")).toHaveJSProperty("inert", false);
  await expect(pane.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await expect(pane.locator(".cm-content")).toContainText("Alpha 正文");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1]);
});

test("双 pane：同一 tips 按容量退让；Quick Open 取消回静态 region，打开后不串 pane", async ({ page }) => {
  await bootDoc(page, "a.md", {
    config: { language: "en", line_numbers: "on", keys: { F2: "pane.split" } },
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press("F2");
  await expect(page.locator(".editor-pane")).toHaveCount(2);

  const left = page.locator(".editor-pane").nth(0);
  const right = page.locator(".editor-pane").nth(1);
  const surface = right.locator(".pane-empty-workspace");
  await expectWorkspaceTips(surface);
  await expect(surface).toBeFocused();
  await expect(left.locator(".pane-empty-workspace")).toBeHidden();
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 0]);
  await expectEditorIsolated(right);

  await page.setViewportSize({ width: 700, height: 760 });
  await expectNoHorizontalOverflow(surface);
  await surface.click({ position: { x: 12, y: 12 } });
  await expect(surface).toBeFocused();
  await page.keyboard.type("MUST-NOT-LAND");
  await expect(right.locator(".cm-content")).toHaveText("");
  await expect(left.locator(".cm-content")).toContainText("Alpha 正文");

  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(surface).toBeFocused();
  await expect(surface).toHaveCSS("outline-width", "1px");
  await expect(surface).toHaveCSS("outline-style", "solid");

  await page.keyboard.press("Meta+p");
  const input = page.locator(".lumir-qo-input");
  await expect(input).toBeFocused();
  await input.fill("b.md");
  await page.keyboard.press("Enter");
  await expect(surface).toBeHidden();
  await expect(right.locator(".cm-content")).toContainText("Beta 正文");
  await expect(right.locator(".cm-content")).toBeFocused();
  await expect(left.locator(".cm-content")).toContainText("Alpha 正文");
  await expect(page.locator(".modeline-path")).toHaveText("b.md");
});

for (const mode of ["vault", "split"] as const) {
  test(`空工作区：${mode} 浮层取消后焦点回静态 region，不落 inert 正文`, async ({ page }) => {
    await bootDoc(page, "a.md", {
      config: { language: "en", ...(mode === "split" ? { keys: { F2: "pane.split" } } : {}) },
    });
    if (mode === "split") {
      await page.locator(".cm-content").click();
      await page.keyboard.press("F2");
    } else {
      await page.locator(".tab-close").click();
    }
    const pane = mode === "split" ? page.locator(".editor-pane").nth(1) : page.locator(".editor-pane").first();
    const surface = pane.locator(".pane-empty-workspace");
    await expect(surface).toBeFocused();
    await page.keyboard.press("Meta+o");
    await expect(page.locator(".vault-pop")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".vault-pop")).toBeHidden();
    await expect(surface).toBeFocused();
    await expect(pane.locator(".cm-content")).not.toBeFocused();
  });
}

test("首启与普通空态共用同一内容和语义；双 pane 各自隔离正文", async ({ page }) => {
  await stubTauri(page, FIRST_RUN_VAULT);
  await page.goto("/");
  const rootSurface = page.locator(".editor-pane").first().locator(".workspace-tips:not(.pane-empty-workspace)");
  await expectWorkspaceTips(rootSurface);
  await expect(rootSurface).toBeFocused();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".pane-empty-workspace")).toBeHidden();
  await expectEditorIsolated(page.locator(".editor-pane").first());

  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toHaveCount(0);
  await page.keyboard.press("Alt+s");
  await expect(page.locator(".editor-pane")).toHaveCount(2);
  const left = page.locator(".editor-pane").nth(0);
  const right = page.locator(".editor-pane").nth(1);
  const leftTips = left.locator(".workspace-tips:not(.pane-empty-workspace)");
  const rightTips = right.locator(".pane-empty-workspace");
  await expectWorkspaceTips(leftTips);
  await expectWorkspaceTips(rightTips);
  await expect(rightTips).toBeFocused();
  await expectEditorIsolated(left);
  await expectEditorIsolated(right);

  const sharedText = async (locator: Locator) =>
    locator.locator(".workspace-tips-item").evaluateAll((rows) =>
      rows.map((row) => ({
        id: (row as HTMLElement).dataset.tip,
        text: row.textContent?.replace(/\s+/g, " ").trim(),
      })),
    );
  expect(await sharedText(rightTips)).toEqual(await sharedText(leftTips));
  await page.keyboard.type("MUST-NOT-LAND");
  await expect(right.locator(".cm-content")).toHaveText("");
  await expect(left.locator(".first-run-tips, .pane-empty-title, .pane-empty-open, .pane-empty-new")).toHaveCount(0);
});

for (const theme of ["light", "dark", "eink"] as const) {
  for (const language of ["en", "zh"] as const) {
    test(`空态内容矩阵（${theme} / ${language}）：四条完整、窄窗无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width: 640, height: 720 });
      await stubTauri(page, { ...EMPTY_VAULT, config: { language, theme } });
      await page.goto("/");
      const surface = page.locator(".pane-empty-workspace");
      await expectWorkspaceTips(surface, language);
      await expectNoHorizontalOverflow(surface);
      await expect(page.locator("html")).toHaveAttribute("lang", language === "zh" ? "zh-Hans" : "en");
    });
  }
}

test("老用户空 vault：右键新建仍走既有链路，tips 不堆新建提示；harness 输入不受影响", async ({ page }) => {
  await stubTauri(page, EMPTY_VAULT);
  await page.goto("/");
  await expect(page.locator(".ft-vault-name")).toHaveText("empty-vault");
  const surface = page.locator(".pane-empty-workspace");
  await expectWorkspaceTips(surface);
  await expect(page.locator(".editor-notice")).toBeHidden();

  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "New file" }).click();
  const input = page.locator(".ft-item.is-new .ft-edit");
  await expect(input).toBeFocused();
  expect(await input.inputValue()).toBe("Untitled note");
  expect(await fsMutations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
  expect(await fsMutations(page)).toEqual([]);

  await page.locator(".ft-vault").click({ button: "right" });
  await page.locator(".ft-menu-item", { hasText: "New file" }).click();
  await page.locator(".ft-item.is-new .ft-edit").fill("first-note");
  await page.keyboard.press("Enter");
  await expect.poll(async () => fsMutations(page)).toEqual([
    { cmd: "fs_create_file", path: "first-note.md" },
  ]);
  await expect(page.locator(".modeline-path")).toHaveText("first-note.md");
  await expect(surface).toBeHidden();

  await page.locator(".tab-close").click();
  await expect(surface).toBeVisible();
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await composer.click();
  await expect(composer).toBeFocused();
  await page.keyboard.type("COMPOSER-STILL-TYPABLE");
  await expect(page.locator(".lumir-hp-composer")).toContainText("COMPOSER-STILL-TYPABLE");
  await expect(surface).toBeVisible();
});
