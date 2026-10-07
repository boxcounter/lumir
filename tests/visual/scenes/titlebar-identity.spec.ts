// 标题栏产品标识块场景（M236，change product-version-display；M346/HP1 移位：标识块进
// traffic 灯区、系统按钮旁，Alex 点子 2——标题栏右端只留 harness toggle 钮；双栏退让随
// 移位移除，唯一退让触发是窄窗 <640px 版本号退 modeline）。
//
// 判据一律是**读数**（DOM 文本、hidden 状态、getComputedStyle、boundingBox 几何），
// 不是「某个函数被调用过」。唯一例外是 M246 补的标识块元素级像素基线：三段文字的字形墨
// ≪ 整页 0.001 容差的 960px 预算，「由既有整页基线的自然更新覆盖」等于没有覆盖
// （REVIEW.md 第 3 条同族），所以形态由元素 crop 钉住；CI 的 LUMIR_VISUAL_STRUCTURAL=1
// 下该断言按 pixel-skip 留痕跳过，其余全量照跑。
//
// 覆盖（对应 specs delta「产品名与版本号常显」四条 scenario）：
//   1. 常显与真源一致：空态（tabstrip hidden）下标识块在场、三段文案形态、在 traffic 灯区内；
//   2. 三主题计算样式：名 550/--text-2、版本与分隔符 400/--text-3、12.5px（--fs-ui-s）；
//   3. 窄窗退让（D2 裁决备选）：<640px 版本号退 modeline 右段尾部，≥640px 恢复，阈值边界；
//   4. 读取失败降级：桩不路由 plugin:app|name/version 时标识块整体 hidden + 一条
//      app_meta_unavailable 诊断事件，界面无占位版本号。

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { expectScreenshot } from "./expect-screenshot";
import { DEMO_VAULT, stubTauri } from "./tauri-stub";
import type { VaultFixture } from "./tauri-stub";

/** 与桩侧 fixture 同值（桩模拟后端，场景断言前端渲染结果——两边各写一份是刻意的：
 *  场景断言的是「前端把后端给的值如实显示出来」，共享变量会让「桩变了场景跟着变」恒真）。
 *  VERSION 是钉死的桩侧 fixture 值，不跟随 tauri.conf.json 真版本（跟随会让每次版本
 *  bump 都推动本场景的像素基线，纯数字差异无判别价值，2026-10-02 Alex 裁决）。 */
const NAME = "Lumir";
const VERSION = "9.9.9";

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

test("空态主界面：标识块在场、三段文案、在 traffic 灯区内（系统按钮旁）", async ({ page }) => {
  await open(page, null); // 未打开 vault 的空态
  const block = page.locator(".titlebar-identity");
  await expect(page.locator(".ti-name")).toHaveText(NAME);
  await expect(page.locator(".ti-sep")).toHaveText("·");
  await expect(page.locator(".ti-version")).toHaveText(VERSION);
  // HP1：块在 traffic 灯区内（.titlebar-traffic 的子元素），不再钉右端
  await expect(page.locator(".titlebar-traffic .titlebar-identity")).toBeVisible();
  await expect(page.locator(".tabstrip")).toBeHidden();
  const box = (await block.boundingBox())!;
  // 落位判据：左缘起于 traffic 灯占位区之后（padding-left 78px 让出三颗系统按钮），±1px
  expect(Math.abs(box.x - 78)).toBeLessThanOrEqual(1);
  // 元素级基线（M246）：三段文字的字形墨被整页 0.001 容差吞掉，形态只能由元素 crop 钉住
  await expectScreenshot(block, "titlebar-identity-block.png");
});

test("有标签时标识块仍在 traffic 灯区；harness toggle 钉标题栏右端", async ({ page }) => {
  await open(page);
  await page.locator('.ft-row[title="README.md"]').click();
  await expect(page.locator(".tabstrip")).toBeVisible();
  const block = page.locator(".titlebar-identity");
  const box = (await block.boundingBox())!;
  // 仍在 traffic 灯区内（不随标签出现挪位）
  expect(Math.abs(box.x - 78)).toBeLessThanOrEqual(1);
  // harness toggle 在标题栏**右端**（HP1 后右簇只剩这颗钮；标识块与 toggle 不再相邻）。
  // 右缘 = 视口宽 - 钮自身 margin-right（--sp-6 = 12px；标题栏 padding-right 已归零），±2px
  const toggleBox = (await page.locator(".lumir-hp-toggle").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(toggleBox.x + toggleBox.width - (viewport.width - 12))).toBeLessThanOrEqual(2);
  // 槽位顺序的正观测：标识块（左）在标签区之前，toggle（右）在标签区之后
  expect(box.x + box.width).toBeLessThanOrEqual(236);
  const stripBox = (await page.locator(".tabstrip").boundingBox())!;
  expect(toggleBox.x).toBeGreaterThanOrEqual(stripBox.x + stripBox.width - 1);
});

test("标识块盒内任意采样点都是标题栏拖拽区（specs/ui-design-system「拖拽区共存」）", async ({ page }) => {
  await open(page);
  await page.locator('.ft-row[title="README.md"]').click();
  const block = page.locator(".titlebar-identity");
  await expect(block).toBeVisible();
  const box = (await block.boundingBox())!;

  // 真机验收场景 39 的拖拽落点（窗口局部坐标；两边同一坐标空间：本视口 1200 与验收窗口
  // 1200pt 逐值对应）。它 MUST 落在标识块盒内——落在盒外就是「在标题栏上的别的东西上起拖」，
  // 验不到本条 scenario。HP1（change move-harness-to-pane-chat-frame）把标识块从标题栏右端移进
  // traffic 灯区之后，场景 39 的旧落点 1160 正好落到右端 harness toggle 钮上：button 是 Tauri
  // drag.js 的拖拽阻断元素，窗口拖不动、断言假红，而标识块的拖拽面其实完好（M354 的根因）。
  // 改这里或改场景 39 的 {x,y} 时，两边一起改。
  const DRAG_POINT = { x: 120, y: 21 };
  expect(DRAG_POINT.x).toBeGreaterThanOrEqual(box.x);
  expect(DRAG_POINT.x).toBeLessThanOrEqual(box.x + box.width);
  expect(DRAG_POINT.y).toBeGreaterThanOrEqual(box.y);
  expect(DRAG_POINT.y).toBeLessThanOrEqual(box.y + box.height);

  // Tauri v2 注入脚本 drag.js 的拖拽阻断名单（tauri 2.11.5 的
  // src/window/scripts/drag.js：CLICKABLE_TAGS / INTERACTIVE_ROLES——`isClickableElement`）。
  // 脚本只注入 WKWebView（chromium 侧跑不到它），但「盒内有没有 drag 阻断元素」是纯几何事实、
  // 两个引擎同判，故不变量钉在这一层；真机的「窗口真的动了」由验收场景 39 守。
  // Tauri 改动这两张表时，本常量要跟着改——这是本测试唯一的外部依赖。
  const CLICKABLE_TAGS = ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY"];
  const INTERACTIVE_ROLES = ["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "option"];

  // 不变量：盒内**任意**点都是拖拽区，不是「我这个点是好的」——5×3 内点采样（避开边界半格，
  // 覆盖三段文字与两处 gap），每点的命中链按 drag.js 的 isDragRegion 复刻判一遍。
  const blockers = await page.evaluate(
    ([bx, by, bw, bh, tags, roles]: [number, number, number, number, string[], string[]]) => {
      const clickableTags = new Set(tags);
      const interactiveRoles = new Set(roles);
      const isClickable = (el: Element): boolean =>
        clickableTags.has(el.tagName) ||
        (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") ||
        (el.hasAttribute("tabindex") && el.getAttribute("tabindex") !== "-1") ||
        interactiveRoles.has(el.getAttribute("role") ?? "");
      const describe = (el: Element): string => `${el.tagName.toLowerCase()}.${el.className}`;
      const blocked: string[] = [];
      for (let i = 1; i <= 5; i++) {
        for (let j = 1; j <= 3; j++) {
          const x = bx + (bw * i) / 6;
          const y = by + (bh * j) / 4;
          const hit = document.elementFromPoint(x, y);
          let verdict = hit ? "不在任何拖拽区内" : "点不到任何元素";
          for (let el: Element | null = hit; el !== null; el = el.parentElement) {
            const region = el.getAttribute("data-tauri-drag-region");
            if (isClickable(el) && region === null) {
              verdict = `被 ${describe(el)} 阻断（clickable 且自身无 drag-region）`;
              break;
            }
            if (region === null) continue;
            if (region === "false") {
              verdict = `被 ${describe(el)} 显式禁用（data-tauri-drag-region="false"）`;
              break;
            }
            if (region === "deep") verdict = "";
            else if (el !== hit) verdict = `被 ${describe(el)} 拦下（bare drag-region 只对直击生效）`;
            else verdict = "";
            break;
          }
          if (verdict !== "") blocked.push(`(${Math.round(x)},${Math.round(y)}) ${verdict}`);
        }
      }
      return blocked;
    },
    [box.x, box.y, box.width, box.height, CLICKABLE_TAGS, INTERACTIVE_ROLES] as [
      number,
      number,
      number,
      number,
      string[],
      string[],
    ],
  );
  expect(blockers).toEqual([]);
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
  // 逐字断言 textContent（含前导空格形态「 · 9.9.9」），不用 toHaveText 的空白归一化
  expect(await page.locator(".modeline-version").evaluate((el) => el.textContent)).toBe(` · ${VERSION}`);
  // 拼接形态：modeline 右段整体读作「语法 · 行数 · UTF-8 · 版本号」。
  // 版本号段按 `VERSION` 常量拼进正则（M238：这里原先是写死的 `0\.0\.0`，版本一 bump 就与
  // 上面的常量分叉成两处真源——REVIEW.md 第 8 条；点号要转义，故用 replace 而不是模板里手写）。
  await expect(page.locator(".modeline-right")).toHaveText(
    new RegExp(`Markdown · \\d+ 行 · UTF-8 · ${VERSION.replaceAll(".", "\\.")}`),
  );
  // 标题栏标识块仍在 traffic 灯区内（只有产品名一段；窄窗下 traffic 占位宽不变）
  const box = (await page.locator(".titlebar-identity").boundingBox())!;
  expect(Math.abs(box.x - 78)).toBeLessThanOrEqual(1);

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
