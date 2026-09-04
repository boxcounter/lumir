# ADR 0004: 开发与开放策略

- 状态: proposed
- 日期: 2026-09-04
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Context

- 开发模式为 AI-only：Alex 做需求裁决者与 ADR/spec reviewer，不写代码、不 review 代码。该模式成立的前提是 harness（验证与反馈基础设施）先行——性能是持续纪律，人不 review 代码时唯一防线是 CI 硬门禁。
- 工具裁决（2026-09-04）：引入 OpenSpec 作为意图锁定层（spec 层）；不引入 Superpowers 类 agent 行为包（其产出是过程约束而非可评审制品，且与"方法论实验"定位冲突——harness 约定本身是实验品）。
- harness 引入的统一检验标准：**"它产出 Alex 评审的制品，或 CI 执行的门禁吗？两者皆无，即不引入。"**
- 开放策略：项目终将开源，但自用 daily driver 优先；用户群体小可接受。

## Decision

1. **13 周里程碑**：

   | 阶段 | 周 | 内容 | 出口标准 |
   |---|---|---|---|
   | M0 harness | 1-2 | CI 性能门禁、视觉回归、ADR/spec 流程、repo 骨架、性能测量方法学 spec | 空壳 app 的四项性能指标（冷启动、keypress-to-paint、打开 1MB 文件、常驻内存）全部已在 CI 里被测量并产出数值 |
   | M1 编辑器 | 3-6 | vault 打开、全类型文件树、md live preview、代码着色、wikilink 跳转、frontmatter properties、键位框架 | 能用 Lumir 只读浏览作者的整个真实 vault |
   | M2 agent | 7-10 | ACP 接入一个 agent、编辑状态可视化、选区发起对话、变更审批/回滚；MCP server + CLI | 完成一次完整的"选中→对话→agent 改文件→裁决"循环 |
   | M3 dogfood | 11-13 | 性能调到达标、键位打磨、迁移日常使用 | **连续两周用 Lumir 替代 Obsidian 完成真实工作** |

   M0 的两个 deliverable 需要说明：

   - **性能测量方法学 spec**：为 ADR 0002 性能合同的四个数字各写一节——测量端点、工具链、采样口径、fixture 规格。空壳 app 阶段没有真实编辑负载：keypress-to-paint 在 headless CI 用注入近似测量并注明其是下界，打开 1MB 文件以占位 fixture 计时；此阶段的绝对值用于一次性校准（见 ADR 0002 revisit），不代表达标。
   - **视觉回归门禁**：是 ADR 0001「极致美」的工程兜底——门禁只守「不丑」（布局、配色、间距不回归），「美不美」的裁决权始终在 Alex 人肉。

2. **挤压预案**：时间受挤压时砍 M1 高级部分（backlinks 可推迟），不砍 M2 agent 集成——agent 协作是产品灵魂，没有它 Lumir 只是"又一个 md 编辑器"。
3. **harness 搭建期（M0）Alex 适度参与**，稳定后放手。参与深度在 M0 实操时确定。
4. **OpenSpec 引入方式**：M0 第 2 周引入，以性能测量方法学 spec 为验证对象跑第一个"提案→评审→实现→归档"全循环——它是 M0 自身产物、验收口径明确、第 2 周必然存在（wikilink 在 M1 才开发，M0 无可实现对象，不适合作为首个验证对象）。wikilink 的 OpenSpec 循环推迟到 M1：其前置任务"冻结 wikilink spec + 从作者真实 vault 提取 fixture"（ADR 0003 第 4 条）安排在 M1 第 1 周（第 3 周）完成，随后 wikilink 跳转开发跑完整循环。评估时点自 M0 第 2 周首个全循环跑通起算两周（即第 4 周末、M1 中期）：评审制品是否真的让 Alex 不看代码也能裁决。不达标则退化为 `docs/proposals/` + 模板的自建约定，不留恋。
5. **制品分工**：OpenSpec 管"功能做什么"（living spec + change proposal）；ADR 只记跨切面架构决策。功能变更不产生 ADR，架构转向不写成 proposal。一切 spec 制品为 repo 内纯 markdown（dogfooding 对齐：Lumir 自己就是这些文件的编辑工具）。
6. **开源时点**：M3 出口标准达成后。此前不建贡献指南、issue 模板、extension 隔离设施；但须遵守 ADR 0002 第 7 条架构约束，不堵死未来进程外隔离的可能性。

## Consequences

### 正面

- 模式风险前置：harness 的两周是"人不 review 代码"成立的前提，跳过它模式会从内部瓦解。
- 时间盒有唯一且诚实的判定标准（M3 出口），不是功能清单完成度。
- 工具依赖最小化：引入的是工作流模型而非工具本身，OpenSpec 若停止维护，proposal/spec/tasks 约定原样保留。

### 代价与风险

- M0 两周无可见产品进展，需忍住不写功能。
- OpenSpec 验证失败需迁移约定（成本低：制品皆为 markdown）。
- 13 周排期对 M2（agent 集成）估计最薄，它是范围最大、参照最少的阶段。

## Revisit 条件

- M2 结束时完整 agent 循环未跑通 → 重估整体排期与范围，而非压缩 M3。
- OpenSpec 验证期（自 M0 首个全循环跑通起两周）评估不达标 → 退化自建约定，修订本 ADR 第 4、5 条。
- M3 出口未达成 → 触发 ADR 0001 的 revisit，重估定位。
