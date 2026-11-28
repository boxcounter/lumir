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

本 change 的目标是把「无 Tab」收敛为一个**结构性只读、共享产品特有 tips 的空工作区**，并按「不再可达」改准或删除上述旧合同，不留兼容层。

## What Changes

1. **无 Tab 状态统一为结构性只读空工作区**
   - 任一文档 pane 没有带路径标签时，该 pane SHALL 呈空工作区：无正文焦点、无输入、无 dirty、无保存目标。
   - 无路径会话只作为内部占位（打开文件时就地复用，MUST NOT 让空会话堆积），MUST NOT 可编辑、MUST NOT 画插入光标、MUST NOT 显示行号；`⌥G`（`editor.goto-line`）在空工作区没有可跳转文档，MUST NOT 打开输入条。
   - Close All、关闭最后一个 Tab、`reset()`、分栏、首启等所有到达「无 Tab」的路径 SHALL 落在同一形态；首启 tips 在场时 tips 是该 pane 的空态表面，空工作区动作隐藏。
2. **空工作区的共享呈现**
   - 首启、普通无 Tab、空 vault 与双 pane 共用同一组四条 Lumir 特有 tips：Outline、选择文本 → Quote to chat、Knowledge links、Harness pane；布局可按 pane 容量退让。
   - 不提供 Open note / New note 按钮，不显示 Quick Open、查找、设置、vault 切换、`⌘/` 查看全部等通用快捷键，也不以右键新建提示凑数。既有 Quick Open、文件树打开与 vault 右键内联新建链路不变，不新增 IPC、save-as 或一等草稿系统。
3. **焦点与 pane 归属**
   - 非活跃空 pane 的点击 / 聚焦 SHALL 先使所属 pane 成为活跃 pane；随后既有命令与打开链路 MUST NOT 串焦或落错 pane。
   - 取消 / 关闭 Quick Open 等浮层 SHALL 把焦点交还该 pane 的命名静态 region；成功打开文档后才按既有打开语义把焦点交给正文。
   - 空工作区的正文 MUST NOT 成为焦点落点：被覆盖编辑器宿主为 `inert`；region 仅 `tabindex=-1`，承接程序焦点但不进 Tab 序、不冒充按钮。
4. **旧合同按不再可达改准或删除**
   - `pane-layout`：移除「分栏态空 pane 不接受文本输入」与「无标签文档 pane 的空态呈现」两条，统一为新的一条空工作区 requirement。
   - `multi-tabs`：移除「未命名文档的 dirty 守卫」，以「无 Tab 空工作区与 dirty 判定」承接（有路径 dirty 与 vault 切换守卫不变）；Close All 的交还焦点落点改为空工作区静态 region。
   - `fs-io`：删除「没有打开文件时按 Cmd+S 给出不可保存反馈」的无路径分支与场景；有路径但未登记 revision 的 D234 反馈不变。
   - `first-run-onboarding`：首启与普通 / 双 pane 共用四条特有 tips；首启资格、一次性生命周期与默认 harness 布局不变，空白正文结构性只读且宿主 inert。
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
- 不改首启 tips 的一次性生命周期与「默认 harness」布局；不改文件树内联命名的默认名、校验与创建语义。
- 不更新视觉基线；候选截图供 Alex 过目后再决定。
- 不跑完整 visual / 真机（由主会话串行安排）。

## Impact

- 影响的 specs：`pane-layout`、`multi-tabs`、`fs-io`、`first-run-onboarding`、`keymap-commands`、`quick-open`。
- 影响的代码：`src/main.ts`（空工作区表面、焦点落点、同步点）、`src/editor.ts`（无路径会话的可编辑性 / 结构性只读初值）、`src/pane-layout.ts`（删除旧空 pane 判据）、`src/tabs.ts`（关闭最后标签的焦点落点、复用注释）、`src/save-controller.ts`（删除无路径保存反馈分支）、`src/workspace-tips.ts` / `src/workspace-tips.css`（共享内容与响应式视觉）、`src/copy-data.ts` / `文案-Copy.md`（共享文案；删除不可达或已否决的旧文案）、`src/style.css`（结构只读呈现）。
- 影响的测试：`tests/unit/pane-layout.test.ts`、`tests/unit/save-controller.test.ts`、`tests/unit/tabs.test.ts`、`tests/unit/tab-menu.test.ts`（注释 / 不可达用例）、`tests/visual/scenes/no-tab-empty-workspace-nov28.spec.ts`（新）、`m320` / `m281` / `first-run-empty-state` / `first-run-onboarding-nov25` / `gutter-copy-path-line` 的对应断言、`scripts/acceptance/scenarios/885-no-tab-empty-state.md`。
- 关联约束：ADR 0002 §3（webview 不直接触文件系统——新建只走既有后端链路）、ADR 0003（不改写源文件）、ADR 0004（AI-only 开发）、ADR 0006（Emacs keybinding PKM 定位）。

## 节点 1：批准与裁决记录

- Alex 2026-11-28：无 Tab 就是空工作区，不能输入，不再产生任何无路径未保存内容；新建笔记进入正常有路径可保存文档；所有实例已退出且无路径内容不持久化，因此不需要遗留 dirty 保护、保存为、迁移、退出三出口、专门防御或验收注入。
- Alex 2026-11-28 空态重设计：普通空态不要 Open / New 按钮；首启 tips 只保留 Lumir 特有功能，删除系统通用快捷键；首启 / 普通 / 双 pane 共用同一内容，视觉需真正重设计。实现先写机器合同，候选截图仍须过目，不更新正式基线。
- 根方向已获批准，可直接实现；实现与后续批次随任务更新，不另设开工口令。

## 节点 2：归档记录（实现完成后填写）

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是 | 本分支 tip（实现提交；待合并后补 merge hash） |
| released | 不适用 | 本批不打包 |
| machine PASS | 是 | 实现批最终读数 `GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0。同一 change 的实现过程中另有两轮因 master 既有抖动 `unit-tests` 的 `link-suggest.test.ts`「万文件过滤」时序预算（17.75 / 31.75ms > 16ms）读出 `GATE RESULT: 12/13 PASS（SKIP 0）` exit 1；隔离复跑 `pnpm test` 2205/2205 PASS。返修后：`GATE RESULT: 13/13 PASS（SKIP 0）`，exit 0；结构层视觉目标批 126 scene PASS（11 个 spec，`LUMIR_VISUAL_STRUCTURAL=1`）、`pnpm test` 2205/2205 PASS、`execute.test.mjs` 134 PASS、docs-check / openspec validate PASS、`git diff --check` PASS；P2-1 / P2-2 各一轮旧红新绿 |
| native PASS | 是 | 返修 tip 串行复跑：**885 PASS（36 断言）/ 50 PASS（79 断言）**；同 change 上一轮 **263 PASS（37）/ 79 PASS（29）**（改动面不涉 ⌥G，行为未变）。证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-28-no-tab-empty-workspace-r2/evidence/` 与上一轮 `.../2026-11-28-no-tab-empty-workspace/evidence/`；877 未跑（可选） |
| archived | 否 | 待独立评审与归档 |

空态重设计补记（2026-11-28，未归档）：候选 A / B 各 11 张在
`/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/no-tab-empty-workspace-nov28/redesign/`，推荐 A；
正式基线未更新。新 spec 12/12、相邻结构 171/171、focus-created 13/13、前端 2206/2206、
OpenSpec 39/39、验收静态 313/313 通过；五类反向变异均先构建成功再命中目标失败并恢复。
quick r2 为 `GATE RESULT: 13/13 PASS（SKIP 0）` exit 0；最新 r3 / r4 均为
`GATE RESULT: 12/13 PASS（SKIP 0）` exit 1，唯一红项为既有 `link-suggest` 万文件过滤
时序预算（53.26 / 57.80ms > 16ms），隔离 15/15 均过。按本批要求未跑完整 visual / native /
merge / archive，新的 region / inert 真机表现未复验。

五要件现状（归档前由 tower 复核）：方案已批准（节点 1，Alex 2026-11-28）；tasks 全部勾选；
机器门禁与目标批视觉结构层通过；规格对账（docs-check 的归档对账）PASS；真机 885 / 50 已串行复跑 PASS（263 / 79 上一轮 PASS）。
独立评审首轮（K3，绑定 `aa4634a4`）为 needs-changes（P1=0 / P2=3 / P3=4），已按报告逐项返修：
P2-1 vault 切换器焦点接统一入口、P2-2 tips 覆盖判据收窄到宿主 pane、P2-3 同步 native 50/79；
P3-1 `ax.focused` 支持 `{ role, name }`、P3-2 Quick Open 双 pane scenario 改准、P3-3 旧文案 /
注释清扫、P3-4 EOF 空行清理；另清 keymap gutter 右键复制与 file-tree 默认名的不可达旧表述
（各加 MODIFIED 增量）。视觉基线未更新，候选截图落 `.local/reviews/no-tab-empty-workspace-nov28/`
（普通 / 双 pane / 首启 / 空 vault / 首启收起 harness 再分栏 五张），基线更新仍是人肉裁决点。
