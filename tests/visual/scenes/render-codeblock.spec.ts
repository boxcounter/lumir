import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { readFileSync } from "node:fs";
import { configGets, stubTauri } from "./tauri-stub";
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

// ---------------------------------------------------------------------------
// M180（change line-wrap-options）：折行口径——文件级默认折行、代码块默认不折行。
// 四条组合、「一元素一条规则」与「文字可达」在这层守（chromium 的 getComputedStyle + 滚动几何）；
// 真机侧另有一套（scripts/acceptance/scenarios/*wrap*），分工见那边的场景说明。
// 判定用**同一份文档里的短行**做单行基准，不写死行高：字体与行高来自排版基线变量，
// 写死 28px 这类数字会在下次改基线时静默失配（REVIEW.md 第 1、8 条）。
// ---------------------------------------------------------------------------

const WRAP_SOURCE = readFileSync(new URL("../fixtures/render-codeblock/wrap.md", import.meta.url), "utf8");
const PROSE_NEEDLE = "超长正文行";
const CODE_NEEDLE = "CODE-END-MARK";
/** [keys] 把两条默认不绑键的折行命令绑到默认表里的两个空位（⌃J / ⌃K）。本版界面上没有别的
 *  触发路径（不做 M-x，见 spec 的已知边界），绑键因此既是场景的入口，也是 spec 里
 *  「配置绑定后真的能触发」那条 scenario 的验证形态。 */
const WRAP_KEYS = { "Ctrl-j": "view.toggle-line-wrap", "Ctrl-k": "view.toggle-code-block-wrap" };

/** 装载折行 fixture（md 模式 + 两条命令已绑键），并等配置覆盖真的挂上分发器。
 *
 *  `editorConfig` 非空时在桩**之后**再包一层 `config_get`（见 patchEditorConfig）：
 *  `stubTauri` 的 config_get 只出 `editor.mode`，而「配置项真的被消费」这条接线
 *  （main.ts 的 `editor.setWrap`）需要能构造启动口径的四种取值。 */
async function openWrap(page: Page, editorConfig?: Record<string, unknown>): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "wrap.md", kind: "file", size: WRAP_SOURCE.length, mtime_ms: 0 }],
    files: { "wrap.md": WRAP_SOURCE },
    config: { keys: WRAP_KEYS },
  });
  if (editorConfig !== undefined) await patchEditorConfig(page, editorConfig);
  await page.goto("/");
  await page.locator('.ft-row[title="wrap.md"]').click();
  await expect(page.locator(".masthead-file")).toHaveText("wrap.md");
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

/** 给桩的 `config_get` 应答补上 editor 表里的折行两项（启动口径的来源）。
 *
 *  为什么不改 `tests/visual/scenes/tauri-stub.ts`：它的 `config` 形状由套件里所有场景共用，
 *  为一个场景放宽形状会把别的场景一并拖进来；而 `addInitScript` 的注册顺序保证这里包到的
 *  一定是桩刚装好的那份 invoke（后注册的脚本后跑）。
 */
async function patchEditorConfig(page: Page, editor: Record<string, unknown>): Promise<void> {
  await page.addInitScript((extra) => {
    type Invoke = (cmd: string, args: unknown) => Promise<unknown>;
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__;
    if (internals?.invoke === undefined) throw new Error("patchEditorConfig 必须在 stubTauri 之后调用");
    const original = internals.invoke.bind(internals);
    internals.invoke = async (cmd, args) => {
      const result = await original(cmd, args);
      if (cmd !== "config_get" || result === null || typeof result !== "object") return result;
      const snapshot = result as { config?: { editor?: Record<string, unknown> } };
      if (snapshot.config === undefined) return result;
      return {
        ...(result as object),
        config: { ...snapshot.config, editor: { ...snapshot.config.editor, ...extra } },
      };
    };
  }, editor);
}

/** 某行的折行读数：计算 white-space / overflow-wrap + 行盒高度。 */
async function lineWrap(page: Page, needle: string) {
  return page.locator(".cm-line", { hasText: needle }).first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, height: el.getBoundingClientRect().height };
  });
}

/** 某行的行盒高度（拿来做单行基准）。 */
async function rowHeight(page: Page, needle: string): Promise<number> {
  return page.locator(".cm-line", { hasText: needle }).first().evaluate((el) => el.getBoundingClientRect().height);
}

/** 视觉行数：行盒高度 ÷ 同一文档里短行的行盒高度。 */
function visualLines(height: number, unit: number): number {
  return Math.round(height / unit);
}

/** 折行 fixture 里含超长代码行那个容器的读数。 */
async function codeContainer(page: Page) {
  return page.locator(".cm-lp-codeblock-scroll", { hasText: CODE_NEEDLE }).first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: style.overflowX,
      background: style.backgroundColor,
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label"),
      tabindex: el.getAttribute("tabindex"),
    };
  });
}

/** 把一个块级横滚容器滚到最右，并读「正文文本右端距容器右缘还有多远」。
 *  形参类型走 `ReturnType<Page["locator"]>`（= Playwright 的 Locator）：本文件只从
 *  `@playwright/test` 引了 Page 一个类型，为此再引一个类型名不值当。 */
async function scrollToEnd(el: ReturnType<Page["locator"]>) {
  return el.evaluate((node) => {
    const box = node as HTMLElement;
    box.scrollLeft = box.scrollWidth;
    const line = [...box.querySelectorAll<HTMLElement>(".cm-line")].find(
      (item) => (item.textContent ?? "").includes("CODE-END-MARK"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(line);
    const edge = box.getBoundingClientRect();
    const probe = document.elementFromPoint(edge.right - 4, edge.top + 4);
    return {
      scrollLeft: box.scrollLeft,
      maxScroll: box.scrollWidth - box.clientWidth,
      textRight: range.getBoundingClientRect().right,
      edgeRight: edge.right,
      probeBackground: probe instanceof HTMLElement ? getComputedStyle(probe).backgroundColor : "",
    };
  });
}

test("默认口径：代码块不折行（块内可滚、行尾可达）、正文行折行——一元素一条规则", async ({ page }) => {
  await openWrap(page);
  await scrollToLine(page, CODE_NEEDLE);

  // 代码块行：white-space 被内容级 class 压回 pre、overflow-wrap 回 normal
  //（只改 white-space 不够——overflow-wrap 是继承属性，不压回 normal 长行仍会被切碎）
  const code = await lineWrap(page, CODE_NEEDLE);
  expect(code.whiteSpace).toBe("pre");
  expect(code.overflowWrap).toBe("normal");
  // 正文行：仍继承 .cm-content 的 break-spaces——代码块那一层不改它
  const prose = await lineWrap(page, PROSE_NEEDLE);
  expect(prose.whiteSpace).toBe("break-spaces");

  // 视觉行数：代码块恰好一行、正文折成多行
  expect(visualLines(code.height, await rowHeight(page, "short code line")), "超长代码行不得折出第二行").toBe(1);
  expect(visualLines(prose.height, await rowHeight(page, "正文段落")), "超长正文行应在栏内折行").toBeGreaterThan(2);

  // 容器：存在、可聚焦、带读屏名、横滚（不是裁切）
  const box = await codeContainer(page);
  expect(box.role).toBe("region");
  expect(box.label).toBe("Markdown 代码块 1");
  expect(box.tabindex).toBe("0");
  expect(box.overflowX).toBe("auto");
  expect(box.scrollWidth, "超长代码行必须在容器内溢出（否则本场景没有区分度）").toBeGreaterThan(box.clientWidth);

  // 文字可达底线（spec：「MUST NOT 出现文字被裁掉且无法到达」）：滚到最右后行尾进可视区
  const end = await scrollToEnd(page.locator(".cm-lp-codeblock-scroll", { hasText: CODE_NEEDLE }).first());
  expect(end.scrollLeft).toBeGreaterThan(0);
  expect(end.scrollLeft).toBe(end.maxScroll);
  expect(end.textRight - end.edgeRight, "行尾必须能滚进可视区").toBeLessThanOrEqual(1);
  // 元素级基线钉住「滚到最右」的现场（行尾可见 + 容器底板铺满）。整页基线不在这里重复拍：
  // 「四种组合」那组按口径各拍一张，其中默认口径那张与这里的整页状态逐字节相同——
  // 同一状态两张基线是空占（REVIEW.md 第 1 条「看着有覆盖、其实不判任何东西」的同族形态）。
  await expectScreenshot(
    page.locator(".cm-lp-codeblock-scroll", { hasText: CODE_NEEDLE }).first(),
    "wrap-codeblock-scrolled-to-end.png",
  );
});

test("代码块容器键盘可达：Tab 聚焦 → → 120px → End 最右 → Home 最左 → Escape 交还焦点", async ({ page }) => {
  await openWrap(page);
  await scrollToLine(page, CODE_NEEDLE);
  const container = page.locator(".cm-lp-codeblock-scroll", { hasText: CODE_NEEDLE }).first();
  // 用 focus() 而非 click()：点击走 CM 的 mousedown 会把焦点收回 contentDOM，而「容器自身
  // 持有焦点」正是 when 条件的判据（与 m131-keymap-behavior 的表格场景同款口径）。
  await container.evaluate((el) => (el as HTMLElement).focus());
  expect(await page.evaluate(() => document.activeElement?.className ?? "")).toContain("cm-lp-codeblock-scroll");

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  expect(await container.evaluate((el) => el.scrollLeft), "→ 步进 120px（与表格容器同一口径）").toBe(120);
  await page.keyboard.press("End");
  await page.waitForTimeout(60);
  expect(await container.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(120);
  expect(await container.evaluate((el) => el.scrollLeft), "End 滚到最右").toBe(
    await container.evaluate((el) => el.scrollWidth - el.clientWidth),
  );
  await page.keyboard.press("Home");
  await page.waitForTimeout(60);
  expect(await container.evaluate((el) => el.scrollLeft), "Home 回到最左").toBe(0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(60);
  expect(
    await page.evaluate(() => document.querySelector(".cm-content")?.contains(document.activeElement) ?? false),
    "Escape 把焦点交还编辑器",
  ).toBe(true);
  // 全程文档逐字节不变（只读操作不得改文档）
  expect(await readDocument(page)).toBe(WRAP_SOURCE);
});

test("光标落在代码块文本里时方向键仍归 caret（容器没持有焦点就不接管）", async ({ page }) => {
  await openWrap(page);
  await scrollToLine(page, CODE_NEEDLE);
  // 点进代码块文本：焦点回到编辑器内容区，容器不是活动元素
  await page.locator(".cm-line", { hasText: CODE_NEEDLE }).first().click();
  await page.waitForTimeout(60);
  expect(
    await page.evaluate(() => document.activeElement?.className ?? ""),
    "点击后活动元素应是编辑器内容区，不是容器（否则本场景验不到收紧后的判据）",
  ).toContain("cm-content");
  const before = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return view.state.selection.main.head;
  });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  const after = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return view.state.selection.main.head;
  });
  expect(after, "⌃ 光标应右移一个字符").toBeGreaterThan(before);
  expect(await page.locator(".cm-lp-codeblock-scroll", { hasText: CODE_NEEDLE }).first().evaluate((el) => el.scrollLeft)).toBe(0);
});

test("四种组合逐格可判：两个轴正交，代码块折行时不装容器", async ({ page }) => {
  await openWrap(page);
  await scrollToLine(page, CODE_NEEDLE);
  const codeUnit = await rowHeight(page, "short code line");
  const proseUnit = await rowHeight(page, "正文段落");

  /** 当前状态的读数：两行的 white-space、容器个数、两行的视觉行数。 */
  const read = async () => {
    const code = await lineWrap(page, CODE_NEEDLE);
    const prose = await lineWrap(page, PROSE_NEEDLE);
    return {
      codeWhiteSpace: code.whiteSpace,
      proseWhiteSpace: prose.whiteSpace,
      containers: await page.locator(".cm-lp-codeblock-scroll").count(),
      codeLines: visualLines(code.height, codeUnit),
      proseLines: visualLines(prose.height, proseUnit),
    };
  };
  const toggle = async (key: string) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(80);
  };

  // ① 配置缺省：文件折行 + 代码块不折行（两处代码块各一个容器）
  let now = await read();
  expect(now).toMatchObject({ codeWhiteSpace: "pre", proseWhiteSpace: "break-spaces" });
  expect(now.containers, "代码块不折行时应有横滚容器").toBeGreaterThan(0);
  expect(now.codeLines).toBe(1);
  expect(now.proseLines).toBeGreaterThan(1);
  await expectScreenshot(page, "wrap-combo-1-file-fold-block-nowrap.png");

  // ② 关掉文件级折行：正文行压回 pre、代码块口径不变（一元素一条规则），编辑区可横向到达
  await toggle("Control+j");
  now = await read();
  expect(now).toMatchObject({ codeWhiteSpace: "pre", proseWhiteSpace: "pre" });
  expect(now.containers, "文件级折行开关不改代码块那一条规则").toBeGreaterThan(0);
  expect(now.proseLines, "关掉文件级折行后超长正文行必须是一行").toBe(1);
  const scroller = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".cm-scroller")!;
    el.scrollLeft = el.scrollWidth;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft };
  });
  expect(scroller.scrollWidth, "超长正文行必须让编辑区可横向滚动（不是裁切）").toBeGreaterThan(scroller.clientWidth);
  expect(scroller.scrollLeft).toBe(scroller.scrollWidth - scroller.clientWidth);
  await page.evaluate(() => {
    document.querySelector<HTMLElement>(".cm-scroller")!.scrollLeft = 0;
  });
  await page.waitForTimeout(60);
  await expectScreenshot(page, "wrap-combo-2-file-nowrap-block-nowrap.png");

  // ③ 打开代码块折行（文件级仍不折）：代码块变折行、横滚容器卸掉
  await toggle("Control+k");
  now = await read();
  expect(now).toMatchObject({ codeWhiteSpace: "break-spaces", proseWhiteSpace: "pre", containers: 0 });
  expect(now.codeLines, "代码块折行后超长代码行应折出多行").toBeGreaterThan(1);
  await expectScreenshot(page, "wrap-combo-3-file-nowrap-block-wrap.png");

  // ④ 文件级也折回来：两轴都折
  await toggle("Control+j");
  now = await read();
  expect(now).toMatchObject({ codeWhiteSpace: "break-spaces", proseWhiteSpace: "break-spaces", containers: 0 });
  expect(now.proseLines).toBeGreaterThan(1);
  await expectScreenshot(page, "wrap-combo-4-both-wrap.png");
});

test("容器不改变纵向节奏；滚到右端不露白底（底板取自 --bg-2）", async ({ page }) => {
  // 两个 fixture 一起挂：纵向节奏要用**代码行都短于栏宽**的文档比（长行在折行打开时必然变高，
  // 那是折行本身的变化，不是容器的副作用）；底板要用真的会溢出的长行才能滚起来。
  await stubTauri(page, {
    entries: [
      { path: "languages.md", kind: "file", size: source.length, mtime_ms: 0 },
      { path: "wrap.md", kind: "file", size: WRAP_SOURCE.length, mtime_ms: 0 },
    ],
    files: { "languages.md": source, "wrap.md": WRAP_SOURCE },
    config: { keys: WRAP_KEYS },
  });
  await page.goto("/");
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.locator('.ft-row[title="languages.md"]').click();
  await expect(page.locator(".cm-lp-tok-keyword").first()).toBeVisible();
  await page.waitForTimeout(80);

  /** 某行行盒顶端的页面坐标（比容器装卸前后的纵向位置）。 */
  const topOf = async (needle: string) =>
    page.locator(".cm-line", { hasText: needle }).first().evaluate((el) => el.getBoundingClientRect().top);

  await scrollToLine(page, "[[hooks]]");
  const before = await topOf("[[hooks]]");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(80);
  expect(await page.locator(".cm-lp-codeblock-scroll").count(), "代码块折行时容器应卸掉").toBe(0);
  expect(Math.abs((await topOf("[[hooks]]")) - before), "卸掉容器不得挪动其下方内容").toBeLessThanOrEqual(0.5);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(80);
  expect(await page.locator(".cm-lp-codeblock-scroll").count(), "折回不折行时容器应装回").toBeGreaterThan(0);
  expect(Math.abs((await topOf("[[hooks]]")) - before), "装回容器同样不得挪动其下方内容").toBeLessThanOrEqual(0.5);

  // 底板：滚到最右后，容器右缘那一列的计算底色必须与代码行同色（滚出去的行盒不再覆盖那里）
  await page.locator('.ft-row[title="wrap.md"]').click();
  await expect(page.locator(".masthead-file")).toHaveText("wrap.md");
  await scrollToLine(page, CODE_NEEDLE);
  const box = await codeContainer(page);
  const end = await scrollToEnd(page.locator(".cm-lp-codeblock-scroll", { hasText: CODE_NEEDLE }).first());
  expect(end.scrollLeft, "底板断言只有在真的滚起来之后才有意义").toBeGreaterThan(0);
  expect(box.background, "容器底板与代码行同色（同一个 --bg-2），不得透明").toBe(
    await page
      .locator(".cm-line", { hasText: CODE_NEEDLE })
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  );
  expect(box.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(end.probeBackground, "容器右缘那一列不得露出无底色的空白").toBe(box.background);
});

test("启动口径来自配置：line_wrap=false 正文不折、code_block_wrap=true 不装容器", async ({ page }) => {
  // 这一条守的是「配置项真的被消费」那条接线——全仓唯一的 config_get 消费点是 main.ts 的
  // editor.setWrap；桩外层补上 editor 的两项，等价于用户在 config.json 里写死它们。
  await openWrap(page, { line_wrap: false, code_block_wrap: false });
  await scrollToLine(page, CODE_NEEDLE);
  const folded = await lineWrap(page, PROSE_NEEDLE);
  expect(folded.whiteSpace, "配置 line_wrap=false 时正文行不折行").toBe("pre");
  expect(visualLines(folded.height, await rowHeight(page, "正文段落")), "正文行应恰好一行").toBe(1);
  // 文件级开关不改代码块那一条规则：仍不折行、容器仍在
  expect((await lineWrap(page, CODE_NEEDLE)).whiteSpace).toBe("pre");
  expect(await page.locator(".cm-lp-codeblock-scroll", { hasText: CODE_NEEDLE }).count()).toBe(1);

  // 反过来：配置 code_block_wrap=true 时代码块折行、容器不装（文件级仍是默认折行）
  await openWrap(page, { line_wrap: true, code_block_wrap: true });
  await scrollToLine(page, CODE_NEEDLE);
  const wrapped = await lineWrap(page, CODE_NEEDLE);
  expect(wrapped.whiteSpace, "配置 code_block_wrap=true 时代码块折行").toBe("break-spaces");
  expect(visualLines(wrapped.height, await rowHeight(page, "short code line"))).toBeGreaterThan(1);
  expect(await page.locator(".cm-lp-codeblock-scroll").count(), "折行打开时 MUST NOT 装横滚容器").toBe(0);
  expect((await lineWrap(page, PROSE_NEEDLE)).whiteSpace, "文件级口径不受代码块开关影响").toBe("break-spaces");
});

test("嵌套语境：引用块内的围栏代码块同样承载局部容器，不退化成整窗横滚", async ({ page }) => {
  await openWrap(page);
  await scrollToLine(page, "NESTED-END-MARK");
  const nested = page.locator(".cm-lp-codeblock-scroll", { hasText: "NESTED-END-MARK" });
  await expect(nested, "引用块内的围栏代码块也应有自己的横滚容器").toHaveCount(1);
  const box = await nested.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    lines: [...el.querySelectorAll<HTMLElement>(".cm-line")].map((line) => line.className).join("|"),
  }));
  expect(box.lines, "容器里应是引用块的那几行（说明局部容器真的落在嵌套语境里）").toContain("cm-lp-quote-line");
  expect(box.scrollWidth, "超长嵌套代码行应在容器内溢出").toBeGreaterThan(box.clientWidth);

  // 「局部容器」的判据：溢出被容器吃掉，编辑区不出现整窗横滚（design 明确否决的形态）。
  // 本 fixture 里唯一可能撑宽编辑区的东西就是这两处超长代码行（正文行折行），故等式成立即可判。
  const scroller = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(".cm-scroller")!;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(scroller.scrollWidth, "嵌套代码块的溢出 MUST NOT 变成整窗横滚").toBe(scroller.clientWidth);

  // 文字可达：滚到右端后行尾进可视区
  const end = await nested.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    const line = [...el.querySelectorAll<HTMLElement>(".cm-line")].find((item) =>
      (item.textContent ?? "").includes("NESTED-END-MARK"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(line);
    return { scrollLeft: el.scrollLeft, gap: range.getBoundingClientRect().right - el.getBoundingClientRect().right };
  });
  expect(end.scrollLeft).toBeGreaterThan(0);
  expect(end.gap, "嵌套容器的行尾同样必须能滚进可视区").toBeLessThanOrEqual(1);
});

test("应用级口径（D1）：翻转作用于全部会话，新标签页取当前应用态", async ({ page }) => {
  // 这是本 change 与提案初稿的关键差异所在（D1 把标签页级改成应用级），因此必须有断言面：
  // 单一会话上的翻转只是「值变了」，应用级还要求**全部会话一致 + 新会话取当前值**。
  await stubTauri(page, {
    entries: [
      { path: "wrap.md", kind: "file", size: WRAP_SOURCE.length, mtime_ms: 0 },
      { path: "wrap2.md", kind: "file", size: WRAP_SOURCE.length, mtime_ms: 0 },
    ],
    files: { "wrap.md": WRAP_SOURCE, "wrap2.md": WRAP_SOURCE },
    config: { keys: WRAP_KEYS },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="wrap.md"]').click();
  await expect(page.locator(".masthead-file")).toHaveText("wrap.md");
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);

  /** 当前标签里代码块行的口径（每次切完标签重新取）。 */
  const codeWhiteSpace = async () => (await lineWrap(page, CODE_NEEDLE)).whiteSpace;

  await scrollToLine(page, CODE_NEEDLE);
  expect(await codeWhiteSpace(), "起始是配置缺省口径").toBe("pre");

  // 在标签 A 上翻转代码块口径
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(80);
  expect(await codeWhiteSpace()).toBe("break-spaces");

  // 让 A 成为固定标签（首次输入即固定，M149 口径）：第二个文件因此另开标签而不是替换预览标签
  await page.locator(".cm-content").click();
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: 0 } });
  });
  await page.keyboard.type("x");
  await expect(page.locator(".tab")).toHaveCount(1);
  await page.locator('.ft-row[title="wrap2.md"]').click();
  await expect(page.locator(".masthead-file")).toHaveText("wrap2.md");
  await expect(page.locator(".tab")).toHaveCount(2);

  // 新标签页取**当前应用态**（D1：不是配置默认）
  await scrollToLine(page, CODE_NEEDLE);
  expect(await codeWhiteSpace(), "新标签页必须取当前应用态，而不是退回配置默认").toBe("break-spaces");

  // 切回标签 A：口径仍是翻转后的值（切标签不改变折行口径）
  await page.locator(".tab").first().click();
  await expect(page.locator(".masthead-file")).toHaveText("wrap.md");
  await scrollToLine(page, CODE_NEEDLE);
  expect(await codeWhiteSpace(), "切标签 MUST NOT 改变折行口径").toBe("break-spaces");
});
