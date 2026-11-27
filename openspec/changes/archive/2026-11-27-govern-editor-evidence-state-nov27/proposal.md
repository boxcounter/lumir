# Proposal: 证据状态分列与 finding 归类

- Change ID: govern-editor-evidence-state-nov27
- 日期: 2026-11-27
- 角色: Alex Lee（评审/裁决），AI agent（起草）

## Why

编辑器治理复盘（2026-11-27）确认：现有报告把几种不同事实压成一个「PASS」，导致失败轮数虚高、
「已发布」被当成「已收口」。三个仓内可见的现场：

- **released ≠ archived**：change `fix-ime-composition-selection-nov22` 的代码已随 0.15.0 发布
  （`.local/releases/release-0.15.0/index.md`），但 tasks 3.3 的原生 WKWebView 人工项仍未勾、
  change 仍在活跃列表。
- **测试 oracle 缺陷混入产品失败**：2026-11-27 场景 881 的 r1/r4 判红主因是 AX 判据形态
  （整篇 / 渲染窗口、同文本子节点），不是产品缺陷；REVIEW.md「断言等价于子串」条已记录现场。
  把这类红计成产品回归，会虚高失败轮数。
- **INVALID 被并进 FAIL / 旧证据被当成当前证据**：M743 全量跑的 `summary.md` 头部曾写 FAIL 31，
  而 `results.json` 实为 FAIL 24 / INVALID 7（`scripts/acceptance/lib/evidence.mjs` 的 M745 注释）；
  change `unify-grapheme-backspace-nov19` 的 268 早期 INVALID 之后已由 r7/r8 PASS 覆盖，但原证据目录
  现已缺失——准确口径只能是「归档记录报告 PASS，当前不可复核」
  （`openspec/changes/archive/2026-11-20-unify-grapheme-backspace-nov19/tasks.md:20`）。

根因不是缺测试，而是缺**报告口径**：状态没有分列，失败没有归类，证据可复核性没有限定语。

## What Changes

- **`docs/process/openspec-workflow.md`（canonical）**：新增「状态分列」「证据可复核性」
  「失败与 finding 归类」「新断言的反向必红」四节；节点 2 要件 4 与批次收尾的 finding 对账项挂指针。
  五态为 implemented / released / machine PASS / native PASS / archived；四类为产品缺陷 /
  测试 oracle 缺陷 / 环境 INVALID / 需求或视觉迭代。
- **`docs/process/templates/proposal.md`**：节点 2 记录模板改为五态分列表（值 + 证据指针），
  未发生项写「否 + 原因」。
- **`docs/process/templates/tasks.md`**：验证节新增两项——新断言逐条反向必红实测；节点 2 五态分列
  与失败四类归因。
- **`scripts/acceptance/README.md`**：新增「新断言必须做反向必红实测」作者纪律；证据布局节声明
  索引 PASS 不等于收口状态、FAIL 不等于产品缺陷，并挂到 workflow 的归类与可复核性口径。
- **`docs/process/real-machine-acceptance.md`**：覆盖映射表标注为历史记录，旧证据已清理时不得称
  当前可复核。
- **`docs/process/rendering-defect-contract-first.md`**：属性测试同样要做反向必红实测（一句指针，
  不复制定义）。
- **`docs/process/openspec-workflow.md` 制品清单 + `openspec/README.md`**：标注零行为变更的
  `.openspec.yaml`（`schema: spec-driven` + `skip_specs: true`）例外；本 change 是首个消费者，
  不改产品行为，不走 spec delta。

## Non-goals

- **不改 PASS / FAIL / INVALID 三态与退出码**：`status.txt`、`summary.md` 与退出码 0/1/2 已经正确
  分列「本次运行」的断言结果；本 change 只补报告层的收口状态，不重定义既有语义。
- **不给 finding 新增机器字段或解析器**：`.tower/comms/findings/` 不入 git，新字段没有消费者；
  类别写在 finding 首行 / 报告该行，供人读与批次对账。状态分列表同理不做归档前硬门禁——文本准确度
  不可机器判定，硬解析只会逼出形式化填写。
- **不改写历史**：既有归档记录、旧批次报告与已失效的 `.local` 指针保留原样；引用时加限定语，
  不追溯重算历史失败轮数或复发率。
- 不新增独立流程文档或第二套术语表——四节全部并入现有 canonical 文档。
- 不做真机、不发布；归档按 tower 指令在本 mission 执行（纯文档，`skip_specs` 零 delta）。

## Impact

- 影响的 specs：无（`.openspec.yaml` 设 `skip_specs: true`；本 change 只改流程文档与模板，
  不改产品行为）。
- 影响的文档：上述七个文件 + 本 change 的 `proposal.md` / `tasks.md` / `.openspec.yaml`。
- 影响的代码/系统：无。
- 关联约束：ADR 0004（AI-only 开发，报告是裁决制品）；AGENTS.md「门禁结果的报告口径」；
  仓库信息卫生（示例只用仓内已有指针，不引入真实 vault 内容）。

## 节点 1：批准

- Alex 2026-11-27 已采纳复盘建议（本 mission instructions 明确包含：证据状态分列五态、finding 四类、
  新断言反向必红、老证据只能称归档记录 PASS；本轮复核确认无扩 scope）。
- 批准合同原文要点：
  - implemented / released / machine PASS / native PASS / archived 分列；
  - 产品 FAIL / 测试 oracle 缺陷 / 环境 INVALID / 需求或视觉迭代不混算；
  - 新断言需反向必红输入；
  - 老证据目录清理后只能称归档记录报告 PASS，不能称当前可复核。
- 本 change 按合同落地，未扩 scope。

## 节点 2：归档记录

### 五态

| 状态 | 值 | 证据 |
|---|---|---|
| implemented | 是 | `ff288793`（rebase 后分支 tip；评审绑定 pre-rebase `b4d6a145`，rebase 无冲突、内容未变） |
| released | 否 | 本批不打包；纯文档治理 |
| machine PASS | 是 | `GATE RESULT: 12/12 PASS（SKIP 1）` exit 0（`scripts/gate.sh quick`，日志 `.local/missions/govern-editor-evidence-state-nov27/gate-quick.log`）；`docs-check: PASS`；`validate --all --strict` 39/39（归档前；归档后 38/38） |
| native PASS | 不适用 | 纯文档，无真机项 |
| archived | 是 | 归档提交 `36c01688`；`--archived` PASS（无 `specs/` 增量，无需对账） |

### 归档前（五要件）

1. **方案已批准**：节点 1 Alex 2026-11-27 采纳四项合同（五态 / 四类 / 反向必红 / 老证据限定）；
   实现与复核未扩 scope。
2. **独立 reviewer clean / merge**：verdict `clean / merge` 绑 `b4d6a145`
   （`.local/reviews/govern-editor-evidence-state-nov27/verdict.md`）；按 tower 指令 rebase 到
   `28c97a67` 后 tip `ff288793`，无冲突、本 change 的 diff 未变。
3. **tasks 完成或有放弃理由**：1.x–3.x 全部勾选；4.1 归档步骤勾选；4.2 merge / push 留 tower
   （未勾，理由见 tasks）。
4. **门禁与真机证据**：`validate --all --strict` 39/39；`docs-check: PASS`；quick
   `GATE RESULT: 12/12 PASS（SKIP 1）` exit 0（日志见上）；native PASS 不适用（纯文档，无真机项）；
   未动视觉代码。
5. **规格对账（归档前读数）**：`node scripts/openspec-archive-check.mjs` 门禁模式 PASS
   （`扫过 8 份 delta，7 条 MODIFIED，对比 109 段，无静默丢段；归档队列 0 项已完成 change 均有唯一条目`）；
   `validate --all --strict` PASS；`docs/backlog.md` 归档队列有且仅有一条本 change 条目。
   `skip_specs: true` 零 delta：无 `specs/`、归档为纯目录移动，不伪造规格。

### 归档后（强制完成）

- 归档提交：`36c01688`（`chore(openspec): archive govern-editor-evidence-state-nov27`）。
- 包装器（`node scripts/openspec-archive.mjs govern-editor-evidence-state-nov27`）输出：
  `Task status: 17/18 tasks` / `Warning: 1 incomplete task(s) found. Continuing due to --yes flag.` /
  `Change 'govern-editor-evidence-state-nov27' archived as '2026-11-27-govern-editor-evidence-state-nov27'.` /
  `openspec-archive: 已归档到 openspec/changes/archive/2026-11-27-govern-editor-evidence-state-nov27/`。
  17/18 来自 4.2 merge / push 未勾（tower 执行），不影响归档。
- 修链与链接门禁：`openspec-archive: 归档后修链 0 处（扫过 2 篇 Markdown / 0 条相对链接）`；
  `openspec-links: PASS（校验 711 条相对链接，全部可达）`；
  `openspec-archive: PASS（归档完成，仓内相对链接门禁绿）`。
- 归档后复跑：`validate --all --strict` 38/38；`docs-check: PASS`；quick
  `GATE RESULT: 12/12 PASS（SKIP 1）` exit 0（最终 tip，日志同 `.local/missions/govern-editor-evidence-state-nov27/gate-quick.log`）。
- `node scripts/openspec-archive-check.mjs --archived govern-editor-evidence-state-nov27`：
  `PASS（openspec/changes/archive/2026-11-27-govern-editor-evidence-state-nov27 没有 specs/ 增量，无需对账）`
  （2026-11-27 11:42 CST）。
