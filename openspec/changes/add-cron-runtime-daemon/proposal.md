# Proposal: cron 通用任务机制（运行时守护；daily log 降格为首个配置样例）

- Change ID: add-cron-runtime-daemon
- 日期: 2026-10-18（同日按 Alex 裁决重构；原稿形态为「运行时守护 + 笔记模板原语」）
- 角色: Alex Lee（评审/裁决），AI agent（起草）

> **裁决留痕（2026-10-18，逐字）**
>
> **触发方式**：「不建系统级守护（launchd）。采用运行时守护：Lumir 进程内定时器，到点（如 21:00）
> 若条件未满足则发 macOS 系统通知（app 在后台亦可发），点击通知唤起 app 并进入创建好的环境。」
> —— **仍成立**。「条件未满足」的判定与「进入环境」的落地方式按本次重构改准：机制只判「到点且
> 当日未触发」，环境由被触发的运行时 agent 按任务 prompt 与目标 vault 的 AGENTS.md 准备（design §2、
> §6）。
>
> **拉取兜底**：「与拉取式兜底合并——app 启动 / 切前台时检查同一条件。两个触发源共享同一判定函数。」
> —— **仍成立**。触发源清单按 design §4 增列「目标 vault 打开成功后补判一次」，仍是同一个判定函数、
> 同一组输入输出。
>
> **模板定位**（**已被 2026-10-18 重构裁决推翻**）：「模板机制是独立原语，被所有『定期笔记』复用。」
> —— 推翻理由：这条把「定期笔记」这一族任务的路径约定与小节结构写进了机制本身。环境初始化是运行时
> 职责，模板知识（路径约定、小节骨架）改由目标 vault 的 AGENTS.md 承载；`note-templates`
> capability 整体摘除（见 What Changes B），配置面 `[note_templates]` 不再落地。
>
> **开发时序**：「现在就做，将来发现不需要用的时候就从产品里删掉。手工验证靠对 LLM Wiki 机制的
> 精通和个人纪律，但我需要的就是降低这个门槛。」—— **仍成立**。
>
> **反向扳机**（**已被 2026-10-18 追加裁决撤回**）：「连续 4 周零使用即删除」。撤回原话：
> 「去掉反向扳机」「也把 cron 的反向扳机去掉」。本 proposal 不再设反向扳机，也不再设任何
> 「N 周零使用 ⇒ 删除能力」的判据；原裁决出处为 `.local/design/harness-vision.md` 2026-10-18
> 定稿的「裁决记录」与「行动队列」两节（git 外设计真源），撤回以本节记录为准。
>
> **节点 1 通过（2026-10-18）**：Alex 原话「通过。」（回应 tower 的「cron 提案节点 1 未正式
> 通过，需要你一句『cron 通过』」）。实现随即展开，依据是本目录三件套：[tasks.md](tasks.md)
> 是唯一任务清单，本文件与 [design.md](design.md) 是语义真源（实现期发现意图需变更时停下重走
> 节点 1）。
>
> **重构裁决（2026-10-18，逐字）**
>
> （一）「按照 Agent 的 cron 特性的常见实践，cron 应该是一个通用机制（比如定时），但每个 cron task
> 具体要做什么、环境怎么初始化/构建，是运行时的，cron 机制应该支持根据 task 来初始化环境，而不是
> 直接集成在在 cron 机制本身里。你现在的做法，比如『当前的模板设计的路径占位符只支持 {{date}}』是把
> cron task 相关的逻辑给写在 cron 里面了。如果一个月后我不要 daily log 这个特性了（不需要每日或每周
> daily log），但我需要别的 cron task（比如 自动检查 vault 里特定文档的一致性）时，该怎么办？」
>
> （二）「按这个方向重构。」被批准的方向：任务 = 调度 + prompt + 会话形态 + 触达策略
> （notify-then-run / run-then-notify / silent-run）+ 可选档位；note-templates 原语从 v1 摘掉，
> 模板知识下沉 vault AGENTS.md。借鉴对象：OpenClaw Automation
> （[docs.openclaw.ai/automation](https://docs.openclaw.ai/automation)）——任务载荷是自然语言
> instructions + 会话目标 + 投递策略 + 每任务模型覆盖，无类型化动作枚举。
>
> （三）2026-10-18 追加裁决：「去掉反向扳机」；针对 cron 明确「也把 cron 的反向扳机去掉」。
> 本 proposal 的「连续 4 周零使用即删除」条款随之摘除（见上节留痕），诊断事件只保留排障与
> 观测用途。

## Why

1. **原稿把任务知识写进了机制**。原设计的 `[note_templates].<id> = {path, body, prompt?}` 是一个
   只对「定期笔记」有意义的原语：`path` 是 vault 相对路径模板、只识别 `{{date}}` 占位符，`body`
   是小节骨架，cron 任务通过 `template` id 与之绑定。这套形状直接假定「每个任务 = 在某个路径上
   建一篇有固定小节的笔记」。Alex 的反例正好落在它的空档上：要做「检查 vault 里特定文档的一致性」
   这类任务，`path` / `body` 无处安放，只能回头改机制。**任务怎么做，不该是机制的知识。**
2. **通用机制的形状是「调度 + 自然语言任务载荷 + 运行策略」**。Alex 裁定的五要素——调度、prompt、
   会话形态、触达策略、可选模型档位——与主流 agent 产品的 cron 能力同形。OpenClaw Automation
   的任务载荷就是自然语言 instructions + 会话目标 + 投递策略 + 每任务模型覆盖，没有类型化动作
   枚举（[docs.openclaw.ai/automation](https://docs.openclaw.ai/automation)：会话上下文可选
   isolated / current / named / main，投递可选 channel / webhook / silent）。本 change 采用同一
   形状：机制只负责「什么时候叫醒谁、叫醒后怎么收尾」，「具体做什么」全部由任务 prompt 表达。
3. **环境初始化是运行时职责**。每天该建哪个文件、路径怎么写、文件已存在怎么办、小节骨架长什么样，
   都是「这个 vault 的约定」——它们的居所是目标 vault 的 `AGENTS.md`（harness 的系统上下文装配
   已经注入 vault 根 AGENTS.md，见 `src-tauri/src/harness/context.rs` 的三层 AGENTS 装配）。机制
   把这些知识内建，等于把 vault 的约定复制进产品代码，两边必然漂移。改成运行时职责后，删掉 daily
   log、加上一致性检查，都只是改配置里的 prompt 与 vault 的 AGENTS.md，代码零改动。
4. **运行时守护仍然够用**。触发精度是「一天一次、分钟级」，Lumir 开着就覆盖绝大多数使用时段；
   系统级守护（launchd）的复杂度在生命周期管理（plist 安装 / 卸载 / 升级迁移 / 配置同步）与故障域
   扩张（跨进程调试、通知权限、macOS 后台项管理），不值当。纯拉取也不行：只在启动 / 切前台时检查，
   等于把提醒推迟到下一次碰电脑。定时器负责「到点主动触达」，拉取负责「错过之后补上」，所有触发源
   共享同一个判定函数，才不会出现「定时器说没触发、兜底说触发过」的分裂。
5. **现在重构的成本最低**。本 change 尚未通过节点 1、零代码；改的是提案制品。若先按原稿实现，
   模板原语会先把「定期笔记」的形状钉进配置 schema、前端打开链路与诊断事件，届时再拆要动实现与
   已写好的验收场景。单用户、AI-only、无兼容包袱，重构成本低。

## What Changes

单一新 capability `cron`；原 `note-templates` capability 摘除。逐条对应 `specs/cron/spec.md` 的
requirement。

### A. `cron`：通用定时任务机制

1. **机制与任务解耦**：任务 = `{id, vault, at, days?, prompt, delivery?, session?, model?}`。五要素
   是调度（`at` + `days`）、自然语言载荷（`prompt`）、会话形态（`session`）、触达策略（`delivery`）、
   可选模型覆盖（`model`）；`id` 是身份，`vault` 是运行坐标。机制 MUST NOT 内置任何具体任务知识：
   不认笔记路径、不认文件存在性、不做类型化动作枚举；代码里 MUST NOT 出现任何任务 id 的字面量
   （`daily-log` 只是配置样例里的用户命名）。
2. **运行时定时守护**：进程内评估循环，按本机本地时间判断「本地日期属于 `days`、时钟已越过 `at`、
   且当日尚未触发过」；同一任务同日至多触发一次。应用没运行 = 没有任何触达（运行时守护的定义，
   不是缺陷）。判定 MUST NOT 读文件系统、MUST NOT 写盘。
3. **拉取式兜底与判定函数共享**：app 启动就绪后、主窗口获得焦点时、目标 vault 打开成功后，调用
   **同一个**判定函数；已过点但当日尚未触发的，按触达策略补触发一次。三个触发源只在「何时调用」
   上不同，判定输入输出与后续动作完全一致。
4. **三档触达策略**：`notify-then-run`（默认，到点先通知，点击通知才发起运行——点击即意图，无人
   点头不花 token）、`run-then-notify`（到点静默运行，结束后通知结果）、`silent-run`（静默运行，
   不通知）。三档共用同一条运行路径，差别只在「何时通知、谁发起运行」。
5. **运行装配与会话形态**：运行复用既有 harness 会话装配与发送通道——目标 vault 的 AGENTS.md 三层
   上下文照既有规则装配，prompt 作为一条显式消息送入，机制不参与「怎么做事」的解释。`session`
   两档：`new`（每次触发新会话，默认）与 `dedicated`（每任务一个专用会话，后续触发续写）。
   无人值守运行使用与用户交互会话分离的运行槽位，MUST NOT 改写或替换用户当前会话；遇到需批准的
   工具调用 MUST NOT 静默挂起（中止本次运行并暴露失败）。
6. **通知与点击链路**：到点 / 运行结果经 macOS 通知中心投递；通知文案通用化——标题 = 任务 id，
   正文只说「到点」「已完成」「运行失败」，MUST NOT 含 prompt 内容、文档正文或 vault 绝对路径。
   点击语义随策略：`notify-then-run` 点击 = 聚焦窗口 → 打开目标 vault（必要时）→ 发起运行；
   `run-then-notify` 点击 = 聚焦窗口并恢复该次运行的会话。重复点击幂等，不重复运行。
7. **配置面与状态**：`[cron].tasks` 数组，逐项 schema 校验、非法项丢弃 + 人话 warning（ADR 0002
   第 5 条）；不支持 cron 表达式、不支持一天多次、不支持任意条件表达式或脚本声明。当日触发去重
   状态落在 `<config>/cron-state.json`（独立小文件，与 `window-state.json` 同惯例），不进
   `config.json`、不进 vault。

### B. `note-templates` 原语整体摘除

1. **不再有模板原语，也不再落地 `[note_templates]` 配置面**。原稿的「模板定义 / 模板实例化 /
   当日实例的打开入口」三个 requirement 全部删除；`specs/note-templates/` 目录一并删除。
2. **`{{date}}` 占位符 DSL 随之消失**。路径怎么算（例如本地日期拼进文件名）由任务 prompt 表达、
   由运行时 agent 自行执行；机制不认识任何占位符。
3. **模板知识下沉目标 vault 的 AGENTS.md**。路径约定、小节骨架、已有文件怎么处理，写成该 vault
   `AGENTS.md` 里的一段约定；运行时 agent 每次运行都经既有装配读到它（`context.rs` 已注入 vault 根
   AGENTS.md 与 `AGENTS.local.md`）。这一条是本次重构的核心：**约定归 vault，机制归产品。**
4. **不保留任何第二套打开 / 预建实现**。原稿的 `note-template:open` 事件与 `note_template_open`
   命令不再存在；运行只走既有 harness 发送通道，用户看的是会话与文件树。

### C. 首个配置样例：daily log 每日 21:00（样例，不是特化代码路径）

`[cron].tasks` 一条任务：`at = "21:00"`、`vault` = `<daily-vault>`（占位）、`prompt` = 「按本 vault
的 AGENTS.md 的日记约定，确保今天的日记存在：不存在就按骨架新建，已存在就直接用它，不要改写」、
`delivery = "notify-then-run"`（默认档）。目标 vault 的 AGENTS.md 写明 `daily/YYYY-MM-DD.md`
与小节骨架。21:00 若当日尚未触发 → 通知；点击 → 运行 agent 按 AGENTS.md 与 prompt 准备环境。
**代码里 MUST NOT 有 `daily-log` 字面量，也不得有 `daily/`、`## 记录` 这类样例内容**——它们只出现
在配置样例与 vault 文档样例里。

## Non-goals

- **系统级守护明确不做**：不装 launchd / LaunchAgent / 登录项 / 系统 cron，不做「Lumir 没运行也能
  触达」。留档的升级触发条件 = 出现「Lumir 没运行也要触达」的真需求（如定时抓取推送）；届时另立
  ADR/change，不在本 change 里预留钩子。
- **不做 cron 表达式 / 通用调度器**：不支持 `* * * * *`、秒级触发、一天多次、任意间隔。一天多次
  由多条任务表达；cron 表达式那一档明确不做。
- **不做类型化动作或条件表达式**：任务载荷只有自然语言 prompt，没有 `action` / `condition` /
  `template` / 路径字段；「今天该不该真的写东西」由 prompt 在运行时判断。配置拒绝「配置即代码」。
- **不做模板机制 / 占位符 DSL / 模板编辑器**：`{{date}}` 一类占位符不再存在；定期笔记的形状由
  vault AGENTS.md 定义，产品不解析、不校验。
- **不做内建 wiki 工作流（ingest / lint）与跨 vault 链接**：本 change 只交付定时任务机制；lint 类
  检查由用户以任务 prompt 自行配置（这正是本次重构的意图），产品不内建 ingest / lint 流程，也不做
  跨 vault 链接工作流（原 Non-goal「不做跨 vault 链接 / wiki 工作流」按新形态保留）。
- **不做应用内任务管理 UI**：v1 配置即数据，没有增删任务的面板；新任务靠手写 `config.json`。
- **不做通知动作按钮与自定义通知文案**：只有「点击通知本体」一条交互；正文是通用文案，不读
  prompt 摘要（通知会出现在锁屏与通知中心，任务 prompt 可能含私密内容）。
- **不做自动批准**：无人值守运行沿用既有 harness 权限闸；需批准时中止本次运行，不自动放行、也不
  自动拒绝（不因「无人值守」而放松安全闸）。
- **不做后台常驻形态**：不新增菜单栏常驻 / 关窗不退出；窗口关闭即应用退出，关闭后无触达。
- **不做多机去重**：iCloud 同步的 vault 在多台 Mac 上各自判定、各自触发。
- **不做运行历史 UI**：运行落在既有 harness 会话留存里，经既有会话历史查看；v1 不新增「任务运行
  记录」面板。
- **不扩张 harness 工具集**：不新增「在编辑器里打开文件」一类工具（工具集恰好 8 个的既有裁决不在
  本 change 内动）。运行能准备文件内容；能否替用户开标签见「节点 1 需裁决的设计取舍」第 6 条。

## 观测：怎么知道用了 / 有效 / 出问题怎么发现

诊断事件只服务排障与自我校准，**不绑定任何「零使用即删除能力」的判据**（反向扳机已按 2026-10-18
追加裁决摘除，见裁决留痕）。

- **怎么知道用了**：`cron_click`（点击通知 → 是否成功发起运行）与 `cron_run_finished`（运行是否
  成功）。
- **怎么知道有效**：`cron_notified` 的时刻与 `cron_run_started` / `cron_run_finished` 的时刻是否
  落在同一触发窗口。若某条 `notify-then-run` 任务连续数日只有 `cron_notified`、没有 `cron_click`，
  说明这条提醒没在帮忙——用户可把**该任务**改成 `run-then-notify` / `silent-run`，或删掉这条任务
  （任务级运营建议，不是能力级删除判据）。
- **出问题怎么发现**：配置校验的逐项 warning（非法任务被丢弃时说清是哪一项）；通知权限被拒时一条
  人话 warning；`cron-state.json` 损坏时一条 warning；运行被延后（目标 vault 不是当前 vault）、
  被跳过（任务正在运行）与失败（含需批准而中止）各落诊断事件，不静默。真机验收场景覆盖通知到达、
  点击发起运行、静默运行与配置非法项（见 tasks §7）。

## Impact

- **影响的 specs**：`cron`（ADDED，单一 capability，requirement = 机制与任务解耦 / 运行时定时守护 /
  拉取式兜底与判定函数共享 / 三档触达策略 / 运行装配与会话形态 / 通知的投递与点击唤起 / 任务定义与
  配置校验 / 触发去重状态与持久化）；`note-templates` 目录删除（原三个 requirement 不再存在）。
- **影响的代码/系统**（概述，细节见 design.md）：
  - `src-tauri/src/config.rs`：新增 `[cron]` 节（生效类型 + Raw 镜像 + 逐项校验 + ts-rs 导出）；
    原计划的 `[note_templates]` 不落地。
  - `src-tauri/src/cron.rs`（新）：判定函数、`at` / `days` 解析、触发去重状态（无 tauri 依赖、
    无文件 IO 的判定部分可单测）。
  - `src-tauri/src/harness.rs` 及运行路径：为无人值守运行提供与交互会话分离的运行槽位，并让发送
    通道接受显式消息文本（不改写 composer 草稿）；装配与发送本身仍只有一份实现。
  - `src-tauri/src/lib.rs`：守护线程、三个拉取触发点（启动 / 焦点 / 目标 vault 打开成功）、通知
    投递与逐条通知的点击等待、运行交接事件与结果回执。
  - `src-tauri/src/commands.rs`：运行结果回执命令（前端把 session id 与成功 / 失败交回守护）。
  - `src-tauri/src/logging.rs`：`cron_notified` / `cron_click` / `cron_run_started` /
    `cron_run_finished` / `cron_run_skipped` / `cron_task_invalid` 六个事件名进白名单。
  - `src/main.ts`：`cron:run` 事件的唯一处理器——确保目标 vault 已打开、按会话形态建立 / 恢复
    会话、经既有发送通道送出 prompt、回执结果；不写第二套打开或发送实现。
  - `src-tauri/Cargo.toml`：`notify-rust`（4.18.2，三平台直连投递与点击等待；macOS 的 UN 后端由
    `preview-macos-un` 选择）与 `chrono`（本地时间换算，已在依赖树内）。
  - `src/bindings/**`：ts-rs 重导出（新增配置类型）。
  - `docs/specs/config-reference.md`：新增 `[cron]` 一节（键表、默认值、非法项口径、生效时机、
    状态文件位置）。
  - `scripts/acceptance/scenarios/`：新增真机验收场景（到点通知、点击发起运行、run-then-notify、
    静默运行、配置非法项丢弃 warning、当日去重）。
- **关联约束**：
  - ADR 0002 第 5 条（配置即数据 + schema 校验 + 非法值人话回落）：`[cron]` 按既有解析模型落地。
  - ADR 0002 第 6 条（性能合同）：守护在窗口就绪后启动、周期评估零文件 IO；冷启动 <300ms 不受影响。
  - ADR 0002 第 7 条（核心模块不耦合 tauri）：判定与状态读写无 tauri 依赖，副作用在 `lib.rs`
    接线层注入。
  - ADR 0003 第 3 条（永不改写源文件格式）：机制自身不写 vault；运行期写入经 harness 既有工具
    与权限闸，按既有编辑语义执行（该铁律管格式改写，不禁止用户意图内的正常编辑）。
  - harness 既有工具集的边界（`src-tauri/src/harness/tools.rs` 文件头「恰好 8 个」）：本 change
    不新增工具，「运行后打开文件」不在 v1 能力内（见裁决点 6）。
  - REVIEW.md「值或开关声明了却没有消费者」条：每个新配置键在 design §7.3 指明消费者。
  - AGENTS.md「变更默认直接切断」：本 change 不引入兼容层（无存量任务、无旧配置键）；
    `note-templates` 未落地即摘除，不存在迁移面。

## 节点 1 需裁决的设计取舍（逐条可否决）

1. **三档触达策略的默认档 = `notify-then-run`**（推荐）。理由：无人点头不花 token；到点先给人一次
   明确的「要不要让它跑」的意图确认。`run-then-notify` / `silent-run` 显式配置才启用。
2. **会话形态 v1 两档都交付，默认 `new`**（推荐）。`new` = 每次触发新会话，上下文互不污染；
   `dedicated` = 每任务一个专用会话，跨次续写（需要累积上下文的检查类任务用）。两档共用同一条
   运行路径，差别只是「session id 从哪来」。备选：v1 只留 `new`，`dedicated` 等出现真实需求再加
   ——代价是任务 schema 里的 `session` 字段暂时只有一个合法值，形同装饰。
3. **无人值守运行不切换用户当前 vault**（推荐）。harness 会话与「当前打开的 vault」绑定（`VaultState`
   单一当前 vault，`harness_send` 由它解析 scope）；`run-then-notify` / `silent-run` 到点时若目标
   vault 不是当前 vault，该次运行延后到当日下一次拉取触发（打开该 vault / 切前台），当日始终未打开
   则该日不运行并落诊断。备选一：自动切换 vault——会在用户正在别处打字时把界面抢走，不推荐。
   备选二：为未打开的 vault 建立后台运行会话（不经 UI 打开）——要把运行目标从「当前 vault」解耦，
   属结构性改动，建议不在 v1 做。
4. **通知正文通用化**（推荐）。标题 = 任务 id，正文只说「到点 / 已完成 / 运行失败」，不含 prompt
   摘要、文档内容、vault 路径。理由：通知出现在锁屏与通知中心，任务 prompt 可能含私密信息；需要
   自定义通知文案属于新的配置扩展，另立 change。
5. **模型覆盖按运行期解析**（推荐）。`model` 是可选模型 id，按运行时
   `[harness].providers.<provider>.models` 的声明解析；未声明时回落该 provider 默认模型并给一条
   warning，不丢任务。理由：provider 与模型清单本身可在配置里演化，装载期硬校验会与 harness
   配置的既有口径分叉。
6. **运行能准备内容，但不替用户开标签**（推荐）。harness 工具集恰好 8 个、没有「在编辑器里打开
   文件」这一类工具（`src-tauri/src/harness/tools.rs` 文件头钉死），因此「建好并打开」里的「打开」
   无法由 agent 完成。v1 口径：点击通知进入该次运行的会话，文件由用户从文件树打开。备选：新增第
   9 个工具（打开类）——那是对「工具集恰好 8 个」既有裁决的改动，须 Alex 另行裁决，不在本 change
   内静默扩张。
7. **机制不做「完成条件」**（推荐）。「今天的日记是否已经存在」这类条件由 prompt 在运行时判断，
   机制不引入 `condition` 字段。理由：条件表达式 DSL 会把声明式配置变成小型编程语言，违反
   ADR 0002 第 5 条；而运行时 agent 本来就有读文件与判断的能力。

以上 7 条均为设计取舍，Alex 有拒绝面；本 proposal 不自带未裁决的阻塞项。节点 1 通过前不进入实现。
