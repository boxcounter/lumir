import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { decodeScreenshot, dominantColor, colorDiff, formatColor, lumaSpread } from "../../../scripts/acceptance/lib/pixel.mjs";

// M288：**代码块底色 MUST NOT 盖住 drawSelection 自绘的选区**（不变量条款）。
//
// 缺陷（Alex 报告，2026-09-28）：md 的围栏代码块里扩选 / 拖选，选区看不见。两个候选机制——
// ①撞色（`--sel` 与 `--code-bg` 太近）②绘制顺序（块底色是 in-flow 块的背景，按 CSS 绘制顺序
// 排在负 z-index 的 `.cm-selectionLayer` 之后；CM 的 `layer({above:false})` ⇒ 该层
// z-index = -1 - pos，实测 -2）。定性读数：
//
// | 采样点（窗口局部，7×7 主色） | light | dark | eink |
// |---|---|---|---|
// | 修前 选中处 / 同块未选中处 | `#f2f1ec` / `#f2f1ec`（差 0） | `#46474a` / `#38393c`（差 14） | `#f0f0f0` / `#f0f0f0`（差 0） |
// | 修后 选中处 / 同块未选中处 | `#e8e7e1` / `#f2f1ec`（差 11） | `#454649` / `#37383b`（差 14） | `#000000` / `#f0f0f0`（差 240） |
// | 块内选中处 == 同一选区在块外正文上的色？ | 修前 差 11 → 修后 **差 0** | 两轮都差 ~22 | 修前 差 240 → 修后 **差 0** |
//
// ⇒ 机制是**绘制顺序**（light / eink 被 100% 盖住；dark 因为 `--code-bg` 半透明而恰好透出来，
// 故 dark 修前也「可辨」，见下）；撞色是残留的第二档：修后 light 的块内选区仍只与块底色差 11
// （`--sel` 与 `--code-bg` 这对 token 的本征差，light 下 `--sel` 与正文底色差 21）。
// 修法：块底色移到容器的两个负 z-index 伪元素上（src/style.css 的
// `.cm-lp-codeblock-scroll::before/::after`；折行档没有容器，由 `.cm-lp-codeblock-slot::before`
// 承担），行底色在 slot 在场时让位。
//
// **判据形状按主题分工**（不是一套阈值的三处复制）：
//   · light / eink 的 `--sel` **不透明** ⇒ 绝对判据：代码块内选中处的底色 MUST 等于**同一个选区**
//     画在块外正文上的底色。这正是「选区画在块表面之上」的签名——被压回表面之下时读到的是表面色
//     （修前差 11 / 240），与抖动无关。
//   · dark 的 `--sel` 半透明（white .075）⇒ 合成色本来就随表面变，绝对判据不成立；改用相对判据
//     「选中处 MUST 与同块未选中处可辨（≥ MIN）」。**如实登记：dark 这条修前也成立（14）**，
//     它不是区分度判据而是回归守卫（防止块底色被改回不透明、或选区层被压到块底色之下）。
//   · eink 另有反白语义判据（黑底 + 仍有可辨字形），与 M285 场景 64 的 eink 条同口径。
//
// **为什么判据落像素层**：AX 读不到选区（acceptance README 的「光标/选区不可断言」）；而结构层
// 对本条缺陷**无区分度**——`.cm-selectionBackground` 的几何覆盖修前也是对的（矩形在、字符也在
// 矩形里，只是被块底色盖住），m285-selection-layer.spec.ts 的 coverage 断言修前照绿，故**不往
// 那边加「代码块分支」**（加了只能是假绿）。真机侧同一条判据在 scripts/acceptance/scenarios/66-*.md。
//
// 属性维度（合同先行的不变量级测试，docs/process/rendering-defect-contract-first.md）：
//   主题（light / dark / eink）× 代码块折行口径（横滚容器在场 / 折行档没有容器）×
//   选区形态（跨块界 / 块内单行 / 块内多行开放端 / 整块含围栏行 / 长行横滚档）。

const BODY = ["code line one", "code line two", "code line three"];
const LONG = "z".repeat(160);
const PARA_FIRST = "第一段普通文字，作为块外的对照读数。";
const PARA_LAST = "末尾一段普通文字。";
/** 浏览器上下文里定位正文行的子串（`page.evaluate` 看不到 Node 侧常量）。 */
const MARK_FIRST = "第一段普通文字";
const MARK_LAST = "末尾一段";

/** 文档：正文段 → 围栏代码块（首行是语言头部条）→ 正文段。 */
function doc(withLongLine = false, lang = "js"): string {
  return [PARA_FIRST, "", `\`\`\`${lang}`, BODY[0], withLongLine ? `${BODY[1]} ${LONG}` : BODY[1], BODY[2], "```", "", PARA_LAST, ""].join("\n");
}

/** 采样方块边长（截图像素）：与 acceptance 的 pixel 断言同口径（7×7 主色 = 底色）。 */
const PATCH = 7;
/** 判「同色」的每通道容差：与 acceptance pixel 的默认 tol 同值。 */
const TOL = 8;
/** 判「可辨」的最小通道差：实测 light 11 / dark 14 / eink 240（修前 0），取 8 留裕量。 */
const MIN = 8;

async function openDoc(page: Page, opts: { theme: "light" | "dark" | "eink"; codeBlockWrap?: boolean; withLongLine?: boolean }): Promise<string> {
  const text = doc(opts.withLongLine ?? false);
  await stubTauri(page, {
    root: "/mock/vault",
    vault_id: "v1",
    files: { "e.md": text },
    entries: [{ path: "e.md", name: "e.md", kind: "file", size: text.length, mtime_ms: 0 }],
    config: { theme: opts.theme, code_block_wrap: opts.codeBlockWrap ?? false },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="e.md"]').click();
  await expect(page.locator(".cm-content")).toContainText(PARA_FIRST);
  return text;
}

async function select(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(([a, b]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: a, head: b } });
  }, [from, to] as const);
  await page.waitForTimeout(80);
}

interface Reading {
  /** 被选中的代码行：取覆盖它的那条选区矩形的中心。 */
  codeSelected: { r: number; g: number; b: number } | null;
  /** 未被选中的代码行：行盒右侧的落空底色（行盒比文字长，必有一段纯底色带）。 */
  codeUnselected: { r: number; g: number; b: number } | null;
  /** 块外正文**被选中**处的底色（绝对判据的对照点）。 */
  plainSelected: { r: number; g: number; b: number } | null;
  /** 块外正文**未被选中**处的底色。 */
  plainUnselected: { r: number; g: number; b: number } | null;
  /** 选中处的亮度跨度（eink 反白字形的唯一可判读数）。 */
  spread: number | null;
  selLayerZ: string;
  lineBg: string;
  containerBg: string | null;
  rects: number;
}

/** 逐点取色（窗口截图 → 主色）。点全部由 DOM 几何给出；真机场景 66 用手写坐标做同一件事。 */
async function readPoints(
  page: Page,
  sel: { line: string; plain: boolean },
  ctrlLine: string,
  name: string,
): Promise<Reading> {
  const geo = await page.evaluate(([selLineText, ctrlLineText, wantPlain, markFirst, markLast]) => {
    const lines = [...document.querySelectorAll(".cm-line")];
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const code = lines.filter((l) => l.classList.contains("cm-lp-codeblock-line"));
    const textLine = (mark: string) => lines.find((l) => (l.textContent ?? "").includes(mark))!;
    const selLine = r(code.find((l) => (l.textContent ?? "").includes(selLineText))!);
    const ctrl = code.find((l) => (l.textContent ?? "").includes(ctrlLineText));
    const rects = [...document.querySelectorAll(".cm-selectionBackground")].map(r);
    const overlaps = (rect: { y: number; h: number }, box: { y: number; h: number }) => rect.y < box.y + box.h && rect.y + rect.h > box.y;
    return {
      selLine,
      ctrlLine: ctrl ? r(ctrl) : null,
      first: r(textLine(markFirst)),
      last: r(textLine(markLast)),
      selOnLine: rects.filter((s) => overlaps(s, selLine)).pop() ?? null,
      selOnPlain: wantPlain ? (rects.filter((s) => overlaps(s, r(textLine(markFirst)))).pop() ?? null) : null,
      selLayerZ: getComputedStyle(document.querySelector<HTMLElement>(".cm-selectionLayer")!).zIndex,
      lineBg: getComputedStyle(code[1]).backgroundColor,
      containerBg: document.querySelector<HTMLElement>(".cm-lp-codeblock-scroll")
        ? getComputedStyle(document.querySelector<HTMLElement>(".cm-lp-codeblock-scroll")!).backgroundColor
        : null,
      rects: rects.length,
    };
  }, [sel.line, ctrlLine, sel.plain, MARK_FIRST, MARK_LAST] as const);

  const shot = (await page.screenshot()).toString("base64");
  const img = decodeScreenshot(shot);
  const at = (x: number, y: number) => dominantColor(img, Math.round(x), Math.round(y), PATCH);
  /** 采样点 = **选区矩形 ∩ 目标行盒**的中心：跨行选区的矩形会长出目标行（开放端那一侧），
   *  直接取矩形中心会落到别的行（甚至别的块）上——M288 实测过这个假读数的现场。 */
  const mid = (rect: { x: number; y: number; w: number; h: number }, box: { x: number; y: number; w: number; h: number }) =>
    at((Math.max(rect.x, box.x) + Math.min(rect.x + rect.w, box.x + box.w)) / 2, (Math.max(rect.y, box.y) + Math.min(rect.y + rect.h, box.y + box.h)) / 2);
  const midOn = (rect: { x: number; y: number; w: number; h: number } | null, box: { x: number; y: number; w: number; h: number }) => (rect ? mid(rect, box) : null);
  const reading: Reading = {
    codeSelected: midOn(geo.selOnLine, geo.selLine),
    codeUnselected: geo.ctrlLine ? at(geo.ctrlLine.x + 400, geo.ctrlLine.y + geo.ctrlLine.h / 2) : null,
    plainSelected: midOn(geo.selOnPlain, geo.first),
    plainUnselected: at(geo.last.x + 120, geo.last.y + geo.last.h / 2),
    spread: (() => {
      if (!geo.selOnLine) return null;
      const x = (Math.max(geo.selOnLine.x, geo.selLine.x) + Math.min(geo.selOnLine.x + geo.selOnLine.w, geo.selLine.x + geo.selLine.w)) / 2;
      const y = (Math.max(geo.selOnLine.y, geo.selLine.y) + Math.min(geo.selOnLine.y + geo.selOnLine.h, geo.selLine.y + geo.selLine.h)) / 2;
      return lumaSpread(img, Math.round(x), Math.round(y), PATCH)?.spread ?? null;
    })(),
    selLayerZ: geo.selLayerZ,
    lineBg: geo.lineBg,
    containerBg: geo.containerBg,
    rects: geo.rects,
  };
  img.close();
  const c = (v: { r: number; g: number; b: number } | null) => (v ? formatColor(v) : null);
  console.log(
    `M288 ${name} 选中(块内)=${c(reading.codeSelected)} 选中(块外正文)=${c(reading.plainSelected)} 未选中(代码行)=${c(reading.codeUnselected)} 未选中(正文)=${c(reading.plainUnselected)} ` +
      `跨度=${reading.spread} 选区层z=${reading.selLayerZ} 行底色=${reading.lineBg} 容器底色=${reading.containerBg} 选区矩形=${reading.rects}`,
  );
  return reading;
}

/** 块表面本体在场的对照：未选中的代码行底色 MUST 与块外正文底色可辨。 */
function assertSurface(r: Reading, name: string) {
  expect(r.codeUnselected, `${name}：必须存在一条未被选中的代码行当对照点`).not.toBeNull();
  expect(
    colorDiff(r.codeUnselected!, r.plainUnselected!),
    `${name}：代码块的底色 MUST 与块外正文可辨（否则「选中处与块外同色」可能只是整屏同色）`,
  ).toBeGreaterThanOrEqual(MIN);
}

/** 绝对判据（light / eink：`--sel` 不透明）：块内选中处的色 == 同一选区在块外正文上的色。 */
function assertSameAsPlain(r: Reading, name: string) {
  expect(r.codeSelected, `${name}：采样点必须落在覆盖代码行的选区矩形内`).not.toBeNull();
  expect(r.plainSelected, `${name}：本轮选区必须同时覆盖块外正文（绝对判据的对照点）`).not.toBeNull();
  expect(
    colorDiff(r.codeSelected!, r.plainSelected!),
    `${name}：代码块内选中处的底色 MUST 等于同一选区在块外正文上的底色（差 ${colorDiff(r.codeSelected!, r.plainSelected!)}）`,
  ).toBeLessThanOrEqual(TOL);
}

/** 相对判据（dark：`--sel` 半透明）：选中处 MUST 与同块未选中处可辨。 */
function assertDiffersFromSurface(r: Reading, name: string) {
  expect(r.codeSelected, `${name}：采样点必须落在覆盖代码行的选区矩形内`).not.toBeNull();
  expect(r.codeUnselected, `${name}：必须存在一条未被选中的代码行当对照点`).not.toBeNull();
  expect(
    colorDiff(r.codeSelected!, r.codeUnselected!),
    `${name}：由 --sel 决定的地方，选中处 MUST 与同块未选中处可辨`,
  ).toBeGreaterThanOrEqual(MIN);
}

test.describe("M288：代码块底色盖不住选区（不变量）", () => {
  test("三主题 × 两种折行口径：跨块界选区在块内的那一段与块外同色（dark 退回相对判据）", async ({ page }) => {
    for (const theme of ["light", "dark", "eink"] as const) {
      for (const codeBlockWrap of [false, true]) {
        const name = `${theme}·${codeBlockWrap ? "折行档" : "横滚容器档"}`;
        const text = await openDoc(page, { theme, codeBlockWrap, withLongLine: !codeBlockWrap });
        // 选区：第 1 段正文起点 → 第 2 行代码末（块外、块内各有对照点；第 3 行代码留作未选中对照）。
        await select(page, 2, text.indexOf(BODY[1]) + BODY[1].length);
        const r = await readPoints(page, { line: BODY[1], plain: true }, BODY[2], name);
        assertSurface(r, name);
        if (theme === "dark") assertDiffersFromSurface(r, name);
        else assertSameAsPlain(r, name);
        if (theme === "eink") {
          expect(r.codeSelected!.r + r.codeSelected!.g + r.codeSelected!.b, `${name}：eink 的块内选中处必须是黑底（--sel）`).toBeLessThan(60);
          expect(r.spread ?? 0, `${name}：eink 的块内选中处仍有可辨字形（黑底白字，反白没丢）`).toBeGreaterThanOrEqual(60);
        }
      }
    }
  });

  test("选区形态：块内单行 / 块内多行开放端 / 整块含围栏行，块内那一段都可辨", async ({ page }) => {
    const text = await openDoc(page, { theme: "light", withLongLine: true });
    const fence = text.indexOf("```js");
    // 每种形态各配一条**有对照点**的判据：块内选区不跨块界时用相对判据（对照 = 另一条未选中的
    // 代码行）；跨块界时用绝对判据（对照 = 块外正文那一段）。「整块含围栏行」的选区把整个块都包住、
    // 块内没有未选中的代码行当对照，因此把选区起点放到块外正文上、只走绝对判据（块表面的在场由
    // 其余形态与上面那个 6 格矩阵承担）。
    const cases: { name: string; from: number; to: number; line: string; ctrl: string; plain: boolean; surface: boolean }[] = [
      { name: "块内单行", from: text.indexOf(BODY[2]), to: text.indexOf(BODY[2]) + BODY[2].length, line: BODY[2], ctrl: BODY[0], plain: false, surface: true },
      { name: "块内多行开放端", from: text.indexOf(BODY[0]), to: text.indexOf(BODY[1]) + BODY[1].length, line: BODY[1], ctrl: BODY[2], plain: false, surface: true },
      { name: "整块含围栏行", from: 2, to: text.indexOf("```", fence + 1) + 3, line: BODY[1], ctrl: BODY[2], plain: true, surface: false },
      { name: "从正文跨块界", from: 2, to: text.indexOf(BODY[0]) + BODY[0].length, line: BODY[0], ctrl: BODY[2], plain: true, surface: true },
    ];
    for (const c of cases) {
      await select(page, c.from, c.to);
      const r = await readPoints(page, { line: c.line, plain: c.plain }, c.ctrl, `light·${c.name}`);
      if (c.surface) assertSurface(r, `light·${c.name}`);
      if (c.plain) assertSameAsPlain(r, `light·${c.name}`);
      else assertDiffersFromSurface(r, `light·${c.name}`);
    }
  });

  test("区分度自证：把块底色压回 in-flow 背景（修前形态）时，light / eink 的绝对判据 MUST 判红", async ({ page }) => {
    // REVIEW.md 第 1 条：断言必须先造一个必须让它红的输入——这里造的就是**修前形态**
    // （容器底色回到容器自身、行底色回到行自身，即 M288 之前的产品行为）。
    // dark 不列入本自证：`--sel` 半透明，块底色压在选区层之上时选区的色照样透出来（修前也差 14），
    // 该主题的判据修前也成立——已在文件头的读数表与 assertDiffersFromSurface 的注释里登记。
    const rows: { theme: string; delta: number }[] = [];
    for (const theme of ["light", "eink"] as const) {
      const text = await openDoc(page, { theme });
      await page.addStyleTag({
        content: `
          .cm-lp-codeblock-scroll { background-color: var(--code-bg) !important; }
          .cm-lp-codeblock-scroll::before, .cm-lp-codeblock-scroll::after { display: none !important; }
          .cm-lp-codeblock-slot::before { display: none !important; }
          .cm-content .cm-line.cm-lp-codeblock-line { background-color: var(--code-bg) !important; }
        `,
      });
      await select(page, 2, text.indexOf(BODY[1]) + BODY[1].length);
      const r = await readPoints(page, { line: BODY[1], plain: true }, BODY[2], `${theme}·修前形态（区分度自证）`);
      // 修前形态的签名：块内选中处读到的是**块表面色**（= 未选中代码行的底色），不是选区色。
      rows.push({ theme, delta: colorDiff(r.codeSelected!, r.codeUnselected!) });
    }
    for (const { theme, delta } of rows) {
      expect(delta, `${theme}·修前形态：块底色压在选区层之上时，块内选中处 MUST 读到块表面色（差 ${delta} ≤ ${TOL}）——这条判红即「判据有区分度」`).toBeLessThanOrEqual(TOL);
    }
  });
});
