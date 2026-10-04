import { expect, test, type Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { configGets, stubTauri, type VaultFixture } from "./tauri-stub";

// M320 双 pane 视觉基线（pane-system-split-view 的基线波次；M316–M318 落了能力，
// 视觉基线刻意后置到本 mission——基线更新是 Alex 人肉裁决点，见 tests/visual/README.md）。
//
// 覆盖的表面（两条整页 + 两条标题栏元素级）：
//   1. 分栏双 pane：标题栏左右两个标签槽按比例分宽 + 分隔条 + 右簇退让
//     （标识块整体退 modeline + harness 钮隐藏——M316 的 chrome 裁决，两条都断）；
//   2. 空右 pane 形态：split 后不开文件的右 pane——空槽仍占位（keepMountWhenEmpty，
//      空槽一 hidden 另一槽的比例就漂），右 pane 正文区是**空 pane 引导水印**
//     （M322，D369；水印是透明底覆盖层，底下的未命名空文档编辑器仍在场、可聚焦）。
//      M322 落地后本条整页基线已随引导元素更新（Alex 过目批准，见 test 2 的断言注释）。
//
// 为什么标题栏要元素级基线：标题栏只有约 42px 高，整页 0.001 容差（1200×800 ≈ 960px）
// 吞得掉一条标题栏里的错位（REVIEW.md 第 3 条，M149 标签栏的同款教训——M316 把标签槽
// 从一槽变两槽，正是「元素级才守得住」的表面）。
//
// 分栏驱动走 [keys] 配置通道（pane.split / pane.close 默认不绑键，M316 把键位指配留给
// 收尾 mission）：场景绑 F2/F3，与用户自己在 config.json 里绑键是同一条生效路径。
// 单 pane 既有基线逐像素零 diff 是本 spec 的第一判据——本文件不加任何单 pane 基线，
// 全量跑时既有基线一张都不许动（禁 --update 蒙混）。

const ALPHA = "# Alpha 标题\n\nAlpha 的第一段。\n";
const BETA = "# Beta 标题\n\nBeta 的第一段。\n";

const VAULT: VaultFixture = {
  entries: [
    { path: "alpha.md", kind: "file", size: ALPHA.length, mtime_ms: 0 },
    { path: "beta.md", kind: "file", size: BETA.length, mtime_ms: 0 },
  ],
  files: { "alpha.md": ALPHA, "beta.md": BETA },
  links: {},
  // pane.* 三条默认无键（M316 表条目）：场景经 [keys] 覆盖绑 F2/F3——配置通道是用户
  // 唯一可用的绑定路径，比调内部钩子更贴近真实生效面。
  config: { keys: { F2: "pane.split", F3: "pane.close" } },
};

/** 装载 vault、开好 alpha.md，并等「配置已加载」（[keys] 覆盖在 config_get 之后才挂上）。 */
async function boot(page: Page): Promise<void> {
  await stubTauri(page, VAULT);
  await page.goto("/");
  await page.locator('.ft-row[title="alpha.md"]').click();
  await expect(page.locator(".modeline-path")).toHaveText("alpha.md");
  await expect.poll(() => configGets(page)).toBeGreaterThan(0);
  await page.waitForTimeout(80);
}

/** 标题栏右簇在双栏退让态的三条结构断言（标识块退 modeline + harness 钮隐藏）。 */
async function expectChromeRetreat(page: Page): Promise<void> {
  await expect(page.locator(".titlebar-identity")).toBeHidden();
  await expect(page.locator(".lumir-hp-toggle")).toBeHidden();
  // 退让落点：modeline 右段版本号段携带「 Lumir · 9.9.9」（stub 的固定 appMeta fixture，
  // 刻意不跟真版本——tauri-stub 的 appMeta 注释）；前导空格靠 white-space: pre 生效，
  // toHaveText 会折叠空白，这里只钉内容身份。
  await expect(page.locator(".modeline-version")).toBeVisible();
  await expect(page.locator(".modeline-version")).toHaveText(/Lumir · 9\.9\.9/);
}

/** 双栏几何不变量：两个 pane 等宽、两个标签槽等宽（比例 0.5 缺省；读不到一律 FAIL，
 *  不当成「无需比较」——REVIEW.md 第 2 条）。 */
async function expectSplitGeometry(page: Page): Promise<void> {
  const geo = await page.evaluate(() => {
    const panes = [...document.querySelectorAll<HTMLElement>(".editor-pane")];
    const strips = [...document.querySelectorAll<HTMLElement>(".tabstrip")];
    if (panes.length !== 2 || strips.length !== 2) return null;
    return {
      paneWidths: panes.map((el) => el.getBoundingClientRect().width),
      stripWidths: strips.map((el) => el.getBoundingClientRect().width),
    };
  });
  expect(geo, "读不到两个 pane 或两个标签槽（判 FAIL，不当成空）").not.toBeNull();
  const { paneWidths, stripWidths } = geo!;
  expect(
    Math.abs(paneWidths[0] - paneWidths[1]),
    `两个 pane 应等宽（0.5 缺省比例），实测 ${paneWidths[0]} vs ${paneWidths[1]}`,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(stripWidths[0] - stripWidths[1]),
    `两个标签槽应等宽（与分隔条同源比例），实测 ${stripWidths[0]} vs ${stripWidths[1]}`,
  ).toBeLessThanOrEqual(2);
}

test("分栏双 pane：双标签槽 + 分隔条 + 右簇退让（整页 + 标题栏元素级基线）", async ({ page }) => {
  await boot(page);

  // 分栏前：单 pane 常态——无分隔条、单标签槽、标识块在标题栏（基线对照面）。
  await expect(page.locator(".pane-divider")).toHaveCount(0);
  await expect(page.locator(".tabstrip")).toHaveCount(1);
  await expect(page.locator(".titlebar-identity")).toBeVisible();

  await page.keyboard.press("F2");

  // 分栏表面：分隔条 + 两个 pane 挂载元素 + 两个标签槽。
  const divider = page.locator(".pane-divider");
  await expect(divider).toBeVisible();
  await expect(divider).toHaveAttribute("role", "separator");
  await expect(divider).toHaveAttribute("aria-orientation", "vertical");
  await expect(page.locator(".editor-pane")).toHaveCount(2);
  const strips = page.locator(".tabstrip");
  await expect(strips).toHaveCount(2);
  // 左槽仍是 alpha.md；右槽空态占位（在场、零标签——keepMountWhenEmpty）。空槽是零子项的
  // flex 项：宽度按同源比例占位（几何断言在下面），但高度塌成 0（标题栏 align-items:center）
  // ——不断言 toBeVisible（Playwright 把零高盒判 hidden），断「在场且未 hidden」。
  await expect(strips.nth(0).locator(".tab-name")).toHaveText(["alpha.md"]);
  await expect(strips.nth(1)).toBeAttached();
  await expect(strips.nth(1)).not.toHaveAttribute("hidden", /.*/);
  await expect(strips.nth(1).locator(".tab")).toHaveCount(0);
  // 右簇退让与几何不变量。
  await expectChromeRetreat(page);
  await expectSplitGeometry(page);
  // 焦点落右 pane（pane.split 的用户动作落点）：右 pane 的未命名空文档成为前台。
  await expect(page.locator(".editor-pane").nth(1).locator(".cm-content")).toBeFocused();
  await expect(page.locator(".editor-pane").nth(1).locator(".cm-content")).toHaveText("");
  // 空 pane 引导（M322）：零标签的右 pane 水印在场，有标签的左 pane 不在场。
  const rightGuide = page.locator(".editor-pane").nth(1).locator(".pane-empty-guide");
  await expect(rightGuide).toBeVisible();
  await expect(page.locator(".editor-pane").nth(0).locator(".pane-empty-guide")).toBeHidden();

  // 在右 pane 打开 beta.md（树单击落活跃 pane）：右槽出标签，左槽不动，引导随之离场。
  await page.locator('.ft-row[title="beta.md"]').click();
  await expect(rightGuide).toBeHidden();
  await expect(page.locator(".editor-pane").nth(1).locator(".cm-content")).toContainText("Beta 的第一段");
  await expect(strips.nth(1).locator(".tab-name")).toHaveText(["beta.md"]);
  await expect(strips.nth(0).locator(".tab-name")).toHaveText(["alpha.md"]);
  await expect(page.locator(".editor-pane").nth(0).locator(".cm-content")).toContainText("Alpha 的第一段");
  await expect(page.locator(".modeline-path")).toHaveText("beta.md");

  // 整页像素：分栏双文档表面（布局 / 分隔条 / 双栏内容列的回归面）。
  await expectScreenshot(page, "pane-split-two-docs.png");
  // 元素级：标题栏双槽（整页容差吞得掉 42px 高的错位，见文件头注释）。
  await expectScreenshot(page.locator(".titlebar"), "pane-split-titlebar-two-docs.png");
});

test("空右 pane 形态 + 收拢复原单 pane（整页 + 标题栏元素级基线）", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("F2");

  const strips = page.locator(".tabstrip");
  await expect(strips).toHaveCount(2);
  // 空右 pane：右槽在场但零标签（零高盒，同 test 1 的注释）；正文区是空 pane 引导水印
  //（M322，D369——底下的未命名空文档编辑器仍在场、可聚焦，水印是覆盖层不是替换）。
  await expect(strips.nth(1)).toBeAttached();
  await expect(strips.nth(1)).not.toHaveAttribute("hidden", /.*/);
  await expect(strips.nth(1).locator(".tab")).toHaveCount(0);
  const rightContent = page.locator(".editor-pane").nth(1).locator(".cm-content");
  await expect(rightContent).toHaveText("");
  const guide = page.locator(".editor-pane").nth(1).locator(".pane-empty-guide");
  await expect(guide).toBeVisible();
  await expect(guide).toHaveText(/在左栏选一个文件/);
  await expect(page.locator(".editor-pane").nth(0).locator(".pane-empty-guide")).toBeHidden();
  await expect(page.locator(".editor-pane").nth(0).locator(".cm-content")).toContainText("Alpha 的第一段");
  await expectChromeRetreat(page);
  await expectSplitGeometry(page);

  await expectScreenshot(page, "pane-split-empty-right.png");
  await expectScreenshot(page.locator(".titlebar"), "pane-split-titlebar-empty-right.png");

  // 收拢（pane.close）：分隔条与第二槽移除、右簇回到标题栏、标签并入幸存 pane——
  // 单 pane DOM 与分栏前同形态（M316 的「单 pane 逐字节一致」判据的结构层）。
  await page.keyboard.press("F3");
  await expect(page.locator(".pane-divider")).toHaveCount(0);
  await expect(page.locator(".editor-pane")).toHaveCount(1);
  await expect(page.locator(".tabstrip")).toHaveCount(1);
  // 引导随分栏态消失（root pane 的常驻水印归 hidden——引导仅分栏态空 pane 在场）。
  await expect(page.locator(".pane-empty-guide")).toBeHidden();
  await expect(page.locator(".tab-name")).toHaveText(["alpha.md"]);
  await expect(page.locator(".tab.is-active .tab-name")).toHaveText("alpha.md");
  await expect(page.locator(".titlebar-identity")).toBeVisible();
  await expect(page.locator(".lumir-hp-toggle")).toBeVisible();
  await expect(page.locator(".modeline-version")).toBeHidden();
  await expect(page.locator(".modeline-path")).toHaveText("alpha.md");
  await expect(page.locator(".cm-content")).toContainText("Alpha 的第一段");
});
