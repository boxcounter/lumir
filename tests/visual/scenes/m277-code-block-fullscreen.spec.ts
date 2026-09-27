// M277 代码块放大全屏（change code-block-fullscreen）：惰性建立 / 打开与三条关闭路径 /
// 整块内容（含文档视口之外的行）/ 计算样式保真 / 折行两口径 / 超限块的单块纯文本退化 /
// 不穿透 / 文档与选区不变 / 阅读位置不变量（回归护栏）/ code 模式无入口 / 触发钮静止态零足迹。
// 对应 change 的 tasks 5.1–5.8。
//
// **本层看不见阅读位置缺陷**：M274 的消融实验证明「关闭交还焦点把视口拽回」在 chromium 上完全
// 不出现（WebKit 才跳）。因此 5.2b 的位置断言只是**回归护栏**，判别层是真机场景 62 的渲染行读数
// ——MUST NOT 只凭本层绿灯宣称那条不变量已验（change design §5.1）。
//
// 触发走 [keys] 配置绑定（推荐项默认不绑键），与真机场景 62 同一条路径，两侧可逐条对照。

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { stubTauri, configGets } from "./tauri-stub";

/** 基线过目包（M277）：浮层观感截图落 test-results/m277-impl/baseline-review/，等 Alex 过目
 *  （同 block-copy 场景的口径：新增基线是人肉裁决点，不写成断言）。 */
const REVIEW_DIR = new URL("../../../test-results/m277-impl/baseline-review/", import.meta.url);
async function captureReview(page: Page, name: string): Promise<void> {
  mkdirSync(REVIEW_DIR, { recursive: true });
  const path = new URL(name, REVIEW_DIR).pathname;
  await page.screenshot({ path });
  console.log(`[baseline-review] ${path}`);
}

const SOURCE = readFileSync(new URL("../fixtures/code-block-fullscreen/scene.md", import.meta.url), "utf8");
const DOC = "scene.md";
const PLAIN_DOC = "plain.md";
const TRIGGER_KEY = "Cmd-j";
const TRIGGER_PRESS = "Meta+j";

/** 长块的整块源码（含围栏行）——全屏内容的逐字节对照物。 */
const LONG_SEGMENT = SOURCE.split("```text")[1] ?? "";
const LONG_BLOCK = `\`\`\`text${LONG_SEGMENT.slice(0, LONG_SEGMENT.indexOf("```"))}\`\`\``;

/** 超限块（> 64 KiB 源码）：不在 fixture 里落盘（体积），测试时经桩注入。 */
const BIG_BODY = Array.from({ length: 3000 }, (_, i) => `big line ${String(i).padStart(4, "0")} ${"x".repeat(20)}`).join("\n");
const BIG_BLOCK = `\`\`\`text\n${BIG_BODY}\n\`\`\``;
const BIG_DOC = `# 超限块\n\n${BIG_BLOCK}\n`;

type CmView = {
  state: {
    doc: { toString(): string };
    selection: { main: { head: number; anchor: number } };
  };
  dispatch(spec: { selection?: { anchor: number; head?: number } }): void;
  focus(): void;
  contentDOM: HTMLElement;
};

const overlay = (page: Page) => page.locator(".lumir-codeblock-fs-overlay");
const fsTrigger = (page: Page) => page.locator(".lumir-codeblock-fs-trigger").first();

async function openDoc(
  page: Page,
  options: { codeBlockWrap?: boolean; code?: string; slots?: number } = {},
): Promise<void> {
  await stubTauri(page, {
    entries: [
      { path: DOC, kind: "file", size: SOURCE.length, mtime_ms: 0 },
      { path: "notes.txt", kind: "file", size: 12, mtime_ms: 0 },
    ],
    files: { [DOC]: options.code ?? SOURCE, "notes.txt": "plain text\n" },
    config: { keys: { [TRIGGER_KEY]: "code-block.toggle-fullscreen" }, code_block_wrap: options.codeBlockWrap ?? false },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${DOC}"]`).click();
  await expect(page.locator(".cm-lp-codeblock-slot")).toHaveCount(options.slots ?? 3);
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await expect(page.locator(".modeline-path")).toHaveText(DOC);
  await page.waitForTimeout(80);
}

async function caretAt(page: Page, needle: string, offset = 0): Promise<void> {
  const pos = await page.evaluate(
    ({ needle, offset }) => {
      const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
      const text = el.cmTile.root.view.state.doc.toString();
      const at = text.indexOf(needle);
      if (at < 0) throw new Error(`fixture 里找不到 ${needle}`);
      return at + offset;
    },
    { needle, offset },
  );
  await page.evaluate((p) => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    const view = el.cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

function docText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    return el.cmTile.root.view.state.doc.toString();
  });
}

/** 遮罩的渲染读数：节点数 / 可见性 / 语义 / 内容行与文本 / 滚动几何 / 焦点。 */
function overlayReading(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll(".lumir-codeblock-fs-overlay");
    const el = nodes[0] as HTMLElement | undefined;
    const content = el?.querySelector<HTMLElement>(".lumir-codeblock-fs-content") ?? null;
    const panel = el?.querySelector<HTMLElement>(".lumir-codeblock-fs-panel") ?? null;
    const box = content?.getBoundingClientRect();
    const lines = content === null ? [] : [...content.children].map((child) => child.textContent ?? "");
    return {
      count: nodes.length,
      visible: el !== undefined && !el.hidden,
      role: el?.getAttribute("role") ?? null,
      ariaModal: el?.getAttribute("aria-modal") ?? null,
      label: el?.getAttribute("aria-label") ?? null,
      contentClass: content?.className ?? null,
      lineCount: lines.length,
      text: lines.join("\n"),
      headCount: content?.querySelectorAll(".cm-lp-codeblock-head").length ?? 0,
      tokenCount: content?.querySelectorAll("span[class^='cm-lp-tok-']").length ?? 0,
      width: box?.width ?? 0,
      height: box?.height ?? 0,
      panelClientWidth: panel?.clientWidth ?? 0,
      panelScrollWidth: panel?.scrollWidth ?? 0,
      panelScrollLeft: panel?.scrollLeft ?? 0,
      focusedInside: el !== undefined && el.contains(document.activeElement),
    };
  });
}

/** 遮罩是否**可见**（DOM 惰性建立 ⇒ 节点存在不等于开着，"没打开"必须按可见性判）。 */
const overlayVisible = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".lumir-codeblock-fs-overlay");
    return el !== null && !el.hidden;
  });

const scrollerState = (page: Page) =>
  page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    return { top: scroller.scrollTop, left: scroller.scrollLeft };
  });

/** 打开长块的遮罩（caret 落在长块里，经 [keys] 绑定的 ⌘J）。 */
async function openLong(page: Page): Promise<void> {
  await caretAt(page, "line 0025", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
}

test("5.1 打开：遮罩惰性建立、几何非零、读屏名复用容器标签、整块内容在场（含视口外的行）", async ({ page }) => {
  await openDoc(page);

  // spec「文档打开路径零新增」：一次都没触发时 DOM 里没有遮罩节点。
  expect(await overlay(page).count()).toBe(0);

  await openLong(page);
  const reading = await overlayReading(page);
  expect(reading.role).toBe("dialog");
  expect(reading.ariaModal).toBe("true");
  // 读屏名复用文档内容器的既有标签（同一生成处，零新字面量）。
  expect(reading.label).toBe("Markdown 代码块 2");
  expect(reading.width).toBeGreaterThan(100);
  expect(reading.height).toBeGreaterThan(100);
  expect(reading.focusedInside).toBe(true);
  // 整块源码：逐字节等于 fixture 里那一块（含围栏行与**文档视口之外**的块尾行）。
  expect(reading.text).toBe(LONG_BLOCK);
  expect(reading.text).toContain("TAIL-MARKER 块尾标记");
  // 头部条只有首行（起始围栏）；text 块没有 info string 收录语言，因此不着色。
  expect(reading.headCount).toBe(1);
  expect(reading.tokenCount).toBe(0);
  await captureReview(page, "fullscreen-long-block-nowrap.png");
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toBeHidden();
});

test("5.1b 触发钮：静止态零足迹，hover 浮现两钮、点击打开遮罩", async ({ page }) => {
  await openDoc(page);
  await page.mouse.move(0, 0);

  const resting = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>(".cm-lp-codeblock-slot .lumir-block-trigger")];
    const slot = document.querySelector(".cm-lp-codeblock-slot") as HTMLElement;
    const r = slot.getBoundingClientRect();
    return {
      count: buttons.length,
      hidden: buttons.every((b) => getComputedStyle(b).visibility === "hidden" && getComputedStyle(b).opacity === "0"),
      box: { top: r.top, left: r.left, width: r.width, height: r.height },
    };
  });
  expect(resting.count).toBe(6); // 3 个代码块 × (复制 + 放大)
  expect(resting.hidden).toBe(true);

  await page.hover(".cm-lp-codeblock-slot");
  await expect.poll(() => fsTrigger(page).evaluate((el) => getComputedStyle(el).visibility)).toBe("visible");
  const placed = await page.evaluate(() => {
    const slot = document.querySelector(".cm-lp-codeblock-slot") as HTMLElement;
    const copy = slot.querySelector<HTMLElement>(".lumir-block-copy-trigger")!;
    const fs = slot.querySelector<HTMLElement>(".lumir-codeblock-fs-trigger")!;
    const s = slot.getBoundingClientRect();
    return {
      fsRight: s.right - fs.getBoundingClientRect().right,
      fsTop: fs.getBoundingClientRect().top - s.top,
      gap: fs.getBoundingClientRect().left - copy.getBoundingClientRect().right,
      sameSize:
        copy.getBoundingClientRect().width === fs.getBoundingClientRect().width &&
        copy.getBoundingClientRect().height === fs.getBoundingClientRect().height,
      slotBox: { top: s.top, left: s.left, width: s.width, height: s.height },
    };
  });
  expect(placed.fsRight).toBeCloseTo(6, 0);
  expect(placed.fsTop).toBeCloseTo(6, 0);
  expect(placed.gap).toBeCloseTo(4, 0);
  expect(placed.sameSize).toBe(true);
  // 钮不参与布局：hover 前后 slot 几何逐值不变（静止态零足迹）。
  expect(placed.slotBox.height).toBeCloseTo(resting.box.height, 1);
  expect(placed.slotBox.width).toBeCloseTo(resting.box.width, 1);

  // 鼠标入口：点钮打开遮罩。
  await fsTrigger(page).click();
  const reading = await overlayReading(page);
  expect(reading.visible).toBe(true);
  expect(reading.label).toBe("Markdown 代码块 1");
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toBeHidden();
});

test("5.2 三条关闭路径各自关闭、焦点回编辑器、文档与选区逐字节不变", async ({ page }) => {
  await openDoc(page);
  const before = await docText(page);

  // Esc（就地消费）
  await openLong(page);
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.className ?? "")).toContain("cm-content");

  // 点击遮罩（面板以外区域）
  await openLong(page);
  await page.mouse.click(600, 4);
  await expect(overlay(page)).toBeHidden();

  // 再次执行同一命令（toggle）
  await openLong(page);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeHidden();

  expect(await docText(page)).toBe(before);
});

test("5.2b 位置不变量（回归护栏）：关闭前后 scrollTop / scrollLeft 逐值不变", async ({ page }) => {
  await openDoc(page);
  // 先把视口滚到文档中段，caret 仍在长块里。
  await caretAt(page, "line 0025", 1);
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = Math.round(scroller.scrollHeight / 2);
  });
  await page.waitForTimeout(60);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(overlay(page)).toBeHidden();
  const after = await scrollerState(page);
  // 如实标注覆盖层：chromium 结构性看不见这条缺陷（M274 消融实验），本断言只是回归护栏，
  // 判别层是真机场景 62 的渲染行读数。
  expect(after.top).toBeGreaterThan(0);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await scrollerState(page)).toEqual(after);
});

test("5.3 不穿透：持焦期间编辑键不动文档，Tab 留在遮罩内", async ({ page }) => {
  await openDoc(page);
  await openLong(page);
  const before = await docText(page);
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+k");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(80);
  expect(await docText(page)).toBe(before);
  expect((await overlayReading(page)).focusedInside).toBe(true);
});

test("5.4 内容保真：计算样式与文档内代码块逐项一致（字体 / 字号 / 行高 / 底板）", async ({ page }) => {
  await openDoc(page);
  await openLong(page);
  const styles = await page.evaluate(() => {
    const props = ["fontFamily", "fontSize", "lineHeight", "backgroundColor", "color", "whiteSpace"] as const;
    const pick = (el: Element | null) => {
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs[p]]));
    };
    const docContent = document.querySelector(".cm-lp-codeblock-scroll")!;
    const docLine = docContent.querySelector(".cm-line.cm-lp-codeblock-line")!;
    const content = document.querySelector(".lumir-codeblock-fs-content")!;
    const overlayLine = content.querySelector(".cm-line.cm-lp-codeblock-line")!;
    return { docContainer: pick(docContent), overlayContainer: pick(content), docLine: pick(docLine), overlayLine: pick(overlayLine) };
  });
  // 内容容器的底板与文档内横滚容器同源（--code-bg），行样式由镜像的主题 scope 命中既有规则。
  expect(styles.overlayContainer?.backgroundColor).toBe(styles.docContainer?.backgroundColor);
  expect(styles.overlayLine?.fontFamily).toBe(styles.docLine?.fontFamily);
  expect(styles.overlayLine?.fontSize).toBe(styles.docLine?.fontSize);
  expect(styles.overlayLine?.lineHeight).toBe(styles.docLine?.lineHeight);
  expect(styles.overlayLine?.whiteSpace).toBe(styles.docLine?.whiteSpace);
});

test("5.5 折行两口径：不折行时浮层横向可滚，折行时不出现横向滚动", async ({ page }) => {
  // 不折行（出厂）：内容按自然宽呈现，超长行由壳横向滚动到达。
  await openDoc(page);
  await caretAt(page, "const long", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  const nowrap = await overlayReading(page);
  expect(nowrap.label).toBe("Markdown 代码块 1");
  expect(nowrap.contentClass).toContain("cm-lp-codeblock-nowrap");
  expect(nowrap.panelScrollWidth).toBeGreaterThan(nowrap.panelClientWidth);
  await page.evaluate(() => {
    (document.querySelector(".lumir-codeblock-fs-panel") as HTMLElement).scrollLeft = 400;
  });
  expect((await overlayReading(page)).panelScrollLeft).toBeGreaterThan(0);
  await page.keyboard.press("Escape");

  // 折行：行在浮层栏内折行，不出现横向滚动（配置是唯一真源，浮层内没有第二个开关）。
  await page.locator(`.cm-content`).click();
  await openDoc(page, { codeBlockWrap: true });
  await caretAt(page, "const long", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  const wrap = await overlayReading(page);
  expect(wrap.contentClass).toContain("cm-lp-codeblock-wrap");
  expect(wrap.panelScrollWidth).toBeLessThanOrEqual(wrap.panelClientWidth + 1);
  // 文档侧口径不变：折行时块内没有横向滚动容器（M180 的既有条款）。
  expect(await page.locator(".cm-lp-codeblock-scroll").count()).toBe(0);
  // 折行口径下触发钮仍在（slot 层无条件存在，这是本 change 的一条不变量）。
  expect(await page.locator(".lumir-codeblock-fs-trigger").count()).toBe(3);
});

test("5.6 内容上界：超限块以单块纯文本呈现整块源码，节点数有界", async ({ page }) => {
  await openDoc(page, { code: BIG_DOC, slots: 1 });
  await caretAt(page, "big line 1500", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  const reading = await overlayReading(page);
  expect(reading.label).toBe("Markdown 代码块 1");
  expect(reading.text).toBe(BIG_BLOCK);
  // 单块纯文本：行节点数是 1（不随行数线性增长），也因此没有着色与头部条。
  expect(reading.lineCount).toBe(1);
  expect(reading.headCount).toBe(0);
  expect(reading.tokenCount).toBe(0);
});

test("5.7 入口边界：正文段落与 code 模式文件都没有入口（负向配正观测）", async ({ page }) => {
  await openDoc(page);

  // 负向①：caret 在正文段落里执行同一命令 → 不出现遮罩。
  await caretAt(page, "文档开头段落", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await page.waitForTimeout(120);
  expect(await overlayVisible(page)).toBe(false);

  // 正观测：同一串键在同一份文档的代码块里确实能打开（前一步的「没打开」不是「键没送到」）。
  await openLong(page);
  await expect(overlay(page)).toBeVisible();
  await page.keyboard.press("Escape");

  // 负向②：code 模式（非 md 文件）没有任何入口与容器。
  await page.locator('.ft-row[title="notes.txt"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("notes.txt");
  expect(await page.locator(".lumir-codeblock-slot").count()).toBe(0);
  expect(await page.locator(".lumir-codeblock-fs-trigger").count()).toBe(0);
  await caretAt(page, "plain text", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await page.waitForTimeout(120);
  expect(await overlayVisible(page)).toBe(false);
});

test("5.7b 缩进代码块同样可放大：没有头部条（没有围栏行）", async ({ page }) => {
  await openDoc(page);
  await caretAt(page, "indented body one", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect(overlay(page)).toBeVisible();
  const reading = await overlayReading(page);
  expect(reading.label).toBe("Markdown 代码块 3");
  expect(reading.text).toBe("    indented body one\n    indented body two");
  expect(reading.headCount).toBe(0);
});
