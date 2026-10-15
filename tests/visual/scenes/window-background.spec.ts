import { expect, test } from "@playwright/test";
import { stubTauri, windowBgCalls } from "./tauri-stub";

// M525 合同场景（openspec/specs/app-window「窗口底色跟随主题」）：纯结构 / 计算属性断言，
// 零像素断言——body 底色在稳态下被 .app-shell（--frame）完全覆盖，整页基线天然无感，
// 这里的判据是计算属性本身与后端同步通道。
//
// 不变量：任意主题档下 getComputedStyle(body).backgroundColor == 该档 --content-bg 的
// 解析值（双重锚定：先与该档字面 RGB 逐值相等，再与 token 解析值逐值相等——前者防
// 「token 与场景一起改错」，后者防「body 写成了别的变量」），且 applyTheme 把同一 RGB
// 经 window_set_background_color 送达后端（启动一次 + 每次切换一次）。

/** 三档主题的字面期望（= src/style.css token 块当前值；token 改值时这里同步改）。 */
const THEMES = [
  { theme: "light", rgb: "rgb(253, 253, 252)" },
  { theme: "dark", rgb: "rgb(34, 35, 38)" },
  { theme: "eink", rgb: "rgb(255, 255, 255)" },
] as const;

/** 读 body 计算底色 + 当前档 `--content-bg` 的解析值（用一次性探针元素解析 token 原文）。 */
async function bodyAndToken(page: import("@playwright/test").Page): Promise<{ body: string; token: string }> {
  return page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = getComputedStyle(document.documentElement)
      .getPropertyValue("--content-bg")
      .trim();
    document.body.append(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { body: getComputedStyle(document.body).backgroundColor, token };
  });
}

function rgbComponents(rgb: string): { r: number; g: number; b: number } {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(rgb);
  if (m === null) throw new Error(`场景 fixture 的 RGB 字面量不合法：${rgb}`);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

for (const { theme, rgb } of THEMES) {
  test(`启动主题 ${theme}：body 底色 == --content-bg == ${rgb}，且同步到后端`, async ({ page }) => {
    await stubTauri(page, { entries: [], files: {}, config: { theme } });
    await page.goto("/");
    // applyTheme 在 configGet 落地后跑：轮询等同步调用落桩，避免与装载竞态。
    await expect
      .poll(async () => (await windowBgCalls(page)).length, { message: "启动后应收到一次窗口底色同步" })
      .toBeGreaterThanOrEqual(1);
    const { body, token } = await bodyAndToken(page);
    expect(body).toBe(rgb); // 字面锚
    expect(body).toBe(token); // token 锚
    expect(await windowBgCalls(page)).toContainEqual(rgbComponents(rgb));
  });
}

test("运行期切主题：body 底色与窗口底色同步跟随", async ({ page }) => {
  await stubTauri(page, { entries: [], files: {}, config: { theme: "light" } });
  await page.goto("/");
  await expect
    .poll(async () => (await windowBgCalls(page)).length, { message: "启动后应收到一次窗口底色同步" })
    .toBeGreaterThanOrEqual(1);

  // modeline 主题钮 = cycleTheme 同一条实现路径（design §3.4），逐档点过去。
  const order = THEMES.slice(1); // light 已施加，循环保序的后两档
  for (const { theme, rgb } of order) {
    const callsBefore = (await windowBgCalls(page)).length;
    await page.locator(".modeline-theme").click();
    await expect
      .poll(async () => (await windowBgCalls(page)).length, { message: `切到 ${theme} 后应再收到一次同步` })
      .toBe(callsBefore + 1);
    const { body, token } = await bodyAndToken(page);
    expect(body).toBe(rgb);
    expect(body).toBe(token);
    expect((await windowBgCalls(page)).at(-1)).toEqual(rgbComponents(rgb));
  }
});
