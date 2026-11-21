# Proposal: 快速打开的 ⌘A 全选与目录直接子级提示 / 筛选

- Change ID: `fix-quick-open-select-all-directory-children-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 评审记录
> 节点 1：Alex 2026-11-21 在需求批逐字提出「Cmd+P Cmd+A 全选 + 目录直接子级提示/筛选」，
> 并以「请你继续」确认推进。实现范围严格限定在需求的两条内，未新增其它产品行为。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-21）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-21 通过——Alex 需求原话「Cmd+P Cmd+A 全选 + 目录直接子级
   提示/筛选」+「请你继续」确认推进（见上方「评审记录」）。实现期没有静默扩 scope：两条需求分别
   落在 `quick-open` 的 ⌘A 接管与目录语境候选 / 提示上；r1 评审 P2-1/P2-2/P3-1/P3-2 的返修
   （AX value 判据、MODIFIED 整块、Enter 口径、组合期 ⌘A）都在既有意图内，未新增产品行为。
2. **独立 reviewer clean / merge**：独立 reviewer agent-35 判 `clean/merge`，无 P1 / P2 findings，
   明记「keys identity 修复未放宽产品判据」；绑定 integration tip
   `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/navigation-batch-nov21/review-final.md`。
   当前分支 tip 与该评审 tip 相同。
3. **tasks 完成**：`tasks.md` 30/30 全勾（`grep -c '^- \[x\]'` = 30，未勾项 0），无放弃项；
   0.4 / 4.3 / 5.2 已就地补裁决、真机与评审指针。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/quick-open.spec.ts`（该场景无像素基线），
   按 `scripts/gate.sh visual` 档取读数——`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0。
   真机场景 `230d-quick-open-select-all-dir-children` PASS（9 断言，0 FAIL；`status.txt` =
   `PASS`），覆盖 ⌘A 全选后替换键入、目录直接子级提示 / 深层后代不混入、裸目录两段式 Enter，
   证据 `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/230d-quick-open-select-all-dir-children/`
   （`steps.md` / `shots/` / `ax/`）。未更新视觉基线。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   10 份 delta，10 条 MODIFIED，对比 180 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`
   （退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 37
   passed, 0 failed (37 items)`（退出码 0）。归档跟踪队列有且仅有一条本 change 条目
   （`docs/backlog.md`）。delta 是 `quick-open` 的 1 条 ADDED（输入面 ⌘A）+ 2 条 MODIFIED
   （候选列表与匹配语义、结果区与 Enter 的判决同源），是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：无未决的价值 / 行为裁决、无审美手感项、无影响面升级、评审结论与
tip 均无异常、证据无缺口，故不另送 Alex。

## 节点 2 记录（归档后，2026-11-21）

- **归档提交**：`d7b5a5b3093219340cf75e6335b5621970434f62`（归档目录 + 并入后的
  `openspec/specs/quick-open/spec.md` + `docs/backlog.md` 队列条目核销同一提交；本段记录本身是
  其后一笔文档提交，审计仍定位该归档提交）。
- **`openspec archive` 实际输出**（`node scripts/openspec-archive.mjs
  fix-quick-open-select-all-directory-children-nov21`，退出码 0）：`Task status: ✓ Complete` /
  `Specs to update:` / `quick-open: update` / `+ 1 added` / `~ 2 modified` /
  `Totals: + 1, ~ 2, - 0, → 0` / `Specs updated successfully.` /
  `Change 'fix-quick-open-select-all-directory-children-nov21' archived as
  '2026-11-21-fix-quick-open-select-all-directory-children-nov21'.`。
- **归档后修链**：`归档后修链 2 处（扫过 4 篇 Markdown / 3 条相对链接）`——
  `proposal.md:10` 与 `proposal.md:15` 的 `../../../docs/process/openspec-workflow.md` →
  `../../../../docs/process/openspec-workflow.md`。包装器末置门禁
  `openspec-links: PASS（校验 652 条相对链接，全部可达）`。
- **归档后审计**（`node scripts/openspec-archive-check.mjs --archived
  fix-quick-open-select-all-directory-children-nov21`，2026-11-21T14:35Z，退出码 0）：
  `PASS（openspec/changes/archive/2026-11-21-fix-quick-open-select-all-directory-children-nov21：
  2 条 MODIFIED，对比 33 段；人工恢复 0 段，声明认领 0 段）`——2 条 MODIFIED 的段落全部落进
  归档后的 living spec，无静默丢段。
- **归档后复跑读数**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` →
  `Totals: 36 passed, 0 failed (36 items)`（退出码 0）；`node scripts/openspec-archive-check.mjs`
  门禁模式 → PASS（`扫过 9 份 delta，8 条 MODIFIED，对比 147 段，无静默丢段；归档队列 0 项已完成
  change 均有唯一条目`）；`bash scripts/docs-check.sh` → `docs-check: PASS`（退出码 0）。

## Why

### 来源与现象

Alex 原始需求（逐字）：

> 「Cmd+P Cmd+A 全选 + 目录直接子级提示/筛选」

两条都落在既有的按路径快速打开（`quick-open`）上：

1. **⌘A**：输入面打开、输入框持焦时，`⌘A` 没有稳定地全选输入框内容。`src/keys.ts` 里 `Cmd-a`
   绑的是 `editor.select-all`，作用域 `text`（只在编辑器内容区与 harness composer 内命中）；
   输入框是普通 `input`，不在该作用域里。实现也没有在输入面就地接管这个键——能不能全选取决于
   WKWebView / 原生 Select All 菜单的默认行为，而 M627 起原生菜单项已经让出 `⌘A` 加速键。
   失败形态是「按了 ⌘A，输入串没被选中，下一次键入变成追加」，且随宿主环境漂移。

2. **目录语境的直接子级**：输入解析到目录时，判决已经是 `dir`（`resolveQuickOpenSync` 的
   `classifyVaultPath` → `isDir`），但结果区的候选仍按 `filterIndices(files, query)` 过滤——
   查询串是目录路径，匹配对象是**完整相对路径的子串**。于是 `notes` 会把
   `notes/sub/deep.md`、`notes/sub/nested/even-deeper.md` 一起列出来，`notes-extra/note.md`
   这种同前缀兄弟目录也会混入。提示行在输入期间只显示「命中 N 条」，用户看不出这是一个目录、
   也看不出列表为什么包含更深的文件；只有第一次 Enter 之后才看到「是目录，不能打开」。

### 为什么按缺陷修复，不重写

- 目录判决、两段式 Enter、直接打开行与候选共用的游标空间都是既有能力（change
  `quick-open-file-oct23`、M700 的判决同源）。缺的只是「判决带出目录语境 → 结果区据此收窄候选
  + 提示」这一段映射。
- `filterIndices` 是候选匹配的唯一实现（spec「候选列表与匹配语义」），不能为目录语境再写一份
  子串 / 前缀匹配；直接子级需要一个**父目录逐字相等**的纯函数判据，边界是 `/` 而不是字符串前缀。
- 原 change 的非目标「不做目录浏览（dired）」继续成立：本 change 只在同一个列表内收窄筛选范围，
  MUST NOT 展开目录、改文件树、或提供进入下一层的浏览动作。

## What Changes

1. **输入面内的全选（`quick-open` 新增 requirement）**：输入面就地接管 `⌘A`，选中输入框内的
   全部输入内容并阻止默认行为；不依赖 webview / 原生菜单。其余文本编辑键（复制 / 剪切 / 粘贴 /
   撤销 / 重做 / 移动 / 删除）继续走原生输入框路径；编辑器内的 `⌘A` 语义不变。
2. **目录语境的直接子级筛选（`quick-open` 修改「候选列表与匹配语义」与「结果区与 Enter 的判决
   同源」）**：判决带出目录路径后，
   候选收窄为该目录的**直接子级文件**（父目录逐字相等、边界 `/`），深层后代与同前缀兄弟目录
   MUST NOT 混入；提示行说明「这是目录 + 直接子级文件数」；没有直接子级文件时单独如实说明。
   尾斜杠只作为**目录断言**（`notes/`），去掉一个斜杠后确实是 vault 内目录才进入目录语境；
   目录判据仍复用 `isDir`，不新增目录索引或列目录的后端调用。

## 边界假设（本 worker 的取值，评审可改判）

| 输入形态 | 处置 | 理由 |
|---|---|---|
| `notes`（vault 内目录，无尾斜杠） | 目录语境，候选 = 直接子级文件 | 既有 `dir` 判决直接带出 |
| `notes/`（尾斜杠，`notes` 是目录） | 同上（筛选与提示）；Enter 沿用既有候选打开行为，不改成功路径 | 尾斜杠是用户对「这是目录」的显式声明；只收窄筛选范围，不重写 Enter |
| `notes/`（`notes` 不存在 / 是文件） | 不进入目录语境，按既有非法 / 找不到口径 | 不凭空造目录提示；文件路径 + 尾斜杠不打开文件 |
| `/tmp/x/`（vault 外目录，尾斜杠） | 不进入目录语境，按找不到处置 | 本能力没有外部目录列举；外部路径仍是「尝试入口」，目录原因由 Enter 后的读取结果给出 |
| `/tmp/x`（vault 外目录，无尾斜杠） | 保持既有「尝试入口」；Enter 后提示是目录 | 既有外部打开语义，不在本 change 改动 |
| `/v/`、`/`（vault 根 / 根斜杠） | 不进入目录语境，按既有非法处置 | 既有 spec 把 vault 根自身按无效处置；列根目录不在本能力内 |
| `notes/plan.md/`（文件 + 尾斜杠） | 不进入目录语境，按找不到处置 | 尾斜杠断言的是目录，不是「去尾斜杠再打开文件」 |
| 大小写不一致的目录（`NOTES/` 而实际是 `notes`） | 不进入目录语境 | 目录判定复用 `FileTree.hasDir` 的逐字口径；不另做折叠，避免与文件索引的折叠语义分叉 |
| 惰性目录（未进树模型，如未展开的 `dist/`） | 目录语境不成立，按既有非法 / 找不到处置 | `isDir` 只认树模型里的目录条目；为它新增后端列目录能力超出本 change（本能力仍不做目录浏览） |
| 目录里的子目录 | 不出现在候选里 | 候选只覆盖文件索引（既有 spec）；打开目录本身不在本能力内 |
| 目录存在但只有更深文件 / 子目录 | 候选为空；提示「没有直接子级文件」+ 既有空态 | 用户要能区分「目录是空的」与「输入拼错了」 |

## Non-goals

- 不做目录浏览（dired）：不展开、不改树、不提供进入下一层的动作。
- 不做目录 / 文件补全、不新增模糊匹配或第二套候选匹配实现。
- 不新增后端命令（不列目录、不探测目录），目录判据复用既有 `isDir`。
- 不改候选渲染上限、排序、高亮与索引来源。
- 不改编辑器内 `⌘A` 的行为与键位表；不改其它文本编辑快捷键。

## Impact

- **影响的 specs**：`quick-open` 一条 ADDED（输入面内的全选）+ 两条 MODIFIED（候选列表与匹配
  语义：目录语境；结果区与 Enter 的判决同源：两段式限定为裸目录，尾斜杠沿用候选打开）。
- **产品代码**：`src/quick-open.ts`（判决带出 `directory`、直接子级候选、提示与 Enter 分支、
  `⌘A` 接管）、`src/copy-data.ts` + `文案-Copy.md`（D943–D945）。
- **测试**：`tests/unit/quick-open.test.ts`（目录语境与直接子级纯函数）、
  `tests/visual/scenes/quick-open.spec.ts`（⌘A、目录直接子级、尾斜杠、中文长路径、不存在目录、
  Enter 不回归）。
- **真机验收**：新增 `scripts/acceptance/scenarios/230d-quick-open-select-all-dir-children.md`
  （随本 change 入库；本 worker 不跑真机，读数留待批次收尾）。
