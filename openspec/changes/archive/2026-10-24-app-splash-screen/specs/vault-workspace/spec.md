# vault-workspace 增量规格

> 起草注记（非规格正文）：本 delta 一条 MODIFIED，基线是 living spec
> [openspec/specs/vault-workspace/spec.md](../../../../../specs/vault-workspace/spec.md) 的「启动恢复的时序与
> 可见性」。**整条复制现行正文再改**（`openspec archive` 对 MODIFIED 是整块替换，少抄的段落会静默消失）：
> 改动只有三处——① 恢复中态的呈现面从「未打开空态布局 + 提示」改为「启动态 + 阶段行（同一句文案）」；
> ② 「打开 vault」入口的承载面在启动态期间由启动态承担；③ 首个 scenario 的 THEN 随 ①② 对齐：既有判据
> 「窗口在恢复完成前即可绘制**并可交互**」在本 delta 里收窄为「即可绘制**并可拖动**」——启动态期间的交互面
> = 窗口拖拽 + 「打开 vault」入口，其余交互对象（树、编辑器、modeline）此刻本不存在。措辞按实收窄（不冒充
> 等价），「恢复完成前可用」的承诺由这两项承担。
> 其余条款（`restore_pending` 语义、`vault:restore_finished`、让位规则、`LUMIR_READY` 位置、全部 scenario 的
> 判据）逐字不变。
>
> 本 delta 只在 D2 裁「覆盖到树可用」时成立；若裁「只到壳挂载」，整条撤回（design.md 头部起草注记）。

## MODIFIED Requirements

### Requirement: 启动恢复的时序与可见性

启动恢复（读取配置、校验 `last_vault` 路径、全量枚举与链接索引建立）SHALL 在 Tauri setup 的主线程之外执行；setup MUST NOT 同步等待其完成。`VaultStatus` SHALL 以 `restore_pending` 字段承载恢复进行态（`true` = 仍在进行；`false` = 终态：已打开 vault，或未打开且 `notice` 为可选人话提示）。前端在 `restore_pending` 为 `true` 时 SHALL 呈现启动态（见 `app-startup` 的「启动态的上屏与撤下」），其中的阶段行取恢复中提示文案（文案见 `文案-Copy.md`），MUST NOT 将其呈现为「尚无 vault」的终态；恢复完成后 SHALL 无需用户操作自动进入该 vault。恢复流程的每一条结束路径（成功 / 无 `last_vault` / `last_vault` 失效 / 配置加载失败 / 打开 vault 失败）SHALL 使 `restore_pending` 转 `false`，并发出 `vault:restore_finished` 事件（无载荷，仅作唤醒信号）。前端 SHALL 以 `vault_current` 的返回值为权威状态、以该事件为唤醒信号：启动时 SHALL 先订阅该事件、再拉取一次状态，MUST NOT 依赖事件必然送达（webview 挂载晚于恢复完成时事件会丢失）。恢复进行期间「打开 vault」入口 SHALL 保持可用（树已呈现时是文件树 pane 的入口；启动态期间由启动态内的同名入口承担），用户此间的成功打开 SHALL 优先于本次恢复。`LUMIR_READY` 的发射位置与语义 SHALL 保持不变（事件循环可接管的标记）；恢复耗时 MUST NOT 计入该端点，也 MUST NOT 以「把该标记移到恢复之后」的方式让门禁覆盖恢复耗时。

#### Scenario: 大 vault 恢复不推迟首帧

- **WHEN** `last_vault` 指向一个全量枚举与索引建立需要数百毫秒的 vault
- **THEN** 窗口在恢复完成前即可绘制并可拖动，界面先呈启动态（其中包含可用的「打开 vault」入口），恢复完成后无需用户操作自动进入该 vault，启动态随树装载完成撤下

#### Scenario: 恢复期间用户另选 vault

- **WHEN** 恢复仍在进行时用户经「打开 vault」入口成功打开了另一个 vault
- **THEN** 本次恢复的结果被整体丢弃（含失败提示），界面保持用户刚打开的 vault；打开入口在恢复期间全程可用，MUST NOT 因恢复进行态被禁用

#### Scenario: 恢复完成早于前端订阅

- **WHEN** 恢复在 webview 挂载前已完成
- **THEN** 前端启动时的 `vault_current` 拉取直接得到已打开的 vault 且 `restore_pending` 为 `false`，事件丢失不影响终态

#### Scenario: 每一条结束路径都进入可见终态

- **WHEN** 配置加载失败 / `last_vault` 路径已失效 / 打开 vault 失败
- **THEN** `restore_pending` 转 `false` 并发出 `vault:restore_finished`，界面进入未打开空态并显示与既有实现一致的人话提示，用户可重新选择目录

#### Scenario: 无 last_vault 的启动

- **WHEN** 配置中没有 `last_vault`
- **THEN** 恢复流程立即结束（`restore_pending` 转 `false`，不产生失败提示），界面呈未打开空态与打开入口

#### Scenario: ready 端点是「事件循环可接管」

- **WHEN** 冷启动测量读取 `LUMIR_READY` 行
- **THEN** 出现在恢复任务启动之前，读数不含 `last_vault` 恢复耗时（本 change MUST NOT 改变该行位置）

