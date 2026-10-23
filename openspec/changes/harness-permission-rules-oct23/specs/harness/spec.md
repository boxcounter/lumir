# harness 增量规格

> 起草注记（非规格正文）：本 change 给权限系统补两件基础设施——「从批准卡沉淀命令前缀规则 +
> 规则列表可见可删」与「`bash -lc` 受限解包」，并把会话记忆从整条命令改为前缀粒度、把危险卡上的
> 死按钮藏起来。机制、判据与裁决点见 [design.md](../../design.md)。MODIFIED 各条基于当前
> living spec（`openspec/specs/harness/spec.md`，master `ba98587d`）的原文整块复制后改，
> 未改动的段落逐字保留。

## ADDED Requirements

### Requirement: 权限规则的持久化与治理

系统 SHALL 支持把一次批准沉淀为**持久权限规则**，写入全局配置 `[harness].permissions.allow`
（跨 vault 生效）。规则文本 MUST 由后端从待决调用的 argv / 路径**现算**（单一真源）：前端
MUST NOT 拼装、改写或回传规则字符串，后端 MUST NOT 采信前端传入的规则文本。写入 SHALL 去重
（已存在同文规则时不重复追加），写回 SHALL 原子（读 → 合并 → 原子写）。

规则的生成口径 SHALL 为：`cli_run` → `cli(<命令> <首个非 flag 参数> *)`；取不到第二词
（只有命令、或第二词以 `-` 开头）时为 `cli(<命令> *)`。`vault_patch` / `vault_create` /
`vault_move` → 路径含目录段时为 `tool(<目录>/*)`，否则为精确规则 `tool(<路径>)`。
`vault_delete` 与 `cron_task_create` / `cron_task_remove` MUST NOT 提供持久化入口（删除与
「每天自行运行」的授权不宜一次点击到永久），二者保留会话内记忆能力（见「会话内批准缓存」）。
生成的规则文本 MUST 是规则语法可解析、且能真实命中同族调用的字符串；无法安全表达（含换行、
空路径等）时 MUST NOT 提供该入口——退化为「多问一次」可接受，退化为「误放行」不可接受。

持久规则 MUST NOT 解锁危险黑名单：判定层序（deny > vault 内写重定向 > 危险黑名单 > allow >
模式默认分层）不变，手写 `cli(bash *)` 这类 allow 规则对危险层无效；危险黑名单命中的批准卡
MUST NOT 提供沉淀入口（见「批准闸呈现与决策后收敛」）。

规则列表 SHALL 在权限浮层中逐条可见、可删（呈现口径见「权限模式切换」）。删除 SHALL 幂等
（规则不存在时安静成功），并在下一次权限判定生效。规则写回失败时，本次调用 MUST NOT 执行：
批准保持待决，MUST NOT 出现「调用已执行、规则没写」或「规则已写、调用未批准」的半态。

本期规则作用域 SHALL 为全局（所有 vault 生效），MUST NOT 提供 session / vault 级作用域或规则
优先级数值——`[harness].permissions` 仍只有 `allow` / `deny` 两张表，MUST NOT 引入 `ask` 规则层。

#### Scenario: 沉淀前缀规则后同类查询免问

- **WHEN** 保险库写入档下 `cli_run("tvly", ["search", "prompt caching"])` 进入批准闸，Alex 点击「以后都允许 `cli(tvly search *)`」，随后模型调用 `cli_run("tvly", ["search", "另一个问题"])`
- **THEN** 第二次调用直接执行、不进批准闸；`config.json` 的 `[harness].permissions.allow` 含 `cli(tvly search *)`；之后调用 `cli_run("tvly", ["save", "x"])` 仍弹批准闸（不同子命令）

#### Scenario: 规则文本由后端生成并去重

- **WHEN** 同一前缀的规则已存在于配置，Alex 又在同类调用上点击「以后都允许」
- **THEN** 配置里仍只有一条该规则（MUST NOT 重复追加）；按钮上显示的文本与写入配置的文本逐字相同

#### Scenario: 危险命令不可被持久规则解锁

- **WHEN** 配置的 allow 规则含 `cli(bash *)`（手写或历史遗留），模型调用 `cli_run("bash", ["-lc", "rm -rf /tmp/x"])`
- **THEN** 调用仍进入批准闸（危险黑名单层先于 allow 规则），MUST NOT 因该规则自动放行

#### Scenario: 规则写回失败不执行调用

- **WHEN** 配置文件不可写（权限 / 磁盘错误），Alex 在某批准卡上点击「以后都允许」
- **THEN** 本次调用不执行、批准卡保持待决并显示错误；再次普通采纳可正常执行

## MODIFIED Requirements

### Requirement: 权限机制

系统 SHALL 实现两层权限规则：allow / deny（不存在 `ask` 规则表——需要「必须问」的语义由危险
黑名单与模式默认分层承担），判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与
tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）。allow 规则 SHALL 既可手写于配置，也可由批准卡
沉淀（生成、去重与作用域口径见「权限规则的持久化与治理」），并 SHALL 在权限浮层中逐条可见、可删。
权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`
（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `skill_load`）
三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 逐个问
（Always Ask，2026-10-09 Alex 裁决：该档语义为「读自动放行、一切写逐个问」，模式层 MUST NOT
直接拒绝），在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 与
`vault_write` 档 SHALL 逐个问（Vault Write 档的分界以 Alex 裁决点 1 为口径），在 `full_access` 档
SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与
`vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，
见「cli_run 命令分类与 vault 写重定向」）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff /
mkfs 系 / dd / git reset --hard / git clean / shell 包装器类，首版清单；shell 包装器中「受限解包」
成立的只读形态除外，口径见「cli_run 命令分类与 vault 写重定向」）**任何档都 SHALL 逐个问**，
MUST NOT 自动放行。模式层 SHALL 只在「直接放行」与「逐个问」之间切换，SHALL NOT 产出「拒绝」
——拒绝只来自用户 deny 规则。

判定总序 SHALL 为：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层——前四层
模式无关，allow 规则 SHALL 在任何档生效（含 `read_only` 档），模式只替换最底层默认分层。deny 命中
SHALL 直接拒绝并回送模型：拒绝对话 MUST NOT 进入批准闸（不产批准卡、不等待用户决定），且回送的
错误 SHALL 带上**命中的规则原文**（如「命中 deny 规则 cli(npm run deploy*)」），使「是哪条规则
拦的」不必回配置文件核对；规则原文拼入后若超出工具行摘要的展示长度上限，SHALL 退回不带规则原文
的既有文案，MUST NOT 呈现被截断的规则名。ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示
待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送
模型；未决批准项 MUST NOT 自动超时通过。

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

### Requirement: cli_run 命令分类与 vault 写重定向

系统 SHALL 在权限判定前对每次 `cli_run` 调用做命令分类：按命令名白名单与参数形态判定为**只读**
（如 `ls` / `cat` / `rg` / `git` 只读子命令族 / 不带 `-i` 的 `sed` / `jq` 等，首版清单以 design
§3.1 为准）、**危险**（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / `git reset --hard` /
`git clean` / shell 包装器类，首版清单以 design §3.3 为准）或**写**（其余一切，含未知命令——保守
默认）。shell 包装器命令（`sh` / `bash` / `zsh` / `dash` / `fish` / `csh` / `ksh` / `cmd` /
`powershell` / `pwsh` / `osascript` / `eval` / `exec` 等）SHALL 默认归为危险——内容不可知即视同
潜在危险，任何档都逐个问（2026-10-23 Alex 裁决 D1 起，下述**受限解包**是唯一例外）。`sh` /
`bash` / `zsh` / `dash` 的 `-c` / `-lc` / `-cl` 形态（恰好一个脚本参数、无其它参数）SHALL 做受限
解包：脚本只由 `;` / `&&` / `||` / `|` 分隔的线性子命令组成、参数为字面量（单 / 双引号内不发散）、
只允许 `2>/dev/null` / `>/dev/null` / `1>/dev/null` / `2>&1` 四种整 token 的无害重定向，且**每一个**
子命令经本条既有分类判定为只读时，整条调用 SHALL 按只读处理；否则 MUST 维持危险。以下任一形态
MUST 解包失败并维持危险：脚本含变量 / 反引号 / `$( )` / `${ }` / `<` / `>`（白名单外）/ `&`
（后台）/ `( )` / `{ }` / here-doc / 换行 / 反斜杠转义；子命令数超过 16、脚本超过 4096 字节；
包装器嵌套超过 2 层；`bash script.sh`（脚本文件）形态、多重 flag 形态、裸包装器。解包失败时
MUST NOT 降为「写」——落点只有「只读」与「危险」两种，否则 `full_access` 会静默放行包装脚本；
子命令分类 MUST 复用本条的分类判定，MUST NOT 引入第二套分类语义。解包形态下，下述 shell 元字符
保守归写规则 MUST NOT 先行适用（由逐子命令判定取代）；非解包形态下该规则不变。任一参数含 shell
元字符（`|` `;` `&&` `||` `>` `>>` `<` 等）的调用 SHALL 保守归为写。三者均 MUST NOT 按命令名白名单
放行。

间接调用包装器（`sudo` / `xargs` / `find` 的 `-exec` / `-execdir` / `-ok` / `-okdir`，2026-10-10
Alex 裁决「堵」）SHALL 递归提取被包装命令、以其分类为本条调用的分类：`sudo rm` 视同 `rm`（危险），
`sudo ls` 视同 `ls`（只读，不得误伤）。被包装命令取不出确定形态（裸 `sudo` / `xargs` 无命令 /
`-exec` 子句不完整）SHALL 保守归为危险——任何档都逐个问。递归 MUST NOT 展开到包装器名单之外
（不做通用 shell 语义解析），且 MUST 先于 shell 元字符保守规则判定（`sudo bash -c "a;b"` 按被包装
命令判，不因外层参数带元字符落「写」被 `full_access` 放行）。

分类为写、且写目标解析进 vault 内的 `cli_run` 调用，**任何权限档都 SHALL 直接拒绝**并回送结构化
重定向提示：固定错误码（`cli_redirected_to_vault_tool`）+ 固定标记文本包裹的 JSON 载荷（`reason` /
`targets` / `suggested_tool` 字段固定），指明应改用哪个 vault 工具（`vault_patch` / `vault_create` /
`vault_move` / `vault_delete`）。`suggested_tool` SHALL 按写动词形态映射（`mv`/`cp`→`vault_move`、
`rm`→`vault_delete`、`sed -i`/重定向→`vault_patch`、`touch`/新文件→`vault_create`、`mkdir`→
`vault_create`）——`mkdir` 的落点是 `vault_create`：建目录不另立工具，`vault_create` SHALL 自动创建
缺失的父目录（`mkdir -p` 语义）。目标是否「在 vault 内」的判定不确定时 SHALL NOT 重定向，回落正常
写分类。闸门 MUST NOT 自动把 cli_run 改写成 vault 工具调用——重定向只经回送文本由模型自行改道。

#### Scenario: vault 内写被重定向

- **WHEN** 任意模式下模型调用 `cli_run("mv", ["notes/a.md", "notes/b.md"])`
- **THEN** 调用被拒绝（不执行），tool result 含固定标记文本与 JSON 载荷（targets 含 `notes/a.md` / `notes/b.md`，suggested_tool 为 `vault_move`）

#### Scenario: mkdir 写被重定向到 vault_create

- **WHEN** 任意模式下模型调用 `cli_run("mkdir", ["notes/2026"])`（写目标 `notes/2026` 解析进 vault 内）
- **THEN** 调用被拒绝（不执行），tool result 的 `suggested_tool` 为 `vault_create`；下一轮模型经 `vault_create` 在该目录下落文件即连带建出父目录（`mkdir -p` 语义，不另立目录工具）

#### Scenario: 模型改道 vault 工具完成写

- **WHEN** 模型收到上述重定向结果后，下一轮改调 `vault_move(path: "notes/a.md", new_path: "notes/b.md")`
- **THEN** `vault_move` 按模式语义表执行（默认档直接放行），文件完成移动，工具循环继续

#### Scenario: vault 外写不被重定向

- **WHEN** 模型调用 `cli_run("npm", ["install"])`（写目标不在 vault 内）
- **THEN** 调用按模式语义表处理（默认档逐个问），回送中 MUST NOT 出现重定向标记

#### Scenario: 元字符参数保守归类

- **WHEN** 模型调用 `cli_run("ls", ["-la;", "rm", "-rf", "/tmp/x"])`（参数含元字符）
- **THEN** 调用 MUST NOT 因 `ls` 在白名单而放行——整调用按写分类（`read_only` / `vault_write` 档逐个问，`full_access` 档放行）

#### Scenario: shell 包装器任何档都问

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("bash", ["-c", "rm -rf /tmp/x"])`
- **THEN** 调用进入批准闸（批准卡显示完整命令），MUST NOT 自动放行——shell 包装器内容不可知，视同潜在危险；MUST NOT 走进 vault 写重定向层

#### Scenario: 间接调用包装器递归（sudo / xargs / find -exec）

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("sudo", ["rm", "-rf", "/tmp/x"])`（或 `xargs rm` / `find . -exec rm {} \;` 形态）
- **THEN** 调用进入批准闸，MUST NOT 自动放行——被包装命令是黑名单成员，视同直接调用；用户 allow 规则与「本会话不再问」缓存 MUST NOT 解锁本层
- **AND** 同模式下调用 `cli_run("sudo", ["ls", "-la"])` 直接放行（被包装命令是只读白名单，不得误伤）
- **AND** 调用 `cli_run("sudo", [])`（取不出被包装命令）进入批准闸——保守归危险，宁多问勿漏拦

#### Scenario: 只读脚本解包放行

- **WHEN** 默认 `vault_write` 档下模型调用 `cli_run("bash", ["-lc", "ls -la 2>/dev/null; echo ---; ls docs | tail -5"])`
- **THEN** 调用直接执行、不进批准闸——全部子命令（`ls` / `echo` / `ls` / `tail`）都在只读白名单、分隔符与重定向都在安全集内

#### Scenario: 混合脚本仍按危险处理

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("bash", ["-lc", "ls; rm -rf /tmp/x"])` 或 `cli_run("bash", ["-lc", "mkdir docs/new"])`
- **THEN** 调用进入批准闸，MUST NOT 自动放行——存在非只读子命令时整条维持危险（MUST NOT 降为「写」）

#### Scenario: 非白名单重定向与变量使解包失败

- **WHEN** 模型调用 `cli_run("bash", ["-lc", "ls > docs/a.md"])`、`cli_run("bash", ["-lc", "cat < /etc/passwd"])` 或 `cli_run("bash", ["-lc", "echo $HOME"])`
- **THEN** 调用进入批准闸（危险），MUST NOT 因含只读命令 `ls` / `cat` / `echo` 而放行

#### Scenario: 包装器形态不满足或嵌套过深时维持在危险

- **WHEN** 模型调用 `cli_run("bash", ["script.sh"])`、`cli_run("bash", ["-x", "-c", "ls"])` 或三层嵌套的 `bash -lc "bash -lc \"bash -c 'ls'\""`
- **THEN** 调用进入批准闸，MUST NOT 解包放行

### Requirement: 会话内批准缓存

批准闸 SHALL 提供次级动作「采纳且本会话不再问」：点击后该次调用执行，并把缓存键记入当前会话的
批准缓存。`cli_run` 的缓存键 SHALL 为**命令前缀**（命令名 + 首个非 flag 参数；取不到第二词时退化为
命令名），命中按词边界前缀判定（规范化主体串等于前缀，或以前缀加一个空格开头）；vault 工具与调度
工具的缓存键 SHALL 为规范化主体串全等。同一会话内后续命中缓存键的调用 SHALL 直接执行，MUST NOT
重复弹批准闸。批准卡 SHALL 写明本次会话将记住的粒度（`cli_run` 显示前缀原文、其余工具显示主体串
原文），使授权面在按下前可见。危险黑名单调用的缓存键 MUST NOT 被写入（该层先于缓存判定，写进去
也永远不会被读到），其批准卡 MUST NOT 提供该次级动作。点「采纳」本身 MUST NOT 记入缓存。缓存 SHALL
为会话内存态：「新会话」、切 vault 切会话、app 重启即清空；MUST NOT 落盘、MUST NOT 进 JSONL 留存。
缓存命中只在模式默认分层生效——deny 规则、vault 内写重定向、危险黑名单三层 MUST 先于缓存判定
（缓存不解锁这三层）。缓存 SHALL 与持久规则彼此独立：命中缓存 MUST NOT 写配置，持久规则命中 MUST
NOT 写缓存。

#### Scenario: 显式记忆与精确匹配

- **WHEN** Alex 对 `vault_patch(path: "notes/a.md")` 点「采纳且本会话不再问」，随后模型调用 `vault_patch(path: "notes/a.md")` 与 `vault_patch(path: "notes/b.md")`
- **THEN** 第二次同一路径直接执行（vault 工具按规范化主体串全等匹配）；`notes/b.md` 仍弹批准闸（不做前缀泛化）

#### Scenario: 前缀记忆覆盖同命令族的其它实参

- **WHEN** 默认档下 Alex 对 `cli_run("tvly", ["search", "prompt caching"])` 点「采纳且本会话不再问（记住 `tvly search`）」，随后模型调用 `cli_run("tvly", ["search", "另一个问题"])` 与 `cli_run("tvly", ["save", "x"])`
- **THEN** 第二个 `search` 直接执行、不进批准闸；`save` 仍弹批准闸（不同前缀）

#### Scenario: 黑名单不受缓存影响

- **WHEN** 缓存中已有某前缀，模型以命中该前缀的主体串调用危险黑名单命令；或 Alex 在危险黑名单卡上查看次级动作
- **THEN** 调用仍进入批准闸，MUST NOT 因缓存自动放行；危险卡不出现该次级动作，缓存里不新增该条目

### Requirement: 权限模式切换

composer 控制行 SHALL 提供权限 chip（位于模型 / 思考合并选择器 chip 之后、ctx 读数之前），**显示
当前模式档的短名**（文案表 zh：只读 / 可写 / 完全；en：Read / Write / Full）——控制行被合并选择器
chip 与权限 chip 共同挤占，短名是「三档都能完整显示」的口径（Alex 2026-10-09 裁决；zh 短名「写入」
于 2026-10-10 批复改为「可写」）。点击 SHALL 弹出浮层：三档单选、当前档勾选、列表项显示**全名**
（zh：只读 / 保险库写入 / 完全访问；en：Read Only / Vault Write / Full Access）、且**每档附一行释义**
消歧档名与语义（`read_only` = 读自动放行、写操作都先问；`vault_write` = 库内写自动放行、库外命令
先问；`full_access` = 全自动、仅危险命令仍问；措辞可在实现批次微调，语义方向以此为准）。chip 的
悬停提示与可访问名 SHALL 说明当前档并附上**该档的同一行释义**（与浮层释义同源，不新增信息）。
浮层 SHALL 复用既有浮层可访问性口径（`role="menu"` / `menuitemradio` / `aria-checked`）。选择一档
SHALL 立即生效并经 `config_set_value` 写回 `[harness].permission_mode`；切换 MUST NOT 打断进行中
的轮次（对下一个判定生效，与模型 chip 同口径）。

浮层 SHALL 在三档单选项之外另附一段「已记住的规则」：逐条显示 `[harness].permissions.allow` 的
规则原文（等宽字体）与一个删除钮，删除钮的可访问名 SHALL 含规则原文。该列表为空时整段（含分隔线
与段标题）MUST NOT 渲染，浮层形态与无此段时一致。列表内容 SHALL 在浮层打开时从当前配置现读，
MUST NOT 呈现前端缓存的旧值；删除 SHALL 立即写回配置，并在下一次权限判定生效。规则条目 SHALL
只读——浮层内 MUST NOT 编辑规则文本（改写仍走配置文件）。条目较多时列表区 SHALL 滚动，浮层本体
MUST NOT 超出面板可视边界（沿用既有边界收编）。

#### Scenario: 三档浮层

- **WHEN** 点击权限 chip
- **THEN** 浮层列出三档（各显示全名 + 一行释义）、当前档勾选；选择另一档后 chip 文案（短名）更新、浮层关闭

#### Scenario: 切换不打断进行中轮次

- **WHEN** 一轮对话正在工具循环中，把模式从 `vault_write` 切到 `read_only`
- **THEN** 当前轮次按开轮时的模式判完；从下一个判定起按 `read_only` 执行

#### Scenario: chip 悬停提示带当前档释义

- **WHEN** 指针悬停在权限 chip 上（或读屏取该 chip 的可访问名）
- **THEN** 提示文本包含当前档全名与浮层里的那行释义（如「权限模式：保险库写入（点击切换）· 库内写自动放行；库外命令先问你」），且与浮层同一档的释义逐字相同

#### Scenario: 规则列表可见可删

- **WHEN** 配置的 allow 规则含 `cli(tvly search *)`；打开权限浮层并点击该规则旁的删除钮
- **THEN** 三档下方出现「已记住的规则」段并逐条显示规则原文；删除后该条从列表消失、配置里的规则同步移除；此后同类 `tvly search` 调用重新弹批准闸

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
默认分层**（带当时判定的档位名与该档释义）。判定依据 MISSING（旧后端 / 旧快照载荷）时该行 SHALL NOT
渲染，MUST NOT 以猜测或默认文案填充。该行 SHALL 随界面语言重取文案，MUST NOT 残留旧语言串。

批准卡的次级动作 SHALL 由后端随批准请求下发（事件与快照两条通道同源），前端 MUST NOT 按判定依据
或其它字段自行推断可见性。模式默认分层进闸的卡 SHALL 显示「采纳且本会话不再问（记住 `<粒度>`）」；
可持久化规则的工具（非危险层进闸的 `cli_run`、`vault_patch` / `vault_create` / `vault_move`）另
SHALL 显示「以后都允许 `<规则原文>`」，规则原文由后端单一真源生成、按钮逐字显示。**危险黑名单
命中的卡 MUST NOT 显示这两枚次级动作**：该层先于 allow 规则与会话缓存判定，这两枚按钮在那类卡上
是死按钮（点了也不生效），显示即误导。次级动作字段缺省（旧后端 / 旧快照载荷）时两枚按钮 MUST NOT
渲染。

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

#### Scenario: 判定依据随决策退场

- **WHEN** Alex 对带判定依据行的批准项点击采纳或拒绝
- **THEN** 终态记录里不出现判定依据行（与待决副句、决策按钮、次级动作按钮一同退场），界面零残留

#### Scenario: 可持久化的卡显示两枚次级动作

- **WHEN** 默认 `vault_write` 档下 `cli_run("tvly", ["search", "x"])` 进入批准闸
- **THEN** 卡上同时显示「采纳且本会话不再问（记住 `tvly search`）」与「以后都允许 `cli(tvly search *)`」两枚次级动作；两枚文本与后端生成的粒度 / 规则逐字相同

#### Scenario: 危险卡不显示次级动作

- **WHEN** 任意档下 shell 包装器命令（脚本不可解包）或危险黑名单命令进入批准闸
- **THEN** 卡上 MUST NOT 出现「采纳且本会话不再问」与「以后都允许」两枚按钮（MUST NOT 以置灰形态出现）；只保留采纳 / 拒绝
