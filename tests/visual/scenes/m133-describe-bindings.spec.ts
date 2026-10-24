import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { COMMAND_IDS, KEYLESS_COMMAND_IDS } from "../../../src/keys";
import { configApplied, fireMenuCommand, stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 键位速查面板（change improve-keybindings-lookup-oct24；前身 M133 的查看器）。
//
// 守四组口径：
//   ① 内容模型：一条命令一行、多键合并、人类标签 / scope / when 徽标、未绑定命令仍在；
//   ② 双向查找：文本查询（标签 / 别名 / id，来由不进语料）与按键捕获（键不执行命令）；
//   ③ 键盘全程：Tab 四停、PageUp/Down 真滚动、Home/End、Esc 分层、焦点交还编辑器；
//   ④ 生效表：配置重绑 / 解绑后按生效表渲染，详情承载原始 token / 命令 id / 来由。
//
// 像素基线：行模型变化让旧的整页基线失效——基线更新是**人肉裁决点**（AGENTS.md / tasks 4.3），
// 本场景只保留一个既有名字的截图，更新前先给 Alex 过目，不在场景里 --update。

const DOC = "# 标题\n\n内容段落。\n";

const GROUPS = ["移动与选择", "扩选", "删除", "kill-yank", "翻屏", "撤销", "列表缩进", "块", "widget", "标签", "全局"];

/** 装载 vault 并等配置到位（[keys] 覆盖在 config_get 之后才挂上分发器）。 */
async function openVault(
  page: Page,
  config?: { keys?: Record<string, string | null>; theme?: "light" | "dark" | "eink" },
): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "keys.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "keys.md": DOC },
    config,
  });
  await page.goto("/");
  await page.locator('.ft-row[title="keys.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("keys.md");
  await configApplied(page);
  await page.waitForTimeout(80);
}

interface ViewHandle {
  dispatch(tr: unknown): void;
  focus(): void;
  state: { selection: { main: { head: number } } };
}

async function focusEditor(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewHandle } } })
      .cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

async function cursorHead(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewHandle } } }).cmTile.root
        .view.state.selection.main.head,
  );
}

const panel = (page: Page) => page.locator(".lumir-bindings-panel");
const rows = (page: Page) => page.locator(".lumir-bindings-row");
const input = (page: Page) => page.locator(".lumir-bindings-input");

async function openPanel(page: Page): Promise<void> {
  await page.keyboard.press("Meta+/");
  await expect(panel(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

function rowOf(page: Page, command: string) {
  return page.locator(`.lumir-bindings-row[data-command="${command}"]`);
}

test("⌘/ 打开面板：一条命令一行、多键合并、label / scope / when 徽标齐全", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  // 分组：11 组覆盖全部命令，无兜底「其他」；组序沿用 BINDING_GROUPS。
  await expect(page.locator(".lumir-bindings-title")).toHaveText("键位速查（生效中）");
  expect(await page.locator(".lumir-bindings-group-name").allTextContents()).toEqual(GROUPS);

  // 行模型：每条命令恰一行（不是一条绑定一行）；未绑定命令仍在视野里。
  await expect(rows(page)).toHaveCount(COMMAND_IDS.length);
  await expect(page.locator(".lumir-bindings-row.is-unbound")).toHaveCount(KEYLESS_COMMAND_IDS.length);
  for (const command of COMMAND_IDS) {
    await expect(rowOf(page, command)).toHaveCount(1);
  }

  // 人类标签 + 字形 + scope（⌃D 归文本面，标签是「删除后一个字符」而不是 doc 来由）。
  const removeChar = rowOf(page, "editor.delete-char-forward");
  await expect(removeChar.locator(".lumir-bindings-label")).toHaveText("删除后一个字符");
  await expect(removeChar.locator(".lumir-bindings-key")).toHaveText("⌃D");
  await expect(removeChar.locator(".lumir-bindings-scope-badge")).toHaveText("文本");
  await expect(removeChar.locator(".lumir-bindings-when")).toHaveCount(0);

  // 带 when 的真实绑定：Home → editor.widget-scroll-home；行内是短徽标，不是函数或截断。
  const widgetHome = rowOf(page, "editor.widget-scroll-home");
  await expect(widgetHome.locator(".lumir-bindings-label")).toHaveText("块滚动到开头");
  await expect(widgetHome.locator(".lumir-bindings-key")).toHaveText("Home");
  await expect(widgetHome.locator(".lumir-bindings-scope-badge")).toHaveText("编辑器");
  await expect(widgetHome.locator(".lumir-bindings-when")).toHaveText("仅块滚动");

  // 多键合并：撤销的 ⌘Z / ⌃/ / ⌃_ 在同一行，键位区不拆行。
  const undo = rowOf(page, "editor.undo");
  await expect(undo).toHaveCount(1);
  expect(await undo.locator(".lumir-bindings-key").allTextContents()).toEqual(["⌘Z", "⌃/", "⌃⇧-"]);
  const nextTab = rowOf(page, "tab.next");
  expect(await nextTab.locator(".lumir-bindings-key").allTextContents()).toEqual(["⌃⇥", "⇧⌘]", "⇧⌘."]);

  // 面板自己的键位也在表里（⌘/ 由生效表驱动，不是面板的旁路）。
  const panelRow = rowOf(page, "app.describe-bindings");
  await expect(panelRow.locator(".lumir-bindings-label")).toHaveText("键位速查");
  await expect(panelRow.locator(".lumir-bindings-key")).toHaveText("⌘/");

  await expectScreenshot(page.locator(".lumir-bindings-overlay"), "describe-bindings-panel.png");
});

test("文本查询：标签 / 别名 / id 都命中，来由零命中，空态与清除可用", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  await input(page).fill("大纲");
  await expect(rows(page)).toHaveCount(1);
  await expect(rowOf(page, "toc.toggle")).toBeVisible();
  await expect(rowOf(page, "toc.toggle").locator(".lumir-bindings-key")).toHaveText("⇧⌘O");
  await expect(page.locator(".lumir-bindings-count")).toHaveText(`命中 1 / ${COMMAND_IDS.length}`);
  expect(await page.locator(".lumir-bindings-body").evaluate((el) => el.scrollTop)).toBe(0);

  // 来由里的 mission 编号 / 「已删除」不进语料：M447 零命中，删除不误命中 toc.toggle。
  await input(page).fill("M447");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.locator(".lumir-bindings-empty-title")).toHaveText("没有匹配的命令");
  await expect(page.locator(".lumir-bindings-empty-query")).toHaveText("M447");

  await input(page).fill("删除");
  await expect(rowOf(page, "toc.toggle")).toHaveCount(0);
  await expect(rowOf(page, "editor.delete-char-forward")).toBeVisible();

  // 别名（含空格的自然短语）与大小写折叠。
  await input(page).fill("select all");
  await expect(rows(page)).toHaveCount(1);
  await expect(rowOf(page, "editor.select-all")).toBeVisible();
  await input(page).fill("OUTLINE");
  await expect(rowOf(page, "toc.toggle")).toBeVisible();

  // 空态动作钮把查询清掉（不是只换行不换计数）。
  await input(page).fill("NOPE");
  await page.locator(".lumir-bindings-empty-action", { hasText: "清除查询" }).click();
  await expect(rows(page)).toHaveCount(COMMAND_IDS.length);
  await expect(input(page)).toHaveValue("");
  await expect(input(page)).toBeFocused();
});

test("按键捕获：定位真实 when 绑定、被捕获的键不执行命令、Esc 只取消捕获", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length - 1);
  const beforeDoc = await readDocument(page);
  const beforeCursor = await cursorHead(page);
  await openPanel(page);

  await page.locator(".lumir-bindings-capture").click();
  await expect(input(page)).toHaveAttribute("readonly", "");
  await expect(page.locator(".lumir-bindings-capture-state")).toContainText("按下组合键");

  await page.keyboard.press("Home");
  await expect(page.locator(".lumir-bindings-capture-state")).toContainText("已捕获");
  await expect(page.locator(".lumir-bindings-capture-state")).toContainText("Home");
  await expect(rows(page)).toHaveCount(1);
  const captured = rowOf(page, "editor.widget-scroll-home");
  await expect(captured).toBeVisible();
  await expect(captured.locator(".lumir-bindings-scope-badge")).toHaveText("编辑器");
  await expect(captured.locator(".lumir-bindings-when")).toHaveText("仅块滚动");
  await expect(page.locator(".lumir-bindings-count")).toHaveText("按键 Home · 命中 1");

  // 详情承载 when 全文 / 原始 token / 命令 id / 来由。
  await page.keyboard.press("Enter");
  const detail = page.locator(".lumir-bindings-detail");
  await expect(detail).toContainText("仅在块级横滚容器自身持有焦点时生效");
  await expect(detail).toContainText("editor.widget-scroll-home");
  await expect(detail).toContainText("Home");
  await expect(detail).toContainText("容器焦点内的 Home");

  // Esc 只清除捕获，面板保持打开；文档与光标逐字节不变（捕获路径真的消费了按键）。
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".lumir-bindings-capture-state")).toBeHidden();
  await expect(rows(page)).toHaveCount(COMMAND_IDS.length);
  expect(await readDocument(page)).toBe(beforeDoc);
  expect(await cursorHead(page)).toBe(beforeCursor);

  // 等待态 ⌃G 被当作待查询的键（唯一的关闭例外）：面板不关，捕获结果指向 keyboard-quit。
  await page.locator(".lumir-bindings-capture").click();
  await page.keyboard.press("Control+g");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".lumir-bindings-captured-glyph")).toHaveText("⌃G");
  await expect(rowOf(page, "editor.keyboard-quit")).toBeVisible();
  await page.keyboard.press("Escape");

  // ⌘/ 同样能被反查（不触发面板命令本身）。
  await page.locator(".lumir-bindings-capture").click();
  await page.keyboard.press("Meta+/");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".lumir-bindings-captured-glyph")).toHaveText("⌘/");
  await expect(rowOf(page, "app.describe-bindings")).toBeVisible();
  await page.keyboard.press("Escape");

  // 无绑定的 token 给「没有命令使用这个键位」空态。
  await page.locator(".lumir-bindings-capture").click();
  await page.keyboard.press("F12");
  await expect(page.locator(".lumir-bindings-empty-title")).toHaveText("没有命令使用这个键位");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("键盘全程：Tab 四停、方向键 / Enter / PageDown / Home-End、Esc 分层、焦点交还", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  // Tab 四停：输入框 → 捕获按钮 → 作用域选中项 → 列表 → 回输入框；Shift+Tab 反向。
  await page.keyboard.press("Tab");
  await expect(page.locator(".lumir-bindings-capture")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".lumir-bindings-scope-button.is-selected")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".lumir-bindings-body")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".lumir-bindings-body")).toBeFocused();

  // PageDown 真的滚动列表（不是只移动焦点）；End / Home 落首末行。
  const scrollTop = () => page.locator(".lumir-bindings-body").evaluate((el) => el.scrollTop);
  expect(await scrollTop()).toBe(0);
  await page.keyboard.press("PageDown");
  await expect.poll(scrollTop).toBeGreaterThan(0);
  await page.keyboard.press("End");
  await expect(page.locator(".lumir-bindings-row.is-active")).toHaveAttribute("data-command", "pane.close");
  await page.keyboard.press("Home");
  await expect(page.locator(".lumir-bindings-row.is-active")).toHaveAttribute("data-command", "editor.cursor-up");

  // 方向键移动活动行；Enter 展开行内详情（一次只开一个）。
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".lumir-bindings-row.is-active")).toHaveAttribute("data-command", "editor.cursor-down");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-bindings-detail")).toHaveCount(1);
  await expect(page.locator(".lumir-bindings-detail")).toContainText("命令 id");
  await expect(page.locator(".lumir-bindings-detail")).toContainText("来由");

  // ← 折叠活动行所在组，焦点落到组头；→ 在组头上重新展开。
  await page.keyboard.press("ArrowLeft");
  const collapsedHeader = page.locator(".lumir-bindings-group-title").first();
  await expect(collapsedHeader).toHaveAttribute("aria-expanded", "false");
  await expect(collapsedHeader).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(collapsedHeader).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".lumir-bindings-body")).toBeFocused();

  // Esc 分层：有查询 → 清查询（面板保持）；再按 → 关闭并把焦点交还编辑器。
  await page.keyboard.press("Tab");
  await expect(input(page)).toBeFocused();
  await input(page).fill("撤");
  await page.keyboard.press("Escape");
  await expect(input(page)).toHaveValue("");
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  expect(
    await page.evaluate(() => document.querySelector(".cm-content")?.contains(document.activeElement) ?? false),
  ).toBe(true);
});

test("作用域筛选：单选、即时、计数分母随筛选变化", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  await page.locator(".lumir-bindings-scope-button", { hasText: "全局" }).click();
  await expect(rows(page)).toHaveCount(33); // NON_TAB_GLOBAL 21 + TAB 12
  await expect(page.locator(".lumir-bindings-count")).toHaveText("33 条命令 · 2 组");
  for (const badge of await page.locator(".lumir-bindings-scope-badge").allTextContents()) {
    expect(badge).toBe("全局");
  }

  // 编辑器档 +「滚动」：分母是筛选后的 16，不是全量 71。
  await page.locator(".lumir-bindings-scope-button", { hasText: "编辑器" }).click();
  await input(page).fill("滚动");
  await expect(page.locator(".lumir-bindings-count")).toHaveText("命中 6 / 16");
  await expect(rows(page)).toHaveCount(6);

  // 文本档为空查询时按 22 条命令计数（4 组：移动与选择 / 扩选 / 删除 / kill-yank）；
  // 回到全部恢复全量。
  await input(page).fill("");
  await page.locator(".lumir-bindings-scope-button", { hasText: "文本" }).click();
  await expect(page.locator(".lumir-bindings-count")).toHaveText("22 条命令 · 4 组");
  await page.locator(".lumir-bindings-scope-button", { hasText: "全部" }).click();
  await expect(rows(page)).toHaveCount(COMMAND_IDS.length);
});

test("折叠：空查询折叠在清查询后恢复，过滤态的临时折叠随查询变化清空", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  const first = page.locator(".lumir-bindings-group-title").first();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(rowOf(page, "editor.cursor-up")).toBeHidden();
  await first.click();
  await expect(rowOf(page, "editor.cursor-up")).toBeVisible();

  // 空查询下折叠第一组，再输入查询：匹配组自动展开（旧折叠不把命中藏掉）。
  await first.click();
  await input(page).fill("大纲");
  await expect(rowOf(page, "toc.toggle")).toBeVisible();
  // 过滤态的手动折叠是临时的：折叠命中组后再改查询，折叠被清空、命中仍可见。
  await page.locator(".lumir-bindings-group-title").last().click();
  await expect(rowOf(page, "toc.toggle")).toBeHidden();
  await input(page).fill("删除");
  await expect(rowOf(page, "editor.delete-char-forward")).toBeVisible();
  // 清查询后恢复的是「空查询下」的折叠状态：第一组仍是折叠的。
  await input(page).fill("");
  await expect(rowOf(page, "editor.cursor-up")).toBeHidden();
  await first.click();
  await expect(rowOf(page, "editor.cursor-up")).toBeVisible();
});

test("详情：原始 token / 命令 id / 来由 / 未绑定成因与 [keys] 示例", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  // 默认不占键位：折行命令。
  await input(page).fill("折行");
  const wrap = rowOf(page, "view.toggle-line-wrap");
  await expect(wrap).toHaveClass(/is-unbound/);
  await expect(wrap.locator(".lumir-bindings-key")).toHaveText("未绑定");
  await wrap.click();
  const wrapDetail = page.locator(".lumir-bindings-detail");
  await expect(wrapDetail).toContainText("默认不占键位");
  await expect(wrapDetail).toContainText("[keys]");
  await expect(wrapDetail).toContainText("config.json");
  await expect(wrapDetail).toContainText("view.toggle-line-wrap");

  // 一次只开一个：点另一行，前一行的详情收起。
  await rowOf(page, "view.toggle-code-block-wrap").click();
  await expect(page.locator(".lumir-bindings-detail")).toHaveCount(1);
  await expect(page.locator(".lumir-bindings-detail")).toContainText("view.toggle-code-block-wrap");

  // 已绑定的行：详情带原始 token 与来由；来由不上主行。
  await input(page).fill("撤销");
  await rowOf(page, "editor.undo").click();
  const undoDetail = page.locator(".lumir-bindings-detail");
  await expect(undoDetail).toContainText("Cmd-z");
  await expect(undoDetail).toContainText("⌘Z");
  await expect(undoDetail).toContainText("命令 id");
  await expect(undoDetail).toContainText("来由");
  await expect(rowOf(page, "editor.undo").locator(".lumir-bindings-label")).toHaveText("撤销");
});

test("生效表：配置重绑 / 解绑后按生效表渲染", async ({ page }) => {
  await openVault(page, { keys: { "Ctrl-j": "editor.undo", "Cmd-s": null } });
  await focusEditor(page, DOC.length);
  await openPanel(page);

  // 重绑：⌃J 与默认 ⌘Z 并列在同一行，仍只有一行。
  const undo = rowOf(page, "editor.undo");
  await expect(undo).toHaveCount(1);
  expect(await undo.locator(".lumir-bindings-key").allTextContents()).toEqual(["⌘Z", "⌃/", "⌃⇧-", "⌃J"]);
  await undo.click();
  await expect(page.locator(".lumir-bindings-detail")).toContainText("用户配置重绑");

  // 解绑：命令仍在视野里，成因是「已被配置解绑」，不是「默认不占键位」。
  const save = rowOf(page, "document.save");
  await expect(save).toHaveCount(1);
  await expect(save).toHaveClass(/is-unbound/);
  await expect(save.locator(".lumir-bindings-key")).toHaveText("未绑定");
  await save.click();
  await expect(page.locator(".lumir-bindings-detail")).toContainText("已被配置解绑");
  await expect(page.locator(".lumir-bindings-detail")).toContainText("[keys]");

  await expect(rows(page)).toHaveCount(COMMAND_IDS.length);
});

test("面板打开期间编辑键不穿透；关闭后恢复", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length - 1);
  const before = await cursorHead(page);

  await openPanel(page);
  for (const key of ["Control+d", "Control+k", "Control+a", "Control+n", "Control+Shift+f", "Tab", "Shift+Tab"]) {
    await page.keyboard.press(key);
  }
  await page.keyboard.type("draft");
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(DOC);
  expect(await cursorHead(page), "面板打开期间光标不得被编辑器命令移动").toBe(before);
  expect(
    await page.evaluate(() => document.querySelector(".lumir-bindings-panel")?.contains(document.activeElement) ?? false),
  ).toBe(true);

  // 查询非空：第一下 Esc 清查询，第二下关闭；关闭后编辑键恢复（证明前一段的「不动」来自焦点）。
  await page.keyboard.press("Escape");
  await expect(input(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
  expect(
    await page.evaluate(() => document.querySelector(".cm-content")?.contains(document.activeElement) ?? false),
  ).toBe(true);
  await page.keyboard.press("Control+d");
  await expect.poll(() => readDocument(page), "关闭后 ⌃D 应恢复删字符").toBe(
    DOC.slice(0, before) + DOC.slice(before + 1),
  );
});

test("三条关闭路径：Esc / ⌃G / 点遮罩；点面板本体不关；⌘/ 切换", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);

  await openPanel(page);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();

  await openPanel(page);
  await page.keyboard.press("Control+g");
  await expect(panel(page)).toBeHidden();

  await openPanel(page);
  await page.locator(".lumir-bindings-title").click();
  await expect(panel(page)).toBeVisible();
  await page.locator(".lumir-bindings-overlay").click({ position: { x: 8, y: 8 } });
  await expect(panel(page)).toBeHidden();

  await openPanel(page);
  await page.keyboard.press("Meta+/");
  await expect(panel(page)).toBeHidden();

  // 菜单入口走同一条 toggle：先打开，再经菜单事件关闭。
  await openPanel(page);
  await fireMenuCommand(page, "describe-bindings");
  await expect(panel(page)).toBeHidden();
});

test("菜单事件与 ⌘/ 是同一个 toggle（打开 → 再触发关闭）", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await expect(panel(page)).toBeHidden();
  await fireMenuCommand(page, "describe-bindings");
  await expect(panel(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await expect(page.locator(".lumir-bindings-count")).toHaveText(`${COMMAND_IDS.length} 条命令 · 11 组`);
  await fireMenuCommand(page, "describe-bindings");
  await expect(panel(page)).toBeHidden();
});

for (const theme of ["dark", "eink"] as const) {
  test(`${theme}：面板壳沿用既有 token，不引入新色值`, async ({ page }) => {
    await openVault(page, { theme });
    await focusEditor(page, DOC.length);
    await openPanel(page);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    const reading = await page.evaluate(() => {
      const panel = document.querySelector(".lumir-bindings-panel") as HTMLElement;
      const styles = getComputedStyle(panel);
      const root = getComputedStyle(document.documentElement);
      return {
        background: styles.backgroundColor,
        token: root.getPropertyValue("--preview-bg").trim(),
        borderWidth: styles.borderTopWidth,
      };
    });
    // 面板底色 = 当前主题的 --preview-bg（token 配方，不是写死的色值）。
    expect(reading.background).not.toBe("");
    const probe = await page.evaluate((value) => {
      const el = document.createElement("div");
      el.style.background = value;
      document.body.append(el);
      const color = getComputedStyle(el).backgroundColor;
      el.remove();
      return color;
    }, reading.token);
    expect(reading.background, `${theme} 的主题底色应取 --preview-bg`).toBe(probe);
    // eink 的线宽升级档（规则⑦⑧）：border-width 的计算值是设备像素取整后的 used value（1.4px → 1px），
    // 因此从样式表规则本身读声明值，不读 computed style。
    if (theme === "eink") {
      const declared = await page.evaluate(() => {
        for (const sheet of Array.from(document.styleSheets)) {
          for (const rule of Array.from(sheet.cssRules)) {
            if (
              rule instanceof CSSStyleRule &&
              rule.selectorText.includes(':root[data-theme="eink"] .lumir-bindings-panel')
            ) {
              return rule.style.borderWidth;
            }
          }
        }
        return null;
      });
      expect(declared).toBe("1.4px");
    }
    await expect(page.locator(".lumir-bindings-scope-button.is-selected")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toBeHidden();
  });
}

test("IME：组合期不刷新结果，compositionend 后按最终串刷新一次", async ({ page }) => {
  await openVault(page);
  await focusEditor(page, DOC.length);
  await openPanel(page);

  await input(page).evaluate((el) => {
    const field = el as HTMLInputElement;
    field.focus();
    field.value = "da";
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, data: "da" }));
  });
  await expect(rows(page)).toHaveCount(COMMAND_IDS.length);

  await input(page).evaluate((el) => {
    const field = el as HTMLInputElement;
    field.value = "大纲";
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "大纲" }));
  });
  await expect(rows(page)).toHaveCount(1);
  await expect(rowOf(page, "toc.toggle")).toBeVisible();
});
