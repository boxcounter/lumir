// M845：harness 异步事件与任务生命周期的结构断言场景（零像素基线，全部走桩）。
//
// 判定面（生产既有不变量，和单测 `tests/unit/harness-async-adversarial.test.ts` 同源）：
//   1. **轮次闸门**（M374）：`done` / `aborted` 之后、下一次发送之前到达的正文分片一律丢弃
//      ——已取消 / 已结束轮次的迟到产出不得复活进消息流；下一轮发送重新开闸。
//   2. **停止指向目标轮次**：运行中点击发送钮 = 停止（调 `harness_abort`），终态收口回 idle，
//      停止后迟到的分片同样被闸门丢弃；已停止标记挂在被中断的消息上。
//   3. **vault 归属**：`harness:event` 信封带别的 vault 时整条丢弃，不带 vault 时按「归属未知」
//      放行（与 `inCurrentVault` 的 fail-closed 口径一致）。
//   4. **任务行归属**：未知 run 的终态事件不造行；终态后迟到的 progress 不复活运行态；
//      同 run 的第二段 `started` 是 resume（仍一行），不是第二行。
//   5. **通知徽标（应用内）**：面板收起时收到终态 → 标题栏 toggle 点亮未读；点击开启面板后
//      未读清算。系统通知的点击（`spawn_notification_click_waiter`）只在真机可达，本场景不覆盖
//      ——mission 的 mock-only 约束下它没有可注入的接缝，由真机验收套件承担。
//
// 反向验证（REVIEW.md「断言等价于子串」条）：每条闸门断言都配一个「必须出现」的对照输入
// ——迟到分片必须缺席，而同一文本在下一轮 / 正确 vault 下必须到场；只在删除防线时才会翻红。

import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";
import { providerEntry, standardProviders } from "./provider-config";

const PROVIDERS = { mock: providerEntry("mock", { fixture: "f.json" }) };

const DOC = "# 生命周期笔记\n\n给面板一个视口口径。\n";

/** 当前 vault 的合成根：事件归属断言以它为准（`inCurrentVault` 是逐字节比较）。 */
const VAULT_ROOT = "/tmp/lumir-m845-fixture-vault";

const VAULT: VaultFixture = {
  root: VAULT_ROOT,
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 面板桩：空态快照 + `harness_send` / `harness_abort` 记录 + `harness:event` 注入通道。 */
async function stubHarness(page: Page): Promise<void> {
  await page.addInitScript((providers) => {
    (window as unknown as Record<string, unknown>).__VISUAL_PROVIDERS = providers;
  }, PROVIDERS);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    w.__harnessSends = [];
    w.__harnessAborts = 0;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        w.__harnessSends.push(args);
        return null;
      }
      if (cmd === "harness_abort") {
        w.__harnessAborts += 1;
        return null;
      }
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          live_subruns: [],
          subrun_runs: [],
          warn_ctx_pct: 85,
          thinking: { level: "high", supported: true },
        });
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      const result = await origInvoke(cmd, args);
      if (cmd === "config_get" && result?.config) {
        result.config.harness = {
          provider: "mock",
          providers: (window as unknown as Record<string, any>).__VISUAL_PROVIDERS,
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
  });
}

async function openPanel(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("给面板一个视口口径");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

const fire = (page: Page, payload: unknown) =>
  page.evaluate(
    (p) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(p),
    payload,
  );

/** 发送一条消息（面板必须在空闲相位）。 */
async function send(page: Page, text: string): Promise<void> {
  await page.locator(".lumir-hp-composer .cm-content").fill(text);
  await page.locator(".lumir-hp-send").click();
}

/** agent 消息正文的拼接文本（`text_chunk` 的落点）。 */
function agentText(page: Page): Promise<string> {
  return page.locator(".lumir-hp-msg-assistant .lumir-hp-body").allTextContents().then((parts) => parts.join(""));
}

const assistantCount = (page: Page) => page.locator(".lumir-hp-msg-assistant").count();

test("轮次闸门：终态之后迟到的分片被丢弃，下一轮发送重新开闸", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPanel(page);

  await send(page, "第一轮问题");
  await fire(page, { type: "text_chunk", text: "第一段正文。" });
  await expect.poll(() => agentText(page)).toContain("第一段正文。");
  await fire(page, { type: "done" });
  // 重复终态：收口幂等，不追加第二条消息（重连 / 重放可能重发终态）。
  await fire(page, { type: "done" });
  await page.waitForTimeout(50);
  expect(await assistantCount(page)).toBe(1);

  // 迟到的分片：同一文本必须在闸门关闭时缺席……
  await fire(page, { type: "text_chunk", text: "终态后的迟到分片。" });
  await page.waitForTimeout(80);
  expect(await agentText(page)).not.toContain("终态后的迟到分片");
  expect(await assistantCount(page)).toBe(1);

  // ……而在下一轮发送（重新开闸）之后必须到场（对照组：证明断言不是恒真）。
  await send(page, "第二轮问题");
  await fire(page, { type: "text_chunk", text: "第二轮正文。" });
  await expect.poll(() => agentText(page)).toContain("第二轮正文。");
  expect(await agentText(page)).not.toContain("终态后的迟到分片");
});

test("停止：只收口目标轮次，迟到分片不复活并留下已停止标记", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPanel(page);

  await send(page, "要停掉的问题");
  await fire(page, { type: "text_chunk", text: "半截回答。" });
  await expect.poll(() => agentText(page)).toContain("半截回答。");

  // 运行中点击发送钮 = 停止：真的调到了 harness_abort（相位机与后端接线同一动作）。
  // 计数读桩自己的账（wrapper 拦截的命令不会进 tauri-stub 的 __invokes）。
  const abortCount = () =>
    page.evaluate(() => (window as unknown as { __harnessAborts: number }).__harnessAborts);
  const before = await abortCount();
  await page.locator(".lumir-hp-send").click();
  await expect.poll(abortCount).toBe(before + 1);
  // 连点闸：stopping 相位里按钮禁用，第二次点击不会再发一条停止请求。
  await expect(page.locator(".lumir-hp-send")).toBeDisabled();

  await fire(page, { type: "aborted" });
  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-stopped").last()).toBeVisible();
  // 停止之后迟到的分片：不进消息流。
  await fire(page, { type: "text_chunk", text: "停止后迟到的分片。" });
  await page.waitForTimeout(80);
  expect(await agentText(page)).not.toContain("停止后迟到的分片");

  // 收口回 idle：可以立即开下一轮（停止没有留下半收口状态）。
  await expect(page.locator(".lumir-hp-toggle")).toHaveAttribute("data-activity", "idle");
  await send(page, "停止后的新一轮");
  await fire(page, { type: "text_chunk", text: "新一轮正文。" });
  await expect.poll(() => agentText(page)).toContain("新一轮正文。");
});

test("vault 归属：别的 vault 的事件整条丢弃，无 vault 载荷按归属未知放行", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPanel(page);

  await send(page, "归属探针");
  // 别的 vault：丢弃（fail-closed）。
  await fire(page, { type: "text_chunk", text: "串台正文。", vault: "/tmp/lumir-m845-other-vault" });
  await page.waitForTimeout(80);
  expect(await agentText(page)).not.toContain("串台正文");

  // 当前 vault：照常渲染（对照组）。
  await fire(page, { type: "text_chunk", text: "本 vault 正文。", vault: VAULT_ROOT });
  await expect.poll(() => agentText(page)).toContain("本 vault 正文。");
  // 不带 vault 的载荷：归属未知 → 放行（桩 / 旧载荷形态的兼容口径）。
  await fire(page, { type: "text_chunk", text: "无信封正文。" });
  await expect.poll(() => agentText(page)).toContain("无信封正文。");
  expect(await agentText(page)).not.toContain("串台正文");
});

test("任务行归属：未知终态不造行，迟到 progress 不复活终态，第二段是 resume", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPanel(page);

  const run = (id: string) => page.locator(`.lumir-tp-run[data-run="${id}"]`);
  // 未知 run 的 finished：不得凭空造行。
  await fire(page, {
    type: "subagent_finished",
    run_id: "ghost",
    segment: 1,
    agent: "research",
    status: "completed",
    rounds: 1,
    model: "mock-fast",
    input_tokens: 1,
    cached_tokens: 0,
    output_tokens: 1,
    denied_calls: 0,
    duration_ms: 10,
    summary_chars: 1,
  });
  await page.waitForTimeout(80);
  expect(await page.locator(".lumir-tp-run").count()).toBe(0);

  // 正牌 run：started 建行（运行中）→ finished 落终态。
  await fire(page, {
    type: "subagent_started",
    run_id: "r1",
    segment: 1,
    agent: "research",
    description: "梳理异步生命周期",
    model: "mock-fast",
    tools: ["vault_read"],
    max_turns: 4,
    max_tokens: 1000,
    timeout_secs: 30,
    background: true,
    call_id: "call-r1",
  });
  await expect(run("r1")).toHaveClass(/is-running/);
  await expect(run("r1")).toContainText("梳理异步生命周期");

  await fire(page, {
    type: "subagent_finished",
    run_id: "r1",
    segment: 1,
    agent: "research",
    status: "failed",
    rounds: 2,
    model: "mock-fast",
    input_tokens: 10,
    cached_tokens: 0,
    output_tokens: 5,
    denied_calls: 0,
    duration_ms: 900,
    summary_chars: 4,
    summary: "失败",
  });
  await expect(run("r1")).toHaveClass(/is-failed/);

  // 终态之后迟到的 progress：不得把行复活成运行中。
  await fire(page, {
    type: "subagent_progress",
    run_id: "r1",
    segment: 1,
    rounds: 3,
    tool_calls: 2,
    last_tool: "vault_read",
    elapsed_ms: 1200,
  });
  await page.waitForTimeout(80);
  await expect(run("r1")).toHaveClass(/is-failed/);
  await expect(run("r1")).not.toHaveClass(/is-running/);
  expect(await page.locator(".lumir-tp-run").count()).toBe(1);

  // 同 run 的第二段 started = resume：仍一行、回到运行中。
  await fire(page, {
    type: "subagent_started",
    run_id: "r1",
    segment: 2,
    agent: "research",
    description: "梳理异步生命周期（续）",
    model: "mock-fast",
    tools: ["vault_read"],
    max_turns: 4,
    max_tokens: 1000,
    timeout_secs: 30,
    background: true,
    call_id: "call-r1-b",
  });
  await expect(run("r1")).toHaveClass(/is-running/);
  expect(await page.locator(".lumir-tp-run").count()).toBe(1);
});

test("通知徽标：面板收起时终态点亮未读，点击开启后清算", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await openPanel(page);
  const toggle = page.locator(".lumir-hp-toggle");
  await expect(toggle).toHaveAttribute("data-activity", "idle");

  await send(page, "收起面板后完成的问题");
  // 面板收起（用户切去看文档）：面板打开时标题栏 toggle 是隐藏的（`toggleButton.hidden`），
  // 收起走全局快捷键 ⌘⇧A（与 toggle 的 deps.togglePane 同一个动作）。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toHaveCount(0);
  await expect(toggle).toBeVisible();
  await fire(page, { type: "text_chunk", text: "后台完成的回答。" });
  await fire(page, { type: "done" });
  await expect(toggle).toHaveAttribute("data-activity", "reply");

  // 点击通知入口（toggle）打开面板：未读在同一动作里清算。
  await toggle.click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(toggle).toHaveAttribute("data-activity", "idle");
  await expect.poll(() => agentText(page)).toContain("后台完成的回答。");
});
