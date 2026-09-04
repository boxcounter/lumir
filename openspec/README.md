# OpenSpec 目录约定

本目录由 OpenSpec CLI（`@fission-ai/openspec`）初始化，是 Lumir 的功能规格层（living spec + change proposal）。与 ADR 的制品分工见 ADR 0004 第 5 条：**OpenSpec 管"功能做什么"，ADR 只记跨切面架构决策；功能变更不产生 ADR，架构转向不写成 proposal。**

完整流程（提案→评审→实现→归档、Alex 评审节点、制品模板）见 [docs/process/openspec-workflow.md](../docs/process/openspec-workflow.md)。本文件只锁定目录结构与命令速查。

## 目录结构

```
openspec/
├── config.yaml            # OpenSpec 配置（schema: spec-driven，制品语言 zh）
├── project.md             # 项目上下文，供 AI agent 起草制品时参考
├── specs/                 # living spec：各领域能力的当前事实（<capability>/spec.md）
└── changes/               # 进行中的 change，每个 change 一个目录
    └── archive/           # 已完成并归档的 change
```

进行中的 change 目录制品清单：

| 制品 | 必填 | 内容 |
|---|---|---|
| `proposal.md` | 是 | 为什么改、改什么、不做什么（Non-goals） |
| `tasks.md` | 是 | 可勾选的任务清单，实现过程逐项勾选 |
| `design.md` | 技术复杂时 | 技术方案与权衡 |
| `specs/<capability>/spec.md` | 是 | spec 增量（delta），归档时并入 `openspec/specs/` |

## 写作约定

- 制品正文用中文；结构性标题与 `SHALL`/`MUST` 关键字保留英文（见 `config.yaml`）。
- 一切制品为 repo 内纯 markdown（ADR 0004 第 5 条：dogfooding 对齐）。
- 每个 requirement 须有可验证的描述与至少一个 `#### Scenario:`。

## 命令速查

```bash
# 校验（CI 门禁同款，须通过）
npx --yes @fission-ai/openspec@1.12.0 validate --all --strict

# 查看进行中的 change / 现有 spec
npx --yes @fission-ai/openspec@1.12.0 list
npx --yes @fission-ai/openspec@1.12.0 list --specs

# 归档已完成的 change（并入 living spec 并移入 changes/archive/）
npx --yes @fission-ai/openspec@1.12.0 archive <change-id> --yes
```

不将 CLI 写入 package.json 依赖：OpenSpec 引入的是工作流约定而非运行时依赖，CLI 仅以 `npx` 按需调用（若 OpenSpec 停止维护，proposal/specs/tasks/archive 约定原样保留，见 ADR 0004 Consequences）。
