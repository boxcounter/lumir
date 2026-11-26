import { expect, test, type Page } from "@playwright/test";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M384 批准闸两条合同条款的结构断言（openspec/specs/harness/spec.md「批准闸呈现与决策后收敛」），
// M406 随「收敛单行生命周期」重写 DOM 锚点（原型 variant B，harness-tool-card-merge）：
//
//   1. diff 行高亮覆盖整行文本：增/删行底色 MUST 覆盖该行文本完整宽度，与可视宽度无关。
//      修复前根因——每行是块级 div、宽度被容器可视宽度钳住，超长行文本溢出但底色只铺到
//      可视宽度（Alex 2026-10-08 截图实证）。不变量断言：行元素宽度 ≥ 该行文本的 Range
//      测量宽度；输入维度断言：容器 scrollWidth > clientWidth（场景确实制造了溢出形态，
//      防止断言在「无溢出」上空转绿灯——REVIEW.md 「断言等价于子串 / 读不到当成空」条）。
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

/** 批准闸桩：harness_state 带 `pending_approvals` 列表（M590 起快照字段从单槽
 *  `pending_approval` 迁到列表，恢复路径按列表渲染批准卡），harness_approve
 *  记录参数并成功返回（决策路径不报错）。列表默认一项 vault_patch + DIFF；页面侧
 *  可经全局 `__pendingApprovalOverride`（见 `stubPendingApproval`）换成别的载荷——读数在**调用
 *  时**取，与两个 init 脚本的注册顺序无关。 */
async function stubHarnessApproval(page: Page): Promise<void> {
  await page.addInitScript((diff: string) => {
    const w = window as unknown as Record<string, any>;
    const internals = w.__TAURI_INTERNALS__;
    const invoke = internals.invoke as (cmd: string, args: unknown) => unknown;
    w.__approvals = [] as unknown[];
    w.__harnessEventHandlerIds = [] as number[];
    w.__harnessStateCalls = 0;
    internals.invoke = async (cmd: string, args: any) => {
      if (cmd === "harness_state") {
        w.__harnessStateCalls += 1;
        const override = w.__pendingApprovalOverride as Record<string, unknown> | undefined;
        // `__pendingApprovalList` 让用例把待决列表整体换掉（含空列表）；缺省仍是单张
        // vault_patch 卡。`in_flight: true` 是待批呈现的前提（change
        // fix-harness-approval-visibility-nov23：相位空闲时待决列表按陈旧项丢弃）。
        const overrideList = w.__pendingApprovalList as unknown[] | undefined;
        return JSON.stringify({
          messages: [],
          usage: { ctx_pct: 0, cache_pct_session: 0 },
          pending_approvals:
            overrideList ?? [override ?? { id: "call_p1", tool: "vault_patch", diff, argv: undefined }],
          warn_ctx_pct: 85,
          in_flight: w.__inFlight !== false,
        });
      }
      if (cmd === "harness_approve") {
        w.__approvals.push({ request_id: args.request_id, approved: args.approved, reason: args.reason });
        return null;
      }
      if (cmd === "harness_send" || cmd === "harness_abort" || cmd === "harness_new_session") return null;
      if (cmd === "plugin:event|listen" && args.event === "harness:event") {
        w.__harnessEventHandlerIds.push(args.handler ?? 0);
      }
      return invoke(cmd, args);
    };
    w.__fireHarnessEvent = (payload: unknown) => {
      for (const id of w.__harnessEventHandlerIds) {
        internals.runCallback(id, { event: "harness:event", id, payload });
      }
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

/** 判定依据桩：把 `harness_state` 的 `pending_approvals` 列表项换成给定载荷——写法是**设一个页面全局**，
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
  // 命令类卡片**无副句**（M540：D414 删除）——标题文本只有问句一句；写类副句 D413 的
  // 在场守卫在同文件的待决态用例里（`.lumir-hp-approval-sub` 有值时照样被判出来）。
  await expect(card.locator(".lumir-hp-approval-title")).toHaveText("要运行这条命令吗？");
  await expect(card.locator(".lumir-hp-approval-sub")).toHaveCount(0);
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

// ── 待批状态与多项清算（change fix-harness-approval-visibility-nov23 tasks 1.6）──────────────
//
// 既有桩的相位是 idle（M384 起快照没有 `in_flight`）：待批卡只剩「恢复的历史」这一种读法，
// 与本 change 的「运行中等待批准」不是同一件事。本组用 `in_flight: true` 的独立形态（空待决
// 列表起步、两项经 live 事件到达）判：
//   1. 决策前**正断言**「等待批准…」真实在场（段状态词与 toggle 同源）；
//   2. 多项逐个决策：第一项后仍待批，最后一项后才回落；
//   3. 重复投递 / 流式分片期间状态文本没有新的 mutation（不重复播报）。

async function fire(page: Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (body) => (window as unknown as { __fireHarnessEvent: (p: unknown) => void }).__fireHarnessEvent(body),
    payload,
  );
}

test("待批状态：running 桩下正断言等待批准；两项逐个清算；不重复播报", async ({ page }) => {
  // 空待决列表起步：两项都由 live 事件到达（同块并发待批）。
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__pendingApprovalList = [];
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  const stage = page.locator(".lumir-hp-stage");
  const segStatus = page.locator(".lumir-hp-seg-status");
  const toggleStatus = page.locator(".lumir-hp-toggle-status");

  // 进入快照在途、无待批：对照组（不得误报；中途接管读 D983）。
  await expect(stage).toHaveText("正在继续本轮…");
  await expect(segStatus).toBeHidden();
  await expect(toggleStatus).toHaveText("处理中");

  const request = (id: string) => ({ type: "approval_request", id, tool: "vault_patch", diff: DIFF });
  await fire(page, request("call_multi_1"));
  await expect(stage).toHaveText("等待批准…");
  await expect(segStatus).toHaveText("等待批准");
  await expect(toggleStatus).toHaveText("等待批准");
  await expect(page.locator(".lumir-hp-toggle")).toHaveAttribute("title", "Harness 面板 · 等待批准");
  await fire(page, request("call_multi_2"));
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(2);
  await expect(page.locator('button[data-act="approve"]')).toHaveCount(2);

  // 不重复播报：重复投递同一 id + 流式分片期间，三处状态文本零 mutation。
  await page.evaluate(() => {
    const targets = [
      document.querySelector(".lumir-hp-stage"),
      document.querySelector(".lumir-hp-toggle-status"),
      document.querySelector(".lumir-hp-seg-status"),
    ];
    const win = window as unknown as { __statusMutations: number; __statusObserver: MutationObserver };
    win.__statusMutations = 0;
    const observer = new MutationObserver((records) => {
      win.__statusMutations += records.length;
    });
    for (const target of targets) {
      if (target === null) throw new Error("缺状态承载节点");
      observer.observe(target, { childList: true, characterData: true, subtree: true });
    }
    win.__statusObserver = observer;
  });
  await fire(page, request("call_multi_1"));
  await fire(page, { type: "text_chunk", text: "闸后流式分片。" });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator(".lumir-hp-pend"), "重复投递不得落第二张卡").toHaveCount(2);
  await expect(stage).toHaveText("等待批准…");
  const mutations = await page.evaluate(
    () => (window as unknown as { __statusMutations: number }).__statusMutations,
  );
  expect(mutations, "同一待批集合期间状态文本不得重复写入（aria-live 不重复播报）").toBe(0);

  // 第一项决策：仍待批（集合非空），卡只剩一张。
  await page.locator('button[data-act="approve"]').first().click();
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(1);
  await expect(stage).toHaveText("等待批准…");
  await expect(segStatus).toHaveText("等待批准");

  // 最后一项决策：同一同步批次退场，回到无待批的接管档（midTakeover 优先于生成档）。
  await page.locator('button[data-act="approve"]').first().click();
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(0);
  await expect(stage).toHaveText("正在继续本轮…");
  await expect(segStatus).toBeHidden();
  await expect(toggleStatus).toHaveText("处理中");
  const approvals = await page.evaluate(
    () => (window as unknown as { __approvals: unknown[] }).__approvals,
  );
  expect(approvals).toEqual([
    { request_id: "call_multi_1", approved: true, reason: null },
    { request_id: "call_multi_2", approved: true, reason: null },
  ]);
});

// ── P1（独立评审 r1 / r2）：多待批全部决策后的 done 配对 ────────────────────────────
//
// 生产身份链（r2 复审核实）：`park_approval` 生成 `ap-N` 作为 `approval_request.id`；
// 同一次 `handle_call` 先发 `tool_call started`（带模型 `call_id`），批准卡就升级这条行。
// done 带的仍是模型 `call_id`——**ap-N ≠ call_id**。前端用「started 行」作桥，把 call_id
// 记到待批记录上；快照恢复的待批没有这个桥（`PendingApprovalSnapshot` 不带 call_id），
// 决策后按工具名 + 调用顺序 FIFO 兜底（同名反序 done 的归属限制见 design §4）。
//
// 本组用例因此一律用真实形状：approval id = ap-N、started / done = call_...，不再人为令
// 两者相同；同名 A 失败 B 成功、异名反序、重复 done 不消费下一项 / 不重建。

/** 打开空待批的 running 面板（`__pendingApprovalList = []`），供 live 多卡场景用。 */
async function openEmptyRunningPanel(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__pendingApprovalList = [];
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await expect(page.locator(".lumir-hp-stage")).toHaveText("正在继续本轮…");
}

/** 先发 live started（带 call_id），再发批准请求（id 是独立的 ap-N）。 */
async function startAndRequestApproval(
  page: Page,
  input: { callId: string; approvalId: string; tool: string; args: Record<string, unknown> },
): Promise<void> {
  await fire(page, {
    type: "tool_call",
    name: input.tool,
    status: "started",
    summary: input.tool === "cli_run" ? JSON.stringify({ command: "echo", args: [(input.args.argv as string[])[1]] }) : "harness-note.md",
    call_id: input.callId,
  });
  await fire(page, { type: "approval_request", id: input.approvalId, tool: input.tool, ...input.args });
}

async function decideBothApprovals(page: Page): Promise<void> {
  await page.locator('button[data-act="approve"]').first().click();
  await expect(page.locator('button[data-act="approve"]')).toHaveCount(1);
  await page.locator('button[data-act="approve"]').first().click();
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-termwrap .lumir-hp-tool-row")).toHaveCount(2);
}

test("多待批全部决策后 done：真实 ap-N ≠ call_id，同名失败贴对行，重复 done 不消费下一项", async ({
  page,
}) => {
  await openEmptyRunningPanel(page);
  await startAndRequestApproval(page, {
    callId: "call_same_a",
    approvalId: "ap-same-a",
    tool: "cli_run",
    args: { argv: ["echo", "A"] },
  });
  await startAndRequestApproval(page, {
    callId: "call_same_b",
    approvalId: "ap-same-b",
    tool: "cli_run",
    args: { argv: ["echo", "B"] },
  });
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(2);
  await decideBothApprovals(page);

  const rows = page.locator(".lumir-hp-termwrap .lumir-hp-tool-row");
  const rowA = rows.filter({ hasText: "echo A" });
  const rowB = rows.filter({ hasText: "echo B" });

  // 先到的 done 是 A 且执行失败；紧接着重复一次 A 的 done（必须在 B 之前），不得消费 B 的
  // 记录。B 后到且成功。
  await fire(page, {
    type: "tool_call",
    name: "cli_run",
    status: "done",
    summary: "failed · io: A 写盘失败",
    call_id: "call_same_a",
  });
  await fire(page, {
    type: "tool_call",
    name: "cli_run",
    status: "done",
    summary: "failed · io: A 写盘失败",
    call_id: "call_same_a",
  });
  await fire(page, { type: "tool_call", name: "cli_run", status: "done", summary: "完成", call_id: "call_same_b" });

  await expect(rowA).toHaveClass(/is-fail/);
  await expect(rowA.locator(".lumir-hp-tool-out")).toContainText("A 写盘失败");
  await expect(rowB).not.toHaveClass(/is-fail/);
  await expect(rowB.locator(".lumir-hp-tool-out")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-tool-row")).toHaveCount(2);
});

test("多待批全部决策后 done：异名工具反序到达仍按调用身份配对", async ({ page }) => {
  await openEmptyRunningPanel(page);
  await startAndRequestApproval(page, {
    callId: "call_x1",
    approvalId: "ap-x1",
    tool: "vault_patch",
    args: { diff: DIFF },
  });
  await startAndRequestApproval(page, {
    callId: "call_x2",
    approvalId: "ap-x2",
    tool: "cli_run",
    args: { argv: ["echo", "B"] },
  });
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(2);
  await decideBothApprovals(page);

  const rows = page.locator(".lumir-hp-termwrap .lumir-hp-tool-row");
  const patchRow = rows.filter({ hasText: "harness-note.md" });
  const cliRow = rows.filter({ hasText: "echo B" });

  // 反序：B（cli_run）先成功，A（vault_patch）后失败；身份精确配对（不是按名 FIFO）。
  await fire(page, { type: "tool_call", name: "cli_run", status: "done", summary: "完成", call_id: "call_x2" });
  await fire(page, {
    type: "tool_call",
    name: "vault_patch",
    status: "done",
    summary: "failed · patch_conflict: 文件已被改动",
    call_id: "call_x1",
  });

  await expect(patchRow).toHaveClass(/is-fail/);
  await expect(patchRow.locator(".lumir-hp-tool-out")).toContainText("文件已被改动");
  await expect(cliRow).not.toHaveClass(/is-fail/);
  await expect(page.locator(".lumir-hp-tool-row")).toHaveCount(2);
});

test("快照恢复的待批：决策乱序仍按工具名 + 到达顺序 FIFO 配对 done", async ({ page }) => {
  // 快照的待决列表没有 call_id（PendingApprovalSnapshot 不带），前端只能用同名 FIFO。
  // 队列序取**到达序**（快照列表序 = 调用序），不是用户决策序：这里先决策 B 再决策 A，
  // 后端仍按调用序执行（A done 先到），失败必须贴到 A（第一项）。若按决策序建队会贴错 B。
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__pendingApprovalList = [
      { id: "ap-snap-a", tool: "cli_run", argv: ["echo", "A"] },
      { id: "ap-snap-b", tool: "cli_run", argv: ["echo", "B"] },
    ];
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(2);
  // 决策乱序：先 B 后 A。
  await page.locator('button[data-act="approve"]').last().click();
  await expect(page.locator('button[data-act="approve"]')).toHaveCount(1);
  await page.locator('button[data-act="approve"]').first().click();
  await expect(page.locator(".lumir-hp-pend")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-termwrap .lumir-hp-tool-row")).toHaveCount(2);

  const rows = page.locator(".lumir-hp-termwrap .lumir-hp-tool-row");
  const rowA = rows.filter({ hasText: "echo A" });
  const rowB = rows.filter({ hasText: "echo B" });
  await fire(page, {
    type: "tool_call",
    name: "cli_run",
    status: "done",
    summary: "failed · io: A 写盘失败",
    call_id: "call_snap_a",
  });
  await fire(page, { type: "tool_call", name: "cli_run", status: "done", summary: "完成", call_id: "call_snap_b" });

  await expect(rowA).toHaveClass(/is-fail/);
  await expect(rowA.locator(".lumir-hp-tool-out")).toContainText("A 写盘失败");
  await expect(rowB).not.toHaveClass(/is-fail/);
  await expect(page.locator(".lumir-hp-tool-row")).toHaveCount(2);
});

test("正常终态后清理配对表：新一轮复用同一 call_id 不被陈旧 tombstone 吞掉", async ({ page }) => {
  // 本地起一轮（in_flight:false → 发送建立 running，midTakeover=false）：终态不走 content
  // 对账，才能单独判「正常终态」这条清理路径。
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__pendingApprovalList = [];
    (window as unknown as Record<string, unknown>).__inFlight = false;
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await page.locator(".lumir-hp-composer .cm-content").fill("第一轮");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-stage")).toHaveText("等待响应…");
  await startAndRequestApproval(page, {
    callId: "call_reuse",
    approvalId: "ap-reuse-1",
    tool: "cli_run",
    args: { argv: ["echo", "A"] },
  });
  await page.locator('button[data-act="approve"]').click();
  await fire(page, { type: "tool_call", name: "cli_run", status: "done", summary: "完成", call_id: "call_reuse" });
  await expect(page.locator(".lumir-hp-termwrap .lumir-hp-tool-row")).toHaveCount(1);
  // 正常终态（pending 已空）：撤回函数必须仍清掉已消费的配对记录。
  await fire(page, { type: "done" });
  await expect(page.locator(".lumir-hp-stage")).toBeHidden();

  // 新一轮：同一 call_id 再次出现（碰撞场景），done 必须能收口新行而不是被旧 consumed 吞掉。
  await page.locator(".lumir-hp-composer .cm-content").fill("新一轮");
  await page.locator(".lumir-hp-send").click();
  await expect(page.locator(".lumir-hp-stage")).toHaveText("等待响应…");
  await fire(page, { type: "tool_call", name: "cli_run", status: "started", summary: "{\"command\":\"echo\",\"args\":[\"C\"]}", call_id: "call_reuse" });
  await expect(page.locator(".lumir-hp-tool-row.is-running")).toHaveCount(1);
  await fire(page, {
    type: "tool_call",
    name: "cli_run",
    status: "done",
    summary: "failed · io: 新一轮失败",
    call_id: "call_reuse",
  });
  await expect(page.locator(".lumir-hp-tool-row.is-running")).toHaveCount(0);
  const newRow = page.locator(".lumir-hp-tool-row.is-fail").last();
  await expect(newRow.locator(".lumir-hp-tool-out")).toContainText("新一轮失败");
});

// ── r3：同一 turn 内 call_id 复用（无整轮 done 间隔）────────────────────────────────
//
// 后端只在单个 TurnOutput 内按 call_id 去重；工具循环连续消费多个 output，同一 turn 内可以
// 再次出现相同 call_id。`tool_call started` 因此是**新调用的权威起点**：它必须让该 id 的旧
// consumed / FIFO 配对退役（旧 transcript 行保留），否则新调用的 done 会命中旧 tombstone
// 直接 return，running 行永不收口。

async function approveAThenStartB(
  page: Page,
  options: { bNeedsApproval: boolean },
): Promise<{ aRow: ReturnType<Page["locator"]>; bRow: ReturnType<Page["locator"]> }> {
  await openEmptyRunningPanel(page);
  // A：批准 → 完成（同一 turn 继续，不发整轮 done）。
  await startAndRequestApproval(page, {
    callId: "call_same_turn",
    approvalId: "ap-a",
    tool: "cli_run",
    args: { argv: ["echo", "A"] },
  });
  await page.locator('button[data-act="approve"]').click();
  await fire(page, { type: "tool_call", name: "cli_run", status: "done", summary: "完成", call_id: "call_same_turn" });
  const aRow = page.locator(".lumir-hp-tool-row").filter({ hasText: "echo A" });
  await expect(aRow).toHaveClass(/is-done/);

  // B：同一 call_id 的新一代调用；按需走批准闸。
  if (options.bNeedsApproval) {
    await startAndRequestApproval(page, {
      callId: "call_same_turn",
      approvalId: "ap-b",
      tool: "cli_run",
      args: { argv: ["echo", "B"] },
    });
    await expect(page.locator(".lumir-hp-tool-row.is-running")).toHaveCount(1);
    await page.locator('button[data-act="approve"]').click();
  } else {
    await fire(page, {
      type: "tool_call",
      name: "cli_run",
      status: "started",
      summary: "{\"command\":\"echo\",\"args\":[\"B\"]}",
      call_id: "call_same_turn",
    });
    await expect(page.locator(".lumir-hp-tool-row.is-running")).toHaveCount(1);
  }
  const bRow = page.locator(".lumir-hp-tool-row").filter({ hasText: "echo B" });
  return { aRow, bRow };
}

test("同 turn 内 call_id 复用（B 免批准）：旧 consumed 不吞新 done，旧行不改，重复新 done 幂等", async ({
  page,
}) => {
  const { aRow, bRow } = await approveAThenStartB(page, { bNeedsApproval: false });
  await fire(page, {
    type: "tool_call",
    name: "cli_run",
    status: "done",
    summary: "failed · io: B 同轮失败",
    call_id: "call_same_turn",
  });

  // 新行收口：running 退场、失败归属 B；旧 A 行保持「已采纳」不被改写。
  await expect(page.locator(".lumir-hp-tool-row.is-running")).toHaveCount(0);
  await expect(bRow).toHaveClass(/is-fail/);
  await expect(bRow.locator(".lumir-hp-tool-out")).toContainText("B 同轮失败");
  await expect(aRow).toHaveClass(/is-done/);
  await expect(aRow.locator(".lumir-hp-tool-out")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-termwrap .lumir-hp-tool-row")).toHaveCount(1);

  // 重复新的 done 幂等：不新建行、不改 A / B。
  await fire(page, {
    type: "tool_call",
    name: "cli_run",
    status: "done",
    summary: "failed · io: B 同轮失败",
    call_id: "call_same_turn",
  });
  await expect(page.locator(".lumir-hp-tool-row")).toHaveCount(2);
  await expect(aRow).toHaveClass(/is-done/);
  await expect(bRow).toHaveClass(/is-fail/);
});

test("同 turn 内 call_id 复用（B 也需批准）：新一代配对覆盖旧记录，A 行不被改写", async ({ page }) => {
  const { aRow, bRow } = await approveAThenStartB(page, { bNeedsApproval: true });
  await fire(page, {
    type: "tool_call",
    name: "cli_run",
    status: "done",
    summary: "failed · io: B 再次失败",
    call_id: "call_same_turn",
  });

  await expect(bRow).toHaveClass(/is-fail/);
  await expect(bRow.locator(".lumir-hp-tool-out")).toContainText("B 再次失败");
  await expect(aRow).toHaveClass(/is-done/);
  await expect(aRow.locator(".lumir-hp-tool-out")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-tool-row.is-running")).toHaveCount(0);
  await expect(page.locator(".lumir-hp-termwrap .lumir-hp-tool-row")).toHaveCount(2);
});

test("Web Ask：完整 query / URL、origin、provider、双路外发、费用与 untrusted 同源呈现", async ({ page }) => {
  await stubPendingApproval(page, {
    id: "ap-web-fetch",
    tool: "web_fetch",
    reason: { kind: "web_access_policy", approval: "ask" },
    web: {
      operation: "fetch",
      url: "https://example.com/a?q=1",
      origin: "https://example.com",
      provider: "deepseek",
      provider_id: "deepseek-work",
      provider_status: "ready",
      trust: "untrusted",
      local_precheck: true,
      provider_fetch: true,
      cost_per_1000_success_cny: 5,
    },
  });
  const { card, basis } = await openApprovalPanel(page);
  await expect(basis).toHaveText("网页访问策略 = Ask");
  const web = card.locator(".lumir-hp-approval-web");
  await expect(web).toBeVisible();
  await expect(web).toContainText("https://example.com/a?q=1");
  await expect(web).toContainText("https://example.com");
  await expect(web).toContainText("deepseek-work");
  await expect(web).toContainText("HEAD / Range GET");
  await expect(web).toContainText("DeepSeek");
  await expect(web).toContainText("5 元 / 1000 次");
  await expect(web).toContainText("untrusted");
  await expect(card.locator(".lumir-hp-argv")).toContainText("https://example.com/a?q=1");
  await expect(card.locator('[data-act="approve-remember"]')).toHaveCount(0);
  await expect(card.locator('[data-act="approve-persist"]')).toHaveCount(0);

  if (process.env.LUMIR_WEB_CANDIDATE_DIR !== undefined) {
    const { mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    mkdirSync(process.env.LUMIR_WEB_CANDIDATE_DIR, { recursive: true });
    await card.screenshot({ path: join(process.env.LUMIR_WEB_CANDIDATE_DIR, "web-ask-fetch.png") });
  }

  await page.locator('button[data-act="approve"]').click();
  const row = page.locator(".lumir-hp-termwrap .lumir-hp-tool-row");
  await expect(row.locator(".lumir-hp-tool-args")).toHaveText("https://example.com/a?q=1");
  await row.click();
  await expect(page.locator(".lumir-hp-term-body .lumir-hp-argv")).toContainText("https://example.com/a?q=1");
});

test("Web Search Ask：完整 query 与可空 provider 不伪造配置身份", async ({ page }) => {
  await stubPendingApproval(page, {
    id: "ap-web-search",
    tool: "web_search",
    reason: { kind: "web_access_policy", approval: "ask" },
    web: {
      operation: "search",
      query: "  synthetic full query  ",
      provider: null,
      provider_id: null,
      provider_status: "missing",
      trust: "untrusted",
      local_precheck: false,
      provider_fetch: true,
      cost_per_1000_success_cny: 5,
    },
  });
  const { card } = await openApprovalPanel(page);
  const web = card.locator(".lumir-hp-approval-web");
  await expect(web).toContainText("synthetic full query");
  await expect(web).not.toContainText("deepseek-work");
  await expect(card.locator(".lumir-hp-argv")).toContainText("synthetic full query");
  await expect(card.locator('[data-act="approve-remember"]')).toHaveCount(0);
  await expect(card.locator('[data-act="approve-persist"]')).toHaveCount(0);
});

// ── 阶段5：默认无卡 Web 的紧凑结果与默认关闭审计（结构断言，不建像素基线）────────────
//
// change compact-web-search-result-summary-nov26：工具行保持单行（纯 query / URL），第二行是
// 结果健康摘要 + 「查看详情」；审计正文默认关闭，展开后完整。审计 / 健康摘要不计入组摘要的
// 调用数——单次 Web 调用不出现摘要钮，两个真实调用 + 两个审计仍显示 2。

test("默认无卡 Web：单调用不出组摘要，详情默认关闭、展开后完整", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__pendingApprovalList = [];
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await fire(page, { type: "auto_turn_started", chain_index: 1 });
  await fire(page, {
    type: "tool_call",
    name: "web_fetch",
    status: "started",
    summary: "https://example.com/a",
    call_id: "call_audit",
  });
  await fire(page, {
    type: "tool_call",
    name: "web_fetch",
    status: "done",
    summary: "完成",
    call_id: "call_audit",
    web: {
      operation: "fetch",
      query: null,
      url: "https://example.com/a",
      provider: null,
      provider_id: null,
      attempts: 0,
      cost_per_1000_success_cny: 5,
      local_precheck: false,
      provider_fetch: false,
      trust: "untrusted",
      truncated: false,
      truncated_fields: [],
      code: "web_provider_unconfigured",
      result_count: null,
      result_text_bytes: null,
    },
  });
  const block = page.locator(".lumir-hp-tools");
  await expect(block.locator(".lumir-hp-tool-summary")).toHaveCount(0, {
    timeout: 2000,
  });
  const unit = block.locator(".lumir-hp-web-unit");
  await expect(unit).toHaveCount(1);
  const audit = unit.locator(".lumir-hp-web-audit");
  await expect(audit).toBeHidden();
  const toggle = unit.locator(".lumir-hp-web-detail-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("查看详情");
  await expect(unit.locator(".lumir-hp-web-health")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(audit).toBeVisible();
  await expect(audit).toContainText("未解析");
  await expect(audit).toContainText("尝试次数");
  await expect(audit).toContainText("untrusted data");
  await expect(audit).not.toContainText("HEAD / Range GET");
  await toggle.click();
  await expect(audit).toBeHidden();
  const order = await block.evaluate((el) => [...el.children].map((child) => child.className));
  const rowIndex = order.findIndex((name) => name.includes("lumir-hp-tool-row"));
  const unitIndex = order.findIndex((name) => name.includes("lumir-hp-web-unit"));
  expect(rowIndex).toBeGreaterThanOrEqual(0);
  expect(unitIndex).toBeGreaterThan(rowIndex);
});

test("Search 成功：第二行结果健康摘要，N 与字节来自预算后读数", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__pendingApprovalList = [];
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await fire(page, { type: "auto_turn_started", chain_index: 1 });
  await fire(page, {
    type: "tool_call",
    name: "web_search",
    status: "started",
    summary: "synthetic query",
    call_id: "call_search",
  });
  await fire(page, {
    type: "tool_call",
    name: "web_search",
    status: "done",
    summary: "成功",
    call_id: "call_search",
    web: {
      operation: "search",
      query: "synthetic query",
      url: null,
      provider: "deepseek",
      provider_id: "deepseek-work",
      attempts: 1,
      cost_per_1000_success_cny: 5,
      local_precheck: false,
      provider_fetch: true,
      trust: "untrusted",
      truncated: true,
      truncated_fields: ["results[].content"],
      code: null,
      result_count: 2,
      result_text_bytes: 24_000,
    },
  });
  const block = page.locator(".lumir-hp-tools");
  await expect(block.locator(".lumir-hp-web-health")).toHaveText(
    "2 条结果 · 文本 23 KB · 已截断",
  );
  await expect(block.locator(".lumir-hp-tool-summary")).toHaveCount(0);
  await expect(block.locator(".lumir-hp-web-audit")).toBeHidden();
});

test("两个真实调用 + 两个审计：组摘要计 2，展开后各审计仍默认关闭", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__pendingApprovalList = [];
  });
  await page.goto("/");
  await page.locator('.ft-row[title="harness-note.md"]').click();
  await page.locator(".lumir-hp-toggle").click();
  await expect(page.locator(".lumir-harness")).toBeVisible();
  await fire(page, { type: "auto_turn_started", chain_index: 1 });
  for (const [index, callId] of [
    [1, "call_a"],
    [2, "call_b"],
  ] as const) {
    await fire(page, {
      type: "tool_call",
      name: "web_search",
      status: "started",
      summary: `synthetic query ${index}`,
      call_id: callId,
    });
    await fire(page, {
      type: "tool_call",
      name: "web_search",
      status: "done",
      summary: "成功",
      call_id: callId,
      web: {
        operation: "search",
        query: `synthetic query ${index}`,
        url: null,
        provider: "deepseek",
        provider_id: "deepseek-work",
        attempts: 1,
        cost_per_1000_success_cny: 5,
        local_precheck: false,
        provider_fetch: true,
        trust: "untrusted",
        truncated: false,
        truncated_fields: [],
        code: null,
        result_count: index,
        result_text_bytes: index * 1024,
      },
    });
  }
  await fire(page, { type: "done" });
  const block = page.locator(".lumir-hp-tools");
  const summary = block.locator(".lumir-hp-tool-summary");
  await expect(summary).toHaveAttribute("data-count", "2");
  await expect(summary).toContainText("2 个工具调用");
  const audits = block.locator(".lumir-hp-web-audit");
  const units = block.locator(".lumir-hp-web-unit");
  await expect(audits).toHaveCount(2);
  await expect(units).toHaveCount(2);
  await expect(units.first()).toBeHidden();
  await summary.click();
  await expect(units.first()).toBeVisible();
  await expect(units.nth(1)).toBeVisible();
  await expect(audits.first()).toBeHidden();
  await expect(audits.nth(1)).toBeHidden();
  const toggles = block.locator(".lumir-hp-web-detail-toggle");
  await toggles.first().click();
  await expect(audits.first()).toBeVisible();
  await expect(audits.nth(1)).toBeHidden();
});
