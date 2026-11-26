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

async function setup(page: Page, mode: Mode): Promise<void> {
  await stubTauri(page, VAULT);
  await page.addInitScript(
    ({ mode, messages, marker }) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const origInvoke = internals.invoke;
      w.__withdrawCalls = [] as Array<{ confirm: boolean }>;
      w.__harnessEventHandlerIds = [] as number[];
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
        if (cmd === "harness_state") return JSON.stringify(snapshot);
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
          return {
            needs_confirmation: false,
            tool_names: mode === "confirm" ? ["vault_patch", "cli_run"] : [],
            info: {
              session_id: "s1760000000000-bbbbbb",
              session_token: 12,
              messages: [],
              withdrawn: { text: marker, skills: [] },
              first_user_text: null,
            },
          };
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
    { mode, messages: MESSAGES, marker: MARKER },
  );
  await page.goto("/");
  await page.locator('.ft-row[title="withdraw-note.md"]').click();
  await expect(page.locator(".cm-content").first()).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
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
