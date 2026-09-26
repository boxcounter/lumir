// 标题栏产品标识块场景（M236，change product-version-display）。
//
// 判据一律是**读数**（DOM 文本、hidden 状态、getComputedStyle、boundingBox 几何），
// 不是「某个函数被调用过」。结构层场景：无整页像素断言（标识块的视觉归属由既有整页基线
// 的自然更新覆盖，base: app-main 等）；CI 的 LUMIR_VISUAL_STRUCTURAL=1 下本场景全量照跑。
//
// 覆盖（对应 specs delta「产品名与版本号常显」四条 scenario）：
//   1. 常显与真源一致：空态（tabstrip hidden）下标识块在场、三段文案形态、钉右端；
//   2. 三主题计算样式：名 550/--text-2、版本与分隔符 400/--text-3、12.5px（--fs-ui-s）；
//   3. 窄窗退让（D2 裁决备选）：<640px 版本号退 modeline 右段尾部，≥640px 恢复，阈值边界；
//   4. 读取失败降级：桩不路由 plugin:app|name/version 时标识块整体 hidden + 一条
//      app_meta_unavailable 诊断事件，界面无占位版本号。

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { DEMO_VAULT, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

/** 与桩侧 fixture 同值（桩模拟后端，场景断言前端渲染结果——两边各写一份是刻意的：
 *  场景断言的是「前端把后端给的值如实显示出来」，共享变量会让「桩变了场景跟着变」恒真）。 */
const NAME = "Lumir";
const VERSION = "0.0.0";

async function open(page: Page, vault: VaultFixture | null = DEMO_VAULT): Promise<void> {
  await stubTauri(page, vault);
  await page.goto("/");
  await expect(page.locator(".titlebar-identity")).toBeVisible();
}

/** token 的计算值（probe 元素解析 var()，避免在场景里硬编码第二份色值）。 */
async function tokenValue(page: Page, property: "color" | "font-weight" | "font-size", token: string): Promise<string> {
  return page.evaluate(
    ([prop, tok]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(prop, `var(${tok})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(prop);
      probe.remove();
      return value;
    },
    [property, token],
  );
}

test("空态主界面：标识块在场、三段文案、钉右端（tabstrip hidden 也在右端）", async ({ page }) => {
  await open(page, null); // 未打开 vault 的空态
  const block = page.locator(".titlebar-identity");
  await expect(page.locator(".ti-name")).toHaveText(NAME);
  await expect(page.locator(".ti-sep")).toHaveText("·");
  await expect(page.locator(".ti-version")).toHaveText(VERSION);
  // tabstrip 空态 hidden——标识块凭 margin-left:auto 仍钉右端
  await expect(page.locator(".tabstrip")).toBeHidden();
  const box = (await block.boundingBox())!;
  const viewport = page.viewportSize()!;
  // 右缘 = 视口宽 - 标题栏右 padding（--sp-6 = 12px），±1px 吸收亚像素
  expect(Math.abs(box.x + box.width - (viewport.width - 12))).toBeLessThanOrEqual(1);
});

test("有标签时仍钉右端、不参与收缩（flex:none）", async ({ page }) => {
  await open(page);
  await page.locator('.ft-row[title="README.md"]').click();
  await expect(page.locator(".tabstrip")).toBeVisible();
  const block = page.locator(".titlebar-identity");
  const box = (await block.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width - (viewport.width - 12))).toBeLessThanOrEqual(1);
  // 标识块在标签区之后（与最后一个 tab 不重叠、位于其右）
  const tabBox = (await page.locator(".tab").last().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(tabBox.x + tabBox.width - 1);
});

for (const theme of ["light", "dark", "eink"] as const) {
  test(`三主题计算样式（${theme}）：名 550/--text-2，版本与分隔符 400/--text-3，12.5px`, async ({ page }) => {
    await open(page, { ...DEMO_VAULT, config: { theme } });
    // 主题经 config_get 异步施加（main.ts 启动装配），先等它落地再读计算样式
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    await expect(page.locator(".titlebar-identity")).toBeVisible();
    const styles = await page.evaluate(() => {
      const read = (sel: string) => {
        const cs = getComputedStyle(document.querySelector(sel)!);
        return { color: cs.color, weight: cs.fontWeight, size: cs.fontSize };
      };
      return { name: read(".ti-name"), sep: read(".ti-sep"), version: read(".ti-version") };
    });
    const text2 = await tokenValue(page, "color", "--text-2");
    const text3 = await tokenValue(page, "color", "--text-3");
    expect(styles.name.color).toBe(text2);
    expect(styles.name.weight).toBe("550");
    expect(styles.name.size).toBe("12.5px");
    expect(styles.sep.color).toBe(text3);
    expect(styles.sep.weight).toBe("400");
    expect(styles.version.color).toBe(text3);
    expect(styles.version.weight).toBe("400");
    expect(styles.version.size).toBe("12.5px");
    // 零组件级 eink 覆盖的反向断言：三主题下结构唯一差异只能是 token 取值
    //（色值已按主题断言；此处钉住「没有额外规则改几何」——块高仍是行内容高，不出现背景块）
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".titlebar-identity")!).backgroundColor);
    expect(bg).toBe("rgba(0, 0, 0, 0)");
  });
}

test("窄窗退让（D2 备选）：<640px 版本号退 modeline 右段尾部，恢复宽窗回到标题栏", async ({ page }) => {
  await open(page);
  await page.locator('.ft-row[title="README.md"]').click();
  await expect(page.locator(".modeline-meta")).toHaveText(/Markdown · \d+ 行 · UTF-8/);

  // 收窄到 520px：版本号（含分隔符）退出标题栏，落进 modeline 右段尾部
  await page.setViewportSize({ width: 520, height: 800 });
  await expect(page.locator(".ti-version")).toBeHidden();
  await expect(page.locator(".ti-sep")).toBeHidden();
  await expect(page.locator(".ti-name")).toBeVisible(); // 产品名留标题栏
  await expect(page.locator(".modeline-version")).toBeVisible();
  // 逐字断言 textContent（含前导空格形态「 · 0.0.0」），不用 toHaveText 的空白归一化
  expect(await page.locator(".modeline-version").evaluate((el) => el.textContent)).toBe(` · ${VERSION}`);
  // 拼接形态：modeline 右段整体读作「语法 · 行数 · UTF-8 · 版本号」
  await expect(page.locator(".modeline-right")).toHaveText(/Markdown · \d+ 行 · UTF-8 · 0\.0\.0/);
  // 标题栏标识块仍钉右端（只有产品名一段）
  const box = (await page.locator(".titlebar-identity").boundingBox())!;
  expect(Math.abs(box.x + box.width - (520 - 12))).toBeLessThanOrEqual(1);

  // 阈值边界：639 仍退让，640 恢复（matchMedia "(max-width: 639px)"）
  await page.setViewportSize({ width: 639, height: 800 });
  await expect(page.locator(".modeline-version")).toBeVisible();
  await page.setViewportSize({ width: 640, height: 800 });
  await expect(page.locator(".modeline-version")).toBeHidden();
  await expect(page.locator(".ti-version")).toBeVisible();

  // 拉宽恢复：版本号回标题栏，modeline 右段里的版本号段清空、不留残字
  await page.setViewportSize({ width: 1200, height: 800 });
  await expect(page.locator(".ti-version")).toBeVisible();
  await expect(page.locator(".ti-sep")).toBeVisible();
  await expect(page.locator(".modeline-version")).toBeHidden();
  // M237 起 modeline 右段**最末**多了一个主题指示钮（独立元素、自带文案），因此「右段整体
  // textContent」不再是 meta 的逐字形态。判据因此拆成两条，比原来那条整体断言更强：
  // ① meta 段自身锚定到行尾（语法 · 行数 · 编码）；② 版本号段清空（原来那条负向断言守的
  // 就是这一件事——「恢复原状、不留残字」）。
  await expect(page.locator(".modeline-meta")).toHaveText(/Markdown · \d+ 行 · UTF-8(?![\s\S])/);
  expect(await page.locator(".modeline-version").evaluate((el) => el.textContent)).toBe("");
  await expect(page.locator(".modeline-theme")).toHaveText("light");
});

test("读取失败降级：桩不路由 app 元信息时标识块整体隐藏 + 一条诊断事件，无占位版本号", async ({ page }) => {
  await stubTauri(page, { ...DEMO_VAULT, appMeta: false });
  await page.goto("/");
  // 编辑器照常起来（降级不阻断启动），标识块保持 hidden
  await expect(page.locator(".ft-vault-name")).toHaveText("demo-vault");
  await expect(page.locator(".titlebar-identity")).toBeHidden();
  await expect(page.locator(".modeline-version")).toBeHidden();
  // MUST NOT 显示假版本号：标题栏与 modeline 里都不出现版本号字形
  await expect(page.locator(".titlebar")).not.toContainText(VERSION);
  await expect(page.locator(".modeline")).not.toContainText(VERSION);
  // 诊断留痕：恰一条 app_meta_unavailable
  await expect.poll(async () =>
    page.evaluate(() =>
      (window as never as { __logEvents: Array<{ event: string }> }).__logEvents.filter(
        (e) => e.event === "app_meta_unavailable",
      ).length,
    ),
  ).toBe(1);
});
