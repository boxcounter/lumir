# Proposal: 行号 gutter 右键复制 `{path}:{line}`

- Change ID: `gutter-copy-path-line-nov21`
- 日期: 2026-11-21
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**通过**——来源是 Alex 2026-11-21 的原始需求「行号 gutter 右键复制
> `{path}:{line}`」，并以「请你继续」批准推进；本提案按这条原话的最小读法落地，实现期未新增
> 其它产品行为（不加键位、不加菜单项）。
> 节点 2（归档放行）：**机器 + 独立评审放行**（[openspec-workflow.md](../../../../docs/process/openspec-workflow.md)
> 「节点 2：归档默认由独立评审 + 机器判据放行」五要件），逐条事实与证据指针见下「节点 2 记录（归档前）」。

## 节点 2 记录（归档前，2026-11-21）

口径见 [openspec-workflow.md](../../../../docs/process/openspec-workflow.md)「节点 2」，五要件逐条：

1. **方案已批准**：节点 1 于 2026-11-21 通过——Alex 原始需求「行号 gutter 右键复制
   `{path}:{line}`」+「请你继续」批准推进（见上方「评审记录」）。实现期没有静默扩 scope：
   产品增量对应「What Changes」五条（`src/gutter-copy.ts`、`src/editor.ts` 的 gutter
   `domEventHandlers`、`src/main.ts` 的剪贴板与 toast、`src/copy-data.ts` 的 D947），未加键位 /
   右键菜单 / 配置项。r1 评审 P2-1/P2-2/P2-3 与 P3 的返修（`reportCopyFailure` 收敛、证据复制、
   场景 707 与 D947 取号）都在既有意图内，未改行为约定。
2. **独立 reviewer clean / merge**：独立 reviewer agent-36 判 `clean/merge`，无 P1 / P2 findings，
   绑定 integration tip `7d632e03e09fa11aa50f298d43db8d76c33aedc9`；评审文件
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/editing-batch-nov21/review-final.md`。
   当前分支 tip 与该评审 tip 相同。
3. **tasks 完成**：`tasks.md` 25/25 全勾（`grep -c '^- \[x\]'` = 25，未勾项 0），无放弃项。
4. **要求的门禁与真机证据**：动过 `tests/visual/scenes/**`（新增
   `gutter-copy-path-line.spec.ts`），按 `scripts/gate.sh visual` 档取读数——
   `GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0（含整页 / 元素像素层）。任务 5.3 记录的 m281
   两条整页像素基线差异属本机 CJK 字形环境差异，后随 Alex「允许」的 CJK 基线更新一并重截
   （`b514d015`，含 `m281-md-gutter` / `m281-goto-prompt`），本 change 自身未改基线。真机场景
   `707-gutter-copy` PASS（27 断言，0 FAIL；`status.txt` = `PASS`），覆盖 md `always` 与 code
   首行、vault 外绝对路径、含空格与中文的合成路径、剪贴板逐字、文档零写入，证据
   `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-21-requirements-batch/707-gutter-copy/`
   （`steps.md` / `shots/` / `ax/`）。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS——`扫过
   14 份 delta，13 条 MODIFIED，对比 239 段，无静默丢段；归档队列 1 项已完成 change 均有唯一条目`
   （退出码 0）；`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 41
   passed, 0 failed (41 items)`（退出码 0）。归档跟踪队列有且仅有一条本 change 条目
   （`docs/backlog.md`）。delta 是 `keymap-commands` 的 1 条 ADDED，是真实增量，不是纯目录移动。

未命中「必须找 Alex 的例外类别」：视觉基线更新已单独获 Alex「允许」，无未决的价值 / 行为裁决、
无影响面升级、评审结论与 tip 均无异常、证据无缺口，故不另送 Alex。

## Why

Alex 原始需求（2026-11-21）：「行号 gutter 右键复制 `{path}:{line}`」。

场景：写小说 / 笔记 / 代码时，用户经常要在一个地方引用「某个文件的某一行」（交给 harness、
写进另一篇笔记、或与协作者对话）。Lumir 已有 `:line` 后缀与 `path:line` 的解析语义
（快速打开、harness 路径链接），但**没有从行号 gutter 直接取得这一串的入口**——用户只能先看
modeline 路径、再数行号、再手打，既慢又易错。行号 gutter 是行号唯一的可见面，右键它取
`{path}:{line}` 是最短路径。

本 change 只补这一条手势，不改变行号 gutter 的在场合同、不引入右键菜单、不加键位 / 配置。

## What Changes

1. **md / code 两模式可见行号 gutter 的右键复制**（`keymap-commands` 新增一条 requirement）
   在行号 gutter 的可见面上右键，SHALL 把当前文档路径与指针所在行的 **1-based 源文档逻辑行号**
   以精确形式 `{path}:{line}`（无字面花括号、无空格）写入系统剪贴板。行号口径与 gutter 显示的
   行号一致（`view.state.doc` 的源文档逻辑行，软换行不参与计数）。

2. **路径口径复用既有语义**
   `path` SHALL 取会话的 `path` 原样——vault 内文档是 vault 相对路径（与 modeline / 快速打开 /
   harness 路径链接同一份），vault 外只读文档是绝对路径（沿用既有外部路径语义）。MUST NOT
   重写、补全或规范化路径；MUST NOT 为无路径文档编造路径。

3. **零副作用**
   右键复制 MUST NOT 修改文档内容、选区、dirty、撤销栈、模式、gutter 档位或阅读位置
   （滚动与滚动快照）；MUST NOT 派发文档事务、MUST NOT 移动焦点。只写剪贴板并给反馈。

4. **反馈复用既有机制，失败不假装成功**
   成功 SHALL 复用既有 toast（success tone）并逐字显示复制出去的 `{path}:{line}`；剪贴板不可用 /
   权限被拒 / 无当前文件时 SHALL 给失败 toast 与 console 线索，MUST NOT 显示成功提示。浏览器
   拒绝写入时 MUST NOT 吞掉失败。

5. **gutter 在场合同不变**
   `[ui] markdown_line_numbers` 的 `on-demand` / `always` / `off` 三档与 code 模式恒常显
   MUST NOT 因本 change 改变；右键能力只在 `lineNumbers()` 实际安装、gutter 可见时存在。
   档位为 `off` 或 `on-demand` 且输入条未打开时，没有 gutter、也就没有本手势。

## Non-goals

- 不新增右键菜单 / 菜单项 / 弹层；右键即动作。
- 不新增命令、键位、配置项、modeline 展示或持久化状态。
- 不支持复制行范围（`:起-止`）、列号、绝对路径与相对路径互换、或未保存文档的临时路径。
- 不改行号 gutter 的几何、配色、在场判据与三档语义。
- 不为未命名 / 无路径文档编造路径；这类文档的右键给失败反馈。
- 不引入剪贴板插件或后端命令（沿用 `navigator.clipboard.writeText`）。

## Impact

- 影响的 specs：`keymap-commands`
- 影响的代码/系统：`src/editor.ts`（gutter 右键接线与复制口）、`src/main.ts`（剪贴板写入与
  toast 反馈）、新增 `src/gutter-copy.ts`（拼法与端口类型）、`src/copy-data.ts` +
  `文案-Copy.md`（成功文案 D947；失败复用 D155）
- 关联约束：ADR 0003 第 3 条铁律（不改写源文件）——本 change 只读文档；ADR 0002 第 6 条性能
  合同——右键处理只读当前行号与路径、写一次剪贴板，无序遍历全文；ADR 0006 的 Emacs
  keybinding 定位——本 change 不加键位
