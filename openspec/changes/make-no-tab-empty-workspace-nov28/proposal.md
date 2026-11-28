# Proposal: 无 Tab 统一为空工作区

- Change ID: `make-no-tab-empty-workspace-nov28`
- 日期: 2026-11-28
- 角色: Alex Lee（需求与裁决），AI agent（起草）

## Why

当前「没有打开任何 Tab」在实现与规格里同时是三种东西：单 pane 可直接键入的未命名 scratch、分栏空 pane 的结构性只读空面、首启 tips 下的空白草稿。三者都保留一份**没有路径、可以产生未保存内容**的隐式文档，于是同一个「空」状态既没有统一表面，也没有统一的可编辑性口径。

Alex 2026-11-28 明确裁决：**无 Tab 就是空工作区，不能输入，不再产生任何无路径未保存内容**。新建笔记必须进入正常的有路径、可保存文档；打开走既有打开链路。

裁决同时确认了实施前提：**所有实例都已退出，且无路径内容不持久化**。因此本 change 不处理存量无路径 dirty——不做遗留 dirty 保护、不做「保存为」、不做迁移、不做退出三出口、不做专门防御，也不新增验收注入。这些范围一律不展开。

直接后果是两条旧合同失去对象：

1. `pane-layout` / `multi-tabs` 的「单 pane 空态 scratch 可编辑」「分栏前 dirty scratch 豁免」「未命名文档的 dirty 守卫」——新形态下没有可编辑的无路径文档，这些状态不可达；
2. `fs-io` 的「没有打开文件时按 Cmd+S 给出不可保存反馈」——空工作区没有 dirty，也就没有这条反馈的触发面。

本 change 的目标是把「无 Tab」收敛为一个**结构性只读、带两个动作的空工作区**，并按「不再可达」改准或删除上述旧合同，不留兼容层。

## What Changes

1. **无 Tab 状态统一为结构性只读空工作区**
   - 任一文档 pane 没有带路径标签时，该 pane SHALL 呈空工作区：无正文焦点、无输入、无 dirty、无保存目标。
   - 无路径会话只作为内部占位（打开文件时就地复用，MUST NOT 让空会话堆积），MUST NOT 可编辑、MUST NOT 画插入光标、MUST NOT 显示行号。
   - Close All、关闭最后一个 Tab、`reset()`、分栏、首启等所有到达「无 Tab」的路径 SHALL 落在同一形态；首启 tips 在场时 tips 是该 pane 的空态表面，空工作区动作隐藏。
2. **空工作区的呈现与两个动作**
   - 显示简洁的「没有打开的文档」，提供「打开笔记…」与「新建笔记」。
   - 「打开笔记…」复用既有 Quick Open；「新建笔记」复用文件树既有的内联命名创建链路（默认名预填、提交合法名字才创建并打开），MUST NOT 自动创建 / 自动命名 / 自动写盘。
   - 不新增 IPC、save-as、通用组件或一等草稿系统。
3. **焦点与 pane 归属**
   - 非活跃空 pane 的动作 SHALL 先使所属 pane 成为活跃 pane，再进入对应链路；双 pane MUST NOT 串焦或落错 pane。
   - 取消 / 关闭「打开笔记…」浮层 SHALL 把焦点交还该 pane 的空工作区主操作；成功打开文档后才按既有打开语义把焦点交给正文。
   - 空工作区的正文 MUST NOT 成为焦点落点：关闭最后一个 Tab、Close All、分栏、`pane.other`、浮层关闭等交还焦点的路径在空 pane 上落到主操作。
4. **旧合同按不再可达改准或删除**
   - `pane-layout`：移除「分栏态空 pane 不接受文本输入」与「无标签文档 pane 的空态呈现」两条，统一为新的一条空工作区 requirement。
   - `multi-tabs`：移除「未命名文档的 dirty 守卫」，以「无 Tab 空工作区与 dirty 判定」承接（有路径 dirty 与 vault 切换守卫不变）；Close All 的交还焦点落点改为空工作区主操作。
   - `fs-io`：删除「没有打开文件时按 Cmd+S 给出不可保存反馈」的无路径分支与场景；有路径但未登记 revision 的 D234 反馈不变。
   - `first-run-onboarding`：tips 与空工作区的关系改准（tips 在场时空工作区动作隐藏，空白正文结构性只读）。
   - `keymap-commands`：行号条款的「单 pane 未命名 scratch」表述改为「无标签 pane / 空工作区」。
   - `quick-open`：新增「空工作区的打开入口与焦点归还」requirement。
5. **不变项**
   - 有路径 dirty 的保存 / 关闭 / 切换 / 退出保护、异常文档（有路径但未登记 revision）的旧保护、vault 外只读会话的既有行为全部不变。
   - 不新增 pathless dirty 的任何行为（保护、保存、迁移、退出出口都没有）。
   - 不改 harness composer 的输入与草稿；不改文档内容、撤销栈、保存链路、键位与配置 schema。

## Non-goals

- 不做「保存为」、不新增 Rust command / IPC / ts-rs 导出面，不建立一等草稿或恢复入口。
- 不做存量实例迁移、无路径 dirty 的持久化 / 跨启动恢复 / 双写、退出三出口或遗留 dirty 保护。
- 不新增专门防御（如「禁止创建无路径会话」的运行时守卫层）或验收注入通道；无路径占位会话保留为既有打开链路的复用落点。
- 不改首启 tips 的内容、生命周期与「默认 harness」布局；不改文件树内联命名的默认名、校验与创建语义。
- 不更新视觉基线；候选截图供 Alex 过目后再决定。
- 不跑完整 visual / 真机（由主会话串行安排）。

## Impact

- 影响的 specs：`pane-layout`、`multi-tabs`、`fs-io`、`first-run-onboarding`、`keymap-commands`、`quick-open`。
- 影响的代码：`src/main.ts`（空工作区表面、焦点落点、同步点）、`src/editor.ts`（无路径会话的可编辑性 / 结构性只读初值）、`src/pane-layout.ts`（删除旧空 pane 判据）、`src/tabs.ts`（关闭最后标签的焦点落点、复用注释）、`src/save-controller.ts`（删除无路径保存反馈分支）、`src/copy-data.ts` / `文案-Copy.md`（空工作区文案；删除不可达的 D107 / D233 / D369）、`src/style.css`（空工作区与动作钮样式）。
- 影响的测试：`tests/unit/pane-layout.test.ts`、`tests/unit/save-controller.test.ts`、`tests/unit/tabs.test.ts`、`tests/unit/tab-menu.test.ts`（注释 / 不可达用例）、`tests/visual/scenes/no-tab-empty-workspace-nov28.spec.ts`（新）、`m320` / `m281` / `first-run-empty-state` / `first-run-onboarding-nov25` / `gutter-copy-path-line` 的对应断言、`scripts/acceptance/scenarios/885-no-tab-empty-state.md`。
- 关联约束：ADR 0002 §3（webview 不直接触文件系统——新建只走既有后端链路）、ADR 0003（不改写源文件）、ADR 0004（AI-only 开发）、ADR 0006（Emacs keybinding PKM 定位）。

## 节点 1：批准与裁决记录

- Alex 2026-11-28：无 Tab 就是空工作区，不能输入，不再产生任何无路径未保存内容；新建笔记进入正常有路径可保存文档；所有实例已退出且无路径内容不持久化，因此不需要遗留 dirty 保护、保存为、迁移、退出三出口、专门防御或验收注入。
- 根方向已获批准，可直接实现；实现与后续批次随任务更新，不另设开工口令。

## 节点 2：归档记录（实现完成后填写）

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 | 本分支 tip（实现提交；待合并后补 merge hash） |
| released | 不适用 | 本批不打包 |
| machine PASS | 是 | 最终读数 `GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0。同一 change 的实现过程中另有两轮因 master 既有抖动 `unit-tests` 的 `link-suggest.test.ts`「万文件过滤」时序预算（17.75 / 31.75ms > 16ms）读出 `GATE RESULT: 12/13 PASS（SKIP 0）` exit 1；隔离复跑 `pnpm test` 2205/2205 PASS，最终全量门禁复跑 13/13。结构层视觉目标批 124 scene PASS（11 个 spec，`LUMIR_VISUAL_STRUCTURAL=1`）；docs-check / openspec validate PASS |
| native PASS | 否 | 本批不跑真机（主会话串行）；验收场景 885 / 263 只做 `--check` 静态 |
| archived | 否 | 待独立评审与归档 |

五要件现状（归档前由 tower 复核）：方案已批准（节点 1，Alex 2026-11-28）；tasks 全部勾选；
机器门禁与目标批视觉结构层通过；规格对账（docs-check 的归档对账）PASS；独立 reviewer 与真机
证据待主会话安排。视觉基线未更新，候选截图落
`.local/reviews/no-tab-empty-workspace-nov28/`（普通 / 双 pane / 首启 / 空 vault 四张），
基线更新仍是人肉裁决点。
