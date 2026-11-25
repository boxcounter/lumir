# Delta: harness

## MODIFIED Requirements

### Requirement: Skill 的混合调用、入口策略与候选交互

系统 SHALL 同时提供两条 Skill 调用入口：**用户显式选择**与**模型自主 `skill_load`**。显式选择 SHALL
由后端确定性加载 SKILL.md 全文；模型自主入口 SHALL 保留既有「索引（name + description）→ 模型按相关性
判断 → `skill_load` → 工具结果」链路。任一入口 MUST NOT 以削弱另一入口的默认能力为实现前提。

**两阶段读取边界**：系统 SHALL 区分发现期元数据读取与调用执行期正文加载。发现期为装配索引与解析策略，
当前实现可能通过 `fs::read_to_string` 把整份 SKILL.md 读入内存，但只把文本用于元数据解析（description
保持现有 frontmatter / 无 frontmatter 首行兜底，另加 invocation 字段），不把正文作为调用结果投递；该读取
发生在权限与入口策略判定之前，属于既有索引行为，MUST NOT 被虚称为零 IO。200KB 上限 SHALL 只约束执行期正文
加载，MUST NOT 被用来暗示发现期只读 frontmatter 或只读前 200KB。调用执行期正文加载 SHALL 在权限与策略
放行后调用共享正文加载器，把正文投递到用户消息 part 或工具结果。某一入口因权限 deny、入口策略或非法
元数据被拒绝时，拒绝保证 SHALL 只约束该入口：其执行期正文加载器未被调用、对应输出面无正文，MUST NOT
被表述为发现期也未读取任何 Skill 文件，也 MUST NOT 扩大到另一放行入口。deny 与非法元数据 SHALL 拒绝
两个入口；禁自动 SHALL 只拒绝自动入口并保留显式正文 marker 正向对照；禁手动 SHALL 只拒绝显式入口并保留
自动工具结果正文 marker 正向对照。发现期只读 frontmatter 的优化不在本 change 内，后续优化 MUST NOT 改变
索引行为。

**默认与分控**：每个 Skill 缺省 SHALL 同时允许用户显式选择与模型自主调用。SKILL.md frontmatter SHALL
支持且只支持以下两个 Lumir 调用策略字段：`disable-model-invocation`（缺省 `false`，为 `true` 时禁止模型
自主调用但保留用户显式调用）与 `user-invocable`（缺省 `true`，为 `false` 时禁止用户显式调用但保留模型
自主调用）。这两个字段借用 Claude Code 的拼写，其语义以本规格为准，MUST NOT 被描述为 Agent Skills
标准字段；系统 MUST NOT 另支持 `allow_implicit_invocation`、字段别名、嵌套调用配置或第二套拼写。目录名
SHALL 仍是 Skill 名字的唯一来源。

字段 SHALL 只接受不带引号的布尔字面量 `true` / `false`；只有字段缺失才使用缺省值。重复字段、带引号、
`yes` / `no`、大小写变体或其他非布尔值 SHALL 被视为非法调用元数据，两个入口均 MUST fail closed，以
`skill_invocation_invalid` 明确报告，MUST NOT 调用执行期正文加载器，且各输出面 MUST 无正文；未知
frontmatter 字段 SHALL 按现状忽略。
vault-wide 同名覆盖 user-wide 时，名字、正文来源与策略 SHALL 作为同一发现项整体覆盖。

**发现面投影**：系统提示索引 SHALL 继续列出所有已发现 Skill；默认项的索引文本 SHALL 保持不变，非默认
策略与非法元数据 SHALL 在对应索引项上明确标注。`harness_skills_list` SHALL 复用 `discover_skills` 的
发现与覆盖结果，返回符合 `/` grammar 的 `{name,description,source,user_invocable,model_invocable,
invocation_valid}` 条目且 MUST NOT 暴露绝对路径；候选 SHALL 只显示元数据合法且 `user_invocable = true`
的条目。禁手动条目 SHALL 保留在索引与模型自动入口；禁自动条目 SHALL 保留在 catalog 与显式入口。
发现、索引与候选 MUST NOT 共用错误的可见性过滤。

**显式语义分界**：只有用户从候选中显式选择的 Skill 才构成一次显式调用。消息文本里的 `/名字` 字样本身
MUST NOT 被当作显式调用依据；`/tmp`、`/usr/local` 等斜杠开头路径与普通文本保持原义。调用关系 SHALL
由发送时随当前新消息提交的显式选择元数据表达，按文本位置排序、同名只取首次。后端 MUST NOT 从消息文本
解析技能名。历史消息里的 token / 选择 MUST NOT 在后续轮次重新触发显式注入；重试 SHALL 原样回放该轮输入。

**全名自动接受**：候选打开且 token 前缀逐字等于某项 Skill 全名时，候选 SHALL 直接进入武装态，
`Enter` / `Tab` 接受该项（Alex 2026-11-25 批准的行为变化）。这是**用户按键确认**的显式选择，MUST NOT
被描述为后端从文本推断调用；名字之后继续输入（token 结束）时 `Enter` 回到发送语义。路径前缀不构成全名：
`/tmp` 之于 `tmp-acc` MUST NOT 武装。

**候选、游标与武装**：键入 `/` 且满足边界与名字前缀匹配时 SHALL 显示候选。候选 SHALL 维护**唯一游标**与
**武装**两个状态（定义见 `docs/specs/selector-contract.md` C1 / C4）：游标打开即有，取全名项、按名字保留的
上一项或首项；武装只由显式动作成立——方向键 / `⌃N` / `⌃P`、指针真实移动，或 token 前缀逐字等于全名。
查询变化 MUST NOT 继承武装（全名情形除外）；异步 catalog 回包只允许按名字保留游标，MUST NOT 把未武装的候选
改成武装。未武装时 `Enter` / `Tab` MUST NOT 被候选消费；武装时无修饰的 `Enter` / `Tab` 接受当前项，
`Esc` 关闭，鼠标点击接受且按下时 MUST NOT 夺走输入区焦点。

武装态下无修饰的 `↑` / `↓` 与候选打开时无 Shift 的 `⌃N` / `⌃P` SHALL 经同一路径移动游标（下一项 / 上一项，
到端停住、不环绕），事件 SHALL 被候选消费且 MUST NOT 同时移动 composer caret、改变文档或产生撤销步。
游标由指针移动接管时，揭示滚动把另一行搬到静止指针下面 MUST NOT 改动游标。
候选关闭时的 `⌃N` / `⌃P` SHALL 保留 composer 既有 Emacs 行移动；`⌃⇧N` / `⌃⇧P` SHALL 保留既有扩选，
候选按原有关闭路径结束但 MUST NOT 消费该组合键。带修饰键的同名方向键 MUST NOT 被候选消费；
`⇧↑` / `⇧↓` SHALL 保留原生扩选，扩选使 caret 离开 Skill token 后候选按既有选区同步路径关闭，MUST NOT
为保留候选而阻断或重写原生选区。`Esc` SHALL 走共享浮层层栈，一次只关最上层，MUST NOT 收起面板或移动焦点。

**候选几何与揭示**：真实可见带 SHALL 取 `menuRect ∩ panelRect ∩ viewport`（再扣掉候选自身的边框与
padding），MUST NOT 取候选的 `clientHeight`——菜单盒被祖先裁掉时，盒内坐标会把屏外的行判成可见。候选盒
SHALL 完整落在面板与视口内：面板高度不足时收缩 `max-height`，允许向上覆盖 transcript，垂直夹取宿主
MUST NOT 是 composer 区；行高与高度 MUST 取实测值，MUST NOT 另留一份硬编码行高。下方放置 SHALL 以
控制行顶缘为界，MUST NOT 压住控制行；上翻空间不足时 SHALL 先按上方可用空间收缩 `max-height`，
MUST NOT 让盒底越过 caret；`max-height` 上限的唯一真源 SHALL 是 CSS，上限 MUST 取「清空 inline 后实测的
受约束高度」，MUST NOT 把 `getComputedStyle` 的字符串按 px 解析（百分比等非 px 计算值会被静默误读）。
候选在窗口 / 面板尺寸变化与同状态回包（token / 游标 / items 不变）后 SHALL 按新 clip 重新夹取；
揭示只在游标改变、或重排前完整可见的游标被新几何挤出带时发生，重排 MUST NOT 重建 items、MUST NOT
改动游标，也 MUST NOT 把用户手动滚开的候选位置拉回游标项；重排内部为读数清空 `max-height` 时 MUST 保留
候选自身滚动位置（先记后恢复），已完整可见目标的 `scrollTop` MUST NOT 因此改变。

游标经键盘或指针改变后，当前 option SHALL 完整落在真实可见带内；已完整可见时候选滚动位置 MUST NOT 改变，
越界时 SHALL 只滚动候选到带边缘并保留一行上下文，首尾自然 clamp。首尾、长列表与指针 / 键盘混合输入均
SHALL 满足同一不变量，MUST NOT 通过滚动整页、transcript、编辑器或 composer 完成揭示。候选 SHALL 继续
归滚动条细条档，右缘 12px 内 MUST NOT 新增常驻可交互件。

**候选响应式尺寸**：候选 SHALL 按 composer 宿主可用宽度加宽。令 `avail = max(0, hostWidth − 16px)`、
`cap = min(48em, avail)`、`target = min(max(200px, 0.85 × avail), cap)`，最终宽度 SHALL 为
`min(max(naturalWidth, target), cap)`。窄 pane MUST NOT 越界，正常 pane 的短内容 SHALL 取得可用空间驱动的
目标宽，超宽 pane MUST 受 48em 上限，长描述 SHALL 可超过旧 26em；em 上限 SHALL 随共享 Harness 字号缩放。
该 Skill 专用目标宽与上限 MUST NOT 改写其它 list 浮层的 26em 档。

输入法组合期 MUST NOT 触发候选、响应候选导航键或吞掉确认候选的 `Enter`；组合开始时已打开的候选 SHALL
立即关闭。组合结束后 SHALL 按**最终文档**重算一次候选状态（在 CodeMirror 的 pending MutationRecord 清空
之后），MUST NOT 在 `compositionend` 的同步路径里抢确认 `Enter`。

**选择引用与 chip**：选中后 SHALL 把当前 `/前缀` 替换为 `/完整名 `（尾随一个半角空格），一次选中 MUST
是一条可撤销历史步，并创建名字 + 文档范围的引用。引用 SHALL 随文档编辑映射；范围越界、切片不再逐字节
等于 `/名字` 或左边界失效时，该引用 MUST 失效。撤销 / 重做 SHALL 与文本同事务同步。chip MUST 只由引用
派生，MUST NOT 从文本扫描推断，也 MUST NOT 改文档、选区、复制或投递内容。

前端 SHALL 按 vault 缓存最新成功 catalog：新 `/` 强制刷新；关闭候选后保留；草稿装载异步取一次但不打开
候选；切 vault / 会话复位清空并作废在途；失败不阻断输入且 MUST NOT 误标 chip。最新成功 catalog 中名字
不存在时 chip SHALL 呈缺失态；名字存在但禁手动或元数据非法时 SHALL 呈禁用态并给出不同提示。草稿恢复
SHALL 先按引用重现 chip，不依赖 catalog 成功。

**命名 grammar**：`/` 显式入口 SHALL 只支持 `^[A-Za-z0-9][A-Za-z0-9_-]*$`。前端引用、后端元数据与
清单过滤 SHALL 共用同一 grammar。不符合该 grammar 的名字 SHALL 继续由 `discover_skills` 注入索引；
含点（非点开头）/ 空格 / CJK 的名字 SHALL 继续可供模型自主 `skill_load`，点开头的名字 SHALL 仍按现行
`skill_name_invalid` 被拒绝。本功能 MUST NOT 收紧或改写既有自主发现面。

**显式发送与确定性加载**：发送时前端 SHALL 只提交当前新消息引用，作为 `harness_send` 必填参数
`skills_json`。后端 SHALL 在回合开始时按当回合发现结果解析名字，先以 `skill_load` + 技能名 +
`{"name": <name>}` 调现行权限判定，再检查用户入口策略；只有权限 `Allow`、元数据合法且允许用户调用时
才调用执行期正文加载器。对可加载的名字，系统 SHALL 沿用既有根内路径校验与 200KB 上限加载 SKILL.md
全文，作为独立 `input_text` part 追加到该用户消息末尾；part SHALL 带本地标记 `lumir_skill`，正文以
`[已加载 Skill：<名字>]` 开头。显式与自动入口 SHALL 共用同一执行期正文加载器，MUST NOT 复制第二套路径、
大小或读取逻辑。

权限 `Deny`（或任何非 `Allow`）MUST NOT 调用执行期正文加载器或注入正文；禁手动 SHALL 以
`skill_user_invocation_disabled` 非阻断报告，非法元数据 SHALL 以 `skill_invocation_invalid` 非阻断报告，
两者同样 MUST NOT 调用执行期正文加载器或注入。三种拒绝路径的 `input` / `llm_request.messages` /
provider wire MUST 无正文，且 MUST NOT 伪装成未知名字；用户消息 SHALL 照常发送。未知 / 超限 / 读取失败 /
不合 grammar 的名字 SHALL 跳过且不阻断；`skills_json` 结构非法（非数组 / 非字符串元素 / 坏 JSON）SHALL
以明确错误拒绝发送，不建会话、不入队。

**自动入口策略执行**：默认 Skill 的索引、工具定义、`skill_load` 参数、工具结果与循环顺序 SHALL 不变。
模型对 `disable-model-invocation: true` 的条目调用 `skill_load` 时，系统 SHALL 在现行权限判定后返回
`skill_model_invocation_disabled`，MUST NOT 调用执行期正文加载器，且 SKILL.md 与该 Skill 目录内其他文件
均无正文进入工具结果；发现期元数据读取仍按既有索引路径发生。该策略 MUST NOT 阻止用户显式加载。
`user-invocable: false` MUST NOT 改变模型自主加载。索引策略提示 SHALL 由执行层策略闸兜底，MUST NOT 只
依赖模型自觉遵守提示。

**留存与投影**：显式技能 part SHALL 进入会话 `input` 与 `llm_request.messages`，供重试与恢复原样回放；
本地标记 MUST 在 provider wire 前剥离且保留正文，剥离 MUST 发生在无图片早退之前。面板投影与自动命名
素材（`title::item_text` 与 `title::material` 的首轮 / 最近轮）MUST 跳过显式技能 part。重试 / 恢复 MUST NOT
重新执行显式正文注入；自动压缩 SHALL 把该 part 当作普通消息内容参与摘要，不承诺逐字节保留。模型自主
加载 SHALL 沿用既有工具调用 / 工具结果留存，不新增 `lumir_skill` 用户消息 part，其重试、恢复与压缩行为
MUST NOT 被本 change 改写。

调用策略 SHALL 只约束新调用：草稿引用 MUST NOT 保存策略快照，发送时按当前策略判定；历史恢复 SHALL 原样
灌回最后请求，MUST NOT 按当前策略回写、删除或清洗旧显式正文 / 自动工具结果。显式正文与自动工具结果作为
历史上下文随后续请求发送时 MUST NOT 产生新的显式注入。上下文超限 SHALL 沿用既有压缩机制尽力恢复，系统
MUST NOT 承诺任意数量 / 任意大小的 Skill 都能进入模型上下文。

**权限**：两个入口 SHALL 以同一工具名、技能名和参数经过现行权限判定；同一 tool 级或名字模式 deny 对
显式与自动调用同效，任何非 `Allow` 均不调用执行期正文加载器，显式 `input` / `llm_request.messages` /
provider wire 与自动工具结果均无正文。发现期已完成的元数据读取不属于该执行期断言。显式选择 MUST NOT
改变权限档、跳过批准闸或预批准
Skill 内容引发的 `cli_run`；invocation policy MUST NOT 替代或放宽权限规则。`skill_load` 的读类默认放行
不变，后续 `cli_run` SHALL 沿用现行档位、规则、命令分类与缓存。

**系统提示与验收口径**：系统提示 SHALL 说明显式加载段头的含义、斜杠路径不是显式调用、默认 Skill 仍可
自主 `skill_load`，以及禁自动条目应请用户显式选择。提示装配单测 SHALL 断言约定与索引策略标记确实进入
系统提示。mock 场景 SHALL 只用于证明注入、留存、投影、策略执行与发送链路，MUST NOT 被表述为证明真实
模型遵守提示；真实遵守率只作 dogfood 观察，不进入机器门禁。

#### Scenario: 默认 Skill 双入口均可用

- **WHEN** 一个 Skill 未声明两个调用策略字段
- **THEN** 它按现有口径进入系统提示索引并可由模型自主 `skill_load`；同时出现在用户候选中，显式选择后
  由后端确定性加载全文；默认索引条目不增加策略标记

#### Scenario: 显式选择确定性注入

- **WHEN** 用户键入 `/acc-skill-a` 后按 `↓` 进入选择态、按 `Enter` 选中 `acc-skill-abc`，然后发送
- **THEN** 首个 `llm_request.messages` 的该用户消息含一个带 `lumir_skill` 标记的 part，正文含
  `[已加载 Skill：acc-skill-abc]` 与 SKILL.md 正文；无需模型再次调用 `skill_load`；面板 AX 不含正文标记

#### Scenario: 手打名字但不选择不做显式注入

- **WHEN** 用户完整键入 `/acc-skill-abc 问题`（名字后跟空格与正文，token 已结束）并发送
- **THEN** 候选此时不显示；消息照常发出，该用户消息不含 `lumir_skill` 或显式注入正文；模型自主入口是否
  按既有逻辑调用不受该文本 token 强制。名字后未继续输入、caret 仍在 token 内时按「全名自动接受」场景处理。

#### Scenario: 绝对路径不被误判

- **WHEN** vault 内存在名为 `tmp-acc` 的技能，用户在行首、空格后或列表项里键入 `/tmp` 后直接按 `Enter`
- **THEN** 消息照常发送对应文本；`llm_request.messages` 不含 `lumir_skill`；候选即使出现也不消费该 Enter

#### Scenario: 被动候选不抢 Enter 与 Tab

- **WHEN** 候选已显示（可能带自动视觉游标）但尚未武装，用户按 `Enter` 或 `Tab`
- **THEN** Enter 按原语义发送、Tab 按原语义处理；消息不因候选打开而被拦截或改写，也不创建 Skill 引用

#### Scenario: 全名键入即武装 Enter 接受

- **WHEN** 用户逐字键入 `/tmp-acc`（该名字恰好是候选的全名），caret 仍在 token 内
- **THEN** 候选游标指向 `tmp-acc` 且进入武装态；`Enter` 或 `Tab` 把它替换为 `/tmp-acc ` 并创建引用，
  与方向键选中走同一接受路径

#### Scenario: 视觉高亮不等于接受承诺

- **WHEN** 用户键入 `/acc`（两项候选）后直接按 `Enter`，未按方向键、未移动指针
- **THEN** 首选行有可见游标但候选未武装，`Enter` 发送普通文本；随后按 `↓` 再按 `Enter` 才接受第二项

#### Scenario: 异步 catalog 只补高亮不武装

- **WHEN** 候选因 catalog 在途而不显示，用户键入 `/acc`；catalog 回包后才出现两项候选
- **THEN** 首项获得视觉游标，但候选仍未武装，`Enter` 仍发送普通文本；只有方向键、指针移动或全名命中
  才改变武装态

#### Scenario: 选择态键位与 IME

- **WHEN** 候选已武装，用户使用方向键 / Ctrl+N / Ctrl+P / Enter / Tab / Esc；另一次在中文输入法组合期键入或确认
- **THEN** 候选只消费相应导航与选中键，Ctrl+N / Ctrl+P 与方向键分别同义且不改 composer caret 或文档；
  Esc 只关候选；组合期不触发、不导航、不吞确认 Enter，组合开始关闭已有候选；组合结束后按最终文档重算
  一次候选状态（最终文档是全名时武装，但仍不抢组合确认的那拍 Enter）

#### Scenario: Shift+Arrow 保留原生扩选并关闭候选

- **WHEN** 候选已显示，caret 位于多行 composer 的 Skill token 末尾，用户按 `⇧↑` 或 `⇧↓`
- **THEN** 事件不被候选消费，原生扩选非空且文档不变；caret 离开 Skill token 后候选按既有选区同步路径关闭

#### Scenario: 长列表高亮始终可见且不带动整页

- **WHEN** 候选长度覆盖不足一屏、恰好一屏与超出一屏，用户用两类键盘从首项到末项再返回，并在中部交替使用指针与键盘
- **THEN** 每次游标改变后当前 option 均完整落在 `menuRect ∩ panelRect ∩ viewport` 内；已可见时滚动位置不变，
  越出时只滚动候选到带边缘并保留一行上下文；游标不环绕，整页、transcript、编辑器与 composer 的滚动位置不变

#### Scenario: 可见最底项再移一项

- **WHEN** 长列表打开时游标停在最后一个完整可见行，用户再按一次 `↓`
- **THEN** 下一项完整进入真实可见带，且它与带底之间保留一行上下文；候选 `scrollTop` 增大，祖先与页面的
  滚动位置不变

#### Scenario: 短视口收缩态连续导航

- **WHEN** 视口高度不足、候选已按可用空间收缩且列表真实溢出，用户连续按 `↓` 到末项再连续按 `↑` 回到首项
- **THEN** 每一拍高亮项仍完整落在真实可见带内；按键前已完整可见的目标，其 `scrollTop` 不变——重排为读数
  清空 `max-height` 造成的钳制 MUST NOT 泄漏到揭示判据

#### Scenario: 窗口缩放与同状态回包后的重排

- **WHEN** 候选打开时把窗口缩放到面板高度大幅缩短，或候选打开期间发生一次不改变 token / 游标 / items 的
  文档回包（同状态同步）
- **THEN** 候选盒按新的 `menuRect ∩ panelRect ∩ viewport` 重新夹取、必要时收缩 `max-height`；重排前完整
  可见的高亮项仍完整可见，候选 items 不重建（option 节点不变），游标与 `aria-selected` / `data-armed` /
  `aria-activedescendant` 均不变

#### Scenario: 手动滚开后的重排不拉回高亮项

- **WHEN** 用户先把候选向上滚开（高亮项已不在可见带内），随后发生同状态回包，或窗口 / 面板尺寸变化
- **THEN** 候选 `scrollTop` 保持用户滚到的位置，揭示不发生，高亮项不被搬回视野；只有新的几何把原本
  完整可见的游标挤出带时才按最小揭示把它带回带内，且 MUST NOT 借机回弹到高亮首项

#### Scenario: 三类宿主宽度与三主题下的响应式尺寸

- **WHEN** 在 light / dark / eink 下分别把 Harness pane 置于窄、正常、超宽可用宽度，并显示短描述与长描述候选
- **THEN** 短内容宽度随可用空间增长，长内容可超过 26em 但不超过 48em 或 pane 可用宽；菜单始终不越出宿主，
  其它 list 浮层宽度不变

#### Scenario: 候选关闭后 `⌃N` / `⌃P` 保留行移动

- **WHEN** 候选未打开，composer 光标位于多行文本中，用户按 `⌃N` 或 `⌃P`
- **THEN** 光标按输入区既有行移动语义处理，事件不被候选消费，消息不发送、文本不变

#### Scenario: 选中后改文本使引用失效

- **WHEN** 用户选中 `acc-skill-abc` 后删掉名字中的一个字符并发送
- **THEN** 该引用失效，不注入、无 chip；消息按修改后的文本正常发送

#### Scenario: 禁自动但允许显式

- **WHEN** 含唯一 body marker 的 `acc-deploy` 声明 `disable-model-invocation: true`，模型调用
  `skill_load("acc-deploy")`；随后用户从候选显式选择该 Skill 并发送
- **THEN** 发现期已取得索引与策略元数据；模型调用返回 `skill_model_invocation_disabled`，仅自动入口的
  执行期正文加载器未被调用，SKILL.md 与目录内其他文件均无正文 marker 进入工具结果；用户显式入口仍调用
  加载器，`input` / `llm_request.messages` / provider wire 均有 body marker

#### Scenario: 禁手动但允许自动

- **WHEN** 含唯一 body marker 的 `acc-background` 声明 `user-invocable: false`，用户打开候选并尝试经旧
  引用显式发送；模型随后自主调用 `skill_load("acc-background")`
- **THEN** 该 Skill 不出现在候选，索引仍列出并标注禁手动；仅显式入口的执行期正文加载器未被调用，
  `input` / `llm_request.messages` / provider wire 无 marker；自动入口仍调用加载器且工具结果有 body marker

#### Scenario: 旧引用不能绕过禁手动

- **WHEN** 一个引用创建后，对应 Skill 改为 `user-invocable: false`，用户恢复草稿并发送
- **THEN** chip 呈禁用态；后端不调用执行期正文加载器、不注入，`input` / `llm_request.messages` /
  provider wire 无正文，并给出 `skill_user_invocation_disabled` 非阻断提示；模型自主入口仍可用

#### Scenario: 非法调用元数据 fail closed

- **WHEN** 一个 Skill 的调用策略字段重复、带引号、写为 `yes` 或其他非 `true` / `false` 值
- **THEN** 发现期已解析出非法状态；两个入口均返回 / 报告 `skill_invocation_invalid`，执行期正文加载器
  未被调用，显式 `input` / `llm_request.messages` / provider wire 与自动工具结果均无正文；系统不得按字段
  缺失的默认开放值处理；未知 frontmatter 字段不产生该错误

#### Scenario: 自动入口默认行为不削弱

- **WHEN** Skill 根下存在某外部搜索技能且 Alex 提问需要联网搜索，该 Skill 未禁自动
- **THEN** 模型可见技能索引条目，经 `skill_load` 取得用法后经 `cli_run` 调用对应 CLI；
  工具结果与既有留存形态不变

#### Scenario: 权限判定对两个入口一致

- **WHEN** 含唯一正文 marker 的 SKILL.md 已在发现期被成功读取并解析出 description / 策略后，配置
  `deny = ["skill_load"]` 或 `deny = ["skill_load(<name>)"]`，在任一权限档分别经显式选择与模型自主调用
  加载同一 Skill
- **THEN** 两个入口的执行期正文加载器均未被调用；显式路径不注入且 `input` / `llm_request.messages` /
  provider wire 无 marker，自动工具结果无 marker；同一命中规则原文按各入口既有错误面报告；
  不得用文件系统零读取作为该拒绝路径的判据

#### Scenario: 显式选择不改变后续命令权限

- **WHEN** 用户在任一权限档显式选择一个 Skill，且技能内容引导模型执行一条写操作命令
- **THEN** `cli_run` 沿用现行档位 / 规则 / 命令分类 / 缓存；该请求批准就请求批准，该自动放行就自动放行；
  显式选择不改变判定输入或结果

#### Scenario: 恢复与策略变更不重写历史

- **WHEN** 会话已含显式技能 part 与自动 `skill_load` 工具结果，随后 Skill 被改为禁自动 / 禁手动并恢复会话
- **THEN** 最后一条 `llm_request.messages` 原样灌回，旧显式正文与自动工具结果仍在历史且不被回写；
  面板仍不显示显式正文；只有恢复后的新调用按当前策略拦截

#### Scenario: 重试与压缩不重新显式注入

- **WHEN** 带显式技能 part 的轮次被重试或自动压缩
- **THEN** 重试原样回放 `input`，显式预加载器不再次执行；压缩把正文作为普通内容参与摘要，新会话只接收
  摘要且不重新显式注入，不承诺正文逐字节保留

#### Scenario: 未知名字与非法发送元数据

- **WHEN** 引用名字在发送时已不存在；或 `skills_json` 不是字符串数组
- **THEN** 前者跳过注入、发送照常且无阻断性错误；后者以明确错误拒绝发送，不建会话、不入队

#### Scenario: grammar 之外的名字仍可自主使用

- **WHEN** Skill 根下存在名字含点 / 空格 / CJK / 点开头的技能
- **THEN** 清单与候选不含它们；系统提示索引仍列出；含点（非点开头）/ 空格 / CJK 的名字仍可被模型自主
  `skill_load`，点开头的名字仍按现行 `skill_name_invalid` 被拒绝

#### Scenario: 无图片消息也剥离本地标记

- **WHEN** 一条只有用户文本 + 显式技能 part、没有任何图片引用的消息被发送
- **THEN** provider wire 的 text part 不含 `lumir_skill` 字段、正文仍在；附件目录不被解析或创建

#### Scenario: 自动命名素材不含显式技能正文

- **WHEN** 首轮或最近轮的用户消息带 `lumir_skill` part，标题生成读取 `title::material`
- **THEN** 命名素材只含用户提问文本与既有问答，不含显式技能正文

#### Scenario: 提示约定与策略标记进入系统提示

- **WHEN** 发起新会话并读取装配后的系统提示，Skill 清单含默认、禁自动、禁手动与非法元数据条目
- **THEN** 身份段含显式段头、斜杠路径与混合调用约定；默认条目不增加策略标记，其他条目分别标注；
  固定段字节指纹与装配清单同步
