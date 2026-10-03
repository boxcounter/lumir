# Proposal: 内容区 pane 化——Phase 1（pane 容器 + 双文档 split view）

- Change ID: pane-system-split-view
- 日期: 2026-10-03
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：**留白待 Alex 裁决**（不预填结论）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

ADR 0008（accepted 2026-10-03，[docs/adr/0008-pane-system-split-view-and-harness.md](../../../docs/adr/0008-pane-system-split-view-and-harness.md)）的 Context 记录了两个独立想法的相撞：

- Harness v1（change `add-harness-probe`，归档 2026-10-03）以右栏 dock 落地：应用骨架 grid 第三列（`src/style.css:334`），宽度钉死 348px（`--layout-dock-w`）。
- Split view 是既有独立想法：两栏正文，典型场景一栏文档一栏代码（代码文件已可编辑形态打开，`src/preview/attachments.ts:187` 的 editable-non-md-files 口径）。

两者叠加出现「四栏困境」：树 | 正文 A | 正文 B | harness。ADR 0008 的诊断：**四栏困境是「harness 在 chrome 层（grid 列）、split view 在内容层」两层各自扩张相撞的产物；统一到一层后困境消解**（界面上限恒为三栏：树 | pane | pane）。

ADR 0008 Decision 8 把实施分为两期：**Phase 1 = pane 容器 + 双文档 split view（含命令路由、活跃 pane、会话所有权、持久化）；Phase 2 = harness 入 pane + chat UX 重做 + pin 式上下文块**。本 change 是 Phase 1 的 OpenSpec 提案，只覆盖 Phase 1；harness 归位 pane 属 Phase 2，本提案仅在 Non-goals 与背景中引用，不展开。

实施可行性已经 ADR 0008 的四路代码 survey 支撑（结论均有 文件:行 证据，见 design §2）：`createEditor` 是自包含工厂（`src/editor.ts:1277`）、多实例结构上不冲突；改造面集中在约 10 个构造期捕获 editor 单例的模块与命令分发写死单例的两处（`src/main.ts:1282`、`src/main.ts:1194`）；持久化与配置回写先例齐全（vault-sessions / `config_set_value`）；无 fork 依赖、无新 npm 依赖。

## What Changes

Phase 1 能力清单（每条对应 specs/ 增量中的一个 requirement）：

1. **pane 容器模型**（新 capability `pane-layout`）：内容区泛化为 pane 容器，v1 上限两个横向 pane；每个 pane 承载一组文档标签（各带标签条）。界面布局上限因此恒为：树 | pane | pane——「四栏」在模型上不存在（harness dock 在 Phase 2 归位 pane 后彻底消解；Phase 1 过渡期内 dock 列保持现状，见 design §1 的过渡形态说明）。不做 Emacs 式任意递归分窗，不做纵向分栏。
2. **活跃编辑器 pane 与焦点解耦**（`pane-layout`）：引入「活跃编辑器 pane」概念（Emacs selected-window 语义）；焦点可以落在文件树、浮层或其他 chrome 上而不改变活跃 pane；编辑器命令、modeline / 树高亮 / toc 跟随的对象是最近活跃的编辑器 pane。
3. **会话所有权：移动标签，非复制**（`pane-layout`）：一份文件同一时刻至多在**一个** pane 打开；跨 pane 是「移动标签」而非「复制标签」——标签带着自己的 `EditorState`（撤销史 / 选区 / 滚动位置）整体迁走，避免两个独立 `EditorState` 对同一文件的 dirty / 保存冲突。`killSlot` 保持全局单例（kill ring 在 Emacs 本就是全局的）。这是相对 Emacs（同一 buffer 可显示在多个 window）的自觉 v1 简化，Revisit 条件由 ADR 0008 兜底。
4. **命令按活跃 pane 路由**（`keymap-commands` 增量）：命令分发从「摊平单例 commands 进全局命令表」改为「分发时按活跃 pane 解析该 pane 的 `editor.commands`」；`isEditorEvent`（editor 作用域判定）泛化为「事件目标落在**任一**编辑器 pane 的 contentDOM 内」。统一键位表的不变量（一个 token 一条绑定、孤儿命令对账）不变。
5. **pane 命令族**（`keymap-commands` 增量）：新增 `pane.split` / `pane.close` / `pane.other` 三条全局命令，默认键位取单段 ⌥ 系（v1 不引入 `C-x` 前缀；具体键值为裁决点 1，起草倾向见下表）。`pane.close` 收起 pane 时其标签并入另一 pane（不丢会话；起草倾向，裁决点 2）。
6. **标签行为按 pane 归属**（`multi-tabs` 增量）：标签条按 pane 各自承载；单 pane 时标签条的呈现位置与几何**逐像素不变**（仍在标题栏内），双 pane 时每 pane 顶部各一条标签条。⌘S / 保存粒度、树高亮、打开落点、dirty 守卫（切 vault / 退出）全部以「活跃 pane 的前台标签」与「全部 pane 的全部标签」为口径更新。
7. **骨架布局**（`ui-design-system` 增量）：「正文栏」泛化为 pane 容器——常态单 pane 与现状逐像素一致；分栏时容器内两个 pane 以分隔条相隔，分隔条位置可拖拽（松手位置写入 vault-sessions 会话文件，per-vault，与能力 8 同一持久化通道；「dock 宽度拖拽」由此吸收取消，Alex 已裁决）；dock 列 Phase 1 不动。
8. **pane 布局持久化**（`vault-workspace` 增量）：扩展 vault-sessions schema（`panes: [{tabs, active}]`、`harness_pane: bool`、分隔条位置；`harness_pane` Phase 1 恒为 false，字段随 schema 一并落盘、Phase 2 消费）。沿用既有纪律：tmp + rename 原子替换、版本不符 = 无历史、写失败降级 warning、路径校验复用 `valid_entry`。装载 vault 后按 pane 布局恢复标签（复用「标签建立与内容装载分两步」的既有口径，落到每 pane）。

## Alex 裁决点

ADR 0008 已裁决、本提案仅登记的事项（不作为待裁决点重复评审）：

| ADR 条目 | 已裁决内容 | 本提案落点 |
|---|---|---|
| Decision 1 | 内容区泛化为 pane 容器，v1 上限两个横向 pane；每 pane 承载文档组或 harness 之一（Phase 1 只有文档 pane） | 能力 1（`pane-layout`） |
| Decision 3 | 活跃编辑器 pane 与焦点解耦；命令按活跃 pane 路由；`isEditorEvent` 泛化为「目标落在任一编辑器 pane contentDOM 内」 | 能力 2、4（`pane-layout` / `keymap-commands`） |
| Decision 4 | 一份文件同一时刻至多一个 pane；跨 pane 移动标签非复制；`killSlot` 全局单例 | 能力 3（`pane-layout`） |
| Decision 6 | pane 布局按 vault 持久化；扩展 vault-sessions schema；沿用 tmp+rename / 版本不符=无历史 / 写失败降级 / `valid_entry` 复用 | 能力 8（`vault-workspace`） |
| Decision 7 | v1 不引入 `C-x` 前缀；pane 命令用单段键、取 ⌥ 系（⌥G 代 `M-g M-g` 的既有先例） | 能力 5（`keymap-commands`） |

真正留给 Alex 的开放项：

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | pane 命令族默认键位（ADR 只裁了「单段、⌥ 系」，未指配具体键） | 起草倾向：⌥S → `pane.split`、⌥O → `pane.other`、⌥W → `pane.close`；或 Alex 另指 | **按倾向执行**：三条默认键位都是单段无空白（`[keys]` 可重绑 / 解绑）；实现期按三线来源（表内 / 原生菜单 accelerator / 系统级）核对零冲突并写入绑定 `doc`（表即文档），核对结论留痕在 tasks.md |
| 2 | `pane.close` 时 pane 内标签的去向 | A. 全部并入另一 pane（标签与其 EditorState 整体移动，活跃标签成为目标 pane 前台）；B. 逐个走关标签确认（dirty 的三出口确认） | **A**：与「移动标签非复制」的会话所有权自洽；关 pane 不等于关文档，用户语义是「收起这一栏」而非「扔掉这些文档」；dirty 内容因此不会被静默丢弃 |
| 3 | 单 pane 时标签条位置 | A. 维持现状（标签条在标题栏内，几何逐像素不变，全部既有视觉基线不受影响）；B. 标签条一律迁入 pane 顶部（单双 pane 统一） | **A**：现状单 pane 是全仓视觉基线与验收场景的主形态，Phase 1 不为统一形态支付整批基线重刷成本；B 若将来要做，随 Phase 2 的 UX 动荡期一并处理 |

## Non-goals

- **harness 入 pane**（ADR 0008 Decision 2）：`⌘⇧A` 语义改为「在旁侧 pane 打开 / 收起 harness」、dock 列与 `.dock-open` 机制移除——全部 Phase 2；Phase 1 提案引用但不展开。
- **chat UX 重做与 `design/prototypes/` 原型**（Phase 2，Alex 已裁决先出原型）。
- **pin 式上下文块、模型选择**（Alex 已裁决推迟至 Phase 2）。
- **`C-x` 前缀键位体系**（backlog「Emacs 档 3」独立立项；分发器机械层已支持，表与配置层不放开）。
- **任意递归分窗、三 pane 及以上、纵向分栏**（v1 上限二；Revisit 条件由 ADR 0008 记录）。
- **同文件双 pane 对照**（共享 buffer = 单 `EditorState` 双 `EditorView` 的更新协调，复杂度不成比例；dogfood 中需求反复出现时由 ADR 0008 的 Revisit 条件触发后续 ADR）。
- **`content_width` 拆分**（双 pane 时 v1 保持全局共享同一 `ui.content_width` 值，单配置键不动；per-pane 栏宽是潜在后续项，不在本 change）。
- **宽度拖拽**（「dock 宽度拖拽」已被 pane 分隔条吸收取消，Alex 已裁决；本 change 只落 pane 分隔条的拖拽与回写）。

## Impact

- 影响的 specs：`pane-layout`（新增 capability）、`keymap-commands`（ADDED：活跃 pane 路由 + pane 命令族）、`multi-tabs`（MODIFIED：标签按 pane 归属、保存 / 高亮 / 打开 / 守卫口径）、`vault-workspace`（ADDED：pane 布局持久化与恢复）、`ui-design-system`（MODIFIED：正文栏泛化为 pane 容器）
- 影响的代码/系统：src（约 10 个捕获 editor 单例的模块改注活跃 pane、pane 容器装配、per-pane tabs 挂载、命令分发、分隔条拖拽）、src-tauri（vault-sessions schema 扩展与恢复路径）、scripts/acceptance（新增 / 更新验收场景）、tests/visual（新增双 pane 表面基线；既有单 pane 基线按纪律核对时间戳）
- 关联约束：ADR 0008 Phase 1 边界（本 change 不得混入 Phase 2 能力）、ADR 0002 §2 修订口径（pane 化 = 同一「单组件双模式」编辑器的第二个窗口实例，不构成第二个编辑器组件）、ADR 0002 §6（性能合同：常驻内存 206–215MB 实测贴 250MB 门禁，Alex 已裁决 pane 化过程中按实测提高门禁、专项治理后置；Phase 1 落地时实测双 pane 常驻内存并登记读数）、ADR 0003 §3（不改写源文件铁律不因 pane 化放宽）、ADR 0004（两个 Alex 评审节点是硬门禁）
