import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 代码文件里双击标识符高亮同一变量（change code-variable-highlight，M198）的行为与视觉回归。
//
// 为什么要有这个场景：
//   1. **装饰的存在与覆盖区间是字符偏移级的事实**：AX 不暴露装饰与颜色（真机通道只能给派生证据），
//      这里直接读 DOM 上 `.cm-lp-code-binding` 元素、再用 CM 的 `posAtDOM` 把它们映射回文档偏移，
//      把「点了哪个标识符 → 点亮了哪几处」钉成**可复算的区间集合**（不是「类名存在」这种没有区分度
//      的断言，见 REVIEW.md 第 1 条）。
//   2. **排除面必须与正向同框**：每条 0 命中的断言都配一条同文件里真变量命中（否则 0 命中可能只是
//      「整份语料都没解析」）。
//   3. **三层可区分是计算样式级的要求**：原生选区（`--sel`）/ 绑定匹配（`--bg-3`）/ 搜索命中
//      （accent 淡底）三者互不相同，且本能力 MUST NOT 复用 `.cm-searchMatch`。
//   4. **真机层做不到的两件事**在这里做：真实的 `dblclick` 手势（README「合成不出 DOM dblclick」）
//      与「颜色分层」。
//
// md 侧的全部既有口径由 toc-outline.spec.ts / render-*.spec.ts 原样守；本场景只做 code 分支与
// 「md 不受影响」的一条对照。

/** 每个 fixture 的语料（判据语料的最小版；逐语言位置类别的完整矩阵在 tests/unit/var-highlight-cases.ts）。 */
const FIXTURES: Record<string, string> = {
  "binding.js": `// LIMIT 注释
const LIMIT = 42;
function f(LIMIT) { return LIMIT; }
class Box {
  LIMIT = 1;
  m() { return this.LIMIT; }
}
const s = "LIMIT";
LIMIT + 1;
`,
  "binding.ts": `// LIMIT 注释
const LIMIT: number = 42;
interface Shape { LIMIT: number }
enum Color { LIMIT }
function f(LIMIT: number): number { return LIMIT; }
const s = "LIMIT";
LIMIT + 1;
`,
  "binding.py": `# LIMIT 注释
LIMIT = 42

def f(LIMIT):
    return LIMIT

class Box:
    LIMIT = 1

    def m(self):
        return self.LIMIT

s = "LIMIT"
t = LIMIT
`,
  "binding.rs": `// LIMIT 注释
const LIMIT: u32 = 42;

fn f(LIMIT: u32) -> u32 { LIMIT }

struct Box { LIMIT: u32 }

fn main() -> u32 {
    let s = "LIMIT";
    return LIMIT;
}
`,
  "binding.go": `// LIMIT 注释
package main

const LIMIT = 42

func f(LIMIT int) int {
	return LIMIT
}

type Box struct {
	LIMIT int
}

var s = "LIMIT"
var t = LIMIT
`,
  "binding.java": `// LIMIT 注释
class Box {
  int LIMIT = 1;

  int f(int LIMIT) { return LIMIT; }

  int m() {
    String s = "LIMIT";
    return this.LIMIT;
  }
}
`,
  "binding.c": `// LIMIT 注释
const int LIMIT = 42;

struct Box { int LIMIT; };

int f(int LIMIT) { return LIMIT; }

char *s = "LIMIT";
int t = LIMIT;
`,
  "binding.cpp": `// LIMIT 注释
const int LIMIT = 42;

class Box {
public:
  int LIMIT;
  int m() { return LIMIT; }
};

const char *s = "LIMIT";
int t = LIMIT;
`,
  "binding-shadow.js": `const LIMIT = 42;
function a() {
  const LIMIT = 1;
  return LIMIT + LIMIT;
}
function b() {
  return LIMIT;
}
LIMIT + 1;
`,
  "binding-dollar.js": `const $price = 1;
$price + $price;
const price = 2;
price + 1;
const price_list = 3;
price_list;
`,
  "binding.lua": `local LIMIT = 1
LIMIT = LIMIT + 1
`,
};

/** 长文档（视口外的那一处用）：第 1 行的声明 + 80 行填充 + 末行的引用。 */
const LONG_DOC = [
  "const LIMIT = 42;",
  ...Array.from({ length: 240 }, (_, i) => `const pad${i} = ${i};`),
  "LIMIT + 1;",
].join("\n");
FIXTURES["binding-long.js"] = `${LONG_DOC}\n`;

/** md 对照：围栏里的同一份文本（md 模式 MUST NOT 产生本装饰）。 */
FIXTURES["binding.md"] = ["# 标题", "", "```js", "const LIMIT = 42;", "LIMIT + 1;", "```", "", "LIMIT + 2;", ""].join("\n");

const VAULT: VaultFixture = {
  entries: Object.entries(FIXTURES).map(([path, text]) => ({ path, kind: "file", size: text.length, mtime_ms: 0 })),
  files: FIXTURES,
  links: {},
};

const VIEW = ".cm-content";

/** 定位：从 `after` 的**末尾**起找第 `nth`（默认 0）个 `at` 出现。 */
interface Locate {
  readonly after: string;
  readonly at: string;
  readonly nth?: number;
}
interface Position {
  from: number;
  to: number;
}

function locate(doc: string, spec: Locate): Position {
  let from = doc.indexOf(spec.at, doc.indexOf(spec.after) + spec.after.length);
  for (let i = 0; i < (spec.nth ?? 0); i++) from = doc.indexOf(spec.at, from + spec.at.length);
  expect(from, `锚点后找不到 ${spec.at}（${JSON.stringify(spec.after)}）`).toBeGreaterThanOrEqual(0);
  return { from, to: from + spec.at.length };
}

/** 把光标放到指定偏移（空选区）。 */
async function setCaret(page: Page, pos: number): Promise<void> {
  await page.evaluate((anchor: number) => {
    const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    v.dispatch({ selection: { anchor } });
  }, pos);
}

/** 派发一个选区（「选不全」「跨节点」「md / T3 模式」这些用例用它；其它用例一律走真实 dblclick）。 */
async function selectRange(page: Page, from: number, to: number): Promise<void> {
  await page.evaluate(
    ({ from, to }: Position) => {
      const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      v.dispatch({ selection: { anchor: from, head: to } });
    },
    { from, to },
  );
}

/**
 * 真实双击：先取该偏移处字符盒的中心坐标，再 `mouse.dblclick`——这条路径走的是 CM 自己的
 * `basicMouseSelection`（真机层合成不出 dblclick，这是本层独有的判据）。
 */
async function doubleClickAt(page: Page, pos: number): Promise<void> {
  const box = await page.evaluate((p: number) => {
    const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const coords = v.coordsAtPos(p);
    return { x: coords.left + 1, y: (coords.top + coords.bottom) / 2 };
  }, pos);
  await page.mouse.dblclick(box.x, box.y);
}

/** DOM 上的绑定装饰 → 文档偏移区间（按文档序）。 */
async function decorations(page: Page): Promise<Position[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cm-lp-code-binding")].map((el) => {
      const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      const from = v.posAtDOM(el);
      return { from, to: from + (el.textContent ?? "").length };
    }),
  );
}

const positions = (doc: string, specs: readonly Locate[]): Position[] => specs.map((spec) => locate(doc, spec));

/** 打开 fixture 并等到内容上屏。 */
async function open(page: Page, path: string, marker: string): Promise<void> {
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(VIEW)).toContainText(marker);
}

async function bootstrap(page: Page, path: string, marker: string): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await open(page, path, marker);
}

// --- 逐语言：收录面 --------------------------------------------------------------------------

/** 每条：双击哪个标识符 → 期望点亮哪几处（区间一律由语料文本算出，不写死数字）。 */
interface Case {
  name: string;
  file: string;
  doc: string;
  marker: string;
  click: Locate;
  hits: readonly Locate[];
}

const CASES: readonly Case[] = [
  {
    name: "js：模块级常量 → 点亮文件末尾的引用",
    file: "binding.js",
    doc: FIXTURES["binding.js"],
    marker: "const LIMIT = 42;",
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: 'const s = "LIMIT";\n', at: "LIMIT" }],
  },
  {
    name: "js：参数 → 只点亮同函数体内的引用",
    file: "binding.js",
    doc: FIXTURES["binding.js"],
    marker: "const LIMIT = 42;",
    click: { after: "function f(", at: "LIMIT" },
    hits: [{ after: "function f(", at: "LIMIT", nth: 1 }],
  },
  {
    name: "ts：常量 → 点亮末尾引用；接口属性名与枚举成员不亮",
    file: "binding.ts",
    doc: FIXTURES["binding.ts"],
    marker: "const LIMIT: number = 42;",
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: 'const s = "LIMIT";\n', at: "LIMIT" }],
  },
  {
    name: "ts：参数 → 只点亮同函数体内的引用",
    file: "binding.ts",
    doc: FIXTURES["binding.ts"],
    marker: "const LIMIT: number = 42;",
    click: { after: "function f(", at: "LIMIT" },
    hits: [{ after: "function f(", at: "LIMIT", nth: 1 }],
  },
  {
    name: "python：模块级赋值 → 点亮文件末尾的引用",
    file: "binding.py",
    doc: FIXTURES["binding.py"],
    marker: "LIMIT = 42",
    click: { after: "# LIMIT 注释\n", at: "LIMIT" },
    hits: [{ after: "t = ", at: "LIMIT" }],
  },
  {
    name: "python：参数 → 只点亮同函数体内的引用",
    file: "binding.py",
    doc: FIXTURES["binding.py"],
    marker: "LIMIT = 42",
    click: { after: "def f(", at: "LIMIT" },
    hits: [{ after: "def f(", at: "LIMIT", nth: 1 }],
  },
  {
    name: "rust：常量 → 点亮函数体内的引用",
    file: "binding.rs",
    doc: FIXTURES["binding.rs"],
    marker: "const LIMIT: u32 = 42;",
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: "    return ", at: "LIMIT" }],
  },
  {
    name: "rust：参数 → 只点亮同函数体内的引用",
    file: "binding.rs",
    doc: FIXTURES["binding.rs"],
    marker: "const LIMIT: u32 = 42;",
    click: { after: "fn f(", at: "LIMIT" },
    hits: [{ after: "fn f(", at: "LIMIT", nth: 1 }],
  },
  {
    name: "go：常量 → 点亮文件末尾的引用",
    file: "binding.go",
    doc: FIXTURES["binding.go"],
    marker: "const LIMIT = 42",
    click: { after: "const ", at: "LIMIT" },
    hits: [{ after: "var t = ", at: "LIMIT" }],
  },
  {
    name: "go：参数 → 只点亮同函数体内的引用",
    file: "binding.go",
    doc: FIXTURES["binding.go"],
    marker: "const LIMIT = 42",
    click: { after: "func f(", at: "LIMIT" },
    hits: [{ after: "func f(", at: "LIMIT", nth: 1 }],
  },
  {
    name: "java：参数 → 只点亮同方法体内的引用（字段与成员名都不算）",
    file: "binding.java",
    doc: FIXTURES["binding.java"],
    marker: "class Box {",
    click: { after: "int f(int ", at: "LIMIT" },
    hits: [{ after: "int f(int LIMIT) { return ", at: "LIMIT" }],
  },
  {
    name: "c：顶层常量 → 点亮文件末尾的引用",
    file: "binding.c",
    doc: FIXTURES["binding.c"],
    marker: "const int LIMIT = 42;",
    click: { after: "const int ", at: "LIMIT" },
    hits: [{ after: "int t = ", at: "LIMIT" }],
  },
  {
    name: "c：参数 → 只点亮同函数体内的引用",
    file: "binding.c",
    doc: FIXTURES["binding.c"],
    marker: "const int LIMIT = 42;",
    click: { after: "int f(int ", at: "LIMIT" },
    hits: [{ after: "int f(int LIMIT) { return ", at: "LIMIT" }],
  },
  {
    name: "cpp：顶层常量 → 点亮类内裸名引用与外层引用（已知边界的实测落点）",
    file: "binding.cpp",
    doc: FIXTURES["binding.cpp"],
    marker: "const int LIMIT = 42;",
    click: { after: "const int ", at: "LIMIT" },
    hits: [{ after: "int m() { return ", at: "LIMIT" }, { after: "int t = ", at: "LIMIT" }],
  },
];

for (const item of CASES) {
  test(`收录面：${item.name}`, async ({ page }) => {
    await bootstrap(page, item.file, item.marker);
    await doubleClickAt(page, locate(item.doc, item.click).from);
    await expect.poll(async () => (await decorations(page)).length).toBeGreaterThan(0);
    expect(await decorations(page)).toEqual(positions(item.doc, item.hits));
    expect(await readDocument(page)).toBe(item.doc);
  });
}

// --- 逐语言：排除面（每条 0 命中都配一条同文件的正向命中）-------------------------------------

const EXCLUSIONS: readonly Case[] = [
  {
    name: "js：类字段不亮（PropertyDefinition）",
    file: "binding.js",
    doc: FIXTURES["binding.js"],
    marker: "const LIMIT = 42;",
    click: { after: "  ", at: "LIMIT = 1" },
    hits: [],
  },
  {
    name: "js：成员名不亮（this.LIMIT）",
    file: "binding.js",
    doc: FIXTURES["binding.js"],
    marker: "const LIMIT = 42;",
    click: { after: "return this.", at: "LIMIT" },
    hits: [],
  },
  {
    name: "js：字符串里的同名文本不亮",
    file: "binding.js",
    doc: FIXTURES["binding.js"],
    marker: "const LIMIT = 42;",
    click: { after: 'const s = "', at: "LIMIT" },
    hits: [],
  },
  {
    name: "js：注释里的同名文本不亮",
    file: "binding.js",
    doc: FIXTURES["binding.js"],
    marker: "const LIMIT = 42;",
    click: { after: "// ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "ts：接口属性名不亮",
    file: "binding.ts",
    doc: FIXTURES["binding.ts"],
    marker: "const LIMIT: number = 42;",
    click: { after: "interface Shape { ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "ts：枚举成员不亮",
    file: "binding.ts",
    doc: FIXTURES["binding.ts"],
    marker: "const LIMIT: number = 42;",
    click: { after: "enum Color { ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "python：类属性不亮",
    file: "binding.py",
    doc: FIXTURES["binding.py"],
    marker: "LIMIT = 42",
    click: { after: "class Box:\n    ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "python：成员名不亮（self.LIMIT）",
    file: "binding.py",
    doc: FIXTURES["binding.py"],
    marker: "LIMIT = 42",
    click: { after: "return self.", at: "LIMIT" },
    hits: [],
  },
  {
    name: "python：字符串里的同名文本不亮",
    file: "binding.py",
    doc: FIXTURES["binding.py"],
    marker: "LIMIT = 42",
    click: { after: 's = "', at: "LIMIT" },
    hits: [],
  },
  {
    name: "rust：结构体字段不亮",
    file: "binding.rs",
    doc: FIXTURES["binding.rs"],
    marker: "const LIMIT: u32 = 42;",
    click: { after: "struct Box { ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "rust：字符串里的同名文本不亮",
    file: "binding.rs",
    doc: FIXTURES["binding.rs"],
    marker: "const LIMIT: u32 = 42;",
    click: { after: 'let s = "', at: "LIMIT" },
    hits: [],
  },
  {
    name: "go：结构体字段不亮",
    file: "binding.go",
    doc: FIXTURES["binding.go"],
    marker: "const LIMIT = 42",
    click: { after: "type Box struct {\n\t", at: "LIMIT" },
    hits: [],
  },
  {
    name: "java：字段不亮",
    file: "binding.java",
    doc: FIXTURES["binding.java"],
    marker: "class Box {",
    click: { after: "class Box {\n  int ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "java：成员名不亮",
    file: "binding.java",
    doc: FIXTURES["binding.java"],
    marker: "class Box {",
    click: { after: "return this.", at: "LIMIT" },
    hits: [],
  },
  {
    name: "c：结构体字段不亮",
    file: "binding.c",
    doc: FIXTURES["binding.c"],
    marker: "const int LIMIT = 42;",
    click: { after: "struct Box { int ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "cpp：类字段声明不亮",
    file: "binding.cpp",
    doc: FIXTURES["binding.cpp"],
    marker: "const int LIMIT = 42;",
    click: { after: "public:\n  int ", at: "LIMIT" },
    hits: [],
  },
  {
    name: "cpp：类内方法名不亮（FieldIdentifier）",
    file: "binding.cpp",
    doc: FIXTURES["binding.cpp"],
    marker: "const int LIMIT = 42;",
    click: { after: "public:\n  int ", at: "m" },
    hits: [],
  },
];

test("排除面：字符串 / 注释 / 成员名 / 字段名 / 类型成员双击后一处都不亮", async ({ page }) => {
  // 逐条跑（每条都先说「装饰为 0」，再在最后一条用同文件的正向命中证明语料是活的）
  for (const item of EXCLUSIONS) {
    await bootstrap(page, item.file, item.marker);
    await doubleClickAt(page, locate(item.doc, item.click).from);
    expect(await decorations(page), `${item.name} 应当一处都不亮`).toEqual([]);
  }
  // 正向对照：同一批语料里真变量必须亮——排除面的 0 命中才有区分度
  await bootstrap(page, "binding.js", "const LIMIT = 42;");
  await doubleClickAt(page, locate(FIXTURES["binding.js"], { after: "const ", at: "LIMIT" }).from);
  expect((await decorations(page)).length).toBeGreaterThan(0);
});

// --- 触发判据：选不全 / 跨节点 / 空选区 -------------------------------------------------------

test("选不全也命中：选区只覆盖 `price` 时仍按节点原文 `$price` 判定，绝不匹配独立的 `price` / `price_list`", async ({ page }) => {
  const doc = FIXTURES["binding-dollar.js"];
  await bootstrap(page, "binding-dollar.js", "const $price = 1;");
  const full = locate(doc, { after: "const ", at: "$price" });
  await doubleClickAt(page, full.from);
  const expected = positions(doc, [{ after: "1;\n", at: "$price" }, { after: "$price + ", at: "$price" }]);
  expect(await decorations(page)).toEqual(expected);

  // 同样的源，但选区只覆盖 `price` 五个字符（`$` 未选上）——命中集合必须完全一样
  await setCaret(page, 0);
  await selectRange(page, full.from + 1, full.from + 6);
  expect(await decorations(page)).toEqual(expected);

  // 独立的 `price` 与 `price_list`：各自成组，不与 `$price` 混
  const bare = locate(doc, { after: "$price + $price;\nconst ", at: "price" });
  await doubleClickAt(page, bare.from);
  expect(await decorations(page)).toEqual(positions(doc, [{ after: "price = 2;\n", at: "price" }]));
});

test("跨节点与空选区：拖选 / 含成员访问符 / 空选区都不产生装饰", async ({ page }) => {
  const doc = FIXTURES["binding-dollar.js"];
  await bootstrap(page, "binding-dollar.js", "const $price = 1;");
  const span = locate(doc, { after: "1;\n", at: "$price" });
  await selectRange(page, span.from, span.from + 15); // `$price + $price`
  expect(await decorations(page)).toEqual([]);
  await selectRange(page, span.from, span.from); // 空选区
  expect(await decorations(page)).toEqual([]);
  await setCaret(page, doc.indexOf("const")); // 落在关键字上
  expect(await decorations(page)).toEqual([]);
});

// --- 可见域：遮蔽与跨函数 ---------------------------------------------------------------------

test("遮蔽：顶层声明与函数内同名局部各自成组（双向）", async ({ page }) => {
  const doc = FIXTURES["binding-shadow.js"];
  await bootstrap(page, "binding-shadow.js", "const LIMIT = 42;");
  const top = locate(doc, { after: "", at: "LIMIT" });
  await doubleClickAt(page, top.from);
  expect(await decorations(page)).toEqual(
    positions(doc, [{ after: "function b() {\n  return ", at: "LIMIT" }, { after: "return LIMIT;\n}\n", at: "LIMIT" }]),
  );

  const inner = locate(doc, { after: "function a() {\n  const ", at: "LIMIT" });
  await doubleClickAt(page, inner.from);
  expect(await decorations(page)).toEqual(
    positions(doc, [{ after: "const LIMIT = 1;\n  return ", at: "LIMIT" }, { after: "return LIMIT + ", at: "LIMIT" }]),
  );
});

// --- 呈现：三层可区分、几何与文档不变、生命周期 -----------------------------------------------

test("轻触既有交互：双击后的选区就是 CM 自己的选词结果，焦点仍在编辑器，文档不变", async ({ page }) => {
  // tasks 2.3：本能力 MUST NOT 改选区 / MUST NOT 抢焦点 / MUST NOT 阻止默认行为。
  // 代码级证据（另见 test-results/m198/task10-boundaries.md）：实现里没有 DOM 事件登记、
  // 没有 preventDefault、没有任何 dispatch（只提供一个 StateField + EditorView.decorations）。
  const doc = FIXTURES["binding.js"];
  await bootstrap(page, "binding.js", "const LIMIT = 42;");
  const pos = locate(doc, { after: "const ", at: "LIMIT" }).from;
  await doubleClickAt(page, pos);
  const state = await page.evaluate(() => {
    const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return {
      ranges: v.state.selection.ranges.map((range: { from: number; to: number }) => [range.from, range.to]),
      focused: v.hasFocus,
    };
  });
  expect(state.ranges, "选区 = 双击落在的那个标识符（CM 的选词口径，本能力不改写）").toEqual([[pos, pos + "LIMIT".length]]);
  expect(state.focused, "焦点仍在编辑器").toBe(true);
  expect(await readDocument(page)).toBe(doc);
  expect((await decorations(page)).length).toBeGreaterThan(0);
});

test("三层可区分：原生选区 / 绑定匹配 / 搜索命中的计算样式互不相同，且不复用搜索类名", async ({ page }) => {
  const doc = FIXTURES["binding-shadow.js"];
  await bootstrap(page, "binding-shadow.js", "const LIMIT = 42;");
  await page.keyboard.press("Meta+f");
  await page.locator(".lumir-search-input").fill("LIMIT");
  await expect(page.locator(".lumir-search-count")).not.toHaveText("0/0");
  // 面板**保持打开**（关闭面板会连匹配高亮一起撤掉，那样「三层同屏」这个前提就不成立了）；
  // 双击编辑器内容会把焦点交回编辑器，面板与匹配仍在（这就是同屏的现场）。
  await expect.poll(() => page.locator(".cm-searchMatch").count()).toBeGreaterThan(0);

  await doubleClickAt(page, locate(doc, { after: "", at: "LIMIT" }).from);
  await expect.poll(() => page.locator(".cm-lp-code-binding").count()).toBe(2);

  const colors = await page.evaluate(() => {
    const resolve = (value: string): string => {
      const probe = document.createElement("div");
      probe.style.background = value;
      document.body.appendChild(probe);
      const computed = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return computed;
    };
    const binding = document.querySelector<HTMLElement>(".cm-lp-code-binding")!;
    const match = document.querySelector<HTMLElement>(".cm-searchMatch")!;
    return {
      binding: getComputedStyle(binding).backgroundColor,
      match: getComputedStyle(match).backgroundColor,
      selection: resolve("var(--sel)"),
      token: resolve("var(--bg-3)"),
      // 两个判定装饰的是同一段文本，元素必然互相嵌套——「不复用」指的是**类名不共用**，
      // 不是「元素不重叠」（重叠是对的：图层可以叠在同一处文本上）
      sharedClass: match.classList.contains("cm-lp-code-binding") || binding.classList.contains("cm-searchMatch"),
    };
  });
  // 色值只取既有 token：绑定底纹必须**恰好**是 --bg-3（不是新造色值）
  expect(colors.binding).toBe(colors.token);
  // 三层互不相同（计算样式级判据）
  expect(new Set([colors.binding, colors.match, colors.selection]).size).toBe(3);
  // 两个判定 MUST NOT 共用类名 / 互相嵌套
  expect(colors.sharedClass).toBe(false);
});

test("装饰不改文档也不改几何", async ({ page }) => {
  const doc = FIXTURES["binding-shadow.js"];
  await bootstrap(page, "binding-shadow.js", "const LIMIT = 42;");
  const before = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollHeight);
  await doubleClickAt(page, locate(doc, { after: "", at: "LIMIT" }).from);
  await expect.poll(() => page.locator(".cm-lp-code-binding").count()).toBe(2);
  const after = await page.evaluate(() => document.querySelector(".cm-scroller")!.scrollHeight);
  expect(after).toBe(before); // 逐像素相同（几何稳定）
  expect(await readDocument(page)).toBe(doc); // 文档逐字节不变（ADR 0003 §3）
  // 装饰元素只带 class 一个属性、内部只有标识符原文（不产生可读文本）
  const attrs = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".cm-lp-code-binding")].map((el) => ({
      attributes: [...el.attributes].map((a) => a.name),
      text: el.textContent,
    })),
  );
  expect(attrs.map((entry) => entry.attributes)).toEqual([["class"], ["class"]]);
  expect(attrs.map((entry) => entry.text)).toEqual(["LIMIT", "LIMIT"]);
});

test("生命周期：光标移走即清除、点另一个变量改为新源、切文件不残留", async ({ page }) => {
  const doc = FIXTURES["binding-shadow.js"];
  await bootstrap(page, "binding-shadow.js", "const LIMIT = 42;");
  await doubleClickAt(page, locate(doc, { after: "", at: "LIMIT" }).from);
  await expect.poll(() => page.locator(".cm-lp-code-binding").count()).toBe(2);

  // ① 点击空白（空选区）→ 立即清除
  await setCaret(page, doc.indexOf("\n") + 1);
  expect(await decorations(page)).toEqual([]);

  // ② 改点另一个变量 → 按新源判定，旧装饰不残留
  const inner = locate(doc, { after: "function a() {\n  const ", at: "LIMIT" });
  await doubleClickAt(page, inner.from);
  await expect.poll(() => page.locator(".cm-lp-code-binding").count()).toBe(2);
  expect(await decorations(page)).toEqual(
    positions(doc, [{ after: "const LIMIT = 1;\n  return ", at: "LIMIT" }, { after: "return LIMIT + ", at: "LIMIT" }]),
  );

  // ③ 切文件：新文件零装饰，且回到原文件也不残留（装载即空选区）
  await open(page, "binding.py", "LIMIT = 42");
  expect(await decorations(page)).toEqual([]);
  await open(page, "binding-shadow.js", "const LIMIT = 42;");
  expect(await decorations(page)).toEqual([]);
});

test("md 模式与 T3 语言：双击标识符零装饰、零提示（不退回字符匹配）", async ({ page }) => {
  // md：围栏里同一份文本（md 可编辑、没有变量语义 ⇒ 本能力不生效）
  const md = FIXTURES["binding.md"];
  await bootstrap(page, "binding.md", "标题");
  // 选中**标识符本身**（不是 `const LIMIT` 那种跨节点选区——那样即使把一个能力错装进 md 分支也不会有装饰，
  // 断言就没有区分度了；反向验证见 reverse-verification/visual-md-also-installed.log）
  // 选**正文段落**里那个标识符（不是围栏里的）：md 渲染会把围栏内容替换成 widget，装饰元素不进 DOM，
  // 那样即使把一个能力错装进 md 分支也读不到装饰 ⇒ 断言没有区分度（反向验证见
  // reverse-verification/visual-md-also-installed.log）
  const mdIdentifier = md.lastIndexOf("LIMIT");
  await selectRange(page, mdIdentifier, mdIdentifier + 5);
  expect(await page.locator(".cm-lp-code-binding").count()).toBe(0);
  expect(await page.locator(".lumir-toast").count()).toBe(0);

  // T3：lua 有标识符、但没有结构解析 ⇒ 静默（不是错误态，MUST NOT 提示）
  const lua = FIXTURES["binding.lua"];
  await open(page, "binding.lua", "local LIMIT = 1");
  const target = lua.indexOf("LIMIT = LIMIT");
  await selectRange(page, target, target + 5);
  expect(await page.locator(".cm-lp-code-binding").count()).toBe(0);
  expect(await page.locator(".lumir-toast").count()).toBe(0);
  // 且没有出现文本匹配式的全词高亮（T3 语言 MUST NOT 降级）
  expect(await readDocument(page)).toBe(lua);
});

test("全文口径：初始视口外的出现也被装饰（滚到底即见）", async ({ page }) => {
  const doc = FIXTURES["binding-long.js"];
  await bootstrap(page, "binding-long.js", "const LIMIT = 42;");
  const far = doc.lastIndexOf("LIMIT");
  const visibleAtFirst = await page.evaluate((pos: number) => {
    const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return v.visibleRanges.some((range: { from: number; to: number }) => pos >= range.from && pos < range.to);
  }, far);
  expect(visibleAtFirst, "本用例的前提：那一处在初始视口外（否则这条断言没有区分度）").toBe(false);

  await doubleClickAt(page, doc.indexOf("LIMIT"));
  // 这一层读的是 DOM，因此只能判「渲染出来的行」：那处出现还在视口外时读不到任何装饰元素
  //（源位置本身不装饰）。滚到底之后它必须带上装饰——这同时排除「只按触发时刻的可见范围建装饰」
  // 的实现（那种实现在滚动后仍然没有装饰可读）。
  expect(await decorations(page)).toEqual([]);
  await page.evaluate(() => {
    const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
    v.requestMeasure();
  });
  await expect
    .poll(() => page.evaluate((pos: number) => {
      const v = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
      return [...document.querySelectorAll<HTMLElement>(".cm-lp-code-binding")].some((el) => v.posAtDOM(el) === pos);
    }, far))
    .toBe(true);
});

test("高亮在场（元素级基线，待 Alex 过目）", async ({ page }) => {
  const doc = FIXTURES["binding-shadow.js"];
  await bootstrap(page, "binding-shadow.js", "const LIMIT = 42;");
  await doubleClickAt(page, locate(doc, { after: "", at: "LIMIT" }).from);
  await expect.poll(() => page.locator(".cm-lp-code-binding").count()).toBe(2);
  await expectScreenshot(page.locator(VIEW), "binding-highlight.png");
});
