// 消息摘录手势与跳回（change harness-message-excerpt design §5–§6）。
//
// 与 src/quote-gesture.ts 同一分层纪律，但来源端是 **harness transcript 的消息体**（而非编辑器
// 选区）：
//   1. 纯逻辑（零 DOM）：跳回定位判定 resolveMessageQuoteTarget（role+at → 搜索 → 失锚三层里的
//      前两层；第三层是调用方的 toast）——tests/unit 零 DOM 直接驱动；
//   2. DOM 手势工厂 createMessageQuoteGesture：transcript 内选区 → 浮动「摘录到对话」钮（复用
//      D370 文案与 .quote-gesture-btn 视觉）→ 捕获所见文本 + 来源 role/at → 交调用方入 composer。
//
// **与编辑器摘录手势的互斥是构造性的**：两处监听各以 containment 为门槛（编辑器 = contentDOM、
// 本模块 = 本 transcript 的 .lumir-hp-body），一次选区只可能落在一侧；`selectionchange` 是文档级
// 事件，选区移出某侧时那一侧的监听会把自己的钮藏掉——同屏因此至多一个浮动钮，无需额外仲裁。
//
// 排除面（design §5）：选区锚点落在消息内的引用卡片（.lumir-hp-qcard）、思考块（.lumir-hp-think）、
// 工具行 / 工具块、批准卡内时 MUST NOT 出钮——这些块不在 .lumir-hp-body 内（或嵌在 body 内的卡片
// 里），bodyFromNode 沿 DOM 上溯时先撞到它们即判排除。

import { onRelabel, t } from "./copy";
import { formatMessageAt } from "./quote-card";
import type { MessageQuoteCard } from "./quote-card";
import { quotePrefixMatched } from "./quote-gesture";

// ---------------------------------------------------------------------------
// 纯逻辑层（tests/unit 零 DOM 直接驱动）
// ---------------------------------------------------------------------------

/** 跳回高亮的消退时长（design §6：~1.4s，与编辑器跳回 `.cm-quote-jump-flash` 同节奏）。 */
export const MESSAGE_QUOTE_FLASH_MS = 1400;

/** transcript 消息的结构替身（面板把 DOM 折成它，纯逻辑只认这三样）。 */
export interface MessageAnchor {
  /** who 行的 role（`who.dataset.role`）。 */
  role: string;
  /** when 行的上屏戳 ms（`when.dataset.ts`）；快照恢复无 ts 的旧消息为 null。 */
  at: number | null;
  /** 消息体的渲染文本（`.lumir-hp-body` 的 textContent）。 */
  text: string;
}

/**
 * 第 2 层「全文搜索摘录原文」的命中判定（design §6：前缀匹配口径，复用 quotePrefixMatched 的
 * 判定语义）。整串包含即命中；否则按 quotePrefixMatched 的共同长度口径再试一次——覆盖
 * 「消息文本是摘录前缀」的流式截断形态（消息比摘录短）。空摘录恒不命中（作为锚没有区分度）。
 */
export function messageExcerptMatches(messageText: string, excerpt: string): boolean {
  if (excerpt === "") return false;
  if (messageText.includes(excerpt)) return true;
  return messageText.length > 0 && quotePrefixMatched(messageText, excerpt);
}

/**
 * 消息级跳回定位（design §6 三层降级的前两层；第 3 层 toast 归调用方）：
 *   1. **role + at**：按 role 相符、且两侧上屏戳格式化为**同一 ISO 串**（秒级）后相等来找；
 *      **恰命中一条**才算层一命中——同秒双消息（命中 ≥2）视作层一未命中（歧义），落到层二按
 *      摘录原文消歧；card.at 为 null（无戳旧消息）时层一直接跳过。
 *   2. **全文搜索**：逐个消息查 messageExcerptMatches；命中返回**首个**匹配下标（transcript 序）。
 *   3. 都找不到 → null（调用方 toast 失锚，MUST NOT 静默跳到别的消息）。
 * 返回消息在 messages 里的下标（调用方据此取 DOM 元素滚动 + 高亮）。
 */
export function resolveMessageQuoteTarget(
  messages: readonly MessageAnchor[],
  card: Pick<MessageQuoteCard, "role" | "at" | "text">,
): number | null {
  if (card.at !== null) {
    const want = formatMessageAt(card.at);
    const hits: number[] = [];
    messages.forEach((message, index) => {
      if (message.role === card.role && message.at !== null && formatMessageAt(message.at) === want) {
        hits.push(index);
      }
    });
    if (hits.length === 1) return hits[0];
  }
  for (let index = 0; index < messages.length; index += 1) {
    if (messageExcerptMatches(messages[index].text, card.text)) return index;
  }
  return null;
}

// ---------------------------------------------------------------------------
// DOM 手势工厂
// ---------------------------------------------------------------------------

export interface MessageQuoteGestureDeps {
  /** harness 面板的 transcript 容器（浮动钮的定位基准；选择器的 containment 门槛）。 */
  transcript: HTMLElement;
  /** 捕获到的消息摘录卡片入 composer（面板的 insertMessageQuoteCard）。 */
  insert(card: MessageQuoteCard): void;
}

/**
 * transcript 消息体选区 → 浮动「摘录到对话」钮。返回句柄只含 dispose（摘监听与浮动钮；面板是
 * 单例、进程内长驻，正常路径不调）。钮复用 .quote-gesture-btn 形态与 D370 文案，只改定位基准为
 * transcript（选区右下 +4px）。点击不依赖焦点保持：mousedown preventDefault 保住选区，且平时
 * 记录最后选区作双保险。
 */
export function createMessageQuoteGesture(deps: MessageQuoteGestureDeps): { dispose(): void } {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "quote-gesture-btn";
  button.hidden = true;

  const applyLabel = (): void => {
    const label = t("D370");
    button.textContent = label;
    button.setAttribute("aria-label", label);
  };
  applyLabel();
  onRelabel(applyLabel);

  /** transcript 内最后选区对应的卡片数据（点击时的双保险；点击本身先尝试现读选区）。 */
  let last: MessageQuoteCard | null = null;

  function hideButton(): void {
    button.hidden = true;
    if (button.parentElement !== null) button.remove();
  }

  /**
   * 浮动钮定位：选区包围盒右下、相对 transcript 内容原点（scrollTop 折算，滚动时随内容走）。
   * abspos 收缩盒的可用宽 = 「left 到容器右缘」——选区贴右缘时不收编的话，钮会被压成逐字换行
   * （量到的实际宽也随之失真）。故 `width: max-content`（harness-panel.css 的 scoped 覆写）先
   * 保证量到的是内容宽，再把 left 左移回容器内。
   */
  function placeButton(rect: DOMRect): void {
    const base = deps.transcript.getBoundingClientRect();
    if (button.parentElement !== deps.transcript) deps.transcript.append(button);
    button.hidden = false;
    const left = rect.right - base.left + deps.transcript.scrollLeft + 4;
    const top = rect.bottom - base.top + deps.transcript.scrollTop + 4;
    const maxLeft = Math.max(4, deps.transcript.clientWidth - button.offsetWidth - 4);
    button.style.left = `${Math.min(left, maxLeft)}px`;
    button.style.top = `${top}px`;
  }

  /**
   * 选区锚点 → 所在消息体（`.lumir-hp-body`）。沿 DOM 上溯到 transcript：先撞到定位卡片
   * （`.lumir-hp-qcard`，含嵌在 body 内的引用卡片）即判排除返回 null；先撞到 body 返回它；
   * 上溯到 transcript 或出树（思考块 / 工具行 / 批准卡 / 面板其余区域）也返回 null。
   */
  function bodyFromNode(node: Node | null): HTMLElement | null {
    let el: Element | null =
      node === null ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    if (el === null || !deps.transcript.contains(el)) return null;
    while (el !== null && el !== deps.transcript) {
      if (el.classList.contains("lumir-hp-qcard")) return null;
      if (el.classList.contains("lumir-hp-body")) return el as HTMLElement;
      el = el.parentElement;
    }
    return null;
  }

  /** 消息体 → 来源 role / at（who 行是 role + 可选 when；role 缺失或非法即不产出卡片）。 */
  function metaOf(body: HTMLElement): { role: "user" | "assistant"; at: number | null } | null {
    const message = body.closest(".lumir-hp-msg");
    const who = message?.querySelector<HTMLElement>(".lumir-hp-who");
    const role = who?.dataset.role;
    if (role !== "user" && role !== "assistant") return null;
    const when = who?.querySelector<HTMLElement>(".lumir-hp-when");
    const raw = when?.dataset.ts;
    const at = raw === undefined ? null : Number(raw);
    return { role, at: at !== null && Number.isFinite(at) ? at : null };
  }

  /** 现读选区 → 卡片数据（不在 transcript 消息体内 / 空选区 / role 缺失一律 null）。 */
  function capture(): MessageQuoteCard | null {
    const selection = document.getSelection();
    if (
      selection === null ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      selection.anchorNode === null
    ) {
      return null;
    }
    const body = bodyFromNode(selection.anchorNode);
    if (body === null) return null;
    const text = selection.toString();
    if (text.trim() === "") return null;
    const meta = metaOf(body);
    if (meta === null) return null;
    return { role: meta.role, at: meta.at, text };
  }

  function onSelectionChange(): void {
    const card = capture();
    if (card === null) {
      last = null;
      hideButton();
      return;
    }
    last = card;
    const selection = document.getSelection()!;
    placeButton(selection.getRangeAt(0).getBoundingClientRect());
  }

  // 钮本身不抢选区（mousedown 防默认）：否则点击先把 transcript 选区坍缩掉。
  button.addEventListener("mousedown", (event) => event.preventDefault());

  button.addEventListener("click", () => {
    const card = capture() ?? last;
    if (card === null) return;
    deps.insert(card);
    last = null;
    hideButton();
  });

  document.addEventListener("selectionchange", onSelectionChange);

  return {
    dispose() {
      document.removeEventListener("selectionchange", onSelectionChange);
      hideButton();
    },
  };
}
