import { expect, test } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { EVENT_DICT_DOC } from "./m115-fixture";

// M115 真实桌面缺陷回归（合成事件登记文档配方，结构等价于原始复现文档）：上方
// 存在未覆盖解析的巨型表格时，双击位于视口底部边缘的表头——raw→grid 翻转若落在
// 瞄准与点击之间，滚动锚定会移动视口，选区漂到 widget 之前段落、视口上跳约一屏。
// 修复：表格发现范围未被语法树覆盖时短延时重试推进解析（previewRefresh 触发
// updateDeco 重算，每次再推进 ≤25ms），把裸露源码窗口从 ~500ms（WKWebView 无
// requestIdleCallback，@codemirror/language 后台解析退化为 setTimeout(500)）
// 收敛到一两帧，翻转在瞄准前完成。
// 本场景仿真 WKWebView 解析滞后：删 requestIdleCallback + 6x CPU 节流（放大单片
// 25ms 预算不足的情形）；节流下断言阈值留足余量。
// fixture 为合成文档（m115-fixture.ts）：保留原始复现配方的结构特征（frontmatter、
// 多张表、上方巨型标准属性表、下方含「触发时机」表头与 bookmark_saved 地标的事件表），
// 全部内容为虚构，断言期望值均从文档地标动态计算。

const SCENARIO = "03-遥测事件登记册.md";

// 布局无关的真值：bookmark 事件表表头「触发时机」的文档区间（bookmark_saved 之前
// 最近的一处，避开 user 事件表的同名表头）。
function expectedWord(page: import("@playwright/test").Page): Promise<{ from: number; to: number }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const text = view.state.doc.toString();
    const bm = text.indexOf("bookmark_saved");
    const from = text.lastIndexOf("触发时机", bm);
    return { from, to: from + 4 };
  });
}

async function openDocWithLaggyParse(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    // @ts-expect-error 仿真 WKWebView：无 requestIdleCallback
    window.requestIdleCallback = undefined;
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await stubTauri(page, {
    entries: [{ path: SCENARIO, kind: "file", size: EVENT_DICT_DOC.length, mtime_ms: 0 }],
    files: { [SCENARIO]: EVENT_DICT_DOC },
  });
  await page.goto("/");
  await page.locator(`.ft-row[title="${SCENARIO}"]`).click();
  await page.locator(".cm-scroller").waitFor();
}

function bookmarkTableGrid(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const tables = [...document.querySelectorAll(".cm-lp-table")] as HTMLElement[];
    return tables.some((t) => t.textContent?.includes("bookmark_saved"));
  });
}

/** 视口快照：scrollTop、选区、以及「触发时机」表头在视口内的中心 y（视觉位置的真值）。 */
function windowSample(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const m = view.state.selection.main;
    const tables = [...document.querySelectorAll(".cm-lp-table")] as HTMLElement[];
    const table = tables.find((t) => t.textContent?.includes("bookmark_saved"))!;
    const header = [...table.querySelectorAll(".cm-lp-table-cell")].find(
      (c) => c.textContent?.trim() === "触发时机",
    ) as HTMLElement;
    const sr = view.scrollDOM.getBoundingClientRect();
    const hr = header.getBoundingClientRect();
    return {
      scrollTop: view.scrollDOM.scrollTop,
      from: m.from,
      to: m.to,
      text: view.state.doc.sliceString(m.from, m.to),
      // 表头中心在视口内的 y——「视口是否上跳」的视觉量（scrollTop 只记账，见下方断言注释）
      headerY: hr.top + hr.height / 2 - sr.top,
    };
  });
}

/** 等视口落定：首次采样之后（间隔 60ms）连续两次确认 scrollTop / 选区 / 表头 y 都不再变化，上限 3s。 */
async function settledSample(page: import("@playwright/test").Page) {
  let prev = await windowSample(page);
  const start = Date.now();
  let stable = 0;
  while (Date.now() - start < 3000 && stable < 2) {
    await page.waitForTimeout(60);
    const cur = await windowSample(page);
    const same =
      cur.scrollTop === prev.scrollTop &&
      cur.from === prev.from &&
      cur.to === prev.to &&
      Math.abs(cur.headerY - prev.headerY) < 0.5;
    stable = same ? stable + 1 : 0;
    prev = cur;
  }
  return prev;
}

test("表格进入视口后及时渲染为 grid，不等后台 500ms 解析 tick", async ({ page }) => {
  test.setTimeout(90_000);
  await openDocWithLaggyParse(page);
  const exp = await expectedWord(page);
  const start = Date.now();
  await page.evaluate((from) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const block = view.lineBlockAt(from);
    view.scrollDOM.scrollTop = Math.max(0, block.top - 300);
  }, exp.from);
  let grid = false;
  let elapsed = 0;
  while (Date.now() - start < 3000) {
    grid = await bookmarkTableGrid(page);
    elapsed = Date.now() - start;
    if (grid) break;
    await page.waitForTimeout(50);
  }
  expect(grid, "bookmark 事件表应渲染为 grid").toBe(true);
  // 修复前：裸露源码一直停到后台解析 tick（≥500ms）才翻转；修复后重试链一两帧内覆盖。
  expect(elapsed, `grid 渲染耗时 ${elapsed}ms，应在 500ms 后台 tick 之前完成`).toBeLessThan(500);
});

test("双击底部边缘表头：选中「触发时机」本身，视口不上跳", async ({ page }) => {
  test.setTimeout(90_000);
  await openDocWithLaggyParse(page);
  const exp = await expectedWord(page);
  // 等 grid 渲染完成（修复后的及时覆盖），再把表头放到底部边缘
  await page.evaluate((from) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const block = view.lineBlockAt(from);
    view.scrollDOM.scrollTop = Math.max(0, block.top - 300);
  }, exp.from);
  {
    const start = Date.now();
    while (Date.now() - start < 3000) {
      if (await bookmarkTableGrid(page)) break;
      await page.waitForTimeout(50);
    }
  }
  const point = await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const tables = [...document.querySelectorAll(".cm-lp-table")] as HTMLElement[];
    const table = tables.find((t) => t.textContent?.includes("bookmark_saved"))!;
    const header = [...table.querySelectorAll(".cm-lp-table-cell")].find((c) => c.textContent?.trim() === "触发时机") as HTMLElement;
    // 瞄准点取**表头文字**的几何，不是 cell 盒：cell 盒按列宽撑满，而列宽由同列最宽的数据 cell
    // 决定；表头走标签档字号（11.5px，restyle 后 cell 是 13.5px），cell 盒的中心会落到文字右侧的
    // 空白处——那里的文档坐标紧邻被隐藏的管道符，双击会选中「|」而不是「触发时机」（restyle 后
    // 首次实测到的形态：断言读回 "|"）。这条判据与列宽/字号解耦，因此两类改动都不会再让它假红。
    const textBox = () => {
      const range = document.createRange();
      range.selectNodeContents(header);
      const box = range.getBoundingClientRect();
      return box.width > 0 ? box : header.getBoundingClientRect();
    };
    const sr = view.scrollDOM.getBoundingClientRect();
    // 表头放到底部边缘（复现配方：clientH-76 .. clientH-63）
    const r = header.getBoundingClientRect();
    view.scrollDOM.scrollTop += r.top + r.height / 2 - (sr.top + view.scrollDOM.clientHeight - 70);
    const r2 = header.getBoundingClientRect();
    const t2 = textBox();
    return {
      x: t2.left + t2.width / 2,
      y: r2.top + r2.height / 2,
      // 瞄准时表头在视口内的中心 y：下方「视口是否上跳」以它为基准
      aimedY: r2.top + r2.height / 2 - sr.top,
    };
  });
  const before = await page.evaluate(() => (document.querySelector(".cm-scroller") as HTMLElement).scrollTop);
  await page.mouse.click(point.x, point.y, { clickCount: 2, delay: 80 });
  // 点击后等视口落定再断言（M177）：慢环境里发现重试链 / CM 的滚动锚定在点击后还会再动几帧，
  // 单点测量取到的是过渡态——CI 现场首跑测到 73px、重试即绿，本地 40 帧采样（1.4s）恒为 0。
  const after = await settledSample(page);
  expect(after.text, "双击应选中「触发时机」").toBe("触发时机");
  expect(after.from, "选区应落在 bookmark 事件表表头的词区间").toBe(exp.from);
  expect(after.to).toBe(exp.to);
  // 「视口不上跳」判在**视觉量**（瞄准时表头的视口内 y）而非 raw scrollTop：视口上方内容高度
  // 变化时 CM 的滚动锚定会等量补偿 scrollTop，内容视觉不动（CI 首跑那 73px 属这一类）。原始缺陷
  // 的形态是表头连同内容整体移位约一屏（commit 895d6f1），瞄准点在 clientH-70——阈值 120px
  // 对一屏级位移留足检出余量，又不把上述补偿当回归。
  const driftY = Math.abs(after.headerY - point.aimedY);
  const driftTop = Math.abs(after.scrollTop - before);
  // 落定后的实测值进日志：本场景是契约性质（Chromium 复现不出 red 态，见文件头），
  // 下次若在 CI 抖动，这行就是「稳定后的位移是多少」的第一手证据。
  console.log(
    `[m115] 双击后落定：aimedY=${point.aimedY.toFixed(1)} headerY=${after.headerY.toFixed(1)} driftY=${driftY.toFixed(1)} driftTop=${driftTop.toFixed(1)} sel=${after.text}`,
  );
  expect(
    driftY,
    `双击不应引起视口跳变：表头视口内 y 由 ${point.aimedY.toFixed(1)} 变为 ${after.headerY.toFixed(1)}（位移 ${driftY.toFixed(1)}px，scrollTop 差 ${driftTop.toFixed(1)}px）`,
  ).toBeLessThan(120);
});
