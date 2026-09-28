# vault-workspace 增量规格

> 起草注记（非规格正文）：本 delta 两条 MODIFIED，基线都在 living spec
> [openspec/specs/vault-workspace/spec.md](../../../../specs/vault-workspace/spec.md)
> 里（「vault 打开」「装载的即时反馈」——后者由已归档的 change `vault-switch-feedback` 并入）。
> 起草时 master 上无活跃 change，无需等待别的归档。

## MODIFIED Requirements

### Requirement: vault 打开

系统 SHALL 提供 `vault_open` command 调系统目录选择器打开一个目录作为 vault；用户取消选择 SHALL NOT 产生错误状态。打开成功 SHALL 触发一次全量枚举（见 fs-io「全类型递归枚举」）并启动 watch（见 fs-io「watch 增量事件流」）。同一时刻 SHALL 只有一个打开的 vault；再次打开 SHALL 替换当前 vault 并停止对旧 vault 的监听。

打开段（`reconcile_vault` → watch 建流 → 全量枚举 → 建图）SHALL 在 IPC 主线程之外执行：`vault_open`（目录选择器路径）与 `vault_open_path`（按已知路径打开）两条 path 的线程语义 SHALL 一致，MUST NOT 一条在主线程内联执行、另一条不在。依据是用户可观察的：主线程内联执行时，打开段期间 webview 无法重绘，条目数大的 vault 上整窗持续不可交互（用户看到的是系统 beachball），进度指示只能静止显示（见「装载的即时反馈」）；实测与机制见 change `vault-open-ignore-set` 的 proposal 与 design §5。本条款只约束「打开段在哪儿跑」，MUST NOT 被读成对耗时的承诺。

#### Scenario: 目录选择器取消

- **WHEN** 用户在目录选择器中取消
- **THEN** 当前 vault 状态不变，无错误提示

#### Scenario: 重复打开替换当前 vault

- **WHEN** vault A 已打开，用户通过 `vault_open` 打开 vault B
- **THEN** vault A 的 watch 停止，vault B 完成全量枚举并成为当前 vault

#### Scenario: 打开段不整段冻结界面

- **WHEN** 打开一个打开段耗时显著长于一次界面往返的 vault（条目数或文件体积很大）
- **THEN** 打开段的进行期间界面可响应（进度指示与界面节点可读），MUST NOT 整段冻结到打开结束才恢复

### Requirement: 装载的即时反馈

用户发起的 vault 装载（切换 / 重新定位 / 新增）SHALL 在装载期间给出一个**无文案**的不确定进度指示：它 MUST NOT 占用任何常态布局（空闲态逐像素不变）、MUST NOT 遮挡或拦截任何交互（不放遮罩、不改焦点）、MUST NOT 引入新的用户可见文案或读屏名。

反馈窗口 SHALL 从**用户做出决定的时点**起算，并 SHALL 覆盖到目标 vault 的会话恢复结束：

- 切换 / 重新定位：点下列表行的那一刻（行点击 SHALL 同时收起浮层，指示 SHALL 在同一帧内出现，MUST NOT 依赖任何定时器或延迟）；
- 新增：系统目录选择器返回之后（选择器自身开着的时间 MUST NOT 计入——那是用户在挑目录，不是在等 Lumir）；
- 结束点 SHALL 是「装载完成 **且** 会话恢复结束」这一唯一信号，MUST NOT 在树刚重建完就把指示撤下（恢复是逐标签异步的，用户感知到的「卡住几秒」正落在这一段）。

被 dirty 前置门拦下时（尚未开始装载）MUST NOT 出现指示——那时用户手上握着三条出口，指示会与「正在切换」矛盾。**出口执行后，指示 SHALL 覆盖该出口自身要跑完的工作**：

- 「保存并切换」：SHALL 在开始保存全部脏标签**之前**就出现指示并覆盖整个写盘过程——写盘是用户选定这条出口之后在等的活，MUST NOT 留成零反馈窗口（M268：`saveThenRun` 先 `await saveAll()` 再 `proceed()`，而指示原先起于 `proceed()` 内的 `loadUserVault.begin()`，两者之间是一段无反馈）；保存未闭环（冲突 / 写失败 / 无落盘基准）而不继续切换时，指示 SHALL 撤下，MUST NOT 留在屏上；
- 「放弃修改并切换」：不写盘，指示随装载开始出现；
- 「取消」：不装载，MUST NOT 出现指示。

装载失败（目标打开失败 / 装载抛错）SHALL 立刻撤下指示，MUST NOT 留在屏上。启动恢复路径（`last_vault` 自动恢复）MUST NOT 使用本指示——那条路径已有「正在恢复上次打开的 vault……」的空态提示，两者叠着出现是重复表达。

指示 SHALL 覆盖「一次装载」的完整窗口；一次恢复途中用户再发起一次装载时，SHALL 按后一次的总时长持续显示，MUST NOT 因前一次的结束而提前消失。

**已知边界（本 requirement 的判据是「在场」，不是「全程动画」）**：装载的打开段（全量枚举与建图）自 change `vault-open-ignore-set` 起在 IPC 主线程之外执行（见「vault 打开」），该段期间 webview 可重绘、指示得以被人看到（打开段不再必然带来系统 beachball）。**剩余边界**：打开段结束后的前端装配段（payload 解析、文件树与链接索引装配）仍跑在 webview 主线程上，条目数极大的 vault 上仍可能出现一拍不可交互。本 requirement 的判据因此仍是「指示在窗口内**在场**」（元素被布局渲染、进入 AX 树），MUST NOT 被实现为「断言动画帧在推进」；「打开段内界面可响应」的真机正向判据落在该 change 的验收场景 67（本条只要求指示在场）。

#### Scenario: 点击目标行即出现指示

- **WHEN** 当前 vault 是 A，用户点列表里的 B（B 的会话历史非空，装载与恢复都需要时间）
- **THEN** 浮层立刻收起，标题栏右端出现转圈指示，且它出现在 B 的会话恢复结束**之前**——用户不必等到整窗换完才知道点击已经生效

#### Scenario: 保存并切换的写盘期间指示在场

- **WHEN** 当前 vault 是 A，A 里有若干脏标签，用户点列表里的 B 并在守卫提示里选「保存并切换」（这些文件的写盘需要时间）
- **THEN** 指示在写盘开始前就出现，并在写盘与随后的装载、会话恢复全程保持在场——用户从选定出口的那一刻起就有「在处理中」的信号

#### Scenario: 保存未闭环时指示撤下

- **WHEN** 上一步的保存过程中某个脏标签保存失败（冲突 / 写失败 / 无落盘基准）
- **THEN** 不切换，指示撤下（不留一条「正在处理」的信号），只给既有的保存失败提示与出口

#### Scenario: 取消不出现指示

- **WHEN** 当前 vault 是 A，A 里有脏标签，用户点列表里的 B 并在守卫提示里选「取消」
- **THEN** MUST NOT 出现任何指示（没有任何工作在进行），当前 vault 与整窗上下文不变

#### Scenario: 装载完成才消失

- **WHEN** 上一步的切换完成（B 的文件树就位、会话里的标签逐个恢复出来、激活项归位）
- **THEN** 转圈指示消失，界面进入 B 的稳定态

#### Scenario: dirty 拦下时不出现指示

- **WHEN** 当前 vault 里存在未保存修改，用户点列表里的 B
- **THEN** 不出现转圈指示，只给出三条出口（保存并切换 / 放弃修改并切换 / 取消）

#### Scenario: 装载失败时指示撤下

- **WHEN** 目标 vault 打开失败（目录不可读等）
- **THEN** 转圈指示撤下、当前 vault 与整窗上下文不变，只给一条失败提示

#### Scenario: 启动恢复不开指示

- **WHEN** 启动时 `last_vault` 命中、后端恢复完成、前端装载并恢复该 vault 的标签
- **THEN** 标题栏右端 MUST NOT 出现转圈指示（该路径的等待由空态里的「正在恢复上次打开的 vault……」承担）
