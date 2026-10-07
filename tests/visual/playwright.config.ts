import { defineConfig, webkit } from "@playwright/test";
import { existsSync } from "node:fs";

// 多 worktree 并行跑场景时 4173 会撞车（reuseExistingServer 会错用别的 worktree
// 的 dist），LUMIR_VISUAL_PORT 指定独立端口即可隔离；缺省保持 4173 不变。
const port = Number(process.env.LUMIR_VISUAL_PORT ?? 4173);

// 真机同款 UA（M280）：系统 WKWebView 的 UA **没有 `Version/x.y` token**（M274 的
// wkwebview-probe 真机实测）。这不是「像不像真机」的审美问题——CM6 的 `preventScrollSupported`
// 正是按 UA 里的 `Version/` 判定的（`@codemirror/view/dist/index.js:703`：Safari ≥ 26 时关掉
// preventScroll、改走它自己的同步回写栈）：
//   - Playwright WebKit 默认 UA 带 `Version/26.x` ⇒ 走**带回写兜底**的分支 ⇒ 聚焦揭示被抹平；
//   - 真机（无 token）⇒ 走原生 preventScroll 分支、没有任何回写兜底。
// 「关闭浮层交还焦点」这类缺陷在默认 UA 下**修前修后都绿**（M279 实测的假绿陷阱），因此这条
// 回归必须跑在真机同款 UA 的项目下才能判。
const REAL_WEBKIT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

// 本地装了 Playwright 的 webkit 构建才挂这个 project：CI（visual.yml）只 `playwright install
// chromium`，那里没有 webkit 也要照常跑完其余场景。缺构建时打一行日志明示本项目未执行，
// 不静默少跑——「没跑」与「跑了通过」必须在日志里分得开。
function webkitBuildPresent(): boolean {
  try {
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
}

const webkitRealuaPresent = webkitBuildPresent();
if (!webkitRealuaPresent) {
  console.log(
    "[visual] 跳过 project webkit-realua：本机没有 Playwright webkit 构建" +
      "（`pnpm --dir tests/visual exec playwright install webkit` 后可见）。",
  );
}

// 容差集中在此处，全场景共享；单场景需要更严/更松时在断言上覆盖（见 README.md）。
// - threshold：单个像素通道色差的容忍度（0-1），吸收抗锯齿/字体渲染的机器间抖动
// - maxDiffPixelRatio：允许不同的像素占总像素的比例上限。0.001（2026-09-16 Alex 裁决收紧
//   自 0.005：1200×800 下 4800px 容差曾让「删左栏 UI」级变化静默假绿，批次二实证）；
//   残余渲染抖动由 threshold 吸收，删除 UI 元素后须核对相关基线时间戳（卫生检查见 README.md）
export const tolerance = {
  threshold: 0.2,
  maxDiffPixelRatio: 0.001,
};

// 像素断言开关（M173，2026-09-18 Alex 裁决）：置位后截图的像素对比整体不执行，只留一行日志与
// annotation；结构 / 计算属性断言（DOM 结构、getComputedStyle、可见性、文字）两个模式下都照跑。
// CI 置位（.github/workflows/visual.yml），本地默认全量跑像素（scripts/visual/run.sh）。
// 依据：CI runner 与本地渲染不等价，整页像素在两套环境下没有可比性（证据与口径见 README.md）。
// 消费者是 scenes/expect-screenshot.ts——所有像素断言必须走它，直接写 toHaveScreenshot 会绕开开关。
export const structuralOnly = process.env.LUMIR_VISUAL_STRUCTURAL === "1";

export default defineConfig({
  testDir: "./scenes",
  snapshotDir: "./baselines",
  outputDir: "./test-results",
  // 截图场景串行执行，避免并发渲染引入抖动
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // 与 src-tauri/tauri.conf.json 的窗口尺寸一致。
    // 注：chromium headless shell 强制 deviceScaleFactor=1，截图为 1200x800 CSS 像素（见 README.md）。
    viewport: { width: 1200, height: 800 },
  },
  expect: {
    toHaveScreenshot: {
      threshold: tolerance.threshold,
      maxDiffPixelRatio: tolerance.maxDiffPixelRatio,
      // 冻结 CSS 动画（CodeMirror 光标闪烁），保证逐帧确定性
      animations: "disabled",
    },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    // 真机同款 UA 的 WebKit 分支（M280）：只跑阅读位置那条回归——它判的是「浮层关闭交还焦点
    // 不得改变滚动位置」，而这条判据**只有这一支**有区分度（chromium 结构性看不见、默认 UA 的
    // WebKit 被 CM 的回写兜底抹平）。其余场景不必在 WebKit 里重跑一遍。
    // M361 2.3 起 IME 组合期 Enter 场景（m361-harness-ime-enter）同列：WKWebView 的
    // 组合/确认事件序在真 WebKit 引擎里跑一遍（chromium 事件序与 WebKit 不同，单跑 chromium
    // 证不了 WebKit 序分支）。
    ...(webkitRealuaPresent
      ? [
          {
            name: "webkit-realua",
            testMatch: /m280-overlay-esc-scroll\.spec\.ts|m361-harness-ime-enter\.spec\.ts/,
            use: { browserName: "webkit" as const, userAgent: REAL_WEBKIT_UA },
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.LUMIR_VISUAL_FRESH_SERVER,
    timeout: 60_000,
  },
});
