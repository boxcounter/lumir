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
// 保存载荷（K3 r1 P1）：按 ⌘S 后用桩的 `documentWrites()` 取**新增写入**。判据是「应用认为
// 干净」的同一口径：`cleanDoc` 在每次保存成功后等于上次写入内容，因此本文件逐格维护
// `lastSavedDoc`——`expected.doc !== lastSavedDoc` 时 MUST 恰好新增一条 `{path, content ===
// expected.doc}` 的写入；相等时 MUST 没有新写（干净文档的 ⌘S 是空操作）。只读格真按 ⌘S，
// 断言 `invokes()` 不新增 `document_save` 且没有任何写入记录。
//
// settling 的完成信号（K3 r1 P1）：`compositionend` 后 lists.ts 经
// `scheduleCompositionSettle` 派发 `compositionSettled` effect → ListLayout 插件 `beginSettle`
// 把 `settleTo` 置非空、刷新 `settleStarted` → 定时器跑完 `publishSettled` / `cancelSettle` 把
// `settleTo` 置回 null。本文件等「settleStarted 前进 && settleTo 回到 null && 无 pending
// MutationRecord && 不在组合」这个真实完成信号之后，再比较完整 `{doc, anchor, head}`；
// `settleStarted` 没前进即判该格对结算窗口没有区分度（不得以「当前值等于自身」的空转 poll 代替）。
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
import { configApplied, documentWrites, invokes, stubTauri, type VaultFixture } from "./tauri-stub";
import {
  TransitionOracle,
  changedByteRange,
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
/** 反向验证 / 单格复现用：逗号分隔的格 id（如 `idle/range/table-cell/type`），空 = 全量。 */
const FOCUS = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  ?.LUMIR_TRANSITION_FOCUS ?? "")
  .split(",")
  .map((part) => part.trim())
  .filter((part) => part.length > 0);

interface Reading {
  doc: string;
  anchor: number;
  head: number;
  readOnly: boolean;
  composing: boolean;
}

type FullState = Pick<Reading, "doc" | "anchor" | "head">;

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

async function fullState(page: Page): Promise<FullState> {
  const { doc, anchor, head } = await read(page);
  return { doc, anchor, head };
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

/** 上下文装饰在场读数（区分度前提用）。 */
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

/** 组合 / 结算窗口：建立组合、动作、读数全部在**同一同步拍**内完成，
 *  否则 settle 定时器（`setTimeout(0)` 起跳）会在动作前把窗口关掉。 */
interface WindowResult {
  doc: string;
  anchor: number;
  head: number;
  prevented: boolean;
  composing: boolean;
}

async function performWindowCell(page: Page, item: MatrixCase): Promise<WindowResult> {
  return page.locator(".cm-content").evaluate((el, payload) => {
    const view = (el as unknown as {
      cmTile: { root: { view: {
        dispatch(spec: unknown): void;
        focus(): void;
        state: { doc: { toString(): string; length: number }; selection: { main: { anchor: number; head: number } } };
        compositionStarted: boolean;
      } } };
    }).cmTile.root.view;
    view.focus();
    const sel = payload.selection;
    view.dispatch({ selection: { anchor: sel.anchor, head: sel.head } });

    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, cancelable: true }));
    if (payload.marked !== "") {
      // 合成通道的「IME 写 marked 文本」：用非 joinable 的 userEvent，避免它与随后的键入
      // 在 CM history 里并成一条——组合自身的撤销粒度由矩阵诚实标 steps:null，不受影响；
      // 这样「提交后的键入 = 一条撤销步」才与模型同粒度。
      view.dispatch({
        changes: { from: payload.compositionAt, insert: payload.marked },
        selection: { anchor: payload.compositionAt + payload.marked.length },
        userEvent: "oracle.compose",
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

/** 结算的真实完成信号（见文件头）：ListLayout 插件的 `settleStarted` / `settleTo` +
 *  CM 的 pending MutationRecord + 组合态。 */
interface SettleFacts {
  settleStarted: number;
  settleTo: number | null;
  pending: number;
  composing: boolean;
}

async function settleFacts(page: Page): Promise<SettleFacts> {
  return page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as {
      cmTile: { root: { view: {
        plugins: Array<{ value?: unknown }>;
        compositionStarted: boolean;
        observer?: { pendingRecords(): readonly unknown[] };
      } } };
    }).cmTile.root.view;
    const plugin = (view.plugins ?? [])
      .map((entry) => entry.value)
      .find((value): value is { settleStarted: number; settleTo: number | null } =>
        typeof value === "object" && value !== null && "settleStarted" in value && "settleTo" in value) ?? null;
    return {
      settleStarted: plugin === null ? -1 : plugin.settleStarted,
      settleTo: plugin === null ? null : plugin.settleTo,
      pending: view.observer === undefined ? -1 : view.observer.pendingRecords().length,
      composing: view.compositionStarted,
    };
  });
}

/** 等复位造成的任何结算彻底安静下来（两次读数一致且 settleTo 为空、无 pending 记录）：
 *  `resetCell` 补发 compositionend 会顺手排一轮结算，基线必须在它之后取，否则
 *  「settleStarted 前进」可能由复位而不是本格的动作引起。 */
async function waitForQuiescence(page: Page): Promise<void> {
  let previous = await settleFacts(page);
  for (let index = 0; index < 100; index += 1) {
    await page.waitForTimeout(16);
    const next = await settleFacts(page);
    if (
      next.settleStarted === previous.settleStarted &&
      next.settleTo === null &&
      next.pending === 0 &&
      !next.composing
    ) {
      return;
    }
    previous = next;
  }
  throw new Error("复位后的结算始终没有安静下来（settleStarted 仍在前进或存在 pending 记录）");
}

/** 等组合结算真正跑完：`settleStarted` 必须前进（证明结算开始了）且 `settleTo` 回到 null
 *  （证明这一轮跑完），同时没有 pending MutationRecord、已不在组合中。 */
async function waitForSettleCompletion(page: Page, before: SettleFacts, cellId: string): Promise<void> {
  if (before.settleStarted < 0) {
    throw new Error(`${cellId}: 找不到 ListLayout 插件（settleStarted），settling 判据不可用`);
  }
  await expect
    .poll(async () => {
      const facts = await settleFacts(page);
      return {
        advanced: facts.settleStarted > before.settleStarted,
        idle: facts.settleTo === null,
        pending: facts.pending,
        composing: facts.composing,
      };
    }, { timeout: 5000, message: `${cellId}: 等组合结算完成（settleStarted 前进 + settleTo 归零）` })
    .toEqual({ advanced: true, idle: true, pending: 0, composing: false });
}

/** 动作前的状态（组合提交之后、动作之前）：保存判定需要它区分「本格改了源码」与
 *  「本格只是移动了选区」。 */
function preActionState(cell: MatrixCell, item: MatrixCase, fixture: ContextFixture): FullState {
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
  return oracle.snapshot();
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

/** 一格（含它的全部 case）在真引擎上的执行与断言。`lastSaved` 是「应用认为干净的文档」
 *  （桩的磁盘 = cleanDoc，每次保存成功后随之推进），用于精确判定「⌘S 该不该写、写了什么」。 */
async function runCell(page: Page, cell: MatrixCell, lastSaved: { doc: string }): Promise<void> {
  const fixture = FIXTURES[cell.context];
  for (const item of cell.cases) {
    const expected = expectationFor(cell, item, fixture);
    const preAction = preActionState(cell, item, fixture);

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

    // 复位后等两帧再发真实按键：`setState` 之后 DOM 的绘制是异步的。
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    // settling 的基线在「复位排出的结算也跑完」之后取，才证明本格的动作自己武装了新的一轮。
    let settleBefore: SettleFacts | null = null;
    if (cell.state === "settling") {
      await waitForQuiescence(page);
      settleBefore = await settleFacts(page);
    }

    let actual: Reading;
    if (cell.state === "composing" || cell.state === "settling") {
      const result = await performWindowCell(page, item);
      actual = { ...result, readOnly: false };
      if (item.consumed !== null) {
        expect(result.prevented, `${cell.id} / ${item.note}: 闸门是否消费事件（expected consumed=${item.consumed}）`).toBe(item.consumed);
      }
      if (cell.state === "composing") {
        expect(result.composing, `${cell.id}: 组合态读数必须仍是组合中`).toBe(true);
      } else {
        expect(result.composing, `${cell.id}: settling 读数必须已不在组合中`).toBe(false);
        // 等真实结算完成，再比较完整状态：结算回调若回写源码 / 选区，这里必红。
        await waitForSettleCompletion(page, settleBefore!, cell.id);
        const settled = await fullState(page);
        expect(
          settled,
          `${cell.id} / ${item.note}: 结算回调完成后源码或选区被改动（动作后 ${JSON.stringify({ doc: result.doc, anchor: result.anchor, head: result.head })}）`,
        ).toEqual({ doc: result.doc, anchor: result.anchor, head: result.head });
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

    // 非目标行不变：以 fixture（本格的编辑前文档）为基准，模型自己预测「哪几行该变」。
    expect(
      changedLineRange(fixture.doc, actual.doc),
      `${cell.id} / ${item.note}: 触及行与模型不一致`,
    ).toEqual(changedLineRange(fixture.doc, expected.doc));

    // 渲染字形不落盘：源码里不得出现只在渲染层存在的字形。
    for (const glyph of RENDER_ONLY_GLYPHS) {
      expect(actual.doc.includes(glyph), `${cell.id}: 源码被写进渲染层字形 ${JSON.stringify(glyph)}：${JSON.stringify(actual.doc)}`).toBe(false);
    }

    // 一次 undo / 一次 redo。steps=1 比完整状态；steps=0（只读 / 指针 / 无变化）按 ⌘Z 后
    // 文档 MUST 不变（CM 可能记「只选择区」事件，测试装置的复位选区不在合同内，故不比选区）。
    if (expected.history.steps === 1) {
      await page.keyboard.press("Meta+z");
      await expect
        .poll(async () => fullState(page), { timeout: 3000, message: `${cell.id}: 一次 undo 复原完整状态` })
        .toEqual(expected.history.restores);
      await page.keyboard.press("Meta+Shift+z");
      const redone = await expect
        .poll(async () => fullState(page), { timeout: 3000, message: `${cell.id}: 一次 redo 复原文档` })
        .toMatchObject({ doc: expected.doc })
        .then(() => fullState(page));
      // redo 的选区由 CM 历史事件记录（transaction 的 `selectionAfter`）：显式设过选区的
      // 命令回到动作后的 caret；`replaceSelection` / `newlineAndIndent` 这类不显式设选区的
      // 命令把**动作前的选区**映射过改动。产品合同只固定源码，因此这里判「两端都落在本次
      // 改动过的字节区间内」——比只比 doc 强，又不把 CM 的历史记录细节当成产品期望。
      const changed = changedByteRange(preAction.doc, expected.doc);
      for (const [name, pos] of [["anchor", redone.anchor], ["head", redone.head]] as const) {
        expect(
          pos >= changed.from && pos <= changed.to,
          `${cell.id}: redo 后 ${name}=${pos} 不在本次改动区间 [${changed.from},${changed.to}] 内`,
        ).toBe(true);
      }
    } else if (expected.history.steps === 0) {
      await page.keyboard.press("Meta+z");
      await page.waitForTimeout(60);
      expect((await read(page)).doc, `${cell.id}: 无撤销步的动作之后 ⌘Z 不得改动文档`).toBe(expected.doc);
      await page.keyboard.press("Meta+Shift+z");
      await page.waitForTimeout(60);
      expect((await read(page)).doc, `${cell.id}: 无撤销步的动作之后 ⌘⇧Z 不得改动文档`).toBe(expected.doc);
    }

    // 保存载荷。
    if (cell.state === "readOnly") {
      const savesBefore = (await invokes(page)).filter((name) => name === "document_save").length;
      const writesBefore = (await documentWrites(page)).length;
      await page.keyboard.press("Meta+s");
      await page.waitForTimeout(80);
      expect(
        (await invokes(page)).filter((name) => name === "document_save").length,
        `${cell.id}: 只读会话按 ⌘S 不得发出 document_save`,
      ).toBe(savesBefore);
      expect((await documentWrites(page)).length, `${cell.id}: 只读会话不得产生任何写入`).toBe(writesBefore);
      continue;
    }
    const writesBefore = await documentWrites(page);
    await page.keyboard.press("Meta+s");
    await page.waitForTimeout(80);
    const newWrites = (await documentWrites(page)).slice(writesBefore.length);
    expect(newWrites.length, `${cell.id}: 一次 ⌘S 至多一次写入`).toBeLessThanOrEqual(1);
    // 应用只在「本格的编辑事务让 docChanged 且新文档 !== cleanDoc」时写盘：动手改了源码、
    // 且结果不同于上次保存的内容 ⇒ MUST 新增一条精确写入；否则 ⇐ 不得写（⌘S 是空操作）。
    const docChanged = expected.doc !== preAction.doc;
    if (docChanged && expected.doc !== lastSaved.doc) {
      expect(newWrites.length, `${cell.id}: 源码已偏离已保存内容，⌘S MUST 产生一次写入`).toBe(1);
      expect(newWrites[0], `${cell.id}: 保存载荷 MUST 逐字节等于当前 EditorState.doc`).toEqual({
        path: PATH,
        content: expected.doc,
      });
      lastSaved.doc = expected.doc;
    } else {
      expect(newWrites, `${cell.id}: 无新内容可写时 ⌘S 是空操作`).toEqual([]);
    }
  }
}

function cellsFor(context: EditContext): MatrixCell[] {
  const cells = MATRIX.cells.filter((cell) => cell.context === context && cell.state !== "readOnly");
  return FOCUS.length === 0 ? cells : cells.filter((cell) => FOCUS.includes(cell.id));
}

function readOnlyCellsFor(context: EditContext): MatrixCell[] {
  const cells = MATRIX.cells.filter((cell) => cell.state === "readOnly" && cell.context === context);
  return FOCUS.length === 0 ? cells : cells.filter((cell) => FOCUS.includes(cell.id));
}

// ---------------------------------------------------------------------------
// 每个上下文一个 test：一条 fixture 文档、一次开页，逐格复位执行。
// ---------------------------------------------------------------------------

for (const context of ["plain", "inline-replace", "block-replace", "list-marker", "table-cell"] as const) {
  test(`状态迁移矩阵 / ${context}：idle / composing / settling 三态`, async ({ page }) => {
    const fixture = FIXTURES[context];
    const cells = cellsFor(context);
    test.skip(cells.length === 0, "LUMIR_TRANSITION_FOCUS 排除了本上下文的全部格");
    await openDoc(page, fixture);
    expect(cells.length, `${context}: 矩阵里没有可执行的格`).toBeGreaterThan(0);
    const lastSaved = { doc: fixture.doc };
    for (const cell of cells) await runCell(page, cell, lastSaved);
  });
}

for (const context of ["plain", "table-cell"] as const) {
  test(`状态迁移矩阵 / readOnly-${context}：vault 外只读会话的全部动作空转`, async ({ page }) => {
    const fixture = FIXTURES[context];
    const cells = readOnlyCellsFor(context);
    test.skip(cells.length === 0, "LUMIR_TRANSITION_FOCUS 排除了本上下文的全部只读格");
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

    expect(cells.length, `readOnly/${context}: 矩阵里没有可执行的格`).toBeGreaterThan(0);
    const lastSaved = { doc: fixture.doc };
    for (const cell of cells) await runCell(page, cell, lastSaved);
  });
}

// ---------------------------------------------------------------------------
// 规格 Scenario「只读会话的全部编辑动作空转」的混合文档 witness：列表 marker / 表格 /
// wikilink 同篇。矩阵的上下文 fixture 一次只承载一种构造，这条按 Scenario 的原文补齐。
// ---------------------------------------------------------------------------

const MIXED_DOC = "# 标题\n\n- item [[target-note]] 续\n\n| a | b |\n| --- | --- |\n| c | d |\n\n尾行\n";
const MIXED_LIST_START = MIXED_DOC.indexOf("item");
const MIXED_CELL = MIXED_DOC.indexOf("| c | d |") + 2;
const MIXED_WIKILINK = MIXED_DOC.indexOf("target-note") + 2;

test("状态迁移矩阵 / readOnly 混合文档：列表 / 表格 / wikilink 上的全部动作空转", async ({ page }) => {
  test.skip(FOCUS.length > 0, "LUMIR_TRANSITION_FOCUS 指定了单格：混合文档 witness 不在本次聚焦范围");
  const external = `/tmp/lumir-transition-oracle/external-mixed-${Date.now()}.md`;
  await stubTauri(page, { entries: [], files: {}, links: {}, externalFiles: { [external]: MIXED_DOC } });
  await page.goto("/");
  await configApplied(page);
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo-input")).toBeFocused();
  await page.locator(".lumir-qo-input").fill(external);
  await page.keyboard.press("Enter");
  await expect(page.locator(".modeline-path")).toContainText("external-mixed-");
  await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: { state: unknown } } } }).cmTile.root.view;
    (view as unknown as { __pristine: unknown }).__pristine = view.state;
  });
  expect((await read(page)).readOnly).toBe(true);
  // 三种构造都要真的渲染出来（否则这条 witness 对 DOM 回写没有区分度）。
  await expect
    .poll(async () =>
      page.locator(".cm-content").evaluate((el) => ({
        list: el.querySelectorAll(".cm-lp-list-marker").length,
        table: el.querySelectorAll(".cm-lp-table-cell").length,
        link: el.querySelectorAll(".cm-lp-wikilink").length,
      })))
    .toEqual({ list: 1, table: 4, link: 1 });

  const positions: Array<[string, number]> = [
    ["list-content-start", MIXED_LIST_START],
    ["table-cell", MIXED_CELL],
    ["wikilink", MIXED_WIKILINK],
  ];
  const actions: Array<{ label: string; run: () => Promise<void> }> = [
    { label: "type", run: async () => page.keyboard.type("Q") },
    { label: "deleteBackward", run: async () => page.keyboard.press("Backspace") },
    { label: "deleteForward", run: async () => page.keyboard.press("Delete") },
    { label: "enter", run: async () => page.keyboard.press("Enter") },
    {
      label: "paste",
      run: async () =>
        page.locator(".cm-content").evaluate((el) => {
          const data = new DataTransfer();
          data.setData("text/plain", "Paste");
          el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        }),
    },
  ];

  for (const [label, at] of positions) {
    for (const action of actions) {
      await resetCell(page, { caret: at });
      const before = await read(page);
      await action.run();
      const after = await read(page);
      expect(after.doc, `readOnly/mixed @${label}/${action.label}: 只读不得产生任何文档变更`).toBe(before.doc);
      // 选区：只读合同固定的是**文档**（MUST NOT 产生文档变更 / 撤销步）。唯一已知的选区移动
      // 来自上游 markdown 键位 `deleteMarkupBackward`——它在列表内容起点算出一笔删 marker 的
      // 事务，`changeFilter` 挡住文档改动后只剩选区落到 marker 起点（2026-11-27 探针：同一
      // 位置 Delete / Enter 都不动、非列表行行首 Backspace 也不动）。这一格只比文档，其余
      // 逐字节比选区。
      const upstreamMarkupSelectionMove = label === "list-content-start" && action.label === "deleteBackward";
      if (!upstreamMarkupSelectionMove) {
        expect(
          { anchor: after.anchor, head: after.head },
          `readOnly/mixed @${label}/${action.label}: 只读不得移动选区`,
        ).toEqual({ anchor: before.anchor, head: before.head });
      }
    }
  }

  // 指针：点在表格 cell 上只允许移动选区，不得改写文档。
  await resetCell(page, { caret: 0 });
  const point = await page.locator(".cm-content").evaluate((el, pos) => {
    const view = (el as unknown as { cmTile: { root: { view: { coordsAtPos(pos: number): { left: number; top: number; bottom: number } } } } }).cmTile.root.view;
    const rect = view.coordsAtPos(pos);
    return { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 };
  }, MIXED_CELL);
  const docBeforePointer = (await read(page)).doc;
  await page.mouse.click(point.x, point.y);
  expect((await read(page)).doc, "readOnly/mixed: 指针不得改写文档").toBe(docBeforePointer);

  // ⌘S 在只读会话是空操作：不发 document_save、不写盘。
  const savesBefore = (await invokes(page)).filter((name) => name === "document_save").length;
  const writesBefore = (await documentWrites(page)).length;
  await page.keyboard.press("Meta+s");
  await page.waitForTimeout(80);
  expect((await invokes(page)).filter((name) => name === "document_save").length).toBe(savesBefore);
  expect((await documentWrites(page)).length).toBe(writesBefore);
});
