// 导航行高亮的瞬态装饰（change add-path-line-target-highlight-nov02）。
//
// 分工：本模块只管「一段闭区间行 → 行装饰」与它的消退时长 / 行数上限；计时器与生命周期
// （重复点击替换、切标签清除、关闭会话清除）在 `src/editor.ts` 的会话内核里——装饰存于
// StateField，随会话 state 走，因此清除必须按**会话**施加，而不是对当前 view 一刀切
// （本仓全部标签共用一个 EditorView，`view.setState` 切换）。
//
// 为什么用 `Decoration.line` 而不是 `Decoration.mark` 或选区：行装饰天然覆盖整行（含折行后的
// 所有视觉行），不依赖字符区间；选区的语义是「准备改写」，与导航反馈无关（旧 change
// add-path-line-range-links 的 D1 已排除选区）。
import { StateEffect, StateField } from "@codemirror/state";
import type { Extension, Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";

/** 高亮消退时长（与「摘录跳回高亮」的 ~1.4s 同一族瞬态语言）。 */
export const NAVIGATION_HIGHLIGHT_MS = 1400;

/** 单次高亮的行数上限（性能护栏）：钳制到文档行数后超过即不画高亮。
 *
 *  本机实测（200k 行文档，`EditorState.update` 构建行装饰，7 次取中位数）：2000 行 0.27ms、
 *  3000 行 0.34ms、20000 行 7.86ms、100000 行 34.26ms。2000 行留在单帧预算（16ms）内且余量
 *  充足；超过上限只落点不高亮——MUST NOT 截断成「只画前一段」，那会让视觉承诺与行范围不符。 */
export const MAX_HIGHLIGHT_LINES = 2000;

/** 行装饰类名（配色见 `src/style.css`，eink 档另有覆写）。 */
export const LINE_HIGHLIGHT_CLASS = "cm-line-highlight";

/** 设置 / 替换 / 清除行高亮。`null` 清除；新值整块替换旧值，因此「同一时刻只有一处高亮」是
 *  数据结构的性质，不靠调用方先清后设。 */
export const setLineHighlight = StateEffect.define<{ from: number; to: number } | null>();

/** 闭区间行号（1-based）→ 行装饰集；越界钳到 `1..doc.lines`，超上限返回空集。 */
export function lineHighlightRanges(doc: Text, from: number, to: number): DecorationSet {
  const start = Math.max(1, Math.min(Math.trunc(from), doc.lines));
  const end = Math.max(1, Math.min(Math.trunc(to), doc.lines));
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  if (high - low + 1 > MAX_HIGHLIGHT_LINES) return Decoration.none;
  const ranges = [];
  for (let line = low; line <= high; line += 1) {
    ranges.push(Decoration.line({ class: LINE_HIGHLIGHT_CLASS }).range(doc.line(line).from));
  }
  return Decoration.set(ranges);
}

/**
 * 行高亮的装饰字段。文档一变更即整块清除：行装饰的位置必须落在行首，文档编辑会把映射后的
 * 位置推到行中（`Decoration.line` 的行首不变量随之失效）；而高亮本来只是「刚才跳到了这里」的
 * 瞬态提示，用户开始编辑即已越过它，清掉比漂移更诚实。
 */
export const lineHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = tr.docChanged ? Decoration.none : deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setLineHighlight)) continue;
      next =
        effect.value === null
          ? Decoration.none
          : lineHighlightRanges(tr.state.doc, effect.value.from, effect.value.to);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 装进取会话基础层的扩展（md / code 两种模式与只读会话同一条路径）。 */
export const lineHighlightExtension: Extension = lineHighlightField;
