# Lumir 配置参考（config.json）

- 状态：生效中的键值参考（M247 建立，backlog #36① 裁决：配置参考文档随 #35 同批落地）
- 真源：`src-tauri/src/config.rs`（每个键的**解析、取值校验与出厂默认**都在那里；本文档是它的可读投影，
  不是第二份真源——键值表里的行号指向真源，冲突时以 `config.rs` 为准）
- 范围：`config.json` 的全部键 + 配置目录布局 + 写回纪律。**不含**运行期瞬态状态（字号步进、折行翻转等
  不回写配置的运行期值，见各键的「生效时机」列）

> 用途：回答「有什么可配、默认是什么、改了什么时候生效」。应用内 `describe-config` 面板（照
> `describe-bindings` 的模式：每键当前生效值 / 出厂值 / 改法）是**另立项**的中期能力（backlog #36②），
> 本文档不依赖它。

## 1. 键值表

### 1.1 顶层

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `version` | number | `1` | 当前 schema 版本 `1`；更高值 → 一条 warning + 按 v1 解释 | 启动装载读一次；写回时按写入纪律补齐（见 §3） | `config.rs:63`、`validate()` |
| `last_vault` | string \| null | `null` | vault 绝对路径 | 启动时由 `restore_last_vault` 恢复；每次**打开 vault 成功**后回写 | `config.rs:72`、`commands.rs:380-389` |
| `keys` | 对象：键位 → 命令 id（字符串）\| `null`（解绑） | `{}` | 键位非空且**不含空白**（含空白即多段 chord，本版不支持）；命令 id 非空字符串 | 启动装载读一次，覆盖到位后重挂键位分发器 | `config.rs:79`、`validate_keys()` |
| `log.level` | string 枚举 | `"info"` | `"info"` \| `"off"` | 启动装载读一次（消费方 `logging.rs`，`off` 时事件丢弃不写盘） | `config.rs:245`、`validate_log()` |

`keys` 的键位写法与前端键位 token 同源：`"Cmd-s"`、`"Ctrl-Alt-Minus"`、`"ArrowUp"`；值是命令 id 或
`null`（解绑）。**命令 id 是否已知由前端键位层判定**——未知 id 形状合法即透传，前端装配期给 warning 并忽略
该条（单一来源是 `src/keys.ts` 的 `COMMAND_IDS`，Rust 侧不复制一份必然漂移的清单）。

### 1.2 `[editor]` 表

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `editor.mode` | string 枚举 | `"md"` | `"md"` \| `"code"` | 启动装载读一次；只对**没有文件上下文**的文档（空态 / 新建）生效——打开文件一律按扩展名裁决 | `config.rs:101` |
| `editor.line_wrap` | boolean | `true` | `true` / `false` | 启动装载读一次（改配置需重启）；运行期由 `view.toggle-line-wrap` 瞬态翻转，**不回写** | `config.rs:108` |
| `editor.code_block_wrap` | boolean | `false` | `true` / `false` | 同上 | `config.rs:112` |
| `editor.code_mode_line_wrap` | boolean | `false` | `true` / `false` | 同上（M247 新增） | `config.rs:124` |
| `editor.font_family` | string \| null | `null`（沿用基线 `--font-sans`） | 任意 CSS `font-family` 值；**空串 / 纯空白**判为笔误 → 回落 `null` + warning | 启动装载读一次（本能力不做热重载，改字体需重启） | `config.rs:132` |
| `editor.mono_font_family` | string \| null | `null`（沿用基线 `--font-mono`） | 同 `font_family` | 同上 | `config.rs:135` |
| `editor.font_size` | number | `15` | 闭区间 `[12, 32]`，区间外回落 `15` + warning | 启动装载读一次；运行期由三条 `view.text-scale-*` 命令步进，**不回写** | `config.rs:143`、`:170-175` |

折行三键的分工（「一元素一条规则」，判定点在 `src/preview/theme.ts` 的 `wrapSpec`）：

| 键 | 作用对象 |
|---|---|
| `editor.line_wrap` | **md 模式**的正文行（围栏 / 缩进代码块不归它管） |
| `editor.code_block_wrap` | md live preview 里的围栏 / 缩进代码块行 |
| `editor.code_mode_line_wrap` | **code 模式**的正文行 |

出厂口径是「**md 折 / code 不折**」的**分叉**：`line_wrap` 默认 `true`、`code_mode_line_wrap` 默认
`false`。本键**不跟随** `line_wrap`——缺省值即上表的出厂 `false`，显式写 `true` 则把 code 模式也折起来。
两键互不改写：`line_wrap` 对 code 模式无可观测效果、`code_mode_line_wrap` 对 md 无可观测效果（不是漏实现）。

字号的两项字体族只挡「空串 / 纯空白」，**值的 CSS 合法性由前端判定**（`CSS.supports`）——Rust 侧不复制
一份 CSS 语法知识，与 `keys` 表「形状在 Rust、语义在前端」的分层同口径。

### 1.3 `[ui]` 表

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `ui.theme` | string 枚举 | `"light"` | `"light"` \| `"dark"` \| `"eink"` | 启动装载施加一次（写 `documentElement.dataset.theme`）；运行期由 `view.theme-cycle` / modeline 主题钮切换，**切换即回写本键** | `config.rs:209` |
| `ui.content_width` | number | `760` | 闭区间 `[760, 1200]`，区间外回落 `760` + warning | 启动时装配一次；运行期由阅读栏拖拽推进，**松手回写本键** | `config.rs:216`、`:183-189` |

`ui` 的这两个键与 `editor.font_size` 的差别是**持久偏好 vs 瞬态口径**：主题与栏宽是用户显式选择的结果，
切换即回写（让下次启动的真源跟上运行态）；字号步进与折行翻转是瞬态显示口径，不落盘、重启回到配置值。
`ui` 是结构化表：表内取值非法 → 回落该字段 + warning；整表错形状（如 `"ui": "dark"`）或表内类型不符
（如 `"theme": 2`）走整文件回落（见 §2）。

## 2. 解析与容错口径

- **未知键忽略**：新版写入的字段旧版读取不报错（向前兼容）。未知键在应用回写时**原样保留**（见 §3）。
- **逐字段回落**：取值非法（如 `editor.mode` 写 `"weird"`、`log.level` 写 `"verbose"`、`font_size` 越界）
  只回退该字段到出厂默认 + 一条人话 warning，其余字段照常生效，**不得导致启动失败**（ADR 0002 §5）。
- **整文件回落**：整份文件不是合法 JSON，或**字段类型不符**（如 `"line_wrap": "yes"`、
  `"font_size": "15"`、`"code_mode_line_wrap": "yes"`、`"ui": "dark"`），则整份配置按出厂默认解释 +
  一条 warning（连 `last_vault` 一起丢）。这是既有解析模型的性质（不等同于逐字段回落），单测逐条钉住
  （`config.rs` 的 `wrong_type_*_falls_back_entire_file` 族）。本仓**不提供**「逐字段类型容忍」。
- **warning 出口**：console + 诊断日志的 `config_warning` 事件（无 UI 面）。

## 3. 写回纪律：合并写，不写全量默认

应用回写 `config.json` 时只做**单键合并**：读入整份 JSON → 改这一个键 → tmp 文件 + `rename` 原子替换
（`commands.rs:391-431`）。由此两条性质：

1. **未知键原样保留**——写通道不认识 `future_field` 也不会把它删掉；
2. **没写过的键始终缺席**，因此永远跟随出厂默认（而不是被钉死成写入当时的旧值）。

当前只有三个键会被回写：`last_vault`（打开成功）、`ui.theme`（主题切换）、`ui.content_width`（栏宽拖拽松手）。
`version` 由写通道补齐，纪律是「仅在缺失或不高于当前 schema 时写入」（高版本配置不降回）。

**不推荐**把全量默认写进 `config.json`（手写或让应用生成都不推荐）：那会把每个缺字段的「跟随出厂默认」
钉死成写入当时的取值——出厂默认日后一变，配置文件仍按旧值跑，且 `config.json` 从「用户手编的输入面」
退化成「应用状态存储」。要改某个键就只写那个键。

## 4. 配置目录布局

路径按 ADR 0002 §5：macOS / Linux 走 `$XDG_CONFIG_HOME`（默认 `~/.config/lumir`），Windows 走
`%APPDATA%\lumir`。目录内容：

| 路径 | 内容 | 性质 |
|---|---|---|
| `config.json` | 本文档 §1 的全部键 | 用户手编的输入面（「配置即数据」，ADR 0002 §5） |
| `workspaces/` | vault 注册表：`<vault-id>.json`，装 id ↔ path、治理标记、`last_opened_at` | **身份**（该 vault 是谁、在哪）；只归档不删除 |
| `vault-sessions/` | 标签会话：`<vault-id>.json`（`tabs` / `active` / `updated_at`） | **易变状态**（上次开着哪些标签） |
| `reading-positions/` | 阅读位置：`<vault-id>.json`（按文件路径记滚动位置） | **易变状态** |
| `logs/` | 诊断日志：`YYYY-MM-DD.jsonl`（UTC 日期，每行一个 JSON 事件） | 只落本地、不外发、不进 vault |

**为什么注册表与会话刻意分存**（同一 vault 实体的两个面，`vault_session.rs` 头注释 / change
`multi-vault-workspaces` design §2）：注册项文件是**身份**，它的读取路径对解析失败一律跳过——把易变的
界面状态混进身份文件，一次会话写坏就会升级成「vault 从列表与 remap 候选中消失」。会话单独落盘后，
损坏的最大后果只是「没有标签历史」。两个目录名对仗（注册表 / 会话）正是这条分存关系的表达。

> **前向注记（backlog #37，2026-09-26 Alex 裁决：改）**：`workspaces/` 这个名字与「工作区状态」语义错位
> （它与 `vault-sessions/` 并置时容易被读成两个业务概念），将更名为 **`vault-registry/`**。落地形态是
> 启动时一次性 `fs::rename`（同目录同文件系统，原子；新目录已存在则不动作）+ 一条诊断事件。本文档在
> 更名落地时同步更新本节——在那之前，真源（`workspaces.rs:68`）报出的仍是 `workspaces/`。
