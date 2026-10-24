import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M662（change quote-pipeline-consistency-oct24，Alex 2026-10-24 反馈 #2）：会话名的**呈现层**
// 口径。tower 在真机 JSONL 里核实的结论：自动命名其实成功了（有 `session_title` 记录），
// 用户看到的 `<quote file="…` 是**回落名**——后端 first_user_text 取 wire 原文时把卡片元素
// 也带了进来，而前端活态路径取的是段落原文。
//
// 本场景钉两件事（都在 chromium 结构层，真机判据归验收场景 222 / 会话浮层既有场景）：
//   1. **title 事件到达后标题栏会话名即时更新**（活跃面不等人重开面板）；
//   2. **已打开的历史浮层里当前会话那一行原地改名**——判据是「旧名相等」：两侧回落口径
//      一致时（同一段提问文本），`retitleOpenSessRows` 才匹配得上；口径漂移时这行就停在
//      旧名上（现场形态：行里留着原始 XML 回落）。
//
// 为什么用「发送一条消息」建立前置：行名匹配的上屏名来自**活态** firstUserText（首条用户
// 消息），它只在发送 / 恢复时落值；不发送的话标题栏是「新会话」，与浮层行的回落名对不上，
// 这条判据就退化成恒假。发送后的活态名 == 浮层行的回落名 = 本场景的前提。

const DOC = "# 会话名笔记\n\n第一段。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "session-name-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "session-name-note.md": DOC },
  links: {},
};

/** 首次发送的提问（也是浮层里当前会话行的回落名素材）。 */
const QUESTION = "当前会话的首条提问";
/** title 事件带来的标题。 */
const TITLE = "会话名的标题";

/** 桩：零态快照 + 发送成功 + 两份历史会话（第一份的 first_user_text = QUESTION，可带
 *  `title` 模拟「标题记录已写盘」的存量会话）+ 事件钩子。事件钩子与 m347 同机制（记录
 *  listen 的 handler id，经 runCallback 送达——stubTauri 的 listen 闭包不可达）。 */
async function stubHarness(page: Page, listedTitle: string | null = null): Promise<void> {
  await page.addInitScript(
    ({ question, title }: { question: string; title: string | null }) => {
      const w = window as unknown as Record<string, any>;
      const internals = w.__TAURI_INTERNALS__;
      const invoke = internals.invoke as (cmd: string, args: unknown) => unknown;
      w.__harnessEventHandlerIds = [] as number[];
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_state") {
          return JSON.stringify({
            messages: [],
            usage: { ctx_pct: 0, cache_pct_session: 0, has_usage: false },
            pending_approval: null,
            warn_ctx_pct: 85,
          });
        }
        if (cmd === "harness_send") return null;
        if (cmd === "harness_list_sessions") {
          const current: Record<string, unknown> = {
            session_id: "s1759912345678-k3x9ab",
            first_user_text: question,
            ts: 1759912345,
          };
          if (title !== null) current.title = title;
          return JSON.stringify([
            current,
            { session_id: "s1759912000000-a1b2c3", first_user_text: "旧会话草稿", ts: 1759912000 },
          ]);
        }
        if (cmd === "plugin:event|listen" && args.event === "harness:event") {
          w.__harnessEventHandlerIds.push(args.handler ?? 0);
        }
        return invoke(cmd, args);
      };
      w.__fireHarnessEvent = (payload: unknown) => {
        for (const id of w.__harnessEventHandlerIds as number[]) {
          internals.runCallback(id, { event: "harness:event", id, payload });
        }
      };
    },
    { question: QUESTION, title: listedTitle },
  );
}

test("会话标题事件：标题栏即时更新，已打开的历史浮层里当前会话行原地改名", async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarness(page);
  await page.goto("/");
  await page.locator('.ft-row[title="session-name-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");

  // 打开 harness pane（⌘⇧A 的命令路径在头部 toggle 已隐藏时不参与；直接点 toggle）。
  await page.locator(".lumir-hp-toggle").click();
  const sname = page.locator(".lumir-hp-sname");
  await expect(sname).toHaveText("新会话");

  // 发送一条消息：活态 firstUserText 落值，标题栏显示它的截断形态（前置）。
  await page.locator(".lumir-hp-composer").fill(QUESTION);
  await page.locator(".lumir-hp-send").click();
  await expect(sname).toHaveText(QUESTION);

  // 打开历史浮层：当前会话行显示同一个回落名（两侧口径一致 = 改名的匹配前提）。
  await page.locator(".lumir-hp-session").click();
  const pop = page.locator(".lumir-hp-sesspop");
  await expect(pop).toBeVisible();
  const rows = pop.locator(".lumir-hp-sesspop-row");
  await expect(rows).toHaveCount(2);
  const currentRow = rows.nth(0).locator(".lumir-hp-sesspop-name");
  await expect(currentRow).toHaveText(QUESTION);

  // title 事件：标题栏 + 已打开的浮层行一起改名（design D11：不重开、不跳位置）。
  await page.evaluate(
    ({ title }: { title: string }) =>
      (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent({
        type: "title",
        title,
      }),
    { title: TITLE },
  );
  await expect(sname).toHaveText(TITLE);
  // 悬停/读屏名落在会话钮上（applySessionName 写的是按钮的 title，不是内层 span）。
  await expect(page.locator(".lumir-hp-session")).toHaveAttribute("title", TITLE);
  await expect(currentRow).toHaveText(TITLE);
  // 另一行（非当前会话）不受影响：改名只命中旧名相等的那一行。
  await expect(rows.nth(1).locator(".lumir-hp-sesspop-name")).toHaveText("旧会话草稿");
});

test("浮层在标题已存在后打开：行显示标题，不回落到 first_user_text", async ({ page }) => {
  // 存量会话（标题记录已写盘）的现场：`harness_list_sessions` 带 title ⇒ 行名取标题，
  // 回落值（first_user_text）即便在场也不上屏。这正是 Alex 2026-10-24 看到的形态的
  // 反面——标题在场时 MUST NOT 出现回落名（更不该出现 wire 里的卡片元素）。
  await stubTauri(page, VAULT);
  await stubHarness(page, TITLE);
  await page.goto("/");
  await page.locator('.ft-row[title="session-name-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await page.locator(".lumir-hp-session").click();
  const pop = page.locator(".lumir-hp-sesspop");
  await expect(pop).toBeVisible();
  const currentRow = pop.locator(".lumir-hp-sesspop-row").nth(0).locator(".lumir-hp-sesspop-name");
  await expect(currentRow).toHaveText(TITLE);
  await expect(currentRow).not.toContainText(QUESTION);
  await expect(currentRow).not.toContainText("<quote");
});
