# Tasks: readonly-allowlist-tightening-oct23

> 实现批次按 proposal 的 D1–D3 与裁决点 Q1 落地；Q1 未回时按倾向 A（拆档）实施。

## 1. 分类器（`src-tauri/src/harness/permissions.rs`）

- [ ] 1.1 新增「写形态」判定：`base64 -o/--output`、`xxd` 的第二个位置参数（含 `-r`）、`file -C`、`tree -o`、`less -o/-O/--log-file`、`find -fprint/-fprint0/-fprintf/-fls`；命中降为 `Write`（含 `--flag=value`、短旗标簇与位置参数计数形态）
- [ ] 1.2 新增「执行形态」判定：`rg --pre/--pre-glob/--hostname-bin`、`sed` 脚本的 `e`/`s///e`；命中归 `Dangerous`（危险层，任何档都问，allow 规则与会话缓存绕不过）
- [ ] 1.3 实现 `sed` 保守脚本扫描（design §2.3）：取脚本源（`-e` / `--expression=` / `--expression X` / 位置参数）、`-f`/`--file`（含分写形态）直接归写、命令位识别 `w`/`W`（写）与 `e`（危险）、`s`/`y` 分隔字段与旗标、地址与正则里的同名字母不误判、解析失败归写
- [ ] 1.4 把 `sed` 的 `-i` 判定从整参数前缀改为短旗标簇展开（堵 GNU sed 的 `-ni` / `-Ei`）
- [ ] 1.5 `git` 全局 flag 改白名单（`-P` / `--no-pager` / `--no-optional-locks` / `--no-replace-objects`），表外全局 flag 归写
- [ ] 1.6 `git` 只读子命令族收缩：保留 `rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch`·`tag` 列表 / `remote -v`；`status` / `diff` / `log` / `show` / `blame` 归写
- [ ] 1.7 `write_targets` 补新增写形态的目标提取（`base64 -o`、`tree -o`、`xxd` 的第二位置参数（不限于 `-r`）、`find -fprint` 系），使 vault 内写仍走重定向；`suggested_tool` 按目标是否存在给 `vault_create` / `vault_patch`，不定时给 `None`
- [ ] 1.8 `cli_run` spawn 时清空注入型环境变量（`RIPGREP_CONFIG_PATH` / `LESSOPEN` / `LESSCLOSE` / `GREP_OPTIONS`），并在代码注释写明这是防御性硬化、不是 argv 判据
- [ ] 1.9 单测：表驱动正 / 反例覆盖 design §6 的 6 类；每条拒判配一条只差一个 token 的正例、每条正例配一条改坏输入的反向验证；xxd 位置参数计数专项含 `xxd -ps in out` → 写、`xxd -ps in` → 只读、`xxd -c16 in` / `xxd -c 16 in` → 只读
- [ ] 1.10 单测：跨档矩阵（写形态 `read_only`/`vault_write` → Ask、`full_access` → Allow；执行形态三档全 Ask）与包装器继承（`sudo base64 -o …`、`xargs rg --pre …`）
- [ ] 1.11 实测 git 保留族的执行面（r1 P2-1）：对 `rev-parse` / `ls-files` / `describe` / `shortlog` / `stash list` / `branch`·`tag` 列表 / `remote -v` 逐个在仓库 config 设 `log.showSignature=true` + 恶意 `gpg.program`（并覆盖 `core.fsmonitor` / `diff.external` / textconv）的仓库里跑一遍，确认不触发任何外部程序；触发则把该子命令移出保留族——「执行面不存在」的判据以实测背书，不靠推理

## 2. 验收场景（回扫 + 新增）

- [ ] 2.1 全量回扫 `scripts/acceptance/scenarios/` 与 fixtures：逐条核对「把白名单成员当只读样本」的闸期望，重点 75（`cli(*)` + `echo`）、110、111、151；发现过期期望逐条改准（改权限语义的 change 必做项）
- [ ] 2.2 新增真机验收场景：`rg --pre` 在 `full_access` 档仍进批准闸（危险）；`base64 -o` / `git status` 在默认档进闸（写）；`git rev-parse` / `base64 -d` 仍免闸（反向）
- [ ] 2.3 新增场景的证据与截图按 `.local/acceptance/` 布局归档（git 外），场景文件本身入库

## 3. 文档与合并口径

- [ ] 3.1 归档前核对 proposal / design / spec delta / 实现四者一致；把实现期的实测读数和行号回填 design §0
- [ ] 3.2 与 M649（`harness-permission-rules-oct23`）合并顺序处置：若 M649 先归档，把其受限解包段并入本 change 的 MODIFIED 块，并把 M649 测试表里 `git status` / `git diff` 的正例改为保留族；若本 change 先归档，在 M649 侧同步
- [ ] 3.3 核销 finding：`docs/backlog.md` 与本 change 相关的 finding 条目由 tower 记账，确认已落账（finding 文件：`20261023-worker-proposal-permission-rul-vuln-sed-w-base64-o-rg-pre-git-c-diff-external.md`）

## 4. 验证

- [ ] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 4.2 `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [ ] 4.3 `bash scripts/gate.sh quick` 通过（Rust 单测 + 前端单测 + bindings 漂移）
- [ ] 4.4 第 2 组新增的验收场景在真机跑通；失败项按现场修实现或修场景，不静默放宽断言
