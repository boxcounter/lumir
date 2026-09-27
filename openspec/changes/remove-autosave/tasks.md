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

- [ ] 2.1 `src/save-controller.ts`：删 `paused` 集合、`pauseAutosave` / `resumeAutosave` 与 `autosave_paused` / `autosave_resumed` 两处埋点，并清掉三处调用点（`handleExternalChange` 的 dirty 与 deleted 分支、`forceSaveCurrentFile` 的 conflict / not-found 分支、`discardAndReload` 的 resume）
- [ ] 2.2 `src/save-controller.ts`：`saveDocument` 去掉 `auto` 参数与「已自动保存」分支；`reconcile` 的「自动保存 + 失败则备份」二段式拆成单一的「备份到期」路径（见 §3）
- [ ] 2.3 `src/editor.ts`：`onDocChanged` 订阅点与 `src/main.ts`、`src/vault-switcher.ts`、`src-tauri/src/logging.rs:423` 的注释口径改为「崩溃备份排期」
- [ ] 2.4 全仓核对「自动保存」零残留语义：`rg -n "自动保存|autosave|AUTOSAVE" src/ src-tauri/src/` 的每一处命中要么属本 change 的删除面、要么改述（注释不算产品行为，但口径必须与实现一致）
- [ ] 2.5 `src-tauri/src/logging.rs`：从 `LogEventName` 删除 `AutosavePaused` / `AutosaveResumed`（枚举、`as_str`、`level` 三处）与其文档注释；重导出 `src/bindings/LogEventName.ts`，**先 `git add` 导出产物再跑 `quick`**（M249 纪律）

## 3. 崩溃备份改为自有触发 + 生命周期与 dirty 对齐（实现）

- [ ] 3.1 `src/save-controller.ts`：新增 `RECOVERY_DEBOUNCE_MS`（初始值 `2000`——**D1 已于 2026-09-27 裁决采纳**，实现按该值落，不再有备选分支；实现期只按实测复核这个绝对值，触发形态不改）与按路径键控的备份定时器：内容变化重置窗口，到期且仍 dirty 才写；`continuous` 断言不得在窗口内写（承接「连续输入期间不写备份」）
- [ ] 3.2 备份写入保持现有纪律：异步 IPC、失败只作罢不打断编辑、MUST NOT 落在键入到绘制路径上（ADR 0002 §6）；大文档场景取一次实测读数落档（写入耗时与键击延迟）
- [ ] 3.3 **dirty 转 clean ⇒ 清备份**：找到唯一落点（候选是 `src/save-controller.ts` 里按路径的 dirty 转 clean 订阅，或 `editor.markCleanOf` 的调用面补齐），覆盖全部路径——保存成功（已有）、强制覆盖保存（已有）、另存为新文件（已有）、撤销 / 重做回到基线（新增）、重新载入放弃我的修改（新增）、关闭标签放弃修改（新增，`src/tabs.ts`）、切换 vault 放弃修改（新增，`src/vault-switcher.ts` / `save-controller` 的 `vaultSwitchBlock` 出口）
- [ ] 3.4 补一条反例自检：把某一处清除路径注释掉，确认对应的单元用例变红（防「清除面看着全、实际漏一条」的假绿，REVIEW.md 第 1 条）

## 4. 自写回声判据（D2 已裁决：纳入本 change）

**裁决**：D2 于 2026-09-27 采纳推荐 ⇒ 本组任务**在本 change 内执行**（不再有「不做」的分支）；4.4 是当时写的条件项，**未触发**。

- [ ] 4.1 `src/save-controller.ts` 的 `handleExternalChange`：`modified` 事件命中打开中文件时，先读一次磁盘 revision（复用 `fsReadSnapshot`）与会话已知基准比对，一致即判为自身写盘回声直接返回；判据 MUST NOT 依赖 `isDirty(path)`
- [ ] 4.2 读失败（无后端 / IO 错）时的降级：按「不是回声」处理（保守，宁可多提示一次也不静默忽略真实外部修改），并在注释里写明这条取向
- [ ] 4.3 单元与视觉各补一条回归：保存成功后立刻再键入，随后注入 `modified` 事件，断言不出现「检测到外部修改」提示且缓冲不动（对应 delta 的「自身写盘的回声在 dirty 时也不误报外部修改」）
- [x] 4.4（条件项，**未触发**）若 D2 被判为**不做**：删掉本组任务，改为在 `docs/backlog.md` 登记该竞态的残余风险（窗口与后果），并在 delta 里退回「只经 revision 比对丢弃、不重载」的原措辞。**D2 于 2026-09-27 裁决采纳推荐 ⇒ 本条不执行**，保留仅作备选路径的记账（同 list-filter 第 10 组的写法：条件项逐条标注触发与否）

## 5. 交叉引用、文案与流程文档同步（实现）

- [ ] 5.1 四处 cross-reference 的 delta 已在本 change 内（`multi-tabs` / `keymap-commands` / `editor-live-preview` / `file-tree`），归档时自动并入——实现期须核对这四处 living spec 的新文本与实现一致，**不另开 change**
- [ ] 5.2 `文案-Copy.md`：D55（`已自动保存`）与 D56（`已自动保存当前快照，仍有未保存修改`）退场（标注退场原因与日期，不重编号）；D57–D62（崩溃备份四条 + 发现/恢复/丢弃/不存在）保留不动
- [ ] 5.3 `diagnostics` spec 的 Purpose 一句列举了「autosave 暂停/恢复」：归档时手工改准（Purpose 不进 delta 合并通道）
- [ ] 5.4 `docs/process/real-machine-acceptance.md`：第 8 行（「M127 自动保存链路」）与第 80 行（08 家族清单）随 §6 的场景增删改准
- [ ] 5.5 `docs/backlog.md`：M266 的场景 43 红因条目在 D2 落地后核销（标注「由 change remove-autosave 的 D2 收口」）；`docs/backlog.md:1903`、`:1909`（依赖自动保存防抖的验收设计说明）同步改述
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

- [ ] 7.1 `npx --yes @fission-ai/openspec@1.12.0 validate remove-autosave --strict` 通过
- [ ] 7.2 `npx --yes @fission-ai/openspec@1.12.0 validate --all --strict` 不引入新 FAIL（基线：本 change 起草前 27 passed / 0 failed）
- [ ] 7.3 `npx tsc --noEmit -p tsconfig.json` 通过；`node tests/unit/run.mjs` 全绿（含 §6.3 的改写用例与 §3.4 的反例自检）
- [ ] 7.4 `scripts/gate.sh quick` 全绿（含 `bindings-drift`：`src/bindings/LogEventName.ts` 的删项须先 `git add`）
- [ ] 7.5 `scripts/gate.sh visual` 全绿，且全量跑的失配清单为**空**（验证「零基线变化」的预期）
- [ ] 7.6 真机：`node scripts/acceptance/run.mjs --check` 全场景通过（含改齐后的 08c / 08d / 43 / 14 / 19 / 41 / 50 / 53）；**真机全量批一次**，把 PASS 计数与证据目录写进实现期报告
- [ ] 7.7 手工复验一条端到端链路（实现期必做，agent 执行）：编辑 → 不按 `⌘S` → 等备份 debounce → 强杀 app → 重启 → 「恢复内容」→ `⌘S` → 磁盘内容与恢复内容一致

## 8. 归档与收尾

- [ ] 8.1 `docs/backlog.md` 登记本 change 的待归档跟踪（批次收尾 checklist）
- [ ] 8.2 节点 2（归档评审）通过后 `npx --yes @fission-ai/openspec@1.12.0 archive remove-autosave --yes`，并核对并入后的 living spec：`fs-io` 不再有「自动保存与暂停边界」、四处 cross-reference 的自动保存表述全部退场、`diagnostics` Purpose 已改准
- [ ] 8.3 review-request 逐任务对账
