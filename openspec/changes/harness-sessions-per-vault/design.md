# Design: harness 会话留存按 vault 分目录

proposal 的技术面：目录布局与身份来源、归属判据的边界、一次性迁移的算法与失败矩阵、验证方法。
本 change **无 UI 面**（会话浮层形态一字不改）、**无原型**，因此没有「视觉保真」一节——机制见
`docs/process/openspec-workflow.md`《有原型时的设计合同：视觉保真必填》（本 change 不满足触发条件）。

## 1. 现状事实锚点（只读调研核实，worktree wt-425 @ e13739a）

布局与写入侧：

- 布局注释：`<config_dir>/harness/sessions/<session_id>.jsonl`（`src-tauri/src/harness/jsonl.rs:7`）；目录 `<config_dir>/harness/sessions`（`:68-82`）；文件命名 `{session_id}.jsonl`（`:99-104`）；`create_new(true)` 防 id 碰撞静默踩文件（`:161-179`）；session id 形态校验 `[a-z0-9-]`、以 `s` 开头、长度 8..64（`:59-66`）。
- 读取侧：`read_session_file` **整文件读入**（`jsonl.rs:249-287`）；`session_id_from_path` 取文件名主干（`:224-228`，与目录层级无关，本 change 不影响）。

消费侧（三处路径拼接 + 一处判据）：

- `harness_resume_session`：`sessions_dir()?.join(format!("{session_id}.jsonl"))`（`harness.rs:334`）、归属校验 `:337`。
- `harness_delete_session`：同形路径（`harness.rs:497`）、归属校验 `:503`；活跃会话拒删靠 writer 的 `session_id_from_path`（`:488`）——与目录无关。
- `list_sessions`：扫平铺目录、对**每个**文件整份读入再按 `vault_root` 过滤（`harness.rs:536-578`）；排序按 session id 倒序（`:576`）。
- 归属判据单一处：`session_belongs_to_scope`（`harness.rs:521-526`）——首行 `session_open.vault_root` 逐字等于 `VaultScope::key()`（`harness.rs:64-68`，vault 根路径字符串）。
- 压缩 / 恢复换文件处用 `session_id_from_path(session.jsonl().path())`（`harness/turn.rs:711`）——也不依赖层级。

身份来源（本 change 的关键依赖）：

- `VaultScope` 只有 `root` + `policy`（`harness.rs:58-62`），由 `vault_scope()` 从 `VaultState::root_and_policy()` 解析（`harness.rs:851-856`）——**当前不带 vault id**。
- vault 稳定 id 在打开路径上**已经在手**：`prepare_vault_open` 调 `reconcile_vault(&root)?`（`commands.rs:427`）并把 `workspace.id` 存进 `PreparedVaultOpen.vault_id`（`commands.rs:385-399`，字段注释即「稳定 vault 身份」）；但 `VaultInner::commit` 解构时用 `..` 把它丢了（`commands.rs:182-199`），`OpenVault` 只留 root + policy（`:150-156`）。
- `vault_current` 会重新对账一次 id 并进前端契约（`commands.rs:254-256`，字段 `vault_id`）。
- id 形态：`vault-<pid>-<单调序号>`（`vault_registry.rs:163-170`）；落盘名 `<id>.json`（`:350`）；`valid_id` 限字母数字 / `-` / `_`、≤128 字节（`:40-50`）。同族命名先例：`vault-sessions/<id>.json`（`vault_session.rs:81-83`）、`reading-positions/<vault 稳定 id>.json`（`reading_position.rs:67-68`，living spec `openspec/specs/vault-workspace/spec.md:449-455` 明文写「vault 稳定 id」）。
- 路径 → id 的只读查询：`find_by_path` 按 **canonicalized 字符串**比对（`vault_registry.rs:267-287`），但现为模块私有；同语义的规范化惯用法是 `is_registered` 的 `path.canonicalize().unwrap_or_else(|_| path.to_path_buf())`（`:289-294`）。

迁移先例与历史证据：

- 目录级一次性迁移的既有形状：`migrate_legacy_registry_dir`（`vault_registry.rs:117-147`，旧目录 `workspaces/` → `vault-registry/`）+ 启动入口 `migrate_legacy_registry_dir_at_startup`（`:149-162`，四态结果 `NotNeeded / Migrated / SkippedTargetExists / Failed`，失败即旧目录原地保留、下次启动重试，**不回退双读**）+ 诊断日志 `logging::vault_registry_migrated`。
- 消毒名方案的前科：`harness/<sanitize(vault 根)>.jsonl` 曾把 `/tmp/a b` 与 `/tmp/a_b` 映成同一文件名，M309 只能改成可逆编码 `_x2ftmp_x2fa_x20b`（`docs/backlog.md:1158-1172`，提交 `bb71054`）——可读性收益归零，撞名面才消失。
- 平铺布局下列举的真实代价：`docs/backlog.md:1101-1121`（M312 现场）记下了「留存文件是平铺的，可经会话列举对照」，也记下「同一目录两种路径拼写各建一个会话」这个**本 change 不修**的既有缺陷。
- 上一代 reshape 的取舍原文：`openspec/changes/archive/2026-10-10-reshape-harness-session-recording/design.md:8-10`（布局图）与 §6.1「留存文件是平铺的，选择器按 vault 过滤」。

## 2. 目录布局与身份

```
<config_dir>/harness/sessions/
├── vault-1234-1/            ← vault 稳定 id（注册表 id）
│   ├── s1759912345678-k3x9ab.jsonl
│   └── s1759912400000-p7q2zz.jsonl
├── vault-1234-2/
└── _orphaned/               ← 保留名：迁移搬不动的东西（见 §4）
```

- **目录名 = vault 稳定 id**（裁决点 1）：与 `vault-sessions/<id>.json` / `reading-positions/<id>.json` 共用一份身份；不引入新的 id 形态（不 hash、不消毒、不加前缀）。
- **id 的来源不新造查表**：harness command 层解析 scope 时把 id 一起带上——`commit` 不再丢弃 `PreparedVaultOpen.vault_id`（`commands.rs:182-199`），`OpenVault` 存下、`root_and_policy` 的姊妹口（或 `VaultScope` 多一个字段）供 harness 读取。**已打开的 vault 恒有 id**（打开路径 `reconcile_vault` 是登记点，`commands.rs:427`），因此会话写入路径没有「id 缺失」分支。
- **不表意的代价与补偿**（如实报）：`vault-1234-1` 看不出是哪个 vault。补偿是一条命令即可对照（目录名 ↔ 路径）：

  ```bash
  for f in ~/.config/lumir/vault-registry/*.json; do
    printf '%s\t%s\n' "$(basename "$f" .json)" "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["path"])' "$f")"
  done
  ```

  这条对标方案（消毒名）做不到的原因是它自身有撞名面（见 §1 最后一段），而「一眼可读」在撞名后即失效。
- **保留名 `_orphaned`**：`valid_id` 的字符集允许 `_orphaned`，但后端产出的 id 形态恒为 `vault-<pid>-<n>`（`vault_registry.rs:163-170`）；实现侧在「id → 目录名」处做一次显式校验（`valid_id` 通过且不等于 `_orphaned`），不通过即按下节 `_orphaned` 路径处理并记日志——不 panic、不静默（REVIEW.md 第 9 条：声明即被消费）。

## 3. 归属判据：不变，目录只作组织维度

- 唯一归属判据仍是首行 `session_open.vault_root`（`session_belongs_to_scope`，`harness.rs:521-526`，**一字不改**）。目录不是判据：手工把文件挪进别的 vault 目录，列举会跳过它、恢复会拒它（`harness_session_vault_mismatch`），归属结论不受文件位置影响。
- 理由：目录若成判据，就出现同一语义的第二真源（REVIEW.md 第 8 条），且「改文件位置即改归属」是配置目录这个可手工编辑面上的坏性质。
- **本 change 不修 M312**（同一 vault 的两种路径拼写各建会话，`docs/backlog.md:1101-1121`）：迁移会按规范化路径查注册表，把两种拼写的文件**归入同一个目录**，但字符串判据不变——那种拼写下的会话照旧不出现在浮层（症状不变，不新引入错误面）。M312 的修法在打开路径的规范化，属另一个 change。

## 4. 一次性迁移

- **时机**：启动时同步跑完，**早于任何 harness 读者**（会话列举 / 恢复 / 删除 / 新建句柄都在用户操作之后，故 setup 内跑完即安全）。与 M248 的注册表目录迁移同形（`vault_registry.rs:149-162` 的调用点纪律）。
- **算法**（逐文件、幂等）：
  1. 扫 `sessions/` 根下的 `*.jsonl`（目录条目不动——它们已是新布局）；
  2. 读首行 `session_open` 取 `vault_root`；
  3. `vault_root` → 规范化 → 查注册表（复用 `find_by_path` 的比对语义，实现期以 `pub(crate) fn id_for_path` 暴露，规范化沿用 `is_registered` 的同一惯用法）；
  4. 命中 → `fs::rename` 到 `sessions/<id>/`（同目录树内移动，原子；目标目录按需 `create_dir_all`）；
  5. 任一步失败 / `vault_root` 缺或不可解析 / 注册表无该项 / 目标已有同名文件 → `fs::rename` 到 `sessions/_orphaned/`。
- **不变量**：迁移结束时 `sessions/` 根下零 `*.jsonl`（唯一例外：rename 失败留原地待重试的文件——见「失败处置」）；每个文件要么在某个 vault 目录里、要么在 `_orphaned/`、要么是待重试的失败者；任何文件都不被改写（rename 只换位置，字节不变）。
- **失败处置**：单文件 best-effort——失败只跳过、留原地、打 stderr，下次启动重试（幂等保证重试安全）。结果落一条诊断日志（仿 M248 的四态：无事 / 已迁移 N 个 / 有孤儿 / 失败），使「日志里没有这一行」与「没做迁移」事后可区分。
- **并发**：启动时内存态会话尚不存在（`Runtime::sessions` 是进程内映射，随会话建立才惰性建文件，`jsonl.rs:84-92` 与 `harness.rs:111-140`），因此没有在写的文件被搬走；writer 的 `create_new(true)` 语义不受布局影响。若进程被杀在迁移中途，残局是「部分文件已归位、部分在根下」——幂等重跑收敛，无需事务。

## 5. 单读（不做双读 / 兼容层）——为什么否掉「迁移失败才回退」

- 决策依据是 REVIEW.md 第 21 条「消费者是谁」：本仓留存**零外部消费者**、单用户、探针期契约，兼容层保护的对象举不出来。
- 双读的具体代价：① 并存期**无界**——只要有一个文件搬不动（或下次启动前用户又手放了一份），平铺布局就被永久当第二真源读；② 写路径出现两处落点（列举要合并两处结果、删除要两处查找），「同一语义两处真源」的经典形态；③ 与 M248 的既有口径不一致（那里失败即留原地 + 下次重试，不回退）。
- 因此：迁移完成后只读 `sessions/<vault 稳定 id>/`；根下残留（只可能来自迁移失败）**不参与列举**，其可见证据是 stderr 与诊断日志，恢复手段是下次启动重试。
- 与 mission 原设想的差异如实记录：M425 mission 的裁决点 ③ 写的是「迁移失败才回退」，本提案收紧为「失败即留原地 + 下次启动重试、不双读」，理由如上。

## 6. 边界矩阵

| 情况 | 处置 |
|---|---|
| 首行合法且 `vault_root` 命中注册表 | 移入 `sessions/<id>/` |
| 首行合法但注册表无该路径（vault 已被手工移除注册项 / 卷未挂载） | `_orphaned/` |
| `vault_root` 是相对路径 / 空 / 非字符串 | `_orphaned/` |
| 文件不可读 / 首行不是 `session_open` / 首行非法 JSON | `_orphaned/` |
| 目标 `sessions/<id>/<session_id>.jsonl` 已存在 | 不覆盖——移入 `_orphaned/`（归属歧义下宁可不动，留存是审计事实） |
| 根下条目是目录（已是 vault 目录 / `_orphaned/`） | 不动（迁移只处理 `*.jsonl`） |
| 单文件 rename 失败 | 留原地 + stderr + 下次启动重试 |
| 会话写入时 id 解析失败（理论上不可达：打开的 vault 必有 id） | 不静默丢：按本节口径记日志，不建文件（对话继续）——实现期若证明不可达，用 debug 断言替代分支 |

## 7. 验收面（机器判定锚点）

- **迁移正确性属性测试（核心判据，Rust）**：迁移内核按参数注入两个入参——`sessions/` 根目录与「路径 → id」解析器（stub）——**零环境变量扰动**（REVIEW.md 第 13 条：不改 `XDG_CONFIG_HOME`，`Cargo` 并行跑）。属性：对任意一组合成 `session_open` 首行（含需规范化的拼写、注册表里没有的路径、相对路径、畸形首行）与任意输入文件集，断言每个文件落在**预期**位置（vault 目录或 `_orphaned/`）、根下零 `*.jsonl`（注入 IO 失败时改为断言「失败者留原地、再次运行收敛」）、文件字节不变、二次运行零搬运（幂等）。**反向验证**（REVIEW.md 第 1 条）：把归属映射故意写错 / 去掉规范化一步，断言必红。
- **路径与范围集成断言**：`src-tauri/tests/session_recording.rs` 更新为「新会话落在 `<vault 稳定 id>/` 下」；新增用例「vault A 与 vault B 的会话互不可见（列举范围）」与「恢复 / 删除在 id 目录内命中」。
- **真机验收**：21 个场景共 70 处 `env:harness` 引用逐处核对（实测分布：64 处 `sessions/*.jsonl` 的 file 断言 glob、4 处 `sessions` 目录形态、2 处 `sessions/`——即全部落在留存路径上，无 `config.json` 一类混入），glob 改为 `<vault 稳定 id>/` 层级；新增或扩展一个场景覆盖「两个 vault 各落各目录 + 浮层只见其一」；迁移的现场核验落成场景（预置平铺文件 + 一个不可归属文件 → 启动 → 断言归位与 `_orphaned/`），证据落 `test-results/`（本地留存、git 外）。`scripts/acceptance/lib/app.mjs:143-154` 的 `resetHarness` 已是整目录递归删除（`lib/` 下无别的路径拼接代码，已核），新布局天然被清；`scripts/acceptance/lib/app.mjs:144-148` 与 `scripts/acceptance/README.md:193-195` 的路径文档一并改准。
- **视觉**：本 change 无 UI 面、不动 `src/style.css` / `src/preview/**` / `tests/visual/scenes/**`，**不产生视觉基线改动**；`scripts/gate.sh quick` 为准（动过 ts-rs 导出面时按既有纪律先 `git add` 重导出产物）。
- **手工核对项（实现期）**：`harness-composer-image-paste` 若在 harness 侧落附件字节，落点须落在同一 vault 目录层级（proposal「排依赖」）。

## 8. 明确不实现（防 scope 蔓延）

会话索引文件、清理 / 保留策略、完整会话管理 UI、`_orphaned/` 的管理与再归属、M312 的路径规范化、跨 vault 聚合视图、id 形态改动。详见 proposal 的 Non-goals。
