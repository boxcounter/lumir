# settings 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `settings`——应用内设置面板。它只有两节：
> 模型接入（provider 的增删改 + 每个 provider 的 `api_key` / `models[]` 基础区 +
> `base_url` / `wire_api` 高级区）与自动化（四个全局开关 + 命名目标只读读数）。
> provider 是**用户可管理的动态集合**：以稳定 id 为键，可添加 / 编辑 / 删除；id 与预设创建
> 后不可改；`mock` 是保留 id、不上面板。模型清单只来自 `config.json` 的
> `harness.providers.<id>.models`，系统不内置模型表。其余配置键 MUST NOT 进入本面板（它们
> 各有更近的使用落点，见 proposal 的 Non-goals）。
>
> 面板的写通道是本 capability 的核心：强类型 patch、Rust 单一校验来源、raw 与生效值分离、
> 增删改与引用重定向同一笔原子完成、删键恢复默认、外部修改冲突、未知子键保留、原子写。
> `models[]` 的元素 schema 与 provider 条目 / 预设语义归 `harness` capability 的对应条，本
> delta 只引用；会话命名 / 图片命名的触发节奏与目标解析分别归 change
> `add-session-auto-naming` / `add-semantic-image-naming`，本 delta 只要求面板如实呈现，
> 不重新定义行为。

## ADDED Requirements

### Requirement: 设置面板的形态与范围

应用 SHALL 提供一个模态设置面板，经命令 `app.settings-open` 打开（命令、默认键位与应用菜单
入口的规格见 `keymap-commands` 的「设置面板入口」条）。面板 SHALL 是打开后覆盖在既有内容之上、
关闭即消失的浮层类弹出物，适用 `docs/specs/overlay-visibility.md` 的 O1–O5：打开即完整可见、
完整落在视口内、不被祖先裁切、不先开后收。

面板 SHALL 只包含两节，顺序固定：**模型接入**与**自动化**。模型接入 SHALL 含 provider 列表
（可添加 / 选择 / 删除）与选中项的编辑表单；表单含基础区（API Key 与模型清单）与默认折叠的
高级区（预设、Base URL 与 Wire 方言），危险区提供删除该 provider。自动化 SHALL 含四个开关：
自动压缩、会话命名、图片命名、子代理，以及两个命名调用的解析目标读数。其余配置键（主题、
语言、字号、折行、栏宽、权限模式与规则、vault 忽略规则、键位、cron、日志等级、`editor.*`）
MUST NOT 在本面板渲染、MUST NOT 在本面板写回——本面板不是配置总览，也不是通用 schema 表单。

模型接入里的 provider 列表 SHALL 同时是**管理面**与**编辑面选择器**：选择一行决定右列显示
哪张表单；列表 SHALL 提供「+ 添加 provider」与每个 provider 的删除入口。列表 MAY 提供
「设为当前使用」（见 `harness` 的「模型选择」条）；该动作与 composer 的模型 chip 是同一
语义（写 `harness.provider`），MUST NOT 被理解为只切换编辑面。

provider 集合 SHALL 是动态集合：用户可以添加任意数量的合法 id（`mock` 除外），每个条目的
预设 SHALL 决定协议行为。面板 MUST NOT 假设或呈现固定数量。`mock` 是验收专用档、保留 id，
MUST NOT 出现在列表里、MUST NOT 可经面板新增或删除。

模型清单 SHALL 只来自 `config.json` 的 `harness.providers.<id>.models`；系统 MUST NOT 内置
任何模型 id、能力或窗口表，面板 MUST NOT 提供「可用模型目录 / 模型市场 / 推荐模型」这类第二
来源。面板 SHALL 明说这条来源。

自动化 SHALL 是**全局**节：四个开关是 `harness.*` 下的全局键，不属于任何 provider；provider
的添加 / 删除 / 切换 MUST NOT 复制、重排、改变归属或重置这四个开关，MUST NOT 为每个 provider
各渲染一份。

面板 SHALL 固定显示配置文件路径，并在面板内明说 API Key 以明文存储在该文件中。

面板打开期间 SHALL 接管焦点：背景内容 SHALL 置为 `inert`（键盘、指针与辅助技术三者都不可达）；
`Escape`、点击遮罩、再次触发 `app.settings-open` 三条路径 SHALL 均可关闭；关闭后焦点 SHALL
交还打开前的元素。面板有未保存修改时，关闭动作 SHALL 先转为「放弃未保存的修改？」的两步确认，
MUST NOT 静默丢弃草稿。

#### Scenario: 打开只看到两节

- **WHEN** 按 `⌘,` 打开设置面板
- **THEN** 面板内只有「模型接入」与「自动化」两节；模型接入里能看到 provider 列表与选中项的
  编辑表单，自动化节能看到四个开关；主题、语言、字号、权限、忽略规则、键位、cron 等配置
  MUST NOT 出现在面板里

#### Scenario: provider 列表与表单联动

- **WHEN** 列表里有 `kimi-work` / `deepseek` / `local-lab` 三项，点击 `local-lab`
- **THEN** 右列表单显示 `local-lab` 的 Key / 模型清单 / 高级区；其他 provider 的草稿不被覆盖；
  `harness.provider` 不变（除非点击「设为当前使用」）

#### Scenario: 自动化区不随 provider 变化重复或改归属

- **WHEN** 在设置面板里依次切换 provider、添加一个 provider、删除一个 provider
- **THEN** 自动化节仍是**同一组**四个开关（同一 DOM、同一顺序、同一开关值与默认 / 显式状态）；
  MUST NOT 出现第二组按 provider 命名的复本，MUST NOT 改变这四个开关的归属

#### Scenario: 模型清单来源写明与配置一致

- **WHEN** 打开模型接入节
- **THEN** 面板明说模型清单只来自 `config.json` 的 `harness.providers.<id>.models`，不提供
  「可用模型目录 / 推荐模型」入口；改动清单只改该配置项

#### Scenario: 背景不可交互

- **WHEN** 设置面板打开
- **THEN** 编辑器、文件树、composer 与 modeline 均不可聚焦、不可点击（背景 `inert`）；
  `Tab` / `⇧Tab` 只在面板内移动

#### Scenario: 三条关闭路径与焦点交还

- **WHEN** 面板打开时分别按 `Escape`、点击遮罩空白处、再按一次 `⌘,`
- **THEN** 三种操作都关闭面板；关闭后焦点回到打开前的元素（编辑器 / 触发按钮）

#### Scenario: 脏面板关闭需确认

- **WHEN** 修改了自动压缩开关后按 `Escape`
- **THEN** 面板不关闭，出现「放弃未保存的修改？」的两步确认；选「继续编辑」保留草稿，
  选「放弃」关闭面板且 `config.json` 逐字节不变

### Requirement: provider 的增删改与稳定 id

模型接入 SHALL 支持添加、编辑与删除 provider。provider 的身份 SHALL 是 `config.json` 的
`harness.providers` 对象键（下称 provider id）：id SHALL 稳定、创建后不可改名；需要换 id 时
SHALL 新增一个 provider 再删除旧的，MUST NOT 提供重命名入口。

provider id SHALL 满足 `^[a-z0-9][a-z0-9_-]{0,31}$`（小写 ASCII 字母、数字、`-`、`_`；
MUST NOT 含点、空格、大写或非 ASCII 字符）。新增时 id 与既有条目（含装载期被忽略的条目）
重复、或为保留 id `mock` 时，保存 SHALL 被拒绝，错误 SHALL 回填到 id 输入框；后端 MUST 在
配置写锁内重新核对唯一性，MUST NOT 只信前端草稿。

每个 provider SHALL 有一个预设（`kimi` / `deepseek` / `generic`；`mock` 保留），预设由添加时
选定、创建后不可修改。添加表单 SHALL 让用户选择预设并说明每个预设的官方 Base URL、缺省 wire
与是否要求 API Key；编辑表单 SHALL 把预设显示为只读并说明「换协议请新增 provider」。

添加 provider SHALL 是一次草稿动作：添加后右列进入该 provider 的编辑表单；点「保存」才写入
`config.json`。添加第一个 provider 时，同一笔保存 SHALL 把它设为 `harness.provider`（当前
使用），使新 provider 立即可用；添加后续 provider MUST NOT 改变当前使用项。

删除 provider SHALL 是草稿动作，点「保存」才落盘；删除保护与替代目标的规则见下一条。

provider 列表 SHALL 按稳定顺序展示：预设顺序 `kimi` → `deepseek` → `generic`（同组内按 id
字典序），`mock` 不出现。每行 SHALL 显示 id、预设标签、可用状态（已配置 / 缺 Key / 缺模型 /
缺 Base URL / 装载期已忽略）与「当前」徽标（当它是 `harness.provider` 时）。

provider 集合 MAY 为空。空清单时面板 SHALL 显示「还没有 provider」空态与「添加第一个
provider」动作，MUST NOT 渲染空表单骨架或伪造条目。

#### Scenario: 添加第一个 provider

- **WHEN** 配置里没有任何 provider，点击「添加第一个 provider」，输入 id `kimi-work`、选择
  Kimi 预设并确认，填入合成 Key 与一个合法模型后保存
- **THEN** 保存成功；`config.json` 的 `harness.providers.kimi-work` 出现 `preset: "kimi"`、
  Key 与模型清单；`harness.provider` 被写为 `kimi-work`；列表出现该行并带「当前」徽标

#### Scenario: 添加第二个 provider 不改当前使用

- **WHEN** 当前使用 `kimi-work`，用户添加 `deepseek` 并保存
- **THEN** `harness.providers.deepseek` 出现；`harness.provider` 仍为 `kimi-work`；
  `deepseek` 行没有「当前」徽标

#### Scenario: 重复 id 被拒绝

- **WHEN** 列表已有 `kimi-work`，用户添加 id 为 `kimi-work` 的 provider 并保存
- **THEN** 保存被拒，id 输入框标 `aria-invalid` 并显示「id 已存在」；`config.json` 逐字节
  不变；改成 `kimi-personal` 后可保存

#### Scenario: 非法 id 被拒绝

- **WHEN** 用户输入 `Kimi Work`（含大写与空格）、`kimi.work`（含点）、空串或超过 32 字符的 id
- **THEN** 保存被拒并说明合法字符集；文件不变；MUST NOT 以规范化后的值静默保存

#### Scenario: 保留 id 不可新增

- **WHEN** 用户尝试添加 id 为 `mock` 的普通 provider
- **THEN** 保存被拒并说明 `mock` 是验收专用保留 id；面板列表里不出现 `mock`

#### Scenario: 编辑不覆盖其他 provider

- **WHEN** 修改 `kimi-work` 的模型清单并保存
- **THEN** 只有 `harness.providers.kimi-work.models` 变化；`deepseek` 与 `local-lab` 的条目
  逐字节不变（含未知子键）

#### Scenario: 预设创建后不可改

- **WHEN** 打开一个已存在 provider 的高级区
- **THEN** 预设显示为只读标签，没有可编辑的预设选择器；如果通过 patch 提交预设变更，后端
  拒绝并返回「预设不可修改」；文件不变

#### Scenario: 删到空清单

- **WHEN** 只有一个 provider，用户删除它并确认「删除后将没有 provider」，保存
- **THEN** `harness.providers` 为空、`harness.provider` 键被删除；面板显示空态；composer 的
  模型 chip 显示「未配置模型」；发送返回指向设置的 `harness_provider_missing`

#### Scenario: 装载期被忽略的条目仍可见

- **WHEN** `config.json` 里有一个 id 合法但 `preset` 非法的 provider 条目
- **THEN** 列表里出现该行并标「装载期已忽略」+ 原因；该行不可编辑为合法条目（预设不可改），
  用户只能删除它或去配置文件修正；未知字段不因其他 provider 的保存而丢失

### Requirement: provider 删除的保护与替代目标

删除 provider SHALL 在**同一笔保存**里解决全部硬引用，MUST NOT 产生「删掉条目、留下悬空
引用」的中间状态。硬引用有三类：`harness.provider`（当前使用）、
`harness.session_naming.provider`、`harness.attachment_naming.provider`。

删除确认 SHALL 在表单区域内就地呈现（MUST NOT 弹二级模态），并逐项列出命中的保护：

- **当前使用**：SHALL 要求选择替代 provider（可替代候选 = 其余合法、非 `mock`、非装载期被忽略
  的 provider）；删除最后一个可替代项时 SHALL 允许，即使映射里仍留有 `mock` 条目，也必须显示
  「删除后将没有 provider，发送消息会被挡下，直到你添加新的 provider」。`mock` 与装载期被忽略
  的条目 MUST NOT 作为替代候选。
- **命名引用**：每个显式指向它的命名目标 SHALL 要求选择「跟随当前 provider」或另一个
  可替代候选；重定向后对应的 `model` 覆盖 SHALL 被删除（它属于旧 provider 的模型清单）；
  如果删除的是当前使用项、而命名目标是「跟随当前」，面板 SHALL 明说目标会随当前 provider
  变化，并清除该目标的 `model` 覆盖。
- **草稿**：被删 provider 有未保存修改时，确认框 SHALL 多一行「该 provider 有未保存的修改，
  删除会一并丢弃」。

删除动作 SHALL 只改草稿；点「保存」才落盘。保存时后端 SHALL 在锁内按当前文件 + 本笔已应用
的添加 / 更新重新计算引用（MUST NOT 信前端草稿）：缺少必需替代目标、替代目标不存在、替代目标等于被删 id 时 SHALL
整笔拒绝，文件逐字节不变，错误 SHALL 指出具体键路径。删除成功后 MUST NOT 留下任何硬引用。

cron 任务与子代理定义里的 `model` 覆盖是软引用：删除 provider 时面板 MAY 提示「这些任务的
模型覆盖会在下次运行时按当前 provider 重新校验」，但 MUST NOT 因它们阻断删除（运行期已有
回落 + warning）。

#### Scenario: 删除当前使用的 provider

- **WHEN** 当前使用 `kimi-work`，用户删除它，选择替代目标 `deepseek` 并保存
- **THEN** `harness.providers.kimi-work` 被删除，`harness.provider` 被写为 `deepseek`；
  provider 列表的「当前」徽标移到 `deepseek`；文件里没有指向 `kimi-work` 的引用

#### Scenario: 删除当前使用项但未选替代目标

- **WHEN** 当前使用 `kimi-work` 且还有另一个 provider，用户删除它但没有选择替代目标
- **THEN** 保存被拒，错误指向 `harness.provider` 并给出可选替代；`config.json` 逐字节不变

#### Scenario: 删除被会话命名引用的 provider

- **WHEN** `session_naming.provider = "kimi-work"`、`session_naming.model` 已设置，用户删除
  `kimi-work` 并选择「跟随当前 provider」
- **THEN** `session_naming.provider` 与 `session_naming.model` 两个键都被删除；保存成功后
  自动化节的会话命名目标读数显示当前 provider 的生效模型

#### Scenario: 删除被图片命名引用的 provider 并指定替代

- **WHEN** `attachment_naming.provider = "kimi-work"`，用户删除它并选择 `local-lab`
- **THEN** `attachment_naming.provider` 被写为 `local-lab`；`attachment_naming.model` 被删除；
  自动化节显示 `local-lab` 的目标与 vision 资格（不合格时显示「会跳过」）

#### Scenario: 删除最后一个被命名引用的 provider

- **WHEN** 只有一个 provider，两个命名目标都显式指向它，用户删除它
- **THEN** 面板要求确认「删除后将没有命名目标」；保存后 provider 条目、`harness.provider`、
  两个命名目标的 `provider` 与 `model` 键都被删除；文件里没有悬空 id

#### Scenario: 映射里还有 mock 仍算「最后一个 provider」

- **WHEN** 映射里只剩一个普通 provider 与保留的 `mock` 条目，用户删除这个普通 provider
- **THEN** 面板按「最后一个 provider」处理：提示发送会被挡下，并要求命名目标改为跟随；
  保存成功，`harness.provider` 被删除；`mock` 条目原样保留；MUST NOT 把 `mock` 当作替代目标

#### Scenario: 被删 provider 有未保存修改

- **WHEN** 用户改了 `kimi-work` 的 Key 但没有保存，随后删除该 provider
- **THEN** 删除确认显示「该 provider 有未保存的修改，删除会一并丢弃」；确认后草稿里的修改
  一并丢弃；取消则保留草稿

#### Scenario: 软引用只提示不阻断

- **WHEN** 一个 cron 任务的 `model` 覆盖为 `k3-256k`，用户删除提供该模型的 provider
- **THEN** 删除可以完成；面板给一条提示「该任务的模型覆盖会在下次运行时按当前 provider 重新
  校验」；`config.json` 里该任务的条目不被改写

### Requirement: 模型接入的编辑面

模型接入 SHALL 按 provider 呈现各自独立的表单。每个 provider 的基础区 SHALL 含 API Key 与
模型清单；高级区 SHALL 含预设（只读）、Base URL 与 Wire 方言，默认折叠、可展开；危险区
SHALL 提供删除该 provider（规则见上一条）。

API Key 字段 SHALL 是掩码输入：已配置的值 MUST NOT 回显到输入框，MUST NOT 以可复制文本出现
在面板里；字段旁 SHALL 显示「已配置 · 末 4 位」或「未配置」，并提供「替换」与「清除」两个
动作。完整 API Key MUST NOT 经设置面快照返回前端；末 4 位是唯一允许的提示。字段下方 SHALL
常驻一句「明文存储在 config.json，任何能读该文件的人都能读到它」——该说明 MUST NOT 只放在
placeholder 里。

模型清单 SHALL 逐行编辑四个字段：`id`（文本）、`effort`（布尔）、`vision`（布尔）、`window`
（整数 tokens）；行 SHALL 可添加与删除。装载时未声明 `effort` / `vision` / `window` 的行 SHALL
在界面上标出「未声明」，并说明保存后按默认（`false` / `false` / 131072）显式写入——这是显式
归一化，MUST NOT 静默改写。装载期会被丢弃的坏行 SHALL 仍然可见并带原因，MUST NOT 从编辑面
消失（否则一次保存就会静默清掉文件里的坏项）。

高级区的 Base URL SHALL 支持空值（= 使用该预设的官方地址）；`generic` 预设的 Base URL
在条目已有 API Key 或模型清单时 SHALL 必填（为空时保存被拒）；完全空的 generic 条目是
「刚添加、还没填」的半成品，SHALL 允许保存。当值与官方地址不同（或 generic 有值时），字段旁
SHALL 常驻一句目的地警示：「带密钥的请求会发往这个地址」；generic 空 Key 时文案 SHALL 改为
「请求会发往这个地址」。Wire 方言 SHALL 是选择控件，选项 SHALL 由后端下发的能力矩阵决定；
当前预设不支持的档位（`deepseek` 的 `chat_completions`）SHALL 置灰并说明原因，MUST NOT 让
用户选一个会被装载期回落的档位。

Base URL、Wire 方言与四个自动化开关（见「自动化开关与命名目标」条）在键显式存在时 SHALL
提供逐项「恢复默认」，键缺席时 MUST NOT 显示该动作。API Key 的「清除」是另一条动作：已配置
或用户已输入替换值时可用，语义同为删除该键。恢复默认的语义 SHALL 是**删除该键**，MUST NOT
是把当前默认值写进文件。

面板 SHALL 提供页级「还原此页默认」：把设置面拥有的键（所有 provider 的 Key / 模型清单 /
Base URL / Wire 方言、当前使用项与四个自动化开关）全部标记为删除。该动作 MUST NOT 删除
provider 条目本身（id 与预设是身份，不是设置值）；还原后的空条目是可保存状态。该动作 SHALL
只改草稿、MUST NOT 立即落盘；用户仍需「保存」才写入，取消 SHALL 能放弃这次还原。

#### Scenario: 首次接入完成

- **WHEN** 没有任何 provider，用户添加 `kimi-work`（Kimi 预设），填入一把合成 Key，添加一条
  `{id: "k3-256k", effort: true, vision: false, window: 262144}` 并保存
- **THEN** 保存成功；`config.json` 的对应 provider 节出现 `preset`、`api_key` 与 `models`
  四项显式声明；`harness.provider` 指向 `kimi-work`

#### Scenario: 已配置的 Key 不回显

- **WHEN** `kimi-work.api_key` 已配置，打开设置面板并选中它
- **THEN** Key 输入框为空、`type="password"`，placeholder 显示「已配置 · …末 4 位」；
  面板 DOM 与快照里都 MUST NOT 出现完整 Key 字符串

#### Scenario: 清除与恢复默认删键

- **WHEN** 对已配置的 Key 点「清除」并保存；或对一条显式写入的自定义 Base URL 点「恢复默认」
  并保存
- **THEN** 保存后 `config.json` 里该键被删除（不是写成空串 / 官方 URL）；重新装载后按默认
  （未配置 / 官方地址）生效

#### Scenario: 页级还原默认只改草稿

- **WHEN** 在已配置的面板点「还原此页默认」
- **THEN** 所有 provider 的 Key 与模型清单被清空、`harness.provider` 被标为删除、四个开关
  回到默认开，状态显示有未保存修改；保存前 `config.json` 逐字节不变；点「取消」后恢复原草稿

#### Scenario: 逐项恢复默认仅显式存在时出现

- **WHEN** Base URL 与 Wire 方言均为键缺席（跟随默认）
- **THEN** 两项都不显示「恢复默认」；填入自定义 Base URL 或选择非缺省 Wire 档后，对应按钮
  出现；点「恢复默认」后草稿回到缺省值、按钮消失；保存后文件里该键被删除

#### Scenario: 自定义 Base URL 显示目的地警示

- **WHEN** 在高级区把 Base URL 从空值改为 `https://example.invalid/v1`
- **THEN** 字段旁出现「带密钥的请求会发往这个地址」警示；值改回空值（恢复默认）时警示消失

#### Scenario: generic 已有 Key 或模型时必须填 Base URL

- **WHEN** 添加一个 `generic` 预设的 provider，不填 Base URL，填了 Key 与模型后保存
- **THEN** 保存被拒，错误指向 `harness.providers.<id>.base_url`，说明 generic 预设必须
  Base URL；文件不变

#### Scenario: 空 generic 条目可以先保存

- **WHEN** 添加一个 `generic` 预设的 provider，什么都不填就保存
- **THEN** 保存成功；该条目 `configured` 为 `false`，列表显示「缺 Base URL」；补上 Base URL
  与模型后再次保存才变为可用；MUST NOT 因为条目是半成品而拒绝整笔保存

#### Scenario: generic 允许空 Key

- **WHEN** 添加一个 `generic` 预设的 provider，Base URL 为 `http://127.0.0.1:8080/v1`，
  Key 留空，声明一个模型并保存
- **THEN** 保存成功；该 provider 的 `configured` 为 `true`；请求不发送 Authorization 头

#### Scenario: deepseek 的 chat 档不可选

- **WHEN** 选中一个 `deepseek` 预设的 provider 并展开高级区的 Wire 方言
- **THEN** `chat_completions` 选项为 disabled 并给出「v1 未实现」说明；`responses` 可选

### Requirement: 设置写通道

设置面板 SHALL 使用窄接口读写，MUST NOT 复用「前端取整份配置 → 改 → 整份写回」的形态。

读 SHALL 为一份只含设置面的快照，至少区分：provider 条目（id / 预设 / 可用状态 / 引用面）、
键缺席（跟随默认）与键显式存在、raw 文件值与装载后的生效值（`wire_api` 的 raw SHALL 是文件里
的原 JSON 值，生效方言另给 `effective.wire_api`）、API Key 的「已配置」状态（不含完整值）、
当前使用项、两个命名目标的解析结果、文件状态（缺失 / 可解析 / 不可解析）。快照 SHALL 在顶层
携带 `revision`：所有非 Invalid 快照都有（文件缺失把文件视为空对象、按同一 revision 算法
计算，首次接入也能填 `base_revision`），Invalid 时为空、保存禁用。快照 SHALL 同时下发前端
需要的默认值与能力矩阵（预设的官方 Base URL / 支持的 Wire 档 / 是否要求 Key / 缺省 Wire、
`window` 上下限、id 字符集与保留 id），前端 MUST NOT 复制这些常量或取值区间。

写 SHALL 为一次强类型 patch：字段类型在 IPC 边界由 Rust 结构定义，未知字段 SHALL 被拒绝；
patch SHALL 只携带本次改动的字段，MUST NOT 携带整份配置。patch SHALL 支持三类 provider 编辑：
添加（id + 预设）、更新（Key / 模型清单 / Base URL / Wire 方言）、删除（含替代目标与命名
目标重定向）；`harness.provider` SHALL 可作为同一笔 patch 的一部分设置或删除。同一笔 patch
中，添加项的 id MUST NOT 等于本笔删除项的 id（id 复用 SHALL 拆成两次保存，MUST NOT 依赖处理
顺序）。校验 SHALL 以 Rust 的装载期校验为唯一来源；前端 MUST NOT 在 TypeScript 里复制窗口
区间、枚举表、id 规则或互斥关系，只做输入整形（数字输入、trim、按能力矩阵置灰选项）。

保存 SHALL 在配置写锁内完成「严格读文件 → 校验 revision → 应用 patch（添加 / 更新 / 删除 /
重定向 / active）→ 以装载同一路径重新解析并校验 → 原子写」这一整段，MUST NOT 出现
check-then-write 窗口。文件缺失按空对象处理；文件不是合法 JSON、或结构解析在装载期会触发
整文件回落时，保存 SHALL 被拒绝（面板只读并给出解析错误位置），MUST NOT 在不可 round-trip
的文件上写入。

保存 SHALL 满足**非回归**判据：把 patch 合并到当前 raw JSON 后，以装载同一路径解析并校验；
**任何**与 patch 改动路径相交的阻断级诊断 SHALL 拒绝整笔保存（不看 baseline 是否已有同一条；
`window: 0 → 10000001` 这类「非法换另一种非法」同样拒绝），文件逐字节不变，错误回填到具体
字段。baseline 只豁免**未改路径**上的既有诊断：未改路径的坏值不阻塞本次改动。阻断级词表
SHALL 由 Rust 单一维护，MUST NOT 由前端判定。

patch SHALL 携带设置面 revision（覆盖 provider 条目、`harness.provider`、四个自动化开关与
两个命名目标的 provider / model 键；不覆盖由 chip 写回的 `providers.<id>.model`）；锁内现读的
revision 不一致时 SHALL 返回冲突，文件不动，由用户选择重新载入或以本页为准。以本页为准
SHALL 在当前文件上重新应用同一 patch，MUST NOT 用打开时的旧快照整份覆盖。

模型清单整表保存时，提交项 SHALL 按 `id` 与当前 raw 清单匹配，并保留该项上除
`id` / `effort` / `vision` / `window` 之外的未知子键；`id` 被重命名时 SHALL 视为新条目
（旧键不跟随）。provider 条目里不在 patch 路径上的未知键、以及文件里其他节的未知键 SHALL
原样保留。装载期被忽略的非法 provider 条目 MUST NOT 因其他条目的保存而被删除或改写。

保存成功 SHALL 返回最新快照；面板 SHALL 以返回值重建草稿基线，MUST NOT 以本地推测值充当
已保存状态。保存成功 MUST NOT 被表述为「已生效」：面板 SHALL 按每个字段的生效时机提示
（provider 条目 / 当前使用项 / 自动压缩 / 子代理 = 下一回合；会话命名 = 下一次评估触发点，
结果异步落盘；图片命名 = 关→开需重启、开→关立即）。MUST NOT 写「每轮生成」或「下一轮必定
生效」。

保存请求进行中，面板 SHALL 禁用全部编辑控件（输入 / 选择 / 开关 / 模型行增删 / 添加 provider /
删除 / 设为当前使用 / 逐项恢复默认 / 页级还原 / 取消），MUST NOT 允许请求期间的编辑被返回
快照覆盖；保存完成（成功或进入需修正）后 SHALL 解锁。

#### Scenario: 越界窗口被拒绝且文件不变

- **WHEN** 把某模型的 `window` 改为 `0`（或大于 10,000,000）并保存
- **THEN** 保存返回「需要修正」；`window` 控件标 `aria-invalid` 并显示原因；`config.json`
  逐字节不变；修正为合法值后保存成功

#### Scenario: 非法换另一种非法也被拒绝

- **WHEN** 文件里某项 `window` 已是 `0`，用户把同一项改为 `10000001` 并保存
- **THEN** 保存被拒、文件逐字节不变；MUST NOT 因为「baseline 已有同一条诊断」而放行

#### Scenario: 非法改合法可以保存

- **WHEN** 文件里某项 `window` 已是 `0`，用户把同一项改为 `262144` 并保存
- **THEN** 保存成功，该键被写为合法值

#### Scenario: 未改路径的既有非法项不阻塞无关开关

- **WHEN** provider A 已有一个越界 `window`，用户只切换 provider B 的某个自动化开关并保存
- **THEN** 保存成功；provider A 的坏值原样留在文件里（不被本次 patch 触碰）

#### Scenario: 文件缺失也能首次保存

- **WHEN** `config.json` 不存在，打开设置面板、添加一个 provider（合成 Key + 合法模型）并保存
- **THEN** 快照带一个按空对象计算的 revision；保存成功并创建文件；MUST NOT 因「没有 revision」
  而无法保存

#### Scenario: raw wire_api 与生效值分开

- **WHEN** 文件里某 provider 的 `wire_api` 是闭集合外的字符串（如 `"chat"`）
- **THEN** 快照的 raw 值仍是 `"chat"`，生效方言为该预设的缺省值并在面板上标注；保存该字段后
  文件被写为选中值

#### Scenario: 未知字段被拒绝

- **WHEN** patch 里出现设置面结构未定义的字段（模拟前端 bug）
- **THEN** 命令拒绝该 patch，文件不变；MUST NOT 静默忽略未知字段

#### Scenario: 外部修改触发冲突

- **WHEN** 面板打开后，用另一个编辑器改了 `providers.kimi-work.models`，再在面板里保存一个
  自动化开关
- **THEN** 保存返回冲突、文件不动；面板显示「配置文件已在外部修改」并给「重新载入」与
  「仍然保存」两个动作；选「重新载入」后显示外部值

#### Scenario: 未知子键不被旧版 UI 洗掉

- **WHEN** 文件里某模型项除四个已知字段外还有一个未知键，用户只改了同一项的 `window` 并保存
- **THEN** 保存后该未知键仍在原项上（按 `id` 匹配保留）；provider 条目上的未知键同样保留

#### Scenario: 添加、删除与重定向在同一笔里原子完成

- **WHEN** 用户删除当前使用的 `kimi-work`，同时添加 `kimi-personal` 并选择它作为替代目标，
  再把会话命名改为跟随当前，然后保存
- **THEN** 整笔保存成功：旧条目删除、新条目写入、`harness.provider` 指向新条目、
  `session_naming.provider` 键删除；中途任何一项校验失败时文件逐字节不变（不出现只删了旧
  条目或只切了 active 的半状态）

#### Scenario: 半配置被阻断

- **WHEN** 给某 provider 填入 Key、但模型清单为空，点保存
- **THEN** 保存被拒，错误指向该 provider 并给两条出路（添加至少一个模型 / 清除 Key）；
  文件不变

#### Scenario: 文件不可解析时只读

- **WHEN** `config.json` 含一个类型错误导致整文件回落（如 `"font_size": "15"`），打开设置面板
- **THEN** 面板显示解析错误与文件路径，保存禁用、字段只读；点击保存不会写入任何内容

#### Scenario: 并发保存只有一笔落地

- **WHEN** 两个保存请求以同一个 revision 并发到达
- **THEN** 只有一笔写入成功，另一笔返回冲突；文件不出现丢键或半合并

#### Scenario: 保存中编辑控件禁用

- **WHEN** 点击保存、请求尚未返回
- **THEN** 全部输入 / 选择 / 开关 / 模型行增删 / 添加 / 删除 / 设为当前使用 / 页级还原 /
  provider 切换均为禁用或只读，取消也禁用；保存完成后解锁；MUST NOT 出现「请求期间的编辑被
  返回快照覆盖」或「仍有未落盘修改却显示已保存」

### Requirement: 设置面的校验与警告呈现

字段级错误 SHALL 回填到具体控件：控件 SHALL 标 `aria-invalid="true"`，并通过
`aria-errormessage`（或等价的 `aria-describedby`）关联错误文本；保存失败后焦点 SHALL 落到
第一个错误控件。错误文本 SHALL 来自后端诊断，MUST NOT 由前端按控件自行编造。

面板 SHALL 展示**设置面范围内**的配置诊断（provider 条目非法、模型清单为空、当前模型不在
清单、命名目标失效、Wire 档回落等），每条 SHALL 以可读形式同时展示**键路径**（如
`harness.providers.kimi-work.model`）与消息；范围外的 warning（主题、编辑器、vault 等）
MUST NOT 倒进本面板。命名目标失效的两类后果 MUST NOT 混写：会话命名回落该 provider 的生效
模型并给 warning；图片命名跳过、保留暂存名、不换模型。整文件回落或文件不可解析时，面板顶部
SHALL 显示横幅并给出文件路径与解析错误位置；该横幅优先级高于字段级提示。

保存状态（没有未保存的修改 / 有未保存的修改 / 保存中 / 已保存 / 需要修正 / 外部冲突）
SHALL 以可见文本呈现，并进入 `role="status"` 的 polite live region 供辅助技术宣告；
MUST NOT 只用颜色或图标表达。

#### Scenario: 重复模型 id 回填到行

- **WHEN** 某个 provider 的模型清单里两行使用同一个 `id` 并保存
- **THEN** **两行**的 id 控件都标 `aria-invalid="true"` 并各带重复原因，焦点落到第一行；
  状态行显示「需要修正」，文件不变

#### Scenario: provider 条目诊断挂在条目上

- **WHEN** 文件里某 provider 的 `preset` 非法而被装载期忽略
- **THEN** 列表中该行显示「装载期已忽略」与键路径 + 原因；其他 provider 的诊断不串到这一行；
  面板不显示主题 / 编辑器等范围外 warning

#### Scenario: 保存状态可被辅助技术读到

- **WHEN** 保存成功
- **THEN** 状态行文本变为「已保存」，且该文本位于 `role="status"` 的 polite live region 内

### Requirement: 自动化开关与命名目标

设置面板 SHALL 提供四个自动化开关，逐项显示：名称、一句行为说明、生效时机、敏感性（费用 /
内容出域），以及当前值是否来自默认（键缺席）还是显式设置。默认值 SHALL 为开。

四个开关 SHALL 属于**全局** `harness` 配置域，不属于任何 provider；面板 MUST NOT 按 provider
分组或复制这些开关，provider 的添加 / 删除 / 切换 MUST NOT 改变它们的值、顺序或归属。

| 开关 | 配置键 | 生效时机 | 敏感性 |
|---|---|---|---|
| 自动压缩 | `harness.auto_compact` | 下一回合 | 费用（多一次压缩调用） |
| 会话命名 | `harness.session_naming.enabled` | 下一次评估触发点；在途结果在落盘前复核开关，关掉即丢弃 | 内容出域 + 费用（一次便宜档调用） |
| 图片命名 | `harness.attachment_naming.enabled` | 关→开需重启；开→关立即 | 图片与前后文出域 + 费用（一次视觉调用） |
| 子代理 | `harness.subagents.enabled` | 下一回合 | 费用（子代理调用独立计费） |

面板 SHALL 显示两个命名调用的**解析后目标**：provider id + 模型 id、目标是否来自「跟随当前
provider」还是显式覆盖、以及是否可执行（会话命名 = 模型非空；图片命名 = 模型声明
`vision: true`）。该读数 SHALL 在 provider 增删 / 切换后重算。目标解析规则 SHALL 与
`harness` 的「配置节 [harness]」条一致；本面板 MUST NOT 另立一套解析或在前端重算模型清单。

**命名调用的目标** SHALL 默认跟随当前会话的 provider 与它的生效模型；`config.json` 的
`harness.session_naming.provider` / `.model` 与 `harness.attachment_naming.provider` / `.model`
SHALL 可以单独覆盖目标。每次触发 SHALL 只向解析出的**一个**目标发起**一次**调用，MUST NOT
对每个 provider 各调用一次，MUST NOT 按 provider 复制命名结果。这两组覆盖项 MUST NOT 搬进本
面板（避免把一处全局行为变成按 provider 配置的多份）；面板 SHALL 用一行说明默认与覆盖路径。

**会话命名的节奏文案** SHALL 与 change `add-session-auto-naming` 的「会话自动命名」条一致
（本条只约束呈现，不重新定义行为），至少写出：首轮正常完成后生成；此后每 5 轮重估；话题漂移
可提前但任两次评估至少间隔 3 轮；初始生成失败后在满足 3 轮间隔的下一个正常完成轮重试（已有
标题时失败不立即重试，按自然节奏再来）；同一逻辑会话同时最多一个调用在途（触发点跳过、
不排队）；结果在后台异步计算、会话仅在空闲时落盘。MUST NOT 写成「每轮生成」，MUST NOT 承诺
「下一轮必定生效」。

**图片命名的资格与触发** SHALL 与 change `add-semantic-image-naming` 的「图片语义命名与异步
重命名」条一致：每次粘贴新图异步触发一次（串行队列，同一文件至多一个任务）；目标模型必须在
目标 provider 的 `models` 清单内且声明 `vision: true`；不满足时 SHALL 跳过命名、保留暂存名、
不发起请求、不弹失败 toast，MUST NOT 换用清单里的其它模型。面板 SHALL 在行内写出这条资格与
「跳过」后果，MUST NOT 表述为「一定改名」。

图片命名开关的方向不对称 SHALL 在行内写明（「关闭立即生效；重新开启需重启应用」），
MUST NOT 只给一个笼统的「需重启」标记。两个命名开关的 provider / model 细项 MUST NOT 搬进
本面板；它们失效时产生的诊断 SHALL 在自动化节顶部可见，并指明其配置文件路径。两类失效的
后果 MUST NOT 混写：会话命名回落该 provider 的生效模型（并 warning），图片命名跳过、保留
暂存名（不换模型）。

每个开关 SHALL 在键显式存在时提供「恢复默认」（删键），MUST NOT 在键缺席时显示该动作；
键缺席时 SHALL 显示「默认」徽标。

#### Scenario: 关闭自动压缩立即落盘

- **WHEN** 关闭「自动压缩」并保存
- **THEN** `config.json` 的 `harness.auto_compact` 被写为 `false`；下一回合起不再自动压缩；
  再点「恢复默认」保存后该键被删除

#### Scenario: 图片命名的重启不对称

- **WHEN** 把「图片命名」从关切到开并保存
- **THEN** 状态行提示「重启后生效」；把同一开关从开切到关并保存时提示立即生效、不要求重启

#### Scenario: 会话命名的节奏文案不承诺每轮

- **WHEN** 打开自动化节
- **THEN** 会话命名行说明首轮生成、5 轮周期、漂移提前与最少 3 轮间隔、失败重试、单飞行与
  异步落盘；文案 MUST NOT 出现「每轮生成」或「下一轮必定生效」这类承诺

#### Scenario: 命名目标读数跟随当前 provider

- **WHEN** 当前使用 `kimi-work`，两个命名目标都没有显式覆盖
- **THEN** 自动化节的会话命名与图片命名读数都显示 `kimi-work` 与它的生效模型；标注「跟随
  当前 provider」；说明一次触发只发一次调用，`deepseek` 不会被同时调用

#### Scenario: 命名目标读数显示显式覆盖与资格

- **WHEN** `attachment_naming.provider = "local-lab"`，且 `local-lab` 的生效模型未声明
  `vision: true`
- **THEN** 图片命名读数显示 `local-lab` / 该模型，并标注「未声明 vision → 粘贴图片不会改名，
  保留暂存名」；MUST NOT 改选清单里的其它模型

#### Scenario: provider 增删后读数重算

- **WHEN** 删除命名目标显式指向的 provider 并按删除保护改为「跟随当前」
- **THEN** 自动化节的两个命名目标读数立即改为当前 provider 的目标；不出现旧 id

#### Scenario: 默认与显式可区分

- **WHEN** `harness.subagents.enabled` 键缺席（默认开），打开自动化节
- **THEN** 该行开关为开，显示「默认」徽标，且 MUST NOT 显示「恢复默认」；用户显式关掉后
  「恢复默认」出现、徽标消失；保存后仍是显式设置；再点「恢复默认」并保存后键被删除、
  徽标重新出现、「恢复默认」再次消失
