import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stubTauri } from "./tauri-stub";
import { decodeScreenshot, dominantColor, colorDiff, formatColor, lumaSpread } from "../../../scripts/acceptance/lib/pixel.mjs";

// M295：**行内 code 药丸的选中态可辨性**（Alex 2026-09-29 报告，light + eink 两张截图）。
//
// 现象：列表项 / 段落里选中一整行，行内的 code 药丸肉眼分不出选没选中（「实际我选中了
// tests/visual/scenes/paragraph.spec.ts，但分辨不出」）。
//
// 定性（与 M288 同一条机制，M291 已登记「未收口」的同类表面）：药丸自带的底色
//（`theme.ts` 的 `.cm-lp-inline-code { backgroundColor: var(--code-bg) }`）是 **in-flow 行内底色**，
// 按 CSS 绘制顺序排在 drawSelection 的 `.cm-selectionLayer`（负 z-index）**之后** ⇒ 药丸盒内逐像素
// 读到的是药丸自己的灰，选中与否同色。M285 的「逐字符覆盖」判据是**几何层**
//（`.cm-selectionBackground` 的矩形覆盖），对这条**恒真**——矩形确实盖着药丸，只是被药丸底色挡住。
// 本文件因此把判据落到**像素层**（探测色跟随）+ **渲染色 == 带色**两层，与 M288 / M291 同源。
//
// 判据形状（三主题分工，沿用 M291 的写法）：
//   · light / eink：带不透明 ⇒ 绝对判据「选中态药丸内地读到的色 == 同一选区在药丸外的带色」。
//   · dark：带是半透明白（合成色随承载面变）⇒ 相对判据「选中态药丸 vs 未选中药丸可辨」。
//   · 三主题共有：① 选中态药丸与未选中药丸 MUST 可辨（≥ 40）；② 未选中药丸 MUST NOT 读成带色
//     （反向对照，防「恒真」）；③ 选中态药丸里的字形 MUST 仍可读（eink 跨度 ≥ 60，M291 的既有
//     不变量，修后不许退化）。
//
// 判据来源：openspec `editor-live-preview` spec 的 requirement「选区可见范围 MUST 等于编辑器选区
// 范围」（选区覆盖的每一个渲染态字符 SHALL 显示选中底色、选区外 MUST NOT 出现选中呈现；适用面明列
// 含行内 code）+ docs/specs/design-tokens-v1.md §编辑器选区带。

const HEAD = "第一段正文，供选区外的对照读数用。";
const PARA = "段落里的行内 `code` 药丸与普通文字。";
const LIST = "- 列表项：`tests/visual/scenes/paragraph.spec.ts` 是场景文件。";
const TAIL = "末尾一段正文。";
const DOC = [HEAD, "", PARA, "", LIST, "", TAIL, ""].join("\n");

const MARK_PARA = "段落里的行内";
const MARK_LIST = "列表项";
const MARK_TAIL = "末尾一段";
/** 药丸里的**长路径**：与 Alex 截图里的那一串一致（够宽，落空带取样点）。 */
const PILL_PATH = "tests/visual/scenes/paragraph.spec.ts";

/** 采样方块边长与容差（与 M291 / acceptance pixel 同口径）。 */
const PATCH = 7;
const TOL = 8;
/** 判「可辨」的最小通道差：M291 §编辑器选区带 的取值判据（40）。 */
const MIN = 40;
/** dark 反向对照的下限（本档的灰语汇间隔窄，逐值相同才是缺陷）。 */
const MIN_DARK_CONTROL = 16;
/** 选中态里字形可辨的最小亮度跨度（真机场景 68 / M291 同阈值）。 */
const MIN_SPREAD = 60;

/** 证据目录（test-results 不入 git，与 M288 / M291 同惯例；跑完同步到主仓同路径）。 */
const EVIDENCE_DIR = new URL("../../../test-results/m295/", import.meta.url);
mkdirSync(EVIDENCE_DIR, { recursive: true });

const THEMES = ["light", "dark", "eink"] as const;
type Theme = (typeof THEMES)[number];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

async function openDoc(page: Page, theme: Theme): Promise<void> {
  await stubTauri(page, {
    root: "/mock/vault",
    vault_id: "v1",
    files: { "e.md": DOC },
    entries: [{ path: "e.md", name: "e.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    config: { theme },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="e.md"]').click();
  await expect(page.locator(".cm-content")).toContainText(MARK_PARA);
}

async function select(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(([a, b]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: a, head: b } });
  }, [from, to] as const);
  await page.waitForTimeout(150);
}

interface Geo {
  /** 列表行（选区所在行）与被选中的药丸；未选中的药丸在另一行。 */
  listLine: Box;
  pillSel: Box;
  paraLine: Box;
  pillUnsel: Box;
  tailLine: Box;
  /** 带色参照点：选区内的药丸**外**落空带（左 / 右两侧各一，按用例取用）。 */
  bandRightOfPill: { x: number; y: number };
  bandLeftOfPill: { x: number; y: number };
  /** 部分选中用例：覆盖段最后一个字符 / 未覆盖段第一个字符的字符格。 */
  coveredChar: Box | null;
  uncoveredChar: Box | null;
  /** 结构层：`.cm-selectionBackground` 矩形（几何覆盖判据 + 带与药丸盒的 x 关系）。 */
  bandRects: Box[];
  /** 药丸 DOM 文本（含反引号与否随实现，登记进读数便于对照）。 */
  pillText: string;
  tokens: { band: string; sel: string; codeBg: string; text: string };
}

async function readGeo(page: Page, opts: { covered?: number; uncovered?: number } = {}): Promise<Geo> {
  return page.evaluate(
    ([markPara, markList, markTail, part]) => {
      const box = (el: Element): Box => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const toBox = (r: DOMRect): Box => ({ x: r.x, y: r.y, w: r.width, h: r.height });
      const lines = [...document.querySelectorAll(".cm-line")];
      const lineOf = (mark: string) => lines.find((l) => (l.textContent ?? "").includes(mark))!;
      const pillOf = (line: Element) => line.querySelector<HTMLElement>(".cm-lp-inline-code")!;
      const paraLine = lineOf(markPara as string);
      const listLine = lineOf(markList as string);
      const tailLine = lineOf(markTail as string);
      const pillSel = box(pillOf(listLine));
      const listBox = box(listLine);
      const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      const charBox = (pos: number): Box | null => {
        const a = view.coordsAtPos(pos);
        const b = view.coordsAtPos(pos + 1);
        if (!a || !b) return null;
        return { x: Math.min(a.left, b.left), y: a.top, w: Math.abs(b.left - a.left), h: a.bottom - a.top };
      };
      const resolve = (value: string): string => {
        const probe = document.createElement("div");
        probe.style.background = value;
        document.body.appendChild(probe);
        const out = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return out;
      };
      return {
        listLine: listBox,
        pillSel,
        paraLine: box(paraLine),
        pillUnsel: box(pillOf(paraLine)),
        tailLine: box(tailLine),
        // 药丸两侧各 24px：仍在同一列表行、且在选区内（行内其余文字）。
        bandRightOfPill: { x: pillSel.x + pillSel.w + 24, y: listBox.y + listBox.h / 2 },
        bandLeftOfPill: { x: pillSel.x - 24, y: listBox.y + listBox.h / 2 },
        coveredChar: part ? charBox(part[0]) : null,
        uncoveredChar: part ? charBox(part[1]) : null,
        bandRects: [...document.querySelectorAll(".cm-selectionBackground")].map((el) => toBox(el.getBoundingClientRect())),
        pillText: (pillOf(listLine).textContent ?? "").slice(0, 40),
        tokens: {
          band: resolve("var(--sel-band)"),
          sel: resolve("var(--sel)"),
          codeBg: resolve("var(--code-bg)"),
          text: resolve("var(--text)"),
        },
      };
    },
    [MARK_PARA, MARK_LIST, MARK_TAIL, opts.covered !== undefined && opts.uncovered !== undefined ? [opts.covered, opts.uncovered] : null] as const,
  );
}

interface Reading {
  /** 选中态药丸内部：左内边距 / 中心 / 右内边距三点。 */
  pillSel: RGB[];
  /** 未选中态药丸内部：同三点。 */
  pillUnsel: RGB[];
  bandOutside: RGB;
  paper: RGB;
  /** 选中态药丸内的字形亮度跨度（中心点）。 */
  spreadSel: number | null;
  /** 部分选中用例：覆盖段 / 未覆盖段的字符格中心色。 */
  covered: RGB | null;
  uncovered: RGB | null;
}

async function readPoints(page: Page, geo: Geo, label: string, bandSide: "left" | "right"): Promise<Reading> {
  // 一次截图两用：落盘做证据（人眼过目）＋ 解出像素做读数（同一帧，不会两拍漂移）。
  const shot = (await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, EVIDENCE_DIR)) })).toString("base64");
  // 药丸附近的裁剪图（人眼过目用；读数取自上面那一帧）。
  await page.screenshot({
    path: fileURLToPath(new URL(`${label}-pill.png`, EVIDENCE_DIR)),
    clip: { x: geo.pillSel.x - 60, y: geo.pillSel.y - 16, width: geo.pillSel.w + 120, height: geo.pillSel.h + 32 },
  });
  const img = decodeScreenshot(shot);
  const at = (x: number, y: number): RGB => {
    const c = dominantColor(img, Math.round(x), Math.round(y), PATCH);
    if (!c) throw new Error(`采样点 (${Math.round(x)}, ${Math.round(y)}) 取不到主色`);
    return c;
  };
  const midY = (b: Box) => b.y + b.h / 2;
  // 药丸左右各 5px 内边距是稳的落空带；中心点在宽药丸上同样是落空带（7×7 主色）。
  const inside = (b: Box): RGB[] => [
    at(b.x + 2.5, midY(b)),
    at(b.x + b.w / 2, midY(b)),
    at(b.x + b.w - 2.5, midY(b)),
  ];
  const band = bandSide === "left" ? geo.bandLeftOfPill : geo.bandRightOfPill;
  const reading: Reading = {
    pillSel: inside(geo.pillSel),
    pillUnsel: inside(geo.pillUnsel),
    bandOutside: at(band.x, band.y),
    paper: at(geo.tailLine.x + 40, midY(geo.tailLine)),
    spreadSel: lumaSpread(img, Math.round(geo.pillSel.x + geo.pillSel.w / 2), Math.round(midY(geo.pillSel)), PATCH)?.spread ?? null,
    covered: geo.coveredChar ? at(geo.coveredChar.x + geo.coveredChar.w / 2, geo.coveredChar.y + geo.coveredChar.h / 2) : null,
    uncovered: geo.uncoveredChar ? at(geo.uncoveredChar.x + geo.uncoveredChar.w / 2, geo.uncoveredChar.y + geo.uncoveredChar.h / 2) : null,
  };
  img.close();
  const fmt = (cs: RGB[]) => cs.map(formatColor).join("/");
  const bandXs = geo.bandRects.map((r) => `${Math.round(r.x)}..${Math.round(r.x + r.w)}`).join(" ");
  console.log(
    `M295[${label}] 选中药丸=${fmt(reading.pillSel)} 未选中药丸=${fmt(reading.pillUnsel)} ` +
      `带(药丸外)=${formatColor(reading.bandOutside)} 纸=${formatColor(reading.paper)} 选中药丸跨度=${reading.spreadSel} ` +
      `覆盖段=${reading.covered ? formatColor(reading.covered) : "-"} 未覆盖段=${reading.uncovered ? formatColor(reading.uncovered) : "-"} ` +
      `药丸盒x=${Math.round(geo.pillSel.x)}..${Math.round(geo.pillSel.x + geo.pillSel.w)} 带矩形x=[${bandXs}] ` +
      `token: band=${geo.tokens.band} codeBg=${geo.tokens.codeBg} 药丸文本=${JSON.stringify(geo.pillText)}`,
  );
  return reading;
}

/** 三点里与参照读数差最大的那一处：三点同值时期望就是同值，不同值时把差异暴露出来。 */
const worst = (a: RGB[], b: RGB[]): number => Math.max(...a.map((x, i) => colorDiff(x, b[i])));

/** 计算值（`rgb(...)` / `rgba(...)`）→ RGB（判据拿 token 当参照时用）。 */
const rgb = (css: string): RGB => {
  const m = css.match(/[\d.]+/g)!;
  return { r: Number(m[0]), g: Number(m[1]), b: Number(m[2]) };
};

/** 全行选中：选区 = 整条列表行（药丸被完整覆盖）。 */
function fullLineRange(): [number, number] {
  const from = DOC.indexOf(MARK_LIST);
  return [from, DOC.indexOf("\n", from)];
}

/** 部分选中：选区收在药丸路径中间（药丸左半覆盖、右半未覆盖）。 */
function partialRange(): { range: [number, number]; covered: number; uncovered: number } {
  const start = DOC.indexOf(PILL_PATH);
  return { range: [DOC.indexOf(MARK_LIST), start + 3], covered: start + 2, uncovered: start + 3 };
}

/** 药丸盒是否与某个选区矩形几何相交（M285 的判据层，本文件把它与像素层并置）。 */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

test.describe("M295：行内 code 药丸的选中态可辨性", () => {
  test("三主题 × 整行选中：选中态药丸 MUST 与未选中可辨，且未选中药丸 MUST NOT 读成带色", async ({ page }) => {
    for (const theme of THEMES) {
      await openDoc(page, theme);
      const [from, to] = fullLineRange();
      await select(page, from, to);
      const geo = await readGeo(page);
      const r = await readPoints(page, geo, `${theme}-full-line`, "right");

      // 标定 + 防空转：本 fixture 里带与纸 MUST 可辨（采样点漂了这条先红）。
      expect.soft(
        colorDiff(r.bandOutside, r.paper),
        `${theme}：带与纸 MUST 可辨（差 ${colorDiff(r.bandOutside, r.paper)}）——它在场才说明选区按预期落在这条行上`,
      ).toBeGreaterThanOrEqual(MIN);

      // ① 核心判据：选中态药丸 vs 未选中态药丸 MUST 可辨（三点逐一）。
      expect.soft(
        worst(r.pillSel, r.pillUnsel),
        `${theme}：**选中态**药丸（${r.pillSel.map(formatColor).join("/")}）MUST 与**未选中态**药丸` +
          `（${r.pillUnsel.map(formatColor).join("/")}）可辨（差 ${worst(r.pillSel, r.pillUnsel)} < ${MIN}）` +
          `——药丸的 in-flow 底色盖住了选区带，选中与否逐像素同色`,
      ).toBeGreaterThanOrEqual(MIN);

      // ② 反向对照：未选中的药丸 MUST NOT 读成带色（否则 ① 可能靠「全都染色」恒真）。
      //    light / eink 的带不透明，两者相隔一整档；dark 的灰语汇间隔窄（药丸 vs 带 37），
      //    本档的判据是「不逐值相同」，如实分档。
      const control = theme === "dark" ? MIN_DARK_CONTROL : MIN;
      expect.soft(
        colorDiff(r.pillUnsel[1], r.bandOutside),
        `${theme}：**未选中**态药丸 MUST NOT 读成带色（差 ${colorDiff(r.pillUnsel[1], r.bandOutside)} ≥ ${control}）`,
      ).toBeGreaterThanOrEqual(control);
    }
  });

  test("三主题：选区恰好等于药丸本身（Alex 的现场形态）时，药丸文本区 MUST 读成选中态", async ({ page }) => {
    // Alex 的原话是「我选中了 tests/visual/scenes/paragraph.spec.ts」——选区落在**药丸自身**上，
    // 此时带矩形整段被药丸盒盖住，肉眼完全看不见选中（这条是本缺陷最极端、也最像现场的形态）。
    const raw = `\`${PILL_PATH}\``;
    const from = DOC.indexOf(raw);
    const to = from + raw.length;
    for (const theme of THEMES) {
      await openDoc(page, theme);
      await select(page, from, to);
      const geo = await readGeo(page);
      const r = await readPoints(page, geo, `${theme}-pill-only`, "right");
      // 药丸文本区（中心点）MUST 与未选中药丸可辨（①）。
      expect.soft(
        colorDiff(r.pillSel[1], r.pillUnsel[1]),
        `${theme}：选区 == 药丸时，药丸文本区（${formatColor(r.pillSel[1])}）MUST 与未选中药丸` +
          `（${formatColor(r.pillUnsel[1])}）可辨（差 ${colorDiff(r.pillSel[1], r.pillUnsel[1])}）`,
      ).toBeGreaterThanOrEqual(MIN);
      // 不透明档：文本区 MUST 读成带色（判据形式 = 探测色 == token）。
      if (theme !== "dark") {
        expect.soft(
          colorDiff(r.pillSel[1], rgb(geo.tokens.band)),
          `${theme}：选区 == 药丸时，药丸文本区 MUST 读成带色（--sel-band ${geo.tokens.band}，容差 ${TOL}）`,
        ).toBeLessThanOrEqual(TOL);
      }
    }
  });

  test("light / eink（不透明带）：选中态药丸的渲染色 MUST 等于同一选区在药丸外的带色", async ({ page }) => {
    for (const theme of ["light", "eink"] as const) {
      await openDoc(page, theme);
      const [from, to] = fullLineRange();
      await select(page, from, to);
      const geo = await readGeo(page);
      const r = await readPoints(page, geo, `${theme}-full-line-absolute`, "right");

      // 绝对判据（M288 的不变量扩到行内面）：同一条选区在药丸内与药丸外逐值相等。
      expect.soft(
        worst(r.pillSel, [r.bandOutside, r.bandOutside, r.bandOutside]),
        `${theme}：选中态药丸内（${r.pillSel.map(formatColor).join("/")}）MUST 等于同一选区在药丸外的带色` +
          `（${formatColor(r.bandOutside)}，容差 ${TOL}）——「选区带 MUST 覆盖药丸」的绝对形态`,
      ).toBeLessThanOrEqual(TOL);
    }
  });

  test("三主题：选中态药丸里的字形 MUST 仍可读（eink 跨度 ≥ 60，M291 的既有不变量不许退化）", async ({ page }) => {
    for (const theme of THEMES) {
      await openDoc(page, theme);
      const [from, to] = fullLineRange();
      await select(page, from, to);
      const geo = await readGeo(page);
      const r = await readPoints(page, geo, `${theme}-readability`, "right");
      expect.soft(
        r.spreadSel,
        `${theme}：选中态药丸里的字形 MUST 可辨（跨度 ${r.spreadSel} ≥ ${MIN_SPREAD}）`,
      ).toBeGreaterThanOrEqual(MIN_SPREAD);
    }
  });

  test("结构层与像素层并置：几何上药丸被带覆盖，部分选中时覆盖段读带色 / 未覆盖段读药丸灰", async ({ page }) => {
    for (const theme of THEMES) {
      await openDoc(page, theme);
      const { range, covered, uncovered } = partialRange();
      await select(page, ...range);
      // 部分选中：覆盖段在药丸左半 ⇒ 带色参照片取药丸**左**侧的落空带。
      const geo = await readGeo(page, { covered, uncovered });
      const r = await readPoints(page, geo, `${theme}-partial`, "left");

      // 几何层：药丸盒与 `.cm-selectionBackground` 相交 ⇒ M285 那条「逐字符覆盖」判据对药丸恒真，
      // 它看不见本缺陷（这正是本文件把判据落到像素层的理由）。
      expect.soft(
        geo.bandRects.some((rect) => overlaps(rect, geo.pillSel)),
        `${theme}：选区矩形 MUST 与药丸盒相交（M285 的几何判据在这条缺陷上是恒真的，本断言把它记下来）`,
      ).toBe(true);
      expect.soft(geo.coveredChar, `${theme}：覆盖段的字符格 MUST 读得到`).not.toBeNull();
      expect.soft(geo.uncoveredChar, `${theme}：未覆盖段的字符格 MUST 读得到`).not.toBeNull();

      // 像素层：覆盖段 MUST 读带色（不透明档）/ 与未覆盖段可辨（半透明档）；未覆盖段 MUST NOT 读带色。
      // light / eink 的带不透明 ⇒ 参照色取 **token 本身**（`--sel-band`；本用例的选区收在药丸内，
      // 药丸外的落空带只剩几十像素、没有可靠的平坦采样点，故这条判据的形式是「探测色 == token」）。
      const bandRef = rgb(geo.tokens.band);
      if (theme === "dark") {
        expect.soft(
          colorDiff(r.covered!, r.uncovered!),
          `dark：部分选中时覆盖段（${formatColor(r.covered!)}）MUST 与未覆盖段（${formatColor(r.uncovered!)}）可辨` +
            `（差 ${colorDiff(r.covered!, r.uncovered!)}）`,
        ).toBeGreaterThanOrEqual(MIN);
      } else {
        expect.soft(
          colorDiff(r.covered!, bandRef),
          `${theme}：部分选中时**覆盖段**（${formatColor(r.covered!)}）MUST 读带色` +
            `（--sel-band ${geo.tokens.band}，容差 ${TOL}）`,
        ).toBeLessThanOrEqual(TOL);
      }
      expect.soft(
        colorDiff(r.uncovered!, bandRef),
        `${theme}：部分选中时**未覆盖段**（${formatColor(r.uncovered!)}）MUST NOT 读成带色（差 ${colorDiff(r.uncovered!, bandRef)}）`,
      ).toBeGreaterThanOrEqual(MIN);
    }
  });

  test("区分度自证：把药丸按回「底色一律压在带上」的修前形态后，核心判据 MUST 判红", async ({ page }) => {
    // REVIEW.md 第 1 条：断言必须先造一个必须让它红的输入——这里造的就是 M295 修前的产品行为
    //（药丸底色无条件压在选区带之上）。
    await openDoc(page, "light");
    await page.addStyleTag({
      content: `.cm-lp-inline-code, .cm-lp-inline-code-sel { background-color: var(--code-bg) !important; }`,
    });
    const [from, to] = fullLineRange();
    await select(page, from, to);
    const geo = await readGeo(page);
    const r = await readPoints(page, geo, "light-prefix-form", "right");
    expect(
      worst(r.pillSel, r.pillUnsel),
      `修前形态：选中态药丸 MUST 与未选中同色（差 ${worst(r.pillSel, r.pillUnsel)} < ${MIN}）——核心判据因此有区分度`,
    ).toBeLessThan(MIN);
  });
});
