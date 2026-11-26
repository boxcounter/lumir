# Proposal: 文本输入面的 ⌘A 全选——从逐面补丁收口为单一口径

- Change ID: `fix-text-input-select-all-nov26`
- 日期: 2026-11-26
- 角色: Alex Lee（裁决 / 需求），AI agent（诊断与起草）

> 评审记录
> 节点 1（提案评审）：**通过**（2026-11-26）。Alex 原话：「其他你理解是对的，请你安排」。
> 批准范围：把 ⌘A 的落面从「两处 CM 文本面」补齐为「任意可编辑文本宿主」，收口为单一分派；
> 同批收掉 quick-open / toc / vault 三处就地 `input.select()` 副本与文件树内联编辑的漏接；
> 建立输入面清单与静态对账；不新增键位、不新增作用域、不改浮层视觉。
> 诊断依据：本 proposal 引用的行号已按基线 `675a804f` 的当前工作树复核；输入面盘点见
> 「Why」的表格与 [text-input-faces.md](../../../../docs/specs/text-input-faces.md)。

> 节点 2（归档放行，2026-11-27）：**机器 + 独立评审放行**（`docs/process/openspec-workflow.md` 五要件）。
> 1. **方案已批准**：节点 1 Alex 2026-11-26 原话「其他你理解是对的，请你安排」；实现期无静默扩
>    scope（菜单路径与搜索 / 设置等面的行为变化已在 Why / What Changes / Non-goals 明账；r1–r4
>    只修验收场景与判据，无产品行为改动）。
> 2. **独立 reviewer clean / merge**：**主会话终审**（tower 主会话，2026-11-27；无 P1 / P2），
>    绑定实现 tip `bda357f9`（r4 场景修复）。合并 master `5ceddc53` 之后仅验收场景 / 文档 / 归档
>    改动，产品代码无变化。
> 3. **tasks 完成**：27/27 勾选，无放弃项。
> 4. **门禁与真机证据**（证据落 `.local/`）：
>    - unit：`ℹ tests 2088 / pass 2088 / fail 0`（`.local/missions/fix-text-input-select-all-nov26/unit-full.log`）；
>    - 视觉结构：新场景 11/11（`visual-green-final-tip.log`）、相关场景合计 103 PASS（`visual-related-green-final-tip.log`）；
>    - 真实浏览器类型矩阵：number / email 整值选中、date / time 静默无效（`probe-input-select-api.log` /
>      `probe-input-select-typing.log`；`tests/visual/scenes/text-input-select-all-nov26.spec.ts` 第 11 条）；
>    - 根 / visual / unit tsc：`TSC-ROOT PASS` / `TSC-VISUAL PASS` / `TSC-UNIT PASS`；
>    - `docs-check` PASS；`validate --all --strict` 41 passed / 0 failed；`acceptance --check` 308 场景 PASS；
>    - 真机：881 r5 **PASS 25 断言**（`.local/acceptance/2026-11-27-ux-goal-r5/881-text-input-select-all-nov26/`）；
>      47b **PASS 34** / 52 **PASS 38** / 230d **PASS 10**（`.local/acceptance/2026-11-27-ux-goal/`）。
> 5. **规格对账（归档前读数）**：`openspec-archive-check.mjs` 门禁模式 PASS（18 份 delta / 14 条
>    MODIFIED / 244 段 / 无静默丢段）；`validate --all --strict` 41 passed / 0 failed；归档队列有且
>    仅有一条条目（docs-check 门禁）。
> **归档完成（2026-11-27）**：归档提交 `55b938af`；包装器 `openspec archive` 输出
> `Totals: + 1, ~ 5, - 0, → 0`（file-tree +1 ADDED；keymap-commands 2 MODIFIED；quick-open /
> toc-outline / vault-workspace 各 1 MODIFIED）；归档后修链 1 处（proposal.md:13
> `../../../docs/specs/text-input-faces.md` → `../../../../docs/specs/text-input-faces.md`），
> `openspec-links` PASS（710 条全可达）；`node scripts/openspec-archive-check.mjs --archived
> fix-text-input-select-all-nov26` PASS（5 条 MODIFIED / 对比 86 段 / 人工恢复 0 段 / 声明认领 0 段）。

## Why

Alex 报告：文件树内联重命名的编辑框里 `⌘A` 不能全选；并指出 Quick Open 等输入框的同类缺陷
「反复出现，这不是个案而是模式」。

缺陷不是「重命名漏了一行」，而是 **⌘A 的落面定义本身只覆盖两个面**：

1. `⌘A` 的唯一绑定是 `src/keys.ts` 的 `Cmd-a` → `editor.select-all`，作用域 `text` = **编辑器
   内容区 ∪ harness composer**。浮层里的原生输入框不在其中，本层不分发、不消费。
2. `text` 面的成立曾依赖一条现已不成立的假设：living spec 写着「其余焦点不消费该键（原生输入框
   等仍走各自的原生行为）」。M627 为了让 ⌘A 经统一键位层分发，已在 `src-tauri/src/lib.rs` 把
   Edit 菜单的预置 Select All 换成**不带加速键**的自定义项——原生 `selectAll:` 的菜单通道因此
   断开，WKWebView 的 keydown 路径也不再兜底。**「其余焦点」在今天等于「⌘A 静默落空」。**
3. 于是每个浮层各自就地补一份 `input.select()`：`src/quick-open.ts`、`src/toc.ts`、
   `src/vault-switcher.ts` 三份拷贝（各自带一段「WKWebView 是否送达不归本仓控制」的注释）；
   文件树的内联编辑（`src/tree.ts` 的 `wireEdit`）与搜索框、行号框、设置面板、键位面板、
   审批理由 textarea 从未接管。**第四处、第五处输入面只会继续漏。**
4. 菜单路径也带着同一根因：`selectAllByFocusedFace` 只认遮罩 / composer / 编辑器，焦点在
   输入框里时点 Edit ▸ Select All 会**选中正文**——「全局 Select All 抢错焦点」。

输入面盘点（基线 `675a804f`，`src/` 全扫）：

| 输入面 | 实现 | 基线时的 ⌘A |
|---|---|---|
| 编辑器正文 | CM contentDOM | ✅ `editor.select-all` |
| harness composer | CM contentDOM（混排卡片） | ✅ `editor.select-all`（按面分派） |
| Quick Open 筛选框 | 原生 `input` | 就地副本 ① |
| 大纲筛选框 | 原生 `input` | 就地副本 ② |
| vault 筛选框 | 原生 `input` | 就地副本 ③ |
| 文件树重命名 / 新建 | 原生 `input` | ❌ 落空（用户报告的缺陷） |
| 文件内搜索 | 原生 `input` | ❌ 依赖原生（WKWebView 上不可靠） |
| 跳转到行 | 原生 `input` | ❌ 依赖原生 |
| 设置面板各文本框 | 原生 `input` | ❌ 依赖原生 |
| 键位面板查询框 | 原生 `input` | ❌ 依赖原生 |
| 审批理由 | 原生 `textarea` | ❌ 依赖原生 |
| 表格 / 代码块全屏 | 只读 DOM 内容根 | ✅ 遮罩自己处理（选渲染内容，不是输入面） |
| Skill 候选 / wikilink 候选 | 无独立输入框（过滤 composer 文本） | 归 composer 面 |

影响面是键盘正确性与一致性，不是视觉风格：不改布局、不改候选策略、不改任何非 ⌘A 的键。

## What Changes

1. **⌘A 的落面 = 任意可编辑文本宿主**（`keymap-commands`）：`editor.select-all` 仍是 `text`
   面命令（作用域与绑定表不变），另由 `NATIVE_INPUT_HOST_COMMAND_IDS` / `coversNativeInputHosts`
   派生一条**附加面**——支持整值选中的原生输入宿主（文本类 `input` / `textarea` / contenteditable）
   也命中（日期 / 时间族 input 平台不支持整值选中，不在此列，见「真实浏览器实测」）。附加面是命令的属性，
   MUST NOT 手写在绑定表里（单测双向对账）；族内其余 `text` 命令 MUST NOT 放宽。
2. **一处分派**（`keymap-commands` + `text-input-faces`）：装配层的 `selectAllAt` 按事件目标
   （键盘）或当前焦点（菜单）落到：全屏遮罩 → composer → 编辑器 → 原生文本宿主 → 兜底编辑器。
   键盘与 Edit ▸ Select All 走同一个函数。
3. **收掉三处就地副本**（`quick-open` / `toc-outline` / `vault-workspace`）：浮层不再处理 ⌘A，
   也不再保留 `.select()` 副本；合同条款改为「由统一键位层按输入面显式接管」。
4. **补齐漏接的输入面**（`file-tree` 显式立项，其余由统一分派自动覆盖）：内联重命名 / 新建文件
   的编辑框、搜索框、行号框、设置、键位面板、审批理由 textarea。新增原生 input 不需要改分派。
5. **输入面清单 + 静态对账**（`text-input-faces` + `tests/unit/text-input-faces.test.ts`）：
   凡创建原生文本输入的模块必须登记；除两个只读全屏遮罩外，源码里出现本地 `Cmd-A` 即判红；
   `.select()` 只允许出现在统一分派入口与三处「打开即预选」的既有焦点动作里。
6. **测试与场景**：unit 覆盖附加面派生、`isTextEntryHost` 矩阵、分发器命中/不命中/组合期；
   visual 覆盖 rename 红→绿、新建、搜索、行号、键位面板、菜单路径、非文本面不抢焦点、
   contenteditable 合同探针、编辑器 ⌘A 回归；真机场景新增输入面矩阵（本轮不执行真机）。

## Non-goals

- **不新增作用域**（仍是 `global` / `editor` / `text` 三值）、不新增键位、不新增命令 id。
  「第四种作用域」会改键位面板的作用域筛选与徽标，触发像素基线变更——那是人肉裁决点，不在
  本 change 的面上。
- **不把 Emacs 文本导航族放宽到原生输入框**：⌃A / ⌃F / ⌃K 等在输入框里仍是原生编辑语义。
- **不改浮层 / 设置 / 文件树的视觉与布局**，不更新任何视觉基线。
- **不改只读全屏遮罩的 ⌘A**（选中渲染内容，不是输入框；归既有 `overlay-select` 合同）。
- **不动菜单结构**（`src-tauri/src/lib.rs` 的 Select All 让位已在 M627 落地）。
- **本轮不执行真机**：真机场景只更新文件，由后续验收批跑。
- **不处理**「⌘A 在 contenteditable 内的富文本语义（块级选择）」——本层只建立「全选该宿主
  内容」的选区，与编辑器 / composer 的 CM 选区各归各面。
