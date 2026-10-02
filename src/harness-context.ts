// 上下文组装（M303，change add-harness-probe，design §8）：把「当前编辑器上下文」组装成
// 结构化上下文块，随 harness_send 注入对话。
//
// 口径（spec harness「上下文注入与可见性」）：
//   - 当前 TAB 的 vault 相对路径 SHALL 始终注入；
//   - 存在选区（非折叠）时注入选区内容；
//   - 无选区时注入视口行范围文本。
// 与面板 UI 解耦（ADR 0007 Decision 3 的分层纪律）：本模块只依赖 EditorHandle 的结构子集，
// 不 import 面板，也不知道「注入」之后发生了什么。输出形状就是 harness_send 的 context_json
// 契约（与 M302 共用，tower 2026-10-02 钉死）。
//
// 取数先例：selection 用 view.state.selection.main（main.ts:1191 同口径）；无选区时的视口
// 范围用 view.viewport.from/to（livePreview.ts:255 同先例），再对齐到整行边界。

import type { EditorView } from "@codemirror/view";

/** 视口 / 选区文本块：1-based 行号闭区间 + 该范围的原文。 */
export interface ContextTextRange {
  from_line: number;
  to_line: number;
  text: string;
}

/** 注入的上下文块：有选区带 selection，无选区带 viewport_range，二者互斥。 */
export type HarnessContextBlock =
  | { path: string; selection: ContextTextRange }
  | { path: string; viewport_range: ContextTextRange };

/** 本模块对编辑器句柄的结构需求（EditorHandle 的子集）：读活动会话路径与前台视图状态。
 *  写成窄接口是为了纯逻辑层与单测能用结构替身驱动，面板之外也不绑死装配形态。 */
export interface HarnessContextSource {
  activeSession(): { path: string | undefined };
  view: Pick<EditorView, "state" | "viewport">;
}

/**
 * 组装当前编辑器上下文。无活动文件路径（未命名空文档 / 未装载 vault）返回 null——
 * 「路径 SHALL 始终注入」那时无物可注入，调用方（面板）据此显示「无上下文」而不是
 * 伪造一个路径。
 */
export function assembleHarnessContext(source: HarnessContextSource): HarnessContextBlock | null {
  const path = source.activeSession().path;
  if (path === undefined) return null;
  const { state, viewport } = source.view;
  const main = state.selection.main;
  if (!main.empty) {
    // 选区：对齐到整行（行号 1-based，闭区间），文本取选区原文（不是整行——注入的
    // 是 Alex 选中的那段，扩到整行会把没选的内容偷偷带进上下文）。
    return {
      path,
      selection: {
        from_line: state.doc.lineAt(main.from).number,
        to_line: state.doc.lineAt(main.to).number,
        text: state.sliceDoc(main.from, main.to),
      },
    };
  }
  // 无选区：视口行范围。viewport.from/to 是文档偏移，对齐到整行后取整行文本——
  // 半个首行 / 尾行对模型没有信息量，反而让「注入了什么」变得难核对。
  const fromLine = state.doc.lineAt(Math.min(viewport.from, state.doc.length));
  const toLine = state.doc.lineAt(Math.min(Math.max(viewport.to, viewport.from), state.doc.length));
  return {
    path,
    viewport_range: {
      from_line: fromLine.number,
      to_line: toLine.number,
      text: state.sliceDoc(fromLine.from, toLine.to),
    },
  };
}

/** context_json 契约的序列化唯一入口（面板与「发送前核对」读同一个产物）。 */
export function serializeHarnessContext(block: HarnessContextBlock): string {
  return JSON.stringify(block);
}
