# Backlog — findings 与待裁决队列

唯一的积压载体（2026-09-16 起自 HANDOFF.md 迁入并入 git）。

维护规则：

- 新 findings 由发现者（worker / reviewer / tower）落成条目，注明**来源 mission/批次**与**日期**；HANDOFF.md 只记 session 状态，不再积压。
- 条目状态：`待裁决` / `待修` / `待验收` / `记录在案`；核销后移入文末「已核销」并定期清理。
- 每条尽量附复现/证据指针；裁决类条目给出选项与推荐。

## 待 Alex 裁决

1. **历史敏感信息是否 filter-repo**：M111/M115 历史提交中的真实文件名；`docs/design-parity-contract/evidence/*.log` 约 20 行本机路径。tower 建议不必（仓库 M3 前不公开）。遗留自批次一。
2. **demo 右侧探针栏去留**：版面/文案决策，建议随 theme 重做一并处理。遗留自批次二。
3. **「保留我的版本」后自动保存暂停但用户无感知**：无回归；提示文案留 UX 重做阶段。遗留自批次二。
4. **宽表横向溢出裁切是否预期**：实测溢出 1549pt vs 栏宽 766pt，AX 层完整。待 Alex 对照设计规格确认。遗留自桌面复验（M116 期）。
5. **Emacs 档 3 与全产品键位**：isearch / mark / region / ⌃X 前缀，及左栏 tree/shell 零键盘支持——待 UX 重做会话与 dogfood 反馈后立项。批次三遗留。

## 待修 findings（不阻塞）

### 编辑器 / 键位

- **Alt+Shift token 口径**（M132，medium）：`keyToken` 对含 Alt 组合忽略 Shift，`Alt-KeyF` 同时命中 ⌥F 与 ⌥⇧F。修法已录 spec 已知限制：Alt 分支纳入 shiftKey + 别名拆两条绑定。
- **`ConfigSnapshot.warnings` 无 UI 出口**（M132，medium）：`config.json` 中 `keys` 表的未知命令 warning 只进 console。提示文案/UI 留 UX 重做阶段。
- **toast z-index 10 衬在 ⌘/ 面板遮罩（20）下**（M133）：面板打开时非 sticky toast 自动消失可能未被看见。dogfood v0 可接受，留 UX 重做会话。
- **mermaid/frontmatter 无键盘进入路径**（M118 findings）。
- **caret 停靠隐藏边界时短暂不可见**（M118 已知外观残留）。
- **`\$` 转义误判**（M106，低优先级）。
- **mathSpanCrossed ±4KB 窗口对超大公式块的切割**（M111 review 观察）。
- **代码围栏行尾恰为 `$...$` 时跨行 Ctrl+B 一次移两字符**（M113，罕见且良性）。
- **相邻 grid 表连排时 Ctrl+N/P 每按一次过一张表**（M113，与裁决不冲突）。

### shell / 系统

- **退出守卫菜单结构假设**（M101 review）；Dock/系统关机路径不覆盖。
- **注册表目录 `{id}.json.tmp` 无扩展名过滤会被当注册项解析**（M126 finding；修复时顺带清掉 sweep_registry 对非 .json 文件的写面）。

### 未复现

- **编辑区全空白偶发**：M114 一次、M116 0/3，复现条件未锁定。待运行时诊断日志（openspec/changes/add-diagnostics-logging）落地后靠事件序列定位。
- **视觉套件 `markdown-parser` 的 `large-mixed` 偶发失败**（M144 一次，低）：整轮视觉回归里它 `page.evaluate: TypeError: Cannot read properties of undefined (reading 'metrics')` 失败一次（该用例把 `mixed` 文档重复 2000 次喂给解析实验，并挂 CDP profiler 采样），单独重跑与随后整轮重跑都 10/10 PASS。现场没有留下可归因的线索（不是本批次的改动路径——该 fixture 是独立的 vite 子应用，不加载 `src/`）。**给后续跑 `gate.sh visual` 的人**：它若偶发报红，先单独重跑该 spec 再判断，别当成自己的回归。

### 验收套件（M144 实测出的表达力缺口）

- **`click` 动作不支持修饰键**（M144，medium）：`lib/execute.mjs` 的 click 只有 `target` / `count`，没有
  modifier 参数，因此「⌘-Click 跟随链接」这条路径**在真机套件里无法触发**（⌘⏎ 可以，键位动作支持 chord）。
  M144 改用视觉场景覆盖该路径（`tests/visual/scenes/render-link.spec.ts`：stub 记录
  `open_external_url` 的调用目标，断言开的是哪个 URL 且不真开浏览器）。修法：给 click 动作加
  `modifiers: ["meta"]`（KimiCU 的 `click` 底层已支持 mouse_button，修饰键需在 `cu.mjs` 侧按住 meta 再点）。
  **M144 裁决：套件能力改造另开 mission，本批不做。**

## 工具链与环境（待 Alex 裁决）

1. **1420 端口串行**：vite dev server 固定 `127.0.0.1:1420` 且 strictPort，全机同一时刻只能有一个
   `pnpm tauri dev` 实例。并行批次起实例前先 `lsof -nP -iTCP:1420 -sTCP:LISTEN`，被占则与对方错峰。
   验收套件自身走 1430（`LUMIR_ACCEPTANCE_PORT`），不受此限。来源：批次四 M134/M135 并行实证，2026-09-16。
2. **tower 并行批次的磁盘预算**：每个 worktree 的 cargo debug target 占 1.5–3G（2026-09-16 实测：
   main 4.5G / wt-134 3.8G / wt-135 2.2G / wt-136 2.1G）；磁盘 <1G 时 ENOSPC 硬阻塞所有真机批次
   （实测 219MiB 时 `pnpm tauri dev` 因 vite 临时文件写失败而中止）。验收套件已把「<2G 不起实例」
   写进预检。长期方案候选：worktree 共享 `CARGO_TARGET_DIR`（代价：并发构建互斥）。
   **M142 补充（2026-09-16 晚）**：全机可用空间一度只剩 2.7G（其余被既有 target 占满），按上表预算
   判断装不下一次全新的 worktree debug 构建——建到一半 ENOSPC 会留下半截 target 且不回血，比不构建
   更糟，于是当时先把顺序定为「先跑 chromium 视觉门禁，真机待空间腾出」；随后空间回到 6.8G，同一晚
   完成首次 debug 构建与真机全量验收（19 场景 / 197 断言全 PASS，证据 `test-results/acceptance/2026-09-16/`），
   本轮交付**不是**「只跑视觉」的状态。
   建议把预检口径从「可用 ≥2G」细分出「worktree 首次构建须 ≥3G，target 已热才可用 2G 档」。
3. **KimiCU 键盘注入对 WKWebView 在窗口遮挡时不可靠**（批次四 M134 实证）：返回 `occluded:true`，
   activate 后也未必恢复；AX 写入（`set_value`）可靠。故键盘场景须前台焦点纪律，且**不得用
   set_value 伪造键盘语义**（不经键位分发链路，验不到 `keys.ts`）。长期候选：dev-only 脚本化驱动入口
   （`LUMIR_DEV_SCRIPT` 或 debug-only invoke）。
4. **KimiCU AX 服务会中途全局退化**（2026-09-16 M135 期间出现两次）：`get_app_state` 只剩菜单栏
   （`element_count` 1–18、`truncated: [closed_menu, cycle]`、`window_bounds x=0 y=0 w=1 h=1`），
   Finder / Reminders / Lumir 一起坏，`xpc-ping` 仍报 `accessibility=true screenRecording=true`。
   恢复手段 = 重注册服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`，tower 两次复验有效）。
   对套件的影响：整套一起报「前端未就绪」，不是场景缺陷。
   **诊断线索**：退化期间 `log show --predicate 'process CONTAINS "kimi-cu"'` 显示服务每秒一次
   `TCCAccessRequest() IPC`（重试循环），而 `xpc-ping` 仍报已授权；两次退化都发生在磁盘 <1G 时，
   疑与服务写不出缓存后进入重试态相关。
5. **`scripts/perf/memory.mjs` 的 WebKit pid 差集归因在非独占主机不可靠**（外来 helper 被误算，
   实测一次 409.7MB 虚高读数）；常驻内存存量超合同（2026-09-06 evidence 已 218–222MB）——
   合同口径裁决随 dogfood 性能专项。

## 待真机验收

行为判定已下沉为 agent 可执行场景（入口 [scripts/acceptance/](../scripts/acceptance/README.md)，
设计见 [docs/process/real-machine-acceptance.md](process/real-machine-acceptance.md)）；手感/审美项仍归 Alex。

分类依据 = **证据目录里真实 PASS 的场景**，不是「场景写了就算覆盖」。最近一次全量实跑：
**`test-results/acceptance/2026-09-16/`（主 checkout 路径；M138 的 run 在 wt-138 worktree 下的同名目录，
合并时由 tower 复制回主 checkout——master 上该目录此前是 M135 的 15 场景旧记录）** ——
**17 场景 / 161 断言 / 16 PASS 1 FAIL**（约 6 分钟，M138）。唯一 FAIL 是
`08b-autosave-pause` 的「追加输入落在探测串之后」——冲突 toast 出现后盲发的 `m,o,r,e` 四次按键
都没进编辑器（AX value 里根本没有 `more`），而该场景真正要判的四条冲突期断言（磁盘 sha256 未变 /
磁盘仍是外部版本 / 内存改动未丢 / 提示未消解）全 PASS。**已排除与 M138 的因果**：把本次 src 改动
stash 掉重跑，同一断言以同一文本复现 FAIL（2/2 复现，非 flake）；而 M135 tip 在同日证据里该场景
是 PASS。归因、复现步骤与修法已落 finding
`.tower/comms/findings/20260916-worker-render-bug-08b-autosave-pause-do-keys-2-2-keys.md`
（与 worker-search 的 `press_key` 丢键 finding 同族；套件 `keys` 动作缺回读/重试），待套件维护者另开一轮收口。

**已机验（行为判定落定，有 PASS 证据）**

1. **Mermaid 点击进源码编辑** —— `01-mermaid-click`：渲染态（成功块为 `help=围栏原文` 的 widget、
   失败块给「图表解析失败」+ 原文）→ 点击 widget → 源码显露、widget 让位。渲染中(pending)态窗口极短，
   只留截图。
7. **M124 三条恢复路径全部覆盖** ——
   `07-recovery-paths`（冲突双动作：外部改写后保存给「重新载入 / 强制覆盖」、内存改动未丢、磁盘未被静默覆盖）；
   `07b-recovery-saveas`（**真删除**触发 `fs_not_found`，不是清空——清空走冲突分支：⌘S 给「保存失败：文件
   已被外部删除或移动」+「另存为新文件」，点击后 `plain-恢复.md` 真实落盘且内容 = 内存缓冲）；
   `07c-external-reload`（干净缓冲 + 外部改写 → 编辑器文本自动换成磁盘内容，不打扰用户）。
8. **M127 自动保存链路四条子行为全部覆盖** ——
   `08-autosave`（2s 落盘：磁盘 sha256 变化且内容含输入）；
   `08b-autosave-pause`（**冲突待决期间自动保存暂停**：记录磁盘 sha256，跨 2s 去抖再等 7s，磁盘逐字节不变、
   仍是外部版本、冲突提示未消解；本场景的「追加输入落点」前置断言当前 FAIL，原因见上节，暂停行为本身
   的四条断言每轮都 PASS）；
   `08c-crash-recovery`（app 自己在隔离目录写的崩溃备份 →  重启后提示「恢复内容 / 丢弃备份」，
   点「恢复内容」后崩溃前内容回到编辑器）；
   `08d-crash-discard`（同现场点「丢弃备份」：给丢弃反馈且内容**不**进编辑器）；
   `08e-force-overwrite`（强制覆盖的不可撤销二次确认「覆盖保存」；覆盖后磁盘确是内存版本；
   再次冲突仍给同一组动作且磁盘未被静默覆盖）。
9. **Emacs 键位 / ⌘Z / ⌘/ 面板 / `config.json` keys 表** —— `09-emacs-keys`、`09b-keys-config`：
   **⌘Z 未被 macOS 视图层级吃掉**（插入 → ⌘Z → 内容消失，menu swap 真机成立，回退方案不必启用）；
   ⌘/ 面板打开/关闭、打开期间文档逐字节不变（作用域键与可打印字符都不穿透）；
   keys 表解绑 ⌘S / 重绑 ⌃S 生效。
10. **Markdown 渲染三件套**（M138）—— `render-markdown`：`---` 渲染为横线且 frontmatter 定界符
    不误渲（AX 面读到读屏名「分隔线」、`editor.not "---"`）；围栏代码块源码逐字保留、未收录语言
    保持纯文本；引用内有序/无序/嵌套列表按常规列表渲染（`- ` 与 `>` 都不再显露）。
    **配色与几何不进真机**：横线宽度=栏宽且本体 0 高、标记走等宽字体且同级正文列对齐、token 色值
    全部取自既有 editorial token——由视觉门禁 `tests/visual/scenes/render-{hr,codeblock,quote-list}.spec.ts`
    的计算色/几何断言守（chromium），真机只验文本层与 AX 结构。
11. **表格降级文案归因**（M138）—— `render-table-degrade`：表头声明 3 列、第 10 行有 4 格（**多列**，M142 起降级只由多列/槽位不可映射触发）时，
    AX 面读到「第 10 行单元格数与表头不符（应为 3 列）」与「保留原始 Markdown」，同时整块保持
    源码态（不丢列、不截断）；同 fixture 的短行表（末行少一格）自 M142 起按矩形渲染，AX 面读到
    `Markdown 表格`、该行源码不再显露。

**已机验到渲染/结构层，行为细节仍缺可观测面**

2. 公式进编辑 —— `02-math-click`：行内/块级公式均渲染为 KaTeX、源码不显露。
   **「公式后 ⌃B 是否 1–2 次」仍待判定**（需光标停在公式 span 之后；AX 输出不暴露光标/选区，
   纯键盘落位无法回读校验；代码口径 1 次，`mathSpanCrossed` 落点 = span.to−1）。
3. Ctrl+N/P 表格行为 —— `03-table-ctrl-np`：grid 表确实渲染成 `AXTable (Markdown 表格 N)` + `AXRow`
   单元格文本；⌃N/⌃P 序列后表格与文档内容完好。**逐 cell 落点不可回读**；实测按坐标点进 AXTable 的
   bbox 内也不会让渲染态表格让位给源码行，故不做该断言。
5. cell 内公式 —— `05-cell-math`：`$y$`/`$$y$$` 在 cell 内按行内样式渲染（AX 行文本 `行内 / y / 块级 / y`）。
   **「点击渲染态公式进编辑」不可机验**（KaTeX span 既不进 AX 树也不带 bbox，与项 2 同因）。
6. Callout —— `06-callout-and-width`：渲染态下 `[!note]` 标记与 `>` 前缀都不显露、内容按块渲染。
   **「光标进该行后源码显露」不可机验**（需光标落在 callout 首行）；表格宽度只留截图证据。

**仍归 Alex 手感（不下沉）**

4. 表头 cell 双击 padding 的选中手感。
5. 表格 cell 内公式点击手感；6. 表格宽度观感（欠宽不拉伸、超宽横滚是否合意，与「待 Alex 裁决」4 同源）；
7. WKWebView 下三条恢复路径的手感；9. Emacs 翻屏/扩选真机手感。截图在证据目录，判定归 Alex。
10. 分隔线的粗细与上下留白、围栏代码块配色的观感（M138）——机器断言只钉「渲成横线（发丝线、
    宽度=栏宽）」与「色值取自既有 editorial token」，合不合意归 Alex；前后对比见
    `tests/visual/baselines/render-*.spec.ts-snapshots/` 与真机截图。

## 记录在案（无需动作）

- **KimiCU AX 服务全局退化**（2026-09-16，M135 期间实测）：`get_app_state` 只剩菜单栏（`element_count`
  1–16、`truncated: [closed_menu, cycle]`、`window_bounds x=0 y=0 w=1 h=1`），Finder / Reminders / Lumir
  **一起坏**；`xpc-ping` 仍报 `accessibility=true screenRecording=true`。判定为 KimiCU 后台服务进了坏状态，
  恢复手段是重启服务（`/Applications/KimiCU.app/Contents/MacOS/kimi-cu install`）。这是机器级动作，
  已上报 tower 待 Alex 处理；套件本身无问题，恢复后重跑即可。
- **r1 格式崩溃备份**（无 base_revision）恢复后首次保存必报一次冲突——安全方向，仅限跑过 r1 build 的人。
- **kimi-cu `type_text` 走 AX 注入**，编辑器失焦时文本落陈旧原生选区——工具观测，非 app 缺陷。
- **`config.json` 解绑 ≠ 关闭能力**（已录 spec）：解绑后 macOS 原生选择器可能接手（如 ⌃K → `deleteToEndOfLine:`）——dogfood 改配置时预期内行为。

## 已核销（留痕，定期清理）

- 2026-09-16：**验收套件 `file` 断言支持 glob 路径**（M144 落地，finding `20260916-worker-links-improve-file-glob-dated.md` + tower clarify-reply 裁决）：`file.path` 含 `*` 时按 glob 在父目录里取**匹配文件里 mtime 最新的那一份**再断言内容。动因是诊断日志按 UTC 日期命名、而验收环境的 `env/` 目录跨天复用（`envHome()` 不带日期）——写死日期的断言会在之后每天读到上次 run 留下的旧文件而**永久空过**（假绿），换机又直接 FAIL。落点：`scripts/acceptance/lib/execute.mjs` 的 `resolveSpecFile`（约 20 行）+ `scripts/acceptance/README.md` 断言表一句 + `scenarios/12-links.md` 用 `env:logs/*.jsonl` 断言 `link_open` 落盘并顺带断言日志里没有 URL 原文。**反向验证过**：在日志目录植入一个 mtime 更晚、不含 `link_open` 的文件后场景如实 FAIL（证明确实取最新那份、断言不空转），移除后 PASS。已知残余风险（同日重复跑时最新文件里可能有上一次的事件）写在场景正文，该断言与三条负断言联合构成判定。

- 2026-09-16：**外链渲染与打开快捷键**（M144）→ Alex 裁决采纳（原话「链接（[title](link)）渲染成 title↗︎，并增加打开它的快捷键」「wikilink 内部跳转体系不动」）：`[title](url)` 在 md 模式渲染为 `title` + 尾部 `↗︎`（U+2197 + U+FE0E），括号与 `(url)` 走 replace 装饰隐藏、文档逐字节不变（ADR 0003 §3）；光标/选区触及链接时整条显露源码——编辑态与改动前一致（改动前没有链接装饰，编辑 URL 看到的就是原文），同时避免长 URL 被隐藏后中间出现「按键而光标不动」的死区。`⌘⏎` 与 `⌘-Click` 走同一条命令（`wikilink.follow` → `link.follow`）：外链经 Rust 的 `open_external_url` 交给系统默认应用，wikilink 走既有 link_graph 跳转链路（未解析只提示、不建文件），都不在链接上则无操作。非外链形态（相对路径 / 纯锚点 / 白名单外 scheme / 自动链接 / 引用式链接）保持原文不装饰——「能开的才看起来能开」。落点：`src/preview/links.ts` 新增（判定取自 lezer 语法树，不手写词法；`ensureSyntaxTree` 同步推进避免大文档刚打开时 ⌘⏎ 静默无反应）、`src/preview/livePreview.ts` + `theme.ts`（`Link` 节点装饰、`↗︎` widget、`.cm-lp-link` 样式）、`src/main.ts`（`link.follow` 命令与鼠标路径；⌘-Click 不再以 `currentPath` 提前返回——外链不需要 vault 上下文）、`src/keys.ts`（命令更名）、`src/ipc.ts` + `src-tauri/src/commands.rs`（`open_external_url`：scheme 白名单 **http/https/mailto** + 目标可信性校验，拒绝 → `open_url_rejected`，系统调用失败 → `open_url_failed`）、`src-tauri/src/lib.rs`（注册 `tauri-plugin-opener`，并以 `open_js_links_on_click(false)` 关掉插件注入的「点击 `<a target=_blank>` 直接开浏览器」脚本——那是绕开校验的第二条打开路径）、`src-tauri/src/logging.rs`（`link_open` 事件，字段 `scheme`/`outcome`，**不记 URL 原文**——URL 是文档内容，隐私边界优先于排查便利）。**权限最小化**：capabilities 不新增任何 `opener:*`，webview 对插件 IPC 保持默认拒绝，唯一入口是本仓 command（与 rfd 不引 tauri-plugin-dialog 同一取舍，见 `src-tauri/Cargo.toml` 注释）。提案 `add-external-link-open`。证据：视觉场景 `tests/visual/scenes/render-link.spec.ts` + 基线 `render-link-chromium-darwin.png`（渲染态 / 源码显露 / 文档逐字节不变 / 桩记录 `open_external_url` 的调用目标，零浏览器启动）；真机场景 `scripts/acceptance/scenarios/12-links.md` + fixture `links.md` / `links-wiki.md` / `links-missing.md`。文案 D77–D79。

- 2026-09-16：**表格合同收窄——短行尾部补空列对齐 GFM**（M137 finding `20260916-worker-table-survey-idea-gfm.md`，M142 落地）→ Alex 裁决采纳（原话「好，采纳。」）：数据行 cell 数少于表头时**尾部补空 cell 正常渲染**（GFM spec §4.10，GitHub/Obsidian 同款）；**多列仍整块回退**（GFM 对多列是 excess ignored，静默丢列与「不猜测修复」冲突）。落点：`src/preview/table.ts` 补零宽空 slot（`padShortRow`，一个槽位都没恢复出来的行不补——那是映射失败，必须降级）；`src/preview/livePreview.ts` 零宽空 cell 的空槽装饰改走 point widget（CM6 对零宽 replace 装饰抛 `RangeError: Invalid range for replacement decoration`，两侧默认非 inclusive）。降级文案措辞未变（收窄后只由多列/槽位不可映射触发，D73–D75 仍然准确）。合同 `docs/specs/table-reading.md` §2/§9 收窄；OpenSpec 提案 `narrow-table-short-row-gfm-padding`（含 `complete-markdown-reading` / `foundation-table-reading` 两份未归档 delta 的同主题口径对账）。证据：视觉场景 `tests/visual/scenes/table-foundation-v2.spec.ts`（短行 fixture 翻转为渲染断言 + outline.md 同款 6 列表头/5 cell 行专门断言 + 多列降级断言）；真机场景 `render-table-degrade` 改多列形态并补短行表渲染断言。

- 2026-09-16：**表格降级文案不暴露原因**（M137 finding `20260916-worker-table-survey-improve-reason.md`）→ M138 落地：降级文案带上出错**文档行号**与应为列数（`第 N 行单元格数与表头不符（应为 M 列）`），oversize 走体积/上限文案，无法识别结构走兜底文案；文案单一来源 `src/preview/table.ts` 的 `degradationNotice`，上屏（`::after` 经 data 属性）与 aria-label 同一份。同步断言在视觉场景 `table-foundation-v2` 与真机场景 `render-table-degrade`。
- 2026-09-16：**视觉门禁容差假绿** → Alex 裁决收紧 `maxDiffPixelRatio` 0.005→0.001 + 删 UI 后核对相关基线时间戳（卫生步骤入 tests/visual/README.md 与 AGENTS.md）。
- 2026-09-16：**lists 100k 性能预算** → Alex 裁决放宽 p95 40→60ms（间歇超属环境噪声；随 dogfood 性能专项复核是否回调）。
- 2026-09-16：**run.sh 端口占用检查只查 4173** → 已修，检查 `${LUMIR_VISUAL_PORT:-4173}` 实际端口。
- 批次三：键位分发三轨并行 + 扩展名注册表漂移（M130/M131/M132）；save-ipc.ts 折回 ipc.ts（M132）；Ctrl-K/D/T 原生路径风险（M132）。
- 批次二：DeepSeek Flash 试用结论——可做 build，review 环节（k3-256k）不能省。
