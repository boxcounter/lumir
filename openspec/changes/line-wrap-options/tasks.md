# Tasks: line-wrap-options

实现顺序：配置面 → 前端状态与命令 → 渲染 → 面板与文案 → 单测 → 视觉 → 真机 → 收口。
每条完成后就地勾选；跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

## 1. 配置面（Rust）

- [ ] 1.1 `src-tauri/src/config.rs` 的 `EditorConfig` 增 `line_wrap: bool` 与 `code_block_wrap: bool`，
      `Default` 给 `true` / `false`（`config.rs:77-83`，与 `mode` 同路）
- [ ] 1.2 `RawEditorConfig` 增 `line_wrap: Option<bool>` / `code_block_wrap: Option<bool>`
      （`config.rs:142-146`，沿用 `#[serde(default)]`）
- [ ] 1.3 `validate()` 的 editor 分支按同一形状扩两行（`config.rs:237-247`）：
      缺字段 → 回落到 `Default`，不产生 warning
- [ ] 1.4 Rust 单测：缺字段取默认（比照 `missing_log_table_defaults_to_info`，`config.rs:519-526`）
- [ ] 1.5 Rust 单测：类型不符（`{"editor": {"line_wrap": "yes", "mode": "md"}}`）走整文件回落——
      断言此时 `line_wrap` 与 `mode` **同时**回到默认、warning 存在，不存在「部分按配置部分按默认」
      的混合态（design §2.1、§4-4）
- [ ] 1.6 跑 `cargo test`（在 `src-tauri` 下）让 ts-rs 重新导出 `src/bindings/EditorConfig.ts`，
      把生成物一并提交；`scripts/gate.sh:61-70` 的漂移门禁须绿

## 2. 前端：折行状态、会话与命令（`src/editor.ts`、`src/main.ts`、`src/keys.ts`）

- [ ] 2.1 `src/editor.ts`：新增 `wrapCompartment = new Compartment()`（与 `modeCompartment` `:979` 并列）
      与 `wrapExtensions(mode, wrap)`；`sessionState(...)`（`:1178-1233`）增加折行参数，
      替换掉写死的 `EditorView.lineWrapping`（`:1227`）
- [ ] 2.2 `EditorSession`（`:825-858`）持有折行状态（真源），内核另存 `defaultWrap`（新标签页起点，
      只有在配置加载时移动）；`makeSession` / `createSession`（`:1235-1246` `:1416-1422`）从
      `defaultWrap` 起步（design §2.2）
- [ ] 2.3 状态变更走单一路径 `reconfigureWrap()`，由 `setMode`（模式变了要跟着重配）与
      `setWrap`（折行值变了）共用；MUST NOT 在 `livePreview()` 内部读折行状态（design §2.2）
- [ ] 2.4 `src/keys.ts`：新增 `KEYLESS_COMMAND_IDS`（默认不绑键清单）并导出；两条折行命令 id
      `view.toggle-line-wrap` / `view.toggle-code-block-wrap` 进 `NON_TAB_GLOBAL_COMMAND_IDS`
      （`:160-172`）；表内 MUST NOT 为它们加任何默认绑定
- [ ] 2.5 `src/main.ts` 的 `commands` 记录（`:393-420`）加两条实现：翻转发起的命令对应当前标签页的
      折行值、调用 2.3 的重配入口；doc/注释写明默认不绑键、`[keys]` 可绑
- [ ] 2.6 `src/main.ts:805-807` 的配置消费点：把两个值写进 `defaultWrap` 并应用到当前前台会话
      （`setMode` 之后），与 `applyKeyConfig` 并列
- [ ] 2.7 TS 侧出厂默认（`DEFAULT_LINE_WRAP = true` / `DEFAULT_CODE_BLOCK_WRAP = false`）与 Rust
      `Default` 互指注释 + 各自单测钉住（REVIEW.md 第 8 条；design §2.7）

## 3. 渲染：文件级与代码块级

- [ ] 3.0 **先验两条 CM 契约**（design §4-0，本 worktree 无 `node_modules`）：① 折行的 `white-space`
      落在 `.cm-content.cm-lineWrapping` 上、`.cm-line` 自身没有；② `EditorView.blockWrappers` 可并存
      多个 facet 值（表格与代码块各一套）。②不成立时按退路走：并入同一个 wrapper 函数
      （`blockWrappersFor(view)`）。验证方式写进实现 PR 描述（一行实测命令或最小断言）
- [ ] 3.1 文件级：`line_wrap = false` 时不装 `lineWrapping`，超长行由 `.cm-scroller` 横向到达；
      断言没有内容被裁掉（design §2.4）
- [ ] 3.2 代码块级：`code_block_wrap = false` 时给 `.cm-content` 加内容级 class，CSS 把
      `.cm-line.cm-lp-codeblock-line` 的 `white-space` 压回 `pre`、`overflow-wrap` 回 `normal`
      （`src/preview/theme.ts:59` 附近或 `src/style.css`）
- [ ] 3.3 `src/preview/livePreview.ts`：新增 `codeBlockWrappers(view)`（与 `tableWrappers` `:234-279`
      同形，视口有界，MUST NOT 全文档扫描），为围栏 / 缩进代码块生成横滚容器；容器带
      `tabindex=0` / `role=region` / 读屏名（与表格容器 `:262` 同形）
- [ ] 3.4 容器 MUST NOT 照抄 `padding-block: 12px`（`src/style.css:273-289`）：改写前先跑一次视觉门禁
      留底，确认翻转开关带来的几何变化只来自折行本身；容器自带 `--bg-2` 底板（design §2.3-3、§2.3-7）
- [ ] 3.5 `src/keys.ts`：新增泛化的「块级横滚容器」class 作为单一来源，两类容器共用；
      表格容器**同时保留** `cm-lp-table-scroll`（`TABLE_SCROLL_CLASS`，`:205`）——既有选择器与字面量
      断言按它定位（`tests/unit/keys.test.ts:249`、`tests/visual/scenes/m119-table-width.spec.ts` 等
      多处）；`isWidgetKeyTarget`（`:208-211`）改查泛化后的 class
- [ ] 3.6 命中条件的语义（design §4-2）：确认「容器自身持有焦点」的实现（按需收紧为
      `closest(...) && document.activeElement?.closest(...)`），并把表格的既有场景
      （`tests/visual/scenes/m131-keymap-behavior.spec.ts:158-195`）回归一遍
- [ ] 3.7 嵌套语境实测（引用块 / 列表项内的围栏代码块，design §4-1）：能承载局部容器就写进视觉场景；
      确实承载不了的形态写进 spec 的已知边界——MUST NOT 静默退化成整窗横滚

## 4. 键位面板与文案

- [ ] 4.1 `src/bindings-panel.ts:101` 的未绑定行说明串扩为覆盖两种成因并指向下一步
      （默认不占键位 / 已被配置解绑，可用 `[keys]` 绑定）
- [ ] 4.2 `文案-Copy.md` D66 同步修订（编号沿用、附修订记录，先例见 D86 于 M160 的扩写）
- [ ] 4.3 确认两条命令落进既有「全局」组、MUST NOT 新增分组（`src/bindings-panel.ts:44` 的
      `{ title: "全局", ... }` 条目）；同时扫掉 `tests/visual/scenes/m133-describe-bindings.spec.ts:65`
      行内注释仍写「8 组」的残留（`GROUPS` 实为 9 组，该文件本轮本就要改行数断言，顺手校正，REVIEW.md 第 8 条）
- [ ] 4.4 本 change 无 toast / 无常驻指示 → 不需要新文案条目（若有任何新增可见文案，回到本项补条目）

## 5. 单测

- [ ] 5.1 `tests/unit/keys.test.ts`：三项对账断言——每条命令有绑定或在 `KEYLESS_COMMAND_IDS` 里；
      清单无幻影 id；清单与 `KEY_BINDINGS` 无交集（design §2.6）。先造一个必须 FAIL 的输入实测
      断言有区分度（REVIEW.md 第 1 条）
- [ ] 5.2 `tests/unit/keys.test.ts`：两条新命令的作用域派生结果是 `global`、不在 `KEY_BINDINGS` 里、
      且 `[keys]` 覆盖能把它们绑上（含「绑定后作用域仍由清单派生」）
- [ ] 5.3 前端单测：折行状态随会话独立（切换会话不串值）；`defaultWrap` 不因 toggle 移动
      （新会话仍取配置默认）（design §2.2）
- [ ] 5.4 前端单测：`line_wrap = false` 时 `wrapExtensions` 不含 `lineWrapping`；
      `code_block_wrap` 的四种组合各一条断言（含「一元素一条规则」的边界）
- [ ] 5.5 1.4 / 1.5 / 2.7 的 Rust 与 TS 默认值单测（两侧同批）

## 6. 视觉门禁

- [ ] 6.1 新增含**超长代码行**与**超长正文行**的 fixture（既有
      `tests/visual/fixtures/render-codeblock/languages.md` 最长行 45 字符，暴露不了默认变更，
      design §4-5）
- [ ] 6.2 `tests/visual/scenes/render-codeblock.spec.ts` 增场景：默认口径下代码行不折行
      （断言 `getComputedStyle` 的 `white-space` 为 `pre` 且行高只占一行）、块内可滚
      （`scrollWidth > clientWidth`）、容器存在且 `tabindex=0`
- [ ] 6.3 增场景：容器键盘可达（`Tab` 聚焦 → `→` 滚 120px → `End` 最右 → `Home` 最左 → `Escape`
      交还焦点），与表格容器同行为
- [ ] 6.4 增场景：横滚到右端不露白底（读计算背景色一致）；容器不改变代码块的纵向节奏
      （与 `code_block_wrap = true` 对照）
- [ ] 6.5 增场景：`line_wrap = false` 时正文行不折行 + 编辑区可横向到达；四种组合的呈现各截一张
      （元素级或整页）
- [ ] 6.6 `tests/visual/scenes/m131-keymap-table.spec.ts:52-66` 的两处循环改为三项对账
      （按 `KEYLESS_COMMAND_IDS`）
- [ ] 6.7 `tests/visual/scenes/m133-describe-bindings.spec.ts`：行数改为
      `KEY_BINDINGS.length + KEYLESS_COMMAND_IDS.length`、未绑定行数改为清单长度、加未绑定说明串断言
- [ ] 6.8 逐张核对出现过代码块的整页基线（`ls -l tests/visual/baselines/*-snapshots/` 看时间戳）；
      需要更新时按 `tests/visual/README.md` 的纪律走，截图**先交 Alex 过目**（AGENTS.md 硬规则）
- [ ] 6.9 门禁：`LUMIR_VISUAL_PORT=<未被占用端口> scripts/gate.sh visual` 全绿，输出留档

## 7. 真机验收（agent 执行，不进 CI）

- [ ] 7.1 `scripts/acceptance/lib/app.mjs` 的 `writeConfig`（`:28-33`）支持写入两个新字段（可选参数，
      不写即默认）
- [ ] 7.2 新增场景（编号续现有序号）：默认口径下打开含超长代码行与超长正文行的文档——代码块不折、
      块内可滚、正文折行；`line_wrap = false` 时正文不折且可横向到达
- [ ] 7.3 新增场景：`[keys]` 把新键绑给两条命令后按该键，折行口径立即变化；`config.json` 的内容与
      mtime 逐字节/mtime 不变（这是「瞬态、不落盘」的机器判据，design §2.7）
- [ ] 7.4 真机断言走「回读 + 只在字节未变时重试」，MUST NOT 用重试次数当成功判据（REVIEW.md 第 5、
      11 条）；场景启动前确认 1420 / 1430 没有别的 Lumir 实例
- [ ] 7.5 起实例前 `df -h` 看磁盘水位；按 AGENTS.md 的白屏陷阱纪律选启动方式
- [ ] 7.6 证据落在 `test-results/acceptance/`（git 外），报告里的每个路径先用绝对路径 `ls` 一遍
      （REVIEW.md 第 7 条）

## 8. 收口

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 8.2 `scripts/gate.sh`（quick）全绿：fmt + clippy + cargo test + bindings 漂移 + tsc + openspec
      validate
- [ ] 8.3 文档同步：`文案-Copy.md`（4.2）、`scripts/acceptance/README.md`（新场景的用法若有变化）、
      `docs/backlog.md`（本 change 实施中冒出的 findings）
- [ ] 8.4 归档对账（`docs/process/openspec-workflow.md` 的批次收尾 checklist）：本 change 合并时落一条
      待归档记录；归档前逐条对账 tasks / spec 增量 / 实现；归档后核对新建 capability 的 Purpose
      （本 change 不新建 capability，`editor-live-preview` 与 `keymap-commands` 都是既有 living spec）
- [ ] 8.5 把「实现期必须验证」的结论回填 design §4：每条标注实测结果（成立 / 走退路 / 转为已知边界），
      不留「待验」字样进归档
