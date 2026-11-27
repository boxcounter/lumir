# Proposal: 列表缩进改为「行」操作对象（替换项 / 子树模型）

- Change ID: rework-list-tab-line-model-nov27
- 日期: 2026-11-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **裁决留痕（2026-11-27）**
>
> Alex 原话：「我希望改为『行』的操作对象模式」。节点 1 已批准，方向不再讨论；本 change 只把
> 「行」模型的具体口径（首项、混合选区、有序编号、引用前缀、空行、选区尾落行首）写清并落地。
>
> **用户实测现场**：0.20 中选中多行（用户截图 6–8 行）按 Shift+Tab，只有光标所在末行减了缩进。
> 机制成因在源码面坐实：`src/list-indent.ts:181` 的 `listIndentChange` 只读
> `state.selection.main.head`，命中该 head 的 `ListItem` 后把**整个项节点覆盖的全部行**一起平移
> （`listItemLines`），其余选中行从未进入判定。

## Why

**模型错位，不是补丁可修的边角**：现行合同（M239 / change `list-tab-indent`，living spec
`keymap-commands` 的「列表项缩进键」）把操作对象定义为 `ListItem` 节点及其子树：TAB 平移整项
（首行 + 续行 + 子列表），Shift+Tab 平移回祖先项所在层；有序列表还按新归属重排受影响分组的源码
编号（D2c）。这个模型天然只服务单光标，选区只是「取 head」的容器——用户一旦用多行选区表达
「这几行一起缩进 / 凸排」，预期（行）与实现（项）必然分叉。

**行模型要解决的三件事**：

1. 选区决定编辑面：选区触及的每一行都参与，不再由 head 单点决定；未选中行（含同一项的续行、
   子项、后续兄弟项）逐字节不动。
2. TAB 只动行本身：不再「顺手」带子树，避免用户选中一行却改了一整块。
3. Shift+Tab 逐行删已有结构空白：每行按自己的结构量收缩，不能只处理 head 所在项。

**切断旧行为的代价如实记录**（用户已裁决，不保留双模式）：

- **D2c 有序编号重排被切断**：行模型下「改未选行序号」与「未选中行逐字节不动」直接冲突；
  若只改选中行又会制造重复 / 跳号。故本 change 起两条命令**一律不改写列表标记与编号**。
  有序列表的显示编号本就由渲染层按组序计算（`src/preview/lists.ts` 的 `orderedItemLabel`，
  不读源码字面数字），缩进后的源码编号与显示可能不一致——这是行模型的既定代价。
- **单光标 TAB 的编辑面变小**：光标在项首行时只缩进该行，续行与子项留在原处（可能因此脱离该项
  的解析归属 / 改变相对结构）。这是「不带子树」的直接含义，不是回归。
- **首项 TAB 仍无操作**：行模型不凭空给出缩进目标——首项没有上一同级项可嵌套，写入只会留下渲染态
  看不见的空白 diff（M239 的 S1b 理由在行模型下依然成立，见 design §3.4）。

## What Changes

对应 `specs/keymap-commands/spec.md` 的 delta：旧条「列表项缩进键（TAB / SHIFT+TAB）」整条
**REMOVED**、由新增承接条「列表行缩进键（TAB / SHIFT+TAB）」承接（模型替换即改名——OpenSpec 的
MODIFIED 块不允许改 scenario 名，先例 `vault-and-session-removal`），另以 1 条 MODIFIED 更新
「轨道 D」requirement 里对该条名的交叉引用。命令 id 与默认绑定不变。

1. **操作对象改为行集**：取 `state.selection` 全部 range 触及的行（空选区 = head 行；非空选区 =
   与选区相交的行，尾落在行首的那一行不计），多 range 取并集；逐行判定、逐行写回。命令 MUST NOT
   以 `main.head` 代替选区。
2. **逐行归属与步长**：每行按行首结构前缀 `resolveInner` 归最近的 `ListItem`；首行用「上一同级项
   内容列 / 祖先项 marker 列」的结构目标，续行用所属项的内容列宽；代码块 / 表格 / HTML 块内与
   非列表行跳过。
3. **写回仍是空白区间**：TAB 在行首结构前缀之后插入空格；Shift+Tab 删除该行可删的前导空白
   （不超过该行步长、不越过 `>` 分隔空白、不碰非空白字符）；纯空白行不写；不产生 tab 字符。
4. **不改编号**：本次切断 D2c；标记字符、任务标记、有序编号全程逐字节不动。
5. **单次 dispatch**：一次按键 = 一个 changeset = 一步撤销；不显式重设选区，由 change mapping
   平移；无任何编辑时不 dispatch。

## Non-goals

- 不扩权到既有禁区：只读会话、围栏 / 缩进代码块、表格、HTML 块内的行照旧不写；IME 组合态与键位
  层的既有边界不动；非列表行（段落、标题、引用正文）照旧不处理。
- 不做「块对齐」：不把多行选区统一成一个最小公共缩进量，也不为不同 marker 宽度做跨行归一。
- 不改渲染层、不新增视觉设计：行首空白与 marker 的隐藏 / 悬挂缩进沿用 `src/preview/lists.ts`，
  本 change 不更新视觉基线。
- 不引入依赖，不换用 CM 的 stock `indentMore` / `indentLess` 作为命令实现（落点与引用前缀口径
  不同，见 design §5）。
- 不做树模型 / 项模型的双模式或配置开关。

## Impact

- 影响的 specs：`keymap-commands`（REMOVED 旧条 + ADDED 承接条 + 轨道 D 的 1 条 MODIFIED）。
- 影响的代码：`src/list-indent.ts`（纯判定重写为行集）、`src/editor.ts` 的命令注释（runner 与
  dispatch 形态不变）、`tests/unit/list-indent.test.ts`、`tests/visual/scenes/m239-list-tab-indent.spec.ts`、
  真机场景 `43-list-tab-indent`（有序列表期望改为不重排）与新增 `888-list-line-indent`。
- 关联约束：ADR 0003 §3（装饰 / 编辑 MUST NOT 越出用户动作所指的最小范围）；REVIEW.md「同一语义
  两处真源」条（步长与归属判定只留在 `src/list-indent.ts` 一处）。

## 节点 2：归档放行记录

机器 + 独立评审放行（`docs/process/openspec-workflow.md` 的五要件）；逐条读数如下：

1. **方案已批准**：节点 1 Alex 2026-11-27「我希望改为『行』的操作对象模式」；实现期无静默
   扩 scope——首项 TAB 无操作、非列表行不写、有序编号不改写三条已批口径全程保持。
2. **独立 reviewer clean / merge**：K3 独立终审 clean/merge，绑定 tip `66d06006`
   （P1 / P2 / P3 = 0；评审文 `.local/reviews/rework-list-tab-line-model-nov27/k3-verdict.md`）。
3. **tasks 完成**：`tasks.md` 的 4 组任务全部勾选；4.6 记录真机 PASS 与 merge / push / 基线边界，
   无放弃项。
4. **门禁与真机证据**：
   - `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`。
   - 单测专项 `tests/unit/list-indent.test.ts` 21/21；chromium
     `tests/visual/scenes/m239-list-tab-indent.spec.ts` 15/15（含真实键位后的选区 anchor / head
     映射与方向断言）；三份 tsc（根 / 单测 / 视觉）全过。
   - 真机：43 `PASS / 76 断言`（`.local/acceptance/2026-11-27-list-line-indent/`）、
     888 `PASS / 51 断言`（`.local/acceptance/2026-11-27-list-line-indent-final/`）。
5. **规格对账无丢段**：归档前 `node scripts/openspec-archive-check.mjs` 门禁模式 PASS
   （1 条 MODIFIED 轨道 D，13 段，无静默丢段）；`validate --all --strict` 39 passed / 0 failed；
   `docs/backlog.md` 归档队列有且仅有一条本 change 条目。

**归档后记录**

- 归档提交：`ead4a330`；归档目录
  `openspec/changes/archive/2026-11-27-rework-list-tab-line-model-nov27/`。
- 包装器 `node scripts/openspec-archive.mjs rework-list-tab-line-model-nov27` 原文读数：
  `Totals: + 1, ~ 1, - 1, → 0`（keymap-commands：ADDED「列表行缩进键」/ MODIFIED「轨道 D」/
  REMOVED 旧「列表项缩进键」）；归档后修链 0 处（4 篇 Markdown / 0 条相对链接）；
  `openspec-links: PASS（710 条全部可达）`；包装器 `PASS`。
- `node scripts/openspec-archive-check.mjs --archived rework-list-tab-line-model-nov27`：
  `PASS（1 条 MODIFIED，对比 13 段；人工恢复 0 段，声明认领 0 段）`。
- 承接核对：living `openspec/specs/keymap-commands/spec.md` 已无「列表项缩进键」requirement，
  旧条 9 个 scenario 全部消失；新条「列表行缩进键」12 个 scenario 落位；「轨道 D」的交叉引用
  已改指新条。归档后 `validate --all --strict` 38 passed / 0 failed。
