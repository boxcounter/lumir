# vault-workspace Specification

## Purpose

定义 vault 的打开与记忆：经系统目录选择器打开 vault、写入 `last_vault` 并在启动时自动恢复（恢复在主线程之外执行，前端有「恢复中」可见态）。M1 出口（只读浏览真实 vault，ADR 0004 §1）的承载面之一。多 vault 能力并入后本 capability 还覆盖：注册表与显式重映射（单激活、稳定 id、只归档不删除）、切换器入口与列表浮层的形态、新增 / 切换 / 失效项重新定位、按 vault 持久化标签列表（有序相对路径 + 激活项，不存未保存内容 / 撤销史 / 光标与滚动位置），以及每次装载后按该列表恢复标签。由 change `add-vault-workspace` 归档并入（2026-09-05，实现 M18 + M20 接线；真实 vault 出口验收由 Alex 人肉执行，见归档 tasks.md 5.2 标注），由 change `startup-restore-off-main-thread` 归档并入（2026-09-18，实现 M159——启动恢复移出主线程、`restore_pending` 与 `vault:restore_finished`），并由 change `multi-vault-workspaces` 归档并入（2026-09-18，实现 M162 + M163 + M164——列表与浮层、切换守卫、会话持久化与装载后恢复）。

## Requirements

### Requirement: vault 打开

系统 SHALL 提供 `vault_open` command 调系统目录选择器打开一个目录作为 vault；用户取消选择 SHALL NOT 产生错误状态。打开成功 SHALL 触发一次全量枚举（见 fs-io「全类型递归枚举」）并启动 watch（见 fs-io「watch 增量事件流」）。同一时刻 SHALL 只有一个打开的 vault；再次打开 SHALL 替换当前 vault 并停止对旧 vault 的监听。

#### Scenario: 目录选择器取消

- **WHEN** 用户在目录选择器中取消
- **THEN** 当前 vault 状态不变，无错误提示

#### Scenario: 重复打开替换当前 vault

- **WHEN** vault A 已打开，用户通过 `vault_open` 打开 vault B
- **THEN** vault A 的 watch 停止，vault B 完成全量枚举并成为当前 vault

### Requirement: last_vault 记忆与启动恢复

vault 实际打开成功后系统 SHALL 将 vault 绝对路径写入配置的 `last_vault` 字段（config.rs 既有字段，add-vault-workspace 起消费）；remap 候选短路返回（vault 未实际打开）时 MUST NOT 写入 `last_vault`。配置写入 SHALL 遵守 ADR 0002 §5 的配置即数据纪律（逐字段校验、非法值人话 warning）。启动时若 `last_vault` 存在且仍是合法目录，系统 SHALL 自动恢复打开该 vault；若路径不存在或不是目录，系统 SHALL 进入未打开状态并给出人话提示，MUST NOT 崩溃或静默卡死。启动恢复 SHALL 在主线程之外执行（时序与完成通知口径见「启动恢复的时序与可见性」），其成功结果与失败提示 MUST NOT 覆盖用户在恢复期间已成功打开的 vault。除异步化与结果让位两条外，本 requirement 的其余口径（写入条件、失效提示内容、无 vault 时的未打开状态）不变。

#### Scenario: 启动自动恢复

- **WHEN** 上次会话以 vault 打开状态退出，且该目录仍存在
- **THEN** 本次启动自动打开该 vault，文件树直接可用

#### Scenario: last_vault 失效

- **WHEN** `last_vault` 指向的目录已被删除或移动
- **THEN** 进入未打开空态，提示该路径不可用，用户可重新选择目录

#### Scenario: remap 候选短路不写 last_vault

- **WHEN** 打开路径触发 remap 候选短路返回（vault 未实际打开）
- **THEN** 配置的 `last_vault` 保持原值，不记忆该次未完成的打开

#### Scenario: 恢复结果不覆盖用户已打开的 vault

- **WHEN** 启动恢复仍在进行时，用户已成功打开了另一个 vault
- **THEN** 本次恢复产生的 vault 与失败提示被整体丢弃，当前 vault 保持用户刚打开的那一个

### Requirement: vault 注册表与显式重映射

系统 SHALL 为每个打开过的 vault 维护稳定 id，`~/.config/lumir/workspaces/` 注册表承载 id 到当前 vault 路径的映射。打开 vault 时若目标路径已注册，系统 SHALL 直接打开，MUST NOT 因注册表中存在路径已失效的其他 vault 而拦停或提示 remap。仅当目标路径未注册且注册表中存在未归档的失效注册项时，系统 SHALL 将其作为疑似移动候选向用户提示；重映射 MUST 经显式 `vault_remap` 完成，MUST NOT 静默断联或静默改绑。候选清单 SHALL 按稳定 id 排序（原 thread 最近活跃度排序随 Thread 特性删除而移除）。注册表项的写入 SHALL 采用临时文件 + rename 原子替换。

失效注册项（幽灵项）SHALL 由枚举/打开链路惰性治理，注册项 MUST NOT 被硬删除。系统 SHALL 在首次观测到某注册项路径失效时记录该时刻；路径失效持续超过宽限期（初始值 24 小时，可随实测调整）后 SHALL 打上归档标记。宽限期内的失效项 SHALL 仍作为 remap 候选（首次观测必出候选，宽限期只决定候选继续出现的时长，保留「移动 vault 后重新打开」的恢复入口）；已归档项 MUST NOT 出现在 remap 候选清单中。已归档项的路径重新出现（外置卷重新挂载、目录被还原）时，系统 SHALL 在同一注册项上清除治理标记并保留其稳定 id，MUST NOT 新建注册项；显式重映射或重新注册同一 id SHALL 同样复位治理标记。治理 SHALL 幂等：状态收敛后重复执行不产生写操作。

#### Scenario: 已注册路径直接打开

- **WHEN** 注册表中存在路径已失效的 vault，而本次打开的目标路径已在注册表中
- **THEN** 系统直接打开目标 vault，不提示 remap 候选

#### Scenario: 疑似移动提示

- **WHEN** 打开 vault 的目标路径未注册，且注册表中存在失效未归档的其他 vault
- **THEN** 系统提示发现可能已移动的 vault，请用户确认重映射

#### Scenario: 显式重映射

- **WHEN** 用户确认某失效注册项对应当前打开的 vault
- **THEN** `vault_remap` 将该稳定 id 绑定到新路径并更新 `last_vault`，注册表不再静默断联

#### Scenario: 宽限期内的失效项仍是移动候选

- **WHEN** 某注册项路径刚被观测到失效，且失效时长未超过宽限期
- **THEN** 该注册项仍作为 remap 候选出现，并记录本次失效时刻

#### Scenario: 幽灵项超宽限期后归档

- **WHEN** 某注册项路径失效持续超过宽限期，用户再次打开未注册目录
- **THEN** 该注册项被标记归档（注册项文件保留），不再作为 remap 候选出现，remap 门不因它拦停打开

#### Scenario: 归档项路径恢复后身份复位

- **WHEN** 已归档注册项的路径重新出现（如外置卷重新挂载）
- **THEN** 系统在同一注册项上清除治理标记，稳定 id 保留，不新建注册项

#### Scenario: 治理幂等收敛

- **WHEN** 注册表状态已收敛（无跃迁）时重复执行治理
- **THEN** 注册项内容不再变化，不产生重复写

### Requirement: 启动恢复的时序与可见性

启动恢复（读取配置、校验 `last_vault` 路径、全量枚举与链接索引建立）SHALL 在 Tauri setup 的主线程之外执行；setup MUST NOT 同步等待其完成。`VaultStatus` SHALL 以 `restore_pending` 字段承载恢复进行态（`true` = 仍在进行；`false` = 终态：已打开 vault，或未打开且 `notice` 为可选人话提示）。前端在 `restore_pending` 为 `true` 时 SHALL 以未打开空态的布局呈现恢复中提示（文案见 `文案-Copy.md`），MUST NOT 将其呈现为「尚无 vault」的终态；恢复完成后 SHALL 无需用户操作自动进入该 vault。恢复流程的每一条结束路径（成功 / 无 `last_vault` / `last_vault` 失效 / 配置加载失败 / 打开 vault 失败）SHALL 使 `restore_pending` 转 `false`，并发出 `vault:restore_finished` 事件（无载荷，仅作唤醒信号）。前端 SHALL 以 `vault_current` 的返回值为权威状态、以该事件为唤醒信号：启动时 SHALL 先订阅该事件、再拉取一次状态，MUST NOT 依赖事件必然送达（webview 挂载晚于恢复完成时事件会丢失）。恢复进行期间文件树 pane 的「打开 vault」入口 SHALL 保持可用，用户此间的成功打开 SHALL 优先于本次恢复。`LUMIR_READY` 的发射位置与语义 SHALL 保持不变（事件循环可接管的标记）；恢复耗时 MUST NOT 计入该端点，也 MUST NOT 以「把该标记移到恢复之后」的方式让门禁覆盖恢复耗时。

#### Scenario: 大 vault 恢复不推迟首帧

- **WHEN** `last_vault` 指向一个全量枚举与索引建立需要数百毫秒的 vault
- **THEN** 窗口在恢复完成前即可绘制并可交互，界面先呈恢复中提示，恢复完成后无需用户操作自动进入该 vault

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

### Requirement: vault 列表与可见性

系统 SHALL 提供 `vault_list` command，返回注册表中全部 vault 的摘要（稳定 id、绝对路径、显示名、路径可用性、上次打开时间、可恢复的标签数），供前端在打开切换器时读取。前端 MUST NOT 维护常驻镜像——注册表是唯一真源，每次打开列表 SHALL 重新读取。显示名 SHALL 为路径的目录名（basename），MUST NOT 引入独立显示名或命名步骤；「space」一词 MUST NOT 出现在界面文案与契约里（决策 4）。路径不可用的注册项（含已归档项）SHALL 保留在列表中并标注不可用，MUST NOT 被静默移除；已归档标记只抑制自动出现的 remap 候选浮条，MUST NOT 抑制用户在列表中的可见性（那是用户主动打开的面）。列表排序 SHALL 按最近打开倒序，路径不可用项 SHALL 排在可用项之后。vault 打开成功（新增、切换、重新定位、启动恢复）时系统 SHALL 在该注册项上记 `last_opened_at`，写入与 `last_vault` 同一次成功路径。列表命令 MUST NOT 在 Tauri 主线程上对 vault 路径做阻塞探测（慢挂载卷上可能长时间不返回）；该探测如需要，SHALL 在主线程之外完成。

#### Scenario: 列表含全部 vault 与当前项

- **WHEN** 注册表中有三个 vault，当前打开的是其中一个，用户打开切换器
- **THEN** 三行都在，当前项有明确标记（唯一），每行给出显示名、可恢复的标签数与上次打开时间、路径

#### Scenario: 显示名为目录名

- **WHEN** 某 vault 的路径是 `~/Documents/notes-2026`
- **THEN** 该行显示名为 `notes-2026`；两个同名目录的 vault 靠路径行区分，不引入命名步骤

#### Scenario: 失效项保留并标注

- **WHEN** 某注册项的路径已不可用（目录被移动 / 所在卷未挂载）
- **THEN** 该行仍在列表中并标注路径不可用，不被移除、不被静默隐藏

#### Scenario: 排序按最近打开倒序

- **WHEN** 用户先后打开过 A、B、C 三个 vault
- **THEN** 列表按最近打开倒序排列，当前项在首位；路径不可用的项排在可用项之后

#### Scenario: 慢卷上的探测不阻塞主线程

- **WHEN** 注册项中包含一个路径位于未挂载卷的 vault，用户打开切换器
- **THEN** 列表仍然返回并标注其不可用，界面在等待期间保持可交互（探测不在主线程上）

### Requirement: vault 切换器入口与列表浮层

已装载 vault 时，左栏文件树头部 SHALL 提供常驻的 vault 切换器入口；只有一个 vault 时入口 SHALL 同样出现（隐藏它会让「再加一个 vault」在界面上无处可去）。入口形态 SHALL 为方案 A——vault 名称本身即入口、带 caret 提示，现状的「切换」文字按钮退场（备选 B 的形态与翻转落点见 design §7）。未装载 vault 时（含启动恢复进行中）MUST NOT 出现列表入口——空态沿用既有 D5 / D6 文案与入口，恢复中态的「打开 vault」入口保持可用（口径见 `startup-restore-off-main-thread` 的「启动恢复的时序与可见性」）。浮层 SHALL 与大纲浮层同一手法：绝对定位、不占任何常驻行高、切换完成即消失；SHALL 以列表语义暴露当前项；宽度允许溢出左栏（与大纲浮层同口径）。系统 SHALL 提供「打开 vault 切换器」命令，其默认键位 SHALL 为 `Cmd-o`；浮层内 ↑↓ 选择、Enter 切换、Esc 关闭（与大纲浮层 D86 同口径）。

#### Scenario: 单 vault 时入口仍在

- **WHEN** 注册表中只有一个 vault 且它是当前 vault
- **THEN** 切换器入口仍出现，列表里有一项 + 一条「新增 vault…」

#### Scenario: 未装载时无列表入口

- **WHEN** 尚未装载任何 vault（首次启动 / 启动恢复进行中）
- **THEN** 文件树区呈空态：说明文案 + 「打开 vault」入口，MUST NOT 出现 vault 列表入口

#### Scenario: 浮层不占常驻空间

- **WHEN** 用户打开切换器浮层，随后切换或按 Esc 关闭
- **THEN** 关闭后左栏布局与浮层打开前逐像素一致（浮层不改变任何常驻元素的位置）

#### Scenario: 键位打开并键盘操作

- **WHEN** 焦点在编辑器或文件树里，按 `Cmd-o`
- **THEN** 切换器浮层打开；↑↓ 移动选中项、Enter 切换、Esc 关闭，不产生其它副作用

### Requirement: 新增 vault

列表入口里 SHALL 提供「新增 vault…」（形态随裁决点 1：A 在列表底部、B 在左栏头部），点击 SHALL 走既有系统目录选择器链路（`vault_open`）：用户取消 MUST NOT 产生错误状态，MUST NOT 改变当前 vault 与上下文。选中未注册目录时系统 SHALL 将其登记为新的 vault 并**自动切换过去**（新 vault 无标签历史，切换只写当前 vault 的标签列表，不丢内容）；选中已注册目录时 SHALL 等价于切到该 vault。该次打开命中 remap 候选门时 SHALL 沿用既有的两个出口浮条（作为新 vault 打开 / 确认映射到候选），MUST NOT 因列表而绕过该门。登记新 vault MUST NOT 要求用户命名——显示名取目录名。

#### Scenario: 新增后自动切过去

- **WHEN** 当前 vault 是 A，用户经列表底部「新增 vault…」选中一个未注册目录 B
- **THEN** B 被登记进列表并成为当前 vault，整窗上下文切到 B；B 没有标签历史，呈空 vault 首入态

#### Scenario: 新增时取消

- **WHEN** 用户在系统目录选择器里取消
- **THEN** 当前 vault 与窗口上下文完全不变，无错误提示

#### Scenario: 新增路径命中 remap 门

- **WHEN** 选中的未注册目录在注册表里存在失效项（疑似移动）
- **THEN** 沿用既有的两个出口浮条（作为新 vault 打开 / 确认映射到候选），不因列表入口而绕过

### Requirement: vault 切换与整窗上下文替换

任何时刻 SHALL 只有一个激活的 vault（单激活，决策 2），列表里当前项唯一，切换成功才换位。切换 SHALL 复用既有 vault 打开链路（`vault_open_path` / `vault_open`），MUST NOT 新增第二条装载通道。切换成功后 SHALL 一次性更换整窗上下文（masthead 的 vault 名与文件、标签栏、文件树、正文），MUST NOT 残留旧 vault 的任何上下文（沿用既有的一次复位口径）。切换前 SHALL 按 `multi-tabs` 既有判据（任一有路径的标签有未保存修改）拦下，MUST NOT 在未给出口的情况下静默丢弃修改；拦下时 SHALL 在拦下处给出三条出口——保存并切换 / 放弃修改并切换 / 取消（与关标签确认 D93 同形），提示 SHALL 点名**当前** vault（未保存修改属于它，不属于目标 vault）；「保存并切换」在保存未闭环（冲突 / 写失败 / 无落盘基准）时 MUST NOT 继续切换，沿用既有保存失败提示与出口。切换进行中 SHALL 忽略新的切换请求（一次只处理一个）。目标 vault 打开失败时 SHALL 保留当前 vault 与上下文（沿用既有「已有 vault 时打开失败只给浮条、不抹树」口径）。切换 SHALL 以「完成即一次性换上下文」呈现；本版 MUST NOT 引入进度条 / 遮罩 / 行内进度等过渡元素（同步打开路径下界面在此期间不重绘，这类元素不可见；把用户主动打开与切换移出主线程是本 change 的非目标）。

#### Scenario: 切换成功整窗换上下文

- **WHEN** 当前 vault 是 A 且打开了文件，用户点列表里的 B
- **THEN** masthead 的 vault 名与文件、标签栏、文件树、正文一次性全部换成 B 的上下文，列表里的当前项移到 B

#### Scenario: dirty 拦下并给出三条出口

- **WHEN** 当前 vault 里任一标签有未保存修改，用户点列表里的 B
- **THEN** 不切换：给出点名**当前** vault（A）与脏标签数量的提示，带三个动作（保存并切换 / 放弃修改并切换 / 取消）；再次点击 B 仍被拦下，MUST NOT 绕过守卫

#### Scenario: 放弃修改并切换

- **WHEN** 守卫提示里选「放弃修改并切换」
- **THEN** 切换照常完成，B 成为当前 vault

#### Scenario: 保存未闭环则不切换

- **WHEN** 守卫提示里选「保存并切换」，而某脏标签保存失败（冲突 / 写失败 / 无落盘基准）
- **THEN** MUST NOT 切换，给出既有的保存失败提示与出口

#### Scenario: 目标打开失败保留当前 vault

- **WHEN** 切换目标打开失败（目录不可读等）
- **THEN** 当前 vault 与整窗上下文不变，只给一条失败提示，MUST NOT 把文件树抹成空态

#### Scenario: 切换进行中忽略新请求

- **WHEN** 一次切换尚未完成时用户又点了另一个 vault
- **THEN** 第二次请求被忽略，不会出现两个 in-flight 切换互相覆盖

### Requirement: 失效 vault 的处置

列表中路径不可用的注册项 SHALL 不可切换（MUST NOT 发起打开），并 SHALL 给出「重新定位…」出口；重新定位 SHALL 复用既有 `vault_remap` 链路（把该稳定 id 绑到用户选定的新路径），成功 SHALL 打开该 vault（等价于一次切换）。用户选定的新路径若已被另一个注册项占用，系统 SHALL 拒绝并给出人话提示（MUST NOT 静默合并两个身份——稳定 id 是重映射的锚点）。系统 MUST NOT 提供「从列表移除」或硬删除注册项（既有治理口径是只归档不删除）。

#### Scenario: 失效行不可切换

- **WHEN** 列表里某行标注路径不可用，用户点击该行
- **THEN** 不发起打开、不给错误弹窗；该行只提供「重新定位…」

#### Scenario: 重新定位成功后打开

- **WHEN** 用户对失效项选「重新定位…」并在目录选择器里选定该 vault 的新位置
- **THEN** 该稳定 id 绑到新路径、失效标记复位、列表顺序按最近打开更新，并切换到该 vault

#### Scenario: 重定位到已被占用的路径被拒绝

- **WHEN** 用户选定的新路径已是列表中另一个 vault 的路径
- **THEN** 拒绝该次重定位并给出人话提示，两个注册项的身份都不变

#### Scenario: 没有从列表移除

- **WHEN** 用户希望某个 vault 不再出现在列表里
- **THEN** 界面 MUST NOT 提供「从列表移除 / 删除 vault」入口（注册项只归档不删除；本 change 不引入删除语义）

### Requirement: 按 vault 持久化标签列表

系统 SHALL 为每个 vault 持久化「上次打开的标签列表」：有序的 vault 相对路径 + 激活项，按注册项稳定 id 键控，MUST NOT 存绝对路径（vault 重定位后相对路径仍然有效；相对路径是既有标签模型的口径）。持久化内容 MUST NOT 包含未保存内容、撤销史、光标位置与滚动位置（决策 3「只恢复标签列表」）。**预览（临时）标签 SHALL NOT 被持久化**（它是随时会被顶掉的槽位，恢复它等于在恢复结果里埋一个会消失的项）；列表行摘要里的标签数 SHALL 等于将被恢复的固定标签数。系统 SHALL 在标签集合 / 顺序 / 激活项变化后落盘（可防抖），并在切换 vault 前与退出前 flush 待写内容（MUST NOT 只依赖防抖定时器）。落盘 SHALL 用临时文件 + rename 原子替换。写失败 SHALL 降级为 warning（与 `last_vault` 写失败同口径），MUST NOT 拦停用户动作，也 MUST NOT 影响 vault 打开的成功语义。会话数据 MUST NOT 与注册项存在同一个文件里（注册项解析失败会被既有读取路径当作无效项跳过，把易变的界面状态混进身份文件会扩大身份丢失面，见 design §2）。会话文件缺失或损坏 SHALL 等价于「没有标签历史」，MUST NOT 影响 vault 在列表中的存在、打开与治理。

#### Scenario: 只存路径与激活项

- **WHEN** 用户在某个 vault 里打开若干文件、滚动、编辑后未保存即切走
- **THEN** 落盘的只有有序的相对路径与激活项；未保存内容、撤销史、光标与滚动位置都不在盘上

#### Scenario: 预览标签不入盘

- **WHEN** 某 vault 里有一个预览（临时）标签与两个固定标签
- **THEN** 该 vault 的落盘列表只有两个固定标签，列表行摘要也显示 2

#### Scenario: 切换前 flush

- **WHEN** 标签刚发生变化（防抖窗口未到）时用户就切换 vault
- **THEN** 当前 vault 的标签列表在切换前落盘，切回来时恢复的是变化后的列表

#### Scenario: 写失败只降级

- **WHEN** 会话落盘失败（磁盘只读 / 空间不足等）
- **THEN** 记一条 warning，切换与打开照常完成，用户不被拦下

#### Scenario: 会话损坏等价于无历史

- **WHEN** 某 vault 的会话文件损坏或不存在
- **THEN** 该 vault 在列表里照常显示（标签数按 0 / 无历史呈现），打开它时不恢复任何标签，其余功能不受影响

### Requirement: 装载后恢复标签列表

每一次 vault 装载成功后（切换、新增后、启动恢复完成）系统 SHALL 按该 vault 的标签列表恢复标签：按存储顺序、以**固定标签**语义逐个打开（MUST NOT 用点击文件树的预览语义——预览语义会就地顶掉前一个标签，结果只剩最后一个），随后激活存储的激活项；激活项不可用（不在列表里 / 文件缺失）时 SHALL 退化为第一个可打开的标签。恢复 SHALL 走既有打开链路（`openFile`），MUST NOT 新增装载通道。会话里的条目若不是一个合法的 vault 相对路径（绝对路径 / 含 `..` / 越出 vault），SHALL 被丢弃且 MUST NOT 被打开——会话文件落在配置目录、是可被手工修改的面，ADR 0003 的边界不因它放宽。某个文件已不在 vault 内或打不开时 SHALL 跳过它并给**一次**计数提示（MUST NOT 逐个报错）；全部标签都打不开时 SHALL 呈空 vault 首入态（标签栏隐藏 + 一句引导）。MUST NOT 恢复光标位置、滚动位置与撤销史。恢复 SHALL NOT 阻塞首帧与界面可交互性（逐标签装载，树与窗口先可用）。启动恢复路径上的标签恢复 SHALL 应用在启动恢复完成、vault 装载之后，MUST NOT 挂在恢复线程或 `open_vault` 内；用户已在恢复期间成功装载了别的 vault 时（`startup-restore-off-main-thread` 的让位规则），本次恢复的标签列表 SHALL 一并被丢弃。恢复进行中（`restore_pending` 为 `true`）MUST NOT 恢复任何标签。

#### Scenario: 切回恢复标签列表与激活项

- **WHEN** 用户在 A 里开着三个文件（激活项是第二个）后切到 B，随后切回 A
- **THEN** A 的三个标签按原顺序重建，激活项是第二个；滚动位置不恢复（回到篇首）

#### Scenario: 固定标签语义

- **WHEN** 某 vault 的上次列表有三个标签，装载后用户单击文件树里的另一个文件
- **THEN** 三个恢复出来的标签都保留（它们不是预览标签），新文件另开一个预览标签

#### Scenario: 跳过缺失文件并提示一次

- **WHEN** 上次列表里的某个文件已被删除或移出 vault
- **THEN** 该文件被跳过，其余标签照常恢复，并给出一条计数提示（不逐个报错）

#### Scenario: 全部标签都不可用

- **WHEN** 上次列表里的文件全部不在 vault 内
- **THEN** 标签栏隐藏，正文给出空 vault 的引导（不伪造内容）

#### Scenario: 会话里的越界条目不被打开

- **WHEN** 某 vault 的会话文件里含一个绝对路径或带 `..` 的条目（例如被手工改过）
- **THEN** 该条目被丢弃并按不可用跳过，其余标签照常恢复，MUST NOT 打开 vault 之外的文件

#### Scenario: 启动恢复完成后才恢复标签

- **WHEN** 启动时 `last_vault` 指向的 vault 的恢复仍在进行
- **THEN** 界面呈恢复中态、没有任何标签被恢复；恢复完成并装载 vault 之后，该 vault 的标签列表才被恢复

#### Scenario: 用户抢先切换则丢弃本次恢复的标签

- **WHEN** 启动恢复进行中用户已成功装载了另一个 vault
- **THEN** 本次启动恢复的结果（含它的标签列表）整体被丢弃，界面保持用户在用的那个 vault
