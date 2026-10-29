import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// 回归（M103）：修复前编辑器未装 keymap，ArrowUp/Down 与 macOS Ctrl-P/N 全走原生
// contenteditable 路径——光标越出视口时浏览器延迟揭示，实测 scrollTop 单次跳 ~388px
// （整屏突变）。修复后由 CM6 moveVertically 逐行移动 + y:"nearest" 最小滚动跟随。

const LINES = Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 行正文内容，用于撑起足够长的文档。`);
const SOURCE = LINES.join("\n\n");
const LINE_HEIGHT = 28; // 16px * 1.75

interface MotionSample {
  scrollTop: number;
  caretTop: number;
  caretBottom: number;
  scrollerTop: number;
  scrollerBottom: number;
  head: number;
  docLength: number;
}

async function sample(page: import("@playwright/test").Page): Promise<MotionSample> {
  return page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller")!;
    const sRect = scroller.getBoundingClientRect();
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const head: number = view.state.selection.main.head;
    const coords = view.coordsAtPos(head);
    return {
      scrollTop: scroller.scrollTop,
      caretTop: coords?.top ?? -1,
      caretBottom: coords?.bottom ?? -1,
      scrollerTop: sRect.top,
      scrollerBottom: sRect.bottom,
      head,
      docLength: view.state.doc.length,
    };
  });
}

async function expectSmoothFollow(page: import("@playwright/test").Page, key: string, presses: number, direction: 1 | -1) {
  let prev = await sample(page);
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press(key);
    // CM6 在 measure 阶段（rAF）应用滚动，等一帧再采样
    await page.waitForTimeout(50);
    const cur = await sample(page);
    // 光标逐行移动；到达文档边界后停在边界（head 不变是合法的）
    const atDocBoundary = direction > 0 ? cur.head >= cur.docLength : cur.head === 0;
    expect(cur.head !== prev.head || atDocBoundary, `${key} 第 ${i + 1} 次按键光标未移动且不在文档边界`).toBeTruthy();
    // 光标始终位于视口内（滚动跟随后）
    expect(cur.caretBottom, `${key} 第 ${i + 1} 次按键后光标不得落在视口下方`).toBeLessThanOrEqual(cur.scrollerBottom + 1);
    expect(cur.caretTop, `${key} 第 ${i + 1} 次按键后光标不得落在视口上方`).toBeGreaterThanOrEqual(cur.scrollerTop - 1);
    // 滚动顺滑跟随：正常移动单次 ≤ 1 行；文档边界处光标可能一次走 2 行
    // （跳过空行）并叠加边界归位，放宽到 4 行——修复前实测单次跳 ~388px（14 行）。
    const delta = cur.scrollTop - prev.scrollTop;
    expect(delta * direction, `${key} 第 ${i + 1} 次按键滚动方向错误`).toBeGreaterThanOrEqual(0);
    expect(Math.abs(delta), `${key} 第 ${i + 1} 次按键滚动幅度 ${Math.abs(delta)}px 超过阈值`).toBeLessThanOrEqual(LINE_HEIGHT * 4);
    prev = cur;
  }
}

test("垂直光标移动：ArrowDown/ArrowUp 与 Ctrl-N/P 越出视口时顺滑跟随", async ({ page }) => {
  await stubTauri(page, { entries: [{ path: "long.md", kind: "file", size: SOURCE.length, mtime_ms: 0 }], files: { "long.md": SOURCE } });
  await page.goto("/");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第 1 行");
  // 光标放到第一行行首
  await page.locator(".cm-line").first().click({ position: { x: 4, y: 4 } });
  const start = await sample(page);
  expect(start.head).toBeLessThan(LINES[0].length);

  // 视口约 26 行：40 次下移必然多次越出底边
  await expectSmoothFollow(page, "ArrowDown", 40, 1);
  await expectSmoothFollow(page, "Control+n", 10, 1);
  await expectSmoothFollow(page, "ArrowUp", 40, -1);
  await expectSmoothFollow(page, "Control+p", 10, -1);

  // 只动选区，不动文档
  expect(await readDocument(page)).toBe(SOURCE);
});

test("边界行为：Cmd+A→ArrowDown 折叠选区并揭示光标，末/首行垂直移动兜底到行尾/行首", async ({ page }) => {
  // r1 review P2：折叠分支缺 scrollIntoView（光标不可见）；文档边界缺
  // moveToLineBoundary 兜底（末行中段 ArrowDown 无动作）。
  await stubTauri(page, { entries: [{ path: "long.md", kind: "file", size: SOURCE.length, mtime_ms: 0 }], files: { "long.md": SOURCE } });
  await page.goto("/");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第 1 行");
  await page.locator(".cm-line").first().click({ position: { x: 4, y: 4 } });

  // P2-1：Cmd+A 全选 → ArrowDown 折叠到文档末尾，滚动跟随、光标可见
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(80);
  const collapsed = await sample(page);
  expect(collapsed.head).toBe(collapsed.docLength);
  expect(collapsed.scrollTop).toBeGreaterThan(0);
  expect(collapsed.caretBottom).toBeLessThanOrEqual(collapsed.scrollerBottom + 1);
  expect(collapsed.caretTop).toBeGreaterThanOrEqual(collapsed.scrollerTop - 1);

  // P2-2：末行中段 ArrowDown → 兜底移到行尾（修复前原地不动）
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const lastLine = view.state.doc.line(view.state.doc.lines);
    view.dispatch({ selection: { anchor: lastLine.from + 5 } });
  });
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(50);
  const lineEnd = await sample(page);
  expect(lineEnd.head).toBe(lineEnd.docLength);
  // 再按一次：行尾 ArrowDown 仍原地，不报错不滚动
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(50);
  const atEnd = await sample(page);
  expect(atEnd.head).toBe(atEnd.docLength);
  expect(atEnd.scrollTop).toBe(lineEnd.scrollTop);

  // P2-2 对称方向：首行中段 ArrowUp → 兜底移到行首
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: 5 } });
  });
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(50);
  expect((await sample(page)).head).toBe(0);

  expect(await readDocument(page)).toBe(SOURCE);
});

// ---------------------------------------------------------------------------
// M795（Alex 2026-10-29 报告）：列表行的水平导航
// ---------------------------------------------------------------------------
//
// 缺陷：`1. aaaaa` 这一行，光标在可见行首（序号之前）时
//   - 按 →：原生 caret 先停在 CM 给不可编辑 marker widget 插的 `cm-widgetBuffer` 上（文档位置
//     不变），再按一次才进正文；
//   - 按 ⌃F：`moveByChar` 按文档位置逐字符走，隐藏的 `1`、`.`、空格各占一步——要 3 次才进正文。
// 合同：docs/specs/editor-caret.md 的 C6 与 docs/specs/lists.md 的 L5——隐藏源码区间是**一个
// 原子步**。本条判据（与实现不同源）：
//   - 期望落点由**DOM 文本节点**反查（`posAtDOM`）与 `Intl.Segmenter` 给出，不读 `lists.ts`
//     的区间判定；
//   - 每个方向都要求「一次到位 + 之后逐字素 + 反向对称」，并逐次比对文档字节不变。

const NAV_DOC = [
  "# 列表导航（合成 fixture）",
  "",
  "1. aaaaa",
  "- bbbbb",
  "- [ ] ccccc",
  "",
  "10. ddddd",
  "",
  "> - eeeee",
  "",
  "- ggg\u{1F469}\u200D\u{1F469}\u200D\u{1F467}jjj",
  "  - hhhhh",
  "    - iiiii",
  "",
  "正文段落对照。",
  "",
].join("\n");

/** 文档里的下一个 / 上一个**字素簇边界**（用 `Intl.Segmenter`，与 CM 的 moveByChar 同口径但
 *  实现无关：判据按 Unicode 字素簇定义写，不按编辑器内部实现写）。 */
function nextCluster(text: string, index: number): number {
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  for (const { segment, index: at } of seg.segment(text)) {
    if (at === index) return index + segment.length;
  }
  return index + 1;
}

function prevCluster(text: string, index: number): number {
  const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
  let prev = index;
  for (const { segment, index: at } of seg.segment(text)) {
    if (at + segment.length === index) return at;
    if (at >= index) break;
    prev = at;
  }
  return prev;
}

interface NavLine {
  lineFrom: number;
  contentFrom: number;
  text: string;
  head: number;
}

/** 定位一条列表行：行首 = 该行第一个字符的文档位置，正文起点 = 正文文本节点的文档位置。 */
async function navLine(page: Page, needle: string): Promise<NavLine> {
  return page.evaluate((text) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    const lines = Array.from(document.querySelectorAll<HTMLElement>(".cm-line"));
    const line = lines.find((el) => (el.textContent ?? "").includes(text));
    if (!line) throw new Error(`场景装置坏了：找不到包含 ${JSON.stringify(text)} 的 .cm-line`);
    const marker = line.querySelector<HTMLElement>(".cm-lp-list-marker");
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let body: Node | null = null;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const t = node as Text;
      if (!t.data.trim()) continue;
      if (marker && marker.contains(t)) continue;
      body = t;
      break;
    }
    if (!body) throw new Error(`场景装置坏了：${JSON.stringify(text)} 这一行没有正文文本节点`);
    const contentFrom = view.posAtDOM(body, 0);
    return {
      lineFrom: view.state.doc.lineAt(contentFrom).from,
      contentFrom,
      text: (body as Text).data,
      head: view.state.selection.main.head,
    };
  }, needle);
}

async function setHead(page: Page, pos: number): Promise<void> {
  await page.evaluate((p) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    view.focus();
    view.dispatch({ selection: { anchor: p } });
  }, pos);
  await page.waitForTimeout(50);
}

async function head(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile
      .root.view;
    return view.state.selection.main.head;
  });
}

/** 从「可见行首」出发：两种键各按一次都必须落到正文起点，之后逐字素，反向对称。 */
async function expectAtomicMarkerStep(page: Page, line: NavLine, key: { forward: string; backward: string }): Promise<void> {
  const { lineFrom, contentFrom, text } = line;
  expect(
    contentFrom - lineFrom,
    `fixture ${JSON.stringify(text)}：marker 至少 2 个源码字符（lineFrom=${lineFrom} contentFrom=${contentFrom}；否则「一步跨过」与逐字符无法区分）`,
  ).toBeGreaterThanOrEqual(2);

  // 前进：行首 --一次--> 正文起点 --一次--> 第一个字素簇之后
  await setHead(page, lineFrom);
  await page.keyboard.press(key.forward);
  await page.waitForTimeout(60);
  expect(await head(page), `${key.forward} 第一次：可见行首 MUST 一步跨到正文起点（修前停在隐藏源码中间）`).toBe(contentFrom);
  await page.keyboard.press(key.forward);
  await page.waitForTimeout(60);
  expect(await head(page), `${key.forward} 第二次：正文起点 MUST 前进一个字素簇`).toBe(contentFrom + nextCluster(text, 0));

  // 反向对称：正文起点 --一次--> 可见行首
  await setHead(page, contentFrom);
  await page.keyboard.press(key.backward);
  await page.waitForTimeout(60);
  expect(await head(page), `${key.backward} 第一次：正文起点 MUST 一步回到可见行首`).toBe(lineFrom);
  // 行首再退：回到上一行行尾（不是留在隐藏源码中间）
  await page.keyboard.press(key.backward);
  await page.waitForTimeout(60);
  expect(await head(page), `${key.backward} 第二次：可见行首再退 MUST 离开本行（不进隐藏源码）`).toBe(lineFrom - 1);

  // 正文内的字素移动不受影响（含 emoji 组合序列：一个簇不是两个码元）
  await setHead(page, contentFrom);
  await page.keyboard.press(key.forward);
  await page.waitForTimeout(60);
  const first = await head(page);
  expect(first, "正文内前进一个字素簇").toBe(contentFrom + nextCluster(text, 0));
  await page.keyboard.press(key.backward);
  await page.waitForTimeout(60);
  expect(await head(page), "反向逐字素对称").toBe(contentFrom);
  expect(prevCluster(text, nextCluster(text, 0)), "fixture 自检：Segmenter 往返一致").toBe(0);
}

test("列表行首的水平导航：←/→ 与 ⌃B/⌃F 一样一步跨过隐藏 marker（C6 / L5）", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "nav.md", kind: "file", size: NAV_DOC.length, mtime_ms: 0 }],
    files: { "nav.md": NAV_DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="nav.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("列表导航");
  // 组扫描是异步的（`ListLayout.schedule` 的 16ms 批次）：等全部 8 个 marker 上屏再量，
  // 否则「新开的 ol 组」可能还是字面文本，posAtDOM 会把整行（含 `10. `）当成正文。
  await expect.poll(() => page.locator(".cm-lp-list-marker").count(), { timeout: 5000 }).toBeGreaterThanOrEqual(8);

  for (const needle of ["aaaaa", "bbbbb", "ccccc", "ddddd", "eeeee", "ggg", "hhhhh", "iiiii"]) {
    const line = await navLine(page, needle);
    // 两组键都必须满足同一条不变量：方向键与 ⌃F/⌃B 的可见行为一致。
    await expectAtomicMarkerStep(page, line, { forward: "ArrowRight", backward: "ArrowLeft" });
    await expectAtomicMarkerStep(page, line, { forward: "Control+f", backward: "Control+b" });
    expect(await readDocument(page), `${needle}：水平移动不改写文档（C6/C5）`).toBe(NAV_DOC);
  }

  // 对照：普通正文段落没有隐藏区间——一次一个字符，不跳步
  const paragraph = NAV_DOC.indexOf("正文段落对照");
  await setHead(page, paragraph);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  expect(await head(page), "普通段落：→ 前进一个字符（原子步只在隐藏区间内成立）").toBe(paragraph + 1);
  await page.keyboard.press("Control+b");
  await page.waitForTimeout(60);
  expect(await head(page), "普通段落：⌃B 反向对称").toBe(paragraph);
});

test("列表行首的水平导航：跨行不跳字（上一行行尾 → 下一行可见行首）", async ({ page }) => {
  await stubTauri(page, {
    entries: [{ path: "nav.md", kind: "file", size: NAV_DOC.length, mtime_ms: 0 }],
    files: { "nav.md": NAV_DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="nav.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("列表导航");

  const line = await navLine(page, "bbbbb");
  // 上一行行尾（`1. aaaaa` 之后）→ 下一行可见行首：落点是行首，不是正文起点——进正文要再按一次。
  await setHead(page, line.lineFrom - 1);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  expect(await head(page), "跨行进下一行：落在可见行首（marker 之前）").toBe(line.lineFrom);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
  expect(await head(page), "再按一次：一步跨进正文起点").toBe(line.contentFrom);
  expect(await readDocument(page), "跨行导航不改写文档").toBe(NAV_DOC);
});
