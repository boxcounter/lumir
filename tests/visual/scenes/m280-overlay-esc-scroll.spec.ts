// M280 浮层关闭交还焦点**不得改变阅读位置**——判别层是**真机同款 UA 的 WebKit 分支**。
//
// 条款：docs/design-parity-contract/overlay-close-reading-position.md（CL-1）。
// 不变量：「浮层「打开 → 持焦 → 关闭交还焦点」这一串动作，MUST NOT 改变编辑器滚动容器的
// `scrollTop` / `scrollLeft`」——关闭前读数与关闭后读数逐值相同（本文件取 ±1px 的显示舍入余量，
// 实测两态相差一个整屏，不靠余量判定）。
//
// 本文件在两个 project 下都跑，但**只有 webkit-realua 有判别力**（条款文档的判别层表）：
//   - chromium（结构性护栏，判据第 2 条）：照跑同一份断言。看不见这个缺陷——聚焦揭示在
//     chromium 上被 `preventScroll` 挡住（M274 实证）；它的绿灯**不构成**条款通过的证据，
//     留着是为了让「场景能跑、前提断言成立」这件事本身也有回归（前提断言一旦被 fixture 改动
//     破坏，chromium 这一支会先红）。
//   - webkit-realua（`playwright.config.ts` 的 REAL_WEBKIT_UA，UA 无 `Version/` token）：
//     真机 WKWebView 走的就是「原生 preventScroll、没有任何回写兜底」那一支，缺陷在这一支上
//     可复现（M279 §2 的 T4/T4b）。**默认 UA 的 Playwright WebKit 不在此列**——它带
//     `Version/26.x` token，CM6 据此关掉 `preventScroll`、改走它自己的 `getScrollStack` 同步
//     回写栈（`@codemirror/view/dist/index.js:703`），缺陷被 CM 的兜底抹平，**修前修后都绿**
//     （M279 实测的假绿陷阱）；因此本项目单独换 UA，而不是改用默认 UA 的 webkit project。
//
// 输入分布（条款要求的三条件，逐条在用例里断言，不靠设置步骤暗示）：
//   ① 真机同款 UA（由项目提供）；
//   ② 打开浮层前**编辑器已持焦**且 caret 在视口**上方 ≥ 一屏**；
//   ③ 浮层持焦之后再关闭。
//   三条件缺任一条，引擎的聚焦揭示不会发生，用例就退化成「没红过的断言」——因此它们的成立
//   本身是断言，不是前提。
//
// 自检（REVIEW.md 第 1 条）：判据必须能 FAIL，而且分得清是哪一半在 FAIL。修前 / 修后 / 两次
// 单点消融的读数与日志见 test-results/m280/：
//   - **表格 ESC（触发钮入口）是主判别用例**：master 上红（`scrollTop 1540 → 0`，时间线
//     `[[1729,0]]`），修后绿；只把 `src/main.ts` 的表格 `restoreFocus` 改回裸
//     `editor.view.focus()`，它单独变红。
//   - **代码块 ESC 在本几何下 master 上是绿的**（如实标注，不写成「修前变红」）：M277 的
//     `focusPreservingReadingPosition` 对代码块已经接上，它这次恰好没被那句「落点判定」吃掉
//     ——M279 的 T4b 用的是另一份几何，那一支被吃掉（读数见 M279 REPORT §0.3）。本用例因此是
//     **回归护栏**而不是判别用例；它的判别力由消融证明：把代码块的 `restoreFocus` 改回裸
//     `editor.view.focus()` 后它如实变红（test-results/m280/ablation-codeblock-bare-focus.log）。
//   - 命令入口（⌘J）同样只作护栏：命中条件要求 caret 在块内 ⇒ caret 必然在视口内，引擎的聚焦
//     揭示不成立（M279 的 T1/T2）。
//
// M286 增补（同一个 spec，判的是**写盘侧**）：表格用例再加两条断言——越过 1s 落盘防抖后的
// `reading_position_put` 载荷必须落在 ESC 前那处真实锚（行号差 ≤1）、且整个流程的载荷里不许出现
// `pos 0`。它们判的是「交还焦点这一拍有没有把用户位置改写成篇首」（M279 的 finding：
// `20260927-worker-survey-esc-jump-bug-esc-pos-0-anchor-0.md`），与视口判据是两半。

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { stubTauri, configGets, readingPositionPuts } from "./tauri-stub";

/** 证据落点（git 外，与门禁日志分开）：每次跑都把读数写一份，便于逐条核对。 */
const EVIDENCE_DIR = new URL("../../../test-results/m280/scene-readings/", import.meta.url);

const TRIGGER_KEY = "Cmd-j";
const TRIGGER_PRESS = "Meta+j";

/** caret 与视口顶的最小距离（px）：条款的「≥ 一屏」（视口高 800）。 */
const MIN_CARET_ABOVE_PX = 800;
/** 关闭前后的容差（px）：两次读数都是整数化的 scrollTop，同一位置的抖动只可能来自亚像素舍入。 */
const TOLERANCE_PX = 1;

// ---------------------------------------------------------------------------
// fixture：一张长表 / 一块长代码块，都放在**首屏之外**，前后有足够正文
// （文档高 ~4500px，目标块在 ~1600px 处；把块滚进视口 ⇒ caret 被留在上方 ≥ 一屏）。
// ---------------------------------------------------------------------------

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
const CODE = [
  "```text",
  ...Array.from({ length: 60 }, (_, i) => `code line ${String(i + 1).padStart(3, "0")}`),
  "```",
].join("\n");

const TABLE_DOC = `# 表格全屏阅读位置\n\n${INTRO}\n\n${TABLE}\n\n${TAIL}\n`;
const CODE_DOC = `# 代码块全屏阅读位置\n\n${INTRO}\n\n${CODE}\n\n${TAIL}\n`;

type CmView = {
  state: {
    doc: { toString(): string; length: number; lineAt(pos: number): { number: number } };
    selection: { main: { head: number; anchor: number } };
  };
  scrollDOM: HTMLElement;
  contentDOM: HTMLElement;
  coordsAtPos(pos: number, side?: number): { top: number; bottom: number } | null;
  lineBlockAtHeight(h: number): { from: number };
  dispatch(spec: unknown): void;
  focus(): void;
  hasFocus: boolean;
  domAtPos(pos: number): { node: Node };
};

declare global {
  interface Window {
    __m280?: CmView;
    __m280Log?: [number, number][];
    __m280Calls?: { t: number; kind: string; el: string; opts: FocusOptions | null; before: number; after: number }[];
  }
}

async function openDoc(page: Page, doc: string): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 800 });
  await stubTauri(page, {
    entries: [{ path: "scene.md", kind: "file", size: doc.length, mtime_ms: 0 }],
    files: { "scene.md": doc },
    config: { keys: { [TRIGGER_KEY]: "table.toggle-fullscreen" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="scene.md"]').click();
  // 目标块在首屏之外 ⇒ 装载时它**还不在 DOM 里**（CM 只渲染视口附近），不能在这里等它的 slot。
  await expect(page.locator(".cm-content")).toBeVisible();
  // [keys] 覆盖要等 config_get 回来之后才挂上分发器（m132 的时序口径）。
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await expect(page.locator(".modeline-path")).toHaveText("scene.md");
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const el = document.querySelector(".cm-content") as unknown as { cmTile: { root: { view: CmView } } };
    const view = el.cmTile.root.view;
    window.__m280 = view;
    window.__m280Log = [];
    window.__m280Calls = [];
    view.scrollDOM.addEventListener(
      "scroll",
      () => {
        window.__m280Log!.push([Math.round(performance.now()), Math.round(view.scrollDOM.scrollTop)]);
      },
      { passive: true },
    );
    // 聚焦调用的逐次取样（M279 的仪器）：谁在聚焦、带的什么参数、同一拍前后 scrollTop 各是多少。
    // 判「引擎到底有没有被 preventScroll 挡住」必须有这层读数——只看首末终态分不出「没揭示」
    // 与「揭示了又被挡回来」。
    const protoFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, opts?: FocusOptions) {
      const before = Math.round(view.scrollDOM.scrollTop);
      const result = protoFocus.call(this, opts);
      window.__m280Calls!.push({
        t: Math.round(performance.now()),
        kind: "focus",
        el: String(this.className || this.tagName).slice(0, 32),
        opts: opts ?? null,
        before,
        after: Math.round(view.scrollDOM.scrollTop),
      });
      return result;
    };
  });
}

interface Reading {
  scrollTop: number;
  scrollLeft: number;
  caretY: number;
  caretAbovePx: number;
  viewportTop: number;
  editorFocused: boolean;
  activeElement: string;
  overlayOpen: boolean;
  /** DOM 选区是否落在内容区里（引擎的聚焦揭示以它为前提）。 */
  selInContent: boolean;
  selNode: string;
  /** caret 处的行此刻是否真的被渲染成 DOM（视口外的行会被 CM 回收）。 */
  caretRendered: boolean;
}

function reading(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const view = window.__m280!;
    const sc = view.scrollDOM;
    const box = sc.getBoundingClientRect();
    const caret = view.state.selection.main.head;
    const cr = view.coordsAtPos(caret);
    const active = document.activeElement;
    const sel = document.getSelection();
    const anchorNode = sel?.anchorNode ?? null;
    return {
      scrollTop: Math.round(sc.scrollTop),
      scrollLeft: Math.round(sc.scrollLeft),
      caretY: cr === null ? Number.NaN : Math.round(cr.top - box.top),
      caretAbovePx: cr === null ? 0 : Math.round(box.top - cr.top),
      viewportTop: Math.round(box.top),
      editorFocused: view.hasFocus,
      activeElement: String(
        (active as HTMLElement | null)?.className ?? active?.tagName ?? "?",
      ).slice(0, 60),
      overlayOpen: document.querySelectorAll(".lumir-table-fs-overlay, .lumir-codeblock-fs-overlay").length > 0,
      selInContent:
        anchorNode !== null && view.contentDOM.contains(anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentNode),
      selNode: anchorNode === null ? "none" : `${anchorNode.nodeName}.${(anchorNode.parentElement?.className ?? "").slice(0, 20)}`,
      caretRendered: view.domAtPos(caret)?.node?.isConnected ?? false,
    };
  });
}

async function scrollLogTail(page: Page, since: number): Promise<[number, number][]> {
  return page.evaluate((t) => window.__m280Log!.filter(([ts]) => ts >= t), since);
}

/**
 * 把目标块的**头部**滚进视口上沿附近（长块不可能整块可见，因此判据是「头部落在视口上半区」，
 * 而不是「整块可见」——后者对 60 行的代码块永远不成立，循环会走空）。返回 slot 与滚动容器的
 * 盒子，供上层做悬停 / 点击的坐标计算。
 */
async function bringBlockIntoView(
  page: Page,
  slotSel: string,
): Promise<{ slotBox: { x: number; y: number; width: number; height: number }; scroller: { x: number; y: number; width: number; height: number } }> {
  const scroller = (await page.locator(".cm-scroller").boundingBox())!;
  await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
  let slotBox: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < 40; i += 1) {
    const slots = page.locator(slotSel);
    // count() 不自动等待：slot 尚未渲染时不该把整个用例耗在 5s 的隐式超时上。
    if ((await slots.count()) > 0) {
      const box = await slots.first().boundingBox();
      if (box !== null && box.y >= scroller.y + 20 && box.y <= scroller.y + scroller.height * 0.5) {
        slotBox = box;
        break;
      }
    }
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(70);
  }
  if (slotBox === null) throw new Error(`${slotSel} 没有被滚进视口上半区（fixture 几何或滚轮通道有问题）`);
  await page.waitForTimeout(200);
  return { slotBox, scroller };
}

/**
 * 现场装置（逐条对应条款的三条件）：
 *   1. 点正文首屏内一处 → caret 落在文档顶部附近、编辑器持焦；
 *   2. 真实滚轮把目标块滚进视口 → caret 因此留在视口**上方**；
 *   3. `view.focus()` 显式把焦点（与 DOM 选区）交在编辑器上 —— 这是真机现场的另一半：
 *      Alex 打开浮层那一刻刚在正文里点过，编辑器本来就持焦；
 *   4. 点该块的 hover 触发钮打开浮层（浮层随即持焦）——此时才构成「关闭交还焦点」的完整现场。
 */
async function stage(page: Page, kind: "table" | "codeblock"): Promise<Reading> {
  // 1) caret 落在首屏内的正文里（用真实鼠标点击，不经 dispatch —— DOM 选区要真的在内容区）。
  const content = (await page.locator(".cm-content").boundingBox())!;
  await page.mouse.click(Math.round(content.x + content.width / 2), Math.round(content.y + 30));
  await page.waitForTimeout(120);
  const clicked = await reading(page);
  expect(clicked.editorFocused, "① 打开浮层前编辑器必须持焦（否则聚焦揭示不会发生）").toBe(true);

  // 2) 真实滚轮把目标块的头部滚进视口上沿附近。
  const slotSel = kind === "table" ? ".cm-lp-table-slot" : ".cm-lp-codeblock-slot";
  const { slotBox, scroller } = await bringBlockIntoView(page, slotSel);

  // 3) 悬停到 slot 的**可见部分**上（slot 中心可能在视口外，locator.hover() 会失手）。
  const hoverY = Math.min(Math.max(scroller.y + 60, slotBox.y + 20), scroller.y + scroller.height - 40);
  await page.mouse.move(Math.round(slotBox.x + Math.min(120, slotBox.width / 2)), Math.round(hoverY));
  const triggerSel = kind === "table" ? ".lumir-table-fs-trigger" : ".lumir-codeblock-fs-trigger";
  await expect.poll(() => page.locator(triggerSel).first().evaluate((el) => getComputedStyle(el).visibility)).toBe(
    "visible",
  );

  // 4) 焦点（与 DOM 选区）交在编辑器上——真机现场的另一半：Alex 打开浮层那一刻刚点过正文。
  await page.evaluate(() => window.__m280!.focus());
  await page.waitForTimeout(200);
  const staged = await reading(page);

  // ② caret 必须在视口上方 ≥ 一屏：不足一屏时引擎不会揭示，用例会退化成恒真。
  expect(
    staged.caretAbovePx,
    `② caret 必须在视口上方 ≥ ${MIN_CARET_ABOVE_PX}px（实测 ${staged.caretAbovePx}px）——` +
      "不足一屏就形不成「可揭示的视口外选区」，本用例在这条上退化成恒真",
  ).toBeGreaterThanOrEqual(MIN_CARET_ABOVE_PX);
  expect(staged.editorFocused, "① 滚轮之后编辑器仍须持焦").toBe(true);
  expect(staged.scrollTop, "② 视口必须真的离开了文档顶部（否则「上方」没有意义）").toBeGreaterThan(0);

  // 5) 鼠标入口打开浮层：按坐标点触发钮（`locator.click()` 会先「滚动到可见」——那会自己改
  //    scrollTop，把本用例的判据污染掉）。
  const triggerBox = (await page.locator(triggerSel).first().boundingBox())!;
  await page.mouse.click(
    Math.round(triggerBox.x + triggerBox.width / 2),
    Math.round(triggerBox.y + triggerBox.height / 2),
  );
  await page.waitForTimeout(200);
  const open = await reading(page);
  expect(open.overlayOpen, "③ 浮层必须真的打开了（否则下面判的是「什么都没发生」）").toBe(true);
  expect(open.editorFocused, "③ 打开浮层时编辑器应已失焦（焦点在浮层上）").toBe(false);
  expect(
    open.caretAbovePx,
    `② 打开浮层时 caret 仍须在视口上方 ≥ ${MIN_CARET_ABOVE_PX}px（实测 ${open.caretAbovePx}px）——` +
      "点触发钮这一步若把 caret 带走了，用例就不是在判「关闭交还焦点」",
  ).toBeGreaterThanOrEqual(MIN_CARET_ABOVE_PX);
  return open;
}

/** 打开 → ESC 关闭，返回三段读数、滚动时间线与**捕获侧参照**（ESC 前那一拍的真实锚及其行号）。 */
async function escFlow(page: Page, kind: "table" | "codeblock") {
  const open = await stage(page, kind);
  const before = await reading(page);
  // 捕获侧判据的参照锚：与产品捕获侧**同一条公式**（`lineBlockAtHeight(scrollTop).from`，
  // 见 src/scroll-position-view.ts）。取在 ESC 之前——那才是用户离开的位置。
  const anchor = await page.evaluate(() => {
    const view = window.__m280!;
    const from = view.lineBlockAtHeight(view.scrollDOM.scrollTop).from;
    return { from, line: view.state.doc.lineAt(from).number };
  });
  const t0 = await page.evaluate(() => Math.round(performance.now()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(60);
  const at60 = await reading(page);
  await page.waitForTimeout(200);
  const after = await reading(page);
  const log = await scrollLogTail(page, t0);
  const calls = await page.evaluate(
    (since) => (window.__m280Calls ?? []).filter((c) => c.t >= since),
    t0,
  );
  return { open, before, at60, after, log, calls, anchor };
}

function report(name: string, r: Awaited<ReturnType<typeof escFlow>>): void {
  console.log(`\n=== ${name} ===`);
  for (const [label, s] of [
    ["overlay-open", r.open],
    ["before-esc", r.before],
    ["esc+60ms", r.at60],
    ["esc+260ms", r.after],
  ] as const) {
    console.log(
      `   ${label.padEnd(14)} scrollTop=${s.scrollTop} scrollLeft=${s.scrollLeft} ` +
        `caretAbove=${s.caretAbovePx}px editorFocused=${s.editorFocused} active=${s.activeElement} ` +
        `selInContent=${s.selInContent} selNode=${s.selNode} caretRendered=${s.caretRendered}`,
    );
  }
  console.log(`   scrollLog(t,top) since ESC: ${JSON.stringify(r.log)}`);
  console.log(`   focusCalls since ESC: ${JSON.stringify(r.calls)}`);
}

async function dumpEvidence(name: string, payloads: unknown[]): Promise<void> {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(new URL(`${name}.json`, EVIDENCE_DIR).pathname, JSON.stringify(payloads, null, 2));
}

test("CL-1 表格全屏：ESC 关闭交还焦点后 scrollTop 恒等", async ({ page, browserName }) => {
  await openDoc(page, TABLE_DOC);
  const r = await escFlow(page, "table");
  report("table-esc", r);
  // 捕获侧的不变量（M286，finding `20260927-worker-survey-esc-jump-bug-esc-pos-0-anchor-0.md`）：
  // 越过 1s 落盘防抖之后，桩收到的载荷 MUST NOT 是跳变那一拍的中间态（篇首 / 0），而应是**跳变
  // 前用户所在的那处真实锚**。这是「同一个交还焦点动作在**写盘侧**也留下正确读数」的判据——
  // 上一条只管视口本身，载荷判的是阅读位置能力有没有被这一拍改写。失败时报告里同时有
  // `scrollLog(t,top)` 时间线与载荷原文，能分清「跳变没修好」与「跳变修好了但载荷仍被中间态覆盖」。
  //
  // **前提断言**（REVIEW.md 第 1 条：判据不许在「没发生」上空转）：只有 webkit-realua 那一支里
  // 引擎真的动过视口（M279 的聚焦揭示），载荷判据在那里才有输入；chromium 支的 `preventScroll`
  // 把揭示整个挡住（`focusCalls` 里 `before === after`），本判据在那支上退化成回归护栏——如实
  // 断言这个差异，不假装两支等价。
  if (browserName === "webkit") {
    const focusCall = r.calls.find((c) => c.el.startsWith("cm-content"));
    expect(focusCall, "webkit-realua 支必须看到那次 focus 调用（否则载荷判据没有输入）").toBeDefined();
    expect(
      Math.abs(focusCall!.after - focusCall!.before),
      `引擎必须真的动过视口（实测 before=${focusCall!.before} → after=${focusCall!.after}）——` +
        "没动过就说明这一支没走聚焦揭示那条路径，下面的载荷判据变成无输入的空转",
    ).toBeGreaterThan(0);
  }
  await page.waitForTimeout(1300);
  const puts = await readingPositionPuts(page);
  console.log(`   readingPositionPuts tail: ${JSON.stringify(puts.slice(-2))}`);
  await dumpEvidence("table-esc", [r.open, r.before, r.at60, r.after, { readingPositionPuts: puts.slice(-2) }]);
  const payload = puts.at(-1)?.entries?.["scene.md"];
  expect(payload, "载荷必须存在（捕获侧真的写过盘，否则下面的判据没有输入）").toBeDefined();
  const payloadLine = await page.evaluate(
    (pos) => window.__m280!.state.doc.lineAt(pos).number,
    payload!.pos,
  );
  expect(
    Math.abs(payloadLine - r.anchor.line),
    `落盘位置 ${JSON.stringify(payload)}（第 ${payloadLine} 行）必须落在 ESC 前那一拍的真实锚` +
      `（第 ${r.anchor.line} 行，pos ${r.anchor.from}）——中间态会落在篇首`,
  ).toBeLessThanOrEqual(1);
  expect(payload!.pos, "篇首是这一族缺陷的落盘形态：任何一次落盘都不许出现").toBeGreaterThan(0);
  expect(
    puts.filter((p) => p.entries?.["scene.md"]?.pos === 0),
    "整个流程的载荷里都不许出现 pos 0（M279 实测的落盘形态：19/47 条）",
  ).toEqual([]);
  expect(
    Math.abs(r.after.scrollTop - r.before.scrollTop),
    `关闭前 scrollTop=${r.before.scrollTop}、关闭后=${r.after.scrollTop}（时间线 ${JSON.stringify(r.log)}）`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(r.after.scrollLeft - r.before.scrollLeft)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(r.after.editorFocused, "关闭后焦点必须回到编辑器").toBe(true);
});

test("CL-1 代码块全屏：ESC 关闭交还焦点后 scrollTop 恒等", async ({ page }) => {
  await openDoc(page, CODE_DOC);
  const r = await escFlow(page, "codeblock");
  report("codeblock-esc", r);
  await dumpEvidence("codeblock-esc", [r.open, r.before, r.at60, r.after]);
  expect(
    Math.abs(r.after.scrollTop - r.before.scrollTop),
    `关闭前 scrollTop=${r.before.scrollTop}、关闭后=${r.after.scrollTop}（时间线 ${JSON.stringify(r.log)}）`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(r.after.scrollLeft - r.before.scrollLeft)).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(r.after.editorFocused, "关闭后焦点必须回到编辑器").toBe(true);
});

// 命令入口（经 [keys] 绑定的 ⌘J）是浮层的第二条打开路径，与鼠标入口共用同一个 `close(reason)`
// 单入口——真机场景 62 走的正是它。**这条不构成本文件的主判据**：命令的命中条件是「caret 落在
// 块内」，caret 因此必然在视口内，引擎的聚焦揭示不成立（M279 的 T1/T2：caret 在视口外但编辑器
// 未持焦 / caret 在视口内 ⇒ 两态都不跳）。它在这里的作用是**守住命令入口这条路径的关闭不变量**
// （修前修后都应绿），与主判据（前两条）一起构成「两条打开路径都测过」。
test("CL-1 命令入口（⌘J）：关闭后 scrollTop 恒等", async ({ page }) => {
  await openDoc(page, TABLE_DOC);

  // caret 落进表格里（命令入口的命中判据）：先点正文首屏，再把表滚进来，然后**点进表内**——
  // 全程真实鼠标，不经 dispatch 设 caret（设出来的选区不是「用户点出来的」那种形态）。
  const content = (await page.locator(".cm-content").boundingBox())!;
  await page.mouse.click(Math.round(content.x + content.width / 2), Math.round(content.y + 30));
  await page.waitForTimeout(120);
  const { slotBox, scroller } = await bringBlockIntoView(page, ".cm-lp-table-slot");
  const clickY = Math.min(Math.max(scroller.y + 80, slotBox.y + 40), scroller.y + scroller.height - 80);
  await page.mouse.click(Math.round(slotBox.x + Math.min(160, slotBox.width / 2)), Math.round(clickY));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__m280!.focus());
  await page.waitForTimeout(150);

  const before = await reading(page);
  expect(before.editorFocused).toBe(true);
  expect(before.scrollTop, "视口必须真的离开了文档顶部（这条判据不能在最顶处空转）").toBeGreaterThan(0);

  await page.keyboard.press(TRIGGER_PRESS);
  await expect.poll(() => page.locator(".lumir-table-fs-overlay").count()).toBe(1);
  await page.waitForTimeout(200);
  const opened = await reading(page);
  expect(opened.overlayOpen).toBe(true);
  expect(opened.editorFocused).toBe(false);

  await page.keyboard.press("Escape");
  await page.waitForTimeout(260);
  const after = await reading(page);
  console.log(
    `\n=== command-entry === scrollTop before=${before.scrollTop} open=${opened.scrollTop} after=${after.scrollTop}`,
  );
  expect(
    Math.abs(after.scrollTop - before.scrollTop),
    `关闭前 ${before.scrollTop}、关闭后 ${after.scrollTop}`,
  ).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(after.editorFocused).toBe(true);
});
