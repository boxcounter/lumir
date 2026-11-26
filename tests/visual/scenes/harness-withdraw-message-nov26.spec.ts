import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 撤回最近一条用户消息（change add-harness-message-withdraw-nov26）的**真面板**路径：
// 面板拿到 `harness_withdraw` 的真实回执形状后怎么渲染——transcript 是否真的移除、原文是否
// 真的回到 composer、工具二次确认是否只发一次命令、拒绝是否如实上错误行。
//
// 与 Rust 侧分工：A 的物理删除、seed 落盘、派生检测、失败回滚都在 `harness/withdraw_tests.rs`
// 判（chromium 读不到后端文件系统）；这里判**面板行为**（DOM + 真实 IPC 交互）。真机 882 再
// 把两端接到真 WKWebView 上。
//
// 判据不写截图（无像素基线）：结构断言在 `LUMIR_VISUAL_STRUCTURAL=1` 下照跑。

const ROOT = "/tmp/lumir-withdraw-panel";
const VAULT_ID = "withdraw-panel";
const DOC = "# 撤回面板\n\n第一段给面板一点内容。\n";
const VAULT: VaultFixture = {
  entries: [{ path: "withdraw-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "withdraw-note.md": DOC },
  links: {},
  root: ROOT,
  vault_id: VAULT_ID,
};

const MARKER = "WITHDRAW-882";
const MESSAGES = [
  { role: "user", text: MARKER },
  { role: "assistant", text: "收到，这是答复。" },
];

type Mode = "direct" | "confirm" | "refuse";

async function setup(
  page: Page,
  mode: Mode,
  opts: {
    messages?: ReadonlyArray<Record<string, unknown>>;
    kept?: ReadonlyArray<Record<string, unknown>>;
    /** `harness_withdraw` 挂起，直到页面调用 `__resolveWithdraw()`（构造「B 的事件先于回执」）。 */
    deferWithdraw?: boolean;
    /** 回执落地后 `harness_state` 带回的 persistence 读数（撤回后 B 的完整快照 = 地板）。 */
    afterWithdrawPersistence?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const messages = opts.messages ?? MESSAGES;
  const kept = opts.kept ?? [];
  const deferWithdraw = opts.deferWithdraw ?? false;
  const afterWithdrawPersistence = opts.afterWithdrawPersistence ?? null;
  await stubTauri(page, VAULT);
  await page.addInitScript(
    ({ mode, messages, kept, marker, deferWithdraw, afterWithdrawPersistence }) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const origInvoke = internals.invoke;
      w.__withdrawCalls = [] as Array<{ confirm: boolean }>;
      w.__harnessEventHandlerIds = [] as number[];
      w.__afterWithdraw = false;
      w.__resolveWithdraw = null as null | (() => void);
      const snapshot = {
        messages,
        usage: { ctx_pct: 0, cache_pct_session: 0 },
        pending_approval: null,
        warn_ctx_pct: 85,
        withdrawable: true,
        session_token: 11,
        in_flight: false,
      };
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_state") {
          // 撤回回执落地后身份换成 B（token 12）；带 persistence 选项时 B 的完整快照带读数。
          return JSON.stringify({
            ...snapshot,
            session_token: w.__afterWithdraw ? 12 : 11,
            ...(w.__afterWithdraw && afterWithdrawPersistence !== null
              ? { persistence: afterWithdrawPersistence }
              : {}),
          });
        }
        if (cmd === "harness_withdraw") {
          w.__withdrawCalls.push({ confirm: args.confirm === true });
          if (mode === "refuse") {
            throw {
              code: "harness_withdraw_derived_exists",
              message: "该会话还有派生出来的会话",
              params: { sessions: "s1700000000000-child01" },
            };
          }
          if (mode === "confirm" && args.confirm !== true) {
            return { needs_confirmation: true, tool_names: ["vault_patch", "cli_run"] };
          }
          const receipt = {
            needs_confirmation: false,
            tool_names: mode === "confirm" ? ["vault_patch", "cli_run"] : [],
            info: {
              session_id: "s1760000000000-bbbbbb",
              session_token: 12,
              messages: kept,
              withdrawn: { text: marker, skills: [] },
              first_user_text: null,
            },
          };
          if (deferWithdraw) {
            return new Promise((resolve: (value: unknown) => void) => {
              w.__resolveWithdraw = () => {
                w.__afterWithdraw = true;
                resolve(receipt);
              };
            });
          }
          w.__afterWithdraw = true;
          return receipt;
        }
        if (cmd === "harness_list_sessions") return [];
        if (cmd === "harness_skills_list") return [];
        if (cmd === "harness_draft_get") return null;
        if (cmd === "harness_draft_put") return null;
        if (cmd === "plugin:event|listen" && args.event === "harness:event") {
          w.__harnessEventHandlerIds.push(args.handler ?? 0);
        }
        return origInvoke(cmd, args);
      };
      w.__fireHarnessEvent = (payload: unknown) => {
        for (const id of w.__harnessEventHandlerIds) {
          internals.runCallback(id, { event: "harness:event", id, payload });
        }
      };
    },
    { mode, messages, kept, marker: MARKER, deferWithdraw, afterWithdrawPersistence },
  );
  await page.goto("/");
  await page.locator('.ft-row[title="withdraw-note.md"]').click();
  await expect(page.locator(".cm-content").first()).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 初始用户消息数按 fixture 算（默认 1 条；前缀用例 2 条）——写死 1 会把「撤回前有几问」也钉死。
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(
    messages.filter((message) => message.role === "user").length,
  );
}

const calls = (page: Page) =>
  page.evaluate(() => (window as unknown as { __withdrawCalls: Array<{ confirm: boolean }> }).__withdrawCalls);

test("撤回：transcript 移除该消息，原文回到 composer（只发一次 confirm=false）", async ({ page }) => {
  await setup(page, "direct");
  // 撤回钮 hover 才显形：先移到用户消息上（与真实交互一致），再点。
  await page.locator(".lumir-hp-msg-user").hover();
  await expect(page.locator(".lumir-hp-withdraw")).toBeVisible();
  await page.locator(".lumir-hp-withdraw").click();

  await expect.poll(() => calls(page)).toEqual([{ confirm: false }]);
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-composer .cm-content")).toContainText(MARKER);
  // 只有最后一条用户消息挂钮：回填后 transcript 里没有用户消息，钮随之消失。
  await expect(page.locator(".lumir-hp-withdraw")).toHaveCount(0);
});

test("撤回：本轮执行过工具时先出确认条（列出工具名），确认后才发 confirm=true", async ({ page }) => {
  await setup(page, "confirm");
  await page.locator(".lumir-hp-msg-user").hover();
  await page.locator(".lumir-hp-withdraw").click();

  const confirmRow = page.locator(".lumir-hp-withdraw-confirm");
  await expect(confirmRow).toBeVisible();
  await expect(confirmRow).toContainText("vault_patch");
  await expect(confirmRow).toContainText("cli_run");
  // 确认前只有预览那一次调用，消息还在。
  expect(await calls(page)).toEqual([{ confirm: false }]);
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);

  await page.locator(".lumir-hp-withdraw-yes").click();
  await expect.poll(() => calls(page)).toEqual([{ confirm: false }, { confirm: true }]);
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-composer .cm-content")).toContainText(MARKER);
});

test("撤回被拒（派生会话）：如实上错误行，消息与 composer 都不变", async ({ page }) => {
  await setup(page, "refuse");
  await page.locator(".lumir-hp-msg-user").hover();
  await page.locator(".lumir-hp-withdraw").click();

  await expect(page.locator(".lumir-hp-error")).toContainText("派生");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-composer .cm-content")).toHaveText("");
  await expect(page.locator(".lumir-hp-withdraw-confirm")).toHaveCount(0);
});

test("撤回：transcript 重建为 B 的前缀（不是只清空，也不是留着 A 的尾巴）", async ({ page }) => {
  // 真机 882 的教训：只在后端换会话、面板不做「清面 + 重放 B 的前缀」时，transcript 会留着
  // A 的尾巴。空前缀用例（上面那条）只证明「清空」，抓不到「漏重放」——这里用非空前缀：
  // 撤回前两问两答，撤回后必须只剩前缀的一问一答，被撤回的消息与它之后的答复都不在。
  const prefix: Array<Record<string, unknown>> = [
    { role: "user", text: "PREFIX-Q1" },
    { role: "assistant", text: "前缀答复一。" },
  ];
  await setup(page, "direct", {
    messages: [...prefix, { role: "user", text: MARKER }, { role: "assistant", text: "被撤回轮的答复。" }],
    kept: prefix,
  });
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(2);
  await page.locator(".lumir-hp-msg-user").last().hover();
  await expect(page.locator(".lumir-hp-withdraw")).toBeVisible();
  await page.locator(".lumir-hp-withdraw").click();

  await expect.poll(() => calls(page)).toEqual([{ confirm: false }]);
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-msg-user")).toContainText("PREFIX-Q1");
  await expect(page.locator(".lumir-hp-transcript")).not.toContainText(MARKER);
  await expect(page.locator(".lumir-hp-transcript")).not.toContainText("被撤回轮的答复。");
  await expect(page.locator(".lumir-hp-composer .cm-content")).toContainText(MARKER);
});

test("旧会话的迟到事件按会话令牌拒收；新令牌的同一批事件照常上屏", async ({ page }) => {
  await setup(page, "direct");
  await page.locator(".lumir-hp-msg-user").hover();
  await page.locator(".lumir-hp-withdraw").click();
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  const fire = (payload: Record<string, unknown>) =>
    page.evaluate((p) => (window as unknown as {
      __fireHarnessEvent: (payload: unknown) => void;
    }).__fireHarnessEvent(p), payload);
  const base = { vault: "/tmp/lumir-withdraw-panel" };
  const started = (runId: string, description: string) => ({
    ...base,
    type: "subagent_started",
    run_id: runId,
    segment: 1,
    agent: "research",
    description,
    model: "mock",
    background: true,
  });
  const notice = (runId: string, description: string) => ({
    ...base,
    type: "notice",
    runs: [{ run_id: runId, agent: "research", description, status: "done", summary: "结论" }],
  });

  // 旧令牌（撤回前的 A）：transcript / 任务区 / 标题都不得被它点亮。
  await fire({ ...started("r-old", "旧会话的 run"), session_token: 11 });
  await fire({ ...notice("r-old", "旧会话的通知"), session_token: 11 });
  await fire({ ...base, type: "title", title: "旧标题", session_token: 11 });
  await expect(page.locator(".lumir-tp-run")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-notice")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-sname")).not.toHaveText("旧标题");

  // 新令牌（B）：同一批事件照常上屏——证明准入是「按身份」而不是一刀切丢弃。
  await fire({ ...started("r-new", "新会话的 run"), session_token: 12 });
  await fire({ ...notice("r-new", "新会话的通知"), session_token: 12 });
  await fire({ ...base, type: "title", title: "新标题", session_token: 12 });
  await expect(page.locator(".lumir-tp-run")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-notice")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新标题");
});

// 撤回先把旧会话 A 换成 B，B 的写失败事件可能先于 `harness_withdraw` 的回执送达面板（与
// persistence-health-nov23 的 V6 同一时序类）。回执落地时只允许退役**发起时**捕获的 A
// （token 11）：若按落地时的水位退役，会把 B 自己的 12 记入退役集，B 的完整快照随后被拒收，
// 警示块在回执后永久消失。反向验证：把 `applyWithdraw` 改回 `retire(actionVault)`，最后两条
// 断言转红（本用例先于修复编写，红/绿都实测过）。
test("撤回回执前 B 的写失败事件先到：回执不得退役 B 的 token，完整快照仍是地板", async ({ page }) => {
  const degraded = {
    type: "persistence",
    vault: ROOT,
    session_token: 12,
    state: "degraded",
    since_ts: 1795000000,
    severity: "history",
    detail: "llm_request:write",
    history_written: true,
    history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
  };
  await setup(page, "direct", { deferWithdraw: true, afterWithdrawPersistence: degraded });
  const note = page.locator("[data-persistence-health]");
  await page.locator(".lumir-hp-msg-user").hover();
  await page.locator(".lumir-hp-withdraw").click();
  await expect
    .poll(() =>
      page.evaluate(
        () => typeof (window as unknown as Record<string, any>).__resolveWithdraw,
      ),
    )
    .toBe("function");

  // B（token 12）的写失败事件先于回执：警示块立即显示。
  await page.evaluate((payload) => {
    (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(payload);
  }, degraded);
  await expect(note).toBeVisible();
  await expect(note).toContainText("此前部分记录也未能保存");

  // 回执落地：完整快照（token 12 / 同一失败）是地板，告警必须仍在。
  await page.evaluate(() => {
    (window as unknown as Record<string, any>).__resolveWithdraw();
  });
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  await expect(note).toBeVisible({ timeout: 5000 });
  await expect(note).toContainText("此前部分记录也未能保存");
});
