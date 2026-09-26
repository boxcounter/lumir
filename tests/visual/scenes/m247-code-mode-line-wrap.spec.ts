import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { configGets, stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M247（change code-mode-line-wrap）：折行口径的两模式分叉——**md 折 / code 不折**。
//
// 为什么单独一个场景：本 change 的核心断言是「同一份配置下，两个模式的正文行取不同的折行键」
// （md → `editor.line_wrap`，code → `editor.code_mode_line_wrap`）。既有 render-codeblock.spec.ts
// 的折行组全是 md 口径（代码块 + 正文行两个轴），code 侧的分叉在那里无处安放；本场景把
// **两侧放在同一个 run 里对照**，单侧的断言不足以证明「分叉」（REVIEW.md 第 1 条）。
//
// 判据层：计算属性（`white-space`）+ 行盒高度换算的视觉行数 + 编辑区横向可达性。全部是结构 /
// 计算属性断言，**不含像素断言**——因此 CI（LUMIR_VISUAL_STRUCTURAL=1）与本地跑的是同一条判据，
// 不为本 change 引入任何新基线。
//
// 不折行的底线（既有 spec 条款，本 change 原样继承）：长行 MUST NOT 被裁掉且无法到达——由
// `.cm-scroller` 的横向平移承载。下面每条「不折行」的断言都配一条可达性读数。

/** md 侧对照文档：复用 M180 的折行 fixture（同一份语料，避免第二份副本漂移，REVIEW.md 第 8 条）。 */
const MD_SOURCE = readFileSync(new URL("../fixtures/render-codeblock/wrap.md", import.meta.url), "utf8");
const MD_LONG_NEEDLE = "超长正文行";
const MD_UNIT_NEEDLE = "正文段落";

/** code 侧语料：一个长行（远超阅读栏宽）+ 一个短行（做视觉行数的单行基准）。
 *  长行刻意用等宽 ASCII 写，宽度可预测；`CODE-LONG-MARK` 是该行的唯一锚点。 */
const CODE_SOURCE = [
  "const short = 1;",
  "// CODE-LONG-MARK a deliberately long comment line that must overflow the reading measure so that reading its tail",
  'const tail = "CODE-END-MARK";',
  "",
].join("\n");
const CODE_LONG_NEEDLE = "CODE-LONG-MARK";
const CODE_UNIT_NEEDLE = "const short = 1;";

const FILES: Record<string, string> = { "wrap.md": MD_SOURCE, "long-line.ts": CODE_SOURCE };
const ENTRIES = [
  { path: "wrap.md", kind: "file" as const, size: MD_SOURCE.length, mtime_ms: 0 },
  { path: "long-line.ts", kind: "file" as const, size: CODE_SOURCE.length, mtime_ms: 0 },
];

/** 装载 vault 并打开某个文件，等配置真的到位（桩的 `config_get` 计数）。 */
async function openFile(
  page: Page,
  name: string,
  config?: { line_wrap?: boolean; code_block_wrap?: boolean; code_mode_line_wrap?: boolean; keys?: Record<string, string | null> },
): Promise<void> {
  await stubTauri(page, { entries: ENTRIES, files: FILES, ...(config === undefined ? {} : { config }) });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(name);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

/** 某行的折行读数：计算 white-space + 行盒高度（视觉行数 ÷ 同文档短行 = 换算，不写死行高）。 */
async function lineWrap(page: Page, needle: string) {
  return page.locator(".cm-line", { hasText: needle }).first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { whiteSpace: style.whiteSpace, height: el.getBoundingClientRect().height };
  });
}

async function rowHeight(page: Page, needle: string): Promise<number> {
  return page.locator(".cm-line", { hasText: needle }).first().evaluate((el) => el.getBoundingClientRect().height);
}

/** 视觉行数：目标行盒高度 ÷ 同一文档里短行的行盒高度。 */
function visualLines(height: number, unit: number): number {
  return Math.round(height / unit);
}

/** 编辑区（`.cm-scroller`）的横向可达性读数：不折行时超宽内容必须落在这里，而不是被裁掉。 */
async function hScroller(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".cm-scroller")!;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
}

test("出厂分叉（md 折 / code 不折）：同一份默认配置下两侧口径相反", async ({ page }) => {
  // 这一条是本 change 的核心：配置里**没有** `code_mode_line_wrap` 时，出厂口径已经是分叉的
  // （md 折、code 不折）。同时它顺带钉住「code 不跟随 line_wrap」——默认 `line_wrap` 是 true，
  // 若实现把 code 分支写成读 `line_wrap`（或读它的副本），code 侧会折行，下面的 pre 断言必红。
  await openFile(page, "long-line.ts");

  const code = await lineWrap(page, CODE_LONG_NEEDLE);
  expect(code.whiteSpace, "出厂口径下 code 模式长行不折行").toBe("pre");
  expect(
    visualLines(code.height, await rowHeight(page, CODE_UNIT_NEEDLE)),
    "code 模式长行不得折出第二个视觉行",
  ).toBe(1);

  // 底线：不折行 = 横向平移可达，不是静默裁切（既有 spec 的「文字必须仍然可达」）
  const codeScroller = await hScroller(page);
  expect(
    codeScroller.scrollWidth,
    "code 模式长行必须在编辑区溢出（否则本场景没有区分度）",
  ).toBeGreaterThan(codeScroller.clientWidth);

  // md 侧对照：同一份配置下 md 正文行长行照常折行（分叉的另一半）
  await page.locator('.ft-row[title="wrap.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("wrap.md");
  const prose = await lineWrap(page, MD_LONG_NEEDLE);
  expect(prose.whiteSpace, "md 模式正文行仍按 line_wrap（默认折行）").toBe("break-spaces");
  expect(
    visualLines(prose.height, await rowHeight(page, MD_UNIT_NEEDLE)),
    "md 长行应折成多个视觉行",
  ).toBeGreaterThan(1);
  const mdScroller = await hScroller(page);
  expect(mdScroller.scrollWidth, "md 折行时编辑区不应出现整窗横向滚动").toBe(mdScroller.clientWidth);

  // 折行口径 MUST NOT 改写文档（ADR 0003 §3 铁律）
  expect(await readDocument(page)).toBe(MD_SOURCE);
  await page.locator('.ft-row[title="long-line.ts"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("long-line.ts");
  expect(await readDocument(page)).toBe(CODE_SOURCE);
  expect((await lineWrap(page, CODE_LONG_NEEDLE)).whiteSpace, "切回 code 会话仍是出厂口径").toBe("pre");
});

test("显式 code_mode_line_wrap=true 则听用户：code 折行，md 侧零变化", async ({ page }) => {
  await openFile(page, "long-line.ts", { code_mode_line_wrap: true });

  const code = await lineWrap(page, CODE_LONG_NEEDLE);
  expect(code.whiteSpace, "显式打开时 code 模式长行折行").toBe("break-spaces");
  expect(
    visualLines(code.height, await rowHeight(page, CODE_UNIT_NEEDLE)),
    "折行后长行应折出多个视觉行",
  ).toBeGreaterThan(1);
  const scroller = await hScroller(page);
  expect(scroller.scrollWidth, "折行打开时编辑区不应再出现横向滚动").toBe(scroller.clientWidth);

  // md 侧读的仍是 line_wrap（本键对 md 无可观测效果）
  await page.locator('.ft-row[title="wrap.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("wrap.md");
  expect((await lineWrap(page, MD_LONG_NEEDLE)).whiteSpace, "md 侧不受 code 键影响").toBe("break-spaces");
});

test("view.toggle-line-wrap 在 code 模式翻 code 那一轴，且不动 md 那一轴", async ({ page }) => {
  // 语义（M247，tower 2026-09-27 批准）：这条命令翻的是**前台会话模式**对应的折行轴——
  // md → `lineWrap`、code → `codeModeLineWrap`。若实现只翻 `lineWrap`，下面第一次翻转后
  // code 长行不会有任何变化（命令在 code 模式下"按了没反应"），断言必红。
  await openFile(page, "long-line.ts", { keys: { "Ctrl-j": "view.toggle-line-wrap" } });

  const before = await lineWrap(page, CODE_LONG_NEEDLE);
  expect(before.whiteSpace, "起始是出厂口径（不折）").toBe("pre");

  await page.keyboard.press("Control+j");
  await page.waitForTimeout(80);
  const on = await lineWrap(page, CODE_LONG_NEEDLE);
  expect(on.whiteSpace, "code 模式按下后应折行（不是无反应）").toBe("break-spaces");
  expect(visualLines(on.height, await rowHeight(page, CODE_UNIT_NEEDLE))).toBeGreaterThan(1);

  // 轴分离的判别性：切到 md 文档，正文行**仍是折行**——说明刚才那次翻转落在 code 轴上，
  // 没有把 `lineWrap` 一起翻掉（若翻错了轴，这里的 md 正文会变成 pre）。
  await page.locator('.ft-row[title="wrap.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("wrap.md");
  expect(
    (await lineWrap(page, MD_LONG_NEEDLE)).whiteSpace,
    "code 模式的翻转 MUST NOT 改写 md 那一轴",
  ).toBe("break-spaces");

  // 翻回去：回到 code 会话，再按一次应回到出厂口径（二态、可逆）
  await page.locator('.ft-row[title="long-line.ts"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("long-line.ts");
  await page.keyboard.press("Control+j");
  await page.waitForTimeout(80);
  expect((await lineWrap(page, CODE_LONG_NEEDLE)).whiteSpace).toBe("pre");

  // 翻转全程 MUST NOT 改写文档（ADR 0003 §3）
  expect(await readDocument(page)).toBe(CODE_SOURCE);
});
