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
// 带当时实际值的多行（第一行 context window usage 走 D395）
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
// hover hint 第二行（cache hit rate 带值；M533 起并入 D465 退场）、D402 / D403 为 M381 config-only 空清单提示态
//（浮层模型段占位句 + chip 读屏名空态——不伪造模型条目）；D405–D408 为批准终态行
//（结果词 / 详情入口 / 原因句——M406 起挂在收敛后的同一工具行上）；D412–D416 为 M406
// 批准卡问句分工与副句、待决行尾注（D343/D344 的工具行整句模板随人话化三段式退场，
// 编号停用；D414 的命令类副句随 M540 删除，命令类卡片无副句）；
// D417–D419 为 M406 会话删除（行内删除钮读屏名 / 确认句 / 确认钮）；D409–D411 为 M391 登记的会话恢复
// 三错误码（harness_session_unreadable / _invalid / _vault_mismatch）——M392 恢复选择器的
// 消费点：恢复失败经 src/copy.ts 的 errorText 按 code 渲染上错误行（D348 的 {message}）；
// 选择器行本身不新造文案（无历史会话 = 不渲染清单容器，会话名缺原文回落 D330「新会话」））；
// D423–D434 为 M414 权限 chip 与批准卡次级动作（chip 短名 ×3 / chip 读屏名 / 浮层全名 ×3 /
// 浮层释义 ×3 / 浮层读屏名 / 「采纳且本会话不再问」——文案分两级见 design §7）、D435 为
// vault_delete 批准卡的后果说明（design §5.1 的面板半边）；D442–D444 为消息摘录卡片
//（change harness-message-excerpt：出处行模板 / 失锚 toast / transcript 卡跳回读屏名），
// 消息摘录手势与跳回在 src/message-quote-gesture.ts；D456 为 composer 草稿保存失败 warning
//（change composer-draft-persistence：防抖写控制器在 src/harness-draft.ts、落盘在 Rust 的
// harness::draft、块模型 ⟺ 草稿 JSON 在 src/quote-card.ts——本模块只挂时点：编辑后防抖、
// 输入区失焦 / 面板关闭 / 窗口失焦或退出前 flush、装载 vault 后恢复、发送成功后清除）；
// M378 起面板内容字号可缩放（--lumir-hp-scale）；M627 起它由**一套字号**驱动——比值来自
// 编辑器当前字号 ÷ 配置基线，随每条 ⌘+/-/0 同步施加（与内容 pane 一起变，焦点在哪无关；
// 计算与路由在装配层 src/main.ts，面板不认焦点、不自持档位）；
// 长驻元素（toggle 钮 / harness 段 / 输入框 placeholder / 按钮 / 上下文 chip / ctx 读数 /
// 合并选择器 chip / 待决批准项）注册 onRelabel，
// 语言切换时从已存状态重渲（design §5.2 的不变量）；transcript 的历史条目是已发生事实的记
// 录，不随语言切换改写（与 toast 历史同口径）——复制钮的 ✓ 反馈与 provider 浮层是交互件
//（前者每次点击现取、后者每次打开现建），天然跟当前语言走。

import { GFM, parser as commonmarkParser } from "@lezer/markdown";
import { currentLanguage, errorText, formatDate, formatRelative, onRelabel, t, tPlural } from "./copy";
import type { CopyKey, Language } from "./copy";
import {
  configGet,
  configSetValue,
  errorMessage,
  harnessAbort,
  harnessApprove,
  harnessDeleteSession,
  harnessDraftGet,
  harnessDraftPut,
  harnessListSessions,
  harnessNewSession,
  harnessPermissionRuleRemove,
  harnessReadImage,
  harnessResumeSession,
  harnessSend,
  harnessSetThinkingEffort,
  harnessState,
  harnessSubagentContinue,
  harnessSubagentStop,
  harnessWriteImage,
  onHarnessEvent,
  openExternalUrl,
  uncoveredEventType,
} from "./ipc";
import type { HarnessEvent } from "./ipc";
import type { DecisionReason } from "./bindings/DecisionReason";
import type { ThinkingEffort } from "./bindings/ThinkingEffort";
import {
  assembleHarnessContext,
  collapseMiddleDirs,
  serializeHarnessContext,
} from "./harness-context";
import type { HarnessContextBlock, HarnessContextSource } from "./harness-context";
import { createHarnessDraftStore } from "./harness-draft";
import { createFollowController } from "./harness-scroll-lock";
import { escapeRouter, registerEscapeLayer, unregisterEscapeLayer } from "./escape-router";
import type { FollowState } from "./harness-scroll-lock";
import {
  applyOverlayPlacement,
  isLayoutCapable,
  measureOverlayNaturalWidth,
  overlayFontSize,
  placeOverlay,
} from "./overlay-placement";
import type { OverlayTier } from "./overlay-placement";
import {
  findPathCandidates,
  isWellFormedVaultPath,
  parseToolArgs,
  splitToolText,
  toolPathTargets,
} from "./harness-path-link";
import type { PathTargetIndex, ToolPathTarget } from "./harness-path-link";
import {
  createMessageQuoteCard,
  createQuoteCard,
  draftUnknownBlockText,
  isMessageQuoteCard,
  parseMessageAt,
  serializeDelivery,
  serializeQuoteMessage,
} from "./quote-card";
import type { ComposerBlock, ImageCard, MessageQuoteCard, QuoteCard } from "./quote-card";
import { blobToBase64, firstImageFileIndex } from "./paste-image";
import type { QuoteImageOutcome, QuotedImage } from "./quote-image";
import { createMessageQuoteGesture, MESSAGE_QUOTE_FLASH_MS, resolveMessageQuoteTarget } from "./message-quote-gesture";
import { highlightCode } from "./preview/code";
import { attachmentMimeOfName, countExcerptImageRefs } from "./preview/attachments";
import { BLOCK_TRIGGER_CLASS, CODEBLOCK_FS_TRIGGER_LABEL, CORNERS_ICON_SVG } from "./preview/block-trigger";
import { TABLE_TRIGGER_LABEL } from "./preview/table-trigger";
import { planCodeBlockOfDocument } from "./preview/code-block-content";
import type { CodeBlockRender } from "./preview/code-block-content";
import { clusterBackward, clusterForward, currentKillSlot, imageMentionText, imageOrdinals, mergeKillText, setKillSlot, wordEndForward, wordStartBackward } from "./quote-card";
import type { CommandId } from "./keys";
import { mirrorThemeScope, THEME_SCOPE_HOST_CLASS } from "./overlay-scope";
import type { AppShell } from "./shell";

/** 面板对编辑器句柄的结构需求：上下文组装（HarnessContextSource）+ 关面板时的焦点归还 +
 *  主题 scope 镜像的源元素（view.dom）。写成窄接口，不消费 EditorHandle 的其余面。 */
export interface HarnessPanelEditor extends HarnessContextSource {
  view: HarnessContextSource["view"] & { dom: HTMLElement; focus(): void };
}

/**
 * 块级全屏的接线面（装配层注入，change add-harness-block-fullscreen §4）。
 *
 * 三个动作都由装配层落到**既有的**两个单实例遮罩上（`src/table-fullscreen.ts` /
 * `src/code-block-fullscreen.ts`）：关闭路径、主题镜像、读屏语义、焦点归还因此与 content pane
 * 逐条同源（REVIEW.md「同一语义两处真源」条）。
 */
export interface HarnessBlockFullscreenPort {
  /** 表格：`source` 是刚渲染出的 `<table>`（遮罩深克隆它）；`label` 是该表的读屏名
   *  （`Markdown 表格 N`，N = 本条消息内同类块的序号）；`trigger` 是发起钮（再次触发 = toggle，
   *  关闭后焦点归还给它）。 */
  openTable(source: HTMLElement, label: string, trigger: HTMLElement): void;
  /** 代码块：`render` 是**点击那一刻**按块源码现取的呈现计划（D4：打开即快照，后续流式增量
   *  不回灌）；`trigger` 既是 toggle 判据与焦点落点，也是遮罩主题 scope 的解析起点（它在
   *  transcript 内，遮罩会走到那块「已镜像宿主」上，见 src/overlay-scope.ts）。 */
  openCodeBlock(render: CodeBlockRender, label: string, trigger: HTMLElement): void;
  /** 内容换代（会话切换 / 面板重载 / 快照重取）：遮罩里的快照已不存在，显式关闭
   *  （spec「内容换代时遮罩自动关闭」；关闭路径与既有 `closeDocumentOverlays` 同族）。 */
  close(): void;
}

/** 渲染期的接线面（模块层的渲染件不认识面板根：装配边界只绑端口与标签，scope 宿主由
 *  装配层按来源推导——trigger 本身就在面板里）。 */
export interface HarnessBlockOpeners {
  code(render: CodeBlockRender, label: string, trigger: HTMLElement): void;
  table(source: HTMLElement, label: string, trigger: HTMLElement): void;
}

export interface HarnessPanelDeps {
  shell: AppShell;
  editor: HarnessPanelEditor;
  /** 块级全屏（代码块 / 表格）的接线面（change add-harness-block-fullscreen）：面板负责块的
   *  定位容器与悬停钮，遮罩本体、来源与焦点归还全在装配层（复用既有两个单实例遮罩）。
   *  未注入时钮照常渲染、点击无动作——与触发钮 widget 的「opener 未接线返回 null」同口径。 */
  blocks?: HarnessBlockFullscreenPort;
  /** 开/合 harness pane 的装配层入口（账本 split/close + DOM 槽 + 焦点移交）：toggle 钮、
   *  面板内 Escape、摘录插入的「未开先开」都经这一条路径——面板自己不碰 pane 账本
   *  （HP1，change move-harness-to-pane-chat-frame；⌘⇧A 命令表也在装配层）。 */
  togglePane(): void;
  /** 面板发起的瞬态提示出口（装配层的 `showToast`，锚 harness pane 右下角——M420 合同 O4）。
   *  消息摘录失锚（D443）经它上屏；面板**不自建** toast 产出点（toast 归属单一来源，M423
   *  按 tower 裁决从面板自持实现收回装配层）。 */
  toast(text: string): void;
  /**
   * 点击 vault 路径的落点（change harness-path-link）：装配层经既有唯一打开链路以「新标签」
   * 意图打开，可选 1-based 行号落点。面板不自己开文件、不判文件系统——路径的合法性与落点
   * 全在装配层与编辑器侧。
   */
  openVaultPath(path: string, line?: number): void;
  /**
   * 渲染期的目录判定（change harness-dir-link）：装配层把它接到文件树的只读查询上，面板
   * 只查表、不持有目录状态。与 `openVaultPath` 并列——目录可点性与左栏定位因此使用同一份
   * 模型（文件树），不存在「可点但定位不到」的第二份判据。
   */
  isVaultDir(path: string): boolean;
  /**
   * 目录路径的落点（change harness-dir-link）：在左栏文件树里定位（展开祖先 + 滚动 + 短暂
   * 高亮）。**不打开文档、不切标签、不创建条目**——目录不是文档，落点归树。
   */
  revealVaultDir(path: string): void;
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
  /** cron 点击发起运行的面板切屏（M612，场景 170）：清渲染面、把本次 prompt 作为用户消息
   *  上屏、立刻打开轮次闸门与发送相位。装配层 MUST 在 `harness_cron_run` **之前**调用——
   *  后端不为 cron 回合发 `sent` / `auto_turn_started`，晚开闸门会把先到的正文分片丢掉。
   *  返回 `true` = 本次确实切了屏（失败回滚启用）；`false` = 交互轮次在途（sendPhase 非 idle），
   *  此时后端必 busy 拒单、乐观切屏注定被回滚，故**不动渲染面**（M612 r1 P2-1：先清屏再回滚
   *  会把在途轮次的流式泡清掉、关掉轮次闸门，后续分片被当迟到产出丢弃）。 */
  beginCronRun(prompt: string): boolean;
  /** 按后端当前会话重取快照重建渲染面（M612）：cron 点击运行发起失败时撤回乐观切屏，
   *  面板回到后端真实会话。不切 vault。 */
  reloadSession(): void;
  /**
   * 下发**可点的 vault 文件路径集**（change harness-path-link）：装载 vault 时一次、watch
   * 增量后一次。面板用它做存在性校验（路径候选只有命中它才可点）；集合内容由装配层按
   * 「文件 + 非惰性 + 可打开（非图片/二进制）」过滤，面板不重复判定文件类型。
   */
  setPathLinkIndex(paths: readonly string[]): void;
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
   * 图片摘录入 composer（change add-image-quote-to-chat design §4.1；失败留痕见 M662）：
   * 卡片可为 null（选区只有图片时不造空文本卡，D4）；结果数组里成功的图片按文档序紧接卡片
   * 之后插入，整次插入是**一个**结构编辑步（一次 ⌘Z 撤掉整次引用）。面板未开时先开。来源路径
   * （`QuotedImage.source`）只落缩略图 hover title，不进块模型 / 序列化 / 草稿（design §4.2）。
   *
   * 失败条目（`ok: false`）**不是**一次静默：有文本卡片时在卡片的出处行留「N 张图片未能引用」
   * （D586），没有卡片时落在输入区的状态行——持久可见，不是 3 秒 toast（Alex 2026-10-24 现场）。
   */
  insertQuoteWithImages(card: QuoteCard | null, outcomes: readonly QuoteImageOutcome[]): void;
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
  /** 施加**一套字号**的缩放级（M627）：`ratio` = 编辑器当前字号 ÷ 配置基线（1 = 基线），
   *  由装配层在每条 view.text-scale-* 命令里算出后传入（面板不自持字号档位、不认方向）。
   *  缩放经 --lumir-hp-scale 施加到面板全部内容字号（单一写入路径）；运行期不落盘。
   *  `ratio` 非有限正数时按基线处理（异常输入不放大、不抛错）。 */
  applyTextScale(ratio: number): void;
  /**
   * composer 侧的文本面命令入口（M447，change composer-emacs-nav design §3.2）：按命令 id 分派
   * 到 composer 的模型层动作（移动 / 扩选 / 删除 / kill-yank / 转置）。**命中即消费**——装配层的
   * 分派包装在事件目标落在 composer 内时调它，而分发器命中绑定即 `preventDefault`（命中即吞默认
   * 行为），因此本入口**不返回**「是否消费」；「该处无动作」按**无操作**处理，MUST NOT 放行原生
   * 路径（放行会让段首 ⌥⌫ 的原生 deleteWordBackward 跨块合并 / 删卡）。命令实现是模型层纯函数
   * 驱动，不认识「事件目标」。
   */
  composerCommand(command: CommandId): void;
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
// 顶层块只有三类卡片（quote / msgquote / image，原子块）与 paragraph（问题段落，
// 文本可含 \n 软换行）。DOM 只是这个模型的渲染面：结构性修改先算模型、再整面重渲——
// 换行与断行后视口的质量合同（HC1 一次 ⇧Enter 恰好一行 × HC2 光标行在视口内）在
// docs/specs/harness-composer.md：落法是 insertSoftBreakAtCaret（段末 / 卡片前缘落新空
// 段落块——尾随 \n 不产生行盒）与 caretScrollTop（DOM 侧量读数、纯函数给目标滚动位）。
// contenteditable 的四个已知 quirk（design §2「不允许侥幸」）因此各有单一收口：
//   ① 粘贴分派：剪贴板含 image/* 走图片卡片（图优先），其余只经 insertPlainText
//     进纯文本（change harness-composer-image-paste design §7）；
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

/** 混排里的原子卡片块（quote / msgquote / image 三类）——判空 / 拆段 / 删除都按「原子块」整体作用。 */
type CardBlock =
  | { readonly kind: "quote"; readonly card: QuoteCard }
  | { readonly kind: "msgquote"; readonly card: MessageQuoteCard }
  | { readonly kind: "image"; readonly card: ImageCard };

function isCardBlock(block: ComposerBlock): block is CardBlock {
  return block.kind === "quote" || block.kind === "msgquote" || block.kind === "image";
}

/**
 * 元素内**文档序第一个文本节点**（M457：卡片边界光标位的落点宿主）。卡片的文本住在
 * `.lumir-hp-qc-ex` / `.lumir-hp-qc-src` / 图片元信息行里，落在**文本节点上**才有 caret 几何
 * （落在卡片元素上量不到，见 `domCaretTarget` 的说明）。没有文本节点时返回 `null`。
 */
function firstTextNodeIn(el: Element): Text | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

/**
 * 光标位是否是「卡片前缘」这一档（= 相邻原子块之间的**边界光标位**，design §3.1）：
 * 块下标指向原子卡片、offset 为 0。三种现场归同一个模型值——相邻两张卡之间、卡片与段落
 * 之间、composer 以卡片开头。
 *
 * 该位置在 DOM 里是**无文本宿主**的块级边界（`Range(composer, N)`），内容型输入到达时
 * 要按「在该处物化一个段落」处理（见 insertPlainTextAtCaret / beforeinput 的拦截）。
 */
export function isCardFrontCaret(blocks: readonly ComposerBlock[], caret: ComposerCaret): boolean {
  if (caret.offset !== 0) return false;
  const target = blocks[caret.block];
  return target !== undefined && isCardBlock(target);
}

/** 一次**内容型键入**的键面事实（`boundaryTypingCaret` 的入参，与 KeyboardEvent 解耦——
 *  模型层不认识事件对象，只认识这四个判据）。 */
export interface ComposerTypingKey {
  /** `KeyboardEvent.key`（可打印单字符判据 = 长度为 1）。 */
  readonly key: string;
  /** ⌘ / ⌃（与面板 keydown 里 `mod` 同口径）。 */
  readonly mod: boolean;
  /** ⌥（macOS 的 Alt 层会替换字符，按键归输入区既有的就地路径与统一键位表，不在本判据内）。 */
  readonly alt: boolean;
  /** IME 组合期（组合内容走 compositionstart 的物化档）。 */
  readonly composing: boolean;
}

/**
 * composer 边界光标位上的**内容型键入**判据（HC3 第 3 条的实现面，M457）：命中返回要物化的
 * 模型位，未命中返回 `null`。
 *
 * 为什么需要它：边界位是**无文本宿主**的位置——卡片是 `contenteditable=false` 的原子块、块级
 * 容器边界又量不出 caret 几何，引擎因此**不派 `beforeinput` / `input`**（WebKit 实测：keydown
 * 到达 composer、`beforeinput` / `input` 都不派、字也不落）。物化若只挂在 `beforeinput` 上，
 * 在「两张相邻卡片之间」这一档永远不可达——那正是 Alex 2026-10-12 报的「两卡之间不能输入」
 * （M450 的模型层语义与单测都是对的，挂点挂到了不派发的事件上）。
 *
 * 判据与既有键入档**同一份锚点**：折叠选区 + 非修饰键 + 可打印单字符 + 非组合期 + 光标是
 * 卡片前缘（`isCardFrontCaret`）。有选区、⌘/⌃/⌥ 组合、Enter/退格/方向键与 IME 进程键（key
 * 长度 > 1）一律不命中，照旧走各自既有路径。
 */
export function boundaryTypingCaret(
  blocks: readonly ComposerBlock[],
  selection: ComposerSelection | null,
  key: ComposerTypingKey,
): ComposerCaret | null {
  if (selection === null) return null;
  const { anchor, focus } = selection;
  if (anchor.block !== focus.block || anchor.offset !== focus.offset) return null;
  if (key.composing || key.mod || key.alt) return null;
  if (key.key.length !== 1) return null;
  return isCardFrontCaret(blocks, focus) ? focus : null;
}

/**
 * 边界光标位的 DOM → 模型归一（design §3.1）：容器元素自身的第 N 个子边界
 * （`Range(composer, N)`）就是「第 N 块的前缘」= `{block: N, offset: 0}`；N 允许等于块数
 * （末尾之后 = composer 的末尾边界），故此值钳在 `[0, blockCount]`。
 *
 * 与 `domCaretTarget` 互为逆运算：写回落在同一个边界上、读回得到同一个模型值——这正是
 * 「卡片前缘的模型位置写得进去、读得出来」的往返对称（今天读回是 null 的那个缺口）。
 */
export function boundaryCaretAt(containerIndex: number, blockCount: number): ComposerCaret {
  return { block: Math.max(0, Math.min(containerIndex, blockCount)), offset: 0 };
}

/** 光标写回 DOM 的落点形态：块级容器边界（`Range(composer, index)`）、段落内字符偏移，或
 *  **卡片内的首个文本位**（无文本宿主的边界位的落点宿主，见 `domCaretTarget`）。 */
export type DomCaretTarget =
  | { readonly kind: "boundary"; readonly index: number }
  | { readonly kind: "text"; readonly index: number; readonly offset: number }
  | { readonly kind: "cardText"; readonly index: number };

/**
 * 光标位写回 DOM 的落点形态（`setDomCaret` 的唯一判据）：**有文本宿主的相邻位优先**，段落内
 * 落字符偏移、卡片边界位落相邻的文本位；「末尾之后」落**最后一个块**的边界。
 *
 * M457 起卡片边界位（含相邻两张卡片之间、composer 以卡片开头）不再写 `Range(composer, index)`：
 * 那个位置在两个块级盒之间，**量不出 caret 几何**（`getBoundingClientRect()` 全 0，WebKit 与
 * Blink 实测同结果，见 docs/specs/harness-composer.md §实测依据）——画在哪由引擎自行决定，真机
 * 现场就是「⌃B 之后光标落进卡片正文里」（Alex 2026-10-12）。落点因此改成两类**有文本宿主**的
 * 相邻位：
 * - 前一块是段落 → 该段落的**末缘**（文本节点给出几何与行位；段落非空时与边界位同属
 *   `normalizeComposerCaret` 的归一等价类，导航 / 行级命令的口径不变）；
 * - 两侧都没有文本宿主（两卡相邻 / composer 以卡片开头）→ 后一张卡片的**首个文本位**
 *   （DOM 读回按「锚在卡片内」归一为同一个边界位，HC3 第 1 条已声明这一档）。
 *
 * M473：「末尾之后」（`block = 块数`）同样不再写块级容器边界（`Range(composer, 块数)` 的 caret
 * 几何恒 0，画在哪由引擎决定 ⇒ 真机表现为「光标不知道跑哪去了」；⌃E 在末段行末、⌃F 在最后一块
 * 之后都会落到这一档）。**模型值不动**（仍是 `{block: 块数, offset: 0}`），只把写回落**最后一个
 * 块**的边界：
 * - 末块是**非空段落** → 该段的**文本末缘**（`{text, 块数-1, len}`）。它与「末尾之后」是契约已
 *   声明的归一等价表示（M462）⇒ 导航口径不变、读回经 `normalizeComposerCaret` 仍是「末尾之后」；
 * - 末块是**空段落** → 保留块级容器边界。空段落只有 `offset 0` 一个停靠点（前缘即末缘），落到
 *   那里就与「空段落前缘」这一档的写回位重合：两个模型值写回同一个 DOM 位 ⇒ 停靠点序列的
 *   「一步必有位移」（单测性质）判红，且读回会把「末尾之后」折成空段落前缘（编辑语义随之变）；
 * - 末块是**卡片** → 保留块级容器边界。卡片没有「文本末缘」这个宿主（它的后缘就是容器边界），
 *   落到卡片内部文本（`cardText`）会把读回折成**卡片前缘**——那是另一个模型值（内容型键入会物化
 *   到卡片**之前**），与「模型值不动」冲突。
 *
 *   末两档（空段落 / 卡片）都是 0×0 的无几何位或不可测位，可见性**未修**——仍是 **HC3 已知边界**
 *   （登记 docs/specs/harness-composer.md 与 docs/backlog.md）。
 *
 * 抽成纯函数是为了让读写两侧共用同一条规则——`boundaryCaretAt` 是它的逆向，两者的同一性由
 * 单测逐块序全枚举钉住。
 */
export function domCaretTarget(blocks: readonly ComposerBlock[], caret: ComposerCaret): DomCaretTarget {
  const index = Math.max(0, Math.min(caret.block, blocks.length));
  const block = blocks[index];
  if (block !== undefined && isCardBlock(block)) {
    const prev = blocks[index - 1];
    if (prev !== undefined && prev.kind === "paragraph") {
      return { kind: "text", index: index - 1, offset: prev.text.length };
    }
    return { kind: "cardText", index };
  }
  if (block === undefined) {
    const lastIndex = blocks.length - 1;
    const last = blocks[lastIndex];
    // 末块是**非空段落**才落它的文本末缘；空段落只有一个停靠点（前缘即末缘），落到那里会与
    // 「空段落前缘」这一档的写回位重合，把停靠点序列的「一步必有位移」压成原地空走（单测判红）；
    // 卡片没有文本末缘宿主（它的后缘就是容器边界）。
    if (last === undefined || isCardBlock(last) || last.text.length === 0) return { kind: "boundary", index };
    return { kind: "text", index: lastIndex, offset: last.text.length };
  }
  return { kind: "text", index, offset: Math.max(0, Math.min(caret.offset, block.text.length)) };
}

/**
 * 光标处拆段插入**卡片块**（design §5 装配合同 + Alex 2026-10-06 裁决：插入后光标落到卡片
 * 下一行的问题段落——该处已有段落复用、否则新建）：
 * - 光标在段落中间：段落从光标处拆两段，卡片插两段之间，光标落第二段段首；
 * - 光标在段落起始：卡片插在该段落之前，光标落原段落段首；
 * - 光标在段落末尾：卡片插在段落之后，随后补一个空段落承接光标（末尾已有空段落则复用——
 *   空段落末尾即「段落起始」分支，天然复用）；
 * - 光标在卡片（quote / msgquote 两类原子块）前缘：卡片插在其前，其后补空段落承接光标。
 *
 * 两类卡片共用本函数（insertCardAtCaret 是 quote 的薄封装、msgquote 走 insertMessageQuoteCard）：
 * 卡片在混排里的行为（拆段 / 光标落点 / 复用空段落）与卡片种类无关。
 */
export function insertBlockAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
  block: ComposerBlock,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  const at = Math.max(0, Math.min(caret.block, blocks.length));
  const target = blocks[at];
  const emptyPara: ComposerBlock = { kind: "paragraph", text: "" };
  if (target !== undefined && isCardBlock(target)) {
    const next: ComposerBlock[] = [...blocks.slice(0, at), block, emptyPara, ...blocks.slice(at)];
    return { blocks: next, caret: { block: at + 1, offset: 0 } };
  }
  const text = target?.kind === "paragraph" ? target.text : "";
  const offset = target === undefined ? 0 : Math.max(0, Math.min(caret.offset, text.length));
  if (offset === 0) {
    // 段落起始 / 空段落 / composer 末尾的空追加：卡片在前，原段落（或新空段落）承接光标。
    const rest: ComposerBlock[] = target === undefined ? [emptyPara] : blocks.slice(at);
    const next: ComposerBlock[] = [...blocks.slice(0, at), block, ...rest];
    return { blocks: next, caret: { block: at + 1, offset: 0 } };
  }
  const before = blocks.slice(0, at);
  const after = blocks.slice(at + 1);
  if (offset >= text.length) {
    // 段落末尾（非空）：保留原段落，卡片在后，新空段落承接光标。
    const next: ComposerBlock[] = [...before, target!, block, emptyPara, ...after];
    return { blocks: next, caret: { block: at + 2, offset: 0 } };
  }
  // 段落中间：拆两段，卡片居中，光标落第二段段首（复用卡片下一行的段落）。
  const head: ComposerBlock = { kind: "paragraph", text: text.slice(0, offset) };
  const tail: ComposerBlock = { kind: "paragraph", text: text.slice(offset) };
  const next = [...before, head, block, tail, ...after];
  return { blocks: next, caret: { block: at + 2, offset: 0 } };
}

/** 光标处插入**引用卡片**（insertBlockAtCaret 的薄封装，签名保持 M343 既有消费者不变）。 */
export function insertCardAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
  card: QuoteCard,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  return insertBlockAtCaret(blocks, caret, { kind: "quote", card });
}

/** 移除一个块（卡片 × 钮的公共件）：光标落被删块的前一个文本块末尾（无前者则后继块前缘）。
 *  `deleteForwardAtCaret` 的卡片档（⌃D / Delete 在卡片前缘）也走本函数——两处的光标落点是同一条
 *  口径，M473 起共用这一份实现（旧实现在前删那一路各写一份，落点不同）。 */
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
 * 光标在卡片前缘（含相邻两张卡之间）时视为在该处有一个空段落——**卡片原样保留**
 * （design §3.3：旧实现用 `slice(at + 1)` 跳过了 `blocks[at]`，把那张卡片删掉）。
 */
export function insertPlainTextAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
  text: string,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  const at = Math.max(0, Math.min(caret.block, blocks.length));
  const target = blocks[at];
  const isCard = target !== undefined && isCardBlock(target);
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
  const next = [...blocks.slice(0, at), ...replacements, ...blocks.slice(isCard ? at : at + 1)];
  const caretBlock = at + replacements.length - 1;
  const caretOffset = (segments.length === 1 ? prefix.length : 0) + segments[segments.length - 1].length;
  return { blocks: next, caret: { block: caretBlock, offset: caretOffset } };
}

/**
 * ⇧Enter 软换行：**一次按键恰好加一行可见行**，光标落在新行的可见位置
 * （不变量 HC1，合同 docs/specs/harness-composer.md）。
 *
 * 三条落法（同一按键路径，model 层一次算出）：
 * - 光标在段落**中间**：段内插 `\n`（不拆块）——内部换行照常产生行盒，光标落换行之后；
 * - 光标在段落**末尾**（含空段落）或**卡片前缘**：在光标处落一个**新的空段落块**，
 *   光标落到它段首。不给段落追加尾随 `\n`：CSS 里尾随换行**不产生行盒**（`white-space:
 *   pre-wrap` 下 "ab\n" 与 "ab" 同高），旧实现因此让第一次 ⇧Enter 零可见变化、要按两次
 *   才看到换行（Alex 2026-10-10 现场）。空段落块有 `min-height: 1em`，一行真实落地；
 * - 光标在**「末尾之后」**（越界位，见下文）：新空段落块追加在**末尾**。
 *
 * 返回的块序列里，光标所在段落**恒不以 `\n` 结尾**——这是「光标在可见行上」的机器判据，
 * 属性测试按块序列 × 光标位置全枚举钉死。
 *
 * 光标位是**越界位**——「末尾之后」`{block: 块数, offset: 0}`（M462）时当作「末块之后」处理
 * （HC1 第 3 条的落点）：它既是 HC4 停靠点序列的末项、HC3 第 2 条点名的合法光标位，
 * 又是**末段**末缘的**归一等价表示**
 * （`normalizeComposerCaret` 把**末段**的非空末缘折到这里——M465 起只有末段档与卡片档还折，
 * 行级命令 ⌃E / ⌃F 落在末段末缘时即此值，并把该值写回 DOM 的**末块边界**——M473 起末块是段落
 * 时落在其文本末缘，真机探针实测选区锚 `#text(<qpara>)@len`；此前是块级容器边界
 * `#composer@块数`、caret 几何为零）。不加这一档，下面的钳制会把 `offset 0`
 * 当成**末段段首**：`\n` 落到末段文本第 0 位 ⇒ 空行出现在当前行**之前**、光标停在文字行行首
 * （Alex 2026-10-12 现场）。落新空段落块取代钳制，同时保证 HC1 第 3 条的落点（新行在该段之后）。
 */
export function insertSoftBreakAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
): { blocks: ComposerBlock[]; caret: ComposerCaret } {
  if (caret.block >= blocks.length) {
    // 「末尾之后」：新空段落追加在**末尾**（末块是卡片时同样在末尾——「卡片前缘」是另一个模型位）。
    const next = [...blocks, { kind: "paragraph", text: "" }] as ComposerBlock[];
    return { blocks: next, caret: { block: next.length - 1, offset: 0 } };
  }
  const at = Math.max(0, Math.min(caret.block, blocks.length - 1));
  const target = blocks[at];
  if (target === undefined || target.kind !== "paragraph") {
    // 卡片前缘（含 composer 以卡片开头、无前段落）：在光标处落一个新空段落——新行就在
    // 卡片那一行的上方；没有前段落时同样加行，不静默无操作（HC1 对全部光标位置成立）。
    const next = blocks.slice() as ComposerBlock[];
    next.splice(at, 0, { kind: "paragraph", text: "" });
    return { blocks: next, caret: { block: at, offset: 0 } };
  }
  const offset = Math.max(0, Math.min(caret.offset, target.text.length));
  const next = blocks.slice() as ComposerBlock[];
  if (offset >= target.text.length) {
    // 段末：新空段落块承接光标（尾随 \n 的形态在这里被取代——见函数头）。
    next.splice(at + 1, 0, { kind: "paragraph", text: "" });
    return { blocks: next, caret: { block: at + 1, offset: 0 } };
  }
  next[at] = { kind: "paragraph", text: `${target.text.slice(0, offset)}\n${target.text.slice(offset)}` };
  return { blocks: next, caret: { block: at, offset: offset + 1 } };
}

/** composer 视口自动滚动的边距（px）：光标行不贴容器边沿，留一点呼吸（HC2）。 */
export const CARET_SCROLL_MARGIN = 4;

/**
 * 光标行滚进视口的目标 scrollTop（纯函数，不变量 HC2 —— 合同 docs/specs/harness-composer.md）。
 *
 * composer 的 DOM 是**重渲**出来的（renderComposer 之后 setDomCaret 用程序化 Range 落光标），
 * 引擎在选区变化时的 reveal 行为是引擎特性：WKWebView 会 reveal、Blink 不会（见
 * scrollCaretIntoView 的实测记录）。判据抽在这里，DOM 侧只负责量读数、写 scrollTop——
 * 条款（光标行在视口内）因此不依赖某一份引擎实现。
 *
 * 坐标系：`caret.top/bottom` 是光标行在**滚动内容坐标系**里的上下沿
 * （= 视口坐标 − 容器上沿 + view.scrollTop；调用方换算）。判定：
 * - 光标行末带边距仍在可视区内 → 返回原 scrollTop（**同一性**：每次重渲都动视口会抖）；
 * - 越出上沿 → 滚到 `top - margin`；
 * - 越出下沿 → 滚到 `bottom + margin - clientHeight`（光标行贴可视区底边）；
 * - 结果钳在 `[0, scrollHeight - clientHeight]`——内容不足一屏时恒 0，不产出越界滚动位。
 */
export function caretScrollTop(
  view: { scrollTop: number; clientHeight: number; scrollHeight: number },
  caret: { top: number; bottom: number },
  margin: number = CARET_SCROLL_MARGIN,
): number {
  const maxScroll = Math.max(0, view.scrollHeight - view.clientHeight);
  const clamp = (value: number): number => Math.max(0, Math.min(value, maxScroll));
  if (caret.top - margin < view.scrollTop) return clamp(caret.top - margin);
  if (caret.bottom + margin > view.scrollTop + view.clientHeight) {
    return clamp(caret.bottom + margin - view.clientHeight);
  }
  return clamp(view.scrollTop);
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
  if (isCardBlock(target)) {
    // 光标在卡片前缘（= 上一块之后）：退格作用于**前一块**——前块是卡片则整块删，
    // 是段落则删其末字符（光标落段落末尾）；块首则无物可删。
    if (at === 0) return null;
    const prev = blocks[at - 1];
    if (isCardBlock(prev)) {
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
  if (isCardBlock(prev)) {
    // 卡片按整体作用：整块移除，光标留在当前段落段首。
    next.splice(at - 1, 1);
    return { blocks: next, caret: { block: at - 1, offset: 0 } };
  }
  const merged = prev.text + target.text;
  next.splice(at - 1, 2, { kind: "paragraph", text: merged });
  return { blocks: next, caret: { block: at - 1, offset: prev.text.length } };
}

/** 前向删除（Delete 键）：光标在卡片前缘 = 整块删该卡片；段内删字符；段末遇段落则合并。
 *
 *  卡片档的落点**与 `removeBlockAt` 完全同口径**（M473，直接复用同一个函数）：光标贴被删块的
 *  前一个文本块末尾（无前者则后继块前缘）。两个函数的模型位因此合成一个真源——`⌃D` / `Delete`
 *  在卡片前缘（M457 起它**画在**前一段落末缘那一行）按一次，光标不再从上一行行尾跳到下一行行首
 *  （旧实现写「被删块的原下标」= 后一块前缘，与同位置的「写回位」那一路落点不同；M465 收紧
 *  `normalizeComposerCaret` 的折叠后暴露，登记 `docs/backlog.md` 的 worker-m465 finding）。 */
export function deleteForwardAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
): { blocks: ComposerBlock[]; caret: ComposerCaret } | null {
  const at = Math.max(0, Math.min(caret.block, blocks.length - 1));
  const target = blocks[at];
  if (target === undefined) return null;
  if (isCardBlock(target)) return removeBlockAt(blocks, at);
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
  if (isCardBlock(nxt)) {
    next.splice(at + 1, 1);
    return { blocks: next, caret };
  }
  const merged = target.text + nxt.text;
  next.splice(at, 2, { kind: "paragraph", text: merged });
  return { blocks: next, caret };
}

// ---------------------------------------------------------------------------
// M447（change composer-emacs-nav design §4）：Emacs 文本导航族的模型层——停靠点序列与
// 同形位归一等价类、移动 / 扩选、词级 kill / kill-line / 转置的纯函数。全部零 DOM。
// ---------------------------------------------------------------------------

/** 模型端点相等（同一块下标 + 同一偏移）。 */
function sameCaret(a: ComposerCaret, b: ComposerCaret): boolean {
  return a.block === b.block && a.offset === b.offset;
}

/** 模型端点的可比标识（kill 槽的相接端——槽的坐标空间跨编辑器 / composer，故用不透明串）。 */
function caretKey(caret: ComposerCaret): string {
  return `${caret.block}:${caret.offset}`;
}

/**
 * 同形位归一等价类（design §4.1）：段落**非空**末缘（`offset ≥ 文本长度`）只在**写回同一个 DOM
 * 位**时才归一到紧邻后块的前缘——M465 起折叠条件按「落点形态的同一性」收紧，不再只看「相邻」：
 *
 * - **后块是原子卡片**（或没有后块）⇒ 折叠。卡片前缘的写回位就是本段末缘（`domCaretTarget` 的
 *   卡片档：前块是段落 ⇒ `{kind: "text", index: i, offset: len}`），同一位、同一个表示；末段末缘
 *   则归一到「末尾之后」（`{block: 块数, offset: 0}`——M462 已声明这一档即末段末缘的等价表示；
 *   M473 起它的写回位是**末块边界**：末块是段落时落在该段文本末缘，与 `(i, len)` 是同一个 DOM 位）。
 * - **后块是段落**（含 M456 起常驻的末尾空段落）⇒ **不折叠**。两个段落各占自己的行盒
 *   （`.lumir-hp-qpara` 是块级盒），本段末缘在上一行行尾、后块前缘在下一行行首，两个**不同**的
 *   DOM 位。旧实现无条件折叠，把「本段末缘」这个真实停靠点从序列里抹掉：`⌃B` 从后块前缘退一步
 *   落到 `(i, len - 1)`（Alex 2026-10-12 现场：「光标移动到上一行的倒数第二个字符后面，而不是
 *   行末」）。
 *
 * 空段落不归一（它自占一行，只有 `offset 0` 一个停靠点）；MUST NOT 把它折进「末尾之后」——那会让
 * 归一变成非传递关系（`(i, len)`→`(i+1, 0)`、`(i+1, 0)`→`(n, 0)` 而 `(i, len)` 与 `(n, 0)` 不同类），
 * 等价类随即把 `(i, len)` 一并吃掉，正是上面那条缺陷。
 *
 * **实现注记（与 design §4.1「读回处也调它」的偏差）**：`caretFromDom` 的编辑读回**不**调本
 * 函数——编辑动词（退格 / 前删 / 键入分派 / 粘贴）依赖「段落末缘 `(i, len)`」与「后块前缘
 * `(i+1, 0)`」是**两个**不同的模型值（归一后 `backspaceAtCaret` 会把段落末缘的退格当成跨块
 * 合并、`insertPlainTextAtCaret` 会把段末键入插到下一段段首）。本等价类服务的是**导航**
 *（移动 / 扩选命令），在那里它正是避免「原地空走」所需要的。
 */
export function normalizeComposerCaret(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  const block = Math.max(0, Math.min(caret.block, blocks.length));
  const target = blocks[block];
  if (target === undefined || isCardBlock(target)) return { block, offset: 0 };
  const offset = Math.max(0, Math.min(caret.offset, target.text.length));
  if (target.text.length > 0 && offset >= target.text.length) {
    const next = blocks[block + 1];
    if (next === undefined || isCardBlock(next)) return { block: block + 1, offset: 0 };
    return { block, offset: target.text.length };
  }
  return { block, offset };
}

/**
 * 停靠点序列（归一等价类后的商集，线性有序）：段落块 → 各**码点边界**偏移（代理对整体一步，
 * design §4.2；低位代理不构成独立停靠点）；卡片块 → 前缘 `(i, 0)`（后缘用下一块的前缘表达）；
 * 末尾再补「末尾之后」`(块数, 0)`。
 *
 * 两条不变量（M465 起按**写回 DOM 位**判，见 `normalizeComposerCaret` 与合同 HC4 第 1 条）：
 * 序列线性有序且相邻两点的写回位必不相同（一步必有位移）；序列**不丢点**——每个非末块段落的每个
 * 码点边界都有自己的停靠点（后块是段落时 `(i, len)` 不得被折叠吃掉）。
 */
export function composerCaretStops(blocks: readonly ComposerBlock[]): ComposerCaret[] {
  const stops: ComposerCaret[] = [];
  const push = (caret: ComposerCaret): void => {
    const norm = normalizeComposerCaret(blocks, caret);
    const last = stops[stops.length - 1];
    if (last !== undefined && sameCaret(last, norm)) return;
    stops.push(norm);
  };
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (isCardBlock(block)) {
      push({ block: i, offset: 0 });
      continue;
    }
    const text = block.text;
    push({ block: i, offset: 0 });
    let offset = 0;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      offset += code >= 0xd800 && code <= 0xdbff && offset + 1 < text.length ? 2 : 1;
      push({ block: i, offset: Math.min(offset, text.length) });
    }
  }
  push({ block: blocks.length, offset: 0 });
  return stops;
}

/** 在停靠点序列上走一步（`delta` = ±1）；到头 / 找不到时返回归一后的原位（无动作）。
 *  「找不到」是病态输入（DOM 读回落在代理对中间）——归一不改它，此处退化为无动作，不猜。 */
function stepStops(blocks: readonly ComposerBlock[], caret: ComposerCaret, delta: number): ComposerCaret {
  const stops = composerCaretStops(blocks);
  const norm = normalizeComposerCaret(blocks, caret);
  const index = stops.findIndex((stop) => sameCaret(stop, norm));
  if (index < 0) return norm;
  const target = index + delta;
  return target >= 0 && target < stops.length ? stops[target] : norm;
}

/** ⌃F / ⌃B：停靠点序列上前进 / 后退一步（段内字符步进，原子卡片一步跨过）。 */
export function moveCharForward(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  return stepStops(blocks, caret, 1);
}
export function moveCharBackward(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  return stepStops(blocks, caret, -1);
}

/** 段落的逻辑行（`\n` 为界；`end` 不含 `\n`；空段落 = 一个 `[0,0)` 的空行）。 */
interface TextLine {
  readonly start: number;
  readonly end: number;
}
function paragraphLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      lines.push({ start, end: i });
      start = i + 1;
    }
  }
  lines.push({ start, end: text.length });
  return lines;
}
/** offset 所在行的下标（行界归**前**一行：`offset === 行末` 时仍算该行）。 */
function lineIndexOf(lines: readonly TextLine[], offset: number): number {
  let index = 0;
  for (let i = 0; i < lines.length; i += 1) if (lines[i].start <= offset) index = i;
  return index;
}

/**
 * 段内命令的**基准光标**：caret 落在段落内时取**原始位**（它带着真实的列位与「光标视觉上在哪一行」），
 * 否则取归一位。消费者：行级命令 ⌃A / ⌃E / ⌃N / ⌃P（M455 / M457）与词步 ⌥F / ⌥B（M473；词步要的
 * 是「光标在不在段落里」，末段档 / 卡片档被折走后同样会早退成「不动」）。
 *
 * 为什么必须分这一档：`normalizeComposerCaret` 在**卡片档 / 末段档**把段落**末缘**折到下一块
 * 前缘（末段折到「末尾之后」），而这两个落点位**没有行语义**（词步则连「落在段落里」都不成立）
 * ——行级命令随即对着那个块算行，一行
 * 都算不出来 ⇒ ⌃A 表现为「按了没反应」（Alex 2026-10-12 现场，真机探针实测段末 (0,11) 按 ⌃A
 * 选区完全不动）。**M465 起「后块是段落」这一档不再折叠**（合同 HC4 第 1 条：折叠只在后块是无
 * 文本宿主前缘时才成立），但卡片档 / 末段档照旧折——分档因此在这两档上仍然承重。
 * 段落内（含末缘）的原始位还带着**真实列位**，这是 ⌃N / ⌃P 同列位步进要的东西（M455 修：
 * 末缘折走后列位随之丢失，⌃P 落到上一行行首而不是同列位）。
 *
 * M455 为 ⌃N / ⌃P 修过同族问题（当时是本函数的一处内联特判），M457 把 ⌃A / ⌃E 一并收进来，
 * M473 再把词步收进来——段内基准**只有这一处实现**（REVIEW.md 「同一语义两处真源」条）。
 *
 * 卡片边界位 / 越界位没有段内语义，仍走归一位（回落到各自的「无动作」判据）。
 */
function lineBasisCaret(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  const raw = blocks[caret.block];
  if (raw !== undefined && raw.kind === "paragraph") {
    return { block: caret.block, offset: Math.max(0, Math.min(caret.offset, raw.text.length)) };
  }
  return normalizeComposerCaret(blocks, caret);
}

/** ⌃A：段落内逻辑行行首；已是 / 光标在卡片边界位时不动。 */
export function moveLineStart(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  const basis = lineBasisCaret(blocks, caret);
  const block = blocks[basis.block];
  if (block === undefined || block.kind !== "paragraph") return basis;
  const lines = paragraphLines(block.text);
  return normalizeComposerCaret(blocks, { block: basis.block, offset: lines[lineIndexOf(lines, basis.offset)].start });
}

/** ⌃E：段落内逻辑行行尾；已是 / 光标在卡片边界位时不动。 */
export function moveLineEnd(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  const basis = lineBasisCaret(blocks, caret);
  const block = blocks[basis.block];
  if (block === undefined || block.kind !== "paragraph") return basis;
  const lines = paragraphLines(block.text);
  return normalizeComposerCaret(blocks, { block: basis.block, offset: lines[lineIndexOf(lines, basis.offset)].end });
}

/** 相邻段落块（delta > 0 向后找、< 0 向前找）；卡片不产生停靠行，被整体跳过。 */
function adjacentParagraph(
  blocks: readonly ComposerBlock[],
  fromBlock: number,
  delta: number,
): { index: number; text: string } | null {
  if (delta > 0) {
    for (let i = fromBlock + 1; i < blocks.length; i += 1) {
      const b = blocks[i];
      if (b.kind === "paragraph") return { index: i, text: b.text };
    }
    return null;
  }
  for (let i = Math.min(fromBlock, blocks.length) - 1; i >= 0; i -= 1) {
    const b = blocks[i];
    if (b.kind === "paragraph") return { index: i, text: b.text };
  }
  return null;
}

/** ⌃N / ⌃P：逻辑行之间移动（同列位，超出目标行长度取行尾）；出段落跨到相邻段落块，无则不动。
 *
 *  基准光标取 `lineBasisCaret`（段落内取原始位、否则取归一位）：段落**末缘**（`offset === 文本
 *  长度`，即光标停在该段最后一行行尾——键入后的常态位置）的原始光标带着真实的列位；而归一在
 *  **卡片档 / 末段档**会把它折到下一块前缘（末段折到「末尾之后」），列位随之丢失。M455 修：
 *  末缘保留原始光标走段内步进，⌃P/⌃N 因此落到相邻行
 *  的**同列位**而不是行首（实测缺陷形态：`yabzcdw` ⇧Enter `mn` 后按 ⌃P 落在第二段行首，应为第一
 *  段第 2 列）。M457 起这一档与 ⌃A / ⌃E 共用同一个 `lineBasisCaret`；M465 起「后块是段落」档不再
 *  折叠，但基准分档对卡片档 / 末段档仍然承重（列位与「光标在不在段落里」两件事都靠它）。 */
function moveLineVertical(blocks: readonly ComposerBlock[], caret: ComposerCaret, delta: number): ComposerCaret {
  const norm = lineBasisCaret(blocks, caret);
  const block = blocks[norm.block];
  if (block !== undefined && block.kind === "paragraph") {
    const lines = paragraphLines(block.text);
    const index = lineIndexOf(lines, norm.offset);
    const column = norm.offset - lines[index].start;
    const target = index + delta;
    if (target >= 0 && target < lines.length) {
      const line = lines[target];
      return normalizeComposerCaret(blocks, {
        block: norm.block,
        offset: line.start + Math.min(column, line.end - line.start),
      });
    }
    const neighbor = adjacentParagraph(blocks, norm.block, delta);
    if (neighbor === null) return norm;
    const nLines = paragraphLines(neighbor.text);
    const line = delta > 0 ? nLines[0] : nLines[nLines.length - 1];
    return normalizeComposerCaret(blocks, {
      block: neighbor.index,
      offset: line.start + Math.min(column, line.end - line.start),
    });
  }
  // 卡片前缘 / 「末尾之后」：卡片不产生停靠行 ⇒ 直接跳到相邻段落的行首。
  const neighbor = adjacentParagraph(blocks, norm.block, delta);
  if (neighbor === null) return norm;
  const nLines = paragraphLines(neighbor.text);
  const line = delta > 0 ? nLines[0] : nLines[nLines.length - 1];
  return normalizeComposerCaret(blocks, { block: neighbor.index, offset: line.start });
}

export function moveLineDown(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  return moveLineVertical(blocks, caret, 1);
}
export function moveLineUp(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  return moveLineVertical(blocks, caret, -1);
}

/**
 * ⌃N / ⌃P 的**渲染行**一步是否真的跨了一行（M457，Alex 2026-10-12 裁决「按视觉行、与编辑器正文
 * 对齐」）。
 *
 * 判据：目标位置的行盒上沿相对光标行盒**至少错开半行高**——同一条渲染行上的解算结果（引擎把点
 * 钳回原行、或 x 位那侧没有字符而落到同一行的别处）一律判「没跨」，调用方据此回落到既有的跨段落
 * 行为（超集：段内有相邻渲染行才走渲染行）。行盒以 `Range.getBoundingClientRect()` 为准
 * （`top` 是行盒上沿、`height` 是行高）；量不到行盒（零高：卡片边界位 / 空段落）返回 false。
 */
export function visualLineStepCrossed(
  from: { readonly top: number; readonly height: number },
  to: { readonly top: number; readonly height: number } | null,
  delta: number,
): boolean {
  if (to === null) return false;
  const lineHeight = Math.max(from.height, to.height);
  if (!(lineHeight > 0)) return false;
  const step = to.top - from.top;
  return delta < 0 ? step <= -lineHeight / 2 : step >= lineHeight / 2;
}

/** 按词一步（⌥F / ⌥B 的扩选 head 走它）：段落内用与编辑器侧共用的词边界扫描。
 *
 *  **基准光标的档位与行级命令同一份**（M473）：`lineBasisCaret`——caret 所在块是段落就取**原始位**
 *  （段末紧邻卡片 / 末段这两种档位不再折到卡片前缘 / 「末尾之后」），否则取归一位。旧实现第一步过
 *  `normalizeComposerCaret`，那两档被折成**无文本宿主**的落点（卡片块 / 越界位）⇒ `block.kind !==
 *  "paragraph"` 早退 ⇒ 两个方向都「不动」——同一现场下 ⌥B 在段落档回词首、在卡片档不动的不对称
 *  （登记 `docs/backlog.md` 的 worker-m465 r1 finding）；取原始位后两档一致（⌥B 回本段词首、⌥F
 *  无动作），末段档（归一成「末尾之后」）同样随之对齐。
 *
 *  **段-段边界不跨段**（M465 裁决，理由与口径见 docs/specs/harness-composer.md §实测依据 M465 节）：
 *  段末 ⌥F **无动作**（本段已无下一词）、段末 ⌥B **回本段词首**、段首 ⌥B 无动作（停在本段段首）——
 *  与词级 kill 的「段边界处无动作」同口径。落点仍过 `normalizeComposerCaret`（段末 ⌥F 到末段词尾
 *  时写回的是「末尾之后」这一等价表示——M447 口径不变）。 */
export function moveWordForward(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  const basis = lineBasisCaret(blocks, caret);
  const block = blocks[basis.block];
  if (block === undefined || block.kind !== "paragraph") return basis;
  const end = wordEndForward((a, b) => block.text.slice(a, b), basis.offset, block.text.length);
  if (end <= basis.offset) return basis;
  return normalizeComposerCaret(blocks, { block: basis.block, offset: end });
}
export function moveWordBackward(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerCaret {
  const basis = lineBasisCaret(blocks, caret);
  const block = blocks[basis.block];
  if (block === undefined || block.kind !== "paragraph") return basis;
  const start = wordStartBackward((a, b) => block.text.slice(a, b), basis.offset, 0);
  if (start >= basis.offset) return basis;
  return normalizeComposerCaret(blocks, { block: basis.block, offset: start });
}

/** 编辑动词用的文本目标：段落块 + 段内钳制偏移（`block` 越界时钳到末块、按段末处理）。 */
function textTargetAt(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
): { index: number; text: string; offset: number } | null {
  const index = Math.max(0, Math.min(caret.block, blocks.length - 1));
  const block = blocks[index];
  if (block === undefined || block.kind !== "paragraph") return null;
  const offset = caret.block >= blocks.length ? block.text.length : Math.max(0, Math.min(caret.offset, block.text.length));
  return { index, text: block.text, offset };
}

/** 一次 kill 的产物：新块序列 + 落点 + 被杀文本 + 被杀区间的两端（供 kill 槽的相接判定）。 */
export interface ComposerKill {
  blocks: ComposerBlock[];
  caret: ComposerCaret;
  killed: string;
  from: ComposerCaret;
  to: ComposerCaret;
}

function removeTextAt(
  blocks: readonly ComposerBlock[],
  index: number,
  text: string,
  from: number,
  to: number,
  caretOffset: number,
): ComposerKill {
  const next = blocks.slice() as ComposerBlock[];
  next[index] = { kind: "paragraph", text: text.slice(0, from) + text.slice(to) };
  return {
    blocks: next,
    caret: { block: index, offset: caretOffset },
    killed: text.slice(from, to),
    from: { block: index, offset: from },
    to: { block: index, offset: to },
  };
}

/** ⌥D：kill 到下一词尾（不跨块——到段边界即停，段边界处无动作）。 */
export function killWordForward(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerKill | null {
  const target = textTargetAt(blocks, caret);
  if (target === null) return null;
  const end = Math.min(wordEndForward((a, b) => target.text.slice(a, b), target.offset, target.text.length), target.text.length);
  if (end <= target.offset) return null;
  return removeTextAt(blocks, target.index, target.text, target.offset, end, target.offset);
}

/** ⌥⌫：kill 到上一词首（不跨块）。 */
export function killWordBackward(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerKill | null {
  const target = textTargetAt(blocks, caret);
  if (target === null) return null;
  const start = Math.max(wordStartBackward((a, b) => target.text.slice(a, b), target.offset, 0), 0);
  if (start >= target.offset) return null;
  return removeTextAt(blocks, target.index, target.text, start, target.offset, start);
}

/** ⌃K：kill 到当前逻辑行行尾；已在行尾则杀掉该行界（段内合并两行）；段落末行行尾无动作（不跨块）。 */
export function killLineAtCaret(blocks: readonly ComposerBlock[], caret: ComposerCaret): ComposerKill | null {
  const target = textTargetAt(blocks, caret);
  if (target === null) return null;
  const newline = target.text.indexOf("\n", target.offset);
  let end: number;
  if (newline === target.offset) end = target.offset + 1;
  else if (newline > target.offset) end = newline;
  else if (target.offset < target.text.length) end = target.text.length;
  else return null;
  return removeTextAt(blocks, target.index, target.text, target.offset, end, target.offset);
}

/** ⌃T：转置光标左右两个字素簇并把光标移到两者之后（与 `src/editor.ts` 的 `transposeChars`
 *  逐条同语义——段首 / 卡片边界处无动作；段尾与编辑器侧同形，转置末两个簇）。 */
export function transposeCharsAtCaret(
  blocks: readonly ComposerBlock[],
  caret: ComposerCaret,
): { blocks: ComposerBlock[]; caret: ComposerCaret } | null {
  const target = textTargetAt(blocks, caret);
  if (target === null) return null;
  const { index, text, offset: pos } = target;
  const read = (a: number, b: number): string => text.slice(a, b);
  const write = (newText: string, caretOffset: number): { blocks: ComposerBlock[]; caret: ComposerCaret } => {
    const next = blocks.slice() as ComposerBlock[];
    next[index] = { kind: "paragraph", text: newText };
    return { blocks: next, caret: { block: index, offset: caretOffset } };
  };
  const left = clusterBackward(read, pos, 0);
  const right = clusterForward(read, pos, text.length);
  if (left < pos && right > pos) {
    const a = text.slice(left, pos);
    const b = text.slice(pos, right);
    return write(text.slice(0, left) + b + a + text.slice(right), right);
  }
  const prev = clusterBackward(read, left, 0);
  if (prev >= left) return null;
  const a = text.slice(prev, left);
  const b = text.slice(left, pos);
  return write(text.slice(0, prev) + b + a + text.slice(pos), pos);
}

/** 结构性操作 ⇒ 撤销栈强制独立成步（`withModel` / `undoHistory.push` 的 force 跳过聚簇）。
 *
 * **composer 模型路径上 force=true 的唯一产出点**——结构性操作全部读它：卡片（引用 / 消息摘录 /
 * 图片）的插入与移除、粘贴（文本 / 图片 / 拖入）、`@` 提及插入、拆段（`⇧Enter` 软断行）、删除族
 * （⌃D / ⌃H、裸 Backspace / Delete、两族的选区档）、kill-yank 族（⌥D / ⌥⌫ / ⌃K、⌃Y）、边界光标位
 * 的物化键入、IME 组合物化。MUST NOT 再散落 `true` 字面量（M510 的三处现场：M447/M453 的删除族、
 * M343 起的 ⇧Enter 各自写字面量且写成 false，与 `withModel` 文档「force=true 用于结构性操作
 * （卡片插入/移除、粘贴、**拆段**、退格）」漂移而无人可对账）。条款见
 * openspec/specs/harness/spec.md「混排输入区的撤销栈聚簇与结构操作独立成步」。
 *
 * 判据：一次编辑改的是**结构**（卡片的存在与位置、段落的分合）而非打字流；结构步若与相邻键入
 * 共用一个撤销前态，就会被聚簇早退吞掉、⌘Z 弹回结构操作前的状态。**三处 `false` 豁免**（不读本
 * 常量，就地注释点名）：键入（原生文本编辑的压栈）、字符级编辑（⌃T 转置）、删除族的空转空模型写。
 */
export const STRUCTURAL_EDIT_FORCE = true;

/** 一步模型编辑的模型步：交给 `withModel` 的模型操作 + force。 */
export interface ComposerEditStep {
  readonly op: (current: readonly ComposerBlock[]) => { blocks: ComposerBlock[]; caret: ComposerCaret };
  readonly force: boolean;
}

/** 选区删除的模型步（删除族与 kill 族的**选区档**共用）：把当前选区整段删掉。
 *
 * force = `STRUCTURAL_EDIT_FORCE`——删除是结构性操作（选区可跨卡片整块移除），SHALL 独立成一个
 * 撤销步；与 `deleteFamilyStep` 的就地档同款判词（贴图等结构操作后 1s 内的选区删除若被聚簇早退
 * 吞掉，⌘Z 会弹回结构操作前的空态）。返回 null = 无选区或选区折叠（没有要删的选区）。
 */
export function selectionDeleteStep(sel: ComposerSelection | null): ComposerEditStep | null {
  if (sel === null || sameCaret(sel.anchor, sel.focus)) return null;
  return { op: (current) => deleteSelectionRange(current, sel), force: STRUCTURAL_EDIT_FORCE };
}

/** 删除族（⌃D / ⌃H 与裸 Backspace / Delete）的模型步：交给 `withModel` 的模型操作 + force。
 *
 * force = `STRUCTURAL_EDIT_FORCE`——删除是结构性操作（卡片按整体作用、可整块移除）。三个入口
 * （`runComposerCommand` 的 `deleteAtCaret` 两档、composer 的裸 Backspace/Delete 分支）共用本
 * 函数——force 的判定因此只有一处真源，MUST NOT 各写一份字面量（M447/M453 曾把这三处各自落成
 * false）。选区档与 kill 族的选区档再共用一个 `selectionDeleteStep`。
 *
 * 返回 null = 本拍无模型动作（无选区，或就地删除的空转：段首退格 / 前向删除到末缘）。
 */
export function deleteFamilyStep(
  blocks: readonly ComposerBlock[],
  sel: ComposerSelection | null,
  op: (blocks: readonly ComposerBlock[], caret: ComposerCaret) => { blocks: ComposerBlock[]; caret: ComposerCaret } | null,
): ComposerEditStep | null {
  if (sel === null) return null;
  const selection = selectionDeleteStep(sel);
  if (selection !== null) return selection;
  if (op(blocks, sel.focus) === null) return null;
  return {
    op: (current) => op(current, sel.focus) ?? { blocks: [...current], caret: sel.focus },
    force: STRUCTURAL_EDIT_FORCE,
  };
}

/** 拆段（`⇧Enter` 软断行）的模型步：结构性操作，force = `STRUCTURAL_EDIT_FORCE`（`withModel` 的
 *  M343 文档自始即把「拆段」列为 force=true；composer keydown 的 `⇧Enter` 分支原写字面量 false
 *  是漂移，M510 修准）。
 *
 * `readCaret` 是**延迟读取**：落点必须在 `withModel` 的 `normalize()` 之后从 DOM 取（与改动前
 * 的取值时机逐拍一致），故以 thunk 传入而不是先算好再传。取不到选区时落末块末尾之后（同原口径）。
 */
export function softBreakStep(readCaret: () => ComposerCaret | null): ComposerEditStep {
  return {
    op: (blocks) => insertSoftBreakAtCaret(blocks, readCaret() ?? { block: blocks.length - 1, offset: 0 }),
    force: STRUCTURAL_EDIT_FORCE,
  };
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

/** 重建保焦的「段」：权限档、provider、model、effort（change fix-escape-overlay-close-oct24
 *  design §3.3 / 裁决 D3）。 */
export type RebuildSegment = "perm" | "provider" | "model" | "effort";

/** 重建后的一项（纯值）：段名、该项 id、是否为该段的当前项。 */
export interface RebuildItem {
  seg: RebuildSegment;
  id: string;
  current: boolean;
}

/** 语义键：段 + 该项 id。 */
export interface RebuildKey {
  seg: RebuildSegment;
  id: string;
}

/**
 * 重建后应当落焦的那一项（纯逻辑，单测直接断言；DOM 映射在 `focusRebuiltItem`）：
 *
 * 1. 先按「段 + 该项 id」精确找——成功路径上 id 已写进状态，找到的就是**新选中**的那一项；
 * 2. 找不到（切 provider 后 model 段换了内容、或该 id 已不存在）时落回**该段的当前项**
 *    （`aria-checked` / `is-current` 的同一读数）；
 * 3. 整段都不在（没有这个段）时返回 `null`——调用方回落触发钮。
 *
 * 键 MUST 由**重建时的当前状态**产出（`permMode` / `selSelection.provider` /
 * `models[provider].current` / `thinkLevel`），MUST NOT 用点击目标：写回失败回滚后的重建要落回
 * 回滚项，用点击目标会把焦点留在失败的新项上——正是本 change 要修的那种形态。
 */
export function pickRebuildFocus<T extends RebuildItem>(items: readonly T[], key: RebuildKey): T | null {
  const exact = items.find((item) => item.seg === key.seg && item.id === key.id);
  if (exact !== undefined) return exact;
  return items.find((item) => item.seg === key.seg && item.current) ?? null;
}

// ── 序列化消息的解析（transcript 快照恢复用） ──────────────────────────────

/** XML 实体单次左到右消解（&amp; 先不解，避免把 &amp;lt; 解成 <——那是用户原文 "&lt;"）。
 *  String.replace 的函数形式对每次匹配只消费一次，链式转义（&amp;amp;）因此正确收敛。 */
export function unescapeXmlEntities(value: string): string {
  const table: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };
  return value.replace(/&(amp|lt|gt|quot);/g, (_match, entity: string) => table[entity] ?? _match);
}

/** 错误信封的 code 取值（与 src/copy.ts 的 isErrorEnvelope 同口径）——发送闸
 *  （harness_image_unsupported）的界面分派判据；非信封返回空串。 */
export function errorCodeOf(e: unknown): string {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
    ? (e as { code: string }).code
    : "";
}

const QUOTE_OPEN_RE = /^<quote file="([^"]*)" heading="([^"]*)" lines="([^"]*)">/;
// 消息摘录元素（change harness-message-excerpt）：role 必选、at 可缺（role-only 出处）。
const MSG_QUOTE_OPEN_RE = /^<msg-quote role="([^"]*)"(?: at="([^"]*)")?>/;
// 图片占位元素（change harness-composer-image-paste design §4.2）：自闭合单行，
// 属性恒在序 ref / type / width / height（尺寸从 wire 引用恢复时后两个缺席）。
const IMAGE_RE =
  /^<image ref="([^"]*)" type="([^"]*)"(?: width="([0-9]+)" height="([0-9]+)")?\/>/;

/**
 * 把序列化消息（serializeQuoteMessage 的产物，design §3–§4）解析回块序列——快照恢复
 * （webview 重载 / 切 vault 回填）时 transcript 同构呈现用。格式的可解析性由序列化侧
 * 的不变量保证：属性值与文本节点转义 ⇒ 输出里的裸 `<quote `/`<msg-quote ` 行首与闭合标签
 * 只可能是真标签；连续非元素行合并为一个段落（软换行段落与多段落序列化同形，视觉等价）。
 * 解析宽容：不成形的行（含 role 非法 / 缺 role 的 `<msg-quote>`）按段落落地，**内容守恒、
 * 不抛错**——不识别即不还原，但 MUST NOT 静默丢文。
 *
 * 图片占位元素（`<image ref="…" type="…"/>`，自闭合单行）还原为 `{kind:"image"}` 块
 * （change harness-composer-image-paste §7）；它同时是段落分隔符（占位元素前后各自成段）。
 */
export function parseQuoteMessage(text: string): ComposerBlock[] {
  const blocks: ComposerBlock[] = [];
  const lines = text.split("\n");
  const isElementStart = (line: string): boolean =>
    QUOTE_OPEN_RE.test(line) || MSG_QUOTE_OPEN_RE.test(line) || IMAGE_RE.test(line);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const image = IMAGE_RE.exec(line);
    if (image !== null && line === image[0]) {
      // 整行恰是占位元素（自闭合）：还原图片块。属性值转义还原；尺寸缺席 = 从 wire
      // 引用恢复的旧形态，卡片只显文件名（ImageCard.width/height 可选）。
      const width = image[3] === undefined ? undefined : Number(image[3]);
      const height = image[4] === undefined ? undefined : Number(image[4]);
      blocks.push({
        kind: "image",
        card: {
          name: unescapeXmlEntities(image[1]),
          sourceMime: unescapeXmlEntities(image[2]),
          width,
          height,
        },
      });
      i += 1;
      continue;
    }
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
    const msg = MSG_QUOTE_OPEN_RE.exec(line);
    // role 合法才还原为卡片；role 非法 / 缺失落下面的段落分支（内容守恒，不静默丢文）。
    if (msg !== null && (msg[1] === "user" || msg[1] === "assistant")) {
      const start = i;
      let body = line.slice(msg[0].length);
      let end = body.indexOf("</msg-quote>");
      while (end === -1 && i + 1 < lines.length) {
        i += 1;
        body += `\n${lines[i]}`;
        end = body.indexOf("</msg-quote>");
      }
      if (end === -1) {
        blocks.push({ kind: "paragraph", text: lines.slice(start, i + 1).join("\n") });
        i += 1;
        continue;
      }
      const excerpt = body.slice(0, end);
      const atAttr = msg[2];
      blocks.push({
        kind: "msgquote",
        card: {
          role: msg[1],
          at: atAttr === undefined ? null : parseMessageAt(unescapeXmlEntities(atAttr)),
          text: unescapeXmlEntities(excerpt),
        },
      });
      i += 1;
      continue;
    }
    const paragraphLines = [line];
    i += 1;
    while (i < lines.length && isElementStart(lines[i]) === false) {
      paragraphLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
  }
  return blocks;
}

// ── 图片卡片元信息行（design §3；M449 补恢复路径）────────────────────────────
/** 图片卡片元信息行文案：**从文件名开始、无 `image ·` 类型前缀**（Alex 2026-10-10 裁决）；
 *  有尺寸显「文件名 · W×H」，无尺寸（快照从 wire 引用恢复的旧卡片，M440 可选字段）只显文件名。
 *  渲染首帧与缩略图 load 后的补记共用这一份（单一来源，REVIEW.md 「同一语义两处真源」条）。 */
export function imageCardMetaText(
  name: string,
  width: number | undefined,
  height: number | undefined,
): string {
  return width !== undefined && height !== undefined ? `${name} · ${width}×${height}` : name;
}

/** 缩略图 `<img>` load 后补记宽高的口径（M449）：naturalWidth/naturalHeight 是**有限正
 *  整数**才作数——加载失败（natural 全 0）与未就绪（NaN / 非有限 / 非正）一律 null，调用方
 *  据此保持元信息行只显文件名，绝不把 0 / NaN / undefined 写进文案。 */
export function imageDimensionsFromNatural(
  naturalWidth: number,
  naturalHeight: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return null;
  if (naturalWidth <= 0 || naturalHeight <= 0) return null;
  return { width: naturalWidth, height: naturalHeight };
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

// ── 权限模式的纯模型层（M414，change add-harness-permission-modes design §7）──────────
// 与合并选择器同一条分层纪律：档位映射与读数抽取是纯函数（零 DOM，tests/unit 直接驱动），
// DOM 只是渲染面。三档的**判定语义**在 Rust 侧（src-tauri/src/harness/permissions.rs），
// 前端只管「读当前档 / 显示 / 写回」，不复制任何判定。

/** 权限模式三档闭集合（与 src/bindings/PermissionMode.ts 的同值域——ts-rs 生成的是编译期
 *  别名，运行期判定要一份可遍历的表；取值校验在 Rust 侧完成）。 */
export const PERMISSION_MODES = ["read_only", "vault_write", "full_access"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

/**
 * 权限 chip 的读数（`config.harness` 的宽容提取）：闭集合外取值 / 缺键 / 坏形状一律回落
 * **默认档 `vault_write`**——后端 validate 对非法值的处置就是「回落默认 + 人话 warning」，
 * 界面读的是**生效档**而不是配置文件里那一行，回落与后端同一处语义（不显示「未知」：
 * 生效档在任何配置下都确定）。
 *
 * 与模型 chip 的分工：那里「读不到就不显示」（model 名没有缺省可言）；这里档位有明确
 * 缺省，故 chip 的隐藏判据不落本函数，而由调用方按「harness 段是否在场」决定。
 */
export function harnessPermissionMode(harness: unknown): PermissionMode {
  if (typeof harness !== "object" || harness === null) return "vault_write";
  const value = (harness as { permission_mode?: unknown }).permission_mode;
  return PERMISSION_MODES.find((mode) => mode === value) ?? "vault_write";
}

/** chip 上的短名（D423–D425；Alex 2026-10-09 裁决：控制行空间紧，chip 只放短名）。 */
export function permissionShortName(mode: PermissionMode): string {
  return t(mode === "read_only" ? "D423" : mode === "vault_write" ? "D424" : "D425");
}

/** `[harness].permissions.allow` 的宽容提取（change harness-permission-rules-oct23）：非字符串 /
 *  空串逐项丢弃（与后端 `validate_harness_rules` 同口径），缺表 / 错形状按空列表——浮层据此
 *  决定「已记住的规则」段渲不渲染。规则的匹配语义不在这里判定（后端单一真源）。 */
export function harnessPermissionRules(harness: unknown): string[] {
  if (typeof harness !== "object" || harness === null) return [];
  const permissions = (harness as { permissions?: unknown }).permissions;
  if (typeof permissions !== "object" || permissions === null) return [];
  const allow = (permissions as { allow?: unknown }).allow;
  if (!Array.isArray(allow)) return [];
  return allow
    .filter((rule): rule is string => typeof rule === "string")
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "");
}

/** 批准卡两枚次级动作的**纯模型层**（change harness-permission-rules-oct23 design §5）：
 *  把事件 / 快照 / 子运行载荷解析成「要渲染哪几枚按钮」。
 *
 *  字段是渲染的唯一开关：缺键 / null / 非字符串一律 `undefined`（不渲染）——**M413 的「缺键按
 *  可见处理」契约已按 D3 裁决翻转**，否则危险黑名单卡经快照恢复会复活两枚死按钮。
 *  前端 MUST NOT 按 `reason.kind` 自行推断（层级判断在 Rust 判定管线）。
 *
 *  单一实现：事件入口、父会话待决快照、子运行快照三处归一化都调它（REVIEW.md「同一语义两处
 *  真源」条——三处各写一遍 `typeof … === "string"` 必然漂移一处）。线格式是 snake_case
 *  （`persist_rule`），内部形状是 camelCase（`persistRule`）。 */
export function approvalActionsFromPayload(raw: {
  remember?: unknown;
  persist_rule?: unknown;
}): { remember?: string; persistRule?: string } {
  return {
    remember: typeof raw.remember === "string" ? raw.remember : undefined,
    persistRule: typeof raw.persist_rule === "string" ? raw.persist_rule : undefined,
  };
}

/** 构建侧的同一条判据（`approvalActionsFromPayload` 的输出原样进门）：两枚都没有 ⇒ 整行不建。 */
export function approvalSecondaryActions(actions: {
  remember?: string | undefined;
  persistRule?: string | undefined;
}): { remember?: string; persistRule?: string } {
  return {
    remember: typeof actions.remember === "string" ? actions.remember : undefined,
    persistRule:
      typeof actions.persistRule === "string" ? actions.persistRule : undefined,
  };
}

/** 会话记忆按钮文案：有粒度 ⇒ D565（授权面在按下前可见）；粒度为空串 ⇒ D434 回退
 *  （D434 保留的唯一用途；理论上前端不会收到空粒度——后端生成器不产空串）。 */
export function approvalRememberText(label: string): string {
  return label.trim() === "" ? t("D434") : t("D565", { prefix: label });
}

/** 浮层里的全名（D427–D429）——同时是 chip 读屏名（D426）的 {mode} 取值。 */
export function permissionFullName(mode: PermissionMode): string {
  return t(mode === "read_only" ? "D427" : mode === "vault_write" ? "D428" : "D429");
}

/** 浮层里的每档一行释义（D430–D432）。M459 起也是 chip 悬停提示（D426）与批准卡判定依据行
 *  （D458）的 `{desc}` 取值——同一档的承诺只写一份（REVIEW.md 「同一语义两处真源」条）。 */
export function permissionDescription(mode: PermissionMode): string {
  return t(mode === "read_only" ? "D430" : mode === "vault_write" ? "D431" : "D432");
}

/** 判定依据的宽容解析（M459，事件与快照两条入口同一份判据）：只认三个**可上卡**的 kind
 *  （Rust `DecisionReason` 的 `deny_rule` 不产批准卡、不会到前端，故不认）；形状不合一律
 *  `undefined`——调用方据此不出该行，MUST NOT 伪造依据（旧载荷 / 未来新增 kind 的降级面）。 */
export function parseDecisionReason(value: unknown): DecisionReason | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as { kind?: unknown; command?: unknown; mode?: unknown };
  switch (raw.kind) {
    case "dangerous_wrapper":
      return typeof raw.command === "string" && raw.command !== ""
        ? { kind: "dangerous_wrapper", command: raw.command }
        : undefined;
    case "dangerous_command":
      return { kind: "dangerous_command" };
    case "mode_default":
      return PERMISSION_MODES.find((mode) => mode === raw.mode) !== undefined
        ? { kind: "mode_default", mode: raw.mode as PermissionMode }
        : undefined;
    default:
      return undefined;
  }
}

/** 判定依据行的文案（M459，change add-approval-decision-reason design §4.1）：层级由 Rust 判定
 *  管线产出、前端只做「kind → 模板」映射（MUST NOT 自行推导层级）。`{mode}` / `{desc}` 取
 *  D427–D429 / D430–D432 的读数（与浮层、chip 悬停提示同源）。无依据（`undefined` / 不可上卡的
 *  kind）返回 `null`——调用方不出该行。 */
export function approvalReasonText(reason: DecisionReason | undefined): string | null {
  if (reason === undefined) return null;
  switch (reason.kind) {
    case "dangerous_wrapper":
      return t("D459", { command: reason.command });
    case "dangerous_command":
      return t("D460");
    case "mode_default":
      return t("D458", {
        mode: permissionFullName(reason.mode),
        desc: permissionDescription(reason.mode),
      });
    default:
      return null;
  }
}

/** 定时任务批准预览（change add-cron-conversational-registration design §6.3 契约）：形状由
 *  Rust 侧批准载荷给出（事件与快照同源同形），前端只呈现、不推导——`skip_today` 是线程按
 *  自己的时钟算好的结果，MUST NOT 在前端重算。`op = "remove"` 时只有 `id` 与 `at`
 *  （任务可能已不存在 ⇒ `at` 缺席）。 */
export interface CronTaskPreview {
  op: "create" | "remove";
  id: string;
  at?: string | undefined;
  days?: string[] | undefined;
  delivery?: string | undefined;
  session?: string | undefined;
  vault?: string | undefined;
  prompt?: string | undefined;
  skip_today?: boolean | undefined;
}

/** 定时任务预览的宽容解析（事件 / 快照两条入口同一份）：形状不合 / 未知 op ⇒ `undefined`
 *  （调用方不建块，MUST NOT 伪造）；缺键按缺席处理，空值由渲染层跳过该行。 */
export function parseCronTaskPreview(value: unknown): CronTaskPreview | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const op = raw.op === "create" ? "create" : raw.op === "remove" ? "remove" : undefined;
  if (op === undefined) return undefined;
  return {
    op,
    id: typeof raw.id === "string" ? raw.id : "",
    at: typeof raw.at === "string" ? raw.at : undefined,
    days: Array.isArray(raw.days)
      ? raw.days.filter((day): day is string => typeof day === "string")
      : undefined,
    delivery: typeof raw.delivery === "string" ? raw.delivery : undefined,
    session: typeof raw.session === "string" ? raw.session : undefined,
    vault: typeof raw.vault === "string" ? raw.vault : undefined,
    prompt: typeof raw.prompt === "string" ? raw.prompt : undefined,
    skip_today: typeof raw.skip_today === "boolean" ? raw.skip_today : undefined,
  };
}

/** 任务要素的档位词（design §6.3：键名走文案表，取值按闭集合译成同一张表里的措辞；
 *  闭集合外的值原样上屏——不猜、不吞掉模型给的东西）。 */
const CRON_DELIVERY_COPY: Record<string, CopyKey> = {
  "notify-then-run": "D529",
  "run-then-notify": "D530",
  "silent-run": "D531",
};
const CRON_SESSION_COPY: Record<string, CopyKey> = { new: "D532", dedicated: "D533" };
const CRON_DAY_COPY: Record<string, CopyKey> = {
  mon: "D537",
  tue: "D538",
  wed: "D539",
  thu: "D540",
  fri: "D541",
  sat: "D542",
  sun: "D543",
};

function cronValueLabel(copy: Record<string, CopyKey>, value: string): string {
  const key = copy[value];
  return key === undefined ? value : t(key);
}

function cronDaysLabel(days: readonly string[]): string {
  return days.map((day) => cronValueLabel(CRON_DAY_COPY, day)).join(" / ");
}

/** 定时任务批准块（design §6.3）：两列键值 + prompt 全文 + 注册日口径。纯呈现——取值只来自
 *  批准载荷；空值不建行（不伪造）。随语言重绘由 `relabelApproval` 重跑本函数（元素不重建）。 */
function renderCronTaskBlock(el: HTMLElement, preview: CronTaskPreview): void {
  const nodes: Node[] = [];
  const kv = document.createElement("dl");
  kv.className = "lumir-hp-cron-kv";
  const addRow = (label: CopyKey, value: string | undefined): void => {
    if (value === undefined || value === "") return;
    const dt = document.createElement("dt");
    dt.textContent = t(label);
    const dd = document.createElement("dd");
    dd.textContent = value;
    kv.append(dt, dd);
  };
  if (preview.op === "create") {
    addRow("D523", preview.at);
    addRow("D524", preview.days === undefined ? undefined : cronDaysLabel(preview.days));
    addRow(
      "D525",
      preview.delivery === undefined
        ? undefined
        : cronValueLabel(CRON_DELIVERY_COPY, preview.delivery),
    );
    addRow(
      "D526",
      preview.session === undefined
        ? undefined
        : cronValueLabel(CRON_SESSION_COPY, preview.session),
    );
    addRow("D527", preview.vault);
  } else {
    addRow("D528", preview.id);
    addRow("D523", preview.at);
  }
  if (kv.childElementCount > 0) nodes.push(kv);
  if (preview.op === "create" && preview.prompt !== undefined && preview.prompt !== "") {
    const pre = document.createElement("pre");
    pre.className = "lumir-hp-argv lumir-hp-cron-prompt";
    pre.textContent = preview.prompt;
    nodes.push(pre);
  }
  // 注册日口径（design §8）：true / false 才有话可说，缺键（旧载荷）不伪造。
  const noteKey =
    preview.op === "remove"
      ? "D536"
      : preview.skip_today === true
        ? "D534"
        : preview.skip_today === false
          ? "D535"
          : null;
  if (noteKey !== null) {
    const note = document.createElement("div");
    note.className = "lumir-hp-cron-note";
    note.textContent = t(noteKey);
    nodes.push(note);
  }
  el.replaceChildren(...nodes);
}

/** 命令拆段时的连接符（长者在前：`&&` 必须先于 `&`、`||` 先于 `|` 命中）。 */
const COMMAND_CONNECTORS = ["&&", "||", "\r\n", "|", ";", "&", "\n"] as const;

function commandConnectorAt(text: string, index: number): string | null {
  for (const connector of COMMAND_CONNECTORS) {
    if (text.startsWith(connector, index)) return connector;
  }
  return null;
}

/**
 * 组合命令的呈现拆段（design §3.4 / §8：Alex「是否有可能在询问我的时候也把命令做排版上的
 * 格式化，让人工检查轻松一些」——`cmd1; cmd2 && cmd3`、管道、解释器 eval 是人工检查最费力
 * 的形态）。按连接符切行：**第一行不带连接符，其后每行以连接符起首**。
 *
 * 不变量：`segments.join("") === text`（逐字符无增减、无重排——拆段只是把同一串换行排版，
 * 批准人看到的仍是命令原文，这一条是「呈现层不改内容」的判据，单测钉死）。引号内的连接符
 * 同样拆：模型把复合命令塞进 `bash -c "…"` 单个参数正是最需要拆的一类。
 *
 * **纯呈现层，不参与判定**：分类 / 重定向 / 黑名单只看 argv（Rust 侧），本函数只在批准卡里
 * 决定怎么换行。
 */
export function splitCommandSegments(text: string): string[] {
  const segments: string[] = [];
  let current = "";
  let index = 0;
  while (index < text.length) {
    const connector = commandConnectorAt(text, index);
    if (connector !== null) {
      segments.push(current);
      current = connector;
      index += connector.length;
      continue;
    }
    current += text[index];
    index += 1;
  }
  segments.push(current);
  return segments;
}

/** ctx% 读数的高亮判据：越过（≥）警示阈值即高亮。阈值是配置值（`warn_ctx_pct`，缺省 85）；
 *  边界取高亮侧——读数是压缩行为的前瞻信号，85/85 时下一轮就会触发压缩，按「已越线」呈现。 */
export function usageOverWarn(ctxPct: number, warnPct: number): boolean {
  return ctxPct >= warnPct;
}

// ── usage 载荷的读数映射（M443，change harness-cache-metrics §5.3）────────────────
// 事件载荷与 `harness_state` 快照的 `usage` 字段**同一份键名与缺省口径**，只在这里映射一次
// （REVIEW.md 「同一语义两处真源」条：跨层同一条语义只应有一处产出）。缺键 / 非数值一律落 `null`——
// 「读不到」不等于「为 0」，回落单读数与气泡缺行都由消费方按 null 处理（REVIEW.md 「读不到当成空」条：
// 不许把「读不到」当「为空」下结论）。

/** usage 载荷映射出的读数（`null` = 该键缺失 / 非数值）。 */
export interface UsageReadings {
  /** 上下文窗口占用 %（最近一次请求）。 */
  ctx: number | null;
  /** 会话累计命中率（控制行主读数）。 */
  cacheSession: number | null;
  /** 本回合单回合命中率（M443；**M533 起无气泡消费点**——载荷投影保留）。 */
  cacheTurn: number | null;
  /** 本回合成因标注（后端判定值，前端只按值取文案；**M533 起无气泡消费点**）。 */
  cacheNote: "cold_start" | "block_dilution" | null;
  /** 本回合缓存写入 tokens（**M533 起无气泡消费点**）。 */
  cacheWrite: number | null;
  /** 本逻辑会话累计缓存写入 tokens（**M533 起无气泡消费点**）。 */
  cacheWriteSession: number | null;
  /** 最近一次请求的 input tokens（M526，气泡「上下文已用」绝对值）。 */
  inputTokens: number | null;
  /** 最近一次请求的 cached tokens（M526；**M533 起无气泡消费点**）。 */
  cachedTokens: number | null;
  /** 本逻辑会话累计 cached tokens（M526；**M533 起无气泡消费点**——命中率行只出百分比）。 */
  cachedTokensSession: number | null;
  /** ctx% 的分母（模型窗口；0 = 无上限值，气泡降级不显示百分比与上限）。 */
  contextWindow: number | null;
  /** 是否已有带 usage 的往返（M526：false ⇒ 从未发过请求，读数区整体隐藏）。 */
  hasUsage: boolean | null;
}

/** `usage` 载荷 → 读数（键名映射的唯一一处）。 */
export function usageReadings(payload: unknown): UsageReadings {
  const source =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : null;
  const number = (key: string): number | null => {
    const value = source?.[key];
    // 只认有限数值：`NaN` / `Infinity` 不是读数（渲染成「NaN%」比缺失更糟），落 null ⇒
    // 消费方走回落分支。
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const note = source?.cache_note;
  const hasUsage = source?.has_usage;
  return {
    ctx: number("ctx_pct"),
    cacheSession: number("cache_pct_session"),
    cacheTurn: number("cache_pct_turn"),
    cacheNote: note === "cold_start" || note === "block_dilution" ? note : null,
    cacheWrite: number("cache_write_tokens"),
    cacheWriteSession: number("cache_write_tokens_session"),
    inputTokens: number("input_tokens"),
    cachedTokens: number("cached_tokens"),
    cachedTokensSession: number("cached_tokens_session"),
    contextWindow: number("context_window"),
    // 只认真假两值：缺键 / 非布尔（旧后端载荷）落 null ⇒ 消费方维持旧行为（读数按 ctx 键呈现），
    // MUST NOT 把「读不到」当 false（那会让旧载荷的读数被整体隐藏）。
    hasUsage: typeof hasUsage === "boolean" ? hasUsage : null,
  };
}

// ── token 计数的人可读单位（M532）────────────────────────────────────────────────

/**
 * token 计数 → 人可读单位串（M532，Alex 原话「token 的最小单位是 k，如果超过 1000k，就升级
 * 成 m。让数字更加人可读好理解」）：≥1,000,000 走 `m`、≥1,000 走 `k`、不足 1,000 原值直出。
 * 千位以下直出是这条规则唯一的一处偏离：k 档在这个区间只会更难读也更不准（999 → `0.9k`、
 * 0 → `0k`），故「最小单位 k」只在 k 能如实表达时生效（口径原文见 openspec/specs/harness
 * 的气泡条款，边界由 tests/unit/harness-cache-metrics.test.ts 钉死）。
 *
 * 小数位**截断**到 0.1 档（不四舍五入）：读数偏小不会让人误判「离上限还有距离」或「命中更多」，
 * 同时 999,999 落在 `999.9k`、1,000,000 落在 `1m`——k 档永不出现「1000k」。末尾 `.0` 去掉
 * （`1k` 而非 `1.0k`）。非读数（负值 / 非有限数）原样透传：本函数不是读数来源，不编造也不吞掉。
 */
export function formatTokenCount(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return String(tokens);
  if (tokens < 1_000) return String(Math.trunc(tokens));
  const useMega = tokens >= 1_000_000;
  // `tenths` = 0.1 档的整数个数（k 档每 100 tokens 记 0.1k、m 档每 100000 tokens 记 0.1m）——
  // 截断点直接落在整数上：999,999 → 9999 → `999.9k`、1,000,000 → 10 → `1m`。
  const tenths = Math.floor(tokens / (useMega ? 100_000 : 100));
  return `${(tenths / 10).toFixed(1).replace(/\.0$/, "")}${useMega ? "m" : "k"}`;
}

/** ctx hover 气泡的一行（纯模型层产出，M526：渲染面与单测同一处——行文本在此拼装，
 *  buildCtxPop 只负责落 DOM）。`cls` = 行的样式类（沿用 buildCtxPop 既有类名）。 */
export interface CtxPopRow {
  cls: string;
  text: string;
}

/** ctx hover 气泡行文本（M526 抽纯）：**行集 M533 精简为两行含义句 + 越线警示行**——
 *  ①usage 行（绝对值与上限在场 ⇒ tokens 形态 D463；上限为 0 ⇒ 无上限降级 D464；绝对值缺键
 *  （旧载荷）⇒ 百分比形态 D395）②会话缓存命中率行（只百分比，D465）③越线时警示句（D335）
 *  追加在最后（M378 起的追加行为与恒在末尾的行序不变）。本回合命中行 / 缓存写入行 / 成因句
 *  随 M533 退场（Alex 2026-10-16：「气泡内容太冗余了。只需要这些信息」）——本回合值与缓存写入
 *  仍进 wire 留存（`llm_response.usage`），只是不再上屏。
 *  M532：气泡内的 tokens 数字（只存在于 usage 行的已用 / 上限）过 `formatTokenCount`（k/m
 *  单位）——只换数字形态，在场 / 降级判定一行不动。
 *  数据纪律不变：MUST NOT 编造读数；`hasUsage === false`（从未发过请求）返回空行集
 *  （读数区整体隐藏是 applyUsage 的判定，这里是第二道防线）。 */
export function ctxPopRows(r: UsageReadings, warnPct: number): CtxPopRow[] {
  if (r.hasUsage === false || r.ctx === null) return [];
  const rows: CtxPopRow[] = [];
  // 第一行：上下文窗口占用。绝对值 + 上限在场 ⇒ tokens 形态；上限为 0（无上限值）⇒ 降级；
  // 绝对值缺键（旧载荷）⇒ 百分比形态（M378 原句）。
  if (r.inputTokens !== null && r.contextWindow !== null && r.contextWindow > 0) {
    rows.push({
      cls: "lumir-hp-ctxpop-meaning",
      text: t("D463", {
        used: formatTokenCount(r.inputTokens),
        limit: formatTokenCount(r.contextWindow),
        ctx: Math.round(r.ctx),
      }),
    });
  } else if (r.inputTokens !== null) {
    rows.push({
      cls: "lumir-hp-ctxpop-meaning",
      text: t("D464", { used: formatTokenCount(r.inputTokens) }),
    });
  } else {
    rows.push({
      cls: "lumir-hp-ctxpop-meaning",
      text: t("D395", { ctx: Math.round(r.ctx) }),
    });
  }
  // 第二行：会话缓存命中率（控制行主读数的含义句）。M533 起只出百分比——M526 的 tokens
  // 形态退场，D401 的百分比回落形态随之并入本条（一个口径一条串）。
  if (r.cacheSession !== null) {
    rows.push({
      cls: "lumir-hp-ctxpop-cache",
      text: t("D465", { cache: Math.round(r.cacheSession) }),
    });
  }
  if (usageOverWarn(r.ctx, warnPct)) {
    rows.push({
      cls: "lumir-hp-ctxpop-warn",
      text: t("D335", { warn: Math.round(warnPct) }),
    });
  }
  return rows;
}

// ── harness pane 内容字号（M378；M627 起由「一套字号」驱动）────────────────────
// 面板不自持字号档位：缩放比由装配层从**编辑器的那一套字号**算出（src/typography.ts 的
// textScaleRatio），面板只把比值施加到自己的字号阶梯（--lumir-hp-scale）。两个内容面的
// 基线字号不同（编辑器 15px 起、面板 --fs-ui 13px 起），共用的是缩放级而不是绝对值——⌘0
// 回到配置值时两处同时回各自的基线。纯函数 `nextFontSize` / `textScaleRatio` 在 typography.ts。

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

/** 会话名的素材优先级（change add-session-auto-naming，design D11）：有效标题 → 首条用户消息
 *  → null（调用方回落 D330「新会话」）。标题栏会话名与历史浮层行名共用这一处口径——前端
 *  MUST NOT 自行生成或猜测标题（标题值只来自后端读取）。 */
export function sessionNameSource(
  title: string | null | undefined,
  firstUserText: string | null | undefined,
): string | null {
  if (typeof title === "string" && title.trim() !== "") return title;
  if (typeof firstUserText === "string" && firstUserText.trim() !== "") return firstUserText;
  return null;
}

/**
 * 消息块序列 →「首条用户消息的原始问题文本」：第一个非空**段落**块的文字（XML 序列化前的原始
 * 输入——卡片与序列化标签不作名），空白折叠成单空格、去首尾空白；没有非空段落 → null。
 *
 * **同一语义的两层实现之一**（M662，change quote-pipeline-consistency-oct24）：后端读留存时
 * 只有 wire 文本（没有块结构），`src-tauri/src/harness.rs` 的 `first_paragraph_text` 按同一
 * 口径从 wire 反推。两侧共用 `tests/unit/fixtures/session-name-fallback.json` 的期望值
 * （本模块的 tests/unit/session-name-fallback.test.ts 与 harness.rs 的单测各读一遍）——
 * 跨语言两层共享不了代码，能共享的是同一份素材 + 同一组期望。
 *
 * 为什么这段口径重要：历史浮层行名与恢复会话都吃后端回落值，而标题事件到达时浮层里「当前
 * 会话」那行是按**上屏名**匹配改名的（`retitleOpenSessRows`）。两侧口径一致时旧名相等、
 * 改名命中；不一致时那行就停在旧名上（Alex 2026-10-24 现场：行里留着 `<quote file="…`）。
 */
export function firstUserTextOf(blocks: readonly ComposerBlock[]): string | null {
  const para = blocks.find((block) => block.kind === "paragraph" && block.text.trim() !== "");
  if (para === undefined || para.kind !== "paragraph") return null;
  return para.text.replace(/\s+/g, " ").trim();
}

/** 历史会话清单的一条（`harness_list_sessions` 的宽容提取结果；M395 合同形状
 *  `SessionSummary` = { session_id, first_user_text, ts, title? }，解析只认这四个键）。 */
export interface SessionEntry {
  /** `sessions/<vault 稳定 id>/<id>.jsonl` 的文件名（恢复命令的入参）。 */
  sessionId: string;
  /** 首条用户消息原文（会话名回落口径的数据源）；null = 无用户消息（回落 D330「新会话」）。 */
  firstUserText: string | null;
  /** 首行 `session_open` 信封的 unix 秒；null = 缺读数不伪造（时间不显示）。 */
  ts: number | null;
  /** 会话有效标题（change add-session-auto-naming，design D11）：后端 `SessionSummary.title`
   *  的唯一读取口径；null = 无标题记录（旧文件安静回落首条用户消息）。 */
  title: string | null;
}

/**
 * `harness_list_sessions` 载荷的宽容解析（M392 + M395 合同 + change add-session-auto-naming 的
 * `title`）：string 先 JSON.parse，非数组 / 坏 JSON → 空清单（桩环境、M395 合并前的旧后端、
 * 读取失败不报错打断浮层）；逐项提取只认四个键——`session_id` 必须是非空字符串（缺 / 空串 /
 * 非字符串的项丢弃，没有 id 就无法恢复，留着也是死项）；`first_user_text` / `title` 缺 / null /
 * 空白串 → null；`ts` 缺 / 非数 / 非正 → null。
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
    const title = rec.title;
    const ts = rec.ts;
    out.push({
      sessionId: rec.session_id,
      firstUserText: typeof text === "string" && text.trim() !== "" ? text : null,
      ts: typeof ts === "number" && Number.isFinite(ts) && ts > 0 ? ts : null,
      title: typeof title === "string" && title.trim() !== "" ? title : null,
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

/** 消息时间读数的形态（M460）：
 *  - `live` = 上屏打戳的消息（本轮刚发的）——沿用 M351 的分档（见 [`relativeWhen`]，含「刚刚」
 *    与「昨天」兜底），读数一定新；
 *  - `restored` = 恢复重放 / 快照重建的消息——读数来自留存，可以跨天甚至跨周，「昨天」对一周前
 *    的消息是错读数，故按 [`sessionWhen`] 同族口径：同日窄相对、跨天短日期。
 *  两种形态并存是刻意的：live 档的「刚刚」是 M351 定下的观感（sessionWhen 的 `0秒前` 更差），
 *  而 restored 档必须能表达「很久以前」。 */
export type WhenForm = "live" | "restored";

/** 消息 meta 行的时间读数文本（`· ` + 读数）：首绘与 30s 刷新 / 语言切换共用这一个出口——
 *  两处各算一次会让重绘与首绘漂（REVIEW.md 「同一语义两处真源」条）。 */
export function whenTextOf(
  at: number,
  now: number,
  form: WhenForm = "live",
  lang: Language = currentLanguage(),
): string {
  const body =
    form === "restored"
      ? sessionWhen(Math.floor(at / 1000), now, lang)
      : relativeWhen(at, now, lang);
  return `· ${body}`;
}

/** 会话浮层取数结果（M442，`harness_list_sessions` 往返的三种终态）。 */
export type SessListOutcome =
  | { kind: "entries"; count: number } // 取数成功，清单有 count 条
  | { kind: "empty" } // 取数成功但清单为空
  | { kind: "failed" }; // 取数失败（后端不可用 / 命令未注册 / 读取报错）

/** 会话浮层的揭示决策（O5，合同 docs/specs/overlay-visibility.md）：取数结果 → 揭示与否 +
 *  是否给用户可感知反馈。纯函数——DOM 层（`buildSessList`）唯一消费点，单测矩阵直接驱动它。 */
export interface SessPopDecision {
  /** 是否揭示浮层——唯一前提是「内容已确认为非空」。 */
  visible: boolean;
  /** 是否给用户可感知反馈——空 / 失败路径 MUST NOT 静默（O5 的「不得静默」半边）。 */
  notify: boolean;
}

/**
 * 会话浮层揭示决策（M442）：**内容已确认为非空**才揭示；空清单与取数失败一律不揭示且需反馈。
 * 不变量（O5）：`visible` ⟹ 取数成功且 `count > 0`——「可见但无内容」的中间态因此不可达
 * （这正是 M442 现场：浮层先以空盒画出、IPC 往返后因空清单收起 = 「闪现即消失」）。
 */
export function sessPopDecision(outcome: SessListOutcome): SessPopDecision {
  const nonEmpty = outcome.kind === "entries" && outcome.count > 0;
  return { visible: nonEmpty, notify: !nonEmpty };
}

/**
 * 可见态 → 两个 DOM 面（`hidden` 与 `aria-expanded`）。**两面 MUST 同源派生**（单一来源，
 * REVIEW.md 「同一语义两处真源」条）：分开写正是 M442 的形态——`aria-expanded` 按「展开意图」翻 true，而
 * 浮层因空清单实际未揭示，属性与真实可见态脱节。M442 起 `setSessPop` 的一切跃迁都经
 * `applySessPop` 这一个写入口，两面恒相等。
 */
export function sessPopDom(visible: boolean): { hidden: boolean; ariaExpanded: "true" | "false" } {
  return { hidden: !visible, ariaExpanded: visible ? "true" : "false" };
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
 * 这是跨层字符串耦合（REVIEW.md 「同一语义两处真源」条的口味，同族：前端认 core 的摘要格式）。根治办法是
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
// 数据口径：`started` 事件的 summary 来自 core 的 `summarize_args`
// （src-tauri/src/harness/turn.rs 是单一真源，MUST NOT 前端另算一份参数）。它**不是**
// 「参数 JSON 原文」一种形态——M528 起非 cli 工具与解析失败仍回落原文截断，而 cli_run
// 的摘要是 core 拼好的**成品人话文本**（`command + args`，命令恒在最前、超长只截拼接串），
// 因为 arguments 的键序由模型现写、原文截断会把排在 `args` 后面的 `command` 切掉。
// 故这一层是**双形态消费方**：先按工具名做展示层提取（JSON 路径，见下），取不到就按原文
// 上屏（正好是 core 那份成品）——两种形态都可能在，判据见 [`humanizeToolArgs`] 与
// [`toolArgsText`]（后者是「参数格取哪一份」的取值口径）。
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
    case "vault_delete":
      return typeof args.path === "string" && args.path !== "" ? args.path : null;
    case "vault_move": {
      // 移动 = 「源 → 目标」路径对（与批准预览的路径对同口径，M414；缺任一段回落原文）。
      const from = args.path;
      const to = args.new_path;
      if (typeof from !== "string" || from === "" || typeof to !== "string" || to === "") return null;
      return `${from} → ${to}`; // i18n-exempt: glyph（路径对的连接箭头，非文案）
    }
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

/** 严格版人话化：只在 JSON 完整且关键参数取得到时返回值，否则 ""（调用方据此判「这份 summary
 *  里取不出关键参数」——如持久化失败摘要、恢复路径拒绝行的 args 格留空）。
 *
 *  **`""` 不等于「它不是参数摘要」（M528 r1）**：core 的成品人话摘要（cli_run = `command + args`）
 *  也不是 JSON，严格版照旧取空。凡「这份 summary 就是参数那一份、要把该显示的取出来」的地方，
 *  走 [`toolArgsText`]（判据是「不是失败形状」，不是「是 JSON」）——改用严格版会让成品摘要
 *  那一格整格空掉（r1 P1-1 的现场）。 */
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

/**
 * 工具行**参数格**的文本（M528）：这份 summary 是 core 给的参数摘要时取出该显示的那串，
 * 不是参数（失败摘要 / 空）时返回 ""（参数格留空）。
 *
 * 为什么不能直接用 [`humanizeToolArgsStrict`]：M528 起 core 的 `summarize_args` 直接给出
 * **成品**人话摘要（cli_run = `command + args` 拼接，命令恒在最前），summary 不再是 JSON——
 * 严格版会把「不是 JSON」一律判成「没有参数」，参数格（含恢复路径的「已采纳」行）就此空掉。
 * 故这里的判据是「**不是失败形状**」而非「是 JSON」：失败摘要（`状态 · 错误码: 消息`）不是
 * 参数，其余一律交给 [`humanizeToolArgs`]——它先试 JSON（旧快照 / 非 cli 工具仍是 JSON），
 * 取不到就按原文上屏（正好是 core 那份成品）。
 */
export function toolArgsText(name: string, summary: string): string {
  if (summary === "" || TOOL_FAILED_SUMMARY.test(summary)) return "";
  return humanizeToolArgs(name, summary);
}

/** unified diff 的文件名（core diff.rs 头两行 `--- a/{path}` / `+++ b/{path}`；取不到 → null）。 */
export function diffPathOf(diff: string): string | null {
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) return line.slice("+++ b/".length);
  }
  return null;
}

/** 恢复路径的批准闸决定（M414，M413 契约的消费点）：tool 面板记录的 `decision` 字段——
 *  **只有进过批准闸的调用**带它（approved / rejected），allow / deny / 重定向路径没有批准
 *  动作、字段缺席。旧快照的兜底读法是 `status === "rejected"`（那条路径上拒绝是 status 而
 *  非 decision）。返回值 = 该工具行在恢复渲染里的终态；null = 未进过闸（成功 / 失败行各走
 *  原判据）。 */
export function restoredApprovalOutcome(record: unknown): "approved" | "rejected" | null {
  if (typeof record !== "object" || record === null) return null;
  const decision = (record as { decision?: unknown }).decision;
  if (decision === "approved") return "approved";
  if (decision === "rejected") return "rejected";
  return (record as { status?: unknown }).status === "rejected" ? "rejected" : null;
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
 *  写工具 = diff 头文件名；调度工具 = `id` + `at`（任务身份与时间；id 即通知标题，必须在
 *  行上看得见）；都无 → ""。 */
export function approvalArgsText(request: {
  diff?: string | undefined;
  argv?: readonly string[] | undefined;
  cronTask?: CronTaskPreview | undefined;
}): string {
  if (request.argv !== undefined) return formatArgv(request.argv);
  if (request.diff !== undefined) return diffPathOf(request.diff) ?? "";
  if (request.cronTask !== undefined) {
    const { id, at } = request.cronTask;
    return at !== undefined && at !== "" ? `${id} ${at}` : id;
  }
  return "";
}

/** 工具行的路径目标（change harness-path-link）：从 summary 的结构化参数里取，解析失败
 *  （含 80 字截断的摘要）→ 空。MUST NOT 对展示文本做路径正则——卡片上的命令 / 截断 JSON
 *  不冒充路径。 */
function toolPathTargetsOf(name: string, summary: string): ToolPathTarget[] {
  return toolPathTargets(name, parseToolArgs(summary));
}

/** 批准卡的路径目标：只有 diff 头（写类工具）提供文件名；argv（cli_run）不产路径目标。 */
function approvalPathTargets(request: { diff?: string | undefined }): ToolPathTarget[] {
  if (request.diff === undefined) return [];
  const path = diffPathOf(request.diff);
  return path !== null && isWellFormedVaultPath(path) ? [{ path }] : [];
}



// ---------------------------------------------------------------------------
// Markdown → DOM（零 XSS：纯 DOM API + textContent；解析器 = @lezer/markdown 的 GFM 配置）
// ---------------------------------------------------------------------------

const mdParser = commonmarkParser.configure([GFM]);

/** @lezer/common 不是直接依赖，SyntaxNode 类型从解析器返回值派生。 */
type MdSyntaxNode = ReturnType<typeof mdParser.parse>["topNode"];

/** 不产出的节点：各类「标记」（** 的星号、代码围栏的 ```、链接的 []()、引用的 > 等）与
 *  链接定义行。它们是有名子节点，跳过即可；节点之间的纯文本由间隙填充承担（见
 *  renderInlineChildren——lezer 不给纯文本包节点，有名子节点之间的区间就是文本）。
 *  **`URL` 不在此列**（M460）：裸 URL 是 GFM 产出的**顶层节点**（段落、表格 cell 里都是），
 *  跳过它等于把消息里的 URL 整段吃掉；它在 `Link` / `Autolink` **之下**时仍须跳过（那是
 *  `[文字](url)` 括号里那段，由宿主分支取作 href），该区分见 renderInlineNode 的 URL 分支。 */
const SKIP_NODES = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "LinkMark",
  "LinkTitle",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "LinkReference",
  "Comment",
]);

function textOf(doc: string, node: MdSyntaxNode): string {
  return doc.slice(node.from, node.to);
}

/** 路径链接化的渲染上下文（change harness-path-link；目录目标见 change harness-dir-link）：
 *  单参透传，不引入模块级可变状态——流式尾块每帧重渲、单测并行，模块状态会让两次渲染互相污染。
 *  `isFile` / `isDir` 是**唯一判据**（文件索引 / 文件树目录模型），`openFile` / `revealDir`
 *  是两条互不相同的落点：前者打开文档，后者只在左栏定位。 */
export interface PathLinkRenderContext extends PathTargetIndex {
  openFile(path: string, line?: number): void;
  revealDir(path: string): void;
}

/** 一次点击的目标：路径 + 类型（目录不带行号）。 */
interface PathLinkTarget {
  path: string;
  kind: "file" | "dir";
  line?: number;
}

/** 可点路径元素：button 而非 `<a href>`——不引入 webview 的默认导航与中键点击路径；可聚焦、
 *  Enter 触发；可见文本与 title 逐字等于模型原文（含行号后缀 / 目录引用的尾斜杠）。候选来自
 *  模型输出，这里只持有已通过索引校验的目标，落点交给装配层（面板不拼路径、不判文件系统）。 */
function createPathLinkEl(
  text: string,
  target: PathLinkTarget,
  ctx: PathLinkRenderContext,
): HTMLElement {
  const activate = (): void => {
    if (target.kind === "dir") ctx.revealDir(target.path);
    else ctx.openFile(target.path, target.line);
  };
  const el = document.createElement("button");
  el.type = "button";
  el.className = "lumir-hp-pathlink";
  el.textContent = text;
  el.title = text;
  el.addEventListener("click", (event) => {
    event.preventDefault();
    activate();
  });
  el.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    activate();
  });
  return el;
}

/** 纯文本落地：有上下文时按候选切段（未命中的部分仍是文本节点），否则原样一个文本节点。 */
function appendText(container: HTMLElement, text: string, ctx?: PathLinkRenderContext): void {
  if (ctx === undefined) {
    container.append(document.createTextNode(text));
    return;
  }
  const candidates = findPathCandidates(text, ctx);
  let pos = 0;
  for (const candidate of candidates) {
    if (candidate.from > pos) {
      container.append(document.createTextNode(text.slice(pos, candidate.from)));
    }
    container.append(createPathLinkEl(candidate.text, candidate, ctx));
    pos = candidate.to;
  }
  if (pos < text.length) container.append(document.createTextNode(text.slice(pos)));
}

/** 行内渲染：有名子节点逐个交给 renderInlineNode，节点间隙是纯文本直接落地。 */
function renderInlineChildren(
  container: HTMLElement,
  node: MdSyntaxNode,
  doc: string,
  ctx?: PathLinkRenderContext,
): void {
  let pos = node.from;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.from > pos) appendText(container, doc.slice(pos, child.from), ctx);
    renderInlineNode(container, child, doc, ctx);
    pos = Math.max(pos, child.to);
  }
  if (node.to > pos) appendText(container, doc.slice(pos, node.to), ctx);
}

/** 链接元素（三种入口共用：`Link` / `Autolink` / 裸 `URL` 节点）。href 只作展示与 title，
 *  导航一律被拦下交给 openExternalUrl（scheme 白名单在 Rust 侧判定，前端不自行判能不能开
 *  ——与编辑器内外链同一条信任边界）。三条入口共用这一个出口是刻意的：信任边界只有一份。 */
function createLinkEl(href: string): HTMLAnchorElement {
  const el = document.createElement("a");
  el.className = "lumir-hp-link";
  el.href = href;
  el.title = href;
  el.addEventListener("click", (event) => {
    event.preventDefault();
    if (href !== "") openExternalUrl(href).catch(() => {});
  });
  return el;
}

function renderInlineNode(
  container: HTMLElement,
  node: MdSyntaxNode,
  doc: string,
  ctx?: PathLinkRenderContext,
): void {
  switch (node.name) {
    case "Emphasis": {
      const el = document.createElement("em");
      container.append(el);
      renderInlineChildren(el, node, doc, ctx);
      return;
    }
    case "StrongEmphasis": {
      const el = document.createElement("strong");
      container.append(el);
      renderInlineChildren(el, node, doc, ctx);
      return;
    }
    case "Strikethrough": {
      const el = document.createElement("s");
      container.append(el);
      renderInlineChildren(el, node, doc, ctx);
      return;
    }
    case "InlineCode": {
      // 类名与编辑器行内代码同源（cm-lp-inline-code）：镜像的 preview 主题把同一颗
      // 药丸样式带进来，面板与正文读起来是同一个东西（REVIEW.md 「同一语义两处真源」条：不另造第二套）。
      // 行内代码里的路径同样链接化（change harness-path-link 起草期取值 2：agent 最常用反引号
      // 写路径；目录与噪音仍被存在性校验挡住）。
      const el = document.createElement("code");
      el.className = "cm-lp-inline-code";
      const codeText = node.getChild("CodeText");
      appendText(
        el,
        codeText !== null ? textOf(doc, codeText) : textOf(doc, node).replace(/^`|`$/g, ""),
        ctx,
      );
      container.append(el);
      return;
    }
    case "Link":
    case "Autolink": {
      const urlNode = node.getChild("URL");
      const href = urlNode !== null ? textOf(doc, urlNode) : "";
      const el = createLinkEl(href);
      if (node.name === "Autolink") {
        el.textContent = textOf(doc, node).replace(/^<|>$/g, "");
      } else {
        // 锚内部不再产可点元素：嵌套锚在 HTML 里不合法，且这段文本已有自己的导航语义。
        // 不传上下文（而不是传一个「永远不可点」的上下文）——省掉一次无谓的候选扫描。
        renderInlineChildren(el, node, doc);
      }
      container.append(el);
      return;
    }
    case "URL": {
      // 裸 URL（M460）：GFM 对 `https://…` / `www.…` / 邮箱字面量直接产 `URL` 节点——段落与
      // 表格 cell 里都是**顶层**节点（父节点是 Paragraph / TableCell 一类宿主）。它必须上屏
      // 为链接，否则整段 URL 在面板里隐身（Alex 2026-10-12 dogfood：表格里的链接没渲染出来）。
      // 作为 `Link` / `Autolink` 的**子节点**时跳过：那段 URL 是链接语法的一部分，宿主分支
      // 已经把它取作 href，再上屏一次就是重复显示源码。
      if (node.parent !== null && (node.parent.name === "Link" || node.parent.name === "Autolink")) {
        return;
      }
      const url = textOf(doc, node);
      const el = createLinkEl(url);
      el.textContent = url; // 裸 URL 的可见文本就是 URL 原文（没有「显示文本」之说）
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
        renderInlineChildren(container, node, doc, ctx);
      } else {
        appendText(container, textOf(doc, node), ctx);
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

// ---------------------------------------------------------------------------
// 块级全屏入口（change add-harness-block-fullscreen）：定位容器 + 悬停钮
// ---------------------------------------------------------------------------

/** SVG 命名空间（模块无 innerHTML 的渲染纪律：全部图标经 DOM API 内联构建）。 */
const SVG_NS = "http://www.w3.org/2000/svg";

/** 四角框图标元素：字形与画笔属性取 `src/preview/block-trigger.ts` 的唯一一份
 *  （`CORNERS_ICON_SVG`），本模块用 DOM API 建——渲染纪律是本模块零 innerHTML 赋值
 *  （全部内容经 DOM API + textContent 注入），不是另画一个图标。 */
function createCornersIcon(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of Object.entries(CORNERS_ICON_SVG.attrs)) svg.setAttribute(name, value);
  for (const d of CORNERS_ICON_SVG.paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

/** 悬停钮的读屏名：与 content pane 的块级动作钮同一份词条（D124 / D156，零新增编号）。
 *  块序数不下沉到钮面文字（遮罩自己的读屏名带序号，见 `blockFullscreenLabel`）。 */
function blockTriggerLabel(kind: "code" | "table"): string {
  return kind === "table" ? TABLE_TRIGGER_LABEL() : CODEBLOCK_FS_TRIGGER_LABEL();
}

/** 遮罩读屏名（D5）：`Markdown 表格 N` / `Markdown 代码块 N`（D211 / D212——与文档内容器
 *  同一份词条）。N = **本条消息内**同类块的 1-based 序号：点击那一刻从 DOM 现数的纯派生读数，
 *  不进任何数据模型、不持久化。 */
function blockFullscreenLabel(slot: HTMLElement, kind: "code" | "table"): string {
  return t(kind === "table" ? "D211" : "D212", { index: blockOrdinal(slot, kind) });
}

/** 消息内序号：从块容器向上找消息根（`.lumir-hp-msg`），数同类块的 DOM 序。消息根缺席
 *  （单测 / 嵌入式渲染件）时退回父节点——序号退化为 1，不抛错。 */
function blockOrdinal(slot: HTMLElement, kind: "code" | "table"): number {
  const root: Element | null = slot.closest(".lumir-hp-msg") ?? slot.parentElement ?? null;
  if (root === null) return 1;
  const same = [...root.querySelectorAll(".lumir-hp-block-slot")].filter(
    (el) => (el as HTMLElement).dataset.hpBlock === kind,
  );
  const index = same.indexOf(slot);
  return index < 0 ? 1 : index + 1;
}

/**
 * 代码块 / 表格的块级全屏入口：包一层 `.lumir-hp-block-slot`（零足迹定位容器），内挂悬停钮。
 *
 * 为什么包 slot 而不是给 `<pre>` / `<table>` 加 `position: relative`：两者都是内容盒（面板的
 * 代码块自带横向滚动），给块本体加定位会让钮跟着内容横滚走——slot 在滚动容器**之外**，
 * 与 content pane 的 `.cm-lp-codeblock-slot` / `.cm-lp-table-slot` 是同一条理由
 * （src/preview/block-trigger.ts 的文件头）。
 *
 * 钮只带共享形态类 `.lumir-block-trigger` + 一个位置 class（壳 / 尺寸 / 热态 / eink 规则
 * 在 src/style.css 只有一份）。点击 `preventDefault` + `stopPropagation`：消息容器可能挂着
 * 摘录手势，钮的点击不得被它接走。
 */
function blockSlot(
  block: HTMLElement,
  kind: "code" | "table",
  open: (trigger: HTMLElement, slot: HTMLElement) => void,
): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "lumir-hp-block-slot";
  slot.dataset.hpBlock = kind;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${BLOCK_TRIGGER_CLASS} lumir-hp-block-fs-trigger`;
  button.setAttribute("aria-label", blockTriggerLabel(kind));
  button.append(createCornersIcon());
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    open(button, slot);
  });
  slot.append(block, button);
  return slot;
}

/** 一行表格行的列位分布：`cells[k]` = 第 k 列的 cell（空位 `undefined`）。 */
interface TableRowPlan {
  header: boolean;
  cells: Array<MdSyntaxNode | undefined>;
}

/**
 * GFM 表格的矩形化布局（M528）。
 *
 * lezer 对**空单元格不产 `TableCell` 节点**——只产相邻的两个 `TableDelimiter`。只按
 * `TableCell` 子节点渲染就会把空格吃掉、后续列整体左移（Alex 2026-10-16 dogfood 现场：
 * 「第一行的第一列应该是一个空白格，但渲染出来的时候第一行少了它，从原本的 3 列变成了
 * 2 列」）。故列位按**分隔符序号**判定：一个 cell 落在**第 k 与第 k+1 个分隔符之间**即第 k 列
 * （行首无 pipe 的写法下第一个 cell 没有前导分隔符，故扣掉那个首分隔符），空位补空 cell。
 *
 * 列数取 **delimiter 行的列数**（GFM 的列数以 delimiter 行为准）——它是表格里唯一不受空
 * 单元格影响的行（`| --- | --- |` 逐格都是实槽）。短行（cell 少于该列数）按列数补齐，
 * 与 `docs/specs/table-reading.md` §2 的同一条矩形性合同一致（「短行尾部补空列」）。
 *
 * 更宽的那侧不砍：某行 cell 超出 delimiter 行列数时（GFM 是 excess ignored）整表按更宽的
 * 那个列数渲染——表格渲染不吃掉 parser 已产出的 cell，同时保持每行等宽。
 */
function tableRowsOf(node: MdSyntaxNode, doc: string): TableRowPlan[] {
  const plans: TableRowPlan[] = [];
  let delimiterCols = 0;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === "TableDelimiter") {
      // delimiter 行是一个叶子节点，列数 = 其中的 `-` 串个数（比数 pipe 稳：首尾 pipe
      // 有无都不影响；`|:---|:---:|---:|` 这类对齐写法同样是三条）。
      delimiterCols = Math.max(delimiterCols, (textOf(doc, child).match(/-+/g) ?? []).length);
      continue;
    }
    if (child.name !== "TableHeader" && child.name !== "TableRow") continue;
    plans.push({ header: child.name === "TableHeader", cells: tableRowSlotsOf(child) });
  }
  const cols = Math.max(delimiterCols, 0, ...plans.map((plan) => plan.cells.length));
  for (const plan of plans) {
    while (plan.cells.length < cols) plan.cells.push(undefined);
  }
  return plans;
}

/** 单行的列位分布（[`tableRowsOf`] 的判列位一半）：分隔符序号定列位，空槽留洞。 */
function tableRowSlotsOf(row: MdSyntaxNode): Array<MdSyntaxNode | undefined> {
  const cells: Array<MdSyntaxNode | undefined> = [];
  // 行首是分隔符时列位从 0 起算（第一个 cell 已经吃过一个分隔符）；无首 pipe 的写法下
  // 第一个 cell 直接落 0 号位。两种写法下 `delimiters - leading` 都不会为负。
  const leading = row.firstChild !== null && row.firstChild.name === "TableDelimiter" ? 1 : 0;
  let delimiters = 0;
  for (let child = row.firstChild; child !== null; child = child.nextSibling) {
    if (child.name === "TableDelimiter") {
      delimiters++;
      continue;
    }
    if (child.name !== "TableCell") continue;
    cells[delimiters - leading] = child;
  }
  return cells;
}

/** 块级渲染：top-level 节点 → 块元素。不认识的块按转义文本段落落地（可见但惰性）。
 *  `ctx` 只作用于行内文本落地；代码块（围栏 / 缩进）不经过它——代码里的路径不链接化。
 *  `openers` 是代码块 / 表格的全屏接线面（缺省 = 钮照常渲染、点击无动作，见 HarnessBlockOpeners）。 */
function renderBlock(
  container: HTMLElement,
  node: MdSyntaxNode,
  doc: string,
  ctx?: PathLinkRenderContext,
  openers?: HarnessBlockOpeners,
): void {
  const heading = /^ATXHeading([1-6])$/.exec(node.name);
  if (heading !== null || node.name === "SetextHeading1" || node.name === "SetextHeading2") {
    const level = heading !== null ? heading[1] : node.name === "SetextHeading1" ? "1" : "2";
    const el = document.createElement(`h${level}`);
    renderInlineChildren(el, node, doc, ctx);
    container.append(el);
    return;
  }
  switch (node.name) {
    case "Paragraph": {
      const el = document.createElement("p");
      renderInlineChildren(el, node, doc, ctx);
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
          renderBlock(li, item, doc, ctx, openers);
        }
        el.append(li);
      }
      container.append(el);
      return;
    }
    case "Blockquote": {
      const el = document.createElement("blockquote");
      for (let child = node.firstChild; child !== null; child = child.nextSibling) {
        renderBlock(el, child, doc, ctx, openers);
      }
      container.append(el);
      return;
    }
    case "FencedCode": {
      const infoNode = node.getChild("CodeInfo");
      const textNode = node.getChild("CodeText");
      const pre = buildCodeBlock(
        textNode !== null ? textOf(doc, textNode) : "",
        infoNode !== null ? textOf(doc, infoNode).trim() : "",
      );
      // 围栏**闭合**后才有入口：@lezer/markdown 把未闭合的围栏也解析成 FencedCode（实测），
      // 「语法上还不是代码块」不成立——判据取块自己的尾 `CodeMark`，仍是解析事实（不是一条
      // 要维护的开关）。闭合那一帧起尾块重渲即带钮（design §1.2 / spec「围栏未闭合时没有入口」）。
      const closed = node.lastChild !== null && node.lastChild.name === "CodeMark";
      container.append(
        closed
          ? blockSlot(pre, "code", (trigger, slot) => {
              openers?.code(planCodeBlockOfDocument(doc, node), blockFullscreenLabel(slot, "code"), trigger);
            })
          : pre,
      );
      return;
    }
    case "CodeBlock": {
      const pre = buildCodeBlock(textOf(doc, node), "");
      container.append(
        blockSlot(pre, "code", (trigger, slot) => {
          openers?.code(planCodeBlockOfDocument(doc, node), blockFullscreenLabel(slot, "code"), trigger);
        }),
      );
      return;
    }
    case "Table": {
      const table = document.createElement("table");
      table.className = "lumir-hp-table";
      const thead = document.createElement("thead");
      const tbody = document.createElement("tbody");
      for (const plan of tableRowsOf(node, doc)) {
        const row = document.createElement("tr");
        for (const cell of plan.cells) {
          const cellEl = document.createElement(plan.header ? "th" : "td");
          if (cell !== undefined) renderInlineChildren(cellEl, cell, doc, ctx);
          row.append(cellEl);
        }
        (plan.header ? thead : tbody).append(row);
      }
      if (thead.childElementCount > 0) table.append(thead);
      if (tbody.childElementCount > 0) table.append(tbody);
      // 固有宽 + 局部横滚（change harness-table-horizontal-scroll-oct24）：表按内容自然宽布局，
      // 超出正文栏的部分只在 wrapper 内滚。两半缺一不可——只包 wrapper 时表仍被 auto 表布局
      // 压回（wrapper 永不溢出），只给表加 max-content 时溢出抬高整个 transcript 列。
      // 结构必须是 slot > wrapper > table：slot（全屏钮的定位容器）在横滚容器之外，横滚时钮不动；
      // 全屏入口仍收 table 本身，遮罩快照里因此不出现 wrapper 层。
      const scroller = document.createElement("div");
      scroller.className = "lumir-hp-table-scroll";
      scroller.append(table);
      container.append(
        blockSlot(scroller, "table", (trigger, slot) => {
          openers?.table(table, blockFullscreenLabel(slot, "table"), trigger);
        }),
      );
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
          renderBlock(container, child, doc, ctx, openers);
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

/** 一段完整 Markdown → 追加渲染到容器（多块）。导出是为了让单测用最小 DOM 替身驱动**这份
 *  真渲染件**（tests/unit/harness-transcript-render.test.ts：裸 URL 上屏为锚、Link 之下的
 *  URL 不重复上屏、vault 路径可点）——纯函数层驱动不到 DOM 面，重建一份渲染器则失去判据
 *  （REVIEW.md 「同一语义两处真源」条）。
 *
 *  `ctx` 缺省 = 不做路径链接化（单测与既有调用逐字不变）；面板内部传入自己的上下文。
 *  `openers` 缺省 = 代码块 / 表格照常带全屏钮、点击无动作（与 `ctx` 同一条缺省口径）。 */
export function renderMarkdownInto(
  container: HTMLElement,
  source: string,
  ctx?: PathLinkRenderContext,
  openers?: HarnessBlockOpeners,
): void {
  const tree = mdParser.parse(source);
  renderBlock(container, tree.topNode, source, ctx, openers);
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
  /** 判定依据（M459 契约字段，可缺席 = 旧载荷 / 不可上卡的层）：批准卡「判定依据」行的数据源，
   *  层级由 Rust 判定管线产出，前端只按 kind 取文案。 */
  reason?: DecisionReason | undefined;
  /** 定时任务预览（change add-cron-conversational-registration §6.3，可缺席）：任务要素块的
   *  数据源，随语言重绘时按它重跑 `renderCronTaskBlock`。 */
  cronTask?: CronTaskPreview | undefined;
  /** 会话记忆粒度 / 持久规则原文（change harness-permission-rules-oct23）：随语言重上按钮
   *  文案时的插值素材；缺键 = 该按钮不存在。 */
  remember?: string | undefined;
  persistRule?: string | undefined;
  argsText: string;
  /** 参数里取到的路径目标（change harness-path-link）：行内重渲 / 终态行复用，不在重渲时重解析。 */
  targets: readonly ToolPathTarget[];
  element: HTMLElement;
  row: HTMLElement;
  wrap: HTMLElement;
}

// ---------------------------------------------------------------------------
// 子代理任务区（change add-harness-subagents tasks §10，M590）
//
// 这一层只放**纯映射**：事件 → run 视图、视图 → 读数文案。DOM 在面板本体的任务区段维护，
// 单测在零 DOM 环境驱动前者（tests/unit/harness-subagents.test.ts），后者归真机 AX 场景
// （§8.19 / §8.21）。状态词与触顶原因词的唯一产出点是 `subrunStatusWord` /
// `subrunStoppedByWord`——渲染点 MUST NOT 另写词表（REVIEW.md「同一语义两处真源」条）。
// ---------------------------------------------------------------------------

/** 任务行状态。`waiting` 不是后端值：它由「该 run 有挂起的批准项」派生（design §19.1）。 */
export type SubrunStatus = "running" | "waiting" | "done" | "partial" | "failed" | "stopped";

export interface SubrunStep {
  tool: string;
  summary: string;
}

/** 面板一行的数据面（`subagent_*` 事件与快照的合并视图；MUST NOT 进 transcript）。 */
export interface SubrunView {
  runId: string;
  agent: string;
  description: string;
  model: string;
  background: boolean;
  status: SubrunStatus;
  rounds: number;
  toolCalls: number;
  lastTool: string | null;
  steps: SubrunStep[];
  /** 运行中来自 `subagent_progress.elapsed_ms`，收尾后被 `duration_ms` 覆盖。 */
  elapsedMs: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** 该 run 已收尾的段数（resume 会累加；行详情与用量区的读数）。 */
  segments: number;
  stoppedBy: string | null;
  deniedCalls: number;
  summaryChars: number;
  /** 摘要正文（来自通知 / task 工具结果；事件只带 `summary_chars`，无正文时不伪造）。 */
  summary: string | null;
  /** 挂在该 run 上的批准请求 id（按到达序）。 */
  approvalIds: string[];
}

/** 子运行透传的批准请求（事件 / 快照两条通道的公共形状；`source` 已在外面分派掉）。 */
export interface TaskApprovalRequest {
  id: string;
  tool: string;
  diff?: string | undefined;
  argv?: string[] | undefined;
  purpose?: string | undefined;
  reason?: DecisionReason | undefined;
  /** 定时任务预览（change add-cron-conversational-registration §6.3；子运行不可达这类工具）。 */
  cronTask?: CronTaskPreview | undefined;
  /** 会话记忆粒度（change harness-permission-rules-oct23 design §5；缺键 = 不渲染该按钮）。 */
  remember?: string | undefined;
  /** 持久规则原文（同上；缺键 = 不渲染该按钮）。 */
  persistRule?: string | undefined;
}

/** 任务行已建的 DOM 骨架（就地更新用：重建会丢批准卡里正在输入的原因）。 */
interface RunRowEls {
  el: HTMLElement;
  head: HTMLButtonElement;
  icon: HTMLElement;
  agent: HTMLElement;
  desc: HTMLElement;
  flag: HTMLElement;
  read: HTMLElement;
  stateWord: HTMLElement;
  body: HTMLElement;
  meta: HTMLElement;
  latest: HTMLElement;
  summary: HTMLElement;
  actions: HTMLElement;
  decisions: HTMLElement;
  approvals: HTMLElement;
  /** 该行当前渲染的批准卡（id → 元素；决策后就地移入终态记录）。 */
  cards: Map<string, HTMLElement>;
}

/** transcript 里一条 `task` 工具行的绑定（design §19.1：历史任务的详情从这里点开）。
 *  行由工具事件创建、由 run 事件更新；两者靠「agent 名 + FIFO」绑定（见 `bindTaskRow`）。 */
interface TaskRowEntry {
  /** 行 + 详情的外壳（折叠时整体隐藏，随工具块收尾）。 */
  wrap: HTMLElement;
  row: HTMLElement;
  detail: HTMLElement;
  /** `task` 调用的参数摘要原文（JSON，可能被 80 字截断）。 */
  argsSummary: string;
  /** 绑定的 run（null = 尚未绑定；被闸拒的调用保持 null 并 settled）。 */
  runId: string | null;
  /** 已落终态且没有 run 可绑（拒绝 / 参数非法）：不再参与绑定。 */
  settled: boolean;
  open: boolean;
  /** 自定义详情渲染（恢复路径用信封 JSON；null = 走 run 视图的默认渲染）。 */
  renderDetail: (() => void) | null;
}

/** 任务区消费的事件子集（`HarnessEvent` 的结构子集：单测可构造，不依赖 ipc）。 */
export type SubrunEvent =
  | { type: "subagent_started"; run_id: string; agent: string; description: string; model: string; background: boolean }
  | { type: "subagent_progress"; run_id: string; rounds: number; tool_calls: number; last_tool: string | null; elapsed_ms: number }
  | { type: "subagent_step"; run_id: string; tool: string; summary: string }
  | { type: "subagent_finished"; run_id: string; agent: string; status: string; stopped_by?: string; rounds: number; model: string; input_tokens: number; cached_tokens: number; output_tokens: number; denied_calls: number; duration_ms: number; summary_chars: number; summary?: string };

/** 后端终态 → 行状态。`completed` / `aborted` 是后端的词，`done` / `stopped` 是行状态的词；
 *  未知值返回 null（调用方丢弃，不猜）。 */
export function subrunStatusOf(raw: unknown): SubrunStatus | null {
  switch (raw) {
    case "running":
      return "running";
    case "completed":
      return "done";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
    case "aborted":
      return "stopped";
    default:
      return null;
  }
}

/** 面板只列运行中 / 等待批准的 run（历史任务在 transcript 的 `task` 工具行里）。 */
export function isLiveSubrun(run: SubrunView): boolean {
  return run.status === "running" || run.status === "waiting";
}

/** 事件归约（唯一的状态迁移点）：started 建行；progress / step 就地更新；finished 落终态。
 *  未知 run 的 progress / step / finished 一律忽略——重载后的迟到事件不得凭空造行。 */
export function reduceSubruns(runs: readonly SubrunView[], event: SubrunEvent): SubrunView[] {
  switch (event.type) {
    case "subagent_started": {
      const next = runs.filter((run) => run.runId !== event.run_id);
      next.push({
        runId: event.run_id,
        agent: event.agent,
        description: event.description,
        model: event.model,
        background: event.background,
        status: "running",
        rounds: 0,
        toolCalls: 0,
        lastTool: null,
        steps: [],
        elapsedMs: 0,
        inputTokens: 0,
        cachedTokens: 0,
        outputTokens: 0,
        segments: 1,
        stoppedBy: null,
        deniedCalls: 0,
        summaryChars: 0,
        summary: null,
        approvalIds: [],
      });
      return next;
    }
    case "subagent_progress":
      return runs.map((run) =>
        run.runId === event.run_id
          ? {
              ...run,
              rounds: event.rounds,
              toolCalls: event.tool_calls,
              lastTool: event.last_tool,
              elapsedMs: event.elapsed_ms,
            }
          : run,
      );
    case "subagent_step":
      return runs.map((run) =>
        run.runId === event.run_id
          ? {
              ...run,
              lastTool: event.tool,
              steps: [...run.steps, { tool: event.tool, summary: event.summary }].slice(-20),
            }
          : run,
      );
    case "subagent_finished": {
      const status = subrunStatusOf(event.status);
      if (status === null) return [...runs];
      return runs.map((run) =>
        run.runId === event.run_id
          ? {
              ...run,
              agent: event.agent,
              model: event.model,
              status,
              stoppedBy: event.stopped_by ?? null,
              rounds: event.rounds,
              inputTokens: event.input_tokens,
              cachedTokens: event.cached_tokens,
              outputTokens: event.output_tokens,
              deniedCalls: event.denied_calls,
              elapsedMs: event.duration_ms,
              summaryChars: event.summary_chars,
              summary: event.summary ?? run.summary,
              segments: Math.max(1, run.segments),
              approvalIds: [],
            }
          : run,
      );
    }
  }
}

/** 挂起批准项 → 行状态（waiting）+ 关联 id。已有终态的 run 不再翻回等待（事件乱序的防线）。 */
export function attachRunApproval(
  runs: readonly SubrunView[],
  runId: string,
  approvalId: string,
): SubrunView[] {
  return runs.map((run) => {
    if (run.runId !== runId) return run;
    if (!isLiveSubrun(run)) return run;
    return {
      ...run,
      status: "waiting",
      approvalIds: run.approvalIds.includes(approvalId)
        ? run.approvalIds
        : [...run.approvalIds, approvalId],
    };
  });
}

/** 决策 / 收回后的关联清理：最后一个待批项消失时行状态回到 running（design §19.2：
 *  拒绝后行状态从「等待批准」回到「运行中」，子运行继续）。 */
export function detachRunApproval(
  runs: readonly SubrunView[],
  approvalId: string,
): SubrunView[] {
  return runs.map((run) => {
    if (!run.approvalIds.includes(approvalId)) return run;
    const approvalIds = run.approvalIds.filter((id) => id !== approvalId);
    const status = approvalIds.length === 0 && run.status === "waiting" ? "running" : run.status;
    return { ...run, approvalIds, status };
  });
}

/** 任务区标题（唯一读数出口）：有运行中 / 待批 → 计数段；全部收敛 → 本次会话摘要。
 *  没有运行中行且本次会话没有终态 run 时返回空串（整块不出现，空态不占位）。 */
export function taskHeadline(
  runs: readonly SubrunView[],
  lang: Language = currentLanguage(),
): string {
  const live = runs.filter(isLiveSubrun);
  const title = t("D477", undefined, lang);
  if (live.length > 0) {
    const waiting = live.filter((run) => run.status === "waiting").length;
    const background = live.filter((run) => run.status === "running" && run.background).length;
    const plain = live.length - waiting - background;
    const parts: string[] = [];
    if (plain > 0) parts.push(t("D478", { count: plain }, lang));
    if (background > 0) parts.push(t("D479", { count: background }, lang));
    let head = title;
    if (parts.length > 0) head += ` ${parts.join(" · ")}`;
    if (waiting > 0) head += ` · ${t("D480", { count: waiting }, lang)}`;
    return head;
  }
  const done = runs.filter((run) => run.status === "done").length;
  const partial = runs.filter((run) => run.status === "partial").length;
  const parts: string[] = [];
  if (done > 0) parts.push(t("D482", { count: done }, lang));
  if (partial > 0) parts.push(t("D483", { count: partial }, lang));
  if (parts.length === 0) return "";
  return `${title} · ${t("D481", { parts: parts.join(" · ") }, lang)}`;
}

/** 行状态词（终态词永不截断；`running` 走脉冲点承载，词只作读屏名）。 */
export function subrunStatusWord(status: SubrunStatus, lang: Language = currentLanguage()): string {
  switch (status) {
    case "running":
      return t("D484", undefined, lang);
    case "waiting":
      return t("D416", undefined, lang);
    case "done":
      return t("D485", undefined, lang);
    case "partial":
      return t("D486", undefined, lang);
    case "failed":
      return t("D487", undefined, lang);
    case "stopped":
      return t("D488", undefined, lang);
  }
}

/** 触顶原因词（`stopped_by` 的值域；未知值原样返回，不吞掉信息——诊断可知、界面可见）。 */
export function subrunStoppedByWord(reason: string, lang: Language = currentLanguage()): string {
  switch (reason) {
    case "rounds":
      return t("D501", undefined, lang);
    case "tokens":
      return t("D502", undefined, lang);
    case "time":
      return t("D503", undefined, lang);
    case "quota":
      return t("D504", undefined, lang);
    case "error":
      return t("D505", undefined, lang);
    default:
      return reason;
  }
}

/** 自动回合触顶提示行的文案（tasks §10.8）：`blocked` 的两种值各一句；点过「继续」后
 *  同一行换成结果句（不再显示按钮）。未触顶返回 null（提示行整行不出现）。 */
export function autoWakeAlertText(
  blocked: string | null,
  max: number,
  continued: boolean,
  lang: Language = currentLanguage(),
): string | null {
  if (continued) return t("D494", undefined, lang);
  if (blocked === "chain_limit") return t("D492", { max }, lang);
  if (blocked === "stopped") return t("D493", undefined, lang);
  return null;
}

/** 用时读数（短串：`48s` / `1m12s` / `1h05m`）。 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number): string => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}h${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m${pad(seconds)}s`;
  return `${seconds}s`;
}

/** 按模型用量区的一行（tasks §10.6）：键 = 模型 id，值 = `subrun_usage` 的一个桶。 */
export interface SubrunUsageRow {
  model: string;
  text: string;
}

/** `subrun_usage`（快照字段）→ 读数行。缺键 / 形状不识别的桶跳过（不伪造 0 读数）。 */
export function subrunUsageRows(
  usage: unknown,
  lang: Language = currentLanguage(),
): SubrunUsageRow[] {
  if (typeof usage !== "object" || usage === null) return [];
  const rows: SubrunUsageRow[] = [];
  for (const [model, bucket] of Object.entries(usage as Record<string, unknown>)) {
    if (typeof bucket !== "object" || bucket === null) continue;
    const value = bucket as Record<string, unknown>;
    const number = (key: string): number | null => {
      const raw = value[key];
      return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    };
    const input = number("input");
    const output = number("output");
    if (input === null || output === null) continue;
    rows.push({
      model,
      text: t(
        "D507",
        {
          input: formatTokenCount(input),
          cached: formatTokenCount(number("cached") ?? 0),
          output: formatTokenCount(output),
          segments: number("segments") ?? 0,
        },
        lang,
      ),
    });
  }
  rows.sort((a, b) => a.model.localeCompare(b.model));
  return rows;
}

/** 后台完成通知的一个 run 行（`notice` 事件的 `runs[]`）。 */
export interface NoticeRunView {
  runId: string;
  agent: string;
  description: string;
  status: string;
  stoppedBy: string | null;
  summary: string;
}

/** `notice` 事件 / 快照通知行的载荷宽容解析。 */
export function noticeRunsOf(raw: unknown): NoticeRunView[] {
  if (!Array.isArray(raw)) return [];
  const runs: NoticeRunView[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.agent !== "string") continue;
    runs.push({
      runId: typeof item.run_id === "string" ? item.run_id : "",
      agent: item.agent,
      description: typeof item.description === "string" ? item.description : "",
      status: typeof item.status === "string" ? item.status : "",
      stoppedBy: typeof item.stopped_by === "string" ? item.stopped_by : null,
      summary: typeof item.summary === "string" ? item.summary : "",
    });
  }
  return runs;
}

/** 通知头：单条点名 agent，多条说明「已合并为一条」（design §19.3）。 */
export function noticeHeadline(runs: readonly NoticeRunView[], lang: Language = currentLanguage()): string {
  if (runs.length === 1) return t("D514", { agent: runs[0]?.agent ?? "" }, lang);
  return t("D515", { count: runs.length }, lang);
}

/** 通知里的单个 run 行：`agent · description — 状态（触顶原因）— 摘要首行`。
 *  状态词与行状态共用 `subrunStatusWord`，不另写一份。 */
export function noticeLineText(run: NoticeRunView, lang: Language = currentLanguage()): string {
  const status = subrunStatusOf(run.status);
  const statusWord = status === null ? run.status : subrunStatusWord(status, lang);
  const statusPart =
    run.stoppedBy !== null
      ? t("D518", { status: statusWord, reason: subrunStoppedByWord(run.stoppedBy, lang) }, lang)
      : statusWord;
  const summary = run.summary.trim();
  const head = run.description === "" ? run.agent : `${run.agent} · ${run.description}`;
  return summary === "" ? `${head} — ${statusPart}` : `${head} — ${statusPart} — ${summary}`;
}

/** 快照恢复路径的通知正文解析（`role: "notice"` 的 `text` 是后端渲染好的展示串：
 *  固定前缀一句 + 每个 run 一行 `- agent（description）：status — summary` + 固定收尾一句）。
 *  解析失败（零 `- ` 行）时返回空数组，调用方回落「整段原文上屏」——不丢内容、不伪造结构。 */
export function parseNoticeDisplayText(text: string): NoticeRunView[] {
  const runs: NoticeRunView[] = [];
  for (const line of text.split("\n")) {
    const match = /^-\s*(.+?)（(.*?)）：(.*)$/.exec(line.trim());
    if (match === null) continue;
    const [, agent, description, tail] = match;
    const split = /^(.*?)(（(.+)）)?(?:\s+—\s+(.*))?$/.exec(tail);
    const statusText = (split?.[1] ?? tail).trim();
    const stoppedBy = split?.[3] ?? null;
    const summary = (split?.[4] ?? "").trim();
    runs.push({
      runId: "",
      agent: agent ?? "",
      description: description ?? "",
      status: statusText,
      stoppedBy,
      summary,
    });
  }
  return runs;
}

/** 批准请求的发起者（ipc 的 `ApprovalSource` 结构子集；宽容解析）。 */
export function parseApprovalSource(value: unknown):
  | { kind: "interactive" }
  | { kind: "subrun"; agent: string; run_id: string; description: string }
  | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  if (source.kind === "interactive") return { kind: "interactive" };
  if (source.kind === "subrun" && typeof source.run_id === "string") {
    return {
      kind: "subrun",
      agent: typeof source.agent === "string" ? source.agent : "",
      run_id: source.run_id,
      description: typeof source.description === "string" ? source.description : "",
    };
  }
  return null;
}

export function createHarnessPanel(deps: HarnessPanelDeps): HarnessPanelHandle {
  const { shell, editor } = deps;

  // SVG 命名空间在模块层（`SVG_NS`）：块级全屏钮的四角框图标由模块层的渲染件建，
  // toggle 火花 / 发送钮两态 glyph / 工具 ✓ / 思考 chevron 与本函数共用同一份常量。

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
  // MUST NOT 挂容器级元素（REVIEW.md 「标题栏 preventDefault」条）。
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
  // 初始收起态也走唯一写入口（M442）：`hidden` 与 `aria-expanded` 两面同源派生。
  applySessPop(false);
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

  // ── transcript 视口层 + 「回到底部」浮钮（M644，change improve-harness-streaming-scroll §4）──
  // 浮钮 MUST NOT 放进 `.lumir-hp-transcript` 内容流：那是滚动容器，绝对定位的子节点会随内容
  // 滚出视口（消息摘录钮是「跟选区走」的相反需求，定位口径不可复用）。因此 transcript 外包一层
  // 视口层做定位基准——盒模型逐值不动（视口层接管 transcript 原来的 flex 位，transcript 在层内
  // 继续吃满），既有视觉基线在浮钮 hidden 时零像素漂移。
  const transcriptViewport = document.createElement("div");
  transcriptViewport.className = "lumir-hp-transcript-viewport";

  const transcript = document.createElement("div");
  transcript.className = "lumir-hp-transcript";
  // preview 主题 scope 镜像：cm-lp-tok-* 着色与 cm-lp-inline-code 药丸的规则值只定义在
  // src/preview/theme.ts 一处，这里只搬 scope 类（机制与守卫见 src/overlay-scope.ts）。
  mirrorThemeScope(editor.view.dom, transcript, "lumir-hp-transcript");
  // 面板里的块级全屏（M634）来源在编辑器根之外：transcript 带上「已镜像宿主」标记，遮罩的
  // 主题 scope 据此取到同一批 CM 生成类（解析见 src/overlay-scope.ts）。标记必须在镜像之后
  // 加——`mirrorThemeScope` 会按「基类 + 镜像类」重写容器的 className。
  transcript.classList.add(THEME_SCOPE_HOST_CLASS);

  // 「回到底部」浮钮（M644）：脱离态的常驻导航件，浮在视口层右下角、不随内容滚动。默认
  // hidden（只有脱离态才出现，D2）；可键盘聚焦（Tab 到它 + Enter 回底，D4 不新增键位）。
  const jumpBottom = document.createElement("button");
  jumpBottom.type = "button";
  jumpBottom.className = "lumir-hp-jumpbottom";
  jumpBottom.hidden = true;
  // 图标 = ↓（DOM API 构造，本模块无 innerHTML 的渲染纪律；与发送钮 glyph 同一条构造口径）。
  const jumpBottomIcon = document.createElementNS(SVG_NS, "svg");
  jumpBottomIcon.setAttribute("width", "11");
  jumpBottomIcon.setAttribute("height", "11");
  jumpBottomIcon.setAttribute("viewBox", "0 0 12 12");
  jumpBottomIcon.setAttribute("fill", "none");
  jumpBottomIcon.setAttribute("stroke", "currentColor");
  jumpBottomIcon.setAttribute("stroke-width", "1.6");
  jumpBottomIcon.setAttribute("stroke-linecap", "round");
  jumpBottomIcon.setAttribute("stroke-linejoin", "round");
  jumpBottomIcon.setAttribute("aria-hidden", "true");
  const jumpBottomPath = document.createElementNS(SVG_NS, "path");
  jumpBottomPath.setAttribute("d", "M6 2v8M2.5 6.5 6 10l3.5-3.5");
  jumpBottomIcon.append(jumpBottomPath);
  // 未读圆点（D3）：布尔提示，不是计数；`aria-hidden`——可访问名随未读态变化，屏幕阅读器
  // 从名字感知（design §4.3）。
  const jumpBottomDot = document.createElement("span");
  jumpBottomDot.className = "lumir-hp-jumpbottom-dot";
  jumpBottomDot.setAttribute("aria-hidden", "true");
  jumpBottom.append(jumpBottomIcon, jumpBottomDot);
  transcriptViewport.append(transcript, jumpBottom);

  // 块级全屏的渲染期接线（change add-harness-block-fullscreen）：模块层的渲染件不认识面板根，
  // 装配层按**来源**（发起钮）推导主题 scope 宿主——trigger 在 transcript 内，遮罩自己会走到
  // 上面那块「已镜像宿主」。
  // 端口未注入时 `deps.blocks` 为空——钮照常渲染、点击无动作（与触发钮 widget 的 opener 同口径）。
  const blockOpeners: HarnessBlockOpeners = {
    code: (render, label, trigger) => deps.blocks?.openCodeBlock(render, label, trigger),
    table: (source, label, trigger) => deps.blocks?.openTable(source, label, trigger),
  };

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
  // 可聚焦但不在 Tab 序里（-1）：重建窗口内的焦点停靠点，见 rebuildFocusKey 的说明。
  selPop.tabIndex = -1;
  selPop.hidden = true;
  // effort 不支持的 hover hint（D394，ctxPop 同款 hover 泡）：只挂读数那一格，mouseenter
  // 翻出、mouseleave 收回。
  const effHint = document.createElement("div");
  effHint.className = "lumir-hp-effhint";
  effHint.hidden = true;
  modelChip.append(modelName, modelSep, effReading, modelChev);
  modelWrap.append(modelChip, selPop, effHint);

  // 权限 chip（M414，change add-harness-permission-modes design §7）：控制行**第三位**
  //（合并选择器 chip 之后、ctx 读数之前）。chip 面 = **短名**（D423–D425：只读 / 可写 / 完全），
  // 点开的浮层里才是**全名 + 每档一行释义**（Alex 2026-10-09 裁决：控制行要被两个 chip 与
  // ctx 读数共同挤占，短名才保证三档都完整显示）。形态逐值沿用合并 chip 配方（无边框小标签、
  // 24px 高、r5、fs-label-s、text-2、hover 给底、chevron ▾），chip + 浮层同挂 wrapper
  //（M351 的 a11y 修复口径：浮层 MUST NOT 嵌在 <button> 内，WKWebView 才暴露浮层项）。
  // chip 隐藏判据 = harness 段不在场（config_get 失败 / 桩环境）——档位本身有明确缺省
  //（vault_write），故「读到什么」不构成隐藏理由。
  const permWrap = document.createElement("span");
  permWrap.className = "lumir-hp-permwrap";
  const permChip = document.createElement("button");
  permChip.type = "button";
  permChip.className = "lumir-hp-perm";
  permChip.setAttribute("aria-haspopup", "menu");
  permChip.setAttribute("aria-expanded", "false");
  permChip.hidden = true; // 配置到达前不显示（config_get 的 then 里翻）
  const permName = document.createElement("span");
  permName.className = "lumir-hp-perm-name";
  const permChev = document.createElement("span");
  permChev.className = "lumir-hp-perm-chev";
  permChev.setAttribute("aria-hidden", "true");
  permChev.textContent = "▾"; // i18n-exempt: glyph（下指 chevron 图形，非文案）
  // 权限浮层：单浮层三档单选（与合并浮层同一视觉语言——项 = menuitemradio + check 格 +
  // 当前档 accent-tint 底），每档一行释义挂全名之下。
  const permPop = document.createElement("div");
  permPop.className = "lumir-hp-permpop";
  permPop.setAttribute("role", "menu");
  // 可聚焦但不在 Tab 序里（-1）：重建窗口内的焦点停靠点，见 rebuildFocusKey 的说明。
  permPop.tabIndex = -1;
  permPop.hidden = true;
  permChip.append(permName, permChev);
  permWrap.append(permChip, permPop);

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
  ctl.append(modelWrap, permWrap, ctxWrap, ctlSpacer, sendButton);
  // 引用失败的持久留痕（M662，Alex 2026-10-24 反馈 #3 / survey §2.4）：卡片能挂留痕时挂在
  // 卡片的出处行（D586），但「只有图片、没有文本卡片」的引用（图片悬停引用钮 / 只选图片）
  // 没有可挂的卡——状态行落在输入区上方，直到下一次引用 / 发送 / 切会话。呈现复用出处行的
  // 小字样式（不新增样式面），`role="status"` 让读屏也听到。
  const quoteNote = document.createElement("div");
  quoteNote.className = "lumir-hp-qc-src lumir-hp-quote-note";
  quoteNote.setAttribute("role", "status");
  quoteNote.hidden = true;
  composerBox.append(composer, ctl);
  composerArea.append(chip, quoteNote, composerBox);

  /** 输入区失败状态行：`text` = 已渲染的人话（D586），null = 收起。面板生命周期内只由引用
   *  事务与发送 / 切会话改写（不做自动消隐——「持久可见」正是本条的目的）。 */
  function applyQuoteFailureNotice(text: string | null): void {
    quoteNote.textContent = text ?? "";
    quoteNote.hidden = text === null;
  }

  /** 引用失败的人话读数（D586）：卡片出处行与输入区状态行共用同一份渲染。 */
  function quoteFailureText(count: number): string {
    return tPlural("D586", count, { n: String(count) });
  }

  // ── 任务区（change add-harness-subagents tasks §10，M590；原型 subagents-tasks.html）──
  // 位置：composer 之上、transcript 之下。只列运行中 / 等待批准的 run（历史任务在
  // transcript 的 `task` 工具行里，两处各留一份等于双读数）；全部收敛后收敛为一行摘要 +
  // 按模型用量块；没有子运行任务时整块不出现（空态不占位）。触顶提示行在任务区顶部，
  // 视觉与 run 行区分（不冒充 run 行、不参与计数）。
  const taskArea = document.createElement("section");
  taskArea.className = "lumir-tp";
  taskArea.hidden = true;
  const taskAlert = document.createElement("div");
  taskAlert.className = "lumir-tp-alert";
  taskAlert.hidden = true;
  const taskAlertText = document.createElement("span");
  taskAlertText.className = "lumir-tp-alert-text";
  const taskAlertButton = document.createElement("button");
  taskAlertButton.type = "button";
  taskAlertButton.className = "lumir-tp-mini";
  taskAlertButton.textContent = t("D491");
  taskAlertButton.hidden = true;
  taskAlert.append(taskAlertText, taskAlertButton);
  const taskHead = document.createElement("button");
  taskHead.type = "button";
  taskHead.className = "lumir-tp-head";
  const taskTitle = document.createElement("span");
  taskTitle.className = "lumir-tp-title";
  const taskChev = document.createElement("span");
  taskChev.className = "lumir-tp-chev";
  taskChev.setAttribute("aria-hidden", "true");
  taskChev.textContent = "▾"; // i18n-exempt: glyph（下指 chevron 图形，非文案）
  taskHead.append(taskTitle, taskChev);
  const taskList = document.createElement("div");
  taskList.className = "lumir-tp-list";
  const taskUsage = document.createElement("div");
  taskUsage.className = "lumir-tp-usage";
  taskUsage.hidden = true;
  taskArea.append(taskAlert, taskHead, taskList, taskUsage);

  panel.append(transcriptViewport, progress, taskArea, composerArea);

  // ── 跟随滚动控制器（M644，change improve-harness-streaming-scroll design §2/§3）──────────
  // 判据与写底编排全在 `src/harness-scroll-lock.ts`（纯模型层，单一真源）：这里只是适配器——
  // 读三个滚动读数、写回唯一入口、把写底推迟到 rAF、把态 / 未读交给浮钮呈现。面板里 MUST NOT
  // 再写一份阈值或比较（REVIEW.md「同一语义两处真源」条）。
  const follow = createFollowController({
    read: () => ({
      scrollTop: transcript.scrollTop,
      clientHeight: transcript.clientHeight,
      scrollHeight: transcript.scrollHeight,
    }),
    writeScrollTop: (top) => {
      transcript.scrollTop = top;
    },
    schedule: (cb) => {
      requestAnimationFrame(cb);
    },
    render: applyJumpBottomState,
  });

  /** 浮钮的唯一施加点（态 / 未读每次变化只走这里；`applyLabels` 重取文案时也走这里）。 */
  function applyJumpBottomState(state: FollowState): void {
    jumpBottom.hidden = state.phase !== "detached"; // D2：脱离即显示，无论有没有新内容
    jumpBottom.classList.toggle("is-unread", state.unread);
    const label = state.unread ? t("D556") : t("D555");
    jumpBottom.title = label;
    jumpBottom.setAttribute("aria-label", label);
  }

  // scroll 监听的唯一用途 = 按几何位置换态（passive：不阻止滚动、不进键盘路径；ADR 0002 §6）。
  // MUST NOT 在事件回调里同步写底——那会把写底挪到 scroll 事件之前（design §3.2）。
  transcript.addEventListener("scroll", () => follow.onScroll(), { passive: true });

  // 视口尺寸变化（窗口缩放 / 分栏拖拽 / 左栏宽度变化引起的重排）：跟随态补一次贴底，脱离态
  // 零写入。观察 transcript **自身的盒**——内容高度增长不改变盒尺寸，因此不与流式 rAF 的
  // 未读补扫重复（design §3.4）。面板单例长驻，构造期注册、不随 attach / detach 增删。
  const transcriptResize = new ResizeObserver(() => follow.viewportChanged());
  transcriptResize.observe(transcript);

  jumpBottom.addEventListener("click", () => {
    const wasFocused = document.activeElement === jumpBottom;
    follow.jumpToBottom();
    // 钮点击后自身隐藏；隐藏前若持有焦点（键盘 Enter / Chromium 下鼠标点击都会让钮获焦），
    // 把焦点交还 composer——否则焦点落到 body，键盘用户失去键入落点（design §4.3）。
    if (wasFocused) composer.focus();
  });

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
  /** cache 主读数 = **本逻辑会话累计命中率**（M443 改准语义，原 M370 的单回合值；usage 事件 /
   *  快照的 `cache_pct_session` 字段消费；null = 读数缺失（旧事件 / 桩）——回落单读数
   *  「{ctx}%」，不伪造 cache 值）。 */
  let lastCache: number | null = null;
  /** 本回合单回合命中率（M443；**M533 起无上屏消费点**——降级到只随 wire 留存可查，
   *  控制行与气泡都不显示；读数映射保留原位，前端投影仍是载荷的完整一份）。 */
  let lastCacheTurn: number | null = null;
  /** 本回合成因标注（M443，后端判定的值：`cold_start` / `block_dilution`；M533 起无上屏
   *  消费点——成因句随本回合行一并退场）。 */
  let lastCacheNote: "cold_start" | "block_dilution" | null = null;
  /** 本回合缓存写入 tokens 与本文逻辑会话累计（M443；**M533 起无上屏消费点**——缓存写入行
   *  退场，两个数仍随 `llm_response.usage` 进 wire 留存）。 */
  let lastCacheWrite: number | null = null;
  let lastCacheWriteSession: number | null = null;
  /** 最近一次往返的 input tokens（M526，气泡「上下文已用」绝对值；null = 旧载荷缺键，气泡
   *  降级回百分比形态 D395，不编造 tokens）。 */
  let lastInputTokens: number | null = null;
  /** 最近一次往返的 cached tokens（M526；**M533 起无上屏消费点**——本回合命中行退场）。 */
  let lastCachedTokens: number | null = null;
  /** 本逻辑会话累计 cached tokens（M526；**M533 起无上屏消费点**——命中率行只出百分比）。 */
  let lastCachedTokensSession: number | null = null;
  /** ctx% 的分母（M526：当时算读数用的模型上下文窗口；null = 旧载荷缺键；0 = 无上限值——
   *  气泡不显示百分比与上限，走降级文案）。 */
  let lastContextWindow: number | null = null;
  /** 是否已有带 usage 的往返（M526，载荷 `has_usage`；false = 从未发过请求的会话——六键零值
   *  是缺省不是读数，读数区整体隐藏，否则即成「0% · 0%」虚报；null = 旧载荷缺键，维持旧行为）。 */
  let lastHasUsage: boolean | null = null;
  /** 上下文用量警示阈值（快照 warn_ctx_pct，缺省 85——与 Rust 侧 DEFAULT_WARN_CTX_PCT 同值）。 */
  let warnCtxPct = 85;
  /** 面板当前生效的字号缩放比（M627）：由装配层按**编辑器的那一套字号**给出
   *  （`textScaleRatio(当前字号, 配置基线)`，1 = 基线），面板不再自持字号档位——「一套字号
   *  设置，无论焦点在哪，两个 pane 一起变」。经 --lumir-hp-scale 施加（单一写入路径，见
   *  writeTextScale）：css 的全部 font-size 声明 calc 乘该变量（缺省 1 = 零缩放，逐字节
   *  不改基线观感）。运行期态、不落盘、不回写 config。 */
  let hpScale = 1;
  /** 合并选择器状态（config_get 宽容提取的 HarnessSelection；null = 未配置/读不到——
   *  桩环境 / 旧配置 / 读取失败不伪造读数，chip 隐藏）。 */
  let selSelection: HarnessSelection | null = null;
  /** 思考程度状态（M363，harness_state 快照 `thinking` 字段的宽容提取；档位会话内
   *  生效、不写回配置；随合并 chip 呈现，thinkConfigured = false 时 effort 读数留空）。 */
  let thinkConfigured = false;
  let thinkLevel = "";
  let thinkSupported = false;
  /** 权限模式状态（M414）：permissionConfigured = harness 段是否在场（不在场 = 桩环境 /
   *  config_get 失败，chip 隐藏，不显示一个读不到的档）；permMode = 当前生效档（闭集合外
   *  取值 / 缺键按后端同款口径回落默认 `vault_write`）。写回失败回滚本值。 */
  let permissionConfigured = false;
  let permMode: PermissionMode = "vault_write";
  /** 已记住的持久权限规则（change harness-permission-rules-oct23）：权限浮层底部那段的数据
   *  源。**打开浮层时从配置现读**（`refreshPermissionRules`），MUST NOT 用前端旧值呈现；
   *  段为空时整段不渲染。 */
  let permissionRules: string[] = [];
  let lastChip: HarnessContextBlock | null | "none" = null;
  /** 当前逻辑会话的首条用户消息原文（会话名回落口径：截断约 20 字上屏；null = 未发消息，
   *  显示「新会话」）。自动压缩开新逻辑会话后归 null，按同口径重算（design §3）。 */
  let firstUserText: string | null = null;
  /** 当前逻辑会话的有效标题（change add-session-auto-naming，design D11）：唯一来源是后端
   *  （`harness_state.title` 快照 / `title` 事件 / 会话清单 `title`）——前端 MUST NOT 自行
   *  生成或猜测。非空时优先于 `firstUserText` 显示（标题已受 20 码点硬上限，不带省略号）。 */
  let sessionTitle: string | null = null;
  let streamingEl: HTMLElement | null = null;
  /** 本轮完整正文源（全部文本段的拼接）——复制源用；分段渲染不改变它。 */
  let streamingText = "";
  /** 轮次闸门（M374）：sent 开、done / aborted / error 关。关闭期间到达的内容事件
   *  （text_chunk / reasoning_chunk / tool_call / usage / compact）一律丢弃——已取消
   *  （或已结束）的轮次迟到产出不得再进消息流。已知边界：webview 重载后在途轮次没有
   *  快照标记可重建本闸门，该轮的流式产出会被丢弃（如实登记，不伪造「正在运行」）。 */
  let turnOpen = false;
  /** cron 点击运行的面板切屏态（M612）：`beginCronRun` 置位，done 收尾后据此按后端快照重载
   *  一次（专用会话的历史回屏）。它不是会话状态，只是「这一轮由点击发起」的登记。 */
  let cronRunAdopted = false;
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
  // ── 子代理任务区状态（tasks §10，M590）────────────────────────────────────
  /** 本会话可见的 run（按 started 到达序；终态保留在表里供本次会话摘要与用量区）。 */
  let subruns: SubrunView[] = [];
  /** 展开中的行（点击行头切换；待批行强制展开——阻塞决策不藏在折叠区里）。 */
  const openRuns = new Set<string>();
  /** 任务区折叠态（标题行仍在；折叠只收列表与用量块）。 */
  let taskCollapsed = false;
  /** 子运行透传的批准项（id → runId + 元素）；与父会话的 `pendingApprovals` 分表管理——
   *  两条呈现路径（transcript 卡 / 任务行卡）互不干扰。 */
  const taskApprovals = new Map<string, { runId: string; request: TaskApprovalRequest }>();
  /** 已决策的子运行批准（行内终态记录；run 收尾后随行消失）。 */
  const taskDecisions = new Map<string, Array<{ tool: string; approved: boolean; reason?: string }>>();
  /** 已决策 / 已失效的批准 id：快照刷新可能比后端处理决策更早返回，不得把旧卡再挂回来。 */
  const taskDecidedApprovals = new Set<string>();
  /** 任务区已建的行元素（按 runId；行头 + 详情两段，就地更新不重建）。 */
  const runRowEls = new Map<string, RunRowEls>();
  /** 自动唤醒快照（`harness_state.auto_wake`；提示行的数据源）。 */
  let autoWake: { chain: number; max: number; blocked: string | null } = {
    chain: 0,
    max: 5,
    blocked: null,
  };
  /** 点了「继续」后的就地结果句（提示行换文案、按钮退场；下一次触顶再恢复）。 */
  let wakeContinued = false;
  /** 子运行用量分桶（`harness_state.subrun_usage`；父会话控制行读数不掺这些数字）。 */
  let subrunUsage: unknown = null;
  /** transcript 里 `task` 工具行的绑定表（runId ↔ 行；历史任务详情的挂点）。 */
  const taskRowEntries: TaskRowEntry[] = [];
  /** 快照刷新世代（任务区状态与 transcript 分开刷新：只应用读数类字段，不重放消息）。 */
  let taskStateSeq = 0;
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
  /** 可点 vault 文件路径索引（change harness-path-link）：装配层经 `setPathLinkIndex` 下发，
   *  渲染时同步查询（零 IPC——流式尾块每帧重渲，逐帧 IPC 会闪烁）。空集 = 不链接化（未装载 /
   *  单测）。集合语义（文件 + 非惰性 + 可打开）由装配层按既有索引与打开分类裁定，面板只查表。
   *  目录不走这份集合（change harness-dir-link）：`isDir` 直接问装配层注入的文件树查询——
   *  目录可点性与左栏定位使用同一份模型，不另维护第二份索引。 */
  let pathLinkPaths: ReadonlySet<string> = new Set();
  const pathLinks: PathLinkRenderContext = {
    isFile: (path) => pathLinkPaths.has(path),
    isDir: (path) => deps.isVaultDir(path),
    openFile: (path, line) => deps.openVaultPath(path, line),
    revealDir: (path) => deps.revealVaultDir(path),
  };
  /** 工具卡片目标 → 类型（文件先、目录后，与候选层的解析顺序同一口径）。结构化参数里的路径
   *  不做尾斜杠归一（参数是精确值）；目录参数只可能在参数恰好写成目录路径时出现。 */
  function pathKindOf(path: string): PathLinkTarget["kind"] | null {
    if (pathLinks.isFile(path)) return "file";
    return pathLinks.isDir(path) ? "dir" : null;
  }
  /** 快照请求的世代号：只应用**最新一次**请求的结果。挂载那一次拉取与切 vault 的那一次可能
   *  同时在飞——迟到的旧响应会把已经清空的 transcript 又灌回旧 vault 的消息，或把同一份
   *  消息追加两遍（两条都是可见的错乱）。 */
  let snapshotSeq = 0;

  // ── 混排 composer 状态（M343；消息摘录卡片见 change harness-message-excerpt；
  //    图片卡片见 change harness-composer-image-paste） ──
  /** 卡片数据寄存：DOM 只负责渲染，卡片数据（单一真源，design §3）经 WeakMap 挂回元素——
   *  序列化只从模型读，不从 DOM 反推。三类卡片（quote / msgquote / image）共用一个寄存：
   *  判别走 isMessageQuoteCard（role 字段）与 isImageCard（sourceMime 字段）。 */
  const cardData = new WeakMap<Element, QuoteCard | MessageQuoteCard | ImageCard>();
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
  /** IME 组合门状态机（M361 确认拍拦截门；HC5 的组合窗判据复用它，不另建第二份组合状态）。
   *  声明提前到这里：normalize / withModel 的组合窗闸门（HC5）要读它，早于事件挂点初始化。 */
  let imeGateState = imeKeyGate();
  /** QC3（M344）注册的卡片跳回处理器；未注册时卡片点击无操作。 */
  let quoteJumpHandler: ((card: QuoteCard) => void) | null = null;

  // ── composer 草稿（change composer-draft-persistence，design §4/§5/§7）──────────────
  /** 防抖写控制器（零 DOM 逻辑在 `src/harness-draft.ts`，这里只接三个口子：读
   *  `harness_draft_get` / 写 `harness_draft_put` / 失败提示走装配层 toast——错误信封按 code
   *  取 D456，本面板不自造文案）。落点按后端当前 vault scope 解析，前端不持有 vault id。 */
  const draft = createHarnessDraftStore({
    getDraft: () => harnessDraftGet(),
    putDraft: (draftJson) => harnessDraftPut(draftJson),
    warn: (e) => deps.toast(errorText(e)),
  });
  /** 草稿装载世代：读盘在途时又切了一次 vault，旧结果作废（与快照的 snapshotSeq 同口径——
   *  store 内部另有一道世代守它自己的状态，这条守的是**渲染**）。 */
  let draftSeq = 0;

  /** 内容变化后把当前块序列 + 光标落位交给防抖控制器（内容没变则不排期）。挂点见
   *  withModel / undo / redo / input / compositionend——它们是「模型被改」的全部出口。 */
  function markDraft(): void {
    const sel = caretFromDom();
    draft.schedule(readBlocksFromDom(), sel === null ? null : sel.focus);
  }

  /** 离散 flush：把待写内容立刻落盘（输入区失焦 / 面板关闭 / 窗口失焦 / 退出）。防抖是主
   *  路径，这些是补漏——切走之后就再没有「当前 vault」这个上下文可写了（design §4）。
   *
   *  **为什么 flush 挂点在离开输入区这一类时点、而不是 `vaultChanged` 里**：`vaultChanged`
   *  由装配层在**后端已经切完 vault 之后**调用（`applyVault` 跑在 `vault_open_path` 之后），
   *  那一刻写入会按**新** vault 解析落点，把旧 vault 的草稿写进新 vault 的文件（跨 vault
   *  串台）。而「待写存在」蕴含「输入区持焦」——落盘由编辑触发、编辑要求输入区持焦，且任何
   *  一次离焦都会走本函数写走——于是切 vault 必经的「先离开输入区」就是那个时点。
   *  `vaultChanged` 里因此只做「丢弃旧 vault 的待写 + 装载新 vault 的草稿」。 */
  function flushDraft(): void {
    void draft.flush();
  }

  /** composer 是否还是「刚装载完」的原始空态（一个空段落）。恢复草稿前的**用户已动手**判据：
   *  读盘是一次 IPC 往返，用户可能在这段窗口里已经开始输入——那就不许用盘上的旧内容覆盖他。 */
  function composerIsPristine(): boolean {
    return (
      composer.childElementCount === 1 &&
      composer.querySelector(".lumir-hp-qcard") === null &&
      composer.textContent === ""
    );
  }

  // 窗口级离散 flush（design §4 的「窗口失焦 / 退出」）：面板是长驻单例，这两条监听随构造
  // 注册一次，与装配层 `src/main.ts` 的 beforeunload（标签会话 / 阅读位置同一批）并列——
  // 各模块 flush 自己那份状态，互不代管。best-effort：invoke 是异步的，webview 拆除可能早于
  // 它完成（与装配层那条同一条边界，防抖写入是主路径）。
  window.addEventListener("blur", flushDraft);
  window.addEventListener("beforeunload", flushDraft);

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

  /**
   * 消息摘录卡的出处行（change harness-message-excerpt design §7）：「对话 · 角色」。角色词复用
   * who 行同一份 D385/D386（同一语义一条串——换新词就是在同一面板里给同一角色起第二个名字）。
   */
  function messageQuoteSourceText(card: MessageQuoteCard): string {
    return t("D442", { role: t(card.role === "user" ? "D385" : "D386") });
  }

  /** 消息摘录卡的 hover title：完整摘录 + 来源消息绝对时间（本地化短格式；无 at 时只给摘录）。 */
  function messageQuoteHoverTitle(card: MessageQuoteCard): string {
    if (card.at === null) return card.text;
    return `${card.text} —— ${formatDate(new Date(card.at), "short")}`;
  }

  // ── 图片卡片（change harness-composer-image-paste design §3/§7/§8） ──────────
  /** 卡片数据判别：`sourceMime` 是 ImageCard 独有字段（QuoteCard / MessageQuoteCard 无）。 */
  function isImageCard(card: QuoteCard | MessageQuoteCard | ImageCard): card is ImageCard {
    return "sourceMime" in card;
  }

  /** 缩略图 blob URL 缓存（name → URL / null=读回失败）。渲染每次整面重跑（逐键击），
   *  读回命令必须只发一次——成功缓存 URL、失败缓存 null（占位 + 每图仅一次的 toast）。
   *  面板生命周期内不 revoke（卡片移除后 URL 留在缓存，下次贴同一张图直接命中）。 */
  const imageThumbCache = new Map<string, string | null>();
  /** 引用来源（图片名 → vault 相对路径，change add-image-quote-to-chat design §4.2）：人侧
   *  hover title 专用，面板生命周期内有效；不进卡片数据 / 序列化 / 投递 / 草稿。内容寻址名
   *  相同 = 同字节，同一名字被粘贴与引用各来一次时显示哪个来源都对人不构成误导。 */
  const imageSourceOf = new Map<string, string>();
  /** 能力闸拒绝过的图片名（design §6 的错误态）：渲染整面重跑会把 DOM class 丢掉，
   *  错误态因此按名记在模型侧，卡片重建（键入触发重渲）后依旧标出；发送成功才清除。 */
  const imageGateErrored = new Set<string>();
  /** 引用失败的张数（quote 卡片对象 → 未引用张数；M662）：与 `imageSourceOf` 同档的人侧
   *  呈现态——卡片数据模型不存它（design §4.2 的「图片块只有一种形态」不变），整面重渲按
   *  同一份表重建留痕；草稿 / 会话留存不带它（恢复出的卡片没有「刚刚失败」这回事）。 */
  const quoteImageFailures = new WeakMap<QuoteCard, number>();

  /** 图片卡片的缩略图字节加载（harness_read_image → base64 → blob URL，异步）。`onImgLoad`
   *  在成功挂出的 `<img>` load 后回调（恢复路径补记宽高用，见 createImageCardEl）。 */
  function loadImageThumb(
    name: string,
    thumb: HTMLElement,
    onImgLoad: (img: HTMLImageElement) => void,
  ): void {
    const cached = imageThumbCache.get(name);
    if (cached !== undefined) {
      applyImageThumb(name, cached, thumb, onImgLoad);
      return;
    }
    thumb.classList.add("is-loading");
    harnessReadImage(name)
      .then((base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
        // 回读 MIME 走注册表派生（`attachmentMimeOfName`，与后端 `mime_of_name` 同一份落盘
        // 扩展名表）——M662 起不再在这里写 `endsWith(".jpg") ? jpeg : webp` 的第二份判定。
        const url = URL.createObjectURL(new Blob([bytes], { type: attachmentMimeOfName(name) }));
        imageThumbCache.set(name, url);
        applyImageThumb(name, url, thumb, onImgLoad);
      })
      .catch((e: unknown) => {
        imageThumbCache.set(name, null);
        applyImageThumb(name, null, thumb, onImgLoad);
        deps.toast(t("D446", { reason: errorMessage(e) }));
      });
  }

  /** 缩略图加载的落盘面：成功换 <img>，失败/无缓存给可见占位（零高度空白不接受，design §8）。 */
  function applyImageThumb(
    name: string,
    url: string | null,
    thumb: HTMLElement,
    onImgLoad: (img: HTMLImageElement) => void,
  ): void {
    // 渲染整面重跑后元素可能已换——按缓存名校验：读回完成时 thumb 已重建则只写缓存。
    if (thumb.dataset.thumbName !== name) return;
    thumb.classList.remove("is-loading");
    // 只清掉上一次的缩略内容，**保留编号徽标**（徽标是卡片结构的一部分，不是缩略内容）。
    for (const child of [...thumb.children]) {
      if (!child.classList.contains("lumir-hp-qc-ord")) child.remove();
    }
    if (url !== null) {
      const img = document.createElement("img");
      img.className = "lumir-hp-qc-img";
      img.src = url;
      img.alt = "";
      img.setAttribute("aria-hidden", "true");
      img.addEventListener("load", () => onImgLoad(img));
      thumb.append(img);
    } else {
      // 读回失败占位：CSS 画虚线框 + 「?」（零高度空白不接受，design §8）。
      thumb.classList.add("is-broken");
    }
  }

  /** 编号徽标（change composer-image-mention design §8）：缩略图角上的裸编号 `1` / `2`；读屏名与
   *  transcript 卡片的可访问名同一文案（D447 含编号形态）。编号是块序列的派生读数，非卡片字段。 */
  function createImageOrdinalBadge(ordinal: number, name: string): HTMLElement {
    const badge = document.createElement("span");
    badge.className = "lumir-hp-qc-ord";
    badge.textContent = String(ordinal);
    badge.setAttribute("aria-label", t("D447", { n: String(ordinal), name }));
    return badge;
  }

  /**
   * 图片卡片的「插入引用」钮（`@` 形态；change composer-image-mention design §4）：点击在**当前
   * 光标处**插入该图的引用文本 `Image N`（N = 该卡在点击时的编号）——走既有 `insertPlainTextAtCaret`
   * （段落中间拆两段），插入后光标落插入文本之后。光标不可得按既有口径落 composer 末尾。
   * 事件处置与既有 × 钮同款（mousedown 拦下，不夺 composer 选区）。
   */
  function createImageMentionButton(el: HTMLElement): HTMLButtonElement {
    const at = document.createElement("button");
    at.type = "button";
    at.className = "lumir-hp-qc-at";
    at.tabIndex = -1;
    at.setAttribute("aria-label", t("D457"));
    at.textContent = "@";
    // 让卡片级 mousedown preventDefault 生效（不 stopPropagation）——点 `@` 不夺走 composer 的
    // 选区/焦点，`caretFromDom()` 因此就是用户点 `@` 之前的光标（design §4 的落点前提）。
    at.addEventListener("mousedown", (event) => event.preventDefault());
    at.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = [...composer.children].indexOf(el);
      if (index < 0) return;
      // 插入落点由 withModel 侧重渲（renderComposer 应用 result.caret）；composer.focus() 后
      // 显式再落一次光标（与 send 路径同口径：focus 可能归位选区，最后精调）。
      const landed: { caret: ComposerCaret | null } = { caret: null };
      withModel((blocks) => {
        const ordinal = imageOrdinals(blocks).get(index);
        const sel = caretFromDom();
        const caret = sel === null ? { block: blocks.length - 1, offset: 0 } : sel.focus;
        if (ordinal === undefined) return { blocks: [...blocks], caret };
        const result = insertPlainTextAtCaret(blocks, caret, imageMentionText(ordinal));
        landed.caret = result.caret;
        return result;
      }, STRUCTURAL_EDIT_FORCE);
      composer.focus();
      if (landed.caret !== null) setDomCaret(landed.caret);
    });
    return at;
  }

  /**
   * 图片卡片 DOM（composer / transcript 两态；design §8：复用 .lumir-hp-qcard 整族样式——
   * 边框 / 圆角 / 底色同族，**不画引号竖条**（缩略图本身是左锚，这条差异是显式视觉决定））。
   * 缩略图经读回命令按需取字节（数据模型与快照里不落 base64）；能力闸拒绝时卡片标
   * is-error（既有 error 语义色，design §6）。`ordinal` 是块序列的派生编号（`imageOrdinals`），
   * 渲染编号徽标；composer 态另挂「插入引用」钮（`@`）。
   */
  function createImageCardEl(
    card: ImageCard,
    mode: "composer" | "transcript",
    ordinal: number | null,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = "lumir-hp-qcard lumir-hp-imgcard";
    if (mode === "composer" && imageGateErrored.has(card.name)) el.classList.add("is-error");
    cardData.set(el, card);
    const main = document.createElement("div");
    main.className = "lumir-hp-qc-main";
    const thumb = document.createElement("div");
    thumb.className = "lumir-hp-qc-thumb";
    thumb.dataset.thumbName = card.name;
    // 来源标注（change add-image-quote-to-chat design §4.2）：只有引用进来的图才有来源；
    // 文案取 deck 的裸路径模板 D91（deck 没有「来自 …」模板，而裸路径已满足 spec 的
    // 「悬停提示含来源的 vault 相对路径」）。该文本不进序列化 / 投递 / 草稿。
    const sourcePath = imageSourceOf.get(card.name);
    if (sourcePath !== undefined) thumb.title = t("D91", { path: sourcePath });
    if (ordinal !== null) thumb.append(createImageOrdinalBadge(ordinal, card.name));
    const source = document.createElement("div");
    source.className = "lumir-hp-qc-src";
    source.textContent = imageCardMetaText(card.name, card.width, card.height);
    main.append(thumb, source);
    el.append(main);
    // 恢复路径补记宽高（M449）：建模时无尺寸的卡片（快照从 wire 引用恢复，ImageCard
    // width/height 可选）在缩略图 <img> load 后读自然尺寸补进元信息行。只改这一行 DOM
    // 文本、不写回卡片模型：重渲时该 <img> 会重新 load 再补一次（缩略图 URL 缓存不含
    // 尺寸），故不丢。加载失败 / 未就绪（natural 非正）→ 保持只显文件名，不出 0/NaN。
    loadImageThumb(card.name, thumb, (img) => {
      if (card.width !== undefined && card.height !== undefined) return;
      const dims = imageDimensionsFromNatural(img.naturalWidth, img.naturalHeight);
      if (dims === null) return;
      source.textContent = imageCardMetaText(card.name, dims.width, dims.height);
    });
    if (mode === "composer") {
      el.contentEditable = "false";
      // 动作区（右上角）：`@`（插入引用）在左、既有 `×`（移除）在右；两钮恒显（裁决点 5 的 A，
      // 与既有 `×` 同口径；design §8）。
      const actions = document.createElement("div");
      actions.className = "lumir-hp-qc-actions";
      if (ordinal !== null) actions.append(createImageMentionButton(el));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "lumir-hp-qc-x";
      remove.tabIndex = -1;
      remove.setAttribute("aria-label", t("D371"));
      remove.textContent = "×";
      actions.append(remove);
      el.append(actions);
      // 图片卡无跳回：点击（两钮除外）无操作。mousedown 拦下是不让 contenteditable=false
      // 的卡片抢走选区/焦点（面板内元素，无标题栏拖拽问题——REVIEW.md 「标题栏 preventDefault」条只约束标题栏）。
      el.addEventListener("mousedown", (event) => event.preventDefault());
      remove.addEventListener("mousedown", (event) => event.stopPropagation());
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = [...composer.children].indexOf(el);
        if (index < 0) return;
        withModel(() => removeBlockAt(readBlocksFromDom(), index), STRUCTURAL_EDIT_FORCE);
        composer.focus();
      });
    } else {
      // transcript：同构呈现，无钮、无跳回（只呈现缩略图，spec「发送后同构沉淀」）。可访问名
      // 含编号（D447 含编号形态）：编号是人的指代把手，读屏同样要能听到。ordinal 是本函数对
      // 图片块的恒有入参（调用点逐点核实），null 分支是防御面——回落文件名（代入空编号会产出
      // 「图片 ：name」畸形读屏名）。
      el.setAttribute("role", "img");
      el.setAttribute(
        "aria-label",
        ordinal === null ? card.name : t("D447", { n: String(ordinal), name: card.name }),
      );
    }
    return el;
  }

  /**
   * 卡片 DOM（composer / transcript 两态，三类卡片同构；design §7：几何零改动、复用
   * .lumir-hp-qcard 整族样式）。差异在出处行文案、hover title 与整卡的角色（msgquote 卡
   * 整块可点跳回来源消息；图片卡无跳回、只呈现缩略图）。
   *
   * quote 卡片的出处行另带两条**派生读数**（M662，人侧专用，不进卡片数据 / 序列化 / 投递）：
   *   - 「含 N 张图片」：摘录原文里的图片引用数（`countExcerptImageRefs`，与选区枚举同判据）；
   *   - 「N 张图片未能引用」：本次引用事务里失败的那几张（`quoteImageFailures`，按卡片对象记）。
   */
  function createCardEl(
    card: QuoteCard | MessageQuoteCard | ImageCard,
    mode: "composer" | "transcript",
    ordinal: number | null,
  ): HTMLElement {
    if (isImageCard(card)) return createImageCardEl(card, mode, ordinal);
    const msgCard = isMessageQuoteCard(card);
    const quoteCard: QuoteCard | null = msgCard ? null : card;
    const sourceText = msgCard ? messageQuoteSourceText(card) : cardSourceText(card);
    const jump = (): void => (msgCard ? jumpToMessageQuote(card) : quoteJumpHandler?.(card));
    const el = document.createElement("div");
    el.className = msgCard ? "lumir-hp-qcard lumir-hp-msgquote" : "lumir-hp-qcard";
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
    // 派生读数接在出处行之后（同一行、同一档小字——不新增行，卡片几何零改动）。
    const readouts: string[] = [];
    if (quoteCard !== null) {
      const images = countExcerptImageRefs(quoteCard.text, quoteCard.file);
      if (images > 0) readouts.push(tPlural("D587", images, { n: String(images) }));
      // 「未能引用」是**输入期**的呈现态（只活在 composer）：发送后消息里本来就只有进来
      // 的那几张图，再把失败数写进 transcript 会与恢复路径（侧表不带过来）不一致。
      const failed = mode === "composer" ? (quoteImageFailures.get(quoteCard) ?? 0) : 0;
      if (failed > 0) readouts.push(tPlural("D586", failed, { n: String(failed) }));
    }
    source.textContent = readouts.length === 0 ? sourceText : `${sourceText} · ${readouts.join(" · ")}`;
    main.append(excerpt, source);
    el.append(bar, main);
    el.title = msgCard ? messageQuoteHoverTitle(card) : cardHoverTitle(card);
    if (mode === "composer") {
      el.contentEditable = "false";
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "lumir-hp-qc-x";
      remove.tabIndex = -1;
      remove.setAttribute("aria-label", t("D371"));
      remove.textContent = "×";
      el.append(remove);
      // 卡片点击（× 除外）= 跳回来源（quote 走 QC3 注册的编辑器处理器、msgquote 走 transcript
      // 定位）；mousedown 拦下是为不让 contenteditable=false 的卡片抢走选区/焦点（面板内元素，
      // 无标题栏拖拽问题——REVIEW.md 「标题栏 preventDefault」条只约束标题栏容器）。
      el.addEventListener("mousedown", (event) => event.preventDefault());
      remove.addEventListener("mousedown", (event) => event.stopPropagation());
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        const index = [...composer.children].indexOf(el);
        if (index < 0) return;
        withModel(() => removeBlockAt(readBlocksFromDom(), index), STRUCTURAL_EDIT_FORCE);
        composer.focus();
      });
      el.addEventListener("click", jump);
    } else {
      // transcript：同构呈现，无 ×；整块是跳回入口（键盘可达）。可访问名取可见的整行
      // （出处 + 派生读数）：读数也是人侧要听到的信息，不因 aria-label 覆盖而丢。
      el.setAttribute("role", "button");
      el.tabIndex = 0;
      el.setAttribute("aria-label", `${t(msgCard ? "D444" : "D374")}: ${source.textContent ?? sourceText}`);
      el.addEventListener("click", jump);
      el.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          jump();
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
        if (card !== undefined) {
          blocks.push(
            isImageCard(card)
              ? { kind: "image", card }
              : isMessageQuoteCard(card)
                ? { kind: "msgquote", card }
                : { kind: "quote", card },
          );
        }
      } else {
        blocks.push({ kind: "paragraph", text: paraTextOf(child) });
      }
    }
    return blocks.length === 0 ? [{ kind: "paragraph", text: "" }] : blocks;
  }

  function renderComposer(blocks: readonly ComposerBlock[], caret: ComposerCaret | null): void {
    composer.replaceChildren();
    // 编号一次算出（一处真源），随块下标传给卡片工厂：卡片徽标因此与投递标签 / 恢复编号同源。
    const ordinals = imageOrdinals(blocks);
    for (let index = 0; index < blocks.length; index += 1) {
      composer.append(composerBlockEl(blocks[index], ordinals.get(index) ?? null));
    }
    if (composer.childElementCount === 0) composer.append(createParaEl(""));
    if (caret !== null) setDomCaret(caret);
    updateEmptyClass();
  }

  /** 一个块 → 一个 composer 子元素。已知块类按各自形态；**未知块类保守保留**——内容以 JSON
   *  原文落回输入区（可编辑、可删），MUST NOT 静默丢弃。今天没有未知块类，这是防御面：草稿
   *  由更新版本写入、更旧版本读到时的唯一出口（change composer-draft-persistence design §6；
   *  与 `parseQuoteMessage` 的「不识别即不还原，但 MUST NOT 静默丢文」同口径）。`ordinal` 是
   *  图片块的派生编号（非图片块 / 未知块传 null，不渲染徽标）。 */
  function composerBlockEl(block: ComposerBlock, ordinal: number | null): HTMLElement {
    if (block.kind === "paragraph") return createParaEl(block.text);
    if (block.kind === "quote" || block.kind === "msgquote" || block.kind === "image") {
      return createCardEl(block.card, "composer", ordinal);
    }
    return createParaEl(draftUnknownBlockText(block));
  }

  function updateEmptyClass(): void {
    const empty =
      composer.querySelector(".lumir-hp-qcard") === null && composer.textContent.trim() === "";
    composer.classList.toggle("is-empty", empty);
  }

  /**
   * 引用插入后的**焦点移交**（M671，三条引用入口共用：文本摘录 / 消息摘录 / 图片引用）。
   *
   * 合同：卡片进 composer 之后键盘落点 MUST 在输入区——用户「quote 完想直接打字」不该再自己
   * 点一次 composer。判据是 **DOM 焦点**（`document.activeElement === composer`），不是 AX 的
   * focused 标记：编辑器正文与 composer 在 AX 里同为 `AXTextArea`，标记分不出两侧
   *（M500/M502 实证：标记在 composer、盲注仍落进编辑器）。
   *
   * 三件事的顺序本身是合同的一部分：
   *  1. **面板必须在场**才谈得上聚焦：面板原本关着时装配层经 `deps.togglePane()` 现场开 pane
   *     并**同步**把面板挂进 DOM（`createPaneHandle` → `attachTo`）。不在场就只返回——宁可不
   *     聚焦，也不把焦点丢给别的元素；此时插入本身照旧落进（长驻内存的）输入区模型。
   *  2. **先 focus、再写 caret**：`withModel` 的整面重渲不改焦点宿主（`composer` 整块长驻），
   *     它在重渲时已经写过一次选区；但面板本来就是开着的现场，那一刻焦点还在编辑器里——
   *     contenteditable 获得焦点的那一拍可能按引擎口径把 caret 归位，模型位因此要**在 focus
   *     之后**再写一次，保证「光标落在卡片下一行的问题段落」（design §5 的装配合同）在焦点
   *     移交后仍然成立。
   *  3. **复核一次**：`focus()` 之后读 `activeElement`；没到位就在下一帧补一次。补的窗口只取
   *     一帧（装配层刚挂载的那一拍、click 分发尾部的引擎焦点修正都在这一拍内），**不排持续
   *     重试**——持续重试会跟用户的下一次点击抢焦点。
   */
  function focusComposerAfterInsert(caret: ComposerCaret | null): void {
    if (mountEl === null) return;
    const settle = (): void => {
      composer.focus();
      if (caret !== null) setDomCaret(caret);
    };
    settle();
    if (document.activeElement === composer) return;
    requestAnimationFrame(() => {
      if (document.activeElement === composer) return;
      settle();
    });
  }

  // ── 消息摘录：插入流转 / 跳回 / 失锚（change harness-message-excerpt design §5–§6） ──

  /** 消息摘录卡入 composer（走 insertBlockAtCaret 同路，面板未开先开、光标落卡片下一行段落）。 */
  function insertMessageQuoteCard(card: MessageQuoteCard): void {
    const valid = createMessageQuoteCard(card); // role / 原文非空校验（取不到不得生成卡片）
    if (mountEl === null) deps.togglePane(); // 装配层开 pane 后焦点已落 composer
    // 一次新的引用收口上一次引用的失败状态行（spec：读数存活到「下一次引用」——消息摘录也是
    // 一次引用；r1 P2-1）。
    applyQuoteFailureNotice(null);
    const caret = withModel((blocks) => {
      const sel = caretFromDom();
      const at = sel === null ? { block: blocks.length - 1, offset: 0 } : sel.focus;
      return insertBlockAtCaret(blocks, at, { kind: "msgquote", card: valid });
    }, STRUCTURAL_EDIT_FORCE);
    focusComposerAfterInsert(caret);
  }

  /** composer 贴图段（change harness-composer-image-paste design §7）：Blob → base64 →
   *  `harness_write_image`（harness 侧内容寻址落盘，MUST NOT 触碰 vault）→ 光标处插
   *  图片卡片（insertBlockAtCaret 同路：面板未开先开、拆段、光标落卡片下一行段落）。
   *  失败一律人话 toast（装配层 deps.toast；落盘链路的 code 族与 vault 附件同一张
   *  ERROR_COPY 表）、不插卡片、无半截文件。 */
  async function pasteClipboardImage(blob: Blob): Promise<void> {
    try {
      const dataBase64 = await blobToBase64(blob);
      const written = await harnessWriteImage(dataBase64, blob.type);
      const card: ImageCard = {
        name: written.name,
        sourceMime: blob.type,
        width: written.width,
        height: written.height,
      };
      if (mountEl === null) deps.togglePane();
      withModel((blocks) => {
        const sel = caretFromDom();
        const caret = sel === null ? { block: blocks.length - 1, offset: 0 } : sel.focus;
        return insertBlockAtCaret(blocks, caret, { kind: "image", card });
      }, STRUCTURAL_EDIT_FORCE);
      composer.focus();
    } catch (e) {
      deps.toast(errorText(e));
    }
  }

  /** transcript 消息折成纯逻辑层的锚序列（role / at / 渲染文本 + DOM 元素，供跳回定位与高亮）。 */
  function collectTranscriptMessages(): Array<{
    role: string;
    at: number | null;
    text: string;
    element: HTMLElement;
  }> {
    const out: Array<{ role: string; at: number | null; text: string; element: HTMLElement }> = [];
    for (const element of transcript.querySelectorAll<HTMLElement>(".lumir-hp-msg")) {
      const who = element.querySelector<HTMLElement>(".lumir-hp-who");
      const role = who?.dataset.role ?? "";
      const when = who?.querySelector<HTMLElement>(".lumir-hp-when");
      const raw = when?.dataset.ts;
      const at = raw === undefined ? null : Number(raw);
      const body = element.querySelector<HTMLElement>(".lumir-hp-body");
      out.push({ role, at: at !== null && Number.isFinite(at) ? at : null, text: body?.textContent ?? "", element });
    }
    return out;
  }

  /** 跳回高亮：整条消息瞬态着色（新动画类，pending-tint 语义），~1.4s 无条件退场（零常驻装饰）。 */
  const flashTimers = new WeakMap<HTMLElement, number>();
  function flashMessage(el: HTMLElement): void {
    const prev = flashTimers.get(el);
    if (prev !== undefined) window.clearTimeout(prev);
    el.classList.remove("is-jump-flash");
    void el.offsetWidth; // 强制重排以重启动画（重复点同一消息时动画重新播放）
    el.classList.add("is-jump-flash");
    flashTimers.set(
      el,
      window.setTimeout(() => {
        el.classList.remove("is-jump-flash");
        flashTimers.delete(el);
      }, MESSAGE_QUOTE_FLASH_MS),
    );
  }

  /**
   * 消息摘录卡跳回（design §6 三层降级）：① role + at 定位 → ② 全文搜索摘录原文 → ③ 失锚 toast。
   * 命中滚动居中 + 整条消息瞬态高亮；MUST NOT 静默跳到别的消息。失锚经 `deps.toast` 上屏
   * （装配层的 showToast，锚 harness pane 右下——面板不自建 toast 产出点）。
   */
  function jumpToMessageQuote(card: MessageQuoteCard): void {
    const messages = collectTranscriptMessages();
    const index = resolveMessageQuoteTarget(messages, card);
    if (index === null) {
      deps.toast(t("D443"));
      return;
    }
    const target = messages[index].element;
    target.scrollIntoView({ block: "center" });
    flashMessage(target);
  }

  /** IME 组合窗判据（HC5）：compositionstart 之后、compositionend + IME_CONFIRM_WINDOW_MS
   *  之前。确认窗覆盖 WKWebView「compositionend 先于 DOM 落定/确认拍」的时序（与 M361 确认拍
   *  拦截门同源一扇窗）。normalize 的组合窗冻结用它；整面重渲只冻组合期（imeGateState.composing，
   *  确认窗内组合已结束、DOM 已落定——合同 HC5 第 2 条的不对称）。 */
  function imeWindowActive(now: number = Date.now()): boolean {
    return imeGateState.composing || imeGateState.confirmUntil > now;
  }

  /**
   * HC5 补账：组合窗内被 normalize 闸门跳过的归一，在确认窗过期后补跑一次——组合的 DOM 落定
   * 在 WKWebView 里落在 compositionend 之后（确认拍时序同 M361），过早归一仍会把落定的候选
   * 文本折错段落。窗内新起的组合由它自己的 compositionend 续期（再排一次补账），这一链到此
   * 为止（不跟着新组合空转）。
   *
   * 到期时确认窗**仍开着**就续排到窗尾：定时器与墙钟不同源（墙钟回退 / 定时器相对墙钟提前
   * 到期），一次性定时器在那一拍重判窗仍在就把补账静默丢掉，而丢掉的补账没有第二次——游离
   * 文本永久不折（M560 的间歇红：`'汉语' !== '汉语tail'`）。续排的延时取「窗尾剩余 + 1ms」并
   * 封顶在 IME_CONFIRM_WINDOW_MS，墙钟大幅回退时也只是每 250ms 重判一次，不空转。
   */
  let imeBackfillTimer: number | undefined;
  function scheduleImeBackfill(wait: number = IME_CONFIRM_WINDOW_MS): void {
    window.clearTimeout(imeBackfillTimer);
    imeBackfillTimer = window.setTimeout(() => {
      imeBackfillTimer = undefined;
      if (imeGateState.composing) return; // 新组合在途：由它自己的 compositionend 续排
      if (imeWindowActive()) {
        const remaining = imeGateState.confirmUntil - Date.now();
        scheduleImeBackfill(Math.min(IME_CONFIRM_WINDOW_MS, Math.max(1, remaining + 1)));
        return;
      }
      normalize();
    }, wait);
  }

  /**
   * 归一化（quirk ④）：顶层只允许 .qcard / .qpara 两类块——裸文本、<br>、浏览器自造的
   * div/span 一律折进相邻段落（<br> 记 \n）；收尾保证至少一个段落块。数据层因此永远干净
   * （「不接受裸 <div>/<br> 进数据层」的正面落实）。光标尽量原位保留。
   *
   * HC5 组合窗闸门：IME 组合窗（compositionstart → compositionend + IME_CONFIRM_WINDOW_MS）
   * 内自造早退——组合期引擎自造的瞬时节点（组合文本宿主、空块维持的 <br>）是 IME 会话的活
   * 锚点不是脏数据，摘除/折段会销毁锚点（Alex 2026-10-16「候选落字跳回第一行、第二行消失」）。
   * 被跳过的归一由 compositionend 在确认窗过期后补账（那边注释）。
   */
  function normalize(): void {
    if (normalizing) return;
    if (imeWindowActive()) return;
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

  /** 当前折叠选区的模型光标（无选区 / 非折叠返回 null）。 */
  function collapsedCaret(): ComposerCaret | null {
    const sel = caretFromDom();
    if (sel === null) return null;
    return sel.anchor.block === sel.focus.block && sel.anchor.offset === sel.focus.offset ? sel.focus : null;
  }

  /** 把 DOM 选区读成模型端点（选区不在 composer 内返回 null）。 */
  function caretFromDom(): ComposerSelection | null {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return null;
    const anchor = modelCaretAt(selection.anchorNode, selection.anchorOffset);
    const focus = modelCaretAt(selection.focusNode, selection.focusOffset);
    if (anchor === null || focus === null) return null;
    return { anchor, focus };
  }

  /** 一个 DOM 点（节点 + 偏移）→ 模型端点；不在 composer 内返回 null。**DOM→模型的唯一读法**：
   *  `caretFromDom`（选区）与 `caretRangeFromPoint`（几何解算出的点，⌃N/⌃P 的渲染行一步）共用。 */
  function modelCaretAt(node: Node | null, domOffset: number): ComposerCaret | null {
    if (node === null) return null;
    // 选区锚在 composer 元素自身 = 两个顶层块之间的块级边界（`Range(composer, N)`）。
    // 这是「相邻两张卡之间」在 DOM 里的形态（无文本宿主），归一成第 N 块的前缘
    // （design §3.1；旧实现爬到 composer 之上即放弃、整体返回 null）。
    if (node === composer) return boundaryCaretAt(domOffset, composer.children.length);
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
  }

  /** 模型光标 → DOM 点（节点 + 偏移；边界档落在 composer 元素上）。`setDomCaret` /
   *  `setDomSelection` 共用——落点形态见 `domCaretTarget`，与 `boundaryCaretAt` 互为逆运算。 */
  function domPointOf(caret: ComposerCaret): { node: Node; offset: number; blockEl: Element | null } {
    if (composer.children.length === 0) composer.append(createParaEl(""));
    const target = domCaretTarget(readBlocksFromDom(), caret);
    const blockEl = [...composer.children][target.index] ?? null;
    if (target.kind === "boundary" || blockEl === null) {
      return { node: composer, offset: target.kind === "boundary" ? target.index : composer.children.length, blockEl };
    }
    if (target.kind === "cardText") {
      // 卡片内的**首个文本位**（M457）：卡片是 contenteditable=false 的原子块，它的文本住在
      // `.lumir-hp-qc-ex` 一类子节点里。落在文本位上才有 caret 几何；DOM 读回按「锚在卡片内」
      // 归一为同一个边界位（`caretFromDom` 的卡片档）。卡片内没有文本节点时回落元素本身
      // （几何为零的退化形态，卡片生成路径保证原文非空，正常不可达）。
      return { node: firstTextNodeIn(blockEl) ?? blockEl, offset: 0, blockEl };
    }
    const text = paraTextOf(blockEl);
    if (text.length === 0) return { node: blockEl, offset: 0, blockEl };
    let node: Node | null = null;
    let offset = 0;
    let remaining = target.offset;
    const walk = (current: Node): void => {
      if (node !== null) return;
      if (current.nodeType === Node.TEXT_NODE) {
        const len = current.textContent?.length ?? 0;
        if (remaining <= len) {
          node = current;
          offset = remaining;
        } else {
          remaining -= len;
        }
      } else if (current.nodeName === "BR") {
        if (remaining === 0) {
          node = blockEl;
          offset = [...blockEl.childNodes].indexOf(current as ChildNode);
        } else {
          remaining -= 1;
        }
      } else {
        current.childNodes.forEach(walk);
      }
    };
    blockEl.childNodes.forEach(walk);
    if (node === null) {
      node = blockEl;
      offset = blockEl.childNodes.length;
    }
    return { node, offset, blockEl };
  }

  /** 把模型光标写回 DOM（折叠光标）：落点形态由 `domCaretTarget` 决定（段落内按字符偏移定位、
   *  卡片 / 边界位落相邻的文本宿主、末块是卡片时的「末尾之后」落块级容器边界）。 */
  function setDomCaret(caret: ComposerCaret): void {
    const point = domPointOf(caret);
    const selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      const range = document.createRange();
      range.setStart(point.node, point.offset);
      range.collapse(true);
      selection.addRange(range);
    }
    // 零高回落的块：边界档（卡片前缘 / 相邻两卡之间）用**后一张卡片**的矩形，
    // 「末尾之后」（block = 块数）回落**最后一个块**——M473 起它自己就写回末块的边界（末块是
    // 段落时是文本末缘，blockEl 已非空），这一层只剩「末块是卡片」的子档；不拿 composer 自身的
    // 矩形当「光标行」（那会让 caretScrollTop 恒判「越出上沿」、每次重渲把视口顶 4px）。
    const measure = document.createRange();
    measure.setStart(point.node, point.offset);
    measure.collapse(true);
    scrollCaretIntoView(measure, point.blockEl ?? composer.lastElementChild ?? composer);
  }

  /** 把模型选区写回 DOM（M447 的扩选族用）：anchor / head 两端都落位、方向保持——`setBaseAndExtent`
   *  按文档序自动规范，`extend` 把 head 端与 anchor 端分开（否则后续扩选会从错误的一端继续）。
   *  滚动位跟 head 端。 */
  function setDomSelection(anchor: ComposerCaret, head: ComposerCaret): void {
    const a = domPointOf(anchor);
    const h = domPointOf(head);
    const selection = window.getSelection();
    if (selection !== null) {
      selection.removeAllRanges();
      selection.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
    }
    const measure = document.createRange();
    measure.setStart(h.node, h.offset);
    measure.collapse(true);
    scrollCaretIntoView(measure, h.blockEl ?? composer.lastElementChild ?? composer);
  }

  /** 全选（M627）：选区覆盖整个 composer，**含原子卡片**。走 DOM 的 `selectNodeContents`
   *  ——端点落在 composer 自身的两个块级边界上，模型读回即 `{block:0,offset:0}` →
   *  `{block:块数,offset:0}`（`modelCaretAt` 的 composer 档），与「末尾之后」的模型表示同源；
   *  随后的删除 / 覆写走既有选区路径（`selectionDeleteStep`）。MUST NOT 用
   *  `document.execCommand("selectAll")` 或裸原生选区：前者按引擎口径选整页，后者在混排
   *  contenteditable（含 contenteditable=false 卡片）上选不到全文——这正是 Alex 报告的现象。 */
  function selectAllComposer(): void {
    if (composer.children.length === 0) return;
    const selection = window.getSelection();
    if (selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // ── composer 侧的文本面命令入口（M447，change composer-emacs-nav design §3.2 / §4） ──
  // 装配层的一处分派包装在事件目标落在 composer 内时调 `runComposerCommand`（`text` 作用域
  // 命令的两个面）。**移动 / 扩选只写选区与滚动位**——MUST NOT 重渲、MUST NOT 压撤销步
  // （design §6 的质量合同；导航的 DOM 稳定性由验收场景的 MutationObserver 计数钉住）。

  /** 命令 id → composer 侧的模型动作。**命中即消费**：`text` 作用域的命令由分发器在命中时
   *  `preventDefault`（命中即吞默认行为，命令本身无事可做也不放行原生路径——见 keymap-commands
   *  增量的「分发」段），因此这里**没有**「是否消费」的返回值；「该处无动作」表现为无操作。
   *  这条口径是 M453 实现期与 design §3.2 的第一次修订：若把「无动作」放行原生，段首 ⌥⌫ 的
   *  WKWebView `deleteWordBackward` 会跨块合并 / 删卡，直接违反「词级 kill 不跨块」不变量。 */
  function runComposerCommand(command: CommandId): void {
    const blocks = readBlocksFromDom();
    const sel = caretFromDom();
    const caret = sel === null ? null : sel.focus;
    switch (command) {
      // M627：⌘A 全选——composer 全部块（含卡片）。命中即消费（分发器已 preventDefault），
      // 不再依赖引擎原生 selectAll（它在混排 contenteditable 上选不到全文）。
      case "editor.select-all":
        selectAllComposer();
        return;
      case "editor.cursor-forward":
        navigate(blocks, caret, moveCharForward);
        return;
      case "editor.cursor-backward":
        navigate(blocks, caret, moveCharBackward);
        return;
      case "editor.line-start":
        navigate(blocks, caret, moveLineStart);
        return;
      case "editor.line-end":
        navigate(blocks, caret, moveLineEnd);
        return;
      case "editor.cursor-down":
        navigate(blocks, caret, (b, c) => stepVisualLine(b, c, 1));
        return;
      case "editor.cursor-up":
        navigate(blocks, caret, (b, c) => stepVisualLine(b, c, -1));
        return;
      case "editor.extend-char-forward":
        extendSelection(blocks, sel, moveCharForward);
        return;
      case "editor.extend-char-backward":
        extendSelection(blocks, sel, moveCharBackward);
        return;
      case "editor.extend-line-start":
        extendSelection(blocks, sel, moveLineStart);
        return;
      case "editor.extend-line-end":
        extendSelection(blocks, sel, moveLineEnd);
        return;
      case "editor.extend-line-down":
        extendSelection(blocks, sel, (b, c) => stepVisualLine(b, c, 1));
        return;
      case "editor.extend-line-up":
        extendSelection(blocks, sel, (b, c) => stepVisualLine(b, c, -1));
        return;
      case "editor.extend-word-forward":
        extendSelection(blocks, sel, moveWordForward);
        return;
      case "editor.extend-word-backward":
        extendSelection(blocks, sel, moveWordBackward);
        return;
      case "editor.delete-char-forward":
        deleteAtCaret(blocks, sel, deleteForwardAtCaret);
        return;
      case "editor.delete-char-backward":
        deleteAtCaret(blocks, sel, backspaceAtCaret);
        return;
      case "editor.delete-word-forward":
        killWordAtCaret(blocks, sel, true);
        return;
      case "editor.delete-word-backward":
        killWordAtCaret(blocks, sel, false);
        return;
      case "editor.kill-line":
        killLineAtCaretCommand(blocks, sel);
        return;
      case "editor.yank":
        yankAtCaret(blocks, sel);
        return;
      case "editor.transpose-chars":
        transposeAtCaret(blocks, sel);
        return;
      default:
        return;
    }
  }

  /**
   * ⌃N / ⌃P 的一步（M457，Alex 2026-10-12 裁决「按视觉行、与编辑器正文对齐」）：**渲染行优先**。
   *
   * 顺序（超集，模型层一字不改）：
   * 1. 光标在段落内、且量得到行盒时，按光标的 **x 位 + 相邻行的 y 位**解一个 DOM 位置
   *    （`document.caretRangeFromPoint`，与编辑器侧 CodeMirror `cursorLineDown/Up` 同口径：
   *    同 x 位跨一行）——解出来的位置必须落在**同一个段落**里、且**真的跨了一行**
   *    （`visualLineStepCrossed`）才采信；
   * 2. 否则回落到模型层的 `moveLineUp` / `moveLineDown`（逻辑行 + 跨相邻段落块，既有行为）。
   *
   * 为什么不是「直接在模型层按渲染行算」：软折行的行界只有引擎知道（模型层是零 DOM 的），
   * 因此渲染行这一步只能问 DOM 几何；模型层的停靠点序列与归一等价类**不受影响**（⌃F/⌃B 不动）。
   */
  function stepVisualLine(blocks: readonly ComposerBlock[], caret: ComposerCaret, delta: number): ComposerCaret {
    const logical = delta < 0 ? moveLineUp(blocks, caret) : moveLineDown(blocks, caret);
    const block = blocks[caret.block];
    if (block === undefined || block.kind !== "paragraph") return logical;
    const api = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null })
      .caretRangeFromPoint;
    if (typeof api !== "function") return logical;
    const point = domPointOf(caret);
    const probe = document.createRange();
    probe.setStart(point.node, point.offset);
    probe.collapse(true);
    const from = probe.getBoundingClientRect();
    if (!(from.height > 0)) return logical; // 量不到行盒（空段落 / 边界位）：没有渲染行可言
    const y = delta < 0 ? from.top - from.height / 2 : from.bottom + from.height / 2;
    const hit = api.call(document, from.left, y);
    if (hit === null) return logical;
    const resolved = modelCaretAt(hit.startContainer, hit.startOffset);
    if (resolved === null || resolved.block !== caret.block) return logical; // 出段落：交给模型层的跨段落行为
    const to = hit.getBoundingClientRect();
    if (!visualLineStepCrossed(from, { top: to.top, height: to.height }, delta)) return logical;
    return resolved;
  }

  /** 纯移动：只写选区 + 滚动位（不重渲、不压栈）；无动作时不动 DOM。 */
  function navigate(
    blocks: readonly ComposerBlock[],
    caret: ComposerCaret | null,
    move: (blocks: readonly ComposerBlock[], caret: ComposerCaret) => ComposerCaret,
  ): void {
    if (caret === null) return;
    const from = normalizeComposerCaret(blocks, caret);
    const next = move(blocks, caret);
    if (sameCaret(from, next)) return; // 无动作：不动 DOM（含「原地空走」被归一吃掉的那一拍）
    setDomCaret(next);
  }

  /** 扩选：anchor 不动、head 走同一套移动纯函数（design §4.4）。 */
  function extendSelection(
    blocks: readonly ComposerBlock[],
    sel: ComposerSelection | null,
    move: (blocks: readonly ComposerBlock[], caret: ComposerCaret) => ComposerCaret,
  ): void {
    if (sel === null) return;
    const from = normalizeComposerCaret(blocks, sel.focus);
    const head = move(blocks, sel.focus);
    if (sameCaret(from, head)) return;
    setDomSelection(sel.anchor, head);
  }

  /** ⌃D / ⌃H：接既有 `deleteForwardAtCaret` / `backspaceAtCaret`（有选区先删选区）。删除族的
   *  force 判定在 `deleteFamilyStep` 里（单一真源，与裸 Backspace/Delete 分支共用）。 */
  function deleteAtCaret(
    blocks: readonly ComposerBlock[],
    sel: ComposerSelection | null,
    op: (blocks: readonly ComposerBlock[], caret: ComposerCaret) => { blocks: ComposerBlock[]; caret: ComposerCaret } | null,
  ): void {
    const step = deleteFamilyStep(blocks, sel, op);
    if (step === null) return;
    withModel(step.op, step.force);
  }

  /** ⌥D / ⌥⌫（含 ⌥Delete 的对称命令）：词级 kill（不跨块），杀掉的文本并入**跨面共用**的
   *  kill 槽。有选区时按删除族口径先删选区（不并入槽——跨块的任意选区文本提取不在本 change
   *  的范围，登记为边界）。 */
  function killWordAtCaret(blocks: readonly ComposerBlock[], sel: ComposerSelection | null, forward: boolean): void {
    if (sel === null) return;
    const selection = selectionDeleteStep(sel);
    if (selection !== null) {
      withModel(selection.op, selection.force);
      return;
    }
    const result = forward ? killWordForward(blocks, sel.focus) : killWordBackward(blocks, sel.focus);
    if (result === null) return;
    applyKill(result, forward);
  }

  /** ⌃K：kill 到逻辑行行尾（不跨块），并入同一 kill 槽。 */
  function killLineAtCaretCommand(blocks: readonly ComposerBlock[], sel: ComposerSelection | null): void {
    if (sel === null) return;
    const selection = selectionDeleteStep(sel);
    if (selection !== null) {
      withModel(selection.op, selection.force);
      return;
    }
    const result = killLineAtCaret(blocks, sel.focus);
    if (result === null) return;
    applyKill(result, true);
  }

  /** 把一次 kill 的文本并入跨面共用的 kill 槽（相接判定与编辑器侧共用 `mergeKillText`——
   *  槽是模块级单例，编辑器与 composer 一致）。kill 是结构性操作，force 走单一真源。 */
  function applyKill(result: ComposerKill, forward: boolean): void {
    const from = caretKey(result.from);
    const to = caretKey(result.to);
    const merged = mergeKillText(currentKillSlot(), result.killed, forward, forward ? from : to);
    setKillSlot({ text: merged, forward, anchor: from });
    withModel(() => ({ blocks: result.blocks, caret: result.caret }), STRUCTURAL_EDIT_FORCE);
  }

  /** ⌃Y：把 kill 槽内容插入光标处（有选区先删选区；多行经 `insertPlainTextAtCaret` 拆段；
   *  卡片边界位由它物化段落——卡片不被吞）。yank 是结构性操作（kill-yank 族），force 走单一真源。 */
  function yankAtCaret(blocks: readonly ComposerBlock[], sel: ComposerSelection | null): void {
    const text = currentKillSlot()?.text ?? "";
    if (text === "" || sel === null) return;
    const collapsed = sameCaret(sel.anchor, sel.focus);
    withModel((current) => {
      const base = collapsed ? { blocks: [...current], caret: sel.focus } : deleteSelectionRange(current, sel);
      return insertPlainTextAtCaret(base.blocks, base.caret, text);
    }, STRUCTURAL_EDIT_FORCE);
  }

  /** ⌃T：转置（段首 / 卡片边界无动作；有选区时不插手——与编辑器侧同口径）。
   *  force=false 是**豁免**：转置是字符级编辑（不是结构性操作），与相邻键入同簇即可。 */
  function transposeAtCaret(blocks: readonly ComposerBlock[], sel: ComposerSelection | null): void {
    if (sel === null) return;
    if (!sameCaret(sel.anchor, sel.focus)) return;
    if (transposeCharsAtCaret(blocks, sel.focus) === null) return;
    withModel(
      (current) => transposeCharsAtCaret(current, sel.focus) ?? { blocks: [...current], caret: sel.focus },
      false,
    );
  }

  /**
   * 把光标行滚进 composer 视口（HC2，合同 docs/specs/harness-composer.md）：光标是程序化
   * Range 落的，引擎在选区变化时的 reveal 行为是**引擎特性**——WKWebView 会 reveal
   * （M419 实测：把调用停用后断行后的新行照样在视口里），Blink 不会（chromium 探针：不写
   * scrollTop 时视口停在滚动上限之前整整一行）。这里给一条**引擎无关的保证**：量光标行读数
   * → 纯函数 caretScrollTop 算目标 scrollTop → 需要时写回（已在视野内时返回原值，不写回、不抖）。
   *
   * 光标行矩形取 Range 包围盒；空段落（断行新落的空行）上 Range 可能量出零高，回落块元素
   * 矩形（空段落有 min-height:1em，量得到行位）。面板未挂载时两种矩形都是 0，纯函数钳回 0。
   */
  function scrollCaretIntoView(range: Range, blockEl: Element): void {
    const box = composer.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    const rect = rangeRect.height > 0 ? rangeRect : blockEl.getBoundingClientRect();
    const offsetInContent = composer.scrollTop - box.top;
    const target = caretScrollTop(
      {
        scrollTop: composer.scrollTop,
        clientHeight: composer.clientHeight,
        scrollHeight: composer.scrollHeight,
      },
      { top: rect.top + offsetInContent, bottom: rect.bottom + offsetInContent },
    );
    if (target !== composer.scrollTop) composer.scrollTop = target;
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
   * → 算新模型 → 整面重渲。`force` 取值唯一来自 `STRUCTURAL_EDIT_FORCE`（结构性操作：卡片插入/
   * 移除、粘贴、拆段、删除族与 kill 族）——本文件不再写 force 字面量；`false` 只留给三处豁免：
   * 键入（原生文本编辑的压栈）、字符级编辑（⌃T 转置）、删除族的空转空模型写（见各自就地注释）。
   *
   * 返回重渲后落到 DOM 的那个模型光标（`null` = 写入被下面两条闸门跳过、DOM 未变）——引用插入
   * 的三条入口靠它把 caret 在**焦点移交之后**再写一次（见 focusComposerAfterInsert）。
   *
   * HC5：IME 组合期（compositionstart → compositionend）整面重渲冻结——replaceChildren 会销毁
   * 组合锚点节点、打断 IME 会话（同 compositionstart 物化注释的理由）。键盘入口在 keydown 已有
   * 组合期早退，这里防的是鼠标路径（组合期右键粘贴 / 拖入）；被跳过的编辑不补发（组合文本的
   * 保全优先于一次粘贴，合同 HC5 已知边界）。
   */
  function withModel(
    op: (blocks: readonly ComposerBlock[]) => { blocks: ComposerBlock[]; caret: ComposerCaret },
    force: boolean,
  ): ComposerCaret | null {
    if (imeGateState.composing) return null;
    normalize();
    undoHistory.push(snapshot(), force);
    const result = op(readBlocksFromDom());
    renderComposer(result.blocks, result.caret);
    refreshChip();
    markDraft();
    return result.caret;
  }

  function undo(): void {
    if (imeGateState.composing) return; // HC5：组合期整面重渲冻结（同 withModel）
    normalize();
    const snap = undoHistory.undo(snapshot());
    if (snap === null) return;
    renderComposer(snap.blocks, snap.caret);
    refreshChip();
    markDraft();
  }

  function redo(): void {
    if (imeGateState.composing) return; // HC5：组合期整面重渲冻结（同 withModel）
    const snap = undoHistory.redo(snapshot());
    if (snap === null) return;
    renderComposer(snap.blocks, snap.caret);
    refreshChip();
    markDraft();
  }

  /**
   * 兜底归一化观察器：我们的拦截覆盖了粘贴 / Enter / 删除 / 拖入，但 IME 替换、拼写纠正、
   * 未来新增路径仍可能自造结构——observer 只负责把漏网的裸块折回 .qpara（数据层不变量
   * 双保险），不触碰卡片。组合窗内 normalize 自早退（HC5），归一由 compositionend 补账接管。
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
    applyPermChip();
    rebuildPermPopIfOpen();
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
    // M644：浮钮的可访问名随语言重取（无新内容 / 有新内容两串）；态 / 未读取控制器现值——
    // 与 render 走同一个施加函数，不构成第二份状态。
    applyJumpBottomState({ phase: follow.phase(), unread: follow.unread() });
  }

  // ── harness pane 内容字号（M378 起可缩放；M627 起由「一套字号」驱动）──────────
  // 运行期只写面板根上的 --lumir-hp-scale（**单一写入路径**）——面板摘出 / 重挂不丢（元素
  // 长驻），不落盘、不回写 config.json（与内容 pane 的持久化口径逐条对齐，不新造口径）。
  // 比值由装配层给（编辑器当前字号 ÷ 配置基线），面板不读 DOM、不自持档位——焦点在哪个
  // pane 都不影响结果（M627 裁决：两个 pane 一起吃同一套字号）。
  function writeTextScale(ratio: number): void {
    hpScale = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    panel.style.setProperty("--lumir-hp-scale", String(hpScale));
  }

  // ── 会话名（标题栏 harness 段的会话身份；design §3 口径 + change add-session-auto-naming
  //    D11 的显示优先级）──────────────────────────────────────────────────────────────
  // 截断口径的单一真源在模块级（truncateSessionName / SESSION_NAME_MAX）——恢复选择器的
  // 会话行与这里共用同一份（design §6.1）；优先级口径在 sessionNameSource 一处；首条用户
  // 消息的取法在 firstUserTextOf（模块级，与后端 first_paragraph_text 同一口径）。

  /** 会话名上屏形态（标题栏与浮层行共用同一份算法，注入 D330 文案）：有效标题 → 首条用户
   *  消息截断 → 「新会话」。标题本身 ≤20 码点（后端校验），故标题显示不带省略号。 */
  function sessionNameShown(title: string | null, firstUserText: string | null): string {
    const name = sessionNameSource(title, firstUserText);
    if (name === null) return t("D330");
    return title !== null && title.trim() !== "" ? name : truncateSessionName(name);
  }

  function applySessionName(): void {
    const shown = sessionNameShown(sessionTitle, firstUserText);
    sname.textContent = shown;
    const name = sessionNameSource(sessionTitle, firstUserText);
    if (name === null) sessionButton.removeAttribute("title");
    else sessionButton.title = name;
  }

  /** 标题事件到达时，把已打开的历史浮层里显示「旧名」的行原地改名（design D11：不重开、
   *  不跳位置）。后端快照 / 清单不暴露「当前活跃 session id」，故按上屏名匹配——当前会话
   *  行的名与标题栏同名（同一口径）；匹配不到就不动（重开浮层会按新口径重取，永不改错行）。 */
  function retitleOpenSessRows(previousShown: string, nextShown: string): void {
    if (sessList.hidden) return;
    for (const name of Array.from(
      sessList.querySelectorAll<HTMLElement>(".lumir-hp-sesspop-name"),
    )) {
      if (name.textContent !== previousShown) continue;
      name.textContent = nextShown;
      name.dataset.name = nextShown;
      name.title = nextShown;
    }
  }

  function applyChip(): void {
    if (lastChip === null || lastChip === "none") {
      chip.textContent = t("D333");
      chip.classList.add("is-none");
      // 「无」态没有路径：清掉上一条文件的 hover 提示，否则会挂着一个已不存在的路径（M606）。
      chip.removeAttribute("title");
      return;
    }
    chip.classList.remove("is-none");
    // 可见面折叠中间目录（M606，Alex 2026-10-19 裁决）：文件名恒完整显示、目录只是消歧
    // 辅助；完整 vault 相对路径落 title 承接 hover 消歧。折叠口径的唯一实现是
    // collapseMiddleDirs（本文件只消费，不再算第二份）。
    chip.title = lastChip.path;
    const shownPath = collapseMiddleDirs(lastChip.path);
    if (lastChip.viewport_range !== undefined) {
      chip.textContent = t("D332", {
        path: shownPath,
        from: lastChip.viewport_range.from_line,
        to: lastChip.viewport_range.to_line,
      });
    } else {
      // 消息携带引用卡片：跳过视口注入，自动上下文只剩路径（卡片本身在 composer 内核对）。
      chip.textContent = t("D373", { path: shownPath });
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

  /** 勾选项的 check 格（think pop 配方：14px 固定宽，未勾选留空保证纵对齐）。className
   *  按浮层给（两个浮层各自的样式条款互不牵连）。 */
  function appendCheck(parent: HTMLElement, checked: boolean, className = "lumir-hp-selpop-check"): void {
    const check = document.createElement("span");
    check.className = className;
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
      // 重建保焦的语义键（change fix-escape-overlay-close-oct24 design §3.3）：段 + 该项 id。
      // MUST NOT 靠文本内容或行号推断——重建后行号会变、文本随语言变。
      item.dataset.seg = "provider";
      item.dataset.id = id;
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
          item.dataset.seg = "model";
          item.dataset.id = option.id;
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
      item.dataset.seg = "effort";
      item.dataset.id = id;
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
    // 层栈登记与开合同源（change fix-escape-overlay-close-oct24 design §3.2）：注销在同一函数
    // 的另一支——所有关闭路径都经过 setSelPop(false)，MUST NOT 在别处补一次。
    if (open) registerEscapeLayer("harness-sel-pop", closeSelPop);
    else unregisterEscapeLayer("harness-sel-pop");
    // M702：打开时补一次夹取（此前完全没有——越 pane 的现场见 placeSelPop 注释）。
    if (open) placeSelPop();
  }

  /** 合并选择器关闭的唯一实现（就地键处理器与窗口级兜底共用，E5）：收起 + 焦点回模型 chip。 */
  function closeSelPop(): void {
    setSelPop(false);
    if (modelChip.isConnected) modelChip.focus();
  }

  /** 该段当前项的 id（重建保焦的语义键「id」那一半；键按**重建时的当前状态**取，见
   *  `pickRebuildFocus` 的说明）。 */
  function selSegmentKey(seg: RebuildSegment): string | null {
    if (selSelection === null) return null;
    if (seg === "provider") return selSelection.provider;
    if (seg === "model") return selSelection.models[selSelection.provider as ProviderId]?.current ?? null;
    if (seg === "effort") return thinkLevel;
    return null;
  }

  /** 重建保焦的**第一步**：只在「重建前焦点确实在这个浮层里」时动作——鼠标点 chip 打开浮层的
   *  路径里焦点不在项上，那时抢焦点是第二条缺陷（design §3.3 的口径）。`seg` 已知时键取状态里的
   *  当前值（成功落新项、回滚落旧项）；未知（能力标记翻转这类非用户动作的重建）时退回焦点项
   *  自己的键。
   *
   *  **把焦点先收到浮层容器上**是本函数承重的一步（`docs/specs/overlay-visibility.md` O6 的
   *  实测分叉）：重建会把持焦项从 DOM 摘除，而引擎对「持焦节点被移除」的修复**时机不同**——
   *  chromium 同步把焦点送回 `body`、WebKit 异步补一次。同步写完的 `focus()` 因此会在 WebKit 上
   *  被那次迟到的修复盖掉（真机场景 238 的 GREEN 首跑即此形态：重建后 AX 里 0 个 focused 节点）。
   *  容器不在重建面上，焦点在重建窗口内既不丢、也不触发 `focusout`；重建后的 `focus()` 才是
   *  落在新节点上的第一笔。 */
  function rebuildFocusKey(pop: HTMLElement, seg: RebuildSegment | undefined, keyOf: (s: RebuildSegment) => string | null): RebuildKey | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !pop.contains(active)) return null;
    const key = focusKeyFrom(pop, active, seg, keyOf);
    if (key === null) return null;
    pop.focus();
    return key;
  }

  /** 语义键的取值：段已知时取状态里的当前值，未知时退回焦点项自己的 `data-seg` / `data-id`。 */
  function focusKeyFrom(
    pop: HTMLElement,
    active: HTMLElement,
    seg: RebuildSegment | undefined,
    keyOf: (s: RebuildSegment) => string | null,
  ): RebuildKey | null {
    if (seg !== undefined) {
      const id = keyOf(seg);
      return id === null ? null : { seg, id };
    }
    const activeSeg = active.dataset.seg;
    const activeId = active.dataset.id;
    if (activeSeg !== undefined && activeId !== undefined) {
      return { seg: activeSeg as RebuildSegment, id: activeId };
    }
    // 焦点落在不带语义键的件上（权限规则删除钮这类动作件）：锚到浮层里的「当前项」，至少不把
    // 焦点送出浮层（O6 的终态约束：重建后焦点仍在浮层内）。
    const current = pop.querySelector<HTMLElement>('[data-seg][data-id][aria-checked="true"]');
    if (current?.dataset.seg !== undefined && current.dataset.id !== undefined) {
      return { seg: current.dataset.seg as RebuildSegment, id: current.dataset.id };
    }
    return null;
  }

  /** 重建后落焦：精确项 → 该段当前项 → 触发钮（`isConnected` 守卫；`focus()` 对已摘除节点
   *  是静默失败，会把焦点留在 body——design §6）。 */
  function focusRebuiltItem(pop: HTMLElement, key: RebuildKey, fallback: HTMLElement): void {
    const items = [...pop.querySelectorAll<HTMLElement>("[data-seg][data-id]")].map((el) => ({
      el,
      seg: el.dataset.seg as RebuildSegment,
      id: el.dataset.id as string,
      current: el.getAttribute("aria-checked") === "true",
    }));
    const hit = pickRebuildFocus(items, key);
    if (hit !== null) {
      hit.el.focus();
      return;
    }
    if (fallback.isConnected) fallback.focus();
  }

  /** 浮层开着时重建设（三维读数随选择刷新；选定不关浮层，重建就是它刷新的方式）。
   *
   *  `seg` 是刚被用户改动的那一段（provider / model / effort）：重建前记下「焦点是否在浮层内
   *  + 语义键」，重建后按语义键落回同一项——重建把持焦件摘除后焦点送回 `body`，这条修复是
   *  本缺陷的根因面（兜底只修果）。 */
  function rebuildSelPopIfOpen(seg?: RebuildSegment): void {
    if (selPop.hidden) return;
    const key = rebuildFocusKey(selPop, seg, selSegmentKey);
    buildSelPop();
    placeSelPop();
    if (key !== null) focusRebuiltItem(selPop, key, modelChip);
  }

  // ── 权限 chip 与浮层（M414）────────────────────────────────────────────────

  /** 权限 chip 重渲（长驻元素：读数 / 读屏名 / 悬停提示都从已存状态取，relabel 可重跑）。
   *  可见文本 = 短名（D423–D425）；读屏名与 title = D426（{mode} 取当前档全名、{desc} 取该档释义
   *  D430–D432）——与合并 chip 同一条「可见面短、可访问名说全」的分工。M459 起提示里补上档释义
   *  （Alex 2026-10-12：档名不足以说明这一档的承诺），与浮层释义同源、不新增信息。 */
  function applyPermChip(): void {
    permChip.hidden = !permissionConfigured;
    if (!permissionConfigured) return;
    permName.textContent = permissionShortName(permMode);
    const label = t("D426", {
      mode: permissionFullName(permMode),
      desc: permissionDescription(permMode),
    });
    permChip.title = label;
    permChip.setAttribute("aria-label", label);
  }

  /** 权限浮层：每次打开现建（读数随当前语言与选中档，懒建不囤旧串）。三档单选
   *  （menuitemradio + check 格 + 当前档 accent-tint 底——M373 浮层配方），项 = 全名
   *  （D427–D429）+ 一行释义（D430–D432）。
   *
   *  change harness-permission-rules-oct23 A1 / Q6：三档下方另附「已记住的规则」段——分隔线 +
   *  段标题 + 逐条规则（等宽原文 + 删除钮）。列表为空时整段不渲染（浮层形态与无此段时一致）；
   *  规则来自后端现读（打开浮层时取），MUST NOT 用前端缓存的旧值呈现。 */
  function buildPermPop(): void {
    permPop.replaceChildren();
    permPop.setAttribute("aria-label", t("D433"));
    for (const mode of PERMISSION_MODES) {
      const checked = mode === permMode;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "lumir-hp-permpop-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(checked));
      // 语义键 = 段 + 该项 id；权限段里「id」就是权限档（read_only / vault_write / full_access），
      // 不再另立一个 `data-mode`（同一值两个属性 = 两份真源，REVIEW.md「同一语义两处真源」条）。
      item.dataset.seg = "perm";
      item.dataset.id = mode;
      appendCheck(item, checked, "lumir-hp-permpop-check");
      const body = document.createElement("span");
      body.className = "lumir-hp-permpop-body";
      const name = document.createElement("span");
      name.className = "lumir-hp-permpop-name";
      name.textContent = permissionFullName(mode);
      const desc = document.createElement("span");
      desc.className = "lumir-hp-permpop-desc";
      desc.textContent = permissionDescription(mode);
      body.append(name, desc);
      item.append(body);
      if (checked) item.classList.add("is-current");
      // stopPropagation：选择后同步重建会把本项摘出 DOM（与合并浮层同一处防误判）。
      item.addEventListener("click", (event) => {
        event.stopPropagation();
        selectPermissionMode(mode);
      });
      permPop.append(item);
    }
    if (permissionRules.length === 0) return;
    const divider = document.createElement("div");
    divider.className = "lumir-hp-permpop-divider";
    const heading = document.createElement("div");
    heading.className = "lumir-hp-permpop-heading";
    heading.textContent = t("D566");
    const list = document.createElement("div");
    list.className = "lumir-hp-permpop-rules";
    for (const rule of permissionRules) {
      const row = document.createElement("div");
      row.className = "lumir-hp-permpop-rule";
      row.dataset.rule = rule;
      const text = document.createElement("code");
      text.className = "lumir-hp-permpop-ruletext";
      text.textContent = rule;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "lumir-hp-permpop-ruledel";
      del.dataset.act = "permission-rule-remove";
      const label = t("D567", { rule });
      del.title = label;
      del.setAttribute("aria-label", label);
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.4");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("aria-hidden", "true");
      for (const d of ["M4 4 12 12", "M12 4 4 12"]) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.append(path);
      }
      del.append(svg);
      // 删除钮是浮层内的独立动作：不让点击冒泡到「浮层外点击即关」的判据之外。
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        removePermissionRule(rule);
      });
      row.append(text, del);
      list.append(row);
    }
    permPop.append(divider, heading, list);
  }

  /** 已记住的持久规则（浮层底部那段）。打开浮层时从配置现读——不用前端旧值。 */
  function refreshPermissionRules(): void {
    configGet()
      .then((snapshot) => {
        permissionRules = harnessPermissionRules(snapshot.config.harness);
        rebuildPermPopIfOpen();
      })
      .catch(() => {});
  }

  /** 删除一条规则：后端单写者写回（幂等），随后重取列表（MUST NOT 本地数组读改写）。 */
  function removePermissionRule(rule: string): void {
    harnessPermissionRuleRemove(rule)
      .then(() => refreshPermissionRules())
      .catch((e: unknown) => appendError(t("D348", { message: errorMessage(e) })));
  }

  /** 权限浮层开合（与合并浮层同一条开合语义：选定不自动关——关闭只走 chip 再点 /
   *  浮层外点击 / Esc 三条路）。打开时清掉上一份规则再现取（MUST NOT 用前端旧值呈现）。 */
  function setPermPop(open: boolean): void {
    if (open) {
      permissionRules = [];
      refreshPermissionRules();
      buildPermPop();
    }
    permPop.hidden = !open;
    permChip.setAttribute("aria-expanded", String(open));
    // 层栈登记与开合同源（change fix-escape-overlay-close-oct24 design §3.2）。
    if (open) registerEscapeLayer("harness-perm-pop", closePermPop);
    else unregisterEscapeLayer("harness-perm-pop");
    if (open) clampPermPop();
  }

  /** 权限浮层关闭的唯一实现（就地键处理器与窗口级兜底共用，E5）：收起 + 焦点回权限 chip。 */
  function closePermPop(): void {
    setPermPop(false);
    if (permChip.isConnected) permChip.focus();
  }

  /** 权限浮层重建（选定一档 / 规则列表刷新 / 写回失败回滚都走这里）：重建前记焦点语义键
   *  （段 perm + 当前档 id），重建后落回同一项——设计 §3.3 的根因面修复。 */
  function rebuildPermPopIfOpen(): void {
    if (permPop.hidden) return;
    const key = rebuildFocusKey(permPop, "perm", () => permMode);
    buildPermPop();
    clampPermPop();
    if (key !== null) focusRebuiltItem(permPop, key, permChip);
  }

  /**
   * 浮层宽度与落点的统一入口（M702，change overlay-width-contract-oct24 的 W3 / W4）：
   * 「收窄 → 换边 → 平移」只在这里实现，ctxpop / permpop / effhint / selpop / sesspop 共用
   * （此前是三份近似复制、两处完全没有夹取——REVIEW.md「同一语义两处真源」条）。
   *
   * 宽度先量自然宽（CSS 的 `width: max-content` + 档位 `max-width: <N>em`），再由纯函数
   * `placeOverlay` 裁决；跑在面板可见态内，未越界时写回的宽与量到的自然宽相同——静态形态
   * 不因本函数改变。宿主取 pane（`.lumir-harness` 有 overflow:hidden，越界即被裁）或视口
   * （`position: fixed` 的会话浮层）。
   */
  function placePop(
    el: HTMLElement,
    opts: {
      tier: OverlayTier;
      host: "pane" | "viewport";
      preferred: "left" | "right";
      leftOffset?: number;
      rightOffset?: number;
      minWidth?: number;
    },
  ): void {
    // 单测的元素替身没有布局能力（无 style / 矩形）：定位在那一层不可观测，也不该由它断言。
    if (!isLayoutCapable(el) || typeof panel.getBoundingClientRect !== "function") return;
    const natural = measureOverlayNaturalWidth(el);
    const hostRect =
      opts.host === "pane" ? panel.getBoundingClientRect() : { left: 0, width: window.innerWidth };
    const parent = el.parentElement;
    const anchor =
      parent !== null && typeof parent.getBoundingClientRect === "function"
        ? parent.getBoundingClientRect()
        : el.getBoundingClientRect();
    const placement = placeOverlay({
      tier: opts.tier,
      natural,
      host: hostRect.width,
      hostLeft: hostRect.left,
      fontSize: overlayFontSize(el),
      anchor: { left: anchor.left, right: anchor.right },
      preferred: opts.preferred,
      leftOffset: opts.leftOffset,
      rightOffset: opts.rightOffset,
      minWidth: opts.minWidth,
    });
    applyOverlayPlacement(el, placement);
  }

  /** 权限浮层的边界收编（O1/O2 / W1–W4）：P 档、默认左锚（`left: 0`）向右展开。
   *  旧形态的问题只有「缺可读上限、收窄靠手写」——现在宽度与换边 / 平移都走 placePop。 */
  function clampPermPop(): void {
    placePop(permPop, { tier: "prose", host: "pane", preferred: "left" });
  }

  /** 合并选择器浮层（L 档）：此前完全没有夹取——2.13 档 + 320px pane 实测越出面板 85px
   *  并被祖先裁掉（M698 §3.4）。 */
  function placeSelPop(): void {
    placePop(selPop, { tier: "list", host: "pane", preferred: "left" });
  }

  /** effort 不支持 hint（P 档）：与 ctxpop 同款，此前定宽 224px、没有夹取。 */
  function placeEffHint(): void {
    placePop(effHint, { tier: "prose", host: "pane", preferred: "left" });
  }

  /** 选择权限档：chip 先更新读数（chip = 人侧可见面），写回失败则回滚——与 selectProvider
   *  同口径（运行期态不与文件态分叉 + 错误行）。写回 `[harness].permission_mode`：**对下一个
   *  判定生效，不打断进行中的轮次**（后端每轮现读配置，前端只落盘，不做任何在途轮次的干预）。 */
  function selectPermissionMode(mode: PermissionMode): void {
    if (mode === permMode) return;
    const previous = permMode;
    permMode = mode;
    applyPermChip();
    rebuildPermPopIfOpen();
    configSetValue("harness", "permission_mode", mode).catch((e: unknown) => {
      permMode = previous;
      applyPermChip();
      rebuildPermPopIfOpen();
      appendError(t("D348", { message: errorMessage(e) }));
    });
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
    // 段 = provider：键的 id 取**状态里的当前值**（成功 = 新 provider；回滚后 = 旧 provider）——
    // MUST NOT 用点击目标（design D3）。
    rebuildSelPopIfOpen("provider");
    configSetValue("harness", "provider", id).then(() => {
      refreshThinkingState();
    }).catch((e: unknown) => {
      selSelection!.provider = previous;
      applySelChip();
      rebuildSelPopIfOpen("provider");
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
    rebuildSelPopIfOpen("model");
    configSetValue("harness", `providers.${provider}.model`, id).then(() => {
      refreshThinkingState();
    }).catch((e: unknown) => {
      const dimBack = selSelection!.models[provider as ProviderId];
      if (dimBack !== undefined) dimBack.current = previous;
      applySelChip();
      // 回滚后的重建：键取回滚后的当前 model（不是失败的新 model）——焦点因此落回旧项。
      rebuildSelPopIfOpen("model");
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
    rebuildSelPopIfOpen("effort");
    harnessSetThinkingEffort(id).catch((e: unknown) => {
      thinkLevel = previous;
      applySelChip();
      rebuildSelPopIfOpen("effort");
      appendError(t("D348", { message: errorMessage(e) }));
    });
  }

  modelChip.addEventListener("click", (event) => {
    event.stopPropagation();
    // 两个浮层不同时开：开一个即收另一个（各自的开合语义不变）。
    setPermPop(false);
    setSelPop(selPop.hidden);
  });

  permChip.addEventListener("click", (event) => {
    event.stopPropagation();
    setSelPop(false);
    setPermPop(permPop.hidden);
  });

  // effort 不支持的 hover hint：mouseenter 读数翻出（仅置灰态），mouseleave 收回——
  // 与 ctx 读数 hover 泡同一形态（M370）。键盘用户无 hover：不支持语义已由读屏名（D390）承担。
  effReading.addEventListener("mouseenter", () => {
    if (!effReading.classList.contains("is-disabled")) return;
    setEffHintVisible(true);
    // M702：翻出后按 pane 收编（此前定宽 224px、没有任何夹取）。
    placeEffHint();
  });
  effReading.addEventListener("mouseleave", () => {
    setEffHintVisible(false);
  });

  // 控制行数据装载：config_get 宽容提取——合并选择器（harness 段缺失 / providers 不合形
  // → chip 隐藏，不伪造读数）与权限档（harness 段在场即显示；档位本身有缺省，见
  // harnessPermissionMode）。两条独立判据：providers 不合形不该连带隐藏权限 chip。
  configGet()
    .then((snapshot) => {
      const harness = snapshot.config.harness;
      permissionConfigured = typeof harness === "object" && harness !== null;
      permMode = harnessPermissionMode(harness);
      applyPermChip();
      const selection = harnessSelection(harness);
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

  /** 轻量重取用量读数（会话恢复后，M526）：恢复铸的新会话已灌回源会话的读数（留存重算：
   *  最近一次真实读数 + 会话累计种子）——这里经 harness_state 快照把 `usage` / `warn_ctx_pct`
   *  应用进读数区（与 restoreSnapshot 同一 usageReadings 映射），**不回放消息、不动 transcript**
   *  （那是 resumeSession 刚完成的活，restoreSnapshot 的全量路径会双份渲染历史）。从未发过请求
   *  的会话快照 `has_usage=false` ⇒ 读数区保持隐藏（applyUsage 的门，不假读数）。快照准入判据
   *  与全量恢复同一条（迟到的旧 vault 响应在此同样被丢）。 */
  function refreshUsageState(): void {
    void harnessState()
      .then((json) => {
        let snapshot: unknown;
        try {
          snapshot = JSON.parse(json);
        } catch {
          return;
        }
        if (typeof snapshot !== "object" || snapshot === null) return;
        const state = snapshot as Record<string, unknown>;
        if (!inCurrentVault(state.vault, currentVault)) return;
        const usage = state.usage;
        if (typeof usage === "object" && usage !== null) {
          applyUsageReadings(usageReadings(usage));
        }
        const warn = state.warn_ctx_pct;
        if (typeof warn === "number" && Number.isFinite(warn)) warnCtxPct = warn;
        applyUsage();
      })
      .catch(() => {});
  }

  /** usage 读数落状态（M443）：事件路径与快照路径**同一处入口**——两条通道喂进来的是同一种
   *  `UsageReadings`（键名映射见 [`usageReadings`]），一处赋值就不可能出现「事件面与快照面
   *  读数不一致」（REVIEW.md 「同一语义两处真源」条）。整体覆盖是刻意的：本轮没有的键落 null，气泡对应行
   *  随之不渲染，不残留上一轮的值。 */
  function applyUsageReadings(readings: UsageReadings): void {
    lastUsage = readings.ctx;
    lastCache = readings.cacheSession;
    lastCacheTurn = readings.cacheTurn;
    lastCacheNote = readings.cacheNote;
    lastCacheWrite = readings.cacheWrite;
    lastCacheWriteSession = readings.cacheWriteSession;
    lastInputTokens = readings.inputTokens;
    lastCachedTokens = readings.cachedTokens;
    lastCachedTokensSession = readings.cachedTokensSession;
    lastContextWindow = readings.contextWindow;
    lastHasUsage = readings.hasUsage;
  }

  /** 组装当前读数对象（applyUsageReadings 的逆操作）：ctxPopRows 的输入，气泡行文本唯一的
   *  消费组装点——渲染面与单测喂的是同一种 UsageReadings。 */
  function currentUsageReadings(): UsageReadings {
    return {
      ctx: lastUsage,
      cacheSession: lastCache,
      cacheTurn: lastCacheTurn,
      cacheNote: lastCacheNote,
      cacheWrite: lastCacheWrite,
      cacheWriteSession: lastCacheWriteSession,
      inputTokens: lastInputTokens,
      cachedTokens: lastCachedTokens,
      cachedTokensSession: lastCachedTokensSession,
      contextWindow: lastContextWindow,
      hasUsage: lastHasUsage,
    };
  }

  // ── 不持焦的两层：Context hover 泡与 effort 提示（change fix-escape-overlay-close-oct24）──
  //
  // 它们也登记进层栈（design §3.5）：Escape 要能只收它们、且**不动焦点**（E2）。可见态因此
  // 只能经这两个函数改写——`hidden` 的裸赋值会让层栈与真实可见态脱节（「层已关还在栈里」）。

  /** Context hover 泡可见态（唯一写入口；登记 / 注销与之同源）。 */
  function setCtxPopVisible(visible: boolean): void {
    ctxPop.hidden = !visible;
    if (visible) registerEscapeLayer("harness-ctx-pop", closeCtxPop);
    else unregisterEscapeLayer("harness-ctx-pop");
  }

  /** Context hover 泡关闭的唯一实现：只隐藏，不移动焦点（本就不持焦）。 */
  function closeCtxPop(): void {
    setCtxPopVisible(false);
  }

  /** effort 提示可见态（唯一写入口；登记 / 注销与之同源）。 */
  function setEffHintVisible(visible: boolean): void {
    effHint.hidden = !visible;
    if (visible) registerEscapeLayer("harness-eff-hint", closeEffHint);
    else unregisterEscapeLayer("harness-eff-hint");
  }

  /** effort 提示关闭的唯一实现：只隐藏，不移动焦点。 */
  function closeEffHint(): void {
    setEffHintVisible(false);
  }

  /** 面板本体关闭的唯一实现（层栈里 harness-panel 那一层的 close）：走装配层 `deps.togglePane`
   *  ——账本收 pane + 焦点归还都在那边，MUST NOT 在这里直接 `panel.remove()`（那会绕开账本，
   *  留下一个「已摘出 DOM 但账本仍记为在场」的 pane）。已收起时是空动作：层注销也由
   *  `attachTo(null)` 负责，兜底在它之后再调一次不得把面板重新打开。 */
  function closeHarnessPanel(): void {
    if (mountEl === null) return;
    deps.togglePane();
  }

  /** ctx% 读数重渲（usage 事件 / 快照 / relabel 的共用出口）。M370：读数 = D334 双读数
   *  「{ctx}% · {cache}%」（分隔符 U+00B7，cache 缺失回落单读数）；越线高亮不动。
   *  M373：hover 浮层常驻含义句；M378 改两行带值形态（D395 第一行 + D401 第二行，
   *  越线时 D335 警示句追加其下）并按面板边界收编（clampCtxPop）。浮层内容在 hover 时现建。
   *  **M443：D334 的 `{cache}` 口径改为会话累计命中率**（`lastCache` 语义随之改准）——
   *  形态与回落口径、越线高亮（usageOverWarn）一律不变。
   *  **M533：气泡行集精简为「usage 行 + 会话命中率行 + 越线警示行」**——本回合值不再有任何
   *  上屏面（控制行与气泡都不显示），只留在 wire 留存里。
   *  **M526：`has_usage === false`（从未发过请求的会话）读数区整体隐藏**——六键零值是缺省
   *  不是读数，渲染即成「0% · 0%」虚报；`has_usage` 缺键（旧载荷）维持旧行为。 */
  function applyUsage(): void {
    if (lastUsage === null || lastHasUsage === false) {
      ctxWrap.hidden = true;
      setCtxPopVisible(false);
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

  /** ctx hover 浮层内容现建（行文本在纯模型层 [`ctxPopRows`] 产出，此处只落 DOM）：
   *  第一行上下文窗口占用（绝对值 tokens 形态 D463 / 无上限降级 D464 / 旧载荷百分比形态
   *  D395）、第二行会话缓存命中率（D465，只百分比）；越线时警示句（D335）追加在最后
   *  （追加行为保留）。M533 起本回合命中行 / 缓存写入行 / 成因句已退场——本回合值与缓存写入
   *  仍进 wire 留存，只是不再上屏。 */
  function buildCtxPop(): void {
    ctxPop.replaceChildren();
    for (const row of ctxPopRows(currentUsageReadings(), warnCtxPct)) {
      const el = document.createElement("div");
      el.className = row.cls;
      el.textContent = row.text;
      ctxPop.append(el);
    }
  }

  /** hover 泡边界收编（M378 起；M702 改走统一入口）：默认锚 `right: -18px`、P 档内容驱动
   *  + 34em 上限，祖先 `.lumir-harness` 有 overflow:hidden——窄 pane 下先收窄、再换边、
   *  最后才平移。旧形态「定宽 224 + 只缩不放」让真实读数与放大档必折行（M698 §3.2）。 */
  function clampCtxPop(): void {
    placePop(ctxPop, { tier: "prose", host: "pane", preferred: "right", rightOffset: 18 });
  }

  // hover 浮层（M370 形态，M373 扩内容，M378 两行带值 + 边界收编）：mouseenter 读数翻出
  // （第一行 ctx 占用、第二行 cache 命中，越线时追加警示句）、mouseleave 收回。键盘用户
  // 无 hover：警示语义已由读数高亮承担，含义句是补充说明，不挂 focusable 入口。
  ctxWrap.addEventListener("mouseenter", () => {
    buildCtxPop();
    setCtxPopVisible(true);
    clampCtxPop();
  });
  ctxWrap.addEventListener("mouseleave", () => {
    setCtxPopVisible(false);
  });

  /** W6：pane / 视口尺寸变化后，仍打开的浮层重新夹取（幂等；隐藏的浮层不动）。
   *  拖分隔条 / 窗口缩放都落在这里——旧实现只在翻出的那一刻算一次，pane 收窄后已开的浮层
   *  会停在越界位置（`.lumir-harness` 的 overflow:hidden 会把越界部分裁掉）。面板单例长驻，
   *  观察器在构造期注册、不随 attach / detach 增删（同 transcriptResize 的口径）。 */
  function reclampOpenOverlays(): void {
    if (!panel.isConnected || panel.hidden) return;
    if (!ctxPop.hidden) clampCtxPop();
    if (!permPop.hidden) clampPermPop();
    if (!selPop.hidden) placeSelPop();
    if (!effHint.hidden) placeEffHint();
    if (!sessPop.hidden) placeSessPop();
  }
  const overlayResize = new ResizeObserver(() => reclampOpenOverlays());
  overlayResize.observe(panel);
  window.addEventListener("resize", () => reclampOpenOverlays());

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
  // 滚动位只有两个出口（M644，design §3.1 的分流表，MUST NOT 出现第三类）：
  //   - 内容增长 → `follow.contentGrew()`（following 贴底、detached 只更新未读）；
  //   - 强制回底白名单（发送消息 / 快照重建 / 恢复会话 / 重新打开面板）→ `follow.jumpToBottom()`。

  function syncEmptyHint(): void {
    if (transcript.childElementCount === 0 && !transcript.contains(emptyHint)) {
      transcript.append(emptyHint);
    } else if (transcript.childElementCount > 1 && transcript.contains(emptyHint)) {
      emptyHint.remove();
    }
  }

  // ── 消息 meta 行（M351，design §3.1/§4）：who（角色）+ when（时间读数）─────────────
  /** 建 who 行：角色 span + 可选 when span（at = 消息时间戳 ms；null = 无戳不建——缺 ts 的
   *  旧快照只显示角色，不伪造读数）。when 文本 = 「· 」间隔号（i18n-exempt 标点）+ 读数，
   *  读数形态按 `form`（M460：live = 上屏打戳、restored = 恢复重放）经 [`whenTextOf`] 取值；
   *  初始值立即算一次（不等 30s 刷新拍），形态落 dataset 供重绘读回（两处同源）。 */
  function createWhoLine(
    role: "user" | "assistant",
    at: number | null,
    form: WhenForm = "live",
  ): HTMLElement {
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
      when.dataset.whenForm = form;
      when.textContent = whenTextOf(at, Date.now(), form);
      who.append(when);
    }
    return who;
  }

  /** who/when 重绘共用出口：30s 定时器与 applyLabels（语言切换）都走这里——角色名随语言、
   *  when 随时间与语言重算（读数形态按 dataset 里那份读回，不重算——M460）；消息正文不改写。 */
  function refreshWhoLines(): void {
    const now = Date.now();
    for (const who of transcript.querySelectorAll<HTMLElement>(".lumir-hp-who")) {
      const roleEl = who.querySelector(".lumir-hp-role");
      if (roleEl !== null) roleEl.textContent = t(who.dataset.role === "user" ? "D385" : "D386");
      const when = who.querySelector<HTMLElement>(".lumir-hp-when");
      if (when?.dataset.ts !== undefined) {
        const form: WhenForm = when.dataset.whenForm === "restored" ? "restored" : "live";
        when.textContent = whenTextOf(Number(when.dataset.ts), now, form);
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
   * 复制钮的源，非渲染后 HTML。at = 消息时间戳（缺 ts 传 null：不显示 when）；form = 读数
   * 形态（M460：live = 本轮上屏打戳、restored = 快照 / 会话恢复重放）。
   * M351：结构 = who 行 + body 体（气泡样式挂 body，design §3.1）。
   */
  function appendUserMessage(
    blocks: readonly ComposerBlock[],
    source: string,
    at: number | null,
    form: WhenForm = "live",
  ): void {
    collapseTools(); // 新用户消息 = 上一轮终态（幂等，无在途块时无操作）
    const el = document.createElement("div");
    el.className = "lumir-hp-msg lumir-hp-msg-user";
    el.append(createWhoLine("user", at, form));
    const body = document.createElement("div");
    body.className = "lumir-hp-body";
    // 编号一次算出（与 composer 侧同源）：transcript 上每条消息各按自己的图序显示编号——
    // 消息发出即冻结其图序（change composer-image-mention design §6）。
    const ordinals = imageOrdinals(blocks);
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (block.kind !== "paragraph") {
        body.append(createCardEl(block.card, "transcript", ordinals.get(index) ?? null));
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
    follow.jumpToBottom(); // 分流表 #1：用户发送 = 白名单动作，新消息必须在眼前
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
  /** 工具行的参数格：`args` 是**展示文本**（人话化后的参数摘要；不重写）。
   *  `targets` 是结构化参数里取到的路径目标（change harness-path-link）——只把命中目标索引的
   *  目标切成可点元素（文件走打开、目录走左栏定位，change harness-dir-link），其余文本（含同一
   *  格里的命令 / 箭头 / 截断摘要）逐字落地。 */
  function createToolText(
    name: string,
    args: string,
    tail?: string,
    targets: readonly ToolPathTarget[] = [],
  ): HTMLElement {
    const text = document.createElement("span");
    text.className = "lumir-hp-tool-text";
    const nameEl = document.createElement("span");
    nameEl.className = "lumir-hp-tool-name";
    nameEl.textContent = name;
    text.append(nameEl);
    if (args !== "") {
      const argsEl = document.createElement("span");
      argsEl.className = "lumir-hp-tool-args";
      if (targets.length === 0) {
        argsEl.textContent = args;
      } else {
        for (const segment of splitToolText(args, targets)) {
          const kind = segment.target === undefined ? null : pathKindOf(segment.target.path);
          if (segment.target !== undefined && kind !== null) {
            argsEl.append(
              createPathLinkEl(
                segment.text,
                { path: segment.target.path, kind, line: segment.target.line },
                pathLinks,
              ),
            );
          } else {
            argsEl.append(document.createTextNode(segment.text));
          }
        }
      }
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
  /** `task` 调用的参数摘要 → agent / description（宽容解析：摘要超 80 字被截断时不是合法
   *  JSON，退回正则兜底；都取不到就留空，不伪造）。 */
  function taskArgsOf(summary: string): { agent: string; description: string } {
    try {
      const parsed: unknown = JSON.parse(summary);
      if (typeof parsed === "object" && parsed !== null) {
        const value = parsed as Record<string, unknown>;
        const agent = typeof value.agent === "string" ? value.agent : "";
        const description = typeof value.description === "string" ? value.description : "";
        if (agent !== "") return { agent, description };
      }
    } catch {
      // 截断后的摘要不是合法 JSON：走正则兜底。
    }
    return {
      agent: /"agent"\s*:\s*"([^"]+)"/.exec(summary)?.[1] ?? "",
      description: /"description"\s*:\s*"([^"]*)"/.exec(summary)?.[1] ?? "",
    };
  }

  /** transcript 的 `task` 行（design §12.2 第 2 条 / §19.1）：行内容 = task 徽章 + agent +
   *  description + 终态词（运行中由脉冲点承载）；状态只由 run 视图驱动。 */
  function renderTaskToolRow(entry: TaskRowEntry, run: SubrunView | null, failure?: string): void {
    const args = taskArgsOf(entry.argsSummary);
    entry.row.classList.remove("is-running", "is-done", "is-fail", "is-waiting");
    let icon: HTMLElement;
    let tail: string | undefined;
    if (run !== null) {
      icon = taskIcon(run.status);
      tail = run.status === "running" ? undefined : subrunStatusWord(run.status);
      entry.row.classList.add(
        run.status === "running"
          ? "is-running"
          : run.status === "waiting" || run.status === "partial"
            ? "is-waiting"
            : run.status === "done"
              ? "is-done"
              : "is-fail",
      );
    } else {
      icon = createToolIcon(failure === undefined ? "running" : "fail");
      tail = failure;
      entry.row.classList.add(failure === undefined ? "is-running" : "is-fail");
    }
    const text = document.createElement("span");
    text.className = "lumir-hp-tool-text";
    const nameEl = document.createElement("span");
    nameEl.className = "lumir-hp-tool-name";
    nameEl.textContent = "task";
    const agentEl = document.createElement("span");
    agentEl.className = "lumir-hp-task-agent";
    agentEl.textContent = run?.agent ?? args.agent;
    const descEl = document.createElement("span");
    descEl.className = "lumir-hp-tool-args";
    descEl.textContent = run?.description ?? args.description;
    text.append(nameEl, document.createTextNode(" "), agentEl, document.createTextNode(" "), descEl);
    if (tail !== undefined && tail !== "") {
      const tailEl = document.createElement("span");
      tailEl.className = "lumir-hp-tool-out";
      tailEl.textContent = `· ${tail}`;
      text.append(document.createTextNode(" "), tailEl);
    }
    entry.row.replaceChildren(icon, text);
  }

  /** `task` 行的展开详情（tasks §10.2：模型、轮次 / 步数、最近一步、用时、摘要、触顶原因）。
   *  折叠时清空（下次展开重算），不做后台 DOM 维护。 */
  function renderTaskRowDetail(entry: TaskRowEntry, run: SubrunView | null): void {
    entry.detail.replaceChildren();
    if (!entry.open || run === null) return;
    const meta = document.createElement("div");
    meta.className = "lumir-hp-task-meta";
    const metaParts: string[] = [];
    if (run.model !== "") metaParts.push(t("D495", { model: run.model }));
    metaParts.push(t("D496", { rounds: run.rounds, steps: run.toolCalls || run.steps.length }));
    if (run.elapsedMs > 0) metaParts.push(t("D497", { duration: formatDuration(run.elapsedMs) }));
    if (run.stoppedBy !== null) {
      metaParts.push(t("D498", { reason: subrunStoppedByWord(run.stoppedBy) }));
    }
    meta.textContent = metaParts.join(" · ");
    entry.detail.append(meta);
    const latest = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null;
    if (latest !== null) {
      const line = document.createElement("div");
      line.className = "lumir-hp-task-latest";
      const label = document.createElement("span");
      label.className = "lumir-tp-label";
      label.textContent = `${t("D500")} `;
      line.append(label, document.createTextNode(`${latest.tool} ${latest.summary}`));
      entry.detail.append(line);
    }
    if (run.summary !== null && run.summary.trim() !== "") {
      const summary = document.createElement("div");
      summary.className = "lumir-hp-task-sum";
      const label = document.createElement("span");
      label.className = "lumir-tp-label";
      label.textContent = `${t("D499")} `;
      summary.append(label, document.createTextNode(run.summary));
      entry.detail.append(summary);
    }
  }

  /** run → transcript 行绑定（agent 名优先、FIFO 兜底）：没有可绑的行时补一条独立行
   *  （快照恢复 / 事件缺口下也要让历史任务的详情可达）。 */
  function taskRowFor(run: SubrunView): TaskRowEntry {
    const bound = taskRowEntries.find((entry) => entry.runId === run.runId);
    if (bound !== undefined) return bound;
    const match =
      taskRowEntries.find(
        (entry) =>
          entry.runId === null && !entry.settled && taskArgsOf(entry.argsSummary).agent === run.agent,
      ) ?? taskRowEntries.find((entry) => entry.runId === null && !entry.settled);
    if (match !== undefined) {
      match.runId = run.runId;
      bindTaskRowToggle(match);
      return match;
    }
    const block = ensureToolsBlock();
    const wrap = document.createElement("div");
    wrap.className = "lumir-hp-taskwrap";
    const row = document.createElement("div");
    row.className = "lumir-hp-tool-row is-task is-running";
    const detail = document.createElement("div");
    detail.className = "lumir-hp-task-detail";
    detail.hidden = true;
    wrap.append(row, detail);
    block.el.append(wrap);
    block.rows.push(wrap);
    const entry: TaskRowEntry = {
      wrap,
      row,
      detail,
      argsSummary: "",
      runId: run.runId,
      settled: false,
      open: false,
      renderDetail: null,
    };
    taskRowEntries.push(entry);
    bindTaskRowToggle(entry);
    return entry;
  }

  /** 恢复路径的 `task` 结果信封（`tool` 记录的 `text` 是 JSON）：宽容解析，取不到 agent 即 null。 */
  function taskEnvelopeOf(text: unknown): Record<string, unknown> | null {
    if (typeof text !== "string" || text === "") return null;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null) return null;
      const value = parsed as Record<string, unknown>;
      if (typeof value.agent !== "string") return null;
      return value;
    } catch {
      return null;
    }
  }

  /** 恢复出的 `task` 行（历史任务）：行只给 agent + 终态词，详情给模型 / 轮次 / 摘要 / 用量。 */
  function renderRestoredTaskRow(entry: TaskRowEntry, envelope: Record<string, unknown>): void {
    const statusRaw = typeof envelope.status === "string" ? envelope.status : "";
    const status = subrunStatusOf(statusRaw);
    const agent = typeof envelope.agent === "string" ? envelope.agent : "";
    const failed = envelope.ok === false || status === "failed" || statusRaw === "";
    const tail = failed
      ? typeof envelope.message === "string"
        ? envelope.message
        : typeof envelope.code === "string"
          ? envelope.code
          : undefined
      : status === null
        ? statusRaw
        : subrunStatusWord(status);
    entry.row.classList.remove("is-running", "is-done", "is-fail", "is-waiting");
    entry.row.classList.add(
      status === "running"
        ? "is-running"
        : status === "waiting" || status === "partial"
          ? "is-waiting"
          : status === "done"
            ? "is-done"
            : "is-fail",
    );
    const text = document.createElement("span");
    text.className = "lumir-hp-tool-text";
    const nameEl = document.createElement("span");
    nameEl.className = "lumir-hp-tool-name";
    nameEl.textContent = "task";
    const agentEl = document.createElement("span");
    agentEl.className = "lumir-hp-task-agent";
    agentEl.textContent = agent;
    text.append(nameEl, document.createTextNode(" "), agentEl);
    if (tail !== undefined && tail !== "") {
      const tailEl = document.createElement("span");
      tailEl.className = "lumir-hp-tool-out";
      tailEl.textContent = `· ${tail}`;
      text.append(document.createTextNode(" "), tailEl);
    }
    entry.row.replaceChildren(
      failed ? createToolIcon("fail") : status === "running" ? createToolIcon("running") : createToolIcon("done"),
      text,
    );
    entry.renderDetail = () => {
      entry.detail.replaceChildren();
      const meta = document.createElement("div");
      meta.className = "lumir-hp-task-meta";
      const parts: string[] = [];
      if (typeof envelope.model === "string" && envelope.model !== "") {
        parts.push(t("D495", { model: envelope.model }));
      }
      const rounds = typeof envelope.rounds === "number" ? envelope.rounds : 0;
      const steps = typeof envelope.tool_calls === "object" && envelope.tool_calls !== null
        ? Object.keys(envelope.tool_calls as Record<string, unknown>).length
        : 0;
      parts.push(t("D496", { rounds, steps }));
      if (typeof envelope.stopped_by === "string") {
        parts.push(t("D498", { reason: subrunStoppedByWord(envelope.stopped_by) }));
      }
      meta.textContent = parts.join(" · ");
      entry.detail.append(meta);
      if (typeof envelope.summary === "string" && envelope.summary.trim() !== "") {
        const summary = document.createElement("div");
        summary.className = "lumir-hp-task-sum";
        const label = document.createElement("span");
        label.className = "lumir-tp-label";
        label.textContent = `${t("D499")} `;
        summary.append(label, document.createTextNode(envelope.summary));
        entry.detail.append(summary);
      }
    };
  }

  /** 行点击展开 / 收起详情（键盘等价）。 */
  function bindTaskRowToggle(entry: TaskRowEntry): void {
    entry.row.classList.add("is-task");
    entry.row.setAttribute("role", "button");
    entry.row.tabIndex = 0;
    entry.row.setAttribute("aria-expanded", String(entry.open));
    const toggle = (): void => {
      entry.open = !entry.open;
      entry.row.setAttribute("aria-expanded", String(entry.open));
      entry.detail.hidden = !entry.open;
      if (!entry.open) return;
      if (entry.renderDetail !== null) {
        entry.renderDetail();
        return;
      }
      const current = subruns.find((run) => run.runId === entry.runId) ?? null;
      renderTaskRowDetail(entry, current);
    };
    entry.row.addEventListener("click", toggle);
    entry.row.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  }

  /** run 事件 → transcript 行的就地更新（行不重排、不因完成顺序换位）。 */
  function refreshTaskRow(run: SubrunView): void {
    const entry = taskRowFor(run);
    renderTaskToolRow(entry, run);
    renderTaskRowDetail(entry, run);
  }

  function appendToolCall(name: string, status: "started" | "done", summary: string): void {
    // `task` 工具行由 run 事件驱动终态（design §12.2 第 2 条：行在调用时创建、之后只就地更新）。
    // 通用 done 配对会把并行多调用的行配错（`block.running` 只有一个），因此单独一条路径。
    if (name === "task") {
      if (status === "started") {
        const block = ensureToolsBlock();
        const wrap = document.createElement("div");
        wrap.className = "lumir-hp-taskwrap";
        const row = document.createElement("div");
        row.className = "lumir-hp-tool-row is-task is-running";
        const detail = document.createElement("div");
        detail.className = "lumir-hp-task-detail";
        detail.hidden = true;
        wrap.append(row, detail);
        block.el.append(wrap);
        block.rows.push(wrap);
        const entry: TaskRowEntry = {
          wrap,
          row,
          detail,
          argsSummary: summary,
          runId: null,
          settled: false,
          open: false,
          renderDetail: null,
        };
        taskRowEntries.push(entry);
        renderTaskToolRow(entry, null);
        syncEmptyHint();
        follow.contentGrew();
        return;
      }
      // done：只收「没绑到 run」的行（被闸拒 / 参数非法）；已绑定行的终态由 run 事件驱动。
      const entry = taskRowEntries.find((row) => row.runId === null && !row.settled);
      if (entry !== undefined) {
        entry.settled = true;
        renderTaskToolRow(entry, null, summary);
      }
      syncEmptyHint();
      follow.contentGrew();
      return;
    }
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
      follow.contentGrew();
      return;
    }
    const block = ensureToolsBlock();
    if (status === "started") {
      const row = document.createElement("div");
      row.className = "lumir-hp-tool-row is-running";
      row.append(
        createToolIcon("running"),
        createToolText(name, humanizeToolArgs(name, summary), undefined, toolPathTargetsOf(name, summary)),
      );
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
        // 参数格恒取 `started` 那份**参数摘要**（M528 r1）：`args` 与行的成败无关——失败文本
        // 走第三参（尾注），故两侧同走参数格口径（`toolArgsText`）。旧写法在失败侧用严格版
        // （判据「是 JSON 才取参数」），而 M528 起 core 的成品摘要不是 JSON ⇒ 失败行的参数格
        // 整格空掉、命令本体消失（修前的可见性本来就分两半：arguments ≤80 字的调用严格版能
        // 解析出命令、看得见；>80 字的调用原文截断后照样看不见——M528 与这处一并收口）。
        createToolText(name, toolArgsText(name, args), failed ? summary : undefined, toolPathTargetsOf(name, args)),
      );
    } else {
      // 无 running 行（乱序 done / 桩环境）：没有更早的那份摘要可用，done 原文按形状判定。
      const failed = TOOL_FAILED_SUMMARY.test(summary);
      const row = document.createElement("div");
      row.className = failed ? "lumir-hp-tool-row is-fail" : "lumir-hp-tool-row is-done";
      row.append(
        createToolIcon(failed ? "fail" : "done"),
        createToolText(
          name,
          humanizeToolArgsStrict(name, summary),
          failed ? summary : undefined,
          toolPathTargetsOf(name, summary),
        ),
      );
      block.el.append(row);
      block.rows.push(row);
    }
    syncEmptyHint();
    follow.contentGrew();
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
    follow.contentGrew();
  }

  function appendError(text: string): void {
    // 同文案去重（design §6）：同一原因的反复报错就地滚回视野，不追加堆叠（Alex 真机
    // 同一错误曾堆 6 条）。元素被 resetView 清掉后引用同步失效（transcript.contains 复核）。
    if (lastErrorEl !== null && lastErrorText === text && transcript.contains(lastErrorEl)) {
      // 分流表 #7：就地替换、内容高度可能不变——detached 下点亮未读（spec「脱离态下重复错误
      // 不拽走视口」要求未读提示在场），following 下滚到可见；两态都不写滚动位以外的东西。
      follow.contentReplaced();
      return;
    }
    const el = document.createElement("div");
    el.className = "lumir-hp-error";
    el.textContent = text;
    transcript.append(el);
    lastErrorEl = el;
    lastErrorText = text;
    syncEmptyHint();
    follow.contentGrew();
  }

  // ── 批准闸 ───────────────────────────────────────────────────────────────
  /** 批准卡问句与副句（M406 收敛版，文案分工见 copy-data D339 上方注释）：问句按工具名
   *  分发（cli_run / vault_create / vault_patch 各有专句，其它工具回落 D415）；副句只剩
   *  写类（diff → D413）——命令类副句 D414 随 M540 删除，命令类卡片因此无副句。 */
  function approvalAskOf(tool: string, hasDiff: boolean): { ask: string; sub: string | null } {
    const ask =
      tool === "cli_run"
        ? t("D340")
        : tool === "vault_create"
          ? t("D412")
          : tool === "vault_patch"
            ? t("D339")
            : t("D415", { tool });
    const sub = hasDiff ? t("D413") : null;
    return { ask, sub };
  }

  function relabelApproval(pending: PendingApproval): void {
    const { ask, sub } = approvalAskOf(pending.tool, pending.diff !== undefined);
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
    // 判定依据行（M459）是 chrome 文案（档名 / 档释义 / 包装器句式都要译文），随语言重取；
    // 元素只在构建时按「有依据」决定建不建（不伪造），这里只重写文本。
    const basis = pending.element.querySelector(".lumir-hp-approval-basis");
    const basisText = approvalReasonText(pending.reason);
    if (basis !== null && basisText !== null) basis.textContent = basisText;
    // 定时任务要素块的键名 / 档位词 / 注册日口径都是 chrome 文案，随语言重跑（元素不重建）。
    const cronEl = pending.element.querySelector<HTMLElement>(".lumir-hp-approval-cron");
    if (cronEl !== null && pending.cronTask !== undefined) {
      renderCronTaskBlock(cronEl, pending.cronTask);
    }
    // 待决行的「等待批准」尾注同口径重取（行是交互中的 UI，不是历史记录）；argsText 是
    // 数据（命令 / 文件名），不译文。路径目标随行重建（结构化参数 → 可点段）。
    pending.row.replaceChildren(
      createToolIcon("running"),
      createToolText(pending.tool, pending.argsText, t("D416"), pending.targets),
    );
    // vault_delete 的后果说明（D435）是 chrome 文案，随语言重取。
    const note = pending.element.querySelector(".lumir-hp-approval-note");
    if (note !== null) note.textContent = t("D435");
    const reason = pending.element.querySelector<HTMLTextAreaElement>(".lumir-hp-reason");
    if (reason !== null) {
      reason.placeholder = t("D338");
      reason.setAttribute("aria-label", t("D338"));
    }
    const approve = pending.element.querySelector("button[data-act=approve]");
    const reject = pending.element.querySelector("button[data-act=reject]");
    if (approve !== null) approve.textContent = t("D336");
    if (reject !== null) reject.textContent = t("D337");
    const remember = pending.element.querySelector("button[data-act=approve-remember]");
    if (remember !== null) {
      const label = pending.remember;
      remember.textContent = label === undefined ? t("D434") : approvalRememberText(label);
    }
    // 「以后都允许 <规则>」同口径重取（规则原文是后端算出来的数据，插值进 chrome 句式）。
    const persist = pending.element.querySelector("button[data-act=approve-persist]");
    if (persist !== null && pending.persistRule !== undefined) {
      persist.textContent = t("D564", { rule: pending.persistRule });
    }
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
      createToolText(pending.tool, pending.argsText, undefined, pending.targets),
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

  /** 批准卡的两枚次级动作（change harness-permission-rules-oct23 design §5 / §6.1）。
   *  **唯一构建点**：transcript 卡片与任务区卡片共用同一段（禁止各写一份）。
   *
   *  - `remember` = 会话记忆粒度（D565，带 `{prefix}`；空串回退 D434）；
   *  - `persistRule` = 持久规则原文（D564，带 `{rule}`）。
   *
   *  两字段缺省 / null 一律不渲染该按钮——字段是渲染的唯一开关，前端 MUST NOT 按
   *  `reason.kind` 自行推断（危险层两项皆缺省，快照恢复因此不会复活死按钮，D3 裁决）。 */
  function createApprovalSecondaryActions(
    actions: { remember?: string | undefined; persistRule?: string | undefined },
    onPick: (remember: boolean, persistRule: boolean) => void,
  ): {
    row: HTMLElement;
    rememberButton: HTMLButtonElement | null;
    persistButton: HTMLButtonElement | null;
  } | null {
    const { remember, persistRule } = approvalSecondaryActions(actions);
    if (remember === undefined && persistRule === undefined) return null;
    const row = document.createElement("div");
    row.className = "lumir-hp-approval-remember";
    let rememberButton: HTMLButtonElement | null = null;
    let persistButton: HTMLButtonElement | null = null;
    if (remember !== undefined) {
      rememberButton = document.createElement("button");
      rememberButton.type = "button";
      rememberButton.className = "lumir-hp-remember";
      rememberButton.dataset.act = "approve-remember";
      rememberButton.textContent = approvalRememberText(remember);
      rememberButton.addEventListener("click", () => onPick(true, false));
      row.append(rememberButton);
    }
    if (persistRule !== undefined) {
      persistButton = document.createElement("button");
      persistButton.type = "button";
      persistButton.className = "lumir-hp-remember";
      persistButton.dataset.act = "approve-persist";
      persistButton.textContent = t("D564", { rule: persistRule });
      persistButton.addEventListener("click", () => onPick(false, true));
      row.append(persistButton);
    }
    return { row, rememberButton, persistButton };
  }

  function appendApproval(request: {
    id: string;
    tool: string;
    diff?: string | undefined;
    argv?: string[] | undefined;
    purpose?: string | undefined;
    /** 判定依据（M459 契约：哪一层让这次调用进闸）——层级来自 Rust 判定管线，前端不推导。 */
    reason?: DecisionReason | undefined;
    /** 定时任务预览（change add-cron-conversational-registration §6.3；其它工具缺键）。 */
    cronTask?: CronTaskPreview | undefined;
    /** 会话记忆粒度（change harness-permission-rules-oct23；缺键 = 不渲染该按钮）。 */
    remember?: string | undefined;
    /** 持久规则原文（同上；缺键 = 不渲染该按钮）。 */
    persistRule?: string | undefined;
  }): void {
    // 收敛单行生命周期（M406，原型 variant B）：批准卡不再独立挂 transcript 末尾，而是
    // 就地挂进该调用工具行的 .lumir-hp-pend 壳——同一行承载「运行中 → 等待批准 → 终态」
    // 全生命周期；其后的思考块 / 正文段按到达序追加在工具块之后，自然落在卡之后
    // （reject 后思考落点问题随之结构性消解）。
    ensureStreamingMessage();
    const block = ensureToolsBlock();
    const argsText = approvalArgsText(request);
    const pathTargets = approvalPathTargets(request);
    let row = block.running;
    if (row !== null) {
      // started 行就地升级：截断摘要换成批准载荷全文 +「等待批准」尾注。
      startedArgs.delete(row);
      row.classList.add("is-waiting");
      row.replaceChildren(
        createToolIcon("running"),
        createToolText(request.tool, argsText, t("D416"), pathTargets),
      );
    } else {
      // 无 running 行（快照恢复的 pending_approval / 协议外到达）：补建待决行。
      row = document.createElement("div");
      row.className = "lumir-hp-tool-row is-running is-waiting";
      row.append(
        createToolIcon("running"),
        createToolText(request.tool, argsText, t("D416"), pathTargets),
      );
      block.el.append(row);
      block.rows.push(row);
      block.running = row;
    }

    const el = document.createElement("div");
    el.className = "lumir-hp-approval";
    const titleEl = document.createElement("div");
    titleEl.className = "lumir-hp-approval-title";
    el.append(titleEl);
    // 判定依据行（M459）：这次**为什么**进闸——先回答疑惑，再看要批准什么。层级由 Rust 判定
    // 管线产出（批准请求事件 / 快照两条通道），前端只按 kind 取文案（MUST NOT 自行推导）；
    // 文本在 relabelApproval 里落（chrome 文案随语言重取）。无依据（旧载荷 / 不可上卡的层）
    // 时不建元素——不出空行、不伪造。样式见 src/harness-panel.css 的 `.lumir-hp-approval-basis`
    //（次级灰信息副行；M459 起该文件在改动面内）。
    if (approvalReasonText(request.reason) !== null) {
      const basis = document.createElement("div");
      basis.className = "lumir-hp-approval-basis";
      el.append(basis);
    }
    // 定时任务要素块（change add-cron-conversational-registration design §6.3）：紧跟判定依据
    // 行之后、diff / argv 与按钮之前——与它们同一层级。内容全来自批准载荷（含线程算好的
    // skip_today），随语言重绘走 relabelApproval。
    if (request.cronTask !== undefined) {
      const cronEl = document.createElement("div");
      cronEl.className = "lumir-hp-approval-cron";
      renderCronTaskBlock(cronEl, request.cronTask);
      el.append(cronEl);
    }
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
      // 组合命令的连接符拆段（M414，design §3.4）：`cmd1; cmd2 && cmd3` / 管道 / 解释器
      // eval 一行挤在一起最难人工核对——按 `;` `&&` `||` `|` `&` 与换行换行排版，
      // 每段一行、连接符起首。纯呈现层：`join("")` 逐字符等于原文（不改判定、不截断、
      // 不重排），命令原文因此仍完整可见。
      for (const segment of splitCommandSegments(formatArgv(request.argv))) {
        const lineEl = document.createElement("div");
        lineEl.className = "lumir-hp-argv-seg";
        lineEl.textContent = segment;
        pre.append(lineEl);
      }
      el.append(pre);
    }
    // vault_delete 的批准卡附一句后果说明（design §5.1：路径 + 「移入系统废纸篓、可恢复」；
    // 后端 approval_preview 只给路径，这句按契约归面板侧）。语义是**如实说可恢复**——
    // 工具底层只有 trash_entry，永久删除路径不存在。
    if (request.tool === "vault_delete") {
      const note = document.createElement("div");
      note.className = "lumir-hp-approval-note";
      note.textContent = t("D435");
      el.append(note);
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

    // 次级动作（change harness-permission-rules-oct23）：最多两枚并列的次级按钮——「采纳且本
    // 会话不再问（记住 <粒度>）」与「以后都允许 <规则>」。独立一行、弱化样式（次级动作不抢
    // 「采纳 / 拒绝」这对主决策的视觉重心）；可见性完全由后端下发的两个字段决定。
    const secondary = createApprovalSecondaryActions(request, (remember, persistRule) => {
      decide(true, remember, persistRule);
    });
    if (secondary !== null) el.append(secondary.row);

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
      reason: request.reason,
      cronTask: request.cronTask,
      remember: request.remember,
      persistRule: request.persistRule,
      argsText,
      targets: pathTargets,
      element: el,
      row,
      wrap,
    };
    pendingApprovals.set(request.id, pending);
    relabelApproval(pending);

    // 未决项不自动超时：唯一的出口是 Alex 点击 / ⌘Enter。决策幂等——重复触发不会向后端
    // 发第二次（pendingApprovals.delete 只兑现一次）；决策后同一行就地收敛为终态记录
    // （settleApprovalRecord），元素留在 transcript 里作决策记录。
    // 两枚次级动作各自带一个布尔：remember = 会话记忆；persistRule = 持久规则写回。
    const decide = (approved: boolean, remember = false, persistRule = false): void => {
      if (!pendingApprovals.delete(request.id)) return;
      const reasonText = reason.value.trim();
      settleApprovalRecord(pending, approved, reasonText === "" ? undefined : reasonText, Date.now());
      harnessApprove(
        request.id,
        approved,
        reasonText === "" ? undefined : reasonText,
        remember ? true : undefined,
        persistRule ? true : undefined,
      ).catch((e: unknown) => appendError(t("D348", { message: errorMessage(e) })));
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
    follow.contentGrew(); // 分流表 #9：批准卡不拽视口（D5），未读圆点提示
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
  // **折叠态是两条路径共用的默认**（M542，Alex 2026-10-16：恢复会话里 thinking 默认展开，
  // 与默认渲染不一致；不变量 = 恢复渲染的各类块展开态与默认渲染一致）。恢复路径唯一缺的
  // 读数只有**时长**（wire 只带 reasoning 明文、不带「思考了多久」），故它的折叠行走无时长
  // 变体 D468，不写数字（M398「不伪造读数」的立意保留，时长缺席是有意的，不是缺漏）。

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

  /** 建思考块视图（默认折叠）。head 钮的可见文本由调用方填：活会话 = `flushThinkingViews`
   *  写 D388 整串（chevron + 时长），恢复路径 = `createRestoredThinking` 写 D468（无时长）。 */
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
   *  是事实读数，重取 D388 模板即可；正文是模型原文，不随语言改写）。恢复路径的折叠行
   *  无时长读数（`dataset.restored`，见 `createRestoredThinking`）：重取无时长的 D468，
   *  MUST NOT 走 D388——那条模板的 `{sec}` 只能拿 0 填空，重渲会把「时长未知」变成
   *  「思考了 0 秒」的伪造读数（M542）。 */
  function relabelThinkingViews(): void {
    for (const el of transcript.querySelectorAll<HTMLElement>(".lumir-hp-think")) {
      const text = el.querySelector(".lumir-hp-think-text");
      if (text === null) continue;
      text.textContent =
        el.dataset.restored === "1"
          ? t("D468")
          : t("D388", { sec: Number(el.dataset.sec ?? "0") });
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
      // M644（design §3.3）：本拍已在 scroll 事件之后——following 下把本帧排队的写底就地落地
      //（再等一帧只会让视口永远落后一帧的增量）；detached 下补一次未读扫描（纯思考帧
      // flushChunks 早退，不经过 contentGrew，思考内容增长也要点亮未读）。
      if (follow.phase() === "detached") follow.contentGrew();
      else follow.flushNow();
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
      renderMarkdownInto(finalizedEl, grown, pathLinks, blockOpeners);
      seg.el.insertBefore(finalizedEl, seg.tailEl);
      seg.renderedFinalized = boundary;
    }
    seg.tailEl.replaceChildren();
    renderMarkdownInto(seg.tailEl, seg.source.slice(seg.renderedFinalized), pathLinks, blockOpeners);
    follow.contentGrew(); // 分流表 #10：主战场——修前这里每帧无条件写底
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
      renderMarkdownInto(seg.el, seg.source, pathLinks, blockOpeners);
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
    follow.contentGrew(); // 分流表 #11：轮次终态不强制回底（D6）
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
  /** 内容类事件（轮次闸门 M374 的管控面）：终态之后到达的一律丢弃。
   *
   *  元素类型钉死为 `HarnessEvent["type"]`：集合里拼错词元、或写进联合不存在的名字，
   *  编译期直接报错（`Set<string>` 时这些只会变成永不命中的死词元）。
   *  `title` / `notice` / `approval_request` **刻意不在闸门内**——它们不是「一轮的内容
   *  产出」：标题可在压缩收口之后才到（继承标题）、后台完成通知在没有回合进行时上屏、
   *  子运行的批准卡挂在任务区随 run 生命周期进出，都不受父轮次边界约束。
   *  联合新增 type 是否该进闸门，由 `handleEvent` 的 case 集合照常决定；闸门集合本身不
   *  必与联合一一对应。 */
  const GATED_EVENT_TYPES: ReadonlySet<HarnessEvent["type"]> = new Set<HarnessEvent["type"]>([
    "text_chunk",
    "reasoning_chunk",
    "tool_call",
    "usage",
    "compact",
  ]);

  // ── 子代理任务区：渲染与接线（change add-harness-subagents tasks §10，M590）──────────
  //
  // 渲染是**差量**的：行骨架建一次，读数就地更新（重建会丢批准卡原因框里正在输入的文字）；
  // 批准卡按 id 建一次、决策后移除。数据面全部来自事件与快照（`subruns` / `autoWake` /
  // `subrunUsage`），渲染点不推导状态（状态词与终态判据走纯映射）。

  /** 行图标：脉冲点（运行中）/ 暂停（等待批准、触顶）/ 对勾（完成）/ 叉（失败、停止）。 */
  function taskIcon(status: SubrunStatus): HTMLElement {
    const ic = document.createElement("span");
    ic.className = "lumir-tp-ic";
    ic.setAttribute("aria-hidden", "true");
    if (status === "running") {
      const pulse = document.createElement("span");
      pulse.className = "lumir-tp-pulse";
      ic.append(pulse);
      return ic;
    }
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "11");
    svg.setAttribute("height", "11");
    svg.setAttribute("viewBox", "0 0 12 12");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.6");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    if (status === "waiting" || status === "partial") {
      const first = document.createElementNS(SVG_NS, "rect");
      first.setAttribute("x", "3");
      first.setAttribute("y", "2.5");
      first.setAttribute("width", "2");
      first.setAttribute("height", "7");
      first.setAttribute("rx", "0.6");
      const second = document.createElementNS(SVG_NS, "rect");
      second.setAttribute("x", "7");
      second.setAttribute("y", "2.5");
      second.setAttribute("width", "2");
      second.setAttribute("height", "7");
      second.setAttribute("rx", "0.6");
      svg.setAttribute("fill", "currentColor");
      svg.setAttribute("stroke", "none");
      svg.append(first, second);
    } else {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute(
        "d",
        status === "done" ? "M2.5 6.5 5 9l4.5-5.5" : "M3.5 3.5l5 5M8.5 3.5l-5 5",
      );
      svg.append(path);
    }
    ic.append(svg);
    return ic;
  }

  function setRunStatusClass(el: HTMLElement, status: SubrunStatus): void {
    el.classList.remove("is-running", "is-waiting", "is-done", "is-partial", "is-failed", "is-stopped");
    el.classList.add(`is-${status}`);
  }

  /** 行读数（tasks §10.1「轮次 · tokens」）：tokens 只在收尾后有真读数——运行中不给假数。 */
  function runReadText(run: SubrunView): string {
    const tokens = run.inputTokens + run.outputTokens;
    if (tokens > 0) {
      return t("D519", { rounds: run.rounds, tokens: formatTokenCount(tokens) });
    }
    return t("D520", { rounds: run.rounds });
  }

  function ensureRunRow(run: SubrunView): RunRowEls {
    const existing = runRowEls.get(run.runId);
    if (existing !== undefined) return existing;
    const el = document.createElement("div");
    el.className = "lumir-tp-run";
    el.dataset.run = run.runId;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "lumir-tp-row";
    const icon = document.createElement("span");
    icon.className = "lumir-tp-ic-slot";
    const agent = document.createElement("span");
    agent.className = "lumir-tp-agent";
    const desc = document.createElement("span");
    desc.className = "lumir-tp-desc";
    const flag = document.createElement("span");
    flag.className = "lumir-tp-flag";
    flag.textContent = t("D489");
    const read = document.createElement("span");
    read.className = "lumir-tp-read";
    const stateWord = document.createElement("span");
    stateWord.className = "lumir-tp-read lumir-tp-state";
    head.append(icon, agent, desc, flag, read, stateWord);
    const body = document.createElement("div");
    body.className = "lumir-tp-body";
    body.hidden = true;
    const meta = document.createElement("div");
    meta.className = "lumir-tp-meta";
    const latest = document.createElement("div");
    latest.className = "lumir-tp-latest";
    const summary = document.createElement("div");
    summary.className = "lumir-tp-sum";
    summary.hidden = true;
    const actions = document.createElement("div");
    actions.className = "lumir-tp-actions";
    const decisions = document.createElement("div");
    decisions.className = "lumir-tp-decisions";
    const approvals = document.createElement("div");
    approvals.className = "lumir-tp-asks";
    body.append(meta, latest, summary, actions, decisions, approvals);
    el.append(head, body);
    taskList.append(el);
    head.addEventListener("click", () => {
      if (openRuns.has(run.runId)) openRuns.delete(run.runId);
      else openRuns.add(run.runId);
      renderTaskArea();
    });
    const els: RunRowEls = {
      el,
      head,
      icon,
      agent,
      desc,
      flag,
      read,
      stateWord,
      body,
      meta,
      latest,
      summary,
      actions,
      decisions,
      approvals,
      cards: new Map(),
    };
    runRowEls.set(run.runId, els);
    return els;
  }

  /** 一行批准卡（卡体与父会话同款：diff / argv、判定依据、原因、批准 / 拒绝、「本会话不再问」）。
   *  复用 transcript 卡的样式类（`.lumir-hp-diff` / `.lumir-hp-reason` / `.lumir-hp-approval-actions`），
   *  卡片外壳用任务区自己的类——两条呈现路径互不干扰。 */
  function createTaskApprovalCard(run: SubrunView, request: TaskApprovalRequest): HTMLElement {
    const card = document.createElement("div");
    card.className = "lumir-tp-ask";
    card.dataset.approval = request.id;
    const { ask, sub } = approvalAskOf(request.tool, request.diff !== undefined);
    const title = document.createElement("div");
    title.className = "lumir-tp-ask-title";
    title.append(document.createTextNode(ask));
    if (sub !== null) {
      const subEl = document.createElement("span");
      subEl.className = "lumir-tp-ask-sub";
      subEl.textContent = sub;
      title.append(subEl);
    }
    card.append(title);
    // 点名发起者（design §19.2）：卡片跟着发起者走，行内第一眼要看出「这是谁在等」。
    const from = document.createElement("div");
    from.className = "lumir-tp-ask-from";
    from.textContent = t("D517", { agent: run.agent, description: run.description });
    card.append(from);
    const basisText = approvalReasonText(request.reason);
    if (basisText !== null) {
      const basis = document.createElement("div");
      basis.className = "lumir-hp-approval-basis";
      basis.textContent = basisText;
      card.append(basis);
    }
    if (typeof request.purpose === "string" && request.purpose.trim() !== "") {
      const purpose = document.createElement("div");
      purpose.className = "lumir-hp-approval-purpose";
      purpose.textContent = request.purpose;
      card.append(purpose);
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
      card.append(pre);
    } else if (request.argv !== undefined) {
      const pre = document.createElement("pre");
      pre.className = "lumir-hp-argv";
      for (const segment of splitCommandSegments(formatArgv(request.argv))) {
        const lineEl = document.createElement("div");
        lineEl.className = "lumir-hp-argv-seg";
        lineEl.textContent = segment;
        pre.append(lineEl);
      }
      card.append(pre);
    }
    // vault_delete 的后果说明与父会话的卡同一句（design §5.1：路径 + 移入废纸篓、可恢复）。
    if (request.tool === "vault_delete") {
      const note = document.createElement("div");
      note.className = "lumir-hp-approval-note";
      note.textContent = t("D435");
      card.append(note);
    }
    const reason = document.createElement("textarea");
    reason.className = "lumir-hp-reason";
    reason.rows = 2;
    reason.setAttribute("aria-label", t("D338"));
    const actions = document.createElement("div");
    actions.className = "lumir-hp-approval-actions";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.dataset.act = "approve";
    approve.textContent = t("D336");
    const reject = document.createElement("button");
    reject.type = "button";
    reject.dataset.act = "reject";
    reject.textContent = t("D337");
    actions.append(approve, reject);
    card.append(reason, actions);
    // 两枚次级动作与 transcript 卡共用同一段构建（change harness-permission-rules-oct23
    // design §6.1：两处渲染点共用同一段构建函数）。
    const secondary = createApprovalSecondaryActions(request, (remember, persistRule) => {
      decide(true, remember, persistRule);
    });
    if (secondary !== null) card.append(secondary.row);
    const decide = (approved: boolean, remember = false, persistRule = false): void => {
      const reasonText = reason.value.trim();
      decideTaskApproval(
        request.id,
        approved,
        reasonText === "" ? undefined : reasonText,
        remember,
        persistRule,
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
    return card;
  }

  /** 子运行批准项的决策入口：卡片退场 → 行内终态记录 → 行状态从「等待批准」回「运行中」。
   *  后端通道仍是 `harness_approve`（决策只回给发起者，Rust 侧按请求 id 找到通道）。 */
  function decideTaskApproval(
    id: string,
    approved: boolean,
    reasonText: string | undefined,
    remember: boolean,
    persistRule: boolean,
  ): void {
    const entry = taskApprovals.get(id);
    if (entry === undefined) return; // 幂等：重复点击不向后端发第二次
    taskApprovals.delete(id);
    taskDecidedApprovals.add(id);
    runRowEls.get(entry.runId)?.cards.get(id)?.remove();
    runRowEls.get(entry.runId)?.cards.delete(id);
    const list = taskDecisions.get(entry.runId) ?? [];
    list.push({ tool: entry.request.tool, approved, reason: reasonText });
    taskDecisions.set(entry.runId, list);
    subruns = detachRunApproval(subruns, id);
    harnessApprove(
      id,
      approved,
      reasonText,
      remember ? true : undefined,
      persistRule ? true : undefined,
    ).catch((e: unknown) => appendError(t("D348", { message: errorMessage(e) })));
    renderTaskArea();
  }

  /** 批准项挂进任务行（事件 / 快照两条通道共用）：行不存在时按来源补一条占位行——
   *  重载后面板没有在跑的 run 事件，但阻塞决策必须可见（design §19.2）。 */
  function attachTaskApproval(
    runId: string,
    request: TaskApprovalRequest,
    source: { agent: string; description: string },
  ): void {
    if (taskApprovals.has(request.id) || taskDecidedApprovals.has(request.id)) return;
    taskApprovals.set(request.id, { runId, request });
    if (!subruns.some((run) => run.runId === runId)) {
      subruns = [
        ...subruns,
        {
          runId,
          agent: source.agent,
          description: source.description,
          model: "",
          background: false,
          status: "running",
          rounds: 0,
          toolCalls: 0,
          lastTool: null,
          steps: [],
          elapsedMs: 0,
          inputTokens: 0,
          cachedTokens: 0,
          outputTokens: 0,
          segments: 1,
          stoppedBy: null,
          deniedCalls: 0,
          summaryChars: 0,
          summary: null,
          approvalIds: [],
        },
      ];
    }
    subruns = attachRunApproval(subruns, runId, request.id);
    openRuns.add(runId); // 待批行自动展开（阻塞决策不藏在折叠区里）
    renderTaskArea();
  }

  function updateRunRow(run: SubrunView, els: RunRowEls): void {
    setRunStatusClass(els.el, run.status);
    if (els.icon.firstChild === null || els.icon.dataset.status !== run.status) {
      els.icon.replaceChildren(taskIcon(run.status));
      els.icon.dataset.status = run.status;
    }
    els.agent.textContent = run.agent;
    els.desc.textContent = run.description;
    els.desc.title = run.description;
    els.flag.hidden = !run.background;
    const word = subrunStatusWord(run.status);
    els.stateWord.textContent = run.status === "waiting" ? word : "";
    els.stateWord.hidden = run.status !== "waiting";
    // 运行中的状态由脉冲点承载（行宽有限，优先给 description 与读数）；待批出状态词。
    els.read.textContent = run.status === "waiting" ? "" : runReadText(run);
    const expanded = openRuns.has(run.runId) || run.status === "waiting";
    els.head.setAttribute("aria-expanded", String(expanded));
    els.body.hidden = !expanded;
    if (!expanded) return;
    const meta: string[] = [];
    if (run.model !== "") meta.push(t("D495", { model: run.model }));
    meta.push(t("D496", { rounds: run.rounds, steps: run.toolCalls || run.steps.length }));
    if (run.elapsedMs > 0) meta.push(t("D497", { duration: formatDuration(run.elapsedMs) }));
    if (run.stoppedBy !== null) {
      meta.push(t("D498", { reason: subrunStoppedByWord(run.stoppedBy) }));
    }
    els.meta.replaceChildren(
      ...meta.map((text) => {
        const span = document.createElement("span");
        span.textContent = text;
        return span;
      }),
    );
    const latestStep = run.steps.length > 0 ? run.steps[run.steps.length - 1] : null;
    const latestText =
      latestStep !== null
        ? `${latestStep.tool} ${latestStep.summary}`
        : run.lastTool !== null
          ? run.lastTool
          : "";
    els.latest.hidden = latestText === "";
    if (latestText !== "") {
      const label = document.createElement("span");
      label.className = "lumir-tp-label";
      label.textContent = `${t("D500")} `;
      const body = document.createElement("span");
      body.textContent = latestText;
      els.latest.replaceChildren(label, body);
    }
    els.summary.hidden = run.summary === null || run.summary.trim() === "";
    if (run.summary !== null && run.summary.trim() !== "") {
      const label = document.createElement("span");
      label.className = "lumir-tp-label";
      label.textContent = `${t("D499")} `;
      const body = document.createElement("span");
      body.textContent = run.summary;
      els.summary.replaceChildren(label, body);
    }
    // 停止动作：运行 / 等待批准的行都可停（等待也是在飞；停止后收回它的待批项）。
    const canStop = run.status === "running" || run.status === "waiting";
    if (canStop) {
      if (els.actions.firstChild === null) {
        const stop = document.createElement("button");
        stop.type = "button";
        stop.className = "lumir-tp-mini";
        stop.textContent = t("D490");
        // 读屏名与发送钮（D378，同名「停止」）区分开：真机 AX 选择器靠它定位本钮（M590 r1）。
        stop.setAttribute("aria-label", t("D522"));
        stop.addEventListener("click", (event: MouseEvent) => {
          event.stopPropagation();
          harnessSubagentStop(run.runId).catch((e: unknown) =>
            appendError(t("D348", { message: errorMessage(e) })),
          );
        });
        els.actions.append(stop);
      }
      els.actions.hidden = false;
    } else {
      els.actions.hidden = true;
    }
    // 已决策的批准（行内终态记录；拒绝附原因）。
    const decisions = taskDecisions.get(run.runId) ?? [];
    els.decisions.replaceChildren(
      ...decisions.map((decision) => {
        const line = document.createElement("div");
        line.className = "lumir-tp-decision";
        const wordEl = document.createElement("b");
        wordEl.textContent = t(decision.approved ? "D405" : "D406");
        line.append(document.createTextNode(`${decision.tool} `), wordEl);
        if (decision.reason !== undefined) {
          line.append(document.createTextNode(` · ${t("D408", { reason: decision.reason })}`));
        }
        return line;
      }),
    );
    // 批准卡按 id 差量增删（已存在的卡不重建——原因框输入不丢）。
    const wanted = new Set(run.approvalIds);
    for (const [id, card] of els.cards) {
      if (!wanted.has(id)) {
        card.remove();
        els.cards.delete(id);
      }
    }
    for (const id of run.approvalIds) {
      if (els.cards.has(id)) continue;
      const entry = taskApprovals.get(id);
      if (entry === undefined) continue;
      const card = createTaskApprovalCard(run, entry.request);
      els.approvals.append(card);
      els.cards.set(id, card);
    }
  }

  function renderTaskArea(): void {
    // 子代理关停由后端保证：`[harness.subagents].enabled = false` 时 `task` 工具不注册，
    // 也就没有 run 事件与分桶读数——任务区自然不出现，前端不再另读开关。
    const live = subruns.filter(isLiveSubrun);
    const headline = taskHeadline(subruns);
    const alertText = autoWakeAlertText(autoWake.blocked, autoWake.max, wakeContinued);
    // 用量区是快照读数（恢复后没有 run 事件可回放）：只要 `subrun_usage` 有内容就给它一个
    // 出口，否则重启恢复后面板整块不出现、分桶读数无处可见（M590 真机场景 192 现场）。
    const usageRows = live.length === 0 ? subrunUsageRows(subrunUsage) : [];
    const show = live.length > 0 || headline !== "" || alertText !== null || usageRows.length > 0;
    taskArea.hidden = !show;
    if (!show) return;
    taskAlert.hidden = alertText === null;
    if (alertText !== null) {
      taskAlertText.textContent = alertText;
      // 文案随当前语言现取（构造期语言可能尚未确定——真机 203 现场：按钮停在 en 的 Continue）。
      taskAlertButton.textContent = t("D491");
      taskAlertButton.hidden = wakeContinued || autoWake.blocked === null;
    }
    taskTitle.textContent = headline;
    taskHead.hidden = headline === "";
    taskHead.setAttribute("aria-expanded", String(!taskCollapsed));
    taskArea.classList.toggle("is-collapsed", taskCollapsed);
    const liveIds = new Set(live.map((run) => run.runId));
    for (const [runId, els] of runRowEls) {
      if (liveIds.has(runId)) continue;
      els.el.remove();
      runRowEls.delete(runId);
    }
    for (const run of live) {
      const els = ensureRunRow(run);
      updateRunRow(run, els);
    }
    // 全部收敛后：本次会话摘要之下给按模型用量（父会话控制行读数不掺这些数字）。
    taskUsage.hidden = usageRows.length === 0;
    if (usageRows.length > 0) {
      const title = document.createElement("h4");
      title.textContent = t("D506");
      taskUsage.replaceChildren(
        title,
        ...usageRows.map((row) => {
          const line = document.createElement("div");
          line.className = "lumir-tp-usage-row";
          const model = document.createElement("span");
          model.className = "lumir-tp-usage-model";
          model.textContent = row.model;
          const value = document.createElement("span");
          value.className = "lumir-tp-usage-value";
          value.textContent = row.text;
          line.append(model, value);
          return line;
        }),
      );
    }
  }

  /** 快照里的读数类字段（任务区专用刷新）：只吃 `auto_wake` / `subrun_usage` /
   *  `pending_approvals`，不重放消息——transcript 的内容由事件与 `restoreSnapshot` 各管一段。 */
  function applyTaskReadings(state: Record<string, unknown>): void {
    if (!inCurrentVault(state.vault, currentVault)) return;
    const wake = state.auto_wake;
    if (typeof wake === "object" && wake !== null) {
      const value = wake as Record<string, unknown>;
      autoWake = {
        chain: typeof value.chain === "number" && Number.isFinite(value.chain) ? value.chain : autoWake.chain,
        max: typeof value.max === "number" && Number.isFinite(value.max) ? value.max : autoWake.max,
        blocked: typeof value.blocked === "string" ? value.blocked : null,
      };
      if (autoWake.blocked !== null) wakeContinued = false;
    }
    subrunUsage = state.subrun_usage ?? null;
    const approvals = Array.isArray(state.pending_approvals) ? state.pending_approvals : [];
    for (const raw of approvals) {
      const parsed = parseTaskApproval(raw);
      if (parsed === null) continue;
      attachTaskApproval(parsed.source.run_id, parsed.request, parsed.source);
    }
    renderTaskArea();
  }

  /** 批准请求的宽容解析（事件与快照共用）：返回任务区可用的形状（含子运行来源）。 */
  function parseTaskApproval(
    raw: unknown,
  ): { request: TaskApprovalRequest; source: { agent: string; description: string; run_id: string } } | null {
    if (typeof raw !== "object" || raw === null) return null;
    const value = raw as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.tool !== "string") return null;
    const source = parseApprovalSource(value.source);
    if (source === null || source.kind !== "subrun") return null;
    const argv = Array.isArray(value.argv)
      ? value.argv.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    return {
      request: {
        id: value.id,
        tool: value.tool,
        diff: typeof value.diff === "string" ? value.diff : undefined,
        argv: argv !== undefined && argv.length > 0 ? argv : undefined,
        purpose: typeof value.purpose === "string" ? value.purpose : undefined,
        reason: parseDecisionReason(value.reason),
        // 两枚次级动作的字段（change harness-permission-rules-oct23）：形状不合 / 缺键 =
        // 不渲染该按钮——**M413 的「缺键按可见处理」契约已翻转**（D3：危险卡经快照恢复
        // 不得复活死按钮）。解析口径与事件 / 父会话快照同出一处。
        ...approvalActionsFromPayload(value),
      },
      source: { agent: source.agent, description: source.description, run_id: source.run_id },
    };
  }

  /** 任务区读数刷新（收尾 / 通知 / 决策后调用）：不重放消息，只同步读数与待批项。 */
  function refreshTaskState(): void {
    const seq = ++taskStateSeq;
    void harnessState()
      .then((json) => {
        if (seq !== taskStateSeq) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          return;
        }
        if (typeof parsed !== "object" || parsed === null) return;
        applyTaskReadings(parsed as Record<string, unknown>);
      })
      .catch(() => {});
  }

  taskHead.addEventListener("click", () => {
    taskCollapsed = !taskCollapsed;
    renderTaskArea();
  });
  taskAlertButton.addEventListener("click", () => {
    harnessSubagentContinue()
      .then(() => {
        wakeContinued = true;
        renderTaskArea();
        refreshTaskState();
      })
      .catch((e: unknown) => appendError(t("D348", { message: errorMessage(e) })));
  });

  /** 后台完成通知上屏（tasks §10.4）：与用户消息视觉区分（左侧色条 + 标签），多条合并成
   *  一条时逐 run 列一行。正文只来自后端（agent / description / 终态 / 摘要首行），
   *  前端不生成摘要。 */
  function appendNotice(runs: readonly NoticeRunView[], when: number | null = null): void {
    if (runs.length === 0) return;
    const el = document.createElement("div");
    el.className = "lumir-hp-msg lumir-hp-notice";
    const head = document.createElement("div");
    head.className = "lumir-hp-notice-head";
    head.textContent = noticeHeadline(runs);
    if (when !== null) {
      const stamp = document.createElement("span");
      stamp.className = "lumir-hp-when";
      stamp.dataset.ts = String(when);
      stamp.textContent = `· ${relativeWhen(when, Date.now())}`;
      head.append(stamp);
    }
    const body = document.createElement("div");
    body.className = "lumir-hp-notice-body";
    for (const run of runs) {
      const line = document.createElement("div");
      line.className = "lumir-hp-notice-line";
      line.textContent = noticeLineText(run);
      body.append(line);
    }
    const more = document.createElement("div");
    more.className = "lumir-hp-notice-more";
    more.textContent = t("D516");
    body.append(more);
    el.append(head, body);
    transcript.append(el);
    syncEmptyHint();
    follow.contentGrew(); // 分流表 #12：后台完成通知不拽视口
  }

  /** 通知正文无法还原成 run 行时的兜底上屏（原文照登，不丢内容）。 */
  function appendNoticePlain(text: string): void {
    const el = document.createElement("div");
    el.className = "lumir-hp-msg lumir-hp-notice";
    const body = document.createElement("div");
    body.className = "lumir-hp-notice-body";
    body.textContent = text;
    el.append(body);
    transcript.append(el);
    syncEmptyHint();
    follow.contentGrew(); // 分流表 #13：同上（兜底上屏）
  }

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
          const request: TaskApprovalRequest = {
            id: event.id,
            tool: event.tool,
            diff: event.diff,
            argv: event.argv,
            purpose: typeof event.purpose === "string" ? event.purpose : undefined,
            // 判定依据（M459 契约）：宽容解析，形状不合 / 缺键 = undefined ⇒ 不出该行。
            reason: parseDecisionReason(event.reason),
            // 定时任务预览（§6.3 契约）：形状不合 / 缺键 = undefined ⇒ 不建要素块。
            cronTask: parseCronTaskPreview(event.cron_task),
            // 两枚次级动作（change harness-permission-rules-oct23）：与事件 / 快照入口同一份
            // 宽容解析（缺键 / 非字符串 = 不渲染该按钮——D3 翻转后的缺键语义）。
            ...approvalActionsFromPayload(event),
          };
          const source = parseApprovalSource(event.source);
          if (source !== null && source.kind === "subrun") {
            // 子运行透传的卡：渲染在任务面板该 run 的行内（卡片跟着发起者走，design §19.2）。
            attachTaskApproval(source.run_id, request, source);
          } else {
            appendApproval(request);
          }
        }
        return;
      case "usage": {
        // M347：读数迁入 composer 控制行（模型 chip 之后、发送钮之前）——事件源自 HP1 起
        // 一直在发（头部栏已移除、事件未断），这里直接消费，不新造通道。
        // M370：cache 读数一并消费（同一事件里已带，纯前端读取）——「{ctx}% · {cache}%」。
        // M443：cache 侧换键——`cache_pct_session`（控制行主读数，会话累计）取代退役的
        // `cache_pct`；`cache_pct_turn` / 缓存写入两值 / 成因标注由**读数映射**照旧落进状态
        // （M533 起气泡不再渲染这三组，投影不随行集裁）。键名映射与缺省口径
        // 走 usageReadings 一处（快照路径同一份），缺键一律落 null：读数回落单读数、气泡
        // 对应行不渲染——不伪造、不用 0 冒充实测值。
        applyUsageReadings(usageReadings(event));
        applyUsage();
        return;
      }
      case "compact":
        // 自动压缩 = 开新逻辑会话：会话名按同口径重算（下一条用户消息成为新名，
        // 未发前显示「新会话」——design §3）。标题由紧随其后的 `title` 事件按继承口径恢复
        //（change add-session-auto-naming D7/D11），这里先清空、不自行保留。
        firstUserText = null;
        sessionTitle = null;
        applySessionName();
        appendCompactMarker(typeof event.summary === "string" ? event.summary : "");
        return;
      case "title": {
        // 会话标题即时更新（change add-session-auto-naming，design D11）：只换会话名文本与
        // tooltip——不重渲染 transcript、不动滚动 / 焦点 / 历史清单顺序；浮层若正打开，行名
        // 原地更新（不重开、不跳位置）。标题值只来自后端，前端不生成、不猜测。
        const previousShown = sessionNameShown(sessionTitle, firstUserText);
        sessionTitle =
          typeof event.title === "string" && event.title.trim() !== "" ? event.title : null;
        applySessionName();
        retitleOpenSessRows(previousShown, sessionNameShown(sessionTitle, firstUserText));
        return;
      }
      case "subagent_started":
        subruns = reduceSubruns(subruns, {
          type: "subagent_started",
          run_id: event.run_id,
          agent: event.agent,
          description: event.description,
          model: event.model,
          background: event.background === true,
        });
        {
          const run = subruns.find((item) => item.runId === event.run_id);
          if (run !== undefined) refreshTaskRow(run);
        }
        renderTaskArea();
        return;
      case "subagent_progress":
        subruns = reduceSubruns(subruns, {
          type: "subagent_progress",
          run_id: event.run_id,
          rounds: event.rounds,
          tool_calls: event.tool_calls,
          last_tool: event.last_tool,
          elapsed_ms: event.elapsed_ms,
        });
        {
          const run = subruns.find((item) => item.runId === event.run_id);
          if (run !== undefined) refreshTaskRow(run);
        }
        renderTaskArea();
        return;
      case "subagent_step":
        subruns = reduceSubruns(subruns, {
          type: "subagent_step",
          run_id: event.run_id,
          tool: event.tool,
          summary: event.summary,
        });
        {
          const run = subruns.find((item) => item.runId === event.run_id);
          if (run !== undefined) refreshTaskRow(run);
        }
        renderTaskArea();
        return;
      case "subagent_finished": {
        subruns = reduceSubruns(subruns, {
          type: "subagent_finished",
          run_id: event.run_id,
          agent: event.agent,
          status: event.status,
          stopped_by: event.stopped_by,
          rounds: event.rounds,
          model: event.model,
          input_tokens: event.input_tokens,
          cached_tokens: event.cached_tokens,
          output_tokens: event.output_tokens,
          denied_calls: event.denied_calls,
          duration_ms: event.duration_ms,
          summary_chars: event.summary_chars,
          summary: event.summary,
        });
        // 该 run 的待批项随收尾失效（后端已 Withdrawn / 决定），卡片一并收走。
        for (const [id, entry] of [...taskApprovals]) {
          if (entry.runId !== event.run_id) continue;
          taskApprovals.delete(id);
          taskDecidedApprovals.add(id);
        }
        taskDecisions.delete(event.run_id);
        {
          const run = subruns.find((item) => item.runId === event.run_id);
          if (run !== undefined) refreshTaskRow(run);
        }
        renderTaskArea();
        // 用量分桶与唤醒链计数只在收尾时变（快照是唯一真源，前端不自行累加）。
        refreshTaskState();
        return;
      }
      case "subagent_notified":
        // 通知最终处理（wake / 链序号）——读数以快照为准，前端不按事件自行推链。
        refreshTaskState();
        return;
      case "subagent_rejected":
        // 委派被闸拒：可见面是 `task` 工具行的失败结果（已由 tool_call 渲染），任务区不另立行。
        return;
      case "subagent_catalog_large":
        // 清单容量告警：诊断日志承担（后端已落 `subagent_catalog_large`），面板不重复报警。
        return;
      case "notice":
        appendNotice(noticeRunsOf(event.runs), Date.now());
        return;
      case "auto_turn_started":
        // 自动回合（design §12.6）：没有用户发送动作，面板必须自己打开轮次闸门与处理中相位，
        // 否则随后的 text_chunk 会被当成「已结束轮次的迟到产出」丢弃；`done` 照常收口。
        turnOpen = true;
        stageWaiting = true;
        if (sendPhase !== "running") {
          applySendPhase(reduceSendPhase(sendPhase, { type: "sent" }));
        }
        return;
      case "done":
        turnOpen = false;
        finalizeStreamingMessage();
        applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
        // cron 点击运行收尾（M612）：按后端快照重载一次——本次运行的 prompt / 回答以留存面板为
        // 单一真源（专用会话的历史也回屏），不把「这一轮的面板态」当作会话的全部内容。
        if (cronRunAdopted) reloadSession();
        return;
      case "aborted": {
        turnOpen = false;
        // 中断不是 done（turn.rs 的 abort 收口直接返回，不再发 done）：点击运行的切屏态在此
        // 清掉，避免下一次无关回合的 done 误触发快照重载。
        cronRunAdopted = false;
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
          follow.contentGrew(); // 分流表 #14：中断收口不拽视口
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
              createToolText(pending.tool, pending.argsText, t("D383"), pending.targets),
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
        // 同 aborted：错误轮次不发 done，切屏态在此清掉（不再等一次不会来的 done）。
        cronRunAdopted = false;
        finalizeStreamingMessage();
        applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
        appendError(t("D348", { message: typeof event.message === "string" ? event.message : event.code }));
        return;
      default:
        // 类型层穷尽性闸门：全部 case 覆盖完时 `event` 收窄为 `never`；联合新增 type 而这里
        // 漏补 case，收窄不到 `never`，调用处 tsc 报 TS2345——不再是一次静默忽略的事件。
        // 运行期恒返回 false：未知 type 本来也过不来（ipc.ts 的准入门已先丢弃）。
        uncoveredEventType(event);
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
      appendUserMessage(blocks, record.text, messageTs(record), "restored"); // 复制源 = 留存原文；戳 = 后端 ts（无则不显示）
    } else if (role === "notice" && typeof record.text === "string") {
      // 后台完成通知（change add-harness-subagents design §12.6.4 / §19.3）：留存里的面板行
      // 是后端渲染好的展示串（固定前缀 + 每 run 一行 + 固定收尾）。能还原出 run 行就按
      // 通知样式上屏；还原不出（文案形态变了）整段原文上屏——不丢内容，也不伪造结构。
      const noticeRuns = parseNoticeDisplayText(record.text);
      if (noticeRuns.length > 0) {
        appendNotice(noticeRuns, messageTs(record));
      } else {
        appendNoticePlain(record.text);
      }
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
        el.append(createWhoLine("assistant", messageTs(record), "restored")); // 无 ts 的旧快照：只显示角色（不伪造）
        if (reasoning !== null) el.append(createRestoredThinking(reasoning));
        if (text !== null) {
          const body = document.createElement("div");
          body.className = "lumir-hp-body";
          renderMarkdownInto(body, text, pathLinks, blockOpeners);
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

  /** 恢复消息的思考块（M398 结构 × M542 折叠态）：复用活会话的思考块结构
   *  （`createThinkingView`），**默认折叠**——展开态与默认渲染一致是 M542 的不变量
   *  （Alex 2026-10-16：「默认不展开的内容（比如 thinking 过程）在重建后也不展开」），
   *  点折叠行展开思考原文，与活会话同一个开关。
   *
   *  与活会话唯一不同处是折叠行的文案：wire 只带 reasoning 明文、不带「思考了多久」的
   *  读数，故取无时长变体 D468（M398「不伪造读数」的立意保留，时长缺席是有意的、不是缺漏；
   *  同口径见「无戳不显示 when」）。`dataset.restored` 是 relabel 依据（语言切换重渲时
   *  必须回到 D468——走 D388 只能拿 0 填空，等于把「时长未知」写成「思考了 0 秒」）。 */
  function createRestoredThinking(text: string): HTMLElement {
    const view = createThinkingView();
    view.el.dataset.restored = "1";
    view.text.textContent = t("D468");
    view.body.textContent = text;
    return view.el;
  }

  /** 恢复路径的工具行（M406 状态感知版 + M414 decision 收口）：record.status 是面板细分终态
   *  （done / denied / rejected / error——活会话持久化由 turn.rs 写，恢复重建路径由
   *  restored_panel_messages 经 wire 的 function_call_output 回填；旧快照缺字段）。
   *  - **decision = "approved"**（M413 契约：只有进过批准闸的调用带本字段）→ ✓「已采纳」
   *    终态行，与活会话的终态行同形（M406 遗留的分阶段收口：此前恢复后只丢了「已采纳」
   *    这一读——同样进过闸的两条路径上，拒绝看得见、采纳看不见）。
   *  - status = "rejected"（含带 decision 的）→ ✕「已拒绝」终态行（原型 restored/after-reject
   *    帧）：原因行就地可见（原因全文在输出 JSON 里，summary 里那份被 80 字截断不取）；
   *    **无详情**——留存里没有原 diff/argv，不伪造展开件。
   *  - denied / error（或缺 status 但摘要命中失败形状的旧快照）→ 失败行：尾注 = 失败
   *    全文（输出 JSON 的 code+message，summary 兜底）。
   *  - 其余 → 成功行：参数摘要人话化（`humanizeToolArgs`——持久化 / 重建两份 summary 是参数
   *    JSON 时按工具名提取，M528 起是 core 的成品文本时原样上屏；失败摘要不冒充参数）。 */
  function appendRestoredToolRow(record: Record<string, unknown> & { name: string }): void {
    const name = record.name;
    const summary = typeof record.summary === "string" ? record.summary : "";
    const status = typeof record.status === "string" ? record.status : "";
    const block = ensureToolsBlock();
    // 历史 `task` 行（design §19.1：历史任务的详情从 transcript 的 task 行点开）：正文是
    // 结果信封 JSON（`text`），解析出 agent / 终态 / 摘要；解析失败退回通用工具行——不丢记录。
    if (name === "task") {
      const envelope = taskEnvelopeOf(record.text);
      if (envelope !== null) {
        const wrap = document.createElement("div");
        wrap.className = "lumir-hp-taskwrap";
        const row = document.createElement("div");
        row.className = "lumir-hp-tool-row is-task";
        const detail = document.createElement("div");
        detail.className = "lumir-hp-task-detail";
        detail.hidden = true;
        wrap.append(row, detail);
        const entry: TaskRowEntry = {
          wrap,
          row,
          detail,
          argsSummary: summary,
          runId: null,
          settled: true,
          open: false,
          renderDetail: null,
        };
        bindTaskRowToggle(entry);
        renderRestoredTaskRow(entry, envelope);
        block.el.append(wrap);
        block.rows.push(wrap);
        return;
      }
    }
    const outcome = restoredApprovalOutcome(record);
    if (outcome !== null) {
      const approved = outcome === "approved";
      const row = document.createElement("div");
      row.className = approved ? "lumir-hp-tool-row is-done" : "lumir-hp-tool-row is-rej";
      row.append(
        createToolIcon(approved ? "done" : "fail"),
        // M528：core 的参数摘要已是成品人话文本（不再是 JSON），用参数格口径取值——
        // 严格版会把成品摘要判成「没有参数」，恢复后「已采纳」行的命令就此消失。
        createToolText(name, toolArgsText(name, summary), undefined, toolPathTargetsOf(name, summary)),
      );
      const tres = document.createElement("span");
      tres.className = "lumir-hp-tool-res";
      const outcomeEl = document.createElement("b");
      outcomeEl.className = "lumir-hp-tw";
      outcomeEl.textContent = t(approved ? "D405" : "D406");
      tres.append(outcomeEl);
      const at = messageTs(record);
      if (at !== null) {
        const when = document.createElement("span");
        when.className = "lumir-hp-when";
        when.dataset.ts = String(at);
        // 恢复路径的工具行：读数按 restored 形态（M460——留存 ts 可以很老，跨天给短日期）。
        when.textContent = whenTextOf(at, Date.now(), "restored");
        tres.append(document.createTextNode(" "), when);
      }
      row.append(tres);
      // 拒绝原因（采纳侧没有原因行——「采纳后不再问」这类信息不进留存）。
      const reason = approved ? null : rejectedReasonOf(record);
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
      createToolText(
        name,
        failed ? humanizeToolArgsStrict(name, summary) : humanizeToolArgs(name, summary),
        tail,
        toolPathTargetsOf(name, summary),
      ),
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
    // M370：cache 读数一并恢复；M443：走与事件路径同一份映射（`usageReadings`）——旧快照
    // （只有退役的 `cache_pct`、没有新键）读到 null ⇒ 回落单读数、气泡缺行，MUST NOT 伪造。
    const usage = state.usage;
    if (typeof usage === "object" && usage !== null) {
      applyUsageReadings(usageReadings(usage));
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
    // 会话标题（change add-session-auto-naming，design D11）：`title` 缺键 = 无标题 ⇒ 回落
    // 首条用户消息口径（不伪造）。快照是恢复 / 切 vault 回来时标题的唯一来源。
    sessionTitle =
      typeof state.title === "string" && state.title.trim() !== "" ? state.title : null;
    applySelChip();
    rebuildSelPopIfOpen();
    // 挂起的批准请求（change add-harness-subagents §8.3 起是**列表** `pending_approvals`，
    // 并行时多个子运行可以同时等批准；单槽 `pending_approval` 已随迁移删除，前端 MUST NOT
    // 再读旧键——那次迁移曾让审批卡在真实面板里整批不可见，M590 把读口改到列表）。
    // 子运行透传的卡走任务面板（`attachTaskApproval`，行内展开）；父会话自己的卡保持原位。
    const pendingList = Array.isArray(state.pending_approvals) ? state.pending_approvals : [];
    for (const raw of pendingList) {
      if (typeof raw !== "object" || raw === null) continue;
      const pending = raw as Record<string, unknown>;
      if (typeof pending.id !== "string") continue;
      // argv 是字符串数组（events.rs / PendingApprovalSnapshot 同型；M406 前按 string 读，
      // 数组被整段丢弃）。宽容过滤非字符串元素；空数组按缺省处理。
      const argv = Array.isArray(pending.argv)
        ? pending.argv.filter((a): a is string => typeof a === "string")
        : undefined;
      const request: TaskApprovalRequest = {
        id: pending.id,
        tool: typeof pending.tool === "string" ? pending.tool : "?",
        diff: typeof pending.diff === "string" ? pending.diff : undefined,
        argv: argv !== undefined && argv.length > 0 ? argv : undefined,
        purpose: typeof pending.purpose === "string" ? pending.purpose : undefined,
        // 判定依据（M459）：与事件入口同一份宽容解析（快照缺键 = 旧后端，不出该行）。
        reason: parseDecisionReason(pending.reason),
        // 定时任务预览（§6.3）：与事件入口同一份解析（快照缺键 = 旧载荷，不建块）。
        cronTask: parseCronTaskPreview(pending.cron_task),
        // 两枚次级动作（change harness-permission-rules-oct23）：与事件入口同一份宽容解析
        // （快照缺键 = 不渲染按钮——D3 翻转后的缺键语义，危险卡因此不会被复活死按钮）。
        ...approvalActionsFromPayload(pending),
      };
      const source = parseApprovalSource(pending.source);
      if (source !== null && source.kind === "subrun") {
        attachTaskApproval(source.run_id, request, source);
      } else {
        appendApproval(request);
      }
    }
    // 任务区读数（auto_wake / subrun_usage / 子运行待批项）随快照一并恢复。
    applyTaskReadings(state);
    applySessionName();
    syncEmptyHint();
    follow.jumpToBottom(); // 分流表 #15：快照重建收尾必须看到末尾（既有语义）
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
    // 内容换代 = 全屏遮罩里的快照已不存在（spec「内容换代时遮罩自动关闭」）：显式经既有遮罩
    // 关闭入口（`document` 径，交还焦点），MUST NOT 让遮罩停在一份已不存在的消息上。
    deps.blocks?.close();
    transcript.replaceChildren();
    // 引用失败的输入区状态行属于上一段输入（M662）：换会话即清（卡片上的留痕随卡片一起消失）。
    applyQuoteFailureNotice(null);
    // M644：视图复位 = 换了一个会话，跟随态回 following、清未读、写底（快照 / 恢复路径随后
    // 各自再「强制」一次，白名单动作不靠这一句兜底）。
    follow.reset();
    pendingApprovals.clear();
    decidedApprovals.clear();
    // 任务区是**会话**的视图：换会话即清空（终态 run 的「本次会话摘要」不跨会话）。
    subruns = [];
    taskApprovals.clear();
    taskDecidedApprovals.clear();
    taskDecisions.clear();
    openRuns.clear();
    runRowEls.clear();
    taskRowEntries.length = 0;
    wakeContinued = false;
    autoWake = { chain: 0, max: autoWake.max, blocked: null };
    subrunUsage = null;
    renderTaskArea();
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
    // 会话名随会话作废：未发消息前显示「新会话」，首条消息后再按口径重算。标题也随会话
    // 作废（新会话不继承；快照 / 恢复路径随后会灌入各自的标题）。
    firstUserText = null;
    sessionTitle = null;
    applySessionName();
    // 相位一并经 finished 收口回 idle：旧会话那一轮的 done 事件可能永远到不了这里（切 vault
    //  后被过滤，见 handleEvent）——不复位的话新会话的发送钮会被一个等不到的「处理中」锁死。
    applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
    stageWaiting = true;
    // ctx% 读数归无（新 vault 会话的快照会随后带到它自己的读数）。M443：cache 侧五个读数
    // 一并不留——新逻辑会话的累计归零，旧值残留会让控制行/气泡显示上一会话的数。M526：
    // 绝对值与 has_usage 一并不留（恢复路径随后经 refreshUsageState 重取真值）。
    lastUsage = null;
    lastCache = null;
    lastCacheTurn = null;
    lastCacheNote = null;
    lastCacheWrite = null;
    lastCacheWriteSession = null;
    lastInputTokens = null;
    lastCachedTokens = null;
    lastCachedTokensSession = null;
    lastContextWindow = null;
    lastHasUsage = null;
    applyUsage();
    syncEmptyHint();
  }

  /**
   * 装载新 vault 之后由装配层调用（src/main.ts 的 applyVault，M312）：面板的会话状态在后端
   * 按 vault 分桶，这里把作用域基准切过去、丢掉旧 vault 的渲染面，并按当前 vault 重拉快照。
   *
   * 本地态的处置口径（写在这里，免得下次再推一遍）：
   * - **composer 草稿换成新 vault 的那一份**（change composer-draft-persistence）：先丢弃
   *   属于旧 vault 的待写内容，再按**当前 vault**（后端已切完，落点按 scope 解析）读回草稿
   *   铺进输入区。旧 vault 的待写由**切换前**的 flush 写走（见 `flushDraft` 的调用点）——
   *   本函数跑在后端切完 vault 之后，此刻再写就会把旧草稿写进新 vault 的文件；
   * - **上下文 chip 重取**：同上，改指新 vault 的当前文档（此刻多数是「无」）；
   * - 发送相位经 finished 收口回 idle：见 resetView；
   * - 语言 / 主题 / 面板开合状态都不动（它们不属于会话）。
   */
  function vaultChanged(root: string): void {
    if (root === currentVault) return; // 同一个 vault 的重复装载（重定位 / 重开）不重置视图
    currentVault = root;
    resetView();
    // 输入区回空态（连带撤销史——新 vault 的草稿是新的编辑史），随后异步换上新 vault 的草稿。
    undoHistory.clear();
    renderComposer([{ kind: "paragraph", text: "" }], null);
    refreshChip();
    fetchSnapshot();
    void restoreDraft();
  }

  /** 可点路径索引的下发（见 `pathLinkPaths` 的注释）：整表替换，一次建 Set。 */
  function setPathLinkIndex(paths: readonly string[]): void {
    pathLinkPaths = new Set(paths);
  }

  /**
   * 读回当前 vault 的草稿并铺进输入区（装载 vault 后调用；app 启动装载与切 vault 共用这条路）。
   *
   * 三道守卫：
   * - **世代**：读盘是一次 IPC 往返，途中又切了一次 vault 时本次结果作废（旧 vault 的草稿
   *   绝不许落到新 vault 的输入区——与快照的 snapshotSeq 同一条纪律）；
   * - **用户已动手**：窗口里用户可能已经开始输入，那就只用「仍是原始空态」时才恢复
   *   （`composerIsPristine`），不覆盖用户刚打的字；
   * - **光标**：恢复的光标落位只在**输入区持焦**时施加——面板不持焦时那支光标属于别人
   *   （编辑器 / 树），程序化改选区会把它拽走（M343 起 composer 的选区只在本面板持焦时动）。
   *
   * 无草稿 / 文件损坏 / 版本不符（store 的 `load` 返回 null / 抛出）→ 保持空输入区，不报错、
   * 不伪造内容（spec「草稿损坏时安静回落」）。
   */
  async function restoreDraft(): Promise<void> {
    const seq = (draftSeq += 1);
    let loaded: { blocks: ComposerBlock[]; caret: { block: number; offset: number } | null } | null;
    try {
      loaded = await draft.load();
    } catch {
      loaded = null;
    }
    if (seq !== draftSeq) return; // 读盘途中又切了一次 vault：本次结果作废
    if (loaded === null || loaded.blocks.length === 0) return;
    if (!composerIsPristine()) return; // 用户已经动手：不用盘上的旧内容覆盖他
    undoHistory.clear();
    renderComposer(loaded.blocks, null);
    // 光标落位：只在输入区持焦时施加（见函数头第三条守卫）。
    if (loaded.caret !== null && composer.contains(document.activeElement)) {
      setDomCaret(loaded.caret);
    }
    updateEmptyClass();
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
    // 重新发送即解除上一回能力闸的错误态（若再被拒，catch 里按名重新标出）。
    imageGateErrored.clear();
    // 引用失败的输入区状态行随本条消息发出而收起（它描述的是「这条输入里的引用」；
    // 留到发送之后就成了上一轮的残影）。卡片上的留痕是卡片自身的一部分，不在此清。
    applyQuoteFailureNotice(null);
    // 投递投影（change harness-composer-image-paste design §4.2）：parts 与文本面由同一个
    // 函数产出——parts_json 给后端装配 content 数组，text = 面板/复制源/会话名素材的
    // 序列化文本（含图片占位元素行）。纯文本消息投影为单 text part，与历史行为逐字节一致。
    const parts = serializeDelivery(blocks);
    const text = serializeQuoteMessage(blocks);
    if (text.trim() === "") return;
    const hasCards = blocks.some((b) => b.kind !== "paragraph");
    // 携带卡片 ⇒ 跳过视口注入（spec「携带卡片时跳过视口」）；路径注入恒在。
    const block = assembleHarnessContext(editor, { skipViewport: hasCards });
    lastChip = block ?? "none";
    applyChip();
    appendUserMessage(blocks, text, Date.now()); // 上屏打戳（when 的 data-ts）
    // 会话名：本逻辑会话的首条用户消息定名（未发过时）；卡片与序列化文本不作名。
    // 乐观上屏——发送闸拒绝（harness_image_unsupported）时须在 catch 里回滚（见下方 prev 保存）。
    const prevFirstUserText = firstUserText;
    if (firstUserText === null) {
      firstUserText = firstUserTextOf(blocks);
      applySessionName();
    }
    // 投递成功入队后草稿与撤销史一并归零（新消息是新的编辑史）。**清空动作本身不排期草稿**
    // （markDraft 只在模型修改出口调用，send 走的 renderComposer 不在其中）——发送成功后才
    // 真正清草稿（下面 then 里的 `draft.clear()`），被拒 / 失败时草稿保持原样（spec 的核心
    // 改变之一：MUST NOT 在乐观清空与回滚之间留下「崩溃即丢字」的空草稿窗口）。
    undoHistory.clear();
    // 记下发送前光标（M455）：拒发回滚要把输入区**原样**还回来——含光标。乐观清空的
    // `replaceChildren` 会把 WebKit 里既有的 DOM 选区塌到 composer 元素边界，回滚若用
    // `renderComposer(blocks, null)` 不落光标，DOM 选区就永远停在边界位（`{block:0,offset:0}`）；
    // 紧接的 `markDraft()` 会按这个错误的 caret 判「内容变了」，把盘上草稿重写一遍——只有 caret
    // 字段变（M455 实测：草稿 sha 由 `85da8511` 变 `d6a41e72`，违反 design §9⑤「被拒后草稿文件
    // 内容不变」）。回滚时把这份光标连同块一起还原，模型态才真正回到发送前。
    const preSendCaret = caretFromDom()?.focus ?? null;
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
    harnessSend(JSON.stringify(parts), block !== null ? serializeHarnessContext(block) : "")
      .then(() => {
        // 发送被接受（后端已入队）→ 清除草稿（含落盘）：内容已进会话，不再是「未发送的输入」
        // （spec「发送成功后清除」）。clear 同时取消防抖窗口里那份旧内容的待写——否则它会在
        // 1s 后把刚发出去的内容又写回盘上；失败只记 warning（不影响「已发送」这个事实）。
        void draft.clear();
      })
      .catch(
        (e: unknown) => {
          turnOpen = false;
          applySendPhase(reduceSendPhase(sendPhase, { type: "finished" }));
          // 发送闸拒绝（harness_image_unsupported，design §6）：会话不推进——撤下刚沉淀的
          // 用户消息、composer 原样恢复（输入区内容保留）、toast 人话错误、图片卡片标错误态
          // （前端不另立能力判定，只认后端这一个 code）。
          if (errorCodeOf(e) === "harness_image_unsupported") {
            const last = transcript.lastElementChild;
            if (last !== null && last.classList.contains("lumir-hp-msg-user")) last.remove();
            // 乐观上屏的回滚：会话没推进，会话名也不许留下（否则标题栏像「已发送」）。
            firstUserText = prevFirstUserText;
            applySessionName();
            // 错误态按名记入模型侧（见 imageGateErrored）——renderComposer 重建卡片后依旧标出。
            for (const block of blocks) {
              if (block.kind === "image") imageGateErrored.add(block.card.name);
            }
            // 连同发送前的光标一起还原（M455）：只还原块会让 DOM 选区停在乐观清空塌下来的
            // 边界位，下面那次 markDraft() 便按错误 caret 把草稿重写一遍。
            renderComposer(blocks, preSendCaret);
            // 被拒 = 内容还在输入区、也还在未发送状态：草稿按回滚后的块重新对齐（与盘上那份
            // 内容相同时不写盘；若发送前的待写被别的路径清掉过，这一步把它补回来）。光标已还原
            // ⇒ 内容与 caret 都与盘上一致时这次 schedule 是 no-op，草稿逐字节不变。
            markDraft();
            syncEmptyHint();
            deps.toast(errorText(e));
            return;
          }
          // 其余失败（busy / 线程起不来 / …）：输入区已乐观清空、内容进了 transcript 的那条
          // 用户消息。草稿**原样保留**（MUST NOT 因一次失败丢掉用户打的字，spec「发送被拒 /
          // 失败时草稿 SHALL 原样保留」）——它会在下次编辑时被新内容自然覆盖。
          appendError(t("D347", { reason: errorMessage(e) }));
        },
      );
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
  // （imeGateState 声明在面板前部 normalizing 旁——HC5 的组合窗闸门要读它。）
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
    // M455：就地 redo 只归 **⌘Y**。⌃Y 是统一键位表里 `text` 作用域的 `editor.yank`
    //（`Ctrl-y`，keys.ts:585）——若在此 `preventDefault` 吞掉，分发器对已消费事件让路
    //（keys.ts:934 的 defaultPrevented 早退），composer 的 ⌃Y 永远落不到 `yankAtCaret`，
    // 而编辑器侧 ⌃K 写进**跨面共用** kill 槽的内容因此插不回来（验收场景 145 实测）。
    // 收窄到 meta-only 与下方 §5.3a 对 Backspace/Delete 的收窄同形：修饰键不匹配的键
    // 落到 `if (mod) return;`（不 preventDefault），照常冒泡给分发器。
    if (event.metaKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    // M457（HC3 第 3 条）：边界光标位上的**内容型键入**由本层自己走模型。边界位（卡片前缘 /
    // 两张相邻卡片之间）是无文本宿主的位置——卡片是 contenteditable=false 的原子块、块级容器
    // 边界量不出 caret 几何，引擎因此**不派 beforeinput / input**（WebKit 实测：keydown 到达
    // composer、beforeinput 与 input 都不派、字也不落）。挂在 beforeinput 上的物化（下方
    // §insertText 档）在「两张相邻卡片之间」永远不可达——Alex 2026-10-12 的「两卡之间不能输入」
    // 即此。判据收在模型层纯函数 `boundaryTypingCaret` 里（折叠选区 + 非修饰 + 可打印单字符 +
    // 非组合期 + 卡片前缘），命中才 preventDefault + 物化，其余按键照旧走各自路径。
    const boundaryTyped = boundaryTypingCaret(readBlocksFromDom(), caretFromDom(), {
      key: event.key,
      mod,
      alt: event.altKey,
      composing: imeGateState.composing,
    });
    if (boundaryTyped !== null) {
      event.preventDefault();
      withModel((blocks) => insertPlainTextAtCaret(blocks, boundaryTyped, event.key), STRUCTURAL_EDIT_FORCE);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) {
        // ⇧Enter 软断行是结构性操作（拆段），force 走 `softBreakStep` / `STRUCTURAL_EDIT_FORCE`
        // 的单一真源（M510 之前此处写字面量 false，与 withModel 文档的「拆段」漂移）。
        const step = softBreakStep(() => caretFromDom()?.focus ?? null);
        withModel(step.op, step.force);
      } else {
        send();
      }
      return;
    }
    // M447（change composer-emacs-nav §5.3a）：就地路径只处理**不带任何修饰键**的那一拍——
    // ⌥⌫ / ⌥Delete 让给统一键位表（`text` 作用域）。不收窄则面板的 keydown（挂在 composer 上、
    // 先于 window 分发器）先 `preventDefault`，而分发器对已消费事件让路（src/keys.ts 的
    // `defaultPrevented` 早退）⇒ ⌥⌫ 的表内绑定**永远不命中**、退化为逐字符退格（一个「绑了
    // 没用」的静默失配）。裸 Backspace / Delete 仍是既有模型路径（本能力 MUST NOT 改变它）。
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const sel = caretFromDom();
      if (sel === null) return;
      event.preventDefault();
      // 裸 Backspace / Delete 与 ⌃D / ⌃H 同走删除族的模型步（`deleteFamilyStep`，force 单一真源）。
      const step = deleteFamilyStep(
        readBlocksFromDom(),
        sel,
        event.key === "Backspace" ? backspaceAtCaret : deleteForwardAtCaret,
      );
      if (step === null) {
        // 空转（段首退格 / 前向删除到末缘）：既有语义是仍走一次空模型写（归一化重渲、不留半截
        // 状态）。force=false 是**删除族路径上唯一的豁免**：空转不是编辑，给个 `true` 反而会在
        // 栈顶造出「撤销了看不出变化」的幽灵撤销步（与栈顶去重同旨）；聚簇照常吞掉这一拍。
        withModel((blocks) => ({ blocks: [...blocks], caret: sel.focus }), false);
        return;
      }
      withModel(step.op, step.force);
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
    if (type === "insertText" || type === "insertReplacementText") {
      // 边界光标位（卡片前缘）上的键入走模型（design §3.2）：物化一个段落把字符写进去，
      // 与该次输入合成**一个**撤销步。原生路径在这里会让字符落进相邻段落、或自造裸节点。
      const caret = collapsedCaret();
      const typed = event.data ?? "";
      if (caret !== null && typed !== "" && isCardFrontCaret(readBlocksFromDom(), caret)) {
        event.preventDefault();
        withModel((blocks) => insertPlainTextAtCaret(blocks, caret, typed), STRUCTURAL_EDIT_FORCE);
        return;
      }
    }
    if (type === "insertText" || type === "insertReplacementText" ||
        type === "deleteContentBackward" || type === "deleteContentForward" ||
        type === "deleteByCut" || type === "deleteWordBackward" || type === "deleteWordForward" ||
        type === "deleteSoftLineBackward" || type === "deleteSoftLineForward") {
      // 原生文本编辑：允许落进 .qpara，但压一次撤销前态（聚簇/去重/redo 作废在 history 里）。
      // force=false 是**豁免**：这是**键入**（打字流），本就该与相邻键入聚合成一个撤销步。
      undoHistory.push(snapshot(), false);
      return;
    }
    event.preventDefault();
  });
  composer.addEventListener("compositionstart", () => {
    imeGateState = imeGateCompositionStart(imeGateState);
    const caret = collapsedCaret();
    if (caret !== null && isCardFrontCaret(readBlocksFromDom(), caret)) {
      // 边界光标位上的 IME（design §3.2）：先物化一个空段落承接组合内容。**此处刻意不整面
      // 重渲**——withModel 的 replaceChildren 会销毁正要开始组合的目标节点、打断 IME 会话；
      // 模型侧读法（readBlocksFromDom）随之看到新段落，其余 DOM（含两张卡片）原样不动。
      undoHistory.push(snapshot(), STRUCTURAL_EDIT_FORCE);
      composer.insertBefore(createParaEl(""), composer.children[caret.block] ?? null);
      setDomCaret({ block: caret.block, offset: 0 });
      return;
    }
    undoHistory.push(snapshot(), STRUCTURAL_EDIT_FORCE);
  });
  composer.addEventListener("compositionend", () => {
    imeGateState = imeGateCompositionEnd(imeGateState, Date.now());
    undoHistory.breakCluster(); // 组合整段是一个撤销步：下一拍编辑强制重新压栈。
    updateEmptyClass();
    markDraft(); // IME 落定的字符在此刻才进 DOM（组合期不排期），草稿按最终文本落盘
    scheduleImeBackfill(); // HC5 补账（到期早于窗尾时续排，见该函数注释）
  });
  // 粘贴分派（quirk ① + change harness-composer-image-paste design §7）：剪贴板含
  // `image/*` 文件项 → 图优先（读 Blob → base64 → harness 侧落盘 → 光标处插图片卡片；
  // 夹带文本 MUST NOT 另行落入输入区）；否则只收 text/plain，多行经模型拆成多个段落块，
  // 跨块选区先整块删除——纯文本路径与本能力存在之前逐字节一致。
  composer.addEventListener("paste", (event: ClipboardEvent) => {
    event.preventDefault();
    const items = event.clipboardData?.items;
    if (items !== undefined) {
      const imageIndex = firstImageFileIndex(items);
      if (imageIndex >= 0) {
        const file = items[imageIndex].getAsFile();
        if (file !== null) void pasteClipboardImage(file);
        return;
      }
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text === "") return;
    withModel((blocks) => {
      const sel = caretFromDom();
      if (sel === null) return insertPlainTextAtCaret(blocks, { block: blocks.length - 1, offset: 0 }, text);
      const collapsed = sel.anchor.block === sel.focus.block && sel.anchor.offset === sel.focus.offset;
      const base = collapsed ? { blocks: [...blocks], caret: sel.focus } : deleteSelectionRange(blocks, sel);
      return insertPlainTextAtCaret(base.blocks, base.caret, text);
    }, STRUCTURAL_EDIT_FORCE);
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
      STRUCTURAL_EDIT_FORCE,
    );
  });
  composer.addEventListener("input", () => {
    updateEmptyClass();
    markDraft();
  });
  composer.addEventListener("focus", refreshChip);
  // 输入区失焦 = 本面板的**离散 flush 主挂点**（change composer-draft-persistence design §4）。
  // 理由见 flushDraft 的注释：切 vault 必经「先离开输入区」，而 vaultChanged 跑在后端切完之后。
  composer.addEventListener("blur", flushDraft);

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

  // ── cron 点击发起运行的切屏（M612，change add-cron-runtime-daemon §7.2 / 场景 170）──────
  //
  // 点击通知发起的运行走**交互槽位**（后端与 `harness_send` 同一条运行实现），但后端不为它发
  // `sent` / `auto_turn_started` 事件：面板不主动切屏，这两件事就会同时坏掉——
  //   ① 面板停在上一段会话（或空占位），用户看不到这次运行的 prompt；
  //   ② `turnOpen` 仍是 false，先到的 `text_chunk` / `tool_call` 会被轮次闸门当「已结束轮次的
  //      迟到产出」丢掉（M374 闸门），回答永远上不了屏。
  // 因此由装配层在 `invoke("harness_cron_run")` **之前**调本函数：清渲染面、prompt 上屏、闸门
  // 与发送相位立刻置为运行中。运行终态（done）后按后端快照重载一次——专用会话（dedicated）
  // 的历史因此回到面板，面板内容最终仍以后端为单一真源。
  //
  // **忙判定先行**（M612 r1 P2-1）：交互轮次在途（sendPhase 非 idle）时后端 `acquire_turn`
  // 必然 busy 拒单，乐观切屏注定被回滚；而 `resetView` 会把握手轮次的流式泡清空、`turnOpen`
  // 关掉，随后 catch 里的快照回滚又只取到中段——在途轮次后续分片被 M374 闸门当迟到产出丢弃。
  // 这种点击什么都不该动渲染面：返回 false，装配层据此跳过失败回滚。
  function beginCronRun(prompt: string): boolean {
    if (sendPhase !== "idle") return false;
    // 在途快照作废（seq 与 fetchSnapshot 同一条纪律）：切 vault 那一次快照可能还没回来，
    // 迟到的响应会把它的消息追加进刚清空的渲染面（与乐观上屏的 prompt 重复 / 串台）。
    snapshotSeq += 1;
    resetView();
    const blocks: ComposerBlock[] = [{ kind: "paragraph", text: prompt }];
    appendUserMessage(blocks, prompt, Date.now());
    firstUserText = firstUserTextOf(blocks);
    applySessionName();
    stageWaiting = true;
    turnOpen = true;
    applySendPhase(reduceSendPhase(sendPhase, { type: "sent" }));
    cronRunAdopted = true;
    return true;
  }

  /** 按后端当前会话重取快照并重建渲染面（M612）：cron 点击运行发起失败时的回滚通道——
   *  `beginCronRun` 的乐观切屏必须撤回，面板回到后端真实会话，不留下一条没发出去的 prompt。
   *  不切 vault（与 `vaultChanged` 的区别：无 vault 作用域变化，只换渲染面）。 */
  function reloadSession(): void {
    cronRunAdopted = false;
    resetView();
    fetchSnapshot();
  }

  /** 会话浮层可见态的唯一写入口（O5 / aria-expanded 同步，M442）：`sessPop.hidden` 与
   *  `aria-expanded` 是同一次跃迁的两面，由 `sessPopDom` 从同一个布尔派生（合同
   *  docs/specs/overlay-visibility.md 的 O5）。分开写正是 M442 缺陷的形态——`aria-expanded`
   *  按展开意图翻 true，而浮层因空清单从未真正揭示，属性与真实可见态脱节。 */
  function applySessPop(visible: boolean): void {
    const dom = sessPopDom(visible);
    sessPop.hidden = dom.hidden;
    // 层栈登记与真实可见态同源（change fix-escape-overlay-close-oct24）：**按揭示后的状态**登记，
    // 不按「想展开」的意图——空清单不揭示，那时登记会让栈顶指向一个不可见的层。
    if (dom.hidden) unregisterEscapeLayer("harness-sess-pop");
    else registerEscapeLayer("harness-sess-pop", closeSessPop);
    sessionButton.setAttribute("aria-expanded", dom.ariaExpanded);
  }

  /** 会话浮层关闭的唯一实现（就地键处理器与窗口级兜底共用，E5）：收起 + 焦点回会话名钮。 */
  function closeSessPop(): void {
    setSessPop(false);
    if (sessionButton.isConnected) sessionButton.focus();
  }

  /** 每轮展开分配一个序号；取数回调只认自己那一次。迟到的旧取数（取数期间浮层被收起 /
   *  用户又点了一次）作废——不揭示、也不反馈，避免「点了又点弹出两条提示」这类错位。 */
  let sessPopSeq = 0;

  /** 会话浮层开合（M351 a11y + M442 合同，design §5）。展开**先取数、确认清单非空才揭示**
   *  （O5）——MUST NOT 先开出空浮层再因空清单收起：「可见但无内容」的中间态正是 M442 现场
   *  （200px 空盒先画出、IPC 往返后收起 = 用户看到的「闪现即消失」）。空清单 / 取数失败一律
   *  不揭示，并给用户可感知反馈（D362 / 错误 toast），不得静默。 */
  function setSessPop(open: boolean): void {
    sessPopSeq += 1; // 任何跃迁都作废在途揭示
    if (!open) {
      applySessPop(false);
      return;
    }
    buildSessList(sessPopSeq);
  }

  /** 会话浮层定位（M397；M702 起宽度与横向落点走统一入口）：浮层是 `position: fixed`
   *  （见 harness-panel.css 的同名规则），坐标按**会话名钮的视口矩形**现算，并夹在视口内
   *  ——不变量是「浮层包围盒完整落在视口内、且不被任何祖先容器的 overflow 裁切」
   *  （docs/specs/overlay-visibility.md）。**揭示之后、清单已填充时算一次**（调用点在
   *  buildSessList 的 .then 里、applySessPop(true) 之后）：M442 起浮层只在清单非空时揭示，
   *  揭示与定位因此同处「清单已就位」这一个时刻——显示与定位在同一次同步任务内完成、中间
   *  不落空内容帧，纵向夹取也按最终高度一次算准。宽度取 L 档（内容驱动 + 26em + 200px 下限），
   *  旧定值 200px 在 2.13 档把名字裁掉 81%（M698 §3.3）；pane / 视口尺寸变化后的重夹见
   *  reclampOpenOverlays。纵向 4px 沿用原 CSS `top: 30px` 减去钮高 26 的实测间距。 */
  function placeSessPop(): void {
    const gap = 4;
    const margin = 8;
    // 宽度 + 横向落点（M702，L 档）：内容驱动 + 26em 上限，由 placePop 收窄并夹进视口。
    // 宿主是**视口**——浮层是 position: fixed，包含块不落在任何裁切祖先里（O3），
    // 与 pane 无关。横向仍与钮左缘对齐、右端不越出视口：placePop 的位移最小规则给出同形结果。
    placePop(sessPop, { tier: "list", host: "viewport", preferred: "left" });
    const rect = sessionButton.getBoundingClientRect();
    const h = sessPop.offsetHeight;
    // 纵向：钮下沿之下，下端不越出视口（长历史清单由 .lumir-hp-sesspop-list 的 max-height 兜住）。
    const top = Math.min(rect.bottom + gap, Math.max(margin, window.innerHeight - h - margin));
    sessPop.style.top = `${top}px`;
  }

  /** 历史会话清单现建（每次打开现拉——会话文件随对话增长，不囤旧清单）：每行 =
   *  恢复钮（会话名 + 时间读数，点击即恢复续聊）+ 删除钮（×，M406 会话删除——行内
   *  两步确认，确认后调 harness_delete_session）。行是临时 DOM（浮层关即弃），不注册
   *  onRelabel——与合并选择器浮层同口径。空清单 / 取数失败 = 浮层整层不开且给可感知反馈
   *  （M442 起走 sessPopDecision；「新建会话」动作项已随 M406 退场，浮层没有空壳形态）。
   *  恢复钮与删除钮是并列兄弟（div 壳），MUST NOT 钮套钮——WKWebView 把嵌套 button
   *  当叶子，AX 树不暴露内层（M351 finding，同 sessionWrap 的纪律）。
   *
   *  `seq` 是本轮展开的序号：回调开头核对 `seq === sessPopSeq`，不符即作废（取数期间浮层被
   *  收起 / 用户又点了一次——见 sessPopSeq 注释）。 */
  function buildSessList(seq: number): void {
    sessList.replaceChildren();
    sessList.hidden = true;
    harnessListSessions()
      .then((list) => {
        if (seq !== sessPopSeq) return; // 期间已收起 / 又点了一次：这次取数作废
        const entries = sessionEntriesOf(list);
        const decision = sessPopDecision(
          entries.length === 0 ? { kind: "empty" } : { kind: "entries", count: entries.length },
        );
        if (!decision.visible) {
          // 空清单：不揭示 + 可感知反馈（D362），不得静默（O5）。
          if (decision.notify) deps.toast(t("D362"));
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
          // 会话名优先级（change add-session-auto-naming，design D11）：有效标题 → 首条用户
          // 消息截断 → D330。与标题栏共用 sessionNameShown（同一口径、同一截断规则）；tooltip
          // 保留未截断的原始名（标题本身 ≤20 码点，回落名给全文）。
          const rawName = sessionNameSource(entry.title, entry.firstUserText);
          const text = sessionNameShown(entry.title, entry.firstUserText);
          name.textContent = text;
          name.dataset.name = text;
          name.title = rawName ?? text;
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
        // 此刻才揭示（O5）：清单已确认非空。揭示与定位同处「清单已就位」这一个同步任务内、
        // 中间不落空内容帧——placeSessPop 按最终高度一次夹准（M397 r1 P2-1 的「先按空盒夹、
        // 填清单后再重夹」两段随之消失）。
        applySessPop(true);
        placeSessPop();
      })
      .catch((e: unknown) => {
        if (seq !== sessPopSeq) return; // 期间已收起 / 又点了一次：这次取数作废
        // 取数失败（后端不可用 / 命令未注册 / 读取报错）：不揭示 + 可感知反馈，不得静默（O5）。
        if (sessPopDecision({ kind: "failed" }).notify) deps.toast(errorText(e));
      });
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
   *  重取（恢复真实带回源会话档位）。
   *  **用量读数经 refreshUsageState 重取**（M526）：后端恢复时把源会话的读数种子灌进了新会话
   *  （留存重算：最近一次真实读数 + 会话累计），经 harness_state 快照应用——控制行/气泡恢复后
   *  即有真值；从未发过请求的会话快照 has_usage=false，读数区保持隐藏（不假读数）。 */
  function resumeSession(entry: SessionEntry): void {
    harnessResumeSession(entry.sessionId)
      .then((info) => {
        resetView();
        renderSnapshotMessages(Array.isArray(info.messages) ? info.messages : []);
        firstUserText = entry.firstUserText;
        // 恢复后的标题 = 选中项的有效标题（后端 `SessionSummary.title` 的同一读数；恢复入口在
        // 源有标题时把 inherit 记录写进新文件，值与此一致——design D7/D11）。
        sessionTitle = entry.title;
        applySessionName();
        // 恢复批次收尾落在末尾（与 restoreSnapshot 末尾同一句）：`appendSnapshotMessage` 的
        // assistant 分支是裸 `transcript.append(el)`、不滚——恢复 transcript 以 assistant 收尾
        // （会话常态：末轮答复后用户尚未再提问）时少了这一句就停在最末 user 消息处、收尾回复
        // 折在视口外（M398 r1 P1）。user / tool 分支自带滚动不足以覆盖这个尾形态。
        follow.jumpToBottom(); // 分流表 #16：恢复历史会话必须从末尾读起（既有语义）
        refreshThinkingState();
        refreshUsageState();
        // 恢复出的会话若带子运行分桶（M589 的恢复重算），任务区的用量区要跟着出来——
        // 恢复命令只回放消息，不含读数快照（M590 真机场景 192：恢复后用量区整块缺席）。
        refreshTaskState();
      })
      .catch((e: unknown) => appendError(t("D348", { message: errorText(e) })));
  }
  // 会话名下拉：展开/收起浮层（浮层 = 历史会话选择器，M392；「新建会话」动作项随 M406
  // 退场，新建归首行加号钮）；浮层外交互（点击其他处）收起。按钮在标题栏（drag 区）
  // 里——clickable 元素由 tauri drag.js 自动阻断拖拽，不需要 mousedown preventDefault
  //（REVIEW.md 「标题栏 preventDefault」条）。
  sessionButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setSessPop(sessPop.hidden);
  });
  // 段上的 Escape：段在标题栏里、不在 panel 子树内，所以它单独挂一条监听。自 change
  // fix-escape-overlay-close-oct24 起它不再自判「是不是关闭意图」，而是调**窗口级兜底同一个**
  // `escapeRouter.handle`——准入（无修饰才关、组合期让路）、「谁是最上层」（层栈）与关闭实现
  // （各层自己的 close）都只有一份（design §3.1/§3.2、E5）。tower r1 P1 的现场正是这里：
  // 只看 `event.key === "Escape"` 会把 ⇧/⌘/⌃/⌥+Escape 与组合期当成关闭意图。
  seg.addEventListener("keydown", (event: KeyboardEvent) => {
    escapeRouter.handle(event);
  });
  // 浮层外交互（点击其他处）收起：会话浮层、合并选择器浮层、权限浮层、ctx hover 泡共用一条出口。
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && sessPop.contains(event.target)) return;
    if (event.target instanceof Node && sessionButton.contains(event.target)) return;
    setSessPop(false);
    if (event.target instanceof Node && selPop.contains(event.target)) return;
    if (event.target instanceof Node && modelChip.contains(event.target)) return;
    setSelPop(false);
    if (event.target instanceof Node && permPop.contains(event.target)) return;
    if (event.target instanceof Node && permChip.contains(event.target)) return;
    setPermPop(false);
    if (event.target instanceof Node && ctxWrap.contains(event.target)) return;
    setCtxPopVisible(false);
  });

  // 面板内 Escape（就地消费，不进键位表：Escape token 已被 editor.widget-escape
  // 占用，面板在 contentDOM 之外，那条绑定不命中——与 M139 搜索 panel 同先例同判词）。
  //
  // change fix-escape-overlay-close-oct24：这段**不再自己排一遍「先浮层后面板」的检查顺序**
  // （那正是本 change 要收掉的第二份实现——面板与会话浮层同时打开时那个顺序会越过去），改为调
  // 与窗口级兜底**同一个** `escapeRouter.handle`：层栈是「谁最上层」的唯一判据，各层的关闭实现
  // 复用组件自己的 close（E1/E5、design §3.2）。无浮层时栈顶就是面板本体，`handle` 因此照旧
  // 经 deps.togglePane 收面板（装配层动作：账本收 pane + 焦点归还）。
  panel.addEventListener("keydown", (event: KeyboardEvent) => {
    escapeRouter.handle(event);
  });

  // ── 唤起 / 收起（装配层执行；面板只维护挂载态与派生表现）───────────────────
  function attachTo(mount: HTMLElement | null): void {
    if (mount === mountEl) return;
    mountEl = mount;
    if (mount !== null) {
      // 段挂接不变量（M435）：收起路径（装配层 disposePaneHandle）会把段从标题栏摘除
      // （assembly.stripEl.remove()），而构造期的 insertBefore 是一次性的——重开 pane
      // （切 vault 后 ⌘⇧A；单 vault 收起重开同一条路径）时段引用还在 titlebar 之外，
      // 只翻 hidden 不会上屏。挂载时按「长驻元素的容器在场」重断言挂回（M351 同族：
      // 长驻元素被新容器 / 摘出口丢掉后必须重新插入）。已挂接时早退，零成本。
      if (seg.parentElement !== shell.titlebar) {
        shell.titlebar.insertBefore(seg, toggleButton);
      }
      mount.append(panel);
      panel.hidden = false;
      // 面板本体也是层栈里的一层（design §3.5 第一行）：它的关闭实现就是装配层那条
      // `deps.togglePane`（账本收 pane + 焦点归还），就地处理器与兜底都调这一条。
      registerEscapeLayer("harness-panel", closeHarnessPanel);
      refreshChip();
      // M644：重新打开面板 = 白名单动作（D5）——强制回底并恢复跟随。同时覆盖「隐藏期间
      // 布局读数不可信」的现场（元素摘下时 clientHeight 为 0）；挂载后的真实尺寸由
      // ResizeObserver 再补一次贴底。
      follow.jumpToBottom();
      // when 的 30s 低频刷新：只在挂载期间走表（摘下即清，重挂重建）。
      if (whenTimer !== null) window.clearInterval(whenTimer);
      whenTimer = window.setInterval(refreshWhoLines, 30_000);
      // 会话身份看守（M370）：同一份生命周期——挂载起表、摘下即清。
      watchedSession = editor.activeSession();
      if (chipWatchTimer !== null) window.clearInterval(chipWatchTimer);
      chipWatchTimer = window.setInterval(watchActiveSession, 400);
    } else {
      // 摘出 DOM（元素长驻内存：订阅 / 撤销栈 / 流式态不丢），浮层与刷新表随之收起。
      // 摘之前先把待写的草稿落盘（面板关闭是一个离散 flush 时点，design §4：面板收起后输入区
      // 不在屏幕上，用户不会再「顺手」给它一次防抖机会）——草稿没写走就再也没有第二次机会。
      flushDraft();
      panel.remove();
      // 注销先于各浮层的 setXxx(false)：栈序无关紧要（remove 幂等），但面板本体必须离开
      // 栈顶之后，下一次 Escape 才不会去调一个已收起的 pane。
      unregisterEscapeLayer("harness-panel");
      setSessPop(false);
      setSelPop(false);
      setPermPop(false);
      setEffHintVisible(false);
      setCtxPopVisible(false);
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

  // 消息摘录手势（change harness-message-excerpt）：transcript 消息体选区 → 浮动钮 → 卡片入
  // composer。面板单例、进程内长驻，句柄的 dispose 不接生命周期（构造期注册即终态）。
  createMessageQuoteGesture({
    transcript,
    insert: insertMessageQuoteCard,
  });

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
    beginCronRun,
    reloadSession,
    setPathLinkIndex,
    setChromeRetreat(on) {
      toggleButton.hidden = on;
    },
    insertQuoteCard(card: QuoteCard): void {
      const valid = createQuoteCard(card); // lines 非空校验（取不到行范围不得生成卡片）
      if (mountEl === null) deps.togglePane(); // 装配层开 pane 后焦点已落 composer
      // 一次新的引用收口上一次引用的失败状态行（spec：读数存活到「下一次引用」——文本摘录
      // 也是一次引用；r1 P2-1）。
      applyQuoteFailureNotice(null);
      const caret = withModel((blocks) => {
        const sel = caretFromDom();
        const at = sel === null ? { block: blocks.length - 1, offset: 0 } : sel.focus;
        return insertCardAtCaret(blocks, at, valid);
      }, STRUCTURAL_EDIT_FORCE);
      focusComposerAfterInsert(caret);
    },
    insertQuoteWithImages(card: QuoteCard | null, outcomes: readonly QuoteImageOutcome[]): void {
      const valid = card === null ? null : createQuoteCard(card);
      const images: QuotedImage[] = [];
      let failed = 0;
      for (const outcome of outcomes) {
        if (outcome.ok) images.push(outcome.image);
        else failed += 1;
      }
      if (valid === null && images.length === 0) {
        // 什么都没有插进去（图片悬停引用钮 / 只选图片且全部失败）：不是「什么都没发生」——
        // 失败留痕落在输入区（D586），持久可见到下一次引用 / 发送 / 切会话。面板未开时先开
        //（与插入路径同一条先开再写：状态行挂在面板上，面板不在场就没人看得见）。
        if (failed > 0) {
          if (mountEl === null) deps.togglePane();
          applyQuoteFailureNotice(quoteFailureText(failed));
        }
        return;
      }
      if (mountEl === null) deps.togglePane(); // 装配层开 pane 后焦点已落 composer
      for (const image of images) imageSourceOf.set(image.card.name, image.source);
      // 失败留痕的落点（M662）：有文本卡片时挂卡片（出处行的 D586 读数，随卡片在 composer 里
      // 一起活）；没有卡片时挂输入区状态行。两者只出现一处，不重复播报同一次失败。
      if (valid !== null && failed > 0) quoteImageFailures.set(valid, failed);
      applyQuoteFailureNotice(valid === null && failed > 0 ? quoteFailureText(failed) : null);
      // **一次** withModel = 一个撤销步（⌘Z 一次撤掉整次引用）：卡片 + 图片块在同一个模型步里
      // 依次落位（每次插入复用 insertBlockAtCaret 的拆段 / 光标落点语义）。
      const caret = withModel((blocks) => {
        const sel = caretFromDom();
        let at: ComposerCaret = sel === null ? { block: blocks.length - 1, offset: 0 } : sel.focus;
        let next: ComposerBlock[] = [...blocks];
        if (valid !== null) {
          const result = insertCardAtCaret(next, at, valid);
          next = result.blocks;
          at = result.caret;
        }
        for (const image of images) {
          const result = insertBlockAtCaret(next, at, { kind: "image", card: image.card });
          next = result.blocks;
          at = result.caret;
        }
        return { blocks: next, caret: at };
      }, STRUCTURAL_EDIT_FORCE);
      focusComposerAfterInsert(caret);
    },
    setQuoteJumpHandler(handler) {
      quoteJumpHandler = handler;
    },
    setStopHandler(handler) {
      stopHandler = handler;
    },
    applyTextScale(ratio: number): void {
      writeTextScale(ratio);
    },
    composerCommand(command: CommandId): void {
      runComposerCommand(command);
    },
  };
}
