# Proposal: rg 的 -z / --search-zip 补进危险档

- Change ID: `rg-zip-flags-dangerous-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**Alex 已批准立项**（2026-10-24 对 finding 立项请示的原话「好，可以。」）。
> 来源是 M664（`readonly-allowlist-tightening-oct23`）worker 发现的 finding：
> `.tower/comms/findings/20261024-worker-readonly-allowlist-oct2-vuln-rg-z-search-zip-readonly-allowlist.md`。
> 本 proposal 按该裁决起草，无待裁裁决点。
> 节点 2（归档评审）：实现完成后填写。

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
- **归档顺序**：M664 已并入 master 但未归档，living spec 仍是收紧前原文。本 delta 以「master 原文 +
  M664 的收紧段」为基线，只在该基线上追加枚举项：
  - 若 M664 先归档：living spec 即 M664 的收紧段，本 delta 与之逐段对齐，归档是纯改动；
  - 若本 change 先归档：M664 归档时须把本 change 的枚举项并进它的 MODIFIED 块（与 M664 design §7
    第 3 条对 M649 的处理同口径，见 `openspec/changes/readonly-allowlist-tightening-oct23/design.md`）。
