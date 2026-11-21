// 行号 gutter 右键复制 `{path}:{line}`（change gutter-copy-path-line-nov21）的 chromium 场景。
//
// 判据分层：纯拼法在 tests/unit/gutter-copy.test.ts；本场景判**真 DOM + 真实右键事件 + 剪贴板**：
//   - md / code 两模式首行 / 末行、路径含空格 / 中文、vault 外绝对路径；
//   - 成功 toast 与剪贴板逐字一致；剪贴板拒绝时走失败 toast 且不显示成功；
//   - 零副作用：文档、选区、dirty（modeline 路径段）、滚动位置逐值不变；
//   - `contextmenu` 的默认行为被消费（window 冒泡段读到 defaultPrevented = true）；
//   - `off` 档没有 gutter 时没有本手势（剪贴板不变、无成功提示）。
// 真机 WKWebView 的同一链路归 scripts/acceptance/scenarios/707-gutter-copy.md；权限拒绝无法在
// 真机稳定造出，故那一面只在本文以 API 拒绝注入覆盖。

import { expect, test, type Page } from "@playwright/test";
import { configApplied, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

/** 路径同时含空格与中文：复制结果必须逐字保留。 */
const MD_PATH = "日本 旅行.md";
const MD_LINES = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行：gutter 右键复制的填充内容。`);
const MD_DOC = `${MD_LINES.join("\n")}\n`;

const CODE_PATH = "示例 代码.ts";
const CODE_LINES = Array.from({ length: 12 }, (_, i) => `const line${i + 1} = ${i + 1};`);
const CODE_DOC = `${CODE_LINES.join("\n")}\n`;

const EXTERNAL_PATH = "/tmp/lumir-gutter-copy/外部 笔记.md";
const EXTERNAL_DOC = "# 外部笔记\n\n第一段。\n第二段。\n";

/** frontmatter replace 块 + 后续正文：前 4 行被块级 widget 覆盖（第 5 行起才是可见行号）。 */
const FM_PATH = "frontmatter 笔记.md";
const FM_DOC = "---\ntitle: 合成标题\ntags: [probe]\n---\n正文第一行\n正文第二行\n";

/** 软换行：第 3 行是一条会折成多个视觉行的长行，gutter 仍只有源逻辑行号 3。 */
const WRAP_PATH = "软换行 长行.md";
const WRAP_DOC = `# 软换行\n\n${"长".repeat(120)}\n\n结尾行。\n`;

const VAULT: VaultFixture = {
  root: "/v",
  entries: [
    { path: MD_PATH, kind: "file", size: MD_DOC.length, mtime_ms: 0 },
    { path: CODE_PATH, kind: "file", size: CODE_DOC.length, mtime_ms: 0 },
    { path: FM_PATH, kind: "file", size: FM_DOC.length, mtime_ms: 0 },
    { path: WRAP_PATH, kind: "file", size: WRAP_DOC.length, mtime_ms: 0 },
  ],
  files: { [MD_PATH]: MD_DOC, [CODE_PATH]: CODE_DOC, [FM_PATH]: FM_DOC, [WRAP_PATH]: WRAP_DOC },
  externalFiles: { [EXTERNAL_PATH]: EXTERNAL_DOC },
  links: {},
};

interface EditorFacts {
  doc: string;
  selection: [number, number];
  scrollTop: number;
  gutterCount: number;
}

function editorFacts(page: Page): Promise<EditorFacts> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    return {
      doc: view.state.doc.toString(),
      selection: [main.anchor, main.head],
      scrollTop: Math.round(view.scrollDOM.scrollTop),
      gutterCount: document.querySelectorAll(".cm-lineNumbers").length,
    };
  });
}

async function openVaultDoc(page: Page, path: string, config: VaultFixture["config"] = {}): Promise<void> {
  await stubTauri(page, { ...VAULT, config });
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(path);
  await configApplied(page);
}

/** 在行号 gutter 的指定数字上右键。行号元素是 `.cm-gutterElement`，文本就是源行号。 */
async function rightClickLine(page: Page, line: number): Promise<void> {
  const number = page
    .locator(".cm-lineNumbers .cm-gutterElement")
    .filter({ hasText: new RegExp(`^${line}$`) });
  await expect(number.first()).toBeVisible();
  await number.first().click({ button: "right" });
}

function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** 把光标放到第 `line` 行行首（零副作用断言要一个非首行的基线）。 */
async function caretAtLine(page: Page, line: number): Promise<void> {
  await page.locator(".cm-content").evaluate((el, n) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.line(n).from } });
    view.focus();
  }, line);
}

/** 记录 window 冒泡段收到的 `contextmenu.defaultPrevented`（CM 的 gutter 处理器在目标链上先跑）。 */
async function watchContextMenu(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __gutterCtxDefaultPrevented: boolean[] };
    state.__gutterCtxDefaultPrevented = [];
    window.addEventListener("contextmenu", (event) => {
      state.__gutterCtxDefaultPrevented.push(event.defaultPrevented);
    });
  });
}

/** 当前焦点是否仍在编辑器正文里（右键 MUST NOT 移动焦点；mousedown 的默认行为要先被消费）。 */
function editorHasFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.classList.contains("cm-content") ?? false);
}

function contextMenuDefaultPrevented(page: Page): Promise<boolean[]> {
  return page.evaluate(
    () => (window as unknown as { __gutterCtxDefaultPrevented: boolean[] }).__gutterCtxDefaultPrevented,
  );
}

/** 文档全文（零副作用断言读 CM state，不读渲染出的可见行）。 */
function docText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    return view.state.doc.toString() as string;
  });
}

function scrollTop(page: Page): Promise<number> {
  return page.locator(".cm-scroller").evaluate((el) => el.scrollTop);
}

/** 视口顶部那一行的文本——滚动位置的语义判据（与 m149-tabs 的 topVisibleLine 同口径：
 *  恢复走 CM 的 scrollTarget，比 scrollTop 像素值可靠）。空串 = 读取失败，调用方必须判 FAIL。 */
function topVisibleLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const content = document.querySelector(".cm-content") as HTMLElement;
    const scrollerRect = scroller.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const pos = view.posAtCoords({
      x: contentRect.left + 20,
      y: Math.max(scrollerRect.top + 2, contentRect.top + 40),
    });
    return pos === null ? "" : (view.state.doc.lineAt(pos).text as string);
  });
}

/** 视口内**完整可见**的第一个行号元素对应的源行号与点击前的视口顶行。 */
async function firstVisibleNumber(page: Page): Promise<{ line: number; topBefore: string }> {
  const topBefore = await topVisibleLine(page);
  const target = await page.evaluate(() => {
    const gutter = document.querySelector(".cm-lineNumbers") as HTMLElement;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const viewport = scroller.getBoundingClientRect();
    const element = [...gutter.querySelectorAll<HTMLElement>(".cm-gutterElement")].find((el) => {
      const box = el.getBoundingClientRect();
      return (
        getComputedStyle(el).visibility !== "hidden" &&
        box.height > 0 &&
        box.top > viewport.top + 4 &&
        box.bottom < viewport.bottom - 4
      );
    });
    return element === undefined ? null : element.textContent ?? "";
  });
  if (target === null) throw new Error("视口内没有完整可见的行号元素");
  const line = Number(target);
  if (!Number.isInteger(line) || line < 1) throw new Error(`行号元素文本异常：${JSON.stringify(target)}`);
  return { line, topBefore };
}

test("md：首行 / 末行右键复制 vault 相对路径与 1 基行号，成功提示逐字回显，零副作用", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, MD_PATH, { markdown_line_numbers: "always" });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await caretAtLine(page, 3);
  const before = await editorFacts(page);
  expect(before.gutterCount).toBe(1);
  await watchContextMenu(page);

  await rightClickLine(page, 1);
  await expect.poll(() => clipboard(page)).toBe(`${MD_PATH}:1`);
  await expect(page.locator(".lumir-toast").filter({ hasText: `已复制 ${MD_PATH}:1` })).toHaveCount(1);
  await expect.poll(() => editorHasFocus(page)).toBe(true);

  // 末行：先滚到底（Playwright 会为不可见元素自动滚动，先滚到位才能把「右键不改滚动」判干净）
  await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
  });
  await expect(
    page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: new RegExp(`^${MD_LINES.length}$`) }).first(),
  ).toBeVisible();
  const scrolled = await editorFacts(page);

  await rightClickLine(page, MD_LINES.length);
  await expect.poll(() => clipboard(page)).toBe(`${MD_PATH}:${MD_LINES.length}`);

  const after = await editorFacts(page);
  expect(after.doc).toBe(before.doc);
  expect(after.selection).toEqual(before.selection);
  expect(after.scrollTop).toBe(scrolled.scrollTop);
  await expect(page.locator(".modeline-path")).toHaveText(MD_PATH); // 无 dirty 后缀
  expect(await contextMenuDefaultPrevented(page)).toEqual([true, true]);
});

test("code：首行 / 末行同一口径，剪贴板与成功提示一致", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, CODE_PATH);
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await caretAtLine(page, 2);
  const before = await editorFacts(page);

  await rightClickLine(page, 1);
  await expect.poll(() => clipboard(page)).toBe(`${CODE_PATH}:1`);
  await expect(page.locator(".lumir-toast").filter({ hasText: `已复制 ${CODE_PATH}:1` })).toHaveCount(1);

  await rightClickLine(page, CODE_LINES.length);
  await expect.poll(() => clipboard(page)).toBe(`${CODE_PATH}:${CODE_LINES.length}`);

  const after = await editorFacts(page);
  expect(after.doc).toBe(before.doc);
  expect(after.selection).toEqual(before.selection);
  expect(after.scrollTop).toBe(before.scrollTop);
});

test("vault 外只读：复制绝对路径 + 1 基行号，文档仍只读且不产生 dirty", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubTauri(page, { ...VAULT, config: { markdown_line_numbers: "always" } });
  await page.goto("/");
  await expect(page.locator(".ft-row").first()).toBeVisible();
  await configApplied(page);
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
  await page.locator(".lumir-qo-input").fill(EXTERNAL_PATH);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".modeline-path")).toContainText("外部 笔记.md");
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const before = await editorFacts(page);

  await rightClickLine(page, 1);
  await expect.poll(() => clipboard(page)).toBe(`${EXTERNAL_PATH}:1`);
  await expect(page.locator(".lumir-toast").filter({ hasText: `已复制 ${EXTERNAL_PATH}:1` })).toHaveCount(1);

  const after = await editorFacts(page);
  expect(after.doc).toBe(EXTERNAL_DOC);
  expect(after.selection).toEqual(before.selection);
  expect(after.scrollTop).toBe(before.scrollTop);
});

test("剪贴板被拒：失败 toast、不显示成功、剪贴板与文档都不变", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, MD_PATH, { markdown_line_numbers: "always" });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await caretAtLine(page, 2);
  const before = await editorFacts(page);
  await page.evaluate(() => navigator.clipboard.writeText("SENTINEL-BEFORE"));

  // 在 Clipboard 实例上遮蔽 writeText：拒绝形态与权限被拒一致（NotAllowedError），
  // 走产品自己的 catch 分支——不是把产品代码替换掉。
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new DOMException("Write permission denied", "NotAllowedError")),
    });
  });

  await rightClickLine(page, 2);
  await expect(page.locator(".lumir-toast").filter({ hasText: "复制失败" })).toHaveCount(1);
  await expect(page.locator(".lumir-toast").filter({ hasText: "已复制" })).toHaveCount(0);
  expect(await clipboard(page)).toBe("SENTINEL-BEFORE");

  const after = await editorFacts(page);
  expect(after.doc).toBe(before.doc);
  expect(after.selection).toEqual(before.selection);
  expect(after.scrollTop).toBe(before.scrollTop);
});

test("无路径：关闭最后标签后右键，失败 toast 与 console 诊断各一次，剪贴板不变", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, MD_PATH, { markdown_line_numbers: "always" });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.locator(".tab-close").click();
  await expect(page.locator(".tab-open")).toHaveCount(0);
  await expect(page.locator(".cm-lineNumbers")).toBeVisible(); // 空文档继承 md 模式 + always 档
  await expect(page.locator(".modeline-path")).toHaveText("无当前文件");
  await page.evaluate(() => navigator.clipboard.writeText("SENTINEL-NO-PATH"));

  const warnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes("复制")) warnings.push(message.text());
  });

  await rightClickLine(page, 1);
  await expect(page.locator(".lumir-toast").filter({ hasText: "复制失败" })).toHaveCount(1);
  await expect(page.locator(".lumir-toast").filter({ hasText: "已复制" })).toHaveCount(0);
  expect(await clipboard(page)).toBe("SENTINEL-NO-PATH");
  await expect.poll(() => warnings.length).toBe(1);
  expect(warnings[0]).toContain("无当前文件");
});

test("frontmatter replace 块与后续正文：块首行复制 1，正文复制实际源行号", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, FM_PATH, { markdown_line_numbers: "always" });
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  const before = await editorFacts(page);

  // frontmatter 是块级 replace，覆盖的源行没有数字；右键 gutter 的空白处按块首源行处理。
  const gutter = await page.locator(".cm-lineNumbers").boundingBox();
  expect(gutter).not.toBeNull();
  await page.mouse.click(gutter!.x + gutter!.width / 2, gutter!.y + 4, { button: "right" });
  await expect.poll(() => clipboard(page)).toBe(`${FM_PATH}:1`);

  // 后续正文行有可见数字：复制的是真实源行号（frontmatter 占 1–4 行，正文从 5 起）。
  await rightClickLine(page, 5);
  await expect.poll(() => clipboard(page)).toBe(`${FM_PATH}:5`);

  const after = await editorFacts(page);
  expect(after.doc).toBe(before.doc);
  expect(after.selection).toEqual(before.selection);
  expect(after.scrollTop).toBe(before.scrollTop);
});

test("软换行：复制的仍是源逻辑行号，不是视觉行序号", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, WRAP_PATH, { markdown_line_numbers: "always" });
  const number = page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^3$/ }).first();
  await expect(number).toBeVisible();
  const box = await number.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(50); // 长行折成多个视觉行：元素高度明显大于单行
  expect(await page.locator(".cm-lineNumbers .cm-gutterElement").filter({ hasText: /^3$/ }).count()).toBe(1);

  // 点在高度中段（视觉行之一）也仍归源逻辑行 3。
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: "right" });
  await expect.poll(() => clipboard(page)).toBe(`${WRAP_PATH}:3`);
});

test("code dirty：右键不改文档与 dirty；随后一次撤销只撤销此前的编辑", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, CODE_PATH);
  await caretAtLine(page, 1);
  await page.keyboard.type("DIRTY");
  await expect(page.locator(".modeline-path")).toContainText("未保存");
  const dirtyDoc = await docText(page);
  expect(dirtyDoc).not.toBe(CODE_DOC);

  await rightClickLine(page, 1);
  await expect.poll(() => clipboard(page)).toBe(`${CODE_PATH}:1`);
  expect(await docText(page)).toBe(dirtyDoc);
  await expect(page.locator(".modeline-path")).toContainText("未保存");

  // 右键不制造历史步：一次撤销回到键入前（若右键派发过事务，这里会先撤掉它）。
  await page.keyboard.press("Meta+z");
  await expect.poll(() => docText(page)).toBe(CODE_DOC);
  await expect(page.locator(".modeline-path")).not.toContainText("未保存");
});

test("非首屏滚动快照：右键不改视口；切走再切回恢复同一顶行", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, MD_PATH, { markdown_line_numbers: "always" });
  await page.locator(".cm-content").click();
  await expect.poll(() => editorHasFocus(page)).toBe(true);
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Control+v");
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  expect(await topVisibleLine(page)).not.toBe(MD_LINES[0]);

  const clicked = await firstVisibleNumber(page);
  await rightClickLine(page, clicked.line);
  await expect.poll(() => clipboard(page)).toBe(`${MD_PATH}:${clicked.line}`);
  expect(await topVisibleLine(page)).toBe(clicked.topBefore); // 右键没有推视口
  const beforeSwitchScroll = await scrollTop(page);

  await page.locator(`.ft-row[title="${CODE_PATH}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(CODE_PATH);
  await page.locator(".tab-open").filter({ hasText: MD_PATH }).click();
  await expect(page.locator(".modeline-path")).toHaveText(MD_PATH);

  // 恢复走 CM 的 scrollTarget（对齐到行边界），顶行允许小幅对齐差；判据是「没有回到首屏、
  // 且仍在离开时的同一段」。复位到篇首时下面两条都会红（顶行变首行 / scrollTop 归零）。
  const beforeIndex = MD_LINES.indexOf(clicked.topBefore);
  await expect
    .poll(async () => {
      const text = await topVisibleLine(page);
      const index = MD_LINES.indexOf(text);
      return index >= 0 && Math.abs(index - beforeIndex) <= 5;
    })
    .toBe(true);
  const afterScroll = await scrollTop(page);
  expect(afterScroll).toBeGreaterThan(0);
  expect(Math.abs(afterScroll - beforeSwitchScroll)).toBeLessThanOrEqual(200);
});

test("on-demand：跳转输入条带出的临时 gutter 也能右键复制，且输入条不被右键收起", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, MD_PATH); // 默认 on-demand：打开时没有 gutter
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await page.locator(".cm-content").click();
  await expect.poll(() => editorHasFocus(page)).toBe(true);

  await page.keyboard.press("Alt+g");
  await expect(page.locator(".lumir-goto")).toBeVisible();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();

  await rightClickLine(page, 1);
  await expect.poll(() => clipboard(page)).toBe(`${MD_PATH}:1`);
  // mousedown 的默认行为被消费 ⇒ 输入条仍持焦、gutter 没有被 focusout 卸掉
  await expect(page.locator(".lumir-goto")).toBeVisible();
  await expect(page.locator(".lumir-goto-input")).toBeFocused();
  await expect(page.locator(".cm-lineNumbers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
});

test("off 档没有 gutter：原位置右键不复制、不反馈，gutter 三档合同不动", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openVaultDoc(page, MD_PATH, { markdown_line_numbers: "off" });
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
  await page.evaluate(() => navigator.clipboard.writeText("SENTINEL-OFF"));

  const content = await page.locator(".cm-content").boundingBox();
  expect(content).not.toBeNull();
  await page.mouse.click(content!.x - 12, content!.y + 8, { button: "right" });

  await expect(page.locator(".lumir-toast").filter({ hasText: "已复制" })).toHaveCount(0);
  await expect(page.locator(".lumir-toast").filter({ hasText: "复制失败" })).toHaveCount(0);
  expect(await clipboard(page)).toBe("SENTINEL-OFF");
  await expect(page.locator(".cm-lineNumbers")).toHaveCount(0);
});
