# Tasks: vault-and-session-removal

> 阶段门：0.2（Alex 提案评审）通过前 MUST NOT 改产品代码。tasks 随实现逐项勾选；实现期发现
> proposal 意图需要变更时，停下更新 proposal 并重走节点 1，不静默扩 scope。

## 0. 提案（节点 1）

- [x] 0.1 起草 `proposal.md` / `design.md` / `specs/vault-workspace/spec.md` / 本文件
- [x] 0.2 Alex 节点 1 评审通过（硬门禁；裁决点 D1–D4 一并裁决，未回的按提案里的倾向落地）
      —— 2026-10-23 裁决「按倾向」（D1 当前 vault 不可移除 / D2 只删注册表项 / D3 有撤销
      非 sticky + 8s / D4 sessions 零改动），见 proposal 的「评审记录」块
- [x] 0.3 裁决结果回填 proposal 的「评审记录」块（逐字），按裁决修正 design 与 delta
      —— 裁决与提案的四个倾向逐条一致，design 与 delta 无需修正

## 1. 后端（`src-tauri/src/vault_registry.rs`）

- [x] 1.1 新增导出类型 `RemovedVault`（id / path / last_opened_at / missing_since / archived_at，
      三个时间字段 `Option<i64>` + `#[ts(type = "number | null")]`），重导出 `src/bindings/RemovedVault.ts`
- [x] 1.2 `vault_remove(id) -> Result<Option<RemovedVault>, CommandError>`：`valid_id` → 读项
      （读不到 = 幂等 `None`）→ 当前 vault 守卫（`vault_remove_current`）→ `remove_file`
      （失败 `vault_remove_failed`，带 `path` / `reason`）→ 返回原值；MUST NOT 探测或触碰 vault 目录
- [x] 1.3 `vault_restore(entry)`：`valid_id` → 目标已存在则成功返回（不覆盖）→ `write_entry` 原子写；
      不刷新 `last_opened_at`、不动 `last_vault`、不触发打开
- [x] 1.4 当前 vault 守卫按**稳定 id**：命令层取 `VaultState::root_policy_and_id()` 的第三元与
      `entry.id` 比对（`vault_not_open` 视为「无当前 vault」，放行）；`lib.rs` 注册两个新命令
- [x] 1.5 Rust 单测（design §2.4）：移除只删目标项文件（同目录其它项、`vault-sessions` /
      `reading-positions` 同名文件、vault 目录内文件逐字节不变）；当前 vault 拒绝；幂等删两次；
      撤销逐字还原三个时间字段、已存在项不被覆盖

## 2. 前端

- [x] 2.1 `src/vault-switcher.ts`：`renderRow` 外层改 `div.vault-row-wrap`，内层保留
      `button.vault-row[role=option]`（id / `aria-selected` / `dataset.vault` / 三个状态类不变），
      兄弟 `button.vault-row-del`（`aria-label` 点名显示名；`currentId` 行不渲染）
- [x] 2.2 确认态：点 × 把行换成「确认句 + 移除 + 取消」三个兄弟（取消复用 D136），取消逐字还原；
      确认调 `deps.requestRemove(row)`，失败由装配层提示、浮层恢复行；任何 `render()` 都重建行
      （确认态不跨重渲染存活）
- [x] 2.3 刷新：`requestRemove` resolve 后重新 `deps.list()`（不就地改 `rowEntries`），保持查询串与
      筛选状态，游标落在原下标（钳到末行）；`VaultSwitcherHandle` 增加 `refresh()`（关着时 no-op）
- [x] 2.4 `src/main.ts`：注入 `requestRemove`（`vaultRemove` + 非 sticky 撤销提示 +
      `undoVaultRemove` → `vaultRestore` → `switcher.refresh()`）；`src/ipc.ts` 增加两个薄封装
- [x] 2.5 `src/style.css`：`.vault-row-wrap`（布局壳）+ `.vault-row-del`（常驻淡色 `×`，
      hover 用 danger 一档，与 `.lumir-hp-sesspop-del` 同语汇）+ 确认态三件；不新增色值 / 字号 / 圆角。
      **与 design §3.1 的实现偏离**：行距与 hover 底**没有**迁到壳上——切换钮是壳里 `flex:1` 的
      子项，而当前项没有移除钮（唯一子项），底色留在 `.vault-row` 上使当前行逐像素不变，且悬停
      移除钮时只有它自己上 danger 一档（迁到壳上需要 `:has()` 把行的状态类映射到壳，且整行
      底色会铺到 × 下面）
- [x] 2.6 前端单测（design §4 五条）：当前行无移除钮 / 失效行有 / 确认态与取消还原 / 确认只调一次
      且刷新重拉 / `refresh()` 关态 no-op（另加：确认失败还原、两种游标落点、刷新保持查询串）

## 3. 文案与文档

- [x] 3.1 `文案-Copy.md` 追加七条（D557–D563：行内移除钮 aria 名 / 确认句 / 移除 / 已移除提示 /
      撤销 + 后端两条错误的人话），编号接合并后 deck 末位（D555–D556 由 M644 占用，已随
      master 合并；rebase 后两侧并存、号码连续无重复）；
      取消复用 D136；同批更新「消费点」映射表与「当前末位」
- [x] 3.2 `src/copy-data.ts` 的 `ERROR_COPY` 增加 `vault_remove_current`（D562）/
      `vault_remove_failed`（D563）两条（`workspace_write` 复用既有码）
- [x] 3.3 `docs/specs/config-reference.md` §4 的 `vault-registry/` 行：补「用户在列表里可移除（只删
      本项文件，不删盘上数据与 per-id 数据，孤儿留在盘上）」；同批改 `src-tauri/src/vault_session.rs`
      模块头的「注册项只归档不删除」为同口径表述
- [ ] 3.4 归档步骤：`openspec/specs/vault-workspace/spec.md:5` 的 capability 概览句「只归档不删除」
      按归档时的实际行为改准（**不在 change 活跃期提前改**）

## 4. 验证

- [x] 4.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过（提案阶段先跑一遍）
      —— 实现期在 `gate.sh quick` 的 `openspec-validate` 复跑，PASS
- [x] 4.2 `bash scripts/docs-check.sh` 通过（含 `openspec-archive-check`；本 change 的 delta 走
      REMOVED + 新名 ADDED 承接条，不改写 living 的既有 scenario，因此对账面按「无 MODIFIED 块」
      读取——若该脚本对 REMOVED 的指向报红，按提示修正 delta）—— `gate.sh quick` 的
      `docs-check` PASS，delta 的 REMOVED 指向未被判红
- [x] 4.3 `bash scripts/gate.sh quick` 全绿，照抄 `GATE RESULT` 原文行与退出码
      —— `GATE RESULT: 10/10 PASS（SKIP 1）`，退出码 0；SKIP 项为 `tsc-visual`
      （当时本 worktree 未装 tests/visual 依赖，随后装齐并单独跑通 `tsc --noEmit`）
- [ ] 4.4 `bash scripts/gate.sh visual` 全绿；浮层元素级基线**重截并逐张核对**（新增一列按钮 =
      真实像素变化，容差会吞小元素；基线过目是人肉裁决点）
      —— 实现期实测（`LUMIR_VISUAL_PORT=4283 bash scripts/visual/run.sh`，全量）：**728 passed /
      1 skipped，退出码 0**（含 `isolation-runs` 2/2，另单独跑过）。但**这正是容差吞变化的现场**：
      逐像素比对旧基线与新渲染，差异 68 / 79360 = 0.00086 < 0.001 的上限（允许 79 px），两块差异各
      7×7，落在 `y72..78 x300..306` 与 `y176..182 x300..306`（= 非当前那两行行尾的 `×`，当前行
      没有）。取证：before / after / diff 三张图 + 确认态渲染图在 `.local/reviews/M646/`（git 外），
      基线重截**待人肉裁决**（未擅自 `--update`）
- [ ] 4.5 真机场景 `scripts/acceptance/scenarios/226-vault-remove.md` 落地并 PASS（design §4 七步；
      含直读盘断言「vault 目录内文件不变」与撤销往返）—— 场景已落地且 `--check` PASS；
      真机跑批需机器窗口，归 tower 排期
- [x] 4.6 信息卫生：新增 fixture / 截图 / 文案里 MUST NOT 出现真实 vault 内容；改动面做一次 text 级
      grep 清扫 —— 已对改动面（含新场景文件）做绝对路径 / 真实目录名清扫，零命中；本批未新增截图
- [ ] 4.7 真机复验登记的已知边界：`listbox` 内兄弟按钮在 WKWebView 读屏树里的实际形态，按场景 226
      的 AX 读数如实登记（若按钮不可读，记边界并说明备选形态，不静默放过）
