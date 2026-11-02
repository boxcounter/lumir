import { expect, test, type Page } from "@playwright/test";
import { setBackendVault, stubTauri, type VaultFixture } from "./tauri-stub";

// M822（change rework-harness-delegation-ux-nov02）的跨 vault 判别性断言：旧实现对「切走再切回」
// 有两处相反的错误——
//
//   1. **僵尸行**：`clearTranscriptSurface()` 只清 `runRowEls` 不删 `taskList` 子节点，
//      切走后行 DOM 还在；下一次快照带回 `subrun_usage` 时整块重新可见 → 冻结的「运行中 + 停止」
//      行（M819 真机截图现场）。本场景先断言切走后 DOM 行数为 0（旧实现 = 1 ⇒ 红）。
//   2. **反向缺口**：切回时仍在跑的 run 没有行、也没有停止——快照没有 live run 列表可重建
//      （旧实现 = 0 行 ⇒ 红；新实现按 `live_subruns` 重建）。
//
// 最后一段判「切走期间收尾」：切回时 `live_subruns` 为空、`subrun_usage` 非空 ⇒ 控制区必须
// 整块不出现（旧实现会把僵尸行连同用量块一起画出来）。

const A_ROOT = "/tmp/lumir-m822-subagent-vault";
const B_ROOT = "/tmp/lumir-m822-subagent-vault-b";

const REGISTRY = [
  { id: "vault-a", path: A_ROOT, name: "subagent-vault", available: true, last_opened_at: 1757000002000, tab_count: 0 },
  { id: "vault-b", path: B_ROOT, name: "subagent-vault-b", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];

const DOC_A = "# 委派跨 vault\n\nA 的第一段。\n";

const VAULT_A_BASE: VaultFixture & { root: string } = {
  root: A_ROOT,
  vault_id: "vault-a",
  entries: [{ path: "a-note.md", kind: "file", size: DOC_A.length, mtime_ms: 0 }],
  files: { "a-note.md": DOC_A },
  vaults: REGISTRY,
};

const VAULT_B_BASE: VaultFixture & { root: string } = {
  root: B_ROOT,
  vault_id: "vault-b",
  entries: [{ path: "b-note.md", kind: "file", size: 12, mtime_ms: 0 }],
  files: { "b-note.md": "# B 笔记\n\nB 段。\n" },
  vaults: REGISTRY,
};

const VAULT_A_FIXTURE: VaultFixture & { root: string } = {
  ...VAULT_A_BASE,
  switchTo: { ...VAULT_B_BASE },
};
VAULT_A_FIXTURE.switchTo!.switchTo = { ...VAULT_A_BASE };

/** 按当前 vault 根应答快照：`live` 可在场景中途改写（模拟「切走期间收尾 / 仍在跑」）。 */
async function stubPerVaultState(
  page: Page,
  config: Record<string, { live: unknown[]; usage: unknown; runs?: unknown[]; messages?: unknown[] }>,
): Promise<void> {
  await page.addInitScript((state: typeof config) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__root = Object.keys(state)[0];
    w.__liveByRoot = state;
    w.__harnessEventHandlerIds = [] as number[];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        const entry = w.__liveByRoot[w.__root] ?? { live: [], usage: null };
        return JSON.stringify({
          vault: w.__root,
          messages: entry.messages ?? [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          in_flight: entry.live.length > 0,
          pending_approvals: [],
          auto_wake: { chain: 0, max: 5, blocked: null },
          subrun_usage: entry.usage,
          live_subruns: entry.live,
          subrun_runs: entry.runs ?? [],
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "harness_subagent_stop") return true;
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if ((cmd === "vault_open" || cmd === "vault_open_path") && result?.root) w.__root = result.root;
      return result;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
    w.__setVaultLive = (root: string, live: unknown[], usage: unknown, runs?: unknown[]) => {
      w.__liveByRoot[root] = { ...w.__liveByRoot[root], live, usage, runs };
    };
  }, config);
}

async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) => (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

async function setVaultLive(
  page: Page,
  root: string,
  live: unknown[],
  usage: unknown,
  runs?: unknown[],
): Promise<void> {
  await page.evaluate(
    (args) =>
      (
        window as unknown as {
          __setVaultLive: (root: string, live: unknown[], usage: unknown, runs?: unknown[]) => void;
        }
      ).__setVaultLive(args.root, args.live, args.usage, args.runs),
    { root, live, usage, runs },
  );
}

/** 后台 `task` 调用的工具记录（启动信封：`status: running`；结果随后由通知承担）。 */
const TASK_RECORD = {
  role: "tool",
  name: "task",
  summary: '{"agent":"research","description":"切回仍在跑"}',
  text: JSON.stringify({
    ok: true,
    status: "running",
    agent: "research",
    run_id: "r2",
    segment: 1,
    background: true,
    model: "mock-fast",
  }),
  ts: 1759912345,
};

/** 该 run 的逐 run 终态汇总（切走期间以 failed 收尾）。 */
const RUN_R2_FAILED = [
  {
    run_id: "r2",
    agent: "research",
    description: "切回仍在跑",
    model: "mock-fast",
    background: true,
    status: "failed",
    stopped_by: null,
    rounds: 4,
    segments: 1,
    input_tokens: 41000,
    cached_tokens: 12000,
    output_tokens: 800,
    duration_ms: 25000,
    tool_calls: 9,
  },
];

const LIVE_R2 = [
  {
    run_id: "r2",
    agent: "research",
    description: "切回仍在跑",
    model: "mock-fast",
    background: true,
    segment: 1,
    rounds: 4,
    tool_calls: 9,
    last_tool: "vault_read",
    elapsed_ms: 21_000,
  },
];

const USAGE = {
  "mock-fast": { input: 1200, cached: 0, writes: 0, output: 340, samples: 2, segments: 2 },
};

/** 切 vault：行名取注册表里的 `name`（浮层显示它），页脚显示 vault 根目录的 basename。 */
async function switchVault(page: Page, rowName: string, displayName: string): Promise<void> {
  await page.locator(".ft-vault").click();
  // 按行名精确定位（行序由 last_opened_at / 注册表给定，不写死索引——第二次往返时索引曾指错）。
  const row = page.locator(".vault-row").filter({
    has: page.locator(".vault-row-name", { hasText: new RegExp(`^${rowName}$`) }),
  });
  // 浮层是异步揭示的（内容确认非空才显示，O5）：先等行真的可见，再点。
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.locator(".ft-vault-name")).toHaveText(displayName, { timeout: 15_000 });
}

test("切走清 DOM、切回按 live 快照重建；切走期间收尾不复活", async ({ page }) => {
  await stubTauri(page, VAULT_A_FIXTURE);
  await stubPerVaultState(page, {
    [A_ROOT]: { live: [], usage: null, runs: [], messages: [TASK_RECORD] },
    [B_ROOT]: { live: [], usage: null, runs: [], messages: [] },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // A 里起一个后台 run（控制区出现一行）。
  await fire(page, {
    type: "subagent_started",
    run_id: "r1",
    agent: "research",
    description: "跨 vault 运行",
    model: "mock-fast",
    background: true,
  });
  await expect(page.locator(".lumir-tp-run")).toHaveCount(1);

  // 切到 B：行 DOM 必须一并清掉（旧实现只清 map，节点留在 DOM 里 = 僵尸）。
  await switchVault(page, "subagent-vault-b", "lumir-m822-subagent-vault-b");
  await expect(page.locator(".lumir-tp-run")).toHaveCount(0);
  await expect(page.locator(".lumir-tp")).toBeHidden();

  // 切回 A，且 A 仍有一个在跑的 run：按 `live_subruns` 重建行与停止能力（旧实现 = 0 行）。
  await setVaultLive(page, A_ROOT, LIVE_R2, USAGE);
  await switchVault(page, "subagent-vault", "lumir-m822-subagent-vault");
  // 桩的 vault 切换是「一跳链」：A 的副本只带 A→B，回到 A 后就没有下一跳目标了。第三跳前把
  // 后端 fixture 重置成一份新的 A→B→A 链（无回指，避免 init script 序列化出环）。
  await setBackendVault(page, {
    ...VAULT_A_BASE,
    switchTo: { ...VAULT_B_BASE, switchTo: { ...VAULT_A_BASE } },
  });
  // 切 vault 会收起面板（B 的会话不带 harness pane）：重新打开后再判行重建。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 旧会话的行节点 MUST 已被清走（M819 僵尸行的判别性断言：先于可见性判据，僵尸在旧实现里
  // 就停在这一行——重开面板后它仍然在 DOM 里）。
  await expect(page.locator('.lumir-tp-run[data-run="r1"]')).toHaveCount(0);
  await expect(page.locator(".lumir-tp")).toBeVisible();
  await expect(page.locator(".lumir-tp-run")).toHaveCount(1);
  await expect(page.locator('.lumir-tp-run[data-run="r2"]')).toContainText("切回仍在跑");
  await expect(page.locator('.lumir-tp-run[data-run="r2"]')).toContainText("21s");
  // 停止在行的展开区里（控制区沿用「点击行头展开」）：展开后可见、读屏名可区分。
  await page.locator('.lumir-tp-run[data-run="r2"] .lumir-tp-row').click();
  await expect(
    page.locator('.lumir-tp-run[data-run="r2"]').getByRole("button", { name: "停止该任务" }),
  ).toBeVisible();

  // 切走期间它收尾了：切回时 live 为空、用量桶非空 ⇒ 控制区整块不出现（无僵尸行可画）。
  await setVaultLive(page, A_ROOT, [], USAGE, RUN_R2_FAILED);
  await switchVault(page, "subagent-vault-b", "lumir-m822-subagent-vault-b");
  await expect(page.locator(".lumir-tp-run")).toHaveCount(0);
  await switchVault(page, "subagent-vault", "lumir-m822-subagent-vault");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 切走期间收尾的后台失败必须保留到用户确认（评审 P1-5）：控制区一行、可「知道了」。
  await expect(page.locator(".lumir-tp")).toBeVisible();
  await expect(page.locator('.lumir-tp-run[data-run="r2"]')).toContainText("失败");
  const dismiss = page.locator('.lumir-tp-run[data-run="r2"]').getByRole("button", { name: "知道了" });
  await expect(dismiss).toBeVisible();
  // 恢复出的 `task` 行按逐 run 汇总对账成终态：不得停在启动信封的「运行中」。
  const taskRow = page.locator(".lumir-hp-taskwrap").first();
  await expect(taskRow).toContainText("失败");
  await expect(taskRow).toContainText("25s");
  await expect(taskRow).not.toContainText("运行中");
  // 确认后该行不再出现，控制区随之消失（同一 run 不再要求确认）。
  await dismiss.click();
  await expect(page.locator(".lumir-tp-run")).toHaveCount(0);
  await expect(page.locator(".lumir-tp")).toBeHidden();
});
