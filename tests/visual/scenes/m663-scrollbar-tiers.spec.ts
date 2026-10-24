import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// M663（change scrollbar-tiers-oct24）：
//
// ui-design-system 的「滚动条分档与滚动容器注册表」条款的**行为面**判据。静态注册表
// （tests/unit/scrollbar-registry.test.ts）守「有没有归挡 / 声明对不对」，本场景守「在真实
// 文档里真的生效」：四个预览横滚容器取到 4px 细条声明、豁免档的 `.cm-scroller` 一条声明
// 都没有、宽表容器的 `scrollbar-gutter` 确实没了。
//
// 断言分两层（缺一层就退化成回读 CSS 文本）：
//   ① **区分度输入**：先证明容器确实横向溢出（`scrollWidth − clientWidth > 0`）——不溢出的
//      容器上量滚动条是空转（m628 的同一条口径）；
//   ② **读数**：计算档 `scrollbar-width === "thin"` + CSSOM 的 `::-webkit-scrollbar` 4px 声明。
//      厚度判据落在声明层：macOS overlay 条在 chromium 里不占布局（实测
//      `offsetWidth − clientWidth === 0`），像素厚度在这条通道上不存在。
//
// 唯一不适用①的注册消费者是 `.cm-lp-mermaid`：mermaid 自己的 `useMaxWidth` 把 svg 钳在容器宽内
// （实测 `scrollWidth === clientWidth`），横向溢出在当前渲染链上不可达——它登记归挡是为了形态
// 一致（renderer 换档时不需要重新定档），本场景对它只断言声明层，并显式钉住「当前不溢出」这个
// 事实，免得将来换成可溢出的渲染器时这条断言变成假绿。

const LONG_LINE = `const longIdentifier = mapCellsToViewportWithRoundTrip("${"x".repeat(180)}");`;

const WIDE_TABLE = `| 名称 | 说明 |\n| --- | --- |\n| alpha | ${"说明".repeat(40)} |\n`;

/** 22 项相加：实测自然宽 ~1991px，超过正文列 672px，块级公式因此横向溢出。 */
const WIDE_MATH = `$$\n${Array.from({ length: 22 }, (_, i) => `\\alpha_{${i}} + \\beta_{${i}}^{2}`).join(" + ")} = \\sum_{i=1}^{n} \\frac{x_{i}}{y_{i}}\n$$\n`;

const WIDE_MERMAID = `\`\`\`mermaid\ngraph LR\n  A[开始节点一个很长的名字用来撑宽图表] --> B[第二个同样很长的节点名称]\n  B --> C[第三个同样很长的节点名称]\n  C --> D[第四个同样很长的节点名称]\n\`\`\`\n`;

const DOC = `# 滚动条分档\n\n\`\`\`js\n${LONG_LINE}\n\`\`\`\n\n${WIDE_TABLE}\n${WIDE_MATH}\n${WIDE_MERMAID}`;

// 代码块横滚容器与宽表容器**共用** `.cm-lp-block-scroll` 这个类（M180 的键位命中判据靠它），
// 所以代码块那一路必须用 `:not(.cm-lp-table-scroll)` 收窄，否则会取到表格。
const CODE_BLOCK = ".cm-lp-block-scroll:not(.cm-lp-table-scroll)";
// query = 在页面上取元素用；css = 声明层的精确选择器（`:not()` 只用于查询，不在 CSS 里）
const THIN_CONTAINERS = [
  { query: CODE_BLOCK, css: ".cm-lp-block-scroll" },
  { query: ".cm-lp-table-scroll", css: ".cm-lp-table-scroll" },
  { query: ".cm-lp-math-block", css: ".cm-lp-math-block" },
  { query: ".cm-lp-mermaid", css: ".cm-lp-mermaid" },
];

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, { entries: [{ path: "scrollbar.md", kind: "file", size: DOC.length, mtime_ms: 0 }], files: { "scrollbar.md": DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="scrollbar.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("滚动条分档");
  // 四个块都渲染出来（公式 / mermaid 是 replace widget；mermaid 走懒加载 chunk，要等 settle）
  for (const { query } of THIN_CONTAINERS) await expect(page.locator(query).first()).toBeVisible();
  await expect(page.locator(".cm-lp-mermaid svg")).toBeVisible({ timeout: 15_000 });
}

/** CSSOM 的 `::-webkit-scrollbar` 规则，按**精确选择器**取（子串匹配会漏进同名前缀的类）。 */
type ScrollbarRule = { selector: string; width: string; height: string; display: string; cssText: string };

function scrollbarRules(page: Page): Promise<ScrollbarRule[]> {
  return page.evaluate(() => {
    const found: Array<{ selector: string; width: string; height: string; display: string; cssText: string }> = [];
    const walk = (list: CSSRuleList): void => {
      for (const rule of Array.from(list)) {
        const anyRule = rule as unknown as { selectorText?: string; style?: CSSStyleDeclaration; cssRules?: CSSRuleList };
        if (anyRule.cssRules) walk(anyRule.cssRules);
        if (anyRule.selectorText && anyRule.selectorText.includes("-webkit-scrollbar")) {
          found.push({
            selector: anyRule.selectorText,
            width: anyRule.style?.width ?? "",
            height: anyRule.style?.height ?? "",
            display: anyRule.style?.display ?? "",
            cssText: (anyRule.style?.cssText ?? "").replace(/\s+/g, " "),
          });
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      walk(list);
    }
    return found;
  });
}

function geometry(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) throw new Error(`找不到 ${sel}`);
    const s = getComputedStyle(el);
    return {
      overflowX: s.overflowX,
      overflowY: s.overflowY,
      scrollbarWidth: s.scrollbarWidth,
      scrollbarGutter: s.scrollbarGutter,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      // overlay 条的占位读数：必须为 0（chromium 的 overlay 条不占布局；非 0 说明某处退回了
      // 占位经典条，那会让整页基线与真实几何一起漂）
      widthBand: el.offsetWidth - el.clientWidth,
      heightBand: el.offsetHeight - el.clientHeight,
    };
  }, selector);
}

test("预览横向滚动面：先证明溢出，再断言 4px 细条声明（三主题无关的形态判据）", async ({ page }) => {
  await openDoc(page);
  const rules = await scrollbarRules(page);

  for (const { query, css } of THIN_CONTAINERS) {
    const geo = await geometry(page, query);
    expect(geo.overflowX, `${css} 的横向必须是滚动容器`).toBe("auto");
    // ① 区分度输入：mermaid 的 svg 由它自己的 useMaxWidth 钳在容器宽内，横向溢出不可达
    if (css === ".cm-lp-mermaid") {
      expect(geo.scrollWidth, `${css}：mermaid 目前不会横向溢出（换渲染器时这条会红，提醒重做判据）`).toBe(geo.clientWidth);
    } else {
      expect(geo.scrollWidth - geo.clientWidth, `${css} 必须横向溢出，否则本场景没有区分度`).toBeGreaterThan(120);
    }

    // ② 标准通道 + webkit 通道的声明层读数
    expect(geo.scrollbarWidth, `${css} 应取细条档`).toBe("thin");
    const bar = rules.find((r) => r.selector === `${css}::-webkit-scrollbar`);
    expect(bar, `缺 ${css}::-webkit-scrollbar 声明`).toBeTruthy();
    expect(bar!.height, `${css} 横向滚动条声明厚度`).toBe("4px");
    expect(bar!.width, `${css} 纵向滚动条声明厚度`).toBe("4px");
    const thumb = rules.find((r) => r.selector === `${css}::-webkit-scrollbar-thumb`);
    // `background: var(--border)` 在 CSSOM 里只保留在 shorthand 文本上（var() 不可解析，长属性为空），
    // 所以这条按声明文本断言。
    expect(thumb?.cssText, `${css} thumb 取 --border`).toContain("background: var(--border)");
    const track = rules.find((r) => r.selector === `${css}::-webkit-scrollbar-track`);
    // 轨道必须是「不涂色」：`background: transparent` 在 CSSOM 里会被序列化成初始值
    //（`background: 0px 0px;`），所以判据取「规则在 + 没给任何颜色」，字面值由单测的
    // 声明层对账（tests/unit/scrollbar-registry.test.ts 断言 `background: transparent`）。
    expect(track, `缺 ${css}::-webkit-scrollbar-track 声明`).toBeTruthy();
    expect(track!.cssText, `${css} 轨道不应涂色`).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(/);

    // overlay 条不占布局：这里读 0 才说明门禁环境的像素不受本次改动影响
    expect(geo.widthBand, `${css} 纵向占位（overlay 应为 0）`).toBe(0);
    expect(geo.heightBand, `${css} 横向占位（overlay 应为 0）`).toBe(0);
  }

  // 宽表容器的 scrollbar-gutter 已删（M177 的「可选动作」收口）
  expect((await geometry(page, ".cm-lp-table-scroll")).scrollbarGutter).toBe("auto");

  await page.locator(".cm-content").screenshot({ path: test.info().outputPath("m663-thin-scrollbars.png") });
});

test("编辑器主滚动归原生 overlay 豁免档：一条滚动条声明都没有", async ({ page }) => {
  await openDoc(page);
  const geo = await geometry(page, ".cm-scroller");
  expect(geo.overflowX).toBe("auto");
  expect(geo.overflowY).toBe("auto");
  // 标准通道没被改：写了 thin 会让纵向 overlay 条变细，等于偷偷改第三档
  expect(geo.scrollbarWidth).toBe("auto");
  // webkit 通道也没被改：写了 ::-webkit-scrollbar 就把两轴一起翻成占位经典条（M663 实测）
  const rules = await scrollbarRules(page);
  const scrollerRules = rules.filter((r) => r.selector.startsWith(".cm-scroller::"));
  expect(scrollerRules, `豁免档不该有 ::-webkit-scrollbar 规则：${JSON.stringify(scrollerRules.map((r) => r.selector))}`).toEqual([]);
});
