# 视觉回归门禁（tests/visual）

ADR 0001 第 5 条「极致美」的工程兜底（ADR 0004 M0 deliverable）。
门禁只守「不丑」——布局、配色、间距不回归即拒合；「美不美」的裁决权始终在 Alex 人肉，
门禁失败时若变化是有意的，更新基线即可通过（见「更新基线」）。

## 选型与 trade-off

**选中方案**：Playwright（chromium headless shell）截图 `vite build` 产物的 webview 内容，
与入库基线做像素对比。容差集中在 `playwright.config.ts` 的 `tolerance`，单场景可在断言上覆盖。

**为什么不是 Tauri 整窗截图**（本地实测后放弃）：

- 整窗截图（`screencapture` 或 tauri-driver WebDriver）依赖 CI runner 的 GUI session 与窗口查找，
  失败模式多、排障成本高；
- 截图包含 OS 渲染的标题栏与窗口装饰，runner 的 macOS 版本 / 缩放差异会引入与产品无关的噪音；
- 需要先完整 `cargo build`（首次 10 分钟级），门禁反馈慢；
- 门禁目标是布局 / 配色 / 间距，全部在 webview 内容内，整窗截图对这些目标没有增量。

**代价**：不覆盖原生窗口装饰（标题栏等）与 Tauri 壳层的视觉行为。
触发重评的信号：引入自定义 titlebar、窗口级透明度 / 圆角、或多窗口布局——届时补一个 macOS 整窗截图场景。

**其他已知口径**：chromium headless shell 强制 deviceScaleFactor=1，基线为 1200x800 CSS 像素
（viewport 与 `src-tauri/tauri.conf.json` 窗口尺寸一致）；字体走 chromium 自带渲染栈，
本地与 CI（同为 macOS arm64 + 同版本 chromium）渲染一致，残余抖动由容差吸收。
CSS 动画（CodeMirror 光标闪烁）在截图时冻结，保证逐帧确定性。

## 目录结构

```
tests/visual/
  playwright.config.ts   # 容差、viewport、webServer（vite preview）集中配置
  scenes/                # 每个 .spec.ts 是一组场景
  baselines/             # 入库的基线截图（Playwright snapshot 目录）
  package.json           # 自包含子项目：独立于根 workspace（--ignore-workspace）
scripts/visual/run.sh    # 本地一键：构建 → 装依赖 → 对比（--update 更新基线）
```

## 运行

```bash
scripts/visual/run.sh            # 本地对比（等价于 CI）
# 或分步：
pnpm build
pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile
pnpm --dir tests/visual exec playwright install chromium   # 首次
pnpm --dir tests/visual test
```

失败时 diff 制品在 `tests/visual/test-results/`（actual / expected / diff 三张图），
CI 会将其作为 artifact 上传。

## 新增场景

1. 在 `scenes/` 加一个 `.spec.ts`（或往现有 spec 加一条 `expect(page).toHaveScreenshot(...)`）；
2. 跑 `pnpm --dir tests/visual run update-baselines` 生成基线；
3. 截图人工过目后连同代码一起提交。

## 更新基线

门禁失败且变化为有意（设计演进）：`scripts/visual/run.sh --update`，
人工核对新截图后提交。这一步是「美不美」的人工裁决点，不要机械执行。

## 容差调整

全局改 `playwright.config.ts` 的 `tolerance`（`threshold` 为单像素通道色差容忍度，
`maxDiffPixelRatio` 为允许差异像素占比）；单场景在断言参数上覆盖，例如：

```ts
await expect(page).toHaveScreenshot("foo.png", { maxDiffPixelRatio: 0.01 });
```
