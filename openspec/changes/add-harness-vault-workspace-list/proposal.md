# Proposal: Harness 工作区合同与 vault 目录发现（`vault_list`）

- Change ID: `add-harness-vault-workspace-list`
- 日期: 2026-10-28
- 角色: Alex Lee（评审 / 裁决），AI agent（起草）

> **裁决留痕（2026-10-27，Alex 逐字）**
>
> 「好。我没有异议了，我们可以开始落实它了。」
>
> 交接材料：`.tower/comms/inbox/20261028-main-session-tower-harness-workspace-vault-discovery-handoff.md`
> （原会话只做产品讨论，**未改任何代码**）。本 change 落实的合同、非目标与验收判据均以该交接为准；
> ADR 0007 Decision 7 的修订（判据换成「核心领域的稳定动作优先结构化工具」、`vault_list` 入册、
> 工具清单 8 + 1 + 3 → 9 + 1 + 3）已随本批落地，属 Revisit 第三分支的第三次消费。

## Why

### 现场

用户在 harness 里让模型评审一份 proposal 并查看相关文件。模型先 `pwd`（返回 `/`）、`ls /Users`、
广域 `find` 探测 vault 根；目标文件读到了，但**sibling 文件与目录探索退到了通用 CLI**。这不是模型
一次发挥失常：工作区事实与目录发现能力两处都缺。

历史佐证：`.tower/comms/inbox/20261009-worker-m404-tower-survey-summary-m404-cli-run-usage-patterns-read-only-0-diff.md`
的 9 次只读 `cli_run` 小样本里，3 次在定位 vault 根、2 次在列目录 / 按路径枚举。样本只作方向性
证据；方案依据是文件发现属于核心任务链（定位 → 阅读 / 搜索 → 修改 / 综合）的入口，不是样本频率。

### 代码事实（改前）

- `src-tauri/src/harness/prompts/identity.md:1` 只说「当前打开的 vault」，没有绝对根路径。
- `src-tauri/src/harness/context.rs:152` 的公共装配收到 `vault_root`，但没有注入工作区事实。
- `src-tauri/src/harness/turn.rs:450` 回合开始已有当前 vault root 快照——根信息一直在场，只是没被
  任何一层消费者用上。
- `src-tauri/src/harness/tools.rs:453` 分发 `cli_run` 时未传 `ctx`；`tools.rs:1220` spawn 未设
  `current_dir`，子进程继承 Lumir 主进程 cwd——这是 `pwd` 返回 `/` 的直接原因。
- `vault_search`（`tools.rs:780-827`）只做正文子串搜索并返回命中行，不承担目录 / 路径发现。
- `src-tauri/src/harness/permissions.rs:1781-1784` 明确把「cli_run 的 cwd 不是 vault」写成相对写目标
  的判定前提（靠目标 / 父目录是否存在来猜归属）；`:1819-1823` 在该前提下使**根目录下不存在的新文件**
  漏出重定向。`full_access` 档普通写命令会放行（`:198-203`），所以 cwd 与权限合同必须一起改。

### 为什么不是「再补一段 prompt」

cwd 与 prompt 解决的不是同一件事：cwd 决定 `cli_run` 在哪里执行，`vault_list` 决定模型如何用 vault
领域语义表达导航。只补 prompt 时 `pwd` 仍返回 `/`、目录发现仍要模型每次把意图翻译成 `ls` / `find`，
范围与输出形态都不受产品控制；只改 cwd 不加工具时，目录发现仍缺一个有界、稳定、共用忽略规则的
通道。两者作为同一个工作区 / 工具合同落地。

## What Changes

1. **统一工作区合同（三层同一根）**：每个 harness 运行（主会话 / 子代理 / cron 无人值守）绑定当前
   vault——system 注入绝对根与路径边界；每次 `cli_run` 子进程单独 `current_dir` = 当前 vault 且同步
   `PWD`（不改主进程 cwd、不增模型可填 `cwd`）；权限层用同一根解释相对写目标。
2. **新增唯一工具 `vault_list`**：vault 内目录导航与路径 / 文件名发现。默认一层、递归与路径过滤
   显式选择、稳定排序、有界分页（`limit` / `cursor` / `truncated` / `next_cursor`），复用 fs-io 的
   忽略 / 可见性 / 惰性语义，只返回 `path` 与 `kind`。
3. **权限相对路径语义**：不含 `..` 的相对写目标一律视为 vault 内（含根目录下尚不存在的新文件），
   不再以存在性猜 cwd 归属；绝对路径 containment、`..` 逃逸、符号链接防护保持；`full_access` 档的
   vault 内写照旧重定向。
4. **文档与计数同步**：ADR 0007 Decision 7、harness / harness-subagents living spec 的工具清单与
   权限读类清单、system 提示词固定段顺序。

## Non-goals

- 不新增关联图、反链工具（本次现场是 sibling 目录 / 文件发现，不是语义反链需求）。
- 不做 `vault_stat` / `vault_count` / `vault_head` 等只读工具族。
- 不禁止 `find /` 一类外部只读 CLI——先消除普通 vault 导航对它的依赖。
- **不保留继承主进程 cwd 的兼容层**：该行为不稳定且无可指名消费者。
- 不把整个 vault 文件清单一次性注入 system 或工具结果。
- 不改前端：工具行呈现、批准卡、路径链接识别全部沿用现状（`vault_list` 的结果信封与既有工具同形）。

## 影响面

| 面 | 变动 |
|---|---|
| ADR 0007 | Decision 7 第三次修订（判据、工具清单、工作区合同、Revisit 消费记录） |
| living spec | `harness`（3 ADDED + 4 MODIFIED）、`harness-subagents`（1 MODIFIED） |
| Rust | `harness/context.rs`、`harness/prompts/`、`harness/tools.rs`、`harness/turn.rs`、`harness/permissions.rs` |
| 前端 | 无（未改 `src/**`，无 ts-rs 导出面变化，`src/bindings/**` 不动） |
| 验收 | 新增场景 `254-harness-vault-workspace-list`（mock provider），COVERAGE 重生成 |
| 既有测试 | 受装配清单条数（8 → 9）、工具计数（8 → 9）、相对写目标判定影响的断言同步更新 |

## 验收判据（交接原文，逐条落点见 design §7）

1. system 对主会话、子代理、cron 均含正确 vault 绝对根路径及相对 / 绝对路径使用边界。
2. `cli_run("pwd")` 返回当前 vault；A/B vault 切换、子代理与 cron 各自落正确 root，主进程 cwd 不变。
3. 已知目录查看 sibling 文件时，模型首选 `vault_list` → `vault_read` / `vault_search`，不再需要
   `pwd` 或从 `/`、`$HOME` 探测。
4. `vault_list` 默认一层、递归 / 过滤、稳定排序、分页、`truncated` / `next_cursor`、ignore / lazy、
   目录与文件类型均有正反测试；结果不可越出 vault。
5. 根目录不存在的新文件、嵌套新文件、既有文件在所有权限档（尤其 `full_access`）都按合同重定向；
   绝对路径、`..`、symlink 原防护不回归。
6. 新增 / 更新真机验收场景；真实 provider 用原始「评审 proposal 并查看相关文件」场景复验，无根目录
   探测与广域 find。
7. 按 gate 与 OpenSpec 流程完成门禁、独立评审和归档审计。

## 节点记录

- 节点 1（提案评审）：**已通过**——Alex 2026-10-27 在另一会话裁决（原话见文首「裁决留痕」），
  交接材料逐条列出合同、非目标与验收判据；本 change 的 proposal / design / tasks / delta 全部按该
  合同起草，实现期不新增范围。
- 节点 2（归档）：实现完成后按五要件填写（reviewer verdict + tip、门禁输出、验收证据指针）。
  **归档前记录（2026-10-29，M804 填写）**见下节；最终独立评审一行留待 tower 安排的 reviewer
  绑定最终 tip 后填，未填即视为要件 2 未满足、不得归档。

### 节点 2 归档前五要件（2026-10-29）

1. **方案已批准**：节点 1 通过——Alex 2026-10-27 原话「好。我没有异议了，我们可以开始落实它了。」
   （见文首「裁决留痕」）；实现期无 scope 扩张（6.x 的抽样与文档更新都在已批准合同内）。
2. **独立 reviewer 结论 clean / merge**：
   - 实现批：`reviewer-harness-vault-workspace-list-oct28-r6`，`status: clean` / `merge: merge`，
     tip `f89b83db1326cf09eafb02221f1a10f32f3cf5e0`，评审文件
     `.tower/comms/reviews/review-feat-harness-vault-workspace-list-oct28-reviewer-harness-vault-workspa-r1-6.md`；
     前四轮 p2 / fix-then-merge 的返修记录见同目录 `-r1`…`-r1-4`。
   - description 边界句批：`reviewer-vault-list-guidance-oct29-r2`，`status: clean` / `merge: merge`，
     tip `e23f41a6e71aa6950301a1ee345310b02df592f7`，评审文件
     `.tower/comms/reviews/review-feat-complete-vault-list-guidance-dogfood-oct-reviewer-vault-list-guidance-o-r1-2.md`。
   - **最终评审（待填，归档前置条件）**：tower 安排的独立 reviewer 绑定本分支最终 tip
     `<reviewer / verdict / tip / 评审文件>`——本行未填 = 要件 2 未满足。
3. **tasks 完成或有放弃理由**：`openspec/changes/add-harness-vault-workspace-list/tasks.md` 全部勾选；
   真机 6.5 由 M780 / M783 两次 PASS 闭合，真实 provider 6.6 由 M804 抽样闭合（硬判据 PASS，
   `vault_list` 首选半条未触发，见 tasks 6.6 节）；无放弃项。
4. **要求的门禁与真机证据通过**：
   - `scripts/gate.sh quick` → `GATE RESULT: 12/12 PASS（SKIP 1）`（退出码 0；SKIP = `tsc-visual`，
     本 change 不动 `src/**`，视觉门禁不在范围）。
   - 真机 254：PASS 两次——`.local/acceptance/2026-10-28-m780-254/`、`.local/acceptance/2026-10-28-m783-254/`。
   - 真实 provider 抽样：`.local/reviews/vault-list-real-provider-oct29/`（`sample1/` 硬判据 PASS、
     `binary-description-check.txt`、`run-notes.md`）。
   - 本批文档修订复跑：`openspec validate --all --strict` → `Totals: 35 passed, 0 failed (35 items)`（退出码 0）；
     `scripts/docs-check.sh` → `docs-check: PASS`（含归档对账、归档队列、验收契约与覆盖表、套件自测 180 pass）。
5. **规格对账无丢段（归档前读数）**：`scripts/docs-check.sh` 内含 `scripts/openspec-archive-check.mjs`
   门禁模式（PASS）；`validate --all --strict` 见要件 4；归档跟踪队列在 `docs/backlog.md` 有且仅有
   一条 `add-harness-vault-workspace-list` 条目。
