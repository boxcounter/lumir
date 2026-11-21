import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// mission harness-navigation-nov21 的渲染面判据（两个既有路径的缺陷修复）：
//
//   1. **句末句号不吞行号后缀**：agent 行文里常见的 `design.md:69.` 形态，链接必须仍是整段
//      `design.md:69`（不是退化成 `design.md`），点击落到第 69 行并给一次单行高亮；行范围
//      `design.md:69-72.` 同样保留闭区间高亮（既有 `lineEnd` 链路不回归）。
//   2. **cron 结果通知点击不抢正文焦点**：`cron:open_session` 到达时 harness pane 展开 /
//      会话内容恢复，但文档编辑器的焦点、光标行与滚动位置（阅读位置）逐项不变；pane 已打开
//      与 pane 关闭两种状态都要成立。
//   3. 显式打开 / toggle harness 的既有 composer 聚焦行为不变（回归锚点）。
//
// 判据为什么这样写：焦点与滚动读数取自真实 DOM（document.activeElement）与真 CM view
// （`.cm-content` 的 cmTile.root.view），与 reading-position / m632 同一口径；cron 事件经
// @tauri-apps/api 的真实 listen 回调通道注入（桩没有「后端 emit」通道），恢复内容由
// harness_state 快照承担——与真后端「恢复后重拉快照」同形。
// 不覆盖：真机 WKWebView 下的同一链路在 `scripts/acceptance/scenarios/269-*`（需要真实通知
// 点击，chromium 层造不出来）；解析边界矩阵在 `tests/unit/harness-path-link.test.ts`。

const DESIGN_LINES: string[] = [];
for (let line = 1; line <= 120; line += 1) {
  DESIGN_LINES.push(line === 69 ? "DESIGN-LINE-69-TARGET" : `design 第 ${line} 行`);
}
const DESIGN_DOC = `${DESIGN_LINES.join("\n")}\n`;
const NOTE_LINES: string[] = ["# 前台文档", "", "给 harness 面板一个前台文档，并让正文可聚焦。"];
for (let line = NOTE_LINES.length + 1; line <= 120; line += 1) NOTE_LINES.push(`note 第 ${line} 行`);
const NOTE_DOC = `${NOTE_LINES.join("\n")}\n`;
const RESTORED_TEXT = "CRON-NAV-RESTORED 结果通知恢复的会话内容。";
const EMPTY_USAGE = { ctx_pct: 0, cache_pct_session: 0 };

const VAULT: VaultFixture = {
  entries: [
    { path: "note.md", kind: "file", size: NOTE_DOC.length, mtime_ms: 0 },
    { path: "design.md", kind: "file", size: DESIGN_DOC.length, mtime_ms: 0 },
    { path: "decimal.md", kind: "file", size: NOTE_DOC.length, mtime_ms: 0 },
  ],
  files: { "note.md": NOTE_DOC, "design.md": DESIGN_DOC, "decimal.md": NOTE_DOC },
  links: {},
};

const ROOT = "/tmp/lumir-visual-navigation-nov21";

/** 面板快照桩：`restored` 之前是空会话，调过 `harness_resume_session` 之后返回恢复内容
 * （与真后端「恢复后重拉 harness_state」同形）。同时记录 `cron:open_session` 的 listen
 *  handler id，供 `__fireCronOpenSession` 驱动真实回调通道。 */
async function stubHarness(page: Page, assistantText: string): Promise<void> {
  const snapshot = {
    messages: [{ role: "assistant", text: assistantText, ts: Math.floor(Date.now() / 1000) - 30 }],
    usage: EMPTY_USAGE,
    pending_approval: null,
    warn_ctx_pct: 85,
  };
  await page.addInitScript(
    ({ snap, restoredText }) => {
      const w = window as unknown as Record<string, any>;
      const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
      w.__cronOpenListeners = [] as number[];
      w.__cronRunListeners = [] as number[];
      w.__restored = false;
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_state") {
          if (!w.__restored) return JSON.stringify(snap);
          return JSON.stringify({
            messages: [{ role: "assistant", text: restoredText, ts: Math.floor(Date.now() / 1000) - 10 }],
            usage: { ctx_pct: 0, cache_pct_session: 0 },
            pending_approval: null,
            warn_ctx_pct: 85,
          });
        }
        if (cmd === "harness_resume_session") {
          w.__restored = true;
          return { session_id: "restored-session", restored_items: 2, messages: [] };
        }
        if (cmd === "harness_cron_run") return null;
        if (cmd === "harness_list_sessions") return [];
        if (cmd === "plugin:event|listen" && args !== null) {
          if (args.event === "cron:open_session") (w.__cronOpenListeners as number[]).push(args.handler as number);
          if (args.event === "cron:run") (w.__cronRunListeners as number[]).push(args.handler as number);
        }
        return invoke(cmd, args);
      };
      w.__fireCronOpenSession = (payload: unknown) => {
        for (const id of w.__cronOpenListeners as number[]) {
          w.__TAURI_INTERNALS__.runCallback(id, { event: "cron:open_session", id, payload });
        }
      };
      w.__fireCronRun = (payload: unknown) => {
        for (const id of w.__cronRunListeners as number[]) {
          w.__TAURI_INTERNALS__.runCallback(id, { event: "cron:run", id, payload });
        }
      };
    },
    { snap: snapshot, restoredText: RESTORED_TEXT },
  );
}

async function openDoc(page: Page, assistantText: string): Promise<void> {
  await stubTauri(page, { ...VAULT, root: ROOT });
  await stubHarness(page, assistantText);
  await page.goto("/");
  await page.locator('.ft-row[title="note.md"]').click();
  await expect(page.locator('.editor-pane:not(:has(.lumir-harness)) .cm-content')).toContainText("前台文档");
}

const docContent = (page: Page) => page.locator('.editor-pane:not(:has(.lumir-harness)) .cm-content');

/** 正文读数：焦点归属、光标行、滚动位置。 */
function docFacts(page: Page): Promise<{ inDoc: boolean; inHarness: boolean; line: number; scrollTop: number }> {
  return page.evaluate(() => {
    const host = document.querySelector('.editor-pane:not(:has(.lumir-harness)) .cm-content') as unknown as {
      contains(other: Node | null): boolean;
      cmTile: {
        root: {
          view: {
            state: { selection: { main: { head: number } }; doc: { lineAt(pos: number): { number: number } } };
            scrollDOM: { scrollTop: number };
          };
        };
      };
    };
    const view = host.cmTile.root.view;
    const active = document.activeElement;
    return {
      inDoc: active !== null && host.contains(active),
      inHarness: active !== null && document.querySelector(".lumir-harness")?.contains(active) === true,
      line: view.state.doc.lineAt(view.state.selection.main.head).number,
      scrollTop: view.scrollDOM.scrollTop,
    };
  });
}

/** 把正文滚到一个非零位置，作为「阅读位置不被抢走」的判据输入。 */
async function scrollDoc(page: Page, top: number): Promise<void> {
  await page.evaluate((value) => {
    const host = document.querySelector('.editor-pane:not(:has(.lumir-harness)) .cm-content') as unknown as {
      cmTile: { root: { view: { scrollDOM: { scrollTop: number } } } };
    };
    host.cmTile.root.view.scrollDOM.scrollTop = value;
  }, top);
}

async function waitCronBridge(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const w = window as unknown as { __cronOpenListeners: number[]; __cronRunListeners: number[] };
        return w.__cronOpenListeners.length > 0 && w.__cronRunListeners.length > 0;
      }),
    )
    .toBe(true);
}

const pathLink = (page: Page, text: string) =>
  page.locator(".lumir-hp-pathlink").filter({ hasText: new RegExp(`^${text.replace(/[.-]/g, "\\$&")}$`) });

async function highlightedTexts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".cm-line.cm-line-highlight")).map((el) => el.textContent ?? ""),
  );
}

async function waitForHighlightCount(page: Page, expected: number): Promise<void> {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".cm-line.cm-line-highlight").length === count,
    expected,
    { timeout: 3000, polling: 20 },
  );
}

// ---------------------------------------------------------------------------
// 1. 句末句号形态
// ---------------------------------------------------------------------------

test("句末句号不吞行号：链接仍是整段 design.md:69，点击落到第 69 行并高亮", async ({ page }) => {
  await openDoc(
    page,
    "参考 design.md:69. 另见行范围 design.md:69-72. 以及小数形态 decimal.md:12.5 不该被当成行号。",
  );
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const body = page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first();
  await expect(body).toContainText("design.md:69.");

  // 正向：句号在可点范围之外，行号留在链接里。
  await expect(pathLink(page, "design.md:69")).toHaveCount(1);
  await expect(pathLink(page, "design.md:69")).toHaveText("design.md:69");
  await expect(pathLink(page, "design.md:69-72")).toHaveText("design.md:69-72");
  // 反证：不存在退化成裸路径的链接（修复前的形态）。
  await expect(pathLink(page, "design.md")).toHaveCount(0);
  // 小数形态仍按畸形后缀处理：链接只到路径本身，`.5` 留作文本。
  await expect(pathLink(page, "decimal.md")).toHaveCount(1);
  await expect(pathLink(page, "decimal.md")).toHaveText("decimal.md");
  await expect(pathLink(page, "decimal.md:12.5")).toHaveCount(0);
  expect(await body.evaluate((el) => el.textContent)).toContain("decimal.md:12.5");

  // 点击：落到第 69 行，整行高亮一行（selection 仍折叠在行首）。
  await pathLink(page, "design.md:69").click();
  await expect(docContent(page)).toContainText("DESIGN-LINE-69-TARGET");
  await waitForHighlightCount(page, 1);
  expect(await highlightedTexts(page)).toEqual(["DESIGN-LINE-69-TARGET"]);
  const line = await page.evaluate(() => {
    const host = document.querySelector('.editor-pane:not(:has(.lumir-harness)) .cm-content') as unknown as {
      cmTile: { root: { view: { state: { selection: { main: { empty: boolean; head: number } }; doc: { lineAt(pos: number): { number: number } } } } } };
    };
    const view = host.cmTile.root.view;
    return {
      empty: view.state.selection.main.empty,
      line: view.state.doc.lineAt(view.state.selection.main.head).number,
    };
  });
  expect(line.line, "行号后缀解析的落点").toBe(69);
  expect(line.empty, "路径点击不选中").toBe(true);

  // 行范围形态不回归：闭区间 69…72 四行高亮。
  await pathLink(page, "design.md:69-72").click();
  await waitForHighlightCount(page, 4);
  expect(await highlightedTexts(page)).toEqual([
    "DESIGN-LINE-69-TARGET",
    "design 第 70 行",
    "design 第 71 行",
    "design 第 72 行",
  ]);
});

// ---------------------------------------------------------------------------
// 2. cron 结果通知：pane 关闭态
// ---------------------------------------------------------------------------

test("cron 结果通知（pane 关闭）：展开 pane 并恢复会话，正文焦点 / 阅读位置不被抢", async ({ page }) => {
  await openDoc(page, "普通回答");
  await waitCronBridge(page);
  await docContent(page).click();
  await scrollDoc(page, 320);
  const before = await docFacts(page);
  expect(before.inDoc, "前置：正文持有焦点").toBe(true);
  expect(before.scrollTop).toBeGreaterThan(0);

  await page.evaluate((root) => {
    (window as unknown as { __fireCronOpenSession: (payload: unknown) => void }).__fireCronOpenSession({
      vault: root,
      session_id: "restored-session",
    });
  }, ROOT);

  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first()).toContainText(RESTORED_TEXT);

  const after = await docFacts(page);
  expect(after.inDoc, "正文仍持有焦点（composer 不抢）").toBe(true);
  expect(after.inHarness, "焦点不得进 harness 面板").toBe(false);
  expect(after.line, "光标行不变").toBe(before.line);
  expect(after.scrollTop, "阅读位置（滚动）不变").toBe(before.scrollTop);
});

// ---------------------------------------------------------------------------
// 3. cron 结果通知：pane 已打开态
// ---------------------------------------------------------------------------

test("cron 结果通知（pane 已打开）：内容恢复，正文焦点 / 阅读位置仍不被抢", async ({ page }) => {
  await openDoc(page, "普通回答");
  await waitCronBridge(page);
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  // 前置：显式打开 = composer 持焦（既有行为）。
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();

  await docContent(page).click();
  await scrollDoc(page, 320);
  const before = await docFacts(page);
  expect(before.inDoc).toBe(true);

  await page.evaluate((root) => {
    (window as unknown as { __fireCronOpenSession: (payload: unknown) => void }).__fireCronOpenSession({
      vault: root,
      session_id: "restored-session",
    });
  }, ROOT);

  await expect(page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first()).toContainText(RESTORED_TEXT);
  const after = await docFacts(page);
  expect(after.inDoc, "正文仍持有焦点").toBe(true);
  expect(after.inHarness, "焦点不得进 harness 面板").toBe(false);
  expect(after.line).toBe(before.line);
  expect(after.scrollTop).toBe(before.scrollTop);
});

// ---------------------------------------------------------------------------
// 4. 回归锚点：显式 toggle 的 composer 聚焦行为不变
// ---------------------------------------------------------------------------

test("显式打开 harness：composer 仍拿焦点（既有行为不被本修复改写）", async ({ page }) => {
  await openDoc(page, "普通回答");
  await docContent(page).click();
  await expect(docContent(page)).toBeFocused();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();
});

// ---------------------------------------------------------------------------
// 5. 回归锚点：cron:run 显式发起仍聚焦 composer（评审 r1 P2）
// ---------------------------------------------------------------------------

test("cron:run 显式发起：composer 仍拿焦点（缺省 focusComposer = true 的回归）", async ({ page }) => {
  await openDoc(page, "普通回答");
  await waitCronBridge(page);
  await docContent(page).click();
  await expect(docContent(page)).toBeFocused();

  await page.evaluate((root) => {
    (window as unknown as { __fireCronRun: (payload: unknown) => void }).__fireCronRun({
      vault: root,
      session_target: { kind: "interactive" },
      prompt: "CRON-RUN-FOCUS 显式发起应聚焦输入区。",
      origin: { run_id: "run-focus-1" },
      tool_policy: null,
      budget: null,
      approval_policy: null,
      background: false,
      trigger: "click",
      session: "new",
      session_id: null,
      model: null,
    });
  }, ROOT);

  // 显式发起是用户动作：与新开 pane 同一落点，焦点进输入区（design N4）。
  await expect(page.locator(".lumir-hp-composer .cm-content")).toBeFocused();
  await expect(page.locator(".lumir-hp-msg-user .lumir-hp-body")).toContainText("CRON-RUN-FOCUS");
});
