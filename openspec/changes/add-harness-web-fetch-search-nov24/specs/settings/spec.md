## MODIFIED Requirements

### Requirement: 设置面板的形态与范围

应用 SHALL 提供一个模态设置面板，经命令 `app.settings-open` 打开（命令、默认键位与应用菜单
入口的规格见 `keymap-commands` 的「设置面板入口」条）。面板 SHALL 是打开后覆盖在既有内容之上、
关闭即消失的浮层类弹出物，适用 `docs/specs/overlay-visibility.md` 的 O1–O5：打开即完整可见、
完整落在视口内、不被祖先裁切、不先开后收。

面板 SHALL 只包含两节，顺序固定：**模型接入**与**自动化**。模型接入 SHALL 含 provider 列表
（可添加 / 选择 / 删除）与选中项的编辑表单；表单含基础区（API Key 与模型清单）与默认折叠的
高级区（预设、Base URL 与 Wire 方言），危险区提供删除该 provider。自动化 SHALL 含四个自动 LLM
开关：自动压缩、会话命名、图片命名、子代理，以及两个命名调用**各自内联**的目标选择（provider /
模型）与一行生效说明；另含独立的「网页访问」网络授权区（见「网页访问设置」），该区不改变四个
自动 LLM 开关的数量、顺序或归属。其余配置键（主题、语言、字号、折行、栏宽、权限模式与规则、
vault 忽略规则、键位、cron、日志等级、`editor.*`）MUST NOT 在本面板渲染、MUST NOT 在本面板写回
——本面板不是配置总览，也不是通用 schema 表单。唯一例外是「网页访问」区展示与管理既有
`web_fetch(origin)` deny；其它权限模式与规则仍不得在本面板渲染或写回。

面板 SHALL 是**单页两节**：两节自上而下排布，MUST NOT 引入 TAB、分段导航或侧边栏；MUST NOT
渲染编辑器 / 权限设置页，也 MUST NOT 为未做的设置留空壳入口。

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
`Escape`、点击遮罩、再次触发 `app.settings-open`、点击底栏「取消」四条路径 SHALL 均可关闭；关闭后焦点 SHALL
交还打开前的元素。面板有未保存修改时，关闭动作 SHALL 先转为「放弃未保存的修改？」的两步确认，
MUST NOT 静默丢弃草稿。

底栏按钮的名称 SHALL 是「取消」（Cancel），语义只有关闭：干净草稿直接关闭，脏草稿先走上面的两步
确认，保存请求进行中 SHALL 禁用。MUST NOT 有「把草稿恢复成已保存内容」的第三条语义——放弃修改
一律走关闭路径，重新打开时草稿按已保存值重建；面板 MUST NOT 另有「恢复已保存配置」的按钮或兼容
入口。

#### Scenario: 打开只看到两节

- **WHEN** 按 `⌘,` 打开设置面板
- **THEN** 面板内只有「模型接入」与「自动化」两节；模型接入里能看到 provider 列表与选中项的
  编辑表单，自动化节能看到四个自动 LLM 开关、其内联目标选择与独立的「网页访问」区；主题、语言、
  字号、权限、忽略规则、键位、cron 等配置 MUST NOT 出现在面板里，除 `web_fetch(origin)` deny 外
  不渲染权限规则；面板没有 TAB / 侧边导航，也没有编辑器 / 权限设置页或点不开的空壳入口

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

#### Scenario: 四条关闭路径与焦点交还

- **WHEN** 打开设置面板时分别按 `Escape`、点击遮罩空白处、再按一次 `⌘,`、点击底栏「取消」
- **THEN** 四种操作都关闭面板；关闭后焦点回到打开前的元素（编辑器 / 触发按钮）

#### Scenario: 脏面板关闭需确认

- **WHEN** 修改了自动压缩开关后按 `Escape`
- **THEN** 面板不关闭，出现「放弃未保存的修改？」的两步确认；选「继续编辑」保留草稿，
  选「放弃」关闭面板且 `config.json` 逐字节不变

#### Scenario: 取消等于关闭（脏草稿先确认）

- **WHEN** 把自动压缩开关关掉（草稿变脏）后点底栏「取消」
- **THEN** 面板不关闭、不写盘，出现与 `Escape` 相同的「放弃未保存的修改？」两步确认；选「继续编辑」
  保留草稿（开关仍是关、状态仍是「有未保存的修改」）；再点「取消」并选「放弃修改」后面板关闭，
  `config.json` 逐字节不变，重新打开时开关按已保存值显示为开；面板干净时点「取消」直接关闭、
  不出现确认；保存请求进行中「取消」禁用

## ADDED Requirements

### Requirement: 网页访问设置

设置面板的自动化节 SHALL 另含独立的「网页访问」网络授权区，不改变四个自动 LLM 开关的数量、
顺序或归属。该区 SHALL 提供 `harness.web_access.enabled`（缺省 `true`）与
`harness.web_access.approval`（缺省 `allow_all`，可选 `ask`）。默认 SHALL 注册并直接执行
`web_search` / `web_fetch`；显式 `enabled=false` 才不注册，`approval=ask` 才进入批准闸。
设置快照 / patch / revision SHALL 覆盖两键，改动 SHALL 经既有 `settings_apply` 原子写通道在下一回合
生效，provider 增删 / 切换不重置它们。恢复默认 = 删键，页级还原同样删键且不要求重启；
页级还原 MUST NOT 顺带清空 origin deny。关闭只隐藏工具，MUST NOT 删除 provider、deny 或历史。

网页访问区 SHALL 复用 Web provider 的同一解析口，只读显示实际 provider id、官方 DeepSeek / 未配置 /
配置歧义 / 自定义 base URL 等状态。它 SHALL 提供「前往模型接入」动作并选中对应 provider 表单；
未解析出条目时跳回模型接入的 DeepSeek 管理面。该区 MUST NOT 显示或复制 API Key、provider 配置或
endpoint，也 MUST NOT 提供第二 provider 选择器。

网页访问区 SHALL 列出既有 `harness.permissions.deny` 中规范的 `web_fetch(origin)`，默认空，
并支持新增封禁、单独移除 deny 与「全部清空」。写入 SHALL 复用权限规则治理的原子写通道与 revision，
MUST NOT 另建 origin 表、复制规则到 `web_access` 或误删其它规则。移除 / 清空只影响 deny：
在默认 `allow_all` 下恢复允许，在 `ask` 下恢复 Ask，MUST NOT 暗中重置 approval 或重写会话历史。

默认 Allow SHALL NOT 被表述为网页可以修改授权。该区与工具结果 SHALL 持续显示 query / URL、provider、
费用、Lumir 预检 + DeepSeek 双路外发与 untrusted 提示；只有 `approval=ask` 时才显示批准卡。
Web 专用持久 allow / 免问动作 MUST NOT 作为本区状态生成，origin 例外只来自上述 deny 规则。

#### Scenario: 默认启用与全局关闭

- **WHEN** `harness.web_access.enabled` 与 `.approval` 均缺省，随后用户显式关闭 Web
- **THEN** 缺省为 `enabled=true, approval=allow_all`，两件工具注册并直接执行；关闭后的下一回合
  不注册、幻觉调用 `tool_unknown` 且零网络请求，provider / origin deny / 历史保持不动

#### Scenario: 切换 Ask 不改变硬边界

- **WHEN** 用户把 approval 从缺省 `allow_all` 改为 `ask`，随后再恢复默认
- **THEN** Ask 时批准预览显示完整 query / URL、provider、双路外发与费用；恢复默认删除该键并回到
  直接执行。两种策略都继续执行 no_proxy、URL / DNS / redirect、预算、密钥与重试校验

#### Scenario: provider 只读显示并跳回模型接入

- **WHEN** 网页访问区解析出实际 DeepSeek provider id，用户点击「前往模型接入」
- **THEN** 模型接入选中同一条目，网页访问区不显示或复制 Key / endpoint，也不存在第二 provider
  选择器；解析状态与工具执行使用同一结果

#### Scenario: origin deny 单独移除与全部清空

- **WHEN** 权限 deny 含两个 `web_fetch(origin)` 规则及其它工具规则，用户先移除一个 origin，
  随后清空剩余 origin
- **THEN** 两次都经既有权限写通道精确删除目标 deny，其它规则不变；默认 `allow_all` 下恢复允许，
  `ask` 下恢复 Ask，approval 不被暗改，且不产生第二份 origin 状态

#### Scenario: 默认无批准卡但审计完整

- **WHEN** approval 缺省为 `allow_all`，模型连续搜索并抓取多个 origin
- **THEN** 不出现逐次批准卡，跨 origin 经完整硬校验与 deny 判定后直接执行；工具行 / 结果仍保留
  完整 query / URL、provider、费用与 `trust:"untrusted"`，设置区不会把该行为描述为网页可改授权
