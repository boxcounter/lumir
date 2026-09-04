# 流程文档索引

本目录记录 Lumir 的制品流程约定，服务两类读者：

- **Alex（评审/裁决）**：每篇文档中的"评审节点"小节给出你何时介入、看什么制品、通过标准是什么。
- **AI agent（起草/实现）**：每篇文档中的"操作指令"小节是可执行步骤。

## 目录

| 文档 | 内容 |
|---|---|
| [adr-lifecycle.md](adr-lifecycle.md) | ADR 生命周期与 Alex 评审操作（状态约定本体在 [docs/adr/README.md](../adr/README.md)） |
| [openspec-workflow.md](openspec-workflow.md) | OpenSpec 提案→评审→实现→归档全流程、制品清单与模板 |

## 分工总原则（ADR 0004 第 5 条）

- OpenSpec 管"功能做什么"（living spec + change proposal）。
- ADR 只记跨切面架构决策。
- 功能变更不产生 ADR，架构转向不写成 proposal。
- 一切 spec 制品为 repo 内纯 markdown。

## 统一检验标准（ADR 0004 Context）

任何流程或工具引入前问一句：**"它产出 Alex 评审的制品，或 CI 执行的门禁吗？两者皆无，即不引入。"**
