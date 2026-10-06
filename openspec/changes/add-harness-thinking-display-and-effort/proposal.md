# Proposal: 思考过程呈现与思考程度选择

> ADR 0008 Phase 2 三提案之三。输入：原型 `design/prototypes/phase2-harness-chat/` 屏 9（思考过程折叠/展开两态）
> 与屏 10（思考程度浮层），Alex 已批准原型全稿；Alex 原型意见 7「思考程度的菜单里无需解释每档的具体含义」。
> 排序：实现排在本批次提案 1（`add-harness-quote-cards`）与提案 2（`move-harness-to-pane-chat-frame`）合并之后
> （共用 `src/harness-panel.ts` 与 Rust core 事件面），提案间零规格耦合、可独立评审。

## Why

harness 对话进入 Phase 2 后，agent 的推理过程（reasoning）目前对人不可见：Rust core 自 M306 起已捕获
reasoning 项用于跨轮回放（deepseek thinking 模式硬性要求），但事件流只把最终文本发给前端，思考内容在
界面上不存在。这违反提案 1 节点 1 立下的**一致性原则**（AI 可见的上下文对人必须也可查）的另一半：
模型实际想过了什么，人无从核对，也无法判断「它是不是想偏了」。同时，思考的深度应当是用户可调的本回合
参数——轻量问答与结构性整理需要的推理预算不同，厂商默认值不可控。

## What Changes

1. **思考过程呈现**：transcript 里 agent 消息的思考内容渲染为可折叠块（原型屏 9 形态：标题行
   「思考过程 · N 秒」+ chevron，展开态为左边线 + 次级灰正文；一轮里可有多个思考块；该消息无思考内容
   则不渲染块）。时长为该思考块从首个片段到末个片段的实际耗时。
2. **Rust core 新增 reasoning 文本事件**：在现有事件族（text_chunk / tool_call / approval_request /
   usage / compact / done / error）之外新增一种，把已捕获的 reasoning 文本实时转发前端（信封同族带 vault
   标识）。reasoning 跨轮回放纪律（M306，llm.rs §reasoning 回传纪律）不动——本 change 只加「转发给人」，
   不改「回传给模型」。
3. **思考程度选择**：composer 控制行在模型 chip 之后、ctx 读数之前新增「思考：Low/High/Max」chip，点击弹出
   浮层（原型屏 10 形态：**三个裸档位，无每档释义**——Alex 裁决 7）。档位命名与默认值直接沿用
   Kimi / DeepSeek 的 Low/High/Max 与默认 High（Alex 2026-10-06 节点 1 裁决）；core 按 provider 映射到
   各家实际参数。
4. **mock provider fixture 支持产出 reasoning 项**：验收场景可确定性覆盖思考块渲染与时长显示，不依赖
   真实外部 API。

## Alex 裁决点（2026-10-06 节点 1 全部落定）

1. **档位的持久化**：**会话内生效、不写回配置、新会话回到默认**（采纳起草倾向）。模型选择（提案 2 裁决 3）
   写回配置，因为模型是环境级偏好；思考程度是任务级调节，每次新会话从默认出发。
2. **当前 provider 不支持程度调节时 chip 的形态**：**置灰禁用**（采纳起草倾向；hover 给一句
   「当前模型不支持思考程度调节」）。
3. **进行中的思考块默认折叠还是展开**：**保持折叠、内容实时流入**（采纳起草倾向；想看的人点开即是直播）。
4. **档位命名与默认值**：**Low / High / Max，默认 High**——与 Kimi、DeepSeek 模型的思考程度命名和
   默认值一致（Alex 节点 1 新增裁决，取代起草时的「低/中/高、默认中」）。档位名作为专有名词在 zh/en
   两档界面均保持英文原文。

## Non-goals

- 每档思考程度的释义文案（Alex 裁决 7 明确不要；档位语义由 Low/High/Max 字面承担）。
- 思考内容的 Markdown 渲染（与原型一致按纯文本呈现）。
- reasoning 回放纪律的任何修改（M306 已定，本 change 零触碰）。
- 按消息粒度的程度切换 UI（chip 影响其后发出的所有消息，直到再次调整）。
- 思考内容的搜索、导出或持久化展示（会话内容不持久化的既定口径不变，见提案 2）。

## Impact

- **规格**：`harness` capability 新增 2 个 requirement（思考过程呈现、思考程度选择）。
- **代码**：`src-tauri/src/harness/`（events.rs 新事件、turn.rs 转发、llm.rs 程度映射与 provider 参数）、
  `src/harness-panel.ts`（思考块渲染 + chip 与浮层）、`src/copy.ts`（文案条目）、
  `scripts/acceptance/scenarios/`（新增验收场景）、`src-tauri/src/harness/` 内 mock fixture 样例。
- **真机验收**：新增场景——mock fixture 产出 reasoning → 思考块折叠默认/展开内容/时长在场；切档位后
  下一轮请求参数变化（经 mock 侧断言或日志断言）。
- **风险**：各家 provider 的程度参数名与取值须对真 API 核实（kimi / deepseek 按 Alex 裁决沿用
  Low/High/Max 命名与默认 High；后续 OpenAI 系以其现行文档为准）——若某 provider 无对应能力，按
  裁决点 2 的置灰形态兜底。
