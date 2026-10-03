# Proposal: 新增 Harness 探针——对话面板 + 工具循环 + 局部写入

- Change ID: add-harness-probe
- 日期: 2026-10-02
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：**节点 1（提案评审）通过**——2026-10-02 Alex 对话裁决，裁决点 1–7 全部闭环（见下表）。
> **节点 2（归档评审）通过**——2026-10-03 Alex 批量授权原话：「一 里的 1 和 2 两个归档工作都做。
> 真机验证 deepseek 对话我做了，通过。」其中「1」即本 change 的归档评审授权。
> **Alex 真机验证 deepseek 对话通过（2026-10-03）**（含 thinking reasoning 原样回放修复后的二轮回归，
> 见同批 M306）。

## Why

ADR 0007（accepted 2026-10-02）重启 AI 定位为「探索中」，授权一个使用探针：**基础 Harness 能力 + 选中片段探讨**。动机是已确认的阅读摩擦：理解教材 / 代码时需手动复制片段与文件路径、切到外部 agent 开新会话——上下文搬运是主要成本。探针的能力清单与边界由 ADR 0007 Decision 2 封顶，本 change 是其实现提案。

## What Changes

新增 capability `harness`，并对两个既有 capability 做增量：

1. **对话面板**（harness）：右栏 dock（骨架预留列从 0px 接入实际宽度），可唤起 / 收起；与 LLM 多轮对话，流式呈现；模型输出**按 Markdown 渲染**（代码块高亮复用既有体系）；面板常驻显示**上下文用量**（context window 已用 % 与 cache hit %）。全部文案进文案表（zh/en 双档），样式只消费既有 token。
2. **上下文注入**（harness）：唤起对话时自动携带当前 TAB 的文件路径与选区内容；无选区时携带视口范围。注入内容在面板中可见（发送前可核对）。
3. **AGENTS.md 自动加载**（harness）：user-wide（`~/.agents/AGENTS.md`）与 vault-wide（vault 根 `AGENTS.md`）两层自动注入系统上下文；嵌套子目录级后置。
4. **Skill 支持**（harness）：自动发现 user-wide（`~/.agents/skills`）与 vault-wide（`<vault>/.agents/skills`）两处的 Skill（SKILL.md 约定）；技能索引注入系统上下文，全文按需加载。外部能力（如 Tavily）以「Skill + 对应 CLI」形态接入，**不是内置工具**。
5. **工具循环**（harness）：LLM 可调用工具并多轮往返。工具集恰好为：读 vault 文件、vault 内搜索、局部 patch 修改既有文档、新建文档、Skill 加载、CLI 执行。
6. **权限机制与写入安全**（harness + fs-io）：三层权限规则（allow / ask / deny，规则可配）。默认分层：**读类工具 allow；写类工具与 CLI 一律 ask（批准闸）**——面板内 diff / 命令预览，Alex 采纳后才执行。修改既有文档**只有局部 patch 一种能力**（工具集中不存在整文件写）；落盘衔接既有 revision CAS 与 watch 回声识别链路。新建文档 O_EXCL 不覆盖既有文件。
7. **配置**（harness）：新增 `[harness]` 配置节——provider 预设 **kimi / deepseek**（均 OpenAI 兼容契约，另有验收专用 mock）、各自的 api_key 与 model、权限规则表、循环上限；schema 校验按既有模板。
8. **上下文触顶处理**（harness）：自动压缩（auto-compact，默认开）——用量越阈值自动把会话历史压缩为摘要、开新逻辑会话注入摘要 + 当前编辑器上下文；面板有可见压缩标记，JSONL 留存完整历史。不做完整会话管理。
9. **会话边界**（harness）：会话绑定 vault（一个 vault 一个会话，内存态，切 vault 即切换，app 重启清空）；面板提供「新会话」动作，一键清空当前话题上下文，解决跨话题干扰。
9. **会话本地留存**（harness）：问答、工具调用与批准决策以 append-only JSONL 落配置目录（不进 vault），作为 ADR 0007 双向记录机制的一侧。
10. **可测试性**（harness）：内置 mock provider（脚本化响应），真机验收不依赖真实外部 API。

## Alex 裁决点

1–4 已于 2026-10-02 采纳起草倾向（①运行时 = 自研薄循环 Rust core；②API key 明文 config.json；③写一律批准闸；④首版 OpenAI 兼容接口——同日经讨论具体化为 **Responses API**，论证见 design §3）。⑤⑥⑦ 同日采纳（⑤默认权限分层 = 读 allow / 写与 CLI ask；⑥触顶 = **自动压缩**（auto-compact，默认开）；⑦v1 不做 persona 系统，但保留固定 system prompt 身份段）。全部裁决点已闭环。

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 5 | 默认权限分层 | A. 读 allow / 写与 CLI ask / deny 可配（行业惯例：Claude Code permissions 三层规则）；B. 一切工具都 ask；C. 一切读+写都 allow | **A**：只读工具零破坏面，逐次批准纯属摩擦；写与 CLI 必须过问 |
| 6 | 上下文触顶策略 | A. 压缩续聊（摘要开新会话）；B. 直接报错要求手工开新会话；C. 静默截断旧消息 | **A**：保留话题连续性，成本是一次摘要调用；C 会让模型「忘记」却不告知，最危险 |
| 7 | 是否含第一个 persona | A. v1 不做 persona 系统（固定朴素身份，行为定制走 AGENTS.md + Skill）；B. v1 做 persona 层 | **A**：AGENTS.md 双层加载已承担「在这个 vault / 对这个人，agent 该如何行事」的职责，persona 系统与之重叠；若指「给 Harness 一个名字」，那只是 system prompt 一句话 |

## Non-goals

- 后台异步任务（自动体检、定时提醒）——ADR 0007 记录的头脑风暴碎片，不在本 change。
- subagent、多会话管理、会话历史 UI 回看（留存只为记录，不回放）。
- ACP / headless CLI 后端（架构留口，不实现）。
- 插件框架与知识库开放（ADR 0001 §3 非目标不变）。
- 嵌套子目录级 AGENTS.md（只加载 user-wide 与 vault 根两层）、Anthropic 原生 API 适配、LLM 成本追踪。
- 移动端、IDE 能力等 ADR 0001 §3 全部非目标。

## Impact

- 影响的 specs：`harness`（新增）、`fs-io`（ADDED：局部 patch 写入）、`ui-design-system`（MODIFIED：骨架布局右栏接入）、`keymap-commands`（面板 toggle 命令，实现期补增量）
- 影响的代码/系统：src-tauri（harness 运行时模块、首个 HTTP client 依赖、patch 写路径、config 新节、Skill/AGENTS.md 发现）、src（面板 UI、上下文组装、ipc 封装、文案表、keys 命令表）、scripts/acceptance（场景配置键白名单扩容 + 新场景）、tests/visual（新表面整页基线）
- 关联约束：ADR 0007（探针边界，本 change 不得突破其 Decision 2 清单）、ADR 0003 §3（局部 patch 是铁律在 agent 写入侧的延伸）、ADR 0002 §5（配置即数据 + schema 校验）与 §6（性能合同：网络与流式渲染不进编辑器热路径；面板不推翻常驻内存合同）
