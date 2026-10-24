# harness 增量规格

> 起草注记（非规格正文）：本 delta 只收口模型接入相关的三个既有缺口——`models[]` 元素 schema
> 没有 living spec、模型声明指引漏 `vision`、模型 chip 的「已配置」口径恒真。设置面板本身的
> 形态与写通道归新 capability `settings`，本 delta 不重复定义。

## MODIFIED Requirements

### Requirement: 配置节 [harness]

`config.json` SHALL 支持 `[harness]` 节：`provider`（闭集合 `kimi` / `deepseek` / `mock`）、`providers` 表（各 provider 的 `api_key` / `model` / `models`——元素 schema 见本文件「模型清单声明」条 / 可选 `base_url` / 可选 `wire_api`——闭集合 `responses` / `chat_completions`，缺省 `responses`；v1 仅 kimi 实现 chat 档，其余 provider 配置 chat 档 SHALL 回落 `responses` 并给 warning；mock 为 `fixture` 路径）、`permissions`（`allow` / `deny` 规则表）、`permission_mode`（闭集合 `read_only` / `vault_write` / `full_access`，默认 `vault_write`）、`loop_max`、`warn_ctx_pct`。校验 SHALL 沿用既有模板：缺字段回落默认不告警；闭集合取值非法回落默认 + 人话 warning；类型不符整文件回落（ADR 0002 §5）。运行期写回 SHALL 经泛化的 `config_set_value(section, key, value)`，`ui` 表既有行为不变；设置面板的模型 / 自动化写回 SHALL 走 `settings_apply`（见 `settings` capability 的「设置写通道」条），MUST NOT 复用本命令。

#### Scenario: 非法 provider 回落

- **WHEN** 配置里 `provider` 为闭集合外的值
- **THEN** 启动不失败，provider 回落默认并产生一条人话 warning

#### Scenario: 非法 permission_mode 回落

- **WHEN** 配置里 `permission_mode` 为闭集合外的值（或类型不符）
- **THEN** 启动不失败，模式回落 `vault_write` 并产生一条人话 warning（类型不符时整文件回落）

#### Scenario: 非法 wire_api 回落

- **WHEN** 某 provider 的 `wire_api` 为闭集合外的值
- **THEN** 启动不失败，该 provider 的方言回落 `responses` 并产生一条人话 warning；deepseek 配置 `chat_completions` 同样回落并告警（v1 未实现其 chat 档）

#### Scenario: 切换写回持久化

- **WHEN** 在面板权限 chip 把模式从 `vault_write` 切到 `read_only`
- **THEN** 下一个判定按 `read_only` 执行；`config.json` 的 `[harness].permission_mode` 被写回为 `read_only`，重启后保持

### Requirement: 模型选择

composer 控制行 SHALL 提供模型选择 chip：列出**已配置**的 provider ∪ 当前 provider（闭集合 `kimi` / `deepseek` / `mock`；`mock` 恒被过滤、不上可选列表）。「已配置」SHALL 由后端派生读数 `harness.providers.<id>.configured` 判定：`api_key` 非空**且** `models` 清单非空，两者同时成立才为 `true`。前端 MUST NOT 用「provider 节是否存在」推断已配置——`HarnessProviders` 的三个字段恒序列化，该推断恒真。当前 provider 即使未配置 SHALL 保留在列表里（否则 chip 会从一个已知的坏配置上消失）。选择即切换当前 provider 并经运行期写回通道持久化（`config_set_value` 泛化口径，与 `[ui]` 写回同路）；切换对下一轮生效，MUST NOT 打断进行中的轮次。chip 文本过长 SHALL 截断（ellipsis），完整名称在 hover 呈现。配置缺失或非法时 chip SHALL 回落到默认 provider 且不报错（沿用 `[harness]` 配置节的回落纪律）。

#### Scenario: 切换 provider 并写回

- **WHEN** 配置里 `kimi` 与 `deepseek` 两个 provider 均已配置，在控制行模型 chip 里从 `kimi` 切到 `deepseek`
- **THEN** 下一轮对话走 `deepseek`；`config.json` 的 `[harness].provider` 被写回为新值，重启后保持

#### Scenario: 进行中的轮次不受影响

- **WHEN** 一轮对话正在流式输出时切换模型 chip
- **THEN** 当前轮次按原 provider 跑完；切换自下一轮生效

#### Scenario: 只列可用的 provider

- **WHEN** `kimi` 的 `api_key` 与 `models` 都就位、`deepseek` 只有 `api_key` 没有模型，当前 provider 为 `kimi`
- **THEN** chip 的 provider 选项只有 `kimi`（`deepseek` 的 `configured` 为 `false`，不列）；
  给 `deepseek` 补一个模型并重新取数后它才出现

#### Scenario: 当前 provider 即使未配置也保留

- **WHEN** 当前 provider 为 `deepseek`，但它的 `api_key` 为空
- **THEN** chip 仍显示 `deepseek` 作为当前读数（不因未配置而消失）；其余未配置的 provider 不出现在选项里

### Requirement: 模型图片能力声明

`config.json` 的 `[harness].providers.<id>.models` 逐项声明 SHALL 支持 **`vision`** 布尔键（键名 2026-10-10 由
`image` 改名，避免与 `image_generation` 混淆；与既有的 `effort` / `window` 同一条 config-only 声明链）：
`true` 表示该 provider + 模型接受图片输入；该键缺席 / 模型未列在清单内
SHALL 按**不支持**处理（保守默认，与 `effort` 同侧），SHALL 给一条人话 warning。系统 MUST NOT 内置任何模型的
图片能力——MUST NOT 硬编码、MUST NOT 出厂回落。

任何面向用户的模型声明指引（配置校验 warning、发送期错误信封、设置面板的字段说明）SHALL 同时列出
`id` / `effort` / `vision` / `window` 四项；`vision` 是图片发送与图片命名的唯一依据，指引漏掉它
会让图片能力无声失效。MUST NOT 只列 `effort` / `window`。

当前生效 provider + 模型的图片能力为**不支持**时，含图片卡片的消息 SHALL 在**发送时**被挡下：系统 SHALL 返回
人话错误（错误码区分"图片不受支持"这一成因）并保留输入区内容，界面 SHALL 标出该消息里的图片卡片（用户可移除
后重发）。系统 MUST NOT 静默丢弃图片后照发、MUST NOT 在粘贴时即拒收（贴入动作本身不受能力声明限制）。
能力判据 SHALL 只有一处（发送路径），界面 MUST NOT 另立第二套能力判定。

#### Scenario: 支持时正常投递

- **WHEN** 生效模型的声明含 `"vision": true`，发送一条携带图片卡片的消息
- **THEN** 消息正常发出，wire 请求含展开后的 `input_image` part

#### Scenario: 未声明按不支持

- **WHEN** 生效模型的声明缺 `vision` 键（或该模型不在清单内）
- **THEN** 该模型的图片能力按不支持处理并产生人话 warning；含图片卡片的消息发送被挡下

#### Scenario: 不支持时挡住并标出图片卡片

- **WHEN** 生效模型的 `vision` 为 `false` 或未声明，用户在 composer 贴入图片并点击发送
- **THEN** 发送被挡下并弹出人话错误；该消息里的图片卡片被标出（错误态可见）；输入区内容原样保留、会话不推进、
  MUST NOT 发出丢弃图片的降级消息；移除图片卡片后同一消息可正常发出

#### Scenario: 声明指引列出四项

- **WHEN** 用户未声明任何模型（模型清单为空）而打开设置面板，或发送时命中 `harness_model_missing`
- **THEN** 指引文本同时列出 `id` / `effort` / `vision` / `window` 四项，MUST NOT 漏掉 `vision`

## ADDED Requirements

### Requirement: 模型清单声明

`config.json` 的 `[harness].providers.<id>.models` SHALL 是模型能力与上下文窗口的**唯一**声明源；
系统 MUST NOT 内置任何模型 id、能力或窗口数值，MUST NOT 出厂回落内置模型表。清单每项 SHALL 是对象，
字段与处置如下：

| 字段 | 类型 | 缺省 | 非法处置 |
|---|---|---|---|
| `id` | 非空字符串，清单内唯一 | 无（必需） | 丢弃该项 + 人话 warning，其余项照常生效 |
| `effort` | 布尔 | `false` + warning | 丢弃该项 + warning |
| `vision` | 布尔 | `false` + warning | 丢弃该项 + warning |
| `window` | 整数，`1..=10_000_000` tokens | `131072` + warning | 丢弃该项 + warning |

清单 SHALL 按原顺序保留合法项；一项写坏 MUST NOT 拖垮整份配置或清单的其余项。未知子键 SHALL 在运行期
忽略；经设置面板保存时 SHALL 按 `id` 保留（见 `settings` capability 的「设置写通道」条）。

生效模型 SHALL 按以下顺序解析：显式 `providers.<id>.model`（须在清单内；不在清单内时保留该值、
窗口按 `131072` 保守估算、effort 按不支持处理，并给 warning）→ 缺省 / 空串取清单首项 `id` →
清单为空时为空串（不伪造，发送期返回人话错误 `harness_model_missing`）。上下文窗口、effort 能力、
vision 能力 SHALL 都从本清单读取，MUST NOT 另立第二套表。

#### Scenario: 合法清单生效

- **WHEN** `kimi.models` 声明 `[{id: "k3-256k", effort: true, vision: true, window: 262144}]` 且 `model` 键缺省
- **THEN** 生效模型为 `k3-256k`；上下文窗口为 262144；effort 与 vision 都按支持处理；模型选择器列出该模型

#### Scenario: 缺省字段按保守值并告警

- **WHEN** 某项只写 `{id: "m1"}`，缺 `effort` / `vision` / `window`
- **THEN** 该项保留并生效，`effort` 与 `vision` 按不支持、`window` 按 131072；三项缺失各产生一条人话 warning

#### Scenario: 坏项只丢自己

- **WHEN** 清单含三项：一条合法项、一条 `window: 0`、一条重复 `id`
- **THEN** 只有合法项生效；另外两项各产生一条点名序号的 warning；配置不回落、其余项不受影响

#### Scenario: 空清单不伪造模型

- **WHEN** provider 节已配置（有 `api_key`）但 `models` 为空
- **THEN** 生效模型为空串；模型选择器显示空态；发送时返回 `harness_model_missing`；MUST NOT 回落到任何内置模型
