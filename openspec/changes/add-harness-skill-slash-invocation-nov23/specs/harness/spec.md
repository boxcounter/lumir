# harness 增量规格

> 起草注记（非规格正文）：本 delta 按 r3.2 **混合调用方案**编写，节点 1 的 H1 尚待 Alex 批准。
> 本 change 新增「Skill 的混合调用与入口策略」；「Skill 支持」补显式入口、双入口策略及索引 / 清单边界；
> 「composer 草稿 v2 与一次性 v1 转换」升 v3（带选择引用）。两个 MODIFIED 块均按 living spec 原文整块
> 复制再改，未要求删除的段落与场景逐字保留。交互与留存细节见 [design.md](../../design.md)，裁决点见
> [proposal.md](../../proposal.md)。

## ADDED Requirements

### Requirement: Skill 的混合调用与入口策略

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

**候选与被动选择**：键入 `/` 且满足边界与名字前缀匹配时 SHALL 显示候选；候选初始无高亮。被动态下
`Enter` / `Tab` MUST NOT 被候选消费；`↑` / `↓` 或指针悬停 SHALL 进入选择态。选择态下无修饰的
`↑` / `↓` 移动高亮（到端停住、不环绕），无修饰的 `Enter` / `Tab` 选中，`Esc` 关闭，鼠标点击选中
且按下时 MUST NOT 夺走输入区焦点。带修饰键的同名键 MUST NOT 被候选消费。`⌃N` / `⌃P` MUST NOT 被
候选消费，但 SHALL 主动关闭候选，即使光标未移动。`Esc` SHALL 走共享浮层层栈，一次只关最上层，
MUST NOT 收起面板或移动焦点。

输入法组合期 MUST NOT 触发候选、响应候选导航键或吞掉确认候选的 `Enter`；组合开始时已打开的候选 SHALL
立即关闭。

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

- **WHEN** 用户完整键入 `/acc-skill-abc 问题`（不进入选择态、不点击候选）并发送
- **THEN** 消息照常发出；该用户消息不含 `lumir_skill` 或显式注入正文；模型自主入口是否按既有逻辑调用
  不受该文本 token 强制

#### Scenario: 绝对路径不被误判

- **WHEN** vault 内存在名为 `tmp-acc` 的技能，用户在行首、空格后或列表项里键入 `/tmp` 后直接按 `Enter`
- **THEN** 消息照常发送对应文本；`llm_request.messages` 不含 `lumir_skill`；候选即使出现也不消费该 Enter

#### Scenario: 被动候选不抢 Enter 与 Tab

- **WHEN** 候选已显示且仍处于被动态，用户按 `Enter` 或 `Tab`
- **THEN** Enter 按原语义发送、Tab 按原语义处理；消息不因候选打开而被拦截或改写

#### Scenario: 选择态键位与 IME

- **WHEN** 候选已进入选择态，用户使用方向键 / Enter / Tab / Esc；另一次在中文输入法组合期键入或确认
- **THEN** 选择态只消费相应导航与选中键，Esc 只关候选；组合期不触发、不导航、不吞确认 Enter，
  组合开始关闭已有候选

#### Scenario: `⌃N` / `⌃P` 主动关候选但不消费

- **WHEN** 候选打开时按 `⌃N` 或 `⌃P`（分别覆盖单行末尾、单行开头、多行跨行）
- **THEN** 候选关闭且事件不被候选 `preventDefault`；光标按输入区既有行移动语义处理；消息不发送、文本不变

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

## MODIFIED Requirements

### Requirement: Skill 支持

系统 SHALL 自动发现 user-wide（`~/.agents/skills/`）与 vault-wide（`<vault>/.agents/skills/`）两处的 Skill（SKILL.md 约定），vault-wide 同名覆盖 user-wide。Skill 索引（name + description）SHALL 注入系统上下文；`skill_load(name)` 工具 SHALL 按名加载 SKILL.md 全文，路径解析 MUST 限定在两个 Skill 根内（只读、防逃逸）。外部能力（如 Tavily）SHALL 以「Skill + 对应 CLI」形态接入，系统 SHALL NOT 为特定外部服务内置专用工具。

除模型自主判断外，用户 SHALL 可经输入区显式选择点名 Skill，由后端确定性加载；两条入口的缺省、分控、
权限与留存见「Skill 的混合调用与入口策略」。文本里的 `/名字` 字样 MUST NOT 被当作显式调用依据。
该新增入口 MUST NOT 改变默认 Skill 的索引注入与模型自主 `skill_load` 能力；索引仍是会话建立 / 新会话 /
压缩时装配一次的会话快照。

前端清单 SHALL 只有一个发现来源：`harness_skills_list` 复用 `discover_skills`，不得另写双根遍历或覆盖
逻辑。候选只显示符合 `/` grammar、元数据合法且允许用户调用的条目；该过滤 MUST NOT 移除索引中的禁手动
条目，也 MUST NOT 阻止禁自动条目被用户显式选择。

候选清单 / 回合工具策略（实时发现）与系统提示索引（会话快照）SHALL 允许不同源：会话中途新增或改策略的
Skill 可在当回合按新发现结果执行，但索引不因它重装配；会话中途删除的 Skill 可仍在索引里，新的显式或自动
加载按当回合发现结果返回不存在。系统 MUST NOT 为消除该差异而在会话中途重装配系统提示。

#### Scenario: 索引注入与按需加载

- **WHEN** Skill 根下存在某外部搜索技能且 Alex 提问需要联网搜索
- **THEN** 模型可见技能索引中的该技能条目，经 `skill_load` 取得用法后经 `cli_run` 调用对应 CLI

#### Scenario: 路径逃逸拒绝

- **WHEN** `skill_load` 收到指向 Skill 根外的路径或名称
- **THEN** 拒绝并回送错误，不读取任何根外文件

#### Scenario: 清单命令与索引同源

- **WHEN** vault 内新增一个与 user-wide 同名的 Skill（或新增一个全新 Skill），随后打开候选
- **THEN** 同名条目只出现一条且 `source` 为 `vault`，其 description 与调用策略也整体来自 vault；
  全新技能在允许用户调用时出现在候选里，但系统提示索引在本次会话内不因它改变

#### Scenario: 清单失败不阻断输入

- **WHEN** 清单命令失败、返回坏 JSON 或当前没有打开 vault
- **THEN** 候选按空清单处理，输入区键入、发送与既有错误提示不受影响；已有引用 chip 仍按引用渲染，
  不误标缺失或禁用

#### Scenario: 候选过滤不削弱自动发现

- **WHEN** Skill 根下存在禁手动、禁自动与 grammar 之外的技能
- **THEN** 禁手动不进候选但仍进索引并可自动加载；禁自动不进模型自动执行但仍可显式选择；grammar 之外
  的名字不进候选，其现有索引与 `skill_load` 口径逐条不变

### Requirement: composer 草稿 v2 与一次性 v1 转换

composer 内容 SHALL 作为当前 vault 的一份草稿自动保存与恢复；落点、tmp+rename、无 vault 不落盘、防抖、离散 flush、无变更不写、写失败 warning、串行写清、per-vault 隔离及发送成功 / 失败语义不变。草稿 MUST NOT 写入 vault。每次写入链 SHALL 捕获当前编辑世代；写失败时只有 epoch 未变且期间无新编辑才允许恢复原 pending。新编辑写已入链时，旧写 MUST NOT 借失败回填取得待写所有权；无新编辑时仍 SHALL 保留失败内容供后续 flush 重试。

草稿的归属 SHALL 在出发时绑定：前端在装载 vault 时记下该 vault 的稳定 id，读、写、清除命令 MUST 携带它；后端 SHALL 只按携带的 id 解析落点，MUST NOT 读取当前打开的 vault。切 vault 之前发出的在途写无论何时执行 MUST 只落它出发时的 vault 的文件，MUST NOT 写进之后打开的 vault；在途读的结果 MUST 按装载世代作废，不得覆盖新 vault 的输入区或「已落盘」基准。写失败重试 SHALL 仍打出发时的归属 id。切换 vault 时旧 vault 的待写按既有纪律丢弃（由切换前的 flush 写走），其迟到失败 MUST NOT 回填新 vault 的待写、MUST NOT 改变新 vault 的「已落盘」基准。

新草稿 SHALL 是 `{version:3,text,caret,cards,skills}`：text 是完整问题，caret 是 `[0,text.length]` 内 UTF-16 offset 或 null，cards 按 tray 顺序逐字段保存；skills 是显式选择引用数组，每项 `{name,from,to}`，from/to 是 `text` 内的 UTF-16 偏移，切片必须逐字节等于 `/名字`。读取时越界、切片不匹配或名字不合 `/` 调用 grammar 的引用 MUST 被丢弃，MUST NOT 影响草稿其余内容的恢复。skills MUST NOT 保存用户 / 模型调用策略快照；发送时 SHALL 按当前 Skill 策略重新判定。图片只存内容寻址名、源 mime 与可选宽高，MUST NOT 内联 base64；v3 合法往返必须逐字段还原（含 refs）。

现存 v1 与 v2 都是迁移的具体消费者。读到合法 v1 时 SHALL 一次性转换：段落按原顺序以 `\n` 连接，未知块以可见 JSON 文本加入，卡片按相对顺序全部抽入 cards；段落 caret 精确映射，卡片 / 末尾边界映射到最近后续文本块起点，无后续则全文末尾；skills 为空。读到合法 v2 时 SHALL 保留 text / caret / cards、skills 为空。两者成功后 SHALL 立即经既有串行 store 写回 v3，此后只读 / 只写 v3；MUST NOT 双写、保留旧编辑路径或建立通用迁移平台。load 起始 SHALL 捕获编辑世代；读盘期间发生新编辑时 MUST 跳过旧迁移写回及 written 基准覆盖，保留当前 pending / written。迁移写一旦入串行链，后续编辑写 SHALL 排在其后，最终落盘必须是最新输入。损坏 v1 / v2 / v3 安静回空；迁移写失败不谎报已保存。

#### Scenario: v3 往返与合法 caret

- **WHEN** 草稿包含多行文本、三类附件、显式选择引用和文本中部 caret，保存后重开同一 vault
- **THEN** text / caret / cards / skills 逐字段恢复，图片引用不变且无 base64；失效引用被丢弃且不影响其余内容；
  草稿不含调用策略快照，发送时按当前策略判定；撤销史不跨进程恢复

#### Scenario: v2 往返与合法 caret

- **WHEN** 现存 v2 草稿包含多行文本、三类附件和文本中部 caret，重开同一 vault
- **THEN** text / caret / cards 逐字段恢复、图片引用不变且无 base64；skills 为空；盘上立即写回一份 v3（无 v2 双写）

#### Scenario: v1 一次性转换不丢内容

- **WHEN** 现存 v1 含交错段落、未知块、三类卡片与段落 / 卡片 / 末尾 caret
- **THEN** 所有段落和未知块可见文本各出现一次，卡片相对顺序不变，caret 按合同映射且合法，skills 为空；
  成功后盘上只写一份 v3，无双写

#### Scenario: 发送与写失败保留语义

- **WHEN** 发送成功、发送被能力闸拒绝，或草稿写盘失败
- **THEN** 成功清空草稿；拒绝恢复发送前 text / caret / cards / skills 且草稿不变；写失败给 warning、
  不阻断输入、不谎报已保存

#### Scenario: 旧写失败不夺回新编辑的待写所有权

- **WHEN** v1/v2 迁移写或普通 v3 旧写在途，新输入 flush 已入串行链，随后旧写失败、新写成功并再次 flush；对照组旧写失败期间无新编辑
- **THEN** 前者再次 flush 不得写出旧内容，盘上逐字节保持新输入；对照组保留原待写并可在下一次 flush 成功重试

#### Scenario: 迟到的旧写不串台

- **WHEN** vault-a 的草稿写已发出但在途，随后切到 vault-b 完成装载，旧的写才执行
- **THEN** 它只落 vault-a 的草稿文件、逐字节不改 vault-b 的草稿；vault-b 的后续编辑只写 vault-b

#### Scenario: 迟到的旧读不污染新现场

- **WHEN** vault-a 的草稿读已发出但在途，装载 vault-b 的读先完成，旧的读才返回
- **THEN** 旧读结果整体作废（不返回内容、不铺进输入区），vault-b 的「已落盘」基准与盘上草稿不变

#### Scenario: 写失败重试仍落出发时的 vault

- **WHEN** vault-a 的草稿写失败（人话 warning），随后用户在 vault-a 里再次 flush
- **THEN** 重试携带的归属仍是 vault-a，成功后才更新 vault-a 的草稿；期间切换到的其他 vault 的草稿与待写不受影响
