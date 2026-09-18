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
  await expect(target).toHaveScreenshot(name, options);
}

/** toHaveScreenshot 的容差等覆盖项。直接取 Playwright 导出的 options 类型，避免手抄一份漂移。 */
type ScreenshotOptions = PageAssertionsToHaveScreenshotOptions;
