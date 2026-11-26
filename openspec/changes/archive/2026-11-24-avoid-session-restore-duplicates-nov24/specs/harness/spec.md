## MODIFIED Requirements

### Requirement: 会话边界

会话 SHALL 绑定 vault：内存态一个 vault 一个活跃会话（`RuntimeInner.sessions` 按 vault 键控；resume 在真正切换时铸新 id 替换槽位，同一份未发布的 pending 恢复复用已铸身份）；盘上按 vault 分目录并存多份历史会话 JSONL 留存，浮层可切换 / 新建 / 恢复（M433）。切 vault SHALL 切到该 vault 的会话，切回时恢复；关闭 vault 丢弃其会话；app 重启清空全部会话。每个逻辑会话 SHALL 有稳定 session id（`s<unix_millis>-<6 位随机>`，落 JSONL 文件名与 `session_open`）；会话建立、「新会话」重置、自动压缩、从历史会话恢复，四者 SHALL 各开一个 JSONL 文件（从历史恢复在首次真实请求时开），旧文件封闭不再追加（压缩前历史完整留存在旧文件，压缩摘要随新文件 `session_open` 留存；恢复新文件以 `opened_from=restore` + `restored_from` 标记源会话）。标题栏 harness 段 SHALL 提供「新会话」动作（面板在场时）：清空当前 vault 会话的消息历史并重新装配系统上下文（AGENTS.md / Skill 索引不变），旧会话 JSONL 文件不受影响。harness 段 SHALL 显示会话名——取**有效标题**（「会话本地留存」条的 last-wins 口径：最后一条带 `title` 的 `session_title` 记录），无标题记录时回落首条用户消息截断（约 20 字），两者皆无时显示「新会话」；生成标题的硬上限（20 码点）与显示截断长度相同，故标题显示不带省略号。会话标题变化 SHALL 即时反映到标题栏会话名与已打开的历史浮层行名，MUST NOT 要求 webview 重载；标题变化 MUST NOT 改变 transcript、session id、历史清单顺序或会话内容。自动压缩与从历史会话恢复开新逻辑会话时，源会话的有效标题 SHALL 随新文件继承（见「会话本地留存」条），使会话名在轮换后保持连续；「新会话」显式开始新对话，MUST NOT 继承。探针期 SHALL 提供**最小恢复入口**：标题栏 harness 段的会话浮层 SHALL 列出本 vault 的历史会话（极简选择器，按最后活动时间倒序、会话名取该会话的有效标题、无标题记录时回落该会话首条用户消息截断约 20 字；仅本 vault，只列不管理），选中一项 SHALL 只读该会话 JSONL、把恢复结果重建到内存（**查看零写盘**：MUST NOT 创建目录 / 临时文件 / JSONL / sidecar，MUST NOT 改动源文件字节与 mtime），首次真实 `llm_request` 才原子发布一份新的恢复文件——恢复 = 读文件最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应（算法见 change `reshape-harness-session-recording` 的 design §6.2「恢复算法（重建 Session）」），system 与 input 原样灌回（**不重新装配**系统上下文）、不跨 provider 重写回放项。探针期 SHALL NOT 提供完整多会话管理 UI（会话重命名 / 搜索 / 分组等）与历史回看列表的完整形态；自动命名不属本禁令的「完整多会话管理 UI」——仍无手动重命名入口、无搜索、无分组。会话浮层每行已提供**单条删除**入口（行内两步确认、活跃会话拒删，M406 面板批次落地），它不属上述「完整管理 UI」。

会话清单 SHALL 以一份 JSONL 文件为一行（行身份 = `session_id`）；MUST NOT 折叠、合并、隐藏或去重源文件——恢复 / 压缩产生的多份文件各占一行。每行的最后活动时间 SHALL 是：该文件及其 `session_open.restored_from` 祖先链上 `llm_request` / `llm_response` 记录信封 `ts` 的最大值；链上没有任何轮次时，回落链上最早的首行 `session_open` 信封 ts；都没有时为无值——无值者排在有值者之后、按 session id 倒序，且行时间格不显示读数（MUST NOT 用 id 前缀或其它派生值伪造）。`session_title`（含 `inherit`）、`notice_delivered`、`approval`、`turn_aborted`、`error`、`loop_limit`、`subrun` 等 sidecar MUST NOT 计入活动时间。被拒的发送（没有 `llm_request`）与无人值守 cron（不写交互会话文件）MUST NOT 改变排序。

会话清单的顺序 SHALL 只由后端列举产生：`last_activity_ts` 倒序 → 同值按 session id 倒序 → 无值者最后。前端 MUST NOT 重排、MUST NOT 维护第二份排序口径；行时间格 SHALL 显示最后活动时间（该时间本身取真实信封 ts；链上与文件自身都没有可信 ts 时不显示读数）。标题变化 MUST NOT 改变顺序（沿用既有条款）。

从历史会话恢复 SHALL 只在首次真实 `llm_request` 时开新文件并因此新增一行（查看阶段零新增、清单行数不变）；源文件行 MUST 保留，MUST NOT 被折叠或隐藏。新行的活动时间 SHALL 沿 `restored_from` 链继承：没有自己的轮次时不得越过任何活动更晚的会话；与源行同值时按 session id 倒序相邻。源行与恢复行 SHALL 各自可恢复、可删除（活跃会话拒删不变）；用户 MAY 从源行再次恢复形成分支。

当前活跃会话 SHALL 按同一条排序自然落位，MUST NOT 钉顶、MUST NOT 单独加「当前」标记；待发布恢复（`activated=false`，或 `activated=true` 而尚未发布）SHALL NOT 出现在清单里——清单行身份是一份文件，没有文件就没有行，MUST NOT 为它伪造行或读数；首次真实请求发布文件后，它沿用链上的活动时间落位，行位置 MUST NOT 因恢复动作而越过活动更晚的会话。

会话浮层 SHALL 在每次打开时现拉现建；打开期间 MUST NOT 实时重排、MUST NOT 轮询或订阅活动变化。改名仍 SHALL 原地更新已打开行的行名，MUST NOT 触发重排。

列举 MUST NOT 写 JSONL、MUST NOT 创建文件、MUST NOT 迁移、MUST NOT 改变文件 mtime。同名但无谱系关系的会话 MUST NOT 合并，各占一行，行时间格承担区分。自动压缩文件只标 `opened_from=compact`、没有 `restored_from`，MUST NOT 被当作任何文件的续写链：它按自身活动时间 / 创建时刻独立落位，MUST NOT 继承源文件的活动时间。

查看历史会话 SHALL 与列举同一纪律：MUST NOT 创建目录、临时文件、JSONL 或任何 sidecar，MUST NOT 改动源文件字节与 mtime；查看 MAY 在内存中分配恢复身份（session id / token），但该身份 MUST NOT 产生任何持久化副作用。所点文件就是当前活跃会话的已发布文件时，系统 SHALL 直接返回 `switched=false`（不 fork、不新增文件、不重放 transcript；busy 下也成功）。同一份未发布的 pending 恢复被重复点击时（无论 `activated=false` 还是 `activated=true`），系统 SHALL 复用查看阶段已分配的 session id 与持久化 token，MUST NOT 重新铸 id、MUST NOT 重新读源、MUST NOT 重复重建 transcript 或通知。

查看另一份历史会话（A→B→A）SHALL 只替换内存投影，零新增文件；未发送即退出不留下任何新文件，重启后 MUST NOT 自动复活空恢复文件。待发布恢复（无论是否已激活）MUST NOT 出现在会话清单里：清单行身份是一份文件，没有发布就没有行。

跨 vault、非法 id、不可读或缺 `system` 的损坏源，以及需要真正切换时的 busy，SHALL 在替换当前会话之前失败：当前的会话、pending、token 与目录内容都不变；目录不存在时 MUST NOT 被创建。空源 SHALL 允许查看为空 transcript，零新增；其首次真实请求同样只发布一份恢复文件。查看成功后源被外部删除时，发送 SHALL 使用查看阶段捕获的内存快照，MUST NOT 重读或改用别的历史。

替换 pending 恢复时：若其尚未激活（`activated=false`，从未发生首次真实 `llm_request`），SHALL 直接丢弃、零写盘、不触碰临时文件；若已激活（`activated=true`）且仍未发布，任何丢弃或轮换它的操作（查看另一历史、显式「新会话」及走同一入口的 cron 会话新建 / 恢复回落新建）SHALL 先以完整缓冲批次尝试一次发布，仍失败则拒绝该操作并返回可见错误，保留当前会话、input、writer、缓冲、token 与健康，MUST NOT 静默丢弃已产生的对话。自动压缩走同一发布尝试，但其失败是内部「跳过压缩」结果，不返回用户可见的持久化错误（两个调用点的收尾见「会话本地留存」条）。判据 MUST NOT 用「批次空 / 非空」——`session_open` 恒在，唯一判据是「是否已激活」。

#### Scenario: 切 vault 切会话

- **WHEN** 在 vault A 有进行中的会话，切到 vault B 再切回
- **THEN** B 呈现其自身会话（或空会话），工具与上下文注入均解析到 B；切回 A 时 A 的会话原样恢复

#### Scenario: 新会话重置

- **WHEN** 在一段关于旧话题的对话后点击标题栏 harness 段的「新会话」
- **THEN** 消息历史清空、系统上下文重新装配，随后提问不受旧话题影响；旧会话 JSONL 文件完整保留且不再追加

#### Scenario: 新会话动作的幂等性

- **WHEN** 在任意会话状态（含尚无会话——首条提问未发出）下触发「新会话」，或连续触发多次
- **THEN** 除「pending 恢复已 `activated=true` 且仍有未发布 history、发布仍失败」这一态返回可见的持久化错误（当前会话与健康不变）外，每次调用均成功，结果恒为新空会话；尚无会话时为平凡成功（不报错——「没有会话」正是目标状态）

#### Scenario: 处理中触发新会话

- **WHEN** 一轮对话正在处理中（busy）时触发「新会话」
- **THEN** 返回「对话正在处理中」错误信封，在途会话不丢失、不产生副作用；待本轮结束或停止后可再次触发

#### Scenario: 压缩开新文件

- **WHEN** 自动压缩触发、开新逻辑会话
- **THEN** 新逻辑会话落新 session id 的新 JSONL 文件，其 `session_open` 携带压缩摘要；压缩前历史在旧 JSONL 文件中完整留存且不再追加

#### Scenario: 历史会话列举

- **WHEN** 打开标题栏 harness 段的会话浮层
- **THEN** 列出本 vault 的历史会话（极简选择器，按最后活动时间倒序、会话名取该会话的有效标题、无标题记录时回落该会话首条用户消息截断约 20 字），不列其他 vault 的会话；「新建会话」动作是 harness 段段首的 ＋ 钮、不在浮层内（浮层只剩历史行，M406 起；空清单时浮层整层不开）

#### Scenario: 从历史会话恢复续聊

- **WHEN** 在会话浮层选择一个历史会话
- **THEN** 该会话的 system 与 input（最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应，算法见 change `reshape-harness-session-recording` 的 design §6.2「恢复算法（重建 Session）」）原样灌回内存态、不重新装配系统上下文；查看阶段零新增文件、源文件字节与 mtime 不变，清单行数与顺序不变；首次真实发送才发布一份新 JSONL 文件（首行 `session_open` 标 `opened_from=restore`、`restored_from`=源会话 id），旧文件封闭；源会话有有效标题时新文件的初始批次随之继承，会话名保持连续；其后提问按恢复的历史续写；读数随留存重算灌回新会话（控制行显示源会话最近一次真实读数），并以读数种子（`usage` + `cache_totals`）落进新文件首行，供链式恢复起算；清单新增一行（新文件），源会话行仍保留；新行按链上活动时间落位、不越过活动更晚的会话，并与源行同值时按 session id 倒序相邻

#### Scenario: 标题优先于首条消息

- **WHEN** 某会话已有有效标题，另一会话没有标题记录但已有首条用户消息
- **THEN** 前者在标题栏与历史浮层中显示标题（不带省略号）；后者显示首条用户消息截断约 20 字；两者均无时显示「新会话」

#### Scenario: 标题更新不重排历史

- **WHEN** 会话空闲时一次 rename 生效，历史浮层正打开
- **THEN** 标题栏会话名与该行行名原地更新，浮层不重开、不跳位置、清单顺序不变；transcript 不变

#### Scenario: 按最后活动排序

- **WHEN** 本 vault 有两份历史会话，A 创建更早但最后活动更晚，B 创建更晚但最后活动更早
- **THEN** 浮层把 A 排在 B 前；顺序按最后活动时间，不按文件创建时刻

#### Scenario: sidecar 不计入活动时间

- **WHEN** 一份会话只追加了 `session_title` / `notice_delivered` / `approval` 等 sidecar，没有新的 `llm_request` / `llm_response`
- **THEN** 它的最后活动时间不变、清单位置不变；改名仍只改行名

#### Scenario: 恢复新增一行且不置顶

- **WHEN** 查看一份最后活动早于其它会话的历史会话，并在其恢复上下文里发出首次真实请求
- **THEN** 发布时才新增一行（恢复文件），查看阶段与发送前清单行数不变；源会话行仍保留；新行按链上活动时间落位，不越过活动更晚的会话，并与源行同值时按 session id 倒序相邻

#### Scenario: 源行与恢复行独立操作

- **WHEN** 源会话与恢复文件同时存在于清单
- **THEN** 两行各自可恢复、可删除；从源行再次恢复并真实发送会新增一个分支行（仅查看不新增）；删除其中一行只影响该文件，不联动隐藏或删除其它行

#### Scenario: 缺时间安静回落

- **WHEN** 列举一份 `llm_request` / `llm_response` / `session_open` 信封全部缺 ts 的旧会话文件
- **THEN** 它排在有时间值的会话之后、按 session id 兜底；行时间格不显示读数；不告警、不改写文件

#### Scenario: 同名但无谱系关系各占一行

- **WHEN** 两份无谱系关系的会话拥有相同的有效标题或回落名
- **THEN** 两行都出现、不合并，按最后活动时间排序；行时间格可区分

#### Scenario: 当前会话自然排序

- **WHEN** 当前活跃会话不是最近活动的那一条
- **THEN** 它在清单中按最后活动时间落位，不被钉顶、不显示「当前」标记；清单顺序与打开浮层的动作无关

#### Scenario: 打开期间不重排

- **WHEN** 浮层打开期间后台完成一轮对话或产生新的会话活动
- **THEN** 已打开的行不移动、不重排；关闭后重开才按新读数排序

#### Scenario: 列举只读

- **WHEN** 打开会话浮层并列出一份历史会话
- **THEN** 该 JSONL 的字节与 mtime 不变，目录不新增文件

#### Scenario: 被拒的发送不改变排序

- **WHEN** 一次发送被 `harness_busy` / 缺 provider / 图片能力闸拒绝
- **THEN** 没有 `llm_request` 落盘，该会话的最后活动时间与清单位置不变；若这是 pending 恢复的首次发送，MUST NOT 发布恢复文件（零新增）

#### Scenario: compact 文件不沿链继承

- **WHEN** 自动压缩开出一份 `opened_from=compact` 的新文件，源文件仍在
- **THEN** 两份文件各占一行；compact 文件没有 `restored_from`，不继承源文件的活动时间；同名或压缩模板名不合并

#### Scenario: 纯环谱系不挂起

- **WHEN** 两个文件的 `restored_from` 互相指向
- **THEN** 列举正常返回，两份文件各一行（精确 session id 集），链遍历终止；不丢行、不重复

#### Scenario: 查看历史零写盘

- **WHEN** 查看一份带有效标题、且带未消费通知的历史会话
- **THEN** 会话目录的 `.jsonl` 文件数不变、无临时文件；源文件 sha256 与 mtime 不变；transcript 与通知照常重建

#### Scenario: 重复查看复用同一身份

- **WHEN** 连续点击同一历史项三次，期间未发送
- **THEN** 首次返回 `switched=true`，其后每次 `switched=false`；session id 与持久化 token 不变；transcript 与通知各只重建一份；目录零新增

#### Scenario: A 与 B 来回查看零新增

- **WHEN** 依次查看历史会话 A、B、A，期间未发送
- **THEN** 三次都零新增文件；每次 transcript 内容属于所选源；退出并重启后目录仍零新增

#### Scenario: 当前项直切

- **WHEN** 当前活跃会话的已发布文件正是所点行
- **THEN** 返回 `switched=false`；不 fork、不新增、不重放 transcript、不改持久化 token

#### Scenario: busy 下只允许当前项直切

- **WHEN** 一轮对话处理中（busy），分别点击当前会话行与另一历史会话行
- **THEN** 前者返回 `switched=false` 且零副作用；后者返回 `harness_busy`，当前会话、文件与 pending 都不动

#### Scenario: 未发布的 pending 恢复不占清单行

- **WHEN** 查看一份历史会话但尚未发送
- **THEN** 清单行数与顺序不变，不出现指向未发布文件的伪行；重复打开浮层仍只列既有文件

#### Scenario: 空源查看零新增

- **WHEN** 查看一份没有任何会话轮次的历史会话
- **THEN** 面板为空、零新增文件；发出首次真实消息后才恰好多出一份恢复文件

#### Scenario: 首次真实发送唯一文件

- **WHEN** 查看一份有标题、有未消费通知的历史会话并发出首条真实消息
- **THEN** 目录 `.jsonl` 文件数恰好 +1；新文件 `opened_from=restore`、`restored_from`=所选源 id；`inherit` 与 `notice_delivered` 各恰好一条且在首条 `llm_request` 之前；源文件字节与 mtime 不变；清单此时新增一行

#### Scenario: 查看后退出不复活

- **WHEN** 查看 A 再查看 B，未发送即退出并重启
- **THEN** 重启后目录文件数与退出前相同，MUST NOT 出现空恢复文件或自动复活的清单行

#### Scenario: 查看失败零副作用

- **WHEN** 查看跨 vault / 非法 id / 缺 `system` 的损坏源，或 busy 下查看另一历史会话
- **THEN** 返回明确错误；当前会话、pending、token、目录文件数都不变；不创建目录或临时文件

#### Scenario: 未发布批次阻止静默丢弃

- **WHEN** 一份恢复已激活（发生过首次真实 `llm_request`）且因发布失败仍未发布（该轮已结束），用户点击另一历史会话
- **THEN** 系统先尝试一次发布；仍失败则拒绝切换，旧会话、input、writer、缓冲、token 与健康不变，返回可见的持久化错误；MUST NOT 丢弃缓冲记录

#### Scenario: 纯查看 A 与 B 来回零发布

- **WHEN** 查看一份带有效标题、且带未消费通知的历史会话 A，再查看另一份同样带标题 / 通知的 B，期间从未发送
- **THEN** 两次查看都零新增、无临时文件；MUST NOT 因 A 的 view 元数据非空而尝试发布 A；每次 transcript 属于所选源

#### Scenario: 未发布批次阻止显式新会话

- **WHEN** 一份恢复已激活且发布失败，用户点击「新会话」
- **THEN** 系统先尝试一次发布；仍失败则返回可见的持久化错误，当前会话、transcript、缓冲与健康不变；MUST NOT 重置会话、MUST NOT 清缺口 / `history_written`

#### Scenario: 阈值触发的压缩被跳过

- **WHEN** 一份恢复已激活且发布失败，一轮回答完成时达到自动压缩阈值，压缩请求 / 响应已产生
- **THEN** 轮换前先以完整批次尝试发布；仍失败则跳过轮换：不创建 compact 文件、不替换 input / system / writer、不采用摘要；本轮回答照常完成、对话继续；既有 persistence 告警可见，MUST NOT 产生新的持久化错误

#### Scenario: context overflow 的压缩被跳过

- **WHEN** 一份恢复已激活且发布失败，provider 返回 context overflow，压缩请求 / 响应已产生
- **THEN** 轮换前先尝试发布；仍失败则 MUST NOT 在未压缩上下文上重试，MUST NOT 新增持久化错误，按本轮既有 overflow 错误落回终态；原 pending、未压缩 input 与完整批次保留

### Requirement: 会话本地留存

会话 SHALL 以 wire/input 形态落配置目录（MUST NOT 写入 vault），作为 ADR 0007 双向记录机制的一侧：每会话一个 append-only JSONL 文件（`<config_dir>/harness/sessions/<vault 稳定 id>/<session_id>.jsonl`），文件首行 SHALL 为 `session_open` 记录——含 session id、vault 根路径、provider / 模型 / 思考档位 / **wire 方言（`wire_api`，缺省值同样在场）**、**完整装配后 system prompt 全文**与装配清单（每个来源的路径、存在与否、字节数；不存在的来源 SHALL 同样在场）、**读数种子**（M526：恢复 / 压缩开文件时在场——`usage` 读数快照 + `cache_totals` 累计四元组；链式恢复从这里起算，全新会话不落这两键）。`<vault 稳定 id>` SHALL 是 vault 注册表 id（与 `vault-sessions/<id>.json`、`reading-positions/<id>.json` 同一份身份），MUST NOT 用 vault 路径派生的消毒名（消毒名有撞名面且无长度 / 字符集保证，M309 现场）。每次发给模型的**会话请求**（含工具循环的每次迭代与压缩调用）SHALL 落一条 `llm_request` 记录（完整请求体：system + messages + 参数，**另带本次实际发送体的字节数 `request_bytes`**——按 wire 展开后的尺寸算，省掉「按字节比外推请求多大」；不具备真实 HTTP body 的 mock 档省略该键），**另带本次暴露给模型的工具名清单 `tool_names`**（按请求中工具定义的顺序、只记名字，MUST NOT 记录工具 schema / 描述 / 参数——`task` 的描述里含用户写的定义描述，属用户内容；该键恒在场，无工具的请求记空数组 `[]`——`[]` 表示「这一请求不带任何工具」，与「没有记录」区分；本 change 之前的文件缺该键，读取方 MUST NOT 把它当作空数组），每次响应 SHALL 落一条 `llm_response` 记录（正文 / 思考归一回放项与展示文本 / 工具调用 / usage（SHALL 含 input / cached / output 与**缓存写入 `cache_write_tokens`**——provider 不提供时按 0 记录）/ 错误；思考 MUST 落盘——**回放项归一回放形状**（`{"type":"reasoning", summary, [content], [encrypted_content]}`：kimi 的明文载体是 `summary`、deepseek 的是 `content`，各按在场项保留；`encrypted_content` 有则在场），`id` 字段 MUST NOT 进入回放项（`store:false` 下重放 `rs_*` id 属非标用法），展示文本另存）；请求侧在 **Responses 方言**且模型声明支持思考档位时（判据 `HarnessConfig::effort_supported`，读配置 schema 的 per-model `effort` 声明）SHALL 带 `include:["reasoning.encrypted_content"]`（store:false 官方回放模式的前提——让服务端在 reasoning item 里回传密文，重放时无需 id 即可还原）；未声明 effort 的模型（含 deepseek 现役形态）MUST NOT 发该字段；**Chat Completions 方言 MUST NOT 发 `include` / `store`**，其 wire 形态与思考回放字段见「Chat Completions 方言」条；wire 不可推导的决策与事件（批准 / 拒绝、停止中断、LLM 错误、循环上限）SHALL 以 sidecar 记录留存——其中 **LLM 错误的 sidecar 记录 SHALL 另带 HTTP 面诊断**（非 2xx 时的 HTTP 状态码、原始响应 body——按固定上限截断防巨型 body 撑爆留存、服务端 request id 若响应头或 body 提供；不具备 HTTP 面的错误省略这些键），且**错误事件的既有形态（`type`/`code`/`message`）不变**（新诊断只进留存，不破坏既有消费方），被 wire 覆盖或失去意义的 11 类事件 kind（`user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` / `tool_denied` / `compact` / `session_reset` / `approval_overwritten` / `approval_withdrawn` / `turn_abort_requested`）SHALL NOT 再记（重复记录即第二事实源）。记录点 SHALL 与发送点同点，MUST NOT 经二次序列化产生第二事实源。验收口径 SHALL 为恢复充分性：仅凭 JSONL 能逐字节重建任意一轮发给模型的请求——wire 体由留存 + 代码版本 + `wire_api` 方言共同推导，`session_open` 的方言键是推导依据之一；重建 MUST 忽略全部 sidecar 记录（含 `session_title`），旧文件缺失标题记录不改变重建结果。

从历史会话恢复的查看阶段 SHALL 零写盘：MUST NOT 创建会话目录（查看路径 MUST NOT 调用会 `create_dir_all` 的写路径）、MUST NOT 创建临时文件、MUST NOT 写 `session_open` / `inherit` / `notice_delivered` 或任何 sidecar；源文件 MUST NOT 被改写，其字节与 mtime MUST NOT 变化。

恢复文件的**初始激活批次** SHALL 由首次真实 `llm_request` 触发发布。查看阶段 MUST NOT 构造批次——`session_open` / `inherit` / `notice_delivered` 在查看时只是内存中的 view 元数据，未序列化、不可发布。记录顺序固定为：`session_open` → `inherit?`（源会话有有效标题时）→ `notice_delivered*`（按查看时重建的通知次序）→ 首条 `llm_request`。批次内每条记录恰好一次。发布 SHALL 是原子的：先把整个初始批次写入**与最终文件同目录**的临时文件（文件名 MUST NOT 以 `.jsonl` 结尾，MUST NOT 被会话列举识别），完整写入并关闭后，以不覆盖既有文件的方式原子发布最终 `sessions/<vault 稳定 id>/<session_id>.jsonl`；最终路径已存在时 MUST NOT 覆盖、MUST NOT 静默换 id，SHALL 按写失败处理。发布成功是唯一的提交点：此后该文件恢复普通 append-only 行为，临时名清理失败只留不可列举残留，MUST NOT 回滚最终文件或再次发布。发布 MUST NOT 创建会话目录；目录不存在按发布失败处理。

发布失败时（权限 / 磁盘 / 撞名 / 目录缺失），**本次发布 MUST NOT 创建最终文件**：目标此前不存在则失败后仍不存在；因撞名失败时既有目标 MUST 逐字节保留、不覆盖、不改 id；MUST NOT 留下空文件或半截的本次最终文件。已激活但未发布的初始批次 SHALL 完整保留在内存中，后续记录继续加入该批次，重试 SHALL 使用**同一个 session id、同一个持久化 token、同一份缓冲批次**，每次写动作至多尝试一次发布。发布成功后缓冲的每条记录在文件里恰好出现一次，触发发布的那条记录 MUST NOT 再经 append 写一次。发布成功前进程退出，则这段对话随内存消失，MUST NOT 在重启后留下或复活该恢复文件。

自动压缩 SHALL 走同一未发布批次守卫，但结果是内部「跳过压缩」，不是用户可见的持久化错误：

- **阈值触发**（一轮完成后的自动压缩）：发布失败 ⇒ MUST NOT 轮换、MUST NOT 采用摘要；保留未压缩 input / system / writer 与完整批次，本轮回答照常完成；既有 persistence 健康告警（degraded + 退出风险句）即用户可见反馈，MUST NOT 静默、MUST NOT 把本轮判失败。
- **context overflow 恢复**：发布失败 ⇒ MUST NOT 在未压缩上下文上重试（该轮 overflow 重试机会已消费，重试必然再次 overflow），MUST NOT 新增持久化用户错误，SHALL 落回既有 overflow 终态（沿用本轮 provider 的 overflow 错误事件 / 终态），同时保留原 pending、未压缩 input 与完整批次。

两种情形都 MUST NOT 创建 compact 文件、MUST NOT 替换 input / system / writer、MUST NOT 采用摘要；压缩请求 / 响应记录仍留在原批次。显式「新会话」在同一态下先尝试发布，失败则拒绝并保留会话与健康（见「会话边界」条）。

恢复文件的 `opened_from` 恒为 `restore`、`restored_from` 恒为所选源 id；即使源文件本身是 `opened_from=compact`，新文件也 MUST NOT 继承 compact 身份。`restored_from` 指向的源文件在查看后被外部删除时，发送 SHALL 使用查看阶段捕获的内存快照，MUST NOT 重读源文件或改用别的历史；悬空父 id 沿用既有列举算法。

会话文件的 vault 归属 SHALL 仍以首行 `session_open.vault_root` 为**唯一**判据：列举、恢复、删除三处的归属过滤口径不变，目录只作组织维度，MUST NOT 成为归属判据的第二真源（文件被手工挪动 / 拷贝不改变其归属结论）。目录名 SHALL NOT 与保留目录名 `_orphaned` 相同。`sessions/<vault 稳定 id>/<session_id>.jsonl` SHALL 是**唯一布局**：新建会话 SHALL 只落其 vault 的目录，列举 / 恢复 / 删除 SHALL 只读该目录；产品运行时 MUST NOT 含任何迁移逻辑（无启动迁移入口、无旧布局读取路径），也 MUST NOT 读平铺在 `sessions/` 根下的 `*.jsonl`——MUST NOT 保留平铺布局的双读 / 双写过渡层（本仓无外部消费者，兼容层保护对象的举证责任在建层一方；REVIEW.md「消费者是谁」）。存量平铺文件（升级前遗留）的归位 SHALL 由**仓内一次性脚本**（`scripts/` 下，手动执行一次即弃，不进产品运行时）完成：脚本按各文件首行 `session_open.vault_root`（先规范化再查注册表）移入对应 vault 目录，`vault_root` 不可解析 / 在注册表里找不到 / 目标位置已有同名文件的 SHALL 移入保留目录 `sessions/_orphaned/`，MUST NOT 删除或改写任何文件，且 MUST be 幂等（重复执行零搬运）；脚本遇单文件失败时留原地并自报，重跑脚本收敛。上一代「按 vault 聚合的业务事件流水」形态（`<config_dir>/harness/<消毒名>.jsonl`）照旧不再续写、不做迁移（运行时 / 产品侧零读者，验收套件的 JSONL 断言随实现迁移至 wire 口径；M309 孤儿先例）。写失败不阻断对话的既有纪律不变；写失败的结果 SHALL 反映在「留存健康状态」条定义的**当前写健康与历史缺口**两个维度上，MUST NOT 只留在 stderr 与诊断日志里。

会话标题 SHALL 以 sidecar 记录 `session_title` 追加留存：`{"kind":"session_title","title":"…","decision":"initial|rename|keep|inherit|error","reason":"first-turn|cadence|drift|inherit","model":"…","ts":…}`。每次命名评估结束（含 keep 与失败）SHALL 追加一条——`initial` / `rename` 记录携带新标题，`keep` 记录携带当时生效的标题，`error` 记录不带 `title` 并带错误码 `code`（`harness_title_failed` / `harness_title_invalid`）；`inherit` 记录不是评估产物，在建新文件时写入（恢复文件的这一条属初始激活批次，见下段）。`model` SHALL 记录本次调用实际使用的模型 id（`inherit` 记录不带该键——它没有发起调用，`reason=inherit`）。**有效标题** SHALL 是文件内最后一条带 `title` 的 `session_title` 记录的 `title`；没有该记录时回落首条用户消息（见「会话边界」条）。有效标题的解析 MUST 只有一处实现，列举 / 恢复 / 快照 / 事件四条出口 MUST NOT 各写一份 last-wins 逻辑。标题记录 SHALL 只在会话空闲（无在途轮次）时追加，MUST NOT 插在一条 `llm_request` 与它配对的 `llm_response` 之间——恢复的「折叠末尾未入请求的响应」判据依赖这对记录的相邻性。

自动压缩与从历史会话恢复开新文件时，源会话的有效标题 SHALL 以一条 `decision=inherit` 的 `session_title` 记录写入新文件（源会话无标题记录时不写，回落口径自然成立）；恢复的这条记录属初始激活批次，查看阶段 MUST NOT 写入。「新会话」显式开始新对话，MUST NOT 继承。本 change 之前的会话文件不含 `session_title` 记录：列举、恢复、展示 SHALL 安静回落到首条用户消息口径，MUST NOT 告警、MUST NOT 回填或改写既有文件。

自动命名调用是 **wire 外的辅助调用**：它 MUST NOT 落 `llm_request` / `llm_response`（它不属会话历史——落进去会使「最后一条会话 `llm_request`」判据指错请求、并打破请求 / 响应的配对口径），其 usage MUST NOT 进入会话读数（`UsageSnapshot` / `cache_totals` / ctx% / cache%）。`session_title` 记录是 wire 外的 sidecar，恢复充分性判据 MUST NOT 因它的在场或缺失而变化。

#### Scenario: 留存落盘

- **WHEN** 完成一轮含工具调用的对话
- **THEN** 配置目录下 `sessions/<vault 稳定 id>/<session_id>.jsonl` 追加完整 wire 记录（`session_open` / 成对的 `llm_request` / `llm_response` / sidecar 决策记录），vault 目录无任何新增或修改，`sessions/` 根下不新建任何文件

#### Scenario: 按 vault 分置与列举范围

- **WHEN** vault A 与 vault B 各有历史会话，随后在 vault A 打开 harness 段的会话浮层
- **THEN** 两边的会话文件各自落在 `sessions/<A 的 vault 稳定 id>/` 与 `sessions/<B 的 vault 稳定 id>/` 下；浮层只列 A 目录里的会话，且仍按 `session_open.vault_root` 过滤（目录内容不构成归属判据）

#### Scenario: 平铺文件一次性归位

- **WHEN** 在仓内手动执行一次性迁移脚本，`sessions/` 根下存在平铺的 `<session_id>.jsonl`（首行 `session_open` 带 `vault_root`）
- **THEN** 每个文件被移入其 vault 的目录（逐字节不变，只换位置），脚本跑完后根下不再有 `*.jsonl`；再跑一次脚本不产生任何搬运（幂等）

#### Scenario: 不可归属者进孤儿桶

- **WHEN** 一次性迁移脚本遇到平铺文件不可读 / 首行不是 `session_open` / 其 `vault_root` 在注册表里找不到 / 目标位置已有同名文件
- **THEN** 该文件被移入保留目录 `sessions/_orphaned/`，不删除、不改写；它不出现在任何 vault 的会话列举里，也不被任何恢复入口读到

#### Scenario: 旧文件孤儿化

- **WHEN** 本 change 落地后进行首次对话
- **THEN** 上一代「按 vault 聚合的业务事件流水」文件（`<config_dir>/harness/<消毒名>.jsonl`）不被续写、不被改写、不做迁移（M309 孤儿先例不变）

#### Scenario: 废弃 kind 不再记

- **WHEN** 完成一轮含工具调用与用量的对话
- **THEN** JSONL 中不出现 `user_message` / `assistant_text` / `tool_call` / `tool_result` / `usage` 等 11 类废弃 kind；同样的信息仅由 `llm_request` / `llm_response` 承载

#### Scenario: 装配记录落盘

- **WHEN** 发起新会话（或「新会话」重置、自动压缩开新逻辑会话）
- **THEN** 新 JSONL 文件首行为 `session_open`：system prompt 全文逐字节在场；装配清单含每个来源的路径与存在与否（user-wide AGENTS.md 不存在时 `exists:false` 同样记录）；provider / 模型 / 思考档位 / wire 方言在场

#### Scenario: 恢复充分性（属性级）

- **WHEN** mock provider 跑完一轮含工具循环的对话（消息含 `<quote>` 块、响应含思考文本），期间会话已产生 `session_title` 记录
- **THEN** 仅凭 JSONL 独立重建的每个请求与落盘 `llm_request` 深度相等（逐字节重建判据，重建忽略 `session_title` 等全部 sidecar 记录）；第 i 条响应的正文 / 思考 / 工具调用与第 i+1 条请求的历史对应项逐字节一致

#### Scenario: 思考落盘与回放

- **WHEN** 一轮响应含 reasoning 文本，其后一轮把上一轮响应的 reasoning 项带回历史
- **THEN** `llm_response` 记录思考——回放项（**归一形状**：剥掉 `id`、`MUST NOT` 含 `id`；保 `summary` / `content` / `encrypted_content`）与展示文本（给人看）分别在 `reasoning` / `thinking` 字段；后续请求的历史中该归一后的 reasoning 回放项逐字节在场，且 Responses 方言请求体在模型声明支持思考档位时带 `include:["reasoning.encrypted_content"]`（chat 方言不带该字段，其回放形态见「Chat Completions 方言」条）；恢复旧会话（记录早于本改动、reasoning 项仍带 `rs_*` id）时，重建的 input 同样不含 `id`

#### Scenario: 缓存写入随 usage 落盘

- **WHEN** provider 的响应 usage 带回 `cache_write_tokens`，完成一轮对话
- **THEN** 对应 `llm_response` 记录的 `usage` 块含 `cache_write_tokens` 原值；provider 不提供该字段时记为 0

#### Scenario: 标题记录落盘与读取

- **WHEN** 一次评估以 rename 结束，其后另一次评估以 keep 结束
- **THEN** 文件追加两条 `session_title` 记录（各带 `decision` / `reason` / `model` / `ts`）；有效标题取最后一条带 `title` 的记录，与 rename 结果一致；keep 记录携带同一标题，不改变展示名

#### Scenario: 标题调用不入 wire 留存

- **WHEN** 完成若干轮对话并伴随一次成功的命名调用
- **THEN** 文件内没有属于命名调用的 `llm_request` / `llm_response`（不存在 system 为命名指令的请求记录）；`llm_request` 与 `llm_response` 仍成对相邻，末尾响应的折叠判据不受影响

#### Scenario: 压缩与恢复继承标题

- **WHEN** 已有有效标题的会话触发自动压缩，或从历史会话恢复续聊
- **THEN** 压缩的新 JSONL 文件在 `session_open` 之后追加一条 `decision=inherit` 的 `session_title` 记录；恢复文件则在首次发布的初始批次里、紧跟 `session_open` 写入同一条记录（查看阶段零写盘、不写 inherit）；标题栏与历史浮层继续显示该标题；源会话无标题记录时不写 inherit，展示回落首条用户消息口径

#### Scenario: 旧文件安静回落

- **WHEN** 列举、恢复或展示本 change 之前落盘的会话文件（无 `session_title` 记录）
- **THEN** 会话名回落该会话首条用户消息截断约 20 字；不产生 warning、不写任何回填记录、文件逐字节不变；恢复后的请求重建结果与不含标题记录时一致

#### Scenario: 请求暴露面可核对

- **WHEN** 同一个 vault 里先以 `[harness.subagents].enabled = true` 发出一条请求，再以 `enabled = false` 开新会话发出一条请求，期间还发生过一次子运行
- **THEN** 前者对应 `llm_request.tool_names` 按请求顺序列出工具名、含 `task`；后者不含 `task`；两次都是数组且只有名字（无 schema / 描述）；该子运行的审计流水里同字段只含其定义声明的白名单、`task` 恒缺席

#### Scenario: 旧文件缺键不判空

- **WHEN** 读取一份本 change 之前落盘的会话文件（`llm_request` 无 `tool_names` 键）
- **THEN** 该缺失被当作「没有记录」，MUST NOT 被当作空数组；恢复、读数重算与请求重建都不受影响，文件也不因读取而被改写

#### Scenario: 查看恢复不写任何记录

- **WHEN** 查看一份带有效标题、带未消费通知的历史会话
- **THEN** 目录内 `.jsonl` 文件集合不变、无 `.jsonl.tmp` 残留；每个既有文件的 sha256 与 mtime 不变；恢复结果只存在于内存

#### Scenario: 初始批次顺序

- **WHEN** 恢复一份有有效标题、有未消费通知的历史会话，并发出首条真实消息（mock provider）
- **THEN** 新文件记录序为 `session_open` → `session_title`（`decision=inherit`）→ `notice_delivered`（按重建次序）→ `llm_request`；每条恰好一次；`llm_request` 的请求体含恢复历史与本条用户消息

#### Scenario: 发布是原子的

- **WHEN** 首次发布进行中与完成后分别列举会话目录
- **THEN** 最终 `.jsonl` 从不以空文件或半截文件出现在清单里——它要么不可见，要么可完整解析且首行是 `session_open`；临时名从不被列举识别

#### Scenario: 发布失败不留最终文件

- **WHEN** 会话目录为可读不可写（真实 OS 权限），恢复会话后发出首条真实消息
- **THEN** 对话照常完成、消息照常上屏；本次不创建最终 `.jsonl`、无空 / 半截 `.jsonl`，目录里既有文件的字节与 mtime 不变；`state=degraded`、`severity=history`、`history_written=false`、`history_gap=false`；警示块含「对话暂未保存」与「现在退出，这段对话将无法恢复」

#### Scenario: 同身份重试不双写

- **WHEN** 上一场景后恢复目录写权限，用户再发一条消息
- **THEN** 同一 session id 发布恰好一份文件；缓冲的 `session_open` / `inherit` / `notice_delivered` / 首条 `llm_request` 与首条 `llm_response`、首条失败 sidecar（若有）与新消息各恰好一次；`history_written` 转 true、`history_gap` 仍 false；不出现第二份恢复文件

#### Scenario: 显式重试后的批次精确计数

- **WHEN** pending 恢复的首次发布因权限失败；首条真实请求已发出且 provider 返回错误；用户恢复权限并点显式重试，重试成功且发布成功
- **THEN** 恰好一份恢复文件；kind 计数为 `session_open` 1、`inherit` ≤1、`notice_delivered` 按重建条数、`llm_request` 2、`llm_response` 2、失败 sidecar 1；面板与 input 里用户消息各 1 条（两条请求的历史中都含该消息）；两条请求与两条响应各自对应；同一 session id；MUST NOT 出现第三条请求、重复记录或第二份文件

#### Scenario: 目标撞名不覆盖

- **WHEN** 首次发布前，目标 `<session_id>.jsonl` 已被外部创建
- **THEN** 不覆盖该文件、不改用别的 id；按发布失败处理（健康与告警同上）；原文件字节不变

#### Scenario: 未发布即退出

- **WHEN** 发布始终失败，用户在未发布状态下退出并重启
- **THEN** 重启后不出现该恢复文件，这段对话随内存消失；源文件不变，MUST NOT 自动复活空恢复文件

#### Scenario: 双击发送只受理一轮

- **WHEN** pending 恢复的首次发送被快速双击 / 重复触发
- **THEN** 只受理一轮；恰好一份恢复文件、一条用户消息、一条首个 `llm_request`；第二击得到 busy 或等价拒绝，零新增

#### Scenario: provider 前置拒绝不激活

- **WHEN** pending 恢复的首次发送被缺 provider / 图片能力闸拒绝
- **THEN** 零新文件、零临时文件；错误可见；未发布状态保留，修好后首次成功的真实请求才发布

#### Scenario: provider 请求后失败（首次发布已成功）

- **WHEN** 恢复文件已发布成功，首条真实请求发出后 provider 返回错误
- **THEN** 该 `llm_request`、失败的 `llm_response` 与失败 sidecar 追加到同一文件；显式重试追加同一文件，不新增文件

#### Scenario: provider 请求后失败（首次发布未成功）

- **WHEN** 首次发布因权限失败，首条真实请求仍发出且 provider 返回错误
- **THEN** 该 `llm_request`、失败的 `llm_response` 与失败 sidecar 进入同一内存批次；最终文件仍不存在（本次未创建，无空 / 半截）；后续写动作或显式重试按 D1 同身份发布；MUST NOT 声称该失败轮次无记录或已丢失

### Requirement: 留存健康状态

系统 SHALL 为每个活跃逻辑会话维护**两个相互独立**的留存健康维度：**当前写健康**（`state`：这段会话的留存现在还能不能写）与**历史缺口**（`history_gap`：这段会话是否已经缺失恢复所依赖的记录，或文件是否可能因部分写而损坏）。两者 MUST NOT 合并成一个 `ok/degraded`：一次成功追加只证明写能力恢复，不能补回已经缺失的记录。另有辅助事实 `history_written`（本逻辑会话是否已有至少一条 `llm_request` / `llm_response` 成功写盘），只用于「尚未落盘」提示，不是第三个健康维度。

当前写健康：任意一次写失败（序列化 / 打开 / 首行写入 / 行写入）SHALL 使 `state` 转 `degraded`；此后任意一次成功追加 SHALL 使其转回 `ok`。`state=degraded` SHALL 带 `severity` 与 `detail`：`severity` 为 `history`（失败记录属于 `llm_request` / `llm_response`；或失败可能已在文件里留下部分字节；或首行 `session_open` 失败）或 `annotation`（仅 sidecar 且没有任何字节落盘）；`detail` SHALL 记录本段 `degraded` 首次失败的分类，后续失败不刷新，恢复时清空。`annotation` 级失败 MUST NOT 降低已有的 `history`。

历史缺口：`history_gap` SHALL 是 latch，包含 `present` / `since_ts` / `detail`。以下任一情况 SHALL 置 `present=true`，并记录首次缺口时间与首次缺口分类：

- `llm_request` / `llm_response` 任一次写失败（无论是否留下部分字节——该记录永久缺失）；
- 任意一次写失败可能已在文件里留下部分字节（无法区分时 MUST 按「可能部分写」处理——JSONL 完整性可能受损）。

`history_gap.present=true` 后，后续成功追加、自动压缩换文件、切 vault MUST NOT 清除它；只有产生新的逻辑会话（显式「新会话」、从历史恢复、app 重启后重新建立会话）才从 `present=false` 起算。`annotation` 干净失败 MUST NOT 置 `history_gap`，也 MUST NOT 清除或降低已有的缺口。

**首行失败必须同时评价本次 `record(payload)` 的 payload**：`record(payload)` 在首行写入失败时直接返回，本次 payload 也没有写出、没有被 `pending_open` 保存。因此：

- 本次 payload 是 `llm_request` / `llm_response`：即使首行干净失败（未写入任何字节），该 payload 也随本次调用永久丢失 → `history_gap` SHALL 置 true；后续重试成功只恢复当前写健康，MUST NOT 补回这条记录，也 MUST NOT 清缺口。
- 本次 payload 是 annotation：首行失败 SHALL 只影响当前写健康（`severity=history`），不置 `history_gap`；annotation 丢失不 latch。首行重试成功后当前写健康回 `ok`。
- 本次只写首行、没有 payload 被丢弃（若存在这种独立写首行的路径）：不置 `history_gap`。

写点 MUST 保留挂起的 `session_open` 行，使下一条记录仍先重试写首行。首行或任意记录的部分写 SHALL 置 `history_gap`。系统 MUST NOT 承诺部分写后的文件仍可被完整读取或恢复；已损坏的文件不修复、不截断。唯一的例外是恢复会话文件的首次发布：它 MUST 采用原子发布（临时文件完整写入后不覆盖地发布最终 JSONL）；**本次发布 MUST NOT 创建空 / 半截最终文件；撞名时既有目标 MUST 逐字节保留**（见「会话本地留存」条）；该例外不适用于发布成功之后的 append-only 写入，也不修复既有损坏文件。

**已激活但未发布的恢复批次** SHALL 单独评价，不与已发布文件的 append-only 失败混同。从历史会话恢复、首次真实请求已使恢复激活（`activated=true`）而文件尚未发布时，激活时形成的批次（`session_open` / `inherit` / `notice_delivered` / 已产生的 history 记录）SHALL 完整保留在内存中；此期间发布失败 SHALL 置当前写健康为 `degraded`、`severity=history`、`detail` 记录发布失败分类、`since_ts` 记首次失败时间，但 MUST NOT 置 `history_gap.present=true`——缓冲记录尚未永久丢失，MUST NOT 提前制造缺口，也 MUST NOT 发 `false→true` 的缺口事件。`history_written` 保持 `false`；呈现 SHALL 用「对话暂未保存」与「现在退出，这段对话将无法恢复」两段文案，MUST NOT 使用缺口文案「此前部分对话记录未能保存」。全部缓冲记录随后一次发布成功时，当前写健康 SHALL 转 `ok`、`history_written` SHALL 转 `true`、`history_gap.present` 保持 `false`，MUST NOT 出现假缺口。若退出前始终未发布成功，该批记录随内存消失且 MUST NOT 在重启后补报——它不属于 latch 口径（文件从未存在）。已发布之后的普通 append-only 写入（含部分写）仍按本条的既有口径判缺口。因未发布批次被拒绝的查看切换 / 显式新会话，或被跳过的压缩轮换 / 落回的 overflow 终态，MUST NOT 重置、清除或改写当前健康（`degraded`、`since_ts`、`history_written`、`history_gap` 全部保持）。

`history_written` SHALL 在本逻辑会话第一条 `llm_request` / `llm_response` 成功写盘时转 `true`，同一逻辑会话内不再回落；自动压缩换文件沿用；新逻辑会话重置为 `false`。它 MUST NOT 参与 `history_gap` 判定，只决定「现在退出，这段对话将无法恢复」这条退出风险句是否还在。

`since_ts`（当前写健康）SHALL 记录本段 `degraded` 首次失败时间，恢复时归零；`history_gap.since_ts` SHALL 记录本段首次缺口时间，新逻辑会话时归零。

健康状态 SHALL 在 `harness_state` 快照的 `persistence` 键与 `harness:event` 的 `persistence` 事件两处呈现，**同键同值**：顶层 `state` / `since_ts` / `severity` / `detail` / `history_written` / `history_gap` 六键恒在场；`history_gap` 内 `present` / `since_ts` / `detail` 三键恒在场。`state=ok` 时 `severity` 为 `null`、`since_ts` 为 0、`detail` 为空串；`history_gap.present=false` 时其 `since_ts` 为 0、`detail` 为空串。事件与快照 MUST 共用同一份序列化，MUST NOT 各列一份键清单。`state=ok` 且 `history_gap.present=true` 是合法状态，MUST NOT 被呈现为健康。

事件 SHALL 在以下跃迁时发出：当前写健康 `ok→degraded`、`degraded→ok`、`annotation→history`；历史缺口 `false→true`；`history_written` `false→true`。一次失败 / 成功可同时改变多项，发出一条完整载荷；`degraded→ok` 且缺口仍为 true 的恢复事件 MUST 发出。重复失败不发事件，快照是重挂载 / 重载时的地板。

呈现：`history_gap.present=true` 期间，harness 面板 SHALL 在 composer 上方持续显示一条警示块（`role="status"`，浅警示色底 + 左侧警示边条、正文色、完整换行，不用红色），文案 MUST 明确「此前部分对话记录未能保存」；`state=ok` 时 MUST 明确「新内容已恢复写入」。`state=degraded` 且缺口在场时，文案 MUST 同时说明当前写入仍未保存（「对话暂未保存」）并给出检查磁盘空间 / 目录权限的下一步；`state=degraded` 且无缺口时，警示块按 `severity` 显示当前失败。`history_written=false` 且存在任何持久化告警（`state=degraded` 或缺口）时，文案 MUST 额外说明「现在退出，这段对话将无法恢复」；`history_written` 转 true 后该句消失，缺口文案仍保留。警示块不自动消隐、不随轮次结束消失、不提供关闭按钮；`state=ok` 且无缺口时 SHALL 隐藏（`history_written=false` 本身不构成告警，只在已有告警时追加退出风险句）。

本逻辑会话首次进入 `severity=history`（包括先 `annotation` 后升级为 `history`）或 `history_gap` 首次 `present=true` 时，SHALL 额外给一条 sticky 提示，每个逻辑会话只一条，按文案去重，面板重挂载不重复。无动作的 history sticky SHALL 提供原生可聚焦关闭钮（`button`，读屏名「关闭提示 / Close notification」）与 Escape 关闭路径：Tab 可达，Enter / Space 触发 click；MUST NOT 自动抢焦点。Escape 准入 MUST 复用 `src/escape-router.ts` 的 `escapeDisposition()`：组合期 / `keyCode=229` 不关、不消费；⇧/⌘/⌃/⌥+Escape 只消费默认行为、不关；普通 Escape 关闭 sticky，且 MUST NOT 连带关闭面板。关闭（Enter / Space / Escape / 点击）后 SHALL 把焦点归还到提示出现前的有效元素；该元素失效时回落到 composer 区域，MUST NOT 落到 `body`。其他无动作 sticky MUST NOT 因此新增关闭钮或改变 DOM。sticky MAY 点击关闭；关闭只移除本次提示，MUST NOT 隐藏警示块、MUST NOT 清除 `history_gap`、MUST NOT 被视为对未来失败的静音。两类呈现 MUST NOT 提供额外的「忽略 / 静音」控件（关闭 sticky 只等于关闭本次提示），MUST NOT 写配置项。

切 vault 只切换当前展示的会话快照，MUST NOT 清除或重置任何会话的健康；切回时 SHALL 显示该会话自身仍 latch 的状态。显式「新会话」SHALL 立即清除当前会话健康（含 `history_gap` 与 `history_written`），面板 MUST NOT 继续显示旧状态；从历史恢复 / app 重启后重新建立会话，从空健康起算。自动压缩开新文件 SHALL 沿用两维与 `history_written`，直到新文件首次成功追加；该成功只把当前写健康转 `ok`，MUST NOT 清除缺口。

每次写失败 SHALL 另落一条结构化诊断日志（记录种类 + 错误分类 + 是否可能部分写）；日志 MUST NOT 含消息正文、文档内容或 system prompt。

会话目录创建失败 SHALL 仍走既有 `harness_jsonl_failed` 硬错误（发送被拒），不进入健康状态；恢复文件的首次发布 MUST NOT 创建目录，其目录缺失按「已激活但未发布的恢复批次」处理，不适用本句。子运行审计流水、composer 草稿、附件 MUST NOT 进入本状态。健康只覆盖「本次 write 系统调用是否成功」，MUST NOT 被理解为对 `fsync`、断电、外部删除或写到旧 inode 的保证。隔离运行（无人值守）SHALL NOT 向面板呈现健康，只进日志。

#### Scenario: 当前写失败与恢复

- **WHEN** 一条 `session_title`（sidecar）写入干净失败（未写入任何字节），随后下一次追加成功
- **THEN** 失败后 `state=degraded`、`severity=annotation`、`history_gap.present=false`；成功后 `state=ok`、`severity=null`、缺口仍为 false；警示块随两次跃迁显示 / 隐藏

#### Scenario: 历史失败后成功恢复写能力，缺口仍在

- **WHEN** 一条 `llm_request` 写入失败；随后恢复可写并完成下一次成功追加
- **THEN** 失败后 `state=degraded`、`severity=history`、`history_gap.present=true`；成功后 `state=ok`、`severity=null`，但 `history_gap.present` 仍为 true；事件发出 `state=ok` + gap true 的恢复载荷；面板显示「此前部分对话记录未能保存；新内容已恢复写入。」，MUST NOT 回到健康文案

#### Scenario: 压缩轮换沿用缺口

- **WHEN** 会话处于 `history_gap.present=true` 时自动压缩开新文件，且新文件首次追加成功
- **THEN** 当前写健康转 `ok`，`history_gap.present` 仍为 true；缺口不被新文件洗白

#### Scenario: 切 vault 不清健康

- **WHEN** vault A 的会话已有 `history_gap.present=true`，用户切到 vault B（B 的会话健康为 `ok`），再切回 A
- **THEN** 切到 B 时显示 B 自身的健康；切回 A 时 A 的缺口仍在；切 vault 本身 MUST NOT 产生清除或缺口的重置

#### Scenario: 新会话与恢复重置两维

- **WHEN** 用户显式「新会话」（未被未发布批次守卫拒绝），或从历史恢复产生新会话，或 app 重启后重新建立会话
- **THEN** 两维与 `history_written` 都从空健康起算（`state=ok`、`history_gap.present=false`、`history_written=false`）；面板 MUST NOT 继续显示旧会话的警示块；旧缺口只留在盘上与日志，app 重启后 MUST NOT 补报旧告警

#### Scenario: 严重度与缺口触发

- **WHEN** 同一会话先发生 `session_title` 干净失败，再发生 `llm_request` 干净失败，随后发生 `approval` 部分写失败
- **THEN** 第一次为 `annotation` 且无缺口；第二次为 `history` 且置缺口；第三次仍为 `history`、缺口保持；`annotation` 失败不降级 `history`

#### Scenario: annotation 失败不清缺口

- **WHEN** `history_gap.present=true` 且当前写健康为 `ok` 时，发生一次 `session_title` 干净失败，随后成功
- **THEN** 失败期间 `state=degraded`、`severity=annotation`，缺口仍为 true；成功后 `state=ok`，缺口仍为 true

#### Scenario: 首行干净失败 + history payload

- **WHEN** 首行 `session_open` 在未写入任何字节时失败，而本次 `record(payload)` 的 payload 是 `llm_request`；随后恢复可写并写入下一条记录
- **THEN** 写点保留挂起行；重试成功后首行是 `session_open`，但本次 `llm_request` 已随失败丢失、MUST NOT 被后续成功补回；`history_gap.present=true`，后续成功只把当前写健康转 `ok`；`history_written` 在一条 history 记录真正成功前保持 false

#### Scenario: 首行干净失败 + annotation payload

- **WHEN** 首行 `session_open` 在未写入任何字节时失败，而本次 payload 是 `session_title`；随后恢复可写并写入下一条记录
- **THEN** 写点保留挂起行；重试成功后首行是 `session_open`；`history_gap.present=false`（annotation 丢失不 latch），当前写健康回 `ok`；本场景 MUST NOT 被理解为「部分写也可恢复」的保证

#### Scenario: 尚未落盘的风险提示

- **WHEN** `history_written=false` 且存在持久化告警（首行 + `llm_request` 失败后尚无任何 history 记录成功）
- **THEN** 警示块除缺口文案外 MUST 明确「现在退出，这段对话将无法恢复」；随后一条 `llm_request` 成功写盘使 `history_written=true`，该句消失，但缺口文案仍保留

#### Scenario: 前缀写入后报错

- **WHEN** 一次 `llm_request` 或 sidecar 写入先写入若干字节、随后返回错误
- **THEN** 当前写健康为 `degraded`、`severity=history`、`history_gap.present=true`；后续成功追加 MUST NOT 清除缺口；系统 MUST NOT 声称该文件仍可被完整读取 / 恢复；新逻辑会话才清除缺口

#### Scenario: 快照与事件同键同值

- **WHEN** 健康状态发生一次跃迁（含 `state=ok` + gap true 的恢复、`history_written false→true`）
- **THEN** `persistence` 事件的顶层六键与 `history_gap` 三键同 `harness_state` 快照逐键同值（同一份序列化）；事件另带 `type=persistence` 与 `vault` 信封

#### Scenario: 缺口恢复后的呈现与消退

- **WHEN** 当前写健康回 `ok` 但 `history_gap.present=true`，随后用户开始新会话
- **THEN** 新会话前警示块持续显示缺口文案（不自动消隐、无关闭按钮），MUST NOT 呈现为健康；新会话后警示块隐藏

#### Scenario: 首次 history 的 sticky 含升级

- **WHEN** 本逻辑会话先发生 `annotation` 失败（只亮警示块），随后升级为 `history` 失败
- **THEN** 在进入 `history` 的那一刻给一条 sticky 提示；这是本逻辑会话唯一一条；关闭并重开面板不重复

#### Scenario: 关闭 sticky 不等于静音

- **WHEN** sticky 提示在场，用户点击关闭它
- **THEN** 只移除本次提示；警示块仍在、`history_gap` 不变、不写配置；新逻辑会话仍可再次触发 sticky

#### Scenario: 旧快照缺键不误报

- **WHEN** 前端收到不含 `persistence` / `history_gap` / `history_written` 键的旧快照
- **THEN** 视为 `ok` / `present=false` / `history_written=true`：不显示警示块、不弹提示、不误报「尚未保存」；会话其余内容照常恢复

#### Scenario: 隔离运行不呈现

- **WHEN** 无人值守运行发生留存写失败
- **THEN** 面板收不到 `persistence` 事件、无警示块；诊断日志有记录；交互会话的健康不受影响

#### Scenario: 写失败不阻断对话

- **WHEN** 留存写入失败期间用户继续一轮对话
- **THEN** 轮次照常完成、消息照常上屏；新增的只有健康状态与诊断日志，MUST NOT 出现用户侧「发送失败」

#### Scenario: pending 恢复激活后发布失败不置缺口

- **WHEN** 恢复会话后首次发送，发布因目录不可写在最终 `.jsonl` 出现前失败
- **THEN** `state=degraded`、`severity=history`、`history_written=false`、`history_gap.present=false`；事件只发 `ok→degraded`，不发缺口 `false→true`；警示块说明「对话暂未保存」与退出风险，MUST NOT 出现「此前部分对话记录未能保存」

#### Scenario: 发布重试成功且无假缺口

- **WHEN** 上一场景后目录恢复可写，下一条记录触发发布成功
- **THEN** `state=ok`、`severity=null`、`history_written=true`、`history_gap.present=false`；缓冲记录各落盘一次；事件发 `degraded→ok` 与 `history_written` `false→true`，不发缺口事件

#### Scenario: 初始批次的豁免止于发布

- **WHEN** 恢复文件已发布成功，随后一条 `llm_request` 部分写失败
- **THEN** 按既有口径 `severity=history`、`history_gap.present=true`；MUST NOT 以「初始批次豁免」放行

#### Scenario: 未发布即退出不补报

- **WHEN** 发布始终失败，用户退出并重启 app
- **THEN** 不补报该会话的健康告警、不出现恢复文件或清单行；源文件未被改写

#### Scenario: 拒绝替换不清健康

- **WHEN** pending 恢复已 `activated=true` 且发布失败（`state=degraded`、`history_gap=false`），用户点另一历史 / 触发新会话被拒，或自动压缩被跳过 / 落回既有 overflow 终态
- **THEN** `state`、`severity`、`since_ts`、`history_written`、`history_gap` 全部保持原值；不发 `degraded→ok` 或缺口事件；警示块文案不变；被拒操作本身 MUST NOT 产生新的持久化写；overflow 终态只发既有 provider 错误事件，MUST NOT 发新的 persistence 错误
