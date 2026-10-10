// 消息摘录卡片序列化的单测（change harness-message-excerpt tasks 1.1–1.4）。
//
// 合同：design.md §3–§4 的「数据模型」与「序列化协议」——
//   ① 消息摘录 → 一行 `<msg-quote role="…" at="…">摘录原文</msg-quote>`；问题文字按交错顺序
//      落在标签之间（与 `<quote>` 同规则）；
//   ② role 必选且仅 user / assistant；at 可缺（不可考时产出 role-only 元素）；
//   ③ 属性值与文本节点 XML 转义，round-trip 可还原；
//   ④ **协议零编号**——属性集合恰为 {role} 或 {role, at}（一致性原则）。
//
// 判据纪律（REVIEW.md 第 1 条）：这里自己实现一个最小 XML 解析器（不复用被测的 escape），
// 属性集合断言比 `!includes("index")` 强——任何多出来的序号 / id 属性都会红。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_QUOTE_ROLE_MESSAGE,
  MESSAGE_QUOTE_TEXT_MESSAGE,
  createMessageQuoteCard,
  formatMessageAt,
  parseMessageAt,
  serializeQuoteMessage,
  type ComposerBlock,
  type MessageQuoteCard,
} from "../../src/quote-card.ts";
import { parseQuoteMessage } from "../../src/harness-panel.ts";

// --- 最小 XML 解析（独立于被测算法的反向实现） -------------------------------------------------

const ELEMENT_RE = /<(quote|msg-quote)((?:\s[A-Za-z][\w-]*="[^"]*")*)>([\s\S]*?)<\/\1>/g;
const ATTR_RE = /\s([A-Za-z][\w-]*)="([^"]*)"/g;
const ENTITY_RE = /&(amp|lt|gt|quot|apos);/g;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(ENTITY_RE, (_m, name: string) => ENTITIES[name]);
}

interface ParsedElement {
  kind: "quote" | "msgquote";
  attrs: Record<string, string>;
  attrNames: string[];
  text: string;
}

type ParsedBlock = ParsedElement | { kind: "paragraph"; text: string };

function parseMessage(xml: string): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  const flushText = (segment: string): void => {
    for (const line of segment.split("\n")) {
      if (line.trim() !== "") out.push({ kind: "paragraph", text: decodeXml(line) });
    }
  };
  let cursor = 0;
  for (const match of xml.matchAll(ELEMENT_RE)) {
    const at = match.index ?? 0;
    flushText(xml.slice(cursor, at));
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? "").matchAll(ATTR_RE)) attrs[attr[1]] = decodeXml(attr[2]);
    out.push({
      kind: match[1] === "quote" ? "quote" : "msgquote",
      attrs,
      attrNames: Object.keys(attrs).sort(),
      text: decodeXml(match[3]),
    });
    cursor = at + match[0].length;
  }
  flushText(xml.slice(cursor));
  return out;
}

function msg(overrides: Partial<MessageQuoteCard> = {}): MessageQuoteCard {
  return createMessageQuoteCard({ role: "assistant", at: null, text: "先读结论再读论证", ...overrides });
}

/** 捕获抛出的错误（本地 node:assert 声明不含对象形态 throws）。 */
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

const AT_MS = new Date(2026, 9, 10, 21, 40, 33).getTime();

// --- at 格式化 / 解析 ----------------------------------------------------------------------------

test("formatMessageAt：ms → ISO 8601 本地时间串（秒级，无毫秒无时区后缀）", () => {
  assert.equal(formatMessageAt(AT_MS), "2026-10-10T21:40:33");
  // 补零：月 / 日 / 时 / 分 / 秒都两位。
  assert.equal(formatMessageAt(new Date(2026, 0, 2, 3, 4, 5).getTime()), "2026-01-02T03:04:05");
});

test("parseMessageAt：成形的 ISO 本地串 ↔ ms 互逆；不成形 / 越界 → null", () => {
  assert.equal(parseMessageAt("2026-10-10T21:40:33"), AT_MS);
  // 反向验证：越界 / 不成形的串一律 null（不许 Date 的进位把 2 月 30 日静默搬成 3 月）。
  assert.equal(parseMessageAt("2026-02-30T00:00:00"), null);
  assert.equal(parseMessageAt("2026-13-01T00:00:00"), null);
  assert.equal(parseMessageAt("2026-10-10"), null);
  assert.equal(parseMessageAt("not-a-date"), null);
  assert.equal(parseMessageAt(""), null);
});

// --- golden：交错顺序与逐字节形态 -----------------------------------------------------------------

test("golden：消息摘录与问题交错，带 at 时属性顺序 role → at", () => {
  const xml = serializeQuoteMessage([
    { kind: "msgquote", card: msg({ role: "assistant", at: AT_MS, text: "先读结论再读论证" }) },
    { kind: "paragraph", text: "这里说的「筛选成本」具体指什么？" },
    { kind: "msgquote", card: msg({ role: "user", at: null, text: "我的问题是这个" }) },
  ]);
  assert.equal(
    xml,
    [
      '<msg-quote role="assistant" at="2026-10-10T21:40:33">先读结论再读论证</msg-quote>',
      "这里说的「筛选成本」具体指什么？",
      '<msg-quote role="user">我的问题是这个</msg-quote>',
    ].join("\n"),
  );
});

test("at 缺省（null）产出 role-only 元素；有 at 产出秒级 ISO 本地串", () => {
  assert.equal(serializeQuoteMessage([{ kind: "msgquote", card: msg({ role: "user", at: null }) }]), '<msg-quote role="user">先读结论再读论证</msg-quote>');
  assert.equal(
    serializeQuoteMessage([{ kind: "msgquote", card: msg({ role: "assistant", at: AT_MS }) }]),
    '<msg-quote role="assistant" at="2026-10-10T21:40:33">先读结论再读论证</msg-quote>',
  );
});

// --- 转义 round-trip -----------------------------------------------------------------------------

test("转义 round-trip：摘录原文里的 & < > \" ' 往返还原，伪标签不被解析成元素", () => {
  const card = msg({ text: '<msg-quote role="fake">不是标签</msg-quote> & 含 "引号" 与 \'单引号\'' });
  const xml = serializeQuoteMessage([{ kind: "msgquote", card }]);
  assert.ok(!xml.includes(">不是标签</msg-quote>"), "文本里的尖括号必须转义");
  const parsed = parseMessage(xml);
  assert.equal(parsed.length, 1, "内容里的伪标签不得被解析成元素");
  assert.deepEqual(parsed[0], {
    kind: "msgquote",
    attrs: { role: "assistant" },
    attrNames: ["role"],
    text: card.text,
  });
});

test("跨行摘录原文原样保留（只转义，不压行）", () => {
  const card = msg({ text: "第一行\n第二行" });
  const xml = serializeQuoteMessage([{ kind: "msgquote", card }]);
  assert.equal(xml, '<msg-quote role="assistant">第一行\n第二行</msg-quote>');
});

// --- 零编号 / role 合法性 / 原文非空 -------------------------------------------------------------

test("零编号：属性集合恰为 {role} 或 {role, at}", () => {
  const xml = serializeQuoteMessage([
    { kind: "msgquote", card: msg({ role: "assistant", at: AT_MS }) },
    { kind: "msgquote", card: msg({ role: "user", at: null }) },
  ]);
  const parsed = parseMessage(xml);
  assert.deepEqual((parsed[0] as ParsedElement).attrNames, ["at", "role"]);
  assert.deepEqual((parsed[1] as ParsedElement).attrNames, ["role"]);
  assert.ok(!/\bidx=|\bindex=|\bid=|\bn=/.test(xml), "不得出现任何序号属性");
});

test("createMessageQuoteCard：role 非法 / 原文为空 → 抛错（调用方不得产出卡片）", () => {
  assert.throws(() => createMessageQuoteCard({ role: "system" as never, at: null, text: "x" }), /role 必须是 user/);
  for (const text of ["", "   ", "\t\n"]) {
    assert.throws(() => createMessageQuoteCard({ role: "user", at: null, text }), /摘录原文不能为空/);
  }
});

test("serialize walker：role 非法 / 原文为空同样抛错，不产出半截消息", () => {
  const badRole = { kind: "msgquote", card: { role: "system", at: null, text: "x" } } as unknown as ComposerBlock;
  assert.equal(caught(() => serializeQuoteMessage([badRole])).message, MESSAGE_QUOTE_ROLE_MESSAGE);
  const emptyText = { kind: "msgquote", card: { role: "user", at: null, text: "  " } } as unknown as ComposerBlock;
  assert.equal(caught(() => serializeQuoteMessage([emptyText])).message, MESSAGE_QUOTE_TEXT_MESSAGE);
});

// --- parseQuoteMessage：消息摘录还原 + 未知元素保守 ------------------------------------------------

test("parseQuoteMessage：msgquote 与 quote 交错还原，at 可缺（缺 → null）", () => {
  const blocks: ComposerBlock[] = [
    { kind: "quote", card: { file: "a.md", heading: "h", headingPath: "h", lines: "1-2", text: "文档摘录" } },
    { kind: "paragraph", text: "问一" },
    { kind: "msgquote", card: msg({ role: "assistant", at: AT_MS, text: "消息摘录" }) },
    { kind: "paragraph", text: "问二" },
    { kind: "msgquote", card: msg({ role: "user", at: null, text: "无戳摘录" }) },
  ];
  const parsed = parseQuoteMessage(serializeQuoteMessage(blocks));
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].kind, "quote");
  assert.deepEqual(parsed[2], { kind: "msgquote", card: { role: "assistant", at: AT_MS, text: "消息摘录" } });
  assert.deepEqual(parsed[4], { kind: "msgquote", card: { role: "user", at: null, text: "无戳摘录" } });
  // 往返稳定：再序列化一次逐字节不变。
  assert.equal(serializeQuoteMessage(parsed), serializeQuoteMessage(blocks));
});

test("parseQuoteMessage：role 非法 / 缺 role 的 msg-quote 不还原为卡片，内容守恒落地为段落", () => {
  const original = '<msg-quote role="system">这条不该变卡片</msg-quote>';
  const parsed = parseQuoteMessage(original);
  assert.equal(parsed.every((b) => b.kind === "paragraph"), true);
  assert.equal(
    parsed.map((b) => (b.kind === "paragraph" ? b.text : "")).join("\n"),
    original,
  );
  // 未知元素同理：不识别即不还原，MUST NOT 静默丢文。
  const unknown = "<foo data-x=\"1\">未知元素正文</foo>";
  const parsedUnknown = parseQuoteMessage(unknown);
  assert.equal(parsedUnknown.every((b) => b.kind === "paragraph"), true);
  assert.ok(parsedUnknown.some((b) => b.kind === "paragraph" && b.text.includes("未知元素正文")));
});
