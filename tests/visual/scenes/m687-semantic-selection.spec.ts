import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M687（change semantic-selection-markdown-oct23）：指针选区的语法包裹外扩（release-snap）的
// 结构层判据。纯函数判定归 tests/unit/syntax-envelope.test.ts；这里守的是**接线与绘制**：
//   ① 松开前：选区只覆盖渲染文字、定界符仍隐藏（按压窗口没提前解冻）；
//   ② 松开的同一拍：选区扩到节点范围，上屏的定界符带选中底色（M285 口径）；
//   ③ 部分覆盖不外扩（同 fixture 的完整覆盖作对照，REVIEW.md「断言等价于子串」条）；
//   ④ 双击同规则、三击是空操作；
//   ⑤ 文档逐字节不变、滚动位置不变（ADR 0003 §3）。
//
// 为什么「同一帧」不在这里判：装饰重建次数由实现期探针钉住（`buildDecorations` 计数 = 1，
// 读数 .local/probes/m687-semantic-release-snap/）。Playwright 的往返落在下一个任务里，看不到
// 单帧中间态；在这里造「中间态断言」只会是空断言。
//
// 真机（WKWebView）的拖选通道造不出编辑器选区（scripts/acceptance/README.md「已知边界」），
// 拖选路径的机器判据只在这一层；真机场景 233 判双击 → 摘录 → composer 含 `**…**`。

const DOC = [
  "## 标题语义验收",
  "",
  "段落里有 **粗体词** 与 *斜体* 与 ~~删除~~ 三种范围。",
  "",
  "末尾段。",
  "",
].join("\n");

const HEADING_RAW = "## 标题语义验收";

interface ViewLike {
  state: {
    readOnly: boolean;
    doc: { length: number; toString(): string; sliceString(from: number, to: number): string };
    selection: { main: { from: number; to: number; anchor: number; head: number; empty: boolean } };
  };
  contentDOM: HTMLElement;
  coordsAtPos(pos: number): { left: number; right: number; top: number; bottom: number } | null;
  dispatch(spec: unknown): void;
  focus(): void;
  scrollDOM: { scrollTop: number };
}

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "e.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "e.md": DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="e.md"]').click();
  await expect(page.locator(".cm-lp-strong").first()).toBeVisible();
  // 打开时光标在文档首（M297 会把第一行标题显露成源码）——挪到末尾回到渲染态。
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewLike } } })
      .cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await expect(page.locator(".cm-line").first()).not.toContainText("## ");
}

/** 文档内 `raw` 的首次出现；找不到直接抛（fixture 坏了，不是产品行为）。 */
function offsetOf(needle: string, doc = DOC): { from: number; to: number } {
  const from = doc.indexOf(needle);
  if (from < 0) throw new Error(`fixture 里找不到 ${JSON.stringify(needle)}`);
  return { from, to: from + needle.length };
}

function selection(page: Page): Promise<{ anchor: number; head: number; empty: boolean; scrollTop: number }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewLike } } })
      .cmTile.root.view;
    const main = view.state.selection.main;
    return { anchor: main.anchor, head: main.head, empty: main.empty, scrollTop: view.scrollDOM.scrollTop };
  });
}

/** 某个文档位置的字符是否被 `.cm-selectionBackground` 的矩形覆盖（m285 的逐字符判据）。 */
function charactersCovered(page: Page, from: number, to: number): Promise<Array<{ pos: number; ch: string; covered: boolean; width: number }>> {
  return page.evaluate(([start, end]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewLike } } })
      .cmTile.root.view;
    const rects = [...document.querySelectorAll(".cm-selectionBackground")].map((el) => el.getBoundingClientRect());
    const inside = (x: number, y: number) => rects.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
    const out: Array<{ pos: number; ch: string; covered: boolean; width: number }> = [];
    for (let pos = start; pos < end; pos++) {
      const ch = view.state.doc.sliceString(pos, pos + 1);
      if (ch === "" || /\s/.test(ch)) continue;
      const a = view.coordsAtPos(pos);
      const b = view.coordsAtPos(pos + 1);
      if (!a || !b) continue;
      const x0 = Math.min(a.left, b.left);
      const x1 = Math.max(a.left, b.left);
      out.push({ pos, ch, covered: inside((x0 + x1) / 2, (a.top + a.bottom) / 2), width: x1 - x0 });
    }
    return out;
  }, [from, to] as const);
}

/** 渲染态文字的水平区间（用于把指针落在第一个字与最后一个字上）。 */
function textSpan(page: Page, from: number, to: number): Promise<{ x1: number; x2: number; y: number }> {
  return page.evaluate(([start, end]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewLike } } })
      .cmTile.root.view;
    const a = view.coordsAtPos(start);
    const b = view.coordsAtPos(end);
    if (!a || !b) throw new Error("范围不在视口内");
    return { x1: a.left + 1, x2: b.left - 1, y: a.top + (a.bottom - a.top) / 2 };
  }, [from, to] as const);
}

async function renderState(page: Page): Promise<string> {
  return (await page.locator(".cm-line").first().textContent()) ?? "";
}

test("拖选整段标题：松开前只覆盖渲染文字，松开后覆盖 `## ` 且定界符带选中底色", async ({ page }) => {
  await openDoc(page);
  const heading = offsetOf(HEADING_RAW);
  const visibleFrom = heading.from + 3;
  const span = await textSpan(page, visibleFrom, heading.to);

  await page.mouse.move(span.x1, span.y);
  await page.mouse.down();
  await page.mouse.move((span.x1 + span.x2) / 2, span.y, { steps: 3 });
  await page.mouse.move(span.x2, span.y, { steps: 3 });

  // ① 松开前：选区只覆盖渲染文字、`## ` 仍隐藏（按压窗口未解冻）。
  const before = await selection(page);
  expect(before.empty).toBe(false);
  expect(before.anchor).toBe(visibleFrom);
  expect(before.head).toBe(heading.to);
  await expect(page.locator(".cm-line").first()).not.toContainText("## ");
  expect(await readDocument(page)).toBe(DOC);

  await page.mouse.up();
  await page.waitForTimeout(80);

  // ② 松开后：选区扩到节点范围，源码上屏；上屏的每个字符（含 `##` 与空格）都有选中底色。
  const after = await selection(page);
  expect({ anchor: after.anchor, head: after.head }).toEqual({ anchor: heading.from, head: heading.to });
  expect(await renderState(page)).toBe(HEADING_RAW);
  expect(after.scrollTop).toBe(before.scrollTop);

  const covered = await charactersCovered(page, heading.from, heading.to);
  // 判据只覆盖非空白字符（空白没有可判的字形格）：标题节点里是 `##` + 22 个字母去掉 4 个空格 = 20。
  expect(covered.length, "标题节点内应读到全部非空白字符格").toBe(HEADING_RAW.replace(/\s/g, "").length);
  expect(covered.filter((c) => !c.covered), "节点内每个非空白字符都应带选中底色").toEqual([]);
  expect(covered.find((c) => c.pos === heading.from)?.ch, "首个 `#` 在选区里且被底色覆盖").toBe("#");
  expect(covered.find((c) => c.pos === heading.from + 1)?.ch).toBe("#");

  expect(await readDocument(page)).toBe(DOC);
});

test("拖选粗体全部文字：外扩到 `**…**`，两端定界符带选中底色", async ({ page }) => {
  await openDoc(page);
  const bold = offsetOf("**粗体词**");
  const strong = page.locator(".cm-lp-strong", { hasText: "粗体词" });
  const box = (await strong.boundingBox())!;
  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const after = await selection(page);
  expect({ anchor: after.anchor, head: after.head }).toEqual({ anchor: bold.from, head: bold.to });
  const covered = await charactersCovered(page, bold.from, bold.to);
  expect(covered.filter((c) => !c.covered)).toEqual([]);
  expect(covered.map((c) => c.ch).join("")).toBe("**粗体词**");
  expect(await readDocument(page)).toBe(DOC);
});

test("部分覆盖不外扩（同 fixture 的完整覆盖是正向对照）", async ({ page }) => {
  await openDoc(page);
  const heading = offsetOf(HEADING_RAW);
  const visibleFrom = heading.from + 3;
  const span = await textSpan(page, visibleFrom, heading.to - 1);

  await page.mouse.move(span.x1, span.y);
  await page.mouse.down();
  await page.mouse.move(span.x2, span.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(80);

  const after = await selection(page);
  expect(after.anchor).toBe(visibleFrom);
  expect(after.head).toBeLessThan(heading.to);
  // `## ` 因显露上屏、但不在选区内（这正是 D4 的「部分覆盖保持纯文本」形态）。
  expect(await renderState(page)).toBe(HEADING_RAW);
  const covered = await charactersCovered(page, heading.from, heading.from + 3);
  expect(covered.filter((c) => c.covered), "漏选的定界符不得被选中底色覆盖").toEqual([]);
  expect(await readDocument(page)).toBe(DOC);
});

test("双击粗体词外扩；三击保持整行源码（空操作）", async ({ page }) => {
  await openDoc(page);
  const bold = offsetOf("**粗体词**");
  const strong = page.locator(".cm-lp-strong", { hasText: "粗体词" });
  const box = (await strong.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(80);
  const dbl = await selection(page);
  expect({ anchor: dbl.anchor, head: dbl.head }).toEqual({ anchor: bold.from, head: bold.to });

  // 三击：CM 的 rangeForClick(3) 本来就给整行源码（含定界符）——外扩是空操作。
  const heading = offsetOf(HEADING_RAW);
  const headingSpan = await textSpan(page, heading.from + 3, heading.to);
  await page.mouse.click((headingSpan.x1 + headingSpan.x2) / 2, headingSpan.y, { clickCount: 3 });
  await page.waitForTimeout(80);
  const triple = await selection(page);
  expect(triple.anchor).toBe(0);
  expect(triple.head).toBeGreaterThanOrEqual(HEADING_RAW.length);
  expect(await readDocument(page)).toBe(DOC);
});

test("拖选/双击/三击全程文档逐字节不变、阅读位置不变", async ({ page }) => {
  await openDoc(page);
  const scrollBefore = (await selection(page)).scrollTop;
  const heading = offsetOf(HEADING_RAW);
  const span = await textSpan(page, heading.from + 3, heading.to);

  await page.mouse.move(span.x1, span.y);
  await page.mouse.down();
  await page.mouse.move(span.x2, span.y, { steps: 3 });
  expect(await readDocument(page), "按压期间文档不变").toBe(DOC);
  await page.mouse.up();
  await page.waitForTimeout(80);
  expect(await readDocument(page), "松开后文档不变").toBe(DOC);
  expect((await selection(page)).scrollTop, "阅读位置不变").toBe(scrollBefore);
});

test("程序化 / 键盘选区不被隐式外扩（外扩只挂在指针 mouseup 上）", async ({ page }) => {
  await openDoc(page);
  const bold = offsetOf("**粗体词**");
  // delta 的「键盘与程序化选区不被隐式外扩」结构层对照组：程序化把选区设成粗体词的渲染范围，
  // 不经过任何指针事件。键盘路径（shift+方向键）在装配上走同一处——规则只挂 mouseup。
  await page.evaluate(([from, to]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewLike } } })
      .cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: from, head: to } });
  }, [bold.from + 2, bold.to - 2] as const);
  await page.waitForTimeout(80);
  const after = await selection(page);
  expect({ anchor: after.anchor, head: after.head }, "程序化选区保持原范围").toEqual({
    anchor: bold.from + 2,
    head: bold.to - 2,
  });
  expect(await readDocument(page)).toBe(DOC);
});


// ---------------------------------------------------------------------------
// 只读面：vault 外只读 md 会话（state.readOnly）的 mouseup 不外扩
// ---------------------------------------------------------------------------

const EXTERNAL_PATH = "/tmp/lumir-verify/semantic-readonly.md";
const EXTERNAL_DOC = "## 只读语义验收\n\n**粗体词** 是外部只读文档里的加粗短语。\n";

test("只读 md（vault 外会话）的 mouseup 不外扩：选区保持渲染文字、定界符只显露不入选", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "e.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "e.md": DOC },
    externalFiles: { [EXTERNAL_PATH]: EXTERNAL_DOC },
  });
  await page.goto("/");
  // 先开一个 vault 内文件建立文档焦点（quick-open.spec 同款前置——页面刚加载时 ⌘P 的
  // 分发焦点不稳定，且这里本来就要有编辑器在场才能对照「可编辑场景外扩」）。
  await page.locator('.ft-row[title="e.md"]').click();
  await expect(page.locator(".cm-lp-strong").first()).toBeVisible();

  // 走真实入口打开 vault 外文件：⌘P → 绝对路径 → Enter（quick-open 的只读通道）。
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
  await page.keyboard.type(EXTERNAL_PATH);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-qo")).toBeHidden();
  await expect(page.locator(".modeline-meta")).toContainText("vault 外 · 只读");

  // 前置：这确实是只读编辑器（readOnly facet + contenteditable 都关），否则下面的「不外扩」
  // 可能只是没走到被测路径（REVIEW.md「读不到当成空」条同族）。
  const readonly = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewLike } } })
      .cmTile.root.view;
    return {
      stateReadOnly: view.state.readOnly === true,
      contentEditable: view.contentDOM.getAttribute("contenteditable"),
    };
  });
  expect(readonly).toEqual({ stateReadOnly: true, contentEditable: "false" });

  // 光标挪到文档末尾（回到渲染态），再拖选粗体词的全部渲染文字。
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: ViewLike } } })
      .cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  const bold = offsetOf("**粗体词**", EXTERNAL_DOC);
  const box = (await page.locator(".cm-lp-strong", { hasText: "粗体词" }).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, y, { steps: 4 });
  const before = await selection(page);
  expect(before.empty, "只读编辑器里指针拖选仍建立选区（只读拒收的是文档改动，不是选区）").toBe(false);
  expect({ anchor: before.anchor, head: before.head }).toEqual({ anchor: bold.from + 2, head: bold.to - 2 });

  await page.mouse.up();
  await page.waitForTimeout(80);
  const after = await selection(page);
  // 只读门控：同一手势在可编辑场景里会扩到 [bold.from, bold.to)，这里必须原样。
  expect({ anchor: after.anchor, head: after.head }, "只读会话 MUST NOT 外扩").toEqual({
    anchor: bold.from + 2,
    head: bold.to - 2,
  });
  // 按压窗口仍由 reveal-gate 的 window 层正常关闭：定界符上屏（M168），只是没进选区。
  await expect(page.locator(".cm-line", { hasText: "粗体词" })).toContainText("**粗体词**");
  expect(await readDocument(page)).toBe(EXTERNAL_DOC);
});
