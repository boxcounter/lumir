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
// 是本仓反复踩过的假绿形态（REVIEW.md 「断言等价于子串」条）。
export async function expectScreenshot(
  target: Page | Locator,
  name: string,
  options?: ScreenshotOptions,
): Promise<void> {
  if (structuralOnly) {
    skipPixel(name);
    return;
  }
  // Page 与 Locator 都有 locator()，但只有 Page 有 goto()——用能力判定而不是 `"page" in target`
  // （后者在 `Page | Locator` 上不收敛）。
  const isPage = typeof (target as Page).goto === "function";
  const page = isPage ? (target as Page) : (target as Locator).page();
  // 启动面撤下门（change app-splash-screen，tasks 5.2）：启动态是整窗覆盖层，截图时它还在
  // DOM 里就是回归。判据是界面信号（`#startup` 已移除），不是固定 sleep；上界 5s 必须小于
  // 启动面的安全阀（10s）——安全阀也会撤下启动态，上界更宽的话「信号没接上」会退化成
  // 「每条场景多等 10s 但照样绿」（M645 反向验证实测：删掉 `startup?.notifyTreeReady()`
  // 之后 app-main 六条仍全绿、每条 +10s，见 tasks 5.2 的记录）。
  //
  // 这条闸门的**判别力边界**（别把它当成撤下信号的唯一防线）：交互类场景在截图之前先点
  // 界面元素，Playwright 的 actionability 会一直重试到覆盖层消失——安全阀到点把启动面撤下
  // 之后点击就成功了，因此「信号没接上」只能从**耗时**看出来，不会红。「信号有没有接上」的
  // 判别性判据在 startup-restore.spec.ts：树一就绪就断言 `#startup` 计数为 0（5s 上界 <
  // 10s 安全阀，删掉撤下信号即红——M645 反向验证实测两条转红）。
  await waitForStartupDismissed(page);
  // chrome 就绪门（M311）：只对整页截图生效——整页把标签栏 / modeline 一起拍进去，而
  // applyLanguage（写 <html lang> + 跑 runRelabels + modeline 语言 chip 去 hidden）在启动
  // 装配里异步落地；抢在它之前拍下的就是「首帧 chrome 态」，此后每次运行都靠容差吞这段
  // 漂移（M297 实测 840–990px，贴着 0.001 容差线 960px，docs/backlog.md 有登记）。
  // `.modeline-language` 初始 hidden（src/shell.ts），由 applyLanguage 唯一去 hidden
  //（src/main.ts）——它可见即 applyLanguage 与 runRelabels 已落地，是「chrome 就绪」的
  // 可观测信号。MUST NOT 换成固定 sleep：判据必须是界面信号，不是时长。
  // 元素级截图（Locator）不含 chrome，不过这道门。
  if (isPage) {
    await waitForChromeReady(target as Page);
  }
  await expect(target).toHaveScreenshot(name, options);
}

/** 启动态专用的像素断言（本模块的**唯一**例外）：启动面在场时截图，因而不等撤下门。
 *
 *  只给 change app-splash-screen 自己的启动态场景用——那个场景的前提就是「恢复冻结、启动面
 *  在场」。其余场景 MUST NOT 用它：启动面出现在它们的截图里是回归，`expectScreenshot` 的
 *  撤下门负责把它变成超时红。 */
export async function expectStartupScreenshot(
  target: Page | Locator,
  name: string,
  options?: ScreenshotOptions,
): Promise<void> {
  if (structuralOnly) {
    skipPixel(name);
    return;
  }
  await expect(target).toHaveScreenshot(name, options);
}

/** 结构性模式下像素断言整体不执行的留痕（静默跳过与「通过」在报告里长得一样）。 */
function skipPixel(name: string): void {
  test.info().annotations.push({ type: "pixel-skip", description: name });
  console.log(`[pixel-skip] ${name}`);
}

/** 等 applyLanguage 落地（语言 chip 可见）——整页截图的前置门，见 expectScreenshot 注释。 */
async function waitForChromeReady(page: Page): Promise<void> {
  await expect(page.locator(".modeline-language"), "chrome 就绪（applyLanguage 已落地）").toBeVisible({
    timeout: 15_000,
  });
}

/** 等启动面撤下（`#startup` 不在 DOM 里）——见 expectScreenshot 的撤下门注释。
 *
 *  上界 5s **必须小于启动面的安全阀**（`STARTUP_TIMEOUT_MS` = 10s，src/startup-gate.ts）：
 *  安全阀到点也会撤下启动态，若这里的上界更宽，一个「撤下信号没接上」的真回归会被安全阀
 *  掩盖成「慢一点但绿」（M645 反向验证实测：上界取 15s 时，删掉 `notifyTreeReady` 之后
 *  app-main 的四条仍全绿——每条只是多等 10s）。正常撤下 <1s，5s 留足抖动余量。 */
async function waitForStartupDismissed(page: Page): Promise<void> {
  await expect(page.locator("#startup"), "启动面已撤下（撤下信号接在既有收口上）").toHaveCount(0, {
    timeout: 5_000,
  });
}

/** toHaveScreenshot 的容差等覆盖项。直接取 Playwright 导出的 options 类型，避免手抄一份漂移。 */
type ScreenshotOptions = PageAssertionsToHaveScreenshotOptions;
