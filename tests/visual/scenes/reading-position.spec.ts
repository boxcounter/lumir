// 记住文档阅读位置（M194，change remember-reading-position 的 task 7.2 / 7.3）：
// 装载后恢复、没有历史从篇首、捕获侧的防抖写入、已打开的标签不被盘上的位置拽走、
// 篇首位置按篇首呈现（页首内边距不被顶出画）、code 模式同样恢复（含折行关闭时的横向偏移）。
//
// 这一层能测什么、不能测什么：
//   - **能**：桩提供「盘上已经存了一条位置」的初值（`VaultFixture.positions`），因此恢复侧
//     不需要真实重启就能端到端跑一遍；写入侧的判据落 `__readingPositionPuts` 的载荷。
//   - **不能**：真实 WKWebView 下的行为（归 scripts/acceptance 的场景 28）、跨进程重启
//     （桩是 addInitScript，reload 会重放同一份初值）。本场景的「重启」用**关标签再打开同一
//     文件**表达：它走的是同一条装载路径（openFile → reloadSession 复位 → 恢复）。
//
// 判据形态（REVIEW.md 第 1、2 条）：位置类断言一律落在**几何读数**上（顶部可见行 / scrollTop /
// 锚的字符盒相对视口的偏移），并且负向断言（篇首那行不在顶部）必须与同一位置的正观测（目标行
// 在顶部）成对出现，否则「读不到 → 负向恒真」会假绿。

import { expect, test, type Page } from "@playwright/test";
import { stubTauri, readingPositionPuts, type VaultFixture } from "./tauri-stub";

const VAULT_ID = "reading-position-vault";

/** 超过一屏的长文档：200 行、每行带唯一编号（判据要能指名道姓地说「顶部是哪一行」）。 */
const FILLER = (n: number) => `第 ${String(n).padStart(3, "0")} 行：阅读位置填充内容。`;
const LONG_DOC =
  ["# 阅读位置场景", "", ...Array.from({ length: 200 }, (_, i) => FILLER(i + 1)), ""].join("\n") + "\n";
const FIRST_LINE = "# 阅读位置场景";
const ANCHOR_LINE = FILLER(150);
const ANCHOR_POS = LONG_DOC.indexOf(ANCHOR_LINE);

/** code 模式（非 md）的长文件：行很长，折行关闭时正文可横向平移。 */
const LONG_CODE_LINE = (n: number) => `// 第 ${String(n).padStart(3, "0")} 行 ` + "x".repeat(360);
const CODE_DOC =
  [...Array.from({ length: 200 }, (_, i) => LONG_CODE_LINE(i + 1)), ""].join("\n");
const CODE_ANCHOR_LINE = LONG_CODE_LINE(150);
const CODE_ANCHOR_POS = CODE_DOC.indexOf(CODE_ANCHOR_LINE);

const OTHER_DOC = "# 另一份文档\n\n切换用的对照文档。\n";

function fixture(over: Partial<VaultFixture> = {}): VaultFixture {
  return {
    entries: [
      { path: "long.md", kind: "file", size: LONG_DOC.length, mtime_ms: 0 },
      { path: "other.md", kind: "file", size: OTHER_DOC.length, mtime_ms: 0 },
      { path: "plain.txt", kind: "file", size: CODE_DOC.length, mtime_ms: 0 },
    ],
    files: { "long.md": LONG_DOC, "other.md": OTHER_DOC, "plain.txt": CODE_DOC },
    vault_id: VAULT_ID,
    ...over,
  };
}

/** 桩上的位置初值（模拟「上次会话留下的那条」）。 */
function stored(path: string, pos: number, y = 48, x = 0) {
  return { positions: { [VAULT_ID]: { [path]: { pos, y, x, at: 1_700_000_000_000 } } } };
}

// ---------------------------------------------------------------------------
// 页内读数（都是几何量，不判「函数被调用过」）
// ---------------------------------------------------------------------------

/** 滚动位置读数（判据都落在几何量上，看的是滚动容器自己的值）。 */
function scrollTop(page: Page): Promise<number> {
  return page.locator(".cm-scroller").evaluate((el) => el.scrollTop);
}

function scrollLeft(page: Page): Promise<number> {
  return page.locator(".cm-scroller").evaluate((el) => el.scrollLeft);
}

/** 视口顶那一行（与 M149 / m132 同一口径：容器顶 +2px 处的文档行）。
 *  读不到（posAtCoords 为 null）返回空串——调用方必须把它当 FAIL，不能当「没有位置」。 */
function topVisibleLine(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = (
      document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: { posAtCoords(p: { x: number; y: number }): number | null; state: { doc: { lineAt(pos: number): { text: string } } } } } };
      }
    ).cmTile.root.view;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const rect = scroller.getBoundingClientRect();
    const pos = view.posAtCoords({ x: rect.left + 60, y: rect.top + 2 });
    return pos === null ? "" : view.state.doc.lineAt(pos).text;
  });
}

/** 文档位置锚的字符盒相对滚动容器顶 / 左的偏移——这就是落盘载荷里 `y` / `x` 的定义，
 *  恢复成立的判据正是「恢复之后这两个数仍等于载荷里的值」。 */
function anchorOffsets(page: Page, pos: number): Promise<{ top: number; left: number }> {
  return page.evaluate((anchor) => {
    const view = (
      document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: { coordsAtPos(pos: number): { top: number; left: number } | null } } };
      }
    ).cmTile.root.view;
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    const box = scroller.getBoundingClientRect();
    const rect = view.coordsAtPos(anchor);
    if (rect === null) throw new Error("coordsAtPos 返回 null：锚处不可读");
    return { top: rect.top - box.top, left: rect.left - box.left };
  }, pos);
}

/** 打开一个 fixture 文件（点左栏，等它的正文上屏）。`needle` 是那份文档里必出现的一段。 */
async function open(page: Page, file: string, needle = "阅读位置场景"): Promise<void> {
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(needle);
}

/** 把视口摆到某个位置（arrange，不参与判据）：位置取自 CM 的行块坐标，与字体布局无关。 */
async function scrollToLine(page: Page, needle: string): Promise<void> {
  await page.evaluate((text) => {
    const view = (
      document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: any } };
      }
    ).cmTile.root.view;
    const doc: string = view.state.doc.toString();
    const at = doc.indexOf(text);
    if (at < 0) throw new Error(`文档里没有「${text}」`);
    view.scrollDOM.scrollTop = view.lineBlockAt(at).top;
  }, needle);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

// ---------------------------------------------------------------------------
// 恢复：命中位置 / 没有历史 / 篇首
// ---------------------------------------------------------------------------

test("打开一份盘上已有位置的文档：视口回到该位置（锚的行停在视口内同一偏移）", async ({ page }) => {
  await stubTauri(page, fixture(stored("long.md", ANCHOR_POS)));
  await page.goto("/");
  await open(page, "long.md");
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

  // 恢复成立的充要形态：锚的字符盒相对视口的偏移 = 载荷里的 y（公开通道的不变量）
  const offsets = await anchorOffsets(page, ANCHOR_POS);
  expect(Math.abs(offsets.top - 48)).toBeLessThanOrEqual(2);
  // 成对判据：篇首那行不在顶部（负向）+ 锚的行确实在渲染窗口里（正观测，堵死「读不到」空过）
  const top = await topVisibleLine(page);
  expect(top).not.toBe(FIRST_LINE);
  await expect(page.locator(".cm-content")).toContainText(ANCHOR_LINE);
});

test("盘上没有该文档的位置：从篇首开始，且不给任何提示", async ({ page }) => {
  await stubTauri(page, fixture());
  await page.goto("/");
  await open(page, "long.md");
  expect(await scrollTop(page)).toBe(0);
  expect(await topVisibleLine(page)).toBe(FIRST_LINE);
  // 「不给提示」：正文区没有覆盖层，也没有 toast
  await expect(page.locator(".editor-notice")).toBeHidden();
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
});

test("盘上的位置在篇首：按篇首呈现，页首内边距不被顶出画", async ({ page }) => {
  await stubTauri(page, fixture(stored("long.md", 0)));
  await page.goto("/");
  await open(page, "long.md");
  expect(await scrollTop(page)).toBe(0);
  expect(await topVisibleLine(page)).toBe(FIRST_LINE);
  // M110 的缺陷签名：用 scrollIntoView 带 margin 复位会把页首的 44px 内边距顶出画，
  // 那时首行的字符盒顶会贴到容器顶（≈ 0）。这里必须仍在内边距之下。
  const offsets = await anchorOffsets(page, 0);
  expect(offsets.top).toBeGreaterThan(40);
});

test("已经打开的标签不被盘上的位置拽走：只切标签，视口停在运行期的位置", async ({ page }) => {
  await stubTauri(page, fixture(stored("long.md", ANCHOR_POS)));
  await page.goto("/");
  await open(page, "long.md"); // 装载 → 恢复到盘上那条（第 150 行附近）
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

  // 运行期滚到别处（这就是「离开该标签时的位置」），并等它落进内存镜像
  await scrollToLine(page, FILLER(40));
  await page.waitForTimeout(400);
  const runtimeTop = await scrollTop(page);
  const diskTop = await page.evaluate((pos) => {
    const view = (
      document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: { lineBlockAt(pos: number): { top: number } } } };
      }
    ).cmTile.root.view;
    return view.lineBlockAt(pos).top;
  }, ANCHOR_POS);
  expect(Math.abs(diskTop - runtimeTop)).toBeGreaterThan(1000); // 前置条件：两处确实很远

  // 固定标签打开另一份文档（两个标签都在），再点回 long.md
  await page.locator('.ft-row[title="other.md"]').click({ modifiers: ["Meta"] });
  await expect(page.locator(".cm-content")).toContainText("另一份文档");
  await page.locator('.ft-row[title="long.md"]').click();
  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);

  const back = await scrollTop(page);
  // 运行期位置原样保留（切标签的既有内存快照通道，一行以内的落点差是 CM 对行块坐标的取整）
  expect(Math.abs(back - runtimeTop)).toBeLessThanOrEqual(40);
  // 关键负向：没有被盘上那条（第 150 行附近）拽走——两处相距上千像素，这条断言会红
  expect(Math.abs(back - diskTop)).toBeGreaterThan(1000);
  expect(await topVisibleLine(page)).not.toBe(FIRST_LINE);
});

// ---------------------------------------------------------------------------
// 捕获（写入侧）
// ---------------------------------------------------------------------------

test("滚动停止后防抖落盘：连续滚动只写一次，载荷里的位置与当前视口一致", async ({ page }) => {
  await stubTauri(page, fixture());
  await page.goto("/");
  await open(page, "long.md");
  await page.waitForTimeout(1400); // 装载路径上的信号（复位）先落定，避免混进下面这段计数
  const before = (await readingPositionPuts(page)).length;

  // 连着两次滚动（同一防抖窗口内）→ 只应产生一次写入
  await scrollToLine(page, FILLER(30));
  await scrollToLine(page, FILLER(90));
  await page.waitForTimeout(1600);

  const puts = await readingPositionPuts(page);
  expect(puts.length - before).toBe(1);
  const payload = puts.at(-1)?.entries?.["long.md"];
  expect(payload).toBeDefined();
  // 载荷的锚 = 捕获口径的锚（同一份公式：高度等于 scrollTop 的行块起点）
  const expected = await page.evaluate(() => {
    const view = (
      document.querySelector(".cm-content") as unknown as {
        cmTile: { root: { view: any } };
      }
    ).cmTile.root.view;
    return view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
  });
  expect(payload?.pos).toBe(expected);
  // 载荷的 y / x = 锚相对滚动容器顶 / 左的偏移（恢复侧消费的就是这两个数）。
  // y 不判「等于 48」：它是**视口偏移**，随锚落在行块内的位置而变（实测同一文档里
  // 41–97 都出现过）；成立的判据是它落在视口之内、且恢复时被逐像素还原（见上面那条往返）。
  const viewport = await page.locator(".cm-scroller").evaluate((el) => el.clientHeight);
  expect(payload?.y ?? -1).toBeGreaterThan(0);
  expect(payload?.y ?? 1e9).toBeLessThan(viewport);
  expect(payload?.x).toBeGreaterThanOrEqual(0);
});

test("载荷写的是真实载荷形状：at 是毫秒时间戳，且位置随滚动而变", async ({ page }) => {
  await stubTauri(page, fixture());
  await page.goto("/");
  await open(page, "long.md");
  await scrollToLine(page, FILLER(30));
  await page.waitForTimeout(1600);
  await scrollToLine(page, FILLER(120));
  await page.waitForTimeout(1600);

  const puts = await readingPositionPuts(page);
  const positions = puts.map((put) => put.entries?.["long.md"]?.pos).filter((p) => p !== undefined);
  expect(positions.length).toBeGreaterThanOrEqual(2);
  expect(positions.at(-1)!).toBeGreaterThan(positions[0]!);
  const at = puts.at(-1)?.entries?.["long.md"]?.at ?? 0;
  expect(at).toBeGreaterThan(1_700_000_000_000);
});

// ---------------------------------------------------------------------------
// code 模式（task 7.3）
// ---------------------------------------------------------------------------

test("code 模式（非 md 文本）同样恢复：纵向 + 折行关闭时的横向偏移", async ({ page }) => {
  // 折行关闭（M180 的配置面）：正文行不折行，长行可横向平移
  await stubTauri(page, fixture({ config: { line_wrap: false } }));
  await page.goto("/");
  await page.locator('.ft-row[title="plain.txt"]').click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");

  // 建立一处运行期位置：纵向摆到第 150 行 + 横向平移 200px，等防抖写入
  await scrollToLine(page, CODE_ANCHOR_LINE);
  await page.evaluate(() => {
    (document.querySelector(".cm-scroller") as HTMLElement).scrollLeft = 200;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.waitForTimeout(1600);
  const beforeTop = await scrollTop(page);
  const beforeLeft = await scrollLeft(page);
  const beforeLine = await topVisibleLine(page);
  expect(beforeLeft).toBeGreaterThan(0); // 前置条件：横向真的平移了

  // 关标签 → 重新打开（走装载路径的复位 → 恢复）。焦点用 focus() 给而不是点击：
  // 点正文会让 CM 把光标滚进视区，把刚摆好的位置改掉（m187 的同款处置）。
  await page.evaluate(() => (document.querySelector(".cm-content") as HTMLElement).focus());
  await page.keyboard.press("Meta+w");
  await expect(page.locator(".cm-content")).not.toContainText("第 001 行");
  await page.locator('.ft-row[title="plain.txt"]').click();
  await expect(page.locator(".cm-content")).toHaveAttribute("contenteditable", "false");

  await expect.poll(() => scrollTop(page)).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(await topVisibleLine(page)).toBe(beforeLine);
  expect(Math.abs((await scrollTop(page)) - beforeTop)).toBeLessThanOrEqual(4);
  // 横向位置一并还原（这是本能力在 code 模式下唯一比 md 多出来的一个量）
  expect(Math.abs((await scrollLeft(page)) - beforeLeft)).toBeLessThanOrEqual(4);
});
