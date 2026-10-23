import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M638 / M644（change improve-harness-streaming-scroll，design §5.2）：harness transcript 的
// 跟随滚动与「回到底部」浮钮——**行为场景**，不新增像素基线（浮钮 hidden 时既有基线预期零漂移；
// 基线更新是人肉裁决点，本 change 不自行 --update）。
//
// 断言序列逐条对应 design §5.2 的 10 条；第 4 条是本 change 的**主判据**：缺陷形态下
// （修前 `scrollToBottom()` 每帧无条件写底）该断言必然红。反向验证读数（2026-10-23 实测：
// 把 `flushChunks` 的 `follow.contentGrew()` 临时改回无条件写底 `transcript.scrollTop =
// transcript.scrollHeight` 后再跑本场景）：
//   - 修前：上滚脱离后注入 20 个 chunk → `scrollTop` 相对锚点位移 **1702px**（判据要求 ≤ 1），
//     即用户刚滚出的阅读位置被增量拽回底部——「脱离态下任何增量都不得写滚动位」这条红；
//   - 修后：同一输入 `scrollTop` 逐值不变（±1），`scrollHeight` 增长 ≥ 100。
// 修后读数由本场景每次真跑断言（不是口头值）。

const DOC = "# 滚动笔记\n\n给面板一个上下文段落。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-scroll-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-scroll-note.md": DOC },
  links: {},
};

const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

type Theme = "light" | "dark" | "eink";

/** M351 / M628 场景桩（同构）：config_get 补 [harness] 段；harness_send / harness_abort /
 *  harness_new_session 只记录不回复（回复经 __fireHarnessEvent 注入）。 */
async function stubHarness(page: Page, state: unknown): Promise<void> {
  await page.addInitScript((snapshot) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send" || cmd === "harness_abort" || cmd === "harness_new_session") return null;
      if (cmd === "harness_state") return JSON.stringify(snapshot);
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: { kimi: { model: "k2" }, deepseek: { model: "d" }, mock: { fixture: "f.json" } },
          permissions: { allow: [], deny: [] },
          loop_max: 8,
          warn_ctx_pct: 85,
          auto_compact: true,
        };
      }
      return result;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, state);
}

async function openPanel(page: Page, config: { theme?: Theme; language?: "zh" | "en" } = {}): Promise<void> {
  await stubTauri(page, { ...VAULT, config });
  await stubHarness(page, EMPTY_STATE);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-scroll-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("上下文");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

function fire(page: Page, payload: unknown): Promise<void> {
  return page.evaluate(
    (p) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(p),
    payload,
  );
}

/** 注入一轮正文（每行一个段落，行内带唯一串——`scrollHeight` 的增长因此可判）。 */
async function injectText(page: Page, from: number, lines: number): Promise<void> {
  const text = Array.from({ length: lines }, (_, i) => `第 ${from + i} 行 · SCROLL-PROBE`).join("\n\n");
  await fire(page, { type: "text_chunk", text: `${text}\n\n` });
}

/** 等两帧 rAF：流式合帧（flushChunks + flushNow）与写底编排都在帧内完成。 */
async function frames(page: Page, count = 2): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
}

interface ScrollReading {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  max: number;
  buttonHidden: boolean;
  unread: boolean;
  label: string | null;
}

async function readScroll(page: Page): Promise<ScrollReading> {
  const el = page.locator(".lumir-hp-transcript");
  const box = await el.evaluate((node) => {
    const t = node as HTMLElement;
    return { scrollTop: t.scrollTop, clientHeight: t.clientHeight, scrollHeight: t.scrollHeight };
  });
  const button = page.locator(".lumir-hp-jumpbottom");
  const buttonHidden = await button.evaluate((node) => (node as HTMLElement).hidden);
  const unread = await button.evaluate((node) => node.classList.contains("is-unread"));
  const label = await button.getAttribute("aria-label");
  return { ...box, max: Math.max(0, box.scrollHeight - box.clientHeight), buttonHidden, unread, label };
}

/** 在 transcript 上面滚（真实指针事件；落点取容器中心——滚动区命中判据与用户手感同通道）。
 *
 *  等滚动**落定**再返回：Chromium 的滚轮是平滑滚动（多帧动画），立刻读会读到动画中间态——
 *  后续的「强制回底」写入会被尚未跑完的动画拽回目标位（实测：发送后 `scrollTop` 恰好差
 *  300px，就是那次 wheel 的动画尾）。连续两帧读数相同即视为落定。 */
async function wheelOverTranscript(page: Page, deltaY: number): Promise<void> {
  const box = await page.locator(".lumir-hp-transcript").boundingBox();
  if (box === null) throw new Error("transcript 没有布局盒，无法注入滚轮");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
  const el = page.locator(".lumir-hp-transcript");
  let last = Number.NaN;
  for (let i = 0; i < 60; i += 1) {
    await frames(page, 1);
    const now = await el.evaluate((node) => (node as HTMLElement).scrollTop);
    if (now === last) return;
    last = now;
  }
  throw new Error("滚轮 60 帧后仍未落定");
}

/** token 探针：把 var() 取值解析成计算样式后与目标比对（不硬编 rgb）。 */
async function probeColor(page: Page, prop: string, token: string): Promise<string> {
  return page.evaluate(
    ([p, t]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(p as string, `var(${t})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p as string);
      probe.remove();
      return value;
    },
    [prop, token] as const,
  );
}

/** 打开面板 + 发一条消息 + 灌出 ≥3 屏内容（跟随态，停在底部）。 */
async function primeTranscript(page: Page): Promise<void> {
  await page.locator(".lumir-hp-composer").fill("先灌一段长内容");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  for (let i = 0; i < 8; i += 1) await injectText(page, i * 12, 12);
  await frames(page, 3);
}

test("跟随 / 脱离 / 回底 / 白名单 / 非用户事件 / 不足一屏（design §5.2 的 1–9 条）", async ({ page }) => {
  await openPanel(page, { theme: "light" });
  await primeTranscript(page);

  // ① 前提：内容确实溢出（≥ 3 屏）；没有这个前提，后面所有读数都是空转。
  let m = await readScroll(page);
  expect(m.scrollHeight, "内容必须显著高于视口（否则本场景没有区分度）").toBeGreaterThan(m.clientHeight + 120);

  // ② 跟随时贴底：注入 5 个 chunk 后仍在滚动上限。
  for (let i = 0; i < 5; i += 1) await injectText(page, 200 + i * 2, 2);
  await frames(page, 3);
  m = await readScroll(page);
  expect(Math.abs(m.scrollTop - m.max), "跟随态下增量落地后必须贴底").toBeLessThanOrEqual(1);
  expect(m.buttonHidden, "跟随态不出现回底钮").toBe(true);

  // ③ 上滚脱离：真实滚轮把视口带离底部，钮浮现（D2：脱离即显示）。
  const before = m.scrollTop;
  await wheelOverTranscript(page, -300);
  m = await readScroll(page);
  expect(before - m.scrollTop, "滚轮必须真的产生位移（否则本场景判的是空转）").toBeGreaterThanOrEqual(100);
  expect(m.buttonHidden, "脱离态下回底钮必须可见").toBe(false);
  expect(m.unread, "刚脱离时没有新内容：未读圆点不在场").toBe(false);

  // ④ 核心断言（修前必红）：再注入 20 个 chunk，视口纹丝不动，内容确实增长了。
  const anchoredTop = m.scrollTop;
  const anchoredHeight = m.scrollHeight;
  for (let i = 0; i < 20; i += 1) await injectText(page, 300 + i * 3, 3);
  await frames(page, 3);
  m = await readScroll(page);
  expect(Math.abs(m.scrollTop - anchoredTop), "脱离态下任何增量都不得写滚动位（±1px）").toBeLessThanOrEqual(1);
  expect(m.scrollHeight - anchoredHeight, "内容必须真的增长了（否则零写入是空转）").toBeGreaterThanOrEqual(100);
  expect(m.unread, "脱离期间有新内容 → 未读提示在场").toBe(true);
  expect(m.buttonHidden, "脱离态保持（D6：跨轮次不自动回底）").toBe(false);
  expect(m.label, "有新内容时可访问名取 D556").toContain("有新内容");

  // ⑤ 点钮回底：回到上限、钮退场；后续增量继续贴底。
  await page.locator(".lumir-hp-jumpbottom").click();
  m = await readScroll(page);
  expect(Math.abs(m.scrollTop - m.max), "点钮必须回到内容末尾").toBeLessThanOrEqual(1);
  expect(m.buttonHidden, "回底后钮退场").toBe(true);
  expect(m.unread, "回底清未读").toBe(false);
  for (let i = 0; i < 5; i += 1) await injectText(page, 400 + i, 1);
  await frames(page, 3);
  m = await readScroll(page);
  expect(Math.abs(m.scrollTop - m.max), "恢复跟随后增量继续贴底").toBeLessThanOrEqual(1);

  // ⑥ 滞回：底部的 8px 小滚动（< 脱离阈值 16px）不打断跟随。
  await wheelOverTranscript(page, -8);
  m = await readScroll(page);
  expect(m.buttonHidden, "距底 8px（滞回区间内）不得脱离").toBe(true);
  await injectText(page, 500, 2);
  await frames(page, 3);
  m = await readScroll(page);
  expect(Math.abs(m.scrollTop - m.max), "滞回区间内的增量把视口带回底部").toBeLessThanOrEqual(1);

  // ⑦ 白名单：上滚脱离后发送一条消息 → 强制回底、钮退场。
  // 先收一轮（done）：面板停在「处理中」时发送钮是**停止态**，点击会 abort 而不是发消息
  //（首跑实测：发送根本没发生，读数差了恰好一次滚轮的 300px）。
  await fire(page, { type: "done" });
  await frames(page, 3);
  await wheelOverTranscript(page, -300);
  m = await readScroll(page);
  expect(m.buttonHidden, "发送前先处于脱离态（本步的前提）").toBe(false);
  await page.locator(".lumir-hp-composer").fill("白名单动作");
  await page.locator(".lumir-hp-send").click();
  await frames(page, 3);
  m = await readScroll(page);
  expect(Math.abs(m.scrollTop - m.max), "发送消息 = 白名单动作，必须强制回底").toBeLessThanOrEqual(1);
  expect(m.buttonHidden, "强制回底后钮退场").toBe(true);

  // ⑧ 非用户事件不拽：脱离态下工具行 / 通知 / 错误行都不改滚动位。
  await wheelOverTranscript(page, -300);
  m = await readScroll(page);
  expect(m.buttonHidden).toBe(false);
  const pinned = m.scrollTop;
  await fire(page, { type: "tool_call", name: "Read", status: "started", summary: "probe.md" });
  await frames(page, 2);
  expect(Math.abs((await readScroll(page)).scrollTop - pinned), "工具行更新不拽视口").toBeLessThanOrEqual(1);
  await fire(page, {
    type: "notice",
    runs: [{ run_id: "r-probe", agent: "probe-agent", description: "后台任务", status: "ok", summary: "完成" }],
  });
  await frames(page, 2);
  expect(Math.abs((await readScroll(page)).scrollTop - pinned), "通知不拽视口").toBeLessThanOrEqual(1);
  await fire(page, { type: "error", message: "SCROLL-PROBE-ERR" });
  await frames(page, 2);
  const afterError = await readScroll(page);
  expect(Math.abs(afterError.scrollTop - pinned), "错误行不拽视口（MODIFIED 错误呈现条款）").toBeLessThanOrEqual(1);
  expect(afterError.unread, "脱离态下的新内容（含错误）点亮未读").toBe(true);

  // ⑨ 不足一屏：新会话清空渲染面 → 无溢出 → 不出脱离态、滚轮不产生可见位移。
  await page.locator(".lumir-hp-plus").click();
  await expect(page.locator(".lumir-hp-msg")).toHaveCount(0);
  await frames(page, 2);
  m = await readScroll(page);
  expect(m.scrollHeight, "新会话内容不足一屏（本步的前提）").toBeLessThanOrEqual(m.clientHeight + 1);
  await wheelOverTranscript(page, -300);
  m = await readScroll(page);
  expect(m.buttonHidden, "内容不足一屏时不出现脱离态与回底钮").toBe(true);
  expect(m.scrollTop, "不足一屏时滚动调用不产生可见位移").toBe(0);
});

for (const theme of ["light", "dark", "eink"] as const) {
  test(`浮钮的配色与文案（${theme}）：三 token 归属 + zh / en 两档可访问名`, async ({ page }) => {
    await openPanel(page, { theme });
    await primeTranscript(page);
    await wheelOverTranscript(page, -300);
    let m = await readScroll(page);
    expect(m.buttonHidden, "本场景的前提：浮钮可见").toBe(false);

    const button = page.locator(".lumir-hp-jumpbottom");
    const style = await button.evaluate((node) => {
      const s = getComputedStyle(node as HTMLElement);
      return { backgroundColor: s.backgroundColor, borderColor: s.borderTopColor, borderWidth: s.borderTopWidth };
    });
    expect(style.backgroundColor, "浮钮底面取 --preview-bg（浮层件同族配方）").toBe(
      await probeColor(page, "background-color", "--preview-bg"),
    );
    expect(style.borderColor, "浮钮描边取 --border（eink 下即黑框）").toBe(
      await probeColor(page, "border-top-color", "--border"),
    );
    expect(style.borderWidth).toBe("1px");

    // 未读圆点：脱离后注入内容 → 圆点在场、颜色取 --accent（eink = 黑）。
    await injectText(page, 700, 2);
    await frames(page, 2);
    m = await readScroll(page);
    expect(m.unread).toBe(true);
    const dotColor = await page
      .locator(".lumir-hp-jumpbottom-dot")
      .evaluate((node) => getComputedStyle(node as HTMLElement).backgroundColor);
    expect(dotColor, "未读圆点取 --accent").toBe(await probeColor(page, "background-color", "--accent"));
    // 无动效（不脉冲）：钮上不得挂 animation（prefers-reduced-motion 下零差异的前提）。
    const animation = await button.evaluate((node) => getComputedStyle(node as HTMLElement).animationName);
    expect(animation === "none" || animation === "", "浮钮必须有零动效（D3/D7：出现即状态表达）").toBe(true);
  });
}

test("浮钮可访问名：en 档取英文串（语言切换后重取）", async ({ page }) => {
  await openPanel(page, { theme: "light", language: "en" });
  await primeTranscript(page);
  await wheelOverTranscript(page, -300);
  const button = page.locator(".lumir-hp-jumpbottom");
  await expect(button).toHaveAttribute("aria-label", "Back to bottom");
  await injectText(page, 800, 2);
  await frames(page, 2);
  await expect(button).toHaveAttribute("aria-label", "New content, back to bottom");
});
