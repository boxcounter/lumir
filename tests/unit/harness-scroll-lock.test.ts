// transcript 跟随滚动 / 回到底部的纯模型与控制器单测（M644，change improve-harness-streaming-
// scroll design §5.1）。零 DOM：只驱动 `src/harness-scroll-lock.ts` 的纯函数与控制器，调度器由
// 假面（手动 rAF）提供。
//
// 断言区分度的自证（design §5.1 的反向验证要求，2026-10-23 实测读数如实登记）：
//   ① 把 `flush()` 的状态复核（`if (phase !== "following") return;`）删掉、让「排队的写底」无条件
//      落地 → 「竞态：following 排队后用户先滚走 → 跑调度器零写入」**必红**（实测
//      `writes = [1500]`、期望 `[]`——用户刚滚出的位置被那一帧覆盖；这正是修前
//      「立刻被拽到底部」的形态）。
//   ② 把 `reduceFollow` 的滞回改成单一阈值（`distance > 0` 即 detached）→ 四条必红，含
//      「滞回区间：following 在距底 10px 不脱离」（实测 `detached`、期望 `following`）与真值表
//      ①②③ 的边界行；「手动滚回容差内 → 自动恢复跟随」同红。
// 这两条是「断言看着有覆盖、实际不判任何东西」的反面（REVIEW.md「断言等价于子串」条）：只要
// 实现退回其中任一形态，这一层就有输入立刻变红。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FOLLOW_ATTACH_PX,
  FOLLOW_DETACH_PX,
  bottomScrollTop,
  createFollowController,
  distanceFromBottom,
  maxScrollTop,
  reduceFollow,
  type FollowState,
  type FollowSurface,
  type ScrollMetrics,
} from "../../src/harness-scroll-lock.ts";

// ── 假面：记录**每一次**写滚动位，调度器手动跑 ──────────────────────────────

interface FakeSurface extends FollowSurface {
  readonly writes: number[];
  readonly rendered: FollowState[];
  /** 已排但未跑的回调数（同帧多次增长只排一次 → 上限 1）。 */
  queued(): number;
  runScheduled(): void;
  metrics: ScrollMetrics;
}

function fakeSurface(initial: ScrollMetrics = { scrollTop: 1500, clientHeight: 500, scrollHeight: 2000 }): FakeSurface {
  let queue: Array<() => void> = [];
  const surface: FakeSurface = {
    metrics: initial,
    writes: [],
    rendered: [],
    read() {
      return surface.metrics;
    },
    writeScrollTop(top: number) {
      surface.writes.push(top);
    },
    schedule(cb: () => void) {
      queue.push(cb);
    },
    render(state: FollowState) {
      surface.rendered.push(state);
    },
    queued() {
      return queue.length;
    },
    runScheduled() {
      const run = queue;
      queue = [];
      for (const cb of run) cb();
    },
  };
  return surface;
}

/** 距底 `px` 的读数（内容 3 屏：上限 1500）。 */
function at(px: number): ScrollMetrics {
  return { scrollTop: 1500 - px, clientHeight: 500, scrollHeight: 2000 };
}

// ── 纯函数：三条几何读数 ─────────────────────────────────────────────────────

test("maxScrollTop / bottomScrollTop：滚动上限；内容不足一屏钳 0", () => {
  assert.equal(maxScrollTop({ scrollTop: 0, clientHeight: 500, scrollHeight: 2000 }), 1500);
  assert.equal(bottomScrollTop({ scrollTop: 0, clientHeight: 500, scrollHeight: 2000 }), 1500);
  assert.equal(maxScrollTop({ scrollTop: 0, clientHeight: 700, scrollHeight: 300 }), 0);
});

test("distanceFromBottom：距底读数与橡皮筋钳制（超上限算 0；顶部回弹按实际距离）", () => {
  assert.equal(distanceFromBottom(at(0)), 0);
  assert.equal(distanceFromBottom(at(10)), 10);
  // 顶部回弹：scrollTop 为负 = 比停在顶部时离底更远（不是 0，也不越界成负值）。
  assert.equal(distanceFromBottom({ scrollTop: -40, clientHeight: 500, scrollHeight: 2000 }), 1540);
  // 底部回弹：scrollTop 被拉过上限 → 钳到 0（「在底」）。
  assert.equal(distanceFromBottom({ scrollTop: 1540, clientHeight: 500, scrollHeight: 2000 }), 0);
});

// ── 真值表四行 + 滞回 + 橡皮筋 + 不足一屏 ────────────────────────────────────

test("reduceFollow 真值表①：following + 距底 ≤ 脱离阈值 → following", () => {
  assert.equal(reduceFollow("following", at(0)), "following");
  assert.equal(reduceFollow("following", at(FOLLOW_DETACH_PX)), "following");
});

test("reduceFollow 真值表②：following + 距底 > 脱离阈值 → detached", () => {
  assert.equal(reduceFollow("following", at(FOLLOW_DETACH_PX + 1)), "detached");
});

test("reduceFollow 真值表③：detached + 距底 ≤ 回底容差 → following", () => {
  assert.equal(reduceFollow("detached", at(0)), "following");
  assert.equal(reduceFollow("detached", at(FOLLOW_ATTACH_PX)), "following");
});

test("reduceFollow 真值表④：detached + 距底 > 回底容差 → detached", () => {
  assert.equal(reduceFollow("detached", at(FOLLOW_ATTACH_PX + 1)), "detached");
  assert.equal(reduceFollow("detached", at(400)), "detached");
});

test("滞回区间：following 在距底 10px 不脱离（单一阈值实现必红）", () => {
  // 10 落在 (ATTACH=6, DETACH=16] 区间内——「滚一行（19.5px）即脱离」的实现里，10px
  //（半行多一点的亚像素抖动 + 回弹）不该把跟随打断。
  assert.equal(reduceFollow("following", at(10)), "following");
});

test("滞回区间：detached 在距底 10px 不复跟（只回滚一点点不抢阅读位置）", () => {
  assert.equal(reduceFollow("detached", at(10)), "detached");
});

test("橡皮筋：scrollTop 被拉过上限（距底负值）→ 不算脱离", () => {
  assert.equal(reduceFollow("following", { scrollTop: 1540, clientHeight: 500, scrollHeight: 2000 }), "following");
});

test("不足一屏：scrollHeight ≤ clientHeight → 恒 following，不出现脱离态", () => {
  const oneScreen = { scrollTop: 0, clientHeight: 700, scrollHeight: 300 };
  assert.equal(reduceFollow("following", oneScreen), "following");
  assert.equal(reduceFollow("detached", oneScreen), "following");
});

// ── 控制器：写底编排 ────────────────────────────────────────────────────────

test("following + contentGrew：只排队不立即写；跑调度器后写一次 bottomScrollTop", () => {
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  follow.contentGrew();
  assert.deepEqual(s.writes, [], "排队阶段 MUST NOT 同步写");
  assert.equal(s.queued(), 1);
  s.runScheduled();
  assert.deepEqual(s.writes, [1500]);
});

test("同帧多次 contentGrew：只排一次、只写一次", () => {
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  follow.contentGrew();
  follow.contentGrew();
  follow.contentGrew();
  assert.equal(s.queued(), 1);
  s.runScheduled();
  assert.deepEqual(s.writes, [1500]);
});

test("flushNow：立即执行排队的写（面板流式 rAF 尾部）；无 pending 时是 no-op", () => {
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  follow.flushNow();
  assert.deepEqual(s.writes, [], "无 pending 的 flushNow 不写");
  follow.contentGrew();
  follow.flushNow();
  assert.deepEqual(s.writes, [1500], "flushNow 不等下一帧");
  s.runScheduled(); // 同一拍摄的排队回调到达时应已无 pending
  assert.deepEqual(s.writes, [1500], "排队回调不重复写");
});

test("detached + contentGrew：零写入（本 change 的主判据）", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  follow.onScroll(); // following → detached（距底 400）
  s.writes.length = 0;
  follow.contentGrew();
  s.runScheduled();
  assert.deepEqual(s.writes, [], "detached 下任何增长都不得写滚动位");
});

test("竞态：following 排队后用户先滚走 → 跑调度器零写入", () => {
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  follow.contentGrew(); // 排队一次写底
  s.metrics = at(400); // 用户在这一帧之前滚走了
  follow.onScroll(); // scroll 事件先到 → detached
  s.runScheduled(); // 排队的写底随后落地
  assert.deepEqual(s.writes, [], "排队的写底必须复核状态：态已换走就作废");
  assert.equal(follow.phase(), "detached");
});

test("回声守卫：写底后布局变化（距底 28px）的 scroll 事件不换态，并补一次贴底", () => {
  // 实证现场（视觉场景 m638）：发送消息 → 强制回底写 1500 → 进度条出现把视口压矮 28px →
  // 写入自身产生的 scroll 事件这时才到，读到距底 28px。几何判据单独会把「我们的回声」
  // 判成「用户上滚」（28 > 16）；守卫按写入值识别，并补排一次贴底让它自己收敛。
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  follow.jumpToBottom();
  assert.deepEqual(s.writes, [1500]);

  s.metrics = { scrollTop: 1500, clientHeight: 472, scrollHeight: 2000 }; // 上限 1528，距底 28
  follow.onScroll();
  assert.equal(follow.phase(), "following", "自写回声不换态");
  s.runScheduled();
  assert.deepEqual(s.writes, [1500, 1528], "布局变化后补一次贴底");
});

test("回声只吞一次：同一位置再来一个 scroll 事件按几何判据正常换态", () => {
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  follow.jumpToBottom();
  s.metrics = { scrollTop: 1500, clientHeight: 472, scrollHeight: 2000 };
  follow.onScroll(); // 回声（消费掉）
  s.runScheduled();
  follow.onScroll(); // 用户真的停在这个位置：距底 28px > 脱离阈值
  assert.equal(follow.phase(), "detached");
});

test("只有 onScroll 改态：contentGrew / flushNow / viewportChanged 前后态不变", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  assert.equal(follow.phase(), "following");
  follow.contentGrew();
  follow.flushNow();
  follow.viewportChanged();
  s.runScheduled();
  assert.equal(follow.phase(), "following", "内容增长 / 尺寸变化永远不得被读成用户滚动");
});

test("viewportChanged：following 排一次贴底；detached 零写入", () => {
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  follow.viewportChanged();
  s.runScheduled();
  assert.deepEqual(s.writes, [1500]);

  s.metrics = at(400);
  follow.onScroll();
  s.writes.length = 0;
  follow.viewportChanged();
  s.runScheduled();
  assert.deepEqual(s.writes, [], "尺寸变化不得改变阅读位置");
  assert.equal(follow.phase(), "detached");
});

// ── 未读 ────────────────────────────────────────────────────────────────────

test("未读基线：detached 期间 scrollHeight 增长 → unread；不变 → 不点亮", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  follow.onScroll();
  assert.equal(follow.unread(), false);

  follow.contentGrew(); // scrollHeight 未变（2000）→ 不点亮
  assert.equal(follow.unread(), false);

  s.metrics = { scrollTop: 100, clientHeight: 500, scrollHeight: 2100 };
  follow.contentGrew();
  assert.equal(follow.unread(), true);
});

test("未读基线：进入 detached 后只记一次（后续 scroll 事件不重记，未读追得上）", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  follow.onScroll();
  // 内容先长 300px（用户离开那一刻的基线 = 2000）
  s.metrics = { scrollTop: 100, clientHeight: 500, scrollHeight: 2300 };
  // 用户继续滚（仍 detached）：若这次重记基线，未读就永远追不上
  s.metrics = { scrollTop: 50, clientHeight: 500, scrollHeight: 2300 };
  follow.onScroll();
  follow.contentGrew();
  assert.equal(follow.unread(), true);
});

test("contentReplaced：detached 下高度不变也点亮未读（错误行同文案去重）；零写入", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  follow.onScroll();
  s.writes.length = 0;
  follow.contentReplaced();
  assert.equal(follow.unread(), true);
  s.runScheduled();
  assert.deepEqual(s.writes, []);
});

test("jumpToBottom：同步写底 + 回 following + 清未读", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  follow.onScroll();
  s.metrics = { scrollTop: 100, clientHeight: 500, scrollHeight: 2400 };
  follow.contentGrew();
  assert.equal(follow.unread(), true);

  follow.jumpToBottom();
  assert.deepEqual(s.writes, [1900], "同步写，写的是当前读数的滚动上限");
  assert.equal(follow.phase(), "following");
  assert.equal(follow.unread(), false);
});

test("手动滚回容差内 → 自动恢复跟随并清未读（无需点钮）", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  follow.onScroll();
  s.metrics = { scrollTop: 100, clientHeight: 500, scrollHeight: 2100 };
  follow.contentGrew();
  assert.equal(follow.unread(), true);

  s.metrics = { scrollTop: 1595, clientHeight: 500, scrollHeight: 2100 }; // 距底 5px
  follow.onScroll();
  assert.equal(follow.phase(), "following");
  assert.equal(follow.unread(), false);
});

// ── reset / render ──────────────────────────────────────────────────────────

test("reset：回 following、清未读、写底，并作废排队中的写", () => {
  const s = fakeSurface(at(400));
  const follow = createFollowController(s);
  follow.onScroll();
  s.writes.length = 0;
  follow.reset();
  assert.equal(follow.phase(), "following");
  assert.equal(follow.unread(), false);
  assert.deepEqual(s.writes, [1500]);
});

test("render 只在 {phase, unread} 值变化时被调用（创建期不主动呈现）", () => {
  const s = fakeSurface(at(0));
  const follow = createFollowController(s);
  // 创建期没有「值变化」：初始态由面板的 applyLabels 用同一份状态施加（浮钮默认 hidden）。
  assert.deepEqual(s.rendered, []);

  follow.onScroll(); // 仍在底：态没变
  follow.contentGrew(); // following 排写，不改态
  assert.equal(s.rendered.length, 0);

  s.metrics = at(400);
  follow.onScroll(); // → detached
  assert.deepEqual(s.rendered.at(-1), { phase: "detached", unread: false });
  assert.equal(s.rendered.length, 1);

  s.metrics = { scrollTop: 100, clientHeight: 500, scrollHeight: 2100 };
  follow.contentGrew(); // → unread
  assert.deepEqual(s.rendered.at(-1), { phase: "detached", unread: true });
  assert.equal(s.rendered.length, 2);
});
