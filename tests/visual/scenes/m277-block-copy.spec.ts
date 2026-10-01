// M277 块级复制（change block-copy-affordance）：静止态零足迹 / hover 两钮共存的几何 /
// 点击复制的剪贴板内容 / 结构性边界（降级表、非矩形表、mermaid 图表态没有钮）/
// 命令路径与不消费 / 文档与选区逐字节不变。对应 change 的 tasks 2.1–2.3、3.x、5.3、7.1。
//
// 判据纪律（REVIEW.md 第 1、2 条）：
//   - 「钮不可见」不靠 class 存在，靠 `getComputedStyle` 的 visibility / opacity；
//   - 「没有钮」这类负向断言都配一条同场景正观测（非矩形表 / mermaid 没有钮 ↔ 正常表 / 普通围栏块有钮）；
//   - 复制内容逐字节比对**文档源码**（不是屏幕文本），这是本 change 的核心口径。
//
// 值得单独说明的一条：真机层**没有 hover 动作**（套件动作表里没有 hover / mouseMove），
// 所以「触发钮的鼠标路径」只有本层覆盖——真机场景 61 走命令路径（同 M240 场景 40 的口径）。
//
// M298 追加：触发钮**自身**的 hover 反馈（Alex 2026-10-01）。判据是计算属性——钮被指到时在
// 不透底的壳上叠一层 `--hover`；只在块上（钮刚浮现）时那一层不存在，两者互为负对照。

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { stubTauri, configGets } from "./tauri-stub";

/** 基线过目包（M277）：hover 帧的观感截图落 test-results/m277-impl/baseline-review/，等 Alex 过目。
 *  **刻意不写成 `expectScreenshot` 断言**：新增整页 / 元素基线是 Alex 的人肉裁决点（AGENTS.md
 *  的视觉门禁卫生），断言化会让门禁在裁决之前一直是红的；静止态基线零变化由全量视觉门禁
 *  （22 处既有像素断言）自己证明。 */
const REVIEW_DIR = new URL("../../../test-results/m277-impl/baseline-review/", import.meta.url);
async function captureReview(page: Page, name: string): Promise<void> {
  mkdirSync(REVIEW_DIR, { recursive: true });
  const path = new URL(name, REVIEW_DIR).pathname;
  await page.screenshot({ path });
  console.log(`[baseline-review] ${path}`);
}

const SOURCE = readFileSync(new URL("../fixtures/block-copy/scene.md", import.meta.url), "utf8");
const DOC = "scene.md";
const TRIGGER_KEY = "Cmd-j";
const TRIGGER_PRESS = "Meta+j";

const COPY_TRIGGER = ".lumir-block-copy-trigger";
const FS_TRIGGER = ".lumir-table-fs-trigger";

type CmView = {
  state: {
    doc: { toString(): string };
    selection: { main: { head: number; anchor: number } };
  };
  dispatch(spec: { selection?: { anchor: number; head?: number } }): void;
  focus(): void;
  contentDOM: HTMLElement;
};

async function openDoc(page: Page, context: { grantPermissions(p: string[]): Promise<void> }): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubTauri(page, {
    entries: [{ path: DOC, kind: "file", size: SOURCE.length, mtime_ms: 0 }],
    files: { [DOC]: SOURCE },
    config: { keys: { [TRIGGER_KEY]: "block.copy" } },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${DOC}"]`).click();
  // 一张 grid 表 + 两个代码块（围栏 / 缩进）有钮；非矩形表与 mermaid 块没有。
  await expect(page.locator(".cm-lp-table")).toHaveCount(1);
  await expect(page.locator(COPY_TRIGGER)).toHaveCount(3);
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

function selectionShape(page: Page): Promise<[number, number]> {
  return page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    const main = el.cmTile.root.view.state.selection.main;
    return [main.anchor, main.head];
  });
}

function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** 文档里唯一那张 grid 表的源码（逐字节，含表头分隔行与对齐填充）。 */
const TABLE_SOURCE = "| 名称 | 值 |\n| ---   | ---: |\n| 甲 | 1 |\n| 乙 | 22 |";
const FENCED_CONTENT = 'const a = 1;\n  if (a) {\n    console.log(a);\n  }';
const INDENTED_CONTENT = "indented one\n    deeper";

/** 触发钮的几何读数（相对块的 slot）。 */
function triggerBoxes(page: Page, slot: string) {
  return page.evaluate((slotSel) => {
    const el = document.querySelector(slotSel) as HTMLElement;
    const boxes = [...el.querySelectorAll<HTMLElement>(".lumir-block-trigger")].map((b) => {
      const r = b.getBoundingClientRect();
      return { cls: b.className, left: r.left, right: r.right, top: r.top, width: r.width, height: r.height };
    });
    const s = el.getBoundingClientRect();
    return { slotRight: s.right, slotTop: s.top, boxes };
  }, slot);
}

test("5.3a 静止态零足迹：钮在 DOM 但不可见 / 不占位，块几何逐值不变", async ({ page, context }) => {
  await openDoc(page, context);

  const resting = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLElement>(".lumir-block-trigger")];
    const scroll = document.querySelector(".cm-lp-table-scroll") as HTMLElement;
    const r = scroll.getBoundingClientRect();
    return {
      visibility: buttons.map((b) => getComputedStyle(b).visibility),
      opacity: buttons.map((b) => getComputedStyle(b).opacity),
      box: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
  });
  expect(resting.visibility.every((v) => v === "hidden")).toBe(true);
  expect(resting.opacity.every((v) => v === "0")).toBe(true);

  // 静止态钮不参与布局：hover 前后表格可视盒逐值不变。
  await page.hover(".cm-lp-table-slot");
  await expect.poll(() => page.locator(`${COPY_TRIGGER}`).first().evaluate((el) => getComputedStyle(el).visibility)).toBe("visible");
  const hovering = await page.evaluate(() => {
    const r = (document.querySelector(".cm-lp-table-scroll") as HTMLElement).getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
  expect(hovering.width).toBeCloseTo(resting.box.width, 1);
  expect(hovering.height).toBeCloseTo(resting.box.height, 1);
  expect(hovering.left).toBeCloseTo(resting.box.left, 1);
});

test("5.3b 表格：hover 后两钮同时浮现，复制钮在放大钮左侧、间隙 4px、尺寸相同", async ({ page, context }) => {
  await openDoc(page, context);
  await page.mouse.move(0, 0);
  await page.hover(".cm-lp-table-slot");
  await expect.poll(() => page.locator(`${COPY_TRIGGER}`).first().evaluate((el) => getComputedStyle(el).visibility)).toBe("visible");
  await expect.poll(() => page.locator(`.cm-lp-table-slot ${FS_TRIGGER}`).evaluate((el) => getComputedStyle(el).visibility)).toBe("visible");

  const placed = await triggerBoxes(page, ".cm-lp-table-slot");
  expect(placed.boxes).toHaveLength(2);
  const copy = placed.boxes.find((b) => b.cls.includes("lumir-block-copy-trigger"))!;
  const fs = placed.boxes.find((b) => b.cls.includes("lumir-table-fs-trigger"))!;
  // 放大钮贴角（M240 的既有几何，一字不动）。
  expect(placed.slotRight - fs.right).toBeCloseTo(6, 0);
  expect(fs.top - placed.slotTop).toBeCloseTo(6, 0);
  // 复制钮在它左侧、间隙 4px、尺寸相同。
  expect(fs.left - copy.right).toBeCloseTo(4, 0);
  expect(placed.slotRight - copy.right).toBeCloseTo(36, 0);
  expect(copy.width).toBeCloseTo(fs.width, 1);
  expect(copy.height).toBeCloseTo(fs.height, 1);
  // 组内自左至右「复制 → 放大」。
  expect(copy.right).toBeLessThan(fs.left);
  await captureReview(page, "table-hover-two-buttons.png");
});

test("5.3c 点击复制钮：剪贴板 = 表格源码逐字节，成功 toast 带 ✓，文档与选区不变", async ({ page, context }) => {
  await openDoc(page, context);
  await caretAt(page, "落点参照段落", 1);
  const before = await docText(page);
  const selBefore = await selectionShape(page);
  await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));

  await page.hover(".cm-lp-table-slot");
  await page.locator(`.cm-lp-table-slot ${COPY_TRIGGER}`).click();

  await expect.poll(() => clipboard(page)).toBe(TABLE_SOURCE);
  await expect(page.locator(".lumir-toast", { hasText: "已复制表格" })).toBeVisible();
  await expect(page.locator(".lumir-toast .toast-check").first()).toBeVisible();

  // 点击不改文档、不改选区（ADR 0003 §3；mousedown 的 preventDefault 是这条的机制）。
  expect(await docText(page)).toBe(before);
  expect(await selectionShape(page)).toEqual(selBefore);
});

test("5.3d 代码块复制钮：剪贴板 = 纯内容（围栏行与语言标记不在结果里 / 缩进剥语法缩进）", async ({ page, context }) => {
  await openDoc(page, context);

  // 围栏块：第二个代码块 slot（第一个是围栏块）。
  const fencedSlot = page.locator(".cm-lp-codeblock-slot").nth(0);
  await fencedSlot.hover();
  await fencedSlot.locator(COPY_TRIGGER).click();
  await expect.poll(() => clipboard(page)).toBe(FENCED_CONTENT);
  await expect(page.locator(".lumir-toast", { hasText: "已复制代码块" })).toBeVisible();

  // 缩进块：第三个 slot（序：围栏块 / 缩进块 / mermaid）。
  const indentedSlot = page.locator(".cm-lp-codeblock-slot").nth(1);
  await indentedSlot.hover();
  await indentedSlot.locator(COPY_TRIGGER).click();
  await expect.poll(() => clipboard(page)).toBe(INDENTED_CONTENT);
  await captureReview(page, "codeblock-hover-two-buttons.png");
});

test("5.3e 结构性边界：非矩形表与 mermaid 图表态没有钮，普通表 / 围栏块有（配对正观测）", async ({ page, context }) => {
  await openDoc(page, context);

  const shape = await page.evaluate(() => {
    const degraded = document.querySelectorAll(".cm-lp-table-degraded").length;
    const gridTables = document.querySelectorAll(".cm-lp-table").length;
    const mermaid = document.querySelector(".cm-lp-mermaid");
    const mermaidSlot = mermaid?.closest(".cm-lp-codeblock-slot") ?? null;
    const slots = [...document.querySelectorAll(".cm-lp-codeblock-slot")];
    return {
      degraded,
      gridTables,
      mermaidPresent: mermaid !== null,
      mermaidButtons: mermaidSlot === null ? -1 : mermaidSlot.querySelectorAll(".lumir-block-trigger").length,
      slotCounts: slots.map((s) => s.querySelectorAll(".lumir-block-trigger").length),
    };
  });
  // 负向：降级表（非矩形）整块回退成源码，没有 grid DOM 也就没有钮；mermaid 图表态块内没有源码行。
  expect(shape.degraded).toBeGreaterThan(0);
  expect(shape.gridTables).toBe(1);
  expect(shape.mermaidPresent).toBe(true);
  expect(shape.mermaidButtons).toBe(0);
  // 正观测：普通围栏块与缩进块的 slot 里确有钮（保证上一条不是恒真的空断言）。
  expect(shape.slotCounts.filter((n) => n === 2)).toHaveLength(2);
});

test("5.3f 命令路径：caret 在表内命中并复制；在段落里不消费事件、剪贴板保持上一次的值", async ({ page, context }) => {
  await openDoc(page, context);
  await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));

  // 负对照：caret 在普通段落里（元素在同一份文档里，键注入通道已被上一步证实在用）。
  await caretAt(page, "触发前 caret", 1);
  const inParagraph = await docText(page);
  await page.keyboard.press(TRIGGER_PRESS);
  await page.waitForTimeout(120);
  expect(await clipboard(page)).toBe("sentinel-before");
  expect(await page.locator(".lumir-toast", { hasText: "已复制" }).count()).toBe(0);
  expect(await docText(page)).toBe(inParagraph);

  // 正观测：同一串键在同一份文档的表格里真的能落地（前一步的「不变」不是「键没送到」）。
  await caretAt(page, "| 甲 |", 3);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect.poll(() => clipboard(page)).toBe(TABLE_SOURCE);
  await expect(page.locator(".lumir-toast", { hasText: "已复制表格" })).toBeVisible();
});

test("5.3g 命令路径：非矩形表与 mermaid 图表态都不命中（没有可复制的 grid 块）", async ({ page, context }) => {
  await openDoc(page, context);
  await page.evaluate(() => navigator.clipboard.writeText("sentinel-before"));

  // 非矩形表：它降级成源码，caret 在它内部时语法树里是 Table 节点但模型判非矩形 ⇒ 不命中。
  await caretAt(page, "| one | two | three |", 4);
  await page.keyboard.press(TRIGGER_PRESS);
  await page.waitForTimeout(120);
  expect(await clipboard(page)).toBe("sentinel-before");

  // mermaid 图表态：命令路径仍然命中（判据是模型级的，与钮无关）——这是「图表态没有钮但命令可用」
  // 这条设计决定的正观测。
  await caretAt(page, "graph TD;", 1);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect.poll(() => clipboard(page)).toBe("graph TD;\n  Start-->Stop;");
});

/** 触发钮的漆面读数（M298）：叠层 / 底色 / 前景，外加三个 token 的探针值（探针口径同本文件
 *  M291 那条：把候选值塞进一个 div 再读回计算值，场景里不写 token 字面值的副本）。 */
function triggerPaint(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const probe = (name: string) => {
      const d = document.createElement("div");
      d.style.background = `var(${name})`;
      document.body.appendChild(d);
      const out = getComputedStyle(d).backgroundColor;
      d.remove();
      return out;
    };
    const cs = getComputedStyle(el);
    return {
      backgroundImage: cs.backgroundImage,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      visibility: cs.visibility,
      previewBg: probe("--preview-bg"),
      hover: probe("--hover"),
      text: probe("--text"),
    };
  });
}

const squeeze = (s: string) => s.replace(/\s+/g, "");

/** 钮自身的 hover 反馈（M298）：指针**只在块上**（钮刚浮现、没被指到）时没有反馈层；指针落到
 *  钮上时在不透底的壳上叠出 `--hover` 那一层。两次读数只差指针位置，互为负对照。 */
async function expectTriggerHoverFeedback(page: Page, slot: string, button: string): Promise<void> {
  await page.mouse.move(0, 0);
  await page.hover(slot);
  await expect.poll(() => triggerPaint(page, button).then((r) => r.visibility)).toBe("visible");
  const onBlock = await triggerPaint(page, button);
  expect(onBlock.backgroundImage, "指针只在块上：没有反馈层").toBe("none");
  expect(onBlock.backgroundColor, "壳 = --preview-bg（不透底）").toBe(onBlock.previewBg);
  expect(onBlock.color, "块上的 hover 已把图标提到 --text").toBe(onBlock.text);

  await page.hover(button);
  await expect.poll(() => triggerPaint(page, button).then((r) => r.backgroundImage)).toContain("linear-gradient");
  const onButton = await triggerPaint(page, button);
  expect(onButton.color, "反馈层不动前景").toBe(onBlock.color);
  expect(onButton.backgroundColor, "反馈只是叠的一层：壳的底色逐值不变（不透底）").toBe(onBlock.backgroundColor);
  expect(squeeze(onButton.backgroundImage), "叠的是 --hover 那一档，不是字面值").toContain(squeeze(onButton.hover));
}

test("M298 钮自身 hover：表格与代码块两处、两个钮都叠出一层 --hover（只在块上时没有）", async ({ page, context }) => {
  await openDoc(page, context);
  await expectTriggerHoverFeedback(page, ".cm-lp-table-slot", COPY_TRIGGER);
  await expectTriggerHoverFeedback(page, ".cm-lp-table-slot", `.cm-lp-table-slot ${FS_TRIGGER}`);
  await expectTriggerHoverFeedback(page, ".cm-lp-codeblock-slot", ".cm-lp-codeblock-slot .lumir-block-copy-trigger");
  await expectTriggerHoverFeedback(page, ".cm-lp-codeblock-slot", ".cm-lp-codeblock-slot .lumir-codeblock-fs-trigger");
});

test("M291 r3：触发钮热态取选中族（eink = 明度带 + 黑字，硬编码黑底白字退场）", async ({ page, context }) => {
  // Alex 2026-09-28 r3 裁决：`.lumir-block-trigger` 在 eink 下的热态原先硬编码 `#000` 底 + `#fff` 字，
  // 按 M291 的方向退场——改为选中族（`--sel` 明度带 + `--sel-text` 黑字），与 eink 已整体改过的
  // 选中态一致（tokens 文档 §选区族）。静止态三处字面值同时按收敛规则 1 归位到 token（值不变）。
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubTauri(page, {
    entries: [{ path: DOC, kind: "file", size: SOURCE.length, mtime_ms: 0 }],
    files: { [DOC]: SOURCE },
    config: { theme: "eink", keys: { [TRIGGER_KEY]: "block.copy" } },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${DOC}"]`).click();
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);

  const read = () =>
    page.locator(`${COPY_TRIGGER}`).first().evaluate((el) => {
      const probe = (v: string) => {
        const d = document.createElement("div");
        d.style.background = v;
        document.body.appendChild(d);
        const out = getComputedStyle(d).backgroundColor;
        d.remove();
        return out;
      };
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, sel: probe("var(--sel)"), selText: probe("var(--sel-text)") };
    });
  const nums = (s: string) => (s.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  const diff = (a: string, b: string) => Math.max(...[0, 1, 2].map((i) => Math.abs(nums(a)[i] - nums(b)[i])));

  // 静止态：白底黑框（规则⑤）——token 化后与 `--preview-bg` / `--text` 同值（逐值不变）。
  await page.mouse.move(0, 0);
  const resting = await read();
  expect(resting.bg, "eink 静止态底色 = 白底（--preview-bg）").toBe("rgb(255, 255, 255)");

  // 热态：hover 后取选中族。
  await page.hover(".cm-lp-table-slot");
  await expect
    .poll(() => page.locator(COPY_TRIGGER).first().evaluate((el) => getComputedStyle(el).visibility))
    .toBe("visible");
  const hot = await read();
  expect(hot.bg, "eink 热态底色 = --sel（明度带）").toBe(hot.sel);
  expect(hot.color, "eink 热态前景 = --sel-text（黑字）").toBe(hot.selText);
  expect(diff(hot.color, hot.bg), `eink 热态文字 MUST 与底色可辨（差 ${diff(hot.color, hot.bg)} ≥ 40）`).toBeGreaterThanOrEqual(40);

  // M298 追加：eink 的「钮自身 hover」= 在这条 --sel 明度带之上再叠一层 --hover，底色与前景都不换。
  // 这一条同时是 eink 侧层叠的判据：那条规则靠 slot 前缀把特异性抬到 `background` 简写之上，
  // 前缀写漏（或被后人删掉）时这里会红，而不是静默少一层。
  const imageOf = () => triggerPaint(page, COPY_TRIGGER).then((r) => r.backgroundImage);
  expect(await imageOf(), "指针只在块上：没有反馈层").toBe("none");
  await page.hover(COPY_TRIGGER);
  await expect.poll(imageOf).toContain("linear-gradient");
  const onButton = await triggerPaint(page, COPY_TRIGGER);
  expect(onButton.backgroundColor, "eink 反馈层不换底色：仍是 --sel（明度带）").toBe(hot.sel);
  expect(onButton.color, "eink 反馈层不换前景：仍是 --sel-text").toBe(hot.selText);
  expect(squeeze(onButton.backgroundImage), "叠的是 --hover 那一档").toContain(squeeze(onButton.hover));
});
