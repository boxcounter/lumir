# Lumir 配置参考（config.json）

- 状态：生效中的键值参考（M247 建立；原 backlog 的「配置参考文档」条已核销落地、原文见 git 历史）
- 真源：`src-tauri/src/config.rs`（每个键的**解析、取值校验与出厂默认**都在那里；本文档是它的可读投影，
  不是第二份真源——键值表里的行号指向真源，冲突时以 `config.rs` 为准）
- 范围：`config.json` 的全部键 + 配置目录布局 + 写回纪律。**不含**运行期瞬态状态（字号步进、折行翻转等
  不回写配置的运行期值，见各键的「生效时机」列）

> 用途：回答「有什么可配、默认是什么、改了什么时候生效」。应用内 `describe-config` 面板（照
> `describe-bindings` 的模式：每键当前生效值 / 出厂值 / 改法）是**另立项**的中期能力（原 backlog 的
> 「配置参考文档 / describe-config 面板」条的第②项；去向记于 backlog「承接残项」的「describe-config 面板」条），
> 本文档不依赖它。

## 1. 键值表

### 1.1 顶层

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `version` | number | `1` | 当前 schema 版本 `1`；更高值 → 一条 warning + 按 v1 解释 | 启动装载读一次；写回时按写入纪律补齐（见 §3） | `config.rs:63`、`validate()` |
| `last_vault` | string \| null | `null` | vault 绝对路径 | 启动时由 `restore_last_vault` 恢复（`lib.rs:880`）；每次**打开 vault 成功**后回写（`commands.rs:731` 的 `remember_last_vault`） | `config.rs:149` |
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
| `ui.theme` | string 枚举 | `"light"` | `"light"` \| `"dark"` \| `"eink"` | 启动装载施加一次（写 `documentElement.dataset.theme`）；运行期由 `view.theme-cycle` / modeline 主题钮切换，**切换即回写本键** | `config.rs:428`、`:2139-2149` |
| `ui.content_width` | number | `760` | 闭区间 `[760, 1200]`，区间外回落 `760` + warning | 启动时装配一次；运行期由阅读栏拖拽推进，**松手回写本键** | `config.rs:435`、`:2152-2161` |
| `ui.sidebar_width` | number | `236` | 闭区间 `[180, 480]`，区间外回落 `236` + warning | 启动时装配一次；运行期由左栏分隔条拖拽推进，**松手回写本键**；窗口过窄时的「按窗口四成再钳」是显示口径（前端做、不落盘） | `config.rs:441`、`:2166-2175` |
| `ui.markdown_line_numbers` | string 枚举 | `"on-demand"` | `"on-demand"` \| `"always"` \| `"off"`，档外回落 `"on-demand"` + warning | **仅启动装载时读一次**（喂给编辑器的 md 行号 gutter 档位）；**运行期不回写、无切换命令** | `config.rs:447`、`:2180-2193` |
| `ui.language` | string 枚举 | `"en"` | `"en"` \| `"zh"`，档外回落 `"en"` + warning | 启动装载施加一次（写 `documentElement.lang`，文档与预览装饰按它取值）；运行期由 `view.language-cycle` / modeline 语言钮切换，**切换即回写本键** | `config.rs:454`、`:2195-2208` |

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
与上面几个**持久偏好**（主题 / 阅读栏宽 / 左栏宽 / 界面语言都有运行期落点，切换或拖拽松手即回写）分属两类。

`ui` 的这几个键与 `editor.font_size` 的差别是**持久偏好 vs 瞬态口径**：主题、阅读栏宽、左栏宽与界面语言
是用户显式选择的结果，切换 / 拖拽松手即回写（让下次启动的真源跟上运行态）；字号步进、折行翻转与 md 行号档位是瞬态显示口径，不落盘、
重启回到配置值。`ui` 是结构化表：表内取值非法 → 回落该字段 + warning；整表错形状（如 `"ui": "dark"`）或表内类型不符
（如 `"theme": 2`、`"markdown_line_numbers": 2`、`"language": 2`）走整文件回落（见 §2）。

### 1.4 `[vault]` 表

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `vault.rule_files` | string 数组 | `[".gitignore", ".git/info/exclude"]` | 每项是**vault 相对路径**（非空、非绝对路径、不含 `..`）；文件不存在静默跳过 | **vault 装载时**读一次；改动下次装载生效 | `config.rs` 的 `DEFAULT_RULE_FILES`、`validate_rule_files` |
| `vault.ignore` | 对象：名字 → `"hidden"` \| `"lazy"` | 14 名（见下） | 键是**单个名字**：不含 `/`、不是 `.` / `..`、不含 `* ? [ ] ! # \`、首尾无空白；值是闭集合 `"hidden"` / `"lazy"` | **vault 装载时**读一次；改动下次装载生效 | `config.rs` 的 `DEFAULT_IGNORE`、`validate_ignore_map` |

两个忽略档的语义（change `ignore-tiers-map`，档位语义承接 `ignore-tiers-config`）：

- `hidden` 命中 ⇒ 不可见：文件树没有这一行、不进 watch 事件流、不进链接 / 附件索引，子树不枚举。
- `lazy` 命中 ⇒ 惰性可见：树里有一行、可展开（展开时按需取一层）、不进索引，与用户规则（`.gitignore`）命中的条目同待遇。
- 判定顺序固定为 `hidden` → `lazy` → 用户规则 → 可见；**用户规则的取反（如 `!target/`）不能推翻两档**。
- **档位写在名字自己的值上**：一个名字只有一个档位（对象键唯一），没有「同名冲突」这个类别。`hidden` 比 `lazy` 更严格这层关系由判定链表达，配置面不需要再写一遍。
- **缺省即默认（粒度整图）**：`ignore` 键缺席（或缺整个 `[vault]` 节）⇒ 整图取代码内置默认；键存在（含 `{}`）⇒ 整图按配置解释。**不在图里的名字 ⇒ 该名字走用户规则 / 完全可见**（「第三档」，没有第三个键、也没有 `"visible"` 档位值）。
- 只接受**名字**，不接受模式：写 `"*.log": "lazy"` 一类逐项忽略并给人话 warning。
- 保存临时文件模式（`.lumir-*` / `.*.lumir-*`）**恒定硬编码、不在配置面内**（那是数据损坏面）。
- 默认地图（`hidden` 2 名 + `lazy` 12 名；`test-results` / `perf-results` 于 2026-10-18 从默认表移除，change `trim-ignore-default-names`）：

  | 档位 | 名字 |
  |---|---|
  | `hidden` | `.git`、`.DS_Store` |
  | `lazy` | `node_modules`、`.venv`、`venv`、`__pycache__`、`.next`、`.nuxt`、`.cache`、`.pnpm-store`、`.tox`、`.gradle`、`target`、`dist` |

示例：

```json
{
  "vault": {
    "ignore": {
      ".git": "hidden",
      ".DS_Store": "hidden",
      "node_modules": "lazy",
      "target": "lazy"
    }
  }
}
```

换档 = 改这个名字自己的值（如 `"target": "hidden"`）；移出地图 = 完全可见。

**逐项校验的例外**（与 `harness.permissions` 同形）：地图里的非法项（名字非法 / 档位值不是 `"hidden"` 或 `"lazy"`）只丢自己并各给一条人话 warning，其余项照常生效，MUST NOT 因为一项笔误把整份配置（含 `last_vault`）回退默认。整个 `ignore` 键给错类型（如 `"ignore": "hidden"`、`"ignore": []`）仍走 §2 的整文件回落。JSON 对象的重复键由解析库按「后者覆盖」处理、不告警（一个名字不可能真的有两个档位）。

### 1.5 `[harness]` 表

本表收录**改变客户端 wire / 模型装配行为**的键；`[harness]` 的其余键（`permissions` /
`permission_mode` / `loop_max` / `warn_ctx_pct` / `auto_compact` / `subagents`）的规格归
[openspec/specs/harness/spec.md](../../openspec/specs/harness/spec.md) 的「配置节 [harness]」条
（change `add-harness-chat-completions-dialect` 起生效），本文档不复制第二份真源。provider 映射与
两个命名表在本节给出**字段面**（取值与非法处置）；行为真源（回退顺序、生效模型解析、命名资格闸）
仍以上述 spec 为准。

#### 1.5.1 `harness.providers` 表（provider 映射）

`providers` 是**以 provider id 为键的动态映射**：没有内置条目、没有数量上限，`kimi` / `deepseek`
这类 id 只是用户起名（change `add-model-automation-settings-oct24`；旧的三档固定结构 `kimi` /
`deepseek` / `mock` 已删除，旧配置由一次性迁移补 `preset`，见本节末）。

| 键 | 类型 | 默认 | 取值范围 / 非法处置 | 真源 |
|---|---|---|---|---|
| `providers.<id>` | 对象 | 无（映射项本身可选） | `<id>` 须匹配 `^[a-z0-9][a-z0-9_-]{0,31}$`；`mock` 是验收专用**保留 id** | `config.rs` 的 `provider_id_valid` / `RESERVED_PROVIDER_ID` |
| `.preset` | string 枚举 | 缺键按 `generic` 处理 + warning | `kimi` \| `deepseek` \| `generic` \| `mock`；闭集合外 / 非字符串 ⇒ **丢该条目** + warning；`mock` 预设只允许 id 为 `mock` | `ProviderPreset`、`validate_provider_entry` |
| `.api_key` | string | `""` | `kimi` / `deepseek` 空白 = 未配置；`generic` 可空（不发 `Authorization` 头）；mock 不经过 HTTP | `derive_configured` |
| `.models` | 数组 | `[]` | 逐项模型声明，元素 schema 见 harness spec 的「模型清单声明」条；坏项只丢自己，非数组 ⇒ 丢该条目 + warning | `validate_harness_model_specs` |
| `.model` | string | 缺省 = 清单首项 | 生效模型。不在 `.models` 内时**保留该值**、窗口按 131072 保守估算、effort / vision 按不支持 + warning；空串按缺省处理 | `model_specs` / `context_window` |
| `.base_url` | string | 预设官方地址 | 覆盖预设地址；`generic` 没有官方地址，填了 Key 或模型却没写它 ⇒ 装载 warning、`configured = false` | `official_base_url` |
| `.wire_api` | string 枚举 | 随预设（见下表） | `responses` \| `chat_completions`；该预设不支持的档位回落缺省 + warning | `WireApi`、`supports_wire_api` |
| `.fixture` | string | 无 | 仅 `mock` 预设消费（fixture 脚本路径）；其余预设该键无效 | `HarnessProviderConfig` |
| 未知子键 | — | — | 装载期忽略；经设置面板保存时**原样保留**（模型项按 `id` 匹配保留），MUST NOT 被静默删除 | `settings.rs` |

预设是条目行为的**唯一**依据（`preset` 决定 Base URL、是否要求 Key、`store:false`、wire 档位；
MUST NOT 按 id 字面量推断——id 叫 `kimi` 不构成任何协议保证）。同一预设可被多个条目复用
（工作 / 个人两把 Key 各建一条）。

| 预设 | 官方 Base URL | 要求 Key | 缺省 wire | 支持 wire | `store:false` | `configured` 判据（派生、不落盘） |
|---|---|---|---|---|---|---|
| `kimi` | `https://api.moonshot.cn/v1` | 是 | `responses` | 两档 | 发 | Key 去空白非空 且 清单非空 |
| `deepseek` | `https://api.deepseek.com` | 是 | `responses` | 仅 `responses`（chat 档 v1 未实现） | 不发 | 同上 |
| `generic` | 无（须自填 `base_url`） | 否 | `chat_completions` | 两档 | 不发 | 清单非空 且 `base_url` 非空 |
| `mock` | 无 | 否 | `responses`（不消费 wire） | 仅 `responses` | 不发 | `fixture` 非空 |

`wire_api` 选择该 provider 的 wire 方言：`responses` = `POST {base_url}/responses`；
`chat_completions` = `POST {base_url}/chat/completions`。缺省随预设（上表），未写该键不告警；
闭集合外取值或该预设不支持的档位（deepseek / mock 配 `chat_completions`）回落预设缺省 + 一条人话
warning；类型不符 ⇒ 丢该条目 + warning。会话留存的首行 `session_open.wire_api` 记录当次实际方言
（缺省值同样在场）；恢复旧会话（无该键）按 `responses` 解释。历史项不随方言改写——items → chat
messages 的翻译发生在发送边界，因此改配置后恢复续聊即可切到 chat 方言（回退 = 删掉该键，见 change
`add-harness-chat-completions-dialect`）。

**当前使用项**（`harness.provider`，provider id 字符串，键可省）：显式值合法且在映射内 ⇒ 用它
（即使 `configured = false`，不替用户改选）；缺省 ⇒ 按预设顺序 `kimi` → `deepseek` → `generic`
（同组内按 id 字典序）取第一个 `configured` 的**非 mock** 条目，没有则取第一个合法非 mock 条目；
映射为空（或只剩 mock）⇒ 无当前使用项；悬空值 ⇒ 按缺省规则回退 + 一条点名 warning。`mock` MUST
NOT 被缺省回退自动选中。`configured` 决定模型 chip 的可选 provider 列表（只列 configured 的条目
加当前项，mock 恒不上列表）。

**逐条宽容**：单个条目不是对象 / id 非法 / 预设非法 / 字段类型不符 ⇒ **只丢该条目** + 点名
warning，其余条目与整份配置照常生效（与 `vault.ignore` 地图、`permissions.allow` 清单同族的逐项
口径；不同于 §2 的整文件回落）。

**一次性迁移**：旧格式（无 `preset`）的 `kimi` / `deepseek` / `mock` 条目在装载时按 id 补上对应
预设——显式 `preset` 不覆盖、未知 id 不迁移、幂等；与退役 model 迁移合并为**同一次原子写**，写
失败只给 warning、内存值仍生效。

### 1.6 `harness.attachment_naming` 表（图片语义命名）

图片语义命名的开关与模型选择（change `add-semantic-image-naming`，规范正文见
[openspec/specs/clipboard-image-paste/spec.md](../../openspec/specs/clipboard-image-paste/spec.md)
的「图片语义命名与异步重命名」条）。**位置在 `[harness]` 表内**（2026-10-18 配置面重塑：原顶层
`[attachments]` 表已废除，旧键按未知键口径静默忽略、无兼容读取——单用户、未发布）。

**布局判据**（Alex 2026-10-18 裁决）：**配置跟随资源域**——自动 LLM 行为的开关与模型选择归
`[harness]` 域（`providers` 所在）；触发位置是 UI 事实，不是配置域。粘贴只是触发点，命名调用的
本质是「一次自动 LLM 行为」，因此与会话自动命名（§1.7 的 `harness.session_naming`）同域、
同解析口径（五字段同出一个 provider 条目，MUST NOT 混用）。

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `harness.attachment_naming.enabled` | boolean | `true` | `true` / `false` | **关 → 开：需重启**（前端投递闸取启动装载值，关着时前端根本不投递任务）；**开 → 关：立即生效**（后端命令每次调用现场 `config::load()`，读到 `false` 即跳过）。方向不对称是隐私面的有意取舍——关是更严的方向 | `config.rs` 的 `AttachmentNamingConfig`、`validate_attachment_naming` |
| `harness.attachment_naming.provider` | string \| null | `null` | `providers` 表内的任意 provider id（须非 `mock`）；`null` = 会话当前 provider | 后端每次命名现场读一次 ⇒ 改动**下一次粘贴即生效**；id 不在映射内（含条目被装载期忽略）⇒ 装载期回落 `null` + 人话 warning | `config.rs` 的 `HarnessConfig::attachment_naming_target` |
| `harness.attachment_naming.model` | string \| null | `null` | 非空字符串，且必须是**选定 provider** 的 `harness.providers.<id>.models` 清单内声明 `vision: true` 的 id；`null` = 该 provider 的生效模型 | 同上（下一次粘贴生效）；运行期切 provider 后，发起命名时按**当时选定**的 provider 重新核对 | 同上 |

口径：

- **缺省即默认**：整表缺席 / 单键缺席 = 出厂值；`model: null` 与缺席同义。表内类型不符
  （`"enabled": "yes"`、`"model": 3`、整表写成字符串）走整文件回落（与 `[harness]` 其余字段同路）。
- **悬空 `provider` 回落缺省**：id 不在 `providers` 表内（含被装载期忽略的条目）⇒ 回落 `null`
  （= 会话当前 provider）+ 一条人话 warning。
- **非法 `model` 只点名、不回落**：未在清单内 / 未声明 `vision` / mock provider 下的非空值 ⇒ 装载期
  一条点名 warning，**值原样保留**；随后资格不通过 ⇒ **不发起命名、保留暂存名**。MUST NOT 静默换成
  该 provider 的生效模型——那等于替用户选模型。空串按「未配置」归一为 `null` + warning。
- **无可用 vision 模型 = 命名不生效**：`model = null` 时用选定 provider 的生效模型；该模型未声明
  `vision: true`（或清单为空）时**不发起任何模型请求**，图片保持暂存名 `pasted-<hash16>.<ext>`，
  不弹失败 toast。mock provider 恒支持 vision（fixture 驱动档），但其没有模型维度 ⇒ `model` 只能是
  `null`（非空即资格不通过）。
- **隐私面**：默认开意味着每次粘贴**新图**都会把图片字节与粘贴时刻光标前后各至多 500 字的笔记正文
  发往配置的模型 provider（proposal「隐私面」，Alex 2026-10-18 显式接受）。不配置 vision 模型、或把
  `enabled` 关掉即完全不发。
- **不在本表内的**：命名形态（`<slug>-<hash6>.<ext>`）、slug 字符集（纯 ASCII kebab-case）、撤销窗口、
  扫描范围——这些是行为，不是偏好。

### 1.7 `harness.session_naming` 表（会话自动命名）

会话自动命名的开关与模型选择（change `add-session-auto-naming`；规范正文见
[openspec/specs/harness/spec.md](../../openspec/specs/harness/spec.md) 的「会话自动命名」条，
该条随 change 归档后进 living spec）。**位置在 `[harness]` 表内**（2026-10-18 配置面重塑：原
`auto_title` / `title_provider` / `providers.<id>.title_model` 三处旧键已废除，按未知键口径静默
忽略、无兼容读取——单用户、未发布）。

**布局判据**（Alex 2026-10-18 裁决，与 §1.6 共用同一条）：**配置跟随资源域**——自动 LLM 行为的
开关与模型选择归 `[harness]` 域（`providers` 所在）；触发位置（一轮对话结束）是 UI 事实，不是
配置域。与会话附件命名（§1.6）并排同构。

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `harness.session_naming.enabled` | boolean | `true` | `true` / `false` | 每次轮完成点触发判定时读一次；结果落盘前**重读**，在途期间关掉即丢弃（不写记录、不改标题） | `config.rs` 的 `SessionNamingConfig`、`validate_session_naming` |
| `harness.session_naming.provider` | string \| null | `null` | `providers` 表内的任意 provider id（须非 `mock`）；`null` = 会话当前 provider | 每次评估取配置快照 ⇒ 改动**下一次评估**生效；id 不在映射内（含条目被装载期忽略）⇒ 装载期回落 `null` + 人话 warning | `config.rs` 的 `HarnessConfig::title_target` |
| `harness.session_naming.model` | string \| null | `null` | 非空字符串，且须在**选定 provider** 的 `harness.providers.<id>.models` 清单内声明；`null` = 该 provider 的生效模型 | 同上 | 同上 |

口径：

- **缺省即默认**：整表缺席 / 单键缺席 = 出厂值；`model: null` 与缺席同义。表内类型不符
  （`"enabled": "yes"`、`"model": 3`、整表写成字符串）走整文件回落（与 `[harness]` 其余字段同路）。
- **悬空 `provider` 回落缺省**：id 不在 `providers` 表内（含被装载期忽略的条目）⇒ 回落 `null`
  （= 会话当前 provider）+ 一条人话 warning。
- **非法 `model` 回落生效模型**：未在选定 provider 的清单内 ⇒ 回落 `null`（= 该 provider 的生效
  模型）+ 一条人话 warning；空串按「未配置」归一为 `null` + warning。这一点与 §1.6 的
  `attachment_naming.model`（只点名、值原样保留）**不同且有理由**：附件命名有资格闸（vision
  能力不满足即不发起、保留暂存名），回落等于替用户选模型；会话命名没有资格闸，选错模型只会让
  这次调用失败，回落生效模型是唯一可执行的诚实解。
- **mock provider**：fixture 驱动档，没有模型清单 ⇒ `model` 只能是 `null`（非空值装载期归一为
  `null` + warning）；命名调用走 fixture 的 `titles` 队列，留存 `model` 字段记录为空串（不伪造
  模型 id）。
- **隐私面**：默认（`provider: null`）素材发往会话当前 provider，不引入新的数据接收方；显式指向
  另一个 provider 时素材会发给该服务方——这是配置者的显式选择，素材仍只是会话内容的受限子集
  （首轮 + 最近两轮问答、剔除工具参数与结果 / 图片 / 思考文本 / 注入上下文，整份上限 3000 码点）。
- **不在本表内的**：评估节奏（首轮 / 5 轮周期 / 漂移信号 / 3 轮下限）、keep 防抖、标题规范化、
  留存记录形状——这些是行为，不是偏好。

### 1.8 `[cron]` 表（定时任务）

通用定时任务机制（change `add-cron-runtime-daemon`；语义真源是该 change 的
[design §7](../../openspec/changes/add-cron-runtime-daemon/design.md)，规范正文见
[specs/cron/spec.md](../../openspec/changes/add-cron-runtime-daemon/specs/cron/spec.md)）。
任务只声明「调度 + 自然语言 prompt + 会话形态 + 触达策略 + 可选模型覆盖」——**机制不认识任务
要做什么**：写哪个文件、路径怎么拼、完成条件是什么，全部由 `prompt` 与目标 vault 的 `AGENTS.md`
表达（agent 按既有装配读到那份约定）。

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `cron.tasks` | 数组（每项为对象） | `[]` | 见下表；`[]` = 守护空转、零报错 | **启动装载读一次**；运行期只经**显式注册通道**重载（agent 工具写完配置后投工作项，见 §1.8.1）；**不监听文件**——手改本文件不单独触发重读，其内容最迟在下一次启动或下一次注册通道重载时被吸收 | `config.rs` 的 `CronConfig`、`validate_cron` |

任务项的字段（`{id, vault, at, days?, prompt, delivery?, session?, model?}`）：

| 字段 | 类型 | 默认 | 取值范围 | 非法处置 | 真源 |
|---|---|---|---|---|---|
| `id` | string | 必填 | 非空、不含空白 | 丢该项 + warning；**重复 id 保留首项**、丢后项 + warning | `validate_cron` |
| `vault` | string | 必填 | 绝对路径 | 丢该项 + warning（**路径是否存在不在装载期判定**：装载期 stat 会拖慢启动，且外置盘可能后挂载） | 同上 |
| `at` | string | 必填 | `HH:MM`（`00:00`–`23:59`，两位时分） | 丢该项 + warning | `cron::parse_at` |
| `days` | string 数组 | 全周（七项） | `mon` / `tue` / `wed` / `thu` / `fri` / `sat` / `sun` 的非空数组 | 含非法值 / 空数组 / 非数组 → 丢该项 + warning | `cron::parse_weekday` |
| `prompt` | string | 必填 | trim 后非空 | 缺失 / 空白 / 非字符串 → 丢该项 + warning（没有载荷的任务无从运行） | `validate_cron` |
| `delivery` | string 枚举 | `"notify-then-run"` | `"notify-then-run"` \| `"run-then-notify"` \| `"silent-run"` | 闭集合外取值 → **保留任务**、回落缺省 + warning（向「不花 token」的保守方向回落） | `config.rs` 的 `DeliveryPolicy` |
| `session` | string 枚举 | `"new"` | `"new"` \| `"dedicated"` | 闭集合外取值 → **保留任务**、回落 `new` + warning | `config.rs` 的 `SessionShape` |
| `model` | string | 缺席 | 非空字符串 | 形状非法 → **只丢该键**、保留任务 + warning；运行期未在 `[harness].providers.<provider>.models` 声明 → 本次回落 provider 默认模型 + `config_warning`，任务不丢 | `validate_cron` + harness 运行时 |
| 未知字段 | — | — | — | 静默忽略（既有向前兼容口径） | `RawCronConfig` |

口径：

- **一项任务只报第一处问题**：致命项按 `id` → `vault` → `at` → `days` → `prompt` 的顺序判，
  命中即丢弃该任务并给一条人话 warning；`delivery` / `session` / `model` 是非致命项，回落或
  丢键后任务照常生效。其余任务不受影响（ADR 0002 §5：非法配置不导致启动失败）。
- **整节错形状 / `tasks` 非数组**（如 `"cron": "daily-log"`、`"tasks": "daily-log"`）走 §2 的
  **整文件回落**（既有解析模型，不发明逐字段类型容忍）。
- **`days` 缺省展开成全周**：生效配置里 `days` 恒为非空数组——不存在「空数组 = 全周」的二义形态
  （空数组在装载期判非法）。
- **判定口径**（[`cron.rs`](../../src-tauri/src/cron.rs)）：本地日期属于 `days`、本地时钟**越过**
  `at`（不要求恰好等于）、且该任务当日尚未触发 ⇒ 触发一次；同一本地日期至多一次。判据不读
  文件系统、不写盘。
- **三档触达策略**：`notify-then-run` 到点只投通知，点击通知才发起运行（点击即意图，无人点头
  不花 token，默认档）；`run-then-notify` 到点静默运行、终态后投结果通知；`silent-run` 静默运行、
  全程不通知。三档共用同一条运行实现。
- **通知文案通用**：标题 = 任务 `id`，正文只说「到点 / 已完成 / 运行失败」，**不含 prompt、
  文档内容或绝对路径**（通知出现在锁屏与通知中心）。
- **应用未运行 = 无触达**：不装系统级守护（launchd / 登录项 / 系统 cron）；应用启动就绪、主窗口
  获得焦点、目标 vault 打开成功后各补判一次（同一判定函数）。跨日不补发。
- **任务量假设**：每 tick 对每条任务做一次纯内存判定，几十条以内无感。

示例（`vault` 为绝对路径的占位；真实路径不入库）：

```json
{
  "cron": {
    "tasks": [
      {
        "id": "nightly-review",
        "vault": "<vault-abs-path>",
        "at": "21:00",
        "prompt": "按本 vault 的 AGENTS.md 约定做当天的例行检查，完成后用一句话给出结论。",
        "delivery": "notify-then-run",
        "session": "new"
      },
      {
        "id": "weekly-consistency",
        "vault": "<vault-abs-path>",
        "at": "10:00",
        "days": ["sun"],
        "prompt": "检查指定文档之间互相引用的标题是否与目标文档的实际标题一致；把不一致项列成清单，不要直接改文件。",
        "delivery": "run-then-notify",
        "model": "<declared-model-id>"
      }
    ]
  }
}
```

#### 1.8.1 对话式注册（agent 调度工具）

交互会话里的 agent 有三件调度工具（change `add-cron-conversational-registration`；语义真源是该
change 的 [specs/cron/spec.md](../../openspec/changes/add-cron-conversational-registration/specs/cron/spec.md)）。
它们写的就是上面这张 `[cron].tasks` 表——**配置始终是任务的唯一真源**，工具没有第二份任务表。

| 工具 | 参数 | 缺省 | 模式档（`read_only` / `vault_write` / `full_access`） |
|---|---|---|---|
| `cron_task_list` | 无 | — | 放行 / 放行 / 放行 |
| `cron_task_create` | `id`、`at`、`prompt`（必填），`days`、`vault`、`delivery`、`session`、`model`（可选） | 同下表配置缺省；`vault` 缺省 = 当前 vault 根（落绝对路径） | 问 / 问 / 放行 |
| `cron_task_remove` | `id` | — | 问 / 问 / 放行 |

口径：

- **校验同源**：`create` 的字段校验与装载期是同一个实现、同一句原因文案；非法时**拒绝写入**并回执
  `cron_task_invalid`（带 `field`）。`id` 重名回执 `cron_task_exists`（不覆盖、不静默丢弃）；唯一性
  判据是文件里出现的全部 `id`（含装载期被丢弃的非法项）。`remove` 的目标不存在回执
  `cron_task_not_found`。
- **即时生效**：写入后守护线程重读配置并替换任务集，仍在运行的应用无需重启。回执的 `effect` 为
  `active` 才算已生效；`pending_restart` 表示配置已写入但运行时未确认（线程未运行 / 回执超时），
  下次启动生效。
- **注册时已过点则当日不补触发**：注册时刻**已过点**（本地日期属于 `days` 且当前时刻 ≥ `at`）的新任务，当日
  不派发——去重状态写当日种子（`last_fired` = 注册当日本地日期，语义见 §4）。注册时刻未到点的任务
  当日照常触发。回执的 `skip_today` 即该判定结果。启动装载引入的任务**不**写种子（启动补触发是
  既有语义）。
- **只写给出的键**：`create` 不把缺省值写进配置（缺省档跟随出厂默认，见 §3）；`vault` 例外——
  缺省时填当前 vault 根并落成绝对路径（运行坐标无法在运行期重新推导）。
- **工具不写状态文件**：`cron-state.json` 只有守护线程一个写者；`list` 只读（缺失 / 损坏时
  `last_fired` 为空，不报错）。

### 1.9 `harness.subagents` 表（子代理运行）

子代理运行的开关与预算上限（change `add-harness-subagents` design §14；行为语义真源是该
change 的 [design §9](../../openspec/changes/add-harness-subagents/design.md)，定义文件格式见
[subagent-definitions.md](subagent-definitions.md)）。**位置在 `[harness]` 表内**（与会话 / 附件
自动命名同域：自动 LLM 行为的开关与上限归 `harness`）。

| 键 | 类型 | 默认 | 取值范围 | 生效时机 | 真源 |
|---|---|---|---|---|---|
| `harness.subagents.enabled` | boolean | `true` | `true` / `false` | 每次发送时由命令入口重读配置（中枢每回合同步）⇒ 改动**下一个回合**生效，不需要重启：`false` 时 `task` 工具不注册、面板任务区不出现，定义与内建 `explore` 保留（关掉可随时打开，不需要删定义） | `config.rs` 的 `SubagentsConfig`、`validate_subagents` |
| `harness.subagents.max_turns` | number | `20` | 闭区间 `[1, 64]` | 同上；既是定义未写 `max_turns` 时的缺省预算，也是定义值的上限（冲突取小） | 同上 |
| `harness.subagents.max_tokens` | number | `200000` | 闭区间 `[1, 10000000]` | 同上（token 闸） | 同上 |
| `harness.subagents.timeout_secs` | number | `300` | 闭区间 `[1, 3600]` | 同上（时间闸；批准等待顺延，不计入） | 同上 |
| `harness.subagents.max_subruns_per_turn` | number | `8` | 闭区间 `[1, 64]` | 同上；父回合委派段数上限（前台 + 后台；只计实际执行的段，被拒调用不占额度） | 同上 |
| `harness.subagents.max_concurrent` | number | `4` | 闭区间 `[1, 16]` | 同上；会话级同时运行的子运行数上限，也是 provider 请求闸的许可数（`+1` 给父往返）——**并发不是预算**，不参与任何定义夹取 | 同上 |

口径：

- **缺省即默认**：整节缺席 / 单键缺席 = 出厂值、不告警。数值越界**夹取到最近边界 + warning**
  （上限类旋钮贴着用户意图走：回落默认会把「想放宽到 100 轮」静默变成 20 轮，与 `[harness]`
  其余数值键的「回落默认」不同）。
- **类型不符整节回落**：`"subagents": "on"`、`"max_turns": "20"` 这类形状错误 ⇒ 整节回落为
  出厂值 + 一条 warning，**不拖垮其余 `[harness]` 节**（这是 §2「整文件回落」的例外之一，
  与会话 / 附件命名同路）。
- **定义值夹取**：定义文件的 `max_turns` / `max_tokens` / `timeout_secs` 是用户意图，本表是
  用户设定的上限，冲突取小并给一条点名 warning（定义里的值原样留在错误信息里，便于改定义）。
  `max_concurrent` 不参与夹取。
- **子运行用量按模型分桶，且不进父会话的 `ctx%` / cache%**（design §9.1）：每组
  `(input / cached / writes / output / samples / segments)` 记在实际使用的模型 id 桶下，同一
  模型多段相加；父会话的控制行读数只由父自己的往返计算——跨模型混算的百分比没有解释力。
- **回合级最坏 token 消耗**：一个父回合最多发起 `max_subruns_per_turn` 段，每段至多
  `max_tokens`，因此**单回合**的子运行用量上界是 `max_subruns_per_turn × max_tokens`
  （不含父会话自己的往返；实际还受各段 `max_turns` / `timeout_secs` 与 provider 配额约束）。

**两个不是配置键的常量**（design §12.6.3 / §14 末段：安全绳不是策略旋钮）——它们不读
`config.json`、不出现在 `SubagentsConfig` 里，真源在 `harness/scheduler.rs`：

| 常量 | 值 | 语义 |
|---|---|---|
| `AUTO_WAKE_CHAIN_MAX` | `5` | 自动回合链上限：链内自动回合至多 5 个，第 6 条后台结果只上屏通知、不起回合（`wake=blocked_chain`）；用户发言 / 面板「继续」/ 会话重置后链清零 |
| `AUTO_WAKE_COALESCE_MS` | `2000` | 空闲时的通知合并窗口：首条完成通知起算 2000ms 内的同一批结果合并成一个自动回合（窗口不顺延） |

**无人注视下的消耗上界**：自动回合链最多 5 个，每个自动回合内又至多
`max_subruns_per_turn × max_tokens` 的子运行用量，因此后台派发在用户离开时可以触发的上界是
`AUTO_WAKE_CHAIN_MAX × max_subruns_per_turn × max_tokens`，**另加**每个自动回合自身往返的
上下文用量（成功摘要会把父会话上下文再发一次，量级取决于当时上下文，不在这条乘法里）。
`enabled=false` 是唯一能把它归零的开关。

## 2. 解析与容错口径

- **未知键忽略**：新版写入的字段旧版读取不报错（向前兼容）。未知键在应用回写时**原样保留**（见 §3）。
- **逐字段回落**：取值非法（如 `editor.mode` 写 `"weird"`、`log.level` 写 `"verbose"`、`font_size` 越界）
  只回退该字段到出厂默认 + 一条人话 warning，其余字段照常生效，**不得导致启动失败**（ADR 0002 §5）。
- **整文件回落**：整份文件不是合法 JSON，或**字段类型不符**（如 `"line_wrap": "yes"`、
  `"font_size": "15"`、`"code_mode_line_wrap": "yes"`、`"auto_indent": "yes"`、`"ui": "dark"`、
  `"markdown_line_numbers": 2`、`"cron": "daily-log"`、`"cron": {"tasks": "daily-log"}`），
  则整份配置按出厂默认解释 +
  一条 warning（连 `last_vault` 一起丢）。这是既有解析模型的性质（不等同于逐字段回落），单测逐条钉住
  （`config.rs` 的 `wrong_type_*_falls_back_entire_file` 族）。本仓**不提供**「逐字段类型容忍」。
  `[cron]` 的 `tasks` **表内**元素是逐项校验的例外：坏一项只丢那一项（见 §1.8）。
  `harness.providers` 的**条目**同理逐条校验：坏条目只丢自己 + 一条点名 warning，其余条目照常
  生效（见 §1.5.1）。
  `harness.subagents` 是**整节回落**的例外：该节类型不符只把它自己回落为出厂值 + warning，
  其余 `[harness]` 键照常生效（见 §1.9）。注意这**不同于** §1.6 / §1.7 的命名表——那两节
  沿用本条的整文件回落口径。
- **warning 出口**：console + 诊断日志的 `config_warning` 事件（无 UI 面）。

## 3. 写回纪律：合并写，不写全量默认

应用回写 `config.json` 有两类通道，共同点是**只改本次涉及的键**、以同目录 tmp 文件 + `rename`
原子替换：

1. **单键合并**（运行期写回）：读入整份 JSON → 改这一个键 → 原子替换。表级入口是
   `commands.rs:598` 的 `write_last_vault_to` 与 `:660` 的 `write_config_value_to`（支持点分嵌套键，
   如 `providers.<id>.model`）；落盘实现是 `config.rs:2300` 的 `write_json_atomic` 与 `:2332` 的
   `update_json_atomic`——后者的读、改、写在同一把进程内写锁内完成，不存在「读发生在取锁之前」的
   丢更新窗口。
2. **设置面板整笔 patch**（命令 `settings_apply` → `settings.rs:1758` 的 `apply_at`）：一笔 patch 可
   同时改 provider 条目、`harness.provider`、自动化开关与两个命名目标，整段在读—改—写同一把锁内
   完成，落盘走 `config.rs:2361` 的 `update_json_atomic_strict`（严格读：文件存在但不可解析时返回
   解析错误，MUST NOT 按 `{}` 起）。

由此三类性质：

1. **未知键原样保留**——写通道不认识 `future_field` 也不会把它删掉；模型清单按 `id` 匹配保留该项
   上的未知子键，provider 条目上不在本次改动路径的未知键同样保留，装载期被忽略的非法条目不被其它
   条目的保存改写。
2. **没写过的键始终缺席**，因此永远跟随出厂默认（而不是被钉死成写入当时的旧值）；设置面板把某项
   恢复默认 = **删掉该键**（Reset），不写默认值；开关关闭不清空两个命名目标的 `provider` / `model`
   键（关闭表达「不调用」，不表达「忘掉目标」）。
3. **写不成立时文件逐字节不变**——设置通道在锁内完成「严格读 → 比对 revision → 应用 patch → 以
   装载同一路径复解析校验 → 非回归判据（与改动路径相交的阻断级诊断一律拒绝整笔，不看 baseline 是否
   已有同一条）→ 引用完整性复核 → 原子写」；Blocked / Conflict 走「不写」返回，不靠抛错中止。文件
   缺失按空对象处理（首次接入的主路径）；文件不可解析时保存禁用，MUST NOT 在无法 round-trip 的
   文件上写入。

**revision（CAS）**：设置快照顶层带 `revision`（sha256 over 规范化后的设置面键集合：provider 条目的
`preset` / `api_key` / `models` / `base_url` / `wire_api` / `fixture` 与条目上的其它未知键、
`harness.provider`、`auto_compact`、两个命名表的 `enabled` / `provider` / `model`、`subagents.enabled`；
**不含** composer 模型 chip 写回的 `providers.<id>.model`——否则「面板打开时切一次模型」会变成无意义
的冲突）。锁内现读的 revision 不一致时返回冲突、文件不动；「以本页为准」在当前文件上重新应用同一
patch，MUST NOT 用打开时的旧快照整份覆盖。

当前运行期会回写 `config.json` 的键（键 → 触发点）：

- `last_vault` → 打开 vault 成功（`commands.rs:731` 的 `remember_last_vault`；remap 短路不算打开）；
- `ui.theme` → 主题切换（`view.theme-cycle` / modeline 主题钮，`src/main.ts:2912` 的 `configSetUiValue`）；
- `ui.content_width` → 阅读栏宽拖拽松手（`src/main.ts:1529`）；
- `ui.sidebar_width` → 左栏分隔条拖拽松手（`src/main.ts:1571`）；
- `ui.language` → 语言切换（`view.language-cycle` / modeline 语言钮，`src/main.ts:2960`）；
- `harness.provider` / `harness.providers.<id>.model` → 合并选择器的 provider / 模型切换（`src/harness-panel.ts` 的 `selectProvider` / `selectModel`；单键合并通道）；
- `harness.permission_mode` → 权限 chip 切换（`src/harness-panel.ts` 的 `selectPermissionMode`）；
- `harness.permissions.allow` → 批准卡的「以后都允许」写规则、权限浮层的规则删除（`harness.rs:1787` / `:1816`）；
- `cron.tasks` → **交互会话里的 agent 调度工具**注册 / 删除任务（§1.8.1；`cron.rs:1160` / `:1228`）；
- **设置面板整笔 patch** → provider 增删改、`harness.provider`、四个自动化开关（`auto_compact` /
  `session_naming.enabled` / `attachment_naming.enabled` / `subagents.enabled`）、两个命名目标的
  `provider` / `model`。删除 provider 时同一笔完成替代目标重定向（`harness.provider` 改写或删键、
  两个命名目标改指或删键）与对应 model 覆盖清除，中途任一校验失败时文件逐字节不变。

`harness.permissions.allow` 与 `cron.tasks` 的读、改、替换在同一把进程内写锁内完成（避免与其余键的
并发写互相顶掉）。`version` 由写通道补齐，纪律是「仅在缺失或不高于当前 schema 时写入」（高版本配置不降回）。

**不推荐**把全量默认写进 `config.json`（手写或让应用生成都不推荐）：那会把每个缺字段的「跟随出厂默认」
钉死成写入当时的取值——出厂默认日后一变，配置文件仍按旧值跑，且 `config.json` 从「用户手编的输入面」
退化成「应用状态存储」。要改某个键就只写那个键。

## 4. 配置目录布局

路径按 ADR 0002 §5：macOS / Linux 走 `$XDG_CONFIG_HOME`（默认 `~/.config/lumir`），Windows 走
`%APPDATA%\lumir`。目录内容：

| 路径 | 内容 | 性质 |
|---|---|---|
| `config.json` | 本文档 §1 的全部键 | 用户手编的输入面（「配置即数据」，ADR 0002 §5） |
| `vault-registry/` | vault 注册表：`<vault-id>.json`，装 id ↔ path、治理标记、`last_opened_at` | **身份**（该 vault 是谁、在哪）；自动治理只归档不删除；用户在列表里可**移除**（只删本项文件——盘上的 vault 目录 / 文件与 `vault-sessions` / `reading-positions` / `harness/*` 下的 per-id 数据一概不动，它们此后成为不可达的孤儿；撤销按移除前的原值写回） |
| `vault-sessions/` | 标签会话：`<vault-id>.json`（`tabs` / `active` / `updated_at`） | **易变状态**（上次开着哪些标签） |
| `reading-positions/` | 阅读位置：`<vault-id>.json`（按文件路径记滚动位置） | **易变状态** |
| `cron-state.json` | 定时任务的当日去重状态：`{"version":1,"tasks":{"<task-id>":{"last_fired":"YYYY-MM-DD","session_id":"…"}}}` | **易变状态**（运行态，不是用户声明）；tmp + rename 原子写，不进 `config.json`、不进任何 vault |
| `logs/` | 诊断日志：`YYYY-MM-DD.jsonl`（UTC 日期，每行一个 JSON 事件） | 只落本地、不外发、不进 vault |
| `harness/sessions/` | 会话留存：`<vault-id>/<session-id>.jsonl`（首行 `session_open`，wire 记录 + sidecar） | **审计与恢复**（可恢复会话的唯一事实源） |
| `harness/subruns/` | 子运行审计流水：`<vault-id>/<run-id>.jsonl`（首段首行 `run_open`，后续段追加 `run_segment`） | **审计轨迹**（不可恢复为会话；会话列举 / 恢复 / 删除链路不感知它，见 change `add-harness-subagents` design §9.2） |

`cron-state.json` 的读取纪律（change `add-cron-runtime-daemon` design §8）：文件缺失、不可读、
非合法 JSON、`version` 与实现不符——四类对调用方的语义**完全相同**：「没有去重状态」（最多导致
一次重复触发）。一律不抛错、不阻断启动；**缺失是常态不告警**，其余三类各记一条 `config_warning`
（`source = "cron-state"`）。`last_fired` 的语义是「该任务在这一本地日期不再派发」，写入时机有两处：
派发成功（通知投递成功 / 运行交接被接受），以及**运行期注册引入且注册时已过点的新任务写当日种子**
（change `add-cron-conversational-registration`，见 §1.8.1）；运行失败与被跳过不写，启动装载引入的
任务不写种子。`cron-state.json` 的写者只有 `lumir-cron` 线程一处（调度工具不写它，`list` 只读）。
任务从配置删掉后其记录**惰性残留**，不做启动期清理。

**为什么注册表与会话刻意分存**（同一 vault 实体的两个面，`vault_session.rs` 头注释 / change
`multi-vault-workspaces` design §2）：注册项文件是**身份**，它的读取路径对解析失败一律跳过——把易变的
界面状态混进身份文件，一次会话写坏就会升级成「vault 从列表与 remap 候选中消失」。会话单独落盘后，
损坏的最大后果只是「没有标签历史」。两个目录名对仗（注册表 / 会话）正是这条分存关系的表达。

**目录名的来历**（M248；原 backlog 的「注册表目录更名」条已核销落地、原文见 git 历史）：本目录原叫 `workspaces/`，与「工作区状态」语义错位——
与 `vault-sessions/` 并置时容易被读成两个业务概念。现名 `vault-registry/` 让「同一 vault 实体的两个
面」（身份 / 会话）从名字可读。存量机器上的旧名目录由**启动时一次 `fs::rename`** 迁移：同目录同文件
系统、原子；新目录已存在则不动作（rename 到非空目录本就失败），失败则旧目录原地保留、下次启动重试；
迁移成功 / 被跳过 / 失败各记一条 `vault_registry_migrated` 诊断事件（稳态不记）。真源是
`src-tauri/src/vault_registry.rs` 的 `REGISTRY_DIR_NAME` 与 `migrate_legacy_registry_dir`。

**历史文档不改写**：change `multi-vault-workspaces` 等制品里出现的 `workspaces/` 按当时事实保留；
本节的现状描述以真源为准。
