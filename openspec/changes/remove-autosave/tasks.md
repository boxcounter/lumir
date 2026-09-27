# Tasks: remove-autosave

**状态**：提案阶段（M276）已完成，**Alex 节点 1（提案评审）已于 2026-09-27 通过**——原话「采纳」，三个决策点（D1 / D2 / D3）全部采纳推荐项，逐条落定见 [proposal.md](proposal.md) 的「裁决记录」节。delta 与 specs 起草时就按推荐项写，**三项全采纳 ⇒ delta 零回改**（「裁决若改备选则先回改 `specs/` 增量再动代码」这条通路未触发）。下列任务因此是**已定口径下的实现清单**，全部留给实现 mission 执行。

本 change 的提案阶段只产出制品；第 1 组是对账结果，已在提案期完成，留作实现期的施工依据。

## 0. 节点 1 裁决入档（M276 尾声，2026-09-27）

- [x] 0.1 把 Alex 节点 1 裁决（2026-09-27 + 原话「采纳」+ D1/D2/D3 逐条落推荐）写进 [proposal.md](proposal.md) 的「裁决记录」节，并把「决策点（待 Alex 节点 1 裁决）」改为已裁决口径（原选项表保留作取舍记账）
- [x] 0.2 本文件内「待裁决 / 条件句」措辞改成已定口径：§3.1 的 D1 备选条件句、§4 的组标题、§4.4 的条件项（D2 采纳 ⇒ **4.4 未触发**）
- [x] 0.3 `npx --yes @fission-ai/openspec@1.12.0 validate remove-autosave --strict` 复跑仍绿（裁决记录只动 proposal / tasks 的散文，**delta 零回改**，见 [design.md](design.md) §8 第 4 条的未触发标注）

## 1. 现状对账（提案期已完成，M276）

- [x] 1.1 通读 `openspec/specs/fs-io/spec.md` 的「自动保存与暂停边界」「崩溃备份与恢复入口」两条 requirement 与 archive 的 `2026-09-12-save-hardening` 提案，厘清自动保存与崩溃备份的**耦合点**：备份当前挂在自动保存的失败分支上（`src/save-controller.ts` 的 `reconcile`：暂停或保存失败才 `backupDirty`）
- [x] 1.2 枚举全部受影响条款与 cross-reference（结论：fs-io 5 条 MODIFIED + 1 条 REMOVED；multi-tabs / keymap-commands / editor-live-preview / file-tree 各 1 条 MODIFIED；diagnostics 仅 Purpose 一句；清单见本文件 §5 与 §6）
- [x] 1.3 核实 Emacs 侧事实（GNU Emacs Manual 20.6 / 20.6.2）：`auto-save-mode` 默认开但写**独立文件**；写回被访问文件的 `auto-save-visited-mode` 非默认——本 change 删的是后者、保留的是前者形态
- [x] 1.4 定案场景 43 的竞态残余面：`docs/backlog.md:802-813` 的真因读数（自写回声 177ms 后被判成外部修改）+ `src/save-controller.ts` 的 `handleExternalChange`（dirty 分支无 revision 比对）
- [x] 1.5 起草四件套（proposal / design / tasks / specs delta）并跑通 `validate`（见 §7）

## 2. 移除自动保存（实现）

- [x] 2.1 `src/save-controller.ts`：删 `paused` 集合、`pauseAutosave` / `resumeAutosave` 与 `autosave_paused` / `autosave_resumed` 两处埋点，并清掉三处调用点（`handleExternalChange` 的 dirty 与 deleted 分支、`forceSaveCurrentFile` 的 conflict / not-found 分支、`discardAndReload` 的 resume）
- [x] 2.2 `src/save-controller.ts`：`saveDocument` 去掉 `auto` 参数与「已自动保存」分支；`reconcile` 的「自动保存 + 失败则备份」二段式拆成单一的「备份到期」路径（见 §3）
- [x] 2.3 `src/editor.ts`：`onDocChanged` 订阅点与 `src/main.ts`、`src/vault-switcher.ts`、`src-tauri/src/logging.rs:423` 的注释口径改为「崩溃备份排期」
- [x] 2.4 全仓核对「自动保存」零残留语义：`rg -n "自动保存|autosave|AUTOSAVE" src/ src-tauri/src/` 的每一处命中要么属本 change 的删除面、要么改述（注释不算产品行为，但口径必须与实现一致）
- [x] 2.5 `src-tauri/src/logging.rs`：从 `LogEventName` 删除 `AutosavePaused` / `AutosaveResumed`（枚举、`as_str`、`level` 三处）与其文档注释；重导出 `src/bindings/LogEventName.ts`，**先 `git add` 导出产物再跑 `quick`**（M249 纪律）

## 3. 崩溃备份改为自有触发 + 生命周期与 dirty 对齐（实现）

- [x] 3.1 `src/save-controller.ts`：新增 `RECOVERY_DEBOUNCE_MS`（初始值 `2000`——**D1 已于 2026-09-27 裁决采纳**，实现按该值落，不再有备选分支；实现期只按实测复核这个绝对值，触发形态不改）与按路径键控的备份定时器：内容变化重置窗口，到期且仍 dirty 才写；`continuous` 断言不得在窗口内写（承接「连续输入期间不写备份」）
- [x] 3.2 备份写入保持现有纪律：异步 IPC、失败只作罢不打断编辑、MUST NOT 落在键入到绘制路径上（ADR 0002 §6）；大文档场景取一次实测读数落档（写入耗时与键击延迟）——读数见 `test-results/m278-impl/perf-backup-write/readings.md`（1.6M 字符文档；把一次备份写入人为拖到 1500ms 时，在途期与对照期的键击延迟差 p50 +5.2ms / max +4.6ms，落在抖动范围内；连续键入期间备份写入 0 次）
- [x] 3.3 **dirty 转 clean ⇒ 清备份**：找到唯一落点（候选是 `src/save-controller.ts` 里按路径的 dirty 转 clean 订阅，或 `editor.markCleanOf` 的调用面补齐），覆盖全部路径——保存成功（已有）、强制覆盖保存（已有）、另存为新文件（已有）、撤销 / 重做回到基线（新增）、重新载入放弃我的修改（新增）、关闭标签放弃修改（新增，`src/tabs.ts`）、切换 vault 放弃修改（新增，`src/vault-switcher.ts` / `save-controller` 的 `vaultSwitchBlock` 出口）
- [x] 3.4 补一条反例自检：把某一处清除路径注释掉，确认对应的单元用例变红（防「清除面看着全、实际漏一条」的假绿，REVIEW.md 第 1 条）——**三条路径逐条摘、四个用例逐条红**（单测 2 条 + 视觉 2 条），读数与现场见 `test-results/m278-impl/reverse-probe/readings.md`（含一条重要现场：视觉套件的 webServer 服务 `dist/`，改 `src/**` 后必须先 `pnpm build` 再跑反例，否则得到假绿）

## 4. 自写回声判据（D2 已裁决：纳入本 change）

**裁决**：D2 于 2026-09-27 采纳推荐 ⇒ 本组任务**在本 change 内执行**（不再有「不做」的分支）；4.4 是当时写的条件项，**未触发**。

- [x] 4.1 `src/save-controller.ts` 的 `handleExternalChange`：`modified` 事件命中打开中文件时，先读一次磁盘 revision（复用 `fsReadSnapshot`）与会话已知基准比对，一致即判为自身写盘回声直接返回；判据 MUST NOT 依赖 `isDirty(path)`
- [x] 4.2 读失败（无后端 / IO 错）时的降级：按「不是回声」处理（保守，宁可多提示一次也不静默忽略真实外部修改），并在注释里写明这条取向
- [x] 4.3 单元与视觉各补一条回归：保存成功后立刻再键入，随后注入 `modified` 事件，断言不出现「检测到外部修改」提示且缓冲不动（对应 delta 的「自身写盘的回声在 dirty 时也不误报外部修改」）
- [x] 4.4（条件项，**未触发**）若 D2 被判为**不做**：删掉本组任务，改为在 `docs/backlog.md` 登记该竞态的残余风险（窗口与后果），并在 delta 里退回「只经 revision 比对丢弃、不重载」的原措辞。**D2 于 2026-09-27 裁决采纳推荐 ⇒ 本条不执行**，保留仅作备选路径的记账（同 list-filter 第 10 组的写法：条件项逐条标注触发与否）

## 5. 交叉引用、文案与流程文档同步（实现）

- [x] 5.1 四处 cross-reference 的 delta 已在本 change 内（`multi-tabs` / `keymap-commands` / `editor-live-preview` / `file-tree`），归档时自动并入——实现期须核对这四处 living spec 的新文本与实现一致，**不另开 change**
- [x] 5.2 `文案-Copy.md`：D55（`已自动保存`）与 D56（`已自动保存当前快照，仍有未保存修改`）退场（标注退场原因与日期，不重编号）；D57–D62（崩溃备份四条 + 发现/恢复/丢弃/不存在）保留不动
- [x] 5.3 `diagnostics` spec 的 Purpose 一句列举了「autosave 暂停/恢复」：归档时手工改准（Purpose 不进 delta 合并通道）
- [x] 5.4 `docs/process/real-machine-acceptance.md`：第 8 行（「M127 自动保存链路」）与第 80 行（08 家族清单）随 §6 的场景增删改准
- [x] 5.5 `docs/backlog.md`：M266 的场景 43 红因条目在 D2 落地后核销（标注「由 change remove-autosave 的 D2 收口」）；`docs/backlog.md:1903`、`:1909`（依赖自动保存防抖的验收设计说明）同步改述
- [ ] 5.6 **跨 change 协调**（owner 不在本 change）：`openspec/changes/enter-auto-indent/specs/editor-live-preview/spec.md` 的 scenario「code 模式继承语法缩进」里有一句「磁盘文件在自动保存后逐字节等于编辑器内容」——该 change 尚未合并，本 change 落地后这句失去成立前提。由 tower 派给该 change 的 owner 改述（已按规矩落 finding）

## 6. 验收场景与测试清单（实现期逐项处置）

处置口径：**删** = 断言的行为已不存在且无替代面；**改** = 断言面存在但前提/等待步/文案需重定；**核对** = 需实读后再定；**新增** = 本 change 引入的新不变量。

### 6.1 真机验收（`scripts/acceptance/scenarios/`）

| 场景 | 与自动保存的关系 | 处置 |
|---|---|---|
| `08-autosave.md` | 整条断言「停止输入 2s 后自动落盘」 | **删**（行为消失）；「编辑内容不丢」的覆盖由 `43`、`41`、`42`、`46` 的显式保存断言承接 |
| `08b-autosave-pause.md` | 断言「冲突待决期间磁盘 sha256 不变」（自动保存已暂停） | **删**：无自动保存后「磁盘不变」恒真，属 REVIEW.md 第 1 条的「没有区分度」；冲突待决态的覆盖保留在 `07-recovery-paths` / `08e-force-overwrite` |
| `08c-crash-recovery.md` | 靠「外部改写造成冲突待决」使自动保存停手后落备份 | **改**：删掉造冲突那一步，改为「键入后等备份 debounce 到期」；重启与两个动作的断言保留 |
| `08d-crash-discard.md` | 同上 | **改**：同 08c 的前提改写 |
| `08e-force-overwrite.md` | 强制覆盖保存链路 | **核对**：若有「等自动保存」类等待步改为显式动作 |
| `43-list-tab-indent.md` | 等待步与正文以「等这次键入的自动保存落盘 + 等它的 fs 回声走完」为设计 | **改**：等待步改为显式 `⌘S` 或直接判「缓冲区有探针 + 磁盘已变」；`ax: { not: "检测到外部修改" }` 护栏**保留**（D2 落地后它是常规判据，不再是绕窗口的权宜） |
| `14-tabs.md` | 靠「外部删除把自动保存停在 not-found 暂停态」把 dirty 变持久 | **改**：dirty 现在天然持久，删掉造暂停态的前置（`:100-112` 与正文 `:236-243`、`:286` 的注解） |
| `17-multi-vault-switch.md` | `:35` 「手动保存或已到期的自动保存都已闭环」 | **改**：措辞改为「手动保存已闭环」 |
| `19-vault-switch-guard.md` | 靠外部改写把 dirty 变持久 | **改**：删前置或改判据（`:33`、`:139-150` 的说明段） |
| `41-editable-non-md-files.md` | 600ms 判据窗口建立在「自动保存 2s 才落盘」上；`:227` 「等自动保存落盘」 | **改**：判据窗口保留（现在只有 ⌘S 会写，判据更稳），删「自动保存兜底」的表述；`:227` 一步改显式保存 |
| `42-non-md-edit-guardrails.md` | `:102` 「等自动保存落盘」 | **改**：显式保存 |
| `46-dotfile-jsonc-highlight.md` | `:124` 600ms 窗口 + `:257-258` 的区分说明 | **改**：措辞 |
| `50-tab-context-menu.md` | `:101` 靠外部改写保持 dirty | **改**：删前置，dirty 天然持久 |
| `53-bold-click-selection.md` | `:58`、`:94` 「等自动保存落盘（2s 防抖）」 | **改**：改显式保存或直接判缓冲内容 |
| `09b-keys-config.md` | `:36` `ax: { has: "/已保存|已自动保存/" }` | **改**：正则去掉 `已自动保存` |
| `scripts/acceptance/README.md` | 「已知边界」中与自动保存相关的说明 | **核对** |

新增（真机）：**暂无强制项**——本 change 的新不变量（备份触发、生命周期清除、回声判据）都能在视觉层与单元层确定性复现（真机侧只保留 08c/08d 的两条端到端恢复路径）。若 D1 取备选值，须在 08c/08d 里同步等待时长。

### 6.2 视觉（`tests/visual/scenes/`）

| 场景 | 关系 | 处置 |
|---|---|---|
| `save-hardening-autosave.spec.ts` | 前两组用例断的是自动保存本身（debounce 落盘、随输入重置）；其余断备份 | **拆**：前两组删；备份组**改**前提为「dirty 后 debounce 到期即备份」；**新增**三组：连续输入不写备份、撤销回基线清备份、回声不误报（D2） |
| `m149-tabs.spec.ts:274-298` | 用外部写入把 alpha 钉在「自动保存已暂停」态；另有一组「自动保存 debounce 逐标签独立」 | **改**：钉态前置删掉；逐标签独立改为判**备份定时器**的路径键控 |
| `m131-keymap-behavior.spec.ts:8-10`、`:286` | 注释与「400ms 远小于 2s 防抖」的等待策略 | **改**：注释口径；等待策略可简化（dirty 不再被自动清掉） |
| `m132-keymap-config.spec.ts:156` | 同上 | **改**：注释 |
| `m130-text-open-trap.spec.ts:11` | 注释列举「自动保存」 | **改**：注释 |

**基线**：本 change 不动 UI 结构与样式，预期**零基线变化**；实现期用一次全量视觉跑验证这个预期，并把读数落档（若出现失配即说明预期错了，停下来查，不 `--update`）。

### 6.3 单元（`tests/unit/`）

| 用例 | 关系 | 处置 |
|---|---|---|
| `save-controller.test.ts` 的「自动保存：停止输入满 debounce 才落盘」 | 断的是被移除的行为 | **改**为备份触发判据（窗口内不写、到期才写） |
| 同文件的「自动保存：冲突暂停期间只写崩溃备份，不硬冲 CAS」 | 前后两半都被改写 | **改**：「不硬冲 CAS」变成「冲突后不自动写盘」（本就无写盘者）；「只写崩溃备份」并入 §3 的用例 |
| 同文件的「save：冲突给 sticky 恢复提示……并暂停自动保存」 | 断言里的暂停语义消失 | **改**：删暂停断言，保留「内容留在内存 + sticky 提示」 |
| 同文件的「诊断埋点：暂停只在跃迁时记一条，重新载入后记 resumed」 | 两个事件被删 | **改**：改为 `recovery_written` 的埋点用例 |
| `tests/unit/harness.ts:158` | 注释「自动保存排期靠它」 | **改**：注释 |

## 7. 验证

- [x] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate remove-autosave --strict` 通过
- [x] 7.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 不引入新 FAIL（基线：本 change 起草前 27 passed / 0 failed）
- [x] 7.3 `npx tsc --noEmit -p tsconfig.json` 通过；`node tests/unit/run.mjs` 全绿（含 §6.3 的改写用例与 §3.4 的反例自检）
- [x] 7.4 `scripts/gate.sh quick` 全绿（含 `bindings-drift`：`src/bindings/LogEventName.ts` 的删项须先 `git add`）
- [x] 7.5 `scripts/gate.sh visual` 全绿，且全量跑的失配清单为**空**（验证「零基线变化」的预期）
- [x] 7.6 真机：`node scripts/acceptance/run.mjs --check` 全场景通过（含改齐后的 08c / 08d / 43 / 14 / 19 / 41 / 50 / 53）；**真机全量批一次**，把 PASS 计数与证据目录写进实现期报告——`--check` 62/62 通过；全量批 **60/62 PASS**（证据 `test-results/acceptance/2026-09-27/`，逐场景留档见 `test-results/m278-impl/acceptance-full-batch.md`）。两条 FAIL（`47-file-tree-context-menu` / `52-dir-rename-expand`）**与本 change 无关**：都停在「逐字符输入新名」那一步，套件把单字符 `-` 交给 KimiCU 的 `press_key`，后者报 `empty key DSL`（产品侧输入框在场且持焦，AX dump 里 `ren-sub` 已落地）；已落 finding `.tower/comms/findings/20260927-worker-impl-remove-autosave-bug-keys-kimicu-press-key-empty-key-dsl-47-52.md`。**本 change 的改动面（08c / 08d / 08e / 09b / 14 / 17 / 19 / 41 / 42 / 43 / 46 / 50 / 53 / 59）全部 PASS**
- [x] 7.7 手工复验一条端到端链路（实现期必做，agent 执行）：编辑 → 不按 `⌘S` → 等备份 debounce → 强杀 app → 重启 → 「恢复内容」→ `⌘S` → 磁盘内容与恢复内容一致——**并入 08c 的后三步**（M278 给该场景补的 `⌘S 落盘 → 磁盘含恢复内容 + 备份清空 + dirty 收窄`），单跑 `node scripts/acceptance/run.mjs 08c` **PASS**（37.6s，证据 `test-results/acceptance/2026-09-27/08c-crash-recovery/`）

## 8. 归档与收尾

- [x] 8.1 `docs/backlog.md` 登记本 change 的待归档跟踪（批次收尾 checklist）
- [ ] 8.2 节点 2（归档评审）通过后 `npx --yes @fission-ai/openspec@1.12.0 archive remove-autosave --yes`，并核对并入后的 living spec：`fs-io` 不再有「自动保存与暂停边界」、四处 cross-reference 的自动保存表述全部退场、`diagnostics` Purpose 已改准
- [x] 8.3 review-request 逐任务对账

## 9. 实现期对账与偏差（M278）

本节记录**实现与上面清单不一致的地方**与理由，供节点 2 与 reviewer 逐条核对；未列出的条目按原样执行。

- **§6.3 第 4 行（「诊断埋点」用例）改了写法**：原文让这条改成「`recovery_written` 的埋点用例」，
  但**前端没有该事件的出口**——`recovery_written` 由 Rust 侧 `commands::recovery_backup` 写入
  （前端只调 `recovery_backup`，不自行记该事件）。两个被删事件之外，前端唯一的保存侧埋点是
  `save_external_change`，因此该用例改写为「外部修改命中打开中文件记一条；自身写盘回声不记」，
  备份侧的证据留在 §6.3 的两条备份用例里（`recovery_backup` 的调用与 `path` / `content` /
  `base_revision` 三字段断言）。
- **§6.1 的 08e 核对结论：无需改动**——它全链路走显式 ⌘S + 显式点选动作，没有依赖自动保存的等待步。
- **§6.1 表外另改了两处**（都在本 change 的改动面内，但原清单没列）：
  1. `scripts/acceptance/scenarios/59-enter-auto-indent.md`：7 个「等自动保存落盘（2s 防抖）」等待步
     改为显式 `⌘S`（发两次换一次丢键的容错）+ 落盘核对。该场景属 change `enter-auto-indent`
     （尚未合并），但它的产物在 `scripts/acceptance/**`——本 change 落地后不修它就必然红，故一并改。
     **与那个 change 的 owner 存在同文件并发改动风险，已在 review-request 里点名**。
  2. `tests/visual/scenes/render-codeblock.spec.ts:861`：该用例在键入过 `x` 之后断言
     `.modeline-path` **逐字等于** `wrap.md`——它靠的正是「自动保存 2s 后把 dirty 清掉」。
     改为 `toContainText("wrap.md")`（判据对象是「切回来的是 A」，`wrap2.md` 不含该子串，
     区分度不变）。这是全量视觉跑里**唯一**因本 change 转红的既存场景。
- **§3.4 的反例自检做了四条对四条**（原清单要求「某一处」）：三条清备份路径逐条摘掉，
  对应四个用例逐条变红（单测 2 + 视觉 2）；读数与一条重要现场（视觉套件服务 `dist/`，
  改 `src/**` 后必须先 `pnpm build` 再跑反例，否则假绿）见
  `test-results/m278-impl/reverse-probe/readings.md`。
- **§6.2 的「新增三组」以外多补了一组**：`m149-tabs.spec.ts` 的「放弃修改并关闭 ⇒ 清备份」——
  `src/tabs.ts` 的显式清除是一条**不经 dirty 跃迁**的路径（会话被直接摘掉），若不补，
  它既没有单测也没有视觉防线（REVIEW.md 第 1 条）。
- **5.6 的 finding 已在提案期（M276）落盘**：`.tower/comms/findings/20260927-worker-proposal-remove-autosav-bug-enter-auto-indent-delta-scenario.md`；
  该 delta 的改述仍归那个 change 的 owner（本 change 的 delta 不覆盖它）。
- **未执行**：§4.4（条件项，D2 已采纳 ⇒ 未触发）、§8.2（节点 2 归档，等 Alex）。

### 9.1 r1 评审驱动的增量（reviewer-remove-autosave-impl，2026-09-27，verdict p2-2items / fix-then-merge）

两条 P2 都在本批修完（tower 裁决：P2-2 不转 backlog）。逐条对账：

- **P2-1（正向交错，已修）**：`dispatchExternalChange` 的 `known = revisions.get(path)` 由
  `await fsReadSnapshot` **之前**挪到**之后**（紧挨 `sessionOf` 复查）。原位置会让「读在途期间完成的
  保存 #2」推进的基准进不了比对 ⇒ 判成外部修改 ⇒ dirty 分支弹带破坏性动作的 sticky 提示，而磁盘上
  没有第三方写入。反例自检：把取样挪回 `await` 之前，新增用例「读在途期间完成的那次保存也算进来」
  如实变红（453 pass / 1 fail），挪回后 454 pass / 0 fail。
  **同一次评审的「反向交错」（读返回 R1、基准已到 R2）按评审口径不修**——它是「复用这次读取换一倍 IO」
  的固有代价、且由保存 #2 自己产生的下一条 watch 事件自愈；已在 `docs/backlog.md`「待修 findings」节
  记账（现象 / 自愈机制 / 为何本批不处理）。
- **P2-2（改名路径备份孤儿，已修）**：新增 `noteRenamed(from, to)`——旧键备份作废、`revisions` 基准
  迁到新键、仍 dirty 的会话按新键**立即**补一份备份（不留「旧备份已清、下次键入才有新备份」的空窗），
  旧键那条待写定时器随键作废；目标路径已有备份时**以新写为准**（`recovery_backup` 是覆盖式写入，而
  缓冲是此刻最新的那一份，理由写在实现处注释）。这是备份生命周期的**第五条**路径（前四条：保存成功 /
  撤销回到基线 / 关标签放弃 / 切 vault 放弃），落点与调用面：
  `editor.remapSessionPaths` 改为返回 `SessionPathRemap[]`（`{from, to}`，目录改名逐会话给出前缀替换后的
  新路径），装配层 `src/main.ts` 的改名流程逐条喂给 `save.noteRenamed`。
  **顺带修掉一条同源缺陷**（探针实测坐实）：`revisions` 按路径键控而改名只换会话路径，此前改名后新路径
  会落进 `saveBaseline` 的 null 分支——打开中的文档在 app 内改名后**不可保存**（⌘S 只给「当前文件尚未可
  保存（未登记磁盘版本）」，一个字都写不出去）。基准随键迁移即修复；回归见
  `tests/visual/scenes/tree-menu.spec.ts` 的「改名 dirty 文档：备份资源随路径迁移」与单测的两条改名用例。
  **既存用例的一处口径修正**：`tree-menu.spec.ts` 原「改名…含反向验证」用例只 fire `modified` 事件、不改
  磁盘——它此前靠「改名后新路径没有基准 ⇒ 判不出回声」偶然通过；基准迁移后该事件按设计就是回声，故补上
  真实的 `externalWrite`（该用例注释本来就写着「被**真实**外部修改时」，现在名副其实）。
