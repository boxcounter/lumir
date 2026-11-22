import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import type { Extension, TransactionSpec } from "@codemirror/state";
import type { SelectionRange } from "@codemirror/state";
import {
  cursorCharBackward,
  cursorCharForward,
  cursorLineEnd,
  cursorLineStart,
  deleteCharForward,
  invertedEffects,
  isolateHistory,
  history,
  redo,
  selectCharBackward,
  selectCharForward,
  selectLineEnd,
  selectLineStart,
  undo,
} from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import type { CommandId } from "./keys";
import {
  clusterBackward,
  clusterForward,
  currentKillSlot,
  mergeKillText,
  projectDelivery,
  setKillSlot,
  wordEndForward,
  wordStartBackward,
} from "./quote-card";
import type { ComposerAttachment, ComposerBlock, DeliveryProjection } from "./quote-card";

export interface ComposerContent {
  text: string;
  caret: number | null;
  cards: readonly ComposerAttachment[];
}

type AttachmentEdit =
  | { readonly type: "append"; readonly at: number; readonly cards: readonly ComposerAttachment[] }
  | { readonly type: "remove"; readonly index: number };

export const composerAttachmentEffect = StateEffect.define<AttachmentEdit>();

export const composerAttachmentsField = StateField.define<readonly ComposerAttachment[]>({
  create: () => [],
  update(attachments, tr) {
    let next = attachments;
    for (const effect of tr.effects) {
      if (!effect.is(composerAttachmentEffect)) continue;
      if (effect.value.type === "append") {
        const at = Math.max(0, Math.min(effect.value.at, next.length));
        next = [...next.slice(0, at), ...effect.value.cards, ...next.slice(at)];
      } else if (effect.value.index >= 0 && effect.value.index < next.length) {
        next = [...next.slice(0, effect.value.index), ...next.slice(effect.value.index + 1)];
      }
    }
    return next;
  },
});

const composerAttachmentInversions = invertedEffects.of((tr) => {
  const inverse: StateEffect<AttachmentEdit>[] = [];
  let current = [...tr.startState.field(composerAttachmentsField)];
  for (const effect of tr.effects) {
    if (!effect.is(composerAttachmentEffect)) continue;
    const edit = effect.value;
    if (edit.type === "append") {
      const at = Math.max(0, Math.min(edit.at, current.length));
      for (let index = 0; index < edit.cards.length; index += 1) {
        inverse.push(composerAttachmentEffect.of({ type: "remove", index: at }));
      }
      current = [...current.slice(0, at), ...edit.cards, ...current.slice(at)];
    } else {
      const card = current[edit.index];
      if (card !== undefined) {
        inverse.push(composerAttachmentEffect.of({ type: "append", at: edit.index, cards: [card] }));
        current = [...current.slice(0, edit.index), ...current.slice(edit.index + 1)];
      }
    }
  }
  return inverse.reverse();
});

/** composer 的物理 Backspace 闸门（M860）：折叠 caret 上无修饰的 Backspace
 *  （`deleteContentBackward`）按一个字素簇删除，步长与正文 `⌃H` / `⌃D` 同一份核
 *  （`quote-card.clusterBackward`）。修饰键变体以不同 inputType 到达（`⌥⌫` =
 *  `deleteWordBackward`、`⌘⌫` = `deleteHardLineBackward` / `deleteSoftLineBackward`），
 *  因此「只认 `deleteContentBackward`」就是「只认无修饰 Backspace」，不读键盘修饰位；
 *  IME 组合期、只读会话与非空选区保持既有路径（非空选区删除归编辑器侧 M854 的选区
 *  编辑合同；composer 是纯文本，原生删选区逐字节正确）。正文侧同一判定在
 *  `src/editor.ts` 的 `absorbGraphemeBackspace`（两个编辑面各自的入口，字素步长核只有
 *  一份——REVIEW.md「同一语义两处真源」条）。 */
export function absorbComposerGraphemeBackspace(event: InputEvent, view: EditorView): boolean {
  if (event.inputType !== "deleteContentBackward") return false;
  const state = view.state;
  if (state.readOnly || view.compositionStarted || event.isComposing) return false;
  const ranges = state.selection.ranges;
  if (ranges.length !== 1 || !ranges[0].empty) return false;
  event.preventDefault();
  deleteCharBackward(view);
  return true;
}

const composerGraphemeBackspace = EditorView.domEventHandlers({
  beforeinput: (event, view) => absorbComposerGraphemeBackspace(event as InputEvent, view),
});

export const composerStateExtensions = [
  history(),
  composerAttachmentsField,
  composerAttachmentInversions,
  composerGraphemeBackspace,
];

export function createComposerState(content: ComposerContent, extensions: readonly Extension[] = []): EditorState {
  const caret = content.caret === null
    ? content.text.length
    : Math.max(0, Math.min(content.caret, content.text.length));
  return EditorState.create({
    doc: content.text,
    selection: EditorSelection.cursor(caret),
    extensions: [
      ...composerStateExtensions,
      composerAttachmentsField.init(() => content.cards),
      ...extensions,
    ],
  });
}

export function composerContentOf(state: EditorState): ComposerContent {
  return {
    text: state.doc.toString(),
    caret: state.selection.main.head,
    cards: state.field(composerAttachmentsField),
  };
}

export function composerIsEmpty(state: EditorState): boolean {
  return state.doc.length === 0 && state.field(composerAttachmentsField).length === 0;
}

/**
 * 发送被同步拒绝、而拒绝回包晚于用户的下一条输入时，输入区的确定性合并（typeahead 口径）：
 * 原文在前、当前输入在后；caret 按「原文长度 + 当前 caret」偏移（`null` = 末尾）；卡片原在
 * 前、当前在后。**不丢任何一边**——直接整份覆盖会把用户在等待期间打的字 / 贴的卡静默删掉。
 *
 * 输入区仍是发送后的空态（最常见路径）时原样返回 `restored`，逐字段还原（含 caret）不变。
 * 合并结果只是**内容**；落盘由调用方在 `resetComposer` 之后显式 `markDraft()`（换 state 不触发
 * updateListener）。
 */
export function mergeRejectedComposerContent(
  restored: ComposerContent,
  current: ComposerContent,
): ComposerContent {
  if (current.text === "" && current.cards.length === 0) return restored;
  return {
    text: restored.text + current.text,
    caret: current.caret === null ? null : restored.text.length + current.caret,
    cards: [...restored.cards, ...current.cards],
  };
}

export function appendComposerAttachments(cards: readonly ComposerAttachment[]): TransactionSpec {
  return {
    effects: composerAttachmentEffect.of({ type: "append", at: Number.MAX_SAFE_INTEGER, cards }),
    annotations: isolateHistory.of("full"),
  };
}

export function removeComposerAttachment(index: number): TransactionSpec {
  return {
    effects: composerAttachmentEffect.of({ type: "remove", index }),
    annotations: isolateHistory.of("full"),
  };
}

export function composerBlocks(state: EditorState): ComposerBlock[] {
  return [
    ...state.field(composerAttachmentsField),
    { kind: "paragraph", text: state.doc.toString() },
  ];
}

export function projectComposerDelivery(state: EditorState): DeliveryProjection {
  return projectDelivery(composerBlocks(state));
}

function readDoc(state: EditorState, from: number, to: number): string {
  return state.doc.sliceString(from, to);
}

function deleteRange(view: EditorView, from: number, to: number, userEvent: string): void {
  if (from >= to) return;
  view.dispatch({
    changes: { from, to },
    selection: EditorSelection.cursor(from),
    scrollIntoView: true,
    userEvent,
  });
}

/** composer 的 `⌃H`：折叠 caret 上删一个整字素簇（`quote-card.clusterBackward`），有选区则
 *  删选区；一次删除 = 一条 history 步。步长与正文 `editor.delete-char-backward` 同源。
 *  MUST NOT 再用 CM 的 `deleteCharBackward`：它按 CM 簇后缀（`includeExtending=false`）退、
 *  且在行首缩进区按缩进单位回退，与正文步长不同（M843 finding，M860 收口）。
 *
 *  只读早退沿用旧命令的口径（CM 的 `deleteBy` 在 `state.readOnly` 时直接返回）：命令入口
 *  自己守一道，不依赖 beforeinput 闸门的只读判定——直接调用 `runComposerCommand` 的路径
 *  没有闸门（review P2-1）。 */
function deleteCharBackward(view: EditorView): void {
  if (view.state.readOnly) return;
  const main = view.state.selection.main;
  if (!main.empty) {
    deleteRange(view, main.from, main.to, "delete.selection");
    return;
  }
  const start = clusterBackward((from, to) => readDoc(view.state, from, to), main.head, 0);
  if (start >= main.head) return;
  deleteRange(view, start, main.head, "delete.char.backward");
}

function killRange(view: EditorView, from: number, to: number, forward: boolean): void {
  if (from >= to) return;
  const text = view.state.doc.sliceString(from, to);
  const merged = mergeKillText(currentKillSlot(), text, forward, String(forward ? from : to));
  setKillSlot({ text: merged, forward, anchor: String(from) });
  deleteRange(view, from, to, "delete.kill");
}

function killWord(view: EditorView, forward: boolean): void {
  const main = view.state.selection.main;
  if (!main.empty) {
    killRange(view, main.from, main.to, forward);
    return;
  }
  const end = forward
    ? wordEndForward((from, to) => readDoc(view.state, from, to), main.head, view.state.doc.length)
    : wordStartBackward((from, to) => readDoc(view.state, from, to), main.head, 0);
  if (forward) killRange(view, main.head, end, true);
  else killRange(view, end, main.head, false);
}

function killLine(view: EditorView): void {
  const main = view.state.selection.main;
  if (!main.empty) {
    killRange(view, main.from, main.to, true);
    return;
  }
  const line = view.state.doc.lineAt(main.head);
  if (main.head < line.to) killRange(view, main.head, line.to, true);
  else if (line.number < view.state.doc.lines) killRange(view, line.to, line.to + 1, true);
}

function yank(view: EditorView): void {
  const text = currentKillSlot()?.text ?? "";
  if (text === "") return;
  const main = view.state.selection.main;
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: text },
    selection: EditorSelection.cursor(main.from + text.length),
    scrollIntoView: true,
    userEvent: "input.yank",
  });
}

function transpose(view: EditorView): void {
  const main = view.state.selection.main;
  if (!main.empty) return;
  const line = view.state.doc.lineAt(main.head);
  const pos = Math.max(line.from, Math.min(main.head, line.to));
  const left = clusterBackward((from, to) => readDoc(view.state, from, to), pos, line.from);
  const right = clusterForward((from, to) => readDoc(view.state, from, to), pos, line.to);
  if (left < pos && right > pos) {
    const a = view.state.doc.sliceString(left, pos);
    const b = view.state.doc.sliceString(pos, right);
    view.dispatch({
      changes: { from: left, to: right, insert: b + a },
      selection: EditorSelection.cursor(right),
      scrollIntoView: true,
      userEvent: "move.transpose",
    });
    return;
  }
  const previous = clusterBackward((from, to) => readDoc(view.state, from, to), left, line.from);
  if (previous >= left) return;
  const a = view.state.doc.sliceString(previous, left);
  const b = view.state.doc.sliceString(left, pos);
  view.dispatch({
    changes: { from: previous, to: pos, insert: b + a },
    selection: EditorSelection.cursor(pos),
    scrollIntoView: true,
    userEvent: "move.transpose",
  });
}

function extendWord(view: EditorView, forward: boolean): void {
  const main = view.state.selection.main;
  const head = forward
    ? wordEndForward((from, to) => readDoc(view.state, from, to), main.head, view.state.doc.length)
    : wordStartBackward((from, to) => readDoc(view.state, from, to), main.head, 0);
  if (head === main.head) return;
  view.dispatch({ selection: EditorSelection.range(main.anchor, head), scrollIntoView: true, userEvent: "select" });
}

/** `SelectionRange.assoc` 的运行时值是 0 / ±1，类型是 number；本文件的取行与重建都只认这三档。 */
function assocOf(range: SelectionRange): -1 | 0 | 1 {
  return range.assoc < 0 ? -1 : range.assoc > 0 ? 1 : 0;
}

/** 光标所在**渲染行**（软折行的一屏行）的左右端。`includeWrap` 的 `moveToLineBoundary` 取的是
 *  该屏行的两侧（LTR：左侧 = 屏行行首、右侧 = 下一屏行行首）；`assoc` 参与取行——assoc=-1 且不在
 *  行首时按 `head - 1` 的 y 取行，停在折行点上的光标因此仍算前一屏行行尾（与 `coordsAtPos` 的
 *  画法一致）。空行 / 单屏行时两端重合。 */
function composerRowBounds(view: EditorView, pos: number, assoc: -1 | 0 | 1): { from: number; to: number } {
  const axis = EditorSelection.cursor(pos, assoc);
  const left = view.moveToLineBoundary(axis, false, true).head;
  const right = view.moveToLineBoundary(axis, true, true).head;
  return { from: Math.min(left, right), to: Math.max(left, right) };
}

/** ⌃N / ⌃P 一步的目标：**行选交给 CM、列位按行内字符列**。
 *
 *  为什么不用 `cursorLineUp` / `cursorLineDown`：CM 的竖直移动把 goal column 当**像素 x**
 *  （`view.moveVertically` 用 `coordsAtPos` 测光标左缘、落点用 `posAtCoords` 取最近的字符边界）。
 *  composer 的字体是比例字体（`--font-sans`），两行同一字符列的像素宽并不相等：`mn` 的 18.75px
 *  在上一行 `yabzcdw` 里离第 3 格（21.53px）比第 2 格（13.81px）更近，于是第 2 列按 ⌃P 落到第 3 列
 *  （真机 140 现场：期望 `yapbzcdw`、实得 `yabpzcdw`）。本条把列位定义成**行内字符列**（Emacs
 *  `previous-line` / `next-line` 的 goal column 口径），软折行的行间移动仍由 `moveVertically`
 *  选行（折行点、视口边界归 CM），落点按字符列在目标屏行里重算。
 *
 *  goal column 用**字符数**携带在 `SelectionRange.goalColumn` 里（CM 只把它当不透明数字传回调用方，
 *  本文件之外没有任何真实消费者；一旦调用 `moveVertically` 就必须先剥掉它，否则会被当成像素）：
 *  连续上下移动越过短行被钳到行尾后，回到长行仍回原列；水平移动 / 键入 / 换行替换选区时自然丢列。
 *
 *  **落点的 `assoc` 必须显式给**（CM 的边界语义，不是可选装饰）：行首 = +1（属于该屏行）、钳到
 *  非空行尾 = -1（属于该屏行行尾，而不是下一屏行行首）、行内其余位置 = 0。给 0 会被 CM 在非空
 *  range 上按扩选方向自动补侧（向下补 -1、向上补 +1），head 的文档 offset 到了目标屏行、assoc 却
 *  仍指向来路那一屏——下一次 `composerRowBounds` 按 assoc 取行又落回上一屏，连续 ⇧⌃N / ⇧⌃P 从
 *  第二次起原地不动（r1 review P2-1 的双向现场）。`bidiLevel` 沿用起点（RTL 段的光标从属侧不因
 *  竖直移动丢掉）。 */
function composerVerticalTarget(
  view: EditorView,
  start: SelectionRange,
  forward: boolean,
  lineBoundaryFallback: boolean,
): SelectionRange {
  const startAssoc = assocOf(start);
  const moved = view.moveVertically(EditorSelection.cursor(start.head, start.assoc), forward);
  const startRow = composerRowBounds(view, start.head, startAssoc);
  const goal = start.goalColumn ?? start.head - startRow.from;
  const targetRow = composerRowBounds(view, moved.head, assocOf(moved));
  // 没有跨出起点所在的屏行 = 该方向已无可停靠行（文档首 / 末行的原地不动，moveVertically 在末行
  // 会把落点钳到文档末尾、仍留在同一屏行）：折叠光标回落行首 / 行尾（与 CM cursorByLine 同序），
  // 扩选照 CM selectByLine 取 moveVertically 的落点（即文档末端）。
  if (targetRow.from === startRow.from && targetRow.to === startRow.to) {
    if (lineBoundaryFallback) {
      return view.moveToLineBoundary(EditorSelection.cursor(start.head, start.assoc), forward);
    }
    if (moved.head === start.head) return start;
    return EditorSelection.cursor(moved.head, assocOf(moved), start.bidiLevel ?? undefined, goal);
  }
  const width = targetRow.to - targetRow.from;
  const column = Math.max(0, Math.min(goal, width));
  const assoc = column === 0 ? 1 : column === width && width > 0 ? -1 : 0;
  return EditorSelection.cursor(targetRow.from + column, assoc, start.bidiLevel ?? undefined, goal);
}

/** ⌃N / ⌃P：空光标按 `composerVerticalTarget` 走一步；非空选区先折叠（与 CM `cursorByLine` 同序）。
 *  文档首 / 末行的原地不动落到行首 / 行尾（同上）。 */
function moveComposerLine(view: EditorView, forward: boolean): void {
  const main = view.state.selection.main;
  if (!main.empty) {
    view.dispatch({
      selection: EditorSelection.cursor(forward ? main.to : main.from),
      scrollIntoView: true,
      userEvent: "select",
    });
    return;
  }
  const target = composerVerticalTarget(view, main, forward, true);
  if (target.head === main.head && target.assoc === main.assoc) return;
  // 传 SelectionRange 会被 CM 按单 range 重建并丢掉 goalColumn，须包成 EditorSelection。
  view.dispatch({ selection: EditorSelection.create([target]), scrollIntoView: true, userEvent: "select" });
}

/** ⇧⌃N / ⇧⌃P：anchor 不动、head 走同一份 `composerVerticalTarget`（与 CM `selectByLine` 同序——
 *  扩选没有文档边界回落，原地不动即无动作）。 */
function extendComposerLine(view: EditorView, forward: boolean): void {
  const main = view.state.selection.main;
  const target = composerVerticalTarget(view, main, forward, false);
  if (target.head === main.head && target.assoc === main.assoc) return;
  // 与 CM `extendSel` 同形：anchor 不动、head 的 goalColumn / bidiLevel / assoc 全部随目标走。
  view.dispatch({
    selection: EditorSelection.create([
      EditorSelection.range(
        main.anchor,
        target.head,
        target.goalColumn ?? undefined,
        target.bidiLevel || undefined,
        target.assoc,
      ),
    ]),
    scrollIntoView: true,
    userEvent: "select",
  });
}

export function runComposerCommand(view: EditorView, command: CommandId): void {
  switch (command) {
    case "editor.select-all":
      view.dispatch({ selection: EditorSelection.range(0, view.state.doc.length), userEvent: "select" });
      return;
    case "editor.cursor-forward": cursorCharForward(view); return;
    case "editor.cursor-backward": cursorCharBackward(view); return;
    case "editor.line-start": cursorLineStart(view); return;
    case "editor.line-end": cursorLineEnd(view); return;
    case "editor.cursor-up": moveComposerLine(view, false); return;
    case "editor.cursor-down": moveComposerLine(view, true); return;
    case "editor.extend-char-forward": selectCharForward(view); return;
    case "editor.extend-char-backward": selectCharBackward(view); return;
    case "editor.extend-line-start": selectLineStart(view); return;
    case "editor.extend-line-end": selectLineEnd(view); return;
    case "editor.extend-line-up": extendComposerLine(view, false); return;
    case "editor.extend-line-down": extendComposerLine(view, true); return;
    case "editor.extend-word-forward": extendWord(view, true); return;
    case "editor.extend-word-backward": extendWord(view, false); return;
    case "editor.delete-char-forward": deleteCharForward(view); return;
    case "editor.delete-char-backward": deleteCharBackward(view); return;
    case "editor.delete-word-forward": killWord(view, true); return;
    case "editor.delete-word-backward": killWord(view, false); return;
    case "editor.kill-line": killLine(view); return;
    case "editor.yank": yank(view); return;
    case "editor.transpose-chars": transpose(view); return;
    case "editor.undo": undo(view); return;
    case "editor.redo": redo(view); return;
    default: return;
  }
}

export function insertComposerText(view: EditorView, text: string, userEvent = "input.paste"): void {
  const main = view.state.selection.main;
  view.dispatch({
    changes: { from: main.from, to: main.to, insert: text },
    selection: EditorSelection.cursor(main.from + text.length),
    scrollIntoView: true,
    userEvent,
  });
}

export function applyComposerTransaction(
  state: EditorState,
  spec: TransactionSpec,
): EditorState {
  return state.update(spec).state;
}

export function composerUndo(state: EditorState): EditorState {
  let next = state;
  undo({ state, dispatch: (tr: Transaction) => { next = tr.state; } });
  return next;
}

export function composerRedo(state: EditorState): EditorState {
  let next = state;
  redo({ state, dispatch: (tr: Transaction) => { next = tr.state; } });
  return next;
}
