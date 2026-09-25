import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { DEMO_VAULT, sessionPuts, stubTauri, type VaultFixture, type VaultListRow } from "./tauri-stub";

// 多 vault 切换器（M163 落地 / M164 补视觉门禁）的元素级回归。
//
// 为什么要有这个场景（与 toc-outline.spec.ts 同因，实测结论）：
//   1. **形态 A 让「切换」文字按钮退场**——那是一条「删 UI 元素」级变化，而整页容差的
//      `maxDiffPixelRatio: 0.001`（1200×800 ≈ 960 px）正好能吞掉一个 37×21 按钮（≈777 px）：
//      整页基线会继续以「无差异」通过（REVIEW.md 第 3 条的 c9a3c20 现场就是这么溜过去的）。
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
  // 两个**固定**标签（双击 = pinned；预览标签不入会话，用它验不到落盘内容）
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
    tabs: ["README.md", "docs/guide.md"],
    active: "docs/guide.md",
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
