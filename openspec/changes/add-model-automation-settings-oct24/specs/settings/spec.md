# settings 增量规格

> 起草注记（非规格正文）：本 delta 新建 capability `settings`——应用内设置面板。它只有两节：
> 模型接入（`api_key` / `models[]` 基础区，`base_url` / `wire_api` 高级区）与四个自动化开关；
> 其余配置键 MUST NOT 进入本面板（它们各有更近的使用落点，见 proposal 的 Non-goals）。
> 面板的写通道是本 capability 的核心：强类型 patch、Rust 单一校验来源、raw 与生效值分离、
> 删键恢复默认、外部修改冲突、未知子键保留、原子写。`models[]` 的元素 schema 归 `harness`
> capability 的「模型清单声明」条，本 delta 只引用。

## ADDED Requirements

### Requirement: 设置面板的形态与范围

应用 SHALL 提供一个模态设置面板，经命令 `app.settings-open` 打开（命令、默认键位与应用菜单
入口的规格见 `keymap-commands` 的「设置面板入口」条）。面板 SHALL 是打开后覆盖在既有内容之上、
关闭即消失的浮层类弹出物，适用 `docs/specs/overlay-visibility.md` 的 O1–O5：打开即完整可见、
完整落在视口内、不被祖先裁切、不先开后收。

面板 SHALL 只包含两节，顺序固定：**模型接入**与**自动化**。模型接入 SHALL 含 provider 切换
（闭集合内的 `kimi` / `deepseek`；`mock` 是验收专用档，MUST NOT 出现在面板里）、基础区
（API Key 与模型清单）与默认折叠的高级区（Base URL 与 Wire 方言）。自动化 SHALL 含四个开关：
自动压缩、会话命名、图片命名、子代理。其余配置键（主题、语言、字号、折行、栏宽、权限模式与
规则、vault 忽略规则、键位、cron、日志等级、`editor.*`）MUST NOT 在本面板渲染、MUST NOT 在本
面板写回——本面板不是配置总览，也不是通用 schema 表单。

面板 SHALL 固定显示配置文件路径，并在面板内明说 API Key 以明文存储在该文件中。

面板打开期间 SHALL 接管焦点：背景内容 SHALL 置为 `inert`（键盘、指针与辅助技术三者都不可达）；
`Escape`、点击遮罩、再次触发 `app.settings-open` 三条路径 SHALL 均可关闭；关闭后焦点 SHALL
交还打开前的元素。面板有未保存修改时，关闭动作 SHALL 先转为「放弃未保存的修改？」的两步确认，
MUST NOT 静默丢弃草稿。

#### Scenario: 打开只看到两节

- **WHEN** 按 `⌘,` 打开设置面板
- **THEN** 面板内只有「模型接入」与「自动化」两节；模型接入里能看到 `kimi` / `deepseek`
  两个 provider 与四个自动化开关；主题、语言、字号、权限、忽略规则、键位、cron 等配置
  MUST NOT 出现在面板里

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

### Requirement: 模型接入的编辑面

模型接入 SHALL 按 provider 呈现各自独立的表单。每个 provider 的基础区 SHALL 含 API Key 与
模型清单；高级区 SHALL 含 Base URL 与 Wire 方言，默认折叠、可展开。

API Key 字段 SHALL 是掩码输入：已配置的值 MUST NOT 回显到输入框，MUST NOT 以可复制文本出现
在面板里；字段旁 SHALL 显示「已配置 · 末 4 位」或「未配置」，并提供「替换」与「清除」两个
动作。完整 API Key MUST NOT 经设置面快照返回前端；末 4 位是唯一允许的提示。字段下方 SHALL
常驻一句「明文存储在 config.json，任何能读该文件的人都能读到它」——该说明 MUST NOT 只放在
placeholder 里（placeholder 会消失，而这是长期事实）。

模型清单 SHALL 逐行编辑四个字段：`id`（文本）、`effort`（布尔）、`vision`（布尔）、`window`
（整数 tokens）；行 SHALL 可添加与删除。装载时未声明 `effort` / `vision` / `window` 的行 SHALL
在界面上标出「未声明」，并说明保存后按默认（`false` / `false` / 131072）显式写入——这是显式
归一化，MUST NOT 静默改写。装载期会被丢弃的坏行 SHALL 仍然可见并带原因，MUST NOT 从编辑面
消失（否则一次保存就会静默清掉文件里的坏项）。

高级区的 Base URL SHALL 支持空值（= 使用该 provider 的官方地址）。当值与官方地址不同时，
字段旁 SHALL 常驻一句目的地警示：「带密钥的请求会发往这个地址」。Wire 方言 SHALL 是选择控件，
选项 SHALL 由后端下发的能力矩阵决定；v1 未实现的档位（`deepseek` 的 `chat_completions`）
SHALL 置灰并说明原因，MUST NOT 让用户选一个会被装载期回落的档位。

Base URL、Wire 方言与四个自动化开关（见「自动化开关」条）在键显式存在时 SHALL 提供逐项
「恢复默认」，键缺席时 MUST NOT 显示该动作。API Key 的「清除」是另一条动作：已配置或用户
已输入替换值时可用，语义同为删除该键。恢复默认的语义 SHALL 是**删除该键**（回到跟随默认），
MUST NOT 是把当前默认值写进文件。

面板 SHALL 提供页级「还原此页默认」：把设置面拥有的键（两个 provider 的 API Key / 模型清单 /
Base URL / Wire 方言与四个自动化开关）全部标记为删除。该动作 SHALL 只改草稿、MUST NOT 立即
落盘；用户仍需「保存」才写入，取消 SHALL 能放弃这次还原。

#### Scenario: 首次接入完成

- **WHEN** 两个 provider 都未配置，用户选择 `kimi`，填入一把合成 Key，添加一条
  `{id: "k3-256k", effort: true, vision: false, window: 262144}` 并保存
- **THEN** 保存成功；`config.json` 的对应 provider 节出现 `api_key` 与 `models` 四项显式声明；
  模型 chip 的下一次取数把 `kimi` 列为可用 provider

#### Scenario: 已配置的 Key 不回显

- **WHEN** `kimi.api_key` 已配置，打开设置面板并切到 `kimi`
- **THEN** Key 输入框为空、`type="password"`，placeholder 显示「已配置 · …末 4 位」；
  面板 DOM 与快照里都 MUST NOT 出现完整 Key 字符串

#### Scenario: 清除与恢复默认删键

- **WHEN** 对已配置的 Key 点「清除」并保存；或对一条显式写入的自定义 Base URL 点「恢复默认」并保存
- **THEN** 保存后 `config.json` 里该键被删除（不是写成空串 / 官方 URL）；重新装载后按默认
  （未配置 / 官方地址）生效

#### Scenario: 页级还原默认只改草稿

- **WHEN** 在已配置的面板点「还原此页默认」
- **THEN** 两个 provider 的 Key 与模型清单被清空、四个开关回到默认开，状态显示有未保存修改；
  保存前 `config.json` 逐字节不变；点「取消」后恢复原草稿

#### Scenario: 逐项恢复默认仅显式存在时出现

- **WHEN** Base URL 与 Wire 方言均为键缺席（跟随默认）
- **THEN** 两项都不显示「恢复默认」；填入自定义 Base URL 或选择非缺省 Wire 档后，对应按钮
  出现；点「恢复默认」后草稿回到缺省值、按钮消失；保存后文件里该键被删除

#### Scenario: 自定义 Base URL 显示目的地警示

- **WHEN** 在高级区把 Base URL 从空值改为 `https://example.invalid/v1`
- **THEN** 字段旁出现「带密钥的请求会发往这个地址」警示；值改回空值（恢复默认）时警示消失

#### Scenario: deepseek 的 chat 档不可选

- **WHEN** 切到 `deepseek` 并展开高级区的 Wire 方言
- **THEN** `chat_completions` 选项为 disabled 并给出「v1 未实现」说明；`responses` 可选

### Requirement: 设置写通道

设置面板 SHALL 使用窄接口读写，MUST NOT 复用「前端取整份配置 → 改 → 整份写回」的形态。

读 SHALL 为一份只含设置面的快照，至少区分：键缺席（跟随默认）与键显式存在；raw 文件值与
装载后的生效值（`wire_api` 的 raw SHALL 是文件里的原 JSON 值，生效方言另给
`effective.wire_api`，MUST NOT 用生效枚举充当 raw）；API Key 的「已配置」状态（不含完整值）；
文件状态（缺失 / 可解析 / 不可解析）。快照 SHALL 在顶层携带 `revision`：所有非 Invalid 快照
都有（文件缺失把文件视为空对象、按同一 revision 算法计算，首次接入也能填 `base_revision`），
Invalid 时为空、保存禁用。
快照 SHALL 同时下发前端需要的默认值与能力矩阵（官方 Base URL、各 provider 支持
的 Wire 档、`window` 上下限），前端 MUST NOT 复制这些常量或取值区间。

写 SHALL 为一次强类型 patch：字段类型在 IPC 边界由 Rust 结构定义，未知字段 SHALL 被拒绝；
patch SHALL 只携带本次改动的字段，MUST NOT 携带整份配置。校验 SHALL 以 Rust 的装载期校验为
唯一来源；前端 MUST NOT 在 TypeScript 里复制窗口区间、枚举表或互斥关系，只做输入整形
（数字输入、trim、按能力矩阵置灰选项）。

保存 SHALL 在配置写锁内完成「严格读文件 → 校验 revision → 合并 patch → 以装载同一路径重新
解析并校验 → 原子写」这一整段，MUST NOT 出现 check-then-write 窗口。文件缺失按空对象处理；
文件不是合法 JSON、或结构解析在装载期会触发整文件回落时，保存 SHALL 被拒绝（面板只读并给出
解析错误位置），MUST NOT 在不可 round-trip 的文件上写入。

保存 SHALL 满足**非回归**判据：把 patch 合并到当前 raw JSON 后，以装载同一路径解析并校验；
**任何**与 patch 改动路径相交的阻断级诊断 SHALL 拒绝整笔保存（不看 baseline 是否已有同一条；
`window: 0 → 10000001` 这类「非法换另一种非法」同样拒绝），文件逐字节不变，错误回填到具体
字段。baseline 只豁免**未改路径**上的既有诊断：未改路径的坏值不阻塞本次改动。阻断级词表
SHALL 由 Rust 单一维护，MUST NOT 由前端判定。

patch SHALL 携带设置面 revision（覆盖设置面拥有的键，不覆盖 `providers.<id>.model`、
`harness.provider`、主题等其它写者拥有的键）；锁内现读的 revision 不一致时 SHALL 返回冲突，
文件不动，由用户选择重新载入或以本页为准。以本页为准 SHALL 在当前文件上重新应用同一 patch，
MUST NOT 用打开时的旧快照整份覆盖。

模型清单整表保存时，提交项 SHALL 按 `id` 与当前 raw 清单匹配，并保留该项上除
`id` / `effort` / `vision` / `window` 之外的未知子键；`id` 被重命名时 SHALL 视为新条目
（旧键不跟随）。provider 对象与其它节里不在 patch 路径上的未知键 SHALL 原样保留。

保存成功 SHALL 返回最新快照；面板 SHALL 以返回值重建草稿基线，MUST NOT 以本地推测值充当
已保存状态。保存成功 MUST NOT 被表述为「已生效」：面板 SHALL 按每个字段的生效时机提示
（API Key / 模型 / Base URL / Wire 方言 / 自动压缩 / 子代理 = 下一回合；会话命名 = 下一轮完成；
图片命名 = 关→开需重启、开→关立即）。

保存请求进行中，面板 SHALL 禁用全部编辑控件（输入 / 选择 / 开关 / 模型行增删 / 页级还原 /
provider 切换），MUST NOT 允许请求期间的编辑被返回快照覆盖；保存完成（成功或进入需修正）后
SHALL 解锁。取消动作在保存期间 SHALL 一并禁用。

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

- **WHEN** `config.json` 不存在，打开设置面板、填入合成 Key + 一个合法模型并保存
- **THEN** 快照带一个按空对象计算的 revision；保存成功并创建文件；MUST NOT 因「没有 revision」而无法保存

#### Scenario: raw wire_api 与生效值分开

- **WHEN** 文件里某 provider 的 `wire_api` 是闭集合外的字符串（如 `"chat"`）
- **THEN** 快照的 raw 值仍是 `"chat"`，生效方言为 `responses` 并在面板上标注；保存该字段后
  文件被写为选中值（`responses` 或 `chat_completions`）

#### Scenario: 未知字段被拒绝

- **WHEN** patch 里出现设置面结构未定义的字段（模拟前端 bug）
- **THEN** 命令拒绝该 patch，文件不变；MUST NOT 静默忽略未知字段

#### Scenario: 外部修改触发冲突

- **WHEN** 面板打开后，用另一个编辑器改了 `providers.kimi.models`，再在面板里保存一个开关
- **THEN** 保存返回冲突、文件不动；面板显示「配置文件已在外部修改」并给「重新载入」与
  「仍然保存」两个动作；选「重新载入」后显示外部值

#### Scenario: 未知子键不被旧版 UI 洗掉

- **WHEN** 文件里某模型项除四个已知字段外还有一个未知键，用户只改了同一项的 `window` 并保存
- **THEN** 保存后该未知键仍在原项上（按 `id` 匹配保留）

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
- **THEN** 全部输入 / 选择 / 开关 / 模型行增删 / 页级还原 / provider 切换均为禁用或只读，取消
  也禁用；保存完成后解锁；MUST NOT 出现「请求期间的编辑被返回快照覆盖」或「仍有未落盘修改
  却显示已保存」

### Requirement: 设置面的校验与警告呈现

字段级错误 SHALL 回填到具体控件：控件 SHALL 标 `aria-invalid="true"`，并通过
`aria-errormessage`（或等价的 `aria-describedby`）关联错误文本；保存失败后焦点 SHALL 落到
第一个错误控件。错误文本 SHALL 来自后端诊断，MUST NOT 由前端按控件自行编造。

面板 SHALL 展示**设置面范围内**的配置诊断（模型清单为空、当前模型不在清单、命名目标失效、
Wire 档回落等），每条 SHALL 以可读形式同时展示**键路径**（如
`harness.providers.kimi.model`）与消息；范围外的 warning（主题、编辑器、vault 等）MUST NOT
倒进本面板。整文件回落或文件不可解析时，面板顶部 SHALL 显示横幅并给出文件路径与解析错误
位置；该横幅优先级高于字段级提示。

保存状态（没有未保存的修改 / 有未保存的修改 / 保存中 / 已保存 / 需要修正 / 外部冲突）
SHALL 以可见文本呈现，并进入 `role="status"` 的 polite live region 供辅助技术宣告；
MUST NOT 只用颜色或图标表达。

#### Scenario: 重复 id 回填到行

- **WHEN** 模型清单里两行使用同一个 `id` 并保存
- **THEN** **两行**的 id 控件都标 `aria-invalid="true"` 并各带重复原因，焦点落到第一行；
  状态行显示「需要修正」，文件不变

#### Scenario: 范围外 warning 不进面板

- **WHEN** 配置里 `ui.theme` 为非法值（产生一条 warning），打开设置面板
- **THEN** 面板的警告区不出现这条 warning；它仍在既有 console / 诊断日志出口

#### Scenario: 保存状态可被辅助技术读到

- **WHEN** 保存成功
- **THEN** 状态行文本变为「已保存」，且该文本位于 `role="status"` 的 polite live region 内

### Requirement: 自动化开关

设置面板 SHALL 提供四个自动化开关，逐项显示：名称、一句行为说明、生效时机、敏感性（费用 /
内容出域），以及当前值是否来自默认（键缺席）还是显式设置。默认值 SHALL 为开。

| 开关 | 配置键 | 生效时机 | 敏感性 |
|---|---|---|---|
| 自动压缩 | `harness.auto_compact` | 下一回合 | 费用 |
| 会话命名 | `harness.session_naming.enabled` | 下一轮完成后 | 内容出域 |
| 图片命名 | `harness.attachment_naming.enabled` | 关→开需重启；开→关立即 | 图片与前后文出域 |
| 子代理 | `harness.subagents.enabled` | 下一回合 | 费用 |

图片命名开关的方向不对称 SHALL 在行内写明（「关闭立即生效；重新开启需重启应用」），
MUST NOT 只给一个笼统的「需重启」标记。两个命名开关的 provider / model 细项 MUST NOT 搬进
本面板；它们失效时产生的诊断 SHALL 在自动化节顶部可见，并指明其配置文件路径。

每个开关 SHALL 在键显式存在时提供「恢复默认」（删键），MUST NOT 在键缺席时显示该动作；
键缺席时 SHALL 显示「默认」徽标。

#### Scenario: 关闭自动压缩立即落盘

- **WHEN** 关闭「自动压缩」并保存
- **THEN** `config.json` 的 `harness.auto_compact` 被写为 `false`；下一回合起不再自动压缩；
  再点「恢复默认」保存后该键被删除

#### Scenario: 图片命名的重启不对称

- **WHEN** 把「图片命名」从关切到开并保存
- **THEN** 状态行提示「重启后生效」；把同一开关从开切到关并保存时提示立即生效、不要求重启

#### Scenario: 默认与显式可区分

- **WHEN** `harness.subagents.enabled` 键缺席（默认开），打开自动化节
- **THEN** 该行开关为开，显示「默认」徽标，且 MUST NOT 显示「恢复默认」；用户显式关掉后
  「恢复默认」出现、徽标消失；保存后仍是显式设置；再点「恢复默认」并保存后键被删除、
  徽标重新出现、「恢复默认」再次消失
