# Proposal: 行号全局开关——md / code 不再区分，⌘⇧N 与 modeline 钮运行期切换并持久化

- Change ID: `global-line-numbers-toggle-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**——Alex 2026-11-23 对 UX 改进第 4 项（「行号不再区分 md / 代码，
> 快捷键 + status line 开关」）明确裁决「按推荐」，逐条批准下列七项取舍：
> ① 默认 `off`；② md 与代码不再区分，合并为一个全局开关；③ 快捷键 `⌘⇧N` 与 modeline 右段按钮
> 两个入口、全局作用域、切换即持久化；④ `⌥G` 跳转输入条仍临时带出行号 gutter；⑤ 只统一开关、
> **不**统一两种模式 gutter 的外观；⑥ 配置键 `[ui] line_numbers = "on" | "off"` 字符串枚举，
> `<html data-line-numbers>` 为唯一运行期真源；⑦ 旧键 `markdown_line_numbers` 硬切断 + 启动
> warning（仅非 `null` 值；显式 `null` 与缺席同义），不迁移、不双读。节点 2 记录按五要件在
> 归档阶段填写。
>
> 独立评审 r1（2026-11-23）：**needs-changes**，6 项阻塞；已按 verdict 逐项修正——① spec 的
> modeline 旧句 / 旧 requirement 名 / 绝对几何句；② 改名通道的 `carryover.md`（13 个正文段落 +
> 20 个场景，11 + 9）与「门禁只查结构」的口径；③ D972 短标签与三来源 `docKey` 分键；④ 基线面补
> `modeline.spec` / `modeline-bar.png` / `titlebar-identity` / 全部含 modeline 的整页；⑤ setter
> 赋值顺序与两个交叉态、搜索框 / composer 快捷键测试；⑥ 旧键显式 `null` 与缺席同义。复跑
> `validate --all --strict` 与 `docs-check` 全绿（读数见 `tasks.md` 1.2 / 1.3）。
>
> 独立评审 r2（2026-11-23）：**needs-changes**，2 项制品准确性——旧键 `null` 口径在 proposal /
> spec 承接场景 / design 测试矩阵与风险节仍未扫净；`carryover.md` 有场景计数与承接描述三处误述。
> 已统一全仓为「非 `null` 值才告警，显式 `null` 与缺席同义」并补 design 的 null 用例；`design.md`
> 测试矩阵补两个交叉态、搜索框 / composer 快捷键与真机交叉态；carryover 改为 12 个新增场景、
> B-P4 补「gutter 档位 → 行号开关」、A.2 标明 rect 断言移至新 P3 与 tasks 4.7 / 6.2。复跑
> `validate --all --strict` 与 `docs-check` 全绿。
>
> 节点 2（归档放行）：最终 tip `08c90d17`。独立评审 r3 **clean / merge**，carryover
> A.1 / A.2 / B.1 / B.2 全通过；真机 56 / 707 / 722 **3/3 PASS**；quick
> `GATE RESULT: 13/13 PASS（SKIP 0）`；批准基线后完整视觉 `GATE RESULT: 15/15 PASS（SKIP 0）`
> （1302 passed / 1 skipped）。Alex 批准 modeline 候选，仅重截一张基线且与候选 SHA-256 一致。
> archive-check 与五要件在合并前复核，无证据缺口。实现与节点 2 材料已合并推送至 master
> （`4f4f1af3`）；本次提交执行归档，living specs 已由归档包装器并入。

## Why

现状（change `goto-line-command`，M281 的 D4 二次改判，2026-09-28）把行号拆成两套口径：

- **md**：`[ui] markdown_line_numbers` 三档 `on-demand`（默认）/ `always` / `off`，装载时读一次；
  运行期明文 **MUST NOT** 提供切换命令 / 键位 / UI（`openspec/specs/keymap-commands/spec.md`
  的「跳转到指定行命令」条——本 change 归档后更名为「跳转到指定行与行号可见面」，以及同条
  「已知边界」⑥）。
- **code**：gutter 恒常显，**MUST NOT** 进这个配置。

这套口径有三个问题：

1. 同一窗口里 md 与 code 是两套行号语义，用户要先记住「我在哪种文件里」才知道有没有行号；
2. 默认档 `on-demand` 只对 md 有意义，code 用户没有「关掉行号」的运行期入口（改配置也对 code 无效）；
3. 三档里真正被日常使用的是「跳转时临时看一眼」，其余两档在运行期无法切换——需求要的是开关，
   配置面却给的是一个重启才生效的启动期档位。

Alex 2026-11-23 的裁决把它收敛为一个**全局二元开关**：默认 `off`；md 与 code 不再区分；`⌘⇧N`
与 modeline 钮两个入口走同一条实现；切换即持久化；`⌥G` 仍临时带出 gutter；只统一开关、不统一
外观。这是对 2026-09-28「md 可配置三档、code 恒常显」的一次明确改裁，本 proposal 把两次决策
都记在这里，避免后续 agent 把旧口径当现状翻回去。

## What Changes

逐条对应 `specs/` 增量（括号里是落点 requirement）：

1. **配置键换轨**（`keymap-commands` 的「行号开关命令」条）：`[ui] line_numbers` SHALL 取
   `"on"` / `"off"`（默认 `"off"`）字符串枚举，取值由 Rust 侧闭集合校验；非法值回落 `"off"`
   并产生一条人话 warning。旧键 `[ui] markdown_line_numbers` **硬切断**：不再被读取为生效值、
   不迁移、不双读；携带**非 `null` 值**时只发一条启动 warning 说明该键已退场（取值一律忽略）；
   显式 `"markdown_line_numbers": null` 与键缺席同义，MUST NOT 告警。
2. **运行期真源单一**（同上条）：`<html data-line-numbers="on|off">` 是运行期唯一生效面，唯一
   写入者是 `applyLineNumbers`；命令与 modeline 钮都从它读当前值，不另存第三份状态。启动施加
   与运行期切换共用这一个施加点（照 `applyTheme` / `data-theme` 的既有架构）。
3. **命令与键位**（同上条）：新增全局命令 `view.toggle-line-numbers`，进
   `NON_TAB_GLOBAL_COMMAND_IDS`（作用域机械派生为 `global`），不取 `editor.` 前缀、不进
   `KEYLESS_COMMAND_IDS`；默认键位 `⌘⇧N`（token `Cmd-Shift-N`），键位占用按三条独立来源核实并
   写进绑定对象的 `doc`（macOS 系统级本轮未复核，实现前补测；若被占用则停手上报，不自行改键）；
   `COMMAND_META` 增加标签与别名。键位面板「全局」组自动收纳它。
4. **持久化与失败降级**（同上条）：切换即经 `config_set_ui_value("line_numbers", …)` 回写
   `config.json`；写失败只 toast + 诊断日志，运行期**不回滚**，重启回到配置文件值（与主题 /
   语言同一条降级口径）。开关是全局持久偏好，**不按 pane**。
5. **gutter 在场合同**（`keymap-commands` 的「跳转到指定行与行号可见面」条，整条重写：REMOVED +
   新名 ADDED，改名通道见该 delta 的头部说明）：md 与只读 code
   共用同一个开关；`"off"` 时两种模式都没有 gutter，但 `⌥G` 打开跳转输入条期间 SHALL 临时显示
   gutter（md 与 code 一致），收起即卸除；`"on"` 时常驻，输入条开 / 关不改变在场。md 任意宽度
   与 code 宽窗下开关前后正文列 rect 逐值不变；code 窄窗允许正文列左移一个 gutter 宽，但不得
   横向滚动或裁切行号（见 design §4.2 / §10.1）。
6. **modeline 指示钮**（`ui-design-system` 的「行号指示钮」条 ADDED）：右段新增
   `.modeline-line-numbers`，可见文本 `on` / `off`（读数，不译文），悬停提示与读屏名走文案表；
   点击与命令同一条实现；初始 hidden，施加后才显示；eink 走 chip 描边规则；窄窗不溢出、不吃掉
   主题 / 语言钮。
7. **右键复制的口径同步**（`keymap-commands` 的「行号 gutter 的右键复制（`{path}:{line}`，随行号
   开关在场）」条，整条重写：REMOVED + 新名 ADDED，同上）：把该条
   对 `markdown_line_numbers` 三档与 code 恒常显的引用改成 `line_numbers` 两档 + 跳转临时 gutter，
   手势本身零变化（`"off"` 且输入条未打开时没有 gutter，也就没有本手势）。

## Non-goals

- **不统一两种 gutter 的外观**：md 的透明底 / 无右缘 / 与正文同行，code 的 `--frame` 底 + 1px
  右缘 / 贴面板左缘，全部逐字节保留。要「看起来也一样」是另一次视觉改裁。
- **不做 per-pane 开关**：本仓没有 per-pane 配置基础设施，主题 / 语言 / 侧栏都是全局；per-pane
  会让同一窗口出现两套行号口径，违背「单一真源」。
- **不保留第三档**：`auto` / `on-demand` / 按文件类型自动显示都不做——裁决要的是二元开关。
- **不迁移旧键、不留别名、不双读**：`markdown_line_numbers` 携带非 `null` 值时只换一条 warning；
  显式 `null` 与缺席同义、不告警。
- **不改 `editor.goto-line` 的落点 / 钳制 / 取消语义**：行号口径、输入条行为、`revealLine` 复用
  全部不动；本 change 只改 gutter 的在场条件。
- **不改 modeline 右段的「语法 · 行数 · 编码」读数与版本号窄窗退让阈值**。
- **不新增设置面板项**：`config.json` 仍是唯一配置面（与 `ui.theme` / `ui.language` 同口径）。
- **不动 code 模式的只读合同**、不动 gutter 右键复制的剪贴板 / 反馈 / 零副作用口径。

## Impact

- 影响的 specs：`keymap-commands`（2 条 REMOVED + 3 条 ADDED——两条旧 requirement 因场景标题随
  语义改裁失效，走「REMOVED + 新名 ADDED」的改名通道，见 delta 头部；另 1 条纯 ADDED）、
  `ui-design-system`（1 条 ADDED）。
- 改名通道的承接核对：`carryover.md` 逐项列出两条旧块的 13 个正文段落与 20 个场景（11 + 9）
  到新块的映射。机器门禁在这条通道只查结构（REMOVED 旧条存在、ADDED 不与 living 同名），
  **不比较旧块与新块的正文 / 场景**，因此 PASS 不能替代人工核对——reviewer 出 verdict 前
  MUST 按该清单逐项签字（`tasks.md` 的 10.2 / 10.3）。
- 影响的代码/系统：
  - Rust：`src-tauri/src/config.rs`（`UiConfig` / 新枚举 / `RawUiConfig` / `validate` / 单测）；
    `src/bindings/**` 的 ts-rs 重导出（`UiConfig.ts` 更新、`LineNumbers.ts` 新增、
    `MarkdownLineNumbers.ts` 删除）。
  - 前端：新增 `src/line-numbers.ts`（纯逻辑）；`src/editor.ts`（compartment 与在场判据）、
    `src/main.ts`（施加 / 切换 / 启动 / 新 pane / 重绘）、`src/shell.ts`、`src/style.css`、
    `src/keys.ts`、`src/command-meta.ts`、`src/copy-data.ts` + `文案-Copy.md`。
  - 测试与验收：`tests/unit/**`、`tests/visual/scenes/**`（m281 重写、gutter-copy 桩改名、
    新增开关 / 指示钮 / 三主题 / 双 pane / 重启）、`scripts/acceptance/lib/**`、场景 56 / 707
    + 新增一条开关场景、`COVERAGE.md`。
- 关联约束：
  - ADR 0002 §5（配置即数据 + schema 校验）：取值合法性只在 Rust 侧判一次，前端不复制闭集合。
  - ADR 0003 §3（不改写源文件）：本 change 的所有路径 MUST NOT 触碰文档字节、dirty、撤销栈。
  - AGENTS.md 硬规则「变更默认直接切断」：旧键零读者，直接切断并给退场 warning（仅非 `null`
    值；显式 `null` 与缺席同义），不留迁移层。
  - REVIEW.md「同一语义两处真源」条：`markdown_line_numbers` 的全部引用必须同批扫净（清单见
    design §8），不允许新旧两套语义并存。
