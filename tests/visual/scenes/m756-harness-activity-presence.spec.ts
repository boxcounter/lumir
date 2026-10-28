import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M756：harness 活动在场（change add-harness-activity-presence）的**结构**场景。
//
// 本场景只做结构 / 计算属性断言，**不新增整页像素基线**（基线新增是人肉裁决点，见
// tests/visual/README.md「新增场景」第 5 条）：6×6 的状态点远小于整页容差预算
// （1200×800×0.001 ≈ 960 px），像素对比对它没有区分度——三态的「在场」必须由结构断言守卫。
//
// 判据分四组：
//   1. **空闲零漂移**：状态点常驻 DOM 但 `display:none`（不产生任何上屏像素），可访问状态文本为空；
//   2. **三态结构**：在途 = 空心环 / 未读回复 = 实心点 / 未读失败 = 实心点 + 外环——形状差异
//      可判（不单靠颜色），且点**锚在 toggle 钮的矩形内**；
//   3. **收起 ≠ 复位**：面板收起期间在途态与未读态都保留（活动提示的整个意义所在）；
//   4. **可访问性**：`aria-describedby` 指向视觉隐藏的 `aria-live="polite"` 状态文本，
//      文案取自 deck（D870 / D871 / D872）。
//
// r1 的两条 P1 各有行为回归（旧实现在这里必红，逐条实测过）：
//   5. `harness_busy` 的重取**不得重放内容、不得拽走视口**（P1-1：进入档会把历史 append 第二遍）；
//   6. 点击 cron 在收起期间完成时**未读必须存活**、内容只重建一次（P1-2：`reloadSession` 的
//      `vault_changed` 会把刚产生的未读吃掉）；
//   7. 只内容回包**在途时视图换代**（新建同 vault 会话）⇒ 旧回包作废，新会话仍为空（复审 P1：
//      相位 idle → idle 不推进 epoch，只有 `resetView` 推进 `snapshotSeq` 才拦得住）。

const DOC = "# 活动在场笔记\n\n第一段，给面板一个可开的文档。\n";

/** 固定 root：cron 点击运行的 `ensureCronVault` 以「目标 vault == 已装载 root」判真空切换，
 *  场景因此必须知道这个路径（缺省 root 是桩内部的 demo 常量，写死它就成了跨场景耦合）。 */
const VAULT: VaultFixture = {
  root: "/tmp/lumir-m756-activity-vault",
  entries: [{ path: "activity-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "activity-note.md": DOC },
  links: {},
};

/** 长一些的历史消息：让 transcript 真的可滚（下面「拒绝不得拽走视口」的判据需要脱离态）。 */
const HISTORY = Array.from({ length: 6 }, (_, index) => [
  { role: "user", text: `H${index * 2 + 1} 历史提问 ${index + 1}` },
  { role: "assistant", text: `H${index * 2 + 2} 历史回答 ${index + 1}。${"正文占位。".repeat(12)}` },
]).flat();

/** 桩的可调参数（r1 P1 的两条回归各用一组）。 */
interface ActivityStubOptions {
  /** `harness_state` 的 messages（键集合与 Rust `PanelMessage` 同形）。 */
  messages?: Array<{ role: string; text: string }>;
  /** 快照的呈现读；缺省 false（空闲）。 */
  inFlight?: boolean;
  /** `harness_send` 的拒绝形态（缺省成功）。 */
  sendReject?: { code: string; message: string } | null;
  /** cron 点击运行：`harness_cron_run` 成功 + 运行开始后 `harness_state` 换成 `cronMessages`。 */
  cronMessages?: Array<{ role: string; text: string }>;
  /** 第 `fromCall` 次起（1 基）的快照应答延迟毫秒数：给出「重取已发出、响应未回」的窗口，
   *  用来判「响应回来时会不会把视口拽走」。 */
  stateDelayFromCall?: { fromCall: number; ms: number };
}

/**
 * 活动在场场景桩：在通用 stub 之上补四处（与 m347 同一套注入机制）：
 *   1. `harness_state` 桩（键集合同 Rust `StateSnapshot`，含本 change 新增的 `in_flight`）；
 *   2. `harness_send`（可拒绝）/ `harness_abort`（成功）；
 *   3. `harness_cron_run`（成功）+ 运行开始后快照换内容（cron 收尾重建的判据输入）；
 *   4. `__fireHarnessEvent` / `__fireCronRun`：记录事件 handler id，经 runCallback 注入。
 */
async function stubHarnessActivity(page: Page, options: ActivityStubOptions = {}): Promise<void> {
  await page.addInitScript((opts: ActivityStubOptions) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [] as number[];
    w.__cronRunHandlerIds = [] as number[];
    w.__harnessStateCalls = 0;
    let cronStarted = false;
    const snapshot = (messages: Array<{ role: string; text: string }>) =>
      JSON.stringify({
        messages: messages.map((m) => ({
          role: m.role,
          text: m.text,
          ts: 1759912345,
        })),
        usage: { ctx_pct: 0, cache_pct_session: 0, has_usage: false },
        pending_approvals: [],
        warn_ctx_pct: 85,
        thinking: { level: "high", supported: true },
        in_flight: opts.inFlight ?? false,
      });
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        if (opts.sendReject) throw opts.sendReject;
        return null;
      }
      if (cmd === "harness_abort") return null;
      if (cmd === "harness_new_session") return null;
      if (cmd === "harness_cron_run") {
        cronStarted = true;
        return null;
      }
      if (cmd === "harness_state") {
        w.__harnessStateCalls += 1;
        const delayed = opts.stateDelayFromCall;
        if (delayed && w.__harnessStateCalls >= delayed.fromCall) {
          await new Promise((resolve) => setTimeout(resolve, delayed.ms));
        }
        return snapshot(cronStarted && opts.cronMessages ? opts.cronMessages : opts.messages ?? []);
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      if (cmd === "plugin:event|listen" && args.event === "cron:run") {
        w.__cronRunHandlerIds.push(args.handler ?? 0);
      }
      return origInvoke(cmd, args);
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
    w.__fireCronRun = (payload: unknown) => {
      for (const id of w.__cronRunHandlerIds) {
        internals.runCallback(id, { event: "cron:run", id, payload });
      }
    };
  }, options);
}

async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) => (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

/** 状态点的计算样式（形状判据都落在这里：边框 / 背景 / 外环）。 */
async function dotStyle(page: Page) {
  return page.locator(".lumir-hp-toggle-dot").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      display: style.display,
      background: style.backgroundColor,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      boxShadow: style.boxShadow,
    };
  });
}

test("活动在场：三态结构 / 点锚在钮内 / 收起不复位 / 空闲零上屏", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessActivity(page);
  await page.goto("/");
  await page.locator('.ft-row[title="activity-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");

  const toggle = page.locator(".lumir-hp-toggle");
  const dot = page.locator(".lumir-hp-toggle-dot");
  const status = page.locator(".lumir-hp-toggle-status");

  // ── ① 空闲：三态之一的「零上屏」形态 ────────────────────────────────────
  await expect(toggle).toHaveAttribute("data-activity", "idle");
  await expect(dot).toBeHidden(); // display:none ⇒ 不产生任何上屏像素
  expect((await dotStyle(page)).display).toBe("none");
  await expect(status).toHaveText("");

  // 可访问性：钮的描述指向那段视觉隐藏文本，且它是 polite live region。
  const describedBy = await toggle.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  expect(await status.getAttribute("id")).toBe(describedBy);
  expect(await status.getAttribute("aria-live")).toBe("polite");

  // ── ② 在途：相位推进（面板展开时 toggle 按退让条款隐藏，三态的**可见**形态在收起态判）──
  await toggle.click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const composer = page.locator(".lumir-hp-composer");
  await composer.fill("这一轮要跑一会儿");
  await page.locator(".lumir-hp-send").click();
  await expect(toggle).toHaveAttribute("data-activity", "inflight");
  await expect(status).toHaveText("处理中"); // D870
  // 展开态：送钮自己就是「停止」态（钮面 glyph 已换），与标题栏的状态点同一份相位。
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");

  // ── ③ 收起 ≠ 复位：收起后在途态仍在，且状态点此时才真正上屏（空心环）────────
  // 收起走 ⌘⇧A：面板展开时 toggle 钮按退让条款隐藏（双 pane 时那颗钮不在场上），
  // 键位才是收起路径的入口。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await expect(toggle).toHaveAttribute("data-activity", "inflight");
  const inflight = await dotStyle(page);
  expect(inflight.display).not.toBe("none");
  // 空心环：有实心描边、无填充。宽度取声明值（1.5px）的**存在性**而非精确像素——
  // chromium 在 dpr=1 下把 1.5px 归到布局单位的整数档（实测 getComputedStyle 报 1px），
  // 判据落在「有环 vs 无环」这个形状差异上才有意义。
  expect(inflight.borderTopStyle).toBe("solid");
  expect(Number.parseFloat(inflight.borderTopWidth)).toBeGreaterThan(0);
  expect(inflight.background).toBe("rgba(0, 0, 0, 0)"); // 未填充 = 与「实心点」形状可分
  expect(inflight.boxShadow).toBe("none");
  const geometry = await page.evaluate(() => {
    const button = document.querySelector(".lumir-hp-toggle")!.getBoundingClientRect();
    const point = document.querySelector(".lumir-hp-toggle-dot")!.getBoundingClientRect();
    return {
      inside:
        point.left >= button.left &&
        point.top >= button.top &&
        point.right <= button.right &&
        point.bottom <= button.bottom,
      size: { width: point.width, height: point.height },
    };
  });
  expect(geometry.inside).toBe(true);
  expect(geometry.size).toEqual({ width: 6, height: 6 });

  // 收起期间正常结束 ⇒ 未读「回复」档：实心点（与在途的空心环形状可分）。
  await fire(page, { type: "done" });
  await expect(toggle).toHaveAttribute("data-activity", "reply");
  const reply = await dotStyle(page);
  expect(reply.background).not.toBe("rgba(0, 0, 0, 0)"); // 实心
  expect(Number.parseFloat(reply.borderTopWidth)).toBe(0); // 无环 = 实心点
  expect(reply.boxShadow).toBe("none"); // 无外环 = 与失败档可分
  await expect(status).toHaveText("有新的回复"); // D871

  // ── ④ 打开面板即已读：未读清算、点回到零上屏 ────────────────────────────
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(toggle).toHaveAttribute("data-activity", "idle");
  await expect(dot).toBeHidden();
  await expect(status).toHaveText("");

  // ── ⑤ 失败档：实心点 + 外环（与回复档同样不单靠颜色）────────────────────
  await composer.fill("这一轮会失败");
  await page.locator(".lumir-hp-send").click();
  await expect(toggle).toHaveAttribute("data-activity", "inflight");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await fire(page, { type: "error", code: "llm_upstream", message: "上游炸了" });
  await expect(toggle).toHaveAttribute("data-activity", "failure");
  const failure = await dotStyle(page);
  expect(failure.background).not.toBe("rgba(0, 0, 0, 0)"); // 实心
  expect(failure.boxShadow).toContain("rgb("); // 1px 外环
  await expect(status).toHaveText("有失败结果"); // D872

  // ── ⑥ 用户主动停止不产生未读（D2）──────────────────────────────────────
  await page.keyboard.press("Meta+Shift+A"); // 打开 = 已读清算
  await expect(toggle).toHaveAttribute("data-activity", "idle");
  await composer.fill("这一轮我会主动停止");
  await page.locator(".lumir-hp-send").click();
  await page.locator(".lumir-hp-send").click(); // running 相位 = 停止
  await expect(toggle).toHaveAttribute("data-activity", "inflight");
  await page.keyboard.press("Meta+Shift+A"); // 收起（stopping 仍在途）
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await fire(page, { type: "aborted" });
  await expect(toggle).toHaveAttribute("data-activity", "idle");
  await expect(dot).toBeHidden();
});

// ── r1 P1-1：harness_busy 的重取不得重放内容、不得拽走视口 ────────────────────
//
// 现场：发送被 `harness_busy` 拒绝时，面板**已有一条内容完整的 transcript**（事前没有
// resetView）。旧实现调进入档 `fetchSnapshot()`——它逐条 append 快照消息（历史再上屏一遍）、
// 末尾还 `follow.jumpToBottom()`（响应回来时把视口拽回底部）。修复后走只读相位通道
// `fetchActivitySnapshot()`：相位与闸门按 `in_flight` 收口，内容与滚动位一概不动。
//
// 判据的两个时间点：① 拒绝回包**之后**历史不许重复、相位按 in_flight 收口；② 回包**途中**
// 手动滚到顶部，回包落地后滚动位必须还在那里（旧实现在这一步会跳到底部）。发送动作本身
// 会强制回底（分流表 #1 的白名单动作），所以「不拽视口」只能在这个窗口里判，不能在点发送前判。
test("harness_busy 拒绝：既有消息不重复、回包不拽视口、相位按 in_flight 收口", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessActivity(page, {
    messages: HISTORY,
    sendReject: { code: "harness_busy", message: "对话正在处理中" },
    stateDelayFromCall: { fromCall: 2, ms: 600 },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="activity-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  const messages = page.locator(".lumir-hp-msg");
  await expect(messages).toHaveCount(HISTORY.length);

  await page.locator(".lumir-hp-composer").fill("这条会被 busy 拒绝");
  await page.locator(".lumir-hp-send").click();
  // 拒绝先上错误行（回包还在 600ms 延迟窗口里）。
  await expect(page.locator(".lumir-hp-error")).toContainText("对话正在处理中");

  // 窗口内手动滚到顶部（脱离态）：回包落地后必须还在这里。
  const transcript = page.locator(".lumir-hp-transcript");
  await transcript.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  const before = await transcript.evaluate((el) => el.scrollTop);
  expect(before).toBe(0);

  // 等回包落地（stateDelayFromCall 的 600ms + 一拍余量）。
  await page.waitForTimeout(900);

  // ① 相位按 in_flight（false）收口：发送钮回到「发送」。
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");
  // ② 历史只上屏一遍：既有 N 条 + 乐观上屏的那条 user 消息（既有语义），绝不是 2N。
  await expect(messages).toHaveCount(HISTORY.length + 1);
  // ③ 回包不得拽走视口：滚动位保持（容差 2px 吸收字体基线的舍入）。
  const after = await transcript.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
});

// ── r1 P1-2：点击 cron 收起期间完成，未读必须存活 ──────────────────────────
//
// 现场：`done` 先以 `mounted:false` 产生 reply 未读，随后 `cronRunAdopted` 调 `reloadSession()`
// ——它经 `resetView` 以 `vault_changed` 结算，把刚产生的未读吃掉（指示退回空闲）。修复后收尾
// 走只内容档位：未读存活，内容按后端快照**只重建一次**。
test("cron 点击运行：收起期间完成 ⇒ 未读存活，内容只重建一次", async ({ page }) => {
  const cronPrompt = "CRON-PROMPT 点击运行这一条";
  const cronAnswer = "CRON-ANSWER 这一轮的回答";
  await stubTauri(page, VAULT);
  await stubHarnessActivity(page, {
    cronMessages: [
      { role: "user", text: cronPrompt },
      { role: "assistant", text: cronAnswer },
    ],
  });
  await page.goto("/");
  await page.locator('.ft-row[title="activity-note.md"]').click();

  const toggle = page.locator(".lumir-hp-toggle");
  // 点击通知发起运行（装配层 handleCronRun：开面板 → beginCronRun 切屏 → invoke）。
  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireCronRun: (p: unknown) => void }).__fireCronRun(payload),
    {
      origin: { kind: "cron", task: "acc-m756", run_id: "run-m756-1" },
      session_target: { kind: "interactive" },
      tool_policy: { allow: [] },
      budget: { max_rounds: 8, max_tokens: 0 },
      approval_policy: { kind: "interactive" },
      background: false,
      trigger: "manual",
      vault: "/tmp/lumir-m756-activity-vault",
      prompt: cronPrompt,
      session: "new",
      session_id: null,
      model: null,
    },
  );
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(toggle).toHaveAttribute("data-activity", "inflight");

  // 收起面板：这一轮将在收起期间结束（用户此刻在读正文）。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeHidden();

  await fire(page, { type: "done" });
  await expect(toggle).toHaveAttribute("data-activity", "reply");

  // 等 cron 收尾的内容重建真的跑完（第 2 次 harness_state = 收尾那次只内容档快照），
  // 再断言未读**仍然**在——旧实现会在这里退回 idle（r1 P1-2 的现场）。
  await page.waitForFunction(
    () => ((window as unknown as { __harnessStateCalls: number }).__harnessStateCalls ?? 0) >= 2,
  );
  await expect(toggle).toHaveAttribute("data-activity", "reply");
  await expect(page.locator(".lumir-hp-toggle-status")).toHaveText("有新的回复");

  // 打开面板：内容按快照重建**一次**（prompt 与回答各一条，不重复），未读随之清算。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(toggle).toHaveAttribute("data-activity", "idle");
  await expect(page.locator(".lumir-hp-msg").filter({ hasText: cronAnswer })).toHaveCount(1);
  await expect(page.locator(".lumir-hp-msg").filter({ hasText: cronPrompt })).toHaveCount(1);
});

// ── tower 追加：只内容档快照的世代守卫（终态后立刻开新轮）──────────────────
//
// 现场：终态到达时面板发起只内容档快照（中途接管对账）。请求发出之后用户立刻发了下一条
// （`sent` 推进 `phaseEpoch`，新消息乐观上屏）；回包落地时**清面 + 重放**会把那条新消息
// 清掉，直到下一条事件才补回来。修复后：内容档在清面前比对世代，过期回包整条丢弃。
test("只内容档快照的世代守卫：回包落地不得清掉请求之后的新消息", async ({ page }) => {
  const history = [
    { role: "user", text: "G1 上一轮提问" },
    { role: "assistant", text: "G2 上一轮回答" },
  ];
  await stubTauri(page, VAULT);
  await stubHarnessActivity(page, {
    messages: history,
    inFlight: true, // 进入快照报在途 ⇒ 面板置「中途接管」，终态时会发起对账
    stateDelayFromCall: { fromCall: 2, ms: 700 },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="activity-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const messages = page.locator(".lumir-hp-msg");
  await expect(messages).toHaveCount(2);
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");

  // 终态：接管标志 ⇒ 发起只内容档快照（回包被延迟 700ms）。
  await fire(page, { type: "done" });
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");

  // 回包在途时开新一轮：新消息乐观上屏。
  await page.locator(".lumir-hp-composer").fill("NEW-TURN 新的一轮");
  await page.locator(".lumir-hp-send").click();
  await expect(messages).toHaveCount(3);

  // 等过期回包落地：它 MUST NOT 清掉新消息（旧实现会回到 2 条）。
  await page.waitForTimeout(900);
  await expect(messages).toHaveCount(3);
  await expect(messages.filter({ hasText: "NEW-TURN 新的一轮" })).toHaveCount(1);
});

// ── 实现评审 r1 P1：视图换代必须作废在途内容快照（新建同 vault 会话）────────────
//
// 现场：中途接管的「只内容档」回包在途时，用户新建同 vault 会话成功（空视图）。旧实现只在
// `fetchSnapshot` 发起时推进 `snapshotSeq`，相位世代又只在相位真的变化时推进——终态后复位是
// idle → idle，两道守卫都放行，于是旧回包清掉新会话的空渲染面、把**旧会话**的消息重放进去。
// 修复后 `resetView`（视图换代）统一推进 `snapshotSeq`，在途回包整条丢弃。
test("视图换代作废在途快照：新建会话后旧内容回包不得回填", async ({ page }) => {
  const history = [
    { role: "user", text: "OLD-1 旧会话提问" },
    { role: "assistant", text: "OLD-2 旧会话回答" },
  ];
  await stubTauri(page, VAULT);
  await stubHarnessActivity(page, {
    messages: history,
    inFlight: true, // 进入快照报在途 ⇒ 终态时发起只内容档对账
    stateDelayFromCall: { fromCall: 2, ms: 700 },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="activity-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const messages = page.locator(".lumir-hp-msg");
  await expect(messages).toHaveCount(2);

  // 终态 ⇒ 只内容档回包发出（被延迟 700ms）。
  await fire(page, { type: "done" });
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");

  // 回包在途时新建会话（同 vault）：视图换代。
  await page.locator(".lumir-hp-seg-new").click();
  await expect(messages).toHaveCount(0);

  // 等旧回包落地：MUST NOT 回填旧会话内容（旧实现会回到 2 条）。
  await page.waitForTimeout(900);
  await expect(messages).toHaveCount(0);
  await expect(page.locator(".lumir-hp-transcript")).not.toContainText("OLD-1 旧会话提问");
});
