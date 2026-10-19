import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M607（Alex 2026-10-19 裁决「彻底去掉，只留任务区」）的结构断言：
//
//   1. 子代理清单区（design §19.4 的只读折叠列表）退场——后端即使照常返回一份可用的
//      `harness_subagent_catalog`（enabled = true + 一条定义），面板也 MUST NOT 渲染清单区；
//   2. 任务区（§19.1）不受牵连——快照带 `subrun_usage` 时用量区照常出现。
//
// 断言设计（REVIEW.md「读不到当成空」条）：本场景不靠「清单区不可见」判退场——那是 hidden
// 也成立的弱判据；判据是 DOM 里**零元素**。为了排除「桩没生效、本来就没东西」的空转，同一次
// 快照还驱动任务区（.lumir-tp-usage 有行），证明桩链路本身生效；本场景在改代码前实测为红
// （清单区被渲染出来），改动后转绿。

const DOC = "# 清单退役笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 子代理后端桩：清单命令返回一份可渲染的定义；快照带一条子运行用量桶（任务区照常的输入）。 */
async function stubSubagentBackend(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__catalogCalls = 0;
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          auto_wake: { chain: 0, max: 3, blocked: null },
          subrun_usage: {
            "mock-fast": { input: 1200, cached: 0, writes: 0, output: 340, samples: 2, segments: 2 },
          },
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "harness_subagent_catalog") {
        w.__catalogCalls += 1;
        return JSON.stringify({
          enabled: true,
          definitions: [
            {
              name: "catalog-probe",
              description: "M607 清单退役探针（合成定义）",
              tools: 3,
              model: null,
              background: false,
              source: "vault",
              override_from: null,
            },
          ],
          warnings: [],
        });
      }
      return invoke(cmd, args);
    };
  });
}

test("子代理清单区退场、任务区照常", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubSubagentBackend(page);
  await page.goto("/");

  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  const panel = page.locator(".lumir-harness");
  await expect(panel).toBeVisible();

  // 任务区（§19.1）照常：快照里的 `subrun_usage` 给出一行读数——同时证明桩链路生效。
  await expect(page.locator(".lumir-tp")).toBeVisible();
  await expect(page.locator(".lumir-tp-usage")).toBeVisible();
  await expect(page.locator(".lumir-tp-usage-row")).toHaveCount(1);
  await expect(page.locator(".lumir-tp-usage-model")).toHaveText("mock-fast");

  // 清单区（§19.4）退场：零元素（不是「不可见」）。
  await expect(page.locator(".lumir-tpc")).toHaveCount(0);
  await expect(page.locator(".lumir-tpc-head")).toHaveCount(0);
  await expect(page.locator(".lumir-tpc-list")).toHaveCount(0);
});
