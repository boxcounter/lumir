import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { COPY } from "../../../src/copy-data";
import { expectStartupScreenshot } from "./expect-screenshot";
import { stubTauri, type VaultFixture } from "./tauri-stub";

// M645（change app-splash-screen，tasks 5.1）：启动态的首帧呈现。
//
// 判的是什么：把 vault 状态冻结在「恢复中」（`restorePending: true`），启动面因此在整场
// 都在场，可以对它做结构与计算属性断言——几何逐项等于 `--layout-*` 的解析值、产品名逐字
// 来自元信息真源、标题栏占位带承载拖拽区、零 animation / transition、除产品名与阶段行外
// 没有任何文本（不伪造条目 / 计数 / 百分比）。
//
// 为什么冻结恢复：启动态在有 last_vault 的真实冷启里只活到树装载完成（大 vault 上数百 ms），
// 不冻结就没有稳定的截图对象。撤下时机本身由 startup-restore.spec.ts 与真机场景 225 判。
//
// 三主题各截一张（首帧主题正确是 D5 的一半）：`data-theme` 必须在启动面挂载**之前**写好
// ——`observeBootOrder` 的观察器是对这个先后的判别性判据（顺序反了就红，不是靠肉眼看颜色）。

/** 恢复中：vault 尚未提交（`vault_current` 按后端契约回 vault=null + restore_pending=true）。 */
const RESTORING: VaultFixture = { entries: [], restorePending: true };

/** 桩的元信息缺省值（tauri-stub 的 `appMeta`：刻意不跟随 tauri.conf.json 的真版本，
 *  见那里的注释）。产品标记必须逐字等于它——读的是真源，不是硬编码副本。 */
const STUB_PRODUCT_NAME = "Lumir";

const THEMES = ["light", "dark", "eink"] as const;

/** 记录「主题施加」与「启动面挂载」的先后（addInitScript 先于页面脚本执行）。
 *
 *  判据取两处：① 序列里第一条必须是 theme（启动层在挂载之前写 `data-theme`）；② 挂载那一刻
 *  的 `data-theme` 必须已经是当前主题。主模块的 `applyTheme` 会在启动面挂载之后**再写一次**
 *  同名属性（同一个唯一施加点，启动装配复用），因此不能拿「序列恰为两项」当判据。 */
async function observeBootOrder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __bootOrder: string[]; __themeAtSurface: string | null };
    w.__bootOrder = [];
    w.__themeAtSurface = null;
    // init script 的时点 `<html>` 可能还不存在（解析尚未产出文档元素），因此观察器挂在
    // `document` 上、用 subtree 覆盖整棵树——挂在 documentElement 上会在 null 处抛错，
    // 观察器静默装不上（实测：序列恒为空，断言以「undefined」的形状红）。
    const themeNow = document.documentElement?.dataset.theme;
    if (themeNow !== undefined && themeNow !== "") w.__bootOrder.push("theme");
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.attributeName === "data-theme" && record.target === document.documentElement) {
          w.__bootOrder.push("theme");
        }
      }
    }).observe(document, { attributes: true, attributeFilter: ["data-theme"], subtree: true });
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.id === "startup") {
            w.__bootOrder.push("surface");
            w.__themeAtSurface = document.documentElement?.dataset.theme ?? null;
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

for (const theme of THEMES) {
  test(`启动态首帧（${theme}）：几何取 token、产品名取真源、零动画`, async ({ page }) => {
    await observeBootOrder(page);
    await stubTauri(page, { ...RESTORING, config: { theme } });
    await page.goto("/");

    await expect(page.locator("#startup")).toBeVisible();
    // 壳已建出（主模块装载完成）：启动面仍在场是承载点的判据（#app 之外，见 tasks 2.1）
    await expect(page.locator(".app-shell")).toHaveCount(1);
    await expect(page.locator(".startup-mark")).toHaveText(STUB_PRODUCT_NAME);
    await expect(page.locator(".startup-phase")).toHaveText(COPY["D95"].zh);
    await expect(page.locator(".startup-open")).toHaveText("打开 vault");

    // D5：主题先于启动面挂载（首帧就在当前主题下，不是先按默认块出图再翻转）
    const boot = await page.evaluate(() => {
      const w = window as unknown as { __bootOrder: string[]; __themeAtSurface: string | null };
      return { order: w.__bootOrder, themeAtSurface: w.__themeAtSurface };
    });
    expect(boot.order[0]).toBe("theme");
    expect(boot.order).toContain("surface");
    expect(boot.themeAtSurface).toBe(theme);
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);

    // 标题栏占位带承载拖拽区（与真实壳同口径）；容器不挂 mousedown 拦截（REVIEW.md 那条）
    await expect(page.locator(".startup-titlebar")).toHaveAttribute("data-tauri-drag-region", "deep");

    const geo = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector);
        if (el === null) throw new Error(`启动面缺元素：${selector}`);
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, x: r.x, y: r.y };
      };
      const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return {
        surface: rect("#startup"),
        titlebar: rect(".startup-titlebar"),
        sidebar: rect(".startup-sidebar"),
        modeline: rect(".startup-modeline"),
        row: rect(".startup-row"),
        tokens: {
          titlebar: token("--layout-titlebar-h"),
          sidebar: token("--layout-sidebar-w"),
          modeline: token("--layout-modeline-h"),
          row: token("--layout-tree-row-h"),
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    const px = (value: string) => Number.parseFloat(value);
    // 覆盖整窗
    expect(geo.surface.x).toBeCloseTo(0, 1);
    expect(geo.surface.y).toBeCloseTo(0, 1);
    expect(geo.surface.width).toBeCloseTo(geo.viewport.width, 1);
    expect(geo.surface.height).toBeCloseTo(geo.viewport.height, 1);
    // 几何逐项等于 token 的解析值（无硬编码像素）
    expect(geo.titlebar.height).toBeCloseTo(px(geo.tokens.titlebar), 1);
    expect(geo.sidebar.width).toBeCloseTo(px(geo.tokens.sidebar), 1);
    expect(geo.modeline.height).toBeCloseTo(px(geo.tokens.modeline), 1);
    expect(geo.row.height).toBeCloseTo(px(geo.tokens.row), 1);

    // 颜色只认 token：启动面的标题栏带与真实壳同底色（--frame 的解析值随主题变）
    const backgrounds = await page.evaluate(() => ({
      surface: getComputedStyle(document.querySelector(".startup-titlebar") as Element).backgroundColor,
      shell: getComputedStyle(document.querySelector(".app-shell") as Element).backgroundColor,
    }));
    expect(backgrounds.surface).toBe(backgrounds.shell);

    // 零 animation / transition（spec「零动画」）
    const motion = await page.evaluate(() => {
      const root = document.querySelector("#startup");
      if (root === null) throw new Error("启动面不在场");
      const offenders: string[] = [];
      for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
        const style = getComputedStyle(el);
        const label = el.id !== "" ? `#${el.id}` : `.${el.className}`;
        if (style.animationName !== "none") offenders.push(`${label} animation=${style.animationName}`);
        if (style.transitionDuration !== "0s") offenders.push(`${label} transition=${style.transitionDuration}`);
      }
      return offenders;
    });
    expect(motion).toEqual([]);

    // 除产品名、阶段行与入口文字外没有任何文本；没有数字 / 百分比（不伪造条目 / 计数 / 进度）
    const texts = await page.evaluate(() => {
      const root = document.querySelector("#startup");
      if (root === null) throw new Error("启动面不在场");
      return Array.from(root.querySelectorAll("*"))
        .filter((el) => el.children.length === 0)
        .map((el) => (el.textContent ?? "").trim())
        .filter((text) => text !== "");
    });
    expect(texts).toEqual([STUB_PRODUCT_NAME, COPY["D95"].zh, "打开 vault"]);
    const surfaceText = await page.locator("#startup").innerText();
    expect(surfaceText).not.toMatch(/[0-9%]/);

    await expectStartupScreenshot(page, `startup-${theme}.png`);
  });
}

test("产品名读不到时整块隐藏——不出现占位名", async ({ page }) => {
  // `appMeta: false` = 元信息通道不可用（ACL 拒绝 / 无后端），与真实失败路径同一形态
  await stubTauri(page, { ...RESTORING, appMeta: false });
  await page.goto("/");
  await expect(page.locator("#startup")).toBeVisible();
  await expect(page.locator(".startup-mark")).toHaveCount(0);
  // 骨架与阶段行照常：隐藏的只有标记，不是整个启动面
  await expect(page.locator(".startup-row")).toHaveCount(8);
  await expect(page.locator(".startup-phase")).toHaveText(COPY["D95"].zh);
});
