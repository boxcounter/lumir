# Tasks: vault-open-ignore-set

> 本 mission（M290）只产提案四件套（proposal / design / tasks / spec delta）与真机场景草案；
> 下列任务属**实现期**，等 Alex 节点 1 裁决后由后续 mission 承接。
> **Alex 节点 1 裁决（2026-09-28）已落进本文件**：A3 名单（`build` / `out` / `vendor`）不收；
> B 案（读 `.gitignore` / `.git/info/exclude`）纳入，且被挡住的条目在左栏树里 **MUST 仍然可见**；
> `#[command(async)]` 纳入；**同日第二轮指令：把内置名单与用户忽略声明合并成一份规则表**（同一匹配器，
> 来源决定去向，内置规则不可被用户规则取反推翻）——见 §1 / §2。**实施前先读 design §11 的影响面清单**
> （新增依赖、`FsEntry` 加字段、树模型变更、惰性区域解析降级、`is_ignored` 退役）——已按 Alex 2026-09-28 的裁决确认接受。
> 若裁决改推荐项（例如回收 B 案为独立 change），先按 proposal 的裁决点表改写 spec delta 与本文件，再动工。

## 1. 一份规则表：内置规则（对应 fs-io「全类型递归枚举」）

- [ ] 1.1 `src-tauri/src/fs_io.rs`：`IGNORED_NAMES` **退役**，改为**内置规则表**——16 条名字字面量（既有 3 + A1 11 + A2 `target` / `dist`；**不含** `build` / `out` / `vendor`）+ 1 条临时文件模式 `.*.lumir-*`，用 `GitignoreBuilder::add_line` 编进匹配器（与用户规则**同一个**匹配器）。
  **验收口径**：`cargo test` 全绿；单测逐条钉住新表（枚举侧：命中的条目与子孙都不出现；判据侧：`dist-old` / `targets` / `Target` 不被命中，`build` / `out` / `vendor` **不**被命中）。
- [ ] 1.2 **对拍测试（等价性由机制保证，不靠人眼）**：对一份名字 corpus 同时跑「今日名字等值判据（名字等值 + `starts_with('.') && contains('.lumir-')`）」与「新内置匹配器」，逐条断言一致。
  **验收口径**：corpus 至少含 `target` / `Target` / `target.md` / `dist-old` / `builds` / `build` / `out` / `vendor` / `.DS_Store` / `node_modules` / `.venv` / `.pnpm-store` / `.a.lumir-1` / `..lumir-1` / `.lumir-notes.md` / `note.md.lumir-1` + 嵌套路径（`a/target/x.md`、`a/.git/config`）；**已知可接受差异**（名字恰为 `.lumir-`）在测试里显式标注、不许静默。
- [ ] 1.3 核对使用点仍走同一份表（枚举 `read_dir` 循环、`expand_new_dir_subtrees`、`validate_new_name`、watch 判定），**表只有一处**、`is_ignored` 的等值分支删干净。
  **验收口径**：`rg -n "IGNORED_NAMES|is_ignored" src-tauri/src` 的命中面与 design §10 一致（REVIEW.md 第 8 条）；`fs_io` MUST NOT 残留第二份名单或第二个判定实现。
- [ ] 1.4 忽略计数诊断（design §3.3）：枚举收口记一行「被内置规则剪掉的条目数」。
  **验收口径**：新增 `LogEventName::VaultScanIgnored` 与它的 `allowed_fields`（**只有** `count`，十进制字符串——[logging.rs:133](../../../src-tauri/src/logging.rs#L133) 是机制化护栏）；日志可 `grep vault_scan_ignored`；MUST NOT 记被忽略条目的路径或名字原文；注释里写明消费者（用户报「文件不见了」时的第一诊断依据，REVIEW.md 第 9 条）。
  **附带**：living spec 的 diagnostics Purpose 叙述里列了事件族，实现期按需补一份 diagnostics delta 让它跟上（事件名白名单只住在代码里）。

## 2. 用户规则：来源、优先级与判定顺序（对应 fs-io「全类型递归枚举」的规则表条款）

- [ ] 2.1 `src-tauri/Cargo.toml`：新增依赖 `ignore`（用它的 `gitignore` 模块；内置规则与用户规则共用同一匹配器——「少一种硬编码特例」就落在这里）。
  **验收口径**：`cargo clippy` / `cargo build` 通过；依赖树与体积写进 review-request（供 Alex 看成本）。
- [ ] 2.2 `src-tauri/src/fs_io.rs`：新增 `IgnorePolicy`（纯 std 类型，**不引 tauri**，ADR 0002 §7）：**一份规则表**（内置匹配器 + 用户规则匹配器栈 + 物化集合 `Arc<Mutex<HashSet<PathBuf>>>`），提供 `classify(rel, is_dir) -> Hidden | Lazy | Visible`，判定顺序固定为「**内置先判且命中即定格** → 用户规则（最深匹配决定）→ 其余可见」；`rel_string` 换成按祖先组件的判定（最后一段不判规则）。
  **验收口径**：单测覆盖三分支 + **内置优先于用户规则**（`.gitignore` 写 `!target/` 时 `target` 仍是 Hidden）+ 用户规则内部的取反生效（`drafts/` 忽略 + `!drafts/keep/` 放回）+「祖先被排除 ⇒ 子孙全被排除」+「最后一段不判规则」；`fs_io` MUST NOT 出现 `tauri::` 依赖（能编译即证）。
- [ ] 2.3 用户规则的来源与优先级：`<root>/.gitignore` + 递归途中的嵌套 `.gitignore` + `<root>/.git/info/exclude`（仅当 `.git` 是目录）；优先级按 git 口径（深层 `.gitignore` > 浅层 > `info/exclude`）；**不读全局 excludes**；在 vault 装载时编译一次。
  **验收口径**：单测逐条：`.gitignore` 生效 / `info/exclude` 生效 / 两份来源冲突时深层 `.gitignore` 决定 / 全局 excludes **不**生效 / `.git` 是文件（gitlink）时不读 `info/exclude` / 非 git 仓库但有 `.gitignore` 时仍生效。
- [ ] 2.4 规则变更的生效时点：本会话不重编，下次装载生效；把这条写进代码注释与 spec 的已知边界。
  **验收口径**：单测——改了 `.gitignore` 后同一会话内枚举形态不变；重新构造策略（模拟下次装载）后形态改变。

## 3. 按需枚举命令与 `lazy` 标记（对应 fs-io「按需枚举目录」+ file-tree）

- [ ] 3.1 `FsEntry` 新增 `lazy: bool`（ts-rs 导出面变更）；`scan_workspace` 为惰性条目填 true，其余 false。
  **验收口径**：`src/bindings/**` 重导出并 `git add`（`bindings-drift` 门禁的既有纪律）；前端全部消费点重新编译通过。
- [ ] 3.2 `src-tauri/src/fs_io.rs` + `commands.rs`：新增 `fs_scan_dir(dir)`——**一层**枚举、分类口径与枚举同源、走与读取同源的 vault 内校验（MUST NOT 放松边界）、目标不存在/不是目录给人话 `CommandError`、成功即把该目录登记进物化集合。
  **验收口径**：单测：一层（不递归）/ 惰性子目录仍出 `lazy` 行 / 越界路径（`..`、绝对路径、符号链接逃逸）返回 `CommandError` / 物化登记可观察（登记后该目录下的变更进入事件流，见 4.2）。
- [ ] 3.3 该 command 标 `#[command(async)]`（口径同 7.1）。
  **验收口径**：展开一个条目数大的目录时界面不整段冻结（真机上由场景 67 的同类判据覆盖；逻辑面靠 `cargo test` + 代码走查）。

## 4. watch 判定与物化登记（对应 fs-io「watch 增量事件流」）

- [ ] 4.1 `src-tauri/src/fs_io.rs`：事件判定换成 §4.4 的逐组件规则（内置规则祖先丢弃；用户规则祖先未物化丢弃；否则投递；最后一段不判规则 ⇒ 行级事件总是投递）。
  **验收口径**：单测：未物化的惰性目录内部变更**不**产生事件；物化后**产生**事件；惰性条目自身的 created/deleted 总产生事件；内置规则命中的目录下的变更一律不产生事件（含祖先链上更深的情形）。
- [ ] 4.2 `VaultState` 持有所述策略，装载时重建（物化集合 MUST NOT 跨 vault 串用）；`prepare_vault_open` 把它交给 watch / scan / graph / `fs_scan_dir` / 子树展开 / 名字校验。
  **验收口径**：单测（或 Rust 集成测试）——切换 vault 后上一 vault 的物化登记不生效。
- [ ] 4.3 目录改名那条既有通道（`deleted:旧` + `created:新(dir)` 带子树）按新策略收口：创建出来的目录若命中规则，只带一行（惰性），不带子孙；旧路径的物化登记随 `deleted` 清除。
  **验收口径**：扩写既有 `watch_dir_rename_delivers_full_subtree` 一族的测试（新增惰性分支），先核存量用例仍绿。

## 5. 索引与消费面口径（对应 fs-io 的确定性条款 + vault-workspace 的恢复条款）

- [ ] 5.1 链接索引（`build_graph`）与附件索引（`src/main.ts` 的 `attachmentPaths`）：只由主动枚举的条目建出；**按需展开的结果 MUST NOT 补进索引**。
  **验收口径**：单测（Rust）——含惰性目录的 vault 上，`build_graph` 的条目集与主动枚举一致；展开后仍一致（前端侧在 `src/main.ts` 就地写注释说明口径，不在展开路径上调索引相关代码）。
- [ ] 5.2 会话恢复的「在不在 vault 内」：`src/vault-switcher.ts` 的 `planRestore` 不再只看条目集——新增一次存在探测（后端入口；可复用 `fs_file_meta` 或等价命令，只探测不改写；代价上界 = 会话条目数）；跳过计数仍在装载完成时给出。
  **验收口径**：单测（`tests/unit/vault-switcher.test.ts`）——条目集里没有但探测存在的路径**照常恢复**且不进跳过计数；探测失败才计跳过；探测不得并发发起（沿用既有的逐条串行口径）。
- [ ] 5.3 写清三条已知边界（spec 已写，实现期在代码注释里给指针）：惰性区域 wikilink / 附件的解析降级；`wikilink_create` 对惰性目标可能造重复文件（本 change 不改）；规则不热生效。

## 6. 文件树：惰性行可见 + 按需展开（对应 file-tree 两条 MODIFIED）

- [ ] 6.1 `src/tree.ts`：`lazy` 目录的展开走 `fs_scan_dir`（异步）并把结果按路径合并进模型再 `expandNode`；MUST NOT 渲染成空目录；取数在途不阻塞界面、不覆盖用户在同拍里的其他操作。
  **验收口径**：视觉场景（chromium + 桩后端，`tests/visual/scenes/` 新增或扩写）——惰性目录展开前不显示为「无子条目」、展开后子行就位、排序与既有规则一致；桩后端不注入测试专用开关。
- [ ] 6.2 惰性条目的行行为能力与普通条目一致：可点开（打开链路是路径直读，不查索引）、可右键（重命名 / 删除 / 新建子项 / 在 Finder 中显示）、命中内置规则名字时仍被拒绝。
  **验收口径**：视觉场景或真机场景 67（打开 + 右键菜单在场）；`validate_new_name` 的单测已覆盖内置规则拒绝与用户规则命中的名字不拒绝。
- [ ] 6.3 展开态与改名 / 删除的既有语义在惰性目录上不回退（§4.3 的改名口径 + 树里行的实时增删）。
  **验收口径**：扩写既有目录改名视觉场景，覆盖「惰性目录改名后仍是可展开的惰性行」。

## 7. 打开段与按需枚举移出 IPC 主线程（对应 vault-workspace「vault 打开」）

- [ ] 7.1 `src-tauri/src/commands.rs`：`vault_open_path` 标 `#[command(async)]`（保持同步 `fn` 形态，tauri 宏生成 `sync_threadpool` 语义），注释写明线程语义已与 `vault_open` 拉平。
  **验收口径**：`cargo clippy` / `cargo test` 全绿；真机场景 67 的「打开段内界面可响应」由红转绿（修前 `get_app_state` 只回 `element_count: 1`，见 design §9.1）。
- [ ] 7.2 反向验证（REVIEW.md 第 1 条）：临时去掉 `#[command(async)]` 重跑场景 67，那条判据必须 FAIL（读不到节点）；现场与回退记录落 `test-results/`。
  **验收口径**：先红后绿两次运行都在档（同一场景、同一放大器）。
- [ ] 7.3 多 vault 的既有行为不回退：切换守卫三出口、remap 候选短路、重定位、启动恢复的真机场景（16 / 17 / 19 / 25 / 48 / 60）PASS。
  **验收口径**：`node scripts/acceptance/run.mjs 16 17 19 25 48 60` 全 PASS，证据落 `test-results/acceptance/<日期>/`。

## 8. 分段读数（design §6）

- [ ] 8.1 `prepare_vault_open`：`scan_workspace` 与 `build_graph` 前后各打一条（`vault_open_scan` / `vault_open_graph`，走 `logging::slow_callback` 的既有事件名与字段，**无条件记录**；本 change 里唯一新增事件名的位置是 1.3）。
  **验收口径**：真机日志里两条都在；单测沿用 `logging::tests::rust_side_slow_callback_lands_same_shape_as_frontend` 的同形口径。
- [ ] 8.2 `fs_scan_dir` 打一条 `vault_scan_dir`（阈值 250ms，与前端 `phaseMs` 同口径）。
  **验收口径**：展开一个条目数大的目录时日志出现该行；小目录不出现。
- [ ] 8.3 读数复采：用 M289 的 harness（`src-tauri/tests/vault_open_readings.rs`，复现命令见 design §1）在**本实现**上重跑一次，把「主动枚举量收窄后」的数字更新为实测（现在是 M289 手工收口得到的 65.8ms）。
  **验收口径**：读数落 `test-results/`；design §1 / §6 的表格逐行改成「读数 / 仍未验」（REVIEW.md 第 6 条）。**MUST NOT** 把 65.8ms 直接当成实现结论（口径详见 design §8）。
- [ ] 8.4 真机 gap 归因（design §6.3）：请 Alex 在本机切一次真实 vault 后 grep `~/.config/lumir/logs/*.jsonl` 的 `vault_open_scan` / `vault_open_graph` / `vault_load_open` / `vault_open_watch` 四条（**agent MUST NOT 打开他的真实 vault**：会写 registry / last_vault 到 `~/.config/lumir`），把残差写回 design §6.3。
  **验收口径**：四条读数并列记档；读不到就写「仍未知」，不推断。

## 9. 真机验收场景 67

- [ ] 9.1 `scripts/acceptance/lib/app.mjs` 的 `generateBulkVault`：加两类探针——① 内置规则构建产物族（根下 `target/` / `dist/` / `test-results/` 各带若干 md）；② 用户规则（写一份 `.gitignore` 声明 `.local/` **并带一条取反 `!target/`**，写一份 `.git/info/exclude` 声明另一个目录，两者各带一个 md）——取反那条让真机也有一条「内置不可被推翻」的判据。形状参数与 Rust 侧 harness 一起核。
  **验收口径**：`node scripts/acceptance/run.mjs --check` PASS；场景 60（既有 `bulkVault: {}` 调用方）不受影响仍 PASS。
- [ ] 9.2 把本 change 的 `acceptance-scenario.md` 草案落成 `scripts/acceptance/scenarios/67-<slug>.md`：`id` 用 67（**动工前按 proposal 的「编号声明」再核一次目录与在飞 change**，被占则取下一个可用号）。
  **验收口径**：`--check` PASS；`node scripts/acceptance/run.mjs 67` 真机 PASS，证据落 `test-results/acceptance/<日期>/67-*/`（`status.txt` = PASS）。
- [ ] 9.3 三组判据各自做反向验证（REVIEW.md 第 1 条）：① 内置规则 → 把内置表回退成 3 个名字 ⇒「构建产物目录不在树里」FAIL；② 用户规则 → 把规则读取关掉（或把用户规则命中的条目标成内置）⇒「`.local` 行在树里 / 展开可见」FAIL；③ 打开段 → 见 7.2；④ 读数通道 → 临时摘掉埋点 ⇒ 末步 FAIL。
  **验收口径**：四次先红后绿的现场都在档；`MUST NOT` 只把「场景写了」当覆盖（REVIEW.md 第 6 条）。
- [ ] 9.4 场景的「覆盖边界」逐条复核，**MUST NOT** 把「快照延迟下分辨不了」的事写成已覆盖；放大器 MUST NOT 放进惰性探针目录（design §9.4）。
- [ ] 9.5 放大器口径复核：场景日志里的 `vault_load_open` MUST NOT 被当成规模读数（场景 60 已立此惯例）。

## 10. 验证

- [ ] 10.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 10.2 `bash scripts/docs-check.sh` PASS
- [ ] 10.3 `bash scripts/gate.sh quick` 全绿（含 `cargo test` / tsc / 单测 / bindings-drift——本条改动到 ts-rs 导出面，重导出产物要先进索引再跑门禁）
- [ ] 10.4 动过视觉面（树的行形态 / 展开行为）则 `bash scripts/gate.sh visual` 全绿（基线零 diff 或走人肉裁决）
- [ ] 10.5 真机 `node scripts/acceptance/run.mjs 67` PASS（含 9.3 的反向验证现场）
- [ ] 10.6 覆盖声明对账：每处「已验 / 已覆盖」都给出证据指针（场景名 + PASS 计数），拿不出的写「未验」（REVIEW.md 第 6 条）

## 11. 收口与外部依赖

- [ ] 11.1 `docs/backlog.md`：登记本 change 的待归档跟踪；把 M289 survey 的读数落成可 grep 的条目（现在只存在于 `.tower/comms/` 的一条 inbox 消息里，而 `.tower/**` 不入 git——证据要有 canonical 居所）；登记三条后续候选（`wikilink_create` 的重复文件风险、规则热生效、「显示被忽略项」的显式开关——内置规则不可被 `.gitignore` 取反推翻之后，它是用户想读构建产物时的正当出口）；裁决未采纳项（A3、C 案）记「未采纳 + 理由」。
  **验收口径**：条目可 grep（含日期、读数、文件指针）。
- [ ] 11.2 若 Alex 对 design §11 的影响面提出回收（例如 B 案另立 change）：按 proposal 的裁决改法回退 spec delta 与任务组，**不静默缩水**。
- [ ] 11.3 review-request 逐任务对账（含裁决点、delta 与实现的一致性、design 的未验项清单、影响面清单的落地核对）

### 编号声明

真机场景取 **67**（试占）。依据（2026-09-28 起草时核对）：`scripts/acceptance/scenarios/` 现有编号最大 **65**；
**66 已被在飞的 M288 占用**（`feat/fix-code-block-selection-visibility-m288` 的 `66-code-block-selection.md`）。
**实现期动工前 SHALL 再核一次目录与各在飞 change 的编号声明**，不盲取。
文案 deck：本 change **预期零新增用户可见文案**（内置规则静默；惰性行沿用树行既有形态，不加加载指示；
被隐藏名字的新建/改名沿用既有 `fs_name_invalid` 模板）。若实现期确需新增，取当时末位的下一个可用编号
（2026-09-28 核对末位是 **D321**），同样动工前再核。
