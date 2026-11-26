import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";
import { standardProviders } from "./provider-config";

// 会话切换保留 composer（change preserve-composer-across-sessions-nov26，Alex 2026-11-26「采纳」）：
//
//   新建会话 / 选择历史会话 / 会话重载只切换消息列表：composer 的文字、引用卡 / 图片卡、
//   Skill 引用、光标与撤销历史原样保留；下一次发送进入当前选中会话；盘上草稿只在发送成功或
//   用户手动删除时清除；切 vault 仍按 vault 恢复各自的草稿。
//
// 判据走可观测面：composer 的 CM 状态（doc + selection.head）、卡片 / Skill 的 DOM 投影、
// transcript 消息、草稿写盘载荷与桩里的草稿文件。先红后绿：本文件在未修复实现上应判红
// （失败断言见 change 的 tasks 1.3 证据）。

const ROOT = "/tmp/lumir-composer-preserve";
const VAULT_ID = "preserve-vault";
const DOC = "# Composer 保留\n\n第一段用于摘录：先读结论再读论证。\n";
const QUOTED = "第一段用于摘录：先读结论再读论证。";
const VAULT: VaultFixture = {
  entries: [{ path: "preserve-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "preserve-note.md": DOC },
  links: {},
  root: ROOT,
  vault_id: VAULT_ID,
};

const SKILLS = [
  {
    name: "acc-skill-abc",
    description: "默认",
    source: "vault",
    user_invocable: true,
    model_invocable: true,
    invocation_valid: true,
  },
];

const PREVIOUS_MESSAGES = [{ role: "user", text: "PREVIOUS-SESSION 上一段会话的问题" }];
const RESTORED_MESSAGES = [{ role: "assistant", text: "RESTORED-SESSION-MESSAGE 恢复出来的会话内容" }];

function draftJson(text: string, caret: number): string {
  return JSON.stringify({ version: 3, text, caret, cards: [], skills: [] });
}

interface PreserveOptions {
  /** `harness_state` 的初始 messages（缺省空会话）。 */
  messages?: Array<{ role: string; text: string }>;
  /** `harness_resume_session` 返回的 messages（会被铺进 transcript）。 */
  resumeMessages?: Array<{ role: string; text: string }>;
  /** 非空 = `harness_new_session` 按这份信封 reject。 */
  rejectNewSession?: { code: string; message: string };
  /** 把首次 `harness_draft_get` 挂起到页面调 `__releaseDraftGet()`（造「读回在途」窗口）。 */
  holdDraftGet?: boolean;
  /** 盘上初值草稿（按 vault id 落进桩的文件表）。 */
  initialDraft?: string;
  /** `harness_list_sessions` 的清单（会话浮层历史行）。 */
  sessionList?: unknown[];
  /** 换一份 vault fixture（切 vault 场景）。 */
  vault?: VaultFixture;
  /** 切 vault 场景里初值草稿的落点（缺省 = fixture 的 vault_id）。 */
  draftVaultId?: string;
}

/**
 * 桩：在 `stubTauri` 之上补 harness 会话 / 草稿 / Skill 路由。草稿按 `vault_id` 分文件，
 * 与真后端「草稿按 vault 稳定 id 编址」同构；`harness_draft_put("")` 视作删除（后端契约）。
 * `harness_new_session` 成功后 `harness_state` 切到空会话——transcript 清空不靠桩冒充。
 */
async function setup(page: Page, options: PreserveOptions = {}): Promise<void> {
  const vault = options.vault ?? VAULT;
  await stubTauri(page, vault);
  await page.addInitScript(
    ({ providers, opts }) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const origInvoke = internals.invoke;
      w.__draftPuts = [] as string[];
      w.__draftFiles = {} as Record<string, string>;
      w.__sent = [] as string[];
      w.__resumeCalls = 0;
      w.__newSessionCalls = 0;
      w.__draftGetCalls = 0;
      w.__draftRelease = null as null | (() => void);
      w.__harnessEventIds = [] as number[];
      w.__cronOpenIds = [] as number[];
      const draftKey = opts.draftVaultId ?? opts.vaultId;
      if (typeof opts.initialDraft === "string") w.__draftFiles[draftKey] = opts.initialDraft;
      let messages = opts.messages ?? [];
      internals.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_send") {
          w.__sent.push(args.parts_json ?? "");
          return null;
        }
        if (cmd === "harness_new_session") {
          w.__newSessionCalls += 1;
          if (opts.rejectNewSession) throw opts.rejectNewSession;
          messages = [];
          return null;
        }
        if (cmd === "harness_skills_list") return opts.skills ?? [];
        if (cmd === "harness_list_sessions") return opts.sessionList ?? [];
        if (cmd === "harness_resume_session") {
          w.__resumeCalls += 1;
          messages = opts.resumeMessages ?? [];
          return { session_token: null, messages, switched: true };
        }
        if (cmd === "harness_draft_get") {
          w.__draftGetCalls += 1;
          const key = String(args.vault_id ?? "<none>");
          if (opts.holdDraftGet === true && w.__draftRelease === null) {
            // 读回在途 = **请求发出时**的那一份快照：之后盘上被清除（旧实现的新会话
            // `draft.clear()`）也改变不了这次应答，才判得出「迟到的读回会覆盖输入区」。
            const snapshot = w.__draftFiles[key] ?? null;
            return new Promise((resolve) => {
              w.__draftRelease = () => resolve(snapshot);
            });
          }
          return w.__draftFiles[key] ?? null;
        }
        if (cmd === "harness_draft_put") {
          w.__draftPuts.push(args.draft_json);
          const key = String(args.vault_id ?? "<none>");
          if (args.draft_json === "") delete w.__draftFiles[key];
          else w.__draftFiles[key] = args.draft_json;
          return null;
        }
        if (cmd === "harness_state") {
          return JSON.stringify({
            messages: messages.map((m) => ({ role: m.role, text: m.text, ts: 1759912345 })),
            usage: { ctx_pct: 0, cache_pct_session: 0 },
            pending_approval: null,
            pending_approvals: [],
            in_flight: false,
            warn_ctx_pct: 85,
          });
        }
        if (cmd === "plugin:event|listen" && args.event === "harness:event") {
          w.__harnessEventIds.push(args.handler ?? 0);
        }
        if (cmd === "plugin:event|listen" && args.event === "cron:open_session") {
          w.__cronOpenIds.push(args.handler ?? 0);
        }
        const result = await origInvoke(cmd, args);
        if (cmd === "config_get" && result?.config) {
          result.config.harness = {
            provider: "mock",
            providers,
            permissions: { allow: [], deny: [] },
            loop_max: 8,
            warn_ctx_pct: 85,
            auto_compact: true,
          };
        }
        return result;
      };
      w.__fireCronOpen = (payload: unknown) => {
        for (const id of w.__cronOpenIds) {
          internals.runCallback(id, { event: "cron:open_session", id, payload });
        }
      };
      w.__releaseDraftGet = async () => {
        const release = w.__draftRelease as null | (() => void);
        if (release === null) throw new Error("没有挂起的草稿读回");
        w.__draftRelease = null;
        release();
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
    },
    {
      providers: standardProviders(),
      opts: {
        ...options,
        skills: SKILLS,
        vaultId: vault.vault_id ?? VAULT_ID,
      },
    },
  );
  await page.goto("/");
  await page.locator('.ft-row[title="preserve-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段用于摘录");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeVisible();
}

interface ComposerViewState {
  doc: string;
  head: number;
}

async function composerState(page: Page): Promise<ComposerViewState> {
  return page.evaluate(() => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    const main = view.state.selection.main;
    return { doc: view.state.doc.toString(), head: main.head };
  });
}

async function setComposerCaret(page: Page, pos: number): Promise<void> {
  await page.evaluate((at) => {
    const view = (document.querySelector(".lumir-hp-composer .cm-content") as any).cmTile.root.view;
    view.focus();
    view.dispatch({ selection: { anchor: at } });
  }, pos);
}

/** 在正文里选中引文并点浮动摘录钮：引用卡入 composer（m345 / m831 同一链路）。 */
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
  await expect(
    page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard:not(.lumir-hp-imgcard)"),
  ).toHaveCount(1);
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

/** 输入 `/acc` 并接受唯一候选：Skill 引用进入 composer。 */
async function insertSkillRef(page: Page): Promise<void> {
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("/acc");
  await expect(page.locator(".lumir-hp-skill-menu")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-skill-ref")).toHaveCount(1);
}

function draftPuts(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __draftPuts: string[] }).__draftPuts);
}

function sent(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __sent: string[] }).__sent);
}

function draftFile(page: Page, vaultId: string): Promise<string | null> {
  return page.evaluate(
    (id) => (window as unknown as { __draftFiles: Record<string, string> }).__draftFiles[id] ?? null,
    vaultId,
  );
}

async function fireCronOpen(page: Page): Promise<void> {
  await page.evaluate(
    (payload) => (window as unknown as { __fireCronOpen: (p: unknown) => void }).__fireCronOpen(payload),
    { vault: ROOT, session_id: "s-restored" },
  );
}

// ── 新建会话：纯文本 + caret ───────────────────────────────────────────────

test("新建会话保留纯文本与 caret：只清 transcript，输入区逐字段不变", async ({ page }) => {
  await setup(page, { messages: PREVIOUS_MESSAGES });
  await expect(page.locator(".lumir-hp-msg-user")).toHaveCount(1);

  const composer = page.locator(".lumir-hp-composer .cm-content");
  await composer.click();
  await page.keyboard.type("FIRST-LINE-ALPHA");
  // 隔开 CM history 聚簇窗口（newGroupDelay 500ms）：撤销一次只回退第二段。
  await page.waitForTimeout(650);
  await page.keyboard.type("SECOND-LINE-BETA");
  await setComposerCaret(page, 9);
  const before = await composerState(page);
  expect(before).toEqual({ doc: "FIRST-LINE-ALPHASECOND-LINE-BETA", head: 9 });

  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");
  // 消息列表确实切换（transcript 清空）——否则「保留」可能只是没切会话。
  await expect(page.locator(".lumir-hp-msg")).toHaveCount(0);
  expect(await composerState(page)).toEqual(before);
});

// ── 新建会话：卡片 / Skill / 撤销历史 ──────────────────────────────────────

test("新建会话保留引用卡 / 图片卡 / Skill，撤销历史仍可撤销", async ({ page }) => {
  await setup(page, { messages: PREVIOUS_MESSAGES });
  await insertQuoteCard(page);
  await pasteImage(page);
  await insertSkillRef(page);
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("FIRST-LINE-ALPHA");
  await page.waitForTimeout(650);
  await page.keyboard.type("SECOND-LINE-BETA");
  const before = await composerState(page);
  expect(before.doc).toContain("acc-skill-abc");
  expect(before.doc.endsWith("FIRST-LINE-ALPHASECOND-LINE-BETA")).toBe(true);

  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-msg")).toHaveCount(0);

  // 卡片与 Skill 的投影原样在场；文本逐字节不变。
  await expect(
    page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-qcard:not(.lumir-hp-imgcard)"),
  ).toHaveCount(1);
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-imgcard")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-skill-ref")).toHaveCount(1);
  expect((await composerState(page)).doc).toBe(before.doc);

  // 撤销历史没有被换掉：⌘Z 只回退第二段键入。焦点必须真的在 composer 里——点 `.cm-content`
  // 可能落在卡片 widget 上（引用卡的 click 是跳转，不给输入区焦点）。
  await setComposerCaret(page, 0);
  await page.keyboard.press("Meta+z");
  await expect.poll(async () => (await composerState(page)).doc.endsWith("FIRST-LINE-ALPHA")).toBe(true);
  expect((await composerState(page)).doc).not.toContain("SECOND-LINE-BETA");
  // 撤销只动文本：卡片与 Skill 仍在。
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-skill-ref")).toHaveCount(1);
  await expect(page.locator(".lumir-hp-composer .cm-content .lumir-hp-cwidget > .lumir-hp-imgcard")).toHaveCount(1);
});

// ── 新建会话：取消发送意图，但不清内容 ──────────────────────────────────────

test("新会话取消延迟发送意图（pendingSend）但保留内容", async ({ page }) => {
  await setup(page);
  const composer = page.locator(".lumir-hp-composer .cm-content");
  await composer.click();
  await page.keyboard.type("PENDING-KEEP-TEXT");
  // 组合期点发送钮：`send()` 把发送意图记成 pendingSend（延迟到组合结束），不投递。
  await page.evaluate(() => {
    const el = document.querySelector(".lumir-hp-composer .cm-content");
    el?.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  });
  await page.locator(".lumir-hp-send").click();
  expect(await sent(page)).toEqual([]);

  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");

  // 组合结束：旧视图的延迟发送已被新会话取消（composerIme.reset），MUST NOT 投递；
  // 输入区内容仍保留（取消的是发送意图，不是内容）。
  await page.evaluate(() => {
    const el = document.querySelector(".lumir-hp-composer .cm-content");
    el?.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  expect(await sent(page)).toEqual([]);
  expect((await composerState(page)).doc).toBe("PENDING-KEEP-TEXT");
});

// ── 新建会话：草稿不被清除 ────────────────────────────────────────────────

test("新建会话不清盘上草稿：不出现空载荷，盘上仍是发送前的内容", async ({ page }) => {
  await setup(page);
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("DRAFT-KEEP-ALPHA");
  // 等防抖窗口落盘（1s + 余量），先证明这条链路是活的。
  await page.waitForTimeout(1400);
  expect(await draftFile(page, VAULT_ID)).toContain("DRAFT-KEEP-ALPHA");
  const putsBefore = await draftPuts(page);
  expect(putsBefore.length).toBeGreaterThan(0);

  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");
  await page.waitForTimeout(200);

  // 旧实现：draft.clear() 会 putDraft("")（删除盘上草稿）。
  expect(await draftPuts(page)).toEqual(putsBefore);
  expect(await draftPuts(page)).not.toContain("");
  expect(await draftFile(page, VAULT_ID)).toContain("DRAFT-KEEP-ALPHA");
  expect((await composerState(page)).doc).toBe("DRAFT-KEEP-ALPHA");
});

// ── 会话重载（reloadTargetSession）：保留输入区 ───────────────────────────

test("会话重载（cron 打开会话通知）保留输入区，transcript 按恢复内容重建", async ({ page }) => {
  await setup(page, { messages: PREVIOUS_MESSAGES, resumeMessages: RESTORED_MESSAGES });
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("RELOAD-KEEP-TEXT");
  await setComposerCaret(page, 4);
  const before = await composerState(page);

  await fireCronOpen(page);
  await expect(page.locator(".lumir-hp-transcript")).toContainText("RESTORED-SESSION-MESSAGE");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __resumeCalls: number }).__resumeCalls)).toBe(1);
  expect(await composerState(page)).toEqual(before);
});

// ── 选择历史会话：保留输入区（防「把清空搬进 resetView」的回归） ────────────

test("选择历史会话保留输入区：只切换消息列表与会话名", async ({ page }) => {
  await setup(page, {
    sessionList: [{ session_id: "s-old", first_user_text: "OLD-SESSION 旧会话", ts: 1759912345 }],
    resumeMessages: RESTORED_MESSAGES,
  });
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("PICKER-KEEP-TEXT");
  const before = await composerState(page);

  await page.locator(".lumir-hp-session").click();
  await expect(page.locator(".lumir-hp-sesspop-history").first()).toBeVisible();
  await page.locator(".lumir-hp-sesspop-history").first().click();
  await expect(page.locator(".lumir-hp-transcript")).toContainText("RESTORED-SESSION-MESSAGE");
  expect(await composerState(page)).toEqual(before);
});

// ── 失败回包：不清输入区（守卫：防修复时把清空提前） ──────────────────────

test("新建会话回包被拒绝：只追加错误行，输入区与草稿不变", async ({ page }) => {
  await setup(page, {
    rejectNewSession: { code: "harness_new_session_failed", message: "新会话失败（桩）" },
  });
  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("REJECT-KEEP-TEXT");
  await setComposerCaret(page, 3);
  const before = await composerState(page);

  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-error")).toHaveCount(1);
  expect(await composerState(page)).toEqual(before);
  expect(await draftPuts(page)).not.toContain("");
});

// ── 在途草稿恢复：不得覆盖会话切换后的输入区 ──────────────────────────────

test("正向对照：挂起的草稿读回放行后确实铺进输入区（链路是活的）", async ({ page }) => {
  await setup(page, { holdDraftGet: true, initialDraft: draftJson("DISK-DRAFT-ALPHA", 16) });
  expect((await composerState(page)).doc).toBe("");

  await page.evaluate(() => (window as unknown as { __releaseDraftGet: () => Promise<void> }).__releaseDraftGet());
  await expect.poll(async () => (await composerState(page)).doc).toBe("DISK-DRAFT-ALPHA");
});

test("在途草稿读回晚于新建 / 重载会话落地：不得覆盖保留的输入区，也不得重建编辑史", async ({ page }) => {
  await setup(page, {
    holdDraftGet: true,
    initialDraft: draftJson("DISK-DRAFT-ALPHA", 16),
    messages: PREVIOUS_MESSAGES,
    resumeMessages: [],
  });
  expect((await composerState(page)).doc).toBe("");

  // 连续切换：新建会话 → 会话重载，都在草稿读回在途时发生。
  await page.locator(".lumir-hp-seg-new").click();
  await expect(page.locator(".lumir-hp-sname")).toHaveText("新会话");
  await fireCronOpen(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __resumeCalls: number }).__resumeCalls)).toBe(1);

  await page.evaluate(() => (window as unknown as { __releaseDraftGet: () => Promise<void> }).__releaseDraftGet());
  await page.waitForTimeout(50);
  expect((await composerState(page)).doc).toBe("");
});

// ── 切 vault：仍按 vault 恢复各自的草稿（合同另一半） ──────────────────────

const A_ROOT = "/tmp/lumir-preserve-a";
const B_ROOT = "/tmp/lumir-preserve-b";
const SWITCH_REGISTRY: VaultListRow[] = [
  { id: "preserve-a", path: A_ROOT, name: "preserve-a", available: true, last_opened_at: 1757000002000, tab_count: 0 },
  { id: "preserve-b", path: B_ROOT, name: "preserve-b", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];
const A_BASE: VaultFixture & { root: string } = {
  ...VAULT,
  root: A_ROOT,
  vault_id: "preserve-a",
  vaults: SWITCH_REGISTRY,
};
const B_BASE: VaultFixture & { root: string } = {
  root: B_ROOT,
  vault_id: "preserve-b",
  entries: [{ path: "preserve-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "preserve-note.md": DOC },
  links: {},
  vaults: SWITCH_REGISTRY,
};
const A_FIXTURE: VaultFixture & { root: string } = {
  ...A_BASE,
  switchTo: { ...B_BASE },
};
A_FIXTURE.switchTo!.switchTo = { ...A_BASE };

test("切 vault 仍恢复各 vault 自己的草稿：A 的内容不带进 B，切回 A 恢复", async ({ page }) => {
  await setup(page, {
    vault: A_FIXTURE,
    initialDraft: draftJson("A-DRAFT-ALPHA", 12),
    draftVaultId: "preserve-a",
  });
  await expect.poll(async () => (await composerState(page)).doc).toBe("A-DRAFT-ALPHA");

  await page.locator(".lumir-hp-composer .cm-content").click();
  await page.keyboard.type("-A-LIVE");
  await page.waitForTimeout(1400); // 防抖落盘：切走前的 flush 兜底也要能写走

  // 切到 B，再切回 A（同 send-reject 的 switcher 路径）。
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeHidden();
  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(1).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-preserve-b");
  await page.keyboard.press("Meta+Shift+A");
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect.poll(async () => (await composerState(page)).doc).toBe("");

  await page.locator(".ft-vault").click();
  await page.locator(".vault-row").nth(0).click();
  await expect(page.locator(".ft-vault-name")).toHaveText("lumir-preserve-a");
  await page.keyboard.press("Meta+Shift+A");
  await expect.poll(async () => (await composerState(page)).doc).toBe("A-DRAFT-ALPHA-A-LIVE");
});
