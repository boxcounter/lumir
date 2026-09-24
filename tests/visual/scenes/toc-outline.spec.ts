import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 轻量大纲（M148，toc-outline capability）的视觉与交互回归。
//
// 为什么要有这个场景（两条都是实测结论，不是设想）：
//   1. **整页基线抓不到指示段**：位置指示段只改约 100 个像素（M148 时在 masthead，restyle
//      后迁到 modeline），而整页容差 `maxDiffPixelRatio: 0.001`（1200×800 ≈ 960 px）把它整个
//      吞掉了——`--update` 跑完 15 张基线逐字节零变化、普通模式也照样绿。也就是说：只靠既有
//      整页场景，指示段与浮层的视觉回归没有任何机器防线（REVIEW.md 第 3 条同族）。
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

// 标题数远超一屏的文档（60 条 = 15 章 × H1–H4）：条目内容高 ≈ 1530px，远高于 80vh，
// 浮层因此顶到高度上限、列表成为唯一滚动容器。真机侧的同一形状见
// scripts/acceptance/fixtures/toc-long.md（两套套件各自持有 fixture：视觉套件走 chromium
// 直连、不能读验收 vault，故这里按同一形状生成）。
const LONG_DOC = Array.from({ length: 15 }, (_, index) => {
  const chapter = index + 1;
  return [
    `# 第 ${chapter} 章 概览`,
    `第 ${chapter} 章概览正文。`,
    "",
    `## 第 ${chapter} 章 小节`,
    `第 ${chapter} 章小节正文。`,
    "",
    `### 第 ${chapter} 章 细目`,
    `第 ${chapter} 章细目正文。`,
    "",
    `#### 第 ${chapter} 章 深一层`,
    `第 ${chapter} 章深一层正文。`,
    "",
  ].join("\n");
}).join("\n");

const VAULT: VaultFixture = {
  entries: [
    { path: "toc.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "toc-plain.md", kind: "file", size: PLAIN_DOC.length, mtime_ms: 0 },
    { path: "toc-long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
  ],
  files: { "toc.md": DOC, "toc-plain.md": PLAIN_DOC, "toc-long.md": LONG_DOC },
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

/** 编辑器文档全文（逐字节比较用：`⌃N` 只该移动光标，不该改任何字节）。 */
async function docText(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view.state.doc.toString(),
  );
}

async function openToc(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="toc.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一部分说明段落");
}

test("位置指示段：有标题的文件显示当前标题链，无标题 / 空态不显示", async ({ page }) => {
  await openToc(page);
  const indicator = page.locator(".modeline-section");
  await expect(indicator).toBeVisible();
  // 光标在文档首（装载时复位到 0），第一行就是 H1 → 链路只有它自己
  await expect(indicator).toHaveText("第一部分");

  // 换到无标题文档：指示段收起（它声称的是「当前文件里的位置」，没有位置可指）
  await page.locator('.ft-row[title="toc-plain.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("纯文本文档");
  await expect(page.locator(".modeline-section")).toBeHidden();

  // 空态（无 vault）：SAMPLE 文档有标题，但没有当前文件，指示段同样不显示
  await stubTauri(page, null);
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("标题一");
  await expect(page.locator(".modeline-section")).toBeHidden();
});

test("浮层：层级缩进、当前段高亮、键盘导航与跳转落点", async ({ page }) => {
  await openToc(page);
  await page.locator(".modeline-section").click();

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
  await expect(page.locator(".lumir-toc-hint")).toHaveText("↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭");
  // 浮层只占浮层自己的位置：文档区没有被推开（modeline 高度不变，指示段仍在同一行）
  await expectScreenshot(page.locator(".lumir-toc"), "toc-popover.png");

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

  // ⌘⇧O 打开（键盘入口）
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toc")).toBeVisible();
  await expect(page.locator(".lumir-toc-item.is-current")).toHaveText("甲小节");

  // ⌃N / ⌃P 与 ↑↓ 完全等价（Emacs next-line / previous-line）：同一 move 实现、同一钳制口径
  const active = page.locator(".lumir-toc-item.is-active");
  await page.keyboard.press("Control+n");
  await expect(active).toHaveText("甲小节细节");
  await page.keyboard.press("Control+p");
  await expect(active).toHaveText("甲小节");
  // 一路 ⌃N 到底：末项再按不动（Emacs 的 C-n 在末行同样是停止而非回卷）
  for (let i = 0; i < 8; i++) await page.keyboard.press("Control+n");
  await expect(active).toHaveText("乙小节细节");
  await page.keyboard.press("Control+n");
  await expect(active).toHaveText("乙小节细节");
  // 一路 ⌃P 到顶：首项同样钳制
  for (let i = 0; i < 8; i++) await page.keyboard.press("Control+p");
  await expect(active).toHaveText("第一部分");
  await page.keyboard.press("Control+p");
  await expect(active).toHaveText("第一部分");
  // 浮层里的 ⌃N / ⌃P 不穿透文档：光标仍在跳转后的落点，文档逐字节不变
  const beforeText = await docText(page);
  expect(await caret(page)).toEqual({ head: expected, line: lineNumberAt(DOC, "## 甲小节") });

  // Esc 关闭 → ⌃N 归还编辑器（同一物理键换归属）：光标真的下移一行、文档逐字节不变
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-toc")).toBeHidden();
  const beforeCaret = await caret(page);
  await page.keyboard.press("Control+n");
  await expect.poll(() => caret(page).then((now) => now.line), { message: "关闭后 ⌃N 应交还编辑器：光标下移一行" }).toBe(
    beforeCaret.line + 1,
  );
  expect(await docText(page)).toBe(beforeText);
});

test("浮层总高上限：窗口高 80%（含底部提示），列表在浮层内滚动、提示常驻且随窗口变化", async ({ page }) => {
  await openToc(page);
  await page.locator('.ft-row[title="toc-long.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第 1 章概览正文。");
  await page.locator(".modeline-section").click();

  const popover = page.locator(".lumir-toc");
  const list = page.locator(".lumir-toc-list");
  const hint = page.locator(".lumir-toc-hint");
  await expect(list).toBeVisible();
  await expect(page.locator(".lumir-toc-item")).toHaveCount(60);

  // 窗口「内容区高」取 documentElement.clientHeight：`vh` 的基准就是它，而 innerHeight
  // 在有经典滚动条时更大——用后者会让「恰好等于 80%」的读数看起来偏小。
  const geometry = () =>
    page.evaluate(() => {
      const popoverEl = document.querySelector(".lumir-toc") as HTMLElement;
      const listEl = document.querySelector(".lumir-toc-list") as HTMLElement;
      return {
        height: popoverEl.getBoundingClientRect().height,
        viewport: document.documentElement.clientHeight,
        listScroll: listEl.scrollHeight,
        listClient: listEl.clientHeight,
      };
    });

  // 60 条条目远超一屏，浮层顶到上限：读数既不超过 80%，也必须真的用满。
  // **下限才是这条断言的区分度**——旧的 `max-height: 55vh` 只约束列表、提示与内边距在
  // 上限之外（800px 窗口下约 486px），单判「不超过 80%」会静默通过（REVIEW.md 第 1 条）。
  let geo = await geometry();
  expect(geo.height).toBeLessThanOrEqual(geo.viewport * 0.8 + 0.5);
  expect(geo.height).toBeGreaterThan(geo.viewport * 0.8 - 1.5);
  // 列表是唯一滚动容器（内容高于可视高），底部提示仍可见——提示常驻是 requirement
  expect(geo.listScroll).toBeGreaterThan(geo.listClient);
  await expect(hint).toBeVisible();
  await expect(page.locator(".lumir-toc-item.is-active")).toHaveText("第 1 章 概览");
  await expectScreenshot(popover, "toc-popover-long.png");

  // 改窗口内容区高：上限跟着变，浮层保持打开（不必重开）
  await page.setViewportSize({ width: 1200, height: 400 });
  await expect.poll(() => geometry().then((now) => now.viewport), { message: "视口高应变为 400" }).toBe(400);
  geo = await geometry();
  expect(geo.height).toBeLessThanOrEqual(geo.viewport * 0.8 + 0.5);
  expect(geo.height).toBeGreaterThan(geo.viewport * 0.8 - 1.5);
  expect(geo.listScroll).toBeGreaterThan(geo.listClient);
  await expect(popover).toBeVisible();
  await expect(hint).toBeVisible();
});
