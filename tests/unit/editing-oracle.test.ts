// tests/unit/editing-oracle.test.ts —— 编辑对抗测试的 Node 层：独立模型 vs 生产命令（M832）。
//
// 分工：
// - 独立期望值全部来自 `./editing-oracle-model.ts`（不 import 生产代码）；
// - 生产面只当**适配器**：正文用真实 `EditorState` + 真 parser + 生产 Enter / 裸行 Backspace /
//   marker 钳制纯函数；composer 用 M831 的 CM `EditorState`（text/caret/cards）与生产事务。
// - 真 `EditorView`、IME 事件序与真实浏览器接线在 `tests/visual/scenes/editing-oracle.spec.ts`；
//   真机 witness 在验收场景 260。本层不伪造 DOM。
//
// 历史对齐（REVIEW「别在浏览器里猜聚簇」）：模型按显式逻辑步压快照；本层用 ns 假时钟把
// CM history 的 500ms 聚簇窗口隔开（正文 600ms / composer 1000ms），并对装置性选区事务
// 关掉 `addToHistory`。于是「一步 undo」在两侧指同一件事——失败读数里的 step 才是可复跑的。
//
// 失败读数：seed / step / op / before / expected / actual；`LUMIR_ORACLE_SEEDS=17,23` 复跑指定 seed。
// 不开发 shrinker：随机序列发现缺陷后由 agent 缩减并提升为有向用例（本文件的固定前缀就是这类用例）。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import type { SelectionRange } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { deleteCharBackward, deleteCharForward, history, isolateHistory, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import type { EditorView } from "@codemirror/view";
import { backspaceBareMarkerLine, enterWithAutoIndent } from "../../src/enter-indent.ts";
import { listHiddenRangeAt } from "../../src/preview/lists.ts";
import {
  appendComposerAttachments,
  applyComposerTransaction,
  composerAttachmentsField,
  composerRedo,
  composerUndo,
  createComposerState,
  insertComposerText,
  removeComposerAttachment,
  runComposerCommand,
} from "../../src/harness-composer.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";
import { parseComposerDraft, serializeComposerDraft } from "../../src/quote-card.ts";
import { completeTree } from "./syntax-tree.ts";
import {
  BodyOracle,
  ComposerOracle,
  applyBodyOp,
  applyComposerOp,
  bareBackspacePositions,
  bodyCategory,
  bodyHorizontalStep,
  composerCategory,
  describeBodyOp,
  describeComposerOp,
  formatOracleFailure,
  graphemeBefore,
  hiddenMarkerRangeAt,
  lineEnds,
  makeRng,
  randomBodyOp,
  randomComposerOps,
  seedsFromEnv,
} from "./editing-oracle-model.ts";
import type {
  BodyCategory,
  BodyOp,
  ComposerCategory,
  ComposerOp,
  ComposerReading,
  OracleFailure,
} from "./editing-oracle-model.ts";

const MD: Extension[] = [markdown({ base: markdownLanguage, extensions: [GFM] })];

// 每个文件在独立进程里跑（node --test 默认隔离）；Date 假时钟只影响 CM history 的聚簇判据。
mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

// tests/unit 的 node-env.d.ts 只声明了用到的那几个 Node API（无 process.env）；
// 这里按同一口径从 globalThis 取，未声明面不外扩。
const seedEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  ?.LUMIR_ORACLE_SEEDS;
const BODY_SEEDS = seedsFromEnv(seedEnv, [1, 7, 17, 23]);
const COMPOSER_SEEDS = seedsFromEnv(seedEnv, [3, 11, 19, 29]);
const BODY_RANDOM_STEPS = 64;
const COMPOSER_RANDOM_STEPS = 64;
const BODY_BARRIER_MS = 600;
const COMPOSER_BARRIER_MS = 1000;

function failBody(world: string, seed: number, step: number, op: string, before: string, expected: string, actual: string): never {
  const failure: OracleFailure = { seed, step, op: `[${world}] ${op}`, before, expected, actual };
  throw new Error(formatOracleFailure(failure));
}

function failComposer(seed: number, step: number, op: string, before: string, expected: string, actual: string): never {
  const failure: OracleFailure = { seed, step, op, before, expected, actual };
  throw new Error(formatOracleFailure(failure));
}

// ---------------------------------------------------------------------------
// 模型自检（模型错了，对拍只是「错与错互相印证」）：字素 / 列表两态 / 组合 / 卡片 / 草稿
// ---------------------------------------------------------------------------

test("模型自检：字素删除不劈开 ZWJ / 代理对，内容守恒", () => {
  const doc = "a👨‍👩‍👧b😀c";
  const model = new BodyOracle(doc, doc.length);
  model.deleteBackward(); // c
  assert.equal(model.doc, "a👨‍👩‍👧b😀");
  model.deleteBackward(); // 😀（代理对整体）
  assert.equal(model.doc, "a👨‍👩‍👧b");
  model.deleteBackward(); // b
  model.deleteBackward(); // 整个 ZWJ 家庭
  assert.equal(model.doc, "a");
  model.setSelection(0);
  model.deleteForward();
  assert.equal(model.doc, "");
});

test("模型自检：连续空列表项 Enter 只在空项上删 marker、不新增行；有内容续 marker", () => {
  const model = new BodyOracle("- first\n- \n- \n", 0);
  const ends = lineEnds(model.doc);
  applyBodyOp(model, { kind: "enter", at: ends[0] });
  assert.equal(model.doc, "- first\n- \n- \n- \n");
  applyBodyOp(model, { kind: "enter" }); // 新空项 → 删 marker（行保留、不新增行）
  assert.equal(model.doc, "- first\n\n- \n- \n");
  applyBodyOp(model, { kind: "enter", at: lineEnds(model.doc)[2] }); // 另一个空项 → 删 marker
  assert.equal(model.doc, "- first\n\n\n- \n");
  applyBodyOp(model, { kind: "undo" });
  applyBodyOp(model, { kind: "undo" });
  assert.equal(model.doc, "- first\n- \n- \n- \n");
  applyBodyOp(model, { kind: "redo" });
  assert.equal(model.doc, "- first\n\n- \n- \n");
});

test("模型自检：裸 marker 行 Backspace 单次删标记；非裸上下文不接管", () => {
  const bare = "para\n1. ";
  assert.deepEqual(bareBackspacePositions(bare), [bare.length]);
  const model = new BodyOracle(bare, bare.length);
  model.bareMarkerBackspace();
  assert.equal(model.doc, "para\n");
  assert.equal(model.head, 5);

  const real = new BodyOracle("- a\n- ", 6);
  assert.deepEqual(bareBackspacePositions("- a\n- "), [], "真实列表空项不是裸行，Backspace 归原生删除");
  real.bareMarkerBackspace();
  assert.equal(real.doc, "- a\n- ", "模型不接管时必须逐字节不变");
});

test("模型自检：composer 组合中删除只吃 marked 区；取消全等；提交恰好一次且可一次撤销", () => {
  const model = new ComposerOracle({ text: "问题", caret: 2, cards: ["c1"] });
  model.compositionStart();
  model.compositionUpdate("shi");
  model.compositionDelete();
  model.compositionDelete();
  assert.equal(model.text, "问题s", "只删 marked 区");
  model.compositionUpdate("shuang");
  model.compositionCancel();
  assert.deepEqual(model.reading(), {
    text: "问题",
    anchor: 2,
    head: 2,
    cards: ["c1"],
    draft: null,
    sends: 0,
  });

  model.compositionStart();
  model.compositionUpdate("shi");
  model.compositionCommit("是");
  assert.equal(model.text, "问题是");
  assert.equal(model.cards.length, 1, "提交不得触碰卡片");
  model.undo();
  assert.equal(model.text, "问题");
  assert.equal(model.cards.length, 1);
  model.redo();
  assert.equal(model.text, "问题是");
});

test("模型自检：卡片删除是独立撤销步，组合与普通输入都不改卡片", () => {
  const model = new ComposerOracle({ text: "abc", caret: 3, cards: ["q", "m", "img"] });
  model.insert("d");
  model.deleteBackward();
  model.removeCard(1);
  assert.deepEqual(model.cards, ["q", "img"]);
  model.undo();
  assert.deepEqual(model.cards, ["q", "m", "img"]);
  model.redo();
  assert.deepEqual(model.cards, ["q", "img"]);
  model.compositionStart();
  model.compositionUpdate("x");
  model.compositionCommit("候");
  assert.deepEqual(model.cards, ["q", "img"]);
});

test("模型自检：草稿 v2 快照与发送后新编辑史隔离", () => {
  const model = new ComposerOracle();
  model.insert("草稿");
  model.addCard("q1");
  model.saveDraft();
  assert.deepEqual(model.draft, { text: "草稿", caret: 2, cards: ["q1"] });
  model.send();
  assert.equal(model.sends, 1);
  assert.equal(model.text, "");
  assert.deepEqual(model.cards, []);
  assert.equal(model.draft, null);
  assert.equal(model.canUndo, false, "发送后的新输入是新编辑史（HC2.4）");
  model.undo();
  assert.equal(model.text, "", "不得撤销回已发送内容");
});

// ---------------------------------------------------------------------------
// 正文适配器：真 EditorState + 真 parser + 生产命令
// ---------------------------------------------------------------------------

interface BodyAdapter {
  reading(): { doc: string; anchor: number; head: number; saved: string; dirty: boolean };
  apply(op: BodyOp): void;
}

function bodyAdapter(doc: string, caret: number): BodyAdapter {
  let state = completeTree(
    EditorState.create({ doc, selection: EditorSelection.cursor(caret), extensions: [...MD, history()] }),
  );
  let saved = doc;
  const view = () => {
    const handle = {
      state,
      // 生产命令有的传 Transaction、有的传 TransactionSpec（`insertComposerText`），
      // 假 view 两者都收——按有无 `.state` 区分，不猜调用方。
      dispatch: (tr: Transaction | object) => {
        const next = tr as { state?: EditorState };
        handle.state = next.state ?? handle.state.update(tr).state;
      },
    };
    return handle as unknown as EditorView;
  };
  const settle = () => {
    state = completeTree(state);
  };
  const selectionOf = () => state.selection.main;
  const replaceSelection = (insert: string): void => {
    const main = selectionOf();
    state = state.update({
      changes: { from: main.from, to: main.to, insert },
      selection: EditorSelection.cursor(main.from + insert.length),
      userEvent: "input.type",
      annotations: isolateHistory.of("full"),
    }).state;
  };

  return {
    reading: () => ({
      doc: state.doc.toString(),
      anchor: selectionOf().anchor,
      head: selectionOf().head,
      saved,
      dirty: state.doc.toString() !== saved,
    }),
    apply: (op) => {
      switch (op.kind) {
        case "setSelection": {
          state = state.update({
            selection: EditorSelection.range(op.anchor, op.head),
            annotations: Transaction.addToHistory.of(false),
          }).state;
          return;
        }
        case "insert": {
          replaceSelection(op.text);
          return;
        }
        case "deleteBackward": {
          const handle = view();
          deleteCharBackward(handle);
          state = handle.state;
          return;
        }
        case "deleteForward": {
          const handle = view();
          deleteCharForward(handle);
          state = handle.state;
          return;
        }
        case "enter": {
          if (op.at !== undefined) {
            state = state.update({
              selection: EditorSelection.cursor(op.at),
              annotations: Transaction.addToHistory.of(false),
            }).state;
          }
          settle();
          const handle = view();
          const handled = enterWithAutoIndent(handle, "md", true);
          assert.equal(handled, true, `生产 Enter 未接管：${JSON.stringify(op)}`);
          state = handle.state;
          state = completeTree(state);
          return;
        }
        case "bareBackspace": {
          if (op.at !== undefined) {
            state = state.update({
              selection: EditorSelection.cursor(op.at),
              annotations: Transaction.addToHistory.of(false),
            }).state;
          }
          settle();
          const handle = view();
          const handled = backspaceBareMarkerLine(handle);
          assert.equal(
            handled,
            true,
            `生产裸 marker Backspace 未接管：${JSON.stringify(op)} doc=${JSON.stringify(state.doc.toString())}`,
          );
          state = handle.state;
          state = completeTree(state);
          return;
        }
        case "undo": {
          const handle = view();
          undo(handle);
          state = handle.state;
          return;
        }
        case "redo": {
          const handle = view();
          redo(handle);
          state = handle.state;
          return;
        }
        case "save": {
          saved = state.doc.toString();
          return;
        }
      }
    },
  };
}

interface BodyWorld {
  name: string;
  doc: string;
}

const BODY_WORLDS: BodyWorld[] = [
  { name: "plain", doc: "alpha beta\n第二行\n" },
  { name: "empty-list", doc: "- first\n- \n- \n" },
  { name: "bare-marker", doc: "para\n1. \n" },
  { name: "mixed-list", doc: "intro\n1. one\n- \n\n3) three\n" },
];

/** 每个 world 的固定前缀：普通文本 / 替换选区 / 连续空列表 / 裸 marker / undo-redo / 保存。 */
function fixedBodyScript(world: BodyWorld): BodyOp[] {
  const scratch = new BodyOracle(world.doc);
  const ops: BodyOp[] = [];
  const push = (op: BodyOp): void => {
    applyBodyOp(scratch, op);
    ops.push(op);
  };
  push({ kind: "setSelection", anchor: scratch.doc.length, head: scratch.doc.length });
  push({ kind: "insert", text: "Z" });
  push({ kind: "deleteBackward" });
  push({ kind: "insert", text: "中文" });
  push({ kind: "setSelection", anchor: 0, head: Math.min(2, scratch.doc.length) });
  push({ kind: "insert", text: "x" });
  push({ kind: "deleteForward" });
  push({ kind: "undo" });
  push({ kind: "redo" });
  push({ kind: "save" });
  push({ kind: "insert", text: "draft" });
  push({ kind: "undo" });
  push({ kind: "redo" });

  if (world.name === "plain") {
    push({ kind: "enter", at: lineEnds(scratch.doc)[0] });
    push({ kind: "enter", at: lineEnds(scratch.doc)[1] });
  }
  if (world.name === "empty-list") {
    push({ kind: "enter", at: lineEnds(scratch.doc)[0] });
    push({ kind: "enter" });
    push({ kind: "setSelection", anchor: lineEnds(scratch.doc)[0], head: lineEnds(scratch.doc)[0] });
    push({ kind: "insert", text: " tail" });
    push({ kind: "enter" });
  }
  if (world.name === "bare-marker") {
    push({ kind: "bareBackspace", at: lineEnds(scratch.doc)[1] });
    push({ kind: "insert", text: "1. " });
    push({ kind: "enter" });
    push({ kind: "insert", text: "1. a" });
    push({ kind: "enter" });
    push({ kind: "undo" });
  }
  if (world.name === "mixed-list") {
    push({ kind: "enter", at: lineEnds(scratch.doc)[1] });
    push({ kind: "enter" });
    push({ kind: "enter", at: lineEnds(scratch.doc)[4] });
    push({ kind: "undo" });
  }
  return ops;
}

/** 操作是否以「当前选区」为输入（未受信的选区必须先归一成折叠 caret）。 */
function needsSelection(op: BodyOp | ComposerOp): boolean {
  switch (op.kind) {
    case "insert":
    case "deleteBackward":
    case "deleteForward":
    case "softBreak":
    case "compositionStart":
      return true;
    case "enter":
    case "bareBackspace":
      return op.at === undefined;
    default:
      return false;
  }
}

/** 该操作会以确定规则写选区（期望值可信）；addCard / removeCard / saveDraft 只保留选区，
 *  undo / redo 的选区恢复口径 CM 与模型不同——这些步骤之后暂停选区对拍，直到下一次写选区。 */
function writesSelection(op: BodyOp | ComposerOp): boolean {
  switch (op.kind) {
    case "setSelection":
    case "insert":
    case "deleteBackward":
    case "deleteForward":
    case "enter":
    case "bareBackspace":
    case "softBreak":
    case "compositionUpdate":
    case "compositionDelete":
    case "compositionCommit":
    case "send":
      return true;
    default:
      return false;
  }
}

function assertBodyStep(
  world: string,
  seed: number,
  step: number,
  op: BodyOp,
  model: BodyOracle,
  adapter: BodyAdapter,
  before: string,
  selectionMatters: boolean,
): void {
  const expected = model.reading();
  const actual = adapter.reading();
  const mismatch =
    expected.doc !== actual.doc ||
    expected.saved !== actual.saved ||
    expected.dirty !== actual.dirty ||
    (selectionMatters && (expected.anchor !== actual.anchor || expected.head !== actual.head));
  if (!mismatch) return;
  failBody(
    world,
    seed,
    step,
    describeBodyOp(op),
    before,
    JSON.stringify(expected),
    JSON.stringify(actual),
  );
}

function runBodyScript(world: BodyWorld, seed: number): { histogram: Map<BodyCategory, number> } {
  const histogram = new Map<BodyCategory, number>();
  const model = new BodyOracle(world.doc);
  const adapter = bodyAdapter(world.doc, world.doc.length);
  const rng = makeRng((seed >>> 0) ^ 0x9e3779b9 ^ (world.name.length << 16));
  const script = fixedBodyScript(world);
  let step = 0;
  let selectionTrusted = true;
  const run = (op: BodyOp): void => {
    if (!selectionTrusted && needsSelection(op)) {
      const anchor = model.head;
      applyBodyOp(model, { kind: "setSelection", anchor, head: anchor });
      adapter.apply({ kind: "setSelection", anchor, head: anchor });
      selectionTrusted = true;
    }
    const before = JSON.stringify(model.reading());
    applyBodyOp(model, op);
    adapter.apply(op);
    assertBodyStep(world.name, seed, step, op, model, adapter, before, selectionTrusted && op.kind !== "redo" && op.kind !== "undo");
    histogram.set(bodyCategory(op), (histogram.get(bodyCategory(op)) ?? 0) + 1);
    mock.timers.tick(BODY_BARRIER_MS);
    step += 1;
    selectionTrusted = writesSelection(op) ? true : op.kind === "undo" || op.kind === "redo" ? false : selectionTrusted;
  };
  for (const op of script) run(op);
  for (let index = 0; index < BODY_RANDOM_STEPS; index += 1) run(randomBodyOp(rng, model));
  return { histogram };
}

test("正文对拍：固定前缀 + 随机序列（4 worlds × seeds），doc / selection / history / saved 全等", () => {
  const totals = new Map<BodyCategory, number>();
  for (const world of BODY_WORLDS) {
    for (const seed of BODY_SEEDS) {
      const { histogram } = runBodyScript(world, seed);
      for (const [category, count] of histogram) totals.set(category, (totals.get(category) ?? 0) + count);
    }
  }
  for (const category of ["plain", "list", "marker", "history", "save"] as const) {
    assert.ok((totals.get(category) ?? 0) > 0, `随机序列空转：${category} 类操作为 0（${JSON.stringify([...totals])}）`);
  }
});

test("正文对拍：一次 undo 撤销结构步（列表 Enter / 裸 marker Backspace），一次 redo 恢复", () => {
  const cases: Array<{ doc: string; op: BodyOp }> = [
    { doc: "- a\n- ", op: { kind: "enter", at: 6 } },
    { doc: "para\n1. ", op: { kind: "enter", at: 8 } },
    { doc: "para\n1. ", op: { kind: "bareBackspace", at: 8 } },
    { doc: "1. a\n1. b", op: { kind: "enter", at: 9 } },
  ];
  for (const item of cases) {
    const model = new BodyOracle(item.doc, 0);
    const adapter = bodyAdapter(item.doc, 0);
    const before = JSON.stringify(model.reading());
    applyBodyOp(model, item.op);
    adapter.apply(item.op);
    assertBodyStep("directed", 0, 0, item.op, model, adapter, before, true);
    const edited = adapter.reading();
    const op: BodyOp = { kind: "undo" };
    const beforeUndo = JSON.stringify(model.reading());
    applyBodyOp(model, op);
    adapter.apply(op);
    assertBodyStep("directed", 0, 1, op, model, adapter, beforeUndo, false);
    assert.equal(adapter.reading().doc, item.doc, "一次 undo 回到编辑前逐字节态");
    const redoOp: BodyOp = { kind: "redo" };
    const beforeRedo = JSON.stringify(model.reading());
    applyBodyOp(model, redoOp);
    adapter.apply(redoOp);
    assertBodyStep("directed", 0, 2, redoOp, model, adapter, beforeRedo, false);
    assert.equal(adapter.reading().doc, edited.doc, "一次 redo 回到编辑后");
  }
});

test("marker 水平导航对拍：隐藏区间是一个原子步（生产 listHiddenRangeAt vs 模型）", () => {
  const docs = ["1. uno\n", "10. text\n", "- item\n", "* item\n", "+ item\n"];
  for (const doc of docs) {
    const range = hiddenMarkerRangeAt(doc, 0);
    assert.ok(range !== null, `${JSON.stringify(doc)}：模型应识别 marker 区间`);
    const state = completeTree(EditorState.create({ doc, selection: EditorSelection.cursor(0), extensions: MD }));
    for (let pos = range.from + 1; pos < range.to; pos += 1) {
      assert.equal(listHiddenRangeAt(state, pos, true), range.to, `${JSON.stringify(doc)} pos=${pos} forward`);
      assert.equal(listHiddenRangeAt(state, pos, false), range.from, `${JSON.stringify(doc)} pos=${pos} backward`);
    }
    assert.equal(listHiddenRangeAt(state, range.from, true), null, "边界位本身不钳制");
    assert.equal(listHiddenRangeAt(state, range.to, false), null, "内容起点本身不钳制");
  }

  // 裸 marker 行的隐藏区间受「选区与行相接」门控（B1）：光标在别处时生产不隐藏。
  // `para\n1. x` 是真实列表项（非空项可以打断段落），不是裸行；裸行取空 marker 项。
  const bare = "para\n1. \n";
  const bareRange = hiddenMarkerRangeAt(bare, 5)!;
  const away = completeTree(EditorState.create({ doc: bare, selection: EditorSelection.cursor(0), extensions: MD }));
  assert.equal(listHiddenRangeAt(away, bareRange.from + 1, true), null, "光标不在裸行时源码可见，不钳制");
  const on = completeTree(EditorState.create({ doc: bare, selection: EditorSelection.cursor(bare.length - 1), extensions: MD }));
  assert.equal(listHiddenRangeAt(on, bareRange.from + 1, true), bareRange.to, "光标驻留裸行时按隐藏区间钳制");
  assert.equal(bodyHorizontalStep(bare, bareRange.from, true), bareRange.to, "模型给出同一步的期望落点");
});

// ---------------------------------------------------------------------------
// composer 适配器：M831 的 CM EditorState（text / caret / cards）
// ---------------------------------------------------------------------------

function attachmentOf(id: string): ComposerAttachment {
  return { kind: "msgquote", card: { role: "assistant", at: null, text: id } };
}

function attachmentId(card: ComposerAttachment): string {
  return card.kind === "image" ? card.card.name : card.card.text;
}

interface ComposerAdapter {
  reading(): ComposerReading;
  apply(op: ComposerOp): void;
}

function composerAdapter(content: { text?: string; caret?: number | null; cards?: readonly string[] }): ComposerAdapter {
  let state = createComposerState({
    text: content.text ?? "",
    caret: content.caret ?? null,
    cards: (content.cards ?? []).map(attachmentOf),
  });
  let draft: ComposerReading["draft"] = null;
  let sends = 0;
  let composing: { base: string; start: number; marked: string; baseAnchor: number; baseHead: number } | null = null;
  const view = () => {
    const handle = {
      state,
      dispatch: (tr: Transaction | object) => {
        const next = tr as { state?: EditorState };
        handle.state = next.state ?? handle.state.update(tr).state;
      },
    };
    return handle as unknown as EditorView;
  };
  const selectionOf = () => state.selection.main;
  const replaceRange = (
    from: number,
    to: number,
    insert: string,
    options: { isolate?: boolean; history?: false; compose?: boolean } = {},
  ): void => {
    const spec: {
      changes: { from: number; to: number; insert: string };
      selection: EditorSelection | SelectionRange;
      userEvent: string;
      annotations?: unknown;
    } = {
      changes: { from, to, insert },
      selection: EditorSelection.cursor(from + insert.length),
      userEvent: options.compose ? "input.type.compose" : "input.type",
    };
    if (options.history === false && options.isolate) {
      spec.annotations = [Transaction.addToHistory.of(false), isolateHistory.of("full")];
    } else if (options.history === false) {
      spec.annotations = Transaction.addToHistory.of(false);
    } else if (options.isolate) {
      spec.annotations = isolateHistory.of("full");
    }
    state = state.update(spec as never).state;
  };

  return {
    reading: () => ({
      text: state.doc.toString(),
      anchor: selectionOf().anchor,
      head: selectionOf().head,
      cards: state.field(composerAttachmentsField).map(attachmentId),
      draft,
      sends,
    }),
    apply: (op) => {
      switch (op.kind) {
        case "setSelection": {
          state = state.update({
            selection: EditorSelection.range(op.anchor, op.head),
            annotations: Transaction.addToHistory.of(false),
          }).state;
          return;
        }
        case "insert": {
          const handle = view();
          insertComposerText(handle, op.text, "input.type");
          state = handle.state;
          return;
        }
        case "deleteBackward": {
          const handle = view();
          runComposerCommand(handle, "editor.delete-char-backward");
          state = handle.state;
          return;
        }
        case "deleteForward": {
          const handle = view();
          runComposerCommand(handle, "editor.delete-char-forward");
          state = handle.state;
          return;
        }
        case "softBreak": {
          const handle = view();
          insertComposerText(handle, "\n", "input.paste");
          state = handle.state;
          return;
        }
        case "addCard": {
          state = applyComposerTransaction(state, appendComposerAttachments([attachmentOf(op.id)]));
          return;
        }
        case "removeCard": {
          state = applyComposerTransaction(state, removeComposerAttachment(op.index));
          return;
        }
        case "compositionStart": {
          assert.equal(composing, null, "组合不得嵌套启动");
          const main = selectionOf();
          assert.equal(main.empty, true, "组合起点必须是折叠选区（生成器保证）");
          composing = {
            base: state.doc.toString(),
            start: main.head,
            marked: "",
            baseAnchor: main.anchor,
            baseHead: main.head,
          };
          return;
        }
        case "compositionUpdate": {
          assert.ok(composing, "compositionUpdate 前必须先 start");
          const start = composing.start;
          replaceRange(start, start + composing.marked.length, op.text, { compose: true, history: false });
          composing.marked = op.text;
          return;
        }
        case "compositionDelete": {
          assert.ok(composing, "compositionDelete 前必须先 start");
          const marked = composing.marked;
          const cut = marked.slice(0, graphemeBefore(marked, marked.length));
          // 字素口径与模型同源（graphemeBefore）：组合中 Backspace 不得越过 marked 区。
          replaceRange(composing.start, composing.start + marked.length, cut, { compose: true, history: false });
          composing.marked = cut;
          return;
        }
        case "compositionCancel": {
          assert.ok(composing, "compositionCancel 前必须先 start");
          replaceRange(composing.start, composing.start + composing.marked.length, "", { compose: true, history: false });
          state = state.update({
            selection: EditorSelection.range(composing.baseAnchor, composing.baseHead),
            annotations: Transaction.addToHistory.of(false),
          }).state;
          composing = null;
          return;
        }
        case "compositionCommit": {
          assert.ok(composing, "compositionCommit 前必须先 start");
          // 先把 marked 区收回 base（不进 history），再单独插入候选：CM 的 history 逆事件
          // 用事务 startState 的文本还原被删内容，若直接替换 marked 区，一次 undo 会退回
          // 组合中的拼音（"我shi"）而不是组合前。两步合起来仍只有一个 history 事件。
          replaceRange(composing.start, composing.start + composing.marked.length, "", {
            compose: true,
            history: false,
          });
          replaceRange(composing.start, composing.start, op.text, { compose: true, isolate: true });
          composing = null;
          return;
        }
        case "undo": {
          state = composerUndo(state);
          return;
        }
        case "redo": {
          state = composerRedo(state);
          return;
        }
        case "saveDraft": {
          const parsed = parseComposerDraft(
            serializeComposerDraft(state.doc.toString(), selectionOf().head, state.field(composerAttachmentsField)),
          );
          assert.ok(parsed !== null, "生产 v2 序列化必须可读回");
          draft = {
            text: parsed.text,
            caret: parsed.caret,
            cards: parsed.cards.map(attachmentId),
          };
          return;
        }
        case "send": {
          sends += 1;
          state = createComposerState({ text: "", caret: 0, cards: [] });
          draft = null;
          composing = null;
          return;
        }
      }
    },
  };
}

function fixedComposerScript(): ComposerOp[] {
  const ops: ComposerOp[] = [
    { kind: "insert", text: "问题" },
    { kind: "addCard", id: "quote-1" },
    { kind: "insert", text: "续" },
    { kind: "deleteBackward" },
    { kind: "softBreak" },
    { kind: "compositionStart" },
    { kind: "compositionUpdate", text: "sh" },
    { kind: "compositionDelete" },
    { kind: "compositionUpdate", text: "shuang" },
    { kind: "compositionCancel" },
    { kind: "compositionStart" },
    { kind: "compositionUpdate", text: "shi" },
    { kind: "compositionCommit", text: "是" },
    { kind: "deleteBackward" },
    { kind: "setSelection", anchor: 0, head: 3 },
    { kind: "insert", text: "x" },
    { kind: "undo" },
    { kind: "redo" },
    { kind: "addCard", id: "image-2" },
    { kind: "removeCard", index: 0 },
    { kind: "undo" },
    { kind: "redo" },
    { kind: "saveDraft" },
    { kind: "insert", text: "草" },
    { kind: "saveDraft" },
    { kind: "send" },
    { kind: "undo" },
  ];
  return ops;
}

function assertComposerStep(
  seed: number,
  step: number,
  op: ComposerOp,
  model: ComposerOracle,
  adapter: ComposerAdapter,
  before: string,
  selectionMatters: boolean,
): void {
  const expected = model.reading();
  const actual = adapter.reading();
  const sameDraft =
    JSON.stringify(expected.draft) === JSON.stringify(actual.draft);
  const mismatch =
    expected.text !== actual.text ||
    expected.sends !== actual.sends ||
    JSON.stringify(expected.cards) !== JSON.stringify(actual.cards) ||
    !sameDraft ||
    (selectionMatters && (expected.anchor !== actual.anchor || expected.head !== actual.head));
  if (!mismatch) return;
  failComposer(seed, step, describeComposerOp(op), before, JSON.stringify(expected), JSON.stringify(actual));
}

function runComposerScript(seed: number): { histogram: Map<ComposerCategory, number> } {
  const histogram = new Map<ComposerCategory, number>();
  const model = new ComposerOracle();
  const adapter = composerAdapter({});
  const rng = makeRng((seed >>> 0) ^ 0x85ebca6b);
  let step = 0;
  let selectionTrusted = true;
  const run = (op: ComposerOp): void => {
    if (!selectionTrusted && needsSelection(op)) {
      const anchor = model.head;
      applyComposerOp(model, { kind: "setSelection", anchor, head: anchor });
      adapter.apply({ kind: "setSelection", anchor, head: anchor });
      selectionTrusted = true;
    }
    const before = JSON.stringify(model.reading());
    applyComposerOp(model, op);
    adapter.apply(op);
    assertComposerStep(seed, step, op, model, adapter, before, selectionTrusted && op.kind !== "redo" && op.kind !== "undo");
    histogram.set(composerCategory(op), (histogram.get(composerCategory(op)) ?? 0) + 1);
    mock.timers.tick(COMPOSER_BARRIER_MS);
    step += 1;
    selectionTrusted = writesSelection(op) ? true : op.kind === "undo" || op.kind === "redo" ? false : selectionTrusted;
  };
  for (const op of fixedComposerScript()) run(op);
  for (let index = 0; index < COMPOSER_RANDOM_STEPS; index += 1) {
    for (const op of randomComposerOps(rng, model, index)) run(op);
  }
  return { histogram };
}

test("composer 对拍：固定前缀 + 随机序列（seeds），text / caret / cards / draft / sends 全等", () => {
  const totals = new Map<ComposerCategory, number>();
  for (const seed of COMPOSER_SEEDS) {
    const { histogram } = runComposerScript(seed);
    for (const [category, count] of histogram) totals.set(category, (totals.get(category) ?? 0) + count);
  }
  for (const category of ["plain", "ime", "cards", "history", "draft", "send"] as const) {
    assert.ok((totals.get(category) ?? 0) > 0, `随机序列空转：${category} 类操作为 0（${JSON.stringify([...totals])}）`);
  }
});

test("composer 对拍：IME 取消 / 确认 Enter 不发送 / 一次提交可一次 undo（生产 history）", () => {
  const model = new ComposerOracle({ text: "我", caret: 1, cards: ["q"] });
  const adapter = composerAdapter({ text: "我", caret: 1, cards: ["q"] });
  const steps: ComposerOp[] = [
    { kind: "compositionStart" },
    { kind: "compositionUpdate", text: "shi" },
    { kind: "compositionDelete" },
    { kind: "compositionCancel" },
    { kind: "compositionStart" },
    { kind: "compositionUpdate", text: "shi" },
    { kind: "compositionCommit", text: "是" },
    { kind: "undo" },
    { kind: "redo" },
  ];
  let selectionTrusted = true;
  for (const [step, op] of steps.entries()) {
    if (!selectionTrusted && needsSelection(op)) {
      const anchor = model.head;
      applyComposerOp(model, { kind: "setSelection", anchor, head: anchor });
      adapter.apply({ kind: "setSelection", anchor, head: anchor });
      selectionTrusted = true;
    }
    const before = JSON.stringify(model.reading());
    applyComposerOp(model, op);
    adapter.apply(op);
    assertComposerStep(0, step, op, model, adapter, before, selectionTrusted);
    mock.timers.tick(COMPOSER_BARRIER_MS);
    selectionTrusted = writesSelection(op) ? true : op.kind === "undo" || op.kind === "redo" ? false : selectionTrusted;
  }
  assert.deepEqual(adapter.reading().cards, ["q"], "IME 全程不碰附件");
  assert.equal(adapter.reading().sends, 0, "确认拍不得发送");
});
