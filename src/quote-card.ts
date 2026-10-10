// 摘录引用卡片的数据模型与引用消息序列化（change add-harness-quote-cards / M342；
// 消息摘录卡片扩展见 change harness-message-excerpt design §3–§4）。
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
// 本模块是纯数据 + 纯函数（无 DOM、无 CodeMirror、无文案），消费者（composer 混排编辑区、
// 消息装配、transcript 沉淀）在后续 mission 接线。

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
 * 混排对话输入区的一个块：引用卡片、消息摘录卡片或问题段落，可任意交错。
 * 序列化顺序即数组顺序（卡片阅读顺序 = 序列化顺序），顶层只有这三类块。
 */
export type ComposerBlock =
  | { readonly kind: "quote"; readonly card: QuoteCard }
  | { readonly kind: "msgquote"; readonly card: MessageQuoteCard }
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
 * 把混排块序列序列化为投递给模型的用户消息（XML）。
 *
 * - 引用卡片 → 一行 `<quote file="…" heading="…" lines="A-B">摘录原文</quote>`；三个属性恒在，
 *   heading 为空（摘录在首个标题之前）时产出 `heading=""`，属性集合保持稳定。
 * - 消息摘录卡片 → `<msg-quote role="…" at="…">摘录原文</msg-quote>`；`role` 必选且合法，
 *   `at` 可缺（来源消息上屏戳不可考时产出 role-only 元素，ISO 8601 本地时间串秒级）。
 * - 问题段落 → 一行文本节点，按交错顺序落在标签之间；**空（纯空白）段落不产出**，
 *   序列化里不留空行（不产出内容 ≠ 把空段落投出去）。
 * - 摘录原文与问题文字都按文本节点转义（问题文字也可能含 `<`，不转义会破坏 XML 结构）。
 *   摘录原文里的换行原样保留——转义只处理 XML 保留字符，「round-trip 可还原」优先于「压成一行」；
 *   选区是否跨行、要不要压平，是创建手势在捕获时的决定，不在这一层擅自改写原文。
 * - **协议零编号**：两类卡片的属性集合都是固定的语义键，不带 index 或任何序号（一致性原则）。
 * - 任一卡片的必选字段缺失（quote 的 lines 空 / msgquote 的 role 非法或原文空）→ 抛错，不产出半截消息。
 */
export function serializeQuoteMessage(blocks: readonly ComposerBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.kind === "quote") {
      const { card } = block;
      if (card.lines.trim() === "") throw new Error(LINES_REQUIRED_MESSAGE);
      lines.push(
        `<quote file="${escapeXmlAttribute(card.file)}" heading="${escapeXmlAttribute(card.heading)}"` +
          ` lines="${escapeXmlAttribute(card.lines)}">${escapeXmlText(card.text)}</quote>`,
      );
    } else if (block.kind === "msgquote") {
      const { card } = block;
      if (card.role !== "user" && card.role !== "assistant") throw new Error(MESSAGE_QUOTE_ROLE_MESSAGE);
      if (card.text.trim() === "") throw new Error(MESSAGE_QUOTE_TEXT_MESSAGE);
      const at = card.at === null ? "" : ` at="${escapeXmlAttribute(formatMessageAt(card.at))}"`;
      lines.push(
        `<msg-quote role="${escapeXmlAttribute(card.role)}"${at}>${escapeXmlText(card.text)}</msg-quote>`,
      );
    } else if (block.text.trim() !== "") {
      lines.push(escapeXmlText(block.text));
    }
  }
  return lines.join("\n");
}
