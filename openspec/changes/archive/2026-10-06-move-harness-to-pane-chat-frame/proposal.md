# Proposal: harness 归位 pane 与对话基础框架

- Change ID: move-harness-to-pane-chat-frame
- 日期: 2026-10-06
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

ADR 0008 Decision 8 的 Phase 2 = harness 入 pane + chat UX 重做。第一份提案 `add-harness-quote-cards`（摘录引用卡片 + 消息序列化）已通过节点 1、实现批次在途；本提案是 Phase 2 三份提案的**第二份**（拆法 Alex 2026-10-06 已批准），覆盖「对话基础框架」：harness 从 dock 归位 pane、标题栏与会话入口、composer 控制行、发送/停止、复制消息、进度呈现。

依据（均为已落地的裁决，原文在原型 NOTES.md 与 ADR 0008；原型目录已随 `add-harness-quote-cards` 的实现落地退役，提交 `4e011d6`，NOTES.md 原文见 git 历史）：

- **ADR 0008 已裁待落实**：Decision 1（每个 pane 承载「一组文档标签」或「harness 面板」之一）、Decision 2（⌘⇧A 语义改为「在旁侧 pane 打开/收起 harness」，dock 列与 `.dock-open` 机制移除）、Decision 6（vault-sessions 的 `harness_pane` 字段 Phase 2 消费）。
- **Alex 2026-10-05 三条 UX 点子**（verbatim 在 NOTES 第三轮）：① harness 顶栏并入窗口标题栏；② 产品名 + 版本移到系统按钮旁；③ ctx% 放在编辑框的模型选择那一行。
- **Alex 2026-10-05 追加需求**：上下文使用百分比、新建会话、复制消息（另两条——思考过程、思考程度选择——归提案 3）。
- **原型沿用的已裁形态**：发送钮处理中 = 停止态、agent 进度 = 不定态 + 阶段指示（Alex 问「进度条怎么计算？技术上似乎无法事先知道总时长」——答复即不定态，百分比在技术上是假的）、模型选择放 composer 控制行、harness 默认宽度比 harness:pane#1 = 1:2（Alex 裁决「Harness 默认占 400px 太窄」）。

## What Changes

每条对应 specs/ 增量中的 requirement：

1. **harness 归位 pane，dock 列移除**（`pane-layout` MODIFIED「pane 容器模型」与「分栏态空 pane 不接受文本输入」+ ADDED「harness pane」；`harness` MODIFIED「对话面板」；`keymap-commands` MODIFIED「harness.toggle」；`vault-workspace` MODIFIED「按 vault 持久化 pane 布局」；`ui-design-system` MODIFIED「应用骨架布局」）：每个 pane 承载文档标签组 或 harness 面板之一（上限二不变——harness 在场时文档 pane 至多一个）；⌘⇧A 与标题栏 toggle 钮语义改为「在旁侧 pane 打开/收起 harness」，无第二 pane 时自动分栏、**默认宽度比 harness:文档 pane = 1:2**（Alex 裁决），拖拽后经既有 `pane_split_ratio` 通道按 vault 持久化；`harness_pane` 字段开始消费（恢复 = 重新装配面板，会话内容仍是内存态不持久化）；dock 列（`--layout-dock-w` / `.dock-open`）移除；空 pane 结构性只读条款显式不适用于 harness pane。
2. **标题栏 harness 段与产品标识移位**（`ui-design-system` MODIFIED「应用骨架布局」「产品名与版本号常显」；`harness` MODIFIED「会话边界」）：harness 在场时标题栏出现 harness 段（会话名下拉 + 新建会话钮），与标签段同构，段宽按 pane 实际宽度现算（与 pane 分隔条对齐，落实原型妥协点 5 的「近似对齐 → 现算」）；产品标识块从右端移到**标题栏最左 traffic 灯区**（系统按钮旁）；「新会话」动作入口随之从面板内迁到 harness 段。
3. **composer 控制行：模型选择 + ctx% 读数**（`harness` ADDED「模型选择」+ MODIFIED「上下文用量显示与触顶处理」）：控制行自左向右 = 模型 chip +（提案 3 的思考程度 chip 挂载位）+ ctx% 读数 + 发送钮；ctx% 读数从 dock 顶部迁入控制行；超过警示阈值时读数高亮 + ⓘ 钮，**警示说明收敛为点击 ⓘ 展开的气泡，不再常驻警示句**（Alex 裁决「一直显示在那里很抢注意力」）；模型 chip 列出 `[harness].providers` 已配置的 provider，选择即切换并运行期写回（选项来源见裁决点 3）。
4. **发送/停止两态**（`harness` ADDED「发送与停止」）：处理中发送钮呈停止态，点击中断本轮（流式与工具循环），已产出内容保留并标注已停止（Alex 裁决「处理过程中发送按钮应该是进行中的状态，点击后停止」）。
5. **复制消息**（`harness` ADDED「复制消息」）：消息 hover 浮现复制钮，复制该消息 Markdown 源文本，成功就地反馈（已复制态短时将息）。
6. **不定态进度与阶段指示**（`harness` ADDED「进度呈现」）：工具循环进行中呈现不定态进度条 + 阶段指示（当前动作）；SHALL NOT 呈现百分比；工具调用完成即折叠一行摘要（沿用既有口径）。

## Alex 裁决点（2026-10-06 节点 1 全部按起草倾向通过）

ADR 0008 已裁决、本提案仅登记的事项（不重复评审）：Decision 1（pane 承载文档组或 harness 之一）、Decision 2（⌘⇧A 语义 + dock 移除）、Decision 6（`harness_pane` 持久化消费）、harness 默认宽度比 1:2（Alex 2026-10-05）。

节点 1 裁决结果（Alex「无异议，采纳起草倾向」）：

| # | 裁决点 | 结果 |
|---|---|---|
| 1 | 会话浮层范围 | **只做「新建会话」入口，不实现最近会话列表**——历史回看 + 多会话管理是独立能力（现行 spec 明确探针期不提供），值得自己的提案；原型屏 7 的列表条目是合成 fixture 摆拍 |
| 2 | 标题栏 harness 段的会话名来源 | **首条用户消息截断**（约 20 字，未发消息时显示「新会话」）——原型形态；零额外机制 |
| 3 | 模型选择 chip 的选项来源 | **`[harness].providers` 已配置清单（闭集合），选择经 `config_set_value` 运行期写回**——无新配置面；要加新模型仍走 config 文件 |
| 4 | accent 族 token 中性化（去蓝色强调色）的路由 | **独立小 change**——爆炸半径在 editor 内容渲染（callout 蓝族、wikilink 药丸），与本提案零耦合；全量视觉基线重刷独立成批更好核对 |

## Non-goals

- **思考过程呈现与思考程度选择**（提案 3；本提案只在控制行留出 chip 挂载位，不实现）。
- **历史会话回看与多会话管理**（裁决点 1 已裁；会话内存态、JSONL append-only 留存口径不变）。
- **新增键位**（原型建议的 ⌘⇧N 等未经裁决；Alex 2026-10-03 总体方针「快捷键是后续专项治理，现在简单顺手即可」——本提案不新增默认键位）。
- **accent 族 token 中性化**（裁决点 4 已裁独立 change；本提案新增 UI 消费现行 token 取值，不预设新值）。
- **批准闸形态、工具集、权限规则、AGENTS.md / Skill 装配**（沿用现状）。
- **摘录引用卡片与 composer 混排**（提案 1，实现批次在途；本提案的实现排序在其批次合并之后——两者共用 `src/harness-panel.ts` 等文件，避免并行改造冲突）。
- **提案队列 / 对话内「请在提案队列裁决」文案**（原型占位措辞，批准闸沿用现状）。
- **会话内容持久化**（会话仍是内存态、重启清空；`harness_pane` 只记面板在场与否）。

## Impact

- 影响的 specs：`harness`（MODIFIED ×3：对话面板 / 上下文用量显示与触顶处理 / 会话边界；ADDED ×4：模型选择 / 发送与停止 / 复制消息 / 进度呈现）、`pane-layout`（MODIFIED ×2 + ADDED ×1）、`ui-design-system`（MODIFIED ×2：应用骨架布局 / 产品名与版本号常显）、`keymap-commands`（MODIFIED：harness.toggle）、`vault-workspace`（MODIFIED：按 vault 持久化 pane 布局）
- 影响的代码/系统：src（装配层 pane 容器承载 harness 面板、dock 列与 `.dock-open` 移除、标题栏 harness 段与产品标识移位、面板控制行重排、发送/停止状态、复制与进度呈现）、src-tauri（本轮中断——停止 in-flight 轮次；provider 运行期切换核对）、scripts/acceptance（dock→pane 相关场景更新 + 新场景）、tests/visual（骨架/标题栏/面板基线大面积失效，按「批次末尾一次性重刷 + Alex 过目」纪律处置）
- 关联约束：ADR 0008 Decision 1/2/6（本提案是其 Phase 2 容器部分的落实）；ADR 0002 §6 性能合同；ADR 0004 两节点硬门禁；实现排序约束——须在提案 1 实现批次（quote cards）合并后开工（共用文件面）
