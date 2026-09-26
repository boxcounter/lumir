import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 代码文件的符号大纲（change code-outline，M197）的视觉与交互回归。
//
// 为什么要有这个场景：
//   1. **指示段的两个隐藏原因必须分开判**：md 侧「没有标题」与 code 侧「结构未解析 / 语言不支持」
//      在界面上长得一样（都不显示）。只有把光标放进某个符号内部再断言隐藏，才分得出「惰性（没
//      解析）」与「位置在首个条目前」——第一条测试就是这件事，它在「打开即解析」的实现下必然红
//      （反向验证的现场见 test-results/m197/reverse-verification/）。
//   2. **落点是字符偏移级的事实**：code 的落点 = 声明起点、md 的落点 = 标题行尾，AX 不暴露选区，
//      真机通道只能给派生证据。这里直接读 CodeMirror 选区（`cmTile.root.view`，口径同
//      toc-outline.spec.ts），把两种落点的差异钉成断言。
//   3. **三条互斥的提示**（md 的 D84 / 无符号 / 语言不支持）都是 toast，只有文案能区分；每个
//      测试只触发一条（toast 会堆叠 3.5s 后自消，同一测试里连出两条会让负向断言假红/假绿）。
//
// md 侧的全部既有口径由 toc-outline.spec.ts 原样守（本场景只留一条对照，防止改 code 分支时
// 顺手动了共用通道——共用通道 = 浮层 DOM、就地键、当前位置链算法）。

const JS_DOC = `// 工具集：注释与导入区（不是符号）
import { base } from "./base.js";

const LIMIT = 42;

class Util {
  field = 1;
  greet(name) {
    const local = 1;
    return name + local;
  }
}

function helper(value) {
  return value + LIMIT;
}
`;

const PY_DOC = `"""只有注释和字符串的模块。"""
# 没有可提取的符号
`;

const CSS_DOC = `.card, .panel {
  color: red;
  margin: 0;
}

.card {
  .title {
    color: blue;
  }
}
`;

const SCSS_DOC = `$ink: #333;
$gap: 4px;

.card {
  padding: $gap;
  .title { color: $ink; }
}
`;

const LUA_DOC = `local function greet(name)
  return name
end
`;

const MD_DOC = `# 第一部分
正文段落。

## 甲小节
甲小节正文。
`;

const VAULT: VaultFixture = {
  entries: [
    { path: "outline.js", kind: "file", size: JS_DOC.length, mtime_ms: 0 },
    { path: "outline.py", kind: "file", size: PY_DOC.length, mtime_ms: 0 },
    { path: "theme.css", kind: "file", size: CSS_DOC.length, mtime_ms: 0 },
    { path: "theme.scss", kind: "file", size: SCSS_DOC.length, mtime_ms: 0 },
    { path: "script.lua", kind: "file", size: LUA_DOC.length, mtime_ms: 0 },
    { path: "toc.md", kind: "file", size: MD_DOC.length, mtime_ms: 0 },
  ],
  files: {
    "outline.js": JS_DOC,
    "outline.py": PY_DOC,
    "theme.css": CSS_DOC,
    "theme.scss": SCSS_DOC,
    "script.lua": LUA_DOC,
    "toc.md": MD_DOC,
  },
  links: {},
};

/** CodeMirror 的视图（视觉场景读选区 / 派发的既有通道，口径同 toc-outline.spec.ts）。 */
const VIEW = ".cm-content";

/** 1 基行号（与 `doc.line(n)` 同口径；`--toc-depth` 之外的落点断言都要它）。 */
function lineOf(doc: string, pos: number): number {
  return doc.slice(0, pos).split("\n").length;
}

async function caret(page: Page): Promise<{ head: number; line: number }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const main = view.state.selection.main;
    return { head: main.head, line: view.state.doc.lineAt(main.head).number };
  });
}

async function docText(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view.state.doc.toString(),
  );
}

/** 把光标放到指定偏移（装载后默认在 0；「光标落在条目前 / 条目内」的判据都要能挪）。 */
async function setCaret(page: Page, pos: number): Promise<void> {
  await page.evaluate((anchor: number) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.dispatch({ selection: { anchor } });
  }, pos);
}

/** 打开一个 fixture 文件并等到内容上屏。 */
async function open(page: Page, path: string, marker: string): Promise<void> {
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(marker);
}

async function bootstrap(page: Page, path: string, marker: string): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await open(page, path, marker);
}

/** 条目文本序列与 `--toc-depth`（缩进口径）；两者一起读，避免只判文本漏掉层级回归。 */
async function items(page: Page): Promise<{ texts: string[]; depths: string[] }> {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll<HTMLElement>(".lumir-toc-item")];
    return {
      texts: els.map((el) => el.textContent ?? ""),
      depths: els.map((el) => el.style.getPropertyValue("--toc-depth")),
    };
  });
}

test("惰性：打开与光标路径都不解析（指示段不显示），⌘⇧O 之后同一光标才显示符号链", async ({ page }) => {
  await bootstrap(page, "outline.js", "工具集");
  const indicator = page.locator(".modeline-section");
  // 非 md 代码文件自 editable-non-md-files 起可编辑（M130 的只读口径已解除）：
  // 本用例钉的是「惰性解析」——可编辑性不改变那一条。
  await expect(page.locator(VIEW)).toHaveAttribute("contenteditable", "true");

  // ① 刚打开：光标在第 1 行（注释区），结构未解析 ⇒ 指示段隐藏
  await expect(indicator).toBeHidden();

  // ② 把光标挪进 `greet` 的方法体内。**这一条是本测试的区分度所在**：文件里明明有
  //    `Util › greet` 这条链，但结构尚未解析 ⇒ 指示段必须仍然隐藏
  //    （「打开即解析」的实现会在这里红，反向验证见 review-request）。
  const greetPos = JS_DOC.indexOf("const local = 1;");
  await setCaret(page, greetPos);
  // 节流窗口 120ms：等一拍再断言，排除「只是还没刷新」这条解释
  await page.waitForTimeout(300);
  await expect(indicator).toBeHidden();
  expect(await caret(page)).toEqual({ head: greetPos, line: lineOf(JS_DOC, greetPos) });

  // ③ 按一次 ⌘⇧O（首次需要结构 ⇒ 这里才解析）：浮层列出 5 条，顺序 = 文档顺序
  await page.keyboard.press("Meta+Shift+o");
  const listed = await items(page);
  expect(listed.texts).toEqual(["LIMIT", "Util", "field", "greet", "helper"]);
  // 缩进 = 语法嵌套深度、以最浅的条目为基准归一：类成员深一级
  expect(listed.depths).toEqual(["0", "0", "1", "1", "0"]);
  // 当前段 = 光标所在的符号（缩进层级不影响归属）
  await expect(page.locator(".lumir-toc-item.is-current")).toHaveText("greet");
  // 键位提示逐字沿用 md 侧（MUST NOT 因语言不同而改写）
  await expect(page.locator(".lumir-toc-hint")).toHaveText("↑↓ ⌃N⌃P 选择 · Enter 跳转 · Esc 关闭");
  // 指示段跟着这次解析当场就位（不等节流窗口）：光标在 `greet` 里 ⇒ 立刻显示符号链
  await expect(indicator).toHaveText("Util › greet");
  await expectScreenshot(page.locator(".lumir-toc"), "code-outline-popover.png");

  // ④ 收起浮层：同一个光标位置、同一份文档，此刻指示段仍显示符号链——第 ② 步的隐藏因此确定是
  //    「没解析」，而不是「位置在条目前」或「读不到」（REVIEW.md 第 2 条）
  await page.keyboard.press("Escape");
  await expect(page.locator(".lumir-toc")).toBeHidden();
  await expect(indicator).toHaveText("Util › greet");

  // ⑤ 光标回到文件头部的注释与导入区：没有当前符号 ⇒ 指示段隐藏（这一次是位置判据，不是解析判据）
  await setCaret(page, 0);
  await page.waitForTimeout(300);
  await expect(indicator).toBeHidden();

  // 全程只读：没有任何一个字节被改写
  expect(await docText(page)).toBe(JS_DOC);
});

test("跳转落点 = 声明起点（不是 md 的行尾）；键盘与鼠标共用同一个落点", async ({ page }) => {
  await bootstrap(page, "outline.js", "工具集");
  await page.keyboard.press("Meta+Shift+o");

  // ↓ 一次落到 `Util`（第 2 条），Enter 跳转
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".lumir-toc-item.is-active")).toHaveText("Util");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-toc")).toBeHidden();
  const classStart = JS_DOC.indexOf("class Util");
  await expect
    .poll(() => caret(page), { message: "跳转后光标应落在 class 关键字处（声明起点）" })
    .toEqual({ head: classStart, line: lineOf(JS_DOC, classStart) });
  // 与 md 的行尾口径可分辨：落点严格早于该行行尾
  const classLineEnd = JS_DOC.indexOf("\n", classStart);
  expect((await caret(page)).head).toBeLessThan(classLineEnd);
  await expect(page.locator(".modeline-section")).toHaveText("Util");

  // 鼠标点条目走同一落点：`helper` 的声明起点
  await page.keyboard.press("Meta+Shift+o");
  await page.locator(".lumir-toc-item", { hasText: /^helper$/ }).click();
  await expect(page.locator(".lumir-toc")).toBeHidden();
  const helperStart = JS_DOC.indexOf("function helper");
  await expect.poll(() => caret(page)).toEqual({ head: helperStart, line: lineOf(JS_DOC, helperStart) });

  // 局部变量、形参、导入行都没有条目：列表里不该出现它们
  await page.keyboard.press("Meta+Shift+o");
  const texts = (await items(page)).texts;
  for (const absent of ["local", "name", "value", "base"]) expect(texts).not.toContain(absent);
  await page.keyboard.press("Escape");
  expect(await docText(page)).toBe(JS_DOC);
});

test("T2：css / scss 的条目是规则集（scss 另含 $变量），嵌套规则深一级", async ({ page }) => {
  await bootstrap(page, "theme.css", "card, .panel");
  await page.keyboard.press("Meta+Shift+o");
  const css = await items(page);
  expect(css.texts).toEqual([".card, .panel", ".card", ".title"]);
  expect(css.depths).toEqual(["0", "0", "1"]);
  // 属性声明不是符号：`color` / `margin` 这类属性名不进大纲
  for (const absent of ["color", "margin"]) expect(css.texts).not.toContain(absent);
  await page.keyboard.press("Escape");

  await open(page, "theme.scss", "$ink");
  await page.keyboard.press("Meta+Shift+o");
  const scss = await items(page);
  expect(scss.texts).toEqual(["$ink", "$gap", ".card", ".title"]);
  expect(scss.depths).toEqual(["0", "0", "0", "1"]);
  // `padding: $gap;` 是属性声明（`$gap` 只是值）——只按「有 $变量子节点」判会多出一条重复条目
  expect(scss.texts.filter((text) => text === "$gap").length).toBe(1);
  await page.keyboard.press("Escape");
});

test("T3 语言：给「暂不支持」的提示、不展开浮层、不吐 md 的错话", async ({ page }) => {
  await bootstrap(page, "script.lua", "local function greet");
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toast", { hasText: "这份文件类型暂不支持大纲" })).toBeVisible();
  await expect(page.locator(".lumir-toc")).toBeHidden();
  // 「这份文档还没有标题，大纲为空」（D84）在代码文件上是一句错话，MUST NOT 复用
  await expect(page.locator(".lumir-toast", { hasText: "这份文档还没有标题" })).toHaveCount(0);
  // 也不该出现「没有可提取的符号」那条（两种情形的提示互斥）
  await expect(page.locator(".lumir-toast", { hasText: "这份文件没有可提取的符号" })).toHaveCount(0);
});

test("受支持但文件里没有条目：给另一种提示，同样不展开浮层、不复用 D84", async ({ page }) => {
  await bootstrap(page, "outline.py", "只有注释");
  await page.keyboard.press("Meta+Shift+o");
  await expect(page.locator(".lumir-toast", { hasText: "这份文件没有可提取的符号，大纲为空" })).toBeVisible();
  await expect(page.locator(".lumir-toc")).toBeHidden();
  await expect(page.locator(".lumir-toast", { hasText: "这份文档还没有标题" })).toHaveCount(0);
  await expect(page.locator(".lumir-toast", { hasText: "这份文件类型暂不支持大纲" })).toHaveCount(0);
});

test("md 侧对照：标题链与行尾落点逐字不变（共用通道没被 code 分支带歪）", async ({ page }) => {
  await bootstrap(page, "toc.md", "第一部分");
  const indicator = page.locator(".modeline-section");
  await expect(indicator).toHaveText("第一部分");

  await page.keyboard.press("Meta+Shift+o");
  const listed = await items(page);
  expect(listed.texts).toEqual(["第一部分", "甲小节"]);
  expect(listed.depths).toEqual(["0", "1"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  // md 的落点是标题行尾（code 侧是声明起点）——两种口径在同一个共用通道里各走各的
  const headingEnd = MD_DOC.indexOf("## 甲小节") + "## 甲小节".length;
  await expect.poll(() => caret(page)).toEqual({ head: headingEnd, line: lineOf(MD_DOC, headingEnd) });
  await expect(indicator).toHaveText("第一部分 › 甲小节");
});
