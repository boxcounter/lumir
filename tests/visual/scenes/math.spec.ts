import { expect, test, type Page } from "@playwright/test";
import { findMathSpans, mathRenderCacheSize, renderMath } from "../../../src/preview/math";
import { stubTauri } from "./tauri-stub";

// Math/LaTeX（foundation-markdown 用户裁决，M105 选型 KaTeX）：
// 词法 span 定位单测（findMathSpans 是前端持有的词法逻辑）+ 渲染缓存 +
// UI 场景（行内/块级/失败降级/代码上下文排除/货币不误判）+ 复制保真 + 排版基线视觉。

// ---------------------------------------------------------------------------
// 词法：findMathSpans span 定位
// ---------------------------------------------------------------------------

test("词法：行内/块级/跨行/转义/货币/反引号", () => {
  const spans = (text: string) => findMathSpans(text).map((s) => [s.from, s.to, s.display]);

  // 行内
  expect(spans("质能方程 $E=mc^2$ 结束")).toEqual([[5, 13, false]]);
  // 块级同行
  expect(spans("$$x^2$$")).toEqual([[0, 7, true]]);
  // 块级跨行
  const multi = "前文\n$$\n\\int_0^1 x^2 dx\n$$\n后文";
  expect(spans(multi)).toEqual([[3, 24, true]]);
  // 转义 \$ 不界定
  expect(spans("价格 \\$5 不是公式")).toEqual([]);
  // 货币：闭合 $ 前是空白 / 后是数字，不识别
  expect(spans("range $5 and $10 here")).toEqual([]);
  // 反引号 inline code 内的 $ 不识别
  expect(spans("`$x$` 与 $y$")).toEqual([[8, 11, false]]);
  // 开启 $ 右侧空白不识别
  expect(spans("$ x$ 不是公式")).toEqual([]);
  // 未闭合不识别
  expect(spans("只有 $ 一半")).toEqual([]);
  expect(spans("$$ 未闭合")).toEqual([]);
  // 多个公式顺序扫描
  expect(spans("$a$ 和 $b$")).toEqual([[0, 3, false], [6, 9, false]]);
  // $$ 内的 \$ 转义不提前闭合
  expect(spans("$$a \\$ b$$")).toEqual([[0, 10, true]]);
});

// ---------------------------------------------------------------------------
// 渲染缓存：成功与失败都按源码缓存
// ---------------------------------------------------------------------------

test("渲染：renderToString 成功/失败与缓存", () => {
  const before = mathRenderCacheSize();
  const ok1 = renderMath("x^2", false);
  expect("html" in ok1 && ok1.html).toContain("katex");
  const ok2 = renderMath("x^2", false);
  expect(ok2).toBe(ok1); // 命中缓存返回同一结果对象
  expect(mathRenderCacheSize()).toBe(before + 1);

  const bad1 = renderMath("\\frac{1", false);
  expect("error" in bad1).toBe(true);
  const bad2 = renderMath("\\frac{1", false);
  expect(bad2).toBe(bad1); // 失败同样缓存，不重复抛错
  expect(mathRenderCacheSize()).toBe(before + 2);

  // displayMode 是缓存键的一部分
  const display = renderMath("x^2", true);
  expect("html" in display && display.html).toContain("katex-display");
  expect(mathRenderCacheSize()).toBe(before + 3);
});

// ---------------------------------------------------------------------------
// UI 场景
// ---------------------------------------------------------------------------

const MATH_MD = `\
# 数学

行内公式 $E=mc^2$ 与货币 $5 and $10 共存。

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

失败公式 $\\frac{1$ 回落源码。

\`\`\`
$$not_math$$
\`\`\`

行内代码 \`$x_0$\` 不渲染。

| 公式 | 值 |
| --- | --- |
| $$y$$ | z |
`;

async function openMath(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "math.md", kind: "file", size: MATH_MD.length, mtime_ms: 0 }],
    files: { "math.md": MATH_MD },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="math.md"]').click();
  await expect(page.locator(".katex").first()).toBeVisible();
}

test("行内与块级渲染，失败回落可读源码，代码上下文排除", async ({ page }) => {
  await openMath(page);

  // 行内：正文 $E=mc^2$ 与表内 $$y$$（M119：cell 内同行 $$ 按行内渲染）均为 .katex（非 display）
  const inline = page.locator(".cm-lp-math-inline .katex");
  await expect(inline).toHaveCount(2);
  await expect(page.locator(".cm-lp-math-inline .katex-display")).toHaveCount(0);

  // 块级：跨行 $$ 渲染为块级 widget 内的 .katex-display
  const block = page.locator(".cm-lp-math-block .katex-display");
  await expect(block).toHaveCount(1);
  await expect(page.locator(".cm-lp-math-block")).toContainText("dx");

  // 失败降级：完整原文可读 + 明确失败样式，不伪装成公式
  const fallback = page.locator(".cm-lp-math-fallback");
  await expect(fallback).toHaveCount(1);
  await expect(fallback).toContainText("$\\frac{1$");
  await expect(fallback).toHaveAttribute("title", /公式解析失败/);
  await expect(fallback.locator(".katex")).toHaveCount(0);

  // 货币不误判：$5 and $10 保持原文文本
  await expect(page.locator(".cm-content")).toContainText("$5 and $10");

  // 代码上下文排除：fenced 内 $$ 与 inline code 内 $ 不渲染
  await expect(page.locator(".cm-lp-codeblock-line").nth(1)).toHaveText("$$not_math$$");
  await expect(page.locator(".cm-lp-inline-code")).toContainText("$x_0$");

  // 表格 cell：同行 $$ 渲染为行内公式（M119 合同）；跨 slot 边界（$$a | b$$）不吞并
  // cell 的回归见 m119-table-math.spec.ts
  const cellMath = page.locator(".cm-lp-table-cell .cm-lp-math-inline .katex");
  await expect(cellMath).toHaveCount(1);
  await expect(page.locator(".cm-lp-table .cm-lp-math-block")).toHaveCount(0);

  await expect(page.locator(".katex")).toHaveCount(3); // 行内 2（正文 + 表内）+ 块级 1，仅此而已

  await expect(page).toHaveScreenshot("math-rendering.png");
});

test("复制保真：全选复制输出原始 Markdown", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openMath(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(MATH_MD);
});

test("选区进入块级公式时显示原文（编辑/选择可见源码）", async ({ page }) => {
  await openMath(page);
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(1);
  // 光标落入 $$ 块范围：装饰跳过，源码行可见
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await expect(page.locator(".cm-lp-math-block")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("\\int_0^1");
});

test("公式跟随正文 token 渲染", async ({ page }) => {
  await openMath(page);
  // KaTeX 继承 currentColor：公式颜色应与正文 --text 一致
  const colors = await page.locator(".cm-lp-math-inline .katex").first().evaluate((el) => {
    const mathColor = getComputedStyle(el).color;
    const bodyColor = getComputedStyle(el.closest(".cm-content")!).color;
    return { mathColor, bodyColor };
  });
  expect(colors.mathColor).toBe(colors.bodyColor);
  await expect(page).toHaveScreenshot("math-theme.png");
});
