// 块级 replace widget 的指针入口（唯一实现）。
//
// 点击进入编辑态（M111 真实桌面缺陷）：replace widget 整体隐藏源码，CM 对 widget 内事件
// 默认 ignoreEvent、不放置光标，点击渲染态公式因此无处落点。与 callout / 表格同口径：
// 点击即显露源码并把光标放到点击处。先把光标送入块内触发显露（选区重叠口径，装饰同步
// 重建），源码上屏后再用同一点位 posAtCoords 精确定位，钳制在块内部（落在边界会重新触发
// 渲染态）。
//
// M112 起与 mermaid 共用；frontmatter 的 properties 盒在 cursor-visibility-oct23 加入同一
// 入口（三类块的指针语义因此只有这一份实现）：preventDefault 同时挡住浏览器原生 caret 进入
// widget DOM——异步重建（如 mermaid settle）替换 widget 节点后，原生选区锚点若滞留在游离
// 节点上，selectionchange 读取时 posFromDOM 会把它映射为 0（点击落点跳到文档起点）；
// preventDefault 后 CM 不再读取这条原生选区，该路径被掐断。
//
// innerFrom / innerTo 是相对块起点的光标钳制区间（公式为定界符内侧，mermaid 为开围栏行之后
// 到闭围栏行之前，frontmatter 同理）。
import type { EditorView } from "@codemirror/view";

export function enterReplacedSource(
  event: MouseEvent,
  view: EditorView,
  dom: HTMLElement,
  innerFrom: number,
  innerTo: number,
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const from = view.posAtDOM(dom);
  view.dispatch({ selection: { anchor: from + innerFrom }, userEvent: "select.pointer" });
  const exact = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (exact !== null) {
    const clamped = Math.min(Math.max(exact, from + innerFrom), from + innerTo);
    if (clamped !== from + innerFrom) {
      view.dispatch({ selection: { anchor: clamped }, userEvent: "select.pointer" });
    }
  }
  view.focus();
}
