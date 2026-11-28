import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

export const MARKDOWN_NOWRAP_SCROLLPORT_CLASS = "cm-lp-reading-scrollport";
export const MARKDOWN_NOWRAP_SCROLLPORT_EDITOR_CLASS = "lumir-md-nowrap-scrollport";

interface InlineRect {
  left: number;
  right: number;
}

export type HorizontalScrollStrategy = "nearest" | "start" | "end" | "center";

export function horizontalScrollDelta(
  rect: InlineRect,
  viewport: InlineRect,
  strategy: HorizontalScrollStrategy,
  margin = 0,
  side: -1 | 1 = 1,
): number {
  const left = viewport.left + margin;
  const right = viewport.right - margin;
  if (strategy === "nearest") {
    if (rect.left < left) {
      const delta = rect.left - left;
      if (side > 0 && rect.right > right + delta) return rect.right - right;
      return delta;
    }
    if (rect.right > right) {
      const delta = rect.right - right;
      if (side < 0 && rect.left < left + delta) return rect.left - left;
      return delta;
    }
    return 0;
  }
  if (strategy === "start") return rect.left - left;
  if (strategy === "end") return rect.right - right;
  return (rect.left + rect.right) / 2 - (left + right) / 2;
}

export function markdownNowrapScrollport(view: EditorView): boolean {
  return view.contentDOM.classList.contains(MARKDOWN_NOWRAP_SCROLLPORT_CLASS);
}

export function horizontalScrollLeft(view: EditorView): number {
  return markdownNowrapScrollport(view) ? view.contentDOM.scrollLeft : view.scrollDOM.scrollLeft;
}

export function writeHorizontalScrollLeft(view: EditorView, value: number): void {
  (markdownNowrapScrollport(view) ? view.contentDOM : view.scrollDOM).scrollLeft = value;
}

function positionRect(view: EditorView, pos: number, assoc: number): (InlineRect & { top: number; bottom: number }) | null {
  const at = view.domAtPos(pos, assoc < 0 ? -1 : 1);
  const range = view.contentDOM.ownerDocument.createRange();
  range.setStart(at.node, at.offset);
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  if (rect.top !== 0 || rect.bottom !== 0) return rect;
  return at.node instanceof HTMLElement ? at.node.getBoundingClientRect() : null;
}

export const markdownNowrapScrollHandler = EditorView.scrollHandler.of((view, range, options) => {
  if (!markdownNowrapScrollport(view)) return false;
  const head = positionRect(view, range.head, range.assoc || 1);
  if (!head) return false;
  let rect = head;
  if (!range.empty) {
    const anchor = positionRect(view, range.anchor, range.anchor > range.head ? -1 : 1);
    if (anchor) {
      rect = {
        left: Math.min(head.left, anchor.left),
        right: Math.max(head.right, anchor.right),
        top: Math.min(head.top, anchor.top),
        bottom: Math.max(head.bottom, anchor.bottom),
      };
    }
  }
  const content = view.contentDOM;
  const bounds = content.getBoundingClientRect();
  const style = getComputedStyle(content);
  const viewport = {
    left: bounds.left + Number.parseFloat(style.paddingLeft),
    right: bounds.right - Number.parseFloat(style.paddingRight),
  };
  const delta = horizontalScrollDelta(rect, viewport, options.x, options.xMargin, range.head < range.anchor ? -1 : 1);
  if (delta !== 0) content.scrollLeft += delta;
  return false;
});

const layerSyncs = new WeakMap<EditorView, () => void>();

function layerDelta(view: EditorView): number {
  const marker = view.scrollDOM.querySelector<HTMLElement>(".cm-cursor");
  if (!marker) return 0;
  const left = Number.parseFloat(marker.style.left);
  if (!Number.isFinite(left)) return 0;
  const head = positionRect(view, view.state.selection.main.head, view.state.selection.main.assoc || 1);
  if (!head) return 0;
  const base = view.scrollDOM.getBoundingClientRect();
  return head.left - base.left + view.scrollDOM.scrollLeft - left;
}

class MarkdownLayerSync {
  private readonly request: { key: unknown; read: () => number; write: (delta: number) => void };

  constructor(view: EditorView) {
    this.request = {
      key: this,
      read: () => layerDelta(view),
      write: delta => view.dom.style.setProperty("--lumir-md-layer-delta", String(delta)),
    };
    layerSyncs.set(view, () => view.requestMeasure(this.request));
    layerSyncs.get(view)?.();
  }

  update(update: ViewUpdate): void {
    if (update.selectionSet || update.geometryChanged) layerSyncs.get(update.view)?.();
  }

  docViewUpdate(view: EditorView): void {
    layerSyncs.get(view)?.();
  }
}

export function syncMarkdownScrollportLayers(view: EditorView): void {
  layerSyncs.get(view)?.();
}

export const markdownNowrapLayerSync = ViewPlugin.fromClass(MarkdownLayerSync);
