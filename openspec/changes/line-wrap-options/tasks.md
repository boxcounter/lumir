# Tasks: line-wrap-options

> 本 change 停在【评审节点 1：提案评审】——proposal / design / tasks / spec 增量四件已产出，**尚未进入
> 实现**。节点 1 通过后按本清单逐项实现并勾选；发现 proposal 意图需要变更时先改 proposal 再动代码
> （`docs/process/openspec-workflow.md` 第 4 条），不静默扩 scope。
>
> 每条勾选须给**可复核的证据指针**（命令输出 / 场景名 / 文件:行 / 基线名 / 可 `ls` 的绝对路径）。
> 拿不出证据的一条写「未验」，不写「已验」（REVIEW.md 第 6 条）。
>
> 本 change 的实现只应改到：`src-tauri/src/config.rs`、`src/bindings/EditorConfig.ts`（ts-rs 产物）、
> `src/editor.ts`、`src/preview/`、`src/keys.ts`、`src/main.ts`、`src/style.css`、
> `tests/unit/`、`tests/visual/`（含基线与 fixture）、`scripts/acceptance/`、`文案-Copy.md`。
> 越过这个集合前先在 proposal 里写明理由。

## 1. 配置面（Rust）

- [ ] 1.1 `EditorConfig` 增 `line_wrap: bool` 与 `code_block_wrap: bool`；`Default` 给 `true` / `false`
      （新增字段与 `mode` 同表、同行风格；不给配置字段做 serde rename——JSON 键名即字段名的 snake_case）
      —— 证据：`src-tauri/src/config.rs` 的 `EditorConfig` 定义与 `impl Default`
- [ ] 1.2 `RawEditorConfig` 增 `line_wrap: Option<bool>` / `code_block_wrap: Option<bool>`，沿用
      `#[serde(default)]`；`validate()` 的 editor 分支按同一形状扩两行（缺失 → 该字段 `Default`）
      —— 证据：`config.rs` 的 `RawEditorConfig` 与 `validate()` editor 分支
- [ ] 1.3 单测：字段缺失回落出厂值（形如既有 `missing_log_table_defaults_to_info`）、显式 `false`/`true`
      被如实读入、两个字段互不影响
      —— 证据：`cargo test -p lumir config::` 的用例名与输出
- [ ] 1.4 **边界实测并钉住**：类型不符（`{"editor": {"line_wrap": "yes"}}`）的现行为——预期走**整文件回落**
      路径（全部默认 + warning，与 `editor.mode` 给错类型同路）。实测结论若与预期不同，以实测为准并写进
      spec 的已知边界，MUST NOT 顺手发明「逐字段类型容忍」
      —— 证据：一条覆盖该输入的单测 + 实测输出
- [ ] 1.5 重跑 ts-rs 导出并提交 `src/bindings/EditorConfig.ts` 的 diff；`scripts/gate.sh` 的 bindings 漂移
      检查必须绿（`git status --porcelain -- src/bindings/` 无输出）
      —— 证据：`src/bindings/EditorConfig.ts` 含两个新字段；gate 的 `bindings-drift` 行输出
- [ ] 1.6 与前端的两处默认值对账：Rust `Default` 与 TS 出厂常量同值（`line_wrap=true`、
      `code_block_wrap=false`），两侧常量处各写一行指针注释指向对方（沿用 `editor.mode` 的既有先例，
      并按 REVIEW.md 第 8 条留下防线）
      —— 证据：两侧常量 + 两侧各自的默认值测试

## 2. 前端折行落点（`src/editor.ts`）

- [ ] 2.1 `EditorSession` 增折行状态字段（与 `mode` 并列，逐会话持有——真源在会话上，不是内核单值）
      —— 证据：`src/editor.ts` 的 `EditorSession` 定义与字段注释
- [ ] 2.2 新增模块级 `wrapCompartment = new Compartment()`（与 `modeCompartment` 并列）；新增
      `wrapExtensions(mode, wrap)` 承载全部折行相关扩展（`line_wrap=false` 时不装
      `EditorView.lineWrapping`；md 模式且 `code_block_wrap=false` 时装代码块的内容级类与块 wrapper
      facet）
      —— 证据：`wrapExtensions` 定义 + 两个调用点
- [ ] 2.3 `sessionState(...)` 增折行参数（与 `mode` 同形），`makeSession` / `createSession` /
      装载路径都从**会话的**折行值计算扩展——MUST NOT 从内核单值读（那会在切标签页后错位，是
      `mode` 字段注释记下的同一陷阱）
      —— 证据：`sessionState` 签名与三处调用；`activate` 路径无新增同步动作（值随 state 走）
- [ ] 2.4 `setWrap(kind, value)` 只改前台会话的折行值 + 重配 `wrapCompartment`，**不写配置、不动内核的
      default 值**；`setWrapConfig(config)` 写内核 default（新标签页的起点）并把两个值应用到当前前台会话。
      `setMode` 模式切换时同步重配折行扩展（md 专属部分依赖模式），二者共用同一个 `reconfigureWrap()`
      —— 证据：三处代码 + 一条「切标签页后折行取值不错位」的单测/视觉断言
- [ ] 2.5 MUST NOT 在 `livePreview()` 内部旁路读折行状态（那会形成创建期闭包 + 第二处装配入口）
      —— 证据：`grep -n "wrap" src/preview/livePreview.ts` 无折行状态读取

## 3. 代码块「不折行」的渲染落点

- [ ] 3.1 行级 `white-space`：内容级类（经 `contentAttributes`）压回 `.cm-line.cm-lp-codeblock-line` 的
      `white-space: pre` + `overflow-wrap: normal`；规则只此一条，判定只看 `code_block_wrap`
      —— 证据：`wrapExtensions` 里的内容属性 + 样式规则
- [ ] 3.2 块级滚动容器：新增 `codeBlockWrappers(view)`（与 `tableWrappers` 同形），为每个围栏代码块返回
      `overflow-x: auto` 的 `BlockWrapper`；块发现 SHALL 视口有界（沿用 `tableDiscoveryRange` 的做法），
      MUST NOT 全文档扫描
      —— 证据：`codeBlockWrappers` 定义 + 样式类 + 一条「块内滚动、整窗不滚动」的视觉断言
- [ ] 3.3 MUST NOT 给代码块的折行容器加块级内边距或外边距（CM 按 border-box 量行高，外边距不可见会造成
      落点漂移；表格容器的 `padding-block: 12px` 是表格的观感选择，不适用于代码块）
      —— 证据：样式规则里无 `padding-block` / `margin`
- [ ] 3.4 内容不可丢：围栏行与源码仍是文档真文本（可选中、md 模式下可编辑），MUST NOT 换成只读副本
      —— 证据：视觉断言里代码块行文本与文档文本一致 + 可编辑性未放宽
- [ ] 3.5 横向滚动条出现时的水平位移处置（候选：表格同款 `scrollbar-gutter: stable`）：切换前后除折行
      本身外行盒不变
      —— 证据：视觉断言的读数（切换前后的行盒 / 代码块左缘）

## 4. 命令与键位层

- [ ] 4.1 `src/keys.ts`：两条命令 id `view.toggle-line-wrap` / `view.toggle-code-block-wrap` 进
      `NON_TAB_GLOBAL_COMMAND_IDS`（作用域由清单机械派生为 `global`）
      —— 证据：`keys.ts` 的清单与 `applyKeyOverrides` 的派生结果（面板里两条落在「全局」组）
- [ ] 4.2 `src/keys.ts`：新增导出 `KEYLESS_COMMAND_IDS`（本轮含两条折行命令）与一段说明「默认不绑键是
      显式决定，不是遗漏」的注释；两条命令 MUST NOT 进 `KEY_BINDINGS`
      —— 证据：`KEYLESS_COMMAND_IDS` 定义 + `KEY_BINDINGS` 无这两条
- [ ] 4.3 `src/main.ts`：两条命令的实现进 `commands` 记录（全量 `Record<CommandId, CommandRunner>`，
      缺实现即 tsc 错），实现内只调用 `editor` 暴露的 `setWrap(...)`——MUST NOT 与「配置启动应用」各写
      一套逻辑
      —— 证据：`main.ts` 的 commands 记录 + 两条实现体
- [ ] 4.4 单测（键位层）：默认不绑键的三项对账——`COMMAND_IDS` 每条「有绑定 ∪ 在清单里」；清单 ⊆
      `COMMAND_IDS`；清单 ∩ 绑定表 = ∅；并**反向验证**：临时把一条命令同时放进清单与绑定表、或从清单
      删掉一条却不加绑定，对账必须 FAIL（确认断言有区分度，REVIEW.md 第 1 条）
      —— 证据：`tests/unit/keys.test.ts` 用例名 + 反向验证的实测输出
- [ ] 4.5 `tests/visual/scenes/m131-keymap-table.spec.ts`：把两处「无孤儿命令」循环改为与
      `KEYLESS_COMMAND_IDS` 的对账（判据严格化，不是删除检查），并补一条「清单与绑定表无交集」的断言
      —— 证据：该场景的用例名 + 反向验证（故意破坏对账时 FAIL）
- [ ] 4.6 单测/视觉：`[keys]` 把某个空位 token（如 `Ctrl-j`）绑到 `view.toggle-line-wrap` 后，键位层
      接受该覆盖（不产生「未知命令」warning），且绑定表里出现这条新绑定
      —— 证据：用例名与输出

## 5. 面板与文案

- [ ] 5.1 面板分组不改：两条命令经 `NON_TAB_GLOBAL_COMMAND_IDS` 落进既有「全局」组，MUST NOT 新增分组
      （分组标题是文案交付物）
      —— 证据：`src/bindings-panel.ts` 的 `BINDING_GROUPS` 未改动 + 面板渲染里两条命令在「全局」组
- [ ] 5.2 `tests/visual/scenes/m133-describe-bindings.spec.ts`：行数与未绑定行数的断言按新事实改（默认
      状态下应出现 2 条「未绑定」行）；分组标题数组**不变**；元素级基线
      `describe-bindings-panel.png` 重拍（新增两行）
      —— 证据：场景全绿 + 基线 diff 说明（并附前后截图供 Alex 过目）
- [ ] 5.3 `文案-Copy.md`：翻转反馈的新条目（写明哪一项折行、变成什么状态）与实现备注段的出处；若最终
      决定不要反馈（proposal 的裁决点 D4），本项改为「不新增文案」并在 tasks 里如实记录该决定
      —— 证据：`文案-Copy.md` 的 D 编号条目 + 实现侧文案常量
- [ ] 5.4 反馈落地：翻转命令接既有瞬时提示（`src/main.ts` 的 `toast`），文案取自 5.3
      —— 证据：翻转命令实现里的 toast 调用 + 视觉/真机断言能看到该提示

## 6. 测试与验收

- [ ] 6.1 单元：折行状态与命令行为的纯逻辑测试（`setWrap` 改前台会话而不动 default；新会话从 default
      开始；`wrapExtensions` 在四种取值组合下装/不装哪些扩展）
      —— 证据：`node tests/unit/run.mjs` 的用例名与计数
- [ ] 6.2 视觉 fixture：新增一份**含超过栏宽的代码行**与超长正文行的 fixture（现成的
      `tests/visual/fixtures/render-codeblock/languages.md` 最长行 45 字符，拿它断言截断是恒真断言——
      REVIEW.md 第 1 条）
      —— 证据：新 fixture 文件的绝对路径 + 其中最长行的字符数
- [ ] 6.3 视觉场景（新增，建议 `tests/visual/scenes/m166-line-wrap.spec.ts`）：出厂口径下「代码块不折行
      + 块内可横滚 + 整窗不横滚」；`code_block_wrap=true` 时恢复折行；`line_wrap=false` 时正文截断；
      翻转命令生效且只影响当前标签页；`EditorState.doc` 与磁盘逐字节不变
      —— 证据：场景名 + 逐条断言 + PASS 计数
- [ ] 6.4 视觉基线：代码块相关的元素级基线重拍或新增；**逐张核对**出现过代码块/长行的整页基线，确认
      是否有真实变化被 0.001 容差吞掉（REVIEW.md 第 3 条：先把元素删掉/改掉跑一次确认门禁真的会 FAIL，
      再决定是否更新基线）
      —— 证据：`git status --porcelain tests/visual/baselines/` 的清单 + 每张的处置结论（改了/零变化 +
      零变化的核对方式）
- [ ] 6.5 基线更新前截图须 Alex 过目（`tests/visual/README.md` 的基线更新纪律：基线更新是人肉裁决点）
      —— 证据：前后截图的可 `ls` 绝对路径
- [ ] 6.6 真机验收：新增场景（建议 `scripts/acceptance/scenarios/20-line-wrap.md`），覆盖①出厂口径下
      代码块横滚可见、②`editor.code_block_wrap=true` 恢复折行、③经 `[keys]` 绑定后按该键真的翻转并回读
      到状态变化。键盘注入类断言走「回读 + 只在字节未变时重试」，MUST NOT 用重试次数当判据
      （REVIEW.md 第 11 条、acceptance README 的历史教训）
      —— 证据：`node scripts/acceptance/run.mjs --check` 的 CHECK PASS 行 + 真机 run 的 `test-results/`
      绝对路径（跑不动就写「未验」）
- [ ] 6.7 验收 harness 支持新字段：`scripts/acceptance/lib/app.mjs` 的 `writeConfig` 目前只写
      `editor: { mode }` 与可选 `keys`，需扩出两个折行字段（或让场景能整表覆写 `editor`），否则 6.6 的
      ②无法配出来
      —— 证据：`writeConfig` 的签名与场景 front-matter 的用法
- [ ] 6.8 嵌套语境实测：引用块 / 列表项内的围栏代码块，块 wrapper 的范围与滚动是否正确。承载不了的
      形态如实写进 spec 的已知边界，**不许静默退化成「折行」或「整窗横滚」**
      —— 证据：视觉或真机的实测结论（含失败形态的记录）
- [ ] 6.9 性能：确认代码块的块发现是视口有界（打开 1MB 文档的耗时与 base 对比不劣化；`scripts/perf` 的
      现成端点跑一遍）
      —— 证据：perf 输出与 base 的对比数字

## 7. 文档与 spec 同步

- [ ] 7.1 归档前把 delta 与实现对齐；实现期若出现 proposal 未写的形态（例如某嵌套语境无法承载局部
      容器），先更新 proposal/design 再落地
      —— 证据：proposal/design 的修订记录
- [ ] 7.2 `keymap-commands` 的 delta 里对「键位查看面板」的分组枚举做了顺带对齐（补 `标签`）：
      该 living spec 原文列了 8 个分组、实现与视觉场景是 9 个（`src/bindings-panel.ts:31-45`、
      `tests/visual/scenes/m133-describe-bindings.spec.ts:15`）。这次是**原样重述该 requirement**，
      不修就把一句假话继续带下去——如实记录这次对齐，不是静默扩 scope
      —— 证据：delta 里的枚举 + 对照锚点
- [ ] 7.3 实现 PR 合并时在 `docs/backlog.md` 的「待 Alex 裁决」节落一条**待归档记录**，批次收尾跟踪到
      归档（`openspec-workflow.md` 的批次收尾 checklist 第一条）
      —— 证据：`docs/backlog.md` 的条目

## 8. 验证

- [ ] 8.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
      —— 证据：命令输出
- [ ] 8.2 `scripts/gate.sh quick` 全绿（含 `cargo test`、bindings 漂移、`tsc`、openspec validate）
      —— 证据：`GATE PASS` 逐行输出与 `GATE RESULT`
- [ ] 8.3 `scripts/gate.sh visual` 全绿（含 6.3 的新场景与 6.4 的基线处置）
      —— 证据：`LUMIR_VISUAL_PORT` 隔离端口下的 PASS 计数
- [ ] 8.4 真机：`node scripts/acceptance/run.mjs 20` 单场景 PASS
      —— 证据：证据目录的绝对路径（跑不动写「未验」并说明原因）
- [ ] 8.5 `git diff --check` 通过；改动文件集合与 proposal 的 Impact 节一致，越界项已在 tower 批准后补记
      —— 证据：`git diff --check` 无输出 + 改动文件清单

## 9. 已知边界 / 不做

- [ ] 9.1 不做 per-file 持久化：翻转不写 `config.json`、不记 per-file 状态
      —— 证据：无新增配置写入路径；翻转前后 `config.json` 内容与 mtime 不变
- [ ] 9.2 不做菜单入口、不做 `M-x` / 命令面板（理由见 proposal 的 Non-goals 与裁决点 D2）
      —— 证据：`src-tauri/src/lib.rs` 与前端零相关改动
- [ ] 9.3 不改表格 / 公式 / mermaid 的横向滚动容器现状（代码块只复用块 wrapper 机制）
      —— 证据：`tableWrappers` 与相关样式规则的 diff 为零
- [ ] 9.4 不引入配置热重载（proposal 的裁决点 D3）：配置仍在启动读一次
      —— 证据：无 watcher、无 reload 命令
- [ ] 9.5 未配置 `[keys]` 时两条命令无可触发路径——已知边界，写进 `keymap-commands` 的 delta
      —— 证据：delta 里「已知边界」那段
