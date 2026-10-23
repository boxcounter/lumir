// harness transcript 的跟随滚动与回到底部（change improve-harness-streaming-scroll，M638/M644）。
//
// 分层纪律：本模块是**纯模型层**（无 DOM、无 rAF、无 IPC），面板只做接线（`src/harness-panel.ts`
// 的 scroll 监听 / rAF 未读补扫 / ResizeObserver / 浮钮渲染），单测直接驱动。跟随判据与写滚动位
// 的编排 MUST NOT 在面板里再写一份（REVIEW.md「同一语义两处真源」条）：阈值只在本文件定义一次。
//
// 两态模型（design §2）：用户的意图由**视口位置**表达——距底 ≤ 回底容差 = 「我在看最新」，
// 离开底超过脱离阈值 = 「我在读这里」。两态之间是滞回区间，底部附近不抖动。没有模式开关、
// 没有超时、没有「上次交互时间」，因此不会与用户的实际位置矛盾。
//
// 三条不变量（design §2 的实现语义，逐条落进单测）：
//   1. **只有 `onScroll()` 能改态**：`contentGrew()` / `flushNow()` / `viewportChanged()` 一律
//      不改态——内容增长永远不能被误读成「用户滚动」。白名单动作 `jumpToBottom()` / `reset()`
//      按定义可以置回 following。
//   2. **写底一律推迟到 rAF**（`schedule`）：浏览器渲染更新的次序是「scroll 事件 → rAF 回调」，
//      把写底放在 rAF 里，任何一次用户滚动（滚轮 / 滚动条 / scrollIntoView）的 scroll 事件都先被
//      `onScroll` 看到并完成换态，随后那一帧的写底才会复核状态。这条闭合了一个真实竞态：
//      工具行 / 通知 / 错误 / 批准卡是**同步**写 DOM 的事件路径，它们若在 wheel 输入与 scroll
//      事件之间同步写底，会把用户刚滚出的位置覆盖掉，而 scroll 事件随后读到距底 0、误判为
//      「仍在跟随」。
//   3. **detached 下零写入**：内容增长只更新未读，`writeScrollTop` 一次都不调用——这是本 change
//      的主判据（修前每次增量都把视口拽到底，修后视口纹丝不动）。

/** 一次滚动几何读数（transcript 的三个数；DOM 侧只读这三个，不量任何几何）。 */
export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

export type FollowPhase = "following" | "detached";

/** 距底 ≤ 此值 = 在底部（回底 / 复跟）。取值理由：吸收亚像素与舍入，又不把「滚了一小段」
 *  误判成在底。 */
export const FOLLOW_ATTACH_PX = 6;

/** 距底 > 此值 = 离开底部（脱离）。必须 < 一行正文渲染高度（默认 `--lh-ui` 1.5 × 13px ≈
 *  19.5px），否则「只滚一行」不会脱离。 */
export const FOLLOW_DETACH_PX = 16;

/** 滚动上限（`scrollHeight − clientHeight`，负值钳 0）。内容不足一屏时恒 0。 */
export function maxScrollTop(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.clientHeight);
}

/** 距底距离。macOS 橡皮筋把 `scrollTop` 拉过上限（或拉到负）时 clamp 到 0 —— 回弹算「在底」，
 *  不因回弹脱离。 */
export function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, maxScrollTop(m) - m.scrollTop);
}

/** 写回值 = 滚动上限。不写 `scrollHeight`：`scrollTop` 越过上限会被浏览器钳成上限，但读数上
 *  「写了多少」与「生效多少」就分叉了；直接写上限，读写同一把尺。 */
export function bottomScrollTop(m: ScrollMetrics): number {
  return maxScrollTop(m);
}

/**
 * 滞回换态（design §2 的真值表）：
 *
 * | 当前态 | 读数 | 次态 |
 * |---|---|---|
 * | following | 距底 ≤ FOLLOW_DETACH_PX | following |
 * | following | 距底 > FOLLOW_DETACH_PX | detached |
 * | detached | 距底 ≤ FOLLOW_ATTACH_PX | following |
 * | detached | 距底 > FOLLOW_ATTACH_PX | detached |
 */
export function reduceFollow(phase: FollowPhase, m: ScrollMetrics): FollowPhase {
  const distance = distanceFromBottom(m);
  if (phase === "following") return distance > FOLLOW_DETACH_PX ? "detached" : "following";
  return distance <= FOLLOW_ATTACH_PX ? "following" : "detached";
}

/** 两态的呈现出口载荷：面板据此施加浮钮 `hidden` 与未读类（唯一施加点）。 */
export interface FollowState {
  readonly phase: FollowPhase;
  readonly unread: boolean;
}

/**
 * 面板注入的真实元素适配器（单测注入假面记录每次写调用）：
 * - `read`：读滚动三数（不触发布局写入）；
 * - `writeScrollTop`：**唯一**写滚动位的入口；
 * - `schedule`：把回调推迟到下一帧（面板注入 `requestAnimationFrame`）；
 * - `render`：态 / 未读**值变化时**才有一次（面板里 = 浮钮与未读圆点）。
 */
export interface FollowSurface {
  read(): ScrollMetrics;
  writeScrollTop(top: number): void;
  schedule(cb: () => void): void;
  render(state: FollowState): void;
}

export interface FollowController {
  phase(): FollowPhase;
  unread(): boolean;
  /** 用户滚动（scroll 事件）→ 只按几何位置换态；MUST NOT 写 scrollTop。 */
  onScroll(): void;
  /** 内容增长后的出口：following 排一次下一帧写底；detached 只更新未读。 */
  contentGrew(): void;
  /** 内容**就地替换**（错误行同文案去重）：高度可能不变，但下面确实发生了新事件——
   *  detached 下点亮未读（spec「脱离态下重复错误不拽走视口」要求未读提示在场），
   *  following 下与 `contentGrew()` 同义（滚到可见）。不改态、不写滚动位以外无其他副作用。 */
  contentReplaced(): void;
  /** 立即执行排队的写底（面板流式 rAF 尾部调用：该拍已在 scroll 事件之后，无需再等一帧）。 */
  flushNow(): void;
  /** 强制回底（白名单动作）→ 同步写底 + 回 following + 清未读。 */
  jumpToBottom(): void;
  /** 视口尺寸变化：following 时排一次写底；detached 时什么都不写。 */
  viewportChanged(): void;
  /** 视图复位（会话切换 / 清空）：回 following、清未读、写底。 */
  reset(): void;
}

/** 未读的「内容确实变多了」判据容差：亚像素级的 `scrollHeight` 抖动不算新内容。 */
const UNREAD_GROWTH_PX = 1;

export function createFollowController(surface: FollowSurface): FollowController {
  let phase: FollowPhase = "following";
  let unread = false;
  /** 进入 detached 那一刻的内容高度：未读 = 之后 `scrollHeight` 超过这条基线。 */
  let unreadBaseline = 0;
  /** 排队中的写底（同帧多次增长只排一次）。 */
  let pending = false;
  /** 已呈现出去的态——`render` 只在值变化时被调用。 */
  let rendered: FollowState | null = null;

  function publish(): void {
    if (rendered !== null && rendered.phase === phase && rendered.unread === unread) return;
    rendered = { phase, unread };
    surface.render(rendered);
  }

  /** 排队版的写底：态已不是 following（用户滚动已把态换走）→ 直接作废，零写入。 */
  function flush(): void {
    if (!pending) return;
    pending = false;
    if (phase !== "following") return;
    writeBottom(surface.read());
  }

  function scheduleFlush(): void {
    if (pending) return;
    pending = true;
    surface.schedule(flush);
  }

  /** 最近一次**我们自己**写入的滚动位（`null` = 没有在途回声）。
   *
   *  写底会异步产生一个 scroll 事件；若布局在这两者之间变了（实证：发送后进度条占掉 28px
   *  视口高），该事件读到的距底不再是 0——几何判据单独无法区分「我们的回声」与「用户上滚」。
   *  design §2 的原则是「内容增长永远不能被误读成用户滚动」，因此回声事件按写入值识别一次并
   *  忽略：态不动，若距底已超出回底容差则补排一次贴底（layout 变化自己收敛）。一次写入只产生
   *  一次回声，识别后即清——此后用户真滚到同一像素位置仍按几何判据正常换态。 */
  let echoTop: number | null = null;

  function writeBottom(m: ScrollMetrics): void {
    const top = bottomScrollTop(m);
    surface.writeScrollTop(top);
    echoTop = top;
  }

  /** detached 下的未读复核（`force` = 内容就地替换，高度不变也算新事件）。 */
  function noteUnread(force: boolean): void {
    if (unread) return;
    if (!force && surface.read().scrollHeight <= unreadBaseline + UNREAD_GROWTH_PX) return;
    unread = true;
    publish();
  }

  return {
    phase: () => phase,
    unread: () => unread,

    onScroll(): void {
      const m = surface.read();
      if (echoTop !== null && Math.abs(m.scrollTop - echoTop) <= 1) {
        echoTop = null;
        if (phase === "following" && distanceFromBottom(m) > FOLLOW_ATTACH_PX) scheduleFlush();
        return;
      }
      echoTop = null;
      const next = reduceFollow(phase, m);
      // 态没变就不动作：连续 scroll 事件里第一次已记基线，后续若重记，未读永远追不上
      //（design §3.5）。
      if (next === phase) return;
      phase = next;
      if (phase === "detached") {
        unreadBaseline = m.scrollHeight;
        unread = false;
      } else {
        unread = false;
      }
      publish();
    },

    contentGrew(): void {
      if (phase === "detached") {
        noteUnread(false);
        return;
      }
      scheduleFlush();
    },

    contentReplaced(): void {
      if (phase === "detached") {
        noteUnread(true);
        return;
      }
      scheduleFlush();
    },

    flushNow(): void {
      flush();
    },

    jumpToBottom(): void {
      pending = false;
      writeBottom(surface.read());
      phase = "following";
      unread = false;
      publish();
    },

    viewportChanged(): void {
      // 尺寸变化不得改变阅读位置：detached 下什么都不写（design §3.4）。
      if (phase === "following") scheduleFlush();
    },

    reset(): void {
      pending = false;
      phase = "following";
      unread = false;
      publish();
      writeBottom(surface.read());
    },
  };
}
