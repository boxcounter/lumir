// 摘录引用卡片的数据模型与引用消息序列化（change add-harness-quote-cards / M342；
// 消息摘录卡片扩展见 change harness-message-excerpt design §3–§4）。
//
// **M447 起本模块还承载「两侧共用的文本原语」**（词 / 字素簇扫描 + 单槽 kill buffer）：编辑器侧
//（`src/editor.ts`）与 composer 侧（`src/harness-panel.ts`）都要用同一份，而 harness 面板的模块
// 图必须能进零 DOM 单测（`tests/unit`）——`src/editor.ts` 的模块图里有 TypeScript 参数属性
//（`src/preview/livePreview.ts` 一族），`node --experimental-strip-types` 直接报
// `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`（同 `src/enter-indent.ts` / `src/list-indent.ts` 的模块头
// 所述）。这个叶子模块是两侧都能 import 的最小共同点；因此它不再是「无 CodeMirror」——字素簇
// 扫描借 `@codemirror/state` 的 `findClusterBreak`（与编辑器侧同一口径，MUST NOT 各写一份）。
//
// 合同在 openspec/changes/add-harness-quote-cards/design.md §3「数据模型与序列化协议」与
// proposal.md 头部评审记录（一致性原则，Alex 2026-10-06）：
//   - 卡片数据是**单一真源**；序列化是它的**投影**——walker 只取 file / heading / lines /
//     摘录原文四个要投递的字段，不从 DOM 反推，也不取人侧专用字段 headingPath（hover title 用）；
//   - 每段摘录一行 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`，问题文字按交错
//     顺序排布在标签之间（卡片阅读顺序 = 序列化顺序）；
//   - lines MUST 非空（Alex：「想不到获取不到的场景」，取不到行范围则手势不产出卡片）；
//   - 属性值与文本节点 XML 转义，round-trip 可还原；
//   - **协议零编号**——不含 index 或任何序号属性（一致性原则：投递给模型的上下文要素对人必须
//     也可查，编号对人无区分价值）。
//
// composer 草稿（change composer-draft-persistence）复用本模块作为块模型的**无损存储形态**的
// 唯一实现点：`serializeComposerDraft` / `parseComposerDraft` 见文件末尾一节（与投递投影分开，
// 后者有损、不得当存储形态）。
//
// 本模块是纯数据 + 纯函数（无 DOM、无文案），消费者（composer 混排编辑区、
// 消息装配、transcript 沉淀）在后续 mission 接线。

import { findClusterBreak } from "@codemirror/state";

/** 摘录引用卡片。 */
export interface QuoteCard {
  /** vault 相对路径。 */
  file: string;
  /** 摘录上方最近一级标题；摘录在文档首个标题之前时为空串（出处行仅显示文档名）。 */
  heading: string;
  /** 完整标题链（如 `阅读工作流 › 筛选 › 倒序阅读`）——人侧 hover title 专用，**不进序列化**。 */
  headingPath: string;
  /** 行范围 `A-B`，创建时经 CM6 `lineAt(from)/lineAt(to)` 从选区捕获。MUST 非空。 */
  lines: string;
  /** 摘录原文。 */
  text: string;
}

/**
 * 消息摘录卡片（change harness-message-excerpt design §3）——来源是一条会话消息（role + 上屏戳）
 * 而非文档行范围，因此**不复用** QuoteCard：QuoteCard 的 file/lines 是文档行锚，留空复用会把
 * 「file/lines 必选」的文档不变量稀释成可选，并让失锚降级链（行号定位）对消息卡无意义地空转。
 */
export interface MessageQuoteCard {
  /** 来源消息角色：`"user" | "assistant"`。必选，进序列化。 */
  role: "user" | "assistant";
  /** 来源消息上屏戳（ms）。可缺（null）：快照恢复无 ts 的旧消息（who 行本就不显示时间）。 */
  at: number | null;
  /** 摘录原文——所见文本（`selection.toString()` 口径，渲染形态照录），与源 Markdown 可能不同形。 */
  text: string;
}

/**
 * harness 附件引用（change harness-composer-image-paste design §3）：内容寻址文件名
 * `pasted-<hash16>.<ext>` 是单一真源；`sourceMime` 是原始剪贴板 mime，仅供前端显示 /
 * 诊断，不进投递内容。
 */
export interface ImageRef {
  /** 内容寻址文件名 `pasted-<hash16>.<ext>`。序列化与留存里用的就是它。 */
  name: string;
  /** 原始剪贴板 mime（仅供前端显示/诊断，不进投递内容）。 */
  sourceMime: string;
}

/** 图片卡片数据（design §3）。字节不落数据模型——缩略图渲染时经读回命令按需取
 * （避免 base64 渗进快照与 JSONL）。 */
export interface ImageCard extends ImageRef {
  /** 像素尺寸（落盘命令回传，元信息行用）；快照从 wire 引用恢复时缺席（只显文件名）。 */
  width?: number;
  height?: number;
}

/**
 * 混排对话输入区的一个块：引用卡片、消息摘录卡片、图片卡片或问题段落，可任意交错。
 * 序列化顺序即数组顺序（卡片阅读顺序 = 序列化顺序），顶层只有这四类块。
 */
export type ComposerBlock =
  | { readonly kind: "quote"; readonly card: QuoteCard }
  | { readonly kind: "msgquote"; readonly card: MessageQuoteCard }
  | { readonly kind: "image"; readonly card: ImageCard } // harness-composer-image-paste 新增
  | { readonly kind: "paragraph"; readonly text: string };

/** `lines` 缺失时的错误文案：这是调用方的责任（取不到行范围就不得生成卡片），不是可降级的态。
 *  开发者向的抛出信息，不进 UI（i18n 取值门禁的 log 类豁免）。 */
export const LINES_REQUIRED_MESSAGE =
  "quote-card: lines 不能为空——取不到行范围时调用方不得生成卡片（design.md §3）"; // i18n-exempt: log

/** 消息摘录卡片 role 非法：调用方不得生成卡片（与 lines 非空同一条纪律）。开发者向，不进 UI。 */
export const MESSAGE_QUOTE_ROLE_MESSAGE =
  "quote-card: msg-quote role 必须是 user / assistant（design.md §3）"; // i18n-exempt: log

/** 消息摘录卡片原文为空：空选区调用方不得生成卡片。开发者向，不进 UI。 */
export const MESSAGE_QUOTE_TEXT_MESSAGE =
  "quote-card: msg-quote 摘录原文不能为空——空选区调用方不得生成卡片"; // i18n-exempt: log

/**
 * 组装一张卡片。唯一的校验是 lines 非空：取不到行范围时**调用方不得生成卡片**，
 * 因此这里直接抛错而不是产出退化卡片（退化卡片会静默地把无出处的摘录投给模型）。
 * 其余字段原样保存，不做归一化——摘录原文与标题链是展示/回指的依据，改写它们即失真。
 */
export function createQuoteCard(input: QuoteCard): QuoteCard {
  if (input.lines.trim() === "") throw new Error(LINES_REQUIRED_MESSAGE);
  return { ...input };
}

/**
 * 组装一张消息摘录卡片。校验 role 合法（`user` / `assistant`）与摘录原文非空——两者取不到时
 * **调用方不得生成卡片**，因此这里直接抛错而不是产出退化卡片（退化卡片会静默地把无出处 / 无
 * 内容的摘录投给模型）。`at` 可缺（null），不做校验；其余字段原样保存，不改写摘录原文。
 */
export function createMessageQuoteCard(input: MessageQuoteCard): MessageQuoteCard {
  if (input.role !== "user" && input.role !== "assistant") throw new Error(MESSAGE_QUOTE_ROLE_MESSAGE);
  if (input.text.trim() === "") throw new Error(MESSAGE_QUOTE_TEXT_MESSAGE);
  return { ...input };
}

/** 混排块的卡片数据判别：`role` 是 MessageQuoteCard 独有字段（QuoteCard 无 role）。 */
export function isMessageQuoteCard(card: QuoteCard | MessageQuoteCard): card is MessageQuoteCard {
  return "role" in card;
}

/**
 * ms 上屏戳 → ISO 8601 **本地**时间串（秒级），如 `2026-10-10T21:40:33`。
 *
 * 取本地各时间字段拼串，**不经过 `toISOString()`**（那是 UTC 且带毫秒与时区后缀）；协议是
 * AI 与人面向的，要与人看到的 when 读数同口径（Alex 2026-10-10「at 修订」：序列化属性名 `at`，
 * 取值 ISO 8601 本地时间串秒级，由 ms 上屏戳格式化）。单一真源：序列化（本函数）与跳回第一层
 * 匹配（message-quote-gesture）共用同一份格式化，两侧不可能漂。
 */
export function formatMessageAt(at: number): string {
  const d = new Date(at);
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${p(d.getFullYear())}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/** ISO 8601 本地时间串（秒级）→ ms；不成形 / 越界（如 2 月 30 日）返回 null（调用方按 at 缺处理）。 */
export function parseMessageAt(raw: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(raw.trim());
  if (match === null) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, s);
  // 回读校验：Date 对越界字段会进位（2 月 30 日 → 3 月 2 日），不成形的串一律 null。
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi ||
    date.getSeconds() !== s
  ) {
    return null;
  }
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** XML 文本节点转义：`&` 必须先转，否则后续替换产生的 `&` 会被二次转义。 */
function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** XML 属性值转义：在文本转义之上再处理双引号（属性值用双引号包裹）。 */
function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

/**
 * 投递投影（change harness-composer-image-paste design §4）：混排块序列 → Responses
 * `input` 数组 content parts 的中间形态。`text` part 是已 XML 序列化的文本（可为多行，
 * 即 serializeQuoteMessage 对一段连续文本块的产出）；`image` part 只带 harness 附件名
 * （会话侧记引用形态，发送前由后端展开为 data URL）。
 */
export type DeliveryPart = { kind: "text"; text: string } | { kind: "image"; name: string };

/**
 * 同一块序列的两个投影（design §4.2，REVIEW.md 第 8 条：同一语义 MUST 只有一处产出）：
 * `panelText` 是面板/transcript/快照用的单字符串（图片块落成 `<image …/>` 占位元素），
 * `parts` 是投递给模型的 content parts。两者由**同一个函数**产出，不可能漂。
 */
export interface DeliveryProjection {
  panelText: string;
  parts: DeliveryPart[];
}

/** 图片块在面板文本里的占位元素（快照恢复 / transcript 复制的往返载体）。 */
function imagePlaceholderLine(card: ImageCard): string {
  const dims =
    card.width !== undefined && card.height !== undefined
      ? ` width="${card.width}" height="${card.height}"`
      : "";
  return `<image ref="${escapeXmlAttribute(card.name)}" type="${escapeXmlAttribute(card.sourceMime)}"${dims}/>`;
}

/**
 * 把混排块序列投影为投递 parts + 面板文本（design §4.1）。规则：
 * - 按块序走：连续文本块（quote / msgquote / 段落）累积进当前 text part（各行以 `\n`
 *   连接，行生成规则与旧 serializeQuoteMessage 逐字节一致）；遇到 image 块 flush 当前
 *   text part、推一个 image part。`[段落, 图, 段落]` → `[text, image, text]`，交错顺序逐位保留。
 * - 图片块在面板文本里落一个 `<image ref="…" type="…" width="…" height="…"/>` 占位元素
 *   （属性恒在序：ref / type / width / height；尺寸缺席时 width/height 两个属性一起省略）。
 * - 向后兼容：不含图片块时投影是**单** text part、panelText 与旧 serializeQuoteMessage
 *   逐字节一致（parts[0].text === panelText）。
 * - 任一卡通片的必选字段缺失（quote 的 lines 空 / msgquote 的 role 非法或原文空）→ 抛错，
 *   不产出半截消息（与旧行为一致）。
 */
export function projectDelivery(blocks: readonly ComposerBlock[]): DeliveryProjection {
  const parts: DeliveryPart[] = [];
  const panelLines: string[] = [];
  let textRun: string[] = [];
  const flush = (): void => {
    if (textRun.length === 0) return;
    parts.push({ kind: "text", text: textRun.join("\n") });
    textRun = [];
  };
  /** 文本行：同时进当前 text part 的累积与面板文本（两个投影同一次产出）。 */
  const pushTextLine = (line: string): void => {
    textRun.push(line);
    panelLines.push(line);
  };
  for (const block of blocks) {
    if (block.kind === "image") {
      flush();
      panelLines.push(imagePlaceholderLine(block.card));
      parts.push({ kind: "image", name: block.card.name });
      continue;
    }
    if (block.kind === "quote") {
      const { card } = block;
      if (card.lines.trim() === "") throw new Error(LINES_REQUIRED_MESSAGE);
      pushTextLine(
        `<quote file="${escapeXmlAttribute(card.file)}" heading="${escapeXmlAttribute(card.heading)}"` +
          ` lines="${escapeXmlAttribute(card.lines)}">${escapeXmlText(card.text)}</quote>`,
      );
      continue;
    }
    if (block.kind === "msgquote") {
      const { card } = block;
      if (card.role !== "user" && card.role !== "assistant") throw new Error(MESSAGE_QUOTE_ROLE_MESSAGE);
      if (card.text.trim() === "") throw new Error(MESSAGE_QUOTE_TEXT_MESSAGE);
      const at = card.at === null ? "" : ` at="${escapeXmlAttribute(formatMessageAt(card.at))}"`;
      pushTextLine(
        `<msg-quote role="${escapeXmlAttribute(card.role)}"${at}>${escapeXmlText(card.text)}</msg-quote>`,
      );
      continue;
    }
    if (block.text.trim() !== "") pushTextLine(escapeXmlText(block.text));
  }
  flush();
  return { panelText: panelLines.join("\n"), parts };
}

/** 投递投影的 parts 面（design §4.1 的 `serializeDelivery`）。 */
export function serializeDelivery(blocks: readonly ComposerBlock[]): DeliveryPart[] {
  return projectDelivery(blocks).parts;
}

/**
 * 把混排块序列序列化为面板文本投影（投递给模型的用户消息的 XML 文本面 + 图片占位
 * 元素）。= projectDelivery(blocks).panelText。图片卡片的行规则见 imagePlaceholderLine；
 * 纯文本/卡片消息与历史行为逐字节一致。
 */
export function serializeQuoteMessage(blocks: readonly ComposerBlock[]): string {
  return projectDelivery(blocks).panelText;
}

// ---------------------------------------------------------------------------
// composer 草稿的 (反)序列化（change composer-draft-persistence design §6）
//
// 草稿是**存储形态**，与投递形态（`serializeQuoteMessage` 的面板文本投影）分开：投影是有损的
// （`headingPath` 不序列化、图片缺省宽高丢），块模型才是 composer 的真模型，天然无损 round-trip。
// 本段是「块模型 ⟺ 草稿 JSON」的**唯一实现点**（design §2 的单源纪律，REVIEW.md 第 8 条）：
// Rust 侧只做搬运、不解析内容（`src-tauri/src/harness/draft.rs`）。
// ---------------------------------------------------------------------------

/**
 * 草稿 schema 版本（首版即终态）。版本不符按「没有草稿」处理、不尝试解释——草稿零存量，
 * 不存在旧格式消费者，不写迁移分支（REVIEW.md 第 21 条：先问「消费者是谁」）。
 */
export const DRAFT_VERSION = 1;

/** 草稿里的光标落位（块下标 + 段内 UTF-16 偏移，与 `ComposerCaret` 同口径）。 */
export interface DraftCaret {
  block: number;
  offset: number;
}

/** 草稿文件形状（`serializeComposerDraft` 的产物、`parseComposerDraft` 的输入）。 */
export interface ComposerDraft {
  version: number;
  blocks: ComposerBlock[];
  /** 恢复时把光标放回用户离开时的位置；缺席（旧文件 / 手改）按「光标在末尾」处理。 */
  caret: DraftCaret | null;
}

/**
 * 块序列 → 草稿 JSON（存储形态的唯一产出点）。
 *
 * 内容逐字段照录、不做归一化与改写：块模型是单一真源，序列化只是它的投影。图片卡片存的是
 * **内容寻址引用**（`name` + `sourceMime` + 可选宽高），**MUST NOT 内联 base64**——与会话留存
 * 同口径，附件字节在 `attachments/<vault 稳定 id>/` 里不被 GC，恢复后仍可经读回命令取回。
 */
export function serializeComposerDraft(
  blocks: readonly ComposerBlock[],
  caret: DraftCaret | null,
): string {
  const draft: ComposerDraft = { version: DRAFT_VERSION, blocks: [...blocks], caret };
  return JSON.stringify(draft);
}

/** JSON 值的对象（非数组、非 null）判别。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 有限正数（图片像素尺寸）。 */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 草稿 JSON → 块序列 / 光标。**拿不到合法草稿一律返回 `null`**（空串 / 非 JSON / 版本不符 /
 * `blocks` 非数组 / 任一**已知**块类不成形），调用方据此安静回落到空的单段落输入区——
 * 判据是「是否拿到合法草稿」，不是 `text ?? ""`（REVIEW.md 第 2 条：读不到与为空不是一回事）。
 *
 * **未知块类保守保留**：`kind` 不在已知集合内的块原样返回（未来的块类落地前也不丢内容，
 * 与既有的「解析未知元素 MUST NOT 静默丢文」同口径）。已知块类则逐个校验到「能被 composer
 * 安全编辑」这一档：不成形 = 整份草稿按损坏处理（半份草稿比没有草稿更危险——它会让发送
 * 路径上的投影函数抛错）。
 *
 * 光标：非法 / 缺席 → `null`（调用方按末尾落位）。
 */
export function parseComposerDraft(text: string): ComposerDraft | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (value.version !== DRAFT_VERSION) return null;
  const raw = value.blocks;
  if (!Array.isArray(raw)) return null;
  const blocks: ComposerBlock[] = [];
  for (const item of raw) {
    const block = parseDraftBlock(item);
    if (block === null) return null;
    blocks.push(block);
  }
  return { version: DRAFT_VERSION, blocks, caret: parseDraftCaret(value.caret, blocks.length) };
}

/** 单个块：已知块类逐字段校验（不合法 → `null`）；未知块类原样保留。 */
function parseDraftBlock(item: unknown): ComposerBlock | null {
  if (!isRecord(item) || typeof item.kind !== "string") return null;
  const { card } = item;
  switch (item.kind) {
    case "paragraph":
      return typeof item.text === "string" ? { kind: "paragraph", text: item.text } : null;
    case "quote": {
      const parsed = parseDraftQuoteCard(card);
      return parsed === null ? null : { kind: "quote", card: parsed };
    }
    case "msgquote": {
      const parsed = parseDraftMessageQuoteCard(card);
      return parsed === null ? null : { kind: "msgquote", card: parsed };
    }
    case "image": {
      const parsed = parseDraftImageCard(card);
      return parsed === null ? null : { kind: "image", card: parsed };
    }
    default:
      // 未知块类：内容原样保留（MUST NOT 静默丢弃）。composer 渲染侧给它一个可见的兜底形态
      // （见 `draftUnknownBlockText`）。
      return item as unknown as ComposerBlock;
  }
}

function parseDraftQuoteCard(raw: unknown): QuoteCard | null {
  if (!isRecord(raw)) return null;
  const { file, heading, headingPath, lines, text } = raw;
  if (
    typeof file !== "string" ||
    typeof heading !== "string" ||
    typeof lines !== "string" ||
    typeof text !== "string"
  ) {
    return null;
  }
  // 建卡不变量（createQuoteCard 同判据）：lines 非空才是一张能投递的卡片。
  if (lines.trim() === "") return null;
  // headingPath 是人侧专用字段（hover title），缺席按 heading 回落——不因它丢整份草稿。
  return { file, heading, headingPath: typeof headingPath === "string" ? headingPath : heading, lines, text };
}

function parseDraftMessageQuoteCard(raw: unknown): MessageQuoteCard | null {
  if (!isRecord(raw)) return null;
  const { role, at, text } = raw;
  if (role !== "user" && role !== "assistant") return null;
  if (typeof text !== "string" || text.trim() === "") return null;
  // at 可缺（null）：缺席与显式 null 同义（快照恢复无 ts 的旧消息本就不显示时间）。
  const when = at === undefined || at === null ? null : at;
  if (when !== null && !(typeof when === "number" && Number.isFinite(when))) return null;
  return { role, at: when, text };
}

function parseDraftImageCard(raw: unknown): ImageCard | null {
  if (!isRecord(raw)) return null;
  const { name, sourceMime, width, height } = raw;
  if (typeof name !== "string" || name === "" || typeof sourceMime !== "string") return null;
  const w = positiveNumber(width);
  const h = positiveNumber(height);
  // 尺寸是可选的一对：任一缺席即整对不还原（半对尺寸会让元信息行显示半个数）。
  return w === undefined || h === undefined
    ? { name, sourceMime }
    : { name, sourceMime, width: w, height: h };
}

/** 光标落位：块下标越界 / 偏移非负整数不成立 → `null`（调用方按末尾落位）。 */
function parseDraftCaret(raw: unknown, blockCount: number): DraftCaret | null {
  if (!isRecord(raw)) return null;
  const { block, offset } = raw;
  if (!Number.isInteger(block) || !Number.isInteger(offset)) return null;
  if ((block as number) < 0 || (block as number) >= blockCount || (offset as number) < 0) return null;
  return { block: block as number, offset: offset as number };
}

/**
 * 未知块类的可见兜底文本（composer 渲染侧用）：内容以 JSON 原文落回输入区——**不静默丢弃**，
 * 与 `parseQuoteMessage` 的「不识别即不还原，但 MUST NOT 静默丢文」同一处置（那边落成段落文本，
 * 这边落成 JSON 原文，因为未知块的「内容」不是一段可读文本）。今天没有未知块类，这是防御面：
 * 未来块类由更旧的版本读到时的唯一出口。
 */
export function draftUnknownBlockText(block: ComposerBlock): string {
  try {
    return JSON.stringify(block);
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// 两侧共用的文本原语（M447，change composer-emacs-nav design §5.2 / §5.4）：词边界与字素簇
// 扫描口径、单槽 kill buffer。编辑器侧与 composer 侧共用同一份，MUST NOT 复制第二份。
// ---------------------------------------------------------------------------

/** 词字符（Emacs 词法口径的近似）：Unicode 字母 / 数字 / 下划线。 */
export const WORD_CHAR = /[\p{L}\p{N}_]/u;
export const isWordChar = (ch: string): boolean => WORD_CHAR.test(ch);

/** 文本读取器：从区间取子串——编辑器传 `EditorState.doc` 的切片、composer 传普通字符串的切片。
 *  共用扫描核因此不绑死在某一种文本载体上，两侧只有**一份**实现。 */
export type TextReader = (from: number, to: number) => string;

/** 向前扫描同类码点（码点粒度，避免拆开代理对）；到 limit 或首个异类为止。 */
export function scanRunForward(read: TextReader, pos: number, limit: number, match: (ch: string) => boolean): number {
  let i = pos;
  while (i < limit) {
    for (const ch of read(i, Math.min(limit, i + 256))) {
      if (!match(ch)) return i;
      i += ch.length;
    }
  }
  return Math.min(i, limit);
}

/** 向后扫描同类码点；到 limit 或首个异类为止。 */
export function scanRunBackward(read: TextReader, pos: number, limit: number, match: (ch: string) => boolean): number {
  let i = pos;
  while (i > limit) {
    const chars = [...read(Math.max(limit, i - 256), i)];
    for (let k = chars.length - 1; k >= 0; k--) {
      if (!match(chars[k])) return i;
      i -= chars[k].length;
    }
  }
  return Math.max(i, limit);
}

/** Emacs forward-word：先跳过非词字符，再走到当前词尾。 */
export function wordEndForward(read: TextReader, pos: number, limit: number): number {
  return scanRunForward(read, scanRunForward(read, pos, limit, (ch) => !isWordChar(ch)), limit, isWordChar);
}

/** Emacs backward-word：反向跳过非词字符，再走到词首。 */
export function wordStartBackward(read: TextReader, pos: number, limit: number): number {
  return scanRunBackward(read, scanRunBackward(read, pos, limit, (ch) => !isWordChar(ch)), limit, isWordChar);
}

/** 下一个字素簇；换行符也是合法步长（Emacs C-d 在行尾删掉换行、两行合并）。 */
export function clusterForward(read: TextReader, pos: number, limit: number): number {
  if (pos >= limit) return limit;
  const win = read(pos, Math.min(limit, pos + 64));
  return pos + Math.min(findClusterBreak(win, 0, true), limit - pos);
}

/** 上一个字素簇。 */
export function clusterBackward(read: TextReader, pos: number, limit: number): number {
  if (pos <= limit) return limit;
  const from = Math.max(limit, pos - 64);
  const win = read(from, pos);
  return from + findClusterBreak(win, win.length, false);
}

/** 单槽 kill buffer（kill ring 后续）：连续同向 kill 相接时合并，其余 kill 覆盖。
 *
 *  **模块级单例、跨面共用**（M317 tasks 4.4 的跨 pane 口径 + M447 的跨面口径）：kill ring 在
 *  Emacs 本就是全局的——一个 pane 里 `⌃K` 杀了内容，切到另一个 pane（或 composer）`⌃Y` 应当能
 *  插进去。因此它 MUST NOT 下沉成逐实例状态，也 MUST NOT 在 composer 侧复制第二份
 *（change composer-emacs-nav 的裁决点 4）。
 *
 *  `anchor` 是相接端的**可比标识**（编辑器传字符位置，composer 传 `块:偏移` 串）——两侧的坐标
 *  空间不同，相接判定因此只比这个不透明串，逻辑仍只有一份（`mergeKillText`）。 */
export interface KillSlotState {
  text: string;
  forward: boolean;
  /** 上次 kill 结束后光标所在端的可比标识（下一次 kill 的相接端与它相等即合并）。 */
  anchor: string;
}
let killSlot: KillSlotState | null = null;

/** 当前 kill 槽。 */
export function currentKillSlot(): KillSlotState | null {
  return killSlot;
}

/** 覆写 kill 槽。 */
export function setKillSlot(state: KillSlotState): void {
  killSlot = state;
}

/** 连续同向 kill 的相接合并判定（纯函数，编辑器与 composer 共用同一份）：本次的相接端
 *  `joinAt` 等于上次记录的 `anchor` 且同向时并入，否则覆盖。 */
export function mergeKillText(prev: KillSlotState | null, text: string, forward: boolean, joinAt: string): string {
  if (prev === null || prev.forward !== forward || prev.anchor !== joinAt) return text;
  return forward ? prev.text + text : text + prev.text;
}
