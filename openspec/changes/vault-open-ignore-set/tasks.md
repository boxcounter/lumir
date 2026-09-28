# Tasks: vault-open-ignore-set

> 本 mission（M290）只产提案四件套（proposal / design / tasks / spec delta）与真机场景草案；
> 下列任务属**实现期**，等 Alex 节点 1 裁决后由后续 mission 承接。
> **裁决改推荐项时**（尤其裁决点 1 取 B/C 案、或砍掉 A3 档通用英文词），先按 proposal 的裁决点表
> 改写 spec delta 与本文件，再动工——不静默偏离提案。

## 1. 忽略集扩集（对应 fs-io「全类型递归枚举」）

- [ ] 1.1 `src-tauri/src/fs_io.rs`：`IGNORED_NAMES` 扩到 §proposal 的 19 个名（按裁决点 1 的档位取舍），`is_ignored` 的文档补三条性质（精确匹配 / 任意深度 / 与类型无关）与「为什么不能依赖类型」。
  **验收口径**：`cargo test -p lumir` 全绿；单测逐条钉住新名单（枚举侧：命中的条目与子孙都不出现；判据侧：`dist-old` / `targets` / `Target` 不被忽略）。
- [ ] 1.2 核对四处使用点仍走同一真源（枚举 `read_dir` 循环、`rel_string`、`expand_new_dir_subtrees`、`validate_new_name`），**改动只落名单一处**。
  **验收口径**：`rg -n "IGNORED_NAMES|is_ignored" src-tauri/src` 的命中面与 design §10 一致，无第二份名单（REVIEW.md 第 8 条）。
- [ ] 1.3 watch 与枚举的一致性单测：新名单里的目录（如 `target/`）在 vault 里被外部新建/改名时，SHALL NOT 产生 `fs:entry_changed`；其下文件的事件同样被吞。
  **验收口径**：新增/扩写 fs_io 的单测，先在没有 1.1 的基线上跑一次确认它 FAIL（先红后绿）。
- [ ] 1.4 vault 根与忽略集同名不影响（spec 的 scenario）：把名为 `target` 的目录作为 vault 根，枚举仍返回其内容。
  **验收口径**：单测钉住（这是扩集最容易写出的「整棵树被吃掉」bug）。
- [ ] 1.5 忽略计数诊断（design §3.3 的缓解 1）：枚举收口处记一行「被忽略集剪掉的条目数」。
  **验收口径**：新增 `LogEventName::VaultScanIgnored` 与它的 `allowed_fields`（**只有** `count`，十进制字符串——[logging.rs:133](../../../src-tauri/src/logging.rs#L133) 的 `allowed_fields` 与事件名是机制化护栏）；日志里可 `grep vault_scan_ignored` 读到真实计数；MUST NOT 记被忽略条目的路径或名字原文；**同一 mission 内给出消费者**（REVIEW.md 第 9 条）——消费者是「用户报文件不见了时的第一诊断依据」，写进该事件的注释。
  **附带**：living spec 的 diagnostics Purpose 叙述里列了事件族（`openspec/specs/diagnostics/spec.md`），实现期按需补一份 diagnostics 的 delta 让它跟上（不在本 change 的 delta 里，因为事件名白名单只住在代码里）。
- [ ] 1.6 若裁决点 1 砍掉 A3 档（或对 A 案名单另有取舍）：把被砍的名字从 spec delta 与本任务组同步删掉并重跑 5.1，MUST NOT 只改代码不改 delta。

## 2. 打开段移出 IPC 主线程（对应 vault-workspace「vault 打开」）

- [ ] 2.1 `src-tauri/src/commands.rs`：`vault_open_path` 标 `#[command(async)]`（保持同步 `fn` 形态，tauri 宏生成 `sync_threadpool` 语义），注释写明线程语义已与 `vault_open` 拉平。
  **验收口径**：`cargo clippy` / `cargo test` 全绿；真机场景 67 的「打开段内界面可响应」由红转绿（修前 `get_app_state` 只回 `element_count: 1`，见 design §9.1）。
- [ ] 2.2 反向验证（REVIEW.md 第 1 条）：临时去掉 `#[command(async)]` 重跑场景 67，那条判据必须 FAIL（读不到节点）；现场与回退记录落 `test-results/`。
  **验收口径**：先红后绿两次运行都在档（同一场景、同一放大器）。
- [ ] 2.3 多 vault 的既有行为不回退：切换守卫三出口、remap 候选短路、重定位、启动恢复的全量真机场景（16 / 17 / 19 / 25 / 48 / 60）PASS。
  **验收口径**：`node scripts/acceptance/run.mjs 16 17 19 25 48 60` 全 PASS，证据落 `test-results/acceptance/<日期>/`。

## 3. 打开段分段读数（design §6）

- [ ] 3.1 `src-tauri/src/commands.rs` 的 `prepare_vault_open`：`scan_workspace` 与 `build_graph` 前后各打一条（`vault_open_scan` / `vault_open_graph`，走 `logging::slow_callback` 的既有事件名与字段，**无条件记录**；本 change 里唯一新增事件名的位置是 1.5）。
  **验收口径**：真机日志里两条都在；单测沿用 `logging::tests::rust_side_slow_callback_lands_same_shape_as_frontend` 的同形口径。
- [ ] 3.2 读数复采：用 M289 的 harness（`src-tauri/tests/vault_open_readings.rs`，复现命令见 design §1）在**扩集后**的名单上重跑一次，把「收窄后残余」的数字更新为本次实现的实测（现在是 65.8ms 那条）。
  **验收口径**：读数落 `test-results/`；design §1 的表格逐行改成「读数 / 仍未验」，未验的写明（REVIEW.md 第 6 条）。
- [ ] 3.3 真机 gap 归因（design §6.3）：请 Alex 在本机切一次真实 vault 后 grep `~/.config/lumir/logs/*.jsonl` 的 `vault_open_scan` / `vault_open_graph` / `vault_load_open` / `vault_open_watch` 四条（**agent MUST NOT 打开他的真实 vault**：会写 registry / last_vault 到 `~/.config/lumir`），把残差（前端总时长 − scan − graph）写回 design §6.3。
  **验收口径**：四条读数并列记档；归因结论只按读数写，读不到就写「仍未知」，不推断（REVIEW.md 第 6 条）。

## 4. 真机验收场景 67

- [ ] 4.1 `scripts/acceptance/lib/app.mjs` 的 `generateBulkVault`：加构建产物族探针参数（根下 `target/` / `dist/` / `test-results/` 各带若干 md；默认仍生成 `node_modules` 探针），形状参数与 Rust 侧 harness 一起核。
  **验收口径**：`node scripts/acceptance/run.mjs --check` PASS；场景 60（既有 `bulkVault: {}` 调用方）不受影响仍 PASS。
- [ ] 4.2 把本 change 的 `acceptance-scenario.md` 草案落成 `scripts/acceptance/scenarios/67-<slug>.md`：`id` 用 67（**动工前按 proposal 的「编号声明」再核一次目录与在飞 change**，被占则取下一个可用号）。
  **验收口径**：`--check` PASS；`node scripts/acceptance/run.mjs 67` 真机 PASS，证据落 `test-results/acceptance/<日期>/67-*/`（`status.txt` = PASS）。
- [ ] 4.3 场景的三条判据各自做反向验证（REVIEW.md 第 1 条）：① 忽略集 → 把名单回退成 3 个名 ⇒「构建产物目录不在树里」FAIL；② 打开段 → 见 2.2；③ 读数通道 → 临时摘掉 scan/graph 打点 ⇒ 末步 FAIL。
  **验收口径**：三次先红后绿的现场都在档；`MUST NOT` 只把「场景写了」当覆盖（REVIEW.md 第 6 条）。
- [ ] 4.4 场景的「覆盖边界」逐条复核，**MUST NOT** 把「快照延迟下分辨不了」的事写成已覆盖（场景 60 的覆盖边界节是同族模板）。
- [ ] 4.5 放大器口径复核：拿到的是「测量放大器」而不是产品场景——场景日志里的 `vault_load_open` MUST NOT 被当成规模读数（场景 60 已立此惯例）。
  **验收口径**：场景正文的「覆盖边界」里明写这条。

## 5. 验证

- [ ] 5.1 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 通过
- [ ] 5.2 `bash scripts/docs-check.sh` PASS
- [ ] 5.3 `bash scripts/gate.sh quick` 全绿（含 `cargo test` / tsc / 单测 / bindings-drift）
- [ ] 5.4 动过 `src/style.css` 或 `src/preview/**` 则 `bash scripts/gate.sh visual` 全绿（本 change 预期不动视觉面；动了就必须跑，基线零 diff 或走人肉裁决）
- [ ] 5.5 真机 `node scripts/acceptance/run.mjs 67` PASS（含 4.3 的三处反向验证现场）
- [ ] 5.6 覆盖声明对账：tasks / proposal / review-request 里每处「已验 / 已覆盖」都给出证据指针（场景名 + PASS 计数），拿不出的写「未验」（REVIEW.md 第 6 条）

## 6. 收口与外部依赖

- [ ] 6.1 `docs/backlog.md`：登记本 change 的待归档跟踪；把 M289 survey 的读数落成可 grep 的条目（现在它只存在于 `.tower/comms/` 的一条 inbox 消息里，而 `.tower/**` 不入 git——证据要有 canonical 居所）；裁决点 1 / 2 未采纳的 B/C 案与 A3 档取舍一并记「未采纳 + 理由」。
  **验收口径**：条目可 grep（含日期、读数、文件指针）。
- [ ] 6.2 若裁决点 1 取 B/C 案：**另立 change**（B 案动的是 fs-io 的内部结构与新依赖，C 案动的是配置面），本 change 不顺手做；在本 change 的 backlog 条目里写清「由谁承接」。
- [ ] 6.3 若裁决点 2 取「进名单」：`.tower` 加进 `IGNORED_NAMES` 与 spec delta，并在 backlog 里注明它是本仓库私有约定（产品名单里的一个已知例外）；推荐案（不进名单）则在本条写「不采纳 + 理由」。
- [ ] 6.4 review-request 逐任务对账（含三条裁决点、delta 与实现的一致性、design 的未验项清单）

### 编号声明

真机场景取 **67**（试占）。依据（2026-09-28 起草时核对）：`scripts/acceptance/scenarios/` 现有编号最大 **65**；
**66 已被在飞的 M288 占用**（`feat/fix-code-block-selection-visibility-m288` 的 `66-code-block-selection.md`）。
**实现期动工前 SHALL 再核一次目录与各在飞 change 的编号声明**，不盲取。
文案 deck：本 change **预期零新增用户可见文案**（扩集是静默的；被忽略名字的新建/改名沿用既有
`fs_name_invalid` 模板）。若实现期确需新增，取当时末位的下一个可用编号（2026-09-28 核对末位是 **D321**），
同样动工前再核。
