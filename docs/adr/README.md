# ADR（Architecture Decision Record）约定

本目录记录 Lumir 的跨切面架构决策。每份 ADR 一旦 accepted，在 revisit 条件触发前不得静默违背；变更决策的正确方式是新增一份 supersede 它的 ADR。

## 状态生命周期

`proposed`（待 Alex 评审）→ `accepted` →（可选）`superseded by ADR-NNNN` / `deprecated`

## 与 OpenSpec 的分工（详见 ADR 0004）

- **ADR**：跨切面架构决策（为什么选 Tauri、为什么配置即数据）。低频，长期有效。
- **OpenSpec**：功能规格（living spec + change proposal），管"功能做什么"。高频，随功能演进。
- 功能变更不产生 ADR；架构转向不写成 proposal。

## 模板骨架

```markdown
# ADR NNNN: 标题

- 状态: proposed
- 日期: YYYY-MM-DD
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Context
## Decision
## Consequences
### 正面
### 代价与风险
## Revisit 条件
```

## 索引

| 编号 | 标题 | 状态 |
|---|---|---|
| [0001](0001-product-positioning-and-boundaries.md) | 定位与边界 | accepted |
| [0002](0002-technical-route.md) | 技术路线 | accepted |
| [0003](0003-obsidian-compatibility-scope.md) | Obsidian 兼容范围 | accepted |
| [0004](0004-development-and-openness-strategy.md) | 开发与开放策略 | accepted |
| [0005](0005-product-ontology-object-model.md) | 产品本体对象模型 | proposed |
