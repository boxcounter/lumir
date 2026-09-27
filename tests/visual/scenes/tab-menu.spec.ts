import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { fileText, stubTauri, type VaultFixture } from "./tauri-stub";

// 标签右键菜单（M254，change tab-strip-context-menu）。
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

/** 菜单项（按读屏名精确匹配——「关闭」是「关闭其他标签」「关闭右侧标签」的前缀，
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

test("右键标签：三项菜单在场、不改上下文、Esc 收起并归还焦点（元素级基线）", async ({ page }) => {
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
    "关闭",
    "关闭其他标签",
    "关闭右侧标签",
  ]);
  // 打开即持焦点，游标落在首项（键盘路径不用先按一次 ↓）
  await expect(menu).toBeFocused();
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("关闭");
  await expect(menu).toHaveAttribute("aria-activedescendant", "tab-menu-item-0");
  // 只有语义类 `.tab-menu`：皮肤是 style.css 里 `.ft-menu, .tab-menu` 那一对选择器给出的，
  // 带上 `ft-menu` 会让两份菜单同时命中 `.ft-menu`（树菜单的断言因此变成 strict violation）。
  await expect(menu).toHaveClass(/tab-menu/);
  await expect(menu).not.toHaveClass(/ft-menu/);
  // 右键不改上下文：前台仍是 gamma，标签数不变
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("gamma.md");
  await expect(page.locator(".tab")).toHaveCount(3);

  await expectScreenshot(menu, "tab-menu.png");

  // 键盘游标走到第三项：选中底色与首项不同（元素基线各留一张）
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("关闭右侧标签");
  await expectScreenshot(menu, "tab-menu-close-right-active.png");
  // 越界钳制：末项再前进不动
  await page.keyboard.press("Control+n");
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("关闭右侧标签");
  await page.keyboard.press("Control+p");
  await expect(page.locator(".tab-menu .ft-menu-item.is-active")).toHaveText("关闭其他标签");

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

test("关闭：只关右键落在的那一条，其它标签与前台的落点都不受影响", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);

  // 前台保持 gamma（右键 beta、点关闭；被关掉的不是前台标签）
  await openTabMenu(page, "beta.md");
  await menuItem(page, "关闭").click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md", "gamma.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("gamma.md");
  // 焦点落回留下的那一条标签上（不是 body）
  await expect(page.locator(".tab.is-active .tab-open")).toBeFocused();
});

test("关闭其他标签：只剩右键那一条（它成为前台，右键时它并不在前台）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md"]);

  await openTabMenu(page, "alpha.md");
  await menuItem(page, "关闭其他标签").click();
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab-name")).toHaveText("alpha.md");
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("Alpha 的第一段");
});

test("关闭右侧标签：只关右侧，左侧与锚点都留下", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md", "gamma.md", "delta.md"]);
  // 把前台收回到最左：关闭目标是两个都不在前台的标签，落点因此可确定
  await page.locator(".tab-open", { hasText: "alpha.md" }).click();
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");

  await openTabMenu(page, "beta.md");
  await menuItem(page, "关闭右侧标签").click();
  await expect(page.locator(".tab")).toHaveCount(2);
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md", "beta.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");

  // 边界：最右一条没有右侧——空动作，不报错、不弹提示
  await openTabMenu(page, "beta.md");
  await menuItem(page, "关闭右侧标签").click();
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

  // 「关闭」命中脏标签本身：先确认，不直接关
  await openTabMenu(page, "beta.md");
  await menuItem(page, "关闭").click();
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
  await menuItem(page, "关闭其他标签").click();
  const batchConfirm = page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" });
  await expect(batchConfirm).toHaveCount(1, { timeout: 5000 });
  await expect(page.locator(".tab")).toHaveCount(3);
  // 取消 = 没答复 ⇒ 停手：beta 与尚未处理的 gamma 都留下
  await batchConfirm.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".tab")).toHaveCount(3);
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md", "beta.md", "gamma.md"]);

  // 再来一次，这次选「放弃修改并关闭」：beta 关掉之后批量继续，gamma（干净）也被关掉
  await openTabMenu(page, "alpha.md");
  await menuItem(page, "关闭其他标签").click();
  await page.locator(".lumir-toast", { hasText: "关闭后修改将丢失" }).getByRole("button", { name: "放弃修改并关闭" }).click();
  await expect(page.locator(".tab")).toHaveCount(1);
  await expect(page.locator(".tab-name")).toHaveText("alpha.md");
  // 放弃的是内存里的修改：磁盘上的 beta 仍是原文
  expect(await fileText(page, "beta.md")).not.toContain("BBB");
});

test("脏标签：点掉确认浮条同样停手（不算「默认放弃」）", async ({ page }) => {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await openTabs(page, ["alpha.md", "beta.md"]);

  await page.locator(".tab-open", { hasText: "beta.md" }).click();
  await dirty(page, "BBB");
  await page.locator(".tab-open", { hasText: "alpha.md" }).click();

  await openTabMenu(page, "alpha.md");
  await menuItem(page, "关闭其他标签").click();
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
  await menuItem(page, "关闭其他标签").click();
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

test("M254：共用皮肤在 eink 档下同为黑底反白（标签菜单也吃这套规则）", async ({ page }) => {
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
  expect(activeColorRule, "eink 选中反白规则").toBeDefined();
  expect(activeColorRule).toContain(".ft-menu-item.is-active");
  await page.keyboard.press("Escape");
});
