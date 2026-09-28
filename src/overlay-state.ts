// 模态浮层的状态机（M277 抽取；来源是 M240 表格全屏的 createTableFullscreenState）。
//
// 抽出来的理由只有一条：本仓现在有三处同形浮层（图片 lightbox M184、表格全屏 M240、代码块
// 全屏 M277），「四条关闭路径回同一个 close」「关闭之后焦点归谁只有一处判据」这组守卫若各写
// 一份，就会出现「某条路径忘了交还焦点」这类漂移（REVIEW.md 第 8 条）。内容与 DOM 由各自的
// surface 承担，状态机只认「打开 / 关闭 / 焦点」三个动作。
//
// 本文件是纯逻辑、无 DOM：`content` 的类型参数只负责原样透传给 surface.load，状态机不碰它的
// 任何成员。单测注入假 surface 断言的是**转换本身**（tests/unit 的纪律：这一层不造 DOM 替身）。

/** 浮层的五个动作（状态机的驱动面）。真实现各自造 DOM；单测注入假实现。 */
export interface OverlaySurface<T> {
  /** 装内容：清掉上一份、写入本次的 `content` 与读屏名。 */
  load(content: T, label: string): void;
  show(): void;
  hide(): void;
  /** 打开即持焦（`role="dialog"` + `aria-modal="true"` 的语义要求）。 */
  focus(): void;
  /** 交还焦点给编辑器（装配层注入）。 */
  restoreFocus(): void;
}

/** 五条关闭路径。前四条是用户路径（关闭后交还焦点），`blur` 是焦点兜底（不抢焦点）——
 *  它兜住「浮层之上另开了面板」与「窗口失活」两件事。
 *
 *  **「文档代际变化（外部重载）」不在它的射程**（M286 实测证伪，原注释声称它兜住三件事）：
 *  重载不移动焦点（`reloadSession` 不调 `view.focus()`），遮罩一直持焦 ⇒ 那条 blur 从不触发，
 *  遮罩会停在一份**已经不存在的内容**上。文档换代改由调用方在重载处**显式**关闭
 *  （`document`），见 src/main.ts 的 `closeDocumentOverlays`。 */
export type OverlayCloseReason = "escape" | "overlay" | "toggle" | "blur" | "document";

export interface OverlayState<T> {
  isOpen(): boolean;
  open(content: T, label: string): void;
  close(reason: OverlayCloseReason): void;
  /** 就地键：`Escape` 消费并关闭（返回 true），其余 token 一律不消费。 */
  handleKeyToken(token: string | null): boolean;
}

/**
 * 单入口的理由：三条用户路径 + 一条焦点兜底若各写一份收尾，就会出现「某条路径忘了交还焦点」
 * 这类漂移；这里把「关闭之后焦点归谁」收在一处。`isOpen` 守卫（已关闭时的 close 是空操作）
 * 挡的是被关掉之后的迟到事件：`hide()` 自身会让浮层失焦，那条 blur 回调不该再走一遍收尾
 * （也就不会把已经落到编辑器里的焦点再抢一次）。
 */
export function createOverlayState<T>(surface: OverlaySurface<T>): OverlayState<T> {
  let open = false;
  const state: OverlayState<T> = {
    isOpen: () => open,
    open(content, label) {
      surface.load(content, label);
      surface.show();
      surface.focus();
      open = true;
    },
    close(reason) {
      if (!open) return;
      open = false;
      surface.hide();
      // `blur` 是唯一**不**交还焦点的一条：焦点本来就去了别处（另开了面板 / 窗口失活），抢回来
      // 就是第二条缺陷。`document`（文档代际变化）交还焦点——视口换代不是用户发起的焦点去向，
      // 「关掉当前层之后键盘回到正文」才是可继续阅读的状态（与三条用户路径同口径）。
      if (reason !== "blur") surface.restoreFocus();
    },
    handleKeyToken(token) {
      if (token !== "Escape") return false;
      state.close("escape");
      return true;
    },
  };
  return state;
}
