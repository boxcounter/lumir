import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M460（Alex 2026-10-12 dogfood 两条反馈）的**渲染面**断言：
//
//   1. **裸 URL 上屏为可点链接**（现场原话：「harness pane 里的表格里的链接没有渲染出来……
//      但在会话 JSONL 里是有链接的」）。判据落三处：段落里的裸 URL、表格 cell 里的裸 URL
//      （现场的那一格）、`[文字](url)` 的标准写法不重复上屏（URL 只作 href，不进可见文本）。
//      点击走 `open_external_url` 同一条信任边界（本场景把它记下来做正观测）。
//   2. **恢复重放的消息带时间读数**（现场原话：「恢复的会话里，没有显示消息时间」）。判据落
//      同日（窄相对）与跨天（短日期）两档——跨天那条是区分度判据：修复前 live 档一律
//      「昨天」，一周前的消息也这么说，等于错读数。
//
// 本场景的边界（别读成「已覆盖」）：会话恢复的**ts 归属**（JSONL 信封 → 面板消息）在后端，
// chromium 层验不到——钉它的是 `src-tauri/src/harness.rs` 的
// `restored_panel_messages_carries_envelope_ts_per_item` / `restored_messages_ts_walks_the_record_sequence`
// 与真机场景 152。这里验的是**前端拿着 ts 之后**渲染成什么样（桩直接给 ts）。

const DOC = "# 链接与时间笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

/** 合成域名（仓库信息卫生：fixture 一律合成，不搬真实 vault 内容）。 */
const URL_PARA = "https://example.com/para/x";
const URL_CELL = "https://example.com/cell/y";
const URL_STD = "https://example.com/std/z";

/** 恢复消息的正文：三类形态各一（段落裸 URL / 表格 cell 裸 URL / 标准链接）。 */
const BODY = [
  `段落里的裸链接 ${URL_PARA} 收尾。`,
  "",
  "| 列 |",
  "|---|",
  `| ${URL_CELL} |`,
  "",
  `标准写法 [示例站点](${URL_STD}) 也在。`,
].join("\n");

const EMPTY_STATE = {
  messages: [],
  usage: { ctx_pct: 0, cache_pct_session: 0 },
  pending_approval: null,
  warn_ctx_pct: 85,
};

async function stubHarness(page: Page, snapshot: unknown, resume: unknown): Promise<void> {
  await page.addInitScript(
    ([snap, res]) => {
      const w = window as unknown as Record<string, any>;
      const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
      w.__resumedSessions = [] as string[];
      w.__openedUrls = [] as string[];
      w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
        if (cmd === "harness_state") return JSON.stringify(snap);
        // 会话清单与恢复的载荷是**真载荷形状**（数组 / 对象；只有 harness_state 是 JSON 串）。
        if (cmd === "harness_list_sessions") return (res as any).list;
        if (cmd === "harness_resume_session") {
          w.__resumedSessions.push(args.session_id as string);
          return (res as any).info;
        }
        // 链接点击的信任边界：记下被交给后端的 URL 原文（不真开浏览器）。
        if (cmd === "open_external_url") {
          w.__openedUrls.push(args.url as string);
          return null;
        }
        return invoke(cmd, args);
      };
    },
    [snapshot, resume] as const,
  );
}

async function openPanel(page: Page, snapshot: unknown, resume: unknown = { list: [], info: {} }): Promise<void> {
  await stubTauri(page, VAULT);
  await stubHarness(page, snapshot, resume);
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
}

test("消息正文：表格按列序渲染，空格位保留（真机场景 157 的下沉面）", async ({ page }) => {
  // 真机那侧判的是「表头 / 表体的格文本按列序拼接」，AX 只能读到拼好的行名——
  // 这里直接读 DOM 的每一格，空槽（首格空 / 中间空）也逐格对得上。
  const TABLE_BODY = ["|  | 乙 | 丙 |", "|---|---|---|", "| 甲 |  | 丙 |"].join("\n");
  await openPanel(page, {
    messages: [{ role: "assistant", text: TABLE_BODY, ts: Math.floor(Date.now() / 1000) - 30 }],
    usage: { ctx_pct: 0, cache_pct_session: 0 },
    pending_approval: null,
    warn_ctx_pct: 85,
  });

  const table = page.locator(".lumir-hp-msg-assistant .lumir-hp-body table.lumir-hp-table").first();
  await expect(table).toHaveCount(1);
  // 两行都在（表未渲染时下面两条先红，不会在空集合上空过）
  await expect(table.locator("thead tr")).toHaveCount(1);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("thead th")).toHaveText(["", "乙", "丙"]);
  await expect(table.locator("tbody td")).toHaveText(["甲", "", "丙"]);
});

test("消息正文：裸 URL 在段落与表格 cell 里都渲染为可点链接，标准链接的 URL 不重复上屏", async ({
  page,
}) => {
  const NOW_S = Math.floor(Date.now() / 1000);
  await openPanel(page, {
    messages: [{ role: "assistant", text: BODY, ts: NOW_S - 30 }],
    usage: { ctx_pct: 0, cache_pct_session: 0 },
    pending_approval: null,
    warn_ctx_pct: 85,
  });

  const body = page.locator(".lumir-hp-msg-assistant .lumir-hp-body").first();
  // 三条链接全在场（修复前只有标准链接那条：两个裸 URL 被整段跳过、在面板里隐身）。
  await expect(body.locator("a.lumir-hp-link")).toHaveCount(3);

  const paraLink = body.locator("a.lumir-hp-link", { hasText: URL_PARA });
  await expect(paraLink).toHaveCount(1);
  await expect(paraLink).toHaveAttribute("href", URL_PARA);
  await expect(paraLink).toHaveText(URL_PARA);
  await expect(body).toContainText(URL_PARA); // URL 原文在正文里可见（不是「渲染了但空着」）

  // 现场的那一格：表格 cell 里的裸 URL（宿主 = td，不是飘在表格外的兄弟节点）。
  const cellLink = body.locator("td a.lumir-hp-link");
  await expect(cellLink).toHaveCount(1);
  await expect(cellLink).toHaveAttribute("href", URL_CELL);
  await expect(cellLink).toHaveText(URL_CELL);

  // 回归：`[文字](url)` 的显示文本仍是「文字」，URL 只作 href、不进可见文本（不二次上屏）。
  const stdLink = body.locator("a.lumir-hp-link", { hasText: "示例站点" });
  await expect(stdLink).toHaveCount(1);
  await expect(stdLink).toHaveAttribute("href", URL_STD);
  await expect(body).not.toContainText(URL_STD);

  // 点击走同一条信任边界：URL 原文交给 open_external_url（导航被拦下，不离开应用）。
  await paraLink.click();
  const opened = await page.evaluate(
    () => (window as unknown as { __openedUrls: string[] }).__openedUrls,
  );
  expect(opened).toEqual([URL_PARA]);
});

test("会话恢复重放：who 行带留存 ts 的时间读数（同日窄相对 / 跨天短日期）", async ({ page }) => {
  const NOW_S = Math.floor(Date.now() / 1000);
  await openPanel(
    page,
    EMPTY_STATE,
    {
      list: [
        { session_id: "s1759912345678-k3x9ab", first_user_text: "恢复的历史问题", ts: NOW_S - 600 },
      ],
      info: {
        session_id: "s1759912345679-resume",
        restored_items: 3,
        messages: [
          { role: "user", text: "恢复的历史问题", ts: NOW_S - 90 },
          { role: "assistant", text: "恢复的历史回答", ts: NOW_S - 30 },
          { role: "assistant", text: "三天前的回答", ts: NOW_S - 3 * 86400 },
        ],
      },
    },
  );

  // 从会话浮层选一行历史会话 → 恢复（重放路径 = M398 的 renderSnapshotMessages）。
  await page.locator(".lumir-hp-session").click();
  const pop = page.locator(".lumir-hp-sesspop");
  await expect(pop).toBeVisible();
  await pop.locator(".lumir-hp-sesspop-item").first().click();
  await expect(pop).toBeHidden();
  // 恢复确实发生了（正观测：会话名换成源会话首条提问 + 恢复命令收到了选中的 session id）。
  await expect(page.locator(".lumir-hp-sname")).toHaveText("恢复的历史问题");
  const resumed = await page.evaluate(
    () => (window as unknown as { __resumedSessions: string[] }).__resumedSessions,
  );
  expect(resumed).toEqual(["s1759912345678-k3x9ab"]);

  // 重放消息逐条带时间读数。判据顺序：先判**用户可见**的读数（跨天短日期），再判形态标记。
  const userWhen = page.locator(".lumir-hp-msg-user .lumir-hp-when");
  await expect(userWhen).toHaveCount(1);
  await expect(userWhen).toHaveText(/· 1分钟前/);
  // 秒档读数与真实时间竞态：ts 在用例开头取 NOW_S-30，渲染时已过 0–2s，读数在 30/31 之间摆动
  // （实测 3 连跑 = 通过/失败/通过）。断言放宽到相邻两秒，仍钉住「restored 档给 N秒前」这一形态。
  await expect(
    page.locator(".lumir-hp-msg", { hasText: "恢复的历史回答" }).locator(".lumir-hp-when"),
  ).toHaveText(/· 3[01]秒前/);

  // 跨天那条是区分度判据：一周前的消息给短日期，**不是** live 档的「昨天」。
  const older = page.locator(".lumir-hp-msg", { hasText: "三天前的回答" }).locator(".lumir-hp-when");
  await expect(older).toHaveCount(1);
  await expect(older).toHaveText(/· \d+月\d+日/);
  await expect(older).not.toHaveText(/昨天/);
  // 形态标记落 dataset：30s 刷新与语言切换读它重算（不回落 live 档）。
  await expect(userWhen).toHaveAttribute("data-when-form", "restored");
  await expect(older).toHaveAttribute("data-when-form", "restored");
});
