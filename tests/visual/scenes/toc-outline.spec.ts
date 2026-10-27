import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { SCROLL_SETTLE_TIMEOUT } from "./poll-budgets";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 轻量大纲（M148，toc-outline capability）的视觉与交互回归。
//
// 为什么要有这个场景（两条都是实测结论，不是设想）：
//   1. **整页基线抓不到指示段**：位置指示段只改约 100 个像素（M148 时在 masthead，restyle
//      后迁到 modeline），而整页容差 `maxDiffPixelRatio: 0.001`（1200×800 ≈ 960 px）把它整个
//      吞掉了——`--update` 跑完 15 张基线逐字节零变化、普通模式也照样绿。也就是说：只靠既有
//      整页场景，指示段与浮层的视觉回归没有任何机器防线（REVIEW.md 「容差吞掉真实变化」条同族）。
//   2. **真机套件验不了缩进与精确光标**：AX 不暴露缩进，也不暴露选区；`13-toc` 只能用
//      派生证据间接判「光标落在标题行尾」。该场景**保留**（M754 为它新增了长文中段跳转的
//      选区 + 视口真机回归），本文件补的是同语义的更精确判据。
// 因此这里补一条 chromium 场景：浮层元素级截图（只钉浮层自身，容差按元素盒算）+ 直接读
// CodeMirror 选区（`cmTile.root.view`，与 m131 场景同款）——精确断言「跳转落点 = 标题行尾」。
//
// 已知边界：键盘注入在这条通道上是可靠的（chromium 直连，不经 KimiCU），所以导航与跳转的
// 语义在这里判；WKWebView 下的真实手感仍归 Alex 的手感项（真机侧只留「⌘⇧O 在 WKWebView 里
// 被前端截获」这一步，由核心批的键位场景家族覆盖）。

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

/** 六层标题各一条：真机场景 13-toc 断言 H1–H6 全覆盖，这里补同语义的精确判据
 *  （真机 fixture `toc-outline.md` 只到 H3、`toc-long.md` 只到 H4，都用不上）。 */
const LEVELS_DOC = [
  "# 一级标题",
  "一级正文。",
  "",
  "## 二级标题",
  "二级正文。",
  "",
  "### 三级标题",
  "三级正文。",
  "",
  "#### 四级标题",
  "四级正文。",
  "",
  "##### 五级标题",
  "五级正文。",
  "",
  "###### 六级标题",
  "六级正文。",
  "",
].join("\n");

/** frontmatter 里的 YAML 注释行：lezer 会把它解析成 ATXHeading1，大纲必须按 frontmatter 边界排除。 */
const FRONTMATTER_DOC = ["---", "title: 边界", "# 幽灵标题", "---", "", "# 前言下的真标题", "真标题正文。", ""].join("\n");

// 用户报告的形状（M754）：长文里标题之间夹着长代码块，相邻标题相距一到两屏——从文档中段
// 跳到另一处必须真有视口位移，才谈得上「跳过去了没有」。真实文档（342 行）只读、正文不得入库，
// 这里按形状重建：1 个 H1 + 15 个 H2 + 3 个 H3 + 15 个 16 行代码块（360 行），
// 与 `scripts/acceptance/fixtures/toc-long-code.md` 逐字节同形（两套套件各自持有 fixture：
// 视觉套件走 chromium 直连，读不到验收 vault）。
const LONG_CODE_DOC = (() => {
  const parts = ["# 长文总览", "", "总览正文说明。", ""];
  for (let chapter = 1; chapter <= 15; chapter++) {
    const code = Array.from(
      { length: 16 },
      (_, index) => `const 常量${chapter}_${index + 1} = 计算(${index + 1});`,
    ).join("\n");
    parts.push(`## 第 ${chapter} 节 标题`, "", `第 ${chapter} 节正文说明。`, "", "```ts", code, "```", "");
    if (chapter === 3 || chapter === 9 || chapter === 13) {
      parts.push(`### 第 ${chapter} 节 细节`, "", `第 ${chapter} 节细节说明。`, "");
    }
  }
  return parts.join("\n");
})();

const VAULT: VaultFixture = {
  entries: [
    { path: "toc.md", kind: "file", size: DOC.length, mtime_ms: 0 },
    { path: "toc-plain.md", kind: "file", size: PLAIN_DOC.length, mtime_ms: 0 },
    { path: "toc-long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
    { path: "levels.md", kind: "file", size: LEVELS_DOC.length, mtime_ms: 0 },
    { path: "frontmatter.md", kind: "file", size: FRONTMATTER_DOC.length, mtime_ms: 0 },
    { path: "toc-long-code.md", kind: "file", size: LONG_CODE_DOC.length, mtime_ms: 0 },
  ],
  files: {
    "toc.md": DOC,
    "toc-plain.md": PLAIN_DOC,
    "toc-long.md": LONG_DOC,
    "levels.md": LEVELS_DOC,
    "frontmatter.md": FRONTMATTER_DOC,
    "toc-long-code.md": LONG_CODE_DOC,
  },
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

// ---------------------------------------------------------------------------
// 13-toc 的同语义补强（2026-10-27，M750）：真机那侧保留（M754 新增了长文中段跳转的选区 +
// 视口回归）；下列语义在 chromium 上判得更精确——AX 不暴露条目缩进、也不暴露选区。
// ---------------------------------------------------------------------------

test("鼠标点条目跳转：浮层收起、光标落在标题行尾（真机的 AXPress 路径）", async ({ page }) => {
  await openToc(page);
  await page.locator(".modeline-section").click();
  await expect(page.locator(".lumir-toc-item")).toHaveCount(5);

  await page.locator(".lumir-toc-item", { hasText: /^乙小节$/ }).click();
  await expect(page.locator(".lumir-toc")).toBeHidden();
  const line = lineNumberAt(DOC, "## 乙小节");
  await expect.poll(() => caret(page), { message: "鼠标跳转后光标应落在乙小节标题行尾" }).toEqual({
    head: lineEnd(DOC, line),
    line,
  });
  // 跳转只动光标与视口，不改文档
  expect(await docText(page)).toBe(DOC);
});

test("H1–H6 全覆盖；frontmatter 里的 # 注释不混进大纲", async ({ page }) => {
  await openToc(page);

  // H1–H6 各一条：条目文本与归一深度逐条对（深度 = level − 最浅层 level）
  await page.locator('.ft-row[title="levels.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("一级正文。");
  await page.locator(".modeline-section").click();
  await expect(page.locator(".lumir-toc-item")).toHaveText([
    "一级标题",
    "二级标题",
    "三级标题",
    "四级标题",
    "五级标题",
    "六级标题",
  ]);
  expect(
    await page.locator(".lumir-toc-item").evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).style.getPropertyValue("--toc-depth")),
    ),
  ).toEqual(["0", "1", "2", "3", "4", "5"]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-toc")).toBeHidden();

  // frontmatter 边界：YAML 注释行（`# 幽灵标题`）在正文里不存在，也不得成为大纲条目。
  // 打开 fm 文档时光标落在首部（指示段因此收起——链条为空），入口走 ⌘⇧O，与真机场景
  // 13-toc「frontmatter 边界」一腿同形。
  await page.locator('.ft-row[title="frontmatter.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("真标题正文。");
  await expect(page.locator(".modeline-section")).toBeHidden();
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toc-item")).toHaveText(["前言下的真标题"]);
  await expect(page.locator(".lumir-toc-item", { hasText: "幽灵标题" })).toHaveCount(0);
});

test("无标题文档：给提示、不弹空浮层（文案 D84）", async ({ page }) => {
  await openToc(page);
  await page.locator('.ft-row[title="toc-plain.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("纯文本文档");

  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toast", { hasText: "这份文档还没有标题" })).toBeVisible();
  await expect(page.locator(".lumir-toc")).toBeHidden();
});

test("几何：浮层宽 26em（325px）、贴指示段左端与 modeline 上沿，条目 26px 行高 / 18px 层级步进", async ({ page }) => {
  // M217 新 TOC 表面的几何层钉（结构断言抓不到定位漂移）：浮层宽度、锚点（place() 横向对
  // 指示段左端、CSS `bottom: 100%` 纵向贴 modeline 上沿）与条目行几何（定稿 .pop-row：
  // h26 / 左 padding = --sp-4 + depth×18px，index.html:697-704）。
  // M702 起宽度走 L 档 `min(26em, 100vw − 28px)`：容器 font-size = 行文本 12.5px ⇒ 325px，
  // 旧定值 300px 在典型 48 字符路径上恰好裁掉 8.8%（M698 §3.1）。
  await openToc(page);
  await page.locator(".modeline-section").click();
  await expect(page.locator(".lumir-toc-list")).toBeVisible();

  const geo = await page.evaluate(() => {
    const popover = document.querySelector(".lumir-toc") as HTMLElement;
    const indicator = document.querySelector(".modeline-section") as HTMLElement;
    const modeline = popover.offsetParent as HTMLElement;
    const p = popover.getBoundingClientRect();
    return {
      width: p.width,
      popoverBottom: p.bottom,
      popoverLeft: p.left,
      indicatorLeft: indicator.getBoundingClientRect().left,
      modelineTop: modeline.getBoundingClientRect().top,
    };
  });
  expect(geo.width).toBe(325);
  expect(Math.abs(geo.popoverBottom - geo.modelineTop)).toBeLessThanOrEqual(1); // 向上展开贴上沿
  expect(Math.abs(geo.popoverLeft - geo.indicatorLeft)).toBeLessThanOrEqual(1); // place() 对左端

  const items = await page.locator(".lumir-toc-item").evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        height: (el as HTMLElement).getBoundingClientRect().height,
        paddingLeft: cs.paddingLeft,
        fontSize: cs.fontSize,
      };
    }),
  );
  for (const item of items) {
    expect(item.height).toBe(26);
    expect(item.fontSize).toBe("12.5px"); // --fs-ui-s
  }
  // 层级缩进的**像素**结果（--toc-depth 变量值在上面用例钉，这里钉它兑现出来的几何）：
  // 归一深度 0/1/2/1/2 → 8 + depth×18
  expect(items.map((item) => item.paddingLeft)).toEqual(["8px", "26px", "44px", "26px", "44px"]);
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
  // 上限之外（800px 窗口下约 486px），单判「不超过 80%」会静默通过（REVIEW.md 「断言等价于子串」条）。
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
  await expect
    .poll(() => geometry().then((now) => now.viewport), { message: "视口高应变为 400", timeout: SCROLL_SETTLE_TIMEOUT })
    .toBe(400);
  geo = await geometry();
  expect(geo.height).toBeLessThanOrEqual(geo.viewport * 0.8 + 0.5);
  expect(geo.height).toBeGreaterThan(geo.viewport * 0.8 - 1.5);
  expect(geo.listScroll).toBeGreaterThan(geo.listClient);
  await expect(popover).toBeVisible();
  await expect(hint).toBeVisible();
});

// ---------------------------------------------------------------------------
// M754：长文里「点了条目但没跳过去」——跳转必须同时钉**选区**与**实际视口**
// ---------------------------------------------------------------------------
//
// 缺陷形态：`jumpTo` 先 `close()`，而 `close()` 走「交还焦点保持阅读位置」的原语——它会把
// **跳转前**捕获的位置在下一帧再写回一次，于是刚发出的 `scrollIntoView(目标标题)` 被覆盖：
// 光标落在目标标题行尾、视口却留在原处（= 用户说的「点了没跳过去」）。写回对锚 = 0 提前
// 返回，所以从文档顶端跳永远正常、从文档中段跳才复发——这就是「有时候」。
//
// 判据取 spec（openspec/specs/toc-outline/spec.md 的「跳转 SHALL 只改变选区与视口」条款）：
// 光标落在目标标题行行尾 + 该行滚到视口居中。**只断言选区会漏掉整个缺陷**（选区那一半一直
// 是对的），因此这里两条成对断言。读数一律取几何量（`coordsAtPos` × 滚动容器 rect），
// MUST NOT 用「浮层已收起」当跳转成功的证据（浮层收起在两条路径上都成立，零区分度）。
//
// 时序（REVIEW.md「断言等价于子串」条同族的时序假绿）：缺陷是「先跳到目标 → 下一帧被拽回」，
// 所以判据 MUST 在滚动**停稳之后**读，不能 poll——poll 会撞上中间态而假绿。

/** 滚动容器的 scrollTop（几何读数，不判函数被调用过）。 */
function scrollTop(page: Page): Promise<number> {
  return page.locator(".cm-scroller").evaluate((el) => el.scrollTop);
}

/** 把视口摆到含 `needle` 的那一行（arrange，不参与判据；坐标取 CM 自己的行块，与字体布局无关）。 */
async function scrollToText(page: Page, needle: string): Promise<void> {
  await page.evaluate((text) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const doc: string = view.state.doc.toString();
    const at = doc.indexOf(text);
    if (at < 0) throw new Error(`文档里没有「${text}」`);
    view.scrollDOM.scrollTop = view.lineBlockAt(at).top;
  }, needle);
}

/**
 * 等滚动停稳：连续 5 帧 `scrollTop` 不变才返回（上限 40 帧）。
 * 本次缺陷的第二拍（阅读位置写回）落在跳转后的 1–2 帧，判据必须等它落地再读。
 */
async function settleScroll(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const scroller = document.querySelector(".cm-scroller") as HTMLElement;
        let last = scroller.scrollTop;
        let stable = 0;
        let frames = 0;
        const tick = (): void => {
          frames += 1;
          const now = scroller.scrollTop;
          stable = Math.abs(now - last) < 0.5 ? stable + 1 : 0;
          last = now;
          if (stable >= 5 || frames >= 40) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

interface ViewportReading {
  scrollTop: number;
  viewportTop: number;
  viewportBottom: number;
  /** 目标标题行字符盒的上下沿（视口坐标）；`coordsAtPos` 读不到时为 null——调用方按 FAIL 处理
   *  （「读不到」不等于「不在视口里」，REVIEW.md「读不到当成空」条）。 */
  headingTop: number | null;
  headingBottom: number | null;
  /** 标题行中心相对视口中心的偏移（`scrollIntoView({y:"center"})` 的落点判据）。 */
  centerOffset: number;
  /** 视口顶那一行原文（高度 = scrollTop 的行块，与阅读位置的捕获口径同一算式）。 */
  topLine: string;
}

/** 读「目标标题行相对视口」的几何读数。 */
function viewportReading(page: Page, needle: string): Promise<ViewportReading> {
  return page.evaluate((text) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const scroller = view.scrollDOM as HTMLElement;
    const box = scroller.getBoundingClientRect();
    const doc: string = view.state.doc.toString();
    const at = doc.indexOf(text);
    if (at < 0) throw new Error(`文档里没有「${text}」`);
    const line = view.state.doc.lineAt(at);
    const from = view.coordsAtPos(line.from);
    const to = view.coordsAtPos(line.to);
    return {
      scrollTop: scroller.scrollTop,
      viewportTop: box.top,
      viewportBottom: box.bottom,
      headingTop: from === null ? null : from.top,
      headingBottom: to === null ? null : to.bottom,
      centerOffset:
        from === null || to === null ? Number.NaN : (from.top + to.bottom) / 2 - (box.top + box.bottom) / 2,
      topLine: view.state.doc.lineAt(view.lineBlockAtHeight(scroller.scrollTop + 2).from).text as string,
    };
  }, needle);
}

/** 跳转落点判据（成对）：选区落在标题行行尾 + 视口揭示该行并把它放在居中位置。 */
async function expectJumpLanded(page: Page, doc: string, needle: string): Promise<void> {
  const expected = lineEnd(doc, lineNumberAt(doc, needle));
  await expect
    .poll(() => caret(page), { message: `跳转后光标应落在「${needle}」标题行尾` })
    .toEqual({ head: expected, line: lineNumberAt(doc, needle) });

  const reading = await viewportReading(page, needle);
  // 读不到（coordsAtPos 为 null）判 FAIL：负向断言不得在「读不到」上恒真。
  expect(reading.headingTop, `「${needle}」在渲染窗口里读不到字符盒`).not.toBeNull();
  expect(reading.headingTop as number).toBeGreaterThanOrEqual(reading.viewportTop - 1);
  expect(reading.headingBottom as number).toBeLessThanOrEqual(reading.viewportBottom + 1);
  // 「滚到视口居中」——与 ⌥G 跳行（m281）同一容差（±30px）。
  expect(Math.abs(reading.centerOffset), `「${needle}」没有滚到视口居中（偏移 ${reading.centerOffset}px）`).toBeLessThan(30);
}

/** 从浮层里跳到 `target`：`mouse` = 点条目，`keyboard` = 筛选后 Enter（同一 `jumpTo` 的两个入口）。 */
async function jumpViaPopover(page: Page, entry: "mouse" | "keyboard", target: string): Promise<void> {
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toc-list")).toBeVisible();
  if (entry === "mouse") {
    await page.locator(".lumir-toc-item", { hasText: target }).click();
  } else {
    // 筛选框打开即持焦：输入目标标题的唯一定位串，结果集只剩它，游标落在它上面，Enter 跳过去。
    await page.locator(".lumir-toc-input").fill(target);
    await expect(page.locator(".lumir-toc-item")).toHaveCount(1);
    await expect(page.locator(".lumir-toc-item.is-active")).toHaveText(target);
    await page.keyboard.press("Enter");
  }
  await expect(page.locator(".lumir-toc")).toBeHidden();
  await settleScroll(page);
}

test("长文跳转：从任意起跳位置点击 / Enter 远处条目，选区与视口都到目标标题", async ({ page }) => {
  await openToc(page);
  await page.locator('.ft-row[title="toc-long-code.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第 1 节正文说明。");

  // 前提：这份文档真的跨多屏（否则「视口揭示」与「没揭示」在几何上分不开）。
  const span = await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    return { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
  });
  expect(span.scrollHeight).toBeGreaterThan(span.clientHeight * 4);

  // --- 起跳点在文档中段（锚 ≠ 文档原点：唯一会让阅读位置写回提前返回的一档之外）---
  await scrollToText(page, "第 12 节正文说明。");
  await settleScroll(page);
  const before = await viewportReading(page, "第 3 节 标题");
  expect(before.scrollTop, "arrange 失败：视口还在文档原点").toBeGreaterThan(0);
  expect(before.topLine, "arrange 失败：视口顶仍停在首行").not.toBe("# 长文总览");
  expect(
    before.headingTop === null || before.headingTop > before.viewportBottom,
    "目标标题在起跳时就已经在视口里——这条判据没有输入",
  ).toBe(true);

  // 鼠标路径：向上跳数屏。
  await jumpViaPopover(page, "mouse", "第 3 节 标题");
  await expectJumpLanded(page, LONG_CODE_DOC, "第 3 节 标题");
  // 反向输入：起跳点那一节已经离开视口（「视口根本没动」不可能同时满足上面两条与这条）。
  expect((await viewportReading(page, "第 12 节正文说明。")).topLine).not.toBe("第 12 节正文说明。");

  // --- 键盘路径：同一 jumpTo，起跳点重新摆回中段，向下跳到另一处 ---
  await scrollToText(page, "第 12 节正文说明。");
  await settleScroll(page);
  await jumpViaPopover(page, "keyboard", "第 14 节 标题");
  await expectJumpLanded(page, LONG_CODE_DOC, "第 14 节 标题");

  // --- 起跳点在文档原点（写回提前返回的那一档）：同样必须揭示目标 ---
  await page.evaluate(() => {
    (document.querySelector(".cm-scroller") as HTMLElement).scrollTop = 0;
  });
  await settleScroll(page);
  expect(await scrollTop(page)).toBe(0);
  await jumpViaPopover(page, "mouse", "第 15 节 标题");
  await expectJumpLanded(page, LONG_CODE_DOC, "第 15 节 标题");
});
