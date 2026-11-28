import { expect, test, type Page } from "@playwright/test";
import { configApplied, documentWrites, fsMutations, stubTauri, type VaultFixture } from "./tauri-stub";

// change make-no-tab-empty-workspace-nov28：无 Tab 统一为空工作区（chromium 结构层）。
//
// 覆盖矩阵（判据都要有区分度：同一用例里先观测“有文档”的对照面，再观测“无 TAB”）：
//   - 单 pane：开文档有 gutter / 可输入；关掉最后一个标签后无 gutter、结构性只读、
//     键入不落字、⌘S 无写入无提示，焦点落在「Open note…」；打开文档后同帧恢复。
//   - 双 pane：右 pane 空工作区的动作先激活所属 pane；取消 Quick Open 焦点回主操作；
//     打开 b.md 落右 pane、焦点在右 pane 正文；左 pane 不串焦。
//   - 首启 tips：tips 在场时空工作区动作让位，正文结构只读。
//   - 老用户空 vault：统一空工作区（不再有 D107 覆盖层）；「New note」走既有内联命名，
//     进入命名界面本身不创建文件，Escape 取消；harness 与 composer 不受影响。
//
// 像素层由主会话按 `scripts/gate.sh visual` 统一跑；本场景只写结构 / 计算样式断言，不新增
// 整页基线（候选截图落 .local/reviews/no-tab-empty-workspace-nov28/，等 Alex 过目后再决定）。

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

test("单 pane：关闭最后一个标签回到空工作区（不可输入、无 dirty、无保存目标、焦点在主操作）", async ({
  page,
}) => {
  await bootDoc(page, "a.md", { config: { language: "en", line_numbers: "on" } });
  // 对照面：有带路径标签 ⇒ gutter 在场、正文可编辑。
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");

  await page.locator(".tab-close").click();
  await expect(page.locator(".tab-open")).toHaveCount(0);

  const pane = page.locator(".editor-pane").first();
  const surface = pane.locator(".pane-empty-workspace");
  await expect(surface).toBeVisible();
  await expect(surface.locator(".pane-empty-title")).toHaveText("No document open");
  const open = surface.getByRole("button", { name: "Open note…" });
  await expect(open).toBeVisible();
  await expect(surface.getByRole("button", { name: "New note" })).toBeVisible();
  // 正文不是焦点落点：关掉最后一个标签后焦点落在主操作，不落正文 / body。
  await expect(open).toBeFocused();
  await expect(page.locator(".modeline-path")).toHaveText("No file open");
  await expect(page.locator(".editor-notice")).toBeHidden();
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([0]);

  const presentation = await readOnlyPresentation(page, 0);
  expect(presentation.structural, "空工作区前台应带结构只读标记").toBe(true);
  expect(presentation.cursorLayerVisibility, "空工作区 MUST NOT 画插入光标").toBe("hidden");
  expect(presentation.contenteditable).toBe("false");
  expect(presentation.tabindex).toBe("0");
  expect(presentation.ariaReadonly).toBe("true");

  // 焦点在主操作上键入：按键不落进任何文档（不是「正文持焦但按键被吞」）。
  await page.keyboard.type("MUST-NOT-LAND");
  await expect(pane.locator(".cm-content")).toHaveText("");
  await expect(page.locator(".tab-dirty:not([hidden])")).toHaveCount(0);
  // ⌘S 没有保存目标：不写入、不弹「不可保存」提示。
  await page.keyboard.press("Meta+s");
  await expect.poll(async () => documentWrites(page)).toEqual([]);
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
  // ⌥G 的键位作用域是 editor；空工作区的主操作持焦，输入条不打开（正文不是焦点落点）。
  await page.keyboard.press("Alt+g");
  await expect(page.locator(".lumir-goto")).toBeHidden();

  // 即使把焦点以程序方式放进结构性只读正文，输入仍被拒收（双层拒收，不是「焦点不在所以没落字」）。
  await pane.locator(".cm-content").focus();
  await expect(pane.locator(".cm-content")).toBeFocused();
  await page.keyboard.type("ALSO-MUST-NOT-LAND");
  await expect(pane.locator(".cm-content")).toHaveText("");
  await open.focus();
  await expect(open).toBeFocused();

  // 有文档进入后同一同步点恢复：空工作区离场、正文可编辑且持焦。
  await page.locator('.ft-row[title="a.md"]').click();
  await expect(surface).toBeHidden();
  // 树单击的落点是「活跃 pane」，焦点留在树里（既有行为）；正文恢复可编辑即可。
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "true");
  await expect(page.locator(".cm-content")).toContainText("Alpha 正文");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1]);
});

test("双 pane：右 pane 空工作区的动作先激活所属 pane；取消回主操作；打开落右 pane 不串焦", async ({
  page,
}) => {
  await bootDoc(page, "a.md", {
    config: { language: "en", line_numbers: "on", keys: { F2: "pane.split" } },
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press("F2");
  await expect(page.locator(".editor-pane")).toHaveCount(2);

  const left = page.locator(".editor-pane").nth(0);
  const right = page.locator(".editor-pane").nth(1);
  const rightSurface = right.locator(".pane-empty-workspace");
  await expect(rightSurface).toBeVisible();
  await expect(left.locator(".pane-empty-workspace")).toBeHidden();
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 0]);
  const open = rightSurface.getByRole("button", { name: "Open note…" });
  await expect(open).toBeFocused();

  // 左 pane 有文档、右 pane 空：在右 pane 正文位置键入不落字（空工作区承接点击）。
  await right.locator(".pane-empty-title").click();
  await page.keyboard.type("MUST-NOT-LAND");
  await expect(right.locator(".cm-content")).toHaveText("");
  await expect(left.locator(".cm-content")).toContainText("Alpha 正文");

  // 非活跃空 pane 的动作：先激活右 pane，再打开浮层；取消后焦点回右 pane 主操作。
  await open.click();
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(open).toBeFocused();

  // 从右 pane 打开 b.md：落右 pane、焦点在右 pane 正文；左 pane 的文档与焦点不串。
  await open.click();
  const input = page.locator(".lumir-qo-input");
  await expect(input).toBeFocused();
  await input.fill("b.md");
  await page.keyboard.press("Enter");
  await expect(rightSurface).toBeHidden();
  await expect(right.locator(".cm-content")).toContainText("Beta 正文");
  await expect(right.locator(".cm-content")).toBeFocused();
  await expect(left.locator(".cm-content")).toContainText("Alpha 正文");
  await expect(page.locator(".modeline-path")).toHaveText("b.md");
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([1, 1]);
});

test("空工作区：vault 切换器取消后焦点回主操作（不落被覆盖的只读正文）", async ({ page }) => {
  await bootDoc(page, "a.md", { config: { language: "en" } });
  await page.locator(".tab-close").click();
  const open = page.locator(".editor-pane").first().locator(".pane-empty-open");
  await expect(open).toBeFocused();

  await page.keyboard.press("Meta+o");
  await expect(page.locator(".vault-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-pop")).toBeHidden();
  // P2-1：vault 切换器的交还焦点也走统一入口——空工作区主操作，不是被覆盖的只读正文。
  await expect(open).toBeFocused();
  await expect(page.locator(".pane-empty-workspace")).toBeVisible();
  await expect(page.locator(".cm-content")).not.toBeFocused();
});

test("双 pane：vault 切换器取消后焦点回活跃空 pane 的主操作，不串到左 pane", async ({ page }) => {
  await bootDoc(page, "a.md", { config: { language: "en", keys: { F2: "pane.split" } } });
  await page.locator(".cm-content").click();
  await page.keyboard.press("F2");
  await expect(page.locator(".editor-pane")).toHaveCount(2);

  const left = page.locator(".editor-pane").nth(0);
  const right = page.locator(".editor-pane").nth(1);
  const rightOpen = right.locator(".pane-empty-open");
  await expect(rightOpen).toBeFocused();

  // 活跃 pane 是右（空）pane：vault 切换器的 Esc 关闭必须回**这个** pane 的主操作。
  await page.keyboard.press("Meta+o");
  await expect(page.locator(".vault-pop")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".vault-pop")).toBeHidden();
  await expect(rightOpen).toBeFocused();
  await expect(left.locator(".cm-content")).not.toBeFocused();
  await expect(left.locator(".pane-empty-workspace")).toBeHidden();
});

test("首启 tips：收起 harness 再分栏，右 pane 仍是完整空工作区（P2-2）", async ({ page }) => {
  await stubTauri(page, FIRST_RUN_VAULT);
  await page.goto("/");
  await expect(page.locator(".first-run-tips")).toBeVisible();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // 收起默认 harness（⌘⇧A），回到单 doc pane；再分栏（⌥S）。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toHaveCount(0);
  await expect(page.locator(".pane-divider")).toHaveCount(0);
  await page.keyboard.press("Alt+s");
  await expect(page.locator(".editor-pane")).toHaveCount(2);

  const left = page.locator(".editor-pane").nth(0);
  const right = page.locator(".editor-pane").nth(1);
  // tips 只覆盖它的宿主 pane（root）；右 pane 按自身「无标签」显示空工作区与动作。
  await expect(left.locator(".first-run-tips")).toBeVisible();
  await expect(right.locator(".first-run-tips")).toHaveCount(0);
  await expect(left.locator(".pane-empty-workspace")).toBeHidden();
  const rightSurface = right.locator(".pane-empty-workspace");
  await expect(rightSurface).toBeVisible();
  await expect(rightSurface.locator(".pane-empty-title")).toHaveText("No document open");
  await expect(rightSurface.getByRole("button", { name: "Open note…" })).toBeFocused();
  await expect(rightSurface.getByRole("button", { name: "New note" })).toBeVisible();

  // 两侧正文都是结构性只读；右 pane 的键入不落字。
  const leftContent = await readOnlyPresentation(page, 0);
  const rightContent = await readOnlyPresentation(page, 1);
  expect(leftContent.contenteditable).toBe("false");
  expect(rightContent.contenteditable).toBe("false");
  expect(rightContent.structural).toBe(true);
  await page.keyboard.type("MUST-NOT-LAND");
  await expect(right.locator(".cm-content")).toHaveText("");
  await expect(left.locator(".first-run-tips")).toBeVisible();
});

test("首启 tips：空工作区动作让位，正文结构只读、无行号", async ({ page }) => {
  await stubTauri(page, FIRST_RUN_VAULT);
  await page.goto("/");

  const tips = page.locator(".first-run-tips");
  await expect(tips).toBeVisible();
  await expect(tips).toContainText("Get started");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".pane-empty-workspace")).toBeHidden();
  await expect(page.getByRole("button", { name: "Open note…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New note" })).toHaveCount(0);
  await expect(page.locator(".editor-notice")).toBeHidden();
  await expect.poll(() => gutterCountsPerPane(page)).toEqual([0, 0]);

  const presentation = await readOnlyPresentation(page, 0);
  expect(presentation.structural).toBe(true);
  expect(presentation.cursorLayerVisibility).toBe("hidden");
  expect(presentation.contenteditable).toBe("false");

  // 打开首个文档：tips 撤下、空工作区仍隐藏、正文可编辑。
  await page.locator('.ft-row[title="note.md"]').click();
  await expect(tips).toHaveCount(0);
  await expect(page.locator(".pane-empty-workspace").first()).toBeHidden();
  await expect(page.locator(".cm-content").first()).toHaveAttribute("contenteditable", "true");
});

test("老用户空 vault：统一空工作区（无 D107）；新建笔记走既有命名，取消不创建；harness 不受影响", async ({
  page,
}) => {
  await stubTauri(page, EMPTY_VAULT);
  await page.goto("/");
  await expect(page.locator(".ft-vault-name")).toHaveText("empty-vault");

  const surface = page.locator(".editor-pane").first().locator(".pane-empty-workspace");
  await expect(surface).toBeVisible();
  await expect(surface.locator(".pane-empty-title")).toHaveText("No document open");
  await expect(page.locator(".editor-notice")).toBeHidden();
  await expect(page.locator(".ft-vault-name")).toBeVisible();

  // 「New note」进入既有内联命名：输入框预填默认名并持焦，此时磁盘 MUST NOT 出现文件。
  await surface.getByRole("button", { name: "New note" }).click();
  const input = page.locator(".ft-item.is-new .ft-edit");
  await expect(input).toBeFocused();
  expect(await input.inputValue()).toBe("Untitled note");
  expect(await fsMutations(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".ft-item.is-new")).toHaveCount(0);
  expect(await fsMutations(page)).toEqual([]);
  await expect(surface).toBeVisible();

  // 提交合法名字才创建并打开（走既有链路）。
  await surface.getByRole("button", { name: "New note" }).click();
  await page.locator(".ft-item.is-new .ft-edit").fill("first-note");
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => fsMutations(page))
    .toEqual([{ cmd: "fs_create_file", path: "first-note.md" }]);
  await expect(page.locator(".modeline-path")).toHaveText("first-note.md");
  await expect(surface).toBeHidden();

  // 关掉它回到空工作区，再打开 harness：表面仍只覆盖 doc pane，composer 可聚焦可输入。
  await page.locator(".tab-close").click();
  await expect(surface).toBeVisible();
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await expect(composer).toBeVisible();
  await composer.click();
  await expect(composer).toBeFocused();
  await page.keyboard.type("COMPOSER-STILL-TYPABLE");
  await expect(page.locator(".lumir-hp-composer")).toContainText("COMPOSER-STILL-TYPABLE");
  await expect(surface).toBeVisible();
});
