// 混排 composer 纯模型层的单测（M343，change add-harness-quote-cards 任务 2.3 / 2.4 / 2.5
// 与发送链路 1.2 的模型侧不变量）。合同：openspec/changes/add-harness-quote-cards 的
// spec「混排对话输入区」（拆段插入、光标落卡片下一行）与 design §3（序列化协议）。
//
// 这一层是零 DOM 环境（tests/unit/README.md）：只驱动 src/harness-panel.ts 导出的纯函数
// （模型运算 + 序列化消息解析），DOM 渲染 / 光标 / 四 quirk 的接线归真机验收（M344/QC4 场景）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  backspaceAtCaret,
  deleteForwardAtCaret,
  deleteSelectionRange,
  insertCardAtCaret,
  insertPlainTextAtCaret,
  insertSoftBreakAtCaret,
  parseQuoteMessage,
  removeBlockAt,
  unescapeXmlEntities,
} from "../../src/harness-panel.ts";
import { serializeQuoteMessage } from "../../src/quote-card.ts";
import type { ComposerBlock, QuoteCard } from "../../src/quote-card.ts";

const cardA: QuoteCard = {
  file: "reading-workflow.md",
  heading: "筛选",
  headingPath: "阅读工作流 › 筛选",
  lines: "9-10",
  text: "先读结论再读论证",
};
const cardB: QuoteCard = {
  file: "reading-workflow.md",
  heading: "复盘",
  headingPath: "阅读工作流 › 复盘",
  lines: "16-17",
  text: "每周捞出可执行动作",
};
const para = (text: string): ComposerBlock => ({ kind: "paragraph", text });
const quote = (card: QuoteCard): ComposerBlock => ({ kind: "quote", card });

// ── 光标处拆段插入（spec 场景「光标处拆段插入」+ Alex 裁决：光标落卡片下一行） ──

test("insertCardAtCaret：段落中间 → 拆两段、卡片居中、光标落卡片下一行段落段首", () => {
  const { blocks, caret } = insertCardAtCaret([para("这段是什么意思？")], { block: 0, offset: 2 }, cardA);
  assert.deepEqual(blocks, [para("这段"), quote(cardA), para("是什么意思？")]);
  assert.deepEqual(caret, { block: 2, offset: 0 });
});

test("insertCardAtCaret：段落起始 → 卡片在前、原段落承接光标（复用，不新建）", () => {
  const { blocks, caret } = insertCardAtCaret([para("问题一")], { block: 0, offset: 0 }, cardA);
  assert.deepEqual(blocks, [quote(cardA), para("问题一")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertCardAtCaret：段落末尾 → 卡片在后、新建空段落承接光标", () => {
  const { blocks, caret } = insertCardAtCaret([para("问题一")], { block: 0, offset: 4 }, cardA);
  assert.deepEqual(blocks, [para("问题一"), quote(cardA), para("")]);
  assert.deepEqual(caret, { block: 2, offset: 0 });
});

test("insertCardAtCaret：空段落 → 卡片在前、该空段落承接光标", () => {
  const { blocks, caret } = insertCardAtCaret([para("")], { block: 0, offset: 0 }, cardA);
  assert.deepEqual(blocks, [quote(cardA), para("")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

test("insertCardAtCaret：光标在卡片前缘 → 新卡片插在其前、其后补空段落", () => {
  const { blocks, caret } = insertCardAtCaret(
    [para("前"), quote(cardA), para("后")],
    { block: 1, offset: 0 },
    cardB,
  );
  assert.deepEqual(blocks, [para("前"), quote(cardB), para(""), quote(cardA), para("后")]);
  assert.deepEqual(caret, { block: 2, offset: 0 });
});

test("insertCardAtCaret：末尾追加（无块）→ 卡片 + 空段落", () => {
  const { blocks, caret } = insertCardAtCaret([], { block: 0, offset: 0 }, cardA);
  assert.deepEqual(blocks, [quote(cardA), para("")]);
  assert.deepEqual(caret, { block: 1, offset: 0 });
});

// ── 粘贴净化（quirk ①）：纯文本经模型插入，\n 拆段落 ─────────────────────────

test("insertPlainTextAtCaret：单行插入、光标落插入文本末尾", () => {
  const { blocks, caret } = insertPlainTextAtCaret([para("ab")], { block: 0, offset: 1 }, "XY");
  assert.deepEqual(blocks, [para("aXYb")]);
  assert.deepEqual(caret, { block: 0, offset: 3 });
});

test("insertPlainTextAtCaret：多行粘贴 → 拆成多个段落块（quirk ④ 的模型侧）", () => {
  const { blocks, caret } = insertPlainTextAtCaret([para("")], { block: 0, offset: 0 }, "一\n二\n三");
  assert.deepEqual(blocks, [para("一"), para("二"), para("三")]);
  assert.deepEqual(caret, { block: 2, offset: 1 });
});

test("insertPlainTextAtCaret：段落中间多行粘贴 → 首尾与残段正确拼接", () => {
  const { blocks, caret } = insertPlainTextAtCaret([para("abcd")], { block: 0, offset: 2 }, "X\nY");
  assert.deepEqual(blocks, [para("abX"), para("Ycd")]);
  assert.deepEqual(caret, { block: 1, offset: 1 });
});

test("insertPlainTextAtCaret：光标在卡片前缘 → 视该处为空段落", () => {
  const { blocks, caret } = insertPlainTextAtCaret([quote(cardA), para("后")], { block: 0, offset: 0 }, "问");
  assert.deepEqual(blocks, [para("问"), para("后")]);
  assert.deepEqual(caret, { block: 0, offset: 1 });
});

// ── 软换行（⇧Enter）：段内插 \n，不拆块 ─────────────────────────────────────

test("insertSoftBreakAtCaret：段内插软换行、光标前进一格", () => {
  const { blocks, caret } = insertSoftBreakAtCaret([para("ab")], { block: 0, offset: 1 });
  assert.deepEqual(blocks, [para("a\nb")]);
  assert.deepEqual(caret, { block: 0, offset: 2 });
});

test("insertSoftBreakAtCaret：卡片前缘 → 贴前一个段落末尾", () => {
  const { blocks, caret } = insertSoftBreakAtCaret([para("前"), quote(cardA)], { block: 1, offset: 0 });
  assert.deepEqual(blocks, [para("前\n"), quote(cardA)]);
  assert.deepEqual(caret, { block: 0, offset: 2 });
});

// ── 选区删除（跨块安全：区间内卡片整块移除） ────────────────────────────────

test("deleteSelectionRange：同段内删字符", () => {
  const { blocks, caret } = deleteSelectionRange([para("abcdef")], {
    anchor: { block: 0, offset: 2 },
    focus: { block: 0, offset: 4 },
  });
  assert.deepEqual(blocks, [para("abef")]);
  assert.deepEqual(caret, { block: 0, offset: 2 });
});

test("deleteSelectionRange：跨块（含卡片）→ 卡片整块移除、两端截断保留", () => {
  const { blocks, caret } = deleteSelectionRange(
    [para("012345"), quote(cardA), para("abcdef")],
    { anchor: { block: 0, offset: 2 }, focus: { block: 2, offset: 3 } },
  );
  assert.deepEqual(blocks, [para("01"), para("def")]);
  assert.deepEqual(caret, { block: 0, offset: 2 });
});

test("deleteSelectionRange：反向选区（focus 在 anchor 前）按序归一", () => {
  const { blocks, caret } = deleteSelectionRange(
    [para("abcdef")],
    { anchor: { block: 0, offset: 4 }, focus: { block: 0, offset: 1 } },
  );
  // 与正向选区 1–4 等价：删掉 "bcd"，留下 "aef"。
  assert.deepEqual(blocks, [para("aef")]);
  assert.deepEqual(caret, { block: 0, offset: 1 });
});

// ── 退格 / 前删：卡片按整体作用（原子节点语义的模型侧） ──────────────────────

test("backspaceAtCaret：段内删字符（光标随字符退）", () => {
  const result = backspaceAtCaret([para("abc")], { block: 0, offset: 3 });
  assert.deepEqual(result, { blocks: [para("ab")], caret: { block: 0, offset: 2 } });
});

test("backspaceAtCaret：段首遇卡片 → 整块移除（第二次退格才删的「先选中」形态不接受）", () => {
  const result = backspaceAtCaret([quote(cardA), para("问题")], { block: 1, offset: 0 });
  assert.deepEqual(result, { blocks: [para("问题")], caret: { block: 0, offset: 0 } });
});

test("backspaceAtCaret：段首遇段落 → 合并、光标落接缝", () => {
  const result = backspaceAtCaret([para("前"), para("后")], { block: 1, offset: 0 });
  assert.deepEqual(result, { blocks: [para("前后")], caret: { block: 0, offset: 1 } });
});

test("backspaceAtCaret：composer 起点 → null（无物可删）", () => {
  assert.equal(backspaceAtCaret([para("")], { block: 0, offset: 0 }), null);
  assert.equal(backspaceAtCaret([para("a")], { block: 0, offset: 0 }), null);
});

test("deleteForwardAtCaret：段末遇卡片 → 整块移除", () => {
  const result = deleteForwardAtCaret([para("问题"), quote(cardA)], { block: 0, offset: 2 });
  assert.deepEqual(result, { blocks: [para("问题")], caret: { block: 0, offset: 2 } });
});

test("deleteForwardAtCaret：段末遇段落 → 合并", () => {
  const result = deleteForwardAtCaret([para("前"), para("后")], { block: 0, offset: 1 });
  assert.deepEqual(result, { blocks: [para("前后")], caret: { block: 0, offset: 1 } });
});

// ── 卡片移除（× 钮）：光标落被删块的前一个文本块末尾 ─────────────────────────

test("removeBlockAt：移除中间卡片、光标贴前段末尾", () => {
  const { blocks, caret } = removeBlockAt([para("前"), quote(cardA), para("后")], 1);
  assert.deepEqual(blocks, [para("前"), para("后")]);
  assert.deepEqual(caret, { block: 0, offset: 1 });
});

test("removeBlockAt：移除唯一块 → 落回一个空段落", () => {
  const { blocks, caret } = removeBlockAt([quote(cardA)], 0);
  assert.deepEqual(blocks, [para("")]);
  assert.deepEqual(caret, { block: 0, offset: 0 });
});

// ── 序列化消息的解析（transcript 快照恢复同构呈现的逆运算） ──────────────────

test("unescapeXmlEntities：链式转义按单次扫描正确收敛", () => {
  // 用户原文 "&lt;" 的序列化形态是 "&amp;lt;"——解码必须还原成 "&lt;" 而不是 "<"。
  assert.equal(unescapeXmlEntities("&amp;lt;"), "&lt;");
  assert.equal(unescapeXmlEntities("&lt;quote&gt;"), "<quote>");
  assert.equal(unescapeXmlEntities("&quot;&amp;&quot;"), `"&"`);
  // 未知实体原样保留（宽容，不吞字符）。
  assert.equal(unescapeXmlEntities("&nbsp;"), "&nbsp;");
});

test("parseQuoteMessage：与 serializeQuoteMessage 互逆（含转义与多行摘录）", () => {
  const source = [
    quote({ ...cardA, heading: '筛 & 选', text: "第一行\n第二行 <带标签>" }),
    para("这段是什么意思？"),
    quote(cardB),
    para("这里的「可执行动作」指什么？"),
  ];
  const text = serializeQuoteMessage(source);
  const parsed = parseQuoteMessage(text);
  // 协议四字段逐字节还原；headingPath 不在协议里（人侧专用），恢复值退化为 heading。
  assert.equal(parsed.length, 4);
  const first = parsed[0];
  assert.equal(first.kind, "quote");
  if (first.kind === "quote") {
    assert.equal(first.card.file, "reading-workflow.md");
    assert.equal(first.card.heading, "筛 & 选");
    assert.equal(first.card.lines, "9-10");
    assert.equal(first.card.text, "第一行\n第二行 <带标签>");
  }
  assert.deepEqual(parsed[1], para("这段是什么意思？"));
  const third = parsed[2];
  assert.equal(third.kind, "quote");
  if (third.kind === "quote") {
    // 协议四字段（file/heading/lines/text）逐字节还原；headingPath 不进协议，
    // 恢复值按设计退化为 heading（hover 的完整标题链只在当次会话的 composer 里）。
    assert.equal(third.card.file, cardB.file);
    assert.equal(third.card.heading, cardB.heading);
    assert.equal(third.card.lines, cardB.lines);
    assert.equal(third.card.text, cardB.text);
    assert.equal(third.card.headingPath, cardB.heading);
  }
  assert.deepEqual(parsed[3], para("这里的「可执行动作」指什么？"));
  // 往返稳定：再序列化一次逐字节不变。
  assert.equal(serializeQuoteMessage(parsed), text);
});

test("parseQuoteMessage：多行摘录（卡片原文含换行）正确聚合到闭合标签", () => {
  const text = [
    '<quote file="a.md" heading="" lines="1-3">一行',
    "二行",
    "三行</quote>",
    "问题",
  ].join("\n");
  const parsed = parseQuoteMessage(text);
  assert.equal(parsed.length, 2);
  const first = parsed[0];
  assert.equal(first.kind, "quote");
  if (first.kind === "quote") {
    assert.equal(first.card.heading, "");
    assert.equal(first.card.text, "一行\n二行\n三行");
  }
  assert.deepEqual(parsed[1], para("问题"));
});

test("parseQuoteMessage：不成形的引用行按段落宽容落地（不抛错、不吞内容）", () => {
  const original = '前文\n<quote file="a.md" heading="" lines="1">未闭合\n后文';
  const parsed = parseQuoteMessage(original);
  // 不抛错、内容守恒（逐块都是段落，拼回原文逐字节不变）；切分形状不做承诺（防御路径）。
  assert.equal(parsed.every((b) => b.kind === "paragraph"), true);
  assert.equal(
    parsed.map((b) => (b.kind === "paragraph" ? b.text : "")).join("\n"),
    original,
  );
});
