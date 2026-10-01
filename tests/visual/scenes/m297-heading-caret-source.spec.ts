import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M297（Alex 2026-10-01 实测：「Markdown 文件中，光标放在 Headings 行上时，没有出现 #，
// 导致无法编辑」）：live preview 里标题的 `#` 定界符此前被**无条件**隐藏，光标落在 Headings
// 行上也看不到 `#`、进不了编辑态——它是全仓唯一没有 reveal 判据的隐藏标记（同族的 QuoteMark /
// HorizontalRule / callout 都有）。本场景钉住修好后的口径（条款见
// openspec/specs/editor-live-preview/spec.md 的「光标触及即显露源码」与「判定单位」）：
// - 光标触及标题行（含行首 `line.from`、行尾 `line.to`）⇒ 该行显露 `#` 原文，层级样式保留；
// - 光标在别处 ⇒ 标题保持渲染态（`#` 不出现），同一文档里的其它标题不受影响；
// - 光标落在标题行的**前一行末位**（不相接）时不显露——含端点相接不外溢到相邻行；
// - 各状态下 `EditorState.doc` 逐字节不变（ADR 0003 §3 铁律）。

const DOC = ["导语段落。", "", "# 一级标题", "", "正文甲。", "", "## 二级标题 ##", ""].join("\n");

const H1_RAW = "# 一级标题";
const H1_FROM = DOC.indexOf(H1_RAW);
const H1_TO = H1_FROM + H1_RAW.length;
const H2_RAW = "## 二级标题 ##";
const H2_FROM = DOC.indexOf(H2_RAW);

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "h.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "h.md": DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="h.md"]').click();
  await expect(page.locator(".cm-lp-h1")).toHaveCount(1);
}

function lineOf(page: Page, fragment: string) {
  return page.locator(".cm-line", { hasText: fragment }).first();
}

/** 把光标放到文档位置（空光标），与 m168 场景同一口径。 */
async function setCursor(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
  await page.waitForTimeout(80);
}

test("光标触及标题行即显露 # 定界符（含行首 / 行尾），移开恢复；层级样式保留、文档逐字节不变", async ({ page }) => {
  await openDoc(page);
  const h1 = lineOf(page, "一级标题");
  const h2 = lineOf(page, "二级标题");

  // 渲染态前置条件（否则后面的「不露」可能在没渲染的行上空转）：光标在导语段，两个标题都不露源码。
  await setCursor(page, 0);
  await expect(h1, "光标不在标题行时不应露 #").not.toContainText(H1_RAW);
  await expect(h2, "光标不在标题行时不应露 ##").not.toContainText(H2_RAW);
  // 正观测：渲染态下两行都带各自的层级类（证明「不露」不是因为这两行根本没渲染）。
  await expect(h1).toHaveClass(/cm-lp-h1/);
  await expect(h2).toHaveClass(/cm-lp-h2/);

  // 点标题文字 → 光标进入该行（Alex 报告的操作路径）→ 显露 `#` 原文，层级样式保留。
  await h1.click();
  await page.waitForTimeout(80);
  await expect(h1, "光标在标题行上时应显露 #").toContainText(H1_RAW);
  await expect(h1, "显露态保留 h1 层级样式").toHaveClass(/cm-lp-h1/);
  await expect(h2, "另一标题行不受影响").not.toContainText(H2_RAW);

  // 光标移到正文 → 恢复渲染态。
  await lineOf(page, "正文甲").click();
  await page.waitForTimeout(80);
  await expect(h1, "光标移开后应恢复渲染态").not.toContainText(H1_RAW);

  // 行首空光标（line.from）同样显露——行级严格重叠会漏掉这一位，这正是判据取含端点的理由。
  await setCursor(page, H1_FROM);
  await expect(h1, "行首空光标应显露 #").toContainText(H1_RAW);
  // 行尾空光标（line.to）同样显露。
  await setCursor(page, H1_TO);
  await expect(h1, "行尾空光标应显露 #").toContainText(H1_RAW);
  // 区分度对照：前一行末位（不相接）保持渲染态——含端点相接不外溢到相邻行。
  await setCursor(page, H1_FROM - 1);
  await expect(h1, "前一行末位不应显露").not.toContainText(H1_RAW);

  // 带结尾 `#` 的标题：行内任一位都显露整行定界符（开头与结尾的 `##` 一并出现）。
  await setCursor(page, H2_FROM + 3);
  await expect(h2, "标题行内任一位都应显露整行定界符").toContainText(H2_RAW);
  await expect(h1, "移开后 h1 恢复渲染态").not.toContainText(H1_RAW);

  expect(await readDocument(page)).toBe(DOC);
});
