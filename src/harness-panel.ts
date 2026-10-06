// Harness 对话面板（M303，change add-harness-probe，design §10 面板 UI；HP1 归位 pane，
// change move-harness-to-pane-chat-frame）。
//
// 形态（HP1 起）：**pane 内容件**——装配层在 harness pane 分栏时把面板挂进该 pane 的挂载
// 元素（attachTo），收起时摘除（面板元素长驻内存，订阅与流式态不随摘出丢失）；dock 列
// （网格第三列 / .dock-open）随本 change 移除。面板不再有头部栏：会话身份（名下拉）与
// 新建会话钮上移进标题栏的 harness 段（.lumir-hp-seg，仅 harness 在场时出现，宽度由装配层
// 按 pane 比分宽、与分隔条像素对齐）；ctx% 读数与常驻警示句随头部栏移除（读数迁入 composer
// 控制行是后续 mission 的面）。标题栏 toggle 钮仍由本模块自建，钉标题栏右端（产品标识块
// 已移位 traffic 灯区）；双 pane 时隐藏（退让条款），⌘⇧A 照走。
//
// 开合语义：面板的开/关 = harness pane 的分/收，是**装配层**动作（账本 + DOM 槽 + 焦点
// 移交）——本模块经 deps.togglePane 把 toggle 钮 / Escape / ⌘⇧A 的路由交回装配层，
// isOpen() = 是否已挂载（pane 在场）。
//
// 分层纪律（ADR 0007 Decision 3）：
//   - 上下文组装在 src/harness-context.ts（只依赖 EditorHandle，本模块是它的唯一消费者）；
//   - 全部后端进出经 src/ipc.ts 的薄封装（tower 钉死的 harness_* 契约）；
//   - 面板只是渲染器：会话状态在 Rust，webview 重载后经 harness_state() 快照恢复渲染。
//
// 渲染纪律（spec harness「对话面板」+ design §10）：
//   - 流式渲染走 rAF 合帧：text_chunk 先进缓冲，rAF 里一次落地——不触碰 CodeMirror 状态，
//     keypress-to-paint 路径零新增（ADR 0002 §6）；纯 DOM，不挂 CodeMirror。
//   - assistant 消息按 Markdown 渲染：解析用已在依赖里的 @lezer/markdown（GFM extension，
//     零新 npm 依赖——选型记录见 mission notes，基准 = GFM 基本面 + 零 XSS 面）；产出全部
//     经 DOM API + textContent 注入，本模块没有任何 innerHTML / outerHTML 赋值——XSS 面
//     因此无由发生（模型输出里的 HTML 块按转义文本展示，永不解析成标记）。
//   - 代码高亮复用既有体系：highlightCode（src/preview/code.ts）出 token、cm-lp-tok-* 类名
//     与编辑器同源；色值经 mirrorThemeScope（src/overlay-scope.ts）把 preview 主题的 scope
//     类镜像到 transcript 容器上——规则值仍只有 src/preview/theme.ts 一处（单一来源），
//     与表格 / 代码块全屏浮层同一条机制。
//   - 流式期间按块增量重渲：已完成块渲染一次不再动，只有进行中的末块随 chunk 重渲；
//     done 到达后对完整源做一次全量重渲（增量渲染在「跨空行的松散列表」这类形态上是
//     近似，全量重渲是收敛点——近似只存在于流式期间）。
//
// 文案：全部取值经 src/copy.ts 的 t()（D326–D330 / D332–D348 / D375）；长驻元素（toggle
// 钮 / harness 段 / 输入框 placeholder / 按钮 / 上下文 chip / 待决批准项）注册 onRelabel，
// 语言切换时从已存状态重渲（design §5.2 的不变量）；transcript 的历史条目是已发生事实的记
// 录，不随语言切换改写（与 toast 历史同口径）。

import { GFM, parser as commonmarkParser } from "@lezer/markdown";
import { onRelabel, t } from "./copy";
import {
  errorMessage,
  harnessApprove,
  harnessNewSession,
  harnessSend,
  harnessState,
  onHarnessEvent,
  openExternalUrl,
} from "./ipc";
import type { HarnessEvent } from "./ipc";
import { assembleHarnessContext, serializeHarnessContext } from "./harness-context";
import type { HarnessContextBlock, HarnessContextSource } from "./harness-context";
import { createQuoteCard, serializeQuoteMessage } from "./quote-card";
import type { ComposerBlock, QuoteCard } from "./quote-card";
import { highlightCode } from "./preview/code";
import { mirrorThemeScope } from "./overlay-scope";
import type { AppShell } from "./shell";

/** 面板对编辑器句柄的结构需求：上下文组装（HarnessContextSource）+ 关面板时的焦点归还 +
 *  主题 scope 镜像的源元素（view.dom）。写成窄接口，不消费 EditorHandle 的其余面。 */
export interface HarnessPanelEditor extends HarnessContextSource {
  view: HarnessContextSource["view"] & { dom: HTMLElement; focus(): void };
}

export interface HarnessPanelDeps {
  shell: AppShell;
  editor: HarnessPanelEditor;
  /** 开/合 harness pane 的装配层入口（账本 split/close + DOM 槽 + 焦点移交）：toggle 钮、
   *  面板内 Escape、摘录插入的「未开先开」都经这一条路径——面板自己不碰 pane 账本
   *  （HP1，change move-harness-to-pane-chat-frame；⌘⇧A 命令表也在装配层）。 */
  togglePane(): void;
}

export interface HarnessPanelHandle {
  /** 唤起 / 收起（harness.toggle 命令、标题栏 toggle 钮、面板内 Escape 共用这一条路径——
   *  实际开合经 `deps.togglePane` 交装配层执行）。 */
  toggle(): void;
  /** 面板是否已挂进 harness pane（= pane 在场）。 */
  isOpen(): boolean;
  /** 挂载 / 摘除：装配层在 harness pane 分栏时把该 pane 的挂载元素传入（面板挂进去并显形），
   *  收起时传 null（面板摘出 DOM、长驻内存——订阅与流式态不丢，下次 attach 续用）。 */
  attachTo(mount: HTMLElement | null): void;
  /** 把焦点交给 composer（pane.other 切到 harness pane 时的落点；面板句柄经它聚焦）。 */
  focusComposer(): void;
  /** 标题栏 harness 段（.lumir-hp-seg）：长驻元素，装配层在 harness pane 分栏时插进
   *  标题栏、按其比分宽设 flexGrow（与 pane 分隔条像素对齐）；hidden 由 attach 状态驱动。 */
  titlebarSegment(): HTMLElement;
  /** 装载新 vault 之后由装配层调用（M312）：把面板的会话作用域切到新 vault——丢掉旧 vault 的
   *  渲染面与本地态，并按当前 vault 重拉一次 `harness_state`。同一个 vault 重复调用是空操作。 */
  vaultChanged(root: string): void;
  /** 双栏退让（M316 机制，HP1 修订语义）：split（harness 在场）时隐藏标题栏 toggle 钮
   *  （标题栏腾给文档标签槽与 harness 段按比分宽）；⌘⇧A 的命令路径不受影响
   *  （它走 `toggle()`，不经过这颗钮）。 */
  setChromeRetreat(on: boolean): void;
  /**
   * 摘录卡片入 composer（M343 为 M344/QC3 留的挂载点）：卡片插在光标处（段落中间拆段、
   * 光标落卡片下一行的问题段落——design §5 装配合同）；面板未开时先经 `deps.togglePane`
   * 打开再插入并聚焦。卡片数据（含 lines 非空校验）由调用方经 `createQuoteCard` 产出。
   */
  insertQuoteCard(card: QuoteCard): void;
  /**
   * 注册「点击卡片跳回原文」处理器（M343 为 M344/QC3 留的挂载点）：composer 与 transcript
   *  内的卡片点击（× 钮除外）都经它；未注册时点击无操作。失锚三层降级链与跳回高亮由 QC3 实现。
   */
  setQuoteJumpHandler(handler: ((card: QuoteCard) => void) | null): void;
}

/**
 * 会话作用域判据（M312）：载荷（`harness:event` 的事件信封 / `harness_state` 快照）自带的
 * vault 标识，必须与**当前 vault** 一致才归本面板渲染。
 *
 * 两种「不一致」的处置口径：
 * - 载荷没带标识（`undefined`）→ **放行**：桩环境与早期载荷形态不带它，按「归属未知」处理
 *   （宽容解析，与 `harness_state` 缺键即空态同一条纪律）；
 * - 当前 vault 未知（`null`，尚未装载）而载荷带了标识 → **丢弃**：装载路径紧跟着就会拉一次
 *   快照，宁可不显示也不显示错的那个 vault（误显示的代价是「用户以为在 B 提问，回答来自 A」）。
 *
 * 比较是**逐字节**的：两侧都是后端那个 `PathBuf::display()` 串（`VaultInfo.root` 与
 * `VaultScope::key()` 同一个表达式），不存在归一化差异。判据本身因此是 fail-closed 的
 * ——两侧真漂了，症状是面板不再显示事件（可见、可复现），而不是跨 vault 串台（静默）。
 */
export function inCurrentVault(payloadVault: unknown, currentVault: string | null): boolean {
  return typeof payloadVault !== "string" || payloadVault === currentVault;
}

// ---------------------------------------------------------------------------
// 混排 composer 的纯模型层（M343，change add-harness-quote-cards design §2/§5）。
// 顶层块只有两类：quote（原子卡片，数据即 M342 的 QuoteCard）与 paragraph（问题段落，
// 文本可含 \n 软换行）。DOM 只是这个模型的渲染面：结构性修改先算模型、再整面重渲——
// contenteditable 的四个已知 quirk（design §2「不允许侥幸」）因此各有单一收口：
//   ① 粘贴净化：paste/drop 拦截后只经 insertPlainText 进纯文本；
//   ② IME 组合态：组合期的跨卡片删除在 beforeinput 被拦下（面板层）；
//   ③ 撤销栈：自管 blocks 快照（时间聚簇），原生 historyUndo/Redo 显式禁用；
//   ④ 新块归一化：一切入口（含粘贴多行、浏览器自身造块）都落成 paragraph 块，
//     裸 div/br 不进数据层（normalize + readBlocks 收口）。
// 本层纯函数无 DOM 依赖，tests/unit 零 DOM 环境直接驱动（tests/unit/README.md）。
// ---------------------------------------------------------------------------

/** 光标 / 选区端点：block = 块下标，offset = 段落文本的 UTF-16 偏移（与 DOM Selection
 *  同口径）；端点落在卡片等非文本块时 offset 恒 0（该块前缘）。「卡片后缘」用下一块的
 *  前缘表达。 */
export interface ComposerCaret {
  block: number;
  offset: number;
}

export interface ComposerSelection {
  anchor: ComposerCaret;
  focus: ComposerCaret;
}

function caretCompare(a: ComposerCaret, b: ComposerCaret): number {
  return a.block !== b.block ? a.block - b.block : a.offset - b.offset;
}

function isQuote(block: ComposerBlock): boolean {
  return block.kind === "quote";
}

/**
 * 光标处拆段插入卡片（design §5 装配合同 + Alex 2026-10-06 裁决：插入后光标落到卡片
 * 下一行的问题段落——该处已有段落复用、否则新建）：
 * - 光标在段落中间：段落从光标处拆两段，卡片插两段之间，光标落第二段段首；
 * - 光标在段落起始：卡片插在该段落之前，光标落原段落段首；
 * - 光标在段落末尾：卡片插在段落之后，随后补一个空段落承接光标（末尾已有空段落则复用——
 *   空段落末尾即「段落起始」分支，天然复用）；
 * - 光标在卡片前缘：卡片插在其前，其后补空段落承接光标。
 */
export function insertCardAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
  card: QuoteCard,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  const at = Math.max(0, Math.min(caret.block, blocks.length));
  const target = blocks[at];
  const quote: ComposerBlock = { kind: "quote", card };
  const emptyPara: ComposerBlock = { kind: "paragraph", text: "" };
  if (target !== undefined && isQuote(target)) {
    const next: ComposerBlock[] = [...blocks.slice(0, at), quote, emptyPara, ...blocks.slice(at)];
    return { blocks: next, caret: { block: at + 1, offset: 0 } };
  }
  const text = target?.kind === "paragraph" ? target.text : "";
  const offset = target === undefined ? 0 : Math.max(0, Math.min(caret.offset, text.length));
  if (offset === 0) {
    // 段落起始 / 空段落 / composer 末尾的空追加：卡片在前，原段落（或新空段落）承接光标。
    const rest: ComposerBlock[] = target === undefined ? [emptyPara] : blocks.slice(at);
    const next: ComposerBlock[] = [...blocks.slice(0, at), quote, ...rest];
    return { blocks: next, caret: { block: at + 1, offset: 0 } };
  }
  const before = blocks.slice(0, at);
  const after = blocks.slice(at + 1);
  if (offset >= text.length) {
    // 段落末尾（非空）：保留原段落，卡片在后，新空段落承接光标。
    const next: ComposerBlock[] = [...before, target!, quote, emptyPara, ...after];
    return { blocks: next, caret: { block: at + 2, offset: 0 } };
  }
  // 段落中间：拆两段，卡片居中，光标落第二段段首（复用卡片下一行的段落）。
  const head: ComposerBlock = { kind: "paragraph", text: text.slice(0, offset) };
  const tail: ComposerBlock = { kind: "paragraph", text: text.slice(offset) };
  const next = [...before, head, quote, tail, ...after];
  return { blocks: next, caret: { block: at + 2, offset: 0 } };
}

/** 移除一个块（卡片 × 钮的公共件）：光标落被删块的前一个文本块末尾（无前者则后继块前缘）。 */
export function removeBlockAt(
  blocks: readonly ComposerBlock[],
  at: number,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  const index = Math.max(0, Math.min(at, blocks.length - 1));
  const next = blocks.filter((_, i) => i !== index);
  if (next.length === 0) return { blocks: [{ kind: "paragraph", text: "" }], caret: { block: 0, offset: 0 } };
  // 光标优先贴被删块的前一个块；它在原下标 index-1 处（next 比 blocks 短一个）。
  const prev = index > 0 ? next[index - 1] : undefined;
  if (prev !== undefined && prev.kind === "paragraph") {
    return { blocks: next, caret: { block: index - 1, offset: prev.text.length } };
  }
  return { blocks: next, caret: { block: Math.min(index, next.length - 1), offset: 0 } };
}

/**
 * 在光标处插入纯文本（粘贴净化的唯一数据入口，quirk ①）：\n 拆出新段落块
 * （新块一律是 paragraph——quirk ④ 的模型侧保证），光标落插入文本末尾。
 * 光标在卡片前缘时视为在该处有一个空段落。
 */
export function insertPlainTextAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
  text: string,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  const at = Math.max(0, Math.min(caret.block, blocks.length));
  const target = blocks[at];
  const current = target?.kind === "paragraph" ? target.text : "";
  const offset = target?.kind === "paragraph" ? Math.max(0, Math.min(caret.offset, current.length)) : 0;
  const segments = text.split("\n");
  const prefix = current.slice(0, offset);
  const suffix = current.slice(offset);
  // 首段接前缀、末段接后缀；中间段原样——\n 两侧的内容因此都守恒。
  const replacements: ComposerBlock[] = segments.map((segment, i) => ({
    kind: "paragraph",
    text: (i === 0 ? prefix : "") + segment + (i === segments.length - 1 ? suffix : ""),
  }));
  const next = [...blocks.slice(0, at), ...replacements, ...blocks.slice(at + 1)];
  const caretBlock = at + replacements.length - 1;
  const caretOffset = (segments.length === 1 ? prefix.length : 0) + segments[segments.length - 1].length;
  return { blocks: next, caret: { block: caretBlock, offset: caretOffset } };
}

/** ⇧Enter 软换行：段内插 \n（不拆块），光标前进一格。光标在卡片前缘时落到前一个文本块。 */
export function insertSoftBreakAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  const at = Math.max(0, Math.min(caret.block, blocks.length - 1));
  const target = blocks[at];
  if (target === undefined || target.kind !== "paragraph") {
    // 卡片前缘：找前一个段落贴末插软换行；没有前段落则不动作（保持模型稳定）。
    for (let i = at - 1; i >= 0; i -= 1) {
      if (blocks[i].kind === "paragraph") {
        const text = (blocks[i] as { text: string }).text;
        const next = blocks.slice() as ComposerBlock[];
        next[i] = { kind: "paragraph", text: `${text}\n` };
        return { blocks: next, caret: { block: i, offset: text.length + 1 } };
      }
    }
    return { blocks: [...blocks], caret };
  }
  const offset = Math.max(0, Math.min(caret.offset, target.text.length));
  const next = blocks.slice() as ComposerBlock[];
  next[at] = { kind: "paragraph", text: `${target.text.slice(0, offset)}\n${target.text.slice(offset)}` };
  return { blocks: next, caret: { block: at, offset: offset + 1 } };
}

/** 删除选区（跨块安全）：区间内的卡片整块移除，两端段落按端点截断保留。 */
export function deleteSelectionRange(
  blocks: readonly ComposerBlock[],
  selection: ComposerSelection,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  const ordered =
    caretCompare(selection.anchor, selection.focus) <= 0
      ? selection
      : { anchor: selection.focus, focus: selection.anchor };
  const { anchor, focus } = ordered;
  if (anchor.block === focus.block) {
    const target = blocks[anchor.block];
    if (target === undefined || target.kind !== "paragraph") return { blocks: [...blocks], caret: anchor };
    const from = Math.min(anchor.offset, focus.offset);
    const to = Math.max(anchor.offset, focus.offset);
    const next = blocks.slice() as ComposerBlock[];
    next[anchor.block] = {
      kind: "paragraph",
      text: target.text.slice(0, from) + target.text.slice(to),
    };
    return { blocks: next, caret: { block: anchor.block, offset: from } };
  }
  const next: ComposerBlock[] = [];
  for (let i = 0; i < anchor.block; i += 1) next.push(blocks[i]);
  const head = blocks[anchor.block];
  if (head?.kind === "paragraph") {
    next.push({ kind: "paragraph", text: head.text.slice(0, Math.min(anchor.offset, head.text.length)) });
  }
  // anchor 与 focus 之间的块（含 anchor 处的卡片、focus 处的卡片）整块移除。
  const tail = blocks[focus.block];
  if (tail?.kind === "paragraph") {
    next.push({ kind: "paragraph", text: tail.text.slice(Math.min(focus.offset, tail.text.length)) });
  }
  for (let i = focus.block + 1; i < blocks.length; i += 1) next.push(blocks[i]);
  const caret: ComposerCaret =
    head?.kind === "paragraph"
      ? { block: anchor.block, offset: head.text.slice(0, Math.min(anchor.offset, head.text.length)).length }
      : { block: anchor.block, offset: 0 };
  return { blocks: next.length === 0 ? [{ kind: "paragraph", text: "" }] : next, caret };
}

/** 退格（模型侧，删除按整体作用的卡片语义）：段内删字符；段首遇卡片整块删、遇段落则合并。 */
export function backspaceAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
): { blocks: ComposerBlock[]; caret: ComposerCaret } | null {
  const at = Math.max(0, Math.min(caret.block, blocks.length - 1));
  const target = blocks[at];
  if (target === undefined) return null;
  if (target.kind === "quote") {
    // 光标在卡片前缘（= 上一块之后）：退格作用于**前一块**——前块是卡片则整块删，
    // 是段落则删其末字符（光标落段落末尾）；块首则无物可删。
    if (at === 0) return null;
    const prev = blocks[at - 1];
    if (prev.kind === "quote") {
      const next = blocks.slice() as ComposerBlock[];
      next.splice(at - 1, 1);
      return { blocks: next, caret: { block: at - 1, offset: 0 } };
    }
    return backspaceAtCaret(blocks, { block: at - 1, offset: prev.text.length });
  }
  if (caret.offset > 0) {
    // 代理对（emoji 等）整体删：偏移落在低代理上时多退一格。
    let cut = caret.offset - 1;
    const ch = target.text.charCodeAt(cut);
    if (ch >= 0xdc00 && ch <= 0xdfff && cut > 0) cut -= 1;
    const next = blocks.slice() as ComposerBlock[];
    next[at] = { kind: "paragraph", text: target.text.slice(0, cut) + target.text.slice(caret.offset) };
    return { blocks: next, caret: { block: at, offset: cut } };
  }
  if (at === 0) return null;
  const prev = blocks[at - 1];
  const next = blocks.slice() as ComposerBlock[];
  if (prev.kind === "quote") {
    // 卡片按整体作用：整块移除，光标留在当前段落段首。
    next.splice(at - 1, 1);
    return { blocks: next, caret: { block: at - 1, offset: 0 } };
  }
  const merged = prev.text + target.text;
  next.splice(at - 1, 2, { kind: "paragraph", text: merged });
  return { blocks: next, caret: { block: at - 1, offset: prev.text.length } };
}

/** 前向删除（Delete 键）：光标在卡片前缘 = 整块删该卡片；段内删字符；段末遇段落则合并。 */
export function deleteForwardAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
): { blocks: ComposerBlock[]; caret: ComposerCaret } | null {
  const at = Math.max(0, Math.min(caret.block, blocks.length - 1));
  const target = blocks[at];
  if (target === undefined) return null;
  if (target.kind === "quote") {
    const next = blocks.slice() as ComposerBlock[];
    next.splice(at, 1);
    return { blocks: next.length === 0 ? [{ kind: "paragraph", text: "" }] : next, caret: { block: at, offset: 0 } };
  }
  if (caret.offset < target.text.length) {
    let end = caret.offset + 1;
    const ch = target.text.charCodeAt(caret.offset);
    if (ch >= 0xd800 && ch <= 0xdbff && end < target.text.length) end += 1;
    const next = blocks.slice() as ComposerBlock[];
    next[at] = { kind: "paragraph", text: target.text.slice(0, caret.offset) + target.text.slice(end) };
    return { blocks: next, caret };
  }
  const nxt = blocks[at + 1];
  if (nxt === undefined) return null;
  const next = blocks.slice() as ComposerBlock[];
  if (nxt.kind === "quote") {
    next.splice(at + 1, 1);
    return { blocks: next, caret };
  }
  const merged = target.text + nxt.text;
  next.splice(at, 2, { kind: "paragraph", text: merged });
  return { blocks: next, caret };
}

// ── 撤销栈历史（quirk ③ 的自管核心；导出供单测用假时钟驱动复现链） ──────────

export interface UndoHistory<T> {
  /** 修改前调用：任何新编辑都先作废旧 redo（先于聚簇早退），再按聚簇/去重决定是否压栈。 */
  push(snapshot: T, force: boolean): void;
  /** 撤销：传入当前态、返回要应用的前态（null = 无物可弹）。 */
  undo(current: T): T | null;
  /** 重做：传入当前态、返回要应用的后态（null = 无物可重做）。 */
  redo(current: T): T | null;
  /** 强制下一拍重新成簇（IME 组合结束：整段组合是一个撤销步）。 */
  breakCluster(): void;
  /** 整栈清空（发送 / 切 vault：草稿是新的编辑史）。 */
  clear(): void;
  readonly size: number;
  readonly redoSize: number;
}

/**
 * 自管撤销栈（浏览器原生 undo 对 DOM 干预不可靠——design §2 quirk ③）。聚簇：clusterMs
 * 内的连续编辑共用一个前态（force 跳过聚簇）；去重：栈顶同态不压（no-op 不产生幽灵步）。
 * 两条正确性纪律（P2-1，快撤销快重打复现链）：
 *   1. redo 的作废**先于**聚簇早退——聚簇跳过的编辑同样是新编辑，旧 redo 不得残留；
 *   2. undo/redo 重置簇计时——撤销后的下一次编辑强制成新簇，永不成「撤销不掉的编辑」。
 */
export function createUndoHistory<T>(options: {
  now: () => number;
  clusterMs?: number;
  limit?: number;
  equals?: (a: T, b: T) => boolean;
}): UndoHistory<T> {
  const clusterMs = options.clusterMs ?? 1000;
  const limit = options.limit ?? 100;
  const equals = options.equals ?? ((a: T, b: T) => JSON.stringify(a) === JSON.stringify(b));
  let stack: T[] = [];
  let redoStack: T[] = [];
  let lastEditAt = 0;
  return {
    push(snapshot, force) {
      redoStack = []; // 纪律 1：任何新编辑先作废旧 redo。
      const at = options.now();
      if (!force && at - lastEditAt < clusterMs) {
        lastEditAt = at;
        return;
      }
      const top = stack[stack.length - 1];
      if (top !== undefined && equals(top, snapshot)) {
        lastEditAt = at;
        return;
      }
      stack.push(snapshot);
      if (stack.length > limit) stack.shift();
      lastEditAt = at;
    },
    undo(current) {
      const snap = stack.pop();
      if (snap === undefined) return null;
      redoStack.push(current);
      lastEditAt = 0; // 纪律 2：撤销后的下一次编辑强制成新簇。
      return snap;
    },
    redo(current) {
      const snap = redoStack.pop();
      if (snap === undefined) return null;
      stack.push(current);
      lastEditAt = 0;
      return snap;
    },
    breakCluster() {
      lastEditAt = 0;
    },
    clear() {
      stack = [];
      redoStack = [];
      lastEditAt = 0;
    },
    get size() {
      return stack.length;
    },
    get redoSize() {
      return redoStack.length;
    },
  };
}

// ── 序列化消息的解析（transcript 快照恢复用） ──────────────────────────────

/** XML 实体单次左到右消解（&amp; 先不解，避免把 &amp;lt; 解成 <——那是用户原文 "&lt;"）。
 *  String.replace 的函数形式对每次匹配只消费一次，链式转义（&amp;amp;）因此正确收敛。 */
export function unescapeXmlEntities(value: string): string {
  const table: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };
  return value.replace(/&(amp|lt|gt|quot);/g, (_match, entity: string) => table[entity] ?? _match);
}

const QUOTE_OPEN_RE = /^<quote file="([^"]*)" heading="([^"]*)" lines="([^"]*)">/;

/**
 * 把序列化消息（serializeQuoteMessage 的产物，design §3）解析回块序列——快照恢复
 * （webview 重载 / 切 vault 回填）时 transcript 同构呈现用。格式的可解析性由序列化侧
 * 的不变量保证：属性值与文本节点转义 ⇒ 输出里的裸 `<quote ` 行首与 `</quote>` 只可能是
 * 真标签；连续非引用行合并为一个段落（软换行段落与多段落序列化同形，视觉等价）。
 * 解析宽容：不成形的行按段落落地，不抛错打断快照恢复。
 */
export function parseQuoteMessage(text: string): ComposerBlock[] {
  const blocks: ComposerBlock[] = [];
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const open = QUOTE_OPEN_RE.exec(line);
    if (open !== null) {
      const start = i;
      let body = line.slice(open[0].length);
      let end = body.indexOf("</quote>");
      while (end === -1 && i + 1 < lines.length) {
        i += 1;
        body += `\n${lines[i]}`;
        end = body.indexOf("</quote>");
      }
      if (end === -1) {
        // 没有闭合标签：不是合法引用行——吃掉的原样吐回（内容守恒），按段落落地。
        blocks.push({ kind: "paragraph", text: lines.slice(start, i + 1).join("\n") });
        i += 1;
        continue;
      }
      const excerpt = body.slice(0, end);
      blocks.push({
        kind: "quote",
        card: {
          file: unescapeXmlEntities(open[1]),
          heading: unescapeXmlEntities(open[2]),
          headingPath: unescapeXmlEntities(open[2]),
          lines: unescapeXmlEntities(open[3]),
          text: unescapeXmlEntities(excerpt),
        },
      });
      i += 1;
      continue;
    }
    const paragraphLines = [line];
    i += 1;
    while (i < lines.length && QUOTE_OPEN_RE.test(lines[i]) === false) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Markdown → DOM（零 XSS：纯 DOM API + textContent；解析器 = @lezer/markdown 的 GFM 配置）
// ---------------------------------------------------------------------------

const mdParser = commonmarkParser.configure([GFM]);

/** @lezer/common 不是直接依赖，SyntaxNode 类型从解析器返回值派生。 */
type MdSyntaxNode = ReturnType<typeof mdParser.parse>["topNode"];

/** 不产出的节点：各类「标记」（** 的星号、代码围栏的 ```、链接的 []()、引用的 > 等）与
 *  链接定义行。它们是有名子节点，跳过即可；节点之间的纯文本由间隙填充承担（见
 *  renderInlineChildren——lezer 不给纯文本包节点，有名子节点之间的区间就是文本）。 */
const SKIP_NODES = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "LinkMark",
  "LinkTitle",
  "URL",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "LinkReference",
  "Comment",
]);

function textOf(doc: string, node: MdSyntaxNode): string {
  return doc.slice(node.from, node.to);
}

/** 行内渲染：有名子节点逐个交给 renderInlineNode，节点间隙是纯文本直接落地。 */
function renderInlineChildren(container: HTMLElement, node: MdSyntaxNode, doc: string): void {
  let pos = node.from;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.from > pos) container.append(document.createTextNode(doc.slice(pos, child.from)));
    renderInlineNode(container, child, doc);
    pos = Math.max(pos, child.to);
  }
  if (node.to > pos) container.append(document.createTextNode(doc.slice(pos, node.to)));
}

function renderInlineNode(container: HTMLElement, node: MdSyntaxNode, doc: string): void {
  switch (node.name) {
    case "Emphasis": {
      const el = document.createElement("em");
      container.append(el);
      renderInlineChildren(el, node, doc);
      return;
    }
    case "StrongEmphasis": {
      const el = document.createElement("strong");
      container.append(el);
      renderInlineChildren(el, node, doc);
      return;
    }
    case "Strikethrough": {
      const el = document.createElement("s");
      container.append(el);
      renderInlineChildren(el, node, doc);
      return;
    }
    case "InlineCode": {
      // 类名与编辑器行内代码同源（cm-lp-inline-code）：镜像的 preview 主题把同一颗
      // 药丸样式带进来，面板与正文读起来是同一个东西（REVIEW.md 第 8 条：不另造第二套）。
      const el = document.createElement("code");
      el.className = "cm-lp-inline-code";
      const codeText = node.getChild("CodeText");
      el.textContent = codeText !== null ? textOf(doc, codeText) : textOf(doc, node).replace(/^`|`$/g, "");
      container.append(el);
      return;
    }
    case "Link":
    case "Autolink": {
      const urlNode = node.getChild("URL");
      const href = urlNode !== null ? textOf(doc, urlNode) : "";
      const el = document.createElement("a");
      el.className = "lumir-hp-link";
      // href 只作展示与 title，导航一律被拦下交给 openExternalUrl（scheme 白名单在
      // Rust 侧判定，前端不自行判能不能开——与编辑器内外链同一条信任边界）。
      el.href = href;
      el.title = href;
      el.addEventListener("click", (event) => {
        event.preventDefault();
        if (href !== "") openExternalUrl(href).catch(() => {});
      });
      if (node.name === "Autolink") {
        el.textContent = textOf(doc, node).replace(/^<|>$/g, "");
      } else {
        renderInlineChildren(el, node, doc);
      }
      container.append(el);
      return;
    }
    case "Image": {
      // 不加载模型给出的图片 URL（隐私与 CSP 双重考量）：按转义文本展示引用原文。
      container.append(document.createTextNode(textOf(doc, node)));
      return;
    }
    case "HardBreak": {
      container.append(document.createElement("br"));
      return;
    }
    case "Escape": {
      // Escape 节点覆盖 `\x` 两个字符，上屏的是被转义的那个字符。
      container.append(document.createTextNode(doc.slice(node.from + 1, node.to)));
      return;
    }
    default: {
      if (SKIP_NODES.has(node.name)) return;
      if (node.firstChild !== null) {
        renderInlineChildren(container, node, doc);
      } else {
        container.append(document.createTextNode(textOf(doc, node)));
      }
    }
  }
}

/** 代码块（围栏 / 缩进共用）：highlightCode 出 token，span + cm-lp-tok-* 类（与编辑器
 *  代码块同一张 role 表、同一份色值——镜像 scope 后 theme.ts 的规则直接命中）。 */
function buildCodeBlock(code: string, info: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.className = "lumir-hp-codeblock";
  const codeEl = document.createElement("code");
  pre.append(codeEl);
  const tokens = highlightCode(code, info);
  let pos = 0;
  for (const token of tokens) {
    if (token.from > pos) codeEl.append(document.createTextNode(code.slice(pos, token.from)));
    const span = document.createElement("span");
    span.className = token.cls;
    span.textContent = code.slice(token.from, token.to);
    codeEl.append(span);
    pos = token.to;
  }
  if (code.length > pos) codeEl.append(document.createTextNode(code.slice(pos)));
  return pre;
}

/** 块级渲染：top-level 节点 → 块元素。不认识的块按转义文本段落落地（可见但惰性）。 */
function renderBlock(container: HTMLElement, node: MdSyntaxNode, doc: string): void {
  const heading = /^ATXHeading([1-6])$/.exec(node.name);
  if (heading !== null || node.name === "SetextHeading1" || node.name === "SetextHeading2") {
    const level = heading !== null ? heading[1] : node.name === "SetextHeading1" ? "1" : "2";
    const el = document.createElement(`h${level}`);
    renderInlineChildren(el, node, doc);
    container.append(el);
    return;
  }
  switch (node.name) {
    case "Paragraph": {
      const el = document.createElement("p");
      renderInlineChildren(el, node, doc);
      container.append(el);
      return;
    }
    case "BulletList":
    case "OrderedList": {
      const el = document.createElement(node.name === "BulletList" ? "ul" : "ol");
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.name !== "ListItem") continue;
        const li = document.createElement("li");
        for (let item = child.firstChild; item !== null; item = item.nextSibling) {
          if (item.name === "TaskMarker") {
            const marker = document.createElement("span");
            marker.className = "lumir-hp-task";
            marker.textContent = textOf(doc, item);
            li.append(marker, document.createTextNode(" "));
            continue;
          }
          renderBlock(li, item, doc);
        }
        el.append(li);
      }
      container.append(el);
      return;
    }
    case "Blockquote": {
      const el = document.createElement("blockquote");
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        renderBlock(el, child, doc);
      }
      container.append(el);
      return;
    }
    case "FencedCode": {
      const infoNode = node.getChild("CodeInfo");
      const textNode = node.getChild("CodeText");
      container.append(
        buildCodeBlock(
          textNode !== null ? textOf(doc, textNode) : "",
          infoNode !== null ? textOf(doc, infoNode).trim() : "",
        ),
      );
      return;
    }
    case "CodeBlock": {
      container.append(buildCodeBlock(textOf(doc, node), ""));
      return;
    }
    case "Table": {
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        if (child.name === "TableDelimiter") continue;
        const row = document.createElement("tr");
        const cellTag = child.name === "TableHeader" ? "th" : "td";
        for (let cell = child.firstChild; cell !== null; cell = cell.nextSibling) {
          if (cell.name !== "TableCell") continue;
          const td = document.createElement(cellTag);
          renderInlineChildren(td, cell, doc);
          row.append(td);
        }
        (child.name === "TableHeader" ? thead : tbody).append(row);
      }
      if (thead.childElementCount > 0) table.append(thead);
      if (tbody.childElementCount > 0) table.append(tbody);
      container.append(table);
      return;
    }
    case "HorizontalRule": {
      container.append(document.createElement("hr"));
      return;
    }
    case "HTMLBlock":
    case "CommentBlock": {
      // 模型输出里的 HTML：转义成文本展示（MUST NOT 直插 HTML——它永不解析成标记）。
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-codeblock lumir-hp-rawhtml";
      pre.textContent = textOf(doc, node);
      container.append(pre);
      return;
    }
    default: {
      if (SKIP_NODES.has(node.name)) return;
      if (node.name === "Document") {
        let child = node.firstChild;
        while (child !== null) {
          renderBlock(container, child, doc);
          child = child.nextSibling;
        }
        return;
      }
      const el = document.createElement("p");
      el.textContent = textOf(doc, node);
      container.append(el);
    }
  }
}

/** 一段完整 Markdown → 追加渲染到容器（多块）。 */
function renderMarkdownInto(container: HTMLElement, source: string): void {
  const tree = mdParser.parse(source);
  renderBlock(container, tree.topNode, source);
}

/**
 * 流式源 → 「已完成块 / 进行中尾块」切分：块边界 = 代码围栏之外的空行。围栏内（``` / ~~~
 * 之间）的空行不是边界——那是代码的一部分。返回 finalized（可安全一次性渲染、渲染后不
 * 再变）与 tail（每帧重渲）的分界偏移。
 */
function finalizedUpTo(source: string): number {
  let inFence: string | null = null;
  let boundary = 0;
  let offset = 0;
  for (const line of source.split("\n")) {
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence !== null) {
      if (inFence === null) inFence = fence[1][0];
      else if (fence[1][0] === inFence) inFence = null;
    } else if (inFence === null && line.trim() === "") {
      // +1 把空行本身吃进 finalized：末块从重渲区里整段退出。
      boundary = offset + line.length + 1;
    }
    offset += line.length + 1;
  }
  return boundary;
}

// ---------------------------------------------------------------------------
// 面板本体
// ---------------------------------------------------------------------------

/** 待决批准项的已存数据（relabel 时据此重渲，不丢按钮状态）。 */
interface PendingApproval {
  id: string;
  tool: string;
  diff?: string | undefined;
  argv?: string | undefined;
  element: HTMLElement;
}

export function createHarnessPanel(deps: HarnessPanelDeps): HarnessPanelHandle {
  const { shell, editor } = deps;

  // ── DOM：toggle 钮（标题栏动作钮槽位，钉右端；HP1 起产品标识块在 traffic 灯区，
  // 右端只有这颗钮）─────────────────────────────────────────────────────────
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "titlebar-action lumir-hp-toggle";
  toggleButton.setAttribute("aria-pressed", "false");
  // 本钮不需要 mousedown preventDefault：click 后经 deps.togglePane 交装配层开合（焦点移交
  // 在那一边），按钮瞬时持焦无所谓；「别抢焦点」的 preventDefault 若真需要，
  // MUST NOT 挂容器级元素（REVIEW.md 第 16 条）。
  shell.titlebar.append(toggleButton);

  // ── DOM：标题栏 harness 段（.lumir-hp-seg，HP1，Alex 点子 1）────────────────
  // 面板不再有头部栏：会话身份（名下拉）与新建会话钮上移进标题栏，与编辑器 pane 的标签段
  // 同构。段是长驻元素（hidden 随 attach 状态翻），装配层在 harness pane 分栏时插进标题栏
  // 并管宽度（flexGrow 与 pane 同一份 splitRatio——段边界与分隔条像素对齐）。
  const seg = document.createElement("div");
  seg.className = "lumir-hp-seg";
  seg.setAttribute("role", "group");
  seg.hidden = true;
  const sessionButton = document.createElement("button");
  sessionButton.type = "button";
  sessionButton.className = "lumir-hp-session";
  const sname = document.createElement("span");
  sname.className = "lumir-hp-sname";
  const schev = document.createElement("span");
  schev.className = "lumir-hp-schev";
  schev.setAttribute("aria-hidden", "true");
  schev.textContent = "▾";
  sessionButton.append(sname, schev);
  const segNew = document.createElement("button");
  segNew.type = "button";
  segNew.className = "lumir-hp-seg-new";
  const segNewPlus = document.createElement("span");
  segNewPlus.className = "lumir-hp-plus";
  segNewPlus.setAttribute("aria-hidden", "true");
  segNewPlus.textContent = "＋"; // i18n-exempt: glyph（全角加号图形，非文案）
  const segNewLabel = document.createElement("span");
  segNew.append(segNewPlus, segNewLabel);
  seg.append(sessionButton, segNew);
  // 会话浮层（节点 1 裁决后口径）：只含「新建会话」一个动作项，不列历史会话。
  const sessPop = document.createElement("div");
  sessPop.className = "lumir-hp-sesspop";
  sessPop.hidden = true;
  const sessPopItem = document.createElement("button");
  sessPopItem.type = "button";
  sessPopItem.className = "lumir-hp-sesspop-item";
  const popPlus = document.createElement("span");
  popPlus.className = "lumir-hp-plus";
  popPlus.setAttribute("aria-hidden", "true");
  popPlus.textContent = "＋"; // i18n-exempt: glyph（全角加号图形，非文案）
  const popLabel = document.createElement("span");
  sessPopItem.append(popPlus, popLabel);
  sessPop.append(sessPopItem);
  sessionButton.append(sessPop); // 浮层锚在会话名钮内（absolute 定位的包含块）
  // 段进标题栏（toggle 钮之前；hidden 长驻，在场与否随 attach 状态翻）——装配层只管宽度
  //（applySplitRatio 把它当 harness pane 的标题栏槽设 flexGrow）。
  shell.titlebar.insertBefore(seg, toggleButton);

  // ── DOM：面板本体（pane 内容件；挂载目标由装配层经 attachTo 给，dock 列已移除）──
  const panel = document.createElement("aside");
  panel.className = "lumir-harness";
  panel.hidden = true;

  // HP1：头部栏整条上移进标题栏 harness 段（见上方 .lumir-hp-seg），面板本体从 transcript
  // 开始；ctx% 读数与常驻警示句随头部栏退场（读数迁入 composer 控制行是后续 mission 的面）。

  const transcript = document.createElement("div");
  transcript.className = "lumir-hp-transcript";
  // preview 主题 scope 镜像：cm-lp-tok-* 着色与 cm-lp-inline-code 药丸的规则值只定义在
  // src/preview/theme.ts 一处，这里只搬 scope 类（机制与守卫见 src/overlay-scope.ts）。
  mirrorThemeScope(editor.view.dom, transcript, "lumir-hp-transcript");

  const emptyHint = document.createElement("div");
  emptyHint.className = "lumir-hp-empty";

  const chip = document.createElement("div");
  chip.className = "lumir-hp-chip";

  const composerRow = document.createElement("div");
  composerRow.className = "lumir-hp-composer-row";

  // 混排编辑区（M343，change add-harness-quote-cards design §2/§5）：contenteditable div 取代
  // textarea，全 composer 唯一形态——顶层仅 .lumir-hp-qcard（原子卡片）/ .lumir-hp-qpara
  // （问题段落）两类块；无卡片时退化为纯文本输入。数据层 = 本文件头部纯模型层的块序列，
  // 序列化投递走 M342 的 serializeQuoteMessage。
  const composer = document.createElement("div");
  composer.className = "lumir-hp-composer";
  composer.contentEditable = "true";
  composer.setAttribute("role", "textbox");
  composer.setAttribute("aria-multiline", "true");
  composer.spellcheck = false;
  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "lumir-hp-send";
  composerRow.append(composer, sendButton);

  panel.append(transcript, chip, composerRow);

  // ── 状态 ─────────────────────────────────────────────────────────────────
  /** 面板挂载的 pane 槽（null = 收起/未开）。pane 在场与否由装配层管，面板只记录挂在哪。 */
  let mountEl: HTMLElement | null = null;
  let busy = false;
  let lastChip: HarnessContextBlock | null | "none" = null;
  /** 当前逻辑会话的首条用户消息原文（会话名口径：截断约 20 字上屏；null = 未发消息，
   *  显示「新会话」）。自动压缩开新逻辑会话后归 null，按同口径重算（design §3）。 */
  let firstUserText: string | null = null;
  let streamingEl: HTMLElement | null = null;
  let streamingText = "";
  /** 流式消息里已完成块已渲染到的源偏移（增量渲染的游标）。 */
  let renderedFinalized = 0;
  let tailEl: HTMLElement | null = null;
  let chunkBuffer = "";
  let flushScheduled = false;
  const pendingApprovals = new Map<string, PendingApproval>();
  let lastToolEl: HTMLElement | null = null;
  /** 当前 vault 根路径（会话作用域基准：事件过滤与快照准入都用它；null = 尚未装载 vault）。
   *  由装配层在每次装载 vault 后经 `vaultChanged` 传入（src/main.ts 的 applyVault）。 */
  let currentVault: string | null = null;
  /** 快照请求的世代号：只应用**最新一次**请求的结果。挂载那一次拉取与切 vault 的那一次可能
   *  同时在飞——迟到的旧响应会把已经清空的 transcript 又灌回旧 vault 的消息，或把同一份
   *  消息追加两遍（两条都是可见的错乱）。 */
  let snapshotSeq = 0;

  // ── 混排 composer 状态（M343） ────────────────────────────────────────────
  /** 卡片数据寄存：DOM 只负责渲染，卡片数据（单一真源，design §3）经 WeakMap 挂回元素——
   *  序列化只从模型读，不从 DOM 反推。 */
  const cardData = new WeakMap<Element, QuoteCard>();
  /** 撤销栈（quirk ③：自管 blocks 快照；原生 historyUndo/Redo 在 beforeinput 显式禁用）。
   *  去重只比 blocks（光标位置不构成新编辑步）。 */
  interface ComposerSnapshot {
    blocks: ComposerBlock[];
    caret: ComposerCaret | null;
  }
  const undoHistory = createUndoHistory<ComposerSnapshot>({
    now: () => Date.now(),
    equals: (a, b) => JSON.stringify(a.blocks) === JSON.stringify(b.blocks),
  });
  /** 归一化的重入闸（normalize 自己改 DOM，触发观察器时不再递归）。 */
  let normalizing = false;
  /** QC3（M344）注册的卡片跳回处理器；未注册时卡片点击无操作。 */
  let quoteJumpHandler: ((card: QuoteCard) => void) | null = null;

  // ── 混排 composer：DOM 层（渲染 / 读模型 / 光标 / 归一化） ──────────────────
  // 纪律：结构性修改一律「normalize → 读模型 → 纯函数算新模型 → 整面重渲」，typed 文本才
  // 交给浏览器原生处理（内容始终落在 .qpara 内）。卡片 DOM 只渲染 cardData 里的数据。

  /** 段落块的读取口径：textContent + <br> 记 \n（浏览器原生路径可能留下 br）。 */
  function paraTextOf(el: Element): string {
    let out = "";
    const walk = (node: Node): void => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent ?? "";
      } else if (node.nodeName === "BR") {
        out += "\n";
      } else {
        node.childNodes.forEach(walk);
      }
    };
    el.childNodes.forEach(walk);
    return out;
  }

  function createParaEl(text: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "lumir-hp-qpara";
    el.textContent = text;
    return el;
  }

  /** 出处行（文档名 · 最近一级标题；摘录在首个标题之前时仅文档名——裁决点 7）。 */
  function cardSourceText(card: QuoteCard): string {
    const doc = card.file.split("/").pop() ?? card.file;
    return card.heading === "" ? doc : `${doc} · ${card.heading}`;
  }

  /** hover title：完整摘录 + 完整标题链（headingPath 人侧专用字段，design §3）。 */
  function cardHoverTitle(card: QuoteCard): string {
    const chain = card.headingPath !== "" ? card.headingPath : card.heading !== "" ? card.heading : card.file;
    return `${card.text} —— ${chain}`;
  }

  function createCardEl(card: QuoteCard, mode: "composer" | "transcript"): HTMLElement {
    const el = document.createElement("div");
    el.className = "lumir-hp-qcard";
    cardData.set(el, card);
    const bar = document.createElement("span");
    bar.className = "lumir-hp-qc-bar";
    const main = document.createElement("div");
    main.className = "lumir-hp-qc-main";
    const excerpt = document.createElement("div");
    excerpt.className = "lumir-hp-qc-ex";
    excerpt.textContent = card.text;
    const source = document.createElement("div");
    source.className = "lumir-hp-qc-src";
    source.textContent = cardSourceText(card);
    main.append(excerpt, source);
    el.append(bar, main);
    el.title = cardHoverTitle(card);
    if (mode === "composer") {
      el.contentEditable = "false";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "lumir-hp-qc-x";
      remove.tabIndex = -1;
      remove.setAttribute("aria-label", t("D371"));
      remove.textContent = "×";
      el.append(remove);
      // 卡片点击（× 除外）= 跳回原文（QC3 注册处理器后才生效）；mousedown 拦下是为不让
      // contenteditable=false 的卡片抢走选区/焦点（面板内元素，无标题栏拖拽问题——
      // REVIEW.md 第 16 条只约束标题栏容器）。
      el.addEventListener("mousedown", (event) => event.preventDefault());
      remove.addEventListener("mousedown", (event) => event.stopPropagation());
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = [...composer.children].indexOf(el);
        if (index < 0) return;
        withModel(() => removeBlockAt(readBlocksFromDom(), index), true);
        composer.focus();
      });
      el.addEventListener("click", () => quoteJumpHandler?.(card));
    } else {
      // transcript：同构呈现，无 ×；整块是跳回按钮（键盘可达）。
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-label", `${t("D374")}: ${cardSourceText(card)}`);
      el.addEventListener("click", () => quoteJumpHandler?.(card));
      el.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          quoteJumpHandler?.(card);
        }
      });
    }
    return el;
  }

  /** 当前 composer 内容的模型表示（读取前调用方保证已 normalize）。 */
  function readBlocksFromDom(): ComposerBlock[] {
    const blocks: ComposerBlock[] = [];
    for (const child of composer.children) {
      if (child.classList.contains("lumir-hp-qcard")) {
        const card = cardData.get(child);
        if (card !== undefined) blocks.push({ kind: "quote", card });
      } else {
        blocks.push({ kind: "paragraph", text: paraTextOf(child) });
      }
    }
    return blocks.length === 0 ? [{ kind: "paragraph", text: "" }] : blocks;
  }

  function renderComposer(blocks: readonly ComposerBlock[], caret: ComposerCaret | null): void {
    composer.replaceChildren();
    for (const block of blocks) {
      composer.append(
        block.kind === "quote" ? createCardEl(block.card, "composer") : createParaEl(block.text),
      );
    }
    if (composer.childElementCount === 0) composer.append(createParaEl(""));
    if (caret !== null) setDomCaret(caret);
    updateEmptyClass();
  }

  function updateEmptyClass(): void {
    const empty =
      composer.querySelector(".lumir-hp-qcard") === null && composer.textContent.trim() === "";
    composer.classList.toggle("is-empty", empty);
  }

  /**
   * 归一化（quirk ④）：顶层只允许 .qcard / .qpara 两类块——裸文本、<br>、浏览器自造的
   * div/span 一律折进相邻段落（<br> 记 \n）；收尾保证至少一个段落块。数据层因此永远干净
   * （「不接受裸 <div>/<br> 进数据层」的正面落实）。光标尽量原位保留。
   */
  function normalize(): void {
    if (normalizing) return;
    normalizing = true;
    try {
      const domSelection = caretFromDom();
      const caret = domSelection === null ? null : domSelection.focus;
      let dirty = false;
      for (const child of [...composer.children]) {
        if (child.classList.contains("lumir-hp-qcard")) continue;
        if (child.classList.contains("lumir-hp-qpara") && child.childElementCount === 0) continue;
        const text = paraTextOf(child);
        // 先取相邻引用再摘除（remove 后兄弟指针即失效）。
        const prev = child.previousElementSibling;
        const next = child.nextSibling;
        child.remove();
        dirty = true;
        if (prev !== null && prev.classList.contains("lumir-hp-qpara")) {
          prev.textContent = paraTextOf(prev) + text;
        } else {
          composer.insertBefore(createParaEl(text), next);
        }
      }
      // 顶层游离文本节点（浏览器偶发）折进末尾段落。
      for (const node of [...composer.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "") !== "") {
          const text = node.textContent ?? "";
          node.remove();
          dirty = true;
          const last = composer.lastElementChild;
          if (last instanceof HTMLElement && last.classList.contains("lumir-hp-qpara")) {
            last.textContent = paraTextOf(last) + text;
          } else {
            composer.append(createParaEl(text));
          }
        }
      }
      if (composer.childElementCount === 0) {
        composer.append(createParaEl(""));
        dirty = true;
      }
      if (dirty && caret !== null) setDomCaret(caret);
      if (dirty) updateEmptyClass();
    } finally {
      normalizing = false;
    }
  }

  /** 把 DOM 选区读成模型端点（选区不在 composer 内返回 null）。 */
  function caretFromDom(): ComposerSelection | null {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return null;
    const caretOf = (node: Node | null, domOffset: number): ComposerCaret | null => {
      if (node === null) return null;
      let blockEl = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      while (blockEl !== null && blockEl.parentElement !== composer) {
        blockEl = blockEl.parentElement;
      }
      if (blockEl === null) return null;
      const block = [...composer.children].indexOf(blockEl);
      if (blockEl.classList.contains("lumir-hp-qcard")) return { block, offset: 0 };
      // 段落内字符偏移：累加目标之前的文本（<br> 记 1）。
      let chars = 0;
      let found = false;
      const walk = (current: Node): void => {
        if (found) return;
        if (current === node) {
          if (current.nodeType === Node.TEXT_NODE) chars += domOffset;
          else {
            // 元素内偏移 = 其前 domOffset 个子节点的文本量。
            for (let i = 0; i < Math.min(domOffset, current.childNodes.length); i += 1) {
              const kid = current.childNodes[i];
              chars += kid.nodeType === Node.TEXT_NODE ? (kid.textContent ?? "").length : 1;
            }
          }
          found = true;
          return;
        }
        if (current.nodeType === Node.TEXT_NODE) {
          chars += current.textContent?.length ?? 0;
        } else if (current.nodeName === "BR") {
          chars += 1;
        } else {
          current.childNodes.forEach(walk);
        }
      };
      blockEl.childNodes.forEach(walk);
      return { block, offset: chars };
    };
    const anchor = caretOf(selection.anchorNode, selection.anchorOffset);
    const focus = caretOf(selection.focusNode, selection.focusOffset);
    if (anchor === null || focus === null) return null;
    return { anchor, focus };
  }

  /** 把模型光标写回 DOM（段落内按字符偏移定位；卡片/边界落块前缘）。 */
  function setDomCaret(caret: ComposerCaret): void {
    const children = [...composer.children];
    const range = document.createRange();
    if (children.length === 0) composer.append(createParaEl(""));
    const index = Math.max(0, Math.min(caret.block, composer.children.length - 1));
    const blockEl = [...composer.children][index];
    if (blockEl.classList.contains("lumir-hp-qcard")) {
      range.setStart(composer, index);
    } else {
      const text = paraTextOf(blockEl);
      const offset = Math.max(0, Math.min(caret.offset, text.length));
      if (text.length === 0) {
        range.setStart(blockEl, 0);
      } else {
        let remaining = offset;
        let placed = false;
        const walk = (current: Node): void => {
          if (placed) return;
          if (current.nodeType === Node.TEXT_NODE) {
            const len = current.textContent?.length ?? 0;
            if (remaining <= len) {
              range.setStart(current, remaining);
              placed = true;
            } else {
              remaining -= len;
            }
          } else if (current.nodeName === "BR") {
            if (remaining === 0) {
              range.setStartBefore(current);
              placed = true;
            } else {
              remaining -= 1;
            }
          } else {
            current.childNodes.forEach(walk);
          }
        };
        blockEl.childNodes.forEach(walk);
        if (!placed) range.setStart(blockEl, blockEl.childNodes.length);
      }
    }
    range.collapse(true);
    const selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  // ── 撤销栈（quirk ③：自管快照；原生 undo 显式禁用并登记在 beforeinput 拦截里） ──
  function snapshot(): ComposerSnapshot {
    const sel = caretFromDom();
    return {
      blocks: readBlocksFromDom(),
      caret: sel === null ? null : sel.focus,
    };
  }

  /**
   * 模型修改的统一出口：压撤销栈（修改前态；聚簇/去重/redo 作废纪律见 createUndoHistory）
   * → 算新模型 → 整面重渲。force=true 用于结构性操作（卡片插入/移除、粘贴、拆段、退格），
   * 强制独立成步。
   */
  function withModel(
    op: (blocks: readonly ComposerBlock[]) => { blocks: ComposerBlock[]; caret: ComposerCaret },
    force: boolean,
  ): void {
    normalize();
    undoHistory.push(snapshot(), force);
    const result = op(readBlocksFromDom());
    renderComposer(result.blocks, result.caret);
    refreshChip();
  }

  function undo(): void {
    normalize();
    const snap = undoHistory.undo(snapshot());
    if (snap === null) return;
    renderComposer(snap.blocks, snap.caret);
    refreshChip();
  }

  function redo(): void {
    const snap = undoHistory.redo(snapshot());
    if (snap === null) return;
    renderComposer(snap.blocks, snap.caret);
    refreshChip();
  }

  /**
   * 兜底归一化观察器：我们的拦截覆盖了粘贴 / Enter / 删除 / 拖入，但 IME 替换、拼写纠正、
   * 未来新增路径仍可能自造结构——observer 只负责把漏网的裸块折回 .qpara（数据层不变量
   * 双保险），不触碰卡片。
   */
  const composerObserver = new MutationObserver(() => {
    if (normalizing) return;
    normalize();
  });
  composerObserver.observe(composer, { childList: true, subtree: true });

  // ── 长驻文案施加（onRelabel 的重跑路径：全部从已存状态重取，不重放旧字符串）──
  function applyLabels(): void {
    toggleButton.textContent = t("D326");
    toggleButton.title = t("D327");
    toggleButton.setAttribute("aria-label", t("D327"));
    panel.setAttribute("aria-label", t("D327"));
    seg.setAttribute("aria-label", t("D375"));
    segNewLabel.textContent = t("D330");
    popLabel.textContent = t("D330");
    applySessionName();
    composer.dataset.placeholder = t("D328");
    composer.setAttribute("aria-label", t("D328"));
    sendButton.textContent = t("D329");
    emptyHint.textContent = t("D346");
    applyChip();
    // 待决批准项是交互中的 UI（不是历史记录）：随语言重渲按钮与标题，输入框内容保留。
    for (const pending of pendingApprovals.values()) relabelApproval(pending);
  }

  // ── 会话名（标题栏 harness 段的会话身份；design §3 口径）───────────────────
  /** 会话名截断长度（约 20 字，按码点截断——emoji / CJK 都按 1 字计）。 */
  const SESSION_NAME_MAX = 20;

  /** 从消息块序列取「首条用户消息的原始问题文本」：第一个段落块的文字（XML 序列化前的
   *  原始输入——卡片与序列化标签不作名），空白折叠成单空格。 */
  function firstUserTextOf(blocks: readonly ComposerBlock[]): string | null {
    const para = blocks.find((block) => block.kind === "paragraph" && block.text.trim() !== "");
    if (para === undefined || para.kind !== "paragraph") return null;
    return para.text.replace(/\s+/g, " ").trim();
  }

  function applySessionName(): void {
    if (firstUserText === null) {
      sname.textContent = t("D330"); // 未发消息：「新会话」
      sessionButton.removeAttribute("title");
      return;
    }
    const chars = Array.from(firstUserText);
    sname.textContent =
      chars.length > SESSION_NAME_MAX ? `${chars.slice(0, SESSION_NAME_MAX).join("")}…` : firstUserText;
    sessionButton.title = firstUserText;
  }

  function applyChip(): void {
    if (lastChip === null || lastChip === "none") {
      chip.textContent = t("D333");
      chip.classList.add("is-none");
      return;
    }
    chip.classList.remove("is-none");
    if (lastChip.viewport_range !== undefined) {
      chip.textContent = t("D332", {
        path: lastChip.path,
        from: lastChip.viewport_range.from_line,
        to: lastChip.viewport_range.to_line,
      });
    } else {
      // 消息携带引用卡片：跳过视口注入，自动上下文只剩路径（卡片本身在 composer 内核对）。
      chip.textContent = t("D373", { path: lastChip.path });
    }
  }

  /** composer 里当前是否有引用卡片（决定是否跳过视口注入，spec「携带卡片时跳过视口」）。 */
  function composerHasCards(): boolean {
    return composer.querySelector(".lumir-hp-qcard") !== null;
  }

  /** 上下文 chip 刷新（发送前可核对）：打开面板 / 输入框获焦 / 卡片增减 / 发送后重取。
   *  不挂编辑器选区监听——「发送前」的核对窗口由这几处覆盖，常挂监听是给编辑器热路径
   *  加常驻消费者的反面教材（ADR 0002 §6）。 */
  function refreshChip(): void {
    const block = assembleHarnessContext(editor, { skipViewport: composerHasCards() });
    lastChip = block ?? "none";
    applyChip();
  }

  // ── transcript 追加 ──────────────────────────────────────────────────────
  function scrollToBottom(): void {
    transcript.scrollTop = transcript.scrollHeight;
  }

  function syncEmptyHint(): void {
    if (transcript.childElementCount === 0 && !transcript.contains(emptyHint)) {
      transcript.append(emptyHint);
    } else if (transcript.childElementCount > 1 && transcript.contains(emptyHint)) {
      emptyHint.remove();
    }
  }

  /**
   * 用户消息同构沉淀（add-harness-quote-cards spec「发送后同构沉淀」）：卡片与问题段落
   * 按交错顺序上下排布，卡片无 ×、可点击跳回（QC3 注册处理器后生效）。空段落不渲染
   * （序列化也不产出，视觉与数据同形）。
   */
  function appendUserMessage(blocks: readonly ComposerBlock[]): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-msg lumir-hp-msg-user";
    for (const block of blocks) {
      if (block.kind === "quote") {
        el.append(createCardEl(block.card, "transcript"));
      } else if (block.text !== "") {
        const p = document.createElement("div");
        p.className = "lumir-hp-qtext";
        p.textContent = block.text;
        el.append(p);
      }
    }
    if (el.childElementCount === 0) {
      // 全空消息（理论路径：快照里全是空段落）——沉淀一条空泡，与 Rust 侧留存记录一致。
      el.textContent = "";
    }
    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  function appendToolCall(name: string, status: "started" | "done", summary: string): void {
    if (status === "started" || lastToolEl === null) {
      const el = document.createElement("div");
      el.className = "lumir-hp-tool";
      el.textContent = status === "done" ? t("D344", { name, summary }) : t("D343", { name });
      if (status === "done") el.classList.add("is-done");
      transcript.append(el);
      lastToolEl = status === "started" ? el : null;
    } else {
      lastToolEl.textContent = t("D344", { name, summary });
      lastToolEl.classList.add("is-done");
      lastToolEl = null;
    }
    syncEmptyHint();
    scrollToBottom();
  }

  function appendCompactMarker(summary: string): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-compact";
    const line = document.createElement("div");
    line.className = "lumir-hp-compact-line";
    line.textContent = t("D341");
    const details = document.createElement("details");
    const summaryEl = document.createElement("summary");
    summaryEl.textContent = t("D342");
    const body = document.createElement("div");
    body.className = "lumir-hp-compact-body";
    body.textContent = summary;
    details.append(summaryEl, body);
    el.append(line, details);
    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  function appendError(text: string): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-error";
    el.textContent = text;
    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  // ── 批准闸 ───────────────────────────────────────────────────────────────
  function relabelApproval(pending: PendingApproval): void {
    const titleEl = pending.element.querySelector(".lumir-hp-approval-title");
    if (titleEl !== null) {
      titleEl.textContent =
        pending.diff !== undefined ? t("D339", { tool: pending.tool }) : t("D340", { tool: pending.tool });
    }
    const reason = pending.element.querySelector<HTMLInputElement>(".lumir-hp-reason");
    if (reason !== null) reason.placeholder = t("D338");
    const approve = pending.element.querySelector("button[data-act=approve]");
    const reject = pending.element.querySelector("button[data-act=reject]");
    if (approve !== null) approve.textContent = t("D336");
    if (reject !== null) reject.textContent = t("D337");
  }

  function appendApproval(request: { id: string; tool: string; diff?: string; argv?: string }): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-approval";
    const titleEl = document.createElement("div");
    titleEl.className = "lumir-hp-approval-title";
    el.append(titleEl);
    if (request.diff !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-diff";
      for (const line of request.diff.split("\n")) {
        const row = document.createElement("div");
        row.textContent = line;
        if (line.startsWith("+")) row.className = "lumir-hp-diff-add";
        else if (line.startsWith("-")) row.className = "lumir-hp-diff-del";
        else if (line.startsWith("@@")) row.className = "lumir-hp-diff-hunk";
        pre.append(row);
      }
      el.append(pre);
    } else if (request.argv !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-argv";
      pre.textContent = request.argv;
      el.append(pre);
    }
    const reason = document.createElement("input");
    reason.type = "text";
    reason.className = "lumir-hp-reason";
    const actions = document.createElement("div");
    actions.className = "lumir-hp-approval-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.dataset.act = "approve";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.dataset.act = "reject";
    actions.append(approve, reject);
    el.append(reason, actions);

    const pending: PendingApproval = { id: request.id, tool: request.tool, diff: request.diff, argv: request.argv, element: el };
    pendingApprovals.set(request.id, pending);
    relabelApproval(pending);

    // 未决项不自动超时：唯一的出口是 Alex 点击。决策后按钮整排禁用（幂等——
    // 重复点击不会向后端发第二次），元素留在 transcript 里作决策记录。
    const decide = (approved: boolean): void => {
      if (!pendingApprovals.delete(request.id)) return;
      approve.disabled = true;
      reject.disabled = true;
      reason.disabled = true;
      el.classList.add(approved ? "is-approved" : "is-rejected");
      harnessApprove(request.id, approved, reason.value.trim() === "" ? undefined : reason.value.trim()).catch(
        (e: unknown) => appendError(t("D348", { message: errorMessage(e) })),
      );
    };
    approve.addEventListener("click", () => decide(true));
    reject.addEventListener("click", () => decide(false));

    transcript.append(el);
    syncEmptyHint();
    scrollToBottom();
  }

  // ── 流式 assistant 消息 ──────────────────────────────────────────────────
  function ensureStreamingMessage(): void {
    if (streamingEl !== null) return;
    streamingEl = document.createElement("div");
    streamingEl.className = "lumir-hp-msg lumir-hp-msg-assistant";
    tailEl = document.createElement("div");
    tailEl.className = "lumir-hp-md-tail";
    streamingEl.append(tailEl);
    transcript.append(streamingEl);
    streamingText = "";
    renderedFinalized = 0;
    syncEmptyHint();
  }

  /** rAF 合帧：chunk 只进缓冲，真正的 DOM 写入每帧至多一次。 */
  function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(() => {
      flushScheduled = false;
      flushChunks();
    });
  }

  function flushChunks(): void {
    if (chunkBuffer === "") return;
    ensureStreamingMessage();
    streamingText += chunkBuffer;
    chunkBuffer = "";
    // 已完成块：渲染过一次就冻结（游标只前进）；进行中的末块整段重渲。
    const boundary = finalizedUpTo(streamingText);
    if (boundary > renderedFinalized && streamingEl !== null && tailEl !== null) {
      const grown = streamingText.slice(renderedFinalized, boundary);
      const finalizedEl = document.createElement("div");
      finalizedEl.className = "lumir-hp-md-final";
      renderMarkdownInto(finalizedEl, grown);
      streamingEl.insertBefore(finalizedEl, tailEl);
      renderedFinalized = boundary;
    }
    if (tailEl !== null) {
      tailEl.replaceChildren();
      renderMarkdownInto(tailEl, streamingText.slice(renderedFinalized));
    }
    scrollToBottom();
  }

  /** 一轮结束：对完整源做一次全量重渲（增量渲染的近似在松散列表等形态上收敛于此）。 */
  function finalizeStreamingMessage(): void {
    flushChunks();
    if (streamingEl === null) return;
    streamingEl.replaceChildren();
    renderMarkdownInto(streamingEl, streamingText);
    streamingEl = null;
    streamingText = "";
    renderedFinalized = 0;
    tailEl = null;
    scrollToBottom();
  }

  function setBusy(next: boolean): void {
    busy = next;
    sendButton.disabled = next;
  }

  // ── 事件流 ───────────────────────────────────────────────────────────────
  function handleEvent(event: HarnessEvent): void {
    // 会话作用域过滤（M312）：只渲染当前 vault 的会话。切换 vault 之后仍在途的旧 vault 事件
    // （工具循环跑在 `lumir-harness-llm` 专线程上，切 vault 不打断它）在这里被丢弃，不串台。
    if (!inCurrentVault(event.vault, currentVault)) return;
    switch (event.type) {
      case "text_chunk":
        chunkBuffer += typeof event.text === "string" ? event.text : "";
        scheduleFlush();
        return;
      case "tool_call":
        appendToolCall(
          typeof event.name === "string" ? event.name : "?",
          event.status === "done" ? "done" : "started",
          typeof event.summary === "string" ? event.summary : "",
        );
        return;
      case "approval_request":
        if (typeof event.id === "string") {
          appendApproval({ id: event.id, tool: event.tool, diff: event.diff, argv: event.argv });
        }
        return;
      case "usage":
        // HP1：用量读数随头部栏退场（常驻警示句一并移除）——事件仍由后端发出，
        // 读数迁入 composer 控制行是后续 mission 的面；此处不再有消费动作。
        return;
      case "compact":
        // 自动压缩 = 开新逻辑会话：会话名按同口径重算（下一条用户消息成为新名，
        // 未发前显示「新会话」——design §3）。
        firstUserText = null;
        applySessionName();
        appendCompactMarker(typeof event.summary === "string" ? event.summary : "");
        return;
      case "done":
        finalizeStreamingMessage();
        setBusy(false);
        return;
      case "error":
        finalizeStreamingMessage();
        setBusy(false);
        appendError(t("D348", { message: typeof event.message === "string" ? event.message : event.code }));
        return;
    }
  }

  void onHarnessEvent(handleEvent).catch(() => {});

  // ── 快照恢复（webview 重载 / 首次挂载 / 切 vault）：宽容解析，缺键 = 空态 ──
  function restoreSnapshot(json: string): void {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(json);
    } catch {
      return;
    }
    if (typeof snapshot !== "object" || snapshot === null) return;
    const state = snapshot as Record<string, unknown>;
    // 快照准入（M312）：标识与当前 vault 不符的一律丢弃（例如切走之后才回来的那份——
    // 它的消息属于旧 vault）。判据与事件过滤同一条（inCurrentVault）。
    if (!inCurrentVault(state.vault, currentVault)) return;
    const messages = Array.isArray(state.messages) ? state.messages : [];
    for (const message of messages) {
      if (typeof message !== "object" || message === null) continue;
      const record = message as Record<string, unknown>;
      const role = record.role;
      if (role === "user" && typeof record.text === "string") {
        // 已发送消息的存留是序列化文本（含 <quote> 块与上下文节）：解析回块序列同构呈现。
        // headingPath 不在协议里（人侧专用字段），恢复的卡片 hover 退化为 heading 链。
        const blocks = parseQuoteMessage(record.text);
        // 会话名按同口径从恢复的消息重算（首条用户消息的原始问题文本）。
        if (firstUserText === null) firstUserText = firstUserTextOf(blocks);
        appendUserMessage(blocks);
      } else if (role === "assistant" && typeof record.text === "string") {
        const el = document.createElement("div");
        el.className = "lumir-hp-msg lumir-hp-msg-assistant";
        renderMarkdownInto(el, record.text);
        transcript.append(el);
      } else if (role === "tool" && typeof record.name === "string") {
        appendToolCall(record.name, "done", typeof record.summary === "string" ? record.summary : "");
      } else if (role === "compact" && typeof record.summary === "string") {
        // 压缩记录 = 逻辑会话边界：其后的用户消息属于新逻辑会话——会话名归 null 重算。
        firstUserText = null;
        appendCompactMarker(record.summary);
      }
    }
    const pending = state.pending_approval as { id?: unknown; tool?: unknown; diff?: unknown; argv?: unknown } | null | undefined;
    if (pending !== null && typeof pending === "object" && typeof pending.id === "string") {
      appendApproval({
        id: pending.id,
        tool: typeof pending.tool === "string" ? pending.tool : "?",
        diff: typeof pending.diff === "string" ? pending.diff : undefined,
        argv: typeof pending.argv === "string" ? pending.argv : undefined,
      });
    }
    applySessionName();
    syncEmptyHint();
    scrollToBottom();
  }

  /** 快照请求（挂载 / 切 vault 共用）：世代号保证只有最新一次请求的结果被应用。 */
  function fetchSnapshot(): void {
    const seq = (snapshotSeq += 1);
    void harnessState()
      .then((json) => {
        if (seq === snapshotSeq) restoreSnapshot(json);
      })
      .catch(() => {});
  }

  /** 清空渲染面与本地流式态（「新会话」与「切 vault」共用：两者都是「换了一个会话」）。
   *  会话真源在 Rust，这里清的是**渲染面**与只属于上一段会话的本地态。 */
  function resetView(): void {
    transcript.replaceChildren();
    pendingApprovals.clear();
    streamingEl = null;
    streamingText = "";
    renderedFinalized = 0;
    chunkBuffer = "";
    lastToolEl = null;
    // 会话名随会话作废：未发消息前显示「新会话」，首条消息后再按口径重算。
    firstUserText = null;
    applySessionName();
    // busy 一并复位：旧会话那一轮的 done 事件可能永远到不了这里（切 vault 后被过滤，
    // 见 handleEvent）——不复位的话新会话的发送钮会被一个等不到的「处理中」锁死。
    setBusy(false);
    syncEmptyHint();
  }

  /**
   * 装载新 vault 之后由装配层调用（src/main.ts 的 applyVault，M312）：面板的会话状态在后端
   * 按 vault 分桶，这里把作用域基准切过去、丢掉旧 vault 的渲染面，并按当前 vault 重拉快照。
   *
   * 本地态的处置口径（写在这里，免得下次再推一遍）：
   * - **composer 草稿清空**：草稿是在旧 vault 的上下文里写的（当时的 chip 指着旧 vault 的
   *   文档），留着就会被当成本 vault 的提问发出去；
   * - **上下文 chip 重取**：同上，改指新 vault 的当前文档（此刻多数是「无」）；
   * - **busy 复位**：见 resetView；
   * - 语言 / 主题 / 面板开合状态都不动（它们不属于会话）。
   */
  function vaultChanged(root: string): void {
    if (root === currentVault) return; // 同一个 vault 的重复装载（重定位 / 重开）不重置视图
    currentVault = root;
    resetView();
    // 草稿清空 = 模型层清空（连带撤销史——草稿是旧 vault 上下文里的产物）。
    undoHistory.clear();
    renderComposer([{ kind: "paragraph", text: "" }], null);
    refreshChip();
    fetchSnapshot();
  }

  // 后端不可用（纯浏览器预览 / 命令未注册）时按空会话降级——面板本身照常可用，
  // 发送时才会报「发送失败」。挂载这一次拉取在「后端已经开着某个 vault」时会被快照准入
  // 判据挡下（此时 currentVault 还是 null），随后那次 vaultChanged 的拉取承担首帧渲染。
  fetchSnapshot();

  // ── 发送与新会话 ─────────────────────────────────────────────────────────
  function send(): void {
    if (busy) return;
    normalize();
    const blocks = readBlocksFromDom();
    // 投递文本 = M342 序列化 walker 的产物（两 provider 统一处：harness_send → Rust
    // assemble_user_message 的装配对两 provider 同一份 input，模型侧适配不散落——design §3）。
    const text = serializeQuoteMessage(blocks);
    if (text.trim() === "") return;
    const hasCards = blocks.some((b) => b.kind === "quote");
    // 携带卡片 ⇒ 跳过视口注入（spec「携带卡片时跳过视口」）；路径注入恒在。
    const block = assembleHarnessContext(editor, { skipViewport: hasCards });
    lastChip = block ?? "none";
    applyChip();
    appendUserMessage(blocks);
    // 会话名：本逻辑会话的首条用户消息定名（未发过时）；卡片与序列化文本不作名。
    if (firstUserText === null) {
      firstUserText = firstUserTextOf(blocks);
      applySessionName();
    }
    // 投递成功入队后草稿与撤销史一并归零（新消息是新的编辑史）。
    undoHistory.clear();
    renderComposer([{ kind: "paragraph", text: "" }], null);
    updateEmptyClass();
    setBusy(true);
    harnessSend(text, block !== null ? serializeHarnessContext(block) : null).catch((e: unknown) => {
      setBusy(false);
      appendError(t("D347", { reason: errorMessage(e) }));
    });
  }

  sendButton.addEventListener("click", send);
  // Enter 发送 / ⇧Enter 换行（D328 占位同款口径）；IME 组合期不接管（Enter 在组合期是
  // 「确认候选」）。退格 / 前删走模型（卡片按整体作用 + 自管撤销栈的确定性）。
  composer.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        withModel((blocks) => {
          const sel = caretFromDom();
          const caret = sel === null ? { block: blocks.length - 1, offset: 0 } : sel.focus;
          return insertSoftBreakAtCaret(blocks, caret);
        }, false);
      } else {
        send();
      }
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      const sel = caretFromDom();
      if (sel === null) return;
      const collapsed = sel.anchor.block === sel.focus.block && sel.anchor.offset === sel.focus.offset;
      event.preventDefault();
      if (collapsed) {
        const op = event.key === "Backspace" ? backspaceAtCaret : deleteForwardAtCaret;
        withModel((blocks) => op(blocks, sel.focus) ?? { blocks: [...blocks], caret: sel.focus }, false);
      } else {
        withModel((blocks) => deleteSelectionRange(blocks, sel), false);
      }
    }
  });
  // beforeinput 收口：原生 undo 显式禁用（撤销栈自管，quirk ③ 的「登记」）；富文本格式化
  // 与 HTML 粘贴/拖入只走纯文本；组合期（IME）删除若会碰到卡片则拦下（quirk ②）；组合
  // 开始压一次前态（IME 整段是一个撤销步）；其余结构化输入（insertParagraph 等）全部
  // 拦截——新块只能经模型层产生，天然归一化为 .qpara（quirk ④）。
  composer.addEventListener("beforeinput", (event: InputEvent) => {
    const type = event.inputType;
    if (type === "historyUndo" || type === "historyRedo") {
      event.preventDefault();
      return;
    }
    if (type.startsWith("format") || type === "insertLink" || type.startsWith("formatSet")) {
      event.preventDefault();
      return;
    }
    if (type === "insertFromPaste" || type === "insertFromDrop" || type === "insertParagraph" ||
        type === "insertLineBreak" || type.startsWith("insertOrderedList") ||
        type.startsWith("insertUnorderedList")) {
      event.preventDefault();
      return;
    }
    if (event.isComposing) {
      if (type.startsWith("delete")) {
        const selection = window.getSelection();
        const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        if (range !== null) {
          for (const card of composer.querySelectorAll(".lumir-hp-qcard")) {
            if (range.intersectsNode(card)) {
              event.preventDefault();
              return;
            }
          }
        }
      }
      return;
    }
    if (type === "insertText" || type === "insertReplacementText" ||
        type === "deleteContentBackward" || type === "deleteContentForward" ||
        type === "deleteByCut" || type === "deleteWordBackward" || type === "deleteWordForward" ||
        type === "deleteSoftLineBackward" || type === "deleteSoftLineForward") {
      // 原生文本编辑：允许落进 .qpara，但压一次撤销前态（聚簇/去重/redo 作废在 history 里）。
      undoHistory.push(snapshot(), false);
      return;
    }
    event.preventDefault();
  });
  composer.addEventListener("compositionstart", () => {
    undoHistory.push(snapshot(), true);
  });
  composer.addEventListener("compositionend", () => {
    undoHistory.breakCluster(); // 组合整段是一个撤销步：下一拍编辑强制重新压栈。
    updateEmptyClass();
  });
  // 粘贴净化（quirk ①）：只收 text/plain；多行经模型拆成多个段落块；跨块选区先整块删除。
  composer.addEventListener("paste", (event: ClipboardEvent) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text === "") return;
    withModel((blocks) => {
      const sel = caretFromDom();
      if (sel === null) return insertPlainTextAtCaret(blocks, { block: blocks.length - 1, offset: 0 }, text);
      const collapsed = sel.anchor.block === sel.focus.block && sel.anchor.offset === sel.focus.offset;
      const base = collapsed ? { blocks: [...blocks], caret: sel.focus } : deleteSelectionRange(blocks, sel);
      return insertPlainTextAtCaret(base.blocks, base.caret, text);
    }, true);
  });
  // 拖入净化（同 quirk ①，只收 text/plain）：落点跟随指针——caretRangeFromPoint 取
  // 落点光标（WebKit 系；取不到退化 composer 末尾，与 paste 的无选区退化同值）。
  composer.addEventListener("drop", (event: DragEvent) => {
    event.preventDefault();
    const text = event.dataTransfer?.getData("text/plain") ?? "";
    if (text === "") return;
    let caret: ComposerCaret | null = null;
    const caretAtPoint = (document as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }).caretRangeFromPoint;
    if (typeof caretAtPoint === "function") {
      const range = caretAtPoint.call(document, event.clientX, event.clientY);
      if (range !== null) {
        // 拖放天然把光标落在指针处：让选区跟上，复用 caretFromDom 的模型读法。
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        caret = caretFromDom()?.focus ?? null;
      }
    }
    withModel(
      (blocks) => insertPlainTextAtCaret(blocks, caret ?? { block: blocks.length - 1, offset: 0 }, text),
      true,
    );
  });
  composer.addEventListener("input", () => updateEmptyClass());
  composer.addEventListener("focus", refreshChip);

  // ── 新建会话（harness 段 ＋钮与会话浮层动作项共用一条路径；两个入口一个语义）──
  function startNewSession(): void {
    harnessNewSession()
      .then(() => {
        // 清空的是**渲染面**：会话真源在 Rust，重置成功后本地视图随之清空；待决批准项随
        // 会话失效，一并撤下（它们的 id 已不属于任何会话）——口径见 resetView 的注释。
        resetView();
      })
      .catch((e: unknown) => appendError(t("D348", { message: errorMessage(e) })));
  }
  segNew.addEventListener("click", startNewSession);
  sessPopItem.addEventListener("click", () => {
    sessPop.hidden = true;
    startNewSession();
  });
  // 会话名下拉：展开/收起浮层（浮层只含「新建会话」动作项，节点 1 裁决不列历史）；
  // 浮层外交互（点击其他处）收起。按钮在标题栏（drag 区）里——clickable 元素由 tauri
  // drag.js 自动阻断拖拽，不需要 mousedown preventDefault（REVIEW.md 第 16 条）。
  sessionButton.addEventListener("click", (event) => {
    event.stopPropagation();
    sessPop.hidden = !sessPop.hidden;
  });
  document.addEventListener("click", (event) => {
    if (sessPop.hidden) return;
    if (event.target instanceof Node && sessPop.contains(event.target)) return;
    if (event.target instanceof Node && sessionButton.contains(event.target)) return;
    sessPop.hidden = true;
  });

  // 面板内 Escape = 收起（就地消费，不进键位表：Escape token 已被 editor.widget-escape
  // 占用，面板在 contentDOM 之外，那条绑定不命中——与 M139 搜索 panel 同先例同判词）。
  // 收起是装配层动作（账本收 pane + 焦点归还），经 deps.togglePane 路由。
  panel.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      deps.togglePane();
    }
  });

  // ── 唤起 / 收起（装配层执行；面板只维护挂载态与派生表现）───────────────────
  function attachTo(mount: HTMLElement | null): void {
    if (mount === mountEl) return;
    mountEl = mount;
    if (mount !== null) {
      mount.append(panel);
      panel.hidden = false;
      refreshChip();
    } else {
      // 摘出 DOM（元素长驻内存：订阅 / 撤销栈 / 流式态不丢），浮层随之收起。
      panel.remove();
      sessPop.hidden = true;
    }
    // 段随 pane 在场出现（装配层已把它插进标题栏，这里只管 hidden）。
    seg.hidden = mount === null;
    toggleButton.setAttribute("aria-pressed", String(mount !== null));
  }

  toggleButton.addEventListener("click", () => deps.togglePane());

  applyLabels();
  onRelabel(applyLabels);
  syncEmptyHint();
  // 初始 composer：一个空段落（placeholder 经 .is-empty 挂上）。
  renderComposer([{ kind: "paragraph", text: "" }], null);

  return {
    toggle: () => deps.togglePane(),
    isOpen: () => mountEl !== null,
    attachTo,
    focusComposer() {
      composer.focus();
    },
    titlebarSegment: () => seg,
    vaultChanged,
    setChromeRetreat(on) {
      toggleButton.hidden = on;
    },
    insertQuoteCard(card: QuoteCard): void {
      const valid = createQuoteCard(card); // lines 非空校验（取不到行范围不得生成卡片）
      if (mountEl === null) deps.togglePane(); // 装配层开 pane 后焦点已落 composer
      withModel((blocks) => {
        const sel = caretFromDom();
        const caret = sel === null ? { block: blocks.length - 1, offset: 0 } : sel.focus;
        return insertCardAtCaret(blocks, caret, valid);
      }, true);
      composer.focus();
    },
    setQuoteJumpHandler(handler) {
      quoteJumpHandler = handler;
    },
  };
}
