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
（viewport 与 `src-tauri/tauri.conf.json` 窗口尺寸一致）；残余抖动由容差吸收。
CSS 动画（CodeMirror 光标闪烁）在截图时冻结，保证逐帧确定性。

## 本地与 CI 的渲染口径：不是「一致」，是分工

**整页 / 元素像素对比只在本地跑；CI 只跑结构 / 计算属性断言。**（M173，2026-09-18 Alex 裁决）

这条口径来自一次实证：CI runner 与本地**渲染不等价**，整页像素在两套环境下没有可比性。

- CI 比对的对象与入库基线**逐字节相同**（40 张 `*-expected.png` 的 sha256 40/40 全同），
  排除「拿错基线 / 基线被改坏」；
- 差异只落在字形栅格层：CJK 与拉丁混排行被撑宽约 2.5%、纯色区与字形身份零差异、
  同一 run 的首跑与重试像素数逐位相同（确定性差异，不是抖动）；
- 两侧浏览器构建**相同**：`@playwright/test` 1.62.1 → chromium **v1234**
  （Chrome for Testing 151.0.7922.34），CI 用 `--frozen-lockfile`、本地同样冻结安装，指向同一构建。
  M173 用这套工具链在本地跑全量：**254 条全绿**，而同一批基线在 CI 红 20 条。所以差异在 runner
  侧的系统字体 / 渲染链，不在浏览器版本——结论是不修基线，改口径。

落地：

- `package.json` 把 `@playwright/test` 钉成**精确版本**（`1.62.1`，不是 caret），浏览器构建随之钉死；
- `scripts/visual/browser-build.sh` 把 playwright 版本、它要的 chromium revision、本机缓存里
  **实际存在**的构建打进日志；本地 `scripts/visual/run.sh` 与 CI 调同一份脚本，两侧日志逐行可对照；
- CI 置 `LUMIR_VISUAL_STRUCTURAL=1`：22 处像素断言不执行，只留 `[pixel-skip]` 日志与
  `pixel-skip` annotation（跳过留痕，不是静默通过），结构 / 计算属性断言照跑；
- `visual.yml` 的 runner 钉 `macos-26`——原 `macos-latest` 会静默换代，渲染环境随之漂移；
- 同口径再收一条（M176）：`scenes/lists.spec.ts` 的「100k 密集项完整回调预算与最终标记」在 CI 上
  `test.skip(!!process.env.CI)`——CI runner 渲染不动 100k 密集列表，属环境能力问题（该测试首次进 CI 的
  run `34689964849` 即 20.4s 超时失败，此后在 CI 从未绿过），不是回归。本地不受影响：`scripts/gate.sh visual`
  的默认全量模式照跑它（本地约 21s），单跑这一条用 `scripts/visual/run.sh --grep 100k密集项`；
  本地结构模式也照跑（`LUMIR_VISUAL_STRUCTURAL` 只关像素断言）。

**代价**：CI 绿不再代表像素层没回归。动了视觉相关代码（`src/style.css`、`src/preview/**`、
场景本身）必须本地跑 `scripts/visual/run.sh` 或 `scripts/gate.sh visual`——
「删左栏 UI」一级的变化只有本地看得见。

**证据锚点**：CI 现场 run `35295440948`（`gh run view 35295440948 --log-failed`，20 条像素基线红）；
本机另有完整排查报告 `.tower/comms/inbox/20260918-worker-ci-diagnosis-*.md`
（`.tower/` 不入 git，这条指针仅本机可查）。

### 指针选中（拖选）的口径：端点由文本几何给出，能力差异用通道探针留痕

拖选是**与 runner 渲染能力相关**的判据，与整页像素同一根源：CI runner 与本地字形栅格不等价
（见上节），而拖选能否延伸对命中点极其敏感——同一页面同一行，命中点差 1–8px 就能从「逐字延伸」
翻成「每次 mousemove 重新落锚点、永不延伸」（M720 实测，§2.3）。据此定三条口径：

1. **端点 MUST 由文本几何给出**，不得用元素边框盒 + 像素偏移常量。取法是首 / 末 cell 内
   **非空文本节点**的 `Range.getClientRects()`（宽 ≥ 4 的盒，滤掉折叠空白的零宽盒）取首 / 末个
   字形盒的中心点（`scenes/m642-overlay-select-all.spec.ts` 的 `textDragPoints`）。同类先例：
   `scenes/m687-semantic-selection.spec.ts` 用 `coordsAtPos` 取渲染态文字端点。边框盒 + 常量偏移
   把判据押在 runner 的度量上，度量一变就翻转——这是 m642 在 master 上持续红的成因，不是产品回归。
   依据与实测现场：M720 调查报告 `.local/reports/visual-drag-ci-oct24/README.md`（`.local/` 不入
   git，本机可查）。
2. **产品自有不变量 MUST 与拖选同一手势内断言**（通道无关、确定性）：拖选路径上的 `mousedown`
   在 window 冒泡段的 `defaultPrevented === false`（应用没拦）、`selectstart` 至少 1 次（引擎接住
   了手势、快照可选）、两个端点的 `elementFromPoint` 都属于 `.lumir-table-fs-snapshot`（端点没有
   落到遮罩外）、拖选之后遮罩仍在场。「产品被改坏」必有一条红：快照 `user-select: none` → selectstart 0；
   面板 capture 阶段 `preventDefault` → mousedown prevented；点穿遮罩 → 遮罩关闭。M720 的 CI 失败
   签名（选区不延伸）下这几条全部成立，所以它们能把「引擎不延伸」与「产品坏了」在报告里分开。
3. **通道探针放在产品拖选之后，且不可用时不 skip**：遮罩是整窗覆盖层，任何点在外面的手势都会让
   它失焦关闭，探针先跑就把产品现场点没了。产品拖选之后在 `.modeline-path`（状态栏路径，非可编辑
   文本）上做同型拖选：能建立选区 → 通道可用，照旧断言产品选区非空且跨 cell（最强判据）；得到
   空选区 → 不退化为 skip，先把「不可用」钉成可复核读数（对照面收到 mousedown、未被
   `defaultPrevented`、selectstart 已触发——三条不满足说明对照面本身不可选，那是判据坏了，照红），
   再打 `pointer-selection-channel: unavailable` annotation 与一行日志。CI 口径即「产品不变量 +
   通道探针留痕」，最强判据只在通道可用时执行；报告里的取值必须与该 run 的实际行为一致
   （有选区却标 unavailable 视为 bug）。**不得**用 skip、放宽断言或抬容差换绿。

真机（WKWebView）的拖选另有判据通道（M650 的 `.local/probes/` 探针；验收场景 227 明确把
「拖选看得见选中带」排除在套件通道之外），本目录的场景只覆盖引擎层。

## 目录结构

```
tests/visual/
  playwright.config.ts         # 容差、viewport、webServer（vite preview）、像素开关集中配置
  scenes/                      # 每个 .spec.ts 是一组场景
  scenes/expect-screenshot.ts  # 像素断言的唯一入口（LUMIR_VISUAL_STRUCTURAL=1 时跳过）
  baselines/                   # 入库的基线截图（Playwright snapshot 目录）
  isolation.test.mjs           # 套件隔离断言（2 用例 / 7 条：run 目录隔离、证据脱敏与 fail-closed、symlink 拒绝；纯 node:test，CI 与 gate.sh visual 层都会跑）
  package.json                 # 自包含子项目：独立于根 workspace（--ignore-workspace）
scripts/visual/run.sh          # 本地一键：构建 → 装依赖 → 对比（--update 更新基线）
scripts/visual/browser-build.sh # 浏览器构建自证（本地与 CI 共用同一份）
```

## 运行

```bash
scripts/visual/run.sh            # 本地全量（含整页像素）；CI 只跑结构断言，二者不等价
# 或分步：
pnpm build
pnpm --dir tests/visual install --ignore-workspace --frozen-lockfile
pnpm --dir tests/visual exec playwright install chromium   # 首次
bash scripts/visual/browser-build.sh                       # 本次用的哪套浏览器，进日志
pnpm --dir tests/visual test
```

**手动单跑 spec（`pnpm --dir tests/visual test`）前必须先 `pnpm build`**：webServer 是 `vite preview`，
服务的是 dist 构建产物而不是 src 编译结果——改了 `src/` 不重建则改动不生效，反向验证会假绿
（REVIEW.md「测试污染真实环境」条的现场）。`run.sh` 与 `gate.sh visual` 自带构建，只有手动迭代才踩。

失败时 diff 制品在 `tests/visual/test-results/`（actual / expected / diff 三张图），
CI 会将其作为 artifact 上传。

复现 CI 现场（结构断言 + 跳过像素）用同一开关：

```bash
LUMIR_VISUAL_STRUCTURAL=1 LUMIR_VISUAL_PORT=4273 scripts/visual/run.sh
```

多 worktree 并行跑场景时默认端口 4173 会撞车（`reuseExistingServer` 可能错用别的
worktree 的 dist）：用 `LUMIR_VISUAL_PORT=<端口>` 指定独立端口隔离，例如
`LUMIR_VISUAL_PORT=4273 pnpm --dir tests/visual test`。

## 浏览器启动口径与 Chromium 隔离

视觉门禁与临时探针只用合成 fixture，**不需要真实浏览器的登录态、Cookie 或 Keychain**。
启动方式按优先级分两档；规则本体见 AGENTS.md 操作流程「Chromium 隔离」条。

### 首选：Playwright 默认 launcher

`scripts/visual/run.sh` / `pnpm --dir tests/visual test` 走 Playwright 自带的 chromium 启动器，
隔离已经内置：

- 没有显式 `userDataDir` 时，每次 launch 在 `os.tmpdir()` 下 `mkdtemp` 一次性 profile
  （`playwright_<browser>dev_profile-*`），不读用户浏览器的 profile / Cookie；
- 默认参数表带 `--use-mock-keychain` 与 `--password-store=basic`，不向系统钥匙串取密钥。

证据（本仓安装的 playwright-core 1.62.1，可复跑）：
`rg -n 'use-mock-keychain|password-store' tests/visual/node_modules/.pnpm/playwright-core@1.62.1/node_modules/playwright-core/lib/`
命中 `chromiumSwitches` 默认参数表；临时 profile 的创建点在同包 `coreBundle.js` 的
`playwright_${name}dev_profile-` 处。

临时探针也优先走这条：脚本里 `chromium.launch()`（示例 `scripts/visual/table-probe72/matrix.mjs`）
即继承上述默认参数。**没有明确理由不要自己拼 Chrome 命令行。**

### 直接启动 Chrome：三项隔离硬要求

只有 Playwright 起不来的场景（需要特定 Chrome 二进制、独立 CDP 注入等）才直接起进程。此时：

| 要求 | 作用 |
|---|---|
| 独立临时 `--user-data-dir`（`mkdtemp`，用后删除） | 不碰真实 profile / Cookie / 扩展 / 登录态 |
| `--use-mock-keychain` | macOS 上让 Chromium 用 mock keychain 代替登录钥匙串；上游 `os_crypt_switches.h` 的注释即写明这是测试用途、「prevents blocking dialogs from causing timeouts」 |
| `--password-store=basic` | 密码库走 basic 实现（Linux/freedesktop 路径），不从系统密钥服务取密钥；对齐 Playwright 默认参数 |

最低形态：

```bash
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE=$(mktemp -d /tmp/lumir-probe.XXXXXX)
"$CHROME" --headless=new --no-first-run --disable-extensions \
  --user-data-dir="$PROFILE" --use-mock-keychain --password-store=basic \
  about:blank
# 退出后删掉 $PROFILE
```

`$CHROME_PATH` 可换成 Playwright 缓存里的 `Google Chrome for Testing` 或其他构建。
禁止指向用户默认 profile（如 `~/Library/Application Support/Google/Chrome`）、
复用已登录的浏览器实例、把真实站点登录态复制进测试 profile。

macOS 上真正拦住 Safe Storage 弹窗的是 `--use-mock-keychain`（Apple-only switch）；
`--password-store=basic` 在这条路径上不生效。两项都带是为了与 Playwright 默认一致、
同一行命令跨平台可用——不是「两项各自都必不可少」。

### 授权框归因与处置

**症状**：启动瞬间弹出 macOS 凭据框，标题形如 `Chromium Safe Storage` / `Chrome Safe Storage`。

**归因**：Chromium 要给 profile 里的 Cookie / 密码库派生加密密钥，于是向登录钥匙串读取同名的
通用密码（上游 `keychain_password_mac.mm` 的默认 service name：品牌版 `Chrome Safe Storage`，
非品牌版 `Chromium Safe Storage`）。这是**启动参数缺隔离项**的信号，不是产品的安全闸，
也不是「必须先授权才能跑测试」的环境前提。M699 现场即：直接启动的 `Google Chrome for Testing`
（临时 profile）缺 `--use-mock-keychain --password-store=basic`；Playwright 标准进程不弹。

**处置**（顺序固定）：

1. **Deny / 取消**授权框。测试只用合成数据，不需要真实 Keychain；拒绝授权不是跳过产品安全校验——
   真实凭据本就不该进测试进程，授予才是越界。
2. 结束该探针进程，补齐上面三项后重启。
3. **不得**输入登录密码，**不得**点「始终允许」。弹窗出现即判定启动配置错误，不是可继续的提示。
4. 无人值守时直接 kill 进程、修参数重跑，不要等人工授权。

## 新增场景

1. 在 `scenes/` 加一个 `.spec.ts`（或往现有 spec 加断言）；
2. 像素断言一律写成 `expectScreenshot(page, "foo.png")`（入口函数在
   `scenes/expect-screenshot.ts`）——**不要直接调 `expect(...).toHaveScreenshot(...)`**：
   开关只在入口函数上生效，直接调会在 CI 里照跑并撞上环境不等价的红；唯一的例外是
   `expectStartupScreenshot`（启动态在场时截图，只有 `m645-startup-surface` 用它）；
3. 跑 `pnpm --dir tests/visual run update-baselines` 生成基线；
4. 截图人工过目后连同代码一起提交；
5. 新增低于整页容差预算（1200×800 × 0.001 ≈ 960 像素）的 UI 元素时，「在场」守卫必须落在结构断言
   （存在性 / 文案 / 可见性），不能指望整页像素——新增元素整体被吞的现场见
   REVIEW.md「容差吞掉真实变化」条（M322 空 pane 引导水印，835px）。

### 启动是两段式的：`goto` 回来时主模块未必已装载（M645）

change `app-splash-screen` 把入口换成启动层（`src/boot.ts`）：先读配置、画启动面，**之后**才
`await import("./main")`。两条旧的就绪代理由此失效，写场景时按下面的口径办：

- **`page.goto("/")` 只表示入口模块开始执行**，不表示壳 / 编辑器 / 文件树已建出。紧接
  `page.goto` 的裸 `page.evaluate` 里 `document.querySelector(...)` 可能拿到 `null`。要操作
  DOM 先等一个界面信号（如 `.cm-content` / `.ft-vault` / `.ft-row` 可见），不要靠时间。
- **`config_get` 调用计数不再等于「配置已施加」**：那次读取由启动层在装载主模块**之前**发起。
  等配置落地用 `configApplied(page)`（等 `.modeline-language` 可见——`applyLanguage` 是配置
  装配块的最后一步）；旧的 `configGets` helper 已删除，MUST NOT 再按调用计数当就绪门。
- **启动面（`#startup`）会在就绪门之前撤下**，所以既有场景不需要为它加等待；`expectScreenshot`
  内部有一道「撤下」门（5s 上界）兜底，但它防不住「信号没接上」（安全阀 10s 会把面撤掉），
  判别性判据在 `startup-restore.spec.ts`——见 `expect-screenshot.ts` 的注释。

## 更新基线

门禁失败且变化为有意（设计演进）：`scripts/visual/run.sh --update`，
人工核对新截图后提交。这一步是「美不美」的人工裁决点，不要机械执行。
`LUMIR_VISUAL_STRUCTURAL=1` 时本脚本会拒绝 `--update`：那种模式下像素断言整个不执行，
`--update` 会「成功」却什么都不刷新——静默空跑比报错更难发现。

### 删除 / 移动 UI 元素后的核对（卫生步骤，强制）

`maxDiffPixelRatio` 是**比例**容差：1200×800 下 0.001 仍允许约 960 像素不同
（`playwright.config.ts` 的 `tolerance`）。删掉或移动一块 UI 时，它占的像素可能正好落在
容差之内——整页基线继续以「无差异」通过，门禁静默假绿。这不是假设：0.005 时代「删左栏 UI」
（提交 `c9a3c20`）就这样溜过两张整页基线，直到另一次超容差失配（提交 `736b3f7`）才暴露
（根因与防线见 [REVIEW.md](../../REVIEW.md) 「容差吞掉真实变化」条）。

删除或移动 UI 元素后，必须逐张核对该元素出现过的**所有**整页基线的时间戳是否随本次更新：

```bash
rg -n '<该元素的文案或选择器>' tests/visual/scenes     # 哪些场景引用它
ls -l tests/visual/baselines/*-snapshots/              # 相关基线的时间戳是否都刷新到本次
```

时间戳没刷新的那张就是漏网：它不会失败，只会继续拿旧画面比对。只有显式重建（`--update`）
才会动时间戳，所以「断言容差过了」不等于核对完成。规则本体见 AGENTS.md 硬规则
「视觉门禁卫生」，本节是它的可执行口径。

## 容差调整

全局改 `playwright.config.ts` 的 `tolerance`（`threshold` 为单像素通道色差容忍度，
`maxDiffPixelRatio` 为允许差异像素占比）；单场景在断言参数上覆盖，例如：

```ts
await expectScreenshot(page, "foo.png", { maxDiffPixelRatio: 0.01 });
```

动容差、或加会删 / 移 UI 的场景之前，先在本地把该元素删掉跑一次，确认门禁确实 FAIL——
容差是按「机器间抖动上限」设的，没核过「最小真实变化」的下限；0.001 在 1200×800 下约 960 像素，
足够吞掉整片小元素的新增或删除（三处现场见 REVIEW.md「容差吞掉真实变化」条）。
