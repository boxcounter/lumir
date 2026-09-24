import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M119：callout 内容行在光标进入时显露 inline 格式源码标记（真实桌面缺陷：
// 光标所在行的「加粗」仍是渲染态而非编辑态）。口径同 M110 的行级显露
//（QuoteMark / [!type]）：选区触及节点所跨行即跳过样式与标记隐藏装饰；
// 仅 callout（detectCallout 命中的 blockquote）内的节点适用——普通引用
// 的 inline 格式保持渲染态，不受影响。

const CALLOUT_DOC = `# Callout 源码显露

> [!note] 标题
> 第一行 **加粗** 与 \`code\` 还有 *斜体*。
> 第二行正文。

> 普通引用 **加粗** 保持渲染。

末尾段落。
`;

async function openCalloutDoc(page: import("@playwright/test").Page) {
  await stubTauri(page, { entries: [{ path: "c.md", kind: "file", size: CALLOUT_DOC.length, mtime_ms: 0 }], files: { "c.md": CALLOUT_DOC } });
  await page.goto("/");
  await page.locator('.ft-row[title="c.md"]').click();
  await expect(page.locator(".cm-lp-callout-type")).toHaveCount(1);
}

test("光标进入 callout 内容行显露 inline 源码标记，离开恢复；普通引用不受影响", async ({ page }) => {
  await openCalloutDoc(page);
  const contentLine = page.locator(".cm-line.cm-lp-callout-line", { hasText: "第一行" });
  const quoteLine = page.locator(".cm-line.cm-lp-quote-line", { hasText: "普通引用" });

  // 默认渲染态：加粗/代码/斜体均有样式，源码标记不裸露
  await expect(contentLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  await expect(contentLine.locator(".cm-lp-inline-code", { hasText: "`code`" })).toHaveCount(1);
  await expect(contentLine.locator(".cm-lp-em", { hasText: "斜体" })).toHaveCount(1);
  await expect(contentLine).not.toContainText("**");

  // 光标进入（点击「加粗」词上）：该行显露完整源码标记，样式装饰消失
  await contentLine.locator(".cm-lp-strong").click();
  await expect(contentLine).toContainText("**加粗**");
  await expect(contentLine).toContainText("`code`");
  await expect(contentLine).toContainText("*斜体*");
  await expect(page.locator(".cm-lp-callout-line .cm-lp-strong")).toHaveCount(0);
  await expect(page.locator(".cm-lp-callout-line .cm-lp-inline-code")).toHaveCount(0);
  await expect(page.locator(".cm-lp-callout-line .cm-lp-em")).toHaveCount(0);
  // 行级口径：同一行的 > 引用标记也显露（M110 既有行为，口径一致）
  await expect(contentLine).toContainText(">");
  // 普通引用行不受影响：加粗仍渲染，** 不裸露
  await expect(quoteLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  await expect(quoteLine).not.toContainText("**");

  // 光标移入普通引用行的加粗范围：> 显露（M110 全引用通用），该强调范围也显露源码
  //（M168 起强调范围是节点范围级：光标落在范围内即显露该范围，与行级显露互不替代）
  await quoteLine.locator(".cm-lp-strong").click();
  await expect(quoteLine).toContainText(">");
  await expect(quoteLine).toContainText("**加粗**");
  await expect(quoteLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(0);
  // 反例对照：光标仍在这一行、但落在加粗范围之外（"保持渲染" 处）——行级显露照旧（> 可见），
  // 强调范围回到渲染态（** 不裸露）。这条把「节点范围级」与「行级」分开钉死。
  const afterBold = CALLOUT_DOC.indexOf("> 普通引用 **加粗**") + "> 普通引用 **加粗**".length + 1;
  await page.evaluate((pos) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  }, afterBold);
  await page.waitForTimeout(80);
  await expect(quoteLine).toContainText(">");
  await expect(quoteLine).not.toContainText("**");
  await expect(quoteLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  // callout 行恢复渲染态
  await expect(contentLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  await expect(contentLine).not.toContainText("**");

  // 光标移出所有引用：全部恢复渲染
  await page.locator(".cm-line", { hasText: "末尾段落" }).click();
  await expect(contentLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  await expect(quoteLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  expect(await readDocument(page)).toBe(CALLOUT_DOC);
});

test("callout 首行标题内的 inline 格式同样显露", async ({ page }) => {
  const TITLED = `> [!warning] 注意 **加粗** 标题
> 正文。
`;
  await stubTauri(page, { entries: [{ path: "t.md", kind: "file", size: TITLED.length, mtime_ms: 0 }], files: { "t.md": TITLED } });
  await page.goto("/");
  await page.locator('.ft-row[title="t.md"]').click();
  const firstLine = page.locator(".cm-line.cm-lp-callout-first");
  // 渲染态：[!warning] 替换为类型标签，标题内加粗渲染
  await expect(page.locator(".cm-lp-callout-type")).toHaveCount(1);
  await expect(firstLine.locator(".cm-lp-strong", { hasText: "加粗" })).toHaveCount(1);
  // 光标进入首行：[!warning] 源码显露（M110）且标题内 ** 同样显露（M119）
  await firstLine.locator(".cm-lp-strong").click();
  await expect(page.locator(".cm-lp-callout-type")).toHaveCount(0);
  await expect(firstLine).toContainText("[!warning]");
  await expect(firstLine).toContainText("**加粗**");
  expect(await readDocument(page)).toBe(TITLED);
});
