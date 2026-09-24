import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// 内容类型形态（change restyle-ui-tokens-v1，tasks §6.3 / §6.4）：表格 / 代码块 / 引用 / 列表。
// 逐项落**计算属性与几何读数**，对应 tokens 文档 §字号阶梯 / §行高 / §层次档 的取值。
//
// 其中「表格首列 550」是 M213 收编的缺陷修复（tower 裁决）：旧实现用
// `.cm-lp-table-cell:first-child` 匹配首列，而 CM6 会在行内自动放置 `img.cm-widgetBuffer`
// 等非 cell 元素、它可能落在第一个 cell 之前——于是 `:first-child` 不匹配任何 cell，
// 「首列 550」整条静默失效（M212 reviewer 独立复现）。修法是改判**列索引**
// （装饰层写死的 `aria-colindex`），本场景是该修复的闭环断言。

const TABLE_DOC = [
  "| 名称 | 触发时机 | 说明 |",
  "| --- | --- | --- |",
  "| alpha | 启动 | 第一列应为 550 |",
  "| beta | 保存 | 同上 |",
  "",
].join("\n");

const TYPES_DOC = [
  "# 内容类型",
  "",
  "> 引用块的一段文字。",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
  "- 一级项",
  "  - 二级项",
  "",
].join("\n");

async function open(page: Page, file: string, doc: string, marker: string): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: file, kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { [file]: doc },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(marker);
}

test("表格：th 底线取结构档、td 取层次档，字号两档（11.5 / 13.5），首列 550", async ({ page }) => {
  await open(page, "table.md", TABLE_DOC, "第一列应为 550");
  await expect(page.locator(".cm-lp-table")).toHaveCount(1);

  const tokens = await page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const value = (name: string, prop: "color" | "fontWeight") => {
      probe.style.color = "";
      probe.style.fontWeight = "";
      probe.style[prop] = `var(${name})`;
      return getComputedStyle(probe)[prop];
    };
    const border = (name: string) => {
      probe.style.borderBottomColor = "";
      probe.style.borderBottomColor = `var(${name})`;
      return getComputedStyle(probe).borderBottomColor;
    };
    const out = {
      border: border("--border"),
      borderSoft: border("--border-soft"),
      emphasis: value("--fw-emphasis", "fontWeight"),
      bold: value("--fw-bold", "fontWeight"),
      regular: value("--fw-regular", "fontWeight"),
      text2: value("--text-2", "color"),
    };
    probe.remove();
    return out;
  });

  const rows = await page.evaluate(() =>
    [...document.querySelectorAll(".cm-lp-table-row")].map((row) =>
      [...row.querySelectorAll<HTMLElement>(".cm-lp-table-cell")].map((cell) => {
        const style = getComputedStyle(cell);
        return {
          col: cell.getAttribute("aria-colindex"),
          header: cell.getAttribute("role") === "columnheader",
          weight: style.fontWeight,
          fontSize: style.fontSize,
          borderBottomColor: style.borderBottomColor,
          text: cell.textContent ?? "",
        };
      }),
    ),
  );

  // 结构：1 行表头 + 2 行数据，每行 3 列（列号由装饰层写死，是判据的定位依据）
  expect(rows).toHaveLength(3);
  for (const row of rows) expect(row.map((cell) => cell.col)).toEqual(["1", "2", "3"]);

  // 表头行：粗体档（650）+ 标签档字号（11.5px）+ 底线取**结构档**
  for (const cell of rows[0]) {
    expect(cell.weight).toBe(tokens.bold);
    expect(cell.fontSize).toBe("11.5px");
    expect(cell.borderBottomColor).toBe(tokens.border);
  }
  // 数据行：标签档字号之上一档（13.5px）、底线取**层次档**
  for (const row of rows.slice(1)) {
    for (const cell of row) {
      expect(cell.fontSize).toBe("13.5px");
      expect(cell.borderBottomColor).toBe(tokens.borderSoft);
    }
  }

  // 首列 550（缺陷修复的闭环断言）：**按列号**取首列，两行数据各自成立；
  // 其余列是常字重 400。旧实现用 `:first-child` 时这里恒为 400。
  for (const row of rows.slice(1)) {
    expect(row[0].weight, `数据行首列「${row[0].text}」应为强调档`).toBe(tokens.emphasis);
    expect(row[1].weight).toBe(tokens.regular);
    expect(row[2].weight).toBe(tokens.regular);
  }
  expect(parseFloat(tokens.emphasis)).toBeGreaterThan(parseFloat(tokens.regular));
});

test("代码块：mono 12px / 行高 1.55，首行头部条走标签档字号", async ({ page }) => {
  await open(page, "types.md", TYPES_DOC, "引用块的一段文字");
  await expect(page.locator(".cm-lp-codeblock-line")).toHaveCount(3);

  const mono = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    probe.style.fontFamily = "var(--editor-mono-family)";
    document.body.append(probe);
    const family = getComputedStyle(probe).fontFamily;
    probe.remove();
    return { family, lhCode: root.getPropertyValue("--lh-code").trim(), fsBody: root.getPropertyValue("--fs-body").trim() };
  });
  const line = await page.locator(".cm-line.cm-lp-codeblock-line").nth(1).evaluate((el) => {
    const style = getComputedStyle(el);
    return { fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight };
  });
  expect(line.fontFamily).toBe(mono.family);
  // 12px = 正文锚 15 × .8em；行高 = 12 × 1.55
  expect(line.fontSize).toBe("12px");
  expect(mono.fsBody).toBe("15px");
  expect(line.lineHeight).toBe(`${12 * Number.parseFloat(mono.lhCode)}px`);

  // 头部条（块的首行围栏）：10.5px（零号档）+ 提示档文字色 + 正字距
  const head = await page.locator(".cm-line.cm-lp-codeblock-head").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return { fontSize: style.fontSize, letterSpacing: style.letterSpacing, color: style.color };
  });
  expect(head.fontSize).toBe("10.5px");
  expect(Number.parseFloat(head.letterSpacing)).toBeGreaterThan(0);
  const text3 = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--text-3)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  expect(head.color).toBe(text3);
});

test("引用块：2px 结构档竖线 + 次级正文色", async ({ page }) => {
  await open(page, "types.md", TYPES_DOC, "引用块的一段文字");
  const quote = await page.locator(".cm-line.cm-lp-quote-line").first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      borderLeftWidth: style.borderLeftWidth,
      borderLeftColor: style.borderLeftColor,
      color: style.color,
    };
  });
  const tokens = await page.evaluate(() => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const value = (name: string, prop: "borderLeftColor" | "color") => {
      probe.style.borderLeftColor = "";
      probe.style.color = "";
      probe.style[prop] = `var(${name})`;
      return getComputedStyle(probe)[prop];
    };
    const out = { border: value("--border", "borderLeftColor"), text2: value("--text-2", "color") };
    probe.remove();
    return out;
  });
  expect(quote.borderLeftWidth).toBe("2px");
  expect(quote.borderLeftColor).toBe(tokens.border);
  expect(quote.color).toBe(tokens.text2);
  // 已知缺口（如实登记，见 docs/backlog.md）：`.cm-lp-quote-line` 的 `padding-left` 当前**不生效**
  // ——CM baseTheme 的 `.cm-line { padding: 0 }` 与它同等特异性、注入更晚，实测计算值为 0px。
  // 这不是本 change 引入的（两份规则在 restyle 前就已同形），因此判据不把它写成合同；
  // 是否补一条更高特异性的内边距由视觉裁决（R4 逐张重建基线时看 render-quote-list 就能判断）。
});

test("列表：标记走 mono 强调档字号，悬挂缩进把首行标记推到行外", async ({ page }) => {
  await open(page, "types.md", TYPES_DOC, "一级项");
  await expect(page.locator(".cm-lp-list-marker").first()).toBeVisible();
  const read = await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>(".cm-line.cm-lp-list-first")!;
    const line = document.querySelector<HTMLElement>(".cm-line.cm-lp-list-line")!;
    const marker = first.querySelector<HTMLElement>(".cm-lp-list-marker")!;
    const markerStyle = getComputedStyle(marker);
    const probe = document.createElement("span");
    probe.style.fontFamily = "var(--editor-mono-family)";
    document.body.append(probe);
    const mono = getComputedStyle(probe).fontFamily;
    probe.remove();
    return {
      markerFontSize: markerStyle.fontSize,
      markerFamily: markerStyle.fontFamily,
      markerWidth: marker.getBoundingClientRect().width,
      mono,
      firstTextIndent: Number.parseFloat(getComputedStyle(first).textIndent),
      hangingPadding: Number.parseFloat(getComputedStyle(line).paddingInlineStart),
      contentFontSize: getComputedStyle(document.querySelector(".cm-content")!).fontSize,
    };
  });
  expect(read.markerFamily).toBe(read.mono);
  // 标记字号 = 正文锚 × .9（13.5px，tokens 文档的 13.5 档）
  expect(read.markerFontSize).toBe(`${Number.parseFloat(read.contentFontSize) * 0.9}px`);
  // 悬挂缩进：首行负缩进 = 标记盒宽（标记因此被推到正文左缘之外），
  // 内容行正内边距 > 0（续行回到正文左缘）——两条都是派生读数，不是「class 存在」
  expect(read.markerWidth).toBeGreaterThan(0);
  expect(read.firstTextIndent).toBeCloseTo(-read.markerWidth, 1);
  expect(read.hangingPadding).toBeGreaterThan(0);
});
