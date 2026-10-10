# Proposal: harness 自动加载 vault 根 AGENTS.local.md

- Change ID: harness-agents-local-md
- 日期: 2026-10-10
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。
>
> 口径来源：本 change 的四条口径（① 第三层排 vault 根 `AGENTS.md` 之后注入、② 文件不存在或读失败静默跳过、③ 不加 user-wide 本地层、④ 装配清单记录路径与存在与否）由 tower 于规划期裁定，本文照写，不再另设裁决点。

## Why

Alex 原话（2026-10-10）：「Harness 增加自动加载 project-wide AGENTS.local.md，如果它存在」。

现状（`src-tauri/src/harness/context.rs:102-153`）：会话建立时系统上下文自动装配**两层** AGENTS 指令文件——user-wide（`~/.agents/AGENTS.md`）与 vault 根（`<vault>/AGENTS.md`），文件不存在静默跳过。vault 根的 `AGENTS.md` 是**入库制品**（随 vault 的版本控制走），适合放可共享、可提交的规则；但本机私有的内容（个人路径、临时偏好、不想公开的试验性指示）没有落点——只能写进 `AGENTS.md` 一起提交，或每次对话手贴。

`AGENTS.local.md` 是同类指令文件的**本地覆盖层**命名，通行口径为「本机项目私有、不提交」（例：[Qoder CLI 使用教程](https://juejin.cn/post/7662632306675056674) 的 `AGENTS.local.md # 本机项目私有（不提交）`）。Kimi Code 官方文档的指令文件章节只记 `AGENTS.md` 层级（`~/.agents/AGENTS.md` / `.kimi-code/AGENTS.md` 或 `AGENTS.md`，见 [Agents — Instruction Files](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html)），不记 local 层——本 change 采其命名惯例，不依赖上游是否加载它。本 change 让 Lumir 装配这第三层，排在 vault 根 `AGENTS.md` 之后，从而既能补充也能覆盖后者的指示。

## What Changes

每条对应 `specs/harness/spec.md` 增量中的一个 requirement：

1. **AGENTS.md 自动加载**（harness，MODIFIED）：装配层从两层扩为三层，注入顺序为 user-wide（`~/.agents/AGENTS.md`）→ vault 根（`<vault>/AGENTS.md`）→ vault 根本地覆盖层（`<vault>/AGENTS.local.md`）。第三层 SHALL 排在 vault 根 `AGENTS.md` 之后注入，并在系统上下文中以该节标题标明「本机本地覆盖层、冲突时以此为准」——「后位为准」的覆盖语义由装配位置 + 标题显式表达，模型不必自行推断。三层文件各自不存在 / 非文件 / 读取失败时 SHALL 全部静默跳过（不注入、不告警、不阻断会话，与既有两层同口径）。装配清单（`session_open.assembly`）SHALL 为本层记一条来源条目，记录路径与存在与否（不存在的来源同样在场、`exists:false`）。requirement 名保留「AGENTS.md 自动加载」——`AGENTS.local.md` 属同一 AGENTS 指令文件族，保留名让 living spec 锚点稳定，语义扩围以该 requirement 正文为准。

## Non-goals

- **user-wide 本地层**：不加 `~/.agents/AGENTS.local.md`（tower 已裁）——user-wide 层本就是本机私有内容，没有再加一层覆盖的需要。
- **嵌套子目录级**：vault 内子目录的 `AGENTS.md` / `AGENTS.local.md` 不在本期（沿用 living spec 既有 Non-goal）。
- **写入 / 生成 / 版本控制**：Lumir MUST NOT 创建、改写或写入该文件（只读），MUST NOT 往 vault 的 `.gitignore` 追加条目——该文件是否提交由用户与其 vault 自己的版本控制决定。
- **配置开关**：文件在场与否即开关，不新增 `[harness]` 配置项（无消费者、纯增面）。
- **UI / 文件树呈现**：不隐藏文件树里的 `AGENTS.local.md`，不加任何界面指示——与 `AGENTS.md` 现状一致。
- **结构化合并语义**：不解析、不合并、不 diff 两层内容；覆盖语义只由「后位注入 + 标题声明」提示模型承担，MUST NOT 发明优先级语法。

## Impact

- 影响的 specs：`harness`（MODIFIED ×1：`AGENTS.md 自动加载`）
- 影响的代码/系统：`src-tauri/src/harness/context.rs`（`assemble_system` 增第三层读取与 section 注入、装配清单新增来源，`read_agents_md` 复用零改动）；Rust 单测镜像现有装配测试加第三层断言；真机验收新增/更新场景（会话 JSONL 的 `session_open.assembly` 含新来源且 `exists` 与 fixture 一致、三处齐备时 system prompt 顺序）。无前端改动、无配置 schema 改动、无 ts-rs 导出面变化。
- 关联约束：ADR 0007（探针能力边界——只扩装配来源，不扩工具集）；ADR 0002 §6 性能合同（会话装配期多读一个小文本文件，位于发送前路径、不在 keypress-to-paint 路径；文件缺失时 `is_file()` 探测先行、零读取成本）；ADR 0003 §3 铁律（只读，不改写 vault 源文件）；仓库信息卫生（测试 fixture 全部合成，MUST NOT 含真实 vault 内容）。

## 观测闸三问（低成本口径）

- **怎么知道用户用了它**：产品零埋点；每会话 `session_open.assembly` 已记录该来源的路径与 `exists`（既有 wire 留存），dogfood 期在会话 JSONL 里按来源名 grep 即可统计「这个 vault 有没有用本地层」，不立新埋点。
- **怎么知道它有效**：主判 Alex dogfood——本机私有指示写进 `AGENTS.local.md` 后 agent 是否照它行事；辅判「不入 vault 版本控制」这一目的达成（用户 `git status` 自证该文件未被提交面捕获）。
- **出问题怎么发现**：机器面兜底——Rust 单测钉三处齐备 / 缺失静默跳过 / 清单条目两态；真机验收断言 `session_open.assembly` 的条目与顺序。注入顺序错、清单漏记、对缺失文件误告警都会判红。
