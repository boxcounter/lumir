import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M607（Alex 2026-10-19 裁决「彻底去掉，只留任务区」）+ M610（后端命令退役）的结构断言，
// M822 起同时钉住「空闲态零占位」：
//
//   1. 子代理清单区（design §19.4 的只读折叠列表）退场——命令与 IPC 包装已随 M610 删除，
//      面板 MUST NOT 渲染清单区；
//   2. 任务控制区只在有在跑 / 待批 / 待确认的 run 时出现：只有 `subrun_usage` 快照
//      （重载恢复后的旧形态）时整块不出现，MUST NOT 常驻按模型用量表（M822 C1）。
//
// 断言设计（REVIEW.md「读不到当成空」条）：清单区判据是 DOM 里**零元素**（hidden 也成立，
// 区分度不足）；同时用「有 live run 时控制区真的出现」证明渲染链路本身生效，避免「根本没渲染
// 任何东西」的空转。

const DOC = "# 清单退役笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 子代理后端桩：快照里的任务区读数（用量桶 / live run 列表由参数给）。 */
async function stubSubagentBackend(
  page: Page,
  state: { subrun_usage: unknown; live_subruns?: unknown },
): Promise<void> {
  await page.addInitScript((payload: typeof state) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          auto_wake: { chain: 0, max: 3, blocked: null },
          ...payload,
          warn_ctx_pct: 85,
        });
      }
      return invoke(cmd, args);
    };
  }, state);
}

const USAGE = {
  "mock-fast": { input: 1200, cached: 0, writes: 0, output: 340, samples: 2, segments: 2 },
};

async function openPane(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

test("子代理清单区退场；只有用量桶时任务控制区不出现（空闲零占位）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubSubagentBackend(page, { subrun_usage: USAGE });
  await openPane(page);

  // 空闲态：整块不出现（无完成数汇总、无常驻按模型用量表）。
  await expect(page.locator(".lumir-tp")).toBeHidden();
  await expect(page.locator(".lumir-tp-run")).toHaveCount(0);
  await expect(page.locator(".lumir-tp-usage")).toHaveCount(0);
  await expect(page.locator(".lumir-tp-usage-row")).toHaveCount(0);

  // 清单区（§19.4）退场：零元素（不是「不可见」）。
  await expect(page.locator(".lumir-tpc")).toHaveCount(0);
  await expect(page.locator(".lumir-tpc-head")).toHaveCount(0);
  await expect(page.locator(".lumir-tpc-list")).toHaveCount(0);
});

test("有后台 run 时控制区出现一行（渲染链路生效，不是空转）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubSubagentBackend(page, {
    subrun_usage: USAGE,
    live_subruns: [
      {
        run_id: "r-visual-1",
        agent: "research",
        description: "梳理清单退役",
        model: "mock-fast",
        background: true,
        segment: 1,
        rounds: 2,
        tool_calls: 4,
        last_tool: "vault_read",
        elapsed_ms: 12_000,
      },
    ],
  });
  await openPane(page);

  await expect(page.locator(".lumir-tp")).toBeVisible();
  await expect(page.locator(".lumir-tp-run")).toHaveCount(1);
  await expect(page.locator(".lumir-tp-run")).toContainText("梳理清单退役");
  await expect(page.locator(".lumir-tp-run")).toContainText("运行中");
  await expect(page.locator(".lumir-tp-run")).toContainText("12s");
  // 常驻用量表不再有出口（用量改到会话浮层按需查看）。
  await expect(page.locator(".lumir-tp-usage")).toHaveCount(0);
  await expect(page.locator(".lumir-tpc")).toHaveCount(0);
});
