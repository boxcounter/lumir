import { expect, test, type Page } from "@playwright/test";
import { Text } from "@codemirror/state";
import { detectFrontmatter } from "../../../src/preview/frontmatter";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// m647：编辑器光标的几何与样式（change cursor-visibility-oct23，合同 docs/specs/editor-caret.md）。
//
// 缺陷（Alex 2026-10-23）：点击 frontmatter 时光标是一条贯穿整个 properties + doc-title 的
// 竖线，高度远超行高。根因是光标位置落在**块级 replace 装饰的边界**上时，CM6 用整个 widget 的
// `getBoundingClientRect()` 当光标矩形（`RectangleMarker.forRange` 取 `coordsAtPos` 的
// top/bottom，block widget 的 `coordsInWidget` 原样返回整块 rect）。所以本文件判的不是
// "CSS 宽度"，而是 C1 的不变量：**光标矩形的高度 = 它所在可见文本行的行盒高度**。
//
// 读数分两路，互不借用（REVIEW.md「断言等价于子串」条）：
//   · 「实际画出来的光标」= `.cm-cursor-primary` 的 getBoundingClientRect()；
//   · 「所在可见行盒」= 该位置落到的那条 `.cm-line` 里**文本 Range** 的 rect——Range 覆盖的是
//     inline 盒（line-height），不是 line 元素的盒子（后者含段落末行 padding，M218）。
// 两者相差 > 1px 即判 FAIL；任一路读不到（没有光标元素 / 位置没有可见行承载）同样判 FAIL，
// 不判 skip（REVIEW.md「读不到当成空」条）。
//
// 区分度对照（让断言在修前必红）：
//   ① 光标高度 MUST 小于被撤下的 `.cm-lp-frontmatter-outer` 高度（修前 = 整块高）；
//   ② H1 行光标高度 MUST 大于正文行光标高度（证明「等于行盒」不是把光标钉到常量高度）。
//
// 光标样式同在本场景（D2 于 2026-10-24 改裁：恢复闪烁）：2px 实心 `--text`、`marginLeft: -1px`、
// `.cm-cursorLayer` 以 1.2s 周期闪烁（CM 原生 `cm-blink`，亮 / 灭两个相位都实际读过）、
// 未聚焦时不显示。像素基线不在此处——新场景只建结构断言，截图过目归 Alex。

const FM_DOC = [
  "---",
  "title: 示例标题",
  "tags: [示例, 合成]",
  "status: 已确认",
  "---",
  "正文首行（frontmatter 之后第一行）。",
  "",
  "# 一级标题",
  "",
  "正文段落，供行盒对照用。",
  "",
].join("\n");

const FM_ONLY = ["---", "title: 示例标题", "tags: [示例]", "---"].join("\n");
const FM_ONLY_TRAILING = `${FM_ONLY}\n`;
const BAD_YAML = ["---", "title: [未闭合", "---", "正文首行。", ""].join("\n");
const NO_FM = ["# 对照文档", "", "没有 frontmatter 的正文。", ""].join("\n");

/** 512 行上限的 frontmatter（超过它就不再是 properties 区块——只用上限内的一档）。 */
function longFrontmatter(lines: number): string {
  const inner = Array.from({ length: lines }, (_, i) => `field_${i + 1}: 值_${i + 1}`);
  return ["---", ...inner, "---", "正文首行。", ""].join("\n");
}

interface CaretBox {
  top: number;
  left: number;
  height: number;
  width: number;
}

interface CaretReading {
  head: number;
  from: number;
  to: number;
  caret: CaretBox | null;
  lineBox: CaretBox | null;
  lineText: string | null;
}

interface ViewHandle {
  state: {
    selection: { main: { head: number; from: number; to: number } };
    doc: {
      length: number;
      lineAt(pos: number): { from: number; to: number; number: number };
      line(number: number): { from: number; to: number; number: number };
    };
  };
  domAtPos(pos: number): { node: Node; offset: number };
  dispatch(spec: unknown): void;
  focus(): void;
}

/** 页面内取 CM 的 view（与 m285 等场景同一取法：`cmTile.root.view`），经 init script 暴露。 */

async function readCaret(page: Page): Promise<CaretReading> {
  return page.evaluate(() => {
    const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
    const sel = view.state.selection.main;
    const cursorEl = document.querySelector<HTMLElement>(".cm-cursor-primary");
    const caret = cursorEl ? cursorEl.getBoundingClientRect() : null;
    const at = view.domAtPos(sel.head);
    let node: Node | null = at.node;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const lineEl = node instanceof Element ? node.closest(".cm-line") : null;
    let lineBox: CaretBox | null = null;
    let lineText: string | null = null;
    if (lineEl) {
      lineText = lineEl.textContent;
      const range = document.createRange();
      range.selectNodeContents(lineEl);
      const rect = Array.from(range.getClientRects()).find((r) => r.height > 0) ?? null;
      if (rect) lineBox = { top: rect.top, left: rect.left, height: rect.height, width: rect.width };
    }
    return {
      head: sel.head,
      from: sel.from,
      to: sel.to,
      caret: caret ? { top: caret.top, left: caret.left, height: caret.height, width: caret.width } : null,
      lineBox,
      lineText,
    };
  });
}

/** 光标必须画在一条可见行上，且高度等于该行行盒（±1px）。读不到任一路一律 FAIL。 */
function expectCaretOnLineBox(reading: CaretReading, label: string): void {
  expect(reading.caret, `${label}：没有画出来的光标矩形（读不到 ≠ 通过）`).not.toBeNull();
  expect(reading.lineBox, `${label}：光标位置没有可见文本行承载（读不到 ≠ 通过）`).not.toBeNull();
  expect(
    Math.abs(reading.caret!.height - reading.lineBox!.height),
    `${label}：光标高度 ${reading.caret!.height} MUST 等于所在行行盒 ${reading.lineBox!.height}（C1，±1px）`,
  ).toBeLessThanOrEqual(1);
}

async function frontmatterOuterHeight(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const outer = document.querySelector<HTMLElement>(".cm-lp-frontmatter-outer");
    return outer ? outer.getBoundingClientRect().height : null;
  });
}

interface OpenOptions {
  doc: string;
  name?: string;
  theme?: "light" | "dark" | "eink";
  fontSize?: number;
  /** 上屏就绪的文本标记（默认 properties 的标题行；回退块 / 无 fm 对照各给自己的）。 */
  ready?: string;
}

/** 打开文档并等 properties 区块（或对照文档的正文）上屏；主题 / 字号走真实配置通道。 */
async function openDoc(page: Page, options: OpenOptions): Promise<void> {
  const name = options.name ?? "caret.md";
  await stubTauri(page, {
    root: "/mock/vault",
    vault_id: "v1",
    files: { [name]: options.doc },
    entries: [{ path: name, name, kind: "file", size: options.doc.length, mtime_ms: 0 }],
    config: {
      theme: options.theme ?? "light",
      ...(options.fontSize !== undefined ? { font_size: options.fontSize } : {}),
    },
  });
  await page.addInitScript(() => {
    (window as unknown as { __m647View: () => ViewHandle }).__m647View = () => {
      const content = document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: ViewHandle } };
      };
      return content.cmTile.root.view;
    };
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(options.ready ?? "示例");
  await page.waitForTimeout(60);
}

/** 文档的 frontmatter 范围（Node 侧用同一份检测实现，fixture 与断言不各算一套）。 */
function fmRange(doc: string): { from: number; to: number } {
  const fm = detectFrontmatter(Text.of(doc.split("\n")));
  expect(fm, "fixture 必须带 frontmatter（检测不到 = 场景装置坏了）").not.toBeNull();
  return { from: fm!.from, to: fm!.to };
}

function bodyStart(doc: string): number {
  const fm = fmRange(doc);
  if (fm.to >= doc.length) throw new Error("fixture 没有正文行（该用例请直接断言块内落点）");
  return doc.indexOf("\n", fm.to) + 1;
}

/** 把选区挪回文档末尾（渲染态恢复：widget 重新上屏）。 */
async function resetToRendered(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await expect(page.locator(".cm-lp-frontmatter")).toBeVisible();
  await page.waitForTimeout(50);
}

/** 在 properties 盒的指定纵向比例处按下（真实 mousedown 走 widget 自己的路由）。
 *  纵向落点钳在视口内（512 行档的盒子远高于视口，按比例会点到视口外）。 */
async function clickPropertiesAt(page: Page, fraction: number): Promise<void> {
  const box = await page.locator(".cm-lp-frontmatter").boundingBox();
  expect(box, "properties 盒必须在场（否则点击路径没有输入）").not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport, "视口尺寸必须可得").not.toBeNull();
  const x = box!.x + Math.min(box!.width - 12, 24);
  const y = Math.min(box!.y + box!.height * fraction, viewport!.height - 40);
  expect(y, "点击纵坐标必须落在盒子内（否则点的是别的东西）").toBeGreaterThan(box!.y);
  await page.mouse.click(x, y);
  await page.waitForTimeout(80);
}

test.describe("m647 光标几何（C1）与指针入口（C2）", () => {
  test("装载：有正文 → 初始光标在正文首行（不在块边界），聚焦后高度 = 行盒、小于块高", async ({ page }) => {
    await openDoc(page, { doc: FM_DOC });
    const outer = await frontmatterOuterHeight(page);
    expect(outer, "装载后 properties 区块必须在场").not.toBeNull();
    const head = await page.evaluate(() => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      return view.state.selection.main.head;
    });
    expect(head, "装载后的初始光标 = 正文首行行首（C3）").toBe(bodyStart(FM_DOC));
    // 光标矩形只在聚焦时绘制（CM 的 `.cm-cursor` 在前者之外 display:none，rect 为 0）——
    // 先聚焦再量，避免把「没画」当成「高度为 0」。
    await page.evaluate(() => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.focus();
    });
    await page.waitForTimeout(100);
    const reading = await readCaret(page);
    expect(reading.head, "聚焦不改初始落点（正文首行本来就在可见行上）").toBe(bodyStart(FM_DOC));
    expectCaretOnLineBox(reading, "装载初始光标");
    expect(reading.caret!.height, "区分度：光标高度 MUST 小于整块 widget 高度（修前这里相等）").toBeLessThan(
      outer!,
    );
    expect(await readDocument(page), "装载不改文档（C5）").toBe(FM_DOC);
  });

  test("点击 properties 上 / 中 / 下三分之一：显露 YAML、光标落在块内可见行、高度 = 行盒、文档不变", async ({
    page,
  }) => {
    await openDoc(page, { doc: FM_DOC });
    const fm = fmRange(FM_DOC);
    for (const fraction of [0.2, 0.5, 0.8]) {
      await resetToRendered(page);
      const outer = await frontmatterOuterHeight(page);
      expect(outer, `${fraction}：点击前 properties 区块必须在场`).not.toBeNull();
      await clickPropertiesAt(page, fraction);
      await expect(page.locator(".cm-lp-frontmatter"), `${fraction}：点击后 properties 盒必须撤下（显露源码）`).toHaveCount(0);
      const reading = await readCaret(page);
      expect(reading.head, `${fraction}：光标 MUST 落在块内（[${fm.from},${fm.to})）`).toBeGreaterThanOrEqual(fm.from);
      expect(reading.head, `${fraction}：光标 MUST 落在块内（[${fm.from},${fm.to})）`).toBeLessThan(fm.to);
      expectCaretOnLineBox(reading, `点击 properties ${fraction}`);
      expect(
        reading.caret!.height,
        `${fraction}：区分度——光标高度 MUST 小于整块 widget 高度（修前 = 块高）`,
      ).toBeLessThan(outer!);
      expect(await readDocument(page), `${fraction}：指针入口不改文档（C2/C5）`).toBe(FM_DOC);
    }
  });

  test("非法 YAML 回退块：点击同样显露源码（与 properties 盒同一入口）", async ({ page }) => {
    await openDoc(page, { doc: BAD_YAML, ready: "未闭合" });
    const fm = fmRange(BAD_YAML);
    await expect(page.locator(".cm-lp-fm-error"), "回退块必须上屏（否则点的是别的东西）").toBeVisible();
    await clickPropertiesAt(page, 0.5);
    await expect(page.locator(".cm-lp-frontmatter")).toHaveCount(0);
    const reading = await readCaret(page);
    expect(reading.head).toBeGreaterThanOrEqual(fm.from);
    expect(reading.head).toBeLessThan(fm.to);
    expectCaretOnLineBox(reading, "回退块点击");
    expect(await readDocument(page)).toBe(BAD_YAML);
  });

  test("512 行 frontmatter（上限档）：点击显露、光标落在 YAML 行盒上、文档不变", async ({ page }) => {
    const doc = longFrontmatter(510);
    await openDoc(page, { doc, ready: "field_1" });
    const fm = fmRange(doc);
    const outer = await frontmatterOuterHeight(page);
    expect(outer, "510 行 frontmatter 仍渲染 properties 区块").not.toBeNull();
    await clickPropertiesAt(page, 0.5);
    await expect(page.locator(".cm-lp-frontmatter")).toHaveCount(0);
    const reading = await readCaret(page);
    expect(reading.head).toBeGreaterThanOrEqual(fm.from);
    expect(reading.head).toBeLessThan(fm.to);
    expectCaretOnLineBox(reading, "512 行档点击");
    expect(reading.caret!.height).toBeLessThan(outer!);
    expect(await readDocument(page)).toBe(doc);
  });

  test("点击 doc-title / outer 底部 padding（合成面）：不显露 YAML、不把光标放进 YAML，高度 = 行盒", async ({ page }) => {
    await openDoc(page, { doc: FM_DOC });
    const paragraph = FM_DOC.indexOf("正文段落");
    // 合成面只在「光标停在块边界」时改变落点（规范化）；把光标先放到正文段落的可见行上——
    // 点击不得把它挪走、更不得挪进 YAML。
    await page.evaluate((pos) => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.focus();
      view.dispatch({ selection: { anchor: pos } });
    }, paragraph);
    await page.waitForTimeout(60);
    await page.locator(".cm-lp-doc-title").click();
    await page.waitForTimeout(80);
    await expect(page.locator(".cm-lp-frontmatter"), "合成面不显露 YAML——widget 必须仍在").toBeVisible();
    const afterTitle = await readCaret(page);
    expect(afterTitle.head, "点标题 → 光标留在原可见行（不进入 YAML）").toBe(paragraph);
    expectCaretOnLineBox(afterTitle, "点击 doc-title");

    const outerBox = await page.locator(".cm-lp-frontmatter-outer").boundingBox();
    expect(outerBox, "outer 必须在场").not.toBeNull();
    await page.mouse.click(outerBox!.x + 6, outerBox!.y + outerBox!.height - 4);
    await page.waitForTimeout(80);
    await expect(page.locator(".cm-lp-frontmatter"), "点 padding 同样不显露 YAML").toBeVisible();
    const afterPadding = await readCaret(page);
    expect(afterPadding.head, "点 padding → 光标留在原可见行（不进入 YAML）").toBe(paragraph);
    expectCaretOnLineBox(afterPadding, "点击 outer padding");
    expect(await readDocument(page)).toBe(FM_DOC);
  });

  test("只有 frontmatter（无正文行）：未聚焦时停在块边界、widget 在场；聚焦后显露源码、光标落块内可见行", async ({
    page,
  }) => {
    await openDoc(page, { doc: FM_ONLY });
    const fm = fmRange(FM_ONLY);
    const headBefore = await page.evaluate(() => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      return view.state.selection.main.head;
    });
    expect(headBefore, "装载时没有正文行 → 选区停在块起点（不自动变源码）").toBe(fm.from);
    await expect(page.locator(".cm-lp-frontmatter"), "未聚焦时 properties 盒正常渲染").toBeVisible();
    await page.evaluate(() => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.focus();
    });
    await page.waitForTimeout(120);
    await expect(page.locator(".cm-lp-frontmatter"), "聚焦后边界光标 MUST 被规范化：显露源码").toHaveCount(0);
    const reading = await readCaret(page);
    expect(reading.head).toBeGreaterThanOrEqual(fm.from);
    expect(reading.head).toBeLessThan(fm.to);
    expectCaretOnLineBox(reading, "只有 fm 的聚焦规范化");
    expect(await readDocument(page)).toBe(FM_ONLY);
  });

  test("键盘：正文首行 ↑ / ⌃P 跨块 → 落点在块内（显露）、高度 = 行盒、文档不变", async ({ page }) => {
    await openDoc(page, { doc: FM_DOC });
    const fm = fmRange(FM_DOC);
    const start = bodyStart(FM_DOC);
    for (const key of ["ArrowUp", "Control+p"]) {
      await page.evaluate((pos) => {
        const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
        view.focus();
        view.dispatch({ selection: { anchor: pos } });
      }, start);
      await expect(page.locator(".cm-lp-frontmatter"), `${key}：起点必须是渲染态`).toBeVisible();
      await page.keyboard.press(key);
      await page.waitForTimeout(100);
      await expect(page.locator(".cm-lp-frontmatter"), `${key}：跨块后 MUST 显露源码（C4）`).toHaveCount(0);
      const reading = await readCaret(page);
      expect(reading.head, `${key}：落点 MUST 在块内（不是块边界）`).toBeGreaterThan(fm.from);
      expect(reading.head, `${key}：落点 MUST 在块内（不是块边界）`).toBeLessThan(fm.to);
      expectCaretOnLineBox(reading, `${key} 跨块移动`);
      expect(await readDocument(page)).toBe(FM_DOC);
    }
  });

  test("事务边界：程序化选区（goto-line 同形）落块边界 → 正文首行；垂直移动事务 → 块内", async ({ page }) => {
    await openDoc(page, { doc: FM_DOC });
    const fm = fmRange(FM_DOC);
    const body = bodyStart(FM_DOC);
    const readings = await page.evaluate(
      ([from, to, bodyPos]) => {
        const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
        const out: number[] = [];
        view.dispatch({ selection: { anchor: from } });
        out.push(view.state.selection.main.head);
        view.dispatch({ selection: { anchor: to } });
        out.push(view.state.selection.main.head);
        view.dispatch({ selection: { anchor: to }, userEvent: "move.line.down" });
        out.push(view.state.selection.main.head);
        view.dispatch({ selection: { anchor: bodyPos } });
        out.push(view.state.selection.main.head);
        return out;
      },
      [fm.from, fm.to, body] as const,
    );
    expect(readings[0], "程序化落 fm.from → 正文首行（C3）").toBe(body);
    expect(readings[1], "程序化落 fm.to → 正文首行（C3）").toBe(body);
    expect(readings[2], "垂直移动事务落 fm.to → 块内一个字符（C4）").toBe(fm.to - 1);
    expect(readings[3], "正文首行是合法落点，不被改写").toBe(body);
  });

  test("选区触及块的一部分 → widget 撤下；折叠回正文 → widget 恢复", async ({ page }) => {
    await openDoc(page, { doc: FM_DOC });
    const fm = fmRange(FM_DOC);
    await page.evaluate((from) => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.dispatch({ selection: { anchor: from, head: from + 3 } });
    }, fm.from);
    await page.waitForTimeout(80);
    await expect(page.locator(".cm-lp-frontmatter"), "选区触及块 → 显露源码").toHaveCount(0);
    await resetToRendered(page);
    await expect(page.locator(".cm-lp-frontmatter"), "选区离开块 → 恢复 properties 渲染").toBeVisible();
    expect(await readDocument(page), "选区与显露不改文档（C5）").toBe(FM_DOC);
  });

  test("区分度：H1 行光标高度 > 正文行光标高度，各自等于本行行盒（不是常量高度）", async ({ page }) => {
    await openDoc(page, { doc: FM_DOC });
    const h1 = FM_DOC.indexOf("# 一级标题");
    const paragraph = FM_DOC.indexOf("正文段落");
    await page.evaluate((pos) => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.focus();
      view.dispatch({ selection: { anchor: pos } });
    }, paragraph);
    await page.waitForTimeout(80);
    const bodyReading = await readCaret(page);
    expectCaretOnLineBox(bodyReading, "正文行光标");
    await page.evaluate((pos) => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.dispatch({ selection: { anchor: pos } });
    }, h1);
    await page.waitForTimeout(80);
    const h1Reading = await readCaret(page);
    expectCaretOnLineBox(h1Reading, "H1 行光标");
    expect(
      h1Reading.caret!.height,
      "区分度：H1 行光标 MUST 高于正文行光标（否则断言在常量高度上空转）",
    ).toBeGreaterThan(bodyReading.caret!.height + 1);
  });

  test("eink × 32px：点击 properties 后光标高度仍等于（放大后的）行盒", async ({ page }) => {
    await openDoc(page, { doc: FM_DOC, theme: "eink", fontSize: 32 });
    const fm = fmRange(FM_DOC);
    await clickPropertiesAt(page, 0.5);
    await expect(page.locator(".cm-lp-frontmatter")).toHaveCount(0);
    const reading = await readCaret(page);
    expect(reading.head).toBeGreaterThanOrEqual(fm.from);
    expect(reading.head).toBeLessThan(fm.to);
    expectCaretOnLineBox(reading, "eink × 32px");
    expect(reading.caret!.height, "32px 字号下光标高度必须随行盒放大（不是 15px 常量）").toBeGreaterThan(30);
  });

  test("对照：无 frontmatter 的文档光标高度 = 所在行盒（证明本场景的读数不依赖 fm 路径）", async ({
    page,
  }) => {
    await openDoc(page, { doc: NO_FM, ready: "对照文档" });
    await page.evaluate(() => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.focus();
      view.dispatch({ selection: { anchor: 3 } });
    });
    await page.waitForTimeout(80);
    expectCaretOnLineBox(await readCaret(page), "无 fm 对照");
  });
});

test.describe("m647 光标样式（D2 改裁：2026-10-24 恢复闪烁）", () => {  for (const theme of ["light", "dark", "eink"] as const) {
    test(`光标计算样式 × ${theme}：2px 实心 --text、-1px 居中、1.2s 闪烁；未聚焦时不显示`, async ({ page }) => {
      await openDoc(page, { doc: FM_DOC, theme });
      await page.evaluate(() => {
        const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
        view.focus();
      });
      await page.waitForTimeout(120);
      const style = await page.evaluate(() => {
        const cursor = document.querySelector<HTMLElement>(".cm-cursor-primary");
        const layer = document.querySelector<HTMLElement>(".cm-cursorLayer");
        if (!cursor || !layer) throw new Error("光标或光标层不在场（drawSelection 未装配？）");
        const probe = document.createElement("span");
        probe.style.color = "var(--text)";
        document.body.append(probe);
        const expectedColor = getComputedStyle(probe).color;
        probe.remove();
        const cs = getComputedStyle(cursor);
        const layerStyle = getComputedStyle(layer);
        return {
          width: cs.borderLeftWidth,
          color: cs.borderLeftColor,
          expectedColor,
          marginLeft: cs.marginLeft,
          animationName: layerStyle.animationName,
          animationDuration: layerStyle.animationDuration,
          animationIterationCount: layerStyle.animationIterationCount,
          running: layer.getAnimations().map((animation) => ({
            playState: animation.playState,
            duration: (animation.effect as KeyframeEffect | null)?.getTiming().duration ?? null,
          })),
          display: cs.display,
        };
      });
      expect(style.width, "宽度 = 2px（组件常量；改裁未动宽度）").toBe("2px");
      expect(style.color, "颜色 = --text 的计算值").toBe(style.expectedColor);
      expect(style.marginLeft, "按 2px 宽度居中（CM 基础主题的 -0.6px 是 1.2px 的居中量）").toBe("-1px");
      // 闪烁恢复（Alex 2026-10-24 反馈「光标不闪了，也不容易一眼扫到」）：动画名由 CM 的基础主题
      // 或它写入的内联样式给出（`cm-blink` / `cm-blink2` 交替用于重启相位），两者都是「闪烁中」。
      // M654 的 `animation: none !important` 会让这里读回 none —— 这条断言就是那次改裁的判据。
      expect(["cm-blink", "cm-blink2"], "闪烁恢复：光标层挂着 CM 原生 cm-blink 动画").toContain(style.animationName);
      expect(style.animationDuration, "周期 1.2s（CM 的 cursorBlinkRate facet 默认值）").toBe("1.2s");
      expect(style.animationIterationCount, "无限循环").toBe("infinite");
      expect(style.running, "动画在跑，且时长 1200ms").toEqual([{ playState: "running", duration: 1200 }]);
      expect(style.display, "聚焦时可见").not.toBe("none");

      // 真实相位：把动画暂停在 0ms / 700ms，读光标层的 opacity——「亮 → 灭」必须真实发生
      // （只看 animationName 证明不了动画在动；只读某一次计算值又会被相位抖动骗过）。
      const blink = await page.evaluate(async () => {
        const layer = document.querySelector<HTMLElement>(".cm-cursorLayer");
        if (!layer) throw new Error("光标层不在场");
        const [animation] = layer.getAnimations();
        if (!animation) return null;
        animation.pause();
        const opacityAt = async (ms: number): Promise<string> => {
          animation.currentTime = ms;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          return getComputedStyle(layer).opacity;
        };
        const onPhase = await opacityAt(0);
        const offPhase = await opacityAt(700);
        animation.currentTime = 0;
        animation.play();
        return { onPhase, offPhase };
      });
      expect(blink, "光标层必须有可暂停的闪烁动画").not.toBeNull();
      expect(blink!.onPhase, "相位 0ms：光标可见").toBe("1");
      expect(blink!.offPhase, "相位 700ms（周期中点之后）：光标不可见——闪烁不是装饰，是真的明暗交替").toBe("0");

      // 未聚焦：光标不显示（与基础主题的 `&.cm-focused ... .cm-cursor { display: block }` 同口径）。
      const blurred = await page.evaluate(() => {
        const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
        const active = document.activeElement as HTMLElement | null;
        active?.blur();
        view.dispatch({ selection: { anchor: view.state.doc.length } });
        const cursor = document.querySelector<HTMLElement>(".cm-cursor-primary");
        return cursor ? getComputedStyle(cursor).display : "absent";
      });
      expect(["none", "absent"], "未聚焦时 .cm-cursor 不可见").toContain(blurred);
    });
  }
});

// ---------------------------------------------------------------------------
// M795（Alex 2026-10-29 报告）：列表行的光标几何
// ---------------------------------------------------------------------------
//
// 缺陷：同一个列表行里，光标停在序号之前（marker 隐藏区间的边界）时高 22.94px，停在正文里只有
// 18px。根因是 CM 对「落在 inline replace 区间内/边界」的位置直接采用 widget 自己的
// `getClientRects()`（13.5px 字号的 marker span），而不是所在文本行的行盒。
//
// 本块判的是 C1 在**列表行**上的同一条不变量：光标矩形高度 = 该行**正文文本**的行盒（±1px）。
// 读数与前面的 frontmatter 用例同口径（`.cm-cursor-primary` vs 文本 Range 矩形），但行盒取
// 「正文文本节点」而不是整行 Range——整行 Range 在列表行上会把 marker 自己的盒子算进第一段
// rect（那正是缺陷值），用它当基准等于让断言和缺陷同源。
//
// 定位用**文档行号**（fixture 在 Node 侧就能数出来），正文起点由 DOM 文本节点反查
// （`posAtDOM`）——不复用 `lists.ts` 的隐藏区间判定，断言与实现不同源。
//
// 区分度对照（修前必红）：marker 盒高 MUST 比正文行盒高 ≥ 2px（15px 正文下实测 22.94 vs 18），
// 修前光标高度就等于 marker 盒高。

const LIST_DOC = [
  "# 列表光标几何（合成 fixture）",
  "",
  "1. 有序列表正文 alpha",
  "- 无序列表正文 bravo",
  "- [ ] 任务项正文 charlie",
  "",
  "10. 两位编号正文 delta",
  "",
  "> - 引用内列表正文 echo",
  "",
  "- 父项正文 foxtrot",
  "  - 子项正文 golf",
  "    - 第三层正文 hotel",
  "",
  "- ",
  "",
  "3. 空项之后的有序项 india",
  "",
  "正文段落对照。",
  "",
].join("\n");

/** fixture 的行号（1 基）——Node 侧按行切分得到，与渲染无关。 */
function lineNumberOf(needle: string): number {
  const lines = LIST_DOC.split("\n");
  const index = lines.findIndex((line) => line.includes(needle));
  expect(index, `fixture 里找不到 ${JSON.stringify(needle)}`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

type Box = { top: number; left: number; width: number; height: number };

interface ListLineReading {
  /** 行首（可见行首 = marker 隐藏区间的左边界）。 */
  lineFrom: number;
  /** 正文起点（隐藏区间右边界 = 正文第一个字符的文档位置）；空项行 = 行尾。 */
  contentFrom: number;
  head: number;
  caret: Box | null;
  /** 正文文本节点的行盒（首个字符的 Range rect）。 */
  textBox: Box | null;
  /** marker widget 自身的盒子（区分度对照用）。 */
  markerBox: Box | null;
  /** 空项行（本行没有正文文本节点）。 */
  empty: boolean;
  /** 该行的可见文本（诊断用）。 */
  text: string;
}

async function readListLine(page: Page, lineNumber: number): Promise<ListLineReading> {
  return page.evaluate((n) => {
    const view = (window as unknown as { __m647View: () => ViewHandle & {
      posAtDOM(node: Node, offset?: number): number;
      domAtPos(pos: number): { node: Node; offset: number };
    } }).__m647View();
    const line = view.state.doc.line(n);
    const at = view.domAtPos(line.from);
    let node: Node | null = at.node;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const lineEl = node instanceof Element ? node.closest(".cm-line") : null;
    if (!lineEl) throw new Error(`第 ${n} 行没有对应的 .cm-line（场景装置坏了）`);
    const marker = lineEl.querySelector<HTMLElement>(".cm-lp-list-marker");
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
    // 本文件已 import `Text`（@codemirror/state 的文档模型），DOM 的全局 `Text` 类型被同名遮蔽；
    // 正文文本节点按结构取 `data`（与 src/preview/lists.ts 的 `DomTextNode` 同口径）。
    let body: (Node & { data: string }) | null = null;
    for (let item = walker.nextNode(); item; item = walker.nextNode()) {
      const text = item as unknown as Node & { data: string };
      if (!text.data.trim()) continue;
      if (marker && marker.contains(item)) continue;
      body = text;
      break;
    }
    const contentFrom = body ? view.posAtDOM(body, 0) : line.to;
    const sel = view.state.selection.main;
    const cursorEl = document.querySelector<HTMLElement>(".cm-cursor-primary");
    const caret = cursorEl ? cursorEl.getBoundingClientRect() : null;
    let textBox: Box | null = null;
    if (body) {
      const range = document.createRange();
      range.setStart(body, 0);
      range.setEnd(body, Math.min(1, body.data.length));
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) textBox = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
    }
    const markerRect = marker ? marker.getBoundingClientRect() : null;
    return {
      lineFrom: line.from,
      contentFrom,
      head: sel.head,
      caret: caret ? { top: caret.top, left: caret.left, width: caret.width, height: caret.height } : null,
      textBox,
      markerBox: markerRect
        ? { top: markerRect.top, left: markerRect.left, width: markerRect.width, height: markerRect.height }
        : null,
      empty: body === null,
      text: lineEl.textContent ?? "",
    };
  }, lineNumber);
}

async function caretAt(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
    view.focus();
    view.dispatch({ selection: { anchor: p } });
  }, pos);
  await page.waitForTimeout(60);
}

/** 一行列表的四个光标入口 × C1：可见行首 / 隐藏区间内部 / 正文起点 / 正文第 2 字。 */
async function expectListCaretHeights(page: Page, lineNumber: number, label: string): Promise<void> {
  const base = await readListLine(page, lineNumber);
  expect(base.markerBox, `${label}：第 ${lineNumber} 行（${JSON.stringify(base.text)}）应有 marker widget`).not.toBeNull();
  if (base.empty) {
    await caretAt(page, base.lineFrom);
    const reading = await readListLine(page, lineNumber);
    expect(reading.head, `${label}：落点必须真的落到行首`).toBe(base.lineFrom);
    expect(reading.caret, `${label}：空项行没有画出来的光标矩形（读不到 ≠ 通过）`).not.toBeNull();
    expect(
      Math.abs(reading.caret!.height - reading.markerBox!.height),
      `${label}：空项行光标高度 ${reading.caret!.height} MUST NOT 等于 marker 盒高 ${reading.markerBox!.height}（C1：取行盒不取 widget 盒）`,
    ).toBeGreaterThan(1);
    return;
  }
  const positions = [base.lineFrom, base.contentFrom - 1, base.contentFrom, base.contentFrom + 1];
  for (const pos of positions) {
    await caretAt(page, pos);
    const reading = await readListLine(page, lineNumber);
    expect(reading.head, `${label}：落点必须真的落到 ${pos}`).toBe(pos);
    expect(reading.caret, `${label} @${pos - reading.lineFrom}：没有画出来的光标矩形（读不到 ≠ 通过）`).not.toBeNull();
    expect(reading.textBox, `${label} @${pos - reading.lineFrom}：正文文本行盒读不到（读不到 ≠ 通过）`).not.toBeNull();
    expect(
      Math.abs(reading.caret!.height - reading.textBox!.height),
      `${label} @${pos - reading.lineFrom}：光标高度 ${reading.caret!.height} MUST 等于正文行盒 ${reading.textBox!.height}（C1，±1px）`,
    ).toBeLessThanOrEqual(1);
    expect(
      reading.markerBox!.height - reading.textBox!.height,
      `${label}：区分度——marker 盒高 ${reading.markerBox!.height} MUST 高于正文行盒 ${reading.textBox!.height} ≥ 2px（否则本断言在常量高度上空转）`,
    ).toBeGreaterThanOrEqual(2);
  }
}

test.describe("M795 列表行光标几何（C1）", () => {
  for (const theme of ["light", "dark", "eink"] as const) {
    test(`列表行光标高度 = 正文行盒 × ${theme}（列表类型 × 嵌套 × marker 宽度 × 四个光标入口）`, async ({ page }) => {
      await openDoc(page, { doc: LIST_DOC, theme, ready: "有序列表正文 alpha" });
      // 组扫描是异步的（16ms 批次）：等 8 个 marker 全部上屏再量，否则新开的 ol 组可能还是
      // 字面文本（那时「正文起点」会读成整行起点，断言在错误的输入上跑）。
      await expect.poll(() => page.locator(".cm-lp-list-marker").count(), { timeout: 5000 }).toBeGreaterThanOrEqual(8);
      for (const needle of [
        "有序列表正文 alpha",
        "无序列表正文 bravo",
        "任务项正文 charlie",
        "两位编号正文 delta",
        "引用内列表正文 echo",
        "父项正文 foxtrot",
        "子项正文 golf",
        "第三层正文 hotel",
        "空项之后的有序项 india",
      ]) {
        await expectListCaretHeights(page, lineNumberOf(needle), `${theme} / ${needle}`);
      }
    });
  }

  test("32px 字号：列表行光标高度随行盒放大（不是 15px 常量）", async ({ page }) => {
    await openDoc(page, { doc: LIST_DOC, fontSize: 32, ready: "有序列表正文 alpha" });
    await expect.poll(() => page.locator(".cm-lp-list-marker").count(), { timeout: 5000 }).toBeGreaterThanOrEqual(8);
    for (const needle of ["有序列表正文 alpha", "子项正文 golf"]) {
      await expectListCaretHeights(page, lineNumberOf(needle), `32px / ${needle}`);
    }
    const reading = await readListLine(page, lineNumberOf("有序列表正文 alpha"));
    expect(reading.caret!.height, "32px 字号下光标高度必须随行盒放大").toBeGreaterThan(30);
  });

  test("空项行（`- `）：光标高度跟随正文行盒，不取 marker 盒高", async ({ page }) => {
    await openDoc(page, { doc: LIST_DOC, ready: "有序列表正文 alpha" });
    await expect.poll(() => page.locator(".cm-lp-list-marker").count(), { timeout: 5000 }).toBeGreaterThanOrEqual(8);
    // 空项行 = fixture 里唯一一行文本只有 marker（`- `）的行：按行号定位，不靠文本匹配。
    const emptyAt = LIST_DOC.split("\n").findIndex((line) => line.trim() === "-");
    const emptyNumber = emptyAt + 1;
    await expectListCaretHeights(page, emptyNumber, "空项行");
    const reading = await readListLine(page, emptyNumber);
    expect(reading.empty, "空项行必须真的没有正文文本（否则本用例测的不是空项）").toBe(true);
    const bodyLine = await readListLine(page, lineNumberOf("无序列表正文 bravo"));
    await caretAt(page, reading.lineFrom);
    const after = await readListLine(page, emptyNumber);
    expect(after.head, "光标必须落在空项行行首（否则量的是别处）").toBe(reading.lineFrom);
    expect(
      Math.abs(after.caret!.height - bodyLine.textBox!.height),
      `空项行光标高度 ${after.caret!.height} MUST 等于正文行盒 ${bodyLine.textBox!.height}（±1px）`,
    ).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// M795 r1 P1-1：孤立空列表项（整篇没有一行正文）
// ---------------------------------------------------------------------------
//
// 空项行（`- ` / `1. ` / `- [ ] `）本行没有正文文本，`bodyTextBox` 靠「借相邻行正文文本盒的
// 高度 + 本行内容盒居中」取行盒。若整篇只有这一行（或 20 行搜索半径内没有正文），旧实现返回
// null → `coordsAt` 返回 null → CM 回退到 marker 自己的盒子（15px 正文下 22.9375px），
// 正是本 mission 要消除的取盒方式（C1 对**任意** md 文档成立）。
//
// 修法：借不到邻行时，用本行自己的排版（computed font）在离屏容器里量一个真实文本盒。
// 本块的判据与实现不同源：参考值取自**另一份带正文的文档**的正文文本 Range rect，
// 以及「20 行搜索半径之外」那一段正文的 Text Range rect。

interface IsolatedCase {
  name: string;
  doc: string;
  /** 带上屏的可见标记（marker widget 的显示文本）。 */
  ready: string;
  fontSize?: number;
}

const ISOLATED_CASES: IsolatedCase[] = [
  { name: "ul 空项 `- `", doc: "- ", ready: "–" },
  { name: "ul 空项 + 尾随换行 `- \\n`", doc: "- \n", ready: "–" },
  { name: "任务空项 `- [ ] `", doc: "- [ ] ", ready: "[ ]" },
  { name: "ol 空项 `1. `", doc: "1. ", ready: "1." },
];

/** 打开一份「只有空列表项」的文档并聚焦到行首。 */
async function openIsolated(page: Page, fixture: IsolatedCase): Promise<void> {
  await openDoc(page, {
    doc: fixture.doc,
    name: "isolated.md",
    ready: fixture.ready,
    ...(fixture.fontSize !== undefined ? { fontSize: fixture.fontSize } : {}),
  });
  await page.evaluate(() => {
    const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
  });
  await page.waitForTimeout(80);
}

/** 参考正文行盒：**另一份文档**里某一行正文文本的首字符 rect 高度（同字体度量）。 */
async function referenceBodyTextHeight(page: Page, doc: string, needle: string, fontSize?: number): Promise<number> {
  await openDoc(page, {
    doc,
    name: "reference.md",
    ready: needle,
    ...(fontSize !== undefined ? { fontSize } : {}),
  });
  const height = await page.evaluate((text) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line")).find((el) =>
      (el.textContent ?? "").includes(text),
    );
    if (!line) throw new Error(`参考文档里找不到 ${JSON.stringify(text)}`);
    const marker = line.querySelector(".cm-lp-list-marker");
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const body = node as unknown as { data: string };
      if (!body.data.trim()) continue;
      if (marker !== null && marker.contains(node)) continue;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const rect = range.getBoundingClientRect();
      if (rect.height > 0) return rect.height;
    }
    throw new Error(`参考文档的 ${JSON.stringify(text)} 没有正文文本盒`);
  }, needle);
  return height;
}

/** 当前光标 / marker 的几何读数（孤立文档只有第 1 行）。 */
async function isolatedReading(page: Page): Promise<{ caret: number; marker: number; head: number }> {
  return page.evaluate(() => {
    const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
    const cursor = document.querySelector<HTMLElement>(".cm-cursor-primary");
    const marker = document.querySelector<HTMLElement>(".cm-lp-list-marker");
    if (!cursor) throw new Error("孤立空项行没有画出光标（读不到 ≠ 通过）");
    if (!marker) throw new Error("孤立空项行的 marker widget 不在场（场景装置坏了）");
    return {
      caret: cursor.getBoundingClientRect().height,
      marker: marker.getBoundingClientRect().height,
      head: view.state.selection.main.head,
    };
  });
}

test.describe("M795 r1 孤立空列表项（无任何邻行正文，C1）", () => {
  for (const fixture of ISOLATED_CASES) {
    test(`${fixture.name}：光标高度 = 正文行盒（借不到邻行时按本行排版量），不等于 marker 盒高`, async ({ page }) => {
      // 参考值先行：另开一份 `- 正文` 文档，量正文文本盒（同字体、同字号）。
      const reference = await referenceBodyTextHeight(page, "- 正文参考", "正文参考");
      await openIsolated(page, fixture);
      const reading = await isolatedReading(page);
      expect(reading.head, "光标必须落在空项行行首").toBe(0);
      expect(
        Math.abs(reading.caret - reference),
        `${fixture.name}：光标高度 ${reading.caret} MUST 等于正文行盒 ${reference}（±1px）——修前回退到 marker 盒高`,
      ).toBeLessThanOrEqual(1);
      expect(
        reading.marker - reading.caret,
        `${fixture.name}：区分度——marker 盒高 ${reading.marker} MUST 比光标高 ≥ 2px（否则本断言在「取 marker 盒」上也绿）`,
      ).toBeGreaterThanOrEqual(2);
    });
  }

  test("孤立空项 × 32px 字号：兜底量法跟随字号放大（不是 15px 常量）", async ({ page }) => {
    const reference = await referenceBodyTextHeight(page, "- 正文参考", "正文参考", 32);
    await openIsolated(page, { name: "ul 空项 × 32px", doc: "- ", ready: "–", fontSize: 32 });
    const reading = await isolatedReading(page);
    expect(
      Math.abs(reading.caret - reference),
      `32px 孤立空项：光标高度 ${reading.caret} MUST 等于 32px 正文行盒 ${reference}（±1px）`,
    ).toBeLessThanOrEqual(1);
    expect(reading.caret, "32px 档光标必须随行盒放大").toBeGreaterThan(30);
    expect(reading.marker - reading.caret, "区分度：marker 盒高仍高于光标").toBeGreaterThanOrEqual(2);
  });

  test("20 行搜索半径之外才有正文：光标高度等于那段正文的行盒", async ({ page }) => {
    // 空项在第 1 行，正文在 26 行之后（超出 20 步搜索半径）——兜底必须落到排版量法上，
    // 而参考值仍取同一文档里真实正文文本的 rect（不是实现里的常量）。
    const doc = ["- ", ...Array.from({ length: 25 }, () => ""), "半径之外的正文段落。", ""].join("\n");
    await openDoc(page, { doc, name: "far.md", ready: "半径之外的正文段落" });
    await page.waitForTimeout(80);
    const reference = await page.evaluate((text) => {
      const line = Array.from(document.querySelectorAll<HTMLElement>(".cm-line")).find((el) =>
        (el.textContent ?? "").includes(text),
      );
      if (!line) throw new Error("远距正文行不在 DOM 里（场景装置坏了）");
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const body = node as unknown as { data: string };
        if (!body.data.trim()) continue;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, 1);
        const rect = range.getBoundingClientRect();
        if (rect.height > 0) return rect.height;
      }
      throw new Error("远距正文行没有文本盒");
    }, "半径之外的正文段落");
    await page.evaluate(() => {
      const view = (window as unknown as { __m647View: () => ViewHandle }).__m647View();
      view.focus();
      view.dispatch({ selection: { anchor: 0 } });
    });
    await page.waitForTimeout(80);
    const reading = await isolatedReading(page);
    expect(reading.head, "光标落在第 1 行空项行首").toBe(0);
    expect(
      Math.abs(reading.caret - reference),
      `搜索半径外：光标高度 ${reading.caret} MUST 等于正文行盒 ${reference}（±1px）`,
    ).toBeLessThanOrEqual(1);
    expect(reading.marker - reading.caret, "区分度：marker 盒高仍高于光标 ≥ 2px").toBeGreaterThanOrEqual(2);
  });
});
