# Design: 模型接入与自动化的可见设置面板

- Change ID: `add-model-automation-settings-oct24`
- 日期: 2026-10-24
- 分支基线：master `727a7bad`（行号是起草时在该基线上逐一读过的原文位置；行号会漂，
  实现前以符号名 / 检索串为准）

本文只写「怎么做到 proposal 已裁的行为」与「为什么这样做」。安全写通道的判据按**输入分布**
表述（任意 patch、任意既有文件内容），不按案例打补丁。

## 0. 事实清单（起草时核对过原文）

| 事实 | 锚点（master `727a7bad`） | 与本 change 的关系 |
|---|---|---|
| 生效配置类型：`provider` / `providers` / `permissions` / `permission_mode` / `loop_max` / `warn_ctx_pct` / `auto_compact` / 两张命名表 / `subagents` | `src-tauri/src/config.rs:869-914`（`HarnessConfig`）、`:934-946`（`HarnessProviders`）、`:978-999`（`HarnessProviderConfig`）、`:949-976`（`HarnessModelSpec`） | 设置面读写的键都在这里 |
| `models[]` 逐项校验：非对象 / 缺 id / 空 id / 重复 id / effort·vision 非布尔 / window 非 `1..=10_000_000` 均丢该项 + warning | `config.rs:3227-3315` | 设置面必须把这些从「丢项」变成「保存前阻断」 |
| `wire_api` 闭集合 + deepseek chat 档回落 | `config.rs:3199-3225`；`llm.rs:592-645` | 高级区的选项矩阵由后端下发 |
| provider「节已配置」判据 = 任一子键出现；models 为空时 warning | `config.rs:3117-3162` | 「已配置」的新口径要在这条判据旁边定义 |
| `ConfigSnapshot { config, warnings: Vec<String>, path, cron_issues, fallback }` | `config.rs:1382-1412` | warnings 只有人话字符串，设置页需要结构化诊断 |
| `config_get` 返回**生效值**（经过 `validate`） | `src-tauri/src/commands.rs:112-114` | 设置面需要 raw 值 + 键是否在场 |
| 写通道：任意 JSON merge、**不校验**、无 delete | `commands.rs:606-613`（`config_set_value`）、`:637-676`（`write_config_value_to`）、`:678-706`（`merge_config_value`） | 设置面不复用它 |
| 读—改—写同锁入口 `update_json_atomic`（唯一原子写实现 + `CONFIG_WRITE_LOCK`） | `config.rs:1812`（锁）、`:1831-1859`（`write_json_atomic`）、`:1863-1886`（`update_json_atomic`） | 设置写通道必须在这把锁内完成 |
| 既有 `write_config_value_to` / `write_last_vault_to` 的**读发生在取锁之前**（文档自认的丢更新窗口） | `config.rs:1852-1859`；`commands.rs:637-676`、`:565-575` | 设置页是新增写者，这条窗口必须先关掉 |
| 宽容读入：解析失败 / 非对象一律按 `{}` | `config.rs:1890-1898` | 严格读是设置写通道的新前置，防盲写毁文件 |
| 配置 warning 的唯一出口是 console + 诊断日志 | `src/main.ts:4135-4138` | 设置页是第一个 UI 出口 |
| 图片命名开关的启动闸：前端启动读一次 | `src/main.ts:4098-4100` | 「关→开需重启」的不对称来源 |
| harness 每回合重读配置 | `src-tauri/src/harness.rs:1409` | API Key / models / 三个开关的生效时机 = 下一回合 |
| provider chip 选项 = `id in configured`，而三字段恒序列化 | `src/harness-panel.ts:1566-1580`；`config.rs:934-946` | 恒真，必须换成后端 `configured` 读数 |
| 模型选择 living spec：列出「已配置的 provider」 | `openspec/specs/harness/spec.md:621-626` | MODIFIED 的那条 |
| `models[]` 元素 schema 在 living spec 里缺席 | `harness/spec.md:327-334`（配置节只列到 wire_api）；`docs/specs/config-reference.md:158-162` 把它委托给 harness spec | 新增「模型清单声明」requirement 收口 |
| 模型声明指引漏 `vision`（三处文案 + 一处后端错误） | `config.rs:3141`；`harness/llm.rs:618`；`src/copy-data.ts:1156-1175`（D402 / D404） | 本 change 一并改写 |
| 键位表无 `Cmd-,`；原生菜单自建项只有 ⌘Q，预置项无 Preferences | `src/keys.ts:704-757`（全局绑定段）；`src-tauri/src/lib.rs:580` | `⌘,` 可用 |
| 面板浮层的既有配方（遮罩 + 居中 modal + `--scrim` + `--shadow-raise`；eink 1.4px 无阴影） | `src/style.css:1745-1790` | 设置面板沿用同一配方 |
| 浮层可见性合同 O1–O5 | `docs/specs/overlay-visibility.md` | 新面板适用 |
| provider 是 Rust 闭集合 `kimi` / `deepseek` / `mock`，没有增删通道 | `config.rs:602-628`（`HarnessProvider`） | 设置页只有前两项视图；新增 provider = schema change |
| 模型清单唯一来源是配置，无内置模型表 | `config.rs:959-999`（`HarnessProviderConfig.models`）、`:922-934`（`model_specs`） | 设置页不提供模型目录；文案必须写明来源 |
| 会话命名调度：首轮 / 5 轮周期 / 3 轮下限 / 漂移提前 / 失败按自然节奏 / 单飞行 | `harness/title.rs:12-13`、`:474-520`（`TitleSchedule`） | 自动化行文案的唯一事实源 |
| 会话命名目标：provider 缺省跟随会话当前 provider，model 缺省跟随该 provider 生效模型；非法 model 回落 + warning | `config.rs:1061-1081`（`title_target`） | 每次评估只调用一个目标 |
| 图片命名目标：同上，另有 vision 资格闸；不满足即跳过、不换模型 | `config.rs:1088-1150`（`attachment_naming_target`）；`attachment_naming.rs:1-20` | 图片命名行必须写出「跳过」后果 |
| 图片命名触发：每次粘贴新图异步一次，串行队列、粘贴路径不等待 | `attachment_naming.rs:1-20`；spec `add-semantic-image-naming` | 不是每轮、也不是每 provider |

## 1. 范围与信息架构

设置面只有两节，顺序固定：

```
设置
├─ 模型接入（按 provider 编辑；这里的 provider 切换只换表单）
│  ├─ provider 切换：Kimi | DeepSeek（固定两项，不可增删）
│  ├─ 来源说明：模型清单只来自 config.json 的 harness.providers.<id>.models
│  ├─ 基础区：API Key（掩码）· 模型清单（id / effort / vision / window）
│  └─ 高级区（默认折叠）：Base URL · Wire 方言
└─ 自动化（全局节，不属于任何 provider）
   ├─ 自动压缩
   ├─ 会话命名
   ├─ 图片命名
   └─ 子代理
```

- **自动化是全局节，不是 provider 卡片的一部分**：四个开关的键都在 `harness.*` 下，只有一份。
  `provider` 切换只换「模型接入」的表单，MUST NOT 复制、重排、重置自动化节，也 MUST NOT 生成
  「Kimi 的会话命名 / DeepSeek 的会话命名」这类按 provider 的复本。
- **模型接入的 provider 切换是编辑面选择器**：它不写 `harness.provider`，不改变当前会话使用的
  provider；切换当前 provider 的唯一入口仍是 composer 的模型 chip（§7）。设置页里同时编辑
  `kimi` 与 `deepseek` 的表单，互不覆盖。
- **provider 集合固定**：面板只呈现 `kimi` / `deepseek` 两个网络 provider；`mock` 是验收专用档、
  不出现。MUST NOT 提供添加 / 删除 / 重命名 provider 的入口或暗示。新增 provider 要动 Rust
  闭集合（`HarnessProvider`）、运行时装配与设置表单，属 schema change，不在本页。
- **模型清单只来自配置**：`models[]` 的唯一来源是 `config.json` 的
  `harness.providers.<id>.models`，系统不内置任何模型 id / 能力 / 窗口表，页面也不提供可浏览的
  模型目录。原型与截图里的 `k3-256k` / `ds-chat` 等是**合成数据**，不构成内置清单。
- **不做的**：主题 / 语言 / 字号 / 折行 / 栏宽 / 权限 / 忽略规则 / 键位 / cron / 日志。
  这些键在设置页出现的代价不是「多一行」，而是同一读数出现两处写入口（盘点 §5.6）。
- 页面是**固定两节**，不是通用 schema 表单：不做字段遍历 / 分页 / 过滤，也不读取
  「所有配置键」。将来新增设置项要改前端，不靠 schema 自动长出控件——这正是把
  `describe-config` 留在 backlog 的理由（两者不是同一件事）。

## 2. 面板形态、入口与焦点

- **模态面板**：全屏遮罩 + 居中卡片（与 `⌘/` 键位面板同族）。遮罩期间背景内容 `inert`
  （键盘、指针、读屏三者都不可达），面板 `role="dialog"` + `aria-modal="true"` +
  `aria-labelledby`。关闭后焦点交还打开前的元素（命令 / 菜单两条入口共用同一实现）。
- 三条关闭路径：`Escape`、点击遮罩、再按 `⌘,`；面板打开期间 `Escape` 由面板就地消费
  （与键位面板同一纪律：不新增第二条分发绑定）。有未保存修改时，关闭先转成「放弃修改？」
  的两步确认，MUST NOT 静默丢弃草稿。
- 入口：
  - 命令 `app.settings-open`，`global` 作用域，默认 `⌘,`，进 `KEY_BINDINGS` 与
    `GLOBAL_COMMAND_IDS`，可被 `[keys]` 重绑 / 解绑。
  - 应用菜单「设置…」项：**不带 accelerator**，点击经既有 `MENU_COMMAND_EVENT` 落到同一条
    命令。理由与 Undo / Redo 菜单项让出 ⌘Z 相同：菜单若自带 ⌘,，`[keys]` 重绑后原键仍会
    触发，等于第二套键位。菜单项插入沿用既有「结构假设不成立则整体跳过 + 告警」的降级纪律。
- 不加常驻 modeline 钮：低频目的地，chrome 退后；发现路径是应用菜单 + `⌘/` 键位面板。

## 3. 读：设置面快照

`settings_snapshot() -> SettingsSnapshot` 只暴露设置面的键，不把整份 `AppConfig` 交给页面。

```rust
pub struct SettingsSnapshot {
    pub path: String,
    pub file: SettingsFileState,          // Missing | Valid | Invalid { message, line, column }
    pub revision: Option<String>,         // 非 Invalid 恒有：Missing 按空对象算；Invalid = None
    pub providers: Vec<ProviderSettings>, // 固定顺序 kimi, deepseek；mock 不出现
    pub automation: AutomationSettings,
    pub capabilities: SettingsCapabilities,
    pub defaults: SettingsDefaults,
    pub diagnostics: Vec<ConfigDiagnostic>, // 仅设置面路径 + 文件级
}

pub struct ProviderSettings {
    pub id: ProviderId,
    pub configured: bool,                 // api_key 非空 && models 非空
    pub api_key: ApiKeyState,             // Unset | Set { hint: Option<String> }（末 4 位；永不回传完整值）
    pub models: Vec<ModelDraft>,          // raw 条目，含会被 validate 丢弃的坏项
    pub base_url: FieldState<String>,     // Absent | Present(raw)
    pub wire_api: FieldState<serde_json::Value>, // raw 原 JSON 值（正常是字符串；非法值也保留）
    pub effective: ProviderEffective,     // model / 生效 base_url / 生效 wire 方言 / 有效模型清单
}

pub struct ProviderEffective {
    pub model: String,
    pub base_url: String,                 // 官方值或自定义
    pub wire_api: WireApi,                // 生效方言（`FieldState` 里的 raw 值可能是非法字符串）
    pub models: Vec<HarnessModelSpec>,
}

pub struct ModelDraft {
    pub id: String,                       // 缺失 / 非字符串 / 空 → ""
    pub effort: Option<bool>,
    pub vision: Option<bool>,
    pub window: Option<u64>,
    pub unknown_keys: Vec<String>,        // 仅键名，用于提示；值在后端保留并按 id 合并
    pub issues: Vec<ConfigDiagnostic>,    // 该行在装载期会被丢弃 / 回落的原因
}
```

- **raw vs 生效**：`FieldState` 的 `Absent` 与 `Present` 区分「键缺席（跟随默认）」与
  「显式写了值」；`effective` 单独给出装载后的读数。字段旁因此能显示「默认」徽标，
  「恢复默认」也有明确语义（删键，不是写死默认值）。
- **`automation` 与 `providers` 平级，不挂在 provider 下**：四个开关的键在 `harness.*` 下，
  快照里只有一份 `AutomationSettings`；provider 切换只替换前端的表单草稿，不触碰它。命名调用的
  provider / model 覆盖项不在快照的可写面里（config-only），页面只显示说明，不提供控件。
- **`wire_api` 的 raw 与生效分开**：raw 字段承载文件里的**原 JSON 值**（正常是
  `"responses"` / `"chat_completions"`；`"chat"` 这种闭集合外的字符串也原样保留），生效方言在
  `effective.wire_api`。前端选择控件显示生效值，并在 raw 非法时旁注「文件里是「chat」，装载期
  已回落 responses；保存会写为 responses」。MUST NOT 用生效枚举充当 raw 值——那会让「文件里有
  非法字符串」这个状态在快照里消失，设置页一旦保存就会静默改写它。
- **`revision` 在快照顶层**：所有非 `Invalid` 快照都有。文件缺失（`Missing`）把文件视为空对象、
  按同一 revision 函数计算——首次接入正是「文件不存在」的主路径，前端必须有可填的
  `base_revision`；`Invalid` 时为 `None`，保存禁用。计算口径与 apply 时「缺失 = 空对象」逐字相同。
- **坏项不隐藏**：`models` 给的是 raw 条目（能读出多少给多少），`issues` 说明为什么装载期会
  丢它。MUST NOT 只给「生效清单」——那会让用户在设置页保存一次就静默清掉文件里的坏项。
- **API Key 永不回传**：`ApiKeyState::Set { hint }` 至多带末 4 位。完整 Key 已经明文存在
  `config.json` 里（Alex 已裁），但「界面不提供复制字段」是另一个决定，二者不冲突。
- `capabilities`：官方 base_url（来自 `llm::preset`）、每个 provider 支持的 wire 档、
  `window` 的上下限（`1..=10_000_000`）、默认值表。前端 MUST NOT 复制这些常量。
- `file = Invalid` 时，`providers` / `automation` 仍尽力从 raw JSON 按路径读出（只读展示），
  但 `apply` 一律拒绝（见 §5.6）。
- **既有 `config_get` 的契约不变**：它仍返回完整生效配置（含 `api_key`），服务的是启动装配与
  既有面板。设置面 MUST NOT 消费它的 `api_key` 字段，也不新增第二处暴露；收窄 `config_get`
  会影响启动装配与既有面板，属另一个 change。本 change 只保证设置面这条新通道不回传完整 Key。

## 4. 写：强类型 patch

`settings_apply(patch) -> SettingsApplyOutcome`。

```rust
pub struct SettingsPatch {
    pub base_revision: String,
    pub providers: Vec<ProviderPatch>,
    pub automation: AutomationPatch,
}

pub struct ProviderPatch {
    pub id: ProviderId,                        // 未知 id → 拒绝
    pub api_key: Option<ApiKeyEdit>,           // None = 不动；Replace(String) | Clear
    pub models: Option<Vec<ModelInput>>,       // None = 不动；Some = 整表替换（四项全显式）
    pub base_url: Option<FieldEdit<String>>,   // Set(value) | Reset（删键）
    pub wire_api: Option<FieldEdit<WireApi>>,
}

pub struct ModelInput { pub id: String, pub effort: bool, pub vision: bool, pub window: u64 }
pub enum FieldEdit<T> { Set(T), Reset }

pub struct AutomationPatch {
    pub auto_compact: Option<FieldEdit<bool>>,
    pub session_naming: Option<FieldEdit<bool>>,
    pub attachment_naming: Option<FieldEdit<bool>>,
    pub subagents: Option<FieldEdit<bool>>,
}

pub struct SettingsApplyOutcome {
    pub status: SettingsApplyStatus, // Applied | Blocked | Conflict | FileInvalid
    pub snapshot: SettingsSnapshot,  // 每次返回最新快照（冲突时用它的 revision 重试）
    pub errors: Vec<SettingsFieldError>, // path + code + message
    pub warnings: Vec<ConfigDiagnostic>, // 本次新引入的非阻断 warning
}
```

- 所有结构 `deny_unknown_fields`；未知字段 = 协议错误（前端 bug），不静默忽略。
- `ModelInput` 四项**全部必填**：模型行在 UI 上始终有四个控件，保存即把声明写完整。
  装载时缺失的 `effort` / `vision` / `window` 在编辑器里显示「未声明 · 保存后按默认写为
  false / false / 131072」；这是显式的归一化，不是静默改写。
- `Reset` 是**删键**：`base_url` / `wire_api` / 四个开关都支持；`api_key` 的 `Clear` 同样
  是删键（回到空串 = 未配置）。「恢复默认」因此不会把默认值钉进文件（config-reference §3）。
- `models` 为 `Some([])` = 清空清单；它与「api_key 非空」的组合可能触发半配置阻断（§5.4）。

## 5. 写通道算法（锁内完成）

### 5.1 一次 apply 的完整序列

```text
1. 取 CONFIG_WRITE_LOCK
2. 严格读 config.json：
     不存在        → 视为空对象（首次启动；快照的 revision 同样按空对象计算）
     JSON 解析失败 → status = FileInvalid，文件不动，返回解析 error（line/column）
     非对象        → FileInvalid
3. 反序列化为 RawConfig：
     失败 → status = FileInvalid（整个文件在装载期也会回落，不能盲写）
4. baseline = validate(raw) 的诊断（只用于非阻断 warning 的对照与未改路径豁免）
5. revision(raw) != patch.base_revision → status = Conflict，文件不动
6. 把 patch 合并到 raw JSON（只改 patch 指定的路径）→ candidate
7. 反序列化 candidate 为 RawConfig：
     失败 → status = Blocked（只能是 patch 引入的；baseline 已能解析）
8. diagnostics = validate(candidate).diagnostics
9. 非回归判据（§5.4）：任何与 patch 改动路径相交的阻断级诊断 → status = Blocked，
   文件不动，errors 回填到具体字段（不看 baseline 是否已有同一条）
10. 原子写 candidate（tmp + sync + rename，复用 write_file_atomic）
11. 释放锁；返回 status = Applied + 重新读出的 SettingsSnapshot
```

- **锁内比对 revision**：读 revision、比对、写必须在同一把锁内，否则是 check-then-write
  竞态（REVIEW.md『cargo 锁「先复核再创建」』条的同类形态）。
- **复用唯一原子写实现**：不新增第二套 tmp/rename；新增的只是「严格读」的变体
  （`update_json_atomic_strict`，与 `update_json_atomic` 共用同一把锁与同一个
  `write_file_atomic`）。
- **既有写入口顺带收口**：`write_config_value_to` 与 `write_last_vault_to` 改为在
  `update_json_atomic` 的闭包里读—改—写（今天读在取锁之前）。这不是设置页的私事：设置页
  是新增写者，不关掉这条窗口，theme / 权限档 / 设置页三者仍会丢更新。

### 5.2 revision 的口径

```text
revision = sha256(canonical_json({
  "providers": {
    "kimi":     { api_key, models, base_url, wire_api },
    "deepseek": { api_key, models, base_url, wire_api }
  },
  "auto_compact":      <present: value | absent: null>,
  "session_naming":    { enabled },
  "attachment_naming": { enabled },
  "subagents":         { enabled }
}))
```

- 只覆盖**设置面拥有的字段**：`providers.<id>.model`（chip 的写回）、`harness.provider`、
  权限档、主题等都不在 revision 里。否则用户在别处切一次模型就会让设置页报冲突。
- `models` 的 raw 数组整体入 hash（含未知子键），所以外部改任何一条都会触发冲突。
- `wire_api` 入 hash 的是 **raw JSON 值**（含非法字符串），不是生效枚举；否则「文件里的
  `"chat"` 被外部改成 `"chatty"`」这类变化不会触发冲突。
- `api_key` 也入 hash：外部改了 Key，保存时必须让用户知道。
- `revision` 是快照顶层字段：`Missing` = 把文件视为空对象后按同一 canonical 函数计算（与 apply
  时缺失文件的处理同一口径）；`Valid` = 当前文件；`Invalid` = `None`。

### 5.3 未知子键保留（Q6）

- `models[]` 整表替换前，对每个提交项按 `id` 在**当前 raw 清单**里找第一条全等项；
  命中则把该项里除 `id` / `effort` / `vision` / `window` 之外的键原样并入提交项。
- 新增 id、或 id 被重命名（旧 id 不再出现）→ 不复制旧键（重命名 = 新条目）。
- provider 对象里 settings 不认识的子键、以及文件里其他节的未知键，本来就不在 patch 的
  路径上，merge 天然保留。
- 这样旧版 UI 不会把新版写的字段洗掉；代价是「同 id 的两条历史项」只跟第一条走——清单里
  重复 id 本身会被 §5.4 阻断，不会成为既有状态。

### 5.4 非回归判据（「不把整文件回落的风险留给前端」）

**改动路径集合** `changed_paths`：

| patch 字段 | 路径 |
|---|---|
| `api_key` | `harness.providers.<id>.api_key` |
| `models` | `harness.providers.<id>.models`（含全部 `[i]` 后代） |
| `base_url` | `harness.providers.<id>.base_url` |
| `wire_api` | `harness.providers.<id>.wire_api` |
| 四个开关 | `harness.auto_compact` / `harness.session_naming.enabled` / `harness.attachment_naming.enabled` / `harness.subagents.enabled` |

**相交判据**：诊断路径与改动路径逐段比较，满足「相等 / 诊断在改动路径之下 / 诊断是改动
路径的祖先」之一即相交（`models` 与 `models[2].window` 相交）。

**阻断级诊断**（`RejectOnWrite`；词表是 Rust 里的一张显式表，不在前端）：

- `harness_model_id_empty` / `harness_model_id_duplicate` / `harness_model_window_invalid` /
  `harness_model_effort_invalid` / `harness_model_vision_invalid`
- `harness_models_empty_when_configured`（Q4：有 Key、无模型 = 半配置）
- `harness_wire_api_invalid` / `harness_wire_api_unsupported`
- `harness_base_url_empty`（空串是显式错误输入；「用官方地址」应发 `Reset`）
- `settings_unknown_field`

**放行规则**：candidate 中**任何**阻断级诊断，只要路径与 `changed_paths` 相交，整笔 Blocked
——**不看 baseline 是否已有同一条诊断**。baseline 只用来豁免**未改路径**上的既有诊断：未改
路径上的坏值保持原样、不阻塞本次改动（例如 provider A 已有一条越界 window，用户只切 provider B
的开关 → 允许）。

这条规则必须「看 candidate × changed paths」，不能退化成「看新增诊断」：窗口越界的所有取值
（`0`、`10000001`、非整数）在 `config.rs:3297-3300` 产出**同一 code / path / message**。
既有 `window: 0` 被改为 `10000001` 时，按「新增诊断」判据完全看不出来，但它确实与改动路径
相交，必须拒绝。三条判据样例：

| baseline | patch | 期望 |
|---|---|---|
| 同一项 `window: 0` | 同一项改为 `10000001` | Blocked（非法 → 另一种非法也拒） |
| 同一项 `window: 0` | 同一项改为 `262144` | Applied（非法 → 合法） |
| provider A 已有非法项 | 只切 provider B 的某个开关 | Applied（未改路径豁免） |

非阻断诊断（Warning）不阻断保存，但随 `outcome.warnings` 返回并在面板上可见：
`harness_provider_model_not_in_list`（删掉当前模型后的善后提示）、两个命名目标失效等。

**为什么不用「前端先校验」**：窗口区间、枚举表、id 唯一性若在 TS 再写一份，就是
REVIEW.md『同一语义两处真源』条。前端只做输入整形（`type="number"`、trim、按
`capabilities` 置灰选项），语义裁决全在后端；错误回填带 path，前端只按 path 挂到控件。

### 5.5 半配置阻断（Q4）与「可保存的最小状态」

- `api_key` 非空而 `models` 为空 → 阻断，`errors` 指向 `harness.providers.<id>`，文案给两条
  出路：添加至少一个模型，或清除 Key。
- `api_key` 为空而 `models` 非空 → 允许（保存清单本身是合法的；provider 只是尚不可用，
  `configured = false`，chip 不列它）。这与「先配模型再填 Key」的顺序兼容。
- 两个 provider 互不影响：只编辑 kimi 时，deepseek 的半配置状态不在 `changed_paths` 里，
  不阻断（即使 baseline 里已经存在）。

### 5.6 文件不可解析 / 整文件回落

- `RawConfig` 解析失败（任何一节类型不符）→ `FileInvalid`：面板顶部横幅给 `path` +
  解析错误行号，保存禁用，字段只读。理由：装载期整文件回落意味着**当前生效值不是用户的
  配置**，此时写入会把一份用户没看见的默认状态盖到坏文件上。
- JSON 本身不合法 → 同上，多给一行「文件不是合法 JSON」。
- 文件不存在 → 视为空对象，正常可写（首次启动）。
- 文件可解析但部分键被 `validate` 丢弃 / 回落 → 正常可写；相关诊断在设置面范围内展示，
  保存时不碰未改动的路径，坏值原样留在文件里（由用户决定修还是留）。

### 5.7 生效时机

| 设置面字段 | 生效时机 | 面板提示 |
|---|---|---|
| api_key / models / base_url / wire_api | 下一回合（`harness.rs:1409` 每回合现读） | 「已保存 · 下一回合生效」 |
| auto_compact | 下一回合 | 同上 |
| session_naming.enabled | 下一次评估触发点（首轮 / 5 轮周期 / 漂移提前；在途结果落盘前复核开关，关掉即丢弃） | 「已保存 · 下一次评估触发时生效」 |
| subagents.enabled | 下一回合 | 同上 |
| attachment_naming.enabled | 关→开需重启；开→关立即 | 命中「关→开」时提示「重启后生效」 |

面板 MUST NOT 声称「已生效」：保存成功只代表文件写成功，运行期读数由下一回合的现读 / 下一次
触发点的判定决定。会话命名的结果还是**异步**的：后台调用完成、且会话空闲时才落盘；MUST NOT
把保存状态写成「下一轮必定生效」或「每轮重新生成」。

## 6. 诊断单一来源

### 6.1 结构

`validate()` 的 warning 生产改为「结构化诊断 + 派生字符串」：

```rust
pub struct ConfigDiagnostic {
    pub code: String,          // 稳定 code，供前端分类 / 计数 / 阻断表
    pub path: Option<String>,  // 键路径；文件级为 None
    pub severity: DiagnosticSeverity, // Warning | RejectOnWrite
    pub message: String,       // 现有的人话文案，逐字不变
}
```

- `ConfigSnapshot.warnings: Vec<String>` **保持现有形状**，由 `diagnostics.iter().map(message)`
  派生——既有的 warning 文案断言、诊断日志、前端 console 出口全部零改动。
- `validate()` 内部把 `&mut Vec<String>` 换成 `DiagnosticSink`：`warn(code, path, message)`
  仍是同一条人话文案，只多带 code / path。**不存在第二份校验逻辑**。
- 阻断级与否由 code 在构造点决定（同一张表），不是设置页再判一次。

### 6.2 设置页的 warning 呈现

- 只展示 `path` 在设置面范围内（或 `None` 的文件级）的诊断；`theme` / `editor` 之类的 warning
  不进这个面板（它们有各自的出口，混进来只会制造噪音）。
- 字段级 warning（如「当前模型不在清单内」）挂在对应控件下；无对应控件的（如命名目标失效）
  挂在自动化节顶部。
- 整文件回落 `snapshot.fallback == true` 或 `file = Invalid` → 顶部横幅，优先级高于字段级。

## 7. provider chip 的「已配置」口径（harness MODIFIED）

- `HarnessProviderConfig` 增加 `configured: bool`（`#[serde(skip_deserializing)]` 不适用——
  `AppConfig` 只有 `Serialize`，字段在 `validate_harness_provider` 里算好）：
  `configured = !api_key.trim().is_empty() && !models.is_empty()`。
- 模型 chip 的 `providerOptions = { 闭集合内 configured == true 的 provider } ∪ { 当前 provider }`，
  仍过滤 `mock`。当前 provider 即使不可用也保留（否则 chip 会消失，用户看不到自己正处在
  一个坏配置上）。
- 前端 MUST NOT 用 `id in providers` 推断已配置——三字段恒序列化，这正是今天恒真的原因。
- 设置页保存后 chip 的刷新：面板关闭时发一次既有 `configGet` 重取（与权限浮层打开时现读
  同口径），不引入全局配置状态层。

## 8. 模型清单声明与 vision 指引（harness delta）

### 8.1 `models[]` 元素 schema

- 每项是对象，字段：

| 字段 | 类型 | 缺省 | 非法处置 |
|---|---|---|---|
| `id` | 非空字符串，清单内唯一 | 无（必需） | 丢该项 + warning |
| `effort` | 布尔 | `false` + warning | 丢该项 + warning |
| `vision` | 布尔 | `false` + warning | 丢该项 + warning |
| `window` | 整数 `1..=10_000_000` | `131072` + warning | 丢该项 + warning |

- 未知子键：运行期忽略，设置页保存时按 §5.3 保留。
- **来源唯一**：生效清单只来自 `config.json` 的 `harness.providers.<id>.models`；系统 MUST NOT
  内置模型 id / 能力 / 窗口表，设置页 MUST NOT 提供「可用模型目录 / 推荐模型」这类第二来源。
  原型与截图里的模型 id 是合成数据。
- **provider 集合固定**：`kimi` / `deepseek` / `mock` 是 Rust 闭集合，设置页只呈现前两项视图；
  新增 provider 须另立 schema change，本 requirement 不引入增删能力。
- 生效清单 = 逐项校验后按原顺序保留的项；`model` 缺省 / 空串取首项；当前 `model` 不在清单内
  时保留该值、窗口按 `FALLBACK_CONTEXT_WINDOW` 保守估算、`effort` 与 `vision` 都按不支持处理
  （既有行为；图片发送与图片命名的资格闸随之关闭）。
- 任何用户可见的模型声明指引（配置 warning、错误信封、设置页字段说明）SHALL 同时列出
  `id` / `effort` / `vision` / `window` 四项——`vision` 是图片发送与图片命名的唯一依据，
  漏掉它会让图片能力无声失效。

### 8.2 provider「已配置」与 chip

见 §7。这是把 living spec 已有措辞（「已配置的 provider」）落到可判据的实现口径上，
不是新语义。

## 9. 自动化开关

四个开关是**全局键**（`harness.*`），不属于任何 provider：设置页只有一份，provider 切换不改变
它们的值、归属或 DOM。开关行 MUST 显示默认徽标（键缺席 = 默认）与「恢复默认」动作；显式设置
与默认在文件层不同，在 UI 层必须可区分。

| 开关 | 键 | 默认 | 行为（可上屏的准确表述） | 敏感 | 时机 |
|---|---|---|---|---|---|
| 自动压缩 | `harness.auto_compact` | `true` | 上下文接近上限时压缩并开新会话 | 费用（多一次压缩调用） | 下一回合 |
| 会话命名 | `harness.session_naming.enabled` | `true` | 首轮生成；此后 5 轮周期重估、漂移可提前、失败按自然节奏重试、单飞行、异步落盘（见下） | 出域 + 费用（一次便宜档调用） | 下一次评估触发点 |
| 图片命名 | `harness.attachment_naming.enabled` | `true` | 每次粘贴新图异步命名；目标无 `vision` 时跳过、保留暂存名 | 出域 + 费用（一次视觉调用） | 关→开重启；开→关立即 |
| 子代理 | `harness.subagents.enabled` | `true` | 允许主对话派生并行子代理（子代理调用的总开关） | 费用（独立计费） | 下一回合 |

### 9.1 命名目标：一处解析、一次调用

- 两个命名调用的目标都**默认跟随当前会话的 provider 与它的生效模型**：
  `session_naming.provider` / `attachment_naming.provider` 缺省 = 会话当前 provider；
  对应 `model` 缺省 = 该 provider 的生效模型（`config.rs` 的 `title_target` /
  `attachment_naming_target` 是唯一解析口）。
- `config.json` 的 `harness.session_naming.provider` / `.model` 与
  `harness.attachment_naming.provider` / `.model` 可**单独覆盖**目标。每次触发只向解析出的
  **一个** provider + 一个模型发起**一次**调用；MUST NOT 对每个 provider 各做一次，MUST NOT
  把同一份命名结果按 provider 复制。两组 `provider` 取闭集合外的值都在装载期回落 `null`
  （= 会话当前 provider）并给 warning；这是配置校验的既有口径。
- 这两组覆盖项**不搬进设置页**：搬进来就会把一处全局行为变成「Kimi 一份 / DeepSeek 一份」的
  多份配置。设置页用一行文案说明默认与覆盖路径，诊断里给键路径。
- 两个命名的「目标失效」后果不同，文案 MUST NOT 混写：
  - **会话命名**：`model` 不在该 provider 清单内 ⇒ 回落该 provider 的生效模型 + warning；
    provider 的 key / 模型缺失 ⇒ 调用失败只进 stderr 与 `session_title` 的 `error` 记录，
    用户面无错误、不阻塞对话。
  - **图片命名**：`model` 必须在清单内且声明 `vision: true`；不满足 ⇒ **跳过命名、保留暂存名、
    不发起请求、不弹失败 toast**，MUST NOT 换用清单里的其它模型（`config.rs` 的
    `attachment_naming_target` 返回 `None`）。

### 9.2 会话命名的触发节奏（文案唯一事实源）

上屏文案 MUST 与 `harness/title.rs` 的 `TitleSchedule` 一致，MUST NOT 简化成「每轮生成」：

- **首轮**：逻辑会话首个正常完成的轮即生成初始标题（`reason=first-turn`）。
- **周期**：距上一次评估满 **5 轮**时重估（`cadence`）。
- **漂移提前**：已有标题时，连续两条用户消息（各 ≥8 码点）与标题的确定性词元重合度 < 0.2
  （标题词元 ≥3 个才判）即命中；但任两次评估 MUST 至少间隔 **3 轮**（`drift` 不压这个下限）。
- **失败重试**：触发时即记一次评估，失败也算；尚无有效标题时在下一个满足 3 轮间隔的正常完成
  轮重试初始生成。已有标题时失败不立即重试，按 5 轮周期 / 漂移的自然节奏再来。
- **单飞行**：同一逻辑会话同时最多一个命名调用在途；在途期间的触发点直接跳过、不排队。
- **异步落盘**：命名在 `release_turn` 之后的后台线程执行（锁外 HTTP）；落盘前重新取会话锁并
  复核「同 vault / 同 session / 会话空闲 / 开关仍开」，任一不满足即丢弃；记录只在会话空闲时
  追加，MUST NOT 插进一对 `llm_request` / `llm_response` 之间。
- 因此面板 MUST NOT 写「每轮生成」或「下一轮必定生效」；正确表述是「从下一次评估触发点起
  生效，结果在会话空闲时异步落盘」。

### 9.3 图片命名的触发与资格

- 每次粘贴**新写盘**的图片异步排一次命名（串行队列，同一文件至多一个任务；去重命中、已是
  语义名、开关关闭时不投递）。粘贴路径只多一次 invoke 投递，MUST NOT 等待模型。
- 目标模型必须由该 provider 的 `models` 声明 `vision: true`；不满足即跳过、保留暂存名。
  `attachment_naming.enabled` 关→开需重启（前端投递闸读启动装载值），开→关立即（后端每次
  调用现场读配置）。
- 图片命名的重启不对称必须在**行内**写出：「关闭立即生效；重新开启需重启应用」。

## 10. 视觉保真（有原型，必填）

原型：`design/prototypes/model-automation-settings-oct24.html`（自包含、合成数据、
内置控制面板；三主题）。实现按**观感一致**验收，不逐像素对齐（原型的字体度量与产品不同）。

### 10.1 屏位 1：面板骨架（light / dark / eink）

- **遮罩**：`var(--scrim)`；遮罩与卡片之间无描边。
- **卡片**：宽 `720px`（`max-width: 100%`），`max-height: calc(100vh - 64px)`；遮罩内边距 32px；
  `var(--preview-bg)` + 1px `var(--border)` + `var(--r10)` 圆角 + `var(--shadow-raise)`；
  eink 升到 `1.4px` 边框、无阴影（与 `.lumir-bindings-panel` 同配方）。
- **头部**：标题 15px / 650；副标题 12px `var(--text-3)`（配置文件路径）；关闭钮 16px 图标，
  静息 `var(--text-3)`、hover `var(--text)`。原型副标题里的「本原型为合成数据」只存在于原型，
  产品文案不含此句；产品在 API Key 字段下方常驻明文说明（§10.2）。
- **正文**：单列；节与节之间 16px 间距 + 1px `var(--border)` 分隔线；每节内容装在一张
  1px `--border-soft` / `--r8` 的 pane 卡片里（自动化与模型接入各自独立，不嵌套）。节标题
  11px / 650、`letter-spacing: 0.08em`、`var(--text-3)`；节标题右侧的节级说明 11px `--text-3`。
- **底部**：粘在卡片底部，1px `var(--border)` 上边线，`padding: 12px 24px`；左「还原此页默认」
  （次级文本钮），右「取消」「保存」（保存 = `--accent-fill` 实底，28px 高，`--r5`）。
- **焦点**：所有可聚焦控件 2px `--accent` 环 + 2px offset；eink 用 2px 黑环。
- 卡片打开/关闭不产生布局重排；动效 120ms 透明度，`prefers-reduced-motion` 下取消。

### 10.2 屏位 2：模型接入 · 基础区

- **节容器**：模型接入与自动化各是一张独立的 `--pane` 卡片（1px `--border-soft`、`--r8`、
  12px 内边距），自动化 MUST NOT 嵌在 provider 表单卡片里。节标题右侧是节级说明（11px
  `--text-3`）：模型接入写「切换只换表单，不切换当前会话的 provider」，自动化写「全局 · 与所选
  provider 无关」。
- **provider 切换**：分段控件，两项等宽、28px 高；选中 = `--accent-tint` 底 + `--accent` 文字；
  未选中 = 透明底 + `--text-2`；eink 选中 = 黑底白字。控件旁固定一枚「固定 2 项」徽标；
  **不渲染添加 / 删除 / 重命名 provider 的任何按钮、菜单项或「+」**。
- **来源说明**（两条常驻 11.5px `--text-3`，位于 tabs 下 / 模型清单下）：
  - `provider 固定两项：Kimi / DeepSeek（mock 是验收专用档，不在此出现）；不能增删——新增
    provider 属于 schema 变更，不在设置页。`
  - `模型清单只来自 config.json 的 harness.providers.<id>.models；Lumir 不内置任何模型表。
    本原型为合成数据。`（前半句是产品文案，末句只存在于原型）
- **字段标签**：11.5px `var(--text-3)`，标签在上、控件在下，间距 4px。
- **输入框**：13px / 6px 8px 内边距 / 1px `var(--border)` / `--r5`；focus 边框 `--accent` +
  2px `--accent-tint` 外环；错误态边框 `--danger` + 行下 11.5px `--danger` 文本。
- **API Key 行**：输入框占满剩余宽（`type="password"`），右侧「替换」「清除」两枚 30px 高的
  次级钮；已配置时输入框 placeholder 为「已配置 · …3f9a」，值为空。
- **明文说明**：11.5px `var(--text-3)`，位于字段下方 4px；不放进 placeholder（placeholder
  会消失，而这是长期事实）。
- **模型清单**：表头 11px `var(--text-3)`；每行 32px 高，列宽 `minmax(0,1fr) 64px 64px 110px 28px`
  （id / effort / vision / window / 删除）；行 hover `var(--hover)`；删除钮 16px 图标，
  静息 `--text-3`、hover `--danger`。
- **默认徽标**：10.5px `--text-3`、`--r-pill`、`var(--hover)` 底；表示「键缺席，保存后显式写入」。
- **逐项「恢复默认」**：字段头右簇里的 11px 文本钮，静息 `--text-3`、hover `--accent`；
  **只在键显式存在时渲染**，键缺席时整枚按钮不出现（不是置灰）。模型行不提供逐项恢复
  ——整表保存时四字段全显式。
- **添加行**：整行文本钮「+ 添加模型」，11.5px `--accent`，左对齐。

### 10.3 屏位 3：高级区（展开）

- 折叠触发器：11.5px `var(--text-2)` + 右侧 chevron（旋转 90° 表示展开）；行高 28px。
- 内容缩进 0，字段之间 12px；Base URL 输入框占满宽。
- **字段头右簇**：Base URL 右侧是「自定义 / 官方地址」状态 + 逐项「恢复默认」；Wire 右侧是
  逐项「恢复默认」。两枚按钮都只在键显式存在时出现（见 10.2 的样式口径）。
- **目的地警示**：1px `var(--pending)` 左边线 + 12px 内边距的浅底块（`--pending` 的
  10% 透明度；eink 用 1px 黑边、透明底），文案 11.5px `--text-2`：
  「带密钥的请求会发往这个地址。非官方地址意味着把它交给了该主机的运维者。」
  只在值与官方地址不同时出现；空值（跟随官方）时不出现。
- **Wire 方言**：`<select>` 28px 高；被后端标记为不支持的选项 `disabled` + 行下 11px
  `--text-3` 说明（「deepseek 的 chat 档在 v1 未实现」）。
- **raw 非法值提示**：raw `wire_api` 是闭集合外字符串时，选择控件显示生效值，下面加一块
  11.5px `--text-2` 的提示：「文件中的值是「chat」，不是合法方言；装载期已回落为
  responses，保存后写为 responses」。样式同目的地警示（`--pending` 左边线 + 浅底）。

### 10.4 屏位 4：自动化节

- **独立的全局卡片**：自动化节是模型接入卡片的**兄弟**，不是 provider 表单的子块。节标题右侧
  写「全局 · 与所选 provider 无关」；卡片顶部两句说明：①「四个开关是 `harness.*` 下的全局键，
  不属于任何 provider；命名调用的 provider / model 覆盖项留在配置文件」；②「命名调用目标：
  默认跟随当前会话的 provider 与它的生效模型；可在 `config.json` 的 `harness.session_naming` /
  `harness.attachment_naming` 下单独覆盖；每次只发往一个目标」。provider 切换 MUST NOT
  重渲染这张卡片（DOM 与开关值不变）。
- 每行两列：左列标题 13px / 500 + 描述 12px `--text-2` + meta 11px `--text-3`（全局 · 时机 ·
  敏感性）；右列 = 逐项「恢复默认」（11px 文本钮）+ 开关，两者横排、间距 6px。行高 ≥ 60px，
  行间 1px `--border-soft` 分隔。
- **会话命名行**：描述必须覆盖「首轮生成、5 轮周期、漂移可提前、两次评估至少隔 3 轮、失败按
  自然节奏重试、同一会话同时只跑一个调用、结果异步落盘」；meta 写「从下一次触发点起生效」。
  MUST NOT 出现「每轮生成」「下一轮必定生效」。
- **图片命名行**：描述写「每次粘贴新图异步命名；目标模型未声明 vision 时跳过、保留暂存名、
  不换模型」；meta 写「关闭立即生效；重新开启需重启应用」。MUST NOT 表述为「一定改名」。
- **开关**：32×18 轨道、14px 圆钮；关 = `var(--border)` 轨道 + `var(--preview-bg)` 钮；
  开 = `--accent-fill` 轨道 + 白钮；eink 开 = 黑底白钮、关 = 白底 1px 黑边。焦点环同全局。
- **默认徽标与逐项恢复默认**：键缺席时显示「默认」徽标、MUST NOT 显示恢复按钮；显式设置后
  徽标消失、恢复按钮出现；点恢复默认后徽标回来、按钮消失。注意两处语义不同：自动化开关的
  「默认」= 键缺席且继续保持缺席；模型行的「未声明」= 字段缺席、保存后按默认值显式写入。
- **重启提示**：图片命名行在「关→开」方向显示 11px `--pending` 文本「重新开启需重启应用」；
  其余方向不显示。

### 10.5 屏位 5：状态与错误

- **保存状态行**：11.5px；干净 `--text-3`（「没有未保存的修改」）、脏 `--text-2`
  （「有未保存的修改」）、已保存 `--ok`、需要修正 `--danger`、冲突 `--pending`。
  同一文本进 `role="status" aria-live="polite"`。
- **字段错误**：控件下 11.5px `--danger`；`aria-invalid="true"` + `aria-errormessage`；
  保存失败后焦点落到第一个错误控件。
- **横幅**（顶部，正文之上）：圆角 `--r6`、1px 边、12px 文本、`padding: 8px 12px`；
  危险档 `--danger` / `--danger-tint`，提示档 `--pending` / 10% 底。冲突横幅带两枚动作
  （「重新载入」「仍然保存」）；文件损坏横幅只有说明与路径，无动作。
- **保存中**：保存钮文案变「保存中…」并禁用；**全部编辑控件禁用或只读**（输入 / 选择 /
  开关 / 模型行增删 / 逐项恢复默认 / 页级还原 / provider 切换 / 取消），避免请求期间的编辑
  被返回快照覆盖；完成（成功或进入需修正）后解锁。完成前不显示成功状态。

### 10.6 屏位 6：关闭态与入口

- 关闭后回到应用骨架，出现一张「设置已关闭」卡片（按 `⌘,` 或点按钮重新打开）；面板不残留遮罩。
- 有未保存修改时关闭 = 两步确认条（「放弃未保存的修改？」+「放弃」/「继续编辑」），
  不弹系统 confirm。

### 10.7 三主题纪律

- 只消费 token；不新增色值。eink 下所有描边 1px → 1.4px 面板 / 1px 控件、无阴影、
  开关与分段控件用黑白实底。
- 三个主题的布局几何一致（`border-box` 下外框尺寸不变；主题切换不引起重排）。

## 11. 测试与验收计划

- **Rust 单测**：
  - snapshot：raw vs effective（含 `wire_api` 的原 JSON 值与 `effective_wire_api`）、revision
    在快照顶层（`Missing` = 空对象哈希、`Invalid` = `None`）、键缺席 vs 显式、坏模型项可见、
    API Key 只回 hint、`file = Invalid` 的只读形态。
  - patch：类型拒绝未知字段、未知 provider、空 base_url、`Reset` 删键、`Clear` 删 Key、
    `models` 按 id 保留未知子键、重命名不跟随。
  - 非回归（三组必测）：① 同一项 `window: 0 → 10000001` → Blocked；② 同一项
    `window: 0 → 262144` → Applied；③ provider A 既有非法项、只切 provider B 的开关 →
    Applied（未改路径豁免）；外加 `changed_paths` 相交判据（祖先 / 后代 / 相邻不误伤）。
  - 并发：锁内 revision 比对（两笔并发 apply 只有一笔成功）；既有写入口改为锁内读后，
    `config_set_value` 与 `settings_apply` 并发不丢键。
  - 半配置：key + 空 models → Blocked；models + 空 key → Applied 且 `configured = false`。
- **前端单测**（`pnpm test`）：
  - 草稿状态机（clean / dirty / saving / saved / blocked / conflict）；保存中全部编辑控件
    禁用，保存完成后解锁。
  - 错误按 path 回填、首错聚焦、`aria-invalid` / `aria-errormessage` 同步；重复 id 的
    **两行**都标错。
  - 逐项恢复默认仅在键显式存在时出现（Base URL / Wire 方言 / 四个开关），动作后徽标与
    按钮同步。
  - 诊断显示键路径；范围外 warning 不进入面板。
  - 开关 `role="switch"` + `aria-checked`；Space / Enter 可切换。
  - **provider 切换只换编辑面**：切换 kimi / deepseek 后自动化节的 DOM、开关值与归属不变
    （同一节点、同一顺序、仍只有四个），且不写 `harness.provider`。
  - **反向文案断言**：自动化区不含「每轮生成」「下一轮必定生效」；会话命名的说明含首轮 / 5 轮 /
    3 轮 / 异步；模型接入写清来源是 `config.json`；面板没有「添加 / 删除 provider」入口。
  - 关闭脏面板的两步确认；三条关闭路径。
  - 三主题 class / `data-theme` 切换不改变布局（结构性断言）。
- **视觉场景**（`tests/visual`）：面板在 1280×800 与 900×700 下打开即完整可见
  （O1 / O2）、无水平溢出、遮罩覆盖全窗、三主题各一屏 + 保存中（控件禁用）一屏；逐项恢复
  默认只在键显式存在时出现；自动化是独立卡片（与模型接入不嵌套）；键盘 Tab 不逃出面板。
- **原型语义回归**：`openspec/changes/add-model-automation-settings-oct24/evidence/prototype-semantics-check.mjs`
  对原型跑静态 + 浏览器反向断言（含负向对照，见其文件头）：自动化不随 provider 切换重复或改
  归属、无「每轮生成」、模型来源明确 `config.json`、无增删 provider 暗示。本 change 的
  提案评审与后续实现评审都先跑它。
- **验收场景**（真机套件）：
  - 打开设置 → 看到两个 provider 与四个开关；`⌘,` 与菜单两条入口都打开同一面板。
  - 未配置 Key 时发送 → 错误文案指向设置（不再是 `config.json`）。
  - 填入合成 Key + 一个模型 → 保存 → chip 出现该 provider；重启后仍在。
  - 输入重复 id / 越界 window → 保存被拒、文件不变（用合成配置目录断言字节）。
  - 未保存关闭 → 两步确认；放弃后文件不变。
  - 外部改文件 → 保存报冲突；「重新载入」看到外部值。
- **门禁**：`npx --yes @fission-ai/openspec@1.12.0 validate --all --strict`、
  `scripts/gate.sh quick`、`scripts/gate.sh visual`（UI 改动）、真机验收套件。

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 设置页把非法值写进文件，导致整文件回落 | patch 强类型 + `RawConfig` 严格复解析 + 非回归阻断；文件不动时返回 Blocked（§5.1 / §5.4） |
| 「非法值 → 另一种非法值」被 baseline 差异放行 | 非回归判据看 candidate × changed paths，不看是否新增（§5.4） |
| 保存请求期间继续编辑被返回快照覆盖 | 保存中禁用全部编辑控件，保存完成后再解锁（§10.5 / settings spec） |
| 多写者丢更新 | 读—改—写在 `CONFIG_WRITE_LOCK` 内；既有两个写入口一并收口（§5.1） |
| check-then-write 竞态 | revision 比对与写入同一把锁（§5.1） |
| 旧版 UI 洗掉未知子键 | models 按 id 合并未知键；其余节不在 patch 路径上（§5.3） |
| 用户在别处改了文件，被静默覆盖 | revision 冲突 + 重载 / 以本页为准两个显式动作（§5.2 / Q5） |
| 半配置保存后无法发送 | Q4 阻断 + 两条出路（§5.5） |
| 明文 Key 在界面泄露 | 快照只回末 4 位；输入框 `type="password"` 且不预填；不在 DOM 里放完整值（§3） |
| Base URL 把 Key 指向恶意主机 | 高级区常驻目的地警示；非官方值保存后在面板上仍可见（§10.3） |
| 设置页与既有 chip / modeline 读数分叉 | 设置页是写入面板，不在打开期间显示运行态；保存后关闭时 chip 重取一次（§7） |
| 设置页的 provider 表单切换被误读为切换当前 provider | 节级说明 + 面板文案写死「只换编辑面」；provider 切换不写 `harness.provider`（§1 / §10.2 / settings spec） |
| 自动化开关被误读成每个 provider 各一份 | 独立全局卡片 + 节级「与所选 provider 无关」+ 反向断言（§1 / §10.4 / evidence 脚本） |
| 会话命名文案退回「每轮生成 / 下一轮必生效」 | 文案以 §9.2 的 `TitleSchedule` 为唯一事实源；反向断言禁掉这两句（§9.2 / §11） |
| 诊断字符串变成第二份校验 | 诊断结构化、文案由同一 place 产出；前端只按 path 挂载（§6） |

## 13. 裁决点（与 proposal 的 Q1–Q6 对应）

| 编号 | 取舍 | 倾向 | 备选与代价 |
|---|---|---|---|
| Q1 | 模态面板 + `⌘,` + 菜单项，还是独立全窗页 | 模态 | 全窗页要新增导航 / 返回；对两节内容过重 |
| Q2 | 显式保存，还是逐字段即时写 | 显式保存 | 即时写少一步，但半行模型会被写入、且没有「保存状态」可看 |
| Q3 | Key 提示只显示「已配置」，还是带末 4 位 | 末 4 位 | 只显示「已配置」更保守，但多 Key / 替换确认时无从分辨 |
| Q4 | 半配置（Key 有、模型空）阻断还是仅警告 | 阻断 | 仅警告允许先存 Key，但保存后 provider 不可用、发送报错 |
| Q5 | 外部冲突阻断 + 两个动作，还是静默覆盖 | 阻断 | 静默覆盖实现最简，但会丢外部修改 |
| Q6 | 模型清单未知子键按 id 保留，还是整表替换丢弃 | 保留 | 整表替换实现简单，但旧 UI 会洗掉新版字段 |
