// 上下文组装（M303，change add-harness-probe，design §8；M343 调整见
// openspec/changes/add-harness-quote-cards design §6 与 spec「上下文注入与可见性」修订）：
// 把「当前编辑器上下文」组装成结构化上下文块，随 harness_send 注入对话。
//
// 口径（spec harness「上下文注入与可见性」，add-harness-quote-cards 修订后）：
//   - 当前 TAB 的 vault 相对路径 SHALL 始终注入（有活动文件时）；
//   - 消息未携带引用卡片时注入视口行范围内容；
//   - 消息携带引用卡片时**跳过**视口注入（用户已显式策展，避免同文重复进上下文）；
//   - 选区 SHALL NOT 被自动注入——选中片段一律经「摘录引用卡片」手势显式策展（该手势与
//     卡片混排编辑区是 add-harness-quote-cards 的能力；选区自动注入随本修订移除）。
// 与面板 UI 解耦（ADR 0007 Decision 3 的分层纪律）：本模块只依赖 EditorHandle 的结构子集，
// 不 import 面板，也不知道「注入」之后发生了什么。输出形状就是 harness_send 的 context_json
// 契约（宽容解析在 Rust 侧 turn::parse_context）。
//
// 取数先例：视口范围用 view.viewport.from/to（livePreview.ts:255 同先例），对齐到整行边界。
// 选区不再在此取数——摘录卡片创建时由 QC3 在编辑器侧经 CM6 lineAt 捕获行范围（design §3）。

import type { EditorView } from "@codemirror/view";

/** 视口文本块：1-based 行号闭区间 + 该范围的原文。 */
export interface ContextTextRange {
  from_line: number;
  to_line: number;
  text: string;
}

/** 注入的上下文块：path 恒在（调用方保证有活动文件），视口块随携带卡片与否可选。 */
export interface HarnessContextBlock {
  path: string;
  viewport_range?: ContextTextRange;
}

/** 组装选项：消息携带引用卡片时置 skipViewport（spec：携带卡片 ⇒ 跳过视口注入）。 */
export interface AssembleHarnessContextOptions {
  skipViewport?: boolean;
}

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
export function assembleHarnessContext(
  source: HarnessContextSource,
  options?: AssembleHarnessContextOptions,
): HarnessContextBlock | null {
  const path = source.activeSession().path;
  if (path === undefined) return null;
  // 携带引用卡片：只注入路径（卡片自带的 <quote> 块即该消息的编辑器上下文）。
  if (options?.skipViewport === true) return { path };
  const { state, viewport } = source.view;
  // 视口行范围。viewport.from/to 是文档偏移，对齐到整行后取整行文本——半个首行 / 尾行对
  // 模型没有信息量，反而让「注入了什么」变得难核对。
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
