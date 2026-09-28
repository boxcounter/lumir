import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { decodeScreenshot, dominantColor, colorDiff, formatColor, lumaSpread } from "../../../scripts/acceptance/lib/pixel.mjs";

// M291：**选区族（编辑器选区带 + chrome 选中态）的对比度合同**，三主题。
//
// 缺陷（Alex 2026-09-28 报告，同一族的多个面）：
//   ① 撞色（light / dark）：编辑器选区带与它要压住的承载面太近——light 正文底色差 21、light 代码块
//      行区带只差 11、dark 正文底色差 14。「我人眼压根看不出来我从哪里选中的」。
//   ② eink 的「黑底反白」在**编辑器**不可达：选区带由 CM 的 drawSelection 画在文字之下，文字反白
//      只能靠原生选区的 `::selection { color }`——而它只作用于**仍被原生选区覆盖**的文字。选区驱动的
//      装饰重建（显露）会把那段 DOM 重建出来，WebKit 不把重建出的节点画进选中层（M273 的机理、
//      M285 只修了**底色**那一半）⇒ 重建段保留自己的字色、压在黑底上被吞。Alex 的现场是**引用块里的
//      粗体段**：同一条选区里普通文字正常反白、粗体段（显露时被重建）不可见。
//   ③ eink 的 **chrome 侧反白**（`--sel` 底 + `--sel-text` 字）Alex 裁定不可用：「现在是白字灰底，
//      我人眼几乎看不清字是什么」。该族的可读性全靠**逐表面的 `:not(:hover)` 排除条款**兜着
//      （`--hover` 档会压过选中底色，此时必须让文字回到常字色）——那是悬在一处状态组合上的保障。
//
// 修法（token 层，真源 docs/specs/design-tokens-v1.md §编辑器选区带 / §eink 规则④）：
//   · 编辑器选区带的真源从 `--sel` 拆出为 `--sel-band`：它画在**文字之下**、前景改不了，下界还要
//     压住代码块行区带（`--code-bg`）——light `#c6c5bf` / dark `rgba(255,255,255,.22)` /
//     eink `#b9b9b9`。
//   · eink 的 `--sel` 族整体重定：`--sel` 从纯黑改明度带 `#b9b9b9`、`--sel-text` 从白改黑
//     （`#000000`）。反白路线整条退场 ⇒ 任选区内文字都不再依赖原生选区的覆盖（②不成立）,
//     chrome 侧的悬停组合也不再需要 `:not(:hover)` 逐条兜底（③不成立）。
//
// 不变量：**选区（带）覆盖的文字 MUST 与它压着的底色可辨**——三主题 × 编辑器（正文 / 代码块 /
// 引用块内粗体 / 行内 code 药丸）× chrome（树当前行 / 浮层当前项，含 hover 组合）。
//
// 判据形状按主题分工（不是一套阈值的三处复制）：
//   · light / dark：带**不透明**（light）/ 半透明（dark）⇒ light 用绝对判据（块内选中处 ==
//     同一选区在块外的带色，M288 的不变量原样保留），dark 用相对判据（合成色随承载面变，如实登记）。
//   · eink：带是不透明的明度带 ⇒ 绝对判据 + 字形判据（选区里**各类字形**的亮度跨度 ≥ 60；
//     黑底黑字会让跨度塌到 0，这正是 ② 与粗体段的签名）。
//   · chrome 侧（三主题，eink 优先）：当前行的**文字色 vs 它实际压着的底色**（沿祖先链找第一个
//     不透明底色）通道差 ≥ 40，hover 与不 hover 两种状态都算。
//
// 区分度自证（REVIEW.md 第 1 条）：把 token 换回修前形态（`--sel-band: var(--sel)` 且 --sel 族回原值）
// 后，每个主题**自己那条**判据 MUST 判红：light / dark 是带-vs-承载面的通道差（27 / 16 < MIN）、
// eink 是带内的字形跨度（黑底 + 反白失效 ⇒ 0）、chrome 侧是「浅底白字」组合（eink）。

/** 承载面：正文段 + **引用块（内带粗体与行内 code）** + JS 围栏代码块 + 末尾未选中正文段。
 *  **行的条数与顺序与真机场景 68 的 fixture 逐行一致**（两侧的 y 坐标同源）；文本刻意取短，
 *  避免换行把后续行的 y 顶下去（换行会让两侧坐标同时失效）。 */
const HEAD = "第一段正文，给选区一个起点。";
const QUOTE = "> 引用块里的 **粗体**、`行内码` 与普通文字。";
const CODE_STR = `"${"M".repeat(64)}"`;
const CODE_KW = "const alpha = 1;";
/** 代码块内的**未选中**对照行（选区收在字符串行，块内因此还有一行未选中）。 */
const CODE_CTRL = "const gamma = 2;";
const TAIL = "末尾一段正文。";
const DOC = [HEAD, "", QUOTE, "", "```js", CODE_KW, CODE_STR, CODE_CTRL, "```", "", TAIL, ""].join("\n");

/** 浏览器上下文里定位正文行的子串（`page.evaluate` 看不到 Node 侧常量）。 */
const MARK_HEAD = "第一段正文";
const MARK_QUOTE = "引用块里的";
const MARK_STR = "MMMM";
const MARK_CODE_CTRL = "gamma";
const MARK_TAIL = "末尾一段";

/** 采样方块边长（截图像素）：与 acceptance 的 pixel 断言同口径（7×7 主色 = 底色）。 */
const PATCH = 7;
/** 判「同色」的每通道容差：与 acceptance pixel 的默认 tol 同值。 */
const TOL = 8;
/** 判「可辨」的最小通道差：判据门槛 40（tokens 文档 §编辑器选区带 的取值推导——实测 21 / 14 / 16
 *  被 Alex 判为「人眼压根看不出来」，取约两倍），留一档裕量给抗锯齿抖动。 */
const MIN = 40;
/** 选区里字形可辨的最小亮度跨度（真机场景 68 用同一条阈值）。 */
const MIN_SPREAD = 60;

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

interface Geo {
  head: Box;
  headBand: Box;
  /** 选区起点那个字符的坐标（行内起点的两侧判据贴着它取）。 */
  anchor: { x: number; y: number };
  quote: Box;
  /** 「**粗体**」的**源码区间**（选区覆盖它 ⇒ 显露 ⇒ 那段 DOM 被重建、`.cm-lp-strong` 退场）。
   *  缺陷就是这段重建出来的文字：它不再被原生选区覆盖，`::selection` 的反白够不到它。 */
  boldSrc: { x: number; y: number };
  /** 行内 code 药丸的盒（**不在**显露清单里 ⇒ 选区内它仍以药丸形态在场，自带底色压在带之上）。 */
  pill: Box;
  str: Box;
  codeCtrl: Box;
  tail: Box;
  band: { painted: string; token: string; sel: string };
  selText: string;
  text: string;
  tk: Record<string, string>;
  /** 引用块整行的 DOM 文本（判「强调段是否已显露」——显露是那段被重建的**覆盖证据**）。 */
  quoteText: string;
  /** **显露重建出来的那一段**所在元素的原生选区字色：eink 下 MUST 是正文色（不再反白）。
   *  这条是引擎无关的：像素层在 chromium 对「重建段丢选中」是**假绿**（无头引擎会把原生选区
   *  重新同步到新建的文本节点，M285 已实测登记），只有这条计算样式判据两边都成立。 */
  revealSelectionColor: string;
  /** 编辑器内原生选区在正文容器上的字色。 */
  contentSelectionColor: string;
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
  await expect(page.locator(".cm-content")).toContainText(MARK_HEAD);
}

/** 选区：**从正文行中段**起（Alex 的现场是「从『取』字开始选中」——起点落在行内，不是行首），
 *  跨过引用块（含粗体段与药丸）与代码块的前两行（含被着色的字符串行），收在字符串行之后——
 *  块内单行、块外正文各有一处选中，块内还有一行未选中（`CODE_CTRL`）、末尾一段未选中（`TAIL`）。 */
function selectionRange(): [number, number] {
  // 起点落在首行**行内**：首行第 6 个字起选。收在**下一行行首**（含字符串行末尾的换行）：
  // 末行只覆盖到字符末的话，该行右侧的落空带宽不在选区内，采样点会读到代码行区带
  // （M291 第一版踩过——修后读数与承载面逐值相同，看着像判据失效）。
  return [DOC.indexOf(HEAD) + 6, DOC.indexOf(CODE_CTRL)];
}

async function select(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(([a, b]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: a, head: b } });
  }, [from, to] as const);
  await page.waitForTimeout(150);
}

async function readGeo(page: Page): Promise<Geo> {
  return page.evaluate(
    ([markHead, markQuote, markStr, markCtrl, markTail]) => {
      const box = (el: Element): Box => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      };
      const lines = [...document.querySelectorAll(".cm-line")];
      const lineOf = (mark: string) => lines.find((l) => (l.textContent ?? "").includes(mark))!;
      const head = box(lineOf(markHead));
      const rects = [...document.querySelectorAll(".cm-selectionBackground")].map(box);
      const overlaps = (a: Box, b: Box) => a.y < b.y + b.h && a.y + a.h > b.y;
      const resolve = (value: string): string => {
        const probe = document.createElement("div");
        probe.style.background = value;
        document.body.appendChild(probe);
        const out = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return out;
      };
      const content = document.querySelector<HTMLElement>(".cm-content")!;
      const quoteLine = lineOf(markQuote);
      const strLine = lineOf(markStr);
      const view = (content as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      // 选区起点的**字符坐标**：行内起点的两侧判据要贴着这个字符取（不是贴内容列的左缘）。
      const c = view.coordsAtPos(view.state.selection.main.from);
      // 「**粗体**」源码区间的字符坐标（取区间内第二个字符，稳落在字形上）。
      const boldFrom = view.state.doc.toString().indexOf("**粗体**");
      const bc = view.coordsAtPos(boldFrom + 3);
      return {
        head,
        headBand: rects.filter((r) => overlaps(r, head)).pop()!,
        anchor: { x: c.left, y: (c.top + c.bottom) / 2 },
        quote: box(quoteLine),
        boldSrc: { x: bc.left, y: (bc.top + bc.bottom) / 2 },
        pill: box(quoteLine.querySelector<HTMLElement>(".cm-lp-inline-code")!),
        str: box(strLine),
        codeCtrl: box(lineOf(markCtrl)),
        tail: box(lineOf(markTail)),
        band: {
          painted: getComputedStyle(document.querySelector<HTMLElement>(".cm-selectionBackground")!).backgroundColor,
          token: resolve("var(--sel-band)"),
          sel: resolve("var(--sel)"),
        },
        selText: resolve("var(--sel-text)"),
        text: resolve("var(--text)"),
        tk: { k: resolve("var(--tk-k)"), s: resolve("var(--tk-s)"), n: resolve("var(--tk-n)"), c: resolve("var(--tk-c)") },
        quoteText: (quoteLine.textContent ?? "").trim(),
        revealSelectionColor: getComputedStyle(view.domAtPos(boldFrom + 3).node.parentElement!, "::selection").color,
        contentSelectionColor: getComputedStyle(content, "::selection").color,
      };
    },
    [MARK_HEAD, MARK_QUOTE, MARK_STR, MARK_CODE_CTRL, MARK_TAIL] as const,
  );
}

interface Reading {
  bodyBand: RGB;
  startIn: RGB;
  startOut: RGB;
  /** 引用块（选区中段）上的带色 / 粗体段字形跨度 / 药丸内主色与字形跨度。 */
  quoteBand: RGB;
  /** 强调段（显露重建）的像素跨度：**读数用**（chromium 对这条假绿，终审在真机场景 68）。 */
  boldSpread: number | null;
  pillBand: RGB;
  pillSpread: number | null;
  codeBand: RGB;
  codeUnsel: RGB;
  bodyUnsel: RGB;
  strSpread: number | null;
}

/** 逐点取色（窗口截图 → 7×7 主色）：点全部由 DOM 几何给出；真机场景 68 用手写坐标做同一件事。 */
async function readPoints(page: Page, geo: Geo, name: string): Promise<Reading> {
  const shot = (await page.screenshot()).toString("base64");
  const img = decodeScreenshot(shot);
  // 取不到色即抛错（「读不到」不当成「没有」——REVIEW.md 第 2 条）。采样点全部由 DOM 几何给出，
  // 落在图外只可能是装置坏了。
  const at = (x: number, y: number): RGB => {
    const c = dominantColor(img, Math.round(x), Math.round(y), PATCH);
    if (!c) throw new Error(`采样点 (${Math.round(x)}, ${Math.round(y)}) 取不到主色`);
    return c;
  };
  const spread = (x: number, y: number) => lumaSpread(img, Math.round(x), Math.round(y), PATCH)?.spread ?? null;
  const midY = (b: Box) => b.y + b.h / 2;
  // 行盒右端往内 30px：正文行在那里必是落空带（文字左对齐、行长有限）；代码行同理。
  const rightOf = (b: Box) => b.x + b.w - 30;
  const reading: Reading = {
    bodyBand: at(rightOf(geo.head), midY(geo.head)),
    // 选区起点两侧：贴**起点字符**左右各 22px（同一行、同一 y）——「从哪里开始选中」的判据点。
    startIn: at(geo.anchor.x + 22, geo.anchor.y),
    startOut: at(geo.anchor.x - 22, geo.anchor.y),
    quoteBand: at(rightOf(geo.quote), midY(geo.quote)),
    // 显露出来的强调段：从源码区间的字符坐标往右 30px（稳落在 `粗体` 两字的笔画上）。
    boldSpread: spread(geo.boldSrc.x + 30, geo.boldSrc.y),
    pillBand: at(geo.pill.x + geo.pill.w / 2, midY(geo.pill)),
    pillSpread: spread(geo.pill.x + geo.pill.w / 2, midY(geo.pill)),
    codeBand: at(rightOf(geo.str), midY(geo.str)),
    codeUnsel: at(rightOf(geo.codeCtrl), midY(geo.codeCtrl)),
    bodyUnsel: at(rightOf(geo.tail), midY(geo.tail)),
    // 字符串行左段：mono 12px 下 40px 处必落在引号之后的字符笔画上（行盒左端 = 代码文本起点）。
    strSpread: spread(geo.str.x + 40, midY(geo.str)),
  };
  img.close();
  console.log(
    `M291 ${name} 正文带=${formatColor(reading.bodyBand)} 起点内=${formatColor(reading.startIn)} 起点外=${formatColor(reading.startOut)} ` +
      `引用带=${formatColor(reading.quoteBand)} 粗体跨度=${reading.boldSpread} 药丸内=${formatColor(reading.pillBand)} 药丸跨度=${reading.pillSpread} ` +
      `代码带=${formatColor(reading.codeBand)} 代码外=${formatColor(reading.codeUnsel)} 正文外=${formatColor(reading.bodyUnsel)} 串跨度=${reading.strSpread} ` +
      `带token=${geo.band.token} sel=${geo.band.sel} selText=${geo.selText}`,
  );
  return reading;
}

const rgb = (css: string): RGB => {
  const m = css.match(/\d+/g)!;
  return { r: Number(m[0]), g: Number(m[1]), b: Number(m[2]) };
};

// ---------------------------------------------------------------------------
// chrome 侧：当前行 / 浮层当前项的文字 vs 它实际压着的底色（沿祖先链找第一个不透明底色）
// ---------------------------------------------------------------------------

interface SurfaceReading {
  sel: string;
  text: string;
  color: string;
  /** 合成后的底色（沿祖先链把半透明层逐层压到第一个不透明层上）。 */
  bg: string;
  bgFrom: string;
}

async function surfaceReading(page: Page, selector: string): Promise<SurfaceReading | null> {
  return page.evaluate((sel) => {
    const parse = (s: string) => {
      const m = s.match(/[\d.]+/g) ?? ["0", "0", "0"];
      return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
    };
    const over = (fg: { r: number; g: number; b: number; a: number }, bg: { r: number; g: number; b: number }) => ({
      r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
      g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
      b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    });
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    // 从元素向上收集背景层（含自身），逐层合成到一个不透明底上。
    const layers: { c: { r: number; g: number; b: number; a: number }; from: string }[] = [];
    for (let n: HTMLElement | null = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a > 0.001) layers.push({ c, from: `${n.tagName}.${n.className.toString().slice(0, 30)}` });
      if (c.a === 1) break;
    }
    let acc = { r: 255, g: 255, b: 255 };
    for (const l of [...layers].reverse()) acc = over(l.c, acc);
    const color = parse(getComputedStyle(el).color);
    const fmt = (c: { r: number; g: number; b: number }) => `rgb(${c.r}, ${c.g}, ${c.b})`;
    return { sel, text: (el.textContent ?? "").trim().slice(0, 12), color: fmt(color), bg: fmt(acc), bgFrom: layers[0]?.from ?? "(none)" };
  }, selector);
}

test.describe("M291：选区族对比度（不变量）", () => {
  test("编辑器：三主题 × 正文/引用块/代码块 × 选区起点与中段，带 MUST 与承载面可辨", async ({ page }) => {
    for (const theme of THEMES) {
      await openDoc(page, theme);
      const [from, to] = selectionRange();
      await select(page, from, to);
      const geo = await readGeo(page);
      const r = await readPoints(page, geo, theme);

      // 标定 + 防空转：代码行区带 MUST 与正文承载面可辨（采样点漂到块外时这条先红）。
      expect(
        colorDiff(r.codeUnsel, r.bodyUnsel),
        `${theme}：代码行区带 MUST 与正文承载面可辨（差 ${colorDiff(r.codeUnsel, r.bodyUnsel)}）——它在场才说明采样点落在块上`,
      ).toBeGreaterThanOrEqual(8);

      // 相对判据（三主题同一条）：带 vs 未选中的两种承载面，含选区起点与中段。
      expect(
        colorDiff(r.bodyBand, r.bodyUnsel),
        `${theme}：正文选区带 MUST 与正文承载面可辨（差 ${colorDiff(r.bodyBand, r.bodyUnsel)}，门槛 ${MIN}）`,
      ).toBeGreaterThanOrEqual(MIN);
      expect(
        colorDiff(r.quoteBand, r.bodyUnsel),
        `${theme}：引用块（选区中段）上的带 MUST 可辨（差 ${colorDiff(r.quoteBand, r.bodyUnsel)}）`,
      ).toBeGreaterThanOrEqual(MIN);
      expect(
        colorDiff(r.codeBand, r.codeUnsel),
        `${theme}：代码块内的选区带 MUST 与代码行区带可辨（差 ${colorDiff(r.codeBand, r.codeUnsel)}，门槛 ${MIN}）`,
      ).toBeGreaterThanOrEqual(MIN);
      expect(
        colorDiff(r.startIn, r.startOut),
        `${theme}：选区**起点**两侧 MUST 可辨（差 ${colorDiff(r.startIn, r.startOut)}）——「从『取』字开始选中」要看得出来`,
      ).toBeGreaterThanOrEqual(MIN);

      // 结构层：带由 token 决定。
      expect(geo.band.painted, `${theme}：自绘的选区带 MUST 恰好是 --sel-band`).toBe(geo.band.token);

      if (theme === "dark") {
        // dark 的带是半透明白：合成色随承载面变 ⇒ 绝对判据不成立（M288 的同一条登记）。
        expect(
          colorDiff(r.codeBand, r.codeUnsel),
          `${theme}：dark 由 --sel-band 决定的地方，块内选中处 MUST 与代码行区带可辨`,
        ).toBeGreaterThanOrEqual(MIN);
      } else {
        // light / eink 的带不透明 ⇒ 块内选中处 MUST 等于**同一选区**在块外的带色（M288 的不变量）。
        expect(
          colorDiff(r.codeBand, r.quoteBand),
          `${theme}：代码块内选中处的带色 MUST 等于同一选区在块外的带色（差 ${colorDiff(r.codeBand, r.quoteBand)}）`,
        ).toBeLessThanOrEqual(TOL);
      }
    }
  });

  test("eink：选区里各类字形 MUST 可辨（含引用块内行内 code 药丸）", async ({ page }) => {
    await openDoc(page, "eink");
    const [from, to] = selectionRange();
    await select(page, from, to);
    const geo = await readGeo(page);
    const r = await readPoints(page, geo, "eink");

    // 覆盖证据：选区覆盖了强调范围 ⇒ 它被显露（源码形态在场、`.cm-lp-strong` 退场）——
    // 「这段符号确实在选区里，而且它是被重建出来的那一拍」，正是缺陷的现场前提。
    expect(geo.quoteText, "本场景的选区 MUST 覆盖到强调范围（显露后 `**粗体**` 回到 DOM）").toContain("**粗体**");
    await expect(page.locator(".cm-lp-strong", { hasText: "粗体" })).toHaveCount(0);

    // ① 引用块内**强调段**（显露重建出来的那一段）：Alex 的现场。两侧判据分工：
    //    · 结构（引擎无关，本节断言）：重建段所在元素的原生选区字色 MUST 是正文色——
    //      「不再往选区里的文字上写白色」是这次修复的全部内容，这条正判它。
    //    · 像素（真机是终审）：chromium 的像素层对本条**假绿**（无头引擎会把原生选区重新同步到
    //      新建的文本节点 ⇒ 修前也亮，自证轮实测跨度 242），故这里只把读数打出来、
    //      断言落在真机场景 68（那里修前实测塌到个位数）。
    expect(
      geo.revealSelectionColor,
      `eink：显露重建段所在元素的原生选区字色 MUST 是正文色（实测 ${geo.revealSelectionColor}）`,
    ).toBe(geo.text);
    // ② 行内 code 药丸里的字：药丸自带底色（画在带之上），字色必须仍然可读。
    expect(
      r.pillSpread,
      `eink：选中区里**行内 code 药丸**的字 MUST 可读（跨度 ${r.pillSpread} ≥ ${MIN_SPREAD}）——白字压浅灰时塌到个位数`,
    ).toBeGreaterThanOrEqual(MIN_SPREAD);
    // ③ 被着色的代码字符串（显式字色）。
    expect(
      r.strSpread,
      `eink：选中区里**着色字符串**的字形 MUST 可辨（跨度 ${r.strSpread} ≥ ${MIN_SPREAD}）`,
    ).toBeGreaterThanOrEqual(MIN_SPREAD);

    // ④ 带与文字色族：带与正文色 / 全部 --tk-* 色的通道差 ≥ MIN（字形可读的 token 层前提）。
    const band = rgb(geo.band.token);
    for (const [label, css] of [
      ["--text", geo.text],
      ["--tk-k", geo.tk.k],
      ["--tk-s", geo.tk.s],
      ["--tk-n", geo.tk.n],
      ["--tk-c", geo.tk.c],
    ] as const) {
      expect(
        colorDiff(band, rgb(css)),
        `eink：选区带 MUST 与 ${label} 可辨（差 ${colorDiff(band, rgb(css))}）——带与文字同色时选区里的字被吞`,
      ).toBeGreaterThanOrEqual(MIN);
    }
    // ⑤ 编辑器内原生选区的字色 = 正文色（eink 不再反白；`--sel-text` 也已是黑字）。
    expect(geo.contentSelectionColor, "eink：编辑器内原生选区的字色 MUST 是正文色（不再反白）").toBe(geo.text);
    expect(geo.selText, "eink：--sel-text MUST 是黑字（反白路线整条退场）").toBe(geo.text);
    // 如实登记：药丸内部读到的是**药丸自己的底色**（in-flow 行内底色画在带之上）——本 mission 未收口，
    // 见 docs/backlog.md 的同类表面记账。这里只要求「药丸里的字可读」（上面 ②）。
    console.log(`M291 eink 药丸内部主色=${formatColor(r.pillBand)}（in-flow 行内底色盖住带，已登记未收口）`);
  });

  test("chrome 侧：eink 的当前行 / 浮层当前项 MUST 文字可辨（hover 组合同样成立）", async ({ page }) => {
    await stubTauri(page, {
      root: "/mock/vault",
      vault_id: "v1",
      files: { "e.md": DOC },
      entries: [
        { path: "a.md", name: "a.md", kind: "file", size: 1, mtime_ms: 0 },
        { path: "e.md", name: "e.md", kind: "file", size: DOC.length, mtime_ms: 0 },
      ],
      vaults: [
        { id: "v1", path: "/mock/vault", name: "v1", available: true, last_opened_at: 1, tab_count: 1 },
        { id: "v2", path: "/mock/other", name: "other", available: true, last_opened_at: 2, tab_count: 0 },
      ],
      config: { theme: "eink" },
    });
    await page.goto("/");
    const row = page.locator('.ft-row[title="e.md"]');
    await row.click();
    await expect(page.locator(".cm-content")).toContainText(MARK_HEAD);

    // 过渡（0.1s）落定后再读：底色从上一档插值过来的中间帧是半透明黑，读数不代表稳态
    await page.waitForTimeout(300);

    const check = async (selector: string, label: string) => {
      const s = await surfaceReading(page, selector);
      expect(s, `${label}：MUST 找得到该表面（${selector}）`).not.toBeNull();
      const diff = colorDiff(rgb(s!.color), rgb(s!.bg));
      console.log(`M291 chrome ${label} 文字=${s!.color} 底=${s!.bg}（来自 ${s!.bgFrom}）差=${diff}`);
      expect(
        diff,
        `${label}：当前行的文字 MUST 与它实际压着的底色可辨（差 ${diff}，门槛 ${MIN}）——「白字灰底」正是这条的失败形态`,
      ).toBeGreaterThanOrEqual(MIN);
    };

    // 树当前行（不 hover）
    await check(".ft-row.is-current .ft-name", "eink·树当前行");
    // 树当前行 + hover（`--hover` 档会压过选中底色——eink 修前全靠 `:not(:hover)` 排除条款兜底）
    await row.hover();
    await page.waitForTimeout(300);
    await check(".ft-row.is-current .ft-name", "eink·树当前行（hover）");
    // 浮层当前项（树头的 vault 入口 → 浮层）
    await page.locator(".ft-vault").click();
    await expect(page.locator(".vault-pop")).toBeVisible();
    await check(".vault-row.is-current .vault-row-name", "eink·浮层当前项");
    await check(".vault-row.is-current .vault-dot", "eink·浮层当前项（✓ 槽位）");
    await page.locator(".vault-row.is-current").hover();
    await page.waitForTimeout(300);
    await check(".vault-row.is-current .vault-row-name", "eink·浮层当前项（hover）");

    // 区分度自证（REVIEW.md 第 1 条）：把**修前的脆弱形态**按回去——悬停态仍写白字。
    // 修前这套表面正是靠逐条 `:not(:hover)` 排除条款才没落到「白字压 `--hover` 浅底」上；
    // 条款漏一处、或过渡帧落在两态之间，就是 Alex 的「白字灰底」。这条断言必须能红。
    await page.keyboard.press("Escape");
    await expect(page.locator(".vault-pop")).toBeHidden();
    await page.addStyleTag({
      content: `:root[data-theme="eink"] .ft-row.is-current:hover .ft-name { color: #ffffff !important; }`,
    });
    await row.hover();
    await page.waitForTimeout(300);
    const fragile = await surfaceReading(page, ".ft-row.is-current .ft-name");
    const fragileDiff = colorDiff(rgb(fragile!.color), rgb(fragile!.bg));
    console.log(`M291 chrome eink·「白字压浅底」注入形态 文字=${fragile!.color} 底=${fragile!.bg} 差=${fragileDiff}`);
    expect(
      fragileDiff,
      `eink·「白字压浅底」的注入形态 MUST 落在门槛之下（差 ${fragileDiff} < ${MIN}）——这条判据因此有区分度`,
    ).toBeLessThan(MIN);

    // 原生选区（`::selection`）的底色/前景对：eink 的 `--sel` 族 MUST 互辨。
    const native = await page.evaluate(() => {
      const resolve = (v: string) => {
        const p = document.createElement("div");
        p.style.background = v;
        document.body.appendChild(p);
        const out = getComputedStyle(p).backgroundColor;
        p.remove();
        return out;
      };
      return { sel: resolve("var(--sel)"), selText: resolve("var(--sel-text)") };
    });
    expect(
      colorDiff(rgb(native.sel), rgb(native.selText)),
      `eink：--sel 与其前景 --sel-text MUST 可辨（差 ${colorDiff(rgb(native.sel), rgb(native.selText))}）`,
    ).toBeGreaterThanOrEqual(MIN);
  });

  test("区分度自证：换回修前的 --sel 族（撞色档 + 反白）后，各主题自己那条判据 MUST 判红", async ({ page }) => {
    // REVIEW.md 第 1 条：断言必须先造一个必须让它红的输入——这里造的就是 M291 **修前的产品行为**。
    for (const theme of THEMES) {
      await openDoc(page, theme);
      // 修前形态：light/dark 的带回到 `--sel`（撞色档），eink 回到纯黑 + 白字（反白档）。
      await page.addStyleTag({
        content:
          theme === "eink"
            ? `:root[data-theme] { --sel-band: #000000 !important; --sel: #000000 !important; --sel-text: #ffffff !important; }`
            : `:root[data-theme] { --sel-band: var(--sel) !important; }`,
      });
      const [from, to] = selectionRange();
      await select(page, from, to);
      const geo = await readGeo(page);
      const r = await readPoints(page, geo, `${theme}·修前形态（区分度自证）`);
      if (theme === "eink") {
        expect(
          geo.revealSelectionColor,
          `eink·修前形态：重建段所在元素的原生选区字色 MUST 是白字（实测 ${geo.revealSelectionColor}）——判据因此有区分度`,
        ).not.toBe(geo.text);
        expect(r.pillSpread, `eink·修前形态：药丸里的字 MUST 被吞（跨度 ${r.pillSpread} < ${MIN_SPREAD}：白字压浅灰）`).toBeLessThan(MIN_SPREAD);
        expect(
          colorDiff(rgb(geo.band.token), rgb(geo.text)),
          `eink·修前形态：带与正文色 MUST 同色（差 ${colorDiff(rgb(geo.band.token), rgb(geo.text))} < ${MIN}）`,
        ).toBeLessThan(MIN);
      } else {
        expect(
          colorDiff(r.bodyBand, r.bodyUnsel),
          `${theme}·修前形态：带与正文承载面的差 MUST 小于 MIN（实测 ${colorDiff(r.bodyBand, r.bodyUnsel)}）——判据因此有区分度`,
        ).toBeLessThan(MIN);
        expect(
          colorDiff(r.codeBand, r.codeUnsel),
          `${theme}·修前形态：带与代码行区带的差 MUST 小于 MIN（实测 ${colorDiff(r.codeBand, r.codeUnsel)}）——判据因此有区分度`,
        ).toBeLessThan(MIN);
      }
    }
  });
});
