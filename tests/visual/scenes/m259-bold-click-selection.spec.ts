import { expect, test, type Page } from "@playwright/test";
import { stubTauri } from "./tauri-stub";
import { readDocument } from "./parity-checks";

// M259（真实桌面缺陷：点击 `**pnpm**` 后字母 p 被选中）的几何不变量。
//
// 机理：显露一落地就改变布局——被隐藏的 `**` 重新占宽（≈12px）。CM 的鼠标选区在按下时
// 按**渲染态布局**算一次落点，之后每次指针移动又按**当时的布局**重算一次，两次之间布局
// 位移就让同一屏幕坐标落在靠前 1–2 个字符的位置，两个落点被当成一次拖拽 ⇒ 一次点击
//（指针抖动 1px 即足以触发）选出一个字母，落点也不是用户瞄准的那一个。
//
// 判据（条款见 openspec/specs/editor-live-preview/spec.md 的「按压期间的落点判定 MUST NOT
// 跨布局」）——两条都断言，缺一不可：
//   P1 同一屏幕坐标的文档落点映射（pos + assoc）在按下前与按压期间**逐值不变**；
//   P2 结果选区恒落在「按下点与松手点各自的落点」之间（选区 MUST NOT 被布局位移撑大）。
// fixture 是 范围类型 × 横向落点 × 抖动幅度 的矩阵；三条区分度对照（真实拖拽必须出选区 /
// 双击仍选整词 / 键盘落点仍显露）保证上面的断言不是在空输入上空转。

const DOC = `**行首粗** 之后的段落文字。

段落里有 **P粗** 与 *P斜* 与 ~~P删~~ 三种范围。

末尾段。
`;

interface SpanCase {
  id: string;
  /** 定位 `.cm-line` 用的唯一片段。 */
  line: string;
  /** 渲染态的样式装饰选择器（带 `.` 前缀，否则 Playwright 当元素类型选择器 → 恒 0 匹配）。 */
  cls: ".cm-lp-strong" | ".cm-lp-em" | ".cm-lp-strike";
  text: string;
  raw: string;
}

const SPANS: SpanCase[] = [
  { id: "段落粗体", line: "段落里有", cls: ".cm-lp-strong", text: "P粗", raw: "**P粗**" },
  { id: "段落斜体", line: "段落里有", cls: ".cm-lp-em", text: "P斜", raw: "*P斜*" },
  { id: "段落删除线", line: "段落里有", cls: ".cm-lp-strike", text: "P删", raw: "~~P删~~" },
  { id: "行首粗体", line: "行首粗", cls: ".cm-lp-strong", text: "行首粗", raw: "**行首粗**" },
];

/** 抖动幅度（px）：0 = 不动的点击；±1/±2 是点击抖动量级；30 是真实拖拽（对照）。 */
const JITTERS = [0, 1, -1, 2, -2];
/** 横向落点（占渲染态范围宽度的比例）：避开两端缘，取字号量级的中间带。 */
const FRACTIONS = [0.15, 0.35, 0.5, 0.65, 0.85];

interface Probe {
  pos: number;
  assoc: number;
}

async function openDoc(page: Page): Promise<void> {
  await stubTauri(page, {
    entries: [{ path: "e.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
    files: { "e.md": DOC },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="e.md"]').click();
  await expect(page.locator(".cm-lp-strong").first()).toBeVisible();
}

const lineOf = (page: Page, fragment: string) => page.locator(".cm-line", { hasText: fragment }).first();

/** 把光标挪到文档末尾（回到渲染态）——每次试验都从同一份渲染布局起步。
 *  落点必须与任何强调范围都不相接：停在范围端点上同样会显露（M168 含端点相接），
 *  文档末尾那句话里没有强调范围。 */
async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  await page.waitForTimeout(60);
}

/** 屏幕坐标 → 文档落点（与 CM 鼠标选区内部用的是同一个 API，同一 assoc 口径）。
 *  先 `observer.flush()` 再读：CM 自己的 mousedown 处理开头就做这一步（把累积的 DOM
 *  变更消化掉再量），不这样做本函数读到的字符矩形可能落后一拍——在字符中线附近会整整
 *  差一个字符位，那与「布局位移」是两回事（同一份布局里的两种读法）。 */
function mapAt(page: Page, x: number, y: number): Promise<Probe> {
  return page.evaluate(([px, py]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    (view.observer as { flush?: () => void } | undefined)?.flush?.();
    const p = view.posAndSideAtCoords({ x: px, y: py }, false);
    return { pos: p.pos, assoc: p.assoc };
  }, [x, y] as const);
}

function selection(page: Page): Promise<{ anchor: number; head: number; empty: boolean }> {
  return page.evaluate(() => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    const s = view.state.selection.main;
    return { anchor: s.anchor, head: s.head, empty: s.empty };
  });
}

const sorted = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);

test("按压期间的落点判定不跨布局：同坐标映射逐值不变，选区不超出指针自身走过的范围", async ({ page }) => {
  await openDoc(page);

  for (const span of SPANS) {
    const line = lineOf(page, span.line);
    // 前置条件（否则下面的断言在空输入上空转）：渲染态有样式装饰、源码标记不可见
    await reset(page);
    await expect(line, `${span.id} 起点应是渲染态`).not.toContainText(span.raw);
    const box = (await line.locator(span.cls, { hasText: span.text }).boundingBox())!;
    expect(box.width, `${span.id} 渲染态范围应有可测宽度`).toBeGreaterThan(8);
    const y = box.y + box.height / 2;

    for (const frac of FRACTIONS) {
      // 坐标取整：注入到 DOM 的事件坐标是整数（实测 clientX 被取整），测试里若拿小数
      // 坐标去读映射，会与 CM 自己读到的那一次差半个像素——在字符中线附近足以整整差
      // 一个字符位，那是读法的差，不是布局的差。
      const x = Math.round(box.x + box.width * frac);
      for (const dx of JITTERS) {
        const label = `${span.id} frac=${frac} dx=${dx}`;
        await reset(page);

        // 按下**之前**在渲染布局里读出两个落点：按下点 x 与松手点 x+dx
        const atPress = await mapAt(page, x, y);
        const atRelease = await mapAt(page, x + dx, y);

        await page.mouse.move(x, y);
        await page.waitForTimeout(16);
        await page.mouse.down();
        if (dx !== 0) {
          await page.mouse.move(x + dx, y, { steps: 2 });
          await page.waitForTimeout(16);
        }

        // P1：同坐标的映射在按压期间不变（缺陷态下这里会偏移 1–2 个字符）
        const duringPress = await mapAt(page, x, y);
        expect({ pos: duringPress.pos, assoc: duringPress.assoc }, `${label}：按下与按压期间的同坐标映射应逐值相同`).toEqual(atPress);

        await page.mouse.up();
        await page.waitForTimeout(60);

        // P2：选区恒落在「按下点落点」与「松手点落点」之间（按下前那份布局里算出来的）
        const sel = await selection(page);
        const actual = sorted(sel.anchor, sel.head);
        const expected = sorted(atPress.pos, atRelease.pos);
        expect(
          actual,
          `${label}：选区应落在指针自身覆盖的两个落点之间（按下前映射 ${JSON.stringify(atPress)}/${JSON.stringify(atRelease)}，结果 ${JSON.stringify(sel)}）`,
        ).toEqual(expected);

        // 抬起后显露照常跟随（M168 不回归）：光标落在范围内 ⇒ 该范围显露为原文
        await expect(line, `${label}：抬起后该范围应显露源码`).toContainText(span.raw);
      }
    }
  }

  expect(await readDocument(page)).toBe(DOC);
});

test("区分度对照：真实拖拽必须出选区（证明上面的断言不是在空输入上打转）", async ({ page }) => {
  await openDoc(page);
  const line = lineOf(page, "段落里有");
  await reset(page);
  const box = (await line.locator(".cm-lp-strong", { hasText: "P粗" }).boundingBox())!;
  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 30, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const sel = await selection(page);
  expect(sel.empty, "30px 的拖拽应产生非空选区").toBe(false);
  expect(sel.head - sel.anchor, "选区跨度应与指针位移同量级（不是被布局撑成别的跨度）").toBeGreaterThan(1);
  expect(await readDocument(page)).toBe(DOC);
});

test("区分度对照：同一落点双击仍选整个词（CM 的鼠标词选不回归）", async ({ page }) => {
  await openDoc(page);
  const line = lineOf(page, "段落里有");
  await reset(page);
  const box = (await line.locator(".cm-lp-em", { hasText: "P斜" }).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(60);
  const sel = await selection(page);
  expect(await page.evaluate(([from, to]) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    return view.state.sliceDoc(Math.min(from, to), Math.max(from, to));
  }, [sel.anchor, sel.head] as const)).toBe("P斜");
  expect(await readDocument(page)).toBe(DOC);
});

test("区分度对照：键盘落点仍显露（M168 的键盘路径不回归）", async ({ page }) => {
  await openDoc(page);
  const line = lineOf(page, "段落里有");
  await reset(page);
  const rawFrom = DOC.indexOf("**P粗**");
  await page.evaluate((pos) => {
    const view = (document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: any } } }).cmTile.root.view;
    view.dispatch({ selection: { anchor: pos } });
    view.focus();
  }, rawFrom + 3);
  await page.waitForTimeout(80);
  await expect(line).toContainText("**P粗**");
  await expect(line.locator(".cm-lp-strong", { hasText: "P粗" })).toHaveCount(0);
  expect(await readDocument(page)).toBe(DOC);
});

test("区分度对照：按压全程文档逐字节不变（ADR 0003 §3）", async ({ page }) => {
  await openDoc(page);
  const line = lineOf(page, "段落里有");
  await reset(page);
  const box = (await line.locator(".cm-lp-strong", { hasText: "P粗" }).boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width * 0.5;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 2, y, { steps: 2 });
  expect(await readDocument(page)).toBe(DOC);
  await page.mouse.up();
  await page.waitForTimeout(60);
  expect(await readDocument(page)).toBe(DOC);
});
