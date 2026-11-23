import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 失败轮次显式重试（change add-harness-turn-retry-nov23）的**结构**场景（design §11.2 F1–F12）。
//
// 本 spec 只做 DOM / 快照 / 相位的行为断言，不新增整页像素基线：动作钮与「未完成」标记都是
// 次级文本件，尺寸远小于整页容差预算，像素层对它们没有区分度；空闲态零漂移由既有整页基线
// 继续守卫（本 spec 不制造空闲态新像素）。
//
// 判据都走可观测面：错误行条数 / 动作文本与可访问名 / `__retryCalls`（命令调用次数与参数）/
// 送钮相位（aria-label 停止 = running）/ transcript 文本 / 尾部动作行条数。

const DOC = "# 重试笔记\n\n第一段，给面板一个可开的文档。\n";

const VAULT: VaultFixture = {
  root: "/tmp/lumir-nov23-retry-vault",
  entries: [{ path: "retry-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "retry-note.md": DOC },
  links: {},
};

interface RetryStubOptions {
  messages?: Array<{ role: string; text: string }>;
  /** `harness_state.in_flight`（相位权威）。 */
  inFlight?: boolean;
  /** `harness_state.retry`（缺键 = 无动作）。 */
  retry?: { turn: number } | null;
  /** `harness_retry` 的拒绝形态（缺省成功受理）。 */
  reject?: { code: string; message: string } | null;
  /** 拒绝之后 `harness_state` 的应答（轻量快照的输入）。 */
  stateAfterReject?: { inFlight?: boolean; retry?: { turn: number } | null };
}

/**
 * 桩：`harness_state` / `harness_retry` / `harness_send` + 事件注入。
 * `__retryCalls` 是「点击 → 命令」的唯一观测口（恰好一次 / 绑定的 turn）。
 */
async function stubRetry(page: Page, options: RetryStubOptions = {}): Promise<void> {
  await page.addInitScript((opts: RetryStubOptions) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [] as number[];
    w.__retryCalls = [] as number[];
    w.__stateInFlight = opts.inFlight ?? false;
    w.__stateRetry = opts.retry ?? null;
    const snapshot = () =>
      JSON.stringify({
        messages: (opts.messages ?? []).map((m) => ({
          role: m.role,
          text: m.text,
          ts: 1759912345,
        })),
        usage: { ctx_pct: 0, cache_pct_session: 0 },
        in_flight: w.__stateInFlight,
        retry: w.__stateRetry ?? undefined,
        warn_ctx_pct: 85,
      });
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") return snapshot();
      if (cmd === "harness_retry") {
        w.__retryCalls.push(args.turn);
        if (opts.reject !== undefined && opts.reject !== null) {
          // 同步拒绝的现场：后端此刻的视图就是 `stateAfterReject`（busy 时另一轮在途、
          // thread_failed / vision 拒绝时 failed 仍保留）。拒绝与视图同时成立，前端随后的
          // 轻量快照读到的才是真值——否则测试会拿「拒绝之后才改快照」造出假现场。
          if (opts.stateAfterReject !== undefined) {
            w.__stateInFlight = opts.stateAfterReject.inFlight ?? false;
            w.__stateRetry = opts.stateAfterReject.retry ?? null;
          }
          throw opts.reject;
        }
        return null;
      }
      if (cmd === "harness_send") return null;
      if (cmd === "harness_new_session") return null;
      if (cmd === "harness_draft_get") return null;
      if (cmd === "harness_draft_put") return null;
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      return origInvoke(cmd, args);
    };
    // 拒绝之后快照换成 `stateAfterReject`（轻量快照的就地更新判据）。
    w.__applyStateAfterReject = () => {
      if (opts.stateAfterReject === undefined) return;
      w.__stateInFlight = opts.stateAfterReject.inFlight ?? false;
      w.__stateRetry = opts.stateAfterReject.retry ?? null;
    };
    w.__setState = (inFlight: boolean, retry: { turn: number } | null) => {
      w.__stateInFlight = inFlight;
      w.__stateRetry = retry;
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
    };
  }, options);
}

async function openPanel(page: Page): Promise<void> {
  await page.locator('.ft-row[title="retry-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) =>
      (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

function retryCalls(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __retryCalls: number[] }).__retryCalls);
}

async function setState(
  page: Page,
  inFlight: boolean,
  retry: { turn: number } | null,
): Promise<void> {
  await page.evaluate(
    ({ inFlight: flying, retry: retryValue }) => {
      const w = window as unknown as {
        __setState?: (inFlight: boolean, retry: { turn: number } | null) => void;
      };
      w.__setState?.(flying, retryValue);
    },
    { inFlight, retry },
  );
}

async function applyStateAfterReject(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __applyStateAfterReject?: () => void };
    w.__applyStateAfterReject?.();
  });
}

/** 放行 `harness_retry` 的拒绝并清干微任务（catch 里的快照重取跑完）。 */
async function settleRejection(page: Page): Promise<void> {
  await applyStateAfterReject(page);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  await page.waitForTimeout(50);
}

test("F1/F2：error 带 retry 才出现动作；点击恰好一次、立即禁用、相位 running", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await stubRetry(page);
  await page.goto("/");
  await openPanel(page);
  // 不可重试错误（缺键）：没有任何动作。
  await fire(page, { type: "error", code: "harness_http_error", message: "HTTP 400" });
  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-retry-btn")).toHaveCount(0);

  // 可重试错误：错误行内出现唯一动作。
  await fire(page, {
    type: "error",
    code: "harness_network_failed",
    message: "连不上",
    retry: { turn: 7 },
  });
  const btn = page.locator(".lumir-hp-retry-btn");
  await expect(btn).toHaveCount(1);
  await expect(btn).toHaveText("重试");
  await expect(btn).toHaveAttribute("aria-label", "重试");
  await expect(btn).toHaveAttribute("title", "重试");

  await btn.click();
  expect(await retryCalls(page)).toEqual([7]);
  await expect(btn).toBeDisabled();
  // 相位进入 running（送钮切到「停止」）。
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");
  // 连点不再发第二次（按钮禁用 + in-flight 守卫）。
  await btn.click({ force: true });
  expect(await retryCalls(page)).toEqual([7]);
});

test("F3：同文案错误就地替换，动作绑定最新 turn", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRetry(page);
  await page.goto("/");
  await openPanel(page);
  await fire(page, {
    type: "error",
    code: "harness_network_failed",
    message: "连不上",
    retry: { turn: 3 },
  });
  await fire(page, {
    type: "error",
    code: "harness_network_failed",
    message: "连不上",
    retry: { turn: 4 },
  });
  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-retry-btn")).toHaveCount(1);
  await page.locator(".lumir-hp-retry-btn").click();
  expect(await retryCalls(page)).toEqual([4]);
  // 新 error 不可重试时动作消失（同一行就地更新）。
  await fire(page, { type: "error", code: "harness_network_failed", message: "连不上" });
  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-retry-btn")).toHaveCount(0);
});

test("F4/F10：enter 快照按 retry 重建恰好一条尾部动作；content 档清面后同样一条；done 清动作", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await stubRetry(page, {
    messages: [{ role: "user", text: "旧问题" }],
    inFlight: false,
    retry: { turn: 5 },
  });
  await page.goto("/");
  await openPanel(page);
  // enter 快照（挂载）：尾部动作行恰好一条，通用文案。
  const row = page.locator(".lumir-hp-retry-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("上一轮未完成");
  await expect(row.locator(".lumir-hp-retry-btn")).toHaveText("重试");

  // 非 idle 相位点击 no-op（F8 的第二半）：先点一次进入 running，再点尾部仍不追加请求。
  await row.locator(".lumir-hp-retry-btn").click();
  expect(await retryCalls(page)).toEqual([5]);
  await row.locator(".lumir-hp-retry-btn").click({ force: true });
  expect(await retryCalls(page)).toEqual([5]);

  // done 清动作。
  await fire(page, { type: "done" });
  await expect(page.locator(".lumir-hp-retry-row")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-retry-btn")).toHaveCount(0);
});

test("F10：中途接管的 content 快照清面后恰好重建一条动作", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRetry(page, {
    messages: [{ role: "user", text: "接管问题" }],
    // 进入快照说「一轮在跑」⇒ midTakeover；content 快照不该读它，但 retry 要读到。
    inFlight: true,
    retry: null,
  });
  await page.goto("/");
  await openPanel(page);
  // 接管中的轮次以可重试错误收尾：error 分支发起 content 快照；快照里的 retry 在场。
  await setState(page, true, { turn: 6 });
  await fire(page, {
    type: "error",
    code: "harness_network_failed",
    message: "断",
    retry: { turn: 6 },
  });
  await expect(page.locator(".lumir-hp-retry-row")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-retry-row")).toContainText("上一轮未完成");
  await expect(page.locator(".lumir-hp-retry-btn")).toHaveCount(1);
  // 清面重放后动作只一条（不是零条 / 两条）；点击只发一次请求。
  await page.locator(".lumir-hp-retry-row .lumir-hp-retry-btn").click();
  expect(await retryCalls(page)).toEqual([6]);
});

test("F5/F9：busy 拒绝不本地收口；第一次重试的后续分片与 done 照常", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRetry(page, {
    messages: [{ role: "user", text: "旧问题" }],
    reject: { code: "harness_busy", message: "对话正在处理中（桩）" },
    // 第一次重试仍在流式：后端视图 in_flight = true，failed 已被消费（retry 缺键）。
    stateAfterReject: { inFlight: true, retry: null },
  });
  await page.goto("/");
  await openPanel(page);
  await fire(page, {
    type: "error",
    code: "harness_network_failed",
    message: "断",
    retry: { turn: 8 },
  });
  // 第一次重试在途：后端视图里 in_flight = true（拒绝后的轻量快照读它）。
  await page.locator(".lumir-hp-retry-btn").click();
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");
  await settleRejection(page);
  // busy 拒绝：错误行照常上屏、相位仍 running（MUST NOT local_finish / 强制 idle）。
  // 拒绝是**新的一条**错误行（原失败行保留）——按文案收窄，避免 strict mode 撞上两条。
  await expect(
    page.locator(".lumir-hp-error").filter({ hasText: "重试未能发出" }),
  ).toHaveCount(1);
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");
  // 第一次重试的后续分片仍要上屏（闸门未被第二次 busy 关掉）。
  await fire(page, { type: "text_chunk", text: "BUSY-LATER" });
  await expect(page.locator(".lumir-hp-transcript")).toContainText("BUSY-LATER");
  await fire(page, { type: "done" });
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");
});

test("F11：线程启动失败 → 轻量快照 retry 仍在，动作重建且拒绝错误行不被清掉", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await stubRetry(page, {
    messages: [{ role: "user", text: "旧问题" }],
    reject: { code: "harness_thread_failed", message: "无法启动对话线程（桩）" },
    stateAfterReject: { inFlight: false, retry: { turn: 9 } },
  });
  await page.goto("/");
  await openPanel(page);
  await fire(page, {
    type: "error",
    code: "harness_network_failed",
    message: "断",
    retry: { turn: 9 },
  });
  await page.locator(".lumir-hp-retry-btn").click();
  await settleRejection(page);
  // 拒绝错误行仍在（轻量快照不重放内容）。
  await expect(
    page.locator(".lumir-hp-error").filter({ hasText: "重试未能发出" }),
  ).toHaveCount(1);
  // 动作由快照 retry 重建（尾部行），可再点。
  const row = page.locator(".lumir-hp-retry-row");
  await expect(row).toHaveCount(1);
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");
  await row.locator(".lumir-hp-retry-btn").click();
  expect(await retryCalls(page)).toEqual([9, 9]);
});

test("F7：半截正文标「未完成」，重试成功后另起第二条 assistant", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRetry(page, { messages: [{ role: "user", text: "旧问题" }] });
  await page.goto("/");
  await openPanel(page);
  await fire(page, { type: "auto_turn_started", chain_index: 0 });
  await fire(page, { type: "text_chunk", text: "PARTIAL-BODY" });
  // 等分段 flush 落地（`streamingText` 在场）再收错误——否则「失败前已产出正文」的现场不成立，
  // 「未完成」标记的断言会变成恒真 / 恒假的空过。
  await expect(page.locator(".lumir-hp-transcript")).toContainText("PARTIAL-BODY");
  await fire(page, {
    type: "error",
    code: "harness_stream_error",
    message: "断",
    retry: { turn: 11 },
  });
  // 半截正文与「未完成」标记都在场。
  await expect(page.locator(".lumir-hp-transcript")).toContainText("PARTIAL-BODY");
  await expect(page.locator(".lumir-hp-incomplete")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-incomplete")).toHaveText("未完成");
  // 重试成功：新回答是第二条 assistant，旧条保留。
  await page.locator(".lumir-hp-retry-btn").click();
  await fire(page, { type: "text_chunk", text: "SECOND-ANSWER" });
  await fire(page, { type: "done" });
  const messages = page.locator(".lumir-hp-msg-assistant");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(0)).toContainText("PARTIAL-BODY");
  await expect(messages.nth(1)).toContainText("SECOND-ANSWER");
  await expect(page.locator(".lumir-hp-incomplete")).toHaveCount(1);
});

test("F12：含图失败切非 vision 模型 → 重试被拒、人话错误行 + 动作仍在", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRetry(page, {
    messages: [{ role: "user", text: "带图问题" }],
    reject: {
      code: "harness_image_unsupported",
      message: "当前模型 retry-probe-model 不支持图片输入：请切换到支持图片的模型后重试",
    },
    stateAfterReject: { inFlight: false, retry: { turn: 12 } },
  });
  await page.goto("/");
  await openPanel(page);
  await fire(page, {
    type: "error",
    code: "harness_network_failed",
    message: "断",
    retry: { turn: 12 },
  });
  await page.locator(".lumir-hp-retry-btn").click();
  await settleRejection(page);
  // 重试语境文案（D965）：不照抄发送路径的「移除图片卡片」。
  const rejection = page.locator(".lumir-hp-error").filter({ hasText: "重试未能发出" });
  await expect(rejection).toHaveCount(1);
  await expect(rejection).toContainText("切换到支持图片的模型后重试");
  await expect(rejection).not.toContainText("移除图片卡片");
  // 失败状态保留：动作由快照重建。
  await expect(page.locator(".lumir-hp-retry-row .lumir-hp-retry-btn")).toHaveCount(1);
});

test("F6：zh / en 两档的可见文字与可访问名（title / aria-label）同源", async ({ page }) => {
  await stubTauri(page, { ...VAULT, config: { language: "en" } });
  await stubRetry(page, {
    messages: [{ role: "user", text: "old question" }],
    retry: { turn: 2 },
  });
  await page.goto("/");
  await openPanel(page);
  const row = page.locator(".lumir-hp-retry-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("The previous turn was incomplete");
  const btn = row.locator(".lumir-hp-retry-btn");
  await expect(btn).toHaveText("Retry");
  await expect(btn).toHaveAttribute("title", "Retry");
  await expect(btn).toHaveAttribute("aria-label", "Retry");
});

test("F8：发送新消息清掉旧动作；enter 快照缺 retry 时不重建", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubRetry(page, { retry: { turn: 4 } });
  await page.goto("/");
  await openPanel(page);
  await expect(page.locator(".lumir-hp-retry-row")).toHaveCount(1);
  // 发送（`sent`）清动作。
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("新问题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-retry-row")).toHaveCount(0);
});
