# ADR 0006: AI 定位延后与当前阶段重排

- 状态: proposed
- 日期: 2026-09-12
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Context

- M1 完成后，编辑器基础（Markdown Live Preview、表格、数学、Mermaid、callout、wikilink、文件树、非 md 高亮）已经过 M101–M120 共 20 个 mission 的打磨，该部分投入与 AI 定位无关，全部继续生效。
- Alex 裁决（2026-09-12）：
  1. 延后「AI 在产品里的定位」决策。已实现的 Thread 形态被明确否定为「不是未来的样子」。
  2. 推倒当前视觉方向。对 `design/` 下 editorial / instrument / void 三个探索方向均不满意，重做且不受其影响。
- ADR 0001 §1/§2 与 ADR 0005 定义了 Agent-first 的定位与对象模型。它们是未经 dogfood 验证的架构预判：PRODUCT-CONCEPT.md §18 的 11 条假设无一经过真实使用检验。按已验证形态继续堆 Agent 功能，成本高于先用起来再决定。

## Decision

1. **AI/Agent 定位 deferred（搁置，非放弃）**。
   - 删除已实现的 Thread 特性（前端 UI、后端持久化命令、测试与文案）与 agent 接入空壳模块（`acp_client.rs` / `mcp_server.rs` / `cli.rs`，均为未注册的占位骨架）。
   - ADR 0005（产品本体对象模型）整体 deferred：它不是被推翻，而是其实现前提（AI 定位）被延后；重启 AI 定位时它是输入，不是必须恢复的前提。
   - ADR 0001 §1（定位句）与 §2（产品本体 = agent 协作契约）在当前阶段不生效；0001 其余条款（§3 非目标、§4 键盘、§5 极致快美、§6 开放策略）继续有效。
   - 差异化判断保留：未来差异化仍落在「AI 与人的新合作关系」上。本 ADR 是时序决策，不是方向放弃。
2. **当前阶段定位：Emacs keybinding PKM**，自用 daily driver 优先（延续 ADR 0001「自用愉悦是第一要务」）。
   - 键盘方向具体化为 Emacs 式前缀键体系。这与 ADR 0001 §4「chorded + 非 modal」兼容且是其具体化：Emacs 非 modal，不引入 Vim 式 mode 状态机，不与中文输入法构成双重状态机。
   - 本阶段接受对外差异化暂时归零：dogfood 的目标是「作者自己每天愿意用」，暂不回答「为什么不用 Obsidian」。
3. **视觉：删除三主题实现，收敛到单套排版基线**（字体 / 行高 / 栏宽 / 对比度的单层 token，不回到无样式的裸态）。新视觉方向另案探索，dogfood 前落地 v1；`design/` 下三个方向产物删除，不作为参考输入。
4. **里程碑重排（对 ADR 0004 的局部修订，不 supersede）**：
   - ADR 0004 的 M2（agent 集成）整体 deferred。
   - 当前阶段序列：编辑器手感收尾（含 HANDOFF.md 待验收清单）→ Emacs keybinding → dogfood。
   - ADR 0004 的 M3 出口判据「连续两周用 Lumir 替代 Obsidian 完成真实工作」保留为本阶段 dogfood 出口，内容改为无 agent 形态。
5. **dogfood 产出显式包含 AI 定位的决策输入**：dogfood 期间维护 friction log，只记两件事——哪里卡住、哪里想回外部 Agent / Obsidian。AI 在产品里的位置由「作者在哪里卡住」决定，不由架构预判决定。
6. **本地数据保留**：`~/.config/lumir/threads/` 下已有数据不删除。它无害，且重启 AI 定位时可作为参考。

## Consequences

### 正面

- 代码库回到与定位一致的最小面：未验证的 Agent 架构不再以半成品形态滞留，后续 review 与 keybinding 工作在自洽基底上进行。
- dogfood 不再被「先定义 AI 协作契约」阻塞，显著提前。
- 决策可逆且可追溯：PRODUCT-CONCEPT.md 与 ADR 0005 原样保留为重启输入；git 历史保留全部删除内容；friction log 让重启决策有实证依据。

### 代价与风险

- 对外差异化暂时归零，本阶段产品对他人不构成采用理由。已自觉接受（自用优先）。
- 「延后」在事实层面有滑向「遗忘」的风险。由 Revisit 条件与 friction log 机制对冲。
- 新视觉方向未确定前，界面停留在排版基线，美观度低于此前三主题。接受：dogfood 的门槛是「愿意每天打开」，排版基线保证可读性下限。

## Revisit 条件

- friction log 中「需要把上下文搬运到外部 Agent」类摩擦累积到主观不可忍受，或 Alex 主动裁决 → 重启 AI 定位决策，以 ADR 0005、PRODUCT-CONCEPT.md 与 friction log 为输入。
- dogfood 出口（连续两周替代 Obsidian）未达成 → 触发 ADR 0001 的 revisit，重估整体定位。
