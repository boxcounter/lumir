# Tasks: fix-wikilink-unindexed-duplicate-nov22

> 阶段门：节点 1 已由 Alex 授权（安全拒绝方向已确认，无产品裁决点）。实现期发现意图需要变更时
> 停下更新 proposal 并重走节点 1，不静默扩 scope。`openspec/specs/**` 活跃期只读；规格变更
> 只写本 change 的 delta。
>
> 测试纪律：先红后绿——先在旧行为（命令只调 `create_note`）下跑新测试并留存 7 条 FAIL 的现场，
> 再实现探测转绿。红证据见任务 2.4 的备注。

## 0. 提案

- [x] 0.1 起草 `proposal.md` / `design.md` / 本文件 / 两份 spec delta
- [x] 0.2 节点 1：Alex 已授权（防重复修复按安全拒绝方向实施；无新增产品裁决）。
      只读方案（现状取证、最小方案、测试矩阵、剩余边界）作为节点 1 材料
- [x] 0.3 把授权与裁决点（D1–D4）回填 proposal 的「评审记录」与「裁决点」

## 1. 有界扫描（`src-tauri/src/fs_io.rs`）

- [x] 1.1 `ProbeBudget { max_entries: 20_000, max_duration: 250ms }` + `Default`（实现初值，
      注释写明「待实测，不是性能结论」）
- [x] 1.2 `ProbeScan { files, complete, incomplete_reason }`
- [x] 1.3 `scan_vault_for_wikilink_target`：递归配置 `lazy` 与用户规则目录、`hidden` 档整棵
      剪枝、符号链接不跟随且按非目录候选、读取失败 / 超限 fail-closed、不登记 materialized、
      不读正文 / 新 `.gitignore`
- [x] 1.4 单测：递归口径与 hidden 剪枝；条目 / 时长预算；目录不可读；符号链接目录与环不递归、
      链接按候选列出、不读目标

## 2. 命令两阶段（`src-tauri/src/commands.rs`）

- [x] 2.1 `wikilink_create` 改 `async fn` + `spawn_blocking`；短持锁取 root / policy /
      generation 并跑 `create_target`
- [x] 2.2 `probe_unindexed_duplicate`：临时 `LinkGraph` + `resolve_link`；resolved / ambiguous
      都拒绝；冲突优先于「扫描不完整」
- [x] 2.3 `finish_create_in_same_generation`：root + generation 对账后调用原 `create_note`
      （O_EXCL 与原语不变）
- [x] 2.4 单测（先红后绿）：配置 / 用户规则惰性目录拒绝且零新增、既有字节不变；多候选不选择；
      大小写 / alias / heading；路径后缀；真正不存在仍创建；小预算 fail-closed；目录不可读；
      hidden 不参与；符号链接目录不跟随 / 链接文件构成冲突；索引过期不覆盖；代际变化零误写
      —— **红证据**：旧行为下 7 条 FAIL（`created: "Note.md"` / `"team/note.md"` /
      `"NOTE.md"`；小预算照建），实现后 18/18 PASS
- [x] 2.5 既有 `create_never_overwrites_existing_file`、`create_rejects_symlink_parent_escape`
      与 `createCases` 原样保留（`create_note` 语义未变）

## 3. 规格 delta

- [x] 3.1 `specs/wikilink-resolution/spec.md`：MODIFIED「未创建目标一键创建」——补探测条款
      （覆盖范围、复用 resolver、拒绝口径、有界 / 无副作用、代际对账、fail-closed）与 7 个场景
- [x] 3.2 `specs/fs-io/spec.md`：MODIFIED「全类型递归枚举」——已知边界段删掉「`wikilink_create`
      可能造出重复文件、本 change 不改」，改为探测事实（整条 requirement 原文复制后只改该段）

## 4. 真机验收

- [x] 4.1 新增合成场景 `scripts/acceptance/scenarios/708-wikilink-create-lazy-duplicate.md`
      （惰性 fixture 的同名笔记 + 根文档 `[[tutorial]]`；点「创建并打开」→ D192 toast、
      仍在原文档、vault 零新增；既有惰性笔记的 sha256 + mtime 不变，磁盘正文可读作正见证）
- [x] 4.2 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`
- [x] 4.3 真机跑该场景取 PASS 证据（`.local/acceptance/2026-11-23-wikilink-duplicate/`）
      —— **PASS**：13.9s；D192 拒绝、仍在原文档、根目录零新增、既有笔记 sha256 + mtime 不变、
      磁盘正文正见证均通过。前两次场景装置 FAIL 已修正：链接落点移到首行、按钮改角色判据、
      惰性正文改磁盘直读；产品代码未因这两次装置失败改动。

## 5. 门禁

- [x] 5.1 `cargo fmt --check` / `cargo clippy --all-targets -D warnings`：PASS（gate 的
      cargo-fmt / cargo-clippy 两项）
- [x] 5.2 相关 Rust 测试全量：`cargo test` 全绿——lib 1036 passed / 0 failed / 1 ignored；
      `wikilink_fixtures`（`create_cases_all` / `create_never_overwrites_existing_file` /
      `create_rejects_symlink_parent_escape`）全 PASS；`link_graph_index` 2 passed
- [x] 5.3 `scripts/gate.sh quick`：`GATE RESULT: 12/12 PASS（SKIP 1）`（退出码 0；SKIP 为
      tsc-visual，依赖未装，与本次改动无关）
- [x] 5.4 `git diff --check`：PASS（退出码 0）；未 commit（合并流程由 tower 执行）

