import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { DEMO_VAULT, sessionPuts, stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 多 vault 切换器（M163 落地 / M164 补视觉门禁）的元素级回归。
//
// 为什么要有这个场景（与 toc-outline.spec.ts 同因，实测结论）：
//   1. **形态 A 让「切换」文字按钮退场**——那是一条「删 UI 元素」级变化，而整页容差的
//      `maxDiffPixelRatio: 0.001`（1200×800 ≈ 960 px）正好能吞掉一个 37×21 按钮（≈777 px）：
//      整页基线会继续以「无差异」通过（REVIEW.md 「容差吞掉真实变化」条的 c9a3c20 现场就是这么溜过去的）。
//      因此这里对**元素级**截图（树头部、浮层本体）建基线，容差按元素盒算，不靠整页兜底。
//   2. **真机套件验不到几何**：AX 不给宽度、间距、溢出关系，而「浮层宽度允许溢出左栏」「浮层不占
//      常驻行高」都是本 change 明确的口径（design 说明第 12 条 / 任务 3.2）——只能在 chromium 侧钉。
//
// 已知边界：`.vault-row` 的行序断言钉的是「前端**不**重排」——注册表排序的唯一真源在后端
// （`list_vaults`：可用项在前 → 最近打开倒序 → id 兜底），桩按书写顺序返回。因此 fixture 的行序
// 刻意与「按可用性 / 按时间重排后的结果」不同：前端一旦自己排序，行序断言必红。

const VAULT_A = "fixture-vault";
const VAULT_B = "fixture-vault-b";
const VAULT_B_ROOT = "/Users/alex/notes-vault";

/** 注册表 fixture：失效行在前（后端把不可用项沉底，这里刻意不按那个顺序写）。 */
const REGISTRY: VaultListRow[] = [
  { id: "vault-gone", path: "/Volumes/ext/gone", name: "gone", available: false, last_opened_at: null, tab_count: 0 },
  { id: VAULT_A, path: "/Users/alex/demo-vault", name: "demo-vault", available: true, last_opened_at: 1757000002000, tab_count: 2 },
  { id: VAULT_B, path: VAULT_B_ROOT, name: "notes-vault", available: true, last_opened_at: 1757000001000, tab_count: 0 },
];

/** 切换目标 vault（vault_open_path 桩应答的完整 fixture）。 */
const VAULT_B_FIXTURE: VaultFixture & { root: string } = {
  root: VAULT_B_ROOT,
  vault_id: VAULT_B,
  entries: [
    { path: "inbox.md", kind: "file", size: 64, mtime_ms: 1757000000000 },
    { path: "note.md", kind: "file", size: 32, mtime_ms: 1757000000000 },
  ],
  files: {
    "inbox.md": "# Inbox\n\n第二个 vault 的收件箱。\n",
    "note.md": "# Note\n\n第二个 vault 的笔记。\n",
  },
};

/** 树头部入口与第一条文件行的几何（浮层不得把它们推开）。 */
function headerGeometry(page: Page) {
  return page.evaluate(() => {
    const header = document.querySelector(".ft-header")!.getBoundingClientRect();
    const row = document.querySelector(".ft-row")!.getBoundingClientRect();
    return { headerTop: header.top, headerHeight: header.height, rowTop: row.top };
  });
}

/** 打开切换器浮层（入口点击路径），并等列表渲染完成。 */
async function openSwitcher(page: Page): Promise<void> {
  await page.locator(".ft-vault").click();
  await expect(page.locator(".vault-row").first()).toBeVisible();
}

test("树头部入口：单 vault 时也在，旧的「切换」文字按钮退场", async ({ page }) => {
  // 单 vault 态（注册表只有当前项）：入口必须常驻——隐藏它会让「再加一个 vault」在界面上
  // 无处可去（口径 3 / 任务 3.1）。
  await stubTauri(page, { ...DEMO_VAULT, vaults: [REGISTRY[1]] });
  await page.goto("/");

  const entry = page.locator(".ft-vault");
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("aria-haspopup", "listbox");
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  // D96：悬停提示与读屏名是同一句话（入口就是名称本身，纯文本看不出它可点）
  await expect(entry).toHaveAttribute("aria-label", "vault：demo-vault（点击查看全部 vault）");
  await expect(entry).toHaveAttribute("title", "vault：demo-vault（点击查看全部 vault）");
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  // M217 S1+S4：caret 从文字字形 ▾ 换成 10×10 细线 SVG chevron（定稿 index.html:787-789），
  // 紧随名称、aria-hidden——断言 SVG 在场且不再有文字字形。
  const vaultCaret = page.locator(".ft-vault-caret");
  await expect(vaultCaret.locator("svg")).toHaveCount(1);
  await expect(vaultCaret).toHaveText("");
  // 形态 A 下「切换」按钮退场（D4 因此停用、不复用）：类名与可读名两条路都不得命中
  await expect(page.locator(".ft-switch-btn")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "切换", exact: true })).toHaveCount(0);
  // 未展开时浮层不在布局里
  await expect(page.locator(".vault-pop")).toBeHidden();

  await expectScreenshot(page.locator(".ft-header"), "vault-entry.png");
});

test("浮层：当前项 / 摘要 / 失效行 / 新增入口，且不占常驻布局、允许溢出左栏", async ({ page }) => {
  await stubTauri(page, {
    ...DEMO_VAULT,
    vaults: REGISTRY,
    // 会话历史只给当前 vault：摘要里的数字与「现在打开」都来自它
    sessions: { [VAULT_A]: { tabs: ["README.md", "docs/guide.md"], active: "docs/guide.md" } },
  });
  await page.goto("/");
  const entry = page.locator(".ft-vault");
  // M645：两段式启动——`goto` 回来时主模块可能尚未装载，先等树头部入口与第一条文件行就位
  // 再量几何（否则 `headerGeometry` 的 querySelector 拿到 null）。
  await expect(entry).toBeVisible();
  await expect(page.locator(".ft-row").first()).toBeVisible();
  const before = await headerGeometry(page);

  await openSwitcher(page);
  const pop = page.locator(".vault-pop");
  await expect(pop).toBeVisible();
  await expect(entry).toHaveAttribute("aria-expanded", "true");
  await expect(pop.locator(".vault-list")).toHaveAttribute("role", "listbox");

  // 行序 = 桩给的顺序（= 后端排序结果），前端不重排。
  // M217 S12：路径次行按 Alex 裁决裁掉（gap 表 #12），行文本只剩「名 + 摘要」（失效行另有
  // 成因与「重新定位…」）；S13：当前行的 ✓ 槽位有字符、非当前行是空槽，因此当前行文本以 ✓ 开头。
  const rows = page.locator(".vault-row");
  await expect(rows).toHaveCount(3);
  await expect(rows).toHaveText([
    /^gone还没有打开过文件路径不可用：目录被移动，或所在卷未挂载重新定位…$/,
    /^✓demo-vault当前2 个标签 · 现在打开$/,
    /^notes-vault还没有打开过文件$/,
  ]);

  // 当前项的唯一标记（M217 S13，定稿 .pop-row.cur index.html:705-707）：✓ 槽位（accent）+
  // 名 550 + 常驻 --sel 底色 + 「当前」flag 右对齐；非当前行是空白 12px 槽位（无点、无字）。
  const currentRow = page.locator(".vault-row.is-current");
  await expect(currentRow).toHaveCount(1);
  await expect(currentRow.locator(".vault-row-name")).toHaveText("demo-vault");
  await expect(currentRow.locator(".vault-row-flag")).toHaveText("当前");
  await expect(currentRow.locator(".vault-dot")).toHaveText("✓");
  await expect(page.locator(".vault-row").nth(1).locator(".vault-row-sub").first()).toHaveText("2 个标签 · 现在打开");
  const offDot = page.locator(".vault-row").nth(2).locator(".vault-dot");
  await expect(offDot).toHaveText("");
  await expect(offDot).not.toHaveClass(/is-off/);
  // flag 右对齐（margin-left:auto）：它在行内的左缘必须明显靠右，不是紧随名称
  const flagX = await currentRow.locator(".vault-row-flag").evaluate((el) => el.getBoundingClientRect().left);
  const nameRight = await currentRow.locator(".vault-row-name").evaluate((el) => el.getBoundingClientRect().right);
  expect(flagX).toBeGreaterThan(nameRight);

  // 失效行：成因（D102）+ 重定位出口（D103），语义是「不可选中」
  const missing = page.locator(".vault-row.is-missing");
  await expect(missing).toHaveCount(1);
  await expect(missing).toHaveAttribute("aria-disabled", "true");
  await expect(missing.locator(".vault-row-sub.is-warn")).toHaveText("路径不可用：目录被移动，或所在卷未挂载");
  await expect(missing.locator(".vault-row-act")).toHaveText("重新定位…");

  // 行尾移除钮（M646，change vault-and-session-removal）：当前项那一行没有（spec「当前项没有
  // 移除入口」），其余两行各一枚。移除钮与切换钮是**兄弟**——嵌套 button 在 WKWebView 里是
  // 叶子、AX 树不暴露内层（M351），所以这里同时钉住「没有嵌套」。
  await expect(page.locator(".vault-row-wrap")).toHaveCount(3);
  await expect(page.locator(".vault-row-wrap > .vault-row")).toHaveCount(3);
  await expect(page.locator(".vault-row .vault-row-del")).toHaveCount(0);
  await expect(page.locator(".vault-row-del")).toHaveCount(2);
  // 行序同上：0 = gone（失效）、1 = demo-vault（当前）、2 = notes-vault
  await expect(page.locator(".vault-row-wrap").nth(1).locator(".vault-row-del")).toHaveCount(0);
  await expect(page.locator(".vault-row-wrap").nth(0).locator(".vault-row-del")).toHaveAttribute("aria-label", "从列表移除 gone");
  await expect(page.locator(".vault-row-wrap").nth(2).locator(".vault-row-del")).toHaveAttribute("aria-label", "从列表移除 notes-vault");

  // 浮层底部的新增入口（形态 A 下浮层内唯一的新增入口）
  await expect(page.locator(".vault-add")).toHaveText("＋新增 vault…");
  await expect(page.locator(".vault-add")).toHaveAttribute("aria-label", "选择一个目录作为新 vault");

  // 浮层不占常驻行高：树头部与第一条文件行的几何逐值不变
  expect(await headerGeometry(page)).toEqual(before);
  // 宽度允许溢出左栏（design 说明第 12 条：320px vs 244px 栏宽）
  const [popWidth, paneWidth] = await Promise.all([
    pop.evaluate((el) => el.getBoundingClientRect().width),
    page.locator(".pane-filetree").evaluate((el) => el.getBoundingClientRect().width),
  ]);
  expect(popWidth).toBeGreaterThan(paneWidth);

  await expectScreenshot(pop, "vault-popover.png");

  // 关闭即消失（不占空间、不留残影）
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  await expect(entry).toHaveAttribute("aria-expanded", "false");
  expect(await headerGeometry(page)).toEqual(before);
});

test("键盘：↓ 只在可用行之间走，Enter 撞当前项只收起浮层", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY });
  await page.goto("/");
  await openSwitcher(page);

  // 游标默认落在当前项
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("demo-vault");
  // ↓ 跳过失效行（它不是候选）：demo-vault → notes-vault
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  // 到底钳制（不回到失效行，也不回卷）
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  // ⌃P 与 ↑ 等价（同一 move 实现）
  await page.keyboard.press("Control+p");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("demo-vault");

  // Enter 撞当前项 = 只收起浮层，不做一次无谓的重载（没有 vault_open_path 调用）。
  // 「没重载」的判据是上下文逐项不变：树头部名称不变 + 树里仍是当前 vault 的条目
  //（真的切走了会整树替换）。**不**断言 `.vault-row` 归零——列表 DOM 保留、只靠
  // `[hidden]` 收起，那是实现细节（每次打开会整体重渲染，断言它等于把实现钉死）。
  await page.keyboard.press("Enter");
  await expect(page.locator(".vault-pop")).toBeHidden();
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  await expect(page.locator('.ft-row[title="README.md"]')).toBeVisible();
});

test("Enter 切到目标 vault：目标装载 + 切换前把当前 vault 的会话落盘", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY, switchTo: VAULT_B_FIXTURE });
  await page.goto("/");
  // 两个标签（双击开一个、单击另一个文件再开一个——M254 起单击也开正式标签；
  // 全部有路径的标签都入会话，落盘内容用它验得到）
  await page.locator('.ft-row[title="README.md"]').dblclick();
  await page.locator('.ft-row[title="docs"]').click();
  await page.locator('.ft-row[title="docs/guide.md"]').dblclick();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".cm-content")).toContainText("指南内容");

  await openSwitcher(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  await expect(page.locator(".vault-row.is-active .vault-row-sub").first()).toHaveText("还没有打开过文件");
  await page.keyboard.press("Enter");
  await expect(page.locator(".vault-pop")).toBeHidden();

  // 整窗上下文替换：树头部与树整体换成目标 vault，旧条目不残留
  await expect(page.locator(".ft-vault-name")).toHaveText("notes-vault");
  await expect(page.locator('.ft-row[title="inbox.md"]')).toBeVisible();
  await expect(page.locator('.ft-row[title="README.md"]')).toHaveCount(0);
  // 目标没有会话历史 → 空 vault 首入态（D107 的引导盖住正文，不伪造内容）
  await expect(page.locator(".editor-notice")).toContainText("这个 vault 还没有打开的文件");
  await expect(page.locator(".tab")).toHaveCount(0);

  // 切换前 flush：会话按**稳定 id** 落盘，内容是有序的固定标签 + 激活项
  await expect.poll(async () => (await sessionPuts(page)).at(-1)).toEqual({
    vault_id: VAULT_A,
    panes: [{ tabs: ["README.md", "docs/guide.md"], active: "docs/guide.md" }],
    pane_split_ratio: 0.5,
  });
});

test("切到有历史的 vault：按会话恢复标签列表与激活项", async ({ page }) => {
  await stubTauri(page, {
    ...DEMO_VAULT,
    vaults: REGISTRY,
    switchTo: VAULT_B_FIXTURE,
    // 目标的会话历史（恢复侧唯一的输入）
    sessions: { [VAULT_B]: { tabs: ["inbox.md", "note.md"], active: "note.md" } },
  });
  await page.goto("/");
  await openSwitcher(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".vault-row.is-active .vault-row-name")).toHaveText("notes-vault");
  await page.keyboard.press("Enter");
  await expect(page.locator(".vault-pop")).toBeHidden();

  // 逐个用**固定标签**意图打开（预览意图会让第二个顶掉第一个，只剩一个标签）
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab-name")).toHaveText(["inbox.md", "note.md"]);
  // 激活项是会话里存的那个（不是退化后的第一个）——正文是它的内容
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("note.md");
  await expect(page.locator(".cm-content")).toContainText("第二个 vault 的笔记");
  // 有标签就不再是空态：引导层不残留
  await expect(page.locator(".editor-notice")).toBeHidden();
});

test("壳态装载在途时关掉该标签：不把已关闭的会话置为前台（M283 r1 P2-1）", async ({ page }) => {
  // 现场：vault 会话恢复的第二步是「装载激活项的内容」，而**标签栏在第一步（建壳）就已经齐了**
  // ——用户在读盘在途的那几毫秒里点得到那个 ×。两条装载路径都在读盘前早早绑定了会话对象，
  // 而 `isCurrent(request)` 只挡 vault 切换（`editor.reset()`），不挡单个标签关闭
  // （`closeTabNow` 不动 `beginSwitch` 的 serial）⇒ 读回后会把一个已脱离会话表的壳置为前台：
  // 正文显示已关闭标签的内容、标签栏里却没有它。
  //
  // 这条用例是那个时序的钉子：把目标文件的读盘拖 400ms，在窗口内关掉它。
  await stubTauri(page, {
    ...DEMO_VAULT,
    vaults: REGISTRY,
    switchTo: VAULT_B_FIXTURE,
    sessions: { [VAULT_B]: { tabs: ["inbox.md", "note.md"], active: "note.md" } },
  });
  await page.goto("/");
  // 注入延迟：只拖目标文件那一次读盘（其余命令原样透传）。测试侧的注入，产品代码不含开关。
  await page.evaluate(() => {
    const internals = (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => unknown };
    }).__TAURI_INTERNALS__;
    const original = internals.invoke.bind(internals);
    internals.invoke = (cmd, args) =>
      cmd === "fs_read_snapshot" && args?.path === "note.md"
        ? new Promise((resolve) => setTimeout(() => void resolve(original(cmd, args)), 400))
        : original(cmd, args);
  });

  await openSwitcher(page);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  // 装载窗口内：两个壳都在标签栏里（这正是缺陷可发生的条件）
  await expect(page.locator(".tab")).toHaveCount(2);

  await page.locator('.tab[data-path="note.md"] .tab-close').click();

  // 固定等过延迟窗口：判据必须落在「读盘回来之后」。这里不能用自动重试的断言顶替——
  // 它在窗口关闭前就通过，缺陷会被漏掉（去掉成员复查后本用例必须红，现场见
  // test-results/m283/p2-1-ghost-session/）。
  await page.waitForTimeout(800);

  // 关掉的标签不回来；前台是活着的那个标签，正文也是它的
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("inbox.md");
  await expect(page.locator(".cm-content")).toContainText("第二个 vault 的收件箱");
  await expect(page.locator(".cm-content")).not.toContainText("第二个 vault 的笔记");
});

test("行内两步确认：点 × 换成确认句 + 两个按钮，取消逐字还原（M646）", async ({ page }) => {
  // 这一步只走「点 × → 确认态 → 取消」：不点「移除」，因此不需要 `vault_remove` 的桩
  //（真删的完整链路归真机场景 226——它连盘上的文件一起判）。这里钉的是 DOM 形态与可访问名：
  // `×` 是图形、不成词，读屏名与 title 必须点名这一行的显示名。
  await stubTauri(page, { ...DEMO_VAULT, vaults: REGISTRY });
  await page.goto("/");
  await openSwitcher(page);

  const rows = page.locator(".vault-row-wrap");
  const del = rows.nth(2).locator(".vault-row-del");
  await expect(del).toHaveAttribute("title", "从列表移除 notes-vault");
  await del.click();

  // 确认态：确认句点名显示名 + 「移除」/「取消」两个兄弟；切换钮不在 DOM 上
  const confirm = rows.nth(2);
  await expect(confirm.locator(".vault-row-confirm")).toHaveText("从列表移除「notes-vault」？磁盘上的目录与文件不受影响。");
  await expect(confirm.locator(".vault-row-confirm-yes")).toHaveText("移除");
  await expect(confirm.locator(".vault-row-confirm-no")).toHaveText("取消");
  await expect(confirm.locator(".vault-row")).toHaveCount(0);
  // 其它行不受影响（确认态只落在被点的那一行）
  await expect(page.locator(".vault-row-del")).toHaveCount(1);

  // 取消 → 逐字还原（行名 / 摘要 / 移除钮都回来，列表不重拉）
  await confirm.locator(".vault-row-confirm-no").click();
  await expect(confirm.locator(".vault-row-name")).toHaveText("notes-vault");
  await expect(confirm.locator(".vault-row-sub").first()).toHaveText("还没有打开过文件");
  await expect(confirm.locator(".vault-row-del")).toHaveCount(1);
  await expect(page.locator(".vault-row-wrap")).toHaveCount(3);
  await expect(page.locator(".vault-pop")).toBeVisible();
});

/** 长注册表：14 行足够把 60vh 的列表顶出滚动（每行两行文本），当前项是第 0 行。 */
const LONG_REGISTRY: VaultListRow[] = Array.from({ length: 14 }, (_, i) => ({
  id: i === 0 ? "fixture-vault" : `fixture-vault-${String(i).padStart(2, "0")}`,
  path: `/Users/alex/vaults/demo-vault-${i}`,
  name: `demo-vault-${String(i).padStart(2, "0")}`,
  available: true,
  last_opened_at: i === 0 ? 1757000002000 : 1757000000000 - i * 1000,
  tab_count: 0,
}));

/** 审阅证据（git 外）：像素基线更新前给 Alex 过目的对照图。 */
const REVIEW_DIR = new URL("../../../.local/reviews/ui-polish-oct24/", import.meta.url);
async function captureReview(page: Page, name: string): Promise<void> {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.locator(".vault-pop").screenshot({ path: new URL(name, REVIEW_DIR).pathname });
}

test("浮层列表滚动条：走隐藏档，任何长度下都不压行尾移除钮（M660 #1）", async ({ page }) => {
  // Alex 2026-10-24 反馈原话：「vault switch 的滚动条遮挡了移除 vault 按钮，按照我们的设计约定，
  // 滚动条有设计规则，请你修改。」设计规则 = `ui-design-system` 的「滚动条」两档（细条 4px /
  // 隐藏）；浮层列表取**隐藏档**——容器右缘 0 留白 + 逐行常驻 ✕，overlay 条与钮占同一条带，
  // 细条仍会压住钮的右缘（M658 滚动条盘点的 P1 结论；同批三处列表同档：本浮层 + harness 会话
  // 浮层 + 权限规则段）。
  //
  // 判据分两层，缺一条就会留下假绿：
  //   ① 必须**真的溢出**（scrollHeight > clientHeight）——浮层 fixture 只有两三行时滚动条不出现，
  //      任何「不遮挡」断言都测不到东西（M658 明确指出 vault-popover 像素基线因此结构性看不见
  //      本缺陷）；
  //   ② 两条通道的声明都在：`scrollbar-width: none`（标准通道）+ `.vault-list::-webkit-scrollbar
  //      { display: none }`（WKWebView / chromium 的经典通道）；再配一条实测占位读数
  //      `offsetWidth === clientWidth`（不许退回占布局的系统条）。
  await stubTauri(page, { ...DEMO_VAULT, vaults: LONG_REGISTRY });
  await page.goto("/");
  await openSwitcher(page);

  const reading = await page.evaluate(() => {
    const list = document.querySelector<HTMLElement>(".vault-list");
    if (list === null) throw new Error("浮层列表不在场");
    const cs = getComputedStyle(list);
    const buttons = [...list.querySelectorAll<HTMLElement>(".vault-row-del")];
    // 滚动能力保留的正观测：程序化滚到底（触控板 / 键盘游标走的是同一条原生滚动通道）。
    list.scrollTop = list.scrollHeight;
    const scrolledTop = list.scrollTop;
    // CSSOM：按精确选择器取声明值（子串匹配会漏进 `.lumir-hp-*` 一类名字，m628 同口径）。
    const rules: Array<{ selector: string; display: string }> = [];
    const walk = (ruleList: CSSRuleList) => {
      for (const rule of Array.from(ruleList)) {
        const anyRule = rule as unknown as {
          selectorText?: string;
          style?: CSSStyleDeclaration;
          cssRules?: CSSRuleList;
        };
        if (anyRule.cssRules !== undefined) walk(anyRule.cssRules);
        if (anyRule.selectorText?.includes("-webkit-scrollbar")) {
          rules.push({
            selector: anyRule.selectorText,
            display: anyRule.style?.display ?? "",
          });
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      let sheetRules: CSSRuleList;
      try {
        sheetRules = sheet.cssRules;
      } catch {
        continue;
      }
      walk(sheetRules);
    }
    return {
      scrollbarWidth: cs.scrollbarWidth,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      offsetWidth: list.offsetWidth,
      clientWidth: list.clientWidth,
      scrolledTop,
      buttons: buttons.length,
      rules,
    };
  });

  // ① 区分度前提：列表真的溢出。
  expect(reading.scrollHeight).toBeGreaterThan(reading.clientHeight + 40);
  // 当前项没有移除钮，其余 13 行各一枚。
  expect(reading.buttons).toBe(13);
  // 滚动能力保留（隐藏条不是「禁用滚动」）。
  expect(reading.scrolledTop).toBeGreaterThan(0);

  // ② 标准通道：none。
  expect(reading.scrollbarWidth).toBe("none");
  // ③ 经典通道：display: none。
  const bar = reading.rules.find((r) => r.selector === ".vault-list::-webkit-scrollbar");
  expect(bar, "缺 .vault-list::-webkit-scrollbar 声明").toBeTruthy();
  expect(bar!.display).toBe("none");
  // ④ 实测占位：隐藏档不占宽（任何非零值都意味着某条通道没生效）。
  expect(reading.offsetWidth - reading.clientWidth).toBe(0);

  await captureReview(page, "01-vault-popover-scrollbar-after.png");
});
