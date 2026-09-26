# Tasks: product-version-display

实现前提：提案节点 1 裁决通过（D1 落位 / D2 窄窗退让 / D3 文案字档——若裁决改备选，
先按备选改写本清单与 specs delta 再动工）。**节点 1 裁决 2026-09-25 已下（D1 采纳 / D2 改选备选 /
D3 采纳），本清单已按裁决改写。**

实现期说明（M236，2026-09-26）：本清单由继任 worker 在执行中逐条勾选，勾选附证据指针；
证据目录在 `test-results/m236/`（git 外，主 checkout 同路径）。

## 1. 前端标识块

- [x] 1.1 `src/shell.ts`：标题栏 append 第三段子容器 `span.titlebar-identity`（产品名段 +
  版本号段 + 分隔符，照 design §3.1；带读屏名、非 button）；文件头标题栏注释（:48-56）
  两段式自述改三段式
- [x] 1.2 `src/style.css`：标识块样式——`flex: none` + `margin-left: auto` 钉右端、
  `gap: var(--sp-3)`、`user-select: none`；产品名 `--fs-ui-s` / `--fw-emphasis` /
  `--text-2`，分隔符与版本号 `--text-3` 常规字重；**零新 token、零组件级 eink 覆盖**；
  `src/style.css:338-342` 的「本版没有动作钮」自述补「标识块钉右端、未来动作钮排其左侧」
  的排列约定
- [x] 1.3 `src/main.ts`：启动装配读取 `getName()` / `getVersion()`（`@tauri-apps/api/app`）
  一次并写 DOM；失败降级 = 标识块 `hidden` + `logEvent` 一条（MUST NOT 渲染假版本号，
  design §3.3）；运行期不刷新
- [x] 1.4 窄窗退让（**D2 改选备选**，2026-09-25）：`src/modeline.ts` 新模块承担退让逻辑——
  窗口宽 < 640px（`matchMedia`）时隐藏标题栏的 `ti-sep` / `ti-version` 两段，版本号拼进
  modeline 右段尾部（独立 span，不与 `syncModelineMeta` 的 meta 段合写）；≥ 640px 恢复。
  产品名始终留标题栏右端（design §3.2）

  证据：`test-results/m236/titlebar-identity-spec-green.log`（chromium 结构场景 7 passed）、
  `test-results/m236/acceptance-39/`（真机 520↔1200 往返，AX dump 为证）。

## 2. ACL

- [x] 2.1 `src-tauri/capabilities/default.json`：增加 `core:app:allow-name` 与
  `core:app:allow-version`；description 补来由（照现有三条权限的注释密度）；**不加则
  getVersion 被 ACL 静默拒绝**（M26 listen 先例）——实现期先故意不加跑一次确认真机
  降级路径成立（标识块隐藏 + logEvent），再加上

  实测（先不加那一轮）：`test-results/m236/acceptance-39-no-acl.log`（场景 39 红 6 条版本号断言、
  启动与界面其余部分全正常）+ `test-results/m236/acl-missing-degradation-log.jsonl`
  （`app_meta_unavailable` warn 四条，message 逐字点名缺 `core:app:allow-name`）。
  加上之后：`test-results/m236/acceptance-39-with-acl-v2.log`（1/1 PASS）。
- [x] 2.2 若内置通道在本仓 CSP/ACL 下实测不可用（design §4 的例外条款）：回落自写 Rust
  命令 `app_meta()`，照 `config_get` 模板 + ts-rs 导出 + ACL，并在 design §4 补记回落原因

  **未触发**：内置通道（`@tauri-apps/api/app` + 2 条 ACL）真机实测可用（见 2.1 的 PASS 日志），
  不起回落方案，design §4 无需补记。

## 3. 验证

- [x] 3.1 单元测试（tests/unit）：文案组装（产品名 + 分隔符 + 版本号只有一处真源）、
  降级路径（getVersion reject → hidden + logEvent，MUST NOT 显示占位串）

  落点：`tests/unit/modeline.test.ts`（`identityView()` 全分支：宽 / 窄 / 降级 / 入参透传 /
  阈值与分隔符常量），275 条单测全绿（`test-results/m236/gate-quick.log`）。
  说明：降级路径的「hidden + logEvent」是 DOM 行为，按 tests/unit 的「不许造 DOM 替身」纪律
  归视觉场景断言（`titlebar-identity.spec.ts` 的「读取失败降级」用例），本层只断言视图模型的
  「全空串、MUST NOT 占位」决策。
- [x] 3.2 视觉场景（`tests/visual/scenes/`）：tauri 桩补 `plugin:app|name` /
  `plugin:app|version` 两条 invoke 路由（fixture 值 "Lumir" / "0.0.0"）；新增结构层断言
  场景——标识块在场且文案形态正确、钉右端（tabstrip hidden 的空态也在右端）、三主题
  计算样式取 `--text-2`/`--text-3`；断言按 REVIEW.md 第 1 条纪律先造必须 FAIL 的反向
  输入实测一次

  落点：`tests/visual/scenes/titlebar-identity.spec.ts`（7 用例）+ `tauri-stub.ts` 的
  `appMeta` fixture（`false` = 不路由，模拟 ACL 拒绝）。反向输入实测两次：
  `test-results/m236/reverse-probe-margin-left-aut.log`（摘掉 `margin-left: auto` → 空态
  钉右端断言 FAIL，偏移 871px）、`reverse-probe-narrow-threshold.log`（阈值拉到 100000
  → 640px 恢复断言 FAIL）。
- [x] 3.3 视觉门禁卫生（REVIEW.md 第 3 条 + AGENTS.md 硬规则）：标识块出现在**空态主界面**
  等既有整页基线的画面里——`bash scripts/gate.sh visual` 跑红后，逐一核对受影响整页基线
  清单，截图 Alex 过目再 `--update`

  **已核对、未更新、待 Alex 裁决**。过目包：`test-results/m236/baseline-review/`（含
  34 张基线逐张分类、来源 diff 产物、真机 6 张截图、两个日志）。结论：受影响的 21 张整页
  基线**在 0.001 容差下静默绿**（差异仅 125px < 960px 容差，REVIEW.md 第 3 条的新现场），
  只有 2 张标签栏元素基线因尺寸变化硬 FAIL。**基线一律未改**，等 Alex 批准后才跑 `--update`。
- [x] 3.4 真机验收场景 **`scripts/acceptance/scenarios/39-titlebar-identity.md`**（编号接
  38-content-width-drag；端口与隔离纪律照旧，1420/1430 不碰）：标识块显示「Lumir ·
  0.0.0」且版本号与 src-tauri/tauri.conf.json 的 version 逐字节一致（读文件比对，不硬编码
  预期值）；窗口调窄（≈520px）后版本号退入 modeline 右段、产品名留标题栏右端（D2 备选），
  拉宽恢复；标识块上按下拖拽窗口成立（drag region 不被阻断）；三主题各一张标题栏截图证据

  实测：`node scripts/acceptance/run.mjs 39` → **1/1 PASS**（`acceptance-39-with-acl-v2.log`，
  47s，12 条断言 + 6 张截图）。版本号靠 `$appName` / `$appVersion` 占位符从
  `src-tauri/tauri.conf.json` 代入（新增的 `appMetaTokens`），场景不留版本号副本。
  拖拽移动窗口、resizeWindow 到 520 均实测成立。
  执行期修正：原「产品名段」断言 `has: "$appName"` 无区分度（窗口标题也是 "Lumir"，
  标识块隐藏时照样 PASS——ACL 缺失那轮实测为证），已换成两条互补判据
  （`has /"$appName[^\n]{0,4}$appVersion/"` 与 `has /UTF-8 · $appVersion/`），
  并在场景「已知边界」补记真机 AX 粒度实测（WKWebView 把三段合并成一个静态文本）。
- [x] 3.5 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过

  实测：26 passed / 0 failed（`gate-quick.log` 的 `GATE PASS openspec-validate`）。
- [x] 3.6 `bash scripts/gate.sh quick` 全绿；真机验收套件 `node scripts/acceptance/run.mjs 39`
  PASS（合并后、Alex 验收前由 agent 先跑一遍，AGENTS.md 执行时机）

  实测：`gate.sh quick` **10/10 PASS（SKIP 0）**（`all` 档未跑——本 mission 无 Rust 逻辑改动，
  `gate.sh visual` 已覆盖 11/12，唯一 FAIL 是 3.3 的基线裁决点）；场景 39 **1/1 PASS**。

## 4. 收尾

- [x] 4.1 归档顺序核对：`openspec list` 确认 restyle-ui-tokens-v1 已归档（本 change 的
  ui-design-system delta 含 MODIFIED，它未归档则 archive 会被拒）；未归档则在
  `docs/backlog.md` 待裁决节登记本 change 的待归档状态，不强行 archive

  核对结果（2026-09-26）：**`restyle-ui-tokens-v1` 仍未归档**（`openspec list`：49/51 tasks），
  故本 change **不 archive**（按裁决要求不强行 archive）。
  登记已落（tower 于 2026-09-26 把 `docs/backlog.md` 加进本 mission scope）：待裁决节新增第 32 条
  「change `product-version-display` 待归档跟踪」，写明两个前置（视觉基线待 Alex 裁决 +
  `restyle-ui-tokens-v1` 未归档）。

## 5. 验收套件 harness 修复（M236 执行期追加，tower 2026-09-26 裁决）

- [x] 5.1 修 `scripts/acceptance/lib/app.mjs` 的 `--config` 覆盖丢掉 `app.windows[0]` 窗口级配置
  （backlog.md 待修 findings 的 medium 条，M213 登记）：tauri 的 `--config` 是深合并但**数组按下标
  整体替换**，原先手抄 `title/width/height` 让 `titleBarStyle: "Overlay"` / `hiddenTitle: true`
  被静默吃掉，套件实例因此长原生标题栏（窗口多一行）。
  改法：从 `src-tauri/tauri.conf.json` 读 `app.windows[0]` 原件再 spread（窗口配置单一真源，
  REVIEW.md 第 8 条），只叠 `x/y/focus`；读不到窗口对象直接抛错，不回落手抄。
- [x] 5.2 补运行期反查自检 `assertOverlayChrome`（`lib/drive.mjs`，接在 `waitAppReady` 的就绪点上，
  `restart` 后重启同样过）：`AXScrollArea` 顶边与高度对 `AXWindow` 的差 >4px 即 FAIL 并点名成因。

  反向输入实测（REVIEW.md 第 1 条）：把 `windows` 临时改回手抄写法跑场景 39 →
  自检报 `AXWindow 1200×800 @0` vs `AXScrollArea 1200×768 @32`（顶边差 32、高度差 32），
  场景 FAIL（`test-results/m236/reverse-probe-backlog366-buggy-config.log`）；
  改回 spread 后场景 39 **1/1 PASS**（`acceptance-39-backlog366-fixed.log`），
  AX 读数 `AXScrollArea @0,0 1152×768` 与窗口重合（修前是 `@0,31 1152×737`）。
- [x] 5.3 文档：`scripts/acceptance/README.md` 的「起实例前的环境纪律」节补「启动实例的窗口形态
  自检」与配置侧纪律（新增窗口级键不需要改套件）。

  判据达成情况（tower 验收口径「套件起实例后截图/AX 确认无原生标题栏行」）：截图与 AX 双证据见
  `test-results/m236/baseline-review/backlog366-before-after/`（修前两行 / 修后单行，红灯叠在
  tab 栏上）。
  核销已落（tower 于 2026-09-26 把 `docs/backlog.md` 加进本 mission scope）：原「待修 findings」的
  medium 条就地标为已修，全文核销记录落文末「已核销」的同日条目（含落点、判据、反向前置验证与
  「全量场景切到 overlay 后只有场景 33 需重算几何」的连带修正）。
