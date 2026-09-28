// 跳转到指定行（change goto-line-command，M281）：纯逻辑 + 浮层输入条的 DOM 适配。
//
// 分层与本仓既有同族模块一致（`src/list-indent.ts` / `src/content-width.ts` /
// `src/table-fullscreen.ts`）：纯逻辑零 DOM、DOM 适配在装配侧。
//   - `resolveGotoLine`：解析 + 钳制，`tests/unit/goto-line.test.ts` 直接断言；
//   - `createGotoLinePrompt`：浮层 DOM、就地键消费、`focusout` 收起。**落点与滚动不在这里**
//     ——它复用编辑器既有的 `revealLine`（MUST NOT 另写一套「行号 → 位置 → 滚动」的算式，
//     REVIEW.md 第 8 条），确认路径由装配层注入的 `onJump` 承担。
//
// 挂点与定位口径照 `.lumir-toc`（`src/toc.ts` 是同一形态的先例）：浮层 append 到
// `shell.modeline`，`position: absolute; bottom: 100%` 紧贴 modeline 上沿向上展开——这是
// Emacs echo area 的位置语义在「不占常驻布局」约束下的对应物（design §3.2）。
import { keyToken } from "./keys";
import { t, tPlural } from "./copy";

/** 输入框的读屏名（文案 deck D152）。输入框只有数字、没有可见标签，读屏需要一个动作说明。
 *  **函数**而不是常量：浮层每次打开重写这两个属性，语言切换后新开的浮层自然是新语言。 */
export const GOTO_LINE_LABEL = (): string => t("D152");

/** 输入框的占位（文案 deck D157）。常态看不见——打开即预填当前行号并全选（清空后才露出）。 */
export const GOTO_LINE_PLACEHOLDER = (): string => t("D157");

/** 总行数提示（文案 deck D158）。越界是**静默钳制**（D3 裁决），`共 M 行` 因此是用户判断
 *  「我要的行号是不是超出了文档」的唯一依据，MUST NOT 删。 */
export function gotoLineTotalText(total: number): string {
  return tPlural("D158", total, { total });
}

/**
 * 解析输入串并钳制到 `[1, totalLines]`（1-based 源文档逻辑行）。
 *
 * 口径只有一条规则（D3 裁决，同 Emacs `goto-line` 的 `(forward-line (1- line))` 到头即停）：
 * 数字按文档范围钳制后即落点，越界不报错、不加提示、不阻塞。
 *
 * - 输入层只让数字字符进得来（见 `createGotoLinePrompt`），「非法输入」这一整类因此在解析面
 *   不存在；非数字字符在这里**一律忽略**，只保证函数对任意字符串都返回一个合法行号
 *   （不抛错、不返回 NaN）——纯函数层的定义完整，输入层的过滤才是产品口径那一道。
 * - 解析不出数字（空串 / 全是非数字）→ 按 `fallbackLine`（打开时的当前行号）解释，
 *   于是「空输入 + Enter」是「停在当前行」（Emacs 的 RET 用默认值同款）。
 * - 超长数字串会溢出成 `Infinity`，钳制后自然落在末行——与「输入 M+10」同一条路径。
 */
export function resolveGotoLine(raw: string, fallbackLine: number, totalLines: number): number {
  const total = Math.max(1, Math.trunc(totalLines));
  const digits = raw.replace(/[^0-9]/g, "");
  const parsed = digits === "" ? Math.trunc(fallbackLine) : Number(digits);
  const line = Number.isNaN(parsed) ? 1 : parsed;
  return Math.max(1, Math.min(line, total));
}

/** 浮层对编辑器的注入面：`src/editor.ts` 的 `setGotoLinePrompt` 只认这一个方法
 *（命令侧只需要「打开」，其余路径都由本模块自己消费）。 */
export interface GotoLinePromptPort {
  open(defaultLine: number, totalLines: number): void;
}

export interface GotoLinePromptOptions {
  /** 浮层挂点：`shell.modeline`——它是 `position: relative` 的定位块（与 `.lumir-toc` 同挂点）。 */
  mount: HTMLElement;
  /** 确认回调：解析出的行号交给它。装配层注入的是编辑器的「先把焦点交还编辑器、再走既有
   *  `revealLine`」那条路径——落点与滚动的实现只有一处。 */
  onJump(line: number): void;
  /** 取消 / 收起时把焦点交还编辑器（`editor.focusPreservingReadingPosition()`，MUST NOT 裸
   *  `view.focus()`——浮层关闭不得改变阅读位置，见 src/scroll-position-view.ts）。 */
  restoreFocus(): void;
  /** 输入条在场状态发生跃迁时回调（M281 的 D4 二次改判）：`on-demand` 档下 md 的行号 gutter
   *  随它装 / 卸。只在**跃迁**时调用（打开→收起、收起→打开各一次；重复 open 不重复通知），
   *  且与「跳转」正交——收起路径（取消 / 失焦 / 会话切换）同样通知。 */
  onVisibilityChange?(open: boolean): void;
}

export interface GotoLinePrompt extends GotoLinePromptPort {
  /** 收起输入条。`restoreFocus` 为假时不抢焦点——焦点已经去了别处（用户点树行 / 别的浮层）时
   *  把它拽回编辑器等于吃掉用户那次点击。 */
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
}

export function createGotoLinePrompt(options: GotoLinePromptOptions): GotoLinePrompt {
  const popover = document.createElement("div");
  popover.className = "lumir-goto";
  popover.hidden = true;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "lumir-goto-input";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("aria-label", GOTO_LINE_LABEL());
  input.placeholder = GOTO_LINE_PLACEHOLDER();
  const hint = document.createElement("span");
  hint.className = "lumir-goto-hint";
  popover.append(input, hint);
  options.mount.append(popover);

  let opened = false;
  /** 打开时的当前行号（空输入的默认值，见 resolveGotoLine 的第二条）与文档总行数。 */
  let fallbackLine = 1;
  let totalLines = 1;

  /** 收起 DOM 与状态，**不碰焦点**（焦点该去哪由调用方决定：确认走 onJump、取消走 restoreFocus、
   *  失焦时谁都不碰）。只在真的从「在场」跃迁到「不在场」时通知装配层——`close()` 的 `!opened`
   *  早退与重复 open 因此都不会重复通知。 */
  function dismiss(): void {
    const wasOpen = opened;
    opened = false;
    popover.hidden = true;
    input.value = "";
    if (wasOpen) options.onVisibilityChange?.(false);
  }

  function close(restoreFocus = true): void {
    if (!opened) return;
    dismiss();
    if (restoreFocus) options.restoreFocus();
  }

  function confirm(): void {
    const line = resolveGotoLine(input.value, fallbackLine, totalLines);
    dismiss();
    options.onJump(line);
  }

  // 就地键消费（design §1.2）：输入条持焦时事件目标在浮层里，`editor` 作用域的绑定命中不了
  //（作用域判定看目标是否在 contentDOM 内），表内一个 token 也只有一条绑定可用。因此
  // Enter / Escape / ⌃G / ⌥G 四类都由输入条自己消费。`preventDefault` 同时是**分发表那边的
  // 信号**：`Keymap.handle` 对 `event.defaultPrevented` 的事件直接让路（src/keys.ts），
  // 「打开期间再按同键」因此不会二次打开、也不会重复分发。
  popover.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      confirm();
      return;
    }
    if (
      event.key === "Escape" ||
      (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "g")
    ) {
      event.preventDefault();
      close();
      return;
    }
    // ⌥G 就地消费为无操作：token 走 `keyToken`（含 Alt 的组合按物理键 `KeyboardEvent.code`
    // 判定——macOS 的 Alt 层把 G 换成 `©`，`e.key` 判不出用户按的键）。形态的单一来源在
    // `src/keys.ts`，MUST NOT 在这里另写一份键名判断。默认键位被 `[keys]` 解绑时这条消费
    // 仍然生效——它挡的是 Alt 层字符，与「哪个键打开输入条」是两件事。
    if (keyToken(event) === "Alt-KeyG") {
      event.preventDefault();
      return;
    }
    // 只接受数字字符：无修饰键的可打印单字符一律吞掉不产生字符（光标键 / 删除键 / ⌘·⌃ 组合
    // 照常走原生路径，全选与删除仍然是可用的编辑动作）。
    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1 && !/[0-9]/.test(event.key)) {
      event.preventDefault();
    }
  });

  // 非 keydown 路径的兜底：输入法组合、粘贴、拖放都不产生可拦的 keydown。非数字整段拒收
  //（插入的数据不是纯数字就不插），值里若仍混进非数字（组合期的中间态）就地清掉。
  input.addEventListener("beforeinput", (event) => {
    const data = (event as InputEvent).data;
    if (data === null || data === undefined) return;
    if (/^[0-9]*$/.test(data)) return;
    event.preventDefault();
  });
  input.addEventListener("input", () => {
    const digits = input.value.replace(/[^0-9]/g, "");
    if (digits !== input.value) input.value = digits;
  });

  // 焦点离开**浮层**才收起（挂点在容器上，与 .lumir-toc 同款）：输入框与提示之间切换不算离开。
  // 这条路径不跳转、也不抢回焦点（焦点去哪是用户刚做的选择）。
  popover.addEventListener("focusout", (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && popover.contains(next)) return;
    close(false);
  });

  return {
    open(defaultLine, total) {
      const wasOpen = opened;
      fallbackLine = defaultLine;
      totalLines = total;
      // 输入条的读屏名与占位在构造期写在 DOM 上（挂载早于配置到位），打开时重写一遍
      //（design §5.2 的不变量：挂载后的语言相关文本 MUST 有一条可重跑的写入路径）。
      input.setAttribute("aria-label", GOTO_LINE_LABEL());
      input.placeholder = GOTO_LINE_PLACEHOLDER();
      hint.textContent = gotoLineTotalText(total);
      input.value = String(defaultLine);
      popover.hidden = false;
      opened = true;
      // 预填当前行号并全选：键入即替换（Emacs minibuffer 的默认值同款，「我现在第几行」也是
      // 这一下按出来的读数）。
      input.focus();
      input.select();
      // 通知放在聚焦之后：装配层据此装 md 的 gutter（一次 CM 重配），输入框此时已持焦，
      // 重配不会与聚焦动作抢时序。
      if (!wasOpen) options.onVisibilityChange?.(true);
    },
    close,
    isOpen: () => opened,
  };
}
