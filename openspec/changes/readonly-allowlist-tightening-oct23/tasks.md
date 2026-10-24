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
- [x] 1.11 核对 git 只读族的安全前提（原 r1 P2-1 项按 Q1 2026-10-24 改裁重写）：M656（hidden 路径的 patch / move / delete 直接拒绝）已合并，并在 vault 内实测 `vault_patch(".git/config")` 被拒；未落地则本 change 不得以「写入口已关闭」为由实施 / 合并。仓库配置驱动执行的面（`core.fsmonitor` / `diff.external`，design §0.1 实测）仅作残余登记，不再作为移出保留族的依据
      —— **2026-10-24 真机实测 PASS**（场景 231b，8 断言，0 FAIL）：合成 vault 内
      `vault_patch(".git/config")` 被写入口以 `fs_name_invalid` 拒绝、原因点名「hidden 档」，
      文件 sha256 与 mtime 均未变；工具结果回送模型的 JSONL 同 `call_id` 带该错误码。证据
      `.local/acceptance/2026-10-24-m711/231b-harness-hidden-write-refusal/`

## 2. 验收场景（回扫 + 新增）

- [x] 2.1 全量回扫 `scripts/acceptance/scenarios/` 与 fixtures：逐条核对「把白名单成员当只读样本」的闸期望，重点 75（`cli(*)` + `echo`）、110、111、151；发现过期期望逐条改准（改权限语义的 change 必做项）
- [x] 2.2 新增真机验收场景：`rg --pre` 在 `full_access` 档仍进批准闸（危险）；`base64 -o` / `git --git-dir=<外部仓库> diff`（表外全局 flag） / `git log --output=<外部路径>`（只读子命令的写形态）在默认档进闸（写）；`git status` / `git diff` / `git rev-parse` / `base64 -d` 仍免闸（反向，Q1 2026-10-24 裁决）
- [x] 2.3 新增场景的证据与截图按 `.local/acceptance/` 布局归档（git 外），场景文件本身入库
      —— 231（写形态 / 执行形态 / git 只读族，32 断言 PASS）与 231b（hidden 写入口拒绝，
      8 断言 PASS）的 `steps.md` / 截图 / AX 均落主仓
      `.local/acceptance/2026-10-24-m711/{231-harness-readonly-write-forms,231b-harness-hidden-write-refusal}/`；
      两场景文件与 mock fixture 入库

## 3. 文档与合并口径

- [x] 3.1 归档前核对 proposal / design / spec delta / 实现四者一致；把实现期的实测读数和行号回填 design §0
      —— **2026-10-24 已核**：proposal 的 A1/A2/A3 切片 ↔ design §1–§5 ↔ 实现（`permissions.rs` /
      `tools.rs` / `fs_io.rs`）逐条一致；delta 的写形态 / 执行形态 / git 全局 flag 三组措辞与实现
      一致；实现期增量（git 危险子命令跳过全局 flag 及其分写取值、`sed -i` 目标提取复用同一份
      解析）已写进 design §0.3；行号锚点从 `40e6ae01` 回填到 `152559fc`。**已做**：与 M649 解包段
      的 delta 并集（2026-10-24，见 3.2）
- [x] 3.2 与 M649（`harness-permission-rules-oct23`）合并顺序处置：若 M649 先归档，把其受限解包段并入本 change 的 MODIFIED 块；M649 的 `git status` / `git diff` 正例保持不变（Q1 保持只读）。若本 change 先归档，在 M649 侧同步其全局 flag 白名单的继承口径
      —— **2026-10-24 按「M649 先归档」分支完成**：归档评审确认的链为 permission-rules → 本
      change → `rg-zip-flags-dangerous-oct24`；delta 的 MODIFIED 块重写为
      「M649 归档后的 living（两层权限 + 受限解包，3 段正文 + 11 场景）+ 本 change 的收紧（+2 段
      +5 场景）」= 5 段正文 + 16 场景；`git status` / `git diff` 正例逐字保留。逐段对账见 design §7
      第 3 条，机械核对（去空白后逐字相等）全部通过（76/76）、无静默丢段。
- [x] 3.3 核销 finding：`docs/backlog.md` 与本 change 相关的 finding 条目由 tower 记账，确认已落账（finding 文件：`20261023-worker-proposal-permission-rul-vuln-sed-w-base64-o-rg-pre-git-c-diff-external.md`）
      —— **N/A（2026-10-25，M729 归档批）**：该 finding 的四条旁路（`base64 -o`、`sed` 脚本
      `w`/`W`、`rg --pre`/`--hostname-bin`、`git` 全局 flag `-c`/`--exec-path` 等）全部由本 change
      的实现收口（`src-tauri/src/harness/permissions.rs` 的参数级拒判与单测，见 1.x 勾选项），属
      「修复 PR 同批删除对应条目」——仓内从未有过该 finding 的 backlog 条目（`git log -S` 核，
      `docs/backlog.md` 全史零命中），故无条目可核销、也不按「不留索引」另立条目。
- [x] 3.4 排序确认：M656（`vault-patch-hidden-deny-oct24`）先合并——git 只读族保持只读的安全前提（design §8）；本 change 的 proposal 与 spec delta 均依赖这条前提

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 4.2 `bash scripts/docs-check.sh` 通过（含 MODIFIED delta 的归档对账）
- [x] 4.3 `bash scripts/gate.sh quick` 通过（Rust 单测 + 前端单测 + bindings 漂移）——`GATE RESULT: 10/10 PASS（SKIP 1）`，退出码 0（SKIP = 本 worktree 未装 `tests/visual` 依赖）
- [x] 4.4 第 2 组新增的验收场景在真机跑通；失败项按现场修实现或修场景，不静默放宽断言
      —— **2026-10-24 真机 PASS**：231（32 断言，0 FAIL）+ 231b（8 断言，0 FAIL）。231 初跑
      暴露两点场景缺陷并把产品面问题单列：① 权限浮层按钮持焦时 `Esc` 走原生关窗、整个 app
      退出（两次复跑同形，finding `20261024-worker-archive-rmachine-oct24-bug-harness-esc-app.md`），
      场景改走「再点权限 chip」；② 第二条提问的 `typeInNode.target` 只写了注入前状态，注入
      `pre` 后回读不到目标（现写 `问点什么|pre`）。修的是场景、没有放宽任何断言；失败现场留档
      `.local/acceptance/2026-10-24-m711-flake-r1/`
- [x] 4.5 delta 重写后的门禁复跑（2026-10-24）：
      `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` → `Totals: 37 passed, 0 failed
      (37 items)`，EXIT=0；`bash scripts/docs-check.sh` → `docs-check: PASS`（605 条相对链接 / 归档
      对账 287 段 / COVERAGE 235 场景），EXIT=0；`node scripts/openspec-archive-check.mjs --change
      readonly-allowlist-tightening-oct23` → PASS（1 条 MODIFIED / 17 段 / 无静默丢段）。注意
      archive-check 对比的是**当前** living（M649 尚未归档），看不到「解包段是否并入」这一层；
      该层由 3.2 的逐段核对（76/76）负责。本 mission 只改制品、不跑 `gate.sh quick`（cargo / 前端
      单测与制品无关），也**未执行归档**。
      —— **2026-10-25（M729 归档批）复跑更新**：M649 已于 2026-10-25 归档
      （`openspec/changes/archive/2026-10-25-harness-permission-rules-oct23`），上段括注的「当前
      living（M649 尚未归档）」已作废：现 living 已是 M649 归档后的两层权限 + 受限解包形态，
      `--change readonly-allowlist-tightening-oct23` 复跑仍 PASS（1 条 MODIFIED / 25 段 / 无静默
      丢段；对比段数由 17 升至 25，因为对账基线从「未含 M649 的 living」变成「已含 M649 解包段与
      其场景的 living」，delta 侧内容未变）。

## 实现注记（M664，2026-10-24）

- **1.11**：M656 已合并（merge `c9a4d03`），hidden 写入口的拒绝有 Rust 单测证据
  （`src-tauri/src/fs_io.rs` 的 `fs_patch_file_refuses_hidden_target_and_respects_policy` /
  `existing_path_operations_refuse_hidden_tier_targets` / `hidden_gate_follows_in_vault_symlinks`）。
  真机复验已补跑（2026-10-24，场景 231b）：`vault_patch(".git/config")` 被 `fs_name_invalid`
  拒绝、文件未变——1.11 的证据见上方勾选项。
- **2.3 / 4.4**：真机段已于 2026-10-24 补跑：231 PASS（32 断言）+ 231b PASS（8 断言），截图 /
  AX / steps 归档在 `.local/acceptance/2026-10-24-m711/`；场景 231 的两处场景缺陷（Esc 关窗、
  target 覆盖注入后状态）已按现场修正，见 4.4 的勾选注记。
- **3.1 / 3.2 / 3.3**：3.1 已完成（四者一致核对 + design §0 行号 / 读数回填，见勾选注记）；
  3.2 / 3.3 仍是归档期（节点 2）与 tower 记账事项；M649 尚未归档，3.2 按条件分支在归档时判。
  —— **2026-10-25（M729 归档批）收口**：M649 已于 2026-10-25 归档
  （`openspec/changes/archive/2026-10-25-harness-permission-rules-oct23`），3.2 的「M649 先归档」
  分支兑现（delta 已按归档后 living 重写并经 M724 独立评审逐段核过）；3.3 按 N/A 处置，注记见其
  勾选项。上句「M649 尚未归档」为 2026-10-24 当时的现状，不再成立。
- 实现增量（超出 design §2.4 字面、同属既有承诺）：`git` 的危险子命令识别改为跳过全局 flag
  **及其分写取值**（`git -C <path> clean -fd` 不因 `-C` 落到写而让 `full_access` 免闸）；
  `write_targets` 的 `sed -i` 目标提取改用同一份 sed 参数解析（`-e` 形态下旧读法会漏输入文件）。
