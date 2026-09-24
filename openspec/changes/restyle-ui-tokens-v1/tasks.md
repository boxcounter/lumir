# Tasks: restyle-ui-tokens-v1

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**前置条件**：`typography-and-zoom` 已归档（proposal §与活跃 change 的关系：两份 delta 都改
`src/style.css` 的 `:root`，不并行）。

**裁决记录（节点 1，2026-09-24，三个条件项已全部落锤，本文件与 delta 已按裁决改写）**：

- **D1 = 15px**（采纳推荐）→ 3.4 保留。
- **D2 = 本 change 内收敛 callout**（采纳备选）→ 已新增 6.5「callout 语义收敛落地」；映射表随
  tokens v1.2 落 [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) §callout 语义收敛，
  样式可视化经原型 `?screen=6` 三主题截图验证；§8 基线核对含 callout 场景。
- **D3 = `[ui] theme` 配置**（采纳推荐）→ §2 按推荐形态执行。

## 1. 现状读数与反向验证（先测再改）

- [ ] 1.1 取**现状读数**：默认配置下记录 `getComputedStyle` 的底色 / 正文色 / accent / 栏宽 /
  字号 / 行高关键值，以及 34 张基线的 sha256 清单。
  **验收口径**：读数与 sha256 清单落 `test-results/<mission>/restyle-before/`（可 `ls`）；
  基线张数 = 34（`find tests/visual/baselines -name '*.png' | wc -l`）。
- [ ] 1.2 反向验证（先红，[REVIEW.md](../../../REVIEW.md) 第 1 条）：先写三条新判据——
  ①「`data-theme="dark"` 下正文底色为 `#222326`」②「masthead 不存在」③「modeline 存在且含
  文件路径」——未实现前跑一次，三条都必须 FAIL，且红落在判据本身（不是「选择器写错」）。
  **验收口径**：红灯日志落 `test-results/<mission>/red-before-implementation.log`。
- [ ] 1.3 旧 token 引用全量清点：`rg -n 'var\(--(bg|bg-nav|bg-2|bg-3|bd-[123]|dim|accent|sel|selection-ink|radius|measure|nav-width|font-display|font-body|font-mono|line-height)\)' src/ tests/`
  与 JS 取值点 `rg -n 'getPropertyValue\("' src/` 各出一份清单。
  **验收口径**：清单落 `test-results/<mission>/token-references-before.md`；实现后同一组命令
  应只剩「迁移说明里批准保留」的项（§10），前后对照落档。

## 2. 配置面（Rust）：`[ui] theme`

- [ ] 2.1 新增 `UiConfig { theme: String }`（默认 `"light"`）挂进 `AppConfig`，`RawUiConfig` 镜像、
  `validate()` 加取值校验（`light|dark|eink` 之外 → warning + 回落 `light`，照 `editor.mode` 模板）。
  **验收口径**：`cargo test` 通过；`src/bindings/UiConfig.ts`（或既有 AppConfig 导出）由 ts-rs
  重新导出；`git status --porcelain -- src/bindings/` 为空。
- [ ] 2.2 单测钉四种形态：缺省（→ light）、合法（dark/eink）、非法值（回落 + warning 恰一条）、
  类型不符（整文件回落的既有口径）。
  **验收口径**：单测名落 `src-tauri/src/config.rs`；`cargo test` 全绿。
- [ ] 2.3 验收 harness `writeConfig` 扩 `ui.theme`（传了才写）。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过。
- [ ] 2.4 视觉 harness 桩支持主题注入（扩桩或 `patchUiConfig` helper，形态照 `patchEditorConfig`）。
  **验收口径**：三主题场景（§7）能用该通道各截到正确主题；`git diff tests/visual/scenes/tauri-stub.ts`
  只含该扩展。

## 3. token 层与主题机制（前端）

- [ ] 3.1 `src/style.css` 的 `:root` 全量重建：色彩 29 个 × 三主题块 + 非色 token 一组
  （字体 / 间距 / 圆角 / 布局 / 动效），值与 [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md)
  逐项一致；旧 token 一组不留别名。
  **验收口径**：diff 落 `src/style.css` 一个文件；抽 10 个值与 tokens 文档对照（对照表落
  `test-results/<mission>/token-spot-check.md`）；1.3 的 `rg` 命令对 `src/style.css` 零命中旧名。
- [ ] 3.2 主题施加：启动时装配层把 `ui.theme` 写入 `documentElement.dataset.theme`
  （与 `applyTypography` 同落点区）；非法值已被 Rust 侧拦，前端不再判。
  **验收口径**：`rg -n 'dataset.theme' src/` 命中施加处；视觉场景断言三主题各自的关键计算属性
  （§7）。
- [ ] 3.3 旧 token 消费面迁移：1.3 清单上的每一处改指新 token（含 `src/preview/theme.ts` 的
  `color-mix` 里 `--bg` → `--content-bg`、`.filetree` / `.ft-empty` 两处字体族字面量一并收口——
  它们本就指向正文族，这次不再有「不顺手」的借口，因为旧名整个删除）。
  **验收口径**：1.3 的 `rg` 命令全仓零命中（批准保留项除外）；迁移对照表落
  `test-results/<mission>/token-references-after.md`。
- [ ] 3.4 **D1 裁决落点（15px，节点 1 已采纳）**：`--editor-font-size` 默认 16→15、`--line-height` 1.75→1.7；
  Rust `DEFAULT_FONT_SIZE` 同步改 15，两侧指针注释更新（typography 的成对纪律）。
  **验收口径**：计算属性断言 `getComputedStyle(.cm-content).fontSize === "15px"`；`cargo test`
  与 `node tests/unit/run.mjs` 的默认值断言同步更新且全绿；typography 的档位断言按新基准重算
  （15 上 7 档 / 下 4 档）。
- [ ] 3.5 overlay 标题栏：`tauri.conf.json` 加 `titleBarStyle: "Overlay"` + `hiddenTitle: true`。
  **验收口径**：真机起 app 后 traffic 灯原生绘制、标题文字不显示、标题栏区可拖拽
  （证据 = 真机截图 + 读数，落 `test-results/<mission>/titlebar/`；注意白屏陷阱：起实例前
  确认是 custom-protocol 构建，REVIEW.md 第 10 条）。

## 4. 骨架重构

- [ ] 4.1 grid 改四区：标题栏行（42px，全宽）/ 主行（侧栏 236 + 正文 + dock 预留列宽 0）/
  modeline 行（25px，全宽）；dock 预留列零像素零边框。
  **验收口径**：几何读数（侧栏 236、标题栏 42、modeline 25、dock 列 0）落视觉场景断言。
- [ ] 4.2 masthead 移除：vault 名入侧栏头（切换器入口形态不变）、文件路径入 modeline 左、
  toc 位置指示迁 modeline（指示语义不变）、行数 / 语法 / 编码入 modeline 右（design §4-2 的
  取数路径按结论落）。
  **验收口径**：`rg -n 'masthead' src/` 零命中；modeline 各段文本与状态的绑定由视觉场景断言；
  masthead 出现过的所有整页基线列入 §8.3 的删除元素核对清单。
- [ ] 4.3 标签迁入标题栏：显示判据（≥1 文件打开）不变，形态按定稿（高 29、max-width 230、
  active tab 唯一阴影 `--shadow-pop`、eink 1.4px 描边）。
  **验收口径**：`m149-tabs` 场景断言更新后全绿；「无打开文件时标题栏只剩 traffic 区与动作钮」
  有场景断言。
- [ ] 4.4 旧媒体查询（≤1100px 侧栏 204）随旧 token 删除，已知边界写进 spec。
  **验收口径**：`rg -n 'max-width: ?1100px' src/` 零命中；边界表述可 `grep` 到。

## 5. chrome 表面换新

- [ ] 5.1 文件树：行高 25、层级缩进 8+14×层深、选中态 / hover、eink 黑底反白（含 badge-dot、
  ghost chip 的手工反白）。
  **验收口径**：几何与计算属性断言落视觉场景；eink 反白有专门断言（选中行底色 #000、
  文字 #fff）。
- [ ] 5.2 搜索面板 / 键位面板 / 大纲浮层 / toast / vault 切换浮层：样式改指新 token，
  行为零改动。
  **验收口径**：`m133-describe-bindings` 等既有场景的**行为断言**不改一字且全绿；
  `git diff` 里这些文件只有样式/token 引用改动（逐行核）。
- [ ] 5.3 动效纪律：hover/过渡收敛 0.1s / 0.12s 两档，全仓无第三个 transition 时长值。
  **验收口径**：`rg -n 'transition.*[0-9.]+s' src/ | rg -v '0\.1s|0\.12s|1\.6s'` 零命中
  （1.6s 是 pulse 动画，随 agent 特性才有消费者——入库无消费者属批准的预留面）。
- [ ] 5.4 **周边表面按类推映射表执行**（design §2.7，8 个表面逐行）：toc / vault 浮层、
  搜索面板、lightbox、键位面板、toast、空态组、list-filter 宿主。`--shadow-raise` /
  `--scrim`（tokens v1.1）随 3.1 一并入库；浮层壳配方 = `--preview-bg` + 1px `--border`
  + `--shadow-raise`（eink：白底黑框无阴影、modal 1.4px）；toc 浮层锚点从 masthead
  迁到 modeline 指示段。**任何偏离映射表的取值都必须记录**。
  **验收口径**：取值来源逐表面落 `test-results/<mission>/peripheral-surfaces.md`
  （表面 / 取值 / 类推来源或「v1.1 elevation」/ 偏差与理由）；
  `rg -n 'box-shadow' src/` 除 `--shadow-pop` / `--shadow-raise` 外零命中；
  8 个表面的行为断言（toc 键位、search 面板、lightbox Esc、bindings 行数派生）原样全绿。

## 6. 编辑器渲染层与内容类型

- [ ] 6.1 `theme.ts` 颜色引用全量改指；`tok-*` → `--tk-*`；标题族随 `--font-display` 删除
  改 sans 字重阶梯（680/650）。
  **验收口径**：`rg -n 'callout-(tip|warning|note|abstract)' src/preview/theme.ts` 只剩 callout
  块自身的引用；JSON/YAML 键名分色（既有 requirement）在新 token 下两侧一致性断言照绿。
- [ ] 6.2 frontmatter `.fm` 形态：字段名 mono 11px 灰、值 13px、status 语义 chip、浅底圆角区
  置于文档顶部；StateField 构建与性能纪律不动。
  **验收口径**：`git diff src/preview/frontmatter.ts` 不含构建逻辑改动（逐行核）；形态断言
  （计算属性 + 截图）落视觉场景；既有 frontmatter 场景的行为断言全绿。
- [ ] 6.3 内容类型按 tokens 文档落地：表格（th 底线结构档、td 层次档、首列 550）、代码块
  （头部条 + mono 12px/1.55）、引用（2px 竖线 + text-2）、列表（多级编号 / 悬挂缩进）、
  wikilink（药丸 → eink 下划线）、分隔线。
  **验收口径**：逐项计算属性断言落视觉场景；内容类型与定稿图 04–06 的对应关系在 §8.2 的
  基线重建核对表里逐张写明。
- [ ] 6.4 栏宽 80% → 664px 居中（design §4-1 的落法按结论定）；列表 marker 测量、表格管道
  对齐在新栏宽下重核。
  **验收口径**：`lists.spec.ts` 与表格场景的断言在新栏宽下全绿；若栏宽落法影响 marker 测量
  （canvas 按字号量、与栏宽无关，但悬挂缩进常量可能联动），差异如实记录。
- [ ] 6.5 **callout 语义收敛落地**（D2 裁决 = 本 change 内收敛）：13 类按
  [design-tokens-v1.md](../../../docs/specs/design-tokens-v1.md) §callout 语义收敛（v1.2）
  的映射表换色——`--callout-<type>` 色值改指所属族语义 token（`--accent` / `--ok` /
  `--pending` / `--danger` / `--text-3`），底色改指族 tint token（红系用 v1.2 新增的
  `--danger-tint`）；`theme.ts` 的 `color-mix` callout 底色整段退场（tint 逐档调好，不再
  运行期混色）；eink 色条全黑、底色全白；不引入图标，同族区分只靠标题行文字。
  **验收口径**：`rg -n 'var\(--callout-' src/ tests/` 零命中（13 个逐类色 token 全部退役）；
  `rg -n 'color-mix' src/` 零命中；13 类色系归属的计算属性断言（每类 border-left-color =
  族色、background = 族 tint）落视觉场景；eink 下 13 类色条全 `#000`、底色 transparent 的
  断言落视觉场景；`callout.spec.ts` 场景更新并入 8.2 基线重建批次（核对表含 callout 行）。

## 7. eink 降级规则（9 条逐条钉）

- [ ] 7.1 逐条落地 tokens 文档 §eink 规则 1–9：色彩退场（含 tint=transparent）、
  字重/明度对比（tk-k 700、comment #6e6e6e）、实心黑 hairline、黑底反白（含次级元素）、
  白底黑框（代码块 / fm）、chip 描边化、阴影退场、线宽强调（1.2/1.4/1.6）、wikilink 下划线。
  **验收口径**：每条规则至少一条计算属性或像素断言，逐条对号落 `tests/visual/scenes/`
  （对照表落 tasks 收官对账）；`rg -n 'data-theme="eink"' src/style.css` 的覆盖块与 9 条一一对应。
- [ ] 7.2 eink 反向验证：把「`--border` 的 eink 值」临时改回灰，确认对应断言 FAIL 后还原。
  **验收口径**：红/绿两次输出落 `test-results/<mission>/eink-reverse.log`。

## 8. 视觉场景与基线（纪律核心）

- [ ] 8.1 场景更新与新增：三主题注入（2.4）下更新既有场景断言、新增骨架几何 / eink 规则 /
  modeline / 标题栏场景；**本地** `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual`
  迭代到结构层全绿（动了 `src/style.css`、`src/preview/**`、`tests/visual/scenes/**`，CI 绿
  不算数——AGENTS.md 视觉门禁分层）。
  **验收口径**：门禁日志落 `test-results/<mission>/gate-visual-structural.log`；
  1.2 的三条红灯转绿。
- [ ] 8.2 **基线全量重建——独立批次动作**：结构层全绿后，一次性
  `scripts/visual/run.sh --update` 重建全部 34 张基线，**截图逐张请 Alex 过目后才提交**
  （AGENTS.md 硬规则「基线更新是人肉裁决点」）；逐张核对表（张名 / 变化原因 / 对应定稿图 /
  结论）落 `test-results/<mission>/baseline-rebuild.md`。禁止在实现过程中零碎 `--update`。
  **验收口径**：34 张时间戳同属本次重建（`ls -lT tests/visual/baselines/*-snapshots/`）；
  核对表 34 行逐张有结论；**每个周边表面（design §2.7 的 8 个：toc / vault 浮层、搜索
  面板、lightbox、键位面板、toast、空态组）在重建批次里至少有一张含它的截图**
  （既有场景已含的点名指出，没有的补场景），供 Alex 过目时逐一核到；KaTeX / mermaid /
  图片附件在三主题下的呈现逐张核过（design §4-3），发现事故如实记录不粉饰。
- [ ] 8.3 **删除元素核对**（视觉门禁卫生，tests/visual/README.md §删除/移动 UI 元素后的核对）：
  masthead（及双线装饰）、旧标签栏行、旧侧栏样式——`rg -n 'masthead|双线' tests/visual/scenes`
  找出引用过的场景，核对其整页基线时间戳全部随 8.2 刷新；没刷新的逐张说明原因。
  **验收口径**：核对结果落 `test-results/<mission>/baseline-rebuild.md` 的「删除元素」节；
  任何一张「该元素出现过但时间戳未刷新」的基线都必须有解释（不允许静默漏网）。
- [ ] 8.4 假绿防线（[REVIEW.md](../../../REVIEW.md) 第 3 条）：8.2 重建后，人为删掉一个可见
  元素（如 modeline 右段）跑一次门禁，确认**确实 FAIL**，再还原。
  **验收口径**：FAIL 输出与还原后全绿输出都落 `test-results/<mission>/baseline-rebuild.md`。

## 9. 真机验收场景（`scripts/acceptance/`）

- [ ] 9.1 **新增场景**（编号按实现期 `ls scripts/acceptance/scenarios/` 的最大号续）：
  ①以 `ui.theme: "eink"` 经 `writeConfig` 启动 → AX / 截图证据确认主题生效（真实配置通道
  端到端）；②骨架几何在场（侧栏、modeline）；③masthead 不在场；④整轮前后验收 vault 文件
  哈希不变（ADR 0003 §3）。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过；真机 PASS 证据落
  `test-results/acceptance/<日期>/<场景名>/`；判据走「回读 + 只在字节未变才重试」
  （REVIEW.md 第 11 条），MUST NOT 只靠「启动成功」。
- [ ] 9.2 真机反向验证：把主题施加（3.2）临时去掉重跑同一场景 → 必须 FAIL；随后还原重建。
  **验收口径**：FAIL 的 `status.txt` / `steps.md` 留档。
- [ ] 9.3 手感 / 审美项留证：三主题各一张真机截图落 `test-results/acceptance/<日期>/`，
  供 Alex 抽审（WKWebView 的真实渲染与 chromium 门禁不等价，这层证据只能真机出）。
  **验收口径**：截图可 `ls`；跑前确认 1420 / 1430 无别的 Lumir 实例、`df -h` 水位 ≥3G
  （REVIEW.md 第 11/12 条）。

## 10. 验证与收官

- [ ] 10.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **验收口径**：`GATE PASS openspec-validate`。
- [ ] 10.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual`
  全绿；`bash scripts/docs-check.sh` PASS；`cargo test` 全绿。
  **验收口径**：日志落 `test-results/<mission>/`，逐行 `GATE PASS`，退出码 0。
- [ ] 10.3 `git diff --check` 通过；改动文件集合与 proposal 的 Impact 清单一致；确认 diff 里
  **没有** agent 栏内容、serif、composer 变体、跟随系统主题、行为 spec 的功能语义改动。
  **验收口径**：`git diff --stat` 与 Impact 逐条对齐。
- [ ] 10.4 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现逐 requirement 对一眼；
  archive 时替换 CLI 写入的占位 Purpose（批次收尾 checklist）。
  **验收口径**：对账表落 tasks 末尾（逐 requirement → 实现落点 → 断言落点）；
  归档后再跑一次 validate 全绿。

## 11. 已声明的边界 / 不做

- [ ] 11.1 不做 agent 栏 / 屏 2/3 / composer 变体 / serif / 跟随系统主题 / 运行期主题切换 /
  callout 图标体系 / 窄窗口策略 / 原生整窗截图门禁。
  **验收口径**：`rg -n 'agent|serif|composer|prefers-color-scheme' src/` 的命中均为既有无关代码
  或注释（逐条核）；`git diff` 里没有对应的新增 UI 或配置字段（`[ui]` 只有 `theme` 一个字段）。
- [ ] 11.2 已知边界如实记录：同族 callout 类型只靠标题行文字区分（无图标，v1.2 取舍）；
  abstract / todo 的族归属是映射中争议最大的两类（v1.2 已注明理由，后续可复议）；KaTeX /
  mermaid / 图片附件未按三主题调校；窄窗口行为未定；dock 预留列无可见物（「预留」只在结构层）。
  **验收口径**：五条都写进 spec 的已知边界或 proposal 的 Non-goals，可 `grep` 到。
