# harness 增量规格

> 起草注记（非规格正文）：本 change 给批准卡加一行「判定依据」（这次为什么问我）、给权限 chip 的悬停提示
> 补上当前档释义，并让 deny 规则命中时把规则原文带进回送模型的错误。判定结论与闸门行为一行不改
> （Alex 2026-10-12：「这个逻辑不用改」）。层与文案的映射、deny 层落点的事实依据见
> [design.md](../../design.md)。

## MODIFIED Requirements

### Requirement: 权限机制

系统 SHALL 实现三层权限规则：allow / ask / deny，判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `skill_load`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT 直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」——拒绝只来自用户 deny 规则。

判定总序 SHALL 为：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层——前四层模式无关，allow 规则 SHALL 在任何档生效（含 `read_only` 档），模式只替换最底层默认分层。deny 命中 SHALL 直接拒绝并回送模型：拒绝对话 MUST NOT 进入批准闸（不产批准卡、不等待用户决定），且回送的错误 SHALL 带上**命中的规则原文**（如「命中 deny 规则 cli(npm run deploy*)」），使「是哪条规则拦的」不必回配置文件核对；规则原文拼入后若超出工具行摘要的展示长度上限，SHALL 退回不带规则原文的既有文案，MUST NOT 呈现被截断的规则名。ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送模型；未决批准项 MUST NOT 自动超时通过。

#### Scenario: 默认档放行矩阵

- **WHEN** 模式为默认 `vault_write`，模型先后调用 `vault_read`、`vault_patch`、`cli_run("ls", ["-la"])`、`cli_run("npm", ["install"])`
- **THEN** `vault_read` / `vault_patch` / 白名单 `ls` 直接执行；`npm install` 挂起等待面板批准

#### Scenario: 只读档逐个问 vault 写（Always Ask）

- **WHEN** 模式为 `read_only`，模型调用 `vault_patch`
- **THEN** 调用进入批准闸等待用户决定（MUST NOT 直接拒绝、MUST NOT 自动执行）；用户拒绝后调用不执行、磁盘不变
- **AND** 同模式下模型调用 `vault_read` 则直接执行（读类自动放行）

#### Scenario: 危险黑名单任何档都问

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("rm", ["-rf", "/tmp/x"])`
- **THEN** 调用进入批准闸等待用户决定，MUST NOT 自动放行

#### Scenario: deny 与 allow 规则跨模式优先序

- **WHEN** 模式为 `read_only`，配置 allow 规则含 `cli(npm run *)`，deny 规则含 `cli(npm run deploy*)`；模型调用 `cli_run("npm", ["run", "test"])`
- **THEN** `npm run test` 直接执行（allow 规则在只读档生效）；同模式下调 `npm run deploy` 则被 deny 规则拒绝

#### Scenario: deny 规则原文随拒绝回送

- **WHEN** 配置 deny 规则含 `cli(npm run deploy*)`，模型在任意档调用 `cli_run("npm", ["run", "deploy"])`
- **THEN** 调用被拒（不进批准闸、面板不出现批准卡），回送模型的错误里出现命中的规则原文 `cli(npm run deploy*)`，工具行显示该错误摘要

#### Scenario: 会话内同类不再问

- **WHEN** `vault_write` 档下 Alex 对某 `cli_run` 写命令点「采纳且本会话不再问」，同一会话内模型再次以相同规范化主体串调用同一命令
- **THEN** 第二次调用直接执行不进批准闸；「新会话」后同主体串调用恢复逐个问

#### Scenario: 默认分层生效

- **WHEN** 模型先调用 `vault_read` 再调用 `vault_patch`（默认 `vault_write` 档，均无规则命中）
- **THEN** `vault_read` 直接执行；`vault_patch` 直接执行（默认档写工具自动放行）

#### Scenario: deny 优先

- **WHEN** 一条 `cli_run` 同时匹配 allow 与 deny 规则
- **THEN** 该调用被拒绝并把原因回送模型，不进入批准闸

#### Scenario: 采纳与拒绝

- **WHEN** 面板收到 ask 档批准项的预览（写文档显示 diff、CLI 显示完整命令），Alex 点击采纳（或拒绝）
- **THEN** 采纳则执行（写工具落盘口径不变）；拒绝则副作用不发生，模型收到对应结果

### Requirement: 批准闸呈现与决策后收敛

批准闸的 diff 预览中，以 `+` / `-` 起首的增删行底色 MUST 覆盖该行文本的完整宽度，与卡片可视宽度无关：行文本超出可视宽度（容器出现横向滚动）时，底色 MUST 随文本延伸至整行末尾，MUST NOT 在可视宽度处截断。该不变量对任意行内容长度与任意面板宽度恒成立（渲染缺陷合同先行，条款引用输入分布而非具体案例）。

批准项被采纳或拒绝后，卡片 MUST 收敛为一行终态记录：工具名 + 决策结果（已采纳 / 已拒绝）+ 决策的相对时间戳。diff / argv 预览 MUST 默认折叠，可经单一入口展开回看；待决语义副句（写类「批准后才会落盘」/ 命令类「批准后才会在终端运行，输出回到对话里」）、判定依据行与决策按钮 MUST 随决策退场，MUST NOT 以置灰形态残留在终态记录里（置灰按钮会被误读为「待处理 / 等待中」）。拒绝时若附了原因，原因文本 MUST 在终态记录中直接可见（无需展开详情）。`cli_run` 批准卡 SHALL 在命令上方显眼位置展示模型自述的 `purpose` 用途句，命令原文完整可见、MUST NOT 被用途句替代或截断；purpose 是阅读辅助而非安全判据，权限判定 MUST NOT 参考 purpose。

批准卡 SHALL 在待决问句下方展示一行**判定依据**，说明这次调用**为什么进闸**（人话一行，随卡片出现）。判定依据 SHALL 由后端判定管线产出并随批准请求事件与 `harness_state` 快照两条通道同源到达前端，前端 MUST NOT 自行推导层级；依据 SHALL 覆盖产批准卡的两层，并如实区分：**危险黑名单**命中（shell 包装器类点名包装器命令名并说明其内容不可知；其余危险命令类说明命中安全黑名单）与**模式默认分层**（带当时判定的档位名与该档释义）。判定依据 MISSING（旧后端 / 旧快照载荷）时该行 SHALL NOT 渲染，MUST NOT 以猜测或默认文案填充。该行 SHALL 随界面语言重取文案，MUST NOT 残留旧语言串。

#### Scenario: diff 行高亮覆盖整行文本

- **WHEN** 面板呈现含超出可视宽度的增删行的 diff 预览（任意行长度 × 任意面板宽度）
- **THEN** 每个增删行元素的宽度 ≥ 该行文本的完整宽度，底色铺满整行、横向滚动区外无未高亮文本

#### Scenario: 采纳后收敛为终态记录

- **WHEN** Alex 对带 diff 预览的批准项点击采纳
- **THEN** 卡片收敛为一行记录（工具名 + 已采纳 + 相对时间戳）；diff 默认折叠、展开后可回看；待决标题、判定依据行与决策按钮退场，界面不再出现置灰的采纳 / 拒绝钮

#### Scenario: 拒绝附原因可见

- **WHEN** Alex 填写拒绝原因并点击拒绝
- **THEN** 终态记录直接显示原因文本（不依赖展开详情）；diff 默认折叠、可展开回看

#### Scenario: 用途句在命令上方呈现

- **WHEN** 一个带 `purpose` 的 `cli_run` 写命令进入批准闸
- **THEN** 批准卡命令上方显眼位置显示 purpose 用途句，命令原文完整可见；purpose 不参与判定（判定结果与同命令不带 purpose 时一致）

#### Scenario: 危险黑名单进闸时的判定依据

- **WHEN** 模型在任意档（含 `full_access`）调用 shell 包装器命令（如 `cli_run("zsh", ["-lc", "…"])`）
- **THEN** 批准卡的判定依据行说明这是 shell 包装器命令、点出包装器命令名、并说明内容不可知因而任何权限档都需逐个确认

#### Scenario: 模式默认分层进闸时的判定依据

- **WHEN** 默认 `vault_write` 档下模型调用库外写命令（如 `cli_run("npm", ["install"])`）进入批准闸
- **THEN** 批准卡的判定依据行带出当时档位（`保险库写入` / `Vault Write`）与该档释义（库内写自动放行、库外命令先问），使「已是 Write 档为何还问」在卡上自洽可读

#### Scenario: 判定依据随决策退场

- **WHEN** Alex 对带判定依据行的批准项点击采纳或拒绝
- **THEN** 终态记录里不出现判定依据行（与待决副句、决策按钮一同退场），界面零残留

### Requirement: 权限模式切换

composer 控制行 SHALL 提供权限 chip（位于模型 / 思考合并选择器 chip 之后、ctx 读数之前），**显示当前模式档的短名**（文案表 zh：只读 / 可写 / 完全；en：Read / Write / Full）——控制行被合并选择器 chip 与权限 chip 共同挤占，短名是「三档都能完整显示」的口径（Alex 2026-10-09 裁决；zh 短名「写入」于 2026-10-10 批复改为「可写」）。点击 SHALL 弹出浮层：三档单选、当前档勾选、列表项显示**全名**（zh：只读 / 保险库写入 / 完全访问；en：Read Only / Vault Write / Full Access）、且**每档附一行释义**消歧档名与语义（`read_only` = 读自动放行、写操作都先问；`vault_write` = 库内写自动放行、库外命令先问；`full_access` = 全自动、仅危险命令仍问；措辞可在实现批次微调，语义方向以此为准）。chip 的悬停提示与可访问名 SHALL 说明当前档并附上**该档的同一行释义**（与浮层释义同源，不新增信息）。浮层 SHALL 复用既有浮层可访问性口径（`role="menu"` / `menuitemradio` / `aria-checked`）。选择一档 SHALL 立即生效并经 `config_set_value` 写回 `[harness].permission_mode`；切换 MUST NOT 打断进行中的轮次（对下一个判定生效，与模型 chip 同口径）。

#### Scenario: 三档浮层

- **WHEN** 点击权限 chip
- **THEN** 浮层列出三档（各显示全名 + 一行释义）、当前档勾选；选择另一档后 chip 文案（短名）更新、浮层关闭

#### Scenario: 切换不打断进行中轮次

- **WHEN** 一轮对话正在工具循环中，把模式从 `vault_write` 切到 `read_only`
- **THEN** 当前轮次按开轮时的模式判完；从下一个判定起按 `read_only` 执行

#### Scenario: chip 悬停提示带当前档释义

- **WHEN** 指针悬停在权限 chip 上（或读屏取该 chip 的可访问名）
- **THEN** 提示文本包含当前档全名与浮层里的那行释义（如「权限模式：保险库写入（点击切换）· 库内写自动放行；库外命令先问你」），且与浮层同一档的释义逐字相同
