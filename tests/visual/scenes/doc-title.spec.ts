import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// doc-title / doc-meta 块（M218 A1，M216 gap 表 §2.2 缺失项）：定稿 12 张内容屏全部含此块。
// 判据 = 定稿 24px/680/1.28/-0.012em 标题 + 12px text-3 meta 三要素（路径 · 行数 · 修改于，
// tabular-nums）+ 位置 = fm 区之后正文之前 + 无文件上下文不渲染。
// CSS 在 theme.ts:316-339，widget 在 livePreview.ts:381-448，格式化 helper 在
// src/preview/doc-meta.ts（纯函数层由 tests/unit/content-restyle.test.ts 钉，本文件钉渲染层）。

// mtime 取「今年 9 月 20 日正午」：formatDocDate 的同年分支输出「9月20日」，跨年运行也不漂。
const MTIME_MS = new Date(new Date().getFullYear(), 8, 20, 12).getTime();

const FM_DOC = ["---", "title: 季度报告", "status: active", "---", "# 正文标题", "", "正文第一段。"].join("\n");
const PLAIN_DOC = ["# 朴素文档", "", "只有两段。", "", "尾段。"].join("\n");
const NO_MTIME_DOC = ["# 无时间文档", "", "正文。"].join("\n");

const VAULT = {
  entries: [
    { path: "docs", kind: "dir", size: 0, mtime_ms: MTIME_MS },
    { path: "docs/reports", kind: "dir", size: 0, mtime_ms: MTIME_MS },
    { path: "docs/reports/quarterly.md", kind: "file", size: FM_DOC.length, mtime_ms: MTIME_MS },
    { path: "plain.md", kind: "file", size: PLAIN_DOC.length, mtime_ms: MTIME_MS },
    { path: "no-mtime.md", kind: "file", size: NO_MTIME_DOC.length },
  ],
  files: {
    "docs/reports/quarterly.md": FM_DOC,
    "plain.md": PLAIN_DOC,
    "no-mtime.md": NO_MTIME_DOC,
  },
};

async function openFile(page: import("@playwright/test").Page, path: string): Promise<void> {
  // 目录行要逐级展开（app-main.spec.ts 的同口径）
  const parts = path.split("/");
  for (let i = 1; i < parts.length; i++) {
    await page.locator(`.ft-row[title="${parts.slice(0, i).join("/")}"]`).click();
  }
  await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".cm-lp-doc-title-outer")).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
});

test("有 fm：标题 24px/680/1.28/-0.012em，meta 三要素（路径 · 行数 · 修改于）", async ({ page }) => {
  await openFile(page, "docs/reports/quarterly.md");

  const title = page.locator(".cm-lp-doc-title");
  await expect(title).toHaveText("quarterly"); // basename 去扩展名
  const titleStyle = await title.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fontSize: cs.fontSize, fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing };
  });
  expect(titleStyle.fontSize).toBe("24px");
  expect(titleStyle.fontWeight).toBe("680");
  expect(parseFloat(titleStyle.lineHeight) / parseFloat(titleStyle.fontSize)).toBeCloseTo(1.28, 2);
  expect(parseFloat(titleStyle.letterSpacing) / parseFloat(titleStyle.fontSize)).toBeCloseTo(-0.012, 3);

  // meta：12px / text-3 / tabular-nums；三段 = 父目录（「 / 」分隔）· 行数 · 修改于
  const meta = page.locator(".cm-lp-doc-meta");
  const metaStyle = await meta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement("span");
    probe.style.color = "var(--text-3)";
    document.body.append(probe);
    const text3 = getComputedStyle(probe).color;
    probe.remove();
    return {
      fontSize: cs.fontSize,
      color: cs.color,
      text3,
      numeric: cs.fontVariantNumeric,
      segments: [...el.children].map((c) => c.textContent),
    };
  });
  expect(metaStyle.fontSize).toBe("12px");
  expect(metaStyle.color).toBe(metaStyle.text3);
  expect(metaStyle.numeric).toBe("tabular-nums");
  expect(metaStyle.segments).toEqual(["docs / reports", "·", "7 行", "·", "修改于 9月20日"]);

  // 分隔符用 --border 色（比 meta 正文更弱一档）
  const sepColor = await page.locator(".cm-lp-doc-meta-sep").first().evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--border)";
    document.body.append(probe);
    const border = getComputedStyle(probe).color;
    probe.remove();
    return { sep: getComputedStyle(el).color, border };
  });
  expect(sepColor.sep).toBe(sepColor.border);

  // 位置：fm 区之后、正文之前（DOM 序 + 纵向几何双重钉）
  const order = await page.evaluate(() => {
    const fm = document.querySelector(".cm-lp-frontmatter-outer")!;
    const titleOuter = document.querySelector(".cm-lp-doc-title-outer")!;
    const firstLine = document.querySelector(".cm-content .cm-line")!;
    return {
      fmBeforeTitle: !!(titleOuter.compareDocumentPosition(fm) & Node.DOCUMENT_POSITION_PRECEDING),
      titleBeforeBody: !!(firstLine.compareDocumentPosition(titleOuter) & Node.DOCUMENT_POSITION_PRECEDING),
      fmBottom: fm.getBoundingClientRect().bottom,
      titleTop: titleOuter.getBoundingClientRect().top,
      titleBottom: titleOuter.getBoundingClientRect().bottom,
      bodyTop: firstLine.getBoundingClientRect().top,
    };
  });
  expect(order.fmBeforeTitle).toBe(true);
  expect(order.titleBeforeBody).toBe(true);
  expect(order.titleTop).toBeGreaterThanOrEqual(order.fmBottom - 1);
  expect(order.titleBottom).toBeLessThanOrEqual(order.bodyTop + 1);
});

test("无 fm：钉在文档首行之前；根目录文件省略路径段", async ({ page }) => {
  await openFile(page, "plain.md");
  await expect(page.locator(".cm-lp-frontmatter-outer")).toHaveCount(0);
  await expect(page.locator(".cm-lp-doc-title")).toHaveText("plain");
  const segments = await page.locator(".cm-lp-doc-meta").evaluate((el) => [...el.children].map((c) => c.textContent));
  expect(segments).toEqual(["5 行", "·", "修改于 9月20日"]);

  // 位置：块是 cm-content 的第一个孩子（文档首行之前）
  const first = await page.evaluate(() => {
    const content = document.querySelector(".cm-content")!;
    const titleOuter = document.querySelector(".cm-lp-doc-title-outer")!;
    const firstLine = content.querySelector(".cm-line")!;
    return {
      isFirstChild: content.firstElementChild === titleOuter,
      titleBottom: titleOuter.getBoundingClientRect().bottom,
      bodyTop: firstLine.getBoundingClientRect().top,
    };
  });
  expect(first.isFirstChild).toBe(true);
  expect(first.titleBottom).toBeLessThanOrEqual(first.bodyTop + 1);
});

test("mtime 取不到：省略「修改于」段，不报错、不阻断渲染", async ({ page }) => {
  await openFile(page, "no-mtime.md");
  await expect(page.locator(".cm-lp-doc-title")).toHaveText("no-mtime");
  const segments = await page.locator(".cm-lp-doc-meta").evaluate((el) => [...el.children].map((c) => c.textContent));
  expect(segments).toEqual(["3 行"]);
  await expect(page.locator(".cm-lp-doc-meta")).not.toContainText("修改于");
});

test("无文件上下文（未打开任何文件）不渲染 doc-title 块", async ({ page }) => {
  await expect(page.locator(".cm-lp-doc-title-outer")).toHaveCount(0);
});
