import { defineConfig } from "@playwright/test";

// 多 worktree 并行跑场景时 4173 会撞车（reuseExistingServer 会错用别的 worktree
// 的 dist），LUMIR_VISUAL_PORT 指定独立端口即可隔离；缺省保持 4173 不变。
const port = Number(process.env.LUMIR_VISUAL_PORT ?? 4173);

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
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `pnpm exec vite preview --port ${port} --strictPort`,
    cwd: "../..",
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.LUMIR_VISUAL_FRESH_SERVER,
    timeout: 60_000,
  },
});
