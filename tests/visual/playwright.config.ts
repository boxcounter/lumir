import { defineConfig } from "@playwright/test";

// 容差集中在此处，全场景共享；单场景需要更严/更松时在断言上覆盖（见 README.md）。
// - threshold：单个像素通道色差的容忍度（0-1），吸收抗锯齿/字体渲染的机器间抖动
// - maxDiffPixelRatio：允许不同的像素占总像素的比例上限
export const tolerance = {
  threshold: 0.2,
  maxDiffPixelRatio: 0.005,
};

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
    baseURL: "http://127.0.0.1:4173",
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
    command: "pnpm exec vite preview --port 4173 --strictPort",
    cwd: "../..",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
