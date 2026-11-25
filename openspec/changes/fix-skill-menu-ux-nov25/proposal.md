# Proposal: 修复 Skill 候选的键盘导航、高亮可见性与响应式宽度

- Change ID: `fix-skill-menu-ux-nov25`
- 日期: 2026-11-25
- 角色: Alex Lee（实测报告 / 节点 1 产品意图），AI agent（起草与实现）
- 节点 1: **已批准**。Alex 于 2026-11-25 在 Lumir 0.16.0 实测报告三项缺陷并明确要求安排修复：不支持 Ctrl+N/P 选择、方向键移动高亮但列表不跟随、选择框太小。该报告是本小型缺陷修复的批准依据，不另扩产品 scope。

## Why

Skill 候选当前把 Ctrl+N/P 路由到「关闭候选但不消费」，方向键重绘后没有揭示高亮项，且内容宽与通用 list 档共同把菜单限制在 26em。三条实现分别造成无法按 Emacs 习惯选择、长列表高亮不可见、名称与描述难以扫读。渲染/交互缺陷按合同先行处理，输入分布与可证伪不变量见 [Skill 候选交互合同](../../../docs/specs/skill-menu.md)。

## What Changes

- 候选打开时，Ctrl+N 与 Ctrl+P 分别和 ArrowDown 与 ArrowUp 共用同一个高亮移动函数；事件被候选消费，不得同时移动 composer 光标或改文档。候选关闭时，既有 Emacs 行移动不变。
- 高亮经键盘或指针改变后，当前项 SHALL 在候选滚动视口内完整可见；已在视口内不滚动，且不得滚动整页或 transcript。到端停住、不环绕的既有语义不变。
- Skill 候选按 composer 宿主可用宽度响应式加宽：短内容取得可用空间驱动的目标宽，长内容可超过旧 26em，但仍受 48em 与 pane 可用宽上限约束。只改 Skill 候选，不改通用 list 浮层的 26em 档。
- 保留 Enter / Tab 接受、被动态不抢 Enter、Escape 层栈关闭、IME composition 不触发导航且不吞确认 Enter、refs 与发送语义。

## Non-goals

- 不新增 Skill 语法、搜索排序、环绕导航、多选、预览面板或新的键位。
- 不改候选过滤、Skill 调用策略、权限、草稿、后端加载或模型行为。
- 不改其它浮层的宽度档、滚动条档或视觉 token；不更新视觉基线。
- 不在本 worker 内启动真机；新增 WKWebView 场景由主会话串行执行。

## Impact

- 影响的 specs：`harness` 的「Skill 的混合调用与入口策略」由新名「Skill 的混合调用、入口策略与候选交互」整条承接（因旧场景必须改名，按 REMOVED + ADDED 通道）。
- 影响的合同：`docs/specs/skill-menu.md`（新增 Skill 专项交互不变量）。
- 影响的代码/系统：composer 捕获键路由、Skill 候选渲染与局部滚动、候选宽度计算及其单元/浏览器/真机场景。
- 关联约束：渲染/交互缺陷合同先行；滚动容器继续归细条档，右缘不放常驻可交互件。
