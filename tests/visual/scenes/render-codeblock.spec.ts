import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
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

// ---------------------------------------------------------------------------
// M179：yaml 的键名配色（方案 A——只把 legacy yaml mode 的 `atom` 改取属性名色）。
// 修前现场：`atom` 落在 TOKEN_GROUPS 的 literal 组，而 `mode/yaml.js:77` 的 `return "atom"`
// 是该文件里唯一一处、只由映射键分支产出——键因此与数字、布尔同色，整块只出一种颜色。
// 契约与 json 同族（见「JSON 键名与值分色」）：键的语义是属性名，取属性色。
// ---------------------------------------------------------------------------

/** 逐 token 的 (原文, 类名)：原文按 token 边界切——yaml mode 的键正则吃前导缩进，故匹配一律先 trim。 */
function tokenList(doc: string, info: string): Array<{ text: string; cls: string }> {
  return highlightCode(doc, info).map((token) => ({ text: doc.slice(token.from, token.to), cls: token.cls }));
}

/** 某段原文命中的全部类名（trim 后逐字相等）；空数组 = 该文本没被着色。 */
function classesOf(tokens: Array<{ text: string; cls: string }>, text: string): string[] {
  return tokens.filter((token) => token.text.trim() === text).map((token) => token.cls);
}

test("yaml 键着色不变量：任意形态的键取属性色、MUST NOT 落字面量色", () => {
  // 输入维度扫一遍而不是只钉一个 fixture（REVIEW.md 第 1 条：单案例只能证明那个案例被修好）。
  // 形态取自可触及语料与真实 vault 的 `Logbook/README.md`（`dimensions:` 那张表）：顶层键、
  // 嵌套键、序列项内的键、多词键、含 `-` / `.` / `/` / `+` 的键、非 ASCII 键。
  const cases: Array<{ doc: string; keys: string[] }> = [
    { doc: `dimensions:\n  - name: Goal\n    key: goal\n    source: monthly\n`, keys: ["dimensions", "name", "key", "source"] },
    { doc: `outer:\n  inner:\n    deepest: 1\n`, keys: ["outer", "inner", "deepest"] },
    { doc: `- name: Goal\n  key: goal\n`, keys: ["name", "key"] },
    { doc: `Business line: Slax Reader\n`, keys: ["Business line"] },
    { doc: `importance-urgency: x\na.b: y\nc/d: z\ne+f: g\n`, keys: ["importance-urgency", "a.b", "c/d", "e+f"] },
    { doc: `类别: 1\n名字: 备忘录\n`, keys: ["类别", "名字"] },
  ];
  for (const { doc, keys } of cases) {
    const tokens = tokenList(doc, "yaml");
    for (const key of keys) {
      const classes = classesOf(tokens, key);
      expect(classes.length, `${JSON.stringify(doc)} 的键 ${key} 未被着色`).toBeGreaterThan(0);
      for (const cls of classes) {
        expect(cls, `${JSON.stringify(doc)} 的键 ${key}`).toContain("cm-lp-tok-property");
        expect(cls, `${JSON.stringify(doc)} 的键 ${key} 落了字面量色`).not.toContain("cm-lp-tok-literal");
      }
    }
  }
});

test("yaml 的 token 分工：键取属性色，字符串 / 布尔 / 数字 / 注释各归其色且不被牵连", () => {
  const doc = `name: 'quoted'\ncount: 12\nflag: true\n# 注释\ndescription: 未加引号的标量\nlist:\n  - a\n`;
  const tokens = tokenList(doc, "yaml");
  // 键：五个形态各验一次（序列项内的 `name` 与顶层 `name` 同形，由上一用例的独立文档覆盖）
  for (const key of ["name", "count", "flag", "description", "list"]) {
    expect(classesOf(tokens, key), `键 ${key}`).toEqual(["cm-lp-tok-property"]);
  }
  // 值：字符串 / 数字 / 布尔 / 注释
  expect(classesOf(tokens, "'quoted'"), "字符串值").toEqual(["cm-lp-tok-string"]);
  expect(classesOf(tokens, "12"), "数字值").toEqual(["cm-lp-tok-literal"]);
  expect(classesOf(tokens, "true"), "布尔值").toEqual(["cm-lp-tok-keyword"]);
  expect(classesOf(tokens, "# 注释"), "注释").toEqual(["cm-lp-tok-comment"]);
  // 未加引号的标量值与结构符号（`-` / `:`）本就不产出 token——修键名不改变这条既有边界
  expect(classesOf(tokens, "未加引号的标量"), "未加引号的标量值").toEqual([]);
  expect(classesOf(tokens, "a"), "序列里的标量值").toEqual([]);
  // 已知边界（spec 里单列一条 scenario）：带引号的键走 yaml mode 的引号分支、产出 `string`
  // token——与引号值同一个 token 名，token 名层面分不开键与值，故它仍取字符串色。要分开须改
  // vendored parser 的词法，本 change 非目标（design §6 有同一行）。
  expect(classesOf(tokenList(`"quoted key": v\n`, "yaml"), '"quoted key"'), "带引号的键").toEqual(["cm-lp-tok-string"]);
});

test("yml 与 yaml 逐 token 相同；yaml 的 atom 不外溢到 toml / json / javascript", () => {
  const doc = `dimensions:\n  - name: Goal\n    key: goal\n`;
  // 别名归一：同一段代码两个 info string 得到逐 token 相同的 from / to / cls
  expect(highlightCode(doc, "yml")).toEqual(highlightCode(doc, "yaml"));

  // toml 的 `atom`（表头 / 布尔 / 日期）取色不变，仍是字面量色——tokenTable 只挂在 yaml 项上
  const tomlDoc = `[[hooks]]\nevent = 'PreToolUse'\nenabled = true\nretries = 3\nsince = 1979-05-27\n# 注释\n`;
  const toml = tokenList(tomlDoc, "toml");
  expect(classesOf(toml, "[[hooks]]"), "toml 表头").toEqual(["cm-lp-tok-literal"]);
  expect(classesOf(toml, "true"), "toml 布尔").toEqual(["cm-lp-tok-literal"]);
  expect(classesOf(toml, "1979-05-27"), "toml 日期").toEqual(["cm-lp-tok-literal"]);
  expect(classesOf(toml, "event"), "toml 键").toEqual(["cm-lp-tok-property"]);
  expect(classesOf(toml, "'PreToolUse'"), "toml 字符串").toEqual(["cm-lp-tok-string"]);
  expect(classesOf(toml, "3"), "toml 数字").toEqual(["cm-lp-tok-literal"]);
  expect(classesOf(toml, "# 注释"), "toml 注释").toEqual(["cm-lp-tok-comment"]);

  // json / javascript 的键口径不跟着变（json 键属性色、js 字符串键字符串色）。
  // json 键同时带 string 与 propertyName 两个 tag、类名因此是多类并存，故按 includes 判而不是值相等。
  const jsonKey = classesOf(tokenList(`{"name": "lumir"}`, "json"), '"name"');
  expect(jsonKey.length, "json 键未被着色").toBeGreaterThan(0);
  for (const cls of jsonKey) expect(cls, "json 键").toContain("cm-lp-tok-property");
  const jsKey = classesOf(tokenList(`const a = {"name": "lumir"};`, "javascript"), '"name"');
  expect(jsKey.length, "js 键未被着色").toBeGreaterThan(0);
  for (const cls of jsKey) {
    expect(cls, "js 键").toContain("cm-lp-tok-string");
    expect(cls, "js 键").not.toContain("cm-lp-tok-property");
  }

  // 缓存按语言分流（classOf 的缓存键含语言名）：同一个 token 名在两个语言下必须互不串味。
  // 先 yaml 再 toml 再 yaml，两侧读数都不许变——缓存若不按语言分键，第二次读会拿到第一次的类名。
  const yamlAgain = tokenList(doc, "yaml");
  expect(classesOf(yamlAgain, "name")[0]).toBe("cm-lp-tok-property");
  expect(classesOf(tokenList(tomlDoc, "toml"), "true")).toEqual(["cm-lp-tok-literal"]);
  expect(classesOf(tokenList(doc, "yaml"), "name")[0]).toBe("cm-lp-tok-property");
});

test("yaml / toml 的着色边界：超上限、无键的纯列表、未收录语言", () => {
  // 先给正观测：有键的 yaml 块确实产出 token（否则下面的负向断言在空集上空转，REVIEW.md 第 2 条）
  expect(classesOf(tokenList(`k: v\n`, "yaml"), "k")).toEqual(["cm-lp-tok-property"]);

  // 超过单一代码块上限（64 KiB）即回落纯文本，与语言无关
  const bigYaml = `k: v\n`.repeat(14000); // 70000 字符 > 64 KiB
  const bigToml = `k = 1\n`.repeat(14000);
  expect(bigYaml.length).toBeGreaterThan(64 * 1024);
  expect(bigToml.length).toBeGreaterThan(64 * 1024);
  expect(highlightCode(bigYaml, "yaml"), "超大 yaml 块").toEqual([]);
  expect(highlightCode(bigToml, "toml"), "超大 toml 块").toEqual([]);
  // 同一段内容在阈值内着色、超阈值不着色，差别只来自长度而不是语言或内容
  expect(highlightCode(bigYaml.slice(0, 64 * 1024), "yaml").length).toBeGreaterThan(0);

  // 无键的纯列表块：parser 只给 `meta` 与 `null`，整块不出 token（yaml mode 的能力边界，两侧一致）
  expect(highlightCode(`- a\n- b\n`, "yaml"), "无键的纯列表").toEqual([]);

  // 未收录语言与无 info 围栏保持纯文本
  for (const info of ["", "  ", "brainfuck-nope", "toml-lite", ".yml"]) {
    expect(highlightCode(`k: v\n`, info), JSON.stringify(info)).toEqual([]);
  }
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

  await expectScreenshot(page, "render-codeblock.png");

  // 整页基线是 1200×800 的**视口**截图（playwright.config 未开 fullPage），json 行落在折叠线
  // 以下——本次修复前逐张核对过基线，那条键色从没进过任何整页基线，整页对比守不住它。
  // 这里补一张元素级基线（同 m133 的 overlay 元素截图口径）把键/值分色钉在视觉层。
  // 必须放在整页截图**之后**：元素截图会把该行滚进视口，先截会改掉整页基线的滚动位置。
  await expectScreenshot(page.locator(".cm-line", { hasText: `{"name": "lumir"` }).first(), "render-codeblock-json-line.png");
});

/** 把某行滚进视口：位置取自 CM6 的行块坐标（与字体 / 布局无关），不靠猜滚动量。 */
async function scrollToLine(page: Page, needle: string): Promise<void> {
  await page.evaluate((text) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const doc: string = view.state.doc.toString();
    const at = doc.indexOf(text);
    if (at < 0) throw new Error(`文档里没有 ${text}`);
    view.scrollDOM.scrollTop = Math.max(0, view.lineBlockAt(view.state.doc.lineAt(at).from).top - 40);
  }, needle);
}

/** 某行上**真的上了色**的 token（原文 trim、计算色 ≠ 行自身色），按文档顺序。
 *  CM6 只为可见区域建装饰，故调用前须先 `scrollToLine`；再等目标 token 真出现才读。
 *  比色值不比类名：围栏侧是 `cm-lp-tok-*`、code 模式侧是 CM6 自动生成的 `ͼ*`。 */
async function coloredTokens(page: Page, lineNeedle: string, expectToken: string) {
  const line = page.locator(".cm-line", { hasText: lineNeedle }).first();
  await line.waitFor();
  const read = () =>
    line.evaluate((el) => {
      const base = getComputedStyle(el).color;
      return [...el.querySelectorAll<HTMLElement>("span")]
        .map((span) => ({ text: (span.textContent ?? "").trim(), color: getComputedStyle(span).color }))
        .filter((token) => token.text !== "" && token.color !== base);
    });
  await expect
    .poll(async () => (await read()).some((token) => token.text === expectToken), {
      message: `「${lineNeedle}」行上应出现已着色的 ${expectToken}`,
    })
    .toBe(true);
  return read();
}

test("DOM：同段 yaml 在围栏（yaml）与只读 .yml / .yaml 文件（code 模式）里配色逐条相同", async ({ page }) => {
  // code 模式侧的内容直接从 fixture 的 ```yaml 围栏里取——「同一段 yaml」由构造保证，
  // 两处各写一份会在下一次改 fixture 时静默漂移（REVIEW.md 第 8 条）。
  const yamlBlock = /```yaml\n([\s\S]*?)```/.exec(source)?.[1] ?? "";
  expect(yamlBlock, "fixture 里应有 ```yaml 围栏").toContain("key: goal");
  await stubTauri(page, {
    entries: [
      { path: "languages.md", kind: "file", size: source.length, mtime_ms: 0 },
      { path: "config.yml", kind: "file", size: yamlBlock.length, mtime_ms: 0 },
      { path: "config.yaml", kind: "file", size: yamlBlock.length, mtime_ms: 0 },
    ],
    files: { "languages.md": source, "config.yml": yamlBlock, "config.yaml": yamlBlock },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="languages.md"]').click();
  await expect(page.locator(".cm-lp-tok-keyword").first()).toBeVisible();

  // 围栏侧（md 渲染路径）：取一段同时含键与行尾注释的行——两个 token、两种色，比单 token 更有区分度
  await scrollToLine(page, "特殊维度");
  const fenceLine = await coloredTokens(page, "特殊维度", "name");
  expect(fenceLine).toEqual([
    { text: "name", color: COLOR.note },
    { text: "# 特殊维度：values 来自当月 _monthly.md", color: COLOR.dim },
  ]);
  await scrollToLine(page, "key: goal");
  const fenceKeyLine = await coloredTokens(page, "key: goal", "key");
  expect(fenceKeyLine).toEqual([{ text: "key", color: COLOR.note }]);

  // code 模式侧：只读文件，同一段 yaml（逐字节相同）
  for (const file of ["config.yml", "config.yaml"]) {
    await page.locator(`.ft-row[title="${file}"]`).click();
    await expect(page.locator(".cm-content"), file).toHaveAttribute("contenteditable", "false");
    await expect(page.locator(".cm-content"), file).toHaveAttribute("aria-readonly", "true");
    expect(await coloredTokens(page, "特殊维度", "name"), file).toEqual(fenceLine);
    expect(await coloredTokens(page, "key: goal", "key"), file).toEqual(fenceKeyLine);
  }

  // 围栏侧 ```yml：别名走同一条 parser 路径，键同样取属性名色
  await page.locator('.ft-row[title="languages.md"]').click();
  await expect(page.locator(".cm-lp-tok-keyword").first()).toBeVisible();
  await scrollToLine(page, "key: category");
  expect(await coloredTokens(page, "key: category", "key")).toEqual([{ text: "key", color: COLOR.note }]);
});

test("DOM：围栏 toml / yaml 的取色（键属性色、toml 的 atom 不跟着变）", async ({ page }) => {
  await open(page);

  // 像素断言排在最前，顺序固定：先整页（滚到新增块所在位置）再元素级——元素截图会把目标行滚进
  // 视口，先截会改掉整页位置。放在计算色断言之前是为了让「视觉层」这一关独立可达：只改类名而不
  // 改色值这类回归计算色断言看不出来，只有基线比得出来（REVIEW.md 第 1、3 条）。
  await scrollToLine(page, "[[hooks]]");
  // 整页这张**必须覆盖容差**（REVIEW.md 第 3 条）：实测把 yaml 的键色改回旧值（键回到字面量赭色），
  // 这张 1200×800 的差异是 **958 像素**，而全局 maxDiffPixelRatio 0.001 的额度是 **960 像素**——
  // 差 2 像素就静默假绿。0.0005（480 像素）留 2 倍余量，同时仍远大于本地渲染抖动（同一基线的
  // 正常 run 逐像素零差异）。元素级那张不受此问题影响（766×29，额度 22 像素、差异 92 像素）。
  await expectScreenshot(page, "render-codeblock-toml-yaml.png", { maxDiffPixelRatio: 0.0005 });
  await expectScreenshot(page.locator(".cm-line", { hasText: "event = 'PreToolUse'" }).first(), "render-codeblock-toml-line.png");
  await expectScreenshot(page.locator(".cm-line", { hasText: "特殊维度" }).first(), "render-codeblock-yaml-line.png");

  // yaml：键取属性色、注释取注释色。修前这一行的 span 是 `cm-lp-tok-literal` / `cm-lp-tok-comment`
  //（键与数字、布尔同色 = 整块只出一种颜色），本断言即那条旧口径的反转。
  await scrollToLine(page, "特殊维度");
  expect(await coloredTokens(page, "特殊维度", "name")).toEqual([
    { text: "name", color: COLOR.note },
    { text: "# 特殊维度：values 来自当月 _monthly.md", color: COLOR.dim },
  ]);

  // toml：表头 `[[hooks]]` 与布尔 `true` 取字面量色——`atom` 在 toml mode 有三处语义
  //（表头 / 布尔 / 日期），tokenTable 按 token 名映射、分不开，故本 change 明确不改 toml。
  await scrollToLine(page, "[[hooks]]");
  expect(await coloredTokens(page, "[[hooks]]", "[[hooks]]")).toEqual([{ text: "[[hooks]]", color: COLOR.warning }]);
  expect(await coloredTokens(page, "enabled = true", "enabled")).toEqual([
    { text: "enabled", color: COLOR.note },
    { text: "true", color: COLOR.warning },
  ]);
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
