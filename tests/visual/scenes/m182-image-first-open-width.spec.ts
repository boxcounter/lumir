// M182 图片显示宽度不变量（属性测试）：fixture 扫「固有宽度分布 × 首开 / 切走切回两态」，
// 断言不变量本身，而不是某一个案例的读数。
//
// 不变量（条款原文见 docs/specs/image-reading.md §2）：
//   图片替换区的显示宽度只由「图片固有宽度 + 阅读栏宽」决定，MUST NOT 依赖加载时序 / 缓存命中 /
//   打开次序；同一引用在首开与重开（同一页面内切走再切回）必须收敛到同一 width。
//
// 区分度（REVIEW.md 第 1 条，已做反向验证）：**差异断言是「固有宽度不定的图按栏宽渲染」这一条**，
// 不是「两态相等」——修复前 chromium 下两态其实相等（都停在 300×100，见 percent-width.svg（原 zero-size.svg）的旧断言
// markdown-combo.spec.ts），只有「按栏宽」这条在修复前是红的。反向验证的做法：注释掉
// src/preview/theme.ts 里 `.cm-lp-image` 的 `width: "100%"`，本文件应红在 percent / percentWiki /
// viewboxOnly 三行；红输出留档 test-results/m182/。

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/markdown-combo/${name}`, import.meta.url), "utf8");

const doc = fixture("width-matrix.md");
const other = "# 另一篇\n\n正文。\n";

const assets: Record<string, string> = {
  "assets/sample.svg": fixture("sample.svg"),
  "assets/wide.svg": fixture("wide.svg"),
  "assets/percent-width.svg": fixture("percent-width.svg"),
  "assets/viewbox-only.svg": fixture("viewbox-only.svg"),
  "assets/zero-declared.svg": fixture("zero-declared.svg"),
  "assets/empty.png": fixture("empty.png"),
};

/** fixture 里九条引用的原文（widget 的 rawRef，也是 img 的 alt）。 */
const REFS = {
  wide: "![wide svg](assets/wide.svg)",
  fixed: "![fixed svg](assets/sample.svg)",
  percent: "![percent svg](assets/percent-width.svg)",
  percentWiki: "![[percent-width.svg]]",
  viewboxOnly: "![viewbox only](assets/viewbox-only.svg)",
  zeroDeclared: "![zero declared svg](assets/zero-declared.svg)",
  empty: "![empty bitmap](assets/empty.png)",
  missing: "![missing bitmap](assets/missing.png)",
  inline: "![inline svg](assets/sample.svg)",
} as const;

/** 固有宽度不定的三条（比例来自 viewBox，无固有像素尺寸）：终态宽度 = 栏宽。 */
const INDEFINITE = [REFS.percent, REFS.percentWiki, REFS.viewboxOnly];
/** 定固有宽度：终态宽度 = min(固有宽, 栏宽)。 */
const DEFINITE = {
  [REFS.wide]: { width: 2000, height: 600 },
  [REFS.fixed]: { width: 240, height: 80 },
  [REFS.inline]: { width: 240, height: 80 },
};
/** 解析或读取失败 / 解码不可见的四条：不得留下 img（走可见占位）。 */
const FALLBACK = [REFS.zeroDeclared, REFS.empty, REFS.missing];

interface Reading {
  box: { width: number; height: number };
  wrap: { width: number; height: number };
  inline: string | null;
  natural: string;
  complete: boolean | null;
}

/** 每条替换区的读数，键是引用原文（加载中 / 占位的文本前缀一并剥掉，两态键一致）。 */
async function readings(page: Page): Promise<{ line: number; areas: Record<string, Reading> }> {
  return page.evaluate(() => {
    const round = (n: number) => Math.round(n * 10) / 10;
    // 「栏宽」= **文字实测宽**（`.cm-content` 的内容盒），不是它的框宽：restyle 后
    // `.cm-content` 是 760px 的框（`--layout-doc-measure`，2026-09-26 修订）内含 44px 左右内边距，
    // 图片铺的是内容盒的 100%（672px）。旧口径下框宽与文字宽同值，这一条读法因此没被暴露。
    const content = document.querySelector(".cm-content");
    const contentStyle = content ? getComputedStyle(content) : null;
    const line = content && contentStyle
      ? round(
          content.getBoundingClientRect().width -
            Number.parseFloat(contentStyle.paddingLeft) -
            Number.parseFloat(contentStyle.paddingRight),
        )
      : 0;
    const areas: Record<
      string,
      {
        box: { width: number; height: number };
        wrap: { width: number; height: number };
        inline: string | null;
        natural: string;
        complete: boolean | null;
      }
    > = {};
    for (const el of Array.from(document.querySelectorAll(".cm-lp-image"))) {
      const img = el.querySelector("img") as HTMLImageElement | null;
      const text = img?.alt ?? el.textContent ?? "";
      const start = text.indexOf("![");
      if (start < 0) continue;
      // 键 = 引用原文：从 `![` 到首个 `)`（占位文案在引用之后还接了成因，须剥掉）；
      // 方言形态 `![[file]]` 没有 `)`，整段就是引用原文。
      const end = text.indexOf(")", start);
      const ref = (end > 0 ? text.slice(start, end + 1) : text.slice(start)).trim();
      const wrap = el.getBoundingClientRect();
      const box = img?.getBoundingClientRect();
      areas[ref] = {
        box: { width: round(box?.width ?? 0), height: round(box?.height ?? 0) },
        wrap: { width: round(wrap.width), height: round(wrap.height) },
        inline: img?.getAttribute("style") ?? null,
        natural: img ? `${img.naturalWidth}x${img.naturalHeight}` : "none",
        complete: img ? img.complete : null,
      };
    }
    return { line: round(line), areas };
  });
}

test("图片显示宽度不随时间/缓存变化，且只由固有宽度与栏宽决定", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await stubTauri(page, {
    entries: ["width-matrix.md", "other.md", ...Object.keys(assets), "assets/missing.png"].map((path) => ({
      path,
      kind: "file",
      size: doc.length,
      mtime_ms: 0,
    })),
    files: { "width-matrix.md": doc, "other.md": other, ...assets },
    links: {
      "![[percent-width.svg]]": {
        status: "resolved",
        path: "assets/percent-width.svg",
        candidates: [],
        embed_target: "attachment",
        anchor: { status: "none", heading: null, line: null },
      },
    },
  });
  // 读桩：先按真实时序（有延迟，图片字节晚一拍到）走首开。
  await page.addInitScript((map: Record<string, string>) => {
    const internals = (window as any).__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (command: string, argv: { path?: string }) => {
      if (command !== "fs_read_attachment") return original(command, argv);
      await new Promise((resolve) => setTimeout(resolve, 40));
      const content = map[argv.path ?? ""];
      if (content === undefined) throw { code: "fs_not_found", message: `文件不存在：${argv.path}` };
      const bytes = new TextEncoder().encode(content);
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary);
    };
  }, assets);
  await page.goto("/");

  await page.locator('.ft-row[title="width-matrix.md"]').click();
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0, { timeout: 20000 });
  const cold = await readings(page);

  // 切走再切回：同一次会话内，图片字节已缓存（warm 路径）。
  await page.locator('.ft-row[title="other.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("另一篇");
  await page.locator('.ft-row[title="width-matrix.md"]').click();
  await expect(page.locator(".cm-lp-image-status")).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator(".cm-lp-image img")).toHaveCount(6);
  const warm = await readings(page);

  // 1) 两态收敛（同一引用的两态读数逐项相同）。
  expect(warm.line).toBe(cold.line);
  expect(Object.keys(warm.areas).sort()).toEqual(Object.keys(cold.areas).sort());
  for (const ref of Object.keys(cold.areas)) {
    expect(warm.areas[ref], `两态读数不一致：${ref}`).toEqual(cold.areas[ref]);
  }

  const line = cold.line;
  // 2) 固有宽度不定的图按栏宽渲染（**修复的判别断言**：修复前停在 300 或加载状态块宽度）。
  for (const ref of INDEFINITE) {
    const area = cold.areas[ref];
    expect(area, `缺少替换区：${ref}`).toBeDefined();
    expect(Math.abs(area.box.width - line), `${ref} 未按栏宽渲染（读得 ${area.box.width}，栏宽 ${line}）`).toBeLessThanOrEqual(1);
    expect(area.inline, `${ref} 不应依赖写死的像素宽度`).toBe(null);
  }
  // 3) 定固有宽度的图：宽度 = min(固有宽, 栏宽)，不拉伸。
  for (const [ref, natural] of Object.entries(DEFINITE)) {
    const area = cold.areas[ref];
    expect(area, `缺少替换区：${ref}`).toBeDefined();
    expect(area.natural).toBe(`${natural.width}x${natural.height}`);
    expect(area.box.width, `${ref} 的显示宽度`).toBeCloseTo(Math.min(natural.width, line), 1);
  }
  // 4) 失败 / 不可见形态仍然走可见占位（M178 的可见回退不变量不许被本修复连带破坏）：
  //    该替换区留下的可见内容是占位块（没有 img 节点），占位的可见高度非零由下面第 5 组兜住。
  for (const ref of FALLBACK) {
    const area = cold.areas[ref];
    expect(area, `缺少替换区：${ref}`).toBeDefined();
    expect(area.natural, `${ref} 不应留下 img`).toBe("none");
  }
  // 5) 任何替换区都不得是零高度空白（M178 的可见回退不变量）；有 img 的还要求图片本身可见。
  for (const [ref, area] of Object.entries(cold.areas)) {
    expect(area.wrap.height, `${ref} 替换区零高度`).toBeGreaterThan(0);
    if (area.natural !== "none") expect(area.box.height, `${ref} 图片零高度`).toBeGreaterThan(0);
  }
});
