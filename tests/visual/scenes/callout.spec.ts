import { expect, test, type Page } from "@playwright/test";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { detectCallout } from "../../../src/preview/callout";
import type { CalloutInfo } from "../../../src/preview/callout";
import { stubTauri } from "./tauri-stub";

// Callout 渲染（foundation-markdown P1，M109）：Obsidian [!type] 语法。
// Node 侧单测（类型表/别名/标记解析/未知类型降级，不依赖 DOM）+ UI 场景
//（类型渲染/未知类型/嵌套 Markdown/复制保真/三主题）。

// ---------------------------------------------------------------------------
// 解析：detectCallout 对 blockquote 首行 [!type] 的判定口径
// ---------------------------------------------------------------------------

function calloutsIn(docText: string): CalloutInfo[] {
  const state = EditorState.create({
    doc: docText,
    extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  const infos: CalloutInfo[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name !== "Blockquote") return;
      const info = detectCallout(state.doc, ref.node);
      if (info) infos.push(info);
    },
  });
  return infos;
}

test("解析：已知类型、别名、大小写与折叠符", () => {
  const cases: Array<[string, string, boolean]> = [
    ["> [!note]", "note", true],
    ["> [!NOTE]", "note", true],
    ["> [!hint]", "tip", true],
    ["> [!important]", "tip", true],
    ["> [!caution]", "warning", true],
    ["> [!error]", "danger", true],
    ["> [!cite]", "quote", true],
    ["> [!tldr]", "abstract", true],
    ["> [!faq]", "question", true],
    ["> [!warning]- 折叠符解析但不做折叠", "warning", true],
    ["> [!note]+ 折叠符解析但不做折叠", "note", true],
    ["> [!whatever]", "unknown", false],
  ];
  for (const [source, canonical, known] of cases) {
    const infos = calloutsIn(`${source}\n> 正文。\n`);
    expect(infos, source).toHaveLength(1);
    expect(infos[0].canonical).toBe(canonical);
    expect(infos[0].known).toBe(known);
  }
});

test("解析：标题、默认名与标记范围", () => {
  // 自定义标题：title 范围指向行尾文本，label 不参与渲染
  const titled = calloutsIn("> [!warning] 自定义标题\n> 正文。\n")[0];
  expect(titled.titleFrom).not.toBeNull();
  // 无标题：widget 渲染规范名；未知类型按原文类型名显示（不伪装）
  const plain = calloutsIn("> [!tip]\n> 正文。\n")[0];
  expect(plain.titleFrom).toBeNull();
  expect(plain.label).toBe("Tip");
  const unknown = calloutsIn("> [!Whatever]\n> 正文。\n")[0];
  expect(unknown.titleFrom).toBeNull();
  expect(unknown.label).toBe("Whatever");
  // 标记范围覆盖 [!type]（含折叠符与标题前一个空格），不含正文
  const src = "> [!note]- 标题\n> 正文。\n";
  const info = calloutsIn(src)[0];
  expect(src.slice(info.markerFrom, info.markerTo)).toBe("[!note]- ");
  expect(src.slice(info.titleFrom!, info.titleTo!)).toBe("标题");
  // > 后 2-3 个空格：多余空格并入标记范围（QuoteMark 隐藏只吃一个空格，
  // 其余随标记替换，不在图标前残留——M109 review 边角 1，M110 修复）
  const spaced = ">  [!note] 标题\n> 正文。\n";
  const spacedInfo = calloutsIn(spaced)[0];
  expect(spaced.slice(spacedInfo.markerFrom, spacedInfo.markerTo)).toBe(" [!note] ");
});

test("解析：非 callout 的 blockquote 不误判", () => {
  expect(calloutsIn("> 普通引用。\n")).toHaveLength(0);
  expect(calloutsIn("> [note] 不是叹号标记。\n")).toHaveLength(0);
  expect(calloutsIn("> [!foo bar] 类型含空格不是标记。\n")).toHaveLength(0);
  expect(calloutsIn("> [!] 空类型不是标记。\n")).toHaveLength(0);
  // 标记不在首行：不是 callout
  expect(calloutsIn("> 第一段。\n>\n> [!note] 第二段才出现。\n")).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// UI 场景
// ---------------------------------------------------------------------------

const CALLOUT_MD = `\
# Callout

> [!note] 自定义标题
> 正文 **加粗** 与 \`code\`，还有 [[guide]]。

> [!tip]
> - 列表项一
> - 列表项二

> [!warning]
> 小心。

> [!whatever]
> 未知类型按原文显示。

> 普通引用保持原样。
`;

const VAULT = {
  entries: [
    { path: "callout.md", kind: "file", size: CALLOUT_MD.length, mtime_ms: 0 },
    { path: "guide.md", kind: "file", size: 10, mtime_ms: 0 },
  ],
  files: {
    "callout.md": CALLOUT_MD,
    "guide.md": "# Guide\n",
  },
  links: {
    "[[guide]]": {
      status: "resolved",
      path: "guide.md",
      candidates: [],
      embed_target: null,
      anchor: { status: "none", heading: null, line: null },
    },
  },
};

async function openCallout(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="callout.md"]').click();
  await expect(page.locator(".cm-lp-callout-icon")).toHaveCount(4);
}

test("渲染：类型样式、默认/自定义标题、未知类型降级、普通引用不受影响", async ({ page }) => {
  await openCallout(page);

  // 标记被替换为图标（含 SVG），源码文本不出现在视图里
  await expect(page.locator(".cm-lp-callout-icon svg")).toHaveCount(4);
  await expect(page.locator(".cm-content")).not.toContainText("[!note]");

  // 自定义标题走标题样式；无标题时 widget 渲染规范名
  await expect(page.locator(".cm-lp-callout-title").filter({ hasText: "自定义标题" })).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-label").filter({ hasText: "Tip" })).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-label").filter({ hasText: "Warning" })).toHaveCount(1);

  // 类型色经行内变量接线：note 与 warning 左边条颜色不同
  const noteColor = await page
    .locator(".cm-line.cm-lp-callout-line")
    .first()
    .evaluate((el) => getComputedStyle(el).borderLeftColor);
  const warningColor = await page
    .locator(".cm-line.cm-lp-callout-first")
    .nth(2)
    .evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(noteColor).not.toBe(warningColor);

  // 未知类型：中性降级，按原文类型名显示，不套用已知类型色
  const unknownLine = page.locator(".cm-line.cm-lp-callout-line", { hasText: "未知类型按原文显示" });
  await expect(unknownLine).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-icon-unknown .cm-lp-callout-label")).toHaveText("whatever");
  const unknownColor = await unknownLine.evaluate((el) => getComputedStyle(el).borderLeftColor);
  expect(unknownColor).not.toBe(noteColor);
  expect(unknownColor).not.toBe(warningColor);

  // 普通引用：保持 quote-line 样式，不出现 callout 结构
  const plainQuote = page.locator(".cm-line.cm-lp-quote-line", { hasText: "普通引用保持原样" });
  await expect(plainQuote).toHaveCount(1);
  await expect(plainQuote).not.toHaveClass(/cm-lp-callout/);

  // 嵌套 Markdown：行内样式、wikilink、列表在 callout 内照常装饰
  await expect(page.locator(".cm-lp-callout-line .cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-line .cm-lp-inline-code", { hasText: "code" })).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-line .cm-lp-wikilink-resolved")).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-line .cm-lp-list-marker")).toHaveCount(2);

  await expect(page).toHaveScreenshot("callout-rendering.png");
});

test("复制保真：全选复制输出原始 Markdown（含 [!type] 标记）", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openCallout(page);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(CALLOUT_MD);
});

for (const theme of ["light", "dark", "eink"]) {
  test(`主题 ${theme}：callout 按主题着色`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("lumir-theme", value), theme);
    await openCallout(page);
    const color = await page
      .locator(".cm-line.cm-lp-callout-line")
      .first()
      .evaluate((el) => getComputedStyle(el).borderLeftColor);
    // 三主题给出可区分配色；eink 为纯黑
    if (theme === "eink") expect(color).toBe("rgb(0, 0, 0)");
    if (theme === "light") expect(color).toBe("rgb(79, 111, 143)");
    if (theme === "dark") expect(color).toBe("rgb(130, 165, 198)");
    await expect(page).toHaveScreenshot(`callout-theme-${theme}.png`);
  });
}

test("嵌套 callout：内层正文色与列表装饰（M109 review 边角 2/3，M110 修复）", async ({ page }) => {
  const NESTED_MD = `\
# 嵌套

> 外层普通引用
> > [!warning]
> > 内层正文。
> > - 嵌套列表项
`;
  await stubTauri(page, {
    entries: [{ path: "nested.md", kind: "file", size: NESTED_MD.length, mtime_ms: 0 }],
    files: { "nested.md": NESTED_MD },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="nested.md"]').click();
  const inner = page.locator(".cm-line.cm-lp-callout-line", { hasText: "内层正文" });
  await expect(inner).toHaveCount(1);
  // 边角 2：内层 callout 行同时带外层 quote-line（color:var(--dim)），
  // callout 必须以正文色覆盖，嵌套正文不偏灰
  const probe = await inner.evaluate((el) => {
    const resolve = (name: string) => {
      const s = document.createElement("span");
      s.style.color = `var(${name})`;
      document.body.append(s);
      const c = getComputedStyle(s).color;
      s.remove();
      return c;
    };
    return { line: getComputedStyle(el).color, text: resolve("--text"), dim: resolve("--dim") };
  });
  expect(probe.line).toBe(probe.text);
  expect(probe.line).not.toBe(probe.dim);
  // 边角 3：引用内嵌 callout（首个 > 属于外层普通引用）的列表装饰同样放开
  await expect(page.locator(".cm-line.cm-lp-list-line", { hasText: "嵌套列表项" })).toHaveCount(1);
});
