// 显露闸门：选区驱动的源码显露（M110 行级 / M145 链接 / M168 强调范围）的两个判定输入
// ——**判据选区**与**相接口径**——的唯一出处。
//
// 为什么需要「判据选区」（M259，真实桌面缺陷：点击 `**粗体**` 后字母被选中）：
// 显露一落地就改变布局——隐藏的 `**` 重新占宽（约 12px）。而 CM 的鼠标选区在按下时按
// 渲染态布局算一次落点，之后每次 mousemove 又按**当时的布局**重算一次
//（`basicMouseSelection.get` 比对 `start.pos` / `cur.pos`）。布局在按下与移动之间位移，
// 同一屏幕坐标便映射到靠前 1–2 个字符的位置，两个落点被当成一次拖拽，产生「只选中一个
// 字母」的幻影选区。12px 位移下这不是「偶尔」：任何非零的指针抖动都会跨过字符边界
//（点击抖动本身人皆有之）。
//
// 修法：按下的瞬间把选区冻成快照，整段按压期间显露判定用快照而不是活选区——布局因此
// 从按下到抬起保持不动，落点判定自始至终在同一份布局里做；抬起后解冻，显露照常跟随
// 选区（只是推迟到 mouseup 落地）。判据没变（仍是「选区触及即显露」），改的是按压期间
// 用哪个选区来判。
//
// 窗口的关闭路径必须齐全——指针在窗外抬起时浏览器可能不再派发 mouseup，窗口不关会让
// 显露永久停在被冻住的那一帧（静默失效，REVIEW.md 第 16 条同族）：抬起 / 失焦 / 文档
// 变化三条，后者在 StateField 里兜底。

import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** 开关按压窗口：值是按下瞬间的选区快照，`null` = 窗口已关（解冻）。 */
export const pointerPressFrame = StateEffect.define<EditorSelection | null>();

export const pointerPressField = StateField.define<EditorSelection | null>({
  create: () => null,
  update(frame, tr) {
    // 快照不跟随文档变更做映射，文档一变它就失效——一律解冻（永不卡死的兜底）。
    if (tr.docChanged) frame = null;
    for (const effect of tr.effects) if (effect.is(pointerPressFrame)) frame = effect.value;
    return frame;
  },
});

/** 暴露露判定用的选区：按压窗口内取按下瞬间的快照，窗口外就是活选区。 */
export function revealSelection(state: EditorState): EditorSelection {
  return state.field(pointerPressField, false) ?? state.selection;
}

/** 行级口径（M110 callout / M119 callout 内容行 / M138 分隔线）：严格重叠——空光标
 *  落在行首不触发。 */
export function touchesSource(state: EditorState, from: number, to: number): boolean {
  return revealSelection(state).ranges.some((r) => r.from < to && r.to > from);
}

/** 强调范围口径（M168）：与范围**相接即算**（含端点）——范围两端邻接位两侧都是隐藏的
 *  定界符，空光标停在那里既测不到 caret 坐标、也够不到定界符。 */
export function rangeRevealsSource(state: EditorState, from: number, to: number): boolean {
  return revealSelection(state).ranges.some((r) => r.from <= to && r.to >= from);
}

/** 每个 view 的窗口簿记：按下时挂上的解除监听，抬起 / 失焦 / 视图销毁时摘掉。 */
const windows = new WeakMap<EditorView, () => void>();

/** 按下：把当前选区冻成快照并挂上解除监听；重复按下只刷新快照，不重开窗口。
 *
 *  解除监听三条，各自对应一条「指针按压其实已经结束」的信号，缺一条都可能让窗口卡住
 *  （判据永久停在被冻住的一帧 = 静默失效）：
 *   1. `mouseup`（window 冒泡段）——正常路径。挂 window 而非 document 是刻意的：CM 自己的
 *      MouseSelection 在 document 冒泡段收 mouseup，挂 window 保证解冻**晚于**它——解冻
 *      引起的布局位移不参与那一次落点判定。
 *   2. `mousemove` 且 `buttons === 0`——指针在窗口外抬起时浏览器可能不再派发 mouseup
 *      （CM 的 MouseSelection 用同一条信号兜底：`if (event.buttons == 0) return this.destroy()`）。
 *   3. `blur`（window 层，**不加 capture**）——整个窗口失去焦点（⌘Tab 切走）。不加 capture
 *      是要害：capture 会连编辑器内部元素的失焦一起收到，而按下时 CM 会主动 blur 掉原来的
 *      活动元素（`focusPreventScroll`），那会让窗口在按下的同一拍就被解冻——缺陷原样复发。
 *      文档变化这条兜底在 StateField 里（快照不跟随文档映射，一变即失效）。 */
export function beginPointerPress(view: EditorView): void {
  const win = view.dom.ownerDocument.defaultView;
  if (win && !windows.has(view)) {
    const release = (): void => endPointerPress(view);
    const releaseOnRelease = (event: MouseEvent): void => {
      if (event.buttons === 0) release();
    };
    win.addEventListener("mouseup", release);
    win.addEventListener("mousemove", releaseOnRelease);
    win.addEventListener("blur", release);
    windows.set(view, () => {
      win.removeEventListener("mouseup", release);
      win.removeEventListener("mousemove", releaseOnRelease);
      win.removeEventListener("blur", release);
    });
  }
  view.dispatch({ effects: pointerPressFrame.of(view.state.selection) });
}

/** 抬起 / 失焦：摘监听并解冻。 */
export function endPointerPress(view: EditorView): void {
  detachPointerPress(view);
  if (view.state.field(pointerPressField, false)) {
    view.dispatch({ effects: pointerPressFrame.of(null) });
  }
}

/** 只摘监听、不动状态：视图销毁时用（那时 dispatch 已不可用，状态随视图一起消失）。 */
export function detachPointerPress(view: EditorView): void {
  const teardown = windows.get(view);
  if (!teardown) return;
  windows.delete(view);
  teardown();
}
