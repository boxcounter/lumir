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

### Requirement: 设置写通道

设置面板 SHALL 使用窄接口读写，MUST NOT 复用「前端取整份配置 → 改 → 整份写回」的形态。

读 SHALL 为一份只含设置面的快照，至少区分：provider 条目（id / 预设 / 可用状态 / 引用面）、
键缺席（跟随默认）与键显式存在、raw 文件值与装载后的生效值（`wire_api` 的 raw SHALL 是文件里
的原 JSON 值，生效方言另给 `effective.wire_api`）、API Key 的「已配置」状态（不含完整值）、
当前使用项、两个命名目标的解析结果、`harness.web_access.enabled` / `.approval` 的 raw 与生效值、
Web Invalid 诊断及实际 provider 状态、`harness.permissions.deny` 中规范 `web_fetch(origin)` 列表、
文件状态（缺失 / 可解析 / 不可解析）。快照 SHALL 在顶层携带 `revision`：所有非 Invalid 快照都有
（文件缺失把文件视为空对象、按同一 revision 算法计算，首次接入也能填 `base_revision`），
Invalid 时为空、保存禁用。快照 SHALL 同时下发前端需要的默认值与能力矩阵（预设的官方 Base URL /
支持的 Wire 档 / 是否要求 Key / 缺省 Wire、`window` 上下限、id 字符集与保留 id、Web approval 枚举），
前端 MUST NOT 复制这些常量或取值区间。

写 SHALL 为一次强类型 patch：字段类型在 IPC 边界由 Rust 结构定义，未知字段 SHALL 被拒绝；
patch SHALL 只携带本次改动的字段，MUST NOT 携带整份配置。patch SHALL 支持三类 provider 编辑：
添加（id + 预设）、更新（Key / 模型清单 / Base URL / Wire 方言）、删除（含替代目标与命名
目标重定向）；`harness.provider` SHALL 可作为同一笔 patch 的一部分设置或删除。patch SHALL 另
支持两个命名目标的 `provider` / `model` 覆盖键（写入或删键）：删 provider 键 = 跟随当前、
删 model 键 = 用目标 provider 的生效模型；写入的 provider SHALL 是合法、非 `mock`、未被装载期
忽略的条目，写入的 model SHALL 在目标 provider 的清单内；换 provider SHALL 清除该组 model
覆盖（同一笔里显式写入的 model 按新目标校验）。开关关闭 MUST NOT 使 patch 删除或清空这两个
键。同一笔 patch 中，添加项的 id MUST NOT 等于本笔删除项的 id（id 复用 SHALL 拆成两次保存，
MUST NOT 依赖处理顺序）。patch SHALL 支持 `harness.web_access.enabled` 与 `.approval` 的写入 /
删键（删键分别回到 true / allow_all），并支持 `add_origin` / `remove_origin` / `clear_origins`
操作既有 `harness.permissions.deny` 中规范 `web_fetch(origin)`；origin 操作 MUST NOT 改 allow、
其它 deny 或未知 / 非规范规则，权限表错形状 MUST NOT 被静默重置为空。`clear_origins=true` MUST NOT
与 `add_origin` / `remove_origin` 同 patch；同一规范 origin MUST NOT 同时 add / remove，是否相同 SHALL
在 origin 规范化后判定，仅大小写、默认 port、path 等字面差异不构成不同 origin。不同 origin 的 add /
remove 可以同 patch。两类冲突 SHALL 返回 `settings_patch_invalid`，文件逐字节不变且 revision 不推进，
MUST NOT 依赖 add / remove / clear 的处理顺序。校验 SHALL 以 Rust 的装载期校验为唯一来源；前端 MUST NOT
在 TypeScript 里复制窗口区间、枚举表、id 规则或互斥关系，只做输入整形（数字输入、trim、按能力矩阵
置灰选项）。

保存 SHALL 在配置写锁内完成「严格读文件 → 校验 revision → 应用 patch（添加 / 更新 / 删除 /
重定向 / active / 命名目标 / 开关 / Web 两键 / origin deny）→ 以装载同一路径重新解析并校验 →
原子写」这一整段，MUST NOT 出现 check-then-write 窗口。文件缺失按空对象处理；文件不是合法 JSON、
或结构解析在装载期会触发整文件回落时，保存 SHALL 被拒绝（面板只读并给出解析错误位置），
MUST NOT 在不可 round-trip 的文件上写入。权限 writer SHALL 支持 deny 的新增、精确删除与定向清空；
`clear_origins` 只清规范 `web_fetch(origin)`，不得把整个 deny 数组清空。

保存 SHALL 满足**非回归**判据：把 patch 合并到当前 raw JSON 后，以装载同一路径解析并校验；
**任何**与 patch 改动路径相交的阻断级诊断 SHALL 拒绝整笔保存（不看 baseline 是否已有同一条；
`window: 0 → 10000001` 这类「非法换另一种非法」同样拒绝），文件逐字节不变，错误回填到具体
字段。baseline 只豁免**未改路径**上的既有诊断：未改路径的坏值不阻塞本次改动。已有
`web_access_config_invalid` 时，显式写入合法 Web 值 SHALL 可作为修复保存；非法 Web patch SHALL
拒绝且文件不变。阻断级词表 SHALL 由 Rust 单一维护，MUST NOT 由前端判定。

patch SHALL 携带设置面 revision（覆盖 provider 条目、`harness.provider`、四个自动化开关与
两个命名目标的 provider / model 键、`harness.web_access.enabled` / `.approval`，以及
`harness.permissions.allow` / `deny`；不覆盖由 chip 写回的 `providers.<id>.model`）；锁内现读的
revision 不一致时 SHALL 返回 `settings_revision_conflict`，文件逐字节不变，由用户选择重新载入或
以本页为准。以本页为准 SHALL 在当前文件上重新应用同一 patch，MUST NOT 用打开时的旧快照整份覆盖。

模型清单整表保存时，提交项 SHALL 按 `id` 与当前 raw 清单匹配，并保留该项上除
`id` / `effort` / `vision` / `window` 之外的未知子键；`id` 被重命名时 SHALL 视为新条目
（旧键不跟随）。provider 条目里不在 patch 路径上的未知键、以及文件里其他节的未知键 SHALL
原样保留。装载期被忽略的非法 provider 条目 MUST NOT 因其他条目的保存而被删除或改写。

保存成功 SHALL 返回最新快照；面板 SHALL 以返回值重建草稿基线，MUST NOT 以本地推测值充当
已保存状态。保存成功 MUST NOT 被表述为「已生效」：面板 SHALL 按每个字段的生效时机提示
（provider 条目 / 当前使用项 / 自动压缩 / 子代理 / Web 两键与 origin deny = 下一回合；
会话命名开关 = 下一次评估触发点，结果异步落盘；图片命名开关 = 关→开需重启、开→关立即；
两个命名目标 = 下一次评估触发点 / 下一次粘贴）。MUST NOT 写「每轮生成」或「下一轮必定生效」。

保存请求进行中，面板 SHALL 禁用全部编辑控件（输入 / 选择 / 开关 / 命名目标选择 / 模型行增删 /
添加 provider / 删除 / 设为当前使用 / 逐项恢复默认 / 页级还原 / 底栏「取消」），MUST NOT 允许请求期间的编辑被返回
快照覆盖；保存完成（成功或进入需修正）后 SHALL 解锁。

#### Scenario: 矛盾的 origin 组合不依赖处理顺序

- **WHEN** 同一 patch 携带 `clear_origins=true` 与 `add_origin` 或 `remove_origin`，或同时 add / remove
  同一 origin（包括仅在 canonicalization 后才相同的非规范字面输入）
- **THEN** 保存返回「需要修正」与 `settings_patch_invalid`；`config.json` 逐字节不变，revision 不推进；
  MUST NOT 按 add / remove / clear 的某种私有顺序产生结果

#### Scenario: 不同 origin 可在同一 patch 添加与移除

- **WHEN** 同一 patch 以可规范化的非规范字面输入 add 一个 origin、remove 另一个 origin
- **THEN** 保存成功，add 按规范 origin 去重追加，remove 精确删除对应规范 deny；其它 deny、allow 与
  非规范规则保持原样，revision 正常推进

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
- **THEN** 全部输入 / 选择 / 开关 / 命名目标选择 / 模型行增删 / 添加 / 删除 / 设为当前使用 /
  页级还原 / provider 切换均为禁用或只读，「取消」（关闭）也禁用；保存完成后解锁；MUST NOT 出现「请求期间的编辑被
  返回快照覆盖」或「仍有未落盘修改却显示已保存」

#### Scenario: Web 与 origin 并发 revision 冲突不覆盖

- **WHEN** 两个设置快照取同一 revision，A 修改 `web_access.approval`，B 新增 / 删除 / 清空 origin，
  两笔 `settings_apply` 以该 revision 并发到达
- **THEN** 只有一笔成功，另一笔返回 `settings_revision_conflict`；revision 已推进，失败方文件逐字节
  不变，不出现 approval 被旧快照覆盖、deny 半合并或清空非目标规则；以本页为准只在当前文件重应用 patch

#### Scenario: deny 单项删除与定向清空保留其它规则

- **WHEN** deny 含两个规范 `web_fetch(origin)`、其它工具 deny 与未知 / 非规范项，allow 非空，
  用户先 `remove_origin` 再 `clear_origins`
- **THEN** 第一次只删目标 origin，第二次只清剩余规范 Fetch origin；allow、其它 deny 与未知 / 非规范项
  原样保留，权限表不被重置为空，成功快照带新 revision

#### Scenario: 非法 Web 配置合法修复与非法 patch 拒绝

- **WHEN** 文件已有 `web_access_config_invalid` 及 provider / origin deny，用户先提交非法 approval，
  再改为合法 `ask` 保存
- **THEN** 非法 patch 被拒且文件不变；合法修复成功且只改 Web 键，provider 与 origin deny 保留，
  不得变成 enabled=true / allow_all 或清空 deny

## ADDED Requirements

### Requirement: 网页访问设置

设置面板的自动化节 SHALL 另含独立的「网页访问」网络授权区，不改变四个自动 LLM 开关的数量、
顺序或归属。该区 SHALL 提供 `harness.web_access.enabled`（缺省 `true`）与
`harness.web_access.approval`（缺省 `allow_all`，可选 `ask`）。默认 SHALL 注册并直接执行
`web_search` / `web_fetch`；显式 `enabled=false` 才不注册，`approval=ask` 才进入批准闸。
设置快照 / patch / revision SHALL 覆盖两键，改动 SHALL 经既有 `settings_apply` 原子写通道在下一回合
生效，provider 增删 / 切换不重置它们。恢复默认 = 删键，页级还原同样删键且不要求重启；
页级还原 MUST NOT 顺带清空 origin deny。关闭只隐藏工具，MUST NOT 删除 provider、deny 或历史。
只有表 / 键缺失才使用上述默认值；整表错形状、enabled 非布尔、approval 非字符串 / 未知枚举 SHALL
显示 `web_access_config_invalid`，安全读数为 enabled=false / ask，不注册、零请求，provider、origin
deny 与其它配置不变。用户以显式合法值修复前 MUST NOT 变成 enabled=true / allow_all。

网页访问区 SHALL 复用 Web provider 的同一解析口，只读显示实际 provider id、官方 DeepSeek / 未配置 /
配置歧义 / 自定义 base URL 等状态。它 SHALL 提供「前往模型接入」动作并选中对应 provider 表单；
未解析出条目时跳回模型接入的 DeepSeek 管理面。该区 MUST NOT 显示或复制 API Key、provider 配置或
endpoint，也 MUST NOT 提供第二 provider 选择器。

网页访问区 SHALL 列出既有 `harness.permissions.deny` 中规范的 `web_fetch(origin)`，默认空，
并支持新增封禁、单独移除 deny 与「全部清空」。这些操作 SHALL 统一走 `settings_apply` patch 的
`add_origin` / `remove_origin` / `clear_origins`，与 Web 两键共用 snapshot / revision 和同一写锁，
MUST NOT 另建 origin 表、复制规则到 `web_access` 或误改 allow / 其它 deny / 非规范规则。
清空只清规范 `web_fetch(origin)`；权限表错形状不得被静默重置为空。revision 冲突 SHALL 返回
`settings_revision_conflict` 且文件逐字节不变。移除 / 清空只影响 deny：在默认 `allow_all` 下恢复允许，
在 `ask` 下恢复 Ask，MUST NOT 暗中重置 approval 或重写会话历史。

默认 Allow SHALL NOT 被表述为网页可以修改授权。该区与工具结果 SHALL 持续显示 query / URL、provider、
费用、Lumir 预检 + DeepSeek 双路外发与 untrusted 提示；只有 `approval=ask` 时才显示批准卡，
其依据 SHALL 为独立 `WebAccessPolicy{approval:"ask"}`，不得复用 `ModeDefault` 或 full_access 档释义。
Web 专用持久 allow / 免问动作 MUST NOT 作为本区状态生成，origin 例外只来自上述 deny 规则。

#### Scenario: 默认启用与全局关闭

- **WHEN** `harness.web_access.enabled` 与 `.approval` 均缺省，随后用户显式关闭 Web
- **THEN** 缺省为 `enabled=true, approval=allow_all`，两件工具注册并直接执行；关闭后的下一回合
  不注册、幻觉调用 `tool_unknown` 且零网络请求，provider / origin deny / 历史保持不动

#### Scenario: 切换 Ask 不改变硬边界

- **WHEN** 用户把 approval 从缺省 `allow_all` 改为 `ask`，随后再恢复默认
- **THEN** Ask 时批准预览显示完整 query / URL、provider、双路外发与费用；恢复默认删除该键并回到
  直接执行。两种策略都继续执行 no_proxy、URL / DNS / redirect、预算、密钥与重试校验

#### Scenario: 非法配置可见且 fail closed

- **WHEN** 文件已有 provider 与 origin deny，随后出现 `enabled:"yes"`、`approval:"always"` 或整表为字符串
- **THEN** 网页访问区显示 `web_access_config_invalid`，安全读数为 enabled=false / ask，不注册、零请求；
  provider 与 deny 不变，不得静默改为 enabled=true / allow_all；显式合法值修复后才恢复注册

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
