import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { providerEntry, standardProviders } from "./provider-config";

const PROVIDERS = {
  kimi: providerEntry("kimi", {
    model: "kimi-k3-extended-context-experimental",
    models: [
      { id: "kimi-k3-extended-context-experimental", effort: true, window: 1048576 },
      { id: "k2", effort: false, window: 262144 },
    ],
  }),
  mock: providerEntry("mock", { fixture: "f.json" }),
};

// 浮层宽度合同的结构矩阵（M702，change overlay-width-contract-oct24）。
//
// 为什么需要这一层：M698 的盘点把「固定像素宽 + 内容会变长」的同族缺陷落到 5 处，但
// 单测只能判纯几何（overlay-placement.test.ts）与静态声明（overlay-width-registry.test.ts），
// 判不了「真实 DOM 里量出来的自然宽、真实 pane 宽、真实字号缩放后的结果」。本场景在
// chromium 里跑真实装配链（真实 CSS + 真实配置通道），断言**计算后的几何**：
//
//   1. ⌘P 长路径：行内文件名节点完整、目录前缀出省略号、title 是全路径、行不横向溢出；
//      浮层宽 = min(26em, 100vw − 28px)，不随输入抖动。
//   2. Context 气泡：1× 下长读数把宽度撑到 236px 以上（旧定值 224 必红）；2.13× 下
//      宽 pane 装下 482px 的长句（旧定值 224 会折成 3 行）；窄 pane 下不越出 pane。
//   3. 合并选择器：2.13× + 320px pane 时包围盒完整落在 pane 内（旧形态越出 85px 被裁）。
//   4. 会话浮层：2.13× 下宽名字把浮层撑过 300px（旧定值 200 裁掉 81%），且完整落在视口内。
//   5. resize 后重夹：仍打开的浮层在视口收窄后重新落进 pane（W6）。
//
// 全部断言是**结构 / 计算属性**（没有像素基线）：CI 的 `LUMIR_VISUAL_STRUCTURAL=1` 照跑；
// ctxpop 的既有元素级像素基线（m347-ctxpop-cache-metrics.png）留给本地门禁判——本 change
// 用「组件下限 224px」让短内容零漂移，长读数 fixture 的基线变宽（225×103 → 262×67）已经
// Alex 过目并批准重截（`--update` 只跑了那三张，见 `.local/reviews/overlay-width-oct24/`）。
//
// 区分度输入（REVIEW.md「断言等价于子串」条）：长路径 ≥ 60 字符、长读数 112.7k/131k、
// 2.13× 走真实 `Cmd-=` 步进（不是给元素贴 CSS 变量）、pane 收窄走真实分隔条拖拽。

const DEEP_PATH = "areas/work/clients/acme/2026/q4/meetings/2026-10-24-kickoff-notes-final-v2.md";
const DEEP_NAME = "2026-10-24-kickoff-notes-final-v2.md";
const DEEP_DOC = "# Kickoff\n\nDEEP-702-MARKER\n";
const NOTE_DOC = "# 宽度笔记\n\n第一段，给上下文 chip 一个视口口径。\n";
const LONG_SESSION = "帮我整理这份笔记的第二章并核对全部引用来源";

/** 直接打开行的中文深路径（M702 r1）：文件名比候选 fixture 更长，正常窗口下动作前缀必须让宽。 */
const CN_PATH = "笔记/2026/项目/会议/2026-10-24-启动会纪要与行动项确认.md";
const CN_NAME = "2026-10-24-启动会纪要与行动项确认.md";
/** vault 外英文长路径：D590 的动作前缀（含「只读」）同样必须先于文件名收缩。 */
const EXT_PATH = "/tmp/lumir-verify/2026-10-24-kickoff-notes-final-v2.md";
const EXT_NAME = "2026-10-24-kickoff-notes-final-v2.md";

const VAULT: VaultFixture = {
  entries: [
    { path: "harness-note.md", kind: "file", size: NOTE_DOC.length, mtime_ms: 0 },
    { path: "areas", kind: "dir", size: 0, mtime_ms: 0 },
    { path: DEEP_PATH, kind: "file", size: DEEP_DOC.length, mtime_ms: 0 },
    { path: "笔记", kind: "dir", size: 0, mtime_ms: 0 },
    { path: CN_PATH, kind: "file", size: DEEP_DOC.length, mtime_ms: 0 },
  ],
  files: {
    "harness-note.md": NOTE_DOC,
    [DEEP_PATH]: DEEP_DOC,
    [CN_PATH]: DEEP_DOC,
  },
  externalFiles: { [EXT_PATH]: DEEP_DOC },
  links: {},
};

/** 通用桩之外的 harness 面：状态、会话清单、配置里的长模型名、事件注入钩子。 */
async function stubHarness(page: Page): Promise<void> {
  await page.addInitScript((providers) => {
    (window as unknown as Record<string, unknown>).__VISUAL_PROVIDERS = providers;
  }, PROVIDERS);
  await page.addInitScript((sessionName) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0, has_usage: false },
          pending_approval: null,
          warn_ctx_pct: 85,
          thinking: { level: "high", supported: true },
        });
      }
      if (cmd === "harness_send") return null;
      if (cmd === "harness_list_sessions") {
        // 长会话名是宽度判据的输入（20 码点上限下，2.13× 时固有宽 ≈ 500px + 时间读数）。
        return JSON.stringify([{ session_id: "s1759912345678-width", first_user_text: sessionName, ts: 1759912345 }]);
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "kimi",
          providers: (window as unknown as Record<string, any>).__VISUAL_PROVIDERS,
          permissions: { allow: [], deny: [] },
          permission_mode: "vault_write",
          loop_max: 8,
          warn_ctx_pct: 85,
          auto_compact: false,
        };
      }
      return result;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, LONG_SESSION);
}

/** 打开 harness pane（⌘⇧A 的分栏动作与 toggle 钮同一条装配路径；用钮避免键位截获的干扰）。 */
async function openHarness(page: Page): Promise<void> {
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

/** 把字号步进到 2.13×（15→…→32；32 ÷ 15 = 2.1333）并等 harness 的缩放比落地。 */
async function scaleToMax(page: Page): Promise<void> {
  for (let i = 0; i < 8; i += 1) await page.keyboard.press("Meta+=");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(
          getComputedStyle(document.querySelector(".lumir-harness")!).getPropertyValue("--lumir-hp-scale"),
        ),
      ),
    )
    .toBeCloseTo(32 / 15, 3);
}

interface Box {
  left: number;
  right: number;
  width: number;
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`${sel} 不在 DOM 里`);
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  }, selector);
}

/** 浮层包围盒完整落在 pane 可用区内（W1/W6 的几何判据；用 inset 7.5 容抗锯齿）。 */
async function expectInsidePane(page: Page, selector: string): Promise<void> {
  const pane = await boxOf(page, ".lumir-harness");
  const pop = await boxOf(page, selector);
  expect(pop.left, `${selector} 左缘越出 pane`).toBeGreaterThanOrEqual(pane.left + 7.5);
  expect(pop.right, `${selector} 右缘越出 pane`).toBeLessThanOrEqual(pane.right - 7.5);
  expect(pop.width, `${selector} 宽度退化`).toBeGreaterThan(40);
}

/** 拖分栏分隔条（正 = 向右，harness pane 变窄）。 */
async function dragDivider(page: Page, deltaX: number): Promise<void> {
  const divider = page.locator(".pane-divider");
  const box = await divider.boundingBox();
  if (box === null) throw new Error("分隔条没有包围盒");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

async function paneWidth(page: Page): Promise<number> {
  return (await boxOf(page, ".lumir-harness")).width;
}

async function hoverCtxReading(page: Page): Promise<void> {
  const ctx = page.locator(".lumir-hp-ctxwrap");
  await expect(ctx).toBeVisible();
  await ctx.hover();
  await expect(page.locator(".lumir-hp-ctxpop")).toBeVisible();
}

async function fireLongUsage(page: Page): Promise<void> {
  await page.evaluate(() =>
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({
      type: "usage",
      ctx_pct: 86,
      cache_pct_session: 60,
      cache_pct_turn: 50,
      cache_write_tokens: 6174,
      cache_write_tokens_session: 12044,
      cache_note: "block_dilution",
      input_tokens: 112722,
      cached_tokens: 6000,
      cached_tokens_session: 10300,
      context_window: 131072,
      has_usage: true,
    }),
  );
  await expect(page.locator(".lumir-hp-ctx")).toHaveText("86% · 60%");
}

// ---------------------------------------------------------------------------
// 1) ⌘P：长路径
// ---------------------------------------------------------------------------

test("⌘P 长路径：浮层宽 26em、目录前缀中段省略、文件名完整、title 全路径", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  // 就绪门：文件树渲染出第一条行 = vault 装载完成。⌘P 的绑定在启动装配末尾才接好，
  // 在此之前按键会静默无效（弹层停在 hidden）——既有 quick-open 场景同一条口令。
  await expect(page.locator(".ft-row").first()).toBeVisible();
  await page.keyboard.press("Meta+p");
  const popover = page.locator(".lumir-qo");
  await expect(popover).toBeVisible();
  await page.keyboard.type("kickoff");

  const items = page.locator(".lumir-qo-item");
  await expect(items).toHaveCount(1);
  const item = items.first();
  // 文本仍是完整路径（匹配语义 / ARIA / 既有逐条文本断言的合同不变）。
  await expect(item).toHaveText(DEEP_PATH);
  // 文件名是独立节点且完整可见——单行尾省略会把身份主体吃掉（M698：77 字符路径裁 42.5%）。
  const name = item.locator(".lumir-qo-name");
  await expect(name).toHaveText(DEEP_NAME);
  // title = 全文通道（W5）。
  await expect(item).toHaveAttribute("title", DEEP_PATH);

  const metrics = await page.evaluate(() => {
    const root = document.querySelector(".lumir-qo") as HTMLElement;
    const row = document.querySelector(".lumir-qo-item") as HTMLElement;
    const dirs = row.querySelector(".lumir-qo-dirs") as HTMLElement;
    const name = row.querySelector(".lumir-qo-name") as HTMLElement;
    return {
      popWidth: root.getBoundingClientRect().width,
      fontSize: Number.parseFloat(getComputedStyle(root).fontSize),
      rowOverflow: row.scrollWidth - row.clientWidth,
      dirsClipped: dirs.scrollWidth > dirs.clientWidth,
      nameOverflow: name.scrollWidth - name.clientWidth,
    };
  });
  // 宽 = min(26em, 100vw − 28px)；em 基准是行文本字号 12.5px ⇒ 325px。
  expect(metrics.fontSize).toBeCloseTo(12.5, 1);
  expect(metrics.popWidth).toBeGreaterThanOrEqual(320);
  expect(metrics.popWidth).toBeLessThanOrEqual(330);
  // 行不横向溢出（溢出即被浮层的 overflow:hidden 裁掉，属于缺陷形态）。
  expect(metrics.rowOverflow).toBeLessThanOrEqual(1);
  // 目录前缀真的被中段省略（深路径 60+ 字符）——这是「折叠」发生的正观测。
  expect(metrics.dirsClipped).toBe(true);
  // 文件名不先被裁（放得下时为 0；极端窄的宿主才允许 > 0，本 fixture 到不了那一档）。
  expect(metrics.nameOverflow).toBeLessThanOrEqual(1);

  // 反向观测：短路径行不出省略号（区分度——不是所有行都折）。
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("harness-note");
  const shortRow = page.locator(".lumir-qo-item").first();
  await expect(shortRow).toHaveText("harness-note.md");
  const shortDirs = shortRow.locator(".lumir-qo-dirs");
  await expect(shortDirs).toHaveCount(0); // 根目录文件没有目录前缀
});

/** 直接打开行（`.lumir-qo-direct`）的几何读数：文件名是否完整、谁先让了宽。 */
function directRowMetrics(page: Page): Promise<{
  rowOverflow: number;
  pathOverflow: number;
  prefixClipped: boolean;
  dirsClipped: boolean;
  nameOverflow: number;
}> {
  return page.evaluate(() => {
    const row = document.querySelector(".lumir-qo-direct") as HTMLElement;
    const path = row.querySelector(".lumir-qo-direct-path") as HTMLElement;
    const prefix = row.querySelector(".lumir-qo-prefix") as HTMLElement;
    const dirs = row.querySelector(".lumir-qo-dirs") as HTMLElement;
    const name = row.querySelector(".lumir-qo-name") as HTMLElement;
    return {
      rowOverflow: row.scrollWidth - row.clientWidth,
      pathOverflow: path.scrollWidth - path.clientWidth,
      prefixClipped: prefix !== null && prefix.scrollWidth > prefix.clientWidth,
      dirsClipped: dirs !== null && dirs.scrollWidth > dirs.clientWidth,
      nameOverflow: name.scrollWidth - name.clientWidth,
    };
  });
}

/** 直接行的共同判据：文件名完整、行不溢出；动作前缀与目录先被牺牲（正观测）。 */
async function expectDirectNameIntact(page: Page, name: string): Promise<void> {
  const direct = page.locator(".lumir-qo-direct");
  await expect(direct).toBeVisible();
  await expect(direct.locator(".lumir-qo-name")).toHaveText(name);
  const metrics = await directRowMetrics(page);
  expect(metrics.nameOverflow, "直接打开行的文件名被裁——收缩优先级没有把动作前缀排到前面").toBeLessThanOrEqual(1);
  expect(metrics.rowOverflow).toBeLessThanOrEqual(1);
  expect(metrics.pathOverflow).toBeLessThanOrEqual(1);
  expect(metrics.dirsClipped, "目录前缀应先于文件名收缩（本 fixture 的路径足够深）").toBe(true);
  expect(metrics.prefixClipped, "动作前缀应先于文件名收缩（本 fixture 的正常窗口宽度下应已被牺牲）").toBe(true);
}

test("⌘P 直接打开行：vault 内中文深路径 + 行号后缀，文件名完整（动作前缀先让宽）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expect(page.locator(".ft-row").first()).toBeVisible();
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo")).toBeVisible();
  // fill 处理中文（keyboard.type 对 CJK 依赖插入事件序列，这里只要一次完整输入）。
  // `:12` 让直接行带落点标记（`.lumir-qo-direct-line`，flex:none 的第三个占位者）。
  await page.locator(".lumir-qo-input").fill(`${CN_PATH}:12`);
  await expect(page.locator(".lumir-qo-direct-line")).toHaveText("第 12 行");
  await expectDirectNameIntact(page, CN_NAME);
});

test("⌘P 直接打开行：vault 外英文长路径，只读动作先让宽、文件名完整", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await expect(page.locator(".ft-row").first()).toBeVisible();
  await page.keyboard.press("Meta+p");
  await expect(page.locator(".lumir-qo")).toBeVisible();
  await page.locator(".lumir-qo-input").fill(EXT_PATH);
  // 外部路径的直接行文案 = D590（动作前缀把「只读」写进动作里；英文文件名是身份主体）。
  await expect(page.locator(".lumir-qo-direct")).toContainText("只读打开");
  await expectDirectNameIntact(page, EXT_NAME);
});

// ---------------------------------------------------------------------------
// 2) Context 气泡：内容驱动 + em 上限
// ---------------------------------------------------------------------------

test("ctxpop：长读数把宽度撑过旧定值 224；2.13× 宽 pane 装下长句且不越 pane", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openHarness(page);
  // usage 只在开轮窗口里被消费：先发一条，再注入 usage（与 m347 同一机制）。
  await page.locator(".lumir-hp-composer").fill("宽度判据");
  await page.locator(".lumir-hp-send").click();
  await fireLongUsage(page);
  await hoverCtxReading(page);

  const at1x = await boxOf(page, ".lumir-hp-ctxpop");
  // 「上下文：已用 112.7k / 131k tokens（86%）」实测固有宽 237.5px——旧定值 224 会折行。
  expect(at1x.width, "长读数没有把气泡撑宽（旧定值回潮？）").toBeGreaterThanOrEqual(236);
  await expectInsidePane(page, ".lumir-hp-ctxpop");

  await page.mouse.move(10, 10);
  await expect(page.locator(".lumir-hp-ctxpop")).toBeHidden();

  // 2.13×：同一句话 482px——px 上限（旧 224）会折成 3 行，em 上限（34em ≈ 869px）装得下。
  await scaleToMax(page);
  await hoverCtxReading(page);
  const atMax = await boxOf(page, ".lumir-hp-ctxpop");
  expect(atMax.width, "放大档没有把气泡撑宽（px 上限回潮？）").toBeGreaterThanOrEqual(440);
  const fontSize = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.querySelector(".lumir-hp-ctxpop")!).fontSize),
  );
  expect(fontSize).toBeCloseTo(12 * 2.13, 0);
  // 宽度不超过 34em 上限与 pane 可用宽（两者取小）。
  const pane = await boxOf(page, ".lumir-harness");
  expect(atMax.width).toBeLessThanOrEqual(Math.min(34 * fontSize, pane.width - 16) + 1);
  await expectInsidePane(page, ".lumir-hp-ctxpop");
});

test("ctxpop：2.13× + 320px pane 不越出 pane（O1 的结构前提）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openHarness(page);
  await dragDivider(page, 150);
  await expect.poll(() => paneWidth(page)).toBeLessThan(360);
  await scaleToMax(page);
  await page.locator(".lumir-hp-composer").fill("窄 pane");
  await page.locator(".lumir-hp-send").click();
  await fireLongUsage(page);
  await hoverCtxReading(page);
  const pop = await boxOf(page, ".lumir-hp-ctxpop");
  const pane = await boxOf(page, ".lumir-harness");
  // 宽 pane 装不下的内容按可用宽收窄（不是越界后被 overflow:hidden 裁掉）。
  expect(pop.width).toBeLessThanOrEqual(pane.width - 16 + 1);
  await expectInsidePane(page, ".lumir-hp-ctxpop");
});

// ---------------------------------------------------------------------------
// 3) 合并选择器：放大档 + 窄 pane
// ---------------------------------------------------------------------------

test("合并选择器：2.13× + 窄 pane 下浮层完整落在 pane 内（旧形态越界 85px）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openHarness(page);
  await dragDivider(page, 150);
  await expect.poll(() => paneWidth(page)).toBeLessThan(360);
  await scaleToMax(page);

  const chip = page.locator(".lumir-hp-model");
  await expect(chip).toBeVisible();
  await chip.click();
  const selPop = page.locator(".lumir-hp-selpop");
  await expect(selPop).toBeVisible();
  await expectInsidePane(page, ".lumir-hp-selpop");

  const metrics = await page.evaluate(() => {
    const pop = document.querySelector(".lumir-hp-selpop") as HTMLElement;
    const pane = document.querySelector(".lumir-harness") as HTMLElement;
    const style = getComputedStyle(pop);
    return {
      popWidth: pop.getBoundingClientRect().width,
      paneWidth: pane.getBoundingClientRect().width,
      fontSize: Number.parseFloat(style.fontSize),
      // 计算值是 px（em 已按 font-size 换算）——判它等于 26 × fontSize 即证明上限随字号走。
      maxWidth: Number.parseFloat(style.maxWidth),
    };
  });
  // 宽 = min(内容, 26em, 可用宽)；窄 pane 上可用宽是上限。
  expect(metrics.popWidth).toBeLessThanOrEqual(metrics.paneWidth - 16 + 1);
  expect(metrics.popWidth).toBeGreaterThan(metrics.paneWidth - 40);
  // 上限声明是 em（随字号缩放）：26em × 计算字号。写死 px 时这里会与 26 × fontSize 不符。
  expect(metrics.maxWidth).toBeCloseTo(26 * metrics.fontSize, 0);
  expect(metrics.fontSize).toBeCloseTo(12 * 2.13, 0);
});

// ---------------------------------------------------------------------------
// 4) 会话浮层：宽名字 + 放大档
// ---------------------------------------------------------------------------

test("会话浮层：2.13× 下长名字把浮层撑过旧定值 200，且完整落在视口内", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openHarness(page);
  await scaleToMax(page);
  await page.locator(".lumir-hp-session").click();
  const pop = page.locator(".lumir-hp-sesspop");
  await expect(pop).toBeVisible();
  await expect(pop).toContainText("帮我整理这份笔记的第二章");

  const metrics = await page.evaluate(() => {
    const el = document.querySelector(".lumir-hp-sesspop") as HTMLElement;
    const r = el.getBoundingClientRect();
    return { width: r.width, left: r.left, right: r.right, viewport: window.innerWidth };
  });
  expect(metrics.width, "会话名没有把浮层撑宽（定值 200 回潮？）").toBeGreaterThan(300);
  expect(metrics.left).toBeGreaterThanOrEqual(8 - 0.5);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewport - 8 + 0.5);
});

// ---------------------------------------------------------------------------
// 5) resize 后重夹（W6）
// ---------------------------------------------------------------------------

test("resize 后重夹：仍打开的选择器浮层随 pane 收窄重新落进 pane", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await openHarness(page);
  await scaleToMax(page);
  await page.locator(".lumir-hp-model").click();
  const selPop = page.locator(".lumir-hp-selpop");
  await expect(selPop).toBeVisible();
  const before = await boxOf(page, ".lumir-hp-selpop");
  expect(before.width).toBeGreaterThan(350); // 放大档的内容宽（旧定值 / 无夹取形态）

  await page.setViewportSize({ width: 760, height: 800 });
  await expect.poll(() => paneWidth(page)).toBeLessThan(400);
  // 浮层仍开着（resize 不是关闭信号），且宽度与落点已按新 pane 重算。
  // ResizeObserver 与 pane 宽度落地不在同一个任务里：paneWidth 一变就断几何会抢在重夹之前
  // （M702 r1 复跑实测的一次 flake：pane 已窄、selpop 右缘仍是旧值）。先 poll 到右缘进入
  // pane，再断最终几何。
  await expect(selPop).toBeVisible();
  await expect
    .poll(async () => {
      const pane = await boxOf(page, ".lumir-harness");
      const pop = await boxOf(page, ".lumir-hp-selpop");
      return Math.round(pop.right - (pane.right - 7.5));
    })
    .toBeLessThanOrEqual(0);
  await expectInsidePane(page, ".lumir-hp-selpop");
  const after = await boxOf(page, ".lumir-hp-selpop");
  expect(after.width).toBeLessThanOrEqual(before.width);
});
