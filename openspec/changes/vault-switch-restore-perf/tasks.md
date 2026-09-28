# Tasks: vault-switch-restore-perf

> 本 mission（M268）只产提案四件套（proposal / design / tasks / spec delta）与真机场景草案；下列任务属
> **实现期**，等 Alex 节点 1 裁决后由后续 mission 承接。裁决改推荐项（尤其裁决点 1 取「整批并发」）时，
> 先按 proposal 的裁决点表改写 spec delta 的第二条 requirement 与本文件，再动工——不静默偏离提案。

## 1. 先补读数（先决：不做完这一组不动代码）

- [x] 1.1 `src/main.ts`：`saveThenRun` 路径补一条 `phaseMs`（名字 `vault_load_flush`，覆盖「保存并切换」出口的写盘段），阈值沿用 `VAULT_PHASE_SLOW_MS`。
  **验收口径**：dirty 且脏文档较大时，日志里出现 `vault_load_flush`；干净路径 MUST NOT 出现（没有写盘就没有这条）。
- [x] 1.2 `src-tauri/src/commands.rs`：`fs_io::watch()` 前后各取一次时刻，落一条 `vault_open_watch` 读数（走既有诊断通道，事件名与白名单字段不新造）。
  **验收口径**：日志里能读到 426 目录 vault 的 watch 建流耗时；`cargo clippy` / `cargo test` 不受影响。
- [x] 1.3 真实形状的读数落档：按 M265 §六-2 做**复刻真实形状的合成 vault**（≈2500 项 / 1341 md / 7MB、行长正常、含一个 `node_modules` 验证忽略生效）跑一遍，拿三段读数（`vault_load_open` / `vault_load_tree` / `vault_load_restore`）+ 1.1 / 1.2 的两条，落 `test-results/`（git 外）。
  **验收口径**：读数与 M154 的 111.2ms、M252 的 21–30ms/标签 并列可比；**MUST NOT** 复用稀疏单行文件放大器（M265 §三的假象）。
- [x] 1.4 恢复段的成本拆分：用真机日志里「标签数 vs `vault_load_restore` 毫秒数」的关系，估出每标签固定成本与随规模成本；在 design 的 §1 表格里把「未验」改成实测值。
- [x] 1.5 Alex 侧的自助读数（零成本）：请 Alex 在本机切一次真实 vault 后 grep `~/.config/lumir/logs/*.jsonl` 的 `vault_load`，把四行读数贴回（**agent MUST NOT 打开他的真实 vault**：会写 registry / last_vault 到 `~/.config/lumir`）。
  **未做（外部依赖）**：需要 Alex 在自己机器上切一次真实 vault 后 grep `~/.config/lumir/logs/*.jsonl`（agent 打开他的真实 vault 会写 registry / last_vault，纪律不允许）。裁决点 2 / 3 已按 1.3 的合成真实形状读数定夺（见 4.2 / 5.1）。
  **验收口径**：读数进 review-request / design；裁决点 2 / 3 按它定夺。

## 2. 反馈窗口：指示覆盖写盘段（对应 spec 的「装载的即时反馈」）

- [x] 2.1 `src/vault-switcher.ts` + `src/main.ts`：「保存并切换」出口在 `await deps.saveAll()` **之前**起指示，写盘失败（保存未闭环）时撤下且不继续切换。
  **验收口径**：`vault-switcher` 保持可脱离 DOM 单测（指示的开关经装配层注入，不把 UI 句柄塞进 deps）；新增单测覆盖「写盘失败 ⇒ 不切换且指示被撤」与「取消 ⇒ 不开指示」。
- [x] 2.2 单测：`tests/unit/`（vault-switcher 的既有测试文件里加用例）——三种出口的指示开关时序逐条断言。
- [x] 2.3 真机：场景 60 的第 5 步（选定出口后指示在场）+ 反向验证（探针，见 2.4）。
- [x] 2.4 **反向验证（REVIEW.md 第 1 条）**：临时在 `saveAll` 里注入延迟，确认「指示在写盘期间在场」这条判据会因实现回退（指示仍起于 `loadUserVault`）而 FAIL；现场与探针代码回退记录落 `test-results/`。
  **验收口径**：探针步骤先红后绿；判据的区分度有实测依据，不靠推理。

## 3. 会话恢复：先建壳，再填充（对应 spec 的「装载后恢复标签列表」；裁决点 1）

- [x] 3.1 `src/editor.ts`：会话支持「有路径、内容未装载」的壳态（`path` / `mode` / `editable` 就位、内容为空，`ensureMtime` 推迟到装载时）。
  **验收口径**：壳态标签在 `sessionSnapshot`（`src/vault-switcher.ts:110-120`）里被计入（否则会话文件会被截断——这是纯惰性案被否决的原因，见 design §3.1）；`session.path === undefined` 的既有语义（未命名文档）不受影响。
- [x] 3.2 `src/vault-switcher.ts`：恢复改成「建壳（同步、按 `plan.open` 顺序）→ 装载激活项 → 其余按裁决结果挂按需或并发」；`restoreGen` 的作废检查在整批收口处比对。
  **验收口径**：单测覆盖顺序（壳的顺序 = 存储顺序）、激活项退化规则、跳过计数在装载完成时给出、代际作废。
- [x] 3.3 若裁决取「整批并发」：按 design §3.2 处理 `save.beginSwitch()` / `isCurrent` 的在途请求语义（整批铸一个 serial）与标签顺序（靠建壳保序），并补单测。
  **不适用**：裁决点 1 取「带壳惰性」（proposal 推荐案），「整批并发」案未采纳 ⇒ 本条无对象。
- [x] 3.4 dirty 语义：未装载标签 MUST NOT 被 `vaultSwitchBlock` / `saveAllDirty` 当成脏或「无落盘基准」。
  **验收口径**：单测——标签栏有未装载标签时切换与退出不被拦下；`saveAllDirty` 跳过它们。
- [x] 3.5 阅读位置：按需装载的标签在其内容装载时恢复位置（复用 `readingPositions.restoreFor`），结果与今天一致。
- [x] 3.6 读数复验：改完重跑 1.3 的合成 vault，`vault_load_restore` 应当与标签数脱钩（对话激活标签数，而不是会话条数）；读数落 `test-results/`。
  **验收口径**：读数出来之前 MUST NOT 在 proposal / spec / review-request 里写「已把切换做快了」这类结论（REVIEW.md 第 6 条）。

## 4. 建图与树：局部优化按读数决定，两个否决项落账（裁决点 2）

- [x] 4.1 若裁决点 2 取「纳入」：`src-tauri/src/fs_io.rs` / 读取路径把 `canonicalize(root)` 提到循环外 + 加「已校验批量读」路径（M154 §7）。
  **不适用**：裁决点 2 取「推迟」（读数 `vault_load_open` ≈92–107ms « 250ms，见 4.2 与 design §7.1）。
  **验收口径**：1341 个 md 的 `build_graph` 读数前后对比落档；`cargo test` 全绿；不改变任何文件读取的语义与错误分支（越界 / 符号链接 / 权限路径的既有测试不改判据）。
- [x] 4.2 若裁决点 2 取「推迟」：在 design 与本文件标注推迟理由与当时的读数，不静默跳过。
- [x] 4.3 增量建图：确认**不做**，把暂缓理由（上限 111.2ms + 缓存失效风险）写进 `docs/backlog.md`。
- [x] 4.4 树 DOM 虚拟化：把否决依据（`renderAll` 只挂根级 + `setVault` 先 `expanded.clear()` ⇒ 切换时 DOM 22–24 行）写进 `docs/backlog.md`（M265 §四-2 的建议落点）。
  **验收口径**：4.3 / 4.4 各一条可 grep 的 backlog 条目，含依据与日期。

## 5. 打开段是否移出主线程（裁决点 3）

- [x] 5.1 按 1.2 的 watch 读数与 open 段总时长定夺：显著（>100ms 量级）则纳入本 change，否则记「暂缓 + 当时读数」。
- [x] 5.2 若纳入：`vault_open_path` 走 `#[tauri::command(async)]` 或复用 M159 的两阶段 `prepare` / `commit`（先核实 `State` 借用与 `Send` 约束，本轮未核实）。
  **不适用**：裁决点 3 取「暂缓」（watch 建流实测 0.4–1.6ms « 100ms，见 5.1）。
  **验收口径**：打开段不再占主线程（真机上切换期间指示仍在推进/无 beachball，或按当时可观测的证据记实）；前端 `inFlight` 串行化语义不变。
- [x] 5.3 若纳入：`cargo test` 全绿 + 真机复验场景 60 与 25 / 17（多 vault 切换的既有场景）。
  **不适用**：同 5.2；场景 25 / 17 的复验另由本 change 的真机批次顺带覆盖（本 change 未动 open 段）。

## 6. 真机验收场景 60

- [x] 6.1 把本 change 的 `acceptance-scenario.md` 落成 `scripts/acceptance/scenarios/60-vault-switch-restore.md`，fixture 与会话条数按实际目录核定。
  **验收口径**：`node scripts/acceptance/run.mjs --check` PASS；`run.mjs 60` 真机 PASS，证据落 `test-results/acceptance/<日期>/60-vault-switch-restore/`（`status.txt` = PASS）。
- [x] 6.2 反向验证：把 2.1 的指示起点回退到 `loadUserVault`，场景 60 的写盘段判据必须 FAIL（现场留档）。
- [x] 6.3 场景草案的「覆盖边界」逐条复核，**MUST NOT** 把「秒级快照延迟下分辨不了」的两件事写成已覆盖。
- [x] 6.4 编号再核一次：动工前查 `scripts/acceptance/scenarios/` 目录与各在飞 change 的编号声明，被占则取下一个可用号（proposal 的编号声明带对冲条款）。

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [x] 7.2 `bash scripts/docs-check.sh` PASS
- [x] 7.3 `bash scripts/gate.sh quick` 全绿（含 `cargo test` / tsc / 单测）
- [x] 7.4 动过 `src/style.css` 或 `src/preview/**` 则 `bash scripts/gate.sh visual` 全绿（本 change 预期不动视觉面；动过就必须跑）
- [x] 7.5 真机 `node scripts/acceptance/run.mjs 60` PASS（证据落档，含 6.2 的反向验证现场）
- [x] 7.6 读数对账：design §1 的表格逐行改成「读数 / 仍未验」，未验的一律写明（REVIEW.md 第 6 条）

## 8. 收口与外部依赖

- [x] 8.1 **归档顺序（硬依赖）**：本 change 的 spec delta 有两条 MODIFIED，其基线正文现在分别在两份未归档 change 的 delta 里——
  - 「装载的即时反馈」只在 `openspec/changes/vault-switch-feedback/` 的 delta 里（living spec 里还没有这个 requirement）⇒ `vault-switch-feedback` **MUST 先归档**，否则 `openspec archive` 会拒绝本 delta（`validate --strict` 会以 INFO 报 `Archive would refuse this delta: … not found`，这是本 change 有意保留的工具级依赖，不是漏改）；
  - 「装载后恢复标签列表」由 `openspec/changes/preview-tab-removal/` 改写（本 delta 已按它的 M254 口径拼接过）⇒ 它也 **MUST 先归档**，归档时再核一遍。
  **验收口径**：归档前 `npx --yes @fission-ai/openspec@1.12.0 list` 确认这两份都已从活跃列表消失。
- [x] 8.2 `docs/backlog.md` 登记：本 change 的待归档跟踪、4.3 / 4.4 两个否决与暂缓项、裁决点 4 的 perf 门禁缺口（`scripts/perf/` 无 vault 切换端点）。
- [x] 8.3 裁决点 4：若 Alex 裁「新增切换端点」，**另立 change**（要动的是性能合同语义，不是加一个脚本）；本 change 不顺手做。
- [x] 8.4 review-request 逐任务对账（含裁决点、delta 与实现的一致性、design 的未验项清单）。

### 编号声明

真机场景取 **60**（试占）。依据（2026-09-27 核对 master 的 `scripts/acceptance/scenarios/`）：目录内现有编号最大
**53**；在飞 / 已落地声明依次为 54 = M260、55 = M267、56 = M261、57 = M262、58 = M263、59 = M264、53 = M259。
**实现期动工前 SHALL 再核一次目录与各 change 的编号声明**，不盲取。
文案 deck：本 change **预期零新增用户可见文案**（见 proposal 的编号声明）；若实现期确需新增，取当时 deck 末位的
下一个可用编号（M265 的试占是 D156），同样动工前再核。


## 实现期对账（M283，2026-09-28）

### 一、读数（先读数后动代码；两处裁决点都由读数落定）

工具：`src-tauri/tests/vault_open_readings.rs`（`#[ignore]`，release 直调生产函数；合成 vault 与
场景 60 的 `seed.bulkVault` 同形状：2142 文件 / 426 目录 / 1341 md / 6.7MB）+ 真机日志
（场景 60，debug 构建）。证据索引：`test-results/m283/README.md`。

| 读数 | 值 | 支撑 |
|---|---|---|
| `scan_workspace`（release 中位，两次运行） | 10.6 / 13.0ms | 打开段 |
| `build_graph`（release 中位，两次运行） | 81.5 / 94.4ms | **裁决点 2 取「推迟」**（打开段合计 ≈92–107ms « 250ms） |
| `build_graph` canonicalize 外提复刻（仅估上限，两次运行） | 55.7 / 61.7ms ⇒ 收益上限 ≈26–33ms | 同上（M154 当时估 ≈45ms） |
| `watch` 建流（release 中位两次 / 真机） | 1.5–1.6ms / 0.4–0.5ms | **裁决点 3 取「暂缓」**（« 100ms） |
| `vault_load_restore`（40 标签，真实形状 vault，**改动前**） | 984 / 997 / 1182ms ⇒ ≈25–30ms/标签（单变量探针复测，`before-probe/`；首轮 901–1056ms 同档） | 裁决点 1 的推荐案依据；与 M252 的 77 条目 vault 读数同档 ⇒ 跨规模无放大 |
| `vault_load_restore`（同场景，**改动后**） | **20ms**（切回 A）/ 30–31ms（启动恢复） | 3.6 的验收读数：与标签数脱钩（≈32–54×） |
| `vault_load_open`（切回 A，debug / release） | 612–630ms / ≈92–107ms | 本 change 不动这一段（改动前后同档） |
| `vault_load_flush` | 干净路径 0 条（两轮）；注入 8s 写盘段 ⇒ 8013ms 一条 | 1.1 的埋点（阈值口径沿用 250ms） |
| `vault_open_watch` | 0.4–0.5ms（两轮同档） | 1.2 的埋点（刻意无阈值） |

### 二、与提案的两处偏离（都带实测依据，不静默）

1. **场景 60 的第 5 步不写「选定出口后指示在场」**（任务 2.3 的正观测改由 2.4 的探针承担）。
   实测机制：套件的 AX 读取需要主线程空闲，而打开段（`vault_open_path`）与写盘段
   （`document_save`）都是同步 command——阻塞期间 `get_app_state` 只回 `element_count: 1`
   （读不到任何节点）；本 change 又把恢复段压到毫秒级 ⇒ 指示的窗口在真机上没有**可读**部分。
   按 REVIEW.md 第 2 条，「读不到」不得写成「指示不在场」，因此这条断言留在场景里就是一条恒假红。
   判别力改由探针给：同一场景 + 写盘段注入 8s 定时器（主线程空闲、可读）⇒ 有修复时 PASS、
   把指示起点回退到装载壳时 FAIL（两次现场落 `test-results/m283/probe-indicator-window/`）；
   逻辑面另由 `tests/unit/vault-switcher.test.ts` 的「指示窗口」组钉住。
2. **`vault_load_restore` 改成无条件记录**（`phaseMs(..., true)`，其余三段仍沿用 250ms 阈值）。
   理由：阈值口径下「变快了」会表现成「日志里没有这一行」，与「这一段没跑」不可区分——
   本 change 的卖点正好是这一段，读数因此必须可比。vault 装载是低频的用户动作，不稀释日志。

### 三、逐任务对账

| 任务 | 状态 | 证据 / 说明 |
|---|---|---|
| 1.1 `vault_load_flush` 埋点 | 完成 | `src/main.ts` 的 `saveAll` 包装（脏路径专有）；干净路径 0 条（两轮日志）；正向路径在探针注入版里落 8013ms |
| 1.2 `vault_open_watch` 读数 | 完成 | `src-tauri/src/commands.rs` 的 `prepare_vault_open` 打点 + `logging::slow_callback` 助手（事件名/字段复用白名单）+ 单测 `rust_side_slow_callback_lands_same_shape_as_frontend` |
| 1.3 真实形状读数 | 完成 | `src-tauri/tests/vault_open_readings.rs`（生成器与 `seed.bulkVault` 同形状）+ 场景 60 的真机日志；`test-results/m283/` |
| 1.4 恢复段成本拆分 | 完成 | design §1 表格已改成实测值（22–26ms/标签；跨规模对照闭合「未验」） |
| 1.5 Alex 自助读数 | **未做（外部依赖）** | 需要 Alex 在本机 grep 自己的日志（agent 不得打开他的真实 vault）；裁决点 2/3 已由 1.3 的等效读数定夺 |
| 2.1 指示覆盖写盘段 | 完成 | `VaultSwitchGateDeps.saveAllWindow`（装配层注入 `vaultLoading`）+ `saveThenRun` 的 begin/end 收口 |
| 2.2 单测（三出口时序） | 完成 | `tests/unit/vault-switcher.test.ts` 的「指示窗口」组 5 条（begin 早于 saveAll、干净路径不开、未闭环撤下、抛错撤下、取消/放弃不开） |
| 2.3 真机第 5 步 | **部分**（见「偏离 1」） | 正观测改由探针承担；场景 60 保留「守卫浮条三条出口 + 此刻无指示」的负向配对 |
| 2.4 反向验证（探针） | 完成 | `test-results/m283/probe-indicator-window/`（探针模板、补丁、两次运行证据、main.ts 回退核对） |
| 3.1 会话壳态 | 完成 | `EditorSession.loaded` + `createShellSession` + `activate()` 的 mtime 门控；单测钉「壳一样入盘」（`sessionSnapshot`） |
| 3.2 恢复改成建壳 + 装载激活项 | 完成 | `src/vault-switcher.ts` 的 `restore`（含 `shellsBuilt` 一拍）；单测 5 条（顺序、时序、退化、世代、空态） |
| 3.3 整批并发案 | 不适用 | 裁决点 1 取「带壳惰性」（proposal 推荐案），备选案未采纳 |
| 3.4 dirty 语义 | 完成 | 壳的 `dirty` 恒 false ⇒ 不进 `vaultSwitchBlock` / `saveAllDirty` / 不算无基准；单测 `未装载标签（壳态）不拦切换 / 退出…` |
| 3.5 阅读位置 | 完成 | 与打开共用 `loadSessionContent` ⇒ `readingPositions.restoreFor` 在内容装载时跑；无独立断言（滚动在本套件没有通道，同 49 的记录） |
| 3.6 读数复验 | 完成 | 40 标签：改动前 1182ms → 改动后 20ms（同场景同机器；before 侧为单变量探针复测） |
| 4.1 建图局部优化 | 不适用 | 裁决点 2 取「推迟」（读数 ≈92–107ms « 250ms） |
| 4.2 推迟落账 | 完成 | 本文件与 design §4/§7.1 标注推迟理由与读数（两次独立运行都在档） |
| 4.3 增量建图暂缓 | 完成 | `docs/backlog.md`「增量建图：暂缓（M283 登记）」 |
| 4.4 树 DOM 虚拟化否决 | 完成 | `docs/backlog.md`「树 DOM 虚拟化：否决（M283 登记）」 |
| 5.1 打开段是否移出主线程 | 完成 | 定夺为「暂缓」：watch 0.4–1.6ms、open 段合计 ≈92–107ms（release） |
| 5.2 / 5.3 async 化 | 不适用 | 同上 |
| 6.1 场景 60 落地 | 完成 | `scripts/acceptance/scenarios/60-vault-switch-restore.md`；`--check` PASS；真机 1/1 PASS（43.7s） |
| 6.2 反向验证（场景判据） | 完成 | 同 2.4 |
| 6.3 覆盖边界复核 | 完成 | 场景正文的「覆盖边界」按实测重写（含「AX 读不到 ≠ 不在场」这条） |
| 6.4 编号再核 | 完成 | 目录内 60 空闲（现有 48–56、59、61、62），无在飞 change 声明 60（60 已被本 change 试占） |
| 7.1 openspec validate --strict | 完成 | 28 passed / 0 failed（`vault-switch-feedback` 未归档导致的 INFO 是 proposal 声明的工具级依赖） |
| 7.2 docs-check | 完成 | `docs-check: PASS` |
| 7.3 gate quick | 完成 | **10/10 PASS（SKIP 0）**：fmt / clippy / cargo test / bindings-drift / tsc×3 / unit 488 / docs-check / openspec-validate |
| 7.4 gate visual | 完成 | **12/12 PASS（SKIP 0）**，含 `visual-regression` 377s——整页基线**零 diff、未做任何 `--update`**（本 change 不动视觉面，`mv-vault-switcher` 的「切到有历史的 vault」场景照旧通过）。首轮 11/12 的唯一红项是 `cargo-fmt`（读数 harness 的文件，已 `cargo fmt` 后复跑 12/12） |
| 7.5 真机场景 60 | 完成 | `test-results/acceptance/2026-09-28/60-vault-switch-restore/status.txt` = PASS |
| 7.6 读数对账 | 完成 | design §1 / §7.1 / §8 逐条改成实测或标注未验 |
| 8.1 归档顺序 | 记录 | `docs/backlog.md`「三份 vault change 的归档顺序」；本 mission 不做归档 |
| 8.2 backlog 登记 | 完成 | 四条：增量建图暂缓、树虚拟化否决、perf 门禁缺口、归档顺序 |
| 8.3 裁决点 4（perf 端点） | 记录 | 不新增；缺口与端点草案留 design §6.4 + backlog |
| 8.4 review-request 对账 | 完成 | 本表 + tower review-request |

### 四、实现期自查修掉的一处新缺陷（本 change 引入、随实现修掉）

按需装载的触发点（`syncActiveDocument` → `ensureActiveSessionLoaded`）会被**会话恢复自身的装载**
回调到（`loadSessionContent` 里的 `tabs.activateTab` 是一次同步点），而恢复那条路径没有登记在途
⇒ 同一个文件被并发装载两次（两次 IPC + 两次装载事务）。首轮 eager 探针把它放大成可见缺陷：
**激活项被抢到别的标签上**（该轮 `激活项是存储里的那一个` 判红、AX dump 里 `Value: true` 落在
`toc-plain.md`）。修法：`src/main.ts` 的 `withSessionLoad` 把两条路径收进同一个在途标记
（会话恢复的 `openPinned` 也走它），eager 探针复跑转为 PASS。现场与前后两次探针证据见
`test-results/m283/README.md` §4.1 与 `before-probe/`。
