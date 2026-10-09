// Harness 对话面板（M303，change add-harness-probe，design §10 面板 UI；HP1 归位 pane，
// change move-harness-to-pane-chat-frame）。
//
// 形态（HP1 起）：**pane 内容件**——装配层在 harness pane 分栏时把面板挂进该 pane 的挂载
// 元素（attachTo），收起时摘除（面板元素长驻内存，订阅与流式态不随摘出丢失）；dock 列
// （网格第三列 / .dock-open）随本 change 移除。面板不再有头部栏：会话身份（名下拉）与
// 新建会话钮上移进标题栏的 harness 段（.lumir-hp-seg，仅 harness 在场时出现，宽度由装配层
// 按 pane 比分宽、与分隔条像素对齐）；ctx% 读数与常驻警示句随头部栏移除（读数迁入 composer
// 控制行是后续 mission 的面——M347 已迁入：控制行 = [模型 chip][composer][ctx 读数][发送钮]，
// 超阈值读数高亮 + 警示说明浮层；M370 起读数 = 「XX% · YY%」（+cache hit rate，分隔符小圆点
// 按 Alex 复裁决改 U+00B7、与 modeline 同款——原话写作 •，以复裁决为准）、ⓘ 钮移除
// 改 hover 浮层（Alex 2026-10-07），常驻警示句按 Alex 2026-10-06 裁决移除；M378 起浮层改
// 两行带当时实际值（第一行 context window usage 走 D395、第二行 cache hit rate 走 D401）
// 并按面板边界收编（窄 pane 左缘被 overflow:hidden 裁掉是「显示不全」的根因）；发送钮两态
// idle=发送 / 处理中=停止，停止钩子为 M348 对接面的明确桩）。标题栏 toggle 钮仍由本模块自建，
// 钉标题栏右端（产品标识块已移位 traffic 灯区）；双 pane 时隐藏（退让条款），⌘⇧A 照走。
// M370 起钮面 = 原型同款火花 SVG 图标（可见文字 D326 退场，悬停/读屏名 D327 不变）。
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
//     done 到达后对**每个文本段**的完整源做一次全量重渲（增量渲染在「跨空行的松散列表」
//     这类形态上是近似，全量重渲是收敛点——近似只存在于流式期间）。轮内工具清单与
//     文本段按到达序交错排布（M374）：工具行留在它发生的那处文本段之前，定稿重渲只
//     作用于文本段容器，不挪动工具块。
//
// 文案：全部取值经 src/copy.ts 的 t()（D327–D330 / D332–D348 / D375–D387，D334 / D335 于
// M347 改形、M370 再起改形（双读数 + hover 浮层）、M373 起 hover 浮层常驻含义句（D395）、
// 越线时追加警示句 D335；D98 复用为 provider 浮层当前项标记（harness 消费点随合并浮层于 M373 退役——合并浮层
// 改用勾选格 + tint 底；vault 切换器的 D98 消费点保留）、
// D383 为 M348 中断标注、D385–D387 为 M351 消息 meta 行与工具折叠摘要、D388–D392 为 M363
// 思考块折叠行与思考 chip 三句 + 浮层读屏名（D389 / D391 随双 chip 于 M373 退役、D390 沿用、
// D392 复用为合并浮层 effort 段标签）、D393–D399 为 M373 合并选择器（chip 读屏名支持态 /
// effort 不支持 hover hint / ctx 读数含义 hint / 浮层段标签 ×2 / 浮层读屏名 / chip 读屏名
// 未知态降级 D399）、D400 为 M374 停止中阶段行（stopping 相位即时反馈）、D401 为 M378
// hover hint 第二行（cache hit rate 带值）、D402 / D403 为 M381 config-only 空清单提示态
//（浮层模型段占位句 + chip 读屏名空态——不伪造模型条目）；D405–D408 为批准终态行
//（结果词 / 详情入口 / 原因句——M406 起挂在收敛后的同一工具行上）；D412–D416 为 M406
// 批准卡问句分工与副句、待决行尾注（D343/D344 的工具行整句模板随人话化三段式退场，
// 编号停用）；D417–D419 为 M406 会话删除（行内删除钮读屏名 / 确认句 / 确认钮）；D409–D411 为 M391 登记的会话恢复
// 三错误码（harness_session_unreadable / _invalid / _vault_mismatch）——M392 恢复选择器的
// 消费点：恢复失败经 src/copy.ts 的 errorText 按 code 渲染上错误行（D348 的 {message}）；
// 选择器行本身不新造文案（无历史会话 = 不渲染清单容器，会话名缺原文回落 D330「新会话」））；M378 起面板内容字号支持 ⌘+/- 步进
//（--lumir-hp-scale，与内容 pane 的 textScale 同语义：×1.1 钳 [12,32]、reset 回基线、
// 不落盘；焦点路由在装配层 src/main.ts）；
// 长驻元素（toggle 钮 / harness 段 / 输入框 placeholder / 按钮 / 上下文 chip / ctx 读数 /
// 合并选择器 chip / 待决批准项）注册 onRelabel，
// 语言切换时从已存状态重渲（design §5.2 的不变量）；transcript 的历史条目是已发生事实的记
// 录，不随语言切换改写（与 toast 历史同口径）——复制钮的 ✓ 反馈与 provider 浮层是交互件
//（前者每次点击现取、后者每次打开现建），天然跟当前语言走。

import { GFM, parser as commonmarkParser } from "@lezer/markdown";
import { currentLanguage, errorText, formatDate, formatRelative, onRelabel, t } from "./copy";
import type { Language } from "./copy";
import {
  configGet,
  configSetValue,
  errorMessage,
  harnessAbort,
  harnessApprove,
  harnessDeleteSession,
  harnessListSessions,
  harnessNewSession,
  harnessResumeSession,
  harnessSend,
  harnessSetThinkingEffort,
  harnessState,
  onHarnessEvent,
  openExternalUrl,
} from "./ipc";
import type { HarnessEvent } from "./ipc";
import type { ThinkingEffort } from "./bindings/ThinkingEffort";
import { assembleHarnessContext, serializeHarnessContext } from "./harness-context";
import type { HarnessContextBlock, HarnessContextSource } from "./harness-context";
import { createQuoteCard, serializeQuoteMessage } from "./quote-card";
import type { ComposerBlock, QuoteCard } from "./quote-card";
import { highlightCode } from "./preview/code";
import { mirrorThemeScope } from "./overlay-scope";
import { nextFontSize } from "./typography";
import type { TextScaleDirection } from "./typography";
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
  /**
   * 注册「停止」处理器（M347 定义的 M348 对接面）：处理中点击发送钮（= 停止态）时调用。
   *  M348 已接通——面板创建即默认接上真实 handler（调 harness_abort）；本接口保留给
   *  装配层 / 测试覆盖，传 null 回到「点击只走状态机」的桩行为。
   *  签名即对接面：无参、同步调用、幂等（stopping 子态挡连点由状态机保证，处理器不会因
   *  双击收到第二次）。
   */
  setStopHandler(handler: (() => void) | null): void;
  /** harness pane 内容字号步进一档 / 回基线（M378，与内容 pane 的 textScale 同语义：
   *  ×1.1 取整、钳 [12,32]、运行期不落盘；reset 回基线 = 面板根字号 --fs-ui 的现值）。
   *  缩放经 --lumir-hp-scale 施加到面板全部内容字号；装配层按焦点路由 view.text-scale-*。 */
  textScale(direction: TextScaleDirection): void;
  /** 焦点是否在面板内（pane 内容件持焦判据）：缩放命令经它决定作用于 harness 面板
   *  还是编辑器——与内容 pane「焦点在哪个 pane，⌘+/- 就缩放哪个 pane 的内容」同口径。 */
  hasFocus(): boolean;
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
// composer 控制行的纯模型层（M347）：模型 chip / ctx 读数 / 发送钮两态。
// 与混排 composer 同一条分层纪律：判据与状态机是纯函数（零 DOM 环境直接驱动，
// tests/unit/harness-panel-control.test.ts），DOM 只是渲染面。
// ---------------------------------------------------------------------------

/** 模型 provider 闭集合（与 src/bindings/HarnessProvider.ts 的同值域——ts-rs 生成的联合
 *  类型只是编译期别名，运行期判定要一份可遍历的表；后端取值校验在 Rust 侧完成）。 */
export const PROVIDER_IDS = ["kimi", "deepseek", "mock"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** 模型维度的一条可选项（与 Rust 侧 `HarnessModelSpec` 同形的宽容提取：id 必须是非空
 *  字符串；effort 严格取 true；window 取有限正数——缺键 / 坏形状的那一项不上屏）。 */
export interface ModelOption {
  id: string;
  /** 该模型是否支持思考程度调节（浮层 effort 段置灰判据 + hover hint 判据）。 */
  effort: boolean;
  /** 上下文窗口（tokens，ctx% 分母；前端目前只透传不展示）。 */
  window: number;
}

/** 单个 provider 的 model 维度提取结果。 */
export interface ModelSelection {
  /** 当前 model（配置值即读数；不在 options 里时照实显示）。 */
  current: string;
  /** 可选 model 档（schema 声明顺序）。 */
  options: ModelOption[];
}

/** 合并选择器的提取结果（`harnessSelection` 的返回形）。 */
export interface HarnessSelection {
  /** 当前 provider（配置值即读数；不在闭集合时照实显示）。 */
  provider: string;
  /** 可选 provider 档 = 闭集合 ∩ 已配置键，**UI 层过滤 mock**（Alex 裁决「界面上隐藏，
   *  代码保留」——mock 数据留在配置里，只是不进可选列表）。 */
  providerOptions: ProviderId[];
  /** 各 provider 的 model 维度（kimi / deepseek 存在即收录；mock 无模型维度不出现）。 */
  models: Partial<Record<ProviderId, ModelSelection>>;
}

/**
 * 合并选择器的读数与选项（`config.harness` 的宽容提取，配置即数据、缺键不伪造）：
 * - harness 段缺失 / providers 不是对象 → null（桩环境、旧配置、config_get 失败）——
 *   调用方隐藏 chip，不显示一个读不到的读数；
 * - providerOptions 只取闭集合内的键（配置里混入的其它键不上屏），mock 恒被过滤；
 * - models 逐项宽容提取：坏的项丢弃，整段缺失 → 该 provider 无模型维度（options 空）。
 */
export function harnessSelection(harness: unknown): HarnessSelection | null {
  if (typeof harness !== "object" || harness === null) return null;
  const providers = (harness as { providers?: unknown }).providers;
  if (typeof providers !== "object" || providers === null) return null;
  const configured = providers as Record<string, unknown>;
  const providerOptions = PROVIDER_IDS.filter((id) => id !== "mock" && id in configured);
  const models: Partial<Record<ProviderId, ModelSelection>> = {};
  for (const id of PROVIDER_IDS) {
    if (id === "mock" || !(id in configured)) continue;
    const entry = configured[id];
    if (typeof entry !== "object" || entry === null) continue;
    const current = (entry as { model?: unknown }).model;
    const rawModels = (entry as { models?: unknown }).models;
    const options: ModelOption[] = [];
    if (Array.isArray(rawModels)) {
      for (const item of rawModels) {
        if (typeof item !== "object" || item === null) continue;
        const spec = item as { id?: unknown; effort?: unknown; window?: unknown };
        if (typeof spec.id !== "string" || spec.id.trim() === "") continue;
        const window = typeof spec.window === "number" && Number.isFinite(spec.window) && spec.window > 0
          ? spec.window
          : 0;
        options.push({ id: spec.id, effort: spec.effort === true, window });
      }
    }
    models[id] = { current: typeof current === "string" ? current : "", options };
  }
  const provider = (harness as { provider?: unknown }).provider;
  return {
    provider: typeof provider === "string" ? provider : "",
    providerOptions,
    models,
  };
}

/**
 * chip 的 model 读数（合并 chip = 「model · effort」，model 名的上屏值）：
 * - provider 有 model 维度 → 当前 model 配置值；为空（宽容提取的缺值）回落首选项 id
 *   （该回落值也来自配置声明）；
 * - provider 有维度但声明清单为空（M381 config-only 的空态）→ 空串：不伪造读数——
 *   调用方收起 model 名与分隔符，读屏名改走 D403，浮层模型段给 D402 提示态；
 * - provider 无模型维度（mock——验收专用档）→ 回落 provider id 本身（配置值即读数，
 *   chip 形态因此保持「model · effort」双读数不变形）。
 */
export function chipModelReading(selection: HarnessSelection): string {
  const dim = selection.models[selection.provider as ProviderId];
  if (dim === undefined) return selection.provider;
  if (dim.current !== "") return dim.current;
  return dim.options[0]?.id ?? "";
}

/** ctx% 读数的高亮判据：越过（≥）警示阈值即高亮。阈值是配置值（`warn_ctx_pct`，缺省 85）；
 *  边界取高亮侧——读数是压缩行为的前瞻信号，85/85 时下一轮就会触发压缩，按「已越线」呈现。 */
export function usageOverWarn(ctxPct: number, warnPct: number): boolean {
  return ctxPct >= warnPct;
}

// ── harness pane 内容字号步进的纯模型层（M378）────────────────────────────────
// 与内容 pane 的 textScale（src/editor.ts，change typography-and-zoom）同一条语义：
// up / down 复用 nextFontSize（×1.1 取整、钳 [12,32]）、reset 回基线、到界无变化、运行期
// 不落盘。基线是面板根字号 --fs-ui 的现值（创建时读到）——对应编辑器的「⌘0 回配置字号」。
// 纯函数零 DOM（tests/unit 直接驱动）。

/**
 * harness pane 字号步进一档 / 回基线（纯函数）：`reset` 回 `base`；`up` / `down` 走
 * nextFontSize 的同款档位（倍率 1.1、取整、钳 [12,32]，到界返回原值——调用方据此
 * 「无变化、无提示、不报错」，与 editor.textScale 同口径）。
 */
export function nextHarnessFontSize(
  current: number,
  direction: TextScaleDirection,
  base: number,
): number {
  return direction === "reset" ? base : nextFontSize(current, direction);
}

/** 消息 when 的相对时间（M351，change harness-pane-visual-fidelity design §4）：上屏打戳 →
 *  分档标签。「刚刚」复用 D100.1（同一语义单一真源），其余档经 Intl（formatRelative
 *  narrow 式，与 vault 切换器的 D100 族同一机制——narrow：zh「10秒前」贴合原型
 *  「12 秒前」（long 式会产出「10秒钟前」）、en「10s ago」，micro 字号紧凑位）。分档：「<10s 刚刚 / <60s N 秒前 / <60min N 分钟前 /
 *  <24h N 小时前 / 否则昨天」——会话是内存态、重启清空，更老的值实际上不出现，「昨天」
 *  已是兜底；时钟回拨（打戳在将来）clamp 进「刚刚」，不产出负数。 */
export function relativeWhen(at: number, now: number, lang: Language = currentLanguage()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 10) return t("D100.1", undefined, lang);
  if (seconds < 60) return formatRelative(-seconds, "second", lang, "narrow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatRelative(-minutes, "minute", lang, "narrow");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatRelative(-hours, "hour", lang, "narrow");
  return formatRelative(-1, "day", lang, "narrow");
}

// ---------------------------------------------------------------------------
// 会话恢复选择器的纯模型层（M392，change reshape-harness-session-recording design §6.1）：
// 极简选择器——列表 + 点击恢复，无重命名 / 删除 / 搜索 / 分组（探针期完整形态不做）。
// 与上面几层同一条分层纪律：截断 / 清单解析 / 时间读数是纯函数（零 DOM 环境直接驱动，
// tests/unit/harness-session-picker.test.ts），DOM 只是渲染面。
// ---------------------------------------------------------------------------

/** 会话名截断长度（约 20 字）。截断口径的单一真源：标题栏会话名与恢复选择器的会话行
 *  共用（design §6.1：同一口径），按码点截断——emoji / CJK 都按 1 字计。 */
export const SESSION_NAME_MAX = 20;

/** 会话名上屏形态：超长按码点截断 + 「…」；不超原样返回（含首尾空白——名是用户原文，
 *  不改写）。 */
export function truncateSessionName(text: string, max: number = SESSION_NAME_MAX): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

/** 历史会话清单的一条（`harness_list_sessions` 的宽容提取结果；M395 合同形状
 *  `SessionSummary` = { session_id, first_user_text, ts }，解析只认这三个键）。 */
export interface SessionEntry {
  /** `sessions/<id>.jsonl` 的文件名（恢复命令的入参）。 */
  sessionId: string;
  /** 首条用户消息原文（会话名口径的数据源）；null = 无用户消息（回落 D330「新会话」）。 */
  firstUserText: string | null;
  /** 首行 `session_open` 信封的 unix 秒；null = 缺读数不伪造（时间不显示）。 */
  ts: number | null;
}

/**
 * `harness_list_sessions` 载荷的宽容解析（M392 + M395 合同）：string 先 JSON.parse，
 * 非数组 / 坏 JSON → 空清单（桩环境、M395 合并前的旧后端、读取失败不报错打断浮层）；
 * 逐项提取只认三个键——`session_id` 必须是非空字符串（缺 / 空串 / 非字符串的项丢弃，
 * 没有 id 就无法恢复，留着也是死项）；`first_user_text` 缺 / null / 空白串 → null；
 * `ts` 缺 / 非数 / 非正 → null。
 *
 * 排序：合同说服务端已按时间倒序，这里仍按 session_id 字典序降序再排一次——时间序
 * 前缀（s<unix_millis>-…）可排序，字典序与时间序同向，乱序 / 桩环境的渲染序因此不
 * 让给网络序（与 accumulateThinkingBlock 的排序兜底同一条纪律）。
 */
export function sessionEntriesOf(payload: unknown): SessionEntry[] {
  let value: unknown = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: SessionEntry[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.session_id !== "string" || rec.session_id === "") continue;
    const text = rec.first_user_text;
    const ts = rec.ts;
    out.push({
      sessionId: rec.session_id,
      firstUserText: typeof text === "string" && text.trim() !== "" ? text : null,
      ts: typeof ts === "number" && Number.isFinite(ts) && ts > 0 ? ts : null,
    });
  }
  return out.sort((a, b) => (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));
}

/** 选择器行的时间读数（unix 秒）：同日给相对时间（「5 分钟前」，narrow 与消息 when 行
 *  同 formatter）；跨天 / 更老给短日期（与文档日期同 formatter，Intl 承载语言规则）。
 *  ts 为 null 时调用方不渲染时间格（sessionEntriesOf 已不伪造读数）。 */
export function sessionWhen(ts: number, now: number, lang: Language = currentLanguage()): string {
  const at = ts * 1000;
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return formatRelative(-seconds, "second", lang, "narrow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatRelative(-minutes, "minute", lang, "narrow");
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && sameDay) return formatRelative(-hours, "hour", lang, "narrow");
  return formatDate(new Date(at), "short", lang);
}

/**
 * 发送钮两态状态机（M347）：idle = 可发送；running = 处理中（钮面 = 停止态，点击走
 * 停止钩子）；stopping = 停止已请求、等后端终态（连点幂等——第二次 stop-clicked 被吞，
 * 停止钩子不会重复发出）。终态统一经 finished 收口回 idle（done 与 error 都是
 * 「这一轮结束了」——事件层已把两者导向同一出口，机器因此不需要区分）。
 */
export type SendPhase = "idle" | "running" | "stopping";
export type SendEvent = { type: "sent" } | { type: "stop-clicked" } | { type: "finished" };
export function reduceSendPhase(phase: SendPhase, event: SendEvent): SendPhase {
  switch (event.type) {
    case "sent":
      // 忙时重复发送被 busy 协议挡在门外（机器不前移，调用方的相位检查是第一道闸）。
      return phase === "idle" ? "running" : phase;
    case "stop-clicked":
      return phase === "running" ? "stopping" : phase;
    case "finished":
      return "idle";
  }
}

/**
 * IME 组合期 Enter 拦截门（M361 2.3）：WKWebView 下「确认候选」那拍 Enter 的
 * keydown.isComposing 不可靠——WebKit 先派 compositionend 再派确认 keydown（isComposing
 * 已是 false），现行早退挡不住，发送被误触发。改用 compositionstart/end 自跟踪 + 双序防线：
 *
 * - Chromium 序（确认 Enter 在组合期内到达）：keydown 分支吞掉，并 endDisarmed——随后的
 *   compositionend 不再开窗，避免用户紧接着再按一次 Enter 想发送时被误吞；
 * - WebKit 序（compositionend 先到）：compositionend 开一扇短确认窗，窗口内紧邻的 Enter
 *   按确认拍吞掉（consume 后关窗）；
 * - 窗口外 Enter / 非 Enter 键一律放行（不得破坏正常 Enter 发送与 ⇧Enter 换行）。
 *
 * 纯函数、now 一律外注，假时钟可测（tests/unit/harness-ime-enter.test.ts）。
 */
export interface ImeKeyGate {
  /** compositionstart 之后、compositionend 之前。 */
  composing: boolean;
  /** 确认窗截止（epoch ms）：compositionend 时刻 + IME_CONFIRM_WINDOW_MS；0 = 未开窗。 */
  confirmUntil: number;
  /** 组合期内那拍 Enter 已被吞：随后的 compositionend 不开确认窗。 */
  endDisarmed: boolean;
}

export const IME_CONFIRM_WINDOW_MS = 250;

export function imeKeyGate(): ImeKeyGate {
  return { composing: false, confirmUntil: 0, endDisarmed: false };
}

export function imeGateCompositionStart(gate: ImeKeyGate): ImeKeyGate {
  return { composing: true, confirmUntil: 0, endDisarmed: false };
}

export function imeGateCompositionEnd(gate: ImeKeyGate, now: number): ImeKeyGate {
  return {
    composing: false,
    confirmUntil: gate.endDisarmed ? 0 : now + IME_CONFIRM_WINDOW_MS,
    endDisarmed: false,
  };
}

/** 驱动一拍 keydown：swallow = true 表示「IME 候选确认拍」——调用方须 preventDefault 且不发送、不换行。 */
export function imeGateKeydown(
  gate: ImeKeyGate,
  key: string,
  now: number,
): { gate: ImeKeyGate; swallow: boolean } {
  if (key === "Enter") {
    if (gate.composing) {
      // Chromium 序的确认拍：吞；compositionend 随后就到，但不再开窗。
      return { gate: { ...gate, endDisarmed: true }, swallow: true };
    }
    if (gate.confirmUntil > now) {
      // WebKit 序的确认拍：吞并关窗；再下一拍 Enter 就是真发送。
      return { gate: { ...gate, confirmUntil: 0 }, swallow: true };
    }
    // 窗口外的真 Enter：放行（正常发送 / ⇧Enter 换行），顺手清掉过期窗。
    return { gate: { ...gate, confirmUntil: 0 }, swallow: false };
  }
  // 非 Enter 键是真实输入：关掉确认窗（组合期状态不动——编辑键仍走 IME 原生路径）。
  return { gate: { ...gate, confirmUntil: 0 }, swallow: false };
}

// ---------------------------------------------------------------------------
// 思考块 + 思考程度的纯模型层（M363，change add-harness-thinking-display-and-effort
// 的面板半边；档位 / reasoning_chunk 事件 / thinking 快照字段的契约 = M362 的 core 半边）。
// 与上面几层同一条分层纪律：累加 / 时长 / 档位读数判定是纯函数（零 DOM 环境直接驱动，
// tests/unit/harness-thinking.test.ts），DOM 只是渲染面。
// ---------------------------------------------------------------------------

/** 思考程度三档（与 src/bindings/ThinkingEffort.ts 同值域的运行期可遍历表——ts-rs 联合
 *  类型只是编译期别名，浮层渲染与快照解析要一份闭集合；取值校验在 Rust 侧完成）。 */
export const THINKING_EFFORTS = ["low", "high", "max"] as const;

/** 一块思考的累计数据（reasoning_chunk 事件的累加面）。 */
export interface ThinkingBlock {
  /** 块序号（后端 reasoning_block 计数，0 起；工具循环多轮 = 多块，序号从前到后递增）。 */
  index: number;
  /** 块文本：同 index 的多个分片按到达序拼接。 */
  text: string;
  /** 块首分片的墙钟（epoch ms）——时长起点。 */
  startedAt: number;
  /** 末分片的墙钟——时长终点；轮次结束不再有新分片，读数因此定格。 */
  lastAt: number;
}

/**
 * reasoning_chunk → 思考块序列的累加器：同 index 的分片并进同一块（text 追加、lastAt
 * 前进到新分片的到达时刻）；新 index 开新块、按块序号序插入（防御乱序到达——后端
 * 按序发出，前端排序是渲染序的兜底，不是第二真源）。返回落入的那块（新建或更新）。
 */
export function accumulateThinkingBlock(
  blocks: readonly ThinkingBlock[],
  index: number,
  text: string,
  at: number,
): { blocks: ThinkingBlock[]; block: ThinkingBlock } {
  const existing = blocks.find((b) => b.index === index);
  if (existing !== undefined) {
    const next: ThinkingBlock = { ...existing, text: existing.text + text, lastAt: at };
    return { blocks: blocks.map((b) => (b.index === index ? next : b)), block: next };
  }
  const block: ThinkingBlock = { index, text, startedAt: at, lastAt: at };
  return { blocks: [...blocks, block].sort((a, b) => a.index - b.index), block };
}

/** 思考块时长（秒）：块首分片到末分片的墙钟差，四舍五入、不为负。前端计时（core 不引入
 *  计时状态，M362）——流式期间随时长分片到达前进，轮次结束自然定格。 */
export function thinkingDurationSec(block: ThinkingBlock): number {
  return Math.max(0, Math.round((block.lastAt - block.startedAt) / 1000));
}

/** 思考块折叠行文案（D388）：chevron + 「思考过程 · N 秒」。时长是数据读数，模板整串走表。 */
export function thinkingHeadText(block: ThinkingBlock, lang: Language = currentLanguage()): string {
  return t("D388", { sec: thinkingDurationSec(block) }, lang);
}

/** 思考程度档位名的上屏形态：后端给的是小写原词（"low"/"high"/"max"，绑定序列化即原词），
 *  档位名是专有名词（Alex 2026-10-06 裁决：zh/en 均英文原文），上屏首字母大写。 */
export function effortLabel(level: string): string {
  return level === "" ? level : level.charAt(0).toUpperCase() + level.slice(1);
}

/**
 * `harness_state` 快照 `thinking` 字段的宽容提取（M362 契约：`{level, supported}`）：
 * - 缺字段 / 形状不对 → null——桩环境、旧后端不伪造读数，思考 chip 按模型 chip 同纪律隐藏；
 * - level 不是三档之一 → 同样 null（闭集合纪律：前端不猜档位）；
 * - supported 严格取 true（缺键 = 不支持——置灰是安全侧：宁可禁用一个能调的模型，
 *   也不对一个不支持的模型放行）。
 *
 * 空态（无会话）快照也带本字段（Rust 侧 `StateSnapshot::empty` 同形，supported 按当前
 * provider + model 现算），chip 空态照显。
 */
export function thinkingStateOf(snapshot: unknown): { level: string; supported: boolean } | null {
  if (typeof snapshot !== "object" || snapshot === null) return null;
  const thinking = (snapshot as { thinking?: unknown }).thinking;
  if (typeof thinking !== "object" || thinking === null) return null;
  const level = (thinking as { level?: unknown }).level;
  if (typeof level !== "string" || !(THINKING_EFFORTS as readonly string[]).includes(level)) {
    return null;
  }
  return { level, supported: (thinking as { supported?: unknown }).supported === true };
}

// ---------------------------------------------------------------------------
// 工具行终态摘要 + 快照恢复记录的纯判定（M368）。真源与合同：
//   - 终态摘要的形状（成功 = 调用参数摘要、失败 = `状态 · 错误码: 消息`）由 core 决定
//     （src-tauri/src/harness/turn.rs 的 handle_call 与 summarize_args / summarize_result），
//     面板持久化的那份与 live `started` 事件的那份同源（M367）；
//   - 空正文 assistant 记录的形状与「不再落」的合同见 openspec/specs/harness/spec.md
//     「消息呈现」的「工具轮快照保真」场景（M367 落在 core 侧，这里的判定是**旧快照防御**）。
// 与上面几层同一条分层纪律：判定是纯函数（零 DOM 环境直接驱动，
// tests/unit/harness-restore.test.ts），DOM 只是渲染面。
// ---------------------------------------------------------------------------

/**
 * `done` 事件里**失败摘要**的形状：core 的 `summarize_result` 失败分支固定为
 * `{细分状态} · {错误码}: {消息}`（turn.rs：状态是 denied / rejected / error，
 * 错误码是 ASCII 码字，分隔符是中点 U+00B7）。
 *
 * 前端判成功/失败时**只认失败这一侧的形状**，不认识成功侧的文案：成功时 core 发的是它自己的
 * 固定串，而真正有信息量的**参数摘要**在 live 路径只由 `started` 事件携带（与面板持久化的
 * 那份同源，M367）——「`done` 的摘要不是失败形状」即「这次调用成功」。
 *
 * 形状（而非固定状态词清单）是有意的：core 将来加细分状态时前端不用同批改；认不出的摘要
 * （桩环境 / 视觉场景直接 fire 的自定义摘要）走「不是失败」那一支——不伪造、不吞信息。
 *
 * 这是跨层字符串耦合（REVIEW.md 第 8 条的口味，同族：前端认 core 的摘要格式）。根治办法是
 * core 把 live `done` 事件的 summary 也换成持久化的那份（成功 = 参数摘要），前端零判定；
 * 已作为后续项上报，未落之前先在这里判定一次，不各算一份摘要。
 */
const TOOL_FAILED_SUMMARY = /^[a-z]+ · [a-z0-9_]+: /;

/**
 * 快照恢复路径上一条 assistant 记录的正文：缺 `text` / 非字符串 / 空白串 → `null`
 * （MUST NOT 渲染）。模型只发工具调用、无正文的轮次在 M367 之前会落一条 `text: Some("")`
 * 的面板记录，渲染出来就是「只有角色 meta 行、body 为空」的空气泡（Alex 2026-10-07 现场
 * 「连续出现 Agent · 19m ago 的字样」）。core 侧 M367 起不再落这类记录（新快照由它根治），
 * 这里是**旧快照的防御**：面板消息活在 core 内存里，升级前起的会话在重载 / 切 vault 回来时
 * 仍可能带它回来——渲染面要能吃掉这个形状。
 *
 * `trim()` 而非 `=== ""`：空白正文经 Markdown 渲染后同样是空 body，光秃 who 行照旧。
 */
export function restoredAssistantText(record: unknown): string | null {
  if (typeof record !== "object" || record === null) return null;
  const text = (record as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  return text.trim() === "" ? null : text;
}

/**
 * 恢复路径上一条 assistant 记录的思考展示文本（M398，`PanelMessage.reasoning`）：缺字段 /
 * 非字符串 / 空白串 → `null`（无 reasoning 明文就不建思考块，不伪造）。core 侧只在 wire 的
 * reasoning 回放项取得到**明文**时才带值（kimi 的不透明 `encrypted_content` 项取不到 → 缺席），
 * 故这里与 [`restoredAssistantText`] 同口径宽容判空。空白串经思考块渲染后是空 body，一并跳过。
 */
export function restoredReasoningText(record: unknown): string | null {
  if (typeof record !== "object" || record === null) return null;
  const reasoning = (record as { reasoning?: unknown }).reasoning;
  if (typeof reasoning !== "string") return null;
  return reasoning.trim() === "" ? null : reasoning;
}

// ---------------------------------------------------------------------------
// 工具行摘要人话化 + argv 拼接 + 拒绝原因提取的纯函数层（M406，harness 面板改进批次）。
// 数据口径：`started` 事件的 summary 是工具参数 JSON 原文（core 侧 `summarize_args`，
// 80 字截断——单一真源在 src-tauri/src/harness/turn.rs，MUST NOT 前端另算一份参数）；
// 人话化是**展示层提取**（按工具名取关键参数：cli_run=完整命令、vault_*=路径、
// vault_search=查询词、skill_load=技能名），截断 / 非 JSON / 未知工具一律回落原文，
// 不伪造。gated 调用的完整参数在 approval_request 载荷里（argv 数组 / diff 头文件名），
// 到达后取代截断摘要。与上面几层同一条分层纪律：纯函数零 DOM（tests/unit 直接驱动）。
// ---------------------------------------------------------------------------

/** argv → 单行命令文本（纯展示拼接）：含空白或引号的参数加双引号，内层 " 与 \ 转义。 */
export function formatArgv(argv: readonly string[]): string {
  return argv
    .map((arg) =>
      /[\s"']/.test(arg) ? `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : arg,
    )
    .join(" ");
}

/** 从解析后的工具参数 JSON 提取关键参数（工具参数 schema 的单一真源在 core 的 tools.rs）。
 *  取不到 → null（调用方回落原文）。 */
function keyArgOf(name: string, args: Record<string, unknown>): string | null {
  switch (name) {
    case "cli_run": {
      const command = typeof args.command === "string" ? args.command : "";
      if (command === "") return null;
      const rest = Array.isArray(args.args)
        ? args.args.filter((a): a is string => typeof a === "string")
        : [];
      return formatArgv([command, ...rest]);
    }
    case "vault_read":
    case "vault_create":
    case "vault_patch":
      return typeof args.path === "string" && args.path !== "" ? args.path : null;
    case "vault_list":
      return typeof args.path === "string" && args.path !== "" ? args.path : "/";
    case "vault_search":
      return typeof args.query === "string" && args.query !== "" ? args.query : null;
    case "skill_load":
      return typeof args.name === "string" && args.name !== "" ? args.name : null;
    default:
      return null;
  }
}

/** started / done 事件 summary 的人话化（见段头注释）：JSON 参数按工具名提取关键参数；
 *  截断串 / 非 JSON / 未知工具 / 缺关键字段 → 原文返回（不伪造、不吞信息）。 */
export function humanizeToolArgs(name: string, summary: string): string {
  if (summary === "") return "";
  const strict = humanizeToolArgsStrict(name, summary);
  return strict !== "" ? strict : summary;
}

/** 严格版人话化：只在 JSON 完整且关键参数取得到时返回值，否则 ""（调用方据此判
 *  「这份 summary 根本不是参数 JSON」——如持久化失败摘要走原文上屏、恢复路径拒绝行
 *  的 args 格留空）。 */
export function humanizeToolArgsStrict(name: string, summary: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(summary);
  } catch {
    return ""; // 80 字截断的 JSON 半边、持久化失败摘要、桩环境的自定义摘要
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "";
  return keyArgOf(name, parsed as Record<string, unknown>) ?? "";
}

/** unified diff 的文件名（core diff.rs 头两行 `--- a/{path}` / `+++ b/{path}`；取不到 → null）。 */
export function diffPathOf(diff: string): string | null {
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) return line.slice("+++ b/".length);
  }
  return null;
}

/** 恢复路径的拒绝原因（M406）：tool 面板记录的 text 是工具输出 JSON——approval_rejected
 *  的 message 即用户拒绝原因全文（summary 里那份被 80 字截断，不取）。形状不符 → null
 *  （不伪造原因行）。 */
export function rejectedReasonOf(record: unknown): string | null {
  if (typeof record !== "object" || record === null) return null;
  const text = (record as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const out = value as { code?: unknown; message?: unknown };
  if (out.code === "approval_rejected" && typeof out.message === "string" && out.message.trim() !== "") {
    return out.message;
  }
  return null;
}

/** 恢复路径的失败详情（M406）：tool 面板记录的 text 是工具输出 JSON——denied / error
 *  终态行尾注用 `{code}: {message}` 全文（summary 里那份被 80 字截断，不取）。输出非
 *  失败形状 → null（不伪造尾注）。 */
export function failureTextOf(record: unknown): string | null {
  if (typeof record !== "object" || record === null) return null;
  const text = (record as { text?: unknown }).text;
  if (typeof text !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const out = value as { ok?: unknown; code?: unknown; message?: unknown };
  if (out.ok !== false || typeof out.code !== "string") return null;
  const message = typeof out.message === "string" ? out.message : "";
  return message === "" ? out.code : `${out.code}: ${message}`;
}

/** gated 调用批准载荷的关键参数全文（行内人话化的「完整版」数据源）：cli_run = argv 拼接；
 *  写工具 = diff 头文件名；都无 → ""。 */
export function approvalArgsText(request: {
  diff?: string | undefined;
  argv?: readonly string[] | undefined;
}): string {
  if (request.argv !== undefined) return formatArgv(request.argv);
  if (request.diff !== undefined) return diffPathOf(request.diff) ?? "";
  return "";
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

/** 待决批准项的已存数据（relabel 时据此重渲，不丢按钮状态）。M406 收敛单行生命周期
 *（原型 harness-tool-card-merge variant B）：批准卡就地挂在该调用工具行的下方
 *（.lumir-hp-pend 壳 = 行 + 卡同一单元），row = 挂点行（就地升级为「等待批准」）、
 * argsText = 批准载荷的关键参数全文（终态行沿用同一份，不再退回截断摘要）。 */
interface PendingApproval {
  id: string;
  tool: string;
  diff?: string | undefined;
  argv?: string[] | undefined;
  /** 模型自述的用途句（M407 契约字段，可缺席——阅读辅助，不替代命令原文）。 */
  purpose?: string | undefined;
  argsText: string;
  element: HTMLElement;
  row: HTMLElement;
  wrap: HTMLElement;
}

export function createHarnessPanel(deps: HarnessPanelDeps): HarnessPanelHandle {
  const { shell, editor } = deps;

  // SVG 命名空间常量（模块无 innerHTML 的渲染纪律：全部图标经 DOM API 内联构建，
  // toggle 火花 / 发送钮两态 glyph / 工具 ✓ / 思考 chevron 共用）。
  const SVG_NS = "http://www.w3.org/2000/svg";

  // ── DOM：toggle 钮（标题栏动作钮槽位，钉右端；HP1 起产品标识块在 traffic 灯区，
  // 右端只有这颗钮）─────────────────────────────────────────────────────────
  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "titlebar-action lumir-hp-toggle";
  toggleButton.setAttribute("aria-pressed", "false");
  // 钮面 = 原型同款火花 SVG（四角星，viewBox 16，原型 phase2-harness-chat index.html 的
  // #harness-toggle；4e011d6 原型目录已退役，SVG 经 DOM API 内联构建——本模块无 innerHTML
  // 的渲染纪律不变）。可见文本 D326 随图标化退场（编号停用）；悬停提示 / 读屏名仍走
  // D327（M370，Alex「Chat 字样用图标吧，像原型那样」）。开态 accent 高亮沿用
  // .titlebar-action[aria-pressed="true"] 的既有条款（与原型 :1184 同方案）。
  // 本钮不需要 mousedown preventDefault：click 后经 deps.togglePane 交装配层开合（焦点移交
  // 在那一边），按钮瞬时持焦无所谓；「别抢焦点」的 preventDefault 若真需要，
  // MUST NOT 挂容器级元素（REVIEW.md 第 16 条）。
  const toggleSpark = document.createElementNS(SVG_NS, "svg");
  toggleSpark.setAttribute("width", "14");
  toggleSpark.setAttribute("height", "14");
  toggleSpark.setAttribute("viewBox", "0 0 16 16");
  toggleSpark.setAttribute("fill", "currentColor");
  toggleSpark.setAttribute("aria-hidden", "true");
  const toggleSparkPath = document.createElementNS(SVG_NS, "path");
  toggleSparkPath.setAttribute("d", "M8 1.5 9.6 6.4 14.5 8 9.6 9.6 8 14.5 6.4 9.6 1.5 8l4.9-1.6z");
  toggleSpark.append(toggleSparkPath);
  toggleButton.append(toggleSpark);
  shell.titlebar.append(toggleButton);

  // ── DOM：标题栏 harness 段（.lumir-hp-seg，HP1，Alex 点子 1）────────────────
  // 面板不再有头部栏：会话身份（名下拉）与新建会话钮上移进标题栏，与编辑器 pane 的标签段
  // 同构。段是长驻元素（hidden 随 attach 状态翻），装配层在 harness pane 分栏时插进标题栏
  // 并管宽度（flexGrow 与 pane 同一份 splitRatio——段边界与分隔条像素对齐）。
  const seg = document.createElement("div");
  seg.className = "lumir-hp-seg";
  seg.setAttribute("role", "group");
  seg.hidden = true;
  // 会话名钮 + 浮层同挂一层 wrapper（M351，finding 20261006-worker-hp4）：浮层 MUST NOT 嵌在
  // <button> 内——WKWebView 把「嵌在 button 里的 button」当叶子，AX 树不暴露浮层项。
  // wrapper 是 absolute 定位的包含块（紧贴按钮，坐标语义与「锚在钮内」等价）。
  const sessionWrap = document.createElement("span");
  sessionWrap.className = "lumir-hp-sessionwrap";
  const sessionButton = document.createElement("button");
  sessionButton.type = "button";
  sessionButton.className = "lumir-hp-session";
  sessionButton.setAttribute("aria-haspopup", "menu");
  sessionButton.setAttribute("aria-expanded", "false");
  const sname = document.createElement("span");
  sname.className = "lumir-hp-sname";
  const schev = document.createElement("span");
  schev.className = "lumir-hp-schev";
  schev.setAttribute("aria-hidden", "true");
  schev.textContent = "▾"; // i18n-exempt: glyph（下指 chevron 图形，非文案）
  sessionButton.append(sname, schev);
  const segNew = document.createElement("button");
  segNew.type = "button";
  segNew.className = "lumir-hp-seg-new";
  const segNewPlus = document.createElement("span");
  segNewPlus.className = "lumir-hp-plus";
  segNewPlus.setAttribute("aria-hidden", "true");
  segNewPlus.textContent = "＋"; // i18n-exempt: glyph（全角加号图形，非文案）
  segNew.append(segNewPlus); // M406：纯加号图标钮（可见文字退场，悬停/读屏名 D330 见 applyLabels）
  // 会话浮层（M406）：只有本 vault 历史会话选择器（原「新建会话」动作项退场——新建归首行
  // 加号钮，两个入口一个语义收窄为一个）。清单每次打开现拉现建（会话在对话进行中持续增长，
  // 不囤旧清单）；每行 = 恢复钮 + 删除钮（行内确认，M406 会话删除）；空历史时浮层不开。
  const sessPop = document.createElement("div");
  sessPop.className = "lumir-hp-sesspop";
  sessPop.setAttribute("role", "menu");
  sessPop.hidden = true;
  const sessList = document.createElement("div");
  sessList.className = "lumir-hp-sesspop-list";
  sessList.hidden = true;
  sessPop.append(sessList);
  sessionWrap.append(sessionButton, sessPop);
  seg.append(sessionWrap, segNew);
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

  // 上下文 chip（M370 移位：横线之下、composer 之上——进 composerArea 内、composerBox
  // 上方；横线是 composerArea 的 border-top。发送前可核对的读数与它的消费场景同区）。
  const chip = document.createElement("div");
  chip.className = "lumir-hp-chip";

  // ── composer 区（M351 视觉还原，change harness-pane-visual-fidelity design §2.5/§3.2）──
  // 原型形态：输入区与控制行收进同一个圆角卡片容器（.lumir-hp-composer-box，原型 .h-box），
  // 控制行在容器底 = [模型 chip][ctx 读数][spacer][图标发送钮]。空间紧（原型实测约
  // 346px）：chip 与读数都是小体量只读件，输入区吃剩余弹性宽。M370：上下文 chip 移进
  // 本区顶部（横线之下、composerBox 之上，Alex「放在横线之下、composer 之上更符合逻辑」）。
  const composerArea = document.createElement("div");
  composerArea.className = "lumir-hp-composer-area";
  const composerBox = document.createElement("div");
  composerBox.className = "lumir-hp-composer-box";
  const ctl = document.createElement("div");
  ctl.className = "lumir-hp-ctl";

  // 合并选择器 chip（M373，harness-selector-merge；原型 design/prototypes/harness-selector-merge）：
  // 可见文本 = 「model · effort」双读数（U+00B7 分隔，Alex 裁决「不需要显示 provider，只需要
  // model · effort」）；provider 不进 chip 读数，只在浮层里选。形态逐值沿用现行 chip 配方
  // （无边框小标签、24px 高、r5、fs-label-s、text-2、hover 给底、chevron ▾；max-width 96px →
  // 224px，双 chip 合一格的空间账见原型 NOTES）。截断纪律（Alex 裁决「只截 model 名，保住
  // effort」）：model 名单独 min-width:0 + ellipsis，分隔符 / effort / chevron 三格 flex:none。
  // chip 本体永不禁用——effort 不支持时仅 effort 读数置灰（text-3）+ hover hint（D394）。
  // chip + 浮层 + hint 泡同挂 wrapper（M351，finding 20261006-worker-hp4，与会话名钮同一条
  // 修复）：浮层挪出 <button>，WKWebView 的 AX 树才暴露浮层项；wrapper 是 absolute 定位的包含块。
  const modelWrap = document.createElement("span");
  modelWrap.className = "lumir-hp-modelwrap";
  const modelChip = document.createElement("button");
  modelChip.type = "button";
  modelChip.className = "lumir-hp-model";
  modelChip.setAttribute("aria-haspopup", "menu");
  modelChip.setAttribute("aria-expanded", "false");
  modelChip.hidden = true;
  const modelName = document.createElement("span");
  modelName.className = "lumir-hp-model-name";
  const modelSep = document.createElement("span");
  modelSep.className = "lumir-hp-model-sep";
  modelSep.textContent = "·"; // i18n-exempt: 分隔符图形（U+00B7，modeline 同款小圆点，复裁决）
  modelSep.setAttribute("aria-hidden", "true");
  const effReading = document.createElement("span");
  effReading.className = "lumir-hp-eff-reading";
  const modelChev = document.createElement("span");
  modelChev.className = "lumir-hp-model-chev";
  modelChev.setAttribute("aria-hidden", "true");
  modelChev.textContent = "▾"; // i18n-exempt: glyph（下指 chevron 图形，非文案）
  // 合并浮层：单浮层三维分段（Provider / 模型 / 思考程度，原型 .hp-pop），hairline 分隔、
  // 段标签 fs-micro；项 = menuitemradio + 14px check 格 + 当前项 accent-tint 底（think pop
  // 配方，三维统一一种「当前」表达）。三维独立可选、选定不自动关（Alex 裁决）——点 chip /
  // 空白 / Esc 关。effort 不支持时 effort 段整段禁用 + D390 说明句。
  const selPop = document.createElement("div");
  selPop.className = "lumir-hp-selpop";
  selPop.setAttribute("role", "menu");
  selPop.hidden = true;
  // effort 不支持的 hover hint（D394，ctxPop 同款 hover 泡）：只挂读数那一格，mouseenter
  // 翻出、mouseleave 收回。
  const effHint = document.createElement("div");
  effHint.className = "lumir-hp-effhint";
  effHint.hidden = true;
  modelChip.append(modelName, modelSep, effReading, modelChev);
  modelWrap.append(modelChip, selPop, effHint);

  // 不定态进度条 + 阶段指示一行（M347）：只在处理中态可见；无百分比——本轮剩余工作量
  // 前端不知道。eink 下转明度表达（见 css 的 keyframes 分叉）。
  const progress = document.createElement("div");
  progress.className = "lumir-hp-progress";
  progress.hidden = true;
  const stageLine = document.createElement("div");
  stageLine.className = "lumir-hp-stage";
  const barTrack = document.createElement("div");
  barTrack.className = "lumir-hp-bar";
  const barFill = document.createElement("div");
  barFill.className = "lumir-hp-bar-fill";
  barTrack.append(barFill);
  progress.append(stageLine, barTrack);

  // ctx% 读数（M347，自 HP1 退场的头部栏读数迁入）：usage 事件 / 快照同源消费。
  // M370 改形（Alex 2026-10-07）：读数 = 「XX% · YY%」（XX = ctx%、YY = cache hit rate，分隔符
  // 小圆点 U+00B7 与 modeline 同款（复裁决）；
  // cache_pct 纯前端消费）；越过警示阈值 → 读数高亮 + hover 读数浮出 D335 气泡——ⓘ 钮
  // （.lumir-hp-ctx-info）随原话「去掉感叹号」移除，浮层改 hover 形态（mouseenter/leave
  // 翻转，替代旧 click 翻转）。
  const ctxWrap = document.createElement("span");
  ctxWrap.className = "lumir-hp-ctxwrap";
  const ctxRead = document.createElement("span");
  ctxRead.className = "lumir-hp-ctx";
  const ctxPop = document.createElement("div");
  ctxPop.className = "lumir-hp-ctxpop";
  ctxPop.hidden = true;
  ctxWrap.append(ctxRead, ctxPop);

  // 混排编辑区（M343，change add-harness-quote-cards design §2/§5）：contenteditable div 取代
  // textarea，全 composer 唯一形态——顶层仅 .lumir-hp-qcard（原子卡片）/ .lumir-hp-qpara
  // （问题段落）两类块；无卡片时退化为纯文本输入。数据层 = 本文件头部纯模型层的块序列，
  // 序列化投递走 M342 的 serializeQuoteMessage。M351 起自身不带边框——边框/底色/圆角由
  // 外层 composer-box 承担（原型 .h-box：focus-within 出强调框）。
  const composer = document.createElement("div");
  composer.className = "lumir-hp-composer";
  composer.contentEditable = "true";
  composer.setAttribute("role", "textbox");
  composer.setAttribute("aria-multiline", "true");
  composer.spellcheck = false;
  const ctlSpacer = document.createElement("span");
  ctlSpacer.className = "lumir-hp-ctl-spacer";
  // 发送钮（M351 图标化，原型 .h-send）：26×26 accent 实心，↑ / ■ 两态 glyph 按相位显隐；
  // 可读名与悬停沿用 D329/D378（真机 AX 名断言不受影响）。glyph 取自原型 SVG，
  // 经 DOM API 构建（本模块无 innerHTML 的渲染纪律不变）。
  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.className = "lumir-hp-send";
  const sendGo = document.createElementNS(SVG_NS, "svg");
  sendGo.setAttribute("width", "13");
  sendGo.setAttribute("height", "13");
  sendGo.setAttribute("viewBox", "0 0 14 14");
  sendGo.setAttribute("fill", "none");
  sendGo.setAttribute("stroke", "currentColor");
  sendGo.setAttribute("stroke-width", "1.6");
  sendGo.setAttribute("stroke-linecap", "round");
  sendGo.setAttribute("stroke-linejoin", "round");
  sendGo.classList.add("lumir-hp-send-go");
  sendGo.setAttribute("aria-hidden", "true");
  const sendGoPath = document.createElementNS(SVG_NS, "path");
  sendGoPath.setAttribute("d", "M7 11.5v-9M3.5 6 7 2.5 10.5 6");
  sendGo.append(sendGoPath);
  const sendStop = document.createElementNS(SVG_NS, "svg");
  sendStop.setAttribute("width", "10");
  sendStop.setAttribute("height", "10");
  sendStop.setAttribute("viewBox", "0 0 12 12");
  sendStop.setAttribute("fill", "currentColor");
  sendStop.classList.add("lumir-hp-send-stop");
  sendStop.setAttribute("aria-hidden", "true");
  sendStop.setAttribute("hidden", ""); // 初始 = 发送态（SVG 无 hidden 属性映射，CSS [hidden] 兜显隐）
  const sendStopRect = document.createElementNS(SVG_NS, "rect");
  sendStopRect.setAttribute("x", "2");
  sendStopRect.setAttribute("y", "2");
  sendStopRect.setAttribute("width", "8");
  sendStopRect.setAttribute("height", "8");
  sendStopRect.setAttribute("rx", "1.5");
  sendStop.append(sendStopRect);
  sendButton.append(sendGo, sendStop);
  ctl.append(modelWrap, ctxWrap, ctlSpacer, sendButton);
  composerBox.append(composer, ctl);
  composerArea.append(chip, composerBox);

  panel.append(transcript, progress, composerArea);

  // ── 状态 ─────────────────────────────────────────────────────────────────
  /** 面板挂载的 pane 槽（null = 收起/未开）。pane 在场与否由装配层管，面板只记录挂在哪。 */
  let mountEl: HTMLElement | null = null;
  /** 发送钮两态状态机的当前相位（M347）：idle = 可发送（busy=false 的既有读法），
   *  running = 处理中（钮面停止态），stopping = 停止已请求、等终态。 */
  let sendPhase: SendPhase = "idle";
  let stageWaiting = true; // 阶段指示：首个 text_chunk 到达前 = 「等待响应」，之后 = 「生成中」。
  /** 停止钩子（M348 对接面）：处理中点击发送钮（= 停止态）时调用。面板创建即接上真实
   *  handler（调 harness_abort，中断语义 = 「不再继续」，收口等后端 aborted 终态事件）；
   *  setStopHandler 保留给装配层/测试覆盖，未注册时点击只走状态机。 */
  let stopHandler: (() => void) | null = () => {
    harnessAbort().catch((e: unknown) => {
      // harness_not_running = 轮次刚好结束的竞态（终态事件随后就到）；其余错误如实上错误行。
      // 两种情形都经 finished 收口回 idle——后端既说「没有在途轮次」，idle 就是真值相位。
      appendError(t("D348", { message: errorMessage(e) }));
      applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
    });
  };
  /** ctx% 读数（usage 事件 / 快照同源消费；null = 尚无读数，读数件整体隐藏）。 */
  let lastUsage: number | null = null;
  /** cache hit rate 读数（M370，usage 事件 / 快照的 cache_pct 字段纯前端消费；
   *  null = 读数缺失（旧事件 / 桩）——回落单读数「{ctx}%」，不伪造 cache 值）。 */
  let lastCache: number | null = null;
  /** 上下文用量警示阈值（快照 warn_ctx_pct，缺省 85——与 Rust 侧 DEFAULT_WARN_CTX_PCT 同值）。 */
  let warnCtxPct = 85;
  /** harness pane 内容字号（M378，运行期态、不落盘、不回写 config）：hpBaseFontSize = 基线
   *  （面板根字号 --fs-ui 创建时的计算值——「⌘0 回到基线」的锚，与编辑器的「回配置字号」
   *  同口径），hpFontSize = 当前生效值。缩放经 --lumir-hp-scale（= hpFontSize / 基线）
   *  施加：css 的全部 font-size 声明 calc 乘该变量（缺省 1 = 零缩放，逐字节不改基线观感）。 */
  let hpBaseFontSize = 0;
  let hpFontSize = 0;
  /** 合并选择器状态（config_get 宽容提取的 HarnessSelection；null = 未配置/读不到——
   *  桩环境 / 旧配置 / 读取失败不伪造读数，chip 隐藏）。 */
  let selSelection: HarnessSelection | null = null;
  /** 思考程度状态（M363，harness_state 快照 `thinking` 字段的宽容提取；档位会话内
   *  生效、不写回配置；随合并 chip 呈现，thinkConfigured = false 时 effort 读数留空）。 */
  let thinkConfigured = false;
  let thinkLevel = "";
  let thinkSupported = false;
  let lastChip: HarnessContextBlock | null | "none" = null;
  /** 当前逻辑会话的首条用户消息原文（会话名口径：截断约 20 字上屏；null = 未发消息，
   *  显示「新会话」）。自动压缩开新逻辑会话后归 null，按同口径重算（design §3）。 */
  let firstUserText: string | null = null;
  let streamingEl: HTMLElement | null = null;
  /** 本轮完整正文源（全部文本段的拼接）——复制源用；分段渲染不改变它。 */
  let streamingText = "";
  /** 轮次闸门（M374）：sent 开、done / aborted / error 关。关闭期间到达的内容事件
   *  （text_chunk / reasoning_chunk / tool_call / usage / compact）一律丢弃——已取消
   *  （或已结束）的轮次迟到产出不得再进消息流。已知边界：webview 重载后在途轮次没有
   *  快照标记可重建本闸门，该轮的流式产出会被丢弃（如实登记，不伪造「正在运行」）。 */
  let turnOpen = false;
  /** 本轮的思考块（M363）：reasoning_chunk 事件的累加数据与「有待 rAF 重渲」脏标记。
   *  轮次终态经 finalizeStreamingMessage 定格（数据引用释放，DOM 元素留在消息内）。 */
  let thinkingBlocks: ThinkingBlock[] = [];
  let thinkingDirty = false;
  /** 内容事件的到达序号（M383）：text_chunk / reasoning_chunk 各领一个单调递增号——思考块
   *  视图与正文段的**结构性创建**按到达序合并落位（「DOM 序 = 事件序」合同，见
   *  flushPendingStructures；旧实现把思考块一律锚到首个正文段之前，交错时倒置）。 */
  let arrivalSeq = 0;
  /** 有待落位的思考块视图创建（块序号 + 首分片到达序）；元素创建仍守 rAF 合帧纪律，
   *  在 flush 时按 seq 与正文段创建合并排序。 */
  let pendingThinkCreates: Array<{ index: number; seq: number }> = [];
  /** 缓冲正文首 chunk 的到达序：正文段创建的排序位次（null = 缓冲为空）。同帧内
   *  text↔think 交错到达时，段位次与思考块位次按 seq 排序决定谁先落位。 */
  let pendingSegSeq: number | null = null;
  /** 文本段（M374）：消息本体是「文本段 + 工具块」按到达序交错的序列——工具行留在
   *  它发生的那处文本段之前，不再被整体挪到消息末尾（M368 挂消息级的挂点是末尾，
   *  与「工具先于正文发生」的真实时序倒挂）。段容器 = .lumir-hp-body（样式同源），
   *  内部维持「已完成块冻结 + 末块随 chunk 重渲」的增量渲染。 */
  interface TextSegment {
    el: HTMLElement;
    tailEl: HTMLElement;
    source: string;
    renderedFinalized: number;
  }
  let textSegments: TextSegment[] = [];
  /** 当前文本段（正文 chunk 的落点）。工具块在场后首个 chunk 开出新段（落在工具块
   *  之后）；null = 本轮尚无正文（工具先行 / 纯思考 / 零产出是常态）。 */
  let currentSeg: TextSegment | null = null;
  let chunkBuffer = "";
  let flushScheduled = false;
  const pendingApprovals = new Map<string, PendingApproval>();
  /** 已决策批准项的记录视图（M384）：决策后卡片收敛为终态记录，但记录里的结果词 / 相对
   *  时间 / 详情摘要随语言与 30s 时钟重绘——保留重渲所需的字段引用（与 PendingApproval
   *  的 relabel 口径同：交互中的 UI 跟语言走，已上屏正文不改写）。 */
  interface DecidedApproval {
    id: string;
    tool: string;
    approved: boolean;
    reason: string | undefined;
    ts: number;
    element: HTMLElement;
    outcomeEl: HTMLElement;
    whenEl: HTMLElement;
    reasonEl: HTMLElement | null;
    summaryEl: HTMLElement | null;
  }
  const decidedApprovals = new Map<string, DecidedApproval>();
  /** 当前轮次的工具清单块（M351 还原原型屏 4 清单形态，change harness-pane-visual-fidelity
   *  design §3.3）：挂进当前 agent 消息（它发生的位置——段之间或消息尾）；一轮一块；
   *  轮次终态经 collapseTools 收尾（≥2 行折叠为一行摘要，单行保持展开）。 */
  interface ToolsBlock {
    el: HTMLElement;
    rows: HTMLElement[];
    running: HTMLElement | null;
  }
  let activeTools: ToolsBlock | null = null;
  /** 已封板的工具块（开出新文本段时旧块封板）——定稿时与在途块一起折叠。 */
  let sealedToolBlocks: ToolsBlock[] = [];
  /** 最近一条 assistant 消息（快照恢复路径的工具记录挂点；live 路径恒为 streamingEl）。 */
  let lastAssistantEl: HTMLElement | null = null;
  /** when 的低频刷新定时器（30s；attach 起、detach 清——meta chrome，不在
   *  keypress-to-paint 路径，ADR 0002 §6）。 */
  let whenTimer: number | null = null;
  /** 上下文 chip 的会话身份看守（M370）：refreshChip 的旧触发集（composer 获焦 / 发送 /
   *  切 vault / 挂载）不含**文档打开与标签切换**——装配层没有现成的事件通道向面板广播
   *  活跃会话变化，而面板能稳定读到的只有 editor.activeSession()（复合句柄，活跃 pane
   *  解析）。最小钩子因此是**身份比对看守**：attach 期间每 400ms 比一次会话引用，
   *  变了才 refreshChip（读取 + 比对是冷路径上的微量工作；chromium 事件通道 / CM 热路径
   *  零新增消费者）。 */
  let chipWatchTimer: number | null = null;
  let watchedSession: unknown = null;
  /** 错误去重（design §6，finding 20261006-tower-bug-harness-pane）：最后一条错误行与
   *  其文案——同文案就地滚回视野，不追加堆叠。 */
  let lastErrorEl: HTMLElement | null = null;
  let lastErrorText = "";
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
    // toggle 钮面是图标（D326 已退场）——可读身份只剩悬停提示 / 读屏名（D327）与
    // 面板容器读屏名，二者共用一句。
    toggleButton.title = t("D327");
    toggleButton.setAttribute("aria-label", t("D327"));
    panel.setAttribute("aria-label", t("D327"));
    seg.setAttribute("aria-label", t("D375"));
    // 加号钮的可见文字已退场（M406）：可读身份只剩悬停提示 / 读屏名（与 toggle 钮同口径）。
    segNew.title = t("D330");
    segNew.setAttribute("aria-label", t("D330"));
    applySessionName();
    composer.dataset.placeholder = t("D328");
    composer.setAttribute("aria-label", t("D328"));
    emptyHint.textContent = t("D346");
    applyChip();
    applySelChip();
    rebuildSelPopIfOpen();
    applyUsage();
    // 发送钮 / 阶段指示按当前相位重取文案（running 时钮面是「停止」、进度条阶段行重渲）。
    applySendPhase(sendPhase);
    // 待决批准项是交互中的 UI（不是历史记录）：随语言重渲按钮与标题，输入框内容保留。
    for (const pending of pendingApprovals.values()) relabelApproval(pending);
    // 已决策的终态记录同口径：结果词 / 原因句 / 详情摘要重取文案（正文性质的时间戳由
    // refreshWhoLines 按当前语言与时刻重算）。
    for (const rec of decidedApprovals.values()) relabelDecided(rec);
    // who/when meta 行与工具折叠摘要是 meta chrome（非消息正文）：随语言重绘——消息正文
    // 不改写（已上屏内容不随语言翻，与徽标同口径）。
    refreshWhoLines();
    relabelToolSummaries();
    relabelThinkingViews();
  }

  // ── harness pane 内容字号步进（M378，与内容 pane 的 textScale 同语义）──────────
  // 基线惰性捕获：第一次步进时读面板根字号 --fs-ui 的计算值（调用点必在面板已挂载、可
  // 持焦之后——捕获时样式链完整；创建时面板尚未进 DOM，不在这里读）。运行期只写面板根上的
  // --lumir-hp-scale（单一写入路径）——面板摘出 / 重挂不丢（元素长驻），不落盘、不回写
  // config.json（与内容 pane 的持久化口径逐条对齐，不新造口径）。
  // getComputedStyle 的守卫：tests/unit 的假 DOM 没有它——回退 13（--fs-ui 现值，与
  // src/style.css 的声明同值同口径；浏览器里永远走真读数分支）。
  function harnessBaseFontSize(): number {
    if (hpBaseFontSize === 0) {
      hpBaseFontSize =
        typeof getComputedStyle === "function"
          ? Number.parseFloat(getComputedStyle(panel).fontSize) || 13
          : 13;
      hpFontSize = hpBaseFontSize;
    }
    return hpBaseFontSize;
  }

  function applyHarnessTextScale(): void {
    const base = harnessBaseFontSize();
    panel.style.setProperty("--lumir-hp-scale", String(hpFontSize / base));
  }

  // ── 会话名（标题栏 harness 段的会话身份；design §3 口径）───────────────────
  // 截断口径的单一真源在模块级（truncateSessionName / SESSION_NAME_MAX）——恢复选择器的
  // 会话行与这里共用同一份（design §6.1）。

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
    sname.textContent = truncateSessionName(firstUserText);
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

  /** 上下文 chip 刷新（发送前可核对）：打开面板 / 输入框获焦 / 卡片增减 / 发送后重取，
   *  以及会话身份看守发现的**文档打开 / 标签切换**（M370——消除「开着文件却显示
   *  Context: none」，旧触发集要等 composer 获焦才刷新）。不挂编辑器选区监听——
   *  「发送前」的核对窗口由这几处覆盖，常挂监听是给编辑器热路径加常驻消费者的反面教材
   *  （ADR 0002 §6）；看守只比会话**身份**（引用），不比视口内容，滚动不触发。 */
  function refreshChip(): void {
    watchedSession = editor.activeSession();
    const block = assembleHarnessContext(editor, { skipViewport: composerHasCards() });
    lastChip = block ?? "none";
    applyChip();
  }

  /** 会话身份看守的拍函数（400ms 定时器驱动）：引用变了才重取 chip——重取内 assembly
   *  读活跃 pane 的 state + 视口切片，只在身份变化那一拍付出，稳态零成本。 */
  function watchActiveSession(): void {
    const session = editor.activeSession();
    if (session === watchedSession) return;
    refreshChip();
  }

  // ── composer 控制行（M373）：合并选择器 chip（model · effort）+ 三维浮层 ──────

  /** 合并 chip 重渲（长驻元素：读数 / 悬停 / 读屏名都从已存状态取，relabel 可重跑）。
   *  可见文本 = model 读数 + U+00B7 + effort 读数。读屏名四档（D399 / D393 / D390 /
   *  D403）：effort 会话态未读到（thinkConfigured=false——harness_state 未到达 / 读取
   *  失败的降级窗口，真实 app 不可达）= D399 中性「未知」——MUST NOT 取 D390：「不支持」
   *  是能力断言，与「还没读到」语义相反（r1 P2-3）；支持态 = D393；不支持 = D390 + 读数
   *  置灰（.is-disabled，text-3）+ hover hint（D394）；model 读数为空（M381 config-only
   *  的空清单态——models 未声明任何模型）= D403：model 名与分隔符收起（不伪造读数），
   *  hover hint 改 D402 提示态。思考状态未配置时 effort 读数留空、分隔符收起、不置灰
   *  （置灰同是能力断言）。 */
  function applySelChip(): void {
    if (selSelection === null) {
      modelChip.hidden = true;
      return;
    }
    modelChip.hidden = false;
    const model = chipModelReading(selSelection);
    modelName.textContent = model;
    // M381 空清单态：model 名收起（不伪造读数），分隔符随之收起——裸 effort 读数不留
    // 悬空小圆点。
    modelName.hidden = model === "";
    modelSep.hidden = model === "" || !thinkConfigured;
    effReading.textContent = thinkConfigured ? effortLabel(thinkLevel) : "";
    effReading.classList.toggle("is-disabled", thinkConfigured && !thinkSupported);
    const label =
      model === ""
        ? t("D403", { level: effortLabel(thinkLevel) })
        : !thinkConfigured
          ? t("D399", { model })
          : thinkSupported
            ? t("D393", { model, level: effortLabel(thinkLevel) })
            : t("D390");
    modelChip.title = label;
    modelChip.setAttribute("aria-label", label);
    effHint.textContent =
      model === ""
        ? t("D402", { provider: selSelection.provider })
        : t("D394", { model });
  }

  /** 勾选项的 check 格（think pop 配方：14px 固定宽，未勾选留空保证纵对齐）。 */
  function appendCheck(parent: HTMLElement, checked: boolean): void {
    const check = document.createElement("span");
    check.className = "lumir-hp-selpop-check";
    check.setAttribute("aria-hidden", "true");
    if (checked) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", "11");
      svg.setAttribute("height", "11");
      svg.setAttribute("viewBox", "0 0 12 12");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.6");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", "M2 6.5 4.8 9.3 10 3.5");
      svg.append(path);
      check.append(svg);
    }
    parent.append(check);
  }

  /** 合并浮层：每次打开现建（三维读数随当前语言与状态，懒建不囤旧串）；选定后重开也现建
   *  （选定不自动关——多维一次调齐，读数刷新靠重建）。段 = 段标签（fs-micro）+ 裸项列表；
   *  项 = menuitemradio + check 格 + 读数名（provider / model id / 档位名均为配置值读数，
   *  不译文）+ 当前项 accent-tint 底。 */
  function buildSelPop(): void {
    selPop.replaceChildren();
    if (selSelection === null) return;
    selPop.setAttribute("aria-label", t("D398"));
    const cur = selSelection.provider;
    // 段一：Provider（mock 已在提取层过滤——这里列出的就是可选集合）。
    const provSec = document.createElement("div");
    provSec.className = "lumir-hp-selpop-sec";
    const provLabel = document.createElement("div");
    provLabel.className = "lumir-hp-selpop-label";
    provLabel.textContent = t("D396");
    provSec.append(provLabel);
    for (const id of selSelection.providerOptions) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "lumir-hp-selpop-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(id === cur));
      appendCheck(item, id === cur);
      const name = document.createElement("span");
      name.className = "lumir-hp-selpop-name";
      name.textContent = id;
      item.append(name);
      if (id === cur) item.classList.add("is-current");
      // stopPropagation：选择后同步重建会把本项摘出 DOM，不拦住这拍冒泡会被
      // document 的「浮层外点击收起」误判成外部点击（contains 守卫对游离节点为 false）。
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        selectProvider(id);
      });
      provSec.append(item);
    }
    selPop.append(provSec);
    // 段二：模型（当前 provider 的 model 维度；无维度（mock）→ 整段不渲染；M381 config-only：
    // 声明清单为空 → 段照渲染但只含 D402 提示态——不得伪造模型条目）。
    const dim = selSelection.models[cur as ProviderId];
    if (dim !== undefined) {
      const modelSec = document.createElement("div");
      modelSec.className = "lumir-hp-selpop-sec";
      const modelLabel = document.createElement("div");
      modelLabel.className = "lumir-hp-selpop-label";
      modelLabel.textContent = t("D397");
      modelSec.append(modelLabel);
      if (dim.options.length === 0) {
        const hint = document.createElement("div");
        hint.className = "lumir-hp-selpop-hint";
        hint.textContent = t("D402", { provider: cur });
        modelSec.append(hint);
      } else {
        for (const option of dim.options) {
          const checked = option.id === dim.current;
          const item = document.createElement("button");
          item.type = "button";
          item.className = "lumir-hp-selpop-item";
          item.setAttribute("role", "menuitemradio");
          item.setAttribute("aria-checked", String(checked));
          appendCheck(item, checked);
          const name = document.createElement("span");
          name.className = "lumir-hp-selpop-name";
          name.textContent = option.id;
          item.append(name);
          if (checked) item.classList.add("is-current");
          item.addEventListener("click", (event) => {
            event.stopPropagation();
            selectModel(option.id);
          });
          modelSec.append(item);
        }
      }
      selPop.append(modelSec);
    }
    // 段三：思考程度（不支持时整段禁用 + D390 说明句——项不可点，读数仍列出）。
    const effSec = document.createElement("div");
    effSec.className = "lumir-hp-selpop-sec";
    if (!thinkSupported) effSec.classList.add("is-disabled");
    const effLabelEl = document.createElement("div");
    effLabelEl.className = "lumir-hp-selpop-label";
    effLabelEl.textContent = t("D392");
    effSec.append(effLabelEl);
    for (const id of THINKING_EFFORTS) {
      const checked = id === thinkLevel;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "lumir-hp-selpop-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(checked));
      appendCheck(item, checked);
      const name = document.createElement("span");
      name.className = "lumir-hp-selpop-name";
      name.textContent = effortLabel(id);
      item.append(name);
      if (checked) item.classList.add("is-current");
      if (thinkSupported) {
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          selectEffort(id);
        });
      } else {
        item.setAttribute("aria-disabled", "true");
      }
      effSec.append(item);
    }
    if (!thinkSupported) {
      const hint = document.createElement("div");
      hint.className = "lumir-hp-selpop-hint";
      hint.textContent = t("D390");
      effSec.append(hint);
    }
    selPop.append(effSec);
  }

  /** 合并浮层开合（aria-expanded 随开合翻转；打开时现建三维分段；选定不自动关——
   *  关闭只走 chip 再点 / 浮层外点击 / Esc 三条路，Alex 裁决）。 */
  function setSelPop(open: boolean): void {
    if (open) buildSelPop();
    selPop.hidden = !open;
    modelChip.setAttribute("aria-expanded", String(open));
  }

  /** 浮层开着时重建设（三维读数随选择刷新；选定不关浮层，重建就是它刷新的方式）。 */
  function rebuildSelPopIfOpen(): void {
    if (!selPop.hidden) buildSelPop();
  }

  /** 选择 provider：chip 先更新读数（chip = 人侧可见面，模型与用量对人同源同值），
   *  写回失败则回滚读数——运行期态不与文件态分叉（D123 同口径），并报错误行。
   *  **切 provider 不抹 effort**（档位会话内生效，与 provider 无关）与 model（每个
   *  provider 的 model 是各自配置键，切回即恢复）。写回成功后重取思考能力标记
   *  （`thinking.supported` 按当前 provider + model 现算——只读快照的 thinking 字段，
   *  不回放消息，不重渲 transcript）。 */
  function selectProvider(id: ProviderId): void {
    if (selSelection === null || id === selSelection.provider) return;
    const previous = selSelection.provider;
    selSelection.provider = id;
    applySelChip();
    rebuildSelPopIfOpen();
    configSetValue("harness", "provider", id).then(() => {
      refreshThinkingState();
    }).catch((e: unknown) => {
      selSelection!.provider = previous;
      applySelChip();
      rebuildSelPopIfOpen();
      appendError(t("D348", { message: errorMessage(e) }));
    });
  }

  /** 选择 model：写回 `[harness].providers.<当前 provider>.model`（点分嵌套键，写通道
   *  M373 泛化）——「每个 provider 记住自己的 model」的数据面；选择先行、失败回滚同
   *  selectProvider。写回成功后重取思考能力标记（换模型可能换 effort 能力）。 */
  function selectModel(id: string): void {
    if (selSelection === null) return;
    const dim = selSelection.models[selSelection.provider as ProviderId];
    if (dim === undefined || id === dim.current) return;
    const provider = selSelection.provider;
    const previous = dim.current;
    dim.current = id;
    applySelChip();
    rebuildSelPopIfOpen();
    configSetValue("harness", `providers.${provider}.model`, id).then(() => {
      refreshThinkingState();
    }).catch((e: unknown) => {
      const dimBack = selSelection!.models[provider as ProviderId];
      if (dimBack !== undefined) dimBack.current = previous;
      applySelChip();
      rebuildSelPopIfOpen();
      appendError(t("D348", { message: errorMessage(e) }));
    });
  }

  /** 选择档位：chip 先更新读数（chip = 人侧可见面），失败回滚 + 错误行——与
   *  selectProvider 同口径。档位会话内生效（harness_set_thinking_effort 写入当前会话；
   *  无会话时后端即时建会话，前端无需先发消息）；选定不关浮层（浮层内可连续调档）。 */
  function selectEffort(id: ThinkingEffort): void {
    if (id === thinkLevel) return;
    const previous = thinkLevel;
    thinkLevel = id;
    applySelChip();
    rebuildSelPopIfOpen();
    harnessSetThinkingEffort(id).catch((e: unknown) => {
      thinkLevel = previous;
      applySelChip();
      rebuildSelPopIfOpen();
      appendError(t("D348", { message: errorMessage(e) }));
    });
  }

  modelChip.addEventListener("click", (event) => {
    event.stopPropagation();
    setSelPop(selPop.hidden);
  });

  // effort 不支持的 hover hint：mouseenter 读数翻出（仅置灰态），mouseleave 收回——
  // 与 ctx 读数 hover 泡同一形态（M370）。键盘用户无 hover：不支持语义已由读屏名（D390）承担。
  effReading.addEventListener("mouseenter", () => {
    if (effReading.classList.contains("is-disabled")) effHint.hidden = false;
  });
  effReading.addEventListener("mouseleave", () => {
    effHint.hidden = true;
  });

  // 合并 chip 数据装载：config_get 宽容提取（harness 段缺失 → chip 隐藏，不伪造读数）。
  configGet()
    .then((snapshot) => {
      const selection = harnessSelection(snapshot.config.harness);
      if (selection === null) return;
      selSelection = selection;
      modelChip.hidden = false;
      applySelChip();
    })
    .catch(() => {});

  /** 轻量重取思考状态（provider / model 切换后）：只读快照的 thinking 字段应用进 chip，
   *  不回放消息、不动 transcript（快照准入判据与全量恢复同一条——迟到的旧 vault
   *  响应在此同样被丢）。 */
  function refreshThinkingState(): void {
    void harnessState()
      .then((json) => {
        let snapshot: unknown;
        try {
          snapshot = JSON.parse(json);
        } catch {
          return;
        }
        if (typeof snapshot !== "object" || snapshot === null) return;
        if (!inCurrentVault((snapshot as { vault?: unknown }).vault, currentVault)) return;
        const thinking = thinkingStateOf(snapshot);
        if (thinking === null) return;
        thinkConfigured = true;
        thinkLevel = thinking.level;
        thinkSupported = thinking.supported;
        applySelChip();
        // 能力标记可能随 provider/model 切换翻转——浮层开着时 effort 段随之重建
        // （置灰 / 禁用是浮层内容，不重建会停在旧档）。
        rebuildSelPopIfOpen();
      })
      .catch(() => {});
  }

  /** ctx% 读数重渲（usage 事件 / 快照 / relabel 的共用出口）。M370：读数 = D334 双读数
   *  「{ctx}% · {cache}%」（分隔符 U+00B7，cache 缺失回落单读数）；越线高亮不动。
   *  M373：hover 浮层常驻含义句；M378 改两行带值形态（D395 第一行 + D401 第二行，
   *  越线时 D335 警示句追加其下）并按面板边界收编（clampCtxPop）。浮层内容在 hover 时现建。 */
  function applyUsage(): void {
    if (lastUsage === null) {
      ctxWrap.hidden = true;
      return;
    }
    ctxWrap.hidden = false;
    const ctx = Math.round(lastUsage);
    const over = usageOverWarn(lastUsage, warnCtxPct);
    ctxRead.textContent =
      lastCache === null
        ? `${ctx}%`
        : t("D334", { ctx, cache: Math.round(lastCache) });
    ctxRead.classList.toggle("is-warn", over);
    if (ctxPop.hidden === false) {
      buildCtxPop();
      clampCtxPop();
    }
  }

  /** ctx hover 浮层内容现建（M378 两行带值形态）：第一行上下文窗口占用（D395，{ctx} =
   *  当时的实际读数）、第二行 cache hit rate（D401，cache 读数缺失时整行不渲染）；
   *  越线时警示句（D335）追加在两行之下（同泡第三行，追加行为保留）。 */
  function buildCtxPop(): void {
    ctxPop.replaceChildren();
    const meaning = document.createElement("div");
    meaning.className = "lumir-hp-ctxpop-meaning";
    meaning.textContent = t("D395", { ctx: Math.round(lastUsage ?? 0) });
    ctxPop.append(meaning);
    if (lastCache !== null) {
      const cache = document.createElement("div");
      cache.className = "lumir-hp-ctxpop-cache";
      cache.textContent = t("D401", { cache: Math.round(lastCache) });
      ctxPop.append(cache);
    }
    if (ctxRead.classList.contains("is-warn")) {
      const warn = document.createElement("div");
      warn.className = "lumir-hp-ctxpop-warn";
      warn.textContent = t("D335", {
        ctx: Math.round(lastUsage ?? 0),
        warn: Math.round(warnCtxPct),
      });
      ctxPop.append(warn);
    }
  }

  /** hover 泡水平收编（M378，hint 显示不全的根因修复）：浮层默认锚 right:-18px、宽 224px，
   *  向左探出 ~206px，祖先 .lumir-harness 有 overflow:hidden——面板窄时左缘被裁。翻出时
   *  按面板可视边界收编：超宽先收窄（width），再两侧各留 8px 移位（CSS translate）。
   *  先复位后量测，重复调用幂等；未越界时零干预（translate / width 均不动，默认形态不变）。 */
  function clampCtxPop(): void {
    ctxPop.style.translate = "";
    ctxPop.style.width = "";
    const panelRect = panel.getBoundingClientRect();
    const maxWidth = Math.max(120, panelRect.width - 16);
    if (ctxPop.offsetWidth > maxWidth) ctxPop.style.width = `${maxWidth}px`;
    const popRect = ctxPop.getBoundingClientRect();
    const inset = 8;
    let shift = 0;
    if (popRect.left < panelRect.left + inset) {
      shift = panelRect.left + inset - popRect.left;
    } else if (popRect.right > panelRect.right - inset) {
      shift = panelRect.right - inset - popRect.right;
    }
    if (shift !== 0) ctxPop.style.translate = `${shift}px 0`;
  }

  // hover 浮层（M370 形态，M373 扩内容，M378 两行带值 + 边界收编）：mouseenter 读数翻出
  // （第一行 ctx 占用、第二行 cache 命中，越线时追加警示句）、mouseleave 收回。键盘用户
  // 无 hover：警示语义已由读数高亮承担，含义句是补充说明，不挂 focusable 入口。
  ctxWrap.addEventListener("mouseenter", () => {
    buildCtxPop();
    ctxPop.hidden = false;
    clampCtxPop();
  });
  ctxWrap.addEventListener("mouseleave", () => {
    ctxPop.hidden = true;
  });

  /** 发送钮相位施加：机器算出的每个新相位经这一处落 DOM（glyph 显隐 / 可读名 / 可点性 /
   *  进度条显隐），不第二处写按钮。running = 可点（点击 = 停止）；stopping = 禁用（连点幂等）。
   *  M351 图标化：钮面是两枚 SVG glyph（↑ 发送 / ■ 停止），D329/D378 落 title 与 aria-label
   *  ——textContent 赋值会抹掉 glyph 子节点，可读名不能再走钮面文本。 */
  function applySendPhase(next: SendPhase): void {
    sendPhase = next;
    const running = next !== "idle";
    sendButton.classList.toggle("is-busy", running);
    const label = running ? t("D378") : t("D329");
    sendButton.title = label;
    sendButton.setAttribute("aria-label", label);
    // SVG 元素无 hidden IDL 属性（TS2339）——显隐走 attribute（CSS 的 [hidden] 规则兜 display）。
    sendGo.toggleAttribute("hidden", running);
    sendStop.toggleAttribute("hidden", !running);
    sendButton.disabled = next === "stopping";
    progress.hidden = !running;
    if (running) applyStage();
  }

  /** 阶段行施加（applySendPhase 的 running 分支调用）。stopping 相位第一时间换 D400
   *  「正在停止…」——停止反馈的即时性由前端这半承担（后端收口前，状态不再停在
   *  「等待响应 / 正在生成回复」的误读上，M374）；running 态维持两档：首个 chunk 前
   *  「等待响应」，之后「正在生成回复」。 */
  function applyStage(): void {
    stageLine.textContent =
      sendPhase === "stopping" ? t("D400") : stageWaiting ? t("D381") : t("D382");
  }

  sendButton.addEventListener("click", () => {
    if (sendPhase !== "running") return;
    // 停止路径：状态机先行（running → stopping，挡连点），再调停止钩子——M348 接通 Rust
    // abort 前，钩子是 null，点击只走状态机直到本轮 finished 回 idle。
    applySendPhase(reduceSendPhase(sendPhase, { type: "stop-clicked" }));
    stopHandler?.();
  });

  /** 消息复制源（单一真源纪律）：渲染时就地把源文本挂到消息元素——agent = 模型原始输出
   *  （Markdown 源），用户 = 发送前原始输入（序列化文本）；复制只从这里取，复制出的因此
   *  绝不是渲染后 HTML。 */
  const copySources = new WeakMap<HTMLElement, string>();

  /** hover 浮现的复制钮：点击写剪贴板，成功把钮面就地换成 ✓ 反馈（约 1.5s 消退，D380）。 */
  function attachCopyButton(el: HTMLElement, source: string): void {
    copySources.set(el, source);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lumir-hp-copy";
    btn.setAttribute("aria-label", t("D379"));
    btn.textContent = "⧉"; // i18n-exempt: glyph（双页复制图标图形，非文案）
    let revertTimer: number | undefined;
    btn.addEventListener("click", () => {
      const text = copySources.get(el);
      if (text === undefined) return;
      navigator.clipboard.writeText(text).then(() => {
        window.clearTimeout(revertTimer);
        btn.textContent = t("D380");
        btn.classList.add("is-copied");
        revertTimer = window.setTimeout(() => {
          btn.textContent = "⧉"; // i18n-exempt: glyph
          btn.classList.remove("is-copied");
        }, 1500);
      }).catch(() => {}); // 剪贴板不可用：钮面不动，不伪造成功反馈。
    });
    el.append(btn);
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

  // ── 消息 meta 行（M351，design §3.1/§4）：who（角色）+ when（相对时间）─────────────
  /** 建 who 行：角色 span + 可选 when span（at = 上屏时间戳 ms；null = 无戳不建——快照
   *  恢复的历史消息无戳，只显示角色，不伪造读数）。when 文本 = 「· 」间隔号（i18n-exempt
   *  标点）+ relativeWhen；初始值立即算一次（不等 30s 刷新拍）。 */
  function createWhoLine(role: "user" | "assistant", at: number | null): HTMLElement {
    const who = document.createElement("div");
    who.className = "lumir-hp-who";
    who.dataset.role = role;
    const roleEl = document.createElement("span");
    roleEl.className = "lumir-hp-role";
    roleEl.textContent = t(role === "user" ? "D385" : "D386");
    who.append(roleEl);
    if (at !== null) {
      const when = document.createElement("span");
      when.className = "lumir-hp-when";
      when.dataset.ts = String(at);
      when.textContent = `· ${relativeWhen(at, Date.now())}`;
      who.append(when);
    }
    return who;
  }

  /** who/when 重绘共用出口：30s 定时器与 applyLabels（语言切换）都走这里——角色名随语言、
   *  when 随时间与语言重算；消息正文不改写。 */
  function refreshWhoLines(): void {
    const now = Date.now();
    for (const who of transcript.querySelectorAll<HTMLElement>(".lumir-hp-who")) {
      const roleEl = who.querySelector(".lumir-hp-role");
      if (roleEl !== null) roleEl.textContent = t(who.dataset.role === "user" ? "D385" : "D386");
      const when = who.querySelector<HTMLElement>(".lumir-hp-when");
      if (when?.dataset.ts !== undefined) {
        when.textContent = `· ${relativeWhen(Number(when.dataset.ts), now)}`;
      }
    }
    // 批准决策记录的相对时间戳同口径（M384）：30s 定时器驱动，与 who 行的 when 一致重算。
    for (const rec of decidedApprovals.values()) {
      rec.whenEl.textContent = `· ${relativeWhen(rec.ts, now)}`;
    }
  }

  /**
   * 用户消息同构沉淀（add-harness-quote-cards spec「发送后同构沉淀」）：卡片与问题段落
   * 按交错顺序上下排布，卡片无 ×、可点击跳回（QC3 注册处理器后生效）。空段落不渲染
   * （序列化也不产出，视觉与数据同形）。source = 发送前原始输入（序列化文本）——
   * 复制钮的源，非渲染后 HTML。at = 上屏时间戳（快照恢复传 null：无戳不显示 when）。
   * M351：结构 = who 行 + body 体（气泡样式挂 body，design §3.1）。
   */
  function appendUserMessage(blocks: readonly ComposerBlock[], source: string, at: number | null): void {
    collapseTools(); // 新用户消息 = 上一轮终态（幂等，无在途块时无操作）
    const el = document.createElement("div");
    el.className = "lumir-hp-msg lumir-hp-msg-user";
    el.append(createWhoLine("user", at));
    const body = document.createElement("div");
    body.className = "lumir-hp-body";
    for (const block of blocks) {
      if (block.kind === "quote") {
        body.append(createCardEl(block.card, "transcript"));
      } else if (block.text !== "") {
        const p = document.createElement("div");
        p.className = "lumir-hp-qtext";
        p.textContent = block.text;
        body.append(p);
      }
    }
    if (body.childElementCount === 0) {
      // 全空消息（理论路径：快照里全是空段落）——沉淀一条空泡，与 Rust 侧留存记录一致。
      body.textContent = "";
    }
    el.append(body);
    if (source !== "") attachCopyButton(el, source);
    transcript.append(el);
    lastAssistantEl = null; // 用户消息开新轮：恢复路径的工具记录挂点作废
    syncEmptyHint();
    scrollToBottom();
  }

  // ── 工具调用清单（M351 还原原型屏 4 形态，design §2.4/§3.3；Alex 2026-10-06 裁决）──
  /** 步骤行图标（i18n-exempt 图形）：done = ✓、fail = ✕（原型 SVG，颜色经 .is-done /
   *  .is-fail / .is-rej 的 --ok / --danger 上色）；running = 脉冲点（CSS 呼吸动画，--run 色）。 */
  function createToolIcon(kind: "running" | "done" | "fail"): HTMLElement {
    const ic = document.createElement("span");
    ic.className = "lumir-hp-tool-ic";
    ic.setAttribute("aria-hidden", "true");
    if (kind !== "running") {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", "11");
      svg.setAttribute("height", "11");
      svg.setAttribute("viewBox", "0 0 12 12");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.6");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute(
        "d",
        kind === "done" ? "M2 6.5 4.8 9.3 10 3.5" : "M3.5 3.5l5 5M8.5 3.5l-5 5",
      );
      svg.append(path);
      ic.append(svg);
    } else {
      const pulse = document.createElement("span");
      pulse.className = "lumir-hp-tool-pulse";
      ic.append(pulse);
    }
    return ic;
  }

  /** 工具行的三段式文本（M406 摘要人话化 + Alex 区分度精化，原型 .ttext）：工具名徽章
   *（mono，身份）+ 关键参数全文（mono accent，等宽完整显示命令 / 文件名）+ 可选尾注
   *（次级读数：等待批准 / 失败摘要等）。截断只落参数段（CSS ellipsis），尾注不截。 */
  function createToolText(name: string, args: string, tail?: string): HTMLElement {
    const text = document.createElement("span");
    text.className = "lumir-hp-tool-text";
    const nameEl = document.createElement("span");
    nameEl.className = "lumir-hp-tool-name";
    nameEl.textContent = name;
    text.append(nameEl);
    if (args !== "") {
      const argsEl = document.createElement("span");
      argsEl.className = "lumir-hp-tool-args";
      argsEl.textContent = args;
      text.append(document.createTextNode(" "), argsEl);
    }
    if (tail !== undefined && tail !== "") {
      const outEl = document.createElement("span");
      outEl.className = "lumir-hp-tool-out";
      outEl.textContent = `· ${tail}`;
      text.append(document.createTextNode(" "), outEl);
    }
    return text;
  }

  function createToolLabel(text: string): HTMLElement {
    const label = document.createElement("span");
    label.className = "lumir-hp-tool-text";
    label.textContent = text;
    return label;
  }

  /** 当前轮次的清单块（无则建）：live 路径挂在当前流式 agent 消息的**当时末尾**——
   *  即它发生的位置（段之间或消息尾）；恢复路径挂 lastAssistantEl；都无 = 孤儿工具
   *  记录（协议外）兜底挂 transcript 末尾。新文本段开出时旧块封板（sealedToolBlocks）。 */
  function ensureToolsBlock(): ToolsBlock {
    // 先把缓冲里的正文与待落位结构落进当前帧（M383：正文 chunk 的 rAF 合帧可能还没跑，
    // 而工具事件是同步处理的——不先落的话，缓冲中的正文会开新段跑到工具块之后，时序再
    // 倒置）。flush 必须在「在途块判空」**之前**：同帧 tool→think→tool 时，思考的落位会把
    // 在途块封板（placeThinkingView），TOOL2 因此开新块；判空在前的话 TOOL2 先进旧块、
    // 封板失效（r1 评审 P2）。flush 对在途块无害：无缓冲正文 / 无待落位结构时立即返回。
    flushChunks();
    if (activeTools !== null) return activeTools;
    const el = document.createElement("div");
    el.className = "lumir-hp-tools";
    const host = streamingEl ?? lastAssistantEl;
    if (host !== null) host.append(el);
    else transcript.append(el);
    activeTools = { el, rows: [], running: null };
    // 工具块落位后，其后的正文必须开新段（留在工具块之后）——currentSeg 封在这里：
    // 不清的话下一轮正文会继续追加进工具块之前的旧段，工具行被埋回消息末尾（M374 的
    // 时序倒置在「段后还有正文」的轮次里复现）。
    currentSeg = null;
    return activeTools;
  }

  /** 轮次终态收尾（幂等；done / aborted / error 经 finalizeStreamingMessage 共用本出口，
   *  新用户消息与恢复路径在 appendUserMessage / restoreSnapshot 各调一次）：≥2 行的块
   *  折叠为一行摘要钮（data-count 存行数，applyLabels 经 relabelToolSummaries 重渲），
   *  点击展开回看；单行块保持展开（唯一一行本身就是信息，折叠反而藏信息）。 */
  function collapseTools(): void {
    const block = activeTools;
    activeTools = null;
    if (block !== null) collapseBlock(block);
  }

  /** 单个工具块的折叠收尾（在途块与封板块共用）。 */
  function collapseBlock(block: ToolsBlock): void {
    if (block.rows.length < 2) return;
    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "lumir-hp-tool-summary";
    summary.dataset.count = String(block.rows.length);
    summary.setAttribute("aria-expanded", "false");
    const chev = document.createElementNS(SVG_NS, "svg");
    chev.setAttribute("width", "9");
    chev.setAttribute("height", "9");
    chev.setAttribute("viewBox", "0 0 10 10");
    chev.setAttribute("fill", "none");
    chev.setAttribute("stroke", "currentColor");
    chev.setAttribute("stroke-width", "1.5");
    chev.setAttribute("stroke-linecap", "round");
    chev.setAttribute("stroke-linejoin", "round");
    chev.setAttribute("aria-hidden", "true");
    const chevPath = document.createElementNS(SVG_NS, "path");
    chevPath.setAttribute("d", "M3.5 2.5 6 5l-2.5 2.5");
    chev.append(chevPath);
    summary.append(chev, createToolLabel(t("D387", { count: block.rows.length })));
    summary.addEventListener("click", () => {
      const open = summary.getAttribute("aria-expanded") !== "true";
      summary.setAttribute("aria-expanded", String(open));
      summary.classList.toggle("is-open", open);
      for (const row of block.rows) row.hidden = !open;
    });
    for (const row of block.rows) row.hidden = true;
    block.el.prepend(summary);
  }

  /** 折叠摘要钮随语言重渲（meta chrome，与 who/when 同口径）。 */
  function relabelToolSummaries(): void {
    for (const btn of transcript.querySelectorAll<HTMLElement>(".lumir-hp-tool-summary")) {
      const label = btn.querySelector(".lumir-hp-tool-text");
      if (label !== null) label.textContent = t("D387", { count: Number(btn.dataset.count ?? "0") });
    }
  }

  /** live「started」行的参数摘要（M368）：done 翻面取用——工具**成功**时 `done` 事件只发
   *  它自己的固定串（认不出成功侧文案，见 TOOL_FAILED_SUMMARY），参数摘要在 live 路径只有
   *  `started` 这一份。按行元素存（行与事件按 block.running 配对）：随行生灭，WeakMap 不
   *  阻挡行被回收；gated 调用在 appendApproval 升级时即弃（批准载荷全文取代截断摘要）；
   *  恢复路径没有 started 行，故没有条目。 */
  const startedArgs = new WeakMap<HTMLElement, string>();

  /** 批准决策后的 done 抑制槽（M406 单行生命周期）：决策把 running 行就地收敛为终态行，
   *  同一调用的 done 事件随后到达时不再建行（同一调用两份留痕正是本批收敛要消的形态）。
   *  按名匹配 + 单槽：工具循环顺序执行，同一时刻至多一个已决待收尾的调用。批准了但执行
   *  失败（失败形状摘要）时把失败文本追加为该行尾注并翻失败态——决策词（已采纳）保留，
   *  执行结果如实补记。 */
  let settledAwaitingDone: { name: string; row: HTMLElement; approved: boolean } | null = null;

  /** 步骤行追加 / 翻转（M406 人话化版）：started 追加 running 行（名徽章 + 人话化参数）；
   *  done 翻 block.running 行——失败（TOOL_FAILED_SUMMARY 形状）→ is-fail + ✕ + 失败摘要
   *  尾注，成功 → is-done + ✓ + 参数（无尾注：成功侧 done 摘要恒为固定串，零信息量）。
   *  无 running 行的乱序 done（恢复路径不走这里，见 appendSnapshotMessage）直接建行。 */
  function appendToolCall(name: string, status: "started" | "done", summary: string): void {
    // 抑制槽判定先于 ensureToolsBlock：槽命中时不建行，也不该为被抑制的 done 开新块。
    if (status === "done" && settledAwaitingDone !== null && settledAwaitingDone.name === name) {
      const slot = settledAwaitingDone;
      settledAwaitingDone = null;
      if (slot.approved && TOOL_FAILED_SUMMARY.test(summary)) {
        // 批准了但执行失败：终态行翻失败态 + 失败文本尾注（决策词「已采纳」不动）。
        slot.row.classList.replace("is-done", "is-fail");
        const ic = slot.row.querySelector(".lumir-hp-tool-ic");
        if (ic !== null) ic.replaceWith(createToolIcon("fail"));
        const text = slot.row.querySelector(".lumir-hp-tool-text");
        if (text !== null) {
          const outEl = document.createElement("span");
          outEl.className = "lumir-hp-tool-out";
          outEl.textContent = `· ${summary}`;
          text.append(document.createTextNode(" "), outEl);
        }
      }
      scrollToBottom();
      return;
    }
    const block = ensureToolsBlock();
    if (status === "started") {
      const row = document.createElement("div");
      row.className = "lumir-hp-tool-row is-running";
      row.append(createToolIcon("running"), createToolText(name, humanizeToolArgs(name, summary)));
      startedArgs.set(row, summary);
      block.el.append(row);
      block.rows.push(row);
      block.running = row;
    } else if (block.running !== null) {
      const row = block.running;
      block.running = null;
      const args = startedArgs.get(row) ?? "";
      startedArgs.delete(row);
      const failed = TOOL_FAILED_SUMMARY.test(summary);
      row.classList.replace("is-running", failed ? "is-fail" : "is-done");
      row.replaceChildren(
        createToolIcon(failed ? "fail" : "done"),
        // 成功：宽松人话化（截断 JSON 回落原文，有信息量）；失败：严格版（失败摘要不是
        // 参数 JSON，严格版取空 → 参数格留空，失败全文走尾注）。
        createToolText(
          name,
          failed ? humanizeToolArgsStrict(name, args) : humanizeToolArgs(name, args),
          failed ? summary : undefined,
        ),
      );
    } else {
      // 无 running 行（乱序 done / 桩环境）：没有更早的那份摘要可用，done 原文按形状判定。
      const failed = TOOL_FAILED_SUMMARY.test(summary);
      const row = document.createElement("div");
      row.className = failed ? "lumir-hp-tool-row is-fail" : "lumir-hp-tool-row is-done";
      row.append(
        createToolIcon(failed ? "fail" : "done"),
        createToolText(name, humanizeToolArgsStrict(name, summary), failed ? summary : undefined),
      );
      block.el.append(row);
      block.rows.push(row);
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
    // 同文案去重（design §6）：同一原因的反复报错就地滚回视野，不追加堆叠（Alex 真机
    // 同一错误曾堆 6 条）。元素被 resetView 清掉后引用同步失效（transcript.contains 复核）。
    if (lastErrorEl !== null && lastErrorText === text && transcript.contains(lastErrorEl)) {
      scrollToBottom();
      return;
    }
    const el = document.createElement("div");
    el.className = "lumir-hp-error";
    el.textContent = text;
    transcript.append(el);
    lastErrorEl = el;
    lastErrorText = text;
    syncEmptyHint();
    scrollToBottom();
  }

  // ── 批准闸 ───────────────────────────────────────────────────────────────
  /** 批准卡问句与副句（M406 收敛版，文案分工见 copy-data D339 上方注释）：问句按工具名
   *  分发（cli_run / vault_create / vault_patch 各有专句，其它工具回落 D415）；副句按
   *  载荷形状（命令类 = argv → D414，写类 = diff → D413，都无则无副句）。 */
  function approvalAskOf(tool: string, hasDiff: boolean, hasArgv: boolean): { ask: string; sub: string | null } {
    const ask =
      tool === "cli_run"
        ? t("D340")
        : tool === "vault_create"
          ? t("D412")
          : tool === "vault_patch"
            ? t("D339")
            : t("D415", { tool });
    const sub = hasArgv ? t("D414") : hasDiff ? t("D413") : null;
    return { ask, sub };
  }

  function relabelApproval(pending: PendingApproval): void {
    const { ask, sub } = approvalAskOf(pending.tool, pending.diff !== undefined, pending.argv !== undefined);
    const titleEl = pending.element.querySelector(".lumir-hp-approval-title");
    if (titleEl !== null) {
      const nodes: Node[] = [document.createTextNode(ask)];
      if (sub !== null) {
        const subEl = document.createElement("span");
        subEl.className = "lumir-hp-approval-sub";
        subEl.textContent = sub;
        nodes.push(subEl);
      }
      titleEl.replaceChildren(...nodes);
    }
    // 待决行的「等待批准」尾注同口径重取（行是交互中的 UI，不是历史记录）；argsText 是
    // 数据（命令 / 文件名），不译文。
    pending.row.replaceChildren(
      createToolIcon("running"),
      createToolText(pending.tool, pending.argsText, t("D416")),
    );
    const reason = pending.element.querySelector<HTMLTextAreaElement>(".lumir-hp-reason");
    if (reason !== null) {
      reason.placeholder = t("D338");
      reason.setAttribute("aria-label", t("D338"));
    }
    const approve = pending.element.querySelector("button[data-act=approve]");
    const reject = pending.element.querySelector("button[data-act=reject]");
    if (approve !== null) approve.textContent = t("D336");
    if (reject !== null) reject.textContent = t("D337");
  }

  /** 终态记录随语言重渲（M384）：结果词 / 原因句 / 详情摘要重取文案；工具名与原因正文
   *  （配置值/用户输入）不译文；时间戳由 refreshWhoLines 的 30s 时钟按当前语言重算。 */
  function relabelDecided(rec: DecidedApproval): void {
    rec.outcomeEl.textContent = t(rec.approved ? "D405" : "D406");
    if (rec.reasonEl !== null && rec.reason !== undefined) {
      rec.reasonEl.textContent = t("D408", { reason: rec.reason });
    }
    if (rec.summaryEl !== null) rec.summaryEl.textContent = t("D407");
  }

  /** 决策后收敛（M406 收敛单行生命周期，原型 variant B 的 termRow；前身是 M384 的
   *  独立记录卡）：同一行就地翻终态——图标 ✓/✕ + 名徽章 + 参数全文 + 结果格
   * （已采纳/已拒绝 · 相对时间戳）；待决卡整体退场（置灰按钮会被误读为「还没处理完」，
   *  Alex 2026-10-08 实证），卡的 diff/argv 移进默认折叠的 .lumir-hp-term-body 可展开
   *  回看；拒绝附原因时原因行就地可见（D408）。决策后不再另存工具行：同一调用的 done
   *  事件到达时经 settledAwaitingDone 抑制槽吞掉（批准了但执行失败则补记失败尾注）。 */
  function settleApprovalRecord(
    pending: PendingApproval,
    approved: boolean,
    reasonText: string | undefined,
    decidedAt: number,
  ): void {
    const card = pending.element;
    const pre = card.querySelector(".lumir-hp-diff, .lumir-hp-argv");
    const row = pending.row;
    card.remove();
    row.classList.remove("is-running", "is-waiting");
    row.classList.add(approved ? "is-done" : "is-rej");

    const tres = document.createElement("span");
    tres.className = "lumir-hp-tool-res";
    const outcomeEl = document.createElement("b");
    outcomeEl.className = "lumir-hp-tw";
    outcomeEl.textContent = t(approved ? "D405" : "D406");
    const whenEl = document.createElement("span");
    whenEl.className = "lumir-hp-when";
    whenEl.dataset.ts = String(decidedAt);
    whenEl.textContent = `· ${relativeWhen(decidedAt, Date.now())}`;
    tres.append(outcomeEl, document.createTextNode(" "), whenEl);
    row.replaceChildren(
      createToolIcon(approved ? "done" : "fail"),
      createToolText(pending.tool, pending.argsText),
      tres,
    );

    // 详情入口与翻转行为（有 diff/argv 才有——恢复路径的拒绝行无载荷可走，不在此列）。
    let summaryEl: HTMLElement | null = null;
    let termBody: HTMLElement | null = null;
    if (pre !== null) {
      const more = document.createElement("span");
      more.className = "lumir-hp-tool-more";
      summaryEl = document.createElement("span");
      summaryEl.textContent = t("D407");
      more.append(createThinkChev(), summaryEl);
      row.append(more);
      termBody = document.createElement("div");
      termBody.className = "lumir-hp-term-body";
      termBody.hidden = true;
      termBody.append(pre);
      const toggleDetails = (): void => {
        if (termBody === null) return;
        const open = termBody.hidden;
        termBody.hidden = !open;
        row.classList.toggle("is-open", open);
        row.setAttribute("aria-expanded", String(open));
      };
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.setAttribute("aria-expanded", "false");
      row.addEventListener("click", toggleDetails);
      row.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleDetails();
        }
      });
    }

    const term = document.createElement("div");
    term.className = "lumir-hp-termwrap";
    term.append(row);
    let reasonEl: HTMLElement | null = null;
    if (!approved && reasonText !== undefined) {
      reasonEl = document.createElement("div");
      reasonEl.className = "lumir-hp-term-reason";
      reasonEl.textContent = t("D408", { reason: reasonText });
      term.append(reasonEl);
    }
    if (termBody !== null) term.append(termBody);
    pending.wrap.replaceWith(term);

    // 块内行替换成终态单元（折叠时整单元随块隐藏）+ running 指针清掉 + done 抑制槽。
    for (const block of [activeTools, ...sealedToolBlocks]) {
      if (block === null) continue;
      const index = block.rows.indexOf(row);
      if (index >= 0) block.rows[index] = term;
      if (block.running === row) block.running = null;
    }
    settledAwaitingDone = { name: pending.tool, row, approved };

    decidedApprovals.set(pending.id, {
      id: pending.id,
      tool: pending.tool,
      approved,
      reason: reasonText,
      ts: decidedAt,
      element: term,
      outcomeEl,
      whenEl,
      reasonEl,
      summaryEl,
    });
  }

  function appendApproval(request: {
    id: string;
    tool: string;
    diff?: string | undefined;
    argv?: string[] | undefined;
    purpose?: string | undefined;
  }): void {
    // 收敛单行生命周期（M406，原型 variant B）：批准卡不再独立挂 transcript 末尾，而是
    // 就地挂进该调用工具行的 .lumir-hp-pend 壳——同一行承载「运行中 → 等待批准 → 终态」
    // 全生命周期；其后的思考块 / 正文段按到达序追加在工具块之后，自然落在卡之后
    // （reject 后思考落点问题随之结构性消解）。
    ensureStreamingMessage();
    const block = ensureToolsBlock();
    const argsText = approvalArgsText(request);
    let row = block.running;
    if (row !== null) {
      // started 行就地升级：截断摘要换成批准载荷全文 +「等待批准」尾注。
      startedArgs.delete(row);
      row.classList.add("is-waiting");
      row.replaceChildren(createToolIcon("running"), createToolText(request.tool, argsText, t("D416")));
    } else {
      // 无 running 行（快照恢复的 pending_approval / 协议外到达）：补建待决行。
      row = document.createElement("div");
      row.className = "lumir-hp-tool-row is-running is-waiting";
      row.append(createToolIcon("running"), createToolText(request.tool, argsText, t("D416")));
      block.el.append(row);
      block.rows.push(row);
      block.running = row;
    }

    const el = document.createElement("div");
    el.className = "lumir-hp-approval";
    const titleEl = document.createElement("div");
    titleEl.className = "lumir-hp-approval-title";
    el.append(titleEl);
    // 模型自述的用途句（M407 契约 purpose 字段）：有则在命令 / diff 上方显眼位置展示——
    // 信任边界：purpose 只是阅读辅助，命令原文永远完整可见、不被替代或截断。
    if (typeof request.purpose === "string" && request.purpose.trim() !== "") {
      const purposeEl = document.createElement("div");
      purposeEl.className = "lumir-hp-approval-purpose";
      purposeEl.textContent = request.purpose;
      el.append(purposeEl);
    }
    if (request.diff !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-diff";
      for (const line of request.diff.split("\n")) {
        const lineEl = document.createElement("div");
        lineEl.textContent = line;
        if (line.startsWith("+")) lineEl.className = "lumir-hp-diff-add";
        else if (line.startsWith("-")) lineEl.className = "lumir-hp-diff-del";
        else if (line.startsWith("@@")) lineEl.className = "lumir-hp-diff-hunk";
        pre.append(lineEl);
      }
      el.append(pre);
    } else if (request.argv !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-argv";
      pre.textContent = formatArgv(request.argv);
      el.append(pre);
    }
    // 多行原因框（M406）：裸 Enter = 换行（textarea 原生行为），⌘/Ctrl+Enter = 提交拒绝
    // （与按钮同一路径）；IME 组合期不接管。aria-label 与 placeholder 同源（D338）——
    // WKWebView 对只有 placeholder 的 textarea 不暴露 AX 名（占位文案落成子 StaticText），
    // 无名的框在 AX 树里无法按名定位（73 号验收实证）。
    const reason = document.createElement("textarea");
    reason.className = "lumir-hp-reason";
    reason.rows = 2;
    reason.setAttribute("aria-label", t("D338"));
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

    const wrap = document.createElement("div");
    wrap.className = "lumir-hp-pend";
    row.replaceWith(wrap);
    wrap.append(row, el);

    const pending: PendingApproval = {
      id: request.id,
      tool: request.tool,
      diff: request.diff,
      argv: request.argv,
      purpose: request.purpose,
      argsText,
      element: el,
      row,
      wrap,
    };
    pendingApprovals.set(request.id, pending);
    relabelApproval(pending);

    // 未决项不自动超时：唯一的出口是 Alex 点击 / ⌘Enter。决策幂等——重复触发不会向后端
    // 发第二次（pendingApprovals.delete 只兑现一次）；决策后同一行就地收敛为终态记录
    // （settleApprovalRecord），元素留在 transcript 里作决策记录。
    const decide = (approved: boolean): void => {
      if (!pendingApprovals.delete(request.id)) return;
      const reasonText = reason.value.trim();
      settleApprovalRecord(pending, approved, reasonText === "" ? undefined : reasonText, Date.now());
      harnessApprove(request.id, approved, reasonText === "" ? undefined : reasonText).catch(
        (e: unknown) => appendError(t("D348", { message: errorMessage(e) })),
      );
    };
    approve.addEventListener("click", () => decide(true));
    reject.addEventListener("click", () => decide(false));
    reason.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        decide(false);
      }
    });

    syncEmptyHint();
    scrollToBottom();
  }

  // ── 思考块（M363，原型屏 9 形态合同）────────────────────────────────────────
  // 折叠 = 默认（含流式期间）：单行 chevron +「思考过程 · N 秒」（D388）；展开 = 左边线 +
  // 次级灰正文（模型思考原文，textContent 注入——本模块渲染纪律不变）。多块按块序号序、
  // 无思考不渲染块（零噪声——没有 reasoning_chunk 就不建元素）。思考块 / 工具块 / 正文段
  // 在消息内严格按事件到达序排列（M383 合同，交错矩阵由 m383 视觉场景的结构断言守；
  // 旧「块在前正文在后」的锚定插入在 think↔text 交错时把思考块倒置到在途工具块之前，
  // Alex 2026-10-08 截图实证，已退役）。
  // 活会话快照的面板记录不带 reasoning（思考只在 live 事件流里）——只有恢复重建的消息
  // （M398，`PanelMessage.reasoning`）才带 reasoning 明文；两条路径的思考块都走本段渲染件，
  // 取不到明文就不建块（不伪造）。

  /** 思考块的 DOM 面：元素长驻已沉淀的消息内（终态后数据引用释放，重渲只走 relabel）。 */
  interface ThinkingView {
    el: HTMLElement;
    head: HTMLButtonElement;
    text: HTMLElement;
    body: HTMLElement;
  }

  /** 折叠行的 chevron（i18n-exempt 图形，右转 90° 表展开态——CSS 随 .is-open 旋转）。 */
  function createThinkChev(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "9");
    svg.setAttribute("height", "9");
    svg.setAttribute("viewBox", "0 0 10 10");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M3.5 2.5 6 5l-2.5 2.5");
    svg.append(path);
    return svg;
  }

  /** 建思考块视图（默认折叠）。head 钮的可见文本 = D388 整串（chevron + 时长行）。 */
  function createThinkingView(): ThinkingView {
    const el = document.createElement("div");
    el.className = "lumir-hp-think";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "lumir-hp-think-head";
    head.setAttribute("aria-expanded", "false");
    const text = document.createElement("span");
    text.className = "lumir-hp-think-text";
    head.append(createThinkChev(), text);
    const body = document.createElement("div");
    body.className = "lumir-hp-think-body";
    body.hidden = true;
    head.addEventListener("click", () => {
      const open = head.getAttribute("aria-expanded") !== "true";
      head.setAttribute("aria-expanded", String(open));
      el.classList.toggle("is-open", open);
      body.hidden = !open;
    });
    el.append(head, body);
    return { el, head, text, body };
  }

  /** 思考块的 DOM 落位（M383 到达序合同）：思考块 / 工具块 / 正文段在消息内严格按事件
   *  到达序排列——结构性创建一律追加到流式消息尾（= 当时的到达序尾），由
   *  flushPendingStructures 按到达序排好计划后调用；不再锚定首个正文段（旧锚点在
   *  「首个正文段已建、思考后到」时把思考块跳到在途工具块与首轮正文之前，时序倒置）。
   *  思考落在工具行之间时把在途工具块封板（与开新正文段同口径：块序 = 时序，工具行
   *  不被跨块合并抹平）。views 按块序号查找（块序 = DOM 序，后端按序发出，乱序到达由
   *  accumulate 的排序兜底）。 */
  const thinkingViews = new Map<number, ThinkingView>();

  /** 思考块视图的结构落位（调用方保证按到达序调用）：追加到流式消息尾 + 封板在途工具块。
   *  正文段不在此封板——段的去留由 flushPendingStructures 的段位次按「开段是否在到达序尾」
   *  判定（正文缓冲属于更早到达时，开段本来就排在正确的位置）。 */
  function placeThinkingView(index: number): void {
    const host = streamingEl;
    if (host === null) return; // 轮次闸门已挡内容事件；防御性兜底，不静默造孤儿块。
    if (activeTools !== null) {
      sealedToolBlocks.push(activeTools);
      activeTools = null;
    }
    const view = createThinkingView();
    host.append(view.el);
    thinkingViews.set(index, view);
  }

  /** 按到达序合并执行待建的思考块视图与正文段（M383）：同帧内交错到达的
   *  text_chunk / reasoning_chunk 在此按各自的首达序号排序落位——think→text 与
   *  text→think 同帧混达时 DOM 序仍 = 事件序。正文段的位次规则：缓冲正文落「当前开段」
   *  仅当开段装着更早到达的正文且仍在到达序尾；否则（开段已被本计划早前位次的思考占走
   *  位次，或开段尚空）封段开新——段在思考 / 工具处切分，后到的正文不进早前的段。 */
  function flushPendingStructures(): void {
    if (pendingThinkCreates.length === 0 && pendingSegSeq === null) return;
    const thinks = pendingThinkCreates;
    pendingThinkCreates = [];
    const segSeq = pendingSegSeq;
    pendingSegSeq = null;
    type Step = { kind: "think"; index: number; seq: number } | { kind: "seg"; seq: number };
    const plan: Step[] = [
      ...thinks.map((p): Step => ({ kind: "think", index: p.index, seq: p.seq })),
      ...(segSeq !== null ? [{ kind: "seg", seq: segSeq } as Step] : []),
    ];
    plan.sort((a, b) => a.seq - b.seq);
    for (const step of plan) {
      if (step.kind === "think") {
        placeThinkingView(step.index);
      } else if (chunkBuffer !== "") {
        const seg = currentSeg;
        if (seg === null) {
          ensureCurrentSegment();
        } else if (seg.source !== "" && streamingEl?.lastElementChild !== seg.el) {
          // 开段已被本计划早前位次的思考占了它后面的位置：缓冲正文属于更晚到达，封段开新。
          currentSeg = null;
          ensureCurrentSegment();
        }
        // else：开段仍在到达序尾且装着更早正文（或尚空待装）——缓冲正文继续落它，位置本就正确。
      }
    }
  }

  /** rAF 合帧更新思考块的时长读数与正文（结构落位见 flushPendingStructures——视图
   *  创建与内容写入分离：前者按到达序，后者只认数据）。折叠态不影响流入（想看的人点开
   *  即直播）。 */
  function flushThinkingViews(): void {
    if (!thinkingDirty) return;
    thinkingDirty = false;
    for (const block of thinkingBlocks) {
      const view = thinkingViews.get(block.index);
      if (view === undefined) continue; // 结构创建被轮次闸门丢弃的防御路径（正常不触发）。
      const sec = thinkingDurationSec(block);
      view.el.dataset.sec = String(sec);
      view.text.textContent = t("D388", { sec });
      view.body.textContent = block.text;
    }
  }

  /** 思考块头随语言重渲（meta chrome，与 who/when、工具摘要同口径——已定格的 data-sec
   *  是事实读数，重取 D388 模板即可；正文是模型原文，不随语言改写）。 */
  function relabelThinkingViews(): void {
    for (const el of transcript.querySelectorAll<HTMLElement>(".lumir-hp-think")) {
      const text = el.querySelector(".lumir-hp-think-text");
      if (text !== null) text.textContent = t("D388", { sec: Number(el.dataset.sec ?? "0") });
    }
  }

  // ── 流式 assistant 消息 ──────────────────────────────────────────────────
  function ensureStreamingMessage(): void {
    if (streamingEl !== null) return;
    streamingEl = document.createElement("div");
    streamingEl.className = "lumir-hp-msg lumir-hp-msg-assistant";
    streamingEl.append(createWhoLine("assistant", Date.now()));
    // 正文段与工具块按到达序懒建追加（who 行之后），见 textSegments 的注释。
    transcript.append(streamingEl);
    streamingText = "";
    syncEmptyHint();
  }

  /** 当前文本段（无则建）——正文 chunk 的落点；开出新段时把在途工具块封板（其后的
   *  工具行属于新的一块，工具行与时序一一对应的粒度因此不被跨段合并抹平）。 */
  function ensureCurrentSegment(): TextSegment {
    if (currentSeg !== null) return currentSeg;
    if (streamingEl === null) {
      // 调用方（flushChunks）已先 ensureStreamingMessage——防御性兜底，不静默造孤儿段。
      ensureStreamingMessage();
    }
    if (activeTools !== null) {
      sealedToolBlocks.push(activeTools);
      activeTools = null;
    }
    const el = document.createElement("div");
    el.className = "lumir-hp-body";
    const tailEl = document.createElement("div");
    tailEl.className = "lumir-hp-md-tail";
    el.append(tailEl);
    streamingEl!.append(el);
    currentSeg = { el, tailEl, source: "", renderedFinalized: 0 };
    textSegments.push(currentSeg);
    return currentSeg;
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
    // 结构先行：按到达序合并落位待建的思考块视图与正文段（M383），再上思考内容、正文。
    flushPendingStructures();
    flushThinkingViews();
    if (chunkBuffer === "") return;
    ensureStreamingMessage();
    // 段位次已保证开段在场（缓冲非空 ⇒ pendingSegSeq 非空 ⇒ flushPendingStructures 落位）；
    // ensureCurrentSegment 此处是防御性兜底（幂等：开段在场即原样返回）。
    const seg = ensureCurrentSegment();
    seg.source += chunkBuffer;
    streamingText += chunkBuffer;
    chunkBuffer = "";
    // 已完成块：渲染过一次就冻结（游标只前进）；进行中的末块整段重渲。逐段进行——
    // 块边界判定只看本段自己的源（段边界 = 工具发生处，跨段的松散结构本来就是两段）。
    const boundary = finalizedUpTo(seg.source);
    if (boundary > seg.renderedFinalized) {
      const grown = seg.source.slice(seg.renderedFinalized, boundary);
      const finalizedEl = document.createElement("div");
      finalizedEl.className = "lumir-hp-md-final";
      renderMarkdownInto(finalizedEl, grown);
      seg.el.insertBefore(finalizedEl, seg.tailEl);
      seg.renderedFinalized = boundary;
    }
    seg.tailEl.replaceChildren();
    renderMarkdownInto(seg.tailEl, seg.source.slice(seg.renderedFinalized));
    scrollToBottom();
  }

  /** 一轮结束：对每个文本段的完整源做一次全量重渲（增量渲染的近似在松散列表等形态上
   *  收敛于此——按段收敛：段边界是工具发生处，渲染语义本就独立）。工具块（在途 + 已封板）
   *  随轮次终态折叠收尾，交错位置不动。完成后挂复制钮：源 = 模型原始输出（全部文本段
   *  的拼接）。思考块随轮次定格：flush 已把末态时长/正文上屏，这里只释放数据引用——
   *  元素留在消息内（到达序位置，M383），复制源不含思考内容（复制源 = 正文源文本，单一真源）。
   *  返回沉淀的消息元素（中断标注等终态修饰用；无流式内容时返回 null）。 */
  function finalizeStreamingMessage(): HTMLElement | null {
    flushChunks();
    // 工具清单随轮次终态收尾（幂等；done / aborted / error 三个事件出口共用本出口）：
    // 在途块经 collapseTools、封板块逐一折叠——交错在段之间的每块各自收尾。
    collapseTools();
    for (const block of sealedToolBlocks) collapseBlock(block);
    sealedToolBlocks = [];
    if (streamingEl === null) return null;
    const el = streamingEl;
    for (const seg of textSegments) {
      seg.el.replaceChildren();
      renderMarkdownInto(seg.el, seg.source);
    }
    // 纯工具轮（模型零正文产出）不挂复制钮——空源复制无意义（与 appendUserMessage 同口径）。
    if (streamingText !== "") attachCopyButton(el, streamingText);
    streamingEl = null;
    currentSeg = null;
    textSegments = [];
    streamingText = "";
    chunkBuffer = "";
    thinkingBlocks = [];
    thinkingViews.clear();
    thinkingDirty = false;
    pendingThinkCreates = [];
    pendingSegSeq = null;
    scrollToBottom();
    return el;
  }

  /** 中断标注（M348，D383）：挂在被打断的 assistant 消息上的「已停止」徽标——
   *  事件路径（aborted 终态事件）与快照恢复路径（status="stopped" 的留存消息）共用。
   *  徽标是已发生事实的记录，不进 onRelabel（与 transcript 历史同口径）。 */
  function attachStoppedMark(el: HTMLElement): void {
    const mark = document.createElement("span");
    mark.className = "lumir-hp-stopped";
    mark.textContent = t("D383");
    el.append(mark);
  }

  // ── 事件流 ───────────────────────────────────────────────────────────────
  /** 内容类事件（轮次闸门 M374 的管控面）：终态之后到达的一律丢弃。 */
  const GATED_EVENT_TYPES = new Set(["text_chunk", "reasoning_chunk", "tool_call", "usage", "compact"]);

  function handleEvent(event: HarnessEvent): void {
    // 会话作用域过滤（M312）：只渲染当前 vault 的会话。切换 vault 之后仍在途的旧 vault 事件
    // （工具循环跑在 `lumir-harness-llm` 专线程上，切 vault 不打断它）在这里被丢弃，不串台。
    if (!inCurrentVault(event.vault, currentVault)) return;
    // 轮次封闭（M374）：done / aborted / error 之后、下一次 sent 之前到达的内容事件一律
    // 丢弃——已取消（或已结束）的轮次迟到产出不得再进消息流（「复活」）。终态事件本身
    // 不受闸门管控（收口幂等，且 sent 之前的 stray 终态无害）。
    if (turnOpen === false && GATED_EVENT_TYPES.has(event.type)) return;
    switch (event.type) {
      case "text_chunk": {
        const seq = ++arrivalSeq;
        const text = typeof event.text === "string" ? event.text : "";
        // 缓冲首个正文的到达序 = 段创建的排序位次（M383：与思考块创建按 seq 合并落位）。
        if (text !== "" && chunkBuffer === "") pendingSegSeq = seq;
        chunkBuffer += text;
        // 阶段指示推进：首个 chunk 到达 = 模型开始生成（「等待响应」→「生成中」）。
        if (stageWaiting) {
          stageWaiting = false;
          if (sendPhase !== "idle") applyStage();
        }
        scheduleFlush();
        return;
      }
      case "reasoning_chunk": {
        // M383：同帧 text→think 交错时，先把已缓冲的正文落位（开段建出、序在思考之前）
        // 再登记本思考——否则思考后到达的正文会并进思考前的段，帧内事件序倒置（r1 评审 P2）。
        // 缓冲为空时不 flush（纯思考流的热路径不受影响）。
        if (chunkBuffer !== "") flushChunks();
        // 思考分片（M363）：先立流式消息（纯思考轮 / 思考先于首个正文分片到达是常态——
        // 后端保证思考分片在该轮 text_chunk 之前发出），再按块序号累加进数据层；
        // 上屏走 rAF 合帧（flushThinkingViews），折叠态不影响流入（想看的人点开即直播）。
        // M383：首分片登记到达序——视图结构创建与正文段创建按到达序合并落位。
        const seq = ++arrivalSeq;
        ensureStreamingMessage();
        const index = typeof event.index === "number" && Number.isFinite(event.index) ? event.index : 0;
        if (!thinkingViews.has(index) && !pendingThinkCreates.some((p) => p.index === index)) {
          pendingThinkCreates.push({ index, seq });
        }
        const acc = accumulateThinkingBlock(
          thinkingBlocks,
          index,
          typeof event.text === "string" ? event.text : "",
          Date.now(),
        );
        thinkingBlocks = acc.blocks;
        thinkingDirty = true;
        scheduleFlush();
        return;
      }
      case "tool_call":
        // 清单块挂当前 agent 消息（design §3.3）：工具先于首个 text_chunk 到达是常态
        // （模型先调工具后说话）——先立一条空 agent 消息，正文 chunk 随后开新段落在
        // 工具块之后（M374：工具行保持在它发生的文本段之前的原位）。
        ensureStreamingMessage();
        appendToolCall(
          typeof event.name === "string" ? event.name : "?",
          event.status === "done" ? "done" : "started",
          typeof event.summary === "string" ? event.summary : "",
        );
        return;
      case "approval_request":
        if (typeof event.id === "string") {
          appendApproval({
            id: event.id,
            tool: event.tool,
            diff: event.diff,
            argv: event.argv,
            purpose: typeof event.purpose === "string" ? event.purpose : undefined,
          });
        }
        return;
      case "usage":
        // M347：读数迁入 composer 控制行（模型 chip 之后、发送钮之前）——事件源自 HP1 起
        // 一直在发（头部栏已移除、事件未断），这里直接消费，不新造通道。
        // M370：cache_pct 一并消费（同一事件里已带，纯前端读取）——「{ctx}% · {cache}%」。
        lastUsage = typeof event.ctx_pct === "number" ? event.ctx_pct : null;
        lastCache = typeof event.cache_pct === "number" ? event.cache_pct : null;
        applyUsage();
        return;
      case "compact":
        // 自动压缩 = 开新逻辑会话：会话名按同口径重算（下一条用户消息成为新名，
        // 未发前显示「新会话」——design §3）。
        firstUserText = null;
        applySessionName();
        appendCompactMarker(typeof event.summary === "string" ? event.summary : "");
        return;
      case "done":
        turnOpen = false;
        finalizeStreamingMessage();
        applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
        return;
      case "aborted": {
        turnOpen = false;
        // 本轮被用户停止（M348）：中断语义是「不再继续」——已流式产出保留（上面的
        // text_chunk 已落进流式泡），标注「已停止」，经 finished 收口回 idle，
        // composer 立即可开新一轮。无产出（停止在首个 chunk 前）时补一条「Agent ·
        // 已停止」标记消息——被取消的轮次在消息流里显式封闭，不再读作「一个没有得到
        // 处理的问题」（M374；标记是 live 面：快照侧无对应留存记录，重载后不重建）。
        const el = finalizeStreamingMessage();
        if (el !== null) {
          attachStoppedMark(el);
        } else {
          const marker = document.createElement("div");
          marker.className = "lumir-hp-msg lumir-hp-msg-assistant";
          marker.append(createWhoLine("assistant", Date.now()));
          attachStoppedMark(marker);
          transcript.append(marker);
          syncEmptyHint();
          scrollToBottom();
        }
        // 待决批准项随中断收回（design §5）：未决策的批准卡撤下、解壳回工具行——它们的
        // 唯一出口（点击）已失效，后端那条通道已被 Withdrawn 关闭。正常路径下 Withdrawn
        // 的 done（turn_aborted 失败摘要）已先把行翻面为 is-fail；没翻面的（事件缺口）
        // 在这里补翻，不留永恒「等待批准」幻影行。
        for (const pending of pendingApprovals.values()) {
          pending.element.remove();
          pending.wrap.replaceWith(pending.row);
          pending.row.classList.remove("is-waiting");
          if (pending.row.classList.contains("is-running")) {
            pending.row.classList.replace("is-running", "is-fail");
            pending.row.replaceChildren(
              createToolIcon("fail"),
              createToolText(pending.tool, pending.argsText, t("D383")),
            );
          }
          for (const block of [activeTools, ...sealedToolBlocks]) {
            if (block !== null && block.running === pending.row) block.running = null;
          }
        }
        pendingApprovals.clear();
        settledAwaitingDone = null;
        applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
        return;
      }
      case "error":
        turnOpen = false;
        finalizeStreamingMessage();
        applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
        appendError(t("D348", { message: typeof event.message === "string" ? event.message : event.code }));
        return;
    }
  }

  void onHarnessEvent(handleEvent).catch(() => {});

  /** 快照消息的上屏时刻（M353 起后端 PanelMessage 带 ts，UNIX 秒 → ms；缺字段 / 0 的
   *  旧快照 = 无戳，when 不显示——不伪造读数，design §4）。 */
  function messageTs(record: Record<string, unknown>): number | null {
    const ts = record.ts;
    return typeof ts === "number" && Number.isFinite(ts) && ts > 0 ? ts * 1000 : null;
  }

  // ── 快照恢复（webview 重载 / 首次挂载 / 切 vault）：宽容解析，缺键 = 空态 ──

  /** 恢复消息逐条上屏（M368 快照恢复 × M398 会话恢复**共用同一套项映射与渲染件**）：
   *  一串面板记录（`{role, text, reasoning, name, summary, status, ts}`）按序重放——user →
   *  气泡、assistant → who 行 + 可选思考块 + 正文、tool → 工具行、compact → 压缩标记；
   *  尾部可能吊着未收尾的清单块，统一 collapseTools 收尾。 */
  function renderSnapshotMessages(messages: readonly unknown[]): void {
    for (const message of messages) {
      if (typeof message !== "object" || message === null) continue;
      appendSnapshotMessage(message as Record<string, unknown>);
    }
    collapseTools(); // 恢复尾部可能吊着未收尾的清单块（最后一条记录是 tool 时）
  }

  /** 单条恢复记录的上屏（项映射的唯一出口，快照恢复与会话恢复共用）。 */
  function appendSnapshotMessage(record: Record<string, unknown>): void {
    const role = record.role;
    if (role === "user" && typeof record.text === "string") {
      // 已发送消息的存留是序列化文本（含 <quote> 块与上下文节）：解析回块序列同构呈现。
      // headingPath 不在协议里（人侧专用字段），恢复的卡片 hover 退化为 heading 链。
      const blocks = parseQuoteMessage(record.text);
      // 会话名按同口径从恢复的消息重算（首条用户消息的原始问题文本）。
      if (firstUserText === null) firstUserText = firstUserTextOf(blocks);
      appendUserMessage(blocks, record.text, messageTs(record)); // 复制源 = 留存原文；戳 = 后端 ts（无则不显示）
    } else if (role === "assistant") {
      // 消息边界（M368）：上一条 assistant 消息的工具清单块在此收尾。不收尾的话
      // ensureToolsBlock 会把其后的工具记录塞回**上一条**消息的块里——一段长会话的全部
      // 历史工具于是堆进第一条消息的折叠块（Alex 2026-10-07 现场：红框里 21 行）。
      collapseTools();
      const text = restoredAssistantText(record);
      // 恢复的思考块（M398）：仅当 record 带 reasoning 明文时渲染（kimi 的不透明回放项
      // 取不到明文则缺席——core 侧不伪造块）。
      const reasoning = restoredReasoningText(record);
      if (text === null && reasoning === null) {
        // 旧快照的空正文轮（模型只发工具调用，无正文；core 侧 M367 起不再落这类记录）：
        // 不渲染光秃 who 行、不挂复制钮。它原本是其后工具记录的挂点，这里把挂点交回
        // transcript 兜底——工具行各自成块、按原时序留痕（顺序不因跳过而改变）。
        lastAssistantEl = null;
      } else {
        const el = document.createElement("div");
        el.className = "lumir-hp-msg lumir-hp-msg-assistant";
        el.append(createWhoLine("assistant", messageTs(record))); // 无 ts 的旧快照：只显示角色（不伪造）
        if (reasoning !== null) el.append(createRestoredThinking(reasoning));
        if (text !== null) {
          const body = document.createElement("div");
          body.className = "lumir-hp-body";
          renderMarkdownInto(body, text);
          el.append(body);
          attachCopyButton(el, text); // 复制源 = 模型原始输出（留存原文）
        }
        // 中断轮留存的产出：标注「已停止」（M348，D383；status 缺省 = 正常完成不标）。
        if (record.status === "stopped") attachStoppedMark(el);
        transcript.append(el);
        lastAssistantEl = el; // 其后的 tool 记录挂进这条消息的清单块
      }
    } else if (role === "tool" && typeof record.name === "string") {
      appendRestoredToolRow(record as Record<string, unknown> & { name: string });
    } else if (role === "compact" && typeof record.summary === "string") {
      // 压缩记录 = 逻辑会话边界：其后的用户消息属于新逻辑会话——会话名归 null 重算；
      // 工具清单块同样在此收尾（边界两侧的记录不属于同一块）。
      collapseTools();
      firstUserText = null;
      lastAssistantEl = null; // 压缩边界同样是工具记录的挂点边界
      appendCompactMarker(record.summary);
    }
  }

  /** 恢复消息的思考块（M398）：复用活会话的思考块结构（`createThinkingView`），但**不渲染
   *  含时长的折叠头**——wire 只带 reasoning 明文、不带「思考了多久」的读数，写一个数字就是
   *  伪造读数（与「无戳不显示 when」同口径）。因此正文直接展开呈现（无折叠开关）。 */
  function createRestoredThinking(text: string): HTMLElement {
    const view = createThinkingView();
    view.head.hidden = true;
    view.el.classList.add("is-open");
    view.body.hidden = false;
    view.body.textContent = text;
    return view.el;
  }

  /** 恢复路径的工具行（M406 状态感知版）：record.status 是面板细分终态（done / denied /
   *  rejected / error——活会话持久化由 turn.rs 写，恢复重建路径由 restored_panel_messages
   *  经 wire 的 function_call_output 回填；旧快照缺字段）。
   *  - rejected → ✕「已拒绝」终态行（原型 restored/after-reject 帧）：原因行就地可见
   *   （原因全文在输出 JSON 里，summary 里那份被 80 字截断不取）；**无详情**——留存里
   *    没有原 diff/argv，不伪造展开件。
   *  - denied / error（或缺 status 但摘要命中失败形状的旧快照）→ 失败行：尾注 = 失败
   *    全文（输出 JSON 的 code+message，summary 兜底）。
   *  - 其余 → 成功行：参数摘要人话化（持久化 / 重建两份 summary 都是参数 JSON 时才有
   *    参数格；失败摘要不冒充参数）。 */
  function appendRestoredToolRow(record: Record<string, unknown> & { name: string }): void {
    const name = record.name;
    const summary = typeof record.summary === "string" ? record.summary : "";
    const status = typeof record.status === "string" ? record.status : "";
    const block = ensureToolsBlock();
    if (status === "rejected") {
      const row = document.createElement("div");
      row.className = "lumir-hp-tool-row is-rej";
      row.append(createToolIcon("fail"), createToolText(name, humanizeToolArgsStrict(name, summary)));
      const tres = document.createElement("span");
      tres.className = "lumir-hp-tool-res";
      const outcomeEl = document.createElement("b");
      outcomeEl.className = "lumir-hp-tw";
      outcomeEl.textContent = t("D406");
      tres.append(outcomeEl);
      const at = messageTs(record);
      if (at !== null) {
        const when = document.createElement("span");
        when.className = "lumir-hp-when";
        when.dataset.ts = String(at);
        when.textContent = `· ${relativeWhen(at, Date.now())}`;
        tres.append(document.createTextNode(" "), when);
      }
      row.append(tres);
      const reason = rejectedReasonOf(record);
      if (reason !== null) {
        const term = document.createElement("div");
        term.className = "lumir-hp-termwrap";
        const reasonEl = document.createElement("div");
        reasonEl.className = "lumir-hp-term-reason";
        reasonEl.textContent = t("D408", { reason });
        term.append(row, reasonEl);
        block.el.append(term);
        block.rows.push(term);
      } else {
        block.el.append(row);
        block.rows.push(row);
      }
      return;
    }
    const failed =
      status === "denied" || status === "error" || TOOL_FAILED_SUMMARY.test(summary);
    const row = document.createElement("div");
    row.className = failed ? "lumir-hp-tool-row is-fail" : "lumir-hp-tool-row is-done";
    const tail = failed
      ? (failureTextOf(record) ?? (TOOL_FAILED_SUMMARY.test(summary) ? summary : undefined))
      : undefined;
    row.append(
      createToolIcon(failed ? "fail" : "done"),
      createToolText(name, failed ? humanizeToolArgsStrict(name, summary) : humanizeToolArgs(name, summary), tail),
    );
    block.el.append(row);
    block.rows.push(row);
  }

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
    renderSnapshotMessages(messages);
    // ctx% 读数与警示阈值随快照恢复（webview 重载后读数不断源；缺键 = 缺省 85 / 无读数）。
    // M370：cache_pct 同读数一并恢复（缺键保持 null，回落单读数）。
    const usage = state.usage as { ctx_pct?: unknown; cache_pct?: unknown } | null | undefined;
    if (usage !== null && usage !== undefined && typeof usage === "object" &&
        typeof usage.ctx_pct === "number") {
      lastUsage = usage.ctx_pct;
    }
    if (usage !== null && usage !== undefined && typeof usage === "object" &&
        typeof usage.cache_pct === "number") {
      lastCache = usage.cache_pct;
    }
    const warn = state.warn_ctx_pct;
    if (typeof warn === "number" && Number.isFinite(warn)) warnCtxPct = warn;
    applyUsage();
    // 思考程度（M363）：快照 thinking 字段宽容提取——缺键 / 非法档 = 旧后端 / 桩，
    // effort 读数留空（不伪造读数，与合并 chip 同纪律）；空态快照也带本字段（supported
    // 按当前 provider + model 现算），chip 空态照显。M373 起读数随合并 chip 呈现。
    const thinking = thinkingStateOf(state);
    if (thinking !== null) {
      thinkConfigured = true;
      thinkLevel = thinking.level;
      thinkSupported = thinking.supported;
    }
    applySelChip();
    rebuildSelPopIfOpen();
    const pending = state.pending_approval as
      | { id?: unknown; tool?: unknown; diff?: unknown; argv?: unknown; purpose?: unknown }
      | null
      | undefined;
    if (pending !== null && typeof pending === "object" && typeof pending.id === "string") {
      // argv 是字符串数组（events.rs / PendingApprovalSnapshot 同型；M406 前按 string 读，
      // 数组被整段丢弃）。宽容过滤非字符串元素；空数组按缺省处理。
      const argv = Array.isArray(pending.argv)
        ? pending.argv.filter((a): a is string => typeof a === "string")
        : undefined;
      appendApproval({
        id: pending.id,
        tool: typeof pending.tool === "string" ? pending.tool : "?",
        diff: typeof pending.diff === "string" ? pending.diff : undefined,
        argv: argv !== undefined && argv.length > 0 ? argv : undefined,
        purpose: typeof pending.purpose === "string" ? pending.purpose : undefined,
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
    decidedApprovals.clear();
    streamingEl = null;
    currentSeg = null;
    textSegments = [];
    sealedToolBlocks = [];
    streamingText = "";
    chunkBuffer = "";
    turnOpen = false;
    activeTools = null;
    settledAwaitingDone = null;
    lastAssistantEl = null;
    lastErrorEl = null;
    lastErrorText = "";
    thinkingBlocks = [];
    thinkingViews.clear();
    thinkingDirty = false;
    pendingThinkCreates = [];
    pendingSegSeq = null;
    // 会话名随会话作废：未发消息前显示「新会话」，首条消息后再按口径重算。
    firstUserText = null;
    applySessionName();
    // 相位一并经 finished 收口回 idle：旧会话那一轮的 done 事件可能永远到不了这里（切 vault
    //  后被过滤，见 handleEvent）——不复位的话新会话的发送钮会被一个等不到的「处理中」锁死。
    applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
    stageWaiting = true;
    // ctx% 读数归无（新 vault 会话的快照会随后带到它自己的读数）。
    lastUsage = null;
    lastCache = null;
    applyUsage();
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
   * - 发送相位经 finished 收口回 idle：见 resetView；
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
    if (sendPhase !== "idle") return;
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
    appendUserMessage(blocks, text, Date.now()); // 上屏打戳（when 的 data-ts）
    // 会话名：本逻辑会话的首条用户消息定名（未发过时）；卡片与序列化文本不作名。
    if (firstUserText === null) {
      firstUserText = firstUserTextOf(blocks);
      applySessionName();
    }
    // 投递成功入队后草稿与撤销史一并归零（新消息是新的编辑史）。
    undoHistory.clear();
    renderComposer([{ kind: "paragraph", text: "" }], null);
    // 焦点与光标回 composer（M372）：replaceChildren 会把 WebKit 里既有的 DOM 选区塌到
    // composer 元素边界——视觉上光标跑到输入区最左上角，且后续键入落点不可预期。显式
    // focus + 把选区放进新的空段落，光标才回到输入区的正常位置。focus 须在重渲之后、
    // setDomCaret 之前（focus 自身会归位选区，最后再精调一次）。
    composer.focus();
    setDomCaret({ block: 0, offset: 0 });
    updateEmptyClass();
    // 相位入 running（两态发送钮切停止态）+ 阶段指示回「等待响应」——进度条与阶段行随相位显形；
    // 轮次闸门随 sent 打开（M374：终态后迟到的内容事件在此之前一律丢弃）。
    stageWaiting = true;
    turnOpen = true;
    applySendPhase(reduceSendPhase(sendPhase, { type: "sent" }));
    // 无文档上下文时传空串（不是 null）：后端 harness_send 的 context_json 恒为 string，
    // parse_context 对空串返回默认块——传 null 会被参数反序列化拒掉（M398，bug「不打开任何
    // 文件时发送报 invalid type: null」）。
    harnessSend(text, block !== null ? serializeHarnessContext(block) : "").catch((e: unknown) => {
      turnOpen = false;
      applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
      appendError(t("D347", { reason: errorMessage(e) }));
    });
  }

  // 发送钮的点击路由：空闲相位（= 钮面「发送」）走 send()；running 相位（= 钮面「停止」）
  // 的停止路径在控制行段落（applySendPhase 附近），同一颗钮两态两个处理器按相位分派。
  sendButton.addEventListener("click", () => {
    if (sendPhase === "idle") send();
  });
  // Enter 发送 / ⇧Enter 换行（D328 占位同款口径）；IME 组合期不接管（Enter 在组合期是
  // 「确认候选」）。双防线：浏览器自报的 event.isComposing（Chromium 可靠）+ 自跟踪状态机
  // （WKWebView 不可靠——WebKit 先派 compositionend 再派确认 Enter 的 keydown，isComposing
  // 已是 false，单靠早退会把「选候选」误当发送；状态机口径见 imeGateKeydown）。
  // 退格 / 前删走模型（卡片按整体作用 + 自管撤销栈的确定性）。
  let imeGateState = imeKeyGate();
  composer.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.isComposing) {
      // 浏览器自报组合期（Chromium 序的确认拍落在这里）：同样登记进门——若不登记，
      // 紧随的 compositionend 会开确认窗，用户想发送的下一拍 Enter 会被误吞。不
      // preventDefault：确认动作归 IME 原生默认（同既有口径）。
      if (event.key === "Enter") {
        imeGateState = imeGateKeydown(imeGateState, "Enter", Date.now()).gate;
      }
      return;
    }
    if (imeGateState.composing) return; // 组合期一律不接管（isComposing 漏报时的自跟踪命中）
    const decision = imeGateKeydown(imeGateState, event.key, Date.now());
    imeGateState = decision.gate;
    if (decision.swallow) {
      // 候选确认拍：候选已落字，这拍 Enter 只是「选中」——拦下（不发送、不换行、不留段落）。
      event.preventDefault();
      return;
    }
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
    imeGateState = imeGateCompositionStart(imeGateState);
    undoHistory.push(snapshot(), true);
  });
  composer.addEventListener("compositionend", () => {
    imeGateState = imeGateCompositionEnd(imeGateState, Date.now());
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
        // resetView 只清渲染面、不碰 chip 读数：档位随会话对象一起被丢弃（M362 裁决点 1），
        // 不重取快照的话 chip 会停在上一段会话的档位，与后端「无会话 = 默认 High」分叉
        // （M366 finding）。重取走 refreshThinkingState 的既有通道——快照是档位的唯一真源，
        // 芯片读数据此回落默认，浮层每次现建拿到同步后的档位。
        refreshThinkingState();
      })
      .catch((e: unknown) => appendError(t("D348", { message: errorMessage(e) })));
  }
  segNew.addEventListener("click", startNewSession);
  /** 会话浮层开合（aria-expanded 随开合翻转；M351 a11y，design §5）。打开时现拉现建
   *  历史会话清单（M392）；拉取失败（M395 合并前的旧后端 / 桩 / 后端不可用）按空清单
   *  降级——选择器静默不列，不报错打断浮层。 */
  function setSessPop(open: boolean): void {
    if (open) {
      // 先显示再定位：浮层 display:none 时 offsetWidth/Height 量为 0，夹纵向就夹不了。显示与
      // 定位在同一次同步任务内完成、中间不落绘制，因此不会闪（同 vault 切换浮层的 place 手法）。
      sessPop.hidden = false;
      placeSessPop();
      buildSessList();
    } else {
      sessPop.hidden = true;
    }
    sessionButton.setAttribute("aria-expanded", String(open));
  }

  /** 会话浮层定位（M397）：浮层是 `position: fixed`（见 harness-panel.css 的同名规则），坐标按
   *  **会话名钮的视口矩形**现算，并夹在视口内——不变量是「浮层包围盒完整落在视口内、且不被任何
   *  祖先容器的 overflow 裁切」（docs/specs/overlay-visibility.md）。**打开时与历史清单填充后各算
   *  一次**（后者在 buildSessList 的 .then 里）：清单是异步拉来的，填充后浮层变高，纵向夹取必须按
   *  新高度重算，否则长历史 + 矮窗下下端会越出视口（M397 r1 P2-1）。浮层是瞬时形态（点浮层外 /
   *  Esc / 选中即关），其生命周期内不发生窗口尺寸变化，故不挂 resize 监听（与 vault 切换浮层同
   *  口径）。纵向 4px 沿用原 CSS `top: 30px` 减去钮高 26 的实测间距。 */
  function placeSessPop(): void {
    const gap = 4;
    const margin = 8;
    const rect = sessionButton.getBoundingClientRect();
    const w = sessPop.offsetWidth;
    const h = sessPop.offsetHeight;
    // 横向：与钮左缘对齐，右端不越出视口；钮贴右缘时左移让整盒留在视口内。
    const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - w - margin));
    // 纵向：钮下沿之下，下端不越出视口（长历史清单由 .lumir-hp-sesspop-list 的 max-height 兜住）。
    const top = Math.min(rect.bottom + gap, Math.max(margin, window.innerHeight - h - margin));
    sessPop.style.left = `${left}px`;
    sessPop.style.top = `${top}px`;
  }

  /** 历史会话清单现建（每次打开现拉——会话文件随对话增长，不囤旧清单）：每行 =
   *  恢复钮（会话名 + 时间读数，点击即恢复续聊）+ 删除钮（×，M406 会话删除——行内
   *  两步确认，确认后调 harness_delete_session）。行是临时 DOM（浮层关即弃），不注册
   *  onRelabel——与合并选择器浮层同口径。空清单 = 浮层整层不开（「新建会话」动作项
   *  已随 M406 退场，浮层不再有空壳形态）。
   *  恢复钮与删除钮是并列兄弟（div 壳），MUST NOT 钮套钮——WKWebView 把嵌套 button
   *  当叶子，AX 树不暴露内层（M351 finding，同 sessionWrap 的纪律）。 */
  function buildSessList(): void {
    sessList.replaceChildren();
    sessList.hidden = true;
    harnessListSessions()
      .then((list) => {
        const entries = sessionEntriesOf(list);
        if (entries.length === 0) {
          setSessPop(false);
          return;
        }
        for (const entry of entries) {
          const row = document.createElement("div");
          row.className = "lumir-hp-sesspop-row";
          const item = document.createElement("button");
          item.type = "button";
          item.className = "lumir-hp-sesspop-item lumir-hp-sesspop-history";
          item.setAttribute("role", "menuitem");
          const name = document.createElement("span");
          name.className = "lumir-hp-sesspop-name";
          const text = entry.firstUserText ?? t("D330"); // 无用户消息：回落「新会话」（同会话名口径）
          name.textContent = truncateSessionName(text);
          name.title = text;
          item.append(name);
          if (entry.ts !== null) {
            const when = document.createElement("span");
            when.className = "lumir-hp-sesspop-when";
            when.textContent = sessionWhen(entry.ts, Date.now());
            item.append(when);
          }
          item.addEventListener("click", (event) => {
            event.stopPropagation();
            setSessPop(false);
            resumeSession(entry);
          });
          const del = document.createElement("button");
          del.type = "button";
          del.className = "lumir-hp-sesspop-del";
          del.setAttribute("aria-label", t("D417"));
          del.title = t("D417");
          del.textContent = "×"; // i18n-exempt: glyph（乘号图形，非文案）
          del.addEventListener("click", (event) => {
            event.stopPropagation();
            // 行内两步确认（M406）：第一次点 × 把行换成确认态，确认才删；取消还原行。
            const promptEl = document.createElement("span");
            promptEl.className = "lumir-hp-sesspop-confirm-text";
            promptEl.textContent = t("D418");
            const confirmBtn = document.createElement("button");
            confirmBtn.type = "button";
            confirmBtn.className = "lumir-hp-sesspop-confirm-yes";
            confirmBtn.textContent = t("D419");
            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "lumir-hp-sesspop-confirm-no";
            cancelBtn.textContent = t("D136");
            const restoreRow = (): void => row.replaceChildren(item, del);
            cancelBtn.addEventListener("click", (e2) => {
              e2.stopPropagation();
              restoreRow();
            });
            confirmBtn.addEventListener("click", (e2) => {
              e2.stopPropagation();
              harnessDeleteSession(entry.sessionId)
                .then(() => {
                  row.remove();
                  // 删空 = 浮层里没有别的可点了，整层收起。
                  if (sessList.childElementCount === 0) setSessPop(false);
                })
                .catch((e: unknown) => {
                  // 失败（活跃会话拒删 / IO 失败）上报错误行并收浮层——错误行在
                  // transcript，浮层留着会挡住它。
                  setSessPop(false);
                  appendError(t("D348", { message: errorText(e) }));
                });
            });
            row.replaceChildren(promptEl, confirmBtn, cancelBtn);
          });
          row.append(item, del);
          sessList.append(row);
        }
        sessList.hidden = false;
        // 清单填充后浮层变高了，纵向夹取必须按新高度重算一遍（M397 r1 P2-1）：placeSessPop() 在
        // 打开时清单尚未填充，长清单随后把浮层撑高（.lumir-hp-sesspop-list 上限 320px），
        // 不重夹的话矮窗 + 长历史时浮层下端会越出视口——恰是本 PR 立的 O2（打开态包围盒 MUST 完整
        // 落在视口内）所禁。浮层在拉取期间被点掉（hidden）就不必重算。
        if (!sessPop.hidden) placeSessPop();
      })
      .catch(() => {});
  }

  /** 恢复选中历史会话（选择器点击路径，M392/M398）：恢复 = 后端读源文件最后一条会话轮次
   *  llm_request 的完整请求体、system + input 原样灌进**新**会话并续写新留存文件
   *  （harness_resume_session；busy / 跨 vault / 留存损坏由后端拒绝，D409–D411 经
   *  errorText 按 code 渲染上错误行）。
   *
   *  **面板 transcript 从灌回的 wire 记录重建**（M398，design §6.2）：后端把 input 项映射成
   *  面板消息随返回带出（`info.messages`），这里经 [`renderSnapshotMessages`] 重放——与快照
   *  恢复**同一套项映射与渲染件**（user 气泡 / assistant 正文 / tool 行 / 思考块），resetView
   *  之后不再是空面板。会话名按同口径落在选中项的首条用户消息上；档位经 refreshThinkingState
   *  重取（恢复真实带回源会话档位）；用量读数**不**拉快照——新会话尚无已发请求，后端 usage 是
   *  零值缺省，拉来上屏就是虚报，保持「无读数」等下一轮真值。 */
  function resumeSession(entry: SessionEntry): void {
    harnessResumeSession(entry.sessionId)
      .then((info) => {
        resetView();
        renderSnapshotMessages(Array.isArray(info.messages) ? info.messages : []);
        firstUserText = entry.firstUserText;
        applySessionName();
        // 恢复批次收尾落在末尾（与 restoreSnapshot 末尾同一句）：`appendSnapshotMessage` 的
        // assistant 分支是裸 `transcript.append(el)`、不滚——恢复 transcript 以 assistant 收尾
        // （会话常态：末轮答复后用户尚未再提问）时少了这一句就停在最末 user 消息处、收尾回复
        // 折在视口外（M398 r1 P1）。user / tool 分支自带滚动不足以覆盖这个尾形态。
        scrollToBottom();
        refreshThinkingState();
      })
      .catch((e: unknown) => appendError(t("D348", { message: errorText(e) })));
  }
  // 会话名下拉：展开/收起浮层（浮层 = 历史会话选择器，M392；「新建会话」动作项随 M406
  // 退场，新建归首行加号钮）；浮层外交互（点击其他处）收起。按钮在标题栏（drag 区）
  // 里——clickable 元素由 tauri drag.js 自动阻断拖拽，不需要 mousedown preventDefault
  //（REVIEW.md 第 16 条）。
  sessionButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setSessPop(sessPop.hidden);
  });
  // 段上 Escape 收会话浮层（stopPropagation：浮层开着时这拍 Escape 不落到面板/窗口层）。
  seg.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape" && !sessPop.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setSessPop(false);
      sessionButton.focus();
    }
  });
  // 浮层外交互（点击其他处）收起：会话浮层、合并选择器浮层、ctx hover 泡共用一条出口。
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && sessPop.contains(event.target)) return;
    if (event.target instanceof Node && sessionButton.contains(event.target)) return;
    setSessPop(false);
    if (event.target instanceof Node && selPop.contains(event.target)) return;
    if (event.target instanceof Node && modelChip.contains(event.target)) return;
    setSelPop(false);
    if (event.target instanceof Node && ctxWrap.contains(event.target)) return;
    ctxPop.hidden = true;
  });

  // 面板内 Escape（就地消费，不进键位表：Escape token 已被 editor.widget-escape
  // 占用，面板在 contentDOM 之外，那条绑定不命中——与 M139 搜索 panel 同先例同判词）。
  // 两段式（M351 a11y，design §5）：任一浮层开着时只收浮层，无浮层时才经 deps.togglePane
  // 收面板（收起是装配层动作：账本收 pane + 焦点归还）。
  panel.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (!selPop.hidden) {
      setSelPop(false);
      modelChip.focus();
      return;
    }
    if (!ctxPop.hidden) {
      ctxPop.hidden = true;
      return;
    }
    deps.togglePane();
  });

  // ── 唤起 / 收起（装配层执行；面板只维护挂载态与派生表现）───────────────────
  function attachTo(mount: HTMLElement | null): void {
    if (mount === mountEl) return;
    mountEl = mount;
    if (mount !== null) {
      mount.append(panel);
      panel.hidden = false;
      refreshChip();
      // when 的 30s 低频刷新：只在挂载期间走表（摘下即清，重挂重建）。
      if (whenTimer !== null) window.clearInterval(whenTimer);
      whenTimer = window.setInterval(refreshWhoLines, 30_000);
      // 会话身份看守（M370）：同一份生命周期——挂载起表、摘下即清。
      watchedSession = editor.activeSession();
      if (chipWatchTimer !== null) window.clearInterval(chipWatchTimer);
      chipWatchTimer = window.setInterval(watchActiveSession, 400);
    } else {
      // 摘出 DOM（元素长驻内存：订阅 / 撤销栈 / 流式态不丢），浮层与刷新表随之收起。
      panel.remove();
      setSessPop(false);
      setSelPop(false);
      effHint.hidden = true;
      ctxPop.hidden = true;
      if (whenTimer !== null) {
        window.clearInterval(whenTimer);
        whenTimer = null;
      }
      if (chipWatchTimer !== null) {
        window.clearInterval(chipWatchTimer);
        chipWatchTimer = null;
      }
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
    setStopHandler(handler) {
      stopHandler = handler;
    },
    textScale(direction: TextScaleDirection): void {
      // 基线先捕获（首次调用时读 --fs-ui 计算值）——捕获动作会同步 hpFontSize，必须在
      // 算步进之前完成，否则惰性初始化把刚步进的值冲掉。
      const base = harnessBaseFontSize();
      const next = nextHarnessFontSize(hpFontSize, direction, base);
      if (next === hpFontSize) return; // 到界：无变化、无提示、不报错（与 editor.textScale 同口径）
      hpFontSize = next;
      applyHarnessTextScale();
    },
    hasFocus(): boolean {
      return document.activeElement instanceof Node && panel.contains(document.activeElement);
    },
  };
}
