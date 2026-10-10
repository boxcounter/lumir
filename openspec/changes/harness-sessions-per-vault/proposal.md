# Proposal: harness 会话留存按 vault 分目录

- Change ID: harness-sessions-per-vault
- 日期: 2026-10-10
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录：
> 节点 1（提案评审）：留白（待 Alex 裁决）。
> 节点 2（归档评审）：留白（实现完成后填写）。

## Why

Alex 原话（2026-10-10）：「harness session JSONL 是否按 vault 分目录存放，而不是平铺在 `~/.config/lumir/harness/sessions` 目录下，这样也许方便我找特定 vault 的会话进行分析」；同日裁决：「改，按 vault 分目录」。

现状：每会话一个文件平铺在 `<config_dir>/harness/sessions/`（即 `~/.config/lumir/harness/sessions/`）下（布局注释 `src-tauri/src/harness/jsonl.rs:7`、目录 `:68`、命名 `:104`）。留存本身没有问题（wire 形态、恢复充分性口径都在），问题全在**组织维度缺失**：

1. **人要找某个 vault 的会话，只能 grep**：会话的 vault 只在文件首行 `session_open.vault_root` 里，目录层面看不出谁是谁。会话数一多，`ls` 就是一串无语义的 `s<时间戳>-<随机>.jsonl`。
2. **列举要为「不列别的 vault」付全量读盘**：`list_sessions` 扫平铺目录、对**每个**文件整份读入（`read_session_file` 整文件读取，`jsonl.rs:249`）再按 `vault_root` 过滤（`harness.rs:536-578`）——别的 vault 的会话文件也被完整读一遍然后丢掉。
3. **以 vault 为单位的批量处置（备份 / 归档 / 清理）在平铺形态下不可做**：只能逐文件判定。
4. 与配置目录里既有的「按 vault 分置」家族（`vault-registry/<id>.json`、`vault-sessions/<id>.json`、`reading-positions/<id>.json`）形状不一致；harness 留存是唯一还平铺的一类。

本 change 只动**布局**（文件摆在哪），不动记录形态（schema、不变量、恢复充分性口径一字不改）——留存是审计事实，重塑它的动机与本次无关。

## What Changes

每条对应 `specs/harness/spec.md` 增量中的一个 requirement：

1. **会话本地留存**（harness，MODIFIED）：留存路径从 `sessions/<session_id>.jsonl` 改为 `sessions/<vault 稳定 id>/<session_id>.jsonl`——目录名取 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名。新增三条纪律：① 会话文件的 vault 归属**判据不变**，仍是首行 `session_open.vault_root`，目录只作组织维度、MUST NOT 成为第二真源；② 存量平铺文件的一次性归位由**仓内脚本**完成（`scripts/` 下，手动跑一次即弃，见裁决点 2）——脚本按各 `*.jsonl` 首行 `session_open.vault_root` 归入对应 vault 目录，不可归属者进保留目录 `_orphaned/`，幂等由脚本自身保证，**产品运行时零迁移代码**；③ 产品运行时只读新布局（`sessions/<vault 稳定 id>/`），MUST NOT 含迁移逻辑、MUST NOT 读平铺在 `sessions/` 根下的 `*.jsonl`（无旧布局双读 / 双写过渡层）。对应场景：留存落盘（路径更新）、新增三个场景（按 vault 分置与列举范围 / 平铺文件一次性归位——触发改为「手动跑一次性脚本」 / 不可归属者进孤儿桶）、「旧文件孤儿化」（场景名保留——validator 要求 MODIFIED 不得丢基线场景名——内容收紧为「上一代**聚合**形态不做迁移」，与脚本归位的平铺文件区分开）；其余四个场景（废弃 kind / 装配记录 / 恢复充分性 / 思考落盘与回放）逐字不变。

## Alex 裁决点

| # | 裁决点 | 选项 | 起草倾向 |
|---|---|---|---|
| 1 | 目录名 | A. vault 注册表 id（`vault-<pid>-<n>`）；B. vault 路径派生的消毒名 | **倾向 A**——① 与 `vault-sessions/<id>.json` / `reading-positions/<id>.json` 共用同一份身份，配置目录里「一个 vault 实体一个 id」不再有第二套命名；② 消毒名有实证碰撞面（`/tmp/a b` 与 `/tmp/a_b` 同名，M309 只能改可逆编码 `_x2ftmp_x2fa_x20b`——读不出人味，可读性的收益也没了），撞名与字符集/长度问题在 A 下不存在；③ 目录名不含真实路径，配置目录里不留真实目录名（信息卫生）。**代价如实报**：id 不表意，`ls` 看不出哪个目录是哪个 vault，要对照 `vault-registry/<id>.json`（design §2 给一行命令）；Alex 原话的「方便找」靠的是「一个 vault 一个目录 + 目录内即全部」这个结构，不是靠目录名 |
| 2 | 迁移策略 | A. 启动一次性迁移（读首行 `vault_root` 归位，M248 同形）；B. 不做迁移，平铺文件按 M309 孤儿先例弃置；C. 懒迁移（首次列举 / 首次写入时）；D. **仓内一次性脚本**，手动执行一次即弃（产品运行时零迁移代码） | **裁决：D**——Alex 原话（2026-10-10）：「迁移不用写进产品里，写一个脚本执行。一次性的工作就不进入产品了。」理由：归位是**一次性**动作，产品不该长期背一段只在升级后跑一次、且永不删除的迁移代码；脚本能拿到与产品同样的信息（各文件首行 `vault_root` + `vault-registry/*.json` 的路径），做同一件事，却不占产品运行时面。**否掉 A**（起草原倾向）：A 要把迁移入口、`lib.rs` setup 调用点、诊断日志一并做进产品，正是一次性工作进产品的反面样本；M248 同形也不能作为依据（M248 迁的注册表目录是产品必须继续维护的形态，harness 留存只在升级一次时需归位）。**否掉 B**：会丢 Alex 已有的会话历史（与「旧聚合形态无读者可弃」不同，本代平铺文件是**在办能力**的产物，扔了就是真的丢数据）。**否掉 C**：把一个「跑一次」的事摊到三个读者路径上，且「第一次列举」与「第一次提问」谁先到不确定，幂等反而更难保证 |
| 3 | 并存期读法 | A. 脚本归位后产品只读新布局（脚本没搬动的残留不参与列举，重跑脚本收敛）；B. 双读新旧两处（过渡期兜底） | **倾向 A**——REVIEW.md「消费者是谁」：本仓留存零外部消费者、单用户，兼容层保护的是一个不存在的对象；双读会把「并存期」变成**无界**（任何一个搬不动的文件会被永远当第二真源读），还会让「删除会话」这类写操作出现两处落点。**与脚本方案对齐**：残留的可见证据是脚本自报的输出与目录结构本身，恢复手段是**重跑脚本**——产品运行时不再有「下次启动重试」。**修正说明**：M425 mission 的原设想是「迁移失败才回退」，本提案收紧为「失败即留原地 + 重跑脚本、不双读」，理由同为「消费者是谁」 |
| 4 | 归属判据（起草补充） | A. 目录取代 `vault_root` 成为归属判据；B. 判据不变（`session_open.vault_root`），目录只作组织维度 | **倾向 B**——A 会让「文件在哪」变成归属的第二真源：手工挪动 / 拷贝一个文件即改变它的归属，恢复与删除的拒绝语义（`harness_session_vault_mismatch`）也随之失效。B 零改动现有 `session_belongs_to_scope`（`harness.rs:524-526`），并且**明确不修** M312（同一目录的两种路径拼写各建会话，backlog 有在办条目）——M312 的修法是打开路径规范化，属另一个 change；本次一次性脚本会把两种拼写的存量文件归入同一个目录，但字符串判据不变，M312 的可见性症状不因本 change 改变 |

## Non-goals

- **修 M312（vault 路径规范化）**：归属判据不变（裁决点 4），M312 的修法在打开路径，另立 change。
- **改留存记录形态**：schema / 不变量 / 恢复充分性口径一字不改（记录是审计事实，本 change 只换位置）。
- **兼容层 / 双写 / 过渡期**：见裁决点 3。
- **把迁移做进产品运行时**：归位是仓内一次性脚本的事（裁决点 2），`src-tauri/` MUST NOT 引入迁移入口 / 启动钩子 / 旧布局读取路径。
- **会话索引文件**：列举仍直接扫目录，不引入索引（探针期口径不变）。
- **保留期 / 清理策略 / 容量管理**：会话文件仍不自动清理。
- **完整会话管理 UI**（重命名 / 搜索 / 分组 / 跨 vault 视图）：探针期口径不变。
- **`_orphaned/` 的管理与再归属**：孤儿桶是保底存放处（不删不改写），不在 UI 露出、不做人工再归属工具；需要时另裁。
- **harness 侧附件字节的落盘位置**：属 `harness-composer-image-paste` change（见「排依赖」）。
- **vault id 体系本身**：不引入新 id 形态、不改注册表。

## Impact

- 影响的 specs：`harness`（MODIFIED ×1：会话本地留存）
- 影响的代码/系统（概述，不写实现细节）：
  - 身份落点：`src-tauri/src/commands.rs`（`PreparedVaultOpen.vault_id` 已在场但 `commit` 丢弃，实现期把它存进 `OpenVault` 并给 harness 一个读口）、`src-tauri/src/harness.rs`（`VaultScope` 携带 vault id）
  - 路径与扫描：`src-tauri/src/harness/jsonl.rs`（`sessions_dir` 收 vault id 参数、文件命名）、`harness.rs`（`list_sessions` / `resume_session` / `delete_session` 三处路径拼接与扫描范围）
  - 迁移：**产品侧零改动**——归位由仓内一次性脚本完成（`scripts/` 下，读各 `*.jsonl` 首行 `vault_root` + `vault-registry/*.json` 的路径匹配；手动执行一次即弃）；`src-tauri/` MUST NOT 新增迁移入口 / setup 钩子 / 旧布局读取路径
  - 测试与验收：`src-tauri/tests/session_recording.rs`；验收套件 21 个场景里 `env:harness/sessions/*.jsonl` 形态的 file 断言 glob；`scripts/acceptance/README.md` 与 `lib/app.mjs` 的路径文档（`resetHarness` 已是整目录递归删除，新布局天然被清）
  - 注释/文档漂移：`src/ipc.ts`、`src-tauri/src/harness/session.rs`（ts-rs 文档注释经 `src/bindings/SessionSummary.ts` 导出）
- 关联约束：ADR 0003（MUST NOT 写 vault）、ADR 0007（记录机制本地一侧）、ADR 0002 §5（配置即数据）、REVIEW.md 第 21 条（消费者是谁：默认直接切断）、第 8 条（同一语义两处真源）、第 13 条（验收隔离与串场）、仓库信息卫生（目录名不含真实路径，验收 fixture 全合成）

## 排依赖

- **`harness-composer-image-paste`**（与 M425 并行在途的提案）：若该 change 的贴图字节落在 **harness 侧**文件（而非 vault 内或编辑器附件通道），其落点须采用本 change 的 `<config_dir>/harness/sessions/<vault 稳定 id>/` 层级；两个 change 谁后落地谁顺——本 change 先落地则那边按新层级写，那边先落地则本 change 的一次性脚本要把它产生的文件一并考虑（在该目录下的文件不是会话 JSONL，脚本只处理 `sessions/` 根下的 `*.jsonl`，两者不冲突）。此事在实现期核对一次即可，不构成本 change 的前置。
- 本 change 与 pane / 视觉面零交集（无新 UI、无视觉基线改动）。

## 观测闸三问（低成本口径）

- **怎么知道它生效**：`ls ~/.config/lumir/harness/sessions/`（即 `<config_dir>/harness/sessions/`）应只见 vault 目录（每个 vault 一个，必要时加 `_orphaned/`），根下零 `*.jsonl`；目录名与 `vault-registry/<id>.json` 的 `path` 对照即知哪个 vault。
- **怎么知道它有效**：dogfood 期 Alex 找某个 vault 的会话时是否需要 grep / 打开别的 vault 的文件——「一个 vault 一个目录，目录内即全部」是否真的比平铺好找；取证面是目录结构本身，无需埋点。
- **出问题怎么发现**：分两层——**运行时面**靠机器兜底：新布局落盘断言、两 vault 会话互不可见的集成断言、`session_belongs_to_scope` 判据不变的断言、验收场景的路径断言更新；**脚本面**靠脚本自身：归位正确性测试（任意 `session_open` 首行 → 落到正确 vault 目录，含反向验证必红）、幂等性断言、`sessions/` 根下零 `*.jsonl` 的终态断言（失败留原地路径另断言重跑收敛）。产品运行时不含迁移，故「日志里有没有迁移行」不再是判据——判据下沉到脚本的自报输出与目录结构本身。
