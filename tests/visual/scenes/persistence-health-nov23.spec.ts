import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// 留存健康的视觉结构层（change add-persistence-health-status-nov23，design §7 / §10.3）：
//
//   V1 健康态：harness 状态行与文档区横幅均 `hidden`；横幅 `hidden` 时零占位
//      （`.pane-editor` 的首行布局与无横幅时逐像素一致——像素层的零漂移由既有整页基线承担，
//      本文件只钉结构判据，不新建像素基线）。
//   V2 当前写失败态：状态行可见、文案按 severity、`role="status"`。
//   V3 `state=ok` + gap 态：显示「写入已恢复…」且 MUST NOT 隐藏。
//   V4 横幅三形态：写失败 / 枚举失败 / 两者同时；健康态撤下。
//
// 不新建像素基线：V2–V4 的 `degraded` / gap / 横幅形态按合同属「截图文档先交 Alex 过目再
// `--update`」的人肉裁决点（design §7 末条），本层只留结构断言，避免用未经裁决的基线把
// 形态冻结。健康态的零漂移由既有整页基线 + `scripts/gate.sh visual` 全量比对兜底。

const ROOT = "/tmp/lumir-visual-persistence-health-vault";
const DOC = "# 持久化健康\n\n第一段，给面板一个可读的上下文。\n";

const VAULT: VaultFixture & { root: string } = {
  root: ROOT,
  entries: [{ path: "health-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "health-note.md": DOC },
  links: {},
};

interface HarnessStubOptions {
  /** `harness_state` 的 persistence 键（缺省 = 健康态新后端形状）。 */
  persistence?: Record<string, unknown>;
  /** 初始快照的逻辑会话身份（后端 Session 的稳定 token；0 = 无会话）。 */
  sessionToken?: number;
  /** 恢复入口返回的新会话 token 与恢复后的完整持久化快照（地板）。 */
  resumeSessionToken?: number;
  resumePersistence?: Record<string, unknown>;
  /** 新会话成功后的完整持久化快照（地板）。 */
  afterNewSession?: { session_token: number; persistence?: Record<string, unknown> };
  /** `harness_list_sessions` 的合成行（触发恢复路径）。 */
  sessions?: Array<{ session_id: string; first_user_text: string; ts: number }>;
  /** `harness_resume_session` 挂起到页面调用 `__resolveResume()`。 */
  deferResume?: boolean;
  /** `recovery_backup` 是否失败（写失败子条件）。 */
  backupFails?: boolean;
  /** `recovery_list` 是否失败（枚举失败子条件）。 */
  listFails?: boolean;
}

/** harness_state + recovery_* 的合成桩：面板只读可观测面（快照 / 事件），恢复目录不进真实
 *  config。`__fireHarnessEvent` 与 m383 同机制（listen 回调 id 经 init script 收集）。 */
async function stubHealth(page: Page, options: HarnessStubOptions = {}): Promise<void> {
  await page.addInitScript((opts) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__harnessEventHandlerIds = [];
    w.__backupCalls = 0;
    w.__resumeStarted = false;
    w.__resolveResume = null;
    w.__afterResume = false;
    w.__afterNewSession = false;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        const persistence =
          (w.__afterResume && opts.resumePersistence) ||
          (w.__afterNewSession && opts.afterNewSession?.persistence) ||
          opts.persistence ||
          {
            state: "ok",
            since_ts: 0,
            severity: null,
            detail: "",
            history_written: false,
            history_gap: { present: false, since_ts: 0, detail: "" },
          };
        const sessionToken = w.__afterResume
          ? opts.resumeSessionToken ?? 0
          : w.__afterNewSession
            ? opts.afterNewSession?.session_token ?? 0
            : opts.sessionToken ?? 0;
        return JSON.stringify({
          vault: opts.root,
          session_token: sessionToken,
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals: [],
          warn_ctx_pct: 85,
          persistence,
        });
      }
      if (cmd === "harness_list_sessions") {
        return JSON.stringify(opts.sessions ?? []);
      }
      if (cmd === "harness_resume_session") {
        if (!opts.deferResume) {
          w.__afterResume = true;
          return {
            session_id: "s-resumed",
            restored_items: 0,
            messages: [],
            session_token: opts.resumeSessionToken ?? 0,
          };
        }
        w.__resumeStarted = true;
        return new Promise((resolve: (value: unknown) => void) => {
          w.__resolveResume = () => {
            w.__afterResume = true;
            resolve({
              session_id: "s-resumed",
              restored_items: 0,
              messages: [],
              session_token: opts.resumeSessionToken ?? 0,
            });
          };
        });
      }
      if (cmd === "harness_new_session") {
        w.__afterNewSession = true;
        return null;
      }
      if (cmd === "harness_send" || cmd === "harness_abort") return null;
      if (cmd === "recovery_list") {
        if (opts.listFails) {
          throw { code: "recovery_list_failed", message: "无法枚举恢复目录：权限被拒", params: { reason: "权限被拒" } };
        }
        return [];
      }
      if (cmd === "recovery_backup") {
        w.__backupCalls += 1;
        if (opts.backupFails) {
          throw { code: "recovery_write_failed", message: "无法写入崩溃备份", params: {} };
        }
        return null;
      }
      if (cmd === "recovery_discard") return null;
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
  }, { root: ROOT, ...options });
}

const fire = (page: Page, payload: unknown) =>
  page.evaluate(
    (p) => (window as unknown as { __fireHarnessEvent: (x: unknown) => void }).__fireHarnessEvent(p),
    payload,
  );

const persistenceEvent = (overrides: Record<string, unknown> = {}) => ({
  type: "persistence",
  vault: ROOT,
  state: "degraded",
  since_ts: 1795000000,
  severity: "history",
  detail: "llm_request:write",
  history_written: true,
  history_gap: { present: false, since_ts: 0, detail: "" },
  ...overrides,
});

async function openPanel(page: Page): Promise<void> {
  await page.goto("/");
  await page.locator('.ft-row[title="health-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("持久化健康");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

// ── V1：健康态不打扰 ──────────────────────────────────────────────────────

test("V1 健康态：状态行与横幅均隐藏、横幅零占位（不新建像素基线）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);

  const note = page.locator("[data-persistence-health]");
  await expect(note).toHaveCount(1);
  await expect(note).toBeHidden();
  await expect(note).toHaveAttribute("role", "status");
  await expect(note).toHaveText("");

  const banner = page.locator(".recovery-banner");
  await expect(banner).toHaveCount(1);
  await expect(banner).toBeHidden();
  await expect(banner).toHaveAttribute("role", "status");
  // 结构：横幅是文档区顶部的常驻条；hidden 时不参与 flex 布局（`.pane-editor` 的首行仍是
  // pane）。判据取元素本身，像素层的零漂移由既有整页基线全量比对兜底。
  const bannerIsFirstChild = await page.evaluate(() => {
    const editor = document.querySelector(".pane-editor");
    return editor?.firstElementChild?.classList.contains("recovery-banner") ?? false;
  });
  expect(bannerIsFirstChild).toBe(true);
  const bannerDisplay = await banner.evaluate((el) => getComputedStyle(el).display);
  expect(bannerDisplay).toBe("none");
  // composer 在场且可见（面板没有被状态行挤掉）。
  await expect(page.locator(".lumir-hp-composer")).toBeVisible();
});

// ── V2 / V3：状态行两维分档 ───────────────────────────────────────────────

test("V2 当前写失败：状态行可见、文案按 severity、role=status", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");

  await fire(page, persistenceEvent({ severity: "history" }));
  await expect(note).toBeVisible();
  await expect(note).toHaveText("对话记录写入失败，这段历史可能不完整");

  await fire(page, persistenceEvent({ severity: "annotation" }));
  await expect(note).toHaveText("部分对话记录写入失败，不影响继续对话");

  // 恢复：ok 且无缺口 ⇒ 隐藏（状态行不自动消隐，但健康态必须隐藏）。
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: true,
      history_gap: { present: false, since_ts: 0, detail: "" },
    }),
  );
  await expect(note).toBeHidden();
});

test("V3 state=ok + 缺口：显示「写入已恢复但记录缺失」，MUST NOT 回到健康态；未落盘提示按 history_written 消退", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {});
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");

  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: false,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toBeVisible();
  await expect(note).toContainText("写入已恢复，但此前部分记录缺失");
  await expect(note).toContainText("本次会话的新记录尚未落盘，退出后无法恢复");

  // history_written 转 true：未落盘句消失，缺口文案仍在（状态行 MUST NOT 消失）。
  await fire(
    page,
    persistenceEvent({
      state: "ok",
      severity: null,
      detail: "",
      since_ts: 0,
      history_written: true,
      history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
    }),
  );
  await expect(note).toBeVisible();
  await expect(note).toHaveText("写入已恢复，但此前部分记录缺失，这段历史可能不完整");
});

// ── V4：横幅三形态 ────────────────────────────────────────────────────────

test("V4 横幅：写失败 / 枚举失败 / 两者同时三种形态，健康态撤下", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { backupFails: true, listFails: false });
  await openPanel(page);

  // 枚举失败先出现（vault 装载后的 checkRecovery）；写失败由 dirty 文档的备份 debounce 触发。
  const banner = page.locator(".recovery-banner");
  await expect(banner).toBeHidden();
  await page.locator(".editor-pane .cm-content").first().click();
  await page.keyboard.type("X");
  await expect(banner).toBeVisible({ timeout: 8000 });
  await expect(banner).toContainText("无法为 1 份未保存的文档写入崩溃备份");
  await expect(banner).toContainText("health-note.md");
  await expect(banner.getByRole("button", { name: "全部保存" })).toBeVisible();
  // 写失败段不冒充保存失败：vault 内文档未被改写。
  await expect(page.locator(".cm-content").first()).toContainText("X");
});

test("V4b 横幅：枚举失败独立在场、带「重新检查」，与写失败段可同时出现", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { backupFails: false, listFails: true });
  await openPanel(page);
  const banner = page.locator(".recovery-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("无法检查残留备份");
  await expect(banner.getByRole("button", { name: "重新检查" })).toBeVisible();
  await expect(banner).not.toContainText("无法为");
});

test("V4c 横幅：写失败与枚举失败同时在场（同一横幅两段、各自带动作）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, { backupFails: true, listFails: true });
  await openPanel(page);
  const banner = page.locator(".recovery-banner");
  await expect(banner).toBeVisible({ timeout: 5000 });
  await expect(banner).toContainText("无法检查残留备份");
  await page.locator(".editor-pane .cm-content").first().click();
  await page.keyboard.type("Y");
  await expect(banner).toContainText("无法为 1 份未保存的文档写入崩溃备份", { timeout: 8000 });
  await expect(banner).toContainText("无法检查残留备份");
  await expect(banner.getByRole("button", { name: "全部保存" })).toBeVisible();
  await expect(banner.getByRole("button", { name: "重新检查" })).toBeVisible();
});

// ── P2-5：横幅与 notice 同场几何（notice 的包含块必须是 pane 行盒） ─────────────

test("V5 横幅与编辑器 notice 同场：notice 从横幅下缘开始，不得覆盖横幅", async ({ page }) => {
  const empty: VaultFixture & { root: string } = {
    root: `${ROOT}-empty`,
    entries: [],
    files: {},
    links: {},
  };
  await stubTauri(page, empty);
  await stubHealth(page, { listFails: true });
  await page.goto("/");
  const banner = page.locator(".recovery-banner");
  const notice = page.locator(".editor-notice");
  await expect(banner).toBeVisible();
  await expect(notice).toBeVisible();
  const boxes = await page.evaluate(() => {
    const bannerEl = document.querySelector(".recovery-banner") as HTMLElement;
    const noticeEl = document.querySelector(".editor-notice") as HTMLElement;
    const b = bannerEl.getBoundingClientRect();
    const n = noticeEl.getBoundingClientRect();
    return { bannerBottom: b.bottom, bannerTop: b.top, noticeTop: n.top, noticeBottom: n.bottom };
  });
  expect(boxes.noticeTop).toBeGreaterThanOrEqual(boxes.bannerBottom - 0.5);
  expect(boxes.noticeTop).toBeGreaterThan(boxes.bannerTop);
});

// ── P1-3：逻辑会话归属（旧事件不得复活 / 恢复地板不得被 Promise 回执抹掉） ──────

const degradedGap = (token: number) => ({
  type: "persistence",
  vault: ROOT,
  session_token: token,
  state: "degraded",
  since_ts: 1795000000,
  severity: "history",
  detail: "llm_request:write",
  history_written: true,
  history_gap: { present: true, since_ts: 1795000000, detail: "llm_request:write" },
});

test("V6 恢复写失败事件先于 Promise 回执：完整快照为地板，告警不得被 reset 抹掉", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {
    sessionToken: 41,
    deferResume: true,
    resumeSessionToken: 42,
    resumePersistence: degradedGap(42),
    sessions: [{ session_id: "s-old", first_user_text: "旧会话", ts: 1757000000000 }],
  });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  await page.locator(".lumir-hp-session").click();
  await page.locator(".lumir-hp-sesspop-item").first().click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Record<string, any>).__resumeStarted))
    .toBe(true);

  // 恢复后端的写失败事件先于 Promise 回执到达。
  await fire(page, degradedGap(42));
  await expect(note).toBeVisible();
  await expect(note).toContainText("写入仍在失败");

  // 回执落地：完整快照（同一 token / 同一失败）是地板，告警必须仍在。
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__resolveResume();
  });
  await expect(note).toBeVisible({ timeout: 5000 });
  await expect(note).toContainText("写入仍在失败");
});

test("V7 新会话后旧会话的迟到事件不复活告警；新会话自己的事件仍可见", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHealth(page, {
    sessionToken: 41,
    afterNewSession: { session_token: 0 },
  });
  await openPanel(page);
  const note = page.locator("[data-persistence-health]");
  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");

  // 旧逻辑会话（token 41）的迟到失败事件：MUST NOT 复活状态行。
  await fire(page, degradedGap(41));
  await expect(note).toBeHidden();

  // 新会话自己的事件（token 43）照常显示。
  await fire(page, degradedGap(43));
  await expect(note).toBeVisible();
  await expect(note).toContainText("写入仍在失败");
});
