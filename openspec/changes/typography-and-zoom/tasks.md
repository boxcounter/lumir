# Tasks: typography-and-zoom

任务口径：每条给出**验收口径**（判据 + 证据落点）。「证据」指可 `ls` 的路径或可复算的命令输出，
不是「跑过了」的口头声明（[REVIEW.md](../../../REVIEW.md) 第 7 条）。

**本文件是提案阶段的实现计划，全部未勾选**（本 mission 只产出提案，不写产品代码；实现待 Alex 节点 1
裁决后另立 mission）。

**条件项**（裁决落在备选上时，实现前先按裁决改写本文件与 delta，不静默按推荐项做）：

- **D1 取备选①（全界面一起变）** → 3.1 的作用面从编辑器 token 扩到 shell 基线（`--font-body` /
  `body` 字号 / `--nav-width` 的重估），7.x 的基线处置从「零变更」改为「全量重拍 + 逐张过目」，
  6.x 增加「shell 字号随配置变化」的断言。代价与范围在改写时一并写进 proposal。
- **D2 取备选①（候选清单 + 循环命令）** → 新增一节「候选清单的单一真源与循环命令」，并补一条
  「清单里没有我要的字体」的退出路径（否则配置面被清单锁死）；取备选②（系统字体枚举）→ 另立原生
  枚举面（CoreText / 新 command / 新浮层）的任务组，本 change 的 tasks 需重估规模。
- **D3 取备选①（一个字段管正文与代码）** → 2.x / 3.x 的字段数减为一个，并追加一条实测：把比例字体
  填进去后列表标记对齐与代码块列对齐的退化读数（如实记录，不粉饰）。
- **D4 取备选 A（Emacs chord）** → 5.x 与「可重绑」的验收口径改写为「默认键位不可由 `[keys]` 重绑，
  须在 spec 里写明这一代价」；取备选 B（整体 webview 缩放）→ 3.x 换成 `set_zoom` 施加点 + 缩放值
  的运行期真源，7.x 追加「非 100% 缩放下的基线不可比」的处置，命令 id 改 `view.zoom-*`。
- **D5 取备选①（持久化）** → 新增「配置写入通道」的任务组（复用 `write_last_vault_to` 的纪律：
  读整 JSON → 只改该字段 → tmp+rename），并补一条并发写实测；取备选②（⌘0 回出厂值）→ 4.x 的重置
  语义改为出厂 16px 并补反向断言。
- **D6 允许重拍既有基线** → 7.4 改写为「逐张定位差异来源 + 请 Alex 过目后重拍」，并在 tasks 里留下
  每张基线的差异读数（不写「差异很小，故更新」）。
- **§2.1 的类型容忍替代形态被采纳** → 2.2 的字段类型改为 `serde_json::Value` + 逐字段判定，并补一条
  「与其他字段形态不同治」的理由注释与单测。

## 1. 现状读数与反向验证（先测再改）

- [ ] 1.1 取一次**现状读数**：默认配置下（无排版字段）记录 `getComputedStyle(.cm-content)` 的
  `fontSize` / `fontFamily` / `lineHeight`、`.cm-scroller` 的网格列宽、列表标记宽度、以及
  `document.documentElement` 上是否存在 `--editor-*` 变量。
  **验收口径**：读数落 `test-results/<mission>/typography-before/readings.json`（可 `ls`）；判据是
  `fontSize` 为 `16px` 且三个 `--editor-*` 变量**不存在**。
- [ ] 1.2 反向验证（先红，[REVIEW.md](../../../REVIEW.md) 第 1 条）：先把新场景的判据写出来——
  ①「配置 `font_size: 20` 后 `getComputedStyle(.cm-content).fontSize` 为 `20px`」②「按 ⌘= 后字号
  变为 18px」③「`config.json` 在按 ⌘= 后逐字节不变」——在**未实现前**跑一次，三条都必须 FAIL
  （②③ 的红必须落在判据本身，不是「变量不存在」这类退化判据）。
  **验收口径**：红灯日志落 `test-results/<mission>/red-before-implementation.log`。
- [ ] 1.3 复核 design §1.2 的 specificity 结论（design §4-0）：把 `src/style.css:28` 的 `16px` 临时改成
  `20px`，读 `getComputedStyle(.cm-content).fontSize`。
  **验收口径**：读数落 `test-results/<mission>/specificity-probe.json`；结论写回 design §4-0
  （「② 生效」成立或「①生效」需换收口位置），**然后还原该临时改动**。
- [ ] 1.4 复核 CM 是否自动重测量（design §4-1）：用 DevTools 协议在运行期把 `--editor-font-size`
  改成 `24px`（或临时 `setProperty`），立即读光标矩形与行高。
  **验收口径**：读数落 `test-results/<mission>/remeasure-probe.json`；结论（自动 / 需显式
  `requestMeasure`）写回 design §4-1 与 §2.6。

## 2. 配置面（Rust）

- [ ] 2.1 `EditorConfig` 增三个字段：`font_family: Option<String>`、`mono_font_family: Option<String>`、
  `font_size: f64`（默认 16）；`Default` 与 `RawEditorConfig` 镜像同步（`src-tauri/src/config.rs:70-95`、
  `:155`）；给 `font_size` 写清「数值字段、错打成字符串的代价」的注释。
  **验收口径**：`cargo test` 通过；`src/bindings/EditorConfig.ts` 由 ts-rs 重新导出（`ls src/bindings/`）。
- [ ] 2.2 `validate()` 的 editor 分支加三条：空串 / 纯空白 → `None` + warning；`font_size` 区间外 →
  回落 16 + warning（照 `editor.mode` 的模板，`src-tauri/src/config.rs:231-283`）。
  **验收口径**：`cargo test` 的定向单测（2.3）覆盖四种形态：缺省、合法、越界、空串。
- [ ] 2.3 单测钉住两条边界：① 类型不符（`{"editor":{"font_size":"16"}}`）→ 整文件回落，
  `font_size` / `font_family` / `mode` / `line_wrap` 与 `last_vault` **一起**回到默认、warning 恰一条；
  ② `font_size: 100` → 只回落该字段（其余字段按配置生效）、warning 恰一条。
  **验收口径**：两条单测名与断言落 `src-tauri/src/config.rs`；`cargo test` 全绿。
- [ ] 2.4 验收 harness 的 `writeConfig` 扩三个可选字段（传了才写，照 M180 的 `lineWrap` 写法）。
  **验收口径**：`scripts/acceptance/lib/app.mjs` 的 `writeConfig` 可写出三个字段；
  `node scripts/acceptance/run.mjs --check` 通过。

## 3. 排版 token 层与施加点（前端）

- [ ] 3.1 `src/style.css` 的 `:root` 新增 `--editor-font-family` / `--editor-mono-family` /
  `--editor-font-size`（默认分别 `var(--font-body)` / `var(--font-mono)` / `16px`）。
  **验收口径**：默认配置下 `getComputedStyle` 读到的编辑器字体族与字号与 1.1 的读数逐项相同。
- [ ] 3.2 编辑器侧引用改走新 token：`src/editor.ts:1186`（按模式二选一）、`:1196`（字号）、
  `src/preview/theme.ts` 里所有编辑器内的 `var(--font-body)` / `var(--font-mono)`；
  `--font-display` 与 shell 侧引用**不动**。**JS 侧的取值点一并改**：`src/preview/lists.ts:44` 用
  `getPropertyValue("--font-mono")` 把字体族读成字符串喂给 canvas 测量——它不受 CSS 引用改名影响，
  实现后 SHALL 读 `--editor-mono-family`（与标记渲染同一个 token），否则非默认 `mono_font_family` 下
  标记渲染与测量分叉（对不齐）。
  **验收口径**：`rg -n 'var\(--font-(body|mono)\)' src/preview/theme.ts` 零命中（编辑器层不再直接引用
  shell token）；`rg -n 'var\(--font-body\)' src/editor.ts` 零命中；
  `rg -n 'getPropertyValue\("--font-(body|mono)"\)' src/` 零命中（JS 取值点也同源）；
  `rg -n 'getPropertyValue\("--editor-mono-family"\)' src/preview/lists.ts` 命中一处。
- [ ] 3.3 收口 §1.2 的双写：`16px` 的真源只剩 `--editor-font-size` 的默认值一处（`src/style.css:28`
  与 `src/editor.ts:1196` 都不再各写一份数字）。
  **验收口径**：`rg -n 'fontSize' src/editor.ts` 只剩引用变量的那一处；计算属性断言
  `getComputedStyle(.cm-content).fontSize === "16px"` 成立。
- [ ] 3.4 新增单一写入路径 `applyTypography(...)`（落点与 `applyKeyConfig` 并列，装配层）：按
  `CSS.supports("font-family", …)` 判定后写 documentElement 上的 token（值 = 用户值 + 基线后备栈），
  非法值记 warning 并保持基线；写完后按 1.4 的结论决定是否显式请求重测量。
  **验收口径**：`rg -n 'setProperty' src/` 只命中这一处（单一写入路径）；非法值场景的观感与缺省配置
  逐像素相同（7.x 的场景断言）。
- [ ] 3.5 启动接线：`src/main.ts:830-841` 的 `configGet().then(...)` 里加一次 `applyTypography(...)`
  （在 `setMode` / `setWrap` 之后）。
  **验收口径**：视觉场景里用 `patchEditorConfig`（`render-codeblock.spec.ts:465-486` 的既有形态）给桩
  补上三个字段后，首帧即为配置口径（7.x）。
- [ ] 3.6 TS 侧出厂默认常量 + 两侧指针注释（照 `src/preview/theme.ts:23` 的 `DEFAULT_LINE_WRAP` 先例）。
  **验收口径**：常量处与 Rust `Default` 处各有一行指向对方的注释；两侧单测各钉住默认值（6.1 / 2.3）。

## 4. 命令、键位与运行期状态

- [ ] 4.1 新增三个命令 id（`view.text-scale-up` / `view.text-scale-down` / `view.text-scale-reset`）
  进 `NON_TAB_GLOBAL_COMMAND_IDS`（`src/keys.ts:166-184`），实现落在装配层 `commands` 记录。
  **验收口径**：`tsc` 通过（`Record<CommandId, CommandRunner>` 是全量记录，缺实现即编译错）。
- [ ] 4.2 运行期真源与档位计算：`fontSizePx` 一份值，`up` = `round(size*1.1)`、`down` = `round(size/1.1)`、
  钳 `[12,32]`、`reset` = 配置值；到界后无变化无提示。
  **验收口径**：纯函数单测覆盖 16 向上的七档与向下的四档、上下限、reset 回配置值（6.2）。
- [ ] 4.3 四条默认绑定（`Cmd-=` / `Cmd-+` → up，`Cmd--` → down，`Cmd-0` → reset），各带来由 `doc`。
  **验收口径**：`node tests/unit/run.mjs` 的既有「无孤儿命令」三项对账仍绿、`KEYLESS_COMMAND_IDS`
  内容不变；新增断言见 6.3。
- [ ] 4.4 token 陷阱的实测与钉死：⌘− 的事件 token 是 `Cmd--`（表内 MUST 写 `Cmd--`；
  写 `Cmd-Minus` 应永久不命中）；真机 ⌘⇧= 归一到 `Cmd-+`，合成事件可能是 `Cmd-Shift-=`。
  **验收口径**：单测（6.3）钉住前一条；真机读数（8.x）钉住后一条，差异写进场景注释而不是放宽断言。
- [ ] 4.5 确认不启用 Tauri 的 webview 缩放热键，并在 `src/keys.ts` 该组绑定的 `doc` 里写明理由。
  **验收口径**：`rg -n 'zoom_hotkeys|zoomHotkeys' src-tauri/` 零命中；视觉场景断言页面上不存在第二条
  消费这批键的监听（7.x 的「键位通路唯一」场景）。
- [ ] 4.6 键位面板核对：三条命令落既有「全局」组，分组标题数组与文案不变，未绑定行数仍为 0。
  **验收口径**：`tests/visual/scenes/m133-describe-bindings.spec.ts` 原样通过（**不改断言**）；
  `git diff src/bindings-panel.ts` 为空。

## 5. 重测量与几何正确性

- [ ] 5.1 按 1.4 的结论落地重测量（自动则加断言、不额外调用；需显式则对前台会话
  `requestMeasure()`，后台会话按既有分岔形态处理）。
  **验收口径**：7.x 的「改字号后坐标与行高一致」场景 PASS；断言里 MUST NOT 出现「函数被调用过」型判据。
- [ ] 5.2 光标可见性：字号变化后光标仍在视口内；若实测跳动明显，按 M103 的揭示原语处理。
  **验收口径**：7.x 的场景读数为「光标行的 `top` 落在 `.cm-scroller` 的可视区之间」；
  改动前先跑一次确认它会 FAIL（P0 的反向验证）。
- [ ] 5.3 列表标记宽度按新字号重测，且**测量与渲染同源**（既有消费者：`src/preview/lists.ts`）。
  **验收口径**：①改字号后标记宽度读数随字号等比变化；②默认与非默认 `mono_font_family` 两种口径下，
  标记**渲染**的 `fontFamily`（计算属性）与**测量**喂给 canvas 的族字符串逐字相同（两处都从同一个
  token 读）；读数落 `test-results/<mission>/…`。

## 6. 单测（`tests/unit`，纯逻辑层）

- [ ] 6.1 出厂默认常量的断言（TS 侧）与 Rust 侧默认值（2.3）成对。
  **验收口径**：`node tests/unit/run.mjs` 全绿，用例数与基线（以最近一次全绿输出为准）对得上。
- [ ] 6.2 档位纯函数：向上 7 档 / 向下 4 档 / 上下限 / reset 回配置值 / 反复乘除不漂移
  （从 16 上 7 次再下 7 次应回到 16）。
  **验收口径**：同一批断言里含一条**必须 FAIL 的输入**（如把倍率写成 1.2 后档位表不匹配），
  确认断言有区分度。
- [ ] 6.3 键位 token 形态：`keyToken({key:"-", metaKey:true})` === `"Cmd--"`；表内 `Cmd--` 归一后
  仍为 `Cmd--`；`Cmd-Minus` 与真实事件 token **不相等**（这条是反向断言，钉住静默失配）。
  **验收口径**：断言落在 `tests/unit/keys.test.ts`；`node tests/unit/run.mjs` 全绿。
- [ ] 6.4 不把 DOM / 布局行为塞进这一层（`tests/unit/README.md` 的分工）。
  **验收口径**：`git diff tests/unit/harness.ts` 为空（或改动仅在替身层且说明理由）。

## 7. 视觉场景与基线（chromium，CI 门禁）

- [ ] 7.1 新增场景 `tests/visual/scenes/typography.spec.ts`：①缺省配置下读数 = 1.1 的基线读数
  （默认口径不变）②配置 `font_size: 20` / 自定义字体生效 ③非法字体值与「未安装字体」退化为基线
  ④`⌘=` / `⌘−` / `⌘0` 三键与上下限 ⑤「键位通路唯一」（页面无第二条消费这批键的监听）
  ⑥焦点在左栏时 `⌘=` 仍命中。
  **验收口径**：1.2 的红灯在此转绿；判据全是**读数**（计算属性、px 值、几何），没有「命令被调用过」型断言。
- [ ] 7.2 「改字号后坐标与行高一致」场景（5.1 / 5.2 的落点）：光标矩形、行高、列表标记宽度、光标可见性。
  **验收口径**：先做反向验证（临时不请求重测量 / 临时把光标滚出视区），确认断言会 FAIL。
- [ ] 7.3 面板核对：`m133` 场景原样通过（行数按表派生），分组标题数组不变。
  **验收口径**：`m133-describe-bindings.spec.ts` 与 `m131-keymap-table.spec.ts` 全绿且**零改动**。
- [ ] 7.4 基线核对（[REVIEW.md](../../../REVIEW.md) 第 3 条 + AGENTS.md「基线更新是人肉裁决点」）：
  逐张核对 30 张既有基线是否零差异——**用内容判据逐张核**，不只对比时间戳；本 change 只新增
  1–2 张非默认口径基线（大字号 / 自定义字体），既有基线一张不改。
  **验收口径**：核对结果落 `test-results/<mission>/baseline-check.md`（逐张 + 判据 + 结论）；
  `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual` 全绿；新增基线**待 Alex 过目**后才生效。

## 8. 真机验收场景（WKWebView，`scripts/acceptance/`）

- [ ] 8.1 **新增场景** `scripts/acceptance/scenarios/28-typography-and-zoom.md`（编号按现有最大 27 续；
  `item` 字段取 28）：①以配置 `font_size: 20` 启动 → 读 AX / 几何证据确认字号生效（配置通道的端到端）；
  ②按 `⌘=` / `⌘−` / `⌘0` → 字号读数逐档变化、`⌘0` 回到 20；③按 ⌘⇧=（真机的 `⌘+` 形态）确认同样放大；
  ④`config.json` 内容与 mtime 逐字节不变。
  **验收口径**：`node scripts/acceptance/run.mjs --check` 通过；真机运行 PASS，证据落
  `test-results/acceptance/<日期>/28-typography-and-zoom/`。
  **断言形态**：字号是**计算属性**，真机套件没有计算属性通道 → 机器判据用「元素几何 /
  截图序列 + AX 文本」，并把「字号确实变了」的证据落成读数文件；MUST NOT 只靠「按键注入成功」判定
  （REVIEW.md 第 11 条：WKWebView 注入会整批丢键，判据走回读）。
- [ ] 8.2 真机反向验证：把 `applyTypography` 整段关掉（或回退到实现前代码）重跑同一场景 → 必须 FAIL。
  **验收口径**：FAIL 的 `status.txt` / `steps.md` 留档；随后立即还原并重新构建。
- [ ] 8.3 铁律核对：整轮场景前后，验收 vault 内文件哈希不变、目录内无新增文件（ADR 0003 §3）。
  **验收口径**：场景里的 `file.unchangedSince` 断言在位且 PASS。

## 9. 验证与收官

- [ ] 9.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
  **验收口径**：`GATE PASS openspec-validate`（`scripts/gate.sh quick` 的一步）。
- [ ] 9.2 `bash scripts/gate.sh quick` 与 `LUMIR_VISUAL_PORT=<空闲端口> bash scripts/gate.sh visual`
  全绿；`bash scripts/docs-check.sh` PASS；`cargo test`（含 bindings 漂移门禁）通过。
  **验收口径**：日志落 `test-results/<mission>/gate-visual.log`，逐行 `GATE PASS`，退出码 0；
  `git status --porcelain -- src/bindings/` 为空（ts-rs 生成物已提交）。
- [ ] 9.3 真机套件至少跑一次新增场景并留档（AGENTS.md：dogfood 批次合并后、Alex 验收前先跑一遍）。
  **验收口径**：`test-results/acceptance/<日期>/` 有本次 PASS 的 `summary.md` 与场景证据目录。
- [ ] 9.4 `git diff --check` 通过；改动文件集合与 proposal 的 Impact 清单一致。
  **验收口径**：`git diff --stat` 与 Impact 逐条对齐；确认 diff 里**没有** `src/style.css` 的 shell
  字号 / 字体字面量改动、没有 `src/preview/theme.ts` 的 `--font-display` 改动、没有新增配置写入通道。
- [ ] 9.5 收官对账：tasks 全部勾选（或标注放弃原因）、spec 增量与实现逐 requirement 对一眼；
  archive 时替换 CLI 写入的占位 Purpose（`docs/process/openspec-workflow.md` 的批次收尾 checklist）。
  **验收口径**：对账表落 tasks 末尾（逐 requirement → 实现落点 → 断言落点）；
  `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 归档后再跑一次全绿。

## 10. 已声明的边界 / 不做

- [ ] 10.1 不做整体界面缩放、不做字重 / 字距 / 行高 / 栏宽配置、不做字号与栏宽联动、不做字体枚举 UI /
  候选清单 / picker、不做原生菜单入口、不做 `M-x`、不做逐标签字号、不做鼠标滚轮缩放、不做热重载、
  不做 CJK / 拉丁分设字体。
  **验收口径**：`grep` 实现与 spec 均无对应的类型 / 字段 / 文案；`git diff` 里没有新增 UI 元素；
  `rg -n 'zoom_hotkeys|set_zoom' src-tauri/src/` 零命中（推荐形态下）。
- [ ] 10.2 不动编辑器内的渲染结构（代码块仍是行装饰、表格 / 公式 / mermaid 的排版结构不变）。
  **验收口径**：`git diff src/preview/livePreview.ts` 为空；`git diff src/preview/theme.ts` 只含字体
  变量名的替换（逐行核）；`git diff src/preview/lists.ts` 只含 `:44` 那处 token 名的替换（逐行核）。
- [ ] 10.3 不碰 `--font-display` / `--line-height` / `--measure` 的默认值，也不顺手改成
  `src/style.css:111` / `:226` 的两处字面量。
  **验收口径**：`git diff src/style.css` 只含 `:root` 新增三行与 `.cm-content` 那处的收口。
- [ ] 10.4 已知边界如实记录：字号越大每行字数越少（栏宽不联动）；配置类型错打 → 整文件回落（连
  `last_vault` 一起丢）；字体改动需重启生效；`[keys]` 不能重绑多段 chord（因此默认键位不取 Emacs 原键）。
  **验收口径**：四条都写进 spec 的已知边界或 proposal 的 Non-goals，可 `grep` 到；
  design §4 的未决项逐条有「已实测（读数路径）」或「未实测（如实标注）」的结论。
