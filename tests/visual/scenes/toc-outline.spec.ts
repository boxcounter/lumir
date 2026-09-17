import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 轻量大纲（M148，toc-outline capability）的视觉与交互回归。
//
// 为什么要有这个场景（两条都是实测结论，不是设想）：
//   1. **整页基线抓不到指示段**：masthead 指示段只改约 100 个像素，而整页容差
//      `maxDiffPixelRatio: 0.001`（1200×800 ≈ 960 px）把它整个吞掉了——`--update` 跑完
//      15 张基线逐字节零变化、普通模式也照样绿。也就是说：只靠既有整页场景，指示段与浮层
//      的视觉回归没有任何机器防线（REVIEW.md 第 3 条同族）。
//   2. **真机套件验不了缩进与精确光标**：AX 不暴露缩进，也不暴露选区；13-toc 只能用派生证据
//      间接判「光标落在标题行尾」。
// 因此这里补一条 chromium 场景：浮层元素级截图（只钉浮层自身，容差按元素盒算）+ 直接读
// CodeMirror 选区（`cmTile.root.view`，与 m131 场景同款）——精确断言「跳转落点 = 标题行尾」，
// 与 13-toc 的真机口径互补。
//
// 已知边界：键盘注入在这条通道上是可靠的（chromium 直连，不经 KimiCU），所以导航与跳转的
// 语义在这里判；WKWebView 下的真实手感仍只看 13-toc 的截图与 Alex 的手感项。

const DOC = `# 第一部分
第一部分说明段落。

## 甲小节
甲小节正文。

### 甲小节细节
细节正文。

## 乙小节
乙小节正文。

### 乙小节细节
乙小节细节正文。
`;

const PLAIN_DOC = "纯文本文档，没有任何标题。\n\n第二段正文。\n";

const VAULT: VaultFixture = {
  entries: [
    { path: "toc.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "toc-plain.md", kind: "file", size: PLAIN_DOC.length, mtime_ms: 0 },
  ],
  files: { "toc.md": DOC, "toc-plain.md": PLAIN_DOC },
  links: {},
};

/** 1-based 行首偏移（与 `doc.line(n).to` 口径一致）。 */
function lineEnd(doc: string, lineNumber: number): number {
  let pos = 0;
  for (let n = 1; n < lineNumber; n++) pos = doc.indexOf("\n", pos) + 1;
  const next = doc.indexOf("\n", pos);
  return next === -1 ? doc.length : next;
}

function lineNumberAt(doc: string, needle: string): number {
  return doc.slice(0, doc.indexOf(needle)).split("\n").length;
}

interface Caret {
  head: number;
  line: number;
}

async function caret(page: Page): Promise<Caret> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    return { head: main.head, line: view.state.doc.lineAt(main.head).number };
  });
}

async function openToc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="toc.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一部分说明段落");
}

test("位置指示段：有标题的文件显示当前标题链，无标题 / 空态不显示", async ({ page }) => {
  await openToc(page);
  const indicator = page.locator(".masthead-section");
  await expect(indicator).toBeVisible();
  // 光标在文档首（装载时复位到 0），第一行就是 H1 → 链路只有它自己
  await expect(indicator).toHaveText("第一部分");

  // 换到无标题文档：指示段收起（它声称的是「当前文件里的位置」，没有位置可指）
  await page.locator('.ft-row[title="toc-plain.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("纯文本文档");
  await expect(page.locator(".masthead-section")).toBeHidden();

  // 空态（无 vault）：SAMPLE 文档有标题，但没有当前文件，指示段同样不显示
  await stubTauri(page, null);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("标题一");
  await expect(page.locator(".masthead-section")).toBeHidden();
});

test("浮层：层级缩进、当前段高亮、键盘导航与跳转落点", async ({ page }) => {
  await openToc(page);
  await page.locator(".masthead-section").click();

  const list = page.locator(".lumir-toc-list");
  await expect(list).toBeVisible();
  await expect(page.locator(".lumir-toc-item")).toHaveCount(5);
  // 层级缩进：以文档最浅层标题（这里是 H1）为基准归一 → 0/1/2/1/2
  await expect(page.locator(".lumir-toc-item")).toHaveText([
    "第一部分",
    "甲小节",
    "甲小节细节",
    "乙小节",
    "乙小节细节",
  ]);
  expect(
    await page.locator(".lumir-toc-item").evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
    ),
  ).toEqual(["0", "1", "2", "1", "2"]);
  // 当前段高亮 + 键位提示（浮层内键位就地消费，界面上必须自报用法）
  await expect(page.locator(".lumir-toc-item.is-current")).toHaveCount(1);
  await expect(page.locator(".lumir-toc-item.is-current")).toHaveText("第一部分");
  await expect(page.locator(".lumir-toc-hint")).toHaveText("↑↓ 选择 · Enter 跳转 · Esc 关闭");
  // 浮层只占浮层自己的位置：文档区没有被推开（masthead 高度不变，指示段仍在同一行）
  await expect(page.locator(".lumir-toc")).toHaveScreenshot("toc-popover.png");

  // ↓ 移动键盘游标（不穿透到文档：文档内容不变）
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".lumir-toc-item.is-active")).toHaveText("甲小节");
  await expect(page.locator(".cm-content")).toContainText("甲小节正文"); // 文档还是原文

  // Enter 跳转：浮层收起，光标落在该标题行尾（精确到字符偏移），视口居中
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-toc")).toBeHidden();
  const expected = lineEnd(DOC, lineNumberAt(DOC, "## 甲小节"));
  await expect.poll(() => caret(page), { message: "跳转后光标应落在甲小节标题行尾" }).toEqual({
    head: expected,
    line: lineNumberAt(DOC, "## 甲小节"),
  });

  // ⌘⇧O 打开（键盘入口）→ Esc 关闭，且不动文档与光标
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toc")).toBeVisible();
  await expect(page.locator(".lumir-toc-item.is-current")).toHaveText("甲小节");
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-toc")).toBeHidden();
  expect(await caret(page)).toEqual({ head: expected, line: lineNumberAt(DOC, "## 甲小节") });
});
