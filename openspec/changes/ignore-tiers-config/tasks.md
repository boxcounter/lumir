# Tasks: ignore-tiers-config

> **实现范围提示（实施前须先扩范围）**：本 change 的现有实现范围只含
> `src-tauri/src/{config,fs_io,commands}.rs`、`src-tauri/tests/**`、`src/bindings/**`、`src/tree.ts`、
> `tests/unit/**`、`openspec/changes/ignore-tiers-config/**`。下列任务涉及 scope 外文件，**须先扩范围
> 或另行派发**，不得静默跳过：
>
> - `src-tauri/src/harness/tools.rs` + `src-tauri/src/harness.rs`（3.3，策略传入 `ToolContext`）
> - `scripts/acceptance/scenarios/67-vault-open-ignore-set.md`（5.3，期望过期会假红）
> - `docs/specs/config-reference.md`（1.6，`[vault]` 节今天完全缺失，`rule_files` 也未记载）
> - `src-tauri/src/logging.rs`（2.11，一句文档注释）

## 1. 配置面（`src-tauri/src/config.rs`）

- [ ] 1.1 新增默认常量：`DEFAULT_NEVER_SHOW: [&str; 2] = [".git", ".DS_Store"]`、
  `DEFAULT_LAZY: [&str; 14]`（`node_modules`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、
  `.cache`、`.pnpm-store`、`.tox`、`.gradle`、`test-results`、`perf-results`、`target`、`dist`），
  与 `DEFAULT_RULE_FILES` 并列；doc comment 写明「缺省即默认、不是安装快照」及其理由。
- [ ] 1.2 `VaultConfig` 增 `never_show: Vec<String>` / `lazy: Vec<String>`；`Default` 从 1.1 的两个常量取值；
  doc comment 写清两个键的语义（名字不是模式、缺省即默认、空列表 = 该档为空、生效时点、两键都不含 ⇒ 第三档）。
- [ ] 1.3 `RawVaultConfig` 增两个 `Option<Vec<serde_json::Value>>` 字段（与 `rule_files` 同形，逐项校验，
  不让一个坏元素拖垮整文件）；注释写明「整个字段给错类型 ⇒ 整文件回落」的既有代价。
- [ ] 1.4 `validate_vault` 增两档的名字校验：非字符串 / 空串 / 纯空白 / 含 `/` / `.`、`..` /
  含 `* ? [ ] ! # \` / 首尾空白 ⇒ 逐项丢弃 + 各自一条人话 warning；同档内去重；跨档同名 ⇒
  `never_show` 生效 + 一条 warning。warning 措辞按 design §2.2 的表格。
- [ ] 1.5 单测：默认分档不变量（2 + 14、并集 = 今日 16 名、交集为空）；缺键 / 缺节 ⇒ 默认；
  `[]` ⇒ 空档；只写一个键 ⇒ 另一个仍默认；七类非法各一条 warning 且其余项生效；跨档冲突；
  整字段类型错 ⇒ 整文件回落（连 `last_vault` 一起丢，与 `editor.font_size` 同族口径）。
- [ ] 1.6 （**scope 待扩**）`docs/specs/config-reference.md` 补 `[vault]` 节：`rule_files`（今天未记载）
  + `never_show` + `lazy` 三键的类型 / 默认 / 取值范围 / 生效时机 / 真源行号；并在 §2「解析与容错口径」
  补两键的逐项校验与整文件回落口径。

## 2. 规则表与判定（`src-tauri/src/fs_io.rs`）

- [ ] 2.1 `IgnorePolicyInner` 增 `never_show: Gitignore` / `lazy: Gitignore`；`IgnorePolicy::load` 增
  `never_show: &[String]` / `lazy: &[String]` 参数，用既有 `build_matcher` 各编译一次；
  `never_show` 匹配器同时编入 `LUMIR_TMP_PATTERNS`（恒定，不受配置影响）。
- [ ] 2.2 退役 `BUILTIN_NAMES`、`builtin_matcher()`、`is_builtin_hidden()`、`is_builtin_name()`；
  保留 `LUMIR_TMP_PATTERNS` 与 `lumir_tmp_matcher()`（ghost 清除用）。文件头注释改写：规则表三档来源 +
  默认分档指向 `config.rs` 的两个常量。
- [ ] 2.3 `IgnorePolicy::classify` 改成四层：`never_show_hit`（含 tmp）→ `lazy_hit` → `user_ignored` →
  `Visible`；两档判定用 `matched_path_or_any_parents`（祖先传递）。补注释说明「前两档命中即定格、
  用户规则取反翻不动」与 §2.6 条款修订的关系。
- [ ] 2.4 `scan_workspace_at` 的 `ignored` 计数只数 `EntryClass::Hidden`（惰性行不计数）；
  收口处的 `logging::vault_scan_ignored` 调用不变。
- [ ] 2.5 `scan_dir` 的分类改为消费同一份 `classify`（不要自己拼 `user_ignored`），保证「惰性档或用户规则
  命中 ⇒ `lazy: true`」同源。
- [ ] 2.6 `watch_verdict` 按档分流：`never_show_hit` 任一组件 ⇒ 丢弃；祖先命中 `lazy`（或用户规则）且未
  物化 ⇒ 丢弃；末段一律投递；`lazy` 标记由 `classify == Lazy` 给出。补/改注释里的三档说明。
- [ ] 2.7 `expand_new_dir_subtrees` 复核：已消费 `classify`，`Lazy` 目录不入队——只需补注释
  「惰性档与用户规则同待遇」，MUST NOT 另写判定。
- [ ] 2.8 `validate_new_name` 改为 `&IgnorePolicy` 上的方法（只拒 `never_show_hit(name)`）；签名传播到
  `resolve_new_in_vault` / `rename_entry` / `fs_move_entry` / `create_file_entry` / `create_dir_entry` /
  `vault_create_file`；`ensure_parent_dirs` 逐段只拒 `never_show` 档。
- [ ] 2.9 `find_vault_entry_by_name` 的目录剪枝改为「只跳过 `EntryClass::Hidden`」（与今日只跳过内置隐藏目录同形；
  惰性档目录照旧参与查重，行为不变）；补注释。
- [ ] 2.10 （裁决点 1 通过时）`.git` 恒护栏：`GIT_DIR_NAME` 常量 + `trash_entry` / `rename_entry` /
  `fs_move_entry` / `validate_new_name` 的末段名判定，错误码 `fs_name_invalid`、人话原因按 design §4。
  `fs_trash_entry` 因此只需常量护栏，签名不变。
- [ ] 2.11 （**scope 待扩**）`src-tauri/src/logging.rs` 的 `vault_scan_ignored` 文档注释：
  「内置规则」改「`never_show` 档（含恒定临时文件模式）」，并写明惰性条目不计数。代码不变。
- [ ] 2.12 单测（`fs_io.rs` 内 mod tests）：
  - 判定矩阵：四层顺序、祖先传递（`node_modules/express/index.js` 惰性）、tmp 模式在 `never_show: []` 下仍隐藏；
  - 默认分档：`.git` / `.DS_Store` 不可见，`target` / `node_modules` 出惰性行、不递归；
  - watch：`never_show` 全组件丢弃；`lazy` 祖先 + 未物化丢弃 / 末段投递 / 物化后投递；payload `lazy` 正确；
    外部新建惰性目录只投递一行、不补子树；
  - 名字校验：`never_show` 名拒绝、`lazy` 名允许、用户规则名允许；`.git` 护栏四方向（删 / 改名 / 移动 / 新建）；
  - 计数：惰性档名不计入 `ignored`。

## 3. 装配与写路径

- [ ] 3.1 `commands::prepare_vault_open` 把 `rule_files` / `never_show` / `lazy` 三个字段一起交给
  `IgnorePolicy::load`；配置读取失败时三者都回 `VaultConfig::default()`；注释沿用「装载时现场读一次」。
- [ ] 3.2 `commands.rs` 的 `fs_rename_entry` / `fs_move_entry` / `fs_create_file` / `fs_create_dir` 改用
  `state.root_and_policy()` 并把策略下传；`fs_trash_entry` 保持 `state.root()`（护栏是常量）。
- [ ] 3.3 （**scope 待扩**）`harness` 写路径：`ToolContext` 增策略字段（`harness.rs` 构造点与
  `harness/tools.rs` 的 `vault_create` / `vault_move` 调用点），MUST NOT 用「默认档包装」另留一套语义。
- [ ] 3.4 `src/bindings/VaultConfig.ts` 由 ts-rs 重导出（两个新字段）；重导出产物先 `git add` 再跑门禁
  （`bindings-drift` 的既有纪律）。

## 4. 前端内联编辑预检

- [ ] 4.1 `src/tree.ts` 删除 `IGNORED_NAMES` 与其在 `validateEntryName` 里的名单判定；保留形状校验与撞名预检；
  doc comment 改写为「忽略集判定由后端权威，前端只做形状校验与结果回显」。
- [ ] 4.2 `src/tree.ts:1282` 附近与 `src/main.ts` 里「用户规则命中 ⇒ lazy」的注释改为「惰性档或用户规则命中 ⇒ lazy」。
- [ ] 4.3 `tests/unit/tree-paths.test.ts`：删除「内置名字表与 Rust 侧 `BUILTIN_NAMES` 逐项对账」测试与
  `IGNORED_NAMES` 导入；校验矩阵里 `target` / `node_modules` / `.venv` 等惰性档名字改为「可提交」，
  `.git` / `.DS_Store` 的用例改为「前端不判、交后端」（矩阵只断言形状与撞名）；
  补一条反向见证：`target` 在前端不再被拒（证明名单副本真的删了，不是换个名字留着）。
- [ ] 4.4 文案核对：`D146`（忽略集名拒绝句）不再由前端触发；后端 `fs_name_invalid` 的原因句走既有回显。
  在 `文案-Copy.md` 或代码注释里如实记一句「D146 的前端触发点随本 change 退役，后端拒绝原因沿用既有句」，
  不删除文案条目（编号不复用）。

## 5. 回扫既有期望（改准，不只加新覆盖）

- [ ] 5.1 `src-tauri/src/fs_io.rs` 既有单测逐条改准：
  `builtin_table_matches_exactly_the_declared_names_and_tmp_patterns`、
  `builtin_rules_are_equivalent_to_the_legacy_predicate_on_a_name_corpus`、
  `classify_has_three_branches_and_builtin_wins_over_user_negation`、
  `watch_verdict_covers_the_six_branches`、`validate_new_name_rejects_dot_slash_ignored_and_accepts_normal`、
  `validate_new_name_ignores_user_rules_but_rejects_builtin_names`——按新语义重写，MUST NOT 只删断言。
- [ ] 5.2 `src-tauri/tests/vault_open_readings.rs`：`node_modules` 期望从「不进枚举」改为「一行惰性条目」；
  探针的注释口径同步改准。
- [ ] 5.3 （**scope 待扩**）`scripts/acceptance/scenarios/67-vault-open-ignore-set.md`：
  `target` / `dist` / `test-results` / `node_modules` / `.venv` 的「不进树」期望改为「出惰性行」；
  「外部新建内置规则目录不产生幻影行」改为「产生一行惰性 created、不补子孙」；展开 / 读取惰性文件的步骤
  与截图重跑；标题与 seed 注释同步改口径。
- [ ] 5.4 `docs/backlog.md` 复核：若 acceptance 场景的编号 / 残留问题受影响，登记一行指针；不改无关条目。

## 6. 验证

- [ ] 6.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过。
- [ ] 6.2 `pnpm test`（前端单测）与 `cargo test`（Rust 单测 + 集成）全绿。
- [ ] 6.3 `scripts/gate.sh quick` 全绿；完成报告照抄 `GATE RESULT` 原文行与退出码（SKIP 单列）。
- [ ] 6.4 真机验收：场景 67 改准后跑一次，证据落 `test-results/acceptance/`（git 外）。
- [ ] 6.5 归档评审对账：tasks 勾选状态 / spec 增量 / 实现三者一致；未做的项就地标注放弃原因。
