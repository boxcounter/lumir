# Tasks: readonly-allowlist-tightening-oct23

> 实现批次按 proposal 的 D1–D3 与裁决点 Q1 落地。Q1 已裁决（2026-10-24）：git 只读子命令族保持
> 只读、不拆档——git 侧只剩全局 flag 白名单与「保持形态仍为只读」的验证。

## 1. 分类器（`src-tauri/src/harness/permissions.rs`）

- [x] 1.1 新增「写形态」判定：`base64 -o/--output`、`xxd` 的第二个位置参数（含 `-r`）、`file -C`、`tree -o`、`less -o/-O/--log-file`、`find -fprint/-fprint0/-fprintf/-fls`；命中降为 `Write`（含 `--flag=value`、短旗标簇与位置参数计数形态）
- [x] 1.2 新增「执行形态」判定：`rg --pre/--pre-glob/--hostname-bin`、`sed` 脚本的 `e`/`s///e`；命中归 `Dangerous`（危险层，任何档都问，allow 规则与会话缓存绕不过）
- [x] 1.3 实现 `sed` 保守脚本扫描（design §2.3）：取脚本源（`-e` / `--expression=` / `--expression X` / 位置参数）、`-f`/`--file`（含分写形态）直接归写、命令位识别 `w`/`W`（写）与 `e`（危险）、`s`/`y` 分隔字段与旗标、地址与正则里的同名字母不误判、解析失败归写
- [x] 1.4 把 `sed` 的 `-i` 判定从整参数前缀改为短旗标簇展开（堵 GNU sed 的 `-ni` / `-Ei`）
- [x] 1.5 `git` 全局 flag 改白名单（`-P` / `--no-pager` / `--no-optional-locks` / `--no-replace-objects`），表外全局 flag 归写；只读子命令的 `--output` / `--output=…` 归写（Q1 改裁的连带补全：`log`/`show`/`shortlog` 写文件，`diff`/`blame` 截断既有文件，design §2.4）
- [x] 1.6 `git` 只读子命令族保持现状（Q1 2026-10-24 裁决，无收缩代码）：单测确认 `status` / `diff` / `log` / `show` / `blame` / `rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch`·`tag` 列表 / `remote -v` 仍判只读；`git commit` / `git push` 等写子命令仍判写
- [x] 1.7 `write_targets` 补新增写形态的目标提取（`base64 -o`、`tree -o`、`xxd` 的第二位置参数（不限于 `-r`）、`find -fprint` 系、`git --output` 的空格与等号两形态），使 vault 内写仍走重定向；`suggested_tool` 按目标是否存在给 `vault_create` / `vault_patch`，不定时给 `None`
- [x] 1.8 `cli_run` spawn 时清空注入型环境变量（`RIPGREP_CONFIG_PATH` / `LESSOPEN` / `LESSCLOSE` / `GREP_OPTIONS`），并在代码注释写明这是防御性硬化、不是 argv 判据
- [x] 1.9 单测：表驱动正 / 反例覆盖 design §6 的 6 类；每条拒判配一条只差一个 token 的正例、每条正例配一条改坏输入的反向验证；xxd 位置参数计数专项含 `xxd -ps in out` → 写、`xxd -ps in` → 只读、`xxd -c16 in` / `xxd -c 16 in` → 只读
- [x] 1.10 单测：跨档矩阵（写形态 `read_only`/`vault_write` → Ask、`full_access` → Allow；执行形态三档全 Ask）与包装器继承（`sudo base64 -o …`、`xargs rg --pre …`）
- [ ] 1.11 核对 git 只读族的安全前提（原 r1 P2-1 项按 Q1 2026-10-24 改裁重写）：M656（hidden 路径的 patch / move / delete 直接拒绝）已合并，并在 vault 内实测 `vault_patch(".git/config")` 被拒；未落地则本 change 不得以「写入口已关闭」为由实施 / 合并。仓库配置驱动执行的面（`core.fsmonitor` / `diff.external`，design §0.1 实测）仅作残余登记，不再作为移出保留族的依据

## 2. 验收场景（回扫 + 新增）

- [x] 2.1 全量回扫 `scripts/acceptance/scenarios/` 与 fixtures：逐条核对「把白名单成员当只读样本」的闸期望，重点 75（`cli(*)` + `echo`）、110、111、151；发现过期期望逐条改准（改权限语义的 change 必做项）
- [x] 2.2 新增真机验收场景：`rg --pre` 在 `full_access` 档仍进批准闸（危险）；`base64 -o` / `git --git-dir=<外部仓库> diff`（表外全局 flag） / `git log --output=<外部路径>`（只读子命令的写形态）在默认档进闸（写）；`git status` / `git diff` / `git rev-parse` / `base64 -d` 仍免闸（反向，Q1 2026-10-24 裁决）
- [ ] 2.3 新增场景的证据与截图按 `.local/acceptance/` 布局归档（git 外），场景文件本身入库

## 3. 文档与合并口径

- [ ] 3.1 归档前核对 proposal / design / spec delta / 实现四者一致；把实现期的实测读数和行号回填 design §0
- [ ] 3.2 与 M649（`harness-permission-rules-oct23`）合并顺序处置：若 M649 先归档，把其受限解包段并入本 change 的 MODIFIED 块；M649 的 `git status` / `git diff` 正例保持不变（Q1 保持只读）。若本 change 先归档，在 M649 侧同步其全局 flag 白名单的继承口径
- [ ] 3.3 核销 finding：`docs/backlog.md` 与本 change 相关的 finding 条目由 tower 记账，确认已落账（finding 文件：`20261023-worker-proposal-permission-rul-vuln-sed-w-base64-o-rg-pre-git-c-diff-external.md`）
- [x] 3.4 排序确认：M656（`vault-patch-hidden-deny-oct24`）先合并——git 只读族保持只读的安全前提（design §8）；本 change 的 proposal 与 spec delta 均依赖这条前提

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.2 `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [x] 4.3 `bash scripts/gate.sh quick` 通过（Rust 单测 + 前端单测 + bindings 漂移）——`GATE RESULT: 10/10 PASS（SKIP 1）`，退出码 0（SKIP = 本 worktree 未装 `tests/visual` 依赖）
- [ ] 4.4 第 2 组新增的验收场景在真机跑通；失败项按现场修实现或修场景，不静默放宽断言

## 实现注记（M664，2026-10-24）

- **1.11**：M656 已合并（merge `c9a4d03`），hidden 写入口的拒绝有 Rust 单测证据
  （`src-tauri/src/fs_io.rs` 的 `fs_patch_file_refuses_hidden_target_and_respects_policy` /
  `existing_path_operations_refuse_hidden_tier_targets` / `hidden_gate_follows_in_vault_symlinks`）。
  真机复验（vault 内 `vault_patch(".git/config")` 被拒）随本批次真机段挂起，待真机窗口补跑。
- **2.3 / 4.4**：本批次真机段挂起（tower 约定）。场景 `231-harness-readonly-write-forms` 已入库，
  `node scripts/acceptance/run.mjs --check` 通过；真机跑批、截图与 `.local/acceptance/` 证据归档待窗口。
- **3.1 / 3.2 / 3.3**：归档期（节点 2）与 tower 记账事项，实现批次不涉及；M649 尚未归档，
  归档顺序按 3.2 的条件分支在归档时判。
- 实现增量（超出 design §2.4 字面、同属既有承诺）：`git` 的危险子命令识别改为跳过全局 flag
  **及其分写取值**（`git -C <path> clean -fd` 不因 `-C` 落到写而让 `full_access` 免闸）；
  `write_targets` 的 `sed -i` 目标提取改用同一份 sed 参数解析（`-e` 形态下旧读法会漏输入文件）。
