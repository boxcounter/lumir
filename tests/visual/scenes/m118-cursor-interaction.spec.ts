import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";

// M118 编辑器光标交互修复回归：
// 1. 表格内 Ctrl+N/P 逐 cell 行移动（相邻行进入首/末行、末行再按离开、列位保持、两方向对称）
// 2. cell 内 Ctrl+E 到行尾不再使整窗内容下挫
// 3. 块级公式（闭合 $$ 行带尾随空格）下方段落 Ctrl+B ≤3 次进入源码编辑

interface CursorSnap {
  head: number;
  line: number;
  col: number;
  caretLeft: number | null;
  scrollTop: number;
  blockWidgets: number;
}

async function snap(page: import("@playwright/test").Page): Promise<CursorSnap> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const main = view.state.selection.main;
    const line = view.state.doc.lineAt(main.head);
    const coords = view.coordsAtPos(main.head, main.assoc || 1);
    const scroller = document.querySelector(".cm-scroller")!;
    return {
      head: main.head,
      line: line.number,
      col: main.head - line.from,
      caretLeft: coords ? Math.round(coords.left * 10) / 10 : null,
      scrollTop: Math.round(scroller.scrollTop * 10) / 10,
      blockWidgets: document.querySelectorAll(".cm-lp-math-block").length,
    };
  });
}

async function setCursor(page: import("@playwright/test").Page, pos: number) {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: p } });
    view.focus();
  }, pos);
}

// 长文档的表格在第 61 行附近（30 段填充之后），doc-title 块落地后掉出 CM 初始渲染窗口
//（M221 复跑实证：waitFor('.cm-lp-table-scroll') 超时，快照里 24 段填充后直接 end-marker）。
// 揭示表格**下方** ~400 字符处：nearest 滚动把该 pos 贴到视口下缘，整张表随之进视口并被渲染
//（直接揭示表头 pos 只会把表头贴到下缘，表体行仍在视口外不渲染——probe 实证 cells 3 vs 9）。
// 用户滚到即渲染，这是 CM 虚拟渲染的正常行为，不是产品缺陷。
async function revealTable(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const text = view.state.doc.toString();
    const pos = Math.min(text.length, text.indexOf("| 数据 | 良好 | beta |") + 400);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  });
}

async function openDoc(page: import("@playwright/test").Page, name: string, doc: string) {
  await stubTauri(page, { entries: [{ path: name, kind: "file", size: doc.length, mtime_ms: 0 }], files: { [name]: doc } });
  await page.goto("/");
  await page.locator(`.ft-row[title="${name}"]`).click();
}

const TABLE_DOC = `上文段落。

| 名称 | 状态 | 备注 |
| --- | --- | --- |
| 表格 | 正常 | alpha |
| 数据 | 良好 | beta |

下文段落。
`;
// 行号：1=上文段落 2=空 3=表头 4=分隔 5=表格行 6=数据行 7=空 8=下文段落

test("表格内 Ctrl+N/P：相邻行进入、逐行移动、末行离开、两方向对称", async ({ page }) => {
  await openDoc(page, "table.md", TABLE_DOC);
  await page.locator(".cm-lp-table-scroll").waitFor();
  await setCursor(page, 2); // 行1「上文段落。」

  // 向下：行1 → 表头行3 → 行5 → 行6 → 行8（离开表格）
  const downLines: number[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Control+n");
    await page.waitForTimeout(60);
    downLines.push((await snap(page)).line);
  }
  expect(downLines).toEqual([3, 5, 6, 8]);

  // 向上（从行8）：行6（进入末行）→ 行5 → 行3 → 行1（离开表格）
  const upLines: number[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Control+p");
    await page.waitForTimeout(60);
    upLines.push((await snap(page)).line);
  }
  expect(upLines).toEqual([6, 5, 3, 1]);
});

test("表格内 Ctrl+N/P 保留列位", async ({ page }) => {
  await openDoc(page, "table-col.md", TABLE_DOC);
  await page.locator(".cm-lp-table-scroll").waitFor();
  await page.locator(".cm-lp-table-cell", { hasText: "正常" }).first().click();
  await page.waitForTimeout(80);
  const before = await snap(page);
  expect(before.line).toBe(5);

  await page.keyboard.press("Control+n");
  await page.waitForTimeout(60);
  const down = await snap(page);
  expect(down.line).toBe(6);
  expect(down.col).toBe(before.col); // 仍是第 2 列「数据」对应位置
  expect(down.caretLeft).not.toBeNull();
  expect(Math.abs(down.caretLeft! - before.caretLeft!)).toBeLessThanOrEqual(1);

  await page.keyboard.press("Control+p");
  await page.waitForTimeout(60);
  const up = await snap(page);
  expect(up.line).toBe(5);
  expect(up.col).toBe(before.col);
  expect(Math.abs(up.caretLeft! - before.caretLeft!)).toBeLessThanOrEqual(1);
});

const LONG_TABLE_DOC = (() => {
  const filler = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 段填充内容，用于撑起滚动区域，长度适中。`).join("\n\n");
  return `${filler}\n\n| 名称 | 状态 | 备注 |\n| --- | --- | --- |\n| 表格 | 正常 | alpha |\n| 数据 | 良好 | beta |\n\n${filler}\n`;
})();

test("cell 内 Ctrl+E 到当前 cell 内容右缘：内容不下挫、caret 可测", async ({ page }) => {
  await openDoc(page, "ctrl-e.md", LONG_TABLE_DOC);
  await revealTable(page);
  await page.locator(".cm-lp-table-scroll").waitFor();
  await page.locator(".cm-lp-table-cell", { hasText: "表格" }).first().click();
  await page.waitForTimeout(80);
  const before = await snap(page);
  expect(before.scrollTop).toBeGreaterThan(0); // 已滚离顶部，下挫才可观测

  await page.keyboard.press("Control+e");
  await page.waitForTimeout(120);
  const after = await snap(page);
  expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
  // M168 起落点单位是**当前 cell**（不再是整行行尾 = 末 cell）：`| 表格 | 正常 | alpha |`
  // 行内从首 cell 按 ⌃E，落在该 cell 内容右缘（"表格" 之后），不跨隐藏管道符。
  const lineInfo = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    return { from: line.from, to: line.to, text: line.text };
  });
  expect(lineInfo.text).toContain("alpha"); // 仍在同一表格行
  const contentRight = lineInfo.from + lineInfo.text.indexOf("表格") + "表格".length;
  expect(after.head).toBe(contentRight);
  // caret 按 assoc -1（可见侧）测量，坐标不退化
  const caretTop = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const c = view.coordsAtPos(view.state.selection.main.head, -1);
    return c ? c.top : null;
  });
  expect(caretTop).not.toBeNull();
  expect(caretTop!).toBeGreaterThan(0);
});

test("水平方向跨隐藏管道符（Ctrl+B/F）：内容不下挫", async ({ page }) => {
  await openDoc(page, "horiz.md", LONG_TABLE_DOC);
  await revealTable(page);
  await page.locator(".cm-lp-table-scroll").waitFor();
  await page.locator(".cm-lp-table-cell", { hasText: "正常" }).first().click();
  await page.waitForTimeout(80);
  const base = (await snap(page)).scrollTop;
  expect(base).toBeGreaterThan(0);

  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Control+b");
    await page.waitForTimeout(60);
    expect(Math.abs((await snap(page)).scrollTop - base)).toBeLessThanOrEqual(1);
  }
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Control+f");
    await page.waitForTimeout(60);
    expect(Math.abs((await snap(page)).scrollTop - base)).toBeLessThanOrEqual(1);
  }
});

// 原 6 次复现的关键结构：闭合 $$ 行带两个尾随空格，且与下方段落间有空行
const TRAIL2 = "# 数学\n\n$$\n\\int f(x)dx = F(b) - F(a)\n$$  \n\n失败降级：渲染失败时回退为可读源码。\n";

test("块级公式下方段落 Ctrl+B ≤3 次进入源码编辑", async ({ page }) => {
  await openDoc(page, "math.md", TRAIL2);
  await page.locator(".cm-lp-math-block").waitFor();
  await setCursor(page, TRAIL2.indexOf("失败降级") + 1); // 「失」字后

  // 第 1 次 → 行首；第 2 次 → 空行；第 3 次 → 进入公式源码（widget 消失）
  let entered = -1;
  for (let i = 1; i <= 4; i++) {
    await page.keyboard.press("Control+b");
    await page.waitForTimeout(60);
    const s = await snap(page);
    if (s.blockWidgets === 0) {
      entered = i;
      break;
    }
  }
  expect(entered).toBeGreaterThan(0);
  expect(entered).toBeLessThanOrEqual(3);
  // 落点在闭合 $$ 行（行5 "$$  "）
  const s = await snap(page);
  expect(s.line).toBe(5);
});

test("`$$ 注释` 可见尾巴：边界停靠保留，不被吞", async ({ page }) => {
  const DOC = "$$\nABC\n$$ 注释\n\n段落。\n";
  await openDoc(page, "math-vis.md", DOC);
  await page.locator(".cm-lp-math-block").waitFor();
  await setCursor(page, DOC.indexOf("$$ 注释") + "$$ 注释".length); // 注释行尾

  // 前 3 次逐字符停在可见尾巴上（widget 仍在渲染），第 4 次才进入源码
  for (let i = 1; i <= 3; i++) {
    await page.keyboard.press("Control+b");
    await page.waitForTimeout(60);
    const s = await snap(page);
    expect(s.blockWidgets).toBe(1);
    expect(s.line).toBe(3);
  }
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(60);
  const s = await snap(page);
  expect(s.blockWidgets).toBe(0); // 已进入源码编辑态
});
