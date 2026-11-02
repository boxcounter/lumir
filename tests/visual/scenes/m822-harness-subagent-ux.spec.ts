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
async function stubHarness(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [] as number[];
    w.__live = [] as unknown[];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          auto_wake: { chain: 0, max: 3, blocked: null },
          subrun_usage: null,
          live_subruns: w.__live,
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "harness_subagent_stop") return true;
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      return origInvoke(cmd, args);
    };
    w.__setLive = (live: unknown[]) => {
      w.__live = live;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  });
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
