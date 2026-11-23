import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 发送被同步拒绝时的回滚合同（spec harness「发送与写失败保留语义」/「模型选择」）：
//
//   1. **拒绝即回滚**：`harnessSend` 的 Promise reject = 这一轮**没有被后端受理**。
//      面板必须撤销本次乐观上屏的那一条 user 消息，并把输入区逐字段还原——text /
//      caret / cards（引用卡与图片卡）——会话名同时退回发送前的显示（首条消息命名的
//      乐观命名一并撤回）。撤销只针对**本次**那一条，不碰历史。
//   2. **草稿原样**：回滚到的内容与发送前那份逐字段相同，草稿 store 的「无变更不写」
//      因此不排期第二次写盘；MUST NOT 把草稿写成空。
//   3. **拒绝形态分出口**：能力闸（harness_image_unsupported）保留卡片错误态 + toast，
//      不追加错误行；忙（harness_busy）保留错误行 + 只读相位快照收口（m756）；其余同步
//      拒绝（provider_missing / api_key_missing / model_missing / thread_failed）相位本地
//      收口并给 D347 人话错误行。
//   4. **边界**：`harness_send` 已 resolve 之后的异步事件错误（`harness:event` 的
//      `error`）不属于本回滚——已受理的消息与清空后的输入区都不得被「还原」。
//   5. **视图世代**（reviewer agent-276 P1-1）：拒绝回包只对**发送时那一代视图**生效。换代
//      （新会话 / 切 vault / cron 切屏，`resetView`）之后整条 no-op——不关新轮的轮次闸门、
//      不写旧会话的错误行 / toast、不把旧输入区灌回新视图。
//   6. **迟到拒绝 + 新输入**（P1-2）：拒绝到达前用户已经打字 / 贴卡时，按 typeahead 口径合并
//      （原文在前、新输入在后，caret 按原文长度偏移，卡片原在前、当前在后），不静默丢任何一边。
//   7. **成功回执的草稿归属**（reviewer 新阻断）：按发送时定格的 (vault, **该 vault 的**编辑版本)
//      清草稿——同视图等待期间的新输入不被取消 / 删除；切走之后旧 vault 的已发送草稿仍被清
//      （切回不复活）；原 vault 发送后又编辑再切走，跨 vault 的回执也不删那份更晚的草稿；
//      别的 vault 的编辑不推进发送 vault 的版本（该清时照常清）。
//
// 判据都走可观测面：composer 的 CM 状态（doc + selection.head）、tray 卡片、transcript
// 消息条数、会话名钮、错误行文案、草稿写盘次数与载荷。

const DOC = [
  "# 拒发回滚",
  "",
  "第一段用于摘录：先读结论再读论证。",
  "",
].join("\n");

const QUOTED = "第一段用于摘录：先读结论再读论证。";

const VAULT: VaultFixture = {
  entries: [{ path: "reject-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "reject-note.md": DOC },
  links: {},
};

// 切 vault 变体（P1-1）的现场：A → B 两 vault 的往返夹具（m756 的 round-trip 同构，无回指副本
// ——init script 会 JSON.stringify，互相引用会造环）。
const SWITCH_A_ROOT = "/tmp/lumir-reject-switch-a";
const SWITCH_B_ROOT = "/tmp/lumir-reject-switch-b";
const SWITCH_REGISTRY: VaultListRow[] = [
  { id: "reject-a", path: SWITCH_A_ROOT, name: "reject-switch-a", available: true, last_opened_at: 1757000002000, tab_count: 0 },
  { id: "reject-b", path: SWITCH_B_ROOT, name: "reject-switch-b", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];
const SWITCH_A_BASE: VaultFixture & { root: string } = {
  ...VAULT,
  root: SWITCH_A_ROOT,
  vault_id: "reject-a",
  vaults: SWITCH_REGISTRY,
};
const SWITCH_B_BASE: VaultFixture & { root: string } = {
  root: SWITCH_B_ROOT,
  vault_id: "reject-b",
  entries: [{ path: "reject-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "reject-note.md": DOC },
  vaults: SWITCH_REGISTRY,
};
const SWITCH_A_FIXTURE: VaultFixture & { root: string } = {
  ...SWITCH_A_BASE,
  switchTo: { ...SWITCH_B_BASE },
};
SWITCH_A_FIXTURE.switchTo!.switchTo = { ...SWITCH_A_BASE };

interface RejectStubOptions {
  /** `harness_send` 的拒绝信封（缺省 = 成功受理）。 */
  reject?: { code: string; message: string; params?: Record<string, string> } | null;
  /** 只拒绝第 N 次 `harness_send`（0 基；缺省 = 每次）。造「A 拒绝迟到、B 已受理」的现场。 */
  rejectCall?: number;
  /** 把该次拒绝挂起到页面调用 `__releaseReject()`（造「拒绝回包迟到」的窗口）。 */
  delayReject?: boolean;
  /** 把第 N 次 `harness_send` 的**成功回执**挂起到 `__releaseSend()`（造「成功回执迟到」）。 */
  delayResolveCall?: number;
  /** `harness_state` 的 messages（缺省空会话）。 */
  messages?: Array<{ role: string; text: string }>;
}

/**
 * 桩：`harness_send` 可拒绝 / 可挂起（拒绝与成功回执都可迟到）、**草稿按 vault 分文件**记录、
 * 发送载荷与事件 handler id 可注入。草稿按 vault 分桶是「A 成功回执清 A、B 的草稿不受影响」
 * 这条判据的前提（真后端落点按 `vault_id` 解析；单文件桩会把两个 vault 混成一份）。
 */
async function stubSendReject(page: Page, options: RejectStubOptions = {}): Promise<void> {
  await page.addInitScript((opts: RejectStubOptions) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const origInvoke = internals.invoke;
    w.__draftPuts = [] as string[];
    w.__draftCalls = [] as Array<{ vaultId: string | null; draftJson: string }>;
    w.__draftFiles = {} as Record<string, string>;
    w.__sentParts = [] as string[];
    w.__harnessEventHandlerIds = [] as number[];
    w.__releaseReject = null as null | (() => void);
    w.__releaseSend = null as null | (() => void);
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_send") {
        const call = w.__sentParts.length;
        w.__sentParts.push(args.parts_json);
        const envelope = opts.reject;
        const shouldReject = envelope !== undefined && envelope !== null
          && (opts.rejectCall === undefined || opts.rejectCall === call);
        if (shouldReject && opts.delayReject === true) {
          return new Promise((_resolve, reject) => {
            w.__releaseReject = () => reject(envelope);
          });
        }
        if (shouldReject) throw envelope;
        if (opts.delayResolveCall === call) {
          return new Promise((resolve) => {
            w.__releaseSend = () => resolve(null);
          });
        }
        return null;
      }
      if (cmd === "harness_new_session") return null;
      if (cmd === "harness_draft_get") {
        return w.__draftFiles[String(args.vault_id ?? "<none>")] ?? null;
      }
      if (cmd === "harness_draft_put") {
        w.__draftPuts.push(args.draft_json);
        w.__draftCalls.push({ vaultId: args.vault_id ?? null, draftJson: args.draft_json });
        const key = String(args.vault_id ?? "<none>");
        if (args.draft_json === "") delete w.__draftFiles[key];
        else w.__draftFiles[key] = args.draft_json;
        return null;
      }
      if (cmd === "harness_state") {
        const messages = (opts.messages ?? []).map((m) => ({
          role: m.role,
          text: m.text,
          ts: 1759912345,
        }));
        // 与 Rust `StateSnapshot` 同形的零态（`pending_approval` 形态与 m455/m345 的桩一致）。
        return JSON.stringify({
          messages,
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval: null,
          warn_ctx_pct: 85,
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
  }, options);
}

interface ComposerViewState {
  doc: string;
  head: number;
}

/** composer 的 CM 状态（doc + 选区头）。CM 在 focused 时把选区同步进 DOM，但 doc/head
 *  只能从视图状态读——这是逐字段判 caret 的唯一可观测面（m831 同款通道）。 */
async function composerState(page: Page): Promise<ComposerViewState> {
  return page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const main = view.state.selection.main;
    return { doc: view.state.doc.toString(), head: main.head };
  });
}

/** 程序化选区（m831 同手法）：把 composer caret 放到指定位置。 */
async function setComposerCaret(page: Page, pos: number): Promise<void> {
  await page.evaluate((at) => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: at } });
  }, pos);
}

/** 在正文里选中引文并点浮动摘录钮：引用卡入 composer tray、面板打开（m345 链路）。
 *  选择器按编辑面板收窄：面板已在场时 transcript 侧也有一颗同名手势钮（hidden），
 *  不限定容器会撞上 strict mode。 */
async function insertQuoteCard(page: Page): Promise<void> {
  const scope = ".editor-pane:not(:has(.lumir-harness))";
  await page.evaluate(
    ({ quoted, selector }) => {
      const view = (document.querySelector(selector) as any).cmTile.root.view;
      const start = view.state.doc.toString().indexOf(quoted);
      view.focus();
      view.dispatch({ selection: { anchor: start, head: start + quoted.length } });
    },
    { quoted: QUOTED, selector: `${scope} .cm-content` },
  );
  await page.locator(`${scope} .quote-gesture-btn`).click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard:not(.lumir-hp-imgcard)")).toHaveCount(1);
}

/** 合成剪贴板图片粘贴（m440 同款；DataTransfer 只在 Chromium 构造器路径可靠）。 */
async function pasteImage(page: Page): Promise<void> {
  await page.locator(".lumir-hp-composer").evaluate((el) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "paste.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt }));
  });
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-imgcard")).toHaveCount(1);
}

/** 打开文档并展开 harness 面板（纯文本场景；引用卡场景由摘录钮自动开面板）。 */
async function openPanel(page: Page): Promise<void> {
  await page.locator('.ft-row[title="reject-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段用于摘录");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

function draftPuts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __draftPuts: string[] }).__draftPuts);
}

/** 派发一条 `harness:event`（桩记下的 handler id；与 m756 / 异步对抗同一通道）。 */
async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) => (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

/** 等挂起的拒绝就位（正观测：迟到回包的现场确实成立，而不是「没挂上」的空过）。 */
async function waitForPendingReject(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __releaseReject?: (() => void) | null }).__releaseReject
        === "function",
  );
}

/** 放行挂起的拒绝，并把页面的微任务清干（拒绝的 catch 在微任务里跑完）。 */
async function releasePendingReject(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as { __releaseReject?: (() => void) | null };
    if (typeof w.__releaseReject !== "function") throw new Error("没有挂起的拒绝可放行");
    w.__releaseReject();
    w.__releaseReject = null;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 旧代拒绝放行后的共同判据（新会话 / 切 vault 两条变体共用）：B 的相位与闸门、以及新视图的
 *  渲染面 / 输入区 / 会话名都不得被 A 的迟到拒绝污染。 */
async function expectOldRejectIgnored(page: Page, bText: string): Promise<void> {
  // ① 相位不得被 local_finish 打回空闲（B 仍在途）。
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");
  // ② 闸门未关：旧代拒绝之后到达的分片仍要上屏。
  await fire(page, { type: "text_chunk", text: "B-ANSWER-2" });
  await expect(page.locator(".lumir-hp-transcript")).toContainText("B-ANSWER-2");
  // ③ A 的错误 / toast 不得写进新视图。
  await expect(page.locator(".lumir-hp-error")).toHaveCount(0);
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
  // ④ 不恢复 A 的输入区（B 轮在途，输入区保持发送后的空态）。
  expect(await composerState(page)).toEqual({ doc: "", head: 0 });
  // ⑤ 会话名仍是 B 的首条消息（A 的乐观命名不得回退它）。
  await expect(page.locator(".lumir-hp-msg-user")).toContainText(bText);
  await expect(page.locator(".lumir-hp-sname")).toContainText(bText);
}

/** 等成功回执的挂起就位（正观测：迟到回执的现场确实成立）。 */
async function waitForPendingSend(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __releaseSend?: (() => void) | null }).__releaseSend
        === "function",
  );
}

/** 放行挂起的成功回执，并把页面微任务清干（`.then` 与它启动的 store 串行链先跑起来）。 */
async function releasePendingSend(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as { __releaseSend?: (() => void) | null };
    if (typeof w.__releaseSend !== "function") throw new Error("没有挂起的成功回执可放行");
    w.__releaseSend();
    w.__releaseSend = null;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

interface DraftCall {
  vaultId: string | null;
  draftJson: string;
}

/** 草稿写盘调用（含 vault 归属；桩按 `vault_id` 路由到不同「文件」）。 */
function draftCalls(page: Page): Promise<DraftCall[]> {
  return page.evaluate(() => (window as unknown as { __draftCalls: DraftCall[] }).__draftCalls);
}

/** 某个 vault 盘上的草稿原文（null = 文件不存在）。 */
function draftFile(page: Page, vaultId: string): Promise<string | null> {
  return page.evaluate(
    (id) => (window as unknown as { __draftFiles: Record<string, string> }).__draftFiles[id] ?? null,
    vaultId,
  );
}

/** 等草稿防抖窗口走完（1s 窗口 + 余量），返回写盘次数。 */
async function settleDraft(page: Page): Promise<number> {
  await page.waitForTimeout(1300);
  return (await draftPuts(page)).length;
}

test("provider_missing：撤销幽灵消息，富内容逐字段还原（text / 中部 caret / 引用卡 / 图片卡），草稿不重写", async ({
  page,
}) => {
  await stubTauri(page, VAULT);
  await stubSendReject(page, {
    reject: {
      code: "harness_provider_missing",
      message: "还没有可用的 provider：请在设置面板添加一个 provider（桩）",
    },
  });
  await page.goto("/");
  await page.locator('.ft-row[title="reject-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段用于摘录");
  await insertQuoteCard(page);
  await pasteImage(page);

  await page.locator(".lumir-hp-composer .cm-line").first().click();
  await page.keyboard.type("alpha-line-1");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("beta-line-2");
  // 明确的中部 caret（第 3 个字符之后）：回滚要把它一并还原。
  await setComposerCaret(page, 3);
  const before = await composerState(page);
  expect(before).toEqual({ doc: "alpha-line-1\nbeta-line-2", head: 3 });

  const putsBefore = await settleDraft(page);
  const lastDraft = (await draftPuts(page)).at(-1) ?? "";
  expect(lastDraft).not.toBe(""); // 前置：发送前的草稿确实落过盘（不是「没写等于没变」的空过）
  expect(lastDraft).toContain("alpha-line-1"); // 前置：盘上那份是发送前的完整问题（不是空壳）

  await page.keyboard.press("Enter");

  // 拒绝上屏：D695 人话（provider 缺失的文案表条目）。
  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-error")).toContainText("还没有可用的 provider");

  // ① 输入区逐字段还原：文本与中部 caret 一模一样。
  await expect.poll(() => composerState(page)).toEqual(before);
  // ② 卡片仍在 tray：引用卡 1 张、图片卡 1 张，且图片卡**没有**被标成能力闸错误态
  //    （provider_missing 是配置缺失，不是「模型不支持图片」）。
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-imgcard")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-imgcard")).not.toHaveClass(/is-error/);
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard")).toHaveCount(2);
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget .lumir-hp-qc-ex")).toHaveAttribute("data-excerpt", /第一段用于摘录/);

  // ③ 幽灵消息不存在：transcript 没有留下一条「看起来发出去了」的用户气泡。
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  // ④ 会话名回退：首条消息的乐观命名被撤回（仍显示「新会话」）。
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");
  // ⑤ 相位本地收口：送钮回到「发送」。
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");
  // ⑥ 焦点回输入区（可以立刻重发 / 继续编辑）。
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();

  // ⑦ 草稿不重写、更不写成空：内容与发送前逐字段相同 ⇒「无变更不写」。
  expect(await settleDraft(page)).toBe(putsBefore);
  expect((await draftPuts(page)).at(-1)).toBe(lastDraft);
  expect(await draftPuts(page)).not.toContain("");
});

/** 文本路径的同步拒绝共用判据：撤销 + 还原 + 相位收口 + 人话错误行。 */
async function textOnlyRejectCase(
  page: Page,
  reject: { code: string; message: string; params?: Record<string, string> },
  expectedError: string,
): Promise<void> {
  await stubTauri(page, VAULT);
  await stubSendReject(page, { reject });
  await page.goto("/");
  await openPanel(page);

  const text = `${reject.code} 也要把这句话留住`;
  await page.locator(".lumir-hp-composer .cm-content").fill(text);
  const before = await composerState(page);
  expect(before).toEqual({ doc: text, head: text.length });

  await page.keyboard.press("Enter");

  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-error")).toContainText(expectedError);
  await expect.poll(() => composerState(page)).toEqual(before);
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");
}

test("provider 缺 Key（harness_api_key_missing）：撤销幽灵消息并还原输入区", async ({ page }) => {
  await textOnlyRejectCase(
    page,
    { code: "harness_api_key_missing", message: "api_key 未配置（桩）", params: { provider: "kimi" } },
    "api_key 未配置",
  );
});

test("provider 缺模型（harness_model_missing）：撤销幽灵消息并还原输入区", async ({ page }) => {
  await textOnlyRejectCase(
    page,
    { code: "harness_model_missing", message: "模型清单为空（桩）", params: { provider: "kimi" } },
    "未配置任何模型",
  );
});

test("harness_thread_failed：撤销幽灵消息、还原输入区、错误行为 D363 人话", async ({ page }) => {
  await textOnlyRejectCase(
    page,
    { code: "harness_thread_failed", message: "无法启动对话线程：桩", params: { reason: "桩" } },
    "无法启动对话线程",
  );
});

test("成功受理后的异步 error 事件不回滚：消息保留、输入区保持空", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubSendReject(page);
  await page.goto("/");
  await openPanel(page);

  await page.locator(".lumir-hp-composer .cm-content").fill("这条会被受理");
  await page.keyboard.press("Enter");

  // 受理成功的三个面：乐观消息上屏、输入区清空、草稿被清除（put ""）。
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await expect.poll(() => composerState(page)).toEqual({ doc: "", head: 0 });
  await expect.poll(async () => (await draftPuts(page)).at(-1)).toBe("");

  // 轮次在途时后端发 error 事件：它是**已受理**这一轮的终态，不是同步拒绝。
  await page.evaluate(
    (payload) =>
      (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(payload),
    { type: "error", code: "llm_upstream", message: "上游炸了" },
  );

  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "发送");
  // 已受理的消息不属于任何回滚：它必须留在 transcript；输入区不得被「还原」成发送前内容。
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-msg-user")).toContainText("这条会被受理");
  expect(await composerState(page)).toEqual({ doc: "", head: 0 });
  expect(await draftPuts(page)).not.toContain("这条会被受理");
});

// ── P1-1（reviewer agent-276）：视图换代后的迟到拒绝整条 no-op ──────────────────
//
// 现场：A 的发送拒绝回包迟到，期间用户新建会话（或切 vault）并发出 B（B 已受理）。旧实现只有
// `transcript.contains(optimistic)` 一道守卫——A 的气泡确实随换代没了，但 catch 的其余动作照样
// 执行：`local_finish` 把 B 的轮次闸门（turnOpen）关掉（B 后续 text_chunk 被当迟到产出丢弃）、
// `appendError` 把 A 的错误写进新视图、能力闸路径还会弹 A 的 toast。修复后按发送时定格的
// `viewGeneration` 守卫：旧代整条 return，不改相位、不写错误、不动输入区。
test("视图换代后的迟到拒绝：不关 B 的闸门、不丢 B 的分片、不污染新视图", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubSendReject(page, {
    reject: { code: "harness_provider_missing", message: "迟到的拒绝（桩）" },
    rejectCall: 0, // 只有 A 被拒；B 直接受理
    delayReject: true, // A 的拒绝挂起到显式放行
  });
  await page.goto("/");
  await openPanel(page);

  // A：发送（拒绝被挂起）。
  await page.locator(".lumir-hp-composer .cm-content").fill("A-OLD 上一段会话的问题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await waitForPendingReject(page);

  // 视图换代：新建会话（resetView；切 vault 走同一入口）。
  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-msg")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");

  // B：同面板发出并受理。
  await page.locator(".lumir-hp-composer .cm-content").fill("B-NEW 新会话的问题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");

  // B 的第一片正文：旧代拒绝到达之前在屏。
  await fire(page, { type: "text_chunk", text: "B-ANSWER-1 " });
  await expect(page.locator(".lumir-hp-transcript")).toContainText("B-ANSWER-1");

  // 放行 A 的拒绝（旧代回包落地）。
  await releasePendingReject(page);
  await expectOldRejectIgnored(page, "B-NEW");
});

// 切 vault 变体：换代入口是 `vaultChanged` → `resetView`（与新会话同一个世代推进点），
// 但多了 composer 复位与草稿重装载——旧代回包同样不得打到新 vault 的视图上。
test("视图换代（切 vault）后的迟到拒绝：同样整条 no-op", async ({ page }) => {
  await stubTauri(page, SWITCH_A_FIXTURE);
  await stubSendReject(page, {
    reject: { code: "harness_provider_missing", message: "迟到的拒绝（桩）" },
    rejectCall: 0,
    delayReject: true,
  });
  await page.goto("/");
  await openPanel(page);

  // A：在 vault A 发送（拒绝被挂起）。
  await page.locator(".lumir-hp-composer .cm-content").fill("A-OLD 切走之前的问题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await waitForPendingReject(page);

  // 收起面板 → 切到 vault B（vaultChanged → resetView：世代推进）→ 再打开。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(1).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-b");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-msg")).toHaveCount(0);

  // B：在 vault B 发出并受理。
  await page.locator(".lumir-hp-composer .cm-content").fill("B-NEW 新 vault 的问题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-send")).toHaveAttribute("aria-label", "停止");
  await fire(page, { type: "text_chunk", text: "B-ANSWER-1 " });
  await expect(page.locator(".lumir-hp-transcript")).toContainText("B-ANSWER-1");

  // 放行 A 的拒绝：旧代回包落到新 vault 的视图上。
  await releasePendingReject(page);
  await expectOldRejectIgnored(page, "B-NEW");
});

// ── P1-2（reviewer agent-276）：拒绝迟到 + 期间已有新输入 ⇒ typeahead 合并 ──────
//
// 现场：发送后 composer 立刻清空并保持可编辑；拒绝回包到达前用户已经贴了一张图、打了一段新
// 文本。旧实现 `resetComposer(content)` 整份覆盖，新输入被静默删掉。修复后按
// `mergeRejectedComposerContent` 合并：原文在前、新输入在后，caret 按原文长度偏移，卡片原在前、
// 当前在后；合并后 markDraft，盘上草稿载荷是**双方都在**的那一份。
test("拒绝迟到 + 期间新输入：合并保留文本 / 卡片 / caret，草稿载荷含两段", async ({ page }) => {
  const RESTORED = "AAA 原文";
  const TYPED = "BBB 新输入";
  await stubTauri(page, VAULT);
  await stubSendReject(page, {
    reject: { code: "harness_provider_missing", message: "迟到的拒绝（桩）" },
    rejectCall: 0,
    delayReject: true,
  });
  await page.goto("/");
  await openPanel(page);
  await insertQuoteCard(page); // 原文自带一张引用卡（合并顺序的另一半）

  await page.locator(".lumir-hp-composer .cm-line").first().click();
  await page.keyboard.type(RESTORED);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await waitForPendingReject(page);

  // 等待期间：贴一张图片卡 → 打一段新文本 → caret 放到新文本第 2 位。
  await pasteImage(page);
  await page.locator(".lumir-hp-composer .cm-line").first().click();
  await page.keyboard.type(TYPED);
  await setComposerCaret(page, 2);
  expect(await composerState(page)).toEqual({ doc: TYPED, head: 2 });

  await releasePendingReject(page);

  const merged = RESTORED + TYPED;
  await expect.poll(() => composerState(page)).toEqual({ doc: merged, head: RESTORED.length + 2 });
  // 卡片两边都在且顺序确定：原引用卡在前、等待期间贴的图片卡在后。
  const cards = page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).not.toHaveClass(/lumir-hp-imgcard/);
  await expect(cards.nth(1)).toHaveClass(/lumir-hp-imgcard/);
  // 幽灵消息仍被撤销；错误行是同代拒绝的正常出口。
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-error")).toContainText("还没有可用的 provider");
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");

  // 草稿载荷（合并后 markDraft 重算）：text / caret / 两张卡逐项都是合并结果。
  await page.waitForTimeout(1400);
  const draft = await page.evaluate(() => {
    const puts = (window as unknown as { __draftPuts: string[] }).__draftPuts;
    if (puts.length === 0) throw new Error("没有任何草稿写盘");
    return JSON.parse(puts[puts.length - 1]);
  });
  expect(draft.text).toBe(merged);
  expect(draft.caret).toBe(RESTORED.length + 2);
  expect(draft.cards.map((placed: { card: { kind: string } }) => placed.card.kind)).toEqual(["quote", "image"]);
});

// ── 成功回执的草稿归属（reviewer 新阻断）：按发送时 vault + 编辑版本清，不靠视图世代 ──
//
// 旧实现 `.then` 里「同代才 draft.clear()」两头都错：
//   - 同代 + 等待期间用户又输入了 B：`clear()` 取消 B 的待写、把 written 置空、串行删除草稿
//     文件——B 的输入只剩内存，崩一次就丢；
//   - 异代（切了 vault）：直接 return，A 已发送内容的草稿永远留在盘上，切回 A 会复活已发送文本。
//
// 修复后 `.then` **无条件**按发送时定格的 `(vaultId, editVersion)` 调 `draft.clearSent`：
// 同 vault 且版本未变 ⇒ 清；同 vault 但版本已变（有新编辑，哪怕重打相同文本）⇒ 保留；
// 目标 vault 不是当前 bound ⇒ 只把空值删除按显式原 vaultId 排进串行链，不动当前 store 状态。
test("同视图：成功回执迟到 + 期间新输入，B 的草稿不被取消 / 删除、flush 仍可写", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubSendReject(page, { delayResolveCall: 0 });
  await page.goto("/");
  await openPanel(page);

  // A：先让草稿落盘，再发送（成功回执被挂起）。
  await page.locator(".lumir-hp-composer .cm-content").fill("A-SENT 已发送");
  await page.waitForTimeout(1400);
  expect(await draftFile(page, "fixture-vault")).toContain("A-SENT");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await waitForPendingSend(page);

  // 等待期间：贴图 + 新文本 + 中部 caret（B 的输入与草稿）。
  await pasteImage(page);
  await page.locator(".lumir-hp-composer .cm-line").first().click();
  await page.keyboard.type("B-DRAFT 发送后的新输入");
  await setComposerCaret(page, 2);
  const before = await composerState(page);
  await page.waitForTimeout(1400);
  expect(await draftFile(page, "fixture-vault")).toContain("B-DRAFT");

  // 放行 A 的成功回执：B 的草稿不得被取消 / 删除。
  await releasePendingSend(page);
  await page.waitForTimeout(300);
  const calls = await draftCalls(page);
  expect(calls.filter((call) => call.draftJson === "").length).toBe(0);
  expect(await draftFile(page, "fixture-vault")).toContain("B-DRAFT");
  expect(await composerState(page)).toEqual(before);
  // flush 仍可写：继续编辑，防抖到点把新内容落到盘上。
  await page.keyboard.type("!");
  await page.waitForTimeout(1400);
  const after = await draftCalls(page);
  expect(after.at(-1)!.draftJson).toContain("!");
});

test("切 vault 后 A 的成功回执：A 的草稿被清、B 的草稿不变，切回 A 不复活", async ({ page }) => {
  await stubTauri(page, SWITCH_A_FIXTURE);
  await stubSendReject(page, { delayResolveCall: 0 });
  await page.goto("/");
  await openPanel(page);

  // A：草稿落盘 → 发送（回执挂起）。
  await page.locator(".lumir-hp-composer .cm-content").fill("A-SENT 旧 vault 已发送");
  await page.waitForTimeout(1400);
  expect(await draftFile(page, "reject-a")).toContain("A-SENT");
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await waitForPendingSend(page);

  // 切到 vault B，在 B 里留一份草稿。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(1).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-b");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await page.locator(".lumir-hp-composer .cm-content").fill("B-DRAFT 新 vault 的草稿");
  await page.waitForTimeout(1400);
  expect(await draftFile(page, "reject-b")).toContain("B-DRAFT");

  // 放行 A 的成功回执（当前 bound 是 B）：A 的草稿按显式原 vaultId 删除，B 不动。
  await releasePendingSend(page);
  await expect
    .poll(async () => (await draftCalls(page)).some((call) => call.vaultId === "reject-a" && call.draftJson === ""))
    .toBe(true);
  expect(await draftFile(page, "reject-a")).toBeNull();
  expect(await draftFile(page, "reject-b")).toContain("B-DRAFT");

  // 切回 A：已发送内容不复活（输入区空、盘上无草稿）。
  await page.keyboard.press("Meta+Shift+A");
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(0).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-a");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  expect(await composerState(page)).toEqual({ doc: "", head: 0 });
  expect(await draftFile(page, "reject-a")).toBeNull();
});

test("切回 A 后的新编辑不被旧回执删除（编辑版本判据；重打相同文本也算新编辑）", async ({ page }) => {
  await stubTauri(page, SWITCH_A_FIXTURE);
  await stubSendReject(page, { delayResolveCall: 0 });
  await page.goto("/");
  await openPanel(page);

  await page.locator(".lumir-hp-composer .cm-content").fill("A-SENT 第一次发送");
  await page.waitForTimeout(1400);
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);
  await waitForPendingSend(page);

  // A → B → A：旧回执还没到。
  await page.keyboard.press("Meta+Shift+A");
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(1).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-b");
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(0).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-a");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();

  // 切回后重新编辑：文本与已发送内容**逐字相同**（文本比较会误判成「没变」），caret 移到中部。
  await page.locator(".lumir-hp-composer .cm-content").fill("A-SENT 第一次发送");
  await setComposerCaret(page, 2);
  const before = await composerState(page);
  await page.waitForTimeout(1400);
  expect(await draftFile(page, "reject-a")).toContain("A-SENT");

  // 放行旧回执：同 vault 但编辑版本已变 ⇒ 新草稿必须保留（不删文件、不写空载荷）。
  await releasePendingSend(page);
  await page.waitForTimeout(300);
  expect((await draftCalls(page)).filter((call) => call.vaultId === "reject-a" && call.draftJson === "").length).toBe(0);
  expect(await draftFile(page, "reject-a")).toContain("A-SENT");
  expect(await composerState(page)).toEqual(before);
});

// ── per-vault 编辑版本（reviewer 第三轮）：两条残留边界 ────────────────────────────
//
// 全局 editGeneration 当归属判据有两个反向错误：
//   ① A 发送后在 **A 内**继续编辑、再切到 C：回执到达时目标不是当前 bound，旧实现无条件
//      删除——把 A 里那份更晚的草稿删掉；
//   ② 在 B 里编辑推进了**全局**版本，切回 A（A 没新编辑）后回执把 A 的已发送草稿当成
//      「发送后编辑过」保留下来，该清不清。
// 修复后每个 vault（含 null）各有一份编辑版本：`editVersion()` 只读当前 bound 的版本，
// `clearSent` 先比**目标 vault** 的版本——不等就跳过（跨 vault 亦然）；相等才按 binding
// 分「走 clear」/「只删目标文件」。
test("原 vault 内发送后继续编辑再切走：迟到成功回执不得删除这份草稿", async ({ page }) => {
  await stubTauri(page, SWITCH_A_FIXTURE);
  await stubSendReject(page, { delayResolveCall: 0 });
  await page.goto("/");
  await openPanel(page);

  // A 发送（回执挂起）。
  await page.locator(".lumir-hp-composer .cm-content").fill("A-SENT 已发送");
  await page.waitForTimeout(1400);
  await page.keyboard.press("Enter");
  await waitForPendingSend(page);

  // 发送后在 A 继续编辑（新文本 + 中部 caret），落盘后切到另一个 vault。
  await page.locator(".lumir-hp-composer .cm-line").first().click();
  await page.keyboard.type("A-NEW 发送后的编辑");
  await setComposerCaret(page, 2);
  const edited = await composerState(page);
  await page.waitForTimeout(1400);
  expect(await draftFile(page, "reject-a")).toContain("A-NEW");

  await page.keyboard.press("Meta+Shift+A");
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(1).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-b");

  // 放行 A 的回执：目标 vault 的版本已变 ⇒ 跨 vault 也跳过，A 的草稿原样。
  await releasePendingSend(page);
  await page.waitForTimeout(300);
  expect(
    (await draftCalls(page)).filter((call) => call.vaultId === "reject-a" && call.draftJson === "").length,
  ).toBe(0);
  expect(await draftFile(page, "reject-a")).toContain("A-NEW");

  // 切回 A：这份「发送后的编辑」应被恢复（不是已发送内容，清掉才是错的）。
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(0).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-a");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  expect(await composerState(page)).toEqual(edited);
});

test("其他 vault 的编辑不推进发送 vault 的版本：切回 A 后旧回执照常清", async ({ page }) => {
  await stubTauri(page, SWITCH_A_FIXTURE);
  await stubSendReject(page, { delayResolveCall: 0 });
  await page.goto("/");
  await openPanel(page);

  await page.locator(".lumir-hp-composer .cm-content").fill("A-SENT 待清");
  await page.waitForTimeout(1400);
  expect(await draftFile(page, "reject-a")).toContain("A-SENT");
  await page.keyboard.press("Enter");
  await waitForPendingSend(page);

  // 切到 B 并编辑（只推进 B 的版本），再切回 A（A 没有新编辑）。
  await page.keyboard.press("Meta+Shift+A");
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(1).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-b");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await page.locator(".lumir-hp-composer .cm-content").fill("B-DRAFT 别的 vault 的编辑");
  await page.waitForTimeout(1400);

  await page.keyboard.press("Meta+Shift+A");
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(0).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-reject-switch-a");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 前置：切回时尚未清，restoreDraft 把「已发送但回执未到」的草稿铺回 composer。
  expect(await composerState(page)).toEqual({ doc: "A-SENT 待清", head: "A-SENT 待清".length });

  // 放行 A 的回执：A 的版本仍是发送时的版本（B 的编辑不算）⇒ 正常清。
  await releasePendingSend(page);
  await expect
    .poll(async () => (await draftCalls(page)).some((call) => call.vaultId === "reject-a" && call.draftJson === ""))
    .toBe(true);
  expect(await draftFile(page, "reject-a")).toBeNull();
});
