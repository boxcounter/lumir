# Proposal: Harness 阅读排版与任务信息可读性

- Change ID: `refine-harness-typography-nov23`
- 日期: 2026-11-23
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> 节点状态：产品 CSS、Chromium 场景与真机截图说明已实现，§8.2 九张矩阵及空态候选已采集；
> 完整视觉门禁因 §8.3 的 m347 / m440 / m454 出现非预期差异而中止，§8.1 既有 actual 仅采到 3/7。
> 正式视觉基线未更新，八场景真机复跑由主会话串行执行，change 尚未归档。
> 节点 1（提案评审）：**已批准**——Alex 2026-11-24 回复「批准」，采用 `refined-rows-720` 及
> D1–D7 推荐值。候选像素基线生成后仍须 Alex 逐张过目；未获明确批准前 MUST NOT 执行
> `--update` / `--update-snapshots`，也不得把候选图转成正式基线。
>
> r1 独立评审（绑定 `ac61e836`）判 needs-changes；返修拆分面板 / 全屏表格字号合同，补齐三项 change
> 的有序链，并将 152 的既有 test-only 修复改为前置复用，不重复实现。r2 独立复审
> clean/ready-for-Alex，绑定 `0b4b85a2`。施工仍受前置链约束：审批可见性未归档前不得实现。

## Why

现行 Harness 正文为 13px/1.5，transcript 外侧仅 8px，消息间距 8px。长回答里的段落、列表、代码与工具
边界挤在一起；宽 pane 又把同一行拉到 1048.5px。与此同时，批准依据、工具尾注、运行提示和 composer
placeholder 使用 `--text-3`，实测对比度最低只有 2.252:1，承载任务信息的文字被当成了装饰性 meta。
全网格表格在窄 pane 与 eink 下进一步增加视觉噪声。

实地报告 `.local/reports/harness-typography-nov23/README.md` 比较了五个候选，推荐
**`refined-rows-720`**。它不是凭空选型：Chromium 采集了 3 种宽度 × 3 主题 × 5 候选共 45 组、195 张
PNG，并记录计算样式、几何、滚动与对比度；最终候选的实际 CSS 在同目录 `probe.spec.ts` 的
`READING_CSS` / `ROWS_CSS` / `MEASURE_CSS` / `REFINED_CSS`，原始读数在 `metrics.json`。

证据边界必须保留：

- Chromium 的 45/45 组候选均无 transcript 横向溢出，代码可在自身容器横滚；这些证明候选在 Chromium
  合成 fixture 上成立，不代替实施后的 WKWebView 验证。
- 真机八场景跑的是**现行产品，未注入候选 CSS**。runner 原始结果为 **7/8 PASS、1/8 FAIL、退出码 1**，
  不得写成 8/8。
- 唯一 FAIL 是 152 的两条时间断言。实际 AX 把角色与时间拆成相邻节点（`你` + `· 3秒前`，`Agent` +
  `· 3秒前`），截图与 AX 都证明读数在场；失败是连续字符串正则与 WKWebView AX 节点粒度不匹配，不是
  “恢复后没有时间”。既有分支 `test/harness-transcript-time-ax-nov23`（tip
  `ede07e8400f30f6418385ea2718847a02afecaf4`）已完成 test-only 修复并合并推送 master：K3 clean/merge，
  quick `GATE RESULT: 13/13 PASS（SKIP 0）`，最终真机 152 PASS（17.5s，证据
  `.local/acceptance/2026-11-24-harness-time-ax-final/`），docs CI `45215746792` success。本 change 只复用
  该前置，不重复实现。

## What Changes

对应 `specs/harness/spec.md` 的四条 ADDED 与一条 MODIFIED：

1. **阅读密度与消息节奏**
   - transcript 正文改为 15px/1.58，外侧 padding 为 `16px 16px 12px`，消息间距为 16px。
   - 普通块间距 8px并收掉首末块外边距；列表缩进 24px、相邻项上距 2px、项内段落 4px。
   - 用户气泡 padding 改为 8/12px；气泡底色、边框、圆角、正文色与 ≥7:1 对比度不变。
   - 角色行仍 10.5px，下距改 4px；角色取 `--text-2`，时间继续取 `--text-3`。
2. **720px 左对齐阅读宽**
   - transcript 的直接消息子项增加 `max-inline-size: var(--layout-review-measure)`（720px）。
   - 它是消息上限，不是固定宽：窄 pane 仍占满可用阅读宽，宽 pane 不居中、不右对齐。
   - 同一 fixture 下，正文宽目标为窄 448.5px、宽 720px、超宽 720px；调研中无上限候选分别为
     448.5px、748.5px、1048.5px。
3. **代码与横线表**
   - 代码块保持 12.5px/1.55，padding 改 10/12px、圆角改 `--r8`；局部横滚、细条、复制与全屏行为不变。
   - **仅 Harness 面板内的表格**改 13px/1.5、cell 6/10px；只留横线，表头用 `--border`、数据行用
     `--border-soft`。
   - 全屏快照继续消费 `--editor-font-size`（默认 15px）及其既有缩放语义，不套用面板 13px 字号；全屏专属
     布局、快照内容、固有宽与开关行为不变。共享 th/td 的横线和 6/10px padding 可随克隆进入全屏，但面板 /
     全屏断言必须分开。
   - 保留固有宽、cell 单行、局部横滚、嵌套收缩和全屏入口，不改 stacked cards。
4. **工具与批准决策区**
   - 工具行保持 12px，由固定 24px 高改为 `min-height:28px; height:auto`；参数省略与终态词保护不变。
   - 批准卡 padding 改 10/12px，决策段间距 8px；批准按钮 `min-height:32px`、水平 padding 12px。
   - 长次级动作允许既有换行，命令原文仍在自己的局部滚动区完整可达。
5. **composer、空态与任务型次级文字**
   - composer 外侧 padding 改 `12px 16px 16px`，输入为 15px/1.58、最小高 48px、padding 10/12/4px；
     placeholder 的 top/left 同步为 10/12px。
   - 批准副句 / 依据 / 后果、工具尾注、运行提示、placeholder 与空态提示取 `--text-2`；任务型次级
     文字在其实际承载面上的对比度 SHALL ≥4.5:1。时间等刻意退后的 meta 不一律提色。
   - 空态仅改 13px/1.58、`--text-2`、24px padding，不重做布局；运行提示只改颜色，位置与动画不动。
6. **测试与验收**
   - 新增三主题 × 三宽度 Chromium 结构 / 计算属性 / 几何矩阵，并为九组各留一张候选 Harness 元素
     像素基线；更新受旧值约束的现有场景。
   - 更新真机验收场景的排版截图与注释，复跑 86 / 97 / 218 / 234 / 152 / 72 / 711 / 719 八场景。
   - 复用 `test/harness-transcript-time-ax-nov23@ede07e84` 的 152 修复，不改写其 `metaLine` 执行器、单测或
     场景判据；前置合并后复跑，最终报告只照抄当次 runner 的真实计数与退出码。

所有字号继续乘 `--lumir-hp-scale`，间距、圆角、颜色与阅读宽全部复用现有 token。没有新配置项、新色彩、
新字号状态或第二份 720px 字面值真源。

## 前置与后续顺序（硬门禁）

三项 change 的顺序固定为：

`fix-harness-approval-visibility-nov23` → `refine-harness-typography-nov23` →
`move-harness-progress-to-output-tail-nov23`。

- **本 change 施工前**：`fix-harness-approval-visibility-nov23` 必须已归档且 `--archived` 审计 PASS。
  前置阶段行先保持 `--text-3`；本 change 归档后才升为 `--text-2`。152 分支
  `test/harness-transcript-time-ax-nov23@ede07e84` 也必须先合并或同批并入施工基线。任一前置未满足，
  本 change 不得施工。
- **本 change 落地时**：只改当前位置的阶段行颜色，transcript gap 改为 16px、padding 改为
  `16px 16px 12px`；空态仍沿用当前 `margin:auto` 居中，不执行后续绝对定位。
- **尾行 change 施工前**：本 change 必须已归档且 `--archived` 审计 PASS，新视觉基线已经 Alex 批准并落盘。
  尾行 change 必须以新的 living spec / CSS / 基线重基线，不得恢复 `--text-3`、旧 8px gap 或旧空态配方。
- **尾行几何承接**：若仍取 2px 尾行净间距，旧 `calc(var(--sp-2) - var(--sp-4))` 必须改为
  `calc(var(--sp-2) - var(--sp-8))`。空态改为绝对定位时，四边必须随新 transcript padding 写成
  `top/right/left:var(--sp-8); bottom:var(--sp-6)`，并继承 13px/1.58、`--text-2`、24px padding；
  不得沿用旧 `8/8/4px` 偏移。其“idle 零漂移”只相对本 change 后的新 idle 基线成立。

## Non-goals

- **不移动进度区**：进度区位置与信息架构归后续 `move-harness-progress-to-output-tail-nov23`；本 change
  只把现有阶段提示提到 `--text-2`，不改位置、进度条、动画、空态定位方式或运行态交互。
- **不重写滚动**：不改 transcript 跟随 / 脱离、回到底部、原生 overlay、代码 / 表格 / diff / argv 的局部
  横滚机制，不新增滚动容器或 `overflow` 轴。
- **不把 pane 或 composer 固定为 720px**：720px 只作用于 transcript 的直接消息子项；pane 继续随分栏伸缩，
  composer 继续铺满面板可用宽。
- 不改用户气泡为右对齐或窄气泡，不重改气泡配色；不把正文、代码或表格改成居中阅读列。
- 不改链接打开、复制、全屏、批准、重试、工具折叠、composer 编辑与发送等现有交互。
- 不改全屏快照的 `--editor-font-size` 字号真源、缩放语义或全屏专属布局；不把面板 13px 表格字号扩散到全屏。
- 不重复实现 152 的 `metaLine` 执行器、单测或场景判据；该修复只消费既有前置分支。
- 不改编辑器 / 文档预览排版、`ui.content_width`、配置 schema、Rust 后端或会话留存格式。
- 不用全局 `overflow-wrap` 取消表格固有宽，不为 eink 增加更多边框分组，不调整视觉容差。

## Impact

- 影响的 specs：`harness`（ADDED ×4；MODIFIED「消息呈现」×1）。活跃期不改 living spec。
- 实现期代码面：`src/harness-panel.css`；产品 TS / Rust 不需要改动。若实施发现必须改 TS 才能满足本合同，
  先回写 proposal / design 并送裁，不静默扩 scope。
- 测试面：新增 `tests/visual/scenes/harness-typography-nov23.spec.ts`；按旧计算样式值更新
  `m351-harness-visual-fidelity.spec.ts` 与必要的表格场景；更新 `scripts/acceptance/scenarios/` 的既有
  排版相关场景。152 的 AX 执行器与场景修复不在本 change 改动面，只复用前置分支。
- 像素基线：7 张既有基线预计变化，9 张矩阵基线为新增候选；相邻的标题栏、浮层、引用 / 图片卡和警示块
  元素基线不应变化。逐张清单与“不应变化”清单见 `design.md` §8。
- 真机：152 前置修复已合并推送 master，且最终单场景 PASS（17.5s）；排版实施后仍须复跑同一组八场景。
  原始调研证据保持 7/8 PASS、退出码 1；前置单场景 PASS 不替代本 change 的八场景复验，只有实际复跑后
  才允许记录新的通过数，任何情况下不得预写 8/8。
- 关联约束：`typography` 的双内容面共享缩放比；`harness-table-horizontal-scroll-oct24` 的固有宽 / 局部
  横滚；`improve-harness-streaming-scroll` 的阅读位置保护；`ui-design-system` 的 token 与滚动条分档；
  `tests/visual/README.md` 的 Alex 基线过目纪律。

## 节点 1 裁决点

| # | 裁决点 | 推荐 | 备选 / 代价 |
|---|---|---|---|
| D1 | 是否采用整套 `refined-rows-720` | 整套采用，避免只取 15px 而留下低对比任务文字和全网格表 | 分批采用会延长两套节奏并存，且报告中的几何结论不再对应同一组合 |
| D2 | 720px 的作用域 | 仅 transcript 直接消息子项，左对齐、非固定宽 | pane / composer 同宽会浪费宽屏操作面；居中会改变稳定阅读起点 |
| D3 | 表格形态与全屏边界 | 面板采用横线表 13px/19.5px；全屏保留 `--editor-font-size`（默认 15px）与现有布局，只共享横线和 cell padding；分别断言 | 把全屏也写成 13px 会与实际克隆作用域和编辑器缩放合同冲突；全网格 / stacked cards 不采用 |
| D4 | 任务型次级文字 | 指定六类与空态提 `--text-2`，时间仍 `--text-3`，对比度 ≥4.5:1 | 全部 meta 提色会抹平信息层级；维持现状最低仅 2.252:1 |
| D5 | 新矩阵像素基线 | 九组各新增一张 Harness 元素基线，先生成候选、Alex 逐张批准后再生效 | 只做结构断言会漏掉实图观感；直接更新则绕过基线人肉裁决点 |
| D6 | 152 的处置 | 复用 `test/harness-transcript-time-ax-nov23@ede07e84` 已合并前置修复，不重复实现；最终前置单场景 PASS 已成立，排版实施后按真实八场景 runner 结果报告 | 重写会产生第二份 AX 执行器；不把原始调研 7/8 PASS 或前置 152 单场景 PASS 混写成本 change 八场景 8/8 |
| D7 | 三项 change 的顺序 | `fix-harness-approval-visibility-nov23` → 本 change → `move-harness-progress-to-output-tail-nov23`；前后置未归档不得施工，后落者按新几何与新基线重算 | 并行施工会恢复旧阶段色、旧 gap 和旧空态偏移，并混淆基线归属 |
