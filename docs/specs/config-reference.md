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

#### 1.1.1 pane 命令族的默认键位与冲突核对（M319）

change `pane-system-split-view` 分组 6.1（`src/keys.ts`）给三条 pane 命令配了出厂键位：
`⌥S` → `pane.split`、`⌥O` → `pane.other`、`⌥W` → `pane.close`（**Alex 节点 1 落槌**；命令本体
M316 已进表）。三条与其余表内绑定一样可经 `[keys]` 重绑 / 解绑（单段、无空白，形状合法）。
键位占用的**零冲突核对**按三条独立来源逐条结论如下（逐条来由另见键位表 doc D365–D367 与
`src/keys.ts` 文件头 M319 段，本节只做投影）：

| 来源 | 核对结论 |
|---|---|
| 表内（`src/keys.ts` 即真源） | ⌥ 系现占用 `Alt-KeyV` / `Alt-KeyD` / `Alt-KeyB` / `Alt-KeyF` / `Alt-KeyG` / `Alt-Backspace`；`⌥S` / `⌥O` / `⌥W` 零占用。注意 `⌘W` 归 `tab.close`，与 `⌥W` 是不同 token，互不干扰 |
| 原生菜单 accelerator | tauri `Menu::default()` 逐项来自 muda `items/predefined.rs`，其中**唯一的 ⌥ 系预置是 `HideOthers` = `⌥⌘H`**；本应用自建项里唯一带 accelerator 的是 `CmdOrCtrl+Q`（`src-tauri/src/lib.rs`）。菜单键等价只截获带 accelerator 的项（M149 对 `⌘W` 的实证）⇒ 三条裸 ⌥ 键会到达 webview 的 keydown |
| macOS 系统级 | 不给系统菜单预置裸 ⌥ 字母（Option 系预置都是 `⌥⌘` 组合，如 `⌥⌘Esc` / `⌥⌘D` / `⌥⌘H`）。真正会「抢」裸 ⌥ 字母的是文本输入系统的特殊字符层（US 布局 `⌥S` → ß / `⌥O` → ø / `⌥W` → ∑），它在本键位分发器的**下游**：命中绑定时 `preventDefault` 即挡住（同族先例 `Alt-KeyV` 的 `√` 已在真机跑过） |

token 形态注意：含 Alt 的组合按物理键 `KeyboardEvent.code` 判定（macOS 的 Alt 层替换字符，`e.key`
判不出用户按的键），表内写法因此是 `Alt-KeyS` 一族；用户经 `[keys]` 写 `Alt-s` 一类字符形态不会命中
（静默失配，机制见 `src/keys.ts` 的 `keyToken` 与文件头 M195 / M277 段）。

### 1.2 `[editor]` 表

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `editor.mode` | string 枚举 | `"md"` | `"md"` \| `"code"` | 启动装载读一次；只对**没有文件上下文**的文档（空态 / 新建）生效——打开文件一律按扩展名裁决 | `config.rs:101` |
| `editor.line_wrap` | boolean | `true` | `true` / `false` | 启动装载读一次（改配置需重启）；运行期由 `view.toggle-line-wrap`（前台是 md 会话时）瞬态翻转，**不回写** | `config.rs:108` |
| `editor.code_block_wrap` | boolean | `false` | `true` / `false` | 启动装载读一次（改配置需重启）；运行期由 `view.toggle-code-block-wrap` 瞬态翻转，**不回写** | `config.rs:112` |
| `editor.code_mode_line_wrap` | boolean | `false` | `true` / `false` | 启动装载读一次（改配置需重启）；运行期由 `view.toggle-line-wrap`（前台是 code 会话时）瞬态翻转，**不回写**（M247 新增） | `config.rs:124` |
| `editor.auto_indent` | boolean | `true` | `true` / `false` | 启动装载读一次（改配置需重启）；**无运行期开关**（M272 新增） | `config.rs:136` |
| `editor.font_family` | string \| null | `null`（沿用基线 `--font-sans`） | 任意 CSS `font-family` 值；**空串 / 纯空白**判为笔误 → 回落 `null` + warning | 启动装载读一次（本能力不做热重载，改字体需重启） | `config.rs:144` |
| `editor.mono_font_family` | string \| null | `null`（沿用基线 `--font-mono`） | 同 `font_family` | 同上 | `config.rs:147` |
| `editor.font_size` | number | `15` | 闭区间 `[12, 32]`，区间外回落 `15` + warning | 启动装载读一次；运行期由三条 `view.text-scale-*` 命令步进，**不回写** | `config.rs:155`、`:482-490` |

折行三键的分工（「一元素一条规则」，判定点在 `src/preview/theme.ts` 的 `wrapSpec`）：

| 键 | 作用对象 |
|---|---|
| `editor.line_wrap` | **md 模式**的正文行（围栏 / 缩进代码块不归它管） |
| `editor.code_block_wrap` | md live preview 里的围栏 / 缩进代码块行 |
| `editor.code_mode_line_wrap` | **code 模式**的正文行 |

出厂口径是「**md 折 / code 不折**」的**分叉**：`line_wrap` 默认 `true`、`code_mode_line_wrap` 默认
`false`。本键**不跟随** `line_wrap`——缺省值即上表的出厂 `false`，显式写 `true` 则把 code 模式也折起来。
两个模式的折行键互不改写：`line_wrap` 对 code 模式无可观测效果、`code_mode_line_wrap` 对 md 无可观测
效果（不是漏实现）。

`view.toggle-line-wrap` 翻的是**前台会话模式**对应的那一轴（md 会话 → `line_wrap`，code 会话 →
`code_mode_line_wrap`）：两个模式的正文行各有自己的键，命令按你眼前那个折行来翻。它只改运行期显示
口径，不改本文件的任何键。

`editor.auto_indent`（M272，change enter-auto-indent）不在折行三键的作用面内：它管**按 `Enter` 换行后
新行的缩进**，作用面是 code 模式与 md 的围栏 / 缩进代码块内（有缩进规则的语言取语法缩进，其余沿用光标
所在行的行首空白）。`false` 时这两处回到裸换行；**md 的列表项 / 引用续行不受本键影响**——那是编辑器
内核自带语言包的既有行为，关掉本键仍会续写标记（这是显式口径，不是漏实现）。本键没有运行期开关命令，
也不跟随任何别的键：键缺席 = 出厂 `true`。

字号的两项字体族只挡「空串 / 纯空白」，**值的 CSS 合法性由前端判定**（`CSS.supports`）——Rust 侧不复制
一份 CSS 语法知识，与 `keys` 表「形状在 Rust、语义在前端」的分层同口径。

### 1.3 `[ui]` 表

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `ui.theme` | string 枚举 | `"light"` | `"light"` \| `"dark"` \| `"eink"` | 启动装载施加一次（写 `documentElement.dataset.theme`）；运行期由 `view.theme-cycle` / modeline 主题钮切换，**切换即回写本键** | `config.rs:209` |
| `ui.content_width` | number | `760` | 闭区间 `[760, 1200]`，区间外回落 `760` + warning | 启动时装配一次；运行期由阅读栏拖拽推进，**松手回写本键** | `config.rs:216`、`:183-189` |
| `ui.markdown_line_numbers` | string 枚举 | `"on-demand"` | `"on-demand"` \| `"always"` \| `"off"`，档外回落 `"on-demand"` + warning | **仅启动装载时读一次**（喂给编辑器的 md 行号 gutter 档位）；**运行期不回写、无切换命令** | `config.rs:240`、`:275`、`:576` |
| `ui.language` | string 枚举 | `"en"` | `"en"` \| `"zh"`，档外回落 `"en"` + warning | 启动装载施加一次（写 `documentElement.lang`，文档与预览装饰按它取值）；运行期由 `view.language-cycle` / modeline 语言钮切换，**切换即回写本键** | `config.rs:248`、`:283`、`:600` |

`ui.language` 是**界面文案的语言档**（change ui-language-i18n，M282；默认 `en`，Alex 2026-09-27 节点 1 裁决）。
它只管**界面文案的取值列**：文档内容、frontmatter 值、文件名与路径、以及只进诊断日志 / 配置告警的文本
（`console.warn` 的句子、`ConfigSnapshot.warnings`、日志事件名 / 等级 / 字段名 / 集合值字段、`CommandError.code`）
都**不随它变**（后者的理由是诊断面向开发者、语言固定）。迁移后的文案取值入口是 `src/copy.ts` 的
`t(key, params?)`（表在 `src/copy-data.ts`，键 = `文案-Copy.md` 的 D 编号）；写回走通用合并写 IPC
（`config_set_ui_value("language", …)`），**写通道不校验取值**——手写非法值由下次启动的 `validate()`
兜（与 `ui.theme` 同款既有边界）。

`ui.markdown_line_numbers` 只管 **md 模式**的行号 gutter 在场时机：`on-demand`（默认）= 打开 md 文档时无行号，
按 `⌥G`（`editor.goto-line`）打开跳转输入条时行号出现、输入条收起后隐藏；`always` = md 常驻显示行号；
`off` = md 恒不显示。**code 模式的行号 gutter 恒常显，不读本键**。它没有运行期切换的落点，
因此是「装载时读一次、运行期 MUST NOT 回写」的瞬态口径（同 `editor.font_size` / `editor.mode`），
与上面两个**持久偏好**（主题 / 栏宽有切换落点、切换即回写）分属两类。

`ui` 的这几个键与 `editor.font_size` 的差别是**持久偏好 vs 瞬态口径**：主题与栏宽是用户显式选择的结果，
切换即回写（让下次启动的真源跟上运行态）；字号步进、折行翻转与 md 行号档位是瞬态显示口径，不落盘、
重启回到配置值。`ui` 是结构化表：表内取值非法 → 回落该字段 + warning；整表错形状（如 `"ui": "dark"`）或表内类型不符
（如 `"theme": 2`、`"markdown_line_numbers": 2`、`"language": 2`）走整文件回落（见 §2）。

## 2. 解析与容错口径

- **未知键忽略**：新版写入的字段旧版读取不报错（向前兼容）。未知键在应用回写时**原样保留**（见 §3）。
- **逐字段回落**：取值非法（如 `editor.mode` 写 `"weird"`、`log.level` 写 `"verbose"`、`font_size` 越界）
  只回退该字段到出厂默认 + 一条人话 warning，其余字段照常生效，**不得导致启动失败**（ADR 0002 §5）。
- **整文件回落**：整份文件不是合法 JSON，或**字段类型不符**（如 `"line_wrap": "yes"`、
  `"font_size": "15"`、`"code_mode_line_wrap": "yes"`、`"auto_indent": "yes"`、`"ui": "dark"`、
  `"markdown_line_numbers": 2`），
  则整份配置按出厂默认解释 +
  一条 warning（连 `last_vault` 一起丢）。这是既有解析模型的性质（不等同于逐字段回落），单测逐条钉住
  （`config.rs` 的 `wrong_type_*_falls_back_entire_file` 族）。本仓**不提供**「逐字段类型容忍」。
- **warning 出口**：console + 诊断日志的 `config_warning` 事件（无 UI 面）。

## 3. 写回纪律：合并写，不写全量默认

应用回写 `config.json` 时只做**单键合并**：读入整份 JSON → 改这一个键 → tmp 文件 + `rename` 原子替换
（`commands.rs:391-431`）。由此两条性质：

1. **未知键原样保留**——写通道不认识 `future_field` 也不会把它删掉；
2. **没写过的键始终缺席**，因此永远跟随出厂默认（而不是被钉死成写入当时的旧值）。

当前只有四个键会被回写：`last_vault`（打开成功）、`ui.theme`（主题切换）、`ui.content_width`（栏宽拖拽松手）、`ui.language`（语言切换）。
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
| `vault-registry/` | vault 注册表：`<vault-id>.json`，装 id ↔ path、治理标记、`last_opened_at` | **身份**（该 vault 是谁、在哪）；只归档不删除 |
| `vault-sessions/` | 标签会话：`<vault-id>.json`（`tabs` / `active` / `updated_at`） | **易变状态**（上次开着哪些标签） |
| `reading-positions/` | 阅读位置：`<vault-id>.json`（按文件路径记滚动位置） | **易变状态** |
| `logs/` | 诊断日志：`YYYY-MM-DD.jsonl`（UTC 日期，每行一个 JSON 事件） | 只落本地、不外发、不进 vault |

**为什么注册表与会话刻意分存**（同一 vault 实体的两个面，`vault_session.rs` 头注释 / change
`multi-vault-workspaces` design §2）：注册项文件是**身份**，它的读取路径对解析失败一律跳过——把易变的
界面状态混进身份文件，一次会话写坏就会升级成「vault 从列表与 remap 候选中消失」。会话单独落盘后，
损坏的最大后果只是「没有标签历史」。两个目录名对仗（注册表 / 会话）正是这条分存关系的表达。

**目录名的来历**（M248，backlog #37 落地）：本目录原叫 `workspaces/`，与「工作区状态」语义错位——
与 `vault-sessions/` 并置时容易被读成两个业务概念。现名 `vault-registry/` 让「同一 vault 实体的两个
面」（身份 / 会话）从名字可读。存量机器上的旧名目录由**启动时一次 `fs::rename`** 迁移：同目录同文件
系统、原子；新目录已存在则不动作（rename 到非空目录本就失败），失败则旧目录原地保留、下次启动重试；
迁移成功 / 被跳过 / 失败各记一条 `vault_registry_migrated` 诊断事件（稳态不记）。真源是
`src-tauri/src/vault_registry.rs` 的 `REGISTRY_DIR_NAME` 与 `migrate_legacy_registry_dir`。

**历史文档不改写**：change `multi-vault-workspaces` 等制品里出现的 `workspaces/` 按当时事实保留；
本节的现状描述以真源为准。
