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
  expect(await page.locator(".cm-line").allTextContents()).toEqual(["词汇", "- "]);
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
  { name: "段落后 - 的 setext / 列表切换", doc: "词汇\n- ", lines: ["词汇", "- "] },
  { name: "真 bullet 空项", doc: "- ", lines: null },
  { name: "真有序空项", doc: "1. ", lines: null },
  { name: "嵌套空项", doc: "- parent\n  - ", lines: null },
  { name: "非 setext 裸 marker", doc: "para\n+ ", lines: null },
] as const;

for (const fixture of IME_LIST_CASES) {
  test(`正文 CDP 真引擎 IME：${fixture.name}的组合编辑保真（Chromium）`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP 只存在于 Chromium；WebKit 合成事件不能冒充原生 IME");
    const { doc } = fixture;
    await openBody(page, "oracle.md", doc);
    await setBodyCaret(page, doc.length);
    const cdp = await page.context().newCDPSession(page);
    const compose = async (text: string) => cdp.send("Input.imeSetComposition", {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    });

    await compose("s");
    await expect.poll(async () => (await bodyState(page)).doc.includes("s")).toBe(true);
    const inserted = await bodyState(page);

    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await bodyState(page)).doc.includes("s")).toBe(false);
    const deleted = await bodyState(page);
    // marked text 已空时再退格 MUST 是 no-op，不得吃掉 marker 或前一段正文。
    await page.keyboard.press("Backspace");
    const atCompositionStart = await bodyState(page);
    const lines = await page.locator(".cm-line").allTextContents();
    expect({ inserted, deleted, atCompositionStart }).toEqual({
      inserted: { doc: `${doc}s`, anchor: doc.length + 1, head: doc.length + 1 },
      deleted: { doc, anchor: doc.length, head: doc.length },
      atCompositionStart: { doc, anchor: doc.length, head: doc.length },
    });
    expect(lines).toHaveLength(doc.split("\n").length);
    expect(lines.every((line) => line.length > 0), "组合删除不得清空相邻行").toBe(true);
    if (fixture.lines !== null) expect(lines).toEqual(fixture.lines);

    await compose("s👨‍👩‍👧");
    await page.keyboard.press("Backspace");
    await expect.poll(async () => (await bodyState(page)).doc).toBe(`${doc}s`);
    await cdp.send("Input.insertText", { text: "是" });
    const committed = `${doc}是`;
    await expect.poll(async () => (await bodyState(page)).doc).toBe(committed);
    await page.keyboard.press("Meta+s");
    await expect.poll(async () => fileText(page, "oracle.md")).toBe(committed);

    await page.waitForTimeout(600);
    await page.keyboard.press("Meta+z");
    await expect.poll(() => bodyState(page)).toEqual({ doc, anchor: doc.length, head: doc.length });
  });
}

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
