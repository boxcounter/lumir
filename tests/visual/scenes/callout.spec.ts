import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { detectCallout } from "../../../src/preview/callout";
import type { CalloutInfo } from "../../../src/preview/callout";
import { stubTauri } from "./tauri-stub";

// Callout 渲染（foundation-markdown P1，M109）：Obsidian [!type] 语法。
// Node 侧单测（类型表/别名/标记解析/未知类型降级，不依赖 DOM）+ UI 场景
//（类型渲染/未知类型/嵌套 Markdown/复制保真/排版基线视觉）。

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
  await expect(page.locator(".cm-lp-callout-type")).toHaveCount(4);
}

// ---------------------------------------------------------------------------
// 五族映射（tokens v1.2 §callout 语义收敛）：13 类各取哪一族的色条 / 底色。
// 这张表是**断言的期望值**，与 src/preview/callout.ts 的 CALLOUT_TYPES 是两份独立表述
// （一份在实现、一份在判据），族归属写错时两边会不一致——这正是它要抓的东西。
// ---------------------------------------------------------------------------

/** 族 → [色条 token, 底色 token]。灰族的底色是 `--agent-bg`（tokens 映射表的取值列）。 */
const FAMILY_TOKENS: Record<string, [string, string]> = {
  info: ["--accent", "--accent-tint"],
  ok: ["--ok", "--ok-tint"],
  pending: ["--pending", "--pending-tint"],
  danger: ["--danger", "--danger-tint"],
  neutral: ["--text-3", "--agent-bg"],
};

const THIRTEEN: Array<[string, string]> = [
  ["note", "info"],
  ["abstract", "info"],
  ["info", "info"],
  ["todo", "info"],
  ["tip", "ok"],
  ["success", "ok"],
  ["question", "pending"],
  ["warning", "pending"],
  ["failure", "danger"],
  ["danger", "danger"],
  ["bug", "danger"],
  ["example", "neutral"],
  ["quote", "neutral"],
];

/** 13 类各一段（带自定义标题，使每块的首行唯一可定位）。 */
const ALL_TYPES_MD = `${THIRTEEN.map(([type]) => `> [!${type}] ${type} 标题\n> ${type} 正文。`).join("\n\n")}\n`;

test("渲染：类型标签、默认/自定义标题、未知类型降级、普通引用不受影响", async ({ page }) => {
  await openCallout(page);

  // 标记被替换为**类型标签文本**，源码文本不出现在视图里；图标体系已退役
  // （tokens v1.2 规则 2：同族区分只靠标题行文字，MUST NOT 引入图标）
  await expect(page.locator(".cm-lp-callout-icon")).toHaveCount(0);
  await expect(page.locator(".cm-lp-callout-line svg")).toHaveCount(0);
  await expect(page.locator(".cm-content")).not.toContainText("[!note]");
  // 类型标签**恒在场**：即便有自定义标题也显示规范名（否则同族的红块无从分辨）
  await expect(page.locator(".cm-lp-callout-type")).toHaveCount(4);
  await expect(page.locator(".cm-lp-callout-type").filter({ hasText: "Note" })).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-type").filter({ hasText: "Tip" })).toHaveCount(1);
  await expect(page.locator(".cm-lp-callout-type").filter({ hasText: "Warning" })).toHaveCount(1);
  // 自定义标题走标题样式
  await expect(page.locator(".cm-lp-callout-title").filter({ hasText: "自定义标题" })).toHaveCount(1);

  // 族类随类型落在块内的**每一行**上（行装饰按块加类），因此按每块的首行（`.cm-lp-callout-first`）
  // 计数：note→info / tip→ok / warning→pending / whatever→neutral，每块各一
  await expect(page.locator(".cm-line.cm-lp-callout-first.cm-lp-callout-fam-info")).toHaveCount(1);
  await expect(page.locator(".cm-line.cm-lp-callout-first.cm-lp-callout-fam-ok")).toHaveCount(1);
  await expect(page.locator(".cm-line.cm-lp-callout-first.cm-lp-callout-fam-pending")).toHaveCount(1);
  await expect(page.locator(".cm-line.cm-lp-callout-first.cm-lp-callout-fam-neutral")).toHaveCount(1);

  // 类型色经行内变量接线：注意（琥珀）与信息（蓝）色条不同
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
  await expect(page.locator(".cm-lp-callout-fam-neutral .cm-lp-callout-type")).toHaveText("whatever");
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

  await expectScreenshot(page, "callout-rendering.png");
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

test("13 类逐类：色条 = 族色、底色 = 族 tint（五族映射表）", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "all.md", kind: "file", size: ALL_TYPES_MD.length, mtime_ms: 0 }],
    files: { "all.md": ALL_TYPES_MD },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="all.md"]').click();
  await expect(page.locator(".cm-lp-callout-first")).toHaveCount(THIRTEEN.length);

  // 逐类读数：每块首行（.cm-lp-callout-first）的色条与底色必须**恰好**等于该族 token 的值。
  // 期望值在浏览器里由 `var(--x)` 现解析——判据因此追着 token 走，不写死色值字面量。
  const readings = await page.evaluate(
    ({ pairs, families }) => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const token = (name: string, prop: "color" | "backgroundColor"): string => {
        probe.style.color = "";
        probe.style.backgroundColor = "";
        probe.style[prop] = `var(${name})`;
        return getComputedStyle(probe)[prop];
      };
      const out = [...document.querySelectorAll(".cm-line.cm-lp-callout-first")].map((el, index) => {
        const [type, family] = pairs[index];
        const [borderToken, bgToken] = families[family];
        const style = getComputedStyle(el);
        return {
          type,
          family,
          border: style.borderLeftColor,
          expectedBorder: token(borderToken, "color"),
          background: style.backgroundColor,
          expectedBackground: token(bgToken, "backgroundColor"),
          label: el.querySelector(".cm-lp-callout-type")?.textContent ?? null,
        };
      });
      probe.remove();
      return out;
    },
    { pairs: THIRTEEN, families: FAMILY_TOKENS },
  );

  for (const row of readings) {
    expect(row.border, `${row.type}（${row.family} 族）色条应取族色`).toBe(row.expectedBorder);
    expect(row.background, `${row.type}（${row.family} 族）底色应取族 tint`).toBe(row.expectedBackground);
    expect(row.label, `${row.type} 的类型标签文本`).toBeTruthy();
  }
  // 同族类型的标签互不相同（同族只靠标题行文字区分，标签就是那个区分手段）
  const labelSets = new Map<string, string[]>();
  for (const row of readings) labelSets.set(row.family, [...(labelSets.get(row.family) ?? []), row.label!]);
  for (const [family, labels] of labelSets) {
    expect(new Set(labels).size, `${family} 族内标签应互不相同：${labels.join(" / ")}`).toBe(labels.length);
  }
  // 五族都被这 13 类覆盖到（漏掉一族说明映射表与实现的族集合漂了）
  expect(new Set(readings.map((row) => row.family)).size).toBe(5);
});

test("callout 色条取族语义 token（note 属信息族 = --accent）", async ({ page }) => {
  await openCallout(page);
  const probe = await page.evaluate(() => {
    const span = document.createElement("span");
    span.style.color = "var(--accent)";
    document.body.append(span);
    const accent = getComputedStyle(span).color;
    span.remove();
    const line = document.querySelector<HTMLElement>(".cm-line.cm-lp-callout-line")!;
    return { accent, line: getComputedStyle(line).borderLeftColor };
  });
  expect(probe.line).toBe(probe.accent);
  await expectScreenshot(page, "callout-theme.png");
});

test("eink：13 类色条全黑、底色回落 --content-bg（tint 全 transparent）", async ({ page }) => {
  // 经桩的 `ui.theme` 通道走真实配置接线（启动装配层写 documentElement.dataset.theme），
  // 不是场景自己贴属性——只贴属性只能证明 CSS 有第三套取值，验不到配置通道。
  await stubTauri(page, {
    entries: [{ path: "all.md", kind: "file", size: ALL_TYPES_MD.length, mtime_ms: 0 }],
    files: { "all.md": ALL_TYPES_MD },
    config: { theme: "eink" },
  });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("eink");
  await page.locator('.ft-row[title="all.md"]').click();
  await expect(page.locator(".cm-lp-callout-first")).toHaveCount(THIRTEEN.length);

  const readings = await page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    probe.style.backgroundColor = "var(--content-bg)";
    const contentBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      contentBg,
      rows: [...document.querySelectorAll(".cm-line.cm-lp-callout-first")].map((el) => {
        const style = getComputedStyle(el);
        return { border: style.borderLeftColor, background: style.backgroundColor };
      }),
    };
  });
  // 规则①③：语义色全黑 → 色条黑；tint 全 transparent → 底色落回 --content-bg（eink 即白）
  for (const row of readings.rows) {
    expect(row.border, "eink 下 13 类色条一律实心黑").toBe("rgb(0, 0, 0)");
    expect(row.background, "eink 下 13 类底色一律回落 --content-bg").toBe(readings.contentBg);
  }
  // 全屏无彩色像素：色条是 callout 上唯一的颜色来源，黑即无色条色
  expect(new Set(readings.rows.map((row) => row.border)).size).toBe(1);
});

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
  // 边角 2：内层 callout 行同时带外层 quote-line（color:var(--text-2)），
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
    return { line: getComputedStyle(el).color, text: resolve("--text"), secondary: resolve("--text-2") };
  });
  expect(probe.line).toBe(probe.text);
  expect(probe.line).not.toBe(probe.secondary);
  // 边角 3：引用内嵌 callout（首个 > 属于外层普通引用）的列表装饰同样放开
  await expect(page.locator(".cm-line.cm-lp-list-line", { hasText: "嵌套列表项" })).toHaveCount(1);
});
