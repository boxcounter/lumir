// tests/visual/scenes/markdown-editing-stability.spec.ts —— 编辑 / 渲染对抗下的**布局稳定性**（M842）。
//
// 用户现场（Alex，2026-11）：同一条 Markdown 行在「光标停在本行」与「光标不在本行」两种状态下
// 行高不同，整篇内容随光标移动上下跳。本场景把这条手感写成机器判据。
//
// ## 合同（本文件钉住的不变量）
//
// C1 **导航不改状态**：光标移动 / 选区变化 / 焦点进入离开，MUST NOT 改变 `EditorState.doc`
//    的任何一个字节、MUST NOT 触发落盘、MUST NOT 把文档标脏，也 MUST NOT 新增 history 步
//    ——编辑之后无论做多少轮光标 / 选区 / 焦点循环，**一次** undo 仍回到编辑前那一态
//   （doc 与选区都回，见「编辑后光标 / 选区 / 焦点循环」用例）。
// C2 **行盒稳定**（active↔inactive）：对未列入 C3 合法重排的行（含链接与裸 marker 行），
//    `.cm-line` 的行盒高度、行内首段文本的字形 rect 高度与基线（top）在两种状态下逐像素相同
//    （≤0.5px），其后各行的 top 也随之相同；链接目标显露与 marker widget 切换只许改变横向排版。
// C3 **合法重排有界且只落在本行**：源码显露（标题 `#`、强调 `**`、行内公式）允许改变**本行**
//    的行盒；其余各行 MUST NOT 自行改变高度，且其 top 位移必须
//    恰好等于本行之前所有获批行的高度变化之和（±0.5px）——「别人跟着跳」只允许是被本行
//    高度变化推的，不允许是自身重排。
// C4 **横向几何稳定**：列表 marker 右缘、正文左缘 x、表格各 cell 的 left/width/height 在
//    active↔inactive 之间不变（≤0.5px）。
// C5 **渲染投影不污染源码**：在渲染态结构里键入 / 删除（表格 cell、列表项、强调、公式、
//    wikilink），写进文档的必须是**源码字节的编辑结果**——渲染字形（`–` / `◦` / `[x]` /
//    cell 文本 / KaTeX 字形）MUST NOT 出现在文档里；一次 undo 复原到逐字节相同的旧文；
//    ⌘S 落盘的全文 = 编辑后的文档。
//
// ## 分工（不重复建设）
//
// - 期望值模型：`tests/unit/editing-oracle-model.ts`（顶层列表 + 通用文本编辑，M832）；
//   本文件不新增第二个 markdown 模型，嵌套 / 任务 / 表格这类「生产语义由上游 markdown 包
//   决定」的形态用**显式期望串**逐案钉住（与 editing-oracle 的 witness 用例同法）。
// - 真键盘 / 真 view / 真落盘：本文件；纯函数与大样本随机序列仍归 Node 层。
// - 像素基线：本文件只做结构 / 几何断言，MUST NOT 新增或更新任何截图基线。
//
// ## 容差口径
//
// 几何读数全部取亚像素浮点（`getBoundingClientRect`），容差 `TOL = 0.5px`：比一个 CSS 像素
// 还小——link `↗` 标记与裸 marker 行历史上各有 2px 抖动，在同一次实测里就是这个量级，
// 能抓住；抗锯齿 / 子像素取整的抖动在 0.1px 量级，不会误报。
import { expect, test, type Page } from "@playwright/test";
import { stubTauri, fileText, type VaultFixture } from "./tauri-stub";

const TOL = 0.5;
/** 源码显露允许的最大合法重排幅度：一行最多换一次行（正文行高 ≤ 34px，留 1.5 行余量）。
 *  超过它就是「重新排版了整个块」，不是显露——按 C3 判红。 */
const MAX_LEGAL_REFLOW = 52;

// ---------------------------------------------------------------------------
// 装置
// ---------------------------------------------------------------------------

function vaultWith(path: string, text: string): VaultFixture {
  return {
    entries: [{ path, kind: "file", size: text.length, mtime_ms: 0 }],
    files: { [path]: text },
    links: {},
  };
}

async function openDoc(page: Page, path: string, doc: string, theme?: "light" | "dark" | "eink"): Promise<void> {
  const vault = vaultWith(path, doc);
  await stubTauri(page, theme === undefined ? vault : { ...vault, config: { theme } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(path);
  await page.waitForTimeout(200);
}

interface EditorReading {
  doc: string;
  anchor: number;
  head: number;
}

async function bodyState(page: Page): Promise<EditorReading> {
  return page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { doc: view.state.doc.toString(), anchor: main.anchor, head: main.head };
  });
}

async function setCaret(page: Page, pos: number, head = pos): Promise<void> {
  await page.locator(".cm-content").evaluate(
    (el, range) => {
      const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      view.dispatch({ selection: { anchor: range.anchor, head: range.head } });
      view.focus();
    },
    { anchor: pos, head },
  );
  await page.waitForTimeout(120);
}

/** 一行的几何读数（全部 CSS px，未取整的浮点）。
 *
 *  - `top` / `height`：`.cm-line` 元素盒（含块内 padding，标题的 padding-top 也在这里）；
 *  - `baseTop` / `baseHeight`：该行**第一段可见文本**的字形 rect（m647 的「行盒」通道：
 *    inline 盒 = line-height，不含段落末行 padding）——基线漂移就看它；
 *  - `textLeft` / `textRight`：该行正文文本（跳过 marker / task widget）的左右缘；
 *  - `markerRight`：列表 marker widget 的右缘（body 列的基准）；
 *  - `cells`：表格行内每个 cell 的 left / width / height。
 */
interface LineBox {
  text: string;
  top: number;
  height: number;
  baseTop: number | null;
  baseHeight: number | null;
  textLeft: number | null;
  textRight: number | null;
  markerRight: number | null;
  cells: Array<{ left: number; width: number; top: number; height: number }>;
}

async function readGeometry(page: Page): Promise<LineBox[]> {
  return page.locator(".cm-content").evaluate((content) => {
    const lines = [...content.querySelectorAll<HTMLElement>(".cm-line")];
    return lines.map((line) => {
        const rect = line.getBoundingClientRect();
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        const textRects: DOMRect[] = [];
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent || node.textContent.trim() === "") continue;
          if ((node.parentElement as Element | null)?.closest(".cm-lp-list-marker")) continue;
          if ((node.parentElement as Element | null)?.closest(".cm-lp-task-marker")) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const r of Array.from(range.getClientRects())) {
            if (r.width > 0 && r.height > 0) textRects.push(r);
          }
        }
        const base = textRects.length > 0 ? textRects[0] : null;
        const marker = line.querySelector<HTMLElement>(".cm-lp-list-marker");
        const markerRect = marker ? marker.getBoundingClientRect() : null;
        return {
          text: line.textContent ?? "",
          top: rect.top,
          height: rect.height,
          baseTop: base ? base.top : null,
          baseHeight: base ? base.height : null,
          textLeft: textRects.length > 0 ? Math.min(...textRects.map((r) => r.left)) : null,
          textRight: textRects.length > 0 ? Math.max(...textRects.map((r) => r.right)) : null,
          markerRight: markerRect ? markerRect.right : null,
          cells: [...line.querySelectorAll<HTMLElement>(".cm-lp-table-cell")].map((cell) => {
            const r = cell.getBoundingClientRect();
            return { left: r.left, width: r.width, top: r.top, height: r.height };
          }),
        };
    });
  });
}

interface StabilityOptions {
  /** 允许合法重排的行号（源码显露）。未列出的行 MUST NOT 自行改变高度。 */
  allow: number[];
  label: string;
}

/** C2 / C3 / C4：active↔inactive 的几何判据。
 *
 *  - 获批行：允许高度变化，但幅度 ≤ {@link MAX_LEGAL_REFLOW}；
 *  - 其余行：高度、基线、文本左右缘、marker 右缘、cell 矩形逐项 ≤ {@link TOL}；
 *  - 所有行的 top 位移 MUST 等于「它之前所有获批行的高度变化之和」——内容跟着跳只允许是
 *    被获批行的高度变化推的。 */
function expectStableGeometry(before: LineBox[], after: LineBox[], options: StabilityOptions): void {
  const { allow, label } = options;
  const allowed = new Set(allow);
  expect(after.length, `${label}：行数变化（重排越出行边界）`).toBe(before.length);
  let shift = 0;
  for (let i = 0; i < before.length; i += 1) {
    const a = before[i];
    const b = after[i];
    const where = `${label} · 第 ${i} 行「${a.text.slice(0, 28)}」`;
    if (allowed.has(i)) {
      expect(Math.abs(b.height - a.height), `${where}：获批重排超界`).toBeLessThanOrEqual(MAX_LEGAL_REFLOW);
    } else {
      expect(Math.abs(b.height - a.height), `${where}：行盒高度漂移`).toBeLessThanOrEqual(TOL);
      if (a.baseTop !== null && b.baseTop !== null) {
        expect(Math.abs(b.baseTop - (a.baseTop + shift)), `${where}：文本基线漂移`).toBeLessThanOrEqual(TOL);
      }
      if (a.baseHeight !== null && b.baseHeight !== null) {
        expect(Math.abs(b.baseHeight - a.baseHeight), `${where}：字形 rect 高度漂移`).toBeLessThanOrEqual(TOL);
      }
      if (a.textLeft !== null && b.textLeft !== null) {
        expect(Math.abs(b.textLeft - a.textLeft), `${where}：正文左缘漂移`).toBeLessThanOrEqual(TOL);
      }
      if (a.markerRight !== null && b.markerRight !== null) {
        expect(Math.abs(b.markerRight - a.markerRight), `${where}：列表 marker 右缘漂移`).toBeLessThanOrEqual(TOL);
      }
      expect(b.cells.length, `${where}：cell 数量变化`).toBe(a.cells.length);
      a.cells.forEach((cell, c) => {
        const other = b.cells[c];
        expect(Math.abs(other.left - cell.left), `${where} cell ${c}：left 漂移`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(other.width - cell.width), `${where} cell ${c}：width 漂移`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(other.height - cell.height), `${where} cell ${c}：height 漂移`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(other.top - (cell.top + shift)), `${where} cell ${c}：top 漂移`).toBeLessThanOrEqual(TOL);
      });
    }
    // 0 高行（表格分隔行整行被 replace 覆盖）没有布局位置：rect 恒为 0，top 判据对它是空转。
    if (!(a.height === 0 && b.height === 0)) {
      expect(Math.abs(b.top - (a.top + shift)), `${where}：top 位移 ≠ 前序获批行的高度变化之和`).toBeLessThanOrEqual(TOL);
    }
    shift += b.height - a.height;
  }
}

/** 精确复原：再次读回的几何与基线逐项相同（含获批行）。 */
function expectRestored(baseline: LineBox[], actual: LineBox[], label: string): void {
  expect(actual.length, `${label}：行数变化`).toBe(baseline.length);
  for (let i = 0; i < baseline.length; i += 1) {
    const a = baseline[i];
    const b = actual[i];
    const where = `${label} · 第 ${i} 行「${a.text.slice(0, 28)}」`;
    if (!(a.height === 0 && b.height === 0)) {
      expect(Math.abs(b.top - a.top), `${where}：top 未复原`).toBeLessThanOrEqual(TOL);
    }
    expect(Math.abs(b.height - a.height), `${where}：行盒高度未复原`).toBeLessThanOrEqual(TOL);
    if (a.baseTop !== null && b.baseTop !== null) {
      expect(Math.abs(b.baseTop - a.baseTop), `${where}：基线未复原`).toBeLessThanOrEqual(TOL);
    }
    if (a.textLeft !== null && b.textLeft !== null) {
      expect(Math.abs(b.textLeft - a.textLeft), `${where}：正文左缘未复原`).toBeLessThanOrEqual(TOL);
    }
    if (a.markerRight !== null && b.markerRight !== null) {
      expect(Math.abs(b.markerRight - a.markerRight), `${where}：marker 右缘未复原`).toBeLessThanOrEqual(TOL);
    }
    expect(b.cells.length, `${where}：cell 数量未复原`).toBe(a.cells.length);
    a.cells.forEach((cell, c) => {
      const other = b.cells[c];
      expect(Math.abs(other.left - cell.left), `${where} cell ${c}：left 未复原`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(other.width - cell.width), `${where} cell ${c}：width 未复原`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(other.height - cell.height), `${where} cell ${c}：height 未复原`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(other.top - cell.top), `${where} cell ${c}：top 未复原`).toBeLessThanOrEqual(TOL);
    });
  }
}

// ---------------------------------------------------------------------------
// 夹具：一份覆盖代表性行类型的文档
// ---------------------------------------------------------------------------

const MIXED_DOC = [
  "引言段落 alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu 结尾。",
  "",
  "- 顶级项目一",
  "- 顶级项目二带一点更长一点的正文以便观察换行行为 alpha bravo charlie delta echo",
  "",
  "1. 有序一",
  "2. 有序二",
  "",
  "- [ ] 任务未完成",
  "- [x] 任务已完成",
  "",
  "- 嵌套父项",
  "  - 嵌套子项",
  "    - 嵌套孙项",
  "",
  "# 一级标题 hello",
  "",
  "## 二级标题 world",
  "",
  "**加粗文本** 与 *斜体* 与 `行内代码` 混排的一行。",
  "",
  "行内公式 $a^2+b^2=c^2$ 与 wikilink [[目标笔记]]。",
  "",
  "链接 [示例](https://example.com) 单独一行。",
  "",
  "| 列甲 |  | 列丙 |",
  "| --- | --- | --- |",
  "| 甲一 | 乙一 | 丙一 |",
  "| 甲二 | 乙二 | 丙二 |",
  "",
  "para",
  "1. ",
  "",
].join("\n");

const lineIndexOf = (doc: string, needle: string): number => doc.slice(0, doc.indexOf(needle)).split("\n").length - 1;
const posOf = (doc: string, needle: string, offset = 1): number => doc.indexOf(needle) + offset;

/** 每个探针：把光标停在 `pos`，断言相对「光标停在首行」的几何变化只发生在 `allow` 行。 */
interface Probe {
  label: string;
  pos: number;
  allow: number[];
  /** 该探针 MUST 真实改变这一行的渲染态（否则它对缺陷没有区分度）。 */
  reflowLine?: number;
}

function probesFor(doc: string): Probe[] {
  const line = (needle: string) => lineIndexOf(doc, needle);
  return [
    // 稳定项：不显露源码，MUST 逐像素不动。
    { label: "普通段落行内", pos: 20, allow: [] },
    { label: "长段落行（换行）", pos: posOf(doc, "bravo", 1), allow: [] },
    { label: "空行", pos: posOf(doc, "\n\n- 顶级项目一", 1), allow: [] },
    { label: "bullet marker 区", pos: doc.indexOf("- 顶级项目一"), allow: [] },
    { label: "bullet 内容", pos: doc.indexOf("- 顶级项目一") + 2, allow: [] },
    { label: "有序 marker 区", pos: doc.indexOf("1. 有序一"), allow: [] },
    { label: "任务 marker 区", pos: doc.indexOf("- [ ] 任务未完成"), allow: [] },
    { label: "嵌套 marker 区", pos: doc.indexOf("  - 嵌套子项"), allow: [] },
    { label: "表头 cell", pos: posOf(doc, "列甲", 0), allow: [] },
    { label: "表数据 cell", pos: posOf(doc, "甲一", 1), allow: [] },
    { label: "表格隐藏管道位（行首）", pos: doc.indexOf("| 列甲"), allow: [] },
    { label: "表格分隔行", pos: doc.indexOf("| --- |") + 2, allow: [] },
    // 合法重排项：源码显露，允许本行变化、其余行只跟随位移。
    { label: "标题行（显露 #）", pos: posOf(doc, "# 一级标题", 3), allow: [line("# 一级标题")], reflowLine: line("# 一级标题") },
    { label: "强调（显露 **）", pos: posOf(doc, "加粗文本", 1), allow: [line("加粗文本")], reflowLine: line("加粗文本") },
    { label: "行内公式（显露 $…$）", pos: posOf(doc, "a^2", 2), allow: [line("行内公式")], reflowLine: line("行内公式") },
    // 链接与裸 marker 仍真实切换渲染态，但纵向几何必须稳定。
    { label: "标准链接（显露 ](target)）", pos: posOf(doc, "链接 [示例]", 5), allow: [], reflowLine: line("链接 [示例]") },
    { label: "裸 marker 行（进入列表渲染）", pos: doc.indexOf("para\n1. ") + "para\n".length, allow: [], reflowLine: line("para") + 1 },
  ];
}

/** 渲染态切换的区分度：文本右缘 / 行高 / 基线变化，或 marker widget 出现 / 消失均可作证。
 *  链接与裸 marker 修复后只剩横向变化或 widget 切换，不能再靠历史上的 2px 行高差判绿。 */
function reflowed(a: LineBox, b: LineBox): boolean {
  if (Math.abs(b.height - a.height) > TOL) return true;
  if (a.textRight !== null && b.textRight !== null && Math.abs(b.textRight - a.textRight) > TOL) return true;
  if (a.baseTop !== null && b.baseTop !== null && Math.abs(b.baseTop - a.baseTop) > TOL) return true;
  if ((a.markerRight === null) !== (b.markerRight === null)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// C1 / C2 / C3 / C4：active↔inactive 几何矩阵（Chromium + WebKit）
// ---------------------------------------------------------------------------

test("光标进入任意行：非显露行几何逐像素不动，显露行只动本行且复原（含表格与列表）", async ({ page }) => {
  await openDoc(page, "mixed.md", MIXED_DOC);
  await expect(page.locator(".cm-lp-table").first()).toBeVisible();
  const path = "mixed.md";

  await setCaret(page, 0);
  const baseline = await readGeometry(page);
  const doc0 = await bodyState(page);

  for (const probe of probesFor(MIXED_DOC)) {
    await setCaret(page, probe.pos);
    const active = await readGeometry(page);
    expectStableGeometry(baseline, active, { allow: probe.allow, label: probe.label });

    if (probe.reflowLine !== undefined) {
      const index = probe.reflowLine;
      expect(reflowed(baseline[index], active[index]), `${probe.label}：本行没有切换渲染态（该探针对缺陷没有区分度）`).toBe(true);
    }

    // 回到非活动态：几何必须精确复原。
    await setCaret(page, 0);
    expectRestored(baseline, await readGeometry(page), `${probe.label} · 复原`);

    const state = await bodyState(page);
    expect(state.doc, `${probe.label}：光标移动改变了文档字节`).toBe(doc0.doc);
    expect(state.doc).toBe(MIXED_DOC);
    expect(await fileText(page, path), `${probe.label}：光标移动触发了落盘`).toBe(MIXED_DOC);
    await expect(page.locator(".modeline-path")).not.toContainText("（未保存）");
  }
});

// ---------------------------------------------------------------------------
// C1 / C3：重复光标循环与焦点切换，无累积漂移
// ---------------------------------------------------------------------------

test("光标反复进出 + 焦点进出 12 轮：几何零累积漂移，文档与保存状态不变", async ({ page }) => {
  const doc = [
    "第一段。", "", "- 列表项一", "  - 嵌套项", "",
    "| a | b |", "| --- | --- |", "| c | d |", "",
    "链接 [示例](https://example.com)。", "", "para", "1. ", "", "尾段。",
  ].join("\n");
  await openDoc(page, "cycle.md", doc);
  await expect(page.locator(".cm-lp-table").first()).toBeVisible();

  await setCaret(page, 0);
  const baseline = await readGeometry(page);
  const targets = [
    doc.indexOf("- 列表项一") + 2,
    doc.indexOf("c | d") + 1,
    posOf(doc, "链接 [示例]", 5),
    doc.indexOf("para\n1. ") + "para\n".length,
  ];

  for (let round = 0; round < 12; round += 1) {
    const pos = targets[round % targets.length];
    await setCaret(page, pos);
    expectStableGeometry(baseline, await readGeometry(page), { allow: [], label: `第 ${round + 1} 轮 active` });
    await setCaret(page, 0);
    const restored = await readGeometry(page);
    expectRestored(baseline, restored, `第 ${round + 1} 轮`);
    expect(await bodyState(page).then((s) => s.doc)).toBe(doc);
  }

  // 焦点：失焦再聚焦，几何同样不变（光标位置保持）；链接与裸 marker 都必须经过这一条。
  for (const target of targets) {
    await setCaret(page, target);
    const focused = await readGeometry(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(120);
    const blurred = await readGeometry(page);
    expectRestored(focused, blurred, `pos ${target} 失焦`);
    await setCaret(page, target);
    expectRestored(focused, await readGeometry(page), `pos ${target} 重新聚焦`);
  }

  expect(await bodyState(page).then((s) => s.doc)).toBe(doc);
  expect(await fileText(page, "cycle.md")).toBe(doc);
});

// ---------------------------------------------------------------------------
// C1（history 半条）：编辑之后的光标 / 选区 / 焦点循环 MUST NOT 新增 history 步
// ---------------------------------------------------------------------------
//
// 判据取「一次 undo 的落点」而不是去读 CM history 的内部结构：编辑一次 → 做若干轮光标、
// 选区、失焦 / 聚焦 → 按一次 ⌘Z，doc 与选区都必须回到**编辑前**那一态。任何一次导航若被
// 记进 history，这一按就只退得回导航、退不回编辑；再按一次还会吞掉更早的状态（本用例末尾
// 用「第二次 undo 文档不变」把这一点也钉住）。

test("编辑后光标 / 选区 / 焦点循环：一次 undo 回到编辑前（导航不新增 history 步）", async ({ page }) => {
  const doc = "- 列表项一\n- 列表项二\n";
  await openDoc(page, "history.md", doc);
  await setCaret(page, 5);
  await page.keyboard.type("X");
  await expect.poll(async () => bodyState(page)).toEqual({ doc: "- 列表项X一\n- 列表项二\n", anchor: 6, head: 6 });
  // 620ms 屏障：让这次编辑自成一拍（与 editing-oracle 的 history 对齐口径相同）。
  await page.waitForTimeout(620);

  for (let round = 0; round < 4; round += 1) {
    await setCaret(page, 10);
    await setCaret(page, 2, 6);
    await setCaret(page, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.waitForTimeout(80);
    await setCaret(page, 6);
  }
  expect((await bodyState(page)).doc).toBe("- 列表项X一\n- 列表项二\n");

  await page.keyboard.press("Meta+z");
  await expect
    .poll(async () => bodyState(page), { message: "一次 undo 没有回到编辑前的 doc 与选区" })
    .toEqual({ doc, anchor: 5, head: 5 });

  // history 里没有导航留下的假步：再按一次 undo，文档不动（否则是吞掉了更早的状态）。
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(620);
  expect((await bodyState(page)).doc).toBe(doc);
  expect(await fileText(page, "history.md")).toBe(doc);
  await expect(page.locator(".modeline-path")).not.toContainText("（未保存）");
});

// ---------------------------------------------------------------------------
// C2 / C4：主题维度（同一内容、同一主题内的稳定性）
// ---------------------------------------------------------------------------

for (const theme of ["light", "eink"] as const) {
  test(`主题 ${theme}：列表 / 表格 / 链接 / 裸 marker 在光标与焦点循环下不漂移`, async ({ page }) => {
    const doc = [
      "- 项目一", "- 项目二", "", "| a | b |", "| --- | --- |", "| c | d |", "",
      "链接 [示例](https://example.com)。", "", "para", "1. ", "", "尾段。",
    ].join("\n");
    await openDoc(page, "theme.md", doc, theme);
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    await expect(page.locator(".cm-lp-table").first()).toBeVisible();

    await setCaret(page, 0);
    const baseline = await readGeometry(page);
    const targets = [
      doc.indexOf("项目二") + 1,
      doc.indexOf("c | d") + 1,
      posOf(doc, "链接 [示例]", 5),
      doc.indexOf("para\n1. ") + "para\n".length,
    ];
    for (let round = 0; round < 4; round += 1) {
      const pos = targets[round];
      await setCaret(page, pos);
      const focused = await readGeometry(page);
      expectStableGeometry(baseline, focused, { allow: [], label: `${theme} · pos ${pos}` });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(120);
      expectRestored(focused, await readGeometry(page), `${theme} · pos ${pos} 失焦`);
      await setCaret(page, pos);
      expectRestored(focused, await readGeometry(page), `${theme} · pos ${pos} 聚焦`);
      await setCaret(page, 0);
      expectRestored(baseline, await readGeometry(page), `${theme} · pos ${pos} 复原`);
    }
    expect(await bodyState(page).then((s) => s.doc)).toBe(doc);
  });
}

// ---------------------------------------------------------------------------
// C5：编辑序列（显式期望串）
// ---------------------------------------------------------------------------

interface EditCase {
  name: string;
  doc: string;
  anchor: number;
  head?: number;
  keys?: string[];
  type?: string;
  expectedDoc: string;
  expectedCaret: number;
  /** `line` = 编辑只改本行内容（行数不变），顺带断言其余行几何不动；`none` = 结构性编辑
   *  （增删行），行号会移位，本表不叠几何判据——几何由上面的 active↔inactive 矩阵守。 */
  geometry: "line" | "none";
  /** 编辑后按一次 ⌘S，断言盘上全文 = 期望文档。 */
  save?: boolean;
  /** 操作顺序：默认先 `keys` 后 `type`；`type-then-keys` 用于「输入一次再 undo」。 */
  order?: "keys-then-type" | "type-then-keys";
}

async function runEditCase(page: Page, path: string, c: EditCase): Promise<void> {
  await openDoc(page, path, c.doc);
  await runEditCaseBody(page, path, c);
}

/** 已打开文档后的编辑序列本体（表格用例要先断言渲染态在场再进来）。 */
async function runEditCaseBody(page: Page, path: string, c: EditCase): Promise<void> {
  await setCaret(page, c.anchor, c.head ?? c.anchor);
  const lineIndex = c.doc.slice(0, c.anchor).split("\n").length - 1;
  const before = c.geometry === "line" ? await readGeometry(page) : null;
  const pressKeys = async (): Promise<void> => {
    for (const key of c.keys ?? []) {
      await page.keyboard.press(key);
      // 620ms 屏障：让每一拍成为独立的 CM history 事件（与 editing-oracle 同口径）。
      await page.waitForTimeout(620);
    }
  };
  const typeText = async (): Promise<void> => {
    if (c.type === undefined) return;
    await page.keyboard.type(c.type);
    await page.waitForTimeout(120);
  };
  if (c.order === "type-then-keys") {
    await typeText();
    await pressKeys();
  } else {
    await pressKeys();
    await typeText();
  }
  await expect
    .poll(async () => bodyState(page), { message: `${c.name}：编辑结果与期望不符` })
    .toEqual({ doc: c.expectedDoc, anchor: c.expectedCaret, head: c.expectedCaret });
  if (before !== null) {
    expectStableGeometry(
      before,
      await readGeometry(page),
      { allow: [lineIndex], label: `${c.name} · 行内编辑` },
    );
  }
  if (c.save) {
    await page.keyboard.press("Meta+s");
    await expect.poll(async () => fileText(page, path), { message: `${c.name}：⌘S 落盘与文档不一致` }).toBe(c.expectedDoc);
    await expect(page.locator(".modeline-path")).not.toContainText("（未保存）");
  }
}

// 连续 / 嵌套 / 任务 / 混合列表：Enter 的续行与退出、Backspace 的 marker 删除与凸级、
// Delete / ⌘⌫ 的跨行合并（M836 的「源码逐字节」合同在本表里对嵌套与任务形态复验）。
const LIST_CASES: EditCase[] = [
  { name: "连续 bullet：行末 Enter 续写同标记", doc: "- a\n- b\n", anchor: 3, keys: ["Enter"], expectedDoc: "- a\n- \n- b\n", expectedCaret: 6, geometry: "none" },
  { name: "空列表项 Enter 退出列表（删 marker、不新增行）", doc: "- a\n- \n", anchor: 6, keys: ["Enter"], expectedDoc: "- a\n\n", expectedCaret: 4, geometry: "none" },
  { name: "有序列表 Enter 续号", doc: "1. a\n2. b\n", anchor: 4, keys: ["Enter"], expectedDoc: "1. a\n2. \n3. b\n", expectedCaret: 8, geometry: "none" },
  { name: "两位数序号进位：10 → 11", doc: "9. a\n10. b\n", anchor: 4, keys: ["Enter"], expectedDoc: "9. a\n10. \n11. b\n", expectedCaret: 9, geometry: "none" },
  { name: "嵌套项 Enter 保持缩进层级", doc: "- a\n  - b\n", anchor: 9, keys: ["Enter"], expectedDoc: "- a\n  - b\n  - \n", expectedCaret: 14, geometry: "none" },
  { name: "任务项 Enter 续写未勾选任务 marker", doc: "- [ ] a\n- [x] b\n", anchor: 7, keys: ["Enter"], expectedDoc: "- [ ] a\n- [ ] \n- [x] b\n", expectedCaret: 14, geometry: "none" },
  { name: "任务空项 Enter 退出列表", doc: "- [ ] a\n- [ ] \n", anchor: 14, keys: ["Enter"], expectedDoc: "- [ ] a\n\n", expectedCaret: 8, geometry: "none" },
  { name: "内容起点 Backspace 删 marker", doc: "- item\n", anchor: 2, keys: ["Backspace"], expectedDoc: "item\n", expectedCaret: 0, geometry: "line" },
  { name: "嵌套内容起点 Backspace 凸出一级", doc: "- a\n  - b\n", anchor: 6, keys: ["Backspace"], expectedDoc: "- a\n- b\n", expectedCaret: 4, geometry: "line" },
  { name: "行尾 Delete 并入下一 bullet（源码逐字节、无 marker 字形）", doc: "- a\n- b\n", anchor: 3, keys: ["Delete"], expectedDoc: "- a- b\n", expectedCaret: 3, geometry: "none" },
  { name: "行尾 Delete 并入任务项（不写回 [ ]）", doc: "- a\n- [ ] b\n", anchor: 3, keys: ["Delete"], expectedDoc: "- a- [ ] b\n", expectedCaret: 3, geometry: "none" },
  { name: "行尾 Delete 并入嵌套项（不写回缩进）", doc: "- a\n  - b\n", anchor: 3, keys: ["Delete"], expectedDoc: "- a  - b\n", expectedCaret: 3, geometry: "none" },
  { name: "行首 ⌘⌫ 并入上一行（源码逐字节）", doc: "- a\n- b\n", anchor: 4, keys: ["Meta+Backspace"], expectedDoc: "- a- b\n", expectedCaret: 3, geometry: "none" },
  { name: "Enter 后一次 undo 精确复原", doc: "- a\n- b\n", anchor: 3, keys: ["Enter", "Meta+z"], expectedDoc: "- a\n- b\n", expectedCaret: 3, geometry: "none" },
  { name: "同一列表内选区删除", doc: "- a\n- b\n", anchor: 2, head: 6, keys: ["Backspace"], expectedDoc: "- b\n", expectedCaret: 2, geometry: "none" },
  { name: "行内选区删除不碰 marker", doc: "- aaa\n- bbb\n", anchor: 3, head: 5, keys: ["Backspace"], expectedDoc: "- a\n- bbb\n", expectedCaret: 3, geometry: "line" },
  { name: "编辑后 ⌘S：盘上全文 = 期望文档", doc: "- a\n- b\n", anchor: 3, keys: ["Enter"], type: "z", expectedDoc: "- a\n- z\n- b\n", expectedCaret: 7, geometry: "none", save: true },
];

for (const c of LIST_CASES) {
  test(`列表编辑对抗：${c.name}`, async ({ page }) => {
    await runEditCase(page, "list.md", c);
  });
}

// ---------------------------------------------------------------------------
// C5：表格编辑序列（表头与数据 cell、行内与跨 cell 选区、撤销、落盘）
// ---------------------------------------------------------------------------

const TABLE_DOC = "| a | b |\n| --- | --- |\n| c | d |\n";
// 行内偏移：行 1 = 0..8，行 2 = 10..22（分隔行整行被 replace 覆盖），行 3 = 24..32。
// 数据 cell `c` 的 slot = [25,28]（含首尾对齐空白），内容区 = [26,27]；`d` 的 slot = [29,32]。
//
// M855：数据 cell 的「内容首/尾缘键入 + 双向单字符删除」在 WebKit 原生路径上会跨过零宽
// 隐藏管道（Backspace 把删除 range 拉回上一行、Delete 跨进下一 cell、键入吃掉对齐空白），
// 现由 `src/editor.ts` 的 `nativeEditGate` 折叠 cell 分支按 EditorState 位置接管（与 M854
// 的非空选区分支同一闸门、命中面互斥）。本组是转正后的合同；表头 cell 是对照组（原生路径
// 本来就正确，闸门命中后结果必须逐字节相同）。选区删除 / 选区键入替换的用例在下方 C5
// 「选区删除 = 源码精确删除（M854）」一节，本组不重复。
const TABLE_CASES: EditCase[] = [
  { name: "数据 cell 内容尾缘键入：插入字符、后续源空白不动", doc: TABLE_DOC, anchor: 27, type: "Q", expectedDoc: "| a | b |\n| --- | --- |\n| cQ | d |\n", expectedCaret: 28, geometry: "line" },
  { name: "数据 cell 内容首缘键入：插入字符、前导空白不动", doc: TABLE_DOC, anchor: 26, type: "Q", expectedDoc: "| a | b |\n| --- | --- |\n| Qc | d |\n", expectedCaret: 27, geometry: "line" },
  { name: "表头 cell 内容尾缘键入（对照组）", doc: TABLE_DOC, anchor: 3, type: "Q", expectedDoc: "| aQ | b |\n| --- | --- |\n| c | d |\n", expectedCaret: 4, geometry: "line" },
  { name: "表头 cell 内容首缘键入（对照组）", doc: TABLE_DOC, anchor: 2, type: "Q", expectedDoc: "| Qa | b |\n| --- | --- |\n| c | d |\n", expectedCaret: 3, geometry: "line" },
  { name: "数据 cell 内容首缘 Backspace：只删前一个源字节（空白），不重写表格", doc: TABLE_DOC, anchor: 26, keys: ["Backspace"], expectedDoc: "| a | b |\n| --- | --- |\n|c | d |\n", expectedCaret: 25, geometry: "line" },
  { name: "数据 cell 内容尾缘 Delete：只删后一个源字节（空白），不删管道", doc: TABLE_DOC, anchor: 27, keys: ["Delete"], expectedDoc: "| a | b |\n| --- | --- |\n| c| d |\n", expectedCaret: 27, geometry: "line" },
  { name: "数据 cell 内容尾缘 Backspace：删内容末字", doc: TABLE_DOC, anchor: 27, keys: ["Backspace"], expectedDoc: "| a | b |\n| --- | --- |\n|  | d |\n", expectedCaret: 26, geometry: "line" },
  { name: "数据 cell 内容首缘 Delete：删内容首字", doc: TABLE_DOC, anchor: 26, keys: ["Delete"], expectedDoc: "| a | b |\n| --- | --- |\n|  | d |\n", expectedCaret: 26, geometry: "line" },
  { name: "表头 cell 内容尾缘 Delete（对照组）", doc: TABLE_DOC, anchor: 3, keys: ["Delete"], expectedDoc: "| a| b |\n| --- | --- |\n| c | d |\n", expectedCaret: 3, geometry: "line" },
  { name: "表头 cell 内容首缘 Backspace（对照组）", doc: TABLE_DOC, anchor: 2, keys: ["Backspace"], expectedDoc: "|a | b |\n| --- | --- |\n| c | d |\n", expectedCaret: 1, geometry: "line" },
  { name: "表头 cell 内容尾缘 Backspace（对照组）", doc: TABLE_DOC, anchor: 3, keys: ["Backspace"], expectedDoc: "|  | b |\n| --- | --- |\n| c | d |\n", expectedCaret: 2, geometry: "line" },
  { name: "第二数据行 cell 内输入（列方向）", doc: TABLE_DOC, anchor: 30, type: "Q", expectedDoc: "| a | b |\n| --- | --- |\n| c | Qd |\n", expectedCaret: 31, geometry: "line" },
  { name: "输入后一次 undo 精确复原", doc: TABLE_DOC, anchor: 27, type: "Q", keys: ["Meta+z"], order: "type-then-keys", expectedDoc: TABLE_DOC, expectedCaret: 27, geometry: "line" },
  { name: "首缘 Backspace 后一次 undo 精确复原", doc: TABLE_DOC, anchor: 26, keys: ["Backspace", "Meta+z"], expectedDoc: TABLE_DOC, expectedCaret: 26, geometry: "line" },
  { name: "尾缘 Delete 后一次 undo 精确复原", doc: TABLE_DOC, anchor: 27, keys: ["Delete", "Meta+z"], expectedDoc: TABLE_DOC, expectedCaret: 27, geometry: "line" },
  { name: "编辑后 ⌘S：盘上全文 = 期望文档", doc: TABLE_DOC, anchor: 27, type: "Q", expectedDoc: "| a | b |\n| --- | --- |\n| cQ | d |\n", expectedCaret: 28, geometry: "line", save: true },
];

for (const c of TABLE_CASES) {
  test(`表格编辑对抗：${c.name}`, async ({ page }) => {
    await openDoc(page, "table.md", c.doc);
    await expect(page.locator(".cm-lp-table").first()).toBeVisible();
    await runEditCaseBody(page, "table.md", c);
  });
}

// ---------------------------------------------------------------------------
// C5：行内构造的代表覆盖（heading / emphasis / code / math / wikilink / link）
// ---------------------------------------------------------------------------

const INLINE_CASES: EditCase[] = [
  { name: "标题行内输入：写进源码、# 不重复", doc: "# title\n\nbody\n", anchor: 6, type: "Q", expectedDoc: "# titlQe\n\nbody\n", expectedCaret: 7, geometry: "line" },
  { name: "标题行末 Enter：只插一个换行", doc: "# title\n\nbody\n", anchor: 7, keys: ["Enter"], expectedDoc: "# title\n\n\nbody\n", expectedCaret: 8, geometry: "none" },
  { name: "强调内容中间输入：写进 bold 内容、不重复 **", doc: "x **bold** y\n", anchor: 6, type: "Q", expectedDoc: "x **boQld** y\n", expectedCaret: 7, geometry: "line" },
  { name: "闭合定界符边界 Backspace：删内容末字、定界符不动", doc: "x **bold** y\n", anchor: 8, keys: ["Backspace"], expectedDoc: "x **bol** y\n", expectedCaret: 7, geometry: "line" },
  { name: "闭合定界符内 Backspace：只删一个定界符字节", doc: "x **bold** y\n", anchor: 10, keys: ["Backspace"], expectedDoc: "x **bold* y\n", expectedCaret: 9, geometry: "line" },
  { name: "行内代码内输入", doc: "x `code` y\n", anchor: 6, type: "Q", expectedDoc: "x `codQe` y\n", expectedCaret: 7, geometry: "line" },
  { name: "行内公式旁输入：不写回 KaTeX 字形", doc: "x $a^2$ y\n", anchor: 8, type: "Q", expectedDoc: "x $a^2$ Qy\n", expectedCaret: 9, geometry: "line" },
  { name: "标准链接目标内输入", doc: "x [lbl](https://e.com) y\n", anchor: 9, type: "Q", expectedDoc: "x [lbl](hQttps://e.com) y\n", expectedCaret: 10, geometry: "line" },
];

for (const c of INLINE_CASES) {
  test(`行内构造编辑：${c.name}`, async ({ page }) => {
    await runEditCase(page, "inline.md", c);
  });
}

test("wikilink：在渲染态链接尾部点击后输入，字符按顺序写入源码", async ({ page }) => {
  const doc = "x [[note]] y\n";
  await openDoc(page, "wiki.md", doc);
  const point = await page.evaluate(() => {
    const line = document.querySelector(".cm-line");
    if (!line) return null;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const at = node.textContent?.indexOf("note") ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at + 4);
      range.setEnd(node, at + 4);
      const rect = range.getBoundingClientRect();
      return { x: rect.right, y: rect.top + rect.height / 2 };
    }
    return null;
  });
  expect(point, "wikilink 的渲染文本没有可测端点").not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
  await page.waitForTimeout(150);
  await page.keyboard.type("QR");
  await expect.poll(async () => bodyState(page)).toEqual({ doc: "x [[note]]QR y\n", anchor: 12, head: 12 });
  expect(await fileText(page, "wiki.md")).toBe(doc);
});

// ---------------------------------------------------------------------------
// C5：选区删除 = 源码精确删除（M854）
//
// M842 登记的缺陷（20261119-worker-markdown-stability-bug-dom：选区端点落在渲染隐藏区时，
// 原生删除按 DOM 回写源码，表格结构被摧毁、列表 marker 被吞，⌘S 落盘损坏结果）在本节
// 转正为正常用例。修复落点是 `src/editor.ts` 的 beforeinput 闸门：非空选区删除一律
// preventDefault + 按 state 选区的源码字节 dispatch 一个显式事务（普通文本 / IME /
// readonly 语义不变）。
//
// 期望值一律写成**显式源码串**：合同是「只删掉 state 选区覆盖的源码字节」，不是「删掉
// 看起来选中的渲染文字」。选区用程序化 [anchor, head) 设置，保证两引擎范围一致（用户
// 鼠标拖选实测同一现场，见 finding）。反向选区（head < anchor）与正向同一期望。
// ---------------------------------------------------------------------------

interface SelectionDeleteCase {
  name: string;
  path: string;
  doc: string;
  anchor: number;
  head: number;
  /** 与 keys 二选一：直接键入一段文本替换选区（「选中后打字」，M855 finding 的入口）。 */
  insert?: string;
  keys: string[];
  expectedDoc: string;
  expectedCaret: number;
  /** 渲染态表格用例：先断言表格装饰在场再操作。 */
  table?: boolean;
  /** 删除后 ⌘S，断言盘上全文 = 期望文档。 */
  save?: boolean;
  /** 删除后 undo 回到原文，再 redo 重放删除。 */
  undoRedo?: boolean;
}

const SELECTION_TABLE_DOC = "| a | b |\n| --- | --- |\n| c | d |\n";
const SELECTION_MIXED_LIST_DOC = "- a\n- b\n\n1. c\n";

const SELECTION_DELETE_CASES: SelectionDeleteCase[] = [
  // 表格：跨行（表头 cell → 数据行末管道）、正向 Delete、反向选区、同行跨 cell、同 cell。
  { name: "表格跨行：表头 cell 到数据行末管道 Backspace", path: "sel-table.md", doc: SELECTION_TABLE_DOC, anchor: 2, head: 32, keys: ["Backspace"], expectedDoc: "| |\n", expectedCaret: 2, table: true },
  { name: "表格跨行：同一选区 Delete", path: "sel-table-del.md", doc: SELECTION_TABLE_DOC, anchor: 2, head: 32, keys: ["Delete"], expectedDoc: "| |\n", expectedCaret: 2, table: true },
  { name: "表格跨行：反向选区 [32,2) Backspace", path: "sel-table-rev.md", doc: SELECTION_TABLE_DOC, anchor: 32, head: 2, keys: ["Backspace"], expectedDoc: "| |\n", expectedCaret: 2, table: true },
  { name: "表格同一行跨 cell：管道符随源码删除", path: "sel-table-row.md", doc: SELECTION_TABLE_DOC, anchor: 26, head: 30, keys: ["Backspace"], expectedDoc: "| a | b |\n| --- | --- |\n| d |\n", expectedCaret: 26, table: true },
  { name: "表格同一 cell 内选区删除", path: "sel-table-cell.md", doc: SELECTION_TABLE_DOC, anchor: 26, head: 27, keys: ["Backspace"], expectedDoc: "| a | b |\n| --- | --- |\n|  | d |\n", expectedCaret: 26, table: true },
  // 混合列表：跨块、反向、终点落在有序项 marker 内部。
  { name: "混合列表：bullet 内容到有序项行首", path: "sel-list.md", doc: SELECTION_MIXED_LIST_DOC, anchor: 3, head: 9, keys: ["Backspace"], expectedDoc: "- a1. c\n", expectedCaret: 3 },
  { name: "混合列表：反向选区 [9,3) Backspace", path: "sel-list-rev.md", doc: SELECTION_MIXED_LIST_DOC, anchor: 9, head: 3, keys: ["Backspace"], expectedDoc: "- a1. c\n", expectedCaret: 3 },
  { name: "混合列表：终点落在有序项 marker 内部", path: "sel-list-marker.md", doc: SELECTION_MIXED_LIST_DOC, anchor: 2, head: 10, keys: ["Backspace"], expectedDoc: "- . c\n", expectedCaret: 2 },
  // 普通文本选区：闸门接管后字节结果仍与原生相同（语义保持）。
  { name: "普通文本选区：只删选中源码", path: "sel-plain.md", doc: "aa bb cc\n", anchor: 3, head: 6, keys: ["Backspace"], expectedDoc: "aa cc\n", expectedCaret: 3 },
  // 非空选区上的普通键入替换（M855 finding）：WebKit 原生路径会吞掉选区前的对齐空白。
  { name: "表格同一 cell 键入替换", path: "sel-ins-cell.md", doc: SELECTION_TABLE_DOC, anchor: 26, head: 27, insert: "Q", keys: [], expectedDoc: "| a | b |\n| --- | --- |\n| Q | d |\n", expectedCaret: 27, table: true },
  { name: "表格跨 cell 键入替换（M855 形状）", path: "sel-ins-cross.md", doc: SELECTION_TABLE_DOC, anchor: 26, head: 30, insert: "Q", keys: [], expectedDoc: "| a | b |\n| --- | --- |\n| Qd |\n", expectedCaret: 27, table: true },
  { name: "表格跨 cell 反向选区键入替换", path: "sel-ins-rev.md", doc: SELECTION_TABLE_DOC, anchor: 30, head: 26, insert: "Q", keys: [], expectedDoc: "| a | b |\n| --- | --- |\n| Qd |\n", expectedCaret: 27, table: true },
  { name: "表格跨行键入替换", path: "sel-ins-row.md", doc: SELECTION_TABLE_DOC, anchor: 2, head: 32, insert: "Q", keys: [], expectedDoc: "| Q|\n", expectedCaret: 3, table: true },
  { name: "混合列表键入替换", path: "sel-ins-list.md", doc: SELECTION_MIXED_LIST_DOC, anchor: 3, head: 9, insert: "Q", keys: [], expectedDoc: "- aQ1. c\n", expectedCaret: 4 },
  { name: "普通文本选区键入替换", path: "sel-ins-plain.md", doc: "aa bb cc\n", anchor: 3, head: 6, insert: "Q", keys: [], expectedDoc: "aa Qcc\n", expectedCaret: 4 },
  { name: "表格跨 cell 键入替换后 undo / redo", path: "sel-ins-undo.md", doc: SELECTION_TABLE_DOC, anchor: 26, head: 30, insert: "Q", keys: [], expectedDoc: "| a | b |\n| --- | --- |\n| Qd |\n", expectedCaret: 27, table: true, undoRedo: true },
  { name: "表格跨 cell 键入替换后 ⌘S：盘上全文 = 期望文档", path: "sel-ins-save.md", doc: SELECTION_TABLE_DOC, anchor: 26, head: 30, insert: "Q", keys: [], expectedDoc: "| a | b |\n| --- | --- |\n| Qd |\n", expectedCaret: 27, table: true, save: true },
  // undo / redo 与精确落盘。
  { name: "表格跨行删除后 undo 复原、redo 重放", path: "sel-table-undo.md", doc: SELECTION_TABLE_DOC, anchor: 2, head: 32, keys: ["Backspace"], expectedDoc: "| |\n", expectedCaret: 2, table: true, undoRedo: true },
  { name: "表格跨行删除后 ⌘S：盘上全文 = 期望文档", path: "sel-table-save.md", doc: SELECTION_TABLE_DOC, anchor: 2, head: 32, keys: ["Backspace"], expectedDoc: "| |\n", expectedCaret: 2, table: true, save: true },
];

for (const c of SELECTION_DELETE_CASES) {
  test(`选区删除：${c.name}`, async ({ page }) => {
    await openDoc(page, c.path, c.doc);
    if (c.table === true) await expect(page.locator(".cm-lp-table").first()).toBeVisible();
    await setCaret(page, c.anchor, c.head);
    // 前置（M854 探针口径）：CM state 里的选区与目标源码 range 逐值一致，文档未被触碰。
    // 失败在这里意味着「选区本身错了」，与 DOM 回写是两个不同的缺陷。
    expect(await bodyState(page)).toEqual({ doc: c.doc, anchor: c.anchor, head: c.head });
    if (c.insert !== undefined) {
      await page.keyboard.type(c.insert);
      await page.waitForTimeout(120);
    } else {
      for (const key of c.keys) {
        await page.keyboard.press(key);
        // 620ms 屏障：让每一拍成为独立的 CM history 事件（与上面的编辑用例同口径）。
        await page.waitForTimeout(620);
      }
    }
    await expect
      .poll(async () => bodyState(page), { message: `${c.name}：选区删除结果与期望不符` })
      .toEqual({ doc: c.expectedDoc, anchor: c.expectedCaret, head: c.expectedCaret });
    // 未按 ⌘S 前不得落盘：删除只改编辑器 state，盘上仍是原文。
    expect(await fileText(page, c.path)).toBe(c.doc);
    if (c.undoRedo === true) {
      await page.keyboard.press("Meta+z");
      await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}：undo 未回到原文` }).toBe(c.doc);
      await page.keyboard.press("Meta+Shift+z");
      await expect.poll(async () => (await bodyState(page)).doc, { message: `${c.name}：redo 未重放删除` }).toBe(c.expectedDoc);
    }
    if (c.save === true) {
      await page.keyboard.press("Meta+s");
      await expect.poll(async () => fileText(page, c.path), { message: `${c.name}：⌘S 落盘与文档不一致` }).toBe(c.expectedDoc);
      await expect(page.locator(".modeline-path")).not.toContainText("（未保存）");
    }
  });
}

// ---------------------------------------------------------------------------
// IME 组合期（review r1 P1-1）：`compositionstart` 之后、首个组合改动之前，CM 的
// `view.composing`（`inputState.composing > 0`）仍为 false；选区闸门必须用
// `view.compositionStarted`（`composing >= 0`）让行，不能把这段窗口里的 `insertText` /
// `deleteContent*` 当成普通编辑 preventDefault 并 dispatch 事务——Safari 的组合提交可能以
// `insertText` 到达，抢走事件会绕过 CM 的组合处理。组合结束后普通编辑仍精确、可撤销。
// ---------------------------------------------------------------------------
test("IME 组合期：compositionstart 后的 insertText / 删除不被选区闸门消费；结束后编辑精确且可撤销", async ({ page }) => {
  const doc = "| a | b |\n| --- | --- |\n| c | d |\n";
  await openDoc(page, "ime-gate.md", doc);
  await expect(page.locator(".cm-lp-table").first()).toBeVisible();
  await setCaret(page, 26, 30);
  const events = await page.locator(".cm-content").evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const fire = (inputType: string, data: string | null): boolean =>
      el.dispatchEvent(new InputEvent("beforeinput", { inputType, data, isComposing: false, bubbles: true, cancelable: true }));
    return { insertConsumed: !fire("insertText", "Q"), deleteConsumed: !fire("deleteContentBackward", null) };
  });
  expect(events, "组合期事件被选区闸门 preventDefault（应让给 CM）").toEqual({ insertConsumed: false, deleteConsumed: false });
  expect(await bodyState(page), "组合期事件未 dispatch 事务，文档与选区原样").toEqual({ doc, anchor: 26, head: 30 });
  await page.locator(".cm-content").evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  // Safari 的 post-composition 100ms 键盘窗口（CM 的 compositionPendingKey）过去后再键入。
  await page.waitForTimeout(200);
  await page.keyboard.type("Q");
  await expect.poll(async () => bodyState(page)).toEqual({ doc: "| a | b |\n| --- | --- |\n| Qd |\n", anchor: 27, head: 27 });
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => bodyState(page), { message: "一次 undo 未恢复组合前文档与选区" }).toEqual({ doc, anchor: 26, head: 30 });
  await page.keyboard.press("Meta+Shift+z");
  // redo 后 CM 的 history 会把选区映射成 [26,27)（anchor 落在插入点），合同只要求文档
  // 逐字节复原且光标在插入文本之后——不把 CM 的选区映射细节写成期望。
  await expect
    .poll(async () => {
      const s = await bodyState(page);
      return { doc: s.doc, head: s.head };
    }, { message: "redo 未重放编辑" })
    .toEqual({ doc: "| a | b |\n| --- | --- |\n| Qd |\n", head: 27 });
});
