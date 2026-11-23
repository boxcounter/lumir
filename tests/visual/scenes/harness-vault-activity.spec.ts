import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 跨 vault 活动记录的**行为竞态**场景（change extend-harness-activity-across-vaults-nov23
// tasks 1.2a / design §14.3b）。判据不是源码结构，而是**真实执行**：
//
//   A 动作（可挂起的 deferred `harness_*` 调用）→ 切到 B → resolve / reject → 同时观察
//   A 与 B 的记录投影（A：切换器行标记；B：标题栏钮）与 B 的 DOM / 快照。
//
// 为什么在这里而不是 Node 单测：`createHarnessPanel` 跑不起零 DOM 单测（tests/unit/README.md
// 写明），而 design §14.3b 明确禁止把它退化成源码断言。本层是真装配 + 真 DOM（chromium 近似
// WKWebView）；真机主路径矩阵归 `scripts/acceptance` 场景 721。
//
// 记录的观测面（两侧都不依赖内部符号）：
//   - 当前 vault：标题栏 toggle 的 `data-activity`（idle / inflight / reply / failure）与 `title`；
//   - 非当前 vault：vault 切换器的行标记 `span.vault-row-activity[data-activity]` 与行 `title`。

const DOC = "# 跨 vault 活动\n\n第一段，给面板一个可开的文档。\n";
const A_ROOT = "/tmp/lumir-activity-a";
const B_ROOT = "/tmp/lumir-activity-b";

const REGISTRY: VaultListRow[] = [
  { id: "act-a", path: A_ROOT, name: "activity-a", available: true, last_opened_at: 1757000002000, tab_count: 0 },
  { id: "act-b", path: B_ROOT, name: "activity-b", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];

/** A → B → A 的往返夹具（init script 会 JSON.stringify，互相引用会造环——用无回指副本）。 */
const A_BASE: VaultFixture & { root: string } = {
  root: A_ROOT,
  vault_id: "act-a",
  entries: [{ path: "a-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "a-note.md": DOC },
  links: {},
  vaults: REGISTRY,
};
const B_BASE: VaultFixture & { root: string } = {
  root: B_ROOT,
  vault_id: "act-b",
  entries: [{ path: "b-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "b-note.md": DOC },
  vaults: REGISTRY,
};
/** 三跳往返链（A1 → B1 → A2 → B2）：桩的 `vault_open_path` 只认**当前** fixture 的 `switchTo`，
 *  两跳链在「第二次切到 B」时会静默失败（`fs_not_found`），本文件的两个用例都要走 A→B→A→B。 */
const B1 = { ...B_BASE };
const A2 = { ...A_BASE };
const B2 = { ...B_BASE };
const A_FIXTURE: VaultFixture & { root: string } = { ...A_BASE, switchTo: B1 };
B1.switchTo = A2;
A2.switchTo = B2;

/** 每个 vault 的进入快照与「挂起哪几个命令」的可调参数。 */
interface RaceStubOptions {
  /** **内部字段，场景 MUST NOT 写**：`stubRace` 把首装载根挂在这里过桥进 init script。 */
  __root?: string;
  /** 按 vault 根的 `harness_state`（messages / in_flight）。缺省空会话、空闲。 */
  state?: Record<string, { messages: Array<{ role: string; text: string }>; inFlight: boolean }>;
  /** 把第 N 次（0 基）`harness_send` 挂起到 `__release('send')`。 */
  holdSend?: number[];
  /** 把第 N 次 `harness_abort` 挂起到 `__release('abort')`，并在释放时按该信封 reject。 */
  abortReject?: { at: number; envelope: { code: string; message: string } };
  /** 把第 N 次 `harness_new_session` 挂起到 `__release('new')`。 */
  holdNew?: number[];
  /** 把第 N 次 `harness_cron_run` 挂起，释放时按该信封 reject。 */
  cronReject?: { at: number; envelope: { code: string; message: string } };
  /** 把第 N 次 `harness_retry` 挂起，释放时按该信封 reject。 */
  retryReject?: { at: number; envelope: { code: string; message: string } };
  /** 把第 N 次 `harness_resume_session` 挂起（`__release('resume', 'resolve'|'reject', …)`）。 */
  holdResume?: number[];
  /** 会话浮层的历史条目（`harness_list_sessions`）。 */
  sessionList?: Array<{ session_id: string; first_user_text?: string | null; title?: string | null; ts?: number }>;
  /** 把第 N 次 `vault_session_get` 延迟这么多毫秒（造「布局尚未落定」的窗口）。 */
  sessionGetDelay?: { from: number; ms: number };
}

/**
 * 竞态桩：
 *   1. `harness_state` 按当前 vault 根应答（与真后端「会话按 vault 分桶」同构）；
 *   2. `harness_send` / `harness_abort` / `harness_new_session` / `harness_cron_run` 可按调用序挂起
 *      （deferred），由页面调 `__release(name, mode)` 决定 resolve / reject；
 *   3. `vault_session_get` 可延迟（布局落定窗口）；
 *   4. `__fireHarnessEvent` / `__fireCronRun` / `__fireCronOpen`：经 handler id 注入事件。
 */
async function stubRace(page: Page, options: RaceStubOptions = {}): Promise<void> {
  await page.addInitScript((opts: RaceStubOptions) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__root = opts.__root ?? "";
    w.__harnessEventHandlerIds = [] as number[];
    w.__cronRunHandlerIds = [] as number[];
    w.__cronOpenHandlerIds = [] as number[];
    w.__stateCalls = 0;
    w.__pending = {} as Record<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>;
    w.__release = (name: string, mode: "resolve" | "reject", error?: unknown) => {
      const pending = w.__pending[name];
      if (!pending) throw new Error(`没有挂起的调用：${name}`);
      delete w.__pending[name];
      if (mode === "reject") pending.reject(error);
      else pending.resolve(null);
    };
    const counts = { send: 0, abort: 0, new: 0, cron: 0, retry: 0, resume: 0, sessionGet: 0 };
    const hold = (name: string): Promise<unknown> =>
      new Promise((resolve, reject) => {
        w.__pending[name] = { resolve: resolve as (v: unknown) => void, reject };
      });
    w.__stateCallsFor = (root: string) => (w.__stateCallsByRoot ?? {})[root] ?? 0;
    w.__stateCallsByRoot = {} as Record<string, number>;
    const snapshotFor = (root: string) => {
      const entry = opts.state?.[root] ?? { messages: [], inFlight: false };
      w.__stateCallsByRoot[root] = (w.__stateCallsByRoot[root] ?? 0) + 1;
      w.__stateCalls += 1;
      return JSON.stringify({
        vault: root,
        messages: entry.messages.map((m) => ({ role: m.role, text: m.text, ts: 1759912345 })),
        usage: { ctx_pct: 0, cache_pct_session: 0, has_usage: false },
        in_flight: entry.inFlight,
        pending_approvals: [],
        warn_ctx_pct: 85,
        thinking: { level: "high", supported: true },
      });
    };
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        const call = counts.send;
        counts.send += 1;
        if (opts.holdSend?.includes(call)) return hold("send");
        return null;
      }
      if (cmd === "harness_abort") {
        const call = counts.abort;
        counts.abort += 1;
        if (opts.abortReject && opts.abortReject.at === call) {
          return new Promise((_resolve, reject) => {
            w.__pending.abort = {
              resolve: () => {},
              reject: () => reject(opts.abortReject!.envelope),
            };
          });
        }
        return null;
      }
      if (cmd === "harness_new_session") {
        const call = counts.new;
        counts.new += 1;
        if (opts.holdNew?.includes(call)) return hold("new");
        return null;
      }
      if (cmd === "harness_cron_run") {
        const call = counts.cron;
        counts.cron += 1;
        if (opts.cronReject && opts.cronReject.at === call) {
          return new Promise((_resolve, reject) => {
            w.__pending.cron = {
              resolve: () => {},
              reject: () => reject(opts.cronReject!.envelope),
            };
          });
        }
        return null;
      }
      if (cmd === "harness_retry") {
        const call = counts.retry;
        counts.retry += 1;
        if (opts.retryReject && opts.retryReject.at === call) {
          return new Promise((_resolve, reject) => {
            w.__pending.retry = {
              resolve: () => {},
              reject: () => reject(opts.retryReject!.envelope),
            };
          });
        }
        return null;
      }
      if (cmd === "harness_resume_session") {
        const call = counts.resume;
        counts.resume += 1;
        if (opts.holdResume?.includes(call)) return hold("resume");
        return { session_token: null, messages: [] };
      }
      if (cmd === "harness_list_sessions") return opts.sessionList ?? [];
      if (cmd === "harness_state") return snapshotFor(w.__root);
      if (cmd === "vault_session_get") {
        const call = counts.sessionGet;
        counts.sessionGet += 1;
        if (opts.sessionGetDelay && call >= opts.sessionGetDelay.from) {
          await new Promise((resolve) => setTimeout(resolve, opts.sessionGetDelay!.ms));
        }
        return origInvoke(cmd, args);
      }
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      if (cmd === "plugin:event|listen" && args.event === "cron:run") {
        w.__cronRunHandlerIds.push(args.handler ?? 0);
      }
      if (cmd === "plugin:event|listen" && args.event === "cron:open_session") {
        w.__cronOpenHandlerIds.push(args.handler ?? 0);
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
    w.__fireCronRun = (payload: unknown) => {
      for (const id of w.__cronRunHandlerIds) {
        internals.runCallback(id, { event: "cron:run", id, payload });
      }
    };
    w.__fireCronOpen = (payload: unknown) => {
      for (const id of w.__cronOpenHandlerIds) {
        internals.runCallback(id, { event: "cron:open_session", id, payload });
      }
    };
  }, { ...options, __root: (A_FIXTURE as { root: string }).root } as RaceStubOptions);
}

async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) => (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

async function release(page: Page, name: string, mode: "resolve" | "reject", error?: unknown): Promise<void> {
  await page.evaluate(
    ({ name: n, mode: m, error: e }) =>
      (window as unknown as { __release: (n: string, m: string, e?: unknown) => void }).__release(n, m, e),
    { name, mode, error },
  );
}

/** 打开 vault 切换器并等行渲染完成。 */
async function openSwitcher(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-pop")).toBeVisible();
  await expect(page.locator(".vault-row")).toHaveCount(2);
}

/** 非当前 vault 行的标记（无节点时返回 null）。 */
async function rowMarker(page: Page, vaultId: string) {
  const marker = page.locator(`.vault-row[data-vault="${vaultId}"] .vault-row-activity`);
  if ((await marker.count()) === 0) return null;
  return {
    kind: await marker.getAttribute("data-activity"),
    title: await page.locator(`.vault-row[data-vault="${vaultId}"]`).getAttribute("title"),
  };
}

/** 关闭切换器：再点一次入口（`toggle()` 的开→关同一条路径；正文区会被 editor-notice
 *  遮住、Escape 又可能被别的层先接走，不作为本场景的关窗手段）。 */
async function closeSwitcher(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-pop")).toBeHidden();
}

/** 盯住标题栏 toggle 的属性写入（`renderActivity` 会写 `data-activity` 与 `title`）：
 *  返回读取函数，读到的是一次观察窗内的 MutationRecord 数。用来判「切走之后 MUST NOT 渲染
 *  B 的 DOM」——产品行为正确时窗口内应当是 0 条。 */
async function watchToggle(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    const el = document.querySelector(".lumir-hp-toggle");
    w.__toggleMutations = 0;
    const mo = new MutationObserver((records) => {
      w.__toggleMutations += records.length;
    });
    mo.observe(el as Node, { attributes: true, attributeFilter: ["data-activity", "title"] });
    w.__toggleObserver = mo;
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as Record<string, any>;
      w.__toggleObserver?.disconnect();
      return (w.__toggleMutations as number) ?? 0;
    });
}

/** 页面里所有 toast 的文本（toast 锚在 harness pane / 活跃 doc pane，两处都覆盖）。 */
async function toastTexts(page: Page): Promise<string[]> {
  return page.locator(".lumir-toast").evaluateAll((els) => els.map((el) => el.textContent ?? ""));
}

/** 切到某个 vault（经切换器行）并**确认真的装载完成**：浮层收起不等于装载成功（桩的
 *  `vault_open_path` 失败时浮层同样收起），不验证会把脚手架失败读成产品缺陷。 */
async function switchTo(page: Page, vaultId: string, name: string): Promise<void> {
  await openSwitcher(page);
  await page.locator(`.vault-row[data-vault="${vaultId}"]`).click();
  await expect(page.locator(".vault-pop")).toBeHidden();
  await expect(page.locator(".ft-vault-name")).toHaveText(name);
}

const toggle = (page: Page) => page.locator(".lumir-hp-toggle");

test("发送拒绝跨 vault：A 只撤销自己的乐观起点，B 的闸门 / transcript / 输入区不动", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, { holdSend: [0] });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  await page.locator(".lumir-hp-composer .cm-content").fill("A 的这条会被拒");
  await page.locator(".lumir-hp-send").click();
  await expect(toggle(page)).toHaveAttribute("data-activity", "inflight");

  // 拒绝回包在途时切到 B。
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-activity-b");
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");

  // 迟到的拒绝：A 的记录回到发送前（不留在途）；B 的标题栏钮仍是空闲。
  await release(page, "send", "reject", { code: "provider_missing", message: "没有配置 provider" });
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");

  // A 行没有任何在途标记（旧实现：A 永久停在 running）。
  await openSwitcher(page);
  expect(await rowMarker(page, "act-a")).toBeNull();
  await closeSwitcher(page);

  // B 的视图没被 A 的拒绝改写：打开面板后 transcript 里没有 A 的乐观气泡、也没有错误行。
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-transcript")).not.toContainText("A 的这条会被拒");
  await expect(page.locator(".lumir-hp-error")).toHaveCount(0);
});

test("停止拒绝跨 vault：只收口停止时那一轮，B 的视图不受影响", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    abortReject: { at: 0, envelope: { code: "harness_not_running", message: "没有在途轮次" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").fill("A 的一轮");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");

  // 点停止（进入 stopping），随后切到 B，拒绝才回来。
  await page.locator(".lumir-hp-send").click();
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");

  await release(page, "abort", "reject", null);
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");
  await openSwitcher(page);
  expect(await rowMarker(page, "act-a")).toBeNull();
  await closeSwitcher(page);

  // B 里不出现 A 的停止错误行。
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-error")).toHaveCount(0);
});

test("token 版本交错：真实事件已推进 A 的记录 ⇒ 迟到的拒绝不得覆盖它", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, { holdSend: [0] });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").fill("A 的一轮已被受理");
  await page.locator(".lumir-hp-send").click();
  await expect(toggle(page)).toHaveAttribute("data-activity", "inflight");

  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");

  // 真实事件推进 A 的记录（后端已发 auto_turn_started）：版本离开乐观起点。
  await fire(page, { type: "auto_turn_started", vault: A_ROOT });
  // 迟到的拒绝：版本门 no-op，A 仍是处理中（不是被「回滚」成空闲）。
  await release(page, "send", "reject", { code: "provider_missing", message: "没有配置 provider" });
  await openSwitcher(page);
  expect(await rowMarker(page, "act-a")).toEqual({ kind: "inflight", title: "activity-a · 处理中" });
  await closeSwitcher(page);
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");
});

test("新会话回包跨 vault：只清 A 的记录，B 的 transcript 不被重建", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    holdNew: [0],
    state: {
      [A_ROOT]: {
        messages: [
          { role: "user", text: "A-OLD 旧会话提问" },
          { role: "assistant", text: "A-OLD 旧会话回答" },
        ],
        inFlight: false,
      },
      [B_ROOT]: {
        messages: [{ role: "assistant", text: "B-KEEP B 的既有内容" }],
        inFlight: false,
      },
    },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-transcript")).toContainText("A-OLD 旧会话提问");

  // 新会话回包在途时切到 B。
  await page.locator(".lumir-hp-seg-new").click();
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-transcript")).toContainText("B-KEEP B 的既有内容");

  await release(page, "new", "resolve");
  // B 的 transcript 不被 A 的新会话回包清空 / 重建。
  await expect(page.locator(".lumir-hp-transcript")).toContainText("B-KEEP B 的既有内容");
  await expect(page.locator(".lumir-hp-transcript")).not.toContainText("A-OLD 旧会话提问");
});

test("显示门时序：布局未落定时到达的终态按「不在屏幕上」记未读，无 pane 则保留", async ({ page }) => {
  // B 的存储布局里没有 harness pane（桩缺省 harness_pane=false），且会话恢复被人为拖慢：
  // 终态在 `applyStoredLayout` 落定之前到达。
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    sessionGetDelay: { from: 2, ms: 700 },
    state: {
      [B_ROOT]: { messages: [], inFlight: false },
    },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await page.keyboard.press("Meta+Shift+A"); // 收起：切 vault 时面板不在屏幕上

  await openSwitcher(page);
  await page.locator('.vault-row[data-vault="act-b"]').click();
  // 装载窗口内（getSession 被延迟 700ms）给 B 一个终态。
  await fire(page, { type: "done", vault: B_ROOT });
  // 布局落定后（无 harness pane）未读必须保留：切换本身不是已读。
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-activity-b");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("data-activity", "reply");
  await expect(toggle(page)).toHaveAttribute("title", "对话面板 · 有新的回复");

  // 切回 A 再切回 B：未读仍在（切换不清），打开面板才清。
  await switchTo(page, "act-a", "lumir-activity-a");
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");
  await switchTo(page, "act-b", "lumir-activity-b");
  await expect(toggle(page)).toHaveAttribute("data-activity", "reply");
  await page.locator(".lumir-hp-toggle").click();
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");
});

test("目标布局有 harness pane：布局落定后随在场清算", async ({ page }) => {
  // B 的存储布局带 harness pane：切过去后面板随布局在场，未读在落定后清除。
  // 会话种子挂在**初始** fixture 上（桩的 sessions 表在 init script 里只从初始 fixture 建一次，
  // `switchTo` 副本里的 `sessions` 不会生效）。
  const aFixture: VaultFixture & { root: string } = {
    ...A_BASE,
    sessions: { "act-b": { tabs: [], active: null, harnessPane: true } },
    switchTo: { ...B_BASE },
  };
  aFixture.switchTo!.switchTo = { ...A_BASE };
  await stubTauri(page, aFixture);
  await stubRace(page, {
    state: { [B_ROOT]: { messages: [], inFlight: false } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.keyboard.press("Meta+Shift+A");
  await page.keyboard.press("Meta+Shift+A"); // 切 vault 时面板收起

  await openSwitcher(page);
  await page.locator('.vault-row[data-vault="act-b"]').click();
  await fire(page, { type: "done", vault: B_ROOT });
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-activity-b");
  // 布局落定、面板随在场 ⇒ 已读（未读被清算，钮回空闲）。
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");
});

test("cron 发起失败回滚跨 vault：只回滚 A，MUST NOT 复位 / 重取 B", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    cronReject: { at: 0, envelope: { code: "harness_busy", message: "对话正在处理中" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();

  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireCronRun: (p: unknown) => void }).__fireCronRun(payload),
    {
      origin: { kind: "cron", task: "acc-activity", run_id: "run-activity-1" },
      session_target: { kind: "interactive" },
      tool_policy: { allow: [] },
      budget: { max_rounds: 8, max_tokens: 0 },
      approval_policy: { kind: "interactive" },
      background: false,
      trigger: "manual",
      vault: A_ROOT,
      prompt: "CRON-A 这一条会失败",
      session: "new",
      session_id: null,
      model: null,
    },
  );
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("data-activity", "inflight");

  // 回滚已在途时切到 B。
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  const stateCallsBefore = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );
  const toastsBefore = await toastTexts(page);
  const readToggleMutations = await watchToggle(page);

  await release(page, "cron", "reject", null);
  // B 的快照 MUST NOT 被这次回滚重取（旧实现：reloadSession → resetView → fetchSnapshot 打在 B 上）。
  await page.waitForTimeout(300);
  const stateCallsAfter = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );
  expect(stateCallsAfter).toBe(stateCallsBefore);
  // A 的失败提示 MUST NOT 锚到 B（评审 P1-1a）：toast 集合不得新增。
  expect(await toastTexts(page)).toEqual(toastsBefore);
  // 目标非当前：MUST NOT 渲染 B 的 DOM（`renderActivity` 会写 toggle 的 data-activity / title）。
  expect(await readToggleMutations()).toBe(0);
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");

  // A 的记录回到发起前（不留在途）。
  await openSwitcher(page);
  expect(await rowMarker(page, "act-a")).toBeNull();
});

test("cron 结果通知恢复跨 vault：不打开 B 的面板、不清 B 的未读、不重取 B 的快照", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, { state: { [B_ROOT]: { messages: [], inFlight: false } } });
  // `harness_resume_session` 挂起（本用例专用）：恢复在途时切到 B。
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const original = internals.invoke;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_resume_session") {
        return new Promise((resolve) => {
          w.__pending.resume = { resolve: () => resolve({ session_token: null, messages: [] }) };
        });
      }
      return original(cmd, args);
    };
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();

  // 先在 B 造一条未读（面板收起），再切回 A：B 有未读、当前是 A。
  await page.keyboard.press("Meta+Shift+A");
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  await fire(page, { type: "done", vault: B_ROOT });
  await expect(toggle(page)).toHaveAttribute("data-activity", "reply");
  await switchTo(page, "act-a", "lumir-activity-a");
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");

  // 通知点击（目标 A，已在 A：ensureCronVault 是空切换），恢复挂起。
  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireCronOpen: (p: unknown) => void }).__fireCronOpen(payload),
    { vault: A_ROOT, session_id: "session-a-1" },
  );
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-activity-a");

  // 用户切到 B；回包这时才到（目标 A 已不是当前）。等装载真的完成（`vaultChanged` 会推进
  // 视图世代，守卫才有意义——只在浮层收起后放行会把「还在切换」误判成「仍是发起视图」）。
  await switchTo(page, "act-b", "lumir-activity-b");
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-activity-b");
  const stateCallsBefore = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );
  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__pending.resume?.resolve(null);
  });
  await page.waitForTimeout(400);

  // B 的未读 MUST NOT 被清、面板 MUST NOT 被打开、快照 MUST NOT 被重取。
  await expect(toggle(page)).toHaveAttribute("data-activity", "reply");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  const stateCallsAfter = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );
  expect(stateCallsAfter).toBe(stateCallsBefore);
});

test("cron 发起失败（未切走）：提示照常落地（守卫 MUST NOT 吞掉同一视图的失败）", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    cronReject: { at: 0, envelope: { code: "harness_busy", message: "对话正在处理中" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  const toastsBefore = await toastTexts(page);
  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireCronRun: (p: unknown) => void }).__fireCronRun(payload),
    {
      origin: { kind: "cron", task: "acc-activity", run_id: "run-activity-2" },
      session_target: { kind: "interactive" },
      tool_policy: { allow: [] },
      budget: { max_rounds: 8, max_tokens: 0 },
      approval_policy: { kind: "interactive" },
      background: false,
      trigger: "manual",
      vault: A_ROOT,
      prompt: "CRON-A 这一条会失败（未切走）",
      session: "new",
      session_id: null,
      model: null,
    },
  );
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await release(page, "cron", "reject", null);
  await expect
    .poll(async () => (await toastTexts(page)).length, { timeout: 5000 })
    .toBeGreaterThan(toastsBefore.length);
});

test("cron 忙时未 adopt（A→B→reject）：A 的失败提示不写进 B", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    holdSend: [0],
    cronReject: { at: 0, envelope: { code: "harness_busy", message: "对话正在处理中" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();

  // A 已在途（面板打开、相位 running）⇒ `beginCronRun` 忙时返回 null（不 adopt）。
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await page.locator(".lumir-hp-composer .cm-content").fill("A 的在途轮次");
  await page.locator(".lumir-hp-send").click();
  await expect(toggle(page)).toHaveAttribute("data-activity", "inflight");

  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireCronRun: (p: unknown) => void }).__fireCronRun(payload),
    {
      origin: { kind: "cron", task: "acc-activity", run_id: "run-activity-busy" },
      session_target: { kind: "interactive" },
      tool_policy: { allow: [] },
      budget: { max_rounds: 8, max_tokens: 0 },
      approval_policy: { kind: "interactive" },
      background: false,
      trigger: "manual",
      vault: A_ROOT,
      prompt: "CRON-A 忙时发起",
      session: "new",
      session_id: null,
      model: null,
    },
  );
  // 未 adopt ⇒ 请求照常发出（挂起）。切到 B 之后拒绝才回来。
  await switchTo(page, "act-b", "lumir-activity-b");
  const toastsBefore = await toastTexts(page);
  await release(page, "cron", "reject", null);
  await page.waitForTimeout(300);
  // 发起视图（A）已不是当前视图 ⇒ 提示 MUST NOT 出现（`adopted` 只决定回滚，不决定提示身份）。
  expect(await toastTexts(page)).toEqual(toastsBefore);
});

test("cron 忙时未 adopt（未切走）：提示照常落地", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    holdSend: [0],
    cronReject: { at: 0, envelope: { code: "harness_busy", message: "对话正在处理中" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").fill("A 的在途轮次");
  await page.locator(".lumir-hp-send").click();
  await expect(toggle(page)).toHaveAttribute("data-activity", "inflight");
  const toastsBefore = await toastTexts(page);
  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireCronRun: (p: unknown) => void }).__fireCronRun(payload),
    {
      origin: { kind: "cron", task: "acc-activity", run_id: "run-activity-busy-2" },
      session_target: { kind: "interactive" },
      tool_policy: { allow: [] },
      budget: { max_rounds: 8, max_tokens: 0 },
      approval_policy: { kind: "interactive" },
      background: false,
      trigger: "manual",
      vault: A_ROOT,
      prompt: "CRON-A 忙时发起（未切走）",
      session: "new",
      session_id: null,
      model: null,
    },
  );
  await release(page, "cron", "reject", null);
  await expect
    .poll(async () => (await toastTexts(page)).length, { timeout: 5000 })
    .toBeGreaterThan(toastsBefore.length);
});

test("cron 通知恢复被拒跨 vault：A 的失败提示不写进 B，也不重绘 B", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    holdResume: [0],
    state: { [B_ROOT]: { messages: [], inFlight: false } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  // 先在 B 造一条未读（面板收起），再切回 A：B 有未读、当前是 A。
  await page.keyboard.press("Meta+Shift+A");
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  await fire(page, { type: "done", vault: B_ROOT });
  await expect(toggle(page)).toHaveAttribute("data-activity", "reply");
  await switchTo(page, "act-a", "lumir-activity-a");

  // 通知点击（目标 A），恢复挂起；随后用户切到 B，回包这时才 reject。
  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireCronOpen: (p: unknown) => void }).__fireCronOpen(payload),
    { vault: A_ROOT, session_id: "session-a-reject" },
  );
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-activity-a");
  await switchTo(page, "act-b", "lumir-activity-b");
  const toastsBefore = await toastTexts(page);
  const readToggleMutations = await watchToggle(page);
  const stateCallsBefore = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );

  await release(page, "resume", "reject", { code: "harness_busy", message: "对话正在处理中" });
  await page.waitForTimeout(400);

  // A 的失败提示 MUST NOT 出现在 B（toast 集合不变）、B 的 DOM 不被重绘、快照不重取。
  expect(await toastTexts(page)).toEqual(toastsBefore);
  expect(await readToggleMutations()).toBe(0);
  const stateCallsAfter = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );
  expect(stateCallsAfter).toBe(stateCallsBefore);
  await expect(toggle(page)).toHaveAttribute("data-activity", "reply");
  await expect(page.locator(".lumir-harness")).toBeHidden();
});

test("重试拒绝跨 vault：A 不残留假在途，B 不受影响，且不强制 idle", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    retryReject: { at: 0, envelope: { code: "harness_busy", message: "对话正在处理中" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // 一轮失败（带 retry 键）→ 错误行上出现重试动作。
  await page.locator(".lumir-hp-composer .cm-content").fill("这一轮会失败");
  await page.locator(".lumir-hp-send").click();
  await fire(page, {
    type: "error",
    code: "llm_upstream",
    message: "上游炸了",
    retry: { turn: 1 },
    vault: A_ROOT,
  });
  await expect(page.locator(".lumir-hp-retry-btn")).toBeVisible();

  // 点重试（乐观 turn_started，`harness_retry` 挂起），随后切到 B，拒绝才回来。
  await page.locator(".lumir-hp-retry-btn").click();
  await expect(toggle(page)).toHaveAttribute("data-activity", "inflight");
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  const toastsBefore = await toastTexts(page);
  const stateCallsBefore = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );

  await release(page, "retry", "reject", null);
  await page.waitForTimeout(300);

  // A：乐观起点被撤销（不残留「处理中」），B：提示 / DOM / 快照都不被这次拒绝触碰。
  await openSwitcher(page);
  expect(await rowMarker(page, "act-a")).toBeNull();
  await closeSwitcher(page);
  expect(await toastTexts(page)).toEqual(toastsBefore);
  const stateCallsAfter = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );
  expect(stateCallsAfter).toBe(stateCallsBefore);
  await expect(toggle(page)).toHaveAttribute("data-activity", "idle");
});

test("重试拒绝跨 vault：期间已有真实终态 ⇒ 版本门阻止回滚（不强制 idle）", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    retryReject: { at: 0, envelope: { code: "harness_busy", message: "对话正在处理中" } },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-composer .cm-content").fill("这一轮会失败并重试");
  await page.locator(".lumir-hp-send").click();
  await fire(page, {
    type: "error",
    code: "llm_upstream",
    message: "上游炸了",
    retry: { turn: 2 },
    vault: A_ROOT,
  });
  await page.locator(".lumir-hp-retry-btn").click();
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");

  // 真实终态推进了 A 的记录（重试其实真的跑起来了并结束）——迟到的拒绝不得把它改回空闲。
  await fire(page, { type: "done", vault: A_ROOT });
  await release(page, "retry", "reject", null);
  await openSwitcher(page);
  expect(await rowMarker(page, "act-a")).toEqual({
    kind: "reply",
    title: "activity-a · 有新的回复",
  });
  await closeSwitcher(page);
});

test("会话恢复回包跨 vault（会话浮层入口）：只清 A 的记录，B 的 transcript 不被重建", async ({ page }) => {
  await stubTauri(page, A_FIXTURE);
  await stubRace(page, {
    holdResume: [0],
    sessionList: [{ session_id: "session-a-1", first_user_text: "A-OLD 历史会话提问", ts: 1759912345 }],
    state: {
      [A_ROOT]: { messages: [], inFlight: false },
      [B_ROOT]: { messages: [{ role: "assistant", text: "B-KEEP B 的既有内容" }], inFlight: false },
    },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="a-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // A 的记录先在途（重试/自动回合都行）：恢复回包迟到时它必须被复位，不得残留「处理中」。
  await fire(page, { type: "auto_turn_started", vault: A_ROOT });
  await expect(toggle(page)).toHaveAttribute("data-activity", "inflight");

  // 从会话浮层选历史会话 → 恢复挂起。
  await page.locator(".lumir-hp-session").click();
  await expect(page.locator(".lumir-hp-sesspop-history").first()).toBeVisible();
  await page.locator(".lumir-hp-sesspop-history").first().click();
  await page.waitForTimeout(100);

  // 回包在途时切到 B。
  await page.keyboard.press("Meta+Shift+A");
  await switchTo(page, "act-b", "lumir-activity-b");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-transcript")).toContainText("B-KEEP B 的既有内容");
  const stateCallsBefore = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );

  await page.evaluate(() => {
    const w = window as unknown as Record<string, any>;
    w.__release("resume", "resolve");
  });
  await page.waitForTimeout(300);

  // B 的 transcript 不被 A 的恢复内容重建；A 的记录已复位（切回 A 看行标记）。
  await expect(page.locator(".lumir-hp-transcript")).toContainText("B-KEEP B 的既有内容");
  await expect(page.locator(".lumir-hp-transcript")).not.toContainText("A-OLD 历史会话提问");
  const stateCallsAfter = await page.evaluate(
    (root) => (window as unknown as { __stateCallsFor: (r: string) => number }).__stateCallsFor(root),
    B_ROOT,
  );
  expect(stateCallsAfter).toBe(stateCallsBefore);
  await page.keyboard.press("Meta+Shift+A");
  await openSwitcher(page);
  expect(await rowMarker(page, "act-a")).toBeNull();
});
