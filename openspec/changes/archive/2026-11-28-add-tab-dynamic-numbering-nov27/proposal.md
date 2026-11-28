# Proposal: 按住 Command 时显示当前 pane 的标签序号

- Change ID: add-tab-dynamic-numbering-nov27
- 日期: 2026-11-27
- 角色: Alex Lee（评审/裁决），AI agent（起草与实现）

## 节点 1：提案批准

Alex 已对「按住 ⌘ 时在既有标签上叠加小号序号」方案明确回复「做」。本 change 只实施该已批准方向。候选完成后 Alex 明确回复「按候选」，批准三主题、窄 pane、长名称、1/9/>9 标签与双 pane 的候选形态；未更新正式视觉基线。

## Why

既有 `⌘1`…`⌘9` 已能直达当前 pane 的前九个标签，但按住快捷键前看不到标签与数字的对应关系。设计与真实 WKWebView 探针见 `.local/reviews/tab-navigation-keys-nov27/cmd-digit-numbering-design.md`：Meta 的 keydown/keyup 可到达 DOM，窗口 blur 可兜住 ⌘Tab 切走时丢失的 keyup。

## What Changes

- 按住左或右 Command 时，当前活跃文档 pane 的可见标签按 `visibleTabsOf` 顺序叠加序号 1–9；第 10 个起不显示直达序号，`⌘0` 不增加行为。
- 松开 Command、窗口 blur、页面进入 hidden、标签实例销毁时立即撤下序号；按住期间切换标签、开关 pane、增减标签后仍按当前状态重算。
- 序号是绝对定位的视觉装饰，带 `aria-hidden="true"` 且不接收指针事件；不改变标签宽度、tabstrip 滚动位置、内容布局、文档、既有快捷键或点击/关闭行为。
- 新增浏览器行为与几何回归，以及真机按住/松开截图场景和覆盖表检查。

## Non-goals

- 不新增、重绑或删除任何命令；不实现 `⌘0`、`⌘10` 或序号点击动作。
- 不改变既有 `⌘1–9`、点击、⌘点击、关闭、dirty、read-only、读屏名与焦点语义。
- 不替换关闭钮外观，不引入常驻编号、tooltip 快捷键、新设置项或原生状态通道。
- 不夹入尚未合并的方括号/Shift 符号修复；后续按 master 集成。
- 不在本任务更新正式视觉基线、运行真机、合并、推送或归档。

## Impact

- 影响的 specs：`multi-tabs`（新增按住 Command 的序号提示 requirement；活跃期不改 living spec）。
- 影响的代码/系统：标签 DOM 与样式、活跃 pane 的只读注入、前端单元/浏览器回归、真机验收场景与安全修饰键通道。
- 关联约束：序号是瞬态表现，不读写源文档；三主题、窄 pane、长名称、1/9/>9 标签须留候选证据；Alex 过目前不得更新正式基线。

## 节点 2：归档记录（实现完成后填写）

口径见 `docs/process/openspec-workflow.md`「状态分列」与「失败与 finding 归类」；五要件与归档后强制完成步骤照 workflow 正文逐条填写。

| 状态 | 值 | 证据指针 |
|---|---|---|
| implemented | 是：实现已提交，未合并 | 最终 `c7f9a3de8afd023fb7764fddecc6decb8a737bc0` |
| released | 否：本批不打包 | 不适用 |
| machine PASS | 是：quick 与完整 visual 通过 | quick `GATE RESULT: 13/13 PASS（SKIP 0）`、退出码 0；完整 visual `GATE RESULT: 15/15 PASS（SKIP 0）`、退出码 0（`gate-visual-final-r2.log`）；前端 2201/2201、相关浏览器 37/37、验收执行器/驱动 159/159、OpenSpec 39/39 |
| native PASS | 是：14-tabs PASS 60 断言 | `/Users/boxcounter/Code/Boxcounter/lumir/.local/acceptance/2026-11-28-tab-dynamic-numbering/evidence/14-tabs/status.txt`；`evidence/summary.md` 记录 60 断言 / 0 失败 |
| archived | 是：包装器归档与 `--archived` 审计均通过 | 归档提交 `a07586fc87b036183f7c2effbb1b4e85a649e559`；审计原文见下节 |

### 归档前五要件

1. **方案已批准**：节点 1 Alex 原话「做」；视觉候选原话「按候选」。实现期两项 K3 P2、监听合同 P3 与视觉合同返修均未扩范围。
2. **独立 reviewer clean / merge**：`independent-review-final-p3.md` 对最终 `c7f9a3de8afd023fb7764fddecc6decb8a737bc0` 判 clean/merge，P1/P2/P3=0。
3. **tasks 完成**：实现、返修、完整 visual 与真机项全部勾选；归档及 `--archived` 审计在本记录后续执行。
4. **门禁与真机证据**：quick 13/13、完整 visual 15/15、native 14-tabs 60 断言，均退出码 0；证据路径见五态表。
5. **规格对账**：delta 仅 `multi-tabs` 1 条 ADDED；归档前 `node scripts/openspec-archive-check.mjs`、OpenSpec strict validate 与归档队列唯一性检查通过。`docs/backlog.md` 保持 80 行，队列仅一条本 change 记录。

### 归档后强制完成记录

- 归档提交：`a07586fc87b036183f7c2effbb1b4e85a649e559`。
- 包装器：`multi-tabs: update`，`+ 1 added / ~ 0 / - 0 / → 0`；归档目录 `openspec/changes/archive/2026-11-28-add-tab-dynamic-numbering-nov27/`；修链 0 处（4 篇 Markdown / 0 条相对链接），`openspec-links: PASS（校验 716 条相对链接，全部可达）`。
- 归档后 validate：38 passed / 0 failed；docs-check PASS；backlog 维持 80 行。
- `--archived` 审计原文：`openspec-archive-check: PASS（openspec/changes/archive/2026-11-28-add-tab-dynamic-numbering-nov27：0 条 MODIFIED，对比 0 段；人工恢复 0 段，声明认领 0 段）`，退出码 0。
