import { expect, test } from "@playwright/test";
import type { Locator, Page, PageAssertionsToHaveScreenshotOptions } from "@playwright/test";
import { structuralOnly } from "../playwright.config";

// 像素断言的唯一入口（M173）。全部 22 处整页 / 元素截图断言都经这里，不再直接调
// toHaveScreenshot——开关只在这一点上生效，新增像素断言一律走本函数。
//
// 为什么要有开关：CI runner 与本地渲染不等价（M172 实证，证据与口径见 tests/visual/README.md），
// 整页像素对比在两套环境下没有可比性。CI 只跑结构 / 计算属性断言（LUMIR_VISUAL_STRUCTURAL=1），
// 整页像素归本地 gate.sh visual。
//
// 置位时**不执行**对比，也不读基线：只留一行 stdout 与一条 annotation（HTML / JSON 报告里可见），
// 供「这次 run 到底跳过了哪些像素断言」逐条核对——静默跳过与「断言通过」在报告里长得一样，
// 是本仓反复踩过的假绿形态（REVIEW.md 第 1 条）。
export async function expectScreenshot(
  target: Page | Locator,
  name: string,
  options?: ScreenshotOptions,
): Promise<void> {
  if (structuralOnly) {
    test.info().annotations.push({ type: "pixel-skip", description: name });
    console.log(`[pixel-skip] ${name}`);
    return;
  }
  // chrome 就绪门（M311）：只对整页截图生效——整页把标签栏 / modeline 一起拍进去，而
  // applyLanguage（写 <html lang> + 跑 runRelabels + modeline 语言 chip 去 hidden）在启动
  // 装配里异步落地；抢在它之前拍下的就是「首帧 chrome 态」，此后每次运行都靠容差吞这段
  // 漂移（M297 实测 840–990px，贴着 0.001 容差线 960px，docs/backlog.md 有登记）。
  // `.modeline-language` 初始 hidden（src/shell.ts），由 applyLanguage 唯一去 hidden
  //（src/main.ts）——它可见即 applyLanguage 与 runRelabels 已落地，是「chrome 就绪」的
  // 可观测信号。MUST NOT 换成固定 sleep：判据必须是界面信号，不是时长。
  // 元素级截图（Locator）不含 chrome，不过这道门。
  if (!("page" in target)) {
    await waitForChromeReady(target);
  }
  await expect(target).toHaveScreenshot(name, options);
}

/** 等 applyLanguage 落地（语言 chip 可见）——整页截图的前置门，见 expectScreenshot 注释。 */
async function waitForChromeReady(page: Page): Promise<void> {
  await expect(page.locator(".modeline-language"), "chrome 就绪（applyLanguage 已落地）").toBeVisible({
    timeout: 15_000,
  });
}

/** toHaveScreenshot 的容差等覆盖项。直接取 Playwright 导出的 options 类型，避免手抄一份漂移。 */
type ScreenshotOptions = PageAssertionsToHaveScreenshotOptions;
