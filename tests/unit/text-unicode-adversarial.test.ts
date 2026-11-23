// tests/unit/text-unicode-adversarial.test.ts —— 正文与 composer 的共享文本合同（M843）。
//
// 合同（两层同判；浏览器层是 tests/visual/scenes/text-clipboard-adversarial.spec.ts）：
//   1. 字素删除：Backspace / Delete 恰好删除一个字素簇（ZWJ 家庭 / 国旗 / 肤色 / 组合标记 /
//      变体选择符 / 代理对 / RTL 附标），不劈开簇、不留下孤立代理项；undo 逐字节还原。
//   2. 选区替换：粘贴替换 [from,to) 恰好一次，caret 落在 from+insert.length；反向选区
//      （anchor>head）、跨行选区与折叠 caret 同权；一次粘贴 = 一个撤销步（CM 的 history
//      只聚簇 `input.type` / `delete`，`input.paste` 不参与，见 @codemirror/commands 的
//      joinableUserEvent）。
//   3. redo 作废：undo 之后的新粘贴清空 redo；redo 不复活旧内容。
//   4. 剪贴板内容 / 附件 / caret 各只变化一次：文本粘贴不触碰 composer 的附件 field；
//      一次粘贴只产生一个文档变化；撤销恢复粘贴前的文本与选区。
//   5. 图片优先级（纯判据）：md+可编辑时首个 `image/*` 文件项压过 text/plain / text/html /
//      uri-list / 非图片文件；引用插入是「替换选区 + 块级独占一行」的事务形状。
//
// 期望值一律来自 ./editing-oracle-model.ts（独立模型，不 import 生产代码的期望）；生产面只当
// 适配器：正文用真 `EditorState` + CM 命令，composer 用 M831 的 CM `EditorState` + 生产事务。
// 本层不碰 DOM / 真实剪贴板；真实 PasteEvent / drop / IME 事件序在浏览器层。
//
// 失败读数：seed / step / op / before / expected / actual；`LUMIR_ORACLE_SEEDS` 复跑指定 seed。
// 不开发 shrinker：随机序列发现缺陷后缩减为下方有向用例。

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import type { Extension, TransactionSpec } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import {
  absorbComposerGraphemeBackspace,
  composerAttachmentsField,
  composerRedo,
  composerUndo,
  createComposerState,
  insertComposerText,
  runComposerCommand,
} from "../../src/harness-composer.ts";
import type { CommandId } from "../../src/keys.ts";
import { clusterBackward, clusterForward } from "../../src/quote-card.ts";
import { firstImageFileIndex, imagePasteItemIndex, pastedImageInsertion } from "../../src/paste-image.ts";
import type { ComposerAttachment } from "../../src/quote-card.ts";
import {
  BodyOracle,
  ComposerOracle,
  formatOracleFailure,
  graphemeAfter,
  graphemeBefore,
  makeRng,
  pickOne,
  rngInt,
  seedsFromEnv,
} from "./editing-oracle-model.ts";

// 每个文件在独立进程里跑（node --test 默认隔离）；Date 假时钟只影响 CM history 的聚簇判据。
mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });

const seedEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
  ?.LUMIR_ORACLE_SEEDS;
const BODY_SEEDS = seedsFromEnv(seedEnv, [5, 41]);
const COMPOSER_SEEDS = seedsFromEnv(seedEnv, [7, 43]);
const RANDOM_STEPS = 24;
const BODY_BARRIER_MS = 600;
const COMPOSER_BARRIER_MS = 1000;

const CARD: ComposerAttachment = {
  kind: "quote",
  card: { file: "synthetic.md", heading: "合成", headingPath: "合成", lines: "1-1", text: "引用原文" },
};

// ---------------------------------------------------------------------------
// 适配器：真 EditorState + 生产命令（假 view 只提供 state / dispatch）
// ---------------------------------------------------------------------------

interface FakeView {
  view: EditorView;
  /** 当前 state（假 view 的 dispatch 会就地推进）。 */
  readonly state: EditorState;
}

function fakeView(initial: EditorState, compositionStarted = false): FakeView {
  let state = initial;
  const handle = {
    get state() {
      return state;
    },
    compositionStarted,
    dispatch: (spec: TransactionSpec | { state?: EditorState }) => {
      const next = spec as { state?: EditorState };
      state = next.state ?? state.update(spec as TransactionSpec).state;
    },
  };
  return {
    view: handle as unknown as EditorView,
    get state() {
      return state;
    },
  };
}

const BODY_EXT: Extension[] = [history()];

function bodyState(doc: string, anchor: number, head = anchor): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: BODY_EXT,
  });
}

/** 生产单命令跑一拍（返回新 state；命令的布尔返回值不参与对拍）。 */
function runBody(state: EditorState, command: (view: EditorView) => unknown): EditorState {
  const fake = fakeView(state);
  command(fake.view);
  return fake.state;
}

/**
 * 正文粘贴的事务形状（`@codemirror/view` 的 doPaste 对单范围所做的同一件事：
 * `state.replaceSelection(text)` + `userEvent: "input.paste"`）。真实 DOM PasteEvent
 * 在浏览器层对拍，本层只钉状态语义。
 */
function pasteBody(state: EditorState, text: string): EditorState {
  return state.update({
    ...state.replaceSelection(text),
    userEvent: "input.paste",
    scrollIntoView: true,
  }).state;
}

/**
 * 正文 `editor.delete-char-backward` 的形状（src/editor.ts 的 deleteCharBackward）：
 * `src/editor.ts` 的 import 链带参数属性，本层跑不了，所以用它的**生产步长核**
 * `quote-card.clusterBackward`（`findClusterBreak` 的 includeExtending=true 分支）+ 同一个
 * 事务形状（删 [prevCluster, caret)，caret 落删除起点）。没有表格 cell 的文档里
 * `editLimits` 是整篇，故省略。
 */
function deleteBodyBackward(state: EditorState): EditorState {
  const main = state.selection.main;
  if (!main.empty) {
    return state.update({
      changes: { from: main.from, to: main.to },
      selection: EditorSelection.cursor(main.from),
      userEvent: "delete.selection",
    }).state;
  }
  const start = clusterBackward((from, to) => state.doc.sliceString(from, to), main.head, 0);
  if (start >= main.head) return state;
  return state.update({
    changes: { from: start, to: main.head },
    selection: EditorSelection.cursor(start),
    userEvent: "delete.char.backward",
  }).state;
}

/** 正文 `editor.delete-char-forward`（src/editor.ts 的 deleteCharForward）的同一形状。 */
function deleteBodyForward(state: EditorState): EditorState {
  const main = state.selection.main;
  if (!main.empty) {
    return state.update({
      changes: { from: main.from, to: main.to },
      selection: EditorSelection.cursor(main.from),
      userEvent: "delete.selection",
    }).state;
  }
  const end = clusterForward((from, to) => state.doc.sliceString(from, to), main.head, state.doc.length);
  if (end <= main.head) return state;
  return state.update({
    changes: { from: main.head, to: end },
    selection: EditorSelection.cursor(main.head),
    userEvent: "delete.char.forward",
  }).state;
}

interface Reading {
  text: string;
  anchor: number;
  head: number;
}

function bodyReading(state: EditorState): Reading {
  const main = state.selection.main;
  return { text: state.doc.toString(), anchor: main.anchor, head: main.head };
}

function composerStateWith(text: string, caret: number, cards: readonly ComposerAttachment[] = [CARD]): EditorState {
  return createComposerState({
    text,
    caret,
    cards: cards.map((card, index) => ({ id: index + 1, card, anchor: 0 })),
  });
}

/** 生产 composer 命令入口（`editor.delete-char-backward` 等）。 */
function runComposer(state: EditorState, command: CommandId): EditorState {
  const fake = fakeView(state);
  runComposerCommand(fake.view, command);
  return fake.state;
}

/** 生产 composer 粘贴入口（harness-panel 的 paste 处理器与 drop 都走它）。 */
function pasteComposer(state: EditorState, text: string, userEvent = "input.paste"): EditorState {
  const fake = fakeView(state);
  insertComposerText(fake.view, text, userEvent);
  return fake.state;
}

function composerReading(state: EditorState): Reading & { cards: ComposerAttachment[] } {
  const main = state.selection.main;
  return {
    text: state.doc.toString(),
    anchor: main.anchor,
    head: main.head,
    cards: state.field(composerAttachmentsField).map((attachment) => attachment.card),
  };
}

function fail(seed: number, step: number, op: string, before: string, expected: unknown, actual: unknown): never {
  throw new Error(
    formatOracleFailure({
      seed,
      step,
      op,
      before,
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    }),
  );
}

/** 孤立代理项 = 劈开字素簇的签名；任何删除结果都不许出现。 */
function assertNoLoneSurrogates(text: string, label: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      assert.ok(next >= 0xdc00 && next <= 0xdfff, `${label}: 出现孤立高代理项 @${index}`);
      index += 1;
    } else {
      assert.ok(!(code >= 0xdc00 && code <= 0xdfff), `${label}: 出现孤立低代理项 @${index}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 一、字素删除：正文与 composer 各跑一遍 ZWJ / 国旗 / 肤色 / 组合标记 / 代理对 / RTL
// ---------------------------------------------------------------------------

interface GraphemeCase {
  name: string;
  prefix: string;
  cluster: string;
  suffix: string;
}

const GRAPHEME_CASES: GraphemeCase[] = [
  { name: "普通 ASCII", prefix: "x", cluster: "a", suffix: "y" },
  { name: "ZWJ 家庭", prefix: "a", cluster: "👨‍👩‍👧‍👦", suffix: "b" },
  { name: "国旗（区域指示符对）", prefix: "x", cluster: "🇯🇵", suffix: "y" },
  { name: "肤色修饰", prefix: "x", cluster: "👍🏽", suffix: "y" },
  { name: "职业 ZWJ + 肤色", prefix: "x", cluster: "👩🏽‍🚀", suffix: "y" },
  { name: "组合重音（重音 + 下点）", prefix: "x", cluster: "e\u0301\u0323", suffix: "y" },
  { name: "变体选择符", prefix: "x", cluster: "❤\uFE0F", suffix: "y" },
  { name: "代理对（CJK 扩展 B）", prefix: "引", cluster: "𠀀", suffix: "言" },
  { name: "阿拉伯文附标", prefix: "A ", cluster: "مَ", suffix: " B" },
  { name: "希伯来文附标", prefix: "A ", cluster: "שָׁ", suffix: " B" },
];

/** M860：composer 的 `editor.delete-char-backward` 与正文同一份字素步长核
 *（`quote-card.clusterBackward`）。M843 的「按引擎 / 码点残留」基线已收敛为统一整簇期望——
 * 两层（Node / 双引擎视觉）都断言第一拍 = 完整删除，不再保留按引擎分档的部分删除表。 */

for (const c of GRAPHEME_CASES) {
  const doc = c.prefix + c.cluster + c.suffix;
  const before = c.prefix.length;
  const after = before + c.cluster.length;
  const deleted = c.prefix + c.suffix;

  test(`字素删除：${c.name}（正文 Ctrl-h / Ctrl-d 整簇 + undo）`, () => {
    assert.equal(graphemeBefore(doc, after), before, `${c.name}: graphemeBefore`);
    assert.equal(graphemeAfter(doc, before), after, `${c.name}: graphemeAfter`);

    let back = deleteBodyBackward(bodyState(doc, after));
    assert.deepEqual(bodyReading(back), { text: deleted, anchor: before, head: before }, `${c.name}: 正文 Ctrl-h`);
    assertNoLoneSurrogates(back.doc.toString(), `${c.name}: 正文 Ctrl-h`);
    back = runBody(back, undo);
    assert.deepEqual(bodyReading(back), { text: doc, anchor: after, head: after }, `${c.name}: 正文 Ctrl-h undo`);

    let forward = deleteBodyForward(bodyState(doc, before));
    assert.deepEqual(bodyReading(forward), { text: deleted, anchor: before, head: before }, `${c.name}: 正文 Ctrl-d`);
    forward = runBody(forward, undo);
    assert.equal(forward.doc.toString(), doc, `${c.name}: 正文 Ctrl-d undo`);

    // 单码点簇（普通 ASCII）的「整簇」与「一个字符」同义，不存在可区分的部分删除形态。
    if (c.cluster.length > 1) {
      assert.notEqual(c.prefix + c.cluster.slice(0, -1) + c.suffix, deleted, `${c.name}: 期望值没有区分度`);
    }
  });

  test(`字素删除：${c.name}（composer 生产命令 ⌃H 整簇 + 单步撤销 + 附件）`, () => {
    let state = runComposer(composerStateWith(doc, after), "editor.delete-char-backward");
    assert.deepEqual(
      composerReading(state),
      { text: deleted, anchor: before, head: before, cards: [CARD] },
      `${c.name}: composer ⌃H 第一拍必须是整簇`,
    );
    assertNoLoneSurrogates(state.doc.toString(), `${c.name}: composer ⌃H`);

    // 单个 undo 一步恢复（不得留下半步簇）。
    state = composerUndo(state);
    assert.deepEqual(
      composerReading(state),
      { text: doc, anchor: after, head: after, cards: [CARD] },
      `${c.name}: composer ⌃H 单步撤销`,
    );
  });

  test(`字素删除：${c.name}（composer Ctrl-d 整簇 + 附件）`, () => {
    let forward = runComposer(composerStateWith(doc, before), "editor.delete-char-forward");
    assert.deepEqual(composerReading(forward), { text: deleted, anchor: before, head: before, cards: [CARD] });
    forward = composerUndo(forward);
    assert.deepEqual(composerReading(forward), { text: doc, anchor: before, head: before, cards: [CARD] });
  });
}

test("跨面一致性：同一 editor.delete-char-backward，正文与 composer 都整簇且单步可撤销", () => {
  for (const c of GRAPHEME_CASES) {
    const doc = c.prefix + c.cluster + c.suffix;
    const before = c.prefix.length;
    const after = before + c.cluster.length;
    const body = deleteBodyBackward(bodyState(doc, after));
    const composer = runComposer(composerStateWith(doc, after), "editor.delete-char-backward");
    assert.equal(body.doc.toString(), c.prefix + c.suffix, `${c.name}: 正文命令必须整簇`);
    assert.equal(composer.doc.toString(), c.prefix + c.suffix, `${c.name}: composer 命令必须整簇`);
    assert.equal(composer.doc.toString(), body.doc.toString(), `${c.name}: 跨面逐字节一致`);
    assert.deepEqual(
      bodyReading(runBody(body, undo)),
      { text: doc, anchor: after, head: after },
      `${c.name}: 正文单步撤销`,
    );
    assert.deepEqual(
      composerReading(composerUndo(composer)),
      { text: doc, anchor: after, head: after, cards: [CARD] },
      `${c.name}: composer 单步撤销`,
    );
  }
});

// ---------------------------------------------------------------------------
// 一之二、composer 物理 Backspace 闸门（M860，beforeinput）
// ---------------------------------------------------------------------------
//
// 生产面：`src/harness-composer.ts` 的 `composerGraphemeBackspace`（装进
// `composerStateExtensions`）只接管 `deleteContentBackward` 的折叠 caret；修饰键变体以不同
// inputType 到达、IME 组合期 / 只读 / 非空选区保持既有路径。正文侧同一份判定在
// `src/editor.ts` 的 `absorbGraphemeBackspace`（Node 层加载不了 editor.ts 的 import 图，
// 正文判据在双引擎视觉层）。

interface FakeBeforeInput {
  inputType: string;
  isComposing?: boolean;
  prevented: boolean;
  preventDefault(): void;
}

function fakeBeforeInput(inputType: string, options: { isComposing?: boolean } = {}): FakeBeforeInput {
  return {
    inputType,
    isComposing: options.isComposing ?? false,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

test("composer 物理 Backspace：折叠 caret 一次删完整簇 + caret 落删除起点 + 单步撤销 + 附件不动", () => {
  for (const c of GRAPHEME_CASES) {
    const doc = c.prefix + c.cluster + c.suffix;
    const after = c.prefix.length + c.cluster.length;
    const handle = fakeView(composerStateWith(doc, after));
    const event = fakeBeforeInput("deleteContentBackward");
    const consumed = absorbComposerGraphemeBackspace(event as unknown as InputEvent, handle.view);
    assert.equal(consumed, true, `${c.name}: 闸门必须接管折叠 caret 的 deleteContentBackward`);
    assert.equal(event.prevented, true, `${c.name}: 必须 preventDefault`);
    assert.deepEqual(
      composerReading(handle.state),
      { text: c.prefix + c.suffix, anchor: c.prefix.length, head: c.prefix.length, cards: [CARD] },
      `${c.name}: 物理 Backspace 整簇`,
    );
    assertNoLoneSurrogates(handle.state.doc.toString(), `${c.name}: composer 物理 Backspace`);
    assert.deepEqual(
      composerReading(composerUndo(handle.state)),
      { text: doc, anchor: after, head: after, cards: [CARD] },
      `${c.name}: 物理 Backspace 单步撤销`,
    );
  }
});

test("composer 物理 Backspace / Delete：非空选区按 state.selection 删除，附件只映射 anchor", () => {
  for (const inputType of ["deleteContentBackward", "deleteContentForward"]) {
    const initial = composerStateWith("abcde", 3).update({ selection: EditorSelection.range(1, 3) }).state;
    const handle = fakeView(initial);
    const event = fakeBeforeInput(inputType);
    const consumed = absorbComposerGraphemeBackspace(event as unknown as InputEvent, handle.view);
    assert.equal(consumed, true);
    assert.equal(event.prevented, true);
    assert.equal(handle.state.doc.toString(), "ade");
    assert.deepEqual(handle.state.field(composerAttachmentsField).map((attachment) => attachment.card), [CARD]);
    assert.equal(handle.state.field(composerAttachmentsField)[0].anchor, 0);
  }
});

test("composer 物理 Backspace：修饰键变体 / IME 组合 / 只读保持既有路径", () => {
  const readOnly = createComposerState({ text: "abcde", caret: 5, cards: [CARD] }, [EditorState.readOnly.of(true)]);
  const cases: { label: string; state: EditorState; inputType: string; isComposing?: boolean; compositionStarted?: boolean }[] = [
    { label: "⌥⌫ 词删除变体", state: composerStateWith("abcde", 5), inputType: "deleteWordBackward" },
    { label: "⌘⌫ 行删除变体", state: composerStateWith("abcde", 5), inputType: "deleteHardLineBackward" },
    { label: "行删除软变体", state: composerStateWith("abcde", 5), inputType: "deleteSoftLineBackward" },
    { label: "forward Delete", state: composerStateWith("abcde", 2), inputType: "deleteContentForward" },
    { label: "普通键入", state: composerStateWith("abcde", 5), inputType: "insertText" },
    { label: "组合中（compositionStarted）", state: composerStateWith("abcde", 5), inputType: "deleteContentBackward", compositionStarted: true },
    { label: "组合中（event.isComposing）", state: composerStateWith("abcde", 5), inputType: "deleteContentBackward", isComposing: true },
    { label: "只读会话", state: readOnly, inputType: "deleteContentBackward" },
  ];
  for (const item of cases) {
    const handle = fakeView(item.state, item.compositionStarted ?? false);
    const event = fakeBeforeInput(item.inputType, { isComposing: item.isComposing });
    const consumed = absorbComposerGraphemeBackspace(event as unknown as InputEvent, handle.view);
    assert.equal(consumed, false, `${item.label}: 不得被闸门接管`);
    assert.equal(event.prevented, false, `${item.label}: 不得 preventDefault`);
    assert.deepEqual(composerReading(handle.state), composerReading(item.state), `${item.label}: 文档 / 选区 / 附件逐字节不变`);
  }
});

test("composer ⌃H：只读会话下折叠 caret 与非空选区都不改文档（直接命令入口）", () => {
  const readOnly = [EditorState.readOnly.of(true)];
  const folded = createComposerState({ text: "x👍🏽y", caret: 5, cards: [CARD] }, readOnly);
  const foldedAfter = runComposer(folded, "editor.delete-char-backward");
  assert.deepEqual(composerReading(foldedAfter), composerReading(folded), "折叠 caret：只读不得删除");

  const selected = createComposerState({ text: "abcde", caret: 3, cards: [CARD] }, readOnly).update({
    selection: EditorSelection.range(1, 3),
  }).state;
  const selectedAfter = runComposer(selected, "editor.delete-char-backward");
  assert.deepEqual(composerReading(selectedAfter), composerReading(selected), "非空选区：只读不得删除选区");
});

// ---------------------------------------------------------------------------
// 二、选区替换：反向 / 跨行 / 跨源码标记 / RTL / 边界 caret
// ---------------------------------------------------------------------------

interface SelectionCase {
  name: string;
  doc: string;
  anchor: number;
  head: number;
  text: string;
}

const RTL_DOC = "A مَرْحَبًا B";
const SELECTION_CASES: SelectionCase[] = [
  { name: "反向选区（anchor>head）", doc: "alpha beta", anchor: 10, head: 4, text: "Ω" },
  { name: "跨行选区", doc: "one\ntwo\nthree", anchor: 2, head: 9, text: "月\n火" },
  { name: "跨 list marker 源码的选区", doc: "alpha\n- item\n", anchor: 3, head: 8, text: "Z" },
  { name: "整篇选区 → 粘贴空串", doc: "alpha beta", anchor: 10, head: 0, text: "" },
  { name: "RTL 词中选区", doc: RTL_DOC, anchor: 2, head: 11, text: "שלום" },
  { name: "文首零宽 caret", doc: "alpha", anchor: 0, head: 0, text: "👉" },
  { name: "文末零宽 caret", doc: "alpha", anchor: 5, head: 5, text: "👩🏽‍🚀" },
];

for (const c of SELECTION_CASES) {
  test(`选区替换：${c.name}（正文粘贴 = 源码区间替换 + 一次撤销步）`, () => {
    const model = new BodyOracle(c.doc);
    model.setSelection(c.anchor, c.head);
    model.insert(c.text);
    const expected = { text: model.doc, anchor: model.anchor, head: model.head };

    const initial = bodyState(c.doc, c.anchor, c.head);
    const pasted = pasteBody(initial, c.text);
    assert.deepEqual(bodyReading(pasted), expected, `${c.name}: 粘贴结果`);
    assertNoLoneSurrogates(pasted.doc.toString(), `${c.name}: 粘贴结果`);

    // 一次撤销回到粘贴前的逐字节文本与选区（反向选区方向必须保留）。
    const undone = runBody(pasted, undo);
    assert.deepEqual(bodyReading(undone), { text: c.doc, anchor: c.anchor, head: c.head }, `${c.name}: undo`);
    const redone = runBody(undone, redo);
    assert.equal(redone.doc.toString(), expected.text, `${c.name}: redo`);
  });

  test(`选区替换：${c.name}（composer 粘贴 + 附件只读）`, () => {
    const model = new ComposerOracle({ text: c.doc, caret: c.anchor, cards: ["quote"] });
    model.setSelection(c.anchor, c.head);
    model.insert(c.text);
    const expected = { text: model.text, anchor: model.anchor, head: model.head };

    const initial = composerStateWith(c.doc, c.anchor);
    // 起始选区可能是反向的：createComposerState 只接受折叠 caret，因此再写一次。
    const selected = initial.update({
      selection: EditorSelection.range(c.anchor, c.head),
      annotations: Transaction.addToHistory.of(false),
    }).state;
    const pasted = pasteComposer(selected, c.text);
    assert.deepEqual(composerReading(pasted), { ...expected, cards: [CARD] }, `${c.name}: 粘贴结果`);

    const undone = composerUndo(pasted);
    assert.deepEqual(composerReading(undone), { text: c.doc, anchor: c.anchor, head: c.head, cards: [CARD] });
    const redone = composerRedo(undone);
    // redo 的选区由 CM 回填（与模型的 after 快照可以不同），只钉文本与附件。
    assert.equal(redone.doc.toString(), expected.text, `${c.name}: redo 文本`);
    assert.deepEqual(redone.field(composerAttachmentsField).map((attachment) => attachment.card), [CARD], `${c.name}: redo 附件`);
  });
}

// ---------------------------------------------------------------------------
// 三、粘贴的历史粒度与 redo 作废
// ---------------------------------------------------------------------------

test("粘贴粒度：连续三次快速粘贴 = 三个独立撤销步（input.paste 不聚簇），redo 三次精确重放", () => {
  const pieces = ["A", "👨‍👩‍👧‍👦", "مَ"];
  let state = bodyState("", 0);
  for (const piece of pieces) state = pasteBody(state, piece);
  assert.equal(state.doc.toString(), pieces.join(""));

  // 无时间屏障：CM 的 joinableUserEvent 不匹配 input.paste，三拍必须是三步。
  state = runBody(state, undo);
  assert.equal(state.doc.toString(), "A👨‍👩‍👧‍👦");
  state = runBody(state, undo);
  assert.equal(state.doc.toString(), "A");
  state = runBody(state, undo);
  assert.equal(state.doc.toString(), "");

  for (const piece of pieces) state = runBody(state, redo);
  assert.equal(state.doc.toString(), pieces.join(""));

  const fake = fakeView(state);
  assert.equal(redo(fake.view), false, "redo 栈耗尽后必须如实返回 false");
});

test("粘贴粒度：composer 连续粘贴与附件互不吞并（三次粘贴 = 三步 undo + 卡片原样）", () => {
  const pieces = ["你", "🇯🇵", "𠀀"];
  let state = composerStateWith("", 0);
  for (const piece of pieces) state = pasteComposer(state, piece);
  assert.deepEqual(composerReading(state), { text: pieces.join(""), anchor: 7, head: 7, cards: [CARD] });

  for (const expected of ["你🇯🇵", "你", ""]) {
    state = composerUndo(state);
    assert.deepEqual(composerReading(state), { text: expected, anchor: expected.length, head: expected.length, cards: [CARD] });
  }
  for (const piece of pieces) {
    state = composerRedo(state);
    assert.equal(state.doc.toString().endsWith(piece), true);
  }
  assert.deepEqual(composerReading(state).cards, [CARD], "文案粘贴全程不触碰附件");
});

test("redo 作废：undo 之后的新粘贴清空 redo（正文）", () => {
  let state = bodyState("seed\n", 5);
  mock.timers.tick(BODY_BARRIER_MS);
  state = pasteBody(state, "甲");
  mock.timers.tick(BODY_BARRIER_MS);
  state = runBody(state, undo);
  assert.equal(state.doc.toString(), "seed\n");

  mock.timers.tick(BODY_BARRIER_MS);
  state = pasteBody(state, "乙");
  assert.equal(state.doc.toString(), "seed\n乙");

  const fake = fakeView(state);
  assert.equal(redo(fake.view), false, "新粘贴后 redo 必须作废");
  assert.equal(fake.state.doc.toString(), "seed\n乙", "redo 不得复活旧内容");
});

test("redo 作废：composer 的新粘贴同样清空 redo，且不产生附件步", () => {
  let state = composerStateWith("", 0);
  mock.timers.tick(COMPOSER_BARRIER_MS);
  state = pasteComposer(state, "甲");
  mock.timers.tick(COMPOSER_BARRIER_MS);
  state = composerUndo(state);
  assert.equal(state.doc.toString(), "");

  mock.timers.tick(COMPOSER_BARRIER_MS);
  state = pasteComposer(state, "乙");
  const beforeRedo = state;
  assert.equal(composerRedo(state), beforeRedo, "redo 已作废时必须是恒等 state");
  assert.deepEqual(composerReading(beforeRedo), { text: "乙", anchor: 1, head: 1, cards: [CARD] });
});

// ---------------------------------------------------------------------------
// 四、固定 seed 的正文 / composer 随机对拍（Unicode 粘贴 + 选区 + 历史）
// ---------------------------------------------------------------------------

const UNICODE_ALPHABET = [
  "a",
  "问",
  "👨‍👩‍👧‍👦",
  "🇯🇵",
  "👍🏽",
  "e\u0301\u0323",
  "مَ",
  "שָׁ",
  "𠀀",
  "\n",
  " ",
] as const;

type ScriptOp =
  | { kind: "insert"; text: string }
  | { kind: "paste"; text: string }
  | { kind: "deleteBackward" }
  | { kind: "deleteForward" }
  | { kind: "setSelection"; anchor: number; head: number }
  | { kind: "undo" }
  | { kind: "redo" };

type ScriptCategory = "insert" | "paste" | "delete" | "selection" | "undo" | "redo";

function categoryOf(op: ScriptOp): ScriptCategory {
  switch (op.kind) {
    case "insert":
      return "insert";
    case "paste":
      return "paste";
    case "deleteBackward":
    case "deleteForward":
      return "delete";
    case "setSelection":
      return "selection";
    case "undo":
      return "undo";
    case "redo":
      return "redo";
  }
}

/** 当前文本的字素边界集合（随机选区只允许落在边界上——码元中段是 UI 不可达状态）。 */
function graphemePositions(text: string): number[] {
  const positions = new Set<number>([0, text.length]);
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const piece of segmenter.segment(text)) positions.add(piece.index + piece.segment.length);
  return [...positions].sort((a, b) => a - b);
}

function randomText(rng: ReturnType<typeof makeRng>, maxPieces: number, alphabet: readonly string[] = UNICODE_ALPHABET): string {
  const count = 1 + rngInt(rng, maxPieces);
  let text = "";
  for (let index = 0; index < count; index += 1) text += pickOne(rng, alphabet);
  return text;
}

function randomScriptOp(
  rng: ReturnType<typeof makeRng>,
  model: BodyOracle | ComposerOracle,
  alphabet: readonly string[] = UNICODE_ALPHABET,
): ScriptOp {
  const text = "doc" in model ? model.doc : model.text;
  const roll = rng.next();
  if (roll < 0.28) return { kind: "insert", text: randomText(rng, 3, alphabet) };
  if (roll < 0.48) return { kind: "paste", text: randomText(rng, 2, alphabet) };
  if (roll < 0.6) return { kind: "deleteBackward" };
  if (roll < 0.7) return { kind: "deleteForward" };
  if (roll < 0.86) {
    const boundaries = graphemePositions(text);
    const anchor = pickOne(rng, boundaries);
    const head = rng.next() < 0.55 ? anchor : pickOne(rng, boundaries);
    return { kind: "setSelection", anchor, head };
  }
  if (roll < 0.94) return { kind: "undo" };
  return { kind: "redo" };
}

function writesSelection(op: ScriptOp): boolean {
  return op.kind === "insert" || op.kind === "paste" || op.kind === "deleteBackward"
    || op.kind === "deleteForward" || op.kind === "setSelection";
}

interface Histogram {
  counts: Map<ScriptCategory, number>;
  docChangingPastes: number;
  docChangingUndos: number;
}

function emptyHistogram(): Histogram {
  return { counts: new Map(), docChangingPastes: 0, docChangingUndos: 0 };
}

function bump(histogram: Histogram, op: ScriptOp, changed: boolean): void {
  const category = categoryOf(op);
  histogram.counts.set(category, (histogram.counts.get(category) ?? 0) + 1);
  if (op.kind === "paste" && changed) histogram.docChangingPastes += 1;
  if (op.kind === "undo" && changed) histogram.docChangingUndos += 1;
}

function assertHistogramUsable(histogram: Histogram, label: string): void {
  for (const category of ["insert", "paste", "delete", "selection", "undo", "redo"] as const) {
    assert.ok(
      (histogram.counts.get(category) ?? 0) > 0,
      `${label}: 随机序列空转——${category} 类操作为 0（${JSON.stringify([...histogram.counts])}）`,
    );
  }
  assert.ok(histogram.docChangingPastes > 0, `${label}: 没有一次粘贴真的改了文档（断言在空转）`);
  assert.ok(histogram.docChangingUndos > 0, `${label}: 没有一次 undo 真的改了文档（断言在空转）`);
}

function applyBodyScriptOp(state: EditorState, op: ScriptOp): EditorState {
  switch (op.kind) {
    case "insert":
      return state.update({
        ...state.replaceSelection(op.text),
        userEvent: "input.type",
      }).state;
    case "paste":
      return pasteBody(state, op.text);
    case "deleteBackward":
      return deleteBodyBackward(state);
    case "deleteForward":
      return deleteBodyForward(state);
    case "setSelection":
      return state.update({
        selection: EditorSelection.range(op.anchor, op.head),
        annotations: Transaction.addToHistory.of(false),
      }).state;
    case "undo":
      return runBody(state, undo);
    case "redo":
      return runBody(state, redo);
  }
}

function applyComposerScriptOp(state: EditorState, op: ScriptOp): EditorState {
  switch (op.kind) {
    case "insert":
      return pasteComposer(state, op.text, "input.type");
    case "paste":
      return pasteComposer(state, op.text);
    case "deleteBackward":
      return runComposer(state, "editor.delete-char-backward");
    case "deleteForward":
      return runComposer(state, "editor.delete-char-forward");
    case "setSelection":
      return state.update({
        selection: EditorSelection.range(op.anchor, op.head),
        annotations: Transaction.addToHistory.of(false),
      }).state;
    case "undo":
      return composerUndo(state);
    case "redo":
      return composerRedo(state);
  }
}

test("正文随机对拍：Unicode 插入 / 粘贴 / 反向选区 / undo-redo（固定 seeds）", () => {
  const histogram = emptyHistogram();
  for (const seed of BODY_SEEDS) {
    const model = new BodyOracle("种子🙂\n- 列表\n", 0);
    let state = bodyState(model.doc, 0);
    const rng = makeRng((seed >>> 0) ^ 0x1f83d9ab);
    for (let step = 0; step < RANDOM_STEPS; step += 1) {
      const op = randomScriptOp(rng, model);
      const before = bodyReading(state);
      mock.timers.tick(BODY_BARRIER_MS);
      state = applyBodyScriptOp(state, op);
      switch (op.kind) {
        case "insert":
        case "paste":
          model.insert(op.text);
          break;
        case "deleteBackward":
          model.deleteBackward();
          break;
        case "deleteForward":
          model.deleteForward();
          break;
        case "setSelection":
          model.setSelection(op.anchor, op.head);
          break;
        case "undo":
          model.undo();
          break;
        case "redo":
          model.redo();
          break;
      }
      if (op.kind === "undo" || op.kind === "redo") {
        // CM 的 undo/redo 回填选区与模型快照可以不同；下一步要读选区时先显式归一（不进 history）。
        state = state.update({
          selection: EditorSelection.cursor(model.head),
          annotations: Transaction.addToHistory.of(false),
        }).state;
      }
      const expected = model.reading();
      const actual = bodyReading(state);
      if (actual.text !== expected.doc || (writesSelection(op) && (actual.anchor !== expected.anchor || actual.head !== expected.head))) {
        fail(seed, step, JSON.stringify(op), JSON.stringify(before), expected, actual);
      }
      assertNoLoneSurrogates(actual.text, `seed=${seed} step=${step}`);
      bump(histogram, op, actual.text !== before.text);
    }
  }
  assertHistogramUsable(histogram, "正文随机对拍");
});

test("composer 随机对拍：Unicode 粘贴 / 选区替换 / 历史（固定 seeds）", () => {
  const histogram = emptyHistogram();
  for (const seed of COMPOSER_SEEDS) {
    const model = new ComposerOracle({ text: "种子🙂", caret: 2, cards: ["quote"] });
    let state = composerStateWith(model.text, 2);
    const rng = makeRng((seed >>> 0) ^ 0x2c1b3c6d);
    for (let step = 0; step < RANDOM_STEPS; step += 1) {
      const op = randomScriptOp(rng, model, UNICODE_ALPHABET);
      const before = composerReading(state);
      mock.timers.tick(COMPOSER_BARRIER_MS);
      state = applyComposerScriptOp(state, op);
      switch (op.kind) {
        case "insert":
        case "paste":
          model.insert(op.text);
          break;
        case "deleteBackward":
          model.deleteBackward();
          break;
        case "deleteForward":
          model.deleteForward();
          break;
        case "setSelection":
          model.setSelection(op.anchor, op.head);
          break;
        case "undo":
          model.undo();
          break;
        case "redo":
          model.redo();
          break;
      }
      if (op.kind === "undo" || op.kind === "redo") {
        state = state.update({
          selection: EditorSelection.cursor(model.head),
          annotations: Transaction.addToHistory.of(false),
        }).state;
      }
      const expected = model.reading();
      const actual = composerReading(state);
      if (
        actual.text !== expected.text
        || (writesSelection(op) && (actual.anchor !== expected.anchor || actual.head !== expected.head))
        || JSON.stringify(actual.cards) !== JSON.stringify([CARD])
      ) {
        fail(seed, step, JSON.stringify(op), JSON.stringify(before), expected, actual);
      }
      bump(histogram, op, actual.text !== before.text);
    }
  }
  assertHistogramUsable(histogram, "composer 随机对拍");
});

// ---------------------------------------------------------------------------
// 五、剪贴板优先级与图片引用插入（DOM 无关纯判据）
// ---------------------------------------------------------------------------

const IMAGE_PNG = { kind: "file", type: "image/png" };
const IMAGE_SVG = { kind: "file", type: "image/svg+xml" };
const TEXT_PLAIN = { kind: "string", type: "text/plain" };
const TEXT_HTML = { kind: "string", type: "text/html" };
const TEXT_URI = { kind: "string", type: "text/uri-list" };
const PDF_FILE = { kind: "file", type: "application/pdf" };
const EDITABLE_MD = { mode: "md", editable: true } as const;

test("图片优先级：首个 image/* 文件项压过文本 / HTML / uri-list / 非图片文件", () => {
  const rows: Array<{ name: string; items: Array<{ kind: string; type: string }>; expected: number | null }> = [
    { name: "纯文本", items: [TEXT_PLAIN], expected: null },
    { name: "HTML string 项不是图片", items: [TEXT_HTML], expected: null },
    { name: "图文同板（图优先）", items: [TEXT_PLAIN, TEXT_HTML, IMAGE_PNG], expected: 2 },
    { name: "非图片文件在前", items: [PDF_FILE, IMAGE_SVG], expected: 1 },
    { name: "多图只取第一张", items: [IMAGE_SVG, IMAGE_PNG], expected: 0 },
    { name: "uri-list 不参与图片判定", items: [TEXT_URI], expected: null },
    { name: "string 项自己声明 image/png 不算文件", items: [{ kind: "string", type: "image/png" }], expected: null },
    { name: "空剪贴板", items: [], expected: null },
  ];
  for (const row of rows) {
    assert.equal(imagePasteItemIndex(EDITABLE_MD, row.items), row.expected, row.name);
    const composerIndex = firstImageFileIndex(row.items);
    const scanned = row.items.findIndex((item) => item.kind === "file" && item.type.startsWith("image/"));
    assert.equal(composerIndex, scanned, `${row.name}: composer 复用同一条「首个 image 文件项」语义`);
  }

  // 模式 / 只读矩阵：图片存在也不消费事件（默认文本粘贴逐字节不变）。
  for (const session of [
    { mode: "code", editable: true },
    { mode: "md", editable: false },
    { mode: "image", editable: true },
  ] as const) {
    assert.equal(imagePasteItemIndex(session, [IMAGE_PNG]), null, `${session.mode}/${session.editable}`);
  }
});

test("图片优先级随机板：固定 seed 对拍独立扫描规则，命中 / 未命中都非零", () => {
  const kinds = ["file", "string"] as const;
  const types = ["image/png", "image/svg+xml", "text/plain", "text/html", "text/uri-list", "application/pdf", "image"] as const;
  const rng = makeRng(0x5eed_843);
  const histogram = { hit: 0, miss: 0 };
  for (let board = 0; board < 200; board += 1) {
    const size = rngInt(rng, 6);
    const items: Array<{ kind: string; type: string }> = [];
    for (let index = 0; index < size; index += 1) {
      items.push({ kind: pickOne(rng, kinds), type: pickOne(rng, types) });
    }
    let expected: number | null = null;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      // 独立规则：只认文件项 + 以 `image/` 开头（`image` 这种缺斜杠的 MIME 不算）。
      if (item.kind === "file" && item.type.startsWith("image/")) {
        expected = index;
        break;
      }
    }
    assert.equal(imagePasteItemIndex(EDITABLE_MD, items), expected, `board ${board}: ${JSON.stringify(items)}`);
    assert.equal(
      firstImageFileIndex(items),
      expected === null ? -1 : expected,
      `board ${board}: composer 扫描（无命中为 -1）`,
    );
    if (expected === null) histogram.miss += 1;
    else histogram.hit += 1;
  }
  assert.ok(histogram.hit > 0 && histogram.miss > 0, `随机板空转：${JSON.stringify(histogram)}`);
});

test("图片引用事务：块级独占一行 + 替换选区（有向矩阵）", () => {
  const doc = "alpha\nbeta";
  const rows: Array<{
    name: string;
    doc: string;
    from: number;
    to: number;
    expected: { from: number; to: number; insert: string };
  }> = [
    { name: "行中 caret 两侧补换行", doc, from: 2, to: 2, expected: { from: 2, to: 2, insert: "\n![[x.webp]]\n" } },
    { name: "选区跨行", doc, from: 2, to: 8, expected: { from: 2, to: 8, insert: "\n![[x.webp]]\n" } },
    { name: "文首", doc, from: 0, to: 0, expected: { from: 0, to: 0, insert: "![[x.webp]]\n" } },
    { name: "文末（前一字符非换行）", doc, from: 10, to: 10, expected: { from: 10, to: 10, insert: "\n![[x.webp]]" } },
    { name: "已在空行", doc: "a\n\nb", from: 2, to: 2, expected: { from: 2, to: 2, insert: "![[x.webp]]" } },
    { name: "整篇选区", doc, from: 0, to: 10, expected: { from: 0, to: 10, insert: "![[x.webp]]" } },
    { name: "空文档", doc: "", from: 0, to: 0, expected: { from: 0, to: 0, insert: "![[x.webp]]" } },
  ];
  for (const row of rows) {
    assert.deepEqual(pastedImageInsertion(row.doc, row.from, row.to, "x.webp"), row.expected, row.name);
  }
});

test("图片引用性质：任意文档 / 选区下引用都独占一行，且只替换给定区间", () => {
  const rng = makeRng(0x8430_ccde);
  const alphabet = ["a", "b", " ", "\n", "文", "👨‍👩‍👧‍👦"];
  for (let board = 0; board < 80; board += 1) {
    let doc = "";
    const length = rngInt(rng, 24);
    for (let index = 0; index < length; index += 1) doc += pickOne(rng, alphabet);
    const from = rngInt(rng, doc.length + 1);
    const to = from + rngInt(rng, doc.length - from + 1);
    const spec = pastedImageInsertion(doc, from, to, "x.webp");
    assert.equal(spec.from, from);
    assert.equal(spec.to, to);
    const applied = doc.slice(0, from) + spec.insert + doc.slice(to);
    assert.equal(applied.indexOf("![[x.webp]]"), from + spec.insert.indexOf("![[x.webp]]"));
    assert.equal(applied.split("![[x.webp]]").length - 1, 1, `board ${board}: 引用必须恰好一次`);
    // 引用所在行 trim 后必须只剩引用本身（块级独占一行）。
    const lineFrom = applied.lastIndexOf("\n", spec.from + spec.insert.indexOf("![[x.webp]]")) + 1;
    const lineToIndex = applied.indexOf("\n", spec.from + spec.insert.indexOf("![[x.webp]]"));
    const line = applied.slice(lineFrom, lineToIndex < 0 ? applied.length : lineToIndex);
    assert.equal(line.trim(), "![[x.webp]]", `board ${board}: ${JSON.stringify(applied)}`);
  }
});

// ---------------------------------------------------------------------------
// 六、剪贴板内容 / 附件 / caret 各只变化一次（composer 生产事务）
// ---------------------------------------------------------------------------

test("文本粘贴只变化一次：文档 +1 拍、附件 field 恒等、撤销恢复粘贴前选区", () => {
  const initial = composerStateWith("前后", 1);
  const cardsBefore = initial.field(composerAttachmentsField);
  const pasted = pasteComposer(initial, "👨‍👩‍👧‍👦");
  assert.deepEqual(composerReading(pasted), { text: "前👨‍👩‍👧‍👦后", anchor: 12, head: 12, cards: [CARD] });
  assert.deepEqual(pasted.field(composerAttachmentsField), cardsBefore, "文本粘贴不得增删附件");

  const undone = composerUndo(pasted);
  assert.deepEqual(composerReading(undone), { text: "前后", anchor: 1, head: 1, cards: [CARD] });
  // 附件在初始化时不在 history 里：再撤一拍不得把卡片撤掉。
  const secondUndo = composerUndo(undone);
  assert.deepEqual(composerReading(secondUndo), { text: "前后", anchor: 1, head: 1, cards: [CARD] });
});

test("反向选区粘贴：caret 落在 from+insert.length，撤销恢复反向方向", () => {
  const doc = "甲乙丙丁";
  const selected = composerStateWith(doc, 0).update({
    selection: EditorSelection.range(3, 1),
    annotations: Transaction.addToHistory.of(false),
  }).state;
  const pasted = pasteComposer(selected, "🙂");
  assert.deepEqual(composerReading(pasted), { text: "甲🙂丁", anchor: 3, head: 3, cards: [CARD] });
  const undone = composerUndo(pasted);
  assert.deepEqual(composerReading(undone), { text: doc, anchor: 3, head: 1, cards: [CARD] });
});
