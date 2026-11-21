// 行号 gutter 右键复制 `{path}:{line}`（change gutter-copy-path-line-nov21）的 chromium 场景。
//
// 判据分层：纯拼法在 tests/unit/gutter-copy.test.ts；本场景判**真 DOM + 真实右键事件 + 剪贴板**：
//   - md / code 两模式首行 / 末行、路径含空格 / 中文、vault 外绝对路径；
//   - 成功 toast 与剪贴板逐字一致；剪贴板拒绝时走失败 toast 且不显示成功；
//   - 零副作用：文档、选区、dirty（modeline 路径段）、滚动位置逐值不变；
//   - `contextmenu` 的默认行为被消费（window 冒泡段读到 defaultPrevented = true）；
//   - `off` 档没有 gutter 时没有本手势（剪贴板不变、无成功提示）。
// 真机 WKWebView 的同一链路归 scripts/acceptance/scenarios/705-gutter-copy.md；权限拒绝无法在
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

const VAULT: VaultFixture = {
  root: "/v",
  entries: [
    { path: MD_PATH, kind: "file", size: MD_DOC.length, mtime_ms: 0 },
    { path: CODE_PATH, kind: "file", size: CODE_DOC.length, mtime_ms: 0 },
  ],
  files: { [MD_PATH]: MD_DOC, [CODE_PATH]: CODE_DOC },
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
