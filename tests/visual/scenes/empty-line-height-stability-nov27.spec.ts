// change fix-empty-line-height-stability-nov27：块边界纵向几何的行局部性（合同
// openspec/specs/editor-live-preview/spec.md「块边界纵向几何的源码同步稳定性」，delta 见本 change）。
//
// 缺陷（Alex 2026-11-27）：普通正文行的 8px 段末下距同时由「下一行是否块边界」与「本行是否文档
// 末行」决定——空行落字、标题→正文、EOF 输入都会让**未编辑行**的高度翻转，caret 所在行的行盒 /
// active gutter / END 标记因此跳 8px。修复把普通正文与空行的纵向 padding 归零（标题阶梯 / 列表
// 2px 等块自身间距不变）。
//
// 本文件判的是终态合同的三个可证伪面：
//   1. 普通行局部性：正文 / 空行的 `.cm-line` 纵向 padding 恒 0，行盒 = 计算行高；
//   2. 非语义迁移稳定：空↔有字、Enter 拆合、selection / focus / IME 不改变任何行的行盒、top、
//      active gutter 高度与 END 位置；
//   3. 语义 reflow 有界：heading↔text 只改标题行自身，块外行高度不变、其后行的位移等于获批高度差。
// 另加 DOM ↔ CM heightmap ↔ gutter 的对账与「滚出视口再滚回」的同值判据（只看 DOM 会漏掉陈旧
// heightmap，见 change design）。
//
// 读数分路互不借用（REVIEW.md「断言等价于子串」条）：DOM 行盒取 `.cm-line` 的 rect，CM 侧取
// `lineBlockAt` / `contentHeight`，gutter 取 `.cm-activeLineGutter`，END 取真实元素 rect。
// 旧合同由 tests/unit/block-geometry.test.ts、block-boundary-geometry.spec.ts 与
// markdown-editing-stability.spec.ts 的 8px 断言钉住——它们必须随本 change 变红后改到终态；
// m399（空行正常行高）与 m647（caret 几何）**不动**，本 change 落地后仍须原样绿。
import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

interface ViewHandle {
  state: {
    doc: {
      length: number;
      toString(): string;
      line(n: number): { from: number; to: number; number: number };
      lineAt(pos: number): { from: number; to: number; number: number };
    };
    selection: { main: { anchor: number; head: number; from: number; to: number } };
  };
  contentHeight: number;
  lineBlockAt(pos: number): { from: number; to: number; top: number; height: number };
  coordsAtPos(pos: number, side?: number): { top: number; bottom: number; left: number; right: number } | null;
  posAtDOM(node: Node, offset?: number): number;
  dispatch(spec: unknown): void;
  focus(): void;
  scrollDOM: HTMLElement;
}

interface LineSnap {
  text: string;
  top: number;
  height: number;
  paddingTop: number;
  paddingBottom: number;
  blockTop: number;
  blockHeight: number;
}

interface Snapshot {
  lines: LineSnap[];
  contentHeight: number;
  endTop: number | null;
  endBottom: number | null;
  activeGutter: { text: string; height: number } | null;
  lineHeight: number;
}

function viewExpr(): string {
  return `.cm-content`;
}

/** 页面内取 CM 的 view（与 m399 / m647 同一取法）。必须走 addInitScript：goto 之后
 *  evaluate 装上的钩子只活在 about:blank 上，导航即丢（首跑 17 条全红的装置错误）。 */
async function installViewHook(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __elhView: () => unknown }).__elhView = () => {
      const content = document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: unknown } };
      };
      return content.cmTile.root.view;
    };
  });
}

async function openDoc(
  page: Page,
  doc: string,
  options: { name?: string; lineNumbers?: boolean; ready?: string } = {},
): Promise<void> {
  const name = options.name ?? "stability.md";
  await stubTauri(page, {
    entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { [name]: doc },
    config: options.lineNumbers === false ? {} : { line_numbers: "on" },
  });
  await installViewHook(page);
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
  await expect(page.locator(".cm-content")).toBeAttached();
  await expect(page.locator(".cm-content")).toContainText(options.ready ?? doc.split("\n")[0]);
  await page.waitForTimeout(200);
}

function docText(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __elhView: () => ViewHandle }).__elhView().state.doc.toString());
}

async function setCaret(page: Page, pos: number, scroll = false): Promise<void> {
  await page.evaluate(
    ([p, doScroll]) => {
      const view = (window as unknown as { __elhView: () => ViewHandle }).__elhView();
      view.focus();
      view.dispatch({ selection: { anchor: p }, ...(doScroll ? { scrollIntoView: true } : {}) });
    },
    [pos, scroll] as const,
  );
  await page.waitForTimeout(120);
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate((selector) => {
    const view = (window as unknown as { __elhView: () => ViewHandle }).__elhView();
    const content = document.querySelector(selector) as HTMLElement;
    const contentTop = content.getBoundingClientRect().top;
    const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
    const lines = [...document.querySelectorAll<HTMLElement>(`${selector} .cm-line`)].map((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const pos = view.posAtDOM(el, 0);
      const block = view.lineBlockAt(pos);
      return {
        text: el.textContent ?? "",
        top: rect.top - contentTop,
        height: rect.height,
        paddingTop: Number.parseFloat(style.paddingTop) || 0,
        paddingBottom: Number.parseFloat(style.paddingBottom) || 0,
        blockTop: block.top,
        blockHeight: block.height,
      };
    });
    const end = document.querySelector<HTMLElement>(".cm-lp-end-marker");
    const endRect = end ? end.getBoundingClientRect() : null;
    const gutter = document.querySelector<HTMLElement>(".cm-activeLineGutter");
    return {
      lines,
      contentHeight: view.contentHeight,
      endTop: endRect ? endRect.top - contentTop : null,
      endBottom: endRect ? endRect.bottom - contentTop : null,
      activeGutter: gutter ? { text: gutter.textContent ?? "", height: gutter.getBoundingClientRect().height } : null,
      lineHeight,
    };
  }, viewExpr());
}

/** 行盒 / top / END 逐项变化 ≤1px（浮点布局的取整容差）。
 *  文本变化由调用方用文档文本单独断言——落字的那一行文本必然变（空行→有字），
 *  本函数只判「几何」，不把「内容变了」误判成几何回归。 */
function expectStable(before: Snapshot, after: Snapshot, label: string): void {
  expect(after.lines.length, `${label}：可见行数不得变化`).toBe(before.lines.length);
  for (let i = 0; i < before.lines.length; i++) {
    const b = before.lines[i];
    const a = after.lines[i];
    expect(Math.abs(a.height - b.height), `${label}：第 ${i + 1} 行行盒 ${b.height} → ${a.height}`).toBeLessThanOrEqual(1);
    expect(Math.abs(a.top - b.top), `${label}：第 ${i + 1} 行 top ${b.top} → ${a.top}`).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(after.contentHeight - before.contentHeight), `${label}：文档总高 ${before.contentHeight} → ${after.contentHeight}`).toBeLessThanOrEqual(1);
  if (before.endTop !== null || after.endTop !== null) {
    expect(before.endTop, `${label}：END 标记必须在两态都在场（读不到 ≠ 通过）`).not.toBeNull();
    expect(after.endTop, `${label}：END 标记必须在两态都在场（读不到 ≠ 通过）`).not.toBeNull();
    expect(Math.abs(after.endTop! - before.endTop!), `${label}：END top ${before.endTop} → ${after.endTop}`).toBeLessThanOrEqual(1);
  }
}

function expectLocalPadding(snap: Snapshot, label: string): void {
  for (const line of snap.lines) {
    expect(line.paddingTop, `${label}：${JSON.stringify(line.text)} 的 padding-top 必须为 0`).toBe(0);
    expect(line.paddingBottom, `${label}：${JSON.stringify(line.text)} 的 padding-bottom 必须为 0`).toBe(0);
    expect(
      Math.abs(line.height - snap.lineHeight),
      `${label}：${JSON.stringify(line.text)} 的行盒 ${line.height} 必须等于正常行高 ${snap.lineHeight}（±1px）`,
    ).toBeLessThanOrEqual(1);
  }
}

/** 键入并等文档终态。缺省判「追加在文档末尾」；中间插入用 expected 给逐字终态。 */
async function typeChar(page: Page, text: string, expected?: string): Promise<void> {
  const before = await docText(page);
  await page.keyboard.type(text);
  const target = expected ?? `${before}${text}`;
  await expect.poll(() => docText(page), { timeout: 3000 }).toBe(target);
  await page.waitForTimeout(120);
}

const LONG_DOC = `${Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 段正文，用于撑满一屏。`).join("\n")}\n`;

// ---------------------------------------------------------------------------
// 1. 普通行局部性：正文与空行的纵向 padding 恒 0，行盒 = 计算行高
// ---------------------------------------------------------------------------

test.describe("普通行局部性（DOM 层）", () => {
  for (const doc of [
    { name: "单行正文（文档末行）", text: "只有一行正文。" },
    { name: "两行正文（无空行）", text: "第一段正文。\n第二段正文。" },
    { name: "段落 + 单个空行", text: "第一段正文。\n\n第二段正文。" },
    { name: "段落 + 两个空行", text: "第一段正文。\n\n\n第二段正文。" },
    { name: "文档末尾空行", text: "第一段正文。\n\n" },
    { name: "纯空行文档", text: "\n\n\n" },
  ]) {
    test(`${doc.name}：每一行 padding 恒 0、行盒 = 正常行高`, async ({ page }) => {
      await openDoc(page, doc.text);
      const snap = await snapshot(page);
      expect(snap.lines.length, "fixture 必须真的渲染出行").toBeGreaterThan(0);
      expectLocalPadding(snap, doc.name);
    });
  }

  test("对照：标题阶梯与列表 2px 仍是块自身的间距（归零只作用于普通行）", async ({ page }) => {
    await openDoc(page, "正文行。\n## 标题\n- 列表项");
    const snap = await snapshot(page);
    const heading = snap.lines.find((line) => line.text.includes("标题"));
    const item = snap.lines.find((line) => line.text.includes("列表项"));
    const body = snap.lines.find((line) => line.text.includes("正文行"));
    expect(body, "正文行必须在场").toBeTruthy();
    expect(heading, "标题行必须在场").toBeTruthy();
    expect(item, "列表项必须在场").toBeTruthy();
    expect(body!.paddingBottom, "正文行下距归零").toBe(0);
    expect(heading!.paddingTop, "H2 上距保留 20px").toBe(20);
    expect(heading!.paddingBottom, "H2 下距保留 6px").toBe(6);
    expect(item!.paddingTop, "列表项上距保留 2px").toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 2. 文档末尾空行输入首字：行盒 / active gutter / END 逐项稳定
// ---------------------------------------------------------------------------

test("文档末尾空行输入首字：全部行盒、active gutter、END 与总高逐项稳定 ≤1px", async ({ page }) => {
  await openDoc(page, LONG_DOC);
  await expect(page.locator(".cm-lp-end-marker"), "长文必须让 END 标记在场（否则末行稳定性没有观测面）").toHaveCount(1);
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await setCaret(page, LONG_DOC.length, true);
  const before = await snapshot(page);
  expect(before.endTop, "滚动到底后 END 标记必须可读（读不到 ≠ 通过）").not.toBeNull();
  expect(before.activeGutter, "行号 gutter 在场（line_numbers=on）").not.toBeNull();
  const caretLine = await page.evaluate(() => {
    const view = (window as unknown as { __elhView: () => ViewHandle }).__elhView();
    const head = view.state.selection.main.head;
    const block = view.lineBlockAt(head);
    return { top: block.top, height: block.height, coords: view.coordsAtPos(head) };
  });
  expect(caretLine.coords, "光标位置必须有坐标（读不到 ≠ 通过）").not.toBeNull();
  expect(
    Math.abs(before.activeGutter!.height - caretLine.height),
    `active gutter 高 ${before.activeGutter!.height} 必须等于光标行行高 ${caretLine.height}（±1px）`,
  ).toBeLessThanOrEqual(1);

  await typeChar(page, "x");
  const after = await snapshot(page);
  expectStable(before, after, "末尾空行输入首字");
  expect(after.activeGutter, "行号 gutter 仍在场").not.toBeNull();
  const caretLineAfter = await page.evaluate(() => {
    const view = (window as unknown as { __elhView: () => ViewHandle }).__elhView();
    const head = view.state.selection.main.head;
    const block = view.lineBlockAt(head);
    return { top: block.top, height: block.height };
  });
  expect(Math.abs(caretLineAfter.top - caretLine.top), `光标行 top ${caretLine.top} → ${caretLineAfter.top}`).toBeLessThanOrEqual(1);
  expect(
    Math.abs(after.activeGutter!.height - caretLineAfter.height),
    `输入后 active gutter 高 ${after.activeGutter!.height} 必须等于光标行行高 ${caretLineAfter.height}（±1px）`,
  ).toBeLessThanOrEqual(1);
});

test("`a\\n` → `a\\nx`：前行不得失去下距、编辑行不得获得下距，文档总高不变", async ({ page }) => {
  const doc = "尾段正文。\n";
  await openDoc(page, doc);
  await setCaret(page, doc.length);
  const before = await snapshot(page);
  expect(before.lines.length, "两行（正文 + 末尾空行）").toBe(2);
  expectLocalPadding(before, "输入前");
  await typeChar(page, "x");
  const after = await snapshot(page);
  expect(after.lines.length).toBe(2);
  expectStable(before, after, "`a\\n` → `a\\nx`");
  expectLocalPadding(after, "输入后");

  // 反向迁移（scenario「非语义迁移不改变未编辑行」）：删掉刚落下的字符，文档与几何都回到起点。
  await page.keyboard.press("Backspace");
  await expect.poll(() => docText(page)).toBe(doc);
  await page.waitForTimeout(150);
  const restored = await snapshot(page);
  expectLocalPadding(restored, "回退后");
  expectStable(before, restored, "`a\\nx` → `a\\n`");
});

// ---------------------------------------------------------------------------
// 3. 57 行同族：中段空行落字，全篇行盒与各行 top 稳定
// ---------------------------------------------------------------------------

test("57 行同族：中段空行落字后，可见行的行盒 / top / 总高全部稳定", async ({ page }) => {
  const lines = Array.from({ length: 57 }, (_, index) => {
    if (index % 2 === 0) return `第 ${index / 2 + 1} 段正文。`;
    return "";
  });
  const doc = lines.join("\n");
  await openDoc(page, doc, { ready: "第 1 段正文。" });
  const text = await page.evaluate(() => (window as unknown as { __elhView: () => ViewHandle }).__elhView().state.doc);
  const targetLine = 14;
  const blank = await page.evaluate((n) => {
    const view = (window as unknown as { __elhView: () => ViewHandle }).__elhView();
    const line = view.state.doc.line(n);
    return { from: line.from, to: line.to };
  }, targetLine);
  expect(blank.from, "第 14 行必须是空行").toBe(blank.to);
  await setCaret(page, blank.from, true);
  const before = await snapshot(page);
  expect(before.lines.some((line) => line.text === ""), "视口里必须有空行参与对照").toBe(true);
  expectLocalPadding(before, "57 行输入前");
  const expectedDoc = lines.map((line, index) => (index === targetLine - 1 ? "x" : line)).join("\n");
  await typeChar(page, "x", expectedDoc);
  const after = await snapshot(page);
  expectStable(before, after, "57 行同族中段空行落字");
  expectLocalPadding(after, "57 行输入后");
});

// ---------------------------------------------------------------------------
// 4. heading ↔ text：语义 reflow 有界
// ---------------------------------------------------------------------------

test("heading→text：块外前行行盒不变，后行位移等于标题行高度差", async ({ page }) => {
  const doc = "正文行。\n## 标题\n尾行。";
  await openDoc(page, doc, { ready: "正文行。" });
  const headingStart = doc.indexOf("## ");
  await setCaret(page, headingStart);
  const before = await snapshot(page);
  const lineBefore = before.lines.find((line) => line.text.includes("正文行"));
  const tailBefore = before.lines.find((line) => line.text.includes("尾行"));
  const headingBefore = before.lines.find((line) => line.text.includes("标题"));
  expect(lineBefore && tailBefore && headingBefore, "三行都必须可见").toBeTruthy();

  for (let i = 0; i < 3; i++) await page.keyboard.press("Delete");
  await expect.poll(() => docText(page)).toBe("正文行。\n标题\n尾行。");
  await page.waitForTimeout(150);
  const after = await snapshot(page);
  const lineAfter = after.lines.find((line) => line.text.includes("正文行"));
  const tailAfter = after.lines.find((line) => line.text.includes("尾行"));
  const headingAfter = after.lines.find((line) => line.text.includes("标题"));
  expect(lineAfter && tailAfter && headingAfter, "三行都必须仍可见").toBeTruthy();

  expect(
    Math.abs(lineAfter!.height - lineBefore!.height),
    `块外前行高度 ${lineBefore!.height} → ${lineAfter!.height} 必须不变（旧模型在这里 −8px）`,
  ).toBeLessThanOrEqual(1);
  expect(headingAfter!.height, "标题语义必须真的消失（区分度）").toBeLessThan(headingBefore!.height - 1);
  const heightDelta = headingBefore!.height - headingAfter!.height;
  expect(
    Math.abs((tailAfter!.top - tailBefore!.top) + heightDelta),
    `后行位移 ${tailAfter!.top - tailBefore!.top} 必须等于获批高度差 ${-heightDelta}（±1px）`,
  ).toBeLessThanOrEqual(1);
});

test("text→heading：块外前行行盒不变，后行位移等于标题行高度差", async ({ page }) => {
  const doc = "正文行。\n标题\n尾行。";
  await openDoc(page, doc, { ready: "正文行。" });
  await setCaret(page, doc.indexOf("标题"));
  const before = await snapshot(page);
  const lineBefore = before.lines.find((line) => line.text.includes("正文行"));
  const tailBefore = before.lines.find((line) => line.text.includes("尾行"));
  const headingBefore = before.lines.find((line) => line.text === "标题");
  expect(lineBefore && tailBefore && headingBefore, "三行都必须可见").toBeTruthy();

  await page.keyboard.type("## ");
  await expect.poll(() => docText(page)).toBe("正文行。\n## 标题\n尾行。");
  await page.waitForTimeout(150);
  const after = await snapshot(page);
  const lineAfter = after.lines.find((line) => line.text.includes("正文行"));
  const tailAfter = after.lines.find((line) => line.text.includes("尾行"));
  const headingAfter = after.lines.find((line) => line.text.includes("标题"));
  expect(lineAfter && tailAfter && headingAfter, "三行都必须仍可见").toBeTruthy();

  expect(
    Math.abs(lineAfter!.height - lineBefore!.height),
    `块外前行高度 ${lineBefore!.height} → ${lineAfter!.height} 必须不变（旧模型在这里 +8px）`,
  ).toBeLessThanOrEqual(1);
  expect(headingAfter!.height, "标题语义必须真的成立（区分度）").toBeGreaterThan(headingBefore!.height + 1);
  const heightDelta = headingAfter!.height - headingBefore!.height;
  expect(
    Math.abs(tailAfter!.top - tailBefore!.top - heightDelta),
    `后行位移 ${tailAfter!.top - tailBefore!.top} 必须等于获批高度差 ${heightDelta}（±1px）`,
  ).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// 5. Enter 拆分 / Backspace 合并：高度差只是自然行数变化
// ---------------------------------------------------------------------------

test("Enter 拆分 / Backspace 合并：行盒差只是自然行数变化，不引入段距", async ({ page }) => {
  const doc = "正文一行";
  await openDoc(page, doc);
  await setCaret(page, 2);
  const before = await snapshot(page);
  expect(before.lines.length).toBe(1);
  expectLocalPadding(before, "单行");

  await page.keyboard.press("Enter");
  await expect.poll(() => docText(page)).toBe("正文\n一行");
  await page.waitForTimeout(150);
  const split = await snapshot(page);
  expect(split.lines.length, "拆分成两行").toBe(2);
  expectLocalPadding(split, "拆分后");
  expect(
    Math.abs(split.contentHeight - before.contentHeight - split.lineHeight),
    `拆分后总高增量 ${split.contentHeight - before.contentHeight} 必须等于一行自然行高 ${split.lineHeight}（±1px）`,
  ).toBeLessThanOrEqual(1);

  await page.keyboard.press("Backspace");
  await expect.poll(() => docText(page)).toBe(doc);
  await page.waitForTimeout(150);
  const merged = await snapshot(page);
  expect(merged.lines.length, "合并回一行").toBe(1);
  expectLocalPadding(merged, "合并后");
  expect(Math.abs(merged.contentHeight - before.contentHeight), "合并后总高回到起点").toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// 6. DOM ↔ CM heightmap ↔ gutter 对账 + 滚出滚回
// ---------------------------------------------------------------------------

test("DOM ↔ CM heightmap ↔ active gutter 对账，滚出视口再滚回同值", async ({ page }) => {
  const doc = `${Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 段正文。`).join("\n\n")}\n\n`;
  await openDoc(page, doc, { ready: "第 1 段正文。" });
  const check = async (label: string): Promise<Snapshot> => {
    const snap = await snapshot(page);
    expect(snap.lines.length, `${label}：必须有可见行`).toBeGreaterThan(0);
    for (let i = 0; i < snap.lines.length; i++) {
      const line = snap.lines[i];
      expect(
        Math.abs(line.height - line.blockHeight),
        `${label}：DOM 行盒 ${line.height} 与 CM heightmap ${line.blockHeight} 必须一致（${JSON.stringify(line.text)}，±1px）`,
      ).toBeLessThanOrEqual(1);
      if (i > 0) {
        const prev = snap.lines[i - 1];
        expect(
          Math.abs(line.top - prev.top - (line.blockTop - prev.blockTop)),
          `${label}：第 ${i + 1} 行 DOM 位移与 heightmap 位移必须一致（±1px）`,
        ).toBeLessThanOrEqual(1);
      }
    }
    return snap;
  };

  await page.evaluate(() => {
    const view = (window as unknown as { __elhView: () => ViewHandle }).__elhView();
    view.focus();
  });
  // 空行：active gutter 高 == 该行行盒
  const blankPos = await page.evaluate(() => (window as unknown as { __elhView: () => ViewHandle }).__elhView().state.doc.line(2).from);
  await setCaret(page, blankPos);
  const onBlank = await snapshot(page);
  const blankLine = onBlank.lines.find((line) => line.text === "");
  expect(blankLine, "光标在空行上").toBeTruthy();
  expect(onBlank.activeGutter, "空行上必须读到 active gutter（读不到 ≠ 通过）").not.toBeNull();
  expect(
    Math.abs(onBlank.activeGutter!.height - blankLine!.height),
    `空行 active gutter 高 ${onBlank.activeGutter!.height} 必须等于行盒 ${blankLine!.height}（±1px）`,
  ).toBeLessThanOrEqual(1);

  // 有字行：active gutter 高 == 该行行盒
  const textPos = await page.evaluate(() => (window as unknown as { __elhView: () => ViewHandle }).__elhView().state.doc.line(3).from);
  await setCaret(page, textPos);
  const onText = await snapshot(page);
  const textLine = onText.lines.find((line) => line.text.startsWith("第 2 段"));
  expect(textLine, "光标在正文行上").toBeTruthy();
  expect(onText.activeGutter, "正文行上必须读到 active gutter").not.toBeNull();
  expect(
    Math.abs(onText.activeGutter!.height - textLine!.height),
    `正文行 active gutter 高 ${onText.activeGutter!.height} 必须等于行盒 ${textLine!.height}（±1px）`,
  ).toBeLessThanOrEqual(1);

  const first = await check("首屏");
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(200);
  await check("滚到底");
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  await setCaret(page, textPos);
  const back = await check("滚回顶部");
  expect(Math.abs(back.contentHeight - first.contentHeight), "滚出再滚回后文档总高不变").toBeLessThanOrEqual(1);
  expectLocalPadding(back, "滚回顶部");
});

test("滚出视口再滚回后在末尾空行输入：仍逐项稳定", async ({ page }) => {
  await openDoc(page, LONG_DOC);
  await setCaret(page, LONG_DOC.length, true);
  const before = await snapshot(page);
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(200);
  await setCaret(page, LONG_DOC.length, true);
  const back = await snapshot(page);
  expectStable(before, back, "滚出滚回");
  await typeChar(page, "y");
  const after = await snapshot(page);
  expectStable(back, after, "滚出滚回后输入首字");
});

// ---------------------------------------------------------------------------
// 7. selection / focus 不是几何输入
// ---------------------------------------------------------------------------

test("selection 与 focus 变化不改变行盒与行高", async ({ page }) => {
  const doc = "第一段。\n\n第二段。\n\n第三段。";
  await openDoc(page, doc, { ready: "第一段。" });
  const before = await snapshot(page);
  await page.evaluate(() => {
    const view = (window as unknown as { __elhView: () => ViewHandle }).__elhView();
    view.focus();
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  });
  await page.waitForTimeout(150);
  const selected = await snapshot(page);
  expectStable(before, selected, "全选");
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    active?.blur();
  });
  await page.waitForTimeout(150);
  const blurred = await snapshot(page);
  expectStable(before, blurred, "失焦");
});

// ---------------------------------------------------------------------------
// 8. IME：组合与提交都不给其他行补 8px（Chromium 的 CDP 真引擎路径）
// ---------------------------------------------------------------------------

test("IME 组合与提交：组合期与 settled 后行盒全部稳定", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP Input.imeSetComposition 只存在于 Chromium；真机 WKWebView 由验收场景覆盖");
  const doc = "第一段正文。\n\n";
  await openDoc(page, doc);
  await setCaret(page, doc.length);
  const before = await snapshot(page);
  expectLocalPadding(before, "IME 组合前");
  const cdp = await page.context().newCDPSession(page);
  const compose = async (text: string) =>
    cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
  await compose("拼");
  await expect.poll(() => docText(page)).toBe(`${doc}拼`);
  await page.waitForTimeout(120);
  const composing = await snapshot(page);
  expectStable(before, composing, "IME 组合期");
  await cdp.send("Input.insertText", { text: "拼音" });
  await expect.poll(() => docText(page)).toBe(`${doc}拼音`);
  await page.waitForTimeout(200);
  const settled = await snapshot(page);
  expectStable(before, settled, "IME 提交后");
  expectLocalPadding(settled, "IME 提交后");
});
