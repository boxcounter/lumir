# Design: Harness 工作区合同与 `vault_list`

- Change ID: `add-harness-vault-workspace-list`
- 日期: 2026-10-28

## 1. 工作区合同：三层同一根

一个 harness 运行的工作区由三层共同表达，三层 MUST 取同一个 vault 根（`VaultScope.root`），
MUST NOT 各自从环境推断：

| 层 | 载体 | 消费者 |
|---|---|---|
| 上下文 | system 的「工作区」段（绝对根 + 路径边界） | 模型 |
| 执行 | `cli_run` 子进程的 `current_dir` 与 `PWD` | 子进程 / 外部 CLI |
| 判定 | `permissions::vault_relative` 的相对目标解析 | 权限管线第 2 层（写重定向） |

调用链上根的唯一来源是 `VaultScope`：交互会话经 `harness::ensure_session(scope)` → `assemble_system(&scope.root)`；
子代理经 `subagents` 的 `hub.inner.scope.root` → `assemble_system_for_subagent`；cron 无人值守运行经
`harness_cron_run` 解析出任务 vault 的 scope → `ensure_session`。回合级的 `ToolContext { root, .. }`
（`turn.rs:451-462`）已经是同一个根——本 change 只是把这个已有事实接到 `cli_run` 与提示词上。

**不做兼容层**：不保留「子进程继承主进程 cwd」的旧行为。该行为不稳定（cwd 取 app 启动目录，与
vault 无关）且没有可指名的消费者；保留它会让权限层继续需要「靠存在性猜归属」的分支。

## 2. 上下文层：工作区段

### 2.1 模板与代入

新增 `src-tauri/src/harness/prompts/workspace-reference.md`：固定纪律（`vault_*` 用 vault 相对路径 /
`cli_run` 从 vault 根启动 / vault 外目标用绝对路径 / 不用 `pwd`、`ls /`、`find $HOME` 探测工作区），
含一个路径占位符。装配处（`context::assemble_with_identity`）把它代入当前根后作为固定段注入：

```text
===== 工作区 =====
Vault 绝对根路径：<VaultScope.root 的 display 形态>
<workspace-reference.md 的纪律正文>
```

- 代入用一次 `replace`（占位符 `{{VAULT_ROOT}}`），MUST NOT 引入模板引擎。
- 注入文本 trim 掉尾空白（与其它固定段同口径）。
- 装配清单条目的 `bytes` 是**代入后**文本的字节数；`path` 记模板的仓内相对路径
  （`src-tauri/src/harness/prompts/workspace-reference.md`）。因此该条 MUST NOT 被「文件与注入文本
  逐字节相等」的既有断言覆盖——它按设计不等。

### 2.2 位置与顺序

`identity → (delegation 约束，仅子运行) → workspace → quote_reference → path_reference → 定时任务 →
AGENTS.md 三层 → Skill 索引`。

放在 identity 之后、引用纪律之前：模型先知道「我在哪个 vault、怎么写路径」，再看「怎么回指摘录 /
怎么输出路径」。子运行的委托约束仍紧跟身份段（机制级约束优先于环境事实）。

### 2.3 首选工具链写进 identity

工具选择纪律属身份段（交互会话与 cron 运行共用），不写进工作区段——子代理的定义正文替换身份段，
但**不代表**它一定被授予 `vault_list`；把「首选 `vault_list`」写进固定工作区段会让未授予该工具的子
运行读到一条它做不到的指引。`identity.md` 增加两句：

- 找文件 / 目录先用 `vault_list`（默认只列一层，`recursive: true` 才下钻；`path_glob` 过滤），
  再 `vault_read` / `vault_search`；
- 不要用 `pwd` / `ls /` / 广域 `find` 探测 vault 位置——工作区段已给出绝对根。

## 3. 执行层：`cli_run` 的工作目录

- `execute_with_revision` 把 `ctx` 传给 `cli_run(args, ctx)`；`cli_run` 内：
  `command.current_dir(&ctx.root)` + `command.env("PWD", ctx.root)`。
- MUST NOT `std::env::set_current_dir`：主进程 cwd 是全局共享状态，多 vault / 子代理 / 后台运行会
  互相污染（`cli_path()` 的登录 shell 解析也在主进程里跑）。
- 每次 spawn 独立设置，不缓存、不依赖上一次调用。
- 子进程的环境变量处理顺序不变：先清注入型变量（`RIPGREP_CONFIG_PATH` 等），再注入登录 shell PATH，
  最后 `PWD`。`PWD` 只反映工作目录，不参与权限判定。
- `cli_run` 的参数面不变（`command` / `args` / `purpose`）——不提供可填 `cwd`。外部目标仍以绝对
  路径出现在 argv 里，按既有分类与判定处理。

A/B：同一进程内先在 vault A、后在 vault B 取值（`VaultScope` 按 key 分槽），每次 `cli_run` 读当回合
的 `ToolContext.root`，因此天然分槽；主进程 cwd 从头到尾不变（测试断言 `current_dir()` 前后相等）。

## 4. 判定层：相对写目标的归属

`permissions::vault_relative(root, target)` 重写为「词法规则 + symlink 否决」，删除存在性佐证：

```text
1. 空串 ⇒ None
2. 含 `..` 任一组件 ⇒ None（逃逸：不重定向，落回正常写分类）
3. 绝对路径 ⇒ 词法规范化后必须 strip_prefix(canonicalize(root)) 成功，取相对部分（空 ⇒ None）
4. 相对路径 ⇒ 无条件视为 vault 内，rel = 规范化后的字面串
   4a. symlink 否决：取「目标自身，若不存在则最近的已存在祖先」，canonicalize 后必须仍在
       canonicalize(root) 之下；否则 None
```

- 旧实现的两条存在性判据（目标已存在 / 父目录存在）全部删除：cwd 不再是主进程目录，存在性不再
  携带任何归属信息；保留它们就是留一条「靠猜 cwd」的隐性分支。
- 根目录新文件（`newfile.md`：没有父目录段）因此有了确定落点——这正是旧实现 `:1819-1823` 的漏洞。
- symlink 否决只做安全收口，不做归属猜测：沿路径上最近的已存在祖先解析到根外 ⇒ 不重定向（该写入
  的真实落点在 vault 外，与绝对路径逃逸同档处理）。
- 重定向仍在权限管线第 2 层（先于 blacklist、allow 规则与模式分层），因此 `full_access` 档的 vault
  内写照样重定向；`suggested_tool` 的映射不变。
- 行为矩阵（`vault_relative` 的输入 → 结果）：

| 写目标 | 结果 | 依据 |
|---|---|---|
| `a.md`（根下不存在） | 重定向（`vault_create`） | 相对、无 `..` |
| `notes/new.md`（父目录在 vault 内） | 重定向（`vault_create`） | 相对、无 `..` |
| `notes/a.md`（已存在） | 重定向（`vault_patch` / 命令族映射） | 相对、无 `..` |
| `../outside.md` | 不重定向 | 含 `..` |
| `/etc/hosts` | 不重定向 | 绝对路径不在根下 |
| `<vault>/notes/a.md` | 重定向，targets 为 `notes/a.md` | 绝对路径在根下 |
| `linkdir/new.md`（`linkdir` → `/tmp`） | 不重定向 | symlink 否决 |
| `notes/link.md`（symlink 指向根外） | 不重定向 | symlink 否决 |

## 5. `vault_list` 合同

### 5.1 参数与返回

```text
vault_list(
  path?: string        // vault 相对目录，缺省根（""）
  recursive?: bool     // 缺省 false：只列一层
  path_glob?: string   // * 匹配任意字符序列（含 /），? 匹配单字符——与 vault_search 同一写法
  limit?: integer      // 有界条数；缺省 200、上限 1000、<1 按 1
  cursor?: string      // 上一页的 next_cursor
) -> {
  ok: true,
  entries: [{ path: string, kind: "file" | "directory" }],
  truncated: bool,
  next_cursor?: string   // 仅 truncated=true 时出现
}
```

- 只收 / 只返 vault 相对路径（`/` 分隔）。绝对路径**拒绝**并提示改用相对路径（此时模型已从工作区
  段知道根，转换是机械的；接受绝对路径会把「两种路径混用」的歧义带进新工具）。
- 排序按 `path` 码点升序（Rust `str` 序，确定性、不做大小写折叠）。
- 分页无状态：`next_cursor` = 本页最后一条的 `path`，`cursor` 只返回严格大于它的条目。磁盘在翻页
  之间变化时按字典序「续读」仍然成立（新增 / 删除不会造成重复或跳过已返回区间的语义混乱）。
- 缺省一层：`recursive=false` 时只返回 `dir_rel` 的直接子项（`path` 前缀匹配后不再含 `/`）。

### 5.2 复用 fs-io 而不是新写一套目录语义

实现直接调 `fs_io::scan_workspace(root, policy)`：

- 它已经是「全类型递归枚举 + hidden 丢弃 + lazy 行 + 用户规则」，结果按 path 排序；
- 嵌套 `.gitignore` 在递归途中逐层登记，因此对子树取前缀过滤时分类是完整的（若自写子树遍历，就要
  么重读祖先规则、要么漏规则，两者都会造出第二份目录语义）；
- 成本与 `vault_search` 同级（后者每次调用也做一次全量扫描并逐文件读取），不是新增的量级。

lazy 语义：`scan_workspace` 对 lazy 目录只出一行、不下钻，因此 `vault_list(recursive: true)` 在惰性
子树下只返回该目录自身；**显式**把 `path` 指到惰性目录也返回空页——惰性语义是「不枚举」，不因调用方
点名而改变（与 `vault_search` 不搜惰性条目同口径，单测钉住这条）。用户规则命中的**条目**（文件或
目录）同样出一行——这是与文件树一致的「惰性可见」口径：用户规则不让文件消失，只让它不进索引；
hidden 档才是「不可见」。刻意**不**在结果里暴露 `lazy` 标志（契约只给 `path` / `kind`）——是否需要
「惰性可见但未展开」的显式读数留给后续裁决，不在本 change 扩张语义；代价是「惰性目录未展开」与
「空目录」在结果上同形（§8 已登记）。

### 5.3 校验与错误码

| 情形 | 错误码 |
|---|---|
| `path` 含 `..` 或经解析逃出 vault | `fs_path_escape`（复用 `resolve_in_vault` 的既有码） |
| `path` 是绝对路径 | `list_path_absolute`：提示改用 vault 相对路径 |
| `path` 不存在 | `fs_not_found` |
| `path` 不是目录 | `list_not_a_directory` |
| 参数形状不合法 | `tool_args_invalid` |

### 5.4 与既有 Tauri command `vault_list` 的区别

`vault-workspace` capability 里已有同名 **Tauri command** `vault_list`（切换器的注册表列表，返回
id / 绝对路径 / 显示名 / 可用性）。两者不是同一件东西：一个是 LLM 工具（`harness` 的工具注册表，
vault 相对路径），一个是 webview → core 的命令（`vault-workspace`）。本 change 不改命令，命名沿用
Alex 已批准的 `vault_list`；实现与文档 MUST NOT 把两者混称。

## 6. 工具注册面

- `tools::TOOL_NAMES`：8 → 9（`vault_list` 插在 `vault_search` 之后），`definitions()` 增一条 schema。
- `permissions::READ_TOOLS`：加 `vault_list`（三档直接放行）。
- `tools::permission_subject`：`vault_list` 取 `path_glob`（有则）否则 `path`——与 `vault_search`
  的同名参数口径一致，供 deny 规则定位。
- 子运行：闭集合随 `TOOL_NAMES` 自动扩到 9 件；`DEFAULT_TOOLS` **不变**（仍只读三件）。是否把
  `vault_list` 加进缺省集属独立裁决（见 §8）。
- cron 交接：`allow = TOOL_NAMES`（`cron.rs:484-488`）自动含 `vault_list`——定时运行与交互运行看到
  同一套 vault 工具。
- `turn.rs` 的 `known` 工具名判定与 `tools::execute` 注册表共用 `TOOL_NAMES`，无需额外改动。

## 7. 测试计划（必红测试 = 没有实现就红的断言）

| 面 | 断言 | 位置 |
|---|---|---|
| 上下文 | 交互 / 子代理装配均含绝对根与「vault 相对 / cli_run 从根启动」边界句；清单多一条 `workspace`（exists / bytes / 模板路径） | `context.rs` 单测 |
| 上下文 | 两个不同 vault 各装配一次，互不含对方绝对路径 | `context.rs` 单测 |
| 上下文 | 固定段顺序断言（identity → workspace → quote → path → cron → AGENTS → skills） | `context.rs` 单测 |
| 执行 | `cli_run("pwd")` 输出 == 测试 vault 绝对路径；调用前后主进程 `current_dir()` 相等 | `tools.rs` 单测 |
| 执行 | 两个测试 vault 各跑一次 `pwd`，各自返回自己的根 | `tools.rs` 单测 |
| 执行（真实链） | cron 无人值守运行：`cron::handoff` → `Runtime::isolated` → `set_tool_policy` → `turn::run_turn_for` → `cli_run`；system 含绝对根、`pwd` stdout 逐字节等于该根 | `run.rs` 单测 `cron_run_workspace_root_reaches_system_and_cli_run_cwd` |
| 执行（真实链） | 子运行：`start_task` → 子运行循环 → `cli_run`；子会话 system 含同一绝对根、`function_call_output` 里的 stdout 逐字节等于该根 | `subagents.rs` 单测 `subagent_workspace_root_reaches_system_and_cli_run_cwd` |
| 判定 | 相对根目录新文件 / 嵌套新文件 / 既有文件在 `vault_write` 与 `full_access` 都 `Redirect` | `permissions.rs` 单测 |
| 判定 | `..`、根外绝对路径、根外 symlink 不重定向；根内绝对路径重定向且 targets 为相对 | `permissions.rs` 单测 |
| 工具 | `TOOL_NAMES.len() == 9`、`definitions()` 与名字表同源、`vault_list` schema 的 required / properties | `tools.rs` 单测 |
| 工具 | 默认一层 / 递归 / glob / 排序 / 分页三页拼接完整 / truncated 与 next_cursor 配对 / hidden 不出现 / lazy 不展开 / 越界与非法目标 / 不含正文与元数据 | `tools.rs` 单测 |
| 权限 | `vault_list` 三档均 auto-allow（不产批准卡、不产依据），deny 规则仍优先 | `permissions.rs` 单测 `vault_list_auto_allows_in_all_modes` |
| 文档 | 工具计数、固定段清单、ADR 与 spec 无「8 件 vault 操作工具」残留 | 人工 + `docs-check` |

真机场景（`scripts/acceptance/scenarios/254-harness-vault-workspace-list.md`，mock provider）：

1. 新会话的 `session_open` 里 system 含「===== 工作区 =====」段与验收 vault 的绝对路径，清单有
   `workspace` 条目（exists / 非零 bytes / 模板路径）。
2. fixture 让模型先 `cli_run("pwd")`：工具结果里出现验收 vault 绝对路径（不是 `/`）。
3. 接着 `vault_list()`：默认层只出现直接子项；递归调用的结果里有嵌套 sibling，hidden 档条目
   不出现、lazy 子树出一行但不展开；再 `vault_read` 读到列表里看到的那份 sibling，证明
   「列表 → 读」链路在真栈成立。
4. 不出现任何批准卡（`vault_list` 与 `pwd` 都免闸）。

真实 provider 的遵从度（是否真的不再 `pwd` / 广域 `find`）按判据 6 由交接所述「评审 proposal 并查看
相关文件」场景抽样复验，不进机器判据。

## 8. 非目标、残余风险与 follow-up

- **子代理缺省集不含 `vault_list`**（仍是只读三件）：默认子代理因此不能列目录。缺省集在
  `src-tauri/src/harness/agents.rs`（本 change 的 scope 外），扩到四件属独立小裁决；本 change 只保证
  「定义显式声明即可见」，并把它记进 `docs/backlog.md` 待裁决队列。
- **`scan_workspace` 的全量扫描成本**：`vault_list` 每次调用扫全树。与 `vault_search` 同级、且
  vault 规模属个人 PKM 量级（ADR 0002 §6 的性能合同针对打开 / 渲染热路径，不在工具调用路径上）。
  若日后成为瓶颈，优化方向是给 fs-io 加按子树枚举的单一实现，而不是在工具层自建遍历。
- **不暴露 `lazy` 标志**（§5.2）：惰性目录的子项不可见与「空目录」在结果上同形。若实测造成模型误判，
  再加字段属行为扩张，需裁决。
- **不做 `vault_stat` / `vault_count` / `vault_head`**：见 proposal 的 Non-goals。
