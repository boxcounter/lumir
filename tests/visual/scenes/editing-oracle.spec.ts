// tests/visual/scenes/editing-oracle.spec.ts —— 真 EditorView 下的编辑对拍（M832）。
//
// 分工：期望值全部来自 `../../unit/editing-oracle-model`（独立模型，不 import 生产代码）；
// 本层只驱动**真** CodeMirror view / 真键盘 / 真保存链。Node 层（tests/unit/editing-oracle.test.ts）
// 已覆盖生产命令/纯函数与大样本随机序列；这里补 Node 造不出来的两半：
//   - 真内容 DOM 与真实键盘（→/← 的 marker 原子步、Enter 的 keymap、原生 Backspace）；
//   - 真 Tauri 桩的落盘全文（`__fileText`）与 composer 的附件 DOM。
//
// IME：Chromium 用 CDP `Input.imeSetComposition`（真引擎）；WebKit 只跑非 IME 用例——
// WKWebView 原生 IME 事件序归 scripts/acceptance 的真机场景，本层不拿合成事件冒充。
//
// 失败读数：seed / step / op / before / expected / actual（模型 helper 统一格式），
// 同时挂到 Playwright 附件；`LUMIR_ORACLE_SEEDS` 可只复跑指定 seed。
import { expect, test, type Page } from "@playwright/test";
import { dirtyReports, fileText, stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";
import {
  BodyOracle,
  ComposerOracle,
  applyBodyOp,
  applyComposerOp,
  describeBodyOp,
  formatOracleFailure,
  lineEnds,
  makeRng,
  randomBodyOp,
} from "../../unit/editing-oracle-model";
import type { BodyOp } from "../../unit/editing-oracle-model";

const SEEDS = (() => {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.LUMIR_ORACLE_SEEDS;
  if (!raw) return [2, 13, 29];
  const parsed = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0);
  return parsed.length > 0 ? parsed.slice(0, 4) : [2, 13, 29];
})();

const LIST_DOC = "para\n1. \n";
const BARE_DOC = "para\n1. ";
const MIXED_DOC = "alpha\nbeta\n- item\n- \n";

function vaultWith(path: string, text: string): VaultFixture {
  return {
    entries: [{ path, kind: "file", size: text.length, mtime_ms: 0 }],
    files: { [path]: text },
    links: {},
  };
}

async function openBody(page: Page, path: string, doc: string): Promise<void> {
  await stubTauri(page, vaultWith(path, doc));
  await page.goto("/");
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".modeline-path")).toHaveText(path);
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

async function composerState(page: Page): Promise<EditorReading> {
  return page.locator(".lumir-hp-composer .cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    return { doc: view.state.doc.toString(), anchor: main.anchor, head: main.head };
  });
}

async function setBodyCaret(page: Page, pos: number): Promise<void> {
  await page.locator(".cm-content").evaluate((el, p) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: p } });
  }, pos);
}

interface LineRender {
  text: string;
  markerCount: number;
  markerText: string | null;
  display: string | null;
  fontSize: string | null;
  color: string | null;
  linePadding: string;
  lineLeft: number;
  bodyX: number;
}

/** 逐行渲染读数：marker 数量 / glyph 或序号 / 计算样式 / 正文 x（口径同 lists.spec.ts 的
 *  `listInputRendering`）。`text` 单独留在快照里，几何比较时剥掉——组合与提交会改文本，
 * 但 marker 与悬挂缩进必须按合同稳定。 */
async function listRenderSnapshot(page: Page): Promise<LineRender[]> {
  return page.locator(".cm-content").evaluate((el) => [...el.querySelectorAll<HTMLElement>(".cm-line")].map((line) => {
    const markers = line.querySelectorAll<HTMLElement>(".cm-lp-list-marker");
    const marker = markers[0] ?? null;
    const style = marker ? getComputedStyle(marker) : null;
    const lineStyle = getComputedStyle(line);
    const lineLeft = line.getBoundingClientRect().left;
    return {
      text: line.textContent ?? "",
      markerCount: markers.length,
      markerText: marker?.textContent ?? null,
      display: style?.display ?? null,
      fontSize: style?.fontSize ?? null,
      color: style?.color ?? null,
      linePadding: lineStyle.paddingInlineStart,
      lineLeft,
      bodyX: lineLeft + parseFloat(lineStyle.paddingInlineStart),
    };
  }));
}

const renderGeometry = (rows: LineRender[]) => rows.map(({ text: _text, ...rest }) => rest);

/** 等两次连续读数一致再返回：marker 恢复与组宽发布是 16ms 起跳的后台链，
 *  单拍读到的可能是中间态。 */
async function settledRenderSnapshot(page: Page, timeoutMs = 3000): Promise<LineRender[]> {
  const deadline = Date.now() + timeoutMs;
  let previous = await listRenderSnapshot(page);
  while (Date.now() < deadline) {
    await page.waitForTimeout(16);
    const next = await listRenderSnapshot(page);
    if (JSON.stringify(renderGeometry(next)) === JSON.stringify(renderGeometry(previous))) return next;
    previous = next;
  }
  return previous;
}

function fail(seed: number, step: number, op: string, before: EditorReading, expected: EditorReading, actual: EditorReading): never {
  throw new Error(
    formatOracleFailure({
      seed,
      step,
      op,
      before: JSON.stringify(before),
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    }),
  );
}

// ---------------------------------------------------------------------------
// 正文：真键盘与真 view
// ---------------------------------------------------------------------------

test("marker 水平导航：→ / ← 各一次跨过隐藏源码区间（模型给落点）", async ({ page }) => {
  const doc = "1. uno\n2. dos\n";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, 0);
  const start = await bodyState(page);

  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await bodyState(page)).head).toBe(3);
  const forward = await bodyState(page);
  expect(forward.doc).toBe(doc);

  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await bodyState(page)).head).toBe(0);
  const backward = await bodyState(page);
  expect(backward.doc).toBe(doc);
  expect(start.head).toBe(0);
});

test("列表 Enter 两态：续 marker → 连续空项各删一行；一次 undo 回上一态", async ({ page }) => {
  const doc = "- first\n- \n- \n";
  await openBody(page, "oracle.md", doc);
  const model = new BodyOracle(doc, lineEnds(doc)[0]);
  const ops: BodyOp[] = [{ kind: "enter" }, { kind: "enter" }, { kind: "enter" }];

  let step = 0;
  for (const op of ops) {
    await page.waitForTimeout(600);
    await setBodyCaret(page, model.head);
    const before = await bodyState(page);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
    applyBodyOp(model, op);
    const actual = await bodyState(page);
    if (actual.doc !== model.doc || actual.head !== model.head) fail(0, step, describeBodyOp(op), before, model.reading(), actual);
    step += 1;
  }

  await page.waitForTimeout(600);
  const beforeUndo = await bodyState(page);
  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(80);
  applyBodyOp(model, { kind: "undo" });
  const afterUndo = await bodyState(page);
  if (afterUndo.doc !== model.doc) fail(0, step, "undo", beforeUndo, model.reading(), afterUndo);
});

test("裸 marker 行 Backspace：一拍删掉 marker（真原生删除路径）", async ({ page }) => {
  await openBody(page, "oracle.md", BARE_DOC);
  const model = new BodyOracle(BARE_DOC, BARE_DOC.length);
  await setBodyCaret(page, BARE_DOC.length);
  const before = await bodyState(page);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("para\n");
  applyBodyOp(model, { kind: "bareBackspace" });
  const actual = await bodyState(page);
  if (actual.doc !== model.doc || actual.head !== model.head) fail(0, 0, "bareBackspace", before, model.reading(), actual);

  await page.waitForTimeout(600);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(BARE_DOC);
});

test("WebKit 组合删除：deleteCompositionText 在删空时走显式事务，起点再删不改文档", async ({ page }) => {
  const doc = "词汇\n- s";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length - 1);
  const events = await page.locator(".cm-content").evaluate((el, sourceLength) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dispatch({ selection: { anchor: sourceLength } });
    const fire = () => {
      const event = new InputEvent("beforeinput", {
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      // Chromium 构造器把不认识的 deleteCompositionText 归一成空串；保留 WKWebView 原值。
      Object.defineProperty(event, "inputType", { value: "deleteCompositionText" });
      return !el.dispatchEvent(event);
    };
    const deleted = fire();
    const atStart = fire();
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { deleted, atStart };
  }, doc.length);
  expect(events).toEqual({ deleted: true, atStart: true });
  expect(await bodyState(page)).toEqual({ doc: "词汇\n- ", anchor: doc.length - 1, head: doc.length - 1 });
  // 组合结束后的重建是异步的（等 pending flush + settle）；等 DOM 恢复到源码形态。
  await expect.poll(async () => page.locator(".cm-line").allTextContents()).toEqual(["词汇", "- "]);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
});

test("正文 IME：不可取消的 pending delete 不得吞掉 setext 候选的 marker（Chromium）", async ({ page }) => {
  // WebKit 的 TypingDeletePendingComposition 不可取消（preventDefault 无效）。setext 候选
  // `- ` 在旧 DOM 里是普通文本节点，浏览器默认删除会沿它向后吞掉标记；shield 把它换成
  // 非可编辑原子 widget，默认删除无文本可删。
  const doc = "词汇\n- \n后续";
  await openBody(page, "oracle.md", doc);
  const probe = await page.locator(".cm-content").evaluate(async (el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const line = () => view.contentDOM.querySelectorAll(".cm-line")[1] as HTMLElement;
    view.focus();
    view.dispatch({ selection: { anchor: 5 } });
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // 组合文本进入文档；组合期 DOM 冻结在组合前形态。
    view.dispatch({ changes: { from: 5, insert: "s" }, selection: { anchor: 6 } });
    const event = new InputEvent("beforeinput", { bubbles: true, cancelable: false, isComposing: true });
    Object.defineProperty(event, "inputType", { value: "deleteCompositionText" });
    const prevented = !el.dispatchEvent(event); // 非 cancelable：恒为 false
    // 浏览器 DOM 默认删除：向后删 caret 前的可编辑文本。shield 使这里没有可删文本。
    const shield = line().querySelector(".cm-lp-source-shield");
    let defaultDeleted = false;
    if (!shield) {
      const walker = document.createTreeWalker(line(), NodeFilter.SHOW_TEXT);
      let text: Text | null = null;
      while (walker.nextNode()) text = walker.currentNode as Text;
      if (text && typeof text.nodeValue === "string" && text.nodeValue.endsWith("- ")) {
        text.nodeValue = text.nodeValue.slice(0, -2);
        defaultDeleted = true;
      }
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteCompositionText" }));
    (view as unknown as { observer?: { flush?: () => void } }).observer?.flush?.();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const afterDefault = view.state.doc.toString();
    const contentStart = shield ? 5 : 3;
    view.dispatch({ changes: { from: contentStart, insert: "是" }, selection: { anchor: contentStart + 1 } });
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { prevented, defaultDeleted, shield: Boolean(shield), afterDefault, doc: view.state.doc.toString() };
  });
  expect(probe.prevented, "非 cancelable 事件无法 preventDefault").toBe(false);
  expect(probe.defaultDeleted, "shield 必须让默认删除无文本可删").toBe(false);
  expect(probe.afterDefault, "默认删除尝试后源码必须保留 `- `").toBe("词汇\n- \n后续");
  expect(probe.shield, "setext 候选必须由 shield 隔离").toBe(true);
  expect(probe.doc).toBe("词汇\n- 是\n后续");
  await expect.poll(async () => page.locator(".cm-lp-list-marker").count()).toBe(1);
  await expect.poll(async () => page.locator(".cm-line").nth(1).textContent()).toBe("–是");
  await expect(page.locator(".cm-line").nth(2)).toContainText("后续");
});

test("正文 IME：insertText 提交且无 compositionend 时解除 shield 冻结（Chromium）", async ({ page }) => {
  // WKWebView 候选可能以 insertText（isComposing:false）提交且不发 compositionend；
  // CM 的 composing 仍为 true，update() 的冻结会让 shield 永不释放。input insertText 是
  // 已提交的证据：补一次 end 信号，走既有 settle，让 DOM 退出组合视图并渲染正式 marker。
  const doc = "词汇\n- \n后续";
  await openBody(page, "oracle.md", doc);
  const probe = await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: 5 } });
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const shieldBefore = el.querySelectorAll(".cm-lp-source-shield").length;
    // 组合文本 s（insertCompositionText）
    view.dispatch({ changes: { from: 5, insert: "s" }, selection: { anchor: 6 }, userEvent: "input.type.compose" });
    const shieldDuring = el.querySelectorAll(".cm-lp-source-shield").length;
    // 候选以 insertText 提交：beforeinput isComposing:false；随后浏览器默认替换 marked text。
    const before = new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: "是", isComposing: false });
    Object.defineProperty(before, "inputType", { value: "insertText" });
    const notPrevented = el.dispatchEvent(before);
    view.dispatch({ changes: { from: 5, to: 6, insert: "是" }, selection: { anchor: 6 }, userEvent: "input.type.compose" });
    const input = new InputEvent("input", { bubbles: true, data: "是", isComposing: false });
    Object.defineProperty(input, "inputType", { value: "insertText" });
    el.dispatchEvent(input);
    return {
      shieldBefore,
      shieldDuring,
      notPrevented,
      composing: view.compositionStarted,
      doc: view.state.doc.toString(),
    };
  });
  expect(probe.shieldBefore).toBe(1);
  expect(probe.shieldDuring).toBe(1);
  expect(probe.notPrevented).toBe(true);
  expect(probe.composing, "同步读数：补 end 在微任务里").toBe(true);
  expect(probe.doc).toBe("词汇\n- 是\n后续");
  await expect.poll(async () => page.locator(".cm-lp-list-marker").count()).toBe(1);
  await expect.poll(async () => page.locator(".cm-lp-source-shield").count()).toBe(0);
  await expect.poll(async () => page.locator(".cm-line").nth(1).textContent()).toBe("–是");
  await expect(page.locator(".cm-line").nth(2)).toContainText("后续");
  // 真实 compositionend 后续到达：不得重复恢复 / 重复 marker。
  await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return view.state.doc.toString();
  });
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  await expect.poll(async () => page.locator(".cm-line").nth(1).textContent()).toBe("–是");
});

test("正文 IME：available 但 state 树陈旧时先同步再 build（Chromium）", async ({ page }) => {
  // 足够长的文档：dispatch 候选后 state 树不会同步解析到末尾，给 context 留出领先窗口。
  const doc = "para\n\n".repeat(2000) + "词汇\n- ";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
  const probe = await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // 候选进入 EditorState；parse context 单独推进，state 字段快照仍是旧树。
    view.dispatch({ changes: { from: length, insert: "是" }, selection: { anchor: length + 1 } });
    const values = (view.state as { values?: unknown[] }).values ?? [];
    const lang = values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as {
      context: { updateViewport(range: { from: number; to: number }): void; work(timeout: number, upto: number): unknown; isDone(upto: number): boolean; tree: { toString(): string } };
      tree: { toString(): string };
    };
    const docLen = view.state.doc.length;
    lang.context.updateViewport({ from: 0, to: docLen });
    lang.context.work(1000, docLen);
    const contextDone = lang.context.isDone(docLen);
    const stateNodes = lang.tree.toString();
    const contextNodes = lang.context.tree.toString();
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { contextDone, stateNodes, contextNodes };
  }, doc.length);
  expect(probe.contextDone).toBe(true);
  // 覆盖前提：context 已解析出新列表，state 快照仍是旧的 setext 形态。
  expect(probe.contextNodes).toContain("BulletList");
  expect(probe.stateNodes).not.toContain("BulletList");
  await expect.poll(() => bodyState(page)).toEqual({ doc: `${doc}是`, anchor: doc.length + 1, head: doc.length + 1 });
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  await expect(page.locator(".cm-line").last()).toContainText("是");
});

test("正文 IME：settleStep available 分支不得用旧 state 树（Chromium）", async ({ page }) => {
  // 直接同步调用 settleStep：compositionend 的 effect dispatch / parse worker 在 Chromium
  // 上会顺带同步 state，无法稳定复现 WKWebView 的 stale 快照；这里在同一个 available
  // 分支上做可区分回归（context 正确、state 可能仍旧；build/scan 必须用 context 树）。
  const doc = "para\n\n".repeat(2000) + "词汇\n- ";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length);
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator(".cm-line").last()).toContainText("-");
  const probe = await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const findLang = () => {
      const values = (view.state as { values?: unknown[] }).values ?? [];
      return values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as {
        context: { updateViewport(range: { from: number; to: number }): void; work(timeout: number, upto: number): unknown; isDone(upto: number): boolean; tree: { toString(): string } };
        tree: { toString(): string };
      } | undefined;
    };
    const oldTree = findLang()?.tree;
    view.dispatch({ changes: { from: length, insert: "是" }, selection: { anchor: length + 1 } });
    const lang = findLang();
    if (!lang || !oldTree) throw new Error("language state not found");
    const docLen = view.state.doc.length;
    lang.context.updateViewport({ from: 0, to: docLen });
    lang.context.work(1000, docLen);
    // 强制制造 state 字段快照落后于 context 的形态（WKWebView 的现场）；只用于测试。
    lang.tree = oldTree;
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as
      { settleTo: number | null; settleStarted: number; settleStep(view: unknown): void; tree: { toString(): string } } | undefined;
    if (!plugin) throw new Error("ListLayout plugin not found");
    const stateNodes = lang.tree.toString();
    const contextNodes = lang.context.tree.toString();
    plugin.settleTo = docLen;
    plugin.settleStarted = performance.now();
    plugin.settleStep(view);
    return {
      contextDone: lang.context.isDone(docLen),
      stateNodes,
      contextNodes,
      contextNodesAfter: lang.context.tree.toString(),
      pluginTreeAfter: plugin.tree.toString(),
    };
  }, doc.length);
  expect(probe.contextDone).toBe(true);
  expect(probe.contextNodes).toContain("BulletList");
  expect(probe.stateNodes).not.toContain("BulletList");
  // context 树已含列表；build/后续 scan 必须沿用它，不要求 state 快照已同步。
  expect(probe.contextNodesAfter).toContain("BulletList");
  expect(probe.pluginTreeAfter, "settleStep 后 ListLayout 必须持有 context 树").toContain("BulletList");
  await expect.poll(() => bodyState(page)).toEqual({ doc: `${doc}是`, anchor: doc.length + 1, head: doc.length + 1 });
  await expect.poll(async () => page.locator(".cm-lp-list-marker").count()).toBe(1);
  await expect(page.locator(".cm-line").last()).toContainText("是");
});

test("正文 IME：源码已回 setext 时不得沿用旧 context 树的 list 判定（Chromium）", async ({ page }) => {
  // 构造删空残留的确定性形态：源码已从 `- s` 变回 setext 的 `- `，但 parse context 仍是
  // 删除前的 list 树且自认已解析到行末（ensureSyntaxTree 会原样返回它）。settleStep 必须按
  // 当前 doc 重建对照树，不能凭旧树的 list 判定直接 build + 收束。
  const doc = "词汇\n- s";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length - 1);
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  const probe = await page.locator(".cm-content").evaluate((el, before) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const findLang = () => {
      const values = (view.state as { values?: unknown[] }).values ?? [];
      return values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as any;
    };
    const oldTree = findLang()?.tree;
    if (!oldTree) throw new Error("language state not found");
    // 组合删除：源码 `词汇\n- s` → `词汇\n- `（setext）。随后把 context/state 一起伪装成
    // 删除前自认已完成的旧 list 树（WKWebView 失败现场的形态；只用于测试）。
    view.dispatch({ changes: { from: before - 1, to: before }, selection: { anchor: before - 1 } });
    const lang = findLang();
    lang.context.tree = oldTree;
    lang.context.treeLen = oldTree.length;
    lang.tree = oldTree;
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as
      { settleTo: number | null; settleStarted: number; settleStep(view: unknown): void; tree: any; settledTree: unknown } | undefined;
    if (!plugin) throw new Error("ListLayout plugin not found");
    plugin.settleTo = view.state.doc.length;
    plugin.settleStarted = performance.now();
    plugin.settleStep(view);
    return {
      doc: view.state.doc.toString(),
      settledNodes: String(plugin.tree.toString()),
      retained: plugin.settledTree !== null,
    };
  }, doc.length);
  expect(probe.doc).toBe("词汇\n- ");
  // 不是靠隐藏 marker：settle 采用的树本身必须不再判 list。
  expect(probe.settledNodes, "settle 后采用的树不得仍是旧 BulletList").not.toContain("BulletList");
  expect(probe.settledNodes).toContain("SetextHeading2");
  expect(probe.retained, "对照树与落后 state 分歧时必须保留给后续更新").toBe(true);
  // 下一拍非文档更新（selection）也不得把旧行重新渲染成 marker。
  await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await expect.poll(async () => page.locator(".cm-line").allTextContents()).toEqual(["词汇", "- "]);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
});

test("正文 IME：parse_done 收束后非文档更新不得复用旧 context 树（Chromium）", async ({ page }) => {
  // parse_done 在 context/state 都判 list 时不得保留 context 树：否则后续 selection /
  // metadata 更新会把旧树装回 this.tree，压过已同步的 state 树（P2-2 的复用通道）。
  const doc = "词汇\n- 是";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length);
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const probe = await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const findLang = () => {
      const values = (view.state as { values?: unknown[] }).values ?? [];
      return values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as any;
    };
    const lang = findLang();
    if (!lang) throw new Error("language state not found");
    // 让入口的 syntaxTreeAvailable 为 false，settleStep 走「分片解析 → parse_done」分支。
    lang.context.treeLen = 0;
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as
      { settleTo: number | null; settleStarted: number; settleStep(view: unknown): void; tree: any; settledTree: unknown } | undefined;
    if (!plugin) throw new Error("ListLayout plugin not found");
    plugin.settleTo = length;
    plugin.settleStarted = performance.now();
    plugin.settleStep(view);
    const settledNodes = String(plugin.tree.toString());
    const retainedAfterSettle = plugin.settledTree !== null;
    // 模拟 state 树已同步为 setext（同一长度、同一位置的对照树），再来一次非文档更新。
    // settleStep 收束时会 dispatch metadataReady（发布装饰），LanguageState 已换对象——必须
    // 重新取当前 state 的 lang，改旧对象不会影响后续 update。
    const live = findLang();
    const setextTree = live.context.parser.parse("词汇\n-  ");
    live.tree = setextTree;
    live.context.tree = setextTree;
    live.context.treeLen = setextTree.length;
    view.dispatch({ selection: { anchor: length } });
    return {
      settledNodes,
      retainedAfterSettle,
      pluginNodes: String(plugin.tree.toString()),
      doc: view.state.doc.toString(),
    };
  }, doc.length);
  expect(probe.doc).toBe("词汇\n- 是");
  expect(probe.settledNodes).toContain("BulletList");
  expect(probe.retainedAfterSettle, "context/state 都判定 list 时不得保留 context 树").toBe(false);
  expect(probe.pluginNodes, "selection 更新后必须取同步后的 state 树").not.toContain("BulletList");
  await expect.poll(async () => page.locator(".cm-line").allTextContents()).toEqual(["词汇", "- 是"]);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
});

test("正文 IME：>32KB 文档删空后对照解析跨拍推进并撤掉旧 marker（Chromium）", async ({ page }) => {
  // 32KB 不是正确性边界：目标位置超过它时，对照解析跨 settle 拍继续推进，最终仍按当前
  // 源码撤掉旧 list marker；不得把旧树判定 build/publish 成结论。
  const doc = "para\n\n".repeat(7500) + "词汇\n- s";
  await openBody(page, "oracle.md", doc);
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  const probe = await page.locator(".cm-content").evaluate((el, to) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const findLang = () => {
      const values = (view.state as { values?: unknown[] }).values ?? [];
      return values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as any;
    };
    const lang = findLang();
    if (!lang) throw new Error("language state not found");
    lang.context.updateViewport({ from: 0, to });
    if (!lang.context.work(3000, to)) throw new Error("full parse did not finish");
    const oldTree = lang.context.tree;
    const oldLen = oldTree.length;
    if (!String(oldTree).includes("BulletList")) throw new Error("baseline tree is not a list");
    view.dispatch({ changes: { from: to - 1, to }, selection: { anchor: to - 1 } });
    const live = findLang();
    live.context.tree = oldTree;
    live.context.treeLen = oldLen;
    live.tree = oldTree;
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as any;
    if (!plugin) throw new Error("ListLayout plugin not found");
    const newLen = view.state.doc.length;
    const done = live.context.isDone(newLen);
    plugin.settleTo = newLen;
    plugin.settleStarted = performance.now();
    plugin.settleStep(view);
    return { newLen, done, pending: plugin.referenceParse !== null };
  }, doc.length);
  expect(probe.newLen).toBe(45_005);
  expect(probe.newLen).toBeGreaterThan(32 * 1024);
  expect(probe.done, "旧 context 必须自认已解析到目标行（失败现场形态）").toBe(true);
  expect(probe.pending, "首拍对照解析未完成时必须保留 settle 目标").toBe(true);
  await expect.poll(async () => page.locator(".cm-lp-list-marker").count(), { timeout: 20_000 }).toBe(0);
  await expect.poll(async () => page.locator(".cm-line").last().textContent()).toBe("- ");
  await expect.poll(async () => page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return ((view.plugins ?? []).map((entry: { value?: unknown }) => entry.value)
      .find((value: any) => value && typeof value.settleStep === "function") as any).settleTo;
  }), { timeout: 20_000 }).toBeNull();
  const final = await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as any;
    return {
      tree: String(plugin.tree?.toString?.() ?? ""),
      settleTo: plugin.settleTo,
      busy: plugin.referenceParse !== null,
    };
  });
  expect(final.tree).toContain("SetextHeading2");
  expect(final.tree).not.toContain("BulletList");
  expect(final.settleTo, "对照解析完成后必须收束").toBeNull();
  expect(final.busy).toBe(false);
});

test("正文 IME：state 同步覆盖收束目标后非文档更新必须改用当前树（Chromium）", async ({ page }) => {
  // 长文档：目标行在末尾，20ms 的 state apply 只能解析到中途（state.length < to）→ 收束保留
  // 只到目标行的截断树。随后把 state/context 同步为覆盖全文的新树并 dispatch selection：
  // 非文档更新必须重跑 reconciliation，清除保留树并改用 state 树——后续列表行 marker
  // 只能来自新树（截断树不含它）。
  const doc = "para\n\n".repeat(7500) + "词汇\n- s\n\n- 后项";
  await openBody(page, "oracle.md", doc);
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(2);
  const cut = doc.length - 7;
  const settled = await page.locator(".cm-content").evaluate((el, position) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const findLang = () => {
      const values = (view.state as { values?: unknown[] }).values ?? [];
      return values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as any;
    };
    const lang = findLang();
    if (!lang) throw new Error("language state not found");
    lang.context.updateViewport({ from: 0, to: view.state.doc.length });
    if (!lang.context.work(3000, view.state.doc.length)) throw new Error("full parse did not finish");
    const oldTree = lang.context.tree;
    if (!String(oldTree).includes("BulletList")) throw new Error("baseline tree is not a list");
    view.dispatch({ changes: { from: position, to: position + 1 }, selection: { anchor: position } });
    const live = findLang();
    // 模拟现场：state 字段树未覆盖目标行；context 自认已完成且仍是删除前的 list 树。
    live.tree = live.context.parser.parse("词汇");
    live.context.tree = oldTree;
    live.context.treeLen = oldTree.length;
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as any;
    if (!plugin) throw new Error("ListLayout plugin not found");
    const newLen = view.state.doc.length;
    const to = newLen - 6;
    plugin.settleTo = to;
    plugin.settleStarted = performance.now();
    plugin.settleStep(view);
    return { newLen, to, stateLen: live.tree.length };
  }, cut);
  expect(settled.newLen).toBe(45_011);
  expect(settled.stateLen).toBeLessThan(settled.to);
  await expect.poll(async () => page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return ((view.plugins ?? []).map((entry: { value?: unknown }) => entry.value)
      .find((value: any) => value && typeof value.settleStep === "function") as any).settleTo;
  }), { timeout: 20_000 }).toBeNull();
  const held = await page.locator(".cm-content").evaluate((el, to) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const plugin = ((view.plugins ?? []).map((entry: { value?: unknown }) => entry.value)
      .find((value: any) => value && typeof value.settleStep === "function") as any);
    return {
      retained: plugin.settledTree !== null,
      treeLen: plugin.tree.length,
      markers: el.querySelectorAll(".cm-lp-list-marker").length,
    };
  }, settled.to);
  expect(held.retained, "state 未覆盖目标行时必须保留截断的收束树").toBe(true);
  // 对照解析停在目标行末（可能含行尾换行），但必须短于全文、不含后续列表行。
  expect(held.treeLen).toBeGreaterThanOrEqual(settled.to);
  expect(held.treeLen).toBeLessThan(settled.newLen);
  expect(held.markers, "截断树不含后续列表行：临时失去 marker").toBe(0);
  const synced = await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const findLang = () => {
      const values = (view.state as { values?: unknown[] }).values ?? [];
      return values.find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as any;
    };
    const live = findLang();
    if (!live) throw new Error("language state not found");
    const fullTree = live.context.parser.parse(view.state.doc.toString());
    live.tree = fullTree;
    live.context.tree = fullTree;
    live.context.treeLen = fullTree.length;
    view.dispatch({ selection: { anchor: 0 } });
    const plugin = ((view.plugins ?? []).map((entry: { value?: unknown }) => entry.value)
      .find((value: any) => value && typeof value.settleStep === "function") as any);
    return {
      retained: plugin.settledTree !== null,
      treeLen: plugin.tree.length,
      tree: String(plugin.tree.toString()),
      markers: el.querySelectorAll(".cm-lp-list-marker").length,
      lastLine: [...el.querySelectorAll(".cm-line")].at(-1)?.textContent ?? "",
      docLen: view.state.doc.length,
    };
  });
  expect(synced.retained, "state 已覆盖收束目标且判定一致时必须清除保留树").toBe(false);
  expect(synced.treeLen).toBe(synced.docLen);
  expect(synced.tree).toContain("BulletList");
  expect(synced.markers, "后续列表行 marker 必须来自同步后的 state 树").toBe(1);
  await expect.poll(async () => page.locator(".cm-line").last().textContent()).toBe("–后项");
});

test("正文 IME：>32KB 文档的真正空列表项不得被对照解析误删 marker（Chromium）", async ({ page }) => {
  // 对照：同样的长前缀 + 真正空列表项。对照树仍判 list，marker 必须保留。
  const doc = "para\n\n".repeat(7500) + "x\n\n- ";
  await openBody(page, "oracle.md", doc);
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  const probe = await page.locator(".cm-content").evaluate((el, to) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const lang = ((view.state as { values?: unknown[] }).values ?? [])
      .find((value) => value && typeof value === "object" && "context" in value && "tree" in value) as any;
    if (!lang) throw new Error("language state not found");
    lang.context.updateViewport({ from: 0, to });
    if (!lang.context.work(3000, to)) throw new Error("full parse did not finish");
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as any;
    if (!plugin) throw new Error("ListLayout plugin not found");
    plugin.settleTo = to;
    plugin.settleStarted = performance.now();
    plugin.settleStep(view);
    return { pending: plugin.referenceParse !== null };
  }, doc.length);
  expect(probe.pending, "首拍对照解析未完成时必须保留 settle 目标").toBe(true);
  await expect.poll(async () => page.locator(".cm-lp-list-marker").count(), { timeout: 20_000 }).toBe(1);
  await expect.poll(async () => page.locator(".cm-line").last().textContent()).toBe("–");
  await expect.poll(async () => page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return ((view.plugins ?? []).map((entry: { value?: unknown }) => entry.value)
      .find((value: any) => value && typeof value.settleStep === "function") as any).settleTo;
  }), { timeout: 20_000 }).toBeNull();
  const final = await page.locator(".cm-content").evaluate((el) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const plugin = ((view as { plugins?: { value?: unknown }[] }).plugins ?? [])
      .map((entry) => entry.value)
      .find((value) => value && typeof (value as { settleStep?: unknown }).settleStep === "function") as any;
    return { tree: String(plugin.tree?.toString?.() ?? ""), settleTo: plugin.settleTo, busy: plugin.referenceParse !== null };
  });
  expect(final.tree).toContain("BulletList");
  expect(final.settleTo).toBeNull();
  expect(final.busy).toBe(false);
});

test("IME 组合结束前已有 pending DOM 候选：候选必须进入文档且 marker 恢复（Chromium）", async ({ page }) => {
  const doc = "词汇\n- ";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length);
  await expect(page.locator(".cm-line")).toHaveCount(2);
  await expect(page.locator(".cm-line").nth(1)).toContainText("-");
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
  const probe = await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // 最终候选已写进 DOM，但 CM 尚未把 MutationRecord 转成事务。
    const line = [...el.querySelectorAll<HTMLElement>(".cm-line")].at(-1)!;
    // setext 候选在编辑态由非可编辑 shield 隔离；候选文本节点必须落在 shield 之后，
    // 不能写进 widget 内部（浏览器/IME 也不会往 contenteditable=false 节点里写）。
    const shield = line.querySelector(".cm-lp-source-shield");
    let text: Text | null = null;
    if (shield) {
      text = document.createTextNode("是");
      line.appendChild(text);
    } else {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) text = walker.currentNode as Text;
      if (!text) throw new Error("末尾行没有文本节点: " + JSON.stringify({ html: line.innerHTML, text: line.textContent, kids: [...line.childNodes].map((node) => node.nodeName) }));
      text.nodeValue = (text.nodeValue ?? "") + "是";
    }
    if (!text) throw new Error("候选文本节点未建立");
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, (text.nodeValue ?? "").length);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    const pendingBefore = (view as { observer: { pendingRecords(): readonly unknown[] } }).observer.pendingRecords().length;
    const docBefore = view.state.doc.toString();
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { pendingBefore, docBefore };
  }, doc.length);
  expect(probe.docBefore).toBe(doc); // 候选尚未进入 EditorState
  expect(probe.pendingBefore, "compositionend 前必须存在 pending MutationRecord").toBeGreaterThan(0);
  // 同步 dispatch 会在这里丢掉候选；延迟到 CM flush 之后才允许 effect。
  await expect.poll(() => bodyState(page)).toEqual({ doc: `${doc}是`, anchor: doc.length + 1, head: doc.length + 1 });
  await expect(page.locator(".cm-line").nth(1)).toContainText("是");
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
});

test("IME 组合期间冻结列表装饰，提交后再刷新", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 原生 IME 由 dev 事件日志复核");
  const doc = "词汇\n- ";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  const compose = async (text: string) => cdp.send("Input.imeSetComposition", {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  await compose("s");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("词汇\n- s");
  await page.waitForTimeout(80); // 等过一个后台周期：组合期 timer 到期也不得插入 marker
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
  expect(await page.locator(".cm-line").allTextContents()).toEqual(["词汇", "- s"]);

  await compose("sh");
  await cdp.send("Input.insertText", { text: "是" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("词汇\n- 是");
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  const committedLine = await page.locator(".cm-line").nth(1).textContent();
  expect(committedLine).not.toContain("-");
  expect(committedLine).toContain("是");
});

test("IME 非末项组合输入：冻结期间后续 marker 随源码映射，提交后归属不变", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 原生 IME 由 dev 事件日志复核");
  const doc = "- \n- next\n- third";
  await openBody(page, "oracle.md", doc);
  await expect(page.locator(".cm-lp-list-line")).toHaveCount(3);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(3);
  await setBodyCaret(page, 2);
  const cdp = await page.context().newCDPSession(page);
  const compose = async (text: string) => cdp.send("Input.imeSetComposition", {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  const expectRows = async (first: string) => {
    const rows = page.locator(".cm-lp-list-line");
    await expect(rows).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) await expect(rows.nth(index).locator(".cm-lp-list-marker")).toHaveCount(1);
    await expect(rows.nth(0)).toContainText(first);
    await expect(rows.nth(1)).toContainText("next");
    await expect(rows.nth(2)).toContainText("third");
  };

  await compose("s");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("- s\n- next\n- third");
  await expectRows("s");
  await compose("sh");
  await cdp.send("Input.insertText", { text: "是" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("- 是\n- next\n- third");
  await expectRows("是");
});

const IME_LIST_CASES = [
  { name: "段落后 - 的 setext / 列表切换", doc: "- ref\n\n词汇\n- ", lines: null, marker: "–", compareTarget: "setext", reference: 0 },
  { name: "真 bullet 空项", doc: "- ", lines: null, marker: "–", compareTarget: "before", reference: null },
  { name: "真有序空项", doc: "1. ", lines: null, marker: "1.", compareTarget: "before", reference: null },
  { name: "嵌套空项", doc: "- parent\n  - ", lines: null, marker: "◦", compareTarget: "before", reference: null },
  { name: "非 setext 裸 marker", doc: "para\n+ ", lines: null, marker: "–", compareTarget: "before", reference: null },
] as const;

for (const fixture of IME_LIST_CASES) {
  test(`正文 CDP 真引擎 IME：${fixture.name}的组合编辑保真（Chromium）`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 合成事件不能冒充原生 IME");
    const { doc } = fixture;
    const docLines = doc.split("\n");
    const targetIndex = docLines.length - 1;
    await openBody(page, "oracle.md", doc);
    await setBodyCaret(page, doc.length);
    await expect.poll(async () => (await listRenderSnapshot(page)).length).toBe(docLines.length);
    const before = await settledRenderSnapshot(page);
    const cdp = await page.context().newCDPSession(page);
    const compose = async (text: string) => cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });

    await compose("s");
    await expect.poll(async () => (await bodyState(page)).doc.includes("s")).toBe(true);
    // 等过一个 16ms 后台周期：组合期装饰必须保持组合前形态（timer 到期也不发布）。
    await page.waitForTimeout(80);
    const during = await listRenderSnapshot(page);
    expect(renderGeometry(during)).toEqual(renderGeometry(before));
    const inserted = await bodyState(page);

    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await bodyState(page)).doc.includes("s")).toBe(false);
    const deleted = await bodyState(page);
    expect(renderGeometry(await listRenderSnapshot(page))).toEqual(renderGeometry(before));
    // marked text 已空时再退格 MUST 是 no-op，不得吃掉 marker 或前一段正文。
    await page.keyboard.press("Backspace");
    const atCompositionStart = await bodyState(page);
    expect(renderGeometry(await listRenderSnapshot(page))).toEqual(renderGeometry(before));
    const lines = await page.locator(".cm-line").allTextContents();
    expect({ inserted, deleted, atCompositionStart }).toEqual({
      inserted: { doc: `${doc}s`, anchor: doc.length + 1, head: doc.length + 1 },
      deleted: { doc, anchor: doc.length, head: doc.length },
      atCompositionStart: { doc, anchor: doc.length, head: doc.length },
    });
    expect(lines).toHaveLength(docLines.length);
    // 组合删除不得清空相邻的非空行；源码里的空行仍应为空（setext fixture 有一个分隔空行）。
    const sourceNonEmpty = docLines.map((line) => line.length > 0);
    expect(lines.filter((_, index) => sourceNonEmpty[index]).every((line) => line.length > 0), "组合删除不得清空非空行").toBe(true);
    expect(lines.filter((_, index) => !sourceNonEmpty[index])).toEqual(docLines.filter((line) => line.length === 0));
    if (fixture.lines !== null) expect(lines).toEqual(fixture.lines);

    await compose("s👨‍👩‍👧");
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await bodyState(page)).doc).toBe(`${doc}s`);
    expect(renderGeometry(await listRenderSnapshot(page))).toEqual(renderGeometry(before));
    await cdp.send("Input.insertText", { text: "是" });
    const committed = `${doc}是`;
    await expect.poll(async () => (await bodyState(page)).doc).toBe(committed);
    await expect.poll(async () => (await listRenderSnapshot(page))[targetIndex].markerText).toBe(fixture.marker);
    const after = await settledRenderSnapshot(page);
    expect(after).toHaveLength(docLines.length);
    // 每行至多一个 marker；目标行必须是合同 glyph/序号，且正文 x 落在行内缩进之后。
    expect(after.every((row) => row.markerCount <= 1), "marker 不得重复").toBe(true);
    expect(after[targetIndex].markerCount).toBe(1);
    expect(after[targetIndex].markerText).toBe(fixture.marker);
    expect(after[targetIndex].bodyX).toBeGreaterThan(after[targetIndex].lineLeft);
    if (fixture.compareTarget === "before") {
      // 真列表的目标行在组合前已是同一列表项：提交后的 padding / fontSize / color /
      // bodyX 必须逐项与组合前相同（只比较几何，文本随提交变化）。
      expect(renderGeometry([after[targetIndex]])).toEqual(renderGeometry([before[targetIndex]]));
    } else {
      // setext 候选在组合前按标题语义没有 marker；提交后是顶层 bullet。与同文档、同字体的
      // 顶层真 bullet（reference 行）逐项比较数值几何——padding / bodyX 不得漂移。
      expect(fixture.reference).not.toBeNull();
      const reference = after[fixture.reference!];
      expect(reference.markerCount).toBe(1);
      expect(reference.markerText).toBe(fixture.marker);
      expect(reference.linePadding).not.toBe("0px");
      expect(reference.bodyX).toBeGreaterThan(reference.lineLeft);
      expect(after[targetIndex]).toMatchObject({
        markerCount: 1,
        markerText: reference.markerText,
        display: reference.display,
        fontSize: reference.fontSize,
        color: reference.color,
        linePadding: reference.linePadding,
        lineLeft: reference.lineLeft,
        bodyX: reference.bodyX,
      });
    }
    // 非目标行（相邻段落 / 父项）的几何与样式逐项不变——文档对但渲染漂移会在这里红。
    for (let index = 0; index < after.length; index += 1) {
      if (index === targetIndex) continue;
      expect(renderGeometry([after[index]])).toEqual(renderGeometry([before[index]]));
    }
    await page.keyboard.press("Meta+s");
    await expect.poll(async () => fileText(page, "oracle.md")).toBe(committed);

    await page.waitForTimeout(600);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => bodyState(page)).toEqual({ doc, anchor: doc.length, head: doc.length });
    await expect.poll(async () => renderGeometry(await settledRenderSnapshot(page))).toEqual(renderGeometry(before));
    await page.keyboard.press("Meta+Shift+z");
    await expect.poll(() => bodyState(page)).toEqual({ doc: committed, anchor: committed.length, head: committed.length });
    await expect.poll(async () => renderGeometry(await settledRenderSnapshot(page))).toEqual(renderGeometry(after));
  });
}

const IME_SCOPE_CASES = [
  { name: "普通段落", doc: "alpha beta", pos: 5 },
  { name: "围栏代码块内的 marker 形文本", doc: "```\n- alpha\n```", pos: 6 },
  { name: "表格 cell", doc: "| a | b |\n|---|---|\n| c | d |", pos: 22 },
] as const;

for (const scope of IME_SCOPE_CASES) {
  test(`IME 非列表位置不接管组合删除：${scope.name}（Chromium）`, async ({ page }) => {
    await openBody(page, "oracle.md", scope.doc);
    await setBodyCaret(page, scope.pos);
    const result = await page.locator(".cm-content").evaluate((el, pos) => {
      const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      // 模拟 marked text：组合起点后插入一个字符，光标到其后。
      view.dispatch({ changes: { from: pos, insert: "s" }, selection: { anchor: pos + 1 } });
      const event = new InputEvent("beforeinput", { isComposing: true, bubbles: true, cancelable: true });
      // Chromium 构造器把不认识的 deleteCompositionText 归一成空串；保留 WKWebView 原值。
      Object.defineProperty(event, "inputType", { value: "deleteCompositionText" });
      const prevented = !el.dispatchEvent(event);
      el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      return { prevented, doc: view.state.doc.toString(), head: view.state.selection.main.head };
    }, scope.pos);
    // 旧实现会在这里 preventDefault + 显式事务删掉 marked 字符；L6 收窄后必须交回原生 IME。
    expect(result.prevented, "非列表位置的组合删除 MUST 交回原生 IME").toBe(false);
    expect(result.doc).toBe(`${scope.doc.slice(0, scope.pos)}s${scope.doc.slice(scope.pos)}`);
    expect(result.head).toBe(scope.pos + 1);
  });
}

test("IME 组合中后台 timer 到期不发布，组合结束后补回新组 marker（Chromium）", async ({ page }) => {
  const doc = "- a\n- b";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, 2);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(2);
  const state = await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    // 新起一个独立列表组（ol 与前面的 ul 不同组）：组扫描登记后 16ms timer 会到期；
    // 紧接着进入组合，让 timer 落在组合窗口内。这一拍不允许发布新组 marker（冻结），
    // 结束组合后才补。
    const insert = "\n\n1. c\n2. d";
    view.dispatch({ changes: { from: length, insert }, selection: { anchor: length + insert.length } });
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    return { doc: view.state.doc.toString(), markers: el.querySelectorAll(".cm-lp-list-marker").length };
  }, doc.length);
  expect(state.doc).toBe("- a\n- b\n\n1. c\n2. d");
  expect(state.markers, "新组尚未扫描发布").toBe(2);
  await page.waitForTimeout(80); // 后台 timer 在组合窗口内到期
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(2); // 冻结：不得发布新组
  await expect(page.locator(".cm-lp-list-line")).toHaveCount(2); // 新组尚无 line 装饰
  await page.locator(".cm-content").evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(4);
  const rows = await settledRenderSnapshot(page);
  expect(rows.filter((row) => row.markerCount === 1), "组合结束后每组每项恰一个 marker").toHaveLength(4);
  expect(rows.every((row) => row.markerCount <= 1), "marker 不得重复").toBe(true);
});

test("IME 取消组合：marked text 撤掉后 compositionend 恢复组合前形态（Chromium）", async ({ page }) => {
  const doc = "词汇\n- ";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
  await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    view.dispatch({ changes: { from: length, insert: "s" }, selection: { anchor: length + 1 } });
  }, doc.length);
  await page.waitForTimeout(80);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0); // 组合期冻结
  await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    // 取消组合：撤掉模拟 marked text，再结束组合。
    view.dispatch({ changes: { from: length, to: length + 1 }, selection: { anchor: length } });
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  }, doc.length);
  await expect.poll(() => bodyState(page)).toEqual({ doc, anchor: doc.length, head: doc.length });
  expect(await page.locator(".cm-line").allTextContents()).toEqual(["词汇", "- "]);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
});

test("正文 IME 大文档：解析未完成时组合结束走有界恢复并最终补回 marker（Chromium）", async ({ page }, info) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(`console: ${message.text()}`); });
  // 记录所有 setTimeout 回调的实际执行时长，并用调用栈标出 settle 回调；用来测
  // settleStep 的真实工作切片，而不是把 compositionend 入口时间冒充解析成本。
  await page.addInitScript(() => {
    const real = window.setTimeout;
    (window as unknown as { __timerSamples: { delay: number; ms: number; settle: boolean }[] }).__timerSamples = [];
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => real(() => {
      const start = performance.now();
      try { if (typeof callback === "function") callback(...args as []); }
      finally {
        const source = typeof callback === "function" ? callback.toString() : String(callback);
        (window as unknown as { __timerSamples: { delay: number; ms: number; settle: boolean }[] }).__timerSamples.push({
          delay: delay ?? 0,
          ms: performance.now() - start,
          settle: /settleStep|beginSettle/.test(source),
        });
      }
    }, delay)) as typeof window.setTimeout;
  });
  // 先用一个短列表把 ListLayout 的字体测量与 marker 渲染走通，再在它后面拼 >1MB 正文；
  // 目标行是新出现的末尾 `- s`（没有旧装饰可复用），首拍视口仍在顶部。
  await openBody(page, "oracle.md", "- a");
  // 等初始 marker 渲染完成：字体测量（units）是异步 requestMeasure，未就绪时大文档插入会
  // 让 ListLayout 一直不出 line 装饰，测到的就不是恢复链而是初始化时序。
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  await setBodyCaret(page, 3);
  const probe = await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const body = "\n" + "para\n\n".repeat(200000) + "- ";
    view.dispatch({ changes: { from: length, insert: body }, selection: { anchor: length + body.length } });
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    // 模拟候选提交：末尾 "- " 变为 "- s"（列表）；组合结束的恢复链要把它渲染出来。
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert: "s" }, selection: { anchor: end + 1 } });
    const values = (view.state as { values?: unknown[] }).values ?? [];
    const lang = values.find((value) => value && typeof value === "object" && "context" in value && "tree" in (value as object)) as
      { tree?: { length: number } } | undefined;
    const treeBefore = lang?.tree?.length ?? -1;
    const started = performance.now();
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    // 事件入口耗时：只含 compositionend handler，不含异步 settle 分片。
    const entryMs = performance.now() - started;
    return {
      docLen: view.state.doc.length,
      treeBefore,
      entryMs,
      renderedLines: el.querySelectorAll(".cm-line").length,
    };
  }, 3);
  expect(probe.docLen).toBeGreaterThan(1_000_000);
  // 覆盖前提：组合结束那一拍语法树尚未覆盖提交行（否则本用例测不到「解析未完成」）。
  expect(probe.treeBefore, "组合结束时语法树 MUST 尚未覆盖提交行").toBeLessThan(probe.docLen);
  expect(probe.renderedLines, "大文档首拍只渲染视口附近").toBeLessThan(1000);
  // 把视口滚到末尾；解析与装饰重建由有界恢复链继续推进。
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const markerStart = Date.now();
  await expect.poll(async () => (await listRenderSnapshot(page)).at(-1)?.markerCount ?? 0, { timeout: 10000 }).toBe(1);
  const markerMs = Date.now() - markerStart;
  expect(probe.entryMs).toBeLessThan(50); // 事件入口有界（异步 settle 不在此计时内）
  expect(markerMs).toBeLessThan(5000);
  // 恢复链不得在 EditorView.update 内 dispatch（会让插件崩溃、装饰整段消失）。
  expect(pageErrors.filter((entry) => /plugin crashed|not allowed while an update/.test(entry))).toEqual([]);
  const rows = await settledRenderSnapshot(page);
  expect(rows.every((row) => row.markerCount <= 1)).toBe(true);
  expect(rows.at(-1)?.markerText).toBe("–");
  const timerSamples = await page.evaluate(() => (window as unknown as { __timerSamples: { delay: number; ms: number; settle: boolean }[] }).__timerSamples);
  const settleSamples = timerSamples.filter((sample) => sample.settle);
  const settleSlices = settleSamples.map((sample) => sample.ms);
  const settleSliceMaxMs = settleSlices.length ? Math.max(...settleSlices) : -1;
  // 实际 settleStep 回调切片有界；不是把入口时间冒充解析成本。
  expect(settleSamples.length, `必须采到 settleStep 回调：${JSON.stringify(timerSamples.slice(0, 20))}`).toBeGreaterThan(0);
  // 1MB 结构化 fixture：parse-only 分片实测 8.9ms；state/context 不同步时的**一次性**
  // forceParsing(0) 空事务同步实测 40.9ms（只在必要时发生，不是每片成本），故上界取 60ms。
  expect(settleSlices.some((ms) => ms < 30), "parse-only 分片应低于 30ms").toBe(true);
  expect(settleSliceMaxMs, JSON.stringify(settleSamples.slice(0, 20))).toBeLessThan(60);
  await info.attach("ime-large-doc-settle", {
    body: JSON.stringify({
      docLen: probe.docLen,
      treeBefore: probe.treeBefore,
      entryMs: probe.entryMs,
      markerMs,
      settleSliceMaxMs,
      settleSlices: settleSlices.slice(0, 20),
      renderedLines: probe.renderedLines,
    }),
    contentType: "application/json",
  });
});

test("IME 组合结束越过 4s 截止后仍低频恢复 marker 且不重复（Chromium）", async ({ page }) => {
  await page.addInitScript(() => {
    const real = window.setTimeout;
    (window as unknown as { __timerDelays: number[] }).__timerDelays = [];
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      (window as unknown as { __timerDelays: number[] }).__timerDelays.push(delay ?? 0);
      return real(callback, delay, ...args as []);
    }) as typeof window.setTimeout;
  });
  await openBody(page, "oracle.md", "- a");
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  await setBodyCaret(page, 3);
  // 用可控时钟把 settle 的 elapsed 推过 4s，确定性进入低频分支（不真等 4s）。
  await page.evaluate(() => {
    const realNow = performance.now.bind(performance);
    let offset = 0;
    (window as unknown as { __advanceImeClock(ms: number): void }).__advanceImeClock = (ms: number) => { offset += ms; };
    Object.defineProperty(performance, "now", { configurable: true, value: () => realNow() + offset });
  });
  const probe = await page.locator(".cm-content").evaluate(async (el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    // 2MB 文档：20ms 时解析一定还没覆盖末尾，保证下一拍进入 deadline 分支。
    const body = "\n" + "para\n\n".repeat(300000) + "- ";
    view.dispatch({ changes: { from: length, insert: body }, selection: { anchor: length + body.length } });
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const end = view.state.doc.length;
    view.dispatch({ changes: { from: end, insert: "s" }, selection: { anchor: end + 1 } });
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    // 等 deferred effect + beginSettle 捕获起点，再把时钟推过 4s：下一拍必须转低频，
    // 而不是 cancelSettle 后停止。
    await new Promise((resolve) => setTimeout(resolve, 20));
    (window as unknown as { __advanceImeClock(ms: number): void }).__advanceImeClock(5000);
    return { docLen: view.state.doc.length };
  }, 3);
  expect(probe.docLen).toBeGreaterThan(1_000_000);
  await page.locator(".cm-scroller").evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect.poll(async () => (await listRenderSnapshot(page)).at(-1)?.markerCount ?? 0, { timeout: 20000 }).toBe(1);
  const rows = await settledRenderSnapshot(page);
  expect(rows.every((row) => row.markerCount <= 1), "低频恢复不得产生重复 marker").toBe(true);
  expect(rows.at(-1)?.markerText).toBe("–");
  // 低频分支确实被调度（250ms）；旧实现在 4s 后 cancel，不会出现这个延迟。
  const delays = await page.evaluate(() => (window as unknown as { __timerDelays: number[] }).__timerDelays);
  expect(delays, "4s 后 MUST 转 250ms 低频恢复").toContain(250);
});

test("正文 IME 大文档：组合结束只补提交行，不解析整篇（Chromium）", async ({ page }, info) => {
  await openBody(page, "oracle.md", "- a");
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  await setBodyCaret(page, 3);
  const probe = await page.locator(".cm-content").evaluate((el, length) => {
    const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    // 组合提交行在文档开头（语法树已覆盖），大正文只追加在它后面。
    view.dispatch({ changes: { from: length, insert: "\n" + "para\n\n".repeat(200000) } });
    view.dispatch({ selection: { anchor: length } });
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const started = performance.now();
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    const entryMs = performance.now() - started;
    return { docLen: view.state.doc.length, entryMs, markers: el.querySelectorAll(".cm-lp-list-marker").length };
  }, 3);
  expect(probe.docLen).toBeGreaterThan(1_000_000);
  // 目标只到提交行末；旧实现同步 forceParsing(doc.length, 10) 会在这里耗满 10ms。
  // 这里量的是 compositionend 事件入口；实际 settle 分片与绘制路径另见大文档恢复用例。
  expect(probe.entryMs).toBeLessThan(8);
  expect(probe.markers).toBe(1);
  await info.attach("ime-large-doc-targeted", { body: JSON.stringify(probe), contentType: "application/json" });
});

test("正文 CDP IME：候选提交到 marker 绘制完成的路径（Chromium）", async ({ page, browserName }, info) => {
  test.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 原生 IME 由 dev 事件日志复核");
  const doc = "词汇\n- ";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, doc.length);
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(0);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "s", selectionStart: 1, selectionEnd: 1 });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("词汇\n- s");
  const commitStart = Date.now();
  await cdp.send("Input.insertText", { text: "是" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("词汇\n- 是");
  await expect(page.locator(".cm-lp-list-marker")).toHaveCount(1);
  const markerMs = Date.now() - commitStart;
  // 候选提交 → 两次 rAF：端到端绘制路径（含 CDP/Playwright 开销，只作路径证据）。
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const paintMs = Date.now() - commitStart;
  expect(paintMs).toBeLessThan(1000);
  await info.attach("ime-commit-to-paint", { body: JSON.stringify({ markerMs, paintMs }), contentType: "application/json" });
});

test("正文 CDP 真引擎 IME：紧邻普通输入的组合独立撤销，redo 与 dirty 跟随保存基线", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 合成事件不能冒充原生 IME");
  await openBody(page, "oracle.md", "词汇\n");
  await setBodyCaret(page, "词汇\n".length);
  await page.keyboard.type("- ");
  const before = "词汇\n- ";
  await expect.poll(() => bodyState(page)).toEqual({ doc: before, anchor: before.length, head: before.length });

  const cdp = await page.context().newCDPSession(page);
  const compose = async (text: string) => cdp.send("Input.imeSetComposition", {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  // 不在普通输入与 compositionstart 之间加历史屏障：组合 MUST 自成一步。
  await compose("s");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(`${before}s`);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await bodyState(page)).doc).toBe(before);
  await compose("sh");
  await cdp.send("Input.insertText", { text: "是" });
  const committed = "词汇\n- 是";
  await expect.poll(() => bodyState(page)).toEqual({ doc: committed, anchor: committed.length, head: committed.length });
  await page.keyboard.press("Meta+s");
  await expect.poll(async () => fileText(page, "oracle.md")).toBe(committed);
  await expect.poll(async () => (await dirtyReports(page)).at(-1)).toBe(false);

  await page.keyboard.press("Meta+z");
  await expect.poll(() => bodyState(page)).toEqual({ doc: before, anchor: before.length, head: before.length });
  await expect.poll(async () => (await dirtyReports(page)).at(-1)).toBe(true);
  await page.keyboard.press("Meta+Shift+z");
  await expect.poll(() => bodyState(page)).toEqual({ doc: committed, anchor: committed.length, head: committed.length });
  await expect.poll(async () => (await dirtyReports(page)).at(-1)).toBe(false);
});

test("保存：⌘S 后磁盘全文 = 模型终态；保存前盘上仍是旧文", async ({ page }) => {
  const doc = "alpha\n";
  await openBody(page, "oracle.md", doc);
  const model = new BodyOracle(doc, doc.length);
  await setBodyCaret(page, doc.length);
  await page.keyboard.type("beta");
  applyBodyOp(model, { kind: "insert", text: "beta" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe(model.doc);
  expect(await fileText(page, "oracle.md")).toBe(doc);

  await page.keyboard.press("Meta+s");
  await expect.poll(async () => fileText(page, "oracle.md")).toBe(model.doc);
  await expect(page.locator(".modeline-path")).not.toContainText("（未保存）");
});

test("witness 260 整链：⌘A 重写 + 三次 Enter + 第二段 + ⌘S（逐步对拍模型）", async ({ page }) => {
  await openBody(page, "oracle.md", "seed\n");
  await setBodyCaret(page, 0);
  await page.keyboard.press("Meta+a");
  await page.keyboard.type("- first");
  const model = new BodyOracle("", 0);
  applyBodyOp(model, { kind: "insert", text: "- first" });
  const typed = await bodyState(page);
  if (typed.doc !== "- first" || typed.doc !== model.doc) fail(0, 0, "insert(- first)", typed, model.reading(), typed);

  const steps: Array<[BodyOp, string]> = [
    [{ kind: "enter" }, "- first\n- "],
    [{ kind: "enter" }, "- first\n"],
    [{ kind: "enter" }, "- first\n\n"],
    [{ kind: "insert", text: "second" }, "- first\n\nsecond"],
  ];
  let step = 1;
  for (const [op, expected] of steps) {
    // 620ms 屏障：让每拍是独立的 CM history 事件（本用例只断言 doc/selection，不做 undo）。
    await page.waitForTimeout(620);
    const before = await bodyState(page);
    if (op.kind === "insert") await page.keyboard.type(op.text);
    else await page.keyboard.press("Enter");
    applyBodyOp(model, op);
    const actual = await bodyState(page);
    if (actual.doc !== expected || actual.doc !== model.doc || actual.head !== model.head) {
      fail(0, step, describeBodyOp(op), before, model.reading(), actual);
    }
    step += 1;
  }

  await page.waitForTimeout(620);
  await page.keyboard.press("Meta+s");
  await expect.poll(async () => fileText(page, "oracle.md")).toBe("- first\n\nsecond");
  await expect.poll(async () => (await bodyState(page)).doc).toBe("- first\n\nsecond");
});

for (const seed of SEEDS) {
  test(`正文随机对拍 seed=${seed}：真 view / 真键盘 / 真落盘`, async ({ page }) => {
    const doc = MIXED_DOC;
    await openBody(page, "oracle.md", doc);
    const model = new BodyOracle(doc, 0);
    const rng = makeRng((seed >>> 0) ^ 0x27d4eb2f);
    await setBodyCaret(page, 0);
    let lastWasEdit = false;
    let step = 0;
    for (let index = 0; index < 10; index += 1) {
      let op = randomBodyOp(rng, model);
      // undo / redo 只在上一步是编辑时发：选区事务会先被撤销，浏览器层的选区事件
      // 不在本模型的 history 粒度内（Node 层已用假时钟逐相对拍）。
      if ((op.kind === "undo" || op.kind === "redo") && !lastWasEdit) op = { kind: "insert", text: "u" };
      const before = await bodyState(page);
      if (op.kind === "insert") {
        await page.locator(".cm-content").evaluate((el, insert) => {
          const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
          const main = view.state.selection.main;
          view.dispatch({
            changes: { from: main.from, to: main.to, insert },
            selection: { anchor: main.from + insert.length },
            userEvent: "input.type",
          });
        }, op.text);
      } else if (op.kind === "setSelection") {
        await setBodyCaret(page, op.anchor);
        if (op.head !== op.anchor) {
          await page.locator(".cm-content").evaluate((el, range) => {
            const view = (el as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
            view.dispatch({ selection: { anchor: range.anchor, head: range.head } });
          }, op);
        }
      } else if (op.kind === "deleteBackward") {
        await page.keyboard.press("Backspace");
      } else if (op.kind === "deleteForward") {
        await page.keyboard.press("Delete");
      } else if (op.kind === "deleteLineBackward") {
        await page.keyboard.press("Meta+Backspace");
      } else if (op.kind === "enter") {
        if (op.at !== undefined) await setBodyCaret(page, op.at);
        await page.keyboard.press("Enter");
      } else if (op.kind === "bareBackspace") {
        if (op.at !== undefined) await setBodyCaret(page, op.at);
        await page.keyboard.press("Backspace");
      } else if (op.kind === "undo") {
        await page.keyboard.press("Meta+z");
      } else if (op.kind === "redo") {
        await page.keyboard.press("Meta+Shift+z");
      } else if (op.kind === "save") {
        await page.keyboard.press("Meta+s");
      }
      await page.waitForTimeout(620);
      applyBodyOp(model, op);
      const actual = await bodyState(page);
      const historyOp = op.kind === "undo" || op.kind === "redo";
      if (actual.doc !== model.doc || (!historyOp && (actual.anchor !== model.anchor || actual.head !== model.head))) {
        fail(seed, step, describeBodyOp(op), before, model.reading(), actual);
      }
      if (op.kind === "save") {
        await expect.poll(async () => fileText(page, "oracle.md")).toBe(model.doc);
      }
      lastWasEdit = op.kind === "insert" || op.kind === "deleteBackward" || op.kind === "deleteForward" || op.kind === "deleteLineBackward" || op.kind === "enter" || op.kind === "bareBackspace";
      step += 1;
    }
  });
}

// ---------------------------------------------------------------------------
// Composer：真 CM 文本面 + 真附件 tray
// ---------------------------------------------------------------------------

const QUOTE_CARD = {
  kind: "quote" as const,
  card: { file: "synthetic.md", heading: "合成", headingPath: "合成", lines: "1-1", text: "引用原文" },
};

async function openComposer(page: Page, text: string, caret: number, cards: unknown[]): Promise<void> {
  await stubTauri(page, vaultWith("oracle.md", "composer fixture\n"));
  await page.addInitScript(
    (payload) => {
      const w = window as unknown as Record<string, any>;
      w.__sentMessages = [];
      const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: unknown) => {
        if (cmd === "harness_send") {
          w.__sentMessages.push((args as { parts_json: string }).parts_json);
          return null;
        }
        if (cmd === "harness_draft_get") return JSON.stringify(payload.draft);
        if (cmd === "harness_draft_put") return null;
        if (cmd === "harness_state") return JSON.stringify({ messages: [], usage: { ctx_pct: 0, cache_pct_session: 0 }, pending_approval: null, warn_ctx_pct: 85 });
        if (cmd === "config_get") {
          const result: any = await invoke(cmd, args);
          if (result?.config) {
            result.config.harness = {
              provider: "mock",
              providers: (payload.providers as unknown),
              permissions: { allow: [], deny: [] },
              loop_max: 8,
              warn_ctx_pct: 85,
              auto_compact: true,
            };
          }
          return result;
        }
        return invoke(cmd, args);
      };
    },
    { draft: { version: 2, text, caret, cards }, providers: standardProviders() },
  );
  await page.goto("/");
  await page.locator('.ft-row[title="oracle.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect.poll(async () => (await composerState(page)).doc).toBe(text);
  await expect(page.locator(".lumir-hp-composer-tray > .lumir-hp-qcard")).toHaveCount(cards.length);
}

test("composer：⌘A + Backspace 只改文本；⌘Z 恢复；附件 × 可撤销", async ({ page }) => {
  await openComposer(page, "问题", 2, [QUOTE_CARD]);
  const content = page.locator(".lumir-hp-composer .cm-content");
  const tray = page.locator(".lumir-hp-composer-tray > .lumir-hp-qcard");
  await content.click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await composerState(page)).doc).toBe("");
  await expect(tray).toHaveCount(1);

  await page.waitForTimeout(1100);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc).toBe("问题");
  await expect(tray).toHaveCount(1);

  await tray.locator(".lumir-hp-qc-x").click();
  await expect(tray).toHaveCount(0);
  await page.waitForTimeout(1100);
  await page.keyboard.press("Meta+z");
  await expect(tray).toHaveCount(1);
  await expect.poll(async () => (await composerState(page)).doc).toBe("问题");
});

test("composer CDP 真引擎 IME：组合中删除 / 取消 / 提交（Chromium）", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 合成事件不能冒充原生 IME");
  await openComposer(page, "我", 1, [QUOTE_CARD]);
  const content = page.locator(".lumir-hp-composer .cm-content");
  await content.click();
  const tray = page.locator(".lumir-hp-composer-tray > .lumir-hp-qcard");
  const cdp = await page.context().newCDPSession(page);
  const model = new ComposerOracle({ text: "我", caret: 1, cards: ["q"] });
  let step = 0;
  const compare = async (label: string): Promise<void> => {
    const actual = await composerState(page);
    if (actual.doc !== model.text || actual.head !== model.head) {
      fail(0, step, label, { doc: model.text, anchor: model.anchor, head: model.head }, { doc: model.text, anchor: model.anchor, head: model.head }, actual);
    }
    await expect(tray).toHaveCount(1);
    step += 1;
  };
  const compose = async (text: string, replacementStart: number, replacementEnd = replacementStart): Promise<void> => {
    await cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
      replacementStart,
      replacementEnd,
    });
  };

  await compose("s", 1);
  applyComposerOp(model, { kind: "compositionStart" });
  applyComposerOp(model, { kind: "compositionUpdate", text: "s" });
  await expect.poll(async () => (await composerState(page)).doc).toBe("我s");
  await compare("compositionUpdate");


  await page.keyboard.press("Backspace");
  applyComposerOp(model, { kind: "compositionDelete" });
  await expect.poll(async () => (await composerState(page)).doc).toBe("我");
  await compare("compositionDelete");

  await compose("shuang", 1);
  applyComposerOp(model, { kind: "compositionUpdate", text: "shuang" });
  await page.keyboard.press("Backspace");
  applyComposerOp(model, { kind: "compositionDelete" });
  await page.keyboard.press("Backspace");
  applyComposerOp(model, { kind: "compositionDelete" });
  await compare("compositionDelete twice");

  await cdp.send("Input.imeSetComposition", {
    text: "",
    selectionStart: 0,
    selectionEnd: 0,
    replacementStart: 1,
    replacementEnd: 5,
  });
  applyComposerOp(model, { kind: "compositionCancel" });
  await expect.poll(async () => (await composerState(page)).doc).toBe("我");
  await compare("compositionCancel");

  await compose("shi", 1);
  applyComposerOp(model, { kind: "compositionStart" });
  applyComposerOp(model, { kind: "compositionUpdate", text: "shi" });
  await cdp.send("Input.insertText", { text: "是" });
  applyComposerOp(model, { kind: "compositionCommit", text: "是" });
  await expect.poll(async () => (await composerState(page)).doc).toBe("我是");
  await compare("compositionCommit");
  // 整段 IME 不得触发发送（CDP 的 Enter 会被浏览器当作候选确认、不进应用 keydown，
  // 发送门的事件序判据在 tests/unit/harness-ime-enter.test.ts 与 m361 场景）。
  expect(await page.evaluate(() => (window as unknown as { __sentMessages: string[] }).__sentMessages)).toEqual([]);
  expect(model.sends).toBe(0);
});

// ---------------------------------------------------------------------------
// M836：跨 replace 装饰边界的原生删除（有向矩阵）
//
// 缺陷（M835 双引擎实测）：裸 Delete / Backspace / ⌘⌫ 在行边界合并两行时，浏览器会把
// 「被吸收行」的 replace 装饰摊平成显示文本，CM 的 DOMReader 按文本回读——显示字形
// （列表 marker 的 `–` / `◦`、wikilink 的 label、公式渲染文本）与隐藏源码（`**`）因此
// 被写进源文档。修复是 beforeinput 的 state-only 闸门（src/editor.ts 的
// absorbLineMergeDelete）：空光标在行边界时 dispatch 单换行的显式事务。
//
// 本矩阵逐个方向覆盖：列表类型（- + * / 有序 / 任务 / 嵌套）、wikilink、行内公式、
// 隐藏标记（**）、普通行与 lazy 对照，以及 ⌘⌫；每格都先断言 widget 真的渲染出来
//（否则该格对缺陷没有区分度），再用独立模型对拍 doc/选区，最后验一次 undo 复原。
// ---------------------------------------------------------------------------

interface BoundaryCase {
  name: string;
  doc: string;
  caret: number;
  key: string;
  op: BodyOp;
  /** 该格必须真实渲染的 replace 装饰（反向锚点：没有它这格证明不了缺陷）。 */
  widget: string | null;
}

const BOUNDARY_CASES: BoundaryCase[] = [
  // forward Delete：光标在上一行行尾，被吸收的是下一行。
  { name: "Delete：bullet marker", doc: "alpha\n- item\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-list-marker" },
  { name: "Delete：plus marker", doc: "alpha\n+ item\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-list-marker" },
  { name: "Delete：star marker", doc: "alpha\n* item\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-list-marker" },
  { name: "Delete：有序 marker", doc: "alpha\n1. item\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-list-marker" },
  { name: "Delete：任务项", doc: "alpha\n- [ ] item\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-list-marker" },
  { name: "Delete：嵌套项", doc: "- a\n  - b\n", caret: 3, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-list-marker" },
  { name: "Delete：wikilink 行中", doc: "alpha\nb [[x]] c\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-wikilink" },
  { name: "Delete：行内公式", doc: "alpha\n$x$\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-math-inline" },
  { name: "Delete：隐藏标记（**）", doc: "alpha\n**bold**\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: ".cm-lp-strong" },
  { name: "Delete：普通行对照", doc: "alpha\nplain\n", caret: 5, key: "Delete", op: { kind: "deleteForward" }, widget: null },
  { name: "Delete：lazy 行对照", doc: "- a\nx\n", caret: 3, key: "Delete", op: { kind: "deleteForward" }, widget: null },
  // backward Backspace：光标在本行行首，被吸收的是本行。
  { name: "Backspace：bullet marker", doc: "alpha\n- item\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-list-marker" },
  { name: "Backspace：plus marker", doc: "alpha\n+ item\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-list-marker" },
  { name: "Backspace：star marker", doc: "alpha\n* item\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-list-marker" },
  { name: "Backspace：有序 marker", doc: "alpha\n1. item\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-list-marker" },
  { name: "Backspace：任务项", doc: "alpha\n- [ ] item\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-list-marker" },
  { name: "Backspace：嵌套项", doc: "- a\n  - b\n", caret: 4, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-list-marker" },
  { name: "Backspace：wikilink 行中", doc: "alpha\nb [[x]] c\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-wikilink" },
  { name: "Backspace：行内公式", doc: "alpha\n$x$\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: ".cm-lp-math-inline" },
  { name: "Backspace：普通行对照", doc: "alpha\nplain\n", caret: 6, key: "Backspace", op: { kind: "deleteBackward" }, widget: null },
  { name: "Backspace：lazy 行对照", doc: "- a\nx\n", caret: 4, key: "Backspace", op: { kind: "deleteBackward" }, widget: null },
  // ⌘⌫（deleteSoft/HardLineBackward）：行首同样合并两行。
  { name: "⌘⌫：bullet marker", doc: "alpha\n- item\n", caret: 6, key: "Meta+Backspace", op: { kind: "deleteLineBackward" }, widget: ".cm-lp-list-marker" },
  { name: "⌘⌫：有序 marker", doc: "alpha\n1. item\n", caret: 6, key: "Meta+Backspace", op: { kind: "deleteLineBackward" }, widget: ".cm-lp-list-marker" },
  { name: "⌘⌫：任务项", doc: "alpha\n- [ ] item\n", caret: 6, key: "Meta+Backspace", op: { kind: "deleteLineBackward" }, widget: ".cm-lp-list-marker" },
  { name: "⌘⌫：wikilink 行中", doc: "alpha\nb [[x]] c\n", caret: 6, key: "Meta+Backspace", op: { kind: "deleteLineBackward" }, widget: ".cm-lp-wikilink" },
  { name: "⌘⌫：行内公式", doc: "alpha\n$x$\n", caret: 6, key: "Meta+Backspace", op: { kind: "deleteLineBackward" }, widget: ".cm-lp-math-inline" },
  { name: "⌘⌫：普通行对照", doc: "alpha\nplain\n", caret: 6, key: "Meta+Backspace", op: { kind: "deleteLineBackward" }, widget: null },
];

for (const c of BOUNDARY_CASES) {
  test(`跨 replace 边界删除：${c.name}`, async ({ page }) => {
    await openBody(page, "oracle.md", c.doc);
    // 反向锚点：这一格必须真的渲染了被吸收行的 replace 装饰，否则测不到缺陷。
    const widget = c.widget;
    if (widget !== null) {
      await expect.poll(async () => page.locator(widget).count()).toBeGreaterThan(0);
    }
    await setBodyCaret(page, c.caret);
    const model = new BodyOracle(c.doc, c.caret);
    const before = await bodyState(page);
    await page.keyboard.press(c.key);
    applyBodyOp(model, c.op);
    await expect.poll(async () => (await bodyState(page)).doc).toBe(model.doc);
    const actual = await bodyState(page);
    if (actual.anchor !== model.anchor || actual.head !== model.head) {
      fail(0, 0, c.name, before, model.reading(), actual);
    }
    // 闸门的显式事务必须是单步历史：一次 undo 精确恢复删除前文档。
    await page.waitForTimeout(620);
    await page.keyboard.press("Meta+z");
    await expect.poll(async () => (await bodyState(page)).doc).toBe(c.doc);
  });
}

test("跨 replace 边界删除后 ⌘S：盘上全文 = 源文档的精确合并", async ({ page }) => {
  const doc = "alpha\n- item\n";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, 5);
  await page.keyboard.press("Delete");
  const model = new BodyOracle(doc, 5);
  applyBodyOp(model, { kind: "deleteForward" });
  await expect.poll(async () => (await bodyState(page)).doc).toBe("alpha- item\n");
  await page.keyboard.press("Meta+s");
  await expect.poll(async () => fileText(page, "oracle.md")).toBe("alpha- item\n");
  await expect(page.locator(".modeline-path")).not.toContainText("（未保存）");
});
