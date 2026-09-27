# Tasks: vault-switch-restore-perf

> 本 mission（M268）只产提案四件套（proposal / design / tasks / spec delta）与真机场景草案；下列任务属
> **实现期**，等 Alex 节点 1 裁决后由后续 mission 承接。裁决改推荐项（尤其裁决点 1 取「整批并发」）时，
> 先按 proposal 的裁决点表改写 spec delta 的第二条 requirement 与本文件，再动工——不静默偏离提案。

## 1. 先补读数（先决：不做完这一组不动代码）

- [ ] 1.1 `src/main.ts`：`saveThenRun` 路径补一条 `phaseMs`（名字 `vault_load_flush`，覆盖「保存并切换」出口的写盘段），阈值沿用 `VAULT_PHASE_SLOW_MS`。
  **验收口径**：dirty 且脏文档较大时，日志里出现 `vault_load_flush`；干净路径 MUST NOT 出现（没有写盘就没有这条）。
- [ ] 1.2 `src-tauri/src/commands.rs`：`fs_io::watch()` 前后各取一次时刻，落一条 `vault_open_watch` 读数（走既有诊断通道，事件名与白名单字段不新造）。
  **验收口径**：日志里能读到 426 目录 vault 的 watch 建流耗时；`cargo clippy` / `cargo test` 不受影响。
- [ ] 1.3 真实形状的读数落档：按 M265 §六-2 做**复刻真实形状的合成 vault**（≈2500 项 / 1341 md / 7MB、行长正常、含一个 `node_modules` 验证忽略生效）跑一遍，拿三段读数（`vault_load_open` / `vault_load_tree` / `vault_load_restore`）+ 1.1 / 1.2 的两条，落 `test-results/`（git 外）。
  **验收口径**：读数与 M154 的 111.2ms、M252 的 21–30ms/标签 并列可比；**MUST NOT** 复用稀疏单行文件放大器（M265 §三的假象）。
- [ ] 1.4 恢复段的成本拆分：用真机日志里「标签数 vs `vault_load_restore` 毫秒数」的关系，估出每标签固定成本与随规模成本；在 design 的 §1 表格里把「未验」改成实测值。
- [ ] 1.5 Alex 侧的自助读数（零成本）：请 Alex 在本机切一次真实 vault 后 grep `~/.config/lumir/logs/*.jsonl` 的 `vault_load`，把四行读数贴回（**agent MUST NOT 打开他的真实 vault**：会写 registry / last_vault 到 `~/.config/lumir`）。
  **验收口径**：读数进 review-request / design；裁决点 2 / 3 按它定夺。

## 2. 反馈窗口：指示覆盖写盘段（对应 spec 的「装载的即时反馈」）

- [ ] 2.1 `src/vault-switcher.ts` + `src/main.ts`：「保存并切换」出口在 `await deps.saveAll()` **之前**起指示，写盘失败（保存未闭环）时撤下且不继续切换。
  **验收口径**：`vault-switcher` 保持可脱离 DOM 单测（指示的开关经装配层注入，不把 UI 句柄塞进 deps）；新增单测覆盖「写盘失败 ⇒ 不切换且指示被撤」与「取消 ⇒ 不开指示」。
- [ ] 2.2 单测：`tests/unit/`（vault-switcher 的既有测试文件里加用例）——三种出口的指示开关时序逐条断言。
- [ ] 2.3 真机：场景 60 的第 5 步（选定出口后指示在场）+ 反向验证（探针，见 2.4）。
- [ ] 2.4 **反向验证（REVIEW.md 第 1 条）**：临时在 `saveAll` 里注入延迟，确认「指示在写盘期间在场」这条判据会因实现回退（指示仍起于 `loadUserVault`）而 FAIL；现场与探针代码回退记录落 `test-results/`。
  **验收口径**：探针步骤先红后绿；判据的区分度有实测依据，不靠推理。

## 3. 会话恢复：先建壳，再填充（对应 spec 的「装载后恢复标签列表」；裁决点 1）

- [ ] 3.1 `src/editor.ts`：会话支持「有路径、内容未装载」的壳态（`path` / `mode` / `editable` 就位、内容为空，`ensureMtime` 推迟到装载时）。
  **验收口径**：壳态标签在 `sessionSnapshot`（`src/vault-switcher.ts:110-120`）里被计入（否则会话文件会被截断——这是纯惰性案被否决的原因，见 design §3.1）；`session.path === undefined` 的既有语义（未命名文档）不受影响。
- [ ] 3.2 `src/vault-switcher.ts`：恢复改成「建壳（同步、按 `plan.open` 顺序）→ 装载激活项 → 其余按裁决结果挂按需或并发」；`restoreGen` 的作废检查在整批收口处比对。
  **验收口径**：单测覆盖顺序（壳的顺序 = 存储顺序）、激活项退化规则、跳过计数在装载完成时给出、代际作废。
- [ ] 3.3 若裁决取「整批并发」：按 design §3.2 处理 `save.beginSwitch()` / `isCurrent` 的在途请求语义（整批铸一个 serial）与标签顺序（靠建壳保序），并补单测。
- [ ] 3.4 dirty 语义：未装载标签 MUST NOT 被 `vaultSwitchBlock` / `saveAllDirty` 当成脏或「无落盘基准」。
  **验收口径**：单测——标签栏有未装载标签时切换与退出不被拦下；`saveAllDirty` 跳过它们。
- [ ] 3.5 阅读位置：按需装载的标签在其内容装载时恢复位置（复用 `readingPositions.restoreFor`），结果与今天一致。
- [ ] 3.6 读数复验：改完重跑 1.3 的合成 vault，`vault_load_restore` 应当与标签数脱钩（对话激活标签数，而不是会话条数）；读数落 `test-results/`。
  **验收口径**：读数出来之前 MUST NOT 在 proposal / spec / review-request 里写「已把切换做快了」这类结论（REVIEW.md 第 6 条）。

## 4. 建图与树：局部优化按读数决定，两个否决项落账（裁决点 2）

- [ ] 4.1 若裁决点 2 取「纳入」：`src-tauri/src/fs_io.rs` / 读取路径把 `canonicalize(root)` 提到循环外 + 加「已校验批量读」路径（M154 §7）。
  **验收口径**：1341 个 md 的 `build_graph` 读数前后对比落档；`cargo test` 全绿；不改变任何文件读取的语义与错误分支（越界 / 符号链接 / 权限路径的既有测试不改判据）。
- [ ] 4.2 若裁决点 2 取「推迟」：在 design 与本文件标注推迟理由与当时的读数，不静默跳过。
- [ ] 4.3 增量建图：确认**不做**，把暂缓理由（上限 111.2ms + 缓存失效风险）写进 `docs/backlog.md`。
- [ ] 4.4 树 DOM 虚拟化：把否决依据（`renderAll` 只挂根级 + `setVault` 先 `expanded.clear()` ⇒ 切换时 DOM 22–24 行）写进 `docs/backlog.md`（M265 §四-2 的建议落点）。
  **验收口径**：4.3 / 4.4 各一条可 grep 的 backlog 条目，含依据与日期。

## 5. 打开段是否移出主线程（裁决点 3）

- [ ] 5.1 按 1.2 的 watch 读数与 open 段总时长定夺：显著（>100ms 量级）则纳入本 change，否则记「暂缓 + 当时读数」。
- [ ] 5.2 若纳入：`vault_open_path` 走 `#[tauri::command(async)]` 或复用 M159 的两阶段 `prepare` / `commit`（先核实 `State` 借用与 `Send` 约束，本轮未核实）。
  **验收口径**：打开段不再占主线程（真机上切换期间指示仍在推进/无 beachball，或按当时可观测的证据记实）；前端 `inFlight` 串行化语义不变。
- [ ] 5.3 若纳入：`cargo test` 全绿 + 真机复验场景 60 与 25 / 17（多 vault 切换的既有场景）。

## 6. 真机验收场景 60

- [ ] 6.1 把本 change 的 `acceptance-scenario.md` 落成 `scripts/acceptance/scenarios/60-vault-switch-restore.md`，fixture 与会话条数按实际目录核定。
  **验收口径**：`node scripts/acceptance/run.mjs --check` PASS；`run.mjs 60` 真机 PASS，证据落 `test-results/acceptance/<日期>/60-vault-switch-restore/`（`status.txt` = PASS）。
- [ ] 6.2 反向验证：把 2.1 的指示起点回退到 `loadUserVault`，场景 60 的写盘段判据必须 FAIL（现场留档）。
- [ ] 6.3 场景草案的「覆盖边界」逐条复核，**MUST NOT** 把「秒级快照延迟下分辨不了」的两件事写成已覆盖。
- [ ] 6.4 编号再核一次：动工前查 `scripts/acceptance/scenarios/` 目录与各在飞 change 的编号声明，被占则取下一个可用号（proposal 的编号声明带对冲条款）。

## 7. 验证

- [ ] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 7.2 `bash scripts/docs-check.sh` PASS
- [ ] 7.3 `bash scripts/gate.sh quick` 全绿（含 `cargo test` / tsc / 单测）
- [ ] 7.4 动过 `src/style.css` 或 `src/preview/**` 则 `bash scripts/gate.sh visual` 全绿（本 change 预期不动视觉面；动过就必须跑）
- [ ] 7.5 真机 `node scripts/acceptance/run.mjs 60` PASS（证据落档，含 6.2 的反向验证现场）
- [ ] 7.6 读数对账：design §1 的表格逐行改成「读数 / 仍未验」，未验的一律写明（REVIEW.md 第 6 条）

## 8. 收口与外部依赖

- [ ] 8.1 **归档顺序（硬依赖）**：本 change 的 spec delta 有两条 MODIFIED，其基线正文现在分别在两份未归档 change 的 delta 里——
  - 「装载的即时反馈」只在 `openspec/changes/vault-switch-feedback/` 的 delta 里（living spec 里还没有这个 requirement）⇒ `vault-switch-feedback` **MUST 先归档**，否则 `openspec archive` 会拒绝本 delta（`validate --strict` 会以 INFO 报 `Archive would refuse this delta: … not found`，这是本 change 有意保留的工具级依赖，不是漏改）；
  - 「装载后恢复标签列表」由 `openspec/changes/preview-tab-removal/` 改写（本 delta 已按它的 M254 口径拼接过）⇒ 它也 **MUST 先归档**，归档时再核一遍。
  **验收口径**：归档前 `npx --yes @fission-ai/openspec@1.12.0 list` 确认这两份都已从活跃列表消失。
- [ ] 8.2 `docs/backlog.md` 登记：本 change 的待归档跟踪、4.3 / 4.4 两个否决与暂缓项、裁决点 4 的 perf 门禁缺口（`scripts/perf/` 无 vault 切换端点）。
- [ ] 8.3 裁决点 4：若 Alex 裁「新增切换端点」，**另立 change**（要动的是性能合同语义，不是加一个脚本）；本 change 不顺手做。
- [ ] 8.4 review-request 逐任务对账（含裁决点、delta 与实现的一致性、design 的未验项清单）。

### 编号声明

真机场景取 **60**（试占）。依据（2026-09-27 核对 master 的 `scripts/acceptance/scenarios/`）：目录内现有编号最大
**53**；在飞 / 已落地声明依次为 54 = M260、55 = M267、56 = M261、57 = M262、58 = M263、59 = M264、53 = M259。
**实现期动工前 SHALL 再核一次目录与各 change 的编号声明**，不盲取。
文案 deck：本 change **预期零新增用户可见文案**（见 proposal 的编号声明）；若实现期确需新增，取当时 deck 末位的
下一个可用编号（M265 的试占是 D156），同样动工前再核。
