# Proposal: 光标宽度恢复 CodeMirror 默认（推翻 2026-10-23 的 2px 加粗）

- Change ID: `restore-default-caret-width-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（裁决、节点 1），AI agent（起草）

> **节点状态（先读这一段）**
>
> - **节点 1 已批准**（Alex 2026-11-23，回话「按推荐」；本批三项一次覆盖）。C1–C3 逐条落值见
>   下方裁决点表，批准值与推荐值一致。
> - `tasks.md` 只勾「节点 1 已批准 / 批准值已落制品」两项；全部实现与验证项未勾，本 change
>   尚未进入实现。
> - 本 change 只到提案层：living spec 的改动以 delta 留在本目录，归档时并入，不提前改写。
> - 这是对 2026-10-23 已归档裁决（change `cursor-visibility-oct23` 的 D2 加粗部分）的**正式
>   推翻**；改裁记录写进 requirement 本体，后续不得以「再粗一点更显眼」回潮。

## Why

### 现状：应用只该覆盖颜色，却同时覆盖了宽度与居中

| 事实 | 位置 |
|---|---|
| 光标样式覆盖：`borderLeft: 2px solid var(--text)`、`marginLeft: -1px` | `src/editor.ts:2186` |
| CodeMirror 基础主题默认：`border-left: 1.2px solid black`、`margin-left: -0.6px` | `node_modules/@codemirror/view/dist/index.js`（`baseTheme` 的 `.cm-cursor` 规则） |
| 现行规格把 2px 写成组件常量 | `openspec/specs/ui-design-system/spec.md` 的「编辑器光标视觉」；`docs/specs/design-tokens-v1.md` 的「阴影与 hairline」；`docs/specs/editor-caret.md` 的「实现落点」 |
| 现行机器判据钉死 2px / -1px | `tests/visual/scenes/m647-caret-geometry.spec.ts:485`、`:487` |
| 真机场景标题与覆盖表也写着 2px | `scripts/acceptance/scenarios/228-caret-visibility.md:5`、`:83`、`:119`、`:157`；`scripts/acceptance/COVERAGE.md:208` |

颜色覆盖是必要的：CM 默认 `black` 在 dark 主题下不可见。宽度与居中覆盖则不是——CM 自己的
1.2px / -0.6px 本来就是一对自洽值。

### 三次反馈，方向相反

1. **2026-10-23**（change `cursor-visibility-oct23` 的 D2）：Alex 反馈光标太细；应用从「只覆盖
   颜色」改为 2px 宽度 + `-1px` 居中。
2. **2026-10-24**：Alex 反馈 #6 原话「光标可见性调地有些过头了 —— 现在光标不闪了，也不容易
   一眼扫到」；那次只改判闪烁（恢复 1.2s），宽度保持 2px。改裁记录在 living spec 的
   requirement 内与 `docs/specs/editor-caret.md`。
3. **2026-11-23**（本 change）：Alex 裁决「按推荐」——三主题统一恢复 CM 默认宽度与居中，
   保留 `--text` 颜色与闪烁。2px 是前两次调整里唯一没有在后续反馈中留下正向理由的部分；
   eink 下它还把光标推到强调线宽的上限，与「恢复默认」的取向冲突。

### 判据要说准

1.2px 是**亚像素线宽**，不能拿「数截图像素」当权威判据（DPR 与抗锯齿会把 1.2px 落成 1 或 2
个设备像素）。**实现期校正（2026-11-23）**：起草时写的「权威判据是
`getComputedStyle(.cm-cursor-primary)` 的 `borderLeftWidth` = `1.2px`」在本仓的 chromium 口径下
不成立——渲染引擎会把亚像素 `border-width` 取整到整数 CSS 像素，Chromium DPR=1 下 `1.2px`
读回 `1px`（`1.5` / `1.6px` 同为 `1px`，`2px` 仍是 `2px`），`marginLeft` 不取整。因此判据改为
两路：① CSSOM 里匹配光标的 `border-left-width` 声明恰为 `1.2px`（作者值，本仓不写覆盖）；
② `borderLeftWidth` 计算值落在 `1px` / `1.2px` 档且 MUST NOT 为 `2px`；`marginLeft` 计算值钉
`-0.6px`。实测记录见 `.local/missions/caret-default-nov23/`，细节见
[design.md](design.md) 的 F2a 与 §3.1。

## What Changes

1. **代码**：`src/editor.ts` 的 `.cm-cursor, .cm-dropCursor` 覆盖缩到只剩颜色
   （`borderLeftColor: "var(--text)"`），删除 `borderLeft` 宽度与 `marginLeft`；宽度 / 居中还给
   CM 基础主题。`src/editor.ts:2168-2185` 的注释按三次改裁改写。
2. **规格**：`ui-design-system` 的「编辑器光标视觉（粗细 / 颜色 / 闪烁）」整条 MODIFIED——
   宽度改 1.2px、居中改 -0.6px、eink 同值；增一条反向判据场景（`borderLeftWidth` MUST NOT 为
   `2px`）。
3. **文档清扫**（同一语义的多处副本）：`docs/specs/editor-caret.md`、`docs/specs/design-tokens-v1.md`
   的组件常量登记、`scripts/acceptance/scenarios/228-caret-visibility.md` 与 `COVERAGE.md` 的
   「2px」表述。REVIEW.md「同一语义两处真源」条：只改一处不算完成。
4. **机器判据**：`tests/visual/scenes/m647-caret-geometry.spec.ts` 的三主题用例改为
   声明值 `1.2px` / `marginLeft` `-0.6px`，新增「声明列表 = `["1.2px"]`」与计算值
   `!== "2px"`、`marginLeft !== "-1px"` 的反向断言（计算值取整口径见上文「判据要说准」）。

## 节点 1 裁决点（已批准）

| # | 裁决点 | 推荐值 | 批准值 | 备选 / 代价 |
|---|---|---|---|---|
| **C1** | eink 是否同值 1.2px | **同值 1.2px**（三主题一致） | **同值 1.2px** | eink 保留 2px：三主题分叉，且「恢复默认」只恢复一半；eink 可发现性改由闪烁承担 |
| **C2** | 是否接受 1.5px 折中 | **不接受**（不是默认值） | **不接受** | 1.5px：介于两次反馈之间，但既非默认也未被任何一次反馈指名，会把「三次改裁」变成第四次自定义值 |
| **C3** | 改裁如何留痕 | **写进 requirement 本体 + 清扫全部 2px 副本** | **同左** | 只改代码不改文档：下一位 agent 会照旧文档再翻回 2px |

## Non-goals

- **不把颜色恢复成 CM 默认 `black`**：dark 主题下黑线不可见；`--text` 是必须保留的覆盖。
- **不改闪烁**：1.2s、CM 原生 `cm-blink`、半程 `opacity: 0` 全部不动；2026-10-24 的闪烁改裁
  继续有效。
- **不改光标高度、选区、`drawSelection` 装配、行盒几何**；不新增 token、不新增组件常量。
- **不 fork / patch CodeMirror 基础主题**；不升级 CM 版本。
- **不做 1.5px 折中**，不在 eink 单独保留 2px。
- 不改 `editor-caret` 的 C1–C6 行为条款（frontmatter 边界、列表行、块级 widget 等）；本 change
  只动视觉取值。

## Impact

- 影响的 specs：`ui-design-system`（1 条 MODIFIED）。
- 影响的代码 / 系统：
  - `src/editor.ts`：主题覆盖一行 + 注释；无 API、无命令、无配置。
  - `tests/visual/scenes/m647-caret-geometry.spec.ts`：三主题计算样式断言 + 反向断言。
  - `docs/specs/editor-caret.md`、`docs/specs/design-tokens-v1.md`：取值与登记改准。
  - `scripts/acceptance/scenarios/228-caret-visibility.md`、`scripts/acceptance/COVERAGE.md`：
    标题与说明里的「2px」改准；场景步骤与断言不变（AX 读不到线宽，线宽只作截图观感证据）。
- 关联约束：
  - 本 change 不动文档内容、不产生写盘，ADR 0003 铁律不受影响。
  - 性能合同无关：只改一条 CSS 声明，不进入按键路径。
  - 视觉基线：光标是瞬态装饰，整页基线通常不包含光标；若本地 `gate.sh visual` 出现像素差异，
    先定位再决定，`--update` 属 Alex 人肉裁决点。
- 仓库信息卫生：视觉 fixture 与验收场景只用合成文档名 / 内容。

## 与 ADR 的关系

不需要 ADR：只改一个 capability 的视觉取值，不推翻技术选型、不改分层。2026-10-23 的 2px 曾是
一次已归档的产品裁决而非架构决策，本 change 以 OpenSpec delta + 改裁记录承接即可。

## 节点 2（归档前材料已齐；merge / archive 待执行）

> 状态：**已归档**（2026-11-23）。实现已合并推送，归档提交 `546501f7`；包装器输出
> `Totals: + 0, ~ 1, - 0, → 0`，归档后修链 0 处（4 篇 Markdown / 4 条相对链接），相对链接门禁 PASS；
> `node scripts/openspec-archive-check.mjs --archived restore-default-caret-width-nov23` PASS
> （1 条 MODIFIED / 10 段；人工恢复 0 段，声明认领 0 段）。

### 要件 1 — 方案已批准

- 节点 1：Alex 2026-11-23 回话「按推荐」，C1–C3 全部采用推荐值（宽度 1.2px、居中 -0.6px、
  light / dark / eink 三主题同值），记录见本文件「节点 1 裁决点」与节点状态块。
- 实现期无静默扩 scope：产品行为未变（只撤宽度 / 居中覆盖，`--text` 颜色与 1.2s 闪烁保留）。
  唯一改动是**判据读法的实现期校正**——`getComputedStyle` 的 `borderLeftWidth` 在 Chromium
  DPR=1 下把 1.2px 取整为 `1px`，故 m647 改为「级联声明 = 1.2px + 计算值非 2px」两路；记录见
  本文件「判据要说准」、design F2a 与 `docs/specs/editor-caret.md` 验证层表格。

### 要件 2 — 独立 reviewer clean / merge

- verdict：**clean / merge**（独立 reviewer，非作者）。
- 评审 tip：`c9fd7d06`（`fix(editor): restore default caret width across themes`）。
- 评审记录：结论由 tower 会话转达；本仓 `.tower/comms/reviews/` 截至 2026-11-23 无该 change
  的 review 文件副本（`.tower/` 不入 git）。评审 tip 之后的改动仅为本节点材料与 tasks 勾选
  （docs-only，不改实现），实现面仍与评审 tip 一致。

### 要件 3 — tasks 完成或有放弃理由

- `tasks.md` 40/40 勾选。合并时的归档队列条目已落并在归档后清空；独立评审 clean/merge，归档提交与 `--archived` 审计结果见上方状态块。
- 6.9（独立评审 + 五要件对账）已随本次材料补勾。

### 要件 4 — 门禁与真机证据通过

- `scripts/gate.sh quick`：`GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0。
- `scripts/gate.sh visual`：`GATE RESULT: 15/15 PASS（SKIP 0）`，退出码 0；视觉套件
  1258 passed / 1 skipped / 0 failed，逐张像素比对无差异，基线未更新（无需 `--update`）。
- 真机 228：`PASS 47.8s`（28 断言 / 0 失败，light + eink）。**228 只作行为 / 观感证据**：
  它判属性盒显露与恢复、doc-title / 正文点击零写盘，**不读线宽**；「够不够显眼」与 eink
  残影 / 闪烁观感归 Alex 手感项，不进机器判据（宽度判据在 m647 的计算样式 / CSSOM 读数）。
- 证据：`.local/missions/caret-default-nov23/`（红绿、margin 探针、2px 变异必红、取整探针、
  quick / visual 全文、视觉逐条日志）与 `.local/acceptance/2026-11-23-caret-default/`
  （summary.md、shots、ax）。

### 要件 5 — 规格对账无丢段（归档前读数）

- `node scripts/openspec-archive-check.mjs`（门禁模式）：**PASS**——「扫过 9 份 delta，8 条
  MODIFIED，对比 119 段，无静默丢段；归档队列 0 项已完成 change 均有唯一条目」。
- `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`：`Totals: 37 passed,
  0 failed (37 items)`。
- 归档跟踪队列：本 change 尚未合并（任务 6.8 未勾），机器门禁对未完成任务项的 change 不判队列
  （本轮 `checked = 0`）；合并时由 tower 落唯一一条条目后复跑 docs-check。

### 归档后（待执行）

归档提交 hash、包装器（`openspec archive`）实际输出、修链读数与 `--archived
restore-default-caret-width-nov23` 的 PASS 时间，待 merge + archive 后追加。
