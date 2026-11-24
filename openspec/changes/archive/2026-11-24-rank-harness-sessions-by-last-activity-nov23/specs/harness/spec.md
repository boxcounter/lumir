# harness Specification Delta

> 起草注记（非规格正文）：本 delta 只改「会话边界」一条 requirement，MODIFIED 块按当前 living spec
> 的整条正文复制再改（`openspec archive` 对 MODIFIED 是整块替换，少抄的段落会在归档时静默消失）。
> 机制与取舍见 [design.md](../../design.md)，裁决留痕见 [proposal.md](../../proposal.md)。

## MODIFIED Requirements

### Requirement: 会话边界

会话 SHALL 绑定 vault：内存态一个 vault 一个活跃会话（`RuntimeInner.sessions` 按 vault 键控、resume 铸新 id 替换槽位）；盘上按 vault 分目录并存多份历史会话 JSONL 留存，浮层可切换 / 新建 / 恢复（M433）。切 vault SHALL 切到该 vault 的会话，切回时恢复；关闭 vault 丢弃其会话；app 重启清空全部会话。每个逻辑会话 SHALL 有稳定 session id（`s<unix_millis>-<6 位随机>`，落 JSONL 文件名与 `session_open`）；会话建立、「新会话」重置、自动压缩、从历史会话恢复，四者 SHALL 各开一个 JSONL 文件，旧文件封闭不再追加（压缩前历史完整留存在旧文件，压缩摘要随新文件 `session_open` 留存；恢复新文件以 `opened_from=restore` + `restored_from` 标记源会话）。标题栏 harness 段 SHALL 提供「新会话」动作（面板在场时）：清空当前 vault 会话的消息历史并重新装配系统上下文（AGENTS.md / Skill 索引不变），旧会话 JSONL 文件不受影响。harness 段 SHALL 显示会话名——取**有效标题**（「会话本地留存」条的 last-wins 口径：最后一条带 `title` 的 `session_title` 记录），无标题记录时回落首条用户消息截断（约 20 字），两者皆无时显示「新会话」；生成标题的硬上限（20 码点）与显示截断长度相同，故标题显示不带省略号。会话标题变化 SHALL 即时反映到标题栏会话名与已打开的历史浮层行名，MUST NOT 要求 webview 重载；标题变化 MUST NOT 改变 transcript、session id、历史清单顺序或会话内容。自动压缩与从历史会话恢复开新逻辑会话时，源会话的有效标题 SHALL 随新文件继承（见「会话本地留存」条），使会话名在轮换后保持连续；「新会话」显式开始新对话，MUST NOT 继承。探针期 SHALL 提供**最小恢复入口**：标题栏 harness 段的会话浮层 SHALL 列出本 vault 的历史会话（极简选择器，按最后活动时间倒序、会话名取该会话的有效标题、无标题记录时回落该会话首条用户消息截断约 20 字；仅本 vault，只列不管理），选中一项 SHALL 从该会话 JSONL 重建会话并续写新会话文件——恢复 = 读文件最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应（算法见 design §6.2），system 与 input 原样灌回（**不重新装配**系统上下文）、不跨 provider 重写回放项。探针期 SHALL NOT 提供完整多会话管理 UI（会话重命名 / 搜索 / 分组等）与历史回看列表的完整形态；自动命名不属本禁令的「完整多会话管理 UI」——仍无手动重命名入口、无搜索、无分组。会话浮层每行已提供**单条删除**入口（行内两步确认、活跃会话拒删，M406 面板批次落地），它不属上述「完整管理 UI」。

会话清单 SHALL 以一份 JSONL 文件为一行（行身份 = `session_id`）；MUST NOT 折叠、合并、隐藏或去重源文件——恢复 / 压缩产生的多份文件各占一行。每行的最后活动时间 SHALL 是：该文件及其 `session_open.restored_from` 祖先链上 `llm_request` / `llm_response` 记录信封 `ts` 的最大值；链上没有任何轮次时，回落链上最早的首行 `session_open` 信封 ts；都没有时为无值——无值者排在有值者之后、按 session id 倒序，且行时间格不显示读数（MUST NOT 用 id 前缀或其它派生值伪造）。`session_title`（含 `inherit`）、`notice_delivered`、`approval`、`turn_aborted`、`error`、`loop_limit`、`subrun` 等 sidecar MUST NOT 计入活动时间。被拒的发送（没有 `llm_request`）与无人值守 cron（不写交互会话文件）MUST NOT 改变排序。

会话清单的顺序 SHALL 只由后端列举产生：`last_activity_ts` 倒序 → 同值按 session id 倒序 → 无值者最后。前端 MUST NOT 重排、MUST NOT 维护第二份排序口径；行时间格 SHALL 显示最后活动时间（该时间本身取真实信封 ts；链上与文件自身都没有可信 ts 时不显示读数）。标题变化 MUST NOT 改变顺序（沿用既有条款）。

从历史会话恢复 SHALL 开新文件并因此新增一行；源文件行 MUST 保留，MUST NOT 被折叠或隐藏。新行的活动时间 SHALL 沿 `restored_from` 链继承：没有自己的轮次时不得越过任何活动更晚的会话；与源行同值时按 session id 倒序相邻。源行与恢复行 SHALL 各自可恢复、可删除（活跃会话拒删不变）；用户 MAY 从源行再次恢复形成分支。

当前活跃会话 SHALL 按同一条排序自然落位，MUST NOT 钉顶、MUST NOT 单独加「当前」标记；刚恢复尚未说话时它沿用链上的活动时间，行位置 MUST NOT 因恢复动作而越过活动更晚的会话。

会话浮层 SHALL 在每次打开时现拉现建；打开期间 MUST NOT 实时重排、MUST NOT 轮询或订阅活动变化。改名仍 SHALL 原地更新已打开行的行名，MUST NOT 触发重排。

列举 MUST NOT 写 JSONL、MUST NOT 创建文件、MUST NOT 迁移、MUST NOT 改变文件 mtime。同名但无谱系关系的会话 MUST NOT 合并，各占一行，行时间格承担区分。自动压缩文件只标 `opened_from=compact`、没有 `restored_from`，MUST NOT 被当作任何文件的续写链：它按自身活动时间 / 创建时刻独立落位，MUST NOT 继承源文件的活动时间。

#### Scenario: 切 vault 切会话

- **WHEN** 在 vault A 有进行中的会话，切到 vault B 再切回
- **THEN** B 呈现其自身会话（或空会话），工具与上下文注入均解析到 B；切回 A 时 A 的会话原样恢复

#### Scenario: 新会话重置

- **WHEN** 在一段关于旧话题的对话后点击标题栏 harness 段的「新会话」
- **THEN** 消息历史清空、系统上下文重新装配，随后提问不受旧话题影响；旧会话 JSONL 文件完整保留且不再追加

#### Scenario: 新会话动作的幂等性

- **WHEN** 在任意会话状态（含尚无会话——首条提问未发出）下触发「新会话」，或连续触发多次
- **THEN** 每次调用均成功，结果恒为新空会话；尚无会话时为平凡成功（不报错——「没有会话」正是目标状态）

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
- **THEN** 该会话的 system 与 input（最后一条 `llm_request` 的完整请求体，并折叠其后未入请求的末尾响应，算法见 design §6.2）原样灌回内存态、不重新装配系统上下文；开新 JSONL 文件（首行 `session_open` 标 `opened_from=restore`、`restored_from`=源会话 id），旧文件封闭；源会话有有效标题时新文件随之继承，会话名保持连续；其后提问按恢复的历史续写；读数随留存重算灌回新会话（控制行显示源会话最近一次真实读数），并以读数种子（`usage` + `cache_totals`）落进新文件首行，供链式恢复起算；清单新增一行（新文件），源会话行仍保留；新行按链上活动时间落位、不越过活动更晚的会话，并与源行同值时按 session id 倒序相邻

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

- **WHEN** 恢复一份最后活动早于其它会话的历史会话，且尚未发送新消息
- **THEN** 清单新增一行（恢复文件），源会话行仍保留；新行按链上活动时间落位，不越过活动更晚的会话，并与源行同值时按 session id 倒序相邻

#### Scenario: 源行与恢复行独立操作

- **WHEN** 源会话与恢复文件同时存在于清单
- **THEN** 两行各自可恢复、可删除；从源行再次恢复会新增一个分支行；删除其中一行只影响该文件，不联动隐藏或删除其它行

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
- **THEN** 没有 `llm_request` 落盘，该会话的最后活动时间与清单位置不变

#### Scenario: compact 文件不沿链继承

- **WHEN** 自动压缩开出一份 `opened_from=compact` 的新文件，源文件仍在
- **THEN** 两份文件各占一行；compact 文件没有 `restored_from`，不继承源文件的活动时间；同名或压缩模板名不合并

#### Scenario: 纯环谱系不挂起

- **WHEN** 两个文件的 `restored_from` 互相指向
- **THEN** 列举正常返回，两份文件各一行（精确 session id 集），链遍历终止；不丢行、不重复
