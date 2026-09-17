# OpenSpec 流程：提案 → 评审 → 实现 → 归档

目录结构与命令速查见 [openspec/README.md](../../openspec/README.md)。本文是全流程约定：谁在哪一步做什么、Alex 在哪几个节点评审、每个 change 必须产出哪些制品。

## 全流程

```
起草 change ──► validate --all --strict ──► 提交 PR ──► 【评审节点 1：提案评审】
                                                        │ 通过
实现（勾选 tasks） ◄── Alex 批准 ◄──────────────────────┘
        │
        ▼
validate --all --strict + CI 门禁 ──► 提交 PR ──► 【评审节点 2：归档评审】
                                                  │ 通过
openspec archive（并入 living spec） ◄── Alex 确认 ◄────┘
```

一个 change 对应一个 PR 序列：提案 PR 与实现 PR 可以合并为一个 PR（小型变更），也可以拆开（提案先行锁定意图）。判断标准：Alex 是否需要在实现前就裁决"做不做"。需要则拆开。

## Alex 的评审节点

| 节点 | 时机 | 看的制品 | 通过标准 |
|---|---|---|---|
| 1. 提案评审 | 实现开始前 | `proposal.md`（+ `design.md` 如有） | 不看代码即可裁决：为什么改、改什么、不做什么，三者都答清楚了 |
| 2. 归档评审 | 实现完成、archive 前 | `tasks.md` 勾选状态、`specs/` 增量 | tasks 全部勾选或标注放弃原因；spec 增量与 proposal 的意图一致，无实现期静默扩scope |

两个节点都是硬门禁：**未经节点 1 通过的 change 不进入实现；未经节点 2 通过的 change 不 archive。** 这是"人不 review 代码"模式下意图层唯一的防线（ADR 0004）。

评估性约定（ADR 0004 第 4 条）：自首个全循环跑通起算，跑满 ≥3 个全循环或满两周，先到为准，评估"评审制品是否真的让 Alex 不看代码也能裁决"。不达标则退化为 `docs/proposals/` + 模板自建约定，不留恋。

## 制品清单（每个 change）

| 制品 | 必填 | 起草时机 | 模板 |
|---|---|---|---|
| `proposal.md` | 是 | 提案阶段 | [templates/proposal.md](templates/proposal.md) |
| `tasks.md` | 是 | 提案阶段（可随实现细化） | [templates/tasks.md](templates/tasks.md) |
| `design.md` | 技术复杂时 | 提案阶段 | — |
| `specs/<capability>/spec.md` | 是 | 提案阶段起草，实现期可修订 | 见下方 spec 增量约定 |

spec 增量（delta）约定：change 目录下的 `specs/<capability>/spec.md` 只写增量操作——`## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED Requirements` / `## RENAMED Requirements`。每个 requirement 用 `### Requirement: <名称>` 起头，正文含 `SHALL`/`MUST`，且至少一个 `#### Scenario:`。archive 时这些增量并入 `openspec/specs/<capability>/spec.md` 成为 living spec。

## AI agent 的操作指令

1. **起草**：在 `openspec/changes/<change-id>/` 下创建制品。change-id 用 kebab-case 动词短语（如 `add-perf-measurement-methodology`）。复制 `docs/process/templates/` 下的模板。
2. **自验**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 必须通过；CI 会重复此校验。
3. **提案 PR**：提交并在 PR 描述中 @ Alex 请求节点 1 评审。未通过则按批注修订，保持 change 不进入实现。
4. **实现**：按 `tasks.md` 逐项实现并勾选（`- [x]`）。发现 proposal 意图需要变更时，停下：更新 proposal 并重新走节点 1，不静默扩 scope。
5. **归档评审**：tasks 全部勾选（或标注放弃原因）后提交 PR 请求节点 2 评审。
6. **归档**：节点 2 通过后执行 `npx --yes @fission-ai/openspec@1.12.0 archive <change-id> --yes`，living spec 自动并入 `openspec/specs/`。

## 批次收尾 checklist（归档跟踪）

实测失效模式（M150 归档对账，2026-09-17）：**实现 PR 合并后没人跟进归档**——当时 11 个活跃 change 里 7 个已实现未归档（`add-wikilink` 积压 12 天），living spec 因此长期落后于实现，其间还出现 living spec 与实现直接矛盾（`editor-live-preview` 自称「M1 只读口径」而 md 模式早已可编辑）。防线是把它做成批次收尾的强制项：

- [ ] **本批 merge 的 change 全部列入归档待办并跟踪到归档**：每个 change 在实现 PR 合并时即落一条待归档记录（`docs/backlog.md` 的「待 Alex 裁决」节），批次收尾时用 `npx --yes @fission-ai/openspec@1.12.0 list` 逐个核对——列表里出现 `✓ Complete` 却仍在活跃列表里的，就是漏跟踪的那个。
- [ ] **归档前逐条对账**（对账口径）：tasks 勾选状态 / spec 增量 / 当前实现三者一致才归档；任务未勾但有正当理由的，先就地标注放弃原因再归档；spec 增量与实现矛盾的，**不归档**，并在 `docs/backlog.md` 说明矛盾点。
- [ ] **归档后核对新建 capability 的 Purpose**：`archive` 会为新建的 living spec 写入占位 Purpose（`TBD - created by archiving change …`），`validate --all --strict` 会因此报红——须手写替换为「这个 capability 是干什么的」，再跑一次 validate 确认全绿。

## 撤回（withdrawn）：放弃一个 change

僵尸提案（从未进入实现，其能力已由别的 mission 实现、或路线已废）不能留在活跃列表里——`openspec list` 会永远把它们当在办事项。OpenSpec CLI 没有 withdraw 命令，本项目口径（M150 首次执行）：

1. 把 change 目录整体移到 `openspec/changes/archive/<日期>-withdrawn-<change-id>/`：活跃列表清空、提案全文留档（含 design 与证据文件）、CI 的 change 制品检查跳过 `archive/`。`withdrawn-` 前缀把「撤回」与「已合并归档」在目录名上分开。
2. 在它的 `proposal.md` 头部补一段「撤回记录」：日期、为什么不再推进、问题由谁承接、以及**遗留了什么**（未按其形态产出的验收面、未进 living spec 的口径缺口）——三件事缺一，撤回就退化成静默删除。
3. 同步配套文档：`docs/specs/*` 的状态头改为「已撤回（留档作重启输入）」，并在 `docs/backlog.md` 落核销条目。三处（archive 目录、spec 状态头、backlog）要能互相印证。
4. 撤回件不再受 `validate --archived` 的「任务全勾」约束（该检查本就不在 CI 与 `gate.sh` 里）。

## 首个全循环对象：性能测量方法学 spec（与 M8 的约定）

ADR 0004 第 4 条指定 OpenSpec 的首个全循环验证对象为 M8（feat/perf-spec-ci）的性能测量方法学 spec。约定如下：

- **change-id**：`add-perf-measurement-methodology`。
- **capability**：`perf-measurement`（living spec 落在 `openspec/specs/perf-measurement/spec.md`）。
- **proposal 内容要点**：为 ADR 0002 第 6 条的四个性能数字（冷启动 <300ms、keypress-to-paint <16ms、打开 1MB Markdown <100ms、常驻内存 <200MB）各写一节测量方法学——测量端点、工具链、采样口径、fixture 规格；注明空壳 app 阶段的口径（headless CI 注入近似为下界、占位 fixture），绝对值仅用于 ADR 0002 revisit 的一次性校准，不代表达标。
- **本 mission（M10）提供的衔接物**：上述模板 + 本流程文档即 M8 的操作依据。M8 worker 启动后，如有制品格式分歧，通过 tower 消息对齐；模板改动的所有权在 M10 归档后的 repo 现状，谁改谁负责同步更新本文件。
