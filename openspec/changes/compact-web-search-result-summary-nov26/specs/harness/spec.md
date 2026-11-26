# harness 增量规格

> 起草注记（非规格正文）：本 change 只改 Web 工具行的默认呈现与结果读数、以及组摘要的计数口径。
> 五条 requirement 均基于当前 living spec（`openspec/specs/harness/spec.md`，master `a9152dec`）
> 的原文**整块复制**后改，未改动的段落逐字保留；呈现机制、数据合同与被否方案见
> [design.md](../../design.md)。活跃期不改 living spec。

## MODIFIED Requirements

### Requirement: 权限机制

系统 SHALL 实现两层权限规则：allow / deny（不存在 `ask` 规则表——需要「必须问」的语义由危险黑名单与模式默认分层承担），判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）；匹配语义 SHALL 为：模式以 `*` 结尾时按**主体串前缀**匹配，星号前是空格时（生成规则的标准形态，如 `cli(git push *)`）另 SHALL 命中「去掉该尾随空格后逐字相等」的主体串——无参数的 `git push` 与带参数的 `git push origin main` 同样命中，词边界 MUST NOT 因此放宽（`git pushx` 不命中）。allow 规则 SHALL 既可手写于配置，也可由批准卡沉淀（生成、去重与作用域口径见「权限规则的持久化与治理」），并 SHALL 在权限浮层中逐条可见、可删。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `vault_list` / `skill_load` / `cron_task_list`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT 直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；`cron_task_create` / `cron_task_remove` 在 `read_only` 与 `vault_write` 档 SHALL 逐个问、在 `full_access` 档 SHALL 自动放行（定时任务是持续性开销，批准的一刻是用户唯一能看见「它以后会自己跑」的时机）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单；shell 包装器中「受限解包」成立的只读形态除外，口径见「cli_run 命令分类与 vault 写重定向」）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」——拒绝只来自用户 deny 规则。

`web_search` / `web_fetch` SHALL 属于独立的 `web_read` 权限类，MUST NOT 加入上述读类工具白名单。
`harness.web_access.approval` 缺省为 `allow_all`，两件工具在 `read_only` / `vault_write` /
`full_access` 三档均 SHALL 默认直接执行；只有用户显式改为 `ask` 才进入批准闸。Web 判定顺序为
deny > 既有硬层 > `web_access.approval`，deny 永远优先；Web 不使用 allow 规则或会话缓存派生授权。
任何 approval 值都 MUST NOT 跳过执行期的 URL、DNS、重定向、内容类型、预算或密钥检查。
`web_read` 是权限分类，MUST NOT 被实现成第三件工具或第四档权限模式。

判定总序 SHALL 为：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层——前四层模式无关，allow 规则 SHALL 在任何档生效（含 `read_only` 档），模式只替换最底层默认分层。deny 命中 SHALL 直接拒绝并回送模型：拒绝对话 MUST NOT 进入批准闸（不产批准卡、不等待用户决定），且回送的错误 SHALL 带上**命中的规则原文**（如「命中 deny 规则 cli(npm run deploy*)」），使「是哪条规则拦的」不必回配置文件核对；规则原文拼入后若超出工具行摘要的展示长度上限，SHALL 退回不带规则原文的既有文案，MUST NOT 呈现被截断的规则名。ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送模型；未决批准项 MUST NOT 自动超时通过。`cron_task_create` / `cron_task_remove` 的批准卡 SHALL 呈现该次动作的任务要素——`create`：`at`、`days`、`delivery`、`session`、目标 vault、`prompt` 全文，以及「注册当日是否补触发」；`remove`：任务 `id` 与 `at`。会话内批准缓存（「采纳且本会话不再问」）对这两件工具的主体串 SHALL 由 `id` / `at` / `days` 组成，MUST NOT 包含 `prompt`（主体串会进缓存键与诊断，`prompt` 的私密内容只出现在批准卡与会话留存里）。

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

- **WHEN** `vault_write` 档下 Alex 对某 `cli_run` 写命令点「采纳且本会话不再问」，同一会话内模型再次以相同规范化主体串（或同一命令前缀）调用同一命令
- **THEN** 第二次调用直接执行不进批准闸；「新会话」后同命令恢复逐个问

#### Scenario: 默认分层生效

- **WHEN** 模型先调用 `vault_read` 再调用 `vault_patch`（默认 `vault_write` 档，均无规则命中）
- **THEN** `vault_read` 直接执行；`vault_patch` 直接执行（默认档写工具自动放行）

#### Scenario: deny 优先

- **WHEN** 一条 `cli_run` 同时匹配 allow 与 deny 规则
- **THEN** 该调用被拒绝并把原因回送模型，不进入批准闸

#### Scenario: 采纳与拒绝

- **WHEN** 面板收到 ask 档批准项的预览（写文档显示 diff、CLI 显示完整命令），Alex 点击采纳（或拒绝）
- **THEN** 采纳则执行（写工具落盘口径不变）；拒绝则副作用不发生，模型收到对应结果

#### Scenario: 持久 allow 规则在任意档生效

- **WHEN** Alex 经批准卡持久化 `cli(tvly search *)`（或手写于配置），随后在 `read_only` 档模型调用 `cli_run("tvly", ["search", "x"])`
- **THEN** 调用直接执行、不进批准闸——allow 规则在任何档生效；规则原文在同一浮层的「已记住的规则」段可见

#### Scenario: 前缀规则的词边界与等值匹配

- **WHEN** 配置 allow 规则含 `cli(git push *)`，模型分别调用 `cli_run("git", ["push"])`、`cli_run("git", ["push", "origin", "main"])` 与 `cli_run("git", ["pushx"])`
- **THEN** 无参数的 `git push` 与带参数的 `git push origin main` 都直接执行、不进批准闸（星号前的空格是词边界，等值形态一并命中）；`git pushx` 不命中该规则——词边界 MUST NOT 因等值容差而放宽

#### Scenario: 定时任务工具的档位

- **WHEN** 模式为默认 `vault_write`，模型调用 `cron_task_list` 与 `cron_task_create`
- **THEN** `cron_task_list` 直接执行（读类，无副作用）；`cron_task_create` 进入批准闸
- **AND** 模式为 `read_only` 时两者行为不变（`list` 直接执行、`create` 仍进闸）；模式为
  `full_access` 时 `create` 直接执行

#### Scenario: 任务批准卡呈现要素

- **WHEN** `cron_task_create` 进入批准闸
- **THEN** 卡片呈现 `at` / `days` / `delivery` / `session` / 目标 vault / `prompt` 全文与「注册当日
  是否补触发」；`prompt` 的全文不出现在诊断日志里
- **AND** 用户对本条点「采纳且本会话不再问」后，同一 `id` + `at` + `days` 的再次创建不再进闸，
  改 `prompt` 但时间不变的创建同样不再进闸（主体串不含 `prompt`）

#### Scenario: Web 默认 Allow 与 deny 硬边界

- **WHEN** `harness.web_access.approval` 缺省为 `allow_all`，模型在三种权限模式中的任一种调用
  `web_search` 或 `web_fetch`
- **THEN** 调用不进入批准闸而直接执行，工具行保留 query / URL；provider、费用与 untrusted 审计
  保留在默认关闭的「查看详情」中（呈现口径见「Web 访问策略与 origin 例外」条）；若目标命中
  `web_fetch(origin)` deny 或其它硬边界，仍按对应错误拒绝且不产生请求

### Requirement: 批准闸呈现与决策后收敛

批准闸的 diff 预览中，以 `+` / `-` 起首的增删行底色 MUST 覆盖该行文本的完整宽度，与卡片可视宽度
无关：行文本超出可视宽度（容器出现横向滚动）时，底色 MUST 随文本延伸至整行末尾，MUST NOT 在可视
宽度处截断。该不变量对任意行内容长度与任意面板宽度恒成立（渲染缺陷合同先行，条款引用输入分布而非
具体案例）。

批准项被采纳或拒绝后，卡片 MUST 收敛为一行终态记录：工具名 + 决策结果（已采纳 / 已拒绝）+ 决策的
相对时间戳。diff / argv 预览 MUST 默认折叠，可经单一入口展开回看；待决语义副句（写类「批准后才会
落盘」）、判定依据行、决策按钮与次级动作按钮 MUST 随决策退场，MUST NOT 以置灰形态残留在终态记录里
（置灰按钮会被误读为「待处理 / 等待中」）。拒绝时若附了原因，原因文本 MUST 在终态记录中直接可见
（无需展开详情）。`cli_run` 批准卡 SHALL 在命令上方显眼位置展示模型自述的 `purpose` 用途句，命令
原文完整可见、MUST NOT 被用途句替代或截断；purpose 是阅读辅助而非安全判据，权限判定 MUST NOT
参考 purpose。

批准卡 SHALL 在待决问句下方展示一行**判定依据**，说明这次调用**为什么进闸**（人话一行，随卡片
出现）。判定依据 SHALL 由后端判定管线产出并随批准请求事件与 `harness_state` 快照两条通道同源到达
前端，前端 MUST NOT 自行推导层级；依据 SHALL 覆盖产批准卡的两层，并如实区分：**危险黑名单**命中
（shell 包装器类点名包装器命令名并说明其内容不可知；其余危险命令类说明命中安全黑名单）与**模式
默认分层**（带当时判定的档位名与该档释义），以及 **Web access 策略**（独立
`DecisionReason::WebAccessPolicy { approval: "ask" }`，明确实际 `harness.web_access.approval=ask`）。
Web access 依据 MUST NOT 使用 `ModeDefault`，也 MUST NOT 显示 `read_only` / `vault_write` /
`full_access` 的档释义作为进闸原因；`allow_all` 自动放行不产依据，origin deny 沿用 `DenyRule`
且不产批准卡。判定依据 MISSING（旧后端 / 旧快照载荷）时该行 SHALL NOT 渲染，MUST NOT 以猜测或
默认文案填充。该行 SHALL 随界面语言重取文案，MUST NOT 残留旧语言串。

批准卡的次级动作 SHALL 由后端随批准请求下发（事件与快照两条通道同源），前端 MUST NOT 按判定依据
或其它字段自行推断可见性。非 Web 工具因模式默认分层进闸的卡 SHALL 显示
「采纳且本会话不再问（记住 `<粒度>`）」；
可持久化规则的工具（非危险层进闸的 `cli_run`、`vault_patch` / `vault_create` / `vault_move`）另
SHALL 显示「以后都允许 `<规则原文>`」，规则原文由后端单一真源生成、按钮逐字显示。**危险黑名单
命中的卡 MUST NOT 显示这两枚次级动作**：该层先于 allow 规则与会话缓存判定，这两枚按钮在那类卡上
是死按钮（点了也不生效），显示即误导。次级动作字段缺省（旧后端 / 旧快照载荷）时两枚按钮 MUST NOT
渲染。

`harness.web_access.approval` 缺省为 `allow_all`，Web 工具 SHALL NOT 默认产生批准卡；只有显式
`approval=ask` 时，Web 批准卡的预览载荷才 SHALL 与批准请求事件 / `harness_state` 快照同源：
Search 显示完整 query、实际 provider id、query 发往 DeepSeek 的外发与计费说明；Fetch 显示完整 URL、
规范化 origin、实际 provider id，以及「Lumir 先做本地 HEAD / Range GET 预检、再把 URL 发给
DeepSeek 抓取」的双路外发与计费说明。provider 尚未解析成功时预览中的 provider / provider id 为 null，
不伪造 `"deepseek"` 为配置 id。Web 卡不生成专用持久 allow / 免问动作；origin deny 只在设置与
权限规则中管理。批准或拒绝后，待决字段、说明与动作 SHALL 按本条统一终态折叠，只保留工具名 +
决策结果 + 相对时间；完整 query / URL 与决策摘要 SHALL 可在展开详情中回看，不以待决按钮或置灰
动作残留。默认 Allow 的工具行 / 结果 SHALL 与决策后同形：紧凑行 + 默认关闭的「查看详情」；
输入、provider、费用与 untrusted 审计 SHALL 保留在该详情中，MUST NOT 以「常驻显示」为默认态。

#### Scenario: diff 行高亮覆盖整行文本

- **WHEN** 面板呈现含超出可视宽度的增删行的 diff 预览（任意行长度 × 任意面板宽度）
- **THEN** 每个增删行元素的宽度 ≥ 该行文本的完整宽度，底色铺满整行、横向滚动区外无未高亮文本

#### Scenario: 采纳后收敛为终态记录

- **WHEN** Alex 对带 diff 预览的批准项点击采纳
- **THEN** 卡片收敛为一行记录（工具名 + 已采纳 + 相对时间戳）；diff 默认折叠、展开后可回看；待决标题、判定依据行、决策按钮与次级动作按钮退场，界面不再出现置灰的采纳 / 拒绝钮

#### Scenario: 拒绝附原因可见

- **WHEN** Alex 填写拒绝原因并点击拒绝
- **THEN** 终态记录直接显示原因文本（不依赖展开详情）；diff 默认折叠、可展开回看

#### Scenario: 用途句在命令上方呈现

- **WHEN** 一个带 `purpose` 的 `cli_run` 写命令进入批准闸
- **THEN** 批准卡命令上方显眼位置显示 purpose 用途句，命令原文完整可见；purpose 不参与判定（判定结果与同命令不带 purpose 时一致）

#### Scenario: 危险黑名单进闸时的判定依据

- **WHEN** 模型在任意档（含 `full_access`）调用 shell 包装器命令（如 `cli_run("zsh", ["-lc", "rm -rf /tmp/x"])`，脚本不可解包）
- **THEN** 批准卡的判定依据行说明这是 shell 包装器命令、点出包装器命令名、并说明内容不可知因而任何权限档都需逐个确认

#### Scenario: 模式默认分层进闸时的判定依据

- **WHEN** 默认 `vault_write` 档下模型调用库外写命令（如 `cli_run("npm", ["install"])`）进入批准闸
- **THEN** 批准卡的判定依据行带出当时档位（`保险库写入` / `Vault Write`）与该档释义（库内写自动放行、库外命令先问），使「已是 Write 档为何还问」在卡上自洽可读

#### Scenario: full_access 下 Web Ask 依据独立于权限模式

- **WHEN** 权限模式为 `full_access` 且 `harness.web_access.approval=ask`，模型调用 Web 工具
- **THEN** 判定依据为 `WebAccessPolicy{approval:"ask"}`，明确网页访问策略是 Ask，不出现
  `ModeDefault` 或 full_access 档释义；approval=allow_all 时不产卡，origin deny 时不产卡

#### Scenario: 判定依据随决策退场

- **WHEN** Alex 对带判定依据行的批准项点击采纳或拒绝
- **THEN** 终态记录里不出现判定依据行（与待决副句、决策按钮、次级动作按钮一同退场），界面零残留

#### Scenario: 可持久化的卡显示两枚次级动作

- **WHEN** 默认 `vault_write` 档下 `cli_run("tvly", ["search", "x"])` 进入批准闸
- **THEN** 卡上同时显示「采纳且本会话不再问（记住 `tvly search`）」与「以后都允许 `cli(tvly search *)`」两枚次级动作；两枚文本与后端生成的粒度 / 规则逐字相同

#### Scenario: 危险卡不显示次级动作

- **WHEN** 任意档下 shell 包装器命令（脚本不可解包）或危险黑名单命令进入批准闸
- **THEN** 卡上 MUST NOT 出现「采纳且本会话不再问」与「以后都允许」两枚按钮（MUST NOT 以置灰形态出现）；只保留采纳 / 拒绝

#### Scenario: 可选 Ask 的 Fetch 预览与终态折叠

- **WHEN** `harness.web_access.approval=ask`，`web_fetch("https://example.com/a?q=1")` 进入批准闸且
  provider 已解析成功，随后用户采纳或拒绝
- **THEN** 卡片显示完整 URL、origin `https://example.com`、实际 provider id，以及 Lumir 预检 +
  DeepSeek 抓取的双路外发与计费说明；不出现 Web 专用持久 allow / 免问动作。决策后预览与按钮退场，
  卡片折叠为工具名 + 决策结果 + 相对时间，展开详情仍可回看完整 URL 与决策摘要

#### Scenario: 默认 Allow 不产生批准卡且审计仍在

- **WHEN** `harness.web_access.approval` 缺省为 `allow_all`，模型连续调用 Search / Fetch
- **THEN** 不产生逐次批准卡或 Web 专用持久 allow 动作，调用直接执行；工具行保留 query / URL，
  provider、费用与 `trust:"untrusted"` 保留在默认关闭的「查看详情」中

### Requirement: 工具调用呈现

工具调用 SHALL 以步骤清单形态呈现于当前 agent 消息内（hairline 夹区、独立于消息正文）：运行中的调用 SHALL 显示运行中行（脉冲指示 + 调用名），完成的调用 SHALL 翻为完成行（✓ 图标 + 结果摘要）；同一轮次的多次调用 SHALL 累积为有序多行清单。轮次结束后，含两行及以上的清单 SHALL 折叠为一行摘要（「N 个工具调用 · 全部完成」），摘要 SHALL 可点击展开回看全部步骤行；单行清单 SHALL 保持展开。快照恢复的历史轮次 SHALL 按同口径重建清单与折叠态。组摘要的计数 SHALL 只计真实工具调用行；
Web 调用的结果健康摘要与默认关闭的审计详情 SHALL 作为该调用的附属内容，MUST NOT 计为另一次
调用、MUST NOT 影响单行 / 多行判定。点击摘要展开回看时，各调用的审计详情 SHALL 保持默认关闭
（组开合 MUST NOT 改写各详情自身的展开态）。

#### Scenario: 进行中清单

- **WHEN** agent 轮次中发生工具调用（started → done）
- **THEN** 当前 agent 消息内出现步骤行：started 时为运行中行（脉冲指示），done 时该行翻为完成行（✓ + 结果摘要）；多次调用按到达次序逐行累积

#### Scenario: 完成后折叠与回看

- **WHEN** 一轮含两次及以上工具调用的轮次结束
- **THEN** 清单折叠为一行摘要（含调用数）；点击摘要展开回看全部步骤行，再点收回

#### Scenario: 单行不折叠

- **WHEN** 一轮只含一次工具调用的轮次结束
- **THEN** 该步骤行保持展开可见，不出现摘要行

#### Scenario: Web 审计不计入调用数

- **WHEN** 一轮内只有一次 Web 工具调用，或先后发生两次真实工具调用且每次各带一个审计详情
- **THEN** 单调用不出现组摘要；两次调用仍折叠为「2 个工具调用」；展开组后各审计详情仍默认关闭

### Requirement: 统一 Web 搜索与抓取工具

`harness.web_access.enabled` 缺省为 `true`，交互主会话 SHALL 默认提供 `web_search` 与 `web_fetch`，
两者 SHALL 使用同一结果信封与 `WebSource` 来源结构；显式 false 不注册这两件工具。`web_search` 输入 SHALL 仅含 `query` / `count` / `need_content`：query trim 后为 1–128 个
Unicode 字符且不全为空白；count 缺省 5、本地允许 1–10，越界 SHALL 返回 `web_args_invalid` 而非静默
clamp；`need_content` 缺省 `false`。`web_fetch` 输入 SHALL 仅含 1–8192 字符的 `url`。工具 schema
MUST NOT 暴露 API Key、provider、base URL、超时、重试、响应上限或任意 HTTP header。

统一信封 SHALL 含 `ok` / `provider` / `provider_id` / `operation` / `attempts` / `local_precheck` /
`trust` / `truncated` / `truncated_fields`，并 SHALL 另含两个可空结果读数 `result_count` /
`result_text_bytes`。成功 Search 的两个读数 SHALL 在预算裁剪全部完成后由后端**单一一次**计算：
`result_count` = 实际回送模型的结果条数（不是 provider 原始条数、不是请求的 `count`）；
`result_text_bytes` = 最终保留各结果的 title / snippet / summary / content 各字符串 UTF-8 字节数
之和（不含 URL / site / date / authority / query 与 JSON 结构开销，不是网页大小或网络流量）。
非 Search 成功、失败、缺读数时两键 SHALL 为 null，MUST NOT 以 0 冒充空结果。`local_precheck` SHALL 记录 Fetch 是否**实际执行过**
本地预检：未配置、配置非法、参数非法、权限拒绝等未进入 executor 的路径为 `false`；进入 executor
后无论预检成功、失败还是取消均为 `true`。审计 MUST NOT 仅按 `operation=fetch` 推断该值。`provider` / `provider_id` SHALL 为 `string | null`：只有 provider
解析成功才填 `"deepseek"` 与实际配置映射键；未配置、配置歧义、自定义 base URL 及解析前的参数 /
权限 / URL 拒绝均填 null 且 `attempts=0`，MUST NOT 伪造 `"deepseek"` 为配置 id 或在多候选时暗选。
基础参数形状与 URL 静态安全校验（scheme / userinfo / 控制字符 / 反斜杠 / 缺失 host，以及
`localhost`、`.local`、非全局单播 IP 字面量）SHALL 在 provider 解析与可选批准预览之前完成：
任一 provider 配置状态（未配置、配置歧义、自定义 base URL）都 MUST NOT 掩盖 URL 安全拒绝，
被拒调用 MUST NOT 变成 `web_provider_unconfigured`，也 MUST NOT 产生批准卡；这些路径的
`local_precheck` 为 `false`（预检未执行），`attempts` 为 `0`，可解析出 origin 的拒绝仍带
`source.url`，带凭据的输入 MUST NOT 被抄进 `source`。
成功 Search SHALL 另带完整 query 与 `results: WebSource[]`，成功 Fetch SHALL 另带
`source: WebSource`。`WebSource` SHALL 固定包含 `url` / `title` / `snippet` / `summary` /
`content` / `content_format` / `site` / `date` / `authority`。title SHALL 始终为 string，
Fetch 空标题固定 `""`；其它可空字段的无信息值才用 null，MUST NOT 混用空串与 null。
Search SHALL 原样保留 date 与 -1–4 的 authority（含 -1 = 未知）；Fetch 无这两项信息时填 null。
`site_icon` MUST NOT 进入结果，避免派生未审计的图片请求。

Search 的 `need_content=false` SHALL 作为默认工作流：先返回来源与摘要，再由模型按需调用 Fetch 获取
Markdown。Search 空数组 SHALL 是成功的空结果；Fetch 空 Markdown SHALL 返回 `web_empty_content`，
不得冒充有正文的成功。Fetch 的 `source.url` SHALL 是本地预检后实际提交给 DeepSeek 的 URL，
MUST NOT 伪造 provider 未返回的 final URL。

系统 SHALL 同时限制 API 响应字节与进入模型上下文的字符：Search title / snippet / summary 每项上限
300 / 500 / 1,200 Unicode 字符，Search content 每项 4,000 字符且全部 results 文本合计 24,000 字符，
Fetch Markdown 24,000 字符，Lumir message / provider_message / request_id / provider_code 各 1,000
字符；Search / Fetch API 响应
分别不得超过 2 / 4 MiB。聚合裁剪 SHALL 按 content → summary → snippet 顺序，结果只能整条移除；
URL / date / authority / provider MUST NOT 被裁剪。任何字段或数组被裁剪时 SHALL 同时置
`truncated:true` 并在 `truncated_fields` 列出稳定路径；未截断时该数组为 `[]`。只在文本末尾加省略号
而缺少这些字段 SHALL 视为违约。API 字节超限 SHALL 返回 `web_response_too_large`，不解析半截 JSON。

#### Scenario: 默认搜索后再抓取

- **WHEN** 模型以默认参数调用 `web_search`，随后选择一个来源调用 `web_fetch`
- **THEN** Search 请求携带 `count=5, need_content=false`，返回结构化来源但无需返回正文；Fetch 第二跳
  返回同一 `WebSource` 形状的 Markdown 内容，最终回答可引用 URL / title / date / authority / provider

#### Scenario: 空结果与空正文不同

- **WHEN** DeepSeek Search 返回空 results，或 Fetch 返回空 Markdown
- **THEN** 前者为 `ok:true, results:[]` 且不自动重试；后者为 `web_empty_content`，不得返回伪造正文

#### Scenario: 可空 provider 与空标题形状一致

- **WHEN** 分别发生无配置、配置歧义、解析前参数错误，以及 Fetch 无标题
- **THEN** 前三者的 `provider` / `provider_id` 均为 null 且 `attempts=0`，不暗选或伪造 id；
  最后一者的 `source.title` 为 `""` 而非 null

#### Scenario: URL 安全拒绝先于 provider 解析

- **WHEN** `web_fetch` 收到 `localhost`、`.local`、非全局单播 IP 字面量、非 HTTP(S) scheme 或带凭据的
  URL，且 provider 处于未配置 / 配置歧义 / 自定义 base URL 任一状态（`approval` 为任意值）
- **THEN** 结果恒为 `web_url_blocked`（参数形状非法则为 `web_args_invalid`），MUST NOT 被配置状态
  改写成 `web_provider_unconfigured`；`provider` / `provider_id` 为 null、`attempts=0`、
  `local_precheck=false`，不产生批准卡，可解析出 origin 的路径仍带 `source.url`

#### Scenario: 截断显式且 JSON 完整

- **WHEN** 搜索摘要、正文、结果数组或 provider 错误文案超过预算
- **THEN** 输出仍为完整 JSON，顶层 `truncated:true`，`truncated_fields` 精确指出被裁路径；未裁的
  URL / date / authority / provider 保持完整，不出现只加省略号的无标记截断

#### Scenario: 响应字节与上下文预算独立

- **WHEN** DeepSeek 响应超过对应 2 / 4 MiB 上限，或合法响应的正文超过模型字符预算
- **THEN** 前者返回 `web_response_too_large` 且不解析半截 JSON；后者可返回有界结果但必须显式标记截断

#### Scenario: 错误元数据同样有界

- **WHEN** provider 的错误响应带超长 `message` / `provider_message` / `request_id` / `provider_code`，
  或本地预检失败的错误串包含完整 8,192 字符 URL
- **THEN** 四个字段各自不超过 1,000 字符，且被裁字段逐一进入 `truncated_fields`；URL 本身的
  `source.url` 不被裁剪

#### Scenario: 审计按实际发生记录预检与外发

- **WHEN** 分别发生 allow_all 正常执行、ask 批准后执行、deny、未配置
- **THEN** 只有进入 executor 的 Fetch 审计 `local_precheck=true`；`provider_fetch` 只在
  `attempts>0` 时为 true；deny / 未配置的审计两个布尔均为 false，MUST NOT 按 operation 恒猜

#### Scenario: 结果读数按预算裁剪后的实际回送计算

- **WHEN** Search 返回的结果被字段截断、聚合裁剪或整条移除
- **THEN** `result_count` 等于最终仍回送模型的结果条数，`result_text_bytes` 等于这些结果的
  title / snippet / summary / content 的 UTF-8 字节和；真正成功的空结果为 `0` 而不是 null，
  失败 / 非 Search 成功为 null（MUST NOT 以 0 冒充）

### Requirement: Web 访问策略与 origin 例外

`harness.web_access.approval` 缺省为 `allow_all`，`web_search` / `web_fetch` SHALL 在所有权限模式中
默认直接执行；只有显式 `approval=ask` 才进入批准闸。Web 判定顺序 SHALL 为 deny > 既有硬层 >
`web_access.approval`，deny 永远优先。Web MUST NOT 使用 allow 规则或会话缓存派生授权，也 MUST NOT
生成 Web 专用持久 allow / 免问动作；其它工具的 allow / 缓存语义不变。

Search 的 permission subject SHALL 为完整 query；Fetch 的 subject SHALL 为规范化 origin
（scheme + host + 有效 port），origin 规范化 SHALL 小写 scheme / host、省略默认 port、保留非默认 port，
且不含 userinfo / path / query / fragment。默认无批准卡时，Web 工具行 SHALL 默认紧凑：运行中单行
显示状态与纯 query（Fetch 为纯 URL），MUST NOT 显示原始 arguments JSON 或默认参数；完成后默认
显示 query（Fetch 为 URL），Search 成功另有第二行结果健康摘要——正常为 `N 条结果 · 文本 X`，
字段截断追加 `· 已截断`，`truncated_fields` 含 `results` 时为 `保留 N 条结果 · 文本 X · 已截断`，
真正成功的空结果为 `0 条结果 · 搜索成功`（英文同义双语；N 与 X 的口径见「统一 Web 搜索与抓取
工具」条）。失败时直接显示稳定错误码与人话原因，MUST NOT 显示条数或文本大小。provider id、
attempts、完整 query / URL、截断字段、实际外发与费用、`trust:"untrusted"` SHALL 全部保留在默认
关闭的「查看详情」中，可展开完整回看；MUST NOT 删除事件 / 面板记录 / JSONL / 安全元数据。Ask
待决卡的完整预览信息不变。live 事件与快照 / 会话恢复两条路径 SHALL 同形同默认态；旧留存缺结果
读数时 SHALL 不显示条数与文本大小（MUST NOT 补零）。
`harness.permissions.deny` 中的 `web_fetch(origin)` SHALL 在初始调用与每跳重定向重新判定。

跨 origin 重定向不是新工具调用，MUST NOT 另开批准。预检 SHALL 先校验 Location 的 scheme / 凭据 /
host，再检查目标 origin deny；未封禁才继续 DNS / 连接 / 内容类型校验，全部通过后可执行。
被封禁目标在任何 approval 值下都 SHALL 返回 `permission_denied`，且不连接该 origin、不调用 DeepSeek。
基础参数形状与 URL scheme / userinfo 校验 SHALL 在可选批准预览之前完成，非法调用不得产生携带凭据
或无效目标的批准卡。任何 approval 值都不得跳过 DNS、重定向、内容类型、预算或密钥检查。

#### Scenario: 默认 Allow 不逐次弹卡且审计完整

- **WHEN** approval 缺省为 `allow_all`，模型以不同 query 连续搜索并抓取多个页面
- **THEN** 所有调用默认直接执行，没有会话范围限制或逐次批准卡；每次工具行显示 query / URL 与
  结果健康摘要，provider、attempts、费用与 untrusted 说明保留在默认关闭的「查看详情」中

#### Scenario: origin deny 恢复默认策略

- **WHEN** 权限 deny 含 `web_fetch(https://example.com)`，用户单独移除或清空该 deny
- **THEN** 写入复用既有权限规则与 revision；默认 `allow_all` 下该 origin 恢复直接执行，`ask` 下恢复
  批准闸，approval 不被暗改，其它规则不变

#### Scenario: 跨 origin 重定向只做硬校验与 deny

- **WHEN** Fetch 收到指向另一 origin 的 Location，目标未封禁；另一序列的目标命中 origin deny
- **THEN** 未封禁目标经 scheme / 凭据 / DNS / no_proxy / 内容类型校验后可继续，不另开批准；
  封禁目标返回 `permission_denied`，未连接新 origin、未请求 DeepSeek
- **AND** A → B 全部通过后，提交给 DeepSeek 的 url 与 `source.url` 都是最后一个通过校验的 B URL，
  不得拒绝跨源或继续提交 A URL

#### Scenario: 默认紧凑与详情默认关闭

- **WHEN** allow_all 下一次 Search 成功完成
- **THEN** 工具行显示 query，第二行显示 `N 条结果 · 文本 X`；详情入口读「查看详情」且
  `aria-expanded=false`，审计正文不可见；展开后可见 provider / attempts / 完整 query / 截断字段 /
  外发与费用 / untrusted，再次点击收回

#### Scenario: 空结果、字段截断与结果裁剪

- **WHEN** Search 真正成功但没有结果 / 某字段被截断 / 结果数组被整条移除
- **THEN** 三种分别显示 `0 条结果 · 搜索成功`、`N 条结果 · 文本 X · 已截断`、
  `保留 N 条结果 · 文本 X · 已截断`；N 与 X 取预算裁剪后的实际回送值

#### Scenario: 失败不显示条数与大小

- **WHEN** Web 调用以 `web_provider_unconfigured` / `web_http_error` / `permission_denied` 等失败
- **THEN** 工具行直接显示稳定错误码与人话原因，MUST NOT 出现 `0 条结果` / `0 B` 一类读数；
  provider / attempts / 外发事实仍可在「查看详情」中回看

#### Scenario: 实时与恢复同形

- **WHEN** 同一 Web 调用分别经 live 事件与快照 / 会话恢复重建
- **THEN** 两者工具行、第二行健康摘要、详情入口与默认关闭态一致；旧留存缺结果读数时两者都
  不显示条数与大小
