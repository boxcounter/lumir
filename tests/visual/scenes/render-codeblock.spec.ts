import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";
import { highlightCode } from "../../../src/preview/code";

// 代码块着色（M138）：markdown 文档内的围栏代码块按 info string 走 legacy-modes
// 流式 parser。配色只用单套排版基线的既有 editorial token（与 editor.ts 的 code
// 模式同色）——本文件先做不依赖 DOM 的 token 级断言，再验 chromium 侧的实际渲染色。
const source = readFileSync(new URL("../fixtures/render-codeblock/languages.md", import.meta.url), "utf8");

const COLOR = {
  accent: "rgb(178, 58, 44)", // --accent（关键字）
  tip: "rgb(90, 122, 63)", // --callout-tip（字符串）
  warning: "rgb(160, 94, 28)", // --callout-warning（数字/atom）
  dim: "rgb(141, 132, 113)", // --dim（注释）
  note: "rgb(79, 111, 143)", // --callout-note（属性）
  abstract: "rgb(61, 122, 118)", // --callout-abstract（类型/标签）
  text: "rgb(38, 34, 25)", // --text（正文）
};
const ALLOWED = new Set(Object.values(COLOR));

async function open(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "languages.md", kind: "file", size: source.length, mtime_ms: 0 }],
    files: { "languages.md": source },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="languages.md"]').click();
  await expect(page.locator(".cm-lp-tok-keyword").first()).toBeVisible();
}

/** 某一行上带 token 类的 span（文本 / 类名 / 计算色）。 */
async function tokenSpans(page: Page, lineNeedle: string) {
  return page.locator(".cm-line", { hasText: lineNeedle }).first().evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>("span[class*='cm-lp-tok-']")].map((span) => ({
      text: span.textContent ?? "",
      cls: span.className,
      color: getComputedStyle(span).color,
    })),
  );
}

test("token 划分：语言识别、别名归一、未知与无标识降级", () => {
  // rust：关键字/注释/字符串/数字四类都出
  const rust = highlightCode(`// 注释\nfn main() {\n  let total = 42;\n  println!("hello");\n}`, "rust");
  const classes = new Set(rust.map((token) => token.cls));
  expect(classes).toContain("cm-lp-tok-keyword");
  expect(classes).toContain("cm-lp-tok-comment");
  expect(classes).toContain("cm-lp-tok-string");
  expect(classes).toContain("cm-lp-tok-literal");
  // 相邻同类 token 合并成一个区间（`"hello"` 是单个区间，不切成三段）
  const string = rust.find((token) => token.cls === "cm-lp-tok-string");
  expect(string).toBeDefined();

  // fenced 常见别名归一
  const aliased = ["js", "ts", "tsx", "bash", "sh", "py", "yml", "rs"];
  for (const alias of aliased) {
    expect(highlightCode(`const x = 1; // c\necho "hi"\nname: value`, alias).length, alias).toBeGreaterThan(0);
  }

  // 未收录语言、空 info、mermaid（走自己的 widget）一律不着色
  for (const info of ["text", "", "  ", "mermaid", "brainfuck-nope", "vue"]) {
    expect(highlightCode(`fn main() { let x = 1; }`, info), JSON.stringify(info)).toEqual([]);
  }

  // 超大块不着色（O(块长) 扫描 + 编辑期每次击键重算，会打破 1MB 打开预算）
  expect(highlightCode("x".repeat(64 * 1024 + 1), "rust")).toEqual([]);
  expect(highlightCode("x".repeat(1024), "rust").length).toBe(0); // 纯文本无法识别 token
});

// M147 的不变量：json 的键恒取属性色、字符串值恒不与键同色。输入维度扫一遍——嵌套层级、
// 数组内对象、空对象/空数组、单行紧凑、纯数字键、中文键、含点/冒号/空格/转义引号的键——
// 只钉一个 fixture 只能证明那个案例被修好（渲染缺陷合同先行的属性测试要求）。
test("json 键着色不变量：任意形状的 json，键取属性色、字符串值取字符串色", () => {
  const cases: Array<{ doc: string; keys: string[]; strings: string[] }> = [
    { doc: `{"name": "lumir", "count": 3, "ok": true, "nothing": null}`, keys: ['"name"', '"count"', '"ok"', '"nothing"'], strings: [] },
    { doc: `{\n  "name": "lumir",\n  "nested": { "inner": "deep" },\n  "list": [{ "a": "b" }]\n}`, keys: ['"name"', '"nested"', '"inner"', '"list"', '"a"'], strings: ['"lumir"', '"deep"', '"b"'] },
    { doc: `{"123": "digits", "中文键": "unicode"}`, keys: ['"123"', '"中文键"'], strings: ['"digits"', '"unicode"'] },
    { doc: `{"a.b": "v", "a:b": "w", "a b": "x"}`, keys: ['"a.b"', '"a:b"', '"a b"'], strings: ['"v"', '"w"', '"x"'] },
    { doc: `{"esc\\"q": "v"}`, keys: [`"esc\\"q"`], strings: ['"v"'] },
    { doc: `{"empty": {}, "arr": []}`, keys: ['"empty"', '"arr"'], strings: [] },
    { doc: `[{"k": "v"}, {"k2": 2}]`, keys: ['"k"', '"k2"'], strings: ['"v"'] },
  ];
  for (const { doc, keys, strings } of cases) {
    const tokens = highlightCode(doc, "json");
    const classesOf = (text: string) => tokens.filter((token) => doc.slice(token.from, token.to) === text).map((token) => token.cls);
    for (const key of keys) {
      const classes = classesOf(key);
      expect(classes.length, `${doc} 的键 ${key} 未被着色`).toBeGreaterThan(0);
      for (const cls of classes) expect(cls, `${doc} 的键 ${key}`).toContain("cm-lp-tok-property");
    }
    for (const value of strings) {
      const classes = classesOf(value);
      expect(classes.length, `${doc} 的值 ${value} 未被着色`).toBeGreaterThan(0);
      for (const cls of classes) {
        expect(cls, `${doc} 的值 ${value}`).toContain("cm-lp-tok-string");
        expect(cls, `${doc} 的值 ${value} 被当成了键`).not.toContain("cm-lp-tok-property");
      }
    }
  }
  // javascript/typescript 的字符串键不跟着变（同一条 objprop 分支，但那里字符串色才是对的）
  const js = highlightCode(`const a = {"name": "lumir"};`, "javascript");
  const jsKey = js.filter((token) => `const a = {"name": "lumir"};`.slice(token.from, token.to) === '"name"');
  expect(jsKey.length).toBeGreaterThan(0);
  for (const token of jsKey) expect(token.cls).toBe("cm-lp-tok-string");
});

test("≥5 种语言着色，未知/无标识保持纯文本，配色不越出 editorial token", async ({ page }) => {
  await open(page);

  // 每种语言至少一处 token 落色；这里同时钉住「哪一类 token 取哪个 token 色」
  const cases: Array<[string, string, string, string]> = [
    ["fn main() -> i32", "fn", "cm-lp-tok-keyword", COLOR.accent],
    ["let total = 42", "42", "cm-lp-tok-literal", COLOR.warning],
    ["// 注释", "// 注释", "cm-lp-tok-comment", COLOR.dim],
    ["const limit: number = 42", "const", "cm-lp-tok-keyword", COLOR.accent],
    ["const limit: number = 42", "number", "cm-lp-tok-type", COLOR.abstract],
    [`return \`hello \${name}\``, "`hello ${", "cm-lp-tok-string", COLOR.tip],
    ["def greet(name: str) -> str:", "def", "cm-lp-tok-keyword", COLOR.accent],
    [`return f"hello {name}"`, '"hello ', "cm-lp-tok-string", COLOR.tip],
    [`echo "hello" | wc -l`, '"hello"', "cm-lp-tok-string", COLOR.tip],
    [`echo "hello" | wc -l`, "-l", "cm-lp-tok-property", COLOR.note],
    [`{"name": "lumir", "count": 3}`, "3", "cm-lp-tok-literal", COLOR.warning],
  ];
  for (const [line, text, cls, color] of cases) {
    const spans = await tokenSpans(page, line);
    const hit = spans.find((span) => span.text.includes(text) && span.cls.includes(cls));
    expect(hit, `${line} → ${text} 应为 ${cls}`).toBeDefined();
    expect(hit!.color, `${text} 的颜色`).toBe(color);
  }

  // json 键取属性色：legacy json mode 的键是 `string property` 复合 token，property
  // 经 parser 的 tokenTable（JSON_TOKEN_TABLE）解析成 tags.propertyName，键因此同时带
  // string 与 property 两个类；theme.ts 里 .cm-lp-tok-property 在 .cm-lp-tok-string 之后，
  // 靠后者命中。M147 前 property 无 tag 可用，键只剩 string、与值同色——本行旧口径
  //（「键取字符串色」）由此反转：preview 侧不再向 code 模式的**旧**行为对齐，而是两侧
  // 同时对齐到新的正确行为（parity 方向没变，锚点换了）。
  const jsonSpans = await tokenSpans(page, `{"name": "lumir"`);
  const jsonKey = jsonSpans.find((span) => span.text === '"name"');
  expect(jsonKey?.cls).toContain("cm-lp-tok-property");
  expect(jsonKey?.color).toBe(COLOR.note);
  const jsonValue = jsonSpans.find((span) => span.text === '"lumir"');
  expect(jsonValue?.cls).toBe("cm-lp-tok-string");
  expect(jsonValue?.color).toBe(COLOR.tip);

  // 未知语言（`text`）与无 info 的围栏：不着色
  for (const line of ["fenced code -- source stays literal", "no info string stays plain"]) {
    expect(await tokenSpans(page, line), line).toEqual([]);
    const color = await page.locator(".cm-line", { hasText: line }).evaluate((el) => getComputedStyle(el).color);
    expect(color).toBe(COLOR.text);
  }

  // 全文所有 token 色必须来自既有 editorial token，不引入新色
  const used = await page.locator("span[class*='cm-lp-tok-']").evaluateAll((spans) =>
    [...new Set(spans.map((span) => getComputedStyle(span).color))],
  );
  expect(used.length).toBeGreaterThan(0);
  for (const color of used) expect(ALLOWED.has(color), color).toBe(true);

  await expect(page).toHaveScreenshot("render-codeblock.png");

  // 整页基线是 1200×800 的**视口**截图（playwright.config 未开 fullPage），json 行落在折叠线
  // 以下——本次修复前逐张核对过基线，那条键色从没进过任何整页基线，整页对比守不住它。
  // 这里补一张元素级基线（同 m133 的 overlay 元素截图口径）把键/值分色钉在视觉层。
  // 必须放在整页截图**之后**：元素截图会把该行滚进视口，先截会改掉整页基线的滚动位置。
  await expect(page.locator(".cm-line", { hasText: `{"name": "lumir"` }).first()).toHaveScreenshot("render-codeblock-json-line.png");
});

test("编辑态：块内输入即时着色，颜色不溢出到块外段落", async ({ page }) => {
  await open(page);

  // 代码块外段落：无 token 装饰、取正文色
  const outside = async () =>
    page.locator(".cm-line", { hasText: "着色不得溢出到代码块之外" }).evaluate((el) => ({
      tokens: el.querySelectorAll("span[class*='cm-lp-tok-']").length,
      color: getComputedStyle(el).color,
    }));
  expect(await outside()).toEqual({ tokens: 0, color: COLOR.text });

  // 光标进代码块（编辑态）行尾追加注释：新文本立即按注释色着色
  const line = page.locator(".cm-line", { hasText: "let total = 42" });
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" // 追加注释");
  await expect.poll(async () => {
    const spans = await page.locator(".cm-line", { hasText: "追加注释" }).evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("span")].filter((span) => (span.textContent ?? "").includes("追加注释")).map((span) => [span.className, getComputedStyle(span).color]),
    );
    return spans.some(([cls, color]) => (cls as string).includes("cm-lp-tok-comment") && color === COLOR.dim);
  }).toBe(true);
  expect(await readDocument(page)).toContain("// 追加注释");

  // 输入后块外段落仍无着色（装饰按代码块边界裁剪）
  expect(await outside()).toEqual({ tokens: 0, color: COLOR.text });
});
