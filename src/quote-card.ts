// 摘录引用卡片的数据模型与引用消息序列化（change add-harness-quote-cards / M342）。
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
 * 混排对话输入区的一个块：引用卡片或问题段落，二者可任意交错。
 * 序列化顺序即数组顺序（卡片阅读顺序 = 序列化顺序），顶层只有这两类块。
 */
export type ComposerBlock =
  | { readonly kind: "quote"; readonly card: QuoteCard }
  | { readonly kind: "paragraph"; readonly text: string };

/** `lines` 缺失时的错误文案：这是调用方的责任（取不到行范围就不得生成卡片），不是可降级的态。
 *  开发者向的抛出信息，不进 UI（i18n 取值门禁的 log 类豁免）。 */
export const LINES_REQUIRED_MESSAGE =
  "quote-card: lines 不能为空——取不到行范围时调用方不得生成卡片（design.md §3）"; // i18n-exempt: log

/**
 * 组装一张卡片。唯一的校验是 lines 非空：取不到行范围时**调用方不得生成卡片**，
 * 因此这里直接抛错而不是产出退化卡片（退化卡片会静默地把无出处的摘录投给模型）。
 * 其余字段原样保存，不做归一化——摘录原文与标题链是展示/回指的依据，改写它们即失真。
 */
export function createQuoteCard(input: QuoteCard): QuoteCard {
  if (input.lines.trim() === "") throw new Error(LINES_REQUIRED_MESSAGE);
  return { ...input };
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
 * - 问题段落 → 一行文本节点，按交错顺序落在标签之间；**空（纯空白）段落不产出**，
 *   序列化里不留空行（不产出内容 ≠ 把空段落投出去）。
 * - 摘录原文与问题文字都按文本节点转义（问题文字也可能含 `<`，不转义会破坏 XML 结构）。
 *   摘录原文里的换行原样保留——转义只处理 XML 保留字符，「round-trip 可还原」优先于「压成一行」；
 *   选区是否跨行、要不要压平，是创建手势在捕获时的决定，不在这一层擅自改写原文。
 * - 任一张卡片的 lines 为空 → 抛错，不产出半截消息。
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
    } else if (block.text.trim() !== "") {
      lines.push(escapeXmlText(block.text));
    }
  }
  return lines.join("\n");
}
