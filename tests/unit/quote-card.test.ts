// 摘录引用卡片序列化的单测（change add-harness-quote-cards / M342 任务 1.1 / 1.3）。
//
// 合同：openspec/changes/add-harness-quote-cards/design.md §3 的「不变量」一节——
//   ① 卡片阅读顺序 = 序列化顺序（问题文字按交错顺序落在标签之间）；
//   ② 属性值与文本节点 XML 转义，round-trip 可还原；
//   ③ lines 非空才产出卡片（walker 对空 lines 报错）；
//   ④ heading 与卡片数据一致，headingPath 不进序列化；
//   ⑤ **协议零编号**——不含 index 或任何序号属性（一致性原则，Alex 2026-10-06）。
//
// 这里自己实现一个最小 XML 解析器（parseMessage）而不是复用被测的转义函数：round-trip 若
// 用同一个 escape 去 unescape 就是自证，判不出转义缺失（REVIEW.md 第 1 条：断言必须有区分度）。
// 属性集合断言（恰为 file/heading/lines 三个键）是「零编号」的主判据——比 `!includes("index")`
// 强：任何多出来的序号 / id 属性都会红，不依赖属性名恰好叫 index。
//
// 覆盖方式：golden 逐字节 + 定制用例 + 属性测试（确定性 PRNG 扫块序列形状，同 tree-rename 口径）。
// 生成器约束：问题段落不含换行（`.qpara` 是单段，含换行会被解析器按行拆成两段，属 fixture 前提）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINES_REQUIRED_MESSAGE,
  createQuoteCard,
  serializeQuoteMessage,
  type ComposerBlock,
  type QuoteCard,
} from "../../src/quote-card.ts";

// --- 最小 XML 解析（独立于被测算法的反向实现） -------------------------------------------------

const QUOTE_RE = /<quote(\s[^>]*)?>([\s\S]*?)<\/quote>/g;
const ATTR_RE = /\s([A-Za-z][\w-]*)="([^"]*)"/g;
const ENTITY_RE = /&(amp|lt|gt|quot|apos);/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(ENTITY_RE, (_match, name: string) => ENTITIES[name]);
}

interface ParsedQuote {
  kind: "quote";
  file: string;
  heading: string;
  lines: string;
  text: string;
  attrNames: string[];
}

type ParsedBlock = ParsedQuote | { kind: "paragraph"; text: string };

/** 解析序列化产物：`<quote>` 元素与元素之外的文本行。文本里的 `<` 已转义，故不会与标签混淆。 */
function parseMessage(xml: string): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const flushText = (segment: string): void => {
    for (const line of segment.split("\n")) {
      if (line.trim() !== "") out.push({ kind: "paragraph", text: decodeXml(line) });
    }
  };
  let cursor = 0;
  for (const match of xml.matchAll(QUOTE_RE)) {
    const at = match.index ?? 0;
    flushText(xml.slice(cursor, at));
    const attrs = new Map<string, string>();
    for (const attr of (match[1] ?? "").matchAll(ATTR_RE)) attrs.set(attr[1], decodeXml(attr[2]));
    out.push({
      kind: "quote",
      file: attrs.get("file") ?? "",
      heading: attrs.get("heading") ?? "",
      lines: attrs.get("lines") ?? "",
      text: decodeXml(match[2]),
      attrNames: [...attrs.keys()].sort(),
    });
    cursor = at + match[0].length;
  }
  flushText(xml.slice(cursor));
  return out;
}

/** 与生成器输入可比的投影（丢掉解析器的辅助字段 attrNames）。 */
function comparable(blocks: readonly ParsedBlock[]): unknown[] {
  return blocks.map((block) =>
    block.kind === "paragraph"
      ? { kind: "paragraph", text: block.text }
      : { kind: "quote", file: block.file, heading: block.heading, lines: block.lines, text: block.text },
  );
}

/** 捕获抛出的错误：本地 node:assert 声明不含「对象形态的 throws」，故显式 try/catch 取 message。 */
function caught(fn: () => unknown): Error {
  let error: unknown = null;
  try {
    fn();
  } catch (thrown) {
    error = thrown;
  }
  assert.ok(error instanceof Error, "预期抛错但没有抛出");
  return error as Error;
}

function cardOf(overrides: Partial<QuoteCard> = {}): QuoteCard {
  return createQuoteCard({
    file: "reading-workflow.md",
    heading: "筛选",
    headingPath: "阅读工作流 › 筛选",
    lines: "9-10",
    text: "先读结论再读论证",
    ...overrides,
  });
}

// --- golden：交错顺序与逐字节形态 -----------------------------------------------------------------

test("golden：两卡两问交错，每段摘录一行、问题落在标签之间", () => {
  const xml = serializeQuoteMessage([
    { kind: "quote", card: cardOf({ lines: "9-10", text: "先读结论再读论证" }) },
    { kind: "paragraph", text: "这段内容是什么意思？" },
    { kind: "quote", card: cardOf({ heading: "复盘", headingPath: "阅读工作流 › 复盘", lines: "16-17", text: "每周过一遍可执行动作" }) },
    { kind: "paragraph", text: "这里的「可执行动作」指什么？" },
  ]);
  // 逐字节相等：同时钉住属性顺序（file → heading → lines）、无编号、交错顺序
  assert.equal(
    xml,
    [
      '<quote file="reading-workflow.md" heading="筛选" lines="9-10">先读结论再读论证</quote>',
      "这段内容是什么意思？",
      '<quote file="reading-workflow.md" heading="复盘" lines="16-17">每周过一遍可执行动作</quote>',
      "这里的「可执行动作」指什么？",
    ].join("\n"),
  );
  assert.ok(!xml.includes("index"), "协议不含 index");
});

test("空 heading（摘录在首个标题之前）仍产出三个属性，heading=\"\"", () => {
  const xml = serializeQuoteMessage([{ kind: "quote", card: cardOf({ heading: "", headingPath: "", lines: "1-1", text: "无标题区原文" }) }]);
  assert.equal(xml, '<quote file="reading-workflow.md" heading="" lines="1-1">无标题区原文</quote>');
});

test("空序列与空白段落 → 空串（不投递空消息、不留空行）", () => {
  assert.equal(serializeQuoteMessage([]), "");
  assert.equal(serializeQuoteMessage([{ kind: "paragraph", text: "" }]), "");
  assert.equal(serializeQuoteMessage([{ kind: "paragraph", text: "   \t" }]), "");
  assert.equal(
    serializeQuoteMessage([
      { kind: "paragraph", text: "" },
      { kind: "quote", card: cardOf({ lines: "2-2", text: "原文" }) },
      { kind: "paragraph", text: "  " },
      { kind: "paragraph", text: "问题" },
    ]),
    ['<quote file="reading-workflow.md" heading="筛选" lines="2-2">原文</quote>', "问题"].join("\n"),
  );
});

// --- 转义 round-trip -----------------------------------------------------------------------------

test("转义 round-trip：属性值与摘录原文里的 & < > \" ' 往返还原", () => {
  const card = cardOf({
    file: 'a<b>&"c".md',
    heading: "结论 & 论证 <下>",
    headingPath: '链“x” › "y"',
    lines: "3-4",
    text: '<quote file="fake">这不是标签</quote> & 还含 "引号" 与 \'单引号\'',
  });
  const xml = serializeQuoteMessage([{ kind: "quote", card }]);
  // 反向：原始尖括号不得裸露进输出（否则内容会破坏 XML 结构）
  assert.ok(!xml.includes("<b>"), "属性值里的 < 必须转义");
  assert.ok(!xml.includes(">这不是标签</quote> &"), "文本里的尖括号与 & 必须转义");
  const parsed = parseMessage(xml);
  assert.equal(parsed.length, 1, "内容里的伪标签不得被解析成引用块");
  assert.deepEqual(comparable(parsed), [
    { kind: "quote", file: card.file, heading: card.heading, lines: card.lines, text: card.text },
  ]);
});

test("反向：问题文字里的伪标签被转义，解析时不被当成引用块", () => {
  const question = '<quote file="x.md" lines="1-2">假</quote>';
  const parsed = parseMessage(serializeQuoteMessage([{ kind: "paragraph", text: question }]));
  assert.deepEqual(parsed, [{ kind: "paragraph", text: question }]);
});

test("跨行摘录原文原样保留（只转义，不压行）——round-trip 优先", () => {
  const card = cardOf({ lines: "5-6", text: "第一行\n第二行" });
  const xml = serializeQuoteMessage([{ kind: "quote", card }]);
  assert.equal(xml, '<quote file="reading-workflow.md" heading="筛选" lines="5-6">第一行\n第二行</quote>');
  assert.deepEqual(comparable(parseMessage(xml))[0], {
    kind: "quote",
    file: card.file,
    heading: card.heading,
    lines: card.lines,
    text: card.text,
  });
});

// --- 零编号 / heading 一致 / 空 lines -----------------------------------------------------------

test("零编号：任何一段摘录的属性集合恰为 file / heading / lines", () => {
  const xml = serializeQuoteMessage([
    { kind: "quote", card: cardOf({ lines: "1-2" }) },
    { kind: "paragraph", text: "问题" },
    { kind: "quote", card: cardOf({ lines: "7-8", heading: "" }) },
  ]);
  for (const block of parseMessage(xml)) {
    if (block.kind === "quote") assert.deepEqual(block.attrNames, ["file", "heading", "lines"]);
  }
  assert.ok(!/\bidx=|\bindex=|\bid=|\bn=/.test(xml), "不得出现任何序号属性");
});

test("heading 与卡片数据一致；headingPath 不进序列化", () => {
  const card = cardOf({ heading: "最近标题", headingPath: "顶层 › 中层 › 最近标题" });
  const xml = serializeQuoteMessage([{ kind: "quote", card }]);
  const parsed = parseMessage(xml);
  assert.equal((parsed[0] as ParsedQuote).heading, card.heading);
  assert.ok(!xml.includes("顶层"), "完整标题链只进人侧 hover title");
});

test("空 lines：工厂与 walker 都抛错（取不到行范围不得生成卡片）", () => {
  const raw = { file: "a.md", heading: "h", headingPath: "h", lines: "", text: "原文" };
  assert.throws(() => createQuoteCard(raw), /lines 不能为空/);
  for (const lines of ["", " ", "\t\n"]) {
    assert.throws(() => createQuoteCard({ ...raw, lines }), /lines 不能为空/, `lines=${JSON.stringify(lines)}`);
  }
  const card = { ...raw };
  // 精确文案（用被测常量钉住）+ 独立子串判据（不依赖该常量，避免「拿实现的常量验实现」）
  assert.equal(caught(() => serializeQuoteMessage([{ kind: "quote", card }])).message, LINES_REQUIRED_MESSAGE);
  assert.throws(() => serializeQuoteMessage([{ kind: "quote", card }]), /lines 不能为空/);
  // 位置在序列中间同样抛错，不产出半截消息
  assert.equal(
    caught(() => serializeQuoteMessage([{ kind: "paragraph", text: "问题" }, { kind: "quote", card }])).message,
    LINES_REQUIRED_MESSAGE,
  );
});

test("createQuoteCard 原样保存字段（不改写摘录原文与行范围）", () => {
  const card = createQuoteCard({
    file: "  spaced.md  ",
    heading: " 保留空格 ",
    headingPath: "链",
    lines: " 3-4 ",
    text: "  原文  ",
  });
  assert.deepEqual(card, {
    file: "  spaced.md  ",
    heading: " 保留空格 ",
    headingPath: "链",
    lines: " 3-4 ",
    text: "  原文  ",
  });
});

// --- 属性测试：块序列形状 × 特殊字符 ---------------------------------------------------------------

/** 确定性 PRNG（同 tree-rename 口径：同一次失败的形状可复现，不用随机源）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILE_POOL = [
  "reading-workflow.md",
  "注意 & 备忘.md",
  'quoted"name".md',
  "nested/指南 & <索引>.md",
  "ünïcode-手记.md",
];
const HEADING_POOL = ["筛选", "复盘", "", '结论 & "论证"', "<下标题>", "每周回顾"];
const HEADING_PATH_POOL = ["阅读工作流 › 筛选 › 倒序阅读", "手记 › 结论", "顶层 ▸ 中层 ▸ 底层"];
const EXCERPT_POOL = [
  "先读结论再读论证",
  '含 "双引号" 与 & 和 <tag>',
  "第一行\n第二行（跨行摘录）",
  "末尾带尖括号 < 与 > 的原文",
  "emoji 🙂 与 “弯引号”",
];
const QUESTION_POOL = [
  "这段内容是什么意思？",
  '这里的 "可执行动作" 指什么？',
  "含 & 与 < 的问题",
  "为什么要按这个顺序读？",
];

function pick<T>(rnd: () => number, pool: readonly T[]): T {
  return pool[Math.floor(rnd() * pool.length)] as T;
}

function generateBlocks(seed: number): ComposerBlock[] {
  const rnd = mulberry32(seed);
  const count = Math.floor(rnd() * 6);
  const blocks: ComposerBlock[] = [];
  for (let i = 0; i < count; i += 1) {
    if (rnd() < 0.5) {
      const start = 1 + Math.floor(rnd() * 60);
      const end = start + Math.floor(rnd() * 8);
      blocks.push({
        kind: "quote",
        card: createQuoteCard({
          file: pick(rnd, FILE_POOL),
          heading: pick(rnd, HEADING_POOL),
          headingPath: pick(rnd, HEADING_PATH_POOL),
          lines: `${start}-${end}`,
          text: pick(rnd, EXCERPT_POOL),
        }),
      });
    } else {
      blocks.push({ kind: "paragraph", text: pick(rnd, QUESTION_POOL) });
    }
  }
  return blocks;
}

test("属性：任意块序列 —— 转义 round-trip / 交错顺序保持 / 三属性零编号 / headingPath 不外泄", () => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const blocks = generateBlocks(seed);
    const xml = serializeQuoteMessage(blocks);

    // 期望投影：卡片原样，空白段落不产出（生成器不产空段落，此处仅做一般化过滤）
    const expected = blocks
      .filter((block) => (block.kind === "quote" ? true : block.text.trim() !== ""))
      .map((block) =>
        block.kind === "paragraph"
          ? { kind: "paragraph", text: block.text }
          : { kind: "quote", file: block.card.file, heading: block.card.heading, lines: block.card.lines, text: block.card.text },
      );
    const parsed = parseMessage(xml);
    assert.deepEqual(comparable(parsed), expected, `seed ${seed}：round-trip 与交错顺序`);

    for (const block of parsed) {
      if (block.kind === "quote") {
        assert.deepEqual(block.attrNames, ["file", "heading", "lines"], `seed ${seed}：属性集合（零编号）`);
        assert.ok(block.lines.trim() !== "", `seed ${seed}：lines 非空`);
      }
    }
    for (const block of blocks) {
      if (block.kind === "quote" && block.card.headingPath !== "") {
        assert.ok(!xml.includes(block.card.headingPath), `seed ${seed}：headingPath 不进序列化`);
      }
    }
  }
});

test("属性：把任一段的 lines 置空 —— 序列化恒抛错（不留半截消息）", () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const blocks = generateBlocks(seed);
    const index = blocks.findIndex((block) => block.kind === "quote");
    if (index < 0) continue;
    const tweaked: ComposerBlock[] = blocks.map((block, i) =>
      i === index && block.kind === "quote" ? { kind: "quote", card: { ...block.card, lines: "  " } } : block,
    );
    assert.throws(
      () => serializeQuoteMessage(tweaked),
      /lines 不能为空/,
      `seed ${seed}：第 ${index} 段空 lines 必须抛错`,
    );
  }
});
