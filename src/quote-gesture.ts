// 摘录手势与跳回（M344，change add-harness-quote-cards design §4 失锚降级链 / §5 手势与装配）。
//
// 本模块分三层，与仓内同族模块（src/goto-line.ts / src/list-indent.ts）同一分层纪律：
//   1. 纯逻辑（零 DOM / 零 CodeMirror view）：行范围捕获、标题上下文、失锚三层降级链的
//      定位判定——tests/unit 直接驱动；
//   2. 跳回高亮的 CM6 扩展：StateField + mark 装饰（借用 pending-tint 语义），装在
//      editor.ts 的会话基础层（两种模式同一条路径）；
//   3. DOM 手势工厂 createQuoteGesture：浮动钮的浮现 / 消失 / 点击捕获，与跳回处理器
//      （composer / transcript 卡片点击都经 harness 面板转进来，见 setQuoteJumpHandler）。
//
// 行为合同（design §5）：
//   - 编辑器侧零常驻装饰——只存在两种瞬态：进行中的选区（含浮动钮）与跳回高亮（~1.4s 消退）。
//   - 摘录来源恒为「最近活跃编辑器 pane」的选区（ADR 0008 Decision 3 语义）：harness 面板持焦
//     不改变 pane 归属（活跃指针只在焦点进入 pane contentDOM 时翻转，面板持焦不动它）。
//   - 点击浮动钮不依赖焦点保持：平时记录编辑器内最后选区，点击时先恢复选区再捕获卡片数据。
//   - 失锚告知用 toast（复用 notice 组件，文案 D372），MUST NOT 静默跳到别的位置。

import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Text } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { onRelabel, t } from "./copy";
import { PATH_SEPARATOR } from "./toc";
import type { TocHeading } from "./toc";
import { createQuoteCard } from "./quote-card";
import type { QuoteCard } from "./quote-card";
import type { EditorSession } from "./editor";

// ---------------------------------------------------------------------------
// 纯逻辑层（tests/unit 零 DOM 直接驱动）
// ---------------------------------------------------------------------------

/** quoteContextOf 的标题输入形态（structural：TocHeading 天然满足，测试可造轻量替身）。 */
export interface QuoteHeading {
  level: number;
  text: string;
  /** 标题行首的文档偏移。 */
  from: number;
}

/**
 * 选区 → 行范围 `A-B`（design §3：创建时经 CM6 `lineAt(from)/lineAt(to)` 捕获，MUST 非空）。
 * 单行选区也产出 `A-A`（形态uniform，解析侧 parseQuoteLines 同时接受 `A` 单写）。
 * 位置越界（from < 0 / to > doc.length / from > to）返回 null——调用方不得产出卡片。
 */
export function quoteLinesOf(doc: Text, from: number, to: number): string | null {
  if (from < 0 || to > doc.length || from > to) return null;
  const start = doc.lineAt(from).number;
  const end = doc.lineAt(to).number;
  return `${start}-${end}`;
}

/**
 * 卡片行范围串 → 行号对。接受 `A-B` 与单写 `A`；非法形态（空串 / 非数字 / end < start）返回
 * null——降级链第一层按它判「行号不可用」，直接落到第二层，MUST NOT 抛错。
 */
export function parseQuoteLines(raw: string): { start: number; end: number } | null {
  const match = /^(\d+)(?:-(\d+))?$/.exec(raw.trim());
  if (match === null) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  if (end < start) return null;
  return { start, end };
}

/**
 * 摘录上方最近一级标题 + 完整标题链（design §3：heading = 最近一级标题，headingPath 是人侧
 * hover 专用的完整链，如 `阅读工作流 › 筛选 › 倒序阅读`）。headings 必须是文档序（toc 的
 * extractHeadings 产出即文档序）；摘录在首个标题之前时两者都是空串（出处行仅显示文档名）。
 *
 * 链的构造与 toc 浮层的「当前位置链」同构：按文档序扫描，遇同级或更浅标题先弹出栈里更深的
 * 条目——栈里恒是「从文档根部到当前位置」的最深链。分隔符取 toc 的 PATH_SEPARATOR
 * （单一来源，MUST NOT 在这里另写一份「›」字面量，REVIEW.md 第 8 条）。
 */
export function quoteContextOf(
  headings: readonly QuoteHeading[],
  quoteFrom: number,
): { heading: string; headingPath: string } {
  const chain: QuoteHeading[] = [];
  for (const heading of headings) {
    if (heading.from >= quoteFrom) break; // 文档序：之后的标题与「上方」无关
    while (chain.length > 0 && chain[chain.length - 1].level >= heading.level) chain.pop();
    chain.push(heading);
  }
  const nearest = chain[chain.length - 1];
  if (nearest === undefined) return { heading: "", headingPath: "" };
  return {
    heading: nearest.text,
    headingPath: chain.map((item) => item.text).join(PATH_SEPARATOR),
  };
}

/** 行号对 → 文档内行范围偏移；行号越出文档返回 null（文档被改短了）。 */
function lineAnchorRange(
  doc: Text,
  start: number,
  end: number,
): { from: number; to: number } | null {
  if (start < 1 || start > doc.lines) return null;
  const clampedEnd = Math.min(end, doc.lines);
  return { from: doc.line(start).from, to: doc.line(clampedEnd).to };
}

/**
 * 命中校验（design §4 第一层「前缀匹配即可」）：命中文本与摘录原文**共同长度内逐字节相等**。
 * 取对称而不是单向 `anchorText.startsWith(quoteText)` 的理由：文档编辑有两种漂移方向——行尾
 * 追加（anchorText 更长）与行被截短（anchorText 更短），两种都该判命中；只有开头被改才失配。
 * 空摘录恒不命中（空串与任何位置都「匹配」，作为锚没有区分度）。
 */
export function quotePrefixMatched(anchorText: string, quoteText: string): boolean {
  if (quoteText === "") return false;
  const common = Math.min(anchorText.length, quoteText.length);
  return anchorText.slice(0, common) === quoteText.slice(0, common);
}

/**
 * 失锚三层降级链的定位判定（design §4 的 1–2 层；第 3 层是调用方的 toast，不在纯函数里）：
 *   1. 按 lines 行号取行范围文本，与摘录原文做前缀校验——命中返回行范围；
 *   2. 行号越界 / 校验失配（文档已编辑、行号漂移）→ 全文搜索摘录原文字符串，命中返回命中处；
 *   3. 都找不到 → null（调用方 toast「该摘录已失锚」，MUST NOT 静默跳别的位置）。
 * 摘录原文可含换行（原文照录，归一化是 composer 的职责，见 M342 reviewer 留口）。
 */
export function resolveQuoteAnchor(
  doc: Text,
  card: Pick<QuoteCard, "lines" | "text">,
): { from: number; to: number } | null {
  const lines = parseQuoteLines(card.lines);
  if (lines !== null) {
    const range = lineAnchorRange(doc, lines.start, lines.end);
    if (range !== null && quotePrefixMatched(doc.sliceString(range.from, range.to), card.text)) {
      return range;
    }
  }
  if (card.text !== "") {
    const found = doc.sliceString(0, doc.length).indexOf(card.text);
    if (found >= 0) return { from: found, to: found + card.text.length };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 跳回高亮的 CM6 扩展（零常驻装饰纪律的「跳回高亮」瞬态）
// ---------------------------------------------------------------------------

/** 跳回高亮的消退时长（design §5：~1.4s）。 */
export const QUOTE_FLASH_MS = 1400;

/** 设置 / 清除跳回高亮范围。清除用 null 值而不是「撤掉效果」：装饰存于 StateField，
 *  值语义比存在语义好表达（重复设置覆盖旧的，天然只有一个瞬态在场）。 */
export const setQuoteFlash = StateEffect.define<{ from: number; to: number } | null>();

/**
 * 跳回高亮的装饰字段：一段 pending-tint 语义的 mark（find-in-page 黄的同源色值，eink 档的
 * 10% 黑覆写落在 style.css 的 `.cm-quote-jump-flash` 上）。范围随文档变更映射；标签切换时
 * 值随 state 走，消隐计时器到点无条件清——两种路径都不会留下常驻装饰。
 */
export const quoteFlashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setQuoteFlash)) continue;
      next =
        effect.value === null
          ? Decoration.none
          : Decoration.set([
              Decoration.mark({ class: "cm-quote-jump-flash" }).range(effect.value.from, effect.value.to),
            ]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** 装进取会话基础层的扩展（md / code 两种模式同一条路径，与 lumirSearch 同层）。 */
export const quoteFlashExtension: Extension = quoteFlashField;

// ---------------------------------------------------------------------------
// DOM 手势与跳回装配
// ---------------------------------------------------------------------------

export interface QuoteGestureDeps {
  /** 最近活跃编辑器 pane 的视图（活读：pane 归属随活跃指针走，harness 面板持焦不改变它）。 */
  activeView(): EditorView;
  /** 最近活跃编辑器 pane 的挂载元素（.editor-pane，position:relative）——浮动钮的定位基准。 */
  activeMount(): HTMLElement | undefined;
  /** 最近活跃编辑器 pane 前台会话的路径；无路径的空文档不产出卡片（卡片 file 必须有出处）。 */
  activePath(): string | undefined;
  /** 按路径取会话（目标文档未打开 → undefined）。 */
  sessionForPath(path: string): EditorSession | undefined;
  /** 会话所属 pane 的视图（文件开在他 pane 时，跳回要落在它自己的视图上）。 */
  viewOfSession(session: EditorSession): EditorView | undefined;
  /** 激活一个会话（跳回前把对应 pane 翻成活跃——「定位到对应编辑器 pane 的原文位置」）。 */
  activateSession(session: EditorSession): void;
  /** 在最近活跃编辑器 pane 打开文件（降级链的「目标文档未打开」入口）；失败返回 false。 */
  openFile(path: string): Promise<boolean>;
  /** 全文标题解析（装配层注入 toc 的 extractHeadings full 口径：点击是用户动作，不在键入路径上）。 */
  extractHeadings(state: EditorState): readonly TocHeading[];
  /** 卡片入 composer（面板未开先开再插入并聚焦——harness 面板那条 insertQuoteCard）。 */
  insertQuoteCard(card: QuoteCard): void;
  /** 失锚告知出口（notice 组件，文案 D372）。 */
  toast(text: string): void;
}

export interface QuoteGesture {
  /** 卡片跳回（注册进 harness 面板的 setQuoteJumpHandler）：失锚三层降级链 + 跳回高亮。 */
  jump(card: QuoteCard): Promise<void>;
  dispose(): void;
}

/**
 * 摘录手势 + 跳回的总装配。返回的 jump 交给 harness 面板的 setQuoteJumpHandler；
 * dispose 摘监听与浮动钮（vault 卸载 / 测试用）。
 *
 * 浮动钮的瞬态口径（design §5）：选区存在且在最近活跃编辑器 pane 内时浮现于选区右下，
 * 选区坍缩 / 移出编辑器即消失；平时记录编辑器内最后选区（点击时恢复，点击本身不依赖焦点保持
 * ——mousedown 上 preventDefault 防止选区被钮抢掉，这与「记录最后选区」是双保险）。
 */
export function createQuoteGesture(deps: QuoteGestureDeps): QuoteGesture {
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

  /** 编辑器内最后选区（from/to 是记录时刻的文档偏移；点击时恢复并按恢复后的现读值捕获）。 */
  let last: { path: string; from: number; to: number } | null = null;

  function hideButton(): void {
    button.hidden = true;
    if (button.parentElement !== null) button.remove();
  }

  /** 浮动钮定位：选区包围盒右下、相对活跃 pane 挂载元素（.editor-pane 是定位基准）。 */
  function placeButton(rect: DOMRect): void {
    const mount = deps.activeMount();
    if (mount === undefined) return;
    if (button.parentElement !== mount) mount.append(button);
    const mountRect = mount.getBoundingClientRect();
    button.style.left = `${rect.right - mountRect.left + 4}px`;
    button.style.top = `${rect.bottom - mountRect.top + 4}px`;
    button.hidden = false;
  }

  function onSelectionChange(): void {
    const view = deps.activeView();
    const selection = document.getSelection();
    if (
      selection === null ||
      selection.isCollapsed ||
      selection.anchorNode === null ||
      selection.rangeCount === 0 ||
      !view.contentDOM.contains(selection.anchorNode) ||
      deps.activePath() === undefined
    ) {
      hideButton();
      return;
    }
    let from: number;
    let to: number;
    try {
      // posAtDOM 在 widget 边界等位置可能抛 RangeError——读不出就是无效选区，不产出卡片。
      const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
      const head = view.posAtDOM(selection.focusNode!, selection.focusOffset);
      from = Math.min(anchor, head);
      to = Math.max(anchor, head);
    } catch {
      hideButton();
      return;
    }
    last = { path: deps.activePath()!, from, to };
    placeButton(selection.getRangeAt(0).getBoundingClientRect());
  }

  // 钮本身不抢选区（mousedown 防默认）：否则点击先把编辑器选区坍缩掉，「恢复最后选区」
  // 就要依赖另一条链路才能成立。
  button.addEventListener("mousedown", (event) => event.preventDefault());

  button.addEventListener("click", () => {
    if (last === null) return;
    // 记录的是「最近活跃编辑器 pane 的选区」：用户如果已经切走前台标签 / 切走活跃 pane，
    // 捕获会落在另一份文档上（偏移按另一篇解释）——此时手势已过期，MUST NOT 产出张冠李戴的卡片。
    if (deps.activePath() !== last.path) return;
    const session = deps.sessionForPath(last.path);
    const view = session === undefined ? deps.activeView() : (deps.viewOfSession(session) ?? deps.activeView());
    // 点击时恢复选区：文档可能已被编辑，CM 的 dispatch 会把越界位置钳进文档——恢复后按
    // **现读**的选区捕获卡片数据（而不是记录时刻的偏移原文照录，那才是当前的选区内容）。
    view.focus();
    view.dispatch({ selection: { anchor: last.from, head: last.to } });
    const range = view.state.selection.main;
    const from = Math.min(range.anchor, range.head);
    const to = Math.max(range.anchor, range.head);
    const path = last.path;
    const lines = quoteLinesOf(view.state.doc, from, to);
    const text = view.state.doc.sliceString(from, to);
    if (lines === null || text === "") return; // 取不到行范围不产出卡片（design §3 裁决）
    const { heading, headingPath } = quoteContextOf(deps.extractHeadings(view.state), from);
    deps.insertQuoteCard(createQuoteCard({ file: path, heading, headingPath, lines, text }));
  });

  document.addEventListener("selectionchange", onSelectionChange);

  async function jump(card: QuoteCard): Promise<void> {
    let session = deps.sessionForPath(card.file);
    // 目标文档未打开、或开着但内容还是壳态（loaded === false，正文未装载）：先在最近活跃
    // 编辑器 pane 打开（openFile 对壳态是装载、对未开是新开；对已装载会话是短路切换）再走
    // 降级链；文件已不存在（打开失败）直接进第三层——MUST NOT 为一个不存在的文件猜位置。
    if (session === undefined || !session.loaded) {
      const opened = await deps.openFile(card.file);
      if (!opened) {
        deps.toast(t("D372"));
        return;
      }
      session = deps.sessionForPath(card.file);
      if (session === undefined) {
        deps.toast(t("D372"));
        return;
      }
    } else {
      // 已打开：定位到它所属 pane（可能开在他 pane），翻活跃指针。
      deps.activateSession(session);
    }
    const view = deps.viewOfSession(session) ?? deps.activeView();
    const anchor = resolveQuoteAnchor(view.state.doc, card);
    if (anchor === null) {
      deps.toast(t("D372"));
      return;
    }
    view.focus();
    view.dispatch({
      selection: { anchor: anchor.from, head: anchor.to },
      effects: [
        EditorView.scrollIntoView(anchor.from, { y: "center" }),
        setQuoteFlash.of({ from: anchor.from, to: anchor.to }),
      ],
    });
    // ~1.4s 消退（design §5）：到点无条件清——值随 state 走，重复点击只重置计时。
    setTimeout(() => {
      view.dispatch({ effects: setQuoteFlash.of(null) });
    }, QUOTE_FLASH_MS);
  }

  return {
    jump,
    dispose() {
      document.removeEventListener("selectionchange", onSelectionChange);
      hideButton();
    },
  };
}
