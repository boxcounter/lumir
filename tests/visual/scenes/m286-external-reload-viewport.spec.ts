// M286：外部改写**当前**文档（app 就地重载）时的两条行为判据：
//
//   ① 视口 MUST NOT 停在篇首——重载后按装载口径恢复阅读位置。重载走 `save-controller` 的外部
//      变更分流，**不经** `openFile` 的 `readingPositions.restoreFor`；改前它把视口复位到篇首就
//      不管了（finding `20260927-worker-survey-esc-jump-bug-item.md`，M279 的 T6 实测
//      `scrollTop 1543 → 0`）。
//   ② 内容取自旧一份文档的浮层 MUST 退出。表格全屏的快照是**打开那一刻**渲染态 grid 的深克隆，
//      文档换代后它展示的是已不存在的内容；改前只有遮罩自己的 blur 兜底，而注释声称它兜住
//      「文档代际变化」——实测不触发（重载不移动焦点，遮罩一直持焦）。
//
// 判别层：chromium。两条都与引擎的聚焦揭示无关（重载是应用自己发起的动作），因此不需要
// `webkit-realua` 那一支（它只对「引擎聚焦揭示」那一族有区分度，见 m280-overlay-esc-scroll）。
//
// 反向验证（先红后绿，日志见 test-results/m286/）：把 `src/save-controller.ts` 的
// `deps.restoreReadingPosition` / `deps.documentReplaced` 两处调用去掉，第一条用例的两半分别变红
// （视口停在 0；遮罩仍 hidden=false）；第二条用例（后台标签）**照旧绿**——它判的是「不许越界触发」，
// 与那两处调用缺失无关，这正是它与第一条的分工。

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { stubTauri, configGets, externalWrite, fireFsEvent, readingPositionPuts } from "./tauri-stub";

/** 证据落点（git 外，与门禁日志分开）：每次跑把读数写一份，便于逐条核对。 */
const EVIDENCE_DIR = new URL("../../../test-results/m286/scene-readings/", import.meta.url);

const TRIGGER_KEY = "Cmd-j";
const TRIGGER_PRESS = "Meta+j";
/** 关闭前后 scrollTop 的容差（px）：两次读数都是整数化的 scrollTop，同一位置的抖动只可能来自舍入。 */
const TOLERANCE_PX = 2;

const INTRO = Array.from(
  { length: 26 },
  (_, i) => `第 ${i + 1} 段：这一段只为把目标块推到首屏之下，内容本身不参与判据。${"填充文字。".repeat(6)}`,
).join("\n\n");
const TAIL = Array.from(
  { length: 24 },
  (_, i) => `尾部段 ${i + 1}：${"尾部填充文字。".repeat(6)}`,
).join("\n\n");
const TABLE = [
  "| 列一 | 列二 |",
  "| --- | --- |",
  ...Array.from({ length: 30 }, (_, i) => `| 行 ${i + 1} 甲 | 行 ${i + 1} 乙 |`),
].join("\n");

const DOC = `# 外部重载阅读位置\n\n${INTRO}\n\n${TABLE}\n\n${TAIL}\n`;
/** 外部写入的磁盘版：在**末尾**追加一段。锚是文档位置，追加在视口之下的内容不动锚之前的字节
 *  ——恢复落点因此仍是原来那一行（这一点是本用例判据成立的前提，不是巧合）。 */
const DISK_DOC = `${DOC}\n外部追加的一段：这一段只存在于磁盘版。\n`;
const OTHER_DOC = `# 后台文档\n\n${INTRO}\n\n${TAIL}\n`;
const OTHER_DISK_DOC = `${OTHER_DOC}\n后台文档的外部追加段。\n`;

type CmView = {
  state: { doc: { toString(): string; length: number; lineAt(pos: number): { number: number; text: string } } };
  scrollDOM: HTMLElement;
  contentDOM: HTMLElement;
  lineBlockAtHeight(h: number): { from: number };
  lineBlockAt(pos: number): { top: number };
  posAtCoords(coords: { x: number; y: number }): number | null;
  focus(): void;
  hasFocus: boolean;
};

declare global {
  interface Window {
    __m286?: CmView;
  }
}

/** 打开 fixture（可选两份文档）并装好页内探针。 */
async function openScene(page: Page, files: Record<string, string>): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 800 });
  await stubTauri(page, {
    entries: Object.keys(files).map((path) => ({
      path,
      kind: "file",
      size: files[path].length,
      mtime_ms: 0,
    })),
    files,
    config: { keys: { [TRIGGER_KEY]: "table.toggle-fullscreen" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="scene.md"]').click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await expect(page.locator(".modeline-path")).toHaveText("scene.md");
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as {
      cmTile: { root: { view: CmView } };
    };
    window.__m286 = el.cmTile.root.view;
  });
}

/** 当前视口顶那一行的锚（与产品捕获侧同一条公式）与行号。 */
function anchorNow(page: Page): Promise<{ from: number; line: number; scrollTop: number }> {
  return page.evaluate(() => {
    const view = window.__m286!;
    const scrollTop = Math.round(view.scrollDOM.scrollTop);
    const from = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
    return { from, line: view.state.doc.lineAt(from).number, scrollTop };
  });
}

function docText(page: Page): Promise<string> {
  return page.evaluate(() => window.__m286!.state.doc.toString());
}

function overlayOpen(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.querySelector(".lumir-table-fs-overlay")?.hasAttribute("hidden") === false,
  );
}

/** 把目标块的头部滚进视口上沿附近（真实滚轮 ⇒ 捕获侧真的收到过滚动事件）。 */
async function bringTableIntoView(page: Page, slotSel: string): Promise<void> {
  const scroller = (await page.locator(".cm-scroller").boundingBox())!;
  await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
  for (let i = 0; i < 40; i += 1) {
    const slots = page.locator(slotSel);
    if ((await slots.count()) > 0) {
      const box = await slots.first().boundingBox();
      if (box !== null && box.y >= scroller.y + 20 && box.y <= scroller.y + scroller.height * 0.5) return;
    }
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(70);
  }
  throw new Error(`${slotSel} 没有被滚进视口上半区（fixture 几何或滚轮通道有问题）`);
}

/** 焦点 + caret 落在表格里（命令入口的命中判据），执行 ⌘J 打开遮罩。 */
async function openTableOverlay(page: Page): Promise<void> {
  const content = (await page.locator(".cm-content").boundingBox())!;
  await page.mouse.click(Math.round(content.x + content.width / 2), Math.round(content.y + 30));
  await page.waitForTimeout(120);
  const slotBox = (await page.locator(".cm-lp-table-slot").first().boundingBox())!;
  const scroller = (await page.locator(".cm-scroller").boundingBox())!;
  const clickY = Math.min(Math.max(scroller.y + 80, slotBox.y + 40), scroller.y + scroller.height - 80);
  await page.mouse.click(Math.round(slotBox.x + Math.min(160, slotBox.width / 2)), Math.round(clickY));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__m286!.focus());
  await page.waitForTimeout(150);
  await page.keyboard.press(TRIGGER_PRESS);
  await expect.poll(() => overlayOpen(page)).toBe(true);
}

async function dumpEvidence(name: string, payload: unknown): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(new URL(`${name}.json`, EVIDENCE_DIR).pathname, JSON.stringify(payload, null, 2));
}

test("外部重载前台文档：视口不回篇首 + 遮罩退出 + 载荷不出现 pos 0", async ({ page }) => {
  await openScene(page, { "scene.md": DOC });
  await bringTableIntoView(page, ".cm-lp-table-slot");
  await openTableOverlay(page);

  // 位置先落一次盘（越过 1s 防抖）：重载恢复读的就是这一份（pending 优先，镜像兜底）
  await page.waitForTimeout(1400);
  const anchor = await anchorNow(page);
  const before = { ...anchor, overlayOpen: await overlayOpen(page) };
  expect(before.scrollTop, "视口必须真的离开了文档顶部（否则「不回篇首」这条判据没有区分度）").toBeGreaterThan(0);
  expect(before.overlayOpen, "遮罩必须真的开着（否则「遮罩退出」判定的是什么都没发生）").toBe(true);

  // 外部真正改写当前文档（内容变了 ⇒ revision 变了 ⇒ 走自动重载分支）
  await externalWrite(page, "scene.md", DISK_DOC);
  await fireFsEvent(page, [{ kind: "modified", path: "scene.md", entry_kind: "file" }]);
  await expect.poll(() => docText(page)).toContain("这一段只存在于磁盘版");

  // 先落读数再断言（证据纪律：任一条断言红掉，现场仍留在 test-results/m286/ 里）。
  // 1.4s 的等待同时覆盖两件事：恢复的落点经 CM 的测量周期落地（几帧内），以及捕获侧越过 1s 防抖。
  await page.waitForTimeout(1400);
  const after = await anchorNow(page);
  const afterOverlayOpen = await overlayOpen(page);
  const puts = await readingPositionPuts(page);
  await dumpEvidence("front-doc-reload", {
    before,
    after,
    afterOverlayOpen,
    readingPositionPuts: puts,
  });

  // ① 视口：重载后仍在重载前那一行（不是篇首）
  expect(
    Math.abs(after.scrollTop - before.scrollTop),
    `重载前 scrollTop=${before.scrollTop}（第 ${before.line} 行）、重载后=${after.scrollTop}（第 ${after.line} 行）` +
      "——重载把视口复位到篇首而没有恢复时，这条如实变红（消融证据见 test-results/m286/）",
  ).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(after.scrollTop, "非零：篇首是这一族缺陷的形态").toBeGreaterThan(0);

  // ② 遮罩：内容换代之后必须退出
  expect(
    afterOverlayOpen,
    "文档代际已换：遮罩必须退出（快照是旧一份文档的 DOM 副本）",
  ).toBe(false);

  // ③ 载荷：整个流程的落盘里都不许出现篇首，且最后一份落在重载前那一行附近
  expect(
    puts.filter((p) => p.entries?.["scene.md"]?.pos === 0),
    `载荷出现过篇首：${JSON.stringify(puts)}`,
  ).toEqual([]);
  const payload = puts.at(-1)?.entries?.["scene.md"];
  expect(payload, "捕获侧真的写过盘（否则上一条判据没有输入）").toBeDefined();
  const payloadLine = await page.evaluate(
    (pos) => window.__m286!.state.doc.lineAt(pos).number,
    payload!.pos,
  );
  expect(
    Math.abs(payloadLine - before.line),
    `载荷 ${JSON.stringify(payload)}（第 ${payloadLine} 行）必须落在重载前那一行（第 ${before.line} 行）附近`,
  ).toBeLessThanOrEqual(1);
});

test("外部重载**后台**标签：不拽走前台视口、不关前台的遮罩", async ({ page }) => {
  await openScene(page, { "scene.md": DOC, "other.md": OTHER_DOC });

  // 让 other.md 也有一个（后台）标签与落盘基准：打开它再切回 scene.md
  await page.locator('.ft-row[title="other.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("other.md");
  await page.locator('.ft-row[title="scene.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("scene.md");
  await page.waitForTimeout(120);

  await bringTableIntoView(page, ".cm-lp-table-slot");
  await openTableOverlay(page);
  await page.waitForTimeout(1400);
  const before = await anchorNow(page);
  expect(before.scrollTop).toBeGreaterThan(0);

  // 外部改写**后台**那一份
  await externalWrite(page, "other.md", OTHER_DISK_DOC);
  await fireFsEvent(page, [{ kind: "modified", path: "other.md", entry_kind: "file" }]);
  await page.waitForTimeout(800);

  const after = await anchorNow(page);
  await dumpEvidence("background-doc-reload", { before, after, overlayOpen: await overlayOpen(page) });
  expect(after.scrollTop, "后台标签的重载 MUST NOT 拽走前台的视口").toBe(before.scrollTop);
  expect(await overlayOpen(page), "后台标签的重载 MUST NOT 关掉前台的遮罩").toBe(true);
});
