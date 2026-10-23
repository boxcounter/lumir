import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { SYNTHETIC_PNG_BASE64, attachmentReads, dirtyReports, documentWrites, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

// 图片文件 → 内容区图片查看面（M629，change add-image-file-preview）。
//
// 本场景守的是**接线与状态机在真实前端里的可观测结果**（chromium + tauri-stub）：
//   1. 点开一张图 ⇒ 查看面在场、`<img>` 真的解码了（naturalWidth > 0）、标签标题是文件名、
//      模型行右段是「图片 · 宽×高 · 文件大小」、**没有**「暂不支持预览」；
//   2. 双击 ⇒ 既有放大遮罩打开，且图像源与查看面那张**逐字相同**（同一 data: URL，不重读）；
//   3. 坏图 / 读取失败 ⇒ 占位与人话（D113 / D112），无破图、无对话框、不退回 D25；
//   4. 切走再切回 ⇒ 按 D3 重读一次（`fs_read_attachment` 的调用计数）；
//   5. 反向：PDF 仍走 D25（图片分流没有误伤二进制）；
//   6. 图片会话结构性只读：CM 视图是哨兵空状态、⌘S 零写入、搜索面板是空态；
//   7. 会话恢复：图片标签回到原位、成为前台时自动装载。
//
// 像素（图片是否「好看」、适配与居中的观感）不在这里：本场景只判几何前提（解码完成 + 适配
// 容器的计算样式）；整页基线零更新（默认打开的仍是文档）。

const IMAGE = "pic.png";
const BROKEN = "broken.png";
const BINARY = "archive.pdf";
const NOTE = "note.md";

const NOTE_TEXT = "# 笔记\n\n正文只有这一行。\n";

const VAULT: VaultFixture = {
  entries: [
    { path: NOTE, kind: "file", size: NOTE_TEXT.length, mtime_ms: 0 },
    { path: IMAGE, kind: "file", size: 69, mtime_ms: 0 },
    { path: BROKEN, kind: "file", size: 3, mtime_ms: 0 },
    { path: BINARY, kind: "file", size: 0, mtime_ms: 0 },
  ],
  files: { [NOTE]: NOTE_TEXT, [IMAGE]: "", [BROKEN]: "", [BINARY]: "" },
  // 坏图：合法 base64、非图片内容 ⇒ 读成但解码不出像素（D113 那条路径）。
  attachments: { [BROKEN]: "AAAA" },
};

/** 查看面里的终态 `<img>`。 */
function viewerImage(page: Page) {
  return page.locator(".image-viewer img.image-viewer-img");
}

/** 让一张图走到终态并返回它（断言集中在调用点）。 */
async function openImage(page: Page, path: string): Promise<void> {
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".image-viewer")).toBeVisible();
  await expect
    .poll(async () => viewerImage(page).evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

/** 某一张图被读取的次数（D3 的「切回重读一次」判据）。
 *  **按路径**数而不是数全局：启动期的 SAMPLE 演示文档里有一条相对路径图片引用
 *  （`![示例](./assets/shot.png)`），它也会发一次 `fs_read_attachment`——全局计数会把它
 *  算进来（M629 实证：单次打开图片数到 2）。 */
async function readsOf(page: Page, path: string): Promise<number> {
  return (await attachmentReads(page)).filter((entry) => entry === path).length;
}

test("点开图片：查看面在场、<img> 已解码、标签标题正确、modeline 读数正确、无 D25", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await stubTauri(page, VAULT);
  await page.goto("/");

  await openImage(page, IMAGE);

  // 解码完成的判据是 naturalWidth（元素在场不等于画出来了）
  expect(await viewerImage(page).evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  expect(await viewerImage(page).evaluate((el) => (el as HTMLImageElement).naturalHeight)).toBe(1);
  await expect(viewerImage(page)).toHaveAttribute("alt", IMAGE);

  // 标签：标题取文件名、是当前标签
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(IMAGE);
  await expect(page.getByRole("tab", { name: IMAGE })).toHaveCount(1);

  // 适配口径：不设 width/height 属性，越界由 CSS 收住（小图不放大，与 lightbox 同源）
  expect(await viewerImage(page).evaluate((el) => el.getAttribute("width"))).toBeNull();
  const style = await viewerImage(page).evaluate((el) => {
    const computed = getComputedStyle(el);
    return { maxWidth: computed.maxWidth, maxHeight: computed.maxHeight, fit: computed.objectFit };
  });
  expect(style.maxWidth).toBe("100%");
  expect(style.maxHeight).toBe("100%");
  expect(style.fit).toBe("contain");

  // modeline 右段（D5）：标签 + 宽×高 + 文件大小（69 字节的合成 1×1 PNG）
  await expect(page.locator(".modeline-meta")).toHaveText("图片 · 1×1 · 69 B");
  await expect(page.locator(".modeline-path")).toHaveText(IMAGE);

  // 无 D25、无失败占位、无破图、无对话框
  await expect(page.locator("body")).not.toContainText("暂不支持预览");
  await expect(page.locator(".editor-notice")).toBeHidden();
  await expect(page.locator(".image-viewer .cm-lp-image-error")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("双击图片：打开既有放大遮罩，放大图与查看面取同一份图像源（不重读字节）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openImage(page, IMAGE);
  const readsBefore = await readsOf(page, IMAGE);

  await viewerImage(page).dblclick();

  const overlay = page.locator(".lumir-lightbox-overlay");
  await expect(overlay).toBeVisible();
  const overlaySrc = await overlay
    .locator("img.lumir-lightbox-img")
    .evaluate((el) => (el as HTMLImageElement).src);
  const viewerSrc = await viewerImage(page).evaluate((el) => (el as HTMLImageElement).src);
  expect(viewerSrc.startsWith("data:image/png;base64,")).toBe(true);
  // 同一 data: URL 串（lightbox 侧命中已解码位图）——逐字相同，且没有多读一次字节
  expect(overlaySrc).toBe(viewerSrc);
  expect(await readsOf(page, IMAGE)).toBe(readsBefore);

  // Esc 关闭：回到图片标签，查看面仍在
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await expect(page.locator(".image-viewer")).toBeVisible();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(IMAGE);
});

test("坏图：占位与人话（D113）、无破图、无对话框、不退回 D25", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await stubTauri(page, VAULT);
  await page.goto("/");

  await page.locator(`.ft-row[title="${BROKEN}"]`).click();

  const chip = page.locator(".image-viewer .cm-lp-image-error");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(`图片无法显示：${BROKEN}`);
  await expect(page.locator(".image-viewer img")).toHaveCount(0); // 破图图标的结构判据：没有 <img>
  await expect(page.locator("body")).not.toContainText("暂不支持预览");
  // 失败是终态：右段只显示标签（MUST NOT 冒充 0×0 读数）
  await expect(page.locator(".modeline-meta")).toHaveText("图片");
  // 标签仍在、可关
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(BROKEN);
  expect(dialogs).toEqual([]);
});

test("读取失败：占位点名路径与原因（D112），标签仍在", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    failures: { fs_read_attachment: { code: "fs_denied", message: "fixture read failure" } },
  });
  await page.goto("/");

  await page.locator(`.ft-row[title="${IMAGE}"]`).click();

  const chip = page.locator(".image-viewer .cm-lp-image-error");
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(`图片读取失败：${IMAGE}（fixture read failure）`);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(IMAGE);
  await expect(page.locator("body")).not.toContainText("暂不支持预览");
});

test("切走再切回图片标签：按 D3 重读一次（读取计数 1 → 1 → 2）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openImage(page, IMAGE);
  expect(await readsOf(page, IMAGE)).toBe(1);

  // 切到文档：查看面离场（D3：释放当前图片的字节）
  await page.locator(`.ft-row[title="${NOTE}"]`).click();
  await expect(page.locator(".cm-content")).toContainText("正文只有这一行");
  await expect(page.locator(".image-viewer")).toBeHidden();
  expect(await readsOf(page, IMAGE)).toBe(1);

  // 切回：查看面重新装载（IPC + base64 再来一次）
  await page.locator(`.ft-row[title="${IMAGE}"]`).click();
  await expect(page.locator(".image-viewer")).toBeVisible();
  await expect.poll(() => readsOf(page, IMAGE)).toBe(2);
  await expect
    .poll(async () => viewerImage(page).evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(1);
});

test("反向：PDF 仍走 D25（图片分流没有误伤二进制）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");

  await page.locator(`.ft-row[title="${BINARY}"]`).click();

  await expect(page.locator(".editor-notice")).toContainText(`暂不支持预览：${BINARY}`);
  await expect(page.locator(".image-viewer")).toBeHidden();
  await expect(page.locator(".tab")).toHaveCount(0);
});

test("图片会话结构性只读：CM 是哨兵空状态、⌘S 零写入、搜索面板空态", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");

  // 先打开一篇文档（它的内容不该被图片标签继承）
  await page.locator(`.ft-row[title="${NOTE}"]`).click();
  await expect(page.locator(".cm-content")).toContainText("正文只有这一行");

  await openImage(page, IMAGE);
  // 哨兵空状态：上一份文档的正文不在 CM 里（design §1.3：MUST NOT 留着上一份文档的状态）
  await expect(page.locator(".cm-content")).toHaveText("");
  await expect(page.locator(".cm-content")).not.toHaveAttribute("contenteditable", "true");

  // 大纲不显示（M629）：modeline 的当前位置指示段离场；⌘⇧O 是空动作（MUST NOT 弹浮层、
  // MUST NOT 给「这份文档还没有标题」这类错话）。
  await expect(page.locator(".modeline-section")).toBeHidden();
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toc")).toBeHidden();
  await expect(page.locator(".lumir-toast")).toHaveCount(0);

  // ⌘S 没有任何落点：零 document_write、无保存提示、dirty 镜像不上报
  await page.keyboard.press("Meta+s");
  expect(await documentWrites(page)).toHaveLength(0);
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
  expect(await dirtyReports(page)).not.toContain(true);

  // 搜索面板照常打开，但没有内容可搜（0/0），也不显示上一份文档的内容
  await page.keyboard.press("Meta+f");
  await expect(page.locator(".lumir-search")).toBeVisible();
  await expect(page.locator(".lumir-search-count")).toHaveText("0/0");

  // 关掉图片标签：回到文档标签，文档内容原样（切标签不重建文档）
  await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+w");
  await expect(page.locator(".image-viewer")).toBeHidden();
  await expect(page.locator(".cm-content")).toContainText("正文只有这一行");
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(NOTE);
});

test("会话恢复：图片标签回到原位，成为前台时自动装载", async ({ page }) => {
  await stubTauri(page, {
    ...VAULT,
    sessions: { "fixture-vault": { tabs: [NOTE, IMAGE], active: IMAGE } },
  });
  await page.goto("/");

  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText(IMAGE);
  await expect(page.locator(".image-viewer")).toBeVisible();
  await expect
    .poll(async () => viewerImage(page).evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(1);
  // 恢复失败不静默丢标签的反向对照：两个标签都在
  await expect(page.getByRole("tab", { name: NOTE })).toHaveCount(1);
  await expect(page.getByRole("tab", { name: IMAGE })).toHaveCount(1);
});

test("合成 PNG 常量自证：桩应答的 base64 解码后是 69 字节的 PNG 头", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openImage(page, IMAGE);
  const probe = await viewerImage(page).evaluate((el) => {
    const img = el as HTMLImageElement;
    const payload = img.src.slice(img.src.indexOf(",") + 1);
    const bytes = atob(payload);
    return { length: bytes.length, head: bytes.slice(1, 4) };
  });
  expect(probe.length).toBe(69);
  expect(probe.head).toBe("PNG");
  expect(SYNTHETIC_PNG_BASE64.startsWith("iVBORw0KGgo")).toBe(true);
});
