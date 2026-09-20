// M187 图片替换区尺寸的会话内一致性（属性测试，chromium 通道）。
//
// 不变量（条款原文见 docs/specs/image-reading.md §5）：本会话内已渲染过的图片引用，其替换区在
// widget 重建时 SHALL 在字节到达前就占住与终态一致的尺寸，因而**图片字节的异步到达 MUST NOT
// 改变正文的滚动位置**。
//
// 判据（本文件唯一的判别面，时序无关）：逐帧记录 `.cm-scroller` 的 scrollTop 时间线，同时记录
// 用户输入事件（wheel / keydown 的时间戳）。任意相邻两帧之间，scrollTop 变化超过 8px 却不在任一
// 输入事件的 ±40ms 邻域内 → 记一次「非用户输入引起的滚动位移」。修复前该值最坏 465px（探针与
// 本文件的红输出见 test-results/m187/），修复后为 0。
//
// 为什么不是「比较输入前后的 scrollTop」：缺陷是一对方向相反、相隔一次字节到达的位移，净变化为 0
// （所以按「净位移」判会漏掉它）。逐帧判据则把中间态直接抓出来，与采样时点无关。
//
// 自检（REVIEW.md 第 1 条：断言必须有区分度）：
//   - 附件读取计数 ≥ 2：证明 widget 真的被销毁并重建过（观测路径被走到），否则判据空转假绿；
//   - 翻屏键用例断言「该步真的滚动了视口」：按键没落地时不是静默通过，而是 FAIL。
//
// 驱动扫「方向（正向 / 倒序）× 步长（慢 60px / 快 600px）+ 翻屏键（⌥V）」；正向慢滚是控制组
// （用户报告与实测都不触发，两态都必须为 0）。
//
// 反向验证（本文件的判别性证据）：把 src/preview/attachments.ts 还原到 master（7267b26）后，
// 本文件两条用例都 FAIL，读数与逐帧现场留档 test-results/m187/。没有这一步，本文件只是「没红过
// 的断言」，不构成门禁。

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { stubTauri } from "./tauri-stub";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/m187-svg-scroll/${name}`, import.meta.url), "utf8");

const WIDE_DOC = fixture("wide.md");
const NARROW_DOC = fixture("narrow.md");
const ASSETS: Record<string, string> = {
  "assets/scroll-wide.svg": fixture("assets/scroll-wide.svg"),
  "assets/scroll-narrow.svg": fixture("assets/scroll-narrow.svg"),
};

/** 判据阈值（px）：修复前最坏 465px，两档相差两个数量级，取 8px 留足机器抖动余量。 */
const THRESHOLD_PX = 8;
/** 输入事件的时间邻域（ms）：输入自身引起的滚动落在它之后的一两帧内。 */
const INPUT_WINDOW_MS = 40;
/** 附件字节到达的模拟延迟（ms）：真机是毫秒级，这里放大到 120ms 让「重建瞬间」与「字节到达
 *  把行块长回来」两个时刻在时间轴上分得开（判据因此不依赖机器快慢）。 */
const READ_DELAY_MS = 120;

interface Frame {
  t: number;
  top: number;
  state: string;
}

interface Movement {
  worst: number;
  moves: string[];
  frames: number;
  inputs: number;
  timeline: Frame[];
}

/** 打开一篇文档：桩后端 + 附件读取计数与延迟（异步到达的真实形态）。 */
async function openDoc(page: Page, file: string, doc: string, marker: string): Promise<void> {
  await page.setViewportSize({ width: 1200, height: 800 });
  await stubTauri(page, {
    entries: [
      { path: file, kind: "file", size: doc.length, mtime_ms: 0 },
      ...Object.keys(ASSETS).map((path) => ({ path, kind: "file", size: 512, mtime_ms: 0 })),
    ],
    files: { [file]: doc, ...ASSETS },
  });
  await page.addInitScript(
    ([map, delay]: [Record<string, string>, number]) => {
      const w = window as unknown as Record<string, any>;
      w.__attachReads = {};
      const internals = w.__TAURI_INTERNALS__;
      const original = internals.invoke;
      internals.invoke = async (command: string, argv: { path?: string }) => {
        if (command !== "fs_read_attachment") return original(command, argv);
        const path = argv.path ?? "";
        w.__attachReads[path] = (w.__attachReads[path] ?? 0) + 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
        const content = map[path];
        if (content === undefined) throw { code: "fs_not_found", message: `文件不存在：${path}` };
        const bytes = new TextEncoder().encode(content);
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary);
      };
    },
    [ASSETS, READ_DELAY_MS] as [Record<string, string>, number],
  );
  await page.goto("/");
  await page.locator(`.ft-row[title="${file}"]`).click();
  await expect(page.locator(".cm-content")).toContainText(marker);
  await page.waitForTimeout(300);
}

/** 装逐帧采样器 + 输入事件记录器；`reset` 在每次「测量相位」开始时清空基线。 */
async function installRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const scroller = () => document.querySelector(".cm-scroller") as HTMLElement;
    const now = () => Math.round(performance.now());
    w.__m187 = { samples: [] as Array<{ t: number; top: number }>, inputs: [] as number[] };
    w.__m187Reset = () => {
      w.__m187.samples = [];
      w.__m187.inputs = [];
    };
    window.addEventListener("wheel", () => w.__m187.inputs.push(now()), { capture: true, passive: true });
    window.addEventListener(
      "keydown",
      (event: KeyboardEvent) => {
        if (event.ctrlKey || event.altKey || event.metaKey) w.__m187.inputs.push(now());
      },
      { capture: true },
    );
    // 每帧同时记下图片替换区的形态（img / 加载中 / 预留元素 / 不在场）与它的高度：判据失败时
    // 用它定位是哪一种形态切换伴随了位移。
    const shape = () => {
      const wrap = document.querySelector(".cm-lp-image") as HTMLElement | null;
      if (!wrap) return "none";
      const img = wrap.querySelector("img");
      const status = wrap.querySelector(".cm-lp-image-status");
      const reserve = wrap.querySelector(".cm-lp-image-reserve");
      const h = Math.round(wrap.getBoundingClientRect().height);
      return `${img ? "img" : status ? "status" : reserve ? "reserve" : "empty"}:${h}`;
    };
    const tick = () => {
      w.__m187.samples.push({ t: now(), top: Math.round(scroller().scrollTop), state: shape() });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function resetRecorder(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as Record<string, any>).__m187Reset());
}

/** 逐帧判定：相邻两帧之间 scrollTop 变化 > 阈值且不在任一输入事件的邻域内 → 一次自走位。 */
async function movements(page: Page): Promise<Movement> {
  return page.evaluate(
    ([threshold, window$]: [number, number]) => {
      const d = (window as unknown as Record<string, any>).__m187 as {
        samples: Array<{ t: number; top: number; state: string }>;
        inputs: number[];
      };
      const moves: string[] = [];
      let worst = 0;
      for (let i = 1; i < d.samples.length; i++) {
        const before = d.samples[i - 1];
        const after = d.samples[i];
        const delta = after.top - before.top;
        if (Math.abs(delta) <= threshold) continue;
        const attributed = d.inputs.some((t) => t >= before.t - window$ && t <= after.t + window$);
        if (attributed) continue;
        worst = Math.max(worst, Math.abs(delta));
        moves.push(`${before.t}->${after.t}ms ${before.top}->${after.top} (Δ${delta})`);
      }
      return { worst, moves, frames: d.samples.length, inputs: d.inputs.length, timeline: d.samples };
    },
    [THRESHOLD_PX, INPUT_WINDOW_MS] as [number, number],
  );
}

async function readCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...((window as unknown as Record<string, any>).__attachReads as Record<string, number>) }));
}

const top = (page: Page) =>
  page.evaluate(() => Math.round((document.querySelector(".cm-scroller") as HTMLElement).scrollTop));

const wheelSteps = async (page: Page, delta: number, times: number, gapMs: number) => {
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(gapMs);
  }
};

function expectNoSelfMovement(report: Movement, phase: string): void {
  // 绿也要留读数：判据是「阈内无位移」，帧数/输入数证明采样器真的在跑（没跑 = 判据空转）。
  console.log(
    `[m187] ${phase}: 帧 ${report.frames} / 输入 ${report.inputs} / 非输入位移 ${report.moves.length} 次 / 最坏 ${report.worst}px`,
  );
  if (report.moves.length === 0) {
    expect(report.moves).toEqual([]);
    return;
  }
  // 失败时把每个位移点前后各 6 帧的原样时间线打出来：位移伴随哪一种替换区形态切换，是归因的
  // 第一手信息（形态串 = img/status/reserve/empty/none + 包装盒高度）。
  const lines = report.moves.map((move) => {
    const at = Number(move.slice(0, move.indexOf("->")));
    const idx = report.timeline.findIndex((f) => f.t >= at);
    const from = Math.max(0, idx - 6);
    const window = report.timeline
      .slice(from, idx + 7)
      .map((f) => `    ${f.t}ms top=${f.top} ${f.state}`)
      .join("\n");
    return `  ${move}\n${window}`;
  });
  expect(
    report.moves,
    `${phase}：出现非用户输入引起的滚动位移（最坏 ${report.worst}px，阈值 ${THRESHOLD_PX}px）\n${lines.join("\n")}`,
  ).toEqual([]);
}

test("倒序经过大尺寸 svg 图（viewBox-only）：正文不发生非用户输入的滚动位移", async ({ page }) => {
  test.setTimeout(240_000);
  await openDoc(page, "wide.md", WIDE_DOC, "m187 倒序滚动（宽图）");
  await installRecorder(page);
  await page.mouse.move(640, 400);

  // 预热（不测量）：正向滚过图片——它被渲染一次（几何进会话记忆），随后滚出渲染视口被销毁。
  // 16 × 120px ≈ 1900px：图片底边（文档坐标约 830）因此落在可见区顶部上方 1000px 开外，
  // 超出渲染视口的视口边距（慢滚时约 440px），widget 被销毁。
  await wheelSteps(page, 120, 16, 90);
  await expect(page.locator(".cm-lp-image img")).toHaveCount(0);
  await resetRecorder(page);

  // 相位 1（缺陷现场）：倒序慢滚回到图片处并继续向上经过它。
  await wheelSteps(page, -60, 20, 260);
  expectNoSelfMovement(await movements(page), "倒序慢滚");

  // 相位 2：正向快滚把图片再次推出渲染视口，再倒序快滚回来（另一档步长）。
  await resetRecorder(page);
  await wheelSteps(page, 600, 2, 320);
  await wheelSteps(page, -600, 2, 320);
  expectNoSelfMovement(await movements(page), "倒序快滚");

  // 相位 3：翻屏键（⌥V）——与滚轮不同的输入通道，且每步都要求「真的滚动了视口」。
  // 先不测量地跳到底部（翻屏键会经过图片，重建路径照走），保证三步都不撞上、下边界。
  await page.evaluate(() => {
    const scroller = document.querySelector(".cm-scroller") as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(320);
  await resetRecorder(page);
  // 用 DOM 聚焦而不是点击：点击会把光标放到点中处、CM 随之 scrollIntoView，视口位置被改掉
  //（真机同款副作用只在「用户点了编辑器」时发生，与翻屏键本身无关）。
  await page.evaluate(() => (document.querySelector(".cm-content") as HTMLElement).focus());
  const focused = await page.evaluate(() => document.activeElement?.className ?? "");
  expect(focused, `焦点不在编辑器上，翻屏键不会落地：${focused}`).toContain("cm-content");
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) {
    const before = await top(page);
    await page.keyboard.press("Alt+KeyV");
    await page.waitForTimeout(320);
    expect(await top(page), "⌥V 没有滚动视口：输入通道没落地，本例的判据会空转").not.toBe(before);
  }
  expectNoSelfMovement(await movements(page), "翻屏键 ⌥V");

  // 自检：图片至少被读两次 = widget 确实被销毁并重建（否则上面三条判据没走到观测路径）。
  const reads = await readCounts(page);
  expect(reads["assets/scroll-wide.svg"] ?? 0, `附件读取次数不足，重建路径未被走到：${JSON.stringify(reads)}`).toBeGreaterThanOrEqual(2);
  // 终态：图片渲染出来了（不是占位或源码）。
  await expect(page.locator(".cm-lp-image img")).toHaveCount(1);
});

test("倒序经过窄定尺寸图片：预留不动包装盒宽度、不拉伸图片、无自走位", async ({ page }) => {
  test.setTimeout(240_000);
  await openDoc(page, "narrow.md", NARROW_DOC, "m187 倒序滚动（窄图）");
  await installRecorder(page);
  await page.mouse.move(640, 400);

  // 预热（不测量）：分步正向滚过图片——它被渲染并加载（几何进会话记忆），随后滚出渲染视口被
  // 销毁。用分步而不是一次跳到底：一次跳越可能让图片整段落在渲染视口之外，从头到尾没被渲染，
  // 重建路径就没被走到（下面的读取次数自检会因此 FAIL——这是有意留的自检，不是放宽）。
  await wheelSteps(page, 100, 16, 180);
  await expect(page.locator(".cm-lp-image img")).toHaveCount(0);
  await resetRecorder(page);

  // 倒序慢滚回来并停在图片处：图片重建，走「窄图钉宽度」那条预留分支。步间隔取 320ms
  //（> 2× 字节到达延迟 120ms）：否则字节到达引发的位移会落在下一步滚轮的 ±40ms 邻域里被当成
  // 输入，判据空转。
  await wheelSteps(page, -60, 24, 320);
  expectNoSelfMovement(await movements(page), "倒序慢滚（窄图）");

  const reads = await readCounts(page);
  expect(reads["assets/scroll-narrow.svg"] ?? 0, `附件读取次数不足，重建路径未被走到：${JSON.stringify(reads)}`).toBeGreaterThanOrEqual(2);

  // 行为断言（不是像素断言）：图片按自身宽度渲染、未被拉伸到栏宽；包装盒宽度仍是栏宽
  //（M182 宽度不变量的判据面：首开 / 重开两态逐项一致）。
  const geometry = await page.evaluate(() => {
    const wrap = document.querySelector(".cm-lp-image") as HTMLElement | null;
    const img = wrap?.querySelector("img") as HTMLImageElement | null;
    const line = wrap?.parentElement as HTMLElement | null;
    const box = (el: Element | null | undefined) => {
      const rect = el?.getBoundingClientRect();
      return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
    };
    return { wrap: box(wrap), img: box(img), line: box(line) };
  });
  expect(geometry.img.width, "窄图被拉伸（或没渲染）").toBeCloseTo(240, 0);
  expect(geometry.img.height, "窄图被拉伸（或没渲染）").toBeCloseTo(80, 0);
  expect(geometry.wrap.width, "包装盒宽度被预留样式夹窄了（M182 判据面被破坏）").toBeCloseTo(geometry.line.width, 0);
});
