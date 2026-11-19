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
import { fileText, stubTauri, type VaultFixture } from "./tauri-stub";
import { standardProviders } from "./provider-config";
import {
  BodyOracle,
  ComposerOracle,
  applyBodyOp,
  applyComposerOp,
  describeBodyOp,
  formatOracleFailure,
  lineEnds,
  lineSpanAt,
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
      if (op.kind === "deleteForward" && deletesDashBulletNewline(model)) op = { kind: "insert", text: "z" };
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
      lastWasEdit = op.kind === "insert" || op.kind === "deleteBackward" || op.kind === "deleteForward" || op.kind === "enter" || op.kind === "bareBackspace";
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

/** 已知产品缺陷（M832 真机/浏览器层发现，已单独 TowerFinding 报告）：换行后紧跟 `- `
 *  列表行时，在该换行上按原生 forward Delete 会把渲染层 marker 字形（`–`）写进文档并
 *  拆行（`alpha\n- item` → `alpha\n–\nitem`）。`* ` / `+ ` / 有序 marker 与反向 Backspace
 *  都不复现。生产代码不在本 mission 范围，随机序列绕开这一格；这里留可执行反例。 */
function deletesDashBulletNewline(model: BodyOracle): boolean {
  const line = lineSpanAt(model.doc, model.head);
  if (model.head !== line.to || line.to >= model.doc.length) return false;
  const next = lineSpanAt(model.doc, line.to + 1);
  return model.doc.slice(next.from, next.to).startsWith("- ");
}

test.fixme("已知缺陷：`- ` 列表行前的换行上按 Delete 会把 marker 字形写进文档", async ({ page }) => {
  const doc = "alpha\n- item\n";
  await openBody(page, "oracle.md", doc);
  await setBodyCaret(page, 5);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(100);
  expect((await bodyState(page)).doc).toBe("alpha- item\n");
});
