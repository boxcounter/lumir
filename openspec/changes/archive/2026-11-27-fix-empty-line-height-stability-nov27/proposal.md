# Proposal: 普通正文 / 空行的 8px 段末下距归零——行高在任何上下文迁移下稳定

- Change ID: `fix-empty-line-height-stability-nov27`
- 日期: 2026-11-27
- 角色: Alex Lee（需求 / 裁决），AI agent（起草与实现）

> **评审记录**
> 节点 1（提案评审）：**通过**。Alex 原话「采纳。请你安排。」（2026-11-27）即批准；随后追加
> 「有demo或者可视化的东西吗」，本轮交付因此包含候选实现 + before/after 审阅页（`.local/reviews/empty-line-height-nov27/index.html`，git 外）。
> **视觉基线批准**：Alex 看过审阅页与原话「接受。可以安排。」（2026-11-27）批准方向与 13 张差异，基线已按批准更新（§3.4）。
> **清单漏计 4 张（待追认）**：`expectScreenshot` 失败即抛错，首轮全量视觉在 `wrap-combo-1` 与
> `typography-custom-font-20px` 处中止，同测试后续的 `wrap-combo-2/3/4` 与 `typography-font-size-24`
> 从未被比较。实测差异 9004–36183px（0.94%–3.77%），与本 change 同源；按「只更新已审阅 13 张、不扩大
> 基线面」的指令先未更新；Alex 2026-11-27 以原话「批准追加的4张基线」批准，已只更新这 4 张（§5.3）。
>
> **批准边界与本轮范围修订**：首版诊断方案只删「文档末行」特例（下文方案 C）。独立评审（K3，
> 2026-11-27）用纯函数实测证明 C 与「空行也带 8px」的 B 都仍会留下可复现的邻行跳变——见
> `design.md` §2。最终合同按评审推荐收窄为：**块几何入口写给顶层普通正文与空行的纵向 padding 恒为 0，
> 标题阶梯与列表 2px 等块自身间距保留**。本 change 的批准边界即这条统一合同；不做独立 block gap、
> 不做 bottom→top 搬家、不动 M399（空行正常行高）与 m647（caret 几何）两条既有合同。

## Why

### 缺陷（Alex 2026-11-27 真机报告 + 诊断）

光标停在空行上时该行「更高」、输入首字后光标与行盒跳动。诊断（截图几何 + 代码链）坐实：

- `src/preview/block-geometry.ts` 的 `classifyLine` 给普通正文行 8px 下距，判据是**邻行**——
  「下一行是块边界」或「本行是文档末行」；空行本身恒 0/0。
- 于是三类未编辑行会因邻居变化而翻转 8px：
  - 文档末尾空行落字：该行 0 → 8（行盒 25.5 → 33.5，active gutter 同步变高）；
  - `a\n` → `a\nx`：前行 8 → 0、编辑行 0 → 8（8px 在邻行之间搬家，END 不动但行盒全跳）；
  - `## 标题` → `标题`（标题转正文）：**未编辑的上一行** 8 → 0。
- 这是「邻行付账」模型的结构性缺陷：任何只补一处特例的方案都会在另一处复发。

### 为什么只删末行特例（C）与「空行也带 8px」（B）不够

纯函数实测（`design.md` §2）：C 下 `alpha\n## next` → `alpha\nnext` 的第一行仍 8 → 0；B 下
`a\n` → `a\nx` 的前行仍 8 → 0。两者都不满足「非语义迁移不改未编辑行」。

### 目标

普通正文与空行的纵向几何**只由本行 + 块自身形态决定**：空↔有字、EOF 输入、标题↔正文、Enter 拆合、
selection / focus / IME 都不改变任何行的行盒；语义变化（标题 / 列表成立或消失）只改受影响块内的行，
块外行只整体位移。代价是静态间距收紧（段落之间与直接块边界各少 8px），属 Alex 过目的视觉项。

## What Changes

1. **合同**：MODIFIED `editor-live-preview` 的「块边界纵向几何的源码同步稳定性」——普通正文 / 空行纵向
   padding 恒 0（不读邻行 / EOF / 光标 / IME）；非语义迁移稳定（行盒 / END / heightmap / gutter）；语义
   reflow 有界（块外行高度不变、位移等于获批高度差）。
2. **实现**：`src/preview/block-geometry.ts` 删除「下一行是否块边界」与「本行是否文档末行」两条判断；
   顺带移除因此失去消费者的 `boundary` / `chain` 返回字段。标题阶梯、列表项 2px、引用 / 代码 / 表格 /
   HR 的 0/0 全部不动。
3. **测试**：
   - 纯函数（`tests/unit/block-geometry.test.ts`）：局部性矩阵、非语义迁移（末行 / 中间 / 连续空行 /
     全空文档）、57 行同族、heading↔text、Enter 拆合、视口片段与全量同值。旧模型上 7 红，终态 13 绿。
   - 浏览器（新增 `tests/visual/scenes/empty-line-height-stability-nov27.spec.ts`）：末行输入首字
     （行盒 / active gutter / END / 总高）、`a\n → a\nx`、57 行、heading↔text 的前行不变 + 后行位移等于
     获批高度差、Enter 拆合、DOM↔CM heightmap↔gutter 对账、滚出滚回、selection/focus、IME 组合与提交。
     旧模型上 15 红 / 2 绿，终态 17 绿。m399 / m647 **一字未改**且保持绿。
   - 旧 8px 期望值按终态修改（反向证据）：`block-boundary-geometry.spec.ts`（含新增 EOF 用例）、
     `markdown-editing-stability.spec.ts` 的 33.5 / 8px。
4. **合同文档**：`docs/specs/lists.md` L8（前行 8px → 恒 0）、`docs/specs/design-tokens-v1.md` 的
   doc-body 段落间距。
5. **视觉材料**：10 个合成 fixture × 当前 master / 候选两版构建的 before/after 截图与逐行读数，
   内置控制面板的审阅页（`.local/reviews/empty-line-height-nov27/index.html`）；本地全量视觉像素层
   报红的基线逐条列出，**不更新正式基线**（基线更新是 Alex 的人肉裁决点）。

## Non-goals

- 不改标题阶梯（`HEADING_TOP` / `HEADING_BOTTOM`）、列表项 2px、引用 / 代码 / 表格 / HR 的几何。
- 不引入独立 block gap / margin 方案，不做 bottom→top 搬家（评审已论证不是等价静态搬家，且改变点击落点
  归属），不调其他间距常量。
- 不改 M399「空行渲染不变量」（空行仍以正常行高渲染）与 m647「caret 高度 = 行盒」。
- 不做数据迁移、不改持久化与文档字节。
- 本轮不更新任何视觉基线、不 merge / push / 归档、不跑真机（几何在 chromium 结构层 + 纯函数层判定；
  真机手感与像素审美归 Alex）。

## Impact

- **spec**：`editor-live-preview` 1 条 MODIFIED requirement（无 ADDED / REMOVED）。
- **代码**：`src/preview/block-geometry.ts`。
- **测试**：`tests/unit/block-geometry.test.ts`、`tests/visual/scenes/block-boundary-geometry.spec.ts`、
  `tests/visual/scenes/markdown-editing-stability.spec.ts`、新增
  `tests/visual/scenes/empty-line-height-stability-nov27.spec.ts`。
- **文档**：`docs/specs/lists.md`、`docs/specs/design-tokens-v1.md`。
- **视觉基线**：普通 Markdown 整页基线会出现 8px 级重排；候选截图与清单见审阅页与交付说明，待 Alex 过目后
  由基线更新流程处理。

## 节点 2：归档记录（2026-11-27，独立评审 + 机器判据放行）

### 归档前（五要件）

1. **方案已批准**：节点 1 Alex 原话「采纳。请你安排。」（2026-11-27）；实现期两次视觉裁决同样有原话——
   13 张基线「接受。可以安排。」、追加 4 张「批准追加的4张基线」。实现期无静默扩 scope：改动面 =
   「What Changes」五条 + 上述获批准的基线更新 + 场景 100 判据修正（test-only）。
2. **独立 reviewer clean / merge**：K3 终审 **clean/merge**，绑定 tip
   `727810e057fe68e01e2a181d0bd1b43445571469`（评审输出见主会话任务 `agent-kki23yuu`）。评审要点：
   17 张基线 SHA-256 **17/17** 与审阅候选一致；`visual-full-approved.log` = 1935 passed / 0 failed /
   13 skipped；`gate-quick-approved.log` 的 `GATE RESULT: 13/13 PASS（SKIP 0）`；两项 P3 已修。
3. **tasks 完成**：全部勾选（1.1–5.5），无放弃项。
4. **要求的门禁与真机证据**：
   - `scripts/gate.sh quick` → `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0
     （`.local/reviews/empty-line-height-nov27/evidence/gate-quick-approved.log`）；
   - 完整像素视觉（`bash scripts/visual/run.sh`，非 STRUCTURAL）→ **1935 passed / 0 failed /
     13 skipped（22.4m）**，退出码 0（同目录 `visual-full-approved.log`）；
   - `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → 39 passed / 0 failed；
   - `bash scripts/docs-check.sh` → PASS；
   - 真机场景 100（含用例 5/6）r2 → **PASS：39 条断言 / 0 失败**，
     `.local/acceptance/2026-11-27-empty-line-height-r2/`（首轮 END 无 bbox 失败 → test-only 改判
     编辑器 `AXTextArea` 后通过；产品代码未动）；
   - 视觉基线：13 + 4 张均经 Alex 批准，逐张与审阅候选 SHA-256 一致（**17/17**）。
5. **规格对账无丢段（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 **PASS**
   （扫过 9 份 delta，8 条 MODIFIED，对比 117 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目）；
   `validate --all --strict` 39/39；`docs/backlog.md` 归档跟踪队列本 change 唯一条目。

### 归档后

- **归档提交**：`57c4fc39`（归档目录 + living spec + 本记录）。
- **包装器输出**：`openspec-archive: 已归档到 openspec/changes/archive/2026-11-27-fix-empty-line-height-stability-nov27/`；
  `归档后修链 0 处（扫过 4 篇 Markdown / 0 条相对链接）`；
  `openspec-links: PASS（校验 711 条相对链接，全部可达）`；`openspec-archive: PASS`。
- **`--archived` 审计（2026-11-27）**：`openspec-archive-check: PASS（openspec/changes/archive/2026-11-27-fix-empty-line-height-stability-nov27：1 条 MODIFIED，对比 8 段；人工恢复 0 段，声明认领 0 段）`。
