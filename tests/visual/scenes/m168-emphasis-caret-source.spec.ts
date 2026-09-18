import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M168 ①：live preview「选区触及范围即显露源码」不变量——强调范围（StrongEmphasis /
// Emphasis / Strikethrough）纳入同族（此前该显露只覆盖 callout 行的 inline 标记与
// 标准链接整条）。缺陷（Alex 2026-09-18 实测）：「光标放在粗体文字内容中时没有进入
// 编辑状态」——`**` 被装饰隐藏，光标在范围里也只能看到渲染态。
//
// 判据（条款见 openspec/specs/editor-live-preview/spec.md 的「光标触及即显露源码」）：
// - 选区与节点范围**相接（含端点）**⇒ 该范围整段显露源码，样式装饰让位；
// - 相接的范围只限该节点本身（不是行级）——同一行的其它 inline 标记仍保持渲染态；
// - 移开后恢复渲染态；三种状态下 `EditorState.doc` 逐字节不变（ADR 0003 §3 铁律）。
// fixture 是范围类型的矩阵（粗体/斜体/删除线 × 标题/段落/列表/引用/表格 cell）。

const DOC = `# 标题 **H粗** 尾

段落 **P粗** 与 *P斜* 与 ~~P删~~。

- 列表 **L粗** 尾

> 引用 **Q粗** 尾

| 甲 | 乙 |
| --- | --- |
| **T粗** | 平文 |

末尾段。
`;

interface SpanCase {
  id: string;
  /** 该范围所在行的一个唯一片段（定位 .cm-line 用）。 */
  line: string;
  /** 该范围的样式装饰选择器（渲染态存在的标记）；带 `.` 前缀，Playwright 的 locator() 里
   *  没有前缀会被当元素类型选择器（`cm-lp-strong` 元素不存在 → 恒 0 匹配，断言空转）。 */
  cls: ".cm-lp-strong" | ".cm-lp-em" | ".cm-lp-strike";
  /** 渲染态可见的显示文本。 */
  text: string;
  /** 源码原文（编辑态应整段可见）。 */
  raw: string;
}

const SPANS: SpanCase[] = [
  { id: "标题内粗体", line: "标题", cls: ".cm-lp-strong", text: "H粗", raw: "**H粗**" },
  { id: "段落内粗体", line: "段落", cls: ".cm-lp-strong", text: "P粗", raw: "**P粗**" },
  { id: "段落内斜体", line: "段落", cls: ".cm-lp-em", text: "P斜", raw: "*P斜*" },
  { id: "段落内删除线", line: "段落", cls: ".cm-lp-strike", text: "P删", raw: "~~P删~~" },
  { id: "列表内粗体", line: "列表", cls: ".cm-lp-strong", text: "L粗", raw: "**L粗**" },
  { id: "引用内粗体", line: "引用", cls: ".cm-lp-strong", text: "Q粗", raw: "**Q粗**" },
  { id: "表格 cell 内粗体", line: "T粗", cls: ".cm-lp-strong", text: "T粗", raw: "**T粗**" },
];

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, { entries: [{ path: "e.md", kind: "file", size: DOC.length, mtime_ms: 0 }], files: { "e.md": DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="e.md"]').click();
  await expect(page.locator(".cm-lp-table-scroll")).toHaveCount(1);
}

function lineOf(page: Page, fragment: string) {
  return page.locator(".cm-line", { hasText: fragment }).first();
}

/** 把光标放到文档位置（空光标），模拟「光标放进范围里」。 */
async function setCursor(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
  await page.waitForTimeout(80);
}

test("光标进入强调范围即显露该范围源码，移开恢复；文档逐字节不变", async ({ page }) => {
  await openDoc(page);

  // 渲染态前置条件（否则后面的断言在空输入上空转）：全部范围都有样式装饰、源码标记不可见
  for (const c of SPANS) {
    await expect(lineOf(page, c.line), `${c.id} 渲染态不应露出源码`).not.toContainText(c.raw);
  }
  const paragraph = lineOf(page, "段落");
  await expect(paragraph.locator(".cm-lp-strong", { hasText: "P粗" })).toHaveCount(1);
  await expect(paragraph.locator(".cm-lp-em", { hasText: "P斜" })).toHaveCount(1);
  await expect(paragraph.locator(".cm-lp-strike", { hasText: "P删" })).toHaveCount(1);

  for (const c of SPANS) {
    const line = lineOf(page, c.line);
    const span = line.locator(c.cls, { hasText: c.text });
    await expect(span, `${c.id} 的样式装饰应存在`).toHaveCount(1);
    // 点击范围内容 → 光标进入范围（Alex 报告的操作路径）
    await span.click();
    await page.waitForTimeout(80);
    await expect(line, `${c.id}：光标在范围内时该范围应整段显露源码`).toContainText(c.raw);
    await expect(line.locator(c.cls, { hasText: c.text }), `${c.id}：显露时该范围的样式装饰应让位`).toHaveCount(0);
    // 离开（点到末尾段）→ 恢复渲染态
    await lineOf(page, "末尾段").click();
    await page.waitForTimeout(80);
    await expect(line, `${c.id}：光标移开后应恢复渲染态`).not.toContainText(c.raw);
    await expect(line.locator(c.cls, { hasText: c.text }), `${c.id}：移开后样式装饰应恢复`).toHaveCount(1);
  }

  expect(await readDocument(page)).toBe(DOC);
});

test("显露只限光标相接的那个范围：同一行的其它 inline 标记保持渲染态", async ({ page }) => {
  await openDoc(page);
  const paragraph = lineOf(page, "段落");

  // 光标进入粗体范围：只有粗体显露，斜体/删除线不受影响（范围级口径，不是行级）
  await paragraph.locator(".cm-lp-strong", { hasText: "P粗" }).click();
  await page.waitForTimeout(80);
  await expect(paragraph).toContainText("**P粗**");
  await expect(paragraph).not.toContainText("*P斜*");
  await expect(paragraph).not.toContainText("~~P删~~");
  await expect(paragraph.locator(".cm-lp-em", { hasText: "P斜" })).toHaveCount(1);
  await expect(paragraph.locator(".cm-lp-strike", { hasText: "P删" })).toHaveCount(1);

  // 光标进入斜体范围：斜体显露、粗体恢复渲染
  await paragraph.locator(".cm-lp-em", { hasText: "P斜" }).click();
  await page.waitForTimeout(80);
  await expect(paragraph).toContainText("*P斜*");
  await expect(paragraph).not.toContainText("**P粗**");
  await expect(paragraph.locator(".cm-lp-strong", { hasText: "P粗" })).toHaveCount(1);

  expect(await readDocument(page)).toBe(DOC);
});

test("范围端点相接同样显露（端点邻接位两侧均有隐藏标记，必须有可编辑态）", async ({ page }) => {
  await openDoc(page);
  const paragraph = lineOf(page, "段落");
  const rawFrom = DOC.indexOf("**P粗**");
  const rawTo = rawFrom + "**P粗**".length;

  // 范围起点（`**` 之前）与终点（`**` 之后）都是与隐藏标记相接的空光标位
  for (const [label, pos] of [["起点", rawFrom], ["终点", rawTo]] as const) {
    await setCursor(page, pos);
    await expect(paragraph, `${label}相接：应显露源码`).toContainText("**P粗**");
    await expect(paragraph.locator(".cm-lp-strong", { hasText: "P粗" })).toHaveCount(0);
  }

  // 反向对照：范围前一字符位不相接，保持渲染态（断言有区分度）
  await setCursor(page, rawFrom - 1);
  await expect(paragraph).not.toContainText("**P粗**");
  await expect(paragraph.locator(".cm-lp-strong", { hasText: "P粗" })).toHaveCount(1);

  expect(await readDocument(page)).toBe(DOC);
});
