# harness 增量规格

> 起草注记（非规格正文）：本 change 给 harness 加三档权限模式、cli_run 分类闸门与 vault 写硬引导、
> vault_move / vault_delete 两工具、会话内批准缓存与权限 chip。判定管线、分类表与重定向协议见
> [design.md](../../design.md)；MODIFIED 三条的基线正文在 `openspec/specs/harness/spec.md`
> （权限机制 / 工具循环 / 配置节 [harness]）。

## MODIFIED Requirements

### Requirement: 权限机制

系统 SHALL 实现三层权限规则：allow / ask / deny，判定顺序 deny > allow > 默认分层。规则语法 SHALL 支持 tool 级与 tool+模式级（如 `cli(tavily *)` 的命令前缀匹配）。权限规则之外，系统 SHALL 提供**三档权限模式**作为默认分层的档位：`read_only` / `vault_write`（默认）/ `full_access`，逐档语义如下——读类工具（`vault_read` / `vault_search` / `skill_load`）三档均直接放行；`vault_patch` / `vault_create` / `vault_move` 在 `read_only` 档 SHALL 拒绝（非询问）并回送说明，在 `vault_write` 与 `full_access` 档 SHALL 自动放行；`vault_delete` 在 `read_only` 档 SHALL 拒绝，在 `vault_write` 档 SHALL 逐个问（默认档分界，删除行为以 Alex 裁决点 1 为最终口径），在 `full_access` 档 SHALL 自动放行；`cli_run` 只读白名单命令三档均直接放行；`cli_run` 写命令在 `read_only` 与 `vault_write` 档 SHALL 逐个问，在 `full_access` 档 SHALL 自动放行（写目标在 vault 内者除外，见「cli_run 命令分类与 vault 写重定向」）；危险黑名单命令（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / git reset --hard / git clean，首版清单）**任何档都 SHALL 逐个问**，MUST NOT 自动放行。

判定总序 SHALL 为：deny 规则 > vault 内写重定向 > 危险黑名单 > allow 规则 > 模式默认分层——前四层模式无关，allow 规则 SHALL 在任何档生效（含 `read_only` 档），模式只替换最底层默认分层。deny 命中 SHALL 直接拒绝并回送模型；ask 档 SHALL 以批准闸呈现：执行前挂起循环，面板显示待批准项（写文档显示 diff 预览，CLI 显示完整命令），Alex 采纳后才执行，拒绝（及可选原因）回送模型；未决批准项 MUST NOT 自动超时通过。

#### Scenario: 默认档放行矩阵

- **WHEN** 模式为默认 `vault_write`，模型先后调用 `vault_read`、`vault_patch`、`cli_run("ls", ["-la"])`、`cli_run("npm", ["install"])`
- **THEN** `vault_read` / `vault_patch` / 白名单 `ls` 直接执行；`npm install` 挂起等待面板批准

#### Scenario: 只读档拒绝 vault 写而非询问

- **WHEN** 模式为 `read_only`，模型调用 `vault_patch`
- **THEN** 调用被直接拒绝（不进入批准闸），回送文本说明当前为只读档

#### Scenario: 危险黑名单任何档都问

- **WHEN** 模式为 `full_access`，模型调用 `cli_run("rm", ["-rf", "/tmp/x"])`
- **THEN** 调用进入批准闸等待用户决定，MUST NOT 自动放行

#### Scenario: deny 与 allow 规则跨模式优先序

- **WHEN** 模式为 `read_only`，配置 allow 规则含 `cli(npm run *)`，deny 规则含 `cli(npm run deploy*)`；模型调用 `cli_run("npm", ["run", "test"])`
- **THEN** `npm run test` 直接执行（allow 规则在只读档生效）；同模式下调 `npm run deploy` 则被 deny 规则拒绝

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

### Requirement: 工具循环

对话运行时 SHALL 支持工具循环：模型返回工具调用时，系统执行对应工具并将结果回送，直至模型不再调用工具或达到循环上限（默认 50，`[harness].loop_max` 可调；出厂值 M367 由 8 上调至 50，上界仍为 64）。达到上限 SHALL 终止循环并在面板给出明确提示。运行时 SHALL 维护会话状态于 Rust core，webview 重载 MUST NOT 丢失会话。工具集 SHALL 恰好为：`vault_read`、`vault_search`、`vault_patch`、`vault_create`、`vault_move`、`vault_delete`、`skill_load`、`cli_run`——清单外能力扩张须经 Alex 裁决（ADR 0007；本 change 的 `vault_move` / `vault_delete` 即该裁决的落地）。

#### Scenario: 多轮工具往返

- **WHEN** 模型的回答需要先读文件（返回 `vault_read` 调用）
- **THEN** 系统执行读取、把内容回送模型、继续生成最终回答；面板可见「调用了什么工具」

#### Scenario: 移动与删除工具在册

- **WHEN** 模型调用 `vault_move` 或 `vault_delete`（参数为 vault 相对路径）
- **THEN** 系统执行移动/移入废纸篓并按统一结果信封回送；参数逃逸 vault 根时拒绝且文件系统不变

#### Scenario: 循环上限

- **WHEN** 模型连续调用工具达到 `loop_max`
- **THEN** 循环终止，面板显示达到上限的提示，不产生进一步工具执行

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（闭集合 `kimi` / `deepseek` / `mock`）、`providers` 表（各 provider 的 `api_key` / `model` / 可选 `base_url`；mock 为 `fixture` 路径）、`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`。校验 SHALL 沿用既有模板：缺字段回落默认不告警；闭集合取值非法回落默认 + 人话 warning；类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key, value)`，`ui` 表既有行为不变。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为闭集合外的值
- **THEN** 启动不失败，provider 回落默认并产生一条人话 warning

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

#### Scenario: 切换写回持久化

- **WHEN** 在面板权限 chip 把模式从 `vault_write` 切到 `read_only`
- **THEN** 下一个判定按 `read_only` 执行；`config.json` 的 `[harness].permission_mode` 被写回为 `read_only`，重启后保持

## ADDED Requirements

### Requirement: cli_run 命令分类与 vault 写重定向

系统 SHALL 在权限判定前对每次 `cli_run` 调用做命令分类：按命令名白名单与参数形态判定为**只读**（如 `ls` / `cat` / `rg` / `git` 只读子命令族 / 不带 `-i` 的 `sed` / `jq` 等，首版清单以 design §3.1 为准）、**危险**（rm / shutdown·reboot·halt·poweroff / mkfs 系 / dd / `git reset --hard` / `git clean`，首版清单以 design §3.3 为准）或**写**（其余一切，含未知命令——保守默认）。shell 包装器命令（`sh` / `bash` / `zsh` / `cmd` / `powershell` / `osascript` 等）或任一参数含 shell 元字符（`|` `;` `&&` `||` `>` `>>` `<` 等）的调用 SHALL 保守归为写，MUST NOT 按命令名白名单放行。

分类为写、且写目标解析进 vault 内的 `cli_run` 调用，**任何权限档都 SHALL 直接拒绝**并回送结构化重定向提示：固定错误码（`cli_redirected_to_vault_tool`）+ 固定标记文本包裹的 JSON 载荷（`reason` / `targets` / `suggested_tool` 字段固定），指明应改用哪个 vault 工具（`vault_patch` / `vault_create` / `vault_move` / `vault_delete`）。目标是否「在 vault 内」的判定不确定时 SHALL NOT 重定向，回落正常写分类。闸门 MUST NOT 自动把 cli_run 改写成 vault 工具调用——重定向只经回送文本由模型自行改道。

#### Scenario: vault 内写被重定向

- **WHEN** 任意模式下模型调用 `cli_run("mv", ["notes/a.md", "notes/b.md"])`
- **THEN** 调用被拒绝（不执行），tool result 含固定标记文本与 JSON 载荷（targets 含 `notes/a.md` / `notes/b.md`，suggested_tool 为 `vault_move`）

#### Scenario: 模型改道 vault 工具完成写

- **WHEN** 模型收到上述重定向结果后，下一轮改调 `vault_move(path: "notes/a.md", new_path: "notes/b.md")`
- **THEN** `vault_move` 按模式语义表执行（默认档直接放行），文件完成移动，工具循环继续

#### Scenario: vault 外写不被重定向

- **WHEN** 模型调用 `cli_run("npm", ["install"])`（写目标不在 vault 内）
- **THEN** 调用按模式语义表处理（默认档逐个问），回送中 MUST NOT 出现重定向标记

#### Scenario: 元字符参数保守归类

- **WHEN** 模型调用 `cli_run("ls", ["-la;", "rm", "-rf", "/tmp/x"])`（参数含元字符）
- **THEN** 调用 MUST NOT 因 `ls` 在白名单而放行——整调用按写分类（并进一步命中危险黑名单则任何档都问）

### Requirement: vault 移动与删除工具

系统 SHALL 提供 `vault_move` 工具：参数 `path`（vault 相对路径，源）与 `new_path`（vault 相对路径，目标，含新末段名），实现 vault 内移动/重命名（可跨目录）；源与目标 SHALL 经 vault 根路径解析的全部逃逸防护，目标撞名 MUST NOT 覆盖既有条目，目标父目录 MUST 已存在，跨卷失败 SHALL 如实报错且 MUST NOT 留半移动状态（不做静默 copy+delete）。系统 SHALL 提供 `vault_delete` 工具：参数 `path`（vault 相对路径），删除 SHALL 为移入系统废纸篓（用户可经系统通道恢复），MUST NOT 提供永久删除路径。两工具 ask 档的批准预览 SHALL 分别为「源 → 目标」路径对与「路径 + 将移入废纸篓可恢复」。

#### Scenario: 跨目录移动

- **WHEN** 模型调用 `vault_move(path: "drafts/a.md", new_path: "notes/2026/a.md")`（目标父目录存在、目标不存在）
- **THEN** 条目移动到目标路径，源路径消失，返回成功信封

#### Scenario: 移动撞名不覆盖

- **WHEN** 模型调用 `vault_move` 且目标路径已有同名条目
- **THEN** 返回 `fs_already_exists`，源与目标均逐字节不变

#### Scenario: 删除进废纸篓

- **WHEN** 模型调用 `vault_delete(path: "notes/a.md")` 且批准被采纳
- **THEN** `notes/a.md` 进入系统废纸篓（可恢复），vault 内消失；废纸篓调用失败时文件保持原样

### Requirement: 会话内批准缓存

批准闸 SHALL 提供次级动作「采纳且本会话不再问」：点击后该次调用执行，且 `(工具名, 规范化主体串)` 记入当前会话的批准缓存；同一会话内后续与缓存键精确匹配（同工具、同规范化主体串）的调用 SHALL 直接执行，MUST NOT 重复弹批准闸。点「采纳」本身 MUST NOT 记入缓存。缓存 SHALL 为会话内存态：「新会话」、切 vault 切会话、app 重启即清空；MUST NOT 落盘、MUST NOT 进 JSONL 留存。缓存命中只在模式默认分层生效——deny 规则、vault 内写重定向、危险黑名单三层 MUST 先于缓存判定（缓存不解锁这三层）。

#### Scenario: 显式记忆与精确匹配

- **WHEN** Alex 对 `cli_run("npm", ["run", "test"])` 点「采纳且本会话不再问」，随后模型调用 `cli_run("npm", ["run", "test"])`
- **THEN** 第二次直接执行；随后模型调用 `cli_run("npm", ["run", "build"])`（不同主体串）仍弹批准闸

#### Scenario: 黑名单不受缓存影响

- **WHEN** 缓存中已有某主体串，模型以相同主体串调用命中危险黑名单的命令
- **THEN** 仍进入批准闸，MUST NOT 因缓存自动放行

### Requirement: 权限模式切换

composer 控制行 SHALL 提供权限 chip（位于思考 chip 之后、ctx 读数之前），显示当前模式档名（文案表 zh：只读 / 保险库写入 / 完全访问）。点击 SHALL 弹出浮层：三档单选、当前档勾选、无释义文案；浮层 SHALL 复用既有浮层可访问性口径（`role="menu"` / `menuitemradio` / `aria-checked`）。选择一档 SHALL 立即生效并经 `config_set_value` 写回 `[harness].permission_mode`；切换 MUST NOT 打断进行中的轮次（对下一个判定生效，与模型 chip 同口径）。

#### Scenario: 三档浮层

- **WHEN** 点击权限 chip
- **THEN** 浮层列出三档、当前档勾选、无释义文案；选择另一档后 chip 文案更新、浮层关闭

#### Scenario: 切换不打断进行中轮次

- **WHEN** 一轮对话正在工具循环中，把模式从 `vault_write` 切到 `read_only`
- **THEN** 当前轮次按开轮时的模式判完；从下一个判定起按 `read_only` 执行
