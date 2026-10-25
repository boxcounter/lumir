// Escape 的顶层关闭路由（change fix-escape-overlay-close-oct24，design §3.1 / §3.2）。
//
// 缺陷现场（finding `20261024-worker-archive-rmachine-oct24-bug-harness-esc-app.md`，severity
// high）：权限浮层里点选一档之后浮层按新值重建列表，原先持焦的档位按钮被从 DOM 摘除、浏览器把焦点
// 送回 `body`；而各层的 Escape 处理器都挂在**自己的容器**上，`body` 上的按键不冒泡经过它们 ⇒
// 没有人关层、也没有人 `preventDefault` ⇒ 未被消费的 Escape 落到原生窗口关闭链，单窗口应用随即
// 退出。判据因此不是「谁把 Escape 吃掉了」，而是「既没人吃、也没人挡」。
//
// 本模块只做两件事，且都必须是**唯一一份**（REVIEW.md「同一语义两处真源」条）：
//
//   1. **准入**：一次 Escape 是否归「关闭路由」——`escapeDisposition`。各层的就地键处理器**先于**
//      窗口级兜底运行，所以它们必须调用同一份准入：只看 `event.key === "Escape"` 就关层的写法会在
//      兜底看到之前把 ⇧/⌘/⌃/⌥+Escape 与输入法组合期的按键当成关闭意图（design §3.1 的「为什么
//      就地处理器必须走同一份准入」）。就地处理器与兜底各判一次 = 合同的第二份实现，下一次改口径
//      只会改到一处。
//   2. **层栈**：「谁是最上层」只有一个判据——层的打开序（后打开者在栈顶）。层对象只携带
//      `id` 与 `close`，**不复制开合状态**：开合仍归组件所有，这里只记录顺序（design §3.2）。
//      关闭实现的唯一性同一条：每层的 `close` 就是组件自己那条关闭路径（含焦点回还），就地处理器
//      与兜底调的是同一个函数（E5）。
//
// 不变量（E1–E4，design §1）：一次 Escape 只关最上层；关层后焦点回还由各层的 `close` 负责；任何
// 焦点位置下 Escape 都不得产生窗口关闭请求或退出应用；无层时不新增任何**产品动作**——兜底只
// `preventDefault` 阻止原生默认关窗（裁决 B：这不是产品行为，现状的「退出应用」才是缺陷）。
//
// 装配顺序是硬约束（design §3.1）：`installEscapeRouter` MUST 在统一键位分发器 `Keymap.attach`
// **之后**调用，使它成为 window 冒泡阶段最后一个 keydown 监听器。理由：兜底的判据是「谁都没要」，
// 而键位表里的绑定（如 `editor.widget-escape`）命中时会 `preventDefault`（src/keys.ts 的
// `handle`）；兜底排在它前面就会抢走在位绑定。**不是 capture 阶段**：capture 先于各层就地处理器
// 运行，在「无层」时无条件消费就会抢走 `editor.widget-escape`。

/** 一次 Escape 的处置（准入判据的三个取值）。 */
export type EscapeDisposition = "ignore" | "swallow" | "close";

/**
 * 准入判据读到的键事件形状：`KeyboardEvent` 满足它，单测用字面量构造。
 *
 * 只取判据真正用到的字段：`defaultPrevented` 与 `preventDefault()` 参与「已消费即让路」；
 * 四个修饰位与组合期两个信号参与「算不算关闭意图」；`key` 参与「是不是这个键」。
 */
export interface EscapeKeyEvent {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  /** 输入法组合期（`KeyboardEvent.isComposing`）；Safari / 旧 WebKit 另给 `keyCode === 229`。 */
  isComposing: boolean;
  keyCode: number;
  defaultPrevented: boolean;
  preventDefault(): void;
}

/**
 * 唯一准入判断：就地键处理器与窗口级兜底共用（MUST NOT 各判一次）。
 *
 * | 输入 | 处置 | 就地处理器 | 窗口兜底 |
 * |---|---|---|---|
 * | 非 `Escape` | `ignore` | 不动作 | 不动作 |
 * | 组合期（`isComposing` / `keyCode === 229`） | `ignore` | 不动作、不 `preventDefault` | 不动作 |
 * | 带修饰键（⇧ / ⌘ / ⌃ / ⌥） | `swallow` | `preventDefault`、**不关层** | `preventDefault` |
 * | 无修饰、无层 | `close` | —（无处理器） | `preventDefault`（安全消费，不关层 / 不移焦点 / 不改状态） |
 * | 无修饰、有层 | `close` | `preventDefault` + 关**本层** | `preventDefault` + 关**栈顶** |
 *
 * 组合期归输入法（取消组合），带修饰键只消费默认行为——两者**都不关层**：它们不是「收起」的
 * 意图，把 ⇧Escape 当关闭会让「本来想撤销选区 / 换档」的按键关掉正在用的浮层。
 */
export function escapeDisposition(event: EscapeKeyEvent): EscapeDisposition {
  if (event.key !== "Escape") return "ignore";
  // 组合期先判：输入法处理中的 Escape 归输入法（取消候选），既不关层也不消费。
  if (event.isComposing || event.keyCode === 229) return "ignore";
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return "swallow";
  return "close";
}

/** 一个可关闭层。`close` MUST 是该组件自己的关闭实现（含焦点回还），MUST NOT 另写一份。 */
export interface EscapeLayer {
  id: string;
  /** 关闭该层（含焦点回还）。就地键处理器与兜底 MUST 调同一个函数。 */
  close(): void;
}

export interface EscapeRouter {
  /** 层打开时登记；同 id 重复登记 = 提到栈顶（幂等）。 */
  push(layer: EscapeLayer): void;
  /** 层关闭时注销；不存在时静默（关闭是幂等的）。 */
  remove(id: string): void;
  /** 栈顶层（最近打开的那一层）；空栈返回 `null`。 */
  top(): EscapeLayer | null;
  /** 已消费时返回 `false`；`true` = 调用方 `preventDefault`（本实现已代为调用）。 */
  handle(event: EscapeKeyEvent): boolean;
  /** 栈深度（诊断与单测用；运行期没人按它分支）。 */
  size(): number;
}

/**
 * 层栈 + 分派。就地处理器与兜底共用这一份实例上的 `handle`：前者只关「本层」，后者关「栈顶」，
 * 准入与 `defaultPrevented` 让路的判断因此不可能分叉。
 */
export function createEscapeRouter(): EscapeRouter {
  // 打开序：数组尾 = 栈顶。同 id 不重复出现（重复登记先摘再追加 = 提到栈顶）。
  let layers: EscapeLayer[] = [];

  const router: EscapeRouter = {
    push(layer) {
      layers = layers.filter((l) => l.id !== layer.id);
      layers.push(layer);
    },
    remove(id) {
      layers = layers.filter((l) => l.id !== id);
    },
    top() {
      return layers.length === 0 ? null : layers[layers.length - 1];
    },
    size() {
      return layers.length;
    },
    handle(event) {
      // 更靠近事件目标的处理器（层自己的就地键处理器、键位分发器）已经消费：让路。
      if (event.defaultPrevented) return false;
      const disposition = escapeDisposition(event);
      if (disposition === "ignore") return false;
      // 到这里的两种处置都要消费默认行为：`swallow` 只挡原生默认关窗，`close` 同理并且关层。
      event.preventDefault();
      if (disposition === "swallow") return true;
      const layer = router.top();
      if (layer !== null) {
        // 一次异常不得把层栈卡死（否则此后每一拍 Escape 都去调同一个坏掉的 close，栈也永远不前移）。
        // 注销放在 finally：无论 close 是否走完，这一层都离开栈顶。
        try {
          layer.close();
        } catch (error) {
          console.error(`lumir: escape layer "${layer.id}" close failed`, error);
        } finally {
          router.remove(layer.id);
        }
      }
      // 无层时走到这里只剩 `preventDefault`：安全消费，不关层、不移焦点、不改状态、不退出
      // （裁决 B）。现状里「焦点在 body 上按 Escape 退出应用」不是行为约定，是缺陷本身。
      return true;
    },
  };
  return router;
}

/**
 * 应用级单例：各层在自己的开合点登记 / 注销（`setXxx(open)` 与组件的 `open` / `close`），
 * MUST NOT 在别处补一次登记——「层已关还在栈里」会让下一拍 Escape 去调一个已关闭层的 close。
 *
 * 为什么是模块级单例而不是逐组件注入：登记点横跨十来个组件（面板浮层、⌘P、大纲、vault 切换器、
 * 跳转行、搜索、键位面板、文件树 / 标签菜单、三种全屏遮罩），逐个注入会把「谁在最上层」拆回
 * 各组件各持一份的形态——那正是本 change 要收掉的东西。单例本身零 DOM、零监听：监听只由
 * `installEscapeRouter` 装，单测因此可以并行地用 `createEscapeRouter()` 造独立实例。
 */
export const escapeRouter: EscapeRouter = createEscapeRouter();

/** 层打开时登记（与组件的开合点同源；重复登记 = 提到栈顶）。 */
export function registerEscapeLayer(id: string, close: () => void): void {
  escapeRouter.push({ id, close });
}

/** 层关闭时注销（幂等：不存在时静默）。 */
export function unregisterEscapeLayer(id: string): void {
  escapeRouter.remove(id);
}

/**
 * 装窗口级兜底：`window` **冒泡阶段**一个 keydown，返回解绑函数。
 *
 * 必须最后装（design §3.1）：装配点在 `src/main.ts` 每次 `Keymap.attach` 之后——首次装配与配置
 * 重绑两处都要重装，否则重绑后兜底排在新分发器**之前**，会把在位绑定（`editor.widget-escape`）
 * 抢走。单测（tests/unit/escape-router.test.ts 的「顺序」组）与 `escape-admission` 结构场景
 * 共同钉这一条。
 */
export function installEscapeRouter(
  win: Pick<Window, "addEventListener" | "removeEventListener">,
  router: EscapeRouter = escapeRouter,
): () => void {
  const onKeyDown = (event: Event): void => {
    // 只有 keydown 会带这套字段；类型收窄在这里做一次，装监听的地方不必各自断言。
    router.handle(event as KeyboardEvent);
  };
  win.addEventListener("keydown", onKeyDown);
  return () => win.removeEventListener("keydown", onKeyDown);
}
