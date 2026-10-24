# Proposal: patch / move / delete 同样拒绝 hidden 档的既有条目

- Change ID: `vault-patch-hidden-deny-oct24`
- 日期: 2026-10-24
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> 评审记录
> 节点 1（提案评审）：**Alex 已点头立项**（2026-10-24 对 finding 立项请示的原话「安排」；finding 全文见
> `.tower/comms/findings/20261023-worker-proposal-readonly-allow-vuln-vault-patch-git-config-hidden-patch-git.md`）。
> 本 proposal 按该裁决起草，无待裁裁决点。
> 节点 2（归档评审）：**通过**（2026-10-24 Alex 原话：「第一组和第二组都可以归档了。」）。

## Why

`hidden` 档（`vault.ignore` 里档位为 `"hidden"` 的名字，默认 `.git` / `.DS_Store`，外加恒定的保存
临时文件模式）的既有语义是**不可见**：不进枚举结果、子树不枚举、不进 watch 事件流与索引
（`openspec/specs/fs-io/spec.md`「全类型递归枚举」）。

写入口今天只校验**新建 / 改名**的末段名（`IgnorePolicy::validate_new_name`）与**新建的父段**
（`ensure_parent_dirs`）——**已存在的隐藏路径**不在任何判据里：`fs_patch_file` 与 `trash_entry` 只走
`resolve_in_vault`（只做空 / 绝对路径 / `..` / 符号链接逃逸校验，函数签名里没有 `policy`），
`fs_move_entry` 的源与目标父段同样不查（只有目标末段名过 `validate_new_name` 被挡）。

这不是理论缺口，是一条零批准执行链（finding
`.tower/comms/findings/20261023-worker-proposal-readonly-allow-vuln-vault-patch-git-config-hidden-patch-git.md`，high）：

1. `vault_read(".git/config")`——读类，免闸；
2. `vault_patch(".git/config", …)` 写入 `[core]\n\tfsmonitor = /path/cmd`——`vault_patch` 在默认
   `vault_write` 档免闸；
3. `cli_run("git", ["status"])` 当轮被判只读、免闸执行 `core.fsmonitor` 指定的程序。

finding 已在合成 fixture 上实测该链成立（`git config core.fsmonitor <script>` 后 `git status` 执行
该脚本；`diff.external` 同款对 `git diff` 生效）。M652（`readonly-allowlist-tightening-oct23`）把
`git status` / `git diff` 降为写能掐断第 3 步，但**判据应在写入口补齐**：否则任何未来的「只读命令 +
仓库配置」组合、以及任何读 `.git` 的路径都继续暴露。

**这不是新特例，是既有裁决的执行缺口。** living spec 已明确「无名字级写操作特判——是否可操作只
取决于该名字是否在可见集里；`.git` 默认在 `hidden` 档，因此默认没有行、写操作被末段名校验拒绝；
用户把它配置成可见后，它就是普通条目」。这句话对**新名字**成立，对**已存在的隐藏路径**不成立——
本 change 让后者同样成立。

## What Changes

1. **patch 目标**（spec：`局部 patch 写入`）：`fs_patch_file` 增加装载时那份忽略策略的参数；resolve
   之后、读内容之前拒绝命中 `hidden` 档（含任一祖先段）的目标，错误码 `fs_name_invalid`。
2. **删除 / 改名 / 移动**（spec：`文件级操作（删除 / 重命名 / 新建 / 定位）`）：`trash_entry`（delete）
   与 `fs_move_entry`（move）补 `hidden` 档判定——删除的目标、改名的源、移动的源与目标路径（含目标
   父段）命中即拒绝；`rename_entry` 的源同款（同一份判定）。
3. **判定只有一份**：新增 `IgnorePolicy::validate_not_hidden`，内部就是既有 `hidden_hit`（同一份
   gitignore 匹配器、同一份 `vault.ignore` 配置）。调用点 MUST NOT 自建名单；`.git` 被配置成可见后
   这些写操作恢复可用（单测断言这条反向路径）。
4. **同类面审计**（mission 第二项任务）：除上述入口外，agent 可触达的写路径已无同类洞——
   `vault_create` 走 `vault_create_file` → `ensure_parent_dirs` 逐段判 `hidden`、末段名过
   `validate_new_name`；`document_save` / `create_file_entry` / `create_dir_entry` 只由前端文件树
   驱动，而 `hidden` 条目在树里没有行（不可达）。审计逐点结论与证据写进完成报告。
5. **r1 评审处置（2026-10-24）：判定按文件系统身份，不按字符串显示名。**
   (a) **大小写不敏感**——macOS 默认 APFS 上 `.GIT` 与 `.git` 是同一个目录，且 `realpath`
   （`resolve_in_vault` 的 canonicalize）保留输入大小写，所以只查 canonical 相对路径也不够；
   写入口的 hidden 判定改用同一份名字清单编出的**大小写不敏感匹配器**（分类 / 枚举仍用大小写
   敏感那份——「名字匹配不折叠大小写」是 `vault.ignore` 地图的既有边界，改它会改变文件树的呈现）。
   (b) **canonical 真身**——既有目标在字符串判定之外，还把 canonical 结果折回 vault 相对路径再
   判一次：vault 内的可见名字可以是指向 `hidden` 条目的符号链接；`trash_entry` 用的是 canonical
   路径，不判真身会把真 `.git` 目录搬进废纸篓。
   同一缝在 `validate_new_name` 与 `ensure_parent_dirs` 里**先于本 change 存在**（`.GIT` 变体可
   绕过新建 / 改名 / 父段判定），一并收敛；`ensure_parent_dirs` 的 symlink 段本来就由 `is_dir()`
   拒（`symlink_metadata` 不跟随链接），故那里不需要额外的真身判定。

## Non-goals

- **不改读侧**：`vault_read` / `vault_search` 读 `hidden` 路径维持现状（读边界不在本条判据内；
  `vault_read(".git/config")` 本身不构成写）。
- **不加 `.git` 硬编码拦截**：判定一律经忽略策略，MUST NOT 引入第二份名字名单（REVIEW.md
  「同一语义两处真源」）。用户把 `.git` 配成可见时它与普通目录等价。
- **不改 `hidden` 档的名字集合与判定链**（`hidden` → `lazy` → 用户规则 → 可见），也不改 `lazy` 档：
  `lazy` 条目本来可见、可打开，其写操作 MUST NOT 被拒。
- **不改下游权限分类**（git 只读子命令族归写属 M652）。本 change 只补写入口的 `hidden` 判定。
- **不做 OS 沙箱 / 读侧隔离**。

## Impact

- 影响的 specs：`fs-io`（MODIFIED 2 条：`局部 patch 写入`、`文件级操作（删除 / 重命名 / 新建 / 定位）`）。
- 影响的代码 / 系统：`src-tauri/src/fs_io.rs`（判定与三个写函数）、`src-tauri/src/harness/tools.rs` 与
  `src-tauri/src/commands.rs`（调用点传策略，签名变化的必然面）、`src-tauri/src/fs_io.rs` 内联单测。
- 用户可感变化：只影响「树里没有行的路径」——正常文件 / 目录的写操作不变（单测正例对照）。模型对
  `hidden` 路径的 patch / move / delete 从「静默成功」变为 `fs_name_invalid` 人话错误。
- 关联约束：ADR 0002（判定只在写路径上一次 gitignore 匹配，不进 keypress-to-paint）；ADR 0003 §3
  （写纪律不变：同一写核心 / CAS / 原子 rename）；AGENTS.md「影响面升级线」已过——不改既有产品设定，
  只补齐既有裁决（「是否可操作只取决于可见集」）的执行缺口。
