# Proposal: rg 的 -z / --search-zip 补进危险档

- Change ID: `rg-zip-flags-dangerous-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**Alex 已批准立项**（2026-10-24 对 finding 立项请示的原话「好，可以。」）。
> 来源是 M664（`readonly-allowlist-tightening-oct23`）worker 发现的 finding：
> `.tower/comms/findings/20261024-worker-readonly-allowlist-oct2-vuln-rg-z-search-zip-readonly-allowlist.md`。
> 本 proposal 按该裁决起草，无待裁裁决点。
> 节点 2（归档评审）：**机器 + 独立评审放行（五要件）**，2026-10-25。放行口径见
> `docs/process/openspec-workflow.md`「节点 2」节；本 change 是权限链第三环（permission-rules →
> readonly → rg-zip），归档批 M729 执行。归档前读数：
> 1. **方案已批准**：节点 1 于 2026-10-24 由 Alex 批准立项（原话「好，可以。」，见上）；本 proposal
>    无待裁裁决点，实现与提案同批提交。
> 2. **独立 reviewer clean / merge**：实现批
>    `review-feat-rg-zip-flags-dangerous-tier-oct24-reviewer-rg-zip-flags-oct24-r1.md`
>    （`status: clean` / `merge: merge`，评审 tip `a9635767`，M672）；delta 的 2026-10-24 重写另经
>    `review-feat-align-permission-followup-deltas-oct24-reviewer-permission-deltas-oct-r1.md`
>    （`status: clean` / `merge: merge`，评审 tip `31603339`，M724）。该 tip 之后本 change 目录逐字
>    未改（`git diff 31603339 HEAD -- openspec/changes/rg-zip-flags-dangerous-oct24` 空）。
> 3. **tasks 完成**：13/13（无未勾项）。
> 4. **门禁与证据**：tasks 3.3 `GATE RESULT: 10/10 PASS（SKIP 1）`、退出码 0（SKIP = `tsc-visual`，
>    worktree 未装 `tests/visual` 依赖）；tasks 3.4 `cargo test` 逐 target 839 + 7 + 41 + 2 + 17 + 6 +
>    22 pass / 0 failed。本 change **未声明真机场景**——它只改分类器枚举，判据落在 Rust 单测（正向
>    `-z`/`--search-zip`/`-zH`·`-nz`、反向 `--no-search-zip`/`-ez`/裸 `rg`）、包装器继承用例与三档
>    决策矩阵；tasks 无真机项，故无真机证据缺口。
> 5. **规格对账**：`node scripts/openspec-archive-check.mjs --change rg-zip-flags-dangerous-oct24` →
>    PASS（1 份 delta / 1 条 MODIFIED / 25 段，无静默丢段；基线已是 readonly 归档后的 living）；
>    `openspec validate --all --strict` → `Totals: 35 passed, 0 failed`；归档跟踪队列有且仅有一条。
>
> 归档后项见本块末尾的「归档后」追加段。
>
> **归档后（2026-10-25，M729）**：归档提交 `2a475dfb`（归档目录 + 并入的 living spec +
> `docs/backlog.md` 队列条目核销同批提交）。`openspec archive` 实际输出：`harness: update`、
> `+ 0, ~ 1, - 0, → 0`、`Change 'rg-zip-flags-dangerous-oct24' archived as
> '2026-10-25-rg-zip-flags-dangerous-oct24'.`。紧随其后
> `node scripts/openspec-archive-check.mjs --archived rg-zip-flags-dangerous-oct24` →
> `PASS（openspec/changes/archive/2026-10-25-rg-zip-flags-dangerous-oct24：1 条 MODIFIED，对比 37
> 段；人工恢复 0 段，声明认领 0 段）`，EXIT=0（2026-10-25 07:27 CST）。
> 同批复跑：门禁模式 `openspec-archive-check` → `PASS（11 份 delta / 14 条 MODIFIED / 191 段）`；
> `openspec validate --all --strict` → `Totals: 34 passed, 0 failed`；`bash scripts/docs-check.sh`
> → `docs-check: PASS`。不回退复核：归档后 living 里「受限解包」2 处、「只读分类的能力断言」2 处、
> 「git 全局 flag」1 处、「search-zip」3 处、「两层权限规则」2 处——权限链前两环的增量与本环的
> `-z` 枚举同时在场。

## Why

M664 建立的「只读分类的能力断言」是：一次被判只读的 `cli_run` 调用不写文件、也不执行外部程序。
该 change 已把 `rg` 的三个执行形态（`--pre` / `--pre-glob` / `--hostname-bin`）收进危险层，但漏了
同一族的 `-z` / `--search-zip`：解压搜索由 rg 自行调起外部解压程序。

本机实测（ripgrep 15.2.0，合成 fixture）：在 PATH 前置一个只记录调用的假 `gzip`，执行
`rg -z needle probe.txt.gz` 后假 gzip 被调起，记录为 `FAKE-GZIP-INVOKED: -d -c /tmp/rgzip-probe.txt.gz`。
即 `-z` 的搜索命中确实 spawn 了外部程序（`gzip -d -c <文件>`）；而分类器
`classify_cli(["rg", "-z", "needle", "f.gz"])` 当前返回 `ReadOnly`——三档权限都免闸，能力断言
因此不成立。

与 `--pre` 相比可利用性弱一档：被执行的程序名不是模型指定的（是 PATH 上的解压器），但「判只读 =
不执行外部程序」的承诺同样被破坏；且 `--no-search-zip` 这类否定形态说明它确实是一个可开关的执行面。

**为什么单独开 change**：M664 的 spec delta 已过节点 1 评审，在其中追加枚举项会改动已评审的裁决面；
本 change 只动枚举段与对应判据，评审面最小。

## What Changes

1. **判据**（spec：`cli_run 命令分类与 vault 写重定向` 的「只读分类的能力断言」）：`rg` 的执行形态
   枚举增加 `-z` / `--search-zip`，与 `--pre` 同档（`Dangerous`）同口径（危险层先于 allow 规则与
   会话缓存，任何档都逐个问）。
2. **短旗标簇**：`-z` 是短旗标，能捆进簇（实测 `rg -zH` / `rg -nz` 均成立且解压生效；只按整 token
   匹配会留下一条捆绑绕过）。判据扫描单 `-` 起首、非 `--` 的 token，遇到 rg 的取值短旗标
   （`-A` / `-B` / `-C` / `-E` / `-M` / `-T` / `-d` / `-e` / `-f` / `-g` / `-j` / `-m` / `-r` / `-t`）
   即停——`-ez` 的 `z` 是 `-e` 的粘连值（pattern 为 `z`），不算命中。长形态无缩写（实测
   `rg --search` 被拒），继续按整 flag / `=` 判据。
3. **继承关系不另写判据**：`bash -lc "rg -z …"` 与 `xargs rg -z …` 经受限解包 / 包装器递归复用同一个
   `classify_cli`，自动落危险（单测锁定）。
4. **反向形态保持只读**：`rg --no-search-zip`（否定形态，不执行任何程序）、`rg -ez`（pattern 为 `z`）
   与裸 `rg needle .` 仍判只读——枚举扩项不得退化成「见 `z` 就危险」。

## Non-goals

- 不收 `rg` 的其它形态：`--type-add` / `--encoding` 等不执行程序；后续若发现同族遗漏，另行开 change
  或 finding，不在本 change 顺手扩枚举。
- 不改 `RIPGREP_CONFIG_PATH` / `LESSOPEN` / `LESSCLOSE` / `GREP_OPTIONS` 的环境注入面处置
  （`harness/tools.rs` 的 `cli_run` 已 `env_remove`）。
- 不把 `rg` 整命令降为写：`-z` 只是一个参数形态，裸 `rg` 的只读查询必须维持免问（单测锁定）。
- 不动 `readonly-allowlist-tightening-oct23` 与 `harness-permission-rules-oct23` 的 delta 正文。

## Impact

- 影响的 specs：`harness`（一条 requirement 的整块 MODIFIED）。
- 影响的代码/系统：`src-tauri/src/harness/permissions.rs`（`RG_EXEC_FLAGS` / `rg_exec_form` 与单测）；
  分类是纯 argv 文本判定，无新增 IO，不触及性能合同。
- **归档顺序（2026-10-24 已按此重写；2026-10-25 实际执行完毕）**：`harness-permission-rules-oct23` →
  `readonly-allowlist-tightening-oct23`（M664）→ 本 change。M664 已于 2026-10-25 归档
  （`openspec/changes/archive/2026-10-25-readonly-allowlist-tightening-oct23`；本节原写「已并入 master
  但未归档」，那是 2026-10-24 重写时的现状），其 delta 已按「M649 归档后的 living（两层权限 + 受限
  解包）」重写；本 delta 以「M664 归档后的形态（5 段正文 + 16 场景）」为基线，只在该基线上追加
  `-z` / `--search-zip` 枚举项与对应场景正反例，其余逐字保留。前两者归档后本 change 归档即纯改动，
  不会回退权限层数、受限解包或写形态收紧。
