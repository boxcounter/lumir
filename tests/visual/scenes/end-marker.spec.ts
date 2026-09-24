import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { copyFresh, readDocument } from "./parity-checks";

// 正文末尾的「到底了」标记（change document-end-marker）：
//   判据 = 不含标记的内容高度 > 可用视口高度（静态、重算型、MUST NOT 读滚动位置）；
//   形态 = 短线夹字（--border-soft 发丝线 + --text-3 弱化字），MUST NOT 与作者手写的通栏分隔线同形；
//   硬约束 = 不进 EditorState.doc / 不进保存字节 / 不被 ⌘A 带出 / 不被 ⌘F 命中 /
//            滚动高度在所有滚动位置逐像素恒定 / 纵向间距用 padding 不用 margin。
//
// 判据一律落**几何读数**（渲染盒宽高、线宽与栏宽的比、矩形位置）与**文本节点**，
// 不用「class 存在」（REVIEW.md 第 1 条）；负向断言都配正观测（REVIEW.md 第 2 条）。
const FIXTURES = {
  "end-marker-long.md": readFileSync(new URL("../fixtures/end-marker/long.md", import.meta.url), "utf8"),
  "end-marker-short.md": readFileSync(new URL("../fixtures/end-marker/short.md", import.meta.url), "utf8"),
  "end-marker-band.md": readFileSync(new URL("../fixtures/end-marker/band.md", import.meta.url), "utf8"),
} as const;
const NOTE = "end-marker-note.txt";
const NOTE_SOURCE = "纯文本没有 live preview 装饰层：code 模式不该出现标记。\n";

const MARKER = ".cm-lp-end-marker";
const MARKER_LINE = ".cm-lp-end-marker-line";
const MARKER_TEXT = ".cm-lp-end-marker-text";
/** deck D114 的可见文案（单一来源在 src/preview/endMarker.ts，此处按 deck 逐字再来一份）。 */
const TEXT = "到底了";
const TEXT_3 = "rgb(169, 167, 155)"; // --text-3（提示档：标记文字）
const HAIRLINE = "rgb(237, 236, 231)"; // --border-soft（层次档发丝线）
const ACCENT = "rgb(58, 95, 205)"; // --accent（新色板的链接色：标记 MUST NOT 使用）

const MARKER_FOR: Record<string, string> = {
  "end-marker-long.md": "结束标记场景（长文）",
  "end-marker-short.md": "结束标记场景（短文）",
  "end-marker-band.md": "结束标记场景（临界带）",
};

async function stub(page: Page): Promise<void> {
  const files: Record<string, string> = { ...FIXTURES, [NOTE]: NOTE_SOURCE };
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({ path, kind: "file", size: files[path].length, mtime_ms: 0 })),
    files,
  });
}

/** 打开一篇 fixture 文档：点左栏文件名，等它的标题上屏。 */
async function open(page: Page, file: keyof typeof FIXTURES | typeof NOTE): Promise<void> {
  const needle = file === NOTE ? "纯文本没有 live preview" : MARKER_FOR[file];
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(needle);
}

const scroller = (page: Page) => page.locator(".cm-scroller");
const marker = (page: Page) => page.locator(MARKER);

/**
 * 不含标记的内容高度：`.cm-content` 的下内边距 + 其最后一个块级子节点相对内容盒顶部的
 * 距离。**不读 scrollHeight**——标记一旦在场，scrollHeight 就含标记自己的高度，用它去比
 * 正是本 change 要挡的自我指涉（design §2）。
 */
async function naturalContentHeight(page: Page): Promise<number> {
  return page.locator(".cm-content").evaluate((content) => {
    const last = content.lastElementChild as HTMLElement | null;
    if (!last) return 0;
    return (
      last.getBoundingClientRect().bottom -
      content.getBoundingClientRect().top +
      Number.parseFloat(getComputedStyle(content).paddingBottom)
    );
  });
}

/** 把可用视口高度（.cm-scroller 的 clientHeight）钉到目标值：先量窗口高与它的差再改窗口。 */
async function setClientHeight(page: Page, target: number): Promise<void> {
  const offset = await page.evaluate(
    () => window.innerHeight - (document.querySelector(".cm-scroller") as HTMLElement).clientHeight,
  );
  await page.setViewportSize({ width: 1200, height: Math.round(target + offset) });
  await expect.poll(() => scroller(page).evaluate((el) => el.clientHeight)).toBe(Math.round(target));
}

/** 滚到某个位置并让判据落定：CM 的滚动处理与判据重算都排在滚动后的测量周期里。 */
async function scrollTo(page: Page, where: "top" | "middle" | "bottom"): Promise<void> {
  await page.evaluate((pos) => {
    const el = document.querySelector(".cm-scroller") as HTMLElement;
    el.scrollTop = pos === "top" ? 0 : pos === "middle" ? (el.scrollHeight - el.clientHeight) / 2 : el.scrollHeight;
  }, where);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

/** 当前滚动位置上的一次几何读数（可滚动高度 / 可用高度 / 标记在场与否 / 标记的视口纵坐标）。 */
async function readMarker(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-scroller") as HTMLElement;
    const markers = [...document.querySelectorAll<HTMLElement>(".cm-lp-end-marker")];
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      count: markers.length,
      markerTop: markers[0]?.getBoundingClientRect().top ?? null,
    };
  });
}

test("一屏装不下时显示、装得下时不显示（配对正观测）", async ({ page }) => {
  await stub(page);
  await page.goto("/");

  // 长文：标记在场，渲染盒宽高均非零、水平居中于阅读栏、落在正文内容盒之下
  await open(page, "end-marker-long.md");
  await expect(marker(page)).toHaveCount(1);
  const box = await marker(page).evaluate((el) => {
    const content = document.querySelector(".cm-content") as HTMLElement;
    const rect = el.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      centerX: rect.left + rect.width / 2,
      contentCenterX: contentRect.left + contentRect.width / 2,
      top: rect.top,
      contentBottom: contentRect.bottom,
    };
  });
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(Math.abs(box.centerX - box.contentCenterX)).toBeLessThan(1);
  expect(box.top).toBeGreaterThanOrEqual(box.contentBottom - 1);

  // 短文：没有标记（渲染盒为零 —— 不读 scrollHeight 的判据在临界带之外的两端都要成立）
  await open(page, "end-marker-short.md");
  await expect(marker(page)).toHaveCount(0);
  const shortNatural = await naturalContentHeight(page);
  const shortViewport = await scroller(page).evaluate((el) => el.clientHeight);
  expect(shortNatural).toBeLessThan(shortViewport);

  // 配对正观测：把同一份短文压矮到装不下 → 标记出现（「不显示」不是恒真）
  await setClientHeight(page, shortNatural - 40);
  await expect(marker(page)).toHaveCount(1);

  // 反向配对：把视口放回很高 → 标记消失（判据是重算型，视口变化即重算）
  await setClientHeight(page, shortNatural + 200);
  await expect(marker(page)).toHaveCount(0);
});

test("临界带：内容高度落在（视口 − 标记高度, 视口] 内不显示", async ({ page }) => {
  await stub(page);
  await page.goto("/");

  // 标记自身的渲染盒高度先从长文量出来（临界带的宽度就是它）
  await open(page, "end-marker-long.md");
  await expect(marker(page)).toHaveCount(1);
  const markerHeight = await marker(page).evaluate((el) => el.getBoundingClientRect().height);
  expect(markerHeight).toBeGreaterThan(4);

  // 临界带 fixture：把可用视口高度钉到「内容高度 + 8」——内容落在带内，
  // 且带内文档**只因标记自身的高度**变成「装不下」（自我指涉的实现会在这里显示标记）
  await open(page, "end-marker-band.md");
  await expect(marker(page)).toHaveCount(0);
  const natural = await naturalContentHeight(page);
  await setClientHeight(page, natural + 8);
  const viewport = await scroller(page).evaluate((el) => el.clientHeight);
  // 先证明 fixture 真的落在带内（不是「明显装得下」的第三端）
  expect(natural).toBeGreaterThan(viewport - markerHeight);
  expect(natural).toBeLessThanOrEqual(viewport);
  await expect(marker(page)).toHaveCount(0);

  // 配对正观测：再压矮到明确装不下 → 标记出现
  await setClientHeight(page, natural - 120);
  await expect(marker(page)).toHaveCount(1);
});

test("判据不随滚动位置变化，滚动高度在所有滚动位置恒定", async ({ page }) => {
  await stub(page);
  await page.goto("/");
  await open(page, "end-marker-long.md");
  await expect(marker(page)).toHaveCount(1);

  // 顶 → 中 → 底 → 再回顶：同一滚动位置（顶）的读数必须与第一次逐项相同，
  // 否则判据就掺进了滚动位置（「滚到底才显示」这类实现的现场）。
  await scrollTo(page, "top");
  const top1 = await readMarker(page);
  await scrollTo(page, "middle");
  const middle = await readMarker(page);
  await scrollTo(page, "bottom");
  const bottom = await readMarker(page);
  // 滚到底：标记进入视口（「到底了」在文档末尾这一次滚动里被看见）
  const visibleAtBottom = await page.evaluate(() => {
    const el = document.querySelector(".cm-scroller") as HTMLElement;
    const rect = (document.querySelector(".cm-lp-end-marker") as HTMLElement).getBoundingClientRect();
    const host = el.getBoundingClientRect();
    return rect.top >= host.top && rect.bottom <= host.bottom + 1;
  });
  expect(visibleAtBottom).toBe(true);
  await scrollTo(page, "top");
  const top2 = await readMarker(page);

  const readings = [top1, middle, bottom, top2];
  // 标记在四种位置上都在场（判据是静态量，不看滚到哪）；回到顶后与第一次读数逐项相同
  expect(readings.map((r) => r.count)).toEqual([1, 1, 1, 1]);
  expect(top2).toEqual(top1);
  // 滚动高度 / 可用高度逐像素相同（标记的高度贡献与滚动位置无关：位置变了这些数不许变）
  expect(new Set(readings.map((r) => r.scrollHeight)).size).toBe(1);
  expect(new Set(readings.map((r) => r.clientHeight)).size).toBe(1);
  // 标记随内容滚动：滚动到底时它的视口纵坐标比在顶时更小
  expect(bottom.markerTop ?? Number.NaN).toBeLessThan(top1.markerTop ?? Number.NaN);
});

test("形态与配色：短线夹字，与作者手写的通栏分隔线可区分", async ({ page }) => {
  await stub(page);
  await page.goto("/");
  await open(page, "end-marker-long.md");
  await expect(marker(page)).toHaveCount(1);

  // 结构：两段短线夹一段文字
  await expect(page.locator(MARKER_LINE)).toHaveCount(2);
  await expect(page.locator(MARKER_TEXT)).toHaveText(TEXT);
  await expect(page.locator(".cm-lp-end-marker")).toContainText(TEXT);

  const geometry = await page.locator(".cm-content").evaluate((content) => {
    const lines = [...document.querySelectorAll<HTMLElement>(".cm-lp-end-marker-line")];
    return {
      columnWidth: content.getBoundingClientRect().width,
      lineWidths: lines.map((line) => line.getBoundingClientRect().width),
      lineColors: lines.map((line) => getComputedStyle(line).borderTopColor),
      lineHeights: lines.map((line) => line.getBoundingClientRect().height),
    };
  });
  // 横线短、且两段加起来仍短于阅读栏宽的一半（与通栏分隔线的结构差别）
  expect(geometry.lineWidths.every((w) => w > 0)).toBe(true);
  expect(geometry.lineWidths.reduce((a, b) => a + b, 0)).toBeLessThan(geometry.columnWidth / 2);
  expect(geometry.lineHeights.every((h) => h <= 1)).toBe(true);
  expect(new Set(geometry.lineColors)).toEqual(new Set([HAIRLINE]));

  // 配色：文字取提示档（--text-3）、线段取层次档发丝线（--border-soft），链接色（--accent）未参与
  const colors = await page.locator(MARKER_TEXT).evaluate((el) => ({
    color: getComputedStyle(el).color,
    fontFamily: getComputedStyle(el).fontFamily,
  }));
  expect(colors.color).toBe(TEXT_3);
  expect(colors.color).not.toBe(ACCENT);
  // 正文族（restyle 后标题族退场，sans 是界面上唯一的正文字族——标记不特殊化）
  expect(colors.fontFamily).toMatch(/sans-serif/i);

  // 同一份文档里作者手写的 `---` 照常是**通栏**线：两类元素同时在场且几何可区分
  const rule = await page.locator(".cm-lp-hr").first().evaluate((el) => el.getBoundingClientRect().width);
  expect(rule).toBeGreaterThan(geometry.columnWidth / 2);
  expect(geometry.lineWidths.every((w) => w < rule)).toBe(true);

  // 标记在 .cm-content 之外（不是文档内容的一部分）
  expect(await page.locator(".cm-content .cm-lp-end-marker").count()).toBe(0);
});

test("code 模式没有标记；文末光标与全选都不影响显示", async ({ page }) => {
  await stub(page);
  await page.goto("/");

  // code 模式（.txt）：没有 live preview 装饰层，也就没有标记
  await open(page, NOTE);
  await expect(marker(page)).toHaveCount(0);
  await expect(page.locator(".cm-lineNumbers").first()).toBeVisible();
  await expect(scroller(page)).not.toHaveClass(/cm-lp-end-marker-visible/);

  // md 长文：标记在场，滚动容器带在场态 class；光标落在文档末尾、以及全选时标记照常显示（不从属显露口径）
  await open(page, "end-marker-long.md");
  await expect(marker(page)).toHaveCount(1);
  await expect(scroller(page)).toHaveClass(/cm-lp-end-marker-visible/);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await expect(marker(page)).toHaveCount(1);
  await page.evaluate(() => {
    const tile = (document.querySelector(".cm-content") as unknown as {
      cmTile?: { root: { view: { state: { doc: { length: number } }; dispatch: (spec: unknown) => void } } };
    }).cmTile;
    if (!tile) throw new Error("CodeMirror view unavailable");
    tile.root.view.dispatch({ selection: { anchor: tile.root.view.state.doc.length } });
  });
  await expect(marker(page)).toHaveCount(1);
  expect(await readDocument(page)).toBe(FIXTURES["end-marker-long.md"]);

  // 切回 code 模式：装饰层被拆掉，元素与在场态 class 必须一起离场
  //（漏掉 class 会让 code 模式的滚动容器继续吃 `grid-auto-rows: max-content`）
  await open(page, NOTE);
  await expect(marker(page)).toHaveCount(0);
  await expect(scroller(page)).not.toHaveClass(/cm-lp-end-marker-visible/);
});

test("非文档性：不被复制带出、不被文件内搜索命中、不进保存字节", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stub(page);
  await page.goto("/");
  await open(page, "end-marker-long.md");
  await expect(marker(page)).toHaveCount(1);

  // ⌘A + ⌘C：标记的文案不在剪贴板里；正观测——正文确实被复制了
  await page.locator(".cm-content").click();
  const copied = await copyFresh(page, "SENTINEL-DOC-END-MARKER");
  expect(copied).not.toContain(TEXT);
  expect(copied).toContain("文档的终点");

  // ⌘F：搜标记的文案无命中；正观测——搜正文里的串有命中（同一面板、同一路径）
  await page.keyboard.press("Meta+f");
  const input = page.locator(".lumir-search-input");
  await input.fill(TEXT);
  await expect(page.locator(".lumir-search-count")).toHaveText("0/0");
  await input.fill("结束标记场景");
  await expect(page.locator(".lumir-search-count")).not.toHaveText("0/0");
  await page.keyboard.press("Escape");

  // 文档字节：渲染不写文档（ADR 0003 §3）
  expect(await readDocument(page)).toBe(FIXTURES["end-marker-long.md"]);
});

// ---------------------------------------------------------------------------
// backlog #31：标记的字号基准（R2b 修复的正式门禁断言）
// ---------------------------------------------------------------------------

/** 标记自己的字号读数：文字字号 + 线段计算宽（线段是 `4em`，随标记根字号解析）。 */
async function markerMetrics(page: Page) {
  return page.locator(MARKER).evaluate((el) => {
    const text = el.querySelector<HTMLElement>(".cm-lp-end-marker-text")!;
    const line = el.querySelector<HTMLElement>(".cm-lp-end-marker-line")!;
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    return {
      markerFontSize: Number.parseFloat(getComputedStyle(el).fontSize),
      textFontSize: Number.parseFloat(getComputedStyle(text).fontSize),
      lineWidth: line.getBoundingClientRect().width,
      contentFontSize: Number.parseFloat(getComputedStyle(content).fontSize),
    };
  });
}

test("backlog #31：标记字号跟随内容字号（基准 = --editor-font-size，不再是固定的 14px）", async ({
  page,
  context,
}) => {
  // 旧缺陷形态：标记的 `0.82em` 以 `.cm-scroller` 为基准，而 `.cm-scroller` 只继承
  // `.cm-editor` 写死的 14px ⇒ 放大正文时标记恒为 11.48px、完全不跟随。
  // 修后：字号 = `calc(var(--editor-font-size) * 0.8)`，基准是内容字号的单一来源。
  await stub(page);
  await page.goto("/");
  await open(page, "end-marker-long.md");
  await expect(marker(page)).toHaveCount(1);
  const small = await markerMetrics(page);

  const bigPage = await context.newPage();
  await stubTauri(bigPage, {
    entries: Object.keys(FIXTURES).map((path) => ({ path, kind: "file", size: FIXTURES[path as keyof typeof FIXTURES].length, mtime_ms: 0 })),
    files: { ...FIXTURES },
    config: { font_size: 24 },
  });
  await bigPage.goto("/");
  await open(bigPage, "end-marker-long.md");
  await expect(marker(bigPage)).toHaveCount(1);
  const big = await markerMetrics(bigPage);

  // 内容字号确实换了两档（否则下面的比值断言在「两页一样」上空转——REVIEW.md 第 2 条）
  expect(small.contentFontSize).toBe(15);
  expect(big.contentFontSize).toBe(24);
  expect(small.textFontSize).toBe(small.markerFontSize);
  // 标记字号 = 0.8 × 内容字号（0.8 = tokens 文档 §字号阶梯的 12px doc-meta 档 ÷ 15px 正文锚）
  expect(small.markerFontSize).toBeCloseTo(15 * 0.8, 2);
  expect(big.markerFontSize).toBeCloseTo(24 * 0.8, 2);
  expect(big.markerFontSize).toBeGreaterThan(small.markerFontSize);
  // 线段 `4em` 随同一基准缩放（「线宽反推标记基准」那条证据要的性质）
  expect(small.lineWidth).toBeCloseTo(4 * small.markerFontSize, 0);
  expect(big.lineWidth).toBeCloseTo(4 * big.markerFontSize, 0);
});
