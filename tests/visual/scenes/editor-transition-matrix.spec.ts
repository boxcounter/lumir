// tests/visual/scenes/editor-transition-matrix.spec.ts —— 编辑状态迁移矩阵的真引擎执行层
//（change add-editor-transition-oracle-nov27）。
//
// 为什么在真引擎层：`src/editor.ts` 的 import 图带 TypeScript 参数属性，Node 的类型剥离层加载
// 不了（既有约束，见 `src/cell-geometry.ts` 文件头），原生编辑闸门 `absorbNativeEdit` 只能在
// 真 `EditorView` 上驱动。矩阵的**定义与期望值**全部来自 `tests/unit/editor-transition-matrix.ts`
// 与 `tests/unit/editing-oracle-model.ts`（不 import 生产代码）；本文件只当适配器。
//
// 每格的动作前**先断言上下文的 replace 装饰在场**：没有装饰的格对 DOM 回写类缺陷没有区分度，
// 装饰缺席一律 FAIL（REVIEW.md「断言等价于子串」条的教训）。纯文本格是对照组——目标行不得
// 出现任何 replace 装饰。
//
// 复位：打开文档时捕获 `view.__pristine = view.state`（此时历史栈为空），每格
// `view.setState(__pristine)` 复位。因此「一次 undo = 一个动作」不需要时间屏障：每格的历史栈
// 从空开始，动作是第一条事件。`view.dispatch({})` 让应用的 updateListener 把会话 state 回写
// （`setState` 不触发它）。
//
// 保存载荷：动作改变了源码时按 ⌘S 并断言落盘全文等于 `EditorState.doc`；源码没变的格不按 ⌘S
// （干净文档的保存是空操作），改断言落盘内容没有被新写。读回时用「盘上内容 ?? fixture 原文」
// ——刚打开还没写过时桩里没有 `__fileText` 记录。
//
// 不可行组合（N/A）及理由在矩阵定义里，本文件不为它们写 skip：缺格由 Node 覆盖契约判红。
//
// 引擎：**只登记 chromium**。Playwright WebKit（真机同款 UA）下本文件的复位技术
// （`view.setState(pristine)` 逐格复位）不可靠：同一文档、同一 caret，不做 setState 时 Enter
// 的落点与模型一致；做了 setState 之后再按 Enter 会多出一个空行且不续行
//（2026-11-27 探针：`intro\n1. item\n2. second` + Enter 在 WebKit 上分别为
// `…\n2. \n3. second` 与 `…\n2. \n3. \n4. second`）。差异来自复位手法，不是产品行为，
// 因此矩阵只跑 chromium；WebKit 的 DOM 回写形状仍由 `editing-oracle` /
// `markdown-editing-stability` / `text-clipboard-adversarial` 的双引擎场景与验收套件覆盖。

import { expect, test, type Page } from "@playwright/test";
import { configApplied, fileText, stubTauri, type VaultFixture } from "./tauri-stub";
import {
  TransitionOracle,
  changedLineRange,
  describeEditAction,
} from "../../unit/editing-oracle-model";
import type { EditContext, TransitionExpectation } from "../../unit/editing-oracle-model";
import { FIXTURES, buildMatrix } from "../../unit/editor-transition-matrix";
import type { ContextFixture, MatrixCase, MatrixCell } from "../../unit/editor-transition-matrix";

const MATRIX = buildMatrix();
const PATH = "transition-oracle.md";
/** 只在渲染层出现的字形：marker glyph / 链接尾标 / 块级公式的求和号。 */
const RENDER_ONLY_GLYPHS = ["–", "◦", "→", "∑"] as const;
const REPLACE_SELECTORS = [".cm-lp-wikilink", ".cm-lp-list-marker", ".cm-lp-table-cell", ".cm-lp-math-block"] as const;

interface Reading {
  doc: string;
  anchor: number;
  head: number;
  readOnly: boolean;
  composing: boolean;
}

interface SetupSelection {
  caret?: number;
  anchor?: number;
  head?: number;
}

function vaultWith(text: string): VaultFixture {
  return {
    entries: [{ path: PATH, kind: "file", size: text.length, mtime_ms: 0 }],
    files: { [PATH]: text },
    links: {},
  };
}

async function openDoc(page: Page, fixture: ContextFixture): Promise<void> {
  await stubTauri(page, vaultWith(fixture.doc));
  await page.goto("/");
  await page.locator(`.ft-row[title="${PATH}"]`).click();
  await expect(page.locator(".modeline-path")).toContainText(PATH);
  // `__pristine` 必须在 live preview 落地**之后**捕获：modeline 一出现只代表会话装载，
  // mode 扩展（live preview 装饰）可能还在下一拍重配；提前捕获会让每格复位回一个没有
  // 装饰层的 state，装饰在场断言因此恒红（这不是产品缺陷，是适配器抓早了）。
  if (fixture.widget === null) {
    await expect(page.locator(".cm-line").first()).toHaveClass(/cm-lp-paragraph/);
  } else {
    await expect
      .poll(async () => (await contextDecoration(page, fixture)).count, { timeout: 5000 })
      .toBeGreaterThanOrEqual(fixture.widgetMin);
  }
  await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: { state: unknown } } } }).cmTile.root.view;
    (view as unknown as { __pristine: unknown }).__pristine = view.state;
  });
}

async function read(page: Page): Promise<Reading> {
  return page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: { state: { doc: { toString(): string }; selection: { main: { anchor: number; head: number } }; readOnly: boolean }; compositionStarted: boolean } } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return {
      doc: view.state.doc.toString(),
      anchor: main.anchor,
      head: main.head,
      readOnly: view.state.readOnly,
      composing: view.compositionStarted,
    };
  });
}

/** 复位到打开时的空历史 state，并设置动作前的选区。 */
async function resetCell(page: Page, selection: SetupSelection): Promise<void> {
  await page.locator(".cm-content").evaluate((el, sel) => {
    const view = (el as unknown as { cmTile: { root: { view: { setState(state: unknown): void; dispatch(spec: unknown): void; focus(): void; state: unknown; __pristine: unknown } } } }).cmTile.root.view;
    // 上一格可能是 composing：CM 在 `inputState.composing >= 0` 时冻结 DOM（装饰不重建）。
    // 复位前补一次 compositionend，把组合态清掉——这是测试装置收尾，不是产品行为。
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    view.setState(view.__pristine);
    view.dispatch({});
    view.focus();
    view.dispatch({ selection: { anchor: sel.anchor ?? sel.caret ?? 0, head: sel.head ?? sel.anchor ?? sel.caret ?? 0 } });
  }, selection);
}

/** 上下文装饰在场断言（区分度前提）：返回读数供失败信息使用。 */
async function contextDecoration(page: Page, fixture: ContextFixture): Promise<{ count: number; lineText: string | null; anchor: number; focus: boolean; lines: string }> {
  return page.locator(".cm-content").evaluate((el, spec) => {
    const lines = [...el.querySelectorAll<HTMLElement>(".cm-line")];
    const line = lines[spec.targetLine - 1] ?? null;
    const scope: HTMLElement | null = spec.blockWidget ? (el as HTMLElement) : line;
    const selectors = spec.widget === null ? spec.all : [spec.widget];
    let count = 0;
    for (const selector of selectors) count += scope === null ? 0 : scope.querySelectorAll(selector).length;
    const view = (el as unknown as { cmTile: { root: { view: { state: { selection: { main: { anchor: number; head: number } } }; hasFocus: boolean } } } }).cmTile.root.view;
    return {
      count,
      lineText: line?.textContent ?? null,
      anchor: view.state.selection.main.anchor,
      focus: view.hasFocus,
      lines: lines.map((item) => `${item.textContent}|${item.querySelectorAll(".cm-lp-list-marker").length}`).join(" ~ "),
    };
  }, {
    targetLine: fixture.targetLine,
    blockWidget: fixture.blockWidget === true,
    widget: fixture.widget,
    all: [...REPLACE_SELECTORS],
  });
}

/** 装饰重建在 `setState` / 选区事务之后是异步的（下一次绘制帧）；读两拍一致再断言。 */
async function settledContextDecoration(page: Page, fixture: ContextFixture): Promise<{ count: number; lineText: string | null; anchor: number; focus: boolean; lines: string }> {
  let previous = await contextDecoration(page, fixture);
  for (let index = 0; index < 40; index += 1) {
    await page.waitForTimeout(16);
    const next = await contextDecoration(page, fixture);
    if (next.count === previous.count && next.lineText === previous.lineText && next.anchor === previous.anchor) return next;
    previous = next;
  }
  return previous;
}

async function assertContextDecoration(page: Page, fixture: ContextFixture, when: "neutral" | "action", cellId: string): Promise<void> {
  const facts = await settledContextDecoration(page, fixture);
  if (fixture.widget === null) {
    expect(
      facts.count,
      `${cellId} / ${fixture.context}/${when}: 对照组不得出现任何 replace 装饰（${JSON.stringify(REPLACE_SELECTORS)}），实际 ${facts.count}；行文本 ${JSON.stringify(facts.lineText)}；caret=${facts.anchor}；focus=${facts.focus}；lines=${facts.lines}`,
    ).toBe(0);
    return;
  }
  expect(
    facts.count,
    `${cellId} / ${fixture.context}/${when}: ${fixture.widget} 必须至少 ${fixture.widgetMin} 个（装饰缺席时该格对 DOM 回写类缺陷没有区分度）；行文本 ${JSON.stringify(facts.lineText)}；caret=${facts.anchor}；focus=${facts.focus}；lines=${facts.lines}`,
  ).toBeGreaterThanOrEqual(fixture.widgetMin);
}

async function performAsyncAction(page: Page, item: MatrixCase): Promise<void> {
  switch (item.action.kind) {
    case "type":
      await page.keyboard.type(item.action.text ?? "");
      return;
    case "deleteBackward":
      await page.keyboard.press("Backspace");
      return;
    case "deleteForward":
      await page.keyboard.press("Delete");
      return;
    case "enter":
      await page.keyboard.press("Enter");
      return;
    case "paste": {
      await page.locator(".cm-content").evaluate((el, text) => {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, item.action.text ?? "");
      return;
    }
    case "pointer": {
      const point = await page.locator(".cm-content").evaluate((el, pos) => {
        const view = (el as unknown as { cmTile: { root: { view: { coordsAtPos(pos: number): { left: number; top: number; bottom: number } } } } }).cmTile.root.view;
        const rect = view.coordsAtPos(pos);
        return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 };
      }, item.action.at ?? 0);
      await page.mouse.click(point.x, point.y);
      return;
    }
  }
}

/** 组合 / 结算窗口：复位、建立组合、动作、读数全部在**同一同步拍**内完成，
 *  否则 settle 定时器（`setTimeout(0)` 起跳）会在动作前把窗口关掉。 */
interface WindowResult {
  doc: string;
  anchor: number;
  head: number;
  prevented: boolean;
  composing: boolean;
}

async function performWindowCell(page: Page, fixture: ContextFixture, item: MatrixCase): Promise<WindowResult> {
  return page.locator(".cm-content").evaluate((el, payload) => {
    const view = (el as unknown as {
      cmTile: { root: { view: {
        setState(state: unknown): void;
        dispatch(spec: unknown): void;
        focus(): void;
        state: { doc: { toString(): string; length: number }; selection: { main: { anchor: number; head: number } } };
        compositionStarted: boolean;
        __pristine: unknown;
      } } };
    }).cmTile.root.view;
    view.focus();
    const sel = payload.selection;
    view.dispatch({ selection: { anchor: sel.anchor, head: sel.head } });

    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, cancelable: true }));
    if (payload.marked !== "") {
      view.dispatch({
        changes: { from: payload.compositionAt, insert: payload.marked },
        selection: { anchor: payload.compositionAt + payload.marked.length },
        userEvent: "input.type.compose",
      });
    }
    if (payload.end) el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    if (payload.final !== null) view.dispatch({ selection: payload.final });

    let prevented = false;
    const action = payload.action;
    if (action.kind === "deleteBackward" || action.kind === "deleteForward" || action.kind === "type") {
      const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: action.text ?? null });
      Object.defineProperty(event, "inputType", {
        value: action.kind === "deleteBackward" ? "deleteContentBackward" : action.kind === "deleteForward" ? "deleteContentForward" : "insertText",
      });
      prevented = !el.dispatchEvent(event);
    } else if (action.kind === "enter") {
      const event = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true });
      prevented = !el.dispatchEvent(event);
    } else if (action.kind === "paste") {
      const data = new DataTransfer();
      data.setData("text/plain", action.text ?? "");
      const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
      prevented = !el.dispatchEvent(event);
    } else {
      throw new Error(`window cell 不支持动作 ${action.kind}`);
    }
    const main = view.state.selection.main;
    return {
      doc: view.state.doc.toString(),
      anchor: main.anchor,
      head: main.head,
      prevented,
      composing: view.compositionStarted,
    };
  }, {
    selection: "caret" in item.setup.selection
      ? { anchor: (item.setup.selection as { caret: number }).caret, head: (item.setup.selection as { caret: number }).caret }
      : (item.setup.selection as { anchor: number; head: number }),
    marked: item.setup.composition?.marked ?? "",
    end: item.setup.composition?.end ?? false,
    final: item.setup.finalSelection ?? null,
    compositionAt: "caret" in item.setup.selection
      ? (item.setup.selection as { caret: number }).caret
      : (item.setup.selection as { anchor: number; head: number }).anchor,
    action: item.action,
  });
}

function expectationFor(cell: MatrixCell, item: MatrixCase, fixture: ContextFixture): TransitionExpectation {
  const selection = "caret" in item.setup.selection
    ? { anchor: item.setup.selection.caret, head: item.setup.selection.caret }
    : item.setup.selection;
  const oracle = new TransitionOracle(fixture.doc, selection.anchor, cell.state);
  oracle.body.setSelection(selection.anchor, selection.head);
  if (item.setup.composition !== undefined) {
    oracle.startComposition();
    if (item.setup.composition.marked !== "") oracle.compositionSetMarked(item.setup.composition.marked);
    if (item.setup.composition.end) oracle.endComposition();
  }
  if (item.setup.finalSelection !== undefined) {
    oracle.body.setSelection(item.setup.finalSelection.anchor, item.setup.finalSelection.head);
  }
  return oracle.apply(item.action);
}

function fail(cell: MatrixCell, item: MatrixCase, expected: TransitionExpectation, actual: Reading): never {
  throw new Error(
    [
      `TRANSITION FAIL ${cell.id}`,
      `case     : ${item.note}`,
      `action   : ${describeEditAction(item.action)}`,
      `expected : ${JSON.stringify({ doc: expected.doc, anchor: expected.anchor, head: expected.head })}`,
      `actual   : ${JSON.stringify({ doc: actual.doc, anchor: actual.anchor, head: actual.head })}`,
      `touched  : ${JSON.stringify(changedLineRange(FIXTURES[cell.context].doc, actual.doc))} (expected ${JSON.stringify(expected.touched)})`,
    ].join("\n"),
  );
}

/** 一格（含它的全部 case）在真引擎上的执行与断言。 */
async function runCell(page: Page, cell: MatrixCell): Promise<void> {
  const fixture = FIXTURES[cell.context];
  for (const item of cell.cases) {
    const expected = expectationFor(cell, item, fixture);
    const path = PATH;

    // 区分度前提：先把 caret 放到文档首（中性位）断一次装饰在场——选区本身会 reveal 掉
    // 行内 / 块级 replace，动作时再断一次只对「跨行合并」类动作有意义（被吸收行的 widget 仍在）。
    await resetCell(page, { caret: 0 });
    await assertContextDecoration(page, fixture, "neutral", cell.id);
    await resetCell(page, item.setup.selection);

    if (
      (cell.action === "deleteBackward" || cell.action === "deleteForward") &&
      cell.selection === "collapsed" &&
      cell.state !== "composing"
    ) {
      // 跨行合并：动作时被吸收行的 replace 装饰必须仍在场（reveal 只会撤下 caret 所在行）。
      await assertContextDecoration(page, fixture, "action", cell.id);
    }

    // 复位后等两帧再发真实按键：`setState` 之后 DOM 的绘制是异步的，WebKit 下在
    // 「state 已换、DOM 未画」的窗口里发 Enter 会拿到与绘制后不同的默认行为。
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

    let actual: Reading;
    if (cell.state === "composing" || cell.state === "settling") {
      const result = await performWindowCell(page, fixture, item);
      actual = { ...result, readOnly: false };
      if (item.consumed !== null) {
        expect(result.prevented, `${cell.id} / ${item.note}: 闸门是否消费事件（expected consumed=${item.consumed}）`).toBe(item.consumed);
      }
      if (cell.state === "composing") {
        expect(result.composing, `${cell.id}: 组合态读数必须仍是组合中`).toBe(true);
      } else {
        expect(result.composing, `${cell.id}: settling 读数必须已不在组合中`).toBe(false);
      }
      // settling：结算回调跑完后源码 MUST NOT 再变化。
      if (cell.state === "settling") {
        await expect
          .poll(async () => (await read(page)).doc, { timeout: 3000 })
          .toBe(result.doc);
        await expect
          .poll(async () => (await read(page)).composing, { timeout: 3000 })
          .toBe(false);
      }
    } else {
      actual = await read(page);
      if (cell.state === "readOnly") {
        expect(actual.readOnly, `${cell.id}: 该格必须落在只读会话`).toBe(true);
      }
      await performAsyncAction(page, item);
      actual = await read(page);
    }

    if (actual.doc !== expected.doc || actual.anchor !== expected.anchor || actual.head !== expected.head) {
      fail(cell, item, expected, actual);
    }

    // 非目标行不变：以 fixture（本格的编辑前文档）为基准，模型自己预测「哪几行该变」，
    // 生产实际改动行必须与之相等。组合格的 touched 不能取「marked 已插入」为基准——
    // marked 是合成通道的适配器产物，不是用户的编辑前态。
    expect(
      changedLineRange(fixture.doc, actual.doc),
      `${cell.id} / ${item.note}: 触及行与模型不一致`,
    ).toEqual(changedLineRange(fixture.doc, expected.doc));

    // 渲染字形不落盘：源码里不得出现只在渲染层存在的字形。
    for (const glyph of RENDER_ONLY_GLYPHS) {
      expect(actual.doc.includes(glyph), `${cell.id}: 源码被写进渲染层字形 ${JSON.stringify(glyph)}：${JSON.stringify(actual.doc)}`).toBe(false);
    }

    // 一次 undo / 一次 redo。
    if (expected.history.steps === 1) {
      await page.keyboard.press("Meta+z");
      await expect
        .poll(async () => {
          const undo = await read(page);
          return { doc: undo.doc, anchor: undo.anchor, head: undo.head };
        }, { timeout: 3000 })
        .toEqual(expected.history.restores);
      await page.keyboard.press("Meta+Shift+z");
      await expect.poll(async () => (await read(page)).doc, { timeout: 3000 }).toBe(expected.doc);
    }

    // 保存载荷。
    if (cell.state === "readOnly") {
      // 只读会话没有落盘入口：盘上内容不应出现新写。
      expect(await fileText(page, path)).toBeUndefined();
      continue;
    }
    const beforeSave = await fileText(page, path);
    if (expected.doc !== fixture.doc) {
      await page.keyboard.press("Meta+s");
      await expect
        .poll(async () => (await fileText(page, path)) ?? fixture.doc, { timeout: 3000 })
        .toBe(expected.doc);
    } else {
      await page.keyboard.press("Meta+s");
      await page.waitForTimeout(60);
      expect(await fileText(page, path), `${cell.id}: 源码未变时不得写出新内容`).toBe(beforeSave);
    }
  }
}

function cellsFor(context: EditContext): MatrixCell[] {
  return MATRIX.cells.filter((cell) => cell.context === context && cell.state !== "readOnly");
}

// ---------------------------------------------------------------------------
// 每个上下文一个 test：一条 fixture 文档、一次开页，逐格复位执行。
// ---------------------------------------------------------------------------

for (const context of ["plain", "inline-replace", "block-replace", "list-marker", "table-cell"] as const) {
  test(`状态迁移矩阵 / ${context}：idle / composing / settling 三态`, async ({ page }) => {
    const fixture = FIXTURES[context];
    await openDoc(page, fixture);
    const cells = cellsFor(context);
    expect(cells.length, `${context}: 矩阵里没有可执行的格`).toBeGreaterThan(0);
    for (const cell of cells) await runCell(page, cell);
  });
}

for (const context of ["plain", "table-cell"] as const) {
  test(`状态迁移矩阵 / readOnly-${context}：vault 外只读会话的全部动作空转`, async ({ page }) => {
    const fixture = FIXTURES[context];
    const external = `/tmp/lumir-transition-oracle/external-${context}-${Date.now()}.md`;
    await stubTauri(page, {
      entries: [],
      files: {},
      links: {},
      externalFiles: { [external]: fixture.doc },
    });
    await page.goto("/");
    await configApplied(page);
    await page.keyboard.press("Meta+p");
    await expect(page.locator(".lumir-qo-input")).toBeFocused();
    await page.locator(".lumir-qo-input").fill(external);
    await page.keyboard.press("Enter");
    await expect(page.locator(".modeline-path")).toContainText(`external-${context}-`);
    await page.locator(".cm-content").evaluate((el) => {
      const view = (el as unknown as { cmTile: { root: { view: { state: unknown } } } }).cmTile.root.view;
      (view as unknown as { __pristine: unknown }).__pristine = view.state;
    });
    const reading = await read(page);
    expect(reading.readOnly, "vault 外会话必须只读").toBe(true);

    const cells = MATRIX.cells.filter((cell) => cell.state === "readOnly" && cell.context === context);
    expect(cells.length, `readOnly/${context}: 矩阵里没有可执行的格`).toBeGreaterThan(0);
    for (const cell of cells) await runCell(page, cell);
  });
}
