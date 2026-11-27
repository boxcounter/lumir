# Proposal: 按住 Command 时显示当前 pane 的标签序号

- Change ID: add-tab-dynamic-numbering-nov27
- 日期: 2026-11-27
- 角色: Alex Lee（评审/裁决），AI agent（起草与实现）

## 节点 1：提案批准

Alex 已对「按住 ⌘ 时在既有标签上叠加小号序号」方案明确回复「做」。本 change 只实施该已批准方向；具体像素候选仍须 Alex 过目，不据此自行更新正式视觉基线。

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
| implemented | 是：实现已提交，未合并 | `8e4966821cd68c31c3b61f72cbfe69bf62c57b51` |
| released | 否：本批不打包 | 不适用 |
| machine PASS | 是：目标测试与 quick 通过 | `GATE RESULT: 13/13 PASS（SKIP 0）`，退出码 0；前端 2200/2200、相关浏览器结构 17/17、验收执行器 131/131、驱动 27/27、OpenSpec 39/39；日志 `/Users/boxcounter/Code/Boxcounter/lumir/.local/reviews/tab-dynamic-numbering-nov27/` |
| native PASS | 否：真机由主会话统一执行 | 待 14-tabs 的 status.txt |
| archived | 否：待归档 | 本任务不归档 |
