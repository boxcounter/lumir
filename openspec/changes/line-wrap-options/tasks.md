# Tasks: line-wrap-options

实现顺序：配置面 → 前端状态与命令 → 渲染 → 面板与文案 → 单测 → 视觉 → 真机 → 收口。
每条完成后就地勾选；跑不动的项写「未验」并附原因，MUST NOT 写成已验（REVIEW.md 第 6 条）。

**口径基线（节点 1 裁决，2026-09-18）**：D1 = **应用级**（推翻了初稿的标签页级），D2 = 不做原生菜单，
D3 = 命令作用域 `global`，D4 = 代码块容器键盘可达性随本 change 一起做，D5 = 不做播报 / 常驻指示。
本文件里凡与「应用级」相关的表述都以 D1 为准（`proposal.md` 的「裁决记录」节是同一条结论的索引）。

## 1. 配置面（Rust）

- [x] 1.1 `src-tauri/src/config.rs` 的 `EditorConfig` 增 `line_wrap: bool` 与 `code_block_wrap: bool`，
      `Default` 给 `true` / `false`（`config.rs:77-83`，与 `mode` 同路）
- [x] 1.2 `RawEditorConfig` 增 `line_wrap: Option<bool>` / `code_block_wrap: Option<bool>`
      （`config.rs:142-146`，沿用 `#[serde(default)]`）
- [x] 1.3 `validate()` 的 editor 分支按同一形状扩两行（`config.rs:237-247`）：
      缺字段 → 回落到 `Default`，不产生 warning
- [x] 1.4 Rust 单测：缺字段取默认（`missing_editor_wrap_fields_take_defaults`，比照
      `missing_log_table_defaults_to_info`）
- [x] 1.5 Rust 单测：类型不符（`{"editor": {"line_wrap": "yes", "code_block_wrap": true}}`）走整文件回落
      （`wrong_type_line_wrap_falls_back_entire_file`）——断言 `line_wrap`、`code_block_wrap`、`mode`
      与同文件里的合法字段**一起**回到默认、warning 恰一条，不存在「部分按配置部分按默认」的混合态
      （design §2.1、§4-4）
- [x] 1.6 跑 `cargo test`（在 `src-tauri` 下）让 ts-rs 重新导出 `src/bindings/EditorConfig.ts`，
      生成物已一并纳入本次改动；`scripts/gate.sh` 的 bindings 漂移门禁绿

## 2. 前端：折行状态、会话与命令（`src/editor.ts`、`src/main.ts`、`src/keys.ts`、`src/preview/theme.ts`）

- [x] 2.1 `src/preview/theme.ts`：新增 `wrapCompartment` 的判定基础——`CODEBLOCK_NOWRAP_CLASS` /
      `CODEBLOCK_WRAP_CLASS` 两个内容级 class、`WrapSettings` / `WrapSpec` 两个类型、
      `DEFAULT_LINE_WRAP = true` / `DEFAULT_CODE_BLOCK_WRAP = false` 出厂默认，以及**唯一判定点**
      `wrapSpec(mode, lineWrap, codeBlockWrap)`（判定与装配分开，四组合因此不需要 DOM 就能单测）
- [x] 2.2 `src/editor.ts`：新增 `wrapCompartment = new Compartment()`（与 `modeCompartment` 并列）与
      `wrapExtensions(mode, settings)`（模块级、折行扩展的唯一装配点，含代码块横滚容器的装卸）；
      `sessionState(...)` 增加折行参数，替换掉写死的 `EditorView.lineWrapping`（原 `:1227`）
- [x] 2.3 **应用运行期真源**（D1）：`createEditor` 闭包内一份 `wrap`，全部会话由
      `reconfigureWrap()` 同步重配（前台 dispatch、后台只换代 state）；`setMode` 与 `setWrap` 共用
      `modeAndWrapEffects(mode, path)`——模式变了折行也要跟着重配（代码块内容级 class 的有无取决于
      mode）。MUST NOT 在 `livePreview()` 内部读折行状态（design §2.2）
- [x] 2.4 `src/keys.ts`：新增 `KEYLESS_COMMAND_IDS`（默认不绑键清单，声明为 `readonly string[]` 使
      「无幻影 id」的对账在运行期真的有区分度）并导出；两条折行命令 id
      `view.toggle-line-wrap` / `view.toggle-code-block-wrap` 进 `NON_TAB_GLOBAL_COMMAND_IDS`；
      表内 MUST NOT 为它们加任何默认绑定（单测与 m131 场景各守一遍）
- [x] 2.5 `src/main.ts` 的 `commands` 记录加两条实现：`editor.toggleLineWrap()` /
      `editor.toggleCodeBlockWrap()`；注释写明默认不绑键、作用域 global、`[keys]` 可绑。
      **注：`src/main.ts` 不在本 mission 的 scope 清单里，但任务清单要求改它、且不补实现就是
      `Record<CommandId, CommandRunner>` 的缺项（`tsc-root` 必红）——已两次报 tower 请求放宽 scope**
- [x] 2.6 `src/main.ts` 的配置消费点（`configGet().then`）：`editor.setWrap({ lineWrap, codeBlockWrap })`
      紧随 `setMode` 之后（同一条 `modeAndWrapEffects` 路径）。同上，scope 待 tower 确认
- [x] 2.7 TS 侧出厂默认（`DEFAULT_LINE_WRAP` / `DEFAULT_CODE_BLOCK_WRAP`，在 `src/preview/theme.ts`）
      与 Rust `Default` 互指注释 + 各自单测钉住（REVIEW.md 第 8 条；design §2.7）：
      `tests/unit/wrap.test.ts` 与 Rust 的 `missing_editor_wrap_fields_take_defaults` 逐值对账

## 3. 渲染：文件级与代码块级

- [x] 3.0 **先验两条 CM 契约**（design §4-0）：① 折行的 `white-space` 落在
      `.cm-content.cm-lineWrapping` 上、`.cm-line` 自身没有；② `EditorView.blockWrappers` 可并存
      多个 facet 值。**两条都成立，退路未使用**；验证方式与出处（本地 `node_modules` 的
      `@codemirror/view@6.43.11` dist 行号）写进 design §4-0
- [x] 3.1 文件级：`line_wrap = false` 时不装 `lineWrapping`，超长行由 `.cm-scroller` 横向到达；
      视觉层断言「正文行恰好一行 + 编辑区出现横向溢出且能滚到最右」（不是裁切）
- [x] 3.2 代码块级：`code_block_wrap = false` 时给 `.cm-content` 加内容级 class，CSS 把
      `.cm-line.cm-lp-codeblock-line` 的 `white-space` 压回 `pre`、`overflow-wrap` / `word-break`
      回 `normal`；反向（`line_wrap = false` + `code_block_wrap = true`）用另一个 class 折回来
      （`src/preview/theme.ts`，选择器带 `.cm-content` 前缀压过基础主题的 `.cm-lineWrapping`）
- [x] 3.3 `src/preview/livePreview.ts`：新增 `codeBlockWrappers(view)`（与 `tableWrappers` 同形，
      视口有界、MUST NOT 全文档扫描），为围栏 / 缩进代码块生成横滚容器；容器带 `tabindex=0` /
      `role=region` / 读屏名（`Markdown 代码块 N`）。**挂载由 `wrapExtensions` 决定**：只在
      md + 代码块不折行时装（折行打开时不得出现容器——spec 的「代码块折行可显式打开」）
- [x] 3.4 容器 MUST NOT 照抄 `padding-block: 12px`（`src/style.css:273-289`）：共用规则
      `.cm-lp-block-scroll` 只给横滚机制，表格的 `padding-block` 与 `scrollbar-gutter` 留在表格自己
      那条规则里；代码块容器自带 `--bg-2` 底板（design §2.3-3、§2.3-7）。实测：既有基线零变更
      （`getBoundingClientRect().top` 装卸前后差 ≤ 0.5px 有断言）
- [x] 3.5 `src/keys.ts`：新增泛化的「块级横滚容器」class（`BLOCK_SCROLL_CLASS`）作为单一来源，
      两类容器共用；表格容器**同时保留** `cm-lp-table-scroll`（`TABLE_SCROLL_CLASS`）——既有选择器
      与字面量断言按它定位；`isWidgetKeyTarget` 改查泛化后的 class，`livePreview` 的
      `widgetCommands` / `focusin` / `wheel` 三处同改
- [x] 3.6 命中条件的语义收紧为「容器自身持有这次按键的焦点」：
      `closest(BLOCK_SCROLL_CLASS) && ownerDocument.activeElement === 容器`；表格既有场景
      （`tests/visual/scenes/m131-keymap-behavior.spec.ts`）在同批回归里通过；新增一条视觉断言
      「光标落在代码块文本里时方向键仍归 caret」+ 单测 `FakeElement(true, false)` 一格
- [x] 3.7 嵌套语境实测（引用块内的围栏代码块）：**能承载局部容器**，写进视觉场景
      （`render-codeblock.spec.ts` 的「嵌套语境」），并断言溢出没有退化成整窗横滚
      （编辑区 `scrollWidth === clientWidth`）——不是「已知边界」

## 4. 键位面板与文案

- [x] 4.1 `src/bindings-panel.ts` 的未绑定行说明按成因分开（`unboundNotice`）：
      「默认不占键位（有意如此）——可在 `[keys]` 里绑定」/「已被配置解绑——可在 `[keys]` 里重新绑定」
- [x] 4.2 `文案-Copy.md` D66 同步修订（编号沿用、附修订记录，先例见 D86 于 M160 的扩写）
- [x] 4.3 两条命令落进既有「全局」组、未新增分组（`NON_TAB_GLOBAL_COMMAND_IDS`）；同时扫掉
      `tests/visual/scenes/m133-describe-bindings.spec.ts` 行内注释仍写「8 组」的残留（`GROUPS` 实为
      9 组——M179 r3 评审已坐实，本 change 顺带校正，REVIEW.md 第 8 条）
- [x] 4.4 本 change 无 toast / 无常驻指示 → 不新增文案条目（面板那条是 D66 的扩写，不是新条目）

## 5. 单测

- [x] 5.1 `tests/unit/keys.test.ts`：三项对账断言——每条命令有绑定或在 `KEYLESS_COMMAND_IDS` 里；
      清单无幻影 id；清单与 `KEY_BINDINGS` 无交集（design §2.6）。反向验证：临时往清单里加一个
      幻影 id 跑红、再删掉跑绿（红输出留档）
- [x] 5.2 `tests/unit/keys.test.ts`：两条新命令的作用域派生结果是 `global`、不在 `KEY_BINDINGS` 里、
      且 `[keys]` 覆盖能把它们绑上（含「绑定后作用域仍由清单派生」）
- [x] 5.3 **应用级状态**的断言面（D1 改口径后本条重写）：原任务「折行状态随会话独立 / `defaultWrap`
      不因 toggle 移动」描述的是标签页级，已作废。新的验收面是「翻转作用于全部会话 + 新标签页取当前
      应用态 + 切标签不改变口径」，落在视觉层
      （`render-codeblock.spec.ts` 的「应用级口径（D1）」场景：两个标签、翻转、看新标签、切回旧标签）
- [x] 5.4 `tests/unit/wrap.test.ts`（新文件）：`wrapSpec` 的四组合逐格断言 + 两轴独立性（把另一个轴
      翻转、本轴结论不变）+ code 模式下不装代码块 class（不产生无消费者的声明）
- [x] 5.5 1.4 / 1.5 / 2.7 的 Rust 与 TS 默认值单测（两侧同批）；另加视觉层的「启动口径来自配置」
      场景，覆盖 `config.json` → `main.ts` 的 `setWrap` 这条接线（TS 单测层起不来真 EditorView，
      见 `tests/unit/harness.ts` 的口径）

## 6. 视觉门禁

- [x] 6.1 新增 fixture `tests/visual/fixtures/render-codeblock/wrap.md`（含超长代码行、超长正文行、
      一处引用块内的围栏代码块；既有 `languages.md` 最长行 45 字符，暴露不了默认变更，design §4-5）
- [x] 6.2 `render-codeblock.spec.ts` 增场景：默认口径下代码行不折行（`getComputedStyle` 的
      `white-space` 为 `pre`、`overflow-wrap` 为 `normal`、行盒只占一行）、块内可滚
      （`scrollWidth > clientWidth`）、容器存在且 `role=region` / `tabindex=0` / 有读屏名
- [x] 6.3 增场景：容器键盘可达（`focus()` 聚焦 → `→` 滚 120px → `End` 最右 → `Home` 最左 → `Escape`
      交还焦点；全程文档逐字节不变），与表格容器同行为
- [x] 6.4 增场景：横滚到右端不露白底（容器右缘那一列的 `elementFromPoint` 底色 = 代码行底色 =
      `--bg-2`）；容器装卸不改变下方内容的纵向位置（`top` 差 ≤ 0.5px）
- [x] 6.5 增场景：四种组合各一条断言 + 各一张整页基线（`wrap-combo-{1..4}-*.png`），并断言
      代码块折行打开时容器个数为 0
- [x] 6.6 `tests/visual/scenes/m131-keymap-table.spec.ts` 的两处循环改为三项对账（按
      `KEYLESS_COMMAND_IDS`）
- [x] 6.7 `tests/visual/scenes/m133-describe-bindings.spec.ts`：行数改为
      `KEY_BINDINGS.length + KEYLESS_COMMAND_IDS.length`、未绑定行数改为清单长度、加「默认不占键位」
      / 「已被配置解绑」两条未绑定说明断言
- [x] 6.8 逐张核对出现过代码块的整页基线时间戳：`render-codeblock.spec.ts-snapshots/` 的 5 张既有
      基线与 m133 的面板基线**时间戳未变、像素零差异**（新增的横滚容器没有改动它们）；新增基线
      只有 5 张、全部来自本 change 的新场景，**待 Alex 过目**（已报 tower）
- [x] 6.9 门禁：`LUMIR_VISUAL_PORT=4273 scripts/gate.sh visual` 全绿，输出留档（`test-results/m180/`）

## 7. 真机验收（agent 执行，不进 CI）

- [x] 7.1 `scripts/acceptance/lib/app.mjs` 的 `writeConfig` 支持两个新可选字段
      （`lineWrap` / `codeBlockWrap`，不传即不写 → 走 Rust `Default`）
- [x] 7.2 新增场景 `21-wrap-default.md`（编号续现有序列）：探针文档由 `vaultWrite` 现造（含超长代码行
      与超长正文行），默认口径下断言代码块横滚容器在 AX 树里；Tab → → / End / Home 的滚动序列留截图
- [x] 7.3 新增场景 `22-wrap-toggle.md`：`[keys]` 绑 `Cmd-Shift-J` / `Cmd-Shift-K` 后翻转，
      断言容器在 AX 树里消失/回来、`Escape` 后焦点回 `AXTextArea`，且 `config.json` 的 **sha256
      与翻转前一致 + 没有多出 `line_wrap` / `code_block_wrap` 回写字段**（design §2.7）。
      **mtime 层未验**（harness 的断言词汇里没有「mtime 未变」形态，只有 `mtimeNewerThan`）——见
      9.4。**采样纪律**：基线记在 vault 已装载、文件已打开之后，两次采样之间不触发 vault 打开 /
      重映射（`vault_remap` 与 `write_last_vault_to` 都会写 config.json）——按 M166 评审备录写进场景说明
- [x] 7.4 真机断言不依赖重试次数（本场景的按键是 chord，套件按既有口径盲发；断言取「AX 树里的节点
      在/不在」「焦点归属」「配置内容不变」三态，不是「按了几次」）；起实例前确认 1430 空闲、1420
      全程未碰。**实测补记**：键盘路径要先把焦点交给编辑器（`clickEditor`）再 `Tab`——`open` 之后焦点
      在左栏文件行按钮上，直接 `Tab` 走不到容器（首轮实测现场已留在 `shots/` 与 steps.md）
- [x] 7.5 起实例前 `df -h` 看水位；用 `pnpm tauri dev`（不是裸二进制），规避白屏陷阱
- [x] 7.6 证据落在 `test-results/acceptance/`（git 外），报告里的每个路径先用绝对路径 `ls` 一遍

## 8. 收口

- [x] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 8.2 `scripts/gate.sh`（quick）全绿：fmt + clippy + cargo test + bindings 漂移 + tsc + docs-check
      + 单测 + openspec validate
- [x] 8.3 文档同步：`文案-Copy.md`（4.2）；`scripts/acceptance/README.md` 未动（新场景不改变
      用法与格式）；`docs/backlog.md` 未动（不在本 mission 的 scope）——实施中冒出的 finding
      （acceptance 套件的配置通道表达不了 `[editor]` 的新配置项）已按协议走 TowerFinding
- [x] 8.4 归档对账（`docs/process/openspec-workflow.md` 的批次收尾 checklist）：本 change 合并时
      落一条待归档记录；归档前逐条对账 tasks / spec 增量 / 实现；本 change 不新建 capability
      （`editor-live-preview` 与 `keymap-commands` 都是既有 living spec），无 Purpose 需要补
- [x] 8.5 把「实现期必须验证」的结论回填 design §4：逐条标注实测结果（成立 / 走退路 / 转为已知
      边界），不留「待验」字样进归档

## 9. 待办 / 未验项（如实记录，MUST NOT 被读成已验）

- [ ] 9.1 `src/main.ts` 的 scope：本 mission 的 scope 清单不含它，但 tasks 2.5 / 2.6 要求改它，
      且不改就编译不过。已两次报 tower（`clarify-request` / `clarify-followup`）请求纳入 scope；
      **在 tower 答复前，`src/main.ts` 的两处改动属于「按任务清单执行、scope 待补」状态**
- [ ] 9.2 `scripts/acceptance/lib/execute.mjs` 的 scope：同上，本文件不在 scope 清单里，但 `record`
      动作不认 `env:` 前缀（基线记成 null），不修则 task 7.3 的 `config.json` 逐字节断言无从落地。
      改动是把路径解析统一到 `file` 断言同源的 `resolveSpecPath`（**1 行**），已在 review-request 里单列
- [ ] 9.3 新增的 5 张视觉基线待 Alex 过目（AGENTS.md 硬规则「基线更新是人肉裁决点」；本次是
      **新增**基线而非更新既有基线，既有基线逐张零变更已实测）
- [ ] 9.4 真机的 `mtime` 层不变性未验：`file.unchangedSince` 比的是 sha256（内容逐字节），断言词汇里
      没有「mtime 未变」这一形态。task 7.3 的口径因此收窄为「内容 sha256 不变 + 无回写字段」（见
      design §4 的「真机侧的覆盖边界」）
- [ ] 9.5 真机侧没有计算属性通道，「正文行折 / 不折」「代码块行折 / 不折」的视觉判断只能看 `shots/`；
      横滚幅度（120px / End / Home）的机器断言在视觉层。真机的键盘路径本身已验（`focused` 容器
      → 横滚 → `Escape` 交还焦点；起点要先 `clickEditor`，见 `21-wrap-default` 的说明）
- [ ] 9.6 两条 out-of-scope 的 harness 边界已按协议提交 finding（`lib/ax.mjs` 的 value 截断、
      `lib/execute.mjs` 的 `record` 前缀；后者本 change 顺手修了 1 行）；另有 acceptance 套件的
      `config` 通道表达不了 `[editor]` 新配置项（finding）

