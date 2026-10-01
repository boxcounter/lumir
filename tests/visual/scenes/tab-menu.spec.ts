import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { fileText, stubTauri, type VaultFixture } from "./tauri-stub";

// 标签右键菜单（M254，change tab-strip-context-menu；M300 增定位项）。
//
// 为什么要有这个场景：
//   1. 菜单浮层是**新增 UI 元素**——元素级基线钉住它的形态（整页容差吞得掉一个 160×96 的
//      浮层，REVIEW.md 第 3 条）。
//   2. 三条关闭路径 + 脏标签的逐个确认是纯 DOM 行为，真机套件（场景 50）走的右键坐标注入
//      在本机有「取不到窗口截图」的前科（M244 / M249 / M251 同族），判定因此钉在 chromium 层，
//      真机那一侧只补「真实 WKWebView + 真实文件系统」的差异。
//   3. 一条最容易写错的时序：脏标签选「保存并关闭」时，动作钮的点击 MUST NOT 冒到浮条本体的
//      「点掉即关」监听上——否则批量关闭会在保存落地之前就停手（后面的标签不被关掉，用户看到的
//      是「我选了保存并关闭，可是后面那些没关」）。这一条只能在真实事件冒泡路径上验，见最后一个用例。
//   4. M300 的定位项（「在左栏中定位到此文件」）：它唯一的几何判据是「目标行完整落在左栏可视区」
//      ——真机套件没有滚动通道（scripts/acceptance/README.md 的「没有滚动动作」条），这条只能在
//      chromium 层量；用例见本文件末尾。
//
// 桩的边界：与 tree-menu.spec.ts 相同——文件级操作由 tauri-stub 做最小模拟，不过滤非法输入。

const ALPHA = "# Alpha 标题\n\nAlpha 的第一段。\n";
const BETA = "# Beta 标题\n\nBeta 的第一段。\n";
const GAMMA = "# Gamma 标题\n\nGamma 的第一段。\n";
const DELTA = "# Delta 标题\n\nDelta 的第一段。\n";

const VAULT: VaultFixture = {
  entries: [
    { path: "alpha.md", kind: "file", size: ALPHA.length, mtime_ms: 0 },
    { path: "beta.md", kind: "file", size: BETA.length, mtime_ms: 0 },
    { path: "gamma.md", kind: "file", size: GAMMA.length, mtime_ms: 0 },
    { path: "delta.md", kind: "file", size: DELTA.length, mtime_ms: 0 },
  ],
  files: { "alpha.md": ALPHA, "beta.md": BETA, "gamma.md": GAMMA, "delta.md": DELTA },
  links: {},
};

/** 按顺序开若干标签（单击树文件 = 打开一个正式标签，M254）。 */
async function openTabs(page: Page, paths: string[]): Promise<void> {
  for (const path of paths) await page.locator(`.ft-row[title="${path}"]`).click();
  await expect(page.locator(".tab")).toHaveCount(paths.length);
  // 顺序 = 打开顺序：断言出来，后面「右侧」的判据才有确定的锚点。
  await expect(page.locator(".tab-name")).toHaveText(paths);
}

/** 右键某个标签并等菜单出现。 */
async function openTabMenu(page: Page, name: string): Promise<void> {
  await page.locator(".tab", { hasText: name }).click({ button: "right" });
  await expect(page.locator(".tab-menu")).toBeVisible();
}

/** 菜单项（按读屏名精确匹配——「Close」是「Close Other Tabs」「Close Tabs to the Right」的前缀，
 *  模糊匹配会一次命中三项，strict 模式直接报错）。 */
function menuItem(page: Page, label: string) {
  return page.getByRole("menuitem", { name: label, exact: true });
}

/** 把某个标签改脏（在编辑器里敲字）。调用方自己保证前台是它。 */
async function dirty(page: Page, text: string): Promise<void> {
  await page.locator(".cm-content").click();
  await page.keyboard.type(text);
  await expect(page.locator(".tab.is-active .tab-dirty")).toBeVisible();
}

/** 把某个 CSS 变量在当前主题下解析成计算值（不硬编码色值：token 换值时断言跟着走）。 */
async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.color = `var(${name})`;
    probe.style.backgroundColor = `var(${name})`;
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const out = `${style.backgroundColor}|${style.color}`;
    probe.remove();
    return out;
  }, token);
}

/** eink 作用域里的规则原文（CSSOM）。见 restyle-eink.spec.ts 规则⑧的说明：亚像素
 *  border-width 在 deviceScaleFactor=1 下会被向下取整到整数设备像素，计算值判不出
 *  1.4px 与 1px 的差别——判「共用皮肤那条规则同时写了两个类名」只能读原文。 */
function einkRuleTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const hits: string[] = [];
    for (const sheet of [...document.styleSheets]) {
      for (const rule of [...(sheet.cssRules ?? [])]) {
        const text = rule.cssText ?? "";
        if (text.includes('data-theme="eink"')) hits.push(text);
      }
    }
    return hits;
  });
}

test("右键标签：四项菜单在场、不改上下文、Esc 收起并归还焦点（元素级基线）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);
  // 前台是最后一个（gamma）：右键第一个标签时它不该变——「右键不改上下文」的判据
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("gamma.md");

  await openTabMenu(page, "alpha.md");
  const menu = page.locator(".tab-menu");
  await expect(menu).toHaveAttribute("role", "menu");
  await expect(menu).toHaveAttribute("aria-label", "标签操作");
  expect(await page.locator(".tab-menu .ft-menu-item").allTextContents()).toEqual([
    "在左栏中定位到此文件",
    "Close",
    "Close Other Tabs",
    "Close Tabs to the Right",
  ]);
  // 打开即持焦点，游标落在首项（键盘路径不用先按一次 ↓）——M300 起首项是定位项
  await expect(menu).toBeFocused();
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("在左栏中定位到此文件");
  await expect(menu).toHaveAttribute("aria-activedescendant", "tab-menu-item-0");
  // 只有语义类 `.tab-menu`：皮肤是 style.css 里 `.ft-menu, .tab-menu` 那一对选择器给出的，
  // 带上 `ft-menu` 会让两份菜单同时命中 `.ft-menu`（树菜单的断言因此变成 strict violation）。
  await expect(menu).toHaveClass(/tab-menu/);
  await expect(menu).not.toHaveClass(/ft-menu/);
  // 右键不改上下文：前台仍是 gamma，标签数不变
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("gamma.md");
  await expect(page.locator(".tab")).toHaveCount(3);

  await expectScreenshot(menu, "tab-menu.png");

  // 键盘游标走到第四项：选中底色与首项不同（元素基线各留一张）
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("Close Tabs to the Right");
  await expectScreenshot(menu, "tab-menu-close-right-active.png");
  // 越界钳制：末项再前进不动
  await page.keyboard.press("Control+n");
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("Close Tabs to the Right");
  await page.keyboard.press("Control+p");
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("Close Other Tabs");

  // Esc：菜单收起、不执行任何动作，焦点回到触发它的那个标签
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".tab")).toHaveCount(3);
  await expect(page.locator(".tab", { hasText: "alpha.md" }).locator(".tab-open")).toBeFocused();

  // 外部点击关闭：不执行动作、不抢焦点
  await openTabMenu(page, "alpha.md");
  await page.mouse.click(600, 400);
  await expect(menu).toBeHidden();
  await expect(page.locator(".tab")).toHaveCount(3);
});

test("Close：只关右键落在的那一条，其它标签与前台的落点都不受影响", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);

  // 前台保持 gamma（右键 beta、点关闭；被关掉的不是前台标签）
  await openTabMenu(page, "beta.md");
  await menuItem(page, "Close").click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md", "gamma.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("gamma.md");
  // 焦点落回留下的那一条标签上（不是 body）
  await expect(page.locator(".tab.is-active .tab-open")).toBeFocused();
});

test("Close Other Tabs：只剩右键那一条（它成为前台，右键时它并不在前台）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);

  await openTabMenu(page, "alpha.md");
  await menuItem(page, "Close Other Tabs").click();
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab-name")).toHaveText("alpha.md");
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("Alpha 的第一段");
});

test("Close Tabs to the Right：只关右侧，左侧与锚点都留下", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md", "delta.md"]);
  // 把前台收回到最左：关闭目标是两个都不在前台的标签，落点因此可确定
  await page.locator(".tab-open", { hasText: "alpha.md" }).click();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");

  await openTabMenu(page, "beta.md");
  await menuItem(page, "Close Tabs to the Right").click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md", "beta.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");

  // 边界：最右一条没有右侧——空动作，不报错、不弹提示
  await openTabMenu(page, "beta.md");
  await menuItem(page, "Close Tabs to the Right").click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".lumir-toast")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 脏标签的拦截（三条路径复用 M149 的既有确认流）
// ---------------------------------------------------------------------------

test("脏标签：确认流逐条弹、取消即停手（后面的标签一个都不关）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);

  // 把 beta 改脏（前台切回 beta 再敲字）
  await page.locator(".tab-open", { hasText: "beta.md" }).click();
  await dirty(page, "BBB");

  // 「Close」命中脏标签本身：先确认，不直接关
  await openTabMenu(page, "beta.md");
  await menuItem(page, "Close").click();
  const confirm = page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: "保存并关闭" })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "放弃修改并关闭" })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "取消" })).toBeVisible();
  await expect(page.locator(".tab")).toHaveCount(3);
  await confirm.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".tab")).toHaveCount(3);
  await expect(page.locator(".tab", { hasText: "beta.md" }).locator(".tab-dirty")).toBeVisible();

  // 批量路径：目标 = [beta(脏), gamma(干净)]——先弹 beta 的确认，此时 gamma 必须还在
  await openTabMenu(page, "alpha.md");
  await menuItem(page, "Close Other Tabs").click();
  const batchConfirm = page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" });
  await expect(batchConfirm).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(".tab")).toHaveCount(3);
  // 取消 = 没答复 ⇒ 停手：beta 与尚未处理的 gamma 都留下
  await batchConfirm.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".tab")).toHaveCount(3);
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md", "beta.md", "gamma.md"]);

  // 再来一次，这次选「放弃修改并关闭」：beta 关掉之后批量继续，gamma（干净）也被关掉
  await openTabMenu(page, "alpha.md");
  await menuItem(page, "Close Other Tabs").click();
  await page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" }).getByRole("button", { name: "放弃修改并关闭" }).click();
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab-name")).toHaveText("alpha.md");
  // 放弃的是内存里的修改：磁盘上的 beta 仍是原文
  expect(await fileText(page, "beta.md")).not.toContain("BBB");
});

test("脏标签：已有确认在场时批量关闭干净停手（不静默挂起、不多弹一条确认）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);

  // 先让 beta 的关闭确认在场且**不答复**：走 ⌘W（与菜单无关的那条既有路径）。
  // sticky 浮条按设计常驻，这个前置状态完全合法（reviewer r1 P2-1 的触发条件）。
  await page.locator(".tab-open", { hasText: "beta.md" }).click();
  await dirty(page, "BBB");
  await page.keyboard.press("Meta+w");
  const confirm = page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveCount(1);
  await page.locator(".tab-open", { hasText: "alpha.md" }).click();

  // 批量路径的目标 = [beta(脏、确认已在场), gamma(干净)]。走到 beta 时 `toast()` 的 sticky
  // 去重命中旧浮条——修之前，本次调用的 onDismiss 不接上线，批量 promise 永远不 resolve
  //（后续标签不关、零反馈）。修的语义：去重命中就地报告「本次提问拿不到自己的答复」，
  // 批量在 beta 之前停手。
  await openTabMenu(page, "alpha.md");
  await menuItem(page, "Close Other Tabs").click();

  await expect(page.locator(".tab")).toHaveCount(3);
  // 确认浮条仍然只有一条：批量 MUST NOT 再弹第二条把答复挂到没人接的回调上。
  await expect(page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" })).toHaveCount(1);
  // 停手是稳定的：等一拍再读，标签数与浮条数都不变（合同面——不静默关掉 gamma、
  // 也不在屏幕上留第二条确认）。注：「promise 挂起」与「干净停手」在这一刻的可见状态
  // 相同（两者都什么都不做），可观测面判不开二者；能判的是上面两条合同。
  await page.waitForTimeout(1200);
  await expect(page.locator(".tab")).toHaveCount(3);
  await expect(page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" })).toHaveCount(1);

  // 既有的那条确认仍然可用（批量没有把它顶掉或改挂回调）：答「放弃修改并关闭」→ beta 关掉，
  // gamma 留下（批量早已停手，不会借这次答复继续）。
  await confirm.getByRole("button", { name: "放弃修改并关闭" }).click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md", "gamma.md"]);
});

test("脏标签：点掉确认浮条同样停手（不算「默认放弃」）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md"]);

  await page.locator(".tab-open", { hasText: "beta.md" }).click();
  await dirty(page, "BBB");
  await page.locator(".tab-open", { hasText: "alpha.md" }).click();

  await openTabMenu(page, "alpha.md");
  await menuItem(page, "Close Other Tabs").click();
  const confirm = page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" });
  await expect(confirm).toBeVisible();
  // 点浮条本体（不是任何动作钮）：浮条收起，标签一个都不关
  await confirm.click();
  await expect(page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" })).toHaveCount(0);
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab", { hasText: "beta.md" }).locator(".tab-dirty")).toBeVisible();
});

test("脏标签：选「保存并关闭」后批量继续——动作钮的点击不被 onDismiss 抢先作废", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);

  await page.locator(".tab-open", { hasText: "beta.md" }).click();
  await dirty(page, "BBB");
  await page.locator(".tab-open", { hasText: "alpha.md" }).click();

  // 目标 = [beta(脏), gamma(干净)]：beta 走保存并关闭，gamma 应当紧接着被关掉
  await openTabMenu(page, "alpha.md");
  await menuItem(page, "Close Other Tabs").click();
  await page
    .locator(".lumir-toast", { hasText: "关闭后修改将丢失" })
    .getByRole("button", { name: "保存并关闭" })
    .click();

  // 保存落地 + beta 与 gamma 都被关掉（只剩 alpha）。
  // 若动作钮的点击冒到浮条本体的「点掉即关」监听上，批量动作会在保存落地之前就停手，
  // 这时 gamma 会留在标签栏上——这条断言就是那个形态的回归点。
  await expect(page.locator(".tab")).toHaveCount(1, { timeout: 10000 });
  await expect(page.locator(".tab-name")).toHaveText("alpha.md");
  await expect.poll(() => fileText(page, "beta.md")).toContain("BBB");
});

test("M254：共用皮肤在 eink 档下同为选中底色 + 选中前景（标签菜单也吃这套规则）", async ({ page }) => {
  await stubTauri(page, { ...VAULT, config: { theme: "eink" } });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "eink");
  await openTabs(page, ["alpha.md", "beta.md"]);

  await openTabMenu(page, "alpha.md");
  const active = page.locator(".tab-menu .ft-menu-item.is-active");
  const selBg = (await resolveToken(page, "--sel")).split("|")[0];
  const selText = (await resolveToken(page, "--sel-text")).split("|")[1];
  await expect(active).toHaveCSS("background-color", selBg);
  await expect(active).toHaveCSS("color", selText);
  await expect(page.locator(".tab-menu")).toHaveCSS("border-top-width", "1px");
  // eink 规则⑧的**线宽**判据取 CSSOM 原文，不取计算值：chromium 在 deviceScaleFactor=1 下
  // 把亚像素 border-width 向下取整到整数设备像素（实测 1.4 / 1.6px 全算成 1px，见
  // restyle-eink.spec.ts 的规则⑧用例）——计算值判不出 1.4px 与 1px 的差别，只会给出假安全。
  // 这里要证的是「共用皮肤的那条 eink 规则把两个类名都写进了同一个选择器」（一份声明两个名字），
  // 因此判据落在那条规则的原文上。
  const shared = await einkRuleTexts(page);
  const borderRule = shared.find(
    (text) => text.includes("border-width: 1.4px") && text.includes(".tab-menu"),
  );
  expect(borderRule, `eink 线宽规则：${shared.join(" | ") || "未命中"}`).toBeDefined();
  expect(borderRule).toContain(".ft-menu");
  expect(borderRule).toContain(".tab-menu");
  const activeColorRule = shared.find(
    (text) => text.includes("--sel-text") && text.includes(".tab-menu-item.is-active"),
  );
  expect(activeColorRule, "eink 选中态前景规则").toBeDefined();
  expect(activeColorRule).toContain(".ft-menu-item.is-active");
  await page.keyboard.press("Escape");
});

// ---------------------------------------------------------------------------
// M300：定位项（标签菜单 → 左栏文件树）
//
// 判据为什么落在这里：真机套件**没有滚动通道**（scripts/acceptance/README.md 的「没有滚动动作，
// 也滚不动」条，M252 三轮探针实证），因此「目标行被滚进可视区」这条几何判据只有 chromium 层量得
// 出来；真机场景 69 只补「真实 WKWebView + 真实右键通道」的祖先展开那一段。
//
// 判据形态照 M238 的「活跃标签恒完整可见」（tests/visual/scenes/m149-tabs.spec.ts）：一律读**矩形
// 包含关系**，不读 class、也不读 scrollTop 数值（REVIEW.md 第 1 条——class 断言看不出「展开对了
// 但没滚」，数值断言则把判据钉在实现的选择上）。读不到目标行一律 FAIL，不当成「无需滚动」（第 2 条）。
// ---------------------------------------------------------------------------

/** 目标行是否**完整**落在左栏可视区（`.tree-pane` 的 padding 盒）里；读不到行 = FAIL。 */
async function rowFullyVisible(page: Page, path: string): Promise<{ ok: boolean; detail: string }> {
  return page.evaluate((want) => {
    const pane = document.querySelector(".tree-pane") as HTMLElement | null;
    const li =
      [...document.querySelectorAll<HTMLElement>(".ft-item")].find((el) => el.dataset.path === want) ?? null;
    const row = li?.querySelector<HTMLElement>(".ft-row") ?? null;
    if (pane === null || row === null) {
      return { ok: false, detail: `读不到左栏或 ${want} 这一行（判 FAIL，不当作无需滚动）` };
    }
    const box = pane.getBoundingClientRect();
    const top = box.top + pane.clientTop;
    const bottom = top + pane.clientHeight;
    const rect = row.getBoundingClientRect();
    return {
      ok: rect.top >= top - 0.5 && rect.bottom <= bottom + 0.5,
      detail: `可视区=[${Math.round(top)},${Math.round(bottom)}] 目标行=[${Math.round(rect.top)},${Math.round(rect.bottom)}]`,
    };
  }, path);
}

/** 定位场景的 vault：40 个根级目录（排序上目录在文件之前、行高 25px ⇒ 光根列就 1000px）把后段的
 *  行挤出左栏；目标落在外层目录的两级子目录下，且**由会话恢复带出来**——本会话从没在树里展开过
 *  它所在的目录，树模型里那几行根本不在场（这正是定位最需要的形态，也是「先确认可达再动手」那一
 *  段的判据来源）。 */
function revealVault(): VaultFixture {
  const entries: unknown[] = [];
  const files: Record<string, string> = {};
  for (let i = 1; i <= 40; i += 1) {
    const dir = `d-${String(i).padStart(2, "0")}`;
    const text = `# ${dir}\n\n这一层用来把根列撑满。\n`;
    entries.push({ path: dir, kind: "dir", size: 0, mtime_ms: 0 });
    entries.push({ path: `${dir}/note.md`, kind: "file", size: text.length, mtime_ms: 0 });
    files[`${dir}/note.md`] = text;
  }
  const target = "d-40/deep/target.md";
  const targetText = "# 目标\n\n这一篇在两级子目录里。\n";
  entries.push({ path: "d-40/deep", kind: "dir", size: 0, mtime_ms: 0 });
  entries.push({ path: target, kind: "file", size: targetText.length, mtime_ms: 0 });
  files[target] = targetText;
  return {
    entries,
    files,
    links: {},
    // 两个标签：前台是根目录里的那一篇（它的行在树里是**折叠态**，因此树上没有当前行），
    // 右键落在深标签上——「定位不改上下文」因此有可判的锚点。
    sessions: {
      "fixture-vault": { tabs: ["d-01/note.md", target], active: "d-01/note.md" },
    },
  };
}

test("M300 定位项：展开祖先、目标行滚进左栏可视区并成为当前行，前台标签不变", async ({ page }) => {
  await stubTauri(page, revealVault());
  await page.goto("/");
  const target = "d-40/deep/target.md";
  const row = page.locator(`.ft-item[data-path="${target}"] > .ft-row`);

  // 起点：会话恢复出两个标签，前台是 d-01/note.md；树全折叠——深标签的那一行**根本不在场**
  await expect(page.locator(".tab-name")).toHaveText(["note.md", "target.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("note.md");
  await expect(row).toHaveCount(0);
  // 左栏确实溢出（否则「滚进可视区」这条在装得下的树上恒真，REVIEW.md 第 2 条）
  const overflow = await page.evaluate(() => {
    const pane = document.querySelector(".tree-pane") as HTMLElement;
    return { scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight };
  });
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight);
  // 反向对照：同一读数口径在「存在但在可视区之外」的行上必须给出 false——根列末行 d-40 只是被
  // 裁掉（不是没渲染），它证明这条包含判据有区分度，而不是恒真。
  const offscreen = await rowFullyVisible(page, "d-40");
  expect(offscreen.ok, `反向对照（应判 false）：${offscreen.detail}`).toBe(false);

  await openTabMenu(page, "target.md");
  await menuItem(page, "在左栏中定位到此文件").click();

  // 祖先逐级展开：两级目录行都在场，目标行在场
  await expect(page.locator('.ft-row[title="d-40/deep"]')).toHaveCount(1);
  await expect(row).toHaveCount(1);
  // 目标行完整落在左栏可视区里（这一条就是「滚进视口」的判据）
  const visible = await rowFullyVisible(page, target);
  expect(visible.ok, visible.detail).toBe(true);
  // 当前行标记落在目标行上，且**只有**它带这个标记（前台文档是另一篇：定位把当前行带到被定位的
  // 那一行，multi-tabs「文件树联动与空态」把这条例外写成了规格）
  await expect(page.locator(".ft-row.is-current")).toHaveCount(1);
  await expect(row).toHaveClass(/is-current/);
  await expect(row).toHaveAttribute("aria-current", "true");
  // 定位不改上下文：前台仍是 note.md，两个标签都还在
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("note.md");
  await expect(page.locator(".tab")).toHaveCount(2);
  // 菜单已收起（定位不是模态动作）
  await expect(page.locator(".tab-menu")).toBeHidden();
});
