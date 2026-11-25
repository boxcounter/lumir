/**
 * 选择器揭示的共享几何（合同：docs/specs/selector-contract.md C2 / C3）。
 *
 * 两个消费者同源：harness Skill 候选（`src/harness-panel.ts`）与行内 `[[` 候选
 * （`src/link-suggest.ts`）。这里只有「把目标挪进真实可见带」这一件事，不含任何
 * 选择器状态；状态机另在 `src/skill-menu.ts`。
 */

export interface RevealBand {
  /** 可见带上缘相对滚动口顶部的内缩量（px）。 */
  readonly top: number;
  /** 可见带下缘相对滚动口顶部的内缩量（px）。 */
  readonly bottom: number;
}

export interface RevealScrollRequest {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  /** 真实可见带（滚动口 ∩ 祖先裁切 ∩ 视口），不是滚动口自身高度。 */
  readonly band: RevealBand;
  /** 目标在滚动内容坐标系里的上缘。 */
  readonly itemTop: number;
  readonly itemHeight: number;
  /** 越界时保留的上下文高度；缺省 = 一行（itemHeight）。 */
  readonly margin?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 返回目标完整可见所需的 scrollTop。
 *
 * - 已完整落在可见带内 ⇒ 原样返回（判据是带，不是滚动口）。
 * - 越界 ⇒ 只把目标滚到带边缘，并保留一行上下文（带高不足两行时把剩余空间全部留给
 *   上下文）；上下界自然 clamp。
 * - 目标比可见带还高 ⇒ 对齐上缘（无法完整可见时不留不可能的余量）。
 */
export function revealScrollTop(request: RevealScrollRequest): number {
  const { scrollTop, scrollHeight, clientHeight, band, itemTop, itemHeight } = request;
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  const bandHeight = band.bottom - band.top;
  if (!(bandHeight > 0)) return scrollTop;
  const visibleTop = scrollTop + band.top;
  const visibleBottom = scrollTop + band.bottom;
  if (itemTop >= visibleTop && itemTop + itemHeight <= visibleBottom) return scrollTop;
  if (itemHeight > bandHeight) return clamp(itemTop - band.top, 0, maxScroll);
  const margin = Math.min(
    Math.max(0, request.margin ?? itemHeight),
    Math.max(0, bandHeight - itemHeight),
  );
  const next = itemTop < visibleTop
    ? itemTop - band.top - margin
    : itemTop + itemHeight - band.bottom + margin;
  return clamp(next, 0, maxScroll);
}

export interface RevealClip {
  readonly top: number;
  readonly bottom: number;
}

/** 滚动口的真实可见带：滚动口自身（扣掉边框与 padding）与祖先裁切 / 视口的交集，视口坐标。 */
function revealBand(scroller: HTMLElement, clip: RevealClip): RevealBand | null {
  const rect = scroller.getBoundingClientRect();
  const style = scroller.ownerDocument.defaultView?.getComputedStyle(scroller);
  const padTop = Number.parseFloat(style?.paddingTop ?? "0") || 0;
  const padBottom = Number.parseFloat(style?.paddingBottom ?? "0") || 0;
  const scrollportTop = rect.top + scroller.clientTop;
  const scrollportBottom = scrollportTop + scroller.clientHeight;
  const top = Math.max(scrollportTop + padTop, clip.top);
  const bottom = Math.min(scrollportBottom - padBottom, clip.bottom);
  return bottom > top ? { top, bottom } : null;
}

/**
 * 目标是否已完整落在真实可见带内（与 `revealElementWithin` 同一套几何）。
 *
 * 调用方用它在**重排前**判「游标此刻是否完整可见」：重排前完整可见、重排后被新几何挤出带 ⇒
 * 这次揭示是几何变化造成的，该揭示；重排前就不可见 ⇒ 用户自己滚开了，重排 MUST NOT 把它拉回。
 */
export function isFullyVisibleWithin(
  scroller: HTMLElement,
  target: HTMLElement,
  clip: RevealClip,
): boolean {
  const band = revealBand(scroller, clip);
  if (band === null) return false;
  const rect = target.getBoundingClientRect();
  return rect.top >= band.top - 0.5 && rect.bottom <= band.bottom + 0.5;
}

/**
 * DOM 适配：把 `target` 揭示进 `scroller` 的真实可见带（`clip` = 祖先裁切 ∩ 视口，
 * 视口坐标）。只写 `scroller.scrollTop`，绝不滚动祖先、页面或 `target` 之外的元素。
 * 目标已完整可见时是空操作（C3「带内不动」）。
 */
export function revealElementWithin(
  scroller: HTMLElement,
  target: HTMLElement,
  clip: RevealClip,
): void {
  const band = revealBand(scroller, clip);
  if (band === null) return;
  const rect = scroller.getBoundingClientRect();
  const scrollportTop = rect.top + scroller.clientTop;
  const contentTop = scrollportTop - scroller.scrollTop;
  const targetRect = target.getBoundingClientRect();
  const next = revealScrollTop({
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    band: { top: band.top - scrollportTop, bottom: band.bottom - scrollportTop },
    itemTop: targetRect.top - contentTop,
    itemHeight: targetRect.height,
  });
  if (Math.abs(next - scroller.scrollTop) > 0.5) scroller.scrollTop = next;
}
