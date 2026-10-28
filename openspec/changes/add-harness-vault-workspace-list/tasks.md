# Tasks: add-harness-vault-workspace-list

> 节点 1 已由 Alex 2026-10-27 裁决（原话见 proposal 文首）。实现按下面顺序落地，逐项勾选并附证据
> （文件路径 / 测试名 / 命令输出行）。真机项（5.1 / 5.5）按 tower 排期执行，不提前占用真机窗口。

## 1. 文档与规格

- [x] 1.1 修订 `docs/adr/0007-ai-positioning-probe.md` Decision 7：判据改为「核心领域的稳定动作优先
      结构化工具」、工具清单 8 + 1 + 3 → 9 + 1 + 3、`vault_list` 入册、工作区合同（上下文 / 执行 /
      判定三层）、Revisit 第三分支第三次消费记录
- [x] 1.2 两份 spec delta（`openspec/changes/add-harness-vault-workspace-list/specs/`）：harness
      3 ADDED + 4 MODIFIED，harness-subagents 1 MODIFIED；MODIFIED 块按 living 整块复制后定点修改
- [x] 1.3 `docs/backlog.md` 记一条待裁决：子代理缺省工具集是否从只读三件扩到含 `vault_list`
      （缺省集在 `agents.rs`，本 change scope 外）

## 2. 上下文层（绝对根 + 路径边界）

- [x] 2.1 新增 `src-tauri/src/harness/prompts/workspace-reference.md`：`{{VAULT_ROOT}}` 占位符 +
      路径边界纪律（`vault_*` 相对 / `cli_run` 从根启动 / 外部目标绝对 / 不用 `pwd`、`ls /`、广域
      `find` 探测工作区）
- [x] 2.2 `context::assemble_with_identity` 注入「工作区」段：代入根路径、trim 尾空白、位置在
      identity（及子运行的委托约束）之后、quote_reference 之前；装配清单加 `workspace` 条目
      （模板仓内相对路径、`exists: true`、代入后字节数）
- [x] 2.3 `identity.md` 加首选工具链两句：找文件 / 目录先用 `vault_list` 再 `vault_read` /
      `vault_search`；不用 `pwd` / `ls /` / 广域 `find` 探测 vault 位置
- [x] 2.4 单测：交互 / 子代理装配均含绝对根与边界句；清单条目字段正确；两个 vault 互不含对方根；
      固定段顺序断言更新（含 `manifest.len()` 8 → 9 的既有断言）

## 3. 执行层（`cli_run` 独立 cwd）

- [x] 3.1 `tools::execute_with_revision` 把 `ctx` 传给 `cli_run`；spawn 时设
      `current_dir(&ctx.root)` 与 `env("PWD", ctx.root)`；不引入 `set_current_dir`、不加 `cwd` 参数
- [x] 3.2 单测：`pwd` 输出 == 测试 vault 绝对路径；调用前后主进程 `current_dir()` 相等；两个测试
      vault 各自返回自己的根；`PWD` 与 cwd 一致

## 4. 判定层（相对写目标同一根）

- [x] 4.1 重写 `permissions::vault_relative`：删除「目标 / 父目录是否存在」佐证；相对目标（无 `..`）
      无条件视为 vault 内；绝对路径按根 containment；symlink 否决改为「自身或最近已存在祖先
      canonicalize 后须在根内」
- [x] 4.2 单测矩阵：根目录新文件 / 嵌套新文件 / 既有文件（`vault_write` 与 `full_access` 均
      `Redirect`）；`..` / 根外绝对路径 / 根外 symlink 不重定向；根内绝对路径 targets 为相对
- [x] 4.3 回扫既有 `permissions.rs` 测试与注释里依赖「相对目标存在性」的用例，逐条改到新判据
      （旧注释 `tools.rs 现行 spawn 不设 current_dir` 同步更新）

## 5. `vault_list`

- [x] 5.1 `tools::TOOL_NAMES` 8 → 9、`definitions()` 增 `vault_list` schema（`path` / `recursive` /
      `path_glob` / `limit` / `cursor`）、`permission_subject` 取 `path_glob` 否则 `path`
- [x] 5.2 `permissions::READ_TOOLS` 加 `vault_list`（三档直接放行）
- [x] 5.3 实现：`fs_io::scan_workspace` 一次扫描 + `path` 前缀过滤（默认一层 / 递归）+ `path_glob` +
      码点排序 + `limit`（缺省 200 / 上限 1000 / <1 按 1）+ `cursor`（严格大于）+ `truncated` /
      `next_cursor`；`path` 校验与错误码（绝对路径 / 逃逸 / 不存在 / 不是目录）
- [x] 5.4 单测：默认一层、递归、glob、排序、三页拼接无重无漏、truncated 与 next_cursor 配对、
      hidden 不出现、lazy 不展开、越界 / 非法目标、结果不含正文与元数据；`vault_list` 三档 auto-allow
- [x] 5.5 工具计数断言与文档同步：`TOOL_NAMES.len() == 9`、cron 白名单 / 子运行闭集合随之变化

## 6. 验收与门禁

- [x] 6.1 真机场景 `scripts/acceptance/scenarios/254-harness-vault-workspace-list.md` + fixture：
      system 工作区段与清单条目、`pwd` 返回验收 vault、`vault_list` 一层结果 + ignore 生效 +
      `vault_read` 读到 sibling、全程无批准卡
- [x] 6.2 `node scripts/acceptance/coverage.mjs` 重生成 `COVERAGE.md`，`--check` 通过
- [x] 6.3 回扫既有验收场景的闸期望与工具计数（`231` / `75` / `110` / `111` / `151` / `212` /
      `229` 等含权限或提示词断言的场景），确认本 change 不改变它们的期望；改到的补理由
- [x] 6.4 `cargo test`（`src-tauri`）、`pnpm test`、`openspec validate --all --strict`、
      `node scripts/acceptance/run.mjs --check`、`node scripts/docs-check.sh`、`scripts/gate.sh quick`
      （动过视觉面才跑 `visual`——本 change 不动 `src/**`，预期 SKIP）
- [ ] 6.5 真机跑 254 场景取 PASS 证据（落 `.local/acceptance/`）
- [ ] 6.6 真实 provider 用原始「评审 proposal 并查看相关文件」场景抽样复验：无 `pwd` / 广域 `find`
      探测，`vault_list` 被首选（抽样观察，不进机器判据）
- [ ] 6.7 独立评审（reviewer clean / merge 且绑定 tip）+ 按五要件填 proposal 的节点 2 记录

## 实现批证据（2026-10-28，worker 自验）

- `scripts/gate.sh quick` → `GATE RESULT: 12/12 PASS（SKIP 1）`，退出码 0（SKIP = `tsc-visual`，本
  worktree 未装 `tests/visual` 依赖；本 change 不动 `src/**`，视觉门禁不在本轮范围）。
- `cargo test`（`src-tauri`，lib + 6 个集成 crate）exit 0；`cargo fmt --check` 与
  `cargo clippy --all-targets -- -D warnings` 各自 PASS。
- `openspec validate --all --strict` → `✓ change/add-harness-vault-workspace-list`，36 项 0 failed。
- `node scripts/acceptance/run.mjs --check` 与 `node scripts/acceptance/coverage.mjs --check` PASS
  （231 场景 / 210 item）。
- `scripts/docs-check.sh` PASS（ADR 结构 + OpenSpec 链接 + 归档对账 + 验收契约与覆盖表 + backlog 出口）。
- 待办：6.5–6.7 属**排期 / 他人阶段**——真机批按 tower「真机不提前做」的口径等待窗口；抽样复验依赖
  真机；独立评审与归档审计由 reviewer / tower 执行。
