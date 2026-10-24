# harness 增量规格

> 起草注记（非规格正文）：本 delta 收口四件事——① provider 从固定三档闭集合改为以稳定 id 为键
> 的动态映射（含预设语义与一次性迁移）；② 模型 chip 的「已配置」口径与空态；③ `models[]`
> 元素 schema 补进 living spec；④ 模型声明指引补 `vision`。设置面板本身的形态与写通道归新
> capability `settings`，本 delta 不重复定义。

## MODIFIED Requirements

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（当前使用项的 provider id 字符串；键可省，
缺省 / 空串 / 悬空时按本条的回退规则解析，空串额外给一条 warning）、`providers` 表（**以 provider id 为键的对象映射**，每个值
是 provider 条目：`preset`（`kimi` / `deepseek` / `generic` / `mock`；缺键按 `generic` 处理
并给一条 warning，旧三档由迁移补齐，见「provider 配置迁移」条）、`api_key`、`model`、可选
`base_url`、`models` 模型清单（元素 schema 见本文件「模型清单声明」条）、可选 `wire_api`——
闭集合 `responses` / `chat_completions`，缺省随预设；`mock` 预设为 `fixture` 路径）、
`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` /
`vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`、
`auto_compact`（默认 `true`）、`session_naming` 表（会话自动命名，三键都可省：`enabled`——
默认 `true`，关闭后不发起任何命名调用、不写标题记录；`provider`——可选 provider id，缺省
`null` = 命名调用发往当前使用的 provider，非空但不在 `providers` 表内（或对应条目被装载期忽略）时 SHALL 回落当前使用项
并给一条人话 warning；`model`——可选模型 id，缺省 `null` = 选定 provider 的生效模型，非空须在
选定 provider 的 `models` 清单内声明，未声明 SHALL 回落 `null` 并给一条人话 warning；mock
provider 无模型清单，`model` 只能为 `null`）、`attachment_naming` 表（与会话命名同形，另有
`vision` 资格闸，见 change `add-semantic-image-naming`）、`subagents` 表。命名调用的
provider / 模型 / wire 方言 / `api_key` / `base_url` SHALL 同出一个 provider 条目。

`providers` 表 SHALL 是动态映射：provider id 由用户定义（`mock` 为验收专用保留 id），任何满足
`^[a-z0-9][a-z0-9_-]{0,31}$` 的 id 都可出现；条目数量 MUST NOT 被限制为固定值。每个条目的行为
SHALL 由 `preset` 决定，MUST NOT 由 id 字面量推断（id 叫 `kimi` 不构成任何协议保证）。同一预设
SHALL 可被多个条目复用（例如工作 / 个人两把 Key 各建一条）。

provider 当前使用项的解析 SHALL 按以下顺序：① `provider` 是合法 id、在映射内且该条目未被装载期忽略 → 用它（即使
其 `configured` 为 `false`，MUST NOT 自动替换用户显式选择；显式 `"mock"` 同样生效）；②
`provider` 缺省 → 按预设顺序 `kimi` → `deepseek` → `generic`（同组内按 id 字典序）取第一个
`configured` 为 `true` 的**非 `mock`** 条目；③ 没有 `configured` 条目 → 按同一顺序取第一个
合法**非 `mock`** 条目；④ 映射为空（或只剩 `mock`）→ 无当前使用项；⑤ `provider` 非空但不在
映射内 → 按 ②/③ 回退并给一条人话 warning，点名原值与落点。`mock` 是验收专用保留档，MUST NOT
被缺省回退自动选中——否则一份只剩 mock 的配置会让应用在用户不知情时进入 fixture 驱动模式。
`configured` SHALL 由后端派生（不落盘）：`mock` 预设为 `fixture` 非空；`generic` 预设为模型
清单非空且 Base URL 非空；`kimi` / `deepseek` 预设为 `api_key` 去空白后非空且模型清单非空。
`provider` 写成非字符串时 SHALL 整文件回落（ADR 0002 §5 既有模板）。

单个 provider 条目的校验 SHALL 逐条进行：条目不是对象、`preset` 非法、字段类型不符时 SHALL
只丢弃该条目并给一条点名 id 的 warning，MUST NOT 拖垮整份配置或其它条目（与
`vault.ignore` 地图、`permissions.allow` 清单的逐项口径同族）。条目里设置面不认识的子键
SHALL 在运行期忽略；经设置面板保存时 SHALL 原样保留（见 `settings` 的「设置写通道」条）。
未知字段 MUST NOT 被静默删除。`preset` 决定官方 Base URL、是否发送 `store:false`、超限特征串
与缺省 wire 方言，逐预设口径见本文件「provider 条目与预设」条。

校验 SHALL 沿用既有模板：缺字段回落默认不告警；预设的闭集合取值非法按条目丢弃 + 人话 warning；
类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key,
value)`，`ui` 表既有行为不变；设置面板的 provider / 当前使用项 / 模型 / 自动化写回 SHALL 走
`settings_apply`（见 `settings` capability 的「设置写通道」条），MUST NOT 复用本命令。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为 `providers` 表外的值（如 `"openai"`，而表里只有 `kimi` 与
  `deepseek`）
- **THEN** 启动不失败；按预设顺序回退到第一个 `configured` 的条目（没有则第一个合法条目），
  并产生一条人话 warning，点名原值与实际落点

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

#### Scenario: 非法 wire_api 回落

- **WHEN** 某 provider 的 `wire_api` 为闭集合外的值，或是该预设不支持的档位（`deepseek` 配
  `chat_completions`）
- **THEN** 启动不失败，该 provider 的方言回落该预设的缺省值并产生一条人话 warning

#### Scenario: session_naming.model 未声明回落

- **WHEN** `session_naming.model` 非空、但不在选定 provider 的 `models` 清单内（或 mock
  provider 下非空）
- **THEN** 启动不失败，命名调用回落该 provider 的生效模型并产生一条人话 warning；
  `session_naming.model` 类型不符时整文件回落

#### Scenario: session_naming.provider 指向其他 provider

- **WHEN** `session_naming = { "provider": "deepseek-personal", "model": "deepseek-flash" }`，
  而当前使用项为 `kimi-work`，且 `deepseek-personal` 条目已配置 `api_key` / `base_url` 并
  声明了该模型
- **THEN** 命名调用按 `deepseek-personal` 条目的 `api_key` / `base_url` / wire 方言发出，模型取
  该条目的 `deepseek-flash`；会话本身的请求仍走 `kimi-work`，两类调用的 provider 不混用

#### Scenario: 非法 session_naming.provider 回落

- **WHEN** `session_naming.provider` 为 `providers` 表外的值（如 `"openai"`，表里没有该 id；或指向一个被装载期忽略的条目），
  或该表把 provider 写成非字符串值
- **THEN** 悬空取值时启动不失败，命名调用回落当前使用项并产生一条人话 warning；类型不符时整
  文件回落（ADR 0002 §5 既有模板），回落后的 `session_naming.provider` 缺省（`null` = 当前
  使用项）

#### Scenario: session_naming.enabled 缺省与类型不符

- **WHEN** 配置未写 `session_naming`（或未写其中的 `enabled`），或把 `enabled` 写成非布尔值
- **THEN** 未写时按默认 `true` 生效、不告警；类型不符时整文件回落（ADR 0002 §5 既有模板），
  回落后的 `enabled` 为 `true`

#### Scenario: 旧命名键静默忽略

- **WHEN** 配置里只写了旧键 `auto_title` / `title_provider` / `providers.<id>.title_model`
  （未写 `session_naming`）
- **THEN** 旧键按未知键口径静默忽略（无 warning、无兼容读取），自动命名按 `session_naming`
  缺省值运行（开、provider 跟随当前使用项、模型取生效模型）

#### Scenario: 切换写回持久化

- **WHEN** 在面板权限 chip 把模式从 `vault_write` 切到 `read_only`
- **THEN** 下一个判定按 `read_only` 执行；`config.json` 的 `[harness].permission_mode` 被写回
  为 `read_only`，重启后保持

#### Scenario: 当前使用项缺省时的默认回退

- **WHEN** `provider` 键缺省，`providers` 表里有 `kimi`（未配置 Key）、`deepseek`（Key 与模型
  齐全）与 `local-lab`（generic，配置齐全）
- **THEN** 当前使用项为 `deepseek`（第一个 `configured` 的条目）；不会因为 `deepseek` 的 id
  字典序在后而选 `kimi`；没有 warning

#### Scenario: mock 不被缺省回退自动选中

- **WHEN** `provider` 键缺省，`providers` 表里只有 `mock`（fixture 齐全）与一个未配置的
  `kimi`
- **THEN** 当前使用项为未配置的 `kimi`（无可用普通 provider 时取第一个合法非 mock 条目），
  MUST NOT 静默切到 `mock`；只有显式 `provider: "mock"` 才走 fixture 驱动

#### Scenario: 非法 provider 条目只丢自己

- **WHEN** `providers` 表里有三个条目：`kimi`（合法）、`broken`（`preset` 为 `"openai-x"`）、
  `local-lab`（合法），且 `last_vault` 已配置
- **THEN** 启动不失败；`kimi` 与 `local-lab` 照常生效；`broken` 被忽略并产生一条点名
  `harness.providers.broken` 的人话 warning；`last_vault` 不丢；文件里 `broken` 条目原样保留

#### Scenario: 悬空命名目标回落到当前使用项

- **WHEN** `attachment_naming.provider = "deleted-one"`，而 `providers` 表里已没有该 id
- **THEN** 启动不失败；图片命名的目标回落当前使用项并给一条人话 warning；自动化设置页显示
  「已回落到当前 provider」；不会因此阻断开机或发送

### Requirement: 模型选择

composer 控制行 SHALL 提供模型选择 chip：列出**已配置**的 provider ∪ 当前使用项（`configured`
的判据见「配置节 [harness]」条；`mock` 恒被过滤、不上可选列表）。「已配置」SHALL 由后端派生
读数 `harness.providers.<id>.configured` 判定，前端 MUST NOT 用「provider 节是否存在」或条目
数量推断。当前使用项即使未配置 SHALL 保留在列表里（否则 chip 会从一个已知的坏配置上消失）。
provider 选项 SHALL 按「配置节 [harness]」的稳定顺序排列。选择即切换当前 provider 并经运行期
写回通道持久化（`config_set_value` 泛化口径，写入 `harness.provider`）；切换对下一轮生效，
MUST NOT 打断进行中的轮次。chip 文本过长 SHALL 截断（ellipsis），完整名称在 hover 呈现。
配置缺失或非法时 chip SHALL 按「配置节 [harness]」的回退规则落到默认 provider 且不报错。

没有任何 provider（或没有任何 `configured` 条目且无当前使用项）时，chip SHALL 显示空态
「未配置模型」；打开选择器 SHALL 显示「还没有可用的 provider」并提供「去设置」动作（打开
设置面板）。发送消息 SHALL 返回 `harness_provider_missing` 人话错误并保留输入区内容。

composer 的 chip 与设置面板的「设为当前使用」SHALL 是同一语义（都写 `harness.provider`）：
chip 是日常切换入口，设置面板在管理 provider 时也可设置（删除当前 provider 时必须选替代项）。
两者 MUST NOT 产生两套持久化路径。

#### Scenario: 切换 provider 并写回

- **WHEN** 配置里 `kimi-work` 与 `deepseek` 两个 provider 均已配置，在控制行模型 chip 里从
  `kimi-work` 切到 `deepseek`
- **THEN** 下一轮对话走 `deepseek`；`config.json` 的 `[harness].provider` 被写回为新值，
  重启后保持

#### Scenario: 进行中的轮次不受影响

- **WHEN** 一轮对话正在流式输出时切换模型 chip
- **THEN** 当前轮次按原 provider 跑完；切换自下一轮生效

#### Scenario: 只列可用的 provider

- **WHEN** `kimi-work` 的 `api_key` 与 `models` 都就位、`deepseek` 只有 `api_key` 没有模型，
  当前使用项为 `kimi-work`
- **THEN** chip 的 provider 选项只有 `kimi-work`（`deepseek` 的 `configured` 为 `false`，
  不列）；给 `deepseek` 补一个模型并重新取数后它才出现

#### Scenario: 当前 provider 即使未配置也保留

- **WHEN** 当前使用项为 `deepseek`，但它的 `api_key` 为空
- **THEN** chip 仍显示 `deepseek` 作为当前读数（不因未配置而消失）；其余未配置的 provider
  不出现在选项里

#### Scenario: 没有任何 provider 时的空态

- **WHEN** `harness.providers` 为空对象，且没有当前使用项
- **THEN** chip 显示「未配置模型」；打开选择器显示「还没有可用的 provider」与「去设置」；
  点击「去设置」打开设置面板；发送消息返回指向设置面板的 `harness_provider_missing`

### Requirement: 模型图片能力声明

`config.json` 的 `[harness].providers.<id>.models` 逐项声明 SHALL 支持 **`vision`** 布尔键
（键名 2026-10-10 由 `image` 改名，避免与 `image_generation` 混淆；与既有的 `effort` /
`window` 同一条 config-only 声明链）：`true` 表示该 provider + 模型接受图片输入；该键缺席 /
模型未列在清单内 SHALL 按**不支持**处理（保守默认，与 `effort` 同侧），SHALL 给一条人话
warning。系统 MUST NOT 内置任何模型的图片能力——MUST NOT 硬编码、MUST NOT 出厂回落。本条的
`<id>` 是任意用户定义的 provider id（含新增条目），不限于固定集合。

当前生效 provider + 模型的图片能力为**不支持**时，含图片卡片的消息 SHALL 在**发送时**被挡下：
系统 SHALL 返回人话错误（错误码区分"图片不受支持"这一成因）并保留输入区内容，界面 SHALL 标出
该消息里的图片卡片（用户可移除后重发）。系统 MUST NOT 静默丢弃图片后照发、MUST NOT 在粘贴时
即拒收（贴入动作本身不受能力声明限制）。能力判据 SHALL 只有一处（发送路径），界面 MUST NOT
另立第二套能力判定。

任何面向用户的模型声明指引（配置校验 warning、发送期错误信封、设置面板的字段说明）SHALL 同时
列出 `id` / `effort` / `vision` / `window` 四项；`vision` 是图片发送与图片命名的唯一依据，
指引漏掉它会让图片能力无声失效。MUST NOT 只列 `effort` / `window`。

#### Scenario: 支持时正常投递

- **WHEN** 生效模型的声明含 `"vision": true`，发送一条携带图片卡片的消息
- **THEN** 消息正常发出，wire 请求含展开后的 `input_image` part

#### Scenario: 未声明按不支持

- **WHEN** 生效模型的声明缺 `vision` 键（或该模型不在清单内）
- **THEN** 该模型的图片能力按不支持处理并产生人话 warning；含图片卡片的消息发送被挡下

#### Scenario: 不支持时挡住并标出图片卡片

- **WHEN** 生效模型的 `vision` 为 `false` 或未声明，用户在 composer 贴入图片并点击发送
- **THEN** 发送被挡下并弹出人话错误；该消息里的图片卡片被标出（错误态可见）；输入区内容原样
  保留、会话不推进、MUST NOT 发出丢弃图片的降级消息；移除图片卡片后同一消息可正常发出

#### Scenario: 新增 provider 同样适用

- **WHEN** 用户新增 `local-lab`（generic 预设）并在其 `models` 里声明 `vision: true`，切到它
  后发送带图片的消息
- **THEN** 图片按声明放行；能力判定不依赖 provider id 是否属于任何固定集合

## ADDED Requirements

### Requirement: provider 条目与预设

`harness.providers` 的每个条目 SHALL 由 `preset` 决定协议行为。预设的取值与语义：

| 预设 | 官方 Base URL | Responses 的 `store:false` | 超限特征串 | 支持 wire | 缺省 wire | 要求 api_key |
|---|---|---|---|---|---|---|
| `kimi` | `https://api.moonshot.cn/v1` | 发送 | kimi 预设表 | `responses` / `chat_completions` | `responses` | 是 |
| `deepseek` | `https://api.deepseek.com` | 不发送 | deepseek 预设表 | `responses`（v1；chat 档未实现） | `responses` | 是 |
| `generic` | 无 | 不发送 | 已知话术并集（保守识别） | `chat_completions` / `responses` | `chat_completions` | 否 |
| `mock` | 无 | 不经过 HTTP | 并集 | 不消费 | `responses` | 否 |

`generic` 预设的条目 SHALL 要求非空 `base_url`；缺失时该条目不可用（`configured = false`）
并在校验期产生一条人话 warning。`generic` 的 `api_key` 为空 SHALL 表示「不发送
Authorization 头」，MUST NOT 因此把条目判为未配置（本地 OpenAI 兼容端点通常不需要 Key）。

`mock` 是保留 id：`preset = "mock"` SHALL 只允许 id 恰好为 `mock`；其它 id 声明 mock 预设时
条目 SHALL 被忽略并给一条人话 warning。设置面板 MUST NOT 呈现或允许新增 / 删除 `mock`。

条目里的 `base_url` 为空串 SHALL 视同缺省 + warning：kimi / deepseek 落到官方地址，
generic 视为未填；「使用官方地址」的规范写法是删除该键（见 `settings` 的「模型接入的编辑面」
条），MUST NOT 写空串。`wire_api` 的非法值 /
该预设不支持的档位 SHALL 回落该预设的缺省值 + 人话 warning，MUST NOT 静默忽略。

#### Scenario: 同预设多实例

- **WHEN** 配置里有 `kimi-work` 与 `kimi-personal` 两个条目，都是 `preset: "kimi"`，Key 与
  模型清单不同
- **THEN** 两者行为都走 kimi 预设（官方地址 / store / 超限特征串）；各自使用自己的 Key 与
  清单；切换当前使用项不改变另一个条目的任何字段

#### Scenario: generic 缺 Base URL 不可用

- **WHEN** 一个 `preset: "generic"` 的条目没有 `base_url`（或写成空串）
- **THEN** 该条目 `configured = false`，装载期给一条点名的人话 warning；发送时若它是当前使用项，
  返回 `harness_base_url_missing`；MUST NOT 回落到任何内置地址

#### Scenario: generic 空 Key 不发送 Authorization

- **WHEN** 一个 `preset: "generic"` 的条目 `api_key` 为空、Base URL 与模型清单齐全
- **THEN** 该条目 `configured = true`；请求不携带 Authorization 头；MUST NOT 报
  「api_key 未配置」

#### Scenario: mock 是保留 id

- **WHEN** 配置里出现 id 为 `local-mock`、`preset: "mock"` 的条目
- **THEN** 该条目被忽略并给一条人话 warning；只有 id 恰好为 `mock` 的条目走 fixture 驱动

#### Scenario: 预设不按 id 推断

- **WHEN** 配置里有一个 id 为 `kimi` 但 `preset: "generic"`、`base_url` 指向
  `http://127.0.0.1:8080/v1` 的条目
- **THEN** 它按 generic 行为运行（不发 store、缺省 chat 方言、Base URL 用配置值），MUST NOT
  因为 id 叫 `kimi` 就使用 kimi 官方地址或 kimi 的 store 口径

### Requirement: provider 配置迁移

加载期 SHALL 对旧格式（`providers` 条目缺 `preset`）执行一次性迁移：对 id 为 `kimi` /
`deepseek` / `mock` 的条目分别补 `preset: "kimi"` / `"deepseek"` / `"mock"`；条目已写
`preset` 时 MUST NOT 覆盖（用户显式值优先）；其它 id MUST NOT 被迁移（按 `generic` + warning
对待）。

迁移 SHALL 是幂等的：迁移后的文件再次加载不再产生写操作。迁移 SHALL 与既有退役 model 值迁移
合并为同一次原子写，最多写盘一次；写失败 SHALL NOT 阻断加载——内存中的值已补齐（本次生效值
正确），只多一条 warning，下次加载再试。

迁移 MUST NOT 改名、搬字段或改写其它键；除新增的 `preset` 外，文件内容 SHALL 逐字节不变。
系统 MUST NOT 保留「旧结构」的第二条读取路径或双写路径：迁移完成后，运行期只按带 `preset`
的新 schema 解释 provider 条目。

#### Scenario: 旧配置一次补齐

- **WHEN** 用旧格式配置启动（`providers.kimi` / `.deepseek` / `.mock` 都没有 `preset`）
- **THEN** 启动正常、行为与升级前一致；文件被原子改写，三个条目各多一个 `preset`；其它键
  逐字节不变；warning 里说明发生了迁移

#### Scenario: 迁移幂等

- **WHEN** 对已迁移的文件再次启动
- **THEN** 不再写盘（文件 mtime 与内容不变）；不产生迁移 warning

#### Scenario: 显式预设不被覆盖

- **WHEN** 旧文件的 `providers.kimi` 已写 `preset: "generic"`
- **THEN** 迁移不改它；该条目按 generic 运行（用户显式值优先）

#### Scenario: 迁移写失败不阻断

- **WHEN** 配置目录只读，迁移无法落盘
- **THEN** 本次启动仍按补齐 preset 后的配置运行；给一条「迁移未能落盘，下次启动会再试」的
  warning；MUST NOT 因写失败把配置回落到默认

#### Scenario: 未知 id 不迁移

- **WHEN** 旧文件里有一个手写的 `providers.openai` 条目（旧 schema 会静默忽略它）
- **THEN** 迁移不给它补预设；新版本按 `generic` + 一条 warning 对待（条目出现在管理面，
  但缺 Base URL 时不可用）

### Requirement: 模型清单声明

`config.json` 的 `[harness].providers.<id>.models` SHALL 是模型能力与上下文窗口的**唯一**声明
源；系统 MUST NOT 内置任何模型 id、能力或窗口数值，MUST NOT 出厂回落内置模型表，MUST NOT 提供
「可用模型目录 / 推荐模型」这类第二来源。`<id>` 是任意用户定义的 provider id；provider 集合是
动态映射（见「provider 条目与预设」条），本 requirement MUST NOT 被理解为限制 provider 数量或
名称。清单每项 SHALL 是对象，字段与处置如下：

| 字段 | 类型 | 缺省 | 非法处置 |
|---|---|---|---|
| `id` | 非空字符串，清单内唯一 | 无（必需） | 丢弃该项 + 人话 warning，其余项照常生效 |
| `effort` | 布尔 | `false` + warning | 丢弃该项 + warning |
| `vision` | 布尔 | `false` + warning | 丢弃该项 + warning |
| `window` | 整数，`1..=10_000_000` tokens | `131072` + warning | 丢弃该项 + warning |

清单 SHALL 按原顺序保留合法项；一项写坏 MUST NOT 拖垮整份配置或清单的其余项。未知子键 SHALL
在运行期忽略；经设置面板保存时 SHALL 按 `id` 保留（见 `settings` capability 的「设置写通道」
条）。

生效模型 SHALL 按以下顺序解析：显式 `providers.<id>.model`（须在清单内；不在清单内时保留该
值、窗口按 `131072` 保守估算、`effort` 与 `vision` 都按不支持处理，并给 warning）→ 缺省 /
空串取清单首项 `id` → 清单为空时为空串（不伪造，发送期返回人话错误
`harness_model_missing`）。上下文窗口、effort 能力、vision 能力 SHALL 都从本清单读取，
MUST NOT 另立第二套表。

#### Scenario: 合法清单生效

- **WHEN** `kimi-work.models` 声明
  `[{id: "k3-256k", effort: true, vision: true, window: 262144}]` 且 `model` 键缺省
- **THEN** 生效模型为 `k3-256k`；上下文窗口为 262144；effort 与 vision 都按支持处理；模型
  选择器列出该模型

#### Scenario: 缺省字段按保守值并告警

- **WHEN** 某项只写 `{id: "m1"}`，缺 `effort` / `vision` / `window`
- **THEN** 该项保留并生效，`effort` 与 `vision` 按不支持、`window` 按 131072；三项缺失各产生
  一条人话 warning

#### Scenario: 坏项只丢自己

- **WHEN** 清单含三项：一条合法项、一条 `window: 0`、一条重复 `id`
- **THEN** 只有合法项生效；另外两项各产生一条点名序号的 warning；配置不回落、其余项不受影响

#### Scenario: 空清单不伪造模型

- **WHEN** provider 节已配置（有 `api_key`）但 `models` 为空
- **THEN** 生效模型为空串；模型选择器显示空态；发送时返回 `harness_model_missing`；MUST NOT
  回落到任何内置模型
