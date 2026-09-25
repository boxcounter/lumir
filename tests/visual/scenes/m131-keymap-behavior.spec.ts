import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M131 键位统一层的行为回归：⌘ / ⌃ 拆分、⌃A 语义变更（行首）、撤销 / 重做、
// 保存键唯一、以及作用域（global / editor 各自不越界、widget 焦点委托同一命令层）。
//
// 时间口径：自动保存 debounce 为 2s（AUTOSAVE_DEBOUNCE_MS）。需要断言 dirty 的场景
// 一律用「没有打开文件」的编辑器（saveBaseline 为 null → 自动保存与备份都不插手），
// 或者把「输入 → 按键」压在同一窗口内完成，避免自动保存把 dirty 提前清掉。

const DOC = "# 标题\n\n第一段内容。\n第二行内容。\n\n末段。\n";
// 行号：1=标题 2=空 3=第一段 4=第二行 5=空 6=末段

// 撑起滚动区域的长文档 + 表格（复刻既有 ⌃E 场景的形态）：表格滚出顶部后，
// 隐藏管道符边界的坐标退化才会以「整窗下挫」的形式显现。
const LONG_TABLE_DOC = (() => {
  const filler = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段填充内容，用于撑起滚动区域，长度适中。`).join("\n\n");
  return `${filler}\n\n| 名称 | 状态 | 备注 |\n| --- | --- | --- |\n| 表格 | 正常 | alpha |\n| 数据 | 良好 | beta |\n\n${filler}\n`;
})();
/** 「表格」所在行（从文档派生，避免硬编码行号随填充段数漂移）。 */
const TABLE_ROW = LONG_TABLE_DOC.slice(0, LONG_TABLE_DOC.indexOf("| 表格")).split("\n").length;

interface Caret {
  head: number;
  from: number;
  to: number;
  empty: boolean;
  line: number;
  lineFrom: number;
  docLength: number;
}

async function caret(page: Page): Promise<Caret> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    const line = view.state.doc.lineAt(main.head);
    return {
      head: main.head,
      from: main.from,
      to: main.to,
      empty: main.empty,
      line: line.number,
      lineFrom: line.from,
      docLength: view.state.doc.length,
    };
  });
}

async function setCursor(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

// 长文档的表格在第 61 行附近（30 段填充之后），doc-title 块落地后掉出 CM 初始渲染窗口
//（M221 复跑实证：waitFor('.cm-lp-table-scroll') 超时）——揭示表格**下方** ~400 字符处，
// nearest 滚动把该 pos 贴到视口下缘，整张表随之进视口并被渲染（直接揭示表头 pos 只会
// 把表头贴到下缘，表体行仍在视口外不渲染——probe 实证 cells 3 vs 9）。
// 用户滚到即渲染，这是 CM 虚拟渲染的正常行为，不是产品缺陷。
async function revealTable(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const text = view.state.doc.toString();
    const pos = Math.min(text.length, text.indexOf("| 数据 | 良好 | beta |") + 400);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  });
}

interface Snap {
  head: number;
  line: number;
  lineFrom: number;
  empty: boolean;
  caretTop: number | null;
  scrollTop: number;
}

/** 光标 + 滚动快照：caret 坐标退化（null）与整窗下挫都是隐藏 replace 边界的症状。 */
async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    const line = view.state.doc.lineAt(main.head);
    const coords = view.coordsAtPos(main.head, main.assoc || 1);
    const scroller = document.querySelector(".cm-scroller")!;
    return {
      head: main.head,
      line: line.number,
      lineFrom: line.from,
      empty: main.empty,
      caretTop: coords ? Math.round(coords.top * 10) / 10 : null,
      scrollTop: Math.round(scroller.scrollTop * 10) / 10,
    };
  });
}

/** 打开 fixture 里的某个文件（vault 装载 → 点树行）。 */
async function openFile(page: Page, files: Record<string, string>, name: string): Promise<void> {
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(name);
}

/** 装载 vault 且编辑器停在**未命名空文档**（无文件上下文 → 不可保存，dirty 只由文本决定）。
 *
 *  M164 判据变更：M163 起「装载 vault 后一个标签都没有」是**空 vault 首入态**——D107 的引导层
 *  盖住正文（`.editor-notice` 拦截指针事件，编辑器点不进去），因此它不再是「装载后直接可得」
 *  的状态。未命名空文档改经「打开一个文件再关掉它的标签」到达：`closeTabNow` 会落在它上面
 *  并撤下覆盖层（`src/tabs.ts` / `src/editor.ts` 的 `closeSession`）。本函数验的是未命名文档
 *  上的键位与撤销语义，与「怎么到达它」无关；引导层本身另有一条断言钉住（别让它静默回退）。 */
async function openEmptyEditor(page: Page): Promise<string> {
  await stubTauri(page, {
    entries: [{ path: "blank.md", kind: "file", size: 6, mtime_ms: 0 }],
    files: { "blank.md": "BLANK\n" },
  });
  await page.goto("/");
  await expect(page.locator(".editor-notice")).toContainText("这个 vault 还没有打开的文件");
  await page.locator('.ft-row[title="blank.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("blank.md");
  await page.keyboard.press("Meta+w");
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");
  await expect(page.locator(".tab")).toHaveCount(0);
  await page.locator(".cm-content").click();
  return readDocument(page);
}

const unsavedMark = (page: Page) => page.locator(".modeline-path", { hasText: "（未保存）" });

/** dirty 镜像探针（document_set_dirty）：无文件上下文的编辑器没有 modeline 标记，dirty 只能从这里看。 */
const dirtyMirror = (page: Page) =>
  page.evaluate(() => (window as unknown as { __dirtyReports: boolean[] }).__dirtyReports.at(-1));

test("⌃A 到行首（Emacs 语义）、⌘A 仍是全选：⌘ 与 ⌃ 拆分后各归其位", async ({ page }) => {
  await openFile(page, { "keys.md": DOC }, "keys.md");

  // 光标停在正文行（行 4）中段：⌃A 必须只到该行行首，不得变成全选
  await setCursor(page, DOC.indexOf("第二行") + 2);
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(50);
  const atLineStart = await caret(page);
  expect(atLineStart.empty, "⌃A 不得形成选区（拆分前 ⌃A 与 ⌘A 同为全选）").toBe(true);
  expect(atLineStart.line).toBe(4);
  expect(atLineStart.head).toBe(atLineStart.lineFrom);

  // 同一行再按 ⌃A：已在行首，原地不动
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(50);
  expect((await caret(page)).head).toBe(atLineStart.head);

  // ⌘A 保持全选（mac 惯例）
  await page.keyboard.press("Meta+a");
  await page.waitForTimeout(50);
  const all = await caret(page);
  expect(all.from).toBe(0);
  expect(all.to).toBe(all.docLength);
});

test("⌃A 在表格滚动容器焦点内同样到行首（widget 焦点委托同一命令层，不下挫）", async ({ page }) => {
  // 长文档 + 表格在滚出顶部之后：⌃A 若把 caret 停在坐标测量退化的隐藏管道符边界上，
  // 揭示滚动会把整窗内容下挫（M118 ⌃E 的同族缺陷），故这里与既有 ⌃E 场景同款断言
  // scrollTop 与 caret 可视性。
  await openFile(page, { "table.md": LONG_TABLE_DOC }, "table.md");
  await revealTable(page);
  await page.locator(".cm-lp-table-scroll").waitFor();
  await page.locator(".cm-lp-table-cell", { hasText: "正常" }).first().click();
  await page.waitForTimeout(80);
  const before = await snap(page);
  expect(before.line).toBe(TABLE_ROW); // 光标在表格行内
  expect(before.scrollTop).toBeGreaterThan(0); // 已滚离顶部，下挫才可观测

  // 焦点落在 livePreview 的滚动容器（tabindex=0）上，CM 选区不变。
  // 用 focus() 而非 click()：点击走 CM 的 mousedown 会把焦点收回 contentDOM，
  // 而「焦点在滚动容器上」正是 livePreview 那个 keydown 手柄所针对的状态
  //（用户点表格时由浏览器的 focus 行为落到容器上）。
  await page.locator(".cm-lp-table-scroll").first().evaluate((el) => (el as HTMLElement).focus());
  await page.waitForTimeout(80);
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(focused, "焦点应落在表格滚动容器上（该场景才有意义）").toContain("cm-lp-table-scroll");

  await page.keyboard.press("Control+a");
  await page.waitForTimeout(120);
  const after = await snap(page);
  // 落点语义：行内第一个「可测量（可见）」位置。表格行行首是隐藏管道符、两侧测量都退化，
  // 命令必须像 ⌃E 那样把落点挪过它——否则 caret 落在退化位置，scrollIntoView(nearest)
  // 会把整窗内容下挫（实测未修前 scrollTop 掉 62px）。
  const landing = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    const line = view.state.doc.lineAt(main.head);
    const degenerate = (pos: number) => {
      const c = view.coordsAtPos(pos, 1);
      return !c || (c.top === 0 && c.left === 0 && c.right === 0 && c.bottom === 0);
    };
    let firstVisible = line.from;
    while (firstVisible < line.to && degenerate(firstVisible)) firstVisible++;
    return { head: main.head, lineFrom: line.from, firstVisible, line: line.number };
  });
  expect(after.empty).toBe(true);
  expect(landing.line).toBe(TABLE_ROW);
  expect(landing.lineFrom, "该行行首应确实不可停靠（否则场景没有意义）").toBeLessThan(landing.firstVisible);
  expect(landing.head, "落点必须是行内第一个可测量位置").toBe(landing.firstVisible);
  expect(after.caretTop, "⌃A 后 caret 必须可视（坐标不得退化）").not.toBeNull();
  expect(Math.abs(after.scrollTop - before.scrollTop), "⌃A 不得引起整窗滚动下挫").toBeLessThanOrEqual(1);
});

test("撤销：⌘Z 与 ⌃/ 都回退输入，回到已保存内容时 dirty 收窄为 false", async ({ page }) => {
  const baseline = await openEmptyEditor(page);

  await setCursor(page, baseline.length);
  await page.keyboard.type("draft");
  expect(await readDocument(page)).toBe(`${baseline}draft`);
  await expect.poll(() => dirtyMirror(page)).toBe(true);

  // 单次 ⌘Z 撤销整个输入组（newGroupDelay 内连续输入并为一组）
  await page.keyboard.press("Meta+z");
  await expect.poll(() => readDocument(page)).toBe(baseline);
  // 回到 cleanDoc 基线：dirty 必须收回（含镜像给后端的退出守卫）
  await expect.poll(() => dirtyMirror(page)).toBe(false);

  // 历史已空：再按 ⌘Z 不产生任何变化（也不把原生撤销放进来）
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(50);
  expect(await readDocument(page)).toBe(baseline);

  // Emacs 规范绑定 ⌃/ 同样撤销
  await page.keyboard.type("emacs");
  expect(await readDocument(page)).toBe(`${baseline}emacs`);
  await page.keyboard.press("Control+/");
  await expect.poll(() => readDocument(page)).toBe(baseline);
  await expect.poll(() => dirtyMirror(page)).toBe(false);
});

test("重做：⌘⇧Z 与 ⌃⌥_ 都恢复被撤销的输入", async ({ page }) => {
  const baseline = await openEmptyEditor(page);

  await setCursor(page, baseline.length);
  await page.keyboard.type("redo");
  const typed = await readDocument(page);
  expect(typed).toBe(`${baseline}redo`);

  await page.keyboard.press("Meta+z");
  await expect.poll(() => readDocument(page)).toBe(baseline);

  // mac 惯例重做
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => readDocument(page)).toBe(typed);

  // Emacs 系别名（⌃⌥_ 在 mac 键盘上物理为 ⌃⌥⇧-，且 Alt 层把字符换成 "—"）
  await page.keyboard.press("Control+/");
  await expect.poll(() => readDocument(page)).toBe(baseline);
  await page.keyboard.press("Control+Alt+_");
  await expect.poll(() => readDocument(page)).toBe(typed);

  // 真机形状：⌃⌥⇧-（shiftKey 在场，e.key 是 Alt 层字符）——Shift 不参与该判定
  await page.keyboard.press("Control+/");
  await expect.poll(() => readDocument(page)).toBe(baseline);
  await page.keyboard.press("Control+Alt+Shift+_");
  await expect.poll(() => readDocument(page)).toBe(typed);
});

test("⌘S 唯一保存：⌃S 不再触发保存（D3）", async ({ page }) => {
  const original = DOC;
  await openFile(page, { "save.md": original }, "save.md");

  await setCursor(page, original.length);
  await page.keyboard.type("tail");
  const typed = await readDocument(page);
  expect(typed).not.toBe(original);
  await expect(unsavedMark(page)).toBeVisible();

  // ⌃S 解绑（预留给 isearch）：既不得写入磁盘，也不得清 dirty
  await page.keyboard.press("Control+s");
  await page.waitForTimeout(400); // 远小于 2s 自动保存 debounce
  expect(await page.evaluate(() => (window as unknown as { __fileText(p: string): string | undefined }).__fileText("save.md"))).toBe(original);
  await expect(page.locator(".lumir-toast", { hasText: /^✓已保存$/ })).toHaveCount(0);
  await expect(unsavedMark(page)).toBeVisible();

  // ⌘S 仍是保存键：落盘内容为当前缓冲、dirty 清除。
  // M217 S14：成功类 toast 带 ✓ 前缀（.toast-check span，语义口径——只有「用户动作已成功
  // 完成」的确认带 ✓），textContent 因此是「✓已保存」；这条断言同时守住 ✓ 在场。
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: /^✓已保存$/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __fileText(p: string): string | undefined }).__fileText("save.md")))
    .toBe(typed);
  await expect(unsavedMark(page)).toHaveCount(0);
});

test("作用域：⌘S 是全局键（焦点不在编辑器也生效），editor 作用域的键不越界", async ({ page }) => {
  const original = DOC;
  await openFile(page, { "scope.md": original }, "scope.md");

  await setCursor(page, original.length);
  await page.keyboard.type("y");
  await expect(unsavedMark(page)).toBeVisible();
  const before = await caret(page);

  // 焦点移出编辑器（body）：editor 作用域的 ⌃A 不得接管（拆分前它是编辑器手柄）
  await page.locator(".cm-content").evaluate((el) => {
    const active = el.ownerDocument.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  expect(await page.evaluate(() => document.activeElement?.className ?? "")).not.toContain("cm-content");
  await page.keyboard.press("Control+a");
  await page.waitForTimeout(60);
  const after = await caret(page);
  expect(after.head).toBe(before.head);
  expect(after.empty).toBe(true); // 没有形成选区

  // global 作用域的 ⌘S 不受焦点影响（成功 toast 的 ✓ 前缀见上一用例的注）
  await page.keyboard.press("Meta+s");
  await expect(page.locator(".lumir-toast", { hasText: /^✓已保存$/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __fileText(p: string): string | undefined }).__fileText("scope.md")))
    .toBe(`${original}y`);
});

test("撤销不跨文档：切换文件后 ⌘Z 不会把上一个文件的内容撤回来", async ({ page }) => {
  const files = { "a.md": "AAA\n", "b.md": "BBB\n" };
  await openFile(page, files, "a.md");

  await setCursor(page, files["a.md"].length);
  await page.keyboard.type("x");
  await page.keyboard.press("Meta+s"); // 落盘并解除 dirty（否则切换被守卫拦下）
  await expect(unsavedMark(page)).toHaveCount(0);

  await page.locator('.ft-row[title="b.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("b.md");
  await expect(page.locator(".cm-content")).toContainText("BBB");

  // 装载事务不进撤销栈（TrustedLoad）：B 文档里按 ⌘Z 必须什么都不发生
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(files["b.md"]);
  await expect(unsavedMark(page)).toHaveCount(0);
  // 反向也一样：⌘⇧Z 不得把 A 的内容"重做"回来
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForTimeout(80);
  expect(await readDocument(page)).toBe(files["b.md"]);
});
