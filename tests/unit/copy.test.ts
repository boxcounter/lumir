// 文案层门禁（M282，change ui-language-i18n）：deck ↔ 表全量漂移、取值门禁（AST）、
// 占位名与复数、上屏列锁定、语言域纯逻辑。design §4.4 / tasks §3.4 / §7。
//
// 这一层的判据是**机械的**：deck（`文案-Copy.md`）是规范文本与人的评审面，`src/copy-data.ts`
// 是运行时唯一取值入口，两边不许漂移；`src/**` 里除文案表自身外不许再有中文串字面量
//（诊断面与进磁盘的数据有显式豁免，见 `EXEMPT_CATEGORIES`）。
//
// 本层不造 DOM 替身：语言域的纯逻辑经结构注入（`currentLanguage({ lang })`）断言，
// DOM 写入归装配层（与 `tests/unit/theme.test.ts` 的 `currentTheme(root)` 同款分层）。

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  COPY,
  currentLanguage,
  formatDate,
  formatNumber,
  formatRelative,
  interpolate,
  languageFromTag,
  languageTag,
  nextLanguage,
  onRelabel,
  placeholders,
  resetRelabels,
  runRelabels,
  t,
  tPlural,
} from "../../src/copy.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const deckText = readFileSync(path.join(root, "文案-Copy.md"), "utf8");

// ---------------------------------------------------------------------------
// deck 解析
// ---------------------------------------------------------------------------

/** 一格多串的行 → 格内键序列（**显式声明**，不按分隔符猜——D67 本身就是一条含 ` / ` 的串，
 *  机械切分会把它劈成两条；D64 一格 12 条、D66 一格 2 条且会随扩写变）。声明与 deck 不一致
 *  时下面会报红（条数或逐条文本对不上），扩写一行必须同一次改动里同步这里。 */
const MULTI_STRING_ROWS: Record<string, string[]> = {
  D64: ["D64.1", "D64.2", "D64.3", "D64.4", "D64.5", "D64.6", "D64.7", "D64.8", "D64.9", "D64.10", "D64.11", "D64.12"],
  D66: ["D66.1", "D66.2"],
  D69: ["D69.1", "D69.2"],
  D72: ["D72.1", "D72.2"],
  D93: ["D93.1", "D93.2", "D93.3"],
  D99: ["D99.1", "D99.2", "D99.3"],
  D100: ["D100.1"],
  D104: ["D104.1", "D104.2"],
  D110: ["D110.1", "D110.2", "D110.3"],
};

interface DeckRow {
  key: string;
  /** 位置（第 2 列）。 */
  position: string;
  /** 中文列（第 4 列）与 English 列（第 5 列），已还原 `\n` 与 `\\`。 */
  zh: string;
  en: string;
  /** 设计意图（第 6 列）。 */
  intent: string;
}

function unescapeCell(text: string): string {
  return text.replaceAll("\\n", "\n").replaceAll("\\|", "|").replaceAll("\\\\", "\\");
}

function parseDeck(): DeckRow[] {
  const rows: DeckRow[] = [];
  for (const line of deckText.split("\n")) {
    if (!/^\| D\d+(?:\.\d+)? \| /.test(line)) continue;
    const cells = line.split("|");
    assert.equal(cells.length, 8, `deck 行的列数不是 6：${line}`);
    rows.push({
      key: cells[1].trim(),
      position: cells[2].trim(),
      zh: unescapeCell(cells[4].trim()),
      en: unescapeCell(cells[5].trim()),
      intent: cells[6].trim(),
    });
  }
  return rows;
}

/** 占位名归一：**只按位置**比对（deck 的中文列保留 `{原因}` 这类中文占位名作可读性，
 *  文案表里两列一律 ASCII 同名——design §6.1）。占位名的**个数与位置**仍逐字参与比对，
 *  少一个/多一个/换位置都会红。 */
function normalizeSlots(text: string): string {
  return text.replace(/\{[^}]*\}/g, "{}");
}

// ---------------------------------------------------------------------------
// 1）漂移门禁：deck ↔ 表全量
// ---------------------------------------------------------------------------

test("漂移门禁：deck 的每条活跃行的两列与文案表逐字相等（占位名按位置归一）", () => {
  const rows = parseDeck();
  assert.ok(rows.length > 200, `deck 行数异常（${rows.length}）`);
  const seen = new Set<string>();
  for (const row of rows) {
    const keys = MULTI_STRING_ROWS[row.key];
    if (keys === undefined) {
      const entry = COPY[row.key as keyof typeof COPY];
      assert.ok(entry !== undefined, `deck 行 ${row.key} 在文案表里没有条目`);
      assert.equal(normalizeSlots(entry.zh), normalizeSlots(row.zh), `${row.key} 的中文列与表不一致`);
      assert.equal(normalizeSlots(entry.en), normalizeSlots(row.en), `${row.key} 的 English 列与表不一致`);
      seen.add(row.key);
      continue;
    }
    // 一格多串：按声明的键序列与格内顺序逐条比对。
    const items = row.zh.split(" / ");
    assert.equal(items.length, keys.length, `${row.key} 的格内条数与声明的键序列不一致`);
    const enItems = row.en.split(" / ");
    assert.equal(enItems.length, keys.length, `${row.key} 的 English 格内条数与声明的键序列不一致`);
    keys.forEach((key, index) => {
      const entry = COPY[key as keyof typeof COPY];
      assert.ok(entry !== undefined, `${key} 不在文案表里`);
      assert.equal(normalizeSlots(entry.zh), normalizeSlots(items[index]), `${key} 的中文列与格内第 ${index + 1} 条不一致`);
      assert.equal(normalizeSlots(entry.en), normalizeSlots(enItems[index]), `${key} 的 English 列与格内第 ${index + 1} 条不一致`);
      seen.add(key);
    });
  }
  // 反向：文案表的键必须都能在 deck 里找到（多一个键即红——表比 deck 多出一条就是未经评审的新文案）。
  const tableKeys = new Set(Object.keys(COPY));
  const missing = [...tableKeys].filter((key) => !seen.has(key));
  assert.deepEqual(missing, [], "文案表里这些键在 deck 里没有对应行");
  const extra = [...seen].filter((key) => !tableKeys.has(key));
  assert.deepEqual(extra, []);
});

test("漂移门禁：格内多串的声明与 deck 的实际形态逐条可读（反向判据）", () => {
  // 反向验证（REVIEW.md 第 1 条）：把声明里的条数改一位，断言必须能红——这里用「切分后
  // 条数」这一条判据直接演示区分度：D67 是一条含 ` / ` 的串，MUST NOT 被切分。
  const rows = parseDeck();
  const d67 = rows.find((row) => row.key === "D67");
  assert.ok(d67 !== undefined);
  assert.ok(MULTI_STRING_ROWS.D67 === undefined, "D67 是一条串，不得进 MULTI_STRING_ROWS");
  assert.ok(d67.zh.includes(" / "), "D67 的中文列本就含 ` / `——机械切分会把它劈成两条");
  assert.equal(COPY["D67"].zh, d67.zh);
});

// ---------------------------------------------------------------------------
// 2）条目形态：占位名同名、上屏列锁定
// ---------------------------------------------------------------------------

test("占位名：每条目的两列占位名集合逐字相同（个数与顺序）", () => {
  for (const [key, entry] of Object.entries(COPY)) {
    const zh = placeholders(entry.zh);
    const en = placeholders(entry.en);
    assert.deepEqual(en, zh, `${key} 的两列占位名不同名（en 列少一个参数就是静默的空格）`);
    if (entry.enOne !== undefined) {
      assert.deepEqual(placeholders(entry.enOne), zh, `${key} 的 enOne 档占位名不同名`);
    }
  }
});

test("上屏列锁定：D149–D151 在 zh 与 en 下上屏的都是 English 列，且 deck 的设计意图列有标记", () => {
  const rows = parseDeck();
  for (const key of ["D149", "D150", "D151"] as const) {
    const entry = COPY[key];
    assert.equal(entry.lock, "en", `${key} 必须是上屏列锁定条目`);
    assert.equal(t(key, undefined, "zh"), entry.en, `${key} 在 zh 界面下上屏的必须是锁定列（英文原文）`);
    assert.equal(t(key, undefined, "en"), entry.en);
    assert.notEqual(entry.zh, entry.en, `${key} 的两列是两个不同的串（锁定列 ≠ 沿革备查的措辞）`);
    const row = rows.find((r) => r.key === key);
    assert.ok(row !== undefined);
    assert.ok(row.intent.includes("【上屏列锁定 en】"), `${key} 的设计意图列缺少锁列标记`);
  }
});

test("两列同形条目（D77 / D80 / D114）不分语言", () => {
  for (const key of ["D77", "D80", "D114"] as const) {
    assert.equal(COPY[key].zh, COPY[key].en, `${key} 两列应同形`);
    assert.equal(COPY[key].lock, undefined);
  }
});

// ---------------------------------------------------------------------------
// 3）t() / tPlural()：插值、缺参、复数
// ---------------------------------------------------------------------------

test("t()：正常插值，缺参报错（不静默留空位），多传参数不报错", () => {
  assert.equal(t("D20", { heading: "标题一" }, "zh"), "标题未找到：标题一");
  assert.equal(t("D20", { heading: "H1" }, "en"), "Heading not found: H1");
  let thrown: unknown;
  try {
    t("D20", {}, "zh");
  } catch (error) {
    thrown = error;
  }
  // 缺参必须抛错，且错误信息带键名与缺失的占位名（不然上屏的是一个查不出来的空槽）
  assert.ok(thrown instanceof Error, "缺参必须抛错");
  assert.ok(thrown.message.includes("D20") && thrown.message.includes("heading"), thrown.message);
  assert.equal(t("D20", { heading: "H1", extra: "x" }, "en"), "Heading not found: H1");
});

test("interpolate()：占位名大小写与重名都按字面替换", () => {
  assert.equal(interpolate("{a}-{a}-{b}", "D0", { a: "1", b: "2" }), "1-1-2");
  assert.throws(() => interpolate("{missing}", "D0", {}));
});

test("tPlural()：en 走 Intl 的 one/other 两档，zh 两档同形", () => {
  const one = { n: 1 };
  const two = { n: 2 };
  assert.equal(tPlural("D99.3", 1, one, "en"), "1 tab");
  assert.equal(tPlural("D99.3", 2, two, "en"), "2 tabs");
  assert.equal(tPlural("D99.3", 1, one, "zh"), "1 个标签");
  assert.equal(tPlural("D99.3", 2, two, "zh"), "2 个标签");
  assert.equal(tPlural("D108", 1, one, "en"), "1 file is no longer in this vault and was skipped");
  assert.equal(tPlural("D108", 3, { n: 3 }, "en"), "3 files are no longer in this vault and were skipped");
});

test("格式化：NumberFormat / DateTimeFormat / RelativeTimeFormat 的两态读数", () => {
  assert.equal(formatNumber(1234, "en"), "1,234");
  assert.equal(formatNumber(1234, "zh"), "1,234");
  const date = new Date(2026, 8, 28);
  assert.equal(formatDate(date, "long", "zh"), "2026年9月28日");
  assert.equal(formatDate(date, "short", "zh"), "9月28日");
  assert.equal(formatDate(date, "long", "en"), "September 28, 2026");
  assert.equal(formatDate(date, "short", "en"), "September 28");
  assert.equal(formatRelative(-5, "minute", "en"), "5 minutes ago");
  assert.equal(formatRelative(-5, "minute", "zh"), "5分钟前");
  assert.equal(formatRelative(-1, "day", "en"), "yesterday");
  assert.equal(formatRelative(-1, "day", "zh"), "昨天");
});

// ---------------------------------------------------------------------------
// 4）语言域纯逻辑（不造 DOM 替身）
// ---------------------------------------------------------------------------

test("语言域：tag ↔ 档位映射、当前语言读取与下一步推导", () => {
  assert.equal(languageTag("zh"), "zh-Hans");
  assert.equal(languageTag("en"), "en");
  assert.equal(languageFromTag("zh-Hans"), "zh");
  assert.equal(languageFromTag("zh"), "zh");
  assert.equal(languageFromTag("en"), "en");
  // 读不到 / 不认识 → 默认档，不猜（与 currentTheme 的 null 语义同款：缺失不是第四档）
  assert.equal(languageFromTag(undefined), "en");
  assert.equal(languageFromTag("fr"), "en");
  assert.equal(currentLanguage({ lang: "zh-Hans" }), "zh");
  assert.equal(currentLanguage({ lang: "en" }), "en");
  assert.equal(currentLanguage({}), "en");
  assert.equal(nextLanguage("en"), "zh");
  assert.equal(nextLanguage("zh"), "en");
  assert.notEqual(nextLanguage("en"), nextLanguage("zh"), "两档循环不是空转");
  // 不抛错即可（单测环境的读取口由 tests/unit/register.mjs 钉在 zh——见那里的说明）。
  assert.ok(["en", "zh"].includes(currentLanguage()), "读取口缺失时必须给一个合法档位");
});

test("重绘注册：按注册顺序跑一遍，注册之外没有第二个施加路径", () => {
  resetRelabels();
  const order: number[] = [];
  onRelabel(() => order.push(1));
  onRelabel(() => order.push(2));
  runRelabels();
  assert.deepEqual(order, [1, 2]);
  resetRelabels();
  runRelabels();
  assert.deepEqual(order, [1, 2], "清空后再跑不应有回调");
});

// ---------------------------------------------------------------------------
// 5）取值门禁：src/** 除文案表外零 CJK 字面量（AST 扫描）
// ---------------------------------------------------------------------------

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
/** 允许清单**只有文案表自身**（`src/copy*.ts`）。此外只有两类**就地标注**的豁免：
 *  - `log`：只进诊断日志 / 配置告警的串（design §8.2 终裁：诊断面向开发者、语言固定）；
 *  - `data`：进磁盘 / 文档的数据（派生文件名、演示文档的正文）；
 *  - `glyph`：与语言无关的纯字形（如全角加号）。
 *  三类都要在同一行写明 `// i18n-exempt: <类别>`，门禁的输出里会把豁免逐条列出来。 */
const EXEMPT_CATEGORIES = new Set(["log", "data", "glyph"]);

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "bindings" || name === "node_modules") continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

test("取值门禁：src/** 除文案表外零含 CJK 的串字面量（豁免须就地标注类别）", () => {
  const violations: string[] = [];
  const exemptions: string[] = [];
  for (const file of walkTs(path.join(root, "src"))) {
    const rel = path.relative(root, file);
    if (/^src\/copy.*\.ts$/.test(rel)) continue;
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const lines = source.split("\n");
    const visit = (node: ts.Node): void => {
      if (
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)
      ) {
        // 模板串只取字面片段（`${x}` 里的表达式不是字面量）。
        const text = ts.isTemplateExpression(node)
          ? node.head.text + node.templateSpans.map((span) => span.literal.text).join("")
          : node.text;
        if (CJK.test(text)) {
          const lineIndex = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
          const lineText = lines[lineIndex];
          const marker = /i18n-exempt:\s*(\w+)/.exec(lineText);
          if (marker !== null && EXEMPT_CATEGORIES.has(marker[1])) {
            exemptions.push(`${rel}:${lineIndex + 1} [${marker[1]}]`);
          } else {
            violations.push(`${rel}:${lineIndex + 1} ${JSON.stringify(text.slice(0, 60))}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  assert.deepEqual(
    violations,
    [],
    `src/** 里仍有未迁移的中文串字面量（迁移或按类标注 i18n-exempt）`,
  );
  assert.ok(exemptions.length >= 8, `豁免清单异常（${exemptions.length} 条）`);
  // 豁免的类别只能是闭集合里的三种——上面的循环已经过滤，这里留一条可读的输出。
  assert.ok(exemptions.every((e) => /\[(log|data|glyph)\]$/.test(e)));
});
