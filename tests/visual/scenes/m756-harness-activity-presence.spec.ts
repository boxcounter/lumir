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

const DOC = "# 活动在场笔记\n\n第一段，给面板一个可开的文档。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "activity-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "activity-note.md": DOC },
  links: {},
};

/**
 * 活动在场场景桩：在通用 stub 之上补三处（与 m347 同一套注入机制）：
 *   1. `harness_state` 零态桩（同 m303 + `in_flight: false`——**新键**，快照的呈现读）；
 *   2. `harness_send` / `harness_abort` 成功返回（发送与停止的相位推进不依赖后端）；
 *   3. `__fireHarnessEvent`：记录 `harness:event` 的 handler id，经 runCallback 注入终态事件。
 */
async function stubHarnessActivity(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [] as number[];
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") return null;
      if (cmd === "harness_abort") return null;
      if (cmd === "harness_state") {
        // 键集合与 Rust `StateSnapshot::empty` 同形；`in_flight` 是本 change 新增的呈现读。
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0, has_usage: false },
          pending_approvals: [],
          warn_ctx_pct: 85,
          thinking: { level: "high", supported: true },
          in_flight: false,
        });
      }
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
  });
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
