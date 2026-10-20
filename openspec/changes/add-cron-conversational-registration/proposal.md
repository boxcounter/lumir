# Proposal: cron 对话式注册（agent 工具面 + 运行期即时生效）

- Change ID: add-cron-conversational-registration
- 日期: 2026-10-20
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **裁决留痕（2026-10-20，逐字）**
>
> **现场**：「奇怪，我尝试在 0.9.0 Lumir 里新建一个 cron，但是看 harness 的输出，它好像自己手搓了
> 一套 cron」——agent 用 `cli_run` 手工搭了一套系统级调度：一个 LaunchAgent plist、一个 shell 脚本、
> 一条经 `osascript` 发出的通知，完全绕过 Lumir 的 `[cron]` 机制。（现场的具体 label / 脚本路径 / 通知
> 文案不入库，仓库信息卫生纪律；本节只保留形态。）
>
> **立项**：tower 报三处缺口与三条修法（agent 工具面 + 系统提示词告知 + 「手搓外部调度器」列禁区）
> 后，Alex 原话「好，请你动手。」——立项依据即本文件与 [design.md](design.md)。
>
> **UX 期望（harness vision 讨论时，逐字）**：「我需要一个定时工作，每天 hh:mm 提醒我写今日 log，
> 当我点击提醒后，自动创建一个 markdown 的文件」——在会话里用自然语言说，agent 就该把它注册成
> Lumir cron 任务，而不是另起一套系统调度。

## Why

### 1. 三处缺口合起来构成一条必然的歧路

1. **cron 任务只有一个来源：手写 `config.json`。** `[cron].tasks` 是唯一任务表
   （`src-tauri/src/config.rs:166`），装载口径写在字段注释里——「启动装载时快照一次，运行期不热重载
   （改配置需重启）」（`src-tauri/src/config.rs:164-165`）。对话里没有任何路径能把任务写进这张表。
2. **系统提示词不知道 cron 存在。** 装配的全部固定段（`src-tauri/src/harness/context.rs:25-48`：
   identity / quote-reference / path-reference）与三层 AGENTS.md 里没有一处提到定时任务；工具清单
   也没有相关工具（`src-tauri/src/harness/tools.rs:104`）。模型面对「每天 21:00 提醒我」只能按自己
   的通用知识找办法——它找到的是 `launchctl` 与 `osascript`，因为 `cli_run` 恰好能做这两件事。
3. **没有任何禁区。** 「不手搓系统级调度」既不在提示词里，也不在权限面。于是缺口 1 与 2 相遇时，
   模型的输出不是「我做不到」，而是一套逃出 Lumir 生命周期的 launchd 任务——它不受 Lumir 的
   通知链路、权限闸、诊断事件约束，用户也无从在 Lumir 里看见或删除它。

**这不是模型不听话，是产品没给出口。** 缺一个「说一句就能建任务」的入口，模型就会用手里那把锤子。

### 2. 为什么必须是工具面，而不是「让 agent 改配置文件」

`config.json` 在 vault 之外（配置目录），harness 的写工具全部禁锢在 vault 根内（`vault_patch` /
`vault_create` 的路径校验），`cli_run` 写 vault 之外的路径要过批准闸，且写完之后运行期**不会立即
吸收**（文件变化本身不触发重读）。「让 agent 自己拼 JSON 写配置文件」这条路要么被权限面挡住，要么
绕过去之后任务不会自己活起来，agent 也无法诚实地说「任务已创建」。工具面是唯一能把「写配置 +
校验 + 即时生效 + 结构化回执」打成一个原子的位置。

### 3. 为什么推翻 `add-cron-runtime-daemon` 的「运行期不热重载」

原决定的两条依据是「与 `editor.mode` / `ui.markdown_line_numbers` 同口径」与「不做文件监听」。

- **被推翻的只是表象**：本 change **不实现文件监听**（原决定的技术理由原样保留：运行期不因文件变化
  而重读）。新增的是**显式注册通道**：工具写配置 → 投一条 reload 工作项 → `lumir-cron` 线程重读
  配置并替换任务集。时序确定（只有一个写入点、一次重载），没有「文件改了一半」的不确定态。**推论**：
  重载读的是文件当下内容，先前未重启生效的手改会被这一次重载一并吸收——文档与 spec 按这个口径写，
  不承诺「手改一定等到下次启动」。
- **不推翻的代价更大**：对话注册若要求重启才生效，Alex 描述的 UX（说完就有一个每天会响的任务）
  就不成立——agent 只能回一句「已写入配置，请重启 Lumir」，这与「手搓 launchd」相比没有消除摩擦，
  只是把手搓的目标从系统换成配置文件。
- **技术面已经就位**：`lumir-cron` 线程本就是「装载一次快照 + 消息循环」（`src-tauri/src/lib.rs:917-1000`），
  通知点击（`on_action`）已经把工作项投进同一个通道（`src-tauri/src/lib.rs:204-209`）。加一个消息
  变体 + 一次重载，是扩展既有通道，不是新发明 IPC。

### 4. 为什么现在做

cron 机制已在 0.9.0 交付并 dogfood（`add-cron-runtime-daemon` 已实现，待归档）；任务表、校验、
守护线程、通知链路都在。缺的只是入口。此刻补入口的增量是三件工具 + 一条重载消息 + 一段提示词；
再晚，用户会继续用 launchd 攒出更多 Lumir 看不见的定时任务。

## What Changes

### A. 三件调度工具（`cron` capability，新增工具类）

- `cron_task_create` / `cron_task_list` / `cron_task_remove`：对象-动作命名（与 `skill_load`
  同族），各自单一职责、各自一套参数 schema。
- 参数与 `[cron].tasks` 的字段一一对应（`id` / `at` / `prompt` / `days?` / `vault?` / `delivery?` /
  `session?` / `model?`），`vault` 缺省 = 当前 vault 根。
- **只在交互发送路径注册**：无人值守运行（`tool_policy` = 8 件 vault 工具）与子运行（定义白名单
  同样以 `TOOL_NAMES` 为界）都看不见这三件——定时运行不能给自己排新任务，子代理也不能。
- 三件工具**不操作 vault**，因此不走「写且需防护才有 vault 工具」的判据（ADR 0007 Decision 7），
  属编排工具类的第二组。**这是工具清单的第二次扩张，须 Alex 在节点 1 显式裁决**（Revisit 分支的
  既有消费路径，同 `task` 的 2026-10-18 先例）。

### B. 运行期任务集重载（推翻「不热重载」的口径）

- `lumir-cron` 线程不再因「任务表为空」而退出（现在会 `return`，`src-tauri/src/lib.rs:958`）：
  空表只是空转，线程存活才谈得上「运行期加任务」。
- 新增一条 reload 工作项：工具写完配置后投递，线程**重读配置**（不是接收任务载荷）并替换任务集；
  配置始终是唯一任务真源。
- 重载时补做通知权限检查（现在只在「启动时有至少一条任务」的路径上做，`src-tauri/src/lib.rs:989`）
  ——否则新注册的 `notify-then-run` 任务会静默投不出通知。
- 去重状态 `cron-state.json` 仍**只由该线程写**（单写者纪律）：注册引入的新任务由线程补一条
  「注册日不派发」的种子记录。

### C. 系统提示词增订：能力告知 + 禁区

- 新增固定段 `cron-reference.md`（编译期嵌入，与 `quote-reference.md` / `path-reference.md` 同族），
  三条内容：① 三件工具存在、何时用；② 使用纪律（先 list 查重、prompt 必须自包含、默认
  `notify-then-run` 不点头不花 token）；③ **禁令**：MUST NOT 用 `cli_run` 手搓系统级调度
  （LaunchAgent plist / `launchctl` / `crontab` / `at` / systemd timer / 登录项 / 第三方调度器）。
- 装配清单记一条来源条目（`cron_reference`），与既有固定段同口径。

### D. 权限档（`harness` capability 修订）

- `cron_task_list`：读类，三档直接放行。
- `cron_task_create` / `cron_task_remove`：`read_only` / `vault_write` 档逐个问，`full_access` 档
  自动放行（与 `vault_delete` 同形：打断成本高、但 full_access 档的承诺是不打断）。
- 批准卡呈现任务五要素（时间 / 星期 / 触达策略 / 目标 vault / prompt 全文），并说明「今天不补触发」。
- 会话内缓存的主体串改为 `id + at + days` 的规范化串（现状 `permission_subject` 对无 `path` 参数的
  工具回落到空串，会让「本会话不再问」变成一个工具级的总开关，`src-tauri/src/harness/tools.rs:314`）。

### E. 文档与诊断

- `docs/specs/config-reference.md` §1.8：`cron.tasks` 生效时机改准（启动装载 + 注册通道重载；文件变化
  不单独触发重读），新增「对话式注册（agent 调度工具）」小节（工具表、缺省、错误码、注册时已过点
  不补触发）。
- 诊断事件新增 `cron_task_registered` / `cron_task_removed` / `cron_task_rejected`，进白名单；
  装载期的 `cron_task_invalid` 不变。

## Non-goals

- **不做任务管理面板**：没有「任务列表 / 启停开关 / 编辑表单」的 UI。任务在 `config.json` 与对话里管理。
  理由与触发条件见 design §9。
- **不做版本更新 / 编辑语义**：`create` 遇到同名 id 直接报错，不静默覆盖；改任务 = `remove` + `create`
  （或手改配置，等下一次启动 / 下一次注册重载生效）。不做 `update` op —— 它会把「用户在批准卡上
  看的是哪一版」变成一个新问题。
- **不做文件监听**：改文件本身不触发重读；手改内容最迟在下一次启动**或**下一次注册通道重载时生效
  （重载读的是文件当下内容，因此可能提前吸收）。本 change 只让**显式注册通道**即时生效。
- **不做暂停 / 启用开关**：删掉再建即可；加 `enabled` 字段会让 `[cron]` 多一个「值声明了却没有消费者
  之外的另一半」——暂停态要在守护、通知、状态三处各判一次，成本远高于当前需求。
- **不做系统级守护**：`add-cron-runtime-daemon` 的非目标原样保留（Lumir 不运行 = 无触达）。本 change
  甚至把它变成提示词层的明确禁令。
- **不把 `launchctl` / `crontab` 加进危险命令黑名单**：`launchctl list`、`crontab -l` 是合法只读查询，
  黑名单会误伤；真正的防线是「有正解可用」（A + C）而不是封路。见 design §12 的取舍记录。
- **不授予子代理与定时运行这三件工具**：深度 1 与无人值守的边界都不放宽。
- **不做任务数量上限与配额**：单用户日常 1–3 条；`full_access` 档下的自动放行由用户自己承担（与
  该档既有语义一致）。
- **不做「运行前确认」以外的防呆**：例如不允许 agent 建 `silent-run` 任务这件事不做硬拦截（那是
  用户可在批准卡上否决的选择），只在提示词里说明默认档的理由。

## Impact

- **影响的 specs**：
  - `cron`（MODIFIED ×3：通用定时任务机制——「新增 / 替换 / 删除任务」的通道补上工具面；任务定义与
    配置校验——删除「运行期 MUST NOT 热重载」，改为「运行期只经显式注册通道重载」；触发去重状态与
    持久化——`last_fired` 的语义改准为「该本地日期不再派发」，并补注册种子这一写入时机。ADDED ×3：
    对话式任务注册 / 运行时任务集重载 / 定时任务能力告知与外部调度器禁令）。
  - `harness`（MODIFIED ×2：工具循环——工具清单由 8 + 1 扩为 8 + 1 + 3；权限机制——三件工具的模式档
    与批准卡内容）。
- **影响的代码/系统**（概述，细节见 design.md）：
  - `src-tauri/src/config.rs`：`validate_cron` 抽出「单条任务校验」供工具复用；新增「读—改—写同锁」
    的配置变更入口（现状 `write_config_value_to` 的读与写不在同一把锁内）；`AppConfig.cron` 的
    「不热重载」注释改准。
  - `src-tauri/src/cron.rs`：`CronMessage` 增加 reload（带一次性回执）；任务集替换与「注册日种子」
    的纯函数部分；判定输入不变。
  - `src-tauri/src/lib.rs`：线程不再因空表退出；reload 处理与通知权限补检；把 `CronRuntime` 包装成
    工具侧的端口实现。
  - `src-tauri/src/harness/tools.rs`：三件工具的定义与执行分支、`ToolContext` 增加 cron 端口、
    `permission_subject` 增加 cron 分支。
  - `src-tauri/src/harness/run.rs` / `turn.rs`：交互路径注册这三件定义、`run_turn` 注入端口、批准预览
    携带任务要素。
  - `src-tauri/src/harness/permissions.rs`：三件工具的档位分层。
  - `src-tauri/src/harness/context.rs` + `prompts/cron-reference.md`：新固定段与装配清单条目。
  - `src-tauri/src/logging.rs`：三个新事件名进白名单。
  - `src/harness-panel.ts` / `harness-panel.css`：批准卡的任务要素区块（视觉口径见 design §7.3）。
  - `docs/specs/config-reference.md`：§1.8 生效时机 + 注册小节。
  - `scripts/acceptance/scenarios/`：新增「对话注册 → 工具被调 → 任务生效」链路场景（含批准卡）。
- **关联约束**：
  - **ADR 0007 Decision 7（工具集边界）：须同步修订**为「8 件 vault 操作 + 1 件编排 + 3 件调度」。
    本次扩张按该 Decision 与 Revisit 条件的既有路径由 Alex 在节点 1 显式裁决；不在 change 里静默扩张。
  - ADR 0002 §5（配置即数据 + 逐项校验 + 人话 warning）：工具写入走同一条写通道与同一套校验。
  - ADR 0002 §6（性能合同）：reload 只在线程上做一次文件读，冷启动与 keypress-to-paint 无接触面；
    tick 仍是纯内存比较。
  - ADR 0002 §7（核心模块不耦合 tauri）：三件工具的执行逻辑经端口注入，`cron.rs` 仍无 tauri 依赖。
  - ADR 0003 第 3 条（永不改写源文件格式）：本 change 不写 vault（工具只写配置目录）。
  - **归档顺序前置条件**：`add-cron-runtime-daemon`（`cron` 的首个 delta，已实现待归档）与
    `add-harness-subagents`（同样待归档、且已 MODIFY 过 `harness` 的「工具循环」）MUST 先归档；
    否则本 change 的 MODIFIED 块会与它们的整块替换互相覆盖（`openspec archive` 对 MODIFIED 是整块
    替换，`docs/process/openspec-workflow.md`）。本 change 的 MODIFIED 正文按**两者归档后**的
    living 形态撰写。
  - REVIEW.md「同一语义两处真源」条：任务表只有 `config.json` 一处真源（工具写它、线程读它），
    去重状态只有 `lumir-cron` 线程一个写者。
  - AGENTS.md「变更默认直接切断」：无兼容层——不存在「旧的不热重载行为」需要保留，也没有旧工具名。

## 节点 1 需裁决的设计取舍（逐条可否决）

1. **工具形态：三件独立工具，不用单个 `cron_task(op=…)`**（推荐）。理由：权限层按**工具名**分层
   （`permissions.rs` 的 `READ_TOOLS` 与 `mode_layer`），单工具多 op 会把「list 放行、create 要问」
   塞进 op 判别，等于在权限层新造一条真源；而三件工具的形状与 `vault_*` / `skill_load` 的既有惯例
   同族。备选：单工具（工具清单只加 1 件），代价是权限面要按 op 分支 + JSON Schema 变弱。
2. **`create` / `remove` 的权限档：必须问，`full_access` 档自动放行**（推荐）。理由：定时任务是
   **持续性开销**——批准的那一刻是用户唯一能看见「它以后每天会自己跑」的时机；一次点击换掉日后
   每天的静默运行。备选一：完全自动放行（清单只加 1 个档位例外，但用户第一次看见任务可能是几天后
   的一条通知）。备选二：任何档都问（含 `full_access`），代价是与该档「不打断」的承诺冲突，且与
   `vault_delete` 的既有形状不一致。
3. **不做任务面板，只留工具面**（推荐）。理由：面板会成为任务表的第二个真源（要同步、要处理外部
   编辑后的漂移），而任务通常 1–3 条、创建与删除都发生在对话里——面板没有增量价值，却带来一整条
   视觉门禁与基线成本。触发条件：出现「想在不打开配置文件的前提下看清单 / 暂停某条任务」的真实
   摩擦时另立 change。
4. **注册时已过点的新任务当日不补触发**（推荐）。用户在 21:30 说「每天 21:00 提醒我」时，若按既有
   「已过点 + 当日未触发 ⇒ 立刻触发」口径，注册后 30 秒内就会弹一条通知——刚说完话又被提醒一次。
   推荐口径：运行期注册引入的新任务，**若注册那一刻已过点**则当日不派发（线程在重载时写一条当日
   种子）；注册时未到点的（20:00 注册 21:00 的任务）当日照常触发。备选：照既有拉取口径立即补触发
   一次（适合「我就是要它现在跑一次」的场景，但用户没说这句话，而且他可以直接说「现在跑一遍」）。
5. **不做「手搓外部调度器」的命令黑名单，只做提示词禁令**（推荐）。理由：`launchctl list` /
   `crontab -l` 是合法查询，黑名单会误伤日常操作；而真正的防线是「正解存在且被告知」（A + C）。
   备选：把 `launchctl bootstrap` / `crontab -` 一类写入形态加进危险命令表——那是权限语义变更，
   需要回扫既有验收场景的闸期望，且只能挡住一部分写法（plist 也可以手写成文件）。

以上 5 条均为设计取舍，Alex 有拒绝面；本 proposal 不自带未裁决的阻塞项。节点 1 通过前不进入实现。
