// src/escape-router.ts 的单测（change fix-escape-overlay-close-oct24 的 tasks 2.3 / 3.5）。
//
// 这一层判的是**纯逻辑**：准入矩阵（键 × 修饰键 × 组合期 × 已消费）、层栈决策（0 / 1 / 2 层，
// 关栈顶、关闭恰一次、无层时只 `preventDefault` 不关任何层）、幂等与顺序。真实 DOM 上的监听链
// （就地处理器先于兜底运行、真实 `KeyboardEvent` 的 `isComposing`）归
// `tests/visual/scenes/escape-admission.spec.ts`；真机层归场景 238 / 239。三者分工的理由同
// tests/unit/README.md：纯函数层能把每种输入的口径钉死，DOM 层才能钉「谁先跑」。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEscapeRouter,
  escapeDisposition,
  installEscapeRouter,
  type EscapeKeyEvent,
  type EscapeLayer,
  type EscapeRouter,
} from "../../src/escape-router.ts";

/** 键事件的字面量替身：只承载准入判据读到的字段，`preventDefault` 置 `defaultPrevented`。 */
function keyEvent(init: Partial<EscapeKeyEvent> = {}): EscapeKeyEvent {
  const event: EscapeKeyEvent = {
    key: "Escape",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 27,
    defaultPrevented: false,
    preventDefault() {
      event.defaultPrevented = true;
    },
    ...init,
  };
  return event;
}

/** 记调用次数的层替身；`close` 的行为可按用例替换（抛错那条用在「栈前进」组）。 */
function layer(id: string, onClose?: () => void): EscapeLayer & { closes: number } {
  const record = {
    id,
    closes: 0,
    close() {
      record.closes += 1;
      onClose?.();
    },
  };
  return record;
}

/** 假 window：只需要 `addEventListener` / `removeEventListener` 与「按登记顺序派发」。 */
function fakeWindow(): {
  target: { addEventListener(t: "keydown", l: (e: Event) => void): void; removeEventListener(t: "keydown", l: (e: Event) => void): void };
  listeners: Array<(event: Event) => void>;
  dispatch(event: EscapeKeyEvent): void;
} {
  const listeners: Array<(event: Event) => void> = [];
  return {
    target: {
      addEventListener(_type, listener) {
        listeners.push(listener);
      },
      removeEventListener(_type, listener) {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      },
    },
    listeners,
    dispatch(event) {
      for (const listener of [...listeners]) listener(event as unknown as Event);
    },
  };
}

test("escapeDisposition：非 Escape 一律 ignore（含拼写近邻与空串）", () => {
  for (const key of ["Enter", "Esc", "escape", "", "Tab"]) {
    assert.equal(escapeDisposition(keyEvent({ key })), "ignore", `key=${JSON.stringify(key)}`);
  }
});

test("escapeDisposition：输入法组合期归输入法（isComposing 与 keyCode 229 两条信号都要挡）", () => {
  assert.equal(escapeDisposition(keyEvent({ isComposing: true })), "ignore");
  assert.equal(escapeDisposition(keyEvent({ keyCode: 229 })), "ignore");
  // 组合期压过修饰键判断：组合中的 ⇧Escape 也不归关闭路由（归输入法）。
  assert.equal(escapeDisposition(keyEvent({ isComposing: true, shiftKey: true })), "ignore");
});

test("escapeDisposition：带修饰键只消费默认行为（swallow），不关层", () => {
  for (const init of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    assert.equal(escapeDisposition(keyEvent(init)), "swallow", JSON.stringify(init));
  }
  // 多修饰组合同路（⇧⌘Escape 也是「不是关闭意图」）。
  assert.equal(escapeDisposition(keyEvent({ shiftKey: true, metaKey: true })), "swallow");
});

test("escapeDisposition：无修饰的 Escape 才是关闭意图", () => {
  assert.equal(escapeDisposition(keyEvent()), "close");
});

test("handle：无层时消费默认行为但不关任何层（裁决 B——把「退出应用」这条缺陷路径堵死）", () => {
  const router = createEscapeRouter();
  const event = keyEvent();
  assert.equal(router.handle(event), true, "返回值 = 调用方要 preventDefault");
  assert.equal(event.defaultPrevented, true, "兜底必须消费默认行为，否则落到原生关窗链");
  assert.equal(router.top(), null, "无层时不得凭空产生层");
  assert.equal(router.size(), 0);
});

test("handle：一层时关闭它恰好一次，关闭后栈空", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  assert.equal(router.handle(keyEvent()), true);
  assert.equal(perm.closes, 1);
  assert.equal(router.top(), null, "层自己 close 时注销（或兜底 finally 兜住），栈必须前移");
  // 第二拍：无层，只消费。
  assert.equal(router.handle(keyEvent()), true);
  assert.equal(perm.closes, 1, "已关闭的层不得被再调一次");
});

test("handle：两层时只关栈顶（后打开者），一次一拍地往前收", () => {
  const router = createEscapeRouter();
  const first = layer("panel");
  const second = layer("permPop");
  router.push(first);
  router.push(second);
  assert.equal(router.handle(keyEvent()), true);
  assert.equal(second.closes, 1, "栈顶 = 最近打开的那一层");
  assert.equal(first.closes, 0, "MUST NOT 连带关闭下层");
  assert.equal(router.top(), first);
  assert.equal(router.handle(keyEvent()), true);
  assert.equal(first.closes, 1);
  assert.equal(router.top(), null);
});

test("handle：swallow 只消费默认行为、不关层、焦点与层序不变", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  for (const init of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
    const event = keyEvent(init);
    assert.equal(router.handle(event), true, JSON.stringify(init));
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(perm.closes, 0, "带修饰键的 Escape MUST NOT 关层");
  assert.equal(router.top()?.id, "permPop");
});

test("handle：组合期不消费、不关层（按键留给输入法取消组合）", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = keyEvent(init);
    assert.equal(router.handle(event), false, JSON.stringify(init));
    assert.equal(event.defaultPrevented, false, "组合期不 preventDefault");
  }
  assert.equal(perm.closes, 0);
});

test("handle：defaultPrevented 已置时让路（不重复消费、不关层）", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  const event = keyEvent({ defaultPrevented: true });
  assert.equal(router.handle(event), false);
  assert.equal(perm.closes, 0);
  assert.equal(router.top()?.id, "permPop", "让路时层栈不变");
});

test("handle：非 Escape 不动作（不消费、不关层）", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  const event = keyEvent({ key: "Enter" });
  assert.equal(router.handle(event), false);
  assert.equal(event.defaultPrevented, false);
  assert.equal(perm.closes, 0);
});

test("层栈：同 id 重复 push 只留一项且置顶（重复打开 = 提到最上层）", () => {
  const router = createEscapeRouter();
  const a1 = layer("panel");
  const b = layer("permPop");
  const a2 = layer("panel");
  router.push(a1);
  router.push(b);
  router.push(a2);
  assert.equal(router.size(), 2, "同 id 不重复入栈");
  assert.equal(router.top()?.id, "panel");
  router.handle(keyEvent());
  assert.equal(a2.closes, 1, "栈顶是最近一次打开的那个层对象");
  assert.equal(b.closes, 0);
  assert.equal(a1.closes, 0);
});

test("层栈：remove 幂等、未知 id 静默（关闭是幂等的）", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  router.remove("permPop");
  router.remove("permPop");
  router.remove("never-pushed");
  assert.equal(router.size(), 0);
  assert.equal(router.top(), null);
});

test("层栈：层 close 抛错时栈仍前进（一次异常不得卡死后续 Escape）", () => {
  const router = createEscapeRouter();
  const broken = layer("broken", () => {
    throw new Error("boom");
  });
  const next = layer("panel");
  // 坏层在栈顶（后打开者）：一次异常之后栈必须前移到下一层。
  router.push(next);
  router.push(broken);
  const originalError = console.error;
  const logged: unknown[] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    assert.equal(router.handle(keyEvent()), true, "抛错也要按已消费返回（否则原生关窗链复活）");
    assert.equal(broken.closes, 1);
    assert.equal(router.top()?.id, "panel", "坏层必须离开栈顶");
    assert.equal(logged.length, 1, "异常要有诊断出口，不静默吞掉");
    assert.equal(router.handle(keyEvent()), true);
    assert.equal(next.closes, 1, "下一拍照常关下一层");
  } finally {
    console.error = originalError;
  }
});

test("装配顺序：兜底 MUST 最后装——先装的消费型监听器挡在它前面", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  const win = fakeWindow();
  // 模拟统一键位分发器（src/keys.ts）：命中绑定就 preventDefault。
  win.target.addEventListener("keydown", (event) => {
    (event as unknown as EscapeKeyEvent).preventDefault();
  });
  installEscapeRouter(win.target, router);
  const consumed = keyEvent();
  win.dispatch(consumed);
  assert.equal(perm.closes, 0, "被下游处理器消费的 Escape 不得再触发关层");

  // 未消费的事件落到兜底：照常关层。
  const win2 = fakeWindow();
  const router2 = createEscapeRouter();
  const layer2 = layer("permPop");
  router2.push(layer2);
  installEscapeRouter(win2.target, router2);
  win2.dispatch(keyEvent());
  assert.equal(layer2.closes, 1);
});

test("装配顺序：兜底装在下游处理器之前时，关层先发生（这条用例钉的是「必须最后装」的反例形态）", () => {
  // 反向形态的记录（不是推荐用法）：兜底先装 ⇒ 下游那个本来会消费事件的处理器
  // 看到的是 `defaultPrevented` 的事件、而层已经被关了。`escape-admission` 结构场景与
  // src/main.ts 的装配点（Keymap.attach 之后）共同保证运行期不会走到这个形态。
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  const win = fakeWindow();
  installEscapeRouter(win.target, router);
  const seen: boolean[] = [];
  win.target.addEventListener("keydown", (event) => {
    seen.push((event as unknown as EscapeKeyEvent).defaultPrevented);
  });
  win.dispatch(keyEvent());
  assert.equal(perm.closes, 1, "兜底抢在分发器之前：层已经被关");
  assert.deepEqual(seen, [true], "下游处理器看到的是已消费事件——这正是顺序反了的现场");
});

test("installEscapeRouter：返回的解绑函数真的摘掉监听（配置重绑时先解绑再重装）", () => {
  const router = createEscapeRouter();
  const perm = layer("permPop");
  router.push(perm);
  const win = fakeWindow();
  const detach = installEscapeRouter(win.target, router);
  assert.equal(win.listeners.length, 1);
  detach();
  assert.equal(win.listeners.length, 0);
  win.dispatch(keyEvent());
  assert.equal(perm.closes, 0, "解绑之后按键不再经过兜底");
});

test("installEscapeRouter：默认走应用级单例（组件在自己的开合点登记同一个实例）", async () => {
  const { escapeRouter } = await import("../../src/escape-router.ts");
  const win = fakeWindow();
  const detach = installEscapeRouter(win.target);
  try {
    const perm = layer("singleton-probe");
    escapeRouter.push(perm);
    win.dispatch(keyEvent());
    assert.equal(perm.closes, 1, "不传实例时必须绑到导出的 escapeRouter");
    assert.equal(escapeRouter.size(), 0, "关闭后自注销");
  } finally {
    escapeRouter.remove("singleton-probe");
    detach();
  }
});

test("handle：栈顶层的 close 只由 `handle` 调一次（就地处理器与兜底共用同一份实现）", () => {
  const router: EscapeRouter = createEscapeRouter();
  let calls = 0;
  router.push({
    id: "shared",
    close() {
      calls += 1;
      router.remove("shared");
    },
  });
  router.handle(keyEvent());
  assert.equal(calls, 1);
  router.handle(keyEvent());
  assert.equal(calls, 1, "层自己注销后，下一拍不得再调它");
});
