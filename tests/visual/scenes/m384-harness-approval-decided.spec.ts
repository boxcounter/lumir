import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M384 批准闸两条合同条款的结构断言（openspec/specs/harness/spec.md「批准闸呈现与决策后收敛」），
// M406 随「收敛单行生命周期」重写 DOM 锚点（原型 variant B，harness-tool-card-merge）：
//
//   1. diff 行高亮覆盖整行文本：增/删行底色 MUST 覆盖该行文本完整宽度，与可视宽度无关。
//      修复前根因——每行是块级 div、宽度被容器可视宽度钳住，超长行文本溢出但底色只铺到
//      可视宽度（Alex 2026-10-08 截图实证）。不变量断言：行元素宽度 ≥ 该行文本的 Range
//      测量宽度；输入维度断言：容器 scrollWidth > clientWidth（场景确实制造了溢出形态，
//      防止断言在「无溢出」上空转绿灯——REVIEW.md 第 1/2 条）。
//   2. 收敛单行生命周期（M406 起，取代 M384 的独立终态记录卡）：批准卡挂在该调用工具行
//      下方的 .lumir-hp-pend 壳里（待决行 is-waiting +「等待批准」尾注）；采纳/拒绝后
//      卡片整体退场，**同一行**就地翻终态（✓/✕ + 工具名徽章 + 参数全文 + 结果格
//      已采纳/已拒绝 · 相对时间戳），diff 收进默认折叠的 .lumir-hp-term-body 可展开回看
//     （展开入口 .lumir-hp-tool-more「查看详情」），待决问句与按钮零残留（不留置灰按钮）。
//      拒绝附 reason 时原因行（.lumir-hp-term-reason）MUST 就地直接可见。
//
// 全部断言是**结构断言**（在场性 / 计算样式 / 几何测量），本场景不建像素基线：决策后卡片
// 与批准闸 diff 不在任何既有整页基线的画面里，条款的判定面就是几何与结构（同 m347 口径）。

const DOC = "# 批准闸笔记\n\n第一段，给上下文 chip 一个视口口径。\n";

const VAULT: VaultFixture = {
  entries: [{ path: "harness-note.md", kind: "file", size: DOC.length, mtime_ms: 0 }],
  files: { "harness-note.md": DOC },
  links: {},
};

// 合成 diff：带 core diff.rs 同形的 `--- a/` `+++ b/` 头（行内参数全文 = diff 头文件名，
// 断言钉住这条提取链）；新增行显著超出 pane 可视宽度（harness pane ≈ 1200/3 = 400px 减
// 内边距，下方 ADD 行 ~90+ 个等宽字符必然溢出），删除行也做长以覆盖删行侧。内容全部合成。
const LONG_ADD = `+HNL-BETA 第二行，patch 已落盘。${" ADD-SEGMENT".repeat(12)}`;
const LONG_DEL = `-HNL-BETA 第二行，等待 patch 时的旧文本。${" OLD-SEGMENT".repeat(10)}`;
const DIFF = [
  "--- a/harness-note.md",
  "+++ b/harness-note.md",
  "@@ -1,3 +1,3 @@",
  " HNL-ALPHA 第一行。",
  LONG_DEL,
  LONG_ADD,
  " HNL-GAMMA 第三行，不动。",
].join("\n");

/** 量 diff 高亮行的几何：行宽 vs 行内文本宽（Range 直测），外加容器的溢出输入维度。 */
async function measureDiffRows(page: Page) {
  return page.evaluate(() => {
    const pre = document.querySelector<HTMLElement>(".lumir-hp-diff");
    if (pre === null) return null;
    const rows = [...pre.querySelectorAll<HTMLElement>("div")].map((row) => {
      const range = document.createRange();
      range.selectNodeContents(row);
      const textW = range.getBoundingClientRect().width;
      range.detach();
      const bg = getComputedStyle(row).backgroundColor;
      return {
        cls: row.className,
        text: row.textContent ?? "",
        rowW: row.getBoundingClientRect().width,
        textW,
        // 透明底色（含 alpha=0）= 高亮不在场，单独钉住「底色」这个语义。
        bgTransparent: bg === "transparent" || bg.endsWith(", 0)") || bg === "rgba(0, 0, 0, 0)",
      };
    });
    return { clientW: pre.clientWidth, scrollW: pre.scrollWidth, rows };
  });
}

/** 批准闸桩：harness_state 带 pending_approval（恢复路径渲染批准卡），harness_approve
 *  记录参数并成功返回（决策路径不报错）。`pending_approval` 默认是 vault_patch + DIFF；页面侧
 *  可经全局 `__pendingApprovalOverride`（见 `stubPendingApproval`）换成别的载荷——读数在**调用
 *  时**取，与两个 init 脚本的注册顺序无关。 */
async function stubHarnessApproval(page: Page): Promise<void> {
  await page.addInitScript((diff: string) => {
    const w = window as unknown as Record<string, any>;
    const invoke = w.__TAURI_INTERNALS__.invoke as (cmd: string, args: unknown) => unknown;
    w.__approvals = [] as unknown[];
    w.__TAURI_INTERNALS__.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        const override = w.__pendingApprovalOverride as Record<string, unknown> | undefined;
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approval:
            override ?? { id: "call_p1", tool: "vault_patch", diff, argv: undefined },
          warn_ctx_pct: 85,
        });
      }
      if (cmd === "harness_approve") {
        w.__approvals.push({ request_id: args.request_id, approved: args.approved, reason: args.reason });
        return null;
      }
      return invoke(cmd, args);
    };
  }, DIFF);
}

async function openPanelWithApproval(page: Page) {
  await openPanel(page);
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await expect(page.locator(".cm-content")).toContainText("第一段");
  await page.locator(".lumir-hp-toggle").click();
  // M406 待决形态：卡挂在该调用工具行下方的 .lumir-hp-pend 壳；行保持 is-running 并加
  // is-waiting +「等待批准」尾注（D416），行内参数全文 = diff 头文件名。
  const pend = page.locator(".lumir-hp-pend");
  await expect(pend).toHaveCount(1);
  const row = pend.locator(".lumir-hp-tool-row");
  await expect(row).toHaveClass(/is-running/);
  await expect(row).toHaveClass(/is-waiting/);
  await expect(row.locator(".lumir-hp-tool-name")).toHaveText("vault_patch");
  await expect(row.locator(".lumir-hp-tool-args")).toHaveText("harness-note.md");
  await expect(row.locator(".lumir-hp-tool-out")).toContainText("等待批准");
  const card = pend.locator(".lumir-hp-approval");
  await expect(card).toBeVisible();
  // 待决态在场：问句（D339，不带工具名）+ 闸语义副句（D413）+ 两枚按钮 + diff 直接可见。
  await expect(card.locator(".lumir-hp-approval-title")).toContainText("要修改这个文件吗？");
  await expect(card.locator(".lumir-hp-approval-sub")).toHaveText("批准后才会落盘");
  await expect(page.locator('button[data-act="approve"]')).toBeVisible();
  await expect(page.locator('button[data-act="reject"]')).toBeVisible();
  await expect(page.locator(".lumir-hp-diff")).toBeVisible();
  return { pend, row, card };
}

// 桩在导航**之前**注册（`addInitScript` 只对之后的导航生效）——因此 `page.goto` 不在这里，
// 而在各测试的打开助手（`openPanel`）里：测试体在 `beforeEach` 之后运行，需要在导航前
// 追加桩（如 M459 的 `stubPendingApproval`）的测试才能把载荷注进去。
test.beforeEach(async ({ page }) => {
  await stubTauri(page, VAULT);
  await stubHarnessApproval(page);
});

/** 打开 harness pane 的公共前奏（含导航——桩注册之后才 goto，见上方 beforeEach 注）。 */
async function openPanel(page: Page): Promise<void> {
  await page.goto("/");
}

test("diff 行高亮覆盖整行文本（与可视宽度无关）", async ({ page }) => {
  await openPanelWithApproval(page);
  const m = await measureDiffRows(page);
  expect(m, "diff 容器在场").not.toBeNull();
  // 输入维度：确有行文本溢出可视宽度——没溢出就没在测截断形态。
  expect(m!.scrollW, "存在横向溢出（scrollWidth > clientWidth）").toBeGreaterThan(m!.clientW);
  // diff 渲染按行首字符分类（harness-panel.ts 只认 `+`/`-` 起首），`--- a/` `+++ b/` 头行
  // 也会带上 add/del 底色——本测试的量测对象是内容行，头行按文本前缀剔除（头行在另一个
  // 断言链上钉：行内参数全文 = diffPathOf 提取的头行文件名）。
  const highlighted = m!.rows.filter(
    (r) => /lumir-hp-diff-(add|del)/.test(r.cls) && !r.text.startsWith("+++") && !r.text.startsWith("---"),
  );
  expect(highlighted.length, "增/删内容行都在场").toBe(2);
  for (const row of highlighted) {
    expect(row.bgTransparent, `${row.cls} 底色在场`).toBe(false);
    // 不变量本身：行元素宽度 ≥ 行文本完整宽度（修复前块级行被钳在可视宽度，必红）。
    expect(row.rowW, `${row.cls} 行宽 ≥ 文本宽`).toBeGreaterThanOrEqual(row.textW);
  }
});

test("采纳后就地收敛为终态行：卡片退场，diff 折叠可回看", async ({ page }) => {
  const { card } = await openPanelWithApproval(page);
  await page.locator('button[data-act="approve"]').click();

  // 卡片整体退场（M406：不是置灰残留，是移除）；待决语义零残留。
  await expect(page.locator(".lumir-hp-approval")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-approval-title")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-approval-actions")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-reason")).toHaveCount(0);
  await expect(card).not.toBeAttached();
  // 同一行就地翻终态：✓ + 名徽章 + 参数全文 + 结果格（已采纳 + 相对时间戳）。
  const term = page.locator(".lumir-hp-termwrap");
  await expect(term).toHaveCount(1);
  const row = term.locator(".lumir-hp-tool-row");
  await expect(row).toHaveClass(/is-done/);
  await expect(row.locator(".lumir-hp-tool-name")).toHaveText("vault_patch");
  await expect(row.locator(".lumir-hp-tool-args")).toHaveText("harness-note.md");
  await expect(row.locator(".lumir-hp-tool-res .lumir-hp-tw")).toHaveText("已采纳");
  await expect(row.locator(".lumir-hp-when")).toContainText(/刚刚|前/);
  // diff 默认折叠进 term-body；展开入口在场（行即展开钮，role/aria-expanded 齐备）。
  await expect(page.locator(".lumir-hp-diff")).toBeHidden();
  const body = term.locator(".lumir-hp-term-body");
  await expect(body).toBeHidden();
  await expect(row.locator(".lumir-hp-tool-more")).toContainText("查看详情");
  await expect(row).toHaveAttribute("role", "button");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  // 决策已回送后端（参数逐字）。
  const approvals = await page.evaluate(() => (window as unknown as { __approvals: unknown[] }).__approvals);
  expect(approvals).toEqual([{ request_id: "call_p1", approved: true, reason: null }]);
  // 展开回看：diff 重新可见，且高亮不变量在展开态仍成立。
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".lumir-hp-diff")).toBeVisible();
  const m = await measureDiffRows(page);
  expect(m).not.toBeNull();
  for (const r of m!.rows.filter((r) => /lumir-hp-diff-(add|del)/.test(r.cls))) {
    expect(r.rowW, `展开态 ${r.cls} 行宽 ≥ 文本宽`).toBeGreaterThanOrEqual(r.textW);
  }
});

test("拒绝附原因：原因行就地可见，diff 折叠", async ({ page }) => {
  await openPanelWithApproval(page);
  await page.locator(".lumir-hp-reason").fill("hold off");
  await page.locator('button[data-act="reject"]').click();

  await expect(page.locator(".lumir-hp-approval")).toHaveCount(0);
  const term = page.locator(".lumir-hp-termwrap");
  await expect(term).toHaveCount(1);
  const row = term.locator(".lumir-hp-tool-row");
  await expect(row).toHaveClass(/is-rej/);
  await expect(row.locator(".lumir-hp-tool-res .lumir-hp-tw")).toHaveText("已拒绝");
  // 原因行不依赖展开详情即可见（termwrap 的直接子件，不在 term-body 里）。
  const reason = term.locator(".lumir-hp-term-reason");
  await expect(reason).toBeVisible();
  await expect(reason).toHaveText("原因：hold off");
  await expect(page.locator(".lumir-hp-diff")).toBeHidden();
  const approvals = await page.evaluate(() => (window as unknown as { __approvals: unknown[] }).__approvals);
  expect(approvals).toEqual([{ request_id: "call_p1", approved: false, reason: "hold off" }]);
});

// ── 判定依据行（M459，change add-approval-decision-reason）─────────────────────
//
// 依据的**层级**由 Rust 判定管线产出（`DecisionReason`，随批准请求事件与 `harness_state`
// 快照两条通道到达），面板只按 `kind` 取文案——本组断言判呈现层：在场 / 文案 / 位置 /
// 缺键不出行 / 随决策退场。三份桩数据与真实管线各自自洽（工具与层对得上），不是随手填的载荷。

/** 判定依据桩：把 `harness_state` 的 `pending_approval` 换成给定载荷——写法是**设一个页面全局**，
 *  由 `stubHarnessApproval` 的 invoke 桩在调用时读取（因此与两个 init 脚本的注册顺序无关；
 *  外层再包一层 invoke 的做法会被 Playwright 的注册顺序反噬，M459 实测）。 */
async function stubPendingApproval(page: Page, pending: Record<string, unknown>): Promise<void> {
  await page.addInitScript((payload: Record<string, unknown>) => {
    (window as unknown as Record<string, unknown>).__pendingApprovalOverride = payload;
  }, pending);
}

async function openApprovalPanel(page: Page) {
  await openPanel(page);
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(1);
  const card = page.locator(".lumir-hp-approval");
  await expect(card).toBeVisible();
  return { card, basis: card.locator(".lumir-hp-approval-basis") };
}

test("判定依据行：危险黑名单·shell 包装器点名包装器名，位置在问句之下", async ({ page }) => {
  // 载荷与管线自洽：cli_run 的 zsh 包装器 → 第 3 层危险黑名单 → Ask（任何档都问）。
  await stubPendingApproval(page, {
    id: "call_w1",
    tool: "cli_run",
    argv: ["zsh", "-lc", "echo hi"],
    purpose: "看一眼环境",
    reason: { kind: "dangerous_wrapper", command: "zsh" },
  });
  const { card, basis } = await openApprovalPanel(page);
  await expect(basis).toHaveCount(1);
  await expect(basis).toHaveText("shell 包装器命令（zsh）：内容不可知，任何权限档都需逐个确认");
  // 位置契约：先回答「为什么问我」（问句 → 依据行），再看要批准什么（用途句 / 命令）。
  const order = await card.evaluate((el) =>
    [...el.children].map((child) => (child.className.split(" ")[0] ?? "")),
  );
  expect(order.slice(0, 4)).toEqual([
    "lumir-hp-approval-title",
    "lumir-hp-approval-basis",
    "lumir-hp-approval-purpose",
    "lumir-hp-argv",
  ]);
  // 决策后依据行随卡退场（与待决副句 / 按钮同一生命周期，零残留）。
  await page.locator('button[data-act="reject"]').click();
  await expect(page.locator(".lumir-hp-approval")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-approval-basis")).toHaveCount(0);
});

test("判定依据行：模式默认分层带当时档位与该档释义（read_only 档的写工具卡）", async ({ page }) => {
  // 载荷与管线自洽：read_only 档下 vault_patch 走第 5 层模式默认分层 → Ask。
  await stubPendingApproval(page, {
    id: "call_p2",
    tool: "vault_patch",
    diff: DIFF,
    reason: { kind: "mode_default", mode: "read_only" },
  });
  const { basis } = await openApprovalPanel(page);
  await expect(basis).toHaveCount(1);
  await expect(basis).toHaveText("当前为 只读 档：读自动放行；写操作都先问你");
});

test("判定依据行：缺 reason 的旧载荷不出该行（不伪造依据）", async ({ page }) => {
  await stubPendingApproval(page, { id: "call_p3", tool: "vault_patch", diff: DIFF });
  const { card, basis } = await openApprovalPanel(page);
  await expect(card.locator(".lumir-hp-approval-title")).toContainText("要修改这个文件吗？");
  await expect(basis).toHaveCount(0);
});
