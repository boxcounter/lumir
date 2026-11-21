import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { openedUrls } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 裸 URL 的中文边界（change fix-bare-url-cjk-boundary-nov21）。
//
// 判据分三层，缺一层就会假绿：
//   1. **装饰区间**：`.cm-lp-link` 的文本是 ASCII 前缀，中文不在任何链接元素里；
//   2. **激活目标**：⌘-Click 打开的是 ASCII 前缀；光标落在中文内部时 ⌘⏎ 无操作；
//   3. **显式语法不裁**：角括号与定义行的中文目标仍完整（它们是显式 URL 定界语法）。
// 文档源码在装饰后逐字节不变（ADR 0003 §3）。本条不新增像素基线：只在既有
// `.cm-lp-link` / 文本与桩调用记录上做结构断言。

const ASCII = "https://example.invalid/abc";
const ANGLE = "https://example.invalid/中文";
const DEF = "https://example.invalid/中文定义";
const CAFE = "https://example.invalid/café";
const CYRILLIC = "https://example.invalid/путь";
const DOC = [
  "# URL 边界",
  "",
  `裸网址 ${ASCII}中文说明 在这里。`,
  "",
  `显式 <${ANGLE}> 与定义行：`,
  "",
  `[home]: ${DEF}`,
  "",
  `非 CJK 路径 ${CAFE} 与 ${CYRILLIC} 完整保留。`,
  "",
].join("\n");

async function open(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "boundary.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "boundary.md": DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="boundary.md"]').click();
  await expect(page.locator(".cm-content")).toBeVisible();
}

/** 把 CM 选区设到某个偏移并聚焦（与 render-link 的同名 helper 同一口径）。 */
async function setCursor(page: Page, pos: number): Promise<void> {
  await page.locator(".cm-content").evaluate((el, p) => {
    const tile = (el as unknown as { cmTile?: { root: { view: { dispatch: (t: unknown) => void; focus: () => void } } } }).cmTile;
    if (!tile) throw new Error("CodeMirror view unavailable");
    tile.root.view.dispatch({ selection: { anchor: p } });
    tile.root.view.focus();
  }, pos);
}

test("裸 URL 后的中文不进入链接目标 / 装饰；显式语法保留完整中文目标", async ({ page }) => {
  await open(page);

  // 三条可点链接：裸 URL（ASCII 前缀）、角括号、定义行。
  await expect(page.locator(".cm-lp-link")).toHaveCount(5);
  const links = page.locator(".cm-lp-link");
  const texts = await links.allInnerTexts();
  expect(texts).toContain(ASCII);
  expect(texts.some((text) => text.includes("中文说明")), "中文说明不能出现在任何链接元素里").toBe(false);

  // 裸 URL 的 title 属性 = ASCII 前缀（打开目标同源）。
  await expect(page.locator(".cm-lp-link", { hasText: ASCII })).toHaveAttribute("title", ASCII);
  // 显式语法：角括号 / 定义行保留完整目标。
  await expect(page.locator(`.cm-lp-link[title="${ANGLE}"]`)).toHaveCount(1);
  await expect(page.locator(`.cm-lp-link[title="${DEF}"]`)).toHaveCount(1);
  // 非 CJK Unicode 路径不被边界误裁。
  await expect(page.locator(`.cm-lp-link[title="${CAFE}"]`)).toHaveCount(1);
  await expect(page.locator(`.cm-lp-link[title="${CYRILLIC}"]`)).toHaveCount(1);
  // 中文说明仍作为正文可见（边界不是把中文吞掉）。
  await expect(page.locator(".cm-content")).toContainText("中文说明");

  // ⌘-Click 打开的是 ASCII 前缀，不是把中文一起带走的目标。
  await page.locator(".cm-lp-link", { hasText: ASCII }).click({ modifiers: ["Meta"] });
  await expect.poll(async () => openedUrls(page)).toEqual([ASCII]);

  // 光标落在中文内部：⌘⏎ 无操作（中文不属于链接）。
  await setCursor(page, DOC.indexOf("中文说明") + 1);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual([ASCII]);

  // 显式角括号链接：光标落在中文内部仍能打开完整目标（显式定界语法不裁）。
  await setCursor(page, DOC.indexOf(ANGLE) + 2);
  await page.keyboard.press("Meta+Enter");
  await expect.poll(async () => openedUrls(page)).toEqual([ASCII, ANGLE]);

  // 装饰不改文档（ADR 0003 §3）：磁盘与 EditorState 逐字节仍是源文件。
  expect(await readDocument(page)).toBe(DOC);
});
