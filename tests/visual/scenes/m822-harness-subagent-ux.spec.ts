import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M822（change rework-harness-delegation-ux-nov02）的可见面结构断言：一个相位一个家。
//
//   - 单个前台 run：控制区不出现，运行态由 transcript 的 `task` 行承载（状态词 / 用时 / 停止）；
//   - ≥2 并行：控制区出现两行；
//   - 全部完成：控制区整块消失（无「本次会话完成数」汇总）；
//   - 后台失败：保留一行到点「知道了」；
//   - 多行：控制区列表自身滚动（不挤压 composer）。
//
// 事件经 `__fireHarnessEvent` 注入（与 m756 同一注入口）：`harness_state` 桩的 `live_subruns`
// 恒为空，验证的是「事件驱动」这条路径；快照重建路径归 m822-harness-subagent-vault-switch。

const DOC = "# 委派可见面\n\n第一段。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** harness 事件注入口 + 快照桩（live_subruns 为空：本场景只走事件路径）。 */
interface StubState {
  messages?: unknown[];
  live?: unknown[];
  runs?: unknown[];
  usage?: unknown;
}

async function stubHarness(page: Page, initial: StubState = {}): Promise<void> {
  await page.addInitScript((seed: StubState) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [] as number[];
    w.__live = seed.live ?? [];
    w.__runs = seed.runs ?? [];
    w.__stops = [] as string[];
    w.__sent = false;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        w.__sent = true;
        return null;
      }
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: seed.messages ?? [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          auto_wake: { chain: 0, max: 3, blocked: null },
          in_flight: w.__sent,
          subrun_usage: seed.usage ?? null,
          live_subruns: w.__live,
          subrun_runs: w.__runs,
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "harness_subagent_stop") {
        w.__stops.push(String(args.run_id));
        return true;
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      return origInvoke(cmd, args);
    };
    w.__setLive = (live: unknown[]) => {
      w.__live = live;
    };
    w.__stopsOf = () => w.__stops as string[];
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, initial);
}

async function setLive(page: Page, live: Record<string, unknown>[]): Promise<void> {
  await page.evaluate(
    (rows) => (window as unknown as { __setLive: (live: unknown[]) => void }).__setLive(rows),
    live,
  );
}

async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) => (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

async function openPane(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

/** 打开轮次闸门：`tool_call` 事件属于被闸门管控的事件（未发送时一律丢弃），
 *  直接 fire 会被静默吞掉——测试 tool_call 路径必须先真实发送一条消息。 */
async function startTurn(page: Page): Promise<void> {
  await page.locator(".lumir-hp-composer").fill("测试提问");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
}

function started(runId: string, description: string, background = false): Record<string, unknown> {
  return {
    type: "subagent_started",
    run_id: runId,
    agent: "research",
    description,
    model: "mock-fast",
    background,
  };
}

/** 快照里的一行 live run（`harness_state.live_subruns` 的形状）。 */
function liveRow(runId: string, description: string, background = true): Record<string, unknown> {
  return {
    run_id: runId,
    agent: "research",
    description,
    model: "mock-fast",
    background,
    segment: 1,
    rounds: 1,
    tool_calls: 1,
    last_tool: "vault_read",
    elapsed_ms: 3_000,
  };
}

function finished(runId: string, status: string): Record<string, unknown> {
  return {
    type: "subagent_finished",
    run_id: runId,
    agent: "research",
    status,
    stopped_by: status === "partial" ? "tokens" : undefined,
    rounds: 3,
    model: "mock-fast",
    input_tokens: 82_000,
    cached_tokens: 60_000,
    output_tokens: 2_400,
    denied_calls: 0,
    duration_ms: 72_000,
    summary_chars: 6,
    summary: "结论一行",
  };
}

test("单个前台 run 只在对话流：控制区不出现，运行行带停止与用时", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPane(page);

  await fire(page, started("r1", "梳理变更"));
  await fire(page, {
    type: "subagent_progress",
    run_id: "r1",
    rounds: 2,
    tool_calls: 5,
    last_tool: "vault_read",
    elapsed_ms: 12_000,
  });

  // 控制区不出现（单个前台 run 不需要合并视图）。
  await expect(page.locator(".lumir-tp")).toBeHidden();
  // 运行态主载体是 transcript 的 task 行：状态词、description、用时、停止都在。
  const row = page.locator(".lumir-hp-taskwrap").first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("运行中");
  await expect(row).toContainText("梳理变更");
  await expect(row).toContainText("12s");
  await expect(row.locator(".lumir-hp-task-stop")).toBeVisible();

  // 完成 ⇒ 同一行翻终态（不另起一行、不出完成汇总）。
  await fire(page, finished("r1", "completed"));
  await expect(row).toContainText("已完成");
  await expect(row).toContainText("1m12s");
  await expect(row.locator(".lumir-hp-task-stop")).toHaveCount(0);
  await expect(page.locator(".lumir-tp")).toBeHidden();
  await expect(page.locator(".lumir-hp-taskwrap")).toHaveCount(1);
});

test("≥2 并行 run 出现控制区；全部完成后整块消失", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPane(page);

  await fire(page, started("r1", "梳理变更", true));
  await fire(page, started("r2", "复核结论"));
  await expect(page.locator(".lumir-tp")).toBeVisible();
  await expect(page.locator(".lumir-tp-run")).toHaveCount(2);
  await expect(page.locator(".lumir-tp-title")).toHaveText("任务 1 个运行中 · 1 个后台运行中");

  // 后台行收尾后只剩一个前台 run：不需要合并视图，控制区随之消失（M822 C6）。
  // 收尾会触发一次快照对账：桩的 live 列表必须反映「还有一个在跑」（真后端如此）。
  await setLive(page, [liveRow("r2", "复核结论", false)]);
  await fire(page, finished("r1", "completed"));
  await expect(page.locator(".lumir-tp")).toBeHidden();
  await setLive(page, []);
  await fire(page, finished("r2", "partial"));
  // 前台 partial 不占控制区（用户就在对话流里）；终态原因进 task 行。
  await expect(page.locator(".lumir-tp")).toBeHidden();
  const partialRow = page.locator(".lumir-hp-taskwrap", { hasText: "复核结论" });
  await expect(partialRow).toContainText("部分结果");
  await expect(partialRow).toContainText("token 预算");
});

test("恢复出的运行中 task 行：单前台不进控制区，但行内有 Stop 与 live 用时", async ({ page }) => {
  const envelope = JSON.stringify({
    ok: true,
    status: "running",
    agent: "research",
    run_id: "r-live",
    segment: 1,
    background: false,
    model: "mock-fast",
  });
  await stubTauri(page, VAULT);
  await stubHarness(page, {
    messages: [
      { role: "tool", name: "task", summary: '{"agent":"research","description":"切回仍在跑"}', text: envelope, ts: 1759912345 },
    ],
    live: [
      {
        run_id: "r-live",
        agent: "research",
        description: "切回仍在跑",
        model: "mock-fast",
        background: false,
        segment: 1,
        rounds: 2,
        tool_calls: 4,
        last_tool: "vault_read",
        elapsed_ms: 9_000,
      },
    ],
  });
  await openPane(page);

  // 单前台 run：控制区不出现；运行态的入口必须落在对话流里的同一行。
  await expect(page.locator(".lumir-tp")).toBeHidden();
  const row = page.locator(".lumir-hp-taskwrap").first();
  await expect(row).toContainText("运行中");
  await expect(row).toContainText("9s");
  await expect(row.locator(".lumir-hp-task-stop")).toBeVisible();
  await row.locator(".lumir-hp-task-stop").click();
  expect(await page.evaluate(() => (window as any).__stopsOf())).toEqual(["r-live"]);
});

test("resume 段的真实事件序（tool_call started → subagent_started）只留一个任务身份", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPane(page);
  await startTurn(page);

  const args = '{"agent":"research","description":"两段任务"}';
  const tel = (status: string, summary?: string): Record<string, unknown> => ({
    type: "tool_call",
    name: "task",
    status,
    summary: summary ?? args,
  });
  // 段一：调用行 → 启动 → 触顶 → 收尾（已绑定行由 run 事件驱动，done 不再建行）。
  await fire(page, tel("started"));
  await fire(page, started("r1", "两段任务"));
  await fire(page, finished("r1", "partial"));
  await fire(page, tel("done"));
  // 段二：resume 调用又建了一条未绑定行，随后 subagent_started 必须收走它。
  await fire(page, tel("started"));
  await fire(page, { ...started("r1", "两段任务") });
  await fire(page, tel("done"));

  await expect(page.locator(".lumir-hp-taskwrap")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-tool-row.is-task")).toHaveCount(1);
  const row = page.locator(".lumir-hp-taskwrap").first();
  await expect(row).toContainText("运行中");
});

test("并行交错：r1 progress 不得删 r2 的未绑定行；r2 被闸拒的失败结果保留且不重排", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPane(page);
  await startTurn(page);

  const args = (agent: string, description: string): string =>
    `{"agent":"${agent}","description":"${description}"}`;
  // r1：调用行 → 启动（绑定）。
  await fire(page, { type: "tool_call", name: "task", status: "started", summary: args("research", "甲任务") });
  await fire(page, started("r1", "甲任务"));
  // r2：只到调用行（尚未 started，随后会被并发闸拒绝）。
  await fire(page, { type: "tool_call", name: "task", status: "started", summary: args("beta", "乙任务") });
  // r1 的 progress 走 refreshTaskRow——MUST NOT 把 r2 的未绑定行当 resume 重复行删掉。
  await fire(page, {
    type: "subagent_progress",
    run_id: "r1",
    rounds: 2,
    tool_calls: 3,
    last_tool: "vault_read",
    elapsed_ms: 4_000,
  });
  await expect(page.locator(".lumir-hp-taskwrap")).toHaveCount(2);
  // r2 没有 subagent_started：调用结果（被闸拒）必须作为第二行留下，且顺序不变。
  await fire(page, { type: "tool_call", name: "task", status: "done", summary: "concurrency_limit（并发上限）" });
  const rows = page.locator(".lumir-hp-taskwrap");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("甲任务");
  await expect(rows.nth(1)).toContainText("乙任务");
  await expect(rows.nth(1)).toContainText("concurrency_limit");
});

test("同 agent 的 r1/r2/r3 交错：call_id 精确绑定，三行顺序与结果归属正确", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPane(page);
  await startTurn(page);

  const call = (callId: string, description: string): Record<string, unknown> => ({
    type: "tool_call",
    name: "task",
    status: "started",
    summary: JSON.stringify({ agent: "research", description }),
    call_id: callId,
  });
  // r1 成功启动（c1）；r2 只有调用行（c2，随后被并发闸拒绝）；r3 成功启动（c3）且 started 先于 r2 done。
  const done = (callId: string, summary: string): Record<string, unknown> => ({
    type: "tool_call",
    name: "task",
    status: "done",
    summary,
    call_id: callId,
  });
  await fire(page, call("call-r1", "甲任务"));
  await fire(page, { ...started("r1", "甲任务"), call_id: "call-r1" });
  await fire(page, call("call-r2", "乙任务"));
  await fire(page, call("call-r3", "丙任务"));
  await fire(page, { ...started("r3", "丙任务"), call_id: "call-r3" });
  // 桩的快照在发送后会重取；让它认得仍在跑的两条 run，避免快照把视图清成「无在跑」。
  await setLive(page, [liveRow("r1", "甲任务", false), liveRow("r3", "丙任务", false)]);
  await fire(page, {
    type: "subagent_progress",
    run_id: "r3",
    rounds: 1,
    tool_calls: 2,
    last_tool: "vault_read",
    elapsed_ms: 2_000,
  });
  // 生产顺序：全部启动后按调用序逐个收尾（r1 → r2 → r3）。r1/r3 的 done 是已绑定行的
  // no-op；r2 的 done 才是它自己的拒绝结果。带 call_id 的 done MUST NOT 回退 FIFO。
  await fire(page, finished("r1", "completed"));
  await fire(page, done("call-r1", "ok"));
  await fire(page, done("call-r2", "concurrency_limit（并发上限）"));
  await fire(page, finished("r3", "completed"));
  // 中间判据：finished 必须先让 r3 行翻终态（done(c3) 已绑定行 no-op，不得改回运行中）。
  await expect(page.locator(".lumir-hp-taskwrap").nth(2)).toContainText("已完成");
  await fire(page, done("call-r3", "ok"));

  const rows = page.locator(".lumir-hp-taskwrap");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("甲任务");
  await expect(rows.nth(0)).toContainText("已完成");
  await expect(rows.nth(1)).toContainText("乙任务");
  await expect(rows.nth(1)).toContainText("concurrency_limit");
  await expect(rows.nth(1)).not.toContainText("运行中");
  await expect(rows.nth(2)).toContainText("丙任务");
  await expect(rows.nth(2)).toContainText("已完成");
  await expect(rows.nth(2)).not.toContainText("concurrency_limit");
});

test("恢复同一 run 的两段：只有一个身份，段数/累计/最近段终态与用量", async ({ page }) => {
  const envelope = (
    segment: number,
    status: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    role: "tool",
    name: "task",
    summary: '{"agent":"research","description":"两段恢复"}',
    text: JSON.stringify({
      ok: true,
      status,
      agent: "research",
      run_id: "r-restore",
      segment,
      call_id: `call-${segment}`,
      background: false,
      model: "mock-fast",
      rounds: segment === 1 ? 5 : 3,
      stopped_by: segment === 1 ? "tokens" : undefined,
      duration_ms: segment === 1 ? 90_000 : 40_000,
      tool_calls: segment === 1 ? { vault_read: 7 } : { vault_read: 1 },
      usage: {
        input_tokens: segment === 1 ? 80_000 : 20_000,
        cached_tokens: segment === 1 ? 60_000 : 10_000,
        output_tokens: segment === 1 ? 2_000 : 1_000,
      },
      summary: segment === 1 ? "第一段摘要" : "第二段摘要",
      ...extra,
    }),
    ts: 1759912345,
  });
  await stubTauri(page, VAULT);
  await stubHarness(page, {
    messages: [envelope(1, "partial"), envelope(2, "completed")],
    runs: [
      {
        run_id: "r-restore",
        agent: "research",
        description: "两段恢复",
        model: "mock-fast",
        background: false,
        status: "completed",
        rounds: 8,
        segments: 2,
        input_tokens: 100_000,
        cached_tokens: 70_000,
        output_tokens: 3_000,
        duration_ms: 130_000,
        tool_calls: 8,
      },
    ],
  });
  await openPane(page);

  await expect(page.locator(".lumir-hp-taskwrap")).toHaveCount(1);
  const row = page.locator(".lumir-hp-taskwrap").first();
  await expect(row).toContainText("已完成");
  await expect(row).toContainText("2m10s");
  await row.click();
  await expect(row).toContainText("2 段");
  await expect(row).toContainText("8 步");
  await expect(row).toContainText("用量：输入 100k（缓存 70k）· 输出 3k");
  await expect(row).toContainText("第二段摘要");
});

test("恢复的最近段仍在 live 快照：同一恢复身份刷新为运行形态", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page, {
    messages: [
      {
        role: "tool",
        name: "task",
        summary: '{"agent":"research","description":"续跑中"}',
        text: JSON.stringify({
          ok: true,
          status: "partial",
          agent: "research",
          run_id: "r-live-resume",
          segment: 1,
          call_id: "call-1",
          model: "mock-fast",
          rounds: 4,
          stopped_by: "tokens",
          duration_ms: 50_000,
          tool_calls: { vault_read: 5 },
          usage: { input_tokens: 10_000, cached_tokens: 4_000, output_tokens: 500 },
        }),
        ts: 1759912345,
      },
    ],
    runs: [
      {
        run_id: "r-live-resume",
        agent: "research",
        description: "续跑中",
        model: "mock-fast",
        background: false,
        status: "partial",
        rounds: 4,
        segments: 1,
        input_tokens: 10_000,
        cached_tokens: 4_000,
        output_tokens: 500,
        duration_ms: 50_000,
        tool_calls: 5,
      },
    ],
    live: [
      {
        run_id: "r-live-resume",
        agent: "research",
        description: "续跑中",
        model: "mock-fast",
        background: false,
        segment: 2,
        rounds: 2,
        tool_calls: 3,
        last_tool: "vault_read",
        elapsed_ms: 7_000,
      },
    ],
  });
  await openPane(page);

  await expect(page.locator(".lumir-tp")).toBeHidden();
  await expect(page.locator(".lumir-hp-taskwrap")).toHaveCount(1);
  const row = page.locator(".lumir-hp-taskwrap").first();
  await expect(row).toContainText("运行中");
  await expect(row).toContainText("7s");
  await expect(row.locator(".lumir-hp-task-stop")).toBeVisible();
  // 点文本区展开（行中心可能落在行内「停止」钮上）。
  await row.locator(".lumir-hp-tool-text").click();
  await expect(row).toContainText("8 步");
  await expect(row).toContainText("2 段");
});

test("后台异常 → 知道了 → 完整重载后不再要求确认（持久化）", async ({ page }) => {
  const failed = [
    {
      run_id: "r-ack",
      agent: "research",
      description: "失败待确认",
      model: "mock-fast",
      background: true,
      status: "failed",
      rounds: 2,
      segments: 1,
      input_tokens: 100,
      cached_tokens: 0,
      output_tokens: 10,
      duration_ms: 900,
      tool_calls: 2,
    },
  ];
  await stubTauri(page, VAULT);
  await stubHarness(page, { runs: failed });
  await openPane(page);
  await expect(page.locator(".lumir-tp-run")).toHaveCount(1);
  await page.locator(".lumir-tp-run").getByRole("button", { name: "知道了" }).click();
  await expect(page.locator(".lumir-tp")).toBeHidden();

  // 完整重载：快照仍带同一条后台异常，但确认事实已持久化，不得再次要求确认。
  await page.reload();
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-tp")).toBeHidden();
  await expect(page.locator(".lumir-tp-run")).toHaveCount(0);
});

test("四态恢复行：completed / partial / failed / aborted 的状态词、图标与用量同形", async ({ page }) => {
  const record = (
    status: string,
    runId: string,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    role: "tool",
    name: "task",
    summary: `{"agent":"research","description":"${status} 任务"}`,
    text: JSON.stringify({
      ok: status === "completed",
      status,
      agent: "research",
      run_id: runId,
      segment: 1,
      background: false,
      model: "mock-fast",
      duration_ms: 12_000,
      rounds: 2,
      tool_calls: { vault_read: 3 },
      usage: { input_tokens: 1000, cached_tokens: 400, output_tokens: 50 },
      code: status === "failed" ? "server_error" : status === "aborted" ? "turn_aborted" : undefined,
      message: status === "failed" ? "boom" : status === "aborted" ? "子运行已停止" : undefined,
      ...extra,
    }),
    ts: 1759912345,
  });
  await stubTauri(page, VAULT);
  await stubHarness(page, {
    messages: [
      record("completed", "r-done"),
      record("partial", "r-partial"),
      record("failed", "r-failed"),
      record("aborted", "r-stopped"),
    ],
  });
  await openPane(page);

  // 四行终态在同一工具块里，恢复时按 ≥2 行折叠；先展开。
  await page.locator(".lumir-hp-tool-summary").click();
  const rows = page.locator(".lumir-hp-taskwrap");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("已完成");
  await expect(rows.nth(1)).toContainText("部分结果");
  await expect(rows.nth(2)).toContainText("失败");
  await expect(rows.nth(3)).toContainText("已停止");
  await expect(rows.nth(0).locator(".lumir-hp-tool-row")).toHaveClass(/is-done/);
  await expect(rows.nth(1).locator(".lumir-hp-tool-row")).toHaveClass(/is-waiting/);
  await expect(rows.nth(2).locator(".lumir-hp-tool-row")).toHaveClass(/is-fail/);
  await expect(rows.nth(3).locator(".lumir-hp-tool-row")).toHaveClass(/is-fail/);
  // 用量详情四态同形（failed / aborted 也有 per-run 读数）。
  await rows.nth(2).click();
  await expect(rows.nth(2)).toContainText("用量：输入 1k（缓存 400）· 输出 50");
  await rows.nth(3).click();
  await expect(rows.nth(3)).toContainText("用量：输入 1k（缓存 400）· 输出 50");
});

test("后台失败保留到「知道了」；多行时列表自身滚动", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPane(page);

  await fire(page, started("r1", "后台甲", true));
  await fire(page, started("r2", "后台乙", true));
  await fire(page, started("r3", "后台丙", true));
  await expect(page.locator(".lumir-tp-run")).toHaveCount(3);
  const list = page.locator(".lumir-tp-list");
  await expect(list).toHaveCSS("overflow-y", "auto");
  const maxHeight = await list.evaluate((el) => getComputedStyle(el).maxHeight);
  expect(maxHeight, "列表必须有最大高度（不挤压 composer）").not.toBe("none");

  await setLive(page, [liveRow("r2", "后台乙"), liveRow("r3", "后台丙")]);
  await fire(page, finished("r1", "failed"));
  // 失败的后台行保留（标题点名待查看），其它两行仍在跑。
  await expect(page.locator(".lumir-tp-run")).toHaveCount(3);
  await expect(page.locator(".lumir-tp-title")).toContainText("1 个需要你查看");
  const failedRow = page.locator('.lumir-tp-run[data-run="r1"]');
  await expect(failedRow).toContainText("失败");
  const dismiss = failedRow.getByRole("button", { name: "知道了" });
  await expect(dismiss).toBeVisible();
  await dismiss.click();
  await expect(page.locator('.lumir-tp-run[data-run="r1"]')).toHaveCount(0);
  await expect(page.locator(".lumir-tp-run")).toHaveCount(2);
});
