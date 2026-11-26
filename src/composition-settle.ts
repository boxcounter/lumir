import type { EditorView } from "@codemirror/view";

export type CompositionSettleConsumer = "lists" | "link-suggest" | "skill-menu";

const timers = new WeakMap<EditorView, Map<CompositionSettleConsumer, ReturnType<typeof setTimeout>>>();

export function cancelCompositionSettle(view: EditorView, consumer: CompositionSettleConsumer): void {
  const byConsumer = timers.get(view);
  const timer = byConsumer?.get(consumer);
  if (timer !== undefined) clearTimeout(timer);
  byConsumer?.delete(consumer);
}

/** 等 CM 回读最终组合文本后再执行一次；绝不在 pending MutationRecord 上 dispatch。 */
export function scheduleCompositionSettle(
  view: EditorView,
  consumer: CompositionSettleConsumer,
  settled: () => void,
  attempt = 0,
): void {
  cancelCompositionSettle(view, consumer);
  let byConsumer = timers.get(view);
  if (byConsumer === undefined) {
    byConsumer = new Map();
    timers.set(view, byConsumer);
  }
  byConsumer.set(consumer, setTimeout(() => {
    byConsumer?.delete(consumer);
    if (!view.dom.isConnected) return;
    const observer = (view as unknown as { observer?: { pendingRecords(): readonly unknown[] } }).observer;
    const pending = observer ? observer.pendingRecords().length : -1;
    if (pending > 0) {
      if (attempt < 200) scheduleCompositionSettle(view, consumer, settled, attempt + 1);
      return;
    }
    if (view.compositionStarted) {
      if (attempt < 25) scheduleCompositionSettle(view, consumer, settled, attempt + 1);
      return;
    }
    settled();
  }, attempt === 0 ? 0 : 8));
}
